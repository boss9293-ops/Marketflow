from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from typing import Dict, Optional

import pandas as pd


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(_repo_root(), "data", "marketflow.db")


def _now_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS series_data (
          symbol TEXT NOT NULL,
          date TEXT NOT NULL,
          value REAL,
          source TEXT,
          asof TEXT,
          quality TEXT,
          PRIMARY KEY (symbol, date)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_series_data_symbol_date ON series_data(symbol, date)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS series_meta (
          symbol TEXT PRIMARY KEY,
          source TEXT,
          unit TEXT,
          freq TEXT,
          last_updated TEXT,
          quality TEXT,
          notes TEXT
        )
        """
    )
    conn.commit()


def upsert_series(conn: sqlite3.Connection, symbol: str, series: pd.Series, source: str, quality: str = "OK") -> int:
    if series is None or series.empty:
        return 0
    rows = []
    asof = _now_iso()
    s = series.dropna().copy()
    for idx, val in s.items():
        dt = pd.to_datetime(idx).strftime("%Y-%m-%d")
        rows.append((symbol, dt, float(val), source, asof, quality))
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO series_data(symbol, date, value, source, asof, quality)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(symbol, date) DO UPDATE SET
          value=excluded.value,
          source=excluded.source,
          asof=excluded.asof,
          quality=excluded.quality
        """,
        rows,
    )
    conn.execute(
        """
        INSERT INTO series_meta(symbol, source, unit, freq, last_updated, quality, notes)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(symbol) DO UPDATE SET
          source=excluded.source,
          unit=excluded.unit,
          freq=excluded.freq,
          last_updated=excluded.last_updated,
          quality=excluded.quality,
          notes=excluded.notes
        """,
        (symbol, source, "", "", asof, quality, ""),
    )
    conn.commit()
    return len(rows)


def load_series_frame(conn: sqlite3.Connection, symbols: list[str], start: str, end: str) -> pd.DataFrame:
    if not symbols:
        return pd.DataFrame()
    placeholders = ",".join("?" for _ in symbols)
    sql = f"""
      SELECT symbol, date, value
      FROM series_data
      WHERE symbol IN ({placeholders})
        AND date >= ?
        AND date <= ?
      ORDER BY date ASC
    """
    rows = conn.execute(sql, [*symbols, start, end]).fetchall()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["symbol", "date", "value"])
    pivot = df.pivot(index="date", columns="symbol", values="value")
    pivot.index = pd.to_datetime(pivot.index)
    pivot = pivot.sort_index()
    return pivot
