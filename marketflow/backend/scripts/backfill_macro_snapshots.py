from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta

import pandas as pd


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND = os.path.join(ROOT, "backend")
for p in (ROOT, BACKEND):
    if p not in sys.path:
        sys.path.insert(0, p)

from backend.jobs.build_macro_snapshot import save_macro_snapshot  # noqa: E402


def _storage_dir() -> str:
    return os.path.join(ROOT, "backend", "storage", "macro_snapshots")


def _exists_snapshot(day: str) -> bool:
    return os.path.exists(os.path.join(_storage_dir(), f"{day}.json"))


def run_backfill(years: int, skip_existing: bool) -> tuple[int, int, int]:
    end = date.today()
    start = end - timedelta(days=365 * years)
    business_days = pd.bdate_range(start=start, end=end).strftime("%Y-%m-%d").tolist()

    created = 0
    skipped = 0
    failed = 0

    os.makedirs(_storage_dir(), exist_ok=True)
    total = len(business_days)
    for idx, day in enumerate(business_days, start=1):
        if skip_existing and _exists_snapshot(day):
            skipped += 1
            if idx % 50 == 0 or idx == total:
                print(f"[{idx}/{total}] skip existing: {day}")
            continue
        try:
            path = save_macro_snapshot(day)
            created += 1
            if idx % 25 == 0 or idx == total:
                print(f"[{idx}/{total}] wrote: {day} -> {path}")
        except Exception as exc:
            failed += 1
            print(f"[{idx}/{total}] fail: {day} ({exc})")

    return created, skipped, failed


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill macro snapshots by business day.")
    parser.add_argument("--years", type=int, default=3, help="How many years to backfill (default: 3).")
    parser.add_argument(
        "--no-skip-existing",
        action="store_true",
        help="Rebuild existing snapshot dates too (default: skip existing).",
    )
    args = parser.parse_args()

    years = max(1, int(args.years))
    skip_existing = not bool(args.no_skip_existing)
    print(f"[START] macro snapshot backfill: years={years}, skip_existing={skip_existing}")
    created, skipped, failed = run_backfill(years=years, skip_existing=skip_existing)
    print(f"[DONE] created={created}, skipped={skipped}, failed={failed}")
    if failed > 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

