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

type Mode = 'baseline' | 'guard_phase2' | 'guard_phase3' | 'guard_phase6'
type GuardEventKind = 'delayed' | 'blocked'

type EpisodeSpec = {
  eventId: string
  label: string
  required: boolean
}

type GuardSignalEvent = {
  event_id: string
  event_label: string
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
  snapback_candidate_flag_days: number
  low_reentry_flag_days: number
  first_buy_override_used_count: number
  override_triggered_count: number
  guard_signal_events: GuardSignalEvent[]
  pool_series: Array<{ date: string; pool_cash: number }>
  portfolio_series: Array<{ date: string; portfolio_value: number }>
  guard_timeline: Array<{
    date: string
    false_bottom_risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
    buy_delay_flag: boolean
    delay_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
    reset_ready_flag: boolean
    reset_confidence: 'LOW' | 'MEDIUM' | 'HIGH'
    reset_reason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
    fast_snapback_flag: boolean
    override_strength: 'NONE' | 'WEAK' | 'MODERATE'
    override_reason: 'SNAPBACK' | 'NO_REENTRY' | 'EARLY_RECOVERY'
    snapback_candidate_flag: boolean
    low_reentry_flag: boolean
    first_buy_override_used: boolean
    override_triggered: boolean
    state_after_trade: string
    trade_reason: string | null
  }>
}

type EpisodeComparison = {
  event_id: string
  event_label: string
  start: string
  end: string
  baseline: VariantMetrics
  guard_phase2: VariantMetrics
  guard_phase3: VariantMetrics
  guard_phase6: VariantMetrics
}

const TARGET_EPISODES: EpisodeSpec[] = [
  { eventId: '2011-06', label: '2011 Debt Ceiling', required: true },
  { eventId: '2018-10', label: '2018 Q4', required: true },
  { eventId: '2020-02', label: '2020 Covid Crash', required: true },
  { eventId: '2021-12', label: '2022 Fed Bear', required: true },
  { eventId: '2024-07', label: '2024 Yen Carry', required: false },
  { eventId: '2025-01', label: '2025 Tariff Shock', required: true },
  { eventId: '2025-03', label: '2025 Fragile Recovery', required: false },
]

const OUTPUT_DIR = join(process.cwd(), 'vr_backtest', 'results', 'false_bottom_guard_phase6')
const REPORT_PATH = join(process.cwd(), 'docs', 'vr_false_bottom_guard_phase6_report.md')
const INITIAL_CAP = '50' as const
const POOL_NEAR_ZERO_THRESHOLD_PCT = 0.05
const RESET_REBOUND_THRESHOLD = 0.08
const RESET_BUY_WINDOW_BARS = 3
const RESET_FALSE_POSITIVE_WINDOW_BARS = 5
const RESET_FALSE_POSITIVE_DROP_THRESHOLD = 0.02

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

function findMissingRequired(view: ReturnType<typeof buildVRPlaybackView>) {
  if (!view) return TARGET_EPISODES.filter((item) => item.required).map((item) => item.label)
  return TARGET_EPISODES
    .filter((item) => item.required && !view.events.find((event) => event.event_id === item.eventId))
    .map((item) => item.label)
}

function analyzeVariant(
  event: VRPlaybackEventView,
  variant: ExecutionPlaybackVariant,
  mode: Mode,
  eventLabel: string,
): VariantMetrics {
  const initialCapital = event.cycle_start.initial_state?.initial_capital ?? 0
  const initialPoolCash = event.cycle_start.initial_state?.initial_pool_cash ?? 0
  const nearZeroThreshold = initialPoolCash * POOL_NEAR_ZERO_THRESHOLD_PCT
  const rows = variant.points.map((point, index) => ({
    index,
    point,
    log: variant.trade_log[index],
  }))
  const assetPrices = rows.map((row) => row.point.asset_price)
  const portfolioValues = rows.map((row) => row.point.portfolio_value)
  const minPoolBalance = rows.reduce((min, row) => Math.min(min, row.point.pool_cash_after_trade), Number.POSITIVE_INFINITY)
  let poolDepletionCount = 0
  let previousNearZero = false
  rows.forEach((row) => {
    const nearZero = row.point.pool_cash_after_trade <= nearZeroThreshold
    if (nearZero && !previousNearZero) poolDepletionCount += 1
    previousNearZero = nearZero
  })

  const executedRows = rows.filter(
    (row) =>
      row.log?.ladder_level_hit != null &&
      row.log.ladder_level_hit >= 1 &&
      row.log.ladder_level_hit <= 3 &&
      row.point.state_after_trade === 'buy_executed',
  )
  const partialRows = executedRows.filter((row) => (row.point.trade_reason ?? '').includes('partial'))
  const delayedInitRows = rows.filter(
    (row) =>
      row.log?.ladder_level_hit != null &&
      row.log.ladder_level_hit >= 1 &&
      row.log.ladder_level_hit <= 3 &&
      row.point.state_after_trade === 'buy_delayed' &&
      (row.point.trade_reason ?? '').startsWith('buy delayed by false-bottom guard'),
  )
  const blockedRows = rows.filter(
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
    const fill = executedRows.find(
      (candidate) =>
        candidate.index > row.index &&
        candidate.log?.ladder_level_hit === row.log?.ladder_level_hit &&
        !matchedDelayedFillIndexes.has(candidate.index),
    )
    if (fill) matchedDelayedFillIndexes.add(fill.index)
    return {
      event_id: event.event_id,
      event_label: eventLabel,
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
    const lowerPriceFill = executedRows.find(
      (candidate) =>
        candidate.index > row.index &&
        candidate.point.asset_price < row.point.asset_price &&
        (candidate.log?.ladder_level_hit ?? 0) >= 1 &&
        (candidate.log?.ladder_level_hit ?? 0) <= 3,
    )
    return {
      event_id: event.event_id,
      event_label: eventLabel,
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

  const immediateExecutedRows = executedRows.filter(
    (row) => !matchedDelayedFillIndexes.has(row.index) && !partialRows.some((partial) => partial.index === row.index),
  )

  const guardActiveDays = rows.filter((row) => row.point.buy_delay_flag).length
  const resetActivationIndexes = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
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
    const nextBuy = executedRows.find((row) => row.index >= resetIndex)
    const daysToBuy = nextBuy ? nextBuy.index - resetIndex : null
    const resetReturn5d = computeForwardReturn(assetPrices, resetIndex, 5)
    const resetPrice = assetPrices[resetIndex] ?? 0
    const lookaheadEnd = Math.min(assetPrices.length - 1, resetIndex + RESET_FALSE_POSITIVE_WINDOW_BARS)
    const futureLow = assetPrices.slice(resetIndex + 1, lookaheadEnd + 1).reduce(
      (min, price) => Math.min(min, price),
      Number.POSITIVE_INFINITY,
    )
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

  const { max_drawdown_pct, recovery_days } = computePortfolioStats(portfolioValues)
  const finalValue = portfolioValues[portfolioValues.length - 1] ?? 0
  const snapbackCandidateFlagDays = rows.filter((row) => row.point.snapback_candidate_flag).length
  const lowReentryFlagDays = rows.filter((row) => row.point.low_reentry_flag).length
  const firstBuyOverrideUsedCount = rows.filter((row, index) => {
    if (!row.point.first_buy_override_used) return false
    const prev = index > 0 ? rows[index - 1] : null
    return !prev?.point.first_buy_override_used
  }).length
  const overrideTriggeredCount = rows.filter((row) => row.point.override_triggered).length

  return {
    mode,
    final_value: round(finalValue, 2),
    period_return_pct: initialCapital > 0 ? round(((finalValue / initialCapital) - 1) * 100, 2) : 0,
    max_drawdown_pct,
    recovery_days,
    min_pool_balance: Number.isFinite(minPoolBalance) ? round(minPoolBalance, 2) : 0,
    pool_depletion_count: poolDepletionCount,
    pool_near_zero_days: rows.filter((row) => row.point.pool_cash_after_trade <= nearZeroThreshold).length,
    pool_usage_rate_pct: initialPoolCash > 0 ? round((variant.pool_usage_summary.cumulative_pool_spent / initialPoolCash) * 100, 2) : 0,
    episode_max_pool_stress_pct:
      initialPoolCash > 0 && Number.isFinite(minPoolBalance)
        ? round((1 - minPoolBalance / initialPoolCash) * 100, 2)
        : 0,
    total_vmin_trigger_events: immediateExecutedRows.length + partialRows.length + delayedEvents.length + blockedEvents.length,
    executed_vmin_buys: executedRows.length,
    partial_buys_count: partialRows.length,
    delayed_buys_count: delayedEvents.length,
    blocked_buys_count: blockedEvents.length,
    average_delay_bars: average(delayedEvents.map((item) => item.delay_bars)),
    delayed_fill_rate_pct: safePercent(delayedEvents.filter((item) => item.eventual_fill).length, delayedEvents.length),
    blocked_then_lower_price_reentry_rate_pct: safePercent(blockedEvents.filter((item) => item.lower_price_reentry).length, blockedEvents.length),
    average_guarded_forward_return_5d_pct: average([...delayedEvents, ...blockedEvents].map((item) => item.forward_return_5d_pct)),
    average_guarded_forward_return_10d_pct: average([...delayedEvents, ...blockedEvents].map((item) => item.forward_return_10d_pct)),
    average_guarded_forward_return_20d_pct: average([...delayedEvents, ...blockedEvents].map((item) => item.forward_return_20d_pct)),
    guard_active_days: guardActiveDays,
    guard_reset_count: resetActivationIndexes.length,
    avg_days_to_first_vmin_buy_after_reset: average(resetFollowMetrics.map((item) => item.daysToBuy)),
    avg_reset_first_buy_10d_return_pct: average(resetFollowMetrics.map((item) => item.firstBuy10dReturn)),
    reset_delayed_missed_rebound_cases: resetFollowMetrics.filter((item) => item.missedRebound).length,
    reset_false_positive_rate_pct: safePercent(
      resetFollowMetrics.filter((item) => item.falsePositive).length,
      resetFollowMetrics.length,
    ),
    snapback_candidate_flag_days: snapbackCandidateFlagDays,
    low_reentry_flag_days: lowReentryFlagDays,
    first_buy_override_used_count: firstBuyOverrideUsedCount,
    override_triggered_count: overrideTriggeredCount,
    guard_signal_events: [...delayedEvents, ...blockedEvents],
    pool_series: rows.map((row) => ({ date: row.point.date, pool_cash: row.point.pool_cash_after_trade })),
    portfolio_series: rows.map((row) => ({ date: row.point.date, portfolio_value: row.point.portfolio_value })),
    guard_timeline: rows.map((row) => ({
      date: row.point.date,
      false_bottom_risk_level: row.point.false_bottom_risk_level,
      buy_delay_flag: row.point.buy_delay_flag,
      delay_strength: row.point.delay_strength,
      reset_ready_flag: row.point.reset_ready_flag,
      reset_confidence: row.point.reset_confidence,
      reset_reason: row.point.reset_reason,
      fast_snapback_flag: row.point.fast_snapback_flag,
      override_strength: row.point.override_strength,
      override_reason: row.point.override_reason,
      snapback_candidate_flag: row.point.snapback_candidate_flag,
      low_reentry_flag: row.point.low_reentry_flag,
      first_buy_override_used: row.point.first_buy_override_used,
      override_triggered: row.point.override_triggered,
      state_after_trade: row.point.state_after_trade,
      trade_reason: row.point.trade_reason,
    })),
  }
}

function buildEpisodeComparisons(view: NonNullable<ReturnType<typeof buildVRPlaybackView>>) {
  return TARGET_EPISODES
    .map((spec) => {
      const event = view.events.find((item) => item.event_id === spec.eventId)
      if (!event) return null

      const baseline = buildExecutionPlayback(event, INITIAL_CAP, { falseBottomGuard: false }).variants[INITIAL_CAP]
      const guardPhase2 = buildExecutionPlayback(event, INITIAL_CAP, {
        falseBottomGuard: true,
        guardReleaseProfile: 'phase2',
      }).variants[INITIAL_CAP]
      const guardPhase3 = buildExecutionPlayback(event, INITIAL_CAP, {
        falseBottomGuard: true,
        guardReleaseProfile: 'phase3',
      }).variants[INITIAL_CAP]
      const guardPhase6 = buildExecutionPlayback(event, INITIAL_CAP, {
        falseBottomGuard: true,
        guardReleaseProfile: 'phase6',
      }).variants[INITIAL_CAP]

      return {
        event_id: spec.eventId,
        event_label: spec.label,
        start: event.start,
        end: event.end,
        baseline: analyzeVariant(event, baseline, 'baseline', spec.label),
        guard_phase2: analyzeVariant(event, guardPhase2, 'guard_phase2', spec.label),
        guard_phase3: analyzeVariant(event, guardPhase3, 'guard_phase3', spec.label),
        guard_phase6: analyzeVariant(event, guardPhase6, 'guard_phase6', spec.label),
      } satisfies EpisodeComparison
    })
    .filter((item): item is EpisodeComparison => item != null)
}

function buildEpisodeSummaryRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    start: episode.start,
    end: episode.end,
    baseline_final_value: episode.baseline.final_value,
    phase2_final_value: episode.guard_phase2.final_value,
    phase3_final_value: episode.guard_phase3.final_value,
    phase6_final_value: episode.guard_phase6.final_value,
    phase2_final_value_delta: round(episode.guard_phase2.final_value - episode.baseline.final_value, 2),
    phase3_final_value_delta: round(episode.guard_phase3.final_value - episode.baseline.final_value, 2),
    phase6_final_value_delta: round(episode.guard_phase6.final_value - episode.baseline.final_value, 2),
    baseline_period_return_pct: episode.baseline.period_return_pct,
    phase2_period_return_pct: episode.guard_phase2.period_return_pct,
    phase3_period_return_pct: episode.guard_phase3.period_return_pct,
    phase6_period_return_pct: episode.guard_phase6.period_return_pct,
    baseline_max_drawdown_pct: episode.baseline.max_drawdown_pct,
    phase2_max_drawdown_pct: episode.guard_phase2.max_drawdown_pct,
    phase3_max_drawdown_pct: episode.guard_phase3.max_drawdown_pct,
    phase6_max_drawdown_pct: episode.guard_phase6.max_drawdown_pct,
    baseline_recovery_days: episode.baseline.recovery_days,
    phase2_recovery_days: episode.guard_phase2.recovery_days,
    phase3_recovery_days: episode.guard_phase3.recovery_days,
    phase6_recovery_days: episode.guard_phase6.recovery_days,
    baseline_min_pool_balance: episode.baseline.min_pool_balance,
    phase2_min_pool_balance: episode.guard_phase2.min_pool_balance,
    phase3_min_pool_balance: episode.guard_phase3.min_pool_balance,
    phase6_min_pool_balance: episode.guard_phase6.min_pool_balance,
    phase2_min_pool_balance_improvement: round(episode.guard_phase2.min_pool_balance - episode.baseline.min_pool_balance, 2),
    phase3_min_pool_balance_improvement: round(episode.guard_phase3.min_pool_balance - episode.baseline.min_pool_balance, 2),
    phase6_min_pool_balance_improvement: round(episode.guard_phase6.min_pool_balance - episode.baseline.min_pool_balance, 2),
    baseline_pool_depletion_count: episode.baseline.pool_depletion_count,
    phase2_pool_depletion_count: episode.guard_phase2.pool_depletion_count,
    phase3_pool_depletion_count: episode.guard_phase3.pool_depletion_count,
    phase6_pool_depletion_count: episode.guard_phase6.pool_depletion_count,
    baseline_pool_near_zero_days: episode.baseline.pool_near_zero_days,
    phase2_pool_near_zero_days: episode.guard_phase2.pool_near_zero_days,
    phase3_pool_near_zero_days: episode.guard_phase3.pool_near_zero_days,
    phase6_pool_near_zero_days: episode.guard_phase6.pool_near_zero_days,
    baseline_pool_usage_rate_pct: episode.baseline.pool_usage_rate_pct,
    phase2_pool_usage_rate_pct: episode.guard_phase2.pool_usage_rate_pct,
    phase3_pool_usage_rate_pct: episode.guard_phase3.pool_usage_rate_pct,
    phase6_pool_usage_rate_pct: episode.guard_phase6.pool_usage_rate_pct,
    baseline_episode_max_pool_stress_pct: episode.baseline.episode_max_pool_stress_pct,
    phase2_episode_max_pool_stress_pct: episode.guard_phase2.episode_max_pool_stress_pct,
    phase3_episode_max_pool_stress_pct: episode.guard_phase3.episode_max_pool_stress_pct,
    phase6_episode_max_pool_stress_pct: episode.guard_phase6.episode_max_pool_stress_pct,
    phase2_miss_cost_5d_pct: episode.guard_phase2.average_guarded_forward_return_5d_pct,
    phase2_miss_cost_10d_pct: episode.guard_phase2.average_guarded_forward_return_10d_pct,
    phase2_miss_cost_20d_pct: episode.guard_phase2.average_guarded_forward_return_20d_pct,
    phase3_miss_cost_5d_pct: episode.guard_phase3.average_guarded_forward_return_5d_pct,
    phase3_miss_cost_10d_pct: episode.guard_phase3.average_guarded_forward_return_10d_pct,
    phase3_miss_cost_20d_pct: episode.guard_phase3.average_guarded_forward_return_20d_pct,
    phase6_miss_cost_5d_pct: episode.guard_phase6.average_guarded_forward_return_5d_pct,
    phase6_miss_cost_10d_pct: episode.guard_phase6.average_guarded_forward_return_10d_pct,
    phase6_miss_cost_20d_pct: episode.guard_phase6.average_guarded_forward_return_20d_pct,
  }))
}

function buildTradeBehaviorRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    baseline_total_vmin_trigger_events: episode.baseline.total_vmin_trigger_events,
    phase2_total_vmin_trigger_events: episode.guard_phase2.total_vmin_trigger_events,
    phase3_total_vmin_trigger_events: episode.guard_phase3.total_vmin_trigger_events,
    phase6_total_vmin_trigger_events: episode.guard_phase6.total_vmin_trigger_events,
    baseline_executed_vmin_buys: episode.baseline.executed_vmin_buys,
    phase2_executed_vmin_buys: episode.guard_phase2.executed_vmin_buys,
    phase3_executed_vmin_buys: episode.guard_phase3.executed_vmin_buys,
    phase6_executed_vmin_buys: episode.guard_phase6.executed_vmin_buys,
    phase2_partial_buys_count: episode.guard_phase2.partial_buys_count,
    phase3_partial_buys_count: episode.guard_phase3.partial_buys_count,
    phase6_partial_buys_count: episode.guard_phase6.partial_buys_count,
    phase2_delayed_buys_count: episode.guard_phase2.delayed_buys_count,
    phase3_delayed_buys_count: episode.guard_phase3.delayed_buys_count,
    phase6_delayed_buys_count: episode.guard_phase6.delayed_buys_count,
    phase2_blocked_buys_count: episode.guard_phase2.blocked_buys_count,
    phase3_blocked_buys_count: episode.guard_phase3.blocked_buys_count,
    phase6_blocked_buys_count: episode.guard_phase6.blocked_buys_count,
    phase2_average_delay_bars: episode.guard_phase2.average_delay_bars,
    phase3_average_delay_bars: episode.guard_phase3.average_delay_bars,
    phase6_average_delay_bars: episode.guard_phase6.average_delay_bars,
    phase2_delayed_fill_rate_pct: episode.guard_phase2.delayed_fill_rate_pct,
    phase3_delayed_fill_rate_pct: episode.guard_phase3.delayed_fill_rate_pct,
    phase6_delayed_fill_rate_pct: episode.guard_phase6.delayed_fill_rate_pct,
    phase2_blocked_then_lower_price_reentry_rate_pct: episode.guard_phase2.blocked_then_lower_price_reentry_rate_pct,
    phase3_blocked_then_lower_price_reentry_rate_pct: episode.guard_phase3.blocked_then_lower_price_reentry_rate_pct,
    phase6_blocked_then_lower_price_reentry_rate_pct: episode.guard_phase6.blocked_then_lower_price_reentry_rate_pct,
  }))
}

function buildGuardDiagnosticsRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    phase2_guard_active_days: episode.guard_phase2.guard_active_days,
    phase3_guard_active_days: episode.guard_phase3.guard_active_days,
    phase6_guard_active_days: episode.guard_phase6.guard_active_days,
    phase2_guard_reset_count: episode.guard_phase2.guard_reset_count,
    phase3_guard_reset_count: episode.guard_phase3.guard_reset_count,
    phase6_guard_reset_count: episode.guard_phase6.guard_reset_count,
    phase2_avg_days_to_first_vmin_buy_after_reset: episode.guard_phase2.avg_days_to_first_vmin_buy_after_reset,
    phase3_avg_days_to_first_vmin_buy_after_reset: episode.guard_phase3.avg_days_to_first_vmin_buy_after_reset,
    phase6_avg_days_to_first_vmin_buy_after_reset: episode.guard_phase6.avg_days_to_first_vmin_buy_after_reset,
    phase2_avg_reset_first_buy_10d_return_pct: episode.guard_phase2.avg_reset_first_buy_10d_return_pct,
    phase3_avg_reset_first_buy_10d_return_pct: episode.guard_phase3.avg_reset_first_buy_10d_return_pct,
    phase6_avg_reset_first_buy_10d_return_pct: episode.guard_phase6.avg_reset_first_buy_10d_return_pct,
    phase2_reset_delayed_missed_rebound_cases: episode.guard_phase2.reset_delayed_missed_rebound_cases,
    phase3_reset_delayed_missed_rebound_cases: episode.guard_phase3.reset_delayed_missed_rebound_cases,
    phase6_reset_delayed_missed_rebound_cases: episode.guard_phase6.reset_delayed_missed_rebound_cases,
    phase2_reset_false_positive_rate_pct: episode.guard_phase2.reset_false_positive_rate_pct,
    phase3_reset_false_positive_rate_pct: episode.guard_phase3.reset_false_positive_rate_pct,
    phase6_reset_false_positive_rate_pct: episode.guard_phase6.reset_false_positive_rate_pct,
  }))
}

function buildFastSnapbackOverrideRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    phase6_snapback_candidate_flag_days: episode.guard_phase6.snapback_candidate_flag_days,
    phase6_low_reentry_flag_days: episode.guard_phase6.low_reentry_flag_days,
    phase6_first_buy_override_used_count: episode.guard_phase6.first_buy_override_used_count,
    phase6_override_triggered_count: episode.guard_phase6.override_triggered_count,
  }))
}

function markdownTable(rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return 'No rows.'
  const headers = Object.keys(rows[0])
  const format = (value: string | number | null) => (value == null ? '-' : String(value))
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => format(row[header] as string | number | null)).join(' | ')} |`),
  ]
  return lines.join('\n')
}

function buildReportMarkdown(comparisons: EpisodeComparison[]) {
  const summaryRows = buildEpisodeSummaryRows(comparisons)
  const behaviorRows = buildTradeBehaviorRows(comparisons)
  const diagnosticsRows = buildGuardDiagnosticsRows(comparisons)
  const overrideRows = buildFastSnapbackOverrideRows(comparisons)

  const strongestPhase6PoolRelief = [...summaryRows]
    .sort((left, right) => Number(right.phase6_min_pool_balance_improvement ?? 0) - Number(left.phase6_min_pool_balance_improvement ?? 0))[0]
  const largestPhase6MissCost = [...summaryRows]
    .filter((row) => typeof row.phase6_miss_cost_10d_pct === 'number')
    .sort((left, right) => Number(right.phase6_miss_cost_10d_pct ?? -999) - Number(left.phase6_miss_cost_10d_pct ?? -999))[0]

  return `# VR False-Bottom Guard Phase 6 Report

## Implementation summary
This report compares vFinal playback across four modes:
- Baseline: false-bottom guard disabled
- Guard Phase 2: staged reset-release before fast-rebound tuning
- Guard Phase 3: current staged reset-release with fast-snapback tuning
- Guard Phase 6: selective one-shot first-buy override layered on top of existing guard + reset behavior

The underlying buy conditions, Vmin ladder levels, MA200 mop-up, MSS inputs, and Track/Crisis logic are unchanged. The comparison isolates guard release timing only.

## Validation method
- Engine: \`build_execution_playback.ts\` vFinal scenario playback
- Cap setting: \`${INITIAL_CAP}%\`
- Modes:
  - Baseline: false-bottom guard disabled
  - Guard Phase 2: reset release without fast snapback tuning
  - Guard Phase 3: current release tuning with persistence + fast snapback recognition
  - Guard Phase 6: Phase 3 plus selective first-buy override under snapback + low reentry conditions
- Near-zero pool threshold: ${POOL_NEAR_ZERO_THRESHOLD_PCT * 100}% of starting pool cash
- Reset missed-rebound rule: +${RESET_REBOUND_THRESHOLD * 100}% within 5 bars with no Vmin buy inside ${RESET_BUY_WINDOW_BARS} bars after reset-ready activation
- Reset false-positive rule: lower low of at least ${RESET_FALSE_POSITIVE_DROP_THRESHOLD * 100}% inside ${RESET_FALSE_POSITIVE_WINDOW_BARS} bars after reset-ready activation

## Episode comparison tables
### Episode summary
${markdownTable(summaryRows.map((row) => ({
    event: row.event_label as string,
    baseline_final: row.baseline_final_value as number,
    phase2_final: row.phase2_final_value as number,
    phase3_final: row.phase3_final_value as number,
    phase6_final: row.phase6_final_value as number,
    phase2_delta: row.phase2_final_value_delta as number,
    phase3_delta: row.phase3_final_value_delta as number,
    phase6_delta: row.phase6_final_value_delta as number,
    baseline_dd: row.baseline_max_drawdown_pct as number,
    phase2_dd: row.phase2_max_drawdown_pct as number,
    phase3_dd: row.phase3_max_drawdown_pct as number,
    phase6_dd: row.phase6_max_drawdown_pct as number,
    baseline_min_pool: row.baseline_min_pool_balance as number,
    phase2_min_pool: row.phase2_min_pool_balance as number,
    phase3_min_pool: row.phase3_min_pool_balance as number,
    phase6_min_pool: row.phase6_min_pool_balance as number,
    phase2_pool_relief: row.phase2_min_pool_balance_improvement as number,
    phase3_pool_relief: row.phase3_min_pool_balance_improvement as number,
    phase6_pool_relief: row.phase6_min_pool_balance_improvement as number,
    baseline_near_zero_days: row.baseline_pool_near_zero_days as number,
    phase2_near_zero_days: row.phase2_pool_near_zero_days as number,
    phase3_near_zero_days: row.phase3_pool_near_zero_days as number,
    phase6_near_zero_days: row.phase6_pool_near_zero_days as number,
  })))}

### Trade behavior
${markdownTable(behaviorRows.map((row) => ({
    event: row.event_label as string,
    baseline_exec: row.baseline_executed_vmin_buys as number,
    phase2_exec: row.phase2_executed_vmin_buys as number,
    phase3_exec: row.phase3_executed_vmin_buys as number,
    phase6_exec: row.phase6_executed_vmin_buys as number,
    phase2_partial: row.phase2_partial_buys_count as number,
    phase3_partial: row.phase3_partial_buys_count as number,
    phase6_partial: row.phase6_partial_buys_count as number,
    phase2_delayed: row.phase2_delayed_buys_count as number,
    phase3_delayed: row.phase3_delayed_buys_count as number,
    phase6_delayed: row.phase6_delayed_buys_count as number,
    phase2_blocked: row.phase2_blocked_buys_count as number,
    phase3_blocked: row.phase3_blocked_buys_count as number,
    phase6_blocked: row.phase6_blocked_buys_count as number,
    phase2_avg_delay_bars: row.phase2_average_delay_bars as number | null,
    phase3_avg_delay_bars: row.phase3_average_delay_bars as number | null,
    phase6_avg_delay_bars: row.phase6_average_delay_bars as number | null,
  })))}

### Reset / rebound diagnostics
${markdownTable(diagnosticsRows.map((row) => ({
    event: row.event_label as string,
    phase2_guard_active_days: row.phase2_guard_active_days as number,
    phase3_guard_active_days: row.phase3_guard_active_days as number,
    phase6_guard_active_days: row.phase6_guard_active_days as number,
    phase2_resets: row.phase2_guard_reset_count as number,
    phase3_resets: row.phase3_guard_reset_count as number,
    phase6_resets: row.phase6_guard_reset_count as number,
    phase2_avg_days_to_first_buy_after_reset: row.phase2_avg_days_to_first_vmin_buy_after_reset as number | null,
    phase3_avg_days_to_first_buy_after_reset: row.phase3_avg_days_to_first_vmin_buy_after_reset as number | null,
    phase6_avg_days_to_first_buy_after_reset: row.phase6_avg_days_to_first_vmin_buy_after_reset as number | null,
    phase2_reset_missed_rebound_cases: row.phase2_reset_delayed_missed_rebound_cases as number,
    phase3_reset_missed_rebound_cases: row.phase3_reset_delayed_missed_rebound_cases as number,
    phase6_reset_missed_rebound_cases: row.phase6_reset_delayed_missed_rebound_cases as number,
    phase2_reset_false_positive_rate_pct: row.phase2_reset_false_positive_rate_pct as number | null,
    phase3_reset_false_positive_rate_pct: row.phase3_reset_false_positive_rate_pct as number | null,
    phase6_reset_false_positive_rate_pct: row.phase6_reset_false_positive_rate_pct as number | null,
  })))}

### Override diagnostics
${markdownTable(overrideRows.map((row) => ({
    event: row.event_label as string,
    phase6_snapback_candidate_flag_days: row.phase6_snapback_candidate_flag_days as number,
    phase6_low_reentry_flag_days: row.phase6_low_reentry_flag_days as number,
    phase6_first_buy_override_used_count: row.phase6_first_buy_override_used_count as number,
    phase6_override_triggered_count: row.phase6_override_triggered_count as number,
  })))}

### 2025 episode note
${markdownTable(summaryRows
  .filter((row) => String(row.event_id).startsWith('2025'))
  .map((row) => ({
    event: row.event_label as string,
    baseline_final: row.baseline_final_value as number,
    phase2_final: row.phase2_final_value as number,
    phase3_final: row.phase3_final_value as number,
    phase6_final: row.phase6_final_value as number,
    phase2_miss_cost_10d_pct: row.phase2_miss_cost_10d_pct as number | null,
    phase3_miss_cost_10d_pct: row.phase3_miss_cost_10d_pct as number | null,
    phase6_miss_cost_10d_pct: row.phase6_miss_cost_10d_pct as number | null,
    phase2_reset_false_positive_rate_pct: diagnosticsRows.find((item) => item.event_id === row.event_id)?.phase2_reset_false_positive_rate_pct as number | null,
    phase3_reset_false_positive_rate_pct: diagnosticsRows.find((item) => item.event_id === row.event_id)?.phase3_reset_false_positive_rate_pct as number | null,
    phase6_reset_false_positive_rate_pct: diagnosticsRows.find((item) => item.event_id === row.event_id)?.phase6_reset_false_positive_rate_pct as number | null,
  })))}

## Key findings
- Largest Phase 6 pool relief: ${strongestPhase6PoolRelief ? `${strongestPhase6PoolRelief.event_label} (${strongestPhase6PoolRelief.phase6_min_pool_balance_improvement} improvement in minimum pool balance)` : 'Not available'}
- Largest Phase 6 miss cost (10d average from blocked/delayed signals): ${largestPhase6MissCost ? `${largestPhase6MissCost.event_label} (${largestPhase6MissCost.phase6_miss_cost_10d_pct}%)` : 'Not available'}
- Guard miss-cost metrics are shown as forward returns after blocked or delayed Vmin signals. Positive values mean waiting missed some rebound; negative values mean waiting avoided further downside.

## Recommended next step
Use this report to decide whether a further release-tuning pass should only adjust:
- snapback candidate specificity
- low reentry gating sensitivity
- first-buy privilege timing

No engine change is recommended from this report alone.

## Known limitations
- This pass measures replayed execution timing only. It does not retune the guard.
- Miss-cost uses forward asset returns after blocked/delayed trigger dates, not a counterfactual optimized fill model.
- Reset quality uses a simple missed-rebound rule for auditability.
`
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const standardArchive = readJson<RawStandardPlaybackArchive>('risk_v1_playback.json')
  const survivalArchive = readJson<RawVRSurvivalPlaybackArchive>('vr_survival_playback.json')
  const rootDir = process.cwd()
  const playbackView = buildVRPlaybackView({
    standardArchive,
    survivalArchive,
    rootDir,
  })

  const missingRequired = findMissingRequired(playbackView)
  if (missingRequired.length > 0 || !playbackView) {
    throw new Error(`Missing required playback events: ${missingRequired.join(', ')}`)
  }

  const comparisons = buildEpisodeComparisons(playbackView)
  const summaryRows = buildEpisodeSummaryRows(comparisons)
  const behaviorRows = buildTradeBehaviorRows(comparisons)
  const diagnosticsRows = buildGuardDiagnosticsRows(comparisons)
  const overrideRows = buildFastSnapbackOverrideRows(comparisons)
  const phase2GuardSignals = comparisons.flatMap((episode) =>
    episode.guard_phase2.guard_signal_events.map((row) => ({
      mode: 'guard_phase2',
      ...row,
    })),
  )
  const phase3GuardSignals = comparisons.flatMap((episode) =>
    episode.guard_phase3.guard_signal_events.map((row) => ({
      mode: 'guard_phase3',
      ...row,
    })),
  )
  const phase6GuardSignals = comparisons.flatMap((episode) =>
    episode.guard_phase6.guard_signal_events.map((row) => ({
      mode: 'guard_phase6',
      ...row,
    })),
  )
  const guardSignals = [...phase2GuardSignals, ...phase3GuardSignals, ...phase6GuardSignals]
  const phase2GuardTimelineRows = comparisons.flatMap((episode) =>
    episode.guard_phase2.guard_timeline.map((row) => ({
      event_id: episode.event_id,
      event_label: episode.event_label,
      mode: 'guard_phase2',
      ...row,
    })),
  )
  const phase3GuardTimelineRows = comparisons.flatMap((episode) =>
    episode.guard_phase3.guard_timeline.map((row) => ({
      event_id: episode.event_id,
      event_label: episode.event_label,
      mode: 'guard_phase3',
      ...row,
    })),
  )
  const phase6GuardTimelineRows = comparisons.flatMap((episode) =>
    episode.guard_phase6.guard_timeline.map((row) => ({
      event_id: episode.event_id,
      event_label: episode.event_label,
      mode: 'guard_phase6',
      ...row,
    })),
  )
  const guardTimelineRows = [...phase2GuardTimelineRows, ...phase3GuardTimelineRows, ...phase6GuardTimelineRows]

  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.json'), JSON.stringify(summaryRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.csv'), toCsv(summaryRows))
  writeFileSync(join(OUTPUT_DIR, 'trade_behavior_summary.json'), JSON.stringify(behaviorRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'trade_behavior_summary.csv'), toCsv(behaviorRows))
  writeFileSync(join(OUTPUT_DIR, 'false_bottom_guard_diagnostics.json'), JSON.stringify(diagnosticsRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'false_bottom_guard_diagnostics.csv'), toCsv(diagnosticsRows))
  writeFileSync(join(OUTPUT_DIR, 'fast_snapback_override_diagnostics.json'), JSON.stringify(overrideRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'fast_snapback_override_diagnostics.csv'), toCsv(overrideRows))
  writeFileSync(join(OUTPUT_DIR, 'guard_signal_events.json'), JSON.stringify(guardSignals, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'guard_signal_events.csv'), toCsv(guardSignals))
  writeFileSync(join(OUTPUT_DIR, 'guard_activation_timeline.json'), JSON.stringify(guardTimelineRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'guard_activation_timeline.csv'), toCsv(guardTimelineRows))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_full.json'), JSON.stringify(comparisons, null, 2))
  writeFileSync(REPORT_PATH, buildReportMarkdown(comparisons))

  console.log(`[false-bottom-guard] wrote ${join(OUTPUT_DIR, 'episode_comparison_summary.csv')}`)
  console.log(`[false-bottom-guard] wrote ${join(OUTPUT_DIR, 'trade_behavior_summary.csv')}`)
  console.log(`[false-bottom-guard] wrote ${join(OUTPUT_DIR, 'false_bottom_guard_diagnostics.csv')}`)
  console.log(`[false-bottom-guard] wrote ${join(OUTPUT_DIR, 'fast_snapback_override_diagnostics.csv')}`)
  console.log(`[false-bottom-guard] wrote ${REPORT_PATH}`)
}

main()
