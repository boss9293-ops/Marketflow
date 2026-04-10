"""
Build cached AI briefings for the MarketFlow AI layer.

Writes:
  backend/output/ai/std_risk/latest.json
  backend/output/ai/macro/latest.json
  backend/output/ai/integrated/latest.json
  backend/output/briefing.json
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, field_validator


if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


SCRIPTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPTS_DIR.parent
ROOT_DIR = BACKEND_DIR.parent
OUTPUT_DIR = BACKEND_DIR / "output"
AI_DIR = OUTPUT_DIR / "ai"
ET_ZONE = ZoneInfo("America/New_York")
MARKET_OPEN_MINUTES_ET = 9 * 60 + 30
MARKET_CLOSE_MINUTES_ET = 16 * 60 + 30

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
LAYERS = ("std_risk", "macro", "integrated")
LAYER_TITLES = {
    "std_risk": {"ko": "표준 리스크 브리프", "en": "Standard Risk Brief"},
    "macro": {"ko": "매크로 브리프", "en": "Macro Brief"},
    "integrated": {"ko": "통합 브리프", "en": "Integrated Brief"},
}
SOURCE_WEIGHTS = {
    "bloomberg": 1.6,
    "cnbc": 1.5,
    "sec": 1.5,
    "reuters": 1.4,
    "wsj": 1.4,
    "internal_cache": 1.0,
}
RECENCY_DECAY_PER_DAY = 0.12
RECENCY_MIN_FACTOR = 0.35
FIXED_DAILY_SECTIONS = [
    "Market Tone",
    "News & Catalysts",
    "Sector Rotation",
    "Macro & Rates",
    "Movers & Watchlist",
    "Earnings & Calendar",
]


def _bootstrap() -> None:
    backend_path = str(BACKEND_DIR)
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)
    for candidate in [
        ROOT_DIR / ".env",
        ROOT_DIR / ".env.local",
        BACKEND_DIR / ".env",
        BACKEND_DIR / ".env.local",
    ]:
        load_dotenv(candidate)


_bootstrap()

from ai.providers import AIProvider, get_api_key, get_model, get_timeout_sec  # noqa: E402


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(int(value)) if float(value).is_integer() else str(value)
    return default


def _current_briefing_slot(now: Optional[datetime] = None) -> str:
    ref = now or datetime.now(timezone.utc)
    local_now = ref.astimezone(ET_ZONE)
    minutes = local_now.hour * 60 + local_now.minute
    if minutes < MARKET_OPEN_MINUTES_ET:
        return "preopen"
    if minutes < MARKET_CLOSE_MINUTES_ET:
        return "morning"
    return "close"


def _num(value: Any, digits: int = 1) -> str:
    if isinstance(value, bool):
        return "--"
    try:
        num = float(value)
    except Exception:
        return "--"
    if digits == 0:
        return str(int(round(num)))
    return f"{num:.{digits}f}"


def _pct(value: Any, digits: int = 1) -> str:
    if isinstance(value, bool):
        return "--"
    try:
        num = float(value)
    except Exception:
        return "--"
    return f"{'+' if num > 0 else ''}{num:.{digits}f}%"


def _safe_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _extract_pct_from_text(value: Any) -> Optional[float]:
    text = _text(value)
    if not text:
        return None
    match = re.search(r"([+-]?\d+(?:\.\d+)?)%", text)
    if not match:
        return None
    try:
        return float(match.group(1))
    except Exception:
        return None


def _sanitize_error(message: Any) -> str:
    text = _text(message, str(message))
    text = re.sub(r"([?&]key=)[^&\s]+", r"\1***", text, flags=re.IGNORECASE)
    for env_name in ("OPENAI_API_KEY", "GPT_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "TAVILY_API_KEY"):
        secret = os.getenv(env_name, "").strip()
        if secret:
            text = text.replace(secret, "***")
    return text


def _pick(data: Any, *path: str, default: Any = None) -> Any:
    cur = data
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return default if cur is None else cur


def _read_json(name: str) -> Tuple[Optional[Dict[str, Any]], Optional[Path]]:
    # Cache-first keeps the AI briefing aligned with the runtime cache layer.
    for candidate in [OUTPUT_DIR / "cache" / name, OUTPUT_DIR / name]:
        if not candidate.exists():
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid JSON in {candidate}: {exc}") from exc
        if isinstance(data, dict):
            return data, candidate
    return None, None


def _load_context() -> Dict[str, Any]:
    market_state, market_state_path = _read_json("market_state.json")
    health_snapshot, health_snapshot_path = _read_json("health_snapshot.json")
    overview, overview_path = _read_json("overview.json")
    macro_summary, macro_summary_path = _read_json("macro_summary.json")
    macro_detail, macro_detail_path = _read_json("macro_detail.json")
    risk_v1, risk_v1_path = _read_json("risk_v1.json")
    vr_survival, vr_survival_path = _read_json("vr_survival.json")
    action_snapshot, action_snapshot_path = _read_json("action_snapshot.json")
    daily_briefing, daily_briefing_path = _read_json("daily_briefing.json")
    daily_report, daily_report_path = _read_json("daily_report.json")

    asof_day = (
        _text(_pick(market_state, "data_date"))
        or _text(_pick(health_snapshot, "data_date"))
        or _text(_pick(overview, "latest_date"))
        or _text(_pick(macro_summary, "asof_date"))
        or _text(_pick(macro_detail, "asof_date"))
        or _text(_pick(risk_v1, "data_as_of"))
        or _text(_pick(risk_v1, "current", "date"))
        or _text(_pick(vr_survival, "current", "date"))
        or _text(_pick(daily_briefing, "data_date"))
        or datetime.now(ET_ZONE).strftime("%Y-%m-%d")
    )

    source_files = [
        str(path.relative_to(OUTPUT_DIR))
        for path in [
            market_state_path,
            health_snapshot_path,
            overview_path,
            macro_summary_path,
            macro_detail_path,
            risk_v1_path,
            vr_survival_path,
            action_snapshot_path,
            daily_briefing_path,
            daily_report_path,
        ]
        if path is not None
    ]

    return {
        "asof_day": asof_day,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "slot": _current_briefing_slot(),
        "source_files": source_files,
        "market_state": {
            "data_date": _text(_pick(market_state, "data_date") or asof_day),
            "generated_at": _text(_pick(market_state, "generated_at")),
            "phase": _pick(market_state, "phase", "label"),
            "phase_detail": _pick(market_state, "phase", "detail"),
            "gate": _pick(market_state, "gate", "label"),
            "gate_value": _pick(market_state, "gate", "value"),
            "gate_avg10d": _pick(market_state, "gate", "avg10d"),
            "gate_delta5d": _pick(market_state, "gate", "delta5d"),
            "risk": _pick(market_state, "risk", "label"),
            "risk_detail": _pick(market_state, "risk", "detail"),
            "trend": _pick(market_state, "trend", "label"),
            "trend_detail": _pick(market_state, "trend", "detail"),
        },
        "health": {
            "data_date": _text(_pick(health_snapshot, "data_date") or asof_day),
            "trend_dist_pct": _pick(health_snapshot, "trend", "dist_pct"),
            "risk_cvar95_1d": _pick(health_snapshot, "risk", "cvar95_1d"),
            "risk_var95_1d": _pick(health_snapshot, "risk", "var95_1d"),
            "breadth_label": _pick(health_snapshot, "breadth_greed", "label"),
            "breadth_explain": _pick(health_snapshot, "breadth_greed", "explain"),
        },
        "overview": {
            "latest_date": _text(_pick(overview, "latest_date") or asof_day),
            "gate_score": _pick(overview, "gate_score"),
            "risk_level": _pick(overview, "risk_level"),
            "risk_trend": _pick(overview, "risk_trend"),
            "gate_status": _pick(overview, "gate_status"),
        },
        "macro": {
            "policy_version": _pick(macro_summary, "policy_version"),
            "asof_date": _text(_pick(macro_summary, "asof_date") or asof_day),
            "score": _pick(macro_summary, "macro_pressure", "score"),
            "state": _pick(macro_summary, "macro_pressure", "state"),
            "confidence": _pick(macro_summary, "macro_pressure", "confidence"),
            "series_status": _pick(macro_summary, "series_status"),
            "exposure_modifier": _pick(macro_summary, "exposure_modifier"),
        },
        "macro_detail": {
            "policy_version": _pick(macro_detail, "policy_version"),
            "asof_date": _text(_pick(macro_detail, "asof_date") or asof_day),
            "formula": _pick(macro_detail, "macro_pressure_explain", "formula"),
            "inputs": _pick(macro_detail, "macro_pressure_explain", "inputs"),
            "layers": _pick(macro_detail, "layers"),
        },
        "risk": {
            "run_id": _pick(risk_v1, "run_id"),
            "current": {
                "date": _pick(risk_v1, "current", "date"),
                "score": _pick(risk_v1, "current", "score"),
                "score_zone": _pick(risk_v1, "current", "score_zone"),
                "level_label": _pick(risk_v1, "current", "level_label"),
                "exposure_pct": _pick(risk_v1, "current", "exposure_pct"),
                "brief": _pick(risk_v1, "current", "brief"),
                "context": _pick(risk_v1, "current", "context"),
            },
        },
        "vr": {
            "run_id": _pick(vr_survival, "run_id"),
            "current": {
                "date": _pick(vr_survival, "current", "date"),
                "score": _pick(vr_survival, "current", "score"),
                "level_label": _pick(vr_survival, "current", "level_label"),
                "state": _pick(vr_survival, "current", "state"),
                "exposure_pct": _pick(vr_survival, "current", "exposure_pct"),
                "brief": _pick(vr_survival, "current", "brief"),
            },
        },
        "action": {
            "data_date": _text(_pick(action_snapshot, "data_date") or asof_day),
            "action_label": _pick(action_snapshot, "exposure_guidance", "action_label"),
            "exposure_band": _pick(action_snapshot, "exposure_guidance", "exposure_band"),
            "reason": _pick(action_snapshot, "exposure_guidance", "reason"),
        },
        "briefing": {
            "data_date": _text(_pick(daily_briefing, "data_date") or asof_day),
            "headline": _pick(daily_briefing, "headline"),
            "paragraphs": _pick(daily_briefing, "paragraphs"),
            "bullets": _pick(daily_briefing, "bullets"),
            "stance": _pick(daily_briefing, "stance"),
        },
        "report": {
            "generated_at": _pick(daily_report, "generated_at"),
            "market_lines": _pick(daily_report, "market_summary", "lines"),
            "market_bullets": _pick(daily_report, "market_summary", "bullets"),
            "action_hint": _pick(daily_report, "market_summary", "action_hint"),
            "sector_interp": _pick(daily_report, "sector_brief", "interp"),
            "risk_lines": _pick(daily_report, "risk_brief", "lines"),
            "narratives": _pick(daily_report, "narratives"),
        },
    }


def _listify(value: Any, lang: str) -> List[str]:
    if isinstance(value, dict):
        if lang in value:
            return _listify(value[lang], lang)
        for key in ("en", "ko", "text", "summary", "title", "label", "value"):
            if key in value:
                return _listify(value[key], lang)
        return []
    if isinstance(value, list):
        items: List[str] = []
        for item in value:
            if isinstance(item, str):
                text = item.strip()
            elif isinstance(item, dict):
                text = _text(item.get(lang) or item.get("en") or item.get("ko") or item.get("text") or item.get("value") or item.get("label"))
            else:
                text = _text(item)
            if text:
                items.append(text)
        return items
    if isinstance(value, str):
        return [line.strip() for line in value.splitlines() if line.strip()]
    return []


def _parse_any_date(value: Any) -> Optional[date]:
    text = _text(value)
    if not text:
        return None
    normalized = text.replace("/", "-").strip()
    candidates = [
        "%Y-%m-%d",
        "%m-%d-%Y",
        "%m-%d-%y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in candidates:
        try:
            return datetime.strptime(normalized, fmt).date()
        except Exception:
            continue
    # Loose fallback for strings like 2026-03-31T10:11:12+00:00
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).date()
    except Exception:
        return None


def _recency_factor(event_date: Any, asof_day: Any) -> float:
    event_dt = _parse_any_date(event_date)
    asof_dt = _parse_any_date(asof_day) or datetime.now(ET_ZONE).date()
    if event_dt is None:
        return 1.0
    diff_days = max(0, (asof_dt - event_dt).days)
    score = max(RECENCY_MIN_FACTOR, 1.0 - (RECENCY_DECAY_PER_DAY * float(diff_days)))
    return round(score, 4)


class ThemeSchema(BaseModel):
    title: str = Field(..., description="Large market-moving theme title")
    subtitles: List[str] = Field(..., min_length=2, max_length=4, description="Concrete drivers/impact bullets")

    @field_validator("title")
    @classmethod
    def _clean_title(cls, value: str) -> str:
        text = _text(value)
        if not text:
            raise ValueError("Theme title is required")
        return text

    @field_validator("subtitles")
    @classmethod
    def _clean_subtitles(cls, value: List[str]) -> List[str]:
        cleaned = [_text(item) for item in value if _text(item)]
        if len(cleaned) < 2:
            raise ValueError("Each theme requires at least 2 subtitles")
        return cleaned[:4]


class StanceSchema(BaseModel):
    stance: str = Field(..., description="Defensive / Neutral / Offensive")
    action: str = Field(..., description="Reduce / Maintain / Increase")
    exposure: str = Field(..., description="Exposure guidance band")

    @field_validator("stance", "action", "exposure")
    @classmethod
    def _clean_values(cls, value: str) -> str:
        text = _text(value)
        if not text:
            raise ValueError("Stance fields cannot be empty")
        return text


class SourceEntrySchema(BaseModel):
    document: str = ""
    date: str = ""
    source: str = ""
    snippet: str = ""

    @field_validator("document", "date", "source", "snippet")
    @classmethod
    def _trim(cls, value: str) -> str:
        return _text(value)


class DailyBriefPayloadSchema(BaseModel):
    summary_stack: str = Field(..., description="One-line summary")
    ai_brief: List[ThemeSchema] = Field(..., min_length=6, max_length=6)
    stance: StanceSchema
    agent_thinking: List[str] = Field(default_factory=list)
    sources: List[SourceEntrySchema] = Field(default_factory=list)

    @field_validator("summary_stack")
    @classmethod
    def _clean_summary(cls, value: str) -> str:
        text = _text(value)
        if not text:
            raise ValueError("summary_stack is required")
        return text

    @field_validator("agent_thinking")
    @classmethod
    def _clean_thinking(cls, value: List[str]) -> List[str]:
        return [_text(item) for item in value if _text(item)]


def _coerce_theme_list(raw_ai_brief: Any) -> List[Dict[str, Any]]:
    if isinstance(raw_ai_brief, list):
        output: List[Dict[str, Any]] = []
        for item in raw_ai_brief:
            if not isinstance(item, dict):
                continue
            output.append(
                {
                    "title": _text(item.get("title"), "Theme"),
                    "subtitles": _listify(item.get("subtitles"), "ko"),
                }
            )
        return output

    if isinstance(raw_ai_brief, dict):
        keys = sorted(
            [key for key in raw_ai_brief.keys() if isinstance(key, str) and key.startswith("theme_")],
            key=lambda key: int(re.sub(r"[^0-9]", "", key) or "999"),
        )
        output = []
        for key in keys:
            item = raw_ai_brief.get(key)
            if not isinstance(item, dict):
                continue
            output.append(
                {
                    "title": _text(item.get("title"), key.replace("_", " ").title()),
                    "subtitles": _listify(item.get("subtitles"), "ko"),
                }
            )
        return output

    return []


def _coerce_source_list(raw_sources: Any) -> List[Dict[str, str]]:
    sources: List[Dict[str, str]] = []
    if not isinstance(raw_sources, list):
        return sources
    for row in raw_sources:
        if isinstance(row, str):
            text = _text(row)
            if text:
                sources.append({"document": "", "date": "", "source": "", "snippet": text})
            continue
        if not isinstance(row, dict):
            continue
        sources.append(
            {
                "document": _text(row.get("document") or row.get("title")),
                "date": _text(row.get("date")),
                "source": _text(row.get("source")),
                "snippet": _text(row.get("snippet") or row.get("summary") or row.get("text")),
            }
        )
    return sources


def _validate_daily_payload(payload: Dict[str, Any]) -> DailyBriefPayloadSchema:
    candidate = {
        "summary_stack": _text(payload.get("summary_stack")),
        "ai_brief": _coerce_theme_list(payload.get("ai_brief")),
        "stance": payload.get("stance") if isinstance(payload.get("stance"), dict) else {},
        "agent_thinking": _listify(payload.get("agent_thinking"), "ko"),
        "sources": _coerce_source_list(payload.get("sources")),
    }
    return DailyBriefPayloadSchema.model_validate(candidate)


def _filter_lines_by_keywords(lines: List[str], keywords: List[str], limit: int = 3) -> List[str]:
    hits: List[str] = []
    for line in lines:
        lower = line.lower()
        if any(token in lower for token in keywords):
            hits.append(line)
        if len(hits) >= limit:
            break
    return hits


def _build_fixed_section_subtitles(context: Dict[str, Any], ranked_lines: List[str]) -> List[List[str]]:
    index_lines = _filter_lines_by_keywords(
        ranked_lines,
        ["s&p", "nasdaq", "dow", "russell", "vix", "index", "spy", "qqq", "dia"],
    )
    sector_lines = _filter_lines_by_keywords(
        ranked_lines,
        ["sector", "energy", "tech", "financial", "materials", "consumer", "rotation"],
    )
    commodity_lines = _filter_lines_by_keywords(
        ranked_lines,
        ["yield", "rates", "dollar", "dxy", "oil", "gold", "bond", "treasury", "credit", "wti", "brent"],
    )
    stock_lines = _filter_lines_by_keywords(
        ranked_lines,
        ["nvda", "aapl", "msft", "amd", "tsla", "watchlist", "ticker", "mover", "earnings"],
    )
    macro_lines = _filter_lines_by_keywords(
        ranked_lines,
        ["fed", "cpi", "pce", "inflation", "macro", "fomc", "jobs", "sentiment", "policy"],
    )
    positioning_lines = _filter_lines_by_keywords(
        ranked_lines,
        ["position", "positioning", "cta", "hedge fund", "dealer", "gamma", "exposure", "flows", "allocation"],
    )

    fallback_index = [
        _text(_pick(context, "briefing", "headline"), "주요 지수 흐름은 데이터 확인이 필요합니다."),
        f"VIX와 주요 지수 방향을 함께 점검해야 합니다.",
    ]
    fallback_sector = [
        _text(_pick(context, "report", "sector_interp"), "섹터 강약이 엇갈리는 구간입니다."),
        "상승 섹터와 하락 섹터의 로테이션 강도를 비교해야 합니다.",
    ]
    fallback_commodity = [
        "금리·달러·원자재의 동시 변화를 확인해야 합니다.",
        "채권 금리 방향은 성장주 변동성과 연동될 수 있습니다.",
    ]
    fallback_stock = [
        "대형주와 이벤트 종목의 수급 차이가 커지는 구간입니다.",
        "개별 종목 뉴스가 지수 대비 초과 변동을 만들 수 있습니다.",
    ]
    fallback_macro = [
        _text(_pick(context, "action", "reason"), "매크로 이벤트 전후 변동성 확대 가능성을 점검합니다."),
        "연준/물가 지표 발표 일정과 시장 민감도 재확인이 필요합니다.",
    ]
    fallback_positioning = [
        "기관 포지셔닝 변화가 단기 변동성 방향에 영향을 줄 수 있습니다.",
        "노출 조정 속도와 섹터 비중 이동 여부를 함께 점검해야 합니다.",
    ]

    sections: List[List[str]] = [
        (index_lines[:4] or fallback_index)[:4],
        (sector_lines[:4] or fallback_sector)[:4],
        (commodity_lines[:4] or fallback_commodity)[:4],
        (stock_lines[:4] or fallback_stock)[:4],
        (macro_lines[:4] or fallback_macro)[:4],
        (positioning_lines[:4] or fallback_positioning)[:4],
    ]

    # Guarantee each section has at least 2 subtitles.
    for idx, items in enumerate(sections):
        if len(items) == 1:
            items.append("추가 확인 포인트: 데이터 없음")
        if not items:
            items.extend(["데이터 없음", "데이터 없음"])
        sections[idx] = items[:4]
    return sections


def _build_ranked_evidence(context: Dict[str, Any]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    asof_day = context.get("asof_day")
    briefing_date = _pick(context, "briefing", "data_date") or asof_day
    report_date = _pick(context, "report", "generated_at") or asof_day
    market_date = _pick(context, "market_state", "data_date") or asof_day

    def push(
        text: Any,
        source: str = "internal_cache",
        event_date: Any = None,
        recency_override: Optional[float] = None,
    ) -> None:
        line = _text(text)
        if not line:
            return
        recency_factor = recency_override if recency_override is not None else _recency_factor(event_date, asof_day)
        pct = _extract_pct_from_text(line)
        abs_move = abs(pct) if pct is not None else 1.0
        source_weight = SOURCE_WEIGHTS.get(source, SOURCE_WEIGHTS["internal_cache"])
        impact_score = round(abs_move * source_weight * recency_factor, 4)
        records.append(
            {
                "text": line,
                "source": source,
                "price_change": pct,
                "source_weight": source_weight,
                "recency_factor": recency_factor,
                "impact_score": impact_score,
            }
        )

    briefing = context.get("briefing") or {}
    report = context.get("report") or {}
    market_state = context.get("market_state") or {}
    action = context.get("action") or {}
    macro = context.get("macro") or {}
    risk = context.get("risk") or {}
    health = context.get("health") or {}

    push(_pick(briefing, "headline"), "internal_cache", event_date=briefing_date)
    for line in _listify(_pick(briefing, "paragraphs"), "en")[:6]:
        push(line, "internal_cache", event_date=briefing_date)
    for line in _listify(_pick(briefing, "bullets"), "en")[:8]:
        push(line, "internal_cache", event_date=briefing_date)
    for line in _listify(_pick(report, "market_lines"), "en")[:8]:
        push(line, "internal_cache", event_date=report_date)
    for line in _listify(_pick(report, "market_bullets"), "en")[:8]:
        push(line, "internal_cache", event_date=report_date)
    push(_pick(report, "action_hint"), "internal_cache", event_date=report_date)
    push(_pick(report, "sector_interp"), "internal_cache", event_date=report_date)

    phase = _text(_pick(market_state, "phase"))
    gate_value = _safe_float(_pick(market_state, "gate_value"))
    trend = _text(_pick(market_state, "trend"))
    risk_label = _text(_pick(market_state, "risk"))
    if phase or trend or risk_label:
        gate_part = f"Gate {int(round(gate_value))}" if gate_value is not None else "Gate 데이터 없음"
        push(
            f"Market state {phase or '데이터 없음'} | {gate_part} | Risk {risk_label or '데이터 없음'} | Trend {trend or '데이터 없음'}",
            event_date=market_date,
        )

    push(_pick(action, "reason"), "internal_cache", event_date=_pick(context, "action", "data_date") or asof_day)
    push(
        f"Action { _text(_pick(action, 'action_label')) or '데이터 없음' } | Exposure { _text(_pick(action, 'exposure_band')) or '데이터 없음' }",
        event_date=_pick(context, "action", "data_date") or asof_day,
    )
    push(
        f"Macro { _text(_pick(macro, 'state')) or '데이터 없음' } | score { _num(_pick(macro, 'score'), 0) } | confidence { _num(_pick(macro, 'confidence'), 0) }",
        event_date=_pick(context, "macro", "asof_date") or asof_day,
    )
    push(_pick(risk, "current", "brief"), "internal_cache", event_date=_pick(risk, "current", "date") or asof_day)
    push(_pick(risk, "current", "context"), "internal_cache", event_date=_pick(risk, "current", "date") or asof_day)
    push(
        f"Risk tail metrics VaR95 {_pct(_pick(health, 'risk_var95_1d'))} / CVaR95 {_pct(_pick(health, 'risk_cvar95_1d'))} | Breadth {_text(_pick(health, 'breadth_label')) or '데이터 없음'}",
        "internal_cache",
        event_date=_pick(context, "health", "data_date") or asof_day,
    )

    deduped: Dict[str, Dict[str, Any]] = {}
    for rec in records:
        key = _text(rec.get("text")).lower()
        if not key:
            continue
        prev = deduped.get(key)
        current_score = _safe_float(rec.get("impact_score")) or 0.0
        prev_score = _safe_float(prev.get("impact_score")) or 0.0 if prev is not None else -1.0
        if prev is None or current_score > prev_score:
            deduped[key] = rec

    ranked = sorted(
        deduped.values(),
        key=lambda row: (_safe_float(row.get("impact_score")) or 0.0),
        reverse=True,
    )
    return ranked


def _section_defaults(layer: str, context: Dict[str, Any]) -> Dict[str, Any]:
    gate_value = _num(context["market_state"]["gate_value"], 0)
    risk_level = _text(context["overview"]["risk_level"], "medium")
    risk_zone = _text(context["risk"]["current"]["score_zone"], "")
    risk_score = _num(context["risk"]["current"]["score"], 0)
    action_band = _text(context["action"]["exposure_band"], "--")
    action_label = _text(context["action"]["action_label"], "Hold")
    action_reason = _text(context["action"]["reason"], "Mixed trend/risk signals")
    macro_state = _text(context["macro"]["state"], "unknown")
    macro_score = _num(context["macro"]["score"], 0)
    macro_conf = _num(context["macro"]["confidence"], 0)
    macro_formula = _text(context["macro_detail"]["formula"], "0.4*LPI + 0.3*RPI + 0.3*VRI")
    phase_label = _text(context["market_state"]["phase"], "Phase")
    trend_label = _text(context["market_state"]["trend"], "Trend")
    risk_label = _text(context["market_state"]["risk"], "Risk")
    daily_headline = _text(
        context["briefing"]["headline"].get("en") if isinstance(context["briefing"]["headline"], dict) else context["briefing"]["headline"]
    )
    daily_paragraphs_en = _listify(context["briefing"]["paragraphs"], "en")
    report_lines_en = _listify(context["report"]["market_lines"], "en")
    sector_interp = _text(context["report"]["sector_interp"], "")
    narrative_market = _text(_pick(context["report"], "narratives", "market"), "")
    narrative_sector = _text(_pick(context["report"], "narratives", "sector"), "")
    narrative_risk = _text(_pick(context["report"], "narratives", "risk"), "")

    if layer == "std_risk":
        return {
            "title": LAYER_TITLES[layer],
            "summary": {
                "ko": f"{phase_label} ???? Gate {gate_value}, {risk_label}, {trend_label}? ?? ???? ??? ??????.",
                "en": f"Defensive brief watching Gate {gate_value}, {risk_label}, and {trend_label} in the current phase.",
            },
            "paragraphs": {
                "ko": [
                    f"?? ??? {phase_label}?? Gate {gate_value}, ??? {risk_level}, ?? {trend_label}? ?? ????.",
                    "???? breadth? ?? ???? ??, ?? ???? ??/?? ??? ?? ?? ???.",
                    f"??? {action_band} ??? ????, {action_reason}? ???? ??? ????? ??? ???.",
                ],
                "en": [
                    f"The current state is {phase_label} with Gate {gate_value}, risk {risk_level}, and trend {trend_label} still in view.",
                    "Volatility and breadth are mixed, so the near-term path is more sensitive to pressure relief than to headline trend alone.",
                    f"Keep exposure around {action_band} and stay selective until the gate and risk picture improve together.",
                ],
            },
            "warnings": {
                "ko": [
                    "Gate? 50 ??? ???? ?? ??? ?????.",
                    "VIX? ? ???? breadth? ???? ????? ? ?? ??? ? ????.",
                    f"200?? ??? ??? {action_label}?? ? ???? ??? ??? ? ????.",
                ],
                "en": [
                    "A drop of Gate below 50 would weaken the current balance.",
                    "A sharper VIX move or breadth deterioration can matter faster than the trend line itself.",
                    "A loss of the 200-day trend would call for a more defensive shift than the current stance.",
                ],
            },
            "highlights": {
                "ko": [f"Gate {gate_value}", f"Risk {risk_level}", f"Exposure {action_band}"],
                "en": [f"Gate {gate_value}", f"Risk {risk_level}", f"Exposure {action_band}"],
            },
        }

    if layer == "macro":
        inputs = _listify(context["macro_detail"]["inputs"], "en")
        return {
            "title": LAYER_TITLES[layer],
            "summary": {
                "ko": f"??? ??? {macro_state} ????, ??/???/??? ??? ?? ??? ???? ?????.",
                "en": f"Macro pressure sits in a {macro_state} state, and the policy/liquidity/volatility blend is still incomplete.",
            },
            "paragraphs": {
                "ko": [
                    f"??? ??? {macro_state}?? ?? {macro_score}, ??? {macro_conf}? ?????.",
                    f"??? {macro_formula}??, ?? ??? {', '.join(inputs[:3]) if inputs else 'partial inputs'} ?????.",
                    "??/???/??? ??? ??? ??? ??? ???? ????? ?????.",
                ],
                "en": [
                    f"Macro pressure is reading as {macro_state} with score {macro_score} and confidence {macro_conf}.",
                    f"The working formula is {macro_formula}, and the current inputs are still partial.",
                    "Treat the macro layer conservatively until the policy, liquidity, and volatility inputs settle into a stable score.",
                ],
            },
            "warnings": {
                "ko": [
                    "??? ?? ??? ?? ???? ?? ??? ????.",
                    "?? ??? ???? ?? ?? ??? ??? ? ????.",
                    "??? ???? ?? ???? ???? ? ??? ???? ???? ? ????.",
                ],
                "en": [
                    "If the score is partial or missing, lower the confidence in the macro read.",
                    "Persistent partial inputs can delay the next exposure adjustment.",
                    "Policy and volatility can reprice risk faster than the trend if they move together.",
                ],
            },
            "highlights": {
                "ko": [f"Macro score {macro_score}", f"Macro state {macro_state}", f"Confidence {macro_conf}"],
                "en": [f"Macro score {macro_score}", f"Macro state {macro_state}", f"Confidence {macro_conf}"],
            },
        }

    briefing_lines = daily_paragraphs_en[:3] or report_lines_en[:3] or [
        f"Trend intact; macro state {macro_state}.",
        f"Keep exposure aligned with {action_band}.",
        "See the standard risk brief for the explicit risk overlay.",
    ]
    return {
        "title": LAYER_TITLES[layer],
        "summary": {
            "ko": daily_headline or f"{phase_label}? {macro_state}? ???? ?? ?? ??????.",
            "en": daily_headline or f"Integrated brief reading today's market tone through {phase_label} and {macro_state}.",
        },
        "paragraphs": {
            "ko": [
                daily_headline or f"??? ???? {phase_label}? {macro_state}? ???? ?? ???? ?????.",
                briefing_lines[0],
                briefing_lines[1] if len(briefing_lines) > 1 else f"??? {action_band} ??? ?????.",
                "Risk overlay? standard risk brief?? ??? ?????.",
            ],
            "en": [
                daily_headline or f"Today's brief rechecks the market tone through {phase_label} and {macro_state}.",
                briefing_lines[0],
                briefing_lines[1] if len(briefing_lines) > 1 else f"Keep exposure around {action_band}.",
                "See the standard risk brief for the explicit risk overlay.",
            ],
        },
        "warnings": {
            "ko": [
                "?? ???? ???? ???? ??, explicit risk overlay? standard risk brief?? ?????.",
                "Breadth? ?? ???? ?? ???? ? ????? ????.",
            ],
            "en": [
                "The integrated brief should stay headline-led; check the standard risk brief for the explicit risk overlay.",
                "If breadth deteriorates first, the integrated brief should turn more defensive.",
            ],
        },
        "highlights": {
            "ko": [phase_label, f"Market tone {trend_label}", f"Macro {macro_state}"],
            "en": [phase_label, f"Market tone {trend_label}", f"Macro {macro_state}"],
        },
    }

def _provider_choice() -> Optional[AIProvider]:
    forced = os.getenv("AI_BRIEF_PROVIDER", "auto").strip().lower()
    if forced in {"fallback", "none", "static"}:
        return None
    if forced in {"gpt", "openai"}:
        try:
            get_api_key(AIProvider.GPT)
            return AIProvider.GPT
        except Exception:
            return None
    if forced == "gemini":
        try:
            get_api_key(AIProvider.GEMINI)
            return AIProvider.GEMINI
        except Exception:
            return None
    for provider in (AIProvider.GPT, AIProvider.GEMINI):
        try:
            get_api_key(provider)
            return provider
        except Exception:
            continue
    return None


def _build_prompt(context: Dict[str, Any]) -> Tuple[str, str]:
    ranked_evidence = _build_ranked_evidence(context)[:12]
    search_logs: List[str] = [f"Searched cache::{path}" for path in context.get("source_files", [])[:8]]
    for idx, item in enumerate(ranked_evidence[:5], start=1):
        search_logs.append(
            f"Ranked evidence #{idx} ({item.get('source', 'internal_cache')}) impact={item.get('impact_score', 0)}"
        )

    system = "\n".join(
        [
            "You are the Terminal-X.ai daily briefing agent.",
            "Write a market front page, not a risk memo.",
            "Sections 01-06 must focus on overall market tone, news, sector rotation, macro, movers, and calendar flow.",
            "Keep explicit MSS / gate / defensive-risk language only in the standard risk layer.",
            "Use the evidence and search logs as support, but write a clean front-page narrative.",
            "Return one JSON object only, and keep the output compact and readable.",
        ]
    )
    user = "\n".join(
        [
            "Build the integrated daily briefing for the U.S. market.",
            "",
            "Structure rules:",
            "1) Use exactly the six fixed front-page themes below.",
            "   - Market Tone",
            "   - News & Catalysts",
            "   - Sector Rotation",
            "   - Macro & Rates",
            "   - Movers & Watchlist",
            "   - Earnings & Calendar",
            "2) Summarize the market mood in one plain-language summary stack.",
            "3) Keep the integrated brief headline-led; do not turn it into a risk note.",
            "4) Mention the standard risk brief only as a separate risk overlay reference.",
            "5) Use 2-4 subtitles per theme and keep them market-facing.",
            "6) If evidence is thin, stay neutral rather than forcing a defensive tone.",
            "",
            "Output JSON schema:",
            "{",
            '  "summary_stack": "...",',
            '  "ai_brief": [',
            '    { "title": "Market Tone", "subtitles": ["...", "..."] },',
            '    { "title": "News & Catalysts", "subtitles": ["...", "..."] },',
            '    { "title": "Sector Rotation", "subtitles": ["...", "..."] },',
            '    { "title": "Macro & Rates", "subtitles": ["...", "..."] },',
            '    { "title": "Movers & Watchlist", "subtitles": ["...", "..."] },',
            '    { "title": "Earnings & Calendar", "subtitles": ["...", "..."] }',
            "  ],",
            '  "stance": { "stance": "Balanced", "action": "Hold", "exposure": "40-60%" },',
            '  "agent_thinking": ["Search log 1", "Search log 2"]',
            "}",
            "",
            "search_logs:",
            json.dumps(search_logs, ensure_ascii=False, indent=2),
            "",
            "ranked_evidence:",
            json.dumps(ranked_evidence, ensure_ascii=False, indent=2),
            "",
            "context_json:",
            json.dumps(context, ensure_ascii=False, indent=2),
        ]
    )
    return system, user

def _call_openai(system: str, user: str) -> Tuple[str, str]:
    model = get_model(AIProvider.GPT)
    api_key = get_api_key(AIProvider.GPT)
    timeout_sec = get_timeout_sec()
    res = requests.post(
        OPENAI_CHAT_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.2,
            "max_tokens": 2500,
        },
        timeout=timeout_sec,
    )
    res.raise_for_status()
    data = res.json()
    text = _text(_pick(data, "choices", 0, "message", "content"))
    if not text:
        raise RuntimeError("OpenAI returned an empty response")
    return text, model


def _call_gemini(system: str, user: str) -> Tuple[str, str]:
    model = get_model(AIProvider.GEMINI)
    api_key = get_api_key(AIProvider.GEMINI)
    timeout_sec = get_timeout_sec()
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.9,
            "maxOutputTokens": 2500,
            "responseMimeType": "application/json",
        },
    }
    res = requests.post(f"{GEMINI_BASE_URL}/{model}:generateContent?key={api_key}", json=payload, timeout=timeout_sec)
    res.raise_for_status()
    data = res.json()
    text = _text(_pick(data, "candidates", 0, "content", "parts", 0, "text"))
    if not text:
        parts = _pick(data, "candidates", 0, "content", "parts")
        if isinstance(parts, list):
            text = "\n".join(_text(part.get("text")) for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    return text, model


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
    raise ValueError("AI response did not contain valid JSON")


def _default_daily_payload(context: Dict[str, Any]) -> Dict[str, Any]:
    ranked = _build_ranked_evidence(context)
    top_lines = [row.get("text", "") for row in ranked if _text(row.get("text"))][:8]
    section_subtitles = _build_fixed_section_subtitles(context, top_lines)

    phase = _text(_pick(context, "market_state", "phase"), "????????")
    risk_label = _text(_pick(context, "market_state", "risk"), "????????")
    trend = _text(_pick(context, "market_state", "trend"), "????????")
    gate_value = _num(_pick(context, "market_state", "gate_value"), 0)
    macro_state = _text(_pick(context, "macro", "state"), "????????")
    action_label = _text(_pick(context, "action", "action_label"), "Hold")
    exposure_band = _text(_pick(context, "action", "exposure_band"), "????????")

    action_lower = action_label.lower()
    if any(word in action_lower for word in ("reduce", "defensive", "cut")):
        stance_label = "Defensive"
        stance_action = "Reduce"
    elif any(word in action_lower for word in ("increase", "add", "risk-on", "expand")):
        stance_label = "Aligned"
        stance_action = "Add selectively"
    elif any(word in action_lower for word in ("hold", "wait", "neutral")):
        stance_label = "Balanced"
        stance_action = "Hold"
    else:
        stance_label = "Selective"
        stance_action = "Trim risk"

    source_files = context.get("source_files", [])
    agent_thinking = [f"Searched cache::{path}" for path in source_files[:8]]
    if not agent_thinking:
        agent_thinking = ["Searched cache::none"]

    ai_brief = [
        {"title": FIXED_DAILY_SECTIONS[idx], "subtitles": section_subtitles[idx]}
        for idx in range(len(FIXED_DAILY_SECTIONS))
    ]
    sources = [
        {
            "document": "",
            "date": _text(context.get("asof_day")),
            "source": _text(row.get("source"), "internal_cache"),
            "snippet": _text(row.get("text"))[:240],
        }
        for row in ranked[:8]
        if _text(row.get("text"))
    ]

    return {
        "summary_stack": f"{phase} / {trend} / {macro_state} market tone with headlines and catalysts upfront.",
        "ai_brief": ai_brief,
        "stance": {
            "stance": stance_label,
            "action": stance_action,
            "exposure": exposure_band,
        },
        "agent_thinking": agent_thinking,
        "sources": sources,
    }

def _normalize_daily_payload(raw: Optional[Dict[str, Any]], context: Dict[str, Any]) -> Dict[str, Any]:
    fallback = _default_daily_payload(context)
    source = raw if isinstance(raw, dict) else {}
    normalized_input = {
        "summary_stack": _text(source.get("summary_stack")) or fallback["summary_stack"],
        "ai_brief": source.get("ai_brief") if source.get("ai_brief") is not None else fallback["ai_brief"],
        "stance": source.get("stance") if isinstance(source.get("stance"), dict) else fallback["stance"],
        "agent_thinking": source.get("agent_thinking") if source.get("agent_thinking") is not None else fallback["agent_thinking"],
        "sources": source.get("sources") if source.get("sources") is not None else [],
    }

    try:
        parsed = _validate_daily_payload(normalized_input)
    except ValidationError:
        parsed = _validate_daily_payload(fallback)

    fallback_items: List[Dict[str, Any]] = []
    if isinstance(fallback.get("ai_brief"), list):
        fallback_items = [row for row in fallback["ai_brief"] if isinstance(row, dict)]

    theme_map: Dict[str, Dict[str, Any]] = {}
    for idx, fixed_title in enumerate(FIXED_DAILY_SECTIONS):
        parsed_item = parsed.ai_brief[idx] if idx < len(parsed.ai_brief) else None
        fallback_item = fallback_items[idx] if idx < len(fallback_items) else {}
        subtitles = parsed_item.subtitles if parsed_item is not None else _listify(fallback_item.get("subtitles"), "ko")
        if len(subtitles) < 2:
            subtitles = (_listify(fallback_item.get("subtitles"), "ko") + subtitles)[:4]
        if len(subtitles) < 2:
            subtitles = ["데이터 없음", "데이터 없음"]
        theme_map[f"theme_{idx + 1}"] = {
            "title": fixed_title,
            "subtitles": subtitles[:4],
        }

    return {
        "summary_stack": parsed.summary_stack,
        "ai_brief": theme_map,
        "stance": {
            "stance": parsed.stance.stance,
            "action": parsed.stance.action,
            "exposure": parsed.stance.exposure,
        },
        "agent_thinking": parsed.agent_thinking[:12],
        "sources": [item.model_dump() for item in parsed.sources],
    }


def _daily_payload_to_layer(
    payload: Dict[str, Any],
    context: Dict[str, Any],
    provider: str,
    model: str,
    slot: str,
    fallback_reason: Optional[str] = None,
) -> Dict[str, Any]:
    themes: Dict[str, Dict[str, Any]] = payload.get("ai_brief") if isinstance(payload.get("ai_brief"), dict) else {}
    ordered = [themes[key] for key in sorted(themes.keys(), key=lambda x: int(re.sub(r"[^0-9]", "", x) or "999"))]
    summary_stack = _text(payload.get("summary_stack"), "데이터 없음")
    stance = payload.get("stance") if isinstance(payload.get("stance"), dict) else {}
    stance_label = _text(stance.get("stance"), "Defensive")
    stance_action = _text(stance.get("action"), "Reduce")
    stance_exposure = _text(stance.get("exposure"), "데이터 없음")
    thinking = _listify(payload.get("agent_thinking"), "ko")

    paragraphs_ko: List[str] = [summary_stack]
    for idx, theme in enumerate(ordered[: len(FIXED_DAILY_SECTIONS)], start=1):
        title = _text(theme.get("title"), FIXED_DAILY_SECTIONS[idx - 1] if idx - 1 < len(FIXED_DAILY_SECTIONS) else f"테마 {idx}")
        subs = _listify(theme.get("subtitles"), "ko")[:4]
        paragraphs_ko.append(f"{title}")
        if subs:
            for sub in subs:
                paragraphs_ko.append(f"• {sub}")
        else:
            paragraphs_ko.append("• 데이터 없음")
    paragraphs_ko.append(f"브리핑 스탠스: {stance_label} | Action: {stance_action} | Exposure: {stance_exposure}")

    warnings_ko = [f"Stance {stance_label} | Action {stance_action} | Exposure {stance_exposure}"]
    warnings_ko.extend(thinking[:2])

    highlights = [_text(theme.get("title")) for theme in ordered[: len(FIXED_DAILY_SECTIONS)] if _text(theme.get("title"))]
    if not highlights:
        highlights = ["Integrated", "Themes", "Stance"]

    sources: List[Dict[str, Any]] = []
    payload_sources = payload.get("sources")
    if isinstance(payload_sources, list):
        for row in payload_sources:
            if not isinstance(row, dict):
                continue
            snippet = _text(row.get("snippet"))
            if not snippet:
                continue
            sources.append(
                {
                    "title": snippet[:120],
                    "url": "",
                    "date": _text(row.get("date"), context.get("asof_day")),
                    "source": _text(row.get("source"), "external"),
                    "document": _text(row.get("document")),
                    "impact_score": _safe_float(row.get("impact_score")) or 0.0,
                    "source_weight": _safe_float(row.get("source_weight")) or 0.0,
                    "recency_factor": _safe_float(row.get("recency_factor")) or 0.0,
                }
            )

    for row in _build_ranked_evidence(context)[:6]:
        src = _text(row.get("source"), "internal_cache")
        txt = _text(row.get("text"))
        if not txt:
            continue
        sources.append(
            {
                "title": txt[:120],
                "url": "",
                "date": context.get("asof_day"),
                "source": src,
                "impact_score": row.get("impact_score"),
                "source_weight": row.get("source_weight"),
                "recency_factor": row.get("recency_factor"),
            }
        )
    # Keep a compact source list and remove duplicate snippets.
    uniq_sources: Dict[str, Dict[str, Any]] = {}
    for row in sources:
        key = _text(row.get("title")).lower()
        if not key:
            continue
        if key not in uniq_sources:
            uniq_sources[key] = row
    sources = list(uniq_sources.values())[:8]

    meta = {
        "slot": slot,
        "generated_at": context["generated_at"],
        "asof_day": context["asof_day"],
        "provider": provider,
        "model": model,
        "input_files": context["source_files"],
        "fallback": provider == "fallback",
        "prompt_schema": "terminal_x_daily_theme_v1",
    }
    if fallback_reason:
        meta["fallback_reason"] = fallback_reason

    return {
        "layer": "integrated",
        "title": {"ko": "AI 통합 브리핑", "en": "AI Integrated Briefing"},
        "summary": {"ko": summary_stack, "en": summary_stack},
        "paragraphs": {"ko": paragraphs_ko, "en": paragraphs_ko},
        "warnings": {"ko": warnings_ko, "en": warnings_ko},
        "highlights": {"ko": highlights, "en": highlights},
        "sources": sources,
        "provider": provider,
        "model": model,
        "generated_at": context["generated_at"],
        "asof_day": context["asof_day"],
        "summary_stack": summary_stack,
        "ai_brief": payload.get("ai_brief", {}),
        "stance": {
            "stance": stance_label,
            "action": stance_action,
            "exposure": stance_exposure,
        },
        "agent_thinking": thinking,
        "_meta": meta,
    }


def _normalized_layer(raw: Optional[Dict[str, Any]], layer: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    title = raw.get("title") or fallback["title"]
    summary = raw.get("summary") or fallback["summary"]
    paragraphs = raw.get("paragraphs") or fallback["paragraphs"]
    warnings = raw.get("warnings") or fallback["warnings"]
    highlights = raw.get("highlights") or fallback["highlights"]
    return {
        "layer": layer,
        "title": {
            "ko": _text(_pick(title, "ko")) or fallback["title"]["ko"],
            "en": _text(_pick(title, "en")) or fallback["title"]["en"],
        },
        "summary": {
            "ko": _text(_pick(summary, "ko")) or fallback["summary"]["ko"],
            "en": _text(_pick(summary, "en")) or fallback["summary"]["en"],
        },
        "paragraphs": {
            "ko": _listify(_pick(paragraphs, "ko") if isinstance(paragraphs, dict) else paragraphs, "ko") or fallback["paragraphs"]["ko"],
            "en": _listify(_pick(paragraphs, "en") if isinstance(paragraphs, dict) else paragraphs, "en") or fallback["paragraphs"]["en"],
        },
        "warnings": {
            "ko": _listify(_pick(warnings, "ko") if isinstance(warnings, dict) else warnings, "ko") or fallback["warnings"]["ko"],
            "en": _listify(_pick(warnings, "en") if isinstance(warnings, dict) else warnings, "en") or fallback["warnings"]["en"],
        },
        "highlights": {
            "ko": _listify(_pick(highlights, "ko") if isinstance(highlights, dict) else highlights, "ko") or fallback["highlights"]["ko"],
            "en": _listify(_pick(highlights, "en") if isinstance(highlights, dict) else highlights, "en") or fallback["highlights"]["en"],
        },
        "sources": raw.get("sources") if isinstance(raw.get("sources"), list) else [],
        "provider": _text(raw.get("provider") or fallback["provider"], fallback["provider"]),
        "model": _text(raw.get("model") or fallback["model"], fallback["model"]),
        "generated_at": _text(raw.get("generated_at") or fallback["generated_at"], fallback["generated_at"]),
        "asof_day": _text(raw.get("asof_day") or raw.get("asof_date") or fallback["asof_day"], fallback["asof_day"]),
        "_meta": raw.get("_meta") if isinstance(raw.get("_meta"), dict) else {"fallback": False},
    }


def _default_output(layer: str, context: Dict[str, Any]) -> Dict[str, Any]:
    defaults = _section_defaults(layer, context)
    return {
        "layer": layer,
        "title": defaults["title"],
        "summary": defaults["summary"],
        "paragraphs": defaults["paragraphs"],
        "warnings": defaults["warnings"],
        "highlights": defaults["highlights"],
        "sources": [],
        "provider": "fallback",
        "model": "rules",
        "generated_at": context["generated_at"],
        "asof_day": context["asof_day"],
        "_meta": {
            "slot": context["slot"],
            "generated_at": context["generated_at"],
            "asof_day": context["asof_day"],
            "provider": "fallback",
            "model": "rules",
            "input_files": context["source_files"],
            "fallback": True,
        },
    }


def _legacy_briefing(integrated: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    content_lines = [
        "# Integrated Briefing",
        "",
        "## Summary",
        integrated["summary"]["en"] or integrated["summary"]["ko"],
        "",
        "## Key Points",
        *[f"- {line}" for line in integrated["paragraphs"]["en"]],
        "",
        "## Warnings",
        *[f"- {line}" for line in integrated["warnings"]["en"]],
    ]
    return {
        "timestamp": context["generated_at"],
        "generated_at": context["generated_at"],
        "asof_day": context["asof_day"],
        "slot": context["slot"],
        "summary": integrated["summary"]["en"] or integrated["summary"]["ko"],
        "content": "\n".join(content_lines).strip() + "\n",
        "model": integrated["model"],
        "api_used": integrated["provider"],
        "title": integrated["title"]["en"] or integrated["title"]["ko"],
        "paragraphs": integrated["paragraphs"],
        "warnings": integrated["warnings"],
        "highlights": integrated["highlights"],
        "layer": "integrated",
    }


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.remove(tmp_name)
            except Exception:
                pass


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Build cached AI briefings.")
    parser.add_argument("--slot", default="", help="Schedule label: preopen, morning, close, or manual.")
    args = parser.parse_args(argv)

    context = _load_context()
    slot = (args.slot or "").strip().lower() or _current_briefing_slot()
    context["slot"] = slot
    pipeline = os.getenv("AI_BRIEF_PIPELINE", "legacy").strip().lower()

    print(
        f"[AIBriefings] slot={slot} asof={context['asof_day']} files={len(context['source_files'])} pipeline={pipeline}",
        flush=True,
    )

    parsed: Optional[Dict[str, Any]] = None
    provider_name = "fallback"
    model_name = "rules"
    fallback_reason: Optional[str] = None
    langgraph_error: Optional[str] = None

    # Stage 2 experimental route: LangGraph pipeline with automatic fallback.
    if pipeline == "langgraph":
        try:
            from services.langgraph_daily_brief import generate_daily_brief_with_langgraph

            parsed = generate_daily_brief_with_langgraph(query="오늘 미국 증시 요약해줘", context=context)
            provider_name = _text(parsed.get("_provider"), "openai")
            model_name = _text(parsed.get("_model"), "gpt-4o-mini")
            print(f"[AIBriefings] langgraph provider={provider_name} model={model_name}", flush=True)
        except Exception as exc:
            langgraph_error = _sanitize_error(exc)
            print(f"[AIBriefings] langgraph fallback: {langgraph_error}", flush=True)

    # Stage 1 stable route (legacy prompt + existing providers).
    if parsed is None:
        provider_choice = _provider_choice()
        system, user = _build_prompt(context)

        try:
            if provider_choice == AIProvider.GPT:
                text, model_name = _call_openai(system, user)
                provider_name = "gpt"
            elif provider_choice == AIProvider.GEMINI:
                text, model_name = _call_gemini(system, user)
                provider_name = "gemini"
            else:
                text = ""
                fallback_reason = "No provider key found"
            if text:
                parsed = _extract_json(text)
        except Exception as exc:
            parsed = None
            fallback_reason = _sanitize_error(exc)

    if fallback_reason:
        print(f"[AIBriefings] fallback: {fallback_reason}", flush=True)
        provider_name = "fallback"
        model_name = "rules"
    else:
        print(f"[AIBriefings] provider={provider_name} model={model_name}", flush=True)

    outputs: Dict[str, Dict[str, Any]] = {}
    daily_payload = _normalize_daily_payload(parsed if isinstance(parsed, dict) else None, context)

    for layer in LAYERS:
        if layer == "integrated":
            outputs[layer] = _daily_payload_to_layer(
                daily_payload,
                context=context,
                provider=provider_name,
                model=model_name,
                slot=slot,
                fallback_reason=fallback_reason,
            )
        else:
            fallback = _default_output(layer, context)
            raw = parsed.get(layer) if isinstance(parsed, dict) else None
            outputs[layer] = _normalized_layer(raw if isinstance(raw, dict) else None, layer, fallback)

        outputs[layer]["provider"] = provider_name
        outputs[layer]["model"] = model_name
        outputs[layer]["generated_at"] = context["generated_at"]
        outputs[layer]["asof_day"] = context["asof_day"]
        existing_meta = outputs[layer].get("_meta") if isinstance(outputs[layer].get("_meta"), dict) else {}
        merged_meta = {
            "slot": slot,
            "generated_at": context["generated_at"],
            "asof_day": context["asof_day"],
            "provider": provider_name,
            "model": model_name,
            "input_files": context["source_files"],
            "fallback": provider_name == "fallback",
        }
        merged_meta.update(existing_meta)
        if fallback_reason:
            merged_meta["fallback_reason"] = fallback_reason
        if langgraph_error:
            merged_meta["langgraph_error"] = langgraph_error
        merged_meta["pipeline"] = pipeline
        outputs[layer]["_meta"] = merged_meta

    for layer in LAYERS:
        _write_json(AI_DIR / layer / "latest.json", outputs[layer])
    _write_json(OUTPUT_DIR / "briefing.json", _legacy_briefing(outputs["integrated"], context))

    print("[AIBriefings] wrote ai/std_risk/latest.json, ai/macro/latest.json, ai/integrated/latest.json, briefing.json", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
