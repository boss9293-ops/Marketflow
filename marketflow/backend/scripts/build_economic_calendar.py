"""
Build economic_calendar.json from market_data.json snapshot (cache-only).

This provides a lightweight "economic calendar" view even without a live macro API.
If market_data.json is missing, writes empty payload with error.

Output:
  backend/output/economic_calendar.json
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def output_dir() -> str:
    return os.path.join(repo_root(), "output")


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


def fmt_value(price: Any, chg: Any) -> str:
    try:
        p = float(price)
    except Exception:
        return "-"
    try:
        c = float(chg)
        sign = "+" if c >= 0 else ""
        return f"{p:.2f} ({sign}{c:.2f}%)"
    except Exception:
        return f"{p:.2f}"


def main() -> int:
    md = load_json(os.path.join(output_dir(), "market_data.json"))
    out_path = os.path.join(output_dir(), "economic_calendar.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    if not md:
        payload = {
            "generated_at": now_iso(),
            "mode": "snapshot",
            "events": [],
            "error": "market_data.json not found",
            "rerun_hint": "python backend/scripts/market_data.py",
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("[WARN] market_data.json missing.")
        print(f"[OK] {out_path}")
        return 0

    ts = md.get("timestamp", "")
    date_str = ts.split("T")[0] if ts else datetime.now().strftime("%Y-%m-%d")

    def ev(event: str, value: str, importance: str = "Medium") -> Dict[str, Any]:
        return {
            "date": date_str,
            "time": "N/A",
            "event": event,
            "importance": importance,
            "forecast": "-",
            "actual": value,
        }

    events: List[Dict[str, Any]] = []

    idx = md.get("indices", {})
    for sym, label in [("SPY", "S&P 500"), ("QQQ", "NASDAQ 100"), ("IWM", "Russell 2000")]:
        item = idx.get(sym, {})
        events.append(ev(f"{label} ({sym})", fmt_value(item.get("price"), item.get("change_pct")), "High"))

    bonds = md.get("bonds", {})
    tnx = bonds.get("^TNX", {})
    events.append(ev("US 10Y Treasury (^TNX)", fmt_value(tnx.get("price"), tnx.get("change_pct")), "High"))

    vol = md.get("volatility", {})
    vix = vol.get("^VIX", {})
    events.append(ev("VIX (^VIX)", fmt_value(vix.get("price"), vix.get("change_pct")), "High"))

    fx = md.get("currencies", {})
    dxy = fx.get("DX-Y.NYB", {})
    events.append(ev("Dollar Index (DXY)", fmt_value(dxy.get("price"), dxy.get("change_pct")), "Medium"))

    comm = md.get("commodities", {})
    gold = comm.get("GC=F", {})
    oil = comm.get("CL=F", {})
    btc = comm.get("BTC-USD", {})
    events.append(ev("Gold (GC=F)", fmt_value(gold.get("price"), gold.get("change_pct")), "Medium"))
    events.append(ev("Crude Oil (CL=F)", fmt_value(oil.get("price"), oil.get("change_pct")), "Medium"))
    events.append(ev("Bitcoin (BTC-USD)", fmt_value(btc.get("price"), btc.get("change_pct")), "Low"))

    payload = {
        "generated_at": now_iso(),
        "mode": "snapshot",
        "source": "market_data.json",
        "events": events,
        "rerun_hint": "python backend/scripts/build_economic_calendar.py",
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[OK] events={len(events)} -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
