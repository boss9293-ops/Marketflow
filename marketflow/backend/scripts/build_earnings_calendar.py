"""
Build earnings_calendar.json from recent signals (top picks + hot zone).

Data source: yfinance (best-effort). If no data is available, writes empty payload with error.

Output:
  backend/output/earnings_calendar.json
"""
from __future__ import annotations

import json
import os
from datetime import datetime, date
from typing import Any, Dict, List, Optional, Tuple

import yfinance as yf


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def output_dir() -> str:
    return os.path.join(repo_root(), "backend", "output")


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


def parse_date(obj: Any) -> Optional[date]:
    if obj is None:
        return None
    if isinstance(obj, date):
        return obj
    if isinstance(obj, datetime):
        return obj.date()
    try:
        return datetime.fromtimestamp(obj).date()
    except Exception:
        return None


def extract_earnings_date(ticker: yf.Ticker) -> Optional[date]:
    # Try earnings dates API
    try:
        ed = ticker.get_earnings_dates(limit=1)
        if ed is not None and not ed.empty:
            idx = ed.index[0]
            d = parse_date(idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx)
            if d:
                return d
    except Exception:
        pass

    # Fallback to calendar
    try:
        cal = ticker.calendar
        # dict-like calendar
        if isinstance(cal, dict):
            val = cal.get("Earnings Date")
            if isinstance(val, (list, tuple)) and val:
                d = parse_date(val[0])
                if d:
                    return d
            d = parse_date(val)
            if d:
                return d
        # DataFrame-like calendar
        if cal is not None and not getattr(cal, "empty", False):
            if hasattr(cal, "index") and "Earnings Date" in cal.index:
                val = cal.loc["Earnings Date"][0]
                d = parse_date(val)
                if d:
                    return d
            if hasattr(cal, "columns") and "Earnings Date" in cal.columns:
                val = cal["Earnings Date"].iloc[0]
                d = parse_date(val)
                if d:
                    return d
    except Exception:
        pass

    return None


def build_ticker_pool() -> List[Tuple[str, str]]:
    pool: List[Tuple[str, str]] = []

    top_picks = load_json(os.path.join(output_dir(), "top_picks.json")) or {}
    for item in top_picks.get("top_picks", [])[:25]:
        sym = str(item.get("ticker") or "").strip()
        name = str(item.get("name") or sym).strip()
        if sym:
            pool.append((sym, name))

    hot_zone = load_json(os.path.join(output_dir(), "hot_zone.json")) or {}
    for item in hot_zone.get("leaders", [])[:25]:
        sym = str(item.get("symbol") or "").strip()
        name = str(item.get("name") or sym).strip()
        if sym:
            pool.append((sym, name))

    # Dedup, keep order
    seen = set()
    result: List[Tuple[str, str]] = []
    for sym, name in pool:
        if sym in seen:
            continue
        seen.add(sym)
        result.append((sym, name))
    return result[:40]


def main() -> int:
    tickers = build_ticker_pool()
    out_path = os.path.join(output_dir(), "earnings_calendar.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    if not tickers:
        payload = {
            "generated_at": now_iso(),
            "source": "yfinance",
            "earnings": [],
            "error": "no tickers available (top_picks.json / hot_zone.json missing)",
            "rerun_hint": "python backend/scripts/build_earnings_calendar.py",
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("[WARN] No tickers available for earnings calendar.")
        print(f"[OK] {out_path}")
        return 0

    earnings: List[Dict[str, Any]] = []
    errors: List[str] = []

    for sym, name in tickers:
        try:
            t = yf.Ticker(sym)
            d = extract_earnings_date(t)
            if not d:
                continue
            earnings.append(
                {
                    "ticker": sym,
                    "name": name,
                    "date": d.strftime("%Y-%m-%d"),
                    "estimate": None,
                    "actual": None,
                    "surprise_pct": None,
                }
            )
        except Exception as e:
            errors.append(f"{sym}: {e}")

    # Sort by date ascending
    earnings.sort(key=lambda x: x.get("date") or "")

    payload = {
        "generated_at": now_iso(),
        "source": "yfinance",
        "earnings": earnings,
        "errors": errors,
        "rerun_hint": "python backend/scripts/build_earnings_calendar.py",
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[OK] earnings={len(earnings)} errors={len(errors)} -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
