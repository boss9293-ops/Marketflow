from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, TypedDict
from zoneinfo import ZoneInfo

import requests
from pydantic import BaseModel, Field, ValidationError, field_validator


ET_ZONE = ZoneInfo("America/New_York")

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

SOURCE_WEIGHTS = {
    "bloomberg": 1.6,
    "cnbc": 1.5,
    "sec": 1.5,
    "reuters": 1.4,
    "wsj": 1.4,
    "marketwatch": 1.2,
    "yahoo": 1.0,
    "unknown": 0.9,
}
FIXED_DAILY_SECTIONS = [
    "주요 지수 실적",
    "섹터별 수익률",
    "원자재 및 채권 시장",
    "주요 종목 및 이슈",
    "경제지표 및 연준",
    "시장 포지셔닝",
]


class Theme(BaseModel):
    title: str = Field(..., description="Large market-moving theme title")
    subtitles: List[str] = Field(..., min_length=2, max_length=4, description="2-4 concrete sub-points")

    @field_validator("title")
    @classmethod
    def _title_required(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("title is required")
        return text

    @field_validator("subtitles")
    @classmethod
    def _subtitles_normalize(cls, value: List[str]) -> List[str]:
        cleaned = [v.strip() for v in value if isinstance(v, str) and v.strip()]
        if len(cleaned) < 2:
            raise ValueError("subtitles must contain at least 2 items")
        return cleaned[:4]


class Stance(BaseModel):
    stance: str = Field(..., description="Defensive / Neutral / Offensive")
    action: str = Field(..., description="Reduce / Maintain / Increase")
    exposure: str = Field(..., description="Exposure band like 20-40%")


class SourceEntry(BaseModel):
    document: str
    date: str
    source: str
    snippet: str = Field(..., description="Source evidence snippet")


class DeepResearchOutput(BaseModel):
    summary_stack: str = Field(..., description="One-line summary")
    ai_brief: List[Theme] = Field(..., min_length=6, max_length=6, description="6 fixed major themes")
    stance: Stance
    agent_thinking: List[str] = Field(default_factory=list, description="Search process logs")
    sources: List[SourceEntry] = Field(default_factory=list, description="Source table")
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class AgentState(TypedDict):
    query: str
    asof_day: str
    raw_searches: Dict[str, Any]
    ranked_sources: List[Dict[str, Any]]
    final_output: Optional[DeepResearchOutput]


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return default


def _sanitize_error(message: Any) -> str:
    text = _text(message, str(message))
    text = re.sub(r"([?&]key=)[^&\s]+", r"\1***", text, flags=re.IGNORECASE)
    for env_name in ("OPENAI_API_KEY", "GPT_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "TAVILY_API_KEY"):
        secret = os.getenv(env_name, "").strip()
        if secret:
            text = text.replace(secret, "***")
    return text


def _normalize_source_name(url_or_source: str) -> str:
    text = (url_or_source or "").lower().strip()
    for token in SOURCE_WEIGHTS.keys():
        if token in text:
            return token
    return "unknown"


def _extract_pct(text: str) -> Optional[float]:
    m = re.search(r"([+-]?\d+(?:\.\d+)?)%", text or "")
    if not m:
        return None
    try:
        return float(m.group(1))
    except Exception:
        return None


def _parse_date(text: str) -> Optional[datetime]:
    raw = (text or "").strip()
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


def _recency_factor(date_text: str, asof_day: str) -> float:
    asof_dt = _parse_date(asof_day) or datetime.now(ET_ZONE)
    event_dt = _parse_date(date_text)
    if event_dt is None:
        return 0.95
    diff_days = max(0, int((asof_dt.date() - event_dt.date()).days))
    return max(0.35, 1.0 - (0.12 * diff_days))


def _rank_sources(records: List[Dict[str, Any]], asof_day: str) -> List[Dict[str, Any]]:
    ranked: Dict[str, Dict[str, Any]] = {}
    for row in records:
        snippet = _text(row.get("snippet"))
        if not snippet:
            continue
        source_name = _normalize_source_name(_text(row.get("source")) + " " + _text(row.get("document")))
        source_weight = SOURCE_WEIGHTS.get(source_name, SOURCE_WEIGHTS["unknown"])
        price_change = _extract_pct(snippet)
        abs_move = abs(price_change) if price_change is not None else 1.0
        recency = _recency_factor(_text(row.get("date")), asof_day)
        impact_score = round(abs_move * source_weight * recency, 4)
        key = re.sub(r"\s+", " ", snippet.lower())[:180]
        current = dict(row)
        current["source"] = source_name
        current["source_weight"] = source_weight
        current["recency_factor"] = recency
        current["impact_score"] = impact_score
        prev = ranked.get(key)
        if prev is None or _safe_float(current.get("impact_score")) > _safe_float(prev.get("impact_score")):
            ranked[key] = current
    return sorted(ranked.values(), key=lambda r: _safe_float(r.get("impact_score")), reverse=True)


def _fetch_market_data(yf: Any) -> Dict[str, Dict[str, float]]:
    tickers = ["^GSPC", "^IXIC", "^DJI", "QQQ", "SPY", "^VIX"]
    out: Dict[str, Dict[str, float]] = {}
    for ticker in tickers:
        try:
            hist = yf.Ticker(ticker).history(period="5d")
            if hist is None or getattr(hist, "empty", True) or len(hist.index) < 2:
                continue
            latest = float(hist["Close"].iloc[-1])
            prev = float(hist["Close"].iloc[-2])
            change = ((latest / prev) - 1.0) * 100.0 if prev else 0.0
            out[ticker] = {"price": round(latest, 2), "change_pct": round(change, 2)}
        except Exception:
            continue
    return out


def _flatten_tavily(raw_searches: Dict[str, Any]) -> List[Dict[str, Any]]:
    flattened: List[Dict[str, Any]] = []
    for key, payload in raw_searches.items():
        if key in {"market_data", "agent_thinking"}:
            continue
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list):
            continue
        for item in results:
            if not isinstance(item, dict):
                continue
            snippet = _text(item.get("content")) or _text(item.get("snippet")) or _text(item.get("title"))
            if not snippet:
                continue
            flattened.append(
                {
                    "document": _text(item.get("url")) or _text(item.get("title")),
                    "date": _text(item.get("published_date")) or _text(item.get("date")),
                    "source": _text(item.get("source")) or _text(item.get("url")) or key,
                    "snippet": snippet,
                }
            )
    return flattened


def _build_search_queries(asof_day: str) -> Dict[str, str]:
    return {
        "market": f"US stock market summary today {asof_day} S&P500 Nasdaq Dow",
        "sector": f"sector rotation tech energy finance today {asof_day}",
        "risk": f"VIX market risk inflation Fed today {asof_day}",
        "watchlist": f"top stock movers TSLA NVDA AAPL today {asof_day}",
    }


def _select_llm_candidates() -> List[Tuple[str, str, str]]:
    forced = os.getenv("LANGGRAPH_LLM_PROVIDER", "auto").strip().lower()
    openai_key = os.getenv("GPT_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("GOOGLE_API_KEY", "").strip()
    openai_model = os.getenv("GPT_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash-latest").strip() or "gemini-1.5-flash-latest"
    if not gemini_model.startswith("models/"):
        gemini_model = f"models/{gemini_model}"

    if forced in {"openai", "gpt"}:
        if not openai_key:
            raise RuntimeError("Missing OPENAI/GPT API key for langgraph pipeline")
        return [("openai", openai_model, openai_key)]

    if forced == "gemini":
        if not gemini_key:
            raise RuntimeError("Missing GEMINI/GOOGLE API key for langgraph pipeline")
        return [("gemini", gemini_model, gemini_key)]

    candidates: List[Tuple[str, str, str]] = []
    if openai_key:
        candidates.append(("openai", openai_model, openai_key))
    if gemini_key:
        candidates.append(("gemini", gemini_model, gemini_key))
    if candidates:
        return candidates

    raise RuntimeError("Missing OpenAI/Gemini API key for langgraph pipeline")


def _build_synthesis_prompt() -> Tuple[str, str]:
    system = "\n".join(
        [
            "You are Terminal-X.ai Daily Briefing Agent for Korean investors.",
            "Use only provided search data and engine context.",
            "Do not hedge. Do not speculate. Keep concise, factual Korean.",
            "Output JSON object only (no markdown).",
        ]
    )
    user = "\n".join(
        [
            "아래 데이터를 바탕으로 오늘 미국 증시 핵심 테마를 작성해라.",
            "",
            "요구사항:",
            "- 아래 5개 타이틀을 고정 순서로 사용",
            "  1) 주요 지수 실적",
            "  2) 섹터별 수익률",
            "  3) 원자재 및 채권 시장",
            "  4) 주요 종목 및 이슈",
            "  5) 경제지표 및 연준",
            "  6) 시장 포지셔닝",
            "- 각 테마 subtitles 2~4개",
            "- stance는 Defensive/Neutral/Offensive 중 하나",
            "- action은 Reduce/Maintain/Increase 중 하나",
            "- sources는 실제 검색 결과만 사용",
            "",
            "출력 스키마(JSON):",
            "{",
            '  "summary_stack": "한 줄 요약",',
            '  "ai_brief": [',
            '    {"title":"주요 지수 실적","subtitles":["서브1","서브2"]},',
            '    {"title":"섹터별 수익률","subtitles":["서브1","서브2"]},',
            '    {"title":"원자재 및 채권 시장","subtitles":["서브1","서브2"]},',
            '    {"title":"주요 종목 및 이슈","subtitles":["서브1","서브2"]},',
            '    {"title":"경제지표 및 연준","subtitles":["서브1","서브2"]},',
            '    {"title":"시장 포지셔닝","subtitles":["서브1","서브2"]}',
            "  ],",
            '  "stance": {"stance":"Defensive","action":"Reduce","exposure":"20-40%"},',
            '  "agent_thinking": ["검색로그1","검색로그2"],',
            '  "sources": [{"document":"","date":"","source":"","snippet":""}]',
            "}",
            "",
            "search_results_json:",
            "__SEARCH_RESULTS__",
            "",
            "market_data_json:",
            "__MARKET_DATA__",
            "",
            "engine_context_json:",
            "__ENGINE_CONTEXT__",
        ]
    )
    return system, user


def _extract_json(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        parsed = json.loads(match.group(0))
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("LLM response did not contain valid JSON")


def _call_openai(system: str, user: str, model: str, api_key: str) -> str:
    timeout_sec = int(os.getenv("TIMEOUT_SEC", "30") or "30")
    try:
        response = requests.post(
            OPENAI_CHAT_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": 0.1,
                "max_tokens": 2500,
                "response_format": {"type": "json_object"},
            },
            timeout=timeout_sec,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        raise RuntimeError(_sanitize_error(exc)) from exc
    text = _text(((data.get("choices") or [{}])[0].get("message") or {}).get("content"))
    if not text:
        raise RuntimeError("OpenAI returned empty response")
    return text


def _call_gemini(system: str, user: str, model: str, api_key: str) -> str:
    timeout_sec = int(os.getenv("TIMEOUT_SEC", "30") or "30")
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": 0.1,
            "topP": 0.9,
            "maxOutputTokens": 2500,
            "responseMimeType": "application/json",
        },
    }
    try:
        response = requests.post(f"{GEMINI_BASE_URL}/{model}:generateContent?key={api_key}", json=payload, timeout=timeout_sec)
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        raise RuntimeError(_sanitize_error(exc)) from exc
    text = _text((((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [{}])[0].get("text"))
    if not text:
        raise RuntimeError("Gemini returned empty response")
    return text


def _coerce_theme_list(raw: Any) -> List[Dict[str, Any]]:
    if isinstance(raw, list):
        out: List[Dict[str, Any]] = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "title": _text(row.get("title"), "Theme"),
                    "subtitles": [s for s in (_text(x) for x in (row.get("subtitles") or [])) if s],
                }
            )
        # Force fixed section titles by order.
        fixed_out: List[Dict[str, Any]] = []
        for idx, title in enumerate(FIXED_DAILY_SECTIONS):
            item = out[idx] if idx < len(out) else {}
            subtitles = item.get("subtitles") if isinstance(item, dict) else []
            subtitles = subtitles if isinstance(subtitles, list) else []
            cleaned_subtitles = [s for s in (_text(x) for x in subtitles) if s][:4]
            if len(cleaned_subtitles) < 2:
                cleaned_subtitles = (cleaned_subtitles + ["데이터 없음", "데이터 없음"])[:2]
            fixed_out.append({"title": title, "subtitles": cleaned_subtitles})
        return fixed_out
    if isinstance(raw, dict):
        keys = sorted(
            [key for key in raw.keys() if isinstance(key, str) and key.startswith("theme_")],
            key=lambda key: int(re.sub(r"[^0-9]", "", key) or "999"),
        )
        out = []
        for key in keys:
            row = raw.get(key)
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "title": _text(row.get("title"), key.replace("_", " ").title()),
                    "subtitles": [s for s in (_text(x) for x in (row.get("subtitles") or [])) if s],
                }
            )
        fixed_out: List[Dict[str, Any]] = []
        for idx, title in enumerate(FIXED_DAILY_SECTIONS):
            item = out[idx] if idx < len(out) else {}
            subtitles = item.get("subtitles") if isinstance(item, dict) else []
            subtitles = subtitles if isinstance(subtitles, list) else []
            cleaned_subtitles = [s for s in (_text(x) for x in subtitles) if s][:4]
            if len(cleaned_subtitles) < 2:
                cleaned_subtitles = (cleaned_subtitles + ["데이터 없음", "데이터 없음"])[:2]
            fixed_out.append({"title": title, "subtitles": cleaned_subtitles})
        return fixed_out
    return []


def _coerce_sources(raw: Any, ranked_sources: List[Dict[str, Any]], asof_day: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    if isinstance(raw, list):
        for row in raw:
            if isinstance(row, dict):
                snippet = _text(row.get("snippet"))
                if not snippet:
                    continue
                items.append(
                    {
                        "document": _text(row.get("document")),
                        "date": _text(row.get("date"), asof_day),
                        "source": _text(row.get("source"), "unknown"),
                        "snippet": snippet,
                    }
                )
    if items:
        return items[:8]
    fallback: List[Dict[str, str]] = []
    for row in ranked_sources[:8]:
        snippet = _text(row.get("snippet"))
        if not snippet:
            continue
        fallback.append(
            {
                "document": _text(row.get("document")),
                "date": _text(row.get("date"), asof_day),
                "source": _text(row.get("source"), "unknown"),
                "snippet": snippet[:240],
            }
        )
    return fallback


def _invoke_synthesis_llm(
    provider: str,
    model: str,
    api_key: str,
    search_results: List[Dict[str, Any]],
    market_data: Dict[str, Any],
    engine_context: Dict[str, Any],
    thinking: List[str],
    asof_day: str,
) -> DeepResearchOutput:
    system, user_template = _build_synthesis_prompt()
    user = (
        user_template
        .replace("__SEARCH_RESULTS__", json.dumps(search_results[:20], ensure_ascii=False, indent=2))
        .replace("__MARKET_DATA__", json.dumps(market_data, ensure_ascii=False, indent=2))
        .replace("__ENGINE_CONTEXT__", json.dumps(engine_context, ensure_ascii=False, indent=2))
    )

    if provider == "openai":
        raw_text = _call_openai(system, user, model, api_key)
    elif provider == "gemini":
        raw_text = _call_gemini(system, user, model, api_key)
    else:
        raise RuntimeError(f"Unsupported provider: {provider}")

    parsed = _extract_json(raw_text)
    candidate = {
        "summary_stack": _text(parsed.get("summary_stack")),
        "ai_brief": _coerce_theme_list(parsed.get("ai_brief")),
        "stance": parsed.get("stance") if isinstance(parsed.get("stance"), dict) else {},
        "agent_thinking": thinking,
        "sources": _coerce_sources(parsed.get("sources"), search_results, asof_day),
        "updated_at": datetime.now().isoformat(),
    }
    try:
        return DeepResearchOutput.model_validate(candidate)
    except ValidationError as exc:
        raise RuntimeError(f"LangGraph synthesis validation failed: {exc}") from exc


def generate_daily_brief_with_langgraph(query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from langgraph.graph import END, START, StateGraph
        from tavily import TavilyClient
        import yfinance as yf
    except Exception as exc:
        raise RuntimeError(f"LangGraph pipeline unavailable: {exc}") from exc

    tavily_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not tavily_key:
        raise RuntimeError("Missing TAVILY_API_KEY for langgraph pipeline")

    llm_candidates = _select_llm_candidates()
    asof_day = str(context.get("asof_day") or datetime.now(ET_ZONE).strftime("%Y-%m-%d"))
    tavily = TavilyClient(api_key=tavily_key)
    selected_llm: Dict[str, str] = {"provider": llm_candidates[0][0], "model": llm_candidates[0][1]}

    def parallel_search(state: AgentState) -> AgentState:
        searches: Dict[str, Any] = {}
        queries = _build_search_queries(state["asof_day"])

        def _run_tavily(name: str, q: str) -> Dict[str, Any]:
            return tavily.search(query=q, search_depth="advanced", max_results=8)

        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(_run_tavily, name, q): name for name, q in queries.items()}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    searches[name] = future.result()
                except Exception as exc:
                    searches[name] = {"results": [], "error": str(exc)}

        searches["market_data"] = _fetch_market_data(yf)
        flattened = _flatten_tavily(searches)
        ranked = _rank_sources(flattened, state["asof_day"])

        thinking = [
            f"Searched Market Overview ({len((searches.get('market') or {}).get('results') or [])} results)",
            f"Searched Sector Flow ({len((searches.get('sector') or {}).get('results') or [])} results)",
            f"Searched Risk & Volatility ({len((searches.get('risk') or {}).get('results') or [])} results)",
            f"Searched Watchlist Movers ({len((searches.get('watchlist') or {}).get('results') or [])} results)",
            "Fetched real-time prices via yfinance",
            f"LLM candidates: {', '.join([name for name, _, _ in llm_candidates])}",
        ]
        searches["agent_thinking"] = thinking

        state["raw_searches"] = searches
        state["ranked_sources"] = ranked
        return state

    def synthesize(state: AgentState) -> AgentState:
        result: Optional[DeepResearchOutput] = None
        errors: List[str] = []
        for candidate_provider, candidate_model, candidate_key in llm_candidates:
            try:
                result = _invoke_synthesis_llm(
                    provider=candidate_provider,
                    model=candidate_model,
                    api_key=candidate_key,
                    search_results=state["ranked_sources"],
                    market_data=state["raw_searches"].get("market_data", {}),
                    engine_context={
                        "market_state": context.get("market_state", {}),
                        "macro": context.get("macro", {}),
                        "risk": context.get("risk", {}),
                        "action": context.get("action", {}),
                    },
                    thinking=state["raw_searches"].get("agent_thinking", []),
                    asof_day=state["asof_day"],
                )
                selected_llm["provider"] = candidate_provider
                selected_llm["model"] = candidate_model
                break
            except Exception as exc:
                errors.append(f"{candidate_provider}: {_sanitize_error(exc)}")

        if result is None:
            raise RuntimeError(" ; ".join(errors) if errors else "LLM synthesis failed")

        state["final_output"] = result
        return state

    graph = StateGraph(AgentState)
    graph.add_node("search", parallel_search)
    graph.add_node("synthesize", synthesize)
    graph.add_edge(START, "search")
    graph.add_edge("search", "synthesize")
    graph.add_edge("synthesize", END)
    compiled = graph.compile()

    initial_state: AgentState = {
        "query": query,
        "asof_day": asof_day,
        "raw_searches": {},
        "ranked_sources": [],
        "final_output": None,
    }
    result_state = compiled.invoke(initial_state)
    final_output = result_state.get("final_output")
    if final_output is None:
        raise RuntimeError("LangGraph pipeline did not produce output")

    payload = final_output.model_dump()
    payload["_pipeline"] = "langgraph"
    payload["_model"] = selected_llm.get("model", "")
    payload["_provider"] = selected_llm.get("provider", "")
    return payload
