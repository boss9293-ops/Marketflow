from __future__ import annotations

from typing import Any


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def derive_key_driver(fact: dict[str, Any]) -> str:
    indices = _as_list(fact.get("indices"))
    sectors = _as_list(fact.get("sectors"))
    macro_factors = fact.get("macro_factors") if isinstance(fact.get("macro_factors"), dict) else {}
    oil_factor = macro_factors.get("oil") if isinstance(macro_factors.get("oil"), dict) else {}
    rates_factor = macro_factors.get("rates") if isinstance(macro_factors.get("rates"), dict) else {}

    market_down = any("-" in item for item in indices)
    tech_weak = any("기술주 약세" in item for item in sectors)

    oil_status = str(oil_factor.get("status") or "")
    rates_status = str(rates_factor.get("status") or "")
    oil_up = oil_status in {"inflationary_pressure", "supply_shock"}
    rates_up = rates_status in {"rate_pressure", "tightening_signal"}

    if market_down and tech_weak and oil_up:
        return "유가 급등 → 인플레 압력 → 기술주 하락"

    if market_down and tech_weak and rates_up:
        return "금리 상승 → 밸류 압박 → 기술주 하락"

    if tech_weak and oil_up:
        return "유가 급등 → 인플레 재압력 → 기술주 약세"

    if tech_weak and rates_up:
        return "금리 상승 → 밸류 압박 → 기술주 약세"

    if oil_up:
        return "유가 급등 → 인플레 압력 → 섹터 양극화"

    if rates_up:
        return "금리 상승 → 밸류 조정 → 성장주 변동성 확대"

    return "시장 혼조 — 명확한 단일 드라이버 부재"
