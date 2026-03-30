"""
Watchlist-level interpreted summary engine.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, Iterable, List, Optional, Tuple

from services.stock_analysis_engine import run_stock_analysis
from services.valuation_rules import (
    build_risk_tag,
    build_summary_line,
    build_watchlist_headline,
    confidence_breakdown,
    confidence_label,
    current_price_from_analysis,
    dedupe_tickers,
    gap_vs_base_pct,
    normalize_mode,
    valuation_state_label,
)


def _analyze_ticker(ticker: str, mode: str) -> Tuple[str, Optional[Dict[str, Any]], Optional[str]]:
    try:
        result = run_stock_analysis(ticker, mode=mode)
        return ticker, result, None
    except Exception as exc:
        return ticker, None, str(exc)


def run_watchlist_summary(
    tickers: Iterable[str],
    mode: str = "auto",
    watchlist_name: Optional[str] = None,
) -> Dict[str, Any]:
    mode = normalize_mode(mode)
    ordered_tickers = dedupe_tickers(tickers)
    if not ordered_tickers:
        return {
            "watchlist_name": watchlist_name,
            "mode": mode,
            "items": [],
            "summary": {
                "ticker_count": 0,
                "analyzed_count": 0,
                "premium_count": 0,
                "fair_count": 0,
                "discount_count": 0,
                "confidence_breakdown": {"high": 0, "medium": 0, "low": 0},
                "headline": build_watchlist_headline(watchlist_name, 0, 0, 0, 0),
            },
            "errors": [],
            "meta": {"mode": mode, "generated": False},
        }

    analyzed: Dict[str, Dict[str, Any]] = {}
    errors: List[Dict[str, Any]] = []

    if len(ordered_tickers) == 1:
        ticker = ordered_tickers[0]
        _, result, error = _analyze_ticker(ticker, mode)
        if result is not None:
            analyzed[ticker] = result
        else:
            errors.append({"ticker": ticker, "error": error or "analysis failed"})
    else:
        max_workers = min(6, max(1, len(ordered_tickers)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_analyze_ticker, ticker, mode): ticker for ticker in ordered_tickers}
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

    items: List[Dict[str, Any]] = []
    state_counts = {"premium": 0, "fair": 0, "discount": 0}
    confidences: List[str] = []

    for ticker in ordered_tickers:
        analysis = analyzed.get(ticker)
        if analysis is None:
            item = {
                "ticker": ticker,
                "current_price": None,
                "state": "fair",
                "position_vs_base_pct": None,
                "confidence": "low",
                "risk_tag": "coverage_gap",
                "summary_line": f"{ticker} analysis is unavailable from the current feed.",
                "analysis": None,
                "error": next((entry["error"] for entry in errors if entry.get("ticker") == ticker), "analysis failed"),
            }
            items.append(item)
            continue

        state = valuation_state_label(analysis)
        confidence = confidence_label(analysis)
        gap_pct = gap_vs_base_pct(analysis)
        summary_line = build_summary_line(analysis, state, gap_pct, confidence)
        item = {
            "ticker": ticker,
            "name": analysis.get("name"),
            "current_price": current_price_from_analysis(analysis),
            "state": state,
            "position_vs_base_pct": gap_pct,
            "confidence": confidence,
            "risk_tag": build_risk_tag(state, confidence, gap_pct),
            "summary_line": summary_line,
            "analysis": analysis,
        }
        items.append(item)
        if state in state_counts:
            state_counts[state] += 1
        confidences.append(confidence)

    headline = build_watchlist_headline(
        watchlist_name,
        state_counts["premium"],
        state_counts["fair"],
        state_counts["discount"],
        len(analyzed),
        len(errors),
    )

    return {
        "watchlist_name": watchlist_name,
        "mode": mode,
        "items": items,
        "summary": {
            "ticker_count": len(ordered_tickers),
            "analyzed_count": len(analyzed),
            "premium_count": state_counts["premium"],
            "fair_count": state_counts["fair"],
            "discount_count": state_counts["discount"],
            "confidence_breakdown": confidence_breakdown(confidences),
            "headline": headline,
        },
        "errors": errors,
        "meta": {
            "mode": mode,
            "generated": True,
            "error_count": len(errors),
        },
    }

