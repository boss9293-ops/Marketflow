"""
engine/monte_carlo/runner.py
============================
Long-horizon Monte Carlo runner for the VR Leveraged ETF Survival Lab.

Generates regime-driven price/volume paths (via regime_engine +
crash_generator) and feeds each path through the VR strategy simulator.

Recovery Tail Extension
-----------------------
If a path ends with drawdown < -10% OR a recent crash event (within last 252d),
a 252-day NORMAL-regime tail is automatically appended.  The tail uses:
  - no crash injection
  - NORMAL drift and volatility
  - volume consistent with NORMAL regime

This removes endpoint bias from recovery metric measurement.

Primary entry point
-------------------
run_monte_carlo(n_paths, years, ...) -> MonteCarloResult

CLI usage
---------
python -m engine.monte_carlo.runner          # 200 paths x 5yr
python -m engine.monte_carlo.runner 1000 5   # 1000 paths x 5yr
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .regime_engine import (
    Regime,
    RegimeConfig,
    DEFAULT_REGIME_CONFIGS,
    generate_regime_series,
)
from .crash_generator import generate_price_volume_path, PathData
from .simulator       import run_single_path
from .metrics         import PathMetrics, compute_recovery_metrics


# ---------------------------------------------------------------------------
# Per-path summary
# ---------------------------------------------------------------------------

@dataclass
class PathSummary:
    """Compact per-path record stored in MonteCarloResult."""
    seed:           int
    survived:       bool
    pool_exhausted: bool
    terminal_nav:   float
    max_drawdown:   float
    recovery_days:  int
    crash_events:   int
    ladder_steps:   int
    days_normal:    int
    days_correction: int
    days_crisis:    int
    had_tail:       bool   = False    # True if recovery tail was appended
    original_length: int  = 0

    # recovery metrics
    is_censored:           bool  = False
    recovery_6m_return:    float = float("nan")
    recovery_12m_return:   float = float("nan")
    days_to_recover_50pct: int   = -1
    days_to_recover_peak:  int   = -1

    nav_series: np.ndarray = field(repr=False, default_factory=lambda: np.array([]))


# ---------------------------------------------------------------------------
# Aggregate result
# ---------------------------------------------------------------------------

@dataclass
class MonteCarloResult:
    """
    Aggregate statistics from run_monte_carlo().
    All distribution arrays are 1-D numpy arrays of length n_paths.
    """
    n_paths:  int
    years:    float

    # --- summary records ---
    paths: list[PathSummary] = field(default_factory=list)

    # --- distributions ---
    terminal_nav_dist:  np.ndarray = field(default_factory=lambda: np.array([]))
    max_drawdown_dist:  np.ndarray = field(default_factory=lambda: np.array([]))
    recovery_days_dist: np.ndarray = field(default_factory=lambda: np.array([]))
    crash_count_dist:   np.ndarray = field(default_factory=lambda: np.array([]))
    ladder_step_dist:   np.ndarray = field(default_factory=lambda: np.array([]))

    # regime fractions (mean across paths)
    mean_frac_normal:     float = 0.0
    mean_frac_correction: float = 0.0
    mean_frac_crisis:     float = 0.0

    # --- scalar survival/performance aggregates ---
    survival_rate:          float = 0.0
    pool_exhaustion_rate:   float = 0.0
    bottom_capture_rate:    float = 0.0

    terminal_nav_mean:      float = 0.0
    terminal_nav_median:    float = 0.0
    terminal_nav_p10:       float = 0.0
    terminal_nav_p25:       float = 0.0
    terminal_nav_p75:       float = 0.0
    terminal_nav_p90:       float = 0.0

    max_dd_mean:            float = 0.0
    max_dd_median:          float = 0.0
    max_dd_p10:             float = 0.0

    recovery_rate:          float = 0.0
    recovery_days_mean:     float = 0.0

    mean_crash_events:      float = 0.0
    mean_ladder_steps:      float = 0.0

    # --- recovery tail stats ---
    tail_extension_rate:    float = 0.0   # fraction of paths that got a tail

    # --- right-censoring ---
    censored_path_rate:     float = 0.0

    # --- recovery metrics (median across paths) ---
    recovery_6m_return_median:          float = float("nan")
    recovery_12m_return_median:         float = float("nan")
    bottom_to_recovery_return_median:   float = float("nan")
    days_to_recover_50pct_median:       float = float("nan")
    days_to_recover_peak_median:        float = float("nan")
    recovery_50pct_rate:                float = 0.0   # fraction that reached +50%
    recovery_peak_rate:                 float = 0.0   # fraction that reached new peak

    # runtime
    elapsed_gen:   float = 0.0
    elapsed_sim:   float = 0.0
    elapsed_total: float = 0.0


# ---------------------------------------------------------------------------
# Recovery tail helpers
# ---------------------------------------------------------------------------

TRADING_DAYS_PER_YEAR = 252
_TAIL_CHECK_WINDOW    = 252   # "recent" crash = crash within last 252d of path


def _needs_tail_extension(pd_: PathData) -> bool:
    """Return True if this path should receive a NORMAL-regime recovery tail."""
    T = len(pd_.price_series)
    if T == 0:
        return False

    # Condition 1: final drawdown < -10%
    if len(pd_.drawdown_series) > 0 and pd_.drawdown_series[-1] < -0.10:
        return True

    # Condition 2: a crash event ended within the last 252 trading days
    recent_threshold = max(0, T - _TAIL_CHECK_WINDOW)
    for ev in pd_.crash_events:
        if ev.end_day >= recent_threshold:
            return True

    return False


def _build_recovery_tail(
    pd_:       PathData,
    tail_days: int,
    seed:      int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Append a NORMAL-regime, crash-free tail to the existing path arrays.

    Returns
    -------
    (full_price, full_volume, full_drawdown, full_speed4, full_avgvol20)
    All arrays have length len(pd_.price_series) + tail_days.
    """
    rng = np.random.default_rng(seed)

    normal_cfg  = DEFAULT_REGIME_CONFIGS[Regime.NORMAL]
    drift_daily = normal_cfg.drift_daily
    vol_daily   = normal_cfg.vol_daily

    # Simple GBM for tail (no GARCH, no crashes — intentionally plain)
    tail_returns = drift_daily + vol_daily * rng.standard_normal(tail_days)
    last_price   = float(pd_.price_series[-1])
    tail_prices  = last_price * np.cumprod(
        1.0 + np.clip(tail_returns, -0.99, 10.0)
    )

    # Tail volume: log-normal around last observed volume
    last_vol    = float(pd_.volume_series[-1])
    tail_volume = np.maximum(
        last_vol * np.exp(rng.normal(0, 0.25, tail_days)),
        last_vol * 0.10,
    )

    # Concatenate
    full_price  = np.concatenate([pd_.price_series,  tail_prices])
    full_volume = np.concatenate([pd_.volume_series, tail_volume])
    T_full      = len(full_price)

    # Recompute derived series over full path (vectorised where possible)
    rolling_peak = np.maximum.accumulate(full_price)
    full_dd      = (full_price / rolling_peak) - 1.0

    full_sp4 = np.zeros(T_full)
    full_sp4[4:] = (full_price[4:] / full_price[:-4]) - 1.0

    # avgvol20 via sliding window (vectorised)
    full_av20 = np.zeros(T_full)
    if T_full >= 20:
        # stride_tricks approach -- pad to avoid import complexity
        cumvol = np.concatenate([[0.0], np.cumsum(full_volume)])
        for t in range(20, T_full):
            full_av20[t] = (cumvol[t] - cumvol[t - 20]) / 20.0

    return full_price, full_volume, full_dd, full_sp4, full_av20


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_monte_carlo(
    n_paths:            int   = 200,
    years:              float = 5.0,
    initial_regime:     Regime = Regime.NORMAL,
    initial_pool_ratio: float = 0.10,
    base_volume:        float = 1_000_000.0,
    recovery_tail_days: int   = 252,
    seed_offset:        int   = 0,
) -> MonteCarloResult:
    """
    Run `n_paths` independent regime-driven simulations of `years` length,
    with automatic recovery tail extension for paths ending mid-crash.

    Parameters
    ----------
    n_paths            : number of Monte Carlo paths
    years              : simulation horizon in years
    initial_regime     : Markov chain starting regime for all paths
    initial_pool_ratio : crash pool starting fraction of portfolio NAV
    base_volume        : baseline daily volume in NORMAL regime
    recovery_tail_days : days to append when path ends mid-crash (0 = disable)
    seed_offset        : add to path index to get each path's RNG seed

    Returns
    -------
    MonteCarloResult with per-path PathSummary list and aggregate stats
    """
    length_days = int(round(years * TRADING_DAYS_PER_YEAR))
    result      = MonteCarloResult(n_paths=n_paths, years=years)
    summaries:  list[PathSummary] = []

    # ------------------------------------------------------------------ #
    # Phase 1: Generate paths
    # ------------------------------------------------------------------ #
    t0 = time.perf_counter()

    path_data = []
    for i in range(n_paths):
        seed          = seed_offset + i
        regime_series = generate_regime_series(length_days, initial_regime, seed=seed)
        pd_           = generate_price_volume_path(
            length_days=length_days,
            regime_series=regime_series,
            base_volume=base_volume,
            seed=seed,
        )
        path_data.append((pd_, regime_series))

    result.elapsed_gen = time.perf_counter() - t0

    # ------------------------------------------------------------------ #
    # Phase 2: Simulate (with optional tail extension)
    # ------------------------------------------------------------------ #
    t1         = time.perf_counter()
    n_tailed   = 0

    for i, (pd_, regime_series) in enumerate(path_data):
        seed            = seed_offset + i
        original_length = len(pd_.price_series)

        # --- recovery tail extension ---
        had_tail = (
            recovery_tail_days > 0
            and _needs_tail_extension(pd_)
        )
        if had_tail:
            n_tailed += 1
            full_price, full_volume, full_dd, full_sp4, full_av20 = (
                _build_recovery_tail(pd_, recovery_tail_days, seed=seed + 9_999_999)
            )
        else:
            full_price  = pd_.price_series
            full_volume = pd_.volume_series
            full_dd     = pd_.drawdown_series
            full_sp4    = pd_.speed4_series
            full_av20   = pd_.avgvol20_series

        # --- run simulator on (possibly extended) path ---
        metrics: PathMetrics = run_single_path(
            price_path       = full_price,
            volume_path      = full_volume,
            drawdown_series  = full_dd,
            speed4_series    = full_sp4,
            avgvol20_series  = full_av20,
            initial_pool_ratio = initial_pool_ratio,
        )
        metrics.original_length = original_length

        # --- recovery metrics ---
        compute_recovery_metrics(metrics)

        # --- regime fractions ---
        days_n = sum(1 for s in regime_series if s.regime == Regime.NORMAL)
        days_c = sum(1 for s in regime_series if s.regime == Regime.CORRECTION)
        days_k = sum(1 for s in regime_series if s.regime == Regime.CRISIS)

        summary = PathSummary(
            seed             = seed,
            survived         = metrics.survival_flag,
            pool_exhausted   = metrics.pool_exhausted_flag,
            terminal_nav     = metrics.terminal_nav,
            max_drawdown     = metrics.max_drawdown,
            recovery_days    = metrics.recovery_days,
            crash_events     = metrics.crash_events,
            ladder_steps     = metrics.ladder_steps_executed,
            days_normal      = days_n,
            days_correction  = days_c,
            days_crisis      = days_k,
            had_tail         = had_tail,
            original_length  = original_length,
            is_censored      = metrics.is_censored,
            recovery_6m_return     = metrics.recovery_6m_return,
            recovery_12m_return    = metrics.recovery_12m_return,
            days_to_recover_50pct  = metrics.days_to_recover_50pct,
            days_to_recover_peak   = metrics.days_to_recover_peak,
            nav_series       = metrics.nav_series,
        )
        summaries.append(summary)

    result.elapsed_sim   = time.perf_counter() - t1
    result.elapsed_total = result.elapsed_gen + result.elapsed_sim
    result.paths         = summaries
    result.tail_extension_rate = n_tailed / n_paths if n_paths > 0 else 0.0

    # ------------------------------------------------------------------ #
    # Phase 3: Aggregate
    # ------------------------------------------------------------------ #
    _compute_aggregates(result)

    return result


# ---------------------------------------------------------------------------
# Aggregate helper
# ---------------------------------------------------------------------------

def _nan_median(arr: np.ndarray) -> float:
    valid = arr[~np.isnan(arr)]
    return float(np.median(valid)) if len(valid) > 0 else float("nan")


def _compute_aggregates(result: MonteCarloResult) -> None:
    paths = result.paths
    N     = len(paths)
    if N == 0:
        return

    tnav    = np.array([p.terminal_nav    for p in paths])
    mdd     = np.array([p.max_drawdown    for p in paths])
    rec     = np.array([p.recovery_days   for p in paths])
    crashes = np.array([p.crash_events    for p in paths])
    ladder  = np.array([p.ladder_steps    for p in paths])

    result.terminal_nav_dist  = tnav
    result.max_drawdown_dist  = mdd
    result.recovery_days_dist = rec
    result.crash_count_dist   = crashes
    result.ladder_step_dist   = ladder

    # regime fractions
    total_days = result.years * TRADING_DAYS_PER_YEAR
    result.mean_frac_normal     = np.mean([p.days_normal     for p in paths]) / total_days
    result.mean_frac_correction = np.mean([p.days_correction for p in paths]) / total_days
    result.mean_frac_crisis     = np.mean([p.days_crisis     for p in paths]) / total_days

    # survival
    result.survival_rate        = float(np.mean([p.survived       for p in paths]))
    result.pool_exhaustion_rate = float(np.mean([p.pool_exhausted for p in paths]))
    result.bottom_capture_rate  = float(np.mean([p.ladder_steps > 0 for p in paths]))

    # terminal NAV
    result.terminal_nav_mean   = float(tnav.mean())
    result.terminal_nav_median = float(np.median(tnav))
    result.terminal_nav_p10    = float(np.percentile(tnav, 10))
    result.terminal_nav_p25    = float(np.percentile(tnav, 25))
    result.terminal_nav_p75    = float(np.percentile(tnav, 75))
    result.terminal_nav_p90    = float(np.percentile(tnav, 90))

    # max drawdown
    result.max_dd_mean   = float(mdd.mean())
    result.max_dd_median = float(np.median(mdd))
    result.max_dd_p10    = float(np.percentile(mdd, 10))

    # recovery (original definition: NAV back to starting value)
    recovered = rec[rec >= 0]
    result.recovery_rate      = len(recovered) / N
    result.recovery_days_mean = float(recovered.mean()) if len(recovered) > 0 else float("nan")

    # activity
    result.mean_crash_events = float(crashes.mean())
    result.mean_ladder_steps = float(ladder.mean())

    # censoring
    result.censored_path_rate = float(np.mean([p.is_censored for p in paths]))

    # recovery metrics (medians, only paths where metric was reached)
    rec6m  = np.array([p.recovery_6m_return    for p in paths], dtype=float)
    rec12m = np.array([p.recovery_12m_return   for p in paths], dtype=float)
    d50    = np.array([p.days_to_recover_50pct for p in paths], dtype=float)
    dpk    = np.array([p.days_to_recover_peak  for p in paths], dtype=float)

    d50[d50 < 0]  = float("nan")   # convert sentinel -1 to NaN for median
    dpk[dpk < 0]  = float("nan")

    result.recovery_6m_return_median        = _nan_median(rec6m)
    result.recovery_12m_return_median       = _nan_median(rec12m)
    result.days_to_recover_50pct_median     = _nan_median(d50)
    result.days_to_recover_peak_median      = _nan_median(dpk)

    result.recovery_50pct_rate = float(
        np.mean([p.days_to_recover_50pct >= 0 for p in paths])
    )
    result.recovery_peak_rate = float(
        np.mean([p.days_to_recover_peak >= 0 for p in paths])
    )


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _fmt_nan(v: float, fmt: str = ".3f") -> str:
    if v != v:
        return "n/a"
    return format(v, fmt)


def format_result(result: MonteCarloResult) -> str:
    """Return a human-readable text summary of a MonteCarloResult."""
    r   = result
    N   = r.n_paths
    SEP = "=" * 70

    def bar(val, total=N, width=28):
        filled = int(round(val / total * width)) if total > 0 else 0
        pct    = val / total * 100 if total > 0 else 0.0
        return f"[{'#'*filled}{'.'*(width-filled)}]  {pct:5.1f}%  ({val:,})"

    def pct(f): return f"{f*100:.1f}%"

    lines = [
        SEP,
        f"  MONTE CARLO RESULTS   N={N:,} paths  horizon={r.years:.0f}yr",
        SEP,
        "",
        "[REGIME FRACTIONS  (mean across paths)]",
        f"  NORMAL      {pct(r.mean_frac_normal):>7}",
        f"  CORRECTION  {pct(r.mean_frac_correction):>7}",
        f"  CRISIS      {pct(r.mean_frac_crisis):>7}",
        "",
        "[SURVIVAL]",
        f"  survival_rate       {bar(int(r.survival_rate * N))}",
        f"  pool_exhausted      {bar(int(r.pool_exhaustion_rate * N))}",
        f"  bottom_capture      {bar(int(r.bottom_capture_rate * N))}",
        "",
        "[TERMINAL NAV  (base 1.0)]",
        f"  mean   = {_fmt_nan(r.terminal_nav_mean)}    median = {_fmt_nan(r.terminal_nav_median)}",
        f"  p10    = {_fmt_nan(r.terminal_nav_p10)}    p25    = {_fmt_nan(r.terminal_nav_p25)}",
        f"  p75    = {_fmt_nan(r.terminal_nav_p75)}    p90    = {_fmt_nan(r.terminal_nav_p90)}",
        "",
        "[MAX DRAWDOWN (NAV)]",
        f"  mean   = {_fmt_nan(r.max_dd_mean)}    median = {_fmt_nan(r.max_dd_median)}",
        f"  worst decile (p10) = {_fmt_nan(r.max_dd_p10)}",
        "",
        "[RECOVERY (NAV back to start)]",
        f"  recovered     {pct(r.recovery_rate):>7}  of paths",
        f"  mean days     {_fmt_nan(r.recovery_days_mean, '.1f')}",
        "",
        "[CRASH & LADDER]",
        f"  mean crash events per path : {r.mean_crash_events:.2f}",
        f"  mean ladder steps per path : {r.mean_ladder_steps:.2f}",
        "",
        "[RECOVERY TAIL EXTENSION]",
        f"  paths with tail appended : {bar(int(r.tail_extension_rate * N))}",
        "",
        "[CENSORED PATH ANALYSIS]",
        f"  censored_path_rate       : {pct(r.censored_path_rate)}",
        f"  (path ended with dd<-20%; recovery window too short)",
        "",
        "[RECOVERY METRICS  (median over paths where metric was reached)]",
        f"  recovery_6m_return         : {_fmt_nan(r.recovery_6m_return_median, '+.1%') if r.recovery_6m_return_median == r.recovery_6m_return_median else 'n/a'}",
        f"  recovery_12m_return        : {_fmt_nan(r.recovery_12m_return_median, '+.1%') if r.recovery_12m_return_median == r.recovery_12m_return_median else 'n/a'}",
        f"  days_to_recover_50pct      : {_fmt_nan(r.days_to_recover_50pct_median, '.0f')}  (rate: {pct(r.recovery_50pct_rate)})",
        f"  days_to_recover_peak       : {_fmt_nan(r.days_to_recover_peak_median, '.0f')}  (rate: {pct(r.recovery_peak_rate)})",
        "",
        "[RUNTIME]",
        f"  generation   {r.elapsed_gen:.1f}s",
        f"  simulation   {r.elapsed_sim:.1f}s",
        f"  total        {r.elapsed_total:.1f}s  ({r.elapsed_total/N*1000:.1f}ms per path)",
        SEP,
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    n_paths = int(sys.argv[1])   if len(sys.argv) > 1 else 200
    years   = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0

    print(f"Running {n_paths} paths x {years:.0f}yr (with recovery tail) ...")
    result = run_monte_carlo(n_paths=n_paths, years=years, seed_offset=0)
    print(format_result(result))

    assert result.n_paths == n_paths
    assert len(result.paths) == n_paths
    assert 0.0 <= result.survival_rate <= 1.0
    assert 0.0 <= result.censored_path_rate <= 1.0
    assert 0.0 <= result.tail_extension_rate <= 1.0
    print("\nAll runner v2 smoke tests passed.")
