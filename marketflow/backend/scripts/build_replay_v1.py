"""
build_replay_v1.py
──────────────────
System Replay Engine — Historical Validation

Replays the 12-layer systemic risk engine over historical windows,
validating regime detection, crisis stage transitions, and dominant signal shifts.

Purpose: VALIDATION, not PnL optimization.

Questions answered:
  1. Did the engine identify early stress before major equity damage?
  2. Did Market Regime transitions make sense historically?
  3. Did Crisis Stage progress in the correct order?
  4. Did Dominant Signal shift realistically?
  5. Were there false alarms?

Output: backend/output/replay/{window_name}.json + _summary.csv
"""

from __future__ import annotations

import json
import os
import sys
import sqlite3
from datetime import datetime

import numpy as np
import pandas as pd

# ── Import live engine (same code path, no shortcuts) ─────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
import build_risk_v1 as eng  # noqa: E402 — live engine import

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPTS_DIR)
OUTPUT_DIR  = os.path.join(BACKEND_DIR, "output", "replay")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Replay Windows ─────────────────────────────────────────────────────────────
REPLAY_WINDOWS: dict[str, tuple[str, str | None]] = {
    "2020_covid":       ("2020-01-01", "2020-06-30"),
    "2022_tightening":  ("2022-01-01", "2022-12-31"),
    "2023_bank_stress": ("2023-02-01", "2023-05-31"),
    "2025_current":     ("2025-10-01", None),          # None = today
}

# ── Data Loading ───────────────────────────────────────────────────────────────

def load_all_series() -> dict:
    """
    Load all data series needed by all 12 layers — full history.
    Uses same data sources as build_risk_v1.py (no replay shortcuts).
    """
    print("Loading all data series...")

    DB_PATH  = eng.DB_PATH
    con = sqlite3.connect(DB_PATH)
    qqq_df = eng.load_symbol(con, "QQQ")
    spy_main_df = eng.load_symbol(con, "SPY")
    con.close()

    series: dict[str, pd.DataFrame | pd.Series | None] = {
        # ── ticker_history_daily ──────────────────────────────────────────────
        "qqq":       qqq_df,          # full history for MSS computation
        "spy_main":  spy_main_df,
        # ── ohlcv_daily (price DataFrames) ───────────────────────────────────
        "spy":       eng.load_ohlcv("SPY"),
        "hyg":       eng.load_ohlcv("HYG"),
        "lqd":       eng.load_ohlcv("LQD"),
        "bkln":      eng.load_ohlcv("BKLN"),
        "srln":      eng.load_ohlcv("SRLN"),
        "xlf":       eng.load_ohlcv("XLF"),
        "xlu":       eng.load_ohlcv("XLU"),
        "kre":       eng.load_ohlcv("KRE"),
        "iwm":       eng.load_ohlcv("IWM"),
        "tlt":       eng.load_ohlcv("TLT"),
        "bx":        eng.load_ohlcv("BX"),
        "kkr":       eng.load_ohlcv("KKR"),
        "apo":       eng.load_ohlcv("APO"),
        "ares":      eng.load_ohlcv("ARES"),
        # ── cache.db series ───────────────────────────────────────────────────
        "hyg_s":     eng._load_cache_series("HYG"),
        "lqd_s":     eng._load_cache_series("LQD"),
        "dxy_s":     eng._load_cache_series("DXY"),
        "vix_s":     eng._load_cache_series("VIX"),
        "put_call_s":eng._load_cache_series("PUT_CALL"),
        "hy_oas_s":  eng._load_cache_series("HY_OAS"),
        "ig_oas_s":  eng._load_cache_series("IG_OAS"),
        "fsi_s":     eng._load_cache_series("FSI"),
        "move_s":    eng._load_cache_series("MOVE"),
        # ── Track C sensors ───────────────────────────────────────────────────
        "jpy":       eng.load_ohlcv("JPY=X"),   # yen carry
        "gld":       eng.load_ohlcv("GLD"),     # gold safe haven
        "oil_s":     eng._load_market_daily_series("oil"),  # oil price (graceful degradation pre-2022)
    }

    # Fallback for DXY/VIX from market_daily if cache empty
    if isinstance(series["dxy_s"], pd.Series) and series["dxy_s"].empty:
        series["dxy_s"] = eng._load_market_daily_series("dxy")
    if isinstance(series["vix_s"], pd.Series) and series["vix_s"].empty:
        series["vix_s"] = eng._load_market_daily_series("vix")

    # Build hyg_s from ohlcv if cache empty
    if isinstance(series["hyg_s"], pd.Series) and series["hyg_s"].empty:
        hyg_df = series.get("hyg")
        if hyg_df is not None and not hyg_df.empty:
            series["hyg_s"] = hyg_df.iloc[:, 0]

    if isinstance(series["lqd_s"], pd.Series) and series["lqd_s"].empty:
        lqd_df = series.get("lqd")
        if lqd_df is not None and not lqd_df.empty:
            series["lqd_s"] = lqd_df.iloc[:, 0]

    # Report coverage
    for k, v in series.items():
        if v is None:
            print(f"  [{k:12s}] NONE")
        elif isinstance(v, (pd.DataFrame, pd.Series)):
            if not v.empty:
                idx = v.index if isinstance(v, pd.Series) else v.index
                print(f"  [{k:12s}] {len(idx):5d} rows  {idx[0].date()} → {idx[-1].date()}")
            else:
                print(f"  [{k:12s}] EMPTY (data gap)")
        else:
            print(f"  [{k:12s}] {type(v)}")

    return series


# ── Market Structure Score History ─────────────────────────────────────────────

def compute_mss_history(qqq_df: pd.DataFrame) -> pd.Series:
    """
    Compute Market Structure Score (MSS) for ALL dates.
    Identical formula to build_risk_v1.py main().
    Returns pd.Series indexed by date, values = MSS score.
    """
    q = qqq_df.iloc[:, 0].dropna()

    ma50  = q.rolling(50,  min_periods=20).mean()
    ma200 = q.rolling(200, min_periods=60).mean()

    ret   = q.pct_change()
    vol20 = ret.rolling(20, min_periods=10).std() * np.sqrt(252)
    vol_pct = eng.rolling_percentile(vol20, 252).fillna(0.0)

    roll_max = q.rolling(252, min_periods=60).max()
    dd_pct   = (q / roll_max - 1) * 100.0
    dd_pct   = dd_pct.fillna(0.0)

    ma200_valid    = ma200.notna()
    ma50_valid     = ma50.notna()
    qqq_above_ma200 = q > ma200
    qqq_above_ma50  = q > ma50
    ma50_above_ma200 = ma50 > ma200

    distance200 = np.where(
        ma200_valid,
        (q.values - ma200.values) / ma200.values,
        0.0,
    )
    near_ma200 = ma200_valid & (np.abs(distance200) <= 0.01)

    trend_adj = np.select(
        [
            ~(ma200_valid & ma50_valid),
            near_ma200,
            qqq_above_ma200 & qqq_above_ma50 & ma50_above_ma200,
            qqq_above_ma200,
            ~qqq_above_ma200 & ma50_above_ma200,
        ],
        [0.0, 0.0, 8.0, 4.0, -6.0],
        default=-12.0,
    )
    depth_adj = np.select(
        [
            ~ma200_valid,
            distance200 > 0.10,
            distance200 > 0.05,
            distance200 >= 0.0,
            distance200 >= -0.03,
            distance200 >= -0.07,
        ],
        [0.0, 8.0, 5.0, 2.0, -3.0, -7.0],
        default=-12.0,
    )
    vol_adj = np.select(
        [vol_pct.values < 30, vol_pct.values < 60, vol_pct.values < 75, vol_pct.values < 90],
        [2.0, 0.0, -4.0, -8.0],
        default=-12.0,
    )
    dd_adj = np.select(
        [dd_pct.values > -5.0, dd_pct.values > -10.0, dd_pct.values > -15.0, dd_pct.values > -20.0],
        [0.0, -4.0, -8.0, -12.0],
        default=-16.0,
    )

    mss = pd.Series(
        (100.0 + trend_adj + depth_adj + vol_adj + dd_adj).round(1),
        index=q.index,
    )
    return mss


# ── Per-Day Snapshot Builder ───────────────────────────────────────────────────

def _as_of_series(s: pd.Series | None, date: pd.Timestamp) -> pd.Series:
    """Slice a Series to [start, date] inclusive."""
    if s is None or (isinstance(s, pd.Series) and s.empty):
        return pd.Series(dtype=float)
    return s.loc[:date]


def _as_of_df(df: pd.DataFrame | None, date: pd.Timestamp) -> pd.DataFrame:
    """Slice a DataFrame to [start, date] inclusive."""
    if df is None or (isinstance(df, pd.DataFrame) and df.empty):
        return pd.DataFrame()
    return df.loc[:date]


def _safe_last(s: pd.Series | None) -> float | None:
    """Get the last value of a series safely."""
    if s is None or s.empty:
        return None
    v = s.iloc[-1]
    return float(v) if pd.notna(v) else None


def build_daily_snapshot(
    date: pd.Timestamp,
    series: dict,
    mss_history: pd.Series,
) -> dict:
    """
    Compute full systemic risk snapshot for a single historical date.
    Uses same engine functions as the live system — no replay shortcuts.
    """
    # ── MSS for this date ─────────────────────────────────────────────────────
    mss_slice = mss_history.loc[:date]
    mss = float(mss_slice.iloc[-1]) if not mss_slice.empty else 100.0

    # ── As-of slices ──────────────────────────────────────────────────────────
    spy_df_ao   = _as_of_df(series.get("spy"),   date)
    hyg_df_ao   = _as_of_df(series.get("hyg"),   date)
    lqd_df_ao   = _as_of_df(series.get("lqd"),   date)
    bkln_df_ao  = _as_of_df(series.get("bkln"),  date)
    srln_df_ao  = _as_of_df(series.get("srln"),  date)
    xlf_df_ao   = _as_of_df(series.get("xlf"),   date)
    xlu_df_ao   = _as_of_df(series.get("xlu"),   date)
    kre_df_ao   = _as_of_df(series.get("kre"),   date)
    iwm_df_ao   = _as_of_df(series.get("iwm"),   date)
    tlt_df_ao   = _as_of_df(series.get("tlt"),   date)
    qqq_df_ao   = _as_of_df(series.get("qqq"),   date)

    credit_basket_ao = [
        _as_of_df(series.get(sym), date)
        for sym in ["bx", "kkr", "apo", "ares"]
    ]

    hyg_s_ao  = _as_of_series(series.get("hyg_s"),     date)
    lqd_s_ao  = _as_of_series(series.get("lqd_s"),     date)
    dxy_s_ao  = _as_of_series(series.get("dxy_s"),     date)
    vix_s_ao  = _as_of_series(series.get("vix_s"),     date)
    pc_s_ao   = _as_of_series(series.get("put_call_s"), date)
    hy_oas_ao = _as_of_series(series.get("hy_oas_s"),  date)
    ig_oas_ao = _as_of_series(series.get("ig_oas_s"),  date)
    fsi_s_ao  = _as_of_series(series.get("fsi_s"),     date)
    move_s_ao = _as_of_series(series.get("move_s"),    date)

    # Derive SPY series from DataFrame
    spy_s_ao  = spy_df_ao.iloc[:, 0] if not spy_df_ao.empty else pd.Series(dtype=float)
    qqq_s_ao  = qqq_df_ao.iloc[:, 0] if not qqq_df_ao.empty else pd.Series(dtype=float)
    tlt_s_ao  = tlt_df_ao.iloc[:, 0] if not tlt_df_ao.empty else pd.Series(dtype=float)

    # Fallback: derive hyg_s/lqd_s from OHLCV if cache empty for this date
    if hyg_s_ao.empty and not hyg_df_ao.empty:
        hyg_s_ao = hyg_df_ao.iloc[:, 0]
    if lqd_s_ao.empty and not lqd_df_ao.empty:
        lqd_s_ao = lqd_df_ao.iloc[:, 0]

    # ── 12-Layer Scores ───────────────────────────────────────────────────────
    l1  = eng._layer1_equity(mss)
    l2  = eng._layer2_breadth(spy_s_ao, qqq_s_ao)
    l3  = eng._layer3_credit(hyg_s_ao, lqd_s_ao, credit_basket_ao)
    l4  = eng._layer4_leveraged_loan(bkln_df_ao, srln_df_ao, hyg_s_ao)
    l5  = eng._layer5_liquidity(dxy_s_ao, hyg_s_ao, lqd_s_ao, vix_s_ao)
    l6  = eng._layer6_funding(vix_s_ao, pc_s_ao, hyg_s_ao)
    l7  = eng._layer7_macro(xlf_df_ao, xlu_df_ao, spy_df_ao)
    l8  = eng._layer8_shock(vix_s_ao, pc_s_ao, spy_s_ao, qqq_s_ao)
    l9  = eng._layer9_cross_asset(spy_s_ao, hyg_s_ao, bkln_df_ao, xlf_df_ao, iwm_df_ao)
    l10 = eng._layer10_credit_spread(hy_oas_ao, ig_oas_ao, fsi_s_ao, pc_s_ao)
    l11 = eng._layer11_liquidity_shock(dxy_s_ao, tlt_s_ao, move_s_ao, vix_s_ao)
    l12 = eng._layer12_financial_stress(xlf_df_ao, kre_df_ao, spy_s_ao, l3, l4, l10)

    # ── Total Risk ────────────────────────────────────────────────────────────
    tr = eng.build_total_risk(l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12)

    # ── Track A: Credit Early Warning (as-of sliced) ──────────────────────────
    track_a = eng.compute_track_a(hy_oas_ao, ig_oas_ao, qqq_s_ao)

    # ── Track C: Event/Shock Tracker (as-of sliced) ───────────────────────────
    jpy_raw  = series.get("jpy")
    gld_raw  = series.get("gld")
    oil_raw  = series.get("oil_s")
    jpy_s_ao = jpy_raw.iloc[:, 0].loc[:date] if (isinstance(jpy_raw, pd.DataFrame) and not jpy_raw.empty) else pd.Series(dtype=float)
    gld_s_ao = gld_raw.iloc[:, 0].loc[:date] if (isinstance(gld_raw, pd.DataFrame) and not gld_raw.empty) else pd.Series(dtype=float)
    oil_s_ao = oil_raw.loc[:date] if (isinstance(oil_raw, pd.Series) and not oil_raw.empty) else pd.Series(dtype=float)
    track_c  = eng.compute_track_c(vix_s_ao, oil_s_ao, jpy_s_ao, gld_s_ao, qqq_s_ao)

    # ── Track B Velocity: MSS structural acceleration (from as-of mss_slice) ──
    if len(mss_slice) >= 6:
        mss_5d_ago_val = float(mss_slice.iloc[-6])
    elif len(mss_slice) >= 1:
        mss_5d_ago_val = float(mss_slice.iloc[0])
    else:
        mss_5d_ago_val = mss
    mss_5d_delta_val   = round(mss - mss_5d_ago_val, 1)
    mss_velocity_alert = mss_5d_delta_val <= -8.0
    vel_pct = max(0, min(100, int(mss_5d_delta_val / -8.0 * 100))) if mss_5d_delta_val < 0 else 0
    track_b = {
        "mss_current":    round(mss, 1),
        "mss_5d_ago":     round(mss_5d_ago_val, 1),
        "mss_5d_delta":   mss_5d_delta_val,
        "velocity_alert": mss_velocity_alert,
        "velocity_pct":   vel_pct,
        "velocity_signal": (
            f"MSS {mss_5d_delta_val:+.1f}pt / 5d — 구조 가속 경보"
            if mss_velocity_alert else "정상 범위"
        ),
    }

    # ── Master Signal: Combined A+C+B ──────────────────────────────────────────
    master_signal = eng.compute_master_signal(track_a, track_c, track_b)

    # ── Market Reference Prices ───────────────────────────────────────────────
    def ref_price(df_or_s, name: str) -> float | None:
        if isinstance(df_or_s, pd.DataFrame):
            s = df_or_s.iloc[:, 0] if not df_or_s.empty else pd.Series(dtype=float)
        else:
            s = df_or_s if df_or_s is not None else pd.Series(dtype=float)
        sliced = s.loc[:date] if not s.empty else s
        return round(float(sliced.iloc[-1]), 4) if not sliced.empty and pd.notna(sliced.iloc[-1]) else None

    refs = {
        "SPY":      ref_price(spy_df_ao, "SPY"),
        "QQQ":      ref_price(qqq_df_ao, "QQQ"),
        "HYG":      ref_price(hyg_s_ao,  "HYG"),
        "XLF":      ref_price(xlf_df_ao, "XLF"),
        "BKLN":     ref_price(bkln_df_ao,"BKLN"),
        "VIX":      ref_price(vix_s_ao,  "VIX"),
        "DXY":      ref_price(dxy_s_ao,  "DXY"),
        "HY_OAS":   ref_price(hy_oas_ao, "HY_OAS"),
    }

    # ── Layer gap detection ───────────────────────────────────────────────────
    all_layers = [l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12]
    data_gaps  = [l.get("label", f"L{i+1}") for i, l in enumerate(all_layers) if l.get("score", -1) == 0 and l.get("max", 1) > 0]

    return {
        "date":                 date.strftime("%Y-%m-%d"),
        "mps":                  tr["mps"],
        "regime":               tr["regime"]["regime"],
        "regime_confidence":    tr["regime"]["confidence"],
        "regime_drivers":       tr["regime"].get("drivers", []),
        "total_risk":           tr["total"],
        "state":                tr["state"],
        "state_color":          tr["state_color"],
        "crisis_stage":         tr["crisis_stage"]["stage"],
        "crisis_stage_label":   tr["crisis_stage"]["label"],
        "crisis_stage_color":   tr["crisis_stage"]["color"],
        "dominant_signal":      tr["dominant_layer"],
        "mss":                  round(mss, 1),
        "track_a":              track_a,       # Credit Early Warning (Track A)
        "track_b":              track_b,       # MSS Velocity (Track B acceleration)
        "track_c":              track_c,       # Event/Shock Tracker (Track C)
        "master_signal":        master_signal, # Combined A+C+B recommendation
        "mss_velocity_alert":   mss_velocity_alert,
        "mss_5d_delta":         mss_5d_delta_val,
        "layers": {
            k: {"score": v["score"], "max": v["max"], "label": v.get("label", k)}
            for k, v in tr["layers"].items()
        },
        "refs":       refs,
        "data_gaps":  data_gaps,
    }


# ── Replay Series Builder ──────────────────────────────────────────────────────

def build_replay_series(
    window_name: str,
    start_date: str,
    end_date: str,
    series: dict,
    mss_history: pd.Series,
) -> list[dict]:
    """
    Loop over all QQQ trading dates in [start_date, end_date].
    Build a daily snapshot for each date using the live engine.
    """
    qqq_df = series["qqq"]
    start  = pd.Timestamp(start_date)
    end    = pd.Timestamp(end_date)

    trading_dates = qqq_df.loc[start:end].index
    if len(trading_dates) == 0:
        print(f"  WARNING: No QQQ trading dates in {start_date} → {end_date}")
        return []

    print(f"  {len(trading_dates)} trading days: {trading_dates[0].date()} → {trading_dates[-1].date()}")
    snapshots: list[dict] = []

    for i, date in enumerate(trading_dates):
        snap = build_daily_snapshot(date, series, mss_history)
        snapshots.append(snap)

        if (i + 1) % 25 == 0 or i == 0 or i == len(trading_dates) - 1:
            print(f"    [{i+1:3d}/{len(trading_dates)}] {date.date()}  "
                  f"Risk:{snap['total_risk']:3d}/120  "
                  f"Regime:{snap['regime']:16s}  "
                  f"Stage:{snap['crisis_stage']} {snap['crisis_stage_label']}")

    return snapshots


# ── Summary Metrics ────────────────────────────────────────────────────────────

def summarize_replay(snapshots: list[dict]) -> dict:
    """
    Compute validation summary metrics for a replay window.
    Answers the 5 core questions about engine detection quality.
    """
    if not snapshots:
        return {}

    df = pd.DataFrame(snapshots)
    df["date"] = pd.to_datetime(df["date"])

    def first_date(mask_series) -> str | None:
        rows = df.loc[mask_series, "date"]
        return rows.iloc[0].strftime("%Y-%m-%d") if not rows.empty else None

    # ── A. First Warning Dates ─────────────────────────────────────────────────
    credit_signals = {"Credit Stress", "Leveraged Loans", "Credit Spreads", "Financial Stress"}
    first_warning = {
        "caution_threshold":    first_date(df["total_risk"] > 30),
        "non_expansion_regime": first_date(df["regime"] != "Expansion"),
        "stage_2_or_higher":    first_date(df["crisis_stage"] >= 2),
        "credit_dominant":      first_date(df["dominant_signal"].isin(credit_signals)),
    }

    # ── B. Peak Stress ─────────────────────────────────────────────────────────
    peak_idx = df["total_risk"].idxmax()
    peak_row = df.loc[peak_idx]
    peak = {
        "date":               peak_row["date"].strftime("%Y-%m-%d"),
        "total_risk":         int(peak_row["total_risk"]),
        "mps":                int(peak_row["mps"]),
        "crisis_stage":       int(peak_row["crisis_stage"]),
        "crisis_stage_label": peak_row["crisis_stage_label"],
        "regime":             peak_row["regime"],
        "dominant_signal":    peak_row["dominant_signal"],
        "state":              peak_row["state"],
    }

    # ── C. Regime Distribution ─────────────────────────────────────────────────
    regime_counts = df["regime"].value_counts()
    total_days    = len(df)
    regime_pct    = (regime_counts / total_days * 100).round(1).to_dict()

    # First regime change date
    regime_changes = df[df["regime"] != df["regime"].shift()]
    first_regime_change = regime_changes.iloc[1]["date"].strftime("%Y-%m-%d") if len(regime_changes) > 1 else None

    # Longest consecutive streak per regime
    def longest_streak(regime_name: str) -> int:
        mask   = (df["regime"] == regime_name).astype(int)
        groups = mask.groupby((mask != mask.shift()).cumsum())
        return int(groups.sum().max()) if not groups.sum().empty else 0

    regime_distribution = {
        "pct":                regime_pct,
        "first_change_date":  first_regime_change,
        "longest_streak":     {r: longest_streak(r) for r in regime_pct},
        "change_count":       len(regime_changes) - 1,
    }

    # ── D. Crisis Stage Transitions ────────────────────────────────────────────
    stage_changes = df[df["crisis_stage"] != df["crisis_stage"].shift()].copy()
    stage_transitions = [
        {
            "date":  row["date"].strftime("%Y-%m-%d"),
            "stage": int(row["crisis_stage"]),
            "label": row["crisis_stage_label"],
        }
        for _, row in stage_changes.iterrows()
    ]

    # Max consecutive days at stage >= 4
    at_high_stage   = (df["crisis_stage"] >= 4).astype(int)
    high_stage_runs = at_high_stage.groupby((at_high_stage != at_high_stage.shift()).cumsum()).sum()
    max_high_stage_days = int(high_stage_runs.max()) if not high_stage_runs.empty else 0

    # ── E. Dominant Signal Distribution ───────────────────────────────────────
    dom_counts  = df["dominant_signal"].value_counts()
    dom_pct     = (dom_counts / total_days * 100).round(1).to_dict()
    dom_changes = df[df["dominant_signal"] != df["dominant_signal"].shift()]
    dom_at_peak = peak_row["dominant_signal"]

    dominant_distribution = {
        "pct":            dom_pct,
        "first_dominant": df["dominant_signal"].iloc[0],
        "at_peak":        dom_at_peak,
        "change_count":   len(dom_changes) - 1,
    }

    # ── F. Track A — Credit Early Warning Analysis ────────────────────────────
    # Extract track_a fields per snapshot safely
    def get_ta(snap, field, default=None):
        ta = snap.get("track_a", {})
        return ta.get(field, default) if ta else default

    # Tier 2 (stage0=True): confirmed 3-day streak
    stage0_dates   = [s["date"] for s in snapshots if get_ta(s, "stage0", False)]
    # Tier 1 (stage0_watch=True): day-1+ awareness (includes Tier 2 days)
    watch_dates    = [s["date"] for s in snapshots if get_ta(s, "stage0_watch", False)]
    z_values       = [get_ta(s, "z_credit") for s in snapshots if get_ta(s, "z_credit") is not None]

    # State distribution
    ta_states = [get_ta(s, "state", "Unavailable") for s in snapshots]
    ta_state_counts = {}
    for st in ta_states:
        ta_state_counts[st] = ta_state_counts.get(st, 0) + 1
    ta_state_pct = {k: round(v / total_days * 100, 1) for k, v in ta_state_counts.items()}

    track_a_summary = {
        "first_tier1_date":     watch_dates[0]   if watch_dates   else None,  # Tier 1: day 1 awareness
        "tier1_days":           len(watch_dates),
        "first_tier2_date":     stage0_dates[0]  if stage0_dates  else None,  # Tier 2: 3-day confirmed
        "tier2_days":           len(stage0_dates),
        # Legacy aliases for frontend compatibility
        "first_stage0_date":    stage0_dates[0]  if stage0_dates  else None,
        "stage0_days":          len(stage0_dates),
        "first_watch_date":     watch_dates[0]   if watch_dates   else None,
        "watch_days":           len(watch_dates),
        "peak_z_credit":        round(max(z_values), 3) if z_values else None,
        "state_distribution":   ta_state_pct,
    }

    # ── G. Track C Summary ────────────────────────────────────────────────────
    def get_tc(snap, field, default=None):
        tc = snap.get("track_c", {})
        return tc.get(field, default) if tc else default

    shock_watch_dates     = [s["date"] for s in snapshots if get_tc(s, "state") != "Normal"]
    shock_confirmed_dates = [s["date"] for s in snapshots if get_tc(s, "state") == "Shock Confirmed"]
    shock_types_seen      = list({get_tc(s, "shock_type") for s in snapshots
                                  if get_tc(s, "shock_type") not in ("None", None)})

    track_c_summary = {
        "first_shock_watch_date":     shock_watch_dates[0]     if shock_watch_dates     else None,
        "first_shock_confirmed_date": shock_confirmed_dates[0] if shock_confirmed_dates else None,
        "shock_confirmed_days":       len(shock_confirmed_dates),
        "shock_watch_days":           len(shock_watch_dates),
        "shock_types_seen":           shock_types_seen,
    }

    all_gaps: set[str] = set()
    for snap in snapshots:
        all_gaps.update(snap.get("data_gaps", []))

    gap_by_layer: dict[str, int] = {}
    for snap in snapshots:
        for g in snap.get("data_gaps", []):
            gap_by_layer[g] = gap_by_layer.get(g, 0) + 1

    data_gap_summary = {
        "layers_with_gaps": sorted(all_gaps),
        "gap_day_counts":   gap_by_layer,
    }

    # ── G2. Track B (MSS Velocity) Summary ─────────────────────────────────────
    vel_col = "mss_velocity_alert"
    if vel_col in df.columns:
        vel_alert_dates = df.loc[df[vel_col] == True, "date"]
        first_vel_alert = vel_alert_dates.iloc[0].strftime("%Y-%m-%d") if not vel_alert_dates.empty else None
        vel_alert_days  = int((df[vel_col] == True).sum())
    else:
        first_vel_alert = None
        vel_alert_days  = 0

    # Min MSS 5d delta (worst velocity day)
    delta_col = "mss_5d_delta"
    peak_negative_velocity = round(float(df[delta_col].min()), 1) if delta_col in df.columns else None
    peak_vel_date = (
        df.loc[df[delta_col].idxmin(), "date"].strftime("%Y-%m-%d")
        if delta_col in df.columns and not df[delta_col].isna().all()
        else None
    )

    track_b_summary = {
        "first_velocity_alert_date": first_vel_alert,
        "velocity_alert_days":       vel_alert_days,
        "peak_negative_velocity":    peak_negative_velocity,
        "peak_velocity_date":        peak_vel_date,
    }

    return {
        "trading_days":          total_days,
        "first_warning":         first_warning,
        "peak":                  peak,
        "regime_distribution":   regime_distribution,
        "stage_transitions":     stage_transitions,
        "max_high_stage_days":   max_high_stage_days,
        "dominant_distribution": dominant_distribution,
        "track_a_summary":       track_a_summary,
        "track_b_summary":       track_b_summary,
        "track_c_summary":       track_c_summary,
        "data_gap_summary":      data_gap_summary,
    }


# ── Save Outputs ───────────────────────────────────────────────────────────────

def save_replay(window_name: str, snapshots: list[dict], summary: dict) -> None:
    """Save replay data to JSON + summary CSV."""
    output = {
        "window":        window_name,
        "generated_at":  datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "trading_days":  len(snapshots),
        "date_range": {
            "start": snapshots[0]["date"] if snapshots else None,
            "end":   snapshots[-1]["date"] if snapshots else None,
        },
        "summary":   summary,
        "snapshots": snapshots,
    }

    json_path = os.path.join(OUTPUT_DIR, f"{window_name}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)
    print(f"  Saved: {json_path}  ({os.path.getsize(json_path)//1024} KB)")

    # Summary CSV (daily, without layer detail)
    if snapshots:
        csv_rows = []
        for s in snapshots:
            row = {
                "date":               s["date"],
                "total_risk":         s["total_risk"],
                "mps":                s["mps"],
                "mss":                s["mss"],
                "state":              s["state"],
                "regime":             s["regime"],
                "regime_confidence":  s["regime_confidence"],
                "crisis_stage":       s["crisis_stage"],
                "crisis_stage_label": s["crisis_stage_label"],
                "dominant_signal":    s["dominant_signal"],
                "SPY":                s["refs"].get("SPY"),
                "QQQ":                s["refs"].get("QQQ"),
                "HYG":                s["refs"].get("HYG"),
                "VIX":                s["refs"].get("VIX"),
                "DXY":                s["refs"].get("DXY"),
                "HY_OAS":             s["refs"].get("HY_OAS"),
                "XLF":                s["refs"].get("XLF"),
            }
            # Add layer scores
            for layer_key, lv in s["layers"].items():
                row[f"L_{layer_key}"] = lv["score"]
            csv_rows.append(row)

        csv_df = pd.DataFrame(csv_rows)
        csv_path = os.path.join(OUTPUT_DIR, f"{window_name}_summary.csv")
        csv_df.to_csv(csv_path, index=False)
        print(f"  Saved: {csv_path}")


# ── Print Validation Report ────────────────────────────────────────────────────

def print_validation_report(window_name: str, summary: dict) -> None:
    """Print a human-readable validation summary."""
    print(f"\n{'='*60}")
    print(f"VALIDATION REPORT: {window_name}")
    print(f"{'='*60}")

    if not summary:
        print("  No data.")
        return

    print(f"  Trading days: {summary['trading_days']}")

    fw = summary["first_warning"]
    print(f"\n  A. FIRST WARNING DATES:")
    print(f"     Caution threshold (>30):  {fw['caution_threshold'] or 'never'}")
    print(f"     Non-Expansion regime:     {fw['non_expansion_regime'] or 'never'}")
    print(f"     Stage >= 2:               {fw['stage_2_or_higher'] or 'never'}")
    print(f"     Credit dominant:          {fw['credit_dominant'] or 'never'}")

    if "track_b_summary" in summary:
        tb = summary["track_b_summary"]
        print(f"\n  B0. TRACK B — MSS VELOCITY ALERTS:")
        print(f"     First alert date:        {tb.get('first_velocity_alert_date') or 'never'}")
        print(f"     Alert days:              {tb.get('velocity_alert_days', 0)}")
        print(f"     Peak negative velocity:  {tb.get('peak_negative_velocity')} pt  ({tb.get('peak_velocity_date')})")

    pk = summary["peak"]
    print(f"\n  B. PEAK STRESS:")
    print(f"     Date:    {pk['date']}")
    print(f"     Total:   {pk['total_risk']}/120  ({pk['state']})")
    print(f"     MPS:     {pk['mps']}/100")
    print(f"     Stage:   {pk['crisis_stage']} - {pk['crisis_stage_label']}")
    print(f"     Regime:  {pk['regime']}")
    print(f"     Dominant:{pk['dominant_signal']}")

    rd = summary["regime_distribution"]
    print(f"\n  C. REGIME DISTRIBUTION:")
    for regime, pct_val in rd["pct"].items():
        streak = rd["longest_streak"].get(regime, 0)
        print(f"     {regime:20s}: {pct_val:5.1f}%  (max streak {streak}d)")
    print(f"     First change date: {rd['first_change_date'] or 'none'}")
    print(f"     Change count:      {rd['change_count']}")

    st = summary["stage_transitions"]
    print(f"\n  D. STAGE TRANSITIONS ({len(st)} transitions):")
    for t in st[:10]:  # show first 10
        print(f"     {t['date']}  Stage {t['stage']} - {t['label']}")
    if len(st) > 10:
        print(f"     ... +{len(st)-10} more")
    print(f"     Max consecutive days at Stage >= 4: {summary['max_high_stage_days']}")

    dd = summary["dominant_distribution"]
    print(f"\n  E. DOMINANT SIGNAL:")
    for sig, pct_val in sorted(dd["pct"].items(), key=lambda x: -x[1]):
        print(f"     {sig:28s}: {pct_val:5.1f}%")
    print(f"     First dominant:   {dd['first_dominant']}")
    print(f"     At peak:          {dd['at_peak']}")
    print(f"     Signal changes:   {dd['change_count']}")

    dg = summary["data_gap_summary"]
    if dg["layers_with_gaps"]:
        print(f"\n  F. DATA GAPS (layers with missing data):")
        for layer in dg["layers_with_gaps"]:
            cnt = dg["gap_day_counts"].get(layer, 0)
            print(f"     {layer}: {cnt} days with score=0")
    else:
        print(f"\n  F. DATA GAPS: None (all layers have full coverage)")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    # Parse optional window argument: py build_replay_v1.py [window_name]
    target_window = sys.argv[1] if len(sys.argv) > 1 else None

    # Load all series once
    series     = load_all_series()
    mss_history = compute_mss_history(series["qqq"])
    print(f"\nMSS history: {len(mss_history)} dates  {mss_history.index[0].date()} → {mss_history.index[-1].date()}")

    # Run each window
    for window_name, (start_date, end_date) in REPLAY_WINDOWS.items():
        if target_window and window_name != target_window:
            continue

        end = end_date or datetime.now().strftime("%Y-%m-%d")
        print(f"\n{'='*60}")
        print(f"REPLAY: {window_name}  ({start_date} → {end})")
        print(f"{'='*60}")

        snapshots = build_replay_series(window_name, start_date, end, series, mss_history)
        summary   = summarize_replay(snapshots)
        save_replay(window_name, snapshots, summary)
        print_validation_report(window_name, summary)

    print(f"\nAll replay outputs saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
