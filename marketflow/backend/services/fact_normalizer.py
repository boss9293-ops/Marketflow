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


def normalize_sectors(sectors_raw: Any) -> list[str]:
    result: list[str] = []
    for sector in _as_list(sectors_raw):
        text = sector.lower()
        if "energy" in text or "에너지" in text or "유가" in text:
            result.append("에너지 강세")
        elif "tech" in text or "기술" in text or "semiconductor" in text or "반도체" in text:
            result.append("기술주 약세")
        elif "financial" in text or "금융" in text or "bank" in text:
            result.append("금융 혼조")
        elif "defensive" in text or "방어" in text:
            result.append("방어주 상대 강세")

    if not result:
        result = ["섹터 혼조"]
    return _dedupe(result, max_items=3)


def normalize_macro(macro_raw: Any) -> dict[str, str]:
    raw = macro_raw if isinstance(macro_raw, dict) else {}

    rates_raw = str(raw.get("rates") or "").strip()
    oil_raw = str(raw.get("oil") or "").strip()
    dollar_raw = str(raw.get("dollar") or "").strip()
    inflation_raw = str(raw.get("inflation") or "").strip()

    if "하락" in rates_raw:
        rates = "10Y 금리 하락"
    elif "변동" in rates_raw or "혼조" in rates_raw:
        rates = "금리 혼조"
    else:
        rates = "금리 상승"

    oil = "유가 하락" if "하락" in oil_raw else "유가 상승"
    dollar = "달러 강세" if "강세" in dollar_raw else "달러 약세"
    inflation = "인플레이션 완화" if "완화" in inflation_raw else "인플레이션 압력"

    return {
        "rates": rates,
        "oil": oil,
        "dollar": dollar,
        "inflation": inflation,
    }


def normalize_movers(movers_raw: Any, articles: list[dict[str, Any]] | None = None) -> list[str]:
    enhanced: list[str] = []
    source = _as_list(movers_raw)

    if articles:
        article_text = " ".join(
            [
                f"{str(article.get('title') or '')} {str(article.get('snippet') or article.get('summary') or '')}".lower()
                for article in articles[:30]
                if isinstance(article, dict)
            ]
        )
        if "nvda" in article_text or "nvidia" in article_text:
            source.append("NVDA")
        if "oil" in article_text or "energy" in article_text or "xom" in article_text or "cvx" in article_text:
            source.append("에너지")

    for mover in source:
        text = mover.lower()
        if "nvda" in text or "nvidia" in text:
            enhanced.append("NVDA 약세 — 차익실현 압력")
        elif "에너지" in text or "oil" in text or "energy" in text or "xom" in text or "cvx" in text:
            enhanced.append("에너지주 강세 — 유가 상승 반영")
        elif "tsla" in text or "tesla" in text:
            enhanced.append("TSLA 변동성 확대 — 성장주 민감도 반영")
        elif "aapl" in text or "apple" in text:
            enhanced.append("AAPL 약세 — 대형주 리밸런싱 압력")

    if not enhanced:
        enhanced.append("대형 기술주 중심 변동성 확대")
    return _dedupe(enhanced, max_items=3)


def normalize_events(events_raw: Any) -> list[str]:
    result: list[str] = []
    for event in _as_list(events_raw):
        text = event.lower()
        if "금리" in text or "fed" in text or "yield" in text or "treasury" in text:
            result.append("금리 인하 기대 후퇴")
        elif "유가" in text or "oil" in text or "energy" in text or "crude" in text:
            result.append("유가 상승")
        elif "기술" in text or "tech" in text or "ai" in text or "semiconductor" in text:
            result.append("기술주 차익실현")
        elif "war" in text or "iran" in text or "중동" in text:
            result.append("중동 리스크 지속")

    if not result:
        result = ["금리 인하 기대 후퇴", "유가 상승"]

    return _dedupe(result, max_items=3)

