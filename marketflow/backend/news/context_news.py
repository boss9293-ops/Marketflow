from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from .providers import Article, CompositeNewsProvider, GoogleNewsRSSProvider, PremiumNewsProvider, ReutersRSSProvider, YahooNewsProvider

try:
    from backend.services.data_contract import artifact_path as contract_artifact_path
except Exception:
    contract_artifact_path = None  # type: ignore[assignment]


KEYWORDS = [
    "fed", "powell", "rate", "yield", "treasury", "cpi", "ppi", "jobs", "payroll",
    "liquidity", "qt", "qe", "balance sheet", "rrp", "repo", "credit spread",
    "vix", "volatility", "bitcoin", "btc", "gold", "real yield", "tips", "m2",
]
PREFERRED_PUBLISHER_BONUS = {
    "Reuters": 2.4,
    "Associated Press": 2.2,
    "AP News": 2.2,
    "AP": 2.2,
    "Yahoo Finance": 1.6,
    "MarketWatch": 1.4,
    "CNBC": 1.2,
    "Nasdaq": 1.1,
    "Benzinga": 0.8,
}
BLOCKED_SOURCE_PATTERNS = [
    re.compile(r"tipranks", re.IGNORECASE),
    re.compile(r"barron'?s", re.IGNORECASE),
    re.compile(r"seeking alpha", re.IGNORECASE),
    re.compile(r"\bwsj\b", re.IGNORECASE),
    re.compile(r"wall street journal", re.IGNORECASE),
    re.compile(r"financial times", re.IGNORECASE),
    re.compile(r"bloomberg", re.IGNORECASE),
    re.compile(r"press release", re.IGNORECASE),
    re.compile(r"pr newswire", re.IGNORECASE),
    re.compile(r"business wire", re.IGNORECASE),
    re.compile(r"accesswire", re.IGNORECASE),
    re.compile(r"globenewswire", re.IGNORECASE),
    re.compile(r"sponsored", re.IGNORECASE),
    re.compile(r"partner content", re.IGNORECASE),
    re.compile(r"paid content", re.IGNORECASE),
]
PROMO_TEXT_PATTERNS = [
    re.compile(r"press release", re.IGNORECASE),
    re.compile(r"sponsored", re.IGNORECASE),
    re.compile(r"partner content", re.IGNORECASE),
    re.compile(r"paid content", re.IGNORECASE),
]
ALLOW_PAID_NEWS = os.environ.get("NEWS_ALLOW_PAID_SOURCES", "false").strip().lower() in {"1", "true", "yes", "y"}
NEWS_LOOKBACK_DAYS = max(1, min(7, int(os.environ.get("NEWS_LOOKBACK_DAYS", "3") or 3)))
NEWS_MIN_SELECTED = max(1, min(10, int(os.environ.get("NEWS_MIN_SELECTED", "3") or 3)))
ET_ZONE = ZoneInfo("America/New_York")
MARKET_OPEN_MINUTES_ET = 9 * 60 + 30
MARKET_CLOSE_MINUTES_ET = 16 * 60 + 30
FORBIDDEN_PATTERNS = [
    (re.compile(r"\bcrash\b", re.IGNORECASE), "macro stress"),
    (re.compile(r"\bwill\b", re.IGNORECASE), "may"),
    (re.compile(r"\bguarantee(d)?\b", re.IGNORECASE), "context"),
    (re.compile(r"\bstrong upside\b", re.IGNORECASE), "upside sensitivity"),
    (re.compile(r"\bbuy\b", re.IGNORECASE), "add"),
    (re.compile(r"\bsell\b", re.IGNORECASE), "reduce"),
]


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _artifact_file(relative_path: str) -> str:
    rel = str(relative_path or "").replace("\\", "/").strip("/")
    if contract_artifact_path is not None:
        try:
            return str(contract_artifact_path(rel))
        except Exception:
            pass
    if not rel:
        return os.path.join(_repo_root(), "backend", "output")
    if rel.startswith("cache/"):
        return os.path.join(_repo_root(), "backend", "output", "cache", rel[len("cache/"):])
    return os.path.join(_repo_root(), "backend", "output", rel)


def _output_cache_dir() -> str:
    return os.path.join(_repo_root(), "backend", "output", "cache")


def _news_cache_dir(date_str: str, region: str) -> str:
    return os.path.join(_repo_root(), "backend", "output", "news_cache", date_str)


def _safe_read_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _latest_macro_snapshot() -> Optional[Dict[str, Any]]:
    d = os.path.join(_repo_root(), "backend", "storage", "macro_snapshots")
    if not os.path.isdir(d):
        return None
    files = sorted(fn for fn in os.listdir(d) if re.match(r"^\d{4}-\d{2}-\d{2}\.json$", fn))
    if not files:
        return None
    return _safe_read_json(os.path.join(d, files[-1]))


def _sanitize_text(text: str) -> str:
    out = text or ""
    for rx, rep in FORBIDDEN_PATTERNS:
        out = rx.sub(rep, out)
    return out


def _source_text(article: Article) -> str:
    return f"{article.publisher or ''} {article.source or ''}".strip()


def _is_blocked_source(article: Article) -> bool:
    source_text = _source_text(article).lower()
    if not source_text:
        return False
    return any(pattern.search(source_text) for pattern in BLOCKED_SOURCE_PATTERNS)


def _has_promo_signals(article: Article) -> bool:
    text = f"{article.title or ''} {article.summary or ''}"
    return any(pattern.search(text) for pattern in PROMO_TEXT_PATTERNS)


def _article_score(article: Article, now_utc: datetime) -> float:
    text = f"{article.title} {article.summary}".lower()
    if _is_blocked_source(article) or _has_promo_signals(article):
        return -999.0
    keyword_hits = sum(1 for k in KEYWORDS if k in text)
    try:
        pub_dt = datetime.fromisoformat(article.published_at.replace("Z", "+00:00"))
    except Exception:
        pub_dt = now_utc - timedelta(days=2)
    age_hours = (now_utc - pub_dt).total_seconds() / 3600.0
    recency = 3.0 if age_hours <= 6 else (2.0 if age_hours <= 24 else (1.0 if age_hours <= 72 else 0.0))
    pub_weight = 0.0
    for name, w in PREFERRED_PUBLISHER_BONUS.items():
        if name.lower() in _source_text(article).lower():
            pub_weight = max(pub_weight, w)
    return keyword_hits * 2.0 + recency + pub_weight


def _lookback_days_for_slot(slot: str | None) -> int:
    slot_value = (slot or "").strip().lower()
    if slot_value == "preopen":
        return min(7, max(NEWS_LOOKBACK_DAYS + 1, 4))
    if slot_value in {"morning", "close"}:
        return NEWS_LOOKBACK_DAYS
    return max(NEWS_LOOKBACK_DAYS, 3)


def _dedupe_articles(articles: List[Article]) -> List[Article]:
    deduped: Dict[str, Article] = {}
    for article in articles:
        key = (
            (article.id or "").strip().lower()
            or (article.url or "").strip().lower()
            or (article.title or "").strip().lower()
        )
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


def _pick_provider() -> Tuple[str, Any]:
    mode = os.environ.get("NEWS_PROVIDER", "composite").strip().lower() or "composite"
    if mode == "premium" and ALLOW_PAID_NEWS:
        vendor = os.environ.get("PREMIUM_VENDOR", "polygon").strip().lower() or "polygon"
        return mode, PremiumNewsProvider(vendor=vendor)
    if mode == "yahoo":
        return mode, YahooNewsProvider()
    if mode == "google":
        return mode, GoogleNewsRSSProvider()
    if mode == "reuters":
        return mode, ReutersRSSProvider()
    if mode in {"composite", "broad", "hybrid"}:
        return mode, CompositeNewsProvider()
    return "yahoo", YahooNewsProvider()


def _load_last_good(region: str) -> Optional[Dict[str, Any]]:
    p = os.path.join(_repo_root(), "backend", "output", "news_cache", f"last_good_{region}.json")
    return _safe_read_json(p)


def _save_last_good(region: str, payload: Dict[str, Any]) -> None:
    p = os.path.join(_repo_root(), "backend", "output", "news_cache", f"last_good_{region}.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _frontend_headlines_file() -> str:
    return _artifact_file("cache/market-headlines-history.json")


def _legacy_frontend_headlines_file() -> str:
    return os.path.join(_repo_root(), "frontend", ".cache", "market-headlines-history.json")


def _load_frontend_headlines() -> List[Dict[str, Any]]:
    candidates = [_frontend_headlines_file(), _legacy_frontend_headlines_file()]
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        data = _safe_read_json(candidate)
        if not isinstance(data, dict):
            continue
        rows = data.get("headlines") or []
        if not rows:
            continue
        return [row for row in rows if isinstance(row, dict)]
    return []


def _articles_from_frontend_headlines(rows: List[Dict[str, Any]]) -> List[Article]:
    articles: List[Article] = []
    for row in rows:
        title = str(row.get("headline") or "").strip()
        if not title:
            continue
        published_at = str(row.get("publishedAtET") or "").strip()
        if not published_at:
            published_at = datetime.now(timezone.utc).isoformat()
        articles.append(
            Article(
                id=str(row.get("id") or row.get("url") or title),
                title=title,
                publisher=str(row.get("source") or "Market Headlines"),
                published_at=published_at,
                url=str(row.get("url") or ""),
                summary=str(row.get("summary") or ""),
                tickers=[],
                topics=[],
                source="market-headlines",
            )
        )
    return articles


def _sensor_snapshot() -> Dict[str, Any]:
    snap = _latest_macro_snapshot() or {}
    c = snap.get("computed") or {}
    lpi = c.get("LPI") or {}
    rpi = c.get("RPI") or {}
    vri = c.get("VRI") or {}
    xconf = c.get("XCONF") or {}
    ghedge = c.get("GHEDGE") or {}
    mps = c.get("MPS") or {}
    return {
        "snapshot_date": snap.get("snapshot_date"),
        "LPI": {"status": lpi.get("status"), "value": lpi.get("value")},
        "RPI": {"status": rpi.get("status"), "value": rpi.get("value")},
        "VRI": {"status": vri.get("status"), "value": vri.get("value")},
        "XCONF": {"status": xconf.get("status"), "value": xconf.get("value")},
        "GHEDGE": {"status": ghedge.get("status"), "value": ghedge.get("value")},
        "MPS": {"status": mps.get("status"), "value": mps.get("value")},
    }

def _latest_validation_badge() -> Dict[str, Any]:
    d = os.path.join(_repo_root(), "backend", "storage", "validation_snapshots")
    if not os.path.isdir(d):
        return {"status": "Watch", "snapshot_date": None, "revision_detected": False}
    files = sorted(
        fn for fn in os.listdir(d)
        if fn.startswith("validation_snapshot_") and fn.endswith(".json")
    )
    if not files:
        return {"status": "Watch", "snapshot_date": None, "revision_detected": False}
    try:
        with open(os.path.join(d, files[-1]), "r", encoding="utf-8") as f:
            snap = json.load(f)
    except Exception:
        return {"status": "Watch", "snapshot_date": None, "revision_detected": False}

    regression = snap.get("regression") or {}
    revision_detected = bool(snap.get("revision_detected", False))
    status = "OK" if str(regression.get("status", "Watch")) == "OK" and not revision_detected else "Watch"
    return {
        "status": status,
        "snapshot_date": snap.get("snapshot_date"),
        "revision_detected": revision_detected,
    }


def _compose_news_brief(selected: List[Article], sensors: Dict[str, Any]) -> Dict[str, str]:
    lpi = ((sensors.get("LPI") or {}).get("status") or "NA")
    rpi = ((sensors.get("RPI") or {}).get("status") or "NA")
    vri = ((sensors.get("VRI") or {}).get("status") or "NA")
    xconf = ((sensors.get("XCONF") or {}).get("status") or "Mixed")

    if selected:
        top = selected[0]
        headline = _sanitize_text(top.title)
        summary = _sanitize_text(top.summary or "The lead headline is used as contextual evidence.")
        summary = summary.split(". ")[0] + "."
        connect = _sanitize_text(
            f"This headline is interpreted with LPI {lpi}, RPI {rpi}, VRI {vri}, and XCONF {xconf} as a sensor context."
        )
        return {
            "headline": headline,
            "summary_2sentences": f"{summary} {connect}",
        }
    return {
        "headline": "News unavailable; sensor-only context mode is active.",
        "summary_2sentences": _sanitize_text(
            f"Current interpretation relies on sensors only: LPI {lpi}, RPI {rpi}, VRI {vri}, XCONF {xconf}. This mode remains descriptive and non-predictive."
        ),
    }


def build_context_news_cache(region: str = "us", limit: int = 5, slot: str | None = None) -> Dict[str, Any]:
    region = (region or "us").lower()
    limit = max(1, min(5, int(limit or 5)))
    now_utc = datetime.now(timezone.utc)
    now_et = now_utc.astimezone(ET_ZONE)
    today = now_et.strftime("%Y-%m-%d")
    current_minutes = now_et.hour * 60 + now_et.minute
    auto_slot = "preopen" if current_minutes < MARKET_OPEN_MINUTES_ET else ("morning" if current_minutes < MARKET_CLOSE_MINUTES_ET else "close")
    slot_value = (slot or auto_slot).strip().lower() or "manual"
    mode, provider = _pick_provider()

    sensors = _sensor_snapshot()
    selected: List[Article] = []
    raw_articles: List[Article] = []
    status = "SensorOnly"
    error = None
    lookback_days = _lookback_days_for_slot(slot_value)
    fetch_errors: List[str] = []

    try:
        candidate_articles: List[Article] = []
        candidate_limit = max(10, limit)
        for days_back in range(lookback_days):
            date_from = (now_et - timedelta(days=days_back)).strftime("%Y-%m-%d")
            try:
                window_articles = provider.fetch_top_news(
                    region=region,
                    tickers=["SPY", "QQQ", "IWM", "DIA", "^VIX", "TLT", "HYG", "BTC-USD", "GLD"],
                    topics=["macro", "rates", "liquidity", "volatility"],
                    date_from=date_from,
                    date_to=today,
                    limit=candidate_limit,
                )
            except Exception as e:
                fetch_errors.append(f"{date_from}:{e}")
                continue
            for article in window_articles:
                score = _article_score(article, now_utc)
                if score <= -100:
                    continue
                article.score = score
                candidate_articles.append(article)
            if len(candidate_articles) >= candidate_limit * 2:
                break
        raw_articles = _dedupe_articles(candidate_articles)
        raw_articles = [a for a in raw_articles if getattr(a, "score", 0.0) > -100]
        raw_articles.sort(key=lambda x: getattr(x, "score", 0.0), reverse=True)
        selected = raw_articles[:limit]
        status = "Fresh" if len(selected) >= max(4, NEWS_MIN_SELECTED) else ("Partial" if len(selected) > 0 else "SensorOnly")
    except Exception as e:
        error = str(e)

    # Fallback to the already-collected frontend headline cache if the live fetch is empty.
    if not selected:
        cached_headlines = _load_frontend_headlines()
        if cached_headlines:
            recent_dates: List[str] = []
            for row in cached_headlines:
                date_et = str(row.get("dateET") or "").strip()
                if date_et and date_et not in recent_dates:
                    recent_dates.append(date_et)
                if len(recent_dates) >= min(2, lookback_days):
                    break
            if recent_dates:
                cached_headlines = [
                    row for row in cached_headlines
                    if str(row.get("dateET") or "").strip() in recent_dates
                ]
            fallback_articles = _articles_from_frontend_headlines(cached_headlines)
            for a in fallback_articles:
                a.score = _article_score(a, now_utc)
            fallback_articles = [a for a in fallback_articles if a.score > -100]
            fallback_articles.sort(key=lambda x: x.score, reverse=True)
            selected = fallback_articles[:limit]
            if selected:
                status = "Fresh" if len(selected) >= max(4, NEWS_MIN_SELECTED) else "Partial"

    # Fallback to last-good cache if no news selected.
    if not selected:
        lg = _load_last_good(region)
        if lg and isinstance(lg.get("articles"), list):
            selected = [
                Article(
                    id=str(i.get("id", "")),
                    title=str(i.get("title", "")),
                    publisher=str(i.get("publisher", "")),
                    published_at=str(i.get("published_at", "")),
                    url=str(i.get("url", "")),
                    summary=str(i.get("summary", "")),
                    tickers=i.get("tickers") or [],
                    topics=i.get("topics") or [],
                    source=str(i.get("source", "yahoo")),
                    score=float(i.get("score", 0.0) or 0.0),
                )
                for i in lg.get("articles", [])[:limit]
            ]
            status = "Stale" if selected else "SensorOnly"

    brief = _compose_news_brief(selected, sensors)
    validation = _latest_validation_badge()
    payload = {
        "generated_at": now_utc.isoformat(),
        "date": today,
        "slot": slot_value,
        "region": region,
        "provider": mode if mode != "premium" else f"premium:{os.environ.get('PREMIUM_VENDOR', 'polygon')}",
        "news_status": status,
        "articles": [a.to_dict() for a in selected],
        "selected_count": len(selected),
        "sensor_snapshot": sensors,
        "validation_status": validation.get("status", "Watch"),
        "validation_snapshot_date": validation.get("snapshot_date"),
        "news_brief": brief,
        "source_line": ", ".join(
            [f"{a.publisher} ({a.published_at[:16].replace('T', ' ')})" for a in selected[:2]]
        ) if selected else "",
        "fallback": {
            "used_last_good": status == "Stale",
            "sensor_only": status == "SensorOnly",
            "error": error,
            "fetch_errors": fetch_errors[:4],
            "lookback_days": lookback_days,
        },
    }

    # Persist date cache
    d = _news_cache_dir(today, region)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f"{region}.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # Persist last-good when fresh/partial
    if status in ("Fresh", "Partial"):
        _save_last_good(region, payload)

    # Write frontend cache bridge
    out_path = _artifact_file("cache/context_news.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return payload
