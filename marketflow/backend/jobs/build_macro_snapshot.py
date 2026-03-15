from __future__ import annotations

import json
import math
import os
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

try:
    from backend.services.cache_store import get_conn as cache_conn, ensure_schema as ensure_cache_schema, load_series_frame
except ModuleNotFoundError:
    from services.cache_store import get_conn as cache_conn, ensure_schema as ensure_cache_schema, load_series_frame
try:
    from backend.services.cache_store import CacheStore
except ModuleNotFoundError:
    from services.cache_store import CacheStore


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _storage_dir() -> str:
    return os.path.join(_repo_root(), "backend", "storage", "macro_snapshots")


def _data_snapshot_dir() -> str:
    return os.path.join(_repo_root(), "data", "snapshots")


def _snapshot_path(date_str: str) -> str:
    return os.path.join(_storage_dir(), f"{date_str}.json")


def _today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except Exception:
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _sanitize_json_value(v: Any) -> Any:
    # numpy scalar types must be coerced to Python natives before json.dumps
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(v, dict):
        return {k: _sanitize_json_value(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_sanitize_json_value(x) for x in v]
    return v


def _rolling_percentile(series: pd.Series, lookback: int, direction: str = "HIGH_BAD") -> pd.Series:
    """
    direction:
      - HIGH_BAD: percentile of value
      - LOW_BAD: percentile of (-value)
      - BOTH_BAD: percentile of abs(value)
    """
    s = series.astype(float).copy()
    if direction == "LOW_BAD":
        s = -s
    elif direction == "BOTH_BAD":
        s = s.abs()

    def _pct_rank_window(x: np.ndarray) -> float:
        if x is None or len(x) == 0:
            return np.nan
        cur = x[-1]
        if np.isnan(cur):
            return np.nan
        vals = x[~np.isnan(x)]
        if vals.size == 0:
            return np.nan
        rank = np.sum(vals <= cur)
        n = vals.size
        if n <= 1:
            return 50.0
        return float(100.0 * (rank - 1) / (n - 1))

    return s.rolling(window=lookback, min_periods=max(30, lookback // 8)).apply(_pct_rank_window, raw=True)


def _band_from_percentile(p: Optional[float], direction: str) -> str:
    if p is None:
        return "NA"
    if p < 66:
        return "Normal"
    if p < 85:
        return "Watch"
    return "Risk"


def _quality_from_coverage(coverage: float) -> str:
    if coverage >= 0.95:
        return "OK"
    if coverage >= 0.60:
        return "Partial"
    return "NA"


def _stale_flag(last_date: Optional[pd.Timestamp], freq: str, now: pd.Timestamp) -> bool:
    if last_date is None or pd.isna(last_date):
        return True
    # Strip timezone from both sides to avoid tz-aware vs tz-naive subtraction error.
    _now = now.tz_localize(None) if getattr(now, 'tzinfo', None) is not None else now
    _last = last_date.tz_localize(None) if getattr(last_date, 'tzinfo', None) is not None else last_date
    gap = (_now.normalize() - _last.normalize()).days
    if freq == "daily":
        return gap > 2
    if freq == "weekly":
        return gap > 10
    if freq == "monthly":
        return gap > 45
    return gap > 2


def _parse_iso_ts(ts: Optional[str]) -> Optional[pd.Timestamp]:
    if not ts or not isinstance(ts, str):
        return None
    try:
        t = ts.replace("Z", "+00:00")
        return pd.to_datetime(t)
    except Exception:
        return None


def _parse_iso_utc(ts: Optional[str]) -> Optional[datetime]:
    if not ts or not isinstance(ts, str):
        return None
    t = ts.strip()
    try:
        if t.endswith("Z"):
            return datetime.fromisoformat(t[:-1]).replace(tzinfo=timezone.utc)
        d = datetime.fromisoformat(t)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc)
    except Exception:
        return None


def _age_minutes(last_updated: Optional[str], now: pd.Timestamp) -> Optional[int]:
    d = _parse_iso_utc(last_updated)
    if d is None:
        return None
    try:
        now_dt = now.to_pydatetime()
        if now_dt.tzinfo is None:
            now_dt = now_dt.replace(tzinfo=timezone.utc)
        else:
            now_dt = now_dt.astimezone(timezone.utc)
        delta = now_dt - d
    except Exception:
        return None
    mins = round(delta.total_seconds() / 60.0, 2)
    return float(max(mins, 0.0))


def _stale_from_age(age_minutes: Optional[int], freq: str) -> bool:
    if age_minutes is None:
        return True
    f = (freq or "").lower()
    if "15m" in f:
        return age_minutes > 90
    if f.startswith("d"):
        return age_minutes > (60 * 24 * 2)
    if f.startswith("w"):
        return age_minutes > (60 * 24 * 10)
    if f.startswith("m"):
        return age_minutes > (60 * 24 * 45)
    return age_minutes > (60 * 24 * 2)


def _quality_effective(base_quality: str, stale: bool) -> str:
    q = (base_quality or "NA").strip().upper()
    if q == "NA":
        return "NA"
    if stale:
        return "STALE"
    if q == "PARTIAL":
        return "PARTIAL"
    return "OK"


STALE_THRESHOLDS_MIN: Dict[str, int] = {
    "QQQ": 60,
    "TQQQ": 60,
    "SPY": 60,
    "VIX": 60,
    "PUT_CALL": 48 * 60,
    "HY_OAS": 48 * 60,
    "WALCL": 72 * 60,
    "M2": 72 * 60,
    "M2SL": 72 * 60,
    "RRP": 48 * 60,
    "EFFR": 48 * 60,
    "DFII10": 48 * 60,
    "DGS2": 48 * 60,
    "DGS10": 48 * 60,
    "USD_BROAD": 48 * 60,
    "DXY": 48 * 60,
    "BTC": 48 * 60,
    "GLD": 48 * 60,
}


def _load_series_meta(symbols: list[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    try:
        store = CacheStore()
        store.init_schema()
        for s in symbols:
            m = store.get_meta(s)
            if isinstance(m, dict):
                out[s] = m
        store.close()
    except Exception:
        return out
    return out


def _corr(x: pd.Series, y: pd.Series, window: int) -> Optional[float]:
    # Robust + faster correlation on possibly mixed/object dtype series.
    if x is None or y is None or len(x) == 0 or len(y) == 0:
        return None
    try:
        xy = pd.concat(
            [
                pd.to_numeric(x, errors="coerce").rename("x"),
                pd.to_numeric(y, errors="coerce").rename("y"),
            ],
            axis=1,
        ).dropna()
    except Exception:
        return None
    if len(xy) < window:
        return None
    xy = xy.tail(window)
    xv = xy["x"].to_numpy(dtype=float)
    yv = xy["y"].to_numpy(dtype=float)
    if xv.size < window or yv.size < window:
        return None
    if np.nanstd(xv) == 0 or np.nanstd(yv) == 0:
        return None
    return _safe_float(np.corrcoef(xv, yv)[0, 1])


def _build_series_df(asof: str) -> pd.DataFrame:
    end_dt = pd.to_datetime(asof)
    start_dt = (end_dt - timedelta(days=365 * 6)).strftime("%Y-%m-%d")
    end_s = end_dt.strftime("%Y-%m-%d")
    symbols = [
        "VIXCLS", "VIX", "EFFR", "WALCL", "RRP", "M2", "M2SL", "HY_OAS", "US10Y", "US2Y", "DGS10", "DGS2", "DFII10", "CPI", "CPIAUCSL",
        "QQQ", "BTC", "GLD", "DXY", "USD_BROAD", "HYG", "LQD", "PUT_CALL",
    ]
    conn = cache_conn()
    try:
        ensure_cache_schema(conn)
        df = load_series_frame(conn, symbols, start_dt, end_s)
    finally:
        conn.close()
    if df.empty:
        raise RuntimeError(
            "macro series cache is empty. run: python backend/scripts/collect_macro_cache.py"
        )
    # normalize aliases
    if "DGS10" not in df.columns and "US10Y" in df.columns:
        df["DGS10"] = df["US10Y"]
    if "DGS2" not in df.columns and "US2Y" in df.columns:
        df["DGS2"] = df["US2Y"]
    if "VIXCLS" not in df.columns and "VIX" in df.columns:
        df["VIXCLS"] = df["VIX"]
    # DXY alias: FRED collector stores as USD_BROAD (DTWEXBGS)
    if "DXY" not in df.columns and "USD_BROAD" in df.columns:
        df["DXY"] = df["USD_BROAD"]
    # M2 alias compatibility (some collectors store M2SL key)
    if "M2" not in df.columns and "M2SL" in df.columns:
        df["M2"] = df["M2SL"]
    if "M2SL" not in df.columns and "M2" in df.columns:
        df["M2SL"] = df["M2"]
    # CPI alias compatibility (some collectors store CPIAUCSL key)
    if "CPI" not in df.columns and "CPIAUCSL" in df.columns:
        df["CPI"] = df["CPIAUCSL"]
    if "CPIAUCSL" not in df.columns and "CPI" in df.columns:
        df["CPIAUCSL"] = df["CPI"]
    # Ensure required columns exist even when data source is missing for a period.
    required_cols = [
        "VIXCLS", "EFFR", "WALCL", "RRP", "M2", "M2SL", "HY_OAS",
        "DGS10", "DGS2", "DFII10", "CPI", "CPIAUCSL",
        "QQQ", "BTC", "GLD", "DXY", "HYG", "LQD", "PUT_CALL",
    ]
    for col in required_cols:
        if col not in df.columns:
            df[col] = np.nan
    # Coerce any object values (e.g., None/str) into numeric for stable rolling ops.
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Normalize index to tz-naive before business-day reindex (avoids
    # pandas offset._apply crash when tz-aware / NaT edge cases arise).
    df.index = pd.to_datetime(df.index)
    if getattr(df.index, 'tz', None) is not None:
        df.index = df.index.tz_localize(None)
    df.index = df.index.normalize()

    if df.empty or pd.isna(df.index.min()) or pd.isna(df.index.max()):
        df.index.name = "date"
        return df

    # Business-day index for unified daily calculations; forward-fill slow series.
    full_idx = pd.bdate_range(df.index.min(), df.index.max())
    df = df.reindex(full_idx).ffill()
    df.index.name = "date"
    return df


def _latest_valid_date(series: pd.Series) -> Optional[str]:
    s = series.dropna()
    if s.empty:
        return None
    return pd.to_datetime(s.index[-1]).strftime("%Y-%m-%d")


def _yc_severity(spread_val: Optional[float]) -> str:
    """Yield curve inversion severity label."""
    if spread_val is None:
        return "UNKNOWN"
    if spread_val < -0.5:
        return "SEVERE"
    if spread_val < 0.0:
        return "INVERTED"
    if spread_val < 0.5:
        return "FLATTENING"
    return "NORMAL"


def _dxy_pressure(chg_pct: Optional[float]) -> str:
    """DXY 30D momentum pressure label."""
    if chg_pct is None:
        return "UNKNOWN"
    if chg_pct > 4.0:
        return "HIGH"
    if chg_pct > 2.0:
        return "MEDIUM"
    if chg_pct < -2.0:
        return "EASE"
    return "NEUTRAL"


def build_macro_snapshot(snapshot_date: Optional[str] = None) -> Dict[str, Any]:
    asof = snapshot_date or _today_str()
    df = _build_series_df(asof)
    now_ts = pd.Timestamp.utcnow()
    series_meta = _load_series_meta([
        "VIX", "EFFR", "WALCL", "RRP", "M2", "M2SL", "HY_OAS",
        "PUT_CALL", "DGS10", "DGS2", "DFII10", "CPI", "BTC", "GLD", "QQQ", "DXY", "USD_BROAD",
    ])

    lookback_days = 756  # ~3Y business days
    ref_text = "Bands are 3Y percentiles. Normal <P66, Watch P66-P85, Risk >P85"

    # ── base transforms ────────────────────────────────────────────────────────
    walcl_chg_8w   = df["WALCL"].pct_change(40, fill_method=None) * 100.0
    rrp_chg_20d    = df["RRP"].pct_change(20, fill_method=None) * 100.0
    m2_yoy         = df["M2"].pct_change(252, fill_method=None) * 100.0
    effr_1m_bp     = (df["EFFR"] - df["EFFR"].shift(21)) * 100.0
    vix_5d_chg     = df["VIXCLS"].pct_change(5, fill_method=None) * 100.0
    qqq_ret        = df["QQQ"].pct_change(fill_method=None)
    volratio       = qqq_ret.rolling(20).std() / qqq_ret.rolling(252).std()

    # CSI source selection:
    #   1) FRED HY_OAS (BAMLH0A0HYM2) preferred
    #   2) fallback proxy = HYG/LQD ratio (partial quality)
    hy_oas_fred_available = "HY_OAS" in df.columns and df["HY_OAS"].notna().any()
    hyg_lqd_proxy = (df["HYG"] / df["LQD"]) if ("HYG" in df.columns and "LQD" in df.columns) else pd.Series(dtype=float, index=df.index)
    hy_oas_proxy_available = hyg_lqd_proxy.notna().any()
    if hy_oas_fred_available:
        hy_oas_series = df["HY_OAS"].copy()
        hy_oas_source = "FRED"
        hy_oas_series_id = "BAMLH0A0HYM2"
        hy_oas_fallback_used = False
    elif hy_oas_proxy_available:
        hy_oas_series = hyg_lqd_proxy.copy()
        hy_oas_source = "PROXY"
        hy_oas_series_id = "HYG/LQD"
        hy_oas_fallback_used = True
    else:
        hy_oas_series = pd.Series(dtype=float, index=df.index)
        hy_oas_source = "NA"
        hy_oas_series_id = "NA"
        hy_oas_fallback_used = True
    hy_oas_30d_chg = hy_oas_series.diff(21)

    # Put/Call source selection:
    #   1) CBOE proxy from Yahoo (^PCCE)
    #   2) fallback proxy from VIX level (Partial quality)
    pc_native_available = "PUT_CALL" in df.columns and df["PUT_CALL"].notna().any()
    pc_vix_proxy = (df["VIXCLS"] / 20.0) if "VIXCLS" in df.columns else pd.Series(dtype=float, index=df.index)
    pc_proxy_available = pc_vix_proxy.notna().any()
    if pc_native_available:
        pc_raw = df["PUT_CALL"].copy()
        pc_source = "CBOE"
        pc_series_id = "^PCCE"
        pc_fallback_used = False
    elif pc_proxy_available:
        pc_raw = pc_vix_proxy.copy()
        pc_source = "PROXY"
        pc_series_id = "VIXCLS_PROXY"
        pc_fallback_used = True
    else:
        pc_raw = pd.Series(dtype=float, index=df.index)
        pc_source = "NA"
        pc_series_id = "NA"
        pc_fallback_used = True
    pc_5d_ma = pc_raw.rolling(5).mean()
    pc_30d_chg = pc_raw.diff(21)

    cpi_yoy_proxy  = df["CPI"].pct_change(252, fill_method=None) * 100.0
    real_rate_proxy = df["DGS10"] - cpi_yoy_proxy
    real_rate      = df["DFII10"].copy()
    proxy_used     = real_rate.isna()
    real_rate      = real_rate.where(~proxy_used, real_rate_proxy)

    # [Phase 0-A] Yield curve: 10Y - 2Y spread ─────────────────────────────────
    dgs2_available = "DGS2" in df.columns and df["DGS2"].notna().any()
    if dgs2_available:
        yield_curve_spread = df["DGS10"] - df["DGS2"]
    else:
        # Proxy: DGS10 - EFFR (less accurate but usable fallback)
        yield_curve_spread = df["DGS10"] - df["EFFR"]

    yc_val         = _safe_float(yield_curve_spread.iloc[-1])
    inversion_flag = (yc_val < 0.0) if yc_val is not None else False
    inversion_sev  = _yc_severity(yc_val)

    # [Phase 0-B] DXY 30D momentum ─────────────────────────────────────────────
    dxy_available = "DXY" in df.columns and df["DXY"].notna().any()
    if dxy_available:
        dxy_30d_change = df["DXY"].pct_change(21, fill_method=None) * 100.0   # ~30 calendar days
    else:
        dxy_30d_change = pd.Series(dtype=float, index=df.index)   # empty fallback

    dxy_chg_val   = _safe_float(dxy_30d_change.iloc[-1]) if dxy_available else None
    dxy_press     = _dxy_pressure(dxy_chg_val)

    # ── percentiles ────────────────────────────────────────────────────────────
    p_walcl       = _rolling_percentile(walcl_chg_8w,     lookback_days, "LOW_BAD")
    p_rrp         = _rolling_percentile(rrp_chg_20d,      lookback_days, "BOTH_BAD")
    p_m2          = _rolling_percentile(m2_yoy,           lookback_days, "LOW_BAD")
    p_effr_level  = _rolling_percentile(df["EFFR"],       lookback_days, "HIGH_BAD")
    p_effr_1m     = _rolling_percentile(effr_1m_bp,       lookback_days, "HIGH_BAD")
    p_real_rate   = _rolling_percentile(real_rate,        lookback_days, "HIGH_BAD")
    p_vix         = _rolling_percentile(df["VIXCLS"],     lookback_days, "HIGH_BAD")
    p_vix_5d      = _rolling_percentile(vix_5d_chg,       lookback_days, "HIGH_BAD")
    p_volratio    = _rolling_percentile(volratio,         lookback_days, "HIGH_BAD")
    p_pc          = _rolling_percentile(pc_5d_ma,         lookback_days, "HIGH_BAD")
    p_pc_chg      = _rolling_percentile(pc_30d_chg,       lookback_days, "HIGH_BAD")
    p_hy_oas      = _rolling_percentile(hy_oas_series,    lookback_days, "HIGH_BAD")
    p_hy_oas_chg  = _rolling_percentile(hy_oas_30d_chg,   lookback_days, "HIGH_BAD")
    # [Phase 0-A] Yield curve: LOW_BAD (lower spread = more pressure)
    p_yc_spread   = _rolling_percentile(yield_curve_spread, lookback_days, "LOW_BAD")
    # [Phase 0-B] DXY momentum: HIGH_BAD (DXY surge = liquidity pressure)
    p_dxy_mom     = _rolling_percentile(dxy_30d_change,   lookback_days, "HIGH_BAD") if dxy_available else pd.Series(dtype=float, index=df.index)

    last = lambda s: _safe_float(s.iloc[-1]) if len(s) else None

    def weighted_value(parts: list[tuple[float, Optional[float]]]) -> Optional[float]:
        valid = [(weight, float(value)) for weight, value in parts if value is not None and not math.isnan(float(value))]
        if not valid:
            return None
        weight_sum = sum(weight for weight, _ in valid)
        if weight_sum <= 0:
            return None
        return sum(weight * value for weight, value in valid) / weight_sum

    # ── LPI — Phase 0-B: WALCL 0.38 + RRP 0.30 + M2 0.17 + DXY 0.15 ──────────
    # (was: WALCL 0.45 + RRP 0.35 + M2 0.20)
    if dxy_available and last(p_dxy_mom) is not None:
        lpi = weighted_value([
            (0.38, last(p_walcl)),
            (0.30, last(p_rrp)),
            (0.17, last(p_m2)),
            (0.15, last(p_dxy_mom)),
        ])
    else:
        # Fallback to original weights if DXY data unavailable
        lpi = weighted_value([
            (0.45, last(p_walcl)),
            (0.35, last(p_rrp)),
            (0.20, last(p_m2)),
        ])

    # ── RPI — Phase 0-A: EFFR_level 0.25 + EFFR_1m 0.15 + RealRate 0.40 + YC 0.20 ──
    # (was: EFFR_level 0.30 + EFFR_1m 0.20 + RealRate 0.50)
    if last(p_yc_spread) is not None:
        rpi = weighted_value([
            (0.25, last(p_effr_level)),
            (0.15, last(p_effr_1m)),
            (0.40, last(p_real_rate)),
            (0.20, last(p_yc_spread)),
        ])
    else:
        # Fallback to original weights if DGS2/YC data unavailable
        rpi = weighted_value([
            (0.30, last(p_effr_level)),
            (0.20, last(p_effr_1m)),
            (0.50, last(p_real_rate)),
        ])

    # ── VRI + Put/Call booster (Phase 1-C) ────────────────────────────────────
    vri_old = weighted_value([
        (0.55, last(p_vix)),
        (0.30, last(p_vix_5d)),
        (0.15, last(p_volratio)),
    ])
    pc_score = last(p_pc)
    if pc_score is not None and _safe_float(vri_old) is not None:
        vri = (0.80 * _safe_float(vri_old)) + (0.20 * pc_score)
    else:
        vri = vri_old
    level_score = last(p_hy_oas)
    chg_score = last(p_hy_oas_chg)
    csi = weighted_value([
        (0.60, level_score),
        (0.40, chg_score),
    ])

    lpi = _safe_float(lpi)
    rpi = _safe_float(rpi)
    vri = _safe_float(vri)
    pc_score = _safe_float(pc_score)
    csi = _safe_float(csi)

    def state3(v: Optional[float], labels: tuple) -> str:
        if v is None:
            return "NA"
        if v < 33:
            return labels[0]
        if v <= 66:
            return labels[1]
        return labels[2]

    lpi_state = state3(lpi, ("Easy", "Neutral", "Tight"))
    rpi_state = state3(rpi, ("Easing", "Stable", "Restrictive"))
    vri_state = state3(vri, ("Compressed", "Normal", "Expanding"))
    pc_state = "NA" if pc_score is None else ("Stress" if pc_score >= 80 else "Watch" if pc_score >= 60 else "Normal")
    pc_5d_ma_last = _safe_float(pc_5d_ma.iloc[-1]) if len(pc_5d_ma) else None
    pc_30d_chg_last = _safe_float(pc_30d_chg.iloc[-1]) if len(pc_30d_chg) else None
    pc_fear_label = (
        "Extreme Fear" if (pc_5d_ma_last is not None and pc_5d_ma_last > 1.5) else
        "Fear" if (pc_5d_ma_last is not None and pc_5d_ma_last > 1.2) else
        "Overheat" if (pc_5d_ma_last is not None and pc_5d_ma_last < 0.7) else
        "Neutral"
    )
    csi_state = "NA" if csi is None else ("Stress" if csi >= 80 else "Watch" if csi >= 60 else "Normal")
    hy_oas_val = _safe_float(hy_oas_series.iloc[-1]) if len(hy_oas_series) else None
    hy_oas_30d_chg_bp = _safe_float(hy_oas_30d_chg.iloc[-1]) if len(hy_oas_30d_chg) else None

    # ── relationship sensors ───────────────────────────────────────────────────
    btc_ret_30d   = df["BTC"].pct_change(30, fill_method=None)
    btc_ret_90d   = df["BTC"].pct_change(90, fill_method=None)
    m2_3m_roc     = df["M2"].pct_change(63, fill_method=None) * 100.0
    btc_m2_ratio  = df["BTC"] / df["M2"]
    m2_sig        = m2_yoy / 100.0
    corr_candidates = []
    for lag in range(0, 31):
        corr_val = _corr(btc_ret_30d, m2_sig.shift(lag), 180)
        if corr_val is not None:
            corr_candidates.append(corr_val)
    corr_max  = max(corr_candidates, key=lambda x: abs(x)) if corr_candidates else None
    btc_last  = last(btc_ret_30d)
    m2_last   = last(m2_sig)
    divergence = btc_last is not None and m2_last is not None and (btc_last * m2_last < 0)
    if corr_max is not None and corr_max > 0.2 and not divergence:
        xconf_state = "Align"
    elif corr_max is not None and corr_max < -0.2 and (btc_last or 0) < 0 and (m2_last or 0) < 0:
        xconf_state = "Stress"
    else:
        xconf_state = "Mixed"

    gld_ret_30d  = df["GLD"].pct_change(30, fill_method=None)
    rr_change_30d = real_rate - real_rate.shift(30)
    gh_corr      = _corr(gld_ret_30d, rr_change_30d, 180)
    gld_last     = last(gld_ret_30d)
    rr_last      = last(rr_change_30d)
    hedge_demand = (gld_last is not None and rr_last is not None and gld_last > 0 and rr_last > 0)
    if hedge_demand:
        ghedge_state = "HedgeDemand"
    elif gh_corr is not None and -0.1 <= gh_corr <= 0.1:
        ghedge_state = "Mixed"
    else:
        ghedge_state = "Normal"

    # ── BTC-M2 auxiliary (NO-SCORE) ───────────────────────────────────────────
    btc_30d_roc_pct = _safe_float((last(btc_ret_30d) or 0.0) * 100.0) if last(btc_ret_30d) is not None else None
    btc_90d_roc_pct = _safe_float((last(btc_ret_90d) or 0.0) * 100.0) if last(btc_ret_90d) is not None else None
    m2_yoy_pct = _safe_float(last(m2_yoy))
    m2_3m_roc_pct = _safe_float(last(m2_3m_roc))
    btc_m2_ratio_last = _safe_float(last(btc_m2_ratio))
    btc_m2_divergence = None
    if btc_90d_roc_pct is not None and m2_yoy_pct is not None:
        btc_m2_divergence = _safe_float(btc_90d_roc_pct - m2_yoy_pct)
    if btc_m2_divergence is None:
        btc_m2_state = "NA"
    elif abs(btc_m2_divergence) < 10:
        btc_m2_state = "Normal"
    elif abs(btc_m2_divergence) < 20:
        btc_m2_state = "Watch"
    else:
        btc_m2_state = "Stress"

    # ── MPS & modifiers ────────────────────────────────────────────────────────
    mps = weighted_value([
        (0.35, lpi),
        (0.25, rpi),
        (0.25, vri),
        (0.15, csi),
    ])
    mps = _safe_float(mps)
    mps = None if mps is None else max(0.0, min(100.0, mps))

    # ── PHASE transition gate (sensor-combination + state machine) ───────────
    lpi_num = float(lpi or 0.0)
    rpi_num = float(rpi or 0.0)
    vri_num = float(vri or 0.0)
    csi_num = float(csi or 0.0)
    gate_score = round(0.30 * vri_num + 0.25 * csi_num + 0.25 * rpi_num + 0.20 * lpi_num, 2)
    phase_progress = max(0.0, min(100.0, round(((gate_score - 55.0) / 15.0) * 100.0, 1)))
    phase_contrib = {
        "VRI": round(0.30 * vri_num, 2),
        "CSI": round(0.25 * csi_num, 2),
        "RPI": round(0.25 * rpi_num, 2),
        "LPI": round(0.20 * lpi_num, 2),
    }
    phase_drivers = [k for k, _ in sorted(phase_contrib.items(), key=lambda kv: kv[1], reverse=True)[:3]]

    mod_upper = 0
    reasons   = []
    if lpi_state == "Tight" and vri_state == "Expanding":
        mod_upper -= 10
        reasons.append("LPI Tight + VRI Expanding")
    elif rpi_state == "Restrictive" and vri_state == "Expanding":
        mod_upper -= 5
        reasons.append("RPI Restrictive + VRI Expanding")
    if xconf_state == "Stress":
        mod_upper -= 5
        reasons.append("XCONF Stress")
    if ghedge_state == "HedgeDemand":
        reasons.append("GHEDGE HedgeDemand (tone down)")
    # [Phase 0-A] Yield curve inversion adds modifier pressure
    if inversion_sev == "SEVERE":
        mod_upper -= 10
        reasons.append("Yield Curve SEVERE inversion")
    elif inversion_sev == "INVERTED":
        mod_upper -= 5
        reasons.append("Yield Curve inverted")

    # ── quality ────────────────────────────────────────────────────────────────
    all_keys = ["VIXCLS", "EFFR", "WALCL", "RRP", "M2", "M2SL", "HY_OAS", "DGS10", "DGS2", "DFII10", "CPI", "BTC", "GLD", "QQQ", "HYG", "LQD", "PUT_CALL"]
    dxy_keys = ["DXY"] if dxy_available else []
    tail     = df.tail(lookback_days)
    coverage = {k: float(tail[k].notna().mean()) if k in tail.columns else 0.0 for k in all_keys + dxy_keys}
    last_dates = {k: _latest_valid_date(df[k]) if k in df.columns else None for k in all_keys + dxy_keys}
    stale = {
        "VIXCLS": _stale_flag(pd.to_datetime(last_dates["VIXCLS"]) if last_dates["VIXCLS"] else None, "daily",  now_ts),
        "EFFR":   _stale_flag(pd.to_datetime(last_dates["EFFR"])   if last_dates["EFFR"]   else None, "daily",  now_ts),
        "WALCL":  _stale_flag(pd.to_datetime(last_dates["WALCL"])  if last_dates["WALCL"]  else None, "weekly", now_ts),
        "RRP":    _stale_flag(pd.to_datetime(last_dates["RRP"])    if last_dates["RRP"]    else None, "daily",  now_ts),
        "M2":     _stale_flag(pd.to_datetime(last_dates["M2"])     if last_dates["M2"]     else None, "weekly", now_ts),
        "HY_OAS": _stale_flag(pd.to_datetime(last_dates["HY_OAS"]) if last_dates["HY_OAS"] else None, "daily",  now_ts),
        "PUT_CALL": _stale_flag(pd.to_datetime(last_dates["PUT_CALL"]) if last_dates["PUT_CALL"] else None, "daily",  now_ts),
    }
    quality_overall = "OK"
    if any(stale.values()):
        quality_overall = "Stale"
    if proxy_used.iloc[-1]:
        quality_overall = "Partial" if quality_overall == "OK" else quality_overall

    def metric_block(name: str, value: Optional[float], status: str, updated: Optional[str],
                     quality: str, ref_band: str, tooltip: str, **extra: Any) -> Dict[str, Any]:
        block: Dict[str, Any] = {
            "name":     name,
            "value":    value,
            "status":   status,
            "ref_band": ref_band,
            "updated":  updated,
            "quality":  quality,
            "tooltip":  tooltip,
        }
        block.update(extra)
        return block

    dgs2_cov = coverage.get("DGS2", 0.0)
    dxy_cov  = coverage.get("DXY", 0.0) if dxy_available else 0.0

    snapshot = {
        "snapshot_date": asof,
        "sources": {
            "fred": ["VIXCLS", "EFFR", "WALCL", "RRPONTSYD", "M2SL", "BAMLH0A0HYM2", "DGS10", "DGS2", "DFII10", "CPIAUCSL"],
            "market_prices": ["QQQ", "BTC-USD", "GLD", "DX-Y.NYB", "HYG", "LQD", "^PCCE"],
        },
        "computed": {
            # ── LPI (Phase 0-B: +DXY 0.15) ─────────────────────────────────
            "LPI": metric_block(
                "Liquidity Pressure Index",
                lpi,
                lpi_state,
                last_dates["WALCL"] or last_dates["RRP"],
                _quality_from_coverage(min(coverage["WALCL"], coverage["RRP"], coverage["M2"])),
                ref_text,
                "WALCL 0.38 + RRP 0.30 + M2 0.17 + DXY_30D 0.15. DXY surge = tighter global liquidity.",
                # [Phase 0-B] extra fields
                dxy_30d_change=dxy_chg_val,
                dxy_pressure=dxy_press,
                dxy_data_available=dxy_available,
                lpi_weights={"WALCL": 0.38, "RRP": 0.30, "M2": 0.17, "DXY": 0.15} if dxy_available
                            else {"WALCL": 0.45, "RRP": 0.35, "M2": 0.20},
            ),
            # ── RPI (Phase 0-A: +YC 0.20) ──────────────────────────────────
            "RPI": metric_block(
                "Rates Pressure Index",
                rpi,
                rpi_state,
                last_dates["EFFR"],
                "Partial" if proxy_used.iloc[-1] else _quality_from_coverage(min(coverage["EFFR"], coverage["DGS10"])),
                ref_text,
                "EFFR_level 0.25 + EFFR_1m 0.15 + RealRate 0.40 + YieldCurve_10Y2Y 0.20.",
                # [Phase 0-A] extra fields
                yield_curve_spread=yc_val,
                inversion_flag=inversion_flag,
                inversion_severity=inversion_sev,
                yc_data_source="DGS10-DGS2" if dgs2_available else "DGS10-EFFR (proxy)",
                rpi_weights={"EFFR_level": 0.25, "EFFR_1m": 0.15, "RealRate": 0.40, "YC_Spread": 0.20} if last(p_yc_spread) is not None
                            else {"EFFR_level": 0.30, "EFFR_1m": 0.20, "RealRate": 0.50},
            ),
            # ── VRI (unchanged) ─────────────────────────────────────────────
            "VRI": metric_block(
                "Volatility Regime Index",
                vri,
                vri_state,
                last_dates["VIXCLS"],
                _quality_from_coverage(coverage["VIXCLS"]),
                ref_text,
                "VIX_level 0.55 + VIX_5D 0.30 + VolRatio 0.15, then 80% base + 20% Put/Call score.",
                vri_base=vri_old,
                vri_put_call_boost_weight=0.20,
            ),
            "PUT_CALL": metric_block(
                "Put/Call Sentiment",
                pc_score,
                pc_state,
                last_dates["PUT_CALL"] if pc_native_available else last_dates["VIXCLS"],
                ("Partial" if pc_fallback_used else _quality_from_coverage(coverage.get("PUT_CALL", 0.0))),
                ref_text,
                "3Y percentile on Put/Call 5D moving average (HIGH_BAD).",
                pc_5d_ma=pc_5d_ma_last,
                pc_30d_chg=pc_30d_chg_last,
                p_pc=pc_score,
                p_pc_chg=last(p_pc_chg),
                score=pc_score,
                state=pc_state,
                fear_label=pc_fear_label,
                source=pc_source,
                series_id=pc_series_id,
                fallback_used=pc_fallback_used,
            ),
            "CSI": metric_block(
                "Credit Spread Index",
                csi,
                csi_state,
                last_dates["HY_OAS"] if hy_oas_fred_available else (last_dates["HYG"] or last_dates["LQD"]),
                ("Partial" if hy_oas_fallback_used else _quality_from_coverage(coverage["HY_OAS"])),
                ref_text,
                "HY_OAS level 0.60 + HY_OAS 30D change 0.40 (percentile-based, HIGH_BAD).",
                hy_oas=hy_oas_val,
                hy_oas_30d_change_bp=hy_oas_30d_chg_bp,
                p_level=level_score,
                p_chg=chg_score,
                state=csi_state,
                source=hy_oas_source,
                series_id=hy_oas_series_id,
                fallback_used=hy_oas_fallback_used,
            ),
            # ── Relationship sensors ─────────────────────────────────────────
            "XCONF": metric_block(
                "BTC-M2 Liquidity Confirmation",
                corr_max,
                xconf_state,
                last_dates["BTC"],
                _quality_from_coverage(min(coverage["BTC"], coverage["M2"])),
                "Align > +0.2, Mixed [-0.2,+0.2] or divergence, Stress < -0.2 with joint downside",
                "Lead/lag sensor uses max corr over lag 0..30d on 180d window.",
            ),
            "GHEDGE": metric_block(
                "Gold-RealRate Hedge Pressure",
                gh_corr,
                ghedge_state,
                last_dates["GLD"],
                _quality_from_coverage(min(coverage["GLD"], coverage["DGS10"])),
                "HedgeDemand if GLD_ret_30d>0 and RealRate_change_30d>0",
                "Gold/real-rate relationship state; not a direction predictor.",
            ),
            "BTC_M2": metric_block(
                "BTC-M2 Liquidity Overlay (Aux)",
                btc_m2_divergence,
                btc_m2_state,
                last_dates["BTC"] or last_dates["M2"],
                _quality_from_coverage(min(coverage["BTC"], coverage["M2"])),
                "Aux-only state: Normal | Watch | Stress by |BTC_90D_ROC - M2_YoY|",
                "No-score auxiliary context. Not included in MPS/PHASE/DEFENSIVE/SHOCK.",
                aux_only=True,
                no_score=True,
                m2_yoy=m2_yoy_pct,
                m2_3m_roc=m2_3m_roc_pct,
                btc_30d_roc=btc_30d_roc_pct,
                btc_90d_roc=btc_90d_roc_pct,
                ratio=btc_m2_ratio_last,
                divergence=btc_m2_divergence,
                state=btc_m2_state,
            ),
            # ── MPS ──────────────────────────────────────────────────────────
            "MPS": metric_block(
                "Macro Pressure Score",
                mps,
                state3(mps, ("Calm", "Caution", "High")),
                asof,
                quality_overall,
                "MPS = 0.35*LPI + 0.25*RPI + 0.25*VRI + 0.15*CSI (XCONF/GHEDGE excluded from score)",
                "XCONF/GHEDGE affects tone and modifier intensity only.",
            ),
            "exposure_ceiling_modifier": {
                "upper_cap_delta_pct": mod_upper,
                "reasons": reasons,
            },
            "quality_overall": quality_overall,
        },
        "series": {
            "VIX":    {"last_updated": last_dates["VIXCLS"], "coverage_lookback": coverage["VIXCLS"], "stale_flag": stale["VIXCLS"], "revision_risk_flag": False, "proxy_used_flag": False, "freq": "D"},
            "EFFR":   {"last_updated": last_dates["EFFR"],   "coverage_lookback": coverage["EFFR"],   "stale_flag": stale["EFFR"],   "revision_risk_flag": False, "proxy_used_flag": False, "freq": "D"},
            "WALCL":  {"last_updated": last_dates["WALCL"],  "coverage_lookback": coverage["WALCL"],  "stale_flag": stale["WALCL"],  "revision_risk_flag": False, "proxy_used_flag": False, "freq": "W"},
            "RRP":    {"last_updated": last_dates["RRP"],    "coverage_lookback": coverage["RRP"],    "stale_flag": stale["RRP"],    "revision_risk_flag": False, "proxy_used_flag": False, "freq": "D"},
            "M2":     {"last_updated": last_dates["M2"],     "coverage_lookback": coverage["M2"],     "stale_flag": stale["M2"],     "revision_risk_flag": False, "proxy_used_flag": False, "freq": "M", "source": "FRED", "note": "M2SL monthly; daily views use step forward-fill"},
            "M2SL":   {"last_updated": last_dates["M2SL"],   "coverage_lookback": coverage["M2SL"],   "stale_flag": stale["M2"],     "revision_risk_flag": False, "proxy_used_flag": False, "freq": "M", "source": "FRED", "note": "Monthly source series"},
            "HY_OAS": {
                "last_updated": last_dates["HY_OAS"] if hy_oas_fred_available else (last_dates["HYG"] or last_dates["LQD"]),
                "coverage_lookback": coverage["HY_OAS"] if hy_oas_fred_available else min(coverage.get("HYG", 0.0), coverage.get("LQD", 0.0)),
                "stale_flag": stale["HY_OAS"] if hy_oas_fred_available else (
                    _stale_flag(pd.to_datetime(last_dates["HYG"]) if last_dates.get("HYG") else None, "daily", now_ts) or
                    _stale_flag(pd.to_datetime(last_dates["LQD"]) if last_dates.get("LQD") else None, "daily", now_ts)
                ),
                "revision_risk_flag": False,
                "proxy_used_flag": hy_oas_fallback_used,
                "source": hy_oas_source,
                "series_id": hy_oas_series_id,
                "quality": "PARTIAL" if hy_oas_fallback_used else "OK",
                "fallback_used": hy_oas_fallback_used,
                "freq": "D",
            },
            "PUT_CALL": {
                "last_updated": last_dates["PUT_CALL"] if pc_native_available else last_dates["VIXCLS"],
                "coverage_lookback": coverage.get("PUT_CALL", 0.0) if pc_native_available else coverage.get("VIXCLS", 0.0),
                "stale_flag": stale["PUT_CALL"] if pc_native_available else stale["VIXCLS"],
                "revision_risk_flag": False,
                "proxy_used_flag": pc_fallback_used,
                "source": pc_source,
                "series_id": pc_series_id,
                "quality": "PARTIAL" if pc_fallback_used else "OK",
                "fallback_used": pc_fallback_used,
                "unit": "ratio",
                "freq": "D",
            },
            "DGS10":  {"last_updated": last_dates["DGS10"],  "coverage_lookback": coverage["DGS10"],  "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": False, "freq": "D"},
            # [Phase 0-A] DGS2 series tracking
            "DGS2":   {"last_updated": last_dates.get("DGS2"), "coverage_lookback": dgs2_cov, "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": not dgs2_available, "note": "2Y Treasury yield for yield curve", "freq": "D"},
            "DFII10": {"last_updated": last_dates["DFII10"], "coverage_lookback": coverage["DFII10"], "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": bool(proxy_used.iloc[-1]), "freq": "D"},
            "CPI":    {"last_updated": last_dates["CPI"],    "coverage_lookback": coverage["CPI"],    "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": bool(proxy_used.iloc[-1]), "freq": "M"},
            "BTC":    {"last_updated": last_dates["BTC"],    "coverage_lookback": coverage["BTC"],    "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": False, "freq": "D"},
            "GLD":    {"last_updated": last_dates["GLD"],    "coverage_lookback": coverage["GLD"],    "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": False, "freq": "D"},
            "QQQ":    {"last_updated": last_dates["QQQ"],    "coverage_lookback": coverage["QQQ"],    "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": False, "freq": "D"},
            # [Phase 0-B] DXY series tracking
            "DXY":    {"last_updated": last_dates.get("DXY") if dxy_available else None, "coverage_lookback": dxy_cov, "stale_flag": False, "revision_risk_flag": False, "proxy_used_flag": not dxy_available, "note": "USD Index 30D momentum for LPI", "freq": "D"},
        },
    }
    # health block + computed quality_effective
    series_health: Dict[str, Any] = {}
    for sk, sv in (snapshot.get("series") or {}).items():
        freq = str((sv or {}).get("freq", "D")).upper()
        meta = series_meta.get(sk, {})
        if sk == "M2" and not meta:
            meta = series_meta.get("M2SL", {})
        if sk == "DXY" and not meta:
            meta = series_meta.get("USD_BROAD", {})
        base_q = str((meta.get("quality") if meta else None) or (sv or {}).get("quality", "NA")).upper()
        lu = (meta.get("last_updated") if meta else None) or (sv or {}).get("last_updated")
        age = _age_minutes(lu, now_ts)
        stale_th = STALE_THRESHOLDS_MIN.get(sk, STALE_THRESHOLDS_MIN.get("M2SL") if sk == "M2" else 48 * 60)
        stale_s = (age is None) or (age > float(stale_th))
        series_health[sk] = {
            "age_minutes": age,
            "stale": stale_s,
            "stale_rule": (f">{stale_th}m" if age is not None else f"meta_missing>{stale_th}m"),
            "base_quality": base_q,
            "quality_effective": _quality_effective(base_q, stale_s),
            "last_updated": lu or "",
            "source": (meta.get("source") if meta else None) or (sv or {}).get("source", "NA"),
        }
    snapshot["health"] = {
        "asof": asof,
        "series": series_health,
        "summary": {
            "stale_count": sum(1 for v in series_health.values() if bool((v or {}).get("stale"))),
            "any_stale": any(bool((v or {}).get("stale")) for v in series_health.values()),
        },
    }

    metric_series_map: Dict[str, list[str]] = {
        "LPI": ["WALCL", "M2", "RRP", "DXY"],
        "RPI": ["EFFR", "DFII10", "DGS10", "DGS2"],
        "VRI": ["VIX", "PUT_CALL"],
        "CSI": ["HY_OAS"],
        "PUT_CALL": ["PUT_CALL"],
        "BTC_M2": ["BTC", "M2"],
        "XCONF": ["BTC", "M2"],
        "GHEDGE": ["GLD", "DGS10"],
    }
    comp = snapshot.get("computed") or {}
    for mk, deps in metric_series_map.items():
        block = comp.get(mk)
        if not isinstance(block, dict):
            continue
        dep_health = [series_health.get(d, {}) for d in deps]
        ages = [h.get("age_minutes") for h in dep_health if h.get("age_minutes") is not None]
        stale_m = any(bool(h.get("stale", True)) for h in dep_health) if dep_health else False
        q_values = [str((series_health.get(d, {}) or {}).get("base_quality", "NA")) for d in deps]
        base_q = "OK"
        if any(q.lower() == "na" for q in q_values):
            base_q = "NA"
        elif any(q.lower().startswith("partial") for q in q_values):
            base_q = "Partial"
        block["age_minutes"] = (max(ages) if ages else None)
        block["stale"] = stale_m
        block["quality_effective"] = _quality_effective(base_q, stale_m)

    mps_block = comp.get("MPS")
    if isinstance(mps_block, dict):
        deps = ["LPI", "RPI", "VRI", "CSI"]
        dep_blocks = [comp.get(d, {}) for d in deps]
        ages = [b.get("age_minutes") for b in dep_blocks if isinstance(b, dict) and b.get("age_minutes") is not None]
        stale_mps = any(bool((b or {}).get("stale", False)) for b in dep_blocks)
        q_values = [str((b or {}).get("quality_effective", "NA")) for b in dep_blocks]
        base_q = "OK"
        if any(q.lower() == "na" for q in q_values):
            base_q = "NA"
        elif any(q.lower().startswith("partial") for q in q_values):
            base_q = "Partial"
        mps_block["age_minutes"] = (max(ages) if ages else None)
        mps_block["stale"] = stale_mps
        mps_block["quality_effective"] = _quality_effective(base_q, stale_mps)

    # PHASE block after quality_effective has been assigned on component metrics.
    lpi_q_eff = str(((comp.get("LPI") or {}).get("quality_effective") or "NA")).upper()
    rpi_q_eff = str(((comp.get("RPI") or {}).get("quality_effective") or "NA")).upper()
    vri_q_eff = str(((comp.get("VRI") or {}).get("quality_effective") or "NA")).upper()
    csi_q_eff = str(((comp.get("CSI") or {}).get("quality_effective") or "NA")).upper()
    stale_blocked = "STALE" in {lpi_q_eff, rpi_q_eff, vri_q_eff, csi_q_eff}

    phase = "Expansion"
    if stale_blocked:
        phase = "Slowdown"
    else:
        if (vri_num >= 90.0) or (vri_num >= 80.0 and csi_num >= 80.0):
            phase = "Shock"
        elif gate_score >= 70.0:
            phase = "Contraction"
        elif gate_score >= 55.0:
            phase = "Slowdown"
        else:
            phase = "Expansion"
    if phase == "Shock":
        phase_progress = 100.0

    phase_reasons = [
        f"Gate {gate_score}/100, progress {phase_progress}%.",
        f"Drivers: {', '.join(phase_drivers)}.",
    ]
    if stale_blocked:
        phase_reasons.append("Some inputs are STALE -> forced Slowdown.")
    elif phase == "Shock":
        phase_reasons.append("VRI/CSI extreme -> Shock.")

    comp["PHASE"] = {
        "phase": phase,
        "progress": phase_progress,
        "gate_score": gate_score,
        "drivers": phase_drivers,
        "contrib": phase_contrib,
        "stale_blocked": stale_blocked,
        "rules": {
            "shock": "VRI>=90 OR (VRI>=80 AND CSI>=80)",
            "contraction": "gate>=70",
            "slowdown": "gate>=55",
            "health_block": "any quality_effective==STALE -> forced Slowdown",
            "weights": {"VRI": 0.30, "CSI": 0.25, "RPI": 0.25, "LPI": 0.20},
        },
        "reasons": phase_reasons[:3],
    }

    # ===== Defensive Trigger (computed) =====
    mps_num = float(mps or 0.0)
    csi_num_def = float(csi or 0.0)
    defensive_mode = "OFF"  # OFF | WATCH | ON
    defensive_reason = []

    if stale_blocked:
        defensive_mode = "WATCH"
        defensive_reason.append("Inputs STALE -> conservative WATCH.")
    else:
        if phase in ("Shock", "Contraction"):
            defensive_mode = "ON"
            defensive_reason.append(f"Phase={phase} -> Defensive ON.")
        elif phase == "Slowdown":
            defensive_mode = "WATCH"
            defensive_reason.append("Phase=Slowdown -> WATCH.")
        else:
            defensive_mode = "OFF"
            defensive_reason.append("Phase=Expansion -> OFF.")

    if mps_num >= 80.0:
        if defensive_mode != "ON":
            defensive_mode = "ON"
            defensive_reason.append("MPS>=80 -> force ON.")
    elif mps_num >= 70.0:
        if defensive_mode == "OFF":
            defensive_mode = "WATCH"
            defensive_reason.append("MPS>=70 -> upgrade to WATCH.")

    # CSI-first tightening: credit stress leads structural drawdown risk.
    if csi_num_def >= 80.0:
        if defensive_mode != "ON":
            defensive_mode = "ON"
            defensive_reason.append("CSI>=80 -> force ON.")
    elif csi_num_def >= 70.0:
        if defensive_mode == "OFF":
            defensive_mode = "WATCH"
            defensive_reason.append("CSI>=70 -> upgrade to WATCH.")

    comp["DEFENSIVE"] = {
        "mode": defensive_mode,
        "label": defensive_mode,
        "recommended": True,
        "reasons": defensive_reason[:3],
        "gate": {
            "phase": phase,
            "mps": mps_num,
            "csi": csi_num_def,
            "stale_blocked": stale_blocked,
            "thresholds": {"mps_watch": 70, "mps_on": 80, "csi_watch": 70, "csi_on": 80},
        },
    }

    # ===== Composite Defensive Trigger (Phase 2-A) =====
    # L1: yield_inverted AND credit_spread_30d_change>+60bp AND dxy_30d_change>+3%
    # L2: L1 AND vri_expanding AND put_call_ratio_5d>1.2
    hy_oas_30d_for_trigger_bp: Optional[float]
    if hy_oas_30d_chg_bp is None:
        hy_oas_30d_for_trigger_bp = None
    elif abs(hy_oas_30d_chg_bp) < 20:
        # FRED HY_OAS is in percentage points, convert to bp for thresholding.
        hy_oas_30d_for_trigger_bp = hy_oas_30d_chg_bp * 100.0
    else:
        # Some sources/proxies may already be in bp-like scale.
        hy_oas_30d_for_trigger_bp = hy_oas_30d_chg_bp

    trigger_conditions_all = {
        "yield_inverted": bool(inversion_flag),
        "cs_expanding": bool(
            hy_oas_30d_for_trigger_bp is not None and hy_oas_30d_for_trigger_bp > 60.0
        ),
        "dxy_surge": bool(dxy_chg_val is not None and dxy_chg_val > 3.0),
        "vri_expanding": (vri_state == "Expanding"),
        "pc_fear": bool(pc_5d_ma_last is not None and pc_5d_ma_last > 1.2),
    }

    trigger_l1 = (
        trigger_conditions_all["yield_inverted"]
        and trigger_conditions_all["cs_expanding"]
        and trigger_conditions_all["dxy_surge"]
    )
    trigger_l2 = (
        trigger_l1
        and trigger_conditions_all["vri_expanding"]
        and trigger_conditions_all["pc_fear"]
    )
    trigger_level = "L2" if trigger_l2 else ("L1" if trigger_l1 else "None")

    comp["DEFENSIVE_TRIGGER"] = {
        "trigger_level": trigger_level,
        "conditions_met": [k for k, v in trigger_conditions_all.items() if v],
        "conditions_all": trigger_conditions_all,
        "inputs": {
            "yield_curve_spread": yc_val,
            "hy_oas_30d_change_bp": hy_oas_30d_for_trigger_bp,
            "dxy_30d_change": dxy_chg_val,
            "vri_state": vri_state,
            "put_call_5d_ma": pc_5d_ma_last,
        },
        "rules": {
            "L1": "yield_inverted AND cs_expanding AND dxy_surge",
            "L2": "L1 AND vri_expanding AND pc_fear",
            "thresholds": {
                "credit_30d_change_bp": 60.0,
                "dxy_30d_change_pct": 3.0,
                "put_call_5d_ma": 1.2,
            },
        },
    }

    return snapshot


def save_macro_snapshot(snapshot_date: Optional[str] = None) -> str:
    snap = build_macro_snapshot(snapshot_date)
    date_str = snap["snapshot_date"]
    os.makedirs(_storage_dir(), exist_ok=True)
    os.makedirs(_data_snapshot_dir(), exist_ok=True)
    path = _snapshot_path(date_str)
    payload = _sanitize_json_value(snap)
    text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    fd, tmp_path = tempfile.mkstemp(prefix=f"{date_str}_", suffix=".json.tmp", dir=_storage_dir())
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
        # v1.0 snapshot files (latest + timestamped)
        ts = pd.to_datetime(date_str).strftime("%Y%m%d") + "_" + datetime.utcnow().strftime("%H%M")
        latest_path = os.path.join(_data_snapshot_dir(), "macro_snapshot_latest.json")
        ts_path = os.path.join(_data_snapshot_dir(), f"macro_snapshot_{ts}.json")
        with open(latest_path, "w", encoding="utf-8") as f_latest:
            f_latest.write(text)
        with open(ts_path, "w", encoding="utf-8") as f_ts:
            f_ts.write(text)
        # optional DB snapshot persistence
        try:
            store = CacheStore()
            store.init_schema()
            store.save_snapshot("macro", asof=date_str, payload=payload)
            store.close()
        except Exception:
            pass
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
    return path


if __name__ == "__main__":
    p = save_macro_snapshot()
    print(f"[OK] macro snapshot written: {p}")
