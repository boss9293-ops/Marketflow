"""
FRED4-first Macro Layer percentile pipeline (scaffold / MVP stub).

Purpose:
- Load versioned macro policy from backend/config/macro_v1.json
- Provide deterministic, policy-driven transform/percentile/index helpers
- Emit stable summary/detail contract skeleton even when data is partial

This file is intentionally backend-only and safe to call from future cron jobs/APIs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


SCRIPTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPTS_DIR.parent
CONFIG_DIR = BACKEND_DIR / "config"
OUTPUT_CACHE_DIR = BACKEND_DIR / "output" / "cache"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def load_macro_policy(path: Optional[Path] = None) -> Dict[str, Any]:
    p = path
    if p is None:
        p2 = CONFIG_DIR / "macro_policy_v1.json"
        p = p2 if p2.exists() else (CONFIG_DIR / "macro_v1.json")
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def winsorize(values: List[float], low_pct: float = 1.0, high_pct: float = 99.0) -> List[float]:
    if not values:
        return []
    xs = sorted(v for v in values if isinstance(v, (int, float)))
    if not xs:
        return []
    n = len(xs)
    lo_idx = int((low_pct / 100.0) * (n - 1))
    hi_idx = int((high_pct / 100.0) * (n - 1))
    lo_v = xs[lo_idx]
    hi_v = xs[hi_idx]
    return [float(clamp(v, lo_v, hi_v)) for v in values]


def empirical_rank_percentile(window: List[float], x: float) -> Optional[float]:
    """
    pct = 100 * (rank(x) - 1) / (N - 1)
    rank uses count of <= x (1-indexed style equivalent).
    """
    xs = [float(v) for v in window if isinstance(v, (int, float))]
    if x is None or len(xs) == 0:
        return None
    if len(xs) == 1:
        return 50.0
    xs_sorted = sorted(xs)
    rank = sum(1 for v in xs_sorted if v <= x)
    return 100.0 * (rank - 1) / (len(xs_sorted) - 1)


def pct_change(values: List[float], window: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(values)
    for i in range(window, len(values)):
        prev = values[i - window]
        cur = values[i]
        if prev is None or cur is None or prev == 0:
            out[i] = None
            continue
        out[i] = ((cur / prev) - 1.0) * 100.0
    return out


def bp_change(values: List[float], window: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(values)
    for i in range(window, len(values)):
        prev = values[i - window]
        cur = values[i]
        if prev is None or cur is None:
            out[i] = None
            continue
        out[i] = (cur - prev) * 100.0  # % -> bp
    return out


def level(values: List[float]) -> List[Optional[float]]:
    return [None if v is None else float(v) for v in values]


def apply_transform(values: List[float], transform: Dict[str, Any]) -> List[Optional[float]]:
    t = (transform or {}).get("type", "level")
    if t == "level":
        out = level(values)
    elif t == "pct_change":
        out = pct_change(values, int(transform.get("window", 1)))
    elif t == "bp_change":
        out = bp_change(values, int(transform.get("window", 1)))
    else:
        raise ValueError(f"Unsupported transform type: {t}")

    # Safety patch: allow ABS shock transforms (e.g., RRP 20D change shock percentile)
    pp = (transform or {}).get("postprocess") or {}
    if pp.get("abs"):
        out = [None if v is None else abs(float(v)) for v in out]
    return out


def direction_adjust(v: Optional[float], direction: int) -> Optional[float]:
    if v is None:
        return None
    if direction == 0:
        return float(v)
    return float(v) * float(direction)


@dataclass
class FeaturePoint:
    feature_id: str
    raw_value: Optional[float]
    transformed_value: Optional[float]
    pct: Optional[float]
    lookback_n: int
    min_samples: int
    data_limited: bool


def compute_feature_percentile_series(
    feature_id: str,
    series_values: List[float],
    feature_cfg: Dict[str, Any],
    policy: Dict[str, Any],
    lookback_ref_points: int,
    min_samples: int,
) -> List[FeaturePoint]:
    transformed = apply_transform(series_values, feature_cfg.get("transform", {}))
    direction = int(feature_cfg.get("direction", 1))
    adjusted = [direction_adjust(v, direction) for v in transformed]
    adjusted_num = [v for v in adjusted if isinstance(v, (int, float))]

    if feature_cfg.get("winsorize", False) and adjusted_num:
        wz_cfg = policy.get("winsorize", {})
        wins = winsorize(adjusted_num, float(wz_cfg.get("low_pct", 1)), float(wz_cfg.get("high_pct", 99)))
        it = iter(wins)
        adjusted = [next(it) if isinstance(v, (int, float)) else None for v in adjusted]

    out: List[FeaturePoint] = []
    for i, v in enumerate(adjusted):
        raw_v = series_values[i] if i < len(series_values) else None
        if v is None:
            out.append(
                FeaturePoint(feature_id, raw_v if raw_v is not None else None, None, None, 0, min_samples, True)
            )
            continue
        hist = [x for x in adjusted[max(0, i - lookback_ref_points + 1): i + 1] if x is not None]
        pct = empirical_rank_percentile(hist, v) if hist else None
        out.append(
            FeaturePoint(
                feature_id=feature_id,
                raw_value=float(raw_v) if raw_v is not None else None,
                transformed_value=float(v),
                pct=float(pct) if pct is not None else None,
                lookback_n=len(hist),
                min_samples=min_samples,
                data_limited=len(hist) < min_samples,
            )
        )
    return out


def weighted_score(parts: List[Tuple[Optional[float], float]]) -> Optional[float]:
    vals = [(v, w) for v, w in parts if v is not None and w > 0]
    if not vals:
        return None
    sw = sum(w for _, w in vals)
    if sw <= 0:
        return None
    return sum(v * w for v, w in vals) / sw


def state_from_bins(value: Optional[float], bins: List[Dict[str, Any]]) -> Optional[str]:
    if value is None:
        return None
    for b in bins or []:
        if value <= float(b.get("max", 100)):
            return str(b.get("state"))
    return str((bins or [{}])[-1].get("state")) if bins else None


def confidence_badge(conf: int, ui_cfg: Dict[str, Any]) -> str:
    badges = (ui_cfg or {}).get("badges", {})
    if conf >= 80:
        return badges.get("conf_ge_80", "Normal")
    if conf >= 50:
        return badges.get("conf_ge_50", "Data limited")
    return badges.get("conf_lt_50", "Partial")


def _empty_driver(feature_id: str, note: str = "") -> Dict[str, Any]:
    return {
        "feature_id": feature_id,
        "series_id": None,
        "raw_value": None,
        "raw_unit": None,
        "transformed_value": None,
        "transformed_unit": None,
        "direction": None,
        "winsorized": True,
        "percentile_5y": None,
        "percentile": None,  # backward-compatible alias
        "static_band_key": None,
        "static_band_label": None,
        "note": note,
        "last_value_date": None,
        "last_updated": None,  # backward-compatible alias
        "stale": False,
    }


def _series_source_label(series_key: str) -> str:
    # FRED4-first scope sources
    mapping = {
        "WALCL": "FRED:WALCL",
        "RRP": "FRED:RRPONTSYD",
        "EFFR": "FRED:EFFR",
        "VIX": "FRED:VIXCLS / CBOE VIX (configured source)",
        "QQQ": "YahooFinance:QQQ",
        "BTC": "Internal market data source (configured)",
        "GOLD": "Internal market data source (configured)",
    }
    return mapping.get(series_key, f"Configured:{series_key}")


def _feature_formula_text(feature_id: str, feature_cfg: Dict[str, Any]) -> str:
    series = str(feature_cfg.get("series", "?"))
    tfm = feature_cfg.get("transform", {}) or {}
    t = str(tfm.get("type", "level"))
    if t == "level":
        base = f"{series} level"
    elif t == "pct_change":
        base = f"{series} % change ({tfm.get('window', '?')})"
    elif t == "bp_change":
        base = f"{series} bp change ({tfm.get('window', '?')})"
    else:
        base = f"{series} {t}"

    if ((tfm.get("postprocess") or {}).get("abs")):
        base = f"ABS({base})"

    direction = int(feature_cfg.get("direction", 0) or 0)
    if direction == -1:
        base = f"-1 * {base}"
    elif direction == 1:
        base = f"+1 * {base}"

    return f"{feature_id}: rank percentile over rolling lookback of {base}"


def _index_formula_text(index_key: str, index_cfg: Dict[str, Any]) -> str:
    comps = (index_cfg.get("components") or [])
    if not comps:
        return f"{index_key} composite (no components configured)"
    parts = []
    for c in comps:
        w = c.get("weight")
        feat = c.get("feature") or c.get("index") or "?"
        parts.append(f"{w}*pct({feat})")
    return " + ".join(parts)


def _build_explain_bundle(policy: Dict[str, Any], now_date: str) -> Dict[str, Any]:
    idx_cfg = policy.get("indexes", {}) or {}
    feat_cfg = policy.get("features", {}) or {}
    series_cfg = policy.get("series", {}) or {}
    mps_cfg = policy.get("mps", {}) or {}

    layer_explain: Dict[str, Any] = {}
    for key in ["LPI", "RPI", "VRI"]:
        cfg = (idx_cfg.get(key) or {})
        comps = cfg.get("components") or []
        inputs = []
        sources = []
        for c in comps:
            feat_id = str(c.get("feature", ""))
            fcfg = feat_cfg.get(feat_id) or {}
            s_key = str(fcfg.get("series", ""))
            if s_key:
                sources.append(_series_source_label(s_key))
            inputs.append({
                "name": feat_id,
                "series": s_key or None,
                "weight": c.get("weight"),
                "formula": _feature_formula_text(feat_id, fcfg) if fcfg else None,
                "value": None,
                "pct": None,
                "quality": "Partial",
            })

        layer_explain[key] = {
            "state": None,
            "score": None,
            "asof": now_date,
            "stale": False,
            "source": sorted(set(sources)),
            "update_rule": "daily close; weekly series forward-filled (WALCL).",
            "formula": _index_formula_text(key, cfg),
            "bins": cfg.get("state_bins", []),
            "inputs": inputs,
        }

    mps_inputs = []
    for c in (mps_cfg.get("components") or []):
        mps_inputs.append({
            "name": c.get("index"),
            "weight": c.get("weight"),
            "value": None,
            "pct": None,
            "quality": "Partial",
        })

    mps_explain = {
        "state": None,
        "score": None,
        "asof": now_date,
        "stale": False,
        "source": ["Macro Layer composites: LPI/RPI/VRI"],
        "update_rule": "derived from Macro Layer composites; XCONF excluded from MPS.",
        "formula": " + ".join([f"{c.get('weight')}*{c.get('index')}" for c in (mps_cfg.get('components') or [])]),
        "bins": mps_cfg.get("state_bins", []),
        "inputs": mps_inputs,
    }

    series_meta = {}
    for s_key, scfg in series_cfg.items():
        series_meta[s_key] = {
            "source": _series_source_label(str(s_key)),
            "frequency": scfg.get("frequency"),
            "stale_days": scfg.get("stale_days"),
            "min_samples": scfg.get("min_samples"),
            "update_rule": "daily close" if scfg.get("frequency") == "daily" else "weekly release; forward-fill to business days",
        }

    return {
        "schema_version": "explain_v1",
        "layers": layer_explain,
        "mps": mps_explain,
        "series": series_meta,
    }


def _get_live_snapshot() -> Dict[str, Any]:
    """Read the actual computed macro values from the latest snapshot."""
    for p in [
        BACKEND_DIR / "data" / "snapshots" / "macro_snapshot_latest.json",
        BACKEND_DIR / "storage" / "macro_snapshots" / "macro_snapshot_latest.json"
    ]:
        if p.exists():
            try:
                with p.open("r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def build_contract_stub(policy: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stable macro contract skeleton for UI/API integration before full FRED ingestion.
    """
    now = utc_now_iso()
    mps_bins = policy.get("mps", {}).get("state_bins", [])
    ui_cfg = policy.get("ui", {})
    idx_cfg = policy.get("indexes", {})
    layer_keys = ["LPI", "RPI", "VRI"]
    explain_bundle = _build_explain_bundle(policy, now[:10])

    live_snap = _get_live_snapshot()
    comp = live_snap.get("computed", {})
    
    mps_data = comp.get("MPS", {})
    mps_score = mps_data.get("value")
    if isinstance(mps_score, float):
        mps_score = round(mps_score, 2)
        
    mps_state = mps_data.get("state") or state_from_bins(mps_score, mps_bins)
    quality_overall = comp.get("quality_overall") or mps_data.get("quality") or "Partial"
    confidence = 80 if quality_overall == "OK" else 50

    layers_summary = {}
    layers_detail = {}
    for k in layer_keys:
        k_data = comp.get(k, {})
        k_score = k_data.get("value")
        if isinstance(k_score, float):
            k_score = round(k_score, 2)
            
        layers_summary[k] = {
            "score": k_score,
            "state": k_data.get("state"),
            "confidence": confidence
        }

        comps = ((idx_cfg.get(k) or {}).get("components") or [])
        drivers = [
            _empty_driver(str(c.get("feature")), note=f"{k} driver (from live snapshot)")
            for c in comps
        ]
        layers_detail[k] = {
            "label": (idx_cfg.get(k) or {}).get("label", k),
            "score": k_score,
            "state": k_data.get("state"),
            "confidence": confidence,
            "drivers": drivers,
            "explain": explain_bundle["layers"].get(k),
        }

    data_date = live_snap.get("snapshot_date") or now[:10]

    return {
        "version": policy.get("version", "macro_policy_v1"),
        "mode": "live" if mps_score is not None else "fred4_first",
        "status": "ok" if mps_score is not None else "stub",
        "generated_at": now,
        "summary": {
            "policy_version": policy.get("version", "macro_policy_v1"),
            "asof_date": data_date,
            "macro_pressure": {
                "score": mps_score,
                "state": mps_state,
                "confidence": confidence,
                "bar": {"min": 0, "max": 100},
            },
            "indexes": layers_summary,
            "exposure_modifier": {
                "upper_cap_delta_pct": 0,
                "reasons": [],
                "rule_flags": {
                    "mps_ge_70": mps_score is not None and mps_score >= 70,
                    "mps_ge_85": mps_score is not None and mps_score >= 85,
                    "lpi_tight_and_vri_expanding": False,
                },
            },
            "series_status": {
                "WALCL": {"last_value_date": None, "last_updated_at": None, "stale": False, "frequency": "weekly"},
                "RRP": {"last_value_date": None, "last_updated_at": None, "stale": False, "frequency": "daily"},
                "EFFR": {"last_value_date": None, "last_updated_at": None, "stale": False, "frequency": "daily"},
                "VIX": {"last_value_date": None, "last_updated_at": None, "stale": False, "frequency": "daily"},
            },
            "governance": {
                "schema_version": explain_bundle["schema_version"],
                "series": explain_bundle["series"],
            },
        },
        "detail": {
            "policy_version": policy.get("version", "macro_policy_v1"),
            "asof_date": data_date,
            "macro_pressure": {
                "score": mps_score,
                "state": mps_state,
                "confidence": confidence,
            },
            "macro_pressure_explain": explain_bundle["mps"],
            "layers": layers_detail,
            "explain_standard": {
                "schema_version": explain_bundle["schema_version"],
                "required_fields": ["source", "asof", "stale", "formula", "bins", "inputs"],
            },
            "confidence_debug": {
                "noisy_flag": False,
                "penalties_applied": [],
            },
        },
    }


def write_stub_outputs() -> Dict[str, Path]:
    policy = load_macro_policy()
    payload = build_contract_stub(policy)
    OUTPUT_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    summary_path = OUTPUT_CACHE_DIR / "macro_summary.json"
    detail_path = OUTPUT_CACHE_DIR / "macro_detail.json"
    layer_path = OUTPUT_CACHE_DIR / "macro_layer.json"

    # Preserve current frontend compatibility (`macro_layer.json`) with a minimal summary projection.
    macro_layer_projection = {
      "data_date": payload["generated_at"][:10],
      "macro_pressure_score": payload["summary"]["macro_pressure"]["score"],
      "status": payload["status"],
      "mode": payload["mode"],
      "version": payload["version"],
    }

    summary_path.write_text(json.dumps(payload["summary"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    detail_path.write_text(json.dumps(payload["detail"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    layer_path.write_text(json.dumps(macro_layer_projection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {
        "summary": summary_path,
        "detail": detail_path,
        "macro_layer": layer_path,
    }


if __name__ == "__main__":
    paths = write_stub_outputs()
    print("Macro FRED4 scaffold outputs written:")
    for k, p in paths.items():
        print(f"  - {k}: {p}")
