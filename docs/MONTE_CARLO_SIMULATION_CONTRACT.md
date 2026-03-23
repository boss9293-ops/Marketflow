# Monte Carlo Simulation Contract
## VR Survival Research — Simulation Interface Definition

**Version:** 1.0
**Date:** 2026-03-16
**Status:** Interface Definition (Pre-Implementation)

---

## Overview

This document defines the formal contract for the Monte Carlo simulation engine. It specifies every input, parameter, state variable, account variable, and output metric. The simulation must accept exactly these inputs and produce exactly these outputs. Implementation details are deferred; this contract governs the interface.

A single simulation run takes one price/volume path and one strategy parameter set, executes the state machine defined in `VR_STRATEGY_STATE_MACHINE_V1.md`, and returns the output metrics for that run. Monte Carlo is achieved by repeating this across N paths.

---

## 1. Input Variables (Market Data)

These are time-series arrays of equal length T, representing one complete price/volume path. Each index `t` represents one trading day.

| Variable | Type | Description |
|----------|------|-------------|
| `price_path` | `float[T]` | Daily closing price of the leveraged ETF |
| `volume_path` | `float[T]` | Daily trading volume |
| `rolling_peak` | `float[T]` | Running maximum of `price_path` up to and including day `t` |
| `drawdown_series` | `float[T]` | `(price_path[t] / rolling_peak[t]) - 1.0`; values ≤ 0 |
| `speed4_series` | `float[T]` | `(price_path[t] / price_path[t-4]) - 1.0`; 4-day cumulative return |
| `avgvol20_series` | `float[T]` | Simple 20-day trailing average of `volume_path` |

**Notes:**
- `rolling_peak`, `drawdown_series`, `speed4_series`, and `avgvol20_series` are pre-computed from `price_path` and `volume_path` before being passed to the simulator. The simulator does not compute them internally.
- Days 0–3 have undefined `speed4_series`; the simulation begins evaluation from day 4.
- Days 0–19 have undefined `avgvol20_series`; the simulation begins bottom zone evaluation from day 20.

---

## 2. Strategy Parameters

These are scalar values that define one strategy configuration. Varying these across simulation runs produces the parameter sweep.

### 2.1 Crash Detection Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `crash_speed_threshold` | `float` | Speed4 value at or below which crash alert triggers (e.g., `-0.10`) |
| `crash_dd_threshold` | `float` | Drawdown at or below which crash alert triggers (e.g., `-0.15`) |

Both conditions must be simultaneously satisfied to trigger S1_CRASH_ALERT.

### 2.2 Bottom Detection Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `bottom_dd_threshold` | `float` | Drawdown at or below which bottom zone activates (e.g., `-0.20`) |
| `volume_spike_multiplier` | `float` | Volume must exceed `avgvol20 * volume_spike_multiplier` (e.g., `2.0`) |

Both conditions must be simultaneously satisfied, with crash mode active, to trigger S3_BOTTOM_ZONE.

### 2.3 Ladder Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ladder_levels` | `float[N]` | Ordered list of DD thresholds that trigger each ladder step (e.g., `[-0.20, -0.25, -0.30, -0.35, -0.40]`) |
| `ladder_weights` | `float[N]` | Fraction of crash pool allocated to each ladder step; must sum to ≤ 1.0 (e.g., `[0.20, 0.20, 0.20, 0.20, 0.20]`) |

`ladder_levels` must be strictly decreasing (each level is a deeper drawdown than the prior). `ladder_weights[i]` is applied to the crash pool cap allocation, not the total pool.

### 2.4 Pool Management Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `crash_pool_cap` | `float` | Maximum fraction of pool deployable during a single crash event (e.g., `0.50`) |
| `reserve_ratio` | `float` | Target pool-to-NAV ratio to maintain during normal operation (e.g., `0.10`) |

`crash_pool_cap = 0.50` means at most 50% of the pool balance (measured at crash onset) may be used across all ladder steps. The remaining 50% is the survival reserve.

---

## 3. Account Variables

These are scalar values that represent the strategy's financial state at each time step `t`. They are updated by the simulation on each day.

| Variable | Type | Description |
|----------|------|-------------|
| `nav` | `float` | Total net asset value = `position_shares * price_path[t] + cash_pool + reserve_pool` |
| `cash_pool` | `float` | Deployable pool available for normal VR operations and crash ladder |
| `reserve_pool` | `float` | Survival reserve; locked during crash events; ≥ `crash_pool_cap` fraction of pool at crash onset |
| `position_shares` | `float` | Current share count of the leveraged ETF held |
| `avg_cost` | `float` | Average cost basis per share across all open positions |

**Pool Structure:**
- Total pool = `cash_pool + reserve_pool`
- During normal operation: `reserve_pool` is a soft target; pool is managed as a whole
- At crash onset (S1_CRASH_ALERT entry): `reserve_pool` is locked at `crash_pool_cap` × pool balance at that moment
- Pool draw for ladder buys comes exclusively from `cash_pool`; `reserve_pool` is not touched

---

## 4. State Variables

These are variables that track the strategy's operational state at each time step `t`.

| Variable | Type | Description |
|----------|------|-------------|
| `mode_state` | `enum` | Current state machine state: one of `{S0, S1, S2, S3, S4, S5}` |
| `crash_flag` | `bool` | True when crash detector conditions are both satisfied on day `t` |
| `bottom_flag` | `bool` | True when bottom zone conditions are all satisfied on day `t` |
| `ladder_step_filled` | `bool[N]` | Per-step flag; `ladder_step_filled[i]` is True once step `i` has been executed in the current crash event |
| `pool_used_ratio` | `float` | Fraction of the crash-onset pool balance deployed via ladder buys in the current crash event; resets to 0.0 at crash onset |

**Notes:**
- `crash_flag` and `bottom_flag` are re-evaluated every day from raw series data
- `ladder_step_filled` resets to all-False at the start of each new crash event (S1 entry)
- `pool_used_ratio` enforces the `crash_pool_cap` constraint; ladder buy is blocked when `pool_used_ratio + step_weight > crash_pool_cap`

---

## 5. Output Metrics

These are the per-run scalar outputs returned after simulating one complete path. When aggregated across N Monte Carlo runs, these produce the distribution metrics for analysis.

### 5.1 Primary Survival Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `survival_probability` | `float` | Fraction of runs where the strategy meets the survival definition at end of path (capital > 0, pool > 0, ability to act) |
| `pool_exhaustion_probability` | `float` | Fraction of runs where total pool reaches zero at any point during the simulation |
| `reserve_breach_rate` | `float` | Fraction of runs where the survival reserve is drawn below its locked threshold |

### 5.2 Recovery Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `drawdown_distribution` | `float[]` | Distribution of maximum drawdown experienced by the strategy NAV across runs |
| `recovery_time_distribution` | `float[]` | Distribution of days from maximum NAV drawdown to full NAV recovery, per run |
| `bottom_capture_rate` | `float` | Fraction of crash events where at least one ladder step was successfully executed |
| `reentry_success_rate` | `float` | Fraction of crash events where ladder buy positions were held to at least breakeven |

### 5.3 Terminal Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `terminal_nav_distribution` | `float[]` | Distribution of final NAV at end of simulation path, normalized to starting NAV = 1.0 |

### 5.4 Per-Run Summary Record

Each simulation run also returns a summary record for diagnostic use:

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | `int` | Unique identifier for this path/parameter combination |
| `survived` | `bool` | True if survival definition met at end of path |
| `pool_exhausted` | `bool` | True if pool reached zero at any point |
| `reserve_breached` | `bool` | True if survival reserve was violated |
| `max_dd_nav` | `float` | Maximum NAV drawdown experienced |
| `crash_events` | `int` | Number of distinct crash events (S1 entries) during the path |
| `ladder_steps_executed` | `int` | Total number of ladder steps executed across all crash events |
| `terminal_nav` | `float` | Final NAV normalized to 1.0 |

---

## 6. Simulation Contract Summary

A conforming simulation implementation must:

1. Accept the six input time-series (Section 1) and strategy parameters (Section 2) as its complete input
2. Maintain account variables (Section 3) and state variables (Section 4) on each time step
3. Execute state machine transitions per `VR_STRATEGY_STATE_MACHINE_V1.md`
4. Return all output metrics defined in Section 5 upon completion
5. Be callable in a loop across N paths to produce Monte Carlo distributions

```
simulate(
    price_path, volume_path, rolling_peak,
    drawdown_series, speed4_series, avgvol20_series,
    crash_speed_threshold, crash_dd_threshold,
    bottom_dd_threshold, volume_spike_multiplier,
    ladder_levels, ladder_weights,
    crash_pool_cap, reserve_ratio
) → SimulationResult
```

The simulation must be stateless across runs — no information from run `k` may influence run `k+1`.

---

## Appendix: Variable Summary

### Input Series
`price_path` · `volume_path` · `rolling_peak` · `drawdown_series` · `speed4_series` · `avgvol20_series`

### Strategy Parameters
`crash_speed_threshold` · `crash_dd_threshold` · `bottom_dd_threshold` · `volume_spike_multiplier` · `ladder_levels` · `ladder_weights` · `crash_pool_cap` · `reserve_ratio`

### Account Variables
`nav` · `cash_pool` · `reserve_pool` · `position_shares` · `avg_cost`

### State Variables
`mode_state` · `crash_flag` · `bottom_flag` · `ladder_step_filled` · `pool_used_ratio`

### Output Metrics
`survival_probability` · `pool_exhaustion_probability` · `reserve_breach_rate` · `drawdown_distribution` · `recovery_time_distribution` · `bottom_capture_rate` · `reentry_success_rate` · `terminal_nav_distribution`

---

*This document defines the simulation interface contract only. No simulation code is included.*
