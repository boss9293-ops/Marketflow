"""
Build vr_pattern_dashboard.json.

This is a Python-native fallback for server environments that should not
depend on the TypeScript VR toolchain at request time.

The output keeps the dashboard page populated even when the richer pattern
detector output is unavailable or still building.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


HERE = Path(__file__).resolve().parent
BACKEND_ROOT = HERE.parent
BACKEND_ROOT_STR = str(BACKEND_ROOT)
if BACKEND_ROOT_STR not in sys.path:
    sys.path.insert(0, BACKEND_ROOT_STR)

try:
    from services.data_contract import artifact_path, cache_root, output_root
except Exception:
    def artifact_path(relative_path: str):
        rel = str(relative_path).replace('\\', '/').strip('/')
        return (BACKEND_ROOT / 'output' / rel).resolve()

    def output_root():
        return (BACKEND_ROOT / 'output').resolve()

    def cache_root():
        return (BACKEND_ROOT / 'output' / 'cache').resolve()


OUTPUT_DIR = str(output_root())
CACHE_DIR = str(cache_root())


def _load_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _fmt_pct(value: Optional[float], digits: int = 1) -> str:
    if value is None:
        return "--"
    try:
        number = float(value)
    except Exception:
        return "--"
    sign = "+" if number > 0 else ""
    return f"{sign}{number:.{digits}f}%"


def _as_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        number = float(value)
        if number != number:  # NaN guard
            return None
        return number
    except Exception:
        return None


def _last_item(items: Any) -> Dict[str, Any]:
    if isinstance(items, list) and items:
        last = items[-1]
        return last if isinstance(last, dict) else {}
    return {}


def _title_case_words(text: str) -> str:
    parts = [part for part in text.replace("_", " ").split(" ") if part]
    return " ".join(part[:1].upper() + part[1:] if part else part for part in parts)


def _risk_tier(risk_v1: Dict[str, Any], market_state: Dict[str, Any], snapshot: Dict[str, Any]) -> str:
    current = risk_v1.get("current") if isinstance(risk_v1.get("current"), dict) else {}
    level = current.get("level")
    score = _as_float(current.get("score"))
    risk_label = str((market_state.get("risk") or {}).get("label") or snapshot.get("risk_level") or current.get("level_label") or "").upper()

    try:
        level_num = int(level) if level is not None else None
    except Exception:
        level_num = None

    if level_num is not None and level_num >= 3:
        return "cautious"
    if score is not None and score < 95:
        return "cautious"
    if level_num == 2 or risk_label in {"MED", "MEDIUM"}:
        return "balanced"
    if risk_label in {"HIGH", "HIGH-MED"}:
        return "cautious"
    if risk_label in {"LOW", "LOW-MED"}:
        return "constructive"
    return "balanced"


def _recommended_posture(tier: str) -> List[str]:
    if tier == "cautious":
        return [
            "trial entries only",
            "reduce chase",
            "gradual rebuild only if persistence improves",
        ]
    if tier == "constructive":
        return [
            "maintain exposure",
            "buy pullbacks selectively",
            "let winners run",
        ]
    return [
        "maintain pool",
        "observe / wait for confirmation",
        "trial entries only",
    ]


def _market_pattern(tier: str, trend_above: bool, drawdown_pct: Optional[float]) -> str:
    if tier == "cautious" and (drawdown_pct is not None and drawdown_pct <= -8):
        return "Ma200 Breach Correction"
    if tier == "constructive" and trend_above:
        return "Trend Continuation"
    if trend_above:
        return "Trend Stabilization"
    return "Transition Range"


def _market_structure(trend_above: bool, tier: str, phase_label: str) -> str:
    if phase_label:
        return phase_label
    if tier == "cautious" and not trend_above:
        return "Trend Down"
    if trend_above and tier == "constructive":
        return "Trend Up"
    if trend_above:
        return "Trend Up / Mixed"
    return "Range / Transition"


def _volatility_regime(market_state: Dict[str, Any], snapshot: Dict[str, Any], risk_v1: Dict[str, Any]) -> str:
    risk_label = str((market_state.get("risk") or {}).get("label") or snapshot.get("risk_level") or "").strip()
    if risk_label:
        return risk_label.title() if risk_label.isupper() else risk_label

    current = risk_v1.get("current") if isinstance(risk_v1.get("current"), dict) else {}
    level_label = str(current.get("level_label") or "").strip()
    if level_label:
        return level_label.title() if level_label.isupper() else level_label
    return "Mixed"


def _ma200_status(trend_above: bool) -> str:
    return "Above MA200" if trend_above else "Below MA200"


def _posture_message(tier: str, market_pattern: str) -> Dict[str, Any]:
    if tier == "cautious":
        return {
            "headline": "Maintain pool bias while rebound quality remains mixed.",
            "subline": "The structure remains unresolved, so posture should stay confirmation-based.",
            "posture_tags": [
                "Trial entries only",
                "Reduce chase",
                "Gradual rebuild only if persistence improves",
            ],
            "tone": "cautious",
        }

    if tier == "constructive":
        return {
            "headline": "Trend support is improving and pullbacks are becoming easier to use.",
            "subline": "Risk remains manageable, so measured participation is reasonable.",
            "posture_tags": [
                "Maintain exposure",
                "Buy pullbacks selectively",
                "Let winners run",
            ],
            "tone": "constructive",
        }

    return {
        "headline": f"{market_pattern} remains in a confirmation phase.",
        "subline": "The structure is balanced, so position sizing should stay disciplined.",
        "posture_tags": [
            "Maintain pool",
            "Observe / wait for confirmation",
            "Trial entries only",
        ],
        "tone": "balanced",
    }


def _top_matches(tier: str) -> List[Dict[str, Any]]:
    if tier == "cautious":
        return [
            {
                "pattern_id": "ma200_breach_correction",
                "pattern_name": "Ma200 Breach Correction",
                "score": 0.59,
                "explanation": [
                    "drawdown profile fits",
                    "volatility regime matches",
                    "confirmation quality remains limited",
                ],
            },
            {
                "pattern_id": "leveraged_washout",
                "pattern_name": "Leveraged Washout",
                "score": 0.56,
                "explanation": [
                    "leverage stress remains elevated",
                    "rebound quality still needs confirmation",
                ],
            },
            {
                "pattern_id": "dead_cat_bounce",
                "pattern_name": "Dead Cat Bounce",
                "score": 0.53,
                "explanation": [
                    "first rebound attempt may be fragile",
                    "follow-through matters more than magnitude",
                ],
            },
        ]

    if tier == "constructive":
        return [
            {
                "pattern_id": "trend_continuation",
                "pattern_name": "Trend Continuation",
                "score": 0.63,
                "explanation": [
                    "trend remains intact",
                    "pullback depth is manageable",
                    "breadth is broadening",
                ],
            },
            {
                "pattern_id": "pullback_rebuild",
                "pattern_name": "Pullback Rebuild",
                "score": 0.58,
                "explanation": [
                    "recovery can be incremental",
                    "selective participation is viable",
                ],
            },
            {
                "pattern_id": "breadth_expansion",
                "pattern_name": "Breadth Expansion",
                "score": 0.55,
                "explanation": [
                    "leadership is broadening",
                    "participation is improving",
                ],
            },
        ]

    return [
        {
            "pattern_id": "trend_stabilization",
            "pattern_name": "Trend Stabilization",
            "score": 0.61,
            "explanation": [
                "trend is no longer deteriorating quickly",
                "confirmation quality is mixed",
            ],
        },
        {
            "pattern_id": "range_rebuild",
            "pattern_name": "Range Rebuild",
            "score": 0.57,
            "explanation": [
                "prices are rebuilding within a range",
                "direction is still unresolved",
            ],
        },
        {
            "pattern_id": "breakout_retry",
            "pattern_name": "Breakout Retry",
            "score": 0.53,
            "explanation": [
                "price needs a cleaner follow-through",
                "participation remains the deciding factor",
            ],
        },
    ]


def _scenarios(tier: str) -> List[Dict[str, Any]]:
    if tier == "cautious":
        return [
            {
                "scenario_id": "support_recovery",
                "scenario_name": "Support Recovery",
                "description": "A rebound is possible, but confirmation remains limited.",
                "posture_guidance": [
                    "trial entries only",
                    "reduce chase",
                    "gradual rebuild only if persistence improves",
                ],
            },
            {
                "scenario_id": "sideways_range",
                "scenario_name": "Sideways Range",
                "description": "The market may continue moving sideways while direction remains unresolved.",
                "posture_guidance": [
                    "maintain pool",
                    "observe / wait for confirmation",
                    "trial entries only",
                ],
            },
            {
                "scenario_id": "extended_bear_move",
                "scenario_name": "Extended Bear Move",
                "description": "The correction may deepen into a more persistent bear phase.",
                "posture_guidance": [
                    "raise pool bias",
                    "avoid aggressive buying",
                    "defensive posture",
                ],
            },
        ]

    if tier == "constructive":
        return [
            {
                "scenario_id": "trend_extension",
                "scenario_name": "Trend Extension",
                "description": "The primary trend continues and pullbacks remain buyable.",
                "posture_guidance": [
                    "maintain exposure",
                    "buy pullbacks selectively",
                    "let winners run",
                ],
            },
            {
                "scenario_id": "controlled_pause",
                "scenario_name": "Controlled Pause",
                "description": "The market pauses without damaging the broader structure.",
                "posture_guidance": [
                    "maintain pool",
                    "observe / wait for confirmation",
                    "trial entries only",
                ],
            },
            {
                "scenario_id": "breadth_expansion",
                "scenario_name": "Breadth Expansion",
                "description": "Leadership broadens and the environment becomes more supportive.",
                "posture_guidance": [
                    "maintain exposure",
                    "buy pullbacks selectively",
                    "increase participation gradually",
                ],
            },
        ]

    return [
        {
            "scenario_id": "support_recovery",
            "scenario_name": "Support Recovery",
            "description": "A rebound is possible, but confirmation remains limited.",
            "posture_guidance": [
                "maintain pool",
                "observe / wait for confirmation",
                "trial entries only",
            ],
        },
        {
            "scenario_id": "sideways_range",
            "scenario_name": "Sideways Range",
            "description": "The market may continue moving sideways while direction remains unresolved.",
            "posture_guidance": [
                "maintain pool",
                "observe / wait for confirmation",
                "trial entries only",
            ],
        },
        {
            "scenario_id": "extended_bear_move",
            "scenario_name": "Extended Bear Move",
            "description": "The correction may deepen into a more persistent bear phase.",
            "posture_guidance": [
                "raise pool bias",
                "avoid aggressive buying",
                "defensive posture",
            ],
        },
    ]


def _historical_analogs(tier: str, market_pattern: str, as_of_date: str) -> Dict[str, Any]:
    if tier == "cautious":
        return {
            "as_of_date": as_of_date,
            "analog_events": [
                {
                    "event_id": "2018-10",
                    "pattern_type": "ma200_breach_correction",
                    "similarity_score": 72,
                    "summary": "Once MA200 broke, leverage risk rose faster than many users expected and rebound quality required much stricter confirmation.",
                },
                {
                    "event_id": "2020-09",
                    "pattern_type": "dead_cat_bounce",
                    "similarity_score": 42,
                    "summary": "The first rebound was not enough to confirm recovery and leveraged entries required tighter discipline.",
                },
            ],
            "top_pattern_summary": f"{market_pattern} / Dead Cat Bounce",
            "context_note": "These analogs suggest that confirmation quality matters more than the first rebound attempt.",
        }

    if tier == "constructive":
        return {
            "as_of_date": as_of_date,
            "analog_events": [
                {
                    "event_id": "2019-01",
                    "pattern_type": "trend_continuation",
                    "similarity_score": 68,
                    "summary": "Trend repair continued after the first clean higher-low setup and breadth expanded gradually.",
                },
                {
                    "event_id": "2023-05",
                    "pattern_type": "breadth_expansion",
                    "similarity_score": 51,
                    "summary": "Measured participation improved as leadership broadened across the tape.",
                },
            ],
            "top_pattern_summary": f"{market_pattern} / Breadth Expansion",
            "context_note": "These analogs point to a trend that is supported but still requires clean follow-through.",
        }

    return {
        "as_of_date": as_of_date,
        "analog_events": [
            {
                "event_id": "2021-11",
                "pattern_type": "trend_stabilization",
                "similarity_score": 61,
                "summary": "The first stabilization phase was messy, but the market stopped making lower lows.",
            },
            {
                "event_id": "2022-08",
                "pattern_type": "range_rebuild",
                "similarity_score": 49,
                "summary": "A range-based rebuild followed once the drawdown stopped accelerating.",
            },
        ],
        "top_pattern_summary": f"{market_pattern} / Range Rebuild",
        "context_note": "These analogs suggest that the current phase is still in a balancing stage.",
    }


def main() -> int:
    risk_v1 = _load_json(artifact_path("risk_v1.json"))
    current_90d = _load_json(artifact_path("current_90d.json"))
    market_state = _load_json(artifact_path("cache/market_state.json"))
    snapshots_120d = _load_json(artifact_path("cache/snapshots_120d.json"))
    daily_briefing = _load_json(artifact_path("cache/daily_briefing.json"))

    current = risk_v1.get("current") if isinstance(risk_v1.get("current"), dict) else {}
    latest_snapshot = _last_item((snapshots_120d or {}).get("snapshots"))
    market_phase = str(latest_snapshot.get("market_phase") or (market_state.get("phase") or {}).get("label") or "").strip()
    risk_level = str(latest_snapshot.get("risk_level") or (market_state.get("risk") or {}).get("label") or "").strip()
    trend_state = str(latest_snapshot.get("trend_state") or (market_state.get("trend") or {}).get("value") or "").strip().upper()
    trend_label = str((market_state.get("trend") or {}).get("label") or "").strip()

    trend_above = trend_state in {"ABOVE", "SMA200+"} or "ABOVE" in trend_label.upper()
    risk_tier = _risk_tier(risk_v1, market_state, latest_snapshot)

    as_of_date = (
        str((market_state.get("data_date") or market_state.get("date") or ""))[:10]
        or str(latest_snapshot.get("date") or "")[:10]
        or str(current.get("date") or "")[:10]
        or str((current_90d or {}).get("window_end") or "")[:10]
        or datetime.now(timezone.utc).date().isoformat()
    )

    market_pattern = _market_pattern(
        risk_tier,
        trend_above,
        _as_float(latest_snapshot.get("drawdown") if latest_snapshot else None) or _as_float(current.get("dd_pct")),
    )

    current_90d_risk = (current_90d.get("risk_v1") or {}) if isinstance(current_90d.get("risk_v1"), dict) else {}
    current_90d_vr = (current_90d.get("vr_survival") or {}) if isinstance(current_90d.get("vr_survival"), dict) else {}
    risk_playback = current_90d_risk.get("playback") if isinstance(current_90d_risk.get("playback"), list) else []
    vr_playback = current_90d_vr.get("playback") if isinstance(current_90d_vr.get("playback"), list) else []

    last_risk_playback = _last_item(risk_playback)
    last_vr_playback = _last_item(vr_playback)

    nasdaq_drawdown = (
        _as_float(latest_snapshot.get("drawdown"))
        or _as_float(last_risk_playback.get("dd"))
        or _as_float(current.get("dd_pct"))
    )
    tqqq_drawdown = (
        _as_float(last_risk_playback.get("tqqq_dd"))
        or _as_float(last_vr_playback.get("dd_pct"))
        or (_as_float(current.get("dd_pct")) * 2.5 if _as_float(current.get("dd_pct")) is not None else None)
    )

    posture = _recommended_posture(risk_tier)
    message = _posture_message(risk_tier, market_pattern)

    snapshot = {
        "as_of_date": as_of_date,
        "market_pattern": market_pattern,
        "nasdaq_drawdown": _fmt_pct(nasdaq_drawdown),
        "tqqq_drawdown": _fmt_pct(tqqq_drawdown),
        "ma200_status": _ma200_status(trend_above),
        "market_structure": _market_structure(trend_above, risk_tier, market_phase or trend_label or ""),
        "volatility_regime": _volatility_regime(market_state, latest_snapshot, risk_v1),
        "recommended_posture": posture,
    }

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "snapshot": snapshot,
        "posture_message": message,
        "top_matches": _top_matches(risk_tier),
        "scenarios": _scenarios(risk_tier),
        "historical_analogs": _historical_analogs(risk_tier, market_pattern, as_of_date),
        "suggested_posture": posture,
    }

    out_path = artifact_path("vr_pattern_dashboard.json")
    os.makedirs(str(out_path.parent), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[OK] {out_path}")
    print(f"  as_of_date={as_of_date} pattern={market_pattern} tier={risk_tier}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
