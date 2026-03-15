from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.services.cache_store import resolve_db_path


def _query_one(cur, sql: str, params=()):
    row = cur.execute(sql, params).fetchone()
    if not row:
        return None
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, row))


def print_symbol(cur, symbol: str) -> None:
    meta = _query_one(
        cur,
        """
        SELECT symbol, source, unit, freq, last_updated, quality, notes
        FROM series_meta
        WHERE symbol = ?
        """,
        (symbol,),
    )
    rows = _query_one(cur, "SELECT COUNT(*) AS rows FROM series_data WHERE symbol = ?", (symbol,))
    last = _query_one(
        cur,
        """
        SELECT date, value, source, asof, quality
        FROM series_data
        WHERE symbol = ?
        ORDER BY date DESC
        LIMIT 1
        """,
        (symbol,),
    )
    print(f"{symbol} meta={json.dumps(meta, ensure_ascii=False)} rows={(rows or {}).get('rows', 0)} last={json.dumps(last, ensure_ascii=False)}")


def main() -> None:
    db_path = Path(resolve_db_path())
    print(f"CACHE_DB_PATH={db_path}")
    if not db_path.exists():
        print("DB_EXISTS=False")
        return
    print(f"DB_EXISTS=True SIZE={db_path.stat().st_size}")

    import sqlite3

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    for symbol in ("HY_OAS", "VIX", "PUT_CALL"):
        print_symbol(cur, symbol)
    conn.close()


if __name__ == "__main__":
    main()
