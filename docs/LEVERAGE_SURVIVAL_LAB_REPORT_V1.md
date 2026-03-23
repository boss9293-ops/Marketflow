# VR Leveraged ETF Survival Lab -- Research Report V1

*Generated: 2026-03-16 11:45 | Paths: 1,000 | Horizon: 5yr*


## 1. Executive Summary

This report summarises a Monte Carlo analysis of the **VR Leveraged ETF Survival Strategy** applied to a simulated 3x-leveraged ETF (TQQQ-class). The simulation ran **1,000 independent paths** over a **5-year horizon** using a Markov regime chain (NORMAL / CORRECTION / CRISIS) with GARCH(1,1) + Student-t innovations and Poisson-sampled crash events per regime segment.

Paths ending mid-crash (drawdown < -10% or recent crash event) received a 252-day NORMAL-regime recovery tail to remove endpoint bias (98.7% of paths extended).

**Key findings:**

- Survival rate: 100.0%

- Pool exhaustion rate: 0.0%

- Bottom-capture rate: 100.0%

- Median terminal NAV: 0.289 (base 1.0)

- Median max drawdown: -96.2%

- Censored path rate: 96.0% (recovery window too short at horizon)


## 2. Simulation Model

### 2.1 Market Regime Engine

Market regimes evolve via a daily Markov chain with three states. Each day's drift, volatility, and crash probability are drawn from the active regime's parameters.

| Regime | Drift/yr | Vol/yr | Crashes/yr | Vol mult | Crash types |
| --- | --- | --- | --- | --- | --- |
| NORMAL | 40.0% | 60.0% | 0.2 | 1.0x | FLASH_CRASH |
| CORRECTION | -20.0% | 90.0% | 1.5 | 1.5x | FAST_PANIC, FLASH_CRASH |
| CRISIS | -80.0% | 140.0% | 4.0 | 2.5x | FAST_PANIC, SLOW_BEAR, DOUBLE_DIP |

### 2.2 Transition Matrix (default)

```text
         NORMAL  CORRECTION  CRISIS
NORMAL     0.90        0.09    0.01
CORRECTION 0.40        0.50    0.10
CRISIS     0.30        0.40    0.30
```

### 2.3 Return Process

Each regime segment uses GARCH(1,1) with Student-t(nu=8) innovations. omega is set so that the unconditional volatility equals the regime base_vol: `omega = (1 - alpha - beta) * vol_daily^2`. CORRECTION and CRISIS regimes produce meaningfully higher realised volatility than NORMAL.

### 2.4 Crash Injection

For each regime segment a Poisson draw determines crash count. Crash type (FAST_PANIC, SLOW_BEAR, FLASH_CRASH, DOUBLE_DIP), depth, and duration are sampled from regime-specific distributions. NORMAL segments produce only shallow FLASH_CRASH events; CRISIS segments use full depth across all crash types.

### 2.5 Recovery Tail Extension

When a path ends with drawdown < -10% OR a crash event within the final 252 trading days, a 252-day NORMAL-regime extension is appended. The tail uses: no crash injection, NORMAL drift (+0.40/yr), NORMAL volatility (+0.60/yr). This removes endpoint bias from recovery metrics.


## 3. VR Survival Strategy

### 3.1 State Machine

The strategy runs a 6-state machine on each daily observation:

```text
S0_NORMAL      -- hold, harvest time-value to pool
S1_CRASH_ALERT -- crash signal detected (Speed4 <= -10%, DD <= -15%)
S2_CRASH_HOLD  -- in crash, waiting for bottom confirmation
S3_BOTTOM_ZONE -- bottom signal (DD <= -20%, Volume >= 2x AvgVol20)
S4_RECOVERY    -- ladder buys executed; riding recovery
S5_REBUILD     -- price above pre-crash level; rebuilding pool
```

### 3.2 Pool Management

- 10% of NAV held as initial crash pool reserve  
- Pool capped at 50% of NAV  
- Harvest rate: 0.1% of NAV per day in S0_NORMAL  
- Pool deployed via ladder at S3_BOTTOM_ZONE

### 3.3 Ladder Configuration

Ladder buys trigger at drawdown levels: -20%, -25%, -30%, -35%, -40%  
Each level deploys 20% of available crash pool.


## 4. Monte Carlo Results

### 4.1 Regime Distribution

| Regime | Mean fraction of days |
| --- | --- |
| NORMAL | 79.2% |
| CORRECTION | 17.2% |
| CRISIS | 3.6% |

### 4.2 Survival Metrics

| Metric | Value |
| --- | --- |
| Survival rate | 100.0% |
| Pool exhaustion rate | 0.0% |
| Bottom capture rate | 100.0% |
| Tail extension rate | 98.7% |

### 4.3 Terminal NAV Distribution (base 1.0)

| Statistic | Value |
| --- | --- |
| Mean | 5.053 |
| Median | 0.289 |
| p10 | 0.018 |
| p25 | 0.065 |
| p75 | 1.406 |
| p90 | 5.507 |

### 4.4 Max Drawdown (NAV)

| Statistic | Value |
| --- | --- |
| Mean | -93.4% |
| Median | -96.2% |
| Worst decile (p10) | -99.5% |

### 4.5 NAV Recovery (back to starting value)

| Metric | Value |
| --- | --- |
| Recovery rate | 16.9% |
| Mean recovery days | 349.6 |

### 4.6 Crash and Ladder Activity

| Metric | Value |
| --- | --- |
| Mean crash events / path | 17.67 |
| Mean ladder steps / path | 47.84 |

## 5. Recovery Analysis

### 5.1 Recovery Metrics

Recovery metrics are measured from the path's NAV bottom (minimum NAV day). Medians are reported over paths where the metric was reached within the observation window (original path + any 252-day tail extension).

| Metric | Median | Reach rate |
| --- | --- | --- |
| recovery_6m_return (+126d from bottom) | +112.5% | all paths with 126d+ after bottom |
| recovery_12m_return (+252d from bottom) | +181.6% | all paths with 252d+ after bottom |
| days_to_recover_50pct (NAV +50% from bottom) | 25 days | 88.5% |
| days_to_recover_peak (NAV new all-time high) | 136 days | 27.6% |

### 5.2 Post-Crash Performance

Recovery metrics quantify how quickly and how strongly the leveraged ETF (and the VR strategy NAV) rebounds after reaching its worst point. A positive `recovery_6m_return` means the strategy NAV was above the bottom level 6 months later; a negative value means it continued deteriorating (or path ended before 6 months elapsed after the bottom).

**Tail extension impact**: 98.7% of paths received a 252-day recovery observation window beyond the original horizon. Without tail extension, recovery metrics for those paths would have been unmeasurable (right-censored), creating a bias toward underestimating recovery speed.


### 5.3 Censored Path Analysis

A path is classified as **right-censored** if the drawdown at the end of the *original* horizon (before any tail extension) was below -20%. This means the crash recovery had not completed by the observation window, and the recovery metrics for that path are based on the tail extension period only.

| Metric | Value |
| --- | --- |
| Censored path rate | 96.0% |
| Meaning | crash recovery incomplete at original horizon |
| Tail extension applied | 98.7% |

> **Interpretation**: 96.0% of the 1,000 paths ended their original horizon while still in a significant drawdown (>20%). For these paths, any reported recovery metrics are measured within the tail extension window and should be interpreted as partial recovery observations rather than complete recovery episodes.


## 6. Strategy Comparison

All four strategies were tested on the same **1,000 paths** over **5 years**.

| Metric | VR_SURVIVAL | DCA | DD_LADDER_ONLY | MA200_FILTER |
| --- | --- | --- | --- | --- |
| Survival rate | 100.0% | 50.8% | 63.5% | 48.7% |
| Terminal NAV (median) | 0.231 | 0.525 | 2.065 | 0.486 |
| Terminal NAV (mean) | 4.168 | 13.939 | 106142.492 | 2.030 |
| Terminal NAV p10 | 0.016 | 0.016 | 0.023 | 0.120 |
| Terminal NAV p90 | 4.303 | 13.047 | 665.174 | 3.136 |
| Max DD (median) | -95.9% | -95.4% | -96.6% | -83.1% |
| Max DD worst decile | -99.5% | -99.7% | -99.8% | -94.1% |
| Recovery rate | 15.0% | 49.3% | 61.3% | 43.9% |
| Recovery days (mean) | 310.2 | 118.3 | 39.5 | 94.2 |
| Mean ladder steps | 45.90 | 60.00 | 15.98 | 0.00 |

### 6.1 Strategy Descriptions

**VR_SURVIVAL**: Full VR strategy: pool + state machine + ladder buys

**DCA**: DCA: buy 2% of NAV every 21d

**DD_LADDER_ONLY**: DD Ladder: buys at [-0.2, -0.25, -0.3, -0.35, -0.4] (no pool, no state machine)

**MA200_FILTER**: MA200 filter: hold above MA200, cash below


## 7. Methodology Notes

**Path generation**: Each path starts at price=100 on day 0. GARCH variance resets at each regime transition. Crash events override returns (not additive) to keep prices positive.

**Recovery tail**: A 252-day NORMAL-regime GBM tail (no GARCH, no crashes) is appended when needed. The tail seed is offset by 9,999,999 from the main path seed to ensure independence.

**Censoring definition**: drawdown < -20% at the original path end (before tail). Censored paths contribute to all reported metrics but their recovery metrics are partial observations.

**Survival definition**: final NAV > 0 and pool never fully exhausted. This is a weak definition; a hard NAV floor (e.g. 0.10) is planned.

**Benchmark strategies**: DCA and DD_LADDER_ONLY use simplified NAV accounting. No transaction costs or margin calls are modelled.


## 8. Raw Output

### 8.1 Regime Monte Carlo Summary

```text
======================================================================
  MONTE CARLO RESULTS   N=1,000 paths  horizon=5yr
======================================================================

[REGIME FRACTIONS  (mean across paths)]
  NORMAL        79.2%
  CORRECTION    17.2%
  CRISIS         3.6%

[SURVIVAL]
  survival_rate       [############################]  100.0%  (1,000)
  pool_exhausted      [............................]    0.0%  (0)
  bottom_capture      [############################]  100.0%  (1,000)

[TERMINAL NAV  (base 1.0)]
  mean   = 5.053    median = 0.289
  p10    = 0.018    p25    = 0.065
  p75    = 1.406    p90    = 5.507

[MAX DRAWDOWN (NAV)]
  mean   = -0.934    median = -0.962
  worst decile (p10) = -0.995

[RECOVERY (NAV back to start)]
  recovered       16.9%  of paths
  mean days     349.6

[CRASH & LADDER]
  mean crash events per path : 17.67
  mean ladder steps per path : 47.84

[RECOVERY TAIL EXTENSION]
  paths with tail appended : [############################]   98.7%  (987)

[CENSORED PATH ANALYSIS]
  censored_path_rate       : 96.0%
  (path ended with dd<-20%; recovery window too short)

[RECOVERY METRICS  (median over paths where metric was reached)]
  recovery_6m_return         : +112.5%
  recovery_12m_return        : +181.6%
  days_to_recover_50pct      : 25  (rate: 88.5%)
  days_to_recover_peak       : 136  (rate: 27.6%)

[RUNTIME]
  generation   125.6s
  simulation   19.5s
  total        145.1s  (145.1ms per path)
======================================================================
```

### 8.2 Strategy Comparison Table

```text
================================================================================
  STRATEGY COMPARISON   N=1,000 paths  horizon=5yr
================================================================================
  Metric                            VR_SURVIVAL              DCA   DD_LADDER_ONLY     MA200_FILTER
--------------------------------------------------------------------------------
  Survival rate                          100.0%            50.8%            63.5%            48.7%
  Terminal NAV (median)                   0.231            0.525            2.065            0.486
  Terminal NAV (mean)                     4.168           13.939       106142.492            2.030
  Terminal NAV p10                        0.016            0.016            0.023            0.120
  Terminal NAV p90                        4.303           13.047          665.174            3.136
--------------------------------------------------------------------------------
  Max DD (median)                        -0.959           -0.954           -0.966           -0.831
  Max DD worst decile                    -0.995           -0.997           -0.998           -0.941
--------------------------------------------------------------------------------
  Recovery rate                           15.0%            49.3%            61.3%            43.9%
  Recovery days (mean)                    310.2            118.3             39.5             94.2
--------------------------------------------------------------------------------
  Mean ladder steps                       45.90            60.00            15.98             0.00
--------------------------------------------------------------------------------

  Total elapsed: 158.0s
================================================================================
```

---

*VR Leveraged ETF Survival Lab -- MarketFlow Research Framework*
