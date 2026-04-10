from __future__ import annotations

import argparse
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bootstrap_backend_root() -> None:
    search_roots = [
        SCRIPT_DIR,
        os.path.dirname(SCRIPT_DIR),
        os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..")),
        os.getcwd(),
    ]
    target_rels = [
        os.path.join("backend", "news", "context_news.py"),
        os.path.join("news", "context_news.py"),
    ]
    seen: set[str] = set()
    for root in search_roots:
        current = os.path.abspath(root)
        while current and current not in seen:
            seen.add(current)
            for target_rel in target_rels:
                if os.path.exists(os.path.join(current, target_rel)):
                    if current not in sys.path:
                        sys.path.insert(0, current)
                    return
            parent = os.path.dirname(current)
            if parent == current:
                break
            current = parent

    # Last-resort fallbacks for local dev / Railway flattening.
    for fallback in (
        os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..")),
        os.path.abspath(os.path.join(SCRIPT_DIR, "..")),
        os.getcwd(),
    ):
        if fallback not in sys.path:
            sys.path.insert(0, fallback)


_bootstrap_backend_root()

try:
    from backend.news.context_news import build_context_news_cache
except ModuleNotFoundError:
    from news.context_news import build_context_news_cache


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
