"""
engine/monte_carlo/regime_engine.py
====================================
Market regime engine for the VR Leveraged ETF Survival Lab.

Generates a daily regime series via a Markov chain.
Each day is labelled NORMAL, CORRECTION, or CRISIS.
Per-regime parameters (drift, vol, crash probability) are carried in
RegimeConfig and can be fed into the crash generator in a later phase.

This module is standalone: it does NOT integrate with the simulator,
crash_generator, or state_machine.

Examples
--------
>>> from engine.monte_carlo.regime_engine import generate_regime_series, Regime
>>> series = generate_regime_series(length_days=252, seed=42)
>>> len(series)
252
>>> series[0].regime in list(Regime)
True
>>> regimes = [s.regime for s in series]
>>> Regime.NORMAL in regimes
True
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import NamedTuple, Optional

import numpy as np


# ---------------------------------------------------------------------------
# Regime enum
# ---------------------------------------------------------------------------

class Regime(Enum):
    NORMAL     = "NORMAL"
    CORRECTION = "CORRECTION"
    CRISIS     = "CRISIS"


# ---------------------------------------------------------------------------
# Per-regime configuration
# ---------------------------------------------------------------------------

@dataclass
class RegimeConfig:
    """
    Parameters governing price behaviour while a regime is active.

    All rate parameters are annualised; divide by 252 for daily use.

    Attributes
    ----------
    drift_annual        : expected annual log-return (e.g. +0.15 for +15%/yr)
    vol_annual          : annualised volatility (e.g. 0.30 for 30%/yr)
    crash_prob_annual   : expected number of crash events per year
    volume_multiplier   : volume scaling factor relative to base volume
    allowed_crash_types : crash type names permitted in this regime
                          (connected to CrashType in crash_generator at integration time)

    Derived daily values
    --------------------
    drift_daily = drift_annual / 252
    vol_daily   = vol_annual   / sqrt(252)
    """
    drift_annual:        float
    vol_annual:          float
    crash_prob_annual:   float
    volume_multiplier:   float
    allowed_crash_types: list[str] = field(default_factory=list)

    @property
    def drift_daily(self) -> float:
        return self.drift_annual / 252.0

    @property
    def vol_daily(self) -> float:
        return self.vol_annual / (252.0 ** 0.5)


# Default configs calibrated for a 3× leveraged ETF (TQQQ-class)
DEFAULT_REGIME_CONFIGS: dict[Regime, RegimeConfig] = {
    Regime.NORMAL: RegimeConfig(
        drift_annual        =  0.40,          # ~40%/yr in bull market
        vol_annual          =  0.60,          # ~60%/yr (3× underlying ~20%)
        crash_prob_annual   =  0.20,          # rare; mostly flash crashes
        volume_multiplier   =  1.0,
        allowed_crash_types = ["FLASH_CRASH"],
    ),
    Regime.CORRECTION: RegimeConfig(
        drift_annual        = -0.20,          # negative drift
        vol_annual          =  0.90,          # elevated vol
        crash_prob_annual   =  1.5,           # ~1-2 crash events/yr
        volume_multiplier   =  1.5,
        allowed_crash_types = ["FAST_PANIC", "FLASH_CRASH"],
    ),
    Regime.CRISIS: RegimeConfig(
        drift_annual        = -0.80,          # severe negative drift
        vol_annual          =  1.40,          # extreme vol
        crash_prob_annual   =  4.0,           # frequent crash events
        volume_multiplier   =  2.5,
        allowed_crash_types = ["FAST_PANIC", "SLOW_BEAR", "DOUBLE_DIP"],
    ),
}


# ---------------------------------------------------------------------------
# Markov transition matrix
# ---------------------------------------------------------------------------

# Default transition probabilities (row = from, col = to)
# Ordered: NORMAL, CORRECTION, CRISIS
_DEFAULT_TRANSITIONS: dict[Regime, dict[Regime, float]] = {
    Regime.NORMAL: {
        Regime.NORMAL:     0.90,
        Regime.CORRECTION: 0.09,
        Regime.CRISIS:     0.01,
    },
    Regime.CORRECTION: {
        Regime.NORMAL:     0.40,
        Regime.CORRECTION: 0.50,
        Regime.CRISIS:     0.10,
    },
    Regime.CRISIS: {
        Regime.NORMAL:     0.30,
        Regime.CORRECTION: 0.40,
        Regime.CRISIS:     0.30,
    },
}

# Regime order used for vectorised sampling
_REGIME_ORDER: list[Regime] = [Regime.NORMAL, Regime.CORRECTION, Regime.CRISIS]


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------

class RegimeState(NamedTuple):
    """One day's regime label plus its configuration."""
    day:    int
    regime: Regime
    config: RegimeConfig


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def next_regime(
    current:     Regime,
    rng:         np.random.Generator,
    transitions: Optional[dict[Regime, dict[Regime, float]]] = None,
) -> Regime:
    """
    Sample the next regime given the current regime.

    Parameters
    ----------
    current     : today's regime
    rng         : numpy random generator
    transitions : transition probability dict; None = default matrix

    Returns
    -------
    The next regime drawn from the transition distribution.

    Examples
    --------
    >>> import numpy as np
    >>> rng = np.random.default_rng(0)
    >>> next_regime(Regime.NORMAL, rng) in list(Regime)
    True
    """
    tm   = transitions or _DEFAULT_TRANSITIONS
    row  = tm[current]
    probs = [row[r] for r in _REGIME_ORDER]
    idx  = int(rng.choice(len(_REGIME_ORDER), p=probs))
    return _REGIME_ORDER[idx]


def generate_regime_series(
    length_days:    int,
    initial_regime: Regime = Regime.NORMAL,
    transitions:    Optional[dict[Regime, dict[Regime, float]]] = None,
    configs:        Optional[dict[Regime, RegimeConfig]] = None,
    seed:           Optional[int] = None,
) -> list[RegimeState]:
    """
    Generate a daily regime series of length `length_days`.

    Each element is a RegimeState(day, regime, config) NamedTuple.
    The series begins at `initial_regime` on day 0 and evolves via
    the Markov transition matrix.

    Parameters
    ----------
    length_days    : number of trading days to generate
    initial_regime : regime on day 0 (default NORMAL)
    transitions    : transition probability dict; None = default matrix
    configs        : per-regime RegimeConfig dict; None = defaults
    seed           : random seed for reproducibility

    Returns
    -------
    list[RegimeState] of length `length_days`

    Examples
    --------
    >>> series = generate_regime_series(252, seed=0)
    >>> len(series)
    252
    >>> all(isinstance(s, RegimeState) for s in series)
    True
    """
    rng    = np.random.default_rng(seed)
    tm     = transitions or _DEFAULT_TRANSITIONS
    cfgs   = configs     or DEFAULT_REGIME_CONFIGS

    series: list[RegimeState] = []
    current = initial_regime

    for day in range(length_days):
        series.append(RegimeState(day=day, regime=current, config=cfgs[current]))
        if day < length_days - 1:
            current = next_regime(current, rng, tm)

    return series


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

def regime_counts(series: list[RegimeState]) -> dict[str, int]:
    """Return day counts per regime."""
    counts: dict[str, int] = {r.value: 0 for r in Regime}
    for s in series:
        counts[s.regime.value] += 1
    return counts


def regime_fractions(series: list[RegimeState]) -> dict[str, float]:
    """Return fraction of days in each regime."""
    n      = max(1, len(series))
    counts = regime_counts(series)
    return {k: v / n for k, v in counts.items()}


# ---------------------------------------------------------------------------
# Smoke test (python -m engine.monte_carlo.regime_engine)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    print("=" * 56)
    print("  Regime Engine -- smoke test")
    print("=" * 56)

    # --- basic generation ---
    series = generate_regime_series(length_days=1260, seed=42)
    assert len(series) == 1260, "length mismatch"
    assert all(isinstance(s, RegimeState) for s in series)
    assert series[0].regime == Regime.NORMAL, "should start NORMAL"

    fracs = regime_fractions(series)
    print(f"\n5-year path (1260d), seed=42:")
    for name, frac in fracs.items():
        bar = "#" * int(frac * 40)
        print(f"  {name:<12} {bar:<40} {frac*100:5.1f}%")

    # --- next_regime sampling ---
    rng    = np.random.default_rng(99)
    counts = {r: 0 for r in Regime}
    N_DRAWS = 10_000
    for _ in range(N_DRAWS):
        counts[next_regime(Regime.CORRECTION, rng)] += 1

    print(f"\nnext_regime from CORRECTION ({N_DRAWS:,} draws):")
    for r, c in counts.items():
        print(f"  -> {r.value:<12} {c/N_DRAWS*100:5.1f}%  "
              f"(expected: NORMAL 40%  CORRECTION 50%  CRISIS 10%)")

    # --- reproducibility ---
    s1 = generate_regime_series(252, seed=7)
    s2 = generate_regime_series(252, seed=7)
    assert [s.regime for s in s1] == [s.regime for s in s2], "not reproducible"
    print("\nReproducibility: OK")

    # --- regime configs ---
    print("\nRegime configs (annualised):")
    for regime, cfg in DEFAULT_REGIME_CONFIGS.items():
        print(f"  {regime.value:<12}  drift={cfg.drift_annual:+.0%}  "
              f"vol={cfg.vol_annual:.0%}  crash/yr={cfg.crash_prob_annual:.1f}  "
              f"vol_mult={cfg.volume_multiplier:.1f}x  "
              f"types={cfg.allowed_crash_types}")

    # --- per-day access ---
    day100 = series[100]
    print(f"\nDay 100: regime={day100.regime.value}  "
          f"drift_daily={day100.config.drift_daily:+.5f}  "
          f"vol_daily={day100.config.vol_daily:.5f}")

    # --- validate transition matrix rows sum to 1 ---
    for regime, row in _DEFAULT_TRANSITIONS.items():
        total = sum(row.values())
        assert abs(total - 1.0) < 1e-9, f"{regime} row sums to {total}"
    print("\nTransition matrix row sums: OK")

    print("\nAll smoke tests passed.")
    print("=" * 56)
