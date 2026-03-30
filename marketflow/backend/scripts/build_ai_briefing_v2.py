"""
build_ai_briefing_v2.py
4-section AI briefing — multi-provider (Anthropic → Gemini → OpenAI)
Output: backend/output/cache/ai_briefing_v2.json

Sections:
  1. market_structure  — phase / gate / trend synthesis
  2. sector_flow       — leaders vs laggards
  3. risk_radar        — shock prob / defensive trigger
  4. watch_signals     — exposure guidance + watchlist

Run: python3 marketflow/backend/scripts/build_ai_briefing_v2.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── Path setup ──────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CACHE_DIR = BACKEND_DIR / "output" / "cache"
OUTPUT_DIR = BACKEND_DIR / "output"
OUT_PATH = CACHE_DIR / "ai_briefing_v2.json"

# ── Provider config ───────────────────────────────────────────────────────────
PROVIDERS = {
    "anthropic": {
        "model": "claude-haiku-4-5-20251001",
        "price_in":  0.80 / 1_000_000,
        "price_out": 4.00 / 1_000_000,
        "env_key": "ANTHROPIC_API_KEY",
    },
    "gemini": {
        "model": "gemini-2.0-flash",
        "price_in":  0.10 / 1_000_000,
        "price_out": 0.40 / 1_000_000,
        "env_key": "GOOGLE_API_KEY",
    },
    "openai": {
        "model": "gpt-4o-mini",
        "price_in":  0.15 / 1_000_000,
        "price_out": 0.60 / 1_000_000,
        "env_key": "OPENAI_API_KEY",
    },
}

# ── Signal color map ──────────────────────────────────────────────────────────
SIGNAL_COLOR = {
    "bull":    "#22c55e",
    "caution": "#f59e0b",
    "bear":    "#ef4444",
    "neutral": "#64748b",
}

SECTION_META = {
    "market_structure": {"title_ko": "시장 구조",     "title_en": "Market Structure"},
    "sector_flow":      {"title_ko": "섹터 흐름",     "title_en": "Sector Flow"},
    "risk_radar":       {"title_ko": "리스크 레이더", "title_en": "Risk Radar"},
    "watch_signals":    {"title_ko": "주목 신호",     "title_en": "Watch Signals"},
}


# ── Data loaders ──────────────────────────────────────────────────────────────
def load(fname: str, fallback: Any = None) -> Any:
    for base in [CACHE_DIR, OUTPUT_DIR]:
        p = base / fname
        if p.exists():
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    return fallback or {}


# ── .env loader ───────────────────────────────────────────────────────────────
def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    env_path = BACKEND_DIR / ".env"
    if env_path.exists():
        with open(env_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip().strip('"').strip("'")
    # os.environ takes priority
    for k in list(env.keys()):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


# ── Context builder ───────────────────────────────────────────────────────────
def build_context() -> str:
    ms   = load("market_state.json")
    re_  = load("risk_engine.json")
    sp   = load("sector_performance.json", {"sectors": []})
    act  = load("action_snapshot.json")
    news = load("context_news.json")

    phase     = ms.get("phase", {})
    gate      = ms.get("gate", {})
    risk      = ms.get("risk", {})
    trend     = ms.get("trend", {})
    data_date = ms.get("data_date", "N/A")

    shock = re_.get("shock_probability", {})
    dtrig = re_.get("defensive_trigger", {})
    ptran = re_.get("phase_transition", {})
    tail  = re_.get("tail_risk", {})

    sectors = sp.get("sectors", [])
    by_1d   = sorted(sectors, key=lambda x: x.get("change_1d", 0), reverse=True)
    leaders  = by_1d[:3]
    laggards = by_1d[-3:]

    eg = act.get("exposure_guidance", {})
    wm = act.get("watchlist_moves", [])[:4]

    sens = news.get("sensor_snapshot", {})
    lpi  = sens.get("LPI", {})
    vri  = sens.get("VRI", {})
    mps  = sens.get("MPS", {})

    def sec_line(s: dict) -> str:
        return (f"  {s['symbol']:6} {s.get('name','')[:18]:18} "
                f"1d:{s.get('change_1d',0):+.1f}% "
                f"1w:{s.get('change_1w',0):+.1f}% "
                f"1m:{s.get('change_1m',0):+.1f}%")

    pct = trend.get("pct_from_sma200")
    trend_line = (
        f"QQQ {trend.get('qqq_close','?')} vs SMA200 {trend.get('qqq_sma200','?')} "
        f"({pct:+.1f}%)" if isinstance(pct, (int, float)) else trend.get("detail", "?")
    )

    lines = [
        f"=== MARKET STATE ({data_date}) ===",
        f"Phase: {phase.get('value','?')} | Gate: {gate.get('value','?')}/100 {gate.get('detail','')[:30]} | Risk: {risk.get('value','?')}",
        f"Trend: {trend_line}",
        "",
        "=== RISK ENGINE ===",
        f"Shock: {shock.get('value','?')}% ({shock.get('label','?')}, {shock.get('trend','?')})",
        f"Defensive: {dtrig.get('status','?')} — {dtrig.get('reason','?')[:60]}",
        f"Phase transition: {ptran.get('phase','?')} → {ptran.get('next_phase','?')} (active: {ptran.get('transition_signal','?')})",
        f"Tail: {tail.get('sigma','?')}σ {tail.get('label','?')} / {tail.get('skew_label','?')}",
        "",
        "=== SECTORS (1d/1w/1m) ===",
        "Leaders:",
        *[sec_line(s) for s in leaders],
        "Laggards:",
        *[sec_line(s) for s in laggards],
        "",
        "=== MACRO SENSORS ===",
        f"LPI:{lpi.get('status','?')}({lpi.get('value',0):.0f}) VRI:{vri.get('status','?')}({vri.get('value',0):.0f}) MPS:{mps.get('status','?')}({mps.get('value',0):.0f})",
        "",
        "=== ACTION ===",
        f"Guidance: {eg.get('action_label','?')} | Band: {eg.get('exposure_band','?')} | {eg.get('reason','?')}",
        "Watchlist: " + " | ".join(f"{w.get('symbol','?')} {w.get('chg_pct',0):+.1f}%" for w in wm),
    ]
    return "\n".join(lines)


# ── Prompts ───────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a professional financial market analyst writing a concise daily briefing for individual investors.

Rules:
- Korean (body_ko) and English (body_en): 2-3 sentences each, factual, analytical tone
- No price predictions, no trade calls, no "investors should..."
- No exclamation marks; use precise, measured language
- signal must be exactly one of: "bull", "caution", "bear", "neutral"
- tags: 2-3 short English keywords
- Respond ONLY with valid JSON, no markdown fences, no extra text"""

USER_TEMPLATE = """{context}

Generate a JSON object with exactly this structure (fill in all fields):
{{
  "sections": [
    {{
      "id": "market_structure",
      "body_ko": "2-3 Korean sentences about market phase, gate score, and trend",
      "body_en": "2-3 English sentences about market phase, gate score, and trend",
      "signal": "bull|caution|bear|neutral",
      "tags": ["tag1", "tag2"]
    }},
    {{
      "id": "sector_flow",
      "body_ko": "2-3 Korean sentences about sector rotation and leading/lagging sectors",
      "body_en": "2-3 English sentences about sector rotation and leading/lagging sectors",
      "signal": "bull|caution|bear|neutral",
      "tags": ["tag1", "tag2"]
    }},
    {{
      "id": "risk_radar",
      "body_ko": "2-3 Korean sentences about shock probability, defensive trigger, tail risk",
      "body_en": "2-3 English sentences about shock probability, defensive trigger, tail risk",
      "signal": "bull|caution|bear|neutral",
      "tags": ["tag1", "tag2"]
    }},
    {{
      "id": "watch_signals",
      "body_ko": "2-3 Korean sentences about exposure guidance and watchlist moves",
      "body_en": "2-3 English sentences about exposure guidance and watchlist moves",
      "signal": "bull|caution|bear|neutral",
      "tags": ["tag1", "tag2"]
    }}
  ]
}}"""


# ── LLM callers ───────────────────────────────────────────────────────────────
def call_anthropic(api_key: str, context: str) -> tuple[str, int, int]:
    import anthropic
    cfg = PROVIDERS["anthropic"]
    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=cfg["model"],
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": USER_TEMPLATE.format(context=context)}],
    )
    return resp.content[0].text.strip(), resp.usage.input_tokens, resp.usage.output_tokens


def call_gemini(api_key: str, context: str) -> tuple[str, int, int]:
    import google.genai as genai
    cfg = PROVIDERS["gemini"]
    client = genai.Client(api_key=api_key)
    full_prompt = f"{SYSTEM_PROMPT}\n\n{USER_TEMPLATE.format(context=context)}"
    resp = client.models.generate_content(model=cfg["model"], contents=full_prompt)
    text = resp.text.strip()
    # google-genai usage metadata
    usage = getattr(resp, "usage_metadata", None)
    in_tok  = getattr(usage, "prompt_token_count", 0) or 0
    out_tok = getattr(usage, "candidates_token_count", 0) or 0
    return text, in_tok, out_tok


def call_openai(api_key: str, context: str) -> tuple[str, int, int]:
    from openai import OpenAI
    cfg = PROVIDERS["openai"]
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=cfg["model"],
        max_tokens=1024,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": USER_TEMPLATE.format(context=context)},
        ],
        response_format={"type": "json_object"},
    )
    text = resp.choices[0].message.content.strip()
    return text, resp.usage.prompt_tokens, resp.usage.completion_tokens


# ── JSON parser ───────────────────────────────────────────────────────────────
def parse_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
        if m:
            return json.loads(m.group(1))
        raise


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    env = load_env()

    # Provider selection
    provider = None
    for name in ["anthropic", "openai", "gemini"]:
        key_name = PROVIDERS[name]["env_key"]
        if env.get(key_name):
            provider = name
            api_key  = env[key_name]
            break

    if provider is None:
        print("ERROR: No API key found. Set ANTHROPIC_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY in .env",
              file=sys.stderr)
        sys.exit(1)

    cfg = PROVIDERS[provider]
    print(f"[build_ai_briefing_v2] provider={provider} model={cfg['model']}")

    context = build_context()
    print(f"[build_ai_briefing_v2] context: {len(context)} chars")

    # LLM call with fallback
    callers = {"anthropic": call_anthropic, "gemini": call_gemini, "openai": call_openai}
    raw, in_tok, out_tok = None, 0, 0
    tried = [provider]
    try:
        raw, in_tok, out_tok = callers[provider](api_key, context)
    except Exception as e:
        print(f"[build_ai_briefing_v2] {provider} failed: {e.__class__.__name__} — trying fallback")
        for fb_name in ["anthropic", "openai", "gemini"]:
            if fb_name in tried:
                continue
            fb_key = env.get(PROVIDERS[fb_name]["env_key"], "")
            if not fb_key:
                continue
            print(f"[build_ai_briefing_v2] fallback -> {fb_name}")
            tried.append(fb_name)
            try:
                raw, in_tok, out_tok = callers[fb_name](fb_key, context)
                provider = fb_name
                cfg = PROVIDERS[fb_name]
                break
            except Exception as e2:
                print(f"[build_ai_briefing_v2] {fb_name} also failed: {e2.__class__.__name__}")
    if raw is None:
        print("ERROR: All providers failed", file=sys.stderr)
        sys.exit(1)
    cost = in_tok * cfg["price_in"] + out_tok * cfg["price_out"]
    print(f"[build_ai_briefing_v2] tokens: in={in_tok} out={out_tok} cost=${cost:.5f}")

    # Parse
    parsed = parse_json(raw)

    # Enrich sections
    sections = parsed.get("sections", [])
    for sec in sections:
        sid  = sec.get("id", "")
        meta = SECTION_META.get(sid, {})
        sec["title_ko"] = meta.get("title_ko", sid)
        sec["title_en"] = meta.get("title_en", sid)
        sec["color"]    = SIGNAL_COLOR.get(sec.get("signal", "neutral"), "#64748b")

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_date":    load("market_state.json").get("data_date", ""),
        "provider":     provider,
        "model":        cfg["model"],
        "tokens": {
            "input":    in_tok,
            "output":   out_tok,
            "cost_usd": round(cost, 6),
        },
        "sections": sections,
    }

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"[build_ai_briefing_v2] saved -> {OUT_PATH}")
    for sec in sections:
        print(f"  [{sec['id']}] signal={sec.get('signal','?')} color={sec.get('color')} tags={sec.get('tags',[])} ")


if __name__ == "__main__":
    main()
