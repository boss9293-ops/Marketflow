"""
Build health_snapshot.json (cache-only, daily).

Output:
  backend/output/cache/health_snapshot.json
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


def repo_root() -> str:
    # __file__ = /app/scripts/build_health_snapshot.py → parent = /app
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def output_cache_dir() -> str:
    return os.path.join(repo_root(), "output", "cache")


def db_path() -> str:
    try:
        import sys
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from db_utils import resolve_marketflow_db
        return resolve_marketflow_db(required_tables=("ohlcv_daily",), data_plane="live")
    except Exception:
        return os.path.join(repo_root(), "data", "marketflow.db")


def output_dir() -> str:
    return os.path.join(repo_root(), "output")


def load_live_qqq() -> tuple:
    """Return (live_price, live_date) from market_data.json, or (None, None)."""
    p = os.path.join(output_dir(), "market_data.json")
    if not os.path.exists(p):
        return None, None
    try:
        import json as _json
        with open(p, "r", encoding="utf-8") as _f:
            md = _json.load(_f)
        price = md.get("indices", {}).get("QQQ", {}).get("price")
        ts = md.get("timestamp")
        date_str = str(ts)[:10] if ts else None
        if price is not None:
            return float(price), date_str
    except Exception:
        pass
    return None, None


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def safe_mean(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def safe_std(values: List[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    mean = safe_mean(values)
    if mean is None:
        return None
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def percentile(values: List[float], p: float) -> Optional[float]:
    if not values:
        return None
    if p <= 0:
        return min(values)
    if p >= 100:
        return max(values)
    vals = sorted(values)
    k = (len(vals) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return vals[int(k)]
    d0 = vals[f] * (c - k)
    d1 = vals[c] * (k - f)
    return d0 + d1


def fetch_ohlcv(conn: sqlite3.Connection, symbol: str, limit: int = 260) -> List[Tuple[str, float]]:
    rows = conn.execute(
        "SELECT date, close FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT ?",
        (symbol, limit),
    ).fetchall()
    rows = [(r[0], float(r[1])) for r in rows if r[0] and r[1] is not None]
    rows.reverse()
    return rows


def fetch_market_daily(conn: sqlite3.Connection, limit: int = 320) -> List[Tuple[str, Optional[float], Optional[float]]]:
    rows = conn.execute(
        "SELECT date, qqq, vix FROM market_daily ORDER BY date DESC LIMIT ?",
        (limit,),
    ).fetchall()
    rows = [(r[0], r[1], r[2]) for r in rows if r[0]]
    rows.reverse()
    return rows


def calc_sma(values: List[float], window: int) -> Optional[float]:
    if len(values) < window:
        return None
    return sum(values[-window:]) / window


def build_trend(closes: List[float]) -> Dict[str, Any]:
    qqq_close = closes[-1] if closes else None
    sma200 = calc_sma(closes, 200)
    sma50 = calc_sma(closes, 50)
    sma20 = calc_sma(closes, 20)
    dist_pct = None
    if qqq_close is not None and sma200:
        dist_pct = (qqq_close / sma200 - 1) * 100.0
    return {
        "qqq_close": round(qqq_close, 2) if qqq_close is not None else None,
        "sma200": round(sma200, 2) if sma200 is not None else None,
        "dist_pct": round(dist_pct, 2) if dist_pct is not None else None,
        "sma50": round(sma50, 2) if sma50 is not None else None,
        "sma20": round(sma20, 2) if sma20 is not None else None,
    }


def build_risk(closes: List[float]) -> Dict[str, Any]:
    if len(closes) < 30:
        return {
            "var95_1d": None,
            "cvar95_1d": None,
            "ulcer_252d": None,
            "mdd_252d": None,
            "rv20": None,
            "rv252": None,
            "vol_ratio": None,
        }
    returns = [(closes[i] / closes[i - 1] - 1) for i in range(1, len(closes))]
    returns_pct = [r * 100.0 for r in returns]

    var95 = percentile(returns_pct, 5)
    cvar = None
    if var95 is not None:
        tail = [r for r in returns_pct if r <= var95]
        cvar = safe_mean(tail) if tail else None

    # Drawdowns over last 252 days
    closes_252 = closes[-252:] if len(closes) >= 252 else closes[:]
    running_max = -1e9
    dd_pct: List[float] = []
    for c in closes_252:
        running_max = max(running_max, c)
        dd = (c / running_max - 1) * 100.0 if running_max > 0 else 0.0
        dd_pct.append(dd)
    mdd = min(dd_pct) if dd_pct else None
    ulcer = math.sqrt(safe_mean([d * d for d in dd_pct]) or 0.0) if dd_pct else None

    rv20 = None
    rv252 = None
    std20 = safe_std(returns[-20:]) if len(returns) >= 20 else None
    std252 = safe_std(returns[-252:]) if len(returns) >= 252 else safe_std(returns)
    if std20 is not None:
        rv20 = std20 * math.sqrt(252) * 100.0
    if std252 is not None:
        rv252 = std252 * math.sqrt(252) * 100.0
    vol_ratio = (rv20 / rv252) if (rv20 is not None and rv252 and rv252 > 0) else None

    return {
        "var95_1d": round(var95, 2) if var95 is not None else None,
        "cvar95_1d": round(cvar, 2) if cvar is not None else None,
        "ulcer_252d": round(ulcer, 2) if ulcer is not None else None,
        "mdd_252d": round(mdd, 2) if mdd is not None else None,
        "rv20": round(rv20, 2) if rv20 is not None else None,
        "rv252": round(rv252, 2) if rv252 is not None else None,
        "vol_ratio": round(vol_ratio, 2) if vol_ratio is not None else None,
    }


def build_greed_proxy(market_daily: List[Tuple[str, Optional[float], Optional[float]]]) -> Dict[str, Any]:
    if len(market_daily) < 30:
        return {
            "greed_proxy": 50,
            "label": "Neutral",
            "explain": "market_daily data missing/insufficient.\nGreed proxy defaulted to neutral.",
            as_of_date: None,
        }

    dates, qqqs, vixs = zip(*market_daily)
    qqq = [float(x) for x in qqqs if x is not None]
    vix = [float(x) for x in vixs if x is not None]

    if len(qqq) < 21 or len(vix) < 6:
        return {
            "greed_proxy": 50,
            "label": "Neutral",
            "explain": "QQQ/VIX series too short.\nGreed proxy defaulted to neutral.",
            as_of_date: None,
        }

    # Build rolling series for z-scores
    qqq_20d = []
    for i in range(20, len(qqq)):
        qqq_20d.append(qqq[i] / qqq[i - 20] - 1)
    vix_5d = []
    for i in range(5, len(vix)):
        vix_5d.append(vix[i] / vix[i - 5] - 1)

    if not qqq_20d or not vix_5d:
        return {
            "greed_proxy": 50,
            "label": "Neutral",
            "explain": "Rolling series unavailable.\nGreed proxy defaulted to neutral.",
            as_of_date: None,
        }

    qqq_last = qqq_20d[-1]
    vix_last = vix_5d[-1]
    qqq_z = (qqq_last - (safe_mean(qqq_20d) or 0)) / ((safe_std(qqq_20d) or 1) or 1)
    vix_z = (vix_last - (safe_mean(vix_5d) or 0)) / ((safe_std(vix_5d) or 1) or 1)
    score = qqq_z - vix_z
    scaled = max(0.0, min(100.0, (score + 2.0) / 4.0 * 100.0))

    label = "Neutral"
    if scaled >= 65:
        label = "Greed"
    elif scaled <= 35:
        label = "Fear"

    explain = (
        f"QQQ 20D return: {qqq_last*100:.2f}% | VIX 5D change: {vix_last*100:.2f}%\n"
        f"z(qqq_20d)={qqq_z:.2f}, z(vix_5d)={vix_z:.2f}"
    )

    return {
        "greed_proxy": round(scaled, 1),
        "label": label,
        "explain": explain,
        "as_of_date": str(dates[-1]) if dates else None,
    }


def main() -> int:
    db = db_path()
    if not os.path.exists(db):
        print(f"[ERROR] DB not found: {db}")
        return 1

    conn = sqlite3.connect(db)
    try:
        qqq_rows = fetch_ohlcv(conn, "QQQ", limit=260)
        market_daily = fetch_market_daily(conn, limit=320)
    finally:
        conn.close()

    dates = [d for d, _ in qqq_rows]
    closes = [c for _, c in qqq_rows]
    data_date = dates[-1] if dates else None

    # Backfill: append live QQQ price from market_data.json if it is newer
    _live_price, _live_date = load_live_qqq()
    if _live_price is not None and _live_date and (_live_date > data_date if data_date else True):
        closes.append(_live_price)
        data_date = _live_date

    trend = build_trend(closes)
    risk = build_risk(closes)
    greed = build_greed_proxy(market_daily)

    payload = {
        "generated_at": now_iso(),
        "data_date": data_date,
        "trend": trend,
        "risk": risk,
        "breadth_greed": greed,
    }

    out_dir = output_cache_dir()
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "health_snapshot.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[OK] {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
