import type { MarketState, MA200Relation, PriceBar, PriceStructure, ReboundBehavior, TrendPersistence, VolBar, VolatilityRegime } from '../types/market_state'
import type { MarketState as DetectorMarketState } from '../../engine/pattern_detector'

export const MARKET_STATE_CONFIG = {
  drawdownLookback: 252,
  ma200TestThreshold: 0.03,
  sustainedBelowSessions: 10,
  volatilityBuckets: {
    low: 0.14,
    moderate: 0.24,
    elevated: 0.4,
  },
  reboundThresholds: {
    weak: 0.04,
    mixed: 0.09,
    strong: 0.15,
  },
  verticalDropThreshold: -0.12,
  slowBleedDuration: 25,
  rangeBandThreshold: 0.08,
} as const

function assertSeries(series: PriceBar[], label: string) {
  if (!Array.isArray(series) || !series.length) {
    throw new Error(`${label} series is empty`)
  }
  const invalid = series.some((row) => typeof row.date !== 'string' || typeof row.close !== 'number' || !Number.isFinite(row.close))
  if (invalid) {
    throw new Error(`${label} series contains invalid rows`)
  }
}

function pctChange(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return 0
  return (to - from) / from
}

function sampleStd(values: number[]) {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function rollingWindow(series: PriceBar[], size: number) {
  return series.slice(-Math.min(size, series.length))
}

function computeDrawdown(series: PriceBar[]) {
  const lookback = rollingWindow(series, MARKET_STATE_CONFIG.drawdownLookback)
  const peak = Math.max(...lookback.map((row) => row.close))
  const last = lookback[lookback.length - 1].close
  return peak > 0 ? Number(((last - peak) / peak).toFixed(4)) : 0
}

function computeDurationDays(series: PriceBar[]) {
  const lookback = rollingWindow(series, MARKET_STATE_CONFIG.drawdownLookback)
  let peakIndex = 0
  let peak = -Infinity
  lookback.forEach((row, index) => {
    if (row.close >= peak) {
      peak = row.close
      peakIndex = index
    }
  })
  return Math.max(0, lookback.length - peakIndex - 1)
}

function computeMA200Relation(series: PriceBar[]): MA200Relation {
  const last = series[series.length - 1]
  if (typeof last.sma200 !== 'number' || !Number.isFinite(last.sma200) || last.sma200 <= 0) {
    return 'above'
  }

  const gap = (last.close - last.sma200) / last.sma200
  const trailing = rollingWindow(series, Math.max(MARKET_STATE_CONFIG.sustainedBelowSessions, 20))
  const belowCount = trailing.filter((row) => typeof row.sma200 === 'number' && row.close < row.sma200).length

  if (belowCount >= MARKET_STATE_CONFIG.sustainedBelowSessions && gap < -MARKET_STATE_CONFIG.ma200TestThreshold) {
    return 'sustained_below'
  }
  if (gap < 0) {
    return 'breach'
  }
  if (Math.abs(gap) <= MARKET_STATE_CONFIG.ma200TestThreshold) {
    return 'test'
  }
  return 'above'
}

function computeVolatilityRegime(series: PriceBar[], volSeries?: VolBar[]): VolatilityRegime {
  const lookback = rollingWindow(series, 30)
  const returns = lookback.slice(1).map((row, index) => pctChange(lookback[index].close, row.close))
  const realizedVol = sampleStd(returns) * Math.sqrt(252)
  const lastVol = volSeries?.[volSeries.length - 1]?.value ?? null

  if (realizedVol >= MARKET_STATE_CONFIG.volatilityBuckets.elevated || (typeof lastVol === 'number' && lastVol >= 35)) {
    return 'extreme'
  }
  if (realizedVol >= MARKET_STATE_CONFIG.volatilityBuckets.moderate || (typeof lastVol === 'number' && lastVol >= 24)) {
    return 'elevated'
  }
  if (realizedVol >= MARKET_STATE_CONFIG.volatilityBuckets.low || (typeof lastVol === 'number' && lastVol >= 16)) {
    return 'moderate'
  }
  return 'low'
}

function computeReboundBehavior(series: PriceBar[]): ReboundBehavior {
  const lookback = rollingWindow(series, 40)
  let troughIndex = 0
  let trough = Infinity
  lookback.forEach((row, index) => {
    if (row.close <= trough) {
      trough = row.close
      troughIndex = index
    }
  })

  const postTrough = lookback.slice(troughIndex)
  if (postTrough.length < 3 || !Number.isFinite(trough) || trough <= 0) {
    return 'none'
  }

  const rebound = pctChange(trough, postTrough[postTrough.length - 1].close)
  const lastFiveMin = Math.min(...postTrough.slice(-5).map((row) => row.close))

  if (rebound > MARKET_STATE_CONFIG.reboundThresholds.weak && lastFiveMin <= trough * 1.01) {
    return 'failed'
  }
  if (rebound >= MARKET_STATE_CONFIG.reboundThresholds.strong) {
    return 'strong'
  }
  if (rebound >= MARKET_STATE_CONFIG.reboundThresholds.mixed) {
    return 'mixed'
  }
  if (rebound >= MARKET_STATE_CONFIG.reboundThresholds.weak) {
    return 'weak'
  }
  return 'none'
}

function computeTrendPersistence(series: PriceBar[]): TrendPersistence {
  const lookback = rollingWindow(series, 20)
  const highs = lookback.map((row) => row.close)
  const lowerSteps = highs.slice(1).filter((value, index) => value < highs[index]).length
  const peak = Math.max(...highs)
  const trough = Math.min(...highs)
  const tightRange = peak > 0 ? (peak - trough) / peak : 0

  if (lowerSteps >= 13) return 'persistent_down'
  if (tightRange <= 0.06) return 'persistent_range'
  if (lowerSteps >= 8) return 'weakening'
  return 'stable'
}

function computePriceStructure(
  series: PriceBar[],
  drawdown: number,
  durationDays: number,
  ma200Relation: MA200Relation,
  reboundBehavior: ReboundBehavior,
  trendPersistence: TrendPersistence
): PriceStructure {
  const lookback = rollingWindow(series, 20)
  const start = lookback[0].close
  const end = lookback[lookback.length - 1].close
  const move20 = pctChange(start, end)
  const peak = Math.max(...lookback.map((row) => row.close))
  const trough = Math.min(...lookback.map((row) => row.close))
  const band = peak > 0 ? (peak - trough) / peak : 0

  if (move20 <= MARKET_STATE_CONFIG.verticalDropThreshold || (drawdown <= -0.15 && durationDays <= 15)) {
    return 'vertical_drop'
  }
  if (durationDays >= MARKET_STATE_CONFIG.slowBleedDuration && drawdown <= -0.08 && trendPersistence === 'persistent_down') {
    return 'slow_bleed'
  }
  if (band <= 0.04 && Math.abs(move20) <= 0.02) {
    return 'sideways'
  }
  if (band >= MARKET_STATE_CONFIG.rangeBandThreshold && Math.abs(move20) <= 0.05) {
    return 'range_market'
  }
  if ((reboundBehavior === 'mixed' || reboundBehavior === 'strong') && ma200Relation !== 'above' && drawdown < 0) {
    return 'countertrend_rally'
  }
  if ((ma200Relation === 'breach' || ma200Relation === 'sustained_below') && reboundBehavior !== 'none') {
    return 'breakdown_retest'
  }
  return 'trend_down'
}

function computeEventDependency(
  drawdown: number,
  volatilityRegime: VolatilityRegime,
  priceStructure: PriceStructure,
  volSeries?: VolBar[]
): MarketState['event_dependency'] {
  const last = volSeries?.[volSeries.length - 1]?.value ?? null
  const prev = volSeries && volSeries.length >= 6 ? volSeries[volSeries.length - 6].value : null
  const volJump = typeof last === 'number' && typeof prev === 'number' && prev > 0 ? pctChange(prev, last) : 0

  if (priceStructure === 'vertical_drop' && volatilityRegime === 'extreme') {
    return 'liquidity_shock'
  }
  if (volJump >= 0.35 || (typeof last === 'number' && last >= 30)) {
    return 'volatility_spike'
  }
  if (drawdown <= -0.08 || volatilityRegime === 'elevated' || volatilityRegime === 'extreme') {
    return 'macro_uncertainty'
  }
  return 'none'
}

function validateMarketState(state: MarketState) {
  const numericFields = ['nasdaq_drawdown', 'tqqq_drawdown', 'duration_days'] as const
  for (const field of numericFields) {
    const value = state[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid MarketState field: ${field}`)
    }
  }
}

export async function generateMarketState(
  asOfDateOrOptions?: string | { asOfDate?: string; rootDir?: string }
): Promise<MarketState> {
  const { loadMarketSeries } = await import('./load_market_series')
  const options =
    typeof asOfDateOrOptions === 'string'
      ? { asOfDate: asOfDateOrOptions }
      : asOfDateOrOptions ?? {}
  const loaded = loadMarketSeries({
    asOfDate: options.asOfDate,
    rootDir: options.rootDir,
    historyDays: 320,
  })

  return generateMarketStateFromSeries({
    qqqSeries: loaded.qqq_series,
    tqqqSeries: loaded.tqqq_series,
    volSeries: loaded.vol_series,
    asOfDate: loaded.as_of_date,
  })
}

export async function generateMarketStateFromSeries(input: {
  qqqSeries: PriceBar[]
  tqqqSeries: PriceBar[]
  volSeries?: VolBar[]
  asOfDate?: string
}): Promise<MarketState> {
  assertSeries(input.qqqSeries, 'QQQ')
  assertSeries(input.tqqqSeries, 'TQQQ')

  const asOfDate = input.asOfDate ?? input.qqqSeries[input.qqqSeries.length - 1]?.date
  if (!asOfDate) {
    throw new Error('as_of_date is missing')
  }

  const nasdaqDrawdown = computeDrawdown(input.qqqSeries)
  const tqqqDrawdown = computeDrawdown(input.tqqqSeries)
  const durationDays = computeDurationDays(input.qqqSeries)
  const ma200Relation = computeMA200Relation(input.qqqSeries)
  const volatilityRegime = computeVolatilityRegime(input.qqqSeries, input.volSeries)
  const reboundBehavior = computeReboundBehavior(input.qqqSeries)
  const trendPersistence = computeTrendPersistence(input.qqqSeries)
  const priceStructure = computePriceStructure(
    input.qqqSeries,
    nasdaqDrawdown,
    durationDays,
    ma200Relation,
    reboundBehavior,
    trendPersistence
  )
  const eventDependency = computeEventDependency(nasdaqDrawdown, volatilityRegime, priceStructure, input.volSeries)

  const state: MarketState = {
    as_of_date: asOfDate,
    nasdaq_drawdown: nasdaqDrawdown,
    tqqq_drawdown: tqqqDrawdown,
    duration_days: durationDays,
    ma200_relation: ma200Relation,
    volatility_regime: volatilityRegime,
    price_structure: priceStructure,
    event_dependency: eventDependency,
    rebound_behavior: reboundBehavior,
    trend_persistence: trendPersistence,
  }

  validateMarketState(state)
  return state
}

export function toPatternDetectorInput(state: MarketState): DetectorMarketState {
  return {
    nasdaq_drawdown: state.nasdaq_drawdown,
    tqqq_drawdown: state.tqqq_drawdown,
    duration_days: state.duration_days,
    ma200_relation:
      state.ma200_relation === 'test'
        ? 'tested'
        : state.ma200_relation === 'sustained_below'
          ? 'below'
          : state.ma200_relation,
    volatility_regime:
      state.volatility_regime === 'low'
        ? 'low'
        : state.volatility_regime === 'moderate'
          ? 'moderate'
          : state.volatility_regime === 'elevated'
            ? 'elevated'
            : 'extreme',
    price_structure: state.price_structure,
    catalyst_type: state.event_dependency === 'none' ? undefined : state.event_dependency,
    rebound_behavior: state.rebound_behavior,
    trend_persistence:
      state.trend_persistence === 'persistent_down'
        ? 'down'
        : state.trend_persistence === 'persistent_range'
          ? 'sideways'
          : 'up',
  }
}
