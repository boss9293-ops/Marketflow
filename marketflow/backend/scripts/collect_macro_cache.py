from __future__ import annotations

import os
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND = os.path.join(ROOT, "backend")
for p in (ROOT, BACKEND):
    if p not in sys.path:
        sys.path.insert(0, p)

from backend.collectors.collect_cboe import run as collect_cboe
from backend.collectors.collect_fred import run as collect_fred
from backend.collectors.collect_global_m2 import run as collect_global_m2
from backend.collectors.collect_market import run as collect_market


def run_all() -> dict:
    out = {
        "fred": collect_fred(),
        "global_m2": collect_global_m2(),
        "market": collect_market(),
        "cboe": collect_cboe(),
    }
    return out


if __name__ == "__main__":
    print(run_all())
