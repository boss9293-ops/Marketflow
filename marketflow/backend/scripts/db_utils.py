"""
Shared SQLite connection helper.

Opens a connection with performance + safety PRAGMAs:

  journal_mode = WAL      — writer doesn't block readers (persistent on DB file)
  synchronous  = NORMAL   — crash-safe, faster than FULL
  cache_size   = -32000   — 32 MB page cache per connection (negative = KiB)
  temp_store   = MEMORY   — temp tables / sort buffers stay in RAM
  foreign_keys = ON       — enforce FK constraints

WAL is a DB-level persistent setting; once set by any connection it stays
enabled for all future connections to the same file.
"""
from __future__ import annotations

import sqlite3


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
