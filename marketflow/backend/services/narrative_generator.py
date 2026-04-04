from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional

try:
    from backend.ai.ai_router import generate_text
    from backend.ai.providers import AIProvider
    from backend.utils.prompt_loader import get_engine_knowledge, get_narrative_templates
except Exception:
    from ai.ai_router import generate_text  # type: ignore
    from ai.providers import AIProvider  # type: ignore
    from utils.prompt_loader import get_engine_knowledge, get_narrative_templates  # type: ignore


logger = logging.getLogger(__name__)


REFERENCE_ORDER = (
    "transmission_map",
    "track_b_velocity",
    "track_a_credit",
    "track_c_event",
    "mss_engine",
)


BRIEFING_SCHEMA = {
    "main_theme": "string",
    "sub_themes": ["string", "string", "string"],
    "interpretation": "string",
    "action": "string",
    "tqqq": "string",
}

WATCHLIST_ITEM_SCHEMA = {
    "symbol": "string",
    "summary": "string",
    "context": "string",
    "significance": "string",
    "action": "string",
    "tqqq": "string",
}

PORTFOLIO_SCHEMA = {
    "summary": "string",
    "structure": "string",
    "risk": "string",
    "alignment": "string",
    "action": "string",
    "tqqq": "string",
}


SYSTEM_PROMPT = (
    "You are a MarketFlow narrative generator.\n"
    "Use the supplied engine knowledge and narrative template as authoritative instructions.\n"
    "Keep the analysis structure-first, MSS + Track grounded, and free of return-based judgment.\n"
    "Do not use praise like good, fine, or promising.\n"
    "Return only valid JSON. No markdown fences, no commentary, and no extra keys unless requested in the schema.\n"
    "Write the narrative text in Korean unless a ticker or proper noun requires English."
)


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _strip_fences(text: str) -> str:
    clean = (text or "").strip()
    clean = re.sub(r"^```(?:json)?\s*", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\s*```$", "", clean)
    return clean.strip()


def _parse_json_payload(text: str) -> Any:
    clean = _strip_fences(text)
    if not clean:
        raise ValueError("empty LLM response")

    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for start in (clean.find("{"), clean.find("[")):
        if start < 0:
            continue
        fragment = clean[start:].strip()
        try:
            return json.loads(fragment)
        except json.JSONDecodeError:
            try:
                parsed, _ = decoder.raw_decode(fragment)
                return parsed
            except Exception:
                continue

    raise ValueError("LLM response did not contain valid JSON")


def _coerce_dict(value: Any, label: str) -> Dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    raise TypeError(f"{label} must be a dict")


def _coerce_list(value: Any, label: str) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"{label} must be a list")


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _ensure_str_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [_safe_str(item) for item in value if _safe_str(item)]
    if isinstance(value, tuple):
        return [_safe_str(item) for item in list(value) if _safe_str(item)]
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    return [_safe_str(value)] if _safe_str(value) else []


def _symbol_from_payload(payload: Dict[str, Any], fallback: str = "") -> str:
    symbol = payload.get("symbol") or payload.get("ticker") or payload.get("name") or fallback
    return _safe_str(symbol, fallback).upper()


def _build_engine_knowledge_text() -> str:
    knowledge = get_engine_knowledge()
    blocks: List[str] = []
    for key in REFERENCE_ORDER:
        text = _safe_str(knowledge.get(key))
        if text:
            blocks.append(f"--- {key} ---\n{text}")
    return "\n\n".join(blocks)


def _build_template_text(template_key: str) -> str:
    templates = get_narrative_templates()
    if template_key not in templates:
        raise KeyError(f"Unknown narrative template: {template_key}")
    return _safe_str(templates[template_key])


def _build_prompt(
    *,
    template_key: str,
    input_label: str,
    input_payload: Any,
    output_schema: Any,
    extra_rules: List[str],
) -> str:
    sections = [
        "Use the references below as authoritative instructions.",
        "Follow the requested output schema exactly and return only valid JSON.",
        "",
        "[ENGINE KNOWLEDGE]",
        _build_engine_knowledge_text(),
        "",
        "[NARRATIVE TEMPLATE]",
        _build_template_text(template_key),
        "",
        f"[{input_label}]",
        _json_text(input_payload),
        "",
        "[OUTPUT SCHEMA]",
        _json_text(output_schema),
        "",
        "[RULES]",
    ]
    sections.extend(f"- {rule}" for rule in extra_rules)
    return "\n".join(sections).strip()


def _call_structured_llm(
    *,
    task: str,
    prompt: str,
    max_tokens: int,
) -> Any:
    last_error = ""
    for provider in (AIProvider.GPT, AIProvider.GEMINI):
        try:
            result = generate_text(
                task=task,
                system=SYSTEM_PROMPT,
                user=prompt,
                temperature=0.2,
                max_tokens=max_tokens,
                provider=provider,
            )
        except Exception as exc:
            last_error = str(exc)
            logger.warning("narrative_generator task=%s provider=%s error=%s", task, provider.value, last_error)
            continue

        if result.error:
            last_error = result.error
            logger.warning("narrative_generator task=%s provider=%s error=%s", task, provider.value, last_error)
            continue

        try:
            return _parse_json_payload(result.text)
        except Exception as exc:
            last_error = str(exc)
            logger.warning("narrative_generator task=%s provider=%s parse_error=%s", task, provider.value, last_error)

    if last_error:
        logger.warning("narrative_generator task=%s fell back to input-derived output: %s", task, last_error)
    return None


def _portfolio_fallback(portfolio_data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "summary": _safe_str(
            portfolio_data.get("summary")
            or portfolio_data.get("classification")
            or portfolio_data.get("main_theme")
        ),
        "structure": _safe_str(portfolio_data.get("structure") or portfolio_data.get("allocation")),
        "risk": _safe_str(portfolio_data.get("risk") or portfolio_data.get("risk_concentration")),
        "alignment": _safe_str(portfolio_data.get("alignment") or portfolio_data.get("market_alignment")),
        "action": _safe_str(portfolio_data.get("action") or portfolio_data.get("guidance")),
        "tqqq": _safe_str(portfolio_data.get("tqqq") or portfolio_data.get("leverage")),
    }


def _briefing_fallback(engine_data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "main_theme": _safe_str(engine_data.get("main_theme") or engine_data.get("summary") or engine_data.get("theme")),
        "sub_themes": _ensure_str_list(
            engine_data.get("sub_themes")
            or engine_data.get("subthemes")
            or engine_data.get("themes")
        ),
        "interpretation": _safe_str(engine_data.get("interpretation") or engine_data.get("analysis")),
        "action": _safe_str(engine_data.get("action") or engine_data.get("guidance")),
        "tqqq": _safe_str(engine_data.get("tqqq") or engine_data.get("leverage")),
    }


def _watchlist_fallback_item(stock: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "symbol": _symbol_from_payload(stock),
        "summary": _safe_str(stock.get("summary") or stock.get("name") or stock.get("headline")),
        "context": _safe_str(stock.get("context") or stock.get("market_context")),
        "significance": _safe_str(stock.get("significance") or stock.get("type") or stock.get("classification")),
        "action": _safe_str(stock.get("action") or stock.get("guidance")),
        "tqqq": _safe_str(stock.get("tqqq") or stock.get("leverage")),
    }


def _normalize_briefing_output(data: Any, engine_data: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(data, dict) and isinstance(data.get("briefing"), dict):
        data = data["briefing"]
    if not isinstance(data, dict):
        data = {}

    fallback = _briefing_fallback(engine_data)
    return {
        "main_theme": _safe_str(data.get("main_theme"), fallback["main_theme"]),
        "sub_themes": _ensure_str_list(data.get("sub_themes")) or fallback["sub_themes"],
        "interpretation": _safe_str(data.get("interpretation"), fallback["interpretation"]),
        "action": _safe_str(data.get("action"), fallback["action"]),
        "tqqq": _safe_str(data.get("tqqq"), fallback["tqqq"]),
    }


def _normalize_watchlist_output(data: Any, stock_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: List[Any]
    if isinstance(data, dict):
        if isinstance(data.get("watchlist"), list):
            items = data["watchlist"]
        elif isinstance(data.get("items"), list):
            items = data["items"]
        elif all(key in data for key in ("symbol", "summary", "context", "significance", "action", "tqqq")):
            items = [data]
        else:
            items = []
    elif isinstance(data, list):
        items = data
    else:
        items = []

    parsed_by_symbol: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in items:
        if isinstance(item, dict):
            parsed_by_symbol[_symbol_from_payload(item)].append(item)

    normalized: List[Dict[str, Any]] = []
    for stock in stock_data:
        symbol = _symbol_from_payload(stock)
        candidate = None
        if parsed_by_symbol.get(symbol):
            candidate = parsed_by_symbol[symbol].pop(0)
        elif parsed_by_symbol.get(""):
            candidate = parsed_by_symbol[""].pop(0)
        elif isinstance(data, dict) and all(key in data for key in ("symbol", "summary", "context", "significance", "action", "tqqq")):
            candidate = data

        source_fallback = _watchlist_fallback_item(stock)
        candidate = candidate or {}
        normalized.append(
            {
                "symbol": _safe_str(candidate.get("symbol"), source_fallback["symbol"]),
                "summary": _safe_str(
                    candidate.get("summary")
                    or candidate.get("signal")
                    or candidate.get("main_theme"),
                    source_fallback["summary"],
                ),
                "context": _safe_str(candidate.get("context"), source_fallback["context"]),
                "significance": _safe_str(
                    candidate.get("significance")
                    or candidate.get("type")
                    or candidate.get("classification"),
                    source_fallback["significance"],
                ),
                "action": _safe_str(candidate.get("action") or candidate.get("guidance"), source_fallback["action"]),
                "tqqq": _safe_str(candidate.get("tqqq") or candidate.get("leverage"), source_fallback["tqqq"]),
            }
        )

    return normalized


def _normalize_portfolio_output(data: Any, portfolio_data: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(data, dict) and isinstance(data.get("portfolio"), dict):
        data = data["portfolio"]
    if not isinstance(data, dict):
        data = {}

    fallback = _portfolio_fallback(portfolio_data)
    summary = _safe_str(data.get("summary"), fallback["summary"])
    if not summary:
        summary = _safe_str(data.get("main_theme"), fallback["summary"])

    return {
        "summary": summary,
        "structure": _safe_str(data.get("structure"), fallback["structure"]),
        "risk": _safe_str(data.get("risk"), fallback["risk"]),
        "alignment": _safe_str(data.get("alignment"), fallback["alignment"]),
        "action": _safe_str(data.get("action"), fallback["action"]),
        "tqqq": _safe_str(data.get("tqqq"), fallback["tqqq"]),
    }


def generate_briefing(engine_data: dict) -> dict:
    """
    Load engine knowledge + briefing template, combine with engine data, call the LLM,
    and return a normalized briefing narrative payload.
    """

    engine_data = _coerce_dict(engine_data, "engine_data")
    prompt = _build_prompt(
        template_key="briefing_v1",
        input_label="ENGINE DATA",
        input_payload=engine_data,
        output_schema=BRIEFING_SCHEMA,
        extra_rules=[
            "Return a JSON object with keys main_theme, sub_themes, interpretation, action, and tqqq.",
            "sub_themes must contain 3 to 4 concise strings.",
            "Keep the narrative structure-first and MSS + Track anchored.",
            "Do not use return-based performance analysis.",
        ],
    )
    data = _call_structured_llm(task="narrative_briefing", prompt=prompt, max_tokens=1400)
    return _normalize_briefing_output(data, engine_data)


def generate_watchlist(stock_data: list, engine_data: dict) -> list:
    """
    Load engine knowledge + watchlist template, combine each stock with engine data,
    and return a list of per-symbol narrative payloads in input order.
    """

    engine_data = _coerce_dict(engine_data, "engine_data")
    stock_items = [_coerce_dict(item, "stock_data item") for item in _coerce_list(stock_data, "stock_data")]
    prompt = _build_prompt(
        template_key="watchlist_v1",
        input_label="STOCK DATA",
        input_payload={"engine_data": engine_data, "stock_data": stock_items},
        output_schema=[WATCHLIST_ITEM_SCHEMA],
        extra_rules=[
            "Return a JSON array of objects, one object per input symbol, in the same order as the input list.",
            "Each object must contain symbol, summary, context, significance, action, and tqqq.",
            "significance should make the TYPE 1 / TYPE 2 / TYPE 3 / TYPE 4 structure explicit when relevant.",
            "Keep the explanation structural and avoid return-based analysis.",
        ],
    )
    data = _call_structured_llm(task="narrative_watchlist", prompt=prompt, max_tokens=max(1400, 320 * max(len(stock_items), 1)))
    return _normalize_watchlist_output(data, stock_items)


def generate_portfolio(portfolio_data: dict, engine_data: dict) -> dict:
    """
    Load engine knowledge + portfolio template, combine portfolio data with engine data,
    and return a normalized portfolio narrative payload.
    """

    engine_data = _coerce_dict(engine_data, "engine_data")
    portfolio_data = _coerce_dict(portfolio_data, "portfolio_data")
    prompt = _build_prompt(
        template_key="portfolio_v1",
        input_label="PORTFOLIO DATA",
        input_payload={"engine_data": engine_data, "portfolio_data": portfolio_data},
        output_schema=PORTFOLIO_SCHEMA,
        extra_rules=[
            "Return a JSON object with keys summary, structure, risk, alignment, action, and tqqq.",
            "The summary must explicitly classify the portfolio as Aligned, Overexposed, Fragile, or Defensive.",
            "Use structure-based analysis only and keep MSS + Track linkage explicit.",
            "Do not use return-based analysis or optimistic commentary.",
        ],
    )
    data = _call_structured_llm(task="narrative_portfolio", prompt=prompt, max_tokens=1200)
    return _normalize_portfolio_output(data, portfolio_data)


__all__ = [
    "generate_briefing",
    "generate_watchlist",
    "generate_portfolio",
]
