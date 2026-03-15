from __future__ import annotations

import datetime as dt
import os
from statistics import median
from typing import Dict, List, Tuple

from backend.collectors.collect_fred import FRED_API_KEY, fetch_fred_series
from backend.services.cache_store import CacheStore, SeriesPoint


# Best-effort FRED candidates for broad-money (monthly, local-currency series).
# Missing series are tolerated; aggregator degrades gracefully.
GLOBAL_M2_FRED_SERIES: Dict[str, str] = {
    "US": "M2SL",
    "EZ": "MYAGM2EZM189S",
    "JP": "MYAGM2JPM189S",
    "CN": "MYAGM2CNM189S",
    "GB": "MYAGM2GBM189S",
}


def _utc_asof() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _to_dt(s: str) -> dt.date | None:
    try:
        return dt.datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _mom_by_date(rows: List[Tuple[str, float]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    if len(rows) < 2:
        return out
    for i in range(1, len(rows)):
        d, cur = rows[i]
        prev = rows[i - 1][1]
        if prev == 0:
            continue
        out[d] = (cur - prev) / abs(prev)
    return out


def _upsample_index(
    mom_maps: Dict[str, Dict[str, float]],
    us_rows: List[Tuple[str, float]],
) -> List[Tuple[str, float]]:
    # Build monthly calendar from all available MoM points
    all_dates = sorted({d for m in mom_maps.values() for d in m.keys()})
    if not all_dates:
        # fallback to US M2SL if no aggregate can be computed
        return us_rows

    # Aggregate monthly return by median across available countries
    agg_mom: List[Tuple[str, float]] = []
    for d in all_dates:
        vals = [m[d] for m in mom_maps.values() if d in m]
        if not vals:
            continue
        agg_mom.append((d, float(median(vals))))

    if not agg_mom:
        return us_rows

    # Build synthetic global index from compounded monthly returns
    idx_rows: List[Tuple[str, float]] = []
    level = 100.0
    idx_rows.append((agg_mom[0][0], level))
    for d, mom in agg_mom[1:]:
        level = level * (1.0 + mom)
        idx_rows.append((d, level))

    # Scale synthetic index to latest US M2SL level (display-friendly trillions)
    us_latest = us_rows[-1][1] if us_rows else None
    idx_latest = idx_rows[-1][1] if idx_rows else None
    if us_latest and idx_latest and idx_latest != 0:
        scale = us_latest / idx_latest
        idx_rows = [(d, v * scale) for d, v in idx_rows]

    return idx_rows


def run() -> dict:
    store = CacheStore()
    store.init_schema()
    asof = _utc_asof()
    start_date = (dt.date.today() - dt.timedelta(days=365 * 10)).isoformat()

    if not FRED_API_KEY:
        store.upsert_series_meta(
            symbol="GLOBAL_M2",
            source="FRED_AGG",
            unit="usd",
            freq="M",
            last_updated=asof,
            quality="NA",
            notes="ERROR: FRED_API_KEY missing; global aggregation skipped",
        )
        store.close()
        return {"status": "FAIL", "points": 0, "quality": "NA", "reason": "missing_fred_api_key"}

    fetched: Dict[str, List[Tuple[str, float]]] = {}
    used_ids: List[str] = []
    fail_count = 0
    for cc, sid in GLOBAL_M2_FRED_SERIES.items():
        try:
            rows = fetch_fred_series(sid, start_date=start_date)
            if rows:
                fetched[cc] = rows
                used_ids.append(sid)
        except Exception:
            fail_count += 1
            continue

    us_rows = fetched.get("US", [])
    # Fallback: if live US fetch failed, reuse cached M2SL from cache.db
    if not us_rows:
        try:
            cur = store.conn.execute(
                """
                SELECT date, value
                FROM series_data
                WHERE symbol='M2SL'
                ORDER BY date ASC
                """
            )
            cache_rows = []
            for rr in cur.fetchall():
                d = str(rr[0])
                v = float(rr[1])
                if _to_dt(d) is None:
                    continue
                cache_rows.append((d, v))
            if cache_rows:
                us_rows = cache_rows
        except Exception:
            pass
    if not us_rows:
        store.upsert_series_meta(
            symbol="GLOBAL_M2",
            source="FRED_AGG",
            unit="usd",
            freq="M",
            last_updated=asof,
            quality="NA",
            notes="ERROR: US M2SL unavailable; cannot build GLOBAL_M2",
        )
        store.close()
        return {"status": "FAIL", "points": 0, "quality": "NA", "reason": "us_m2_missing"}

    # Build MoM maps from available countries (including US)
    mom_maps: Dict[str, Dict[str, float]] = {cc: _mom_by_date(rows) for cc, rows in fetched.items()}
    global_rows = _upsample_index(mom_maps, us_rows)

    quality = "OK"
    contributors = len([cc for cc, rows in fetched.items() if len(rows) >= 24])
    if "US" not in fetched and us_rows:
        # Built using cached US baseline only
        quality = "PARTIAL"
    if contributors < 2:
        quality = "PARTIAL"
    if len(global_rows) < 24:
        quality = "PARTIAL"

    pts = [
        SeriesPoint(
            symbol="GLOBAL_M2",
            date=d,
            value=float(v),
            source="FRED_AGG",
            asof=asof,
            quality=quality,
        )
        for d, v in global_rows
        if _to_dt(d) is not None
    ]
    n = store.upsert_series_points(pts)
    notes = (
        f"aggregate=median_mom_compound; contributor_count={contributors}; "
        f"series_ids={','.join(used_ids)}; failed={fail_count}; "
        "fallback=US_M2SL_if_insufficient"
    )
    store.upsert_series_meta(
        symbol="GLOBAL_M2",
        source="FRED_AGG",
        unit="usd",
        freq="M",
        last_updated=asof,
        quality=quality,
        notes=notes,
    )
    store.close()
    return {"status": "OK", "points": n, "quality": quality, "contributors": contributors}


def main() -> None:
    print(run())


if __name__ == "__main__":
    main()
