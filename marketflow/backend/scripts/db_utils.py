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
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_BACKEND_DIR_STR = str(_BACKEND_DIR)
if _BACKEND_DIR_STR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR_STR)

from services.data_contract import (
    backend_dir as contract_backend_dir,
    core_db_path as contract_core_db_path,
    data_mode as contract_data_mode,
    engine_db_path as contract_engine_db_path,
    live_db_path as contract_live_db_path,
    snapshot_db_path as contract_snapshot_db_path,
)


def scripts_dir() -> Path:
    return Path(__file__).resolve().parent


def backend_dir() -> Path:
    return contract_backend_dir()


def repo_root() -> Path:
    return backend_dir().parent


def core_db_path() -> str:
    return str(contract_core_db_path())


def engine_db_path() -> str:
    return str(contract_engine_db_path())


def live_db_path() -> str:
    return str(contract_live_db_path())


def snapshot_db_path(name: str = "playback") -> str:
    return str(contract_snapshot_db_path(name))


def data_mode() -> str:
    return contract_data_mode()


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
    data_plane: str | None = None,
    snapshot_name: str = "playback",
) -> str:
    """
    Resolve the active marketflow DB path.

    Canonical source is the live DB under repo/data/.
    Snapshot/backtest callers should request the snapshot plane explicitly.
    Any non-snapshot plane resolves to live first.
    """
    requested_plane = (data_plane or data_mode() or "live").strip().lower()
    core = core_db_path()
    snapshot = snapshot_db_path(snapshot_name)

    if requested_plane in {"snapshot", "playback", "backtest"}:
        candidates = [snapshot, core]
    else:
        candidates = [core, snapshot]

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
