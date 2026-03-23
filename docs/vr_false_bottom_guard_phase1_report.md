# VR False-Bottom Guard Phase 1 Report

## Implementation summary
This report compares the current vFinal scenario playback against a measurement-only baseline where the false-bottom guard gate is disabled. The underlying buy conditions, Vmin ladder levels, MA200 mop-up, MSS inputs, and Track/Crisis logic are unchanged. The comparison isolates execution timing only.

## Validation method
- Engine: `build_execution_playback.ts` vFinal scenario playback
- Cap setting: `50%`
- Modes:
  - Baseline: false-bottom guard disabled
  - Guard-On: current WEAK / MODERATE / STRONG guard active
- Near-zero pool threshold: 5% of starting pool cash
- Reset missed-rebound rule: +8% within 5 bars with no Vmin buy inside 3 bars after reset-ready activation
- Reset false-positive rule: lower low of at least 2% inside 5 bars after reset-ready activation

## Episode comparison tables
### Episode summary
| event | baseline_final | guard_final | baseline_dd | guard_dd | baseline_min_pool | guard_min_pool | pool_relief | baseline_near_zero_days | guard_near_zero_days |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 30187.48 | 27761.51 | -55.13 | -52.54 | 0.24 | 1000.05 | 999.81 | 441 | 0 |
| 2018 Q4 | 12724.76 | 12724.76 | -60.34 | -60.34 | 0.16 | 0.16 | 0 | 157 | 157 |
| 2020 Covid Crash | 18743.52 | 19641.68 | -71.88 | -71.86 | 0.24 | 1.71 | 1.47 | 427 | 403 |
| 2022 Fed Bear | 23607.51 | 24440.16 | -48.03 | -46.21 | 15.59 | 1.64 | -13.95 | 87 | 87 |
| 2024 Yen Carry | 32205.27 | 32205.27 | -37.15 | -37.15 | 48.62 | 48.62 | 0 | 114 | 114 |

### Trade behavior
| event | baseline_exec | guard_exec | partial | delayed | blocked | avg_delay_bars | delayed_fill_rate_pct | blocked_lower_reentry_pct |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 1 | 1 | 1 | 1 | 2 | 2 | 100 | 0 |
| 2018 Q4 | 0 | 0 | 0 | 0 | 0 | - | - | - |
| 2020 Covid Crash | 2 | 3 | 1 | 3 | 3 | 2.5 | 66.67 | 100 |
| 2022 Fed Bear | 3 | 3 | 1 | 2 | 4 | 1.5 | 100 | 100 |
| 2024 Yen Carry | 0 | 0 | 0 | 0 | 0 | - | - | - |

### Guard diagnostics
| event | guard_active_days | resets | avg_days_to_first_buy_after_reset | avg_reset_buy_10d_return_pct | reset_missed_rebound_cases | reset_false_positive_rate_pct |
| --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 151 | 13 | 31.33 | 28.13 | 2 | 84.62 |
| 2018 Q4 | 132 | 5 | - | - | 0 | 80 |
| 2020 Covid Crash | 124 | 12 | 93.73 | 32.18 | 3 | 75 |
| 2022 Fed Bear | 339 | 22 | 115.44 | 1.34 | 5 | 63.64 |
| 2024 Yen Carry | 81 | 3 | - | - | 2 | 33.33 |

## Key findings
- Largest pool relief: 2011 Debt Ceiling (999.81 improvement in minimum pool balance)
- Largest guarded miss cost (10d average from blocked/delayed signals): 2011 Debt Ceiling (21.07%)
- Guard miss-cost metrics are shown as forward returns after blocked or delayed Vmin signals. Positive values mean waiting missed some rebound; negative values mean waiting avoided further downside.

## Recommended next step
Use this report to decide whether Phase 2 should adjust only policy thresholds:
- WEAK partial fraction
- MODERATE delay length
- STRONG block sensitivity
- reset timing

No engine change is recommended from this report alone.

## Known limitations
- This pass measures replayed execution timing only. It does not retune the guard.
- Miss-cost uses forward asset returns after blocked/delayed trigger dates, not a counterfactual optimized fill model.
- Reset quality uses a simple missed-rebound rule for auditability.

## Chart outputs
- `../vr_backtest/results/false_bottom_guard_phase1/chart_pool_balance_comparison.png`
- `../vr_backtest/results/false_bottom_guard_phase1/chart_buy_execution_difference.png`
- `../vr_backtest/results/false_bottom_guard_phase1/chart_recovery_path_comparison.png`
- `../vr_backtest/results/false_bottom_guard_phase1/chart_guard_miss_cost_scatter.png`
