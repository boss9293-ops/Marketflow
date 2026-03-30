"""
Portfolio-level weighted valuation and risk engine.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, Iterable, List, Optional, Tuple

from services.stock_analysis_engine import run_stock_analysis
from services.valuation_rules import (
    build_portfolio_headline,
    build_risk_tag,
    build_summary_line,
    confidence_label,
    current_price_from_analysis,
    gap_vs_base_pct,
    normalize_mode,
    portfolio_risk_level,
    portfolio_state_from_gap,
    safe_float,
    valuation_state_label,
    weighted_average,
)


def _normalize_positions(positions: Iterable[Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    ordered: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    seen_index: Dict[str, int] = {}

    for index, item in enumerate(positions):
        if not isinstance(item, dict):
            errors.append({"index": index, "error": "position must be an object"})
            continue

        ticker = str(item.get("ticker") or item.get("symbol") or "").strip().upper()
        shares = safe_float(item.get("shares") or item.get("quantity") or item.get("qty"))
        label = str(item.get("label") or item.get("name") or "").strip() or None

        if not ticker:
            errors.append({"index": index, "error": "ticker is required"})
            continue
        if shares is None or shares <= 0:
            errors.append({"ticker": ticker, "error": "shares must be greater than zero"})
            continue

        if ticker in seen_index:
            existing = ordered[seen_index[ticker]]
            existing["shares"] += float(shares)
            if label and not existing.get("label"):
                existing["label"] = label
            continue

        seen_index[ticker] = len(ordered)
        ordered.append({"ticker": ticker, "shares": float(shares), "label": label})

    return ordered, errors


def _analyze_ticker(ticker: str, mode: str) -> Tuple[str, Optional[Dict[str, Any]], Optional[str]]:
    try:
        result = run_stock_analysis(ticker, mode=mode)
        return ticker, result, None
    except Exception as exc:
        return ticker, None, str(exc)


def run_portfolio_analysis(
    positions: Iterable[Any],
    mode: str = "auto",
    portfolio_name: Optional[str] = None,
) -> Dict[str, Any]:
    mode = normalize_mode(mode)
    normalized_positions, input_errors = _normalize_positions(positions)
    if not normalized_positions:
        return {
            "portfolio_name": portfolio_name,
            "mode": mode,
            "holdings": [],
            "summary": {
                "total_value": 0.0,
                "premium_weight_pct": 0.0,
                "fair_weight_pct": 0.0,
                "discount_weight_pct": 0.0,
                "portfolio_state": "fair",
                "risk_level": "low",
                "headline": "No valid positions were supplied for portfolio analysis.",
                "confidence": "low",
            },
            "top_risk_contributors": [],
            "top_opportunity_contributors": [],
            "errors": input_errors,
            "meta": {"mode": mode, "generated": False},
        }

    analyzed: Dict[str, Dict[str, Any]] = {}
    errors: List[Dict[str, Any]] = list(input_errors)

    if len(normalized_positions) == 1:
        ticker = normalized_positions[0]["ticker"]
        _, result, error = _analyze_ticker(ticker, mode)
        if result is not None:
            analyzed[ticker] = result
        else:
            errors.append({"ticker": ticker, "error": error or "analysis failed"})
    else:
        max_workers = min(6, max(1, len(normalized_positions)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_analyze_ticker, item["ticker"], mode): item["ticker"] for item in normalized_positions}
            for future in as_completed(futures):
                ticker = futures[future]
                try:
                    _, result, error = future.result()
                    if result is not None:
                        analyzed[ticker] = result
                    else:
                        errors.append({"ticker": ticker, "error": error or "analysis failed"})
                except Exception as exc:
                    errors.append({"ticker": ticker, "error": str(exc)})

    holdings: List[Dict[str, Any]] = []
    total_value = 0.0

    for position in normalized_positions:
        ticker = position["ticker"]
        shares = float(position["shares"])
        analysis = analyzed.get(ticker)
        if analysis is None:
            holdings.append(
                {
                    "ticker": ticker,
                    "shares": shares,
                    "current_price": None,
                    "market_value": 0.0,
                    "weight": None,
                    "state": "fair",
                    "position_vs_base_pct": None,
                    "confidence": "low",
                    "risk_tag": "coverage_gap",
                    "summary_line": f"{ticker} analysis is unavailable from the current feed.",
                    "analysis": None,
                    "error": next((entry["error"] for entry in errors if entry.get("ticker") == ticker), "analysis failed"),
                }
            )
            continue

        current_price = current_price_from_analysis(analysis)
        market_value = shares * current_price if current_price is not None else 0.0
        total_value += market_value
        state = valuation_state_label(analysis)
        confidence = confidence_label(analysis)
        gap_pct = gap_vs_base_pct(analysis)
        holdings.append(
            {
                "ticker": ticker,
                "name": analysis.get("name"),
                "shares": shares,
                "current_price": current_price,
                "market_value": market_value,
                "weight": None,
                "state": state,
                "position_vs_base_pct": gap_pct,
                "confidence": confidence,
                "risk_tag": build_risk_tag(state, confidence, gap_pct),
                "summary_line": build_summary_line(analysis, state, gap_pct, confidence),
                "analysis": analysis,
            }
        )

    premium_weight = 0.0
    fair_weight = 0.0
    discount_weight = 0.0
    low_confidence_weight = 0.0
    weighted_gap_pairs: List[Tuple[float, float]] = []
    confidence_score_pairs: List[Tuple[float, float]] = []

    for holding in holdings:
        market_value = float(holding.get("market_value") or 0.0)
        weight = market_value / total_value if total_value > 0 else 0.0
        holding["weight"] = weight if total_value > 0 else None

        state = str(holding.get("state") or "fair").strip().lower()
        confidence = str(holding.get("confidence") or "low").strip().lower()
        gap_pct = safe_float(holding.get("position_vs_base_pct"))

        if state == "premium":
            premium_weight += weight
        elif state == "discount":
            discount_weight += weight
        else:
            fair_weight += weight

        if confidence == "low":
            low_confidence_weight += weight

        if gap_pct is not None and weight > 0:
            weighted_gap_pairs.append((gap_pct, weight))
        confidence_score = 3 if confidence == "high" else 2 if confidence == "medium" else 1
        confidence_score_pairs.append((confidence_score, weight))

    weighted_gap_pct = weighted_average(weighted_gap_pairs)
    portfolio_state = portfolio_state_from_gap(weighted_gap_pct)
    risk_level = portfolio_risk_level(premium_weight, discount_weight, low_confidence_weight)

    confidence_score = weighted_average(confidence_score_pairs)
    if confidence_score is None:
        portfolio_confidence = "low"
    elif confidence_score >= 2.55 and low_confidence_weight < 0.20:
        portfolio_confidence = "high"
    elif confidence_score >= 1.85:
        portfolio_confidence = "medium"
    else:
        portfolio_confidence = "low"

    top_risk_contributors = sorted(
        [
            {
                "ticker": holding["ticker"],
                "shares": holding["shares"],
                "weight": holding.get("weight"),
                "market_value": holding.get("market_value"),
                "state": holding.get("state"),
                "confidence": holding.get("confidence"),
                "position_vs_base_pct": holding.get("position_vs_base_pct"),
                "summary_line": holding.get("summary_line"),
                "analysis": holding.get("analysis"),
                "score": (
                    max(float(holding.get("position_vs_base_pct") or 0.0), 0.0)
                    * float(holding.get("weight") or 0.0)
                    + (0.08 if str(holding.get("confidence") or "").lower() == "low" else 0.02 if str(holding.get("confidence") or "").lower() == "medium" else 0.0)
                ),
            }
            for holding in holdings
            if holding.get("weight") is not None
        ],
        key=lambda item: float(item.get("score") or 0.0),
        reverse=True,
    )[:3]

    top_opportunity_contributors = sorted(
        [
            {
                "ticker": holding["ticker"],
                "shares": holding["shares"],
                "weight": holding.get("weight"),
                "market_value": holding.get("market_value"),
                "state": holding.get("state"),
                "confidence": holding.get("confidence"),
                "position_vs_base_pct": holding.get("position_vs_base_pct"),
                "summary_line": holding.get("summary_line"),
                "analysis": holding.get("analysis"),
                "score": (
                    max(-(float(holding.get("position_vs_base_pct") or 0.0)), 0.0)
                    * float(holding.get("weight") or 0.0)
                    + (0.05 if str(holding.get("confidence") or "").lower() == "high" else 0.02 if str(holding.get("confidence") or "").lower() == "medium" else 0.0)
                ),
            }
            for holding in holdings
            if holding.get("weight") is not None
        ],
        key=lambda item: float(item.get("score") or 0.0),
        reverse=True,
    )[:3]

    headline = build_portfolio_headline(portfolio_state, risk_level, total_value)

    return {
        "portfolio_name": portfolio_name,
        "mode": mode,
        "holdings": holdings,
        "summary": {
            "total_value": round(total_value, 2),
            "premium_weight_pct": round(premium_weight, 4),
            "fair_weight_pct": round(fair_weight, 4),
            "discount_weight_pct": round(discount_weight, 4),
            "portfolio_state": portfolio_state,
            "risk_level": risk_level,
            "headline": headline,
            "confidence": portfolio_confidence,
            "weighted_gap_pct": None if weighted_gap_pct is None else round(weighted_gap_pct, 4),
        },
        "top_risk_contributors": top_risk_contributors,
        "top_opportunity_contributors": top_opportunity_contributors,
        "errors": errors,
        "meta": {
            "mode": mode,
            "generated": True,
            "error_count": len(errors),
            "holding_count": len(holdings),
        },
    }

