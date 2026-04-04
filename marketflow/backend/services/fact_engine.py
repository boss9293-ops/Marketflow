from __future__ import annotations

from typing import Any


def _article_text(article: dict[str, Any]) -> str:
    title = str(article.get("title") or "").strip()
    snippet = str(article.get("snippet") or article.get("summary") or "").strip()
    return f"{title} {snippet}".lower()


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def extract_macro_signals(articles: list[dict[str, Any]]) -> dict[str, str]:
    signals: dict[str, str | None] = {
        "rates": None,
        "oil": None,
        "dollar": None,
        "inflation": None,
    }

    up_words = ["rise", "rises", "rising", "jump", "surge", "higher", "up", "gain", "climb"]
    down_words = ["fall", "falls", "falling", "lower", "down", "drop", "decline", "slip"]

    for article in articles:
        text = _article_text(article)

        if _contains_any(text, ["oil", "crude", "brent", "wti"]):
            if _contains_any(text, up_words):
                signals["oil"] = "상승"
            elif _contains_any(text, down_words):
                signals["oil"] = "하락"
            else:
                signals["oil"] = "변동"

        if _contains_any(text, ["yield", "yields", "treasury", "bond yield", "rates", "rate"]):
            if _contains_any(text, up_words):
                signals["rates"] = "상승"
            elif _contains_any(text, down_words):
                signals["rates"] = "하락"
            else:
                signals["rates"] = "변동"

        if _contains_any(text, ["dollar", "dxy", "greenback"]):
            if _contains_any(text, up_words):
                signals["dollar"] = "강세"
            elif _contains_any(text, down_words):
                signals["dollar"] = "약세"
            else:
                signals["dollar"] = "혼조"

        if _contains_any(text, ["inflation", "cpi", "pce", "price pressure"]):
            if _contains_any(text, ["cooling", "easing", "softening", "down"]):
                signals["inflation"] = "완화 신호"
            else:
                signals["inflation"] = "압력 지속"

    output = {key: value for key, value in signals.items() if isinstance(value, str) and value.strip()}
    if not output:
        output = {"rates": "변동"}
    return output


def extract_events(clusters: list[dict[str, Any]]) -> list[str]:
    events: list[str] = []

    for cluster in clusters[:5]:
        titles = cluster.get("titles")
        if not isinstance(titles, list):
            articles = cluster.get("articles") if isinstance(cluster.get("articles"), list) else []
            titles = [str((article or {}).get("title") or "") for article in articles[:8]]
        text = " ".join([str(title) for title in titles]).lower()

        if _contains_any(text, ["oil", "crude", "brent", "wti", "energy"]):
            events.append("유가 상승 및 에너지 시장 압력")
        elif _contains_any(text, ["fed", "fomc", "rate", "rates", "treasury", "yield"]):
            events.append("연준 금리 경로 불확실성 확대")
        elif _contains_any(text, ["war", "iran", "israel", "middle east", "strait"]):
            events.append("중동 지정학 리스크 지속")
        elif _contains_any(text, ["earnings", "guidance", "forecast", "revenue", "eps"]):
            events.append("실적 가이던스 불확실성 확대")
        elif _contains_any(text, ["tech", "ai", "semiconductor", "chip"]):
            events.append("기술주 중심 수급 쏠림 재확인")

    deduped: list[str] = []
    seen: set[str] = set()
    for item in events:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        deduped.append(item.strip())
        seen.add(key)

    fallback_events = [
        "연준 금리 경로 재평가 진행",
        "원자재와 금리 변수의 동시 점검 국면",
        "섹터 간 순환매 흐름 확대",
    ]
    for item in fallback_events:
        if len(deduped) >= 3:
            break
        if item.lower() not in seen:
            deduped.append(item)
            seen.add(item.lower())

    return deduped[:3]


def extract_sector_flow(articles: list[dict[str, Any]]) -> list[str]:
    sector_map = {
        "energy": 0,
        "tech": 0,
        "financial": 0,
    }

    for article in articles:
        text = _article_text(article)

        if _contains_any(text, ["oil", "crude", "energy", "brent", "wti", "xom", "cvx"]):
            sector_map["energy"] += 1
        if _contains_any(text, ["tech", "ai", "semiconductor", "chip", "software", "nvidia", "apple", "microsoft"]):
            sector_map["tech"] += 1
        if _contains_any(text, ["bank", "banks", "financial", "credit", "lender", "jpmorgan", "goldman"]):
            sector_map["financial"] += 1

    result: list[str] = []
    if sector_map["energy"] > 0:
        result.append("에너지 관련 이슈 증가")
    if sector_map["tech"] > 0:
        result.append("기술주 관련 이슈 증가")
    if sector_map["financial"] > 0:
        result.append("금융주 관련 이슈 증가")

    if not result:
        result.append("섹터 전반 혼조 흐름")

    return result[:3]


def extract_movers(articles: list[dict[str, Any]]) -> list[str]:
    movers: list[str] = []

    for article in articles:
        title = str(article.get("title") or "").lower()

        if "nvidia" in title or "nvda" in title:
            movers.append("NVDA 관련 뉴스 집중")
        if "tesla" in title or "tsla" in title:
            movers.append("TSLA 변동성 확대")
        if "apple" in title or "aapl" in title:
            movers.append("AAPL 관련 뉴스 유입")
        if "microsoft" in title or "msft" in title:
            movers.append("MSFT 관련 뉴스 유입")
        if _contains_any(title, ["oil", "energy", "exxon", "chevron"]):
            movers.append("에너지 종목 강세")

    deduped: list[str] = []
    seen: set[str] = set()
    for item in movers:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        deduped.append(item.strip())
        seen.add(key)

    if not deduped:
        deduped.append("특정 종목 집중 움직임 없음")

    return deduped[:3]


def build_fact_payload(articles: list[dict[str, Any]], clusters: list[dict[str, Any]]) -> dict[str, Any]:
    macro = extract_macro_signals(articles)
    events = extract_events(clusters)
    sectors = extract_sector_flow(articles)
    movers = extract_movers(articles)

    if len(events) < 2:
        events = (events + ["연준 금리 경로 재평가 진행", "섹터 간 순환매 흐름 확대"])[:2]
    if not movers:
        movers = ["특정 종목 집중 움직임 없음"]
    if not sectors:
        sectors = ["섹터 전반 혼조 흐름"]
    if not macro:
        macro = {"rates": "변동"}

    return {
        "macro": macro,
        "events": events[:3],
        "sectors": sectors[:3],
        "movers": movers[:3],
    }

