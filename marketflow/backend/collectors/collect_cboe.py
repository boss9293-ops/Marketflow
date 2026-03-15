from __future__ import annotations

import datetime as dt
import csv
import os
import sqlite3
from typing import List, Tuple

import requests

from backend.services.cache_store import CacheStore, SeriesPoint

PC_SYMBOL = "PUT_CALL"
VIX_SYMBOL = "VIX"
STOOQ_PC_URL = "https://stooq.com/q/d/l/?s=cboe_pc&i=d"


def _utc_asof() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def fetch_put_call_from_stooq(limit_days: int = 1200) -> List[Tuple[str, float]]:
    r = requests.get(STOOQ_PC_URL, timeout=30)
    r.raise_for_status()
    text = r.text.strip()
    if not text:
        raise RuntimeError("Empty Stooq CSV response for CBOE PC.")
    reader = csv.reader(text.splitlines())
    rows_in = list(reader)
    if len(rows_in) < 2:
        raise RuntimeError("Too few CSV rows from Stooq for CBOE PC.")
    header = [col.strip().lower() for col in rows_in[0]]
    if "date" not in header or "close" not in header:
        raise RuntimeError(f"Unexpected Stooq CSV header for CBOE PC: {rows_in[0]}")
    date_idx = header.index("date")
    close_idx = header.index("close")
    out: List[Tuple[str, float]] = []
    for parts in rows_in[1:]:
        if len(parts) <= max(date_idx, close_idx):
            continue
        d = parts[date_idx].strip()
        close = parts[close_idx].strip()
        if close in ("", "null", "None"):
            continue
        try:
            v = float(close)
        except Exception:
            continue
        out.append((d, v))
    out.sort(key=lambda x: x[0])
    if limit_days and len(out) > limit_days:
        out = out[-limit_days:]
    if len(out) < 50:
        raise RuntimeError("Too few PC points from Stooq.")
    return out


def load_vix_from_market_daily(limit_days: int = 1400) -> List[Tuple[str, float]]:
    db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "data", "marketflow.db")
    db_path = os.path.abspath(db_path)
    if not os.path.exists(db_path):
        return []
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(
            "SELECT date, vix FROM market_daily WHERE vix IS NOT NULL ORDER BY date"
        ).fetchall()
    finally:
        con.close()
    out = [(str(d), float(v)) for d, v in rows if d is not None and v is not None]
    if limit_days and len(out) > limit_days:
        out = out[-limit_days:]
    return out


def compute_proxy_pc_from_vix(vix_series: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    out: List[Tuple[str, float]] = []
    for d, vix in vix_series:
        v = float(vix)
        proxy = 0.65 + 0.03 * min(max(v, 10.0), 60.0)
        proxy = max(0.6, min(proxy, 1.8))
        out.append((d, round(proxy, 4)))
    return out


def upsert_points(store: CacheStore, symbol: str, rows: List[Tuple[str, float]], source: str, quality: str, asof: str) -> int:
    pts = [SeriesPoint(symbol=symbol, date=d, value=v, source=source, asof=asof, quality=quality) for d, v in rows]
    return store.upsert_series_points(pts)


def run() -> dict:
    store = CacheStore()
    store.init_schema()
    asof = _utc_asof()
    try:
        pc_rows = fetch_put_call_from_stooq(limit_days=1400)
        n = upsert_points(store, PC_SYMBOL, pc_rows, source="STOOQ", quality="OK", asof=asof)
        store.upsert_series_meta(
            symbol=PC_SYMBOL,
            source="STOOQ",
            unit="ratio",
            freq="D",
            last_updated=asof,
            quality="OK",
            notes="CBOE put/call ratio via Stooq (close used)",
        )
        store.close()
        return {"written": n, "source": "STOOQ", "quality": "OK"}
    except Exception as e:
        end_date = dt.date.today().isoformat()
        start_date = (dt.date.today() - dt.timedelta(days=365 * 4)).isoformat()
        vix_series = store.get_series_range(VIX_SYMBOL, start_date, end_date)
        if len(vix_series) < 50:
            vix_series = load_vix_from_market_daily(limit_days=1400)
        if len(vix_series) < 50:
            store.upsert_series_meta(
                symbol=PC_SYMBOL,
                source="PROXY",
                unit="ratio",
                freq="D",
                last_updated=asof,
                quality="NA",
                notes=f"PROXY failed: VIX series not available; original error={repr(e)}",
            )
            store.close()
            return {"written": 0, "source": "PROXY", "quality": "NA"}
        proxy_rows = compute_proxy_pc_from_vix(vix_series)
        n = upsert_points(store, PC_SYMBOL, proxy_rows, source="PROXY", quality="PARTIAL", asof=asof)
        store.upsert_series_meta(
            symbol=PC_SYMBOL,
            source="PROXY",
            unit="ratio",
            freq="D",
            last_updated=asof,
            quality="PARTIAL",
            notes=f"PROXY derived from VIX (monotonic mapping). original error={repr(e)}",
        )
        store.close()
        return {"written": n, "source": "PROXY", "quality": "PARTIAL"}


def main() -> None:
    res = run()
    if res["quality"] == "OK":
        print(f"PUT_CALL collected via STOOQ points={res['written']}")
    elif res["quality"] == "PARTIAL":
        print(f"PUT_CALL PROXY stored points={res['written']}")
    else:
        print("PUT_CALL fallback failed (VIX missing). Run collectors/collect_market.py first.")
    print("collect_cboe done.")


if __name__ == "__main__":
    main()
