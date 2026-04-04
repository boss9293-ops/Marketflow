#!/usr/bin/env python3
"""
Upload Spooq Daily_data folder into marketflow.db using canonical DB symbols.

The folder files keep the external feed format like aapl.us.txt and row symbols
like AAPL.US. This loader normalizes both the filename and row symbol to the
DB's canonical ticker format before writing to SQLite.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

from db_utils import canonical_symbol, core_db_path, db_connect


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
    number = parse_float(value)
    if number is None:
        return None
    return int(round(number))


def iter_source_files(source_dir: Path) -> Iterator[Path]:
    for path in sorted(source_dir.rglob("*.txt")):
        if path.is_file():
            yield path


def parse_spooq_line(line: str) -> Optional[Tuple[str, str, float | None, float | None, float | None, float | None, float | None, int | None]]:
    """
    Parse a Spooq daily row:
    SYMBOL,PER,YYYYMMDD,000000,OPEN,HIGH,LOW,CLOSE,VOLUME,OPENINT
    """
    parts = line.strip().split(",")
    if len(parts) < 9:
        return None

    try:
        symbol = canonical_symbol(parts[0])
        date = parts[2].strip()
        if len(date) != 8 or not date.isdigit():
            return None
        date_formatted = f"{date[:4]}-{date[4:6]}-{date[6:8]}"
        open_price = parse_float(parts[4])
        high = parse_float(parts[5])
        low = parse_float(parts[6])
        close = parse_float(parts[7])
        volume = parse_int(parts[8])
        if close is None:
            return None
        return (
            symbol,
            date_formatted,
            open_price,
            high,
            low,
            close,
            close,
            volume,
        )
    except Exception:
        return None


def ensure_symbol(conn: sqlite3.Connection, symbol: str, now_iso: str) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO universe_symbols
          (symbol, name, sector, industry, exchange, market_cap, is_active, is_top100, last_updated)
        VALUES (?, ?, NULL, NULL, NULL, NULL, 1, 0, ?)
        """,
        (symbol, symbol, now_iso),
    )


def upsert_file(conn: sqlite3.Connection, file_path: Path, now_iso: str) -> Tuple[int, int]:
    symbol = canonical_symbol(file_path.stem)
    ensure_symbol(conn, symbol, now_iso)

    rows: List[Tuple] = []
    bad_rows = 0
    with file_path.open("r", encoding="utf-8", errors="ignore") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("<"):
                continue
            parsed = parse_spooq_line(line)
            if parsed is None:
                bad_rows += 1
                continue
            row_symbol, date, open_price, high, low, close, adj_close, volume = parsed
            # Use the file-derived canonical symbol as the DB key.
            rows.append(
                (
                    symbol if row_symbol == symbol else symbol,
                    date,
                    open_price,
                    high,
                    low,
                    close,
                    adj_close,
                    volume,
                    "spooq",
                    now_iso,
                )
            )

    if rows:
        conn.executemany(
            """
            INSERT OR REPLACE INTO ohlcv_daily
              (symbol, date, open, high, low, close, adj_close, volume, source, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )

    return len(rows), bad_rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload Spooq Daily_data folder into marketflow.db")
    parser.add_argument("source_dir", help="Path to Daily_data folder")
    parser.add_argument("--db-path", default=core_db_path(), help="SQLite DB path (default: core marketflow.db)")
    parser.add_argument("--dry-run", action="store_true", help="Scan files and report counts without writing")
    parser.add_argument("--limit-files", type=int, default=None, help="Only process the first N files")
    parser.add_argument("--symbols", nargs="*", default=None, help="Only process these canonical symbols")
    args = parser.parse_args()

    source_dir = Path(args.source_dir).expanduser().resolve()
    if not source_dir.exists() or not source_dir.is_dir():
        print(f"[ERROR] Source folder not found: {source_dir}")
        return 1

    db_path = str(Path(args.db_path).expanduser().resolve())
    if not os.path.exists(db_path):
        print(f"[ERROR] DB not found: {db_path}")
        return 1

    files = list(iter_source_files(source_dir))
    if args.limit_files is not None and args.limit_files > 0:
        files = files[: args.limit_files]
    if args.symbols:
        wanted = {canonical_symbol(s).upper() for s in args.symbols}
        files = [p for p in files if canonical_symbol(p.stem).upper() in wanted]
    if not files:
        print(f"[ERROR] No .txt files found in: {source_dir}")
        return 1

    conn = db_connect(db_path)
    total_rows = 0
    total_bad_rows = 0
    try:
        if args.dry_run:
            print(f"[DRY RUN] source_dir={source_dir}")
            print(f"[DRY RUN] files={len(files)}")
        else:
            conn.execute("PRAGMA foreign_keys = ON")

        for idx, file_path in enumerate(files, start=1):
            if idx % 100 == 0:
                print(f"[INFO] {idx}/{len(files)} files...")
            rows_count, bad_rows = upsert_file(conn, file_path, datetime.now().isoformat(timespec="seconds"))
            total_rows += rows_count
            total_bad_rows += bad_rows
            if args.dry_run:
                continue
            if rows_count == 0 and bad_rows == 0:
                print(f"[WARN] {file_path.name}: no usable rows")

        if not args.dry_run:
            conn.commit()

        print(f"[DONE] files={len(files)} rows={total_rows} bad_rows={total_bad_rows}")
        if not args.dry_run:
            universe_count = conn.execute("SELECT COUNT(*) FROM universe_symbols").fetchone()[0]
            ohlcv_count = conn.execute("SELECT COUNT(*) FROM ohlcv_daily").fetchone()[0]
            print(f"[DB] universe_symbols={universe_count}")
            print(f"[DB] ohlcv_daily={ohlcv_count}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
