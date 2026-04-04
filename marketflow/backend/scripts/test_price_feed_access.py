"""
WO-DATA-01 price feed access test.

This script:
1) Tries TradingView first
2) Falls back to yfinance, then Stooq for selected instruments
3) Normalizes price records into a shared schema
4) Writes raw + normalized JSON outputs for the DB test script

It intentionally avoids any browser automation, LLM calls, or production DB writes.
"""
from __future__ import annotations

import json
import math
import re
import sys
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests
import yfinance as yf
from bs4 import BeautifulSoup


REQUEST_TIMEOUT_SEC = 20

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

TRADINGVIEW_HEADERS = {
    **DEFAULT_HEADERS,
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}

ALLOWED_ASSET_CLASSES = {"index", "commodity", "gold", "stock", "etf"}

TV_SCAN_COLUMNS = ["name", "close", "change", "currency"]

OUTPUT_SUBDIR = "price_feed_test"
RAW_JSON_NAME = "price_feed_raw.json"
NORMALIZED_JSON_NAME = "price_feed_normalized.json"

ASSET_SPECS: List[Dict[str, Any]] = [
    # Indices
    {
        "asset_class": "index",
        "symbol": "SPX",
        "name": "S&P 500",
        "tv_candidates": [
            {"market": "america", "raw_symbol": "SP:SPX"},
            {"market": "indices", "raw_symbol": "SP:SPX"},
            {"market": "global", "raw_symbol": "SP:SPX"},
        ],
        "yf_symbol": "^GSPC",
        "stooq_symbol": "^spx",
    },
    {
        "asset_class": "index",
        "symbol": "NDX",
        "name": "Nasdaq 100",
        "tv_candidates": [
            {"market": "america", "raw_symbol": "NASDAQ:NDX"},
            {"market": "indices", "raw_symbol": "NASDAQ:NDX"},
            {"market": "global", "raw_symbol": "NASDAQ:NDX"},
        ],
        "yf_symbol": "^NDX",
        "stooq_symbol": "^ndq",
    },
    {
        "asset_class": "index",
        "symbol": "DJI",
        "name": "Dow 30",
        "tv_candidates": [
            {"market": "america", "raw_symbol": "DJ:DJI"},
            {"market": "indices", "raw_symbol": "DJ:DJI"},
            {"market": "global", "raw_symbol": "DJ:DJI"},
        ],
        "yf_symbol": "^DJI",
        "stooq_symbol": "^dji",
    },
    {
        "asset_class": "index",
        "symbol": "IXIC",
        "name": "Nasdaq Composite",
        "tv_candidates": [
            {"market": "america", "raw_symbol": "NASDAQ:IXIC"},
            {"market": "indices", "raw_symbol": "NASDAQ:IXIC"},
            {"market": "global", "raw_symbol": "NASDAQ:IXIC"},
        ],
        "yf_symbol": "^IXIC",
        "stooq_symbol": "^ixic",
    },
    # Commodities
    {
        "asset_class": "commodity",
        "symbol": "WTI",
        "name": "WTI Crude Oil",
        "tv_candidates": [
            {"market": "cfd", "raw_symbol": "TVC:USOIL"},
            {"market": "futures", "raw_symbol": "NYMEX:CL1!"},
            {"market": "america", "raw_symbol": "NYMEX:CL1!"},
        ],
        "yf_symbol": "CL=F",
        "stooq_symbol": None,
    },
    {
        "asset_class": "commodity",
        "symbol": "BRENT",
        "name": "Brent Crude",
        "tv_candidates": [
            {"market": "cfd", "raw_symbol": "TVC:UKOIL"},
            {"market": "futures", "raw_symbol": "ICEEUR:BRN1!"},
            {"market": "america", "raw_symbol": "ICEEUR:BRN1!"},
        ],
        "yf_symbol": "BZ=F",
        "stooq_symbol": None,
    },
    {
        "asset_class": "commodity",
        "symbol": "NG",
        "name": "Natural Gas",
        "tv_candidates": [
            {"market": "cfd", "raw_symbol": "TVC:NATGAS"},
            {"market": "futures", "raw_symbol": "NYMEX:NG1!"},
            {"market": "america", "raw_symbol": "NYMEX:NG1!"},
        ],
        "yf_symbol": "NG=F",
        "stooq_symbol": None,
    },
    # Gold
    {
        "asset_class": "gold",
        "symbol": "GOLD",
        "name": "Gold Spot",
        "tv_candidates": [
            {"market": "cfd", "raw_symbol": "TVC:GOLD"},
            {"market": "futures", "raw_symbol": "COMEX:GC1!"},
            {"market": "america", "raw_symbol": "COMEX:GC1!"},
        ],
        "yf_symbol": "GC=F",
        "stooq_symbol": None,
    },
    # Stocks
    {
        "asset_class": "stock",
        "symbol": "AAPL",
        "name": "Apple",
        "tv_candidates": [{"market": "america", "raw_symbol": "NASDAQ:AAPL"}],
        "yf_symbol": "AAPL",
        "stooq_symbol": "aapl.us",
    },
    {
        "asset_class": "stock",
        "symbol": "MSFT",
        "name": "Microsoft",
        "tv_candidates": [{"market": "america", "raw_symbol": "NASDAQ:MSFT"}],
        "yf_symbol": "MSFT",
        "stooq_symbol": "msft.us",
    },
    {
        "asset_class": "stock",
        "symbol": "NVDA",
        "name": "NVIDIA",
        "tv_candidates": [{"market": "america", "raw_symbol": "NASDAQ:NVDA"}],
        "yf_symbol": "NVDA",
        "stooq_symbol": "nvda.us",
    },
    {
        "asset_class": "stock",
        "symbol": "AMZN",
        "name": "Amazon",
        "tv_candidates": [{"market": "america", "raw_symbol": "NASDAQ:AMZN"}],
        "yf_symbol": "AMZN",
        "stooq_symbol": "amzn.us",
    },
    # ETFs
    {
        "asset_class": "etf",
        "symbol": "SPY",
        "name": "SPDR S&P 500 ETF Trust",
        "tv_candidates": [{"market": "america", "raw_symbol": "AMEX:SPY"}],
        "yf_symbol": "SPY",
        "stooq_symbol": "spy.us",
    },
    {
        "asset_class": "etf",
        "symbol": "QQQ",
        "name": "Invesco QQQ Trust",
        "tv_candidates": [{"market": "america", "raw_symbol": "NASDAQ:QQQ"}],
        "yf_symbol": "QQQ",
        "stooq_symbol": "qqq.us",
    },
    {
        "asset_class": "etf",
        "symbol": "TQQQ",
        "name": "ProShares UltraPro QQQ",
        "tv_candidates": [{"market": "america", "raw_symbol": "NASDAQ:TQQQ"}],
        "yf_symbol": "TQQQ",
        "stooq_symbol": "tqqq.us",
    },
    {
        "asset_class": "etf",
        "symbol": "SOXL",
        "name": "Direxion Daily Semiconductor Bull 3X Shares",
        "tv_candidates": [{"market": "america", "raw_symbol": "AMEX:SOXL"}],
        "yf_symbol": "SOXL",
        "stooq_symbol": "soxl.us",
    },
]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def output_dir() -> Path:
    return backend_dir() / "output" / OUTPUT_SUBDIR


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def parse_numeric(value: Any) -> Optional[float]:
    if value is None:
        return None

    if isinstance(value, bool):
        return float(value)

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    text = text.replace(",", "").replace("−", "-").replace("–", "-")
    text = text.replace("%", "")
    if text.startswith("(") and text.endswith(")"):
        text = f"-{text[1:-1]}"
    if text in {"-", "--", "nan", "None"}:
        return None

    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None

    try:
        return float(match.group(0))
    except ValueError:
        return None


def safe_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = normalize_whitespace(str(value))
    return text or None


def to_snippet(value: Any, limit: int = 220) -> str:
    text = normalize_whitespace(str(value))
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(TRADINGVIEW_HEADERS)
    return session


def build_ticker_snapshot(ticker: yf.Ticker) -> Dict[str, Any]:
    snapshot: Dict[str, Any] = {}
    try:
        fast_info = getattr(ticker, "fast_info", None)
        if fast_info is not None:
            try:
                snapshot["fast_info"] = dict(fast_info)
            except Exception:
                try:
                    snapshot["fast_info"] = {key: fast_info[key] for key in fast_info.keys()}
                except Exception:
                    snapshot["fast_info"] = {}
        else:
            snapshot["fast_info"] = {}
    except Exception:
        snapshot["fast_info"] = {}

    try:
        hist = ticker.history(period="10d", interval="1d", auto_adjust=False, actions=False)
        if hist is None or hist.empty:
            snapshot["history_tail"] = []
        else:
            hist = hist.tail(5).copy()
            hist.index = pd.to_datetime(hist.index)
            tail: List[Dict[str, Any]] = []
            for idx, row in hist.iterrows():
                tail.append(
                    {
                        "date": idx.strftime("%Y-%m-%d"),
                        "close": parse_numeric(row.get("Close")),
                        "adj_close": parse_numeric(row.get("Adj Close")),
                        "volume": parse_numeric(row.get("Volume")),
                    }
                )
            snapshot["history_tail"] = tail
    except Exception as exc:
        snapshot["history_tail"] = []
        snapshot["history_error"] = f"{exc.__class__.__name__}: {exc}"

    return snapshot


def fetch_tradingview_scan(
    session: requests.Session,
    *,
    market: str,
    raw_symbol: str,
) -> Dict[str, Any]:
    url = f"https://scanner.tradingview.com/{market}/scan"
    payload = {
        "symbols": {
            "tickers": [raw_symbol],
            "query": {"types": []},
        },
        "columns": TV_SCAN_COLUMNS,
    }

    try:
        response = session.post(url, json=payload, timeout=REQUEST_TIMEOUT_SEC)
        text = response.text or ""
        data = response.json() if text.strip().startswith("{") else {}
        rows = data.get("data") if isinstance(data, dict) else []
        row = rows[0] if rows else None

        parsed = None
        if isinstance(row, dict):
            values = row.get("d") or []
            if len(values) >= 4:
                parsed = {
                    "name": safe_string(values[0]),
                    "price": parse_numeric(values[1]),
                    "change_pct": parse_numeric(values[2]),
                    "currency": safe_string(values[3]),
                }

        ok = response.status_code == 200 and parsed is not None and parsed.get("price") is not None
        return {
            "source": "tradingview",
            "market": market,
            "raw_symbol": raw_symbol,
            "ok": ok,
            "status_code": response.status_code,
            "response_length": len(text),
            "response_snippet": to_snippet(text, 500) if not ok else None,
            "row": row,
            "parsed": parsed,
            "error": None if ok else "no parsed row",
        }
    except requests.RequestException as exc:
        return {
            "source": "tradingview",
            "market": market,
            "raw_symbol": raw_symbol,
            "ok": False,
            "status_code": getattr(exc.response, "status_code", None),
            "response_length": 0,
            "response_snippet": None,
            "row": None,
            "parsed": None,
            "error": f"{exc.__class__.__name__}: {exc}",
        }
    except Exception as exc:
        return {
            "source": "tradingview",
            "market": market,
            "raw_symbol": raw_symbol,
            "ok": False,
            "status_code": None,
            "response_length": 0,
            "response_snippet": None,
            "row": None,
            "parsed": None,
            "error": f"{exc.__class__.__name__}: {exc}",
        }


def fetch_yfinance_quote(spec: Dict[str, Any]) -> Dict[str, Any]:
    yf_symbol = spec["yf_symbol"]
    ticker = yf.Ticker(yf_symbol)
    snapshot = build_ticker_snapshot(ticker)
    fast_info = snapshot.get("fast_info", {}) if isinstance(snapshot.get("fast_info"), dict) else {}
    history_tail = snapshot.get("history_tail", []) if isinstance(snapshot.get("history_tail"), list) else []

    closes = [item.get("close") for item in history_tail if parse_numeric(item.get("close")) is not None]
    closes = [float(v) for v in closes if v is not None]

    price = closes[-1] if closes else parse_numeric(fast_info.get("lastPrice"))
    prev_close = closes[-2] if len(closes) >= 2 else parse_numeric(fast_info.get("previousClose"))
    if prev_close is None:
        prev_close = parse_numeric(fast_info.get("regularMarketPreviousClose"))

    change_pct = None
    if price is not None and prev_close is not None and prev_close > 0:
        change_pct = round((float(price) / float(prev_close) - 1.0) * 100.0, 4)

    currency = safe_string(fast_info.get("currency")) or "USD"

    ok = price is not None and price > 0
    return {
        "source": "yfinance",
        "raw_symbol": yf_symbol,
        "ok": ok,
        "status_code": None,
        "response_length": None,
        "response_snippet": {
            "history_tail": history_tail,
            "fast_info_keys": sorted(list(fast_info.keys()))[:20] if isinstance(fast_info, dict) else [],
        },
        "row": None,
        "parsed": {
            "name": spec["name"],
            "price": parse_numeric(price),
            "change_pct": parse_numeric(change_pct),
            "currency": currency,
        },
        "error": None if ok else "no usable price from yfinance",
        "debug": snapshot,
    }


def fetch_stooq_quote(spec: Dict[str, Any]) -> Dict[str, Any]:
    stooq_symbol = spec.get("stooq_symbol")
    if not stooq_symbol:
        return {
            "source": "stooq",
            "raw_symbol": None,
            "ok": False,
            "status_code": None,
            "response_length": 0,
            "response_snippet": None,
            "row": None,
            "parsed": None,
            "error": "no stooq symbol configured",
        }

    url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&i=d"
    try:
        response = requests.get(url, headers=DEFAULT_HEADERS, timeout=REQUEST_TIMEOUT_SEC)
        text = response.text or ""
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}")
        if "Date" not in text:
            raise RuntimeError("No CSV data returned")

        df = pd.read_csv(pd.io.common.StringIO(text))
        if df.empty or "Close" not in df.columns:
            raise RuntimeError("No usable rows")

        close_series = pd.to_numeric(df["Close"], errors="coerce").dropna()
        if close_series.empty:
            raise RuntimeError("No numeric close values")

        last_close = float(close_series.iloc[-1])
        prev_close = float(close_series.iloc[-2]) if len(close_series) >= 2 else None
        change_pct = None
        if prev_close is not None and prev_close > 0:
            change_pct = round((last_close / prev_close - 1.0) * 100.0, 4)

        return {
            "source": "stooq",
            "raw_symbol": stooq_symbol,
            "ok": True,
            "status_code": response.status_code,
            "response_length": len(text),
            "response_snippet": to_snippet(text, 500),
            "row": None,
            "parsed": {
                "name": spec["name"],
                "price": last_close,
                "change_pct": change_pct,
                "currency": "USD",
            },
            "error": None,
        }
    except Exception as exc:
        return {
            "source": "stooq",
            "raw_symbol": stooq_symbol,
            "ok": False,
            "status_code": getattr(getattr(exc, "response", None), "status_code", None),
            "response_length": 0,
            "response_snippet": None,
            "row": None,
            "parsed": None,
            "error": f"{exc.__class__.__name__}: {exc}",
        }


def build_record_from_attempt(
    spec: Dict[str, Any],
    attempt: Dict[str, Any],
    *,
    as_of: str,
) -> Dict[str, Any]:
    parsed = attempt.get("parsed") or {}
    name = spec["name"]
    price = parse_numeric(parsed.get("price"))
    change_pct = parse_numeric(parsed.get("change_pct"))
    currency = safe_string(parsed.get("currency")) or "USD"

    return {
        "asset_class": spec["asset_class"],
        "symbol": spec["symbol"],
        "name": name,
        "price": price,
        "change_pct": change_pct,
        "source": attempt["source"],
        "as_of": as_of,
        "currency": currency,
        "raw_symbol": attempt.get("raw_symbol"),
    }


def validate_price_record(record: Dict[str, Any]) -> Tuple[str, List[str]]:
    issues: List[str] = []
    status = "valid"

    asset_class = safe_string(record.get("asset_class"))
    symbol = safe_string(record.get("symbol"))
    name = safe_string(record.get("name"))
    price = parse_numeric(record.get("price"))
    change_pct = parse_numeric(record.get("change_pct"))
    source = safe_string(record.get("source"))
    as_of = safe_string(record.get("as_of"))
    currency = safe_string(record.get("currency"))
    raw_symbol = safe_string(record.get("raw_symbol"))

    if asset_class not in ALLOWED_ASSET_CLASSES:
        issues.append("invalid_asset_class")
        return "invalid", issues

    if not symbol:
        issues.append("missing_symbol")
        return "invalid", issues

    if not source:
        issues.append("missing_source")
        return "invalid", issues

    if not as_of:
        issues.append("missing_as_of")
        return "invalid", issues

    if price is None or price <= 0:
        issues.append("invalid_price")
        return "invalid", issues

    if change_pct is None:
        issues.append("missing_change_pct")
        status = "suspicious"
    elif change_pct < -100 or change_pct > 100:
        issues.append("change_pct_out_of_range")
        return "invalid", issues

    if not name:
        issues.append("missing_name")
        status = "suspicious"

    if not currency:
        issues.append("missing_currency")
        status = "suspicious"

    if not raw_symbol:
        issues.append("missing_raw_symbol")
        status = "suspicious"

    return status, issues


def fetch_best_record(spec: Dict[str, Any], session: requests.Session, as_of: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    attempts: List[Dict[str, Any]] = []
    selected_attempt: Optional[Dict[str, Any]] = None

    for candidate in spec.get("tv_candidates", []):
        attempt = fetch_tradingview_scan(
            session,
            market=candidate["market"],
            raw_symbol=candidate["raw_symbol"],
        )
        attempts.append(attempt)
        if attempt.get("ok"):
            selected_attempt = attempt
            break

    if selected_attempt is None:
        yfinance_attempt = fetch_yfinance_quote(spec)
        attempts.append(yfinance_attempt)
        if yfinance_attempt.get("ok"):
            selected_attempt = yfinance_attempt

    if selected_attempt is None:
        stooq_attempt = fetch_stooq_quote(spec)
        attempts.append(stooq_attempt)
        if stooq_attempt.get("ok"):
            selected_attempt = stooq_attempt

    if selected_attempt is not None and selected_attempt.get("source") == "tradingview":
        # Keep TradingView as the primary normalized source, but also probe a fallback source
        # so the raw report captures a real cross-source comparison for this asset.
        yfinance_probe = fetch_yfinance_quote(spec)
        attempts.append(yfinance_probe)

    if selected_attempt is None:
        selected_attempt = {
            "source": "unavailable",
            "raw_symbol": spec["symbol"],
            "parsed": {
                "name": spec["name"],
                "price": None,
                "change_pct": None,
                "currency": None,
            },
            "ok": False,
            "error": f"Could not fetch any price data for {spec['symbol']}",
        }
        attempts.append(selected_attempt)

    raw_record = {
        "asset_class": spec["asset_class"],
        "symbol": spec["symbol"],
        "name": spec["name"],
        "selected_source": selected_attempt["source"],
        "selected_raw_symbol": selected_attempt.get("raw_symbol"),
        "fetch_ok": bool(selected_attempt.get("ok")),
        "fetch_error": selected_attempt.get("error"),
        "source_attempts": attempts,
    }

    normalized = build_record_from_attempt(spec, selected_attempt, as_of=as_of)
    validation_status, validation_issues = validate_price_record(normalized)
    normalized["validation_status"] = validation_status
    normalized["validation_issues"] = validation_issues

    raw_record["normalized"] = normalized
    return raw_record, normalized


def summarize_records(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_asset_class = defaultdict(lambda: {"count": 0, "valid": 0, "suspicious": 0, "invalid": 0})
    by_source = defaultdict(lambda: {"count": 0, "valid": 0, "suspicious": 0, "invalid": 0})
    group_coverage = defaultdict(int)
    source_success = Counter()

    for record in records:
        asset_class = safe_string(record.get("asset_class")) or "unknown"
        source = safe_string(record.get("source")) or "unknown"
        status = safe_string(record.get("validation_status")) or "unknown"

        by_asset_class[asset_class]["count"] += 1
        by_source[source]["count"] += 1
        group_coverage[asset_class] += 1

        if status in by_asset_class[asset_class]:
            by_asset_class[asset_class][status] += 1
        if status in by_source[source]:
            by_source[source][status] += 1
        if status == "valid":
            source_success[source] += 1

    return {
        "records_count": len(records),
        "by_asset_class": dict(sorted(by_asset_class.items())),
        "by_source": dict(sorted(by_source.items())),
        "group_coverage": dict(sorted(group_coverage.items())),
        "source_success": dict(sorted(source_success.items())),
    }


def summarize_attempts(raw_records: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_source = defaultdict(lambda: {"attempts": 0, "success": 0, "fail": 0})
    attempts_count = 0

    for raw_record in raw_records:
        for attempt in raw_record.get("source_attempts", []):
            source = safe_string(attempt.get("source")) or "unknown"
            ok = bool(attempt.get("ok"))
            by_source[source]["attempts"] += 1
            attempts_count += 1
            if ok:
                by_source[source]["success"] += 1
            else:
                by_source[source]["fail"] += 1

    return {
        "attempts_count": attempts_count,
        "by_source": dict(sorted(by_source.items())),
    }


def build_assessment(normalized_records: List[Dict[str, Any]], summary: Dict[str, Any]) -> str:
    asset_groups = {record["asset_class"] for record in normalized_records}
    status_counts = Counter(record.get("validation_status") for record in normalized_records)
    tradingview_success = summary.get("source_success", {}).get("tradingview", 0)
    valid_count = status_counts.get("valid", 0)
    suspicious_count = status_counts.get("suspicious", 0)
    invalid_count = status_counts.get("invalid", 0)

    if len(asset_groups) < len(ALLOWED_ASSET_CLASSES):
        return "FAIL"
    if invalid_count > 0:
        return "PARTIAL"
    if tradingview_success == 0:
        return "PARTIAL"
    if valid_count >= 10 and suspicious_count == 0:
        return "PASS"
    return "PARTIAL"


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_report() -> Dict[str, Any]:
    ensure_dir(output_dir())
    session = make_session()
    as_of = now_iso()

    raw_records: List[Dict[str, Any]] = []
    normalized_records: List[Dict[str, Any]] = []
    group_summary: Dict[str, List[str]] = defaultdict(list)

    for spec in ASSET_SPECS:
        raw_record, normalized = fetch_best_record(spec, session, as_of)
        raw_records.append(raw_record)
        normalized_records.append(normalized)
        group_summary[spec["asset_class"]].append(spec["symbol"])

    raw_summary = summarize_records(normalized_records)
    attempt_summary = summarize_attempts(raw_records)
    normalized_summary = summarize_records(normalized_records)
    assessment = build_assessment(normalized_records, normalized_summary)

    raw_payload = {
        "timestamp": as_of,
        "tested_sources": list(attempt_summary.get("by_source", {}).keys()),
        "tested_asset_groups": ["index", "commodity", "gold", "stock", "etf"],
        "tested_symbols": [spec["symbol"] for spec in ASSET_SPECS],
        "assets": raw_records,
        "summary": raw_summary,
        "attempt_summary": attempt_summary,
    }

    normalized_payload = {
        "timestamp": as_of,
        "records": normalized_records,
        "summary": normalized_summary,
        "assessment": assessment,
    }

    raw_path = output_dir() / RAW_JSON_NAME
    normalized_path = output_dir() / NORMALIZED_JSON_NAME
    write_json(raw_path, raw_payload)
    write_json(normalized_path, normalized_payload)

    return {
        "timestamp": as_of,
        "input": {
            "tested_sources": list(attempt_summary.get("by_source", {}).keys()),
            "tested_asset_groups": ["index", "commodity", "gold", "stock", "etf"],
            "tested_symbols": [spec["symbol"] for spec in ASSET_SPECS],
        },
        "fetch_result": {
            "source_summary": normalized_summary.get("by_source", {}),
            "attempt_summary": attempt_summary,
            "asset_group_summary": normalized_summary.get("by_asset_class", {}),
            "sample_raw_assets": raw_records[:3],
        },
        "normalization_result": {
            "valid_count": normalized_summary.get("by_asset_class", {}).get("index", {}).get("valid", 0)
            + normalized_summary.get("by_asset_class", {}).get("commodity", {}).get("valid", 0)
            + normalized_summary.get("by_asset_class", {}).get("gold", {}).get("valid", 0)
            + normalized_summary.get("by_asset_class", {}).get("stock", {}).get("valid", 0)
            + normalized_summary.get("by_asset_class", {}).get("etf", {}).get("valid", 0),
            "suspicious_count": sum(v.get("suspicious", 0) for v in normalized_summary.get("by_asset_class", {}).values()),
            "invalid_count": sum(v.get("invalid", 0) for v in normalized_summary.get("by_asset_class", {}).values()),
            "records": normalized_records,
        },
        "file": {
            "script": str(Path(__file__).resolve()),
            "saved": {
                "price_feed_raw.json": str(raw_path),
                "price_feed_normalized.json": str(normalized_path),
            },
        },
        "assessment": assessment,
    }


def print_report(report: Dict[str, Any]) -> None:
    print("=== Price Feed Access Test ===")
    print("Input")
    print(f"  tested sources: {', '.join(report['input']['tested_sources'])}")
    print(f"  tested asset groups: {', '.join(report['input']['tested_asset_groups'])}")
    print(f"  tested symbols: {', '.join(report['input']['tested_symbols'])}")
    print("Fetch Result")
    source_summary = report["fetch_result"]["source_summary"]
    print("  selected source summary:")
    for source_name, counts in source_summary.items():
        print(
            f"  {source_name}: total={counts.get('count', 0)} "
            f"valid={counts.get('valid', 0)} suspicious={counts.get('suspicious', 0)} invalid={counts.get('invalid', 0)}"
        )
    attempt_summary = report["fetch_result"].get("attempt_summary", {})
    if attempt_summary:
        print("  source attempts:")
        for source_name, counts in attempt_summary.get("by_source", {}).items():
            print(
                f"    {source_name}: attempts={counts.get('attempts', 0)} "
                f"success={counts.get('success', 0)} fail={counts.get('fail', 0)}"
            )
    print("Normalization Result")
    nr = report["normalization_result"]
    print(f"  valid count: {nr['valid_count']}")
    print(f"  suspicious count: {nr['suspicious_count']}")
    print(f"  invalid count: {nr['invalid_count']}")
    print("File")
    print(f"  Script: {report['file']['script']}")
    for name, path in report["file"]["saved"].items():
        print(f"  Saved: {Path(path)}")
    print("Assessment")
    print(f"  {report['assessment']}")


def main() -> int:
    try:
        report = build_report()
        print_report(report)
        return 0
    except Exception as exc:  # pragma: no cover - top-level guard
        print(f"[ERROR] Price feed access test failed: {exc}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
