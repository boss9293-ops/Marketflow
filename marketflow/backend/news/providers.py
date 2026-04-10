from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote_plus
import re
import xml.etree.ElementTree as ET

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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _dedupe_key(article: Article) -> str:
    title = re.sub(r"\s+", " ", _safe_text(article.title)).lower().strip()
    url = re.sub(r"\s+", "", _safe_text(article.url)).lower().strip()
    day = _safe_text(article.published_at)[:10]
    if title:
        return f"title::{title}::{day}"
    if url:
        return f"url::{url}"
    return f"id::{_safe_text(article.id).lower()}"


def _merge_articles(articles: Iterable[Article]) -> List[Article]:
    deduped: Dict[str, Article] = {}
    for article in articles:
        key = _dedupe_key(article)
        if not key:
            continue
        prev = deduped.get(key)
        if prev is None:
            deduped[key] = article
            continue
        prev_score = getattr(prev, "score", 0.0) or 0.0
        current_score = getattr(article, "score", 0.0) or 0.0
        if current_score >= prev_score:
            deduped[key] = article
    return list(deduped.values())


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
            title = _safe_text(item.get("title"))
            link = _safe_text(item.get("link"))
            if not title or not link:
                continue
            pub_ts = item.get("providerPublishTime")
            if isinstance(pub_ts, (int, float)):
                published = datetime.fromtimestamp(float(pub_ts), tz=timezone.utc).isoformat()
            else:
                published = _now_iso()
            out.append(
                Article(
                    id=_safe_text(item.get("uuid") or link or title),
                    title=title,
                    publisher=_safe_text(item.get("publisher") or "Yahoo Finance") or "Yahoo Finance",
                    published_at=published,
                    url=link,
                    summary=_safe_text(item.get("summary")),
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
        market_queries = [
            "SPY",
            "QQQ",
            "IWM",
            "DIA",
            "XLK",
            "XLF",
            "XLE",
            "XLV",
            "XLY",
            "XLP",
            "SMH",
        ]
        macro_queries = [
            "^VIX",
            "TLT",
            "HYG",
            "federal reserve",
            "treasury yield",
            "inflation",
            "jobs report",
            "earnings",
        ]
        cross_queries = [
            "BTC-USD",
            "GLD",
            "gold",
            "oil",
            "semiconductors",
        ]
        queries = market_queries + macro_queries + cross_queries

        for t in tickers:
            q = _safe_text(t)
            if q and q not in queries:
                queries.append(q)
        for topic in topics:
            q = _safe_text(topic)
            if q and q not in queries:
                queries.append(q)

        dedup: Dict[str, Article] = {}
        per_query = max(4, min(12, limit))
        for q in queries:
            for art in self._fetch_for_query(q, per_query):
                key = _dedupe_key(art)
                if key not in dedup:
                    dedup[key] = art
        return list(dedup.values())


class GoogleNewsRSSProvider(NewsProvider):
    name = "google_news"
    _endpoint = "https://news.google.com/rss/search"

    def _fetch_for_query(self, query: str, limit: int, window_days: int) -> List[Article]:
        q = _safe_text(query)
        if not q:
            return []
        rss_query = f"{q} when:{window_days}d"
        try:
            res = requests.get(
                self._endpoint,
                params={
                    "q": rss_query,
                    "hl": "en-US",
                    "gl": "US",
                    "ceid": "US:en",
                },
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=12,
            )
            res.raise_for_status()
            root = ET.fromstring(res.text)
        except Exception:
            return []

        out: List[Article] = []
        for item in root.findall(".//item")[: max(1, min(20, int(limit)))]:
            title = _safe_text(item.findtext("title"))
            link = _safe_text(item.findtext("link"))
            if not title or not link:
                continue
            pub_text = _safe_text(item.findtext("pubDate"))
            try:
                published_dt = parsedate_to_datetime(pub_text) if pub_text else None
                if published_dt is None:
                    raise ValueError
                if published_dt.tzinfo is None:
                    published_dt = published_dt.replace(tzinfo=timezone.utc)
                published = published_dt.astimezone(timezone.utc).isoformat()
            except Exception:
                published = _now_iso()
            source_el = item.find("source")
            publisher = _safe_text(source_el.text if source_el is not None else None) or "Google News"
            out.append(
                Article(
                    id=_safe_text(link or title),
                    title=title,
                    publisher=publisher,
                    published_at=published,
                    url=link,
                    summary=_safe_text(item.findtext("description")),
                    source="google_news",
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
        base_queries = [
            "stock market",
            "U.S. stocks",
            "S&P 500",
            "Nasdaq",
            "Dow Jones",
            "Federal Reserve",
            "Treasury yields",
            "inflation",
            "earnings",
            "oil prices",
            "gold prices",
            "bitcoin",
            "semiconductors",
            "technology stocks",
            "bank stocks",
        ]
        queries = base_queries[:]
        for t in tickers:
            q = _safe_text(t)
            if q and q not in queries:
                queries.append(q)
        for topic in topics:
            q = _safe_text(topic)
            if q and q not in queries:
                queries.append(q)

        window_days = 3
        if date_from and date_to:
            try:
                from_dt = datetime.fromisoformat(date_from)
                to_dt = datetime.fromisoformat(date_to)
                window_days = max(1, min(7, (to_dt.date() - from_dt.date()).days + 1))
            except Exception:
                window_days = 3

        dedup: Dict[str, Article] = {}
        per_query = max(3, min(8, limit))
        for q in queries:
            for art in self._fetch_for_query(q, per_query, window_days):
                key = _dedupe_key(art)
                if key not in dedup:
                    dedup[key] = art
        return list(dedup.values())


class ReutersRSSProvider(NewsProvider):
    name = "reuters_rss"
    _feeds = [
        "https://feeds.reuters.com/reuters/businessNews",
        "https://feeds.reuters.com/reuters/marketsNews",
        "https://feeds.reuters.com/reuters/topNews",
    ]

    def _fetch_feed(self, feed_url: str, limit: int) -> List[Article]:
        try:
            res = requests.get(feed_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
            res.raise_for_status()
            root = ET.fromstring(res.text)
        except Exception:
            return []

        out: List[Article] = []
        for item in root.findall(".//item")[: max(1, min(20, int(limit)))]:
            title = _safe_text(item.findtext("title"))
            link = _safe_text(item.findtext("link"))
            if not title or not link:
                continue
            pub_text = _safe_text(item.findtext("pubDate"))
            try:
                published_dt = parsedate_to_datetime(pub_text) if pub_text else None
                if published_dt is None:
                    raise ValueError
                if published_dt.tzinfo is None:
                    published_dt = published_dt.replace(tzinfo=timezone.utc)
                published = published_dt.astimezone(timezone.utc).isoformat()
            except Exception:
                published = _now_iso()
            out.append(
                Article(
                    id=_safe_text(link or title),
                    title=title,
                    publisher="Reuters",
                    published_at=published,
                    url=link,
                    summary=_safe_text(item.findtext("description")),
                    source="reuters",
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
        per_feed = max(3, min(10, limit))
        out: List[Article] = []
        for feed_url in self._feeds:
            out.extend(self._fetch_feed(feed_url, per_feed))
        return _merge_articles(out)


class CompositeNewsProvider(NewsProvider):
    name = "composite"

    def __init__(self, providers: Optional[List[NewsProvider]] = None) -> None:
        self.providers = providers or [YahooNewsProvider(), GoogleNewsRSSProvider(), ReutersRSSProvider()]

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
        pool: List[Article] = []
        sub_limit = max(5, min(15, limit * 2))
        for provider in self.providers:
            try:
                pool.extend(
                    provider.fetch_top_news(
                        region=region,
                        tickers=tickers,
                        topics=topics,
                        date_from=date_from,
                        date_to=date_to,
                        limit=sub_limit,
                    )
                )
            except Exception:
                continue
        return _merge_articles(pool)


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
