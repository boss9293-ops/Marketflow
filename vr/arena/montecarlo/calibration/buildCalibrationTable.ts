import { buildCurrentMarketFeatureVector } from '../overlay/buildFeatureVector'
import { computeMonteCarloOverlay } from '../overlay/computeMonteCarloOverlay'
import { findSimilarMonteCarloPaths } from '../overlay/findSimilarMcPaths'
import { extractWarningTrace } from '../extractWarningTrace'

import type {
  MonteCarloCalibrationEntry,
  MonteCarloCalibrationTable,
  MonteCarloInterpretationState,
  MonteCarloScenarioFingerprint,
} from '../types'

import { DEFAULT_CALIBRATION_PRIORS } from './computeTrustScore'

const INTERPRETATION_STATES = Object.keys(
  DEFAULT_CALIBRATION_PRIORS
) as MonteCarloInterpretationState[]

type ForwardWindowMetrics = {
  forwardReturn5d: number
  forwardReturn10d: number
  forwardReturn20d: number
  forwardMaxDrawdown10d: number
  forwardMaxDrawdown20d: number
  forwardMaxRebound10d: number
  forwardMaxRebound20d: number
}

type CalibrationAccumulator = {
  sampleCount: number
  successCount: number
  forwardReturn5d: number[]
  forwardReturn10d: number[]
  forwardReturn20d: number[]
  forwardMaxDrawdown20d: number[]
  forwardMaxRebound20d: number[]
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits))
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint]
}

function buildAccumulator(): CalibrationAccumulator {
  return {
    sampleCount: 0,
    successCount: 0,
    forwardReturn5d: [],
    forwardReturn10d: [],
    forwardReturn20d: [],
    forwardMaxDrawdown20d: [],
    forwardMaxRebound20d: [],
  }
}

function computeForwardMetrics(prices: number[], startIndex: number): ForwardWindowMetrics | null {
  const currentPrice = prices[startIndex]
  if (!(currentPrice > 0)) return null

  const slice = (days: number) =>
    prices.slice(startIndex + 1, Math.min(prices.length, startIndex + days + 1))
  const window5 = slice(5)
  const window10 = slice(10)
  const window20 = slice(20)
  if (!window20.length) return null

  const priceAt = (days: number) => prices[Math.min(prices.length - 1, startIndex + days)] ?? currentPrice
  const toReturnPct = (price: number) => ((price / currentPrice) - 1) * 100
  const toDrawdownPct = (window: number[]) => {
    if (!window.length) return 0
    return ((Math.min(...window) / currentPrice) - 1) * 100
  }
  const toReboundPct = (window: number[]) => {
    if (!window.length) return 0
    return ((Math.max(...window) / currentPrice) - 1) * 100
  }

  return {
    forwardReturn5d: round(toReturnPct(priceAt(5)), 2),
    forwardReturn10d: round(toReturnPct(priceAt(10)), 2),
    forwardReturn20d: round(toReturnPct(priceAt(20)), 2),
    forwardMaxDrawdown10d: round(toDrawdownPct(window10), 2),
    forwardMaxDrawdown20d: round(toDrawdownPct(window20), 2),
    forwardMaxRebound10d: round(toReboundPct(window10), 2),
    forwardMaxRebound20d: round(toReboundPct(window20), 2),
  }
}

function isSuccessfulInterpretation(
  interpretationState: MonteCarloInterpretationState,
  metrics: ForwardWindowMetrics
) {
  switch (interpretationState) {
    case 'STRONG_BEAR_CONFIRMATION':
      return metrics.forwardMaxDrawdown10d <= -8 || metrics.forwardMaxDrawdown20d <= -10
    case 'WEAK_BEAR':
      return metrics.forwardMaxDrawdown10d <= -4 || metrics.forwardMaxDrawdown20d <= -6
    case 'FALSE_RECOVERY_RISK':
      return (
        (metrics.forwardReturn20d <= -3 && metrics.forwardMaxDrawdown20d <= -4) ||
        (metrics.forwardMaxRebound10d < 6 && metrics.forwardMaxDrawdown20d <= -4)
      )
    case 'EARLY_RECOVERY':
      return (
        (metrics.forwardReturn10d >= 6 || metrics.forwardReturn20d >= 8) &&
        metrics.forwardMaxDrawdown10d > -8
      )
    case 'MIXED':
      return Math.abs(metrics.forwardReturn20d) <= 8 && metrics.forwardMaxDrawdown20d > -10
    case 'HIGH_UNCERTAINTY':
      return Math.abs(metrics.forwardReturn20d) <= 6 && metrics.forwardMaxDrawdown20d > -8
  }
}

function finalizeCalibrationEntry(
  interpretationState: MonteCarloInterpretationState,
  accumulator: CalibrationAccumulator
): MonteCarloCalibrationEntry {
  const prior = DEFAULT_CALIBRATION_PRIORS[interpretationState]
  const rawReliability =
    accumulator.sampleCount > 0 ? accumulator.successCount / accumulator.sampleCount : prior
  const sampleWeight = Math.min(1, accumulator.sampleCount / 40)
  let calibratedReliability = prior * (1 - sampleWeight) + rawReliability * sampleWeight

  if (interpretationState === 'MIXED') {
    calibratedReliability = Math.min(calibratedReliability, 0.45)
  }
  if (interpretationState === 'HIGH_UNCERTAINTY') {
    calibratedReliability = Math.min(calibratedReliability, 0.3)
  }

  return {
    interpretationState,
    sampleCount: accumulator.sampleCount,
    successCount: accumulator.successCount,
    rawReliability: round(rawReliability),
    calibratedReliability: round(calibratedReliability),
    medianForwardReturn5d:
      accumulator.forwardReturn5d.length > 0 ? round(median(accumulator.forwardReturn5d) ?? 0, 2) : null,
    medianForwardReturn10d:
      accumulator.forwardReturn10d.length > 0 ? round(median(accumulator.forwardReturn10d) ?? 0, 2) : null,
    medianForwardReturn20d:
      accumulator.forwardReturn20d.length > 0 ? round(median(accumulator.forwardReturn20d) ?? 0, 2) : null,
    medianForwardMaxDrawdown20d:
      accumulator.forwardMaxDrawdown20d.length > 0
        ? round(median(accumulator.forwardMaxDrawdown20d) ?? 0, 2)
        : null,
    medianForwardRebound20d:
      accumulator.forwardMaxRebound20d.length > 0
        ? round(median(accumulator.forwardMaxRebound20d) ?? 0, 2)
        : null,
  }
}

export function buildCalibrationTable(args: {
  historicalPrices: number[]
  library: MonteCarloScenarioFingerprint[]
  topK?: number
}): MonteCarloCalibrationTable | null {
  if (!args.historicalPrices.length || !args.library.length) return null

  const trace = extractWarningTrace({
    pathId: 'historical-calibration',
    prices: args.historicalPrices,
  })
  const accumulators = new Map<MonteCarloInterpretationState, CalibrationAccumulator>(
    INTERPRETATION_STATES.map((state) => [state, buildAccumulator()])
  )

  for (const point of trace) {
    if (point.dayIndex >= args.historicalPrices.length - 20) continue

    const current = buildCurrentMarketFeatureVector({
      dd3: point.dd3,
      dd5: point.dd5,
      dd6: point.dd6,
      peakDD: point.peakDD,
      reboundFromLow: point.reboundFromLow,
      ma200Gap: point.ma200Gap,
      warningState: point.warningState,
      scenarioHint: point.scenarioHint ?? 'Mixed',
    })
    const similarPaths = findSimilarMonteCarloPaths({
      current,
      library: args.library,
      topK: args.topK ?? 25,
    })
    if (!similarPaths.length) continue

    const overlay = computeMonteCarloOverlay({
      current,
      similarPaths,
      calibrationTable: null,
    })
    const forwardMetrics = computeForwardMetrics(args.historicalPrices, point.dayIndex)
    if (!forwardMetrics) continue

    const bucket = accumulators.get(overlay.mcInterpretationState)
    if (!bucket) continue

    bucket.sampleCount += 1
    if (isSuccessfulInterpretation(overlay.mcInterpretationState, forwardMetrics)) {
      bucket.successCount += 1
    }
    bucket.forwardReturn5d.push(forwardMetrics.forwardReturn5d)
    bucket.forwardReturn10d.push(forwardMetrics.forwardReturn10d)
    bucket.forwardReturn20d.push(forwardMetrics.forwardReturn20d)
    bucket.forwardMaxDrawdown20d.push(forwardMetrics.forwardMaxDrawdown20d)
    bucket.forwardMaxRebound20d.push(forwardMetrics.forwardMaxRebound20d)
  }

  return INTERPRETATION_STATES.reduce<MonteCarloCalibrationTable>((table, state) => {
    table[state] = finalizeCalibrationEntry(state, accumulators.get(state) ?? buildAccumulator())
    return table
  }, {} as MonteCarloCalibrationTable)
}
