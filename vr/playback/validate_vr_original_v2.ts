import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  buildVRPlaybackView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
  type VRPlaybackEventView,
} from './vr_playback_loader'
import { buildExecutionPlayback } from './build_execution_playback'
import type { ExecutionPlaybackVariant, ExplainableVRReasonCode, ExplainableVRState } from '../types/execution_playback'

// =============================================================================
// validate_vr_original_v2.ts  (v1.3 snapback window metrics 추가)
//
// 5-way comparison: original | vfinal | explainable_vr_v1(v1.3) | explainable_vr_v1_5(v1.5) | vr_original_v2
// + snapback window metrics per episode/engine
// =============================================================================

type EpisodeSpec = { eventId: string; label: string; required: boolean }

type VariantAnalysis = {
  label: 'original' | 'vfinal' | 'explainable_v1' | 'explainable_v1_5' | 'vr_original_v2'
  engine_id: ExecutionPlaybackVariant['engine_id']
  engine_label: string
  final_value: number
  period_return_pct: number
  max_drawdown_pct: number
  recovery_days: number | null
  avg_event_exposure_pct: number | null
  buy_count: number
  sell_count: number
  defense_count: number
  pool_remaining_final: number
  pool_used_pct: number
  cumulative_pool_spent: number
  first_vmin_buy_bar: number | null
  first_vmin_buy_date: string | null
  state_days: Record<ExplainableVRState, number>
  reason_counts: Partial<Record<ExplainableVRReasonCode, number>>
}

type SnapbackWindowMetrics = {
  engine_label: string
  snapback_window_start_bar: number | null
  snapback_window_end_bar: number | null
  snapback_window_days: number | null
  snapback_avg_exposure: number | null
  snapback_max_exposure: number | null
  snapback_total_deploy: number
  snapback_buy_count: number
  first_snapback_buy_bar: number | null
  snapback_capture_score: number
}

type EpisodeComparison = {
  event_id: string
  event_label: string
  start: string
  end: string
  original: VariantAnalysis
  vfinal: VariantAnalysis
  explainable_v1: VariantAnalysis
  explainable_v1_5: VariantAnalysis
  vr_original_v2: VariantAnalysis
  snapback: {
    original: SnapbackWindowMetrics
    explainable_v1: SnapbackWindowMetrics
    explainable_v1_5: SnapbackWindowMetrics
    vr_original_v2: SnapbackWindowMetrics
  }
}

const TARGET_EPISODES: EpisodeSpec[] = [
  { eventId: '2011-06', label: '2011 Debt Ceiling', required: true },
  { eventId: '2020-02', label: '2020 Covid Crash', required: true },
  { eventId: '2021-12', label: '2022 Fed Bear', required: true },
  { eventId: '2025-01', label: '2025 Tariff Shock', required: false },
]

const OUTPUT_DIR = join(process.cwd(), 'vr_backtest', 'results', 'vr_original_v2')
const REPORT_PATH = join(process.cwd(), 'docs', 'vr_original_v2_report.md')
const CAP = '50' as const

function readJson<T>(filename: string): T {
  const base = join(process.cwd(), 'marketflow', 'backend', 'output')
  return JSON.parse(readFileSync(join(base, filename), 'utf-8')) as T
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function average(values: Array<number | null>) {
  const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!valid.length) return null
  return round(valid.reduce((a, b) => a + b, 0) / valid.length, 2)
}

function toCsv(rows: Array<Record<string, string | number | boolean | null | undefined>>) {
  if (!rows.length) return ''
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  const escape = (v: string | number | boolean | null | undefined) => {
    if (v == null) return ''
    const t = String(v)
    return t.includes(',') || t.includes('"') || t.includes('\n') ? `"${t.replace(/"/g, '""')}"` : t
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n') + '\n'
}

function markdownTable(rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return 'No rows.'
  const headers = Object.keys(rows[0])
  const fmt = (v: string | number | null) => (v == null ? '-' : String(v))
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${headers.map((h) => fmt(r[h] as string | number | null)).join(' | ')} |`),
  ].join('\n')
}

function computePortfolioStats(portfolioValues: number[]) {
  let peak = portfolioValues[0] ?? 0
  let troughIndex = 0
  let maxDrawdown = 0
  for (let i = 0; i < portfolioValues.length; i++) {
    const v = portfolioValues[i] ?? 0
    if (v > peak) peak = v
    const dd = peak > 0 ? (v / peak) - 1 : 0
    if (dd < maxDrawdown) { maxDrawdown = dd; troughIndex = i }
  }
  const target = portfolioValues[0] ? portfolioValues[0] * 0.95 : null
  let recoveryDays: number | null = null
  if (target != null) {
    for (let i = troughIndex; i < portfolioValues.length; i++) {
      if (portfolioValues[i] >= target) { recoveryDays = i - troughIndex; break }
    }
  }
  return { max_drawdown_pct: round(maxDrawdown * 100, 2), recovery_days: recoveryDays }
}

// =============================================================================
// SNAPBACK WINDOW COMPUTATION (Work Order §2)
// Window start: event low bar OR first bar where rebound_from_low >= 0.05
// Window end:   rebound >= 0.15 OR start+20bars OR price >= ma200
// =============================================================================
function computeSnapbackWindow(
  variant: ExecutionPlaybackVariant,
  chartData: VRPlaybackEventView['chart_data'],
): { startBar: number | null; endBar: number | null } {
  const eventPoints = variant.points.filter((p) => p.in_event)
  if (!eventPoints.length) return { startBar: null, endBar: null }

  // Find event low bar
  let eventLowBar = 0
  let eventLowPrice = Infinity
  for (let i = 0; i < eventPoints.length; i++) {
    if (eventPoints[i].asset_price < eventLowPrice) {
      eventLowPrice = eventPoints[i].asset_price
      eventLowBar = i
    }
  }

  // Find first bar where rebound_from_low >= 0.05 (from chart_data)
  // rebound_from_low approximated from variant points (price / lowest price so far - 1)
  let runningLow = eventPoints[0]?.asset_price ?? Infinity
  let firstReboundBar: number | null = null
  for (let i = 0; i < eventPoints.length; i++) {
    const price = eventPoints[i].asset_price
    if (price < runningLow) runningLow = price
    if (runningLow > 0 && (price / runningLow) - 1 >= 0.05 && firstReboundBar == null) {
      firstReboundBar = i
    }
  }

  const windowStart = Math.min(eventLowBar, firstReboundBar ?? eventLowBar)

  // Window end: rebound >= 0.15 OR start+20 OR price >= ma200
  let windowEnd: number | null = null
  const ma200Baseline = chartData.find((p, i) => i > 0 && typeof p.ma200_n === 'number')?.ma200_n ?? null
  const basePrice = eventPoints[0]?.asset_price ?? 1

  for (let i = windowStart + 1; i < eventPoints.length; i++) {
    const price = eventPoints[i].asset_price
    const rebound = eventLowPrice > 0 ? (price / eventLowPrice) - 1 : 0
    const approxMa200 = ma200Baseline  // rough proxy
    const aboveMa200 = approxMa200 != null && price >= approxMa200 * (basePrice / 100)
    if (rebound >= 0.15 || (i - windowStart) >= 20 || aboveMa200) {
      windowEnd = i
      break
    }
  }
  if (windowEnd == null) windowEnd = Math.min(windowStart + 20, eventPoints.length - 1)

  return { startBar: windowStart, endBar: windowEnd }
}

function computeSnapbackMetrics(
  variant: ExecutionPlaybackVariant,
  chartData: VRPlaybackEventView['chart_data'],
): SnapbackWindowMetrics {
  const ep = variant.points.filter((p) => p.in_event)
  const { startBar, endBar } = computeSnapbackWindow(variant, chartData)
  const empty: SnapbackWindowMetrics = {
    engine_label: variant.engine_label,
    snapback_window_start_bar: null,
    snapback_window_end_bar: null,
    snapback_window_days: null,
    snapback_avg_exposure: null,
    snapback_max_exposure: null,
    snapback_total_deploy: 0,
    snapback_buy_count: 0,
    first_snapback_buy_bar: null,
    snapback_capture_score: 0,
  }
  if (startBar == null || endBar == null || !ep.length) return empty

  const windowPoints = ep.slice(startBar, endBar + 1)
  if (!windowPoints.length) return empty

  const exposures = windowPoints.map((p) =>
    p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : 0
  )
  const snapbackAvgExposure = average(exposures) ?? 0
  const snapbackMaxExposure = Math.max(...exposures)

  // pool deployed in window = difference between pool_cash at start and end
  const poolAtStart = windowPoints[0].pool_cash_before_trade
  const poolAtEnd = windowPoints[windowPoints.length - 1].pool_cash_after_trade
  const snapbackTotalDeploy = round(Math.max(0, poolAtStart - poolAtEnd), 2)

  // buys executed in window
  const snapbackBuys = windowPoints.filter((p) => p.state_after_trade === 'buy_executed')
  const firstBuyInWindow = windowPoints.findIndex((p) => p.state_after_trade === 'buy_executed')

  // -----------------------------------------------------------------------
  // SNAPBACK CAPTURE SCORE (Work Order §4)
  // Simple deterministic score — comparative only, not absolute
  // -----------------------------------------------------------------------
  const maxPossibleExposure = 100
  const maxPossibleDeploy = ep[0]?.pool_cash_before_trade ?? 1
  const normalizedExposure = Math.min(snapbackAvgExposure / maxPossibleExposure, 1)
  const normalizedDeploy = maxPossibleDeploy > 0 ? Math.min(snapbackTotalDeploy / maxPossibleDeploy, 1) : 0
  const windowDays = endBar - startBar + 1
  const earlyEntryBonus = firstBuyInWindow >= 0 && windowDays > 0
    ? Math.max(0, 1 - firstBuyInWindow / windowDays)
    : 0
  const snapbackBuyPresence = snapbackBuys.length > 0 ? 1 : 0

  const captureScore = round(
    0.4 * normalizedExposure +
    0.3 * normalizedDeploy +
    0.2 * earlyEntryBonus +
    0.1 * snapbackBuyPresence,
    3
  )

  return {
    engine_label: variant.engine_label,
    snapback_window_start_bar: startBar + 1,  // 1-indexed for display
    snapback_window_end_bar: endBar + 1,
    snapback_window_days: endBar - startBar + 1,
    snapback_avg_exposure: round(snapbackAvgExposure, 2),
    snapback_max_exposure: round(snapbackMaxExposure, 2),
    snapback_total_deploy: snapbackTotalDeploy,
    snapback_buy_count: snapbackBuys.length,
    first_snapback_buy_bar: firstBuyInWindow >= 0 ? startBar + firstBuyInWindow + 1 : null,
    snapback_capture_score: captureScore,
  }
}

function analyzeVariant(
  event: VRPlaybackEventView,
  variant: ExecutionPlaybackVariant,
  label: VariantAnalysis['label'],
): VariantAnalysis {
  const eventPoints = variant.points.filter((p) => p.in_event)
  const series = eventPoints.length > 0 ? eventPoints : variant.points
  const initialValue = series[0]?.portfolio_value ?? 0
  const finalValue = series[series.length - 1]?.portfolio_value ?? 0
  const { max_drawdown_pct, recovery_days } = computePortfolioStats(series.map((p) => p.portfolio_value))
  const avgEventExposurePct = average(
    series.map((p) => p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : null)
  )
  const stateDays = series.reduce<Record<ExplainableVRState, number>>(
    (acc, p) => { if (p.explainable_state) acc[p.explainable_state] += 1; return acc },
    { NORMAL: 0, WARNING: 0, RISK_OFF: 0, BOTTOM_WATCH: 0, RE_ENTRY: 0 }
  )
  const reasonCounts = series.reduce<Partial<Record<ExplainableVRReasonCode, number>>>((acc, p) => {
    if (p.explainable_reason_code) acc[p.explainable_reason_code] = (acc[p.explainable_reason_code] ?? 0) + 1
    return acc
  }, {})
  const firstBuyIndex = series.findIndex((p) => p.state_after_trade === 'buy_executed')
  const poolSummary = variant.pool_usage_summary
  return {
    label, engine_id: variant.engine_id, engine_label: variant.engine_label,
    final_value: round(finalValue, 2),
    period_return_pct: initialValue > 0 ? round(((finalValue / initialValue) - 1) * 100, 2) : 0,
    max_drawdown_pct, recovery_days,
    avg_event_exposure_pct: avgEventExposurePct,
    buy_count: variant.buy_markers.length,
    sell_count: variant.sell_markers.length,
    defense_count: variant.defense_markers.length,
    pool_remaining_final: poolSummary.pool_cash_remaining,
    pool_used_pct: round(poolSummary.initial_pool_cash > 0 ? (poolSummary.cumulative_pool_spent / poolSummary.initial_pool_cash) * 100 : 0, 2),
    cumulative_pool_spent: round(poolSummary.cumulative_pool_spent, 2),
    first_vmin_buy_bar: firstBuyIndex >= 0 ? firstBuyIndex + 1 : null,
    first_vmin_buy_date: firstBuyIndex >= 0 ? series[firstBuyIndex]?.date ?? null : null,
    state_days: stateDays, reason_counts: reasonCounts,
  }
}

function buildEpisodeComparisons(view: NonNullable<ReturnType<typeof buildVRPlaybackView>>) {
  return TARGET_EPISODES
    .map((spec) => {
      const event = view.events.find((e) => e.event_id === spec.eventId)
      if (!event) return null
      const original = event.execution_playback.original_vr
      const vfinal = buildExecutionPlayback(event, CAP, { scenarioEngine: 'vfinal' }).variants[CAP]
      const explainable = buildExecutionPlayback(event, CAP, { scenarioEngine: 'explainable_vr_v1', enableMacroGating: false }).variants[CAP]
      const explainable15 = buildExecutionPlayback(event, CAP, { scenarioEngine: 'explainable_vr_v1' }).variants[CAP]
      const vrOriginalV2 = buildExecutionPlayback(event, CAP, { scenarioEngine: 'vr_original_v2' }).variants[CAP]
      if (!vfinal || !explainable || !explainable15 || !vrOriginalV2) return null
      return {
        event_id: spec.eventId,
        event_label: spec.label,
        start: event.start,
        end: event.end,
        original: analyzeVariant(event, original, 'original'),
        vfinal: analyzeVariant(event, vfinal, 'vfinal'),
        explainable_v1: analyzeVariant(event, explainable, 'explainable_v1'),
        explainable_v1_5: analyzeVariant(event, explainable15, 'explainable_v1_5'),
        vr_original_v2: analyzeVariant(event, vrOriginalV2, 'vr_original_v2'),
        snapback: {
          original: computeSnapbackMetrics(original, event.chart_data),
          explainable_v1: computeSnapbackMetrics(explainable, event.chart_data),
          explainable_v1_5: computeSnapbackMetrics(explainable15, event.chart_data),
          vr_original_v2: computeSnapbackMetrics(vrOriginalV2, event.chart_data),
        },
      } satisfies EpisodeComparison
    })
    .filter((x): x is EpisodeComparison => x != null)
}

function buildSummaryRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((ep) => ({
    event_id: ep.event_id,
    event_label: ep.event_label,
    original_final_value: ep.original.final_value,
    vfinal_final_value: ep.vfinal.final_value,
    explainable_final_value: ep.explainable_v1.final_value,
    explainable_v1_5_final_value: ep.explainable_v1_5.final_value,
    vr_original_v2_final_value: ep.vr_original_v2.final_value,
    vr_v2_vs_original: round(ep.vr_original_v2.final_value - ep.original.final_value, 2),
    v15_vs_v13: round(ep.explainable_v1_5.final_value - ep.explainable_v1.final_value, 2),
    v15_vs_v2: round(ep.explainable_v1_5.final_value - ep.vr_original_v2.final_value, 2),
    explainable_max_dd: ep.explainable_v1.max_drawdown_pct,
    explainable_v1_5_max_dd: ep.explainable_v1_5.max_drawdown_pct,
    vr_v2_max_dd: ep.vr_original_v2.max_drawdown_pct,
    explainable_avg_exposure: ep.explainable_v1.avg_event_exposure_pct,
    explainable_v1_5_avg_exposure: ep.explainable_v1_5.avg_event_exposure_pct,
    vr_v2_avg_exposure: ep.vr_original_v2.avg_event_exposure_pct,
    explainable_buy_count: ep.explainable_v1.buy_count,
    explainable_v1_5_buy_count: ep.explainable_v1_5.buy_count,
    vr_v2_buy_count: ep.vr_original_v2.buy_count,
    explainable_pool_used_pct: ep.explainable_v1.pool_used_pct,
    explainable_v1_5_pool_used_pct: ep.explainable_v1_5.pool_used_pct,
    vr_v2_pool_used_pct: ep.vr_original_v2.pool_used_pct,
    vr_v2_defense_count: ep.vr_original_v2.defense_count,
    // v1.3 snapback window
    expl_snap_window_days: ep.snapback.explainable_v1.snapback_window_days,
    expl_snap_avg_exposure: ep.snapback.explainable_v1.snapback_avg_exposure,
    expl_snap_total_deploy: ep.snapback.explainable_v1.snapback_total_deploy,
    expl_snap_buy_count: ep.snapback.explainable_v1.snapback_buy_count,
    expl_snap_first_buy_bar: ep.snapback.explainable_v1.first_snapback_buy_bar,
    expl_snap_capture_score: ep.snapback.explainable_v1.snapback_capture_score,
    v15_snap_window_days: ep.snapback.explainable_v1_5.snapback_window_days,
    v15_snap_avg_exposure: ep.snapback.explainable_v1_5.snapback_avg_exposure,
    v15_snap_total_deploy: ep.snapback.explainable_v1_5.snapback_total_deploy,
    v15_snap_buy_count: ep.snapback.explainable_v1_5.snapback_buy_count,
    v15_snap_first_buy_bar: ep.snapback.explainable_v1_5.first_snapback_buy_bar,
    v15_snap_capture_score: ep.snapback.explainable_v1_5.snapback_capture_score,
    v2_snap_window_days: ep.snapback.vr_original_v2.snapback_window_days,
    v2_snap_avg_exposure: ep.snapback.vr_original_v2.snapback_avg_exposure,
    v2_snap_total_deploy: ep.snapback.vr_original_v2.snapback_total_deploy,
    v2_snap_buy_count: ep.snapback.vr_original_v2.snapback_buy_count,
    v2_snap_first_buy_bar: ep.snapback.vr_original_v2.first_snapback_buy_bar,
    v2_snap_capture_score: ep.snapback.vr_original_v2.snapback_capture_score,
  }))
}

function buildReportMarkdown(comparisons: EpisodeComparison[]) {
  const summaryRows = buildSummaryRows(comparisons)

  // Decision logic per episode (Work Order §12)
  const decisions = comparisons.map((ep) => {
    const expl = ep.explainable_v1
    const v2 = ep.vr_original_v2
    const snapExpl = ep.snapback.explainable_v1
    const safety2022 = ep.event_id === '2021-12' ? (expl.final_value >= 15000 && expl.avg_event_exposure_pct != null && expl.avg_event_exposure_pct <= 20) : true
    const snapImproved = snapExpl.snapback_capture_score >= 0.3
    const ddOk = expl.max_drawdown_pct >= -65  // 2020 DD not too bad
    const adopted = snapImproved && safety2022 && ddOk
    return {
      episode: ep.event_label,
      v1_3_final: expl.final_value,
      v1_3_snap_score: snapExpl.snapback_capture_score,
      v1_3_avg_exposure: expl.avg_event_exposure_pct,
      v1_3_max_dd: expl.max_drawdown_pct,
      decision: adopted ? 'ADOPTED ✅' : 'REJECTED ❌',
      reason: adopted
        ? 'snapback capture score OK + 2022 safety intact'
        : `${!snapImproved ? 'snapback score too low ' : ''}${!safety2022 ? '2022 safety fail ' : ''}${!ddOk ? 'DD too bad' : ''}`,
    }
  })

  return `# VR Engine Report — v1.3 Snapback Capture Optimization

## A. Episode Summary (4-way)

${markdownTable(summaryRows.map((r) => ({
    episode: r.event_label,
    orig_final: r.original_final_value,
    expl_final: r.explainable_final_value,
    v2_final: r.vr_original_v2_final_value,
    expl_dd: r.explainable_max_dd,
    v2_dd: r.vr_v2_max_dd,
    expl_avg_exp: r.explainable_avg_exposure,
    expl_buys: r.explainable_buy_count,
  })))}

## B. Snapback Window Comparison

${markdownTable(comparisons.flatMap((ep) => [
    {
      episode: ep.event_label,
      engine: 'explainable_v1.3',
      window_days: ep.snapback.explainable_v1.snapback_window_days,
      snap_avg_exp: ep.snapback.explainable_v1.snapback_avg_exposure,
      snap_total_deploy: ep.snapback.explainable_v1.snapback_total_deploy,
      snap_buys: ep.snapback.explainable_v1.snapback_buy_count,
      first_buy_bar: ep.snapback.explainable_v1.first_snapback_buy_bar,
      capture_score: ep.snapback.explainable_v1.snapback_capture_score,
    },
    {
      episode: ep.event_label,
      engine: 'vr_original_v2',
      window_days: ep.snapback.vr_original_v2.snapback_window_days,
      snap_avg_exp: ep.snapback.vr_original_v2.snapback_avg_exposure,
      snap_total_deploy: ep.snapback.vr_original_v2.snapback_total_deploy,
      snap_buys: ep.snapback.vr_original_v2.snapback_buy_count,
      first_buy_bar: ep.snapback.vr_original_v2.first_snapback_buy_bar,
      capture_score: ep.snapback.vr_original_v2.snapback_capture_score,
    },
  ]))}

## C. Decision Summary

${markdownTable(decisions)}

---
*engine_id=vr_original_v2 is FROZEN. DO NOT MODIFY.*
`
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const standardArchive = readJson<RawStandardPlaybackArchive>('risk_v1_playback.json')
  const survivalArchive = readJson<RawVRSurvivalPlaybackArchive>('vr_survival_playback.json')
  const playbackView = buildVRPlaybackView({ standardArchive, survivalArchive, rootDir: process.cwd() })

  if (!playbackView || TARGET_EPISODES.filter((e) => e.required).some((e) => !playbackView.events.find((ev) => ev.event_id === e.eventId))) {
    throw new Error('Missing required playback events')
  }

  const comparisons = buildEpisodeComparisons(playbackView)
  const summaryRows = buildSummaryRows(comparisons)

  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.json'), JSON.stringify(summaryRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.csv'), toCsv(summaryRows))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_full.json'), JSON.stringify(comparisons, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'snapback_window.csv'), toCsv(
    comparisons.flatMap((ep) => [
      { event: ep.event_label, engine: 'explainable_v1.3', ...ep.snapback.explainable_v1 },
      { event: ep.event_label, engine: 'explainable_v1.5', ...ep.snapback.explainable_v1_5 },
      { event: ep.event_label, engine: 'vr_original_v2', ...ep.snapback.vr_original_v2 },
    ])
  ))
  writeFileSync(REPORT_PATH, buildReportMarkdown(comparisons))

  console.log(`[v1.5] wrote ${OUTPUT_DIR}`)
  console.log(`[v1.5] episodes: ${comparisons.length}`)

  for (const ep of comparisons) {
    const expl = ep.explainable_v1
    const expl15 = ep.explainable_v1_5
    const snap = ep.snapback.explainable_v1
    const snap15 = ep.snapback.explainable_v1_5
    const v2snap = ep.snapback.vr_original_v2
    console.log(`
  [${ep.event_id}] ${ep.event_label}`)
    console.log(`    explainable v1.3 : final=${expl.final_value}  buys=${expl.buy_count}  avg_exp=${expl.avg_event_exposure_pct}%  dd=${expl.max_drawdown_pct}%`)
    console.log(`    explainable v1.5 : final=${expl15.final_value}  buys=${expl15.buy_count}  avg_exp=${expl15.avg_event_exposure_pct}%  dd=${expl15.max_drawdown_pct}%  delta=${Math.round((expl15.final_value - expl.final_value) * 100) / 100}`)
    console.log(`    snap v1.3        : days=${snap.snapback_window_days}  avg_exp=${snap.snapback_avg_exposure}%  deploy=${snap.snapback_total_deploy}  buys=${snap.snapback_buy_count}  SCORE=${snap.snapback_capture_score}`)
    console.log(`    snap v1.5        : days=${snap15.snapback_window_days}  avg_exp=${snap15.snapback_avg_exposure}%  deploy=${snap15.snapback_total_deploy}  buys=${snap15.snapback_buy_count}  SCORE=${snap15.snapback_capture_score}`)
    console.log(`    vr_v2 snapback   : days=${v2snap.snapback_window_days}  avg_exp=${v2snap.snapback_avg_exposure}%  deploy=${v2snap.snapback_total_deploy}  buys=${v2snap.snapback_buy_count}  SCORE=${v2snap.snapback_capture_score}`)
    if (ep.event_id === '2021-12' && expl15.avg_event_exposure_pct != null && expl15.avg_event_exposure_pct > 20) {
      console.error(`  [!] 2022 v1.5 avg_exposure=${expl15.avg_event_exposure_pct}% > 20% -- SAFETY VIOLATION`)
    }
    if (ep.event_id === '2021-12' && expl15.final_value < 15000) {
      console.error(`  [!] 2022 v1.5 final_value=${expl15.final_value} < 15000 -- SAFETY VIOLATION`)
    }
    if (ep.event_id === '2020-02' && expl15.max_drawdown_pct < -65) {
      console.error(`  [!] 2020 v1.5 DD=${expl15.max_drawdown_pct}% worse than threshold -- SAFETY VIOLATION`)
    }
  }
}
main()
