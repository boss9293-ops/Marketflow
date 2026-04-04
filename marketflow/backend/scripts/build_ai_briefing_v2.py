"""
WO-SA-07 Dynamic Daily Briefing Pipeline

Pipeline:
  Tavily ingestion -> dedupe/filter -> theme clustering -> internal JSON ->
  Claude generation (daily briefing + today context) -> quality gate -> cache

Output file:
  backend/output/cache/ai_briefing_v2.json
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CACHE_DIR = BACKEND_DIR / "output" / "cache"
OUTPUT_DIR = BACKEND_DIR / "output"
OUT_PATH = CACHE_DIR / "ai_briefing_v2.json"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.flow_engine import build_flow_signals
from services.causal_chain_engine import build_causal_chain
from services.category_mapper import map_news_to_category
from services.driver_engine import derive_key_driver
from services.fact_engine import build_fact_payload
from services.fact_impact_engine import enhance_events
from services.fact_impact_engine import enhance_movers
from services.fact_impact_engine import enhance_sectors
from services.fact_normalizer import normalize_events
from services.fact_normalizer import normalize_movers
from services.fact_normalizer import normalize_sectors
from services.numeric_engine import build_macro_factors
from services.numeric_engine import macro_factor_lines
from services.news_transformer import transform_headline
from services.positioning_engine import build_positioning
from services.quality_gate import compute_overall_confidence
from services.reaction_engine import build_market_reaction
from services.selection_engine import select_top_articles
from services.theme_selector import rank_valid_theme_clusters

TAVILY_URL = "https://api.tavily.com/search"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

DEFAULT_CLAUDE_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"
REQUEST_TIMEOUT_SEC = int(os.getenv("BRIEFING_PIPELINE_TIMEOUT_SEC", "45") or "45")
CLAUDE_CONNECT_TIMEOUT_SEC = float(os.getenv("CLAUDE_CONNECT_TIMEOUT_SEC", "12") or "12")
CLAUDE_READ_TIMEOUT_SEC = float(os.getenv("CLAUDE_READ_TIMEOUT_SEC", "180") or "180")
CLAUDE_RETRY_MAX = int(os.getenv("CLAUDE_RETRY_MAX", "1") or "1")
CLAUDE_RETRY_BACKOFF_SEC = float(os.getenv("CLAUDE_RETRY_BACKOFF_SEC", "1.2") or "1.2")
PIPELINE_VERSION = "wo-sa-25"
DAILY_PROMPT_VERSION = "wo-sa-25-daily-v1"
TODAY_CONTEXT_PROMPT_VERSION = "wo-sa-25-context-v1"
PIPELINE_RUN_MODE = os.getenv("PIPELINE_RUN_MODE", "production").strip().lower()

TAVILY_QUERY_TEMPLATES: list[tuple[str, str]] = [
    ("US stock market today", "news"),
    ("S&P 500 today news", "finance"),
    ("Fed rates market reaction", "news"),
    ("oil price market impact", "finance"),
    ("tech stocks today news", "news"),
]

DOMAIN_WHITELIST = [
    "reuters.com",
    "apnews.com",
    "cnbc.com",
    "wsj.com",
    "bloomberg.com",
    "marketwatch.com",
    "finance.yahoo.com",
    "barrons.com",
    "ft.com",
]

SOURCE_TIER_BY_DOMAIN = {
    "reuters.com": "high",
    "apnews.com": "high",
    "cnbc.com": "medium",
    "finance.yahoo.com": "medium",
}
SOURCE_WEIGHT = {"high": 3.0, "medium": 2.0, "low": 1.0}

STOPWORDS = {
    "today",
    "market",
    "markets",
    "stock",
    "stocks",
    "news",
    "price",
    "prices",
    "impact",
    "reaction",
    "update",
    "reports",
    "report",
    "after",
    "amid",
    "with",
    "from",
    "into",
    "over",
    "under",
    "this",
    "that",
    "were",
    "been",
    "have",
    "has",
    "about",
    "their",
    "while",
    "than",
    "what",
    "when",
    "where",
}

INDEX_FACT_ORDER = [
    ("S&P 500", "sp500"),
    ("Nasdaq", "nasdaq"),
    ("Dow", "dow"),
    ("VIX", "vix"),
]

INDEX_PROXY_SYMBOLS = {
    "SPY",
    "QQQ",
    "DIA",
    "IWM",
    "ES=F",
    "NQ=F",
    "YM=F",
    "RTY=F",
    "DXY",
    "BTCUSD",
    "VIX",
    "^GSPC",
    "^IXIC",
    "^DJI",
    "^VIX",
}

MOVE_WORD_SIGNS = {
    "up": 1.0,
    "rose": 1.0,
    "rises": 1.0,
    "rising": 1.0,
    "gained": 1.0,
    "gain": 1.0,
    "advanced": 1.0,
    "jumped": 1.0,
    "surged": 1.0,
    "climbed": 1.0,
    "higher": 1.0,
    "added": 1.0,
    "fell": -1.0,
    "falls": -1.0,
    "falling": -1.0,
    "down": -1.0,
    "lost": -1.0,
    "dropped": -1.0,
    "drop": -1.0,
    "retreated": -1.0,
    "slid": -1.0,
    "lower": -1.0,
    "declined": -1.0,
    "shed": -1.0,
}

MOVE_WORD_PATTERN = "|".join(sorted((re.escape(word) for word in MOVE_WORD_SIGNS.keys()), key=len, reverse=True))
APPROX_WORDS_PATTERN = r"(?:about|around|roughly|nearly|almost|more than|over)?\s*"

SECTOR_FACT_CONFIG = {
    "에너지": {
        "name": "Energy",
        "etf": "XLE",
        "aliases": ["xle", "energy sector", "energy stocks", "energy shares", "oil stocks", "energy"],
        "proxy_symbols": ["XLE", "XOP", "OIH", "XOM", "CVX"],
    },
    "기술주": {
        "name": "Technology",
        "etf": "XLK",
        "aliases": ["xlk", "technology sector", "technology stocks", "tech stocks", "semiconductor stocks", "semiconductor", "tech"],
        "proxy_symbols": ["XLK", "QQQ", "SMH", "NVDA", "AMD"],
    },
    "금융": {
        "name": "Financials",
        "etf": "XLF",
        "aliases": ["xlf", "financial sector", "financial stocks", "bank stocks", "banks", "financials"],
        "proxy_symbols": ["XLF", "KBE", "KRE", "JPM", "GS"],
    },
    "방어주": {
        "name": "Defensive",
        "etf": "XLV",
        "aliases": ["xlv", "defensive stocks", "healthcare stocks", "defensive"],
        "proxy_symbols": ["XLV"],
    },
}

MOVER_NAME_ALIASES = {
    "NVDA": ["nvda", "nvidia"],
    "AMD": ["amd", "advanced micro devices"],
    "XOM": ["xom", "exxon", "exxonmobil"],
    "CVX": ["cvx", "chevron"],
    "SMH": ["smh", "semiconductor etf"],
}

THEME_TITLE_RULES = [
    ("Rate Pressure Hits Tech", {"yield", "yields", "fed", "rates", "treasury", "nasdaq", "tech", "chip", "semiconductor"}),
    ("Oil Strength Lifts Energy", {"oil", "crude", "wti", "brent", "energy", "opep"}),
    ("Earnings Divergence in Large Caps", {"earnings", "guidance", "results", "revenue", "profit", "megacap"}),
    ("Policy Signals Shape Risk Appetite", {"fed", "inflation", "cpi", "pce", "payrolls", "jobs", "policy"}),
    ("Volatility Regime Keeps Flows Selective", {"vix", "volatility", "hedging", "risk", "drawdown"}),
]

THEME_STOP_TERMS = {
    "and",
    "all",
    "for",
    "500",
    "sp500",
    "latest",
    "price",
    "reuters",
    "cnbc",
    "wsj",
    "bloomberg",
    "marketwatch",
    "yahoo",
    "finance",
    "watch",
    "video",
    "march",
    "2026",
    "markets",
    "market",
    "stock",
    "stocks",
    "news",
    "live",
    "updates",
}

BANNED_CAUSAL_PATTERNS = [
    re.compile(r"\bmarkets?\s+moved\s+due\s+to\b", re.IGNORECASE),
    re.compile(r"\bstocks?\s+went\s+up\s+because\b", re.IGNORECASE),
]

GENERIC_PHRASE_PATTERNS = [
    re.compile(r"영향을\s*미쳤다", re.IGNORECASE),
    re.compile(r"우려가\s*커졌다", re.IGNORECASE),
    re.compile(r"시장\s*심리가\s*약화됐다", re.IGNORECASE),
    re.compile(r"불확실성이\s*존재한다", re.IGNORECASE),
    re.compile(r"\bmarket[s]?\s+moved\b", re.IGNORECASE),
    re.compile(r"\bstock[s]?\s+went\s+up\b", re.IGNORECASE),
]

NEWS_LIKE_FACT_KEYWORDS = (
    "관련 이슈",
    "뉴스 집중",
    "뉴스",
    "기사",
    "보도",
    "headline",
    "report",
)

EVENT_IMPACT_KEYWORDS = (
    "붕괴",
    "급등",
    "확산",
    "확대",
    "압력",
    "쇼크",
)

NON_DAILY_CHANGE_PATTERNS = [
    re.compile(r"\bytd\b", re.IGNORECASE),
    re.compile(r"year[-\s]?to[-\s]?date", re.IGNORECASE),
    re.compile(r"\bmonthly\b", re.IGNORECASE),
    re.compile(r"\bthis year\b", re.IGNORECASE),
    re.compile(r"\bin\s+20\d{2}\b", re.IGNORECASE),
    re.compile(r"\bsince\b", re.IGNORECASE),
    re.compile(r"\bcumulative\b", re.IGNORECASE),
    re.compile(r"from\s+high", re.IGNORECASE),
    re.compile(r"down\s+from", re.IGNORECASE),
]

THEME_NOISE_PATTERNS = [
    re.compile(r"drive\s+session\s+flows", re.IGNORECASE),
    re.compile(r"\bfor\s+and\s+all\b", re.IGNORECASE),
    re.compile(r"stock\s+price\s*&\s*latest\s+news", re.IGNORECASE),
    re.compile(r"key\s+metrics?", re.IGNORECASE),
    re.compile(r"income\s+statement", re.IGNORECASE),
    re.compile(r"financial\s+strength", re.IGNORECASE),
    re.compile(r"news\s+archive", re.IGNORECASE),
    re.compile(r"\bhistory\b", re.IGNORECASE),
]

SECTOR_DAILY_CHANGE_ABS_MAX = 10.0

MIN_RESULTS = 20
MAX_RESULTS = 40
DEFAULT_VALIDATION_DIR = BACKEND_DIR / "output" / "validation" / "wo_sa_25"


def _log(msg: str) -> None:
    print(f"[build_ai_briefing_v2] {msg}", flush=True)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for env_path in [BACKEND_DIR / ".env", BACKEND_DIR / ".env.local", BACKEND_DIR.parent / ".env", BACKEND_DIR.parent / ".env.local"]:
        if not env_path.exists():
            continue
        with open(env_path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip().strip('"').strip("'")
    for key in list(env.keys()):
        if os.environ.get(key):
            env[key] = os.environ[key]
    for required in ["TAVILY_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"]:
        if os.environ.get(required):
            env[required] = os.environ[required]
    if not (env.get("ANTHROPIC_API_KEY") or "").strip():
        alias = (env.get("CLAUDE_API_KEY") or os.environ.get("CLAUDE_API_KEY") or "").strip()
        if alias:
            env["ANTHROPIC_API_KEY"] = alias
    return env


def load_json(filename: str, fallback: Any = None) -> Any:
    for base in [CACHE_DIR, OUTPUT_DIR]:
        path = base / filename
        if path.exists():
            try:
                with open(path, encoding="utf-8") as handle:
                    return json.load(handle)
            except Exception:
                continue
    return fallback if fallback is not None else {}


def read_previous_cache() -> dict[str, Any] | None:
    if not OUT_PATH.exists():
        return None
    try:
        with open(OUT_PATH, encoding="utf-8") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def write_output(payload: dict[str, Any]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def infer_data_date() -> str:
    market_state = load_json("market_state.json", {})
    market_tape = load_json("market_tape.json", {})
    value = (
        str(market_tape.get("data_date") or "").strip()
        or str(market_state.get("data_date") or "").strip()
        or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    )
    return value[:10]


def parse_asof_date(value: str) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d")
    except Exception:
        return None


def format_asof_date_ko(value: str) -> str:
    dt = parse_asof_date(value)
    if not dt:
        return ""
    return f"{dt.month}월 {dt.day}일"


def format_asof_date_en(value: str) -> str:
    dt = parse_asof_date(value)
    if not dt:
        return ""
    return dt.strftime("%B %-d, %Y") if os.name != "nt" else dt.strftime("%B %d, %Y").replace(" 0", " ")


def normalize_domain(url: str) -> str:
    try:
        parsed = urlparse(url.strip())
        host = (parsed.netloc or "").lower()
    except Exception:
        host = ""
    if host.startswith("www."):
        host = host[4:]
    return host


def is_whitelisted_domain(domain: str) -> bool:
    return any(domain == item or domain.endswith(f".{item}") for item in DOMAIN_WHITELIST)


def get_source_tier(domain: str) -> str:
    for key, tier in SOURCE_TIER_BY_DOMAIN.items():
        if domain == key or domain.endswith(f".{key}"):
            return tier
    return "low"


def normalize_text(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"https?://\S+", " ", lowered)
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def text_tokens(text: str) -> set[str]:
    cleaned = normalize_text(text)
    tokens = [token for token in cleaned.split(" ") if token and len(token) >= 3 and token not in STOPWORDS]
    return set(tokens)


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a.intersection(b))
    union = len(a.union(b))
    return inter / union if union else 0.0


def shorten_line(text: str, max_len: int = 120) -> str:
    cleaned = re.sub(r"\s+", " ", text.strip())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "..."


def parse_datetime(value: str) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt)
        except Exception:
            continue
    return None


def recency_score(date_text: str) -> float:
    dt = parse_datetime(date_text)
    if dt is None:
        return 0.8
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    age_days = max(0, (now - dt.replace(tzinfo=None)).days)
    return max(0.35, 1.0 - (0.12 * age_days))


def build_tavily_queries(asof_date: str) -> list[tuple[str, str]]:
    date_hint = asof_date.strip()
    queries: list[tuple[str, str]] = []
    for base_query, topic in TAVILY_QUERY_TEMPLATES:
        queries.append((f"{base_query} {date_hint}".strip(), topic))
    return queries


def tavily_search(api_key: str, query: str, topic: str, max_results: int = 8) -> list[dict[str, Any]]:
    payload = {
        "api_key": api_key,
        "query": query,
        "topic": topic,
        "search_depth": "advanced",
        "max_results": max_results,
        "include_answer": False,
        "include_raw_content": False,
        "include_domains": DOMAIN_WHITELIST,
    }
    try:
        resp = requests.post(TAVILY_URL, json=payload, timeout=REQUEST_TIMEOUT_SEC)
        if resp.status_code >= 400:
            retry_payload = dict(payload)
            retry_payload.pop("include_domains", None)
            resp = requests.post(TAVILY_URL, json=retry_payload, timeout=REQUEST_TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results")
        return results if isinstance(results, list) else []
    except Exception as exc:
        _log(f"Tavily query failed ({query}): {exc.__class__.__name__}")
        return []


def run_tavily_ingestion(
    api_key: str,
    asof_date: str,
    queries: list[tuple[str, str]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    logs: list[str] = []
    rows: list[dict[str, Any]] = []
    active_queries = queries or build_tavily_queries(asof_date)

    def _worker(query: str, topic: str) -> tuple[str, str, list[dict[str, Any]]]:
        return query, topic, tavily_search(api_key=api_key, query=query, topic=topic, max_results=8)

    with ThreadPoolExecutor(max_workers=min(5, len(active_queries))) as pool:
        futures = [pool.submit(_worker, query, topic) for query, topic in active_queries]
        for future in as_completed(futures):
            query, topic, result_items = future.result()
            logs.append(f"query={query!r} topic={topic} results={len(result_items)}")
            for raw in result_items:
                if not isinstance(raw, dict):
                    continue
                url = str(raw.get("url") or "").strip()
                title = str(raw.get("title") or "").strip()
                snippet = str(raw.get("content") or raw.get("snippet") or "").strip()
                if not url or not title:
                    continue
                domain = normalize_domain(url)
                if not domain or not is_whitelisted_domain(domain):
                    continue
                tier = get_source_tier(domain)
                rows.append(
                    {
                        "query": query,
                        "topic": topic,
                        "title": title,
                        "url": url,
                        "domain": domain,
                        "source": str(raw.get("source") or domain).strip(),
                        "published_date": str(raw.get("published_date") or raw.get("date") or "").strip(),
                        "snippet": snippet or title,
                        "source_tier": tier,
                        "source_weight": SOURCE_WEIGHT[tier],
                        "terms": text_tokens(f"{title} {snippet}"),
                    }
                )

    return rows, logs


def dedupe_and_filter(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []

    ranked = sorted(
        rows,
        key=lambda item: (
            item.get("source_weight", 0.0),
            recency_score(str(item.get("published_date") or "")),
            len(str(item.get("snippet") or "")),
        ),
        reverse=True,
    )

    deduped: list[dict[str, Any]] = []
    seen_url: set[str] = set()
    seen_titles: list[set[str]] = []

    for article in ranked:
        url = str(article.get("url") or "")
        if url in seen_url:
            continue
        title_terms = article.get("terms") or text_tokens(str(article.get("title") or ""))
        if not title_terms:
            continue
        duplicate_idx: int | None = None
        for idx, existing_terms in enumerate(seen_titles):
            if jaccard(title_terms, existing_terms) >= 0.78:
                duplicate_idx = idx
                break
        if duplicate_idx is None:
            deduped.append(article)
            seen_url.add(url)
            seen_titles.append(title_terms)
            continue

        current = deduped[duplicate_idx]
        current_score = float(current.get("source_weight") or 0.0) + recency_score(str(current.get("published_date") or ""))
        next_score = float(article.get("source_weight") or 0.0) + recency_score(str(article.get("published_date") or ""))
        if next_score > current_score:
            deduped[duplicate_idx] = article
            seen_url.add(url)
            seen_titles[duplicate_idx] = title_terms

    return deduped[:MAX_RESULTS]


def cluster_articles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []
    for article in rows:
        terms = set(article.get("terms") or set())
        best_idx = -1
        best_score = 0.0
        for idx, cluster in enumerate(clusters):
            score = jaccard(terms, cluster["terms"])
            if score > best_score:
                best_score = score
                best_idx = idx
        if best_idx >= 0 and best_score >= 0.24:
            target = clusters[best_idx]
            target["articles"].append(article)
            target["terms"] = target["terms"].union(terms)
            target["term_counter"].update(list(terms))
            target["source_score"] += float(article.get("source_weight") or 0.0)
            continue
        clusters.append(
            {
                "articles": [article],
                "terms": set(terms),
                "term_counter": Counter(list(terms)),
                "source_score": float(article.get("source_weight") or 0.0),
            }
        )

    merged: dict[tuple[str, ...], dict[str, Any]] = {}
    for cluster in clusters:
        top_terms = tuple([term for term, _ in cluster["term_counter"].most_common(2)]) or ("misc",)
        if top_terms not in merged:
            merged[top_terms] = cluster
            continue
        merged[top_terms]["articles"].extend(cluster["articles"])
        merged[top_terms]["terms"] = merged[top_terms]["terms"].union(cluster["terms"])
        merged[top_terms]["term_counter"].update(cluster["term_counter"])
        merged[top_terms]["source_score"] += cluster["source_score"]

    merged_list = list(merged.values())
    merged_list.sort(key=lambda item: (len(item["articles"]), item["source_score"]), reverse=True)
    return merged_list


def has_theme_noise(text: str) -> bool:
    raw = str(text or "").strip()
    if not raw:
        return False
    lowered = raw.lower()
    if re.fullmatch(r"[A-Z]{1,5}\s*(?:-\s*[A-Z]{1,5})?", raw.strip()):
        return True
    return any(pattern.search(lowered) for pattern in THEME_NOISE_PATTERNS)


def canonicalize_theme_title(title: str, points: list[str], key_driver: str) -> str:
    base_text = f"{title} {' '.join(points)} {key_driver}".lower()
    if any(keyword in base_text for keyword in ["oil", "crude", "brent", "wti", "hormuz", "supply", "energy", "inflation"]):
        return "Oil Strength Lifts Energy"
    if any(keyword in base_text for keyword in ["yield", "rates", "treasury", "fed", "duration", "tech", "semiconductor", "nasdaq"]):
        return "Rate Pressure Hits Tech"
    if any(keyword in base_text for keyword in ["financial", "banks", "xlf", "jpm", "credit"]):
        return "Financials React to Rate Repricing"

    cleaned = re.sub(r"\s+", " ", str(title or "").strip())
    if cleaned.lower().startswith(("and ", "for ")):
        return "Macro Drivers in Focus"
    if re.fullmatch(r"[A-Za-z]+\s+\d+\s+Theme(?:\s+in\s+Focus)?", cleaned, re.IGNORECASE):
        return "Macro Drivers in Focus"
    if not cleaned or has_theme_noise(cleaned):
        return "Macro Drivers in Focus"
    return shorten_line(cleaned, 72)


def pick_theme_title(cluster: dict[str, Any]) -> str:
    terms = set(cluster.get("terms") or set())
    best_title = ""
    best_overlap = 0
    for title, keywords in THEME_TITLE_RULES:
        overlap = len(terms.intersection(keywords))
        if overlap > best_overlap:
            best_overlap = overlap
            best_title = title
    if best_overlap >= 2 and best_title:
        return best_title

    top_terms = [
        term
        for term, _ in (cluster.get("term_counter") or Counter()).most_common(10)
        if str(term).lower() not in THEME_STOP_TERMS
    ][:3]
    if top_terms:
        return "Macro Drivers in Focus"
    return "Macro Drivers in Focus"


def extract_cluster_points(cluster: dict[str, Any], max_points: int = 3) -> list[str]:
    points: list[str] = []
    seen: set[str] = set()
    for article in cluster.get("articles", []):
        candidate = shorten_line(str(article.get("title") or ""), 110)
        if candidate and candidate.lower() not in seen:
            points.append(candidate)
            seen.add(candidate.lower())
        if len(points) >= max_points:
            break
    if len(points) < max_points:
        for article in cluster.get("articles", []):
            candidate = shorten_line(str(article.get("snippet") or ""), 110)
            if candidate and candidate.lower() not in seen:
                points.append(candidate)
                seen.add(candidate.lower())
            if len(points) >= max_points:
                break
    return points[:max_points]


def pick_market_pct(items: list[dict[str, Any]], symbols: list[str]) -> float | None:
    symbol_set = {symbol.upper() for symbol in symbols}
    for item in items:
        symbol = str(item.get("symbol") or "").upper()
        if symbol in symbol_set:
            try:
                value = float(item.get("chg_pct"))
                return round(value, 2)
            except Exception:
                continue
    return None


def build_market_snapshot() -> dict[str, float | None]:
    tape = load_json("market_tape.json", {"items": []})
    items = tape.get("items") if isinstance(tape, dict) else []
    if not isinstance(items, list):
        items = []
    return {
        "sp500": pick_market_pct(items, ["SPY", "ES=F", "^GSPC"]),
        "nasdaq": pick_market_pct(items, ["QQQ", "NQ=F", "^IXIC"]),
        "dow": pick_market_pct(items, ["DIA", "YM=F", "^DJI"]),
        "vix": pick_market_pct(items, ["VIX", "^VIX"]),
    }


def _article_text_blob(article: dict[str, Any]) -> str:
    title = str(article.get("title") or "").strip()
    snippet = str(article.get("snippet") or article.get("summary") or "").strip()
    return " ".join([part for part in [title, snippet] if part]).strip()


def _signed_move_from_word(word: str | None, value: float) -> float:
    raw = float(value)
    if raw < 0:
        return raw
    sign = MOVE_WORD_SIGNS.get(str(word or "").lower(), 1.0)
    return round(sign * abs(raw), 2)


def _has_non_daily_change_clue(text: str) -> bool:
    raw = str(text or "").strip()
    if not raw:
        return False
    return any(pattern.search(raw) for pattern in NON_DAILY_CHANGE_PATTERNS)


def _sanitize_sector_daily_change(value: Any, source_label: str) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    normalized = round(float(value), 2)
    if abs(normalized) > SECTOR_DAILY_CHANGE_ABS_MAX:
        _log(f"sector change rejected out-of-range source={source_label} value={normalized:+.2f}%")
        return None
    return normalized


def _extract_signed_pct_from_text(text: str, aliases: list[str], window: int = 96) -> float | None:
    if not text or not aliases:
        return None
    alias_pattern = "|".join(sorted((re.escape(alias) for alias in aliases if alias), key=len, reverse=True))
    if not alias_pattern:
        return None
    patterns = [
        re.compile(
            rf"(?:{alias_pattern})[^\n\.;]{{0,{window}}}?(?P<word>{MOVE_WORD_PATTERN})\s+{APPROX_WORDS_PATTERN}(?P<value>\d+(?:\.\d+)?)%",
            re.IGNORECASE,
        ),
        re.compile(
            rf"(?P<value>\d+(?:\.\d+)?)%\s+(?P<word>higher|lower|up|down)[^\n\.;]{{0,{window}}}?(?:{alias_pattern})",
            re.IGNORECASE,
        ),
        re.compile(
            rf"(?:{alias_pattern})[^\n\.;]{{0,{window}}}?\((?P<value>[+-]?\d+(?:\.\d+)?)%\)",
            re.IGNORECASE,
        ),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        try:
            value = float(match.group("value"))
        except Exception:
            continue
        word = match.groupdict().get("word")
        if word:
            return _signed_move_from_word(word, value)
        if value != 0:
            return round(value, 2)
    return None


def _extract_signed_bp_from_text(text: str, aliases: list[str], window: int = 128) -> float | None:
    if not text or not aliases:
        return None
    alias_pattern = "|".join(sorted((re.escape(alias) for alias in aliases if alias), key=len, reverse=True))
    if not alias_pattern:
        return None
    patterns = [
        re.compile(
            rf"(?:{alias_pattern})[^\n\.;]{{0,{window}}}?(?P<word>{MOVE_WORD_PATTERN})[^\n\.;]{{0,32}}?(?P<value>\d+(?:\.\d+)?)\s*(?:bp|basis points?)",
            re.IGNORECASE,
        ),
        re.compile(
            rf"(?P<value>[+-]?\d+(?:\.\d+)?)\s*(?:bp|basis points?)[^\n\.;]{{0,{window}}}?(?:{alias_pattern})",
            re.IGNORECASE,
        ),
        re.compile(
            rf"(?:{alias_pattern})[^\n\.;]{{0,{window}}}?\((?P<value>[+-]?\d+(?:\.\d+)?)\s*(?:bp|basis points?)\)",
            re.IGNORECASE,
        ),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        try:
            value = float(match.group("value"))
        except Exception:
            continue
        word = match.groupdict().get("word")
        if word:
            return _signed_move_from_word(word, value)
        if value != 0:
            return round(value, 2)
    return None


def _extract_percent_level_from_text(text: str, aliases: list[str], window: int = 80) -> float | None:
    if not text or not aliases:
        return None
    alias_pattern = "|".join(sorted((re.escape(alias) for alias in aliases if alias), key=len, reverse=True))
    if not alias_pattern:
        return None
    patterns = [
        re.compile(rf"(?:{alias_pattern})[^\n\.;]{{0,{window}}}?\bat\s+(\d+(?:\.\d+)?)%", re.IGNORECASE),
        re.compile(rf"(?:{alias_pattern})[^\n\.;]{{0,{window}}}?\bto\s+(\d+(?:\.\d+)?)%", re.IGNORECASE),
        re.compile(rf"(?:{alias_pattern})[^\n\.;]{{0,{window}}}?\((\d+(?:\.\d+)?)%\)", re.IGNORECASE),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        try:
            return round(float(match.group(1)), 2)
        except Exception:
            continue
    return None


def _pick_best_numeric_candidate(candidates: list[tuple[int, int, float]]) -> float | None:
    if not candidates:
        return None
    score, order, value = max(candidates, key=lambda item: (item[0], item[1]))
    _ = score, order
    return round(float(value), 2)


def _extract_oil_quote_from_articles(articles: list[dict[str, Any]]) -> dict[str, Any]:
    candidates: list[tuple[int, int, float, str]] = []
    patterns = [
        (re.compile(r"\b(?P<label>wti|west texas intermediate|u\.s\. crude(?: benchmark)?)\b[^$]{0,56}?\$\s?(?P<value>\d{2,3}(?:\.\d+)?)", re.IGNORECASE), 6),
        (re.compile(r"\b(?P<label>brent)\b[^$]{0,56}?\$\s?(?P<value>\d{2,3}(?:\.\d+)?)", re.IGNORECASE), 6),
        (re.compile(r"\$(?P<value>\d{2,3}(?:\.\d+)?)\s*(?:a\s*)?(?:barrel|bbl)", re.IGNORECASE), 3),
    ]
    for idx, article in enumerate(articles[:40]):
        text = _article_text_blob(article)
        lower = text.lower()
        for pattern, score in patterns:
            for match in pattern.finditer(text):
                try:
                    value = float(match.group("value"))
                except Exception:
                    continue
                label = str(match.groupdict().get("label") or "").lower()
                inferred_label = "Brent" if "brent" in label or "brent" in lower else "WTI"
                bonus = 0
                if any(term in lower for term in ["u.s. crude", "us crude", "crude benchmark", "wti", "west texas intermediate"]):
                    bonus += 1
                if any(term in lower for term in ["advanced", "rose", "surged", "jumped", "settled", "closed"]):
                    bonus += 1
                candidates.append((score + bonus, -idx, value, inferred_label))
    if not candidates:
        return {}
    best_score, best_order, best_value, best_label = max(candidates, key=lambda item: (item[0], item[1]))
    _ = best_score, best_order
    return {"value": round(float(best_value), 2), "label": best_label}


def extract_oil_price_from_articles(articles: list[dict[str, Any]]) -> float | None:
    quote = _extract_oil_quote_from_articles(articles)
    value = quote.get("value")
    return round(float(value), 2) if isinstance(value, (int, float)) else None


def extract_oil_label_from_articles(articles: list[dict[str, Any]]) -> str | None:
    quote = _extract_oil_quote_from_articles(articles)
    label = str(quote.get("label") or "").strip()
    return label or None


def extract_oil_change_pct_from_articles(articles: list[dict[str, Any]]) -> float | None:
    aliases = ["oil", "crude", "u.s. crude", "us crude", "crude benchmark", "wti", "brent"]
    candidates: list[tuple[int, int, float]] = []
    for idx, article in enumerate(articles[:40]):
        text = _article_text_blob(article)
        lower = text.lower()
        value = _extract_signed_pct_from_text(text, aliases, window=128)
        if not isinstance(value, (int, float)):
            continue
        score = 4
        if any(term in lower for term in ["wti", "brent", "u.s. crude", "us crude", "crude benchmark"]):
            score += 2
        if "$" in text or "barrel" in lower:
            score += 1
        candidates.append((score, -idx, float(value)))
    return _pick_best_numeric_candidate(candidates)


def extract_10y_from_articles(articles: list[dict[str, Any]]) -> float | None:
    aliases = [
        "10-year treasury yield",
        "10 year treasury yield",
        "10-year yield",
        "10 year yield",
        "10-year treasury",
        "10 year treasury",
        "10-year note yield",
        "treasury yield",
    ]
    for article in articles[:40]:
        text = _article_text_blob(article)
        value = _extract_percent_level_from_text(text, aliases, window=120)
        if isinstance(value, (int, float)):
            return round(float(value), 2)
    return None


def extract_10y_from_macro_snapshot() -> float | None:
    candidate_paths = [
        BACKEND_DIR / "data" / "snapshots" / "macro_snapshot_latest.json",
        BACKEND_DIR / "storage" / "macro_snapshots" / f"{infer_data_date()}.json",
    ]
    for path in candidate_paths:
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
            series = payload.get("series") if isinstance(payload.get("series"), dict) else {}
            dgs10 = series.get("DGS10") if isinstance(series.get("DGS10"), dict) else {}
            latest = dgs10.get("latest") if isinstance(dgs10.get("latest"), dict) else {}
            value = latest.get("value")
            if isinstance(value, (int, float)):
                return round(float(value), 2)
        except Exception:
            continue
    return None


def extract_10y_change_bp_from_articles(articles: list[dict[str, Any]]) -> float | None:
    aliases = [
        "10-year treasury yield",
        "10 year treasury yield",
        "10-year yield",
        "10 year yield",
        "10-year treasury",
        "10 year treasury",
        "10-year note yield",
        "treasury yield",
        "yields",
    ]
    candidates: list[tuple[int, int, float]] = []
    for idx, article in enumerate(articles[:40]):
        text = _article_text_blob(article)
        value = _extract_signed_bp_from_text(text, aliases, window=148)
        if not isinstance(value, (int, float)):
            continue
        score = 4 if "10-year" in text.lower() or "10 year" in text.lower() else 3
        candidates.append((score, -idx, float(value)))
    return _pick_best_numeric_candidate(candidates)


def extract_10y_change_bp_from_macro_snapshot() -> float | None:
    candidate_paths = [
        BACKEND_DIR / "data" / "snapshots" / "macro_snapshot_latest.json",
        BACKEND_DIR / "storage" / "macro_snapshots" / f"{infer_data_date()}.json",
    ]
    for path in candidate_paths:
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
            computed = payload.get("computed") if isinstance(payload.get("computed"), dict) else {}
            public_context = computed.get("PUBLIC_CONTEXT") if isinstance(computed.get("PUBLIC_CONTEXT"), dict) else {}
            rows = public_context.get("rows") if isinstance(public_context.get("rows"), list) else []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                if str(row.get("key") or "").upper() != "UST10Y":
                    continue
                for field in ["change_1d_bp", "change_bp", "bp_move", "daily_change_bp"]:
                    value = row.get(field)
                    if isinstance(value, (int, float)):
                        return round(float(value), 2)
        except Exception:
            continue
    return None


def _load_action_snapshot() -> dict[str, Any]:
    payload = load_json("action_snapshot.json", {})
    return payload if isinstance(payload, dict) else {}


def build_symbol_change_map() -> dict[str, float]:
    tape = load_json("market_tape.json", {"items": []})
    items = tape.get("items") if isinstance(tape, dict) else []
    output: dict[str, float] = {}
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol") or "").upper().strip()
            if not symbol:
                continue
            try:
                output[symbol] = round(float(item.get("chg_pct")), 2)
            except Exception:
                continue

    action_snapshot = _load_action_snapshot()
    watchlist_moves = action_snapshot.get("watchlist_moves") if isinstance(action_snapshot.get("watchlist_moves"), list) else []
    for item in watchlist_moves:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").upper().strip()
        if not symbol:
            continue
        try:
            output[symbol] = round(float(item.get("chg_pct")), 2)
        except Exception:
            continue
    return output


def _extract_change_pct_from_articles(
    articles: list[dict[str, Any]],
    aliases: list[str],
    *,
    window: int = 112,
    reject_non_daily: bool = False,
    max_abs: float | None = None,
) -> float | None:
    candidates: list[tuple[int, int, float]] = []
    for idx, article in enumerate(articles[:40]):
        text = _article_text_blob(article)
        if reject_non_daily and _has_non_daily_change_clue(text):
            continue
        value = _extract_signed_pct_from_text(text, aliases, window=window)
        if not isinstance(value, (int, float)):
            continue
        if isinstance(max_abs, (int, float)) and abs(float(value)) > float(max_abs):
            continue
        lower = text.lower()
        score = 3
        if any(alias in lower for alias in aliases):
            score += 1
        if reject_non_daily and any(
            keyword in lower for keyword in ["today", "session", "closed", "ended", "on the day", "late trading"]
        ):
            score += 1
        candidates.append((score, -idx, float(value)))
    return _pick_best_numeric_candidate(candidates)


def _resolve_sector_change_pct(
    config: dict[str, Any],
    symbol_change: dict[str, float],
    articles: list[dict[str, Any]],
) -> float | None:
    etf = str(config.get("etf") or "").upper()
    if etf and isinstance(symbol_change.get(etf), (int, float)):
        return _sanitize_sector_daily_change(symbol_change[etf], etf)

    article_change = _extract_change_pct_from_articles(
        articles,
        [str(alias).lower() for alias in config.get("aliases", [])],
        window=132,
        reject_non_daily=True,
        max_abs=SECTOR_DAILY_CHANGE_ABS_MAX,
    )
    if isinstance(article_change, (int, float)):
        return _sanitize_sector_daily_change(article_change, f"{etf or 'sector'}_article")

    for proxy_symbol in config.get("proxy_symbols", []):
        proxy = str(proxy_symbol or "").upper()
        if isinstance(symbol_change.get(proxy), (int, float)):
            return _sanitize_sector_daily_change(symbol_change[proxy], proxy)
    return None


def build_sector_facts(
    sector_lines: list[str],
    symbol_change: dict[str, float],
    articles: list[dict[str, Any]] | None = None,
    market_data: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    _ = market_data
    article_rows = articles or []
    output: list[dict[str, Any]] = []
    for line in sector_lines:
        text = str(line).strip()
        if not text:
            continue
        picked_key = ""
        for key in SECTOR_FACT_CONFIG.keys():
            if key in text:
                picked_key = key
                break
        config = SECTOR_FACT_CONFIG.get(picked_key, {"name": "Market", "etf": "SPY", "aliases": ["market"], "proxy_symbols": ["SPY"]})
        name = str(config.get("name") or "Market")
        etf = str(config.get("etf") or "SPY")
        driver = text.split("→", 1)[0].strip() if "→" in text else text
        change_pct = None if _has_non_daily_change_clue(text) else _resolve_sector_change_pct(config, symbol_change, article_rows)
        output.append(
            {
                "name": name,
                "etf": etf,
                "change_pct": change_pct,
                "driver": driver,
            }
        )
    return output[:3]


def _detect_mover_symbol(text: str) -> tuple[str, str | None]:
    headline = text.split("—", 1)[0].strip()
    for ticker, aliases in MOVER_NAME_ALIASES.items():
        for alias in aliases:
            if re.search(rf"\b{re.escape(alias)}\b", headline, re.IGNORECASE):
                return ticker, ticker
    cleaned = re.sub(r"\b(상승|하락|약세|강세|급등|급락|변동성 확대)\b", "", headline).strip(" :-")
    return cleaned or "Market", None


def _resolve_mover_change_pct(
    symbol_text: str,
    canonical_symbol: str | None,
    symbol_change: dict[str, float],
    articles: list[dict[str, Any]],
) -> float | None:
    if canonical_symbol and isinstance(symbol_change.get(canonical_symbol), (int, float)):
        return round(float(symbol_change[canonical_symbol]), 2)
    if canonical_symbol:
        article_change = _extract_change_pct_from_articles(articles, MOVER_NAME_ALIASES.get(canonical_symbol, []), window=96)
        if isinstance(article_change, (int, float)):
            return round(float(article_change), 2)
    if "에너지" in symbol_text:
        for proxy in ["XOM", "CVX"]:
            if isinstance(symbol_change.get(proxy), (int, float)):
                return round(float(symbol_change[proxy]), 2)
    return None


def _derive_mover_context(
    symbol_text: str,
    canonical_symbol: str | None,
    line: str,
    symbol_change: dict[str, float],
    market_data: dict[str, Any],
) -> str:
    line_lower = line.lower()
    if canonical_symbol in {"NVDA", "AMD", "SMH"} or any(keyword in line_lower for keyword in ["반도체", "semiconductor", "tech", "nvidia", "nvda", "amd"]):
        smh = symbol_change.get("SMH")
        if isinstance(smh, (int, float)):
            return f"SMH {smh:+.2f}% 동조"
        qqq = symbol_change.get("QQQ")
        if isinstance(qqq, (int, float)):
            return f"QQQ {qqq:+.2f}% 동조"
        return "반도체 약세 동조" if any(keyword in line for keyword in ["하락", "약세"]) else "반도체 수급 동조"
    if canonical_symbol in {"XOM", "CVX"} or "에너지" in symbol_text:
        oil_change_pct = market_data.get("oil_change_pct")
        if isinstance(oil_change_pct, (int, float)):
            return f"WTI {oil_change_pct:+.2f}% 수혜"
        return "WTI 급등 수혜"
    if "금융" in symbol_text or any(keyword in line_lower for keyword in ["financial", "bank"]):
        rates_change_bp = market_data.get("yield10y_change_bp")
        if isinstance(rates_change_bp, (int, float)):
            return f"금리 {rates_change_bp:+.0f}bp 반영"
        return "금리 해석 반영"
    return ""


def build_mover_facts(
    mover_lines: list[str],
    symbol_change: dict[str, float],
    articles: list[dict[str, Any]] | None = None,
    market_data: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    article_rows = articles or []
    market_context = market_data or {}
    output: list[dict[str, Any]] = []
    for line in mover_lines:
        text = str(line).strip()
        if not text:
            continue
        symbol, canonical_symbol = _detect_mover_symbol(text)
        reason = text.split("—", 1)[1].strip() if "—" in text else text
        if not reason or reason == text:
            reason = re.sub(rf"^{re.escape(symbol)}\s*", "", text).strip(" :-") or text
        context = _derive_mover_context(symbol, canonical_symbol, text, symbol_change, market_context)
        change_pct = _resolve_mover_change_pct(symbol, canonical_symbol, symbol_change, article_rows)
        output.append(
            {
                "symbol": symbol,
                "change_pct": change_pct,
                "context": context,
                "reason": reason,
            }
        )
    return output[:3]


def build_market_data_context(snapshot: dict[str, float | None], articles: list[dict[str, Any]]) -> dict[str, Any]:
    oil_value = extract_oil_price_from_articles(articles)
    oil_change_pct = extract_oil_change_pct_from_articles(articles)
    oil_label = extract_oil_label_from_articles(articles) or "WTI"
    yield10y = extract_10y_from_articles(articles) or extract_10y_from_macro_snapshot()
    yield10y_change_bp = extract_10y_change_bp_from_articles(articles)
    if not isinstance(yield10y_change_bp, (int, float)):
        yield10y_change_bp = extract_10y_change_bp_from_macro_snapshot()
    return {
        "sp500": snapshot.get("sp500"),
        "nasdaq": snapshot.get("nasdaq"),
        "dow": snapshot.get("dow"),
        "vix": snapshot.get("vix"),
        "oil": oil_value,
        "oil_label": oil_label,
        "oil_change_pct": oil_change_pct,
        "yield10y": yield10y,
        "yield10y_label": "US10Y",
        "yield10y_change_bp": yield10y_change_bp,
    }


def build_internal_json(top_clusters: list[dict[str, Any]], snapshot: dict[str, float | None]) -> dict[str, Any]:
    themes: list[dict[str, Any]] = []
    for cluster in top_clusters:
        themes.append(
            {
                "title": pick_theme_title(cluster),
                "points": extract_cluster_points(cluster, max_points=3),
            }
        )

    notes: list[str] = []
    if snapshot.get("nasdaq") is not None and snapshot.get("sp500") is not None:
        notes.append(
            f"Index split: S&P {snapshot['sp500']:+.2f}% / Nasdaq {snapshot['nasdaq']:+.2f}%"
        )
    if snapshot.get("vix") is not None:
        notes.append(f"VIX moved {snapshot['vix']:+.2f}%")
    if themes:
        notes.append(f"Top flow centered on: {themes[0]['title']}")
    if len(themes) > 1:
        notes.append(f"Secondary driver: {themes[1]['title']}")

    return {
        "top_themes": themes[:5],
        "market_snapshot": snapshot,
        "notes": notes[:5],
    }


def group_articles_by_category(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {
        "index": [],
        "sector": [],
        "macro": [],
        "earnings": [],
        "stock": [],
        "event": [],
    }
    for row in rows:
        article = {
            "title": str(row.get("title") or "").strip(),
            "summary": str(row.get("snippet") or "").strip(),
            "source": str(row.get("source") or "").strip(),
            "url": str(row.get("url") or "").strip(),
            "published_date": str(row.get("published_date") or "").strip(),
            "source_weight": float(row.get("source_weight") or 0.0),
        }
        category = map_news_to_category(article)
        grouped.setdefault(category, []).append(article)

    for key in list(grouped.keys()):
        grouped[key] = sorted(
            grouped[key],
            key=lambda item: (
                float(item.get("source_weight") or 0.0),
                recency_score(str(item.get("published_date") or "")),
            ),
            reverse=True,
        )
    return grouped


def _fmt_pct(value: float | None) -> str:
    if not isinstance(value, (int, float)):
        return "--"
    return f"{float(value):+.2f}%"


def build_index_facts(snapshot: dict[str, float | None]) -> list[str]:
    lines: list[str] = []
    for label, key in INDEX_FACT_ORDER:
        lines.append(f"{label}: {_fmt_pct(snapshot.get(key))}")
    return lines


def normalize_text_list(value: Any, max_items: int) -> list[str]:
    if isinstance(value, list):
        return dedupe_lines([str(item).strip() for item in value if str(item).strip()], max_items=max_items)
    if isinstance(value, str) and value.strip():
        return [value.strip()][:max_items]
    return []


def normalize_macro_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        # Preferred SA-21 structure
        if isinstance(value.get("oil"), dict) or isinstance(value.get("rates"), dict):
            output: dict[str, Any] = {}
            for key in ["oil", "rates"]:
                factor = value.get(key)
                if not isinstance(factor, dict):
                    continue
                interpretation = str(factor.get("interpretation") or "").strip()
                if not interpretation:
                    continue
                output[key] = {
                    "value": factor.get("value"),
                    "unit": str(factor.get("unit") or ""),
                    "label": str(factor.get("label") or ""),
                    "change_pct": factor.get("change_pct"),
                    "change_bp": factor.get("change_bp"),
                    "status": str(factor.get("status") or ""),
                    "interpretation": interpretation,
                }
            return output

        # Backward-compatible conversion from old flat macro dict
        converted: dict[str, Any] = {}
        for key, item in value.items():
            k = str(key).strip().lower()
            v = str(item).strip()
            if not k or not v:
                continue
            converted[k] = {
                "value": None,
                "unit": "",
                "label": k.upper(),
                "status": "derived_from_text",
                "interpretation": f"{k}: {v}",
            }
        return converted
    return {}


def macro_lines(macro_factors: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if not isinstance(macro_factors, dict):
        return lines
    for key in ["oil", "rates"]:
        factor = macro_factors.get(key)
        if not isinstance(factor, dict):
            continue
        interpretation = str(factor.get("interpretation") or "").strip()
        if interpretation:
            lines.append(interpretation)
    for key, factor in macro_factors.items():
        if key in {"oil", "rates"}:
            continue
        if not isinstance(factor, dict):
            continue
        interpretation = str(factor.get("interpretation") or "").strip()
        if interpretation:
            lines.append(interpretation)
    return dedupe_lines(lines, max_items=4)


def sectors_summary_line(sectors: list[str]) -> str:
    return " / ".join(sectors[:3]) if sectors else "섹터 전반 혼조 흐름"


def macro_summary_line(macro_factors: dict[str, Any]) -> str:
    lines = macro_lines(macro_factors)
    return " / ".join(lines[:3]) if lines else "거시 변수 혼조"



def derive_macro_labels(macro_factors: dict[str, Any]) -> dict[str, str]:
    """macro_factors 수치에서 macro 텍스트 레이블 자동 생성 — SA-23 2-2"""
    labels: dict[str, str] = {}
    oil = macro_factors.get("oil") if isinstance(macro_factors.get("oil"), dict) else {}
    rates = macro_factors.get("rates") if isinstance(macro_factors.get("rates"), dict) else {}
    if oil.get("value"):
        v = float(oil["value"])
        chg = float(oil.get("change_pct") or 0)
        sign = "+" if chg >= 0 else ""
        labels["oil"] = f"WTI ${v:.2f} ({sign}{chg:.1f}%)"
    if rates.get("value"):
        v = float(rates["value"])
        bp = rates.get("change_bp")
        bp_str = ""
        if isinstance(bp, (int, float)):
            bp_sign = "+" if float(bp) >= 0 else ""
            bp_str = f" ({bp_sign}{float(bp):.0f}bp)"
        labels["rates"] = f"US10Y {v:.2f}%{bp_str}"
    return labels


def fact_theme_lines(events: list[str], sectors: list[str], macro_factors: dict[str, Any]) -> list[str]:
    return dedupe_lines(events + sectors + macro_factor_lines(macro_factors), max_items=5)


def _join_transformed_headlines(articles: list[dict[str, Any]], fallback: str) -> str:
    lines: list[str] = []
    for article in articles[:2]:
        title = transform_headline(str(article.get("title") or ""))
        title = shorten_line(title, 100)
        if title:
            lines.append(title)
    if not lines:
        return fallback
    return " / ".join(lines[:2])


def _extract_top_movers(max_items: int = 5) -> list[dict[str, Any]]:
    tape = load_json("market_tape.json", {"items": []})
    items = tape.get("items") if isinstance(tape, dict) else []
    if not isinstance(items, list):
        items = []

    movers: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        ticker = str(item.get("symbol") or "").upper().strip()
        if not ticker or ticker in INDEX_PROXY_SYMBOLS:
            continue
        try:
            change = float(item.get("chg_pct"))
        except Exception:
            continue
        movers.append({"ticker": ticker, "change_pct": round(change, 2)})

    movers.sort(key=lambda row: abs(float(row.get("change_pct") or 0.0)), reverse=True)
    return movers[:max_items]


def _build_news_map_by_ticker(articles: list[dict[str, Any]], tickers: list[str]) -> dict[str, list[dict[str, Any]]]:
    mapping: dict[str, list[dict[str, Any]]] = {ticker: [] for ticker in tickers}
    alias = {
        "NVDA": ["nvidia"],
        "AAPL": ["apple"],
        "TSLA": ["tesla"],
        "MSFT": ["microsoft"],
        "AMZN": ["amazon"],
        "GOOGL": ["alphabet", "google"],
        "META": ["meta", "facebook"],
    }

    for article in articles:
        title = str(article.get("title") or "")
        summary = str(article.get("summary") or article.get("snippet") or "")
        text = f"{title} {summary}".lower()
        for ticker in tickers:
            t = ticker.lower()
            if t in text:
                mapping[ticker].append(article)
                continue
            if any(word in text for word in alias.get(ticker, [])):
                mapping[ticker].append(article)
    return mapping


def enrich_movers(movers: list[dict[str, Any]], news_map: dict[str, list[dict[str, Any]]]) -> list[str]:
    enriched: list[str] = []

    for m in movers:
        ticker = str(m.get("ticker") or "").upper().strip()
        change = float(m.get("change_pct") or 0.0)

        related_news = news_map.get(ticker, [])

        if change >= 10:
            enriched.append(f"{ticker}: +{change:.2f}% - major event")
        elif change >= 5 and related_news:
            reason = transform_headline(str(related_news[0].get("title") or ""))
            enriched.append(f"{ticker}: +{change:.2f}% - {reason}")
        else:
            enriched.append(f"{ticker}: {change:+.2f}%")

    return enriched


def extract_top_events(event_articles: list[dict[str, Any]]) -> list[str]:
    return [transform_headline(str(a.get("title") or "")) for a in event_articles[:3]]


def build_fixed_fact_payload(
    snapshot: dict[str, float | None],
    cleaned_news: list[dict[str, Any]],
    clusters: list[dict[str, Any]],
    market_data: dict[str, Any],
) -> dict[str, Any]:
    indices = build_index_facts(snapshot)
    fact_core = build_fact_payload(cleaned_news, clusters)
    symbol_change = build_symbol_change_map()

    sectors_norm = normalize_sectors(fact_core.get("sectors"))
    movers_norm = normalize_movers(fact_core.get("movers"), cleaned_news)
    events_norm = normalize_events(fact_core.get("events"))

    events = enhance_events(events_norm)
    sectors = enhance_sectors(sectors_norm, events)
    movers = enhance_movers(movers_norm)
    macro_factors = build_macro_factors(market_data)
    sector_facts = build_sector_facts(sectors, symbol_change, articles=cleaned_news, market_data=market_data)
    mover_facts = build_mover_facts(movers, symbol_change, articles=cleaned_news, market_data=market_data)

    if len(events) < 2:
        events = dedupe_lines(events + ["금리 인하 기대 붕괴", "유가 급등"], max_items=3)
    if not movers:
        movers = ["금리/유가 충돌 → 대형 기술주 변동성 확대"]
    if not sectors:
        sectors = ["경기/금리 해석 엇갈림 → 섹터 혼조"]
    if not macro_factors:
        macro_factors = build_macro_factors({})

    return {
        "indices": indices,
        "sectors": sectors[:3],
        "sector_facts": sector_facts[:3],
        "macro_factors": macro_factors,
        "movers": movers[:5],
        "mover_facts": mover_facts[:3],
        "events": events[:3],
    }


def split_sentences(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
    return [chunk.strip() for chunk in chunks if chunk.strip()]


def parse_json_from_text(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    raise ValueError("No valid JSON object in Claude response")


def summarize_http_error(exc: Exception) -> str:
    if isinstance(exc, requests.HTTPError):
        response = getattr(exc, "response", None)
        if response is not None:
            status = int(response.status_code or 0)
            detail = ""
            try:
                data = response.json()
                if isinstance(data, dict):
                    err = data.get("error")
                    if isinstance(err, dict):
                        detail = str(err.get("message") or err.get("type") or "").strip()
            except Exception:
                detail = ""
            if not detail:
                body = (response.text or "").strip().replace("\n", " ")
                detail = body[:140]
            detail = re.sub(r"\s+", " ", detail).strip()
            return f"HTTP{status}:{detail}" if detail else f"HTTP{status}"
    return exc.__class__.__name__


class ClaudeCallError(RuntimeError):
    def __init__(self, reason: str, detail: str, retry_count: int, *, cause: Exception | None = None) -> None:
        self.reason = reason
        self.detail = detail
        self.retry_count = int(retry_count)
        self.cause = cause
        super().__init__(f"{reason}: {detail}" if detail else reason)


def classify_claude_error(exc: Exception) -> tuple[str, str, bool]:
    detail = summarize_http_error(exc)
    if isinstance(exc, requests.ReadTimeout):
        return "anthropic_read_timeout", detail, True
    if isinstance(exc, requests.ConnectTimeout):
        return "anthropic_connect_timeout", detail, True
    if isinstance(exc, requests.Timeout):
        return "anthropic_read_timeout", detail, True
    if isinstance(exc, requests.ConnectionError):
        return "anthropic_network_error", detail, True
    if isinstance(exc, requests.HTTPError):
        response = getattr(exc, "response", None)
        status = int(response.status_code or 0) if response is not None else 0
        if status in {401, 403}:
            return "anthropic_auth_failed", detail, False
        return "anthropic_bad_response", detail, False
    return "anthropic_bad_response", detail, False


def call_claude(
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 900,
) -> tuple[str, dict[str, Any], int]:
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    retry_count = 0
    max_retry = max(0, CLAUDE_RETRY_MAX)
    attempt = 0

    while True:
        attempt += 1
        try:
            resp = requests.post(
                ANTHROPIC_URL,
                headers=headers,
                json=payload,
                timeout=(CLAUDE_CONNECT_TIMEOUT_SEC, CLAUDE_READ_TIMEOUT_SEC),
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("content")
            text = ""
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        text = str(item.get("text") or "").strip()
                        if text:
                            break
            usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
            return text, usage, retry_count
        except Exception as exc:
            reason, detail, retryable = classify_claude_error(exc)
            can_retry = retryable and retry_count < max_retry
            if can_retry:
                retry_count += 1
                wait_sec = CLAUDE_RETRY_BACKOFF_SEC * retry_count
                _log(
                    f"claude transient error attempt={attempt} reason={reason} "
                    f"retry={retry_count}/{max_retry} wait={wait_sec:.1f}s"
                )
                time.sleep(wait_sec)
                continue
            raise ClaudeCallError(reason=reason, detail=detail, retry_count=retry_count, cause=exc) from exc


def build_daily_prompt(internal_json: dict[str, Any]) -> tuple[str, str]:
    # wo-sa-25-daily-v1
    asof_date = str(internal_json.get("asof_date") or "").strip()
    asof_date_ko = format_asof_date_ko(asof_date)
    required_date = asof_date_ko or "MM월 DD일"
    system_prompt = (
        "You are a market strategist. Version: wo-sa-25-daily-v1\n"
        "You are not a summarizer.\n"
        "Every statement must include evidence.\n"
        "Use numbers when possible.\n"
        "Rules:\n"
        "- Keep role separation: FACT is fixed, write interpretation only\n"
        "- No generic explanation, no repeated facts\n"
        "- Use causal language and connect to driver chain\n"
        "- Write in Korean and do not provide investment advice.\n"
        "- NARRATIVE first sentence must NOT start with S&P 500: X% pattern\n"
        "- NARRATIVE: lead with market character not index list\n"
        "- TODAY CONTEXT: sentence 1 must start with the exact asof date literal"
    )
    user_prompt = (
        "Write from the structured data below.\n"
        "FACT / EVENTS / NARRATIVE must share one causal logic.\n\n"
        "Today Context wo-sa-25-context-v1:\n"
        "- Exactly 2 sentences\n"
        f"- Sentence 1: must start with '{required_date},' + market result with numbers\n"
        "- Sentence 2: key driver via causal chain + historical context N개월 최저/최고\n\n"
        "Market Narrative SA-23 Requirements:\n"
        "- 4 sentences preferred minimum 3\n"
        "- Sentence 1: FORBIDDEN start = S&P 500: X% / Nasdaq: Y% 흐름에서\n"
        "  REQUIRED: lead with index divergence e.g. Nasdaq이 -X%로 S&P500보다 긊은 낙폭\n"
        "- Sentence 2: causal_chain 4 steps must include WTI level AND rate number\n"
        "- Sentence 3: market interpretation split or counter-view\n"
        "- Sentence 4: positioning implication use 로 읽힌다 style\n"
        "- At least one numeric value must appear\n"
        "- Include at least one causal connection\n\n"
        "BANNED never use:\n"
        "- 포지션 속도 조절이 우선되는 국면이다\n"
        "- S&P 500: X% / Nasdaq: Y% 흐름에서\n\n"
        "Mandatory references: key_driver causal_chain macro_factors\n\n"
        "Return JSON only:\n"
        '{ "today_context": "...", "narrative": "..." }\n\n'
        + f"structured_data_json:\n{__import__('json').dumps(internal_json, ensure_ascii=False, indent=2)}"
    )
    return system_prompt, user_prompt


def build_context_prompt(internal_json: dict[str, Any], daily_result: dict[str, Any]) -> tuple[str, str]:
    system_prompt = "You are a market editor. Return concise Korean interpretation only."
    user_prompt = (
        "Return JSON only:\n"
        '{ "today_context": "...", "narrative": "..." }\n\n'
        + f"structured_data_json:\n{json.dumps(internal_json, ensure_ascii=False, indent=2)}\n\n"
        + f"daily_briefing_json:\n{json.dumps(daily_result, ensure_ascii=False, indent=2)}"
    )
    return system_prompt, user_prompt
def build_template_daily(internal_json: dict[str, Any]) -> dict[str, Any]:
    snapshot = internal_json.get("market_snapshot") if isinstance(internal_json.get("market_snapshot"), dict) else {}
    fixed = internal_json.get("fixed_facts") if isinstance(internal_json.get("fixed_facts"), dict) else {}
    numeric_indices = build_index_facts(snapshot)
    macro_factors = fixed.get("macro_factors") if isinstance(fixed.get("macro_factors"), dict) else {}
    macro_factors = macro_factors or (internal_json.get("macro_factors") if isinstance(internal_json.get("macro_factors"), dict) else {})
    sector_facts = fixed.get("sector_facts") if isinstance(fixed.get("sector_facts"), list) else []
    mover_facts = fixed.get("mover_facts") if isinstance(fixed.get("mover_facts"), list) else []
    key_driver = str(internal_json.get("key_driver") or "").strip()
    causal_chain = str(internal_json.get("causal_chain") or "").strip()

    indices = fixed.get("indices") if isinstance(fixed.get("indices"), list) else build_index_facts(snapshot)
    sectors = normalize_text_list(fixed.get("sectors"), max_items=3) or ["섹터 전반 혼조 흐름"]
    sector_facts = sector_facts[:3] if sector_facts else build_sector_facts(sectors, build_symbol_change_map())
    macro_factors = macro_factors or build_macro_factors({})
    movers = normalize_text_list(fixed.get("movers"), max_items=5) or ["특정 종목 집중 움직임 없음"]
    mover_facts = mover_facts[:3] if mover_facts else build_mover_facts(movers, build_symbol_change_map())
    events = normalize_text_list(fixed.get("events"), max_items=3)
    if len(events) < 2:
        events = dedupe_lines(events + ["연준 금리 경로 재평가 진행", "원자재 변수 중심 변동성 확대"], max_items=3)

    idx_line = " / ".join([str(item) for item in numeric_indices[:2]]) or "S&P 500 데이터 확인 중 / Nasdaq 데이터 확인 중"
    macro_lines = macro_factor_lines(macro_factors)
    oil_line = macro_lines[0] if len(macro_lines) > 0 else "WTI 데이터 미확인 — 원자재 변수 점검 필요"
    rate_line = macro_lines[1] if len(macro_lines) > 1 else "10년물 데이터 미확인 — 금리 해석 보류"
    driver_line = key_driver or "유가 급등 → 인플레 압력 → 기술주 하락"
    chain_line = causal_chain or "유가 급등 → 인플레이션 압력 → 금리 상승 → 기술주 밸류 압박"
    narrative = (
        f"{idx_line} 흐름에서 리스크 회피 성격이 강화됐다. "
        f"{oil_line} / {rate_line} 조합이 단기 가격결정의 핵심 변수로 작동했다. "
        f"핵심 드라이버는 {driver_line}이며, 시장은 이 경로를 두고 갈라지고 있다. "
        f"현재 체인은 {chain_line}로 이어져 포지션 속도 조절이 우선되는 국면이다."
    )

    top_themes = fact_theme_lines(events, sectors, macro_factors)
    highlights = dedupe_lines(movers[:3] + events, max_items=5)

    return {
        "indices": [str(item) for item in indices][:4],
        "sectors": sectors,
        "sector_facts": sector_facts,
        "macro_factors": macro_factors,
        "movers": movers,
        "mover_facts": mover_facts,
        "events": events,
        "top_themes_today": top_themes,
        "supporting_highlights": highlights,
        "market_narrative": narrative,
        "narrative": narrative,
    }


def _strip_leading_korean_date(text: str) -> str:
    return re.sub(r"^\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*[,\-—]?\s*", "", str(text or "").strip())


def enforce_today_context_date(text: str, asof_date: str) -> str:
    expected = format_asof_date_ko(asof_date)
    content = str(text or "").strip()
    if not content:
        return content
    if not expected:
        return content

    sentences = split_sentences(content)
    if not sentences:
        return f"{expected}, 시장은 지수보다 거시 변수에 민감하게 반응했다."
    first = _strip_leading_korean_date(sentences[0]).strip()
    if not first:
        first = "시장은 지수보다 거시 변수에 민감하게 반응했다."
    sentences[0] = f"{expected}, {first}"
    return " ".join(sentences[:2]).strip()


def today_context_matches_asof_date(today_context: str, asof_date: str) -> bool:
    expected = format_asof_date_ko(asof_date)
    if not expected:
        return True
    first = split_sentences(str(today_context or "").strip())
    if not first:
        return False
    return first[0].startswith(expected)


def build_template_today_context(internal_json: dict[str, Any], asof_date: str = "") -> str:
    snapshot = internal_json.get("market_snapshot") if isinstance(internal_json.get("market_snapshot"), dict) else {}
    numeric_indices = build_index_facts(snapshot)
    causal_chain = str(internal_json.get("causal_chain") or "").strip()
    date_prefix = format_asof_date_ko(asof_date)
    idx_line = " / ".join([str(item) for item in numeric_indices[:2]]) or "S&P 500 데이터 확인 중 / Nasdaq 데이터 확인 중"
    chain_line = causal_chain or "유가 급등 → 인플레이션 압력 → 금리 상승 → 기술주 밸류 압박"
    first_sentence = f"{idx_line} 기준으로 시장은 추세 추종보다 리스크 축소가 앞선 구간이다."
    if date_prefix:
        first_sentence = f"{date_prefix}, {first_sentence}"
    return f"{first_sentence} 핵심 인과는 {chain_line}이며, 포지션은 공격보다 방어로 기울고 있다."

def dedupe_lines(lines: list[str], max_items: int) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for line in lines:
        cleaned = shorten_line(str(line), 130)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(cleaned)
        if len(output) >= max_items:
            break
    return output


def text_has_any_pattern(text: str, patterns: list[re.Pattern[str]]) -> bool:
    raw = (text or "").strip()
    if not raw:
        return False
    return any(pattern.search(raw) for pattern in patterns)


def remove_generic_phrases(text: str) -> str:
    cleaned = text or ""
    for pattern in GENERIC_PHRASE_PATTERNS:
        cleaned = pattern.sub("", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def remove_banned_causal_phrasing(text: str) -> str:
    cleaned = text
    for pattern in BANNED_CAUSAL_PATTERNS:
        cleaned = pattern.sub("", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def fact_has_news_like_text(text: str) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in NEWS_LIKE_FACT_KEYWORDS)


def fact_has_impact_marker(text: str) -> bool:
    return "→" in text or "—" in text


def event_has_impact_word(text: str) -> bool:
    return any(keyword in text for keyword in EVENT_IMPACT_KEYWORDS)


def to_theme_lines(themes: list[Any]) -> list[str]:
    output: list[str] = []
    for row in themes:
        if isinstance(row, dict):
            title = str(row.get("title") or "").strip()
            if title:
                output.append(title)
        elif isinstance(row, str):
            text = row.strip()
            if text:
                output.append(text)
    return output


def _theme_text(theme: dict[str, Any]) -> str:
    title = str(theme.get("title") or "").strip()
    points = theme.get("points") if isinstance(theme.get("points"), list) else []
    point_text = " ".join([str(point).strip() for point in points if str(point).strip()])
    return f"{title} {point_text}".strip()


def postprocess_selected_themes(themes: list[dict[str, Any]], key_driver: str) -> list[dict[str, Any]]:
    if not isinstance(themes, list):
        return []

    key_driver_text = str(key_driver or "").lower()
    processed: list[tuple[float, int, dict[str, Any]]] = []
    seen_titles: set[str] = set()

    for index, raw_theme in enumerate(themes):
        if not isinstance(raw_theme, dict):
            continue
        title = str(raw_theme.get("title") or "").strip()
        if not title:
            continue
        points = raw_theme.get("points") if isinstance(raw_theme.get("points"), list) else []
        if has_theme_noise(title) or any(has_theme_noise(str(point)) for point in points):
            continue
        title = canonicalize_theme_title(title, [str(point) for point in points], key_driver)
        title_key = title.lower()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)

        theme = {
            "title": title,
            "points": points,
        }
        theme_text = _theme_text(theme).lower()
        score = float(len(theme.get("points") or []))

        if any(keyword in theme_text for keyword in ["oil", "crude", "brent", "wti", "inflation", "rates", "yield", "treasury", "fed"]):
            score += 2.0
        if "oil strength lifts energy" in title_key and any(keyword in key_driver_text for keyword in ["유가", "인플레", "에너지", "금리"]):
            score += 2.5
        if "rate pressure hits tech" in title_key and any(keyword in key_driver_text for keyword in ["유가", "인플레", "기술주 하락", "기술주 약세", "금리 상승", "밸류 압박"]):
            score += 1.5
        if "market drivers remain mixed" in title_key:
            score -= 1.0

        processed.append((score, -index, theme))

    processed.sort(key=lambda item: (item[0], item[1]), reverse=True)
    selected = [theme for _, _, theme in processed[:5]]
    if len(selected) > 1:
        focused = [theme for theme in selected if str(theme.get("title") or "").strip().lower() != "macro drivers in focus"]
        if focused:
            selected = focused
    return selected[:5]


def classify_market_regime(themes: list[str], clusters: list[dict[str, Any]]) -> str:
    cluster_terms: list[str] = []
    for cluster in clusters[:5]:
        term_counter = cluster.get("term_counter")
        if isinstance(term_counter, Counter):
            cluster_terms.extend([str(term) for term, _ in term_counter.most_common(12)])
            continue
        if isinstance(term_counter, dict):
            ordered = sorted(term_counter.items(), key=lambda item: item[1], reverse=True)
            cluster_terms.extend([str(term) for term, _ in ordered[:12]])
    text = f"{' '.join(themes)} {' '.join(cluster_terms)}".lower()

    if "oil" in text or "energy" in text:
        return "inflation_risk_day"
    if "rate cut" in text or "fed" in text:
        return "policy_expectation_day"
    if "selloff" in text or "lowest" in text:
        return "risk_off_day"
    if "tech rebound" in text or "rotation" in text:
        return "rotation_day"
    return "mixed_day"


def build_market_insight(regime: str, themes: list[str], context: str) -> str:
    _ = themes, context
    if regime == "risk_off_day":
        return "성장주보다 현금흐름과 방어력이 우선시되며 위험자산 선호가 빠르게 식은 하루였다."
    if regime == "inflation_risk_day":
        return "유가 급등과 금리 부담이 동시에 기술주 밸류에이션을 압박한 하루였다."
    if regime == "policy_expectation_day":
        return "연준 경로 해석이 엇갈리면서 시장은 방향성보다 timing uncertainty를 더 크게 반영했다."
    return "지수보다 금리와 원자재 해석이 더 중요했던 하루였다."



def safe_decode(value: str) -> str:
    # SA-23 1-2: model output encoding safety
    if value is None:
        return ""
    try:
        value.encode("utf-8").decode("utf-8")
        return value
    except Exception:
        pass
    try:
        return value.encode("latin-1").decode("utf-8")
    except Exception:
        return ""


def has_hangul(text: str) -> bool:
    return any("\uac00" <= char <= "\ud7a3" for char in str(text or ""))


def has_broken_encoding(text: str) -> bool:
    raw = str(text or "")
    if not raw.strip():
        return False
    if "\ufffd" in raw or "??" in raw:
        return True
    allowed_symbols = {"·", "…", "—", "–", "−", "→", "▲", "▼", "△", "%", "$", "₩", "€", "¥", "£", "±", "’", "‘", "“", "”", "•"}
    for char in raw:
        if char.isspace() or char.isdigit() or char.isascii():
            continue
        if "\u1100" <= char <= "\u11ff" or "\u3131" <= char <= "\u318e" or "\uac00" <= char <= "\ud7a3":
            continue
        if char in allowed_symbols:
            continue
        return True
    return False


def build_market_insight_fallback(key_driver: str, macro_factors: dict[str, Any]) -> str:
    oil_factor = macro_factors.get("oil") if isinstance(macro_factors.get("oil"), dict) else {}
    rates_factor = macro_factors.get("rates") if isinstance(macro_factors.get("rates"), dict) else {}
    oil_hot = str(oil_factor.get("status") or "") in {"inflationary_pressure", "supply_shock"}
    rates_hot = str(rates_factor.get("status") or "") in {"tightening_signal", "rate_pressure"}
    key_driver_text = str(key_driver or "").strip()

    if oil_hot and rates_hot:
        return "유가 급등과 금리 부담이 동시에 기술주 밸류에이션을 압박한 하루였다."
    if oil_hot:
        return "유가 급등이 인플레이션 우려를 다시 자극하며 시장의 방어적 포지션을 강화한 하루였다."
    if rates_hot:
        return "금리 부담이 성장주 밸류에이션을 눌렀고 시장은 포지션 속도 조절에 들어간 하루였다."
    if key_driver_text:
        return f"{key_driver_text} 흐름이 지수보다 더 강하게 가격에 반영된 하루였다."
    return "지수보다 금리와 원자재 해석이 더 중요했던 하루였다."


def sanitize_market_insight(text: str, key_driver: str, macro_factors: dict[str, Any]) -> str:
    cleaned = remove_generic_phrases(safe_decode(str(text or "")).strip())
    if not cleaned or has_broken_encoding(cleaned) or not has_hangul(cleaned):
        return build_market_insight_fallback(key_driver, macro_factors)
    return cleaned


def extract_key_driver(themes: list[str]) -> str:
    for row in themes:
        text = str(row or "").strip()
        if text:
            return shorten_line(text, 120)
    return "macro uncertainty"


def build_macro_inputs(themes: list[str], clusters: list[dict[str, Any]]) -> dict[str, str]:
    cluster_terms: list[str] = []
    for cluster in clusters[:6]:
        term_counter = cluster.get("term_counter")
        if isinstance(term_counter, Counter):
            cluster_terms.extend([str(term) for term, _ in term_counter.most_common(10)])
        elif isinstance(term_counter, dict):
            ordered = sorted(term_counter.items(), key=lambda item: item[1], reverse=True)
            cluster_terms.extend([str(term) for term, _ in ordered[:10]])
    text = f"{' '.join(themes)} {' '.join(cluster_terms)}".lower()

    rates = "neutral"
    if any(keyword in text for keyword in ["yield up", "higher rates", "hawkish", "rate pressure", "rate hike"]):
        rates = "up"
    elif any(keyword in text for keyword in ["rate cut", "yield down", "dovish", "easing"]):
        rates = "down"
    elif any(keyword in text for keyword in ["fed", "rates", "yield", "treasury"]):
        rates = "up"

    oil = "neutral"
    if any(keyword in text for keyword in ["oil surge", "oil higher", "crude higher", "brent higher"]):
        oil = "higher"
    elif any(keyword in text for keyword in ["oil lower", "crude lower", "brent lower"]):
        oil = "lower"
    elif any(keyword in text for keyword in ["oil", "crude", "brent", "energy"]):
        oil = "higher"

    return {"rates": rates, "oil": oil}


def build_reaction_indices(snapshot: dict[str, float | None]) -> dict[str, dict[str, float | None]]:
    return {
        "sp500": {"change_pct": snapshot.get("sp500")},
        "nasdaq": {"change_pct": snapshot.get("nasdaq")},
        "dow": {"change_pct": snapshot.get("dow")},
        "vix": {"change_pct": snapshot.get("vix")},
    }


def describe_flow_signals(flow_signals: list[str]) -> list[str]:
    mapping = {
        "tech_focus": "Money concentrated in technology and semiconductors.",
        "narrow_leadership": "Leadership stayed narrow in a limited set of names.",
        "commodity_driven": "Commodities and energy flows were a major driver.",
        "macro_driven": "Macro variables such as rates and inflation drove positioning.",
    }
    lines = [mapping[item] for item in flow_signals if item in mapping]
    return lines or ["Flows looked balanced without a single dominant risk direction."]


def describe_reaction_signals(reaction_signals: list[str]) -> list[str]:
    mapping = {
        "tech_underperformance": "Nasdaq lagged the Dow, signaling pressure on growth duration.",
        "rate_pressure": "Rate pressure limited valuation expansion in high-multiple names.",
        "inflation_fear": "Commodity strength reinforced inflation sensitivity across risk assets.",
    }
    lines = [mapping[item] for item in reaction_signals if item in mapping]
    return lines or ["Price action stayed orderly relative to the incoming headline set."]



def check_driver_direction_consistency(indices: list[str], key_driver: str) -> bool:
    """지수 방향과 Key Driver 일치 검증 — SA-23 2-3"""
    import re as _re
    sp_change: float | None = None
    for line in indices:
        if "S&P 500" in line or "S&P500" in line:
            m = _re.search(r"([+-]?\d+\.?\d*)\s*%", line)
            if m:
                try:
                    sp_change = float(m.group(1))
                except Exception:
                    pass
            break
    if sp_change is None:
        return True
    driver_lower = key_driver.lower()
    bull_signals = ["relief", "supports", "강세", "랠리", "surge", "rebound"]
    if sp_change < -0.5:
        for sig in bull_signals:
            if sig in driver_lower:
                return False
    return True


def sanitize_sector_fact_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    sanitized: list[dict[str, Any]] = []
    warnings: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        next_row = dict(row)
        driver = str(next_row.get("driver") or "").strip()
        change_pct = next_row.get("change_pct")
        if isinstance(change_pct, (int, float)):
            normalized = round(float(change_pct), 2)
            if _has_non_daily_change_clue(driver):
                warnings.append(f"rejected_non_daily_driver:{next_row.get('etf') or next_row.get('name')}")
                next_row["change_pct"] = None
            elif abs(normalized) > SECTOR_DAILY_CHANGE_ABS_MAX:
                warnings.append(f"rejected_out_of_range:{next_row.get('etf') or next_row.get('name')}:{normalized:+.2f}")
                next_row["change_pct"] = None
            else:
                next_row["change_pct"] = normalized
        sanitized.append(next_row)
    return sanitized, warnings


def sector_facts_daily_only(rows: list[dict[str, Any]]) -> bool:
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get("change_pct")
        if not isinstance(value, (int, float)):
            continue
        if _has_non_daily_change_clue(str(row.get("driver") or "")):
            return False
    return True


def sector_facts_range_valid(rows: list[dict[str, Any]]) -> bool:
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get("change_pct")
        if not isinstance(value, (int, float)):
            continue
        if abs(float(value)) > SECTOR_DAILY_CHANGE_ABS_MAX:
            return False
    return True


def selected_themes_are_clean(themes: list[Any]) -> bool:
    for row in themes:
        if isinstance(row, dict):
            title = str(row.get("title") or "").strip()
        else:
            title = str(row or "").strip()
        if not title:
            continue
        if has_theme_noise(title):
            return False
    return True


def quality_gate(
    internal_json: dict[str, Any],
    daily: dict[str, Any],
    today_context: str,
    asof_date: str,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    fallback_daily = build_template_daily(internal_json)
    fallback_context = build_template_today_context(internal_json, asof_date=asof_date)
    causal_chain = str(internal_json.get("causal_chain") or "").strip()
    key_driver = str(internal_json.get("key_driver") or "").strip()

    if "→" not in causal_chain:
        raise Exception("NO CAUSAL CHAIN")
    if key_driver.strip() in {"시장 혼조", "시장 혼조 — 명확한 단일 드라이버 부재"}:
        raise Exception("DRIVER NOT RESOLVED")

    indices = daily.get("indices") if isinstance(daily.get("indices"), list) else fallback_daily.get("indices")
    indices_lines = [str(item).strip() for item in (indices or []) if str(item).strip()]
    if not indices_lines:
        indices_lines = [str(item) for item in (fallback_daily.get("indices") or [])]
    indices_lines = indices_lines[:4]

    sectors_value = daily.get("sectors")
    if sectors_value is None:
        sectors_value = fallback_daily.get("sectors")
    if isinstance(sectors_value, str):
        raise Exception("SECTORS INVALID")
    sectors = normalize_text_list(sectors_value, max_items=3)
    if not sectors:
        raise Exception("SECTORS EMPTY")
    if any("이슈 증가" in item for item in sectors):
        raise Exception("SECTOR NOT NORMALIZED")
    if any("뉴스 집중" in item for item in sectors):
        raise Exception("SECTOR NOT NORMALIZED")
    if any(fact_has_news_like_text(item) for item in sectors):
        raise Exception("SECTOR NEWS-LIKE")
    if any(not fact_has_impact_marker(item) for item in sectors):
        raise Exception("SECTOR IMPACT WEAK")

    sector_facts_raw = daily.get("sector_facts") if isinstance(daily.get("sector_facts"), list) else fallback_daily.get("sector_facts")
    sector_facts = [row for row in (sector_facts_raw or []) if isinstance(row, dict)]
    if not sector_facts:
        sector_facts = build_sector_facts(sectors, build_symbol_change_map())
    sector_facts, sector_warnings = sanitize_sector_fact_rows(sector_facts)

    if daily.get("macro") is not None:
        raise Exception("DUPLICATE MACRO LAYER")
    macro_factors_value = daily.get("macro_factors")
    if macro_factors_value is None:
        macro_factors_value = fallback_daily.get("macro_factors")
    macro_factors = normalize_macro_payload(macro_factors_value)
    if not macro_factors:
        raise Exception("MACRO_FACTORS EMPTY")
    if not all(isinstance((macro_factors.get(key) or {}).get("value"), (int, float)) for key in ["oil", "rates"]):
        raise Exception("MACRO NOT NUMERIC-BASED")
    if not all(str((macro_factors.get(key) or {}).get("interpretation") or "").strip() for key in ["oil", "rates"]):
        raise Exception("MACRO INTERPRETATION MISSING")

    movers_raw = daily.get("movers") if isinstance(daily.get("movers"), list) else fallback_daily.get("movers")
    movers = normalize_text_list(movers_raw, max_items=5)
    if not movers:
        raise Exception("MOVERS EMPTY")
    if any("뉴스 집중" in item for item in movers):
        raise Exception("MOVER TOO GENERIC")
    if any(fact_has_news_like_text(item) for item in movers):
        raise Exception("MOVER NEWS-LIKE")
    if any(not fact_has_impact_marker(item) for item in movers):
        raise Exception("MOVER IMPACT WEAK")
    mover_facts_raw = daily.get("mover_facts") if isinstance(daily.get("mover_facts"), list) else fallback_daily.get("mover_facts")
    mover_facts = [row for row in (mover_facts_raw or []) if isinstance(row, dict)]
    if not mover_facts:
        mover_facts = build_mover_facts(movers, build_symbol_change_map())

    events_raw = daily.get("events") if isinstance(daily.get("events"), list) else fallback_daily.get("events")
    events = normalize_text_list(events_raw, max_items=3)
    if len(events) < 2:
        raise Exception("EVENTS EMPTY")
    events = events[:3]
    if any("관련" in item for item in events):
        raise Exception("EVENT TOO GENERIC")
    if any("뉴스 집중" in item for item in events):
        raise Exception("EVENT TOO GENERIC")
    if any(fact_has_news_like_text(item) for item in events):
        raise Exception("EVENT NEWS-LIKE")
    if any(not event_has_impact_word(item) for item in events):
        raise Exception("EVENT IMPACT WEAK")

    narrative_raw = str(
        daily.get("narrative")
        or daily.get("market_narrative")
        or ""
    ).strip()
    if not narrative_raw:
        narrative_raw = str(fallback_daily.get("market_narrative") or "")
    narrative_raw = remove_banned_causal_phrasing(remove_generic_phrases(narrative_raw))
    narrative_sentences = split_sentences(narrative_raw)
    if len(narrative_sentences) > 4:
        narrative_sentences = narrative_sentences[:4]
    if len(narrative_sentences) < 3:
        narrative_sentences = split_sentences(str(fallback_daily.get("market_narrative") or ""))[:3]
    narrative = " ".join(narrative_sentences).strip()
    if not any(char.isdigit() for char in narrative):
        raise Exception("NO NUMERIC EVIDENCE")

    cleaned_context = remove_banned_causal_phrasing(today_context or str(daily.get("today_context") or ""))
    cleaned_context = remove_generic_phrases(cleaned_context)
    if not cleaned_context:
        cleaned_context = fallback_context
    context_sentences = split_sentences(cleaned_context)
    if len(context_sentences) > 2:
        context_sentences = context_sentences[:2]
    if len(context_sentences) < 2:
        context_sentences = split_sentences(fallback_context)[:2]
    cleaned_context = " ".join(context_sentences).strip()
    cleaned_context = enforce_today_context_date(cleaned_context, asof_date)
    context_sentences = split_sentences(cleaned_context)

    top_themes = fact_theme_lines(events, sectors, macro_factors)
    highlights = dedupe_lines(movers[:3] + events, max_items=5)
    generic_scan_text = " ".join([*indices_lines, *sectors, *macro_lines(macro_factors), *movers, *events, cleaned_context, narrative])

    report = {
        "daily_theme_count": len(top_themes),
        "daily_narrative_sentence_count": len(narrative_sentences),
        "daily_highlight_count": len(highlights),
        "today_context_sentence_count": len(context_sentences),
        "warnings": dedupe_lines(sector_warnings, max_items=20),
        "rules": {
            "facts_have_indices": len(indices_lines) >= 3,
            "causal_chain_present": "→" in causal_chain,
            "driver_resolved": key_driver.strip() not in {"시장 혼조", "시장 혼조 — 명확한 단일 드라이버 부재"},
            "narrative_has_numeric_evidence": any(char.isdigit() for char in narrative),
            "events_2_to_3": 2 <= len(events) <= 3,
            "events_non_empty": len(events) >= 2,
            "movers_non_empty": len(movers) >= 1,
            "sectors_non_empty": len(sectors) >= 1,
            "macro_non_empty": len(macro_factors) >= 1,
            "macro_based_on_numeric": all(
                isinstance((macro_factors.get(key) or {}).get("value"), (int, float))
                for key in ["oil", "rates"]
            ),
            "no_duplicate_macro_layer": daily.get("macro") is None,
            "macro_has_value": all(
                isinstance((macro_factors.get(key) or {}).get("value"), (int, float))
                for key in ["oil", "rates"]
            ),
            "macro_change_pct_preferred": any(
                isinstance((macro_factors.get(key) or {}).get("change_pct"), (int, float))
                or isinstance((macro_factors.get(key) or {}).get("change_bp"), (int, float))
                for key in ["oil", "rates"]
            ),
            "interpretation_from_numeric": all(
                bool(str((macro_factors.get(key) or {}).get("interpretation") or "").strip())
                for key in ["oil", "rates"]
            ),
            "sector_change_pct_preferred": any(isinstance((row or {}).get("change_pct"), (int, float)) for row in sector_facts),
            "mover_change_pct_preferred": any(isinstance((row or {}).get("change_pct"), (int, float)) for row in mover_facts),
            "sector_change_pct_daily_only": sector_facts_daily_only(sector_facts),
            "sector_change_pct_range_valid": sector_facts_range_valid(sector_facts),
            "sector_not_normalized_removed": all("이슈 증가" not in item and "뉴스 집중" not in item for item in sectors),
            "event_too_generic_removed": all("관련" not in item and "뉴스 집중" not in item for item in events),
            "sector_impact_enforced": all(fact_has_impact_marker(item) for item in sectors),
            "mover_impact_enforced": all(fact_has_impact_marker(item) for item in movers),
            "event_impact_enforced": all(event_has_impact_word(item) for item in events),
            "fact_news_like_removed": all(
                not fact_has_news_like_text(item) for item in [*sectors, *movers, *events]
            ),
            "narrative_3_to_4_sentences": 3 <= len(narrative_sentences) <= 4,
            "today_context_2_sentences": len(context_sentences) == 2,
            "banned_causal_pattern_removed": all(not pattern.search(cleaned_context) for pattern in BANNED_CAUSAL_PATTERNS),
            "must_have_insight": bool(str(internal_json.get("market_insight") or "").strip()),
            "market_insight_utf8_clean": not has_broken_encoding(str(internal_json.get("market_insight") or "")),
            "no_generic_phrases": not text_has_any_pattern(generic_scan_text, GENERIC_PHRASE_PATTERNS),
            "today_context_date_from_asof": today_context_matches_asof_date(cleaned_context, asof_date),
            "selected_theme_noise_filtered": selected_themes_are_clean(internal_json.get("top_themes") if isinstance(internal_json.get("top_themes"), list) else []),
            # SA-23 placeholders (updated after sections are built)
            "provider_is_anthropic": False,
            "body_en_not_null": False,
            "narrative_not_starts_with_sp": False,
            "key_driver_direction_consistent": True,
            "today_context_has_date": False,
            "today_context_has_historical": False,
            "sector_change_pct_not_all_null": False,
            "mover_change_pct_not_all_null": False,
        },
    }

    cleaned_daily = {
        "indices": indices_lines,
        "sectors": sectors,
        "sector_facts": sector_facts,
        "macro_factors": macro_factors,
        "movers": movers,
        "mover_facts": mover_facts,
        "events": events,
        "top_themes_today": top_themes,
        "supporting_highlights": highlights,
        "market_narrative": narrative,
        "narrative": narrative,
        "today_context": cleaned_context,
    }
    return cleaned_daily, cleaned_context, report


def market_signal(snapshot: dict[str, float | None]) -> str:
    sp = snapshot.get("sp500")
    nq = snapshot.get("nasdaq")
    if isinstance(sp, (int, float)) and isinstance(nq, (int, float)):
        if sp > 0 and nq > 0:
            return "bull"
        if sp < 0 and nq < 0:
            return "bear"
        return "caution"
    return "neutral"


def _format_change_pct(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):+.2f}%"
    return ""


def _render_sector_fact_line(row: dict[str, Any]) -> str:
    name = str((row or {}).get("name") or "Market")
    etf = str((row or {}).get("etf") or "SPY")
    driver = str((row or {}).get("driver") or "").strip()
    change_text = _format_change_pct((row or {}).get("change_pct"))
    line = f"{name}({etf})"
    if change_text:
        line = f"{line} {change_text}"
    if driver:
        line = f"{line} — {driver}"
    return line


def _render_mover_fact_line(row: dict[str, Any]) -> str:
    symbol = str((row or {}).get("symbol") or "MARKET")
    context = str((row or {}).get("context") or "").strip()
    reason = str((row or {}).get("reason") or "").strip()
    change_text = _format_change_pct((row or {}).get("change_pct"))
    line = symbol
    if change_text:
        line = f"{line} {change_text}"
        extras = [part for part in [context, reason] if part]
    else:
        extras = [part for part in [reason] if part]
    if extras:
        line = " — ".join([line, *extras])
    return line


EN_TEXT_REPLACEMENTS = {
    "에너지주": "Energy equities",
    "금융주": "Financial equities",
    "데이터 확인 중": "data pending",
    "유가 급등": "oil surge",
    "유가 급락": "oil decline",
    "유가": "oil",
    "금리 부담": "rate pressure",
    "금리 상승": "higher rates",
    "금리 하락": "lower rates",
    "금리": "rates",
    "기술주": "technology stocks",
    "반도체": "semiconductors",
    "약세": "weakness",
    "강세": "strength",
    "동조": "in sympathy",
    "수혜": "benefit",
    "차익실현": "profit taking",
    "포지션 재조정": "position rebalancing",
    "변동성 확대": "higher volatility",
    "혼조": "mixed",
    "점검 필요": "monitoring required",
    "금리 인하 기대 붕괴": "Rate-cut expectations faded",
    "중동 리스크 확산": "Middle East risk escalation",
}


def _to_english_text(text: str, fallback: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return fallback
    output = raw
    for ko, en in EN_TEXT_REPLACEMENTS.items():
        output = output.replace(ko, en)
    output = re.sub(r"\s{2,}", " ", output).strip()
    return output if output and not has_hangul(output) else fallback


def _render_sector_fact_line_en(row: dict[str, Any]) -> str:
    name = str((row or {}).get("name") or "Market")
    etf = str((row or {}).get("etf") or "SPY")
    change_text = _format_change_pct((row or {}).get("change_pct"))
    driver = _to_english_text(str((row or {}).get("driver") or "").strip(), "flow driver")
    line = f"{name}({etf})"
    if change_text:
        line = f"{line} {change_text}"
    if driver:
        line = f"{line} — {driver}"
    return line


def _render_mover_fact_line_en(row: dict[str, Any]) -> str:
    raw_symbol = str((row or {}).get("symbol") or "MARKET")
    symbol = _to_english_text(raw_symbol, raw_symbol if raw_symbol.isupper() else "MARKET")
    change_text = _format_change_pct((row or {}).get("change_pct"))
    context = _to_english_text(str((row or {}).get("context") or "").strip(), "")
    reason = _to_english_text(str((row or {}).get("reason") or "").strip(), "rotation-driven move")
    line = symbol
    if change_text:
        line = f"{line} {change_text}"
    extras = [part for part in [context, reason] if part]
    if extras:
        line = " — ".join([line, *extras])
    return line


def _render_macro_lines_en(macro_factors: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    oil = macro_factors.get("oil") if isinstance(macro_factors.get("oil"), dict) else {}
    rates = macro_factors.get("rates") if isinstance(macro_factors.get("rates"), dict) else {}

    oil_label = str(oil.get("label") or "WTI")
    oil_value = oil.get("value")
    oil_change = oil.get("change_pct")
    if isinstance(oil_value, (int, float)):
        oil_line = f"{oil_label} ${float(oil_value):.2f}"
        if isinstance(oil_change, (int, float)):
            oil_line = f"{oil_line} ({float(oil_change):+.1f}%)"
        oil_status = str(oil.get("status") or "")
        if oil_status in {"inflationary_pressure", "supply_shock"}:
            oil_line = f"{oil_line} — inflation pressure building"
        lines.append(oil_line)

    rates_label = str(rates.get("label") or "US10Y")
    rates_value = rates.get("value")
    rates_bp = rates.get("change_bp")
    if isinstance(rates_value, (int, float)):
        rates_line = f"{rates_label} {float(rates_value):.2f}%"
        if isinstance(rates_bp, (int, float)):
            rates_line = f"{rates_line} ({float(rates_bp):+.0f}bp)"
        rates_status = str(rates.get("status") or "")
        if rates_status in {"tightening_signal", "rate_pressure"}:
            rates_line = f"{rates_line} — discount-rate pressure"
        lines.append(rates_line)

    return lines


def _build_indices_body_en(indices: list[Any]) -> str:
    if not indices:
        return "- S&P 500: data pending\n- Nasdaq: data pending\n- Dow: data pending\n- VIX: data pending"
    lines: list[str] = []
    for row in indices:
        text = str(row or "").strip()
        if not text:
            continue
        lines.append(_to_english_text(text, "Index data pending"))
    return "\n".join([f"- {line}" for line in lines]) if lines else "- S&P 500: data pending"


def _build_events_body_en(events: list[Any]) -> str:
    if not events:
        return "- Macro calendar in focus"
    lines: list[str] = []
    for row in events:
        text = _to_english_text(str(row or "").strip(), "Macro event in focus")
        if text:
            lines.append(text)
    return "\n".join([f"- {line}" for line in lines]) if lines else "- Macro event in focus"


def _extract_index_change(indices: list[Any], label: str) -> float | None:
    for row in indices:
        text = str(row or "")
        if label.lower() not in text.lower():
            continue
        match = re.search(r"([+-]?\d+(?:\.\d+)?)\s*%", text)
        if match:
            try:
                return float(match.group(1))
            except Exception:
                continue
    return None


def _build_today_context_en(daily: dict[str, Any], asof_date: str) -> str:
    indices = daily.get("indices") if isinstance(daily.get("indices"), list) else []
    macro_factors = normalize_macro_payload(daily.get("macro_factors"))
    sp = _extract_index_change(indices, "S&P")
    nq = _extract_index_change(indices, "Nasdaq")
    asof_en = format_asof_date_en(asof_date) or "the session"

    if isinstance(sp, (int, float)) and isinstance(nq, (int, float)):
        first_sentence = f"As of {asof_en}, the tape stayed risk-sensitive with S&P 500 {sp:+.2f}% and Nasdaq {nq:+.2f}%."
    else:
        first_sentence = f"As of {asof_en}, cross-asset positioning remained driven by macro repricing."

    oil = macro_factors.get("oil") if isinstance(macro_factors.get("oil"), dict) else {}
    rates = macro_factors.get("rates") if isinstance(macro_factors.get("rates"), dict) else {}
    oil_change = oil.get("change_pct")
    rates_bp = rates.get("change_bp")
    if isinstance(oil_change, (int, float)) or isinstance(rates_bp, (int, float)):
        oil_text = f"oil {float(oil_change):+.1f}%" if isinstance(oil_change, (int, float)) else "oil levels"
        rate_text = f"US10Y {float(rates_bp):+.0f}bp" if isinstance(rates_bp, (int, float)) else "US10Y levels"
        second_sentence = f"Macro drivers stayed dominant as {oil_text} and {rate_text} shaped valuation pressure."
    else:
        second_sentence = "Macro drivers stayed dominant and valuation sensitivity remained elevated."
    return f"{first_sentence} {second_sentence}"


def _build_narrative_en(daily: dict[str, Any], flow_signals: list[str], reaction_signals: list[str], positioning: str) -> str:
    themes = daily.get("top_themes_today") if isinstance(daily.get("top_themes_today"), list) else []
    theme_text = ", ".join([str(item) for item in themes[:2] if str(item).strip()]) or "macro crosscurrents"
    flow_text = ", ".join(describe_flow_signals(flow_signals)[:1])
    reaction_text = ", ".join(describe_reaction_signals(reaction_signals)[:1])
    positioning_text = _to_english_text(positioning, "Positioning stayed selective.")
    sentence_1 = f"Market narrative was led by {theme_text}."
    sentence_2 = flow_text or "Flows stayed selective across sectors."
    sentence_3 = reaction_text or "Price action remained sensitive to macro headlines."
    sentence_4 = positioning_text if positioning_text.endswith(".") else f"{positioning_text}."
    narrative_en = " ".join([sentence_1, sentence_2, sentence_3, sentence_4])
    return narrative_en if not has_hangul(narrative_en) else "Macro repricing drove selective risk-taking through the session."


def _safe_body_en(value: str, fallback: str = "Translation pending.") -> str:
    text = str(value or "").strip()
    if not text or has_hangul(text):
        return fallback
    return text


def build_sections(
    daily: dict[str, Any],
    signal: str,
    summary_statement: str,
    today_context: str,
    flow_signals: list[str],
    reaction_signals: list[str],
    positioning: str,
    asof_date: str = "",
) -> list[dict[str, Any]]:
    indices = daily.get("indices") if isinstance(daily.get("indices"), list) else []
    movers = daily.get("movers") if isinstance(daily.get("movers"), list) else []
    events = daily.get("events") if isinstance(daily.get("events"), list) else []
    sectors = normalize_text_list(daily.get("sectors"), max_items=3)
    sector_facts = daily.get("sector_facts") if isinstance(daily.get("sector_facts"), list) else []
    macro_factors = normalize_macro_payload(daily.get("macro_factors"))
    mover_facts = daily.get("mover_facts") if isinstance(daily.get("mover_facts"), list) else []
    narrative = str(daily.get("narrative") or daily.get("market_narrative") or "").strip()
    context_body = (today_context or str(daily.get("today_context") or "")).strip()

    indices_body = "\n".join([f"- {str(line)}" for line in indices]) if indices else "- S&P 500: 데이터 확인 중\n- Nasdaq: 데이터 확인 중\n- Dow: 데이터 확인 중\n- VIX: 데이터 확인 중"
    indices_body_en = _build_indices_body_en(indices)
    movers_body = ""
    movers_body_en = ""
    if mover_facts:
        mover_lines = [_render_mover_fact_line(row) for row in mover_facts[:3] if isinstance(row, dict)]
        movers_body = "\n".join([f"- {line}" for line in mover_lines])
        mover_lines_en = [_render_mover_fact_line_en(row) for row in mover_facts[:3] if isinstance(row, dict)]
        movers_body_en = "\n".join([f"- {line}" for line in mover_lines_en]) if mover_lines_en else "- Major movers tracked with mixed momentum"
    else:
        movers_body = "\n".join([f"- {str(line)}" for line in movers]) if movers else "- 특정 종목 집중 움직임 없음"
        movers_body_en = "\n".join([f"- {_to_english_text(str(line), 'Single-name flow was muted')}" for line in movers]) if movers else "- Single-name flow was muted"
    events_body = "\n".join([f"- {str(line)}" for line in events]) if events else "- 연준 금리 경로 재평가 진행\n- 원자재 변수 중심 변동성 확대"
    events_body_en = _build_events_body_en(events)
    sectors_body = ""
    sectors_body_en = ""
    if sector_facts:
        sector_lines = [_render_sector_fact_line(row) for row in sector_facts[:3] if isinstance(row, dict)]
        sectors_body = "\n".join([f"- {line}" for line in sector_lines])
        sector_lines_en = [_render_sector_fact_line_en(row) for row in sector_facts[:3] if isinstance(row, dict)]
        sectors_body_en = "\n".join([f"- {line}" for line in sector_lines_en]) if sector_lines_en else "- Sector rotation remained mixed"
    else:
        sectors_body = "\n".join([f"- {line}" for line in sectors]) if sectors else "- 섹터 전반 혼조 흐름"
        sectors_body_en = "\n".join([f"- {_to_english_text(str(line), 'Sector rotation remained mixed')}" for line in sectors]) if sectors else "- Sector rotation remained mixed"
    macro_body = "\n".join([f"- {line}" for line in macro_lines(macro_factors)]) if macro_factors else "- 거시 팩터 데이터 점검 필요"
    macro_lines_en = _render_macro_lines_en(macro_factors)
    macro_body_en = "\n".join([f"- {line}" for line in macro_lines_en]) if macro_lines_en else "- Macro factor data pending"
    narrative_body = narrative or str(summary_statement or "").strip()
    context_body_en = _build_today_context_en(daily, asof_date)
    narrative_body_en = _build_narrative_en(daily, flow_signals, reaction_signals, positioning)

    return [
        {
            "id": "market_indices",
            "title_ko": "Major Indices",
            "title_en": "Major Indices",
            "body_ko": indices_body,
            "body_en": _safe_body_en(indices_body_en),
            "signal": signal,
            "tags": ["facts", "indices"],
            "color": "#22d3ee",
        },
        {
            "id": "sector_performance",
            "title_ko": "Sector Flow",
            "title_en": "Sector Flow",
            "body_ko": sectors_body,
            "body_en": _safe_body_en(sectors_body_en),
            "signal": signal,
            "tags": ["facts", "sector"],
            "color": "#7dd3fc",
        },
        {
            "id": "commodities_bonds",
            "title_ko": "Commodities / Rates",
            "title_en": "Commodities / Rates",
            "body_ko": macro_body,
            "body_en": _safe_body_en(macro_body_en),
            "signal": signal,
            "tags": ["facts", "macro"],
            "color": "#38bdf8",
        },
        {
            "id": "stock_highlights",
            "title_ko": "Major Movers",
            "title_en": "Major Movers",
            "body_ko": movers_body,
            "body_en": _safe_body_en(movers_body_en),
            "signal": signal,
            "tags": ["facts", "movers"],
            "color": "#60a5fa",
        },
        {
            "id": "major_events",
            "title_ko": "Major Events",
            "title_en": "Major Events",
            "body_ko": events_body,
            "body_en": _safe_body_en(events_body_en),
            "signal": signal,
            "tags": ["facts", "events"],
            "color": "#93c5fd",
        },
        {
            "id": "today_context",
            "title_ko": "Today Context",
            "title_en": "Today Context",
            "body_ko": context_body,
            "body_en": _safe_body_en(context_body_en),
            "signal": signal,
            "tags": ["interpretation", "context"],
            "color": "#38bdf8",
        },
        {
            "id": "market_narrative",
            "title_ko": "Market Narrative",
            "title_en": "Market Narrative",
            "body_ko": narrative_body,
            "body_en": _safe_body_en(narrative_body_en),
            "signal": signal,
            "tags": ["interpretation", "narrative"],
            "color": "#38bdf8",
        },
    ]


def sections_have_clean_placeholders(sections: list[dict[str, Any]]) -> bool:
    for section in sections:
        if not isinstance(section, dict):
            continue
        for field in ["body_ko", "body_en"]:
            value = section.get(field)
            if isinstance(value, str) and "--" in value:
                return False
    return True


def sections_follow_body_en_policy(sections: list[dict[str, Any]]) -> bool:
    for section in sections:
        if not isinstance(section, dict):
            continue
        body_en = section.get("body_en")
        if body_en is None:
            return False  # SA-23: null body_en is now a violation
        if not isinstance(body_en, str):
            return False
        if has_hangul(body_en):
            return False
    return True


def first_sentence(text: str) -> str:
    sentences = split_sentences(text)
    return sentences[0] if sentences else text.strip()


def build_minimal_output(data_date: str, reason: str) -> dict[str, Any]:
    minimal_market_data = {
        "sp500": None,
        "nasdaq": None,
        "dow": None,
        "vix": None,
        "oil": None,
        "oil_change_pct": None,
        "yield10y": None,
        "yield10y_change_bp": None,
    }
    minimal_macro_factors = build_macro_factors(minimal_market_data)
    fallback_daily = {
        "indices": ["S&P 500: 데이터 확인 중", "Nasdaq: 데이터 확인 중", "Dow: 데이터 확인 중", "VIX: 데이터 확인 중"],
        "sectors": ["경기/금리 해석 엇갈림 → 섹터 혼조"],
        "sector_facts": [{"name": "Market", "etf": "SPY", "change_pct": None, "driver": "데이터 지연"}],
        "macro_factors": minimal_macro_factors,
        "movers": ["금리/유가 충돌 → 대형 기술주 변동성 확대"],
        "mover_facts": [{"symbol": "MARKET", "change_pct": None, "context": "데이터 지연", "reason": "포지션 재조정"}],
        "events": ["연준 금리 경로 재평가 진행", "원자재 변수 중심 변동성 확대"],
    }
    fallback_daily["top_themes_today"] = dedupe_lines(
        fact_theme_lines(
            fallback_daily["events"],
            fallback_daily["sectors"],
            fallback_daily["macro_factors"],
        ),
        max_items=5,
    )
    fallback_daily["supporting_highlights"] = dedupe_lines(
        list(fallback_daily["movers"]) + list(fallback_daily["events"]),
        max_items=5,
    )

    narrative_text = (
        "라이브 데이터 수집이 일시적으로 지연되어 템플릿 브리핑으로 전환된 상태다. "
        "실시간 숫자 흐름이 복구되기 전까지는 지수 분화, 금리 민감도, 상대 강도 변화만 보수적으로 해석할 필요가 있다. "
        "데이터와 모델 호출이 정상화되면 서사는 자동으로 다시 생성된다."
    )
    context_text = build_template_today_context({}, asof_date=data_date)

    fallback_daily["market_narrative"] = narrative_text
    fallback_daily["narrative"] = narrative_text
    fallback_daily["today_context"] = context_text

    market_regime = "mixed_day"
    market_insight = "유가와 금리 해석이 엇갈리는 가운데 시장은 방향성보다 포지션 방어를 우선한 하루였다."
    key_driver = "시장 혼조 — 명확한 단일 드라이버 부재"
    causal_chain = "시장 혼조 → 단일 인과 미형성"
    flow_signals = ["macro_driven"]
    reaction_signals = ["tech_underperformance"]
    positioning = "포지션 중립 구간"
    summary_statement = first_sentence(context_text)
    signal = "neutral"
    minimal_confidence = round(
        float(
            compute_overall_confidence(
                {
                    "sector_facts": fallback_daily.get("sector_facts"),
                    "macro_factors": fallback_daily.get("macro_factors"),
                }
            )
        ),
        2,
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_date": data_date,
        "pipeline": PIPELINE_VERSION,
        "provider": "fallback",
        "model": "template",
        "summary_statement": summary_statement,
        "market_regime": market_regime,
        "market_insight": market_insight,
        "key_driver": key_driver,
        "causal_chain": causal_chain,
        "flow_signals": flow_signals,
        "market_reaction": reaction_signals,
        "positioning": positioning,
        "indices": fallback_daily["indices"],
        "sectors": fallback_daily["sectors"],
        "sector_facts": fallback_daily["sector_facts"],
        "macro_factors": fallback_daily["macro_factors"],
        "movers": fallback_daily["movers"],
        "mover_facts": fallback_daily["mover_facts"],
        "events": fallback_daily["events"],
        "today_context": context_text,
        "narrative": narrative_text,
        "daily_briefing": fallback_daily,
        "confidence_score": minimal_confidence,
        "theme_valid_count": 0,
        "sections": build_sections(
            daily=fallback_daily,
            signal=signal,
            summary_statement=summary_statement,
            today_context=context_text,
            flow_signals=flow_signals,
            reaction_signals=reaction_signals,
            positioning=positioning,
            asof_date=data_date,
        ),
        "quality_gate": {
            "daily_theme_count": len(fallback_daily["top_themes_today"]),
            "daily_narrative_sentence_count": len(split_sentences(narrative_text)),
            "daily_highlight_count": len(fallback_daily["supporting_highlights"]),
            "today_context_sentence_count": len(split_sentences(context_text)),
            "theme_valid_count": 0,
            "confidence_score": minimal_confidence,
            "theme_noise_filtered": False,
            "data_confident": minimal_confidence >= 0.6,
            "rules": {},
        },
        "_meta": {
            "provider_requested": "template",
            "provider_used": "fallback",
            "model_used": "template",
            "retry_count": 0,
            "fallback_used": True,
            "fallback_reason": reason,
            "fallback_detail": reason,
            "news_pool_size": 0,
            "cluster_count": 0,
            "pipeline_version": PIPELINE_VERSION,
            "prompt_version_daily": DAILY_PROMPT_VERSION,
            "prompt_version_context": TODAY_CONTEXT_PROMPT_VERSION,
        },
    }

def serialize_article(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "query": str(row.get("query") or ""),
        "topic": str(row.get("topic") or ""),
        "title": str(row.get("title") or ""),
        "url": str(row.get("url") or ""),
        "domain": str(row.get("domain") or ""),
        "source": str(row.get("source") or ""),
        "published_date": str(row.get("published_date") or ""),
        "snippet": shorten_line(str(row.get("snippet") or ""), 220),
        "source_tier": str(row.get("source_tier") or ""),
        "source_weight": float(row.get("source_weight") or 0.0),
        "term_count": len(row.get("terms") or []),
    }


def serialize_clusters(clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, cluster in enumerate(clusters, start=1):
        articles = cluster.get("articles") if isinstance(cluster.get("articles"), list) else []
        top_terms = [term for term, _ in (cluster.get("term_counter") or Counter()).most_common(8)]
        out.append(
            {
                "cluster_id": idx,
                "article_count": len(articles),
                "source_score": round(float(cluster.get("source_score") or 0.0), 4),
                "top_terms": top_terms,
                "titles": [shorten_line(str((a or {}).get("title") or ""), 140) for a in articles[:8]],
                "urls": [str((a or {}).get("url") or "") for a in articles[:8]],
                "domains": sorted({str((a or {}).get("domain") or "") for a in articles if (a or {}).get("domain")}),
            }
        )
    return out


def save_validation_artifacts(
    base_dir: Path,
    asof_date: str,
    payload: dict[str, Any],
    raw_pool: list[dict[str, Any]],
    deduped_pool: list[dict[str, Any]],
    clusters: list[dict[str, Any]],
    selected_themes: list[dict[str, Any]],
    daily_briefing: dict[str, Any],
    today_context: str,
    quality_gate_result: dict[str, Any],
) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = base_dir / asof_date / stamp
    run_dir.mkdir(parents=True, exist_ok=True)

    payload_meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
    metadata = {
        "asof_date": asof_date,
        "generated_at": payload.get("generated_at"),
        "pipeline": payload.get("pipeline"),
        "pipeline_version": payload_meta.get("pipeline_version"),
        "provider_requested": payload_meta.get("provider_requested"),
        "provider_used": payload_meta.get("provider_used"),
        "model_used": payload_meta.get("model_used"),
        "retry_count": payload_meta.get("retry_count"),
        "fallback_used": payload_meta.get("fallback_used"),
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "prompt_version_daily": payload_meta.get("prompt_version_daily"),
        "prompt_version_context": payload_meta.get("prompt_version_context"),
        "fallback_reason": payload_meta.get("fallback_reason"),
        "fallback_detail": payload_meta.get("fallback_detail"),
    }

    files = {
        "00_metadata.json": metadata,
        "01_raw_article_pool.json": [serialize_article(row) for row in raw_pool],
        "02_deduped_articles.json": [serialize_article(row) for row in deduped_pool],
        "03_clusters.json": serialize_clusters(clusters),
        "04_selected_themes.json": selected_themes,
        "05_daily_briefing.json": daily_briefing,
        "06_today_context.json": {"today_context": today_context},
        "07_quality_gate.json": quality_gate_result,
        "99_final_payload.json": payload,
    }

    for filename, content in files.items():
        with open(run_dir / filename, "w", encoding="utf-8") as handle:
            json.dump(content, handle, ensure_ascii=False, indent=2)
    return run_dir


def run_pipeline(
    asof_date: str | None = None,
    write_main_cache: bool = True,
    validation_output_dir: str | Path | None = None,
    allow_previous_cache_reuse: bool = True,
) -> dict[str, Any]:
    env = load_env()
    data_date = (asof_date or infer_data_date()).strip()[:10]
    previous_cache = read_previous_cache() if allow_previous_cache_reuse else None

    tavily_key = env.get("TAVILY_API_KEY", "").strip()
    claude_key = env.get("ANTHROPIC_API_KEY", "").strip()
    claude_model = env.get("ANTHROPIC_MODEL", DEFAULT_CLAUDE_MODEL).strip() or DEFAULT_CLAUDE_MODEL
    active_queries = build_tavily_queries(data_date)

    if not tavily_key:
        if previous_cache:
            _log("missing TAVILY_API_KEY -> reusing previous cache")
            return previous_cache
        payload = build_minimal_output(data_date, "missing_tavily_api_key")
        if write_main_cache:
            write_output(payload)
        _log(f"saved minimal output -> {OUT_PATH}")
        return payload

    raw_news, ingest_logs = run_tavily_ingestion(tavily_key, asof_date=data_date, queries=active_queries)
    _log(f"tavily queries={len(active_queries)} raw_results={len(raw_news)}")
    for row in ingest_logs:
        _log(row)

    cleaned_news = dedupe_and_filter(raw_news)
    if len(cleaned_news) < MIN_RESULTS:
        _log(f"news pool below target: {len(cleaned_news)} < {MIN_RESULTS}")
    cleaned_news = cleaned_news[:MAX_RESULTS]

    if not cleaned_news:
        if previous_cache:
            _log("tavily returned no usable news -> reusing previous cache")
            return previous_cache
        payload = build_minimal_output(data_date, "no_usable_news_after_filtering")
        if write_main_cache:
            write_output(payload)
        _log(f"saved minimal output -> {OUT_PATH}")
        return payload

    clusters = cluster_articles(cleaned_news)
    if not clusters and previous_cache:
        _log("clustering failed -> reusing previous cache")
        return previous_cache

    valid_theme_clusters = rank_valid_theme_clusters(clusters)
    top_clusters = valid_theme_clusters[:3]
    if not top_clusters:
        _log("no valid theme clusters passed source-type hard filter")

    snapshot = build_market_snapshot()
    market_data_context = build_market_data_context(snapshot, cleaned_news)
    internal_json = build_internal_json(top_clusters, snapshot)
    fact_payload = build_fixed_fact_payload(snapshot, cleaned_news, clusters, market_data_context)
    index_evidence = build_index_facts(snapshot)
    macro_factors = fact_payload.get("macro_factors") if isinstance(fact_payload.get("macro_factors"), dict) else {}
    if not macro_factors:
        macro_factors = build_macro_factors(market_data_context)
        fact_payload["macro_factors"] = macro_factors
    resolved_driver = derive_key_driver(fact_payload)
    causal_chain = build_causal_chain(fact_payload)
    selected_themes = postprocess_selected_themes(
        internal_json.get("top_themes") if isinstance(internal_json.get("top_themes"), list) else [],
        resolved_driver,
    )
    theme_valid_count = len(valid_theme_clusters)
    internal_json["top_themes"] = selected_themes
    base_theme_lines = to_theme_lines(selected_themes)
    reaction_indices = build_reaction_indices(snapshot)
    macro_inputs = build_macro_inputs(base_theme_lines, clusters)
    flow_signals = build_flow_signals(base_theme_lines, clusters)
    reaction_signals = build_market_reaction(reaction_indices, macro_inputs)
    positioning = build_positioning(flow_signals, reaction_signals)
    internal_regime = classify_market_regime(base_theme_lines, clusters)
    internal_driver = resolved_driver or extract_key_driver(base_theme_lines)
    internal_insight = build_market_insight(internal_regime, base_theme_lines, "")
    internal_insight = sanitize_market_insight(internal_insight, internal_driver, macro_factors)
    internal_json["flow_signals"] = flow_signals
    internal_json["market_reaction"] = reaction_signals
    internal_json["positioning"] = positioning
    internal_json["reaction_indices"] = reaction_indices
    internal_json["indices"] = fact_payload.get("indices")
    internal_json["sectors"] = fact_payload.get("sectors")
    internal_json["sector_facts"] = fact_payload.get("sector_facts")
    internal_json["macro_factors"] = macro_factors
    internal_json["movers"] = fact_payload.get("movers")
    internal_json["mover_facts"] = fact_payload.get("mover_facts")
    internal_json["events"] = fact_payload.get("events")
    internal_json["fixed_facts"] = fact_payload
    internal_json["selected_articles"] = {}
    internal_json["macro_signals"] = macro_inputs
    internal_json["market_regime"] = internal_regime
    internal_json["key_driver"] = internal_driver
    internal_json["causal_chain"] = causal_chain
    internal_json["index_evidence"] = index_evidence
    internal_json["market_insight"] = internal_insight
    internal_json["asof_date"] = data_date

    daily_result: dict[str, Any] | None = None
    today_context = ""
    provider = "template"
    model = "template"
    usage: dict[str, Any] = {}
    fallback_reason: str | None = None
    fallback_detail: str | None = None
    claude_retry_count = 0
    provider_requested = "anthropic" if claude_key else "template"

    if claude_key:
        try:
            daily_system, daily_user = build_daily_prompt(internal_json)
            daily_raw, usage_daily, retry_daily = call_claude(
                api_key=claude_key,
                model=claude_model,
                system_prompt=daily_system,
                user_prompt=daily_user,
                max_tokens=700,
            )
            claude_retry_count += int(retry_daily)
            model_result = parse_json_from_text(daily_raw)
            today_context = str(model_result.get("today_context") or "").strip()
            narrative = str(model_result.get("narrative") or "").strip()
            daily_result = {
                **fact_payload,
                "top_themes_today": fact_theme_lines(
                    normalize_text_list(fact_payload.get("events"), max_items=3),
                    normalize_text_list(fact_payload.get("sectors"), max_items=3),
                    normalize_macro_payload(fact_payload.get("macro_factors")),
                ),
                "supporting_highlights": dedupe_lines(
                    [*fact_payload.get("movers", [])[:3], *fact_payload.get("events", [])],
                    max_items=5,
                ),
                "market_narrative": narrative,
                "narrative": narrative,
                "today_context": today_context,
            }

            provider = "anthropic"
            model = claude_model
            usage = {
                "input": int(usage_daily.get("input_tokens") or 0),
                "output": int(usage_daily.get("output_tokens") or 0),
            }
        except ClaudeCallError as exc:
            claude_retry_count += int(exc.retry_count)
            fallback_reason = exc.reason
            fallback_detail = exc.detail
            _log(f"claude generation failed -> template fallback ({exc.reason}: {exc.detail})")
        except Exception as exc:
            reason, detail, _ = classify_claude_error(exc)
            fallback_reason = reason
            fallback_detail = detail
            _log(f"claude generation failed -> template fallback ({reason}: {detail})")

    if daily_result is None:
        # SA-23 1-1: production mode blocks template fallback
        if PIPELINE_RUN_MODE == "production" and claude_key:
            _log(f"[SA-23] production mode: Claude call failed ({fallback_reason}: {fallback_detail}), not falling back to template")
            raise RuntimeError(f"SA-23 production mode: Claude call failed — {fallback_reason}: {fallback_detail}")
        daily_result = build_template_daily(internal_json)
        today_context = build_template_today_context(internal_json, asof_date=data_date)
        provider = "template"
        model = "template"
        if not fallback_reason:
            fallback_reason = "missing_anthropic_api_key"
        if not fallback_detail:
            fallback_detail = "ANTHROPIC_API_KEY not found"

    cleaned_daily, cleaned_context, quality_report = quality_gate(
        internal_json=internal_json,
        daily=daily_result,
        today_context=today_context,
        asof_date=data_date,
    )
    market_regime = internal_regime
    market_insight = sanitize_market_insight(
        internal_insight,
        internal_driver,
        normalize_macro_payload(cleaned_daily.get("macro_factors")),
    )
    key_driver = internal_driver

    rules = quality_report.get("rules") if isinstance(quality_report.get("rules"), dict) else {}
    final_theme_lines = to_theme_lines(cleaned_daily.get("top_themes_today") if isinstance(cleaned_daily.get("top_themes_today"), list) else [])
    rule_text = " ".join([str(cleaned_daily.get("market_narrative") or ""), cleaned_context, market_insight, *final_theme_lines])
    rules["must_have_insight"] = bool(market_insight.strip())
    rules["no_generic_phrases"] = not text_has_any_pattern(rule_text, GENERIC_PHRASE_PATTERNS)
    quality_report["rules"] = rules

    summary_statement = first_sentence(cleaned_context) or first_sentence(str(cleaned_daily.get("market_narrative") or ""))
    signal = market_signal(snapshot)
    sections = build_sections(
        daily=cleaned_daily,
        signal=signal,
        summary_statement=summary_statement,
        today_context=cleaned_context,
        flow_signals=flow_signals,
        reaction_signals=reaction_signals,
        positioning=positioning,
        asof_date=data_date,
    )
    rules["macro_change_pct_preferred"] = any(
        isinstance((normalize_macro_payload(cleaned_daily.get("macro_factors")).get(key) or {}).get("change_pct"), (int, float))
        or isinstance((normalize_macro_payload(cleaned_daily.get("macro_factors")).get(key) or {}).get("change_bp"), (int, float))
        for key in ["oil", "rates"]
    )
    rules["sector_change_pct_preferred"] = any(
        isinstance((row or {}).get("change_pct"), (int, float))
        for row in (cleaned_daily.get("sector_facts") or [])
        if isinstance(row, dict)
    )
    rules["mover_change_pct_preferred"] = any(
        isinstance((row or {}).get("change_pct"), (int, float))
        for row in (cleaned_daily.get("mover_facts") or [])
        if isinstance(row, dict)
    )
    rules["broken_placeholder_removed"] = sections_have_clean_placeholders(sections)
    rules["market_insight_utf8_clean"] = not has_broken_encoding(market_insight)
    rules["body_en_not_korean_copy"] = sections_follow_body_en_policy(sections)
    # SA-23 new rules
    rules["provider_is_anthropic"] = (provider == "anthropic")
    rules["body_en_not_null"] = all(
        section.get("body_en") is not None
        for section in sections if isinstance(section, dict)
    )
    narrative_first = (cleaned_daily.get("narrative") or "").strip().split(".")[0]
    rules["narrative_not_starts_with_sp"] = not bool(re.match(
        r"S&P\s*500\s*:\s*[+-]?\d",
        narrative_first.strip()
    ))
    rules["key_driver_direction_consistent"] = check_driver_direction_consistency(
        cleaned_daily.get("indices") or [],
        key_driver
    )
    ctx_text = cleaned_context or ""
    rules["today_context_has_date"] = bool(re.search(r"\d+\s*월\s*\d+\s*일", ctx_text))
    rules["today_context_date_from_asof"] = today_context_matches_asof_date(ctx_text, data_date)
    rules["today_context_has_historical"] = bool(re.search(
        r"(\d+개월|\d+년|최저|최고|신저가|신고가)", ctx_text
    ))
    rules["sector_change_pct_daily_only"] = sector_facts_daily_only(
        cleaned_daily.get("sector_facts") if isinstance(cleaned_daily.get("sector_facts"), list) else []
    )
    rules["sector_change_pct_range_valid"] = sector_facts_range_valid(
        cleaned_daily.get("sector_facts") if isinstance(cleaned_daily.get("sector_facts"), list) else []
    )
    rules["selected_theme_noise_filtered"] = selected_themes_are_clean(
        internal_json.get("top_themes") if isinstance(internal_json.get("top_themes"), list) else []
    )
    rules["sector_change_pct_not_all_null"] = any(
        isinstance((row or {}).get("change_pct"), (int, float))
        for row in (cleaned_daily.get("sector_facts") or [])
    )
    rules["mover_change_pct_not_all_null"] = any(
        isinstance((row or {}).get("change_pct"), (int, float))
        for row in (cleaned_daily.get("mover_facts") or [])
    )
    confidence_score = compute_overall_confidence(
        {
            "sector_facts": cleaned_daily.get("sector_facts") if isinstance(cleaned_daily.get("sector_facts"), list) else [],
            "macro_factors": normalize_macro_payload(cleaned_daily.get("macro_factors")),
        }
    )
    quality_report["theme_valid_count"] = int(theme_valid_count)
    quality_report["confidence_score"] = round(float(confidence_score), 2)
    quality_report["theme_noise_filtered"] = int(theme_valid_count) >= 2
    quality_report["data_confident"] = float(confidence_score) >= 0.6
    rules["theme_noise_filtered"] = int(theme_valid_count) >= 2
    rules["data_confident"] = float(confidence_score) >= 0.6
    quality_report["rules"] = rules

    out_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_date": data_date,
        "pipeline": PIPELINE_VERSION,
        "provider": provider,
        "model": model,
        "tokens": usage,
        "summary_statement": summary_statement,
        "market_regime": market_regime,
        "market_insight": market_insight,
        "key_driver": key_driver,
        "causal_chain": causal_chain,
        "flow_signals": flow_signals,
        "market_reaction": reaction_signals,
        "positioning": positioning,
        "indices": cleaned_daily.get("indices"),
        "sectors": cleaned_daily.get("sectors"),
        "sector_facts": cleaned_daily.get("sector_facts"),
        "macro_factors": cleaned_daily.get("macro_factors"),
        "movers": cleaned_daily.get("movers"),
        "mover_facts": cleaned_daily.get("mover_facts"),
        "events": cleaned_daily.get("events"),
        "today_context": cleaned_context,
        "narrative": cleaned_daily.get("narrative") or cleaned_daily.get("market_narrative"),
        "daily_briefing": cleaned_daily,
        "sections": sections,
        "confidence_score": round(float(confidence_score), 2),
        "theme_valid_count": int(theme_valid_count),
        "quality_gate": quality_report,
        "_meta": {
            "news_pool_size": len(cleaned_news),
            "cluster_count": len(clusters),
            "top_cluster_count": len(top_clusters),
            "provider_requested": provider_requested,
            "provider_used": provider,
            "model_used": model,
            "retry_count": int(claude_retry_count),
            "fallback_used": provider != "anthropic",
            "fallback_reason": fallback_reason,
            "fallback_detail": fallback_detail,
            "ingestion_queries": [query for query, _ in active_queries],
            "pipeline_version": PIPELINE_VERSION,
            "prompt_version_daily": DAILY_PROMPT_VERSION,
            "prompt_version_context": TODAY_CONTEXT_PROMPT_VERSION,
        },
    }

    if validation_output_dir:
        artifact_dir = save_validation_artifacts(
            base_dir=Path(validation_output_dir),
            asof_date=data_date,
            payload=out_payload,
            raw_pool=raw_news,
            deduped_pool=cleaned_news,
            clusters=clusters,
            selected_themes=internal_json.get("top_themes") if isinstance(internal_json.get("top_themes"), list) else [],
            daily_briefing=cleaned_daily,
            today_context=cleaned_context,
            quality_gate_result=quality_report,
        )
        out_payload.setdefault("_meta", {})["validation_artifacts_dir"] = str(artifact_dir)

    if write_main_cache:
        write_output(out_payload)
        _log(f"saved -> {OUT_PATH}")
    _log(f"provider={provider} model={model}")
    _log(f"news_pool={len(cleaned_news)} clusters={len(clusters)} top_clusters={len(top_clusters)}")
    _log(
        "quality: "
        f"themes={quality_report.get('daily_theme_count')} "
        f"narrative_sentences={quality_report.get('daily_narrative_sentence_count')} "
        f"context_sentences={quality_report.get('today_context_sentence_count')}"
    )
    return out_payload


def main() -> None:
    run_pipeline(asof_date=None, write_main_cache=True, validation_output_dir=None, allow_previous_cache_reuse=True)


if __name__ == "__main__":
    main()





