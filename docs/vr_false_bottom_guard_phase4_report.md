# VR False-Bottom Guard Phase 4 Report

## Implementation summary
This report compares vFinal playback across four modes:
- Baseline: false-bottom guard disabled
- Guard Phase 2: staged reset-release before fast-rebound tuning
- Guard Phase 3: current staged reset-release with fast-snapback tuning
- Guard Phase 4: current 3-variable adjustment layer (snapback speed, reentry availability, MA200 timing)

The underlying buy conditions, Vmin ladder levels, MA200 mop-up, MSS inputs, and Track/Crisis logic are unchanged. The comparison isolates guard release timing only.

## Validation method
- Engine: `build_execution_playback.ts` vFinal scenario playback
- Cap setting: `50%`
- Modes:
  - Baseline: false-bottom guard disabled
  - Guard Phase 2: reset release without fast snapback tuning
  - Guard Phase 3: current release tuning with persistence + fast snapback recognition
  - Guard Phase 4: Phase 3 plus adjustment layer using snapback speed, reentry availability, and MA200 timing
- Near-zero pool threshold: 5% of starting pool cash
- Reset missed-rebound rule: +8% within 5 bars with no Vmin buy inside 3 bars after reset-ready activation
- Reset false-positive rule: lower low of at least 2% inside 5 bars after reset-ready activation

## Episode comparison tables
### Episode summary
| event | baseline_final | phase2_final | phase3_final | phase4_final | phase2_delta | phase3_delta | phase4_delta | baseline_dd | phase2_dd | phase3_dd | phase4_dd | baseline_min_pool | phase2_min_pool | phase3_min_pool | phase4_min_pool | phase2_pool_relief | phase3_pool_relief | phase4_pool_relief | baseline_near_zero_days | phase2_near_zero_days | phase3_near_zero_days | phase4_near_zero_days |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 30187.48 | 29980.26 | 29980.26 | 29980.26 | -207.22 | -207.22 | -207.22 | -55.13 | -55.13 | -55.13 | -55.13 | 0.24 | 0.05 | 0.05 | 0.05 | -0.19 | -0.19 | -0.19 | 441 | 398 | 403 | 403 |
| 2018 Q4 | 12724.76 | 12724.76 | 12724.76 | 12724.76 | 0 | 0 | 0 | -60.34 | -60.34 | -60.34 | -60.34 | 0.16 | 0.16 | 0.16 | 0.16 | 0 | 0 | 0 | 157 | 157 | 157 | 157 |
| 2020 Covid Crash | 18743.52 | 19627.72 | 19627.72 | 19627.72 | 884.2 | 884.2 | 884.2 | -71.88 | -71.87 | -71.87 | -71.87 | 0.24 | 4.12 | 4.12 | 4.12 | 3.88 | 3.88 | 3.88 | 427 | 403 | 403 | 403 |
| 2022 Fed Bear | 23607.51 | 23890.78 | 23890.78 | 23890.78 | 283.27 | 283.27 | 283.27 | -48.03 | -47.4 | -47.4 | -47.4 | 15.59 | 16.66 | 16.66 | 16.66 | 1.07 | 1.07 | 1.07 | 87 | 87 | 87 | 87 |
| 2024 Yen Carry | 32205.27 | 32205.27 | 32205.27 | 32205.27 | 0 | 0 | 0 | -37.15 | -37.15 | -37.15 | -37.15 | 48.62 | 48.62 | 48.62 | 48.62 | 0 | 0 | 0 | 114 | 114 | 114 | 114 |
| 2025 Tariff Shock | 25773.94 | 25694.26 | 25694.26 | 25694.26 | -79.68 | -79.68 | -79.68 | -33.78 | -33.78 | -33.78 | -33.78 | 54.64 | 59.01 | 59.01 | 59.01 | 4.37 | 4.37 | 4.37 | 57 | 57 | 57 | 57 |

### Trade behavior
| event | baseline_exec | phase2_exec | phase3_exec | phase4_exec | phase2_partial | phase3_partial | phase4_partial | phase2_delayed | phase3_delayed | phase4_delayed | phase2_blocked | phase3_blocked | phase4_blocked | phase2_avg_delay_bars | phase3_avg_delay_bars | phase4_avg_delay_bars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 2 | 1 | 1 | 3 | - | - |
| 2018 Q4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - | - | - |
| 2020 Covid Crash | 2 | 1 | 1 | 1 | 0 | 0 | 0 | 7 | 6 | 6 | 4 | 4 | 4 | 1 | 1 | 1 |
| 2022 Fed Bear | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 3 | 5 | 5 | 5 | 2.33 | 2.33 | 2.33 |
| 2024 Yen Carry | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - | - | - |
| 2025 Tariff Shock | 2 | 2 | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 |

### Guard diagnostics
| event | phase2_guard_active_days | phase3_guard_active_days | phase4_guard_active_days | phase2_resets | phase3_resets | phase4_resets | phase2_avg_days_to_first_buy_after_reset | phase3_avg_days_to_first_buy_after_reset | phase4_avg_days_to_first_buy_after_reset | phase2_reset_missed_rebound_cases | phase3_reset_missed_rebound_cases | phase4_reset_missed_rebound_cases | phase2_reset_false_positive_rate_pct | phase3_reset_false_positive_rate_pct | phase4_reset_false_positive_rate_pct |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 170 | 124 | 123 | 21 | 15 | 15 | 32.33 | 33.4 | 33.4 | 5 | 4 | 4 | 71.43 | 80 | 80 |
| 2018 Q4 | 137 | 127 | 127 | 9 | 8 | 8 | - | - | - | 1 | 1 | 1 | 44.44 | 50 | 50 |
| 2020 Covid Crash | 139 | 111 | 113 | 20 | 15 | 15 | 27.2 | 27.2 | 27.2 | 7 | 5 | 5 | 50 | 60 | 60 |
| 2022 Fed Bear | 341 | 318 | 314 | 31 | 26 | 26 | 117.92 | 104 | 104 | 9 | 6 | 6 | 58.06 | 61.54 | 61.54 |
| 2024 Yen Carry | 87 | 81 | 78 | 6 | 4 | 4 | - | - | - | 2 | 2 | 2 | 66.67 | 50 | 50 |
| 2025 Tariff Shock | 131 | 119 | 114 | 11 | 9 | 9 | 157.63 | 158.67 | 158.67 | 3 | 3 | 3 | 63.64 | 55.56 | 55.56 |

### 2025 episode note
| event | baseline_final | phase2_final | phase3_final | phase4_final | phase2_miss_cost_10d_pct | phase3_miss_cost_10d_pct | phase4_miss_cost_10d_pct | phase2_reset_false_positive_rate_pct | phase3_reset_false_positive_rate_pct | phase4_reset_false_positive_rate_pct |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025 Tariff Shock | 25773.94 | 25694.26 | 25694.26 | 25694.26 | 4.73 | 4.73 | 4.73 | 63.64 | 55.56 | 55.56 |

## Key findings
- Largest Phase 4 pool relief: 2025 Tariff Shock (4.37 improvement in minimum pool balance)
- Largest Phase 4 miss cost (10d average from blocked/delayed signals): 2020 Covid Crash (24.12%)
- Guard miss-cost metrics are shown as forward returns after blocked or delayed Vmin signals. Positive values mean waiting missed some rebound; negative values mean waiting avoided further downside.

## Recommended next step
Use this report to decide whether a further release-tuning pass should only adjust:
- MEDIUM snapback sensitivity
- reset persistence length
- fast rebound recognition thresholds

No engine change is recommended from this report alone.

## Known limitations
- This pass measures replayed execution timing only. It does not retune the guard.
- Miss-cost uses forward asset returns after blocked/delayed trigger dates, not a counterfactual optimized fill model.
- Reset quality uses a simple missed-rebound rule for auditability.
