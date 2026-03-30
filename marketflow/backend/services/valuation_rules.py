"""
Shared interpretation helpers for stock-derived watchlist and portfolio analysis.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Tuple


def safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return None
        return number
    except Exception:
        return None


def normalize_ticker(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if ":" in raw:
        raw = raw.split(":")[-1]
    return raw


def normalize_mode(value: Any) -> str:
    mode = str(value or "auto").strip().lower() or "auto"
    if mode not in {"auto", "conservative", "aggressive"}:
        return "auto"
    return mode


def dedupe_tickers(values: Iterable[Any]) -> List[str]:
    seen = set()
    result: List[str] = []
    for value in values:
        ticker = normalize_ticker(value)
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        result.append(ticker)
    return result


def first_finite(*values: Any) -> Optional[float]:
    for value in values:
        number = safe_float(value)
        if number is not None:
            return number
    return None


def current_price_from_analysis(analysis: Dict[str, Any]) -> Optional[float]:
    return first_finite(analysis.get("current_price"), analysis.get("price"))


def base_target_from_analysis(analysis: Dict[str, Any]) -> Optional[float]:
    scenario = analysis.get("scenario") or {}
    if not isinstance(scenario, dict):
        scenario = {}
    return first_finite(scenario.get("base"))


def valuation_state_label(analysis: Dict[str, Any]) -> str:
    valuation_state = analysis.get("valuation_state") or {}
    if isinstance(valuation_state, dict):
        label = str(valuation_state.get("label") or "").strip().lower()
        if label in {"premium", "fair", "discount"}:
            return label
    return "fair"


def confidence_label(analysis: Dict[str, Any]) -> str:
    confidence = str(analysis.get("confidence") or "low").strip().lower()
    if confidence not in {"high", "medium", "low"}:
        return "low"
    return confidence


def gap_vs_base_pct(analysis: Dict[str, Any]) -> Optional[float]:
    current = current_price_from_analysis(analysis)
    base = base_target_from_analysis(analysis)
    if current is None or base is None or base <= 0:
        return None
    return (current - base) / base


def build_risk_tag(state: str, confidence: str, gap_pct: Optional[float]) -> str:
    if gap_pct is None:
        return "coverage_gap"
    state = (state or "fair").strip().lower()
    confidence = (confidence or "low").strip().lower()
    if state == "premium":
        return "compression_risk_low_visibility" if confidence == "low" else "compression_risk"
    if state == "discount":
        return "recovery_setup_low_visibility" if confidence == "low" else "recovery_setup"
    return "balanced"


def build_summary_line(analysis: Dict[str, Any], state: str, gap_pct: Optional[float], confidence: str) -> str:
    name = str(analysis.get("name") or analysis.get("ticker") or "This ticker").strip()
    if gap_pct is None:
        return f"{name} has incomplete scenario coverage, so interpretation leans on available valuation inputs."

    gap_abs = abs(gap_pct) * 100
    state = (state or "fair").strip().lower()
    confidence = (confidence or "low").strip().lower()

    if state == "premium":
        line = (
            f"{name} trades {gap_abs:.1f}% above base; the base case leaves limited upside unless "
            f"earnings and multiple support persist."
        )
    elif state == "discount":
        line = (
            f"{name} trades {gap_abs:.1f}% below base; the base case depends on earnings resilience "
            f"and a stable multiple."
        )
    else:
        line = f"{name} trades within {gap_abs:.1f}% of base; risk-reward is balanced at current coverage."

    if confidence == "low":
        line += " Coverage remains limited, so the estimate is more approximate than usual."
    return line


def build_consensus_note(analysis: Dict[str, Any]) -> str:
    consensus = analysis.get("consensus") or analysis.get("fmp_consensus") or {}
    if not isinstance(consensus, dict):
        return "FMP consensus coverage is incomplete, so the summary leans on scenario outputs."

    current = current_price_from_analysis(analysis)
    target_mean = first_finite(
        consensus.get("target_mean"),
        consensus.get("targetMean"),
        consensus.get("targetConsensus"),
        consensus.get("targetMedian"),
    )
    analyst_count = consensus.get("analyst_count") or consensus.get("target_analyst_count")

    if current is not None and target_mean is not None and current > 0:
        upside = (target_mean - current) / current
        direction = "upside" if upside >= 0 else "downside"
        lead = f"FMP consensus target of ${target_mean:.2f} implies ~{abs(upside) * 100:.1f}% {direction} from current price"
        if analyst_count is not None:
            count = int(float(analyst_count))
            lead += f" across {count} analysts"
        ladder_clause = _consensus_ladder_clause(consensus)
        return f"{lead}.{ladder_clause}" if ladder_clause else f"{lead}."

    eps_fy1 = first_finite(consensus.get("eps_estimate_fy1"), consensus.get("epsAvg"), consensus.get("estimatedEpsAvg"))
    eps_fy2 = first_finite(consensus.get("eps_estimate_fy2"))
    pieces: List[str] = []
    if eps_fy1 is not None:
        pieces.append(f"FY1 EPS {eps_fy1:.2f}")
    if eps_fy2 is not None:
        pieces.append(f"FY2 EPS {eps_fy2:.2f}")

    if pieces:
        detail = ", ".join(pieces)
        ladder_clause = _consensus_ladder_clause(consensus)
        if ladder_clause:
            return f"FMP consensus EPS coverage is available ({detail}).{ladder_clause} Price-target coverage is incomplete."
        return f"FMP consensus EPS coverage is available ({detail}), but price-target coverage is incomplete."

    return "FMP consensus coverage is incomplete, so the summary leans on scenario outputs."


def _consensus_ladder_clause(consensus: Dict[str, Any]) -> str:
    ladder = consensus.get("forward_pe_ladder") or consensus.get("eps_ladder") or []
    if not isinstance(ladder, list):
        return ""

    labels: List[str] = []
    for row in ladder:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or row.get("year") or "").strip()
        if label:
            labels.append(label)

    if not labels:
        return ""
    if len(labels) == 1:
        return f" Annual EPS ladder includes {labels[0]}."
    return f" Annual EPS ladder spans {labels[0]} to {labels[-1]}."


def confidence_breakdown(values: Iterable[str]) -> Dict[str, int]:
    breakdown = {"high": 0, "medium": 0, "low": 0}
    for value in values:
        label = confidence_label({"confidence": value})
        breakdown[label] += 1
    return breakdown


def weighted_average(pairs: Iterable[Tuple[Optional[float], float]]) -> Optional[float]:
    total = 0.0
    weight_sum = 0.0
    for value, weight in pairs:
        if value is None or weight <= 0:
            continue
        number = safe_float(value)
        if number is None:
            continue
        total += float(number) * weight
        weight_sum += weight
    if weight_sum <= 0:
        return None
    return total / weight_sum


def portfolio_state_from_gap(gap_pct: Optional[float]) -> str:
    if gap_pct is None:
        return "fair"
    if gap_pct > 0.10:
        return "premium"
    if gap_pct < -0.10:
        return "discount"
    return "fair"


def portfolio_risk_level(
    premium_weight: Optional[float],
    discount_weight: Optional[float],
    low_confidence_weight: Optional[float],
) -> str:
    premium_weight = float(premium_weight or 0.0)
    discount_weight = float(discount_weight or 0.0)
    low_confidence_weight = float(low_confidence_weight or 0.0)

    if low_confidence_weight >= 0.35 or premium_weight >= 0.55 or discount_weight >= 0.55:
        return "high"
    if low_confidence_weight >= 0.20 or premium_weight >= 0.35 or discount_weight >= 0.35:
        return "medium"
    return "low"


def build_watchlist_headline(
    watchlist_name: Optional[str],
    premium_count: int,
    fair_count: int,
    discount_count: int,
    total_count: int,
    error_count: int = 0,
) -> str:
    prefix = f"{watchlist_name} watchlist" if watchlist_name else "Watchlist"
    if total_count <= 0:
        return f"{prefix} has no analyzable tickers yet."
    if premium_count > fair_count and premium_count >= discount_count:
        base = (
            f"{prefix} is concentrated in premium names, so base-case upside is selective."
            if discount_count == 0
            else f"{prefix} skews premium, but discounted names still offer selective recovery setups."
        )
    elif discount_count > fair_count and discount_count >= premium_count:
        base = f"{prefix} skews discounted, which leaves room for mean reversion if earnings hold up."
    elif fair_count >= premium_count and fair_count >= discount_count:
        base = f"{prefix} is centered near fair value, with mixed risk-reward across holdings."
    else:
        base = f"{prefix} shows a mixed valuation regime across holdings."

    if error_count > 0:
        suffix = f" Coverage is incomplete for {error_count} ticker{'s' if error_count != 1 else ''}."
        return f"{base}{suffix}"
    return base


def build_portfolio_headline(
    portfolio_state: str,
    risk_level: str,
    total_value: float,
) -> str:
    if total_value <= 0:
        return "No valid positions were supplied for portfolio analysis."

    portfolio_state = (portfolio_state or "fair").strip().lower()
    risk_level = (risk_level or "low").strip().lower()

    if portfolio_state == "premium":
        if risk_level == "high":
            return "Portfolio is weighted toward premium exposure, so multiple compression is the primary risk."
        return "Portfolio is modestly tilted toward premium exposure, but valuation risk remains manageable."
    if portfolio_state == "discount":
        if risk_level == "high":
            return "Portfolio leans discounted, but confidence coverage is uneven, so the recovery setup is less certain."
        return "Portfolio leans discounted, leaving room for mean reversion if fundamentals hold."
    return "Portfolio is broadly balanced around fair value, with mixed valuation regimes across holdings."
