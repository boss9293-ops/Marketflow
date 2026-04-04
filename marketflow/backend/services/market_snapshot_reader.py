from __future__ import annotations

import copy
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from backend.services.cache_store import resolve_db_path


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
OUTPUT_CACHE_DIR = BACKEND_DIR / "output" / "cache"

CORE_CACHE_PATH = OUTPUT_CACHE_DIR / "core_price_snapshot_latest.json"
MOVERS_CACHE_PATH = OUTPUT_CACHE_DIR / "movers_snapshot_latest.json"
REPORT_CACHE_PATH = OUTPUT_CACHE_DIR / "market_data_update_report.json"

OUTPUT_CACHE_DB_PATH = OUTPUT_CACHE_DIR / "cache.db"
PROJECT_CACHE_DB_PATH = Path(resolve_db_path())

CORE_INDEX_SYMBOLS = ["SPX", "NDX", "IXIC", "RUT", "VIX"]
CORE_MACRO_SYMBOLS = ["US10Y", "DXY", "WTI", "GOLD"]
CORE_ETF_SYMBOLS = ["SPY", "QQQ", "TQQQ", "SOXL", "SMH"]
CORE_MEGACAP_SYMBOLS = ["NVDA", "MSFT", "AAPL", "AMZN", "META"]

MOVERS_CATEGORIES = ("gainers", "most_active", "unusual_volume")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def normalize_symbol(symbol: Optional[str]) -> Optional[str]:
    if symbol is None:
        return None
    text = str(symbol).strip().upper()
    return text or None


def normalize_category(category: Optional[str]) -> Optional[str]:
    if category is None:
        return None
    text = str(category).strip().lower()
    return text or None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso_timestamp(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _json_load(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _json_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, list) else [parsed]
        except Exception:
            return [value]
    return [value]


def _candidate_db_paths() -> List[Path]:
    candidates = [PROJECT_CACHE_DB_PATH, OUTPUT_CACHE_DB_PATH]
    seen: set[str] = set()
    resolved: List[Path] = []
    for item in candidates:
        try:
            candidate = Path(item).expanduser().resolve()
        except Exception:
            continue
        key = str(candidate).casefold()
        if key in seen:
            continue
        seen.add(key)
        resolved.append(candidate)
    return resolved


def _choose_db_path() -> Optional[Path]:
    for candidate in _candidate_db_paths():
        if candidate.exists():
            return candidate
    if _candidate_db_paths():
        return _candidate_db_paths()[0]
    return None


def _connect_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _load_rows_from_db(
    *,
    table_name: str,
    columns: Sequence[str],
    where_clause: str = "",
    where_params: Sequence[Any] = (),
    order_by: str = "",
) -> List[Dict[str, Any]]:
    db_path = _choose_db_path()
    if db_path is None or not db_path.exists():
        return []
    if table_name not in {"core_price_snapshot", "movers_snapshot"}:
        return []

    query = f"SELECT {', '.join(columns)} FROM {table_name}"
    if where_clause:
        query += f" WHERE {where_clause}"
    if order_by:
        query += f" ORDER BY {order_by}"

    try:
        conn = _connect_db(db_path)
        try:
            rows = conn.execute(query, tuple(where_params)).fetchall()
        finally:
            conn.close()
    except Exception:
        return []

    return [dict(row) for row in rows]


def _normalize_core_record(record: Dict[str, Any], *, fetched_at: Optional[str], source_origin: str) -> Dict[str, Any]:
    output = {
        "symbol": normalize_symbol(record.get("symbol")),
        "asset_class": record.get("asset_class"),
        "name": record.get("name"),
        "price": record.get("price"),
        "change_pct": record.get("change_pct"),
        "source": record.get("source"),
        "as_of": record.get("as_of"),
        "fetched_at": record.get("fetched_at") or fetched_at,
        "raw_symbol": record.get("raw_symbol"),
        "currency": record.get("currency"),
        "exchange": record.get("exchange"),
        "instrument_type": record.get("instrument_type"),
        "validation_status": record.get("validation_status"),
        "validation_issues": _json_list(record.get("validation_issues")),
    }
    if source_origin:
        output["reader_source"] = source_origin
    return output


def _normalize_mover_record(record: Dict[str, Any], *, fetched_at: Optional[str], source_origin: str) -> Dict[str, Any]:
    output = {
        "category": record.get("category"),
        "rank": record.get("rank"),
        "symbol": normalize_symbol(record.get("symbol")),
        "name": record.get("name"),
        "price": record.get("price"),
        "change_pct": record.get("change_pct"),
        "volume": record.get("volume"),
        "relative_volume_10d_calc": record.get("relative_volume_10d_calc"),
        "exchange": record.get("exchange"),
        "instrument_type": record.get("instrument_type"),
        "source": record.get("source"),
        "as_of": record.get("as_of"),
        "fetched_at": record.get("fetched_at") or fetched_at,
        "raw_symbol": record.get("raw_symbol"),
        "validation_status": record.get("validation_status"),
        "validation_issues": _json_list(record.get("validation_issues")),
    }
    description = record.get("description")
    if description is not None:
        output["description"] = description
    if source_origin:
        output["reader_source"] = source_origin
    return output


def _read_core_from_cache() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload = _json_load(CORE_CACHE_PATH)
    if not payload:
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    records = payload.get("records")
    if not isinstance(records, list):
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    fetched_at = payload.get("generated_at") or payload.get("fetched_at") or payload.get("as_of")
    normalized = [
        _normalize_core_record(record, fetched_at=fetched_at, source_origin="cache")
        for record in records
        if isinstance(record, dict)
    ]
    normalized.sort(key=lambda item: str(item.get("symbol") or ""))
    meta = {
        "source": "cache",
        "as_of": payload.get("as_of"),
        "fetched_at": fetched_at,
        "origin": str(CORE_CACHE_PATH),
    }
    return normalized, meta


def _read_core_from_db() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    db_path = _choose_db_path()
    if db_path is None or not db_path.exists():
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    try:
        conn = _connect_db(db_path)
    except Exception:
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    try:
        latest_row = conn.execute(
            "SELECT as_of, fetched_at FROM core_price_snapshot ORDER BY as_of DESC LIMIT 1"
        ).fetchone()
        if not latest_row:
            return [], {"source": None, "as_of": None, "fetched_at": None, "origin": str(db_path)}
        latest_as_of = latest_row["as_of"]
        fetched_at = latest_row["fetched_at"] or latest_as_of
        rows = conn.execute(
            """
            SELECT symbol, asset_class, name, price, change_pct, source, as_of, fetched_at,
                   raw_symbol, currency, exchange, instrument_type, validation_status, validation_issues
            FROM core_price_snapshot
            WHERE as_of = ?
            ORDER BY symbol ASC
            """,
            (latest_as_of,),
        ).fetchall()
    except Exception:
        rows = []
        latest_as_of = None
        fetched_at = None
    finally:
        conn.close()

    normalized = [
        _normalize_core_record(dict(row), fetched_at=fetched_at, source_origin="db")
        for row in rows
    ]
    meta = {
        "source": "db",
        "as_of": latest_as_of,
        "fetched_at": fetched_at,
        "origin": str(db_path),
    }
    return normalized, meta


def _read_movers_from_cache(category: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload = _json_load(MOVERS_CACHE_PATH)
    if not payload:
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    categories = payload.get("categories")
    if not isinstance(categories, dict):
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    fetched_at = payload.get("generated_at") or payload.get("fetched_at") or payload.get("as_of")
    selected_categories: List[str]
    if category is None:
        selected_categories = [name for name in MOVERS_CATEGORIES if name in categories]
    else:
        selected_categories = [category]

    normalized: List[Dict[str, Any]] = []
    for category_name in selected_categories:
        items = categories.get(category_name)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                normalized.append(
                    _normalize_mover_record(item, fetched_at=fetched_at, source_origin="cache")
                )

    normalized.sort(
        key=lambda item: (
            str(item.get("category") or ""),
            int(item.get("rank") or 0),
            str(item.get("symbol") or ""),
        )
    )
    meta = {
        "source": "cache",
        "as_of": payload.get("as_of"),
        "fetched_at": fetched_at,
        "origin": str(MOVERS_CACHE_PATH),
    }
    return normalized, meta


def _read_movers_from_db(category: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    db_path = _choose_db_path()
    if db_path is None or not db_path.exists():
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    try:
        conn = _connect_db(db_path)
    except Exception:
        return [], {"source": None, "as_of": None, "fetched_at": None, "origin": None}

    params: List[Any] = []
    where_sql = ""
    if category is not None:
        where_sql = "category = ?"
        params.append(category)

    try:
        if where_sql:
            latest_row = conn.execute(
                f"SELECT as_of, fetched_at FROM movers_snapshot WHERE {where_sql} ORDER BY as_of DESC, rank ASC LIMIT 1",
                tuple(params),
            ).fetchone()
        else:
            latest_row = conn.execute(
                "SELECT as_of, fetched_at FROM movers_snapshot ORDER BY as_of DESC, category ASC, rank ASC LIMIT 1"
            ).fetchone()

        if not latest_row:
            return [], {"source": None, "as_of": None, "fetched_at": None, "origin": str(db_path)}

        latest_as_of = latest_row["as_of"]
        fetched_at = latest_row["fetched_at"] or latest_as_of

        query = """
            SELECT category, rank, symbol, name, price, change_pct, volume, relative_volume_10d_calc,
                   exchange, instrument_type, source, as_of, fetched_at, raw_symbol, validation_status, validation_issues
            FROM movers_snapshot
            WHERE as_of = ?
        """
        query_params: List[Any] = [latest_as_of]
        if category is not None:
            query += " AND category = ?"
            query_params.append(category)
        query += " ORDER BY category ASC, rank ASC"
        rows = conn.execute(query, tuple(query_params)).fetchall()
    except Exception:
        rows = []
        latest_as_of = None
        fetched_at = None
    finally:
        conn.close()

    normalized = [
        _normalize_mover_record(dict(row), fetched_at=fetched_at, source_origin="db")
        for row in rows
    ]
    meta = {
        "source": "db",
        "as_of": latest_as_of,
        "fetched_at": fetched_at,
        "origin": str(db_path),
    }
    return normalized, meta


def _load_core_prices(use_cache: bool = True) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if use_cache:
        records, meta = _read_core_from_cache()
        if records:
            return records, meta
    return _read_core_from_db()


def _load_movers(use_cache: bool = True, category: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if use_cache:
        records, meta = _read_movers_from_cache(category=category)
        if records:
            return records, meta
    return _read_movers_from_db(category=category)


def get_latest_core_prices(use_cache: bool = True) -> List[Dict[str, Any]]:
    records, _ = _load_core_prices(use_cache=use_cache)
    return [copy.deepcopy(record) for record in records]


def get_latest_price(symbol: str, use_cache: bool = True) -> Optional[Dict[str, Any]]:
    normalized = normalize_symbol(symbol)
    if not normalized:
        return None
    price_map = get_core_price_map(use_cache=use_cache)
    record = price_map.get(normalized)
    return copy.deepcopy(record) if record is not None else None


def get_latest_movers(category: Optional[str] = None, use_cache: bool = True) -> List[Dict[str, Any]]:
    normalized_category = normalize_category(category) if category is not None else None
    if normalized_category is not None and normalized_category not in MOVERS_CATEGORIES:
        return []
    records, _ = _load_movers(use_cache=use_cache, category=normalized_category)
    return [copy.deepcopy(record) for record in records]


def get_core_price_map(use_cache: bool = True) -> Dict[str, Dict[str, Any]]:
    records = get_latest_core_prices(use_cache=use_cache)
    price_map: Dict[str, Dict[str, Any]] = {}
    for record in records:
        symbol = normalize_symbol(record.get("symbol"))
        if not symbol:
            continue
        price_map[symbol] = record
    return price_map


def get_market_snapshot_for_briefing(use_cache: bool = True) -> Dict[str, Any]:
    core_records, core_meta = _load_core_prices(use_cache=use_cache)
    mover_records, movers_meta = _load_movers(use_cache=use_cache, category=None)
    core_map = {normalize_symbol(item.get("symbol")): copy.deepcopy(item) for item in core_records if normalize_symbol(item.get("symbol"))}

    snapshot = {
        "indices": {},
        "macro": {},
        "etfs": {},
        "mega_caps": {},
        "meta": {},
    }

    def _pick(symbols: Iterable[str]) -> Dict[str, Dict[str, Any]]:
        picked: Dict[str, Dict[str, Any]] = {}
        for symbol in symbols:
            record = core_map.get(symbol)
            if record is not None:
                picked[symbol] = copy.deepcopy(record)
        return picked

    snapshot["indices"] = _pick(CORE_INDEX_SYMBOLS)
    snapshot["macro"] = _pick(CORE_MACRO_SYMBOLS)
    snapshot["etfs"] = _pick(CORE_ETF_SYMBOLS)
    snapshot["mega_caps"] = _pick(CORE_MEGACAP_SYMBOLS)

    source = "cache" if core_meta.get("source") == "cache" and movers_meta.get("source") == "cache" else "db"
    as_of_candidates = [core_meta.get("as_of"), movers_meta.get("as_of")]
    fetched_candidates = [core_meta.get("fetched_at"), movers_meta.get("fetched_at")]
    as_of = next((value for value in as_of_candidates if value), None)
    fetched_at = next((value for value in fetched_candidates if value), None)

    snapshot["meta"] = {
        "source": source,
        "as_of": as_of,
        "fetched_at": fetched_at,
    }
    return snapshot


def _all_snapshot_times(use_cache: bool = True) -> List[datetime]:
    times: List[datetime] = []

    _, core_meta = _load_core_prices(use_cache=use_cache)
    _, movers_meta = _load_movers(use_cache=use_cache, category=None)

    for meta in (core_meta, movers_meta):
        timestamp = parse_iso_timestamp(meta.get("fetched_at") or meta.get("as_of"))
        if timestamp is not None:
            times.append(timestamp)
    return times


def get_snapshot_age_minutes() -> Optional[float]:
    times = _all_snapshot_times(use_cache=True)
    if len(times) < 2:
        return None

    oldest = min(times)
    age_minutes = (now_utc() - oldest).total_seconds() / 60.0
    return round(age_minutes, 2)


def is_snapshot_stale(max_age_minutes: int = 60) -> bool:
    times = _all_snapshot_times(use_cache=True)
    if len(times) < 2:
        return True
    age_minutes = (now_utc() - min(times)).total_seconds() / 60.0
    return age_minutes > float(max_age_minutes)


def get_reader_paths() -> Dict[str, Any]:
    return {
        "core_cache_path": str(CORE_CACHE_PATH),
        "movers_cache_path": str(MOVERS_CACHE_PATH),
        "report_cache_path": str(REPORT_CACHE_PATH),
        "db_candidates": [str(path) for path in _candidate_db_paths()],
        "selected_db_path": str(_choose_db_path()) if _choose_db_path() else None,
    }
