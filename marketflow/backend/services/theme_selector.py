from __future__ import annotations

from typing import Any

from .news_cluster import is_valid_cluster
from .news_cluster import score_cluster


def rank_valid_theme_clusters(clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(clusters, list):
        return []
    valid_clusters = [cluster for cluster in clusters if isinstance(cluster, dict) and is_valid_cluster(cluster)]
    valid_clusters.sort(key=score_cluster, reverse=True)
    return valid_clusters


def select_valid_theme_clusters(clusters: list[dict[str, Any]], max_items: int = 3) -> list[dict[str, Any]]:
    ranked = rank_valid_theme_clusters(clusters)
    return ranked[: max(1, int(max_items))]
