from __future__ import annotations

import json
import math
import os
import re
import shutil
import sqlite3
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import requests
import yfinance as yf

from backend.services.cache_store import resolve_db_path


REQUEST_TIMEOUT_SEC = 20
TV_SCAN_COLUMNS = ["name", "close", "change", "volume", "exchange", "type", "description"]
ALLOWED_ASSET_CLASSES = {"index", "macro", "etf", "stock"}
TV_SOURCE_NAME = "tradingview"
YF_SOURCE_NAME = "yahoo"

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
OUTPUT_CACHE_DIR = BACKEND_DIR / "output" / "cache"
YF_TZ_CACHE_DIR = Path(tempfile.gettempdir()) / "marketflow_yfinance_cache"

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


def _spec(
    asset_class: str,
    symbol: str,
    name: str,
    tv_candidates: Sequence[Tuple[str, str]],
    yahoo_symbol: str,
    *,
    yahoo_price_multiplier: float = 1.0,
    price_precision: int = 2,
) -> Dict[str, Any]:
    return {
        "asset_class": asset_class,
        "symbol": symbol,
        "name": name,
        "tv_candidates": [{"market": market, "raw_symbol": raw_symbol} for market, raw_symbol in tv_candidates],
        "yahoo_symbol": yahoo_symbol,
        "yahoo_price_multiplier": float(yahoo_price_multiplier),
        "price_precision": int(price_precision),
    }


CORE_ASSET_SPECS: List[Dict[str, Any]] = [
    _spec("index", "SPX", "S&P 500", [("america", "SP:SPX"), ("indices", "SP:SPX"), ("global", "SP:SPX")], "^GSPC"),
    _spec("index", "NDX", "Nasdaq 100", [("america", "NASDAQ:NDX"), ("indices", "NASDAQ:NDX"), ("global", "NASDAQ:NDX")], "^NDX"),
    _spec("index", "IXIC", "Nasdaq Composite", [("america", "NASDAQ:IXIC"), ("indices", "NASDAQ:IXIC"), ("global", "NASDAQ:IXIC")], "^IXIC"),
    _spec("index", "RUT", "Russell 2000", [("america", "TVC:RUT"), ("indices", "TVC:RUT"), ("cfd", "TVC:RUT")], "^RUT"),
    _spec("macro", "VIX", "CBOE Volatility Index", [("america", "TVC:VIX"), ("cfd", "TVC:VIX"), ("indices", "TVC:VIX")], "^VIX"),
    _spec(
        "macro",
        "US10Y",
        "U.S. 10Y Treasury Yield",
        [("bonds", "TVC:US10Y"), ("cfd", "TVC:US10Y"), ("america", "TVC:US10Y")],
        "^TNX",
        yahoo_price_multiplier=0.1,
        price_precision=4,
    ),
    _spec("macro", "DXY", "U.S. Dollar Index", [("cfd", "TVC:DXY"), ("america", "TVC:DXY"), ("indices", "TVC:DXY")], "DX-Y.NYB"),
    _spec("macro", "WTI", "WTI Crude Oil", [("futures", "NYMEX:CL1!"), ("cfd", "TVC:USOIL"), ("america", "NYMEX:CL1!")], "CL=F"),
    _spec("macro", "GOLD", "Gold Spot", [("cfd", "TVC:GOLD"), ("futures", "COMEX:GC1!"), ("america", "COMEX:GC1!")], "GC=F"),
    _spec("etf", "SPY", "SPDR S&P 500 ETF Trust", [("america", "AMEX:SPY"), ("america", "NYSEARCA:SPY")], "SPY"),
    _spec("etf", "QQQ", "Invesco QQQ Trust", [("america", "NASDAQ:QQQ")], "QQQ"),
    _spec("etf", "TQQQ", "ProShares UltraPro QQQ", [("america", "NASDAQ:TQQQ")], "TQQQ"),
    _spec("etf", "SOXL", "Direxion Daily Semiconductor Bull 3X Shares", [("america", "AMEX:SOXL"), ("america", "NYSEARCA:SOXL")], "SOXL"),
    _spec("etf", "SMH", "VanEck Semiconductor ETF", [("america", "AMEX:SMH"), ("america", "NYSEARCA:SMH"), ("america", "NASDAQ:SMH")], "SMH"),
    _spec("stock", "NVDA", "NVIDIA", [("america", "NASDAQ:NVDA")], "NVDA"),
    _spec("stock", "MSFT", "Microsoft", [("america", "NASDAQ:MSFT")], "MSFT"),
    _spec("stock", "AAPL", "Apple", [("america", "NASDAQ:AAPL")], "AAPL"),
    _spec("stock", "AMZN", "Amazon", [("america", "NASDAQ:AMZN")], "AMZN"),
    _spec("stock", "META", "Meta Platforms", [("america", "NASDAQ:META")], "META"),
]


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def safe_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = normalize_whitespace(str(value))
    return text or None


def parse_numeric(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)

    text = normalize_whitespace(str(value))
    if not text:
        return None

    lowered = text.casefold()
    if lowered in {"-", "--", "none", "nan", "n/a", "na"}:
        return None

    text = text.replace(",", "").replace("%", "")
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    if text.startswith("(") and text.endswith(")"):
        text = f"-{text[1:-1]}"

    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def round_value(value: Optional[float], precision: int = 2) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), precision)


def to_snippet(value: Any, limit: int = 240) -> str:
    text = normalize_whitespace(str(value))
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def ensure_ascii_cert_bundle() -> None:
    if os.name != "nt":
        return
    try:
        import certifi  # type: ignore

        ascii_cert = Path("d:/tmp/cacert.pem")
        ascii_cert.parent.mkdir(parents=True, exist_ok=True)
        if not ascii_cert.exists():
            shutil.copy2(certifi.where(), ascii_cert)
        for env_key in ("SSL_CERT_FILE", "CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE"):
            os.environ.setdefault(env_key, str(ascii_cert))
    except Exception:
        pass


def ensure_yfinance_cache() -> None:
    try:
        ensure_dir(YF_TZ_CACHE_DIR)
        yf.set_tz_cache_location(str(YF_TZ_CACHE_DIR))
    except Exception:
        pass


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(TRADINGVIEW_HEADERS)
    return session


def open_db(db_path: Optional[str] = None) -> sqlite3.Connection:
    resolved = resolve_db_path(db_path)
    ensure_dir(Path(resolved).parent)
    conn = sqlite3.connect(resolved, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
    except Exception:
        pass
    try:
        conn.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        pass
    try:
        conn.execute("PRAGMA busy_timeout=30000;")
    except Exception:
        pass
    return conn


def ensure_core_db_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS core_price_snapshot (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          asset_class TEXT NOT NULL,
          name TEXT,
          price REAL NOT NULL,
          change_pct REAL NOT NULL,
          source TEXT NOT NULL,
          as_of TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          raw_symbol TEXT,
          currency TEXT,
          validation_status TEXT,
          validation_issues TEXT,
          UNIQUE(symbol, as_of)
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_core_price_snapshot_symbol_as_of ON core_price_snapshot(symbol, as_of);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_core_price_snapshot_as_of ON core_price_snapshot(as_of);")
    conn.commit()


def ensure_movers_db_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS movers_snapshot (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          rank INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          name TEXT,
          price REAL NOT NULL,
          change_pct REAL NOT NULL,
          volume REAL,
          relative_volume_10d_calc REAL,
          exchange TEXT,
          instrument_type TEXT,
          source TEXT NOT NULL,
          as_of TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          raw_symbol TEXT,
          validation_status TEXT,
          validation_issues TEXT,
          UNIQUE(category, symbol, as_of)
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_movers_snapshot_category_as_of ON movers_snapshot(category, as_of);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_movers_snapshot_symbol_as_of ON movers_snapshot(symbol, as_of);")
    conn.commit()


def detect_blocking(status_code: Optional[int], body: str, has_data: bool = False) -> Tuple[bool, List[str]]:
    signals: List[str] = []
    body_lc = normalize_whitespace(body).casefold()

    if status_code in {403, 429, 503}:
        signals.append(f"status_code_{status_code}")

    for phrase in (
        "captcha",
        "recaptcha",
        "access denied",
        "cloudflare",
        "attention required",
        "verify you are human",
        "security check",
        "ddos protection",
        "cf-chl",
    ):
        if phrase in body_lc:
            signals.append(phrase)

    if not has_data and body_lc and len(body_lc) < 120:
        signals.append("short_body_no_data")

    deduped: List[str] = []
    for item in signals:
        if item not in deduped:
            deduped.append(item)
    return bool(deduped), deduped


def _row_value(values: Sequence[Any], index: int) -> Any:
    if index < 0 or index >= len(values):
        return None
    return values[index]


def fetch_tradingview_quote(
    session: requests.Session,
    *,
    market: str,
    raw_symbol: str,
    spec: Dict[str, Any],
) -> Dict[str, Any]:
    url = f"https://scanner.tradingview.com/{market}/scan"
    payload = {
        "symbols": {"tickers": [raw_symbol], "query": {"types": []}},
        "columns": TV_SCAN_COLUMNS,
        "options": {"lang": "en"},
    }

    try:
        response = session.post(url, json=payload, timeout=REQUEST_TIMEOUT_SEC)
        text = response.text or ""
        data: Dict[str, Any] = {}
        if text.strip().startswith("{"):
            try:
                data = response.json()
            except Exception:
                data = json.loads(text)

        rows = data.get("data") if isinstance(data, dict) else []
        row = rows[0] if rows else None
        values = row.get("d") if isinstance(row, dict) else []
        values = values or []
        has_data = isinstance(row, dict) and bool(values)
        blocked, block_reasons = detect_blocking(response.status_code, text, has_data=has_data)

        parsed: Optional[Dict[str, Any]] = None
        if has_data:
            parsed = {
                "name": safe_string(_row_value(values, 6)) or safe_string(_row_value(values, 0)) or spec["name"],
                "price": parse_numeric(_row_value(values, 1)),
                "change_pct": parse_numeric(_row_value(values, 2)),
                "volume": parse_numeric(_row_value(values, 3)),
                "exchange": safe_string(_row_value(values, 4)),
                "instrument_type": safe_string(_row_value(values, 5)),
                "description": safe_string(_row_value(values, 6)),
            }

        price = parse_numeric(parsed.get("price")) if parsed else None
        ok = bool(
            response.status_code == 200
            and parsed is not None
            and price is not None
            and price > 0
            and not blocked
        )

        return {
            "source": TV_SOURCE_NAME,
            "market": market,
            "raw_symbol": raw_symbol,
            "ok": ok,
            "blocked": blocked,
            "block_reasons": block_reasons,
            "status_code": response.status_code,
            "response_length": len(text),
            "response_snippet": None if ok else to_snippet(text, 500),
            "parsed": parsed,
            "error": None if ok else ("blocked" if blocked else "no parsed row"),
        }
    except requests.RequestException as exc:
        return {
            "source": TV_SOURCE_NAME,
            "market": market,
            "raw_symbol": raw_symbol,
            "ok": False,
            "blocked": False,
            "block_reasons": [],
            "status_code": getattr(getattr(exc, "response", None), "status_code", None),
            "response_length": 0,
            "response_snippet": None,
            "parsed": None,
            "error": f"{exc.__class__.__name__}: {exc}",
        }
    except Exception as exc:
        return {
            "source": TV_SOURCE_NAME,
            "market": market,
            "raw_symbol": raw_symbol,
            "ok": False,
            "blocked": False,
            "block_reasons": [],
            "status_code": None,
            "response_length": 0,
            "response_snippet": None,
            "parsed": None,
            "error": f"{exc.__class__.__name__}: {exc}",
        }


def fetch_yahoo_quote(spec: Dict[str, Any]) -> Dict[str, Any]:
    ensure_yfinance_cache()
    yahoo_symbol = spec["yahoo_symbol"]
    multiplier = float(spec.get("yahoo_price_multiplier") or 1.0)
    ticker = yf.Ticker(yahoo_symbol)

    history_tail: List[Dict[str, Any]] = []
    fast_info: Dict[str, Any] = {}
    price = None
    prev_close = None
    currency = None
    name = spec["name"]

    try:
        hist = ticker.history(period="5d", interval="1d", auto_adjust=False, actions=False)
        if hist is not None and not hist.empty:
            tail = hist.tail(5).copy()
            for idx, row in tail.iterrows():
                ts = getattr(idx, "to_pydatetime", lambda: idx)()
                if hasattr(ts, "strftime"):
                    date_value = ts.strftime("%Y-%m-%d")
                else:
                    date_value = str(ts)
                history_tail.append(
                    {
                        "date": date_value,
                        "close": parse_numeric(row.get("Close")),
                        "adj_close": parse_numeric(row.get("Adj Close")),
                        "volume": parse_numeric(row.get("Volume")),
                    }
                )
            closes = [parse_numeric(item.get("close")) for item in history_tail]
            closes = [float(v) for v in closes if v is not None]
            if closes:
                price = closes[-1]
            if len(closes) >= 2:
                prev_close = closes[-2]
    except Exception as exc:
        history_tail = [{"error": f"{exc.__class__.__name__}: {exc}"}]

    try:
        raw_fast_info = getattr(ticker, "fast_info", None)
        if raw_fast_info is not None:
            try:
                fast_info = dict(raw_fast_info)
            except Exception:
                try:
                    fast_info = {key: raw_fast_info[key] for key in raw_fast_info.keys()}
                except Exception:
                    fast_info = {}
        price = price if price is not None else parse_numeric(fast_info.get("lastPrice"))
        if price is None:
            price = parse_numeric(fast_info.get("regularMarketPrice"))
        if prev_close is None:
            prev_close = parse_numeric(fast_info.get("previousClose"))
        if prev_close is None:
            prev_close = parse_numeric(fast_info.get("regularMarketPreviousClose"))
        currency = safe_string(fast_info.get("currency"))
        name = (
            safe_string(fast_info.get("longName"))
            or safe_string(fast_info.get("shortName"))
            or safe_string(fast_info.get("symbol"))
            or spec["name"]
        )
    except Exception as exc:
        fast_info = {"error": f"{exc.__class__.__name__}: {exc}"}

    if price is not None:
        price = float(price) * multiplier
    if prev_close is not None:
        prev_close = float(prev_close) * multiplier

    change_pct = None
    if price is not None and prev_close is not None and prev_close > 0:
        change_pct = round(((price / prev_close) - 1.0) * 100.0, 4)

    ok = price is not None and price > 0
    return {
        "source": YF_SOURCE_NAME,
        "market": None,
        "raw_symbol": yahoo_symbol,
        "ok": ok,
        "blocked": False,
        "block_reasons": [],
        "status_code": None,
        "response_length": None,
        "response_snippet": {
            "history_tail": history_tail,
            "fast_info_keys": sorted([str(k) for k in fast_info.keys()])[:30] if isinstance(fast_info, dict) else [],
        },
        "parsed": {
            "name": name,
            "price": round_value(price, 4 if spec.get("price_precision") == 4 else 2),
            "change_pct": round_value(change_pct, 4 if spec.get("price_precision") == 4 else 2),
            "volume": parse_numeric(fast_info.get("volume")),
            "exchange": safe_string(fast_info.get("exchange")),
            "instrument_type": safe_string(fast_info.get("quoteType")),
            "description": name,
            "currency": currency,
        },
        "error": None if ok else "no usable price from yfinance",
    }


def build_core_record(spec: Dict[str, Any], attempt: Dict[str, Any], *, as_of: str) -> Dict[str, Any]:
    parsed = attempt.get("parsed") or {}
    precision = int(spec.get("price_precision") or 2)
    price = round_value(parse_numeric(parsed.get("price")), precision)
    change_pct = round_value(parse_numeric(parsed.get("change_pct")), 4 if precision > 2 else 2)

    return {
        "asset_class": spec["asset_class"],
        "symbol": spec["symbol"],
        "name": safe_string(parsed.get("name")) or spec["name"],
        "price": price,
        "change_pct": change_pct,
        "source": attempt.get("source"),
        "as_of": as_of,
        "currency": safe_string(parsed.get("currency")),
        "raw_symbol": attempt.get("raw_symbol"),
        "exchange": safe_string(parsed.get("exchange")),
        "instrument_type": safe_string(parsed.get("instrument_type")),
    }


def validate_core_record(record: Dict[str, Any]) -> Tuple[str, List[str]]:
    issues: List[str] = []
    status = "valid"

    asset_class = safe_string(record.get("asset_class"))
    symbol = safe_string(record.get("symbol"))
    source = safe_string(record.get("source"))
    as_of = safe_string(record.get("as_of"))
    price = parse_numeric(record.get("price"))
    change_pct = parse_numeric(record.get("change_pct"))

    if asset_class not in ALLOWED_ASSET_CLASSES:
        return "invalid", ["invalid_asset_class"]
    if not symbol:
        return "invalid", ["missing_symbol"]
    if not source:
        return "invalid", ["missing_source"]
    if not as_of:
        return "invalid", ["missing_as_of"]
    if price is None or price <= 0:
        return "invalid", ["invalid_price"]

    if change_pct is None:
        issues.append("missing_change_pct")
        status = "suspicious"
    elif not math.isfinite(float(change_pct)):
        return "invalid", ["invalid_change_pct"]
    elif change_pct < -100 or change_pct > 100:
        return "invalid", ["change_pct_out_of_range"]

    if not safe_string(record.get("name")):
        issues.append("missing_name")
        status = "suspicious"

    if not safe_string(record.get("raw_symbol")):
        issues.append("missing_raw_symbol")
        status = "suspicious"

    return status, issues


def fetch_core_price(
    spec: Dict[str, Any],
    session: Optional[requests.Session] = None,
    *,
    as_of: Optional[str] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    as_of = as_of or now_iso()
    session = session or make_session()
    attempts: List[Dict[str, Any]] = []
    selected_attempt: Optional[Dict[str, Any]] = None

    for candidate in spec.get("tv_candidates", []):
        attempt = fetch_tradingview_quote(
            session,
            market=candidate["market"],
            raw_symbol=candidate["raw_symbol"],
            spec=spec,
        )
        attempts.append(attempt)
        if attempt.get("ok"):
            selected_attempt = attempt
            break

    if selected_attempt is None:
        yahoo_attempt = fetch_yahoo_quote(spec)
        attempts.append(yahoo_attempt)
        if yahoo_attempt.get("ok"):
            selected_attempt = yahoo_attempt

    if selected_attempt is None and attempts:
        selected_attempt = attempts[-1]

    if selected_attempt is None:
        selected_attempt = {
            "source": "unavailable",
            "raw_symbol": spec["symbol"],
            "ok": False,
            "parsed": {
                "name": spec["name"],
                "price": None,
                "change_pct": None,
                "currency": None,
                "exchange": None,
                "instrument_type": None,
            },
            "error": f"Could not fetch {spec['symbol']}",
        }
        attempts.append(selected_attempt)

    raw_record = {
        "asset_class": spec["asset_class"],
        "symbol": spec["symbol"],
        "name": spec["name"],
        "selected_source": selected_attempt.get("source"),
        "selected_raw_symbol": selected_attempt.get("raw_symbol"),
        "fetch_ok": bool(selected_attempt.get("ok")),
        "fetch_error": selected_attempt.get("error"),
        "source_attempts": attempts,
    }

    normalized = build_core_record(spec, selected_attempt, as_of=as_of)
    validation_status, validation_issues = validate_core_record(normalized)
    normalized["validation_status"] = validation_status
    normalized["validation_issues"] = validation_issues
    return raw_record, normalized


def summarize_records(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_asset_class = defaultdict(lambda: {"count": 0, "valid": 0, "suspicious": 0, "invalid": 0})
    by_source = defaultdict(lambda: {"count": 0, "valid": 0, "suspicious": 0, "invalid": 0})
    status_counts = Counter()
    source_counts = Counter()

    for record in records:
        asset_class = safe_string(record.get("asset_class")) or "unknown"
        source = safe_string(record.get("source")) or "unknown"
        status = safe_string(record.get("validation_status")) or "unknown"

        by_asset_class[asset_class]["count"] += 1
        by_source[source]["count"] += 1
        status_counts[status] += 1
        source_counts[source] += 1

        if status in by_asset_class[asset_class]:
            by_asset_class[asset_class][status] += 1
        if status in by_source[source]:
            by_source[source][status] += 1

    return {
        "total": len(records),
        "valid": status_counts.get("valid", 0),
        "suspicious": status_counts.get("suspicious", 0),
        "invalid": status_counts.get("invalid", 0),
        "by_asset_class": dict(sorted(by_asset_class.items())),
        "by_source": dict(sorted(by_source.items())),
        "tradingview_success_count": source_counts.get(TV_SOURCE_NAME, 0),
        "yahoo_fallback_count": source_counts.get(YF_SOURCE_NAME, 0),
        "source_fail_count": source_counts.get("unavailable", 0),
    }


def collect_core_prices(
    specs: Optional[Sequence[Dict[str, Any]]] = None,
    *,
    as_of: Optional[str] = None,
    session: Optional[requests.Session] = None,
) -> Dict[str, Any]:
    specs = list(specs or CORE_ASSET_SPECS)
    as_of = as_of or now_iso()
    session = session or make_session()

    raw_records: List[Dict[str, Any]] = []
    normalized_records: List[Dict[str, Any]] = []

    for spec in specs:
        raw_record, normalized = fetch_core_price(spec, session, as_of=as_of)
        raw_records.append(raw_record)
        normalized_records.append(normalized)

    summary = summarize_records(normalized_records)
    return {
        "as_of": as_of,
        "specs": specs,
        "raw_records": raw_records,
        "records": normalized_records,
        "summary": summary,
        "fetch_summary": {
            "tradingview_success_count": summary.get("tradingview_success_count", 0),
            "yahoo_fallback_count": summary.get("yahoo_fallback_count", 0),
            "source_fail_count": summary.get("source_fail_count", 0),
        },
    }


def _upsert_rows(
    conn: sqlite3.Connection,
    *,
    table_name: str,
    conflict_key: Tuple[str, ...],
    rows: Iterable[Tuple[Dict[str, Any], Dict[str, Any]]],
    insert_columns: Sequence[str],
    update_columns: Sequence[str],
) -> Dict[str, Any]:
    inserted = 0
    updated = 0
    duplicates = 0
    rows_written = 0

    cur = conn.cursor()
    conflict_cols = ",".join(conflict_key)
    update_sql = ", ".join(f"{col}=excluded.{col}" for col in update_columns)
    placeholders = ",".join("?" for _ in insert_columns)
    insert_sql = f"""
        INSERT INTO {table_name} ({",".join(insert_columns)})
        VALUES ({placeholders})
        ON CONFLICT({conflict_cols}) DO UPDATE SET
          {update_sql}
    """

    for record, keys in rows:
        where_clause = " AND ".join(f"{col}=?" for col in conflict_key)
        lookup_values = [keys[col] for col in conflict_key]
        existing = cur.execute(
            f"SELECT 1 FROM {table_name} WHERE {where_clause} LIMIT 1",
            lookup_values,
        ).fetchone()
        existed = existing is not None

        values = [record.get(column) for column in insert_columns]
        cur.execute(insert_sql, values)
        rows_written += 1
        if existed:
            updated += 1
            duplicates += 1
        else:
            inserted += 1

    conn.commit()
    row_count_row = cur.execute(f"SELECT COUNT(*) AS c FROM {table_name}").fetchone()
    row_count = int(row_count_row["c"] if row_count_row else 0)
    return {
        "inserted": inserted,
        "updated": updated,
        "duplicates": duplicates,
        "rows_written": rows_written,
        "row_count": row_count,
    }


def upsert_core_price_records(conn: sqlite3.Connection, records: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    ensure_core_db_schema(conn)
    now = now_iso()
    prepared: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for record in records:
        prepared.append(
            (
                {
                    "symbol": safe_string(record.get("symbol")),
                    "asset_class": safe_string(record.get("asset_class")),
                    "name": safe_string(record.get("name")),
                    "price": parse_numeric(record.get("price")),
                    "change_pct": parse_numeric(record.get("change_pct")),
                    "source": safe_string(record.get("source")),
                    "as_of": safe_string(record.get("as_of")),
                    "fetched_at": now,
                    "raw_symbol": safe_string(record.get("raw_symbol")),
                    "currency": safe_string(record.get("currency")),
                    "validation_status": safe_string(record.get("validation_status")),
                    "validation_issues": json.dumps(record.get("validation_issues", []), ensure_ascii=False),
                },
                {
                    "symbol": safe_string(record.get("symbol")),
                    "as_of": safe_string(record.get("as_of")),
                },
            )
        )

    return _upsert_rows(
        conn,
        table_name="core_price_snapshot",
        conflict_key=("symbol", "as_of"),
        rows=prepared,
        insert_columns=[
            "symbol",
            "asset_class",
            "name",
            "price",
            "change_pct",
            "source",
            "as_of",
            "fetched_at",
            "raw_symbol",
            "currency",
            "validation_status",
            "validation_issues",
        ],
        update_columns=[
            "asset_class",
            "name",
            "price",
            "change_pct",
            "source",
            "fetched_at",
            "raw_symbol",
            "currency",
            "validation_status",
            "validation_issues",
        ],
    )


def read_back_core_rows(conn: sqlite3.Connection, *, limit: int = 5) -> List[Dict[str, Any]]:
    ensure_core_db_schema(conn)
    rows = conn.execute(
        """
        SELECT symbol, asset_class, name, price, change_pct, source, as_of, fetched_at, raw_symbol, currency, validation_status
        FROM core_price_snapshot
        ORDER BY as_of DESC, symbol ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(row) for row in rows]


def build_core_cache_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    records = result.get("records", [])
    summary = result.get("summary", {})
    return {
        "generated_at": now_iso(),
        "as_of": result.get("as_of"),
        "snapshot_type": "core_price_snapshot",
        "source_priority": [TV_SOURCE_NAME, YF_SOURCE_NAME],
        "record_count": len(records),
        "records": records,
        "summary": summary,
    }


ensure_ascii_cert_bundle()
