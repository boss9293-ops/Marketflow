from __future__ import annotations

from typing import Any


SOURCE_SCORE: dict[str, int] = {
    "news": 3,
    "analysis": 2,
    "video": 1,
    "roundup": 1,
    "metrics": -3,
    "calendar": -3,
    "archive": -3,
    "unknown": 0,
}


def detect_source_type(url: str, title: str) -> str:
    raw_url = str(url or "").lower()
    raw_title = str(title or "").lower()

    if "calendar" in raw_url or "calendar" in raw_title:
        return "calendar"
    if "key-metrics" in raw_url or "financial-strength" in raw_url:
        return "metrics"
    if "archive" in raw_url or "archive" in raw_title:
        return "archive"
    if "video" in raw_url:
        return "video"
    if "week that was" in raw_title or "roundup" in raw_title:
        return "roundup"
    if "analysis" in raw_title or "outlook" in raw_title:
        return "analysis"
    if "news" in raw_url or "article" in raw_url:
        return "news"
    return "unknown"


def _cluster_urls_and_titles(cluster: dict[str, Any]) -> tuple[list[str], list[str]]:
    urls: list[str] = []
    titles: list[str] = []

    raw_urls = cluster.get("urls")
    raw_titles = cluster.get("titles")
    if isinstance(raw_urls, list) and isinstance(raw_titles, list):
        urls = [str(item or "") for item in raw_urls]
        titles = [str(item or "") for item in raw_titles]
        return urls, titles

    articles = cluster.get("articles")
    if isinstance(articles, list):
        for article in articles:
            if not isinstance(article, dict):
                continue
            urls.append(str(article.get("url") or ""))
            titles.append(str(article.get("title") or ""))
    return urls, titles


def score_cluster(cluster: dict[str, Any]) -> float:
    base_score = float(cluster.get("source_score") or 0.0)
    urls, titles = _cluster_urls_and_titles(cluster)
    type_scores: list[int] = []
    for url, title in zip(urls, titles):
        source_type = detect_source_type(url, title)
        type_scores.append(int(SOURCE_SCORE.get(source_type, 0)))
    avg_type_score = (sum(type_scores) / len(type_scores)) if type_scores else 0.0
    return float(base_score + avg_type_score)


def count_news_sources(cluster: dict[str, Any]) -> int:
    urls, titles = _cluster_urls_and_titles(cluster)
    news_count = 0
    for url, title in zip(urls, titles):
        if detect_source_type(url, title) == "news":
            news_count += 1
    return news_count


def is_valid_cluster(cluster: dict[str, Any], min_score: float = 2.0) -> bool:
    if score_cluster(cluster) < float(min_score):
        return False
    if count_news_sources(cluster) == 0:
        return False
    return True

