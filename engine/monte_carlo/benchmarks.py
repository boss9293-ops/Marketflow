"""
engine/monte_carlo/benchmarks.py
=================================
Strategy definitions for the VR Leveraged ETF Survival Lab comparison.

Four strategies are defined here:
  VR_SURVIVAL    -- full VR strategy (default config)
  DCA            -- dollar-cost averaging; buy a fixed fraction every N days
  DD_LADDER_ONLY -- drawdown-triggered ladder buys only; no pool / state machine
  MA200_FILTER   -- hold when price > MA200; exit to cash when below

Each strategy is represented by a StrategySpec dataclass that carries the
parameters needed by comparison_runner.py to drive run_single_path() or a
custom simulation loop.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Callable, Optional

import numpy as np

from .strategy_config import CrashConfig, BottomConfig, LadderConfig, PoolConfig
from .metrics         import PathMetrics
from .simulator       import run_single_path


# ---------------------------------------------------------------------------
# Strategy enum
# ---------------------------------------------------------------------------

class StrategyName(Enum):
    VR_SURVIVAL    = "VR_SURVIVAL"
    DCA            = "DCA"
    DD_LADDER_ONLY = "DD_LADDER_ONLY"
    MA200_FILTER   = "MA200_FILTER"


# ---------------------------------------------------------------------------
# Strategy specification
# ---------------------------------------------------------------------------

@dataclass
class StrategySpec:
    """
    Complete specification for one strategy.

    `run` is a callable that accepts the standard 5 path arrays and returns
    a PathMetrics.  It is set up at construction time by each factory function.
    """
    name:        StrategyName
    description: str
    run:         Callable[..., PathMetrics] = field(repr=False)


# ---------------------------------------------------------------------------
# VR_SURVIVAL -- default full strategy
# ---------------------------------------------------------------------------

def vr_survival_spec(
    crash_cfg:          Optional[CrashConfig]  = None,
    bottom_cfg:         Optional[BottomConfig] = None,
    ladder_cfg:         Optional[LadderConfig] = None,
    pool_cfg:           Optional[PoolConfig]   = None,
    initial_pool_ratio: float = 0.10,
) -> StrategySpec:
    """Full VR strategy with default or custom parameters."""

    def _run(price_path, volume_path, drawdown_series, speed4_series, avgvol20_series):
        return run_single_path(
            price_path       = price_path,
            volume_path      = volume_path,
            drawdown_series  = drawdown_series,
            speed4_series    = speed4_series,
            avgvol20_series  = avgvol20_series,
            crash_cfg        = crash_cfg,
            bottom_cfg       = bottom_cfg,
            ladder_cfg       = ladder_cfg,
            pool_cfg         = pool_cfg,
            initial_pool_ratio = initial_pool_ratio,
        )

    return StrategySpec(
        name        = StrategyName.VR_SURVIVAL,
        description = "Full VR strategy: pool + state machine + ladder buys",
        run         = _run,
    )


# ---------------------------------------------------------------------------
# DCA -- buy a fixed fraction every `interval_days` trading days
# ---------------------------------------------------------------------------

def dca_spec(
    buy_fraction:   float = 0.02,     # fraction of current NAV to invest each interval
    interval_days:  int   = 21,       # ~monthly
    initial_nav:    float = 1.0,
) -> StrategySpec:
    """Dollar-cost averaging: invest buy_fraction of NAV every interval_days."""

    def _run(price_path, volume_path, drawdown_series, speed4_series, avgvol20_series):
        T   = len(price_path)
        nav = np.empty(T)
        nav[0] = initial_nav

        # simple model: NAV tracks price_path return, plus periodic buys
        # buy = add buy_fraction * nav to position (increases exposure)
        for t in range(1, T):
            daily_ret  = price_path[t] / price_path[t - 1] - 1.0
            nav[t]     = nav[t - 1] * (1.0 + daily_ret)
            if t % interval_days == 0:
                # "buy" by increasing nav position (simplified: just track gross NAV)
                nav[t] *= (1.0 + buy_fraction)

        terminal_nav = float(nav[-1] / initial_nav)
        rolling_peak  = np.maximum.accumulate(nav)
        dd_nav        = (nav / rolling_peak) - 1.0
        max_dd        = float(dd_nav.min())

        # recovery: first day nav >= nav[0] after the trough
        trough_day = int(np.argmin(nav))
        rec_day    = next(
            (d for d in range(trough_day, T) if nav[d] >= initial_nav),
            -1,
        )
        recovery_days = (rec_day - trough_day) if rec_day >= 0 else -1

        m = PathMetrics(
            survival_flag       = terminal_nav > 0.5,
            pool_exhausted_flag = False,
            max_drawdown        = max_dd,
            recovery_days       = recovery_days,
            crash_events        = 0,
            ladder_steps_executed = int(T // interval_days),
            terminal_nav        = terminal_nav,
            nav_series          = nav,
        )
        return m

    return StrategySpec(
        name        = StrategyName.DCA,
        description = f"DCA: buy {buy_fraction*100:.0f}% of NAV every {interval_days}d",
        run         = _run,
    )


# ---------------------------------------------------------------------------
# DD_LADDER_ONLY -- drawdown-triggered ladder without state machine or pool
# ---------------------------------------------------------------------------

def dd_ladder_only_spec(
    levels:      list[float] = [-0.20, -0.25, -0.30, -0.35, -0.40],
    weights:     list[float] = [0.20, 0.20, 0.20, 0.20, 0.20],
    initial_nav: float = 1.0,
) -> StrategySpec:
    """
    Ladder buys at fixed drawdown levels from all-time high,
    no pool, no state machine.  Resets after price recovers above prior peak.
    """

    def _run(price_path, volume_path, drawdown_series, speed4_series, avgvol20_series):
        T          = len(price_path)
        nav        = np.empty(T)
        nav[0]     = initial_nav
        cash       = 0.0
        total_cash_committed = 0.0

        bought_at  = set()   # which levels have been triggered in current drawdown cycle
        cycle_peak = price_path[0]
        ladder_steps = 0

        for t in range(1, T):
            daily_ret = price_path[t] / price_path[t - 1] - 1.0
            nav[t]    = nav[t - 1] * (1.0 + daily_ret)

            current_dd = (price_path[t] / cycle_peak) - 1.0

            # check each ladder level
            for i, (lvl, wt) in enumerate(zip(levels, weights)):
                if i in bought_at:
                    continue
                if current_dd <= lvl:
                    buy_amount = nav[t] * wt
                    # simulate buy: increase nav by buy_amount (adds to position)
                    nav[t]    += buy_amount
                    bought_at.add(i)
                    ladder_steps += 1

            # reset cycle if new peak
            if price_path[t] > cycle_peak:
                cycle_peak = price_path[t]
                bought_at  = set()

        terminal_nav = float(nav[-1] / initial_nav)
        rolling_peak  = np.maximum.accumulate(nav)
        dd_nav        = (nav / rolling_peak) - 1.0
        max_dd        = float(dd_nav.min())

        trough_day    = int(np.argmin(nav))
        rec_day       = next(
            (d for d in range(trough_day, T) if nav[d] >= initial_nav),
            -1,
        )
        recovery_days = (rec_day - trough_day) if rec_day >= 0 else -1

        m = PathMetrics(
            survival_flag         = terminal_nav > 0.5,
            pool_exhausted_flag   = False,
            max_drawdown          = max_dd,
            recovery_days         = recovery_days,
            crash_events          = 0,
            ladder_steps_executed = ladder_steps,
            terminal_nav          = terminal_nav,
            nav_series            = nav,
        )
        return m

    return StrategySpec(
        name        = StrategyName.DD_LADDER_ONLY,
        description = f"DD Ladder: buys at {levels} (no pool, no state machine)",
        run         = _run,
    )


# ---------------------------------------------------------------------------
# MA200_FILTER -- hold when above MA200; move to cash when below
# ---------------------------------------------------------------------------

def ma200_filter_spec(
    ma_window:   int   = 200,
    initial_nav: float = 1.0,
    cash_yield:  float = 0.0001,   # daily risk-free return while in cash (~2.5%/yr)
) -> StrategySpec:
    """
    Long only when price > MA200; exit to cash when price crosses below MA200.
    Re-enters when price crosses back above MA200.
    """

    def _run(price_path, volume_path, drawdown_series, speed4_series, avgvol20_series):
        T   = len(price_path)
        nav = np.empty(T)
        nav[0] = initial_nav
        in_market = True   # start invested

        for t in range(1, T):
            ma200 = (price_path[max(0, t - ma_window):t].mean()
                     if t >= ma_window
                     else price_path[:t].mean())

            if in_market:
                daily_ret = price_path[t] / price_path[t - 1] - 1.0
                nav[t]    = nav[t - 1] * (1.0 + daily_ret)
                if price_path[t] < ma200:
                    in_market = False   # exit to cash
            else:
                nav[t] = nav[t - 1] * (1.0 + cash_yield)
                if price_path[t] > ma200:
                    in_market = True    # re-enter

        terminal_nav = float(nav[-1] / initial_nav)
        rolling_peak  = np.maximum.accumulate(nav)
        dd_nav        = (nav / rolling_peak) - 1.0
        max_dd        = float(dd_nav.min())

        trough_day    = int(np.argmin(nav))
        rec_day       = next(
            (d for d in range(trough_day, T) if nav[d] >= initial_nav),
            -1,
        )
        recovery_days = (rec_day - trough_day) if rec_day >= 0 else -1

        m = PathMetrics(
            survival_flag         = terminal_nav > 0.5,
            pool_exhausted_flag   = False,
            max_drawdown          = max_dd,
            recovery_days         = recovery_days,
            crash_events          = 0,
            ladder_steps_executed = 0,
            terminal_nav          = terminal_nav,
            nav_series            = nav,
        )
        return m

    return StrategySpec(
        name        = StrategyName.MA200_FILTER,
        description = f"MA200 filter: hold above MA{ma_window}, cash below",
        run         = _run,
    )


# ---------------------------------------------------------------------------
# Default strategy set
# ---------------------------------------------------------------------------

DEFAULT_STRATEGIES: list[StrategySpec] = [
    vr_survival_spec(),
    dca_spec(),
    dd_ladder_only_spec(),
    ma200_filter_spec(),
]
