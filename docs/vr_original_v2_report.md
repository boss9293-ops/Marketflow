# VR Engine Report — v1.3 Snapback Capture Optimization

## A. Episode Summary (4-way)

| episode | orig_final | expl_final | v2_final | expl_dd | v2_dd | expl_avg_exp | expl_buys |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 15311.4 | 10876.97 | 15603.47 | -49.98 | -43.42 | 43.93 | 11 |
| 2020 Covid Crash | 10909.34 | 10906.08 | 10895.52 | -16.25 | -60.16 | 49.47 | 10 |
| 2022 Fed Bear | 6811.37 | 16127.05 | 6763.61 | -31.85 | -80.93 | 14.69 | 13 |
| 2025 Tariff Shock | 17301.34 | 16338.71 | 17303.87 | -34.68 | -55.38 | 52.22 | 10 |

## B. Snapback Window Comparison

| episode | engine | window_days | snap_avg_exp | snap_total_deploy | snap_buys | first_buy_bar | capture_score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | explainable_v1.3 | 2 | 97.59 | 0 | 0 | - | 0.39 |
| 2011 Debt Ceiling | vr_original_v2 | 2 | 94.14 | 0 | 0 | - | 0.377 |
| 2020 Covid Crash | explainable_v1.3 | 2 | 32.05 | 0 | 0 | - | 0.128 |
| 2020 Covid Crash | vr_original_v2 | 2 | 99.97 | 0 | 0 | - | 0.4 |
| 2022 Fed Bear | explainable_v1.3 | 2 | 67.19 | 0 | 0 | - | 0.269 |
| 2022 Fed Bear | vr_original_v2 | 2 | 95.86 | 0 | 0 | - | 0.383 |
| 2025 Tariff Shock | explainable_v1.3 | 2 | 53.12 | 0 | 0 | - | 0.212 |
| 2025 Tariff Shock | vr_original_v2 | 2 | 95.06 | 0 | 0 | - | 0.38 |

## C. Decision Summary

| episode | v1_3_final | v1_3_snap_score | v1_3_avg_exposure | v1_3_max_dd | decision | reason |
| --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 10876.97 | 0.39 | 43.93 | -49.98 | ADOPTED ✅ | snapback capture score OK + 2022 safety intact |
| 2020 Covid Crash | 10906.08 | 0.128 | 49.47 | -16.25 | REJECTED ❌ | snapback score too low  |
| 2022 Fed Bear | 16127.05 | 0.269 | 14.69 | -31.85 | REJECTED ❌ | snapback score too low  |
| 2025 Tariff Shock | 16338.71 | 0.212 | 52.22 | -34.68 | REJECTED ❌ | snapback score too low  |

---
*engine_id=vr_original_v2 is FROZEN. DO NOT MODIFY.*
