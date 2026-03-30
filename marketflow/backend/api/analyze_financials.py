from __future__ import annotations

import os
from datetime import datetime
from flask import Blueprint, jsonify, request

from services import stock_analysis_engine as stock_engine

financials_bp = Blueprint("financials", __name__)
fetch_json = stock_engine._fetch_json

# ── In-memory TTL cache (6 hours) ──────────────────────────────────────────
import time as _time
_FINANCIALS_CACHE: dict = {}
_CACHE_TTL = 6 * 3600  # 6 hours


def _safe_float(value):
    try:
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip().replace(",", "").replace("$", "")
            if not value:
                return None
        number = float(value)
        if number != number or number in (float("inf"), float("-inf")):
            return None
        return number
    except Exception:
        return None


def _safe_int(value):
    try:
        if value is None:
            return None
        return int(float(value))
    except Exception:
        return None


def _normalize_ticker(value):
    raw = str(value or "").strip().upper()
    if ":" in raw:
        raw = raw.split(":")[-1]
    return raw


def _coerce_datetime(value):
    if value is None:
        return None
    if hasattr(value, "to_pydatetime"):
        try:
            return value.to_pydatetime()
        except Exception:
            pass
    text = str(value).strip()
    if not text:
        return None
    for candidate in (text, text[:10], text.replace("Z", "+00:00")):
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            continue
    return None


def _period_label(period_dt, quarterly=False):
    if period_dt is None:
        return None
    if quarterly:
        quarter = ((period_dt.month - 1) // 3) + 1
        return f"{period_dt.year}Q{quarter}"
    return str(period_dt.year)


def _first_frame(*frames):
    for frame in frames:
        if frame is None:
            continue
        try:
            if getattr(frame, "empty", False):
                continue
        except Exception:
            pass
        return frame
    return None


def _payload_rows(payload):
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("data", "results", "historical", "financialStatements", "items"):
            nested = payload.get(key)
            if isinstance(nested, list):
                return [row for row in nested if isinstance(row, dict)]
        return [payload]
    return []


def _rows_from_frame(frame, quarterly=False):
    if frame is None:
        return []
    try:
        data = frame.T if hasattr(frame, "T") else frame
        if getattr(data, "empty", False):
            return []
        rows = []
        for idx, row in data.iterrows():
            rows.append({
                "_period": _coerce_datetime(idx),
                **row.to_dict(),
            })
        rows.sort(key=lambda item: item.get("_period") or datetime.min)
        return rows
    except Exception:
        return []


def _rows_from_raw_list(raw_rows, quarterly=False):
    rows = []
    for raw in raw_rows or []:
        if not isinstance(raw, dict):
            continue
        period = _coerce_datetime(
            raw.get("date")
            or raw.get("calendarYear")
            or raw.get("fiscalDateEnding")
            or raw.get("fiscalYear")
            or raw.get("endDate")
        )
        rows.append({"_period": period, **raw})
    rows.sort(key=lambda item: item.get("_period") or datetime.min)
    return rows


def _pick(row, *keys):
    for key in keys:
        value = _safe_float(row.get(key))
        if value is not None:
            return value
    return None


def _normalize_income_rows(rows, quarterly=False):
    out = []
    for row in rows:
        period = row.get("_period")
        label = _period_label(period, quarterly=quarterly)
        revenue = _pick(row, "Total Revenue", "Operating Revenue", "Revenue", "revenue", "totalRevenue")
        cogs = _pick(row, "Cost Of Revenue", "Cost of Revenue", "CostOfRevenue", "costOfRevenue")
        gross = _pick(row, "Gross Profit", "GrossProfit", "grossProfit")
        operating_income = _pick(row, "Operating Income", "OperatingIncome", "operatingIncome")
        operating_expenses = _pick(row, "Operating Expense", "Operating Expenses", "Total Operating Expenses", "operatingExpenses")
        ebitda = _pick(row, "EBITDA", "ebitda")
        tax = _pick(row, "Tax Provision", "Income Tax Expense", "incomeTaxExpense")
        net_income = _pick(row, "Net Income", "NetIncome", "netIncome")
        eps = _pick(row, "Diluted EPS", "Basic EPS", "EPS", "epsDiluted", "eps")

        if gross is None and revenue is not None and cogs is not None:
            gross = revenue - cogs
        if operating_expenses is None and gross is not None and operating_income is not None:
            operating_expenses = gross - operating_income

        out.append(
            {
                "fiscalYear": label,
                "revenue": revenue,
                "cogs": cogs,
                "grossProfit": gross,
                "operatingExpenses": operating_expenses,
                "operatingIncome": operating_income,
                "ebitda": ebitda,
                "incomeTaxExpense": tax,
                "netIncome": net_income,
                "eps": eps,
                "grossMargin": (gross / revenue) if revenue and gross is not None else None,
                "operatingMargin": (operating_income / revenue) if revenue and operating_income is not None else None,
                "netMargin": (net_income / revenue) if revenue and net_income is not None else None,
                "_period": period,
            }
        )

    return [row for row in out if row.get("fiscalYear")].copy()


def _normalize_balance_rows(rows, quarterly=False):
    out = []
    for row in rows:
        period = row.get("_period")
        label = _period_label(period, quarterly=quarterly)
        cash = _pick(
            row,
            "Cash And Cash Equivalents",
            "Cash And Short Term Investments",
            "Cash Cash Equivalents And Short Term Investments",
            "Cash",
            "cashAndCashEquivalents",
            "cashAndShortTermInvestments",
            "cashAndCashEquivalentsAndShortTermInvestments",
            "cash",
        )
        total_assets = _pick(row, "Total Assets", "totalAssets")
        total_debt = _pick(row, "Total Debt", "totalDebt")
        if total_debt is None:
            long_term = _pick(row, "Long Term Debt", "LongTermDebt", "longTermDebt")
            short_term = _pick(row, "Short Long Term Debt", "ShortLongTermDebt", "shortLongTermDebt")
            if long_term is not None or short_term is not None:
                total_debt = (long_term or 0.0) + (short_term or 0.0)
        total_equity = _pick(
            row,
            "Total Stockholder Equity",
            "Stockholders Equity",
            "Total Equity Gross Minority Interest",
            "totalStockholdersEquity",
            "stockholdersEquity",
            "totalEquityGrossMinorityInterest",
            "totalShareholderEquity",
        )
        net_debt = _pick(row, "Net Debt")
        if net_debt is None and total_debt is not None and cash is not None:
            net_debt = total_debt - cash

        out.append(
            {
                "fiscalYear": label,
                "cash": cash,
                "totalAssets": total_assets,
                "totalDebt": total_debt,
                "totalEquity": total_equity,
                "netDebt": net_debt,
                "_period": period,
            }
        )

    return [row for row in out if row.get("fiscalYear")].copy()


def _normalize_price_series(price_series):
    rows = []
    for point in price_series or []:
        date = str(point.get("date") or "").strip()
        close = _safe_float(point.get("close"))
        if not date or close is None or close <= 0:
            continue
        rows.append({"date": date, "close": close})
    rows.sort(key=lambda item: item["date"])
    return rows


def _year_end_close(price_series, period_dt):
    if period_dt is None:
        return None
    cutoff = datetime(period_dt.year, 12, 31)
    best = None
    for point in price_series:
        try:
            dt = datetime.fromisoformat(point["date"])
        except Exception:
            continue
        if dt <= cutoff:
            best = point["close"]
        else:
            break
    return best


def _build_ratio_history(income_rows, balance_rows, price_series, shares_outstanding, current_price):
    balance_map = {row["fiscalYear"]: row for row in balance_rows if row.get("fiscalYear")}
    out = []
    for row in income_rows:
        period_dt = row.get("_period")
        fy = row.get("fiscalYear") or (str(period_dt.year) if period_dt else None)
        close = _year_end_close(price_series, period_dt) if period_dt else None
        if close is None:
            close = current_price
        revenue = row.get("revenue")
        eps = row.get("eps")
        if eps is None and row.get("netIncome") is not None and shares_outstanding and shares_outstanding > 0:
            eps = row["netIncome"] / shares_outstanding
        market_cap = close * shares_outstanding if close is not None and shares_outstanding else None
        total_equity = balance_map.get(fy, {}).get("totalEquity")

        pe = close / eps if close is not None and eps is not None and eps > 0 else None
        ps = market_cap / revenue if market_cap is not None and revenue is not None and revenue > 0 else None
        pb = market_cap / total_equity if market_cap is not None and total_equity is not None and total_equity > 0 else None

        out.append(
            {
                "year": fy or "????",
                "pe": pe,
                "ps": ps,
                "pb": pb,
            }
        )
    return out


def _build_eps_estimates(consensus):
    ladder = consensus.get("eps_ladder") or []
    rows = []
    for item in ladder:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").lower()
        year = _safe_int(item.get("year"))
        eps = _safe_float(item.get("eps"))
        if year is None or eps is None or kind == "actual":
            continue
        rows.append(
            {
                "year": str(year),
                "epsAvg": eps,
                "epsHigh": _safe_float(item.get("eps_high")) or eps,
                "epsLow": _safe_float(item.get("eps_low")) or eps,
                "numAnalysts": _safe_int(item.get("analyst_count")),
                "revenueAvg": _safe_float(item.get("revenue_avg")),
                "isFuture": True,
            }
        )
    rows.sort(key=lambda item: item["year"])
    return rows


def _fallback_eps_estimates(info, current_year):
    forward = _safe_float(info.get("forwardEps") if isinstance(info, dict) else None)
    if forward is None or forward <= 0:
        return []
    return [
        {
            "year": str(current_year + 1),
            "epsAvg": forward,
            "epsHigh": forward * 1.12,
            "epsLow": forward * 0.88,
            "numAnalysts": _safe_int(info.get("numberOfAnalystOpinions")) if isinstance(info, dict) else None,
            "revenueAvg": None,
            "isFuture": True,
        },
        {
            "year": str(current_year + 2),
            "epsAvg": forward * 1.1,
            "epsHigh": forward * 1.22,
            "epsLow": forward * 0.95,
            "numAnalysts": _safe_int(info.get("numberOfAnalystOpinions")) if isinstance(info, dict) else None,
            "revenueAvg": None,
            "isFuture": True,
        },
    ]



def _fetch_av_income(symbol: str, av_key: str):
    """Fetch Alpha Vantage annual income statements (fallback for FMP 429)."""
    try:
        import requests as _r
        url = f"https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol={symbol}&apikey={av_key}"
        res = _r.get(url, timeout=10)
        if not res.ok:
            return []
        data = res.json()
        if "Note" in data or "Information" in data:
            return []
        return (data.get("annualReports") or [])[:5]
    except Exception:
        return []


def _fetch_av_balance(symbol: str, av_key: str):
    """Fetch Alpha Vantage annual balance sheets (fallback for FMP 429)."""
    try:
        import requests as _r
        url = f"https://www.alphavantage.co/query?function=BALANCE_SHEET&symbol={symbol}&apikey={av_key}"
        res = _r.get(url, timeout=10)
        if not res.ok:
            return [], None
        data = res.json()
        if "Note" in data or "Information" in data:
            return [], None
        rows = (data.get("annualReports") or [])[:5]
        # Extract most recent shares outstanding
        shares = None
        if rows:
            shares = _safe_float(rows[0].get("commonStockSharesOutstanding"))
        return rows, shares
    except Exception:
        return [], None


def _fetch_av_overview(symbol: str, av_key: str):
    """Get market cap and current PE from Alpha Vantage OVERVIEW."""
    try:
        import requests as _r
        url = f"https://www.alphavantage.co/query?function=OVERVIEW&symbol={symbol}&apikey={av_key}"
        res = _r.get(url, timeout=8)
        if not res.ok:
            return {}
        data = res.json()
        if "Note" in data or "Information" in data:
            return {}
        return data
    except Exception:
        return {}



def _fetch_finnhub_financials(symbol: str, fh_key: str):
    """Fetch income and balance from Finnhub XBRL reported financials."""
    try:
        import requests as _r
        url = f"https://finnhub.io/api/v1/stock/financials-reported?symbol={symbol}&freq=annual&token={fh_key}"
        res = _r.get(url, timeout=10)
        if not res.ok:
            return [], []
        data = res.json()
        rows = data.get("data") or []
        annual = [r for r in rows if isinstance(r, dict) and r.get("quarter") == 0]
        annual.sort(key=lambda r: r.get("year", 0))

        # GAAP concept maps
        _REV = ["us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap_Revenues", "us-gaap_SalesRevenueNet"]
        _COGS = ["us-gaap_CostOfGoodsAndServicesSold", "us-gaap_CostOfRevenue", "us-gaap_CostOfGoodsSold"]
        _GROSS = ["us-gaap_GrossProfit"]
        _OPINC = ["us-gaap_OperatingIncomeLoss"]
        _NET = ["us-gaap_NetIncomeLoss"]
        _EBITDA = ["us-gaap_EarningsBeforeInterestTaxesDepreciationAndAmortization"]
        _TAX = ["us-gaap_IncomeTaxExpenseBenefit"]
        _CASH = ["us-gaap_CashCashEquivalentsAndShortTermInvestments", "us-gaap_CashAndCashEquivalentsAtCarryingValue"]
        _ASSETS = ["us-gaap_Assets"]
        _DEBT = [
            "us-gaap_LongTermDebtNoncurrent", "us-gaap_LongTermDebt",
            "us-gaap_DebtCurrent", "us-gaap_LongTermDebtAndCapitalLeaseObligations",
            "us-gaap_ShortLongTermDebtTotal", "us-gaap_LiabilitiesAndStockholdersEquity",
        ]
        _EQUITY = [
            "us-gaap_StockholdersEquity", "us-gaap_StockholdersEquityAttributableToParent",
            "us-gaap_StockholdersEquityAttributableToParentBeforeOtherComprehensiveLossIncome",
        ]
        _SHARES = [
            "us-gaap_CommonStockSharesOutstanding", "us-gaap_CommonStockSharesIssued",
            "us-gaap_WeightedAverageNumberOfSharesOutstandingBasic",
            "us-gaap_WeightedAverageNumberOfDilutedSharesOutstanding",
        ]

        def _pick_map(m, keys):
            for k in keys:
                v = m.get(k)
                if v is not None:
                    return _safe_float(v)
            return None

        inc_rows, bal_rows = [], []
        for row in annual[-5:]:
            report = row.get("report") or {}
            ic_map = {item["concept"]: item.get("value") for item in (report.get("ic") or []) if isinstance(item, dict)}
            bs_map = {item["concept"]: item.get("value") for item in (report.get("bs") or []) if isinstance(item, dict)}
            yr = str(row.get("year", ""))
            date_str = str(row.get("endDate") or "")[:10]
            inc_rows.append({
                "fiscalDateEnding": date_str or yr,
                "totalRevenue": _pick_map(ic_map, _REV),
                "costOfRevenue": _pick_map(ic_map, _COGS),
                "grossProfit": _pick_map(ic_map, _GROSS),
                "operatingIncome": _pick_map(ic_map, _OPINC),
                "netIncome": _pick_map(ic_map, _NET),
                "ebitda": _pick_map(ic_map, _EBITDA),
                "incomeTaxExpense": _pick_map(ic_map, _TAX),
            })
            shares = _pick_map(bs_map, _SHARES)
            cash = _pick_map(bs_map, _CASH)
            assets = _pick_map(bs_map, _ASSETS)
            raw_debt = _pick_map(bs_map, _DEBT)
            equity = _pick_map(bs_map, _EQUITY)
            net_debt = (raw_debt - cash) if raw_debt is not None and cash is not None else None
            bal_rows.append({
                "fiscalDateEnding": date_str or yr,
                "cashAndShortTermInvestments": cash,
                "totalAssets": assets,
                "totalDebt": raw_debt,
                "totalShareholderEquity": equity,
                "netDebt": net_debt,
                "commonStockSharesOutstanding": shares,
            })
        return inc_rows, bal_rows
    except Exception:
        return [], []

@financials_bp.route("/api/analyze/financials", methods=["GET"])
def analyze_financials():
    symbol = _normalize_ticker(request.args.get("symbol") or "AAPL")
    if not symbol:
        return jsonify({"error": "missing symbol"}), 400

    # Check cache
    cached = _FINANCIALS_CACHE.get(symbol)
    if cached and _time.time() - cached["ts"] < _CACHE_TTL:
        return jsonify(cached["data"]), 200

    data = stock_engine.load_stock_data(symbol)
    api_key = (
        (stock_engine.os.getenv("FMP_API_KEY") if hasattr(stock_engine, "os") else None)
        or (stock_engine.os.getenv("NEXT_PUBLIC_FMP_API_KEY") if hasattr(stock_engine, "os") else None)
        or ""
    )
    ticker = None
    info = {}
    if stock_engine.yf is not None:
        try:
            ticker = stock_engine.yf.Ticker(symbol)
            info = dict(ticker.info or {})
        except Exception:
            ticker = None
            info = {}

    annual_income_frame = _first_frame(
        getattr(ticker, "financials", None) if ticker is not None else None,
        getattr(ticker, "income_stmt", None) if ticker is not None else None,
    )
    quarterly_income_frame = _first_frame(
        getattr(ticker, "quarterly_financials", None) if ticker is not None else None,
        getattr(ticker, "quarterly_income_stmt", None) if ticker is not None else None,
    )
    annual_balance_frame = _first_frame(
        getattr(ticker, "balance_sheet", None) if ticker is not None else None,
    )
    quarterly_balance_frame = _first_frame(
        getattr(ticker, "quarterly_balance_sheet", None) if ticker is not None else None,
    )

    fmp_income_rows = []
    fmp_balance_rows = []
    fmp_ratio_rows = []
    debug = {
        "income": {},
        "balance": {},
        "ratio": {},
    }
    if api_key:
        try:
            income_candidates = [
                f"https://financialmodelingprep.com/stable/income-statement?symbol={symbol}&limit=5&apikey={api_key}",
                f"https://financialmodelingprep.com/api/v3/income-statement/{symbol}?period=annual&limit=5&apikey={api_key}",
            ]
            balance_candidates = [
                f"https://financialmodelingprep.com/stable/balance-sheet-statement?symbol={symbol}&limit=5&apikey={api_key}",
                f"https://financialmodelingprep.com/api/v3/balance-sheet-statement/{symbol}?period=annual&limit=5&apikey={api_key}",
            ]
            ratio_candidates = [
                f"https://financialmodelingprep.com/stable/ratios?symbol={symbol}&limit=5&apikey={api_key}",
                f"https://financialmodelingprep.com/api/v3/ratios/{symbol}?period=annual&limit=5&apikey={api_key}",
            ]

            for url in income_candidates:
                income_payload, _ = fetch_json(url)
                debug["income"] = {
                    "url": url,
                    "type": type(income_payload).__name__ if income_payload is not None else None,
                    "keys": list(income_payload.keys())[:8] if isinstance(income_payload, dict) else None,
                    "len": len(income_payload) if hasattr(income_payload, "__len__") else None,
                }
                fmp_income_rows = _payload_rows(income_payload)
                if fmp_income_rows:
                    break
            for url in balance_candidates:
                balance_payload, _ = fetch_json(url)
                debug["balance"] = {
                    "url": url,
                    "type": type(balance_payload).__name__ if balance_payload is not None else None,
                    "keys": list(balance_payload.keys())[:8] if isinstance(balance_payload, dict) else None,
                    "len": len(balance_payload) if hasattr(balance_payload, "__len__") else None,
                }
                fmp_balance_rows = _payload_rows(balance_payload)
                if fmp_balance_rows:
                    break
            for url in ratio_candidates:
                ratio_payload, _ = fetch_json(url)
                debug["ratio"] = {
                    "url": url,
                    "type": type(ratio_payload).__name__ if ratio_payload is not None else None,
                    "keys": list(ratio_payload.keys())[:8] if isinstance(ratio_payload, dict) else None,
                    "len": len(ratio_payload) if hasattr(ratio_payload, "__len__") else None,
                }
                fmp_ratio_rows = _payload_rows(ratio_payload)
                if fmp_ratio_rows:
                    break
        except Exception:
            fmp_income_rows = []
            fmp_balance_rows = []
            fmp_ratio_rows = []

    av_key = os.environ.get("ALPHA_VANTAGE_KEY", "").strip().strip("'").strip()
    fh_key = os.environ.get("FINNHUB_API_KEY", "").strip().strip("'").strip()
    # Pre-fetch Alpha Vantage data (single call each, cached result used below)
    _av_income_rows: list = []
    _av_balance_rows: list = []
    _av_shares: float | None = None

    income_rows = _normalize_income_rows(
        _rows_from_raw_list(fmp_income_rows, quarterly=False) if fmp_income_rows else _rows_from_frame(annual_income_frame, quarterly=False),
        quarterly=False,
    )
    if len(income_rows) < 2:
        income_rows = _normalize_income_rows(
            _rows_from_raw_list(fmp_income_rows, quarterly=True) if fmp_income_rows else _rows_from_frame(quarterly_income_frame, quarterly=True),
            quarterly=True,
        )
    if len(income_rows) < 2 and quarterly_income_frame is not None:
        income_rows = _normalize_income_rows(_rows_from_frame(quarterly_income_frame, quarterly=True), quarterly=True)
    # Alpha Vantage fallback when FMP rate-limited and yfinance empty
    if len(income_rows) < 2 and av_key:
        _av_income_rows = _fetch_av_income(symbol, av_key)
        if _av_income_rows:
            income_rows = _normalize_income_rows(_rows_from_raw_list(_av_income_rows, quarterly=False), quarterly=False)
    # Finnhub fallback (3rd source)
    _fh_inc_rows: list = []
    _fh_bal_rows: list = []
    if len(income_rows) < 2 and fh_key:
        _fh_inc_rows, _fh_bal_rows = _fetch_finnhub_financials(symbol, fh_key)
        if _fh_inc_rows:
            income_rows = _normalize_income_rows(_rows_from_raw_list(_fh_inc_rows, quarterly=False), quarterly=False)

    balance_rows = _normalize_balance_rows(
        _rows_from_raw_list(fmp_balance_rows, quarterly=False) if fmp_balance_rows else _rows_from_frame(annual_balance_frame, quarterly=False),
        quarterly=False,
    )
    if len(balance_rows) < 1:
        balance_rows = _normalize_balance_rows(
            _rows_from_raw_list(fmp_balance_rows, quarterly=True) if fmp_balance_rows else _rows_from_frame(quarterly_balance_frame, quarterly=True),
            quarterly=True,
        )
    if len(balance_rows) < 1 and quarterly_balance_frame is not None:
        balance_rows = _normalize_balance_rows(_rows_from_frame(quarterly_balance_frame, quarterly=True), quarterly=True)
    # Alpha Vantage fallback
    if av_key and not _av_balance_rows:
        _av_balance_rows, _av_shares = _fetch_av_balance(symbol, av_key)
        if _av_balance_rows and len(balance_rows) < 1:
            balance_rows = _normalize_balance_rows(_rows_from_raw_list(_av_balance_rows, quarterly=False), quarterly=False)
    # Finnhub fallback for balance (uses pre-fetched _fh_bal_rows if available)
    if len(balance_rows) < 1 and fh_key:
        if not _fh_bal_rows:
            _, _fh_bal_rows = _fetch_finnhub_financials(symbol, fh_key)
        if _fh_bal_rows:
            balance_rows = _normalize_balance_rows(_rows_from_raw_list(_fh_bal_rows, quarterly=False), quarterly=False)
            if not _av_shares and _fh_bal_rows:
                _av_shares = _safe_float(_fh_bal_rows[-1].get("commonStockSharesOutstanding"))

    price_series = _normalize_price_series(data.get("price_series") or [])
    current_price = _safe_float(data.get("price")) or _safe_float(info.get("currentPrice")) or _safe_float(info.get("regularMarketPrice"))
    market_cap = _safe_float(data.get("market_cap")) or _safe_float(info.get("marketCap"))
    if market_cap is None and current_price is not None and _av_shares is not None:
        market_cap = current_price * _av_shares
    shares_outstanding = _safe_float(info.get("sharesOutstanding"))
    if shares_outstanding is None and market_cap is not None and current_price is not None and current_price > 0:
        shares_outstanding = market_cap / current_price
    if shares_outstanding is None:
        shares_outstanding = _av_shares  # from AV balance sheet fetched above

    # Fill in missing EPS from netIncome / shares_outstanding
    if shares_outstanding and shares_outstanding > 0:
        for row in income_rows:
            if row.get("eps") is None and row.get("netIncome") is not None:
                row["eps"] = row["netIncome"] / shares_outstanding

    ratio_history = []
    if fmp_ratio_rows:
        for row in fmp_ratio_rows or []:
            if not isinstance(row, dict):
                continue
            ratio_history.append(
                {
                    "year": str(row.get("calendarYear") or row.get("date") or row.get("year") or ""),
                    "pe": _safe_float(row.get("priceToEarningsRatio") or row.get("peRatio") or row.get("priceEarningsRatio")),
                    "ps": _safe_float(row.get("priceToSalesRatio") or row.get("priceToSalesRatioTTM")),
                    "pb": _safe_float(row.get("priceToBookRatio") or row.get("priceToBookRatioTTM")),
                }
            )
        ratio_history = [row for row in ratio_history if row.get("year")]
        ratio_history.sort(key=lambda row: row["year"])

    if not ratio_history:
        ratio_history = _build_ratio_history(income_rows, balance_rows, price_series, shares_outstanding, current_price)
    consensus = data.get("consensus") or {}
    eps_estimates = _build_eps_estimates(consensus)
    if not eps_estimates:
        eps_estimates = _fallback_eps_estimates(info, datetime.utcnow().year)

    result = {
        "symbol": symbol,
        "incomeStatements": [
            {
                "fiscalYear": row.get("fiscalYear"),
                "revenue": row.get("revenue"),
                "cogs": row.get("cogs"),
                "grossProfit": row.get("grossProfit"),
                "operatingExpenses": row.get("operatingExpenses"),
                "operatingIncome": row.get("operatingIncome"),
                "ebitda": row.get("ebitda"),
                "incomeTaxExpense": row.get("incomeTaxExpense"),
                "netIncome": row.get("netIncome"),
                "eps": row.get("eps"),
                "grossMargin": row.get("grossMargin"),
                "operatingMargin": row.get("operatingMargin"),
                "netMargin": row.get("netMargin"),
            }
            for row in income_rows
        ],
        "balanceSheets": [
            {
                "fiscalYear": row.get("fiscalYear"),
                "cash": row.get("cash"),
                "totalAssets": row.get("totalAssets"),
                "totalDebt": row.get("totalDebt"),
                "totalEquity": row.get("totalEquity"),
                "netDebt": row.get("netDebt"),
            }
            for row in balance_rows
        ],
        "ratioHistory": ratio_history,
        "epsEstimates": eps_estimates,
        "marketCap": market_cap,
        "fetchedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "debug": debug,
    }

    # Store in cache only if we have meaningful data
    if income_rows or balance_rows:
        _FINANCIALS_CACHE[symbol] = {"ts": _time.time(), "data": result}

    return jsonify(result), 200
