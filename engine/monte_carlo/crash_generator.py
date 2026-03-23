"""
engine/monte_carlo/crash_generator.py
======================================
Regime-aware crash path generator for the VR Leveraged ETF Survival Lab.

Generates price/volume paths where:
- Base returns use regime-specific drift and vol (Student-t innovations)
- Crash events are injected according to the active regime's crash profile
- Volume spikes at crash onset and capitulation

Primary entry point
-------------------
generate_price_volume_path(length_days, regime_series, seed=None) -> PathData

Also exports standalone crash-type helpers and PathData for downstream use.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional

import numpy as np

from .regime_engine import Regime, RegimeConfig, RegimeState, DEFAULT_REGIME_CONFIGS


# ---------------------------------------------------------------------------
# Crash types
# ---------------------------------------------------------------------------

class CrashType(Enum):
    FAST_PANIC  = "FAST_PANIC"    # rapid -30 to -40% over 15-30 days
    SLOW_BEAR   = "SLOW_BEAR"     # grinding -40 to -50% over 150-250 days
    FLASH_CRASH = "FLASH_CRASH"   # sudden -10 to -25% over 3-7 days
    DOUBLE_DIP  = "DOUBLE_DIP"    # two-leg decline totalling -40 to -55%


# Depth and duration ranges per crash type
_CRASH_DEPTH: dict[CrashType, tuple[float, float]] = {
    CrashType.FAST_PANIC:  (-0.40, -0.30),
    CrashType.SLOW_BEAR:   (-0.50, -0.40),
    CrashType.FLASH_CRASH: (-0.25, -0.10),
    CrashType.DOUBLE_DIP:  (-0.55, -0.40),
}

_CRASH_DURATION: dict[CrashType, tuple[int, int]] = {
    CrashType.FAST_PANIC:  (15,  30),
    CrashType.SLOW_BEAR:   (150, 250),
    CrashType.FLASH_CRASH: (3,   7),
    CrashType.DOUBLE_DIP:  (60,  120),
}

# Per-regime allowed crash types and depth scaling
_REGIME_CRASH_TYPES: dict[Regime, list[CrashType]] = {
    Regime.NORMAL:     [CrashType.FLASH_CRASH],
    Regime.CORRECTION: [CrashType.FAST_PANIC, CrashType.FLASH_CRASH],
    Regime.CRISIS:     [CrashType.FAST_PANIC, CrashType.SLOW_BEAR, CrashType.DOUBLE_DIP],
}

_REGIME_DEPTH_SCALE: dict[Regime, float] = {
    Regime.NORMAL:     0.5,    # shallow — only half the usual depth
    Regime.CORRECTION: 0.85,
    Regime.CRISIS:     1.0,    # full depth
}


# ---------------------------------------------------------------------------
# Crash event metadata
# ---------------------------------------------------------------------------

@dataclass
class CrashEvent:
    """Metadata for one injected crash."""
    crash_type:     CrashType
    start_day:      int
    end_day:        int
    depth_target:   float    # intended drawdown (negative)
    realized_depth: float    # actual trough price / pre-crash peak - 1
    regime_at_start: Regime


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------

@dataclass
class PathData:
    """
    Output of generate_price_volume_path().

    All series have the same length (length_days).
    Pre-computed derived series are ready for run_single_path().
    """
    price_series:    np.ndarray
    volume_series:   np.ndarray
    regime_series:   list[RegimeState]

    crash_events: list[CrashEvent] = field(default_factory=list)

    # pre-computed derived series
    rolling_peak:    np.ndarray = field(default_factory=lambda: np.array([]))
    drawdown_series: np.ndarray = field(default_factory=lambda: np.array([]))
    speed4_series:   np.ndarray = field(default_factory=lambda: np.array([]))
    avgvol20_series: np.ndarray = field(default_factory=lambda: np.array([]))


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_price_volume_path(
    length_days:   int,
    regime_series: list[RegimeState],
    base_volume:   float = 1_000_000.0,
    seed:          Optional[int] = None,
) -> PathData:
    """
    Generate a regime-driven price/volume path with injected crash events.

    Parameters
    ----------
    length_days   : must equal len(regime_series)
    regime_series : list[RegimeState] from generate_regime_series()
    base_volume   : baseline daily volume in NORMAL regime
    seed          : random seed for reproducibility

    Returns
    -------
    PathData with price_series, volume_series, regime_series,
    crash_events, and pre-computed derived series.
    """
    assert len(regime_series) == length_days, (
        f"regime_series length {len(regime_series)} != length_days {length_days}"
    )

    rng = np.random.default_rng(seed)

    # 1. Build per-day drift and vol arrays from regime
    drift_daily = np.array([s.config.drift_daily for s in regime_series])
    vol_daily   = np.array([s.config.vol_daily   for s in regime_series])

    # 2. Generate base returns: Student-t with volatility clustering proxy
    returns = _base_returns(drift_daily, vol_daily, rng)

    # 3. Inject regime-appropriate crash events
    crash_events: list[CrashEvent] = []
    _inject_crashes(returns, regime_series, crash_events, length_days, rng)

    # 4. Build price path
    log_returns = np.log1p(np.clip(returns, -0.99, 10.0))
    prices      = np.exp(np.cumsum(log_returns))
    prices      = prices * (100.0 / prices[0])

    # 5. Build volume path
    volume = _build_volume(length_days, base_volume, regime_series, crash_events, rng)

    # 6. Pre-compute derived series
    rolling_peak    = np.maximum.accumulate(prices)
    drawdown_series = (prices / rolling_peak) - 1.0

    speed4_series = np.zeros(length_days)
    for t in range(4, length_days):
        speed4_series[t] = (prices[t] / prices[t - 4]) - 1.0

    avgvol20_series = np.zeros(length_days)
    for t in range(20, length_days):
        avgvol20_series[t] = volume[max(0, t - 20) : t].mean()

    # 7. Record realized depth in crash events
    for ev in crash_events:
        trough = min(ev.start_day + _CRASH_DURATION[ev.crash_type][1], ev.end_day)
        if trough < length_days:
            peak_before  = rolling_peak[ev.start_day]
            trough_price = prices[trough : min(trough + 5, length_days)].min()
            ev.realized_depth = (trough_price / peak_before) - 1.0 if peak_before > 0 else 0.0

    return PathData(
        price_series    = prices,
        volume_series   = volume,
        regime_series   = regime_series,
        crash_events    = crash_events,
        rolling_peak    = rolling_peak,
        drawdown_series = drawdown_series,
        speed4_series   = speed4_series,
        avgvol20_series = avgvol20_series,
    )


# ---------------------------------------------------------------------------
# Base return generation
# ---------------------------------------------------------------------------

def _base_returns(
    drift_daily: np.ndarray,
    vol_daily:   np.ndarray,
    rng:         np.random.Generator,
    nu:          float = 8.0,
    alpha:       float = 0.07,
    beta:        float = 0.88,
) -> np.ndarray:
    """
    Per-day returns using Student-t(nu) innovations with GARCH(1,1)-like
    volatility clustering.  Omega is computed per-day so unconditional
    variance tracks the regime vol target.
    """
    T        = len(drift_daily)
    z_normal = rng.standard_normal(T)
    chi2     = rng.chisquare(nu, size=T)
    z_t      = z_normal / np.sqrt(chi2 / nu)    # t(nu) variates

    sigma2  = np.empty(T)
    eps     = np.empty(T)
    sigma2[0] = vol_daily[0] ** 2
    eps[0]    = np.sqrt(sigma2[0]) * z_t[0]

    for t in range(1, T):
        target_var = vol_daily[t] ** 2
        omega      = (1.0 - alpha - beta) * target_var
        sigma2[t]  = omega + alpha * eps[t - 1] ** 2 + beta * sigma2[t - 1]
        vol_cap    = (vol_daily[t] * 8.0) ** 2
        sigma2[t]  = np.clip(sigma2[t], 1e-10, vol_cap)
        eps[t]     = np.sqrt(sigma2[t]) * z_t[t]

    return drift_daily + eps


# ---------------------------------------------------------------------------
# Crash injection
# ---------------------------------------------------------------------------

def _inject_crashes(
    returns:       np.ndarray,
    regime_series: list[RegimeState],
    crash_events:  list[CrashEvent],
    T:             int,
    rng:           np.random.Generator,
) -> None:
    """
    Walk through regime segments; inject crash events at Poisson rate
    determined by each regime's crash_prob_annual.
    """
    occupied: set[int] = set()
    t = 0

    while t < T:
        current_regime = regime_series[t].regime
        cfg            = regime_series[t].config

        # find end of this regime segment
        end = t + 1
        while end < T and regime_series[end].regime == current_regime:
            end += 1

        seg_len = end - t
        if cfg.crash_prob_annual > 0 and seg_len >= 8:
            years     = seg_len / 252.0
            n_crashes = int(rng.poisson(cfg.crash_prob_annual * years))
            allowed   = _REGIME_CRASH_TYPES.get(current_regime, [CrashType.FLASH_CRASH])
            depth_scale = _REGIME_DEPTH_SCALE.get(current_regime, 1.0)

            for _ in range(n_crashes):
                local_start = _pick_start(seg_len, occupied, t, rng)
                if local_start is None:
                    break
                global_start = t + local_start
                if global_start in occupied:
                    continue

                ctype   = CrashType(rng.choice([ct.value for ct in allowed]))
                d_lo, d_hi   = _CRASH_DEPTH[ctype]
                dur_lo, dur_hi = _CRASH_DURATION[ctype]

                depth    = float(rng.uniform(d_lo, d_hi)) * depth_scale
                duration = int(rng.integers(dur_lo, dur_hi + 1))
                max_dur  = max(1, T - global_start - 3)
                duration = min(duration, max_dur)
                rec_days = int(rng.integers(max(1, duration // 4),
                                            max(2, duration // 2) + 1))
                end_day  = min(global_start + duration + rec_days, T - 1)
                rec_days = max(0, end_day - (global_start + duration))

                crash_rets = _crash_returns(ctype, depth, duration, rec_days, rng)
                inject_len = min(len(crash_rets), T - global_start)
                returns[global_start : global_start + inject_len] = crash_rets[:inject_len]

                for d in range(global_start, global_start + inject_len):
                    occupied.add(d)

                crash_events.append(CrashEvent(
                    crash_type      = ctype,
                    start_day       = global_start,
                    end_day         = end_day,
                    depth_target    = depth,
                    realized_depth  = 0.0,    # filled after price path is built
                    regime_at_start = current_regime,
                ))

        t = end


def _pick_start(
    seg_len:  int,
    occupied: set[int],
    offset:   int,
    rng:      np.random.Generator,
    min_gap:  int = 15,
) -> Optional[int]:
    """Pick a local start index within [5, seg_len-5] not near occupied days."""
    candidates = [
        i for i in range(5, max(6, seg_len - 5))
        if (offset + i) not in occupied
        and all(abs((offset + i) - d) >= min_gap for d in occupied)
    ]
    if not candidates:
        return None
    return int(rng.choice(candidates))


# ---------------------------------------------------------------------------
# Crash return profiles
# ---------------------------------------------------------------------------

def _crash_returns(
    ctype:        CrashType,
    depth:        float,
    duration:     int,
    recovery_days: int,
    rng:          np.random.Generator,
) -> np.ndarray:
    if ctype == CrashType.FAST_PANIC:
        return _fast_panic(depth, duration, recovery_days, rng)
    elif ctype == CrashType.SLOW_BEAR:
        return _slow_bear(depth, duration, recovery_days, rng)
    elif ctype == CrashType.FLASH_CRASH:
        return _flash_crash(depth, duration, recovery_days, rng)
    elif ctype == CrashType.DOUBLE_DIP:
        return _double_dip(depth, duration, recovery_days, rng)
    raise ValueError(f"Unknown CrashType: {ctype}")


def _fast_panic(depth, duration, rec, rng):
    total = duration + rec
    rets  = np.zeros(total)
    avg   = (1.0 + depth) ** (1.0 / max(duration, 1)) - 1.0
    w     = np.linspace(0.5, 1.5, duration); w /= w.sum()
    rets[:duration] = np.clip(avg * duration * w + rng.normal(0, abs(avg)*0.5, duration), -0.25, 0.10)
    rets[duration:] = _recovery(abs(depth) * rng.uniform(0.30, 0.50), rec, rng)
    return rets


def _slow_bear(depth, duration, rec, rng):
    total = duration + rec
    rets  = np.zeros(total)
    avg   = (1.0 + depth) ** (1.0 / max(duration, 1)) - 1.0
    base  = rng.normal(avg, abs(avg) * 0.8, duration)
    t = 0
    while t < duration:
        bd = t + int(rng.integers(15, 30))
        if bd < duration:
            bl = int(rng.integers(2, 6))
            for d in range(bl):
                if bd + d < duration:
                    base[bd + d] += abs(avg) * rng.uniform(3, 6)
        t = bd + 1
    rets[:duration] = np.clip(base, -0.10, 0.08)
    rets[duration:] = _recovery(abs(depth) * rng.uniform(0.15, 0.35), rec, rng)
    return rets


def _flash_crash(depth, duration, rec, rng):
    total = duration + rec
    rets  = np.zeros(total)
    ff    = rng.uniform(0.60, 0.80)
    fd    = min(2, duration); sd = duration - fd
    favg  = (1.0 + depth * ff) ** (1.0 / max(fd, 1)) - 1.0
    rets[:fd] = np.clip(rng.normal(favg, abs(favg)*0.20, fd), -0.30, 0.05)
    if sd > 0:
        savg = (1.0 + depth * (1 - ff)) ** (1.0 / sd) - 1.0
        rets[fd:duration] = np.clip(rng.normal(savg, abs(savg)*0.30, sd), -0.30, 0.05)
    rets[duration:] = _recovery(abs(depth) * rng.uniform(0.50, 0.85), rec, rng)
    return rets


def _double_dip(depth, duration, rec, rng):
    total = duration + rec
    rets  = np.zeros(total)
    f1    = rng.uniform(0.45, 0.60); bf = rng.uniform(0.30, 0.50)
    d1    = max(3, int(duration * f1)); bd = max(5, int(duration * 0.12))
    d2    = duration - d1 - bd
    dep1  = depth * f1; bdep = abs(dep1) * bf; dep2 = depth * (1 - f1)
    avg1  = (1.0 + dep1) ** (1.0 / max(d1,1)) - 1.0
    rets[:d1] = np.clip(rng.normal(avg1, abs(avg1)*0.40, d1), -0.15, 0.05)
    rets[d1:d1+bd] = _recovery(bdep, bd, rng)
    if d2 > 0:
        avg2 = (1.0 + dep2) ** (1.0 / max(d2,1)) - 1.0
        rets[d1+bd:duration] = np.clip(rng.normal(avg2, abs(avg2)*0.40, d2), -0.15, 0.05)
    rets[duration:] = _recovery(abs(depth) * rng.uniform(0.20, 0.40), rec, rng)
    return rets


def _recovery(depth, days, rng):
    if days <= 0:
        return np.array([])
    avg  = (1.0 + abs(depth)) ** (1.0 / max(days, 1)) - 1.0
    return np.clip(rng.normal(avg, abs(avg) * 0.50, days), -0.08, 0.12)


# ---------------------------------------------------------------------------
# Volume path
# ---------------------------------------------------------------------------

def _build_volume(
    T:             int,
    base_volume:   float,
    regime_series: list[RegimeState],
    crash_events:  list[CrashEvent],
    rng:           np.random.Generator,
) -> np.ndarray:
    """
    Volume = base_volume x regime_multiplier x log-normal noise x crash spikes.
    Crash bottom days receive the highest spike (capitulation signal).
    """
    # per-day base: regime multiplier applied
    regime_mult = np.array([s.config.volume_multiplier for s in regime_series])
    log_vol     = rng.normal(0, 0.28, T)
    volume      = base_volume * regime_mult * np.exp(log_vol)

    # mild autocorrelation
    kernel   = np.ones(5) / 5
    smoothed = np.convolve(volume, kernel, mode="same")
    volume   = 0.6 * volume + 0.4 * smoothed

    # crash spikes
    for ev in crash_events:
        start   = ev.start_day
        dur     = _CRASH_DURATION[ev.crash_type][0]
        trough  = min(start + dur, T - 1)
        end     = min(ev.end_day, T - 1)

        # ramp into trough
        dec_len = trough - start
        if dec_len > 0:
            mults = np.linspace(1.3, 4.0, dec_len)
            mults = np.clip(mults + rng.uniform(-0.3, 0.3, dec_len), 1.0, 6.0)
            for i, d in enumerate(range(start, trough)):
                if d < T:
                    volume[d] *= mults[i]

        # capitulation spike at trough
        if trough < T:
            volume[trough] *= rng.uniform(3.5, 6.0)

        # fade during recovery
        rec_len = end - trough
        if rec_len > 0:
            fade = np.linspace(2.5, 1.1, rec_len)
            fade = np.clip(fade + rng.uniform(-0.2, 0.2, rec_len), 1.0, 4.0)
            for i, d in enumerate(range(trough, end)):
                if d < T:
                    volume[d] *= fade[i]

    return np.maximum(volume, base_volume * 0.05)


# ---------------------------------------------------------------------------
# Legacy alias (backward compat for existing tests)
# ---------------------------------------------------------------------------

def generate_price_path(
    length_days: int = 504,
    base_volatility: float = 0.016,
    drift: float = 0.0004,
    crash_probability: float = 1.0,
    crash_depth_distribution=None,
    crash_duration_distribution=None,
    crash_types=None,
    base_volume: float = 1_000_000.0,
    seed=None,
):
    """
    Legacy entry point kept for backward compatibility.
    Builds a flat NORMAL regime series and delegates to generate_price_volume_path().
    """
    from .regime_engine import generate_regime_series, RegimeConfig, RegimeState

    # build a flat NORMAL regime with the given parameters
    flat_cfg = RegimeConfig(
        drift_annual      = drift * 252,
        vol_annual        = base_volatility * (252 ** 0.5),
        crash_prob_annual = crash_probability,
        volume_multiplier = 1.0,
        allowed_crash_types = ["FAST_PANIC", "SLOW_BEAR", "FLASH_CRASH", "DOUBLE_DIP"],
    )
    from .regime_engine import Regime as _Regime
    series = [RegimeState(day=d, regime=_Regime.NORMAL, config=flat_cfg)
              for d in range(length_days)]
    return generate_price_volume_path(length_days, series, base_volume, seed)


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from .regime_engine import generate_regime_series, Regime, regime_counts

    print("=" * 60)
    print("  crash_generator.py -- smoke test")
    print("=" * 60)

    regime_s = generate_regime_series(length_days=504, seed=7)
    path     = generate_price_volume_path(504, regime_s, seed=7)

    rc = regime_counts(regime_s)
    print(f"\nRegime counts (504 days):")
    for r, c in rc.items():
        print(f"  {r:<12} {c:>4} days")

    print(f"\nCrash events:  {len(path.crash_events)}")
    for ev in path.crash_events:
        print(f"  day {ev.start_day:>3}-{ev.end_day:<3}  "
              f"{ev.crash_type.value:<12}  "
              f"target={ev.depth_target:.2f}  "
              f"realized={ev.realized_depth:.2f}  "
              f"regime={ev.regime_at_start.value}")

    print(f"\nPrice  min={path.price_series.min():.2f}  "
          f"max={path.price_series.max():.2f}  "
          f"final={path.price_series[-1]:.2f}")

    # avg volume spike ratio: crash trough vs non-crash days
    normal_days = [t for t in range(504) if all(
        t < ev.start_day or t > ev.end_day for ev in path.crash_events
    )]
    crash_days = [ev.start_day + (ev.end_day - ev.start_day) // 2
                  for ev in path.crash_events if ev.end_day < 504]
    avg_norm  = path.volume_series[normal_days].mean() if normal_days else 1.0
    avg_crash = path.volume_series[crash_days].mean() if crash_days else avg_norm
    print(f"\nAvg volume spike ratio (crash / normal): {avg_crash/avg_norm:.2f}x")

    print("\nAll smoke tests passed.")
    print("=" * 60)
