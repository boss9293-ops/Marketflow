import type { EventReplayCycle } from '../types/event_replay_cycle'
import {
  computeMode,
  computeMacroState,
  computeMacroConfidence,
  computeDD20,
  computeMa200Slope,
  type VRMode,
  type MacroState,
  type MacroConfidence,
} from './macro_policy_layer'
import type {
  BuyDelayStrength,
  CycleExecutionSummary,
  CyclePoolCapOption,
  ExecutionScenarioEngine,
  ExecutionFocusWindow,
  ExecutionMarker,
  ExecutionPlaybackCollection,
  ExecutionPlaybackVariant,
  ExecutionPoint,
  ExecutionZone,
  ExplainableVRBand,
  ExplainableVRReasonCode,
  ExplainableVRState,
  FastSnapbackOverrideReason,
  FastSnapbackOverrideStrength,
  FalseBottomRiskLevel,
  MarketStructurePlayback,
  ResetConfidence,
  ResetReason,
  VRComparisonView,
  VRExecutionSummary,
} from '../types/execution_playback'

export type ExecutionPlaybackSource = {
  name?: string
  start: string
  end: string
  chart_data: Array<{
    date: string
    qqq_n: number | null
    tqqq_n: number | null
    ma50_n: number | null
    ma200_n: number | null
    qqq_dd?: number | null
    tqqq_dd?: number | null
    score?: number | null
    level?: number | null
    in_event: boolean
  }>
  cycle_start: {
    initial_state: {
      initial_capital: number
      start_price: number
      initial_share_count: number
      initial_average_price: number
      initial_pool_cash: number
    } | null
  }
  cycle_framework: {
    cycles: EventReplayCycle[]
  }
}

export type ExecutionPlaybackBuildOptions = {
  falseBottomGuard?: boolean
  guardReleaseProfile?: 'phase2' | 'phase3' | 'phase4' | 'phase5' | 'phase6'
  scenarioEngine?: ExecutionScenarioEngine
  enableMacroGating?: boolean  // v1.5: enable CRISIS/macro policy layer (default: true)
}

const CAP_OPTIONS: Array<{ key: CyclePoolCapOption; pct: number | null; label: string }> = [
  { key: '30', pct: 30, label: '30%' },
  { key: '40', pct: 40, label: '40%' },
  { key: '50', pct: 50, label: '50%' },
  { key: 'unlimited', pct: null, label: 'Unlimited' },
]

const SCENARIO_SELL_POLICY = {
  vmaxVisualOnly: true,
  sellOnlyOnDefense: true,
  allowFirstCycleSell: false,
} as const

function findCycle(cycles: EventReplayCycle[], date: string) {
  return cycles.find((cycle) => date >= cycle.cycle_start_date && date <= cycle.cycle_end_date) ?? null
}

function normalizeValue(value: number, base: number) {
  return base > 0 ? Number(((value / base) * 100).toFixed(2)) : 100
}

function average(values: number[]) {
  if (!values.length) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
}

function rebaseNormalizedValue(normalizedValue: number | null | undefined, normalizedBase: number, actualBase: number) {
  if (typeof normalizedValue !== 'number' || normalizedValue <= 0) return actualBase
  if (!(normalizedBase > 0) || !(actualBase > 0)) return normalizedValue
  return Number(((normalizedValue / normalizedBase) * actualBase).toFixed(2))
}

function shiftTradingIndex(length: number, index: number, delta: number) {
  return Math.max(0, Math.min(length - 1, index + delta))
}

function buildRepresentativePriceLevels(anchorPrice: number, side: 'buy' | 'sell') {
  const offsets = side === 'buy' ? [-0.06, -0.12, -0.18] : [0.06, 0.12, 0.18]
  const weights = side === 'buy' ? [0.25, 0.35, 0.4] : [0.2, 0.3, 0.5]
  return offsets.map((offset, index) => ({
    level_no: index + 1,
    price: Number((anchorPrice * (1 + offset)).toFixed(2)),
    weight: weights[index],
  }))
}

type GuardNarrativeState = 'CALM' | 'WATCH' | 'FRAGILE' | 'DEFENSIVE'
type GuardReleaseProfile = NonNullable<ExecutionPlaybackBuildOptions['guardReleaseProfile']>
type ScenarioEngine = NonNullable<ExecutionPlaybackBuildOptions['scenarioEngine']>
type SnapbackSpeedLevel = 'LOW' | 'HIGH'
type ReentryAvailabilityLevel = 'LOW' | 'HIGH'

function buildExplainablePointDefaults(): Pick<
  ExecutionPoint,
  | 'explainable_state'
  | 'explainable_prev_state'
  | 'explainable_state_days'
  | 'explainable_delay_counter'
  | 'explainable_partial_entry_stage'
  | 'explainable_exposure_target'
  | 'explainable_buy_allowed'
  | 'explainable_sell_allowed'
  | 'explainable_reentry_allowed'
  | 'explainable_reason_code'
  | 'explainable_energy_score'
  | 'explainable_lower_high_count'
  | 'explainable_lower_low_count'
  | 'explainable_recovery_quality'
  | 'explainable_retest_risk'
> {
  return {
    explainable_state: null,
    explainable_prev_state: null,
    explainable_state_days: null,
    explainable_delay_counter: null,
    explainable_partial_entry_stage: null,
    explainable_exposure_target: null,
    explainable_buy_allowed: false,
    explainable_sell_allowed: false,
    explainable_reentry_allowed: false,
    explainable_reason_code: null,
    explainable_energy_score: null,
    explainable_lower_high_count: null,
    explainable_lower_low_count: null,
    explainable_recovery_quality: null,
    explainable_retest_risk: null,
  }
}

function computeGuardNarrativeState(args: {
  structuralState: ExecutionPoint['structural_state']
  vfState?: 'NORMAL' | 'ARMED' | 'EXIT_DONE'
  mssScore: number
  mssLevel: number
  qqqN: number
  ma50N: number
}): GuardNarrativeState {
  if (
    args.vfState === 'EXIT_DONE' ||
    args.vfState === 'ARMED' ||
    args.structuralState === 'STRUCTURAL_CRASH' ||
    args.structuralState === 'STRUCTURAL_STRESS' ||
    args.mssLevel >= 3
  ) {
    return 'DEFENSIVE'
  }

  if (
    args.structuralState === 'STRUCTURAL_WATCH' ||
    args.mssLevel === 2 ||
    args.mssScore < 88
  ) {
    return 'FRAGILE'
  }

  if (args.mssScore < 95 || (args.ma50N > 0 && args.qqqN < args.ma50N)) {
    return 'WATCH'
  }

  return 'CALM'
}

function computeResetNarrativeState(args: {
  structuralState: ExecutionPoint['structural_state']
  mssScore: number
  mssLevel: number
  qqqN: number
  ma50N: number
}): GuardNarrativeState {
  if (
    args.structuralState === 'STRUCTURAL_CRASH' ||
    args.structuralState === 'STRUCTURAL_STRESS' ||
    args.mssLevel >= 3
  ) {
    return 'DEFENSIVE'
  }

  if (
    args.structuralState === 'STRUCTURAL_WATCH' ||
    args.mssLevel === 2 ||
    args.mssScore < 88
  ) {
    return 'FRAGILE'
  }

  if (args.mssScore < 95 || (args.ma50N > 0 && args.qqqN < args.ma50N)) {
    return 'WATCH'
  }

  return 'CALM'
}

function computeFalseBottomRiskLevel(args: {
  peakDD: number
  reboundFromLow: number
  dd3: number
  dd5: number
}): FalseBottomRiskLevel {
  if (
    args.peakDD <= -0.20 &&
    args.reboundFromLow < 0.05 &&
    (args.dd3 <= -0.08 || args.dd5 <= -0.12)
  ) {
    return 'HIGH'
  }

  if (args.peakDD <= -0.15 && args.reboundFromLow < 0.08) {
    return 'MEDIUM'
  }

  return 'LOW'
}

function computeBuyDelayStrength(args: {
  falseBottomRiskLevel: FalseBottomRiskLevel
  narrativeState: GuardNarrativeState
}): BuyDelayStrength {
  if (args.falseBottomRiskLevel === 'HIGH' && args.narrativeState === 'DEFENSIVE') {
    return 'STRONG'
  }

  if (
    args.falseBottomRiskLevel === 'HIGH' ||
    args.narrativeState === 'FRAGILE' ||
    args.narrativeState === 'DEFENSIVE'
  ) {
    return 'MODERATE'
  }

  if (args.falseBottomRiskLevel === 'MEDIUM') {
    return 'WEAK'
  }

  return 'NONE'
}

function reduceDelayStrength(delayStrength: BuyDelayStrength): BuyDelayStrength {
  if (delayStrength === 'STRONG') return 'MODERATE'
  if (delayStrength === 'MODERATE') return 'WEAK'
  if (delayStrength === 'WEAK') return 'NONE'
  return 'NONE'
}

function computeGuardAdjustment(args: {
  guardReleaseProfile: GuardReleaseProfile
  delayStrength: BuyDelayStrength
  falseBottomRiskLevel: FalseBottomRiskLevel
  narrativeState: GuardNarrativeState
  reboundFromLow: number
  dd3: number
  dd5: number
  daysSinceLow: number
  recentNewLow: boolean
  distToMA200: number | null
}) {
  if (args.guardReleaseProfile !== 'phase4') {
    return {
      adjustedDelayStrength: args.delayStrength,
      snapbackSpeed: 'LOW' as SnapbackSpeedLevel,
      reentryAvailability: 'HIGH' as ReentryAvailabilityLevel,
      reentryScore: 0,
      ma200TimingTight: false,
    }
  }

  const daysSinceLow = Math.max(1, args.daysSinceLow)
  const snapbackVelocity = args.reboundFromLow / daysSinceLow
  const snapbackHigh =
    (args.reboundFromLow >= 0.08 && args.dd3 > 0) ||
    (args.reboundFromLow >= 0.06 && args.dd3 >= -0.01 && daysSinceLow <= 6 && snapbackVelocity >= 0.012)

  const reentryScore =
    (args.dd5 < -0.05 ? 1 : 0) +
    (args.recentNewLow ? 1 : 0) +
    (args.dd3 < 0 ? 1 : 0)
  const reentryAvailability = reentryScore >= 2 ? 'HIGH' : 'LOW'
  const ma200TimingTight =
    args.distToMA200 != null &&
    args.distToMA200 >= -0.03 &&
    args.distToMA200 <= 0.03

  let adjustedDelayStrength = args.delayStrength
  if (
    snapbackHigh &&
    reentryAvailability === 'LOW' &&
    ma200TimingTight &&
    args.falseBottomRiskLevel !== 'HIGH'
  ) {
    adjustedDelayStrength = 'NONE'
  } else if (
    snapbackHigh &&
    args.falseBottomRiskLevel !== 'HIGH' &&
    args.narrativeState !== 'DEFENSIVE'
  ) {
    adjustedDelayStrength = reduceDelayStrength(adjustedDelayStrength)
  } else if (
    ma200TimingTight &&
    reentryAvailability === 'HIGH' &&
    adjustedDelayStrength === 'NONE'
  ) {
    adjustedDelayStrength = 'WEAK'
  }

  return {
    adjustedDelayStrength,
    snapbackSpeed: snapbackHigh ? ('HIGH' as SnapbackSpeedLevel) : ('LOW' as SnapbackSpeedLevel),
    reentryAvailability,
    reentryScore,
    ma200TimingTight,
  }
}

function computeFastSnapbackOverride(args: {
  guardReleaseProfile: GuardReleaseProfile
  reboundFromLow: number
  dd3: number
  dd5: number
  noNewLowBars: number
  falseBottomRiskLevel: FalseBottomRiskLevel
  resetReadyFlag: boolean
  resetConfidence: ResetConfidence
}): {
  fastSnapbackFlag: boolean
  overrideStrength: FastSnapbackOverrideStrength
  overrideReason: FastSnapbackOverrideReason
} {
  if (args.guardReleaseProfile !== 'phase5') {
    return {
      fastSnapbackFlag: false,
      overrideStrength: 'NONE',
      overrideReason: 'SNAPBACK',
    }
  }

  const ruleA =
    args.reboundFromLow >= 0.08 &&
    args.dd3 >= 0 &&
    args.noNewLowBars >= 5
  const ruleB =
    args.dd5 > -0.03 &&
    args.noNewLowBars >= 5 &&
    (args.resetReadyFlag || args.resetConfidence !== 'LOW')
  const ruleC =
    args.falseBottomRiskLevel !== 'HIGH' ||
    args.resetReadyFlag ||
    args.resetConfidence !== 'LOW'

  const fastSnapbackFlag = ruleA && ruleB && ruleC

  if (!fastSnapbackFlag) {
    return {
      fastSnapbackFlag: false,
      overrideStrength: 'NONE',
      overrideReason: ruleA ? 'NO_REENTRY' : 'SNAPBACK',
    }
  }

  if (args.resetReadyFlag && args.resetConfidence !== 'LOW') {
    return {
      fastSnapbackFlag: true,
      overrideStrength: 'MODERATE',
      overrideReason: 'EARLY_RECOVERY',
    }
  }

  if (args.falseBottomRiskLevel === 'MEDIUM') {
    return {
      fastSnapbackFlag: true,
      overrideStrength: 'WEAK',
      overrideReason: 'NO_REENTRY',
    }
  }

  return {
    fastSnapbackFlag: true,
    overrideStrength: 'WEAK',
    overrideReason: 'SNAPBACK',
  }
}

function computeSelectiveSnapbackFirstBuyOverride(args: {
  guardReleaseProfile: GuardReleaseProfile
  reboundFromLow: number
  dd3: number
  dd5: number
  noNewLowBars: number
  falseBottomRiskLevel: FalseBottomRiskLevel
  resetReadyFlag: boolean
  resetConfidence: ResetConfidence
  narrativeState: GuardNarrativeState
}): {
  snapbackCandidateFlag: boolean
  lowReentryFlag: boolean
  overrideCandidate: boolean
} {
  if (args.guardReleaseProfile !== 'phase6') {
    return {
      snapbackCandidateFlag: false,
      lowReentryFlag: false,
      overrideCandidate: false,
    }
  }

  const recentNewLow = args.noNewLowBars < 5
  const snapbackCandidateFlag =
    args.reboundFromLow >= 0.08 &&
    args.dd3 >= 0 &&
    !recentNewLow

  const lowReentryFlag =
    args.dd5 > -0.03 &&
    !recentNewLow &&
    (args.resetReadyFlag || args.resetConfidence === 'MEDIUM' || args.resetConfidence === 'HIGH')

  const prolongedBearProxy =
    args.falseBottomRiskLevel === 'HIGH' ||
    args.dd5 <= -0.05 ||
    recentNewLow ||
    args.narrativeState === 'DEFENSIVE'

  const overrideCandidate =
    snapbackCandidateFlag &&
    lowReentryFlag &&
    args.resetReadyFlag &&
    !prolongedBearProxy

  return {
    snapbackCandidateFlag,
    lowReentryFlag,
    overrideCandidate,
  }
}

function computeResetSignal(args: {
  noNewLowBars: number
  dd3: number
  dd5: number
  dd5Lookback: number
  reboundFromLow: number
  mssScore: number
  mssScoreLookback: number
  mssLevel: number
  mssLevelLookback: number
  narrativeState: GuardNarrativeState
  guardReleaseProfile: GuardReleaseProfile
}) {
  const exhaustionReady = args.noNewLowBars >= 5 && args.dd3 > -0.03
  const reboundReady = args.reboundFromLow >= 0.06 && args.dd3 >= 0
  const structureReady =
    args.narrativeState !== 'DEFENSIVE' &&
    (
      args.mssScore >= args.mssScoreLookback + 2 ||
      args.mssLevel <= args.mssLevelLookback ||
      args.dd5 >= args.dd5Lookback + 0.02
    )

  const resetReadyFlag = exhaustionReady && (reboundReady || structureReady)
  const fastSnapbackReady =
    args.guardReleaseProfile !== 'phase2' &&
    args.noNewLowBars >= 4 &&
    args.reboundFromLow >= 0.06 &&
    args.dd5 >= -0.08 &&
    args.dd5 >= args.dd5Lookback + 0.02 &&
    args.mssScore >= 70 &&
    args.mssScore >= args.mssScoreLookback
  const fastReboundReleaseReady =
    args.guardReleaseProfile !== 'phase2' &&
    args.noNewLowBars >= 5 &&
    args.reboundFromLow >= 0.10 &&
    args.dd5 >= -0.08 &&
    args.dd3 >= -0.01 &&
    args.narrativeState !== 'DEFENSIVE' &&
    args.mssScore >= args.mssScoreLookback

  let resetConfidence: ResetConfidence = 'LOW'
  if (exhaustionReady && reboundReady && structureReady) {
    resetConfidence = 'HIGH'
  } else if (resetReadyFlag && fastSnapbackReady) {
    resetConfidence = 'HIGH'
  } else if (resetReadyFlag) {
    resetConfidence = 'MEDIUM'
  }

  const resetReason: ResetReason = reboundReady
    ? 'REBOUND'
    : structureReady
      ? 'STRUCTURE'
      : 'EXHAUSTION'

  return {
    resetReadyFlag,
    resetConfidence,
    resetReason,
    exhaustionReady,
    reboundReady,
    structureReady,
    fastSnapbackReady,
    fastReboundReleaseReady,
  }
}

function applyResetReleaseOverride(args: {
  delayStrength: BuyDelayStrength
  resetReadyFlag: boolean
  resetConfidence: ResetConfidence
  fastSnapbackReady: boolean
  fastReboundReleaseReady: boolean
}): BuyDelayStrength {
  if (args.delayStrength === 'NONE') return 'NONE'

  if (!args.resetReadyFlag) return args.delayStrength

  if (args.resetConfidence === 'HIGH') {
    return 'NONE'
  }

  if (args.fastSnapbackReady && args.delayStrength === 'MODERATE') {
    return 'NONE'
  }

  if (args.fastReboundReleaseReady && args.delayStrength === 'WEAK') {
    return 'NONE'
  }

  if (args.resetConfidence === 'MEDIUM') {
    return 'WEAK'
  }

  if (args.resetConfidence === 'LOW' && args.delayStrength === 'STRONG') {
    return 'MODERATE'
  }

  return args.delayStrength
}

function applyFastSnapbackDelayOverride(args: {
  delayStrength: BuyDelayStrength
  overrideStrength: FastSnapbackOverrideStrength
}): BuyDelayStrength {
  if (args.overrideStrength === 'NONE' || args.delayStrength === 'NONE') {
    return args.delayStrength
  }

  if (args.overrideStrength === 'WEAK') {
    if (args.delayStrength === 'STRONG') return 'MODERATE'
    if (args.delayStrength === 'MODERATE') return 'WEAK'
    return args.delayStrength
  }

  if (args.delayStrength === 'STRONG') return 'WEAK'
  if (args.delayStrength === 'MODERATE') return 'WEAK'
  return args.delayStrength
}

function getResetReleaseWindowBars(
  resetConfidence: ResetConfidence,
  guardReleaseProfile: GuardReleaseProfile,
  falseBottomRiskLevel: FalseBottomRiskLevel,
) {
  if (guardReleaseProfile === 'phase2') return 0
  if (resetConfidence === 'HIGH') return 3
  if (resetConfidence === 'MEDIUM' && falseBottomRiskLevel !== 'LOW') return 1
  return 0
}

function getFastSnapbackPriorityWindowBars(
  resetConfidence: ResetConfidence,
  falseBottomRiskLevel: FalseBottomRiskLevel,
) {
  if (resetConfidence === 'HIGH') {
    return falseBottomRiskLevel === 'HIGH' ? 5 : 7
  }
  if (resetConfidence === 'MEDIUM') {
    return falseBottomRiskLevel === 'HIGH' ? 3 : 5
  }
  return 0
}

function getPhase6FirstBuyOverrideWindowBars() {
  return 3
}

function computeRollingWindowHigh(prices: number[], start: number, end: number) {
  let high = Number.NEGATIVE_INFINITY
  for (let i = start; i <= end; i += 1) {
    if (prices[i] > high) high = prices[i]
  }
  return Number.isFinite(high) ? high : 0
}

function computeRollingWindowLow(prices: number[], start: number, end: number) {
  let low = Number.POSITIVE_INFINITY
  for (let i = start; i <= end; i += 1) {
    if (prices[i] < low) low = prices[i]
  }
  return Number.isFinite(low) ? low : 0
}

function computeLowerHighCount(prices: number[], index: number, segment = 5) {
  let count = 0
  const currentStart = Math.max(0, index - segment + 1)
  const currentHigh = computeRollingWindowHigh(prices, currentStart, index)
  const prevEnd = currentStart - 1
  if (prevEnd < 0) return 0
  const prevStart = Math.max(0, prevEnd - segment + 1)
  const prevHigh = computeRollingWindowHigh(prices, prevStart, prevEnd)
  if (currentHigh < prevHigh) count += 1
  const olderEnd = prevStart - 1
  if (olderEnd < 0) return count
  const olderStart = Math.max(0, olderEnd - segment + 1)
  const olderHigh = computeRollingWindowHigh(prices, olderStart, olderEnd)
  if (prevHigh < olderHigh) count += 1
  return count
}

function computeLowerLowCount(prices: number[], index: number, segment = 5) {
  let count = 0
  const currentStart = Math.max(0, index - segment + 1)
  const currentLow = computeRollingWindowLow(prices, currentStart, index)
  const prevEnd = currentStart - 1
  if (prevEnd < 0) return 0
  const prevStart = Math.max(0, prevEnd - segment + 1)
  const prevLow = computeRollingWindowLow(prices, prevStart, prevEnd)
  if (currentLow < prevLow) count += 1
  const olderEnd = prevStart - 1
  if (olderEnd < 0) return count
  const olderStart = Math.max(0, olderEnd - segment + 1)
  const olderLow = computeRollingWindowLow(prices, olderStart, olderEnd)
  if (prevLow < olderLow) count += 1
  return count
}

function computeExplainableEnergyScore(args: {
  dd5: number
  lowerLowCount: number
  reboundFromLow: number
}): ExplainableVRBand {
  if (args.dd5 <= -0.08 && args.lowerLowCount >= 2) {
    return 'HIGH'
  }
  if (args.dd5 <= -0.05 || (args.lowerLowCount >= 1 && args.reboundFromLow < 0.08)) {
    return 'MED'
  }
  return 'LOW'
}

function computeRecoveryQuality(reboundFromLow: number): ExplainableVRBand {
  if (reboundFromLow >= 0.15) return 'HIGH'
  if (reboundFromLow >= 0.08) return 'MED'
  return 'LOW'
}

function computeRetestRisk(args: { reboundFromLow: number; dd3: number }): 'LOW' | 'HIGH' {
  if (args.reboundFromLow < 0.10 && args.dd3 < -0.05) {
    return 'HIGH'
  }
  return 'LOW'
}

function computeExplainableExposureTarget(args: {
  state: ExplainableVRState
  structureBreak: boolean
  ma200Slope: number
  currentExposure: number
}) {
  if (args.state === 'RISK_OFF') {
    return args.structureBreak && args.ma200Slope <= 0 ? 0 : 0.25
  }
  if (args.state === 'BOTTOM_WATCH') {
    return Math.min(args.currentExposure, 0.25)
  }
  if (args.state === 'WARNING') {
    return 0.75
  }
  if (args.state === 'RE_ENTRY') {
    return Math.max(args.currentExposure, 0.5)
  }
  return 1
}

function rollingMean(prices: number[], i: number, window: number): number | null {
  if (i < window - 1) return null
  let sum = 0
  for (let k = i - window + 1; k <= i; k++) sum += prices[k]
  return Number((sum / window).toFixed(2))
}

function buildMarketStructurePlayback(event: ExecutionPlaybackSource): MarketStructurePlayback {
  const actualBasePrice = event.cycle_start.initial_state?.start_price ?? 0
  const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100
  // Compute TQQQ-specific rolling MA directly from TQQQ price series
  const tqqqPrices = event.chart_data.map((point) => rebaseNormalizedValue(point.tqqq_n, normalizedBase, actualBasePrice))
  // Pre-build rows so breach_points can reuse computed ma200 (avoids re-running rollingMean twice)
  const rows = event.chart_data.map((point, i) => ({
    date: point.date,
    tqqq_price: tqqqPrices[i],
    ma50: rollingMean(tqqqPrices, i, 50),
    // Use DB pre-computed MA200 (from source chart_data.ma200_n) to avoid 200-day local warmup.
    // DB value is QQQ MA200 normalized to the same base as tqqq_n, so rebaseNormalizedValue gives
    // a comparable scale: when qqq_n == ma200_n the lines meet, signaling the MA200 breach threshold.
    ma200: typeof point.ma200_n === 'number' && point.ma200_n > 0
      ? rebaseNormalizedValue(point.ma200_n, normalizedBase, actualBasePrice)
      : rollingMean(tqqqPrices, i, 200),
  }))
  return {
    rows,
    tqqq_price_series: rows.map((row) => ({
      date: row.date,
      value: row.tqqq_price,
    })),
    ma50_series: rows.map((row) => ({
      date: row.date,
      value: row.ma50,
    })),
    ma200_series: rows.map((row) => ({
      date: row.date,
      value: row.ma200,
    })),
    cycle_boundaries: event.cycle_framework.cycles.map((cycle) => ({
      date: cycle.cycle_start_date,
      cycle_no: cycle.cycle_no,
    })),
    event_window: {
      start_date: event.start,
      end_date: event.end,
    },
    // Breach detection uses DB QQQ vs QQQ MA200 (source of truth), not locally-computed TQQQ MA200.
    // qqq_n and ma200_n are on the same normalized scale — breach = qqq_n < ma200_n.
    breach_points: rows
      .map((row, i) => ({ row, point: event.chart_data[i] }))
      .filter(({ row, point }) =>
        typeof point.qqq_n === 'number' && typeof point.ma200_n === 'number'
          ? point.qqq_n < point.ma200_n
          : typeof row.ma200 === 'number' && row.tqqq_price < row.ma200
      )
      .map(({ row }) => ({
        date: row.date,
        title: 'MA200 Breach',
        value: row.tqqq_price,
      })),
    recovery_markers: event.chart_data
      .filter((point) => typeof point.qqq_dd === 'number' && point.qqq_dd >= -5 && point.in_event)
      .map((point) => ({
        date: point.date,
        title: 'Recovery Attempt',
        value: rebaseNormalizedValue(point.tqqq_n, normalizedBase, actualBasePrice),
      })),
  }
}

function buildCycleExecutionSummaries(input: {
  points: ExecutionPoint[]
  buy_markers: ExecutionMarker[]
  sell_markers: ExecutionMarker[]
  defense_markers: ExecutionMarker[]
  pool_cap_flags: ExecutionMarker[]
  initial_pool_cash: number
  cycles: EventReplayCycle[]
}): CycleExecutionSummary[] {
  const cycleNos = Array.from(
    new Set(input.points.map((point) => point.cycle_no).filter((cycleNo): cycleNo is number => typeof cycleNo === 'number'))
  ).sort((left, right) => left - right)

  return cycleNos.map((cycleNo) => {
    const cyclePoints = input.points.filter((point) => point.cycle_no === cycleNo)
    const firstPoint = cyclePoints[0]
    const lastPoint = cyclePoints[cyclePoints.length - 1]
    const buyCount = input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).length
    const sellCount = input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).length
    const defenseCount = input.defense_markers.filter((marker) => marker.cycle_no === cycleNo).length
    const blockedBuyCount = input.pool_cap_flags.filter((marker) => marker.cycle_no === cycleNo).length
    const executionPrices = [
      ...input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
      ...input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
      ...input.defense_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
    ]
    const buyPrices = input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price)
    const sellPrices = input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price)
    const poolUsedPct = lastPoint?.cycle_pool_used_pct ?? 0
    const poolSpent =
      input.initial_pool_cash > 0 ? Number(((input.initial_pool_cash * poolUsedPct) / 100).toFixed(2)) : 0
    const startingEvaluationValue = Number((firstPoint?.evaluation_value_before_trade ?? firstPoint?.evaluation_value ?? 0).toFixed(2))
    const endingEvaluationValue = Number((lastPoint?.evaluation_value ?? 0).toFixed(2))
    const startingPoolCash = Number((firstPoint?.pool_cash_before_trade ?? firstPoint?.pool_cash_after_trade ?? 0).toFixed(2))
    const endingPoolCash = Number((lastPoint?.pool_cash_after_trade ?? 0).toFixed(2))
    const startingPortfolioValue = startingEvaluationValue + startingPoolCash
    const endingPortfolioValue = endingEvaluationValue + endingPoolCash
    const cycleMeta = input.cycles.find((cycle) => cycle.cycle_no === cycleNo)

    return {
      cycle_no: cycleNo,
      cycle_window: `${firstPoint?.date ?? 'N/A'} - ${lastPoint?.date ?? 'N/A'}`,
      start_date: firstPoint?.date ?? '',
      end_date: lastPoint?.date ?? '',
      in_event: cyclePoints.some((point) => point.in_event),
      vref_eval: startingEvaluationValue,
      vmin_eval: Number((startingEvaluationValue * 0.85).toFixed(2)),
      vmax_eval: Number((startingEvaluationValue * 1.15).toFixed(2)),
      start_evaluation_value: startingEvaluationValue,
      avg_evaluation_value: average(cyclePoints.map((point) => point.evaluation_value)),
      end_evaluation_value: endingEvaluationValue,
      start_pool_cash: startingPoolCash,
      start_pool_pct:
        startingPortfolioValue > 0 ? Number(((startingPoolCash / startingPortfolioValue) * 100).toFixed(1)) : 0,
      end_pool_cash: endingPoolCash,
      end_pool_pct:
        endingPortfolioValue > 0 ? Number(((endingPoolCash / endingPortfolioValue) * 100).toFixed(1)) : 0,
      avg_avg_cost: average(cyclePoints.map((point) => point.avg_cost_after_trade)),
      avg_execution_price: executionPrices.length ? average(executionPrices) : null,
      avg_buy_price: buyPrices.length ? average(buyPrices) : null,
      avg_sell_price: sellPrices.length ? average(sellPrices) : null,
      pool_spent_in_cycle: poolSpent,
      pool_used_pct_in_cycle: poolUsedPct,
      end_shares: lastPoint?.shares_after_trade ?? 0,
      end_avg_cost: Number((lastPoint?.avg_cost_after_trade ?? 0).toFixed(2)),
      ending_state: lastPoint?.state_after_trade ?? 'pending',
      buy_count: buyCount,
      sell_count: sellCount,
      defense_count: defenseCount,
      blocked_buy_count: blockedBuyCount,
      scenario_bias: cycleMeta?.scenario_bias ?? [],
      playbook_bias: cycleMeta?.playbook_bias ?? [],
    }
  })
}

function buildExecutionFocusWindow(input: {
  points: ExecutionPoint[]
  trade_log: ExecutionPlaybackVariant['trade_log']
}): ExecutionFocusWindow | null {
  if (!input.points.length) return null

  const firstBuySignalDate = input.trade_log.find((item) => item.buy_signal)?.replay_date ?? null
  const firstDefenseDate = input.trade_log.find((item) => item.defense_signal)?.replay_date ?? null
  const firstVminBreakDate =
    input.points.find(
      (point) =>
        point.in_event &&
        typeof point.vmin_eval === 'number' &&
        typeof point.evaluation_value === 'number' &&
        point.evaluation_value < point.vmin_eval
    )?.date ?? null

  const eventPoints = input.points.filter((point) => point.in_event)
  const eventLowDate =
    eventPoints.reduce((lowest, point) => {
      if (!lowest || point.asset_price < lowest.asset_price) return point
      return lowest
    }, null as ExecutionPoint | null)?.date ?? null

  const stressCandidates = [firstBuySignalDate, firstDefenseDate, firstVminBreakDate].filter(
    (date): date is string => Boolean(date)
  )
  const anchorStartDate = stressCandidates.sort()[0] ?? eventPoints[0]?.date ?? input.points[0].date
  const anchorEndDate = eventLowDate ?? eventPoints[eventPoints.length - 1]?.date ?? input.points[input.points.length - 1].date

  const startIndex = Math.max(
    0,
    input.points.findIndex((point) => point.date === anchorStartDate)
  )
  const endIndexCandidate = input.points.findIndex((point) => point.date === anchorEndDate)
  const endIndex = endIndexCandidate >= 0 ? endIndexCandidate : input.points.length - 1

  return {
    mode: 'auto_focus',
    start_date: input.points[shiftTradingIndex(input.points.length, startIndex, -5)]?.date ?? input.points[0].date,
    end_date:
      input.points[shiftTradingIndex(input.points.length, endIndex, 12)]?.date ??
      input.points[input.points.length - 1].date,
    first_buy_signal_date: firstBuySignalDate,
    first_defense_date: firstDefenseDate,
    first_vmin_break_date: firstVminBreakDate,
    event_low_date: eventLowDate,
  }
}

function buildVariant(
  event: ExecutionPlaybackSource,
  capOption: { key: CyclePoolCapOption; pct: number | null; label: string },
  mode: 'original' | 'scenario' = 'scenario'
): ExecutionPlaybackVariant {
  const initialState = event.cycle_start.initial_state
  const marketChart = buildMarketStructurePlayback(event)

  if (!initialState) {
    return {
      engine_id: mode === 'original' ? 'original' : 'vfinal',
      engine_label: mode === 'original' ? 'Original VR (Playback)' : 'Scenario VR (vFinal)',
      cap_option: capOption.key,
      cap_label: capOption.label,
      sell_policy: {
        vmax_visual_only: mode === 'scenario' ? SCENARIO_SELL_POLICY.vmaxVisualOnly : false,
        sell_only_on_defense: mode === 'scenario' ? SCENARIO_SELL_POLICY.sellOnlyOnDefense : false,
        allow_first_cycle_sell: mode === 'scenario' ? SCENARIO_SELL_POLICY.allowFirstCycleSell : true,
      },
      points: [],
      buy_markers: [],
      sell_markers: [],
      defense_markers: [],
      avg_cost_line: [],
      pool_cap_flags: [],
      vmin_recovery_attempt_zones: [],
      failed_recovery_zones: [],
      scenario_phase_zones: [],
      pool_usage_summary: {
        initial_pool_cash: 0,
        cycle_pool_cap_pct: capOption.pct,
        cycle_pool_used_pct: 0,
        active_cycle_pool_used_pct: 0,
        pool_cash_remaining: 0,
        cumulative_pool_spent: 0,
        blocked_buy_count: 0,
        deferred_buy_count: 0,
        false_bottom_risk_level: 'LOW',
        buy_delay_flag: false,
        delay_strength: 'NONE',
        reset_ready_flag: false,
        reset_confidence: 'LOW',
        reset_reason: 'EXHAUSTION',
        fast_snapback_flag: false,
        override_strength: 'NONE',
        override_reason: 'SNAPBACK',
        snapback_candidate_flag: false,
        low_reentry_flag: false,
        first_buy_override_used: false,
        override_triggered: false,
        guard_partial_buy_count: 0,
        guard_delayed_buy_count: 0,
        guard_blocked_buy_count: 0,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        active_cycle_no: null,
        active_cycle_blocked_buy_count: 0,
        last_trade_date: null,
      },
      trade_log: [],
      validation_summary: {
        has_buy_execution: false,
        has_sell_execution: false,
        has_defense_execution: false,
        avg_cost_changed: false,
        shares_changed: false,
        pool_cash_changed: false,
        blocked_by_cap_observed: false,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        blocked_buy_count: 0,
      },
      market_chart: marketChart,
      cycle_summaries: [],
      focus_window: null,
    }
  }

  const basePrice = initialState.start_price > 0 ? initialState.start_price : event.chart_data[0]?.tqqq_n ?? 100
  const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100
  const initialPoolCash = initialState.initial_pool_cash
  const initialCapital = initialState.initial_capital
  let shares = initialState.initial_share_count
  let avgCost = initialState.initial_average_price
  let poolCash = initialState.initial_pool_cash
  let cumulativePoolSpent = 0
  let currentCycleNo: number | null = null
  let cyclePoolUsed = 0
  let cycleStartPoolCash = poolCash
  let blockedBuyCount = 0
  let deferredBuyCount = 0
  let executedBuyCount = 0
  let executedSellCount = 0
  let executedDefenseCount = 0
  let buyLevelState = new Set<string>()
  let sellLevelState = new Set<string>()
  let defenseTriggered = false
  let nextBuyLevelNo = 1
  let buyReferenceShares = initialState.initial_share_count
  let cycleBasePortfolio = initialCapital
  let cycleBaseEvaluation = initialState.initial_share_count * basePrice
  let cycleBasePrice = basePrice
  let activeCyclePoolUsedPct = 0
  let activeCycleBlockedBuyCount = 0
  let lastTradeDate: string | null = null
  let previousState = 'initialized'
  let underVminStart: string | null = null
  let recoveryZones: ExecutionZone[] = []
  let failedRecoveryZones: ExecutionZone[] = []
  let dayInCycle = 0

  const points: ExecutionPoint[] = []
  const buyMarkers: ExecutionMarker[] = []
  const sellMarkers: ExecutionMarker[] = []
  const defenseMarkers: ExecutionMarker[] = []
  const poolCapFlags: ExecutionMarker[] = []
  const avgCostLine: Array<{ date: string; value: number }> = []
  const scenarioPhaseZones: ExecutionZone[] = []
  const tradeLog: ExecutionPlaybackVariant['trade_log'] = []
  const activeCycleNo = event.cycle_framework.cycles.find((cycle) => cycle.is_active_cycle)?.cycle_no ?? null

  event.chart_data.forEach((point) => {
    const assetPrice = rebaseNormalizedValue(point.tqqq_n, normalizedBase, basePrice)
    const sharesBefore = shares
    const avgCostBefore = avgCost
    const poolCashBefore = poolCash
    const stateBefore = previousState
    const cycle = findCycle(event.cycle_framework.cycles, point.date)
    if (cycle?.cycle_no !== currentCycleNo) {
      currentCycleNo = cycle?.cycle_no ?? null
      dayInCycle = 1
      cyclePoolUsed = 0
      cycleStartPoolCash = poolCash
      buyLevelState = new Set<string>()
      sellLevelState = new Set<string>()
      defenseTriggered = false
      nextBuyLevelNo = 1
      if (cycle) {
        // Only update base values when entering a valid cycle — not in the post-event period
        // (where findCycle returns null). Without this guard, post-event points reset
        // cycleBaseEvaluation daily as TQQQ recovers, making vref/vmin/vmax shoot back up
        // to old high values, creating the "previous data comes back" visual tangling.
        cycleBasePortfolio = shares * assetPrice + poolCash
        cycleBaseEvaluation = shares * assetPrice
        cycleBasePrice = assetPrice
        buyReferenceShares = shares
      }
    }
    else {
      dayInCycle += 1
    }

    const cycleCapAmount =
      capOption.pct == null ? Number.POSITIVE_INFINITY : cycleStartPoolCash * (capOption.pct / 100)
    const sellLevels = buildRepresentativePriceLevels(Math.max(avgCost, cycleBasePrice), 'sell')
    let tradeReason: string | null = null
    let stateAfterTrade = 'hold'
    let buyBlockedByCycleCap = false
    let tradeExecuted = false
    let tradeType: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null = null
    let tradePrice: number | null = null
    let triggerSource: 'evaluation_vmax_gate' | 'representative_sell_ladder' | 'defense_reduction' | 'buy_vmin_recovery' | 'cycle_cap_block' | null = null
    let ladderLevelHit: number | null = null
    const preTradeEvaluationValue = Number((shares * assetPrice).toFixed(2))
    const preTradeVminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2))
    const preTradeVmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2))
    const sellGateOpen = preTradeEvaluationValue >= preTradeVmaxEval

    // Dynamic buy logic:
    //   L1 (first buy in cycle): triggers directly on evaluation <= Vmin breach.
    //     This fixes the split-adjusted low-price regime problem where the fixed -$1
    //     offset caused trigger miss even when evaluation was clearly below Vmin.
    //   L2+ (subsequent buys): use price-based ladder step-down logic.
    // Scenario VR pauses buys during defense regime (MA200 breach)
    const buysAllowed = mode === 'original' || !defenseTriggered
    const isFirstBuyLevel = nextBuyLevelNo === 1
    const preTradeBuyBasePrice = buyReferenceShares > 0 ? preTradeVminEval / buyReferenceShares : 0
    // L1 signal: evaluation breach. L2+ signal: price ladder.
    const preBuyLevelPrice = isFirstBuyLevel
      ? null  // L1 uses evaluation trigger, not price ladder
      : preTradeBuyBasePrice > 0 ? Number((preTradeBuyBasePrice - nextBuyLevelNo).toFixed(2)) : null
    const buySignal = buysAllowed && poolCash > 0 && (
      isFirstBuyLevel
        ? preTradeEvaluationValue <= preTradeVminEval  // L1: eval breach
        : preBuyLevelPrice != null && assetPrice <= preBuyLevelPrice  // L2+: price ladder
    )

    // Execute buys: loop to handle multiple level triggers if price drops far in one day
    let buyAttempts = 0
    while (buysAllowed && poolCash > 0 && shares > 0 && buyAttempts < 10) {
      const vminNow = cycleBaseEvaluation * 0.85
      const isFirstLevel = nextBuyLevelNo === 1
      const evalValue = shares * assetPrice
      const buyBasePriceNow = buyReferenceShares > 0 ? vminNow / buyReferenceShares : 0
      const nextLevelPrice = Number((buyBasePriceNow - nextBuyLevelNo).toFixed(2))
      // L1: trigger on evaluation breach; L2+: trigger on price ladder
      if (isFirstLevel ? evalValue > vminNow : assetPrice > nextLevelPrice) break

      const remainingCycleCap = Math.max(0, cycleCapAmount - cyclePoolUsed)
      const desiredSpend = Number((initialPoolCash * 0.20).toFixed(2))
      const actualSpend = Math.min(poolCash, desiredSpend, remainingCycleCap)

      if (actualSpend > 0) {
        const newShares = Math.floor(actualSpend / assetPrice)
        if (newShares > 0) {
          const totalCost = shares * avgCost + newShares * assetPrice
          shares += newShares
          buyReferenceShares = shares
          avgCost = shares > 0 ? Number((totalCost / shares).toFixed(2)) : avgCost
          poolCash = Number((poolCash - newShares * assetPrice).toFixed(2))
          cyclePoolUsed = Number((cyclePoolUsed + newShares * assetPrice).toFixed(2))
          cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2))
          tradeReason = 'Vmin recovery attempt buy'
          stateAfterTrade = 'buy_executed'
          tradeExecuted = true
          tradeType = 'buy'
          tradePrice = assetPrice
          triggerSource = 'buy_vmin_recovery'
          ladderLevelHit = nextBuyLevelNo
          executedBuyCount += 1
          lastTradeDate = point.date
          buyMarkers.push({
            date: point.date,
            price: assetPrice,
            normalized_value: normalizeValue(assetPrice, basePrice),
            cycle_no: currentCycleNo ?? 0,
            title: `Buy L${nextBuyLevelNo}`,
            reason: tradeReason,
            marker_type: 'buy',
            trigger_source: 'buy_vmin_recovery',
            ladder_level_hit: nextBuyLevelNo,
            share_delta: newShares,
            shares_after_trade: shares,
            avg_cost_after_trade: Number(avgCost.toFixed(2)),
            pool_cash_after_trade: Number(poolCash.toFixed(2)),
            total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
            cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
            evaluation_value: Number((shares * assetPrice).toFixed(2)),
            vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
            vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
            vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
            state_after_trade: stateAfterTrade,
          })
          nextBuyLevelNo += 1
        } else {
          break
        }
      } else {
        buyBlockedByCycleCap = true
        blockedBuyCount += 1
        deferredBuyCount += 1
        tradeType = tradeType ?? 'blocked_buy'
        tradePrice = tradePrice ?? assetPrice
        triggerSource = triggerSource ?? 'cycle_cap_block'
        ladderLevelHit = ladderLevelHit ?? nextBuyLevelNo
        poolCapFlags.push({
          date: point.date,
          price: assetPrice,
          normalized_value: normalizeValue(assetPrice, basePrice),
          cycle_no: currentCycleNo ?? 0,
          title: `Cap Block L${nextBuyLevelNo}`,
          reason: 'Buy blocked by cycle pool usage cap',
          marker_type: 'cap_block',
          trigger_source: 'cycle_cap_block',
          ladder_level_hit: nextBuyLevelNo,
          share_delta: 0,
          blocked_level_no: nextBuyLevelNo,
          shares_after_trade: shares,
          avg_cost_after_trade: Number(avgCost.toFixed(2)),
          pool_cash_after_trade: Number(poolCash.toFixed(2)),
          total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
          cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
          evaluation_value: Number((shares * assetPrice).toFixed(2)),
          vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
          vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
          vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
          state_after_trade: stateAfterTrade,
        })
        tradeReason = 'buy_blocked_by_cycle_cap'
        stateAfterTrade = 'buy_blocked'
        nextBuyLevelNo += 1
        break
      }
      buyAttempts += 1
    }

    const ma200Breached = typeof point.qqq_n === 'number' && typeof point.ma200_n === 'number' && point.qqq_n < point.ma200_n
    const defenseSignal = mode === 'scenario' && ma200Breached && !defenseTriggered && shares > 0
    if (mode === 'scenario' && ma200Breached && !defenseTriggered && shares > 0) {
      const sharesToSell = Math.max(1, Math.floor(shares * 0.2))
      shares -= sharesToSell
      const cashAdded = Number((sharesToSell * assetPrice).toFixed(2))
      poolCash = Number((poolCash + cashAdded).toFixed(2))
      defenseTriggered = true
      tradeReason = 'defense_reduction'
      stateAfterTrade = 'defense_reduced'
      tradeExecuted = true
      tradeType = 'defense'
      tradePrice = assetPrice
      triggerSource = 'defense_reduction'
      ladderLevelHit = null
      executedDefenseCount += 1
      lastTradeDate = point.date
      defenseMarkers.push({
        date: point.date,
        price: assetPrice,
        normalized_value: normalizeValue(assetPrice, basePrice),
        cycle_no: currentCycleNo ?? 0,
        title: 'Defense Reduce',
        reason: 'Forced reduction after MA200 breach',
        marker_type: 'defense',
        trigger_source: 'defense_reduction',
        ladder_level_hit: null,
        share_delta: -sharesToSell,
        shares_after_trade: shares,
        avg_cost_after_trade: Number(avgCost.toFixed(2)),
        pool_cash_after_trade: Number(poolCash.toFixed(2)),
        total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
        cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
        evaluation_value: Number((shares * assetPrice).toFixed(2)),
        vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
        vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
        vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
        state_after_trade: stateAfterTrade,
      })
    }

    // [TEST] Original VR (Playback) sell execution disabled to isolate and validate the buy formula cleanly.
    // Sell markers are suppressed for playback mode=original in this test phase.
    const sellSignal = false
    for (const level of sellLevels) {
      const key = `${currentCycleNo}-sell-${level.level_no}`
      if (true) continue // [TEST] Original sell execution disabled
      const sharesToSell = Math.max(1, Math.floor(shares * Math.min(0.2, level.weight)))
      shares -= sharesToSell
      poolCash = Number((poolCash + sharesToSell * assetPrice).toFixed(2))
      tradeReason = 'representative_sell_ladder'
      stateAfterTrade = 'sell_executed'
      tradeExecuted = true
      tradeType = 'sell'
      tradePrice = assetPrice
      triggerSource = 'representative_sell_ladder'
      ladderLevelHit = level.level_no
      executedSellCount += 1
      lastTradeDate = point.date
      sellMarkers.push({
        date: point.date,
        price: assetPrice,
        normalized_value: normalizeValue(assetPrice, basePrice),
        cycle_no: currentCycleNo ?? 0,
        title: `Sell L${level.level_no}`,
        reason: 'Representative cycle sell level touched',
        marker_type: 'sell',
        trigger_source: 'representative_sell_ladder',
        ladder_level_hit: level.level_no,
        sell_gate_open: true,
        share_delta: -sharesToSell,
        shares_after_trade: shares,
        avg_cost_after_trade: Number(avgCost.toFixed(2)),
        pool_cash_after_trade: Number(poolCash.toFixed(2)),
        total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
        cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
        evaluation_value: Number((shares * assetPrice).toFixed(2)),
        vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
        vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
        vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
        state_after_trade: stateAfterTrade,
      })
      sellLevelState.add(key)
    }

    const evaluationValue = Number((shares * assetPrice).toFixed(2))
    const portfolioValue = Number((evaluationValue + poolCash).toFixed(2))
    const evaluationNormalized = normalizeValue(evaluationValue, cycleBaseEvaluation || 1)
    const portfolioNormalized = normalizeValue(portfolioValue, initialCapital)
    const vrefEval = Number(cycleBaseEvaluation.toFixed(2))
    const vminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2))
    const vmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2))
    const vrefLine = normalizeValue(cycleBasePortfolio, initialCapital)
    const vminLine = Number((vrefLine * 0.85).toFixed(2))
    const vmaxLine = Number((vrefLine * 1.15).toFixed(2))
    const vrefPrice = shares > 0 ? Number((vrefEval / shares).toFixed(2)) : null
    const vminPrice = shares > 0 ? Number((vminEval / shares).toFixed(2)) : null
    const vmaxPrice = shares > 0 ? Number((vmaxEval / shares).toFixed(2)) : null

    if (evaluationValue < vminEval && underVminStart == null) {
      underVminStart = point.date
    } else if (evaluationValue >= vminEval && underVminStart != null) {
      recoveryZones.push({
        start_date: underVminStart,
        end_date: point.date,
        label: 'Vmin Recovery Attempt',
      })
      underVminStart = null
    }

    avgCostLine.push({
      date: point.date,
      value: normalizeValue(avgCost, basePrice),
    })
    points.push({
      date: point.date,
      in_event: point.in_event,
      cycle_no: currentCycleNo,
      day_in_cycle: currentCycleNo == null ? null : dayInCycle,
      asset_price: Number(assetPrice.toFixed(2)),
      evaluation_value_before_trade: preTradeEvaluationValue,
      evaluation_value: evaluationValue,
      evaluation_normalized: evaluationNormalized,
      tqqq_price_normalized: normalizeValue(assetPrice, basePrice),
      portfolio_value_before_trade: Number((preTradeEvaluationValue + poolCashBefore).toFixed(2)),
      portfolio_value: portfolioValue,
      portfolio_normalized: portfolioNormalized,
      vref_eval: vrefEval,
      vmin_eval: vminEval,
      vmax_eval: vmaxEval,
      vref_line: vrefLine,
      vmin_line: vminLine,
      vmax_line: vmaxLine,
      vref_price: vrefPrice,
      vmin_price: vminPrice,
      vmax_price: vmaxPrice,
      avg_cost_after_trade: Number(avgCost.toFixed(2)),
      avg_cost_normalized: normalizeValue(avgCost, basePrice),
      shares_before_trade: sharesBefore,
      shares_after_trade: shares,
      pool_cash_before_trade: Number(poolCashBefore.toFixed(2)),
      pool_cash_after_trade: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct:
        initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
      cycle_pool_cap_pct: capOption.pct,
      cumulative_pool_spent: cumulativePoolSpent,
      buy_blocked_by_cycle_cap: buyBlockedByCycleCap,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      trade_reason: tradeReason,
      state_after_trade: stateAfterTrade,
      structural_state: 'NONE',
      ...buildExplainablePointDefaults(),
    })
    const cyclePoolUsedPct = initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0
    if (currentCycleNo === activeCycleNo) {
      activeCyclePoolUsedPct = cyclePoolUsedPct
      if (buyBlockedByCycleCap) {
        activeCycleBlockedBuyCount += 1
      }
    }
    tradeLog.push({
      replay_date: point.date,
      cycle_no: currentCycleNo,
      state_before: stateBefore,
      buy_signal: buySignal,
      sell_signal: sellSignal,
      defense_signal: defenseSignal,
      trade_executed: tradeExecuted,
      trade_type: tradeType,
      trigger_source: triggerSource,
      ladder_level_hit: ladderLevelHit,
      trade_price: tradePrice,
      stock_evaluation_value: preTradeEvaluationValue,
      vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
      vmax_eval: preTradeVmaxEval,
      sell_gate_open: sellGateOpen,
      shares_before: sharesBefore,
      shares_after: shares,
      avg_cost_before: Number(avgCostBefore.toFixed(2)),
      avg_cost_after: Number(avgCost.toFixed(2)),
      pool_cash_before: Number(poolCashBefore.toFixed(2)),
      pool_cash_after: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: cyclePoolUsedPct,
      blocked_by_cap: buyBlockedByCycleCap,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      state_after: stateAfterTrade,
    })
    previousState = stateAfterTrade
  })

  if (underVminStart && points.length) {
    failedRecoveryZones.push({
      start_date: underVminStart,
      end_date: points[points.length - 1].date,
      label: 'Failed Recovery',
    })
  }

  const regeneratedScenarioPhaseZones = event.cycle_framework.cycles
    .filter((cycle) => cycle.scenario_bias?.length)
    .map((cycle) => ({
      start_date: cycle.cycle_start_date,
      end_date: cycle.cycle_end_date,
      label: cycle.scenario_bias[0],
    }))

  return {
    engine_id: mode === 'original' ? 'original' : 'vfinal',
    engine_label: mode === 'original' ? 'Original VR (Playback)' : 'Scenario VR (vFinal)',
    cap_option: capOption.key,
    cap_label: capOption.label,
    sell_policy: {
      vmax_visual_only: mode === 'scenario' ? SCENARIO_SELL_POLICY.vmaxVisualOnly : false,
      sell_only_on_defense: mode === 'scenario' ? SCENARIO_SELL_POLICY.sellOnlyOnDefense : false,
      allow_first_cycle_sell: mode === 'scenario' ? SCENARIO_SELL_POLICY.allowFirstCycleSell : true,
    },
    points,
    buy_markers: buyMarkers,
    sell_markers: sellMarkers,
    defense_markers: defenseMarkers,
    avg_cost_line: avgCostLine,
    pool_cap_flags: poolCapFlags,
    vmin_recovery_attempt_zones: recoveryZones,
    failed_recovery_zones: failedRecoveryZones,
    scenario_phase_zones: regeneratedScenarioPhaseZones,
      pool_usage_summary: {
      initial_pool_cash: initialPoolCash,
      cycle_pool_cap_pct: capOption.pct,
      cycle_pool_used_pct: points[points.length - 1]?.cycle_pool_used_pct ?? 0,
      active_cycle_pool_used_pct: activeCyclePoolUsedPct,
      pool_cash_remaining: points[points.length - 1]?.pool_cash_after_trade ?? 0,
      cumulative_pool_spent: cumulativePoolSpent,
      blocked_buy_count: blockedBuyCount,
      deferred_buy_count: deferredBuyCount,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      guard_partial_buy_count: 0,
      guard_delayed_buy_count: 0,
      guard_blocked_buy_count: 0,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: executedDefenseCount,
      active_cycle_no: activeCycleNo,
      active_cycle_blocked_buy_count: activeCycleBlockedBuyCount,
      last_trade_date: lastTradeDate,
    },
    trade_log: tradeLog,
    validation_summary: {
      has_buy_execution: executedBuyCount > 0,
      has_sell_execution: executedSellCount > 0,
      has_defense_execution: executedDefenseCount > 0,
      avg_cost_changed: tradeLog.some((item) => item.avg_cost_after !== item.avg_cost_before),
      shares_changed: tradeLog.some((item) => item.shares_after !== item.shares_before),
      pool_cash_changed: tradeLog.some((item) => item.pool_cash_after !== item.pool_cash_before),
      blocked_by_cap_observed: blockedBuyCount > 0,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: executedDefenseCount,
      blocked_buy_count: blockedBuyCount,
    },
    market_chart: marketChart,
    cycle_summaries: buildCycleExecutionSummaries({
      points,
      buy_markers: buyMarkers,
      sell_markers: sellMarkers,
      defense_markers: defenseMarkers,
      pool_cap_flags: poolCapFlags,
      initial_pool_cash: initialPoolCash,
      cycles: event.cycle_framework.cycles,
    }),
    focus_window: buildExecutionFocusWindow({
      points,
      trade_log: tradeLog,
    }),
  }
}


// =============================================================================
// VR Original V2 — FROZEN BENCHMARK ENGINE. DO NOT MODIFY.
// engine_id = "vr_original_v2"
//
// Rules (strict):
//   BUY:    price <= Vmin (L1 eval breach only — no ladder, no delay, no guard)
//   DEPLOY: 50% of pool_remaining per buy (remaining 기준, NOT initial_pool * 20%)
//   SELL:   disabled (same as current original baseline)
//   RESET:  cycle-based reset (same as original)
//
// State allowed: pool_remaining, position_size, avg_price, cycle_count
// State forbidden: state machine, delay counter, energy, guard
//
// This engine is the Explainable VR and Monte Carlo comparison baseline.
// =============================================================================
function buildVariantVrOriginalV2(
  event: ExecutionPlaybackSource,
  capOption: { key: CyclePoolCapOption; pct: number | null; label: string },
): ExecutionPlaybackVariant {
  const initialState = event.cycle_start.initial_state
  const marketChart = buildMarketStructurePlayback(event)

  if (!initialState) {
    return {
      engine_id: 'vr_original_v2',
      engine_label: 'VR Original V2 (Benchmark)',
      cap_option: capOption.key,
      cap_label: capOption.label,
      sell_policy: {
        vmax_visual_only: false,
        sell_only_on_defense: false,
        allow_first_cycle_sell: false,
      },
      points: [],
      buy_markers: [],
      sell_markers: [],
      defense_markers: [],
      avg_cost_line: [],
      pool_cap_flags: [],
      vmin_recovery_attempt_zones: [],
      failed_recovery_zones: [],
      scenario_phase_zones: [],
      pool_usage_summary: {
        initial_pool_cash: 0,
        cycle_pool_cap_pct: null,
        cycle_pool_used_pct: 0,
        active_cycle_pool_used_pct: 0,
        pool_cash_remaining: 0,
        cumulative_pool_spent: 0,
        blocked_buy_count: 0,
        deferred_buy_count: 0,
        false_bottom_risk_level: 'LOW',
        buy_delay_flag: false,
        delay_strength: 'NONE',
        reset_ready_flag: false,
        reset_confidence: 'LOW',
        reset_reason: 'EXHAUSTION',
        fast_snapback_flag: false,
        override_strength: 'NONE',
        override_reason: 'SNAPBACK',
        snapback_candidate_flag: false,
        low_reentry_flag: false,
        first_buy_override_used: false,
        override_triggered: false,
        guard_partial_buy_count: 0,
        guard_delayed_buy_count: 0,
        guard_blocked_buy_count: 0,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        active_cycle_no: null,
        active_cycle_blocked_buy_count: 0,
        last_trade_date: null,
      },
      trade_log: [],
      validation_summary: {
        has_buy_execution: false,
        has_sell_execution: false,
        has_defense_execution: false,
        avg_cost_changed: false,
        shares_changed: false,
        pool_cash_changed: false,
        blocked_by_cap_observed: false,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        blocked_buy_count: 0,
      },
      market_chart: marketChart,
      cycle_summaries: [],
      focus_window: null,
    }
  }

  const basePrice = initialState.start_price > 0 ? initialState.start_price : event.chart_data[0]?.tqqq_n ?? 100
  const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100
  const initialPoolCash = initialState.initial_pool_cash
  const initialCapital = initialState.initial_capital
  let shares = initialState.initial_share_count
  let avgCost = initialState.initial_average_price
  let poolCash = initialState.initial_pool_cash
  let cumulativePoolSpent = 0
  let currentCycleNo: number | null = null
  let cyclePoolUsed = 0
  let cycleStartPoolCash = poolCash
  let executedBuyCount = 0
  let executedSellCount = 0
  let lastTradeDate: string | null = null
  let previousState = 'initialized'
  let underVminStart: string | null = null
  const recoveryZones: ExecutionZone[] = []
  const failedRecoveryZones: ExecutionZone[] = []
  let dayInCycle = 0
  let cycleBasePortfolio = initialCapital
  let cycleBaseEvaluation = initialState.initial_share_count * basePrice
  let cycleBasePrice = basePrice
  const activeCycleNo = event.cycle_framework.cycles.find((cycle) => cycle.is_active_cycle)?.cycle_no ?? null
  let activeCyclePoolUsedPct = 0

  const points: ExecutionPoint[] = []
  const buyMarkers: ExecutionMarker[] = []
  const sellMarkers: ExecutionMarker[] = []
  const defenseMarkers: ExecutionMarker[] = []
  const poolCapFlags: ExecutionMarker[] = []
  const avgCostLine: Array<{ date: string; value: number }> = []
  const scenarioPhaseZones: ExecutionZone[] = []
  const tradeLog: ExecutionPlaybackVariant['trade_log'] = []

  event.chart_data.forEach((point) => {
    const assetPrice = rebaseNormalizedValue(point.tqqq_n, normalizedBase, basePrice)
    const sharesBefore = shares
    const avgCostBefore = avgCost
    const poolCashBefore = poolCash
    const stateBefore = previousState
    const cycle = findCycle(event.cycle_framework.cycles, point.date)

    // Cycle reset — same logic as original
    if (cycle?.cycle_no !== currentCycleNo) {
      currentCycleNo = cycle?.cycle_no ?? null
      dayInCycle = 1
      cyclePoolUsed = 0
      cycleStartPoolCash = poolCash
      if (cycle) {
        cycleBasePortfolio = shares * assetPrice + poolCash
        cycleBaseEvaluation = shares * assetPrice
        cycleBasePrice = assetPrice
      }
    } else {
      dayInCycle += 1
    }

    let tradeReason: string | null = null
    let stateAfterTrade = 'hold'
    let tradeExecuted = false
    let tradeType: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null = null
    let tradePrice: number | null = null
    const triggerSource: 'buy_vmin_recovery' | null = null
    const preTradeEvaluationValue = Number((shares * assetPrice).toFixed(2))
    const preTradeVminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2))
    const preTradeVmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2))
    const sellGateOpen = preTradeEvaluationValue >= preTradeVmaxEval

    // -----------------------------------------------------------------------
    // BUY RULE (STRICT): price <= Vmin only
    // DEPLOY:            50% of pool_remaining (remaining 기준)
    // NO state machine, NO guard, NO delay, NO energy
    // -----------------------------------------------------------------------
    const vminNow = cycleBaseEvaluation * 0.85
    const evalValue = shares * assetPrice

    // BUY: eval breach → price <= Vmin
    const buySignal = poolCash > 0 && evalValue <= vminNow

    if (buySignal) {
      // Deploy exactly 50% of remaining pool cash
      const deployAmount = Number((poolCash * 0.5).toFixed(2))
      const actualSpend = Math.min(poolCash, deployAmount)

      if (actualSpend > 0) {
        const newShares = Math.floor(actualSpend / assetPrice)
        if (newShares > 0) {
          const totalCost = shares * avgCost + newShares * assetPrice
          shares += newShares
          avgCost = shares > 0 ? Number((totalCost / shares).toFixed(2)) : avgCost
          poolCash = Number((poolCash - newShares * assetPrice).toFixed(2))
          cyclePoolUsed = Number((cyclePoolUsed + newShares * assetPrice).toFixed(2))
          cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2))
          tradeReason = 'VR_ORIGINAL_VMIN_BUY'
          stateAfterTrade = 'buy_executed'
          tradeExecuted = true
          tradeType = 'buy'
          tradePrice = assetPrice
          executedBuyCount += 1
          lastTradeDate = point.date
          buyMarkers.push({
            date: point.date,
            price: assetPrice,
            normalized_value: normalizeValue(assetPrice, basePrice),
            cycle_no: currentCycleNo ?? 0,
            title: 'Buy Vmin',
            reason: 'VR_ORIGINAL_VMIN_BUY',
            marker_type: 'buy',
            trigger_source: 'buy_vmin_recovery',
            ladder_level_hit: 1,
            share_delta: newShares,
            shares_after_trade: shares,
            avg_cost_after_trade: Number(avgCost.toFixed(2)),
            pool_cash_after_trade: Number(poolCash.toFixed(2)),
            total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
            cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
            evaluation_value: Number((shares * assetPrice).toFixed(2)),
            vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
            vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
            vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
            state_after_trade: stateAfterTrade,
          })
        }
      }
    }

    // SELL: disabled — same as current Original baseline
    // const sellSignal = false

    const evaluationValue = Number((shares * assetPrice).toFixed(2))
    const portfolioValue = Number((evaluationValue + poolCash).toFixed(2))
    const evaluationNormalized = normalizeValue(evaluationValue, cycleBaseEvaluation || 1)
    const portfolioNormalized = normalizeValue(portfolioValue, initialCapital)
    const vrefEval = Number(cycleBaseEvaluation.toFixed(2))
    const vminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2))
    const vmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2))
    const vrefLine = normalizeValue(cycleBasePortfolio, initialCapital)
    const vminLine = Number((vrefLine * 0.85).toFixed(2))
    const vmaxLine = Number((vrefLine * 1.15).toFixed(2))
    const vrefPrice = shares > 0 ? Number((vrefEval / shares).toFixed(2)) : null
    const vminPrice = shares > 0 ? Number((vminEval / shares).toFixed(2)) : null
    const vmaxPrice = shares > 0 ? Number((vmaxEval / shares).toFixed(2)) : null

    if (evaluationValue < vminEval && underVminStart == null) {
      underVminStart = point.date
    } else if (evaluationValue >= vminEval && underVminStart != null) {
      recoveryZones.push({
        start_date: underVminStart,
        end_date: point.date,
        label: 'Vmin Recovery Attempt',
      })
      underVminStart = null
    }

    avgCostLine.push({
      date: point.date,
      value: normalizeValue(avgCost, basePrice),
    })

    const cyclePoolUsedPct = initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0
    if (currentCycleNo === activeCycleNo) {
      activeCyclePoolUsedPct = cyclePoolUsedPct
    }

    points.push({
      date: point.date,
      in_event: point.in_event,
      cycle_no: currentCycleNo,
      day_in_cycle: currentCycleNo == null ? null : dayInCycle,
      asset_price: Number(assetPrice.toFixed(2)),
      evaluation_value_before_trade: preTradeEvaluationValue,
      evaluation_value: evaluationValue,
      evaluation_normalized: evaluationNormalized,
      tqqq_price_normalized: normalizeValue(assetPrice, basePrice),
      portfolio_value_before_trade: Number((preTradeEvaluationValue + poolCashBefore).toFixed(2)),
      portfolio_value: portfolioValue,
      portfolio_normalized: portfolioNormalized,
      vref_eval: vrefEval,
      vmin_eval: vminEval,
      vmax_eval: vmaxEval,
      vref_line: vrefLine,
      vmin_line: vminLine,
      vmax_line: vmaxLine,
      vref_price: vrefPrice,
      vmin_price: vminPrice,
      vmax_price: vmaxPrice,
      avg_cost_after_trade: Number(avgCost.toFixed(2)),
      avg_cost_normalized: normalizeValue(avgCost, basePrice),
      shares_before_trade: sharesBefore,
      shares_after_trade: shares,
      pool_cash_before_trade: Number(poolCashBefore.toFixed(2)),
      pool_cash_after_trade: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: cyclePoolUsedPct,
      cycle_pool_cap_pct: null, // no cap for VR Original V2
      cumulative_pool_spent: cumulativePoolSpent,
      buy_blocked_by_cycle_cap: false,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      trade_reason: tradeReason,
      state_after_trade: stateAfterTrade,
      structural_state: 'NONE',
      ...buildExplainablePointDefaults(),
    })

    tradeLog.push({
      replay_date: point.date,
      cycle_no: currentCycleNo,
      state_before: stateBefore,
      buy_signal: buySignal,
      sell_signal: false,
      defense_signal: false,
      trade_executed: tradeExecuted,
      trade_type: tradeType,
      trigger_source: tradeExecuted ? 'buy_vmin_recovery' : null,
      ladder_level_hit: tradeExecuted ? 1 : null,
      trade_price: tradePrice,
      stock_evaluation_value: preTradeEvaluationValue,
      vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
      vmax_eval: preTradeVmaxEval,
      sell_gate_open: sellGateOpen,
      shares_before: sharesBefore,
      shares_after: shares,
      avg_cost_before: Number(avgCostBefore.toFixed(2)),
      avg_cost_after: Number(avgCost.toFixed(2)),
      pool_cash_before: Number(poolCashBefore.toFixed(2)),
      pool_cash_after: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: cyclePoolUsedPct,
      blocked_by_cap: false,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      state_after: stateAfterTrade,
    })

    previousState = stateAfterTrade
  })

  if (underVminStart && points.length) {
    failedRecoveryZones.push({
      start_date: underVminStart,
      end_date: points[points.length - 1].date,
      label: 'Failed Recovery',
    })
  }

  const regeneratedScenarioPhaseZones = event.cycle_framework.cycles
    .filter((cycle) => cycle.scenario_bias?.length)
    .map((cycle) => ({
      start_date: cycle.cycle_start_date,
      end_date: cycle.cycle_end_date,
      label: cycle.scenario_bias[0],
    }))

  return {
    engine_id: 'vr_original_v2',
    engine_label: 'VR Original V2 (Benchmark)',
    cap_option: capOption.key,
    cap_label: capOption.label,
    sell_policy: {
      vmax_visual_only: false,
      sell_only_on_defense: false,
      allow_first_cycle_sell: false,
    },
    points,
    buy_markers: buyMarkers,
    sell_markers: sellMarkers,
    defense_markers: defenseMarkers,
    avg_cost_line: avgCostLine,
    pool_cap_flags: poolCapFlags,
    vmin_recovery_attempt_zones: recoveryZones,
    failed_recovery_zones: failedRecoveryZones,
    scenario_phase_zones: regeneratedScenarioPhaseZones,
    pool_usage_summary: {
      initial_pool_cash: initialPoolCash,
      cycle_pool_cap_pct: null,
      cycle_pool_used_pct: points[points.length - 1]?.cycle_pool_used_pct ?? 0,
      active_cycle_pool_used_pct: activeCyclePoolUsedPct,
      pool_cash_remaining: points[points.length - 1]?.pool_cash_after_trade ?? 0,
      cumulative_pool_spent: cumulativePoolSpent,
      blocked_buy_count: 0,
      deferred_buy_count: 0,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      guard_partial_buy_count: 0,
      guard_delayed_buy_count: 0,
      guard_blocked_buy_count: 0,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: 0,
      active_cycle_no: activeCycleNo,
      active_cycle_blocked_buy_count: 0,
      last_trade_date: lastTradeDate,
    },
    trade_log: tradeLog,
    validation_summary: {
      has_buy_execution: executedBuyCount > 0,
      has_sell_execution: executedSellCount > 0,
      has_defense_execution: false,
      avg_cost_changed: tradeLog.some((item) => item.avg_cost_after !== item.avg_cost_before),
      shares_changed: tradeLog.some((item) => item.shares_after !== item.shares_before),
      pool_cash_changed: tradeLog.some((item) => item.pool_cash_after !== item.pool_cash_before),
      blocked_by_cap_observed: false,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: 0,
      blocked_buy_count: 0,
    },
    market_chart: marketChart,
    cycle_summaries: buildCycleExecutionSummaries({
      points,
      buy_markers: buyMarkers,
      sell_markers: sellMarkers,
      defense_markers: defenseMarkers,
      pool_cap_flags: poolCapFlags,
      initial_pool_cash: initialPoolCash,
      cycles: event.cycle_framework.cycles,
    }),
    focus_window: buildExecutionFocusWindow({ points, trade_log: tradeLog }),
  }
}

// vFinal Crash Engine — DD5/DD10 crash detection, MA250 armed sell, ATH-based Vmin ladder, MA200 mop-up
function buildVariantExplainableVRV1(
  event: ExecutionPlaybackSource,
  capOption: { key: CyclePoolCapOption; pct: number | null; label: string },
  enableMacroGating = true,
): ExecutionPlaybackVariant {
  const initialState = event.cycle_start.initial_state
  const marketChart = buildMarketStructurePlayback(event)

  if (!initialState) {
    return {
      engine_id: 'explainable_vr_v1',
      engine_label: 'Explainable VR v1',
      cap_option: capOption.key,
      cap_label: capOption.label,
      sell_policy: {
        vmax_visual_only: false,
        sell_only_on_defense: false,
        allow_first_cycle_sell: true,
      },
      points: [],
      buy_markers: [],
      sell_markers: [],
      defense_markers: [],
      avg_cost_line: [],
      pool_cap_flags: [],
      vmin_recovery_attempt_zones: [],
      failed_recovery_zones: [],
      scenario_phase_zones: [],
      pool_usage_summary: {
        initial_pool_cash: 0,
        cycle_pool_cap_pct: capOption.pct,
        cycle_pool_used_pct: 0,
        active_cycle_pool_used_pct: 0,
        pool_cash_remaining: 0,
        cumulative_pool_spent: 0,
        blocked_buy_count: 0,
        deferred_buy_count: 0,
        false_bottom_risk_level: 'LOW',
        buy_delay_flag: false,
        delay_strength: 'NONE',
        reset_ready_flag: false,
        reset_confidence: 'LOW',
        reset_reason: 'EXHAUSTION',
        fast_snapback_flag: false,
        override_strength: 'NONE',
        override_reason: 'SNAPBACK',
        snapback_candidate_flag: false,
        low_reentry_flag: false,
        first_buy_override_used: false,
        override_triggered: false,
        guard_partial_buy_count: 0,
        guard_delayed_buy_count: 0,
        guard_blocked_buy_count: 0,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        active_cycle_no: null,
        active_cycle_blocked_buy_count: 0,
        last_trade_date: null,
      },
      trade_log: [],
      validation_summary: {
        has_buy_execution: false,
        has_sell_execution: false,
        has_defense_execution: false,
        avg_cost_changed: false,
        shares_changed: false,
        pool_cash_changed: false,
        blocked_by_cap_observed: false,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        blocked_buy_count: 0,
      },
      market_chart: marketChart,
      cycle_summaries: [],
      focus_window: null,
    }
  }

  const basePrice = initialState.start_price > 0 ? initialState.start_price : event.chart_data[0]?.tqqq_n ?? 100
  const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100
  const initialPoolCash = initialState.initial_pool_cash
  const initialCapital = initialState.initial_capital
  const tqqqPrices = event.chart_data.map((point) => rebaseNormalizedValue(point.tqqq_n, normalizedBase, basePrice))
  const ma200Series = event.chart_data.map((point, index) =>
    typeof point.ma200_n === 'number' && point.ma200_n > 0
      ? rebaseNormalizedValue(point.ma200_n, normalizedBase, basePrice)
      : rollingMean(tqqqPrices, index, 200),
  )
  const dd3Series = tqqqPrices.map((price, index) => (index >= 3 && tqqqPrices[index - 3] > 0 ? (price / tqqqPrices[index - 3]) - 1 : 0))
  const dd5Series = tqqqPrices.map((price, index) => (index >= 5 && tqqqPrices[index - 5] > 0 ? (price / tqqqPrices[index - 5]) - 1 : 0))
  const athSeries: number[] = []
  let runningPeak = 0
  for (let i = 0; i < tqqqPrices.length; i += 1) {
    if (tqqqPrices[i] > 0) runningPeak = Math.max(runningPeak, tqqqPrices[i])
    athSeries.push(runningPeak)
  }

  let shares = initialState.initial_share_count
  let avgCost = initialState.initial_average_price
  let poolCash = initialState.initial_pool_cash
  let cumulativePoolSpent = 0
  let currentCycleNo: number | null = null
  let cyclePoolUsed = 0
  let cycleStartPoolCash = poolCash
  let executedBuyCount = 0
  let executedSellCount = 0
  let blockedBuyCount = 0
  let deferredBuyCount = 0
  let activeCyclePoolUsedPct = 0
  let activeCycleBlockedBuyCount = 0
  let lastTradeDate: string | null = null
  let previousState = 'initialized'
  let cycleBasePortfolio = initialCapital
  let cycleBaseEvaluation = initialState.initial_share_count * basePrice
  let buyReferenceShares = Math.max(1, initialState.initial_share_count)
  let nextBuyLevelNo = 1
  let dayInCycle = 0
  let explainableState: ExplainableVRState = 'NORMAL'
  let explainablePrevState: ExplainableVRState | null = null
  let explainableStateDays = 0
  let explainableDelayCounter = 0
  let explainablePartialEntryStage = 0
  let snapbackPreentryFired = false    // v1.3: PREENTRY 1회 제한용 per-state-entry 플래그
  let crashLowPrice = tqqqPrices[0] ?? basePrice
  let crashLowIndex = 0
  let stateZoneStart = event.chart_data[0]?.date ?? event.start
  let stateZoneLabel: ExplainableVRState = 'NORMAL'
  // v1.5: mode tracking
  let prevMode: VRMode | null = null
  let prevModeDays = 0

  const points: ExecutionPoint[] = []
  const buyMarkers: ExecutionMarker[] = []
  const sellMarkers: ExecutionMarker[] = []
  const defenseMarkers: ExecutionMarker[] = []
  const poolCapFlags: ExecutionMarker[] = []
  const avgCostLine: Array<{ date: string; value: number }> = []
  const scenarioPhaseZones: ExecutionZone[] = []
  const tradeLog: ExecutionPlaybackVariant['trade_log'] = []
  const activeCycleNo = event.cycle_framework.cycles.find((cycle) => cycle.is_active_cycle)?.cycle_no ?? null

  event.chart_data.forEach((point, i) => {
    const assetPrice = tqqqPrices[i]
    const sharesBefore = shares
    const avgCostBefore = avgCost
    const poolCashBefore = poolCash
    const stateBefore = previousState
    const cycle = findCycle(event.cycle_framework.cycles, point.date)
    if (cycle?.cycle_no !== currentCycleNo) {
      currentCycleNo = cycle?.cycle_no ?? null
      dayInCycle = 1
      cyclePoolUsed = 0
      cycleStartPoolCash = poolCash
      nextBuyLevelNo = 1
      if (cycle) {
        cycleBasePortfolio = shares * assetPrice + poolCash
        cycleBaseEvaluation = shares * assetPrice
        buyReferenceShares = Math.max(1, shares)
      }
    } else {
      dayInCycle += 1
    }

    const ma200 = ma200Series[i]
    const ma200Slope =
      i >= 5 && ma200 != null && ma200Series[i - 5] != null && ma200Series[i - 5]! > 0
        ? (ma200 / ma200Series[i - 5]!) - 1
        : 0
    const dd3 = dd3Series[i]
    const dd5 = dd5Series[i]
    const recentPeak = athSeries[i]
    const peakDD = recentPeak > 0 ? (assetPrice / recentPeak) - 1 : 0

    if (peakDD <= -0.15) {
      if (assetPrice < crashLowPrice) {
        crashLowPrice = assetPrice
        crashLowIndex = i
      }
    } else if (explainableState === 'NORMAL') {
      crashLowPrice = assetPrice
      crashLowIndex = i
    }

    const reboundFromLow = crashLowPrice > 0 ? (assetPrice / crashLowPrice) - 1 : 0
    const noNewLowBars = Math.max(0, i - crashLowIndex)
    const lowerHighCount = computeLowerHighCount(tqqqPrices, i)
    const lowerLowCount = computeLowerLowCount(tqqqPrices, i)
    const energyScore = computeExplainableEnergyScore({ dd5, lowerLowCount, reboundFromLow })
    const structureBreak = ma200 != null ? assetPrice < ma200 : false
    const recoveryQuality = computeRecoveryQuality(reboundFromLow)
    const retestRisk = computeRetestRisk({ reboundFromLow, dd3 })
    const mssScore = typeof point.score === 'number' ? point.score : 100
    const mssLevel = typeof point.level === 'number' ? point.level : 0
    const mssScoreLookback =
      i >= 3 && typeof event.chart_data[i - 3]?.score === 'number' ? event.chart_data[i - 3]!.score! : mssScore
    const mssLevelLookback =
      i >= 3 && typeof event.chart_data[i - 3]?.level === 'number' ? event.chart_data[i - 3]!.level! : mssLevel
    const qqqN = typeof point.qqq_n === 'number' ? point.qqq_n : 100
    const ma50N = typeof point.ma50_n === 'number' ? point.ma50_n : 100
    const narrativeState = computeResetNarrativeState({
      structuralState: 'NONE',
      mssScore,
      mssLevel,
      qqqN,
      ma50N,
    })

    const warningCondition = dd5 <= -0.05 || lowerHighCount >= 2
    const riskOffCondition = energyScore === 'HIGH' && structureBreak
    const bottomWatchCondition = peakDD <= -0.25 || (explainableState === 'RISK_OFF' && explainableStateDays >= 5)
    const recoveryTransitionReady = recoveryQuality !== 'LOW' && energyScore !== 'HIGH'
    const normalReady = recoveryQuality === 'HIGH' && ma200 != null && assetPrice > ma200

    let nextState = explainableState
    switch (explainableState) {
      case 'NORMAL':
        if (warningCondition) nextState = 'WARNING'
        break
      case 'WARNING':
        if (riskOffCondition) nextState = 'RISK_OFF'
        else if (!warningCondition && (dd5 > -0.03 || recoveryQuality === 'HIGH')) nextState = 'NORMAL'
        break
      case 'RISK_OFF':
        if (bottomWatchCondition) nextState = 'BOTTOM_WATCH'
        break
      case 'BOTTOM_WATCH':
        if (recoveryTransitionReady) nextState = 'RE_ENTRY'
        break
      case 'RE_ENTRY':
        if (riskOffCondition) nextState = 'RISK_OFF'
        else if (retestRisk === 'HIGH') nextState = 'BOTTOM_WATCH'
        else if (normalReady) nextState = 'NORMAL'
        break
    }

    if (nextState !== explainableState) {
      scenarioPhaseZones.push({
        start_date: stateZoneStart,
        end_date: point.date,
        label: stateZoneLabel,
      })
      explainablePrevState = explainableState
      explainableState = nextState
      explainableStateDays = 1
      stateZoneStart = point.date
      stateZoneLabel = nextState
      if (nextState === 'RISK_OFF') {
        crashLowPrice = assetPrice
        crashLowIndex = i
        explainableDelayCounter = 0
        explainablePartialEntryStage = 0
      } else if (nextState === 'BOTTOM_WATCH') {
        explainableDelayCounter = 0
      } else if (nextState === 'RE_ENTRY') {
        explainablePartialEntryStage = 0
      } else if (nextState === 'NORMAL') {
        explainableDelayCounter = 0
        explainablePartialEntryStage = 0
        snapbackPreentryFired = false   // NORMAL 복개 시만 reset (새 에피소드 비슷한 환경)
        crashLowPrice = assetPrice
        crashLowIndex = i
      }
    } else {
      explainableStateDays += 1
    }

    let tradeReason: string | null = null
    let stateAfterTrade = 'hold'
    let buyBlockedByCycleCap = false
    let tradeExecuted = false
    let tradeType: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null = null
    let tradePrice: number | null = null
    let triggerSource: 'evaluation_vmax_gate' | 'representative_sell_ladder' | 'defense_reduction' | 'buy_vmin_recovery' | 'cycle_cap_block' | null = null
    let ladderLevelHit: number | null = null
    let explainableReasonCode: ExplainableVRReasonCode =
      explainableState === 'NORMAL'
        ? 'NORMAL'
        : explainableState === 'WARNING'
        ? 'WARNING_ENERGY'
        : explainableState === 'RISK_OFF'
        ? 'RISK_OFF_BREAK'
        : explainableState === 'BOTTOM_WATCH'
        ? 'BOTTOM_WATCH_DELAY'
        : 'REENTRY_DELAYED'

    const preTradeEvaluationValue = Number((shares * assetPrice).toFixed(2))
    const portfolioValueBeforeTrade = Number((preTradeEvaluationValue + poolCashBefore).toFixed(2))
    const currentExposure = portfolioValueBeforeTrade > 0 ? preTradeEvaluationValue / portfolioValueBeforeTrade : 0
    const explainableExposureTarget = computeExplainableExposureTarget({
      state: explainableState,
      structureBreak,
      ma200Slope,
      currentExposure,
    })
    const buyAllowed = explainableState === 'NORMAL' || explainableState === 'WARNING' || explainableState === 'RE_ENTRY'
    const sellAllowed = explainableState === 'RISK_OFF'
    const reentryAllowed = explainableState === 'RE_ENTRY'
    let buySignal = false
    let sellSignal = false
    let defenseSignal = false

    const cycleCapAmount =
      capOption.pct == null ? Number.POSITIVE_INFINITY : cycleStartPoolCash * (capOption.pct / 100)

    const executeExplainableBuy = (
      desiredSpend: number,
      reason: string,
      reasonCode: ExplainableVRReasonCode,
      levelNo: number | null,
    ) => {
      const remainingCycleCap = Math.max(0, cycleCapAmount - cyclePoolUsed)
      const actualSpend = Math.min(poolCash, desiredSpend, remainingCycleCap)
      if (!(actualSpend > 0)) {
        buyBlockedByCycleCap = true
        blockedBuyCount += 1
        deferredBuyCount += 1
        tradeReason = 'buy_blocked_by_cycle_cap'
        stateAfterTrade = 'buy_blocked'
        tradeType = 'blocked_buy'
        tradePrice = assetPrice
        triggerSource = 'cycle_cap_block'
        ladderLevelHit = levelNo
        explainableReasonCode = reasonCode
        return false
      }
      const newShares = Math.floor(actualSpend / assetPrice)
      if (newShares <= 0) return false
      const totalCost = shares * avgCost + newShares * assetPrice
      shares += newShares
      buyReferenceShares = Math.max(1, shares)
      avgCost = Number((totalCost / shares).toFixed(2))
      const spentCash = Number((newShares * assetPrice).toFixed(2))
      poolCash = Number((poolCash - spentCash).toFixed(2))
      cyclePoolUsed = Number((cyclePoolUsed + spentCash).toFixed(2))
      cumulativePoolSpent = Number((cumulativePoolSpent + spentCash).toFixed(2))
      tradeReason = reason
      stateAfterTrade = 'buy_executed'
      tradeExecuted = true
      tradeType = 'buy'
      tradePrice = assetPrice
      triggerSource = 'buy_vmin_recovery'
      ladderLevelHit = levelNo
      executedBuyCount += 1
      lastTradeDate = point.date
      explainableReasonCode = reasonCode
      buyMarkers.push({
        date: point.date,
        price: assetPrice,
        normalized_value: normalizeValue(assetPrice, basePrice),
        cycle_no: currentCycleNo ?? 0,
        title: reason,
        reason,
        marker_type: 'buy',
        trigger_source: 'buy_vmin_recovery',
        ladder_level_hit: levelNo,
        share_delta: newShares,
        shares_after_trade: shares,
        avg_cost_after_trade: Number(avgCost.toFixed(2)),
        pool_cash_after_trade: Number(poolCash.toFixed(2)),
        total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
        cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
        evaluation_value: Number((shares * assetPrice).toFixed(2)),
        vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
        vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
        vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
        state_after_trade: stateAfterTrade,
      })
      return true
    }

    if (sellAllowed && shares > 0 && currentExposure > explainableExposureTarget + 0.02) {
      const targetEvaluation = Math.max(0, portfolioValueBeforeTrade * explainableExposureTarget)
      const targetShares = explainableExposureTarget <= 0 ? 0 : Math.floor(targetEvaluation / assetPrice)
      const sharesToSell = Math.max(0, shares - targetShares)
      if (sharesToSell > 0) {
        const cashAdded = Number((sharesToSell * assetPrice).toFixed(2))
        shares -= sharesToSell
        poolCash = Number((poolCash + cashAdded).toFixed(2))
        if (shares === 0) avgCost = 0
        tradeReason = 'Explainable VR risk-off sell'
        stateAfterTrade = 'sell_executed'
        tradeExecuted = true
        tradeType = 'sell'
        tradePrice = assetPrice
        triggerSource = 'defense_reduction'
        executedSellCount += 1
        lastTradeDate = point.date
        sellSignal = true
        defenseSignal = true
        explainableReasonCode = 'RISK_OFF_BREAK'
        sellMarkers.push({
          date: point.date,
          price: assetPrice,
          normalized_value: normalizeValue(assetPrice, basePrice),
          cycle_no: currentCycleNo ?? 0,
          title: 'Risk-Off Sell',
          reason: tradeReason,
          marker_type: 'sell',
          trigger_source: 'defense_reduction',
          ladder_level_hit: null,
          sell_gate_open: true,
          share_delta: -sharesToSell,
          shares_after_trade: shares,
          avg_cost_after_trade: Number(avgCost.toFixed(2)),
          pool_cash_after_trade: Number(poolCash.toFixed(2)),
          total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
          cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
          evaluation_value: Number((shares * assetPrice).toFixed(2)),
          vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
          vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
          vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
          state_after_trade: stateAfterTrade,
        })
      }
    }

    const vminEvaluation = cycleBaseEvaluation * 0.85
    const isFirstLevel = nextBuyLevelNo === 1
    const buyBasePriceNow = buyReferenceShares > 0 ? vminEvaluation / buyReferenceShares : 0
    const nextLevelPrice = isFirstLevel ? null : Number((buyBasePriceNow - nextBuyLevelNo).toFixed(2))
    const vminBreach = isFirstLevel ? preTradeEvaluationValue <= vminEvaluation : nextLevelPrice != null && assetPrice <= nextLevelPrice

    // =========================================================================
    // v1.5 MACRO POLICY LAYER — NORMAL / CRISIS mode + macro_state
    // =========================================================================
    const v15Mode: VRMode = computeMode(assetPrice, ma200)
    const v15ModeDays = prevMode === v15Mode ? prevModeDays + 1 : 1
    prevMode = v15Mode
    prevModeDays = v15ModeDays

    const v15Ma200Slope = computeMa200Slope(ma200Series, i)
    const v15DD20 = computeDD20(tqqqPrices, i)
    const v15MacroState: MacroState = computeMacroState({
      ma200Slope: v15Ma200Slope,
      dd20: v15DD20,
      reboundFromLow,
      price: assetPrice,
      ma200,
    })
    const v15MacroConf: MacroConfidence = computeMacroConfidence({
      macroState: v15MacroState,
      dd20: v15DD20,
      reboundFromLow,
      ma200Slope: v15Ma200Slope,
    })

    // CRISIS gate 변수 — NORMAL mode에서는 모두 비활성
    let v15HeadwindL1Block = false    // HEADWIND: L1 buy 차단
    let v15SnapbackCap = 1.0          // HEADWIND: snapback factor cap (default 1.0 = 무제한)
    let v15PreentryBlocked = false    // HEADWIND: preentry 차단
    let v15MacroGateApplied = false

    if (v15Mode === 'CRISIS') {
      if (v15MacroState === 'POLICY_HEADWIND') {
        v15HeadwindL1Block = true     // L1 차단 (L2/L3만)
        v15SnapbackCap = 0.6          // snapback factor 최대 0.6
        v15PreentryBlocked = true     // preentry 차단
        v15MacroGateApplied = true
      } else if (v15MacroState === 'PIVOT_WATCH') {
        // L1/L2 허용, snapback 정상, preentry 허용 → gate 없음
        v15MacroGateApplied = false
      } else if (v15MacroState === 'POLICY_TAILWIND') {
        // 모든 캡 제거, 공격적 축적 허용 → gate 없음
        v15MacroGateApplied = false
      }
      // NEUTRAL: v1.3 그대로
    }
    // v1.3 baseline: disable macro gating
    if (!enableMacroGating) {
      v15HeadwindL1Block = false
      v15SnapbackCap = 1.0
      v15PreentryBlocked = false
      v15MacroGateApplied = false
    }

    // =========================================================================
    // v1.2 SELECTIVE POOL PRESERVATION
    // EARLY BLOCK: NORMAL/WARNING + energy_score != LOW → buy 차단
    // SNAPBACK TRIGGER: rebound_from_low >= 0.10 → early block 강제 해제
    // =========================================================================
    const snapbackTriggered = reboundFromLow >= 0.07  // snapback override (임계값 낮춤: 0.10→0.07)
    const earlyBlocked =
      (explainableState === 'NORMAL' || explainableState === 'WARNING') &&
      (energyScore as string) === 'HIGH' &&   // HIGH일 때만 차단 (MED는 허용)
      !snapbackTriggered             // snapback이면 차단 해제

    // v1.5: HEADWIND L1 추가 차단
    const headwindL1BlockActive = v15HeadwindL1Block && nextBuyLevelNo === 1

    const normalWarningBuySignal =
      buyAllowed &&
      (explainableState === 'NORMAL' || explainableState === 'WARNING') &&
      poolCash > 0 &&
      vminBreach &&
      !earlyBlocked &&               // early block 적용
      !headwindL1BlockActive         // v1.5 HEADWIND L1 block

    if (normalWarningBuySignal) {
      buySignal = true
      // -----------------------------------------------------------------------
      // v1.2 position_size_factor (v1.1과 동일 우선순위)
      // 1. STRONG_RECOVERY → 1.0
      // 2. SNAPBACK         → 0.8
      // 3. BASE             → 0.5
      // 4. DEFENSIVE        → 0.25
      // -----------------------------------------------------------------------
      let positionSizeFactor = 0.5 // BASE
      let sizeSuffix = ''
      const aboveMA200 = ma200 != null && assetPrice > ma200
      if (recoveryQuality === 'HIGH' && aboveMA200) {
        positionSizeFactor = 1.0
        sizeSuffix = '_STRONG_RECOVERY'
      } else if (snapbackTriggered) {
        // SNAPBACK: factor 계산 후 v1.5 HEADWIND cap 적용
        positionSizeFactor = Math.min(1.0, v15SnapbackCap)  // v1.5: HEADWIND 구간엔 0.6 cap
        sizeSuffix = v15SnapbackCap < 1.0 ? '_SNAPBACK_HEADWIND_CAP' : '_SNAPBACK'
      } else if ((energyScore as string) === 'HIGH' || (retestRisk as string) === 'HIGH') {
        positionSizeFactor = 0.25
        sizeSuffix = '_DEFENSIVE'
      }
      // WARNING 상태: 최대 BASE(0.5) 캡
      if (explainableState === 'WARNING' && positionSizeFactor > 0.5) {
        positionSizeFactor = 0.5
        sizeSuffix = sizeSuffix ? `${sizeSuffix}_WARNING_CAP` : ''
      }
      const entryStage = positionSizeFactor >= 0.8 ? 3 : positionSizeFactor >= 0.5 ? 2 : 1
      const desiredSpend = Number((poolCash * positionSizeFactor).toFixed(2))
      const baseReason = explainableState === 'WARNING'
        ? 'Explainable VR warning-size Vmin buy'
        : `Explainable VR Vmin buy L${nextBuyLevelNo}`
      const reason = `${baseReason}${sizeSuffix} [stage=${entryStage} factor=${positionSizeFactor}]`
      const reasonCode: ExplainableVRReasonCode = explainableState === 'WARNING' ? 'WARNING_ENERGY' : 'NORMAL'
      const levelNo = nextBuyLevelNo
      const executed = executeExplainableBuy(desiredSpend, reason, reasonCode, levelNo)
      nextBuyLevelNo += 1
      if (!executed && buyBlockedByCycleCap) {
        poolCapFlags.push({
          date: point.date,
          price: assetPrice,
          normalized_value: normalizeValue(assetPrice, basePrice),
          cycle_no: currentCycleNo ?? 0,
          title: `Cap Block L${levelNo}`,
          reason: 'Buy blocked by cycle pool usage cap',
          marker_type: 'cap_block',
          trigger_source: 'cycle_cap_block',
          ladder_level_hit: levelNo,
          share_delta: 0,
          blocked_level_no: levelNo,
          shares_after_trade: shares,
          avg_cost_after_trade: Number(avgCost.toFixed(2)),
          pool_cash_after_trade: Number(poolCash.toFixed(2)),
          total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
          cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
          evaluation_value: Number((shares * assetPrice).toFixed(2)),
          vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
          vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
          vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
          state_after_trade: stateAfterTrade,
        })
      }

    // =========================================================================
    // v1.3 SNAPBACK_PREENTRY micro trigger
    // condition: BOTTOM_WATCH or RE_ENTRY + rebound >= 0.04 + dd3 > 0 + energy != HIGH
    // 목적: 0.07 본 trigger 전 선제 소량 진입 (타이밍 앞당김)
    // safety: energy HIGH → 금지 / retest_risk HIGH → factor 최대 0.5
    // =========================================================================
    } else if (
      (explainableState === 'BOTTOM_WATCH' || explainableState === 'RE_ENTRY') &&
      reboundFromLow >= 0.04 &&
      (dd3 ?? 0) > 0 &&
      (energyScore as string) !== 'HIGH' &&
      poolCash > 0 &&
      !tradeExecuted &&
      !snapbackPreentryFired &&         // state 진입 이후 1회만 실행
      !v15PreentryBlocked               // v1.5: HEADWIND 구간 preentry 차단
    ) {
      buySignal = true
      let preFactor = 0.5  // base preentry factor
      let preSuffix = '_SNAPBACK_PREENTRY'
      // retest_risk HIGH이면 factor 최대 0.5 캡
      if ((retestRisk as string) === 'HIGH') {
        preFactor = Math.min(preFactor, 0.5)
        preSuffix = '_SNAPBACK_PREENTRY_RETESTCAP'
      }
      const preDesiredSpend = Number((poolCash * preFactor).toFixed(2))
      const preReason = `Explainable VR snapback pre-entry${preSuffix} [factor=${preFactor}]`
      const preStage = preFactor >= 0.5 ? 2 : 1
      executeExplainableBuy(preDesiredSpend, preReason, 'SNAPBACK_ENTRY' as ExplainableVRReasonCode, 4)
      snapbackPreentryFired = true      // 이 state-entry에서 더 이상 발화 금지
      if (explainablePartialEntryStage < preStage) {
        explainablePartialEntryStage = preStage
      }
    } else if (reentryAllowed && poolCash > 0 && explainablePartialEntryStage === 0) {

      buySignal = true
      const snapbackReady = reboundFromLow >= 0.12 && dd3 >= 0 && noNewLowBars >= 5
      const structureStable = mssScore >= mssScoreLookback && mssLevel <= mssLevelLookback && narrativeState !== 'DEFENSIVE'
      const aboveMA200ForReentry = ma200 != null && assetPrice > ma200
      const shouldDelay =
        energyScore === 'HIGH' ||
        recoveryQuality === 'LOW' ||
        (retestRisk === 'HIGH' && !snapbackReady) ||
        !structureStable
      if (shouldDelay) {
        explainableDelayCounter += 1
        explainableReasonCode = 'REENTRY_DELAYED'
        tradeReason = 'Explainable VR re-entry delayed'
        stateAfterTrade = 'buy_delayed'
      } else {
        // -----------------------------------------------------------------------
        // v1.1 position_size_factor: RE_ENTRY buy
        // Priority: STRONG_RECOVERY > SNAPBACK_BOOST > HIGH_RISK > BASE(0.5)
        // -----------------------------------------------------------------------
        let reentryFactor = 0.5 // BASE
        let reentryLabel = 'REENTRY_PARTIAL'
        let reSuffix = ''
        if (recoveryQuality === 'HIGH' && aboveMA200ForReentry) {
          // 1. STRONG_RECOVERY
          reentryFactor = 1.0
          reentryLabel = 'SNAPBACK_ENTRY'
          reSuffix = '_STRONG_RECOVERY'
        } else if (snapbackReady && (energyScore as string) !== 'HIGH') {
          // 2. SNAPBACK_BOOST
          reentryFactor = 0.8
          reentryLabel = 'SNAPBACK_ENTRY'
          reSuffix = '_SNAPBACK_BOOST'
        } else if ((energyScore as string) === 'HIGH' || (retestRisk as string) === 'HIGH') {
          // 3. HIGH_RISK
          reentryFactor = 0.25
          reentryLabel = 'REENTRY_PARTIAL'
          reSuffix = '_DEFENSIVE'
        }
        const reentryEntryStage = reentryFactor >= 0.8 ? 3 : reentryFactor >= 0.5 ? 2 : 1
        const desiredSpend = Number((poolCash * reentryFactor).toFixed(2))
        const reentryReason = `${snapbackReady || reentryFactor >= 0.8 ? 'Explainable VR snapback entry' : 'Explainable VR partial re-entry'}${reSuffix} [stage=${reentryEntryStage} factor=${reentryFactor}]`
        const executed = executeExplainableBuy(
          desiredSpend,
          reentryReason,
          reentryLabel as ExplainableVRReasonCode,
          4,
        )
        if (executed) {
          explainablePartialEntryStage = reentryEntryStage
          explainableDelayCounter = 0
        }
      }
    } else if (reentryAllowed) {
      explainableReasonCode = 'REENTRY_DELAYED'
    }

    const evaluationValue = Number((shares * assetPrice).toFixed(2))
    const portfolioValue = Number((evaluationValue + poolCash).toFixed(2))
    const vrefEval = Number(cycleBaseEvaluation.toFixed(2))
    const vminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2))
    const vmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2))
    const vrefLine = normalizeValue(cycleBasePortfolio, initialCapital)
    const vminLine = Number((vrefLine * 0.85).toFixed(2))
    const vmaxLine = Number((vrefLine * 1.15).toFixed(2))
    const cyclePoolUsedPct = initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0

    avgCostLine.push({
      date: point.date,
      value: normalizeValue(avgCost, basePrice),
    })
    points.push({
      date: point.date,
      in_event: point.in_event,
      cycle_no: currentCycleNo,
      day_in_cycle: currentCycleNo == null ? null : dayInCycle,
      asset_price: Number(assetPrice.toFixed(2)),
      evaluation_value_before_trade: preTradeEvaluationValue,
      evaluation_value: evaluationValue,
      evaluation_normalized: normalizeValue(evaluationValue, cycleBaseEvaluation || 1),
      tqqq_price_normalized: normalizeValue(assetPrice, basePrice),
      portfolio_value_before_trade: portfolioValueBeforeTrade,
      portfolio_value: portfolioValue,
      portfolio_normalized: normalizeValue(portfolioValue, initialCapital),
      vref_eval: vrefEval,
      vmin_eval: vminEval,
      vmax_eval: vmaxEval,
      vref_line: vrefLine,
      vmin_line: vminLine,
      vmax_line: vmaxLine,
      vref_price: shares > 0 ? Number((vrefEval / shares).toFixed(2)) : null,
      vmin_price: shares > 0 ? Number((vminEval / shares).toFixed(2)) : null,
      vmax_price: shares > 0 ? Number((vmaxEval / shares).toFixed(2)) : null,
      avg_cost_after_trade: Number(avgCost.toFixed(2)),
      avg_cost_normalized: normalizeValue(avgCost, basePrice),
      shares_before_trade: sharesBefore,
      shares_after_trade: shares,
      pool_cash_before_trade: Number(poolCashBefore.toFixed(2)),
      pool_cash_after_trade: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: cyclePoolUsedPct,
      cycle_pool_cap_pct: capOption.pct,
      cumulative_pool_spent: cumulativePoolSpent,
      buy_blocked_by_cycle_cap: buyBlockedByCycleCap,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      trade_reason: tradeReason,
      state_after_trade: stateAfterTrade,
      structural_state: 'NONE',
      explainable_state: explainableState,
      explainable_prev_state: explainablePrevState,
      explainable_state_days: explainableStateDays,
      explainable_delay_counter: explainableDelayCounter,
      explainable_partial_entry_stage: explainablePartialEntryStage,
      explainable_exposure_target: Number((explainableExposureTarget * 100).toFixed(1)),
      explainable_buy_allowed: buyAllowed,
      explainable_sell_allowed: sellAllowed,
      explainable_reentry_allowed: reentryAllowed,
      explainable_reason_code: explainableReasonCode,
      explainable_energy_score: energyScore,
      explainable_lower_high_count: lowerHighCount,
      explainable_lower_low_count: lowerLowCount,
      explainable_recovery_quality: recoveryQuality,
      explainable_retest_risk: retestRisk,
    })

    if (currentCycleNo === activeCycleNo) {
      activeCyclePoolUsedPct = cyclePoolUsedPct
      if (buyBlockedByCycleCap) {
        activeCycleBlockedBuyCount += 1
      }
    }

    tradeLog.push({
      replay_date: point.date,
      cycle_no: currentCycleNo,
      state_before: stateBefore,
      buy_signal: buySignal,
      sell_signal: sellSignal,
      defense_signal: defenseSignal,
      trade_executed: tradeExecuted,
      trade_type: tradeType,
      trigger_source: triggerSource,
      ladder_level_hit: ladderLevelHit,
      trade_price: tradePrice,
      stock_evaluation_value: preTradeEvaluationValue,
      vref_eval: vrefEval,
      vmax_eval: vmaxEval,
      sell_gate_open: false,
      shares_before: sharesBefore,
      shares_after: shares,
      avg_cost_before: Number(avgCostBefore.toFixed(2)),
      avg_cost_after: Number(avgCost.toFixed(2)),
      pool_cash_before: Number(poolCashBefore.toFixed(2)),
      pool_cash_after: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: cyclePoolUsedPct,
      blocked_by_cap: buyBlockedByCycleCap,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      state_after: stateAfterTrade,
    })
    previousState = stateAfterTrade
  })

  if (stateZoneStart && points.length) {
    scenarioPhaseZones.push({
      start_date: stateZoneStart,
      end_date: points[points.length - 1].date,
      label: stateZoneLabel,
    })
  }

  return {
    engine_id: 'explainable_vr_v1',
    engine_label: 'Explainable VR v1',
    cap_option: capOption.key,
    cap_label: capOption.label,
    sell_policy: {
      vmax_visual_only: false,
      sell_only_on_defense: false,
      allow_first_cycle_sell: true,
    },
    points,
    buy_markers: buyMarkers,
    sell_markers: sellMarkers,
    defense_markers: defenseMarkers,
    avg_cost_line: avgCostLine,
    pool_cap_flags: poolCapFlags,
    vmin_recovery_attempt_zones: scenarioPhaseZones.filter((zone) => zone.label === 'RE_ENTRY'),
    failed_recovery_zones: scenarioPhaseZones.filter((zone) => zone.label === 'BOTTOM_WATCH'),
    scenario_phase_zones: scenarioPhaseZones,
    pool_usage_summary: {
      initial_pool_cash: initialPoolCash,
      cycle_pool_cap_pct: capOption.pct,
      cycle_pool_used_pct: points[points.length - 1]?.cycle_pool_used_pct ?? 0,
      active_cycle_pool_used_pct: activeCyclePoolUsedPct,
      pool_cash_remaining: points[points.length - 1]?.pool_cash_after_trade ?? 0,
      cumulative_pool_spent: cumulativePoolSpent,
      blocked_buy_count: blockedBuyCount,
      deferred_buy_count: deferredBuyCount,
      false_bottom_risk_level: 'LOW',
      buy_delay_flag: false,
      delay_strength: 'NONE',
      reset_ready_flag: false,
      reset_confidence: 'LOW',
      reset_reason: 'EXHAUSTION',
      fast_snapback_flag: false,
      override_strength: 'NONE',
      override_reason: 'SNAPBACK',
      snapback_candidate_flag: false,
      low_reentry_flag: false,
      first_buy_override_used: false,
      override_triggered: false,
      guard_partial_buy_count: 0,
      guard_delayed_buy_count: 0,
      guard_blocked_buy_count: 0,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: 0,
      active_cycle_no: activeCycleNo,
      active_cycle_blocked_buy_count: activeCycleBlockedBuyCount,
      last_trade_date: lastTradeDate,
    },
    trade_log: tradeLog,
    validation_summary: {
      has_buy_execution: executedBuyCount > 0,
      has_sell_execution: executedSellCount > 0,
      has_defense_execution: false,
      avg_cost_changed: tradeLog.some((item) => item.avg_cost_after !== item.avg_cost_before),
      shares_changed: tradeLog.some((item) => item.shares_after !== item.shares_before),
      pool_cash_changed: tradeLog.some((item) => item.pool_cash_after !== item.pool_cash_before),
      blocked_by_cap_observed: blockedBuyCount > 0,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: 0,
      blocked_buy_count: blockedBuyCount,
    },
    market_chart: marketChart,
    cycle_summaries: buildCycleExecutionSummaries({
      points,
      buy_markers: buyMarkers,
      sell_markers: sellMarkers,
      defense_markers: defenseMarkers,
      pool_cap_flags: poolCapFlags,
      initial_pool_cash: initialPoolCash,
      cycles: event.cycle_framework.cycles,
    }),
    focus_window: buildExecutionFocusWindow({
      points,
      trade_log: tradeLog,
    }),
  }
}

function buildVariantVFinal(
  event: ExecutionPlaybackSource,
  capOption: { key: CyclePoolCapOption; pct: number | null; label: string },
  options: ExecutionPlaybackBuildOptions = {},
): ExecutionPlaybackVariant {
  const initialState = event.cycle_start.initial_state
  const marketChart = buildMarketStructurePlayback(event)

  if (!initialState) {
    return {
      engine_id: 'vfinal',
      engine_label: 'Scenario VR (vFinal)',
      cap_option: capOption.key,
      cap_label: capOption.label,
      sell_policy: { vmax_visual_only: false, sell_only_on_defense: false, allow_first_cycle_sell: true },
      points: [],
      buy_markers: [],
      sell_markers: [],
      defense_markers: [],
      avg_cost_line: [],
      pool_cap_flags: [],
      vmin_recovery_attempt_zones: [],
      failed_recovery_zones: [],
      scenario_phase_zones: [],
      pool_usage_summary: {
        initial_pool_cash: 0,
        cycle_pool_cap_pct: capOption.pct,
        cycle_pool_used_pct: 0,
        active_cycle_pool_used_pct: 0,
        pool_cash_remaining: 0,
        cumulative_pool_spent: 0,
        blocked_buy_count: 0,
        deferred_buy_count: 0,
        false_bottom_risk_level: 'LOW',
        buy_delay_flag: false,
        delay_strength: 'NONE',
        reset_ready_flag: false,
        reset_confidence: 'LOW',
        reset_reason: 'EXHAUSTION',
        fast_snapback_flag: false,
        override_strength: 'NONE',
        override_reason: 'SNAPBACK',
        snapback_candidate_flag: false,
        low_reentry_flag: false,
        first_buy_override_used: false,
        override_triggered: false,
        guard_partial_buy_count: 0,
        guard_delayed_buy_count: 0,
        guard_blocked_buy_count: 0,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        active_cycle_no: null,
        active_cycle_blocked_buy_count: 0,
        last_trade_date: null,
      },
      trade_log: [],
      validation_summary: {
        has_buy_execution: false,
        has_sell_execution: false,
        has_defense_execution: false,
        avg_cost_changed: false,
        shares_changed: false,
        pool_cash_changed: false,
        blocked_by_cap_observed: false,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        blocked_buy_count: 0,
      },
      market_chart: marketChart,
      cycle_summaries: [],
      focus_window: null,
    }
  }

  const normalizedBase = event.chart_data.find((p) => typeof p.tqqq_n === 'number' && p.tqqq_n > 0)?.tqqq_n ?? 100
  const basePrice = initialState.start_price > 0 ? initialState.start_price : normalizedBase
  const initialCapital = initialState.initial_capital

  // Pre-compute price series for vFinal signals
  const tqqqPrices = event.chart_data.map((p) => rebaseNormalizedValue(p.tqqq_n, normalizedBase, basePrice))
  const ma200Series = tqqqPrices.map((_, i) => rollingMean(tqqqPrices, i, 200))
  const ma250Series = tqqqPrices.map((_, i) => rollingMean(tqqqPrices, i, 250))
  const dd3Series = tqqqPrices.map((p, i) => i >= 3 && tqqqPrices[i - 3] > 0 ? (p / tqqqPrices[i - 3]) - 1 : 0)
  const dd5Series = tqqqPrices.map((p, i) => i >= 5 && tqqqPrices[i - 5] > 0 ? (p / tqqqPrices[i - 5]) - 1 : 0)
  const dd10Series = tqqqPrices.map((p, i) => i >= 10 && tqqqPrices[i - 10] > 0 ? (p / tqqqPrices[i - 10]) - 1 : 0)
  const athSeries: number[] = []
  let athPeak = 0
  for (let i = 0; i < tqqqPrices.length; i++) {
    if (tqqqPrices[i] > 0) athPeak = Math.max(athPeak, tqqqPrices[i])
    athSeries.push(athPeak)
  }

  // Portfolio state (starts with event initial_state positions)
  let shares = initialState.initial_share_count
  let avgCost = initialState.initial_average_price
  let poolCash = initialState.initial_pool_cash

  // vFinal state machine
  type VFState = 'NORMAL' | 'ARMED' | 'EXIT_DONE'
  let vfState: VFState = 'NORMAL'
  let armedDays = 0
  let crashCooldown = 0
  // Re-entry flags — reset on each crash episode
  let vmin1Done = false  // price <= ATH * 0.60
  let vmin2Done = false  // price <= ATH * 0.50
  let vmin3Done = false  // price <= ATH * 0.40
  let ma200Done = false
  let postExitCooldown = 0  // min days between exit and re-entry buys

  // Structural track (Track B) -- independent of event crash
  type StructuralState = 'NONE' | 'STRUCTURAL_WATCH' | 'STRUCTURAL_STRESS' | 'STRUCTURAL_CRASH'
  let structuralState: StructuralState = 'NONE'
  let stressStartDate: string | null = null  // when STRESS was entered
  let crashEpisodeStartDate: string | null = null
  let crashEpisodeDays = 0
  let sustainedImprovementDays = 0  // days of continuous structural improvement (for downgrade)

  // Cycle-based V-band reference (portfolio value at cycle start)
  let cycleBasePortfolio = initialCapital
  let dayInCycle = 0

  // Counters
  let executedBuyCount = 0
  let executedSellCount = 0
  let cumulativePoolSpent = 0
  let lastTradeDate: string | null = null
  let currentCycleNo: number | null = null
  let previousState = 'initialized'
  let deferredBuyCount = 0

  // vFinal ARMED debug counters
  let dbg_armedEnterCount = 0
  let dbg_cancelByRecovery = 0
  let dbg_cancelByTimeout = 0
  let dbg_ma250RetestWhileArmed = 0
  let dbg_armedDaysAccum = 0
  let dbg_armedExitCount = 0
  // Pool / crash debug
  let dbg_crashTriggerDates: string[] = []
  let dbg_normalVminBuys: Array<{date:string; level:number; price:number}> = []
  let dbg_normalVminBlocked = 0  // crash active when price hit level
  let dbg_structuralTransitions: Array<{
    date: string; from: string; to: string; episode_day: number;
    macro_score: number; internal_score: number; persistence_score: number;
    ai_assessment: string; ath_dd_pct: number; dd10_pct: number;
  }> = []

  const points: ExecutionPoint[] = []
  const buyMarkers: ExecutionMarker[] = []
  const sellMarkers: ExecutionMarker[] = []
  const defenseMarkers: ExecutionMarker[] = []
  const poolCapFlags: ExecutionMarker[] = []
  const avgCostLine: Array<{ date: string; value: number }> = []
  const tradeLog: ExecutionPlaybackVariant['trade_log'] = []
  const activeCycleNo = event.cycle_framework.cycles.find((c) => c.is_active_cycle)?.cycle_no ?? null
  const guardEnabled = options.falseBottomGuard ?? true
  const guardReleaseProfile: GuardReleaseProfile = options.guardReleaseProfile ?? 'phase5'
  let guardTrackedLow: number | null = null
  let guardTrackedLowIndex: number | null = null
  let currentFalseBottomRiskLevel: FalseBottomRiskLevel = 'LOW'
  let currentBuyDelayFlag = false
  let currentDelayStrength: BuyDelayStrength = 'NONE'
  let currentResetReadyFlag = false
  let currentResetConfidence: ResetConfidence = 'LOW'
  let currentResetReason: ResetReason = 'EXHAUSTION'
  let currentFastSnapbackFlag = false
  let currentOverrideStrength: FastSnapbackOverrideStrength = 'NONE'
  let currentOverrideReason: FastSnapbackOverrideReason = 'SNAPBACK'
  let currentSnapbackCandidateFlag = false
  let currentLowReentryFlag = false
  let currentOverrideTriggered = false
  let firstBuyOverrideUsed = false
  let phase6FirstBuyPrivilegeArmed = false
  let phase6FirstBuyPrivilegeBarsRemaining = 0
  let resetReleaseBarsRemaining = 0
  let latchedResetConfidence: ResetConfidence = 'LOW'
  let latchedResetReason: ResetReason = 'EXHAUSTION'
  let fastSnapbackFirstBuyPriorityArmed = false
  let fastSnapbackPriorityBarsRemaining = 0
  let guardPartialBuyCount = 0
  let guardDelayedBuyCount = 0
  let guardBlockedBuyCount = 0
  const delayBarsByLevel = new Map<number, number>()
  const strongBlockedLevels = new Set<number>()
  const mssScoreHistory: number[] = []
  const mssLevelHistory: number[] = []
  const dd5History: number[] = []

  const resetGuardState = () => {
    guardTrackedLow = null
    guardTrackedLowIndex = null
    currentFalseBottomRiskLevel = 'LOW'
    currentBuyDelayFlag = false
    currentDelayStrength = 'NONE'
    currentResetReadyFlag = false
    currentResetConfidence = 'LOW'
    currentResetReason = 'EXHAUSTION'
    currentFastSnapbackFlag = false
    currentOverrideStrength = 'NONE'
    currentOverrideReason = 'SNAPBACK'
    currentSnapbackCandidateFlag = false
    currentLowReentryFlag = false
    currentOverrideTriggered = false
    firstBuyOverrideUsed = false
    phase6FirstBuyPrivilegeArmed = false
    phase6FirstBuyPrivilegeBarsRemaining = 0
    resetReleaseBarsRemaining = 0
    latchedResetConfidence = 'LOW'
    latchedResetReason = 'EXHAUSTION'
    fastSnapbackFirstBuyPriorityArmed = false
    fastSnapbackPriorityBarsRemaining = 0
    delayBarsByLevel.clear()
    strongBlockedLevels.clear()
  }

  event.chart_data.forEach((point, i) => {
    currentOverrideTriggered = false
    const assetPrice = rebaseNormalizedValue(point.tqqq_n, normalizedBase, basePrice)
    const sharesBefore = shares
    const avgCostBefore = avgCost
    const poolCashBefore = poolCash
    const stateBefore = previousState
    const cycle = findCycle(event.cycle_framework.cycles, point.date)
    if (cycle?.cycle_no !== currentCycleNo) {
      currentCycleNo = cycle?.cycle_no ?? null
      dayInCycle = 1
      if (cycle) {
        // Portfolio value at cycle start = V-band reference
        cycleBasePortfolio = Number((shares * assetPrice + poolCash).toFixed(2))
      }
    } else {
      dayInCycle += 1
    }

    const ma200 = ma200Series[i]
    const ma250 = ma250Series[i]
    const dd3 = dd3Series[i]
    const dd5 = dd5Series[i]
    const dd10 = dd10Series[i]
    const ath = athSeries[i]
    const TRANCHE = Number((initialCapital * 0.20).toFixed(2))
    const mssScore = typeof point.score === 'number' ? point.score : 100
    const mssLevel = typeof point.level === 'number' ? point.level : 0
    const qqqN = typeof point.qqq_n === 'number' ? point.qqq_n : 100
    const ma50N = typeof point.ma50_n === 'number' ? point.ma50_n : 100
    const peakDD = ath > 0 ? (assetPrice / ath) - 1 : 0

    let tradeReason: string | null = null
    let stateAfterTrade = 'hold'
    let tradeExecuted = false
    let tradeType: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null = null
    let tradePrice: number | null = null
    let triggerSource: 'evaluation_vmax_gate' | 'representative_sell_ladder' | 'defense_reduction' | 'buy_vmin_recovery' | 'cycle_cap_block' | null = null
    let ladderLevelHit: number | null = null
    const buySignal = false
    const sellSignal = false
    const defenseSignal = false

    if (crashCooldown > 0) crashCooldown -= 1
    if (postExitCooldown > 0) postExitCooldown -= 1

    const guardWindowActive =
      peakDD <= -0.15 || vfState !== 'NORMAL' || vmin1Done || vmin2Done || vmin3Done

    let newGuardLowRecorded = false
    if (guardWindowActive) {
      if (guardTrackedLow == null || assetPrice < guardTrackedLow) {
        guardTrackedLow = assetPrice
        guardTrackedLowIndex = i
        newGuardLowRecorded = true
      }
    } else if (peakDD > -0.10 && vfState === 'NORMAL') {
      resetGuardState()
    }

    const reboundFromLow =
      guardTrackedLow != null && guardTrackedLow > 0 ? (assetPrice / guardTrackedLow) - 1 : 0
    const narrativeState = computeGuardNarrativeState({
      structuralState,
      vfState,
      mssScore,
      mssLevel,
      qqqN,
      ma50N,
    })
    const resetNarrativeState = computeResetNarrativeState({
      structuralState,
      mssScore,
      mssLevel,
      qqqN,
      ma50N,
    })
    currentFalseBottomRiskLevel = guardEnabled
      ? computeFalseBottomRiskLevel({
          peakDD,
          reboundFromLow,
          dd3,
          dd5,
        })
      : 'LOW'
    const baseDelayStrength = guardEnabled
      ? computeBuyDelayStrength({
          falseBottomRiskLevel: currentFalseBottomRiskLevel,
          narrativeState,
        })
      : 'NONE'
    const mssScoreLookback = mssScoreHistory.length >= 3 ? mssScoreHistory[mssScoreHistory.length - 3] : mssScore
    const mssLevelLookback = mssLevelHistory.length >= 3 ? mssLevelHistory[mssLevelHistory.length - 3] : mssLevel
    const dd5Lookback = dd5History.length >= 3 ? dd5History[dd5History.length - 3] : dd5
    const noNewLowBars = guardTrackedLowIndex == null ? 0 : i - guardTrackedLowIndex
    const distToMA200 = ma200 != null && ma200 > 0 ? (assetPrice - ma200) / ma200 : null
    const guardAdjustment = guardEnabled
      ? computeGuardAdjustment({
          guardReleaseProfile,
          delayStrength: baseDelayStrength,
          falseBottomRiskLevel: currentFalseBottomRiskLevel,
          narrativeState,
          reboundFromLow,
          dd3,
          dd5,
          daysSinceLow: noNewLowBars,
          recentNewLow: noNewLowBars <= 2,
          distToMA200,
        })
      : {
          adjustedDelayStrength: 'NONE' as BuyDelayStrength,
          snapbackSpeed: 'LOW' as SnapbackSpeedLevel,
          reentryAvailability: 'HIGH' as ReentryAvailabilityLevel,
          reentryScore: 0,
          ma200TimingTight: false,
        }
    const resetSignal = guardEnabled
      ? computeResetSignal({
          noNewLowBars,
          dd3,
          dd5,
          dd5Lookback,
          reboundFromLow,
          mssScore,
          mssScoreLookback,
          mssLevel,
          mssLevelLookback,
          narrativeState: resetNarrativeState,
          guardReleaseProfile,
        })
      : {
          resetReadyFlag: false,
          resetConfidence: 'LOW' as ResetConfidence,
          resetReason: 'EXHAUSTION' as ResetReason,
          exhaustionReady: false,
          reboundReady: false,
          structureReady: false,
          fastSnapbackReady: false,
          fastReboundReleaseReady: false,
        }
    const fastSnapbackOverride = guardEnabled
      ? computeFastSnapbackOverride({
          guardReleaseProfile,
          reboundFromLow,
          dd3,
          dd5,
          noNewLowBars,
          falseBottomRiskLevel: currentFalseBottomRiskLevel,
          resetReadyFlag: resetSignal.resetReadyFlag,
          resetConfidence: resetSignal.resetConfidence,
        })
      : {
          fastSnapbackFlag: false,
          overrideStrength: 'NONE' as FastSnapbackOverrideStrength,
          overrideReason: 'SNAPBACK' as FastSnapbackOverrideReason,
        }
    const selectiveSnapbackOverride = guardEnabled
      ? computeSelectiveSnapbackFirstBuyOverride({
          guardReleaseProfile,
          reboundFromLow,
          dd3,
          dd5,
          noNewLowBars,
          falseBottomRiskLevel: currentFalseBottomRiskLevel,
          resetReadyFlag: resetSignal.resetReadyFlag,
          resetConfidence: resetSignal.resetConfidence,
          narrativeState,
        })
      : {
          snapbackCandidateFlag: false,
          lowReentryFlag: false,
          overrideCandidate: false,
        }
    if (newGuardLowRecorded) {
      resetReleaseBarsRemaining = 0
      latchedResetConfidence = 'LOW'
      latchedResetReason = 'EXHAUSTION'
      fastSnapbackFirstBuyPriorityArmed = false
      fastSnapbackPriorityBarsRemaining = 0
      phase6FirstBuyPrivilegeArmed = false
      phase6FirstBuyPrivilegeBarsRemaining = 0
      firstBuyOverrideUsed = false
    }

    let effectiveResetReadyFlag = resetSignal.resetReadyFlag
    let effectiveResetConfidence = resetSignal.resetConfidence
    let effectiveResetReason = resetSignal.resetReason
    const previousResetReadyFlag = currentResetReadyFlag

    if (resetSignal.resetReadyFlag) {
      resetReleaseBarsRemaining = getResetReleaseWindowBars(
        resetSignal.resetConfidence,
        guardReleaseProfile,
        currentFalseBottomRiskLevel,
      )
      latchedResetConfidence = resetSignal.resetConfidence
      latchedResetReason = resetSignal.resetReason
    } else if (
      resetReleaseBarsRemaining > 0 &&
      !newGuardLowRecorded &&
      (latchedResetConfidence === 'HIGH' || currentFalseBottomRiskLevel !== 'LOW')
    ) {
      effectiveResetReadyFlag = true
      effectiveResetConfidence = latchedResetConfidence
      effectiveResetReason = latchedResetReason
      resetReleaseBarsRemaining -= 1
    }

    currentResetReadyFlag = effectiveResetReadyFlag
    currentResetConfidence = effectiveResetConfidence
    currentResetReason = effectiveResetReason
    currentFastSnapbackFlag = fastSnapbackOverride.fastSnapbackFlag
    currentOverrideStrength = fastSnapbackOverride.overrideStrength
    currentOverrideReason = fastSnapbackOverride.overrideReason
    currentSnapbackCandidateFlag = selectiveSnapbackOverride.snapbackCandidateFlag
    currentLowReentryFlag = selectiveSnapbackOverride.lowReentryFlag
    currentDelayStrength = applyResetReleaseOverride({
      delayStrength: guardAdjustment.adjustedDelayStrength,
      resetReadyFlag: currentResetReadyFlag,
      resetConfidence: currentResetConfidence,
      fastSnapbackReady: resetSignal.fastSnapbackReady,
      fastReboundReleaseReady: resetSignal.fastReboundReleaseReady,
    })
    currentDelayStrength = applyFastSnapbackDelayOverride({
      delayStrength: currentDelayStrength,
      overrideStrength: currentOverrideStrength,
    })
    let fastSnapbackPriorityArmedThisBar = false
    if (
      currentFastSnapbackFlag &&
      currentResetReadyFlag &&
      currentResetConfidence !== 'LOW' &&
      !fastSnapbackFirstBuyPriorityArmed
    ) {
      fastSnapbackFirstBuyPriorityArmed = true
      fastSnapbackPriorityBarsRemaining = getFastSnapbackPriorityWindowBars(
        currentResetConfidence,
        currentFalseBottomRiskLevel,
      )
      fastSnapbackPriorityArmedThisBar = true
    } else if (
      currentFastSnapbackFlag &&
      currentResetReadyFlag &&
      currentResetConfidence !== 'LOW' &&
      fastSnapbackFirstBuyPriorityArmed
    ) {
      fastSnapbackPriorityBarsRemaining = Math.max(
        fastSnapbackPriorityBarsRemaining,
        getFastSnapbackPriorityWindowBars(currentResetConfidence, currentFalseBottomRiskLevel),
      )
      fastSnapbackPriorityArmedThisBar = true
    } else if (fastSnapbackPriorityBarsRemaining <= 0) {
      fastSnapbackFirstBuyPriorityArmed = false
      fastSnapbackPriorityBarsRemaining = 0
    }
    if (
      guardReleaseProfile === 'phase6' &&
      !previousResetReadyFlag &&
      currentResetReadyFlag
    ) {
      firstBuyOverrideUsed = false
      phase6FirstBuyPrivilegeArmed = true
      phase6FirstBuyPrivilegeBarsRemaining = getPhase6FirstBuyOverrideWindowBars()
    } else if (
      guardReleaseProfile === 'phase6' &&
      (!currentResetReadyFlag || firstBuyOverrideUsed)
    ) {
      phase6FirstBuyPrivilegeArmed = false
      phase6FirstBuyPrivilegeBarsRemaining = 0
    }
    currentBuyDelayFlag = guardEnabled && currentDelayStrength !== 'NONE'

    mssScoreHistory.push(mssScore)
    mssLevelHistory.push(mssLevel)
    dd5History.push(dd5)

    const markLevelDone = (levelNo: number) => {
      if (levelNo === 1) vmin1Done = true
      else if (levelNo === 2) vmin2Done = true
      else if (levelNo === 3) vmin3Done = true
    }

    const executeGuardedVminBuy = (
      lvl: { levelNo: number; label: string },
      spendFraction: number,
      reason: string
    ) => {
      const spend = Math.min(poolCash, Number((TRANCHE * spendFraction).toFixed(2)))
      const newShares = Math.floor(spend / assetPrice)
      if (newShares <= 0) return false

      const totalCost = shares * avgCost + newShares * assetPrice
      shares += newShares
      avgCost = Number((totalCost / shares).toFixed(2))
      poolCash = Number((poolCash - newShares * assetPrice).toFixed(2))
      cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2))
      markLevelDone(lvl.levelNo)
      tradeReason = reason
      stateAfterTrade = 'buy_executed'
      tradeExecuted = true
      tradeType = 'buy'
      tradePrice = assetPrice
      triggerSource = 'buy_vmin_recovery'
      ladderLevelHit = lvl.levelNo
      executedBuyCount += 1
      lastTradeDate = point.date
      dbg_normalVminBuys.push({ date: point.date, level: lvl.levelNo, price: assetPrice })
      buyMarkers.push({
        date: point.date,
        price: assetPrice,
        normalized_value: normalizeValue(assetPrice, basePrice),
        cycle_no: currentCycleNo ?? 0,
        title: reason,
        reason,
        marker_type: 'buy',
        trigger_source: 'buy_vmin_recovery',
        ladder_level_hit: lvl.levelNo,
        share_delta: newShares,
        shares_after_trade: shares,
        avg_cost_after_trade: Number(avgCost.toFixed(2)),
        pool_cash_after_trade: Number(poolCash.toFixed(2)),
        total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
        cycle_pool_used_pct: initialCapital > 0
          ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
          : 0,
        evaluation_value: Number((shares * assetPrice).toFixed(2)),
        vref_eval: 0,
        vmin_eval: 0,
        vmax_eval: 0,
        state_after_trade: stateAfterTrade,
      })
      delayBarsByLevel.delete(lvl.levelNo)
      strongBlockedLevels.delete(lvl.levelNo)
      return true
    }

    const handleGuardedVminLevels = (
      vminLevels: Array<{ done: boolean; fraction: number; label: string; levelNo: number }>
    ) => {
      const activeLevelNos = vminLevels
        .filter((lvl) => !lvl.done && ath > 0 && assetPrice <= ath * lvl.fraction && poolCash >= 1)
        .map((lvl) => lvl.levelNo)

      Array.from(delayBarsByLevel.keys()).forEach((levelNo) => {
        if (!activeLevelNos.includes(levelNo)) delayBarsByLevel.delete(levelNo)
      })
      Array.from(strongBlockedLevels.values()).forEach((levelNo) => {
        if (!activeLevelNos.includes(levelNo)) strongBlockedLevels.delete(levelNo)
      })

      for (const lvl of vminLevels) {
        if (!activeLevelNos.includes(lvl.levelNo)) continue

        if (!guardEnabled) {
          return executeGuardedVminBuy(lvl, 1, lvl.label)
        }

        const phase6FirstBuyOpportunityActive =
          guardReleaseProfile === 'phase6' &&
          phase6FirstBuyPrivilegeArmed &&
          currentResetReadyFlag &&
          !firstBuyOverrideUsed

        const phase6FirstBuyOverrideActive =
          phase6FirstBuyOpportunityActive &&
          currentSnapbackCandidateFlag &&
          currentLowReentryFlag &&
          currentFalseBottomRiskLevel !== 'HIGH'

        if (phase6FirstBuyOverrideActive) {
          phase6FirstBuyPrivilegeArmed = false
          phase6FirstBuyPrivilegeBarsRemaining = 0
          firstBuyOverrideUsed = true
          currentOverrideTriggered = true
          return executeGuardedVminBuy(lvl, 1, `${lvl.label} (snapback first-buy override)`)
        }

        if (phase6FirstBuyOpportunityActive) {
          phase6FirstBuyPrivilegeArmed = false
          phase6FirstBuyPrivilegeBarsRemaining = 0
        }

        const fastSnapbackPriorityActive =
          guardReleaseProfile === 'phase5' &&
          fastSnapbackFirstBuyPriorityArmed &&
          fastSnapbackPriorityBarsRemaining > 0

        if (fastSnapbackPriorityActive) {
          fastSnapbackFirstBuyPriorityArmed = false
          fastSnapbackPriorityBarsRemaining = 0
          if (currentFalseBottomRiskLevel === 'HIGH') {
            guardPartialBuyCount += 1
            return executeGuardedVminBuy(lvl, 0.5, `${lvl.label} (fast snapback partial)`)
          }
          return executeGuardedVminBuy(lvl, 1, `${lvl.label} (fast snapback override)`)
        }

        if (currentDelayStrength === 'STRONG') {
          if (!strongBlockedLevels.has(lvl.levelNo)) {
            strongBlockedLevels.add(lvl.levelNo)
            guardBlockedBuyCount += 1
          }
          tradeReason = 'buy blocked by false-bottom guard'
          stateAfterTrade = 'buy_blocked'
          tradeType = 'blocked_buy'
          tradePrice = assetPrice
          ladderLevelHit = lvl.levelNo
          dbg_normalVminBlocked += 1
          return true
        }

        strongBlockedLevels.delete(lvl.levelNo)

        if (currentDelayStrength === 'MODERATE') {
          const remainingBars = delayBarsByLevel.get(lvl.levelNo)
          if (remainingBars == null) {
            const delayBars = currentFalseBottomRiskLevel === 'HIGH' ? 2 : 1
            delayBarsByLevel.set(lvl.levelNo, delayBars)
            guardDelayedBuyCount += 1
            deferredBuyCount += 1
            tradeReason = `buy delayed by false-bottom guard (${delayBars} bars)`
            stateAfterTrade = 'buy_delayed'
            tradePrice = assetPrice
            ladderLevelHit = lvl.levelNo
            return true
          }

          if (remainingBars > 1) {
            delayBarsByLevel.set(lvl.levelNo, remainingBars - 1)
            tradeReason = 'buy delay still active'
            stateAfterTrade = 'buy_delayed'
            tradePrice = assetPrice
            ladderLevelHit = lvl.levelNo
            return true
          }

          delayBarsByLevel.delete(lvl.levelNo)
        }

        if (currentDelayStrength === 'WEAK') {
          if (
            guardReleaseProfile !== 'phase2' &&
            lvl.levelNo >= 2 &&
            currentResetReadyFlag &&
            currentResetConfidence === 'MEDIUM'
          ) {
            const remainingBars = delayBarsByLevel.get(lvl.levelNo)
            if (remainingBars == null) {
              delayBarsByLevel.set(lvl.levelNo, 1)
              guardDelayedBuyCount += 1
              deferredBuyCount += 1
              tradeReason = `buy delayed by false-bottom guard (${guardReleaseProfile} level-2 hold)`
              stateAfterTrade = 'buy_delayed'
              tradePrice = assetPrice
              ladderLevelHit = lvl.levelNo
              return true
            }

            if (remainingBars > 1) {
              delayBarsByLevel.set(lvl.levelNo, remainingBars - 1)
              tradeReason = 'buy delay still active'
              stateAfterTrade = 'buy_delayed'
              tradePrice = assetPrice
              ladderLevelHit = lvl.levelNo
              return true
            }

            delayBarsByLevel.delete(lvl.levelNo)
          }

          guardPartialBuyCount += 1
          return executeGuardedVminBuy(lvl, 0.5, `${lvl.label} (delayed partial)`)
        }

        return executeGuardedVminBuy(lvl, 1, lvl.label)
      }

      return false
    }

    // ── NORMAL: crash detection ──
    if (vfState === 'NORMAL' && crashCooldown === 0) {
      const ma200Gate = ma200 != null && assetPrice <= ma200 * 1.05
      const crashTrigger = dd5 <= -0.10 && dd10 <= -0.18 && ma200Gate
      if (crashTrigger) {
        dbg_crashTriggerDates.push(point.date)
        if (crashEpisodeStartDate === null) {
          crashEpisodeStartDate = point.date
          crashEpisodeDays = 0
        }
        const ma250Retest = ma250 != null && assetPrice >= ma250 * 0.995
        if (ma250Retest) {
          // Immediate sell — price at or above MA250
          if (shares > 0) {
            const sharesToSell = shares
            const evalAtSell = Number((sharesToSell * assetPrice).toFixed(2))
            const cashAdded = Number((sharesToSell * assetPrice).toFixed(2))
            poolCash = Number((poolCash + cashAdded).toFixed(2))
            shares = 0
            avgCost = 0
            vfState = 'EXIT_DONE'
            postExitCooldown = 5
            ma200Done = false
            tradeReason = 'vFinal crash exit — MA250 retest immediate'
            stateAfterTrade = 'sell_executed'
            tradeExecuted = true
            tradeType = 'sell'
            tradePrice = assetPrice
            triggerSource = 'representative_sell_ladder'
            executedSellCount += 1
            lastTradeDate = point.date
            sellMarkers.push({
              date: point.date,
              price: assetPrice,
              normalized_value: normalizeValue(assetPrice, basePrice),
              cycle_no: currentCycleNo ?? 0,
              title: 'Crash Exit',
              reason: 'vFinal: DD5/DD10 crash + MA250 retest — 100% sell',
              marker_type: 'sell',
              trigger_source: 'representative_sell_ladder',
              ladder_level_hit: 1,
              sell_gate_open: true,
              share_delta: -sharesToSell,
              shares_after_trade: shares,
              avg_cost_after_trade: 0,
              pool_cash_after_trade: Number(poolCash.toFixed(2)),
              total_portfolio_value: Number((poolCash).toFixed(2)),
              cycle_pool_used_pct: 0,
              evaluation_value: evalAtSell,
              vref_eval: 0,
              vmin_eval: 0,
              vmax_eval: 0,
              state_after_trade: stateAfterTrade,
            })
          } else {
            vfState = 'EXIT_DONE'
            ma200Done = false
          }
        } else {
          // ARMED — wait for MA250 retest
          vfState = 'ARMED'
          armedDays = 0
          dbg_armedEnterCount += 1
        }
      }

      // Opportunistic Vmin pool deployment in NORMAL state (ATH-fraction ladder)
      // Shared vmin flags with EXIT_DONE prevent double-buying
      if (vfState === 'NORMAL' && poolCash >= 1) {
        const vminLevels = [
          { done: vmin1Done, fraction: 0.60, label: 'Vmin -40% ATH', levelNo: 1 },
          { done: vmin2Done, fraction: 0.50, label: 'Vmin -50% ATH', levelNo: 2 },
          { done: vmin3Done, fraction: 0.40, label: 'Vmin -60% ATH', levelNo: 3 },
        ]
        handleGuardedVminLevels(vminLevels)
      }
    }

    // ── ARMED: short-validity crash sell signal (15 trading days) ──
    // Sell only on weak-rebound MA250 retest while crash signal is still active.
    // Cancel (no sell) if crash eases (recovery confirmation) or signal times out.
    else if (vfState === 'ARMED') {
      armedDays += 1
      dbg_armedDaysAccum += 1

      // Recovery confirmation → both dd5 AND dd10 must recover (AND, not OR)
      const crashRecovered = dd5 > -0.05 && dd10 > -0.10
      // Timeout → stale signal → expire silently, no forced sell (15d)
      const signalExpired = armedDays >= 15

      if (crashRecovered || signalExpired) {
        // Signal expired — return to NORMAL without any trade
        if (crashRecovered) dbg_cancelByRecovery += 1
        else dbg_cancelByTimeout += 1
        dbg_armedExitCount += 1
        vfState = 'NORMAL'
        armedDays = 0
        crashEpisodeStartDate = null
        crashEpisodeDays = 0
        structuralState = 'NONE'
        stressStartDate = null
        resetGuardState()
      } else {
        // MA250 retest: close retest OR high proxy (+3% of close, TQQQ intraday range)
        const closeRetest = ma250 != null && assetPrice >= ma250 * 0.995
        const highProxyRetest = ma250 != null && assetPrice >= ma250 * 0.97
        const ma250Retest = closeRetest || highProxyRetest
        if (ma250Retest) dbg_ma250RetestWhileArmed += 1
        if (ma250Retest && armedDays >= 2) {
          if (shares > 0) {
            const sharesToSell = shares
            const evalAtSell = Number((sharesToSell * assetPrice).toFixed(2))
            const cashAdded = Number((sharesToSell * assetPrice).toFixed(2))
            poolCash = Number((poolCash + cashAdded).toFixed(2))
            shares = 0
            avgCost = 0
            tradeReason = 'vFinal armed sell — MA250 retest (weak rebound)'
            stateAfterTrade = 'sell_executed'
            tradeExecuted = true
            tradeType = 'sell'
            tradePrice = assetPrice
            triggerSource = 'representative_sell_ladder'
            executedSellCount += 1
            lastTradeDate = point.date
            sellMarkers.push({
              date: point.date,
              price: assetPrice,
              normalized_value: normalizeValue(assetPrice, basePrice),
              cycle_no: currentCycleNo ?? 0,
              title: 'Crash Exit (Armed)',
              reason: tradeReason ?? '',
              marker_type: 'sell',
              trigger_source: 'representative_sell_ladder',
              ladder_level_hit: 1,
              sell_gate_open: true,
              share_delta: -sharesToSell,
              shares_after_trade: shares,
              avg_cost_after_trade: 0,
              pool_cash_after_trade: Number(poolCash.toFixed(2)),
              total_portfolio_value: Number((poolCash).toFixed(2)),
              cycle_pool_used_pct: 0,
              evaluation_value: evalAtSell,
              vref_eval: 0,
              vmin_eval: 0,
              vmax_eval: 0,
              state_after_trade: stateAfterTrade,
            })
          }
          vfState = 'EXIT_DONE'
          postExitCooldown = 5
          ma200Done = false
        }
      }
    }

    // ── EXIT_DONE: Vmin ATH ladder then MA200 mop-up ──
    else if (vfState === 'EXIT_DONE' && postExitCooldown === 0) {
      // Layer 1 — three Vmin tranches at ATH fractions
      const vminLevels = [
        { done: vmin1Done, fraction: 0.60, label: 'Vmin -40% ATH', levelNo: 1 },
        { done: vmin2Done, fraction: 0.50, label: 'Vmin -50% ATH', levelNo: 2 },
        { done: vmin3Done, fraction: 0.40, label: 'Vmin -60% ATH', levelNo: 3 },
      ]
      handleGuardedVminLevels(vminLevels)

      // Layer 3 — MA200 mop-up (buy all remaining cash when price recovers above MA200)
      if (!ma200Done && ma200 != null && assetPrice >= ma200 && poolCash >= 1) {
        const spend = poolCash
        const newShares = Math.floor(spend / assetPrice)
        if (newShares > 0) {
          const totalCost = shares * avgCost + newShares * assetPrice
          shares += newShares
          avgCost = Number((totalCost / shares).toFixed(2))
          poolCash = Number((poolCash - newShares * assetPrice).toFixed(2))
          cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2))
          ma200Done = true
          vfState = 'NORMAL'
          crashCooldown = 10
          crashEpisodeStartDate = null
          crashEpisodeDays = 0
          structuralState = 'NONE'
          stressStartDate = null
          resetGuardState()
          tradeReason = 'vFinal MA200 mop-up — full re-entry'
          stateAfterTrade = 'buy_executed'
          tradeExecuted = true
          tradeType = 'buy'
          tradePrice = assetPrice
          triggerSource = 'buy_vmin_recovery'
          ladderLevelHit = 4
          executedBuyCount += 1
          lastTradeDate = point.date
          buyMarkers.push({
            date: point.date,
            price: assetPrice,
            normalized_value: normalizeValue(assetPrice, basePrice),
            cycle_no: currentCycleNo ?? 0,
            title: 'MA200 Re-entry',
            reason: 'vFinal: price crosses MA200 — buy all remaining cash',
            marker_type: 'buy',
            trigger_source: 'buy_vmin_recovery',
            ladder_level_hit: 4,
            share_delta: newShares,
            shares_after_trade: shares,
            avg_cost_after_trade: Number(avgCost.toFixed(2)),
            pool_cash_after_trade: Number(poolCash.toFixed(2)),
            total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
            cycle_pool_used_pct: initialCapital > 0
              ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
              : 0,
            evaluation_value: Number((shares * assetPrice).toFixed(2)),
            vref_eval: 0,
            vmin_eval: 0,
            vmax_eval: 0,
            state_after_trade: stateAfterTrade,
          })
        }
      }
    }

    // Track B: Structural state update (WO60-B hybrid macro+internal+persistence+AI scoring)
    {
      // ── Macro flags (from MSS score + QQQ trend signals) ──
      const mssScore = typeof point.score === 'number' ? point.score : 100
      const mssLevel = typeof point.level === 'number' ? point.level : 0
      const qqqN   = typeof point.qqq_n   === 'number' ? point.qqq_n   : 100
      const ma50N  = typeof point.ma50_n  === 'number' ? point.ma50_n  : 100
      const ma200N = typeof point.ma200_n === 'number' ? point.ma200_n : 100
      const tqqqDd = typeof point.tqqq_dd === 'number' ? point.tqqq_dd : 0
      const liquidityTightening    = mssScore < 95
      const creditStress           = mssScore < 88
      const financialConditionsTight = mssScore < 84
      const growthScare            = mssLevel >= 3
      const policyPressure         = ma50N > 0 && qqqN < ma50N
      const macroScore =
        Number(liquidityTightening) + Number(creditStress) +
        Number(financialConditionsTight) + Number(growthScare) + Number(policyPressure)

      // ── Internal flags ──
      const breadthWeak        = ma200N > 0 && qqqN < ma200N
      const reboundFailure     = crashEpisodeDays > 30
      const trendBroken        = ma200N > 0 && qqqN < ma200N * 0.97
      const volPersistent      = tqqqDd < -15
      const leverageWeakness   = tqqqDd < -30
      const internalScore =
        Number(breadthWeak) + Number(reboundFailure) +
        Number(trendBroken) + Number(volPersistent) + Number(leverageWeakness)

      // ── Persistence score ──
      // Note: persistenceScore >= 3 requires ep > 20d (gates premature escalation)
      //       persistenceScore >= 4 requires ep > 40d (gates CRASH entry)
      const persistenceScore =
        Number(crashEpisodeStartDate !== null) +
        Number(crashEpisodeDays > 20) +
        Number(crashEpisodeDays > 40) +
        Number(crashEpisodeDays > 60) +
        Number(dd10 < -0.08)

      // ── AI assessment (rule-based simulation — no live API call in playback loop) ──
      const totalScore = macroScore + internalScore + persistenceScore
      const aiAssessment: string =
        totalScore >= 12 || (macroScore >= 4 && internalScore >= 4) ? 'structural_crash_candidate' :
        totalScore >= 8  || (macroScore >= 3 && internalScore >= 3) ? 'structural_deterioration'   :
        totalScore >= 5  || persistenceScore >= 3                   ? 'persistent_stress'          :
                                                                       'temporary_shock'

      const athDD = ath > 0 ? (assetPrice / ath) - 1 : 0
      const severeDamage = dd10 < -0.30 || athDD < -0.30
      const prevStructural = structuralState

      // ── Upgrade transitions (episode-driven; elif prevents same-day multi-level jumps) ──
      if (crashEpisodeStartDate !== null) {
        crashEpisodeDays += 1

        // NONE -> STRUCTURAL_WATCH (requires persistenceScore >= 3, i.e. ep > 20d)
        if (structuralState === 'NONE') {
          if (
            persistenceScore >= 3 &&
            (macroScore >= 2 || internalScore >= 3 || aiAssessment === 'persistent_stress')
          ) {
            structuralState = 'STRUCTURAL_WATCH'
            sustainedImprovementDays = 0
          }
        // STRUCTURAL_WATCH -> STRUCTURAL_STRESS (elif: no same-day jump from NONE->WATCH->STRESS)
        } else if (structuralState === 'STRUCTURAL_WATCH') {
          if (
            persistenceScore >= 3 &&
            (
              (macroScore >= 3 && internalScore >= 3) ||
              (aiAssessment === 'structural_deterioration' && macroScore >= 3)
            )
          ) {
            structuralState = 'STRUCTURAL_STRESS'
            stressStartDate = point.date
            sustainedImprovementDays = 0
          }
        // STRUCTURAL_STRESS -> STRUCTURAL_CRASH (requires ep > 40d via persistenceScore >= 4)
        } else if (structuralState === 'STRUCTURAL_STRESS' && severeDamage) {
          if (
            persistenceScore >= 4 &&
            (
              (macroScore >= 4 && internalScore >= 3) ||
              (aiAssessment === 'structural_crash_candidate' && macroScore >= 4)
            )
          ) {
            structuralState = 'STRUCTURAL_CRASH'
            sustainedImprovementDays = 0
          }
        }
      }

      // ── Downgrade logic: sustained improvement window (15 days) ──
      const structuralImproving =
        macroScore <= 1 &&
        internalScore <= 2 &&
        crashEpisodeStartDate === null &&
        (aiAssessment === 'temporary_shock' || aiAssessment === 'persistent_stress')
      if (structuralImproving && structuralState !== 'NONE') {
        sustainedImprovementDays += 1
        if (sustainedImprovementDays >= 15) {
          if      (structuralState === 'STRUCTURAL_CRASH')  structuralState = 'STRUCTURAL_STRESS'
          else if (structuralState === 'STRUCTURAL_STRESS') structuralState = 'STRUCTURAL_WATCH'
          else if (structuralState === 'STRUCTURAL_WATCH')  structuralState = 'NONE'
          sustainedImprovementDays = 0
        }
      } else if (!structuralImproving && crashEpisodeStartDate === null) {
        sustainedImprovementDays = 0
      }

      // ── Log state transitions ──
      if (structuralState !== prevStructural) {
        dbg_structuralTransitions.push({
          date: point.date,
          from: prevStructural,
          to: structuralState,
          episode_day: crashEpisodeDays,
          macro_score: macroScore,
          internal_score: internalScore,
          persistence_score: persistenceScore,
          ai_assessment: aiAssessment,
          ath_dd_pct: Math.round(athDD * 1000) / 10,
          dd10_pct: Math.round(dd10 * 1000) / 10,
        })
      }
    }

    const evaluationValue = Number((shares * assetPrice).toFixed(2))
    const portfolioValue = Number((evaluationValue + poolCash).toFixed(2))
    const poolUsedPct = initialCapital > 0
      ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
      : 0
    // V-band: portfolio-based reference from cycle start
    const vrefEval = Number(cycleBasePortfolio.toFixed(2))
    const vminEval = Number((cycleBasePortfolio * 0.85).toFixed(2))
    const vmaxEval = Number((cycleBasePortfolio * 1.15).toFixed(2))
    const vrefLine = normalizeValue(cycleBasePortfolio, initialCapital)
    const vminLine = Number((vrefLine * 0.85).toFixed(2))
    const vmaxLine = Number((vrefLine * 1.15).toFixed(2))

    avgCostLine.push({ date: point.date, value: normalizeValue(avgCost, basePrice) })
    points.push({
      date: point.date,
      in_event: point.in_event,
      cycle_no: currentCycleNo,
      day_in_cycle: dayInCycle,
      asset_price: Number(assetPrice.toFixed(2)),
      evaluation_value_before_trade: Number((sharesBefore * assetPrice).toFixed(2)),
      evaluation_value: evaluationValue,
      evaluation_normalized: normalizeValue(evaluationValue, initialCapital),
      tqqq_price_normalized: normalizeValue(assetPrice, basePrice),
      portfolio_value_before_trade: Number((sharesBefore * assetPrice + poolCashBefore).toFixed(2)),
      portfolio_value: portfolioValue,
      portfolio_normalized: normalizeValue(portfolioValue, initialCapital),
      vref_eval: vrefEval,
      vmin_eval: vminEval,
      vmax_eval: vmaxEval,
      vref_line: vrefLine,
      vmin_line: vminLine,
      vmax_line: vmaxLine,
      vref_price: shares > 0 ? Number((vrefEval / shares).toFixed(2)) : null,
      vmin_price: shares > 0 ? Number((vminEval / shares).toFixed(2)) : null,
      vmax_price: shares > 0 ? Number((vmaxEval / shares).toFixed(2)) : null,
      avg_cost_after_trade: Number(avgCost.toFixed(2)),
      avg_cost_normalized: normalizeValue(avgCost, basePrice),
      shares_before_trade: sharesBefore,
      shares_after_trade: shares,
      pool_cash_before_trade: Number(poolCashBefore.toFixed(2)),
      pool_cash_after_trade: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: poolUsedPct,
      cycle_pool_cap_pct: capOption.pct,
      cumulative_pool_spent: cumulativePoolSpent,
      buy_blocked_by_cycle_cap: false,
      false_bottom_risk_level: currentFalseBottomRiskLevel,
      buy_delay_flag: currentBuyDelayFlag,
      delay_strength: currentDelayStrength,
      reset_ready_flag: currentResetReadyFlag,
      reset_confidence: currentResetConfidence,
      reset_reason: currentResetReason,
      fast_snapback_flag: currentFastSnapbackFlag,
      override_strength: currentOverrideStrength,
      override_reason: currentOverrideReason,
      snapback_candidate_flag: currentSnapbackCandidateFlag,
      low_reentry_flag: currentLowReentryFlag,
      first_buy_override_used: firstBuyOverrideUsed,
      override_triggered: currentOverrideTriggered,
      trade_reason: tradeReason,
      state_after_trade: stateAfterTrade,
      structural_state: structuralState,
      ...buildExplainablePointDefaults(),
    })

    tradeLog.push({
      replay_date: point.date,
      cycle_no: currentCycleNo,
      state_before: stateBefore,
      buy_signal: buySignal,
      sell_signal: sellSignal,
      defense_signal: defenseSignal,
      trade_executed: tradeExecuted,
      trade_type: tradeType,
      trigger_source: triggerSource,
      ladder_level_hit: ladderLevelHit,
      trade_price: tradePrice,
      stock_evaluation_value: Number((sharesBefore * assetPrice).toFixed(2)),
      vref_eval: 0,
      vmax_eval: 0,
      sell_gate_open: false,
      shares_before: sharesBefore,
      shares_after: shares,
      avg_cost_before: Number(avgCostBefore.toFixed(2)),
      avg_cost_after: Number(avgCost.toFixed(2)),
      pool_cash_before: Number(poolCashBefore.toFixed(2)),
      pool_cash_after: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: poolUsedPct,
      blocked_by_cap: false,
      false_bottom_risk_level: currentFalseBottomRiskLevel,
      buy_delay_flag: currentBuyDelayFlag,
      delay_strength: currentDelayStrength,
      reset_ready_flag: currentResetReadyFlag,
      reset_confidence: currentResetConfidence,
      reset_reason: currentResetReason,
      fast_snapback_flag: currentFastSnapbackFlag,
      override_strength: currentOverrideStrength,
      override_reason: currentOverrideReason,
      snapback_candidate_flag: currentSnapbackCandidateFlag,
      low_reentry_flag: currentLowReentryFlag,
      first_buy_override_used: firstBuyOverrideUsed,
      override_triggered: currentOverrideTriggered,
      state_after: stateAfterTrade,
    })
    if (
      guardReleaseProfile === 'phase5' &&
      fastSnapbackFirstBuyPriorityArmed &&
      !fastSnapbackPriorityArmedThisBar
    ) {
      fastSnapbackPriorityBarsRemaining -= 1
      if (fastSnapbackPriorityBarsRemaining <= 0) {
        fastSnapbackFirstBuyPriorityArmed = false
        fastSnapbackPriorityBarsRemaining = 0
      }
    }
    previousState = stateAfterTrade
  })

  // ── vFinal ARMED debug log ──
  const avgArmedDays = dbg_armedExitCount > 0
    ? Number((dbg_armedDaysAccum / dbg_armedExitCount).toFixed(1))
    : dbg_armedDaysAccum
  const poolUsedPct = initialCapital > 0
    ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(1))
    : 0
  console.log(
    '[vFinal ARMED]',
    'event:', event.name,
    '| armedEnterCount:', dbg_armedEnterCount,
    '| cancel_by_recovery:', dbg_cancelByRecovery,
    '| cancel_by_timeout:', dbg_cancelByTimeout,
    '| ma250RetestWhileArmedCount:', dbg_ma250RetestWhileArmed,
    '| sellExecutionCount:', executedSellCount,
    '| buyExecutionCount:', executedBuyCount,
    '| avgArmedDays:', avgArmedDays,
    '| poolUsed%:', poolUsedPct,
    '| normalVminBuys:', dbg_normalVminBuys.length,
    '| crashTriggerDates:', dbg_crashTriggerDates,
    '| normalVminBuyDates:', dbg_normalVminBuys,
    '| structuralTransitions:', dbg_structuralTransitions,
  )

  return {
    engine_id: 'vfinal',
    engine_label: 'Scenario VR (vFinal)',
    cap_option: capOption.key,
    cap_label: capOption.label,
    sell_policy: { vmax_visual_only: false, sell_only_on_defense: false, allow_first_cycle_sell: true },
    points,
    buy_markers: buyMarkers,
    sell_markers: sellMarkers,
    defense_markers: defenseMarkers,
    avg_cost_line: avgCostLine,
    pool_cap_flags: poolCapFlags,
    vmin_recovery_attempt_zones: [],
    failed_recovery_zones: [],
    scenario_phase_zones: [],
    pool_usage_summary: {
      initial_pool_cash: initialCapital,
      cycle_pool_cap_pct: capOption.pct,
      cycle_pool_used_pct: initialCapital > 0
        ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
        : 0,
      active_cycle_pool_used_pct: 0,
      pool_cash_remaining: points[points.length - 1]?.pool_cash_after_trade ?? 0,
      cumulative_pool_spent: cumulativePoolSpent,
      blocked_buy_count: 0,
      deferred_buy_count: deferredBuyCount,
      false_bottom_risk_level: currentFalseBottomRiskLevel,
      buy_delay_flag: currentBuyDelayFlag,
      delay_strength: currentDelayStrength,
      reset_ready_flag: currentResetReadyFlag,
      reset_confidence: currentResetConfidence,
      reset_reason: currentResetReason,
      fast_snapback_flag: currentFastSnapbackFlag,
      override_strength: currentOverrideStrength,
      override_reason: currentOverrideReason,
      snapback_candidate_flag: currentSnapbackCandidateFlag,
      low_reentry_flag: currentLowReentryFlag,
      first_buy_override_used: firstBuyOverrideUsed,
      override_triggered: currentOverrideTriggered,
      guard_partial_buy_count: guardPartialBuyCount,
      guard_delayed_buy_count: guardDelayedBuyCount,
      guard_blocked_buy_count: guardBlockedBuyCount,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: 0,
      active_cycle_no: activeCycleNo,
      active_cycle_blocked_buy_count: 0,
      last_trade_date: lastTradeDate,
    },
    trade_log: tradeLog,
    validation_summary: {
      has_buy_execution: executedBuyCount > 0,
      has_sell_execution: executedSellCount > 0,
      has_defense_execution: false,
      avg_cost_changed: tradeLog.some((item) => item.avg_cost_after !== item.avg_cost_before),
      shares_changed: tradeLog.some((item) => item.shares_after !== item.shares_before),
      pool_cash_changed: tradeLog.some((item) => item.pool_cash_after !== item.pool_cash_before),
      blocked_by_cap_observed: false,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: 0,
      blocked_buy_count: 0,
    },
    market_chart: marketChart,
    cycle_summaries: buildCycleExecutionSummaries({
      points,
      buy_markers: buyMarkers,
      sell_markers: sellMarkers,
      defense_markers: defenseMarkers,
      pool_cap_flags: poolCapFlags,
      initial_pool_cash: initialCapital,
      cycles: event.cycle_framework.cycles,
    }),
    focus_window: buildExecutionFocusWindow({ points, trade_log: tradeLog }),
  }
}

export function buildExecutionPlayback(
  event: ExecutionPlaybackSource,
  selectedCap: CyclePoolCapOption = '50',
  options: ExecutionPlaybackBuildOptions = {},
): ExecutionPlaybackCollection {
  const scenarioEngine: ScenarioEngine = options.scenarioEngine ?? 'vfinal'
  const originalVr = buildVariant(
    event,
    { key: 'unlimited', pct: null, label: 'Original VR (Playback)' },
    'original'
  )
  const capOption = CAP_OPTIONS.find((o) => o.key === selectedCap) ?? CAP_OPTIONS[2]
  const macroGating = options.enableMacroGating !== false  // default true
  const variant =
    scenarioEngine === 'explainable_vr_v1'
      ? buildVariantExplainableVRV1(event, capOption, macroGating)
      : scenarioEngine === 'vr_original_v2'
        ? buildVariantVrOriginalV2(event, capOption)
        : buildVariantVFinal(event, capOption, options)
  const comparison = buildComparisonView(originalVr, variant, scenarioEngine)
  // Build vr_original_v2 standalone (always available for comparison)
  const vrOriginalV2Vr = buildVariantVrOriginalV2(
    event,
    CAP_OPTIONS.find((o) => o.key === 'unlimited') ?? { key: 'unlimited', pct: null, label: 'Unlimited' },
  )

  return {
    default_cap_option: selectedCap,
    original_vr: originalVr,
    vr_original_v2_vr: vrOriginalV2Vr,
    variants: { [selectedCap]: variant },
    comparison_by_cap: { [selectedCap]: comparison },
  }
}

/** Lazily build a single cap variant + comparison (for client-side on-demand compute). */
export function buildVariantForCap(
  event: ExecutionPlaybackSource,
  cap: CyclePoolCapOption,
  options: ExecutionPlaybackBuildOptions = {},
): { variant: ExecutionPlaybackVariant; comparison: VRComparisonView } {
  const scenarioEngine: ScenarioEngine = options.scenarioEngine ?? 'vfinal'
  const originalVr = buildVariant(event, { key: 'unlimited', pct: null, label: 'Original VR (Playback)' }, 'original')
  const capOption = CAP_OPTIONS.find((o) => o.key === cap) ?? CAP_OPTIONS[2]
  const macroGating = options.enableMacroGating !== false  // default true
  const variant =
    scenarioEngine === 'explainable_vr_v1'
      ? buildVariantExplainableVRV1(event, capOption, macroGating)
      : scenarioEngine === 'vr_original_v2'
        ? buildVariantVrOriginalV2(event, capOption)
        : buildVariantVFinal(event, capOption, options)
  return { variant, comparison: buildComparisonView(originalVr, variant, scenarioEngine) }
}

function summarizeVariant(variant: ExecutionPlaybackVariant): VRExecutionSummary {
  const eventLowPoint = variant.points
    .filter((point) => point.in_event)
    .reduce((lowest, point) => {
      if (!lowest || point.asset_price < lowest.asset_price) return point
      return lowest
    }, null as ExecutionPoint | null)

  const lowestPoolRemaining = variant.points.reduce((min, point) => Math.min(min, point.pool_cash_after_trade), Number.POSITIVE_INFINITY)

  return {
    buy_count: variant.buy_markers.length,
    sell_count: variant.sell_markers.length,
    defense_count: variant.defense_markers.length,
    buy_pause_count: variant.pool_cap_flags.length,
    total_pool_spent: variant.pool_usage_summary.cumulative_pool_spent,
    lowest_pool_remaining: Number.isFinite(lowestPoolRemaining) ? Number(lowestPoolRemaining.toFixed(2)) : 0,
    avg_cost_at_event_low: eventLowPoint ? Number(eventLowPoint.avg_cost_after_trade.toFixed(2)) : null,
    final_evaluation_value: Number((variant.points[variant.points.length - 1]?.evaluation_value ?? 0).toFixed(2)),
    final_portfolio_value: Number((variant.points[variant.points.length - 1]?.portfolio_value ?? 0).toFixed(2)),
    final_unrealized_pl: Number(
      (((variant.points[variant.points.length - 1]?.portfolio_value ?? 0) - (variant.points[0]?.portfolio_value ?? 0)).toFixed(2))
    ),
    final_pool_cash_remaining: Number((variant.points[variant.points.length - 1]?.pool_cash_after_trade ?? 0).toFixed(2)),
    final_pool_used_pct:
      variant.pool_usage_summary.initial_pool_cash > 0
        ? Number(
            ((variant.pool_usage_summary.cumulative_pool_spent / variant.pool_usage_summary.initial_pool_cash) * 100).toFixed(2)
          )
        : 0,
  }
}

function formatDelta(delta: number, suffix = '') {
  const rounded = Number(delta.toFixed(2))
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}${suffix}`
}

export function buildComparisonView(
  originalVr: ExecutionPlaybackVariant,
  scenarioVr: ExecutionPlaybackVariant,
  scenarioEngine: ScenarioEngine = 'vfinal',
): VRComparisonView {
  const originalSummary = summarizeVariant(originalVr)
  const scenarioSummary = summarizeVariant(scenarioVr)

  const originalMap = new Map(originalVr.points.map((point) => [point.date, point]))
  const chartRows = scenarioVr.points.map((point) => {
    const originalPoint = originalMap.get(point.date) ?? originalVr.points[0]
    return {
      date: point.date,
      original_evaluation_value: originalPoint?.portfolio_value ?? 0,
      scenario_evaluation_value: point.portfolio_value,
      original_portfolio_value: originalPoint?.portfolio_value ?? 0,
      scenario_portfolio_value: point.portfolio_value,
      original_pool_remaining: originalPoint?.pool_cash_after_trade ?? 0,
      scenario_pool_remaining: point.pool_cash_after_trade,
    }
  })

  const behaviorRows = [
    {
      label: 'Buy Logic',
      original_value: 'Mechanical cycle-grid deployment',
      scenario_value: 'vFinal: ATH-based Vmin ladder (−40/−50/−60%) + MA200 full re-entry',
    },
    {
      label: 'Sell Logic',
      original_value: 'Representative sell ladder (not active in current test)',
      scenario_value: 'vFinal: 100% sell at MA250 on crash trigger (DD5≤−10% AND DD10≤−18%)',
    },
    {
      label: 'Crash Response',
      original_value: 'No explicit crash detection or exit',
      scenario_value: 'vFinal: immediate exit on MA250 retest; ARMED wait up to 60 days if below MA250',
    },
    {
      label: 'Re-entry Logic',
      original_value: 'Cycle-grid re-enters incrementally',
      scenario_value: 'vFinal: 20% each at ATH×0.60/0.50/0.40, then remaining cash at MA200 cross',
    },
    {
      label: 'Pool Usage',
      original_value: 'Deploys throughout cycle at grid levels',
      scenario_value: 'vFinal: holds 100% cash until ATH-fraction price targets or MA200 recovery',
    },
    {
      label: 'Objective',
      original_value: 'Cost-basis improvement via cycle-grid',
      scenario_value: 'Crash survival: full exit on signal, staged ATH-based re-entry, MA200 mop-up',
    },
    {
      label: 'Avg Cost Behavior',
      original_value: 'Gradually improves through grid buys',
      scenario_value: 'vFinal: resets to 0 on crash exit, rebuilds from deep Vmin levels',
    },
  ]
  const explainableStateCounts = scenarioVr.points.reduce<Record<ExplainableVRState, number>>(
    (acc, point) => {
      if (point.explainable_state) acc[point.explainable_state] += 1
      return acc
    },
    {
      NORMAL: 0,
      WARNING: 0,
      RISK_OFF: 0,
      BOTTOM_WATCH: 0,
      RE_ENTRY: 0,
    },
  )
  const explainableStateMix = Object.entries(explainableStateCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([state, count]) => `${state} ${count}d`)
    .join(', ')
  const behaviorRowsResolved =
    scenarioEngine === 'explainable_vr_v1'
      ? [
          {
            label: 'Buy Logic',
            original_value: 'Mechanical cycle-grid deployment',
            scenario_value: 'State-based: NORMAL keeps Vmin buys, WARNING reduces size, and RE_ENTRY allows partial buys only',
          },
          {
            label: 'Sell Logic',
            original_value: 'Representative sell ladder (not active in current test)',
            scenario_value: 'RISK_OFF cuts exposure toward a deterministic target when downside energy stays high below MA200',
          },
          {
            label: 'Crash Response',
            original_value: 'No explicit crash detection or exit',
            scenario_value: 'State machine: NORMAL to WARNING to RISK_OFF to BOTTOM_WATCH to RE_ENTRY',
          },
          {
            label: 'Re-entry Logic',
            original_value: 'Cycle-grid re-enters incrementally',
            scenario_value: 'BOTTOM_WATCH blocks buys; RE_ENTRY restores risk through one partial deployment of 50% of remaining pool',
          },
          {
            label: 'Pool Usage',
            original_value: 'Deploys throughout cycle at grid levels',
            scenario_value: 'Pool is preserved through RISK_OFF and BOTTOM_WATCH, then redeployed only after recovery quality improves',
          },
          {
            label: 'Objective',
            original_value: 'Cost-basis improvement via cycle-grid',
            scenario_value: 'Explainable survival: downside energy, structure break, and recovery quality drive the state machine',
          },
          {
            label: 'State Mix',
            original_value: 'N/A',
            scenario_value: explainableStateMix || 'NORMAL only',
          },
        ]
      : behaviorRows

  const defenseDelta = scenarioSummary.defense_count - originalSummary.defense_count
  const metricCards = [
    {
      label: 'Stock Evaluation Value',
      original_value: originalSummary.final_evaluation_value.toFixed(2),
      scenario_value: scenarioSummary.final_evaluation_value.toFixed(2),
      difference: formatDelta(scenarioSummary.final_evaluation_value - originalSummary.final_evaluation_value),
    },
    {
      label: 'Total Portfolio Value',
      original_value: originalSummary.final_portfolio_value.toFixed(2),
      scenario_value: scenarioSummary.final_portfolio_value.toFixed(2),
      difference: formatDelta(scenarioSummary.final_portfolio_value - originalSummary.final_portfolio_value),
    },
    {
      label: 'Unrealized P/L',
      original_value: originalSummary.final_unrealized_pl.toFixed(2),
      scenario_value: scenarioSummary.final_unrealized_pl.toFixed(2),
      difference: formatDelta(scenarioSummary.final_unrealized_pl - originalSummary.final_unrealized_pl),
    },
    {
      label: 'Pool Cash Remaining',
      original_value: originalSummary.final_pool_cash_remaining.toFixed(2),
      scenario_value: scenarioSummary.final_pool_cash_remaining.toFixed(2),
      difference: formatDelta(scenarioSummary.final_pool_cash_remaining - originalSummary.final_pool_cash_remaining),
    },
    {
      label: 'Pool Used %',
      original_value: `${originalSummary.final_pool_used_pct.toFixed(1)}%`,
      scenario_value: `${scenarioSummary.final_pool_used_pct.toFixed(1)}%`,
      difference: formatDelta(scenarioSummary.final_pool_used_pct - originalSummary.final_pool_used_pct, ' pts'),
    },
    {
      label: 'Buy Count',
      original_value: `${originalSummary.buy_count}`,
      scenario_value: `${scenarioSummary.buy_count}`,
      difference: formatDelta(scenarioSummary.buy_count - originalSummary.buy_count),
    },
    {
      label: 'Defense Activations',
      original_value: `${originalSummary.defense_count}`,
      scenario_value: `${scenarioSummary.defense_count}`,
      difference: formatDelta(defenseDelta),
    },
  ]

  return {
    chart_rows: chartRows,
    original_summary: originalSummary,
    scenario_summary: scenarioSummary,
    metric_cards: metricCards,
    behavior_rows: behaviorRowsResolved,
    interpretation: {
      headline:
        scenarioSummary.sell_count > 0
          ? 'Scenario VR (vFinal) executed a crash exit and staged re-entry via ATH-based Vmin ladder.'
          : 'Scenario VR (vFinal) held position — no crash trigger fired during this replay.',
      subline:
        scenarioSummary.sell_count > 0
          ? 'vFinal exits 100% at MA250 on DD5/DD10 crash signal, then re-enters at ATH×0.60/0.50/0.40 and MA200 recovery.'
          : 'Original VR (Playback) uses mechanical cycle-grid deployment; vFinal waits for crash trigger before deploying crash-survival logic.',
    },
  }
}

export function runExecutionPlaybackExamples(
  events: Array<ExecutionPlaybackSource & { event_id?: string }>
) {
  const event = events.find((item) => item.event_id === '2020-02') ?? events[0]
  const playback = event ? buildExecutionPlayback(event) : null
  return {
    passed:
      Boolean(playback) &&
      Object.values(playback?.variants ?? {}).every((variant) => Array.isArray(variant.points)) &&
      (playback?.variants['50']?.pool_usage_summary.cycle_pool_cap_pct ?? null) === 50,
    default_cap_option: playback?.default_cap_option ?? null,
    point_count: playback?.variants['50']?.points.length ?? 0,
  }
}
