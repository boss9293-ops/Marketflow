"""
Finnhub fallback consensus fetcher.
Used when FMP returns 402/403 for a symbol (premium symbols).

Provides:
  - FY+1 forward EPS from forwardPE + current price
  - FY±2 projections from quarterly earnings aggregation
  - Saves result to fmp_consensus_snapshot DB (same schema)
"""
from __future__ import annotations

import datetime
import logging
import os
from typing import Any, Dict, List, Optional

import requests

log = logging.getLogger(__name__)

FINNHUB_BASE = "https://finnhub.io/api/v1"
FINNHUB_KEY_ENVS = ("FINNHUB_API_KEY", "NEXT_PUBLIC_FINNHUB_API_KEY")


def _get_key(api_key: Optional[str] = None) -> str:
    if api_key:
        return api_key.strip().strip("\'\"")
    for env in FINNHUB_KEY_ENVS:
        v = os.getenv(env, "").strip().strip("\'\"")
        if v:
            return v
    return ""


def _get(path: str, params: Dict[str, Any], key: str, timeout: float = 10.0) -> Any:
    """GET JSON from Finnhub. Returns parsed object or None on failure."""
    try:
        r = requests.get(
            f"{FINNHUB_BASE}{path}",
            params={**params, "token": key},
            headers={"X-Finnhub-Token": key},
            timeout=timeout,
        )
        if r.status_code != 200:
            log.warning("Finnhub %s → %s", path, r.status_code)
            return None
        text = r.text.strip()
        if not text or text.startswith("<"):
            log.warning("Finnhub %s returned HTML (premium endpoint)", path)
            return None
        import json
        return json.loads(text)
    except Exception as e:
        log.warning("Finnhub %s error: %s", path, e)
        return None


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f else None  # NaN check
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


def fetch_finnhub_consensus(
    ticker: str,
    *,
    current_price: Optional[float] = None,
    api_key: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fetch consensus data from Finnhub and save to fmp_consensus_snapshot DB.
    Returns the saved snapshot dict.
    """
    symbol = ticker.strip().upper()
    key = _get_key(api_key)
    if not key:
        raise ValueError("FINNHUB_API_KEY not set")

    # ── 1. Basic financials ────────────────────────────────────────────────────
    metrics_raw = _get("/stock/metric", {"symbol": symbol, "metric": "all"}, key)
    metrics: Dict[str, Any] = (metrics_raw or {}).get("metric", {})

    forward_pe   = _safe_float(metrics.get("forwardPE"))
    eps_ttm      = _safe_float(metrics.get("epsTTM"))
    eps_annual   = _safe_float(metrics.get("epsNormalizedAnnual") or metrics.get("epsAnnual"))
    growth_3y    = _safe_float(metrics.get("epsGrowth3Y"))   # percent (e.g. 20.59)
    growth_5y    = _safe_float(metrics.get("epsGrowth5Y"))   # percent

    # Quote for current price if not provided
    if current_price is None or current_price <= 0:
        quote = _get("/quote", {"symbol": symbol}, key) or {}
        current_price = _safe_float(quote.get("c")) or _safe_float(quote.get("pc"))

    # ── 2. Past quarterly earnings (last 4 quarters) ─────────────────────────
    past_q = _get("/stock/earnings", {"symbol": symbol}, key) or []

    # ── 3. Future earnings calendar (next 2 years) ────────────────────────────
    today = datetime.date.today()
    future_to = (today.replace(year=today.year + 2)).isoformat()
    cal_raw = _get("/calendar/earnings", {
        "symbol": symbol,
        "from": today.isoformat(),
        "to": future_to,
    }, key) or {}
    future_q = cal_raw.get("earningsCalendar", [])

    # ── 4. Build annual EPS ladder ─────────────────────────────────────────────
    eps_ladder: List[Dict[str, Any]] = []
    now_year = today.year

    # FY (current trailing) — use epsTTM or sum of last 4 quarters
    if past_q:
        ttm_sum = sum(
            float(q["actual"]) for q in past_q[:4]
            if q.get("actual") is not None
        )
        if ttm_sum > 0:
            eps_ladder.append({
                "year":          now_year - 1,
                "label":         f"{now_year - 1} Actual",
                "detail":        "actual",
                "kind":          "actual",
                "eps":           round(ttm_sum, 4),
                "eps_low":       None,
                "eps_high":      None,
                "analyst_count": None,
                "growth_pct":    None,
                "raw_date":      f"{now_year - 1}-12-31",
            })
    elif eps_annual and eps_annual > 0:
        eps_ladder.append({
            "year":          now_year - 1,
            "label":         f"{now_year - 1} Actual",
            "detail":        "actual",
            "kind":          "actual",
            "eps":           round(eps_annual, 4),
            "eps_low":       None,
            "eps_high":      None,
            "analyst_count": None,
            "growth_pct":    None,
            "raw_date":      f"{now_year - 1}-12-31",
        })

    # FY+1 — from forwardPE × current price
    fy1_eps: Optional[float] = None
    if forward_pe and forward_pe > 0 and current_price and current_price > 0:
        fy1_eps = round(current_price / forward_pe, 4)

    # Also try aggregating future quarters for FY+1
    if future_q:
        # Group by year
        from collections import defaultdict
        by_year: Dict[int, List[float]] = defaultdict(list)
        for q in future_q:
            est = _safe_float(q.get("epsEstimate"))
            if est is None:
                continue
            date_str = q.get("date", "")
            try:
                yr = int(date_str[:4])
                by_year[yr].append(est)
            except Exception:
                pass

        for yr in sorted(by_year.keys()):
            quarters = by_year[yr]
            if len(quarters) < 2:
                continue  # need at least 2 quarters to estimate annual
            # Extrapolate: if we have k quarters, scale to 4
            annual_est = round(sum(quarters) / len(quarters) * 4, 4)
            if yr == now_year and fy1_eps is None:
                fy1_eps = annual_est
            prev_eps = eps_ladder[-1]["eps"] if eps_ladder else None
            growth = round((annual_est - prev_eps) / prev_eps, 4) if prev_eps and prev_eps > 0 else None
            eps_ladder.append({
                "year":          yr,
                "label":         f"{yr} Estimated",
                "detail":        "using the consensus earnings estimate",
                "kind":          "estimate",
                "eps":           annual_est,
                "eps_low":       None,
                "eps_high":      None,
                "analyst_count": None,
                "growth_pct":    growth,
                "raw_date":      f"{yr}-12-31",
            })

    # FY+1 from forwardPE (add if not already from calendar)
    if fy1_eps is not None and not any(e["year"] == now_year for e in eps_ladder):
        prev_eps = eps_ladder[-1]["eps"] if eps_ladder else None
        growth_fy1 = round((fy1_eps - prev_eps) / prev_eps, 4) if prev_eps and prev_eps > 0 else None
        eps_ladder.append({
            "year":          now_year,
            "label":         f"{now_year} Estimated",
            "detail":        "using the consensus earnings estimate",
            "kind":          "estimate",
            "eps":           fy1_eps,
            "eps_low":       None,
            "eps_high":      None,
            "analyst_count": None,
            "growth_pct":    growth_fy1,
            "raw_date":      f"{now_year}-12-31",
        })

    # FY+2, FY+3 projection using EPS growth rate
    if eps_ladder and fy1_eps:
        # Choose growth: conservative avg of 3Y growth and forward PE implied growth
        fy1_prev = next((e["eps"] for e in eps_ladder if e["kind"] == "actual"), None)
        fy1_growth = ((fy1_eps - fy1_prev) / fy1_prev) if fy1_prev and fy1_prev > 0 else None

        # Taper the growth rate for outer years
        if fy1_growth and fy1_growth > 0:
            g3y_dec = (growth_3y / 100) if growth_3y and growth_3y > 0 else None
            # FY+2 growth = avg of FY+1 growth and 3Y historical (mean revert)
            fy2_growth = (fy1_growth * 0.5 + g3y_dec * 0.5) if g3y_dec else fy1_growth * 0.6
            fy3_growth = g3y_dec if g3y_dec else fy1_growth * 0.4

            last_est_eps = fy1_eps
            for delta, g in [(1, fy2_growth), (2, fy3_growth)]:
                yr = now_year + delta
                if any(e["year"] == yr for e in eps_ladder):
                    last_est_eps = next(e["eps"] for e in eps_ladder if e["year"] == yr)
                    continue
                est = round(last_est_eps * (1 + g), 4)
                eps_ladder.append({
                    "year":          yr,
                    "label":         f"{yr} Estimated",
                    "detail":        "using the consensus earnings estimate",
                    "kind":          "estimate",
                    "eps":           est,
                    "eps_low":       None,
                    "eps_high":      None,
                    "analyst_count": None,
                    "growth_pct":    round(g, 4),
                    "raw_date":      f"{yr}-12-31",
                })
                last_est_eps = est

    eps_ladder.sort(key=lambda r: r["year"])

    if not eps_ladder:
        raise RuntimeError(f"No EPS data available from Finnhub for {symbol}")

    # ── 5. Build snapshot and save ─────────────────────────────────────────────
    estimates = [e for e in eps_ladder if e["kind"] == "estimate"]
    snapshot = {
        "ticker":               symbol,
        "source":               "finnhub",
        "captured_at":          _now_iso(),
        "source_asof":          today.isoformat(),
        "eps_estimate_fy1":     estimates[0]["eps"] if estimates else None,
        "eps_estimate_fy2":     estimates[1]["eps"] if len(estimates) > 1 else None,
        "target_mean":          None,
        "target_high":          None,
        "target_low":           None,
        "analyst_count":        None,
        "target_analyst_count": None,
        "eps_ladder":           eps_ladder,
        "warnings":             [],
        "errors":               [],
    }

    from services.fmp_fundamental_fetch import save_fmp_consensus_snapshot
    return save_fmp_consensus_snapshot(snapshot, db_path=db_path)
