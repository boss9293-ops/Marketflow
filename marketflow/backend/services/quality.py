from __future__ import annotations


def quality_from_coverage(coverage: float) -> str:
    if coverage >= 0.95:
        return "OK"
    if coverage >= 0.60:
        return "PARTIAL"
    return "NA"


def merge_quality(*qualities: str) -> str:
    vals = {q.upper() for q in qualities if isinstance(q, str)}
    if "NA" in vals:
        return "NA"
    if "PARTIAL" in vals:
        return "PARTIAL"
    return "OK"
