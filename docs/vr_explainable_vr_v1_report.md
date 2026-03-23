# Explainable VR v1 Report

## Implementation summary
This pass validates Explainable VR v1 as a deterministic state-machine replay engine.

The strategy keeps the existing VR playback environment intact and adds:
- five explicit states: NORMAL, WARNING, RISK_OFF, BOTTOM_WATCH, RE_ENTRY
- deterministic energy / structure / recovery / retest rules
- explainable per-bar outputs for state, permissions, exposure target, and reason code

The original VR playback and the current vFinal engine are unchanged.

## Validation method
- Source archives: `risk_v1_playback.json` and `vr_survival_playback.json`
- Cap setting: `50%`
- Compared engines:
  - Original VR (Playback)
  - Scenario VR (vFinal)
  - Explainable VR v1
- Required episodes:
  - 2011 Debt Ceiling
  - 2020 Covid Crash
  - 2022 Fed Bear
- Optional episode:
  - 2025 Tariff Shock when available

## Episode comparison tables
### Portfolio outcome and exposure
| event | original_final | vfinal_final | explainable_final | explainable_vs_original | explainable_vs_vfinal | original_dd | vfinal_dd | explainable_dd | original_avg_exposure | vfinal_avg_exposure | explainable_avg_exposure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 15311.4 | 15809.79 | 10318.4 | -4993 | -5491.39 | -41.5 | -42.25 | -52.64 | 93.58 | 93.95 | 48.64 |
| 2020 Covid Crash | 10909.34 | 11245.2 | 9208.54 | -1700.8 | -2036.66 | -60.17 | -62.74 | -16.24 | 99.98 | 91.16 | 36.11 |
| 2022 Fed Bear | 6811.37 | 14439.79 | 15442.08 | 8630.71 | 1002.29 | -80.61 | -46.54 | -29.08 | 99.27 | 30.06 | 12.68 |
| 2025 Tariff Shock | 17301.34 | 19941.48 | 14817.4 | -2483.94 | -5124.08 | -54.76 | -21.23 | -22.59 | 95.04 | 44.46 | 35.54 |

### Explainable state diagnostics
| event | normal_days | warning_days | risk_off_days | bottom_watch_days | re_entry_days | first_risk_off | first_reentry | partial_reentry_days | snapback_entry_days | reentry_delayed_days |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 44 | 24 | 3 | 10 | 61 | 2011-08-08 | 2011-08-12 | 1 | 2 | 58 |
| 2020 Covid Crash | 0 | 5 | 3 | 11 | 38 | 2020-03-03 | 2020-03-13 | 0 | 1 | 37 |
| 2022 Fed Bear | 8 | 13 | 8 | 102 | 178 | 2022-01-19 | 2022-01-28 | 1 | 1 | 176 |
| 2025 Tariff Shock | 18 | 16 | 1 | 21 | 28 | 2025-03-03 | 2025-03-17 | 0 | 1 | 27 |

## Key findings
- 2011 Debt Ceiling: first RISK_OFF at 41 bars, first RE_ENTRY at 45 bars, snapback entries 2.
- 2020 Covid Crash: first RISK_OFF at 6 bars, BOTTOM_WATCH days 11, snapback entries 1.
- 2022 Fed Bear: avg event exposure Original 99.27 vs Explainable 12.68, with BOTTOM_WATCH days 102 and RE_ENTRY delayed days 176.

## Recommended next step
If the state machine is directionally correct but underperforms on a specific episode, tune thresholds inside the explainable engine only after reviewing:
- first RISK_OFF timing
- time spent in BOTTOM_WATCH
- first RE_ENTRY timing
- snapback versus delayed re-entry counts

## Known limitations
- Explainable VR v1 currently reuses the same playback environment and cap framework as vFinal, so it is comparable but not yet exposed as a first-class UI engine.
- This report focuses on replay auditability, not parameter optimization.
- Optional 2025 coverage depends on the local playback archive.
