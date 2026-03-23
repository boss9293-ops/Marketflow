# Monte Carlo Survival Framework V1
## Leveraged ETF Survival Research — MarketFlow / VR Study

**Version:** 1.0
**Date:** 2026-03-16
**Status:** Framework Definition (Pre-Implementation)

---

## 1. Purpose

This framework defines the research philosophy, survival criteria, and operational rules for testing leveraged ETF strategies across multiple crash scenarios.

The goal is **not** to predict price. The goal is to determine which strategy configurations survive across a wide distribution of crash paths — and retain the ability to participate in recovery.

This is a survival study first. Profit is a secondary outcome.

---

## 2. Survival Definition

A strategy is considered **alive** if it satisfies all three conditions simultaneously:

1. **Capital remains** — the strategy holds non-zero assets
2. **Pool is not exhausted** — reserve capital for future action has not been fully depleted
3. **Ability to act** — the strategy retains the capacity to make at least one more move

The critical concept is the third condition. A strategy that is technically solvent but has no pool remaining is functionally dead — it cannot buy the recovery. Survival means **the strategy can still make the next move**.

A strategy fails the survival test the moment it loses the ability to act, regardless of current asset value.

---

## 3. Crash Detector

Crash mode activates when **both** of the following conditions are simultaneously true:

| Indicator | Threshold | Description |
|-----------|-----------|-------------|
| Speed4    | ≤ −10%    | 4-day cumulative price change |
| DD        | ≤ −15%    | Drawdown from most recent peak |

**Speed4** measures short-term price velocity — a rapid 4-day decline of −10% or more signals the onset of a crash environment, not a routine pullback.

**DD** measures the depth of the current drawdown from the recent peak. A −15% drawdown combined with high speed confirms a structural decline rather than noise.

### Critical Rule

> **Vmax must NOT be used in crash detection.**

Vmax is a harvest signal derived from upward price extremes. Using it as a crash filter would introduce look-ahead bias and logical inconsistency — crash detection must be based solely on downward price and drawdown metrics.

---

## 4. Normal Market Mode

When the crash detector is **not** triggered, the strategy operates in standard VR mode:

- **Vmin buy** is enabled — buys on intraday/short-term price dips
- **Harvest sell** is enabled — takes profit at Vmax and time-based triggers
- **Pool accumulation** is active — harvest proceeds build the reserve pool

Normal mode is the strategy's natural state. All core VR rules apply without restriction.

---

## 5. Crash Mode Behavior

When the crash detector triggers, the strategy immediately shifts behavior:

- **Vmin buy is disabled** — no standard dip-buying
- **Pool is preserved** — no discretionary draws from reserve
- **Harvest sell remains enabled** — if a harvest opportunity exists, it is taken
- Strategy enters **wait state** pending bottom detection

### Why Disable Vmin During Crash

During a crash, Vmin signals appear on nearly every trading day. The price is falling fast. If Vmin buys were permitted, the pool would be exhausted buying into a declining asset on multiple consecutive days — long before the true bottom is reached.

Disabling Vmin during crash mode is the primary mechanism for **pool preservation**. The pool must survive the crash intact so it can be deployed at the bottom.

---

## 6. Bottom Detector

A **bottom zone candidate** is identified when all three conditions are simultaneously true:

| Condition | Requirement |
|-----------|-------------|
| Crash mode active | The crash detector has triggered and remains active |
| DD        | ≤ −20% from peak |
| Volume    | ≥ 2× AvgVolume20 (20-day average volume) |

The volume spike requirement is essential. A drawdown of −20% alone is insufficient — the market must also exhibit capitulation-level volume, which historically accompanies genuine selling exhaustion.

### Philosophy

This detector does **not** predict the exact bottom. No such prediction is possible. It identifies a **practical capitulation zone** — a region where the combination of depth and volume surge makes ladder deployment rational. Some ladder buys will occur before the exact bottom; that is expected and acceptable.

---

## 7. Ladder Buy Structure

Once the bottom zone is confirmed, the strategy deploys capital through a **price-based ladder** — not a time-based one.

### Why Price-Based

Time-based ladders (e.g., buy every 5 days) are indifferent to price action. A price-based ladder ensures each buy step occurs at a genuinely lower price level, improving average cost and aligning deployment with actual market movement.

### Example Ladder Structure

| Step | Drawdown Trigger |
|------|-----------------|
| 1    | DD ≤ −20%       |
| 2    | DD ≤ −25%       |
| 3    | DD ≤ −30%       |
| 4    | DD ≤ −35%       |
| 5    | DD ≤ −40%       |

Each step deploys a defined fraction of the crash pool allocation. Steps are non-repeating — each DD threshold triggers at most once per crash event.

The specific per-step allocation amounts are research parameters to be determined through simulation.

---

## 8. Pool Management

The pool is the strategy's operational reserve. All pool management rules exist to ensure the strategy remains alive through the full crash-and-recovery cycle.

### Pool Usage Constraint

> **The crash ladder may use at most 50% of the total pool.**

The remaining 50% is the **survival reserve** and may not be used for crash ladder buys under any circumstances.

This rule exists because crash depth is unknown in advance. A crash that reaches −40% may continue to −50% or −60%. Without a hard survival reserve, a fully deployed ladder could exhaust the pool before recovery begins — eliminating the strategy's ability to act.

### Pool Size Target

Pool size should be managed as a **ratio of total assets**, not as a fixed dollar amount. As total assets grow during bull markets, the pool grows proportionally. This ensures the pool remains meaningful relative to the strategy's scale.

The specific target ratio is a research parameter.

---

## 9. Harvest Philosophy

Pool replenishment occurs through two mechanisms:

### Vmax Harvest
Sell a portion of holdings when the price reaches an extreme upper threshold (Vmax). This captures profit at moments of overextension and returns capital to the pool.

### Time Harvest
Periodically take partial profits based on elapsed time, regardless of price level. This ensures the pool is replenished even during slow, grinding bull markets where Vmax may rarely trigger.

### Design Principle

The harvest system exists to rebuild the pool between crash events. A strategy that deploys its pool during a crash but never replenishes it will be progressively less capable of surviving each subsequent crash.

Pool management is a continuous process — accumulate during calm, preserve during crash, deploy at capitulation, replenish during recovery.

---

## 10. Research Goals

The framework described above defines the rules. The research questions are:

1. **Survival rate** — Across N simulated crash paths, what fraction of parameter configurations survive per the survival definition?

2. **Pool preservation** — Which configurations maintain sufficient pool integrity to deploy at the bottom zone?

3. **Recovery participation** — After surviving a crash, which configurations capture meaningful recovery upside?

4. **Parameter sensitivity** — How sensitive are outcomes to ladder step sizes, pool ratios, harvest thresholds, and DD triggers?

5. **Worst-case analysis** — What are the conditions under which even conservative configurations fail? What is the failure mode?

The priority order for evaluating any configuration is fixed:

```
1. Survival
2. Bottom buying capability
3. Recovery participation
4. Profit
```

A configuration that produces high profit but fails survival in 30% of paths is not acceptable. Survival is non-negotiable.

---

## Appendix: Glossary

| Term | Definition |
|------|-----------|
| Speed4 | 4-day cumulative price change (%) |
| DD | Drawdown from the most recent peak (%) |
| Vmin | Short-term intraday/swing price minimum — buy signal in normal mode |
| Vmax | Short-term intraday/swing price maximum — harvest signal |
| Pool | Reserved capital available for strategic deployment |
| Crash mode | Operational state triggered when Speed4 ≤ −10% AND DD ≤ −15% |
| Bottom zone | Capitulation candidate: crash mode active + DD ≤ −20% + Volume ≥ 2×AvgVol20 |
| Survival reserve | Minimum 50% of pool, never deployed in crash ladder |
| AvgVolume20 | Simple 20-day average daily volume |

---

*This document defines the research philosophy and operational rules only. No simulation code is included.*
