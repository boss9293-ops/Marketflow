from __future__ import annotations

from typing import Any


def compute_sector_confidence(sector_facts: list[dict[str, Any]]) -> float:
    rows = [row for row in (sector_facts or []) if isinstance(row, dict)]
    total = len(rows)
    if total <= 0:
        return 0.0
    valid = sum(1 for row in rows if row.get("change_pct") is not None)
    return float(valid / total)


def compute_macro_confidence(macro: dict[str, Any]) -> float:
    macro_dict = macro if isinstance(macro, dict) else {}
    score = 0.0
    oil = macro_dict.get("oil") if isinstance(macro_dict.get("oil"), dict) else {}
    rates = macro_dict.get("rates") if isinstance(macro_dict.get("rates"), dict) else {}
    if oil.get("value") is not None:
        score += 1.0
    if rates.get("value") is not None:
        score += 1.0
    return float(score / 2.0)


def compute_overall_confidence(data: dict[str, Any]) -> float:
    payload = data if isinstance(data, dict) else {}
    sector_confidence = compute_sector_confidence(payload.get("sector_facts") if isinstance(payload.get("sector_facts"), list) else [])
    macro_confidence = compute_macro_confidence(payload.get("macro_factors") if isinstance(payload.get("macro_factors"), dict) else {})
    return float((sector_confidence * 0.6) + (macro_confidence * 0.4))

