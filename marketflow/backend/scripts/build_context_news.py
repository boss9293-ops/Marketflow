from __future__ import annotations

import argparse
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

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
