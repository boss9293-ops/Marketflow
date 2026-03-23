# Event Market Benchmark Validation Report

**Goal:** Prove Explainable VR wins where it matters
**Episodes:** 2011 Debt Ceiling | 2020 Covid Crash | 2025 Tariff Shock
**Engines:** VR Original v2 | Explainable VR (v1.5 primary) | MA200 (50%)
**Date:** 2026-03-22

---

## 1. Episode Performance Summary

| episode | VR v2 final | Expl final | MA200 final | Expl vs MA200 | VR v2 DD% | Expl DD% | MA200 DD% | VR v2 recov | Expl recov | MA200 recov |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 15603.47 | 10876.97 | 9518.81 | 1358.16 | -43.42 | -49.98 | -7.39 | 7 | - | 0 |
| 2020 Covid Crash | 10895.52 | 10906.08 | 9772.11 | 1133.97 | -60.16 | -16.25 | -7.74 | - | 11 | 23 |
| 2025 Tariff Shock | 17303.87 | 16338.71 | 9723.5 | 6615.21 | -55.38 | -34.68 | -5.77 | - | 23 | 0 |

---

## 2. Snapback Window Analysis

Snapback window: from event low bar to first bar where rebound >= 15% (max 60 bars)

| episode | VR v2 snap_exp% | Expl snap_exp% | MA200 snap_exp% | snap_window_days | VR v2 snap_buys | Expl snap_buys |
| --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | 99.33 | 16.53 | 9.99 | 40 | 2 | 2 |
| 2020 Covid Crash | 99.93 | 40.97 | 0 | 16 | 0 | 1 |
| 2025 Tariff Shock | 99.39 | 55.1 | 0 | 17 | 0 | 0 |

---

## 3. KPI Evaluation

| KPI | Rule |
| --- | --- |
| KPI-1 | Expl final_value > MA200 final_value |
| KPI-2 | Expl recovery_days < MA200 recovery_days |
| KPI-3 | Expl max_dd > VR v2 max_dd (less negative = lower risk) |
| KPI-4 | Expl snapback exposure >= 70% of VR v2 snapback exposure |

| episode | KPI-1 final_up | KPI-2 recov_faster | KPI-3 dd_down | KPI-4 snap_ratio | ALL |
| --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | PASS | FAIL | FAIL | 0.166 (FAIL) | FAIL ❌ |
| 2020 Covid Crash | PASS | PASS | PASS | 0.41 (FAIL) | FAIL ❌ |
| 2025 Tariff Shock | PASS | FAIL | PASS | 0.554 (FAIL) | FAIL ❌ |

---

## VERDICT: PARTIAL — 0/3 episodes pass all KPIs

---

*Engines: vr_original_v2 is FROZEN. Explainable VR primary = v1.5 (enableMacroGating=true).*
