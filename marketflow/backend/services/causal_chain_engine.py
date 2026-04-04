from __future__ import annotations

from typing import Any


def build_causal_chain(fact: dict[str, Any]) -> str:
    macro_factors = fact.get("macro_factors") if isinstance(fact.get("macro_factors"), dict) else {}
    oil_factor = macro_factors.get("oil") if isinstance(macro_factors.get("oil"), dict) else {}
    rates_factor = macro_factors.get("rates") if isinstance(macro_factors.get("rates"), dict) else {}

    oil_status = str(oil_factor.get("status") or "")
    rates_status = str(rates_factor.get("status") or "")
    sectors = fact.get("sectors") if isinstance(fact.get("sectors"), list) else []
    sectors_text = " ".join([str(item) for item in sectors])

    chain: list[str] = []

    if oil_status in {"inflationary_pressure", "supply_shock"}:
        chain.append("유가 급등")
        chain.append("→ 인플레이션 압력")
        if rates_status in {"rate_pressure", "tightening_signal"}:
            chain.append("→ 금리 상승")
        chain.append("→ 기술주 밸류 압박")

    if not chain and rates_status in {"rate_pressure", "tightening_signal"}:
        chain = ["금리 상승", "→ 밸류 압박", "→ 기술주 하락"]

    if not chain and "기술주 약세" in sectors_text:
        chain = ["리스크 회피 확대", "→ 고밸류 조정", "→ 기술주 하락"]

    if not chain:
        chain = ["시장 혼조", "→ 단일 인과 미형성"]

    return " ".join(chain)
