"""
TradingView access smoke test for indices and US top gainers.

This is a first-pass reachability / parseability check only.
It does not use Selenium, Playwright, LLMs, or third-party market APIs.
"""
from __future__ import annotations

import json
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup


INDICES_URL = "https://www.tradingview.com/markets/indices/"
GAINERS_URL = "https://www.tradingview.com/markets/stocks-usa/market-movers-gainers/"

DEFAULT_TIMEOUT_SEC = 20

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

INDICES_KEYWORDS = [
    "S&P 500",
    "Nasdaq 100",
    "Dow 30",
    "Nasdaq Composite",
    "NYSE Composite",
]

GAINERS_KEYWORDS = [
    "Top gainers",
    "Most active",
    "Unusual volume",
    "52-week high",
    "Symbol",
    "Change %",
    "Price",
    "Volume",
]

BLOCK_PHRASES = [
    "access denied",
    "cloudflare",
    "just a moment",
    "verify you are human",
    "security check",
    "attention required",
    "cf-chl",
    "ddos protection",
]

SYMBOL_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,8}(?:\.[A-Z0-9]{1,3})?\b")
SYMBOL_STOPWORDS = {
    "HTML",
    "HTTP",
    "HTTPS",
    "JSON",
    "CSS",
    "SVG",
    "PNG",
    "GIF",
    "GIFS",
    "TABLE",
    "TOP",
    "MOST",
    "ACTIVE",
    "GAINERS",
    "GAINER",
    "VOLUME",
    "PRICE",
    "CHANGE",
    "SYMBOL",
    "MARKET",
    "MOVERS",
    "TRADINGVIEW",
    "NASDAQ",
    "NYSE",
    "DOW",
    "USA",
    "US",
    "HIGH",
    "LOW",
    "WEEK",
    "HIGHS",
    "LOWS",
    "INDEX",
    "INDICES",
    "CAPTION",
    "VIEW",
    "DATA",
    "LIVE",
    "SCREEN",
    "EN",
    "EPS",
    "TTM",
    "USD",
    "FY",
    "Q1",
    "Q2",
    "Q3",
    "Q4",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def output_dir() -> Path:
    return repo_root() / "backend" / "output" / "tradingview_test"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_title(soup: BeautifulSoup) -> str:
    if soup.title:
        title = normalize_whitespace(soup.title.get_text(" ", strip=True))
        if title:
            return title

    for selector in (
        ("meta", {"property": "og:title"}),
        ("meta", {"name": "title"}),
        ("meta", {"property": "twitter:title"}),
    ):
        tag = soup.find(selector[0], attrs=selector[1])
        if tag and tag.get("content"):
            title = normalize_whitespace(str(tag.get("content")))
            if title:
                return title

    return ""


def fetch_page(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = DEFAULT_TIMEOUT_SEC) -> Dict[str, object]:
    request_headers = dict(DEFAULT_HEADERS)
    if headers:
        request_headers.update(headers)

    try:
        response = requests.get(url, headers=request_headers, timeout=timeout)
        html = response.text or ""
        return {
            "ok": True,
            "url": url,
            "status_code": response.status_code,
            "response_length": len(html),
            "html": html,
            "response_headers": dict(response.headers),
            "elapsed_sec": round(response.elapsed.total_seconds(), 3),
            "error": None,
        }
    except requests.RequestException as exc:
        return {
            "ok": False,
            "url": url,
            "status_code": None,
            "response_length": 0,
            "html": "",
            "response_headers": {},
            "elapsed_sec": None,
            "error": f"{exc.__class__.__name__}: {exc}",
        }


def save_raw_html(path: Path, html: str) -> None:
    path.write_text(html or "", encoding="utf-8")


def keyword_presence(text: str, keywords: List[str]) -> Dict[str, bool]:
    results: Dict[str, bool] = {}
    for keyword in keywords:
        pattern = re.escape(keyword).replace(r"\ ", r"\s+")
        results[keyword] = bool(re.search(pattern, text, flags=re.IGNORECASE))
    return results


def find_sample_symbols(text: str, limit: int = 10) -> List[str]:
    found: List[str] = []
    seen = set()
    for match in SYMBOL_RE.finditer(text):
        token = match.group(0).strip(".")
        upper = token.upper()
        if upper in SYMBOL_STOPWORDS:
            continue
        if len(upper) < 2:
            continue
        if upper.isdigit():
            continue
        if upper in seen:
            continue
        found.append(upper)
        seen.add(upper)
        if len(found) >= limit:
            break
    return found


def detect_blocking(status_code: Optional[int], html: str, keyword_hits: Dict[str, bool]) -> Tuple[bool, List[str]]:
    signals: List[str] = []
    body = normalize_whitespace(html).casefold()
    hit_count = sum(1 for value in keyword_hits.values() if value)

    if status_code in {403, 429, 503}:
        signals.append(f"status_code_{status_code}")

    if ("captcha" in body or "recaptcha" in body) and hit_count == 0:
        signals.append("captcha_no_core_keywords")

    for phrase in BLOCK_PHRASES:
        if phrase in body:
            signals.append(phrase)

    if "cloudflare" in body and hit_count == 0:
        signals.append("cloudflare_no_core_keywords")

    if len(html) < 1500 and hit_count == 0:
        signals.append("short_body_no_core_keywords")

    # If the page is huge but still missing all target keywords, that also looks suspicious.
    if len(html) < 5000 and "tradingview" in body and hit_count == 0:
        signals.append("tradingview_shell_only")

    deduped: List[str] = []
    for signal in signals:
        if signal not in deduped:
            deduped.append(signal)

    return bool(deduped), deduped


def build_page_result(
    *,
    url: str,
    label: str,
    html_path: Path,
    keywords: List[str],
    collect_symbols: bool = False,
) -> Dict[str, object]:
    fetch_result = fetch_page(url)
    html = str(fetch_result.get("html") or "")
    status_code = fetch_result.get("status_code")
    response_length = int(fetch_result.get("response_length") or 0)
    error = fetch_result.get("error")

    save_raw_html(html_path, html)

    soup = BeautifulSoup(html, "html.parser")
    title_text = extract_title(soup)
    page_text = normalize_whitespace(soup.get_text(" ", strip=True))
    keyword_hits = keyword_presence(page_text, keywords)
    blocked, blocking_signals = detect_blocking(status_code if isinstance(status_code, int) else None, html, keyword_hits)

    result: Dict[str, object] = {
        "url": url,
        "label": label,
        "status_code": status_code,
        "response_length": response_length,
        "blocked": blocked,
        "blocking_signals": blocking_signals,
        "title_text": title_text,
        "title_found": bool(title_text),
        "keywords_found": keyword_hits,
        "error": error,
    }

    if collect_symbols:
        result["sample_symbols_found"] = find_sample_symbols(page_text, limit=10)

    return result


def count_true(values: Dict[str, bool]) -> int:
    return sum(1 for value in values.values() if value)


def build_assessment(indices_result: Dict[str, object], gainers_result: Dict[str, object]) -> str:
    indices_status = indices_result.get("status_code")
    gainers_status = gainers_result.get("status_code")
    indices_blocked = bool(indices_result.get("blocked"))
    gainers_blocked = bool(gainers_result.get("blocked"))

    indices_keywords = indices_result.get("keywords_found", {})
    gainers_keywords = gainers_result.get("keywords_found", {})
    indices_keyword_count = count_true(indices_keywords) if isinstance(indices_keywords, dict) else 0
    gainers_keyword_count = count_true(gainers_keywords) if isinstance(gainers_keywords, dict) else 0
    gainers_symbols = gainers_result.get("sample_symbols_found", [])
    gainers_symbol_count = len(gainers_symbols) if isinstance(gainers_symbols, list) else 0

    if indices_blocked and gainers_blocked:
        return "FAIL"

    indices_pass = (
        indices_status == 200
        and not indices_blocked
        and bool(indices_result.get("title_found"))
        and indices_keyword_count >= 4
    )
    gainers_pass = (
        gainers_status == 200
        and not gainers_blocked
        and bool(gainers_result.get("title_found"))
        and gainers_keyword_count >= 5
        and gainers_symbol_count >= 1
    )

    if indices_pass and gainers_pass:
        return "PASS"

    if indices_status == 200 or gainers_status == 200 or indices_keyword_count > 0 or gainers_keyword_count > 0:
        return "PARTIAL"

    return "FAIL"


def print_report(report: Dict[str, object], script_path: Path, saved_files: Dict[str, Path]) -> None:
    indices_test = report["indices_test"]
    gainers_test = report["gainers_test"]

    indices_keywords = indices_test.get("keywords_found", {})
    gainers_keywords = gainers_test.get("keywords_found", {})
    indices_found = [k for k, v in indices_keywords.items() if v] if isinstance(indices_keywords, dict) else []
    gainers_found = [k for k, v in gainers_keywords.items() if v] if isinstance(gainers_keywords, dict) else []
    gainers_symbols = gainers_test.get("sample_symbols_found", [])

    print("=== TradingView Access Test ===")
    print("Input")
    print(f"  indices url: {report['input']['indices_url']}")
    print(f"  gainers url: {report['input']['gainers_url']}")
    print("Output")
    print(f"  indices status_code: {indices_test.get('status_code')}")
    print(f"  indices blocked: {indices_test.get('blocked')}")
    print(f"  gainers status_code: {gainers_test.get('status_code')}")
    print(f"  gainers blocked: {gainers_test.get('blocked')}")
    print(f"  sample keywords found (indices): {', '.join(indices_found) if indices_found else '--'}")
    print(f"  sample keywords found (gainers): {', '.join(gainers_found) if gainers_found else '--'}")
    print(f"  sample symbols found: {', '.join(gainers_symbols) if isinstance(gainers_symbols, list) and gainers_symbols else '--'}")
    print("File")
    print(f"  Script: {script_path}")
    print(f"  Saved: {saved_files['indices_html']}")
    print(f"  Saved: {saved_files['gainers_html']}")
    print(f"  Saved: {saved_files['json']}")
    print("Assessment")
    print(f"  {report['overall_assessment']}")


def run_test_suite() -> Dict[str, object]:
    out_dir = output_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    indices_html_path = out_dir / "indices_raw.html"
    gainers_html_path = out_dir / "gainers_raw.html"
    json_path = out_dir / "tradingview_access_test.json"

    indices_result = build_page_result(
        url=INDICES_URL,
        label="indices",
        html_path=indices_html_path,
        keywords=INDICES_KEYWORDS,
        collect_symbols=False,
    )
    gainers_result = build_page_result(
        url=GAINERS_URL,
        label="gainers",
        html_path=gainers_html_path,
        keywords=GAINERS_KEYWORDS,
        collect_symbols=True,
    )

    report: Dict[str, object] = {
        "timestamp": now_iso(),
        "input": {
            "indices_url": INDICES_URL,
            "gainers_url": GAINERS_URL,
        },
        "indices_test": indices_result,
        "gainers_test": gainers_result,
        "overall_assessment": build_assessment(indices_result, gainers_result),
        "files": {
            "indices_raw_html": str(indices_html_path),
            "gainers_raw_html": str(gainers_html_path),
            "json": str(json_path),
        },
    }

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    return report


def main() -> int:
    script_path = Path(__file__).resolve()
    try:
        report = run_test_suite()
        saved_files = {
            "indices_html": Path(report["files"]["indices_raw_html"]),
            "gainers_html": Path(report["files"]["gainers_raw_html"]),
            "json": Path(report["files"]["json"]),
        }
        print_report(report, script_path, saved_files)
        return 0
    except Exception as exc:  # pragma: no cover - defensive top-level guard
        print(f"[ERROR] TradingView access test failed: {exc}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
