"""
build_daily_briefing_v3.py
Daily Briefing Narrative Engine V3

Structure:
  Hook              rule-based: market tone + dominant catalyst
  market_flow       broad market pulse, phase, participation
  event_drivers     headlines, earnings, scheduled events
  sector_structure  leaders/laggards, rotation, breadth
  macro_commodities rates, DXY, VIX, gold, oil, BTC
  stock_moves       movers and watchlist names
  economic_data     actual vs expected releases
  technical_regime  MSS level, zone, components, risk overlay
  Risk Check        explicit risk overlay only
  One Line          rule-based compression from sections

Output: backend/output/cache/daily_briefing_v3.json
Run:    python3 marketflow/backend/scripts/build_daily_briefing_v3.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

try:
    from backend.services.data_contract import artifact_path as contract_artifact_path
except Exception:
    contract_artifact_path = None  # type: ignore[assignment]

# ?? Paths ????????????????????????????????????????????????????????????????????
SCRIPT_DIR  = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CACHE_DIR   = BACKEND_DIR / "output" / "cache"
OUTPUT_DIR  = BACKEND_DIR / "output"


def artifact_path(relative_path: str) -> Path:
    rel = str(relative_path or "").replace("\\", "/").strip("/")
    if contract_artifact_path is not None:
        try:
            return Path(contract_artifact_path(rel)).resolve()
        except Exception:
            pass
    if not rel:
        return OUTPUT_DIR.resolve()
    if rel.startswith("cache/"):
        return (CACHE_DIR / rel[len("cache/"):]).resolve()
    return (OUTPUT_DIR / Path(rel)).resolve()


OUT_PATH    = artifact_path("cache/daily_briefing_v3.json")
FRONTEND_HEADLINE_CACHE_PATH = artifact_path("cache/market-headlines-history.json")
LEGACY_FRONTEND_HEADLINE_CACHE_PATH = BACKEND_DIR.parent / "frontend" / ".cache" / "market-headlines-history.json"

# ?? Model & pricing ??????????????????????????????????????????????????????????
MODEL_ID   = "claude-haiku-4-5-20251001"
PRICE_IN   = 0.80  / 1_000_000   # per token
PRICE_OUT  = 4.00  / 1_000_000

SIGNAL_COLOR = {
    "bull":    "#22c55e",
    "caution": "#f59e0b",
    "bear":    "#ef4444",
    "neutral": "#64748b",
}

SECTION_META = [
    ("market_flow",       "Market Pulse"),
    ("event_drivers",     "News & Catalysts"),
    ("sector_structure",  "Sector Rotation"),
    ("macro_commodities", "Macro & Rates"),
    ("stock_moves",       "Movers & Watchlist"),
    ("economic_data",     "Earnings & Calendar"),
    ("technical_regime",  "Risk & Regime"),
]

MAJOR_NEWS_SOURCES = {"Reuters", "Bloomberg", "Financial Times", "WSJ", "CNBC", "Yahoo Finance"}
GEO_KEYWORDS = ("iran", "hormuz", "strait", "middle east", "strike", "attack", "war")
POLICY_KEYWORDS = ("trump", "tariff", "speech", "address", "fed", "powell")
TESLA_KEYWORDS = ("tesla", "tsla", "deliveries", "cybertruck")
ET_ZONE = ZoneInfo("America/New_York")
MARKET_OPEN_MINUTES_ET = 9 * 60 + 30
MARKET_CLOSE_MINUTES_ET = 16 * 60 + 30


# ?? Data loaders ??????????????????????????????????????????????????????????????
def load(fname: str, search_dirs: list[Path] | None = None) -> Any:
    dirs = search_dirs or [CACHE_DIR, OUTPUT_DIR]
    for d in dirs:
        p = d / fname
        if p.exists():
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    return {}


def load_frontend_headline_cache() -> list[dict[str, Any]]:
    candidates = [FRONTEND_HEADLINE_CACHE_PATH, LEGACY_FRONTEND_HEADLINE_CACHE_PATH]
    seen: set[str] = set()
    for candidate in candidates:
        candidate_str = str(candidate)
        if not candidate_str or candidate_str in seen:
            continue
        seen.add(candidate_str)
        if not candidate.exists():
            continue
        try:
            with open(candidate, encoding="utf-8") as f:
                payload = json.load(f)
            rows = payload.get("headlines", []) if isinstance(payload, dict) else []
            if rows:
                return [r for r in rows if isinstance(r, dict)]
        except Exception:
            continue
    return []


def _shorten(text: str, limit: int = 180) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    return text if len(text) <= limit else (text[: limit - 1].rstrip() + "…")


def build_headline_focus(front_headlines: list[dict[str, Any]]) -> tuple[str, str, str]:
    """
    Returns:
      headline_tape: prioritized headline lines for prompt context
      mandatory_drivers: must-mention narrative drivers
      hook_driver: one-line primary catalyst for the hook
    """
    if not front_headlines:
        return "No live headline tape available.", "None.", ""

    scored: list[tuple[int, int, dict[str, Any]]] = []
    for idx, row in enumerate(front_headlines[:120]):
        headline = str(row.get("headline") or "").strip()
        source = str(row.get("source") or "").strip()
        summary = str(row.get("summary") or "").strip()
        if not headline:
            continue
        text = f"{headline} {summary}".lower()
        score = 0
        if any(k in text for k in GEO_KEYWORDS):
            score += 6
        if any(k in text for k in POLICY_KEYWORDS):
            score += 4
        if any(k in text for k in TESLA_KEYWORDS):
            score += 5
        if source in MAJOR_NEWS_SOURCES:
            score += 2
        if idx < 25:
            score += 1
        scored.append((score, idx, row))

    scored.sort(key=lambda item: (-item[0], item[1]))
    top_rows = [row for _, _, row in scored[:10]]

    tape_lines: list[str] = []
    seen = set()
    for row in top_rows:
        headline = _shorten(str(row.get("headline") or ""))
        source = str(row.get("source") or "Unknown")
        time_et = str(row.get("timeET") or "").strip()
        key = headline.lower()
        if not headline or key in seen:
            continue
        seen.add(key)
        tape_lines.append(f"{time_et or '--:-- ET'} | {source} | {headline}")
        if len(tape_lines) >= 6:
            break
    if not tape_lines:
        tape_lines = ["No usable headline records in cache."]

    lower_tape = " ".join(tape_lines).lower()
    mandatory: list[str] = []
    if any(k in lower_tape for k in ("trump", "iran", "hormuz", "strait")):
        mandatory.append(
            "Geopolitical driver: Trump/Iran/Hormuz headlines must be explained with a transmission chain (oil risk premium -> rates/volatility -> equity reaction)."
        )
    if any(k in lower_tape for k in ("tesla", "tsla", "deliveries")):
        mandatory.append(
            "Stock-specific driver: TSLA delivery/news impact must be explicitly discussed (not just listed as % move)."
        )
    if not mandatory:
        mandatory.append("Use one dominant catalyst from the headline tape and explain causal transmission to price action.")

    hook_driver = ""
    for row in top_rows:
        h = str(row.get("headline") or "")
        if any(k in h.lower() for k in ("trump", "iran", "hormuz", "tesla", "tsla", "deliver")):
            hook_driver = _shorten(h, 140)
            break
    if not hook_driver and top_rows:
        hook_driver = _shorten(str(top_rows[0].get("headline") or ""), 140)

    return "\n".join(tape_lines), "\n".join(f"- {m}" for m in mandatory), hook_driver


# ?? Movers filter: only real exchange stocks price > $1 ???????????????????????
_REAL_EXCHANGES = {"NASDAQ", "NYSE", "NYSE ARCA", "AMEX", "BATS"}

def filter_movers(categories: dict) -> list[dict]:
    seen: set[str] = set()
    result: list[dict] = []
    for cat in ("gainers", "most_active", "unusual_volume"):
        for item in categories.get(cat, []):
            sym = item.get("symbol", "")
            if sym in seen:
                continue
            exch  = item.get("exchange", "")
            price = item.get("price", 0.0) or 0.0
            rvol = item.get("relative_volume_10d_calc") or 0
            if exch in _REAL_EXCHANGES and price >= 5.0 and rvol >= 0.3:
                seen.add(sym)
                result.append({**item, "_cat": cat})
            if len(result) >= 20:
                return result
    return result


def fmt_pct(v: Any) -> str:
    if v is None:
        return "N/A"
    try:
        return f"{float(v):+.2f}%"
    except (TypeError, ValueError):
        return str(v)


def _current_briefing_slot(now: datetime | None = None) -> str:
    ref = now or datetime.now(timezone.utc)
    local_now = ref.astimezone(ET_ZONE)
    minutes = local_now.hour * 60 + local_now.minute
    if minutes < MARKET_OPEN_MINUTES_ET:
        return "preopen"
    if minutes < MARKET_CLOSE_MINUTES_ET:
        return "morning"
    return "close"


# ?? Context builder ???????????????????????????????????????????????????????????
def build_context(
    ms: dict, rv1: dict, re_data: dict,
    sp: dict, econ_cal: dict, earnings: dict,
    movers: dict, news: dict,
) -> dict[str, str]:
    """Returns a dict keyed by section id -> data string."""

    data_date = ms.get("data_date") or rv1.get("data_as_of") or "N/A"
    front_headlines = load_frontend_headline_cache()
    headline_tape, mandatory_drivers, hook_driver = build_headline_focus(front_headlines)

    # Market Flow
    phase = ms.get("phase", {})
    gate  = ms.get("gate",  {})
    risk  = ms.get("risk",  {})
    trend = ms.get("trend", {})

    # Prices from economic_calendar (it stores market snapshot)
    econ_events = econ_cal.get("events", [])
    price_map: dict[str, dict] = {}
    for ev in econ_events:
        price_map[ev.get("event", "")] = ev

    def ev_actual(key: str) -> str:
        for name, ev in price_map.items():
            if key.lower() in name.lower():
                return ev.get("actual", "N/A")
        return "N/A"

    spy_actual = ev_actual("S&P 500")
    qqq_actual = ev_actual("NASDAQ 100")
    iwm_actual = ev_actual("Russell 2000")

    mf_lines = [
        f"SPY: {spy_actual}",
        f"QQQ: {qqq_actual}",
        f"IWM: {iwm_actual}",
    ]
    if phase:
        mf_lines.append(f"Market phase: {phase.get('value','?')}")
    if gate:
        mf_lines.append(f"Gate score: {gate.get('value','?')}/100  detail: {gate.get('detail','')[:50]}")
    if trend:
        pct = trend.get("pct_from_sma200")
        close_ = trend.get("qqq_close")
        sma200 = trend.get("qqq_sma200")
        if pct is not None:
            mf_lines.append(f"QQQ vs SMA200: {fmt_pct(pct)}  (close {close_} vs SMA200 {sma200})")
    if risk:
        mf_lines.append(f"Session note: {risk.get('value','?')}")

    # Event Drivers
    # Priority 1: news selected_themes
    themes = news.get("selected_themes", []) or []
    articles = news.get("articles", []) or []

    # Priority 2: earnings
    earns = earnings.get("earnings", []) or []
    earn_lines: list[str] = []
    for e in earns[:6]:
        sym   = e.get("symbol", "?")
        name  = e.get("company", e.get("name", "?"))
        date  = e.get("date", "?")
        timing = e.get("timing", "")
        earn_lines.append(f"  {sym} ({name}) | {date} {timing}")

    # Priority 3: real macro events (filter out price data entries)
    _price_keywords = {"S&P", "NASDAQ", "Russell", "Treasury", "VIX", "Dollar", "Gold", "Crude", "Bitcoin"}
    real_events = [
        ev for ev in econ_events
        if not any(kw.lower() in ev.get("event", "").lower() for kw in _price_keywords)
    ]

    ed_lines: list[str] = []
    if themes:
        ed_lines.append("News themes: " + ", ".join(themes[:5]))
    if articles:
        for a in articles[:4]:
            title = a.get("title") or a.get("headline") or str(a)[:80]
            ed_lines.append(f"  - {title}")
    if earn_lines:
        ed_lines.append("Earnings:")
        ed_lines.extend(earn_lines)
    if real_events:
        ed_lines.append("Economic events:")
        for ev in real_events[:5]:
            ed_lines.append(f"  {ev.get('date','?')} {ev.get('time','?')}  {ev.get('event','?')}  actual={ev.get('actual','-')}  forecast={ev.get('forecast','-')}")
    if not ed_lines:
        ed_lines.append("No major scheduled events or news themes today.")

    if front_headlines:
        ed_lines.append("Headline tape:")
        for h in headline_tape.splitlines()[:3]:
            ed_lines.append(f"  {h}")

    # Sector Structure
    sectors = sp.get("sectors", [])
    sorted_1d = sorted(sectors, key=lambda x: x.get("change_1d", 0), reverse=True)
    leaders  = sorted_1d[:3]
    laggards = sorted_1d[-3:]

    def sector_str(s: dict) -> str:
        return (f"  {s.get('symbol','?')} {s.get('name','')[:14]:14} "
                f"1d:{s.get('change_1d',0):+.1f}%  1w:{s.get('change_1w',0):+.1f}%  1m:{s.get('change_1m',0):+.1f}%")

    ss_lines = (
        ["Leaders:"]  + [sector_str(s) for s in leaders] +
        ["Laggards:"] + [sector_str(s) for s in laggards]
    )

    # Macro & Commodities
    us10y = ev_actual("US 10Y")
    vix   = ev_actual("VIX")
    dxy   = ev_actual("Dollar")
    gold  = ev_actual("Gold")
    oil   = ev_actual("Crude")
    btc   = ev_actual("Bitcoin")

    mc_lines = [
        f"US 10Y Yield:  {us10y}",
        f"VIX:           {vix}",
        f"DXY (Dollar):  {dxy}",
        f"Gold:          {gold}",
        f"Crude Oil:     {oil}",
        f"Bitcoin:       {btc}",
    ]

    # Key Stocks
    # Leveraged ETFs + mega-cap watchlist from core_price_snapshot
    cps_data  = load("core_price_snapshot_latest.json")
    cps_map   = {r["symbol"]: r for r in cps_data.get("records", [])}
    action_snapshot = load("action_snapshot.json")

    LEVERAGE_WATCH = [
        ("TQQQ", "3x QQQ (ProShares)"),
        ("SOXL", "3x Semi (Direxion)"),
        ("SMH",  "VanEck Semiconductor ETF"),
        ("QQQ",  "Invesco QQQ"),
    ]
    MEGA_CAPS = ["TSLA", "NVDA", "MSFT", "AAPL", "AMZN", "META"]

    sm_lines: list[str] = ["=== LEVERAGED & SECTOR ETFs ==="]
    for sym, label in LEVERAGE_WATCH:
        r = cps_map.get(sym)
        if r:
            sm_lines.append(f"  {sym:6} {label:30} ${r['price']:.2f}  {r['change_pct']:+.2f}%")

    sm_lines.append("=== MEGA-CAP WATCH ===")
    for sym in MEGA_CAPS:
        r = cps_map.get(sym)
        if r:
            sm_lines.append(f"  {sym:6} {r['name'][:28]:28} ${r['price']:.2f}  {r['change_pct']:+.2f}%")

    # Notable movers (filtered, price >= $5, real exchanges)
    categories = movers.get("categories", {})
    filtered   = filter_movers(categories)
    if filtered:
        sm_lines.append("=== NOTABLE MOVERS (NASDAQ/NYSE, price >$5) ===")
        for item in filtered[:10]:
            sym  = item.get("symbol", "?")
            name = item.get("name", "")[:24]
            chg  = item.get("change_pct", 0)
            rvol = item.get("relative_volume_10d_calc") or 0
            # skip if already in mega-cap list
            if sym in MEGA_CAPS or sym in [w[0] for w in LEVERAGE_WATCH]:
                continue
            sm_lines.append(f"  {sym:8} {name:24} ${item['price']:.2f}  {chg:+.2f}%  rvol={rvol:.1f}x")
    else:
        sm_lines.append("No significant movers above filter threshold today.")

    watchlist_moves = action_snapshot.get("watchlist_moves", []) if isinstance(action_snapshot, dict) else []
    if watchlist_moves:
        sm_lines.append("=== WATCHLIST IMPACT ===")
        for row in watchlist_moves[:5]:
            sym = str(row.get("symbol", "?"))
            chg = row.get("chg_pct", None)
            badge = str(row.get("badge", ""))
            reason = str(row.get("badge_reason", ""))
            if chg is None:
                sm_lines.append(f"  {sym:6} {badge:10} {reason}")
            else:
                sm_lines.append(f"  {sym:6} {float(chg):+6.2f}%  {badge:10} {reason}")

    watchlist_focus_lines: list[str] = []
    for row in watchlist_moves[:5]:
        sym = str(row.get("symbol", "")).upper()
        if not sym:
            continue
        chg = row.get("chg_pct", None)
        reason = str(row.get("badge_reason", "")).strip()
        if chg is None:
            watchlist_focus_lines.append(f"{sym}: watchlist move available, reason={reason or 'n/a'}")
        else:
            watchlist_focus_lines.append(f"{sym}: {float(chg):+.2f}% ({reason or 'no reason'})")
    if not watchlist_focus_lines:
        watchlist_focus_lines.append("No watchlist move diagnostics available.")

    # Economic Data
    # Only real economic releases (CPI, NFP, FOMC, GDP, etc.)
    econ_data_lines: list[str] = []
    if real_events:
        for ev in real_events[:8]:
            actual_   = ev.get("actual", "-")
            forecast_ = ev.get("forecast", "-")
            surprise  = ""
            try:
                a_num = float(str(actual_).split()[0].replace("%","").replace(",",""))
                f_num = float(str(forecast_).split()[0].replace("%","").replace(",",""))
                diff  = a_num - f_num
                surprise = f"(surprise: {diff:+.2f})" if abs(diff) > 0.01 else "(in-line)"
            except Exception:
                pass
            econ_data_lines.append(
                f"  {ev.get('date','?')} | {ev.get('event','?'):30} "
                f"actual={actual_}  forecast={forecast_}  {surprise}"
            )
    if earns:
        econ_data_lines.append("Earnings reports in window:")
        for e in earns[:5]:
            sym  = e.get("symbol","?")
            eps  = e.get("eps_actual", e.get("eps","?"))
            est  = e.get("eps_estimate","?")
            rev  = e.get("revenue_actual", e.get("revenue","?"))
            econ_data_lines.append(f"  {sym}: EPS={eps} est={est}  Rev={rev}")
    if not econ_data_lines:
        econ_data_lines.append("No major economic data releases scheduled for this session.")

    # Technical & Regime
    curr = rv1.get("current", {})
    mss        = curr.get("score", "?")
    level      = curr.get("level", "?")
    level_label = curr.get("level_label", "?")
    zone       = curr.get("score_zone", "?")
    vol_pct    = curr.get("vol_pct", None)
    dd_pct     = curr.get("dd_pct", None)

    # Track A / B status
    track_a = rv1.get("track_a", [])
    track_b = rv1.get("track_b", [])

    tr_lines = [
        f"Market Structure Score (MSS): {mss}",
        f"Level: {level} ({level_label})",
        f"Zone:  {zone}",
    ]
    if vol_pct is not None:
        tr_lines.append(f"VIX percentile: {vol_pct:.1f}th")
    if dd_pct is not None:
        tr_lines.append(f"QQQ drawdown from peak: {dd_pct:.2f}%")

    # Risk overlay stays in section 07 only.
    shock = re_data.get("shock_probability", {})
    dtrig = re_data.get("defensive_trigger", {})
    if shock:
        tr_lines.append(f"Shock probability: {shock.get('value','?')}% ({shock.get('label','?')}, {shock.get('trend','?')})")
    if dtrig:
        tr_lines.append(f"Defensive trigger: {dtrig.get('status','?')} | {dtrig.get('reason','?')[:60]}")

    # Recent regime history (last 3)
    history = rv1.get("history", [])[-3:]
    if history:
        tr_lines.append("Recent MSS history:")
        for h in history:
            tr_lines.append(f"  {h.get('date','?')}  MSS={h.get('score','?')}  zone={h.get('score_zone','?')}")

    return {
        "data_date":        data_date,
        "headline_tape":    headline_tape,
        "mandatory_drivers": mandatory_drivers,
        "watchlist_focus":  "\n".join(watchlist_focus_lines),
        "hook_driver":      hook_driver,
        "market_flow":      "\n".join(mf_lines),
        "event_drivers":    "\n".join(ed_lines),
        "sector_structure": "\n".join(ss_lines),
        "macro_commodities":"\n".join(mc_lines),
        "stock_moves":      "\n".join(sm_lines),
        "economic_data":    "\n".join(econ_data_lines),
        "technical_regime": "\n".join(tr_lines),
    }


# ?? Hook builder (rule-based) ?????????????????????????????????????????????????
def build_hook(ctx: dict[str, str], rv1: dict, re_data: dict) -> str:
    # Direction: parse SPY line from market_flow
    spy_line = next((ln for ln in ctx["market_flow"].splitlines() if ln.startswith("SPY:")), "")
    direction = "U.S. equities moved"
    try:
        # e.g. "SPY: 655.24 (+0.75%)"
        import re
        m = re.search(r"\(([+-][0-9.]+)%\)", spy_line)
        if m:
            pct = float(m.group(1))
            if pct > 1.5:
                direction = f"U.S. equities rallied strongly (+{pct:.2f}%)"
            elif pct > 0:
                direction = f"U.S. equities edged higher (+{pct:.2f}%)"
            elif pct < -1.5:
                direction = f"U.S. equities sold off sharply ({pct:.2f}%)"
            else:
                direction = f"U.S. equities slipped ({pct:.2f}%)"
    except Exception:
        pass

    # Pressure: VIX from macro_commodities
    vix_val = None
    vix_line = next((ln for ln in ctx["macro_commodities"].splitlines() if "VIX" in ln), "")
    try:
        import re
        m = re.search(r"([\d.]+)", vix_line)
        if m:
            vix_val = float(m.group(1))
    except Exception:
        pass

    if vix_val is not None:
        if vix_val >= 30:
            pressure = "under severe volatility stress (VIX {:.1f})".format(vix_val)
        elif vix_val >= 20:
            pressure = "amid elevated market uncertainty (VIX {:.1f})".format(vix_val)
        else:
            pressure = "in a subdued volatility environment (VIX {:.1f})".format(vix_val)
    else:
        pressure = "amid mixed volatility signals"

    hook_driver = str(ctx.get("hook_driver", "") or "").strip()
    if hook_driver:
        return f"{direction} as {hook_driver}, with volatility {pressure}."
    return f"{direction}, with volatility {pressure}."


# ?? Risk Check (rule-based) ???????????????????????????????????????????????????
def build_risk_check(rv1: dict) -> dict:
    curr  = rv1.get("current", {})
    mss   = curr.get("score", 100)
    level = curr.get("level", 0)
    zone  = curr.get("score_zone", "")
    label = curr.get("level_label", "")

    triggered = level >= 2

    if level >= 4:
        color   = "#ef4444"
        message = (
            f"CRISIS ALERT - MSS {mss} has entered {zone} territory (Level {level}: {label}). "
            "The structural foundation of the market is deteriorating. Exposure management is critical. "
            "Any rally should be treated as a distribution opportunity until MSS recovers above 100."
        )
    elif level == 3:
        color   = "#f97316"
        message = (
            f"HIGH RISK - MSS {mss} is in {zone} (Level {level}: {label}). "
            "The market is showing meaningful structural weakness. "
            "Reduce high-beta exposure and tighten stops on open positions."
        )
    elif level == 2:
        color   = "#f59e0b"
        message = (
            f"WARNING - MSS {mss} has crossed into {zone} territory (Level {level}: {label}). "
            "Market structure is under pressure. Review position sizing and monitor key support levels closely."
        )
    else:
        color   = "#22c55e"
        message = f"No active risk alerts. MSS {mss} in {zone} (Level {level}: {label}). Structure intact."

    return {
        "triggered": triggered,
        "level":     level,
        "mss":       mss,
        "zone":      zone,
        "message":   message,
        "color":     color,
    }


# ?? One Line (rule-based) ????????????????????????????????????????????????????
def build_one_line(sections: list[dict], rv1: dict) -> str:
    curr  = rv1.get("current", {})
    level = curr.get("level", 0)
    zone  = curr.get("score_zone", "Neutral")
    mss   = curr.get("score", 100)

    signals = [s.get("signal", "neutral") for s in sections]
    bull    = signals.count("bull")
    bear    = signals.count("bear")
    caution = signals.count("caution")

    if bull >= 5:
        stance = "Market tone is constructive, with leadership broadening beyond one index"
    elif level >= 4 or bear >= 4:
        stance = "Market tone is defensive, with catalysts and breadth leaning risk-off"
    elif caution >= 3:
        stance = "Market tone is mixed, with selective leadership and uneven follow-through"
    else:
        stance = "Market tone is balanced, with headlines driving rotation more than a full trend"

    risk_tail = "Section 07 carries the explicit risk overlay."
    if level >= 3:
        risk_tail = "Section 07 carries the explicit risk overlay and should be read carefully."
    return f"{stance}. {risk_tail}"


def enforce_required_mentions(
    sections: list[dict[str, Any]],
    hook: str,
    mandatory_drivers: str,
    watchlist_focus: str,
) -> list[dict[str, Any]]:
    """
    Deterministic safety net:
    If required catalysts are missing from model prose, append concise lines so
    the final briefing does not ignore key live drivers.
    """
    text_blob = " ".join(
        [hook]
        + [str(s.get("structural", "")) + " " + str(s.get("implication", "")) for s in sections]
    ).lower()
    need_geo = any(k in mandatory_drivers.lower() for k in ("trump", "iran", "hormuz", "geopolitical"))
    need_tsla = any(k in (mandatory_drivers + " " + watchlist_focus).lower() for k in ("tsla", "tesla"))

    def _sec(section_id: str) -> dict[str, Any] | None:
        for s in sections:
            if s.get("id") == section_id:
                return s
        return None

    if need_geo and not any(k in text_blob for k in ("trump", "iran", "hormuz")):
        sec = _sec("event_drivers")
        if sec is not None:
            extra = (
                " Geopolitical headlines around Trump/Iran/Hormuz are a live macro driver, "
                "mainly through oil risk premium and cross-asset volatility spillover."
            )
            sec["implication"] = (str(sec.get("implication", "")).rstrip() + extra).strip()

    if need_tsla and not any(k in text_blob for k in ("tsla", "tesla")):
        sec = _sec("stock_moves")
        if sec is not None:
            extra = (
                " TSLA remains a key single-name sentiment pivot today, with delivery/news flow "
                "feeding directly into growth-risk appetite."
            )
            sec["implication"] = (str(sec.get("implication", "")).rstrip() + extra).strip()

    return sections


def build_fallback_section_payload(section_id: str, section_text: str, rv1: dict) -> dict[str, str]:
    lines = [ln.strip() for ln in (section_text or "").splitlines() if ln.strip()]
    structural = " ".join(lines[:2]) if lines else "Data is temporarily unavailable for this section."
    implication = " ".join(lines[2:4]) if len(lines) > 2 else "Wait for the next refresh and keep position sizing disciplined."

    level = int((rv1.get("current", {}) or {}).get("level", 0) or 0)
    if section_id == "technical_regime":
        signal = "bear" if level >= 4 else "caution" if level >= 2 else "neutral"
    else:
        signal = "neutral"

    return {
        "structural": structural,
        "structural_ko": "",
        "implication": implication,
        "implication_ko": "",
        "signal": signal,
    }


# ?? Prompt ????????????????????????????????????????????????????????????????????
SYSTEM_PROMPT = """\
You are a senior market analyst writing the daily briefing for sophisticated retail investors.

Your job is to write a market front-page brief, not a risk memo.
Sections 01-06 should read like the day's market headline package:
market tone, news, rotation, macro backdrop, movers, and calendar.
Section 07 is the only place where explicit MSS / gate / regime risk language should appear.

Hard constraints:
1) Lead with the day's mood and catalysts, not with a defensive risk narrative.
2) Do not make QQQ/TQQQ the center of gravity; use broad market, sectors, movers, and events first.
3) If geopolitical or policy items appear (Trump, Iran, Hormuz, tariffs, speech), explain the transmission chain, but keep the framing market-wide.
4) Key Stocks section must analyze at most 3 names with cause-and-effect language. If TSLA is in watchlist/headlines, TSLA must be included.
5) Macro & Rates section must interpret DXY/VIX/US10Y/Oil/BTC (why they moved and what they imply).
6) Section 07 should carry the explicit risk overlay: MSS, zone, drawdown, shock probability, and defensive trigger.
7) Keep each field concise but substantive. Do not pad.
8) "hook" / "one_line" should sound like a market front page headline with a catalyst and tone, not a risk alert.

For each section provide:
- "structural": what the data reveals about current market structure or tone.
- "implication": what it means for participants going forward.

For each section also provide Korean translations:
- "structural_ko"
- "implication_ko"

At the top level provide all of:
- "hook" (English)
- "hook_ko" (Korean)
- "one_line" (English)
- "one_line_ko" (Korean)

Korean quality rules (strict):
1) Korean text must match the English meaning.
2) Prefer natural Korean finance phrasing over literal translation.
3) Keep proper nouns/tickers exactly as in English.
4) "one_line_ko" should be a dense market headline with catalyst + tone + posture.
5) Do not put section-07 risk language into sections 01-06.

"signal" must be exactly one of: "bull", "caution", "bear", "neutral"
Respond ONLY with valid JSON - no markdown fences, no extra text.\
"""

USER_TEMPLATE = """\
DATA DATE: {data_date}

MANDATORY NARRATIVE DRIVERS:
{mandatory_drivers}

LIVE HEADLINE TAPE (prioritized):
{headline_tape}

WATCHLIST FOCUS:
{watchlist_focus}

SECTION 1 - MARKET PULSE
{market_flow}

SECTION 2 - NEWS & CATALYSTS
{event_drivers}

SECTION 3 - SECTOR ROTATION
{sector_structure}

SECTION 4 - MACRO & RATES
{macro_commodities}

SECTION 5 - MOVERS & WATCHLIST
{stock_moves}

SECTION 6 - EARNINGS & CALENDAR
{economic_data}

SECTION 7 - RISK & REGIME
{technical_regime}

Generate a JSON object with exactly this structure (no extra keys):
{{
  "hook": "...",
  "hook_ko": "...",
  "one_line": "...",
  "one_line_ko": "...",
  "sections": {{
    "market_flow":       {{"structural": "...", "structural_ko": "...", "implication": "...", "implication_ko": "...", "signal": "..."}},
    "event_drivers":     {{"structural": "...", "structural_ko": "...", "implication": "...", "implication_ko": "...", "signal": "..."}},
    "sector_structure":  {{"structural": "...", "structural_ko": "...", "implication": "...", "implication_ko": "...", "signal": "..."}},
    "macro_commodities": {{"structural": "...", "structural_ko": "...", "implication": "...", "implication_ko": "...", "signal": "..."}},
    "stock_moves":       {{"structural": "...", "structural_ko": "...", "implication": "...", "implication_ko": "...", "signal": "..."}},
    "economic_data":     {{"structural": "...", "structural_ko": "...", "implication": "...", "implication_ko": "...", "signal": "..."}},
    "technical_regime":  {{"structural": "...", "structural_ko": "...", "implication": "...", "implication_ko": "...", "signal": "..."}}
  }}
}}\
"""

KO_ALIGNMENT_SYSTEM_PROMPT = """\
You are a senior Korean financial localization editor.

Task:
- Convert English briefing text to Korean with high fidelity.
- Preserve meaning, tone, and risk posture.

Hard constraints:
1) Korean must be meaning-equivalent to English for each field.
2) Do not add or remove facts, numbers, names, tickers, or conclusions.
3) Use natural Korean market language (not literal translation).
4) Prefer familiar terms (e.g., "외부 충격", "장중 흐름", "이벤트 장세", "재평가").
5) Keep proper nouns/tickers exactly as written (TSLA, QQQ, VIX, US10Y, Hormuz, Reuters).

Return ONLY valid JSON (no markdown):
{
  "hook_ko": "...",
  "one_line_ko": "...",
  "sections": {
    "market_flow": {"structural_ko": "...", "implication_ko": "..."},
    "event_drivers": {"structural_ko": "...", "implication_ko": "..."},
    "sector_structure": {"structural_ko": "...", "implication_ko": "..."},
    "macro_commodities": {"structural_ko": "...", "implication_ko": "..."},
    "stock_moves": {"structural_ko": "...", "implication_ko": "..."},
    "economic_data": {"structural_ko": "...", "implication_ko": "..."},
    "technical_regime": {"structural_ko": "...", "implication_ko": "..."}
  }
}
"""

# ── Korean-only primary prompt (default generation mode) ──────────────────────
KO_ONLY_SYSTEM_PROMPT = """\
당신은 한국 개인 투자자를 위한 일일 마켓 브리핑을 작성하는 시니어 마켓 애널리스트입니다.

이 브리핑은 시장의 하루 분위기를 전하는 프런트 페이지여야 합니다.
01~06 섹션은 뉴스, 촉매, 섹터 순환, 매크로, 종목 움직임, 일정으로 구성하고,
07 섹션에서만 MSS / Gate / regime / risk overlay를 명시적으로 다루세요.

필수 조건:
1) 촉매와 시장 분위기를 먼저 쓰고, 위험도 문구는 07 섹션으로만 제한하세요.
2) QQQ/TQQQ만 중심에 두지 말고, 광범위한 시장, 섹터, 종목, 이벤트를 균형 있게 다루세요.
3) 지정학·정책 이벤트(트럼프, 이란, 호르무즈, 관세, 파월)가 있으면 시장에 미치는 전달 경로를 설명하세요.
4) structural_ko: 현재 시장 구조나 분위기를 설명하는 2-5문장.
5) implication_ko: 시장 참여자 관점의 시사점, 전개 방향을 담은 2-5문장.
6) hook_ko: 오늘 세션을 대표하는 시장 헤드라인 한 줄.
7) one_line_ko: 촉매 + 분위기 + 포지션 시사점을 담은 밀도 높은 한 문장.
8) signal: "bull", "caution", "bear", "neutral" 중 정확히 하나.

문장 스타일: 자연스러운 금융 한국어. 직역 금지. 틱커/고유명사는 원문 그대로 (TSLA, QQQ, VIX 등).
Respond ONLY with valid JSON - no markdown fences, no extra text.\
"""

KO_ONLY_USER_TEMPLATE = """\
DATA DATE: {data_date}

MANDATORY NARRATIVE DRIVERS:
{mandatory_drivers}

LIVE HEADLINE TAPE (prioritized):
{headline_tape}

WATCHLIST FOCUS:
{watchlist_focus}

SECTION 1 - MARKET PULSE
{market_flow}

SECTION 2 - NEWS & CATALYSTS
{event_drivers}

SECTION 3 - SECTOR ROTATION
{sector_structure}

SECTION 4 - MACRO & RATES
{macro_commodities}

SECTION 5 - MOVERS & WATCHLIST
{stock_moves}

SECTION 6 - EARNINGS & CALENDAR
{economic_data}

SECTION 7 - RISK & REGIME
{technical_regime}

Generate a JSON object with ONLY Korean fields:
{{
  "hook_ko": "...",
  "one_line_ko": "...",
  "sections": {{
    "market_flow":       {{"structural_ko": "...", "implication_ko": "...", "signal": "..."}},
    "event_drivers":     {{"structural_ko": "...", "implication_ko": "...", "signal": "..."}},
    "sector_structure":  {{"structural_ko": "...", "implication_ko": "...", "signal": "..."}},
    "macro_commodities": {{"structural_ko": "...", "implication_ko": "...", "signal": "..."}},
    "stock_moves":       {{"structural_ko": "...", "implication_ko": "...", "signal": "..."}},
    "economic_data":     {{"structural_ko": "...", "implication_ko": "...", "signal": "..."}},
    "technical_regime":  {{"structural_ko": "...", "implication_ko": "...", "signal": "..."}}
  }}
}}\
"""


def _parse_json_from_llm(raw: str) -> dict[str, Any]:
    """
    Robust JSON parser for LLM responses.
    Supports:
    - plain JSON
    - fenced ```json blocks
    - extra pre/post text around a JSON object
    """
    text = (raw or "").strip()
    if not text:
        raise ValueError("Empty LLM output")

    candidates: list[str] = [text]

    fenced = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text, re.IGNORECASE)
    if fenced:
        candidates.append(fenced.group(1).strip())

    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        candidates.append(text[first:last + 1].strip())

    last_err: Exception | None = None
    seen: set[str] = set()
    for cand in candidates:
        if not cand or cand in seen:
            continue
        seen.add(cand)
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict):
                return parsed
            raise ValueError("Parsed JSON is not an object")
        except Exception as e:
            last_err = e
            continue

    raise ValueError(f"LLM output is not valid JSON: {last_err}")


def _call_llm_json_with_retry(
    client: Any,
    *,
    system_prompt: str,
    user_content: str,
    max_tokens: int,
    retries: int = 1,
) -> tuple[dict[str, Any], int, int, str]:
    """
    Call Claude and require JSON output.
    Retries with stricter instruction if parse fails.
    Returns: (parsed_json, input_tokens_total, output_tokens_total, raw_text_last)
    """
    in_total = 0
    out_total = 0
    raw_last = ""

    for attempt in range(retries + 1):
        strict_suffix = ""
        if attempt > 0:
            strict_suffix = (
                "\n\nCRITICAL FORMAT FIX:\n"
                "Return ONLY ONE valid JSON object.\n"
                "No prose. No markdown fences. No commentary.\n"
            )

        resp = client.messages.create(
            model=MODEL_ID,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content + strict_suffix}],
        )
        raw_last = resp.content[0].text.strip()
        in_total += int(getattr(resp.usage, "input_tokens", 0) or 0)
        out_total += int(getattr(resp.usage, "output_tokens", 0) or 0)

        try:
            parsed = _parse_json_from_llm(raw_last)
            return parsed, in_total, out_total, raw_last
        except Exception as e:
            print(f"[build_daily_briefing_v3] WARN parse failed (attempt {attempt + 1}/{retries + 1}): {e}")
            if attempt >= retries:
                raise

    raise ValueError("Unexpected JSON retry loop termination")


def align_korean_from_english(client: Any, hook_en: str, one_line_en: str, sections: list[dict[str, Any]]) -> tuple[dict[str, Any], int, int]:
    payload = {
        "hook": hook_en,
        "one_line": one_line_en,
        "sections": {
            sec.get("id", ""): {
                "structural": sec.get("structural", ""),
                "implication": sec.get("implication", ""),
            }
            for sec in sections
        },
    }
    parsed, in_tok, out_tok, _raw = _call_llm_json_with_retry(
        client,
        system_prompt=KO_ALIGNMENT_SYSTEM_PROMPT,
        user_content=json.dumps(payload, ensure_ascii=False),
        max_tokens=4096,
        retries=1,
    )
    return parsed if isinstance(parsed, dict) else {}, in_tok, out_tok


# ?? Stale check ???????????????????????????????????????????????????????????????
def is_stale(max_minutes: int = 1440, slot: str | None = None) -> bool:
    if not OUT_PATH.exists():
        return True
    try:
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)
        ts  = existing.get("generated_at", "")
        gen = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        existing_slot = str(existing.get("slot") or "").strip().lower()
        current_slot = str(slot or _current_briefing_slot()).strip().lower() or _current_briefing_slot()
        current_date = datetime.now(timezone.utc).astimezone(ET_ZONE).strftime("%Y-%m-%d")
        existing_date = str(existing.get("data_date") or existing.get("date") or "")[:10]
        if existing_date and existing_date != current_date:
            return True
        if existing_slot and existing_slot != current_slot:
            return True
        age = (datetime.now(timezone.utc) - gen).total_seconds() / 60
        return age > max_minutes
    except Exception:
        return True


# -- Shared data loader --------------------------------------------------
def _load_inputs():
    ms       = load("market_state.json")
    rv1      = load("risk_v1.json",                [OUTPUT_DIR])
    re_data  = load("risk_engine.json")
    sp       = load("sector_performance.json",     [OUTPUT_DIR, CACHE_DIR])
    econ_cal = load("economic_calendar.json",      [OUTPUT_DIR])
    earnings = load("earnings_calendar.json",      [OUTPUT_DIR])
    movers   = load("movers_snapshot_latest.json")
    news     = load("context_news.json")
    return ms, rv1, re_data, sp, econ_cal, earnings, movers, news


def _load_api_key() -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip().strip(chr(34)).strip(chr(39))
    for _env_path in [BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"]:
        if api_key:
            break
        if _env_path.exists():
            with open(_env_path, encoding="utf-8", errors="replace") as _ef:
                for _line in _ef:
                    if "ANTHROPIC_API_KEY" in _line and "=" in _line:
                        _val = _line.split("=", 1)[1].strip().strip(chr(34)).strip(chr(39))
                        if _val:
                            api_key = _val
                            break
    return api_key


# -- Main -----------------------------------------------------------------
def main() -> None:
    force = "--force" in sys.argv
    # Default: Korean only. Pass --lang=en to fill English fields.
    lang = "ko"
    slot = _current_briefing_slot()
    argv = sys.argv[1:]
    idx = 0
    while idx < len(argv):
        arg = argv[idx]
        if arg.startswith("--lang="):
            lang = arg.split("=", 1)[1].strip().lower()
        elif arg == "--lang" and idx + 1 < len(argv):
            lang = argv[idx + 1].strip().lower()
            idx += 1
        elif arg.startswith("--slot="):
            slot = arg.split("=", 1)[1].strip().lower() or _current_briefing_slot()
        elif arg == "--slot" and idx + 1 < len(argv):
            slot = argv[idx + 1].strip().lower() or _current_briefing_slot()
            idx += 1
        idx += 1

    if not force and not is_stale(slot=slot):
        print("[build_daily_briefing_v3] output is fresh, skipping (use --force to override)")
        return

    api_key = _load_api_key()
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not found", file=sys.stderr)
        sys.exit(1)

    ms, rv1, re_data, sp, econ_cal, earnings, movers, news = _load_inputs()
    ctx = build_context(ms, rv1, re_data, sp, econ_cal, earnings, movers, news)
    risk_check = build_risk_check(rv1)
    hook_fallback = build_hook(ctx, rv1, re_data)

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    if lang == "en":
        # EN fill: generate English fields, preserve existing Korean
        existing: dict = {}
        if OUT_PATH.exists():
            try:
                with open(OUT_PATH, encoding="utf-8") as f:
                    existing = json.load(f)
            except Exception:
                pass

        user_msg = USER_TEMPLATE.format(**ctx)
        print(f"[build_daily_briefing_v3] lang=en  model={MODEL_ID}  context={len(user_msg)} chars")
        parsed, in_tok, out_tok, _ = _call_llm_json_with_retry(
            client, system_prompt=SYSTEM_PROMPT,
            user_content=user_msg, max_tokens=8192, retries=1,
        )
        cost = in_tok * PRICE_IN + out_tok * PRICE_OUT
        print(f"[build_daily_briefing_v3] tokens: in={in_tok} out={out_tok} cost=${cost:.5f}")

        llm_sections = parsed.get("sections", {}) if isinstance(parsed, dict) else {}
        hook     = str((parsed.get("hook",     "") if isinstance(parsed, dict) else "") or "").strip()
        one_line = str((parsed.get("one_line", "") if isinstance(parsed, dict) else "") or "").strip()

        sections: list[dict] = []
        ex_sections: list[dict] = existing.get("sections", []) if isinstance(existing, dict) else []
        for sid, title in SECTION_META:
            raw_sec = llm_sections.get(sid, {}) if isinstance(llm_sections, dict) else {}
            fallback_sec = build_fallback_section_payload(sid, ctx.get(sid, ""), rv1)
            if not isinstance(raw_sec, dict):
                raw_sec = {}
            ex_sec = next((s for s in ex_sections if isinstance(s, dict) and s.get("id") == sid), {})

            structural  = str(raw_sec.get("structural",  "") or "").strip() or fallback_sec["structural"]
            implication = str(raw_sec.get("implication", "") or "").strip() or fallback_sec["implication"]
            structural_ko  = str(ex_sec.get("structural_ko",  "") or raw_sec.get("structural_ko",  "") or "").strip()
            implication_ko = str(ex_sec.get("implication_ko", "") or raw_sec.get("implication_ko", "") or "").strip()
            signal = str(raw_sec.get("signal", "") or "").strip().lower()
            if signal not in SIGNAL_COLOR:
                signal = ex_sec.get("signal") or fallback_sec["signal"]

            sections.append({
                "id": sid, "title": title,
                "structural": structural, "structural_ko": structural_ko,
                "implication": implication, "implication_ko": implication_ko,
                "signal": signal, "color": SIGNAL_COLOR.get(signal, "#64748b"),
            })

        sections = enforce_required_mentions(
            sections=sections, hook=hook,
            mandatory_drivers=ctx.get("mandatory_drivers", ""),
            watchlist_focus=ctx.get("watchlist_focus", ""),
        )
        if not hook:
            hook = hook_fallback
        if not one_line:
            one_line = build_one_line(sections, rv1)

        prev_tokens = existing.get("tokens", {}) if isinstance(existing, dict) else {}
        output = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_date":    ctx["data_date"],
            "slot":         slot,
            "model":        MODEL_ID,
            "lang":         "en",
            "tokens": {
                "input":    (prev_tokens.get("input", 0) or 0) + in_tok,
                "output":   (prev_tokens.get("output", 0) or 0) + out_tok,
                "cost_usd": round((prev_tokens.get("cost_usd", 0) or 0) + cost, 6),
            },
            "hook":       hook,
            "hook_ko":    existing.get("hook_ko", "") if isinstance(existing, dict) else "",
            "sections":   sections,
            "risk_check": risk_check,
            "one_line":   one_line,
            "one_line_ko": existing.get("one_line_ko", "") if isinstance(existing, dict) else "",
        }

    else:
        # KO mode (default): single-pass Korean-only, cheaper + faster
        user_msg = KO_ONLY_USER_TEMPLATE.format(**ctx)
        print(f"[build_daily_briefing_v3] lang=ko  model={MODEL_ID}  context={len(user_msg)} chars")
        parsed, in_tok, out_tok, _ = _call_llm_json_with_retry(
            client, system_prompt=KO_ONLY_SYSTEM_PROMPT,
            user_content=user_msg, max_tokens=6144, retries=1,
        )
        cost = in_tok * PRICE_IN + out_tok * PRICE_OUT
        print(f"[build_daily_briefing_v3] tokens: in={in_tok} out={out_tok} cost=${cost:.5f}")

        llm_sections = parsed.get("sections", {}) if isinstance(parsed, dict) else {}
        hook_ko     = str((parsed.get("hook_ko",     "") if isinstance(parsed, dict) else "") or "").strip()
        one_line_ko = str((parsed.get("one_line_ko", "") if isinstance(parsed, dict) else "") or "").strip()

        sections = []
        for sid, title in SECTION_META:
            raw_sec = llm_sections.get(sid, {}) if isinstance(llm_sections, dict) else {}
            fallback_sec = build_fallback_section_payload(sid, ctx.get(sid, ""), rv1)
            if not isinstance(raw_sec, dict):
                raw_sec = {}
            structural_ko  = str(raw_sec.get("structural_ko",  "") or "").strip()
            implication_ko = str(raw_sec.get("implication_ko", "") or "").strip()
            signal = str(raw_sec.get("signal", "") or "").strip().lower()
            if signal not in SIGNAL_COLOR:
                signal = fallback_sec["signal"]
            sections.append({
                "id": sid, "title": title,
                "structural": "",  "structural_ko":  structural_ko,
                "implication": "", "implication_ko": implication_ko,
                "signal": signal,  "color": SIGNAL_COLOR.get(signal, "#64748b"),
            })

        if not hook_ko:
            hook_ko = hook_fallback
        if not one_line_ko:
            one_line_ko = build_one_line(sections, rv1)

        output = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_date":    ctx["data_date"],
            "slot":         slot,
            "model":        MODEL_ID,
            "lang":         "ko",
            "tokens": {"input": in_tok, "output": out_tok, "cost_usd": round(cost, 6)},
            "hook":       "",
            "hook_ko":    hook_ko,
            "sections":   sections,
            "risk_check": risk_check,
            "one_line":   "",
            "one_line_ko": one_line_ko,
        }

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[build_daily_briefing_v3] saved -> {OUT_PATH}  lang={lang} slot={slot}")
    for sec in sections:
        print(f"  [{sec['id']:20}] signal={sec['signal']:8}")
    print(f"  Risk: triggered={risk_check['triggered']}  level={risk_check['level']}  mss={risk_check['mss']}")

if __name__ == "__main__":
    main()

