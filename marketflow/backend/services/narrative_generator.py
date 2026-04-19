from __future__ import annotations

import json
import logging
import math
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from backend.ai.ai_router import generate_text
    from backend.ai.providers import AIProvider
    from backend.services.data_contract import artifact_path, live_db_path
    from backend.utils.prompt_loader import get_engine_knowledge, get_narrative_templates
except Exception:
    from ai.ai_router import generate_text  # type: ignore
    from ai.providers import AIProvider  # type: ignore
    from services.data_contract import artifact_path, live_db_path  # type: ignore
    from utils.prompt_loader import get_engine_knowledge, get_narrative_templates  # type: ignore

try:
    from backend.scripts.symbol_registry import (  # type: ignore
        INDEX_SYMBOLS as INDEX_ETF_SYMBOLS,
        LEVERAGE_SYMBOLS as LEVERAGE_ETF_SYMBOLS,
        SECTOR_SYMBOLS as SECTOR_ETF_SYMBOLS,
    )
except Exception:
    try:
        from scripts.symbol_registry import (  # type: ignore
            INDEX_SYMBOLS as INDEX_ETF_SYMBOLS,
            LEVERAGE_SYMBOLS as LEVERAGE_ETF_SYMBOLS,
            SECTOR_SYMBOLS as SECTOR_ETF_SYMBOLS,
        )
    except Exception:
        INDEX_ETF_SYMBOLS = {
            "SPY",
            "QQQ",
            "IWM",
            "DIA",
            "VTI",
            "VOO",
            "QQQM",
            "SCHB",
            "SCHX",
            "SCHA",
            "ITOT",
            "VO",
            "VB",
            "VUG",
            "VTV",
            "VBK",
            "VBR",
            "MGK",
            "IJR",
        }
        SECTOR_ETF_SYMBOLS = {
            "XLK",
            "XLF",
            "XLE",
            "XLI",
            "XLV",
            "XLY",
            "XLP",
            "XLU",
            "XLB",
            "XLC",
            "XLRE",
            "SMH",
            "SOXX",
            "KRE",
            "IBB",
            "XBI",
        }
        LEVERAGE_ETF_SYMBOLS = {
            "TQQQ",
            "SOXL",
            "SPXL",
            "TECL",
            "FNGU",
            "UPRO",
            "UDOW",
            "TNA",
            "LABU",
            "UYG",
        }


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

ACCOUNT_MANAGER_SCHEMA = {
    "headline": "string",
    "daily_brief": "string",
    "stock_focus": [{"symbol": "string", "type": "string", "summary": "string"}],
    "portfolio_structure": "string",
    "watchlist_insight": "string",
    "action_advice": "string",
    "risk_flags": ["string"],
}

PORTFOLIO_SCHEMA = ACCOUNT_MANAGER_SCHEMA
PORTFOLIO_STOCK_FOCUS_MAX_ITEMS = 10


ACCOUNT_MANAGER_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "daily_brief": {"type": "string"},
        "stock_focus": {
            "type": "array",
            "minItems": 1,
            "maxItems": PORTFOLIO_STOCK_FOCUS_MAX_ITEMS,
            "items": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "type": {"type": "string"},
                    "summary": {"type": "string"},
                },
                "required": ["symbol", "type", "summary"],
                "additionalProperties": False,
            },
        },
        "portfolio_structure": {"type": "string"},
        "watchlist_insight": {"type": "string"},
        "action_advice": {"type": "string"},
        "risk_flags": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": [
        "headline",
        "daily_brief",
        "stock_focus",
        "portfolio_structure",
        "watchlist_insight",
        "action_advice",
        "risk_flags",
    ],
    "additionalProperties": False,
}


SYSTEM_PROMPT = (
    "You are a MarketFlow account portfolio manager.\n"
    "Use the supplied engine knowledge and narrative template as authoritative instructions.\n"
    "Keep the analysis structure-first, account-aware, and grounded in quant evidence.\n"
    "Do not compute raw numbers in prose. Use the provided metrics and explain what they mean.\n"
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


def _safe_float(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return num if math.isfinite(num) else None
    if isinstance(value, str):
        text = value.strip().replace(",", "").replace("%", "").replace("$", "")
        if not text:
            return None
        try:
            num = float(text)
        except ValueError:
            match = re.search(r"[-+]?\d*\.?\d+", text.replace("−", "-"))
            if not match:
                return None
            try:
                num = float(match.group(0))
            except ValueError:
                return None
        return num if math.isfinite(num) else None
    return None


def _normalize_position_payload(position: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(position, dict):
        return {}

    symbol = _safe_str(
        position.get("symbol")
        or position.get("ticker")
        or position.get("종목")
        or position.get("티커")
    )
    name = _safe_str(position.get("name") or position.get("한국증시") or symbol)

    normalized = dict(position)
    if symbol:
        normalized["symbol"] = symbol
    if name:
        normalized["name"] = name

    mapping = {
        "equity": ("equity", "평가액"),
        "market_value": ("market_value", "평가액"),
        "value": ("value", "평가액"),
        "total": ("total", "평가액"),
        "position_value": ("position_value", "평가액"),
        "buy_total": ("buy_total", "매수총액"),
        "cost_basis": ("cost_basis", "매수총액"),
        "invested": ("invested", "매수총액"),
        "total_cost": ("total_cost", "매수총액"),
        "today_close": ("today_close", "오늘"),
        "current_price": ("current_price", "오늘"),
        "close": ("close", "오늘"),
        "avg_cost": ("avg_cost", "평단가"),
        "avg_price": ("avg_price", "평단가"),
        "change_pct": ("change_pct", "변동(%)"),
        "daily_change_pct": ("daily_change_pct", "변동(%)"),
        "chg_pct": ("chg_pct", "변동(%)"),
        "pnl_today": ("pnl_today", "오늘 수익"),
        "today_pnl": ("today_pnl", "오늘 수익"),
        "day_pnl": ("day_pnl", "오늘 수익"),
        "delta": ("delta", "오늘 수익"),
        "pl": ("pl", "오늘 수익"),
        "profit_today": ("profit_today", "오늘 수익"),
        "cum_return_pct": ("cum_return_pct", "누적수익률(%)"),
        "total_return_pct": ("total_return_pct", "누적수익률(%)"),
        "return_pct": ("return_pct", "누적수익률(%)"),
        "pl_pct": ("pl_pct", "누적수익률(%)"),
        "position_pct": ("position_pct", "포지션(%)"),
        "pct": ("pct", "포지션(%)"),
        "weight": ("weight", "포지션(%)"),
        "shares": ("shares", "주식수"),
        "rsi": ("rsi", "RSI"),
        "volume_k": ("volume_k", "Volume (K)"),
        "mdd_pct": ("mdd_pct", "MDD"),
        "ma5": ("ma5", "MA(5)"),
        "ma120": ("ma120", "MA(120)"),
        "ma200": ("ma200", "MA(200)"),
    }

    for target_key, source_key in mapping.values():
        if source_key in position and target_key not in normalized:
            normalized[target_key] = position.get(source_key)

    normalized["symbol"] = symbol or name
    normalized["name"] = name or symbol

    return normalized


def _contains_text(value: Any, needle: str) -> bool:
    if not needle:
        return False
    target = needle.lower()
    if isinstance(value, dict):
        return any(_contains_text(key, needle) or _contains_text(item, needle) for key, item in value.items())
    if isinstance(value, (list, tuple, set)):
        return any(_contains_text(item, needle) for item in value)
    return target in _safe_str(value).lower()


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


def _preview_text(value: Any, limit: int = 600) -> str:
    text = _safe_str(value)
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def _symbol_from_payload(payload: Dict[str, Any], fallback: str = "") -> str:
    symbol = payload.get("symbol") or payload.get("ticker") or payload.get("name") or fallback
    return _safe_str(symbol, fallback).upper()


def _load_artifact_json(relative_path: str) -> Any:
    path = artifact_path(relative_path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _load_latest_ticker_brief(symbol: str) -> Any:
    symbol = _safe_str(symbol).upper()
    if not symbol:
        return None
    brief_dir = artifact_path(f"cache/ticker_briefs/{symbol}")
    if not brief_dir.exists() or not brief_dir.is_dir():
        return None
    for brief_path in sorted(brief_dir.glob("*.json"), reverse=True):
        try:
            return json.loads(brief_path.read_text(encoding="utf-8"))
        except Exception:
            continue
    return None


def _build_spy_benchmark_context() -> Dict[str, Any]:
    market_data = _load_artifact_json("market_data.json") or {}
    indices = market_data.get("indices") if isinstance(market_data, dict) else {}
    spy = _coerce_dict(indices.get("SPY"), "market_data.indices.SPY") if isinstance(indices, dict) else {}
    return {
        "symbol": "SPY",
        "name": _safe_str(spy.get("name"), "S&P 500"),
        "price": _safe_float(spy.get("price")),
        "daily_change_pct": _safe_float(spy.get("change_pct")),
        "as_of": _safe_str(market_data.get("timestamp") or market_data.get("date")),
        "source": "market_data.json",
    }


def _build_spy_relative_view(
    *,
    change_pct: Optional[float],
    benchmark: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    benchmark = benchmark or {}
    benchmark_symbol = _safe_str(benchmark.get("symbol"), "SPY") or "SPY"
    benchmark_change_pct = _safe_float(benchmark.get("daily_change_pct"))
    if change_pct is None or benchmark_change_pct is None:
        return {
            "benchmark_symbol": benchmark_symbol,
            "benchmark_change_pct": benchmark_change_pct,
            "vs_spy_daily_pct": None,
            "vs_spy_status": "unknown",
            "vs_spy_note": "",
        }

    delta = round(change_pct - benchmark_change_pct, 2)
    if delta >= 0.5:
        status = "above"
        note = f"{benchmark_symbol}보다 위에서 노는 중"
    elif delta <= -0.5:
        status = "below"
        note = f"{benchmark_symbol}보다 아래에서 헤매는 중"
    else:
        status = "aligned"
        note = f"{benchmark_symbol}와 비슷한 흐름"

    return {
        "benchmark_symbol": benchmark_symbol,
        "benchmark_change_pct": benchmark_change_pct,
        "vs_spy_daily_pct": delta,
        "vs_spy_status": status,
        "vs_spy_note": f"{benchmark_symbol} {benchmark_change_pct:+.2f}% 대비 {delta:+.2f}pp, {note}",
    }


def _sqlite_query_dicts(db_path: Path, sql: str, params: tuple[Any, ...] = ()) -> List[Dict[str, Any]]:
    if not db_path.exists():
        return []
    try:
        with sqlite3.connect(str(db_path)) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, params).fetchall()
            return [dict(row) for row in rows]
    except Exception as exc:
        logger.warning("sqlite query failed path=%s sql=%s error=%s", db_path, sql, exc)
        return []


def _normalize_symbol_set(values: Any) -> set[str]:
    items = _ensure_str_list(values)
    return {item.upper() for item in items if item}


def _load_universe_symbol_meta() -> Dict[str, Dict[str, Any]]:
    rows = _sqlite_query_dicts(
        live_db_path(),
        "SELECT symbol, name, sector, industry, exchange, market_cap FROM universe_symbols WHERE symbol IS NOT NULL AND TRIM(symbol) <> ''",
    )
    meta: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        symbol = _symbol_from_payload(row)
        if not symbol:
            continue
        meta[symbol] = {
            "symbol": symbol,
            "name": _safe_str(row.get("name")),
            "sector": _safe_str(row.get("sector")),
            "industry": _safe_str(row.get("industry")),
            "exchange": _safe_str(row.get("exchange")),
            "market_cap": _safe_float(row.get("market_cap")),
        }
    return meta


def _load_watchlist_rows() -> List[Dict[str, Any]]:
    rows = _sqlite_query_dicts(
        live_db_path(),
        "SELECT symbol, label, created_at FROM watchlist_symbols WHERE symbol IS NOT NULL AND TRIM(symbol) <> '' ORDER BY created_at DESC, id DESC",
    )
    return [
        {
            "symbol": _symbol_from_payload(row),
            "label": _safe_str(row.get("label")),
            "created_at": _safe_str(row.get("created_at")),
        }
        for row in rows
        if _symbol_from_payload(row)
    ]


def _lookup_sector(symbol: str, symbol_meta: Dict[str, Dict[str, Any]]) -> str:
    if not symbol:
        return ""
    meta = symbol_meta.get(symbol.upper()) or {}
    return _safe_str(meta.get("sector"))


def _position_equity(position: Dict[str, Any]) -> float:
    for key in ("equity", "market_value", "value", "total", "position_value"):
        value = _safe_float(position.get(key))
        if value is not None:
            return max(0.0, value)
    shares = _safe_float(position.get("shares"))
    price = _safe_float(position.get("today_close") or position.get("current_price") or position.get("close"))
    if shares is not None and price is not None:
        return max(0.0, shares * price)
    return 0.0


def _position_cost(position: Dict[str, Any]) -> float:
    for key in ("buy_total", "cost_basis", "invested", "total_cost"):
        value = _safe_float(position.get(key))
        if value is not None:
            return max(0.0, value)
    return 0.0


def _position_pct(position: Dict[str, Any], total_equity: Optional[float]) -> float:
    value = _safe_float(position.get("position_pct") or position.get("pct") or position.get("weight"))
    if value is not None and value > 0:
        return value if value <= 1 else value
    equity = _position_equity(position)
    if total_equity and total_equity > 0 and equity > 0:
        return (equity / total_equity) * 100
    return 0.0


def _position_day_pnl(position: Dict[str, Any]) -> float:
    for key in ("pnl_today", "today_pnl", "day_pnl", "delta", "pl", "profit_today"):
        value = _safe_float(position.get(key))
        if value is not None:
            return value
    return 0.0


def _position_return_pct(position: Dict[str, Any]) -> float:
    for key in ("cum_return_pct", "total_return_pct", "return_pct", "pl_pct"):
        value = _safe_float(position.get(key))
        if value is not None:
            return value
    cost = _position_cost(position)
    pnl = _position_day_pnl(position)
    if cost > 0 and pnl:
        return (pnl / cost) * 100
    return 0.0


def _split_sentences(text: str) -> List[str]:
    if not text:
        return []
    parts = re.split(r"(?<=[.!?。])\s+|[\n•◦·]+", text)
    return [part.strip(" -\t\r\n") for part in parts if part and part.strip(" -\t\r\n")]


def _sentiment_from_text(text: str) -> str:
    lowered = text.lower()
    positive = ("beat", "rally", "rise", "up", "strong", "support", "optimism", "growth", "gain", "advance")
    negative = ("drop", "fall", "warn", "threat", "risk", "slow", "weak", "decline", "cut", "concern")
    if any(term in lowered for term in positive):
        return "positive"
    if any(term in lowered for term in negative):
        return "negative"
    return "neutral"


def _build_account_portfolio_snapshot(
    portfolio_data: Dict[str, Any],
    positions: List[Dict[str, Any]],
    symbol_meta: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    summary = _coerce_dict(portfolio_data.get("summary"), "portfolio_data.summary") if portfolio_data.get("summary") else {}
    total_equity = _safe_float(
        summary.get("total_equity")
        or summary.get("total_value")
        or summary.get("account_total")
        or portfolio_data.get("total_equity")
        or portfolio_data.get("total_value")
    )
    total_cost = _safe_float(
        summary.get("total_cost")
        or summary.get("total_invested")
        or portfolio_data.get("total_cost")
        or portfolio_data.get("total_invested")
    )
    total_pnl = _safe_float(
        summary.get("total_pnl")
        or summary.get("cum_pnl_usd")
        or portfolio_data.get("total_pnl")
    )
    today_pnl = _safe_float(
        summary.get("today_pnl")
        or summary.get("day_pnl")
        or portfolio_data.get("today_pnl")
    )
    total_pnl_pct = _safe_float(summary.get("total_pnl_pct") or portfolio_data.get("total_pnl_pct"))
    if total_pnl_pct is None and total_cost not in (None, 0) and total_pnl is not None:
        total_pnl_pct = (total_pnl / total_cost) * 100 if total_cost else None
    cash = _safe_float(summary.get("cash") or summary.get("cash_balance") or portfolio_data.get("cash"))
    cash_weight = None
    if cash is not None and total_equity and total_equity > 0:
        cash_weight = (cash / total_equity) * 100

    enriched_positions: List[Dict[str, Any]] = []
    for position in positions:
        symbol = _symbol_from_payload(position)
        weight_pct = _position_pct(position, total_equity)
        equity = _position_equity(position)
        cost = _position_cost(position)
        day_pnl = _position_day_pnl(position)
        return_pct = _position_return_pct(position)
        meta = symbol_meta.get(symbol, {})
        sector = _safe_str(position.get("sector") or meta.get("sector"))
        leverage_flag = symbol in LEVERAGE_ETF_SYMBOLS or _contains_text(position, "leverage")
        index_flag = symbol in INDEX_ETF_SYMBOLS
        enriched_positions.append(
            {
                "symbol": symbol,
                "name": _safe_str(position.get("name") or meta.get("name")),
                "sector": sector,
                "weight": round(weight_pct, 2) if weight_pct else 0.0,
                "equity": round(equity, 2),
                "cost_basis": round(cost, 2),
                "daily_pnl": round(day_pnl, 2),
                "daily_change_pct": _safe_float(position.get("change_pct") or position.get("daily_change_pct") or position.get("chg_pct")),
                "return_pct": round(return_pct, 2),
                "rsi": _safe_float(position.get("rsi")),
                "volume_k": _safe_float(position.get("volume_k")),
                "mdd_pct": _safe_float(position.get("mdd_pct")),
                "ma5": _safe_float(position.get("ma5")),
                "ma120": _safe_float(position.get("ma120")),
                "ma200": _safe_float(position.get("ma200")),
                "is_leverage": leverage_flag,
                "is_index": index_flag,
            }
        )

    enriched_positions.sort(key=lambda item: item.get("weight", 0.0), reverse=True)
    top_positions = enriched_positions[:8]
    top_weight = top_positions[0] if top_positions else {}
    top3_weight = round(sum(item.get("weight", 0.0) for item in enriched_positions[:3]), 2)
    leverage_weight = round(sum(item.get("weight", 0.0) for item in enriched_positions if item.get("is_leverage")), 2)

    sector_counter: Dict[str, float] = defaultdict(float)
    sector_symbols: Dict[str, List[str]] = defaultdict(list)
    for item in enriched_positions:
        sector = item.get("sector") or "Unknown"
        sector_counter[sector] += item.get("weight", 0.0) or 0.0
        if item.get("symbol"):
            sector_symbols[sector].append(item["symbol"])

    sector_exposure = [
        {
            "sector": sector,
            "weight": round(weight, 2),
            "symbols": sector_symbols.get(sector, [])[:5],
        }
        for sector, weight in sorted(sector_counter.items(), key=lambda kv: kv[1], reverse=True)
        if weight > 0
    ]

    return {
        "total_value": total_equity,
        "total_cost": total_cost,
        "daily_pnl": today_pnl,
        "daily_pnl_pct": _safe_float(portfolio_data.get("today_pnl_pct") or summary.get("today_pnl_pct")),
        "total_pnl": total_pnl,
        "total_pnl_pct": total_pnl_pct,
        "cash": cash,
        "cash_weight": cash_weight,
        "position_count": len(enriched_positions),
        "top_position": top_weight,
        "top3_weight": top3_weight,
        "leverage_exposure_weight": leverage_weight,
        "sector_exposure": sector_exposure[:6],
        "positions": top_positions,
    }


def _build_portfolio_daily_change(positions: List[Dict[str, Any]]) -> Dict[str, Any]:
    ranked_by_pnl = sorted(positions, key=lambda item: _position_day_pnl(item), reverse=True)
    ranked_by_change = sorted(
        positions,
        key=lambda item: _safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")) or 0.0,
        reverse=True,
    )
    top_contributors = [
        {
            "symbol": _symbol_from_payload(item),
            "daily_pnl": round(_position_day_pnl(item), 2),
            "daily_change_pct": _safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")),
        }
        for item in ranked_by_pnl
        if _position_day_pnl(item) > 0
    ][:3]
    top_detractors = [
        {
            "symbol": _symbol_from_payload(item),
            "daily_pnl": round(_position_day_pnl(item), 2),
            "daily_change_pct": _safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")),
        }
        for item in sorted(positions, key=lambda item: _position_day_pnl(item))
        if _position_day_pnl(item) < 0
    ][:3]
    daily_strength = [
        {
            "symbol": _symbol_from_payload(item),
            "change_pct": _safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")),
            "rsi": _safe_float(item.get("rsi")),
        }
        for item in ranked_by_change
        if (_safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")) or 0) > 0
    ][:5]
    daily_weakness = [
        {
            "symbol": _symbol_from_payload(item),
            "change_pct": _safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")),
            "rsi": _safe_float(item.get("rsi")),
        }
        for item in sorted(positions, key=lambda item: _safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")) or 0.0)
        if (_safe_float(item.get("change_pct") or item.get("daily_change_pct") or item.get("chg_pct")) or 0) < 0
    ][:5]
    return {
        "top_contributors": top_contributors,
        "top_detractors": top_detractors,
        "daily_strength": daily_strength,
        "daily_weakness": daily_weakness,
    }


def _build_watchlist_snapshot(symbol_meta: Dict[str, Dict[str, Any]], portfolio_symbols: set[str]) -> Dict[str, Any]:
    watchlist_rows = _load_watchlist_rows()
    action_snapshot = _load_artifact_json("cache/action_snapshot.json") or {}
    moves = _coerce_list(action_snapshot.get("watchlist_moves"), "watchlist_moves")
    moves_by_symbol: Dict[str, Dict[str, Any]] = {}
    for move in moves:
        if isinstance(move, dict):
            symbol = _symbol_from_payload(move)
            if symbol:
                moves_by_symbol[symbol] = {
                    "symbol": symbol,
                    "name": _safe_str(move.get("name")),
                    "chg_pct": _safe_float(move.get("chg_pct")),
                    "badge": _safe_str(move.get("badge")),
                    "badge_reason": _safe_str(move.get("badge_reason")),
                }

    symbols = []
    for row in watchlist_rows:
        symbol = row["symbol"]
        meta = symbol_meta.get(symbol, {})
        item = {
            "symbol": symbol,
            "name": _safe_str(meta.get("name") or row.get("label") or symbol),
            "label": _safe_str(row.get("label")),
            "sector": _safe_str(meta.get("sector")),
            "watchlist_move": moves_by_symbol.get(symbol),
            "portfolio_overlap": symbol in portfolio_symbols,
        }
        symbols.append(item)

    focus: List[Dict[str, Any]] = []
    for symbol in list(moves_by_symbol.keys())[:5]:
        item = moves_by_symbol[symbol]
        item["sector"] = _safe_str(symbol_meta.get(symbol, {}).get("sector"))
        item["portfolio_overlap"] = symbol in portfolio_symbols
        focus.append(item)

    return {
        "symbols": symbols[:20],
        "moves": list(moves_by_symbol.values())[:10],
        "focus": focus,
    }


def _build_index_summary() -> List[Dict[str, Any]]:
    tape = _load_artifact_json("cache/market_tape.json") or {}
    items = tape.get("items") if isinstance(tape, dict) else []
    by_symbol = {(_symbol_from_payload(item) if isinstance(item, dict) else ""): item for item in items if isinstance(item, dict)}
    overview = _load_artifact_json("cache/overview.json") or {}
    market_state = _load_artifact_json("cache/market_state.json") or {}
    result: List[Dict[str, Any]] = []
    for symbol, label in (("QQQ", "NASDAQ 100"), ("SPY", "S&P 500"), ("DIA", "Dow Jones"), ("IWM", "Russell 2000"), ("VIX", "Volatility"), ("US10Y", "10Y Treasury"), ("DXY", "Dollar Index")):
        item = by_symbol.get(symbol) or {}
        result.append(
            {
                "symbol": symbol,
                "name": label,
                "last": _safe_float(item.get("last")),
                "daily_change_pct": _safe_float(item.get("chg_pct") or item.get("change_pct")),
                "sparkline": _coerce_list(item.get("spark_1d"), f"{symbol}.spark_1d"),
                "comment": "risk_on" if symbol in {"QQQ", "SPY", "IWM"} and (_safe_float(item.get("chg_pct") or item.get("change_pct")) or 0) > 0 else "",
            }
        )
    result.append(
        {
            "symbol": "REGIME",
            "name": "Market Regime",
            "phase": _safe_str(market_state.get("phase", {}).get("value") if isinstance(market_state.get("phase"), dict) else overview.get("market_phase")),
            "gate_score": _safe_float(market_state.get("gate", {}).get("value") if isinstance(market_state.get("gate"), dict) else overview.get("gate_score")),
            "risk_level": _safe_str(market_state.get("risk", {}).get("value") if isinstance(market_state.get("risk"), dict) else overview.get("risk_level")),
            "trend": _safe_str(market_state.get("trend", {}).get("value") if isinstance(market_state.get("trend"), dict) else overview.get("trend_state")),
            "comment": f"QQQ {(_safe_float(overview.get('pct_from_sma200')) or 0):.2f}% from SMA200; gate {(_safe_float(overview.get('gate_score')) or 0):.1f}",
        }
    )
    return result


def _build_sector_summary(positions: List[Dict[str, Any]], symbol_meta: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    performance = _load_artifact_json("sector_performance.json") or {}
    sector_rows = performance.get("sectors") if isinstance(performance, dict) else []
    market_leaders = []
    market_laggards = []
    normalized_rows: List[Dict[str, Any]] = []
    for row in sector_rows if isinstance(sector_rows, list) else []:
        if not isinstance(row, dict):
            continue
        normalized_rows.append(
            {
                "symbol": _safe_str(row.get("symbol")),
                "name": _safe_str(row.get("name")),
                "daily_change_pct": _safe_float(row.get("change_1d")),
                "week_change_pct": _safe_float(row.get("change_1w")),
                "month_change_pct": _safe_float(row.get("change_1m")),
                "quarter_change_pct": _safe_float(row.get("change_3m")),
            }
        )
    normalized_rows.sort(key=lambda item: item.get("daily_change_pct") or 0.0, reverse=True)
    market_leaders = normalized_rows[:4]
    market_laggards = list(reversed(normalized_rows[-4:])) if normalized_rows else []

    exposure_counter: Dict[str, float] = defaultdict(float)
    for position in positions:
        symbol = _symbol_from_payload(position)
        sector = _lookup_sector(symbol, symbol_meta) or _safe_str(position.get("sector")) or "Unknown"
        weight = _safe_float(position.get("weight") or position.get("position_pct") or position.get("pct"))
        if weight is None:
            weight = _position_pct(position, None)
        exposure_counter[sector] += weight or 0.0
    portfolio_exposure = [
        {"sector": sector, "weight": round(weight, 2)}
        for sector, weight in sorted(exposure_counter.items(), key=lambda kv: kv[1], reverse=True)
        if weight > 0
    ]
    return {
        "portfolio_exposure": portfolio_exposure[:8],
        "market_leaders": market_leaders,
        "market_laggards": market_laggards,
    }


def _build_symbol_news(portfolio_symbols: set[str], watchlist_symbols: set[str], sector_summary: Dict[str, Any]) -> List[Dict[str, Any]]:
    today = datetime.now().strftime("%Y-%m-%d")
    direct_news: List[Dict[str, Any]] = []
    for symbol in sorted(portfolio_symbols):
        brief = _load_latest_ticker_brief(symbol) or _load_artifact_json(f"cache/ticker_briefs/{symbol}/{today}.json") or {}
        events = brief.get("events") or []
        for evt in events[:3]:
            hl = _safe_str(evt.get("headline"))
            if not hl:
                continue
            direct_news.append({
                "symbol": symbol,
                "symbols": [symbol],
                "headline": hl,
                "publisher": _safe_str(evt.get("source")),
                "published_at": _safe_str(evt.get("publishedAt") or evt.get("timeET")),
                "summary": _safe_str(evt.get("headline")),
                "sentiment": _safe_str(evt.get("sentiment"), "neutral"),
                "importance": "high",
                "reason_relevance": "direct_ticker",
            })
    news = _load_artifact_json("cache/context_news.json") or {}
    articles = news.get("articles") if isinstance(news, dict) else []
    focus_symbols = {symbol.upper() for symbol in portfolio_symbols.union(watchlist_symbols) if symbol}
    selected: List[Dict[str, Any]] = []
    for article in articles if isinstance(articles, list) else []:
        if not isinstance(article, dict):
            continue
        tickers = {str(t).upper() for t in _coerce_list(article.get("tickers"), "article.tickers") if _safe_str(t)}
        text = f"{_safe_str(article.get('title'))} {_safe_str(article.get('summary'))}"
        sentiment = _sentiment_from_text(text)
        relevance = "macro_context"
        importance = "medium"
        matched = sorted((tickers & focus_symbols) or set())
        if matched:
            relevance = "largest_position" if any(symbol in portfolio_symbols for symbol in matched) else "watchlist_overlap"
            importance = "high" if any(symbol in portfolio_symbols for symbol in matched) else "medium"
        elif any(term in text.lower() for term in ("nasdaq", "qqq", "semiconductor", "fed", "rates", "powell")):
            relevance = "market_context"
        if matched or relevance != "macro_context":
            selected.append(
                {
                    "symbol": matched[0] if matched else "",
                    "symbols": matched,
                    "headline": _safe_str(article.get("title")),
                    "publisher": _safe_str(article.get("publisher")),
                    "published_at": _safe_str(article.get("published_at")),
                    "summary": _safe_str(article.get("summary")),
                    "sentiment": sentiment,
                    "importance": importance,
                    "reason_relevance": relevance,
                }
            )
    if not selected:
        brief = news.get("news_brief") if isinstance(news, dict) else {}
        if isinstance(brief, dict) and brief:
            selected.append(
                {
                    "symbol": "",
                    "symbols": [],
                    "headline": _safe_str(brief.get("headline")),
                    "publisher": "",
                    "published_at": _safe_str(news.get("date")),
                    "summary": _safe_str(brief.get("summary_2sentences")),
                    "sentiment": "neutral",
                    "importance": "medium",
                    "reason_relevance": "macro_context",
                }
            )
    if direct_news:
        selected = [item for item in selected if _safe_str(item.get("reason_relevance")) != "macro_context"]
    combined = direct_news + selected
    return combined[:8]


def _build_holdings_items(
    positions: List[Dict[str, Any]],
    symbol_meta: Dict[str, Dict[str, Any]],
    total_equity: Optional[float],
    benchmark: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    holdings: List[Dict[str, Any]] = []
    benchmark = benchmark or _build_spy_benchmark_context()
    for position in positions:
        symbol = _symbol_from_payload(position)
        if not symbol:
            continue
        meta = symbol_meta.get(symbol, {})
        weight = _position_pct(position, total_equity)
        current_price = _safe_float(position.get("today_close") or position.get("current_price") or position.get("close"))
        avg_price = _safe_float(position.get("avg_cost") or position.get("avg_price"))
        change_pct = _safe_float(position.get("change_pct") or position.get("daily_change_pct") or position.get("chg_pct"))
        spy_relative_view = _build_spy_relative_view(change_pct=change_pct, benchmark=benchmark)
        contribution_today = None
        if total_equity and total_equity > 0:
            contribution_today = round((_position_day_pnl(position) / total_equity) * 100, 2)
        trend_5d = "mixed"
        ma5 = _safe_float(position.get("ma5"))
        ma120 = _safe_float(position.get("ma120"))
        ma200 = _safe_float(position.get("ma200"))
        rsi = _safe_float(position.get("rsi"))
        if change_pct is not None:
            if change_pct >= 1.5 and (ma5 is None or ma120 is None or ma5 >= ma120):
                trend_5d = "strong_uptrend"
            elif change_pct >= 0.3:
                trend_5d = "uptrend"
            elif change_pct <= -1.0:
                trend_5d = "weakening"
            elif change_pct < 0:
                trend_5d = "pullback"
        if rsi is not None and rsi >= 70:
            trend_5d = "overbought"
        if ma5 is not None and ma120 is not None and ma5 < ma120 and change_pct is not None and change_pct < 0:
            trend_5d = "downtrend"
        holdings.append(
            {
                "symbol": symbol,
                "weight": round(weight, 2),
                "daily_change_pct": change_pct,
                "total_return_pct": _position_return_pct(position),
                "contribution_today": contribution_today,
                "is_leverage": symbol in LEVERAGE_ETF_SYMBOLS or _contains_text(position, "leverage"),
                "sector": _safe_str(position.get("sector") or meta.get("sector")),
                "trend_5d": trend_5d,
                "avg_price": avg_price,
                "current_price": current_price,
                "avg_cost": avg_price,
                "rsi": rsi,
                "volume_k": _safe_float(position.get("volume_k")),
                "mdd_pct": _safe_float(position.get("mdd_pct")),
                "ma5": ma5,
                "ma120": ma120,
                "ma200": ma200,
                "note": _safe_str(position.get("note")),
                "name": _safe_str(position.get("name") or meta.get("name")),
                "benchmark": spy_relative_view,
                "benchmark_symbol": spy_relative_view.get("benchmark_symbol"),
                "benchmark_change_pct": spy_relative_view.get("benchmark_change_pct"),
                "vs_spy_daily_pct": spy_relative_view.get("vs_spy_daily_pct"),
                "vs_spy_status": spy_relative_view.get("vs_spy_status"),
                "vs_spy_note": spy_relative_view.get("vs_spy_note"),
            }
        )

    holdings.sort(key=lambda item: item.get("weight", 0.0), reverse=True)
    return holdings


def _build_account_manager_input(portfolio_data: Dict[str, Any], engine_data: Dict[str, Any]) -> Dict[str, Any]:
    raw_positions = _coerce_list(portfolio_data.get("positions"), "portfolio_data.positions")
    if not raw_positions:
        raw_positions = _coerce_list(portfolio_data.get("holdings"), "portfolio_data.holdings")
    positions = [_normalize_position_payload(_coerce_dict(item, "portfolio_data.positions item")) for item in raw_positions]
    symbol_meta = _load_universe_symbol_meta()
    snapshot = _build_account_portfolio_snapshot(portfolio_data, positions, symbol_meta)
    benchmark = _coerce_dict(
        portfolio_data.get("market_reference") or engine_data.get("market_reference"),
        "market_reference",
    )
    if not benchmark:
        benchmark = _build_spy_benchmark_context()
    benchmark_symbol = _safe_str(benchmark.get("symbol"), "SPY") or "SPY"
    benchmark_change_pct = _safe_float(benchmark.get("daily_change_pct"))
    if benchmark_symbol.upper() != "SPY" and benchmark_change_pct is not None:
        benchmark = {
            **benchmark,
            "symbol": benchmark_symbol.upper(),
        }
    holdings = _build_holdings_items(positions, symbol_meta, snapshot.get("total_value"), benchmark)
    portfolio_symbols = {item.get("symbol", "") for item in holdings if item.get("symbol")}
    watchlist_rows = _load_watchlist_rows()
    watchlist_symbols = {row["symbol"] for row in watchlist_rows}

    index_summary = _build_index_summary()
    sector_summary = _build_sector_summary(holdings, symbol_meta)
    symbol_news = _build_symbol_news(portfolio_symbols, watchlist_symbols, sector_summary)
    direct_symbol_news = [item for item in symbol_news if _safe_str(item.get("reason_relevance")) == "direct_ticker"]
    market_symbol_news = [item for item in symbol_news if _safe_str(item.get("reason_relevance")) != "direct_ticker"]
    watchlist_snapshot = _build_watchlist_snapshot(symbol_meta, portfolio_symbols)
    portfolio_daily_change = _build_portfolio_daily_change(positions)

    today = _safe_str(
        engine_data.get("today")
        or engine_data.get("date")
        or portfolio_data.get("as_of_date")
        or portfolio_data.get("date")
        or snapshot.get("as_of_date")
    )
    last_visit_days = _safe_float(engine_data.get("last_visit_days_ago") or engine_data.get("days_since_last_visit"))
    mode = _safe_str(engine_data.get("mode") or engine_data.get("visit_mode") or ("daily" if (last_visit_days is None or last_visit_days <= 3) else "return"), "daily")

    cash_weight_pct = snapshot.get("cash_weight")
    top3_weight_pct = snapshot.get("top3_weight")
    leverage_weight_pct = snapshot.get("leverage_exposure_weight")

    risk_style = _safe_str(engine_data.get("risk_style"))
    if not risk_style:
        if leverage_weight_pct is not None and leverage_weight_pct >= 10 or top3_weight_pct is not None and top3_weight_pct >= 65:
            risk_style = "aggressive"
        elif cash_weight_pct is not None and cash_weight_pct >= 20:
            risk_style = "defensive"
        else:
            risk_style = "balanced"

    user_profile = {
        "risk_style": risk_style,
        "investment_horizon": _safe_str(engine_data.get("investment_horizon"), "medium_long"),
        "preferred_tone": _safe_str(engine_data.get("preferred_tone"), "professional_human"),
        "last_visit_days_ago": int(last_visit_days) if last_visit_days is not None else None,
    }

    visit_context = {
        "mode": mode,
        "today": today or _safe_str(portfolio_data.get("as_of_date")),
        "tab_name": _safe_str(engine_data.get("tab_name")) or None,
        "needs_daily_brief": mode == "daily",
        "needs_structure_review": mode != "daily" or (last_visit_days is not None and last_visit_days > 3),
    }

    portfolio_snapshot = {
        "total_value": snapshot.get("total_value"),
        "cash_weight_pct": cash_weight_pct,
        "cash_weight_ratio": round((cash_weight_pct or 0) / 100.0, 4) if cash_weight_pct is not None else None,
        "daily_pnl_pct": snapshot.get("daily_pnl_pct"),
        "total_pnl_pct": snapshot.get("total_pnl_pct"),
        "top_position": snapshot.get("top_position"),
        "top3_weight_pct": top3_weight_pct,
        "top3_weight_ratio": round((top3_weight_pct or 0) / 100.0, 4) if top3_weight_pct is not None else None,
        "leverage_exposure_weight_pct": leverage_weight_pct,
        "leverage_exposure_weight_ratio": round((leverage_weight_pct or 0) / 100.0, 4) if leverage_weight_pct is not None else None,
        "sector_exposure": sector_summary.get("portfolio_exposure", []),
        "position_count": snapshot.get("position_count"),
        "benchmark": benchmark,
        "top_contributors": portfolio_daily_change.get("top_contributors", []),
        "top_detractors": portfolio_daily_change.get("top_detractors", []),
        "daily_strength": portfolio_daily_change.get("daily_strength", []),
        "daily_weakness": portfolio_daily_change.get("daily_weakness", []),
    }

    return {
        "tab_name": _safe_str(engine_data.get("tab_name")) or None,
        "user_profile": user_profile,
        "visit_context": visit_context,
        "portfolio_snapshot": portfolio_snapshot,
        "portfolio_daily_change": {
            **portfolio_daily_change,
            "daily_pnl": snapshot.get("daily_pnl"),
            "daily_pnl_pct": snapshot.get("daily_pnl_pct"),
            "top_contributors": portfolio_daily_change.get("top_contributors", []),
            "top_detractors": portfolio_daily_change.get("top_detractors", []),
        },
        "holdings": holdings,
        "watchlist_snapshot": watchlist_snapshot,
        "watchlist": watchlist_snapshot.get("symbols", []),
        "index_summary": index_summary,
        "sector_summary": sector_summary,
        "symbol_news": symbol_news,
        "news_meta": {
            "news_first": True,
            "direct_ticker_count": len(direct_symbol_news),
            "market_context_count": len(market_symbol_news),
        },
        "analysis_meta": {
            "as_of_date": today,
            "position_count": len(holdings),
            "portfolio_symbols": sorted(portfolio_symbols),
            "watchlist_symbols": sorted(watchlist_symbols),
            "benchmark_symbol": benchmark.get("symbol"),
        },
    }


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
    providers: Optional[tuple[AIProvider, ...]] = None,
    output_schema: Any = None,
    output_tool_name: str = "return_json",
) -> Any:
    last_error = ""
    provider_order = providers or (AIProvider.GPT, AIProvider.CLAUDE)
    for provider in provider_order:
        try:
            result = generate_text(
                task=task,
                system=SYSTEM_PROMPT,
                user=prompt,
                temperature=0.2,
                max_tokens=max_tokens,
                provider=provider,
                output_schema=output_schema,
                output_tool_name=output_tool_name,
            )
        except Exception as exc:
            last_error = str(exc)
            logger.warning("narrative_generator task=%s provider=%s error=%s", task, provider.value, last_error)
            continue

        if result.error:
            last_error = result.error
            logger.warning("narrative_generator task=%s provider=%s error=%s", task, provider.value, last_error)
            continue

        if task == "narrative_portfolio":
            logger.warning(
                "narrative_generator task=%s provider=%s raw_preview=%s",
                task,
                provider.value,
                _preview_text(result.text, 1200),
            )

        try:
            parsed = _parse_json_payload(result.text)
            if task == "narrative_portfolio":
                if isinstance(parsed, dict):
                    parsed.setdefault("__llm_provider", provider.value)
                    logger.info(
                        "narrative_generator task=%s provider=%s parsed_keys=%s",
                        task,
                        provider.value,
                        sorted(parsed.keys()),
                    )
                else:
                    logger.info(
                        "narrative_generator task=%s provider=%s parsed_type=%s",
                        task,
                        provider.value,
                        type(parsed).__name__,
                    )
            return parsed
        except Exception as exc:
            last_error = str(exc)
            logger.warning("narrative_generator task=%s provider=%s parse_error=%s", task, provider.value, last_error)

    if last_error:
        logger.warning("narrative_generator task=%s fell back to input-derived output: %s", task, last_error)
    return None


def _account_manager_fallback(account_data: Dict[str, Any], engine_data: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = _coerce_dict(account_data.get("portfolio_snapshot"), "portfolio_snapshot")
    holdings = _coerce_list(account_data.get("holdings"), "holdings")
    watchlist = _coerce_list(account_data.get("watchlist_snapshot", {}).get("focus"), "watchlist focus")
    sector_summary = _coerce_dict(account_data.get("sector_summary"), "sector_summary")
    symbol_news = _coerce_list(account_data.get("symbol_news"), "symbol_news")
    benchmark = _coerce_dict(snapshot.get("benchmark"), "benchmark")

    news_by_symbol: Dict[str, Dict[str, Any]] = {}
    for news in symbol_news:
        if not isinstance(news, dict):
            continue
        symbol = _safe_str(news.get("symbol")).upper()
        headline = _safe_str(news.get("headline"))
        if symbol and headline and symbol not in news_by_symbol:
            news_by_symbol[symbol] = news

    top_position = _coerce_dict(snapshot.get("top_position"), "top_position")
    top_symbol = _safe_str(top_position.get("symbol"))
    top_weight = _safe_float(top_position.get("weight")) or 0.0
    top3_weight = _safe_float(snapshot.get("top3_weight_pct") or snapshot.get("top3_weight")) or 0.0
    leverage_weight = _safe_float(snapshot.get("leverage_exposure_weight_pct") or snapshot.get("leverage_exposure_weight")) or 0.0
    cash_weight = _safe_float(snapshot.get("cash_weight_pct") or snapshot.get("cash_weight"))
    benchmark_symbol = _safe_str(benchmark.get("symbol"), "SPY") or "SPY"
    benchmark_change_pct = _safe_float(benchmark.get("daily_change_pct"))
    daily_pnl = _safe_float(snapshot.get("daily_pnl"))
    daily_pnl_pct = _safe_float(snapshot.get("daily_pnl_pct"))

    if top3_weight >= 65 or top_weight >= 45 or leverage_weight >= 12:
        classification = "Fragile"
    elif top3_weight >= 45 or leverage_weight >= 6:
        classification = "Overexposed"
    elif cash_weight is not None and cash_weight >= 20:
        classification = "Defensive"
    else:
        classification = "Aligned"

    headline = f"{classification}:"
    if top_symbol:
        headline += f" {top_symbol} is the largest holding at {top_weight:.1f}%."
    if leverage_weight > 0:
        headline += f" Leverage exposure is {leverage_weight:.1f}% of the book."
    if cash_weight is not None:
        headline += f" Cash weight is {cash_weight:.1f}%."
    headline = headline.strip()

    daily_brief_bits = []
    if top_symbol and top_symbol.upper() in news_by_symbol:
        top_news = news_by_symbol[top_symbol.upper()]
        top_news_headline = _safe_str(top_news.get("headline"))
        if top_news_headline:
            daily_brief_bits.append(f"{top_symbol}: {top_news_headline}.")
    if daily_pnl is not None:
        if daily_pnl_pct is not None:
            daily_brief_bits.append(f"Today PnL is {daily_pnl:,.2f} ({daily_pnl_pct:+.2f}%).")
        else:
            daily_brief_bits.append(f"Today PnL is {daily_pnl:,.2f}.")
    if not daily_brief_bits and benchmark_change_pct is not None:
        daily_brief_bits.append(f"{benchmark_symbol} is {benchmark_change_pct:+.2f}% today.")
    daily_brief = " ".join(daily_brief_bits).strip() or "Read the account symbol by symbol; the structure is concentrated."

    focus_items: List[Dict[str, Any]] = []
    for item in holdings[:PORTFOLIO_STOCK_FOCUS_MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        symbol = _safe_str(item.get("symbol"))
        weight = _safe_float(item.get("weight")) or 0.0
        return_pct = _safe_float(item.get("total_return_pct"))
        change_pct = _safe_float(item.get("daily_change_pct"))
        daily_pnl_item = _safe_float(item.get("daily_pnl"))
        relative_note = _safe_str(item.get("vs_spy_note") or _coerce_dict(item.get("benchmark"), "holding benchmark").get("vs_spy_note"))
        news_item = news_by_symbol.get(symbol.upper()) if symbol else None
        news_headline = _safe_str(news_item.get("headline")) if news_item else ""
        news_summary = _safe_str(news_item.get("summary")) if news_item else ""

        kind = "risk"
        if item.get("is_leverage"):
            kind = "opportunity_with_caution"
        elif return_pct is not None and return_pct > 100:
            kind = "trend_driver"
        elif weight >= 30 or (symbol and symbol == top_symbol):
            kind = "risk"

        summary_bits = [f"{symbol} at {weight:.1f}%."]
        if change_pct is not None:
            summary_bits.append(f"Today {change_pct:+.2f}%.")
        if daily_pnl_item is not None:
            summary_bits.append(f"PnL {daily_pnl_item:+,.2f}.")
        if return_pct is not None:
            summary_bits.append(f"Total {return_pct:+.1f}%.")
        if news_headline:
            summary_bits.append(f"News: {news_headline}.")
        elif news_summary:
            summary_bits.append(f"News: {news_summary}.")
        if relative_note:
            summary_bits.append(relative_note)
        elif change_pct is not None and benchmark_change_pct is not None:
            delta = change_pct - benchmark_change_pct
            relation = "above SPY" if delta >= 0 else "below SPY"
            summary_bits.append(f"SPY spread {delta:+.2f}pp, {relation}.")

        focus_items.append({
            "symbol": symbol,
            "type": kind,
            "summary": " ".join(summary_bits).strip(),
        })

    if not focus_items and top_symbol:
        focus_items.append({
            "symbol": top_symbol,
            "type": "risk",
            "summary": f"{top_symbol} is the main concentration point and should be managed first.",
        })

    structure_bits = []
    if top_symbol:
        structure_bits.append(f"Top holding {top_symbol} at {top_weight:.1f}%.")
    if top3_weight:
        structure_bits.append(f"Top 3 holdings at {top3_weight:.1f}%.")
    if leverage_weight:
        structure_bits.append(f"Leverage exposure at {leverage_weight:.1f}%.")
    if cash_weight is not None:
        structure_bits.append(f"Cash weight at {cash_weight:.1f}%.")
    if sector_summary.get("portfolio_exposure"):
        first_sector = _coerce_dict(sector_summary["portfolio_exposure"][0], "sector exposure")
        if first_sector:
            structure_bits.append(f"Top sector {_safe_str(first_sector.get('sector'))} at {(_safe_float(first_sector.get('weight')) or 0):.1f}%.")
    portfolio_structure = " ".join(structure_bits).strip() or "The book is concentrated and should be managed symbol by symbol."

    watchlist_items = _coerce_list(account_data.get("watchlist_snapshot", {}).get("focus"), "watchlist focus")
    watchlist_text_parts = []
    for item in watchlist_items[:3]:
        if not isinstance(item, dict):
            continue
        symbol = _safe_str(item.get("symbol"))
        badge = _safe_str(item.get("badge") or item.get("watchlist_move", {}).get("badge"))
        reason = _safe_str(item.get("badge_reason") or item.get("watchlist_move", {}).get("badge_reason"))
        part = " ".join(p for p in (symbol, badge, reason) if p).strip()
        if part:
            watchlist_text_parts.append(part)
    if not watchlist_text_parts and watchlist:
        watchlist_text_parts = [_safe_str(item.get("symbol")) for item in watchlist[:3] if _safe_str(item.get("symbol"))]
    watchlist_insight = "; ".join(watchlist_text_parts).strip() or "Watchlist should be used as a comparison set, not as a reason to add risk blindly."

    if classification == "Fragile":
        action_advice = "Trim the largest position first, keep leverage separate, and only add risk after concentration falls."
    elif classification == "Overexposed":
        action_advice = "Rebalance the biggest sleeve, preserve cash, and wait for a cleaner setup before expanding."
    elif classification == "Defensive":
        action_advice = "Keep the defensive tilt, preserve the cash buffer, and let the market prove the next entry."
    else:
        action_advice = "Hold the structure, use watchlist names as comparison points, and avoid forcing new risk too early."

    risk_flags = []
    if top3_weight >= 65 or top_weight >= 35:
        risk_flags.append("single_stock_concentration")
    if top3_weight >= 45:
        risk_flags.append("top3_concentration")
    if leverage_weight > 0:
        risk_flags.append("leveraged_etf_exposure")
    if cash_weight is None or cash_weight < 10:
        risk_flags.append("low_cash_buffer")
    if sector_summary.get("portfolio_exposure"):
        top_sector = _coerce_dict(sector_summary["portfolio_exposure"][0], "sector exposure")
        if (_safe_float(top_sector.get("weight")) or 0) >= 35:
            risk_flags.append("sector_concentration")
    if symbol_news:
        risk_flags.append("news_sensitive")

    risk_sentence = " ".join(
        [
            f"Top concentration is {top_symbol} at {top_weight:.1f}%." if top_symbol else "The main risk is concentration in a few positions.",
            f"Top 3 concentration is {top3_weight:.1f}%." if top3_weight else "",
            f"Leverage exposure is {leverage_weight:.1f}%." if leverage_weight else "",
            f"Cash weight is {cash_weight:.1f}%." if cash_weight is not None else "",
        ]
    ).strip()
    alignment_sentence = " ".join(
        [
            f"{benchmark_symbol} {benchmark_change_pct:+.2f}% today." if benchmark_change_pct is not None else "",
            "Keep the tactical sleeve separate from the core." if leverage_weight > 0 else "",
        ]
    ).strip()

    return {
        "headline": headline,
        "daily_brief": daily_brief,
        "stock_focus": focus_items,
        "portfolio_structure": portfolio_structure,
        "watchlist_insight": watchlist_insight,
        "action_advice": action_advice,
        "risk_flags": risk_flags or ["monitor_concentration"],
        "footerLabel": "RISK FLAGS" if risk_flags else "WATCHLIST",
        "summary": headline,
        "main_theme": headline,
        "sub_themes": [daily_brief] + [item["summary"] for item in focus_items[:3]],
        "structure": portfolio_structure,
        "risk": risk_sentence or portfolio_structure,
        "alignment": alignment_sentence or portfolio_structure,
        "action": action_advice,
        "tqqq": watchlist_insight,
        "classification": classification,
        "badge": classification,
    }


def _portfolio_headline_from_output(data: Dict[str, Any], fallback: Dict[str, Any], engine_data: Dict[str, Any]) -> str:
    headline = _safe_str(data.get("headline"))
    if headline and not headline.startswith(("Fragile:", "Overexposed:", "Defensive:")):
        return headline

    stock_focus_items = data.get("stock_focus")
    if not isinstance(stock_focus_items, list) or not stock_focus_items:
        stock_focus_items = fallback.get("stock_focus") or []

    focus_symbols: List[str] = []
    for item in stock_focus_items:
        if not isinstance(item, dict):
            continue
        symbol = _safe_str(item.get("symbol"))
        if symbol and symbol not in focus_symbols:
            focus_symbols.append(symbol)

    top_symbol = _safe_str(engine_data.get("top_weight_symbol"))
    if not top_symbol and focus_symbols:
        top_symbol = focus_symbols[0]

    top_weight = _safe_float(engine_data.get("top_weight_pct"))
    classification = _safe_str(data.get("classification"), fallback.get("classification", ""))
    tone_map = {
        "Fragile": "집중 리스크",
        "Overexposed": "비중 과다",
        "Defensive": "방어적",
        "Aligned": "균형",
    }
    tone = tone_map.get(classification, classification or "포트폴리오")

    if top_symbol and top_weight is not None:
        lead = f"{top_symbol} {top_weight:.1f}%"
    elif focus_symbols:
        lead = "·".join(focus_symbols[:3])
    else:
        lead = "포트폴리오"

    if tone and tone not in lead:
        lead = f"{lead} {tone}"

    tail_source = (
        _safe_str(data.get("daily_brief"))
        or _safe_str(data.get("action_advice"))
        or _safe_str(data.get("portfolio_structure"))
        or _safe_str(fallback.get("daily_brief"))
        or _safe_str(fallback.get("action_advice"))
        or _safe_str(fallback.get("portfolio_structure"))
    )
    tail = _preview_text(tail_source, 120).rstrip(".")
    headline = f"{lead} — {tail}" if tail else lead
    return _preview_text(headline, 180)


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


def _normalize_portfolio_output(data: Any, portfolio_data: Dict[str, Any], engine_data: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(data, dict):
        if isinstance(data.get("account_manager"), dict):
            data = data["account_manager"]
        elif isinstance(data.get("portfolio"), dict):
            data = data["portfolio"]
    if not isinstance(data, dict):
        data = {}

    fallback = _account_manager_fallback(portfolio_data, engine_data)

    stock_focus_items = data.get("stock_focus")
    if not isinstance(stock_focus_items, list):
        stock_focus_items = fallback["stock_focus"]
    normalized_stock_focus: List[Dict[str, Any]] = []
    for item in stock_focus_items:
        if not isinstance(item, dict):
            continue
        normalized_stock_focus.append(
            {
                "symbol": _safe_str(item.get("symbol")),
                "type": _safe_str(item.get("type")) or "risk",
                "summary": _safe_str(item.get("summary")),
            }
        )
    if not normalized_stock_focus:
        normalized_stock_focus = fallback["stock_focus"]

    risk_flags = _ensure_str_list(data.get("risk_flags")) or fallback["risk_flags"]
    headline = _portfolio_headline_from_output(data, fallback, engine_data)
    daily_brief = _safe_str(data.get("daily_brief"), fallback["daily_brief"])
    portfolio_structure = _safe_str(data.get("portfolio_structure"), fallback["portfolio_structure"])
    watchlist_insight = _safe_str(data.get("watchlist_insight"), fallback["watchlist_insight"])
    action_advice = _safe_str(data.get("action_advice"), fallback["action_advice"])
    summary = _safe_str(data.get("summary"), headline) or headline
    if summary.startswith(("Fragile:", "Overexposed:", "Defensive:")):
        summary = headline
    main_theme = _safe_str(data.get("main_theme"), headline) or headline
    if main_theme.startswith(("Fragile:", "Overexposed:", "Defensive:")):
        main_theme = headline

    return {
        "headline": headline,
        "daily_brief": daily_brief,
        "stock_focus": normalized_stock_focus,
        "portfolio_structure": portfolio_structure,
        "watchlist_insight": watchlist_insight,
        "action_advice": action_advice,
        "risk_flags": risk_flags,
        "footerLabel": _safe_str(data.get("footerLabel"), fallback["footerLabel"]),
        "summary": summary,
        "main_theme": main_theme,
        "sub_themes": _ensure_str_list(data.get("sub_themes")) or fallback["sub_themes"],
        "structure": _safe_str(data.get("structure"), fallback["structure"]) or portfolio_structure,
        "risk": _safe_str(data.get("risk"), fallback["risk"]) or portfolio_structure,
        "alignment": _safe_str(data.get("alignment"), fallback["alignment"]) or portfolio_structure,
        "action": _safe_str(data.get("action"), fallback["action"]) or action_advice,
        "tqqq": _safe_str(data.get("tqqq"), fallback["tqqq"]) or watchlist_insight,
        "classification": _safe_str(data.get("classification"), fallback["classification"]),
        "badge": _safe_str(data.get("badge"), fallback["badge"]),
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
    Build the account manager context, call the LLM, and return a normalized portfolio narrative payload.
    """

    engine_data = _coerce_dict(engine_data, "engine_data")
    portfolio_data = _coerce_dict(portfolio_data, "portfolio_data")
    account_input = _build_account_manager_input(portfolio_data, engine_data)
    prompt = _build_prompt(
        template_key="account_manager_v1",
        input_label="ACCOUNT ANALYSIS DATA",
        input_payload=account_input,
        output_schema=ACCOUNT_MANAGER_SCHEMA,
        extra_rules=[
            "Return a JSON object with keys headline, daily_brief, stock_focus, portfolio_structure, watchlist_insight, action_advice, and risk_flags.",
            "If tab_name is present in the input, analyze only that tab and do not mix in other tabs or the aggregate account.",
            "Treat the holdings table as today's selected-tab positions table, not a pooled book from other tabs.",
            "Use symbol_news as the primary evidence. Prefer direct_ticker items over market_context items, and avoid market_context news unless a holding has no direct news at all.",
            f"stock_focus should include up to {PORTFOLIO_STOCK_FOCUS_MAX_ITEMS} symbols from the selected tab. If holdings are fewer than that, cover all holdings.",
            "Make stock_focus the primary narrative. Each stock_focus item should describe one symbol's move, the nearby catalyst or news, and whether it is above SPY, below SPY, or aligned with SPY.",
            "Do not write a chapter-style account overview. Keep daily_brief to one sentence, and keep portfolio_structure and watchlist_insight short enough to read like a terminal note.",
            "If position_count is greater than zero, never describe the account as no holdings or cash-only; headline must anchor on the top holding or dominant risk instead.",
            "Always mention the largest concentration, the strongest daily contributor or detractor, the news tie-in, and the next action.",
            "Do not hide loss leaders or leverage exposure.",
            "Keep the prose professional and actionable. Avoid generic risk warnings without account impact.",
            "Use the user's current tab as a standalone account for the narrative, except for the benchmark comparison to SPY.",
            "Use cash_weight as an actual percentage. Never reinterpret 0.8 as 80.",
        ],
    )
    data = _call_structured_llm(
        task="narrative_portfolio",
        prompt=prompt,
        max_tokens=1800,
        providers=(AIProvider.CLAUDE, AIProvider.GPT),
        output_schema=ACCOUNT_MANAGER_OUTPUT_SCHEMA,
        output_tool_name="return_account_manager_output",
    )
    result = _normalize_portfolio_output(data, account_input, engine_data)
    fallback = _account_manager_fallback(account_input, engine_data)
    llm_provider = _safe_str(data.get("__llm_provider")) if isinstance(data, dict) else ""

    required_keys = ("headline", "daily_brief", "stock_focus", "portfolio_structure", "watchlist_insight", "action_advice", "risk_flags")
    missing_keys = [key for key in required_keys if not result.get(key)]
    if missing_keys:
        raw_keys = sorted(data.keys()) if isinstance(data, dict) else [type(data).__name__]
        logger.warning(
            "narrative_generator portfolio validation failed; missing_keys=%s raw_keys=%s result_keys=%s headline=%s daily_brief=%s llm_provider=%s",
            missing_keys,
            raw_keys,
            sorted(result.keys()),
            _preview_text(result.get("headline")),
            _preview_text(result.get("daily_brief")),
            llm_provider or "unknown",
        )
        merged = dict(result)
        for key in required_keys:
            if not merged.get(key):
                merged[key] = fallback.get(key)
        merged.setdefault("llm_provider", llm_provider or "unknown")
        merged["llm_fallback_keys"] = missing_keys
        result = merged
    elif llm_provider:
        result["llm_provider"] = llm_provider
    return result


__all__ = [
    "generate_briefing",
    "generate_watchlist",
    "generate_portfolio",
]
