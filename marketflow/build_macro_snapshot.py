from __future__ import annotations

import datetime as dt
import json
import math
import os
import time
from typing import Any, Dict, List, Tuple

from backend.services.cache_store import CacheStore

SNAP_DIR = os.path.join("data", "snapshots")
LATEST_PATH = os.path.join(SNAP_DIR, "macro_snapshot_latest.json")
ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
POLICY_PATH = os.path.join(ROOT_DIR, "config", "macro_policy.json")
ENGINE_LOG_PATH = os.path.join(ROOT_DIR, "logs", "engine.log")

DEFAULT_POLICY: Dict[str, Any] = {
    "shock_weights": {"VRI": 0.35, "CSI": 0.30, "RV20": 0.20, "DD_VEL": 0.15},
    "shock_prob_caps": {"min": 5, "max": 65},
    "shock_state_thresholds": {"low": 15, "moderate": 30, "elevated": 50},
    "mps_weights": {"LPI": 0.35, "RPI": 0.25, "VRI": 0.25, "CSI": 0.15},
    "phase_weights": {"VRI": 0.30, "CSI": 0.25, "RPI": 0.25, "LPI": 0.20},
    "phase_thresholds": {
        "slowdown_gate": 55,
        "contraction_gate": 70,
        "shock_vri": 90,
        "shock_combo_vri": 80,
        "shock_combo_csi": 80,
    },
    "defensive_thresholds": {"mps_watch": 70, "mps_on": 80, "csi_watch": 70, "csi_on": 80},
    "sensor_state_thresholds": {"watch": 60, "stress": 80},
    "percentile_band_thresholds": {"watch": 66, "risk": 85},
}


def ensure_dirs() -> None:
    os.makedirs(SNAP_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(ENGINE_LOG_PATH), exist_ok=True)


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_policy(path: str = POLICY_PATH) -> Dict[str, Any]:
    policy = dict(DEFAULT_POLICY)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                policy = _deep_merge(policy, raw)
        except Exception:
            pass
    return policy


def weighted_score(values: Dict[str, float | None], weights: Dict[str, float], zero_if_missing: List[str] | None = None) -> Tuple[float, Dict[str, float], bool]:
    zero_if_missing = zero_if_missing or []
    contrib: Dict[str, float] = {}
    missing = False
    total = 0.0
    for k, w in weights.items():
        v = values.get(k)
        if v is None:
            if k in zero_if_missing:
                contrib[k] = 0.0
                continue
            missing = True
            continue
        c = float(w) * float(v)
        contrib[k] = round(c, 4)
        total += c
    return round(total, 2), contrib, missing


def compute_shock_probability(shock_raw: float, caps: Dict[str, float]) -> float:
    low = float(caps.get("min", 5))
    high = float(caps.get("max", 65))
    return round(clamp(shock_raw * 0.60, low, high), 2)


def evaluate_phase(lpi: float, rpi: float, vri: float, csi: float, stale_blocked: bool, policy: Dict[str, Any]) -> Tuple[str, float]:
    w = policy.get("phase_weights", DEFAULT_POLICY["phase_weights"])
    t = policy.get("phase_thresholds", DEFAULT_POLICY["phase_thresholds"])
    gate = round(float(w["VRI"]) * vri + float(w["CSI"]) * csi + float(w["RPI"]) * rpi + float(w["LPI"]) * lpi, 2)
    phase = "Expansion"
    if stale_blocked:
        phase = "Slowdown"
    else:
        if (vri >= float(t["shock_vri"])) or (vri >= float(t["shock_combo_vri"]) and csi >= float(t["shock_combo_csi"])):
            phase = "Shock"
        elif gate >= float(t["contraction_gate"]):
            phase = "Contraction"
        elif gate >= float(t["slowdown_gate"]):
            phase = "Slowdown"
    return phase, gate


def evaluate_defensive(phase: str, mps: float, csi: float, stale_blocked: bool, policy: Dict[str, Any]) -> Tuple[str, List[str]]:
    th = policy.get("defensive_thresholds", DEFAULT_POLICY["defensive_thresholds"])
    mode = "OFF"
    reasons: List[str] = []
    if stale_blocked:
        mode = "WATCH"
        reasons.append("Inputs STALE -> conservative WATCH.")
    else:
        if phase in ("Shock", "Contraction"):
            mode = "ON"
            reasons.append(f"Phase={phase} -> Defensive ON.")
        elif phase == "Slowdown":
            mode = "WATCH"
            reasons.append("Phase=Slowdown -> WATCH.")
        else:
            mode = "OFF"
            reasons.append("Phase=Expansion -> OFF.")

    if mps >= float(th["mps_on"]) and mode != "ON":
        mode = "ON"
        reasons.append("MPS>=mps_on -> force ON.")
    elif mps >= float(th["mps_watch"]) and mode == "OFF":
        mode = "WATCH"
        reasons.append("MPS>=mps_watch -> upgrade WATCH.")

    if csi >= float(th["csi_on"]) and mode != "ON":
        mode = "ON"
        reasons.append("CSI>=csi_on -> force ON.")
    elif csi >= float(th["csi_watch"]) and mode == "OFF":
        mode = "WATCH"
        reasons.append("CSI>=csi_watch -> upgrade WATCH.")

    return mode, reasons[:3]


def derive_shock_quality(vri_quality_effective: str, csi_quality_effective: str, csi_available: bool) -> str:
    if "STALE" in (vri_quality_effective, csi_quality_effective):
        return "STALE"
    if not csi_available:
        return "PARTIAL"
    return "OK"


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def percentile(values: List[float], x: float, mode: str) -> float:
    if not values:
        return 0.0
    x = float(x)
    if mode == "HIGH_BAD":
        p = float(sum(1 for v in values if float(v) <= x) / len(values))
    elif mode == "LOW_BAD":
        p = float(sum(1 for v in values if float(v) >= x) / len(values))
    else:
        raise ValueError(f"Unknown mode: {mode}")
    return clamp01(p)


def score_0_100(p: float) -> float:
    return round(clamp01(p) * 100.0, 2)


def status_from_percentile_100(p100: float, thresholds: Dict[str, float] | None = None) -> str:
    t = thresholds or DEFAULT_POLICY["percentile_band_thresholds"]
    risk = float(t.get("risk", 85))
    watch = float(t.get("watch", 66))
    if p100 >= risk:
        return "Risk"
    if p100 >= watch:
        return "Watch"
    return "Normal"


def state_from_score(score: float, thresholds: Dict[str, float] | None = None) -> str:
    t = thresholds or DEFAULT_POLICY["sensor_state_thresholds"]
    stress = float(t.get("stress", 80))
    watch = float(t.get("watch", 60))
    if score >= stress:
        return "Stress"
    if score >= watch:
        return "Watch"
    return "Normal"


def series_diff_n(values: List[float], n: int) -> float:
    if len(values) <= n:
        return 0.0
    return float(values[-1] - values[-1 - n])


def get_series(store: CacheStore, symbol: str, start_date: str, end_date: str) -> List[Tuple[str, float]]:
    return store.get_series_range(symbol, start_date, end_date)


def latest_value(series: List[Tuple[str, float]]) -> float:
    return float(series[-1][1]) if series else 0.0


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(x)))


def build_diff_series(values: List[float], n: int) -> List[float]:
    if len(values) <= n:
        return []
    return [float(values[i] - values[i - n]) for i in range(n, len(values))]


def quality_of(meta: Dict[str, Any] | None, series: List[Tuple[str, float]], min_points: int = 120) -> str:
    if not series:
        return "NA"
    if len(series) < min_points:
        return "PARTIAL"
    if meta and meta.get("quality") in ("OK", "PARTIAL", "NA"):
        return meta["quality"] if meta["quality"] != "NA" else "PARTIAL"
    return "OK"


def parse_iso_utc(s: str) -> dt.datetime | None:
    if not s:
        return None
    t = str(s).strip()
    try:
        if t.endswith("Z"):
            return dt.datetime.fromisoformat(t[:-1]).replace(tzinfo=dt.timezone.utc)
        d = dt.datetime.fromisoformat(t)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc)
    except Exception:
        return None


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def age_minutes_from_meta(meta: Dict[str, Any] | None) -> float | None:
    if not isinstance(meta, dict):
        return None
    t = parse_iso_utc(str(meta.get("last_updated", "")))
    if not t:
        return None
    delta = now_utc() - t
    return round(delta.total_seconds() / 60.0, 2)


STALE_THRESHOLDS_MIN: Dict[str, int] = {
    "QQQ": 60,
    "TQQQ": 60,
    "SPY": 60,
    "VIX": 60,
    "PUT_CALL": 48 * 60,
    "HY_OAS": 48 * 60,
    "WALCL": 72 * 60,
    "M2SL": 72 * 60,
    "RRP": 48 * 60,
    "EFFR": 48 * 60,
    "DFII10": 48 * 60,
    "DGS2": 48 * 60,
    "DGS10": 48 * 60,
    "USD_BROAD": 48 * 60,
}


def compute_series_health(symbol: str, meta: Dict[str, Any] | None) -> Dict[str, Any]:
    age = age_minutes_from_meta(meta)
    th = STALE_THRESHOLDS_MIN.get(symbol, 48 * 60)
    stale = True if age is None else age > float(th)
    base_quality = str((meta or {}).get("quality", "NA")).upper()
    if base_quality not in ("OK", "PARTIAL", "NA"):
        base_quality = "NA"
    quality_effective = "STALE" if stale else base_quality
    return {
        "age_minutes": age,
        "stale": stale,
        "stale_rule": f">{th}m" if age is not None else f"meta_missing>{th}m",
        "base_quality": base_quality,
        "quality_effective": quality_effective,
        "last_updated": (meta or {}).get("last_updated", ""),
        "source": (meta or {}).get("source", "NA"),
    }


def realized_vol_20(closes: List[float]) -> float:
    if len(closes) < 21:
        return 0.0
    rets: List[float] = []
    for i in range(1, len(closes)):
        prev = float(closes[i - 1])
        cur = float(closes[i])
        if prev <= 0 or cur <= 0:
            continue
        r = math.log(cur / prev)
        if math.isfinite(r):
            rets.append(r)
    win = rets[-20:]
    if len(win) < 5:
        return 0.0
    mean = sum(win) / len(win)
    var = sum((x - mean) ** 2 for x in win) / len(win)
    return math.sqrt(max(var, 0.0))


def realized_vol_series_20(closes: List[float]) -> List[float]:
    if len(closes) < 25:
        return []
    out: List[float] = []
    for i in range(21, len(closes) + 1):
        out.append(realized_vol_20(closes[:i]))
    return out


def drawdown_magnitude_series(closes: List[float]) -> List[float]:
    out: List[float] = []
    peak = None
    for c in closes:
        v = float(c)
        if peak is None or v > peak:
            peak = v
        if peak and peak > 0:
            dd = (peak - v) / peak
        else:
            dd = 0.0
        out.append(max(0.0, float(dd)))
    return out


def drawdown_velocity_10(closes: List[float]) -> Tuple[float, List[float]]:
    dd = drawdown_magnitude_series(closes)
    if len(dd) <= 10:
        return 0.0, []
    series = build_diff_series(dd, 10)
    return float(series[-1]), series


def shock_state(prob: float, thresholds: Dict[str, float]) -> str:
    low = float(thresholds.get("low", 15))
    moderate = float(thresholds.get("moderate", 30))
    elevated = float(thresholds.get("elevated", 50))
    if prob >= elevated:
        return "High"
    if prob >= moderate:
        return "Elevated"
    if prob >= low:
        return "Moderate"
    return "Low"


def corr_last_window(x: List[float | None], y: List[float | None], window: int = 360) -> float | None:
    pairs: List[Tuple[float, float]] = []
    for a, b in zip(x, y):
        if a is None or b is None:
            continue
        if not (math.isfinite(float(a)) and math.isfinite(float(b))):
            continue
        pairs.append((float(a), float(b)))
    if len(pairs) < 30:
        return None
    if len(pairs) > window:
        pairs = pairs[-window:]
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    den_x = math.sqrt(sum((a - mx) ** 2 for a in xs))
    den_y = math.sqrt(sum((b - my) ** 2 for b in ys))
    den = den_x * den_y
    if den == 0:
        return None
    return num / den


def main() -> None:
    ensure_dirs()
    policy = load_policy()
    sensor_state_thresholds = policy.get("sensor_state_thresholds", DEFAULT_POLICY["sensor_state_thresholds"])
    percentile_band_thresholds = policy.get("percentile_band_thresholds", DEFAULT_POLICY["percentile_band_thresholds"])
    build_start = time.perf_counter()
    store = CacheStore()
    asof = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    end_date = dt.date.today().isoformat()
    start_date = (dt.date.today() - dt.timedelta(days=365 * 3 + 45)).isoformat()

    sensor_latency_ms: Dict[str, float] = {}

    def load_symbol(symbol: str) -> Tuple[Dict[str, Any] | None, List[Tuple[str, float]]]:
        t0 = time.perf_counter()
        meta = store.get_meta(symbol)
        series = get_series(store, symbol, start_date, end_date)
        sensor_latency_ms[symbol] = round((time.perf_counter() - t0) * 1000.0, 2)
        return meta, series

    meta_vix, s_vix = load_symbol("VIX")
    if not s_vix:
        meta_vix, s_vix = load_symbol("VIXCLS")
    if not s_vix:
        raise RuntimeError("snapshot abort: VIX series missing (policy: abort)")
    vix_vals = [v for _, v in s_vix]
    meta_pc, s_pc = load_symbol("PUT_CALL")
    pc_vals = [v for _, v in s_pc]
    q_pc = quality_of(meta_pc, s_pc)

    meta_hy, s_hy = load_symbol("HY_OAS")
    hy_vals = [v for _, v in s_hy]

    meta_walcl, s_walcl = load_symbol("WALCL"); walcl_vals = [v for _, v in s_walcl]
    meta_m2, s_m2 = load_symbol("M2SL"); m2_vals = [v for _, v in s_m2]
    meta_rrp, s_rrp = load_symbol("RRP"); rrp_vals = [v for _, v in s_rrp]
    meta_effr, s_effr = load_symbol("EFFR"); effr_vals = [v for _, v in s_effr]
    meta_dfii10, s_dfii10 = load_symbol("DFII10"); dfii10_vals = [v for _, v in s_dfii10]
    meta_dgs2, s_dgs2 = load_symbol("DGS2"); dgs2_vals = [v for _, v in s_dgs2]
    meta_dgs10, s_dgs10 = load_symbol("DGS10"); dgs10_vals = [v for _, v in s_dgs10]
    meta_usd, s_usd = load_symbol("USD_BROAD"); usd_vals = [v for _, v in s_usd]
    meta_qqq, s_qqq = load_symbol("QQQ"); qqq_vals = [v for _, v in s_qqq]
    meta_btc, s_btc = load_symbol("BTC"); btc_vals = [v for _, v in s_btc]
    meta_tqqq, s_tqqq = load_symbol("TQQQ"); tqqq_vals = [v for _, v in s_tqqq]
    if not s_qqq:
        raise RuntimeError("snapshot abort: QQQ price series missing (policy: abort)")

    hy_level = latest_value(s_hy)
    hy_chg_30d = series_diff_n(hy_vals, 21)
    hy_diffs_21 = build_diff_series(hy_vals, 21)
    csi_available = len(s_hy) >= 100
    if csi_available:
        p_hy = percentile(hy_vals, hy_level, "HIGH_BAD")
        p_hy_chg = percentile(hy_diffs_21, hy_chg_30d, "HIGH_BAD")
        hy_score = score_0_100(p_hy)
        hy_chg_score = score_0_100(p_hy_chg)
        csi = round(0.60 * hy_score + 0.40 * hy_chg_score, 2)
        csi_state = state_from_score(csi, sensor_state_thresholds)
        q_hy = quality_of(meta_hy, s_hy)
    else:
        p_hy = 0.0
        p_hy_chg = 0.0
        hy_score = 0.0
        hy_chg_score = 0.0
        csi = 0.0
        csi_state = "NA"
        q_hy = "PARTIAL"

    effr_level = latest_value(s_effr)
    dfii10_level = latest_value(s_dfii10)
    yc_spread = (latest_value(s_dgs10) - latest_value(s_dgs2)) if (s_dgs10 and s_dgs2) else 0.0
    yc_hist: List[float] = []
    if len(dgs10_vals) and len(dgs2_vals):
        n = min(len(dgs10_vals), len(dgs2_vals))
        yc_hist = [float(dgs10_vals[-n + i] - dgs2_vals[-n + i]) for i in range(n)]
    p_effr = percentile(effr_vals, effr_level, "HIGH_BAD")
    p_dfii10 = percentile(dfii10_vals, dfii10_level, "HIGH_BAD")
    p_yc = percentile(yc_hist, yc_spread, "LOW_BAD")
    effr_score = score_0_100(p_effr)
    dfii10_score = score_0_100(p_dfii10)
    yc_score = score_0_100(p_yc)
    inversion_flag = yc_spread < 0.0
    if yc_spread < -0.5:
        inversion_severity = "SEVERE"
    elif yc_spread < 0.0:
        inversion_severity = "INVERTED"
    elif yc_spread < 0.5:
        inversion_severity = "FLATTENING"
    else:
        inversion_severity = "NORMAL"
    rpi = round(0.45 * effr_score + 0.35 * dfii10_score + 0.20 * yc_score, 2)
    rpi_state = state_from_score(rpi, sensor_state_thresholds)
    q_rpi = "OK"
    if quality_of(meta_effr, s_effr) == "NA" or quality_of(meta_dfii10, s_dfii10) == "NA":
        q_rpi = "PARTIAL"

    walcl_chg_30d = series_diff_n(walcl_vals, 21)
    m2_chg_30d = series_diff_n(m2_vals, 21)
    rrp_level = latest_value(s_rrp)
    usd_chg_30d = series_diff_n(usd_vals, 21)
    walcl_diffs = build_diff_series(walcl_vals, 21)
    m2_diffs = build_diff_series(m2_vals, 21)
    usd_diffs = build_diff_series(usd_vals, 21)
    p_walcl = percentile(walcl_diffs, walcl_chg_30d, "LOW_BAD")
    p_m2 = percentile(m2_diffs, m2_chg_30d, "LOW_BAD")
    p_rrp = percentile(rrp_vals, rrp_level, "HIGH_BAD")
    p_usd = percentile(usd_diffs, usd_chg_30d, "HIGH_BAD")
    walcl_score = score_0_100(p_walcl)
    m2_score = score_0_100(p_m2)
    rrp_score = score_0_100(p_rrp)
    usd_score = score_0_100(p_usd)
    dxy_30d_change = usd_chg_30d
    if dxy_30d_change > 4.0:
        dxy_pressure = "HIGH"
    elif dxy_30d_change > 2.0:
        dxy_pressure = "MEDIUM"
    elif dxy_30d_change < -2.0:
        dxy_pressure = "EASE"
    else:
        dxy_pressure = "NEUTRAL"
    lpi = round(0.30 * walcl_score + 0.25 * m2_score + 0.20 * rrp_score + 0.25 * usd_score, 2)
    lpi_state = state_from_score(lpi, sensor_state_thresholds)
    na_cnt = sum([
        1 if quality_of(meta_walcl, s_walcl) == "NA" else 0,
        1 if quality_of(meta_m2, s_m2) == "NA" else 0,
        1 if quality_of(meta_rrp, s_rrp) == "NA" else 0,
        1 if quality_of(meta_usd, s_usd) == "NA" else 0,
    ])
    q_lpi = "PARTIAL" if na_cnt >= 2 else "OK"

    vix_level = latest_value(s_vix)
    vix_chg_5d = series_diff_n(vix_vals, 5)
    vix_diffs_5 = build_diff_series(vix_vals, 5)
    p_vix = percentile(vix_vals, vix_level, "HIGH_BAD")
    p_vix_chg = percentile(vix_diffs_5, vix_chg_5d, "HIGH_BAD")
    vix_score = score_0_100(p_vix)
    vix_chg_score = score_0_100(p_vix_chg)
    vri = round(0.70 * vix_score + 0.30 * vix_chg_score, 2)
    vri_old = vri
    pc_5d_ma = 0.0
    pc_chg_30d = 0.0
    pc_score = 0.0
    pc_state = "Normal"
    pc_fallback_vix_only = False
    if len(pc_vals) >= 5:
        pc_5d_ma = float(sum(pc_vals[-5:]) / 5.0)
    if len(pc_vals) >= 22:
        pc_chg_30d = float(pc_vals[-1] - pc_vals[-22])
    pc_ma_series: List[float] = []
    if len(pc_vals) >= 5:
        for i in range(4, len(pc_vals)):
            win = pc_vals[i - 4:i + 1]
            pc_ma_series.append(float(sum(win) / len(win)))
    pc_chg_series = build_diff_series(pc_vals, 21)
    p_pc = percentile(pc_ma_series, pc_5d_ma, "HIGH_BAD") if pc_ma_series else 0.0
    p_pc_chg = percentile(pc_chg_series, pc_chg_30d, "HIGH_BAD") if pc_chg_series else 0.0
    pc_level_score = score_0_100(p_pc)
    pc_chg_score = score_0_100(p_pc_chg)
    if len(pc_vals) >= 30:
        pc_score = round(0.70 * pc_level_score + 0.30 * pc_chg_score, 2)
        pc_state = state_from_score(pc_score, sensor_state_thresholds)
    else:
        # policy fallback: PUT_CALL -> VIX-only fallback
        pc_fallback_vix_only = True
        q_pc = "PARTIAL"
        pc_score = vix_score
        pc_state = state_from_score(pc_score, sensor_state_thresholds)
    vri = round(0.80 * vri_old + 0.20 * pc_score, 2)
    vri_state = state_from_score(vri, sensor_state_thresholds)
    q_vri = quality_of(meta_vix, s_vix)

    mps_weights = policy.get("mps_weights", DEFAULT_POLICY["mps_weights"])
    mps_inputs: Dict[str, float | None] = {
        "LPI": lpi,
        "RPI": rpi,
        "VRI": vri,
        "CSI": (csi if csi_available else None),
    }
    mps, mps_contrib, mps_has_missing = weighted_score(mps_inputs, mps_weights, zero_if_missing=["CSI"])
    mps_state = state_from_score(mps, sensor_state_thresholds)

    # ===== SHOCK model (30d probability proxy) =====
    rv20 = realized_vol_20(qqq_vals)
    rv20_hist = realized_vol_series_20(qqq_vals)
    p_rv20 = percentile(rv20_hist, rv20, "HIGH_BAD") if rv20_hist else 0.0
    rv20_score = score_0_100(p_rv20)

    dd_velocity, dd_vel_hist = drawdown_velocity_10(qqq_vals)
    p_ddv = percentile(dd_vel_hist, dd_velocity, "HIGH_BAD") if dd_vel_hist else 0.0
    ddv_score = score_0_100(p_ddv)

    p_vri_shock = clamp01(vri / 100.0)
    p_csi_shock = clamp01(csi / 100.0)
    vri_score_shock = score_0_100(p_vri_shock)
    csi_score_shock = score_0_100(p_csi_shock)

    shock_weights = policy.get("shock_weights", DEFAULT_POLICY["shock_weights"])
    shock_inputs: Dict[str, float | None] = {
        "VRI": vri_score_shock,
        "CSI": (csi_score_shock if csi_available else None),
        "RV20": rv20_score,
        "DD_VEL": ddv_score,
    }
    shock_raw, shock_contrib_raw, _ = weighted_score(shock_inputs, shock_weights, zero_if_missing=["CSI"])
    shock_prob = compute_shock_probability(shock_raw, policy.get("shock_prob_caps", DEFAULT_POLICY["shock_prob_caps"]))
    shock_prob_state = shock_state(shock_prob, policy.get("shock_state_thresholds", DEFAULT_POLICY["shock_state_thresholds"]))
    shock_contrib = {
        "VRI": round(shock_contrib_raw.get("VRI", 0.0), 2),
        "CSI": round(shock_contrib_raw.get("CSI", 0.0), 2),
        "REALIZED_VOL": round(shock_contrib_raw.get("RV20", 0.0), 2),
        "DD_VELOCITY": round(shock_contrib_raw.get("DD_VEL", 0.0), 2),
    }
    shock_drivers = [k for k, _ in sorted(shock_contrib.items(), key=lambda kv: kv[1], reverse=True)[:3]]

    # ===== BTC ↔ M2 reference signal (not in engine score) =====
    # Build daily M2 forward-fill on BTC timeline, then compare BTC 30D return vs M2 YoY.
    m2_by_date = {d: v for d, v in s_m2}
    btc_dates = [d for d, _ in s_btc]
    m2_ff_on_btc: List[float | None] = []
    last_m2: float | None = None
    # Since both series are date-sorted, step with fallback lookup.
    for d in btc_dates:
        if d in m2_by_date:
            last_m2 = float(m2_by_date[d])
        m2_ff_on_btc.append(last_m2)

    btc_ret_30: List[float | None] = []
    m2_yoy_on_btc: List[float | None] = []
    for i in range(len(btc_vals)):
        if i >= 30 and btc_vals[i - 30] != 0:
            btc_ret_30.append((btc_vals[i] - btc_vals[i - 30]) / abs(btc_vals[i - 30]))
        else:
            btc_ret_30.append(None)
        if i >= 252 and m2_ff_on_btc[i - 252] not in (None, 0):
            cur = m2_ff_on_btc[i]
            prev = m2_ff_on_btc[i - 252]
            if cur is not None and prev not in (None, 0):
                m2_yoy_on_btc.append((cur - prev) / abs(prev))
            else:
                m2_yoy_on_btc.append(None)
        else:
            m2_yoy_on_btc.append(None)

    def _shift_right(arr: List[float | None], lag: int) -> List[float | None]:
        if lag <= 0:
            return arr[:]
        if lag >= len(arr):
            return [None] * len(arr)
        return [None] * lag + arr[:-lag]

    corr_6w = corr_last_window(btc_ret_30, _shift_right(m2_yoy_on_btc, 30), window=360)  # ~6w
    corr_12w = corr_last_window(btc_ret_30, _shift_right(m2_yoy_on_btc, 60), window=360)  # ~12w
    corr_best = None
    best_lag_weeks = None
    candidates: List[Tuple[int, float]] = []
    if corr_6w is not None:
        candidates.append((6, corr_6w))
    if corr_12w is not None:
        candidates.append((12, corr_12w))
    if candidates:
        best_lag_weeks, corr_best = max(candidates, key=lambda x: abs(x[1]))
    if corr_best is None:
        xconf_global_state = "NA"
    elif corr_best > 0.2:
        xconf_global_state = "Align"
    elif corr_best < -0.2:
        xconf_global_state = "Stress"
    else:
        xconf_global_state = "Mixed"

    # ===== BTC ↔ M2 auxiliary overlay (No-score, context only) =====
    def _safe_pct_lookback(vals: List[float], lb: int) -> float | None:
        if len(vals) <= lb:
            return None
        prev = vals[-1 - lb]
        cur = vals[-1]
        if prev in (None, 0):
            return None
        return ((cur - prev) / abs(prev)) * 100.0

    def _safe_m2_monthly_yoy(vals: List[float]) -> float | None:
        if len(vals) <= 12:
            return None
        prev = vals[-13]
        cur = vals[-1]
        if prev in (None, 0):
            return None
        return ((cur - prev) / abs(prev)) * 100.0

    def _safe_m2_monthly_roc(vals: List[float], months: int) -> float | None:
        if len(vals) <= months:
            return None
        prev = vals[-1 - months]
        cur = vals[-1]
        if prev in (None, 0):
            return None
        return ((cur - prev) / abs(prev)) * 100.0

    btc_30d_roc = _safe_pct_lookback(btc_vals, 30)
    btc_90d_roc = _safe_pct_lookback(btc_vals, 90)
    m2_yoy_pct = _safe_m2_monthly_yoy(m2_vals)
    m2_3m_roc_pct = _safe_m2_monthly_roc(m2_vals, 3)
    btc_m2_ratio = None
    if btc_vals and m2_vals and m2_vals[-1] not in (None, 0):
        btc_m2_ratio = float(btc_vals[-1]) / float(m2_vals[-1])

    divergence = None
    divergence_abs = None
    btc_m2_state = "NA"
    if btc_90d_roc is not None and m2_yoy_pct is not None:
        divergence = float(btc_90d_roc) - float(m2_yoy_pct)
        divergence_abs = abs(divergence)
        if divergence_abs >= 20:
            btc_m2_state = "Stress"
        elif divergence_abs >= 10:
            btc_m2_state = "Watch"
        else:
            btc_m2_state = "Normal"

    # ===== Public Macro Context (read-only, no engine impact) =====
    dgs10_level = latest_value(s_dgs10)
    dgs2_level = latest_value(s_dgs2)
    m2_level = latest_value(s_m2)
    vix_30d_chg = series_diff_n(vix_vals, 21)
    effr_30d_chg = series_diff_n(effr_vals, 21)
    dgs10_30d_chg = series_diff_n(dgs10_vals, 21)
    dgs2_30d_chg = series_diff_n(dgs2_vals, 21)
    yc_30d_chg = 0.0
    if len(yc_hist) > 21:
        yc_30d_chg = float(yc_hist[-1] - yc_hist[-22])

    p_effr_level_100 = score_0_100(percentile(effr_vals, effr_level, "HIGH_BAD"))
    p_dgs10_level_100 = score_0_100(percentile(dgs10_vals, dgs10_level, "HIGH_BAD"))
    p_dgs2_level_100 = score_0_100(percentile(dgs2_vals, dgs2_level, "HIGH_BAD"))
    p_yc_level_100 = score_0_100(percentile(yc_hist, yc_spread, "LOW_BAD")) if yc_hist else 0.0
    p_m2_level_100 = score_0_100(percentile(m2_vals, m2_level, "LOW_BAD"))
    p_hy_level_100 = score_0_100(percentile(hy_vals, hy_level, "HIGH_BAD")) if hy_vals else 0.0
    p_vix_level_100 = score_0_100(percentile(vix_vals, vix_level, "HIGH_BAD")) if vix_vals else 0.0

    def _dir(v: float) -> str:
        if v > 0:
            return "UP"
        if v < 0:
            return "DOWN"
        return "FLAT"

    public_context_rows = [
        {
            "key": "FED_FUNDS",
            "label": "Fed Funds",
            "source": "FRED",
            "value": round(effr_level, 4),
            "change_30d": round(effr_30d_chg, 4),
            "direction": _dir(effr_30d_chg),
            "status": status_from_percentile_100(p_effr_level_100, percentile_band_thresholds),
            "percentile": p_effr_level_100,
            "unit": "%",
        },
        {
            "key": "UST10Y",
            "label": "10Y",
            "source": "FRED",
            "value": round(dgs10_level, 4),
            "change_30d": round(dgs10_30d_chg, 4),
            "direction": _dir(dgs10_30d_chg),
            "status": status_from_percentile_100(p_dgs10_level_100, percentile_band_thresholds),
            "percentile": p_dgs10_level_100,
            "unit": "%",
        },
        {
            "key": "UST2Y",
            "label": "2Y",
            "source": "FRED",
            "value": round(dgs2_level, 4),
            "change_30d": round(dgs2_30d_chg, 4),
            "direction": _dir(dgs2_30d_chg),
            "status": status_from_percentile_100(p_dgs2_level_100, percentile_band_thresholds),
            "percentile": p_dgs2_level_100,
            "unit": "%",
        },
        {
            "key": "YC_2Y10Y",
            "label": "2Y-10Y",
            "source": "Derived",
            "value": round(yc_spread, 4),
            "change_30d": round(yc_30d_chg, 4),
            "direction": _dir(yc_30d_chg),
            "status": status_from_percentile_100(p_yc_level_100, percentile_band_thresholds),
            "percentile": p_yc_level_100,
            "unit": "%",
        },
        {
            "key": "M2",
            "label": "M2",
            "source": "FRED",
            "value": round(m2_level, 4),
            "change_30d": round(m2_chg_30d, 4),
            "direction": _dir(m2_chg_30d),
            "status": status_from_percentile_100(p_m2_level_100, percentile_band_thresholds),
            "percentile": p_m2_level_100,
            "unit": "bn",
        },
        {
            "key": "HY_OAS",
            "label": "HY OAS",
            "source": "FRED",
            "value": round(hy_level, 4),
            "change_30d": round(hy_chg_30d, 4),
            "direction": _dir(hy_chg_30d),
            "status": status_from_percentile_100(p_hy_level_100, percentile_band_thresholds),
            "percentile": p_hy_level_100,
            "unit": "%",
        },
        {
            "key": "VIX",
            "label": "VIX",
            "source": "CBOE/FRED",
            "value": round(vix_level, 4),
            "change_30d": round(vix_30d_chg, 4),
            "direction": _dir(vix_30d_chg),
            "status": status_from_percentile_100(p_vix_level_100, percentile_band_thresholds),
            "percentile": p_vix_level_100,
            "unit": "idx",
        },
    ]

    health_series = {
        "VIX": compute_series_health("VIX", meta_vix),
        "HY_OAS": compute_series_health("HY_OAS", meta_hy),
        "WALCL": compute_series_health("WALCL", meta_walcl),
        "M2SL": compute_series_health("M2SL", meta_m2),
        "RRP": compute_series_health("RRP", meta_rrp),
        "EFFR": compute_series_health("EFFR", meta_effr),
        "DFII10": compute_series_health("DFII10", meta_dfii10),
        "DGS2": compute_series_health("DGS2", meta_dgs2),
        "DGS10": compute_series_health("DGS10", meta_dgs10),
        "USD_BROAD": compute_series_health("USD_BROAD", meta_usd),
        "PUT_CALL": compute_series_health("PUT_CALL", meta_pc),
        "TQQQ": compute_series_health("TQQQ", meta_tqqq),
    }

    def any_stale(keys: List[str]) -> bool:
        return any(bool((health_series.get(k) or {}).get("stale")) for k in keys)

    csi_quality_eff = "STALE" if (health_series.get("HY_OAS") or {}).get("stale") else q_hy
    if not csi_available and csi_quality_eff != "STALE":
        csi_quality_eff = "PARTIAL"
    vri_quality_eff = "STALE" if any_stale(["VIX", "PUT_CALL"]) else q_vri
    lpi_quality_eff = "STALE" if any_stale(["WALCL", "M2SL", "RRP", "USD_BROAD"]) else q_lpi
    rpi_quality_eff = "STALE" if any_stale(["EFFR", "DFII10", "DGS2", "DGS10"]) else q_rpi
    put_call_quality_eff = (health_series.get("PUT_CALL") or {}).get("quality_effective", q_pc)
    mps_quality_eff = "STALE" if ("STALE" in [lpi_quality_eff, rpi_quality_eff, vri_quality_eff, csi_quality_eff]) else ("PARTIAL" if mps_has_missing else "OK")
    shock_quality_eff = derive_shock_quality(vri_quality_eff, csi_quality_eff, csi_available)

    phase, gate = evaluate_phase(lpi=lpi, rpi=rpi, vri=vri, csi=csi, stale_blocked=False, policy=policy)
    phase_thresholds = policy.get("phase_thresholds", DEFAULT_POLICY["phase_thresholds"])
    progress = round(max(0.0, min(100.0, ((gate - float(phase_thresholds["slowdown_gate"])) / (float(phase_thresholds["contraction_gate"]) - float(phase_thresholds["slowdown_gate"]))) * 100.0)), 1)
    stale_blocked = any(q == "STALE" for q in [lpi_quality_eff, rpi_quality_eff, vri_quality_eff, csi_quality_eff])
    phase, gate = evaluate_phase(lpi=lpi, rpi=rpi, vri=vri, csi=csi, stale_blocked=stale_blocked, policy=policy)
    if phase == "Shock":
        progress = 100.0

    phase_w = policy.get("phase_weights", DEFAULT_POLICY["phase_weights"])
    contrib = {
        "VRI": round(float(phase_w["VRI"]) * vri, 2),
        "CSI": round(float(phase_w["CSI"]) * csi, 2),
        "RPI": round(float(phase_w["RPI"]) * rpi, 2),
        "LPI": round(float(phase_w["LPI"]) * lpi, 2),
    }
    drivers = [k for k, _ in sorted(contrib.items(), key=lambda kv: kv[1], reverse=True)[:3]]
    phase_reasons = [
        f"Gate {gate}/100, progress {progress}%.",
        f"Drivers: {', '.join(drivers)}.",
    ]
    if stale_blocked:
        phase_reasons.append("Some inputs are STALE -> forced Slowdown.")
    elif phase == "Shock":
        phase_reasons.append("VRI/CSI extreme -> Shock.")

    defensive_mode, defensive_reason = evaluate_defensive(
        phase=phase,
        mps=mps,
        csi=float(csi or 0.0),
        stale_blocked=stale_blocked,
        policy=policy,
    )

    def _safe_meta(meta: Dict[str, Any] | None) -> Dict[str, Any]:
        return meta if isinstance(meta, dict) else {}

    snapshot: Dict[str, Any] = {
        "asof": asof,
        "snapshot_date": dt.date.today().isoformat(),
        "series": {
            "HY_OAS": _safe_meta(store.get_meta("HY_OAS")) | {"latest": {"value": hy_level, "date": (s_hy[-1][0] if s_hy else "")}},
            "VIX": _safe_meta(meta_vix) | {"latest": {"value": vix_level, "date": (s_vix[-1][0] if s_vix else "")}},
            "WALCL": _safe_meta(store.get_meta("WALCL")) | {"latest": {"value": latest_value(s_walcl), "date": (s_walcl[-1][0] if s_walcl else "")}},
            "M2SL": _safe_meta(store.get_meta("M2SL")) | {"latest": {"value": latest_value(s_m2), "date": (s_m2[-1][0] if s_m2 else "")}},
            "M2": _safe_meta(store.get_meta("M2SL")) | {
                "latest": {"value": latest_value(s_m2), "date": (s_m2[-1][0] if s_m2 else "")},
                "freq": "M",
            },
            "RRP": _safe_meta(store.get_meta("RRP")) | {"latest": {"value": rrp_level, "date": (s_rrp[-1][0] if s_rrp else "")}},
            "EFFR": _safe_meta(store.get_meta("EFFR")) | {"latest": {"value": effr_level, "date": (s_effr[-1][0] if s_effr else "")}},
            "DFII10": _safe_meta(store.get_meta("DFII10")) | {"latest": {"value": dfii10_level, "date": (s_dfii10[-1][0] if s_dfii10 else "")}},
            "DGS2": _safe_meta(store.get_meta("DGS2")) | {"latest": {"value": latest_value(s_dgs2), "date": (s_dgs2[-1][0] if s_dgs2 else "")}},
            "DGS10": _safe_meta(store.get_meta("DGS10")) | {"latest": {"value": latest_value(s_dgs10), "date": (s_dgs10[-1][0] if s_dgs10 else "")}},
            "USD_BROAD": _safe_meta(store.get_meta("USD_BROAD")) | {"latest": {"value": latest_value(s_usd), "date": (s_usd[-1][0] if s_usd else "")}},
            "BTC": _safe_meta(store.get_meta("BTC")) | {"latest": {"value": latest_value(s_btc), "date": (s_btc[-1][0] if s_btc else "")}},
            "PUT_CALL": _safe_meta(store.get_meta("PUT_CALL")) | {"latest": {"value": latest_value(s_pc), "date": (s_pc[-1][0] if s_pc else "")}},
            "TQQQ": _safe_meta(store.get_meta("TQQQ")) | {"latest": {"value": latest_value(s_tqqq), "date": (s_tqqq[-1][0] if s_tqqq else "")}},
        },
        "computed": {
            "PUT_CALL": {
                "value": pc_score,
                "state": pc_state,
                "status": pc_state,
                "quality": q_pc,
                "quality_effective": put_call_quality_eff,
                "fallback_vix_only": pc_fallback_vix_only,
                "pc_5d_ma": round(pc_5d_ma, 4),
                "pc_30d_chg": round(pc_chg_30d, 4),
                "p_pc": round(p_pc, 4),
                "p_pc_chg": round(p_pc_chg, 4),
                "level_score": pc_level_score,
                "chg_score": pc_chg_score,
                "source": (meta_pc.get("source") if meta_pc else "NA"),
            },
            "CSI": {
                "value": csi, "state": csi_state, "status": csi_state, "quality": q_hy,
                "quality_effective": csi_quality_eff,
                "fallback_weight_zero": (not csi_available),
                "hy_oas_level_bp": round(hy_level, 2),
                "hy_oas_30d_chg_bp": round(hy_chg_30d, 2),
                "p_hy_oas": round(p_hy, 4),
                "p_hy_oas_chg": round(p_hy_chg, 4),
                "level_score": hy_score,
                "chg_score": hy_chg_score,
            },
            "RPI": {
                "value": rpi, "state": rpi_state, "status": rpi_state, "quality": q_rpi,
                "quality_effective": rpi_quality_eff,
                "yield_curve_spread": round(yc_spread, 4),
                "inversion_flag": inversion_flag,
                "inversion_severity": inversion_severity,
                "components": {
                    "EFFR": {"value": effr_level, "score": effr_score},
                    "DFII10": {"value": dfii10_level, "score": dfii10_score},
                    "YC_10_2": {"value": round(yc_spread, 4), "score": yc_score},
                },
            },
            "LPI": {
                "value": lpi, "state": lpi_state, "status": lpi_state, "quality": q_lpi,
                "quality_effective": lpi_quality_eff,
                "dxy_30d_change": round(dxy_30d_change, 4),
                "dxy_pressure": dxy_pressure,
                "components": {
                    "WALCL_30D_CHG": {"value": round(walcl_chg_30d, 2), "score": walcl_score},
                    "M2_30D_CHG": {"value": round(m2_chg_30d, 2), "score": m2_score},
                    "RRP_LEVEL": {"value": round(rrp_level, 2), "score": rrp_score},
                    "USD_30D_CHG": {"value": round(usd_chg_30d, 4), "score": usd_score},
                },
            },
            "VRI": {
                "value": vri, "state": vri_state, "status": vri_state, "quality": (q_vri if q_vri != "NA" else "PARTIAL"),
                "quality_effective": vri_quality_eff,
                "components": {
                    "VIX_LEVEL": {"value": round(vix_level, 2), "score": vix_score},
                    "VIX_5D_CHG": {"value": round(vix_chg_5d, 2), "score": vix_chg_score},
                    "PUT_CALL": {
                        "pc_5d_ma": round(pc_5d_ma, 4),
                        "pc_30d_chg": round(pc_chg_30d, 4),
                        "score": pc_score,
                        "state": pc_state,
                        "quality": q_pc,
                        "source": (meta_pc.get("source") if meta_pc else "NA"),
                    },
                    "blend": {"vri_old": vri_old, "w_vri_old": 0.80, "w_put_call": 0.20},
                },
            },
            "MPS": {
                "value": mps,
                "state": mps_state,
                "status": mps_state,
                "quality_effective": mps_quality_eff,
                "breakdown": {
                    "LPI": lpi, "RPI": rpi, "VRI": vri, "CSI": csi,
                    "weights": mps_weights,
                    "contrib": mps_contrib,
                },
            },
            "SHOCK": {
                "value": shock_raw,
                "probability_30d": shock_prob,
                "state": shock_prob_state,
                "quality_effective": shock_quality_eff,
                "drivers": shock_drivers,
                "components": {
                    "weights": shock_weights,
                    "scores": {
                        "VRI": vri_score_shock,
                        "CSI": csi_score_shock,
                        "REALIZED_VOL": rv20_score,
                        "DD_VELOCITY": ddv_score,
                    },
                    "percentiles": {
                        "VRI": round(p_vri_shock, 4),
                        "CSI": round(p_csi_shock, 4),
                        "REALIZED_VOL": round(p_rv20, 4),
                        "DD_VELOCITY": round(p_ddv, 4),
                    },
                    "raw": {
                        "realized_vol_20d": round(rv20, 6),
                        "dd_velocity_10d": round(dd_velocity, 6),
                    },
                    "contrib": shock_contrib,
                    "fallback": {
                        "csi_weight_zero": (not csi_available),
                    },
                },
            },
            "PHASE": {
                "phase": phase,
                "progress": progress,
                "gate_score": gate,
                "drivers": drivers,
                "contrib": contrib,
                "stale_blocked": stale_blocked,
                "rules": {
                    "shock": f"VRI>={phase_thresholds['shock_vri']} OR (VRI>={phase_thresholds['shock_combo_vri']} AND CSI>={phase_thresholds['shock_combo_csi']})",
                    "contraction": f"gate>={phase_thresholds['contraction_gate']}",
                    "slowdown": f"gate>={phase_thresholds['slowdown_gate']}",
                    "health_block": "any quality_effective==STALE -> forced Slowdown",
                    "weights": phase_w,
                    "sensor_state_thresholds": sensor_state_thresholds,
                    "percentile_band_thresholds": percentile_band_thresholds,
                },
                "reasons": phase_reasons[:3],
            },
            "DEFENSIVE": {
                "mode": defensive_mode,
                "label": defensive_mode,
                "recommended": True,
                "reasons": defensive_reason[:3],
                "gate": {
                    "phase": phase,
                    "mps": mps,
                    "csi": float(csi or 0.0),
                    "stale_blocked": stale_blocked,
                    "thresholds": policy.get("defensive_thresholds", DEFAULT_POLICY["defensive_thresholds"]),
                },
            },
            "DEFENSIVE_TRIGGER": {
                "trigger_level": (
                    "L2" if (
                        inversion_flag
                        and (
                            ((hy_chg_30d * 100.0) if abs(hy_chg_30d) < 20 else hy_chg_30d) > 60.0
                        )
                        and (dxy_30d_change > 3.0)
                        and (vri_state == "Expanding")
                        and (pc_5d_ma > 1.2)
                    ) else (
                        "L1" if (
                            inversion_flag
                            and (
                                ((hy_chg_30d * 100.0) if abs(hy_chg_30d) < 20 else hy_chg_30d) > 60.0
                            )
                            and (dxy_30d_change > 3.0)
                        ) else "None"
                    )
                ),
                "conditions_all": {
                    "yield_inverted": inversion_flag,
                    "cs_expanding": (((hy_chg_30d * 100.0) if abs(hy_chg_30d) < 20 else hy_chg_30d) > 60.0),
                    "dxy_surge": (dxy_30d_change > 3.0),
                    "vri_expanding": (vri_state == "Expanding"),
                    "pc_fear": (pc_5d_ma > 1.2),
                },
                "conditions_met": [
                    k for k, v in {
                        "yield_inverted": inversion_flag,
                        "cs_expanding": (((hy_chg_30d * 100.0) if abs(hy_chg_30d) < 20 else hy_chg_30d) > 60.0),
                        "dxy_surge": (dxy_30d_change > 3.0),
                        "vri_expanding": (vri_state == "Expanding"),
                        "pc_fear": (pc_5d_ma > 1.2),
                    }.items() if v
                ],
                "inputs": {
                    "yield_curve_spread": round(yc_spread, 4),
                    "hy_oas_30d_change_bp": round(((hy_chg_30d * 100.0) if abs(hy_chg_30d) < 20 else hy_chg_30d), 2),
                    "dxy_30d_change": round(dxy_30d_change, 4),
                    "vri_state": vri_state,
                    "put_call_5d_ma": round(pc_5d_ma, 4),
                },
                "rules": {
                    "L1": "yield_inverted AND cs_expanding AND dxy_surge",
                    "L2": "L1 AND vri_expanding AND pc_fear",
                    "thresholds": {"credit_30d_change_bp": 60.0, "dxy_30d_change_pct": 3.0, "put_call_5d_ma": 1.2},
                },
            },
            "PUBLIC_CONTEXT": {
                "note": "Read-only context layer. No effect on engine scores.",
                "rows": public_context_rows,
            },
            "XCONF_GLOBAL": {
                "label": "BTC-M2 Lead/Lag (Reference)",
                "state": xconf_global_state,
                "best_lag_weeks": best_lag_weeks,
                "corr_6w": round(corr_6w, 4) if corr_6w is not None else None,
                "corr_12w": round(corr_12w, 4) if corr_12w is not None else None,
                "corr_best": round(corr_best, 4) if corr_best is not None else None,
                "note": "Reference-only signal. Not included in MPS/PHASE/DEFENSIVE.",
            },
            "BTC_M2": {
                "label": "BTC-M2 Liquidity Overlay (Aux)",
                "aux_only": True,
                "no_score": True,
                "m2_mode": "monthly_step_ffill",
                "m2_frequency": "monthly",
                "btc_30d_roc": (round(btc_30d_roc, 4) if btc_30d_roc is not None else None),
                "btc_90d_roc": (round(btc_90d_roc, 4) if btc_90d_roc is not None else None),
                "m2_yoy": (round(m2_yoy_pct, 4) if m2_yoy_pct is not None else None),
                "m2_3m_roc": (round(m2_3m_roc_pct, 4) if m2_3m_roc_pct is not None else None),
                "ratio": (round(btc_m2_ratio, 8) if btc_m2_ratio is not None else None),
                "divergence": (round(divergence, 4) if divergence is not None else None),
                "state": btc_m2_state,
                "rules": {
                    "normal_abs_lt": 10,
                    "watch_abs_gte": 10,
                    "stress_abs_gte": 20,
                },
                "note": "Context-only auxiliary overlay. Not included in MPS/PHASE/DEFENSIVE/SHOCK.",
            },
        },
        "health": {
            "asof": asof,
            "series": health_series,
            "summary": {
                "stale_count": sum(1 for v in health_series.values() if v.get("stale")),
                "any_stale": any(v.get("stale") for v in health_series.values()),
            },
        },
        "quality_summary": {
            "LPI": q_lpi, "RPI": q_rpi, "VRI": q_vri, "CSI": q_hy, "PUT_CALL": q_pc
        },
        "meta": {
            "policy_path": POLICY_PATH,
            "policy_loaded": os.path.exists(POLICY_PATH),
            "sensor_latency_ms": sensor_latency_ms,
            "data_age_summary": {
                k: v.get("age_minutes")
                for k, v in health_series.items()
            },
        },
    }

    build_time_ms = round((time.perf_counter() - build_start) * 1000.0, 2)
    snapshot["meta"]["build_time_ms"] = build_time_ms

    with open(LATEST_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    ts_path = os.path.join(SNAP_DIR, f"macro_snapshot_{dt.datetime.utcnow().strftime('%Y%m%d_%H%M')}.json")
    with open(ts_path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    store.save_snapshot("macro", asof=asof, payload=snapshot)
    store.close()
    try:
        with open(ENGINE_LOG_PATH, "a", encoding="utf-8") as lf:
            lf.write(json.dumps({
                "ts": asof,
                "event": "macro_snapshot_build",
                "status": "OK",
                "build_time_ms": build_time_ms,
                "snapshot_path": LATEST_PATH,
                "policy_path": POLICY_PATH,
                "sensor_latency_ms": sensor_latency_ms,
            }, ensure_ascii=False) + "\n")
    except Exception:
        pass
    print(f"macro snapshot built: CSI={csi}({csi_state}) LPI={lpi} RPI={rpi} VRI={vri} MPS={mps}({mps_state})")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        try:
            os.makedirs(os.path.dirname(ENGINE_LOG_PATH), exist_ok=True)
            ts = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
            with open(ENGINE_LOG_PATH, "a", encoding="utf-8") as lf:
                lf.write(json.dumps({
                    "ts": ts,
                    "event": "macro_snapshot_build",
                    "status": "FAIL",
                    "error": repr(exc),
                }, ensure_ascii=False) + "\n")
        except Exception:
            pass
        raise
