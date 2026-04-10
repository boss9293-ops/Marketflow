#!/usr/bin/env python3
"""
1. Add NASDAQ-100 + S&P500 Top200 to universe_symbols in CORE DB
2. Sync runtime DB from CORE DB
"""

import sqlite3
import os
import shutil
from datetime import datetime

from db_utils import canonical_symbol, core_db_path, engine_db_path
from symbol_registry import MAJOR_ETFS, get_etf_display_name, standard_universe_symbols

# ============================================================================
# SYMBOL LISTS
# ============================================================================


# ============================================================================
# STEP 1: Update universe_symbols in CORE DB
# ============================================================================

def update_universe_symbols(db_path):
    """Add the standard universe to universe_symbols."""

    print(f"[STEP 1] Updating universe_symbols in CORE DB")
    print(f"Path: {db_path}\n")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    conn.execute("PRAGMA foreign_keys = ON")

    normalize_legacy_symbols(conn)

    # Get existing symbols
    cursor.execute("SELECT symbol FROM universe_symbols")
    existing = set(row[0] for row in cursor.fetchall())

    print(f"Current symbols: {len(existing)}")

    standard_symbols = {canonical_symbol(s) for s in standard_universe_symbols()}
    etf_symbols = {canonical_symbol(s) for s in MAJOR_ETFS}
    new_symbols = standard_symbols - existing

    print(f"Standard universe new: {len(new_symbols)}")

    # Insert new symbols (use INSERT OR IGNORE for duplicates)
    timestamp = datetime.now().isoformat()

    for symbol in sorted(new_symbols):
        is_etf = symbol in etf_symbols
        cursor.execute("""
            INSERT OR IGNORE INTO universe_symbols
            (symbol, name, sector, is_active, is_top100, last_updated)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            symbol,
            get_etf_display_name(symbol) if is_etf else symbol.upper(),
            'ETF' if is_etf else 'Equity',
            1,
            0 if is_etf else 1,
            timestamp,
        ))

    conn.commit()

    # Verify
    cursor.execute("SELECT COUNT(*) FROM universe_symbols")
    new_count = cursor.fetchone()[0]
    conn.close()

    print(f"\nResult: {len(existing)} -> {new_count} symbols")
    print(f"  Added: {len(new_symbols)} symbols")
    return True


# ============================================================================
# STEP 1b: Normalize legacy .us rows in CORE DB
# ============================================================================

def normalize_legacy_symbols(conn: sqlite3.Connection):
    """Fold legacy .us symbols back into canonical DB symbols."""

    conn.row_factory = sqlite3.Row
    conn.create_function("canonical_symbol", 1, canonical_symbol)
    conn.execute("PRAGMA foreign_keys = OFF")

    try:
        alias_rows = conn.execute(
            """
            SELECT symbol, name, sector, industry, exchange, market_cap,
                   is_active, is_top100, last_updated
            FROM universe_symbols
            WHERE LOWER(symbol) LIKE '%.us'
            """,
        ).fetchall()

        if alias_rows:
            print(f"[STEP 1b] Normalizing {len(alias_rows)} legacy universe rows")

        for row in alias_rows:
            stored = row["symbol"]
            canonical = canonical_symbol(stored)
            base = conn.execute(
                """
                SELECT symbol, name, sector, industry, exchange, market_cap,
                       is_active, is_top100, last_updated
                FROM universe_symbols
                WHERE symbol = ?
                """,
                (canonical,),
            ).fetchone()

            if base:
                updates = []
                params = []

                if int(row["is_active"] or 0) and not int(base["is_active"] or 0):
                    updates.append("is_active = 1")
                if int(row["is_top100"] or 0) and not int(base["is_top100"] or 0):
                    updates.append("is_top100 = 1")

                if row["last_updated"] and (
                    not base["last_updated"] or row["last_updated"] > base["last_updated"]
                ):
                    updates.append("last_updated = ?")
                    params.append(row["last_updated"])

                for col in ("name", "sector", "industry", "exchange"):
                    if (base[col] is None or str(base[col]).strip() == "") and row[col]:
                        updates.append(f"{col} = ?")
                        params.append(row[col])

                if base["market_cap"] is None and row["market_cap"] is not None:
                    updates.append("market_cap = ?")
                    params.append(row["market_cap"])

                if updates:
                    conn.execute(
                        f"UPDATE universe_symbols SET {', '.join(updates)} WHERE symbol = ?",
                        (*params, canonical),
                    )

                conn.execute("DELETE FROM universe_symbols WHERE symbol = ?", (stored,))
            else:
                name = row["name"]
                if not name or str(name).strip().upper() == stored.strip().upper():
                    name = canonical

                conn.execute(
                    """
                    UPDATE universe_symbols
                    SET symbol = ?, name = ?, last_updated = COALESCE(last_updated, ?)
                    WHERE symbol = ?
                    """,
                    (canonical, name, row["last_updated"], stored),
                )

        conn.execute(
            """
            INSERT OR IGNORE INTO ohlcv_daily
            (symbol, date, open, high, low, close, adj_close, volume, source, updated_at)
            SELECT canonical_symbol(symbol), date, open, high, low, close, adj_close, volume, source, updated_at
            FROM ohlcv_daily
            WHERE LOWER(symbol) LIKE '%.us'
            """
        )
        conn.execute("DELETE FROM ohlcv_daily WHERE LOWER(symbol) LIKE '%.us'")
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


# ============================================================================
# STEP 2: Sync runtime DB from CORE DB
# ============================================================================

def sync_runtime_db(core_db_path, runtime_db_path):
    """Sync runtime DB from CORE DB."""

    print(f"\n[STEP 2] Syncing runtime DB from CORE DB")
    print(f"Core:   {core_db_path}")
    print(f"Target: {runtime_db_path}\n")

    if os.path.abspath(core_db_path) == os.path.abspath(runtime_db_path):
        print("  Skipped: runtime path now aliases core DB; no copy needed.")
        return True

    core_conn = sqlite3.connect(core_db_path)
    try:
        # Flush WAL content into the main database file before copying.
        core_conn.execute("PRAGMA wal_checkpoint(FULL)")
        core_conn.commit()
    finally:
        core_conn.close()

    shutil.copy2(core_db_path, runtime_db_path)
    runtime_size_mb = os.path.getsize(runtime_db_path) / (1024 * 1024)
    print(f"  COPIED core DB -> runtime DB ({runtime_size_mb:.1f}MB)")
    return True


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    core_db = core_db_path()
    runtime_db = engine_db_path()

    print("=" * 80)
    print("[SYNC PROCEDURE: Add universe_symbols + Sync runtime DB]")
    print("=" * 80)

    # Check files exist
    if not os.path.exists(core_db):
        print(f"ERROR: Core DB not found: {core_db}")
        exit(1)

    if not os.path.exists(runtime_db):
        print(f"ERROR: Runtime DB not found: {runtime_db}")
        exit(1)

    # Step 1: Update universe_symbols
    try:
        update_universe_symbols(core_db)
    except Exception as e:
        print(f"ERROR in Step 1: {e}")
        exit(1)

    # Step 2: Sync mirror DB
    try:
        sync_runtime_db(core_db, runtime_db)
    except Exception as e:
        print(f"ERROR in Step 2: {e}")
        exit(1)

    print(f"\n{'='*80}")
    print("[SUCCESS] All steps completed!")
    print(f"{'='*80}")
    print(f"Next: Run indicators rebuild and restart frontend")
