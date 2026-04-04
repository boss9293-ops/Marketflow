from __future__ import annotations

from typing import Any


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _dedupe(items: list[str], max_items: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        out.append(text)
        seen.add(key)
        if len(out) >= max_items:
            break
    return out


def enhance_events(events: Any) -> list[str]:
    result: list[str] = []

    for event in _as_list(events):
        text = event.lower()
        if "금리" in text or "fed" in text or "yield" in text:
            result.append("금리 인하 기대 붕괴")
        elif "유가" in text or "oil" in text or "crude" in text or "energy" in text:
            result.append("유가 급등")
        elif "중동" in text or "iran" in text or "war" in text:
            result.append("중동 리스크 확산")
        elif "기술" in text or "tech" in text or "ai" in text:
            result.append("기술주 차익실현 확대")

    if not result:
        result = ["금리 인하 기대 붕괴", "유가 급등"]
    return _dedupe(result, max_items=3)


def enhance_sectors(sectors: Any, events: Any) -> list[str]:
    result: list[str] = []
    events_text = " ".join(_as_list(events))

    for sector in _as_list(sectors):
        text = sector.lower()
        if "에너지" in text or "energy" in text:
            if "유가 급등" in events_text or "유가 상승" in events_text:
                result.append("유가 급등 → 에너지 섹터 강세")
            else:
                result.append("원자재 수급 개선 → 에너지 섹터 강세")
        elif "기술" in text or "tech" in text:
            if "금리 인하 기대 붕괴" in events_text or "금리 인하 기대 후퇴" in events_text:
                result.append("금리 부담 → 기술주 약세")
            else:
                result.append("밸류에이션 부담 → 기술주 약세")
        elif "금융" in text or "financial" in text:
            result.append("경기/금리 해석 엇갈림 → 금융 혼조")
        elif "방어" in text or "defensive" in text:
            result.append("리스크 회피 수요 유입 → 방어주 상대 강세")

    if not result:
        result = ["경기/금리 해석 엇갈림 → 섹터 혼조"]
    return _dedupe(result, max_items=3)


def enhance_macro(macro: Any) -> dict[str, str]:
    return {
        "rates": "금리 상승 압력",
        "oil": "유가 급등",
        "dollar": "달러 강세 유지",
        "inflation": "인플레이션 재압력",
    }


def enhance_movers(movers: Any) -> list[str]:
    result: list[str] = []

    for mover in _as_list(movers):
        text = mover.lower()
        if "nvda" in text or "nvidia" in text:
            result.append("NVDA 하락 — 고밸류 차익실현")
        elif "에너지" in text or "energy" in text or "oil" in text or "xom" in text or "cvx" in text:
            result.append("에너지주 상승 — 유가 급등 수혜")
        elif "tsla" in text or "tesla" in text:
            result.append("TSLA 변동성 확대 — 성장주 민감도 반영")

    if not result:
        result = ["금리/유가 충돌 → 대형 기술주 변동성 확대"]
    return _dedupe(result, max_items=3)
