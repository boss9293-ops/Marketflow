"""
Build and enrich SNAPSHOT_ALERT signals from daily_snapshots trend layer.

Rule:
- risk_trend = 'Deteriorating'
- gate_score < 60
- phase_shift_flag = 1

Payload enrichment:
- strength = ABS(gate_delta_5d) + (phase_shift_flag*5) + MAX(0, 60 - gate_score)
- severity_label: HIGH/MED/LOW
- streak: consecutive active alert-day count
- regime_label: STRUCTURAL/EVENT/NOISE
- recovery_streak: consecutive non-alert-day count right before the alert day

Duplicate handling:
- same date + signal_type='SNAPSHOT_ALERT' is not inserted again
- existing row payload is updated

Usage (PowerShell):
  python backend/scripts/update_snapshot_alerts.py
  python backend/scripts/update_snapshot_alerts.py --days 120
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import traceback
from datetime import datetime
from typing import Dict, List, Set, Tuple

from update_snapshot_trends import (
    compute_trends,
    db_path,
    ensure_trend_columns,
    fetch_target_rows,
    table_exists,
    update_rows,
)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def recalc_snapshot_trends(conn: sqlite3.Connection, days: int) -> int:
    ensure_trend_columns(conn)
    base_df = fetch_target_rows(conn, days)
    if base_df.empty:
        return 0
    trend_df = compute_trends(base_df)
    updated = update_rows(conn, trend_df)
    conn.commit()
    return updated


def get_recent_snapshots(conn: sqlite3.Connection, days: int) -> List[Tuple]:
    # Keep the latest N rows, then reorder ascending for streak calculations.
    return conn.execute(
        """
        SELECT
          date, gate_score, gate_score_10d_avg, gate_score_30d_avg,
          gate_delta_5d, risk_trend, phase_shift_flag, market_phase, risk_level
        FROM (
          SELECT
            date, gate_score, gate_score_10d_avg, gate_score_30d_avg,
            gate_delta_5d, risk_trend, phase_shift_flag, market_phase, risk_level
          FROM daily_snapshots
          ORDER BY date DESC
          LIMIT ?
        ) t
        ORDER BY date ASC
        """,
        (days,),
    ).fetchall()


def snapshot_alert_exists(conn: sqlite3.Connection, date_value: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM signals
        WHERE date = ?
          AND signal_type = 'SNAPSHOT_ALERT'
        LIMIT 1
        """,
        (date_value,),
    ).fetchone()
    return row is not None


def get_active_alert_dates(conn: sqlite3.Connection, dates: List[str]) -> Set[str]:
    if not dates:
        return set()
    placeholders = ",".join("?" for _ in dates)
    rows = conn.execute(
        f"""
        SELECT DISTINCT date
        FROM signals
        WHERE signal_type = 'SNAPSHOT_ALERT'
          AND status = 'active'
          AND date IN ({placeholders})
        """,
        dates,
    ).fetchall()
    return {str(r[0]) for r in rows}


def calc_strength(gate_delta_5d, phase_shift_flag, gate_score) -> float:
    delta = abs(float(gate_delta_5d or 0.0))
    phase_boost = int(phase_shift_flag or 0) * 5
    score_penalty = max(0.0, 60.0 - float(gate_score or 0.0))
    return round(delta + phase_boost + score_penalty, 2)


def severity_label(strength: float) -> str:
    if strength >= 15:
        return "HIGH"
    if strength >= 8:
        return "MED"
    return "LOW"


def regime_label_from_streak(streak: int) -> str:
    if streak >= 5:
        return "STRUCTURAL"
    if streak >= 2:
        return "EVENT"
    return "NOISE"


def build_payload(
    row: Tuple,
    streak: int | None = None,
    regime_label: str | None = None,
    recovery_streak: int | None = None,
) -> Dict:
    (
        date_value,
        gate_score,
        gate_score_10d_avg,
        gate_score_30d_avg,
        gate_delta_5d,
        risk_trend,
        phase_shift_flag,
        market_phase,
        risk_level,
    ) = row

    strength = calc_strength(gate_delta_5d, phase_shift_flag, gate_score)
    sev = severity_label(strength)

    payload: Dict = {
        "date": date_value,
        "rule": "risk_trend='Deteriorating' AND gate_score<60 AND phase_shift_flag=1",
        "strength": strength,
        "severity_label": sev,
        "trend": {
            "gate_score": gate_score,
            "gate_score_10d_avg": gate_score_10d_avg,
            "gate_score_30d_avg": gate_score_30d_avg,
            "gate_delta_5d": gate_delta_5d,
            "risk_trend": risk_trend,
            "phase_shift_flag": phase_shift_flag,
            "market_phase": market_phase,
            "risk_level": risk_level,
        },
        "generated_at": now_iso(),
        "data_version": "snapshot_alert_v3",
    }
    if streak is not None:
        payload["streak"] = int(streak)
    if regime_label is not None:
        payload["regime_label"] = regime_label
    if recovery_streak is not None:
        payload["recovery_streak"] = int(recovery_streak)
    return payload


def insert_snapshot_alert(conn: sqlite3.Connection, row: Tuple) -> None:
    payload = build_payload(row)
    date_value = row[0]
    gate_score = row[1]
    conn.execute(
        """
        INSERT INTO signals (
          date, symbol, signal_type, score, status, payload_json, created_at
        ) VALUES (?, NULL, 'SNAPSHOT_ALERT', ?, 'active', ?, ?)
        """,
        (
            date_value,
            gate_score,
            json.dumps(payload, ensure_ascii=False),
            now_iso(),
        ),
    )


def update_snapshot_alert_payload(
    conn: sqlite3.Connection,
    row: Tuple,
    streak: int | None = None,
    regime_label: str | None = None,
    recovery_streak: int | None = None,
) -> int:
    payload = build_payload(row, streak=streak, regime_label=regime_label, recovery_streak=recovery_streak)
    date_value = row[0]
    gate_score = row[1]
    cur = conn.execute(
        """
        UPDATE signals
        SET
          score = ?,
          status = 'active',
          payload_json = ?
        WHERE date = ?
          AND signal_type = 'SNAPSHOT_ALERT'
        """,
        (
            gate_score,
            json.dumps(payload, ensure_ascii=False),
            date_value,
        ),
    )
    return int(cur.rowcount if cur.rowcount is not None else 0)


def compute_streaks(
    dates_asc: List[str],
    active_alert_dates: Set[str],
) -> Tuple[Dict[str, Dict[str, int | str]], int]:
    """
    Returns:
    - map[date] = {streak, recovery_streak, regime_label} for alert days only
    - max_streak
    """
    alert_streak = 0
    non_alert_streak = 0
    max_streak = 0
    out: Dict[str, Dict[str, int | str]] = {}

    for d in dates_asc:
        is_alert_day = d in active_alert_dates
        if is_alert_day:
            recovery_before_alert = non_alert_streak
            non_alert_streak = 0
            alert_streak += 1
            max_streak = max(max_streak, alert_streak)
            label = regime_label_from_streak(alert_streak)
            out[d] = {
                "streak": alert_streak,
                "recovery_streak": recovery_before_alert,
                "regime_label": label,
            }
        else:
            alert_streak = 0
            non_alert_streak += 1

    return out, max_streak


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=120, help="recent daily_snapshots days to evaluate")
    args = parser.parse_args()

    if args.days <= 0:
        print("[ERROR] --days must be > 0")
        return 1

    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    from db_utils import db_connect
    conn = db_connect(path)
    inserted = 0
    updated_existing = 0
    skipped = 0
    matched = 0
    streak_enriched = 0
    try:
        if not table_exists(conn, "daily_snapshots"):
            print("[ERROR] Missing table: daily_snapshots")
            return 1
        if not table_exists(conn, "signals"):
            print("[ERROR] Missing table: signals")
            return 1

        recalculated = recalc_snapshot_trends(conn, args.days)
        snapshots = get_recent_snapshots(conn, args.days)
        snapshot_by_date = {str(r[0]): r for r in snapshots}
        dates_asc = [str(r[0]) for r in snapshots]

        # Phase 1: ensure alert rows exist / base payload updated.
        for row in snapshots:
            date_value = str(row[0])
            gate_score = row[1]
            risk_trend = row[5]
            phase_shift_flag = row[6]

            if gate_score is None:
                continue
            if str(risk_trend) == "Deteriorating" and float(gate_score) < 60 and int(phase_shift_flag or 0) == 1:
                matched += 1
                if snapshot_alert_exists(conn, date_value):
                    updated_existing += update_snapshot_alert_payload(conn, row)
                    skipped += 1
                else:
                    insert_snapshot_alert(conn, row)
                    inserted += 1

        conn.commit()

        # Phase 2: enrich with streak/regime/recovery based on active alert continuity.
        active_alert_dates = get_active_alert_dates(conn, dates_asc)
        streak_map, max_streak = compute_streaks(dates_asc, active_alert_dates)

        regime_counts = {"STRUCTURAL": 0, "EVENT": 0, "NOISE": 0}
        for date_value, info in streak_map.items():
            row = snapshot_by_date.get(date_value)
            if not row:
                continue
            streak_enriched += update_snapshot_alert_payload(
                conn,
                row,
                streak=int(info["streak"]),
                regime_label=str(info["regime_label"]),
                recovery_streak=int(info["recovery_streak"]),
            )
            lbl = str(info["regime_label"])
            if lbl in regime_counts:
                regime_counts[lbl] += 1

        conn.commit()

        total_snapshot_alerts = conn.execute(
            "SELECT COUNT(*) FROM signals WHERE signal_type='SNAPSHOT_ALERT'"
        ).fetchone()[0]
        active_snapshot_alerts = conn.execute(
            "SELECT COUNT(*) FROM signals WHERE signal_type='SNAPSHOT_ALERT' AND status='active'"
        ).fetchone()[0]
        total_signals = conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0]

        print("============================================================")
        print("STEP 4 - Snapshot Alert Continuity Layer")
        print(f"[INFO] Recalculated snapshot trends: {recalculated} rows (recent {args.days} days)")
        print(f"[INFO] Condition matched dates: {matched}")
        print(f"[INFO] Inserted SNAPSHOT_ALERT: {inserted}")
        print(f"[INFO] Updated existing SNAPSHOT_ALERT: {updated_existing}")
        print(f"[INFO] Skipped duplicates: {skipped}")
        print(f"[INFO] Streak-enriched payload updates: {streak_enriched}")
        print("------------------------------------------------------------")
        print(f"[COUNT] STRUCTURAL: {regime_counts['STRUCTURAL']}")
        print(f"[COUNT] EVENT: {regime_counts['EVENT']}")
        print(f"[COUNT] NOISE: {regime_counts['NOISE']}")
        print(f"[COUNT] streak_max: {max_streak}")
        print("------------------------------------------------------------")
        print(f"[COUNT] signals total: {total_signals}")
        print(f"[COUNT] SNAPSHOT_ALERT total: {total_snapshot_alerts}")
        print(f"[COUNT] SNAPSHOT_ALERT active: {active_snapshot_alerts}")
        print("============================================================")
        return 0
    except Exception as e:
        conn.rollback()
        print(f"[FATAL] update_snapshot_alerts failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
