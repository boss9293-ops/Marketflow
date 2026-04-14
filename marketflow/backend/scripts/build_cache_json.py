"""
Build dashboard cache JSON from daily_snapshots and SNAPSHOT_ALERT signals.

Outputs:
- output/cache/overview.json
- output/cache/snapshots_120d.json
- output/cache/alerts_recent.json
- output/cache/overview_home.json   ← HOT 3-panel data for main dashboard

Usage (PowerShell):
  python backend/scripts/build_cache_json.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import traceback
import shutil
from datetime import datetime
from typing import Any, Dict, List, Optional

from date_utils import normalize_daily_snapshot_dates


DATA_VERSION = "cache_v2"
SNAPSHOT_LIMIT = 120
ALERT_FETCH_LIMIT = 200
ALERT_OUTPUT_LIMIT = 5
ML_HORIZON_DAYS = 5


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def db_path() -> str:
    try:
        from db_utils import resolve_marketflow_db
        return resolve_marketflow_db(required_tables=("ohlcv_daily",), data_plane="live")
    except Exception:
        return os.path.join(repo_root(), "data", "marketflow.db")


def cache_dir() -> str:
    return os.path.join(repo_root(), "output", "cache")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def safe_parse_payload(payload: Optional[str]) -> Any:
    if payload is None:
        return None
    if not isinstance(payload, str):
        return payload
    text = payload.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return payload


def calc_strength(gate_delta_5d, phase_shift_flag, gate_score) -> float:
    delta = abs(float(gate_delta_5d or 0.0))
    phase_boost = int(phase_shift_flag or 0) * 5
    score_penalty = max(0.0, 60.0 - float(gate_score or 0.0))
    return round(delta + phase_boost + score_penalty, 2)


def severity_label(strength: float) -> str:
    if strength >= 15:
        return "HIGH"
    if strength >= 8:
        return "MED"
    return "LOW"


def write_json(path: str, data: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def build_overview(conn: sqlite3.Connection) -> Dict[str, Any]:
    row = conn.execute(
        """
        SELECT
          date, market_phase, gate_score, risk_trend, risk_level,
          total_stocks, vcp_count, rotation_count
        FROM daily_snapshots
        ORDER BY date DESC
        LIMIT 1
        """
    ).fetchone()

    latest_date = row[0] if row else None
    market_phase = row[1] if row else None
    gate_score = row[2] if row else None
    risk_trend = row[3] if row else None
    risk_level = row[4] if row else None
    total_stocks = row[5] if row else 0
    vcp_count = row[6] if row else 0
    rotation_count = row[7] if row else 0

    alert_count_row = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals
        WHERE signal_type = 'SNAPSHOT_ALERT'
          AND status = 'active'
          AND (? IS NULL OR date = ?)
        """,
        (latest_date, latest_date),
    ).fetchone()
    active_alerts_today = int(alert_count_row[0] if alert_count_row else 0)

    return {
        "generated_at": now_iso(),
        "data_version": DATA_VERSION,
        "latest_date": latest_date,
        "market_phase": market_phase,
        "gate_score": gate_score,
        "risk_trend": risk_trend,
        "risk_level": risk_level,
        "total_stocks": int(total_stocks or 0),
        "vcp_count": int(vcp_count or 0),
        "rotation_count": int(rotation_count or 0),
        "active_snapshot_alerts_today": active_alerts_today,
    }


def build_snapshots_120d(conn: sqlite3.Connection) -> Dict[str, Any]:
    rows = conn.execute(
        """
        SELECT
          date, total_stocks, vcp_count, rotation_count,
          market_phase, gate_score, risk_level,
          gate_score_10d_avg, gate_score_30d_avg, gate_delta_5d,
          risk_trend, phase_shift_flag,
          ml_spy_prob, ml_qqq_prob, data_version, generated_at
        FROM (
          SELECT
            date, total_stocks, vcp_count, rotation_count,
            market_phase, gate_score, risk_level,
            gate_score_10d_avg, gate_score_30d_avg, gate_delta_5d,
            risk_trend, phase_shift_flag,
            ml_spy_prob, ml_qqq_prob, data_version, generated_at
          FROM daily_snapshots
          ORDER BY date DESC
          LIMIT ?
        ) t
        ORDER BY date ASC
        """,
        (SNAPSHOT_LIMIT,),
    ).fetchall()

    snapshots: List[Dict[str, Any]] = []
    for r in rows:
        snapshots.append(
            {
                "date": r[0],
                "total_stocks": int(r[1] or 0),
                "vcp_count": int(r[2] or 0),
                "rotation_count": int(r[3] or 0),
                "market_phase": r[4],
                "gate_score": r[5],
                "risk_level": r[6],
                "gate_score_10d_avg": r[7],
                "gate_score_30d_avg": r[8],
                "gate_delta_5d": r[9],
                "risk_trend": r[10],
                "phase_shift_flag": int(r[11] or 0),
                "ml_spy_prob": r[12],
                "ml_qqq_prob": r[13],
                "snapshot_data_version": r[14],
                "snapshot_generated_at": r[15],
            }
        )

    return {
        "generated_at": now_iso(),
        "data_version": DATA_VERSION,
        "count": len(snapshots),
        "snapshots": snapshots,
    }


def build_alerts_recent(conn: sqlite3.Connection) -> Dict[str, Any]:
    rows = conn.execute(
        """
        SELECT date, score, status, payload_json, created_at
        FROM signals
        WHERE signal_type = 'SNAPSHOT_ALERT'
        ORDER BY date DESC, id DESC
        LIMIT ?
        """,
        (ALERT_FETCH_LIMIT,),
    ).fetchall()

    alerts: List[Dict[str, Any]] = []
    for r in rows:
        payload = safe_parse_payload(r[3])
        trend = payload.get("trend", {}) if isinstance(payload, dict) else {}
        strength = payload.get("strength") if isinstance(payload, dict) else None
        severity = payload.get("severity_label") if isinstance(payload, dict) else None
        streak = payload.get("streak") if isinstance(payload, dict) else None
        regime = payload.get("regime_label") if isinstance(payload, dict) else None
        recovery_streak = payload.get("recovery_streak") if isinstance(payload, dict) else None

        if strength is None:
            strength = calc_strength(
                trend.get("gate_delta_5d"),
                trend.get("phase_shift_flag"),
                trend.get("gate_score", r[1]),
            )
        else:
            strength = float(strength)

        if severity not in {"HIGH", "MED", "LOW"}:
            severity = severity_label(strength)
        if streak is None:
            streak = 1
        else:
            streak = int(streak)
        if regime not in {"STRUCTURAL", "EVENT", "NOISE"}:
            if streak >= 5:
                regime = "STRUCTURAL"
            elif streak >= 2:
                regime = "EVENT"
            else:
                regime = "NOISE"
        if recovery_streak is None:
            recovery_streak = 0
        else:
            recovery_streak = int(recovery_streak)

        alerts.append(
            {
                "date": r[0],
                "signal_type": "SNAPSHOT_ALERT",
                "score": r[1],
                "status": r[2],
                "strength": strength,
                "severity_label": severity,
                "streak": streak,
                "regime_label": regime,
                "recovery_streak": recovery_streak,
                "payload_json": payload,
                "created_at": r[4],
            }
        )

    sev_rank = {"HIGH": 3, "MED": 2, "LOW": 1}
    alerts = sorted(
        alerts,
        key=lambda x: (
            sev_rank.get(str(x.get("severity_label")), 0),
            int(x.get("streak") or 0),
            str(x.get("date") or ""),
        ),
        reverse=True,
    )
    alerts = alerts[:ALERT_OUTPUT_LIMIT]

    latest_alert_date_row = conn.execute(
        """
        SELECT MAX(date)
        FROM signals
        WHERE signal_type = 'SNAPSHOT_ALERT'
        """
    ).fetchone()
    latest_alert_date = latest_alert_date_row[0] if latest_alert_date_row else None

    return {
        "generated_at": now_iso(),
        "data_version": DATA_VERSION,
        "latest_alert_date": latest_alert_date,
        "count": len(alerts),
        "alerts": alerts,
    }


def build_ml_prediction_cache(conn: sqlite3.Connection) -> Dict[str, Any]:
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    }
    if "ml_predictions_daily" not in tables:
        return {
            "generated_at": now_iso(),
            "data_version": DATA_VERSION,
            "as_of_date": None,
            "predictions": [],
            "count": 0,
            "rerun_hint": "python backend/scripts/build_ml_prediction.py",
            "note": "ml_predictions_daily table not found",
        }

    latest_row = conn.execute("SELECT MAX(date) FROM ml_predictions_daily").fetchone()
    as_of_date = latest_row[0] if latest_row else None
    if not as_of_date:
        return {
            "date": None,
            "spy": {},
            "qqq": {},
            "recent_strip": {},
            "action": {},
            "data_version": "ml_prediction_v2.1",
            "generated_at": now_iso(),
            "rerun_hint": "python backend/scripts/build_ml_prediction.py",
        }

    cur = conn.cursor()
    cur.execute(
        """
        SELECT *
        FROM ml_predictions_daily
        WHERE date = ?
          AND symbol IN ('SPY', 'QQQ')
        ORDER BY symbol, horizon_days
        """,
        (as_of_date,),
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    def parse_json(value: Any, fallback: Any):
        if value is None:
            return fallback
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(value)
        except Exception:
            return fallback

    sym_data: Dict[str, Dict[str, Any]] = {"SPY": {}, "QQQ": {}}
    action_mode = None
    action_text = None
    action_reasons: List[str] = []

    for sym in ["SPY", "QQQ"]:
        r_sym = [r for r in rows if str(r.get("symbol")) == sym]
        if not r_sym:
            continue
        r5 = next((r for r in r_sym if int(r.get("horizon_days") or 0) == 5), r_sym[0])

        pred2 = r5.get("pred_up_2d")
        pred5 = r5.get("pred_up_5d")
        pred10 = r5.get("pred_up_10d")

        # Fallback from per-horizon rows if aggregate columns are empty.
        if pred2 is None:
            rr = next((r for r in r_sym if int(r.get("horizon_days") or 0) == 2), None)
            pred2 = rr.get("up_prob") if rr else None
        if pred5 is None:
            rr = next((r for r in r_sym if int(r.get("horizon_days") or 0) == 5), None)
            pred5 = rr.get("up_prob") if rr else None
        if pred10 is None:
            rr = next((r for r in r_sym if int(r.get("horizon_days") or 0) == 10), None)
            pred10 = rr.get("up_prob") if rr else None

        top_payload = parse_json(r5.get("top_features_json"), {})
        recent_payload = parse_json(r5.get("recent_metrics_json"), {})
        metrics_payload = parse_json(r5.get("metrics_json"), {})

        drivers = []
        if isinstance(top_payload, dict):
            drivers = (top_payload.get("label_up_5d") or top_payload.get("label_up") or top_payload.get("label_down5") or [])[:5]
        elif isinstance(top_payload, list):
            drivers = top_payload[:5]

        sym_data[sym] = {
            "preds": {
                "pred_up_2d": float(pred2 or 0.5),
                "pred_up_5d": float(pred5 or 0.5),
                "pred_up_10d": float(pred10 or 0.5),
                "label_2d": "Bullish" if float(pred2 or 0.5) >= 0.55 else ("Bearish" if float(pred2 or 0.5) <= 0.45 else "Neutral"),
                "label_5d": "Bullish" if float(pred5 or 0.5) >= 0.55 else ("Bearish" if float(pred5 or 0.5) <= 0.45 else "Neutral"),
                "label_10d": "Bullish" if float(pred10 or 0.5) >= 0.55 else ("Bearish" if float(pred10 or 0.5) <= 0.45 else "Neutral"),
                "confidence_label": str(r5.get("confidence_label") or "LOW"),
            },
            "tail": {
                "prob_mdd_le_3_5d": float(r5.get("prob_mdd_le_3_5d") or r5.get("down3_prob") or 0.5),
                "prob_mdd_le_5_5d": float(r5.get("prob_mdd_le_5_5d") or r5.get("down5_prob") or 0.5),
                "prob_vol_high_5d": float(r5.get("vol_high_prob") or 0.5),
            },
            "metrics": recent_payload if isinstance(recent_payload, dict) and recent_payload else (metrics_payload.get("recent") if isinstance(metrics_payload, dict) else {}),
            "drivers": drivers,
            "model_version": str(r5.get("model_version") or "ml_pred_v2.1"),
        }

        if action_mode is None:
            action_mode = r5.get("action_mode")
        if action_text is None:
            action_text = r5.get("action_text_ko")
        if not action_reasons:
            action_reasons = parse_json(r5.get("action_reasons_json"), [])
            if not isinstance(action_reasons, list):
                action_reasons = []

    spy_60_2 = ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("up_2d", {}) or {}).get("acc_60d")
    spy_60_5 = ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("up_5d", {}) or {}).get("acc_60d")
    spy_60_10 = ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("up_10d", {}) or {}).get("acc_60d")
    qqq_60_2 = ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("up_2d", {}) or {}).get("acc_60d")
    qqq_60_5 = ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("up_5d", {}) or {}).get("acc_60d")
    qqq_60_10 = ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("up_10d", {}) or {}).get("acc_60d")

    def _avg(a, b):
        vals = [x for x in [a, b] if isinstance(x, (int, float))]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 4)

    recent_strip = {
        "window_days": 60,
        "symbols": {
            "SPY": {
                "direction_hit_rate_60d": {
                    "2d": spy_60_2,
                    "5d": spy_60_5,
                    "10d": spy_60_10,
                },
                "direction_hit_rate_20d": {
                    "2d": ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("up_2d", {}) or {}).get("acc_20d"),
                    "5d": ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("up_5d", {}) or {}).get("acc_20d"),
                    "10d": ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("up_10d", {}) or {}).get("acc_20d"),
                },
                "tail_risk_5d": {
                    "threshold": ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("mdd_le_5_5d", {}) or {}).get("tail_signal_threshold"),
                    "signal_count_60d": ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("mdd_le_5_5d", {}) or {}).get("tail_signal_count_60d"),
                    "hit_rate_60d": ((sym_data.get("SPY", {}).get("metrics", {}) or {}).get("mdd_le_5_5d", {}) or {}).get("tail_signal_hit_rate_60d"),
                },
            },
            "QQQ": {
                "direction_hit_rate_60d": {
                    "2d": qqq_60_2,
                    "5d": qqq_60_5,
                    "10d": qqq_60_10,
                },
                "direction_hit_rate_20d": {
                    "2d": ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("up_2d", {}) or {}).get("acc_20d"),
                    "5d": ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("up_5d", {}) or {}).get("acc_20d"),
                    "10d": ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("up_10d", {}) or {}).get("acc_20d"),
                },
                "tail_risk_5d": {
                    "threshold": ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("mdd_le_5_5d", {}) or {}).get("tail_signal_threshold"),
                    "signal_count_60d": ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("mdd_le_5_5d", {}) or {}).get("tail_signal_count_60d"),
                    "hit_rate_60d": ((sym_data.get("QQQ", {}).get("metrics", {}) or {}).get("mdd_le_5_5d", {}) or {}).get("tail_signal_hit_rate_60d"),
                },
            },
        },
        "overall": {
            "direction_hit_rate_60d": {
                "2d": _avg(spy_60_2, qqq_60_2),
                "5d": _avg(spy_60_5, qqq_60_5),
                "10d": _avg(spy_60_10, qqq_60_10),
            }
        },
    }

    return {
        "date": as_of_date,
        "spy": sym_data.get("SPY", {}),
        "qqq": sym_data.get("QQQ", {}),
        "recent_strip": recent_strip,
        "action": {
            "mode": action_mode or "NEUTRAL",
            "text_ko": action_text or "중립 운영을 유지하세요.",
            "reasons": action_reasons,
        },
        "data_version": "ml_prediction_v2.1",
        "generated_at": now_iso(),
        "rerun_hint": "python backend/scripts/build_ml_prediction.py",
    }


def build_smart_money_cache(conn: sqlite3.Connection) -> Dict[str, Any]:
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    }
    if "signals" not in tables:
        return {
            "date": None,
            "top": [],
            "watch": [],
            "sectors": {"top": [], "bottom": [], "all": []},
            "coverage": {},
            "count": 0,
            "data_version": "smart_money_v1",
            "generated_at": now_iso(),
            "rerun_hint": "python backend/scripts/build_smart_money.py",
            "note": "signals table not found",
        }

    latest_row = conn.execute(
        "SELECT MAX(date) FROM signals WHERE signal_type='SMART_MONEY'"
    ).fetchone()
    target_date = latest_row[0] if latest_row else None
    if not target_date:
        return {
            "date": None,
            "top": [],
            "watch": [],
            "sectors": {"top": [], "bottom": [], "all": []},
            "coverage": {},
            "count": 0,
            "data_version": "smart_money_v1",
            "generated_at": now_iso(),
            "rerun_hint": "python backend/scripts/build_smart_money.py",
            "note": "no SMART_MONEY rows found",
        }

    rows = conn.execute(
        """
        SELECT symbol, score, payload_json, created_at
        FROM signals
        WHERE signal_type='SMART_MONEY'
          AND date=?
        ORDER BY score DESC, id DESC
        LIMIT 200
        """,
        (target_date,),
    ).fetchall()

    items: List[Dict[str, Any]] = []
    coverage: Dict[str, Any] = {}
    data_version = "smart_money_v1"

    for idx, r in enumerate(rows, start=1):
        symbol = str(r[0] or "")
        score = float(r[1] or 0.0)
        payload = safe_parse_payload(r[2])
        item = {}
        if isinstance(payload, dict):
            maybe_item = payload.get("item")
            if isinstance(maybe_item, dict):
                item = dict(maybe_item)
            maybe_cov = payload.get("meta", {}).get("coverage") if isinstance(payload.get("meta"), dict) else None
            if not coverage and isinstance(maybe_cov, dict):
                coverage = dict(maybe_cov)
            if isinstance(payload.get("meta"), dict):
                data_version = str(payload["meta"].get("data_version") or data_version)

        if not item:
            item = {"symbol": symbol, "score": score, "tags": []}
        item["symbol"] = item.get("symbol") or symbol
        item["score"] = float(item.get("score") if item.get("score") is not None else score)
        item["rank"] = int(item.get("rank") or idx)
        items.append(item)

    items = sorted(
        items,
        key=lambda x: (
            float(x.get("score") or 0.0),
            float(x.get("vol_ratio") or 0.0),
            float(x.get("rs_3m") or -99.0),
        ),
        reverse=True,
    )
    for i, item in enumerate(items, start=1):
        item["rank"] = i

    # Sector summary from current rows (fallback when payload has no sectors).
    sector_bucket: Dict[str, List[float]] = {}
    for item in items:
        sec = str(item.get("sector") or "Unknown")
        sector_bucket.setdefault(sec, []).append(float(item.get("score") or 0.0))
    sector_all = [
        {"sector": sec, "count": len(vals), "avg_score": round(sum(vals) / len(vals), 2)}
        for sec, vals in sector_bucket.items()
        if vals
    ]
    sector_top = sorted(sector_all, key=lambda x: (x["avg_score"], x["count"]), reverse=True)[:3]
    sector_bottom = sorted(sector_all, key=lambda x: (x["avg_score"], -x["count"]))[:3]

    return {
        "date": target_date,
        "top": items[:20],
        "watch": items[20:50],
        "sectors": {
            "top": sector_top,
            "bottom": sector_bottom,
            "all": sorted(sector_all, key=lambda x: (x["avg_score"], x["count"]), reverse=True),
        },
        "coverage": coverage,
        "count": len(items),
        "data_version": data_version,
        "generated_at": now_iso(),
        "rerun_hint": "python backend/scripts/build_smart_money.py",
    }


def _hot_zone_path() -> str:
    """Locate hot_zone.json from output/ directory."""
    candidates = [
        os.path.join(repo_root(), "output", "hot_zone.json"),
        os.path.join(repo_root(), "backend", "output", "hot_zone.json"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    # fallback: relative to scripts dir
    return os.path.join(os.path.dirname(__file__), "..", "output", "hot_zone.json")


def _reason_text(item: Dict[str, Any]) -> str:
    """Generate Korean 1-line reason from top-2 triggers."""
    triggers = (item.get("triggers") or [])[:2]
    vol = item.get("vol_ratio") or item.get("volume_ratio")
    ai = item.get("ai_score", 0) or 0
    label_map: Dict[str, str] = {
        "3D_UP": "3일 연속 상승",
        "VOLUME_2X": f"거래량 {vol:.1f}x 급증" if vol else "거래량 급증",
        "RSI>70": "RSI 과매수권",
        "NEW_HIGH_20D": "20일 신고가",
        "AI_SCORE_90+": f"AI Score {ai}+",
        "GAP_UP": "갭 상승",
    }
    parts = [label_map.get(t, t) for t in triggers if t]
    return " · ".join(parts) if parts else "주목 종목"


def _normalize_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a hot_zone item to the overview_home schema."""
    symbol = item.get("symbol") or item.get("ticker", "")
    triggers = item.get("triggers") or []
    return {
        "symbol": symbol,
        "name": item.get("name") or symbol,
        "pct_change_1d": item.get("change_pct") or item.get("change_1d") or item.get("ret1d") or 0.0,
        "hot_score": int(item.get("hot_score") or 0),
        "triggers": triggers[:2],  # top-2 for UI
        "triggers_all": triggers,
        "streak": int(item.get("streak") or 0),
        "price": item.get("price") or item.get("close"),
        "volume_ratio": item.get("vol_ratio") or item.get("volume_ratio"),
        "ai_score": int(item.get("ai_score") or 0),
        "rsi14": item.get("rsi14") or item.get("rsi"),
        "tags": item.get("tags") or [],
        "reason_text": item.get("reason_text") or _reason_text(item),
    }


def build_overview_home() -> Dict[str, Any]:
    """Build HOT 3-panel data from hot_zone.json for main dashboard."""
    hz_path = _hot_zone_path()
    hz: Dict[str, Any] = {}
    if os.path.exists(hz_path):
        try:
            with open(hz_path, "r", encoding="utf-8") as f:
                hz = json.load(f)
        except Exception:
            hz = {}

    # Collect pool from leaders + trending (both v1 and v2 keys)
    all_items: List[Dict[str, Any]] = []
    seen: set = set()
    for key in ("leaders", "trending", "gainers", "ai_picks", "volume_spike", "etf_leaders"):
        for item in hz.get(key, []):
            sym = item.get("symbol") or item.get("ticker", "")
            if sym and sym not in seen:
                all_items.append(item)
                seen.add(sym)

    normalized = [_normalize_item(i) for i in all_items]

    # HOT Top5: sort by hot_score desc
    hot_top5 = sorted(normalized, key=lambda x: -(x["hot_score"]))[:5]

    # Volume Spike Top5: sort by volume_ratio desc
    volume_spike_top5 = sorted(
        [x for x in normalized if x["volume_ratio"] is not None],
        key=lambda x: -(x["volume_ratio"] or 0),
    )[:5]

    # AI Picks Top5: sort by ai_score desc
    ai_picks_top5 = sorted(normalized, key=lambda x: -(x["ai_score"]))[:5]

    # Streak Hot Top10: sort by streak desc, then hot_score
    streak_hot_top10 = sorted(
        [x for x in normalized if x["streak"] >= 1],
        key=lambda x: (-x["streak"], -x["hot_score"]),
    )[:10]

    return {
        "generated_at": now_iso(),
        "source": hz_path if os.path.exists(hz_path) else None,
        "hot_top5": hot_top5,
        "volume_spike_top5": volume_spike_top5,
        "ai_picks_top5": ai_picks_top5,
        "streak_hot_top10": streak_hot_top10,
        "total_pool": len(normalized),
    }


def build_etf_room_cache() -> Optional[str]:
    """
    Ensure etf_room.json exists in backend/output/.
    If the file is already present (written by build_etf_room.py earlier in the
    pipeline), this is a no-op.  If it's missing we call the script directly so
    build_cache_json.py remains self-contained.
    Returns the output path, or None on failure.
    """
    import subprocess
    import sys

    etf_path = os.path.join(repo_root(), "backend", "output", "etf_room.json")
    if os.path.exists(etf_path):
        return etf_path

    script = os.path.join(repo_root(), "backend", "scripts", "build_etf_room.py")
    if not os.path.exists(script):
        print("[WARN] build_etf_room.py not found – skipping ETF room cache.")
        return None
    try:
        result = subprocess.run(
            [sys.executable, "-X", "utf8", script],
            capture_output=True,
            timeout=120,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode == 0:
            return etf_path
        print(f"[WARN] build_etf_room.py exited {result.returncode}: {result.stderr.strip()[-200:]}")
    except Exception as e:
        print(f"[WARN] build_etf_room.py failed: {e}")
    return None


def main() -> int:
    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    os.makedirs(cache_dir(), exist_ok=True)

    conn = sqlite3.connect(path)
    try:
        normalize_daily_snapshot_dates(conn)
        overview = build_overview(conn)
        snapshots = build_snapshots_120d(conn)
        alerts = build_alerts_recent(conn)
        ml_prediction = build_ml_prediction_cache(conn)
        smart_money = build_smart_money_cache(conn)
        overview_home = build_overview_home()

        overview_path = os.path.join(cache_dir(), "overview.json")
        snapshots_path = os.path.join(cache_dir(), "snapshots_120d.json")
        alerts_path = os.path.join(cache_dir(), "alerts_recent.json")
        ml_prediction_path = os.path.join(cache_dir(), "ml_prediction.json")
        smart_money_path = os.path.join(cache_dir(), "smart_money.json")
        overview_home_path = os.path.join(cache_dir(), "overview_home.json")
        holdings_ts_src = os.path.join(repo_root(), "backend", "output", "my_holdings_ts.json")
        holdings_goal_src = os.path.join(repo_root(), "backend", "output", "my_holdings_goal.json")
        holdings_tabs_src = os.path.join(repo_root(), "backend", "output", "my_holdings_tabs.json")
        holdings_ts_dst = os.path.join(cache_dir(), "my_holdings_ts.json")
        holdings_goal_dst = os.path.join(cache_dir(), "my_holdings_goal.json")
        holdings_tabs_dst = os.path.join(cache_dir(), "my_holdings_tabs.json")

        write_json(overview_path, overview)
        write_json(snapshots_path, snapshots)
        write_json(alerts_path, alerts)
        write_json(ml_prediction_path, ml_prediction)
        write_json(smart_money_path, smart_money)
        write_json(overview_home_path, overview_home)

        # Copy holdings time-series caches if present (cache-only)
        for src, dst in [
            (holdings_ts_src, holdings_ts_dst),
            (holdings_goal_src, holdings_goal_dst),
            (holdings_tabs_src, holdings_tabs_dst),
        ]:
            if os.path.exists(src):
                shutil.copyfile(src, dst)

        # ETF Room — ensure cache exists (runs build_etf_room.py if needed)
        etf_room_path = build_etf_room_cache()

        print("============================================================")
        print("build_cache_json.py")
        print(f"[OK] {overview_path} (rows=1)")
        print(f"[OK] {snapshots_path} (rows={snapshots['count']})")
        print(f"[OK] {alerts_path} (rows={alerts['count']})")
        ml_rows = int(bool(ml_prediction.get("spy"))) + int(bool(ml_prediction.get("qqq")))
        print(f"[OK] {ml_prediction_path} (rows={ml_rows})")
        sm_rows = int(smart_money.get("count") or 0)
        print(f"[OK] {smart_money_path} (rows={sm_rows})")
        print(f"[OK] {overview_home_path} "
              f"(hot={len(overview_home['hot_top5'])}, "
              f"vol={len(overview_home['volume_spike_top5'])}, "
              f"ai={len(overview_home['ai_picks_top5'])}, "
              f"streak={len(overview_home['streak_hot_top10'])})")
        if os.path.exists(holdings_ts_dst):
            print(f"[OK] {holdings_ts_dst}")
        if etf_room_path:
            print(f"[OK] {etf_room_path}")
        else:
            print("[WARN] etf_room.json not generated (run build_etf_room.py manually)")
        print("============================================================")
        return 0
    except Exception as e:
        print(f"[FATAL] build_cache_json failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
