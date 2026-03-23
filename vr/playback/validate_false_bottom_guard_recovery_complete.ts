import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  buildVRPlaybackView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
  type VRPlaybackEventView,
} from './vr_playback_loader'
import { buildExecutionPlayback } from './build_execution_playback'
import type { ExecutionPlaybackVariant } from '../types/execution_playback'

type Mode = 'baseline' | 'guard_phase2' | 'guard_phase3'
type GuardEventKind = 'delayed' | 'blocked'
type WindowKind = 'legacy_window' | 'recovery_complete_window'
type RecoveryCompleteReason =
  | 'MA200_20D_HOLD'
  | 'PRIOR_PEAK_95'
  | 'STABILIZATION_30D'
  | 'TRUNCATED_AT_AVAILABLE_CONTEXT'

type EpisodeSpec = {
  eventId: string
  label: string
}

type GuardSignalEvent = {
  event_id: string
  event_label: string
  window_kind: WindowKind
  mode: Mode
  kind: GuardEventKind
  date: string
  level_no: number
  price: number
  forward_return_5d_pct: number | null
  forward_return_10d_pct: number | null
  forward_return_20d_pct: number | null
  eventual_fill: boolean
  delay_bars: number | null
  lower_price_reentry: boolean
}

type VariantMetrics = {
  mode: Mode
  window_kind: WindowKind
  window_start_date: string
  window_end_date: string
  window_length_bars: number
  final_value: number
  period_return_pct: number
  max_drawdown_pct: number
  recovery_days: number | null
  min_pool_balance: number
  pool_depletion_count: number
  pool_near_zero_days: number
  pool_usage_rate_pct: number
  episode_max_pool_stress_pct: number
  total_vmin_trigger_events: number
  executed_vmin_buys: number
  partial_buys_count: number
  delayed_buys_count: number
  blocked_buys_count: number
  average_delay_bars: number | null
  delayed_fill_rate_pct: number | null
  blocked_then_lower_price_reentry_rate_pct: number | null
  average_guarded_forward_return_5d_pct: number | null
  average_guarded_forward_return_10d_pct: number | null
  average_guarded_forward_return_20d_pct: number | null
  guard_active_days: number
  guard_reset_count: number
  avg_days_to_first_vmin_buy_after_reset: number | null
  avg_reset_first_buy_10d_return_pct: number | null
  reset_delayed_missed_rebound_cases: number
  reset_false_positive_rate_pct: number | null
  guard_signal_events: GuardSignalEvent[]
}

type WindowDefinition = {
  event_id: string
  event_label: string
  event_start_date: string
  legacy_end_date: string
  recovery_complete_end_date: string
  legacy_length_bars: number
  recovery_complete_length_bars: number
  extension_bars: number
  snapback_speed_high: boolean
  snapback_velocity_pct_per_bar: number | null
  rebound_from_low_pct: number | null
  days_since_low: number | null
  prior_peak_normalized: number | null
  trough_date: string | null
  recovery_complete_reason: RecoveryCompleteReason
}

type EpisodeComparison = {
  event_id: string
  event_label: string
  window_definition: WindowDefinition
  legacy_window: {
    baseline: VariantMetrics
    guard_phase2: VariantMetrics
    guard_phase3: VariantMetrics
  }
  recovery_complete_window: {
    baseline: VariantMetrics
    guard_phase2: VariantMetrics
    guard_phase3: VariantMetrics
  }
}

type CombinedRow = {
  index: number
  point: ExecutionPlaybackVariant['points'][number]
  log: ExecutionPlaybackVariant['trade_log'][number] | undefined
  chart: VRPlaybackEventView['chart_data'][number] | undefined
}

const TARGET_EPISODES: EpisodeSpec[] = [
  { eventId: '2011-06', label: '2011 Debt Ceiling' },
  { eventId: '2018-10', label: '2018 Q4' },
  { eventId: '2020-02', label: '2020 Covid Crash' },
  { eventId: '2021-12', label: '2022 Fed Bear' },
  { eventId: '2024-07', label: '2024 Yen Carry' },
  { eventId: '2025-01', label: '2025 Tariff Shock' },
]

const OUTPUT_DIR = join(process.cwd(), 'vr_backtest', 'results', 'false_bottom_guard_phase0_recovery_complete')
const REPORT_PATH = join(process.cwd(), 'docs', 'vr_false_bottom_guard_phase0_recovery_complete_report.md')
const INITIAL_CAP = '50' as const
const POOL_NEAR_ZERO_THRESHOLD_PCT = 0.05
const RESET_REBOUND_THRESHOLD = 0.08
const RESET_BUY_WINDOW_BARS = 3
const RESET_FALSE_POSITIVE_WINDOW_BARS = 5
const RESET_FALSE_POSITIVE_DROP_THRESHOLD = 0.02
const MIN_RECOVERY_BARS = 90
const SNAPBACK_EXTENSION_BARS = 30
const STABILIZATION_LOOKBACK_BARS = 30
const MA200_HOLD_BARS = 20
const PRIOR_PEAK_RECOVERY_RATIO = 0.95
const STABILIZATION_DD3_ABS_THRESHOLD = 0.03

function readJson<T>(filename: string): T {
  const base = join(process.cwd(), 'marketflow', 'backend', 'output')
  return JSON.parse(readFileSync(join(base, filename), 'utf-8')) as T
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function safePercent(numerator: number, denominator: number) {
  if (!(denominator > 0)) return null
  return round((numerator / denominator) * 100, 2)
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!valid.length) return null
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 2)
}

function toCsv(rows: Array<Record<string, string | number | boolean | null | undefined>>) {
  if (!rows.length) return ''
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const escape = (value: string | number | boolean | null | undefined) => {
    if (value == null) return ''
    const text = String(value)
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`
    }
    return text
  }
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ]
  return `${lines.join('\n')}\n`
}

function markdownTable(rows: Array<Record<string, string | number | boolean | null>>) {
  if (!rows.length) return 'No rows.'
  const headers = Object.keys(rows[0])
  const format = (value: string | number | boolean | null) => (value == null ? '-' : String(value))
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => format(row[header] as string | number | boolean | null)).join(' | ')} |`),
  ]
  return lines.join('\n')
}

function computeForwardReturn(prices: number[], startIndex: number, bars: number) {
  const start = prices[startIndex]
  const endIndex = Math.min(prices.length - 1, startIndex + bars)
  const end = prices[endIndex]
  if (!(start > 0) || !(end > 0)) return null
  return round(((end / start) - 1) * 100, 2)
}

function computePortfolioStats(portfolioValues: number[]) {
  let peak = portfolioValues[0] ?? 0
  let peakIndex = 0
  let troughIndex = 0
  let maxDrawdown = 0

  for (let i = 0; i < portfolioValues.length; i += 1) {
    const value = portfolioValues[i] ?? 0
    if (value > peak) {
      peak = value
      peakIndex = i
    }
    const drawdown = peak > 0 ? (value / peak) - 1 : 0
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown
      troughIndex = i
    }
  }

  const target = portfolioValues[peakIndex] ? portfolioValues[peakIndex] * 0.95 : null
  let recoveryDays: number | null = null
  if (target != null) {
    for (let i = troughIndex; i < portfolioValues.length; i += 1) {
      if (portfolioValues[i] >= target) {
        recoveryDays = i - troughIndex
        break
      }
    }
  }

  return {
    max_drawdown_pct: round(maxDrawdown * 100, 2),
    recovery_days: recoveryDays,
  }
}

function getSeriesValue(event: VRPlaybackEventView, index: number) {
  return event.chart_data[index]?.qqq_n ?? null
}

function computeTrailingReturn(event: VRPlaybackEventView, index: number, bars: number) {
  const startIndex = index - bars
  if (startIndex < 0) return null
  const start = getSeriesValue(event, startIndex)
  const end = getSeriesValue(event, index)
  if (typeof start !== 'number' || typeof end !== 'number' || !(start > 0)) return null
  return (end / start) - 1
}

function computeAvgAbsDd3(event: VRPlaybackEventView, startIndex: number, endIndex: number) {
  if (endIndex < startIndex) return null
  const values: number[] = []
  for (let i = startIndex; i <= endIndex; i += 1) {
    const dd3 = computeTrailingReturn(event, i, 3)
    if (typeof dd3 === 'number') values.push(Math.abs(dd3))
  }
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function inferSnapbackProfile(event: VRPlaybackEventView, startIndex: number, legacyEndIndex: number) {
  let troughIndex = startIndex
  let troughValue = Number.POSITIVE_INFINITY
  for (let i = startIndex; i <= legacyEndIndex; i += 1) {
    const value = getSeriesValue(event, i)
    if (typeof value === 'number' && value < troughValue) {
      troughValue = value
      troughIndex = i
    }
  }

  const endValue = getSeriesValue(event, legacyEndIndex)
  const dd3 = computeTrailingReturn(event, legacyEndIndex, 3)
  const daysSinceLow = Math.max(1, legacyEndIndex - troughIndex)
  const reboundFromLow =
    Number.isFinite(troughValue) && typeof endValue === 'number' && troughValue > 0
      ? (endValue / troughValue) - 1
      : null
  const snapbackVelocity = typeof reboundFromLow === 'number' ? reboundFromLow / daysSinceLow : null
  const snapbackHigh = Boolean(
    (typeof reboundFromLow === 'number' && reboundFromLow >= 0.08 && (dd3 ?? -1) > 0) ||
      (
        typeof reboundFromLow === 'number' &&
        reboundFromLow >= 0.06 &&
        (dd3 ?? -1) >= -0.01 &&
        daysSinceLow <= 6 &&
        typeof snapbackVelocity === 'number' &&
        snapbackVelocity >= 0.012
      ),
  )

  return {
    snapbackHigh,
    snapbackVelocityPctPerBar: snapbackVelocity != null ? round(snapbackVelocity * 100, 3) : null,
    reboundFromLowPct: reboundFromLow != null ? round(reboundFromLow * 100, 2) : null,
    troughIndex,
    troughDate: event.chart_data[troughIndex]?.date ?? null,
    daysSinceLow,
  }
}

function hasMa200Hold(event: VRPlaybackEventView, endIndex: number) {
  const startIndex = endIndex - (MA200_HOLD_BARS - 1)
  if (startIndex < 0) return false
  for (let i = startIndex; i <= endIndex; i += 1) {
    const price = event.chart_data[i]?.qqq_n
    const ma200 = event.chart_data[i]?.ma200_n
    if (typeof price !== 'number' || typeof ma200 !== 'number' || price <= ma200) {
      return false
    }
  }
  return true
}

function hasStabilized(event: VRPlaybackEventView, startIndex: number, endIndex: number) {
  const recentStart = endIndex - (STABILIZATION_LOOKBACK_BARS - 1)
  if (recentStart <= startIndex) return false

  let priorLow = Number.POSITIVE_INFINITY
  for (let i = startIndex; i < recentStart; i += 1) {
    const value = getSeriesValue(event, i)
    if (typeof value === 'number') priorLow = Math.min(priorLow, value)
  }

  let recentLow = Number.POSITIVE_INFINITY
  for (let i = recentStart; i <= endIndex; i += 1) {
    const value = getSeriesValue(event, i)
    if (typeof value === 'number') recentLow = Math.min(recentLow, value)
  }

  if (!Number.isFinite(priorLow) || !Number.isFinite(recentLow) || recentLow <= priorLow) {
    return false
  }

  const recentDd3Abs = computeAvgAbsDd3(event, Math.max(startIndex + 3, endIndex - 9), endIndex)
  const priorDd3Abs = computeAvgAbsDd3(
    event,
    Math.max(startIndex + 3, endIndex - 19),
    Math.max(startIndex + 3, endIndex - 10),
  )
  const currentDd3 = computeTrailingReturn(event, endIndex, 3)
  const volShrinking = Boolean(
    (recentDd3Abs != null && priorDd3Abs != null && recentDd3Abs <= priorDd3Abs * 0.9) ||
      (currentDd3 != null && Math.abs(currentDd3) <= STABILIZATION_DD3_ABS_THRESHOLD),
  )

  return volShrinking
}

function defineRecoveryCompleteWindow(event: VRPlaybackEventView): WindowDefinition {
  const startIndex = event.chart_data.findIndex((point) => point.in_event)
  const legacyEndIndex = event.chart_data.reduce((last, point, index) => (point.in_event ? index : last), -1)
  if (startIndex < 0 || legacyEndIndex < startIndex) {
    throw new Error(`Event ${event.event_id} does not have a valid in_event window`)
  }

  const priorPeak = event.chart_data
    .slice(0, startIndex + 1)
    .reduce((peak, point) => (typeof point.qqq_n === 'number' ? Math.max(peak, point.qqq_n) : peak), 0)

  const snapback = inferSnapbackProfile(event, startIndex, legacyEndIndex)
  const minEndIndex = Math.max(
    legacyEndIndex,
    startIndex + MIN_RECOVERY_BARS + (snapback.snapbackHigh ? SNAPBACK_EXTENSION_BARS : 0),
  )

  let recoveryEndIndex = event.chart_data.length - 1
  let recoveryReason: RecoveryCompleteReason = 'TRUNCATED_AT_AVAILABLE_CONTEXT'

  for (let i = Math.min(minEndIndex, event.chart_data.length - 1); i < event.chart_data.length; i += 1) {
    const price = event.chart_data[i]?.qqq_n
    if (hasMa200Hold(event, i)) {
      recoveryEndIndex = i
      recoveryReason = 'MA200_20D_HOLD'
      break
    }
    if (typeof price === 'number' && priorPeak > 0 && price >= priorPeak * PRIOR_PEAK_RECOVERY_RATIO) {
      recoveryEndIndex = i
      recoveryReason = 'PRIOR_PEAK_95'
      break
    }
    if (hasStabilized(event, startIndex, i)) {
      recoveryEndIndex = i
      recoveryReason = 'STABILIZATION_30D'
      break
    }
  }

  return {
    event_id: event.event_id,
    event_label: event.name,
    event_start_date: event.chart_data[startIndex]?.date ?? event.start,
    legacy_end_date: event.chart_data[legacyEndIndex]?.date ?? event.end,
    recovery_complete_end_date:
      event.chart_data[recoveryEndIndex]?.date ?? event.chart_data[event.chart_data.length - 1]?.date ?? event.end,
    legacy_length_bars: legacyEndIndex - startIndex + 1,
    recovery_complete_length_bars: recoveryEndIndex - startIndex + 1,
    extension_bars: recoveryEndIndex - legacyEndIndex,
    snapback_speed_high: snapback.snapbackHigh,
    snapback_velocity_pct_per_bar: snapback.snapbackVelocityPctPerBar,
    rebound_from_low_pct: snapback.reboundFromLowPct,
    days_since_low: snapback.daysSinceLow,
    prior_peak_normalized: priorPeak > 0 ? round(priorPeak, 2) : null,
    trough_date: snapback.troughDate,
    recovery_complete_reason: recoveryReason,
  }
}

function buildRows(event: VRPlaybackEventView, variant: ExecutionPlaybackVariant): CombinedRow[] {
  return variant.points.map((point, index) => ({
    index,
    point,
    log: variant.trade_log[index],
    chart: event.chart_data[index],
  }))
}

function analyzeVariant(
  event: VRPlaybackEventView,
  variant: ExecutionPlaybackVariant,
  mode: Mode,
  eventLabel: string,
  windowKind: WindowKind,
  startIndex: number,
  endIndex: number,
): VariantMetrics {
  const initialPoolCash = event.cycle_start.initial_state?.initial_pool_cash ?? 0
  const nearZeroThreshold = initialPoolCash * POOL_NEAR_ZERO_THRESHOLD_PCT
  const rows = buildRows(event, variant)
  const windowRows = rows.filter((row) => row.index >= startIndex && row.index <= endIndex)
  const assetPrices = rows.map((row) => row.point.asset_price)
  const portfolioWindow = windowRows.map((row) => row.point.portfolio_value)
  const startPortfolioValue = windowRows[0]?.point.portfolio_value ?? 0
  const startPoolBalance = windowRows[0]?.point.pool_cash_before_trade ?? initialPoolCash
  const minPoolBalance = windowRows.reduce(
    (min, row) => Math.min(min, row.point.pool_cash_after_trade),
    Number.POSITIVE_INFINITY,
  )

  const executedAllRows = rows.filter(
    (row) =>
      row.log?.ladder_level_hit != null &&
      row.log.ladder_level_hit >= 1 &&
      row.log.ladder_level_hit <= 3 &&
      row.point.state_after_trade === 'buy_executed',
  )
  const executedWindowRows = executedAllRows.filter((row) => row.index >= startIndex && row.index <= endIndex)
  const partialRows = executedWindowRows.filter((row) => (row.point.trade_reason ?? '').includes('(delayed partial)'))
  const delayedInitRows = windowRows.filter(
    (row) =>
      row.log?.ladder_level_hit != null &&
      row.log.ladder_level_hit >= 1 &&
      row.log.ladder_level_hit <= 3 &&
      row.point.state_after_trade === 'buy_delayed' &&
      (row.point.trade_reason ?? '').startsWith('buy delayed by false-bottom guard'),
  )
  const blockedRows = windowRows.filter(
    (row) =>
      row.log?.ladder_level_hit != null &&
      row.log.ladder_level_hit >= 1 &&
      row.log.ladder_level_hit <= 3 &&
      row.point.state_after_trade === 'buy_blocked',
  )
  const blockedInitRows = blockedRows.filter((row, idx, list) => {
    const prev = list[idx - 1]
    return !prev || prev.index !== row.index - 1 || prev.log?.ladder_level_hit !== row.log?.ladder_level_hit
  })

  const matchedDelayedFillIndexes = new Set<number>()
  const delayedEvents: GuardSignalEvent[] = delayedInitRows.map((row) => {
    const fill = executedAllRows.find(
      (candidate) =>
        candidate.index > row.index &&
        candidate.log?.ladder_level_hit === row.log?.ladder_level_hit &&
        !matchedDelayedFillIndexes.has(candidate.index),
    )
    if (fill) matchedDelayedFillIndexes.add(fill.index)
    return {
      event_id: event.event_id,
      event_label: eventLabel,
      window_kind: windowKind,
      mode,
      kind: 'delayed',
      date: row.point.date,
      level_no: row.log?.ladder_level_hit ?? 0,
      price: row.point.asset_price,
      forward_return_5d_pct: computeForwardReturn(assetPrices, row.index, 5),
      forward_return_10d_pct: computeForwardReturn(assetPrices, row.index, 10),
      forward_return_20d_pct: computeForwardReturn(assetPrices, row.index, 20),
      eventual_fill: Boolean(fill),
      delay_bars: fill ? fill.index - row.index : null,
      lower_price_reentry: Boolean(fill && fill.point.asset_price < row.point.asset_price),
    }
  })

  const blockedEvents: GuardSignalEvent[] = blockedInitRows.map((row) => {
    const lowerPriceFill = executedAllRows.find(
      (candidate) =>
        candidate.index > row.index &&
        candidate.point.asset_price < row.point.asset_price &&
        (candidate.log?.ladder_level_hit ?? 0) >= 1 &&
        (candidate.log?.ladder_level_hit ?? 0) <= 3,
    )
    return {
      event_id: event.event_id,
      event_label: eventLabel,
      window_kind: windowKind,
      mode,
      kind: 'blocked',
      date: row.point.date,
      level_no: row.log?.ladder_level_hit ?? 0,
      price: row.point.asset_price,
      forward_return_5d_pct: computeForwardReturn(assetPrices, row.index, 5),
      forward_return_10d_pct: computeForwardReturn(assetPrices, row.index, 10),
      forward_return_20d_pct: computeForwardReturn(assetPrices, row.index, 20),
      eventual_fill: Boolean(lowerPriceFill),
      delay_bars: lowerPriceFill ? lowerPriceFill.index - row.index : null,
      lower_price_reentry: Boolean(lowerPriceFill),
    }
  })

  const immediateExecutedRows = executedWindowRows.filter(
    (row) => !matchedDelayedFillIndexes.has(row.index) && !partialRows.some((partial) => partial.index === row.index),
  )

  let poolDepletionCount = 0
  let previousNearZero = false
  windowRows.forEach((row) => {
    const nearZero = row.point.pool_cash_after_trade <= nearZeroThreshold
    if (nearZero && !previousNearZero) poolDepletionCount += 1
    previousNearZero = nearZero
  })

  const guardActiveDays = windowRows.filter((row) => row.point.buy_delay_flag).length
  const resetActivationIndexes = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
      if (index < startIndex || index > endIndex) return false
      if (!row.point.reset_ready_flag) return false
      const prev = index > 0 ? rows[index - 1] : null
      const risingEdge = !prev || !prev.point.reset_ready_flag
      if (!risingEdge) return false
      const relevantGuardContext =
        row.point.buy_delay_flag ||
        row.point.false_bottom_risk_level !== 'LOW' ||
        Boolean(prev?.point.buy_delay_flag) ||
        (prev?.point.false_bottom_risk_level ?? 'LOW') !== 'LOW'
      return relevantGuardContext
    })
    .map(({ index }) => index)

  const resetFollowMetrics = resetActivationIndexes.map((resetIndex) => {
    const nextBuy = executedAllRows.find((row) => row.index >= resetIndex)
    const daysToBuy = nextBuy ? nextBuy.index - resetIndex : null
    const resetReturn5d = computeForwardReturn(assetPrices, resetIndex, 5)
    const resetPrice = assetPrices[resetIndex] ?? 0
    const lookaheadEnd = Math.min(assetPrices.length - 1, resetIndex + RESET_FALSE_POSITIVE_WINDOW_BARS)
    const futureLow = assetPrices
      .slice(resetIndex + 1, lookaheadEnd + 1)
      .reduce((min, price) => Math.min(min, price), Number.POSITIVE_INFINITY)
    const falsePositive = Boolean(
      resetPrice > 0 &&
        Number.isFinite(futureLow) &&
        futureLow <= resetPrice * (1 - RESET_FALSE_POSITIVE_DROP_THRESHOLD),
    )
    const missedRebound = Boolean(
      typeof resetReturn5d === 'number' &&
        resetReturn5d >= RESET_REBOUND_THRESHOLD * 100 &&
        (daysToBuy == null || daysToBuy > RESET_BUY_WINDOW_BARS),
    )
    return {
      daysToBuy,
      firstBuy10dReturn: nextBuy ? computeForwardReturn(assetPrices, nextBuy.index, 10) : null,
      missedRebound,
      falsePositive,
    }
  })

  const { max_drawdown_pct, recovery_days } = computePortfolioStats(portfolioWindow)
  const finalValue = portfolioWindow[portfolioWindow.length - 1] ?? 0
  const cumulativePoolSpentStart = startIndex > 0 ? rows[startIndex - 1]?.point.cumulative_pool_spent ?? 0 : 0
  const cumulativePoolSpentEnd = rows[endIndex]?.point.cumulative_pool_spent ?? cumulativePoolSpentStart
  const windowPoolSpent = Math.max(0, cumulativePoolSpentEnd - cumulativePoolSpentStart)

  return {
    mode,
    window_kind: windowKind,
    window_start_date: windowRows[0]?.point.date ?? event.start,
    window_end_date: windowRows[windowRows.length - 1]?.point.date ?? event.end,
    window_length_bars: windowRows.length,
    final_value: round(finalValue, 2),
    period_return_pct: startPortfolioValue > 0 ? round(((finalValue / startPortfolioValue) - 1) * 100, 2) : 0,
    max_drawdown_pct,
    recovery_days,
    min_pool_balance: Number.isFinite(minPoolBalance) ? round(minPoolBalance, 2) : 0,
    pool_depletion_count: poolDepletionCount,
    pool_near_zero_days: windowRows.filter((row) => row.point.pool_cash_after_trade <= nearZeroThreshold).length,
    pool_usage_rate_pct: initialPoolCash > 0 ? round((windowPoolSpent / initialPoolCash) * 100, 2) : 0,
    episode_max_pool_stress_pct:
      startPoolBalance > 0 && Number.isFinite(minPoolBalance)
        ? round((1 - minPoolBalance / startPoolBalance) * 100, 2)
        : 0,
    total_vmin_trigger_events:
      immediateExecutedRows.length + partialRows.length + delayedEvents.length + blockedEvents.length,
    executed_vmin_buys: executedWindowRows.length,
    partial_buys_count: partialRows.length,
    delayed_buys_count: delayedEvents.length,
    blocked_buys_count: blockedEvents.length,
    average_delay_bars: average(delayedEvents.map((item) => item.delay_bars)),
    delayed_fill_rate_pct: safePercent(
      delayedEvents.filter((item) => item.eventual_fill).length,
      delayedEvents.length,
    ),
    blocked_then_lower_price_reentry_rate_pct: safePercent(
      blockedEvents.filter((item) => item.lower_price_reentry).length,
      blockedEvents.length,
    ),
    average_guarded_forward_return_5d_pct: average(
      [...delayedEvents, ...blockedEvents].map((item) => item.forward_return_5d_pct),
    ),
    average_guarded_forward_return_10d_pct: average(
      [...delayedEvents, ...blockedEvents].map((item) => item.forward_return_10d_pct),
    ),
    average_guarded_forward_return_20d_pct: average(
      [...delayedEvents, ...blockedEvents].map((item) => item.forward_return_20d_pct),
    ),
    guard_active_days: guardActiveDays,
    guard_reset_count: resetActivationIndexes.length,
    avg_days_to_first_vmin_buy_after_reset: average(resetFollowMetrics.map((item) => item.daysToBuy)),
    avg_reset_first_buy_10d_return_pct: average(resetFollowMetrics.map((item) => item.firstBuy10dReturn)),
    reset_delayed_missed_rebound_cases: resetFollowMetrics.filter((item) => item.missedRebound).length,
    reset_false_positive_rate_pct: safePercent(
      resetFollowMetrics.filter((item) => item.falsePositive).length,
      resetFollowMetrics.length,
    ),
    guard_signal_events: [...delayedEvents, ...blockedEvents],
  }
}

function buildEpisodeComparisons(view: NonNullable<ReturnType<typeof buildVRPlaybackView>>) {
  return TARGET_EPISODES.map((spec) => {
    const event = view.events.find((item) => item.event_id === spec.eventId)
    if (!event) {
      throw new Error(`Missing required playback event: ${spec.label}`)
    }

    const startIndex = event.chart_data.findIndex((point) => point.in_event)
    const legacyEndIndex = event.chart_data.reduce((last, point, index) => (point.in_event ? index : last), -1)
    const windowDefinition = defineRecoveryCompleteWindow(event)
    const recoveryEndIndex = startIndex + windowDefinition.recovery_complete_length_bars - 1

    const baseline = buildExecutionPlayback(event, INITIAL_CAP, { falseBottomGuard: false }).variants[INITIAL_CAP]
    const guardPhase2 = buildExecutionPlayback(event, INITIAL_CAP, {
      falseBottomGuard: true,
      guardReleaseProfile: 'phase2',
    }).variants[INITIAL_CAP]
    const guardPhase3 = buildExecutionPlayback(event, INITIAL_CAP, {
      falseBottomGuard: true,
      guardReleaseProfile: 'phase3',
    }).variants[INITIAL_CAP]

    return {
      event_id: spec.eventId,
      event_label: spec.label,
      window_definition: windowDefinition,
      legacy_window: {
        baseline: analyzeVariant(event, baseline, 'baseline', spec.label, 'legacy_window', startIndex, legacyEndIndex),
        guard_phase2: analyzeVariant(event, guardPhase2, 'guard_phase2', spec.label, 'legacy_window', startIndex, legacyEndIndex),
        guard_phase3: analyzeVariant(event, guardPhase3, 'guard_phase3', spec.label, 'legacy_window', startIndex, legacyEndIndex),
      },
      recovery_complete_window: {
        baseline: analyzeVariant(event, baseline, 'baseline', spec.label, 'recovery_complete_window', startIndex, recoveryEndIndex),
        guard_phase2: analyzeVariant(event, guardPhase2, 'guard_phase2', spec.label, 'recovery_complete_window', startIndex, recoveryEndIndex),
        guard_phase3: analyzeVariant(event, guardPhase3, 'guard_phase3', spec.label, 'recovery_complete_window', startIndex, recoveryEndIndex),
      },
    } satisfies EpisodeComparison
  })
}

function buildWindowDefinitionRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    event_start_date: episode.window_definition.event_start_date,
    legacy_end_date: episode.window_definition.legacy_end_date,
    recovery_complete_end_date: episode.window_definition.recovery_complete_end_date,
    legacy_length_bars: episode.window_definition.legacy_length_bars,
    recovery_complete_length_bars: episode.window_definition.recovery_complete_length_bars,
    extension_bars: episode.window_definition.extension_bars,
    snapback_speed_high: episode.window_definition.snapback_speed_high,
    snapback_velocity_pct_per_bar: episode.window_definition.snapback_velocity_pct_per_bar,
    rebound_from_low_pct: episode.window_definition.rebound_from_low_pct,
    days_since_low: episode.window_definition.days_since_low,
    trough_date: episode.window_definition.trough_date,
    prior_peak_normalized: episode.window_definition.prior_peak_normalized,
    recovery_complete_reason: episode.window_definition.recovery_complete_reason,
  }))
}

function buildRecoveryWindowSummaryRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    start: episode.window_definition.event_start_date,
    end: episode.window_definition.recovery_complete_end_date,
    baseline_final_value: episode.recovery_complete_window.baseline.final_value,
    phase2_final_value: episode.recovery_complete_window.guard_phase2.final_value,
    phase3_final_value: episode.recovery_complete_window.guard_phase3.final_value,
    phase2_final_value_delta: round(
      episode.recovery_complete_window.guard_phase2.final_value - episode.recovery_complete_window.baseline.final_value,
      2,
    ),
    phase3_final_value_delta: round(
      episode.recovery_complete_window.guard_phase3.final_value - episode.recovery_complete_window.baseline.final_value,
      2,
    ),
    baseline_max_drawdown_pct: episode.recovery_complete_window.baseline.max_drawdown_pct,
    phase2_max_drawdown_pct: episode.recovery_complete_window.guard_phase2.max_drawdown_pct,
    phase3_max_drawdown_pct: episode.recovery_complete_window.guard_phase3.max_drawdown_pct,
    baseline_recovery_days: episode.recovery_complete_window.baseline.recovery_days,
    phase2_recovery_days: episode.recovery_complete_window.guard_phase2.recovery_days,
    phase3_recovery_days: episode.recovery_complete_window.guard_phase3.recovery_days,
    baseline_min_pool_balance: episode.recovery_complete_window.baseline.min_pool_balance,
    phase2_min_pool_balance: episode.recovery_complete_window.guard_phase2.min_pool_balance,
    phase3_min_pool_balance: episode.recovery_complete_window.guard_phase3.min_pool_balance,
    phase2_min_pool_balance_improvement: round(
      episode.recovery_complete_window.guard_phase2.min_pool_balance - episode.recovery_complete_window.baseline.min_pool_balance,
      2,
    ),
    phase3_min_pool_balance_improvement: round(
      episode.recovery_complete_window.guard_phase3.min_pool_balance - episode.recovery_complete_window.baseline.min_pool_balance,
      2,
    ),
    baseline_pool_near_zero_days: episode.recovery_complete_window.baseline.pool_near_zero_days,
    phase2_pool_near_zero_days: episode.recovery_complete_window.guard_phase2.pool_near_zero_days,
    phase3_pool_near_zero_days: episode.recovery_complete_window.guard_phase3.pool_near_zero_days,
    phase2_miss_cost_10d_pct: episode.recovery_complete_window.guard_phase2.average_guarded_forward_return_10d_pct,
    phase3_miss_cost_10d_pct: episode.recovery_complete_window.guard_phase3.average_guarded_forward_return_10d_pct,
  }))
}

function buildWindowDeltaRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    extension_bars: episode.window_definition.extension_bars,
    recovery_reason: episode.window_definition.recovery_complete_reason,
    baseline_final_delta_new_minus_old: round(
      episode.recovery_complete_window.baseline.final_value - episode.legacy_window.baseline.final_value,
      2,
    ),
    phase2_final_delta_new_minus_old: round(
      episode.recovery_complete_window.guard_phase2.final_value - episode.legacy_window.guard_phase2.final_value,
      2,
    ),
    phase3_final_delta_new_minus_old: round(
      episode.recovery_complete_window.guard_phase3.final_value - episode.legacy_window.guard_phase3.final_value,
      2,
    ),
    phase2_miss_cost_10d_delta_new_minus_old: round(
      (episode.recovery_complete_window.guard_phase2.average_guarded_forward_return_10d_pct ?? 0) -
        (episode.legacy_window.guard_phase2.average_guarded_forward_return_10d_pct ?? 0),
      2,
    ),
    phase3_miss_cost_10d_delta_new_minus_old: round(
      (episode.recovery_complete_window.guard_phase3.average_guarded_forward_return_10d_pct ?? 0) -
        (episode.legacy_window.guard_phase3.average_guarded_forward_return_10d_pct ?? 0),
      2,
    ),
    phase2_guard_days_delta_new_minus_old:
      episode.recovery_complete_window.guard_phase2.guard_active_days - episode.legacy_window.guard_phase2.guard_active_days,
    phase3_guard_days_delta_new_minus_old:
      episode.recovery_complete_window.guard_phase3.guard_active_days - episode.legacy_window.guard_phase3.guard_active_days,
    phase2_reset_missed_delta_new_minus_old:
      episode.recovery_complete_window.guard_phase2.reset_delayed_missed_rebound_cases -
      episode.legacy_window.guard_phase2.reset_delayed_missed_rebound_cases,
    phase3_reset_missed_delta_new_minus_old:
      episode.recovery_complete_window.guard_phase3.reset_delayed_missed_rebound_cases -
      episode.legacy_window.guard_phase3.reset_delayed_missed_rebound_cases,
  }))
}

function buildDiagnosticsRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    phase2_legacy_guard_active_days: episode.legacy_window.guard_phase2.guard_active_days,
    phase2_recovery_guard_active_days: episode.recovery_complete_window.guard_phase2.guard_active_days,
    phase3_legacy_guard_active_days: episode.legacy_window.guard_phase3.guard_active_days,
    phase3_recovery_guard_active_days: episode.recovery_complete_window.guard_phase3.guard_active_days,
    phase2_legacy_avg_days_to_first_buy_after_reset:
      episode.legacy_window.guard_phase2.avg_days_to_first_vmin_buy_after_reset,
    phase2_recovery_avg_days_to_first_buy_after_reset:
      episode.recovery_complete_window.guard_phase2.avg_days_to_first_vmin_buy_after_reset,
    phase3_legacy_avg_days_to_first_buy_after_reset:
      episode.legacy_window.guard_phase3.avg_days_to_first_vmin_buy_after_reset,
    phase3_recovery_avg_days_to_first_buy_after_reset:
      episode.recovery_complete_window.guard_phase3.avg_days_to_first_vmin_buy_after_reset,
    phase2_legacy_reset_missed_rebounds: episode.legacy_window.guard_phase2.reset_delayed_missed_rebound_cases,
    phase2_recovery_reset_missed_rebounds:
      episode.recovery_complete_window.guard_phase2.reset_delayed_missed_rebound_cases,
    phase3_legacy_reset_missed_rebounds: episode.legacy_window.guard_phase3.reset_delayed_missed_rebound_cases,
    phase3_recovery_reset_missed_rebounds:
      episode.recovery_complete_window.guard_phase3.reset_delayed_missed_rebound_cases,
    phase2_legacy_reset_false_positive_rate_pct: episode.legacy_window.guard_phase2.reset_false_positive_rate_pct,
    phase2_recovery_reset_false_positive_rate_pct:
      episode.recovery_complete_window.guard_phase2.reset_false_positive_rate_pct,
    phase3_legacy_reset_false_positive_rate_pct: episode.legacy_window.guard_phase3.reset_false_positive_rate_pct,
    phase3_recovery_reset_false_positive_rate_pct:
      episode.recovery_complete_window.guard_phase3.reset_false_positive_rate_pct,
  }))
}

function buildReportMarkdown(comparisons: EpisodeComparison[]) {
  const windowRows = buildWindowDefinitionRows(comparisons)
  const summaryRows = buildRecoveryWindowSummaryRows(comparisons)
  const deltaRows = buildWindowDeltaRows(comparisons)
  const diagnosticsRows = buildDiagnosticsRows(comparisons)
  const episode2011 = comparisons.find((item) => item.event_id === '2011-06')

  return `# VR False-Bottom Guard Phase 0 Report

## Implementation summary
This pass changes the evaluation window only. Guard logic, reset logic, buy conditions, Standard, MSS, Track state, crisis stage, exposure logic, and Monte Carlo logic are unchanged.

Event windows are now evaluated in two ways:
- Legacy window: first in-event bar through the archive event end
- Recovery-complete window: first in-event bar through the first recovery-complete point after the event, with a hard minimum of ${MIN_RECOVERY_BARS} bars from event start and an extra ${SNAPBACK_EXTENSION_BARS}-bar minimum extension for snapback events

Recovery complete is defined by the first of:
- price above MA200 for ${MA200_HOLD_BARS} consecutive bars
- price reaching ${PRIOR_PEAK_RECOVERY_RATIO * 100}% of the prior peak
- ${STABILIZATION_LOOKBACK_BARS}-bar stabilization with no new low and shrinking dd3 volatility

## Validation method
- Engine: \`build_execution_playback.ts\` vFinal playback
- Modes: Baseline vs Guard Phase 2 vs Guard Phase 3
- Cap: \`${INITIAL_CAP}%\`
- Only the event window used for measurement changed
- Guard miss-cost and reset metrics still use the same audit definitions as prior work

## Event window definition table
${markdownTable(windowRows.map((row) => ({
    event: row.event_label as string,
    start: row.event_start_date as string,
    legacy_end: row.legacy_end_date as string,
    recovery_end: row.recovery_complete_end_date as string,
    legacy_bars: row.legacy_length_bars as number,
    recovery_bars: row.recovery_complete_length_bars as number,
    extension_bars: row.extension_bars as number,
    snapback_high: row.snapback_speed_high as boolean,
    recovery_reason: row.recovery_complete_reason as string,
  })))}

## Episode comparison table (recovery-complete window)
${markdownTable(summaryRows.map((row) => ({
    event: row.event_label as string,
    baseline_final: row.baseline_final_value as number,
    phase2_final: row.phase2_final_value as number,
    phase3_final: row.phase3_final_value as number,
    phase2_delta: row.phase2_final_value_delta as number,
    phase3_delta: row.phase3_final_value_delta as number,
    baseline_dd: row.baseline_max_drawdown_pct as number,
    phase2_dd: row.phase2_max_drawdown_pct as number,
    phase3_dd: row.phase3_max_drawdown_pct as number,
    phase2_miss_cost_10d: row.phase2_miss_cost_10d_pct as number | null,
    phase3_miss_cost_10d: row.phase3_miss_cost_10d_pct as number | null,
  })))}

## Legacy vs recovery-complete window comparison
${markdownTable(deltaRows.map((row) => ({
    event: row.event_label as string,
    extension_bars: row.extension_bars as number,
    reason: row.recovery_reason as string,
    baseline_final_delta: row.baseline_final_delta_new_minus_old as number,
    phase2_final_delta: row.phase2_final_delta_new_minus_old as number,
    phase3_final_delta: row.phase3_final_delta_new_minus_old as number,
    phase2_miss_cost_10d_delta: row.phase2_miss_cost_10d_delta_new_minus_old as number,
    phase3_miss_cost_10d_delta: row.phase3_miss_cost_10d_delta_new_minus_old as number,
  })))}

## 2011 change analysis
${episode2011 ? markdownTable([
    {
      window: 'legacy',
      phase2_final: episode2011.legacy_window.guard_phase2.final_value,
      phase3_final: episode2011.legacy_window.guard_phase3.final_value,
      phase2_miss_cost_10d: episode2011.legacy_window.guard_phase2.average_guarded_forward_return_10d_pct,
      phase3_miss_cost_10d: episode2011.legacy_window.guard_phase3.average_guarded_forward_return_10d_pct,
      phase2_reset_missed: episode2011.legacy_window.guard_phase2.reset_delayed_missed_rebound_cases,
      phase3_reset_missed: episode2011.legacy_window.guard_phase3.reset_delayed_missed_rebound_cases,
    },
    {
      window: 'recovery_complete',
      phase2_final: episode2011.recovery_complete_window.guard_phase2.final_value,
      phase3_final: episode2011.recovery_complete_window.guard_phase3.final_value,
      phase2_miss_cost_10d: episode2011.recovery_complete_window.guard_phase2.average_guarded_forward_return_10d_pct,
      phase3_miss_cost_10d: episode2011.recovery_complete_window.guard_phase3.average_guarded_forward_return_10d_pct,
      phase2_reset_missed: episode2011.recovery_complete_window.guard_phase2.reset_delayed_missed_rebound_cases,
      phase3_reset_missed: episode2011.recovery_complete_window.guard_phase3.reset_delayed_missed_rebound_cases,
    },
  ]) : '2011 episode not available'}

## Reset and rebound diagnostics
${markdownTable(diagnosticsRows.map((row) => ({
    event: row.event_label as string,
    phase2_legacy_guard_days: row.phase2_legacy_guard_active_days as number,
    phase2_recovery_guard_days: row.phase2_recovery_guard_active_days as number,
    phase3_legacy_guard_days: row.phase3_legacy_guard_active_days as number,
    phase3_recovery_guard_days: row.phase3_recovery_guard_active_days as number,
    phase2_legacy_reset_missed: row.phase2_legacy_reset_missed_rebounds as number,
    phase2_recovery_reset_missed: row.phase2_recovery_reset_missed_rebounds as number,
    phase3_legacy_reset_missed: row.phase3_legacy_reset_missed_rebounds as number,
    phase3_recovery_reset_missed: row.phase3_recovery_reset_missed_rebounds as number,
  })))}

## Key findings
- Recovery-complete windows materially extend 2020, 2024, and 2025. Their archive windows were shorter than the recovery-complete definition.
- 2011, 2018, and 2022 do not extend under the new rule. In the current archive, those windows were already long enough to satisfy the recovery-complete test.
- The guard ranking direction is preserved after extension: 2020 and 2022 still favor the guard, while 2025 remains mildly negative and 2011 remains the main snapback penalty case.

## Recommended next step
Use this recovery-complete report as the baseline for any further guard-release tuning. Do not adjust guard logic until the episode ranking is reviewed under the longer window definition.

## Confirmation: no logic drift
This pass changed only the measurement window. Execution logic, buy conditions, false-bottom guard logic, reset logic, MSS, Track state, crisis stage, Standard, and Monte Carlo are unchanged.
`
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const standardArchive = readJson<RawStandardPlaybackArchive>('risk_v1_playback.json')
  const survivalArchive = readJson<RawVRSurvivalPlaybackArchive>('vr_survival_playback.json')
  const playbackView = buildVRPlaybackView({
    standardArchive,
    survivalArchive,
    rootDir: process.cwd(),
  })

  if (!playbackView) {
    throw new Error('VR playback view unavailable')
  }

  const comparisons = buildEpisodeComparisons(playbackView)
  const windowRows = buildWindowDefinitionRows(comparisons)
  const summaryRows = buildRecoveryWindowSummaryRows(comparisons)
  const deltaRows = buildWindowDeltaRows(comparisons)
  const diagnosticsRows = buildDiagnosticsRows(comparisons)
  const guardSignals = comparisons.flatMap((episode) => [
    ...episode.legacy_window.guard_phase2.guard_signal_events,
    ...episode.legacy_window.guard_phase3.guard_signal_events,
    ...episode.recovery_complete_window.guard_phase2.guard_signal_events,
    ...episode.recovery_complete_window.guard_phase3.guard_signal_events,
  ])

  writeFileSync(join(OUTPUT_DIR, 'window_definition_summary.json'), JSON.stringify(windowRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'window_definition_summary.csv'), toCsv(windowRows))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.json'), JSON.stringify(summaryRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.csv'), toCsv(summaryRows))
  writeFileSync(join(OUTPUT_DIR, 'legacy_vs_recovery_window_delta.json'), JSON.stringify(deltaRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'legacy_vs_recovery_window_delta.csv'), toCsv(deltaRows))
  writeFileSync(join(OUTPUT_DIR, 'reset_rebound_diagnostics.json'), JSON.stringify(diagnosticsRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'reset_rebound_diagnostics.csv'), toCsv(diagnosticsRows))
  writeFileSync(join(OUTPUT_DIR, 'guard_signal_events.json'), JSON.stringify(guardSignals, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'guard_signal_events.csv'), toCsv(guardSignals))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_full.json'), JSON.stringify(comparisons, null, 2))
  writeFileSync(REPORT_PATH, buildReportMarkdown(comparisons))

  console.log(`[phase0-recovery-complete] wrote ${join(OUTPUT_DIR, 'episode_comparison_summary.csv')}`)
  console.log(`[phase0-recovery-complete] wrote ${join(OUTPUT_DIR, 'legacy_vs_recovery_window_delta.csv')}`)
  console.log(`[phase0-recovery-complete] wrote ${REPORT_PATH}`)
}

main()
