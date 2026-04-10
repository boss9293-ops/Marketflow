"""
build_navigator_full_snapshots.py
Builds longer-horizon snapshot series for Navigator percentile calc.

Outputs:
  backend/output/snapshots_full_5y.json
  backend/output/snapshots_full_2y.json
"""
import os
import json
import sqlite3
import datetime
import sys

from db_utils import resolve_marketflow_db


_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPTS_DIR)
OUT_DIR = os.path.join(_BACKEND_DIR, 'output')
DB_PATH = resolve_marketflow_db(
    required_tables=("ohlcv_daily", "indicators_daily"),
    data_plane="live",
)


QUERY = """
SELECT
  o.date,
  o.close AS qqq_close,
  i.sma200 AS qqq_sma200
FROM ohlcv_daily o
LEFT JOIN indicators_daily i
  ON i.symbol = o.symbol AND i.date = o.date
WHERE o.symbol = 'QQQ'
  AND o.date >= ?
ORDER BY o.date ASC
"""


def build_window(conn: sqlite3.Connection, years: int, out_name: str):
    today = datetime.date.today()
    cutoff = today.replace(year=today.year - years)
    cur = conn.cursor()
    cur.execute(QUERY, (cutoff.isoformat(),))
    rows = cur.fetchall()
    if not rows:
        print(f"[WARN] No rows for {years}y window")
        return False

    snapshots = []
    for row in rows:
        date, close, sma200 = row
        snapshots.append({
            'date': date,
            'qqq_close': round(float(close), 4) if close is not None else None,
            'qqq_sma200': round(float(sma200), 4) if sma200 is not None else None,
        })

    result = {
        'generated_at': datetime.datetime.now().isoformat(timespec='seconds'),
        'count': len(snapshots),
        'window_years': years,
        'snapshots': snapshots,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, out_name)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[OK] {out_name} -> {out_path} (rows={len(snapshots)})")
    return True


def main():
    print("[build_navigator_full_snapshots] Connecting to DB...")
    print(f"  BASE: {_BACKEND_DIR}")
    print(f"  DB:   {DB_PATH}")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
    except Exception as e:
        print(f"[ERROR] DB connect failed: {e}")
        sys.exit(1)

    ok5 = False
    ok2 = False
    try:
        ok5 = build_window(conn, 5, 'snapshots_full_5y.json')
    except Exception as e:
        print(f"[ERROR] 5y build failed: {e}")

    try:
        ok2 = build_window(conn, 2, 'snapshots_full_2y.json')
    except Exception as e:
        print(f"[ERROR] 2y build failed: {e}")

    conn.close()
    if not ok5 and not ok2:
        sys.exit(1)


if __name__ == '__main__':
    main()
