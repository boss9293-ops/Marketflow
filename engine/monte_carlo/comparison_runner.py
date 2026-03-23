"""
engine/monte_carlo/comparison_runner.py
=========================================
Run multiple strategies on the same set of Monte Carlo paths and produce
a side-by-side comparison table.

Primary entry point
-------------------
compare_strategies(paths, strategies) -> ComparisonResult

CLI usage
---------
python -m engine.monte_carlo.comparison_runner         # 200 paths x 5yr default
python -m engine.monte_carlo.comparison_runner 500 10  # 500 paths x 10yr
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .runner     import run_monte_carlo, MonteCarloResult, TRADING_DAYS_PER_YEAR
from .regime_engine import Regime, generate_regime_series
from .crash_generator import generate_price_volume_path
from .benchmarks import StrategySpec, StrategyName, DEFAULT_STRATEGIES
from .metrics    import PathMetrics


# ---------------------------------------------------------------------------
# Per-strategy aggregate stats
# ---------------------------------------------------------------------------

@dataclass
class StrategyStats:
    """Aggregate statistics for one strategy across all paths."""
    name:                str
    description:         str

    survival_rate:       float = 0.0
    terminal_nav_median: float = 0.0
    terminal_nav_mean:   float = 0.0
    terminal_nav_p10:    float = 0.0
    terminal_nav_p90:    float = 0.0
    max_dd_median:       float = 0.0
    max_dd_p10:          float = 0.0    # worst decile
    recovery_rate:       float = 0.0
    recovery_days_mean:  float = float("nan")
    mean_ladder_steps:   float = 0.0

    # raw distributions
    terminal_nav_dist:   np.ndarray = field(default_factory=lambda: np.array([]))
    max_dd_dist:         np.ndarray = field(default_factory=lambda: np.array([]))

    elapsed: float = 0.0


# ---------------------------------------------------------------------------
# Comparison result
# ---------------------------------------------------------------------------

@dataclass
class ComparisonResult:
    """Results from compare_strategies()."""
    n_paths:  int
    years:    float
    stats:    list[StrategyStats] = field(default_factory=list)
    elapsed:  float = 0.0


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def compare_strategies(
    n_paths:    int              = 200,
    years:      float            = 5.0,
    strategies: Optional[list[StrategySpec]] = None,
    initial_regime: Regime       = Regime.NORMAL,
    base_volume: float           = 1_000_000.0,
    seed_offset: int             = 0,
) -> ComparisonResult:
    """
    Generate `n_paths` regime-driven paths then run each strategy on every path.

    All strategies see the same paths, so differences reflect strategy
    performance, not path luck.

    Parameters
    ----------
    n_paths        : number of Monte Carlo paths
    years          : simulation horizon in years
    strategies     : list of StrategySpec; None = DEFAULT_STRATEGIES
    initial_regime : starting regime for all paths
    base_volume    : baseline daily volume in NORMAL regime
    seed_offset    : added to path index for RNG seed

    Returns
    -------
    ComparisonResult with one StrategyStats entry per strategy
    """
    if strategies is None:
        strategies = DEFAULT_STRATEGIES

    length_days = int(round(years * TRADING_DAYS_PER_YEAR))
    t0          = time.perf_counter()

    # ------------------------------------------------------------------ #
    # Generate paths once (shared across all strategies)
    # ------------------------------------------------------------------ #
    print(f"Generating {n_paths} paths x {years:.0f}yr ...")
    path_tuples = []
    for i in range(n_paths):
        seed          = seed_offset + i
        regime_series = generate_regime_series(length_days, initial_regime, seed=seed)
        pd_           = generate_price_volume_path(length_days, regime_series,
                                                   base_volume=base_volume, seed=seed)
        path_tuples.append((
            pd_.price_series,
            pd_.volume_series,
            pd_.drawdown_series,
            pd_.speed4_series,
            pd_.avgvol20_series,
        ))

    # ------------------------------------------------------------------ #
    # Run each strategy
    # ------------------------------------------------------------------ #
    all_stats = []
    for spec in strategies:
        print(f"  Running {spec.name.value} ...")
        t_start = time.perf_counter()
        results: list[PathMetrics] = []

        for (pp, vp, dd, sp4, av20) in path_tuples:
            m = spec.run(pp, vp, dd, sp4, av20)
            results.append(m)

        elapsed = time.perf_counter() - t_start
        stats   = _aggregate_strategy(spec, results, elapsed)
        all_stats.append(stats)

    total_elapsed = time.perf_counter() - t0
    return ComparisonResult(
        n_paths = n_paths,
        years   = years,
        stats   = all_stats,
        elapsed = total_elapsed,
    )


def _aggregate_strategy(
    spec:    StrategySpec,
    results: list[PathMetrics],
    elapsed: float,
) -> StrategyStats:
    N    = len(results)
    tnav = np.array([m.terminal_nav  for m in results])
    mdd  = np.array([m.max_drawdown  for m in results])
    rec  = np.array([m.recovery_days for m in results])
    lad  = np.array([m.ladder_steps_executed for m in results])
    surv = np.array([m.survival_flag for m in results])

    recovered      = rec[rec >= 0]
    recovery_rate  = len(recovered) / N
    rec_days_mean  = float(recovered.mean()) if len(recovered) > 0 else float("nan")

    return StrategyStats(
        name                = spec.name.value,
        description         = spec.description,
        survival_rate       = float(surv.mean()),
        terminal_nav_median = float(np.median(tnav)),
        terminal_nav_mean   = float(tnav.mean()),
        terminal_nav_p10    = float(np.percentile(tnav, 10)),
        terminal_nav_p90    = float(np.percentile(tnav, 90)),
        max_dd_median       = float(np.median(mdd)),
        max_dd_p10          = float(np.percentile(mdd, 10)),
        recovery_rate       = recovery_rate,
        recovery_days_mean  = rec_days_mean,
        mean_ladder_steps   = float(lad.mean()),
        terminal_nav_dist   = tnav,
        max_dd_dist         = mdd,
        elapsed             = elapsed,
    )


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def format_comparison(result: ComparisonResult) -> str:
    """Return a human-readable comparison table."""
    SEP   = "=" * 80
    SEP2  = "-" * 80
    lines = [
        SEP,
        f"  STRATEGY COMPARISON   N={result.n_paths:,} paths  horizon={result.years:.0f}yr",
        SEP,
    ]

    # column header
    col_w  = 16
    hdr    = f"  {'Metric':<28}"
    for s in result.stats:
        hdr += f" {s.name:>{col_w}}"
    lines.append(hdr)
    lines.append(SEP2)

    def row(label, fmt, getter):
        r = f"  {label:<28}"
        for s in result.stats:
            v = getter(s)
            r += f" {fmt.format(v):>{col_w}}"
        return r

    def pct(v): return f"{v*100:.1f}%"

    lines.append(row("Survival rate",       "{:.1%}",  lambda s: s.survival_rate))
    lines.append(row("Terminal NAV (median)", "{:.3f}", lambda s: s.terminal_nav_median))
    lines.append(row("Terminal NAV (mean)",  "{:.3f}",  lambda s: s.terminal_nav_mean))
    lines.append(row("Terminal NAV p10",     "{:.3f}",  lambda s: s.terminal_nav_p10))
    lines.append(row("Terminal NAV p90",     "{:.3f}",  lambda s: s.terminal_nav_p90))
    lines.append(SEP2)
    lines.append(row("Max DD (median)",      "{:.3f}",  lambda s: s.max_dd_median))
    lines.append(row("Max DD worst decile",  "{:.3f}",  lambda s: s.max_dd_p10))
    lines.append(SEP2)
    lines.append(row("Recovery rate",        "{:.1%}",  lambda s: s.recovery_rate))
    lines.append(row("Recovery days (mean)", "{:.1f}",  lambda s: s.recovery_days_mean
                     if s.recovery_days_mean == s.recovery_days_mean else float("nan")))
    lines.append(SEP2)
    lines.append(row("Mean ladder steps",    "{:.2f}",  lambda s: s.mean_ladder_steps))
    lines.append(SEP2)

    lines.append(f"\n  Total elapsed: {result.elapsed:.1f}s")
    lines.append(SEP)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    n_paths = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    years   = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0

    result = compare_strategies(n_paths=n_paths, years=years)
    print(format_comparison(result))

    # basic assertions
    assert result.n_paths == n_paths
    assert len(result.stats) == 4
    for s in result.stats:
        assert 0.0 <= s.survival_rate <= 1.0
        assert len(s.terminal_nav_dist) == n_paths

    print("\nAll comparison_runner smoke tests passed.")
