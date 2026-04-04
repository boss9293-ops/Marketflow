from __future__ import annotations
import sqlite3
from flask import Blueprint, jsonify, request
from db_utils import core_db_path, canonical_symbol

vr_ohlcv_bp = Blueprint("vr_ohlcv", __name__)


@vr_ohlcv_bp.route("/api/vr-ohlcv/<path:symbol>", methods=["GET"])
def vr_ohlcv(symbol: str):
    """
    GET /api/vr-ohlcv/TQQQ
    Returns OHLCV bars for VR G-Value simulator (client-side backtest).
    Response: { symbol, bars: [{d, o, h, l, c, v}] }
    """
    sym = canonical_symbol(symbol)
    limit = 5000  # ~20 years max
    try:
        conn = sqlite3.connect(core_db_path())
        rows = conn.execute(
            """SELECT date, open, high, low, close, volume
               FROM ohlcv_daily
               WHERE symbol = ?
               ORDER BY date ASC
               LIMIT ?""",
            (sym, limit),
        ).fetchall()
        conn.close()
        if not rows:
            return jsonify({"error": f"No data for {sym}"}), 404
        bars = [
            {"d": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
            for r in rows
        ]
        return jsonify({"symbol": sym, "bars": bars, "count": len(bars)})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
