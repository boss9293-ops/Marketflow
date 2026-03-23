# VR Final Engine Validation Report

Generated: 2026-03-22T02:19:33.104Z

## Overview

This report validates the Explainable VR engine finalization.

| Label | Engine | Macro Gating | Description |
|-------|--------|-------------|-------------|
| A (v1.3) | explainable_vr_v1 | OFF | Baseline |
| B (v1.5 off) | explainable_vr_v1 | OFF | Same as A |
| C (v1.5 on) | explainable_vr_v1 | ON | Production candidate |
| BENCH | vr_original_v2 | N/A | Benchmark |

**Target Episodes:** 2011-06, 2020-02, 2021-12, 2025-01

---

## Table 5.1 — Deterministic Episode Comparison

| Episode | Engine | Final Value | Max DD% | Avg Exp% | Snapback Score |
|---------|--------|-------------|---------|----------|----------------|
| 2020-02 | A_v1.3 | 16487.52 | -44.69 | 57.41 | 0.27 |
| 2020-02 | B_v1.5_off | 16487.52 | -44.69 | 57.41 | 0.27 |
| 2020-02 | C_v1.5_on | 16487.52 | -44.69 | 57.41 | 0.27 |
| 2020-02 | BENCH | 19030.56 | -69.91 | 99.27 | 0.5 |
| 2021-12 | A_v1.3 | 22384.34 | -32.86 | 47.42 | 0 |
| 2021-12 | B_v1.5_off | 22384.34 | -32.86 | 47.42 | 0 |
| 2021-12 | C_v1.5_on | 22384.34 | -32.86 | 47.42 | 0 |
| 2021-12 | BENCH | 11140.95 | -81.32 | 93.85 | 0.498 |
| 2011-06 | A_v1.3 | 12122.65 | -53.69 | 69.56 | 0.4 |
| 2011-06 | B_v1.5_off | 12122.65 | -53.69 | 69.56 | 0.4 |
| 2011-06 | C_v1.5_on | 12122.65 | -53.69 | 69.56 | 0.4 |
| 2011-06 | BENCH | 28195.05 | -49.57 | 90.86 | 0.4 |
| 2025-01 | A_v1.3 | 21113.05 | -41.73 | 70.58 | 0.917 |
| 2025-01 | B_v1.5_off | 21113.05 | -41.73 | 70.58 | 0.917 |
| 2025-01 | C_v1.5_on | 21113.05 | -41.73 | 70.58 | 0.917 |
| 2025-01 | BENCH | 23528.36 | -56.57 | 90.58 | 0.393 |

---

## Table 5.2 — Mode Statistics

| Episode | Total Bars | Normal | Crisis | Crisis Ratio | Macro Headwind |
|---------|-----------|--------|--------|-------------|----------------|
| 2020-02 | 467 | 137 | 330 | 70.7% | 0 |
| 2021-12 | 719 | 144 | 575 | 80.0% | 44 |
| 2011-06 | 552 | 329 | 223 | 40.4% | 0 |
| 2025-01 | 494 | 281 | 213 | 43.1% | 0 |

---

## Table 5.3 — Behavior Delta (A vs C)

| Episode | A Final | C Final | Diff | Blocked Entries |
|---------|---------|---------|------|----------------|
| 2020-02 | 16487.52 | 16487.52 | 0 | 0 |
| 2021-12 | 22384.34 | 22384.34 | 0 | 0 |
| 2011-06 | 12122.65 | 12122.65 | 0 | 0 |
| 2025-01 | 21113.05 | 21113.05 | 0 | 0 |

---

## Part 4 — Monte Carlo Results (500 paths, 252 days)

| Engine | N | P5 Final | Median Final | Median MDD | Avg Exposure | Snap Score | Snap Success% | Tail P5 | Worst DD |
|--------|---|----------|-------------|-----------|-------------|-----------|-------------|--------|---------|
| A_v1.3 | 500 | 2013.7 | 7466.78 | -60.91% | 74.94% | 0.472 | 79.6% | 2013.7 | -90.72% |
| C_v1.5_on | 500 | 2013.7 | 7465.9 | -60.91% | 74.94% | 0.47 | 79% | 2013.7 | -90.72% |
| BENCH | 500 | 809.98 | 7326.71 | -70.48% | 92.09% | 0.68 | 100% | 809.98 | -99.27% |

---

## Part 5 — Decision (§8 Acceptance Criteria)

| Criterion | Threshold | A Value | C Value | Pass |
|-----------|-----------|---------|---------|------|
| 1. 2022 final C>=A | C >= A | 22384.34 | 22384.34 | YES |
| 2. MC tail C>=A*0.95 | 1913.015 | 2013.7 | 2013.7 | YES |
| 3. No degrade 2011/2020/2025 | C>=A*0.95 per ep | — | — | YES |
| 4. Snapback rate C>=A*0.70 | 55.72% | 79.6% | 79% | YES |

## Final Decision: **ACCEPT**

**v1.5 macro ON is accepted.** All 4 acceptance criteria passed. Macro policy gating (CRISIS/POLICY_HEADWIND) approved for production.

---

## Output Files

- `vr_backtest/results/final_engine/vr_final_engine_summary.json`
- `vr_backtest/results/final_engine/vr_mode_stats.csv`
- `vr_backtest/results/final_engine/vr_mc_comparison.csv`
- `vr_backtest/results/final_engine/vr_decision_log.md`
- `docs/vr_final_engine_report.md`
