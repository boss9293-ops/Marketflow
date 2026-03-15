"""
Export merged holdings time-series cache to CSV.

Usage:
  python backend/scripts/export_holdings_ts_csv.py --output backend/output/my_holdings_ts.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from typing import Any, Dict, List


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def input_path() -> str:
    return os.path.join(repo_root(), "backend", "output", "my_holdings_ts.json")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export holdings time-series cache to CSV")
    p.add_argument("--output", default=os.path.join(repo_root(), "backend", "output", "my_holdings_ts.csv"))
    return p.parse_args()


def main() -> int:
    args = parse_args()
    src = input_path()
    if not os.path.exists(src):
        print(f"[FAIL] {src} not found.")
        return 1

    with open(src, "r", encoding="utf-8") as f:
        payload: Dict[str, Any] = json.load(f)

    series: Dict[str, List[Dict[str, Any]]] = payload.get("series") or {}
    rows: List[Dict[str, Any]] = []
    for tab, pts in series.items():
        if not isinstance(pts, list):
            continue
        for p in pts:
            rows.append(
                {
                    "tab": tab,
                    "date": p.get("date"),
                    "total": p.get("total"),
                    "in": p.get("in"),
                    "pl": p.get("pl"),
                    "pl_pct": p.get("pl_pct"),
                    "delta": p.get("delta"),
                }
            )

    rows = sorted(rows, key=lambda r: (str(r.get("tab") or ""), str(r.get("date") or "")))

    out = args.output
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["tab", "date", "total", "in", "pl", "pl_pct", "delta"])
        writer.writeheader()
        for r in rows:
            writer.writerow(r)

    print(
        json.dumps(
            {
                "ok": True,
                "rows": len(rows),
                "input": src,
                "output": out,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
