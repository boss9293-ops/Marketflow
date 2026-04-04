from __future__ import annotations

import sqlite3
from flask import Blueprint, jsonify, request

from db_utils import core_db_path

etf_catalog_bp = Blueprint("etf_catalog", __name__)

# Tab display config  (key → Korean label)
TAB_LABELS: dict[str, str] = {
    "all":          "전체",
    "index":        "지수",
    "leverage":     "레버리지",
    "sector":       "섹터",
    "reverse":      "인버스",
    "dividend":     "배당",
    "fixed_income": "채권",
    "crypto":       "코인",
    "ark":          "ARK",
    "commodity":    "원자재",
    "theme":        "테마",
}


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(core_db_path())
    conn.row_factory = sqlite3.Row
    return conn


@etf_catalog_bp.route("/api/etf/catalog", methods=["GET"])
def etf_catalog():
    """
    GET /api/etf/catalog
      ?category=leverage   — filter by category (omit or 'all' for all)
      ?q=SOX               — search symbol or name
      ?limit=200
    Response:
      { tabs: [{key, label, count}], symbols: [...], total }
    """
    category = (request.args.get("category") or "").strip().lower() or "all"
    q        = (request.args.get("q") or "").strip().upper()
    try:
        limit = max(1, min(int(request.args.get("limit", 300)), 1000))
    except (TypeError, ValueError):
        limit = 300

    try:
        conn = _conn()

        # ── Tab counts ────────────────────────────────────────────────────────
        count_rows = conn.execute("""
            SELECT category, COUNT(*) AS cnt
            FROM etf_catalog
            WHERE is_active = 1
            GROUP BY category
            ORDER BY category
        """).fetchall()

        total_all = sum(r["cnt"] for r in count_rows)
        tabs = [{"key": "all", "label": TAB_LABELS.get("all", "전체"), "count": total_all}]
        for r in count_rows:
            key = r["category"]
            tabs.append({
                "key":   key,
                "label": TAB_LABELS.get(key, key),
                "count": r["cnt"],
            })

        # ── Symbol query ──────────────────────────────────────────────────────
        where_parts = ["e.is_active = 1"]
        params: list = []

        if category and category != "all":
            where_parts.append("e.category = ?")
            params.append(category)

        if q:
            where_parts.append("(UPPER(e.symbol) LIKE ? OR UPPER(e.display_name) LIKE ?)")
            params += [f"%{q}%", f"%{q}%"]

        where_sql = " AND ".join(where_parts)

        rows = conn.execute(f"""
            SELECT
                e.symbol,
                e.display_name      AS name,
                e.category,
                e.subcategory,
                e.strategy_tier,
                e.direction,
                e.leverage_factor,
                e.priority,
                e.notes,
                CASE WHEN o.cnt > 0 THEN 1 ELSE 0 END AS has_data,
                COALESCE(o.cnt, 0)  AS ohlcv_rows,
                o.date_from,
                o.date_to
            FROM etf_catalog e
            LEFT JOIN (
                SELECT symbol, COUNT(*) AS cnt, MIN(date) AS date_from, MAX(date) AS date_to
                FROM ohlcv_daily
                GROUP BY symbol
            ) o ON o.symbol = e.symbol
            WHERE {where_sql}
            ORDER BY e.priority ASC, e.symbol ASC
            LIMIT ?
        """, params + [limit]).fetchall()

        conn.close()

        symbols = [dict(r) for r in rows]
        return jsonify({
            "tabs":    tabs,
            "symbols": symbols,
            "total":   len(symbols),
            "category": category,
        })

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
