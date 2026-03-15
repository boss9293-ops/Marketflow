from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from .providers import Article, YahooNewsProvider, PremiumNewsProvider


KEYWORDS = [
    "fed", "powell", "rate", "yield", "treasury", "cpi", "ppi", "jobs", "payroll",
    "liquidity", "qt", "qe", "balance sheet", "rrp", "repo", "credit spread",
    "vix", "volatility", "bitcoin", "btc", "gold", "real yield", "tips", "m2",
]
PUBLISHER_BONUS = {"Reuters": 1.2, "Bloomberg": 1.2, "WSJ": 1.0, "Financial Times": 1.0, "CNBC": 0.8}
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


def _article_score(article: Article, now_utc: datetime) -> float:
    text = f"{article.title} {article.summary}".lower()
    keyword_hits = sum(1 for k in KEYWORDS if k in text)
    try:
        pub_dt = datetime.fromisoformat(article.published_at.replace("Z", "+00:00"))
    except Exception:
        pub_dt = now_utc - timedelta(days=2)
    age_hours = (now_utc - pub_dt).total_seconds() / 3600.0
    recency = 3.0 if age_hours <= 6 else (2.0 if age_hours <= 24 else (1.0 if age_hours <= 48 else 0.0))
    pub_weight = 0.0
    for name, w in PUBLISHER_BONUS.items():
        if name.lower() in (article.publisher or "").lower():
            pub_weight = max(pub_weight, w)
    return keyword_hits * 2.0 + recency + pub_weight


def _pick_provider() -> Tuple[str, Any]:
    mode = os.environ.get("NEWS_PROVIDER", "yahoo").strip().lower() or "yahoo"
    if mode == "premium":
        vendor = os.environ.get("PREMIUM_VENDOR", "polygon").strip().lower() or "polygon"
        return mode, PremiumNewsProvider(vendor=vendor)
    return "yahoo", YahooNewsProvider()


def _load_last_good(region: str) -> Optional[Dict[str, Any]]:
    p = os.path.join(_repo_root(), "backend", "output", "news_cache", f"last_good_{region}.json")
    return _safe_read_json(p)


def _save_last_good(region: str, payload: Dict[str, Any]) -> None:
    p = os.path.join(_repo_root(), "backend", "output", "news_cache", f"last_good_{region}.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


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


def build_context_news_cache(region: str = "us", limit: int = 6) -> Dict[str, Any]:
    region = (region or "us").lower()
    limit = max(1, min(12, int(limit or 6)))
    now_utc = datetime.now(timezone.utc)
    today = now_utc.strftime("%Y-%m-%d")
    mode, provider = _pick_provider()

    sensors = _sensor_snapshot()
    selected: List[Article] = []
    raw_articles: List[Article] = []
    status = "SensorOnly"
    error = None

    try:
        raw_articles = provider.fetch_top_news(
            region=region,
            tickers=["SPY", "QQQ", "IWM", "DIA", "^VIX", "TLT", "HYG", "BTC-USD", "GLD"],
            topics=["macro", "rates", "liquidity", "volatility"],
            date_from=today,
            date_to=today,
            limit=max(10, limit),
        )
        for a in raw_articles:
            a.score = _article_score(a, now_utc)
        raw_articles.sort(key=lambda x: x.score, reverse=True)
        selected = raw_articles[:limit]
        status = "Fresh" if len(selected) >= 4 else ("Partial" if len(selected) > 0 else "SensorOnly")
    except Exception as e:
        error = str(e)

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
    os.makedirs(_output_cache_dir(), exist_ok=True)
    with open(os.path.join(_output_cache_dir(), "context_news.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return payload
