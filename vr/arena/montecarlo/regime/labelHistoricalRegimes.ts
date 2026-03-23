import type { RegimeLabelPoint, RegimeState } from './types'

function rollingMean(values: number[], window: number) {
  const result: Array<number | null> = []
  let runningSum = 0

  for (let index = 0; index < values.length; index += 1) {
    runningSum += values[index]
    if (index >= window) {
      runningSum -= values[index - window]
    }
    result.push(index >= window - 1 ? runningSum / window : null)
  }

  return result
}

function rollingStd(values: number[], window: number) {
  const result: Array<number | null> = []

  for (let index = 0; index < values.length; index += 1) {
    if (index < window - 1) {
      result.push(null)
      continue
    }
    const slice = values.slice(index - window + 1, index + 1)
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length
    const variance =
      slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / slice.length
    result.push(Math.sqrt(variance))
  }

  return result
}

function classifyRegimeState(args: {
  dd3: number | null
  dd5: number | null
  dd6: number | null
  peakDD: number | null
  reboundFromLow: number | null
  ma200Gap: number | null
  realizedVol10d: number | null
  cycleActive: boolean
}): RegimeState {
  const panicSignal =
    (args.dd3 != null && args.dd3 <= -0.1) ||
    (args.dd5 != null && args.dd5 <= -0.15) ||
    (args.dd6 != null && args.dd6 <= -0.17) ||
    (args.peakDD != null &&
      args.peakDD <= -0.24 &&
      args.realizedVol10d != null &&
      args.realizedVol10d >= 0.04)

  if (panicSignal) {
    return 'PANIC'
  }

  const recoverySignal =
    args.cycleActive &&
    args.reboundFromLow != null &&
    args.reboundFromLow >= 0.1 &&
    (args.dd3 == null || args.dd3 > -0.02) &&
    (args.dd5 == null || args.dd5 > -0.04)

  if (recoverySignal) {
    return 'RECOVERY'
  }

  const bottomingSignal =
    args.cycleActive &&
    args.peakDD != null &&
    args.peakDD <= -0.2 &&
    (
      (args.reboundFromLow != null && args.reboundFromLow < 0.1) ||
      (args.dd3 != null && Math.abs(args.dd3) <= 0.05) ||
      (args.dd5 != null && Math.abs(args.dd5) <= 0.08)
    )

  if (bottomingSignal) {
    return 'BOTTOMING'
  }

  const selloffSignal =
    (args.dd3 != null && args.dd3 <= -0.05) ||
    (args.dd5 != null && args.dd5 <= -0.08) ||
    (args.peakDD != null && args.peakDD <= -0.1) ||
    (args.ma200Gap != null && args.ma200Gap <= -0.04)

  if (selloffSignal) {
    return 'SELLOFF'
  }

  return 'NORMAL'
}

export function labelHistoricalRegimes(args: {
  prices: number[]
  ma200?: Array<number | null>
}): RegimeLabelPoint[] {
  if (args.prices.length < 2) {
    return args.prices.map((_, index) => ({
      dayIndex: index,
      state: 'NORMAL',
      dd3: null,
      dd5: null,
      dd6: null,
      peakDD: null,
      reboundFromLow: null,
      ma200Gap: null,
    }))
  }

  const returns: number[] = []
  for (let index = 1; index < args.prices.length; index += 1) {
    const prev = args.prices[index - 1]
    const current = args.prices[index]
    returns.push(prev > 0 ? current / prev - 1 : 0)
  }

  const ma200 = args.ma200 ?? rollingMean(args.prices, 200)
  const realizedVol10d = rollingStd(returns, 10)
  const labels: RegimeLabelPoint[] = []
  let rollingPeak = args.prices[0]
  let cyclePeak: number | null = null
  let trackedLow: number | null = null
  let cycleActive = false

  labels.push({
    dayIndex: 0,
    state: 'NORMAL',
    dd3: null,
    dd5: null,
    dd6: null,
    peakDD: 0,
    reboundFromLow: null,
    ma200Gap:
      typeof ma200[0] === 'number' && ma200[0]! > 0 ? args.prices[0] / ma200[0]! - 1 : null,
  })

  for (let index = 1; index < args.prices.length; index += 1) {
    const price = args.prices[index]
    if (!cycleActive) {
      rollingPeak = Math.max(rollingPeak, price)
    }

    const dd3 = index >= 3 && args.prices[index - 3] > 0 ? price / args.prices[index - 3] - 1 : null
    const dd5 = index >= 5 && args.prices[index - 5] > 0 ? price / args.prices[index - 5] - 1 : null
    const dd6 = index >= 6 && args.prices[index - 6] > 0 ? price / args.prices[index - 6] - 1 : null
    const peakDD = rollingPeak > 0 ? price / rollingPeak - 1 : null
    const ma200Gap =
      typeof ma200[index] === 'number' && ma200[index]! > 0 ? price / ma200[index]! - 1 : null

    if (!cycleActive && peakDD != null && peakDD <= -0.15) {
      cycleActive = true
      cyclePeak = rollingPeak
      trackedLow = price
    }

    if (cycleActive) {
      trackedLow = trackedLow == null ? price : Math.min(trackedLow, price)
    }

    const reboundFromLow =
      cycleActive && trackedLow != null && trackedLow > 0 ? price / trackedLow - 1 : null

    const state = classifyRegimeState({
      dd3,
      dd5,
      dd6,
      peakDD,
      reboundFromLow,
      ma200Gap,
      realizedVol10d: realizedVol10d[index - 1] ?? null,
      cycleActive,
    })

    labels.push({
      dayIndex: index,
      state,
      dd3,
      dd5,
      dd6,
      peakDD,
      reboundFromLow,
      ma200Gap,
    })

    if (cycleActive && cyclePeak != null && price >= cyclePeak * 0.95) {
      cycleActive = false
      cyclePeak = null
      trackedLow = null
      rollingPeak = price
    }
  }

  return labels
}
