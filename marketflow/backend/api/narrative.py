"""
Narrative API endpoints for briefing, watchlist, and portfolio generation.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

from services.narrative_generator import (
    generate_briefing,
    generate_portfolio,
    generate_watchlist,
)

narrative_bp = Blueprint("narrative", __name__)

_WATCHLIST_CACHE_TTL_SEC = 60 * 30
_WATCHLIST_CACHE: Dict[str, Dict[str, Any]] = {}


def _json_body() -> Any:
    payload = request.get_json(silent=True)
    if payload is None:
        raise ValueError("Request body must be JSON")
    return payload


def _extract_engine_data(payload: Dict[str, Any]) -> Dict[str, Any]:
    engine_data = payload.get("engine_data")
    if isinstance(engine_data, dict):
        return engine_data
    engine = payload.get("engine")
    if isinstance(engine, dict):
        return engine
    # When the caller sends engine fields at the top level, use the payload itself.
    return {k: v for k, v in payload.items() if k not in {"engine_data", "engine"}}


def _extract_stock_data(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("stock_data", "stocks", "watchlist", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _extract_portfolio_data(payload: Dict[str, Any]) -> Dict[str, Any]:
    portfolio_data = payload.get("portfolio_data")
    if isinstance(portfolio_data, dict):
        return portfolio_data

    portfolio = payload.get("portfolio")
    if isinstance(portfolio, dict):
        return portfolio

    return {
        k: v
        for k, v in payload.items()
        if k not in {"engine_data", "engine", "portfolio_data", "portfolio"}
    }


def _watchlist_cache_key(stock_data: List[Dict[str, Any]], engine_data: Dict[str, Any]) -> str:
    canonical = json.dumps(
        {"stock_data": stock_data, "engine_data": engine_data},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()


def _watchlist_cache_get(key: str) -> Any:
    now = time.monotonic()
    hit = _WATCHLIST_CACHE.get(key)
    if not hit:
        return None
    if hit["expires_at"] <= now:
        _WATCHLIST_CACHE.pop(key, None)
        return None
    return hit["value"]


def _watchlist_cache_set(key: str, value: Any) -> Any:
    _WATCHLIST_CACHE[key] = {
        "expires_at": time.monotonic() + _WATCHLIST_CACHE_TTL_SEC,
        "value": value,
    }
    return value


@narrative_bp.route("/api/narrative/briefing", methods=["POST"])
def narrative_briefing():
    try:
        payload = _json_body()
        engine_data = _extract_engine_data(payload if isinstance(payload, dict) else {})
        result = generate_briefing(engine_data)
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (KeyError, TypeError) as exc:
        return jsonify({"error": "Invalid input", "details": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Narrative briefing failed", "details": str(exc)}), 502


@narrative_bp.route("/api/narrative/watchlist", methods=["POST"])
def narrative_watchlist():
    try:
        payload = _json_body()
        stock_data = _extract_stock_data(payload)
        engine_data = _extract_engine_data(payload if isinstance(payload, dict) else {})
        key = _watchlist_cache_key(stock_data, engine_data)
        cached = _watchlist_cache_get(key)
        if cached is not None:
            return jsonify(cached), 200

        result = generate_watchlist(stock_data, engine_data)
        _watchlist_cache_set(key, result)
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (KeyError, TypeError) as exc:
        return jsonify({"error": "Invalid input", "details": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Narrative watchlist failed", "details": str(exc)}), 502


@narrative_bp.route("/api/narrative/portfolio", methods=["POST"])
def narrative_portfolio():
    try:
        payload = _json_body()
        payload_dict = payload if isinstance(payload, dict) else {}
        portfolio_data = _extract_portfolio_data(payload_dict)
        engine_data = _extract_engine_data(payload_dict)
        result = generate_portfolio(portfolio_data, engine_data)
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (KeyError, TypeError) as exc:
        return jsonify({"error": "Invalid input", "details": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Narrative portfolio failed", "details": str(exc)}), 502
