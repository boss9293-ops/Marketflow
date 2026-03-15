from __future__ import annotations

import datetime as dt
import os
from typing import Dict, List, Tuple

import requests
from dotenv import load_dotenv

from backend.services.cache_store import CacheStore, SeriesPoint

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
load_dotenv(os.path.join(ROOT_DIR, ".env"))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

FRED_SERIES: Dict[str, str] = {
    "HY_OAS": "BAMLH0A0HYM2",
    "IG_OAS": "BAMLC0A0CM",
    "FSI": "STLFSI4",
    "VIX": "VIXCLS",
    "WALCL": "WALCL",
    "M2SL": "M2SL",
    "RRP": "RRPONTSYD",
    "EFFR": "EFFR",
    "DFII10": "DFII10",
    "DGS2": "DGS2",
    "DGS10": "DGS10",
    "USD_BROAD": "DTWEXBGS",
    "BTC": "CBBTCUSD",
}

META: Dict[str, Dict[str, str]] = {
    "HY_OAS": {"unit": "bp", "freq": "D", "notes": "ICE BofA HY OAS"},
    "IG_OAS": {"unit": "bp", "freq": "D", "notes": "ICE BofA IG OAS"},
    "FSI": {"unit": "index", "freq": "W", "notes": "St. Louis Fed Financial Stress Index"},
    "VIX": {"unit": "index", "freq": "D", "notes": "CBOE VIX close (FRED VIXCLS)"},
    "WALCL": {"unit": "usd", "freq": "W", "notes": "Fed balance sheet"},
    "M2SL": {"unit": "usd", "freq": "M", "notes": "US M2 (monthly)"},
    "RRP": {"unit": "usd", "freq": "D", "notes": "ON RRP (RRPONTSYD)"},
    "EFFR": {"unit": "pct", "freq": "D", "notes": "Effective Fed Funds Rate"},
    "DFII10": {"unit": "pct", "freq": "D", "notes": "10Y TIPS real yield"},
    "DGS2": {"unit": "pct", "freq": "D", "notes": "2Y treasury"},
    "DGS10": {"unit": "pct", "freq": "D", "notes": "10Y treasury"},
    "USD_BROAD": {"unit": "index", "freq": "D", "notes": "Broad dollar index (proxy)"},
    "BTC": {"unit": "usd", "freq": "D", "notes": "Bitcoin price (Coindesk via FRED CBBTCUSD)"},
}


def fetch_fred_series(series_id: str, start_date: str) -> List[Tuple[str, float]]:
    if not FRED_API_KEY:
        raise RuntimeError("FRED_API_KEY is missing in environment variables.")
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": start_date,
    }
    r = requests.get(FRED_BASE, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    out: List[Tuple[str, float]] = []
    for obs in data.get("observations", []):
        d = obs.get("date")
        v = obs.get("value")
        if not d or v in (None, ".", ""):
            continue
        try:
            out.append((d, float(v)))
        except Exception:
            continue
    out.sort(key=lambda x: x[0])
    return out


def run() -> dict:
    store = CacheStore()
    store.init_schema()
    asof = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    start_date = (dt.date.today() - dt.timedelta(days=365 * 4)).isoformat()
    result: Dict[str, Dict[str, str | int]] = {}

    if not FRED_API_KEY:
        msg = "FRED_API_KEY is missing. Set env var FRED_API_KEY before running collect_fred.py"
        for symbol, series_id in FRED_SERIES.items():
            meta = META.get(symbol, {"unit": "", "freq": "", "notes": ""})
            store.upsert_series_meta(
                symbol=symbol,
                source="FRED",
                unit=meta.get("unit", ""),
                freq=meta.get("freq", "D"),
                last_updated=asof,
                quality="NA",
                notes=f"ERROR: {msg}; fred_series_id={series_id}",
            )
            result[symbol] = {"status": "FAIL", "points": 0, "quality": "NA"}
        store.close()
        result["_error"] = {"status": "FAIL", "points": 0, "quality": "NA"}  # type: ignore[assignment]
        return result

    for symbol, series_id in FRED_SERIES.items():
        try:
            rows = fetch_fred_series(series_id, start_date=start_date)
            quality = "OK" if len(rows) > 50 else ("PARTIAL" if len(rows) > 0 else "NA")
            points = [
                SeriesPoint(symbol=symbol, date=d, value=v, source="FRED", asof=asof, quality=quality)
                for d, v in rows
            ]
            store.upsert_series_points(points)
            meta = META.get(symbol, {"unit": "", "freq": "", "notes": ""})
            store.upsert_series_meta(
                symbol=symbol,
                source="FRED",
                unit=meta.get("unit", ""),
                freq=meta.get("freq", "D"),
                last_updated=asof,
                quality=quality,
                notes=f"fred_series_id={series_id}; {meta.get('notes','')}",
            )
            result[symbol] = {"status": "OK", "points": len(points), "quality": quality}
        except Exception as e:
            meta = META.get(symbol, {"unit": "", "freq": "", "notes": ""})
            store.upsert_series_meta(
                symbol=symbol,
                source="FRED",
                unit=meta.get("unit", ""),
                freq=meta.get("freq", "D"),
                last_updated=asof,
                quality="NA",
                notes=f"ERROR: {repr(e)}; fred_series_id={series_id}",
            )
            result[symbol] = {"status": "FAIL", "points": 0, "quality": "NA"}

    store.close()
    return result


def main() -> None:
    res = run()
    if "_error" in res:
        print("FRED collection failed: missing FRED_API_KEY")
    for symbol, info in res.items():
        if symbol.startswith("_"):
            continue
        if info["status"] == "OK":
            print(f"FRED {symbol} stored points={info['points']} quality={info['quality']}")
        else:
            print(f"FRED {symbol} failed quality=NA")
    print("FRED collection done.")


if __name__ == "__main__":
    main()
