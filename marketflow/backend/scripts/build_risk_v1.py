# -*- coding: utf-8 -*-
"""
build_risk_v1.py
----------------
Builds Standard Risk System v1 outputs:
  - output/risk_v1.json
  - output/risk_v1_playback.json
  - output/risk_v1_sim.json

Data source: marketflow/backend/data/marketflow.db mirror (ticker_history_daily)
Symbols: QQQ, TQQQ
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from db_utils import resolve_marketflow_db


if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPTS_DIR)
DATA_DIR = os.path.join(BACKEND_DIR, "..", "data")
OUTPUT_DIR = os.path.join(BACKEND_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

DB_PATH   = resolve_marketflow_db(
    required_tables=("ohlcv_daily",),
    prefer_engine=True,
)
CACHE_DB  = os.path.join(DATA_DIR, "cache.db")


def load_symbol(con: sqlite3.Connection, symbol: str) -> pd.DataFrame:
    # Try ticker_history_daily first (long history); fall back to ohlcv_daily
    rows = []
    try:
        rows = con.execute(
            "SELECT date, close FROM ticker_history_daily WHERE symbol=? ORDER BY date",
            (symbol,),
        ).fetchall()
    except Exception:
        pass
    if not rows:
        try:
            rows = con.execute(
                "SELECT date, close FROM ohlcv_daily WHERE symbol=? ORDER BY date",
                (symbol,),
            ).fetchall()
        except Exception:
            pass
    df = pd.DataFrame(rows, columns=["date", "close"])
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"], errors="coerce", format="mixed")
    df = df.dropna(subset=["date"]).sort_values("date")
    # Deduplicate: keep last value per date (handles mixed date format duplicates)
    df = df.drop_duplicates(subset=["date"], keep="last")
    df = df.set_index("date")
    df.columns = [symbol.lower()]
    return _finalize_date_frame(df)


def rolling_percentile(series: pd.Series, window: int = 252) -> pd.Series:
    arr = series.values.astype(float)
    out = np.full(len(arr), np.nan, dtype=float)
    for i in range(len(arr)):
        start = max(0, i - window + 1)
        w = arr[start : i + 1]
        w = w[~np.isnan(w)]
        if w.size < 10 or np.isnan(arr[i]):
            continue
        out[i] = (np.sum(w <= arr[i]) / w.size) * 100.0
    return pd.Series(out, index=series.index)


def calc_days_below(series: pd.Series, ma: pd.Series) -> pd.Series:
    below = (series < ma) & ma.notna()
    streak = 0
    out = []
    for is_below in below.values:
        if is_below:
            streak += 1
        else:
            streak = 0
        out.append(streak)
    return pd.Series(out, index=series.index)

def scalar_at(value) -> float:
    if isinstance(value, pd.Series):
        if value.empty:
            return float("nan")
        return float(value.iloc[0])
    return float(value)


def mss_to_level(mss: float) -> int:
    """Market Structure Score → Risk Level (higher MSS = lower risk)."""
    if mss >= 110:
        return 0  # Normal
    if mss >= 100:
        return 1  # Caution
    if mss >= 92:
        return 2  # Warning
    if mss >= 84:
        return 3  # High Risk
    return 4       # Crisis


def mss_zone(mss: float) -> str:
    """Qualitative zone label for a given MSS."""
    if mss >= 120:
        return "Overheat"
    if mss >= 110:
        return "Strong Bull"
    if mss >= 100:
        return "Healthy Bull"
    if mss >= 95:
        return "Neutral"
    if mss >= 90:
        return "Soft Risk"
    if mss >= 80:
        return "Risk Rising"
    return "Structural Risk"


def level_label(level: int) -> str:
    return {
        0: "Normal",
        1: "Caution",
        2: "Warning",
        3: "High Risk",
        4: "Crisis",
    }.get(level, "Normal")


LEVEL_TIERS = [
    {"level": 0, "range": "110+", "label": "Normal",    "mss_min": 110, "exposure": 100, "color": "#22c55e"},
    {"level": 1, "range": "100-110", "label": "Caution",   "mss_min": 100, "exposure": 75,  "color": "#f59e0b"},
    {"level": 2, "range": "92-100",  "label": "Warning",   "mss_min": 92,  "exposure": 50,  "color": "#f97316"},
    {"level": 3, "range": "84-92",   "label": "High Risk", "mss_min": 84,  "exposure": 25,  "color": "#ef4444"},
    {"level": 4, "range": "<84",     "label": "Crisis",    "mss_min": 0,   "exposure": 0,   "color": "#7c3aed"},
]


def detect_event_type(df: pd.DataFrame) -> pd.Series:
    ret5 = df["qqq"].pct_change(5)
    ret3 = df["qqq"].pct_change(3)
    shock = (ret5 <= -0.08) | ((df["vol20"] >= 0.35) & (ret3 <= -0.05))
    structural = (df["days_below_ma200"] >= 180) & (df["dd_pct"] <= -15)
    grinding = (df["days_below_ma200"] >= 120) & (df["dd_pct"] <= -10)
    mixed = (df["level"] >= 3) & (df["vol20"] >= 0.25) & (df["dd_pct"] <= -8)
    return pd.Series(
        np.select(
            [shock, structural, grinding, mixed],
            ["Shock", "Structural", "Grinding", "Mixed"],
            default="Normal",
        ),
        index=df.index,
    )


def classify_shock_category(dd_pct: float, duration: int) -> str:
    """Classify event as shock/structural/grinding/mixed for Event Intelligence."""
    abs_dd = abs(dd_pct)
    if abs_dd >= 15 and duration <= 80:
        return "shock"
    elif abs_dd >= 30 and duration >= 150:
        return "structural"
    elif abs_dd >= 8 and duration >= 150:
        return "grinding"
    elif abs_dd >= 10:
        return "mixed"
    return "grinding"


def pct(val: float | None, digits: int = 2) -> float | None:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return round(float(val), digits)



# ═══════════════════════════════════════════════════════════════════════════
# CONTEXT LAYER: SPY + DIA + QQQ/SPY Rotation  (Nasdaq MSS unchanged)
# ═══════════════════════════════════════════════════════════════════════════

def _finalize_date_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Force a clean, monotonic DatetimeIndex for downstream search/slice ops."""
    if df.empty:
        return df.copy()
    out = df.copy()
    idx = pd.to_datetime(out.index, errors="coerce")
    idx = pd.DatetimeIndex(idx)
    if isinstance(idx, pd.DatetimeIndex) and idx.tz is not None:
        idx = idx.tz_localize(None)
    valid = ~idx.isna()
    out = out.loc[valid].copy()
    if out.empty:
        return out
    out.index = idx[valid]
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out


def load_ohlcv(symbol: str) -> pd.DataFrame:
    """Load close prices from ohlcv_daily (SPY/DIA available 2024+)."""
    paths_to_try = [DB_PATH]
    for db_path in paths_to_try:
        if not os.path.exists(db_path):
            continue
        try:
            con = sqlite3.connect(db_path)
            rows = con.execute(
                "SELECT date, close FROM ohlcv_daily WHERE symbol=? ORDER BY date",
                (symbol,),
            ).fetchall()
            con.close()
            if rows:
                df = pd.DataFrame(rows, columns=["date", "close"])
                df["date"] = pd.to_datetime(df["date"], errors="coerce", format="mixed")
                df = df.dropna(subset=["date"]).sort_values("date")
                df = df.drop_duplicates(subset=["date"], keep="last")
                df = df.set_index("date")
                df.columns = [symbol.lower()]
                return _finalize_date_frame(df)
        except Exception:
            pass
    # Fallback: cache.db series_data (SPY 2020+)
    if os.path.exists(CACHE_DB):
        try:
            con = sqlite3.connect(CACHE_DB)
            rows = con.execute(
                "SELECT date, value FROM series_data WHERE symbol=? ORDER BY date",
                (symbol,),
            ).fetchall()
            con.close()
            if rows:
                df = pd.DataFrame(rows, columns=["date", "close"])
                df["date"] = pd.to_datetime(df["date"], errors="coerce")
                df = df.dropna(subset=["date"]).sort_values("date")
                df = df.drop_duplicates(subset=["date"], keep="last")
                df = df.set_index("date")
                df.columns = [symbol.lower()]
                return _finalize_date_frame(df)
        except Exception:
            pass
    return pd.DataFrame()


def load_ohlcv_only(symbol: str) -> pd.DataFrame:
    """Load close prices from ohlcv_daily only, without cache fallback."""
    paths_to_try = [DB_PATH]
    for db_path in paths_to_try:
        if not os.path.exists(db_path):
            continue
        try:
            con = sqlite3.connect(db_path)
            rows = con.execute(
                "SELECT date, close FROM ohlcv_daily WHERE symbol=? ORDER BY date",
                (symbol,),
            ).fetchall()
            con.close()
            if rows:
                df = pd.DataFrame(rows, columns=["date", "close"])
                df["date"] = pd.to_datetime(df["date"], errors="coerce", format="mixed")
                df = df.dropna(subset=["date"]).sort_values("date")
                df = df.drop_duplicates(subset=["date"], keep="last")
                df = df.set_index("date")
                df.columns = [symbol.lower()]
                return _finalize_date_frame(df)
        except Exception:
            pass
    return pd.DataFrame()


def _struct_score(close: pd.Series, label: str = "") -> dict:
    """
    Lightweight structure score for SPY or DIA.
    Points system (-7 to +4), mapped to 0-100.
    Components: MA200 distance, MA50 position, 52w drawdown, 20d vol ratio.
    """
    if len(close) < 50:
        return {"score": 50, "state": "Stable", "vs_ma200": None, "dd_pct": None}

    ma200 = close.rolling(200, min_periods=50).mean()
    ma50  = close.rolling(50, min_periods=20).mean()
    latest = float(close.iloc[-1])
    m200   = float(ma200.iloc[-1]) if pd.notna(ma200.iloc[-1]) else None
    m50    = float(ma50.iloc[-1])  if pd.notna(ma50.iloc[-1])  else None

    pts = 0
    # MA200 distance (+/-2)
    if m200:
        dist = (latest - m200) / m200
        if dist > 0.05:
            pts += 2
        elif dist > 0:
            pts += 1
        elif dist > -0.05:
            pts -= 1
        else:
            pts -= 2
    # MA50 position (+/-1)
    if m50:
        pts += 1 if latest > m50 else -1
    # 52-week drawdown
    high52 = float(close.tail(252).max())
    dd = (latest - high52) / high52 * 100 if high52 > 0 else 0.0
    if dd < -15:
        pts -= 3
    elif dd < -10:
        pts -= 2
    elif dd < -5:
        pts -= 1
    # 20d vol ratio
    rets = close.pct_change().dropna()
    vol20 = float(rets.tail(20).std() * (252 ** 0.5))
    hist_vol = float(rets.tail(252).std() * (252 ** 0.5))
    if hist_vol > 0 and vol20 / hist_vol > 1.5:
        pts -= 1

    score = round(min(100, max(0, (pts + 7) / 11 * 100)))
    if score >= 72:
        state = "Strong"
    elif score >= 50:
        state = "Stable"
    elif score >= 30:
        state = "Weakening"
    else:
        state = "Defensive"

    return {
        "score": score,
        "state": state,
        "vs_ma200": round((latest - m200) / m200 * 100, 2) if m200 else None,
        "dd_pct": round(dd, 2),
    }


def _rotation_filter(qqq: pd.Series, spy: pd.Series) -> dict:
    """QQQ/SPY relative strength: classify rotation state."""
    combined = pd.DataFrame({"qqq": qqq, "spy": spy}).dropna()
    if len(combined) < 25:
        return {"state": "Neutral", "rs_20d": None, "rs_60d": None}

    ratio = combined["qqq"] / combined["spy"]
    rs_20d = float((ratio.iloc[-1] / ratio.iloc[-21] - 1) * 100) if len(ratio) >= 21 else None
    rs_60d = float((ratio.iloc[-1] / ratio.iloc[-61] - 1) * 100) if len(ratio) >= 61 else None

    r20 = rs_20d or 0.0
    if r20 > 1.0:
        state = "Supportive"
    elif r20 > -2.0:
        state = "Neutral"
    elif r20 > -4.0:
        state = "Negative"
    else:
        state = "Stress"

    return {
        "state": state,
        "rs_20d": round(rs_20d, 2) if rs_20d is not None else None,
        "rs_60d": round(rs_60d, 2) if rs_60d is not None else None,
    }


def build_final_risk(
    nasdaq_level: int,
    spy_state: str,
    dia_state: str,
    rotation_state: str,
) -> dict:
    """
    Integrate Nasdaq MSS (primary) + SPY/DIA context + Rotation filter.
    Nasdaq stays the core signal -- SPY/DIA only confirm or moderate.
    """
    weak = {"Weakening", "Defensive"}
    broad_risk = spy_state in weak and dia_state in weak

    if nasdaq_level >= 4:
        final, exposure = "SHOCK", 0
    elif nasdaq_level >= 3:
        final, exposure = "DEFENSIVE", 25
    elif nasdaq_level >= 2:
        final, exposure = ("DEFENSIVE", 25) if broad_risk else ("WARNING", 50)
    elif nasdaq_level == 1:
        final, exposure = ("WARNING", 50) if broad_risk else ("WATCH", 75)
    else:
        if rotation_state in ("Stress",) or spy_state in weak:
            final, exposure = "WATCH", 75
        else:
            final, exposure = "NORMAL", 100

    # Brief explanation
    briefs = {
        "NORMAL": (
            "Nasdaq structure is healthy and broad market context is supportive. "
            "No significant risk signals. Normal positioning is appropriate."
        ),
        "WATCH": (
            "Nasdaq is broadly constructive but one or more context signals are mildly cautious. "
            "Maintain positions; stay alert to further deterioration."
        ) if rotation_state not in ("Stress", "Negative") else (
            "Nasdaq remains constructive but is underperforming SPY -- suggesting sector rotation. "
            "This is not yet a full market breakdown. Monitor closely."
        ),
        "WARNING": (
            "Nasdaq structure is weakening. "
            + ("Broad market (SPY/DIA) is also deteriorating -- broader risk confirmed."
               if broad_risk else
               "However SPY/DIA remain relatively stable -- this may be growth-sector stress, not full market breakdown.")
            + " Consider reducing Nasdaq-heavy exposure."
        ),
        "DEFENSIVE": (
            "Nasdaq structure is under significant stress"
            + (" with broad market confirmation." if broad_risk else ".")
            + " Defensive positioning recommended. Reduce exposure materially."
        ),
        "SHOCK": (
            "Extreme structural risk across Nasdaq. "
            "Historical crisis-level signals active. Minimum exposure recommended."
        ),
    }

    return {
        "final_risk": final,
        "final_exposure_pct": exposure,
        "brief": briefs.get(final, ""),
    }


def build_context_history(qqq_s: pd.Series, spy_df: pd.DataFrame, dia_df: pd.DataFrame, n: int = 90) -> list:
    """90-day daily context series for QQQ, SPY, DIA, and QQQ/SPY rotation charts."""
    if spy_df.empty:
        return []
    spy_s = spy_df.iloc[:, 0]

    combined = pd.DataFrame({"qqq": qqq_s, "spy": spy_s}).dropna()
    if not dia_df.empty:
        combined["dia"] = dia_df.iloc[:, 0]

    combined = combined.dropna(subset=["qqq", "spy"])
    if len(combined) < 10:
        return []

    tail = combined.tail(n)
    qqq_all = qqq_s
    spy_all = spy_s

    # Base ratio for normalization
    base_ratio = float(tail["qqq"].iloc[0] / tail["spy"].iloc[0]) if float(tail["spy"].iloc[0]) > 0 else 1.0

    dia_all = dia_df.iloc[:, 0] if not dia_df.empty else None

    rows_out = []
    for idx, (dt, row) in enumerate(tail.iterrows()):
        qqq_up_to = qqq_all[qqq_all.index <= dt]
        qqq_ma200_val = float(qqq_up_to.rolling(200, min_periods=50).mean().iloc[-1]) if len(qqq_up_to) >= 50 else None

        # SPY vs MA200 (rolling over all available data up to this date)
        spy_up_to = spy_all[spy_all.index <= dt]
        spy_ma200_val = float(spy_up_to.rolling(200, min_periods=50).mean().iloc[-1]) if len(spy_up_to) >= 50 else None
        spy_high = float(spy_up_to.tail(252).max()) if len(spy_up_to) >= 5 else float(row["spy"])
        spy_dd = round((float(row["spy"]) - spy_high) / spy_high * 100, 2) if spy_high > 0 else 0.0

        # DIA vs MA200
        dia_vs_ma200 = None
        dia_dd = None
        if dia_all is not None and "dia" in row and pd.notna(row["dia"]):
            dia_up_to = dia_all[dia_all.index <= dt]
            if len(dia_up_to) >= 50:
                dia_ma200_val = float(dia_up_to.rolling(200, min_periods=50).mean().iloc[-1])
                if pd.notna(dia_ma200_val) and dia_ma200_val > 0:
                    dia_vs_ma200 = round((float(row["dia"]) - dia_ma200_val) / dia_ma200_val * 100, 2)
            dia_high = float(dia_up_to.tail(252).max()) if len(dia_up_to) >= 5 else float(row["dia"])
            dia_dd = round((float(row["dia"]) - dia_high) / dia_high * 100, 2) if dia_high > 0 else 0.0

        ratio = float(row["qqq"]) / float(row["spy"]) if float(row["spy"]) > 0 else 0.0
        rs_n = round(ratio / base_ratio * 100, 2) if base_ratio > 0 else 100.0

        entry = {
            "date": dt.strftime("%Y-%m-%d"),
            "qqq_vs_ma200": round((float(row["qqq"]) - qqq_ma200_val) / qqq_ma200_val * 100, 2) if qqq_ma200_val else None,
            "spy_vs_ma200": round((float(row["spy"]) - spy_ma200_val) / spy_ma200_val * 100, 2) if spy_ma200_val else None,
            "spy_dd": spy_dd,
            "dia_vs_ma200": dia_vs_ma200,
            "dia_dd": dia_dd,
            "rs_n": rs_n,  # QQQ/SPY ratio normalized to 100 at window start
        }
        rows_out.append(entry)

    return rows_out



# ═══════════════════════════════════════════════════════════════════════════
# TOTAL RISK ENGINE -- 11-Layer Systemic Risk Score
# ═══════════════════════════════════════════════════════════════════════════

def _load_cache_series(symbol: str) -> pd.Series:
    """Load price series from cache.db series_data."""
    if not os.path.exists(CACHE_DB):
        return pd.Series(dtype=float)
    try:
        con = sqlite3.connect(CACHE_DB)
        rows = con.execute(
            "SELECT date, value FROM series_data WHERE symbol=? ORDER BY date",
            (symbol,),
        ).fetchall()
        con.close()
        if not rows:
            return pd.Series(dtype=float)
        df = pd.DataFrame(rows, columns=["date", "value"])
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"]).drop_duplicates(subset=["date"], keep="last")
        df = df.sort_values("date").set_index("date")
        return df["value"].astype(float)
    except Exception:
        return pd.Series(dtype=float)


def _last_series_timestamp(series: pd.Series) -> pd.Timestamp | None:
    if series.empty:
        return None
    try:
        idx = pd.to_datetime(series.index, errors="coerce")
        if len(idx) == 0:
            return None
        ts = idx.max()
        return None if pd.isna(ts) else ts
    except Exception:
        return None


def _series_health(
    series: pd.Series,
    as_of_date: str,
    source: str,
    max_staleness_days: int = 5,
    cadence: str | None = None,
    note: str | None = None,
) -> dict:
    ref_ts = pd.to_datetime(as_of_date, errors="coerce")
    last_ts = _last_series_timestamp(series)
    days_stale = None
    is_stale = True
    if ref_ts is not None and not pd.isna(ref_ts) and last_ts is not None:
        days_stale = max(0, int((ref_ts.normalize() - last_ts.normalize()).days))
        is_stale = days_stale > max_staleness_days
    return {
        "source": source,
        "last_date": last_ts.strftime("%Y-%m-%d") if last_ts is not None else None,
        "days_stale": days_stale,
        "is_stale": is_stale,
        "cadence": cadence,
        "note": note,
    }


def _load_preferred_series(
    cache_symbol: str,
    as_of_date: str,
    market_daily_column: str | None = None,
    max_staleness_days: int = 5,
) -> tuple[pd.Series, dict]:
    cache_series = _load_cache_series(cache_symbol)
    cache_health = _series_health(
        cache_series,
        as_of_date,
        source="cache",
        max_staleness_days=max_staleness_days,
    )

    selected = cache_series
    selected_health = cache_health
    note = None

    if market_daily_column and (cache_series.empty or cache_health["is_stale"]):
        market_series = _load_market_daily_series(market_daily_column)
        market_health = _series_health(
            market_series,
            as_of_date,
            source=f"market_daily.{market_daily_column}",
            max_staleness_days=max_staleness_days,
        )
        market_last = _last_series_timestamp(market_series)
        cache_last = _last_series_timestamp(cache_series)
        market_is_better = (
            not market_series.empty and
            (cache_series.empty or not market_health["is_stale"] or (
                market_last is not None and (cache_last is None or market_last > cache_last)
            ))
        )
        if market_is_better:
            selected = market_series
            selected_health = market_health
            note = f"fallback from cache.{cache_symbol}"
        elif cache_health["is_stale"]:
            note = f"cache.{cache_symbol} stale; no fresher market_daily fallback"
    elif cache_health["is_stale"]:
        note = f"cache.{cache_symbol} stale; no fallback source"

    selected_health = dict(selected_health)
    if note:
        selected_health["note"] = note
    selected_health["cache_symbol"] = cache_symbol
    return selected, selected_health


# ── Track A: Credit Early Warning Engine ─────────────────────────────────────

def compute_track_a(
    hy_oas_s: pd.Series,
    ig_oas_s: pd.Series,
    qqq_series: pd.Series,
    bkln_s: pd.Series,
    hyg_s: pd.Series,
    bdc_basket_s: pd.Series,
    spy_series: pd.Series,
    roc_period: int = 5,
    z_window: int = 252,
    as_of_date: str | None = None,
) -> dict:
    """
    Track A — Credit Z-Score Early Warning Engine.

    Fires when credit markets are deteriorating while equity is still healthy.
    Designed to detect credit-driven crises (2020 COVID type) 2-4+ weeks
    before QQQ MA200 breakdown.

    Returns a dict with z_credit, stage0 flag, state, and metadata.
    Adds transmission pressure proxies:
      - BKLN/HYG relative strength (leveraged loan proxy)
      - BDC basket vs SPY relative strength (private credit proxy)
    """
    def _trim_asof(s: pd.Series, cutoff: pd.Timestamp | None) -> pd.Series:
        if s is None or s.empty or cutoff is None or pd.isna(cutoff):
            return s
        return s.loc[s.index <= cutoff]

    def _roc_zscore(s: pd.Series) -> tuple[pd.Series, pd.Series]:
        if s.empty:
            return pd.Series(dtype=float), pd.Series(dtype=float)
        roc = s.pct_change(roc_period) * 100
        mu  = roc.rolling(z_window, min_periods=63).mean()
        sig = roc.rolling(z_window, min_periods=63).std()
        z   = (roc - mu) / sig.replace(0, np.nan)
        return roc, z

    requested_as_of = pd.to_datetime(as_of_date, errors="coerce") if as_of_date else None
    pretrim = {
        "hy_oas": _trim_asof(hy_oas_s, requested_as_of),
        "ig_oas": _trim_asof(ig_oas_s, requested_as_of),
        "qqq": _trim_asof(qqq_series, requested_as_of),
        "bkln": _trim_asof(bkln_s, requested_as_of),
        "hyg": _trim_asof(hyg_s, requested_as_of),
        "bdc": _trim_asof(bdc_basket_s, requested_as_of),
        "spy": _trim_asof(spy_series, requested_as_of),
    }
    available_last_dates = [
        _last_series_timestamp(series)
        for series in pretrim.values()
        if series is not None and not series.empty
    ]
    common_as_of = min(available_last_dates) if available_last_dates else requested_as_of
    hy_oas_s = _trim_asof(hy_oas_s, common_as_of)
    ig_oas_s = _trim_asof(ig_oas_s, common_as_of)
    qqq_series = _trim_asof(qqq_series, common_as_of)
    bkln_s = _trim_asof(bkln_s, common_as_of)
    hyg_s = _trim_asof(hyg_s, common_as_of)
    bdc_basket_s = _trim_asof(bdc_basket_s, common_as_of)
    spy_series = _trim_asof(spy_series, common_as_of)

    roc_hy, z_hy = _roc_zscore(hy_oas_s)
    roc_ig, z_ig = _roc_zscore(ig_oas_s)

    # Proxy 1: Leveraged loan relative strength (BKLN/HYG)
    def _rel_z(numer: pd.Series, denom: pd.Series) -> tuple[pd.Series, pd.Series]:
        if numer.empty or denom.empty:
            return pd.Series(dtype=float), pd.Series(dtype=float)
        ratio = numer / denom.replace(0, np.nan)
        return _roc_zscore(ratio)

    roc_loan, z_loan = _rel_z(bkln_s, hyg_s)

    # Proxy 2: BDC basket vs SPY
    roc_bdc, z_bdc = _rel_z(bdc_basket_s, spy_series)

    # Combined Z_credit: weighted mean of available components
    z_parts = []
    weights = []
    if not z_hy.empty:
        z_parts.append(z_hy)
        weights.append(1.0)
    if not z_ig.empty:
        z_parts.append(z_ig)
        weights.append(1.0)
    if not z_loan.empty:
        z_parts.append(z_loan)
        weights.append(0.5)
    if not z_bdc.empty:
        z_parts.append(z_bdc)
        weights.append(0.5)
    if not z_parts:
        return {
            "z_credit": None, "z_hy": None, "z_ig": None,
            "stage0": False, "state": "Unavailable",
            "signal": "No credit data available",
            "roc_hy_5d": None, "roc_ig_5d": None,
            "hy_oas_current": None, "equity_filter": {},
            "as_of_date": common_as_of.strftime("%Y-%m-%d") if common_as_of is not None and not pd.isna(common_as_of) else None,
        }

    df_z = pd.concat(z_parts, axis=1)
    w = pd.Series(weights, index=df_z.columns)
    num = df_z.mul(w, axis=1).sum(axis=1)
    den = (~df_z.isna()).mul(w, axis=1).sum(axis=1).replace(0, np.nan)
    z_credit_s = num / den

    # Equity filter — using the most recent value
    qqq_ma50  = qqq_series.rolling(50, min_periods=20).mean()
    qqq_peak  = qqq_series.rolling(252, min_periods=60).max()
    qqq_dd    = ((qqq_series - qqq_peak) / qqq_peak * 100)

    # Align credit index to get scalar values at latest date
    latest_credit_date = z_credit_s.dropna().index[-1] if not z_credit_s.dropna().empty else None
    if latest_credit_date is None:
        return {
            "z_credit": None, "z_hy": None, "z_ig": None,
            "stage0": False, "state": "Unavailable",
            "signal": "Z-score unavailable",
            "roc_hy_5d": None, "roc_ig_5d": None,
            "hy_oas_current": None, "equity_filter": {},
            "as_of_date": common_as_of.strftime("%Y-%m-%d") if common_as_of is not None and not pd.isna(common_as_of) else None,
        }

    def _latest(s: pd.Series):
        v = s.dropna()
        return float(v.iloc[-1]) if not v.empty else None

    z_cr_val   = _latest(z_credit_s)
    z_hy_val   = _latest(z_hy)
    z_ig_val   = _latest(z_ig)
    z_loan_val = _latest(z_loan)
    z_bdc_val  = _latest(z_bdc)
    roc_hy_v   = _latest(roc_hy)
    roc_ig_v   = _latest(roc_ig)
    roc_loan_v = _latest(roc_loan)
    roc_bdc_v  = _latest(roc_bdc)
    hy_cur     = _latest(hy_oas_s)

    # QQQ equity filter at latest QQQ date
    qqq_latest = qqq_series.dropna()
    ma50_latest = qqq_ma50.dropna()
    dd_latest   = qqq_dd.dropna()
    qqq_v       = float(qqq_latest.iloc[-1])  if not qqq_latest.empty  else None
    ma50_v      = float(ma50_latest.iloc[-1]) if not ma50_latest.empty else None
    dd_v        = float(dd_latest.iloc[-1])   if not dd_latest.empty   else None

    above_ma50 = (qqq_v is not None and ma50_v is not None and qqq_v > ma50_v)
    not_in_dd  = (dd_v is not None and dd_v > -5.0)
    equity_healthy = above_ma50 and not_in_dd   # "Stealth" condition

    # ── Consecutive streak: how many trailing days have Z_credit > 2.0 ───
    z_recent = z_credit_s.dropna().tail(10)
    streak = 0
    for _zv in reversed(z_recent.values.tolist()):
        if _zv > 2.0:
            streak += 1
        else:
            break

    # ── State classification — 2-Tier design ─────────────────────────────
    # Tier 2 (Stage 0 CONFIRMED): Z > 2.0 × 3 consecutive days + equity healthy
    # Tier 1 (Credit Watch):      Z > 2.0 × 1+ days            + equity healthy
    z = z_cr_val if z_cr_val is not None else 0.0

    if streak >= 3 and equity_healthy:
        state       = "Stealth Stress"   # Tier 2 CONFIRMED — action recommended
        stage0      = True
        stage0_watch = True
        signal = (
            f"CONFIRMED: {streak} consecutive days credit Z-score > 2.0 while equity healthy. "
            f"Z={z:.2f}. Historical lead: 2-5 weeks before MA200 break. "
            f"Consider reducing leveraged exposure."
        )
    elif z >= 2.0 and equity_healthy:
        state       = "Credit Watch"     # Tier 1 — awareness, no action yet
        stage0      = False
        stage0_watch = True
        signal = (
            f"Day {streak}/3 — Credit Z-score {z:.2f} (top 2.3% stress) while equity healthy. "
            f"Watching for 3-day confirmation before Stage 0 alert."
        )
    elif z >= 2.0 and not equity_healthy:
        state       = "Credit Alert"     # credit screaming, equity already damaged
        stage0      = False
        stage0_watch = False
        signal = (
            f"Credit Z-score {z:.2f} — severe stress. "
            f"Equity already in drawdown ({dd_v:.1f}%). Crisis may be underway."
        )
    elif z >= 1.5:
        state       = "Watch"
        stage0      = False
        stage0_watch = False
        signal = f"Credit Z-score {z:.2f} — elevated. Monitor for escalation above 2.0."
    elif z >= 1.0:
        state       = "Elevated"
        stage0      = False
        stage0_watch = False
        signal = f"Credit Z-score {z:.2f} — mildly elevated. No action threshold reached."
    else:
        state       = "Normal"
        stage0      = False
        stage0_watch = False
        signal = "No credit stress signal. Credit markets calm."

    # Proxy sensor interpretation (Transmission Pressure only)
    loan_state = "Normal"
    if z_loan_val is not None and z_loan_val <= -2.0:
        loan_state = "Loan Stress Alert"
    elif z_loan_val is not None and z_loan_val <= -1.5:
        loan_state = "Loan Stress Watch"

    bdc_state = "Normal"
    if z_bdc_val is not None and z_bdc_val <= -2.0:
        bdc_state = "BDC Weakening"
    elif z_bdc_val is not None and z_bdc_val <= -1.5:
        bdc_state = "BDC Softening"

    proxy_notes = []
    if loan_state != "Normal":
        proxy_notes.append(f"Loan proxy: {loan_state}")
    if bdc_state != "Normal":
        proxy_notes.append(f"BDC proxy: {bdc_state}")
    if proxy_notes:
        signal += " Transmission pressure proxy: " + " · ".join(proxy_notes) + "."

    return {
        "z_credit":        round(z_cr_val, 3) if z_cr_val is not None else None,
        "z_hy":            round(z_hy_val, 3) if z_hy_val is not None else None,
        "z_ig":            round(z_ig_val, 3) if z_ig_val is not None else None,
        "z_loan":          round(z_loan_val, 3) if z_loan_val is not None else None,
        "z_bdc":           round(z_bdc_val, 3) if z_bdc_val is not None else None,
        "as_of_date":      common_as_of.strftime("%Y-%m-%d") if common_as_of is not None and not pd.isna(common_as_of) else None,
        "component_dates": {
            "hy_oas": _last_series_timestamp(hy_oas_s).strftime("%Y-%m-%d") if _last_series_timestamp(hy_oas_s) is not None else None,
            "ig_oas": _last_series_timestamp(ig_oas_s).strftime("%Y-%m-%d") if _last_series_timestamp(ig_oas_s) is not None else None,
            "bkln_hyg": min(
                [
                    ts for ts in [
                        _last_series_timestamp(bkln_s),
                        _last_series_timestamp(hyg_s),
                    ] if ts is not None
                ],
                default=None,
            ).strftime("%Y-%m-%d") if any(ts is not None for ts in [_last_series_timestamp(bkln_s), _last_series_timestamp(hyg_s)]) else None,
            "bdc_spy": min(
                [
                    ts for ts in [
                        _last_series_timestamp(bdc_basket_s),
                        _last_series_timestamp(spy_series),
                    ] if ts is not None
                ],
                default=None,
            ).strftime("%Y-%m-%d") if any(ts is not None for ts in [_last_series_timestamp(bdc_basket_s), _last_series_timestamp(spy_series)]) else None,
            "qqq": _last_series_timestamp(qqq_series).strftime("%Y-%m-%d") if _last_series_timestamp(qqq_series) is not None else None,
        },
        "stage0":          stage0,           # Tier 2: 3 consecutive days confirmed
        "stage0_watch":    stage0_watch,     # Tier 1: day 1+ awareness
        "consecutive_days": streak,
        "state":           state,
        "signal":          signal,
        "roc_hy_5d":       round(roc_hy_v, 2) if roc_hy_v is not None else None,
        "roc_ig_5d":       round(roc_ig_v, 2) if roc_ig_v is not None else None,
        "roc_loan_5d":     round(roc_loan_v, 2) if roc_loan_v is not None else None,
        "roc_bdc_5d":      round(roc_bdc_v, 2) if roc_bdc_v is not None else None,
        "hy_oas_current":  round(hy_cur, 2)   if hy_cur   is not None else None,
        "loan_proxy_state": loan_state,
        "bdc_proxy_state":  bdc_state,
        "equity_filter": {
            "qqq_above_ma50":    above_ma50,
            "qqq_drawdown_pct":  round(dd_v, 1) if dd_v is not None else None,
            "equity_healthy":    equity_healthy,
        },
    }


def compute_track_a_early(
    qqq_series: pd.Series,
    bkln_s: pd.Series,
    hyg_s: pd.Series,
    bdc_basket_s: pd.Series,
    spy_series: pd.Series,
    xlf_s: pd.Series,
    kre_s: pd.Series,
    roc_period: int = 5,
    z_window: int = 126,
    as_of_date: str | None = None,
) -> dict:
    """
    Track A Early — faster public-market transmission watch.

    This does not replace Track A confirmation. It looks for early deterioration
    in credit-sensitive proxies before HY/IG spreads fully confirm stress.
    """
    def _trim_asof(s: pd.Series, cutoff: pd.Timestamp | None) -> pd.Series:
        if s is None or s.empty or cutoff is None or pd.isna(cutoff):
            return s
        return s.loc[s.index <= cutoff]

    def _roc_zscore(s: pd.Series) -> tuple[pd.Series, pd.Series]:
        if s.empty:
            return pd.Series(dtype=float), pd.Series(dtype=float)
        roc = s.pct_change(roc_period) * 100
        mu = roc.rolling(z_window, min_periods=42).mean()
        sig = roc.rolling(z_window, min_periods=42).std()
        z = (roc - mu) / sig.replace(0, np.nan)
        return roc, z

    def _rel_z(numer: pd.Series, denom: pd.Series) -> tuple[pd.Series, pd.Series]:
        if numer.empty or denom.empty:
            return pd.Series(dtype=float), pd.Series(dtype=float)
        ratio = numer / denom.replace(0, np.nan)
        return _roc_zscore(ratio)

    def _latest(s: pd.Series) -> float | None:
        v = s.dropna()
        return float(v.iloc[-1]) if not v.empty else None

    requested_as_of = pd.to_datetime(as_of_date, errors="coerce") if as_of_date else None
    pretrim = {
        "qqq": _trim_asof(qqq_series, requested_as_of),
        "bkln": _trim_asof(bkln_s, requested_as_of),
        "hyg": _trim_asof(hyg_s, requested_as_of),
        "bdc": _trim_asof(bdc_basket_s, requested_as_of),
        "spy": _trim_asof(spy_series, requested_as_of),
        "xlf": _trim_asof(xlf_s, requested_as_of),
        "kre": _trim_asof(kre_s, requested_as_of),
    }
    available_last_dates = [
        _last_series_timestamp(series)
        for series in pretrim.values()
        if series is not None and not series.empty
    ]
    common_as_of = min(available_last_dates) if available_last_dates else requested_as_of
    qqq_series = _trim_asof(qqq_series, common_as_of)
    bkln_s = _trim_asof(bkln_s, common_as_of)
    hyg_s = _trim_asof(hyg_s, common_as_of)
    bdc_basket_s = _trim_asof(bdc_basket_s, common_as_of)
    spy_series = _trim_asof(spy_series, common_as_of)
    xlf_s = _trim_asof(xlf_s, common_as_of)
    kre_s = _trim_asof(kre_s, common_as_of)

    qqq_ma50 = qqq_series.rolling(50, min_periods=20).mean()
    qqq_peak = qqq_series.rolling(252, min_periods=60).max()
    qqq_dd = ((qqq_series - qqq_peak) / qqq_peak * 100)
    qqq_v = _latest(qqq_series)
    ma50_v = _latest(qqq_ma50)
    dd_v = _latest(qqq_dd)
    equity_healthy = bool(
        qqq_v is not None and ma50_v is not None and dd_v is not None
        and qqq_v > ma50_v and dd_v > -5.0
    )

    metric_defs = [
        ("loan", "BKLN/HYG", *_rel_z(bkln_s, hyg_s)),
        ("bdc", "BDC/SPY", *_rel_z(bdc_basket_s, spy_series)),
        ("xlf", "XLF/SPY", *_rel_z(xlf_s, spy_series)),
        ("kre", "KRE/SPY", *_rel_z(kre_s, spy_series)),
    ]

    metrics = []
    for key, label, roc_s, z_s in metric_defs:
        z_val = _latest(z_s)
        roc_val = _latest(roc_s)
        stress = max(0.0, -(z_val or 0.0))
        triggered = bool(
            (z_val is not None and z_val <= -1.0) or
            (roc_val is not None and roc_val <= -1.0)
        )
        metrics.append({
            "key": key,
            "label": label,
            "z": round(z_val, 3) if z_val is not None else None,
            "roc_5d": round(roc_val, 2) if roc_val is not None else None,
            "stress": round(stress, 3),
            "triggered": triggered,
        })

    available_metrics = [m for m in metrics if m["z"] is not None or m["roc_5d"] is not None]
    if not available_metrics:
        return {
            "score": None,
            "state": "Unavailable",
            "signal": "No early transmission proxy data available.",
            "equity_healthy": equity_healthy,
            "trigger_count": 0,
            "triggered": [],
            "as_of_date": common_as_of.strftime("%Y-%m-%d") if common_as_of is not None and not pd.isna(common_as_of) else None,
            "component_dates": {},
            "metrics": metrics,
        }

    trigger_count = sum(1 for m in available_metrics if m["triggered"])
    avg_stress = float(np.mean([m["stress"] for m in available_metrics])) if available_metrics else 0.0
    score = min(4.0, avg_stress + 0.35 * trigger_count + (0.2 if equity_healthy and trigger_count >= 2 else 0.0))

    if equity_healthy and trigger_count >= 3 and score >= 1.8:
        state = "Early Watch"
        signal = "Multiple credit-sensitive proxies are weakening while QQQ still looks healthy. Early transmission risk is building."
    elif trigger_count >= 2 and score >= 1.2:
        state = "Soft Watch"
        signal = "Credit-sensitive proxies are softening before spread confirmation. Monitor Track A confirmation risk."
    elif trigger_count >= 1 or score >= 0.7:
        state = "Monitor"
        signal = "At least one early transmission proxy is weakening. No confirmed credit spread signal yet."
    else:
        state = "Normal"
        signal = "No early transmission pressure. Private credit and financial proxies remain contained."

    triggered_labels = [m["label"] for m in available_metrics if m["triggered"]]
    if triggered_labels:
        signal += " Triggered: " + ", ".join(triggered_labels) + "."

    return {
        "score": round(score, 2),
        "state": state,
        "signal": signal,
        "equity_healthy": equity_healthy,
        "trigger_count": trigger_count,
        "triggered": triggered_labels,
        "as_of_date": common_as_of.strftime("%Y-%m-%d") if common_as_of is not None and not pd.isna(common_as_of) else None,
        "component_dates": {
            "bkln_hyg": min(
                [ts for ts in [_last_series_timestamp(bkln_s), _last_series_timestamp(hyg_s)] if ts is not None],
                default=None,
            ).strftime("%Y-%m-%d") if any(ts is not None for ts in [_last_series_timestamp(bkln_s), _last_series_timestamp(hyg_s)]) else None,
            "bdc_spy": min(
                [ts for ts in [_last_series_timestamp(bdc_basket_s), _last_series_timestamp(spy_series)] if ts is not None],
                default=None,
            ).strftime("%Y-%m-%d") if any(ts is not None for ts in [_last_series_timestamp(bdc_basket_s), _last_series_timestamp(spy_series)]) else None,
            "xlf_spy": min(
                [ts for ts in [_last_series_timestamp(xlf_s), _last_series_timestamp(spy_series)] if ts is not None],
                default=None,
            ).strftime("%Y-%m-%d") if any(ts is not None for ts in [_last_series_timestamp(xlf_s), _last_series_timestamp(spy_series)]) else None,
            "kre_spy": min(
                [ts for ts in [_last_series_timestamp(kre_s), _last_series_timestamp(spy_series)] if ts is not None],
                default=None,
            ).strftime("%Y-%m-%d") if any(ts is not None for ts in [_last_series_timestamp(kre_s), _last_series_timestamp(spy_series)]) else None,
            "qqq": _last_series_timestamp(qqq_series).strftime("%Y-%m-%d") if _last_series_timestamp(qqq_series) is not None else None,
        },
        "metrics": metrics,
    }


def build_track_a_early_event_detection(
    events: list[dict],
    qqq_series: pd.Series,
    bkln_s: pd.Series,
    hyg_s: pd.Series,
    bdc_basket_s: pd.Series,
    spy_series: pd.Series,
    xlf_s: pd.Series,
    kre_s: pd.Series,
) -> dict:
    """
    Validate whether Track A Early tends to fire before historical event starts.
    """
    detections: list[dict] = []
    signal_states = {"Soft Watch", "Early Watch"}

    for ev in events:
        start_ts = pd.Timestamp(ev["start"])
        search_s = start_ts - pd.Timedelta(days=90)
        search_e = start_ts + pd.Timedelta(days=30)
        candidate_dates = qqq_series.loc[(qqq_series.index >= search_s) & (qqq_series.index <= search_e)].index

        first_signal = None
        first_strong = None
        first_signal_triggered: list[str] = []
        first_strong_triggered: list[str] = []
        best_score = None
        best_state = None
        best_triggered: list[str] = []

        for dt in candidate_dates:
            probe = compute_track_a_early(
                qqq_series,
                bkln_s,
                hyg_s,
                bdc_basket_s,
                spy_series,
                xlf_s,
                kre_s,
                as_of_date=dt.strftime("%Y-%m-%d"),
            )
            state = probe.get("state")
            score = probe.get("score")
            triggered = list(probe.get("triggered") or [])
            if score is not None and (best_score is None or score > best_score):
                best_score = score
                best_state = state
                best_triggered = triggered
            if first_signal is None and state in signal_states:
                first_signal = dt
                first_signal_triggered = triggered
            if first_strong is None and state == "Early Watch":
                first_strong = dt
                first_strong_triggered = triggered

        lead_days = int((start_ts - first_signal).days) if first_signal is not None else None
        strong_lead_days = int((start_ts - first_strong).days) if first_strong is not None else None
        detections.append({
            "name": ev["name"],
            "event_start": ev["start"],
            "first_signal": first_signal.strftime("%Y-%m-%d") if first_signal is not None else None,
            "lead_days": lead_days,
            "first_signal_triggered": first_signal_triggered,
            "first_strong_signal": first_strong.strftime("%Y-%m-%d") if first_strong is not None else None,
            "strong_lead_days": strong_lead_days,
            "first_strong_triggered": first_strong_triggered,
            "best_score_window": round(best_score, 2) if best_score is not None else None,
            "best_state_window": best_state,
            "best_triggered": best_triggered,
            "peak_level": ev.get("peak_level"),
            "qqq_drawdown": ev.get("qqq_drawdown_pct"),
        })

    pre_signals = [d["lead_days"] for d in detections if d["lead_days"] is not None and d["lead_days"] >= 0]
    strong_pre_signals = [d["strong_lead_days"] for d in detections if d["strong_lead_days"] is not None and d["strong_lead_days"] >= 0]
    return {
        "event_detection": detections,
        "events_with_signal": len(pre_signals),
        "events_with_strong_signal": len(strong_pre_signals),
        "avg_lead_days": round(float(np.mean(pre_signals)), 1) if pre_signals else None,
        "avg_strong_lead_days": round(float(np.mean(strong_pre_signals)), 1) if strong_pre_signals else None,
    }


# ── Track C: Event/Shock Tracker ─────────────────────────────────────────────

def compute_track_c(
    vix_s:      pd.Series,   # VIX from cache.db
    oil_s:      pd.Series,   # oil price from market_daily
    jpy_s:      pd.Series,   # USDJPY close from ohlcv_daily (JPY=X)
    gld_s:      pd.Series,   # GLD close from ohlcv_daily
    spy_series: pd.Series,   # SPY close (already loaded)
    z_window:   int = 21,
    as_of_date: str | None = None,
) -> dict:
    """
    Track C — Event/Shock Tracker.

    Detects exogenous shocks (yen carry unwind, energy/geopolitical, flight to safety)
    that don't immediately appear in credit spreads.

    Design constraints:
    - Zero-lag: 21d window, pct_change(1), min_periods=10 — today's data is instantly reflected
    - Contextual badge: triggered_sensors [{name, z, badge}] tells the UI which sensor(s) fired
    - Operates independently of Track A — combined in compute_master_signal()
    """
    def _trim_asof(s: pd.Series, cutoff: pd.Timestamp | None) -> pd.Series:
        if s is None or s.empty or cutoff is None or pd.isna(cutoff):
            return s
        return s.loc[s.index <= cutoff]

    def _fast_z(s: pd.Series) -> tuple[pd.Series, float | None]:
        """21d rolling Z-score of 1d RoC. Returns (series, latest_value)."""
        if s is None or s.empty:
            return pd.Series(dtype=float), None
        roc = s.pct_change(1) * 100
        mu  = roc.rolling(z_window, min_periods=10).mean()
        sig = roc.rolling(z_window, min_periods=10).std()
        z_s = (roc - mu) / sig.replace(0, np.nan)
        latest = z_s.dropna()
        return z_s, float(latest.iloc[-1]) if not latest.empty else None

    def _latest(s: pd.Series) -> float | None:
        v = s.dropna()
        return float(v.iloc[-1]) if not v.empty else None

    requested_as_of = pd.to_datetime(as_of_date, errors="coerce") if as_of_date else None
    pretrim = {
        "vix": _trim_asof(vix_s, requested_as_of),
        "oil": _trim_asof(oil_s, requested_as_of),
        "jpy": _trim_asof(jpy_s, requested_as_of),
        "gld": _trim_asof(gld_s, requested_as_of),
        "spy": _trim_asof(spy_series, requested_as_of),
    }
    available_last_dates = [
        _last_series_timestamp(series)
        for series in pretrim.values()
        if series is not None and not series.empty
    ]
    common_as_of = min(available_last_dates) if available_last_dates else requested_as_of
    vix_s = _trim_asof(vix_s, common_as_of)
    oil_s = _trim_asof(oil_s, common_as_of)
    jpy_s = _trim_asof(jpy_s, common_as_of)
    gld_s = _trim_asof(gld_s, common_as_of)
    spy_series = _trim_asof(spy_series, common_as_of)

    # ── Sensor 1: Yen Carry (JPY=X = USDJPY) ────────────────────────────────
    # USDJPY falling = yen strengthening = carry unwind. Signal: Z < -2.5
    _, z_jpy = _fast_z(jpy_s)

    # ── Sensor 2: Oil/Energy Shock ───────────────────────────────────────────
    # Oil price 1d RoC spiking. Signal: Z > 2.5
    _, z_oil = _fast_z(oil_s)

    # ── Sensor 3: VIX Velocity (acute event acceleration) ────────────────────
    # VIX jumping fast. Signal: Z > 2.5
    _, z_vix = _fast_z(vix_s)

    # ── Sensor 4: Safe Haven Rush (gold >> equity) ───────────────────────────
    # Gold rising while SPY falls. Signal: Z_spread > 2.0
    if not gld_s.empty and not spy_series.empty:
        gld_roc = gld_s.pct_change(1) * 100
        spy_roc = spy_series.pct_change(1) * 100
        # align to same index
        idx     = gld_roc.index.intersection(spy_roc.index)
        spread  = gld_roc.reindex(idx) - spy_roc.reindex(idx)
        mu_sh   = spread.rolling(z_window, min_periods=10).mean()
        sig_sh  = spread.rolling(z_window, min_periods=10).std()
        z_sh_s  = (spread - mu_sh) / sig_sh.replace(0, np.nan)
        z_sh_latest = z_sh_s.dropna()
        z_sh = float(z_sh_latest.iloc[-1]) if not z_sh_latest.empty else None
    else:
        z_sh = None

    # ── Build triggered sensors list (Contextual Badges) ─────────────────────
    SENSOR_DEFS = [
        # (key,          z_val, direction, threshold, shock_label,         badge)
        ("yen_carry",    z_jpy, "down",    -2.5, "Yen Carry Unwind",       "YEN\u2191"),
        ("oil_shock",    z_oil, "up",       2.5, "Energy Shock",           "OIL\u2191"),
        ("vix_velocity", z_vix, "up",       2.5, "Volatility Spike",       "VIX\u2191"),
        ("safe_haven",   z_sh,  "up",       2.0, "Flight to Safety",       "GOLD\u2191"),
    ]

    triggered   = []
    available   = 0
    for key, z_val, direction, threshold, shock_label, badge in SENSOR_DEFS:
        if z_val is None:
            continue
        available += 1
        fired = (z_val <= threshold) if direction == "down" else (z_val >= threshold)
        if fired:
            triggered.append({"name": shock_label, "z": round(z_val, 2), "badge": badge})

    score     = len(triggered)
    max_score = max(available, 1)

    # ── State ─────────────────────────────────────────────────────────────────
    if score >= 2:
        state = "Shock Confirmed"
    elif score == 1:
        state = "Shock Watch"
    else:
        state = "Normal"

    # ── Shock type classification ─────────────────────────────────────────────
    names = {s["name"] for s in triggered}
    if "Yen Carry Unwind" in names and score >= 2:
        shock_type = "Yen Carry Unwind"
    elif "Energy Shock" in names and score >= 2:
        shock_type = "Energy / Geopolitical Shock"
    elif "Flight to Safety" in names and "Volatility Spike" in names:
        shock_type = "Geopolitical Risk-Off"
    elif score >= 3:
        shock_type = "Multi-Factor Event Shock"
    elif triggered:
        shock_type = triggered[0]["name"]
    else:
        shock_type = "None"

    # ── Signal narrative ──────────────────────────────────────────────────────
    if state == "Shock Confirmed":
        badges = " + ".join(s["badge"] for s in triggered)
        signal = (
            f"Exogenous shock confirmed ({shock_type}). "
            f"Sensors: {badges}. "
            f"Credit markets may not yet reflect this. Hedge exposure, do not panic-sell."
        )
    elif state == "Shock Watch":
        signal = (
            f"Single sensor alert ({triggered[0]['name']}, Z={triggered[0]['z']:.2f}). "
            f"Watch for second sensor confirmation before hedging."
        )
    else:
        signal = "No exogenous shock signals. All Track C sensors within normal range."

    return {
        "score":             score,
        "max_score":         max_score,
        "as_of_date":        common_as_of.strftime("%Y-%m-%d") if common_as_of is not None and not pd.isna(common_as_of) else None,
        "state":             state,
        "shock_type":        shock_type,
        "triggered_sensors": triggered,
        "signal":            signal,
        "sensor_dates": {
            "yen_carry": _last_series_timestamp(jpy_s).strftime("%Y-%m-%d") if _last_series_timestamp(jpy_s) is not None else None,
            "oil_shock": _last_series_timestamp(oil_s).strftime("%Y-%m-%d") if _last_series_timestamp(oil_s) is not None else None,
            "vix_velocity": _last_series_timestamp(vix_s).strftime("%Y-%m-%d") if _last_series_timestamp(vix_s) is not None else None,
            "safe_haven": (
                gld_s.index.intersection(spy_series.index).max().strftime("%Y-%m-%d")
                if not gld_s.empty and not spy_series.empty and len(gld_s.index.intersection(spy_series.index)) > 0
                else None
            ),
        },
        "sensors": {
            "yen_carry_z":    round(z_jpy, 2) if z_jpy is not None else None,
            "oil_shock_z":    round(z_oil, 2) if z_oil is not None else None,
            "vix_velocity_z": round(z_vix, 2) if z_vix is not None else None,
            "safe_haven_z":   round(z_sh,  2) if z_sh  is not None else None,
        },
    }


# ── Master Signal: Combined Track A + Track C ─────────────────────────────────

def compute_track_b_velocity(history: list, mss_current: float) -> dict:
    """
    MSS 5-trading-day velocity alert.
    Fires when MSS drops 8+ points in 5 trading days — structural acceleration signal.
    Avoids self-reference: uses rate-of-change, not absolute level.
    """
    if len(history) >= 6:
        base_row = history[-6]
        mss_5d_ago = float(base_row.get("score", mss_current))
        base_date = base_row.get("date")
    elif history:
        base_row = history[0]
        mss_5d_ago = float(base_row.get("score", mss_current))
        base_date = base_row.get("date")
    else:
        mss_5d_ago = mss_current
        base_date = None

    delta   = round(mss_current - mss_5d_ago, 1)
    alert   = delta <= -8.0
    pct     = max(0, min(100, int(delta / -8.0 * 100))) if delta < 0 else 0

    return {
        "mss_current":       round(mss_current, 1),
        "mss_5d_ago":        round(mss_5d_ago, 1),
        "mss_5d_ago_date":   base_date,
        "mss_5d_delta":      delta,
        "velocity_alert":    alert,
        "velocity_pct":      pct,     # 0-100%: how close to -8pt threshold
        "velocity_signal":   f"MSS {delta:+.1f}pt / 5d — 구조 가속 경보" if alert else "정상 범위",
    }


def _esc_pct(current: float, threshold: float, direction: str) -> int:
    """Compute 0-100% progress toward a trigger threshold."""
    try:
        if direction == "up":
            if current <= 0 or threshold <= 0:
                return max(0, int(current / threshold * 100)) if threshold > 0 else 0
            return max(0, min(100, int(current / threshold * 100)))
        else:  # "down" — both current and threshold negative
            if current >= 0:
                return 0
            if threshold >= 0:
                return 0
            return max(0, min(100, int(current / threshold * 100)))
    except Exception:
        return 0


def compute_master_signal(track_a: dict, track_c: dict, track_b: dict | None = None, track_a_early: dict | None = None) -> dict:
    """
    2×2 matrix combining Track A and Track C into a single action recommendation.

    Hedge-Only Mode: Track C alone → action = "HEDGE" (not SELL).
    Track A alone or combined → action = "REDUCE".

    NEW: escalation_conditions — shows distance to the next alert trigger.
    NEW: mss_velocity_alert — MSS structural acceleration warning from track_b.
    """
    a_state  = track_a.get("state", "Normal")
    c_state  = track_c.get("state", "Normal")
    ae_state = (track_a_early or {}).get("state", "Normal")
    a_active = a_state in ("Stealth Stress", "Credit Watch", "Credit Alert")
    c_active = c_state in ("Shock Watch", "Shock Confirmed")
    ae_active = ae_state in ("Soft Watch", "Early Watch")

    shock_label = track_c.get("shock_type", "?")
    ta_state    = track_a.get("state", "?")
    tae_triggered = list((track_a_early or {}).get("triggered") or [])

    if a_active and c_active:
        mode     = "COMPOUND_CRISIS"
        action   = "REDUCE"
        severity = "extreme"
        detail   = (
            f"[복합 위기] 신용 선행 경보({ta_state}) + 외부 충격({shock_label}) 동시 발화. "
            f"레버리지 즉시 최소화. 현금 비중 확대."
        )
    elif a_active:
        mode     = "CREDIT_CRISIS"
        action   = "REDUCE"
        severity = "high"
        detail   = (
            f"[신용 위기] Track A {ta_state} - 외부 이벤트 없음. "
            f"체계적 레버리지 축소 권고. Track A 해제 시까지 공격 포지션 금지."
        )
    elif c_active:
        mode     = "HEDGE_AND_HOLD"
        action   = "HEDGE"           # KEY: Hedge not Sell
        severity = "moderate"
        detail   = (
            f"[외생 쇼크] {shock_label} 감지 — 신용 시장 안정. "
            f"과도한 투매 금지. 섹터 헤지 권고. 신용(Track A)이 울리지 않으면 보유 전략 유지."
        )
    elif ae_active:
        mode     = "EARLY_WARNING"
        action   = "HOLD"
        severity = "low"
        detail   = (
            f"[조기 전이 경보] Track A Early {ae_state}. "
            f"공개시장 proxy 약화 감지"
            + (f" ({', '.join(tae_triggered)})" if tae_triggered else "")
            + ". 아직 스프레드 확인은 아니므로 포지션은 유지하되, 추가 악화 시 Track A 전환 여부를 점검."
        )
    else:
        mode     = "ALL_CLEAR"
        action   = "HOLD"
        severity = "low"
        detail   = "모든 리스크 지표 안정. 현재 포지션 유지."

    # ── Escalation Conditions ─────────────────────────────────────────────────
    sensors_c  = track_c.get("sensors", {})
    triggered_names = {s["name"] for s in track_c.get("triggered_sensors", [])}

    # Track C sensor definitions: (sensor_key, display_name, badge, threshold, direction)
    TC_SENSORS = [
        ("yen_carry_z",    "엔 캐리 언와인드", "YEN↑", -2.5, "down"),
        ("oil_shock_z",    "에너지 충격",       "OIL↑",  2.5, "up"),
        ("vix_velocity_z", "VIX 가속",          "VIX↑",  2.5, "up"),
        ("safe_haven_z",   "안전자산 도피",      "GOLD↑", 2.0, "up"),
    ]

    # Determine what triggering each condition would cause
    def _would_trigger(name: str, already_triggered: bool) -> str:
        if already_triggered:
            return "발동 중"
        if c_active:
            return "Shock Confirmed"  # needs 2nd sensor
        return "Track C Watch"

    esc_conditions: list[dict] = []

    # Track C sensors
    for sk, name, badge, thr, direction in TC_SENSORS:
        z = sensors_c.get(sk)
        if z is None:
            continue
        already = name in triggered_names
        pct = 100 if already else _esc_pct(z, thr, direction)
        if direction == "up":
            gap = "발동" if z >= thr else f"+{thr - z:.2f}σ"
        else:
            gap = "발동" if z <= thr else f"{thr - z:.2f}σ"
        esc_conditions.append({
            "name":           name,
            "badge":          badge,
            "sensor_key":     sk,
            "current":        round(z, 2),
            "threshold":      thr,
            "unit":           "σ",
            "pct_to_trigger": pct,
            "gap":            gap,
            "direction":      direction,
            "already_fired":  already,
            "would_trigger":  _would_trigger(name, already),
            "category":       "Track C",
        })

    # Track A — Z-Credit
    z_credit = track_a.get("z_credit") or 0.0
    roc_hy   = track_a.get("roc_hy_5d") or 0.0
    z_credit_pct = _esc_pct(z_credit, 2.0, "up")
    esc_conditions.append({
        "name":           "Z-Credit",
        "badge":          "CREDIT",
        "sensor_key":     "z_credit",
        "current":        round(z_credit, 2),
        "threshold":      2.0,
        "unit":           "σ",
        "pct_to_trigger": z_credit_pct,
        "gap":            "발동" if z_credit >= 2.0 else f"+{2.0 - z_credit:.2f}σ",
        "direction":      "up",
        "already_fired":  a_active,
        "would_trigger":  "REDUCE 전환" if not a_active else "발동 중",
        "category":       "Track A",
    })

    if track_a_early is not None:
        ae_score = float(track_a_early.get("score", 0.0) or 0.0)
        ae_state = track_a_early.get("state", "Normal")
        ae_trigger_count = int(track_a_early.get("trigger_count", 0) or 0)
        ae_triggered = list(track_a_early.get("triggered") or [])
        ae_pct = max(0, min(100, int((ae_score / 1.2) * 100))) if ae_score < 1.2 else 100
        esc_conditions.append({
            "name":           "Track A Early",
            "badge":          "EARLY",
            "sensor_key":     "track_a_early",
            "current":        round(ae_score, 2),
            "threshold":      1.2,
            "unit":           "score",
            "pct_to_trigger": ae_pct,
            "gap":            "발동" if ae_active else f"+{max(0.0, 1.2 - ae_score):.2f}",
            "direction":      "up",
            "already_fired":  ae_active,
            "would_trigger":  "조기 전이 경보" if not ae_active else "발동 중",
            "category":       "Track A Early",
            "detail":         f"{ae_state} · {ae_trigger_count} proxies" + (f" ({', '.join(ae_triggered)})" if ae_triggered else ""),
        })

    # Track B — MSS velocity
    if track_b is not None:
        delta   = track_b.get("mss_5d_delta", 0.0) or 0.0
        vel_pct = track_b.get("velocity_pct", 0)
        vel_alert = track_b.get("velocity_alert", False)
        esc_conditions.append({
            "name":           "MSS 낙하 속도",
            "badge":          "MSS▼",
            "sensor_key":     "mss_5d_delta",
            "current":        delta,
            "threshold":      -8.0,
            "unit":           "pt",
            "pct_to_trigger": vel_pct,
            "gap":            "경보" if vel_alert else f"{delta - (-8.0):+.1f}pt 여유",
            "direction":      "down",
            "already_fired":  vel_alert,
            "would_trigger":  "구조 가속 경보" if not vel_alert else "발동 중",
            "category":       "Track B",
        })

    # Sort: already_fired first (desc), then pct_to_trigger desc
    esc_conditions.sort(key=lambda x: (not x["already_fired"], -x["pct_to_trigger"]))

    mss_velocity_alert = track_b.get("velocity_alert", False) if track_b else False
    mss_5d_delta       = track_b.get("mss_5d_delta", None)    if track_b else None

    return {
        "mode":                  mode,
        "action":                action,
        "severity":              severity,
        "detail":                detail,
        "track_a_active":        a_active,
        "track_a_early_active":  ae_active,
        "track_c_active":        c_active,
        "escalation_conditions": esc_conditions,
        "mss_velocity_alert":    mss_velocity_alert,
        "mss_5d_delta":          mss_5d_delta,
    }


def _load_market_daily_series(column: str) -> pd.Series:
    """Load series from market_daily (column-based, e.g., dxy, vix)."""
    if not os.path.exists(DB_PATH):
        return pd.Series(dtype=float)
    try:
        con = sqlite3.connect(DB_PATH)
        rows = con.execute(
            f"SELECT date, {column} FROM market_daily WHERE {column} IS NOT NULL ORDER BY date",
        ).fetchall()
        con.close()
        if not rows:
            return pd.Series(dtype=float)
        df = pd.DataFrame(rows, columns=["date", "value"])
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"]).drop_duplicates(subset=["date"], keep="last")
        df = df.sort_values("date").set_index("date")
        return df["value"].astype(float)
    except Exception:
        return pd.Series(dtype=float)


def _layer1_equity(mss_score: float) -> dict:
    """Layer 1: Equity Structure (0-15). Maps Nasdaq MSS inversely."""
    pts = round((130 - min(130, max(60, mss_score))) / 70 * 15)
    pts = min(15, max(0, pts))
    if pts <= 3:
        desc = "Nasdaq price structure healthy. Trend intact, volatility contained."
    elif pts <= 6:
        desc = "Early softness. MA positioning still constructive but momentum slowing."
    elif pts <= 10:
        desc = "Structure weakening. Price pressure building below key moving averages."
    elif pts <= 13:
        desc = "Significant structural stress. Multiple technical thresholds breached."
    else:
        desc = "Deep structural breakdown. Crisis-level Nasdaq deterioration."
    return {"score": pts, "max": 15, "label": "Equity Structure", "desc": desc}


def compute_breadth_metrics(as_of_date: str | None = None, qqq_dd_pct: float | None = None) -> dict:
    """
    Compute real market breadth from ohlcv_daily universe (500+ symbols).
    as_of_date: ISO date string (YYYY-MM-DD) or None for latest
    qqq_dd_pct: QQQ drawdown from 52w high (for divergence detection)
    """
    import sqlite3 as _sqlite3
    try:
        con = _sqlite3.connect(DB_PATH)
        if as_of_date is None:
            as_of_date = con.execute("SELECT MAX(date) FROM ohlcv_daily").fetchone()[0]

        # % above MA200 (require >= 150 rows)
        row = con.execute("""
            SELECT SUM(CASE WHEN t.close > m.ma200 THEN 1 ELSE 0 END) AS above,
                   COUNT(*) AS total
            FROM (SELECT symbol, close,
                         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                  FROM ohlcv_daily WHERE date <= ?) t
            JOIN (SELECT symbol, AVG(close) AS ma200
                  FROM (SELECT symbol, close,
                               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                        FROM ohlcv_daily WHERE date <= ?) r
                  WHERE r.rn <= 200
                  GROUP BY symbol HAVING COUNT(*) >= 150) m ON t.symbol = m.symbol
            WHERE t.rn = 1
        """, (as_of_date, as_of_date)).fetchone()
        above_ma200, total_ma200 = (row[0] or 0), max(1, row[1] or 1)
        pct_above_ma200 = round(above_ma200 / total_ma200 * 100, 1)

        # % above MA50 (require >= 40 rows)
        row2 = con.execute("""
            SELECT SUM(CASE WHEN t.close > m.ma50 THEN 1 ELSE 0 END),
                   COUNT(*)
            FROM (SELECT symbol, close,
                         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                  FROM ohlcv_daily WHERE date <= ?) t
            JOIN (SELECT symbol, AVG(close) AS ma50
                  FROM (SELECT symbol, close,
                               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                        FROM ohlcv_daily WHERE date <= ?) r
                  WHERE r.rn <= 50
                  GROUP BY symbol HAVING COUNT(*) >= 40) m ON t.symbol = m.symbol
            WHERE t.rn = 1
        """, (as_of_date, as_of_date)).fetchone()
        above_ma50, total_ma50 = (row2[0] or 0), max(1, row2[1] or 1)
        pct_above_ma50 = round(above_ma50 / total_ma50 * 100, 1)

        # 52w new highs / new lows
        row3 = con.execute("""
            SELECT
              SUM(CASE WHEN t.close >= h.high52 * 0.995 THEN 1 ELSE 0 END) AS new_highs,
              SUM(CASE WHEN t.close <= h.low52  * 1.005 THEN 1 ELSE 0 END) AS new_lows,
              COUNT(*) AS total
            FROM (SELECT symbol, close,
                         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                  FROM ohlcv_daily WHERE date <= ?) t
            JOIN (SELECT symbol,
                         MAX(close) AS high52,
                         MIN(close) AS low52
                  FROM (SELECT symbol, close,
                               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                        FROM ohlcv_daily WHERE date <= ?) r
                  WHERE r.rn <= 252
                  GROUP BY symbol HAVING COUNT(*) >= 200) h ON t.symbol = h.symbol
            WHERE t.rn = 1
        """, (as_of_date, as_of_date)).fetchone()
        new_highs  = row3[0] or 0
        new_lows   = row3[1] or 0
        total_hl   = max(1, row3[2] or 1)
        pct_52w_high = round(new_highs / total_hl * 100, 1)
        pct_52w_low  = round(new_lows  / total_hl * 100, 1)

        universe_count = total_ma200
        con.close()

    except Exception as e:
        print(f"[breadth] compute failed: {e}")
        return {
            "as_of": as_of_date, "universe_count": 0,
            "pct_above_ma200": None, "pct_above_ma50": None,
            "pct_52w_high": None, "pct_52w_low": None,
            "divergence": False, "divergence_signal": "UNAVAILABLE",
            "divergence_desc": "", "health_label": "N/A", "health_color": "#6b7280",
        }

    # Divergence detection: index near high but breadth weak
    divergence       = False
    divergence_strong = False
    if qqq_dd_pct is not None:
        qqq_near_high    = qqq_dd_pct > -8.0
        breadth_weak     = pct_above_ma200 < 55.0
        breadth_trailing = pct_above_ma50 < pct_above_ma200 - 12
        divergence        = qqq_near_high and breadth_weak
        divergence_strong = qqq_near_high and breadth_weak and breadth_trailing

    if divergence_strong:
        div_signal = "TOP_WARNING_STRONG"
        div_desc   = "지수 고점 근처 + MA200/MA50 동반 약화 — 분산 고점 경보"
    elif divergence:
        div_signal = "TOP_WARNING"
        div_desc   = "지수 고점 근처이나 광범위 종목 MA200 상회율 약세"
    else:
        div_signal = "HEALTHY" if pct_above_ma200 >= 60 else "SOFTENING"
        div_desc   = ""

    # Health label
    if pct_above_ma200 >= 70:
        health_label, health_color = "Strong",    "#22c55e"
    elif pct_above_ma200 >= 60:
        health_label, health_color = "Healthy",   "#4ade80"
    elif pct_above_ma200 >= 50:
        health_label, health_color = "Softening", "#f59e0b"
    elif pct_above_ma200 >= 40:
        health_label, health_color = "Weak",      "#f97316"
    else:
        health_label, health_color = "Collapsing","#ef4444"

    return {
        "as_of":           as_of_date,
        "universe_count":  universe_count,
        "pct_above_ma200": pct_above_ma200,
        "pct_above_ma50":  pct_above_ma50,
        "pct_52w_high":    pct_52w_high,
        "pct_52w_low":     pct_52w_low,
        "divergence":      bool(divergence),
        "divergence_signal": div_signal,
        "divergence_desc": div_desc,
        "health_label":    health_label,
        "health_color":    health_color,
    }


def _layer2_breadth(spy_s: pd.Series, qqq_s: pd.Series, breadth_metrics: dict | None = None) -> dict:
    """Layer 2: Market Breadth (0-10). Real universe breadth when available, SPY proxy otherwise."""
    pts = 0

    if len(spy_s) >= 21:
        # SPY 52-week drawdown (max 4 pts)
        spy_52w_high = float(spy_s.tail(252).max()) if len(spy_s) >= 252 else float(spy_s.max())
        spy_dd = float(spy_s.iloc[-1] / spy_52w_high - 1) * 100
        if spy_dd < -17:
            pts += 4
        elif spy_dd < -12:
            pts += 3
        elif spy_dd < -7:
            pts += 2
        elif spy_dd < -3:
            pts += 1

        # SPY vs MA200 distance (max 3 pts)
        if len(spy_s) >= 200:
            spy_ma200 = float(spy_s.tail(200).mean())
            spy_vs_ma200 = float(spy_s.iloc[-1] / spy_ma200 - 1) * 100
            if spy_vs_ma200 < -3:
                pts += 3
            elif spy_vs_ma200 < 0:
                pts += 2
            elif spy_vs_ma200 < 3:
                pts += 1

    # Real universe breadth (max 4 pts) — replaces QQQ/SPY rotation when available
    if breadth_metrics and breadth_metrics.get("pct_above_ma200") is not None:
        ma200_pct = breadth_metrics["pct_above_ma200"]
        ma50_pct  = breadth_metrics["pct_above_ma50"] or 0.0
        lo52_pct  = breadth_metrics["pct_52w_low"]    or 0.0
        if ma200_pct < 40:
            pts += 4
        elif ma200_pct < 50:
            pts += 3
        elif ma200_pct < 55:
            pts += 2
        elif ma200_pct < 62:
            pts += 1
        # MA50 breadth trailing MA200 = deterioration velocity bonus
        if ma50_pct < ma200_pct - 15:
            pts += 1
        # 52w new lows excess
        if lo52_pct > 5:
            pts += 2
        elif lo52_pct > 2:
            pts += 1
    else:
        # Fallback: QQQ/SPY 20d rotation trend (max 3 pts)
        if len(spy_s) >= 21 and len(qqq_s) >= 21:
            combined = pd.DataFrame({"spy": spy_s, "qqq": qqq_s}).dropna()
            if len(combined) >= 21:
                ratio_now = float(combined["qqq"].iloc[-1] / combined["spy"].iloc[-1])
                ratio_20d = float(combined["qqq"].iloc[-21] / combined["spy"].iloc[-21])
                chg = (ratio_now / ratio_20d - 1) * 100
                if chg < -4:
                    pts += 3
                elif chg < -2:
                    pts += 2
                elif chg < -0.5:
                    pts += 1

    pts = min(10, max(0, pts))
    if pts <= 2:
        desc = "Broad market breadth healthy. SPY holding MA200, tech rotation supportive."
    elif pts <= 5:
        desc = "Breadth softening. SPY drawdown building, tech rotation slightly negative."
    elif pts <= 8:
        desc = "Breadth deteriorating. Market-wide weakness, not just sector-specific."
    else:
        desc = "Breadth breakdown. Systemic broad market deterioration confirmed."
    return {"score": pts, "max": 10, "label": "Market Breadth", "desc": desc}


def _layer3_credit(hyg_s: pd.Series, lqd_s: pd.Series, basket_dfs: list) -> dict:
    """Layer 3: Credit Stress (0-12). HYG drawdown + HYG/LQD spread + alt manager basket."""
    pts = 0

    # HYG drawdown (max 4 pts)
    if len(hyg_s) >= 20:
        hyg_dd = float(hyg_s.iloc[-1] / hyg_s.tail(60).max() - 1) * 100
        if hyg_dd < -8:
            pts += 4
        elif hyg_dd < -5:
            pts += 3
        elif hyg_dd < -3:
            pts += 2
        elif hyg_dd < -1.5:
            pts += 1

    # HYG vs LQD 20d spread (max 4 pts)
    if len(hyg_s) >= 21 and len(lqd_s) >= 21:
        combined = pd.DataFrame({"hyg": hyg_s, "lqd": lqd_s}).dropna()
        if len(combined) >= 21:
            hyg_20d = float(combined["hyg"].iloc[-1] / combined["hyg"].iloc[-21] - 1)
            lqd_20d = float(combined["lqd"].iloc[-1] / combined["lqd"].iloc[-21] - 1)
            spread = hyg_20d - lqd_20d
            if spread < -0.04:
                pts += 4
            elif spread < -0.02:
                pts += 3
            elif spread < -0.01:
                pts += 2
            elif spread < -0.005:
                pts += 1

    # Alt manager basket BX/KKR/APO/ARES (max 4 pts)
    basket_dds = []
    for df in basket_dfs:
        if not isinstance(df, pd.DataFrame) or df.empty:
            continue
        s = df.iloc[:, 0]
        if len(s) >= 20:
            peak = float(s.tail(60).max())
            dd = float(s.iloc[-1] / peak - 1) * 100 if peak > 0 else 0
            basket_dds.append(dd)
    if basket_dds:
        avg_dd = sum(basket_dds) / len(basket_dds)
        if avg_dd < -20:
            pts += 4
        elif avg_dd < -12:
            pts += 3
        elif avg_dd < -7:
            pts += 2
        elif avg_dd < -4:
            pts += 1

    pts = min(12, max(0, pts))
    if pts <= 2:
        desc = "HY credit stable. Spreads contained, private credit managers holding."
    elif pts <= 5:
        desc = "Early HY spread widening. Private credit showing mild redemption pressure."
    elif pts <= 9:
        desc = "Credit stress building. HYG underperforming IG, manager drawdowns widen."
    else:
        desc = "Credit crisis signals. Severe spread widening, private credit in distress."
    return {"score": pts, "max": 12, "label": "Credit Stress", "desc": desc}


def _layer4_leveraged_loan(bkln_df: pd.DataFrame, srln_df: pd.DataFrame, hyg_s: pd.Series) -> dict:
    """Layer 4: Leveraged Loan Stress (0-13). BKLN + SRLN drawdown + relative vs HY."""
    pts = 0

    def _dd60(df: pd.DataFrame) -> float | None:
        if df.empty or len(df) < 10:
            return None
        s = df.iloc[:, 0]
        peak = float(s.tail(60).max())
        return float(s.iloc[-1] / peak - 1) * 100 if peak > 0 else None

    bkln_dd = _dd60(bkln_df)
    srln_dd = _dd60(srln_df)

    # BKLN drawdown (max 5 pts)
    if bkln_dd is not None:
        if bkln_dd < -5:
            pts += 5
        elif bkln_dd < -3:
            pts += 4
        elif bkln_dd < -1.5:
            pts += 2
        elif bkln_dd < -0.5:
            pts += 1

    # SRLN drawdown (max 4 pts)
    if srln_dd is not None:
        if srln_dd < -5:
            pts += 4
        elif srln_dd < -3:
            pts += 3
        elif srln_dd < -1.5:
            pts += 2
        elif srln_dd < -0.5:
            pts += 1

    # BKLN vs HYG relative stress (max 4 pts): BKLN underperforming HYG = LBO market worse than HY
    if not bkln_df.empty and len(hyg_s) >= 21 and len(bkln_df) >= 21:
        bkln_s = bkln_df.iloc[:, 0]
        combined = pd.DataFrame({"bkln": bkln_s, "hyg": hyg_s}).dropna()
        if len(combined) >= 21:
            bkln_20d = float(combined["bkln"].iloc[-1] / combined["bkln"].iloc[-21] - 1)
            hyg_20d  = float(combined["hyg"].iloc[-1]  / combined["hyg"].iloc[-21]  - 1)
            rel = bkln_20d - hyg_20d
            if rel < -0.03:
                pts += 4
            elif rel < -0.015:
                pts += 3
            elif rel < -0.007:
                pts += 1

    pts = min(13, max(0, pts))
    if pts <= 2:
        desc = "Leveraged loan market stable. LBO debt holding, BKLN/SRLN near highs."
    elif pts <= 5:
        desc = "Mild loan market softness. Senior loans showing early spread pressure."
    elif pts <= 9:
        desc = "Loan market stress. BKLN/SRLN drawdowns, underperforming HY bonds."
    else:
        desc = "Leveraged loan crisis. LBO debt market disruption -- private equity at risk."
    return {"score": pts, "max": 13, "label": "Leveraged Loans", "desc": desc}


def _layer5_liquidity(dxy_s: pd.Series, hyg_s: pd.Series, lqd_s: pd.Series, vix_s: pd.Series) -> dict:
    """Layer 5: Liquidity Stress (0-13). DXY spike + HYG/LQD ratio + VIX level."""
    pts = 0

    # DXY 20d spike (max 5 pts) -- dollar strength = global liquidity drain
    if len(dxy_s) >= 21:
        dxy_20d = float(dxy_s.iloc[-1] / dxy_s.iloc[-21] - 1) * 100
        if dxy_20d > 4:
            pts += 5
        elif dxy_20d > 2.5:
            pts += 4
        elif dxy_20d > 1.5:
            pts += 2
        elif dxy_20d > 0.8:
            pts += 1

    # HYG/LQD ratio trend (max 4 pts) -- HY underperforming IG = liquidity preference shift
    if len(hyg_s) >= 21 and len(lqd_s) >= 21:
        combined = pd.DataFrame({"hyg": hyg_s, "lqd": lqd_s}).dropna()
        if len(combined) >= 21:
            ratio_now = float(combined["hyg"].iloc[-1]  / combined["lqd"].iloc[-1])
            ratio_20d = float(combined["hyg"].iloc[-21] / combined["lqd"].iloc[-21])
            chg = (ratio_now / ratio_20d - 1) * 100
            if chg < -3:
                pts += 4
            elif chg < -1.5:
                pts += 3
            elif chg < -0.7:
                pts += 1

    # VIX level threshold (max 4 pts) -- elevated VIX = liquidity premium demanded
    if len(vix_s) >= 5:
        vix_now = float(vix_s.iloc[-1])
        if vix_now > 35:
            pts += 4
        elif vix_now > 25:
            pts += 3
        elif vix_now > 20:
            pts += 2
        elif vix_now > 17:
            pts += 1

    pts = min(13, max(0, pts))
    if pts <= 2:
        desc = "Liquidity conditions benign. DXY stable, HY/IG ratio healthy, VIX contained."
    elif pts <= 5:
        desc = "Mild liquidity tightening. Dollar strengthening, some preference for IG."
    elif pts <= 9:
        desc = "Liquidity stress elevated. DXY spike, HY/IG spread widening, VIX above 20."
    else:
        desc = "Acute liquidity drain. Dollar surge, HY collapse, VIX extreme -- systemic stress."
    return {"score": pts, "max": 13, "label": "Liquidity", "desc": desc}


def _layer6_funding(vix_s: pd.Series, put_call_s: pd.Series, hyg_s: pd.Series) -> dict:
    """Layer 6: Funding Stress (0-12). VIX velocity + PUT/CALL extreme + HYG acute stress.
    Proxy for SOFR/TED spread (2008, 2020 crisis core indicator).
    """
    pts = 0

    # VIX 10-day velocity (max 4 pts) -- rapid VIX increase = acute funding pressure
    if len(vix_s) >= 11:
        vix_now = float(vix_s.iloc[-1])
        vix_10d = float(vix_s.iloc[-11])
        vix_chg  = vix_now - vix_10d
        if vix_chg > 15:
            pts += 4
        elif vix_chg > 8:
            pts += 3
        elif vix_chg > 4:
            pts += 2
        elif vix_chg > 1.5:
            pts += 1

    # PUT/CALL ratio spike (max 4 pts) -- hedging demand = funding cost premium
    if len(put_call_s) >= 10:
        pc_now = float(put_call_s.iloc[-1])
        pc_avg = float(put_call_s.tail(60).mean()) if len(put_call_s) >= 60 else float(put_call_s.mean())
        pc_zscore = (pc_now - pc_avg) / (float(put_call_s.tail(60).std()) + 1e-9) if len(put_call_s) >= 10 else 0
        if pc_zscore > 2.5 or pc_now > 1.3:
            pts += 4
        elif pc_zscore > 1.5 or pc_now > 1.1:
            pts += 3
        elif pc_zscore > 0.8 or pc_now > 0.95:
            pts += 1

    # HYG acute 10d stress (max 4 pts) -- short-term HY crash = funding market seizing
    if len(hyg_s) >= 11:
        hyg_10d_chg = float(hyg_s.iloc[-1] / hyg_s.iloc[-11] - 1) * 100
        if hyg_10d_chg < -5:
            pts += 4
        elif hyg_10d_chg < -3:
            pts += 3
        elif hyg_10d_chg < -1.5:
            pts += 2
        elif hyg_10d_chg < -0.7:
            pts += 1

    pts = min(12, max(0, pts))
    if pts <= 2:
        desc = "Funding markets calm. No acute VIX velocity, PUT/CALL normal, HYG stable."
    elif pts <= 5:
        desc = "Early funding friction. VIX rising moderately, hedging demand ticking up."
    elif pts <= 9:
        desc = "Funding stress evident. VIX spiking, excessive hedging, HYG under pressure."
    else:
        desc = "Funding crisis. Acute VIX surge + HYG crash -- 2008/2020-type market seizure."
    return {"score": pts, "max": 12, "label": "Funding Stress", "desc": desc}


def _layer7_macro(xlf_df: pd.DataFrame, xlu_df: pd.DataFrame, spy_df: pd.DataFrame) -> dict:
    """Layer 7: Macro Regime (0-13). XLF vs SPY + XLU rotation + SPY MA200."""
    pts = 0

    spy_s = spy_df.iloc[:, 0] if not spy_df.empty else pd.Series(dtype=float)

    # XLF vs SPY 20d relative (max 5 pts) -- financials underperforming = macro stress
    if not xlf_df.empty and len(spy_s) >= 21:
        xlf_s = xlf_df.iloc[:, 0]
        combined = pd.DataFrame({"xlf": xlf_s, "spy": spy_s}).dropna()
        if len(combined) >= 21:
            xlf_ret = float(combined["xlf"].iloc[-1] / combined["xlf"].iloc[-21] - 1)
            spy_ret = float(combined["spy"].iloc[-1] / combined["spy"].iloc[-21] - 1)
            rel = xlf_ret - spy_ret
            if rel < -0.05:
                pts += 5
            elif rel < -0.03:
                pts += 4
            elif rel < -0.015:
                pts += 2
            elif rel < -0.005:
                pts += 1

    # XLU vs SPY 20d relative (max 4 pts) -- utilities outperforming = defensive rotation
    if not xlu_df.empty and len(spy_s) >= 21:
        xlu_s = xlu_df.iloc[:, 0]
        combined = pd.DataFrame({"xlu": xlu_s, "spy": spy_s}).dropna()
        if len(combined) >= 21:
            xlu_ret = float(combined["xlu"].iloc[-1] / combined["xlu"].iloc[-21] - 1)
            spy_ret = float(combined["spy"].iloc[-1] / combined["spy"].iloc[-21] - 1)
            rel = xlu_ret - spy_ret
            if rel > 0.04:
                pts += 4
            elif rel > 0.02:
                pts += 3
            elif rel > 0.01:
                pts += 2
            elif rel > 0.003:
                pts += 1

    # SPY vs MA200 (max 4 pts) -- macro regime anchor
    if len(spy_s) >= 200:
        spy_ma200 = float(spy_s.tail(200).mean())
        spy_vs_ma200 = float(spy_s.iloc[-1] / spy_ma200 - 1) * 100
        if spy_vs_ma200 < -5:
            pts += 4
        elif spy_vs_ma200 < -2:
            pts += 3
        elif spy_vs_ma200 < 0:
            pts += 2
        elif spy_vs_ma200 < 2:
            pts += 1

    pts = min(13, max(0, pts))
    if pts <= 2:
        desc = "Macro / Defensive constructive. XLF leading SPY, no XLU rotation, market above MA200."
    elif pts <= 5:
        desc = "Macro softening. Mild XLF underperformance, early defensive bid (XLU starting to lead)."
    elif pts <= 9:
        desc = "Macro stress. XLF lagging SPY, XLU outperforming -- classic defensive rotation signal."
    else:
        desc = "Macro deterioration. XLF/KRE breaking down, XLU dominant -- full defensive rotation active."
    return {"score": pts, "max": 13, "label": "Macro / Defensive Rotation", "desc": desc}


def _layer8_shock(vix_s: pd.Series, put_call_s: pd.Series, spy_s: pd.Series, qqq_s: pd.Series) -> dict:
    """Layer 8: Shock Detector (0-12). VIX 5d spike + PUT/CALL extreme + QQQ/SPY divergence."""
    pts = 0

    # VIX 5-day spike (max 5 pts) -- sudden shock event detection
    if len(vix_s) >= 6:
        vix_now = float(vix_s.iloc[-1])
        vix_5d  = float(vix_s.iloc[-6])
        spike = vix_now - vix_5d
        if spike > 12:
            pts += 5
        elif spike > 7:
            pts += 4
        elif spike > 4:
            pts += 3
        elif spike > 2:
            pts += 1

    # PUT/CALL extreme (max 3 pts) -- panic hedging
    if len(put_call_s) >= 5:
        pc = float(put_call_s.iloc[-1])
        if pc > 1.4:
            pts += 3
        elif pc > 1.15:
            pts += 2
        elif pc > 1.0:
            pts += 1

    # QQQ/SPY 5d divergence (max 4 pts) -- rapid tech underperformance = shock signal
    if len(spy_s) >= 6 and len(qqq_s) >= 6:
        combined = pd.DataFrame({"spy": spy_s, "qqq": qqq_s}).dropna()
        if len(combined) >= 6:
            qqq_5d = float(combined["qqq"].iloc[-1] / combined["qqq"].iloc[-6] - 1)
            spy_5d = float(combined["spy"].iloc[-1] / combined["spy"].iloc[-6] - 1)
            div = qqq_5d - spy_5d
            if div < -0.04:
                pts += 4
            elif div < -0.02:
                pts += 3
            elif div < -0.01:
                pts += 2
            elif div < -0.004:
                pts += 1

    pts = min(12, max(0, pts))
    if pts <= 2:
        desc = "No shock signals. VIX stable, PUT/CALL normal, QQQ/SPY rotation benign."
    elif pts <= 5:
        desc = "Mild shock indicators. Some VIX uptick, modest hedging, minor tech divergence."
    elif pts <= 9:
        desc = "Shock signals active. Rapid VIX spike, elevated put buying, tech sell-off."
    else:
        desc = "Shock event detected. Extreme VIX surge, panic hedging, sharp tech breakdown."
    return {"score": pts, "max": 12, "label": "Shock Detector", "desc": desc}


def _layer9_cross_asset(spy_s: pd.Series, hyg_s: pd.Series, bkln_df: pd.DataFrame, xlf_df: pd.DataFrame, iwm_df: pd.DataFrame) -> dict:
    """Layer 9: Cross-Asset Stress (0-10).
    Detects credit/equity correlation breakdown -- credit weakens before equities in crises.
    HYG/SPY + BKLN/SPY + XLF/SPY + IWM/SPY 20d trends. All-negative bonus.
    """
    pts = 0
    neg_count = 0

    def _ratio_20d(num_s: pd.Series, den_s: pd.Series) -> float | None:
        combined = pd.DataFrame({"num": num_s, "den": den_s}).dropna()
        if len(combined) < 21:
            return None
        r_now = float(combined["num"].iloc[-1]  / combined["den"].iloc[-1])
        r_20d = float(combined["num"].iloc[-21] / combined["den"].iloc[-21])
        return (r_now / r_20d - 1) * 100 if r_20d > 0 else None

    # HYG/SPY (junk bonds vs equities) -- max 2 pts
    r_hyg = _ratio_20d(hyg_s, spy_s)
    if r_hyg is not None:
        if r_hyg < -2:
            pts += 2; neg_count += 1
        elif r_hyg < -0.8:
            pts += 1; neg_count += 1

    # BKLN/SPY (leveraged loans vs equities) -- max 2 pts
    if not bkln_df.empty:
        bkln_s = bkln_df.iloc[:, 0]
        r_bkln = _ratio_20d(bkln_s, spy_s)
        if r_bkln is not None:
            if r_bkln < -2:
                pts += 2; neg_count += 1
            elif r_bkln < -0.8:
                pts += 1; neg_count += 1

    # XLF/SPY (financial sector stress) -- max 2 pts
    if not xlf_df.empty:
        xlf_s = xlf_df.iloc[:, 0]
        r_xlf = _ratio_20d(xlf_s, spy_s)
        if r_xlf is not None:
            if r_xlf < -2.5:
                pts += 2; neg_count += 1
            elif r_xlf < -1:
                pts += 1; neg_count += 1

    # IWM/SPY (small cap risk appetite) -- max 1 pt
    if not iwm_df.empty:
        iwm_s = iwm_df.iloc[:, 0]
        r_iwm = _ratio_20d(iwm_s, spy_s)
        if r_iwm is not None:
            if r_iwm < -2:
                pts += 1; neg_count += 1

    # All 4 signals negative -- systemic divergence bonus: +3
    if neg_count >= 4:
        pts += 3

    pts = min(10, max(0, pts))
    if pts <= 1:
        desc = "Credit/equity correlation intact. No cross-asset divergence signals."
    elif pts <= 3:
        desc = "Mild credit-equity divergence. HY or loan markets slightly underperforming."
    elif pts <= 6:
        desc = "Cross-asset stress building. Credit markets broadly weakening vs equities."
    else:
        desc = "Systemic divergence. All credit signals negative vs equities -- crisis early warning."
    return {"score": pts, "max": 10, "label": "Cross-Asset", "desc": desc}


def _layer10_credit_spread(hy_oas_s: pd.Series, ig_oas_s: pd.Series, fsi_s: pd.Series, put_call_s: pd.Series) -> dict:
    """Layer 10: Credit Spread Monitor (0-10).
    Uses real FRED data: HY OAS (BAMLH0A0HYM2), IG OAS (BAMLC0A0CM), St. Louis FSI (STLFSI4).
    Thresholds calibrated on 2000-2026 history.
    """
    pts = 0
    hy_oas = None
    ig_oas = None
    spread = None
    fsi = None
    pc = None
    pc_avg = None

    # HY OAS: ICE BofA US HY Index OAS in percent (3.0 = 300 bps) -- max 3 pts
    # Normal: <4.0%  Mild: 4-5%  Stressed: 5-7%  Crisis: >7%
    if len(hy_oas_s) >= 5:
        hy_oas = float(hy_oas_s.iloc[-1])
        if hy_oas > 7.0:
            pts += 3   # Crisis (2008/2020 level)
        elif hy_oas > 5.0:
            pts += 2   # Elevated (2022 recession-scare level)
        elif hy_oas > 4.0:
            pts += 1   # Mild stress (above post-2012 normal)

    # HY-IG Spread (OAS differential in pct): measures credit risk premium -- max 3 pts
    # Normal <2.5%  Mild: 2.5-3.5%  Stressed: 3.5-5%  Crisis: >5%
    if len(hy_oas_s) >= 5 and len(ig_oas_s) >= 5:
        hy = float(hy_oas_s.iloc[-1])
        ig = float(ig_oas_s.iloc[-1])
        hy_oas = hy
        ig_oas = ig
        spread = hy - ig
        if spread > 5.0:
            pts += 3   # Extreme: credit risk pricing at crisis level
        elif spread > 3.5:
            pts += 2   # Elevated: significant HY vs IG divergence
        elif spread > 2.8:
            pts += 1   # Mild: starting to widen

    # St. Louis Financial Stress Index (STLFSI4) -- max 2 pts
    # <0 = below normal stress (good)  0-1 = normal  1-2 = elevated  >2 = high stress
    if len(fsi_s) >= 3:
        fsi = float(fsi_s.iloc[-1])
        if fsi > 2.0:
            pts += 2   # High financial stress
        elif fsi > 1.0:
            pts += 1   # Elevated financial stress

    # PUT/CALL ratio spike -- funding stress proxy (TED discontinued 2022) -- max 2 pts
    if len(put_call_s) >= 10:
        pc = float(put_call_s.iloc[-1])
        pc_avg = float(put_call_s.tail(60).mean()) if len(put_call_s) >= 60 else float(put_call_s.mean())
        if pc > 1.3 or pc > pc_avg * 1.4:
            pts += 2
        elif pc > 1.05 or pc > pc_avg * 1.15:
            pts += 1

    pts = min(10, max(0, pts))
    if pts <= 1:
        status = "Normal"
        desc = "Spreads contained. HY OAS normal, FSI benign, no funding stress."
    elif pts <= 3:
        status = "Mild widening"
        desc = "Mild widening. Early credit pressure developing."
    elif pts <= 6:
        status = "Elevated widening"
        desc = "Spreads widening meaningfully. Credit risk repricing underway."
    else:
        status = "Crisis widening"
        desc = "Crisis widening. Credit stress at 2008/2020-type extremes."

    details = []
    if hy_oas is not None:
        details.append(f"HY OAS {hy_oas:.2f}%")
    if spread is not None:
        details.append(f"HY-IG {spread:.2f}%")
    if fsi is not None:
        details.append(f"FSI {fsi:.2f}")
    if pc is not None:
        details.append(f"Put/Call {pc:.2f}")
    if details:
        desc = f"{status}: " + " | ".join(details) + ". " + desc

    return {
        "score": pts,
        "max": 10,
        "label": "Credit Spreads",
        "desc": desc,
        "status": status,
        "metrics": {
            "hy_oas": hy_oas,
            "ig_oas": ig_oas,
            "spread": spread,
            "fsi": fsi,
            "put_call": pc,
        },
    }

def _layer11_liquidity_shock(dxy_s: pd.Series, tlt_s: pd.Series, move_s: pd.Series, vix_s: pd.Series) -> dict:
    """Layer 11: Liquidity Shock Engine (0-10).
    Signals: DXY spike, TLT flight, MOVE jump, VIX panic, correlated shock bonus.
    """
    pts = 0
    dxy_shock = False
    tlt_flight = False
    move_spike = False
    vix_panic = False

    # DXY > 3% above 20d MA
    if len(dxy_s) >= 21:
        dxy_ma20 = float(dxy_s.tail(20).mean())
        dxy_now = float(dxy_s.iloc[-1])
        if dxy_ma20 > 0 and (dxy_now / dxy_ma20 - 1) * 100 > 3:
            pts += 3
            dxy_shock = True

    # TLT > 2.5% above 10d MA
    if len(tlt_s) >= 11:
        tlt_ma10 = float(tlt_s.tail(10).mean())
        tlt_now = float(tlt_s.iloc[-1])
        if tlt_ma10 > 0 and (tlt_now / tlt_ma10 - 1) * 100 > 2.5:
            pts += 2
            tlt_flight = True

    # MOVE index > 110
    if len(move_s) >= 1:
        move_now = float(move_s.iloc[-1])
        if move_now > 110:
            pts += 2
            move_spike = True

    # VIX > 30
    if len(vix_s) >= 1:
        vix_now = float(vix_s.iloc[-1])
        if vix_now > 30:
            pts += 2
            vix_panic = True

    # Correlated panic bonus
    if dxy_shock and tlt_flight and vix_panic:
        pts += 3

    pts = min(10, max(0, pts))
    if pts <= 2:
        desc = "Liquidity conditions stable. No broad funding stress signals."
    elif pts <= 5:
        desc = "Early liquidity stress. Dollar firming or VIX rising."
    elif pts <= 8:
        desc = "Liquidity tightening. Safe-haven demand and volatility rising."
    else:
        desc = "Liquidity shock active. Correlated panic across USD, Treasuries, and VIX."
    return {
        "score": pts,
        "max": 10,
        "label": "Liquidity Shock",
        "desc": desc,
        "signals": {
            "dxy_shock": dxy_shock,
            "tlt_flight": tlt_flight,
            "move_spike": move_spike,
            "vix_panic": vix_panic,
        },
    }


def _layer12_financial_stress(xlf_df: pd.DataFrame, kre_df: pd.DataFrame, spy_s: pd.Series,
                              credit_layer: dict, lev_loan_layer: dict, credit_spread_layer: dict) -> dict:
    """Layer 12: Financial Sector Stress (0-10).
    Signals: XLF/SPY and KRE/SPY relative weakness, MA200 breaks,
    and drawdown widening during elevated credit stress.
    """
    pts = 0
    signals = []

    xlf_s = xlf_df.iloc[:, 0] if not xlf_df.empty else pd.Series(dtype=float)
    kre_s = kre_df.iloc[:, 0] if not kre_df.empty else pd.Series(dtype=float)

    # Relative strength vs SPY (20d trend)
    if len(spy_s) >= 21 and len(xlf_s) >= 21:
        rs_xlf = (xlf_s / spy_s).dropna()
        if len(rs_xlf) >= 21:
            rs_chg = float(rs_xlf.iloc[-1] / rs_xlf.iloc[-21] - 1)
            if rs_chg < 0:
                pts += 2
                signals.append("XLF/SPY weak (20d)")

    if len(spy_s) >= 21 and len(kre_s) >= 21:
        rs_kre = (kre_s / spy_s).dropna()
        if len(rs_kre) >= 21:
            rs_chg = float(rs_kre.iloc[-1] / rs_kre.iloc[-21] - 1)
            if rs_chg < 0:
                pts += 2
                signals.append("KRE/SPY weak (20d)")

    # Trend deterioration vs MA200
    if len(xlf_s) >= 200:
        xlf_ma200 = float(xlf_s.tail(200).mean())
        if xlf_ma200 > 0 and float(xlf_s.iloc[-1]) < xlf_ma200:
            pts += 2
            signals.append("XLF below MA200")
    if len(kre_s) >= 200:
        kre_ma200 = float(kre_s.tail(200).mean())
        if kre_ma200 > 0 and float(kre_s.iloc[-1]) < kre_ma200:
            pts += 2
            signals.append("KRE below MA200")

    # Drawdown stress + credit/loan/spread elevated bonus
    credit_elev = (credit_layer["score"] / credit_layer["max"]) > 0.5 if credit_layer["max"] > 0 else False
    loan_elev = (lev_loan_layer["score"] / lev_loan_layer["max"]) > 0.5 if lev_loan_layer["max"] > 0 else False
    spread_elev = (credit_spread_layer["score"] / credit_spread_layer["max"]) > 0.5 if credit_spread_layer["max"] > 0 else False
    if credit_elev or loan_elev or spread_elev:
        if len(xlf_s) >= 20:
            dd20 = float(xlf_s.iloc[-1] / xlf_s.tail(20).max() - 1)
            if dd20 <= -0.08:
                pts += 2
                signals.append("XLF drawdown widening")

    pts = min(10, max(0, pts))
    if pts <= 2:
        desc = "Financials stable. No evidence that credit stress is transmitting into banks/brokers."
    elif pts <= 5:
        desc = "Early financial sector weakness. Monitor XLF/KRE vs SPY for further deterioration."
    elif pts <= 8:
        desc = "Financial sector stress rising. Credit stress may be propagating into transmission layer."
    else:
        desc = "Financial transmission under pressure. Systemic propagation risk elevated."
    dominant = signals[0] if signals else "Stable"
    return {
        "score": pts,
        "max": 10,
        "label": "Financial Stress",
        "desc": desc,
        "dominant_signal": dominant,
        "signals": signals,
    }


def compute_concentration(as_of_date: str | None = None) -> dict:
    """Compute MAG7 (AAPL/MSFT/NVDA/GOOGL/AMZN/META/TSLA) momentum vs SPY.
    Uses ohlcv_daily table. Returns relative return for 5d/20d/60d windows.
    """
    MAG7 = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA']
    result = {"available": False, "mag7_5d": None, "mag7_20d": None, "mag7_60d": None,
              "spy_5d": None, "spy_20d": None, "spy_60d": None,
              "rel_5d": None, "rel_20d": None, "rel_60d": None,
              "label": "N/A", "color": "#9ca3af", "risk": "unknown"}
    try:
        if not os.path.exists(DB_PATH):
            result["error"] = f"DB not found: {DB_PATH}"
            return result
        con = sqlite3.connect(DB_PATH)
        all_syms = MAG7 + ['SPY']
        rows = []
        for sym in all_syms:
            if as_of_date:
                r = con.execute(
                    "SELECT date, close FROM ohlcv_daily WHERE symbol=? AND date<=? ORDER BY date DESC LIMIT 65",
                    (sym, as_of_date)).fetchall()
            else:
                r = con.execute(
                    "SELECT date, close FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT 65",
                    (sym,)).fetchall()
            if r:
                rows.append((sym, list(reversed(r))))
        con.close()
        sym_map = {sym: closes for sym, closes in rows}
        if 'SPY' not in sym_map:
            return result
        avail_mag7 = [s for s in MAG7 if s in sym_map and len(sym_map[s]) >= 21]
        if not avail_mag7:
            return result

        def _ret(closes_list, n):
            """Return n-day % return from most recent n+1 rows."""
            if len(closes_list) < n + 1:
                return None
            new = closes_list[-1][1]
            old = closes_list[-(n+1)][1]
            return (new / old - 1) * 100 if old else None

        # Equal-weight MAG7 return = average of available returns
        def _mag7_ret(n):
            rets = [_ret(sym_map[s], n) for s in avail_mag7 if _ret(sym_map[s], n) is not None]
            return sum(rets) / len(rets) if rets else None

        spy_5d  = _ret(sym_map['SPY'], 5)
        spy_20d = _ret(sym_map['SPY'], 20)
        spy_60d = _ret(sym_map['SPY'], 60)
        mag_5d  = _mag7_ret(5)
        mag_20d = _mag7_ret(20)
        mag_60d = _mag7_ret(60)

        def _rel(m, s):
            return round(m - s, 2) if m is not None and s is not None else None

        rel_5d  = _rel(mag_5d, spy_5d)
        rel_20d = _rel(mag_20d, spy_20d)
        rel_60d = _rel(mag_60d, spy_60d)

        # Concentration risk label
        # If MAG7 massively outperforming (rel_20d > 5%), market is narrow — risk
        # If MAG7 underperforming (rel_20d < -3%), broad market weakening too
        if rel_20d is not None and rel_20d > 5:
            label = "집중도 고위험"; color = "#f97316"; risk = "high"
        elif rel_20d is not None and rel_20d > 2:
            label = "집중도 주의"; color = "#f59e0b"; risk = "moderate"
        elif rel_20d is not None and rel_20d < -3:
            label = "MAG7 약세"; color = "#a78bfa"; risk = "mag7_weak"
        else:
            label = "분산 양호"; color = "#22c55e"; risk = "normal"

        result.update({
            "available": True,
            "mag7_5d":  round(mag_5d,  2) if mag_5d  is not None else None,
            "mag7_20d": round(mag_20d, 2) if mag_20d is not None else None,
            "mag7_60d": round(mag_60d, 2) if mag_60d is not None else None,
            "spy_5d":   round(spy_5d,  2) if spy_5d  is not None else None,
            "spy_20d":  round(spy_20d, 2) if spy_20d is not None else None,
            "spy_60d":  round(spy_60d, 2) if spy_60d is not None else None,
            "rel_5d":   rel_5d,
            "rel_20d":  rel_20d,
            "rel_60d":  rel_60d,
            "label": label, "color": color, "risk": risk,
            "count": len(avail_mag7),
        })
    except Exception as e:
        result["error"] = str(e)
    return result



def _crisis_stage(layers: dict) -> dict:
    """Compute crisis propagation stage (0-6) from layer scores.
    Updated path:
    Normal -> Credit Stress -> Loan Deterioration -> Credit Spread Widening
    -> Financial Sector Stress -> Broad Equity Deterioration -> Liquidity Crisis
    """
    def _ratio(key: str) -> float:
        l = layers[key]
        return l["score"] / l["max"] if l["max"] > 0 else 0

    eq = _ratio("equity"); br = _ratio("breadth"); cr = _ratio("credit")
    lv = _ratio("lev_loan"); lq = _ratio("liquidity"); fn = _ratio("funding")
    ma = _ratio("macro");   sh = _ratio("shock")
    ca = _ratio("cross_asset"); cs = _ratio("credit_spread")
    ls = _ratio("liquidity_shock") if "liquidity_shock" in layers else 0
    fs = _ratio("financial_stress") if "financial_stress" in layers else 0

    STAGE_LABELS = [
        "Normal",
        "Credit Stress",
        "Loan Market Stress",
        "Credit Spread Widening",
        "Financial Sector Stress",
        "Broad Equity Deterioration",
        "Liquidity Crisis",
    ]
    STAGE_PLAIN_KO = [
        "정상",
        "신용 스트레스",
        "대출시장 압박",
        "신용 스프레드 확대",
        "금융권 스트레스",
        "주식 구조 약화",
        "유동성 위기",
    ]
    STAGE_COLORS = ["#22c55e","#84cc16","#f59e0b","#fb923c","#f97316","#ef4444","#b91c1c"]
    STAGE_DESC = [
        "All systems normal. No systemic stress detected across credit transmission.",
        "Credit stress building. HY/IG conditions worsening.",
        "Leveraged loan market stressed. BKLN/SRLN drawdowns, LBO debt repricing.",
        "Credit spreads truly widening. HY OAS rising with spread expansion.",
        "Financial sector weakening. XLF/KRE underperforming -- transmission layer under pressure.",
        "Broad equity deterioration. Structure + breadth weakening materially.",
        "Liquidity crisis. Funding stress + shock conditions present.",
    ]

    stage = 0
    if (lq > 0.55 and ls > 0.45) or sh > 0.60:
        stage = 6   # Liquidity Crisis
    elif eq > 0.45 and br > 0.40:
        stage = 5   # Broad Equity Deterioration
    elif fs > 0.50:
        stage = 4   # Financial Sector Stress
    elif cs > 0.50:
        stage = 3   # Credit Spread Widening (true widening)
    elif lv > 0.46:
        stage = 2   # Loan Market Stress
    elif cr > 0.50:
        stage = 1   # Credit Stress

    return {
        "stage": stage,
        "label": STAGE_LABELS[stage],
        "plain_label_ko": STAGE_PLAIN_KO[stage],
        "color": STAGE_COLORS[stage],
        "desc": STAGE_DESC[stage],
        "all_labels": STAGE_LABELS,
        "all_labels_ko": STAGE_PLAIN_KO,
        "all_colors": STAGE_COLORS,
    }


def _report_l10_backtest_windows(hy_oas_s: pd.Series, ig_oas_s: pd.Series, fsi_s: pd.Series, put_call_s: pd.Series) -> None:
    """Prints when L10 (credit spreads) first reacts in key windows."""
    if hy_oas_s.empty and ig_oas_s.empty and fsi_s.empty and put_call_s.empty:
        print("[L10] backtest skipped (no series data).")
        return

    df = pd.DataFrame({
        "hy": hy_oas_s,
        "ig": ig_oas_s,
        "fsi": fsi_s,
        "pc": put_call_s,
    }).sort_index()
    if df.empty:
        print("[L10] backtest skipped (empty series).")
        return

    df["spread"] = df["hy"] - df["ig"]
    df["pc_avg"] = df["pc"].rolling(60, min_periods=20).mean()

    hy_score = np.select(
        [df["hy"] > 7.0, df["hy"] > 5.0, df["hy"] > 4.0],
        [3, 2, 1],
        default=0,
    )
    spread_score = np.select(
        [df["spread"] > 5.0, df["spread"] > 3.5, df["spread"] > 2.8],
        [3, 2, 1],
        default=0,
    )
    fsi_score = np.select(
        [df["fsi"] > 2.0, df["fsi"] > 1.0],
        [2, 1],
        default=0,
    )
    pc_score = np.select(
        [df["pc"] > 1.3, df["pc"] > df["pc_avg"] * 1.4, df["pc"] > 1.05, df["pc"] > df["pc_avg"] * 1.15],
        [2, 2, 1, 1],
        default=0,
    )
    df["l10_score"] = (hy_score + spread_score + fsi_score + pc_score).clip(0, 10)

    windows = [
        ("2008", "2008-01-01", "2009-12-31"),
        ("2020", "2020-01-01", "2020-12-31"),
        ("2022", "2022-01-01", "2022-12-31"),
        ("2025-2026", "2025-01-01", "2026-12-31"),
    ]
    print("[L10] backtest calibration windows (first reaction dates):")
    for label, start, end in windows:
        w = df.loc[start:end]
        if w.empty:
            print(f"  - {label}: no data")
            continue
        first_mild = w[w["l10_score"] >= 3].index.min()
        first_elev = w[w["l10_score"] >= 5].index.min()
        first_crisis = w[w["l10_score"] >= 7].index.min()
        def _fmt(d): return d.strftime("%Y-%m-%d") if pd.notna(d) else "n/a"
        print(f"  - {label}: mild>={_fmt(first_mild)}, elev>={_fmt(first_elev)}, crisis>={_fmt(first_crisis)}")



def _build_regime(layers: dict) -> dict:
    """Market Stress Regime Filter (MSRF).
    Classifies macro-financial environment into 4 regimes using layer scores as signals.
    Priority order: Liquidity Crisis > Credit Stress > Early Stress > Expansion.
    """
    def _s(key: str) -> int:
        return int(layers.get(key, {}).get("score", 0))

    cs   = _s("credit_spread")    # 0-10
    lv   = _s("lev_loan")         # 0-13
    cr   = _s("credit")           # 0-12
    fs   = _s("financial_stress") # 0-10
    lq   = _s("liquidity")        # 0-13
    ls   = _s("liquidity_shock")  # 0-10
    fn   = _s("funding")          # 0-12
    sh   = _s("shock")            # 0-12

    # ── Regime D: Liquidity Crisis ─────────────────────────────────────────
    if ls >= 5 or sh >= 6 or fn >= 6:
        drivers = []
        if ls >= 5: drivers.append(f"Liquidity Shock: {ls}/10")
        if sh >= 6: drivers.append(f"Shock Detector: {sh}/12")
        if fn >= 6: drivers.append(f"Funding Stress: {fn}/12")
        intensity = max(ls / 10, sh / 12, fn / 12)
        confidence = min(99, round(intensity * 100))
        weights = {"liquidity_shock": 1.6, "shock": 1.6, "funding": 1.4, "liquidity": 1.3}
        return {
            "regime": "Liquidity Crisis",
            "color": "#ef4444",
            "desc": "Funding stress and liquidity breakdown. Acute funding freeze, dollar surge, VIX extreme.",
            "confidence": confidence,
            "drivers": drivers,
            "weights": weights,
        }

    # ── Regime C: Credit Stress ────────────────────────────────────────────
    if cs >= 4 and cr >= 6 and fs >= 6:
        drivers = []
        if cs >= 4: drivers.append(f"Credit Spreads: {cs}/10")
        if cr >= 6: drivers.append(f"Credit Stress: {cr}/12")
        if fs >= 6: drivers.append(f"Financial Stress: {fs}/10")
        intensity = (cs / 10 + cr / 12 + fs / 10) / 3
        confidence = min(98, round(intensity * 100))
        weights = {"credit_spread": 1.4, "financial_stress": 1.4, "credit": 1.3, "lev_loan": 1.2, "funding": 1.2}
        return {
            "regime": "Credit Stress",
            "color": "#f97316",
            "desc": "Credit spreads widening and financial sector under pressure. Transmission into banking system active.",
            "confidence": confidence,
            "drivers": drivers,
            "weights": weights,
        }

    # ── Regime B: Early Stress ─────────────────────────────────────────────
    early_trigger = (lv >= 6 or cr >= 5) and fs >= 5 and cs <= 3
    if early_trigger:
        drivers = []
        if lv >= 6: drivers.append(f"Leveraged Loans: {lv}/13")
        if cr >= 5: drivers.append(f"Credit Stress: {cr}/12")
        if fs >= 5: drivers.append(f"Financial Stress: {fs}/10")
        intensity = (max(lv / 13, cr / 12) + fs / 10) / 2
        confidence = min(95, round(intensity * 100))
        weights = {"lev_loan": 1.3, "credit": 1.3, "financial_stress": 1.2, "funding": 1.2}
        return {
            "regime": "Early Stress",
            "color": "#f59e0b",
            "desc": "Credit infrastructure showing early cracks. Loan markets weakening, financial stress emerging.",
            "confidence": confidence,
            "drivers": drivers,
            "weights": weights,
        }

    # ── Regime A: Expansion ────────────────────────────────────────────────
    stress_signal = max(cs / 10, lv / 13, fs / 10, ls / 10, fn / 12, sh / 12)
    confidence = min(99, round((1 - stress_signal) * 100))
    drivers = ["Credit Spreads contained", "No liquidity stress", "Financial sector stable"]
    if cs <= 2:  drivers[0] = f"Credit Spreads normal ({cs}/10)"
    if lv <= 4:  drivers.insert(1, f"Leveraged Loans stable ({lv}/13)")
    return {
        "regime": "Expansion",
        "color": "#22c55e",
        "desc": "Normal risk-on market conditions. Credit stable, liquidity abundant.",
        "confidence": confidence,
        "drivers": drivers[:3],
        "weights": {"equity": 1.2, "breadth": 1.2, "credit": 0.8, "lev_loan": 0.8, "credit_spread": 0.8, "financial_stress": 0.8, "liquidity_shock": 0.8},
    }



# ══════════════════════════════════════════════════════════════════
# Phase 2: Regime Stability + Scenario Classifier + Risk Contribution
# ══════════════════════════════════════════════════════════════════

def compute_regime_stability(total_risk: dict, history: list) -> dict:
    """
    Regime Stability: how long we've been in the current regime + distance to boundary.
    Uses MSS level from 90-day history as regime proxy.
    """
    current_state  = total_risk.get("state", "Normal")
    regime_info    = total_risk.get("regime", {})
    current_regime = regime_info.get("regime", "Expansion")
    total_score    = total_risk.get("total", 0)

    # Map 12-layer state → abstract regime (for history comparison)
    STATE_TO_REGIME = {
        "Normal":    "Expansion",
        "Caution":   "Expansion",
        "Warning":   "Early Stress",
        "High Risk": "Credit Stress",
        "Crisis":    "Liquidity Crisis",
    }
    current_proxy = STATE_TO_REGIME.get(current_state, "Expansion")

    # Count consecutive days (from most recent backwards)
    days_in_regime = 1
    if history:
        for snap in reversed(history[:-1]):  # skip last = current day
            snap_state  = snap.get("level_label", snap.get("state", "Normal"))
            # level_label uses L0-L4 labels — map via level number
            snap_level  = snap.get("level", 0)
            if   snap_level <= 1: snap_proxy = "Expansion"
            elif snap_level == 2: snap_proxy = "Early Stress"
            elif snap_level == 3: snap_proxy = "Credit Stress"
            else:                 snap_proxy = "Liquidity Crisis"
            if snap_proxy == current_proxy:
                days_in_regime += 1
            else:
                break

    # Distance to nearest state boundary (12-layer total score 0-120)
    BOUNDARIES = [29, 49, 69, 89, 120]
    distance_to_boundary = 5
    for i, b in enumerate(BOUNDARIES):
        if total_score <= b:
            lower  = BOUNDARIES[i - 1] if i > 0 else 0
            dist_u = b - total_score
            dist_d = total_score - lower
            distance_to_boundary = int(min(dist_u, dist_d))
            break

    # Stability score 0-100
    days_factor = min(60, days_in_regime) / 60
    dist_factor = min(15, distance_to_boundary) / 15
    stability   = round((days_factor * 0.6 + dist_factor * 0.4) * 100)

    if stability >= 65:
        stability_label = "STABLE"
        stability_color = "#22c55e"
    elif stability >= 35:
        stability_label = "TRANSITIONING"
        stability_color = "#f59e0b"
    else:
        stability_label = "UNSTABLE"
        stability_color = "#ef4444"

    return {
        "regime":               current_regime,
        "regime_color":         regime_info.get("color", "#22c55e"),
        "regime_desc":          regime_info.get("desc", ""),
        "regime_confidence":    regime_info.get("confidence", 0),
        "regime_drivers":       regime_info.get("drivers", []),
        "days_in_regime":       days_in_regime,
        "distance_to_boundary": distance_to_boundary,
        "stability_score":      stability,
        "stability_label":      stability_label,
        "stability_color":      stability_color,
    }


def classify_risk_scenario(
    track_a: dict,
    track_c: dict,
    total_risk: dict,
    breadth_metrics: dict,
    mss_score: float,
    spy_series: "pd.Series | None" = None,
    iwm_df: "pd.DataFrame | None" = None,
) -> dict:
    """
    4-Scenario Risk Classifier:
      D: Risk-On         — all clear, MSS high, broad market healthy
      A: Sector Stress   — equity/breadth weak, credit OK
      B: Systemic        — credit stress + equity decline
      C: Geopolitical    — Track C fires, credit OK (hedge-not-sell)
    Priority: B > C > A > D
    Scenario Confidence = aligned_signals / total_signals * 100
    """
    credit_stressed = track_a.get("state", "Normal") in (
        "Stealth Stress", "Credit Watch", "Credit Alert"
    )
    event_firing = track_c.get("state", "Normal") in ("Shock Watch", "Shock Confirmed")

    pct_ma200 = breadth_metrics.get("pct_above_ma200")
    breadth_ok     = pct_ma200 is None or pct_ma200 >= 55
    breadth_narrow = pct_ma200 is not None and pct_ma200 < 45

    layers      = total_risk.get("layers", {})
    cr_score    = layers.get("credit", {}).get("score", 0)
    cr_max      = layers.get("credit", {}).get("max", 12) or 12
    cs_score    = layers.get("credit_spread", {}).get("score", 0)
    cs_max      = layers.get("credit_spread", {}).get("max", 10) or 10
    credit_ratio = (cr_score / cr_max + cs_score / cs_max) / 2
    credit_ok    = credit_ratio < 0.40

    mss_healthy  = mss_score >= 100
    mss_weak     = mss_score < 100

    # IWM underperformance (small-cap breadth signal)
    iwm_weak = False
    if iwm_df is not None and not iwm_df.empty and spy_series is not None and len(spy_series) >= 21:
        try:
            iwm_s = iwm_df.iloc[:, 0]
            if len(iwm_s) >= 21:
                iwm_ret = float(iwm_s.iloc[-1] / iwm_s.iloc[-21] - 1)
                spy_ret = float(spy_series.iloc[-1] / spy_series.iloc[-21] - 1)
                iwm_weak = (iwm_ret - spy_ret) < -0.04  # IWM lags SPY by >4% over 21d
        except Exception:
            pass

    # ── Scenario B: Systemic ─────────────────────────────────────────
    if credit_stressed or credit_ratio >= 0.50:
        signals = [credit_stressed, credit_ratio >= 0.50, mss_weak, not breadth_ok, iwm_weak]
        confidence = round(sum(signals) / len(signals) * 100)
        return {
            "scenario":   "B",
            "label":      "Systemic Stress",
            "color":      "#ef4444",
            "fill":       "rgba(239,68,68,0.10)",
            "desc":       "신용 선행 악화 + 주식 하락. 구조적 베어마켓 또는 금융위기 초기 단계.",
            "action_hint":"레버리지 즉시 축소. 현금 비중 확대.",
            "confidence": confidence,
        }

    # ── Scenario C: Geopolitical / Event ────────────────────────────
    if event_firing and credit_ok:
        signals = [event_firing, credit_ok, track_c.get("score", 0) >= 2]
        confidence = round(sum(signals) / len(signals) * 100)
        return {
            "scenario":   "C",
            "label":      "Geopolitical / Event",
            "color":      "#06b6d4",
            "fill":       "rgba(6,182,212,0.10)",
            "desc":       "외생 충격 감지 — 신용시장 안정. 과도한 투매 금지. 충격 지속 모니터링.",
            "action_hint":"섹터 헤지 권고. 신용 안정 시 포지션 유지.",
            "confidence": confidence,
        }

    # ── Scenario A: Sector / Rotation Stress ────────────────────────
    if mss_weak and (breadth_narrow or iwm_weak) and credit_ok:
        signals = [mss_weak, breadth_narrow, iwm_weak, credit_ok]
        confidence = round(sum(signals) / len(signals) * 100)
        return {
            "scenario":   "A",
            "label":      "Sector / Rotation Stress",
            "color":      "#f59e0b",
            "fill":       "rgba(245,158,11,0.10)",
            "desc":       "특정 섹터 또는 스타일 악화. 지수 하락, 브레드스 좁음. 신용 안정 — 구조적 하락 아님.",
            "action_hint":"방어 섹터 비중 확대. 소형주/레버리지 노출 축소.",
            "confidence": confidence,
        }

    # ── Scenario D: Risk-On / Expansion ─────────────────────────────
    signals = [mss_healthy, breadth_ok, credit_ok, not event_firing, not credit_stressed]
    confidence = round(sum(signals) / len(signals) * 100)
    return {
        "scenario":   "D",
        "label":      "Risk-On / Expansion",
        "color":      "#22c55e",
        "fill":       "rgba(34,197,94,0.10)",
        "desc":       "모든 지표 안정. 시장 구조 건강. 공격적 포지션 유효.",
        "action_hint":"표준 노출 유지. 모멘텀 전략 계속.",
        "confidence": confidence,
    }


def compute_risk_contribution(total_risk: dict) -> list:
    """
    Risk Contribution Distribution: each layer's % of total risk score.
    Returns list sorted by contribution descending.
    """
    layers = total_risk.get("layers", {})
    raw_total = sum(l.get("score", 0) for l in layers.values())
    denom = max(1, raw_total)

    LAYER_META = [
        ("equity",           "L1 Equity"),
        ("breadth",          "L2 Breadth"),
        ("credit",           "L3 Credit"),
        ("lev_loan",         "L4 Lev Loan"),
        ("liquidity",        "L5 Liquidity"),
        ("funding",          "L6 Funding"),
        ("macro",            "L7 Macro"),
        ("shock",            "L8 Shock"),
        ("cross_asset",      "L9 Cross-Asset"),
        ("credit_spread",    "L10 Credit Spread"),
        ("liquidity_shock",  "L11 Liquidity Shock"),
        ("financial_stress", "L12 Fin Stress"),
    ]

    result = []
    for key, label in LAYER_META:
        lyr   = layers.get(key, {})
        score = lyr.get("score", 0)
        mx    = lyr.get("max", 1) or 1
        ratio = round(score / mx, 3)
        pct   = round(score / denom * 100, 1)
        result.append({
            "key":              key,
            "label":            label,
            "score":            score,
            "max":              mx,
            "ratio":            ratio,
            "contribution_pct": pct,
        })

    result.sort(key=lambda x: x["score"], reverse=True)
    return result


def compute_event_similarity(
    current_level: int,
    current_mss: float,
    current_regime: str,
    events: list,
    mss_history_full: list,
    exclude_start: str | None = None,
) -> list:
    """
    Event Similarity Engine: find top-3 historical events whose ENTRY conditions
    (MSS score at event start date) most resemble the current market state.

    Returns list of dicts with event info + similarity_pct (100 = exact MSS match).
    """
    from datetime import date as _date, timedelta as _td

    # Build MSS lookup: date-string → score
    mss_lookup: dict[str, float] = {pt["d"]: float(pt["s"]) for pt in mss_history_full}

    def _start_mss(start_str: str) -> float | None:
        """Look up MSS on start_str or ±3 trading day neighbourhood."""
        if start_str in mss_lookup:
            return mss_lookup[start_str]
        try:
            d0 = _date.fromisoformat(start_str)
        except Exception:
            return None
        for delta in [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]:
            key = (d0 + _td(days=delta)).isoformat()
            if key in mss_lookup:
                return mss_lookup[key]
        return None

    scored: list[tuple[float, dict]] = []
    for ev in events:
        start = ev.get("start")
        if not start:
            continue
        # Exclude current/ongoing event
        if exclude_start and start == exclude_start:
            continue
        smss = _start_mss(start)
        if smss is None:
            continue

        mss_diff = abs(current_mss - smss)
        # Regime match bonus (reduce distance if same regime)
        regime_bonus = -3.0 if ev.get("regime_at_peak") == current_regime else 0.0
        # Level match bonus
        level_bonus = -2.0 if ev.get("peak_level", 4) <= current_level + 1 else 0.0

        dist = mss_diff + regime_bonus + level_bonus
        scored.append((dist, {
            "name":            ev["name"],
            "start":           start,
            "start_mss":       round(smss, 1),
            "peak_level":      ev.get("peak_level"),
            "peak_mss":        ev.get("peak_mss"),
            "shock_category":  ev.get("shock_category", "unknown"),
            "regime_at_peak":  ev.get("regime_at_peak", "?"),
            "qqq_drawdown_pct": ev.get("qqq_drawdown_pct"),
            "duration_days":   ev.get("duration_days"),
            "fwd_ret_1m":      ev.get("fwd_ret_1m"),
            "fwd_ret_3m":      ev.get("fwd_ret_3m"),
            "similarity_pct":  max(0, round(100 - mss_diff * 4)),
        }))

    scored.sort(key=lambda x: x[0])

    # Deduplicate by decade (avoid listing multiple events from same crisis)
    result: list[dict] = []
    seen_decades: set[str] = set()
    for _, item in scored:
        decade = item["start"][:4][:-1] + "0s"   # e.g. "2020" → "2020s", "2012" → "2010s"
        if decade in seen_decades and len(result) >= 2:
            continue
        seen_decades.add(decade)
        result.append(item)
        if len(result) >= 3:
            break

    return result


def compute_global_transmission(
    total_risk: dict,
    track_a: dict,
    track_c: dict,
    track_b: dict | None = None,
) -> dict:
    """
    Global Risk Transmission Map (Phase 4 Capstone).

    Aggregates 12 systemic layers into 5 macro-financial nodes
    (Equity, Credit, Liquidity, Macro, Funding) and computes
    directed transmission paths between them.

    Nodes represent risk "reservoirs"; edges show if stress is actively
    spilling from one node to another.
    """
    layers = total_risk.get("layers", {})

    def _stress(keys: list[str]) -> float:
        """Average stress utilisation (score/max) across given layer keys."""
        vals = []
        for k in keys:
            lyr = layers.get(k, {})
            mx = lyr.get("max", 0)
            sc = lyr.get("score", 0)
            if mx > 0:
                vals.append(sc / mx)
        return round(sum(vals) / len(vals), 3) if vals else 0.0

    def _node_color(s: float) -> str:
        if s >= 0.65: return "#ef4444"
        if s >= 0.48: return "#f97316"
        if s >= 0.32: return "#f59e0b"
        if s >= 0.18: return "#84cc16"
        return "#22c55e"

    def _node_status(s: float) -> str:
        if s >= 0.65: return "위기"
        if s >= 0.48: return "고위험"
        if s >= 0.32: return "경계"
        if s >= 0.18: return "주시"
        return "안정"

    # ── Node stress ────────────────────────────────────────────────────────
    eq_s  = _stress(["equity", "breadth", "shock"])
    cr_s  = _stress(["credit", "lev_loan", "credit_spread"])
    lq_s  = _stress(["liquidity", "liquidity_shock"])
    ma_s  = _stress(["macro", "cross_asset"])
    fn_s  = _stress(["funding", "financial_stress"])

    # Track A: credit alert → amplify credit node
    if track_a.get("state") in ("Stealth Stress", "Credit Watch", "Credit Alert"):
        cr_s = min(1.0, cr_s * 1.20)

    # Track C: external shock → amplify equity + liquidity
    tc_fired = track_c.get("state") in ("Shock Watch", "Shock Confirmed")
    if tc_fired:
        eq_s = min(1.0, eq_s * 1.15)
        lq_s = min(1.0, lq_s * 1.15)

    # Track B: velocity alert → amplify equity
    if track_b and track_b.get("velocity_alert"):
        eq_s = min(1.0, eq_s * 1.10)

    nodes = {
        "equity":    {"label": "Equity Market", "label_ko": "주식시장",   "stress": round(eq_s, 3), "color": _node_color(eq_s), "status": _node_status(eq_s)},
        "credit":    {"label": "Credit",         "label_ko": "신용시장",   "stress": round(cr_s, 3), "color": _node_color(cr_s), "status": _node_status(cr_s)},
        "liquidity": {"label": "Liquidity",      "label_ko": "유동성",     "stress": round(lq_s, 3), "color": _node_color(lq_s), "status": _node_status(lq_s)},
        "macro":     {"label": "Macro/Global",   "label_ko": "매크로",     "stress": round(ma_s, 3), "color": _node_color(ma_s), "status": _node_status(ma_s)},
        "funding":   {"label": "Funding/Banks",  "label_ko": "펀딩·은행", "stress": round(fn_s, 3), "color": _node_color(fn_s), "status": _node_status(fn_s)},
    }

    # ── Edge definitions ────────────────────────────────────────────────────
    def _edge(src: str, dst: str, src_thr: float, dst_thr: float,
              label: str, label_ko: str) -> dict:
        ss = nodes[src]["stress"]
        ds = nodes[dst]["stress"]
        active = ss >= src_thr and ds >= dst_thr
        strength = round((ss * 0.6 + ds * 0.4), 3) if active else 0.0
        return {
            "from": src, "to": dst,
            "active": active, "strength": strength,
            "label": label, "label_ko": label_ko,
        }

    edges = [
        _edge("macro",  "equity",    0.28, 0.18, "Market Deterioration",    "시장 악화"),
        _edge("macro",  "credit",    0.30, 0.30, "Spread Widening",          "스프레드 확대"),
        _edge("macro",  "liquidity", 0.28, 0.18, "Liquidity Withdrawal",     "유동성 회수"),
        _edge("equity", "credit",    0.38, 0.38, "Risk-Off Contagion",       "위험회피 전염"),
        _edge("credit", "funding",   0.38, 0.30, "Credit-Funding Feedback",  "신용→펀딩 전이"),
        _edge("liquidity", "funding",0.35, 0.30, "Liquidity Freeze",         "유동성 동결"),
        _edge("credit", "liquidity", 0.45, 0.38, "Tightening Feedback",      "긴축 피드백"),
    ]

    # Track C external shock (enters equity and liquidity from outside)
    tc_strength = round(track_c.get("score", 0) / max(track_c.get("max_score", 4), 1), 3)
    tc_edge = {
        "from": "external",
        "to": "equity",
        "active": tc_fired,
        "strength": tc_strength,
        "label": "External Shock",
        "label_ko": track_c.get("shock_type", "External") or "External",
    }

    active_edges = [e for e in edges if e["active"]]
    if tc_fired:
        active_edges.append(tc_edge)

    active_paths = [
        f"{e['from'].capitalize()} → {e['to'].capitalize()} ({e['label_ko']})"
        for e in active_edges
    ]

    n_active = len(active_edges)
    if n_active >= 5:
        t_state = "Critical";   t_color = "#ef4444"
    elif n_active >= 3:
        t_state = "Active";     t_color = "#f97316"
    elif n_active >= 1:
        t_state = "Emerging";   t_color = "#f59e0b"
    else:
        t_state = "Contained";  t_color = "#22c55e"

    return {
        "nodes":               nodes,
        "edges":               edges,
        "tc_edge":             tc_edge,
        "active_paths":        active_paths,
        "transmission_state":  t_state,
        "transmission_color":  t_color,
        "n_active_edges":      n_active,
    }

def build_total_risk(l1: dict, l2: dict, l3: dict, l4: dict, l5: dict, l6: dict, l7: dict, l8: dict, l9: dict, l10: dict, l11: dict, l12: dict) -> dict:
    """Combine 12 systemic layers into Total Risk Score (0-120)."""
    total = sum(l["score"] for l in [l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12])
    total = min(120, max(0, total))

    # Cross-layer escalation: Credit -> Loans -> Spreads -> Financials
    def _ratio(l: dict) -> float:
        return l["score"] / l["max"] if l["max"] > 0 else 0

    escalation_flag = False
    escalation_bonus = 0
    if _ratio(l3) > 0.6 and _ratio(l4) > 0.6 and _ratio(l10) > 0.6 and _ratio(l12) > 0.6:
        escalation_flag = True
        escalation_bonus = 3
        total = min(120, total + escalation_bonus)

    # MPS: Macro Pressure Score (credit/liquidity/macro layers normalized 0-100)
    macro_layers = [l3, l4, l5, l6, l7, l10, l12]
    mps_raw = sum(l["score"] for l in macro_layers)
    mps_max = sum(l["max"]   for l in macro_layers)  # 12+13+13+12+13+10+10 = 83
    mps = round(mps_raw / mps_max * 100) if mps_max > 0 else 0

    if total <= 29:
        state = "Normal"
        state_color = "#22c55e"
        action = "NORMAL -- Maintain standard positioning. All systemic layers benign."
    elif total <= 49:
        state = "Caution"
        state_color = "#84cc16"
        action = "CAUTION -- Monitor signals. Watch for leveraged loan / credit spread escalation."
    elif total <= 69:
        state = "Warning"
        state_color = "#f59e0b"
        action = "WARNING -- Reduce leveraged exposure. Credit and cross-asset stress spreading."
    elif total <= 89:
        state = "High Risk"
        state_color = "#f97316"
        action = "HIGH RISK -- Capital preservation mode. Multi-layer systemic stress confirmed."
    else:
        state = "Crisis"
        state_color = "#ef4444"
        action = "CRISIS -- Full defensive mode. 2008/2020-type systemic event signals active across all layers."

    layers = [l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12]
    dominant = max(layers, key=lambda l: l["score"] / l["max"] if l["max"] > 0 else 0)

    all_layers = {
        "equity":       dict(l1),
        "breadth":      dict(l2),
        "credit":       dict(l3),
        "lev_loan":     dict(l4),
        "liquidity":    dict(l5),
        "funding":      dict(l6),
        "macro":        dict(l7),
        "shock":        dict(l8),
        "cross_asset":  dict(l9),
        "credit_spread": dict(l10),
        "liquidity_shock": dict(l11),
        "financial_stress": dict(l12),
    }
    if escalation_flag:
        action = f"{action} Credit stress is spreading into financials."
    crisis = _crisis_stage(all_layers)

    regime = _build_regime(all_layers)
    return {
        "total": total,
        "mps": mps,
        "regime": regime,
        "state": state,
        "state_color": state_color,
        "action": action,
        "dominant_layer": dominant["label"],
        "escalation": {"active": escalation_flag, "bonus": escalation_bonus, "label": "Credit-to-Financial Transmission"} if escalation_flag else {"active": False},
        "crisis_stage": crisis,
        "layers": all_layers,
    }


def main() -> None:
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"DB not found: {DB_PATH}")

    con = sqlite3.connect(DB_PATH)
    qqq = load_symbol(con, "QQQ")
    tqqq = load_symbol(con, "TQQQ")
    con.close()

    if qqq.empty:
        raise RuntimeError("QQQ data not found in ticker_history_daily")

    df = _finalize_date_frame(qqq.copy())
    if not tqqq.empty:
        df = df.join(_finalize_date_frame(tqqq), how="left")
    df = _finalize_date_frame(df)

    df["ma50"] = df["qqq"].rolling(50, min_periods=20).mean()
    df["ma200"] = df["qqq"].rolling(200, min_periods=60).mean()

    df["ret"] = df["qqq"].pct_change()
    df["vol20"] = df["ret"].rolling(20, min_periods=10).std() * np.sqrt(252)
    df["vol_pct"] = rolling_percentile(df["vol20"], 252).fillna(0.0)

    df["roll_max"] = df["qqq"].rolling(252, min_periods=60).max()
    df["dd_pct"] = (df["qqq"] / df["roll_max"] - 1) * 100.0
    df["dd_pct"] = df["dd_pct"].fillna(0.0)

    df["days_below_ma200"] = calc_days_below(df["qqq"], df["ma200"])

    # ── Market Structure Score (MSS) ─────────────────────────────────────────
    # MSS = 100 + TrendAdj + DepthAdj + VolAdj + DDAdj
    # Higher = healthier market (100 = neutral baseline)

    ma200_valid = df["ma200"].notna()
    ma50_valid  = df["ma50"].notna()
    qqq_above_ma200 = df["qqq"] > df["ma200"]
    qqq_above_ma50  = df["qqq"] > df["ma50"]
    ma50_above_ma200 = df["ma50"] > df["ma200"]

    distance200 = np.where(
        ma200_valid,
        (df["qqq"].values - df["ma200"].values) / df["ma200"].values,
        0.0,
    )
    near_ma200 = ma200_valid & (np.abs(distance200) <= 0.01)

    # TrendAdj: relationship between QQQ / MA50 / MA200
    trend_adj = np.select(
        [
            ~(ma200_valid & ma50_valid),                              # MA not ready: neutral
            near_ma200,                                               # ±1% of MA200: neutral
            qqq_above_ma200 & qqq_above_ma50 & ma50_above_ma200,    # Strong Bull
            qqq_above_ma200,                                          # QQQ>MA200, not full bull
            ~qqq_above_ma200 & ma50_above_ma200,                     # Early Bear
        ],
        [0.0, 0.0, 8.0, 4.0, -6.0],
        default=-12.0,   # QQQ<MA200, MA50<MA200 → Full Bear
    )

    # DepthAdj: (QQQ - MA200) / MA200 distance
    depth_adj = np.select(
        [
            ~ma200_valid,
            distance200 > 0.10,    # >+10%: very extended above
            distance200 > 0.05,    # +5-10%
            distance200 >= 0.0,    # 0-+5%
            distance200 >= -0.03,  # -3% to 0%
            distance200 >= -0.07,  # -7% to -3%
        ],
        [0.0, 8.0, 5.0, 2.0, -3.0, -7.0],
        default=-12.0,   # < -7%
    )

    # VolAdj: 20-day realized vol percentile vs 1-year history
    vol_pct_v = df["vol_pct"].values
    vol_adj = np.select(
        [
            vol_pct_v < 30,    # Low vol:     +2
            vol_pct_v < 60,    # Normal:       0
            vol_pct_v < 75,    # Elevated:    -4
            vol_pct_v < 90,    # High:        -8
        ],
        [2.0, 0.0, -4.0, -8.0],
        default=-12.0,   # Extreme vol
    )

    # DDAdj: rolling 252-day peak-to-trough drawdown
    dd_v = df["dd_pct"].values
    dd_adj = np.select(
        [
            dd_v > -5.0,    # Minimal:      0
            dd_v > -10.0,   # Moderate:    -4
            dd_v > -15.0,   # Significant: -8
            dd_v > -20.0,   # Severe:     -12
        ],
        [0.0, -4.0, -8.0, -12.0],
        default=-16.0,   # Extreme (>-20%)
    )

    df["comp_trend"] = trend_adj
    df["comp_depth"] = depth_adj
    df["comp_vol"]   = vol_adj
    df["comp_dd"]    = dd_adj
    df["score"] = (100.0 + trend_adj + depth_adj + vol_adj + dd_adj).round(1)
    df["level"] = df["score"].apply(mss_to_level)
    df["event_type"] = detect_event_type(df)

    # Current
    latest = df.iloc[-1]
    lvl = int(latest["level"])
    tier = next((t for t in LEVEL_TIERS if t["level"] == lvl), LEVEL_TIERS[0])
    ret5 = float(df["qqq"].pct_change(5).iloc[-1]) if len(df) >= 6 else 0.0
    shock_p = round(min(100.0, max(0.0, (-ret5 / 0.08) * 100.0))) if ret5 < 0 else 0.0
    struct_p = round(min(100.0, max(0.0, (latest["days_below_ma200"] / 200.0) * 100.0))) if latest["qqq"] < latest["ma200"] else 0.0
    grind_p = round(min(100.0, max(0.0, (abs(latest["dd_pct"]) / 15.0) * 100.0))) if latest["days_below_ma200"] > 60 else 0.0

    current = {
        "date": latest.name.strftime("%Y-%m-%d"),
        "score": round(float(latest["score"]), 1),
        "score_name": "Market Structure Score (MSS)",
        "score_zone": mss_zone(float(latest["score"])),
        "level": lvl,
        "level_label": tier["label"],
        "event_type": str(latest["event_type"]),
        "exposure_pct": tier["exposure"],
        "price": round(float(latest["qqq"]), 2),
        "ma50": pct(latest["ma50"], 4),
        "ma200": pct(latest["ma200"], 4),
        "dd_pct": float(latest["dd_pct"]),
        "vol_pct": float(latest["vol_pct"]),
        "days_below_ma200": int(latest["days_below_ma200"]),
        "shock_p": float(shock_p),
        "struct_p": float(struct_p),
        "grind_p": float(grind_p),
        "components": {
            "trend": float(latest["comp_trend"]),
            "depth": float(latest["comp_depth"]),
            "vol": float(latest["comp_vol"]),
            "dd": float(latest["comp_dd"]),
        },
    }

    # History: last 90 trading days
    history_rows = df.tail(90)
    history = []
    for dt, row in history_rows.iterrows():
        history.append({
            "date": dt.strftime("%Y-%m-%d"),
            "score": pct(row["score"], 1),
            "score_zone": mss_zone(float(row["score"])) if pd.notna(row["score"]) else "Neutral",
            "level": int(row["level"]),
            "vol_pct": pct(row["vol_pct"], 2),
            "dd_pct": pct(row["dd_pct"], 4),
            "event_type": str(row["event_type"]),
        })

    # Full MSS history for long-term chart overlay (compact: short keys to minimize file size)
    mss_history_full = [
        {"d": dt.strftime("%Y-%m-%d"), "s": round(float(row["score"]), 1)}
        for dt, row in df.iterrows()
        if pd.notna(row["score"])
    ]

    # Events (level >= 2)
    trigger_mask = df["level"] >= 2
    events_raw: list[tuple[pd.Timestamp, pd.Timestamp]] = []
    in_event = False
    ev_start: pd.Timestamp | None = None
    for dt, triggered in trigger_mask.items():
        if triggered and not in_event:
            in_event = True
            ev_start = dt
        elif not triggered and in_event:
            loc = df.index.get_loc(dt)
            if isinstance(loc, slice):
                prev_idx = loc.start - 1
            elif isinstance(loc, np.ndarray):
                prev_idx = loc[0] - 1 if len(loc) else -1
            else:
                prev_idx = loc - 1
            prev_dt = df.index[prev_idx] if prev_idx >= 0 else dt
            events_raw.append((ev_start, prev_dt))  # type: ignore[arg-type]
            in_event = False
    if in_event and ev_start is not None:
        events_raw.append((ev_start, df.index[-1]))

    MERGE_DAYS = 60
    events_merged: list[tuple[pd.Timestamp, pd.Timestamp]] = []
    for start, end in events_raw:
        if events_merged and (start - events_merged[-1][1]).days <= MERGE_DAYS:
            events_merged[-1] = (events_merged[-1][0], end)
        else:
            events_merged.append((start, end))

    # Manual end-date overrides for events where the algorithmic end is too early
    EVENT_END_OVERRIDES: dict[str, pd.Timestamp] = {
        '2024-07': pd.Timestamp('2024-10-25'),
        '2025-01': pd.Timestamp('2025-09-20'),
    }
    events_merged = [
        (start, max(end, EVENT_END_OVERRIDES[start.strftime('%Y-%m')])
         if start.strftime('%Y-%m') in EVENT_END_OVERRIDES else end)
        for start, end in events_merged
    ]

    KNOWN_NAMES = {
        (2000, 5): "2000-05 Risk Event",
        (2008, 1): "2008-01 Risk Event",
        (2020, 3): "COVID-19 Crash",
        (2022, 1): "2022-01 Risk Event",
        (2025, 3): "Market Stress 2025",
    }

    all_dates = df.index.tolist()
    events: list[dict] = []
    playback_events: list[dict] = []
    sim_events: list[dict] = []

    for i, (start, end) in enumerate(events_merged, 1):
        start = max(start, df.index[0])
        end = min(end, df.index[-1])
        ev_df = df.loc[start:end]
        if ev_df.empty:
            continue

        peak_score = float(ev_df["score"].max())
        peak_level = int(ev_df["level"].max())
        peak_date = ev_df["score"].idxmax()
        ev_type = str(df.loc[peak_date, "event_type"]) if peak_date in df.index else "Normal"

        qqq_start = scalar_at(df.loc[start, "qqq"])
        qqq_trough = float(ev_df["qqq"].min())
        qqq_drawdown = (qqq_trough - qqq_start) / qqq_start * 100.0

        tqqq_drawdown = None
        if "tqqq" in df.columns and df["tqqq"].notna().any():
            tqqq_ev = ev_df["tqqq"].dropna()
            if not tqqq_ev.empty:
                tqqq_start = float(tqqq_ev.iloc[0])
                tqqq_trough = float(tqqq_ev.min())
                tqqq_drawdown = (tqqq_trough - tqqq_start) / tqqq_start * 100.0

        start_idx = all_dates.index(start)
        end_idx = int(df.index.get_indexer([end], method="ffill")[0])
        if end_idx < 0:
            raise ValueError(f"End date {end.strftime('%Y-%m-%d')} is before available data")

        def fwd_ret(offset: int) -> float | None:
            idx = start_idx + offset
            if idx >= len(df):
                return None
            return round((float(df["qqq"].iloc[idx]) - qqq_start) / qqq_start * 100.0, 2)

        name = KNOWN_NAMES.get((start.year, start.month), f"{start.strftime('%Y-%m')} Risk Event")
        duration_days = len(ev_df)
        shock_category = classify_shock_category(qqq_drawdown, duration_days)
        regime_at_peak = (
            "Expansion" if peak_level <= 1 else
            "Early Stress" if peak_level == 2 else
            "Financial Stress" if peak_level == 3 else
            "Liquidity Crisis"
        )
        expl = (
            f"Risk Level {peak_level} ({level_label(peak_level)}) "
            f"with {abs(qqq_drawdown):.1f}% QQQ drawdown over {duration_days} days."
        )

        # Playback window
        pre_idx = max(0, start_idx - 350)  # 350d pre-window: MA250 valid from event start
        post_idx = min(len(all_dates) - 1, end_idx + 60)
        win_df = df.iloc[pre_idx : post_idx + 1].copy()

        qqq_base = scalar_at(df.loc[start, "qqq"])
        tqqq_base = None
        if "tqqq" in df.columns and not pd.isna(scalar_at(df.loc[start, "tqqq"])):
            tqqq_base = scalar_at(df.loc[start, "tqqq"])

        rolling_peak = -np.inf
        rolling_peak_t = -np.inf
        playback = []
        sim = []
        qqq_start_win = float(win_df["qqq"].iloc[0])
        tqqq_start_win = float(win_df["tqqq"].iloc[0]) if "tqqq" in win_df.columns and not pd.isna(win_df["tqqq"].iloc[0]) else None

        for dt, row in win_df.iterrows():
            q = float(row["qqq"])
            m5 = row["ma50"]
            m2 = row["ma200"]
            t = float(row["tqqq"]) if "tqqq" in row and not pd.isna(row["tqqq"]) else None

            rolling_peak = max(rolling_peak, q)
            dd = (q / rolling_peak - 1) * 100.0 if rolling_peak > 0 else 0.0

            if t is not None:
                rolling_peak_t = max(rolling_peak_t, t)
                tdd = (t / rolling_peak_t - 1) * 100.0 if rolling_peak_t > 0 else 0.0
            else:
                tdd = None

            playback.append({
                "d": dt.strftime("%Y-%m-%d"),
                "qqq_n": round(q / qqq_base * 100.0, 2),
                "ma50_n": round(m5 / qqq_base * 100.0, 2) if pd.notna(m5) else None,
                "ma200_n": round(m2 / qqq_base * 100.0, 2) if pd.notna(m2) else None,
                "tqqq_n": round(t / tqqq_base * 100.0, 2) if (t is not None and tqqq_base) else None,
                "dd": round(dd, 2),
                "tqqq_dd": round(tdd, 2) if tdd is not None else None,
                "score": pct(row["score"], 1),
                "level": int(row["level"]),
                "in_ev": bool(start <= dt <= end),
                "ev_type": str(row["event_type"]),
            })

            bh_val = 10000.0 * (q / qqq_start_win) if qqq_start_win > 0 else 10000.0
            if t is not None and tqqq_start_win:
                tqqq_val = 10000.0 * (t / tqqq_start_win)
            else:
                tqqq_val = None
            sim.append({
                "d": dt.strftime("%Y-%m-%d"),
                "bh": round(bh_val),
                "tqqq": round(tqqq_val) if tqqq_val is not None else None,
                "lv": int(row["level"]),
                "in_ev": bool(start <= dt <= end),
            })

        risk_off_date = None
        after = df.loc[df.index > end]
        if not after.empty:
            off_rows = after[after["level"] <= 0]
            if not off_rows.empty:
                risk_off_date = off_rows.index[0].strftime("%Y-%m-%d")

        events.append({
            "id": i,
            "name": name,
            "start": start.strftime("%Y-%m-%d"),
            "end": end.strftime("%Y-%m-%d"),
            "peak_score": round(peak_score, 1),
            "peak_level": peak_level,
            "event_type": ev_type,
            "duration_days": duration_days,
            "level_label": level_label(peak_level),
            "explanation": expl,
            "shock_category": shock_category,
            "peak_mss": round(peak_score, 1),
            "regime_at_peak": regime_at_peak,
            "qqq_drawdown_pct": round(qqq_drawdown, 2),
            "tqqq_drawdown_pct": round(tqqq_drawdown, 2) if tqqq_drawdown is not None else None,
            "fwd_ret_1m": fwd_ret(21),
            "fwd_ret_3m": fwd_ret(63),
            "fwd_ret_6m": fwd_ret(126),
        })

        playback_events.append({
            "id": i,
            "name": name,
            "start": start.strftime("%Y-%m-%d"),
            "end": end.strftime("%Y-%m-%d"),
            "event_type": ev_type,
            "explanation": expl,
            "risk_on_date": start.strftime("%Y-%m-%d"),
            "risk_off_date": risk_off_date,
            "playback": playback,
        })

        sim_events.append({
            "id": i,
            "name": name,
            "start": start.strftime("%Y-%m-%d"),
            "sim": sim,
        })

    # Backtest (TQQQ)
    df_bt = df.dropna(subset=["tqqq"]).copy()
    if df_bt.empty:
        print("[risk_v1] TQQQ data not found for backtest; writing fallback scaffold.")
        backtest = {
            "start_date": current["date"],
            "end_date": current["date"],
            "years": 0.0,
            "sell_rule": "Sell TQQQ when Level >= 2 (MSS < 100, Warning zone)",
            "buy_rule": "Buy TQQQ when Level <= 0 (MSS >= 110, Normal zone)",
            "bh": {
                "total_return": 0.0,
                "ann_return": 0.0,
                "max_drawdown": 0.0,
                "calmar": None,
            },
            "strategy": {
                "total_return": 0.0,
                "ann_return": 0.0,
                "max_drawdown": 0.0,
                "calmar": None,
            },
            "days_in_cash": 0,
            "days_total": 0,
            "cash_pct": 0.0,
        }
        backtest_curve = []
    else:
        sell_level = 2
        buy_level = 0

        in_mkt = []
        pos = True
        for lvl in df_bt["level"].values:
            if pos and lvl >= sell_level:
                pos = False
            elif not pos and lvl <= buy_level:
                pos = True
            in_mkt.append(pos)
        df_bt["in_mkt"] = in_mkt
        df_bt["tqqq_ret"] = df_bt["tqqq"].pct_change().fillna(0.0)
        df_bt["strat_ret"] = np.where(df_bt["in_mkt"], df_bt["tqqq_ret"], 0.0)

        df_bt["bh_cum"] = (1 + df_bt["tqqq_ret"]).cumprod()
        df_bt["strat_cum"] = (1 + df_bt["strat_ret"]).cumprod()

        bh_total = float(df_bt["bh_cum"].iloc[-1])
        strat_total = float(df_bt["strat_cum"].iloc[-1])

        def max_dd(series: pd.Series) -> float:
            roll_max = series.cummax()
            dd = (series / roll_max - 1) * 100.0
            return float(dd.min())

        bh_mdd = max_dd(df_bt["bh_cum"])
        strat_mdd = max_dd(df_bt["strat_cum"])

        n_years = (df_bt.index[-1] - df_bt.index[0]).days / 365.25
        bh_ann = (bh_total ** (1 / n_years) - 1) * 100.0
        strat_ann = (strat_total ** (1 / n_years) - 1) * 100.0
        strat_calmar = (strat_ann / abs(strat_mdd)) if strat_mdd < 0 else None
        bh_calmar = (bh_ann / abs(bh_mdd)) if bh_mdd < 0 else None

        backtest = {
            "start_date": df_bt.index[0].strftime("%Y-%m-%d"),
            "end_date": df_bt.index[-1].strftime("%Y-%m-%d"),
            "years": round(n_years, 1),
            "sell_rule": "Sell TQQQ when Level >= 2 (MSS < 100, Warning zone)",
            "buy_rule": "Buy TQQQ when Level <= 0 (MSS >= 110, Normal zone)",
            "bh": {
                "total_return": round((bh_total - 1) * 100, 2),
                "ann_return": round(bh_ann, 2),
                "max_drawdown": round(bh_mdd, 2),
                "calmar": round(bh_calmar, 2) if bh_calmar is not None else None,
            },
            "strategy": {
                "total_return": round((strat_total - 1) * 100, 2),
                "ann_return": round(strat_ann, 2),
                "max_drawdown": round(strat_mdd, 2),
                "calmar": round(strat_calmar, 2) if strat_calmar is not None else None,
            },
            "days_in_cash": int((~df_bt["in_mkt"]).sum()),
            "days_total": int(len(df_bt)),
            "cash_pct": round((~df_bt["in_mkt"]).sum() / len(df_bt) * 100, 1),
        }

        backtest_curve = []
        for dt, row in df_bt.iterrows():
            backtest_curve.append({
                "date": dt.strftime("%Y-%m-%d"),
                "bh": round(float(row["bh_cum"]) * 100, 2),
                "strat": round(float(row["strat_cum"]) * 100, 2),
                "in_mkt": bool(row["in_mkt"]),
            })

    # ── Signal Analysis ──────────────────────────────────────────────────────
    df_sa = _finalize_date_frame(df[["qqq", "score", "level"]].dropna(subset=["qqq"]).copy())
    level_s  = df_sa["level"]
    prev_l   = level_s.shift(1).fillna(0)

    # L2+ entry signals: level transitions from <2 to >=2
    entry_mask  = (level_s >= 2) & (prev_l < 2)
    entry_dates = df_sa.index[entry_mask]

    def _fwd_ret(sig_d: pd.Timestamp, cal_days: int) -> float | None:
        sig_d = pd.Timestamp(sig_d)
        pos0 = df_sa.index.searchsorted(sig_d)
        posT = df_sa.index.searchsorted(sig_d + pd.Timedelta(days=cal_days))
        if posT >= len(df_sa):
            return None
        q0 = float(df_sa["qqq"].iloc[pos0])
        qt = float(df_sa["qqq"].iloc[posT])
        return round((qt / q0 - 1) * 100, 2)

    def _max_drop(sig_d: pd.Timestamp) -> float:
        sig_d = pd.Timestamp(sig_d)
        pos0 = df_sa.index.searchsorted(sig_d)
        posE = min(df_sa.index.searchsorted(sig_d + pd.Timedelta(days=65)), len(df_sa))
        q0   = float(df_sa["qqq"].iloc[pos0])
        minq = float(df_sa["qqq"].iloc[pos0:posE].min()) if posE > pos0 else q0
        return round((minq / q0 - 1) * 100, 1)

    signal_rows: list[dict] = []
    for sig_d in entry_dates:
        drop = _max_drop(sig_d)
        result = "✓" if drop < -3.0 else ("△" if drop < 0.0 else "✗")
        signal_rows.append({
            "date":         sig_d.strftime("%Y-%m-%d"),
            "mss":          round(float(df_sa.loc[sig_d, "score"]), 1),
            "ret_30d":      _fwd_ret(sig_d, 30),
            "ret_60d":      _fwd_ret(sig_d, 60),
            "ret_90d":      _fwd_ret(sig_d, 90),
            "max_drop_60d": drop,
            "result":       result,
        })

    n_sig  = len(signal_rows)
    tp_cnt = sum(1 for s in signal_rows if s["result"] == "✓")
    pt_cnt = sum(1 for s in signal_rows if s["result"] == "△")
    fa_cnt = sum(1 for s in signal_rows if s["result"] == "✗")

    # Conditional forward returns by level (21 trading-day proxy = ~30 cal days)
    cond_ret: dict[int, dict] = {}
    for lv in range(5):
        mask   = df_sa["level"] == lv
        q_fwd  = df_sa["qqq"].shift(-21)
        ret21  = ((q_fwd / df_sa["qqq"]) - 1) * 100
        sub    = ret21[mask].dropna().values
        if len(sub) >= 10:
            cond_ret[lv] = {
                "n":        int(len(sub)),
                "mean":     round(float(np.mean(sub)), 2),
                "median":   round(float(np.median(sub)), 2),
                "pos_rate": round(float((sub > 0).mean() * 100), 1),
                "p10":      round(float(np.percentile(sub, 10)), 2),
                "p90":      round(float(np.percentile(sub, 90)), 2),
            }

    # Event detection: first L2+ signal vs event start
    ev_detection: list[dict] = []
    for ev in events:
        start_ts    = pd.Timestamp(ev["start"])
        search_s    = start_ts - pd.Timedelta(days=90)
        search_e    = start_ts + pd.Timedelta(days=30)
        win         = df_sa.loc[search_s:search_e] if search_s <= df_sa.index[-1] else df_sa.iloc[0:0]
        l2_days     = win[win["level"] >= 2]
        first_sig   = l2_days.index[0].strftime("%Y-%m-%d") if not l2_days.empty else None
        lead_days   = int((start_ts - pd.Timestamp(first_sig)).days) if first_sig else None
        ev_detection.append({
            "name":         ev["name"],
            "event_start":  ev["start"],
            "first_signal": first_sig,
            "lead_days":    lead_days,
            "qqq_drawdown": ev["qqq_drawdown_pct"],
            "peak_level":   ev["peak_level"],
        })

    signal_analysis = {
        "signal_count":      n_sig,
        "true_positive":     tp_cnt,
        "partial":           pt_cnt,
        "false_alarm":       fa_cnt,
        "tp_rate":           round(tp_cnt / n_sig * 100, 1) if n_sig else 0,
        "avg_drop_60d":      round(sum(s["max_drop_60d"] for s in signal_rows) / n_sig, 1) if n_sig else 0,
        "signals":           list(reversed(signal_rows[-30:])),  # recent first
        "conditional_returns": {str(k): v for k, v in cond_ret.items()},
        "event_detection":   ev_detection,
    }

    methodology = {
        "score_name": "Market Structure Score (MSS)",
        "score_baseline": 100,
        "score_description": (
            "MSS measures market structural health on a 100-baseline scale. "
            "100 = neutral, above 100 = healthy, below 100 = deteriorating. "
            "Formula: MSS = 100 + TrendAdj + DepthAdj + VolAdj + DDAdj"
        ),
        "score_components": [
            {
                "name": "TrendAdj", "range": "-12 to +8",
                "desc": (
                    "Relationship of QQQ vs MA50 vs MA200. "
                    "+8: QQQ>MA50>MA200 (Strong Bull). "
                    "+4: QQQ>MA200 but <MA50 (Recovery). "
                    "0: QQQ within ±1% of MA200 (Neutral). "
                    "-6: QQQ<MA200, MA50>MA200 (Early Bear). "
                    "-12: QQQ<MA200, MA50<MA200 (Full Bear)."
                ),
            },
            {
                "name": "DepthAdj", "range": "-12 to +8",
                "desc": (
                    "Distance of QQQ from MA200: (QQQ-MA200)/MA200. "
                    "+8: >+10%  +5: +5-10%  +2: 0-5%. "
                    "-3: -3% to 0%  -7: -7% to -3%  -12: <-7%."
                ),
            },
            {
                "name": "VolAdj", "range": "-12 to +2",
                "desc": (
                    "20-day realized volatility percentile (vs 1-year history). "
                    "+2: <30th pct (low)  0: 30-60th (normal). "
                    "-4: 60-75th  -8: 75-90th  -12: >90th (extreme)."
                ),
            },
            {
                "name": "DDAdj", "range": "-16 to 0",
                "desc": (
                    "Rolling 252-day peak-to-trough drawdown severity. "
                    "0: >-5%  -4: -5 to -10%  -8: -10 to -15%. "
                    "-12: -15 to -20%  -16: <-20%."
                ),
            },
        ],
        "score_zones": [
            {"range": "≥120",    "label": "Overheat",        "desc": "Historically overbought; caution for new positions."},
            {"range": "110-120", "label": "Strong Bull",     "desc": "Strong trend, low volatility, shallow drawdown -- full exposure."},
            {"range": "100-110", "label": "Healthy Bull",    "desc": "Healthy structure with moderate risk -- remain invested."},
            {"range": "95-100",  "label": "Neutral",         "desc": "Balanced environment; watch for further deterioration."},
            {"range": "90-95",   "label": "Soft Risk",       "desc": "Mild signals emerging; reduce leveraged exposure."},
            {"range": "80-90",   "label": "Risk Rising",     "desc": "Multiple risk signals elevated; defensive positioning advised."},
            {"range": "<80",     "label": "Structural Risk", "desc": "Significant breakdown; capital preservation mode."},
        ],
        "level_tiers": LEVEL_TIERS,
        "event_types": [
            {"type": "Shock",      "desc": "Fast-moving drawdown or volatility spike."},
            {"type": "Structural", "desc": "Extended period below MA200 with deep drawdown."},
            {"type": "Grinding",   "desc": "Long duration below MA200 without velocity shock."},
            {"type": "Mixed",      "desc": "Multiple risk signals elevated simultaneously."},
        ],
        "disclaimer": "MSS describes market structural health; it does NOT predict market tops or bottoms.",
    }

    # ── Context Layer (non-destructive: does not touch Nasdaq MSS) ──────────
    spy_df = load_ohlcv("SPY")
    dia_df = load_ohlcv("DIA")

    spy_ctx = _struct_score(spy_df.iloc[:, 0], "SPY") if not spy_df.empty else {"score": 50, "state": "Stable", "vs_ma200": None, "dd_pct": None}
    dia_ctx = _struct_score(dia_df.iloc[:, 0], "DIA") if not dia_df.empty else {"score": 50, "state": "Stable", "vs_ma200": None, "dd_pct": None}

    qqq_series = df["qqq"]
    spy_series  = spy_df.iloc[:, 0] if not spy_df.empty else pd.Series(dtype=float)
    rot_filter = _rotation_filter(qqq_series, spy_series)

    final_risk_obj = build_final_risk(
        nasdaq_level=lvl,
        spy_state=spy_ctx["state"],
        dia_state=dia_ctx["state"],
        rotation_state=rot_filter["state"],
    )

    context_history = build_context_history(qqq_series, spy_df, dia_df, n=90)
    # ── Total Risk Engine (5-layer systemic score) ───────────────────────
    # Load additional data
    risk_as_of = current["date"]
    hyg_df = load_ohlcv_only("HYG")
    hyg_s = hyg_df.iloc[:, 0] if not hyg_df.empty else _load_cache_series("HYG")
    hyg_health = _series_health(
        hyg_s,
        risk_as_of,
        source="ohlcv_daily.HYG" if not hyg_df.empty else "cache.HYG",
        note=None if not hyg_df.empty else "ohlcv_daily.HYG missing",
    )
    lqd_df = load_ohlcv_only("LQD")
    lqd_s = lqd_df.iloc[:, 0] if not lqd_df.empty else _load_cache_series("LQD")
    lqd_health = _series_health(
        lqd_s,
        risk_as_of,
        source="ohlcv_daily.LQD" if not lqd_df.empty else "cache.LQD",
        note=None if not lqd_df.empty else "ohlcv_daily.LQD missing",
    )
    dxy_s, dxy_health = _load_preferred_series("DXY", risk_as_of, market_daily_column="dxy")
    vix_s_tr, vix_health = _load_preferred_series("VIX", risk_as_of, market_daily_column="vix")
    pc_s      = _load_cache_series("PUT_CALL")
    hy_oas_s  = _load_cache_series("HY_OAS")   # FRED: ICE BofA HY OAS (BAMLH0A0HYM2)
    ig_oas_s  = _load_cache_series("IG_OAS")   # FRED: ICE BofA IG OAS (BAMLC0A0CM)
    fsi_s     = _load_cache_series("FSI")      # FRED: St. Louis Financial Stress Index (STLFSI4)

    # Credit basket: BX, KKR, APO, ARES (from ohlcv_daily)
    credit_basket_dfs = [load_ohlcv(sym) for sym in ["BX", "KKR", "APO", "ARES"]]

    # Leveraged loan ETFs
    bkln_df = load_ohlcv("BKLN")
    srln_df = load_ohlcv("SRLN")

    # HYG price series (for BKLN/HYG relative strength)
    hyg_px_s = hyg_df.iloc[:, 0] if not hyg_df.empty else pd.Series(dtype=float)
    if hyg_px_s.empty:
        hyg_px_s = hyg_s

    # BDC basket (private credit proxy)
    bdc_syms = ["ARCC", "OBDC", "BXSL"]
    bdc_dfs = [load_ohlcv(sym) for sym in bdc_syms]
    bdc_series = []
    for sym, df in zip(bdc_syms, bdc_dfs):
        if not df.empty:
            s = df.iloc[:, 0].copy()
            s.name = sym
            bdc_series.append(s)
    if bdc_series:
        bdc_basket_s = pd.concat(bdc_series, axis=1).mean(axis=1)
    else:
        bdc_basket_s = pd.Series(dtype=float)

    # Macro ETFs
    xlf_df = load_ohlcv("XLF")
    xlu_df = load_ohlcv("XLU")
    kre_df = load_ohlcv("KRE")

    # Load additional data for L9/L10
    iwm_df = load_ohlcv("IWM")
    tlt_df = load_ohlcv("TLT")
    tlt_s = tlt_df.iloc[:, 0] if not tlt_df.empty else pd.Series(dtype=float)
    move_s = _load_market_daily_series("move")
    move_health = _series_health(
        move_s,
        risk_as_of,
        source="market_daily.move",
        note=None if not move_s.empty else "market_daily.move missing",
    )

    input_freshness = {
        "qqq": _series_health(qqq_series, risk_as_of, source="ohlcv_daily.qqq"),
        "spy": _series_health(spy_series, risk_as_of, source="ohlcv_daily.spy"),
        "hyg": hyg_health,
        "lqd": lqd_health,
        "dxy": dxy_health,
        "vix": vix_health,
        "put_call": _series_health(pc_s, risk_as_of, source="cache.PUT_CALL"),
        "hy_oas": _series_health(hy_oas_s, risk_as_of, source="cache.HY_OAS"),
        "ig_oas": _series_health(ig_oas_s, risk_as_of, source="cache.IG_OAS"),
        "fsi": _series_health(
            fsi_s,
            risk_as_of,
            source="cache.FSI",
            max_staleness_days=10,
            cadence="W",
            note="weekly FRED series (STLFSI4)",
        ),
        "move": move_health,
    }
    stale_inputs = {
        name: meta for name, meta in input_freshness.items()
        if meta.get("is_stale")
    }
    if stale_inputs:
        print("Stale risk inputs:")
        for name, meta in stale_inputs.items():
            print(
                f"  - {name}: {meta['last_date']} "
                f"({str(meta['days_stale']) + 'd' if meta['days_stale'] is not None else 'n/a'} stale) via {meta['source']}"
                + (f" [{meta['note']}]" if meta.get("note") else "")
            )

    # 11-Layer scores
    l1 = _layer1_equity(float(latest["score"]))
    # Real breadth metrics — computed before layer scoring
    breadth_metrics = compute_breadth_metrics(
        as_of_date=current["date"],
        qqq_dd_pct=current.get("dd_pct"),
    )
    l2 = _layer2_breadth(spy_series, qqq_series, breadth_metrics=breadth_metrics)
    l3 = _layer3_credit(hyg_s, lqd_s, credit_basket_dfs)
    l4 = _layer4_leveraged_loan(bkln_df, srln_df, hyg_s)
    l5 = _layer5_liquidity(dxy_s, hyg_s, lqd_s, vix_s_tr)
    l6 = _layer6_funding(vix_s_tr, pc_s, hyg_s)
    l7 = _layer7_macro(xlf_df, xlu_df, spy_df)
    l8 = _layer8_shock(vix_s_tr, pc_s, spy_series, qqq_series)
    l9  = _layer9_cross_asset(spy_series, hyg_s, bkln_df, xlf_df, iwm_df)
    l10 = _layer10_credit_spread(hy_oas_s, ig_oas_s, fsi_s, pc_s)
    l11 = _layer11_liquidity_shock(dxy_s, tlt_s, move_s, vix_s_tr)
    l12 = _layer12_financial_stress(xlf_df, kre_df, spy_series, l3, l4, l10)

    total_risk = build_total_risk(l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12)
    print(f"Total Risk Score: {total_risk['total']}/120 ({total_risk['state']})  Crisis Stage: {total_risk['crisis_stage']['stage']} -- {total_risk['crisis_stage']['label']}")

    # ── Track A: Credit Early Warning (independent of 12-layer engine) ──
    bkln_s = bkln_df.iloc[:, 0] if not bkln_df.empty else pd.Series(dtype=float)
    track_a = compute_track_a(
        hy_oas_s,
        ig_oas_s,
        qqq_series,
        bkln_s,
        hyg_px_s,
        bdc_basket_s,
        spy_series,
        as_of_date=risk_as_of,
    )
    tier_marker = ""
    if track_a["stage0"]:
        tier_marker = f" *** STAGE 0 CONFIRMED (Day {track_a['consecutive_days']}) ***"
    elif track_a["stage0_watch"]:
        tier_marker = f" [Credit Watch — Day {track_a['consecutive_days']}/3]"
    print(f"Track A — Credit Z-score: {track_a['z_credit']}  State: {track_a['state']}{tier_marker}")
    xlf_s = xlf_df.iloc[:, 0] if not xlf_df.empty else pd.Series(dtype=float)
    kre_s = kre_df.iloc[:, 0] if not kre_df.empty else pd.Series(dtype=float)
    track_a_early = compute_track_a_early(
        qqq_series,
        bkln_s,
        hyg_px_s,
        bdc_basket_s,
        spy_series,
        xlf_s,
        kre_s,
        as_of_date=risk_as_of,
    )
    print(
        f"Track A Early — Score: {track_a_early.get('score')}  "
        f"State: {track_a_early.get('state')}  "
        f"Triggers: {track_a_early.get('trigger_count')}"
    )
    print(f"  L1 Eq:{l1['score']}/15  L2 Br:{l2['score']}/10  L3 Cr:{l3['score']}/12  L4 LV:{l4['score']}/13  L5 Lq:{l5['score']}/13")
    print(f"  L6 Fn:{l6['score']}/12  L7 Ma:{l7['score']}/13  L8 Sh:{l8['score']}/12  L9 CA:{l9['score']}/10  L10 CS:{l10['score']}/10  L11 LS:{l11['score']}/10  L12 FS:{l12['score']}/10")
    _report_l10_backtest_windows(hy_oas_s, ig_oas_s, fsi_s, pc_s)

    # ── Track B Velocity: MSS structural acceleration alert ───────────────────
    mss_current_val = float(current.get("score", 100))
    track_b = compute_track_b_velocity(history, mss_current_val)
    if track_b["velocity_alert"]:
        print(f"Track B ⚠ MSS Velocity Alert: {track_b['mss_5d_delta']:+.1f}pt in 5d  ({track_b['velocity_signal']})")
    else:
        print(f"Track B — MSS Velocity: {track_b['mss_5d_delta']:+.1f}pt / 5d  ({track_b['velocity_signal']})")

    # ── Track C: Event/Shock Tracker ─────────────────────────────────────────
    jpy_df  = load_ohlcv("JPY=X")
    gld_df  = load_ohlcv("GLD")
    oil_s   = _load_market_daily_series("oil")
    jpy_s   = jpy_df.iloc[:, 0] if not jpy_df.empty else pd.Series(dtype=float)
    gld_s   = gld_df.iloc[:, 0] if not gld_df.empty else pd.Series(dtype=float)
    track_c = compute_track_c(vix_s_tr, oil_s, jpy_s, gld_s, spy_series, as_of_date=risk_as_of)
    print(f"Track C — State: {track_c['state']}  Shock: {track_c['shock_type']}  "
          f"Score: {track_c['score']}/{track_c['max_score']}  "
          f"Sensors: {[s['badge'] for s in track_c['triggered_sensors']]}")

    track_a_early_validation = build_track_a_early_event_detection(
        events,
        qqq_series,
        bkln_s,
        hyg_px_s,
        bdc_basket_s,
        spy_series,
        xlf_s,
        kre_s,
    )
    print(
        "Track A Early validation — "
        f"{track_a_early_validation['events_with_signal']} events signaled, "
        f"avg lead {track_a_early_validation['avg_lead_days']}d"
    )
    signal_analysis["track_a_early"] = track_a_early_validation

    # ── Master Signal: Combined A+C+B ─────────────────────────────────────────
    master_signal = compute_master_signal(track_a, track_c, track_b, track_a_early)

    # ── Phase 2: Regime Stability + Scenario + Contribution ──────────────────
    market_regime    = compute_regime_stability(total_risk, history)
    risk_scenario    = classify_risk_scenario(
        track_a, track_c, total_risk, breadth_metrics,
        mss_score=float(current.get('score', 100)),
        spy_series=spy_series, iwm_df=iwm_df,
    )
    risk_contribution = compute_risk_contribution(total_risk)

    # ── Phase 3-A: Event Similarity ──────────────────────────────────────────
    _current_regime_str = total_risk.get('regime', {}).get('regime', 'Expansion')
    _latest_event_start = events[-1]['start'] if events else None
    event_similarity = compute_event_similarity(
        current_level=int(current.get('level', 1)),
        current_mss=float(current.get('score', 100)),
        current_regime=_current_regime_str,
        events=events,
        mss_history_full=mss_history_full,
        exclude_start=_latest_event_start,
    )
    print(f"Regime: {market_regime['regime']} ({market_regime['stability_label']} {market_regime['days_in_regime']}d)  "
          f"Scenario {risk_scenario['scenario']}: {risk_scenario['label']} ({risk_scenario['confidence']}% conf)")
    if event_similarity:
        print(f"Similar events: {[e['name'] + ' sim=' + str(e['similarity_pct']) + '%' for e in event_similarity]}")

    # ── Phase 4: Global Transmission Map ─────────────────────────────────────
    global_transmission = compute_global_transmission(total_risk, track_a, track_c, track_b)
    print(f"Transmission: {global_transmission['transmission_state']}  "
          f"Active paths ({global_transmission['n_active_edges']}): {global_transmission['active_paths'][:2]}")

    # ── Concentration: MAG7 vs SPY momentum ──────────────────────────────────
    concentration = compute_concentration(as_of_date=current.get("date"))
    print(f"Master  — Mode: {master_signal['mode']}  Action: {master_signal['action']}  "
          f"Severity: {master_signal['severity']}")
    if master_signal["mss_velocity_alert"]:
        print(f"         ⚠ MSS Velocity Alert included in escalation conditions")


    # Attach context to current dict
    current["context"] = {
        "spy": {**spy_ctx, "label": "SPY Broad Market"},
        "dia": {**dia_ctx, "label": "DIA Industrial"},
        "rotation": {**rot_filter, "label": "QQQ/SPY Rotation"},
        "final_risk":      final_risk_obj["final_risk"],
        "final_exposure":  final_risk_obj["final_exposure_pct"],
        "brief":           final_risk_obj["brief"],
    }

    print(f"SPY context: {spy_ctx['state']}  DIA: {dia_ctx['state']}  Rotation: {rot_filter['state']}")
    print(f"Final Market Risk: {final_risk_obj['final_risk']}  Exposure: {final_risk_obj['final_exposure_pct']}%")


    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    output = {
        "run_id": run_id,
        "current": current,
        "data_as_of": risk_as_of,
        "input_freshness": input_freshness,
        "history": history,
        "context_history": context_history,
        "total_risk":    total_risk,
        "track_a":       track_a,
        "track_a_early": track_a_early,
        "track_b":       track_b,
        "track_c":       track_c,
        "master_signal":    master_signal,
        "market_regime":     market_regime,
        "risk_scenario":     risk_scenario,
        "risk_contribution": risk_contribution,
        "event_similarity":    event_similarity,
        "global_transmission": global_transmission,
        "events": events,
        "backtest": backtest,
        "backtest_curve": backtest_curve,
        "signal_analysis": signal_analysis,
        "breadth":        breadth_metrics,
        "concentration":  concentration,
        "methodology": methodology,
    }

    with open(os.path.join(OUTPUT_DIR, "risk_v1.json"), "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    with open(os.path.join(OUTPUT_DIR, "risk_v1_playback.json"), "w", encoding="utf-8") as f:
        json.dump({"run_id": run_id, "events": playback_events}, f, ensure_ascii=False)

    with open(os.path.join(OUTPUT_DIR, "risk_v1_sim.json"), "w", encoding="utf-8") as f:
        json.dump({"events": sim_events}, f, ensure_ascii=False)

    print(f"Written: {os.path.join(OUTPUT_DIR, 'risk_v1.json')}")
    print(f"Written: {os.path.join(OUTPUT_DIR, 'risk_v1_playback.json')}")
    with open(os.path.join(OUTPUT_DIR, "mss_history.json"), "w", encoding="utf-8") as f:
        json.dump({"data": mss_history_full}, f, separators=(",", ":"))
    print(f"Written: {os.path.join(OUTPUT_DIR, 'risk_v1_sim.json')}")
    print(f"Written: {os.path.join(OUTPUT_DIR, 'mss_history.json')} ({len(mss_history_full)} rows)")
    print(f"Current score: {current['score']}  Level {current['level']} ({current['level_label']})")


if __name__ == "__main__":
    main()
