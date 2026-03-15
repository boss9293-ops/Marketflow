import json
import numpy as np
from typing import Any, Dict, List, Optional, Tuple

def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))

def winsorize(values: List[float], low_pct: float = 1.0, high_pct: float = 99.0) -> List[float]:
    if not values:
        return []
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return []
    n = len(xs)
    lo_idx = int((low_pct / 100.0) * (n - 1))
    hi_idx = int((high_pct / 100.0) * (n - 1))
    lo_v = xs[lo_idx]
    hi_v = xs[hi_idx]
    return [float(clamp(v, lo_v, hi_v)) if v is not None else None for v in values]

def empirical_rank_percentile(window: List[float], x: float) -> Optional[float]:
    xs = [float(v) for v in window if v is not None]
    if x is None or not xs:
        return None
    if len(xs) == 1:
        return 50.0
    xs_sorted = sorted(xs)
    rank = sum(1 for v in xs_sorted if v <= x)
    return 100.0 * (rank - 1) / (len(xs_sorted) - 1)

def pct_change(values: List[float], window: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(values)
    for i in range(window, len(values)):
        prev = values[i - window]
        cur = values[i]
        if prev is None or cur is None or prev == 0:
            out[i] = None
            continue
        out[i] = ((cur / prev) - 1.0) * 100.0
    return out

def bp_change(values: List[float], window: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(values)
    for i in range(window, len(values)):
        prev = values[i - window]
        cur = values[i]
        if prev is None or cur is None:
            out[i] = None
            continue
        out[i] = (cur - prev) * 100.0
    return out

def calculate_weighted_score(parts: List[Tuple[Optional[float], float]]) -> Optional[float]:
    vals = [(v, w) for v, w in parts if v is not None and w > 0]
    if not vals:
        return None
    sw = sum(w for _, w in vals)
    if sw <= 0:
        return None
    return sum(v * w for v, w in vals) / sw

def get_state_from_bins(value: Optional[float], bins: List[Dict[str, Any]]) -> Optional[str]:
    if value is None:
        return None
    for b in bins or []:
        if value <= float(b.get("max", 100)):
            return str(b.get("state"))
    return str((bins or [{}])[-1].get("state")) if bins else None
