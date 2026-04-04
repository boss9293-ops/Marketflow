from __future__ import annotations

import json
import math
import sqlite3
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import requests

from backend.services.market_data_service import (
    OUTPUT_CACHE_DIR,
    TV_SOURCE_NAME,
    ensure_dir,
    ensure_movers_db_schema,
    make_session,
    now_iso,
    open_db,
    parse_numeric,
    round_value,
    safe_string,
    to_snippet,
)


MOVERS_CATEGORY_CONFIG = {
    "gainers": {"sort_by": "change", "label": "Top Gainers"},
    "most_active": {"sort_by": "volume", "label": "Most Active"},
    "unusual_volume": {"sort_by": "relative_volume_10d_calc", "label": "Unusual Volume"},
}

MOVERS_TOP_N = 10
MOVERS_SCAN_LIMIT = 60
MOVERS_COLUMNS = [
    "name",
    "close",
    "change",
    "volume",
    "relative_volume_10d_calc",
    "exchange",
    "type",
    "description",
]


def _row_value(values: Sequence[Any], index: int) -> Any:
    if index < 0 or index >= len(values):
        return None
    return values[index]


def _symbol_from_raw(raw_symbol: Optional[str]) -> Optional[str]:
    if not raw_symbol:
        return None
    text = str(raw_symbol).strip()
    if ":" in text:
        return text.split(":", 1)[-1].strip() or None
    return text or None


def detect_blocking(status_code: Optional[int], body: str, row_count: int) -> Tuple[bool, List[str]]:
    signals: List[str] = []
    body_lc = (body or "").strip().casefold()
    if status_code in {403, 429, 503}:
        signals.append(f"status_code_{status_code}")
    for phrase in (
        "captcha",
        "recaptcha",
        "access denied",
        "cloudflare",
        "attention required",
        "verify you are human",
        "security check",
        "ddos protection",
        "cf-chl",
    ):
        if phrase in body_lc:
            signals.append(phrase)
    if row_count == 0 and len(body_lc) < 150:
        signals.append("short_body_no_rows")
    return bool(signals), list(dict.fromkeys(signals))


def fetch_tradingview_movers(
    session: Optional[requests.Session] = None,
    *,
    category: str,
    limit: int = MOVERS_TOP_N,
    as_of: Optional[str] = None,
) -> Dict[str, Any]:
    if category not in MOVERS_CATEGORY_CONFIG:
        raise ValueError(f"Unsupported movers category: {category}")

    cfg = MOVERS_CATEGORY_CONFIG[category]
    session = session or make_session()
    as_of = as_of or now_iso()
    url = "https://scanner.tradingview.com/america/scan"
    payload = {
        "symbols": {"query": {"types": ["stock"]}},
        "columns": MOVERS_COLUMNS,
        "sort": {"sortBy": cfg["sort_by"], "sortOrder": "desc"},
        "range": [0, MOVERS_SCAN_LIMIT],
        "options": {"lang": "en"},
    }

    try:
        response = session.post(url, json=payload, timeout=20)
        text = response.text or ""
        data: Dict[str, Any] = {}
        if text.strip().startswith("{"):
            try:
                data = response.json()
            except Exception:
                data = json.loads(text)

        rows = data.get("data") if isinstance(data, dict) else []
        rows = rows or []
        blocked, block_reasons = detect_blocking(response.status_code, text, len(rows))

        parsed_rows: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            values = row.get("d") or []
            raw_symbol = safe_string(row.get("s"))
            symbol = _symbol_from_raw(raw_symbol)
            if not symbol:
                continue

            description = safe_string(_row_value(values, 7))
            name = description or safe_string(_row_value(values, 0)) or symbol
            price = parse_numeric(_row_value(values, 1))
            change_pct = parse_numeric(_row_value(values, 2))
            volume = parse_numeric(_row_value(values, 3))
            rel_volume = parse_numeric(_row_value(values, 4))
            exchange = safe_string(_row_value(values, 5))
            instrument_type = safe_string(_row_value(values, 6))

            price_precision = 6 if price is not None and abs(price) < 1 else 2
            parsed_rows.append(
                {
                    "category": category,
                    "symbol": symbol,
                    "name": name,
                    "price": round_value(price, price_precision),
                    "change_pct": round_value(change_pct, 2),
                    "volume": round_value(volume, 0) if volume is not None else None,
                    "relative_volume_10d_calc": round_value(rel_volume, 2),
                    "exchange": exchange,
                    "instrument_type": instrument_type,
                    "description": description,
                    "source": TV_SOURCE_NAME,
                    "as_of": as_of,
                    "raw_symbol": raw_symbol,
                }
            )

        sort_key = cfg["sort_by"]
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for item in sorted(
            parsed_rows,
            key=lambda row: (
                parse_numeric(row.get(sort_key)) is None,
                -(parse_numeric(row.get(sort_key)) or float("-inf")),
                row.get("symbol") or "",
            ),
        ):
            symbol = safe_string(item.get("symbol"))
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            deduped.append(item)

        selected = deduped[:limit]
        raw_record = {
            "category": category,
            "label": cfg["label"],
            "source": TV_SOURCE_NAME,
            "status_code": response.status_code,
            "response_length": len(text),
            "blocked": blocked,
            "block_reasons": block_reasons,
            "response_snippet": None if selected else to_snippet(text, 600),
            "row_count": len(rows),
            "selected_count": len(selected),
        }

        for idx, item in enumerate(selected, start=1):
            item["rank"] = idx
            item["validation_status"], item["validation_issues"] = validate_mover_record(item)

        return {
            "as_of": as_of,
            "raw_record": raw_record,
            "records": selected,
        }
    except requests.RequestException as exc:
        return {
            "as_of": as_of,
            "raw_record": {
                "category": category,
                "label": cfg["label"],
                "source": TV_SOURCE_NAME,
                "status_code": getattr(getattr(exc, "response", None), "status_code", None),
                "response_length": 0,
                "blocked": False,
                "block_reasons": [],
                "response_snippet": None,
                "row_count": 0,
                "selected_count": 0,
                "error": f"{exc.__class__.__name__}: {exc}",
            },
            "records": [],
        }
    except Exception as exc:
        return {
            "as_of": as_of,
            "raw_record": {
                "category": category,
                "label": cfg["label"],
                "source": TV_SOURCE_NAME,
                "status_code": None,
                "response_length": 0,
                "blocked": False,
                "block_reasons": [],
                "response_snippet": None,
                "row_count": 0,
                "selected_count": 0,
                "error": f"{exc.__class__.__name__}: {exc}",
            },
            "records": [],
        }


def validate_mover_record(record: Dict[str, Any]) -> Tuple[str, List[str]]:
    issues: List[str] = []
    status = "valid"

    category = safe_string(record.get("category"))
    symbol = safe_string(record.get("symbol"))
    source = safe_string(record.get("source"))
    as_of = safe_string(record.get("as_of"))
    price = parse_numeric(record.get("price"))
    change_pct = parse_numeric(record.get("change_pct"))
    volume = parse_numeric(record.get("volume"))

    if category not in MOVERS_CATEGORY_CONFIG:
        return "invalid", ["invalid_category"]
    if not symbol:
        return "invalid", ["missing_symbol"]
    if not source:
        return "invalid", ["missing_source"]
    if not as_of:
        return "invalid", ["missing_as_of"]
    if price is None or price <= 0:
        return "invalid", ["invalid_price"]
    if change_pct is None or not math.isfinite(float(change_pct)):
        return "invalid", ["invalid_change_pct"]
    if volume is None or volume < 0:
        issues.append("missing_volume")
        status = "suspicious"
    if not safe_string(record.get("name")):
        issues.append("missing_name")
        status = "suspicious"
    if not safe_string(record.get("raw_symbol")):
        issues.append("missing_raw_symbol")
        status = "suspicious"

    return status, issues


def collect_movers(
    *,
    as_of: Optional[str] = None,
    session: Optional[requests.Session] = None,
    categories: Optional[Sequence[str]] = None,
    limit: int = MOVERS_TOP_N,
) -> Dict[str, Any]:
    as_of = as_of or now_iso()
    session = session or make_session()
    categories = list(categories or MOVERS_CATEGORY_CONFIG.keys())

    raw_records: List[Dict[str, Any]] = []
    normalized_records: List[Dict[str, Any]] = []
    category_map: Dict[str, List[Dict[str, Any]]] = {}

    for category in categories:
        result = fetch_tradingview_movers(session, category=category, limit=limit, as_of=as_of)
        raw_records.append(result["raw_record"])
        category_records = result.get("records", [])
        category_map[category] = category_records
        normalized_records.extend(category_records)

    summary = summarize_movers(normalized_records)
    return {
        "as_of": as_of,
        "raw_records": raw_records,
        "records": normalized_records,
        "categories": category_map,
        "summary": summary,
    }


def summarize_movers(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_category = defaultdict(lambda: {"count": 0, "valid": 0, "suspicious": 0, "invalid": 0})
    status_counts = Counter()

    for record in records:
        category = safe_string(record.get("category")) or "unknown"
        status = safe_string(record.get("validation_status")) or "unknown"
        by_category[category]["count"] += 1
        status_counts[status] += 1
        if status in by_category[category]:
            by_category[category][status] += 1

    return {
        "total": len(records),
        "valid": status_counts.get("valid", 0),
        "suspicious": status_counts.get("suspicious", 0),
        "invalid": status_counts.get("invalid", 0),
        "by_category": dict(sorted(by_category.items())),
    }


def _upsert_rows(
    conn: sqlite3.Connection,
    *,
    table_name: str,
    conflict_key: Tuple[str, ...],
    rows: Iterable[Tuple[Dict[str, Any], Dict[str, Any]]],
    insert_columns: Sequence[str],
    update_columns: Sequence[str],
) -> Dict[str, Any]:
    inserted = 0
    updated = 0
    duplicates = 0
    rows_written = 0

    cur = conn.cursor()
    conflict_cols = ",".join(conflict_key)
    update_sql = ", ".join(f"{col}=excluded.{col}" for col in update_columns)
    placeholders = ",".join("?" for _ in insert_columns)
    insert_sql = f"""
        INSERT INTO {table_name} ({",".join(insert_columns)})
        VALUES ({placeholders})
        ON CONFLICT({conflict_cols}) DO UPDATE SET
          {update_sql}
    """

    for record, keys in rows:
        where_clause = " AND ".join(f"{col}=?" for col in conflict_key)
        lookup_values = [keys[col] for col in conflict_key]
        existing = cur.execute(
            f"SELECT 1 FROM {table_name} WHERE {where_clause} LIMIT 1",
            lookup_values,
        ).fetchone()
        existed = existing is not None

        values = [record.get(column) for column in insert_columns]
        cur.execute(insert_sql, values)
        rows_written += 1
        if existed:
            updated += 1
            duplicates += 1
        else:
            inserted += 1

    conn.commit()
    row_count_row = cur.execute(f"SELECT COUNT(*) AS c FROM {table_name}").fetchone()
    row_count = int(row_count_row["c"] if row_count_row else 0)
    return {
        "inserted": inserted,
        "updated": updated,
        "duplicates": duplicates,
        "rows_written": rows_written,
        "row_count": row_count,
    }


def upsert_mover_records(conn: sqlite3.Connection, records: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    ensure_movers_db_schema(conn)
    now = now_iso()
    prepared: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for record in records:
        prepared.append(
            (
                {
                    "category": safe_string(record.get("category")),
                    "rank": int(record.get("rank") or 0),
                    "symbol": safe_string(record.get("symbol")),
                    "name": safe_string(record.get("name")),
                    "price": parse_numeric(record.get("price")),
                    "change_pct": parse_numeric(record.get("change_pct")),
                    "volume": parse_numeric(record.get("volume")),
                    "relative_volume_10d_calc": parse_numeric(record.get("relative_volume_10d_calc")),
                    "exchange": safe_string(record.get("exchange")),
                    "instrument_type": safe_string(record.get("instrument_type")),
                    "source": safe_string(record.get("source")),
                    "as_of": safe_string(record.get("as_of")),
                    "fetched_at": now,
                    "raw_symbol": safe_string(record.get("raw_symbol")),
                    "validation_status": safe_string(record.get("validation_status")),
                    "validation_issues": json.dumps(record.get("validation_issues", []), ensure_ascii=False),
                },
                {
                    "category": safe_string(record.get("category")),
                    "symbol": safe_string(record.get("symbol")),
                    "as_of": safe_string(record.get("as_of")),
                },
            )
        )

    return _upsert_rows(
        conn,
        table_name="movers_snapshot",
        conflict_key=("category", "symbol", "as_of"),
        rows=prepared,
        insert_columns=[
            "category",
            "rank",
            "symbol",
            "name",
            "price",
            "change_pct",
            "volume",
            "relative_volume_10d_calc",
            "exchange",
            "instrument_type",
            "source",
            "as_of",
            "fetched_at",
            "raw_symbol",
            "validation_status",
            "validation_issues",
        ],
        update_columns=[
            "rank",
            "name",
            "price",
            "change_pct",
            "volume",
            "relative_volume_10d_calc",
            "exchange",
            "instrument_type",
            "source",
            "fetched_at",
            "raw_symbol",
            "validation_status",
            "validation_issues",
        ],
    )


def read_back_mover_rows(conn: sqlite3.Connection, *, limit: int = 10) -> List[Dict[str, Any]]:
    ensure_movers_db_schema(conn)
    rows = conn.execute(
        """
        SELECT category, rank, symbol, name, price, change_pct, volume, relative_volume_10d_calc,
               exchange, instrument_type, source, as_of, fetched_at, raw_symbol, validation_status
        FROM movers_snapshot
        ORDER BY as_of DESC, category ASC, rank ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(row) for row in rows]


def build_movers_cache_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "generated_at": now_iso(),
        "as_of": result.get("as_of"),
        "snapshot_type": "movers_snapshot",
        "record_count": len(result.get("records", [])),
        "categories": result.get("categories", {}),
        "records": result.get("records", []),
        "summary": result.get("summary", {}),
    }


def default_cache_output_dir() -> Path:
    ensure_dir(OUTPUT_CACHE_DIR)
    return OUTPUT_CACHE_DIR
