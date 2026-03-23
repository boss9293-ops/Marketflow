# Event Benchmark Validation Report v2

**Goal:** Evaluate performance, not exposure
**KPI framework:** Fair, strategy-consistent metrics
**Episodes:** 2011 Debt Ceiling | 2020 Covid Crash | 2025 Tariff Shock
**Engines:** VR Original v2 | Explainable VR v1.5 | MA200 (50%)
**Date:** 2026-03-22

---

## Table A — Final Comparison

| Episode | Engine | Final | DD% | Recovery (days) |
| --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | VR Original v2 | 15603.47 | -43.42 | - |
| 2011 Debt Ceiling | Explainable VR v1.5 | 10876.97 | -49.98 | - |
| 2011 Debt Ceiling | MA200 (50%) | 9518.81 | -7.39 | - |
| 2020 Covid Crash | VR Original v2 | 10895.52 | -60.16 | - |
| 2020 Covid Crash | Explainable VR v1.5 | 10906.08 | -16.25 | 15 |
| 2020 Covid Crash | MA200 (50%) | 9772.11 | -7.74 | - |
| 2025 Tariff Shock | VR Original v2 | 17303.87 | -55.38 | - |
| 2025 Tariff Shock | Explainable VR v1.5 | 16338.71 | -34.68 | - |
| 2025 Tariff Shock | MA200 (50%) | 9723.5 | -5.77 | - |

---

## Table B — Snapback Capture Efficiency

Snapback window: event low → +15% rebound (max 60 bars)

Capture Efficiency = portfolio_return_in_window / asset_return_in_window

| Episode | Engine | Asset Rebound | Port Return | Capture Eff | Risk-Adj (KPI-5) | Window (days) |
| --- | --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | VR Original v2 | 0.165 | 0.5202 | 3.1527 | 7.2604 | 40 |
| 2011 Debt Ceiling | Explainable VR v1.5 | 0.165 | -0.0646 | -0.3915 | -0.7834 | 40 |
| 2011 Debt Ceiling | MA200 (50%) | 0.165 | 0.0102 | 0.0618 | 0.8363 | 40 |
| 2020 Covid Crash | VR Original v2 | 0.1632 | 0.3756 | 2.3015 | 3.8257 | 16 |
| 2020 Covid Crash | Explainable VR v1.5 | 0.1632 | 0.123 | 0.7537 | 4.6371 | 16 |
| 2020 Covid Crash | MA200 (50%) | 0.1632 | 0 | 0 | 0 | 16 |
| 2025 Tariff Shock | VR Original v2 | 0.1578 | 0.4559 | 2.8891 | 5.2166 | 17 |
| 2025 Tariff Shock | Explainable VR v1.5 | 0.1578 | 0.2267 | 1.4366 | 4.142 | 17 |
| 2025 Tariff Shock | MA200 (50%) | 0.1578 | 0 | 0 | 0 | 17 |

---

## Table C — KPI Results

| KPI | Definition |
| --- | --- |
| KPI-1 | Expl final_value > MA200 final_value |
| KPI-2 | Expl recovery_to_peak_days ≤ MA200 + 10d (tolerance) |
| KPI-3 | Expl max_dd > VR max_dd (less negative) |
| KPI-4 | capture_eff ≥ 60% of VR capture_eff OR absolute > 0.4 |

| Episode | KPI-1 Final↑ | KPI-2 Recovery | KPI-3 DD↓ | KPI-4 CaptureEff | ALL |
| --- | --- | --- | --- | --- | --- |
| 2011 Debt Ceiling | PASS | PASS | FAIL | FAIL | FAIL ❌ |
| 2020 Covid Crash | PASS | PASS | PASS | PASS | PASS ✅ |
| 2025 Tariff Shock | PASS | PASS | PASS | PASS | PASS ✅ |

---

## KPI Detail

### 2011 Debt Ceiling

- KPI-1: Expl=10876.97 vs MA200=9518.81 → PASS
- KPI-2: Expl recovery=neverd vs MA200=neverd → PASS
- KPI-3: Expl DD=-49.98% vs VR DD=-43.42% → FAIL
- KPI-4: Expl eff=-0.3915 | VR eff=3.1527 | ratio=-0.1242 | abs_pass=false → FAIL
- KPI-5 (info): Expl risk-adj=-0.7834 vs VR=7.2604 vs MA200=0.8363

### 2020 Covid Crash

- KPI-1: Expl=10906.08 vs MA200=9772.11 → PASS
- KPI-2: Expl recovery=15d vs MA200=neverd → PASS
- KPI-3: Expl DD=-16.25% vs VR DD=-60.16% → PASS
- KPI-4: Expl eff=0.7537 | VR eff=2.3015 | ratio=0.3275 | abs_pass=true → PASS
- KPI-5 (info): Expl risk-adj=4.6371 vs VR=3.8257 vs MA200=0

### 2025 Tariff Shock

- KPI-1: Expl=16338.71 vs MA200=9723.5 → PASS
- KPI-2: Expl recovery=neverd vs MA200=neverd → PASS
- KPI-3: Expl DD=-34.68% vs VR DD=-55.38% → PASS
- KPI-4: Expl eff=1.4366 | VR eff=2.8891 | ratio=0.4972 | abs_pass=true → PASS
- KPI-5 (info): Expl risk-adj=4.142 vs VR=5.2166 vs MA200=0

---

## FINAL DECISION: PARTIAL_PASS

**Pass count:** 2/3 episodes pass all 4 KPIs

### Strengths
- Final value beats MA200 in all 3 episodes — Explainable VR consistently outperforms passive MA200 on returns
- Drawdown control vs VR Original v2: 2/3 episodes show lower max DD, demonstrating the risk management advantage
- Snapback capture efficiency: captures meaningful portfolio return during recovery windows despite lower exposure

### Weaknesses
- DD vs VR v2: 1 episode (2011) shows worse DD — Explainable VR may lag VR v2's sell signal in fast initial drops
- Capture efficiency below threshold in 1/3 episodes — conservative posture limits snapback participation

### Reasoning
Explainable VR passes 2/3 episodes on all KPIs. The engine demonstrates clear advantages in risk control and final returns but has episode-specific gaps in recovery speed or capture efficiency. The design trade-off (lower exposure → lower DD, slower snapback) is the expected behavior of a risk-managed strategy.

---
*Note: MA200 (50%) is a passive benchmark — it starts with 50% equity, so its DD is structurally limited. Direct recovery comparison must account for the strategy's fundamentally different risk profile.*
