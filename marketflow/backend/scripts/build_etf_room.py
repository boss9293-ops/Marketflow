"""
Build ETF Room cache JSON (v1).

Reads from data/marketflow.db (live ohlcv_daily + indicators_daily) for a small,
fixed ETF universe. No full-universe scan needed.

Output:
  backend/output/etf_room.json

Structure:
{
  "date": "YYYY-MM-DD",
  "generated_at": "...",
  "universe": { "leverage":[...], "hot":[...], "theme":[...], "dividend":[...] },
  "sections": {
    "hot":      { "items":[...], "sort": "ret_5d desc" },
    "leverage": { "items":[...], "sort": "ret_5d desc" },
    "theme":    { "items":[...], "sort": "ret_5d desc" },
    "dividend": { "items":[...], "sort": "ret_20d desc" }
  },
  "notes": { "coverage": { "ok": N, "missing": [...] } },
  "rerun_hint": "python backend/scripts/build_etf_room.py"
}
"""
from __future__ import annotations

import json
import os
import sqlite3
import traceback
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from symbol_registry import ROOM_SECTION_META, ROOM_SECTIONS, get_etf_display_name, room_symbols


# ─── ETF universe ─────────────────────────────────────────────────────────────
ETF_LEVERAGE = ["TQQQ", "SOXL", "SPXL", "TECL", "FNGU", "SQQQ"]
ETF_HOT      = ["SPY", "QQQ", "IWM", "DIA", "SMH", "XLF", "XLE", "XLI", "XLK"]
ETF_THEME    = ["SOXX", "BOTZ", "AIQ", "ARKK", "ARKX", "ICLN", "IBIT"]
ETF_DIVIDEND = ["SCHD", "JEPI", "VYM", "DGRO"]

ETF_NAMES: Dict[str, str] = {
    # Leverage
    "TQQQ": "ProShares UltraPro QQQ",
    "SOXL": "Direxion Daily Semi Bull 3X",
    "SPXL": "Direxion Daily S&P500 Bull 3X",
    "TECL": "Direxion Daily Tech Bull 3X",
    "FNGU": "MicroSectors FANG+™ 3X",
    "SQQQ": "ProShares UltraPro Short QQQ",
    # Hot
    "SPY":  "SPDR S&P 500 ETF",
    "QQQ":  "Invesco QQQ (Nasdaq 100)",
    "IWM":  "iShares Russell 2000 ETF",
    "DIA":  "SPDR Dow Jones Industrial",
    "SMH":  "VanEck Semiconductor ETF",
    "XLF":  "Financial Select Sector SPDR",
    "XLE":  "Energy Select Sector SPDR",
    "XLI":  "Industrial Select Sector SPDR",
    "XLK":  "Technology Select Sector SPDR",
    # Theme
    "SOXX": "iShares Semiconductor ETF",
    "BOTZ": "Global X Robotics & AI ETF",
    "AIQ":  "Global X AI & Big Data ETF",
    "ARKK": "ARK Innovation ETF",
    "ARKX": "ARK Space Exploration ETF",
    "ICLN": "iShares Global Clean Energy ETF",
    "IBIT": "iShares Bitcoin Trust",
    # Dividend
    "SCHD": "Schwab US Dividend Equity ETF",
    "JEPI": "JPMorgan Equity Premium Income",
    "VYM":  "Vanguard High Dividend Yield ETF",
    "DGRO": "iShares Core Dividend Growth ETF",
}

ALL_ETFS = room_symbols()

RERUN_HINT = "python backend/scripts/build_etf_room.py"
LOOKBACK_DAYS = 260   # fetch only 60 days of OHLCV per symbol (cheap)


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def output_path() -> str:
    return os.path.join(repo_root(), "backend", "output", "etf_room.json")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def round2(v: Optional[float]) -> Optional[float]:
    return round(v, 2) if v is not None else None


# ─── DB queries ───────────────────────────────────────────────────────────────

def fetch_ohlcv(conn: sqlite3.Connection, symbols: List[str]) -> Dict[str, List[Tuple]]:
    """
    Returns {symbol: [(date, close, volume), ...]} sorted date ASC, last LOOKBACK_DAYS rows.
    """
    if not symbols:
        return {}
    ph = ",".join("?" * len(symbols))
    sql = f"""
    SELECT symbol, date, close, volume
    FROM (
        SELECT symbol, date, close, volume,
               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
        FROM ohlcv_daily
        WHERE symbol IN ({ph})
    ) t
    WHERE rn <= {LOOKBACK_DAYS}
    ORDER BY symbol, date ASC
    """
    rows = conn.execute(sql, symbols).fetchall()
    out: Dict[str, List[Tuple]] = {s: [] for s in symbols}
    for r in rows:
        out[str(r[0])].append((str(r[1]), r[2], r[3]))
    return out


def fetch_indicators(conn: sqlite3.Connection, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Returns {symbol: {rsi14, sma50, sma200}} for the latest date per symbol.
    """
    if not symbols:
        return {}
    ph = ",".join("?" * len(symbols))
    sql = f"""
    SELECT i.symbol, i.rsi14, i.sma50, i.sma200
    FROM indicators_daily i
    INNER JOIN (
        SELECT symbol, MAX(date) AS md
        FROM indicators_daily
        WHERE symbol IN ({ph})
        GROUP BY symbol
    ) m ON m.symbol = i.symbol AND m.md = i.date
    """
    rows = conn.execute(sql, symbols).fetchall()
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        out[str(r[0])] = {
            "rsi14": float(r[1]) if r[1] is not None else None,
            "sma50": float(r[2]) if r[2] is not None else None,
            "sma200": float(r[3]) if r[3] is not None else None,
        }
    return out


# ─── Metric computation ───────────────────────────────────────────────────────

def _to_float(v: Any) -> Optional[float]:
    try:
        fv = float(v)
        return None if fv != fv else fv  # NaN guard
    except (TypeError, ValueError):
        return None


def compute_metrics(
    symbol: str,
    ohlcv: List[Tuple],        # [(date, close, volume), ...] ASC
    ind: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Compute ETF row metrics from OHLCV history."""
    name = get_etf_display_name(symbol)

    if not ohlcv:
        return {
            "symbol": symbol,
            "name": name,
            "last_close": None,
            "ret_1d": None,
            "ret_5d": None,
            "ret_20d": None,
            "ret_200d": None,
            "vol_k": None,
            "vol_surge": None,
            "rsi14": None,
            "above_sma50": None,
            "above_sma200": None,
        }

    closes = [_to_float(r[1]) for r in ohlcv]
    volumes = [_to_float(r[2]) for r in ohlcv]

    # Filter None closes
    valid_closes = [(i, c) for i, c in enumerate(closes) if c is not None]
    if not valid_closes:
        last_close = None
    else:
        last_close = valid_closes[-1][1]

    def ret_n(n: int) -> Optional[float]:
        """Return n-day simple return (%)."""
        if not valid_closes or len(valid_closes) < 2:
            return None
        end_close = valid_closes[-1][1]
        # find close n trading rows ago
        target_idx = len(valid_closes) - 1 - n
        if target_idx < 0:
            return None
        start_close = valid_closes[target_idx][1]
        if not start_close:
            return None
        return round((end_close - start_close) / start_close * 100.0, 2)

    ret_1d  = ret_n(1)
    ret_5d  = ret_n(5)
    ret_20d = ret_n(20)
    ret_200d = ret_n(200)

    # Volume
    valid_vols = [v for v in volumes if v is not None]
    latest_vol = valid_vols[-1] if valid_vols else None
    vol_k = round(latest_vol / 1000.0, 1) if latest_vol is not None else None

    # vol_surge = latest_vol / avg(last 20d volumes excl. latest)
    vol_surge: Optional[float] = None
    if latest_vol is not None and len(valid_vols) >= 6:
        past_vols = valid_vols[max(0, len(valid_vols) - 21):-1]
        if past_vols:
            avg_vol = sum(past_vols) / len(past_vols)
            vol_surge = round(latest_vol / avg_vol, 2) if avg_vol > 0 else None

    # Indicators
    rsi14 = None
    above_sma50 = None
    above_sma200 = None
    if ind:
        rsi14 = round2(ind.get("rsi14"))
        if last_close is not None:
            sma50 = ind.get("sma50")
            sma200 = ind.get("sma200")
            above_sma50  = bool(last_close > sma50)  if sma50  is not None else None
            above_sma200 = bool(last_close > sma200) if sma200 is not None else None

    return {
        "symbol": symbol,
        "name": name,
        "last_close": round2(last_close),
        "ret_1d":     ret_1d,
        "ret_5d":     ret_5d,
        "ret_20d":    ret_20d,
        "ret_200d":   ret_200d,
        "vol_k":      vol_k,
        "vol_surge":  vol_surge,
        "rsi14":      rsi14,
        "above_sma50":  above_sma50,
        "above_sma200": above_sma200,
    }


def build_section(
    symbols: List[str],
    metrics_map: Dict[str, Dict[str, Any]],
    sort_key: str,
) -> Dict[str, Any]:
    items = [metrics_map[s] for s in symbols if s in metrics_map]
    # Sort: None last
    reverse = True  # desc for all sections
    items.sort(
        key=lambda x: (x.get(sort_key) is None, -(x.get(sort_key) or 0)),
        reverse=False,
    )
    return {"items": items, "sort": f"{sort_key} desc"}


def main() -> int:
    path = db_path()
    if not os.path.exists(path):
        print(f"[WARN] DB not found: {path}")
        section_order = list(ROOM_SECTIONS.keys())
        payload = {
            "date": None,
            "generated_at": now_iso(),
            "section_order": section_order,
            "universe": {k: [] for k in section_order},
            "sections": {k: {"items": [], "sort": ROOM_SECTION_META.get(k, {}).get("sort", "")} for k in section_order},
            "notes": {"coverage": {"ok": 0, "missing": ALL_ETFS}},
            "rerun_hint": RERUN_HINT,
            "status": "no_db",
        }
        write_json(output_path(), payload)
        print(f"[OK] {output_path()} (status=no_db)")
        return 0

    conn = sqlite3.connect(path)
    try:
        ohlcv_map  = fetch_ohlcv(conn, ALL_ETFS)
        ind_map    = fetch_indicators(conn, ALL_ETFS)

        metrics_map: Dict[str, Dict[str, Any]] = {}
        missing: List[str] = []
        as_of_dates: List[str] = []

        for sym in ALL_ETFS:
            rows = ohlcv_map.get(sym, [])
            if rows:
                as_of_dates.append(rows[-1][0])   # latest date
            else:
                missing.append(sym)
            ind = ind_map.get(sym)
            metrics_map[sym] = compute_metrics(sym, rows, ind)

        as_of = max(as_of_dates) if as_of_dates else None

        section_order = list(ROOM_SECTIONS.keys())
        sections: Dict[str, Any] = {}
        for section_key, symbols in ROOM_SECTIONS.items():
            sort_key = ROOM_SECTION_META.get(section_key, {}).get("sort", "ret_5d desc").split()[0]
            sections[section_key] = build_section(list(symbols), metrics_map, sort_key)

        payload: Dict[str, Any] = {
            "date": as_of,
            "generated_at": now_iso(),
            "section_order": section_order,
            "universe": {
                key: list(symbols) for key, symbols in ROOM_SECTIONS.items()
            },
            "sections": sections,
            "notes": {
                "coverage": {
                    "ok":      len(ALL_ETFS) - len(missing),
                    "missing": missing,
                }
            },
            "rerun_hint": RERUN_HINT,
            "status": "ok" if not missing else "partial",
        }

        write_json(output_path(), payload)

        total_items = sum(len(v["items"]) for v in sections.values())
        print("============================================================")
        print("build_etf_room.py v1")
        print(f"  date={as_of}  status={payload['status']}")
        print(f"  coverage={len(ALL_ETFS)-len(missing)}/{len(ALL_ETFS)}", end="")
        if missing:
            print(f"  missing={missing}", end="")
        print()
        for sect, data in sections.items():
            print(f"  section={sect:<10} items={len(data['items'])}")
        print(f"  total_items={total_items}")
        print(f"[OK] {output_path()}")
        print("============================================================")
        return 0

    except Exception:
        print("[FATAL] build_etf_room failed:")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
