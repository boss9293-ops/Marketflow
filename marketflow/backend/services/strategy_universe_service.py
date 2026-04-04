from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Optional

from db_utils import resolve_marketflow_db
from symbol_registry import ROOM_SECTION_META, build_etf_catalog_rows, standard_universe_symbols


def _label_from_key(key: str) -> str:
    meta = ROOM_SECTION_META.get(key)
    if meta:
        return str(meta.get("title") or key)
    if not key:
        return "Universe"
    return key.replace("_", " ").title()


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def _registry_fallback_rows() -> List[Dict[str, Any]]:
    catalog_rows = {row.symbol: row for row in build_etf_catalog_rows()}
    rows: List[Dict[str, Any]] = []
    for symbol in standard_universe_symbols():
        catalog = catalog_rows.get(symbol)
        if catalog:
            category_key = catalog.category or "index"
            rows.append(
                {
                    "symbol": catalog.symbol,
                    "name": catalog.display_name,
                    "category": category_key,
                    "category_label": _label_from_key(category_key),
                    "subcategory": catalog.subcategory or "",
                    "strategy_tier": catalog.strategy_tier or "",
                    "direction": catalog.direction or "",
                    "leverage_factor": catalog.leverage_factor,
                    "priority": catalog.priority,
                    "source": catalog.source or "registry",
                    "notes": catalog.notes or "",
                    "is_etf": True,
                }
            )
        else:
            rows.append(
                {
                    "symbol": symbol,
                    "name": symbol,
                    "category": "equity",
                    "category_label": "Equity",
                    "subcategory": "",
                    "strategy_tier": "core",
                    "direction": "long",
                    "leverage_factor": None,
                    "priority": 0,
                    "source": "registry",
                    "notes": "",
                    "is_etf": False,
                }
            )
    return rows


def list_strategy_universe(
    *,
    query: str = "",
    category: str | None = None,
    limit: int = 200,
) -> Dict[str, Any]:
    db_path = resolve_marketflow_db(required_tables=("universe_symbols",), prefer_engine=False)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        has_catalog = _table_exists(conn, "etf_catalog")
        params: List[Any] = []
        clauses = ["u.is_active = 1"]

        if category:
            category_key = category.strip().lower()
            if category_key:
                clauses.append("LOWER(COALESCE(e.category, 'equity')) = ?")
                params.append(category_key)

        if query:
            q = f"%{query.strip().upper()}%"
            clauses.append(
                "("
                "UPPER(u.symbol) LIKE ? OR "
                "UPPER(COALESCE(u.name, u.symbol)) LIKE ? OR "
                "UPPER(COALESCE(e.category, '')) LIKE ? OR "
                "UPPER(COALESCE(e.subcategory, '')) LIKE ? OR "
                "UPPER(COALESCE(e.strategy_tier, '')) LIKE ?"
                ")"
            )
            params.extend([q, q, q, q, q])

        if has_catalog:
            sql = f"""
                SELECT
                    u.symbol AS symbol,
                    COALESCE(NULLIF(u.name, ''), e.display_name, u.symbol) AS name,
                    COALESCE(e.category, 'equity') AS category,
                    COALESCE(e.subcategory, '') AS subcategory,
                    COALESCE(e.strategy_tier, 'core') AS strategy_tier,
                    COALESCE(e.direction, 'long') AS direction,
                    e.leverage_factor AS leverage_factor,
                    COALESCE(e.priority, 0) AS priority,
                    COALESCE(e.source, 'universe') AS source,
                    COALESCE(e.notes, '') AS notes
                FROM universe_symbols u
                LEFT JOIN etf_catalog e ON e.symbol = u.symbol
                WHERE {" AND ".join(clauses)}
                ORDER BY COALESCE(e.priority, 0) DESC, COALESCE(e.category, 'equity') ASC, u.symbol ASC
                LIMIT ?
            """
            rows = conn.execute(sql, [*params, limit]).fetchall()
            results = []
            for row in rows:
                category_key = str(row["category"] or "equity").lower()
                results.append(
                    {
                        "symbol": str(row["symbol"]),
                        "name": str(row["name"] or row["symbol"]),
                        "category": category_key,
                        "category_label": _label_from_key(category_key),
                        "subcategory": str(row["subcategory"] or ""),
                        "strategy_tier": str(row["strategy_tier"] or ""),
                        "direction": str(row["direction"] or ""),
                        "leverage_factor": float(row["leverage_factor"]) if row["leverage_factor"] is not None else None,
                        "priority": int(row["priority"] or 0),
                        "source": str(row["source"] or "universe"),
                        "notes": str(row["notes"] or ""),
                        "is_etf": category_key != "equity",
                    }
                )
            source = "db"
        else:
            fallback_rows = _registry_fallback_rows()
            if category:
                category_key = category.strip().lower()
                fallback_rows = [row for row in fallback_rows if row["category"] == category_key]
            if query:
                q = query.strip().upper()
                fallback_rows = [
                    row
                    for row in fallback_rows
                    if q in row["symbol"].upper()
                    or q in row["name"].upper()
                    or q in row["category"].upper()
                    or q in row["subcategory"].upper()
                    or q in row["strategy_tier"].upper()
                ]
            results = fallback_rows[:limit]
            source = "registry"

        return {
            "db_path": db_path,
            "source": source,
            "count": len(results),
            "symbols": results,
        }
    finally:
        conn.close()
