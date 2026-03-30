"""
Auto Stock Analysis Engine V1.
"""
from __future__ import annotations

import math
import os
import re
import sqlite3
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

try:
    import yfinance as yf  # type: ignore
except Exception:  # pragma: no cover
    yf = None

from services.fmp_fundamental_fetch import get_latest_fmp_consensus, fetch_and_store_fmp_consensus
try:
    from services.finnhub_fetch import fetch_finnhub_consensus as _fetch_finnhub_consensus
except Exception:
    _fetch_finnhub_consensus = None
from services.valuation_rules import build_consensus_note
from schemas.stock_analysis_schema import StockAnalysisOutput, StockNarrative, StockValuationState

CACHE_TTL_SECONDS = 300
_CACHE: Dict[str, Dict[str, Any]] = {}

SECTOR_PE_BASE: Dict[str, float] = {
    "Technology": 28.0,
    "Communication Services": 22.0,
    "Consumer Discretionary": 24.0,
    "Consumer Staples": 19.0,
    "Healthcare": 20.0,
    "Financials": 14.0,
    "Industrials": 18.0,
    "Energy": 12.0,
    "Utilities": 17.0,
    "Real Estate": 16.0,
    "Materials": 15.0,
    "ETF": 22.0,
    "Unknown": 20.0,
}

SECTOR_KEYWORDS: List[Tuple[str, str]] = [
    (r"(technology|software|semiconductor|computer|hardware|internet services|it services)", "Technology"),
    (r"(communication|media|entertainment|telecom)", "Communication Services"),
    (r"(consumer cyclical|consumer discretionary|retail|travel|automotive|automobile|auto manufacturers|automobile manufacturers|motor vehicle|vehicle|vehicles|cars|leisure)", "Consumer Discretionary"),
    (r"(consumer defensive|consumer staples|food|beverage|household)", "Consumer Staples"),
    (r"(health care|healthcare|pharmaceutical|biotech|medical)", "Healthcare"),
    (r"(financial|banks|banking|insurance|capital markets)", "Financials"),
    (r"(industrial|industrials|aerospace|machinery|logistics|transport)", "Industrials"),
    (r"(energy|oil|gas|refining)", "Energy"),
    (r"(utility|utilities|water|electric)", "Utilities"),
    (r"(real estate|reit)", "Real Estate"),
    (r"(materials|basic materials|chemicals|metals|mining)", "Materials"),
    (r"(etf|exchange traded fund|index fund)", "ETF"),
]


def _now_ts() -> float:
    return time.monotonic()


def _db_has_price_tables(path: str) -> bool:
    if not os.path.exists(path):
        return False
    try:
        conn = sqlite3.connect(path)
        try:
            cur = conn.execute(
                """
                SELECT 1
                FROM sqlite_master
                WHERE type = 'table'
                  AND name IN ('ohlcv_daily', 'ticker_history_daily')
                LIMIT 1
                """
            )
            return cur.fetchone() is not None
        finally:
            conn.close()
    except Exception:
        return False


def _resolve_db_path() -> str:
    base_dir = os.path.dirname(__file__)
    candidates = [
        os.path.join(base_dir, "..", "..", "..", "data", "marketflow.db"),
        os.path.join(base_dir, "..", "..", "data", "marketflow.db"),
        os.path.join(base_dir, "..", "marketflow.db"),
    ]
    for candidate in candidates:
        if _db_has_price_tables(candidate):
            return candidate
    return candidates[0]


DB_PATH = _resolve_db_path()

# ── Persistent DB cache for fundamentals (yfinance / Finnhub fallback) ─────
# Checked before hitting external APIs. Updated every time fresh data arrives.
_DB_CACHE_TTL_HOURS = 24   # treat DB row as stale after this many hours


def _ensure_fundamentals_cache_schema(conn: sqlite3.Connection) -> None:
    """Create stock_fundamentals_cache table if it doesn't exist yet."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS stock_fundamentals_cache (
            symbol              TEXT PRIMARY KEY,
            source              TEXT NOT NULL,
            metrics_json        TEXT,
            stats_json          TEXT,
            captured_at         TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        )
        """
    )
    conn.commit()


def _load_fundamentals_db_cache(symbol: str) -> Optional[Dict[str, Any]]:
    """
    Load cached fundamentals from SQLite.
    Returns dict with 'metrics' and 'stats' keys if cache is fresh,
    or None if cache is missing / stale.
    """
    import datetime as _dtt
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            _ensure_fundamentals_cache_schema(conn)
            row = conn.execute(
                "SELECT * FROM stock_fundamentals_cache WHERE symbol = ? LIMIT 1",
                (symbol,),
            ).fetchone()
            if not row:
                return None
            # Staleness check
            updated = str(row["updated_at"] or "")
            if updated:
                try:
                    ts = _dtt.datetime.fromisoformat(updated.replace("Z", "+00:00"))
                    ts = ts.replace(tzinfo=None)
                    age_hours = (_dtt.datetime.utcnow() - ts).total_seconds() / 3600
                    if age_hours > _DB_CACHE_TTL_HOURS:
                        return None   # stale — caller fetches fresh
                except Exception:
                    pass
            import json as _json
            metrics = _json.loads(row["metrics_json"]) if row["metrics_json"] else {}
            stats   = _json.loads(row["stats_json"])   if row["stats_json"]   else {}
            return {
                "metrics": metrics,
                "stats":   stats,
                "source":  str(row["source"] or "cache"),
                "captured_at": str(row["captured_at"] or ""),
            }
        finally:
            conn.close()
    except Exception:
        return None


def _save_fundamentals_db_cache(
    symbol: str,
    metrics: Dict[str, Any],
    stats: Dict[str, Any],
    source: str,
) -> None:
    """
    Upsert fundamentals into stock_fundamentals_cache.
    Called after any successful fetch (yfinance, Finnhub, FMP).
    """
    import json as _json
    import datetime as _dtt
    now = _dtt.datetime.utcnow().isoformat(timespec="seconds")
    try:
        conn = sqlite3.connect(DB_PATH)
        try:
            _ensure_fundamentals_cache_schema(conn)
            conn.execute(
                """
                INSERT INTO stock_fundamentals_cache
                    (symbol, source, metrics_json, stats_json, captured_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    source       = excluded.source,
                    metrics_json = excluded.metrics_json,
                    stats_json   = excluded.stats_json,
                    updated_at   = excluded.updated_at
                """,
                (
                    symbol,
                    source,
                    _json.dumps(metrics, default=str),
                    _json.dumps(stats,   default=str),
                    now,
                    now,
                ),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass   # cache write failure must never break the analysis flow



def _cache_get(key: str):
    entry = _CACHE.get(key)
    if entry and (_now_ts() - entry["ts"] < CACHE_TTL_SECONDS):
        return entry["value"]
    return None


def _cache_set(key: str, value: Any):
    _CACHE[key] = {"ts": _now_ts(), "value": value}
    return value


def _normalize_ticker(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if ":" in raw:
        raw = raw.split(":")[-1]
    return raw


def _safe_float(value: Any) -> Optional[float]:
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


def _safe_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(float(value))
    except Exception:
        return None


def _finite(value: Optional[float]) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def _median(values: Iterable[float]) -> Optional[float]:
    arr = [float(v) for v in values if _finite(v)]
    if not arr:
        return None
    try:
        return float(statistics.median(arr))
    except Exception:
        return None


def _weighted_avg(pairs: Iterable[Tuple[Optional[float], float]]) -> Optional[float]:
    total = 0.0
    weight_sum = 0.0
    for value, weight in pairs:
        if not _finite(value) or weight <= 0:
            continue
        total += float(value) * weight
        weight_sum += weight
    if weight_sum <= 0:
        return None
    return total / weight_sum


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _normalize_growth(value: Any) -> Optional[float]:
    growth = _safe_float(value)
    if growth is None:
        return None
    if abs(growth) > 1.5 and abs(growth) <= 100.0:
        growth /= 100.0
    return growth


def _normalize_sector(raw_sector: Optional[str], industry: Optional[str] = None, ticker: Optional[str] = None) -> str:
    text = " ".join(filter(None, [str(raw_sector or ""), str(industry or ""), str(ticker or "")])).lower()
    for pattern, sector in SECTOR_KEYWORDS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return sector
    return "Unknown"


def _sector_pe(sector: str) -> float:
    return SECTOR_PE_BASE.get(sector, SECTOR_PE_BASE["Unknown"])


def _mode_bias(mode: str) -> Dict[str, float]:
    mode = (mode or "auto").strip().lower()
    if mode == "conservative":
        return {"growth": -0.015, "multiple": 0.95}
    if mode == "aggressive":
        return {"growth": 0.015, "multiple": 1.05}
    return {"growth": 0.0, "multiple": 1.0}


def _pick_num(obj: Any, keys: Iterable[str]) -> Optional[float]:
    if obj is None:
        return None
    if isinstance(obj, list):
        obj = obj[0] if obj else {}
    if not isinstance(obj, dict):
        return None
    for key in keys:
        val = _safe_float(obj.get(key))
        if val is not None:
            return val
    return None


def _first_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
        return {}
    return value if isinstance(value, dict) else {}


def _rows_to_series(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in rows:
        close = _safe_float(row["adj_close"]) if row["adj_close"] is not None else _safe_float(row["close"])
        if close is None or close <= 0:
            continue
        out.append(
            {
                "date": row["date"],
                "close": close,
                "open": _safe_float(row["open"]),
                "high": _safe_float(row["high"]),
                "low": _safe_float(row["low"]),
                "volume": _safe_int(row["volume"]),
                "source": row["source"],
            }
        )
    return out


def _build_price_history(price_series: List[Dict[str, Any]], max_points: int = 96) -> List[Dict[str, Any]]:
    chronological: List[Dict[str, Any]] = []
    for point in reversed(price_series or []):
        close = _safe_float(point.get("close"))
        date = str(point.get("date") or "").strip()
        if close is None or close <= 0 or not date:
            continue
        chronological.append({"date": date, "close": float(close)})

    if not chronological:
        return []

    recent = chronological[-252:]
    if len(recent) <= max_points:
        return [{"date": item["date"], "close": round(float(item["close"]), 2)} for item in recent]

    step = max(1, math.ceil(len(recent) / max_points))
    sampled = recent[::step]
    if sampled[0]["date"] != recent[0]["date"]:
        sampled.insert(0, recent[0])
    if sampled[-1]["date"] != recent[-1]["date"]:
        sampled.append(recent[-1])

    deduped: List[Dict[str, Any]] = []
    seen = set()
    for item in sampled:
        date = item["date"]
        if date in seen:
            continue
        seen.add(date)
        deduped.append({"date": date, "close": round(float(item["close"]), 2)})
    return deduped


def _load_db_snapshot(symbol: str) -> Dict[str, Any]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT date, open, high, low, close, adj_close, volume, source
            FROM ohlcv_daily
            WHERE symbol = ?
            ORDER BY date DESC
            LIMIT 1500
            """,
            (symbol,),
        ).fetchall()

        if not rows:
            rows = conn.execute(
                """
                SELECT date, open, high, low, close, NULL AS adj_close, volume, 'ticker_history_daily' AS source
                FROM ticker_history_daily
                WHERE symbol = ?
                ORDER BY date DESC
                LIMIT 1500
                """,
                (symbol,),
            ).fetchall()

        indicators = conn.execute(
            """
            SELECT *
            FROM indicators_daily
            WHERE symbol = ?
            ORDER BY date DESC
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()

        universe = conn.execute(
            """
            SELECT *
            FROM universe_symbols
            WHERE symbol = ?
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()
    finally:
        conn.close()

    price_series = _rows_to_series(rows)
    latest = price_series[0] if price_series else {}
    previous = price_series[1] if len(price_series) > 1 else {}

    current_price = latest.get("close")
    prev_close = previous.get("close")
    change_pct = None
    if _finite(current_price) and _finite(prev_close) and float(prev_close) != 0:
        change_pct = (float(current_price) - float(prev_close)) / abs(float(prev_close))

    highs_1y = [point["close"] for point in price_series[:252] if _finite(point.get("close"))]
    highs_3y = [point["close"] for point in price_series[:756] if _finite(point.get("close"))]
    highs_5y = [point["close"] for point in price_series[:1260] if _finite(point.get("close"))]

    return {
        "symbol": symbol,
        "price": current_price,
        "prev_close": prev_close,
        "current_change_pct": change_pct,
        "price_series": price_series,
        "price_high_1y": max(highs_1y) if highs_1y else None,
        "price_low_1y": min(highs_1y) if highs_1y else None,
        "price_high_3y": max(highs_3y) if highs_3y else None,
        "price_low_3y": min(highs_3y) if highs_3y else None,
        "price_high_5y": max(highs_5y) if highs_5y else None,
        "price_low_5y": min(highs_5y) if highs_5y else None,
        "sma20": _safe_float(indicators["sma20"]) if indicators else None,
        "sma50": _safe_float(indicators["sma50"]) if indicators else None,
        "sma200": _safe_float(indicators["sma200"]) if indicators else None,
        "rsi14": _safe_float(indicators["rsi14"]) if indicators else None,
        "vol20": _safe_float(indicators["vol20"]) if indicators else None,
        "name": universe["name"] if universe else None,
        "raw_sector": universe["sector"] if universe else None,
        "industry": universe["industry"] if universe else None,
        "exchange": universe["exchange"] if universe else None,
        "market_cap": _safe_float(universe["market_cap"]) if universe else None,
        "data_version": universe["last_updated"] if universe else None,
        "db_rows": len(price_series),
    }


def _fetch_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: float = 6.0):
    res = requests.get(url, headers=headers, timeout=timeout)
    if not res.ok:
        return None, res.status_code
    try:
        return res.json(), res.status_code
    except Exception:
        return None, res.status_code


def _load_fmp_bundle(symbol: str, api_key: str) -> Dict[str, Any]:
    base = "https://financialmodelingprep.com"
    endpoints = {
        "ratios":          f"/stable/ratios?symbol={symbol}&limit=1",
        "ratios_ttm":      f"/stable/ratios-ttm?symbol={symbol}",
        "profile":         f"/stable/profile?symbol={symbol}",
        "quote":           f"/stable/quote?symbol={symbol}",
        "estimates":       f"/stable/analyst-estimates?symbol={symbol}&period=annual",
        "key_metrics_ttm": f"/stable/key-metrics-ttm?symbol={symbol}",
        "income_stmt":     f"/stable/income-statement?symbol={symbol}&limit=1",
        "balance_sheet":   f"/stable/balance-sheet-statement?symbol={symbol}&limit=1",
    }

    def _load(path: str):
        data, status = _fetch_json(f"{base}{path}{'&' if '?' in path else '?'}apikey={api_key}")
        return data, status

    results: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {name: pool.submit(_load, path) for name, path in endpoints.items()}
        for name, future in futures.items():
            try:
                data, status = future.result(timeout=6)
            except FutureTimeoutError:
                data, status = None, 504
            results[name] = {"data": data, "status": status}

    return results


def _load_yfinance_bundle(symbol: str) -> Dict[str, Any]:
    if yf is None:
        return {}
    ticker = yf.Ticker(symbol)
    info: Dict[str, Any] = {}
    try:
        info = dict(ticker.info or {})
    except Exception:
        info = {}
    return info


def _extract_fmp_metrics(bundle: Dict[str, Any]) -> Dict[str, Any]:
    ratios = bundle.get("ratios", {})
    profile = bundle.get("profile", {})
    quote = bundle.get("quote", {})
    estimates = bundle.get("estimates", {})

    ratios_arr = _first_dict(ratios.get("data") or [])
    ratios_list = ratios.get("data") or []
    profile_arr = _first_dict(profile.get("data") or [])
    quote_arr = _first_dict(quote.get("data") or [])
    estimates_list = estimates.get("data") or []
    estimates_arr = _first_dict(estimates_list)

    current_price = _pick_num(quote_arr, ["price", "lastPrice", "last"]) or _pick_num(profile_arr, ["price"])
    current_pe = _pick_num(ratios_arr, ["priceToEarningsRatio", "priceToEarningsRatioTTM", "peRatio", "peRatioTTM", "priceEarningsRatio"]) or _pick_num(
        quote_arr, ["pe"]
    )
    trailing_eps = _pick_num(ratios_arr, ["netIncomePerShare", "netIncomePerShareTTM"]) or _pick_num(profile_arr, ["eps", "epsTTM", "ttmEps", "epsActual"])
    forward_eps = _pick_num(
        estimates_arr,
        ["epsAvg", "estimatedEpsAvg", "estimatedEps", "epsEstimated", "epsEstimate"],
    )

    gross_margin = _pick_num(ratios_arr, ["grossProfitMargin", "grossMargin", "grossProfitMarginTTM"])
    operating_margin = _pick_num(ratios_arr, ["operatingProfitMargin", "operatingMargin", "operatingProfitMarginTTM"])
    net_margin = _pick_num(ratios_arr, ["netProfitMargin", "profitMargin", "netProfitMarginTTM"])
    debt_to_equity = _pick_num(ratios_arr, ["debtToEquityRatio", "debtToEquity", "debtEquityRatio"])
    current_ratio = _pick_num(ratios_arr, ["currentRatio", "currentRatioTTM"])

    revenue_growth = _normalize_growth(profile_arr.get("revenueGrowth") if isinstance(profile_arr, dict) else None)
    earnings_growth = _normalize_growth(profile_arr.get("earningsGrowth") if isinstance(profile_arr, dict) else None)

    eps_history = [
        _pick_num(row, ["netIncomePerShare"])
        for row in (ratios_list if isinstance(ratios_list, list) else [])
    ]
    eps_history = [v for v in eps_history if _finite(v) and float(v) > 0]

    pe_history = [
        _pick_num(row, ["priceToEarningsRatio", "peRatio", "peRatioTTM", "priceEarningsRatio"])
        for row in (ratios_list if isinstance(ratios_list, list) else [])
    ]
    pe_history = [v for v in pe_history if _finite(v) and float(v) > 0]

    revenue_series = [
        _pick_num(row, ["revenueAvg", "estimatedRevenueAvg", "estimatedRevenue", "revenueEstimated", "revenueEstimate"])
        for row in (estimates_list if isinstance(estimates_list, list) else [])
    ]
    revenue_series = [v for v in revenue_series if _finite(v) and float(v) > 0]

    if forward_eps is None and revenue_growth is None and revenue_series:
        revenue_growth = _normalize_growth(revenue_series[0] / revenue_series[-1] - 1 if len(revenue_series) > 1 and revenue_series[-1] else None)

    sector = str(profile_arr.get("sector") or "").strip() if isinstance(profile_arr, dict) else ""
    industry = str(profile_arr.get("industry") or "").strip() if isinstance(profile_arr, dict) else ""
    exchange = str(profile_arr.get("exchangeShortName") or profile_arr.get("exchange") or "").strip() if isinstance(profile_arr, dict) else ""
    market_cap = _safe_float(profile_arr.get("mktCap")) if isinstance(profile_arr, dict) else None
    shares = _safe_float(profile_arr.get("sharesOutstanding")) if isinstance(profile_arr, dict) else None
    name = str(profile_arr.get("companyName") or profile_arr.get("symbol") or "").strip() if isinstance(profile_arr, dict) else ""

    return {
        "source": "fmp",
        "name": name or None,
        "sector": sector or None,
        "industry": industry or None,
        "exchange": exchange or None,
        "market_cap": market_cap,
        "shares_outstanding": shares,
        "current_price": current_price,
        "current_pe": current_pe,
        "trailing_eps": trailing_eps,
        "forward_eps": forward_eps,
        "gross_margin": gross_margin,
        "operating_margin": operating_margin,
        "net_margin": net_margin,
        "debt_to_equity": debt_to_equity,
        "current_ratio": current_ratio,
        "revenue_growth": revenue_growth,
        "earnings_growth": earnings_growth,
        "eps_history": eps_history,
        "pe_history": pe_history,
        "revenue_series": revenue_series,
        "ratio_count": len(ratios_list) if isinstance(ratios_list, list) else 0,
        "estimate_count": len(estimates_list) if isinstance(estimates_list, list) else 0,
    }



def _extract_stats_fields(bundle: Dict[str, Any]) -> Dict[str, Any]:
    """Extract extended statistics from FMP bundle for Statistics tab."""
    ratios_arr  = _first_dict((bundle.get("ratios", {}).get("data")) or [])
    rttm_arr    = _first_dict((bundle.get("ratios_ttm", {}).get("data")) or [])
    profile_arr = _first_dict((bundle.get("profile", {}).get("data")) or [])
    kmttm_arr   = _first_dict((bundle.get("key_metrics_ttm", {}).get("data")) or [])
    inc_arr     = _first_dict((bundle.get("income_stmt", {}).get("data")) or [])
    bs_arr      = _first_dict((bundle.get("balance_sheet", {}).get("data")) or [])

    def _r(d, keys):
        return _pick_num(d, keys)

    def _r2(d1, d2, keys1, keys2=None):
        """Try d1 first, fallback to d2."""
        v = _pick_num(d1, keys1)
        if v is not None:
            return v
        return _pick_num(d2, keys2 or keys1)

    return {
        # Valuation multiples — prefer TTM
        "ps_ratio":          _r2(rttm_arr, ratios_arr, ["priceToSalesRatioTTM"], ["priceToSalesRatio"]),
        "pb_ratio":          _r2(rttm_arr, ratios_arr, ["priceToBookRatioTTM"], ["priceToBookRatio"]),
        "peg_ratio":         _r2(rttm_arr, ratios_arr, ["priceToEarningsGrowthRatioTTM", "forwardPriceToEarningsGrowthRatioTTM"],
                                                        ["priceToEarningsGrowthRatio", "forwardPriceToEarningsGrowthRatio"]),
        "ev_ebitda":         _r2(kmttm_arr, ratios_arr, ["evToEBITDATTM"], ["enterpriseValueMultiple"]),
        # Profitability — from key_metrics_ttm (most accurate)
        "roe":               _r(kmttm_arr, ["returnOnEquityTTM"]),
        "roa":               _r(kmttm_arr, ["returnOnAssetsTTM"]),
        "roic":              _r(kmttm_arr, ["returnOnInvestedCapitalTTM", "returnOnCapitalEmployedTTM"]),
        "asset_turnover":    _r2(rttm_arr, ratios_arr, ["assetTurnoverTTM"], ["assetTurnover"]),
        "ebitda_margin":     _r2(rttm_arr, ratios_arr, ["ebitdaMarginTTM"], ["ebitdaMargin"]),
        # Enterprise metrics — from key_metrics_ttm
        "enterprise_value":  _r(kmttm_arr, ["enterpriseValueTTM"]),
        "ev_sales":          _r(kmttm_arr, ["evToSalesTTM"]),
        "ev_fcf":            _r(kmttm_arr, ["evToFreeCashFlowTTM"]),
        "ev_opcf":           _r(kmttm_arr, ["evToOperatingCashFlowTTM"]),
        "fcf_per_share":     _r(ratios_arr, ["freeCashFlowPerShare"]),
        "revenue_per_share": _r(ratios_arr, ["revenuePerShare"]),
        "roic_km":           _r(kmttm_arr, ["returnOnInvestedCapitalTTM"]),
        # Income statement absolutes
        "revenue":           _r(inc_arr, ["revenue"]),
        "gross_profit":      _r(inc_arr, ["grossProfit"]),
        "operating_income":  _r(inc_arr, ["operatingIncome"]),
        "net_income":        _r(inc_arr, ["netIncome", "netIncomeFromContinuingOperations"]),
        "ebitda":            _r(inc_arr, ["ebitda"]),
        "eps_reported":      _r(inc_arr, ["epsDiluted", "eps"]),
        "income_period":     inc_arr.get("fiscalYear") if isinstance(inc_arr, dict) else None,
        # Balance sheet absolutes
        "cash":              _r(bs_arr, ["cashAndShortTermInvestments", "cashAndCashEquivalents"]),
        "total_debt":        _r(bs_arr, ["totalDebt"]),
        "net_debt":          _r(bs_arr, ["netDebt"]),
        "total_assets":      _r(bs_arr, ["totalAssets"]),
        # Company metadata
        "employees":         _safe_float(profile_arr.get("fullTimeEmployees") if isinstance(profile_arr, dict) else None),
    }

def _extract_yfinance_metrics(info: Dict[str, Any]) -> Dict[str, Any]:
    if not info:
        return {}
    return {
        "source": "yfinance",
        "name": info.get("shortName") or info.get("longName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "market_cap": _safe_float(info.get("marketCap")),
        "shares_outstanding": _safe_float(info.get("sharesOutstanding")),
        "current_price": _safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or info.get("postMarketPrice")),
        "current_pe": _safe_float(info.get("trailingPE") or info.get("forwardPE")),
        "trailing_eps": _safe_float(info.get("trailingEps") or info.get("epsTrailingTwelveMonths") or info.get("eps")),
        "forward_eps": _safe_float(info.get("forwardEps")),
        "gross_margin": _normalize_growth(info.get("grossMargins")),
        "operating_margin": _normalize_growth(info.get("operatingMargins")),
        "net_margin": _normalize_growth(info.get("profitMargins")),
        "debt_to_equity": _safe_float(info.get("debtToEquity")),
        "current_ratio": _safe_float(info.get("currentRatio")),
        "revenue_growth": _normalize_growth(info.get("revenueGrowth")),
        "earnings_growth": _normalize_growth(info.get("earningsGrowth") or info.get("earningsQuarterlyGrowth")),
        "eps_history": [],
        "pe_history": [],
        "revenue_series": [],
    }


def _extract_yfinance_stats(info: Dict[str, Any]) -> Dict[str, Any]:
    """Extract stats-tab fields from yfinance info dict.
    Used as fallback when FMP is rate-limited (HTTP 429).
    Maps yfinance keys -> stats schema expected by StatisticsPanel.
    """
    if not info:
        return {}

    shares = _safe_float(info.get("sharesOutstanding"))
    total_cash = _safe_float(info.get("totalCash"))
    total_debt = _safe_float(info.get("totalDebt"))
    total_revenue = _safe_float(info.get("totalRevenue"))
    gross_profits = _safe_float(info.get("grossProfits"))
    ebitda = _safe_float(info.get("ebitda"))
    operating_cf = _safe_float(info.get("operatingCashflow"))
    free_cf = _safe_float(info.get("freeCashflow"))
    net_income = _safe_float(info.get("netIncomeToCommon"))
    total_assets = _safe_float(
        info.get("totalAssets")
        or (info.get("totalCash", 0) or 0)
    )
    mktcap = _safe_float(info.get("marketCap"))
    ev = _safe_float(info.get("enterpriseValue"))

    # operating income = revenue * operating_margin
    op_margin = _normalize_growth(info.get("operatingMargins"))
    operating_income = None
    if _finite(total_revenue) and _finite(op_margin):
        operating_income = float(total_revenue) * float(op_margin)

    # net debt = total_debt - total_cash
    net_debt = None
    if _finite(total_debt) and _finite(total_cash):
        net_debt = float(total_debt) - float(total_cash)

    # per-share values
    revenue_per_share = None
    fcf_per_share = None
    eps_reported = None
    if _finite(shares) and float(shares) > 0:
        if _finite(total_revenue):
            revenue_per_share = float(total_revenue) / float(shares)
        if _finite(free_cf):
            fcf_per_share = float(free_cf) / float(shares)
        if _finite(net_income):
            eps_reported = float(net_income) / float(shares)

    # ebitda margin = ebitda / revenue
    ebitda_margin = None
    if _finite(ebitda) and _finite(total_revenue) and float(total_revenue) > 0:
        ebitda_margin = float(ebitda) / float(total_revenue)

    # ev ratios
    ev_sales = _safe_float(info.get("enterpriseToRevenue"))
    ev_ebitda = _safe_float(info.get("enterpriseToEbitda"))
    ev_fcf = None
    if _finite(ev) and _finite(free_cf) and float(free_cf) > 0:
        ev_fcf = float(ev) / float(free_cf)

    # fiscal year for income_period
    income_period = None
    most_recent_q = info.get("mostRecentQuarter")
    if most_recent_q:
        try:
            import datetime as _dt
            ts = _dt.datetime.fromtimestamp(most_recent_q)
            income_period = str(ts.year)
        except Exception:
            pass

    out = {
        # Valuation multiples
        "ps_ratio":          _safe_float(info.get("priceToSalesTrailing12Months")),
        "pb_ratio":          _safe_float(info.get("priceToBook")),
        "peg_ratio":         _safe_float(info.get("trailingPegRatio") or info.get("pegRatio")),
        "ev_ebitda":         ev_ebitda,
        "ev_sales":          ev_sales,
        "ev_fcf":            ev_fcf,
        # Profitability
        "roe":               _normalize_growth(info.get("returnOnEquity")),
        "roa":               _normalize_growth(info.get("returnOnAssets")),
        "roic":              None,   # not in yfinance info dict
        "roic_km":           None,
        "asset_turnover":    None,   # not in yfinance info dict
        "ebitda_margin":     ebitda_margin,
        # Enterprise
        "enterprise_value":  ev,
        "fcf_per_share":     fcf_per_share,
        "revenue_per_share": revenue_per_share,
        # Income statement
        "revenue":           total_revenue,
        "gross_profit":      gross_profits,
        "operating_income":  operating_income,
        "net_income":        net_income,
        "ebitda":            ebitda,
        "eps_reported":      eps_reported or _safe_float(info.get("trailingEps")),
        "income_period":     income_period,
        # Balance sheet
        "cash":              total_cash,
        "total_debt":        total_debt,
        "net_debt":          net_debt,
        "total_assets":      total_assets if _finite(total_assets) else None,
        # Headcount
        "employees":         _safe_float(info.get("fullTimeEmployees")),
    }
    # Strip None values so caller can merge with priority
    return {k: v for k, v in out.items() if v is not None}


# Re-fetch DB data if older than this many days
_CONSENSUS_STALE_DAYS = 7


def _snapshot_is_stale(snapshot: Dict[str, Any]) -> bool:
    # Missing, no eps_ladder, or captured_at older than _CONSENSUS_STALE_DAYS
    if not snapshot or not snapshot.get("eps_ladder"):
        return True
    captured = snapshot.get("captured_at") or ""
    if not captured:
        return True
    try:
        import datetime as _dt
        ts = _dt.datetime.fromisoformat(captured.replace("Z", "+00:00"))
        ts = ts.replace(tzinfo=None)
        age = (_dt.datetime.utcnow() - ts).days
        return age >= _CONSENSUS_STALE_DAYS
    except Exception:
        return True


def _fetch_with_fallback(symbol: str) -> Dict[str, Any]:
    # Universal fetch: FMP first, then Finnhub if FMP has no eps_ladder
    import logging
    _log = logging.getLogger(__name__)

    fmp_ok = False
    snapshot: Dict[str, Any] = {}
    try:
        snapshot = fetch_and_store_fmp_consensus(symbol) or {}
        fmp_ok = bool(snapshot.get("eps_ladder"))
    except Exception as e:
        _log.warning("FMP fetch failed for %s: %s", symbol, e)

    if not fmp_ok and _fetch_finnhub_consensus is not None:
        try:
            finnhub_snap = _fetch_finnhub_consensus(symbol)
            if finnhub_snap and finnhub_snap.get("eps_ladder"):
                snapshot = finnhub_snap
                _log.info("Finnhub fallback succeeded for %s (%d rows)",
                          symbol, len(finnhub_snap["eps_ladder"]))
        except Exception as e2:
            _log.warning("Finnhub fallback failed for %s: %s", symbol, e2)

    return snapshot


def _load_fmp_consensus_snapshot(symbol: str) -> Dict[str, Any]:
    cache_key = f"fmp_consensus_snapshot|{symbol}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        snapshot = get_latest_fmp_consensus(symbol) or {}
    except Exception:
        snapshot = {}

    # Fetch (or re-fetch when stale) via FMP -> Finnhub chain
    if _snapshot_is_stale(snapshot):
        fresh = _fetch_with_fallback(symbol)
        if fresh and fresh.get("eps_ladder"):
            snapshot = fresh
        elif not snapshot:
            snapshot = fresh

    return _cache_set(cache_key, snapshot)


def _build_consensus_eps_ladder(snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    ladder = snapshot.get("eps_ladder") or []
    if not isinstance(ladder, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for item in ladder:
        if not isinstance(item, dict):
            continue
        year = _safe_int(item.get("year"))
        eps = _safe_float(item.get("eps"))
        if year is None or eps is None or eps <= 0:
            continue
        normalized.append(
            {
                "year": year,
                "label": str(item.get("label") or f"{year}"),
                "detail": str(item.get("detail") or ""),
                "kind": str(item.get("kind") or ""),
                "eps": round(float(eps), 4),
                "eps_low":  _safe_float(item.get("eps_low")),
                "eps_high": _safe_float(item.get("eps_high")),
                "analyst_count": _safe_int(item.get("analyst_count")),
                "growth_pct": _safe_float(item.get("growth_pct")),
                "raw_date": item.get("raw_date"),
            }
        )

    normalized.sort(key=lambda row: (row["year"], 0 if row.get("kind") == "actual" else 1, row.get("label") or ""))
    return normalized


def _build_forward_pe_ladder(ladder: List[Dict[str, Any]], current_price: Optional[float]) -> List[Dict[str, Any]]:
    if not ladder:
        return []

    forward_ladder: List[Dict[str, Any]] = []
    for item in ladder:
        if not isinstance(item, dict):
            continue
        eps = _safe_float(item.get("eps"))
        forward_pe = None
        if _finite(current_price) and float(current_price) > 0 and _finite(eps) and float(eps) > 0:
            forward_pe = float(current_price) / float(eps)

        row = dict(item)
        row["forward_pe"] = None if forward_pe is None else round(float(forward_pe), 2)
        forward_ladder.append(row)

    return forward_ladder


def _build_fmp_consensus_context(snapshot: Dict[str, Any], current_price: Optional[float]) -> Dict[str, Any]:
    if not snapshot:
        return {}

    eps_ladder = _build_consensus_eps_ladder(snapshot)
    consensus = {
        "source": str(snapshot.get("source") or "fmp"),
        "captured_at": snapshot.get("captured_at"),
        "source_asof": snapshot.get("source_asof"),
        "eps_estimate_fy1": _safe_float(snapshot.get("eps_estimate_fy1")),
        "eps_estimate_fy2": _safe_float(snapshot.get("eps_estimate_fy2")),
        "target_mean": _safe_float(snapshot.get("target_mean")),
        "target_high": _safe_float(snapshot.get("target_high")),
        "target_low": _safe_float(snapshot.get("target_low")),
        "analyst_count": _safe_int(snapshot.get("analyst_count")),
        "target_analyst_count": _safe_int(snapshot.get("target_analyst_count")),
        "eps_ladder": eps_ladder,
        "forward_pe_ladder": _build_forward_pe_ladder(eps_ladder, current_price),
    }

    target_mean = consensus.get("target_mean")
    if _finite(current_price) and _finite(target_mean) and float(current_price) > 0:
        consensus["target_vs_current_pct"] = round((float(target_mean) - float(current_price)) / float(current_price), 4)
    else:
        consensus["target_vs_current_pct"] = None

    return consensus


def _derive_eps_base(
    current_price: Optional[float],
    trailing_eps: Optional[float],
    forward_eps: Optional[float],
    current_pe: Optional[float],
    sector_pe: float,
) -> Tuple[float, str]:
    if _finite(trailing_eps) and float(trailing_eps) > 0:
        return float(trailing_eps), "trailing_eps"
    if _finite(forward_eps) and float(forward_eps) > 0:
        return float(forward_eps), "forward_eps"
    if _finite(current_price) and _finite(current_pe) and float(current_pe) > 0:
        return max(float(current_price) / float(current_pe), 0.01), "current_pe_proxy"
    if _finite(current_price) and sector_pe > 0:
        return max(float(current_price) / sector_pe, 0.01), "sector_pe_proxy"
    return 0.01, "hard_floor"


def _cagr_from_series(series: List[float], years: int) -> Optional[float]:
    arr = [float(v) for v in series if _finite(v) and float(v) > 0]
    if len(arr) < 2:
        return None
    first = arr[-1]
    last = arr[0]
    if first <= 0 or last <= 0:
        return None
    span = max(1, min(years, len(arr) - 1))
    try:
        return (last / first) ** (1 / span) - 1
    except Exception:
        return None


def _pe_medians_from_prices(price_series: List[Dict[str, Any]], eps: float) -> Tuple[Optional[float], Optional[float]]:
    if eps <= 0:
        return None, None
    pe_values = [point["close"] / eps for point in price_series if _finite(point.get("close")) and float(point["close"]) > 0]
    if not pe_values:
        return None, None
    pe_3y = _median(pe_values[:756]) if len(pe_values) >= 1 else None
    pe_5y = _median(pe_values[:1260]) if len(pe_values) >= 1 else None
    return pe_3y, pe_5y


def _derive_eps_stability(data: Dict[str, Any]) -> bool:
    eps_history = [v for v in data.get("eps_history") or [] if _finite(v) and float(v) > 0]
    if len(eps_history) >= 3:
        try:
            mean = statistics.mean(eps_history)
            if mean <= 0:
                return False
            spread = statistics.pstdev(eps_history) / mean if len(eps_history) > 1 else 0.0
            return spread < 0.6
        except Exception:
            return False

    eps_now = data.get("eps")
    eps_forward = data.get("eps_forward")
    if _finite(eps_now) and _finite(eps_forward) and float(eps_now) > 0:
        return abs(float(eps_forward) - float(eps_now)) / abs(float(eps_now)) < 0.6
    return _finite(eps_now) and float(eps_now) > 0


def _derive_margin_stable(data: Dict[str, Any]) -> bool:
    gross = data.get("gross_margin")
    operating = data.get("operating_margin")
    net = data.get("net_margin")
    if _finite(net) and float(net) > 0.03:
        return True
    if _finite(operating) and float(operating) > 0.08:
        return True
    if _finite(gross) and float(gross) > 0.2:
        return True
    return False


def _derive_debt_low(data: Dict[str, Any]) -> bool:
    debt = data.get("debt_to_equity")
    current_ratio = data.get("current_ratio")
    if _finite(debt) and float(debt) <= 2.0:
        return True
    if _finite(current_ratio) and float(current_ratio) >= 1.2:
        return True
    return False


def _derive_growth_consistent(data: Dict[str, Any]) -> bool:
    g3 = data.get("eps_cagr_3y")
    g5 = data.get("eps_cagr_5y")
    fwd = data.get("eps_growth_forward")
    values = [v for v in [g3, g5, fwd] if _finite(v)]
    if len(values) < 2:
        return False
    try:
        if max(values) < 0 and min(values) < 0:
            return True
        return (max(values) - min(values)) < 0.18
    except Exception:
        return False


def compute_quality_penalty(data: Dict[str, Any]) -> float:
    penalty = 0.0
    if data.get("eps_source") == "proxy":
        penalty += 0.02
    if not data.get("eps_stability"):
        penalty += 0.015
    if not data.get("margin_stable"):
        penalty += 0.015
    if not data.get("debt_low"):
        penalty += 0.015
    if not data.get("growth_consistent"):
        penalty += 0.015

    revenue_growth = data.get("revenue_growth")
    net_margin = data.get("net_margin")
    if _finite(revenue_growth) and float(revenue_growth) < 0:
        penalty += 0.01
    if _finite(net_margin) and float(net_margin) < 0:
        penalty += 0.01

    return min(penalty, 0.08)


def compute_growth(data: Dict[str, Any]) -> Dict[str, Any]:
    hist_5y = data.get("eps_cagr_5y")
    hist_3y = data.get("eps_cagr_3y")
    fwd = data.get("eps_growth_forward")
    revenue_growth = data.get("revenue_growth")
    earnings_growth = data.get("earnings_growth")

    base = _weighted_avg(
        [
            (hist_5y, 0.3),
            (hist_3y, 0.3),
            (fwd, 0.4),
        ]
    )
    if base is None:
        base = _weighted_avg(
            [
                (revenue_growth, 0.5),
                (earnings_growth, 0.3),
                (fwd, 0.2),
            ]
        )
    if base is None:
        base = 0.08

    quality_penalty = compute_quality_penalty(data)
    bias = _mode_bias(data.get("analysis_mode", "auto"))

    base_adj = base - quality_penalty + bias["growth"]
    bear = max(base_adj - 0.08, -0.9)
    bull = base_adj + 0.05

    return {
        "bear": round(max(bear, 0.0), 4),
        "base": round(base_adj, 4),
        "bull": round(bull, 4),
        "hist_5y": None if hist_5y is None else round(float(hist_5y), 4),
        "hist_3y": None if hist_3y is None else round(float(hist_3y), 4),
        "forward": None if fwd is None else round(float(fwd), 4),
        "base_raw": round(base, 4),
        "quality_penalty": round(quality_penalty, 4),
    }


def compute_multiple(data: Dict[str, Any]) -> Dict[str, Any]:
    pe_5y = data.get("pe_median_5y")
    pe_3y = data.get("pe_median_3y")
    sector = data.get("sector_pe")
    peers = data.get("peer_pe")

    base = _weighted_avg(
        [
            (pe_5y, 0.4),
            (pe_3y, 0.25),
            (sector, 0.2),
            (peers, 0.15),
        ]
    )
    if base is None:
        base = _weighted_avg(
            [
                (data.get("current_pe"), 0.6),
                (sector, 0.4),
            ]
        )
    if base is None:
        base = sector or 20.0

    base = _clamp(float(base), 5.0, 80.0)
    bias = _mode_bias(data.get("analysis_mode", "auto"))
    base_adj = base * bias["multiple"]

    return {
        "bear": round(base_adj * 0.8, 4),
        "base": round(base_adj, 4),
        "bull": round(base_adj * 1.2, 4),
        "pe_5y": None if pe_5y is None else round(float(pe_5y), 4),
        "pe_3y": None if pe_3y is None else round(float(pe_3y), 4),
        "sector": None if sector is None else round(float(sector), 4),
        "peers": None if peers is None else round(float(peers), 4),
        "base_raw": round(base, 4),
    }


def compute_scenarios(data: Dict[str, Any], growth: Dict[str, Any], multiple: Dict[str, Any]) -> Dict[str, float]:
    eps_now = data.get("eps")
    if not _finite(eps_now) or float(eps_now) <= 0:
        eps_now = 0.01

    def project_eps(growth_rate: float) -> float:
        growth_rate = _clamp(float(growth_rate), -0.95, 2.0)
        return float(eps_now) * ((1 + growth_rate) ** 3)

    bear = project_eps(float(growth.get("bear", 0.0))) * float(multiple.get("bear", 1.0))
    base = project_eps(float(growth.get("base", 0.0))) * float(multiple.get("base", 1.0))
    bull = project_eps(float(growth.get("bull", 0.0))) * float(multiple.get("bull", 1.0))

    return {
        "bear": round(max(bear, 0.0), 2),
        "base": round(max(base, 0.0), 2),
        "bull": round(max(bull, 0.0), 2),
    }


def compute_confidence(data: Dict[str, Any], growth: Dict[str, Any], multiple: Dict[str, Any]) -> str:
    score = 0
    if data.get("eps_stability"):
        score += 1
    if data.get("margin_stable"):
        score += 1
    if data.get("debt_low"):
        score += 1
    if data.get("growth_consistent"):
        score += 1

    if score >= 3:
        return "high"
    if score == 2:
        return "medium"
    return "low"


def _first_finite(*values: Any) -> Optional[float]:
    for value in values:
        candidate = _safe_float(value)
        if _finite(candidate):
            return candidate
    return None


def _format_relative_move(current_price: Optional[float], target_price: Optional[float]) -> Optional[str]:
    if not _finite(current_price) or not _finite(target_price):
        return None
    current = float(current_price)
    target = float(target_price)
    if current <= 0:
        return None
    upside = (target - current) / current
    direction = "upside" if upside >= 0 else "downside"
    return f"~{abs(upside) * 100:.0f}% {direction}"


def _select_valuation_state(
    current_pe: Optional[float],
    pe_3y: Optional[float],
    pe_5y: Optional[float],
    sector_pe: Optional[float],
) -> StockValuationState:
    if not _finite(current_pe):
        return StockValuationState(
            label="fair",
            detail="trading near normalized range",
            reference="insufficient history",
        )

    reference: Optional[str] = None
    baseline = None
    if _finite(pe_3y) and float(pe_3y) > 0:
        baseline = float(pe_3y)
        reference = "3Y median"
    elif _finite(pe_5y) and float(pe_5y) > 0:
        baseline = float(pe_5y)
        reference = "5Y median"
    elif _finite(sector_pe) and float(sector_pe) > 0:
        baseline = float(sector_pe)
        reference = "sector baseline"

    if baseline is None or baseline <= 0:
        return StockValuationState(
            label="fair",
            detail="trading near normalized range",
            reference="insufficient history",
        )

    ratio = float(current_pe) / baseline
    if ratio > 1.10:
        if reference == "sector baseline":
            detail = "trading above sector baseline"
        else:
            detail = "trading above historical median"
        label = "premium"
    elif ratio < 0.90:
        if reference == "sector baseline":
            detail = "trading below sector baseline"
        else:
            detail = "trading below historical baseline"
        label = "discount"
    else:
        if reference == "sector baseline":
            detail = "trading near sector baseline"
        else:
            detail = "trading near normalized range"
        label = "fair"

    return StockValuationState(label=label, detail=detail, reference=reference)


def _build_confidence_note(confidence: str, forward_eps: Optional[float], sector_pe: Optional[float], db_rows: int) -> str:
    confidence = (confidence or "low").strip().lower()
    if confidence == "high":
        return "Confidence is high because the engine has stable earnings, margin, debt, and growth coverage."
    if confidence == "medium":
        if not _finite(forward_eps):
            return "Confidence is medium because core valuation metrics are available, but some forward fields are incomplete."
        if not _finite(sector_pe):
            return "Confidence is medium because historical valuation inputs are available, but sector coverage is limited."
        return "Confidence is medium because the core valuation metrics are available, but the estimate still leans on normalized history."
    if not _finite(forward_eps):
        return "Confidence is low because key forward fields are missing, so the estimate relies more on proxy inputs."
    if db_rows < 252:
        return "Confidence is low because price history is short, which makes the long-range estimate more approximate than usual."
    return "Confidence is low because key quality inputs are incomplete, so the estimate relies more on proxy inputs."


def _build_risk_note(confidence: str, forward_eps: Optional[float], sector_pe: Optional[float], db_rows: int) -> str:
    confidence = (confidence or "low").strip().lower()
    if confidence == "low":
        if not _finite(forward_eps):
            return "Forward EPS coverage is limited, which reduces confidence in longer-range upside estimates."
        if not _finite(sector_pe):
            return "Sector comparison is limited, so the valuation anchor leans more on company history."
        return "Core valuation inputs are incomplete, so the engine leans more on proxy inputs."
    if not _finite(forward_eps):
        return "Forward EPS coverage is limited, which reduces confidence in longer-range upside estimates."
    if not _finite(sector_pe):
        return "Sector comparison is limited, so the valuation anchor leans more on company history."
    if db_rows < 252:
        return "Price history is shorter than a full year, so long-range estimates lean more on proxy inputs."
    return "Core valuation inputs are available, but the engine still relies on normalized historical ranges."


def build_stock_narrative(analysis: Dict[str, Any]) -> Dict[str, Any]:
    ticker = analysis.get("ticker") or "This ticker"
    name = analysis.get("name") or ticker
    current_price = _first_finite(analysis.get("current_price"), analysis.get("price"))
    current_pe = _first_finite(analysis.get("current_pe"))
    pe_3y = _first_finite(analysis.get("pe_3y_median"), analysis.get("pe_median_3y"))
    pe_5y = _first_finite(analysis.get("pe_5y_median"), analysis.get("pe_median_5y"))
    sector_pe = _first_finite(analysis.get("sector_pe_median"), analysis.get("sector_pe"))
    scenario = analysis.get("scenario") or {}
    confidence = str(analysis.get("confidence") or "low").strip().lower()
    db_rows = int(analysis.get("db_rows") or 0)
    forward_eps = _first_finite(analysis.get("eps_forward"), (analysis.get("valuation") or {}).get("eps_forward"))
    valuation_state = _select_valuation_state(current_pe, pe_3y, pe_5y, sector_pe)

    base_target = _first_finite(scenario.get("base"))
    base_move = _format_relative_move(current_price, base_target)

    has_hist_3y = _finite(pe_3y)
    has_hist_5y = _finite(pe_5y)
    has_sector = _finite(sector_pe)
    history_label = "its normalized valuation history"
    if has_hist_3y and has_hist_5y:
        history_label = "its 3Y and 5Y PE history"
    elif has_hist_3y:
        history_label = "its 3Y PE history"
    elif has_hist_5y:
        history_label = "its 5Y PE history"
    elif has_sector:
        history_label = "its sector baseline"

    if valuation_state.label == "premium":
        headline = f"{name} is trading above its historical valuation baseline, suggesting limited upside in the base scenario."
        summary = (
            f"The stock currently trades above {history_label}. "
            f"The base case implies {base_move or 'an estimated move that depends on available proxy inputs'} from current levels, "
            f"while the bull case requires durable earnings growth and continued premium multiple support."
        )
        bull_case = "The bull case assumes durable earnings growth and continued premium multiple support."
        bear_case = "The bear case assumes multiple compression toward a more conservative valuation range."
    elif valuation_state.label == "discount":
        headline = f"{name} is trading below its historical valuation baseline, which can support upside if earnings remain resilient."
        summary = (
            f"The stock currently trades below {history_label}. "
            f"The base case implies {base_move or 'an estimated move that depends on available proxy inputs'} from current levels, "
            f"while the bull case depends on earnings resilience and a recovery toward the normalized range."
        )
        bull_case = "The bull case assumes earnings resilience can pull the valuation back toward its normalized range."
        bear_case = "The bear case assumes the discount reflects persistent pressure on growth or margins."
    else:
        headline = f"{name} is trading near its normalized valuation range, with balanced risk-reward in the base case."
        summary = (
            f"The stock currently trades near {history_label}. "
            f"The base case implies {base_move or 'an estimated move that depends on available proxy inputs'} from current levels, "
            f"while the bull case depends on stronger earnings momentum and the bear case centers on multiple compression."
        )
        bull_case = "The bull case assumes stronger earnings momentum and a stable valuation band."
        bear_case = "The bear case assumes valuation slips below the normalized range if growth cools."

    consensus_note = build_consensus_note(analysis)
    narrative = StockNarrative(
        headline=headline,
        summary=summary,
        bull_case=bull_case,
        bear_case=bear_case,
        risk_note=_build_risk_note(confidence, forward_eps, sector_pe, db_rows),
        confidence_note=_build_confidence_note(confidence, forward_eps, sector_pe, db_rows),
        consensus_note=consensus_note,
    )

    today_summary = (
        f"Auto mode is live for {ticker}. The stock is {valuation_state.detail} with {confidence} confidence. "
        f"The base case implies {base_move or 'an estimated move that leans on proxy inputs'} over 3 years."
    )

    return {
        "valuation_state": valuation_state.to_dict(),
        "narrative": narrative.to_dict(),
        "summary": narrative.summary,
        "today_summary": today_summary,
    }


def _build_summary(data: Dict[str, Any], scenario: Dict[str, float], confidence: str) -> str:
    narrative = build_stock_narrative({**data, "scenario": scenario, "confidence": confidence})
    return str(narrative.get("summary") or "")


def _build_today_summary(data: Dict[str, Any], scenario: Dict[str, float], confidence: str) -> str:
    narrative = build_stock_narrative({**data, "scenario": scenario, "confidence": confidence})
    return str(narrative.get("today_summary") or "")


def _build_warning_list(data: Dict[str, Any], source: str) -> List[str]:
    warnings: List[str] = []
    if source == "derived":
        warnings.append("Fundamentals were not fully available, so EPS was proxied from price and sector baseline.")
    if not data.get("eps_stability"):
        warnings.append("EPS stability is weak or unavailable.")
    if not data.get("margin_stable"):
        warnings.append("Margin trend is not confirmed.")
    if not data.get("debt_low"):
        warnings.append("Debt / leverage screen is not clean.")
    if not data.get("growth_consistent"):
        warnings.append("Growth inputs are inconsistent across available sources.")
    if data.get("db_rows", 0) < 252:
        warnings.append("Price history is shorter than a full year, so long-window multiples are approximated.")
    return warnings



def _load_finnhub_stats(symbol: str, fh_key: str) -> Dict[str, Any]:
    """Build stats dict from Finnhub metric + XBRL when FMP is rate-limited."""
    out: Dict[str, Any] = {k: None for k in [
        "ps_ratio","pb_ratio","peg_ratio","ev_ebitda","ev_sales","ev_fcf","ev_opcf",
        "roe","roa","roic","roic_km","asset_turnover","ebitda_margin",
        "enterprise_value","fcf_per_share","revenue_per_share",
        "revenue","gross_profit","operating_income","net_income","ebitda",
        "eps_reported","income_period","cash","total_debt","net_debt",
        "total_assets","employees",
    ]}
    try:
        # --- TTM Metrics ---
        m_res, _ = _fetch_json(
            f"https://finnhub.io/api/v1/stock/metric?symbol={symbol}&metric=all&token={fh_key}"
        )
        m = m_res.get("metric") if isinstance(m_res, dict) else {}
        if m:
            def _pct(k): return (_safe_float(m.get(k)) or 0) / 100 or None
            def _raw(k): return _safe_float(m.get(k))
            out["ps_ratio"]          = _raw("psTTM")
            out["pb_ratio"]          = _raw("pbAnnual")
            out["roe"]               = _pct("roeTTM")
            out["roa"]               = _pct("roaTTM")
            out["roic"]              = _pct("roicTTM")
            out["roic_km"]           = _pct("roicTTM")
            out["asset_turnover"]    = _raw("assetTurnoverTTM")
            out["ebitda_margin"]     = _pct("ebitdaMarginTTM")
            out["revenue_per_share"] = _raw("revenuePerShareTTM")
            mktcap_k = _safe_float(m.get("marketCapitalization"))  # Finnhub: thousands USD
            out["enterprise_value"]  = (_safe_float(m.get("enterpriseValue")) or 0) * 1000 or None
    except Exception:
        pass

    try:
        # --- XBRL Annual Income + Balance ---
        xbrl_res, _ = _fetch_json(
            f"https://finnhub.io/api/v1/stock/financials-reported?symbol={symbol}&freq=annual&token={fh_key}"
        )
        rows = xbrl_res.get("data") if isinstance(xbrl_res, dict) else []
        annual = [r for r in (rows or []) if isinstance(r, dict) and r.get("quarter") == 0]
        if annual:
            annual.sort(key=lambda r: r.get("year", 0), reverse=True)
            r0 = annual[0]
            ic = {item["concept"]: _safe_float(item.get("value")) for item in (r0.get("report", {}).get("ic") or []) if isinstance(item, dict)}
            bs = {item["concept"]: _safe_float(item.get("value")) for item in (r0.get("report", {}).get("bs") or []) if isinstance(item, dict)}
            def _ic(*keys):
                for k in keys:
                    v = ic.get(k)
                    if v is not None: return v
                return None
            def _bs(*keys):
                for k in keys:
                    v = bs.get(k)
                    if v is not None: return v
                return None
            out["revenue"]          = _ic("us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap_Revenues", "us-gaap_SalesRevenueNet")
            out["gross_profit"]     = _ic("us-gaap_GrossProfit")
            out["operating_income"] = _ic("us-gaap_OperatingIncomeLoss")
            out["net_income"]       = _ic("us-gaap_NetIncomeLoss")
            out["ebitda"]           = _ic("us-gaap_EarningsBeforeInterestTaxesDepreciationAndAmortization")
            out["income_period"]    = str(r0.get("year", ""))
            out["cash"]             = _bs("us-gaap_CashCashEquivalentsAndShortTermInvestments", "us-gaap_CashAndCashEquivalentsAtCarryingValue")
            out["total_assets"]     = _bs("us-gaap_Assets")
            out["total_debt"]       = _bs("us-gaap_LongTermDebtNoncurrent", "us-gaap_LongTermDebt")
            if out["total_debt"] is not None and out["cash"] is not None:
                out["net_debt"] = out["total_debt"] - out["cash"]
            out["total_assets"]     = _bs("us-gaap_Assets")
            eq = _bs("us-gaap_StockholdersEquity", "us-gaap_StockholdersEquityAttributableToParent")
            if out["revenue"] and out["gross_profit"]:
                shares_approx = None
                if out["revenue"] and out.get("revenue_per_share") and float(out["revenue_per_share"]) > 0:
                    shares_approx = out["revenue"] / float(out["revenue_per_share"])
                if shares_approx and shares_approx > 0:
                    out["eps_reported"] = out["net_income"] / shares_approx if out.get("net_income") else None
    except Exception:
        pass

    return {k: v for k, v in out.items() if v is not None}

def load_stock_data(symbol: str) -> Dict[str, Any]:
    symbol = _normalize_ticker(symbol)
    db = _load_db_snapshot(symbol)
    price_series = db.get("price_series") or []

    sector = _normalize_sector(db.get("raw_sector"), db.get("industry"), symbol)
    sector_pe = _sector_pe(sector)

    fmp_key = (os.getenv("FMP_API_KEY") or os.getenv("NEXT_PUBLIC_FMP_API_KEY") or "").strip()
    fmp_metrics: Dict[str, Any] = {}
    fmp_stats: Dict[str, Any] = {}
    yfinance_metrics: Dict[str, Any] = {}
    yfinance_raw: Dict[str, Any] = {}
    source = "derived"

    # ── 1. Check persistent DB cache first ────────────────────────────────────
    # Avoids redundant API calls on server restart or within the 24h TTL window.
    db_cached = _load_fundamentals_db_cache(symbol)
    if db_cached:
        cached_metrics = db_cached.get("metrics") or {}
        cached_stats   = db_cached.get("stats")   or {}
        cached_source  = db_cached.get("source")  or "cache"
        # Only use cache if it has meaningful data
        if cached_metrics or cached_stats:
            fmp_metrics    = cached_metrics
            fmp_stats      = cached_stats
            source         = cached_source
            # Re-extract yfinance_metrics from cached_metrics for compatibility
            yfinance_metrics = cached_metrics if "current_price" in cached_metrics else {}

    # ── 2. Try FMP (live) — always attempt, may overwrite cache ───────────────
    if fmp_key:
        try:
            bundle = _load_fmp_bundle(symbol, fmp_key)
            live_metrics = _extract_fmp_metrics(bundle)
            live_stats   = _extract_stats_fields(bundle)
            # Only use FMP result if it returned real data (not 429 empty)
            fmp_live_usable = any(
                live_metrics.get(k) is not None
                for k in ("current_price", "trailing_eps", "forward_eps", "current_pe")
            )
            if fmp_live_usable:
                fmp_metrics = live_metrics
                fmp_stats   = live_stats
                source      = "fmp"
                # Save to DB cache — FMP data is fresh and authoritative
                _save_fundamentals_db_cache(symbol, fmp_metrics, fmp_stats, "fmp")
        except Exception:
            pass   # keep whatever we have from DB cache

    fmp_usable = any(
        fmp_metrics.get(key) is not None
        for key in ("current_price", "trailing_eps", "forward_eps", "current_pe")
    )

    # ── 3. yfinance: run when FMP/cache is missing margins or stats ───────────
    fmp_stats_has_data = any(v is not None for v in fmp_stats.values())
    fmp_has_margins = any(
        fmp_metrics.get(k) is not None
        for k in ("gross_margin", "operating_margin", "net_margin")
    )
    need_yfinance = yf is not None and (
        not fmp_usable or not fmp_stats_has_data or not fmp_has_margins
    )

    if need_yfinance:
        try:
            pool = ThreadPoolExecutor(max_workers=1)
            future = pool.submit(_load_yfinance_bundle, symbol)
            try:
                yfinance_raw     = future.result(timeout=8.0) or {}
                yfinance_metrics = _extract_yfinance_metrics(yfinance_raw)
                source = "yfinance" if (yfinance_metrics and not fmp_usable) else source
            finally:
                pool.shutdown(wait=False, cancel_futures=True)
        except Exception:
            yfinance_metrics = {}
            yfinance_raw = {}

    # ── 4. yfinance stats + save to DB cache ─────────────────────────────────
    if yfinance_raw:
        yf_stats = _extract_yfinance_stats(yfinance_raw)
        if yf_stats:
            if not fmp_stats_has_data:
                fmp_stats = yf_stats
            else:
                for k, v in yf_stats.items():
                    if fmp_stats.get(k) is None:
                        fmp_stats[k] = v
        # Persist to DB so next request skips the yfinance API call
        if yfinance_metrics or yf_stats:
            _save_fundamentals_db_cache(
                symbol,
                yfinance_metrics,
                fmp_stats,
                source,
            )

    # ── 5. Finnhub fallback (only if all else fails) ──────────────────────────
    fh_key = (os.getenv("FINNHUB_API_KEY") or "").strip().strip("'").strip()
    if fh_key and not any(v is not None for v in fmp_stats.values()):
        try:
            finnhub_stats = _load_finnhub_stats(symbol, fh_key)
            if finnhub_stats:
                fmp_stats = finnhub_stats
                _save_fundamentals_db_cache(symbol, fmp_metrics, fmp_stats, "finnhub")
        except Exception:
            pass

    # Always merge yfinance as a base layer so margins/growth are never null when
    # FMP is rate-limited. fmp_metrics values take priority (overwrite yfinance).
    if yfinance_metrics and fmp_metrics:
        source = "fmp+yfinance"
        # Build merged dict: yfinance as base, fmp overwrites only non-None values
        fundamentals = dict(yfinance_metrics)
        for k, v in fmp_metrics.items():
            if v is not None:
                fundamentals[k] = v
    elif fmp_metrics:
        fundamentals = dict(fmp_metrics)
    elif yfinance_metrics:
        fundamentals = dict(yfinance_metrics)
    else:
        fundamentals = {}

    price = (
        fundamentals.get("current_price")
        or db.get("price")
        or db.get("prev_close")
        or None
    )
    current_price = _safe_float(price)
    consensus_snapshot = _load_fmp_consensus_snapshot(symbol)
    consensus = _build_fmp_consensus_context(consensus_snapshot, current_price)

    name = fundamentals.get("name") or db.get("name") or symbol
    industry = fundamentals.get("industry") or db.get("industry") or ""
    exchange = fundamentals.get("exchange") or db.get("exchange") or ""
    market_cap = fundamentals.get("market_cap") or db.get("market_cap")

    trailing_eps = fundamentals.get("trailing_eps")
    forward_eps = fundamentals.get("forward_eps")
    current_pe = fundamentals.get("current_pe")

    eps_now, eps_source = _derive_eps_base(current_price, trailing_eps, forward_eps, current_pe, sector_pe)
    if not _finite(current_pe) or float(current_pe) <= 0:
        current_pe = (float(current_price) / eps_now) if _finite(current_price) and eps_now > 0 else sector_pe

    pe_3y, pe_5y = _pe_medians_from_prices(price_series, eps_now)
    if pe_3y is None:
        pe_3y = current_pe
    if pe_5y is None:
        pe_5y = current_pe

    eps_history = [v for v in (fundamentals.get("eps_history") or []) if _finite(v) and float(v) > 0]
    pe_history = [v for v in (fundamentals.get("pe_history") or []) if _finite(v) and float(v) > 0]

    if eps_history:
        eps_cagr_5y = _cagr_from_series(eps_history[:5], 5)
        eps_cagr_3y = _cagr_from_series(eps_history[:3], 3)
    else:
        earnings_growth = _normalize_growth(fundamentals.get("earnings_growth"))
        revenue_growth = _normalize_growth(fundamentals.get("revenue_growth"))
        proxy_growth = _weighted_avg([(earnings_growth, 0.6), (revenue_growth, 0.4)])
        if proxy_growth is None:
            proxy_growth = 0.08
        eps_cagr_5y = proxy_growth
        eps_cagr_3y = proxy_growth * 0.95 if _finite(proxy_growth) else proxy_growth

    if fundamentals.get("forward_eps") and eps_now > 0:
        eps_growth_forward = (float(fundamentals["forward_eps"]) - eps_now) / abs(eps_now)
    else:
        eps_growth_forward = _normalize_growth(fundamentals.get("earnings_growth"))
    if eps_growth_forward is None:
        eps_growth_forward = _normalize_growth(fundamentals.get("revenue_growth"))
    if eps_growth_forward is None:
        eps_growth_forward = 0.08

    gross_margin = _normalize_growth(fundamentals.get("gross_margin"))
    operating_margin = _normalize_growth(fundamentals.get("operating_margin"))
    net_margin = _normalize_growth(fundamentals.get("net_margin"))
    debt_to_equity = _safe_float(fundamentals.get("debt_to_equity"))
    current_ratio = _safe_float(fundamentals.get("current_ratio"))
    revenue_growth = _normalize_growth(fundamentals.get("revenue_growth"))
    earnings_growth = _normalize_growth(fundamentals.get("earnings_growth"))

    if not _finite(current_pe) or float(current_pe) <= 0:
        current_pe = sector_pe

    if pe_history:
        pe_median_3y = _median(pe_history[:3]) or pe_3y
        pe_median_5y = _median(pe_history[:5]) or pe_5y
    else:
        pe_median_3y = pe_3y
        pe_median_5y = pe_5y

    data: Dict[str, Any] = {
        "ticker": symbol,
        "price": current_price,
        "name": name,
        "sector": sector,
        "raw_sector": db.get("raw_sector"),
        "industry": industry,
        "exchange": exchange,
        "market_cap": market_cap,
        "current_pe": current_pe,
        "sector_pe": sector_pe,
        "pe_median_3y": pe_median_3y,
        "pe_median_5y": pe_median_5y,
        "eps": eps_now,
        "eps_forward": fundamentals.get("forward_eps"),
        "eps_growth_forward": eps_growth_forward,
        "eps_cagr_3y": eps_cagr_3y,
        "eps_cagr_5y": eps_cagr_5y,
        "price_series": price_series,
        "gross_margin": gross_margin,
        "operating_margin": operating_margin,
        "net_margin": net_margin,
        "debt_to_equity": debt_to_equity,
        "current_ratio": current_ratio,
        "revenue_growth": revenue_growth,
        "earnings_growth": earnings_growth,
        "eps_history": eps_history,
        "pe_history": pe_history,
        "current_change_pct": db.get("current_change_pct"),
        "db_rows": db.get("db_rows", 0),
        "price_high_1y": db.get("price_high_1y"),
        "price_low_1y": db.get("price_low_1y"),
        "price_high_3y": db.get("price_high_3y"),
        "price_low_3y": db.get("price_low_3y"),
        "price_high_5y": db.get("price_high_5y"),
        "price_low_5y": db.get("price_low_5y"),
        "sma20": db.get("sma20"),
        "sma50": db.get("sma50"),
        "sma200": db.get("sma200"),
        "rsi14": db.get("rsi14"),
        "vol20": db.get("vol20"),
        "eps_source": eps_source,
        "data_source": source,
        "analysis_mode": "auto",
        "consensus": consensus,
        "fmp_stats": fmp_stats,
    }

    data["eps_stability"] = _derive_eps_stability(data)
    data["margin_stable"] = _derive_margin_stable(data)
    data["debt_low"] = _derive_debt_low(data)
    data["growth_consistent"] = _derive_growth_consistent(data)
    data["warnings"] = _build_warning_list(data, source if source else "derived")
    data["historical_multiple_source"] = "ratios" if pe_history else "price-history"
    return data


def run_stock_analysis(ticker: str, mode: str = "auto") -> dict:
    symbol = _normalize_ticker(ticker)
    if not symbol:
        raise ValueError("ticker is required")

    mode = (mode or "auto").strip().lower()
    if mode not in {"auto", "conservative", "aggressive"}:
        mode = "auto"

    cache_key = f"{symbol}|{mode}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    data = load_stock_data(symbol)
    data["analysis_mode"] = mode

    growth = compute_growth(data)
    multiple = compute_multiple(data)
    scenario = compute_scenarios(data, growth, multiple)
    confidence = compute_confidence(data, growth, multiple)
    narrative_block = build_stock_narrative({**data, "scenario": scenario, "confidence": confidence})
    valuation_state = narrative_block.get("valuation_state") or {}
    narrative = narrative_block.get("narrative") or {}
    summary = str(narrative_block.get("summary") or narrative.get("summary") or "")
    today_summary = str(narrative_block.get("today_summary") or "")

    current_price = data.get("price")
    current_pe = data.get("current_pe")
    current_change_pct = data.get("current_change_pct")

    historical_pe = {
        "pe_3y": None if data.get("pe_median_3y") is None else round(float(data["pe_median_3y"]), 4),
        "pe_5y": None if data.get("pe_median_5y") is None else round(float(data["pe_median_5y"]), 4),
    }

    # Compute SMA120 from price series (not in indicators table)
    _ps = data.get("price_series") or []
    _closes120 = [float(p["close"]) for p in _ps[:120] if _finite(p.get("close"))]
    _sma120 = round(sum(_closes120) / len(_closes120), 2) if len(_closes120) >= 100 else None

    # Compute price performance periods (price_series is newest-first)
    import datetime as _dt
    _price_now = _safe_float(_ps[0].get("close")) if _ps else None

    def _perf_n(n: int):
        if not _ps or not _finite(_price_now) or _price_now <= 0:
            return None
        idx = min(n, len(_ps) - 1)
        p_past = _safe_float(_ps[idx].get("close"))
        if not _finite(p_past) or p_past <= 0:
            return None
        return round((float(_price_now) - float(p_past)) / float(p_past), 4)

    _perf_1w = _perf_n(5)
    _perf_1m = _perf_n(21)
    _perf_3m = _perf_n(63)
    _perf_6m = _perf_n(126)
    _perf_1y = _perf_n(252)

    # YTD: price at last trading day of previous year
    _ytd_pct = None
    try:
        _ytd_start = str(_dt.date(_dt.date.today().year, 1, 1))
        _ytd_base = None
        for _p in _ps:
            _d = str(_p.get("date") or "")
            if _d and _d < _ytd_start:
                _ytd_base = _safe_float(_p.get("close"))
                break
        if _finite(_ytd_base) and _ytd_base > 0 and _finite(_price_now) and _price_now > 0:
            _ytd_pct = round((float(_price_now) - float(_ytd_base)) / float(_ytd_base), 4)
    except Exception:
        pass

    valuation = {
        "eps_ttm": round(float(data["eps"]), 4) if _finite(data.get("eps")) else None,
        "eps_forward": round(float(data["eps_forward"]), 4) if _finite(data.get("eps_forward")) else None,
        "revenue_growth": round(float(data["revenue_growth"]), 4) if _finite(data.get("revenue_growth")) else None,
        "gross_margin": round(float(data["gross_margin"]), 4) if _finite(data.get("gross_margin")) else None,
        "operating_margin": round(float(data["operating_margin"]), 4) if _finite(data.get("operating_margin")) else None,
        "net_margin": round(float(data["net_margin"]), 4) if _finite(data.get("net_margin")) else None,
        "debt_to_equity": round(float(data["debt_to_equity"]), 4) if _finite(data.get("debt_to_equity")) else None,
        "current_ratio": round(float(data["current_ratio"]), 4) if _finite(data.get("current_ratio")) else None,
        "market_cap": round(float(data["market_cap"]), 2) if _finite(data.get("market_cap")) else None,
        "price_high_1y": round(float(data["price_high_1y"]), 2) if _finite(data.get("price_high_1y")) else None,
        "price_low_1y": round(float(data["price_low_1y"]), 2) if _finite(data.get("price_low_1y")) else None,
        "price_high_3y": round(float(data["price_high_3y"]), 2) if _finite(data.get("price_high_3y")) else None,
        "price_low_3y": round(float(data["price_low_3y"]), 2) if _finite(data.get("price_low_3y")) else None,
        "price_high_5y": round(float(data["price_high_5y"]), 2) if _finite(data.get("price_high_5y")) else None,
        "price_low_5y": round(float(data["price_low_5y"]), 2) if _finite(data.get("price_low_5y")) else None,
        "sma20": round(float(data["sma20"]), 2) if _finite(data.get("sma20")) else None,
        "sma50": round(float(data["sma50"]), 2) if _finite(data.get("sma50")) else None,
        "sma120": _sma120,
        "sma200": round(float(data["sma200"]), 2) if _finite(data.get("sma200")) else None,
        "rsi14": round(float(data["rsi14"]), 1) if _finite(data.get("rsi14")) else None,
        "vol20": round(float(data["vol20"]), 4) if _finite(data.get("vol20")) else None,
        "perf_1w": _perf_1w,
        "perf_1m": _perf_1m,
        "perf_3m": _perf_3m,
        "perf_6m": _perf_6m,
        "perf_1y": _perf_1y,
        "perf_ytd": _ytd_pct,
        "source": data.get("data_source"),
        "historical_multiple_source": data.get("historical_multiple_source"),
    }
    consensus = data.get("consensus") or {}
    price_history = _build_price_history(data.get("price_series") or [])

    output = StockAnalysisOutput(
        ticker=symbol,
        current_price=round(float(current_price), 2) if _finite(current_price) else None,
        current_change_pct=round(float(current_change_pct), 4) if _finite(current_change_pct) else None,
        name=str(data.get("name") or symbol),
        sector=str(data.get("sector") or "Unknown"),
        industry=str(data.get("industry") or ""),
        exchange=str(data.get("exchange") or ""),
        current_pe=round(float(current_pe), 4) if _finite(current_pe) else None,
        historical_pe=historical_pe,
        sector_pe=round(float(data["sector_pe"]), 4) if _finite(data.get("sector_pe")) else None,
        growth=growth,
        multiple=multiple,
        scenario=scenario,
        confidence=confidence,
        today_summary=today_summary,
        summary=summary,
        price_history=price_history,
        valuation_state=valuation_state,
        narrative=narrative,
        consensus=consensus,
        analysis_mode=mode,
        valuation=valuation,
        stats=data.get("fmp_stats") or {},
        warnings=data.get("warnings") or [],
        meta={
            "data_source": data.get("data_source"),
            "eps_source": data.get("eps_source"),
            "mode": mode,
            "quality_penalty": growth.get("quality_penalty"),
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "db_rows": data.get("db_rows", 0),
            "consensus_source": consensus.get("source") if isinstance(consensus, dict) else None,
        },
    ).to_dict()

    _cache_set(cache_key, output)
    return output
