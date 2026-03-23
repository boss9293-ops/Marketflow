"""
SRS AI Service -- Claude-based structured risk analysis.
"""
import json
import re
from typing import Optional

from ai import gpt_client
from schemas.srs_schema import SRSInput, SRSOutput, SRSScenario

SYSTEM_PROMPT = (
    "You are a senior financial risk analyst, NOT a trader.\n\n"
    "Rules:\n"
    "- DO NOT issue buy/sell orders or price targets\n"
    "- Provide scenario-based probabilistic analysis only\n"
    "- MUST include minimum 3 evidence points\n"
    "- MUST include contradictions (reasons risk may be lower)\n"
    "- All scenario probabilities must sum to 1.0\n"
    "- Use concise, professional language\n\n"
    "Return ONLY valid JSON -- no markdown fences, no text outside the JSON."
)

USER_TEMPLATE = (
    "Current SRS reading:\n\n"
    "Date:             {date}\n"
    "Risk Level:       {risk_level}\n"
    "Regime:           {regime}\n"
    "SRS Score:        {score}  (100=neutral; higher=healthier; lower=deteriorating)\n\n"
    "Tracks:\n"
    "  Track A: {track_A}\n"
    "  Track B: {track_B}\n"
    "  Track C: {track_C}\n\n"
    "Dominant Signal:  {dominant_signal}\n\n"
    "Live Indicators:\n"
    "{indicators_block}\n\n"
    "Active Flags:\n"
    "{flags_block}\n\n"
    "Return ONLY this JSON structure (fill in all values):\n"
    "{{\n"
    '  "regime_summary":  "<1-2 sentence regime description>",\n'
    '  "risk_assessment": "<1-2 sentence risk explanation>",\n'
    '  "key_drivers":     ["<driver1>", "<driver2>", "<driver3>"],\n'
    '  "similar_cases":   ["<case1>", "<case2>"],\n'
    '  "scenarios": [\n'
    '    {{"name": "<scenario>", "prob": 0.XX, "description": "<1 sentence>"}},\n'
    '    {{"name": "<scenario>", "prob": 0.XX, "description": "<1 sentence>"}},\n'
    '    {{"name": "<scenario>", "prob": 0.XX, "description": "<1 sentence>"}}\n'
    '  ],\n'
    '  "recommendation": "<risk management note -- NO trading orders>",\n'
    '  "evidence":        ["<ev1>", "<ev2>", "<ev3>"],\n'
    '  "contradictions":  ["<contr1>", "<contr2>"]\n'
    "}}"
)


def _build_prompt(inp: SRSInput) -> str:
    indicators_block = "\n".join(f"  {k}: {v}" for k, v in inp.indicators.items()) or "  (none)"
    flags_block = "\n".join(f"  - {f}" for f in inp.key_flags) or "  (none)"
    return USER_TEMPLATE.format(
        date=inp.date, risk_level=inp.risk_level, regime=inp.regime, score=inp.score,
        track_A=inp.track_A, track_B=inp.track_B, track_C=inp.track_C,
        dominant_signal=inp.dominant_signal,
        indicators_block=indicators_block, flags_block=flags_block,
    )


def _parse(text: str) -> Optional[SRSOutput]:
    clean = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    clean = re.sub(r"\s*```$", "", clean.strip())
    try:
        data = json.loads(clean)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]+\}", clean)
        if not m:
            return None
        try:
            data = json.loads(m.group())
        except json.JSONDecodeError:
            return None
    scenarios = [
        SRSScenario(name=s.get("name",""), prob=float(s.get("prob",0)), description=s.get("description",""))
        for s in (data.get("scenarios") or [])
    ]
    return SRSOutput(
        regime_summary=data.get("regime_summary",""),
        risk_assessment=data.get("risk_assessment",""),
        key_drivers=data.get("key_drivers") or [],
        similar_cases=data.get("similar_cases") or [],
        scenarios=scenarios,
        recommendation=data.get("recommendation",""),
        evidence=data.get("evidence") or [],
        contradictions=data.get("contradictions") or [],
    )


def generate_srs_summary(srs_input: dict) -> dict:
    """Main entry point. Accepts dict, returns JSON-serialisable dict."""
    try:
        inp = SRSInput.from_dict(srs_input)
    except (KeyError, TypeError, ValueError) as exc:
        return {"error": f"Invalid SRS input: {exc}"}

    result = gpt_client.generate_text(
        task="srs_ai_summary",
        system=SYSTEM_PROMPT,
        user=_build_prompt(inp),
        temperature=0.3,
        max_tokens=1200,
    )
    if result.error:
        return {"error": result.error, "provider": result.provider, "model": result.model}

    parsed = _parse(result.text)
    if parsed is None:
        return {"error": "Failed to parse AI response", "raw": result.text,
                "provider": result.provider, "model": result.model}

    out = parsed.to_dict()
    out["_meta"] = {"provider": result.provider, "model": result.model,
                    "latency_ms": result.latency_ms, "date": inp.date}
    return out
