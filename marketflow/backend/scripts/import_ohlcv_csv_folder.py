from __future__ import annotations

import argparse
import csv
import os
import sqlite3
from datetime import datetime
from typing import Iterable, Tuple


def repo_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, '..', '..'))


def db_path() -> str:
    return os.path.join(repo_root(), 'data', 'marketflow.db')


def parse_symbol_from_filename(path: str) -> str:
    base = os.path.basename(path)
    name = os.path.splitext(base)[0]
    symbol = name.split('_')[0].strip()
    return symbol.upper()


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_int(value: str | None) -> int | None:
    f = parse_float(value)
    if f is None:
        return None
    return int(round(f))


def normalize_date(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    # Expect YYYY-MM-DD
    if len(value) >= 10:
        return value[:10]
    return value


def iter_rows(csv_path: str) -> Iterable[Tuple]:
    with open(csv_path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return
        fields = {name.lower().strip(): name for name in reader.fieldnames}
        date_col = fields.get('date')
        open_col = fields.get('open')
        high_col = fields.get('high')
        low_col = fields.get('low')
        close_col = fields.get('close')
        adj_col = fields.get('adj close') or fields.get('adj_close') or fields.get('adjclose')
        vol_col = fields.get('volume')
        for row in reader:
            date = normalize_date(row.get(date_col) if date_col else None)
            if not date:
                continue
            open_v = parse_float(row.get(open_col) if open_col else None)
            high_v = parse_float(row.get(high_col) if high_col else None)
            low_v = parse_float(row.get(low_col) if low_col else None)
            close_v = parse_float(row.get(close_col) if close_col else None)
            adj_v = parse_float(row.get(adj_col) if adj_col else None)
            vol_v = parse_int(row.get(vol_col) if vol_col else None)
            yield (date, open_v, high_v, low_v, close_v, adj_v, vol_v)


def ensure_symbol(conn: sqlite3.Connection, symbol: str) -> None:
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    conn.execute(
        """
        INSERT OR IGNORE INTO universe_symbols (symbol, name, sector, industry, exchange, market_cap, is_active, is_top100, last_updated)
        VALUES (?, ?, NULL, NULL, 'US', NULL, 1, 0, ?)
        """,
        (symbol, symbol, now),
    )


def upsert_ohlcv(conn: sqlite3.Connection, symbol: str, rows: Iterable[Tuple], source: str) -> int:
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    data = []
    for date, open_v, high_v, low_v, close_v, adj_v, vol_v in rows:
        if adj_v is None:
            adj_v = close_v
        data.append((symbol, date, open_v, high_v, low_v, close_v, adj_v, vol_v, source, now))
    if not data:
        return 0
    conn.executemany(
        """
        INSERT INTO ohlcv_daily (symbol, date, open, high, low, close, adj_close, volume, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, date) DO UPDATE SET
            open=excluded.open,
            high=excluded.high,
            low=excluded.low,
            close=excluded.close,
            adj_close=excluded.adj_close,
            volume=excluded.volume,
            source=excluded.source,
            updated_at=excluded.updated_at
        """,
        data,
    )
    return len(data)


def main() -> int:
    p = argparse.ArgumentParser(description='Import OHLCV CSV files into marketflow.db')
    p.add_argument('--csv-dir', required=True, help='Folder containing CSV files')
    p.add_argument('--source', default='csv_import', help='Source tag for rows')
    p.add_argument('--dry-run', action='store_true', help='Parse files without DB writes')
    args = p.parse_args()

    csv_dir = os.path.abspath(args.csv_dir)
    if not os.path.isdir(csv_dir):
        print(f'[FAIL] CSV directory not found: {csv_dir}')
        return 1

    files = [os.path.join(csv_dir, f) for f in os.listdir(csv_dir) if f.lower().endswith('.csv')]
    if not files:
        print(f'[FAIL] No CSV files found in: {csv_dir}')
        return 1

    db = db_path()
    if not os.path.exists(db):
        print(f'[FAIL] DB not found: {db}')
        return 1

    total = 0
    conn = sqlite3.connect(db)
    try:
        if not args.dry_run:
            conn.execute('PRAGMA foreign_keys = ON')
        for csv_path in sorted(files):
            symbol = parse_symbol_from_filename(csv_path)
            rows = list(iter_rows(csv_path))
            if args.dry_run:
                print(f'[DRY] {os.path.basename(csv_path)} -> {symbol} rows={len(rows)}')
                total += len(rows)
                continue
            ensure_symbol(conn, symbol)
            inserted = upsert_ohlcv(conn, symbol, rows, args.source)
            total += inserted
            print(f'[OK] {os.path.basename(csv_path)} -> {symbol} rows={inserted}')
        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    print(f'[DONE] total rows processed: {total}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
