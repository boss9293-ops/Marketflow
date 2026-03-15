from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import pandas as pd
except Exception:  # pragma: no cover
    pd = None  # type: ignore[assignment]


def _project_root() -> Path:
    # backend/services/cache_store.py -> marketflow/
    return Path(__file__).resolve().parents[2]


def resolve_db_path(db_path: Optional[str] = None) -> str:
    if db_path:
        return str(Path(db_path).expanduser().resolve())
    env_path = os.getenv("CACHE_DB_PATH")
    if env_path:
        return str(Path(env_path).expanduser().resolve())
    return str((_project_root() / "data" / "cache.db").resolve())


DEFAULT_DB_PATH = resolve_db_path()


@dataclass(frozen=True)
class SeriesPoint:
    symbol: str
    date: str
    value: float
    source: str
    asof: str
    quality: str


class CacheStore:
    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = resolve_db_path(db_path)
        d = os.path.dirname(self.db_path)
        if d:
            os.makedirs(d, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row

    @property
    def conn(self) -> sqlite3.Connection:
        return self._conn

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass

    def init_schema(self) -> None:
        cur = self._conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS series_data (
              symbol TEXT NOT NULL,
              date   TEXT NOT NULL,
              value  REAL NOT NULL,
              source TEXT NOT NULL,
              asof   TEXT NOT NULL,
              quality TEXT NOT NULL,
              PRIMARY KEY(symbol, date)
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_series_data_symbol_date ON series_data(symbol, date);")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS series_meta (
              symbol TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              unit   TEXT NOT NULL,
              freq   TEXT NOT NULL,
              last_updated TEXT NOT NULL,
              quality TEXT NOT NULL,
              notes  TEXT
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
              snapshot_type TEXT NOT NULL,
              asof TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              PRIMARY KEY(snapshot_type, asof)
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_type_asof ON snapshots(snapshot_type, asof);")
        self._conn.commit()

    def upsert_series_points(self, points: Iterable[SeriesPoint]) -> int:
        cur = self._conn.cursor()
        rows = 0
        for p in points:
            cur.execute(
                """
                INSERT INTO series_data(symbol,date,value,source,asof,quality)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(symbol,date) DO UPDATE SET
                  value=excluded.value,
                  source=excluded.source,
                  asof=excluded.asof,
                  quality=excluded.quality;
                """,
                (p.symbol, p.date, float(p.value), p.source, p.asof, p.quality),
            )
            rows += 1
        self._conn.commit()
        return rows

    def upsert_series_meta(
        self,
        symbol: str,
        source: str,
        unit: str,
        freq: str,
        last_updated: str,
        quality: str,
        notes: Optional[str] = None,
    ) -> None:
        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT INTO series_meta(symbol,source,unit,freq,last_updated,quality,notes)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(symbol) DO UPDATE SET
              source=excluded.source,
              unit=excluded.unit,
              freq=excluded.freq,
              last_updated=excluded.last_updated,
              quality=excluded.quality,
              notes=excluded.notes;
            """,
            (symbol, source, unit, freq, last_updated, quality, notes),
        )
        self._conn.commit()

    def save_snapshot(self, snapshot_type: str, asof: str, payload: Dict[str, Any]) -> None:
        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT INTO snapshots(snapshot_type, asof, payload_json)
            VALUES(?,?,?)
            ON CONFLICT(snapshot_type, asof) DO UPDATE SET
              payload_json=excluded.payload_json;
            """,
            (snapshot_type, asof, json.dumps(payload, ensure_ascii=False)),
        )
        self._conn.commit()

    def get_latest_point(self, symbol: str) -> Optional[SeriesPoint]:
        cur = self._conn.cursor()
        row = cur.execute(
            """
            SELECT symbol, date, value, source, asof, quality
            FROM series_data
            WHERE symbol=?
            ORDER BY date DESC
            LIMIT 1;
            """,
            (symbol,),
        ).fetchone()
        if not row:
            return None
        return SeriesPoint(
            symbol=row["symbol"],
            date=row["date"],
            value=float(row["value"]),
            source=row["source"],
            asof=row["asof"],
            quality=row["quality"],
        )

    def get_series_range(self, symbol: str, start_date: str, end_date: str) -> List[Tuple[str, float]]:
        cur = self._conn.cursor()
        rows = cur.execute(
            """
            SELECT date, value
            FROM series_data
            WHERE symbol=?
              AND date>=?
              AND date<=?
            ORDER BY date ASC;
            """,
            (symbol, start_date, end_date),
        ).fetchall()
        return [(r["date"], float(r["value"])) for r in rows]

    def get_meta(self, symbol: str) -> Optional[Dict[str, Any]]:
        cur = self._conn.cursor()
        row = cur.execute(
            """
            SELECT symbol, source, unit, freq, last_updated, quality, notes
            FROM series_meta
            WHERE symbol=?;
            """,
            (symbol,),
        ).fetchone()
        return dict(row) if row else None

    def load_latest_snapshot(self, snapshot_type: str) -> Optional[Dict[str, Any]]:
        cur = self._conn.cursor()
        row = cur.execute(
            """
            SELECT payload_json
            FROM snapshots
            WHERE snapshot_type=?
            ORDER BY asof DESC
            LIMIT 1;
            """,
            (snapshot_type,),
        ).fetchone()
        if not row:
            return None
        return json.loads(row["payload_json"])


# ---- compatibility helpers for existing modules ----
def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def get_conn() -> sqlite3.Connection:
    store = CacheStore()
    store.init_schema()
    return store.conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS series_data (
          symbol TEXT NOT NULL,
          date   TEXT NOT NULL,
          value  REAL NOT NULL,
          source TEXT NOT NULL,
          asof   TEXT NOT NULL,
          quality TEXT NOT NULL,
          PRIMARY KEY(symbol, date)
        );
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_series_data_symbol_date ON series_data(symbol, date);")
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS series_meta (
          symbol TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          unit   TEXT NOT NULL,
          freq   TEXT NOT NULL,
          last_updated TEXT NOT NULL,
          quality TEXT NOT NULL,
          notes  TEXT
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
          snapshot_type TEXT NOT NULL,
          asof TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY(snapshot_type, asof)
        );
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_type_asof ON snapshots(snapshot_type, asof);")
    conn.commit()


def upsert_series(conn: sqlite3.Connection, symbol: str, series: Any, source: str, quality: str = "OK", notes: str = "") -> int:
    if pd is None:
        raise RuntimeError("pandas is required for upsert_series()")
    if series is None or series.empty:
        return 0
    rows: list[tuple] = []
    asof = _now_iso()
    for idx, val in series.dropna().items():
        dt = pd.to_datetime(idx).strftime("%Y-%m-%d")
        rows.append((symbol, dt, float(val), source, asof, quality))
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO series_data(symbol,date,value,source,asof,quality)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(symbol,date) DO UPDATE SET
          value=excluded.value,
          source=excluded.source,
          asof=excluded.asof,
          quality=excluded.quality;
        """,
        rows,
    )
    conn.execute(
        """
        INSERT INTO series_meta(symbol,source,unit,freq,last_updated,quality,notes)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(symbol) DO UPDATE SET
          source=excluded.source,
          unit=excluded.unit,
          freq=excluded.freq,
          last_updated=excluded.last_updated,
          quality=excluded.quality,
          notes=excluded.notes;
        """,
        (symbol, source, "", "", asof, quality, notes),
    )
    conn.commit()
    return len(rows)


def load_series_frame(conn: sqlite3.Connection, symbols: Iterable[str], start: str, end: str):
    if pd is None:
        raise RuntimeError("pandas is required for load_series_frame()")
    syms = list(symbols)
    if not syms:
        return pd.DataFrame()
    placeholders = ",".join("?" for _ in syms)
    sql = f"""
      SELECT symbol, date, value
      FROM series_data
      WHERE symbol IN ({placeholders})
        AND date >= ?
        AND date <= ?
      ORDER BY date ASC
    """
    rows = conn.execute(sql, [*syms, start, end]).fetchall()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["symbol", "date", "value"])
    # Use pivot_table(last) instead of pivot to tolerate duplicate (symbol,date)
    # rows that can appear during repeated collector runs.
    out = df.pivot_table(index="date", columns="symbol", values="value", aggfunc="last")
    out.index = pd.to_datetime(out.index)
    return out.sort_index()
