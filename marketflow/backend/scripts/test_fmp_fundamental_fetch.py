from __future__ import annotations

import argparse
import os
import sys
from typing import Iterable, List


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND = os.path.join(ROOT, "backend")
for path in (ROOT, BACKEND):
    if path not in sys.path:
        sys.path.insert(0, path)

from services.fmp_fundamental_fetch import (  # noqa: E402
    DEFAULT_PILOT_TICKERS,
    fetch_and_store_fmp_consensus,
    get_latest_fmp_consensus,
)


def _format_value(value):
    if value is None:
        return "--"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def _print_snapshot(prefix: str, snapshot: dict) -> None:
    warnings = snapshot.get("warnings") or []
    errors = snapshot.get("errors") or []
    ladder = snapshot.get("eps_ladder") or []
    ladder_span = ""
    if isinstance(ladder, list) and ladder:
        first = ladder[0] if isinstance(ladder[0], dict) else {}
        last = ladder[-1] if isinstance(ladder[-1], dict) else {}
        first_label = str(first.get("label") or first.get("year") or "--")
        last_label = str(last.get("label") or last.get("year") or "--")
        ladder_span = f" | Ladder={len(ladder)} rows ({first_label} -> {last_label})"
    print(
        f"{prefix} {snapshot.get('ticker')} | "
        f"FY1 EPS={_format_value(snapshot.get('eps_estimate_fy1'))} | "
        f"FY2 EPS={_format_value(snapshot.get('eps_estimate_fy2'))} | "
        f"Target Mean={_format_value(snapshot.get('target_mean'))} | "
        f"High={_format_value(snapshot.get('target_high'))} | "
        f"Low={_format_value(snapshot.get('target_low'))} | "
        f"Analysts={_format_value(snapshot.get('analyst_count') or snapshot.get('target_analyst_count'))}"
        f"{ladder_span}"
    )
    if warnings:
        print(f"  warnings: {', '.join(str(w) for w in warnings)}")
    if errors:
        print(f"  errors: {', '.join(str(e) for e in errors)}")


def run(tickers: Iterable[str], db_path: str | None = None) -> int:
    tickers_list: List[str] = [str(t).strip().upper() for t in tickers if str(t).strip()]
    if not tickers_list:
        tickers_list = list(DEFAULT_PILOT_TICKERS)

    print("Fetching and storing FMP consensus snapshots...")
    success_count = 0
    for ticker in tickers_list:
        try:
            snapshot = fetch_and_store_fmp_consensus(ticker, db_path=db_path)
            success_count += 1
            _print_snapshot("saved", snapshot)
        except Exception as exc:
            print(f"failed {ticker}: {exc}")

    print("\nLatest snapshots from DB:")
    for ticker in tickers_list:
        snapshot = get_latest_fmp_consensus(ticker, db_path=db_path)
        if snapshot is None:
            print(f"missing {ticker}")
            continue
        _print_snapshot("latest", snapshot)

    return 0 if success_count > 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch FMP consensus snapshots for pilot tickers.")
    parser.add_argument("tickers", nargs="*", help="Tickers to fetch. Defaults to AAPL MSFT NVDA.")
    parser.add_argument("--db-path", dest="db_path", default=None, help="Optional SQLite database path.")
    args = parser.parse_args()
    return run(args.tickers, db_path=args.db_path)


if __name__ == "__main__":
    raise SystemExit(main())
