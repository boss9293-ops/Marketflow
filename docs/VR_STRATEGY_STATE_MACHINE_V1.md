# VR Strategy State Machine V1
## Leveraged ETF Survival — State Machine Definition

**Version:** 1.0
**Date:** 2026-03-16
**Status:** Design Definition (Pre-Implementation)

---

## Overview

The strategy operates as a deterministic finite state machine with six states. At any point in time the strategy occupies exactly one state. Transitions are driven by observable market conditions — price, drawdown, volume, and time. No prediction is required; every transition condition is computable from historical data.

```
S0_NORMAL
    │
    │ Speed4 ≤ −10% AND DD ≤ −15%
    ▼
S1_CRASH_ALERT
    │
    │ Crash conditions persist (next evaluation)
    ▼
S2_CRASH_HOLD ◄──────────────────────────────────┐
    │                                             │
    │ DD ≤ −20% AND Volume ≥ 2×AvgVolume20        │
    ▼                                             │
S3_BOTTOM_ZONE                                   │
    │                                             │
    │ Price stabilization after ladder buy        │
    ▼                                             │
S4_RECOVERY                                      │
    │                                             │ (if crash re-triggers)
    │ Crash detector inactive                     │
    ▼                                             │
S5_REBUILD ──────────────────────────────────────┘
    │
    │ Normal regime sustained
    ▼
S0_NORMAL
```

---

## State Definitions

---

### S0_NORMAL — Normal Market

The baseline operating state. The original VR system runs without restriction.

**Description:**
Market conditions show no crash signal. Speed4 and DD are within acceptable bounds. The strategy executes its full rule set.

**Allowed Actions:**
- Vmin buy — purchase on short-term price dips
- Vmax harvest — take partial profits at upper price extremes
- Time harvest — take partial profits on schedule
- Pool accumulation — harvest proceeds flow into reserve pool
- All standard VR position sizing and rebalancing

**Blocked Actions:**
- Crash ladder deployment
- Emergency pool preservation

**Entry Condition:**
- Initial state, OR transition from S5_REBUILD when normal regime is sustained

---

### S1_CRASH_ALERT — Crash Alert

Crash detector has fired. The strategy immediately suspends routine buying and begins protective posture.

**Description:**
Both crash conditions are true simultaneously. This state is intentionally brief — it exists to enforce a clean behavioral transition rather than allowing the strategy to oscillate between normal buying and crash response.

**Allowed Actions:**
- Vmax harvest — if a harvest opportunity is present, it is taken (reduces exposure)
- Time harvest — permitted if scheduled
- Pool preservation — no new draws from pool

**Blocked Actions:**
- Vmin buy — immediately disabled upon entering this state
- Pool accumulation from normal operation — suspended
- Crash ladder deployment — not yet permitted (bottom zone not confirmed)

**Entry Condition:**
- From S0_NORMAL: `Speed4 ≤ −10% AND DD ≤ −15%`

---

### S2_CRASH_HOLD — Crash Hold

Crash conditions are confirmed as persistent. The strategy enters full defensive mode and waits for the bottom zone.

**Description:**
The crash detector remained active through the evaluation following S1_CRASH_ALERT. The decline is confirmed as a structural crash, not a transient spike. The primary objective is pool preservation.

**Allowed Actions:**
- Vmax harvest — permitted; reducing position during crash descent is acceptable
- Emergency stop-loss if defined in parameters (research parameter)
- Monitor DD and Volume for bottom zone transition

**Blocked Actions:**
- Vmin buy — blocked
- Crash ladder deployment — blocked until bottom zone confirmed
- Routine pool draws of any kind

**Entry Condition:**
- From S1_CRASH_ALERT: crash conditions persist at next evaluation cycle

**Note:** The strategy may remain in S2_CRASH_HOLD for an extended period — days to weeks — while waiting for DD and volume conditions to confirm the bottom zone. This waiting is correct behavior, not a malfunction.

---

### S3_BOTTOM_ZONE — Bottom Zone

Capitulation conditions are detected. Crash ladder deployment is authorized.

**Description:**
All three bottom detection conditions are simultaneously true. The strategy shifts from pure defense to controlled offense — deploying capital in structured price-based steps.

**Allowed Actions:**
- Crash ladder buy — each price-step trigger (DD −20%, −25%, −30%, −35%, −40%) activates the corresponding ladder step
- Vmax harvest — permitted if price briefly recovers between ladder steps
- Pool draw for ladder — subject to the 50% crash pool cap rule

**Blocked Actions:**
- Vmin buy — still blocked; only ladder buys are permitted
- Pool draw exceeding 50% of total pool — hard cap enforced regardless of DD depth
- Skipping ladder steps — each step must trigger independently at its DD level; no pre-emptive deployment

**Pool Cap Rule:**
The total capital deployed across all ladder steps in a single crash event must not exceed 50% of the pool balance at the moment crash mode was entered. The remaining 50% is the survival reserve and cannot be touched.

**Entry Condition:**
- From S2_CRASH_HOLD: `DD ≤ −20% AND Volume ≥ 2×AvgVolume20`

---

### S4_RECOVERY — Recovery

Price shows signs of stabilization following ladder deployment. The strategy begins transitioning toward normal operation.

**Description:**
After one or more ladder buys have been executed, the market shows early stabilization signals. The strategy evaluates ladder positions and cautiously re-enables harvest. Full VR normal mode is not yet restored — the crash detector may still be technically active or recently inactive.

**Allowed Actions:**
- Vmax harvest — re-enabled; take partial profits on recovering positions
- Time harvest — re-enabled on schedule
- Evaluation of ladder positions for partial harvest
- Monitoring for crash detector deactivation

**Blocked Actions:**
- Vmin buy — still blocked until S5_REBUILD or S0_NORMAL
- New crash ladder steps beyond those already triggered
- Pool accumulation targeting (active pool rebuild deferred to S5)

**Entry Condition:**
- From S3_BOTTOM_ZONE: price stabilization observed after at least one ladder buy

**Stabilization Definition (research parameter):**
Specific stabilization criteria (e.g., Speed4 returns above 0%, price holds above a ladder buy level for N days) are to be determined through simulation research. The exact definition is a tunable parameter.

---

### S5_REBUILD — Rebuild

Crash detector is no longer active. The strategy rebuilds its pool and gradually restores full VR logic.

**Description:**
The crash conditions have cleared. The market is no longer in crash mode. However, the pool has been partially depleted by ladder buys and requires rebuilding before full normal operation resumes. This state prevents the strategy from immediately re-entering S0_NORMAL with an underfunded pool.

**Allowed Actions:**
- Vmax harvest — active; proceeds directed to pool rebuild
- Time harvest — active; proceeds directed to pool rebuild
- Partial Vmin buy — may be re-enabled cautiously during rebuild (research parameter: full vs. reduced sizing)
- Pool rebuild accumulation — all harvest proceeds prioritize pool restoration

**Blocked Actions:**
- Full crash ladder authorization — ladder is reset; a new crash from S5 would transition back through S1→S2→S3
- Treating pool as fully restored until target ratio is met

**Entry Condition:**
- From S4_RECOVERY: `crash detector inactive` (Speed4 > −10% OR DD > −15%)

**Exit Condition (to S0_NORMAL):**
- Normal regime sustained — crash detector remains inactive for a defined sustained period AND pool ratio has recovered to target threshold
- Specific duration and pool ratio threshold are research parameters

---

## Transition Table

| From | To | Condition | Trigger |
|------|----|-----------|---------|
| S0_NORMAL | S1_CRASH_ALERT | `Speed4 ≤ −10% AND DD ≤ −15%` | Crash detector fires |
| S1_CRASH_ALERT | S2_CRASH_HOLD | Crash conditions persist at next evaluation | Confirmed crash |
| S1_CRASH_ALERT | S0_NORMAL | Crash conditions clear within one cycle | False alarm recovery |
| S2_CRASH_HOLD | S3_BOTTOM_ZONE | `DD ≤ −20% AND Volume ≥ 2×AvgVolume20` | Capitulation detected |
| S3_BOTTOM_ZONE | S4_RECOVERY | Price stabilization after ≥1 ladder buy | Market stabilizing |
| S4_RECOVERY | S5_REBUILD | Crash detector inactive | Crash conditions clear |
| S4_RECOVERY | S2_CRASH_HOLD | Crash re-triggers during recovery | Secondary crash leg |
| S5_REBUILD | S0_NORMAL | Normal regime sustained + pool at target | Full restoration |
| S5_REBUILD | S1_CRASH_ALERT | New crash event triggers | Re-entry into crash cycle |

---

## Actions Reference Table

| Action | S0 | S1 | S2 | S3 | S4 | S5 |
|--------|----|----|----|----|----|----|
| Vmin buy | ✓ | ✗ | ✗ | ✗ | ✗ | ◑ |
| Vmax harvest | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Time harvest | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| Pool accumulation | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Crash ladder buy | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Pool draw (ladder) | ✗ | ✗ | ✗ | ✓* | ✗ | ✗ |

**Legend:**
- ✓ = allowed
- ✗ = blocked
- ◑ = conditionally allowed (research parameter)
- \* = subject to 50% crash pool cap

---

## Design Notes

### Why S1 Exists as a Distinct State

S1_CRASH_ALERT could theoretically be merged into S2_CRASH_HOLD. It is kept separate for two reasons:

1. **False alarm handling** — A single-day spike in Speed4 combined with a borderline DD may not represent a true crash. S1 provides a one-cycle buffer before the full S2 defensive posture locks in.
2. **Behavioral clarity** — The moment-of-transition behavior (disable Vmin, prepare) is logically distinct from the sustained waiting behavior of S2. Keeping them separate makes parameter tuning and debugging cleaner.

### Re-Entry from S5

If a new crash event triggers while in S5_REBUILD, the strategy transitions to S1_CRASH_ALERT and follows the full crash cycle again. The pool may be partially depleted from the prior crash. This is the scenario the survival reserve exists to handle — the strategy must survive a second crash before the pool fully recovers from the first.

### S4 → S2 Back-Transition

A secondary crash leg (a crash that resumes after apparent stabilization) sends the strategy from S4_RECOVERY back to S2_CRASH_HOLD, not to S3_BOTTOM_ZONE directly. This prevents premature ladder deployment on what may be a brief stabilization pause in a continuing decline.

---

## Appendix: State Summary

| State | Name | Core Behavior |
|-------|------|--------------|
| S0 | Normal | Full VR logic active |
| S1 | Crash Alert | Vmin disabled, prepare defense |
| S2 | Crash Hold | Full hold, await capitulation |
| S3 | Bottom Zone | Ladder buy authorized |
| S4 | Recovery | Harvest restarts, monitor stabilization |
| S5 | Rebuild | Pool restoration, gradual normalization |

---

*This document defines states and transitions only. No simulation code is included.*
