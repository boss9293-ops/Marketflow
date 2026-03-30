"""
Watchlist analysis endpoint.
"""
from flask import Blueprint, jsonify, request

from schemas.watchlist_analysis_schema import WatchlistAnalysisInput
from services.watchlist_summary_engine import run_watchlist_summary

watchlist_analysis_bp = Blueprint("watchlist_analysis", __name__)


@watchlist_analysis_bp.route("/api/analyze/watchlist", methods=["POST"])
def analyze_watchlist():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        request_data = WatchlistAnalysisInput.from_dict(payload)
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid input: {exc}"}), 400

    try:
        result = run_watchlist_summary(
            request_data.tickers,
            mode=request_data.mode,
            watchlist_name=request_data.watchlist_name,
        )
        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"error": "Watchlist analysis failed", "details": str(exc)}), 502

