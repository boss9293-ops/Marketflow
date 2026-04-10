"""
Build action_snapshot.json (cache-only, daily).

Output:
  backend/output/cache/action_snapshot.json
"""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def output_cache_dir() -> str:
    return os.path.join(repo_root(), "output", "cache")


def output_dir() -> str:
    return os.path.join(repo_root(), "output")


def db_path() -> str:
    try:
        import sys
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from db_utils import resolve_marketflow_db
        return resolve_marketflow_db(required_tables=("ohlcv_daily",), data_plane="live")
    except Exception:
        return os.path.join(repo_root(), "data", "marketflow.db")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_json(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def parse_number(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if not isinstance(v, str):
        return None
    t = v.strip()
    if not t:
        return None
    t = t.replace(",", "").replace("$", "").replace("%", "")
    if t.startswith("(") and t.endswith(")"):
        t = "-" + t[1:-1]
    try:
        return float(t)
    except Exception:
        return None


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


def load_market_state() -> Dict[str, Any]:
    p = os.path.join(output_cache_dir(), "market_state.json")
    return load_json(p) or {}


def load_health_snapshot() -> Dict[str, Any]:
    p = os.path.join(output_cache_dir(), "health_snapshot.json")
    return load_json(p) or {}


def is_risk_high(market_state: Dict[str, Any], health: Dict[str, Any]) -> bool:
    risk = (market_state or {}).get("risk", {})
    value = str(risk.get("value", "") or risk.get("label", "")).upper()
    if "HIGH" in value:
        return True
    vol_ratio = (health or {}).get("risk", {}).get("vol_ratio")
    try:
        return float(vol_ratio) >= 1.2
    except Exception:
        return False


def trend_strong(health: Dict[str, Any]) -> bool:
    t = (health or {}).get("trend", {})
    try:
        close = float(t.get("qqq_close"))
        sma200 = float(t.get("sma200"))
        dist = float(t.get("dist_pct"))
        return close > sma200 and dist > 2.0
    except Exception:
        return False


def build_exposure_guidance(market_state: Dict[str, Any], health: Dict[str, Any]) -> Dict[str, Any]:
    high_risk = is_risk_high(market_state, health)
    strong = trend_strong(health)

    if high_risk:
        label = "Reduce"
        band = "20–40%"
        vr = (health or {}).get("risk", {}).get("vol_ratio")
        reason = "Risk HIGH or vol ratio elevated"
        if isinstance(vr, (int, float)):
            reason = f"Vol ratio {vr:.2f} (risk high)"
    elif strong:
        label = "Increase"
        band = "60–90%"
        dist = (health or {}).get("trend", {}).get("dist_pct")
        reason = "QQQ above SMA200 with strong distance"
        if isinstance(dist, (int, float)):
            reason = f"QQQ > SMA200 by {dist:.2f}%"
    else:
        label = "Hold"
        band = "40–70%"
        reason = "Mixed trend/risk signals"

    return {"action_label": label, "exposure_band": band, "reason": reason}


def get_symbol_from_row(row: Dict[str, Any]) -> Optional[str]:
    for k in row.keys():
        k_low = k.lower()
        if "symbol" in k_low or "ticker" in k_low or "종목" in k or "티커" in k:
            val = str(row.get(k, "")).strip().upper()
            if re.match(r"^[A-Z0-9.\-]{1,10}$", val):
                return val
    # fallback: scan values
    for v in row.values():
        if isinstance(v, str):
            s = v.strip().upper()
            if re.match(r"^[A-Z]{1,6}$", s):
                return s
    return None


def get_equity_from_row(row: Dict[str, Any]) -> Optional[float]:
    for k in row.keys():
        k_low = k.lower()
        if "equity" in k_low or "market_value" in k_low or "value" == k_low or "평가" in k:
            v = parse_number(row.get(k))
            if v is not None:
                return v
    # compute from price * shares if available
    price = None
    shares = None
    for k in row.keys():
        if "오늘" in k or "current" in k.lower() or "price" in k.lower():
            price = parse_number(row.get(k))
        if "주식수" in k or "shares" in k.lower() or "qty" in k.lower():
            shares = parse_number(row.get(k))
    if price is not None and shares is not None:
        return price * shares
    return None


def get_day_pnl_from_row(row: Dict[str, Any]) -> Optional[float]:
    for k in row.keys():
        k_low = k.lower()
        if "today" in k_low or "pnl_today" in k_low or ("오늘" in k and ("수익" in k or "손익" in k)):
            v = parse_number(row.get(k))
            if v is not None:
                return v
    return None


def build_portfolio_snapshot() -> Dict[str, Any]:
    # Prefer TS snapshot
    ts_path = os.path.join(output_dir(), "my_holdings_cache.json")
    v1_path = os.path.join(output_cache_dir(), "my_holdings.json")

    ts = load_json(ts_path) or {}
    positions = ts.get("positions") or []

    total_value = 0.0
    day_pnl = 0.0
    pos_rows: List[Dict[str, Any]] = []
    for row in positions:
        if not isinstance(row, dict):
            continue
        sym = get_symbol_from_row(row)
        eq = get_equity_from_row(row)
        if sym and eq is not None:
            pos_rows.append({"symbol": sym, "value": eq})
            total_value += eq
        pnl = get_day_pnl_from_row(row)
        if pnl is not None:
            day_pnl += pnl

    if total_value <= 0:
        # fallback to v1 cache
        v1 = load_json(v1_path) or {}
        if v1.get("summary", {}).get("total_equity"):
            total_value = float(v1["summary"]["total_equity"])
            day_pnl = float(v1["summary"].get("today_pnl") or 0.0)
            pos_rows = [
                {"symbol": p.get("symbol"), "value": p.get("market_value")}
                for p in (v1.get("positions") or [])
                if p.get("symbol") and p.get("market_value") is not None
            ]

    pos_rows = [p for p in pos_rows if p.get("symbol") and p.get("value") is not None]
    # Deduplicate by symbol — keep entry with highest value
    _seen: dict = {}
    for _p in pos_rows:
        _sym = _p["symbol"]
        if _sym not in _seen or float(_p.get("value") or 0) > float(_seen[_sym].get("value") or 0):
            _seen[_sym] = _p
    pos_rows = list(_seen.values())
    pos_rows.sort(key=lambda x: float(x.get("value") or 0), reverse=True)
    top_positions = [
        {
            "symbol": p["symbol"],
            "value": round(float(p["value"]), 2),
            "pct": round(float(p["value"]) / total_value * 100.0, 2) if total_value > 0 else None,
        }
        for p in pos_rows[:3]
    ]

    cash_pct = None
    if ts.get("summary", {}).get("cash") is not None and total_value > 0:
        cash_pct = float(ts["summary"]["cash"]) / total_value * 100.0
    else:
        v1 = load_json(v1_path) or {}
        weights = v1.get("weights") or []
        for w in weights:
            if str(w.get("symbol", "")).upper() == "CASH":
                cash_pct = w.get("weight_pct")
                break

    has_holdings = total_value > 0 and len(pos_rows) > 0
    return {
        "has_holdings": has_holdings,
        "total_value": round(total_value, 2) if total_value > 0 else None,
        "day_pnl": round(day_pnl, 2) if has_holdings else None,
        "cash_pct": round(cash_pct, 2) if isinstance(cash_pct, (int, float)) else None,
        "top_positions": top_positions,
    }


def fetch_watchlist_symbols(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute(
        "SELECT symbol FROM watchlist_symbols ORDER BY created_at DESC"
    ).fetchall()
    return [str(r[0]) for r in rows if r and r[0]]


def fetch_symbol_name(conn: sqlite3.Connection, symbol: str) -> str:
    row = conn.execute(
        "SELECT COALESCE(name, symbol) FROM universe_symbols WHERE symbol=?",
        (symbol,),
    ).fetchone()
    return str(row[0]) if row and row[0] else symbol


def fetch_closes(conn: sqlite3.Connection, symbol: str, limit: int = 520) -> List[float]:
    rows = conn.execute(
        "SELECT close FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT ?",
        (symbol, limit),
    ).fetchall()
    closes = [float(r[0]) for r in rows if r and r[0] is not None]
    closes.reverse()
    return closes


def compute_badge(closes: List[float], chg_pct: Optional[float]) -> Tuple[str, str]:
    if len(closes) < 25:
        if chg_pct is not None and abs(chg_pct) > 5:
            return "Volatile", "Move > 5% (fallback)"
        return "OK", "Insufficient history"

    # RV20
    returns = [(closes[i] / closes[i - 1] - 1) for i in range(1, len(closes))]
    rv20 = None
    if len(returns) >= 20:
        rv20 = (safe_std(returns[-20:]) or 0) * math.sqrt(252) * 100.0

    rv_hist: List[float] = []
    for i in range(20, len(returns)):
        window = returns[i - 20:i]
        std = safe_std(window)
        if std is None:
            continue
        rv_hist.append(std * math.sqrt(252) * 100.0)

    p80 = percentile(rv_hist, 80) if rv_hist else None
    if rv20 is not None and p80 is not None and rv20 > p80:
        return "Volatile", f"RV20 {rv20:.1f} > p80 {p80:.1f}"

    sma20 = safe_mean(closes[-20:]) if len(closes) >= 20 else None
    if sma20 and closes[-1] > sma20 * 1.08:
        return "Overextended", "Price > SMA20 * 1.08"

    return "OK", "Within normal range"


def build_watchlist_moves() -> List[Dict[str, Any]]:
    db = db_path()
    if not os.path.exists(db):
        return []
    conn = sqlite3.connect(db)
    try:
        symbols = fetch_watchlist_symbols(conn)
        moves: List[Dict[str, Any]] = []
        for sym in symbols:
            closes = fetch_closes(conn, sym, limit=520)
            if len(closes) < 2:
                continue
            chg_pct = (closes[-1] / closes[-2] - 1) * 100.0
            name = fetch_symbol_name(conn, sym)
            badge, reason = compute_badge(closes, chg_pct)
            moves.append(
                {
                    "symbol": sym,
                    "name": name,
                    "chg_pct": round(chg_pct, 2),
                    "badge": badge,
                    "badge_reason": reason,
                }
            )
    finally:
        conn.close()

    moves.sort(key=lambda x: abs(x.get("chg_pct") or 0), reverse=True)
    return moves[:5]


def main() -> int:
    market_state = load_market_state()
    health = load_health_snapshot()

    data_date = (
        (market_state.get("data_date") if market_state else None)
        or (health.get("data_date") if health else None)
    )

    exposure = build_exposure_guidance(market_state, health)
    portfolio = build_portfolio_snapshot()
    watchlist_moves = build_watchlist_moves()

    payload = {
        "generated_at": now_iso(),
        "data_date": data_date,
        "exposure_guidance": exposure,
        "portfolio": portfolio,
        "watchlist_moves": watchlist_moves,
    }

    out_dir = output_cache_dir()
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "action_snapshot.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[OK] {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
