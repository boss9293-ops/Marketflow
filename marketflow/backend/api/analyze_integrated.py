"""
Integrated AI Analysis endpoint -- Flask Blueprint.
Route: POST /api/analyze/integrated
Uses Gemini (GOOGLE_API_KEY) with GPT fallback.
"""
import json
import re
import time
from flask import Blueprint, request, jsonify
from ai import gemini_client, gpt_client

integrated_bp = Blueprint("integrated", __name__)

SYSTEM_PROMPT = (
    "You are a senior market analyst providing structured risk interpretation. "
    "Rules: DO NOT issue trading instructions, price targets, or buy/sell signals. "
    "Provide regime-based analysis only. Use concise, institutional language. "
    "Return ONLY valid JSON — no markdown fences, no text outside the JSON."
)

USER_TEMPLATE = """Current market reading:

Date:             {date}
MSS Score:        {score}  (100=neutral, higher=healthier, lower=deteriorating)
Risk Level:       {risk_level}
Regime:           {regime}
Price:            {price:.2f}
MA200:            {ma200:.2f}
Drawdown:         {dd_pct:.1f}%

Tracks:
  Track A (Credit/Liquidity): {track_A}
  Track B (Momentum/MSS):     {track_B}
  Track C (Exogenous):        {track_C}

Dominant Signal:  {dominant_signal}
VR Engine State:  {vr_state}
Crash Trigger:    {crash_trigger}
Active Flags:     {flags_block}

Return ONLY this JSON (fill all values, no markdown):
{{
  "market_summary":     "<2 sentence market state description>",
  "regime_assessment":  "<1-2 sentence regime characterization>",
  "vr_assessment":      "<1-2 sentence VR engine state explanation>",
  "combined_assessment":"<2 sentence integrated view>",
  "allowed_actions":    ["<action1>", "<action2>"],
  "cautions":           ["<caution1>", "<caution2>"],
  "key_drivers":        ["<driver1>", "<driver2>", "<driver3>"],
  "similar_cases":      ["<historical case1>", "<historical case2>"],
  "scenarios": [
    {{"name": "<scenario>", "prob": 0.XX, "description": "<1 sentence>"}},
    {{"name": "<scenario>", "prob": 0.XX, "description": "<1 sentence>"}},
    {{"name": "<scenario>", "prob": 0.XX, "description": "<1 sentence>"}}
  ],
  "recommendation":     "<risk management note — NO trading instructions>",
  "evidence":           ["<evidence1>", "<evidence2>", "<evidence3>"],
  "contradictions":     ["<contradiction1>", "<contradiction2>"]
}}"""


def _parse_json(text: str) -> dict:
    """Extract JSON from AI response, stripping any markdown fences."""
    # Strip markdown fences
    text = re.sub(r"^$", "", text.strip(), flags=re.MULTILINE)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object
        m = re.search(r"\{[\s\S]+\}", text)
        if m:
            return json.loads(m.group(0))
        raise


def _build_prompt(data: dict) -> str:
    dd_raw = data.get("dd5", 0) or 0
    dd_pct = float(dd_raw) * 100 if abs(float(dd_raw)) <= 1 else float(dd_raw)
    flags = data.get("key_flags") or []
    flags_block = ", ".join(flags) if flags else "None"
    return USER_TEMPLATE.format(
        date=data.get("date", "N/A"),
        score=data.get("score", 100),
        risk_level=data.get("risk_level", "Unknown"),
        regime=data.get("regime", "Unknown"),
        price=float(data.get("price", 0) or 0),
        ma200=float(data.get("ma200", 0) or 0),
        dd_pct=dd_pct,
        track_A=data.get("track_A", "N/A"),
        track_B=data.get("track_B", "N/A"),
        track_C=data.get("track_C", "N/A"),
        dominant_signal=data.get("dominant_signal", "HOLD"),
        vr_state=data.get("vr_state", "NORMAL"),
        crash_trigger=data.get("crash_trigger", False),
        flags_block=flags_block,
    )


def _call_ai(user_prompt: str) -> tuple[dict, str, str, int]:
    """Try GPT first, fall back to Gemini. Returns (parsed, provider, model, latency_ms)."""
    start = time.perf_counter()

    # Primary: GPT (OpenAI)
    result = gpt_client.generate_text(
        task="integrated_analysis",
        system=SYSTEM_PROMPT,
        user=user_prompt,
        temperature=0.25,
        max_tokens=1200,
    )
    latency_ms = int((time.perf_counter() - start) * 1000)

    if result.text and not result.error:
        try:
            return _parse_json(result.text), result.provider, result.model, latency_ms
        except Exception:
            pass  # fall through to Gemini

    # Fallback: Gemini
    start2 = time.perf_counter()
    result2 = gemini_client.generate_text(
        task="integrated_analysis",
        system=SYSTEM_PROMPT,
        user=user_prompt,
        temperature=0.25,
        max_tokens=1200,
    )
    latency_ms2 = int((time.perf_counter() - start2) * 1000)

    if result2.text and not result2.error:
        try:
            return _parse_json(result2.text), result2.provider, result2.model, latency_ms2
        except Exception as e:
            raise ValueError(f"Failed to parse AI response: {e}") from e

    err = result2.error or result.error or "AI service unavailable"
    raise ConnectionError(err)


@integrated_bp.route("/api/analyze/integrated", methods=["POST"])
def analyze_integrated():
    """POST /api/analyze/integrated — full integrated AI analysis."""
    data = request.get_json(silent=True) or {}

    try:
        user_prompt = _build_prompt(data)
        parsed, provider, model, latency_ms = _call_ai(user_prompt)
    except ConnectionError as e:
        return jsonify({"error": str(e), "_route_error_code": "flask_unreachable"}), 502
    except ValueError as e:
        return jsonify({"error": str(e), "_route_error_code": "unknown"}), 500
    except Exception as e:
        return jsonify({"error": f"Analysis failed: {e}", "_route_error_code": "unknown"}), 500

    # Ensure all required fields exist with safe defaults
    def s(key, default=""):
        v = parsed.get(key, default)
        return v if isinstance(v, type(default)) else default

    response = {
        "market_summary":     s("market_summary"),
        "regime_assessment":  s("regime_assessment"),
        "vr_assessment":      s("vr_assessment"),
        "combined_assessment":s("combined_assessment"),
        "allowed_actions":    s("allowed_actions", []),
        "cautions":           s("cautions", []),
        "key_drivers":        s("key_drivers", []),
        "similar_cases":      s("similar_cases", []),
        "scenarios":          s("scenarios", []),
        "recommendation":     s("recommendation"),
        "evidence":           s("evidence", []),
        "contradictions":     s("contradictions", []),
        "_meta": {
            "provider":   provider,
            "model":      model,
            "latency_ms": latency_ms,
        },
    }
    return jsonify(response), 200
