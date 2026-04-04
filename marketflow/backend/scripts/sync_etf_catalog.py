from __future__ import annotations

import argparse
import os
from datetime import datetime
from pathlib import Path
from typing import Iterable

from db_utils import core_db_path, db_connect
from symbol_registry import (
    build_etf_catalog_rows,
    get_etf_display_name,
    resolve_requested_symbols,
)


def ensure_tables(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS etf_catalog (
            symbol TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            category TEXT NOT NULL,
            subcategory TEXT,
            strategy_tier TEXT NOT NULL,
            direction TEXT NOT NULL DEFAULT 'long',
            leverage_factor REAL,
            priority INTEGER NOT NULL DEFAULT 100,
            source TEXT NOT NULL DEFAULT 'manual',
            notes TEXT,
            last_updated TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_etf_catalog_category ON etf_catalog(category, priority, symbol)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_etf_catalog_strategy_tier ON etf_catalog(strategy_tier, priority, symbol)"
    )


def _category_label(category: str) -> str:
    return category.replace("_", " ").title()


def upsert_catalog(conn, rows, *, now_iso: str) -> None:
    for row in rows:
        conn.execute(
            """
            INSERT INTO etf_catalog (
                symbol, display_name, category, subcategory, strategy_tier,
                direction, leverage_factor, priority, source, notes, last_updated, is_active
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
            )
            ON CONFLICT(symbol) DO UPDATE SET
                display_name=excluded.display_name,
                category=excluded.category,
                subcategory=excluded.subcategory,
                strategy_tier=excluded.strategy_tier,
                direction=excluded.direction,
                leverage_factor=excluded.leverage_factor,
                priority=excluded.priority,
                source=excluded.source,
                notes=excluded.notes,
                last_updated=excluded.last_updated,
                is_active=1
            """,
            (
                row.symbol,
                row.display_name,
                row.category,
                row.subcategory,
                row.strategy_tier,
                row.direction,
                row.leverage_factor,
                row.priority,
                row.source,
                row.notes,
                now_iso,
            ),
        )


def upsert_universe(conn, rows, *, now_iso: str) -> None:
    for row in rows:
        conn.execute(
            """
            INSERT INTO universe_symbols (
                symbol, name, sector, industry, exchange, market_cap,
                is_active, is_top100, last_updated
            ) VALUES (
                ?, ?, ?, ?, ?, NULL, 1, 0, ?
            )
            ON CONFLICT(symbol) DO UPDATE SET
                name=excluded.name,
                sector=excluded.sector,
                industry=excluded.industry,
                exchange=excluded.exchange,
                is_active=1,
                is_top100=0,
                last_updated=excluded.last_updated
            """,
            (
                row.symbol,
                row.display_name,
                _category_label(row.category),
                row.subcategory.replace("_", " ").title() if row.subcategory else row.strategy_tier.replace("_", " ").title(),
                "NYSEARCA",
                now_iso,
            ),
        )


def resolve_rows(categories: list[str] | None, symbols: list[str] | None):
    selected = set()
    if categories:
        selected.update(resolve_requested_symbols(categories))
    if symbols:
        selected.update(resolve_requested_symbols(symbols))
    if not selected:
        selected.update(resolve_requested_symbols(None))

    rows = build_etf_catalog_rows()
    return [row for row in rows if row.symbol in selected]


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync ETF catalog and universe metadata into marketflow.db")
    parser.add_argument("--db-path", default=core_db_path(), help="SQLite DB path (default: core marketflow.db)")
    parser.add_argument("--categories", nargs="*", default=None, help="ETF catalog categories or room sections to sync")
    parser.add_argument("--symbols", nargs="*", default=None, help="Explicit ETF symbols to sync")
    parser.add_argument("--dry-run", action="store_true", help="Print counts without writing")
    parser.add_argument("--list-only", action="store_true", help="List resolved symbols and exit")
    args = parser.parse_args()

    db_path = str(Path(args.db_path).expanduser().resolve())
    if not os.path.exists(db_path):
        print(f"[ERROR] DB not found: {db_path}")
        return 1

    rows = resolve_rows(args.categories, args.symbols)
    if args.list_only:
        print(f"[INFO] ETF symbols resolved: {len(rows)}")
        for row in rows:
            print(f" - {row.symbol:8} | {row.category:12} | {row.display_name}")
        return 0

    conn = db_connect(db_path)
    try:
        ensure_tables(conn)
        now_iso = datetime.now().isoformat(timespec="seconds")

        if args.dry_run:
            print(f"[DRY RUN] db={db_path}")
            print(f"[DRY RUN] resolved ETF rows={len(rows)}")
            return 0

        upsert_catalog(conn, rows, now_iso=now_iso)
        upsert_universe(conn, rows, now_iso=now_iso)
        conn.commit()

        universe_count = conn.execute("SELECT COUNT(*) FROM universe_symbols").fetchone()[0]
        catalog_count = conn.execute("SELECT COUNT(*) FROM etf_catalog").fetchone()[0]
        print(f"[OK] ETF catalog rows upserted: {len(rows)}")
        print(f"[OK] etf_catalog={catalog_count} universe_symbols={universe_count}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

