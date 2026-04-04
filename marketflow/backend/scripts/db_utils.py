"""
Shared SQLite connection and DB path helpers.

Opens a connection with performance + safety PRAGMAs:

  journal_mode = WAL      -- writer does not block readers (persistent on DB file)
  synchronous  = NORMAL   -- crash-safe, faster than FULL
  cache_size   = -32000   -- 32 MB page cache per connection (negative = KiB)
  temp_store   = MEMORY   -- temp tables / sort buffers stay in RAM
  foreign_keys = ON       -- enforce FK constraints

WAL is a DB-level persistent setting; once set by any connection it stays
enabled for all future connections to the same file.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path


def scripts_dir() -> Path:
    return Path(__file__).resolve().parent


def backend_dir() -> Path:
    return scripts_dir().parent


def repo_root() -> Path:
    return backend_dir().parent


def core_db_path() -> str:
    return str((repo_root() / "data" / "marketflow.db").resolve())


def engine_db_path() -> str:
    return str((backend_dir() / "data" / "marketflow.db").resolve())


def daily_data_root() -> str:
    """
    Resolve the local Daily_data folder used for Spooq backfills.

    Prefers MARKETFLOW_DAILY_DATA_DIR when set, then the sibling us_stock_db
    folder beside this repo.
    """
    env = os.environ.get("MARKETFLOW_DAILY_DATA_DIR", "").strip()
    if env:
        path = Path(env).expanduser()
        if path.exists():
            return str(path.resolve())

    candidates = [
        repo_root().parent.parent / "us_stock_db" / "Daily_data",
        repo_root().parent.parent / "us_stock_db" / "daily_data",
        repo_root().parent / "us_stock_db" / "Daily_data",
        repo_root().parent / "us_stock_db" / "daily_data",
        repo_root() / "us_stock_db" / "Daily_data",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate.resolve())
    return str(candidates[0].resolve())


def canonical_symbol(symbol: str) -> str:
    """
    Normalize a ticker to the DB's canonical symbol format.

    DB rows should store base tickers such as AAPL, BRK.B, SPY.
    External feed suffixes like ".us" are stripped, and hyphenated
    feed variants are mapped back to dotted tickers.
    """
    cleaned = symbol.strip().upper().replace("-", ".")
    if cleaned.endswith(".US"):
        cleaned = cleaned[:-3]
    return cleaned


def _db_has_tables(path: str, table_names: tuple[str, ...]) -> bool:
    if not Path(path).exists():
        return False
    try:
        conn = sqlite3.connect(path)
        try:
            placeholders = ", ".join(["?"] * len(table_names))
            rows = conn.execute(
                f"""
                SELECT name
                FROM sqlite_master
                WHERE type = 'table' AND name IN ({placeholders})
                """,
                table_names,
            ).fetchall()
            return len(rows) == len(table_names)
        finally:
            conn.close()
    except Exception:
        return False


def resolve_marketflow_db(
    required_tables: tuple[str, ...] = (),
    *,
    prefer_engine: bool = False,
) -> str:
    """
    Resolve the active marketflow DB path.

    Core analysis / VR engines should usually use the main DB under data/.
    Backtest / risk engines should pass prefer_engine=True so they use the
    dedicated backend/data/marketflow.db mirror when it is ready.
    """
    engine = engine_db_path()
    core = core_db_path()
    candidates = [engine, core] if prefer_engine else [core, engine]
    for path in candidates:
        if not Path(path).exists():
            continue
        if required_tables and not _db_has_tables(path, required_tables):
            continue
        return str(Path(path).resolve())
    return str(Path(candidates[0]).resolve())


def db_connect(path: str, *, row_factory: bool = False) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    if row_factory:
        conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA cache_size = -32000;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn
