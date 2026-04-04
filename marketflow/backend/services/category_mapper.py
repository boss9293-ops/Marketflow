from __future__ import annotations

from typing import Any


def map_news_to_category(article: dict[str, Any]) -> str:
    text = (str(article.get("title", "")) + " " + str(article.get("summary", ""))).lower()

    if any(k in text for k in ["s&p", "dow", "nasdaq", "market falls", "market rises"]):
        return "index"

    if any(k in text for k in ["energy", "financial", "tech sector", "sector"]):
        return "sector"

    if any(k in text for k in ["oil", "crude", "gold", "yield", "treasury", "dollar"]):
        return "macro"

    if any(k in text for k in ["earnings", "guidance", "revenue", "eps", "forecast"]):
        return "earnings"

    if any(k in text for k in ["nvidia", "apple", "tesla", "microsoft", "stock"]):
        return "stock"

    return "event"

