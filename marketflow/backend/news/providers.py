from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import requests


@dataclass
class Article:
    id: str
    title: str
    publisher: str
    published_at: str
    url: str
    summary: str = ""
    tickers: Optional[List[str]] = None
    topics: Optional[List[str]] = None
    source: str = "yahoo"
    score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        if not d.get("tickers"):
            d["tickers"] = []
        if not d.get("topics"):
            d["topics"] = []
        return d


class NewsProvider:
    name: str = "base"

    def fetch_top_news(
        self,
        *,
        region: str,
        tickers: List[str],
        topics: List[str],
        date_from: Optional[str],
        date_to: Optional[str],
        limit: int,
    ) -> List[Article]:
        raise NotImplementedError


class YahooNewsProvider(NewsProvider):
    name = "yahoo"
    _endpoint = "https://query1.finance.yahoo.com/v1/finance/search"

    def _fetch_for_query(self, query: str, limit: int) -> List[Article]:
        try:
            res = requests.get(
                self._endpoint,
                params={
                    "q": query,
                    "quotesCount": 0,
                    "newsCount": max(1, min(20, int(limit))),
                    "enableFuzzyQuery": "false",
                    "enableNews": "true",
                },
                timeout=12,
            )
            res.raise_for_status()
            payload = res.json()
        except Exception:
            return []

        out: List[Article] = []
        for item in payload.get("news", []) or []:
            title = str(item.get("title") or "").strip()
            link = str(item.get("link") or "").strip()
            if not title or not link:
                continue
            pub_ts = item.get("providerPublishTime")
            if isinstance(pub_ts, (int, float)):
                published = datetime.fromtimestamp(float(pub_ts), tz=timezone.utc).isoformat()
            else:
                published = datetime.now(timezone.utc).isoformat()
            out.append(
                Article(
                    id=str(item.get("uuid") or link),
                    title=title,
                    publisher=str(item.get("publisher") or "Yahoo Finance"),
                    published_at=published,
                    url=link,
                    summary=str(item.get("summary") or ""),
                    source="yahoo",
                )
            )
        return out

    def fetch_top_news(
        self,
        *,
        region: str,
        tickers: List[str],
        topics: List[str],
        date_from: Optional[str],
        date_to: Optional[str],
        limit: int,
    ) -> List[Article]:
        # Buckets: market + macro + cross-asset
        market_queries = ["SPY", "QQQ", "IWM", "DIA"]
        macro_queries = ["^VIX", "TLT", "HYG", "federal reserve", "treasury yield"]
        cross_queries = ["BTC-USD", "GLD", "bitcoin", "gold real yield"]
        queries = market_queries + macro_queries + cross_queries

        # Optional watchlist tickers
        for t in tickers[:5]:
            if t and t not in queries:
                queries.append(t)

        dedup: Dict[str, Article] = {}
        per_query = max(3, min(10, limit))
        for q in queries:
            for art in self._fetch_for_query(q, per_query):
                key = art.id or art.url
                if key not in dedup:
                    dedup[key] = art
        return list(dedup.values())


class PremiumNewsProvider(NewsProvider):
    def __init__(self, vendor: str = "polygon") -> None:
        self.vendor = vendor
        self.name = "premium"

    def fetch_top_news(
        self,
        *,
        region: str,
        tickers: List[str],
        topics: List[str],
        date_from: Optional[str],
        date_to: Optional[str],
        limit: int,
    ) -> List[Article]:
        # Placeholder adapter for vendor mapping.
        # Keeps downstream schema stable; implementation can be swapped later.
        return []
