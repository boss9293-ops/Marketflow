"""
SRS AI Analysis endpoint -- Flask Blueprint.
Register in app.py:
    from api.analyze_srs import srs_bp
    app.register_blueprint(srs_bp)
"""
from flask import Blueprint, request, jsonify
from services.srs_ai import generate_srs_summary

srs_bp = Blueprint("srs", __name__)

REQUIRED = ["date","risk_level","regime","score","track_A","track_B","track_C",
            "dominant_signal","indicators","key_flags"]


@srs_bp.route("/api/analyze/srs", methods=["POST"])
def analyze_srs():
    """POST /api/analyze/srs -- SRSInput JSON -> SRSOutput JSON"""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400
    missing = [f for f in REQUIRED if f not in data]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    result = generate_srs_summary(data)
    if "error" in result:
        status = 400 if "Invalid SRS" in result["error"] else 502
        return jsonify(result), status
    return jsonify(result), 200
