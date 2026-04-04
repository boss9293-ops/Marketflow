from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.services.market_snapshot_reader import (
    get_core_price_map,
    get_latest_price,
    get_market_snapshot_for_briefing,
    get_snapshot_age_minutes,
    is_snapshot_stale,
)


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
OUTPUT_DIR = BACKEND_DIR / "output" / "risk"

RISK_SYMBOLS = ("TQQQ", "QQQ")
RISK_CONTEXT_SYMBOLS = ("QQQ", "TQQQ", "SPY", "SOXL", "NVDA", "VIX", "US10Y", "WTI")
ENGINE_REFERENCE_CANDIDATES = (
    BACKEND_DIR / "output" / "risk_v1.json",
    BACKEND_DIR / "output" / "risk_alert.json",
    BACKEND_DIR / "output" / "cache" / "risk_engine.json",
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_json_file(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            text = value.strip().replace("%", "")
            if not text:
                return None
            return float(text)
        return float(value)
    except Exception:
        return None


def _safe_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def _file_mtime_iso(path: Path) -> Optional[str]:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _normalize_state_text(raw: Any) -> str:
    text = _safe_text(raw, "").lower().replace(" ", "_").replace("-", "_")
    if not text:
        return "unknown"

    state_map = {
        "normal": "normal",
        "watch": "caution",
        "caution": "caution",
        "warning": "warning",
        "risk": "warning",
        "high_risk": "high_risk",
        "highrisk": "high_risk",
        "defensive": "high_risk",
        "shock": "crisis",
        "crisis": "crisis",
        "risk_on": "risk_on",
        "risk_off": "risk_off",
        "mixed": "warning",
    }
    return state_map.get(text, text)


def _snapshot_meta(use_cache: bool = True) -> Dict[str, Any]:
    snapshot = get_market_snapshot_for_briefing(use_cache=use_cache)
    meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), dict) else {}
    return {
        "source": meta.get("source") or ("cache" if use_cache else "db"),
        "as_of": meta.get("as_of"),
        "fetched_at": meta.get("fetched_at"),
        "snapshot_age_minutes": get_snapshot_age_minutes(),
        "is_stale": is_snapshot_stale(max_age_minutes=60),
    }


def build_risk_context_map(use_cache: bool = True) -> Dict[str, Dict[str, Any]]:
    price_map = get_core_price_map(use_cache=use_cache)
    context: Dict[str, Dict[str, Any]] = {}
    for symbol in RISK_CONTEXT_SYMBOLS:
        record = price_map.get(symbol)
        if record is not None:
            context[symbol] = copy.deepcopy(record)
    return context


def _context_summary(context_map: Dict[str, Dict[str, Any]]) -> Dict[str, Optional[float]]:
    def _field(symbol: str, key: str) -> Optional[float]:
        record = context_map.get(symbol) or {}
        return _safe_float(record.get(key))

    return {
        "qqq_change_pct": _field("QQQ", "change_pct"),
        "tqqq_change_pct": _field("TQQQ", "change_pct"),
        "spy_change_pct": _field("SPY", "change_pct"),
        "soxl_change_pct": _field("SOXL", "change_pct"),
        "nvda_change_pct": _field("NVDA", "change_pct"),
        "vix_level": _field("VIX", "price"),
        "us10y_level": _field("US10Y", "price"),
        "wti_level": _field("WTI", "price"),
    }


def build_risk_input_for_symbol(
    symbol: str,
    use_cache: bool = True,
    context_map: Optional[Dict[str, Dict[str, Any]]] = None,
    snapshot_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    normalized = _safe_text(symbol, "").upper()
    if not normalized:
        normalized = ""

    if context_map is None:
        context_map = build_risk_context_map(use_cache=use_cache)
    if snapshot_meta is None:
        snapshot_meta = _snapshot_meta(use_cache=use_cache)

    primary = get_latest_price(normalized, use_cache=use_cache) if normalized else None
    primary = copy.deepcopy(primary) if isinstance(primary, dict) else None
    context = copy.deepcopy(context_map)
    context_summary = _context_summary(context_map)
    loaded_context_symbols = sorted(context_map.keys())

    input_loaded = bool(primary and _safe_float(primary.get("price")) is not None)
    data_meta = {
        "snapshot_source": snapshot_meta.get("source"),
        "as_of": snapshot_meta.get("as_of") or (primary.get("as_of") if primary else None),
        "fetched_at": snapshot_meta.get("fetched_at") or (primary.get("fetched_at") if primary else None),
        "snapshot_age_minutes": snapshot_meta.get("snapshot_age_minutes"),
        "is_stale": snapshot_meta.get("is_stale"),
    }

    payload: Dict[str, Any] = {
        "symbol": normalized,
        "input_loaded": input_loaded,
        "context_loaded": bool(context),
        "loaded_context_symbols": loaded_context_symbols,
        "context": context,
        "context_summary": context_summary,
        "data_meta": data_meta,
    }

    if primary is None:
        payload.update(
            {
                "price": None,
                "change_pct": None,
                "asset_class": None,
                "name": None,
                "source": None,
                "as_of": data_meta["as_of"],
                "fetched_at": data_meta["fetched_at"],
                "raw_symbol": normalized or None,
                "missing_reason": "symbol_not_found",
            }
        )
        return payload

    payload.update(
        {
            "price": _safe_float(primary.get("price")),
            "change_pct": _safe_float(primary.get("change_pct")),
            "asset_class": primary.get("asset_class"),
            "name": primary.get("name"),
            "source": primary.get("source"),
            "as_of": primary.get("as_of"),
            "fetched_at": primary.get("fetched_at"),
            "raw_symbol": primary.get("raw_symbol") or normalized,
            "currency": primary.get("currency"),
            "exchange": primary.get("exchange"),
        }
    )
    return payload


def build_core_risk_inputs(use_cache: bool = True) -> Dict[str, Dict[str, Any]]:
    context_map = build_risk_context_map(use_cache=use_cache)
    snapshot_meta = _snapshot_meta(use_cache=use_cache)
    return {
        symbol: build_risk_input_for_symbol(
            symbol,
            use_cache=use_cache,
            context_map=context_map,
            snapshot_meta=snapshot_meta,
        )
        for symbol in RISK_SYMBOLS
    }


def load_latest_engine_reference() -> Optional[Dict[str, Any]]:
    for path in ENGINE_REFERENCE_CANDIDATES:
        payload = _load_json_file(path)
        if not isinstance(payload, dict):
            continue
        engine_name = path.stem
        reference = _extract_engine_reference(payload, path, engine_name)
        if reference is not None:
            return reference
    return None


def _extract_engine_reference(payload: Dict[str, Any], path: Path, engine_name: str) -> Optional[Dict[str, Any]]:
    if engine_name == "risk_v1":
        current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
        context = current.get("context") if isinstance(current.get("context"), dict) else {}
        raw_state = context.get("final_risk") or current.get("level_label")
        risk_state = _normalize_state_text(raw_state)
        risk_score = _safe_float(current.get("score"))
        if risk_score is None:
            risk_score = _safe_float(current.get("level"))
        summary = _safe_text(context.get("brief"), "")
        if not summary:
            summary = _safe_text(payload.get("methodology", {}).get("score_description"), "")
        return {
            "loaded": True,
            "source": "risk_v1",
            "path": str(path),
            "generated_at": payload.get("generated") or payload.get("generated_at") or _file_mtime_iso(path),
            "current_date": current.get("date"),
            "risk_state": risk_state,
            "risk_state_raw": _safe_text(raw_state, ""),
            "risk_score": risk_score,
            "risk_score_scale": "0-120",
            "summary": summary,
        }

    if engine_name == "risk_alert":
        current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
        raw_state = current.get("level_label") or current.get("level")
        risk_state = _normalize_state_text(raw_state)
        risk_score = _safe_float(current.get("score"))
        summary = _safe_text(current.get("action"), "")
        return {
            "loaded": True,
            "source": "risk_alert",
            "path": str(path),
            "generated_at": payload.get("generated") or payload.get("generated_at") or _file_mtime_iso(path),
            "current_date": current.get("date"),
            "risk_state": risk_state,
            "risk_state_raw": _safe_text(raw_state, ""),
            "risk_score": risk_score,
            "risk_score_scale": "0-100",
            "summary": summary,
        }

    if engine_name == "risk_engine":
        shock_probability = payload.get("shock_probability") if isinstance(payload.get("shock_probability"), dict) else {}
        defensive_trigger = payload.get("defensive_trigger") if isinstance(payload.get("defensive_trigger"), dict) else {}
        raw_state = "Risk-Off" if defensive_trigger.get("active") else "Risk-On"
        risk_state = _normalize_state_text(raw_state)
        risk_score = _safe_float(shock_probability.get("value"))
        summary = _safe_text(defensive_trigger.get("reason"), "")
        if not summary:
            summary = _safe_text(shock_probability.get("description"), "")
        return {
            "loaded": True,
            "source": "risk_engine",
            "path": str(path),
            "generated_at": payload.get("generated_at") or _file_mtime_iso(path),
            "current_date": payload.get("data_date"),
            "risk_state": risk_state,
            "risk_state_raw": raw_state,
            "risk_score": risk_score,
            "risk_score_scale": "0-80",
            "summary": summary,
        }

    return None


def build_snapshot_fallback_reference(risk_inputs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    qqq_input = risk_inputs.get("QQQ") or {}
    context = qqq_input.get("context_summary") if isinstance(qqq_input.get("context_summary"), dict) else {}

    score = 50.0
    qqq_change = _safe_float(context.get("qqq_change_pct"))
    if qqq_change is None:
        qqq_change = _safe_float(qqq_input.get("change_pct"))
    if qqq_change is not None:
        if qqq_change <= -3.0:
            score += 30.0
        elif qqq_change <= -1.5:
            score += 18.0
        elif qqq_change <= -0.5:
            score += 8.0
        elif qqq_change >= 1.5:
            score -= 15.0
        elif qqq_change >= 0.5:
            score -= 8.0

    vix_level = _safe_float(context.get("vix_level"))
    if vix_level is not None:
        if vix_level >= 30.0:
            score += 20.0
        elif vix_level >= 25.0:
            score += 12.0
        elif vix_level >= 20.0:
            score += 6.0
        elif vix_level <= 15.0:
            score -= 5.0

    us10y_level = _safe_float(context.get("us10y_level"))
    if us10y_level is not None:
        if us10y_level >= 4.5:
            score += 5.0
        elif us10y_level <= 3.5:
            score -= 3.0

    wti_level = _safe_float(context.get("wti_level"))
    if wti_level is not None and wti_level >= 90.0:
        score += 3.0

    score = max(0.0, min(100.0, round(score, 1)))
    if score >= 85.0:
        state = "crisis"
    elif score >= 70.0:
        state = "high_risk"
    elif score >= 50.0:
        state = "warning"
    elif score >= 30.0:
        state = "caution"
    else:
        state = "normal"

    return {
        "loaded": False,
        "source": "snapshot_fallback",
        "path": None,
        "generated_at": _utc_now_iso(),
        "current_date": qqq_input.get("as_of") or qqq_input.get("fetched_at"),
        "risk_state": state,
        "risk_state_raw": "snapshot_fallback",
        "risk_score": score,
        "risk_score_scale": "0-100",
        "summary": "Snapshot fallback computed from QQQ change, VIX, US10Y and WTI context.",
    }


def _build_notes(symbol: str, risk_input: Dict[str, Any], engine_reference: Dict[str, Any]) -> List[str]:
    notes: List[str] = []

    snapshot_source = _safe_text(risk_input.get("data_meta", {}).get("snapshot_source"), "cache")
    notes.append(f"Latest {symbol} snapshot loaded from {snapshot_source}.")

    raw_state = _safe_text(engine_reference.get("risk_state_raw"), "")
    risk_state = _safe_text(engine_reference.get("risk_state"), "unknown")
    risk_score = engine_reference.get("risk_score")
    if risk_score is not None:
        notes.append(f"Engine reference: {raw_state or risk_state} / score {float(risk_score):.1f}.")
    else:
        notes.append(f"Engine reference: {raw_state or risk_state}.")

    context = risk_input.get("context_summary") if isinstance(risk_input.get("context_summary"), dict) else {}
    context_parts: List[str] = []
    qqq_change = _safe_float(context.get("qqq_change_pct"))
    if qqq_change is not None:
        context_parts.append(f"QQQ {qqq_change:+.2f}%")
    vix_level = _safe_float(context.get("vix_level"))
    if vix_level is not None:
        context_parts.append(f"VIX {vix_level:.2f}")
    us10y_level = _safe_float(context.get("us10y_level"))
    if us10y_level is not None:
        context_parts.append(f"US10Y {us10y_level:.2f}")
    wti_level = _safe_float(context.get("wti_level"))
    if wti_level is not None:
        context_parts.append(f"WTI {wti_level:.2f}")

    if symbol == "TQQQ":
        context_parts.append("leveraged overlay against the Nasdaq benchmark")
    elif symbol == "QQQ":
        context_parts.append("QQQ is the benchmark risk anchor for leveraged Nasdaq exposure")

    if context_parts:
        notes.append("Context: " + "; ".join(context_parts) + ".")

    return notes[:3]


def build_risk_output_for_symbol(
    symbol: str,
    risk_input: Dict[str, Any],
    engine_reference: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not risk_input or not risk_input.get("input_loaded"):
        return None

    snapshot_age_minutes = risk_input.get("data_meta", {}).get("snapshot_age_minutes")
    is_stale = bool(risk_input.get("data_meta", {}).get("is_stale"))
    mode = "snapshot_plus_engine_reference" if engine_reference.get("loaded") else "snapshot_only_fallback"
    if is_stale:
        mode = "stale_snapshot_warning" if engine_reference.get("loaded") else "stale_snapshot_warning_fallback"

    notes = _build_notes(symbol, risk_input, engine_reference)

    output = {
        "symbol": _safe_text(risk_input.get("symbol"), symbol),
        "asset_class": risk_input.get("asset_class"),
        "name": risk_input.get("name"),
        "price": _safe_float(risk_input.get("price")),
        "change_pct": _safe_float(risk_input.get("change_pct")),
        "source": risk_input.get("source"),
        "as_of": risk_input.get("as_of"),
        "fetched_at": risk_input.get("fetched_at"),
        "raw_symbol": risk_input.get("raw_symbol") or symbol,
        "risk_state": _safe_text(engine_reference.get("risk_state"), "unknown"),
        "risk_score": _safe_float(engine_reference.get("risk_score")),
        "risk_score_scale": engine_reference.get("risk_score_scale"),
        "notes": notes,
        "context_summary": risk_input.get("context_summary"),
        "source_meta": {
            "input_loaded": True,
            "context_loaded": bool(risk_input.get("context_loaded")),
            "engine_loaded": bool(engine_reference.get("loaded")),
            "engine_source": engine_reference.get("source"),
            "engine_path": engine_reference.get("path"),
            "engine_state_raw": engine_reference.get("risk_state_raw"),
            "engine_generated_at": engine_reference.get("generated_at"),
            "snapshot_age_minutes": snapshot_age_minutes,
            "is_stale": is_stale,
            "mode": mode,
        },
    }
    return output


def build_risk_outputs_from_snapshot(use_cache: bool = True) -> Dict[str, Any]:
    snapshot_meta = _snapshot_meta(use_cache=use_cache)
    context_map = build_risk_context_map(use_cache=use_cache)
    risk_inputs = {
        symbol: build_risk_input_for_symbol(
            symbol,
            use_cache=use_cache,
            context_map=context_map,
            snapshot_meta=snapshot_meta,
        )
        for symbol in RISK_SYMBOLS
    }

    engine_reference = load_latest_engine_reference()
    if engine_reference is None:
        engine_reference = build_snapshot_fallback_reference(risk_inputs)

    risk_outputs: Dict[str, Dict[str, Any]] = {}
    warnings: List[str] = []
    if snapshot_meta.get("is_stale"):
        warnings.append("Snapshot is stale or incomplete.")
    if not engine_reference.get("loaded"):
        warnings.append("Engine reference unavailable; using snapshot fallback.")

    for symbol in RISK_SYMBOLS:
        risk_output = build_risk_output_for_symbol(symbol, risk_inputs.get(symbol, {}), engine_reference)
        if risk_output is None:
            warnings.append(f"{symbol} input missing; output skipped.")
            continue
        risk_outputs[symbol] = risk_output

    mode = "snapshot_plus_engine_reference" if engine_reference.get("loaded") else "snapshot_only_fallback"
    if snapshot_meta.get("is_stale"):
        mode = "stale_snapshot_warning" if engine_reference.get("loaded") else "stale_snapshot_warning_fallback"

    result = {
        "generated_at": _utc_now_iso(),
        "mode": mode,
        "snapshot_meta": snapshot_meta,
        "engine_meta": {k: v for k, v in engine_reference.items() if k != "loaded"} | {"loaded": bool(engine_reference.get("loaded"))},
        "risk_inputs": risk_inputs,
        "risk_outputs": risk_outputs,
        "warnings": warnings,
    }
    return result


def save_risk_snapshot_outputs(result: Dict[str, Any]) -> Dict[str, str]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    snapshot_meta = result.get("snapshot_meta") if isinstance(result.get("snapshot_meta"), dict) else {}
    engine_meta = result.get("engine_meta") if isinstance(result.get("engine_meta"), dict) else {}
    generated_at = result.get("generated_at") or _utc_now_iso()
    warnings = result.get("warnings") if isinstance(result.get("warnings"), list) else []

    latest_payload = {
        "generated_at": generated_at,
        "mode": result.get("mode"),
        "snapshot_meta": snapshot_meta,
        "engine_meta": engine_meta,
        "risk_outputs": result.get("risk_outputs") if isinstance(result.get("risk_outputs"), dict) else {},
        "warnings": warnings,
    }

    latest_path = OUTPUT_DIR / "risk_snapshot_latest.json"
    latest_path.write_text(json.dumps(latest_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    symbol_paths: Dict[str, str] = {}
    risk_outputs = result.get("risk_outputs") if isinstance(result.get("risk_outputs"), dict) else {}
    for symbol, risk_output in risk_outputs.items():
        symbol_path = OUTPUT_DIR / f"risk_snapshot_{symbol}.json"
        symbol_payload = {
            "generated_at": generated_at,
            "mode": result.get("mode"),
            "snapshot_meta": snapshot_meta,
            "engine_meta": engine_meta,
            "risk_output": risk_output,
            "warnings": warnings,
        }
        symbol_path.write_text(json.dumps(symbol_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        symbol_paths[symbol] = str(symbol_path)

    return {
        "latest": str(latest_path),
        **symbol_paths,
    }


def run_risk_engine_from_snapshot(use_cache: bool = True, save: bool = True) -> Dict[str, Any]:
    result = build_risk_outputs_from_snapshot(use_cache=use_cache)
    if save:
        result["output_paths"] = save_risk_snapshot_outputs(result)
    return result
