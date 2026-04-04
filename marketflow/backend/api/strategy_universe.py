from __future__ import annotations

from flask import Blueprint, jsonify, request

from services.strategy_universe_service import list_strategy_universe


strategy_universe_bp = Blueprint("strategy_universe", __name__)


@strategy_universe_bp.route("/api/strategy/symbols", methods=["GET"])
def strategy_symbols():
    query = (request.args.get("q") or "").strip()
    category = (request.args.get("category") or "").strip() or None
    try:
        limit = int(request.args.get("limit", 200))
    except (TypeError, ValueError):
        limit = 200
    limit = max(1, min(limit, 1000))

    try:
        payload = list_strategy_universe(query=query, category=category, limit=limit)
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": "Failed to load strategy universe", "details": str(exc)}), 502
