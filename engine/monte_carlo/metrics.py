"""
engine/monte_carlo/metrics.py
==============================
Per-path output metrics for the VR Leveraged ETF Survival Lab.

Based on: docs/MONTE_CARLO_SIMULATION_CONTRACT.md, Section 5.

PathMetrics holds the raw simulation output from run_single_path().
compute_extended_metrics() derives 7 strategy-behaviour metrics.
compute_recovery_metrics()  derives 5 post-crash recovery metrics.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np


# ---------------------------------------------------------------------------
# Core per-path metrics (produced by run_single_path)
# ---------------------------------------------------------------------------

@dataclass
class PathMetrics:
    """
    Collected at the end of a single run_single_path() call.

    Survival metrics
    ----------------
    survival_flag       : True if strategy meets survival definition at end of path
    pool_exhausted_flag : True if pool reached zero at any point

    Drawdown
    --------
    max_drawdown : most negative NAV drawdown seen (value <= 0)

    Recovery
    --------
    recovery_days : days from NAV trough to full recovery; -1 if not recovered

    Activity
    --------
    crash_events          : number of distinct crash events (CRASH_ALERT entries)
    ladder_steps_executed : total ladder steps executed across all crash events

    Terminal
    --------
    terminal_nav : final NAV normalised to starting NAV = 1.0

    Path metadata
    -------------
    original_length : trading days in the original path (before any tail extension)
    is_censored     : True if path ended with drawdown < -20% (recovery incomplete)

    Recovery metrics (computed by compute_recovery_metrics)
    -------------------------------------------------------
    recovery_6m_return         : return from bottom to bottom+126 days
    recovery_12m_return        : return from bottom to bottom+252 days
    bottom_to_recovery_return  : return from bottom to first +30% partial recovery
    days_to_recover_50pct      : days from bottom until NAV is 50% above bottom
    days_to_recover_peak       : days from bottom until new all-time-high NAV

    Extended metrics (computed by compute_extended_metrics)
    -------------------------------------------------------
    bottom_capture_profit    : total profit booked from ladder buys
    pool_efficiency          : ratio of pool deployed vs pool accumulated
    reserve_breach_rate      : fraction of time steps where pool < reserve_ratio
    survival_stress_score    : fraction of days NAV spent below 0.50 initial NAV
    actionability_score      : fraction of crash events where >=1 ladder step executed
    crash_response_delay     : mean days from crash_alert to first ladder step
    recovery_participation   : fraction of crashes followed by positive NAV recovery
    """
    # --- primary survival ---
    survival_flag:       bool = False
    pool_exhausted_flag: bool = False

    # --- drawdown ---
    max_drawdown: float = 0.0

    # --- recovery ---
    recovery_days: int = -1

    # --- activity ---
    crash_events:          int = 0
    ladder_steps_executed: int = 0

    # --- terminal ---
    terminal_nav: float = 1.0

    # --- time series ---
    nav_series:   np.ndarray = field(default_factory=lambda: np.array([]))
    state_series: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))

    # --- path metadata ---
    original_length: int  = 0     # 0 = not set (no tail extension used)
    is_censored:     bool = False  # True if ended mid-crash (dd < -20% at original end)

    # --- recovery metrics (NaN / -1 = not reached within path) ---
    recovery_6m_return:        float = float("nan")
    recovery_12m_return:       float = float("nan")
    bottom_to_recovery_return: float = float("nan")
    days_to_recover_50pct:     int   = -1
    days_to_recover_peak:      int   = -1

    # --- extended metrics (optional, filled by compute_extended_metrics) ---
    bottom_capture_profit:   float = 0.0
    pool_efficiency:         float = 0.0
    reserve_breach_rate:     float = 0.0
    survival_stress_score:   float = 0.0
    actionability_score:     float = 0.0
    crash_response_delay:    float = float("nan")
    recovery_participation:  float = 0.0


# ---------------------------------------------------------------------------
# Recovery metric computation
# ---------------------------------------------------------------------------

def compute_recovery_metrics(metrics: PathMetrics) -> None:
    """
    Fill recovery metric fields of `metrics` in-place.

    Uses metrics.nav_series and metrics.original_length.
    Must be called after run_single_path() has populated nav_series.

    Censoring
    ---------
    If original_length > 0 and the NAV drawdown at position (original_length-1)
    is below -20%, the path is marked as censored (recovery window was too short
    to observe the full recovery).

    Bottom detection
    ----------------
    The "bottom" is the day with the minimum NAV across the full path
    (including any recovery tail extension).  All recovery metrics are
    measured from this day.
    """
    nav = metrics.nav_series
    T   = len(nav)
    if T == 0:
        return

    original_end = metrics.original_length if metrics.original_length > 0 else T

    # ------------------------------------------------------------------ #
    # Censoring: was path ending with significant drawdown?
    # ------------------------------------------------------------------ #
    if original_end <= T and original_end > 0:
        nav_slice     = nav[:original_end]
        peak_at_end   = float(nav_slice.max()) if len(nav_slice) > 0 else float(nav[0])
        nav_at_end    = float(nav[original_end - 1])
        dd_at_end     = (nav_at_end / peak_at_end) - 1.0 if peak_at_end > 0 else 0.0
        metrics.is_censored = dd_at_end < -0.20

    # ------------------------------------------------------------------ #
    # Bottom detection
    # ------------------------------------------------------------------ #
    bottom_day = int(np.argmin(nav))
    bottom_nav = float(nav[bottom_day])

    if bottom_nav <= 0.0:
        return   # degenerate path; skip

    # ------------------------------------------------------------------ #
    # recovery_6m_return  (+126 trading days from bottom)
    # ------------------------------------------------------------------ #
    t_6m = bottom_day + 126
    if t_6m < T:
        metrics.recovery_6m_return = float(nav[t_6m] / bottom_nav - 1.0)

    # ------------------------------------------------------------------ #
    # recovery_12m_return  (+252 trading days from bottom)
    # ------------------------------------------------------------------ #
    t_12m = bottom_day + 252
    if t_12m < T:
        metrics.recovery_12m_return = float(nav[t_12m] / bottom_nav - 1.0)

    # ------------------------------------------------------------------ #
    # bottom_to_recovery_return
    # First day after bottom where NAV has recovered +30% from bottom
    # ------------------------------------------------------------------ #
    target_30pct = bottom_nav * 1.30
    rec_zone_day = next(
        (d for d in range(bottom_day + 1, T) if nav[d] >= target_30pct),
        None,
    )
    if rec_zone_day is not None:
        metrics.bottom_to_recovery_return = float(
            nav[rec_zone_day] / bottom_nav - 1.0
        )

    # ------------------------------------------------------------------ #
    # days_to_recover_50pct
    # Days from bottom until NAV is >= bottom_nav * 1.50
    # ------------------------------------------------------------------ #
    target_50pct = bottom_nav * 1.50
    day_50 = next(
        (d for d in range(bottom_day + 1, T) if nav[d] >= target_50pct),
        None,
    )
    metrics.days_to_recover_50pct = (day_50 - bottom_day) if day_50 is not None else -1

    # ------------------------------------------------------------------ #
    # days_to_recover_peak
    # Days from bottom until NAV exceeds the all-time high before the bottom
    # ------------------------------------------------------------------ #
    pre_bottom_peak = float(nav[:bottom_day].max()) if bottom_day > 0 else float(nav[0])
    day_peak = next(
        (d for d in range(bottom_day + 1, T) if nav[d] >= pre_bottom_peak),
        None,
    )
    metrics.days_to_recover_peak = (
        (day_peak - bottom_day) if day_peak is not None else -1
    )


# ---------------------------------------------------------------------------
# Extended strategy-behaviour metric computation
# ---------------------------------------------------------------------------

# State int codes (must match engine/monte_carlo/state_machine.py)
_S0_NORMAL      = 0
_S1_CRASH_ALERT = 1
_S2_CRASH_HOLD  = 2
_S3_BOTTOM_ZONE = 3
_S4_RECOVERY    = 4
_S5_REBUILD     = 5


def compute_extended_metrics(
    metrics:        PathMetrics,
    pool_series:    np.ndarray,
    ladder_days:    list[int],
    crash_entry_days: list[int],
    reserve_ratio:  float = 0.10,
    nav_stress_threshold: float = 0.50,
) -> None:
    """
    Fill the extended metric fields of `metrics` in-place.

    Parameters
    ----------
    metrics           : PathMetrics to update
    pool_series       : daily pool-ratio array (length = path length)
    ladder_days       : sorted list of days on which a ladder buy was executed
    crash_entry_days  : sorted list of days on which crash-alert state was entered
    reserve_ratio     : pool reserve floor (from PoolConfig.reserve_ratio)
    nav_stress_threshold : fraction of starting NAV below which counts as stress
    """
    nav   = metrics.nav_series
    state = metrics.state_series
    T     = len(nav)

    if T == 0:
        return

    # ---- 1. bottom_capture_profit ----
    profit = 0.0
    if len(ladder_days) > 0 and T > 1:
        for t in ladder_days:
            if t >= T - 1:
                continue
            future_exit = next(
                (d for d in range(t + 1, T) if state[d] in (_S0_NORMAL, _S5_REBUILD)),
                None,
            )
            if future_exit is not None:
                gain = (nav[future_exit] - nav[t]) / max(nav[t], 1e-6)
                profit += max(gain, 0.0)
    metrics.bottom_capture_profit = profit

    # ---- 2. pool_efficiency ----
    if len(pool_series) > 1:
        deltas      = np.diff(pool_series)
        accumulated = float(deltas[deltas > 0].sum())
        deployed    = float((-deltas[deltas < 0]).sum())
        metrics.pool_efficiency = (
            min(deployed / accumulated, 1.0) if accumulated > 1e-6 else 0.0
        )

    # ---- 3. reserve_breach_rate ----
    if len(pool_series) > 0:
        metrics.reserve_breach_rate = float(np.mean(pool_series < reserve_ratio))

    # ---- 4. survival_stress_score ----
    starting_nav = nav[0] if nav[0] > 0 else 1.0
    metrics.survival_stress_score = float(
        np.mean(nav < nav_stress_threshold * starting_nav)
    )

    # ---- 5. actionability_score ----
    if metrics.crash_events > 0:
        ladder_set = set(ladder_days)
        n_acted    = 0
        for entry_day in crash_entry_days:
            crash_end = entry_day
            while crash_end < T - 1 and state[crash_end + 1] in (
                _S1_CRASH_ALERT, _S2_CRASH_HOLD, _S3_BOTTOM_ZONE, _S4_RECOVERY
            ):
                crash_end += 1
            if any(entry_day <= d <= crash_end for d in ladder_set):
                n_acted += 1
        metrics.actionability_score = n_acted / metrics.crash_events
    else:
        metrics.actionability_score = float("nan")

    # ---- 6. crash_response_delay ----
    delays     = []
    ladder_set = set(ladder_days)
    for entry_day in crash_entry_days:
        crash_end = entry_day
        while crash_end < T - 1 and state[crash_end + 1] in (
            _S1_CRASH_ALERT, _S2_CRASH_HOLD, _S3_BOTTOM_ZONE, _S4_RECOVERY
        ):
            crash_end += 1
        first_step = next(
            (d for d in range(entry_day, crash_end + 1) if d in ladder_set),
            None,
        )
        if first_step is not None:
            delays.append(first_step - entry_day)
    metrics.crash_response_delay = float(np.mean(delays)) if delays else float("nan")

    # ---- 7. recovery_participation ----
    n_recovered = 0
    n_exited    = 0
    for entry_day in crash_entry_days:
        crash_end = entry_day
        while crash_end < T - 1 and state[crash_end + 1] in (
            _S1_CRASH_ALERT, _S2_CRASH_HOLD, _S3_BOTTOM_ZONE, _S4_RECOVERY
        ):
            crash_end += 1
        look_ahead = crash_end + 30
        if look_ahead < T:
            n_exited += 1
            if nav[look_ahead] > nav[crash_end]:
                n_recovered += 1
    metrics.recovery_participation = (
        n_recovered / n_exited if n_exited > 0 else float("nan")
    )


# ---------------------------------------------------------------------------
# Aggregate across many PathMetrics
# ---------------------------------------------------------------------------

def aggregate_extended(all_metrics: list[PathMetrics]) -> dict[str, float]:
    """Compute mean of each extended metric across a list of PathMetrics."""
    fields = [
        "bottom_capture_profit",
        "pool_efficiency",
        "reserve_breach_rate",
        "survival_stress_score",
        "actionability_score",
        "crash_response_delay",
        "recovery_participation",
    ]
    result = {}
    for f in fields:
        vals  = [getattr(m, f) for m in all_metrics]
        valid = [v for v in vals if v == v]   # filter NaN
        result[f] = float(np.mean(valid)) if valid else float("nan")
    return result


def aggregate_recovery(all_metrics: list[PathMetrics]) -> dict[str, float]:
    """Compute median of each recovery metric across a list of PathMetrics."""
    rec_6m  = [m.recovery_6m_return       for m in all_metrics]
    rec_12m = [m.recovery_12m_return      for m in all_metrics]
    btr     = [m.bottom_to_recovery_return for m in all_metrics]
    d50     = [m.days_to_recover_50pct    for m in all_metrics]
    dpk     = [m.days_to_recover_peak     for m in all_metrics]
    cens    = [m.is_censored              for m in all_metrics]

    def _nan_median(vals):
        valid = [v for v in vals if v == v and v >= 0]
        return float(np.median(valid)) if valid else float("nan")

    def _nan_median_float(vals):
        valid = [v for v in vals if v == v]
        return float(np.median(valid)) if valid else float("nan")

    def _reach_rate(vals, sentinel):
        total = len(vals)
        return sum(1 for v in vals if v != sentinel and v == v) / max(1, total)

    return {
        "recovery_6m_return_median":         _nan_median_float(rec_6m),
        "recovery_12m_return_median":        _nan_median_float(rec_12m),
        "bottom_to_recovery_return_median":  _nan_median_float(btr),
        "days_to_recover_50pct_median":      _nan_median(d50),
        "days_to_recover_peak_median":       _nan_median(dpk),
        "recovery_50pct_rate":               _reach_rate(d50, -1),
        "recovery_peak_rate":                _reach_rate(dpk, -1),
        "censored_path_rate":                sum(cens) / max(1, len(cens)),
    }
