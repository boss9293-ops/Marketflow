from __future__ import annotations

from typing import Any


def _pct(indices: dict[str, Any], key: str) -> float | None:
    item = indices.get(key)
    if not isinstance(item, dict):
        return None
    value = item.get("change_pct")
    if isinstance(value, (int, float)):
        return float(value)
    return None


def build_market_reaction(indices: dict[str, Any], macro: dict[str, Any]) -> list[str]:
    reaction: list[str] = []

    nasdaq = _pct(indices, "nasdaq")
    dow = _pct(indices, "dow")

    if nasdaq is not None and dow is not None and nasdaq < dow:
        reaction.append("tech_underperformance")

    if str(macro.get("rates") or "").lower() == "up":
        reaction.append("rate_pressure")

    if str(macro.get("oil") or "").lower() == "higher":
        reaction.append("inflation_fear")

    return reaction
