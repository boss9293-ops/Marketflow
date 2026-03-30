"""
Auto Stock Analysis endpoint.
"""
from flask import Blueprint, jsonify, request

from schemas.stock_analysis_schema import StockAnalysisInput
from services.stock_analysis_engine import run_stock_analysis

stock_analysis_bp = Blueprint("stock_analysis", __name__)


@stock_analysis_bp.route("/api/analyze/stock", methods=["POST"])
def analyze_stock():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        request_data = StockAnalysisInput.from_dict(payload)
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid input: {exc}"}), 400

    try:
        result = run_stock_analysis(request_data.ticker, mode=request_data.mode)
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Stock analysis failed", "details": str(exc)}), 502
