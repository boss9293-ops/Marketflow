from __future__ import annotations

import argparse
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
for candidate in (
    os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..")),  # repo root when run locally
    os.path.abspath(os.path.join(SCRIPT_DIR, "..")),        # Railway /app when scripts are flattened
):
    if os.path.isdir(os.path.join(candidate, "backend")) and candidate not in sys.path:
        sys.path.insert(0, candidate)

from backend.news.context_news import build_context_news_cache


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build context news cache (Yahoo default / Premium pluggable)")
    p.add_argument("--region", default="us")
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--slot", default="", help="Optional slot label: preopen, morning, or close.")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    data = build_context_news_cache(region=args.region, limit=args.limit, slot=args.slot)
    print(
        f"[OK] context news cache built: status={data.get('news_status')} "
        f"provider={data.get('provider')} selected={data.get('selected_count')} slot={data.get('slot')}"
    )
