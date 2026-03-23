# VR False-Bottom Guard Phase 5 Report

## Implementation summary
This report compares vFinal playback across four modes:
- Baseline: false-bottom guard disabled
- Guard Phase 2: staged reset-release before fast-rebound tuning
- Guard Phase 3: current staged reset-release with fast-snapback tuning
- Guard Phase 5: fast snapback entry override layered on top of existing guard + reset behavior

The underlying buy conditions, Vmin ladder levels, MA200 mop-up, MSS inputs, and Track/Crisis logic are unchanged. The comparison isolates guard release timing only.

## Validation method
- Engine: `build_execution_playback.ts` vFinal scenario playback
- Cap setting: `50%`
- Modes:
  - Baseline: false-bottom guard disabled
  - Guard Phase 2: reset release without fast snapback tuning
  - Guard Phase 3: current release tuning with persistence + fast snapback recognition
  - Guard Phase 5: Phase 3 plus fast snapback override for first re-entry opportunity
- Near-zero pool threshold: 5% of starting pool cash
- Reset missed-rebound rule: +8% within 5 bars with no Vmin buy inside 3 bars after reset-ready activation
- Reset false-positive rule: lower low of at least 2% inside 5 bars after reset-ready activation

## Episode comparison tables
### Episode summary
| event | baseline_final | phase2_final | phase3_final | phase5_final | phase2_delta | phase3_delta | phase5_delta | baseline_dd | phase2_dd | phase3_dd | phase5_dd | baseline_min_pool | phase2_min_pool | phase3_min_pool | phase5_min_pool | phase2_pool_relief | phase3_pool_relief | phase5_pool_relief | baseline_near_zero_days | phase2_near_zero_days | phase3_near_zero_days | phase5_near_zero_days |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 30187.48 | 29980.26 | 29980.26 | 27761.51 | -207.22 | -207.22 | -2425.97 | -55.13 | -55.13 | -55.13 | -52.54 | 0.24 | 0.05 | 0.05 | 1000.05 | -0.19 | -0.19 | 999.81 | 441 | 398 | 403 | 0 |
| 2018 Q4 | 12724.76 | 12724.76 | 12724.76 | 12724.76 | 0 | 0 | 0 | -60.34 | -60.34 | -60.34 | -60.34 | 0.16 | 0.16 | 0.16 | 0.16 | 0 | 0 | 0 | 157 | 157 | 157 | 157 |
| 2020 Covid Crash | 18743.52 | 19627.72 | 19627.72 | 19641.68 | 884.2 | 884.2 | 898.16 | -71.88 | -71.87 | -71.87 | -71.86 | 0.24 | 4.12 | 4.12 | 1.71 | 3.88 | 3.88 | 1.47 | 427 | 403 | 403 | 403 |
| 2022 Fed Bear | 23607.51 | 23890.78 | 23890.78 | 23805.52 | 283.27 | 283.27 | 198.01 | -48.03 | -47.4 | -47.4 | -47.59 | 15.59 | 16.66 | 16.66 | 16.06 | 1.07 | 1.07 | 0.47 | 87 | 87 | 87 | 87 |
| 2024 Yen Carry | 32205.27 | 32205.27 | 32205.27 | 32205.27 | 0 | 0 | 0 | -37.15 | -37.15 | -37.15 | -37.15 | 48.62 | 48.62 | 48.62 | 48.62 | 0 | 0 | 0 | 114 | 114 | 114 | 114 |
| 2025 Tariff Shock | 25773.94 | 25694.26 | 25694.26 | 25688.15 | -79.68 | -79.68 | -85.79 | -33.78 | -33.78 | -33.78 | -33.78 | 54.64 | 59.01 | 59.01 | 52.9 | 4.37 | 4.37 | -1.74 | 57 | 57 | 57 | 57 |

### Trade behavior
| event | baseline_exec | phase2_exec | phase3_exec | phase5_exec | phase2_partial | phase3_partial | phase5_partial | phase2_delayed | phase3_delayed | phase5_delayed | phase2_blocked | phase3_blocked | phase5_blocked | phase2_avg_delay_bars | phase3_avg_delay_bars | phase5_avg_delay_bars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 1 | 1 | 1 | 1 | 0 | 0 | 1 | 2 | 0 | 0 | 2 | 1 | 1 | 3 | - | - |
| 2018 Q4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - | - | - |
| 2020 Covid Crash | 2 | 1 | 1 | 3 | 0 | 0 | 0 | 7 | 6 | 3 | 4 | 4 | 3 | 1 | 1 | 2.5 |
| 2022 Fed Bear | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 2 | 5 | 5 | 4 | 2.33 | 2.33 | 1.5 |
| 2024 Yen Carry | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - | - | - |
| 2025 Tariff Shock | 2 | 2 | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

### Reset / rebound diagnostics
| event | phase2_guard_active_days | phase3_guard_active_days | phase5_guard_active_days | phase2_resets | phase3_resets | phase5_resets | phase2_avg_days_to_first_buy_after_reset | phase3_avg_days_to_first_buy_after_reset | phase5_avg_days_to_first_buy_after_reset | phase2_reset_missed_rebound_cases | phase3_reset_missed_rebound_cases | phase5_reset_missed_rebound_cases | phase2_reset_false_positive_rate_pct | phase3_reset_false_positive_rate_pct | phase5_reset_false_positive_rate_pct |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 170 | 124 | 124 | 21 | 15 | 15 | 32.33 | 33.4 | 33.4 | 5 | 4 | 4 | 71.43 | 80 | 80 |
| 2018 Q4 | 137 | 127 | 127 | 9 | 8 | 8 | - | - | - | 1 | 1 | 1 | 44.44 | 50 | 50 |
| 2020 Covid Crash | 139 | 111 | 111 | 20 | 15 | 15 | 27.2 | 27.2 | 147.5 | 7 | 5 | 4 | 50 | 60 | 60 |
| 2022 Fed Bear | 341 | 318 | 318 | 31 | 26 | 26 | 117.92 | 104 | 101.71 | 9 | 6 | 6 | 58.06 | 61.54 | 61.54 |
| 2024 Yen Carry | 87 | 81 | 81 | 6 | 4 | 4 | - | - | - | 2 | 2 | 2 | 66.67 | 50 | 50 |
| 2025 Tariff Shock | 131 | 119 | 119 | 11 | 9 | 9 | 157.63 | 158.67 | 158.5 | 3 | 3 | 3 | 63.64 | 55.56 | 55.56 |

### Fast snapback override diagnostics
| event | phase5_fast_snapback_flag_days | phase5_override_weak_days | phase5_override_moderate_days | phase5_fast_snapback_override_buy_count |
| --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 236 | 0 | 236 | 1 |
| 2018 Q4 | 69 | 0 | 69 | 0 |
| 2020 Covid Crash | 254 | 0 | 254 | 1 |
| 2022 Fed Bear | 143 | 0 | 143 | 1 |
| 2024 Yen Carry | 35 | 0 | 35 | 0 |
| 2025 Tariff Shock | 81 | 0 | 81 | 1 |

### 2025 episode note
| event | baseline_final | phase2_final | phase3_final | phase5_final | phase2_miss_cost_10d_pct | phase3_miss_cost_10d_pct | phase5_miss_cost_10d_pct | phase2_reset_false_positive_rate_pct | phase3_reset_false_positive_rate_pct | phase5_reset_false_positive_rate_pct |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025 Tariff Shock | 25773.94 | 25694.26 | 25694.26 | 25688.15 | 4.73 | 4.73 | -5.57 | 63.64 | 55.56 | 55.56 |

## Key findings
- Largest Phase 5 pool relief: 2011 Debt Ceiling (999.81 improvement in minimum pool balance)
- Largest Phase 5 miss cost (10d average from blocked/delayed signals): 2011 Debt Ceiling (22.58%)
- Guard miss-cost metrics are shown as forward returns after blocked or delayed Vmin signals. Positive values mean waiting missed some rebound; negative values mean waiting avoided further downside.

## Recommended next step
Use this report to decide whether a further release-tuning pass should only adjust:
- first-buy priority sensitivity
- medium override thresholds
- fast snapback flag specificity

No engine change is recommended from this report alone.

## Known limitations
- This pass measures replayed execution timing only. It does not retune the guard.
- Miss-cost uses forward asset returns after blocked/delayed trigger dates, not a counterfactual optimized fill model.
- Reset quality uses a simple missed-rebound rule for auditability.
