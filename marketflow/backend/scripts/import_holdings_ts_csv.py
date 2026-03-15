"""
Import holdings time-series cache from CSV.

CSV columns (header required):
  tab,date,total,in,pl,pl_pct,delta

Writes:
  backend/output/my_holdings_ts.json
  output/cache/my_holdings_ts.json
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from datetime import datetime
from typing import Any, Dict, List

DATA_VERSION = "my_holdings_ts_v2"


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def output_paths():
    out1 = os.path.join(repo_root(), "backend", "output", "my_holdings_ts.json")
    out2 = os.path.join(repo_root(), "output", "cache", "my_holdings_ts.json")
    return out1, out2


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import holdings time-series from CSV")
    p.add_argument("--csv", required=True, help="Path to CSV file")
    return p.parse_args()


def parse_number(text: str) -> Any:
    t = (text or "").strip()
    if not t:
        return None
    try:
        return float(t)
    except Exception:
        return None


def main() -> int:
    args = parse_args()
    path = args.csv
    if not os.path.exists(path):
        print(f"[FAIL] CSV not found: {path}")
        return 1

    series: Dict[str, List[Dict[str, Any]]] = {}
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tab = (row.get("tab") or "").strip()
            date = (row.get("date") or "").strip()
            if not tab or not date:
                continue
            item = {
                "date": date,
                "total": parse_number(row.get("total", "")),
                "in": parse_number(row.get("in", "")),
                "pl": parse_number(row.get("pl", "")),
                "pl_pct": parse_number(row.get("pl_pct", "")),
                "delta": parse_number(row.get("delta", "")),
            }
            series.setdefault(tab, []).append(item)

    # sort per tab
    for tab, pts in series.items():
        pts.sort(key=lambda p: p.get("date") or "")

    active_tabs = list(series.keys())
    merged: List[Dict[str, Any]] = []
    by_date: Dict[str, Dict[str, Any]] = {}
    for tab in active_tabs:
        for p in series.get(tab, []):
            d = p.get("date")
            if not d:
                continue
            merged_p = dict(p)
            merged_p["tab"] = tab
            by_date[d] = merged_p
    merged = [by_date[k] for k in sorted(by_date.keys())]

    payload = {
        "data_version": DATA_VERSION,
        "status": "ok" if series else "empty",
        "date": merged[-1]["date"] if merged else None,
        "active_tabs": active_tabs,
        "series": series,
        "merged": merged,
        "latest": {tab: pts[-1] for tab, pts in series.items() if pts},
        "summary": {
            "point_count": sum(len(v) for v in series.values()),
            "date_min": merged[0]["date"] if merged else None,
            "date_max": merged[-1]["date"] if merged else None,
        },
        "generated_at": now_iso(),
        "rerun_hint": "python backend/scripts/import_holdings_ts_csv.py --csv <file>",
        "missing_inputs": [],
    }

    out1, out2 = output_paths()
    os.makedirs(os.path.dirname(out1), exist_ok=True)
    with open(out1, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.makedirs(os.path.dirname(out2), exist_ok=True)
    with open(out2, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(
        json.dumps(
            {"ok": True, "tabs": len(active_tabs), "rows": len(merged), "output": out1},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
