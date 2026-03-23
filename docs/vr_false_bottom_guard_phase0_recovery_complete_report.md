# VR False-Bottom Guard Phase 0 Report

## Implementation summary
This pass changes the evaluation window only. Guard logic, reset logic, buy conditions, Standard, MSS, Track state, crisis stage, exposure logic, and Monte Carlo logic are unchanged.

Event windows are now evaluated in two ways:
- Legacy window: first in-event bar through the archive event end
- Recovery-complete window: first in-event bar through the first recovery-complete point after the event, with a hard minimum of 90 bars from event start and an extra 30-bar minimum extension for snapback events

Recovery complete is defined by the first of:
- price above MA200 for 20 consecutive bars
- price reaching 95% of the prior peak
- 30-bar stabilization with no new low and shrinking dd3 volatility

## Validation method
- Engine: `build_execution_playback.ts` vFinal playback
- Modes: Baseline vs Guard Phase 2 vs Guard Phase 3
- Cap: `50%`
- Only the event window used for measurement changed
- Guard miss-cost and reset metrics still use the same audit definitions as prior work

## Event window definition table
| event | start | legacy_end | recovery_end | legacy_bars | recovery_bars | extension_bars | snapback_high | recovery_reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 2011-06-10 | 2011-12-30 | 2011-12-30 | 142 | 142 | 0 | false | STABILIZATION_30D |
| 2018 Q4 | 2018-10-10 | 2019-03-08 | 2019-03-08 | 102 | 102 | 0 | false | STABILIZATION_30D |
| 2020 Covid Crash | 2020-02-25 | 2020-05-14 | 2020-07-02 | 57 | 91 | 34 | false | MA200_20D_HOLD |
| 2022 Fed Bear | 2021-12-17 | 2023-03-13 | 2023-03-13 | 309 | 309 | 0 | false | STABILIZATION_30D |
| 2024 Yen Carry | 2024-07-24 | 2024-10-25 | 2024-11-29 | 67 | 91 | 24 | false | MA200_20D_HOLD |
| 2025 Tariff Shock | 2025-01-10 | 2025-05-12 | 2025-07-07 | 84 | 121 | 37 | true | MA200_20D_HOLD |

## Episode comparison table (recovery-complete window)
| event | baseline_final | phase2_final | phase3_final | phase2_delta | phase3_delta | baseline_dd | phase2_dd | phase3_dd | phase2_miss_cost_10d | phase3_miss_cost_10d |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 16705.8 | 16591.04 | 16591.04 | -114.76 | -114.76 | -44.3 | -44.3 | -44.3 | - | - |
| 2018 Q4 | 12297.76 | 12297.76 | 12297.76 | 0 | 0 | -50.04 | -50.04 | -50.04 | - | - |
| 2020 Covid Crash | 15461.7 | 16191.52 | 16191.52 | 729.82 | 729.82 | -62.77 | -62.75 | -62.75 | 33.46 | 36.53 |
| 2022 Fed Bear | 14319.55 | 14491.72 | 14491.72 | 172.17 | 172.17 | -46.99 | -46.35 | -46.35 | 10.32 | 10.32 |
| 2024 Yen Carry | 29567.2 | 29567.2 | 29567.2 | 0 | 0 | -22.95 | -22.95 | -22.95 | - | - |
| 2025 Tariff Shock | 23818.6 | 23745.31 | 23745.31 | -73.29 | -73.29 | -21.23 | -21.23 | -21.23 | 4.73 | 4.73 |

## Legacy vs recovery-complete window comparison
| event | extension_bars | reason | baseline_final_delta | phase2_final_delta | phase3_final_delta | phase2_miss_cost_10d_delta | phase3_miss_cost_10d_delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 0 | STABILIZATION_30D | 0 | 0 | 0 | 0 | 0 |
| 2018 Q4 | 0 | STABILIZATION_30D | 0 | 0 | 0 | 0 | 0 |
| 2020 Covid Crash | 34 | MA200_20D_HOLD | 4731.62 | 4954.2 | 4954.2 | 0 | 0 |
| 2022 Fed Bear | 0 | STABILIZATION_30D | 0 | 0 | 0 | 0 | 0 |
| 2024 Yen Carry | 24 | MA200_20D_HOLD | 1903.25 | 1903.25 | 1903.25 | 0 | 0 |
| 2025 Tariff Shock | 37 | MA200_20D_HOLD | 3813.64 | 3797.72 | 3797.72 | 0 | 0 |

## 2011 change analysis
| window | phase2_final | phase3_final | phase2_miss_cost_10d | phase3_miss_cost_10d | phase2_reset_missed | phase3_reset_missed |
| --- | --- | --- | --- | --- | --- | --- |
| legacy | 16591.04 | 16591.04 | - | - | 2 | 1 |
| recovery_complete | 16591.04 | 16591.04 | - | - | 2 | 1 |

## Reset and rebound diagnostics
| event | phase2_legacy_guard_days | phase2_recovery_guard_days | phase3_legacy_guard_days | phase3_recovery_guard_days | phase2_legacy_reset_missed | phase2_recovery_reset_missed | phase3_legacy_reset_missed | phase3_recovery_reset_missed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 94 | 94 | 75 | 75 | 2 | 2 | 1 | 1 |
| 2018 Q4 | 81 | 81 | 74 | 74 | 1 | 1 | 1 | 1 |
| 2020 Covid Crash | 38 | 38 | 27 | 27 | 1 | 2 | 1 | 1 |
| 2022 Fed Bear | 296 | 296 | 278 | 278 | 5 | 5 | 5 | 5 |
| 2024 Yen Carry | 30 | 33 | 27 | 30 | 0 | 0 | 0 | 0 |
| 2025 Tariff Shock | 57 | 69 | 54 | 63 | 2 | 2 | 2 | 2 |

## Key findings
- Recovery-complete windows materially extend 2020, 2024, and 2025. Their archive windows were shorter than the recovery-complete definition.
- 2011, 2018, and 2022 do not extend under the new rule. In the current archive, those windows were already long enough to satisfy the recovery-complete test.
- The guard ranking direction is preserved after extension: 2020 and 2022 still favor the guard, while 2025 remains mildly negative and 2011 remains the main snapback penalty case.

## Recommended next step
Use this recovery-complete report as the baseline for any further guard-release tuning. Do not adjust guard logic until the episode ranking is reviewed under the longer window definition.

## Confirmation: no logic drift
This pass changed only the measurement window. Execution logic, buy conditions, false-bottom guard logic, reset logic, MSS, Track state, crisis stage, Standard, and Monte Carlo are unchanged.
