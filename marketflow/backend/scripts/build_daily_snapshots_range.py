"""
STEP D4.1: Bulk builder for daily_snapshots.

Usage (PowerShell):
  python backend/scripts/build_daily_snapshots_range.py --days 120
  python backend/scripts/build_daily_snapshots_range.py --start 2025-01-01 --end 2026-02-13
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import traceback
from datetime import datetime
from typing import List, Tuple

from build_daily_snapshot import build_snapshot_for_date, db_path, validate_required_tables


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def log_path() -> str:
    return os.path.join(repo_root(), "backend", "logs", "build_daily_snapshots_range.log")


def ensure_log_dir() -> None:
    os.makedirs(os.path.dirname(log_path()), exist_ok=True)


def get_target_dates(
    conn: sqlite3.Connection,
    days: int,
    start: str | None,
    end: str | None,
) -> List[str]:
    if start or end:
        where = []
        params: List[str] = []
        if start:
            where.append("date >= ?")
            params.append(start)
        if end:
            where.append("date <= ?")
            params.append(end)
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        rows = conn.execute(
            f"SELECT DISTINCT date FROM ohlcv_daily {where_sql} ORDER BY date ASC",
            params,
        ).fetchall()
        return [str(r[0]) for r in rows]

    rows = conn.execute(
        "SELECT DISTINCT date FROM ohlcv_daily ORDER BY date DESC LIMIT ?",
        (days,),
    ).fetchall()
    latest_dates = [str(r[0]) for r in rows]
    latest_dates.reverse()
    return latest_dates


def run_verification_queries(conn: sqlite3.Connection, log_write) -> None:
    total = conn.execute("SELECT COUNT(*) FROM daily_snapshots").fetchone()[0]
    log_write(f"[VERIFY-a] SELECT COUNT(*) FROM daily_snapshots; => {total}")

    min_max = conn.execute("SELECT MIN(date), MAX(date) FROM daily_snapshots").fetchone()
    log_write(f"[VERIFY-b] SELECT MIN(date), MAX(date) FROM daily_snapshots; => {min_max[0]} ~ {min_max[1]}")

    latest5 = conn.execute(
        """
        SELECT
          date, total_stocks, vcp_count, rotation_count,
          market_phase, gate_score, risk_level, data_version, generated_at
        FROM daily_snapshots
        ORDER BY date DESC
        LIMIT 5
        """
    ).fetchall()
    log_write("[VERIFY-c] latest 5 daily_snapshots rows:")
    for row in latest5:
        log_write(f"  - {row}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=120, help="recent N trading dates (default: 120)")
    parser.add_argument("--start", type=str, default=None, help="start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, default=None, help="end date (YYYY-MM-DD)")
    parser.add_argument("--rebuild", action="store_true", help="delete row per date then recreate")
    parser.add_argument("--batch-size", type=int, default=30, help="progress log batch size (default: 30)")
    args = parser.parse_args()

    ensure_log_dir()
    lf = open(log_path(), "w", encoding="utf-8")

    def log_write(msg: str) -> None:
        print(msg)
        lf.write(msg + "\n")
        lf.flush()

    path = db_path()
    if not os.path.exists(path):
        log_write(f"[ERROR] DB not found: {path}")
        log_write("Run: python backend/scripts/init_db.py")
        lf.close()
        return 1

    if args.days <= 0:
        log_write("[ERROR] --days must be > 0")
        lf.close()
        return 1
    if args.batch_size <= 0:
        log_write("[ERROR] --batch-size must be > 0")
        lf.close()
        return 1

    conn = sqlite3.connect(path)
    failed_dates: List[Tuple[str, str]] = []
    success_count = 0
    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        validate_required_tables(conn)

        dates = get_target_dates(conn, args.days, args.start, args.end)
        total_dates = len(dates)

        log_write("============================================================")
        log_write("STEP D4.1 - build_daily_snapshots_range.py")
        log_write(f"Started: {datetime.now().isoformat(timespec='seconds')}")
        log_write(
            "[INFO] params: "
            f"days={args.days}, start={args.start}, end={args.end}, "
            f"rebuild={args.rebuild}, batch_size={args.batch_size}"
        )
        log_write(f"[INFO] target_dates={total_dates}")

        if total_dates == 0:
            log_write("[WARN] No target dates found in ohlcv_daily for the given rule/range.")
            return 1

        for idx, target_date in enumerate(dates, start=1):
            try:
                result = build_snapshot_for_date(
                    conn=conn,
                    target_date=target_date,
                    rebuild=args.rebuild,
                )
                conn.commit()
                success_count += 1
                log_write(
                    f"[INFO] {idx}/{total_dates} {target_date} "
                    f"stocks={result['total_stocks']} vcp={result['vcp_count']} "
                    f"rotation={result['rotation_count']} gate={result['gate_score']}"
                )
            except Exception as e:
                conn.rollback()
                msg = f"{type(e).__name__}: {e}"
                failed_dates.append((target_date, msg))
                log_write(f"[ERROR] {idx}/{total_dates} {target_date} => {msg}")

            if idx % args.batch_size == 0 or idx == total_dates:
                log_write(
                    f"[PROGRESS] {idx}/{total_dates} completed "
                    f"(success={success_count}, failed={len(failed_dates)})"
                )

        log_write("------------------------------------------------------------")
        log_write(f"[INFO] Success dates: {success_count}")
        log_write(f"[INFO] Failed dates: {len(failed_dates)}")
        if failed_dates:
            for d, msg in failed_dates:
                log_write(f" - {d}: {msg}")

        log_write("------------------------------------------------------------")
        run_verification_queries(conn, log_write)
        log_write("============================================================")
        if failed_dates:
            log_write("[FAIL] Completed with partial failures.")
            return 1

        log_write("[OK] Completed without failures.")
        return 0
    except Exception as e:
        log_write(f"[FATAL] build_daily_snapshots_range failed: {type(e).__name__}: {e}")
        log_write(traceback.format_exc())
        return 1
    finally:
        conn.close()
        lf.close()


if __name__ == "__main__":
    raise SystemExit(main())
