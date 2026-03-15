"""
Smart Flow SSOT (Regime-adjusted Smart Money) — Formula Spec v1

Single source of truth for:
  - Regime-adjusted score
  - Volatility alignment / shock gate
  - Sector alignment
  - Fit labels
  - Aggregated flow statistics
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _read_json_candidates(filename: str) -> Optional[Dict[str, Any]]:
    root = repo_root()
    candidates = [
        os.path.join(root, "backend", "output", "cache", filename),
        os.path.join(root, "output", "cache", filename),
        os.path.join(root, "data", "snapshots", filename),
    ]
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            continue
    return None


def _normalize_prob(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return value / 100.0 if value > 1 else value


def _sector_group(sector: Optional[str]) -> Optional[str]:
    text = (sector or "").lower()
    defensive_keywords = (
        "utilities",
        "utility",
        "staples",
        "consumer staples",
        "health",
        "pharma",
        "biotech",
    )
    cyc_keywords = (
        "discretionary",
        "industrial",
        "financial",
        "semiconductor",
        "tech",
        "technology",
        "information",
        "communication",
        "internet",
        "software",
        "hardware",
        "bank",
        "insurance",
        "broker",
        "capital",
        "retail",
        "transport",
        "energy",
        "materials",
    )
    if any(k in text for k in defensive_keywords):
        return "defensive"
    if any(k in text for k in cyc_keywords):
        return "cyclical"
    return None


def _derive_regime(market_phase: Optional[str], dist_pct: Optional[float], shock_prob: Optional[float], tail_sigma: Optional[float], risk_level: Optional[str]) -> str:
    shock_prob = _normalize_prob(shock_prob)
    if shock_prob is not None and shock_prob > 0.35:
        return "Shock"
    if (risk_level or "").upper() == "HIGH" and (tail_sigma or 0) >= 2.5:
        return "Shock"

    phase = (market_phase or "").upper()
    if phase in ("BULL", "EXPANSION"):
        return "Expansion"
    if phase in ("BEAR", "DEFENSIVE", "CONTRACTION"):
        return "Contraction"
    if phase in ("TRANSITION", "NEUTRAL"):
        return "Neutral"

    if dist_pct is not None:
        if dist_pct > 3:
            return "Expansion"
        if dist_pct < -3:
            return "Contraction"
    return "Neutral"


def build_risk_context() -> Dict[str, Any]:
    health = _read_json_candidates("health_snapshot.json") or {}
    snaps = _read_json_candidates("snapshots_120d.json") or {}
    snapshots = snaps.get("snapshots") or []
    latest = snapshots[-1] if snapshots else {}

    gate_score = latest.get("gate_score")
    if gate_score is None:
        gate_score = latest.get("gate_score_10d_avg") or latest.get("gate_score_30d_avg")

    risk_level = latest.get("risk_level")
    market_phase = latest.get("market_phase")

    dist_pct = None
    trend = (health.get("trend") or {})
    if isinstance(trend, dict):
        dist_pct = trend.get("dist_pct")

    risk = (health.get("risk") or {})
    var95 = risk.get("var95_1d")
    risk_proxy = abs(float(var95)) * 10 if var95 is not None else None
    shock_prob = clamp(risk_proxy * 0.55, 4, 95) / 100.0 if risk_proxy is not None else None
    tail_sigma = clamp(risk_proxy / 9.2, 0.6, 6.2) if risk_proxy is not None else None

    if gate_score is None:
        liquidity = "Neutral"
        breadth = "Neutral"
    elif gate_score > 60:
        liquidity = "Loose"
        breadth = "Strong"
    elif gate_score > 40:
        liquidity = "Neutral"
        breadth = "Neutral"
    else:
        liquidity = "Tight"
        breadth = "Weak"

    trend_state = "Near200"
    if dist_pct is not None:
        if dist_pct >= 2:
            trend_state = "Above200"
        elif dist_pct <= -2:
            trend_state = "Below200"

    regime = _derive_regime(market_phase, dist_pct, shock_prob, tail_sigma, risk_level)

    return {
        "regime": regime,
        "shock_prob_30d": shock_prob,
        "tail_sigma": tail_sigma,
        "liquidity_state": liquidity,
        "breadth_state": breadth,
        "trend_state": trend_state,
    }


def _regime_weight(regime: str) -> float:
    return {
        "Expansion": 1.00,
        "Neutral": 0.70,
        "Contraction": 0.40,
        "Shock": 0.15,
    }.get(regime, 0.70)


def _vol_risk_label(shock_prob: Optional[float], tail_sigma: Optional[float]) -> str:
    shock_prob = _normalize_prob(shock_prob)
    if (shock_prob or 0) > 0.20 or (tail_sigma or 0) >= 2.5:
        return "High"
    if tail_sigma is not None and 2.0 <= tail_sigma < 2.5:
        return "Medium"
    return "Low"


def _regime_fit_label(regime: str) -> str:
    return {
        "Expansion": "High",
        "Neutral": "Medium",
        "Contraction": "Low",
        "Shock": "Very Low",
    }.get(regime, "Medium")


def _flow_alignment_label(sm_score: float) -> str:
    if sm_score >= 80:
        return "Strong"
    if sm_score >= 65:
        return "Moderate"
    return "Weak"


def _environment_fit(regime_fit: str, vol_risk: str, sector_alignment: float) -> str:
    if regime_fit in ("Low", "Very Low") or vol_risk == "High":
        return "Low"
    if regime_fit == "High" and vol_risk in ("Low", "Medium") and sector_alignment >= 1.0:
        return "High"
    return "Medium"


def _sector_alignment(sector: Optional[str], liquidity: str, breadth: str, trend: str) -> float:
    group = _sector_group(sector)
    if group is None:
        return 1.0

    if liquidity == "Tight":
        base = 1.10 if group == "defensive" else 0.70
    elif liquidity == "Loose":
        base = 0.95 if group == "defensive" else 1.05
    else:
        base = 1.00

    if breadth == "Weak":
        base *= 0.90
    elif breadth == "Strong":
        base *= 1.05

    if trend == "Below200":
        base *= 0.85
    elif trend == "Above200":
        base *= 1.05

    return round(base, 4)


def _apply_shock_gate(items: List[Dict[str, Any]], shock_prob: Optional[float]) -> Tuple[str, float, List[str]]:
    shock_prob = _normalize_prob(shock_prob)
    if shock_prob is None or shock_prob <= 0.20:
        return "none", 1.0, []

    volatile_symbols = [it.get("symbol") for it in items if "VOLATILE" in (it.get("tags") or [])]
    filtered = [it for it in items if it.get("symbol") not in volatile_symbols]

    min_keep = max(10, int(len(items) * 0.2))
    if len(filtered) < min_keep:
        return "soft", 0.70, []
    return "hard", 1.0, volatile_symbols


def apply_smart_flow(
    items: List[Dict[str, Any]],
    context: Dict[str, Any],
    prev_leaders_count: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    regime = context.get("regime", "Neutral")
    shock_prob = context.get("shock_prob_30d")
    tail_sigma = context.get("tail_sigma")
    liquidity = context.get("liquidity_state", "Neutral")
    breadth = context.get("breadth_state", "Neutral")
    trend = context.get("trend_state", "Near200")

    gate_mode, vol_gate, excluded_symbols = _apply_shock_gate(items, shock_prob)

    adjusted: List[Dict[str, Any]] = []
    excluded: List[Dict[str, Any]] = []

    for item in items:
        tags = item.get("tags") or []
        is_volatile = "VOLATILE" in tags
        symbol = item.get("symbol")

        sm_score = float(item.get("score") or 0.0)
        regime_weight = _regime_weight(regime)
        sm_regime = sm_score * regime_weight

        atr_penalty_multiplier = 1.0
        if tail_sigma is not None and tail_sigma >= 2.5:
            atr_penalty_multiplier = 1.50
        elif tail_sigma is not None and 2.0 <= tail_sigma < 2.5:
            atr_penalty_multiplier = 1.25

        vol_alignment = 1.0
        if shock_prob is not None and shock_prob > 0.20:
            vol_alignment *= 0.85
        if tail_sigma is not None and tail_sigma >= 2.5:
            vol_alignment *= 0.85
        if is_volatile:
            vol_alignment *= 0.80
        vol_alignment *= vol_gate
        vol_alignment = vol_alignment / atr_penalty_multiplier
        vol_alignment = clamp(vol_alignment, 0.0, 1.0)

        sector_alignment = _sector_alignment(item.get("sector"), liquidity, breadth, trend)
        sm_final = clamp(sm_regime * vol_alignment * sector_alignment, 0.0, 100.0)

        regime_fit = _regime_fit_label(regime)
        vol_risk = _vol_risk_label(shock_prob, tail_sigma)
        flow_alignment = _flow_alignment_label(sm_score)
        environment_fit = _environment_fit(regime_fit, vol_risk, sector_alignment)

        payload = {
            "sm_score": round(sm_score, 2),
            "SM_score": round(sm_score, 2),
            "sm_regime": round(sm_regime, 2),
            "SM_regime": round(sm_regime, 2),
            "vol_alignment": round(vol_alignment, 4),
            "Vol_alignment": round(vol_alignment, 4),
            "sector_alignment": round(sector_alignment, 4),
            "Sector_alignment": round(sector_alignment, 4),
            "sm_final": round(sm_final, 2),
            "SM_final": round(sm_final, 2),
            "regime_fit": regime_fit,
            "RegimeFit": regime_fit,
            "vol_risk": vol_risk,
            "VolRisk": vol_risk,
            "flow_alignment": flow_alignment,
            "FlowAlignment": flow_alignment,
            "environment_fit": environment_fit,
            "EnvironmentFit": environment_fit,
            "exclude_flag": False,
            "ExcludeFlag": False,
            "gate_mode": gate_mode,
        }

        if gate_mode == "hard" and is_volatile:
            payload["exclude_flag"] = True
            payload["ExcludeFlag"] = True
            it = {**item, **payload}
            excluded.append(it)
            continue

        adjusted.append({**item, **payload})

    leaders = [it for it in adjusted if (it.get("sm_score") or 0) >= 80]
    leaders_count = len(leaders)
    leaders_delta = leaders_count - prev_leaders_count if isinstance(prev_leaders_count, int) else None

    rs_leader_count = sum(1 for it in adjusted if "RS_LEADER" in (it.get("tags") or []))
    rs_leader_ratio = (rs_leader_count / len(adjusted) * 100) if adjusted else None

    leaders_sorted = sorted(leaders, key=lambda x: float(x.get("sm_final") or 0.0), reverse=True)
    top_leaders = leaders_sorted[:20]
    sector_counts: Dict[str, int] = {}
    for it in top_leaders:
        sector = it.get("sector") or "Unknown"
        sector_counts[sector] = sector_counts.get(sector, 0) + 1
    if top_leaders:
        max_share = max(sector_counts.values()) / len(top_leaders)
        concentration = "High" if max_share >= 0.45 else "Medium" if max_share >= 0.3 else "Low"
    else:
        concentration = "Low"

    if leaders_delta is None:
        acceleration = "Flat"
    elif leaders_delta >= 4:
        acceleration = "Expanding"
    elif leaders_delta <= -4:
        acceleration = "Contracting"
    else:
        acceleration = "Flat"

    summary = {
        "leaders80_count": leaders_count,
        "leaders80_delta_1d": leaders_delta,
        "rs_leader_ratio": round(rs_leader_ratio, 2) if rs_leader_ratio is not None else None,
        "concentration_level": concentration,
        "acceleration_state": acceleration,
        "Leaders80_count": leaders_count,
        "Leaders80_delta_1d": leaders_delta,
        "RS_LEADER_ratio": round(rs_leader_ratio, 2) if rs_leader_ratio is not None else None,
        "Concentration_level": concentration,
        "Acceleration_state": acceleration,
        "regime": regime,
        "shock_prob_30d": shock_prob,
        "tail_sigma": tail_sigma,
        "liquidity_state": liquidity,
        "breadth_state": breadth,
        "trend_state": trend,
        "gate_mode": gate_mode,
    }
    return adjusted, excluded, summary
