// =============================================================================
// macro_policy_layer.ts
//
// v1.5 Macro Policy Layer — NORMAL/CRISIS mode detection + macro state
// classification for explainable_vr_v1 engine gating.
// =============================================================================

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Top-level regime: NORMAL = price >= MA200 zone; CRISIS = price below MA200 */
export type VRMode = 'NORMAL' | 'CRISIS'

/**
 * In CRISIS mode, classify the macro backdrop:
 * - POLICY_HEADWIND: rates/macro still working against recovery (declining MA200 + deep DD)
 * - PIVOT_WATCH:     signals mixed; possible policy pivot forming
 * - POLICY_TAILWIND: macro turning supportive (MA200 slope positive + clear rebound)
 * - NEUTRAL:         insufficient data or ambiguous signals
 */
export type MacroState = 'POLICY_HEADWIND' | 'PIVOT_WATCH' | 'POLICY_TAILWIND' | 'NEUTRAL'

/** Confidence in the MacroState classification */
export type MacroConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

// -----------------------------------------------------------------------------
// computeMode
// CRISIS: price more than 3% below MA200
// NORMAL: otherwise (including MA200 unavailable)
// -----------------------------------------------------------------------------
export function computeMode(assetPrice: number, ma200: number | null | undefined): VRMode {
  if (ma200 == null || ma200 <= 0) return 'NORMAL'
  return assetPrice < ma200 * 0.97 ? 'CRISIS' : 'NORMAL'
}

// -----------------------------------------------------------------------------
// computeMa200Slope
// 5-bar fractional slope: (ma200[i] - ma200[i-5]) / ma200[i-5]
// Returns null if insufficient data.
// -----------------------------------------------------------------------------
export function computeMa200Slope(
  ma200Series: Array<number | null | undefined>,
  i: number,
): number | null {
  if (i < 5) return null
  const current = ma200Series[i]
  const prev = ma200Series[i - 5]
  if (current == null || prev == null || prev <= 0) return null
  return (current - prev) / prev
}

// -----------------------------------------------------------------------------
// computeDD20
// 20-bar drawdown from peak: (current / max_in_last_20) - 1  (always <= 0)
// Returns null if insufficient data.
// -----------------------------------------------------------------------------
export function computeDD20(prices: number[], i: number): number | null {
  if (i < 0 || !prices.length) return null
  const start = Math.max(0, i - 19)
  let peak = 0
  for (let j = start; j <= i; j++) {
    if (prices[j] > peak) peak = prices[j]
  }
  if (peak <= 0) return null
  return (prices[i] / peak) - 1
}

// -----------------------------------------------------------------------------
// computeMacroState
// Classifies the macro environment in CRISIS mode.
// Logic:
//   POLICY_HEADWIND — MA200 declining AND deep drawdown AND no recovery
//   POLICY_TAILWIND — MA200 rising OR strong rebound above pivot threshold
//   PIVOT_WATCH     — MA200 flattening OR partial rebound
//   NEUTRAL         — insufficient signals
// -----------------------------------------------------------------------------
export function computeMacroState(args: {
  ma200Slope: number | null
  dd20: number | null
  reboundFromLow: number
  price: number
  ma200: number | null | undefined
}): MacroState {
  const { ma200Slope, dd20, reboundFromLow } = args

  // Insufficient data
  if (ma200Slope == null && dd20 == null) return 'NEUTRAL'

  const slope = ma200Slope ?? 0
  const drawdown = dd20 ?? 0

  // POLICY_TAILWIND: MA200 rising AND meaningful rebound
  if (slope > 0.002 && reboundFromLow >= 0.12) return 'POLICY_TAILWIND'

  // POLICY_TAILWIND: very strong rebound regardless of slope
  if (reboundFromLow >= 0.20) return 'POLICY_TAILWIND'

  // POLICY_HEADWIND: MA200 falling + deep drawdown + no recovery
  if (slope < -0.003 && drawdown < -0.12 && reboundFromLow < 0.06) return 'POLICY_HEADWIND'

  // POLICY_HEADWIND: MA200 strongly falling
  if (slope < -0.006 && reboundFromLow < 0.10) return 'POLICY_HEADWIND'

  // PIVOT_WATCH: slope near 0 or moderate rebound
  if ((slope >= -0.003 && slope <= 0.002) || (reboundFromLow >= 0.06 && reboundFromLow < 0.20)) {
    return 'PIVOT_WATCH'
  }

  return 'NEUTRAL'
}

// -----------------------------------------------------------------------------
// computeMacroConfidence
// Rates the confidence in the MacroState classification.
// -----------------------------------------------------------------------------
export function computeMacroConfidence(args: {
  macroState: MacroState
  dd20: number | null
  reboundFromLow: number
  ma200Slope: number | null
}): MacroConfidence {
  const { macroState, dd20, reboundFromLow, ma200Slope } = args

  if (macroState === 'NEUTRAL') return 'LOW'

  const slope = ma200Slope ?? 0
  const drawdown = dd20 ?? 0

  if (macroState === 'POLICY_HEADWIND') {
    if (slope < -0.005 && drawdown < -0.15 && reboundFromLow < 0.04) return 'HIGH'
    if (slope < -0.003 && drawdown < -0.10) return 'MEDIUM'
    return 'LOW'
  }

  if (macroState === 'POLICY_TAILWIND') {
    if (reboundFromLow >= 0.20 && slope > 0.003) return 'HIGH'
    if (reboundFromLow >= 0.15) return 'MEDIUM'
    return 'LOW'
  }

  // PIVOT_WATCH
  return 'MEDIUM'
}
