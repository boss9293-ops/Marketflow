from __future__ import annotations

from collections import Counter
from typing import Any


def _merge_theme_text(themes: list[str], clusters: list[dict[str, Any]]) -> str:
    cluster_terms: list[str] = []
    for cluster in clusters[:6]:
        term_counter = cluster.get("term_counter")
        if isinstance(term_counter, Counter):
            cluster_terms.extend([str(term) for term, _ in term_counter.most_common(12)])
        elif isinstance(term_counter, dict):
            ordered = sorted(term_counter.items(), key=lambda item: item[1], reverse=True)
            cluster_terms.extend([str(term) for term, _ in ordered[:12]])
    return f"{' '.join(themes)} {' '.join(cluster_terms)}".lower()


def build_flow_signals(themes: list[str], clusters: list[dict[str, Any]]) -> list[str]:
    signals: list[str] = []
    text = _merge_theme_text(themes, clusters)

    if "tech" in text or "semiconductor" in text:
        signals.append("tech_focus")
    if "small-cap" in text:
        signals.append("narrow_leadership")
    if "oil" in text or "energy" in text:
        signals.append("commodity_driven")
    if "fed" in text or "rates" in text:
        signals.append("macro_driven")
    return signals
