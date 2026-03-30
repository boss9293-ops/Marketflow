"""
Portfolio analysis endpoint.
"""
from flask import Blueprint, jsonify, request

from schemas.portfolio_analysis_schema import PortfolioAnalysisInput
from services.portfolio_engine import run_portfolio_analysis

portfolio_analysis_bp = Blueprint("portfolio_analysis", __name__)


@portfolio_analysis_bp.route("/api/analyze/portfolio", methods=["POST"])
def analyze_portfolio():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        request_data = PortfolioAnalysisInput.from_dict(payload)
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid input: {exc}"}), 400

    try:
        result = run_portfolio_analysis(
            request_data.positions,
            mode=request_data.mode,
            portfolio_name=request_data.portfolio_name,
        )
        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"error": "Portfolio analysis failed", "details": str(exc)}), 502

