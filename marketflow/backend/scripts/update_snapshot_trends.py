"""
STEP D4.2: Update Trend Layer fields on daily_snapshots.

Features:
- Auto-adds trend columns via ALTER TABLE (if missing)
- Recalculates trend metrics for recent N snapshot dates (default 120)
- Prints verification rows

Usage (PowerShell):
  python backend/scripts/update_snapshot_trends.py
  python backend/scripts/update_snapshot_trends.py --days 120
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import traceback
from typing import List, Tuple

import pandas as pd

from date_utils import normalize_daily_snapshot_dates


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return row is not None


def get_columns(conn: sqlite3.Connection, table_name: str) -> List[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]


def ensure_trend_columns(conn: sqlite3.Connection) -> List[str]:
    required = {
        "gate_score_10d_avg": "REAL",
        "gate_score_30d_avg": "REAL",
        "gate_delta_5d": "REAL",
        "risk_trend": "TEXT",
        "phase_shift_flag": "INTEGER",
    }
    existing = set(get_columns(conn, "daily_snapshots"))
    added: List[str] = []
    for col, col_type in required.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE daily_snapshots ADD COLUMN {col} {col_type}")
            added.append(col)
    return added


def fetch_target_rows(conn: sqlite3.Connection, days: int) -> pd.DataFrame:
    normalize_daily_snapshot_dates(conn)

    rows = conn.execute(
        """
        SELECT date, gate_score, market_phase
        FROM daily_snapshots
        ORDER BY date DESC
        LIMIT ?
        """,
        (days,),
    ).fetchall()
    if not rows:
        return pd.DataFrame(columns=["date", "gate_score", "market_phase"])

    # Rolling calculations must run oldest -> newest.
    rows.reverse()
    df = pd.DataFrame(rows, columns=["date", "gate_score", "market_phase"])
    df["gate_score"] = pd.to_numeric(df["gate_score"], errors="coerce")
    return df


def calc_phase_shift_flags(phases: List[str]) -> List[int]:
    flags: List[int] = []
    for i in range(len(phases)):
        start = max(0, i - 9)
        window = [p for p in phases[start : i + 1] if p not in (None, "")]
        flags.append(1 if len(set(window)) > 1 else 0)
    return flags


def to_db_value(v):
    if pd.isna(v):
        return None
    return float(v)


def compute_trends(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["gate_score_10d_avg"] = out["gate_score"].rolling(window=10, min_periods=1).mean()
    out["gate_score_30d_avg"] = out["gate_score"].rolling(window=30, min_periods=1).mean()
    out["gate_delta_5d"] = out["gate_score"] - out["gate_score"].shift(5)

    def classify(delta) -> str:
        if pd.isna(delta):
            return "Stable"
        if delta >= 5:
            return "Improving"
        if delta <= -5:
            return "Deteriorating"
        return "Stable"

    out["risk_trend"] = out["gate_delta_5d"].apply(classify)
    out["phase_shift_flag"] = calc_phase_shift_flags(out["market_phase"].fillna("").tolist())
    return out


def update_rows(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    sql = """
    UPDATE daily_snapshots
    SET
      gate_score_10d_avg = ?,
      gate_score_30d_avg = ?,
      gate_delta_5d = ?,
      risk_trend = ?,
      phase_shift_flag = ?
    WHERE date = ?
    """
    rows: List[Tuple] = []
    for _, r in df.iterrows():
        rows.append(
            (
                to_db_value(r["gate_score_10d_avg"]),
                to_db_value(r["gate_score_30d_avg"]),
                to_db_value(r["gate_delta_5d"]),
                str(r["risk_trend"]),
                int(r["phase_shift_flag"]),
                str(r["date"]),
            )
        )
    conn.executemany(sql, rows)
    return len(rows)


def print_verification(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT date, gate_score, gate_score_10d_avg,
               gate_delta_5d, risk_trend, phase_shift_flag
        FROM daily_snapshots
        ORDER BY date DESC
        LIMIT 10
        """
    ).fetchall()
    print("------------------------------------------------------------")
    print("[VERIFY]")
    print("SELECT date, gate_score, gate_score_10d_avg,")
    print("       gate_delta_5d, risk_trend, phase_shift_flag")
    print("FROM daily_snapshots")
    print("ORDER BY date DESC LIMIT 10;")
    for row in rows:
        print(f"  - {row}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=120, help="recent snapshot days to recalculate")
    args = parser.parse_args()

    if args.days <= 0:
        print("[ERROR] --days must be > 0")
        return 1

    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        if not table_exists(conn, "daily_snapshots"):
            print("[ERROR] Missing table: daily_snapshots")
            return 1

        added_cols = ensure_trend_columns(conn)
        if added_cols:
            print(f"[INFO] Added columns: {', '.join(added_cols)}")
        else:
            print("[INFO] Trend columns already exist.")

        base_df = fetch_target_rows(conn, args.days)
        if base_df.empty:
            print("[WARN] No daily_snapshots rows found.")
            return 1

        trend_df = compute_trends(base_df)
        updated = update_rows(conn, trend_df)
        conn.commit()

        print("============================================================")
        print("STEP D4.2 - update_snapshot_trends.py")
        print(f"[INFO] Recalculated rows: {updated}")
        print(f"[INFO] Date range: {trend_df['date'].iloc[0]} ~ {trend_df['date'].iloc[-1]}")
        print_verification(conn)
        print("============================================================")
        print("[OK] Trend layer updated.")
        return 0
    except Exception as e:
        print(f"[FATAL] update_snapshot_trends failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
