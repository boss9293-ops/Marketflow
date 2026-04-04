from __future__ import annotations

from typing import Any


def select_top_articles(
    grouped_articles: dict[str, list[dict[str, Any]]],
    max_per_category: int = 2,
) -> dict[str, list[dict[str, Any]]]:
    selected: dict[str, list[dict[str, Any]]] = {}

    for category, articles in grouped_articles.items():
        selected[category] = list(articles[:max_per_category])

    return selected

