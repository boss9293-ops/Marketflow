"""
build_ticker_brief.py  ?? Terminal X ?ㅽ????곗빱 EOD 釉뚮━???앹꽦湲?

?ㅽ뻾 ?쒖젏: 4:30 PM ET (?λ쭏媛?30遺???
?댁뒪 ?뚯뒪: 湲곗〈 CompositeNewsProvider (Yahoo Finance + Finnhub + Alpha Vantage + Google News RSS + Reuters RSS)
異쒕젰:      output/cache/ticker_briefs/{SYMBOL}/{DATE}.json  (理쒓렐 4??蹂닿?)
API:       GET /api/ticker-brief?symbol=NVDA  ?? 理쒓렐 4??釉뚮━??諛곗뿴
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

# ?? 寃쎈줈 遺?몄뒪?몃옪 ????????????????????????????????????????????????????????
SCRIPT_DIR  = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# 湲곗〈 news providers ?ъ궗??
try:
    from news.providers import CompositeNewsProvider, Article
except ImportError:
    from backend.news.providers import CompositeNewsProvider, Article

BRIEFS_DIR = BACKEND_DIR / "output" / "cache" / "ticker_briefs"
BRIEFS_DIR.mkdir(parents=True, exist_ok=True)
ROOT = str(BACKEND_DIR.parent.parent)  # us_market_complete root

ET_ZONE     = ZoneInfo("America/New_York")
KEEP_DAYS   = 90
DIRECTNESS_THRESHOLD = 4

ANTHROPIC_URL  = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL   = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001").strip()
ANTHROPIC_KEY  = os.getenv("ANTHROPIC_API_KEY", "").strip()

DEFAULT_WATCHLIST = [
    "NVDA", "GOOGL", "AMZN", "INTC", "CAT",
    "XOM",  "AAPL",  "TSLA", "QQQ",  "SPY",
]

# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 1. ?댁뒪 ?섏쭛 ??湲곗〈 CompositeNewsProvider
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

def fetch_news(symbol: str, date_et: str) -> list[dict]:
    """
    湲곗〈 ?뚯씠?꾨씪???쒖슜.
    ?뱀씪 ?꾩껜 ?댁뒪 ?섏쭛 (prev 16:00 ~ today 16:30 ET).
    """
    day_start    = datetime.strptime(date_et, "%Y-%m-%d").replace(tzinfo=ET_ZONE)
    window_start = (day_start - timedelta(hours=24)).timestamp()
    window_end   = (day_start + timedelta(hours=16, minutes=30)).timestamp()
    day_start_str = (day_start - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")
    day_end_str   = (day_start + timedelta(hours=16, minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")

    provider = CompositeNewsProvider()
    try:
        articles: list[Article] = provider.fetch_top_news(
            region="us",
            tickers=[symbol],
            topics=[symbol],
            date_from=day_start_str,
            date_to=day_end_str,
            limit=30,
        )
    except Exception as e:
        print(f"  [WARN] CompositeNewsProvider failed: {e}")
        articles = []

    def _parse_pub(pub_str: str):
        """ISO string ??datetime with UTC tz"""
        try:
            dt = datetime.fromisoformat(pub_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

    items = []
    for a in articles:
        dt = _parse_pub(a.published_at) if a.published_at else None
        pub_ts = dt.timestamp() if dt else 0
        # ?좎쭨 ?꾪꽣 ???놁쑝硫??섏슜 (?뱀씪 寃껋쑝濡?媛꾩＜)
        if pub_ts and not (window_start <= pub_ts <= window_end):
            continue
        if dt is None:
            dt = day_start
        items.append({
            "id":          a.url or str(pub_ts),
            "headline":    a.title or "",
            "summary":     a.summary or "",
            "source":      a.publisher or "",
            "url":         a.url or "",
            "publishedAt": dt.isoformat(),
            "timeET":      dt.astimezone(ET_ZONE).strftime("%H:%M"),
        })

    print(f"  [{symbol}] {len(items)} news items fetched")
    return items


# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 2. 媛寃??섏쭛 (yfinance ???대? ?꾨줈?앺듃?먯꽌 ?ъ슜 以?
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

def fetch_price(symbol: str) -> dict:
    """Get last trading day's OHLC from local DB."""
    try:
        import sqlite3 as _sq
        db_path = os.path.join(ROOT, "marketflow", "data", "marketflow.db")
        con = _sq.connect(db_path)
        rows = con.execute(
            "SELECT date, open, close FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT 2",
            (symbol,)
        ).fetchall()
        con.close()
        if not rows:
            return {}
        date_str, open_px, close = rows[0]
        prev_close = rows[1][2] if len(rows) >= 2 else close
        return {
            "symbol":   symbol,
            "date":     date_str,
            "close":    round(close, 2),
            "open":     round(open_px, 2),
            "change1d": round((close - prev_close) / prev_close * 100, 2),
            "openChg":  round((open_px - prev_close) / prev_close * 100, 2),
        }
    except Exception as e:
        print(f"  [WARN] price fetch failed: {e}")
        return {}


# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 3. Event Extractor (湲곗〈 TS 濡쒖쭅 Python ?ы똿)
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

import re

CONCRETE_RE = re.compile(
    r'\$[\d,]+(\.\d+)?'
    r'|[\d,]+(\.\d+)?\s*(%|bp|bps|billion|million|trillion)'
    r'|\b(up|down|fell?|rose?|drop|surge|gain)\s+[\d]',
    re.I
)
ACTION_VERBS = [
    "closed up","closed down","trading up","trading down",
    "surged","plunged","rallied","dropped","fell","rose","gained",
    "retracing","rebounding","cuts","cut","raises","raised","hikes","hiked",
    "beats","beat","misses","missed","warns","warned",
    "announces","announced","approves","approved","rejects","rejected",
    "acquires","acquired","launches","launched",
    "upgrades","upgraded","downgrades","downgraded",
    "reports","reported","lowers","lowered",
    "opened","triggers","triggered","climbed","jumped","sank","slid",
    "retreated","hit","tested","breached",
]
NON_TICKERS = {
    "A","AT","BE","FOR","IN","ON","IS","TO","THE","AND","OR","OF","BY","IT",
    "IF","US","UK","EU","UN","AS","UP","AN","DO","GO","AI","CEO","CFO","COO",
    "CTO","IPO","GDP","CPI","PPI","PCE","FED","SEC","DOJ","FDA","ETF","VIX",
    "DOW","QE","QT","RRP","IMF","PC","ET","AM","PM","WTI","EPS","PT","AWS","GPU",
    "Q1","Q2","Q3","Q4","PR","CRM","TPU",
}
VAGUE_RE   = re.compile(r'\b(could|might|possibly|expected to|likely|reportedly|sources say|according to analysts)\b|\bmay\b(?![-\d])', re.I)
OPINION_RE = re.compile(r'\b(analysts? say|according to|sources familiar|reportedly|rumored?)\b', re.I)
REUTERS_RE = re.compile(r'reuters|associated press|\bap\b', re.I)
TICKER_RE  = re.compile(r'\b([A-Z]{2,5})\b')

CLUSTER_RULES = [
    ("fed",         ["fed","powell","fomc","rate hike","rate cut","federal reserve","monetary policy"]),
    ("macro",       ["cpi","ppi","gdp","inflation","unemployment","yield","treasury","recession","tariff","trade","blockade","hormuz","iran"]),
    ("earnings",    ["earnings","revenue","eps","guidance","quarter","q1","q2","q3","q4","beat","miss","forecast"]),
    ("geopolitical",["war","sanction","china","russia","ukraine","taiwan","conflict","ceasefire","naval","blockade"]),
    ("sector",      ["oil","energy","semiconductor","chip","bank","financial","pharma","biotech","construction"]),
    ("analyst",     ["price target","pt","upgrade","downgrade","ubs","citi","morgan stanley","goldman","barclays","stifel","northland","mizuho"]),
]
BULLISH = ["beats","beat","surges","surged","rises","rose","gains","gained","record","high",
           "upgrade","upgraded","growth","profit","revenue","recovery","rally","closed up","trading up","rebounding"]
BEARISH = ["misses","missed","falls","fell","drops","dropped","plunges","plunged","collapses",
           "warns","warned","lower","loss","downgrade","downgraded","tariff","closed down",
           "trading down","blockade","retreated","veto","sanctions"]

def _cluster(text: str) -> str:
    lo = text.lower()
    best, bh = "general", 0
    for c, words in CLUSTER_RULES:
        h = sum(1 for w in words if w in lo)
        if h > bh: best, bh = c, h
    return best

def _sentiment(text: str) -> str:
    lo = text.lower()
    b = sum(1 for w in BULLISH if w in lo)
    r = sum(1 for w in BEARISH if w in lo)
    return "bullish" if b > r else "bearish" if r > b else "neutral"

def _subject(h: str) -> str:
    m = re.match(r'^([A-Z]{2,5})\b', h)
    if m and m.group(1) not in NON_TICKERS: return m.group(1)
    m2 = re.search(r'\b(Fed|Federal Reserve|FOMC|Powell|Treasury|Bank of America|BofA|Morgan Stanley|Goldman|UBS|Citi|Northland|Stifel|Mizuho)\b', h, re.I)
    if m2: return m2.group(1)
    m3 = re.match(r'^([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\s+', h)
    return m3.group(1) if m3 else ""

def _verb(h: str) -> str:
    lo = h.lower()
    return next((v for v in ACTION_VERBS if v in lo), "")

def _magnitude(text: str) -> str:
    m = re.search(r'\$[\d,.]+(?:B|M|T|billion|million|trillion)?|\d+\.?\d*%|\d+\.?\d*\s*(?:billion|million|trillion)', text, re.I)
    return m.group(0).strip() if m else ""

def _assets(h: str, s: str) -> list[str]:
    text = h + " " + s
    seen, out = set(), []
    for t in TICKER_RE.findall(text):
        if t not in NON_TICKERS and t not in seen:
            seen.add(t); out.append(t)
    return out[:5]

def _hours_ago(pub: str) -> float:
    try:
        dt = datetime.fromisoformat(pub)
        return max(0, (datetime.now(tz=timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600)
    except Exception:
        return 999

def _score(headline: str, summary: str, source: str, published_at: str, target: str = "") -> int:
    text = headline + " " + summary
    s = 0
    if CONCRETE_RE.search(text):                                s += 3
    if _verb(headline):                                         s += 2
    # ticker-in-headline: bigger bonus if it's the target ticker
    h_tickers = [t for t in TICKER_RE.findall(headline) if t not in NON_TICKERS]
    if target and target in h_tickers:                          s += 3
    elif h_tickers:                                             s += 1
    hrs = _hours_ago(published_at)
    if hrs < 4:    s += 1
    elif hrs > 48: s -= 1
    if REUTERS_RE.search(source):   s += 1
    if VAGUE_RE.search(text):       s -= 2
    if OPINION_RE.search(text):     s -= 1
    return max(0, min(10, s))

def extract_events(items: list[dict], threshold: int = DIRECTNESS_THRESHOLD, target: str = "") -> list[dict]:
    evts = []
    for item in items:
        text = item["headline"] + " " + item.get("summary", "")
        d = _score(item["headline"], item.get("summary",""), item.get("source",""), item.get("publishedAt",""), target)
        evts.append({
            "id":         item["id"],
            "headline":   item["headline"],
            "source":     item.get("source",""),
            "publishedAt":item.get("publishedAt",""),
            "timeET":     item.get("timeET",""),
            "subject":    _subject(item["headline"]),
            "actionVerb": _verb(item["headline"]),
            "magnitude":  _magnitude(text),
            "directness": d,
            "cluster":    _cluster(text),
            "sentiment":  _sentiment(text),
            "assets":     _assets(item["headline"], item.get("summary","")),
        })
    evts = [e for e in evts if e["directness"] >= threshold]
    evts.sort(key=lambda e: -e["directness"])
    return evts


# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 4. Terminal X ?꾨＼?꾪듃
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

def build_prompt(symbol: str, price: dict, events: list[dict], date_et: str) -> str:
    close    = price.get("close", 0)
    open_px  = price.get("open", 0)
    chg      = price.get("change1d", 0)
    open_chg = price.get("openChg", 0)
    direction = "up" if chg >= 0 else "down"

    bull_w = sum(e["directness"] for e in events if e["sentiment"] == "bullish")
    bear_w = sum(e["directness"] for e in events if e["sentiment"] == "bearish")

    event_lines = "\n".join(
        f"[{i+1}] d={e['directness']} {e['cluster']} {e['sentiment']}\n    {e['headline']}"
        for i, e in enumerate(events[:8])
    )

    return f"""You are a Bloomberg terminal analyst. Write a Terminal X style end-of-day brief.

STRUCTURE (strict):
1. "{symbol} closed {direction} {{X}}% at ${{Y}}, {{one clause connecting to primary driver}}"
2. Primary driver sentence ??ONE catalyst, specific actor + number
3-4. Supporting catalysts stacked (names + numbers, no vague language)
5. Headwind sentence ??always acknowledge counterforce ("These catalysts offset..." or "Sentiment was tempered by...")

RULES:
- Every claim needs a number or a named entity
- No adjectives without data (not "strong" ??say "+4.52%")
- One flowing paragraph, 4-6 sentences
- Bloomberg tone: dry, precise, zero fluff

PRICE ({date_et}):
  Open: ${open_px} ({'+' if open_chg>=0 else ''}{open_chg}%)  Close: ${close} ({'+' if chg>=0 else ''}{chg}%)

NEWS EVENTS (directness-ranked):
{event_lines}

Write the brief now:"""


# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 5. Claude ?몄텧 + ?대갚
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

def call_claude(prompt: str) -> str:
    if not ANTHROPIC_KEY:
        return ""
    try:
        r = requests.post(
            ANTHROPIC_URL,
            headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": CLAUDE_MODEL, "max_tokens": 400, "messages": [{"role": "user", "content": prompt}]},
            timeout=(10, 20),
        )
        r.raise_for_status()
        return r.json()["content"][0]["text"].strip()
    except Exception as e:
        print(f"  [WARN] Claude API: {e}")
        return ""

def fallback_brief(symbol: str, price: dict, events: list[dict]) -> str:
    """LLM ?놁쓣 ??猷?湲곕컲"""
    close = price.get("close", 0)
    chg   = price.get("change1d", 0)
    dir_  = "up" if chg >= 0 else "down"
    s1    = f"{symbol} closed {dir_} {abs(chg):.2f}% at ${close}"
    if not events:
        return s1 + "."
    lead  = events[0]
    bulls = [e["headline"][:70] for e in events[1:] if e["sentiment"] == "bullish"][:2]
    bears = [e["headline"][:70] for e in events   if e["sentiment"] == "bearish"][:1]
    parts = [s1 + ",", lead["headline"] + "."]
    if bulls:
        parts.append("Price action further supported by " + "; ".join(bulls) + ".")
    if bears:
        parts.append("These catalysts offset " + bears[0] + ".")
    return " ".join(parts)


# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 6. ???+ 4??罹먯떆 愿由?
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

def save_brief(symbol: str, date_et: str, payload: dict) -> Path:
    sym_dir = BRIEFS_DIR / symbol
    sym_dir.mkdir(exist_ok=True)
    out = sym_dir / f"{date_et}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    # 理쒓렐 4?쇱튂留??좎?
    for old in sorted(sym_dir.glob("*.json"), reverse=True)[KEEP_DAYS:]:
        old.unlink()
        print(f"  [CACHE] pruned {old.name}")
    return out

def load_briefs(symbol: str) -> list[dict]:
    """理쒓렐 4?쇱튂 濡쒕뱶 (理쒖떊??"""
    sym_dir = BRIEFS_DIR / symbol
    if not sym_dir.exists():
        return []
    result = []
    for f in sorted(sym_dir.glob("*.json"), reverse=True)[:KEEP_DAYS]:
        try:
            result.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return result


# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 7. ?곗빱蹂??ㅽ뻾
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

def run_ticker(symbol: str, date_et: str) -> dict:
    print("\n" + "=" * 52)
    print(f"  {symbol}  {date_et}  {'(LLM)' if ANTHROPIC_KEY else '(fallback)'}")
    print("=" * 52)

    news   = fetch_news(symbol, date_et)
    price  = fetch_price(symbol)
    events = extract_events(news, target=symbol)

    print(f"  events: {len(events)}/{len(news)} passed (threshold={DIRECTNESS_THRESHOLD})")
    for e in events[:5]:
        score = int(e.get("directness", 0))
        score = max(0, min(10, score))
        bar = "#" * score + "." * (10 - score)
        sent = {"bullish": "+", "bearish": "-", "neutral": "="}.get(e.get("sentiment"), "")
        headline = str(e.get("headline") or "")[:52]
        print(f"    {bar} {score}/10 {sent} {headline}")

    prompt     = build_prompt(symbol, price, events, date_et)
    brief_text = call_claude(prompt) or fallback_brief(symbol, price, events)

    print(f"\n  BRIEF:\n  {brief_text[:280]}...")

    bull_w = sum(e["directness"] for e in events if e["sentiment"] == "bullish")
    bear_w = sum(e["directness"] for e in events if e["sentiment"] == "bearish")
    sentiment  = "bullish" if bull_w > bear_w else "bearish" if bear_w > bull_w else "neutral"
    sig_str    = round(sum(e["directness"] for e in events[:5]) / max(1, min(5, len(events))))

    payload = {
        "symbol":          symbol,
        "date":            date_et,
        "generated_at":    datetime.now(tz=ET_ZONE).isoformat(),
        "brief":           brief_text,
        "sentiment":       sentiment,
        "signal_strength": sig_str,
        "price":           price,
        "events":          events[:8],
    }

    out = save_brief(symbol, date_et, payload)
    print(f"  ??saved: {out.name}")
    return payload


# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??
# 8. ?뷀듃由ы룷?명듃
# ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??

def main() -> None:
    now_et  = datetime.now(tz=ET_ZONE)
    date_et = now_et.strftime("%Y-%m-%d")
    symbols = [s.upper() for s in sys.argv[1:]] if len(sys.argv) > 1 else DEFAULT_WATCHLIST

    sep = '=' * 52
    print(sep)
    print(f"  Ticker Brief Builder  {date_et} ET")
    print(f"  Symbols : {', '.join(symbols)}")
    print(f"  LLM     : {'Claude ' + CLAUDE_MODEL if ANTHROPIC_KEY else 'rule-based fallback'}")
    print(f"  Cache   : {BRIEFS_DIR}")
    print(sep)

    ok = 0
    for sym in symbols:
        try:
            run_ticker(sym, date_et)
            ok += 1
        except Exception as e:
            print(f"  [ERROR] {sym}: {e}")
        time.sleep(1.5)

    print(f"\n  Done: {ok}/{len(symbols)} OK")


if __name__ == "__main__":
    main()

