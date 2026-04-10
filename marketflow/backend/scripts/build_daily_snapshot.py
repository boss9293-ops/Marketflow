"""
STEP D4: Build daily_snapshots (v1, robust defaults).

Goal:
- Create/update one daily_snapshots row from marketflow.db
- Works even when VCP/Rotation/ML inputs are missing

Usage (PowerShell):
  python backend/scripts/build_daily_snapshot.py
  python backend/scripts/build_daily_snapshot.py --date 2026-02-13
  python backend/scripts/build_daily_snapshot.py --date 2026-02-13 --rebuild
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import traceback
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from date_utils import normalize_date_str
from db_utils import db_connect, resolve_marketflow_db


def db_path() -> str:
    # Railway: /app/data/marketflow.db
    # Local:   marketflow/data/marketflow.db
    return resolve_marketflow_db(
        required_tables=("ohlcv_daily",),
        data_plane="live",
    )


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return row is not None


def resolve_target_date(conn: sqlite3.Connection, explicit_date: Optional[str]) -> Optional[str]:
    if explicit_date:
        return normalize_date_str(explicit_date)
    row = conn.execute("SELECT MAX(date) FROM ohlcv_daily").fetchone()
    return normalize_date_str(row[0]) if row else None


def count_total_stocks(conn: sqlite3.Connection, target_date: str) -> int:
    row = conn.execute(
        """
        SELECT COUNT(DISTINCT symbol)
        FROM ohlcv_daily
        WHERE date = ?
        """,
        (target_date,),
    ).fetchone()
    return int(row[0] if row else 0)


def count_vcp_signals(conn: sqlite3.Connection, target_date: str) -> int:
    if not table_exists(conn, "signals"):
        return 0
    row = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals
        WHERE date = ?
          AND UPPER(COALESCE(signal_type, '')) = 'VCP'
          AND LOWER(COALESCE(status, '')) IN (
            'active', 'open', 'ready', 'triggered', 'buy'
          )
        """,
        (target_date,),
    ).fetchone()
    return int(row[0] if row else 0)


def count_rotation_signals(conn: sqlite3.Connection, target_date: str) -> int:
    if not table_exists(conn, "signals"):
        return 0
    row = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals
        WHERE date = ?
          AND UPPER(COALESCE(signal_type, '')) IN ('ROTATION', 'SECTOR_ROTATION', 'RRG_ROTATION')
          AND LOWER(COALESCE(status, '')) IN (
            'active', 'open', 'ready', 'triggered', 'buy'
          )
        """,
        (target_date,),
    ).fetchone()
    return int(row[0] if row else 0)


def calc_gate_and_risk(conn: sqlite3.Connection, target_date: str) -> Tuple[Optional[float], Optional[str], Optional[str]]:
    """
    Return (gate_score, market_phase, risk_level).
    If market inputs are insufficient, return (None, None, None).
    """
    if not table_exists(conn, "market_daily"):
        return None, None, None

    row = conn.execute(
        """
        SELECT date, spy, vix
        FROM market_daily
        WHERE date = ?
        """,
        (target_date,),
    ).fetchone()
    if not row:
        return None, None, None

    _, spy, vix = row
    if spy is None or vix is None:
        return None, None, None

    prev = conn.execute(
        """
        SELECT spy
        FROM market_daily
        WHERE date < ?
          AND spy IS NOT NULL
        ORDER BY date DESC
        LIMIT 1
        """,
        (target_date,),
    ).fetchone()
    if not prev or prev[0] in (None, 0):
        return None, None, None

    prev_spy = float(prev[0])
    cur_spy = float(spy)
    cur_vix = float(vix)
    spy_change = ((cur_spy / prev_spy) - 1.0) * 100.0

    if cur_vix <= 15:
        vix_score = 30
    elif cur_vix <= 20:
        vix_score = 20
    elif cur_vix <= 25:
        vix_score = 10
    else:
        vix_score = 0

    trend_score = 25 if spy_change > 0 else 5
    momentum_score = 15 if spy_change > 0.5 else (10 if spy_change > 0 else 5)
    regime_score = 15
    gate_score = float(vix_score + trend_score + momentum_score + regime_score)

    if gate_score >= 70:
        market_phase = "BULL"
    elif gate_score >= 40:
        market_phase = "NEUTRAL"
    else:
        market_phase = "BEAR"

    if cur_vix >= 30:
        risk_level = "HIGH"
    elif cur_vix >= 20:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return gate_score, market_phase, risk_level


def upsert_snapshot(
    conn: sqlite3.Connection,
    target_date: str,
    total_stocks: int,
    vcp_count: int,
    rotation_count: int,
    market_phase: Optional[str],
    gate_score: Optional[float],
    risk_level: Optional[str],
    ml_spy_prob: Optional[float],
    ml_qqq_prob: Optional[float],
    data_version: str,
) -> None:
    now_iso = datetime.now().isoformat(timespec="seconds")
    conn.execute(
        """
        INSERT INTO daily_snapshots (
            date, total_stocks, vcp_count, rotation_count,
            market_phase, gate_score, risk_level,
            ml_spy_prob, ml_qqq_prob, data_version, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            total_stocks = excluded.total_stocks,
            vcp_count = excluded.vcp_count,
            rotation_count = excluded.rotation_count,
            market_phase = excluded.market_phase,
            gate_score = excluded.gate_score,
            risk_level = excluded.risk_level,
            ml_spy_prob = excluded.ml_spy_prob,
            ml_qqq_prob = excluded.ml_qqq_prob,
            data_version = excluded.data_version,
            generated_at = excluded.generated_at
        """,
        (
            target_date,
            total_stocks,
            vcp_count,
            rotation_count,
            market_phase,
            gate_score,
            risk_level,
            ml_spy_prob,
            ml_qqq_prob,
            data_version,
            now_iso,
        ),
    )


def validate_required_tables(conn: sqlite3.Connection) -> None:
    required = ["ohlcv_daily", "daily_snapshots"]
    missing = [t for t in required if not table_exists(conn, t)]
    if missing:
        raise RuntimeError(f"Missing tables: {missing}")


def build_snapshot_for_date(
    conn: sqlite3.Connection,
    target_date: str,
    rebuild: bool = False,
    data_version: str = "daily_snapshot_v1",
    ml_spy_prob: Optional[float] = None,
    ml_qqq_prob: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Build one daily_snapshots row for target_date.
    Returns computed values for logging.
    """
    deleted_rows = 0
    if rebuild:
        deleted = conn.execute(
            "DELETE FROM daily_snapshots WHERE date = ?",
            (target_date,),
        ).rowcount
        deleted_rows = int(deleted if deleted is not None else 0)

    total_stocks = count_total_stocks(conn, target_date)
    vcp_count = count_vcp_signals(conn, target_date)
    rotation_count = count_rotation_signals(conn, target_date)
    gate_score, market_phase, risk_level = calc_gate_and_risk(conn, target_date)

    upsert_snapshot(
        conn=conn,
        target_date=target_date,
        total_stocks=total_stocks,
        vcp_count=vcp_count,
        rotation_count=rotation_count,
        market_phase=market_phase,
        gate_score=gate_score,
        risk_level=risk_level,
        ml_spy_prob=ml_spy_prob,
        ml_qqq_prob=ml_qqq_prob,
        data_version=data_version,
    )

    return {
        "date": target_date,
        "deleted_rows": deleted_rows,
        "total_stocks": total_stocks,
        "vcp_count": vcp_count,
        "rotation_count": rotation_count,
        "market_phase": market_phase,
        "gate_score": gate_score,
        "risk_level": risk_level,
        "ml_spy_prob": ml_spy_prob,
        "ml_qqq_prob": ml_qqq_prob,
        "data_version": data_version,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=str, default=None, help="target date (YYYY-MM-DD)")
    parser.add_argument("--rebuild", action="store_true", help="delete target date row before recreate")
    args = parser.parse_args()

    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    conn = db_connect(path)
    try:
        validate_required_tables(conn)

        target_date = resolve_target_date(conn, args.date)
        if not target_date:
            print("[ERROR] Could not resolve snapshot date. ohlcv_daily is empty.")
            return 1

        result = build_snapshot_for_date(
            conn=conn,
            target_date=target_date,
            rebuild=args.rebuild,
        )
        conn.commit()

        if args.rebuild:
            print(f"[INFO] Rebuild mode: deleted {result['deleted_rows']} row(s) for {target_date}")

        snapshot = conn.execute(
            """
            SELECT
                date, total_stocks, vcp_count, rotation_count, market_phase,
                gate_score, risk_level, ml_spy_prob, ml_qqq_prob, data_version, generated_at
            FROM daily_snapshots
            WHERE date = ?
            """,
            (target_date,),
        ).fetchone()

        print("============================================================")
        print("STEP D4 - build_daily_snapshot.py")
        print(f"[INFO] Snapshot date: {target_date}")
        print(f"[INFO] total_stocks={result['total_stocks']}")
        print(f"[INFO] vcp_count={result['vcp_count']}")
        print(f"[INFO] rotation_count={result['rotation_count']}")
        print(
            f"[INFO] gate_score={result['gate_score']} "
            f"market_phase={result['market_phase']} risk_level={result['risk_level']}"
        )
        print("[INFO] Saved row:")
        print(f"  {snapshot}")
        print("============================================================")
        print("[OK] daily_snapshots updated.")
        return 0
    except RuntimeError as e:
        print(f"[ERROR] {e}")
        return 1
    except Exception as e:
        print(f"[FATAL] build_daily_snapshot failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
