from __future__ import annotations

import datetime as dt
from typing import Dict, List, Tuple

import requests

from backend.services.cache_store import CacheStore, SeriesPoint


STOOQ_BASE = "https://stooq.com/q/d/l/"

# symbol -> stooq ticker
STOOQ_TICKERS: Dict[str, str] = {
    "QQQ": "qqq.us",
    "TQQQ": "tqqq.us",
    "SPY": "spy.us",
    "GLD": "gld.us",
    "HYG": "hyg.us",
    "LQD": "lqd.us",
}


def _utc_asof() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _fetch_stooq_close_series(ticker: str, limit_days: int = 2200) -> List[Tuple[str, float]]:
    r = requests.get(STOOQ_BASE, params={"s": ticker, "i": "d"}, timeout=30)
    r.raise_for_status()
    text = r.text.strip()
    if "date,open,high,low,close,volume" not in text.lower():
        raise RuntimeError(f"Unexpected Stooq CSV format: {ticker}")

    out: List[Tuple[str, float]] = []
    lines = text.splitlines()
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        d = parts[0].strip()
        close = parts[4].strip()
        if not d or close in ("", "null", "None"):
            continue
        try:
            out.append((d, float(close)))
        except Exception:
            continue
    out.sort(key=lambda x: x[0])
    if limit_days and len(out) > limit_days:
        out = out[-limit_days:]
    return out


def _upsert_series(store: CacheStore, symbol: str, rows: List[Tuple[str, float]], source: str, quality: str, asof: str, notes: str = "") -> int:
    pts = [SeriesPoint(symbol=symbol, date=d, value=v, source=source, asof=asof, quality=quality) for d, v in rows]
    n = store.upsert_series_points(pts)
    store.upsert_series_meta(
        symbol=symbol,
        source=source,
        unit="usd",
        freq="D",
        last_updated=asof,
        quality=quality,
        notes=notes,
    )
    return n


def run() -> dict:
    store = CacheStore()
    store.init_schema()
    asof = _utc_asof()

    result: Dict[str, Dict[str, str | int]] = {}
    total_written = 0

    for symbol, ticker in STOOQ_TICKERS.items():
        try:
            rows = _fetch_stooq_close_series(ticker)
            quality = "OK" if len(rows) >= 250 else ("PARTIAL" if len(rows) > 0 else "NA")
            n = _upsert_series(
                store=store,
                symbol=symbol,
                rows=rows,
                source="STOOQ",
                quality=quality,
                asof=asof,
                notes=f"ticker={ticker}",
            )
            total_written += n
            result[symbol] = {"status": "OK", "points": n, "quality": quality}
        except Exception as exc:
            store.upsert_series_meta(
                symbol=symbol,
                source="STOOQ",
                unit="usd",
                freq="D",
                last_updated=asof,
                quality="NA",
                notes=f"ERROR: {repr(exc)}; ticker={ticker}",
            )
            result[symbol] = {"status": "FAIL", "points": 0, "quality": "NA"}

    store.close()
    return {"written": total_written, "symbols": list(STOOQ_TICKERS.keys()), "details": result}


if __name__ == "__main__":
    print(run())
