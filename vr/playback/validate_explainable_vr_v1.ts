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

type EpisodeSpec = {
  eventId: string
  label: string
  required: boolean
}

type VariantAnalysis = {
  label: 'original' | 'vfinal' | 'explainable_v1'
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
  first_risk_off_bar: number | null
  first_reentry_bar: number | null
  first_risk_off_date: string | null
  first_reentry_date: string | null
  state_days: Record<ExplainableVRState, number>
  reason_counts: Partial<Record<ExplainableVRReasonCode, number>>
  partial_reentry_buy_count: number
  snapback_entry_count: number
  reentry_delayed_days: number
}

type EpisodeComparison = {
  event_id: string
  event_label: string
  start: string
  end: string
  original: VariantAnalysis
  vfinal: VariantAnalysis
  explainable_v1: VariantAnalysis
}

const TARGET_EPISODES: EpisodeSpec[] = [
  { eventId: '2011-06', label: '2011 Debt Ceiling', required: true },
  { eventId: '2020-02', label: '2020 Covid Crash', required: true },
  { eventId: '2021-12', label: '2022 Fed Bear', required: true },
  { eventId: '2025-01', label: '2025 Tariff Shock', required: false },
]

const OUTPUT_DIR = join(process.cwd(), 'vr_backtest', 'results', 'explainable_vr_v1')
const REPORT_PATH = join(process.cwd(), 'docs', 'vr_explainable_vr_v1_report.md')
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

function analyzeVariant(
  event: VRPlaybackEventView,
  variant: ExecutionPlaybackVariant,
  label: VariantAnalysis['label'],
): VariantAnalysis {
  const eventPoints = variant.points.filter((point) => point.in_event)
  const series = eventPoints.length > 0 ? eventPoints : variant.points
  const initialValue = series[0]?.portfolio_value ?? 0
  const finalValue = series[series.length - 1]?.portfolio_value ?? 0
  const { max_drawdown_pct, recovery_days } = computePortfolioStats(series.map((point) => point.portfolio_value))
  const avgEventExposurePct = average(
    series.map((point) => {
      if (!(point.portfolio_value > 0) || !(point.evaluation_value >= 0)) return null
      return (point.evaluation_value / point.portfolio_value) * 100
    }),
  )

  const stateDays = series.reduce<Record<ExplainableVRState, number>>(
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

  const reasonCounts = series.reduce<Partial<Record<ExplainableVRReasonCode, number>>>((acc, point) => {
    if (point.explainable_reason_code) {
      acc[point.explainable_reason_code] = (acc[point.explainable_reason_code] ?? 0) + 1
    }
    return acc
  }, {})

  const firstRiskOffIndex = series.findIndex((point) => point.explainable_state === 'RISK_OFF')
  const firstReEntryIndex = series.findIndex((point) => point.explainable_state === 'RE_ENTRY')
  const partialReentryBuyCount = series.filter(
    (point) => point.state_after_trade === 'buy_executed' && point.explainable_reason_code === 'REENTRY_PARTIAL',
  ).length
  const snapbackEntryCount = series.filter(
    (point) => point.state_after_trade === 'buy_executed' && point.explainable_reason_code === 'SNAPBACK_ENTRY',
  ).length
  const reentryDelayedDays = series.filter((point) => point.explainable_reason_code === 'REENTRY_DELAYED').length

  return {
    label,
    engine_id: variant.engine_id,
    engine_label: variant.engine_label,
    final_value: round(finalValue, 2),
    period_return_pct: initialValue > 0 ? round(((finalValue / initialValue) - 1) * 100, 2) : 0,
    max_drawdown_pct,
    recovery_days,
    avg_event_exposure_pct: avgEventExposurePct,
    buy_count: variant.buy_markers.length,
    sell_count: variant.sell_markers.length,
    defense_count: variant.defense_markers.length,
    first_risk_off_bar: firstRiskOffIndex >= 0 ? firstRiskOffIndex + 1 : null,
    first_reentry_bar: firstReEntryIndex >= 0 ? firstReEntryIndex + 1 : null,
    first_risk_off_date: firstRiskOffIndex >= 0 ? series[firstRiskOffIndex]?.date ?? null : null,
    first_reentry_date: firstReEntryIndex >= 0 ? series[firstReEntryIndex]?.date ?? null : null,
    state_days: stateDays,
    reason_counts: reasonCounts,
    partial_reentry_buy_count: partialReentryBuyCount,
    snapback_entry_count: snapbackEntryCount,
    reentry_delayed_days: reentryDelayedDays,
  }
}

function findMissingRequired(view: ReturnType<typeof buildVRPlaybackView>) {
  if (!view) return TARGET_EPISODES.filter((item) => item.required).map((item) => item.label)
  return TARGET_EPISODES
    .filter((item) => item.required && !view.events.find((event) => event.event_id === item.eventId))
    .map((item) => item.label)
}

function buildEpisodeComparisons(view: NonNullable<ReturnType<typeof buildVRPlaybackView>>) {
  return TARGET_EPISODES
    .map((spec) => {
      const event = view.events.find((item) => item.event_id === spec.eventId)
      if (!event) return null

      const original = event.execution_playback.original_vr
      const vfinal = buildExecutionPlayback(event, CAP, { scenarioEngine: 'vfinal' }).variants[CAP]
      const explainable = buildExecutionPlayback(event, CAP, { scenarioEngine: 'explainable_vr_v1' }).variants[CAP]
      if (!vfinal || !explainable) return null

      return {
        event_id: spec.eventId,
        event_label: spec.label,
        start: event.start,
        end: event.end,
        original: analyzeVariant(event, original, 'original'),
        vfinal: analyzeVariant(event, vfinal, 'vfinal'),
        explainable_v1: analyzeVariant(event, explainable, 'explainable_v1'),
      } satisfies EpisodeComparison
    })
    .filter((item): item is EpisodeComparison => item != null)
}

function buildSummaryRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    start: episode.start,
    end: episode.end,
    original_final_value: episode.original.final_value,
    vfinal_final_value: episode.vfinal.final_value,
    explainable_final_value: episode.explainable_v1.final_value,
    explainable_vs_original_delta: round(episode.explainable_v1.final_value - episode.original.final_value, 2),
    explainable_vs_vfinal_delta: round(episode.explainable_v1.final_value - episode.vfinal.final_value, 2),
    original_max_drawdown_pct: episode.original.max_drawdown_pct,
    vfinal_max_drawdown_pct: episode.vfinal.max_drawdown_pct,
    explainable_max_drawdown_pct: episode.explainable_v1.max_drawdown_pct,
    original_avg_event_exposure_pct: episode.original.avg_event_exposure_pct,
    vfinal_avg_event_exposure_pct: episode.vfinal.avg_event_exposure_pct,
    explainable_avg_event_exposure_pct: episode.explainable_v1.avg_event_exposure_pct,
    explainable_first_risk_off_bar: episode.explainable_v1.first_risk_off_bar,
    explainable_first_reentry_bar: episode.explainable_v1.first_reentry_bar,
    explainable_partial_reentry_buy_count: episode.explainable_v1.partial_reentry_buy_count,
    explainable_snapback_entry_count: episode.explainable_v1.snapback_entry_count,
    explainable_reentry_delayed_days: episode.explainable_v1.reentry_delayed_days,
  }))
}

function buildStateRows(comparisons: EpisodeComparison[]) {
  return comparisons.map((episode) => ({
    event_id: episode.event_id,
    event_label: episode.event_label,
    normal_days: episode.explainable_v1.state_days.NORMAL,
    warning_days: episode.explainable_v1.state_days.WARNING,
    risk_off_days: episode.explainable_v1.state_days.RISK_OFF,
    bottom_watch_days: episode.explainable_v1.state_days.BOTTOM_WATCH,
    re_entry_days: episode.explainable_v1.state_days.RE_ENTRY,
    first_risk_off_date: episode.explainable_v1.first_risk_off_date,
    first_reentry_date: episode.explainable_v1.first_reentry_date,
    warning_reason_days: episode.explainable_v1.reason_counts.WARNING_ENERGY ?? 0,
    risk_off_reason_days: episode.explainable_v1.reason_counts.RISK_OFF_BREAK ?? 0,
    bottom_watch_reason_days: episode.explainable_v1.reason_counts.BOTTOM_WATCH_DELAY ?? 0,
    reentry_partial_days: episode.explainable_v1.reason_counts.REENTRY_PARTIAL ?? 0,
    reentry_delayed_reason_days: episode.explainable_v1.reason_counts.REENTRY_DELAYED ?? 0,
    snapback_entry_reason_days: episode.explainable_v1.reason_counts.SNAPBACK_ENTRY ?? 0,
  }))
}

function buildReportMarkdown(comparisons: EpisodeComparison[]) {
  const summaryRows = buildSummaryRows(comparisons)
  const stateRows = buildStateRows(comparisons)
  const episode2011 = comparisons.find((item) => item.event_id === '2011-06')
  const episode2020 = comparisons.find((item) => item.event_id === '2020-02')
  const episode2022 = comparisons.find((item) => item.event_id === '2021-12')

  return `# Explainable VR v1 Report

## Implementation summary
This pass validates Explainable VR v1 as a deterministic state-machine replay engine.

The strategy keeps the existing VR playback environment intact and adds:
- five explicit states: NORMAL, WARNING, RISK_OFF, BOTTOM_WATCH, RE_ENTRY
- deterministic energy / structure / recovery / retest rules
- explainable per-bar outputs for state, permissions, exposure target, and reason code

The original VR playback and the current vFinal engine are unchanged.

## Validation method
- Source archives: \`risk_v1_playback.json\` and \`vr_survival_playback.json\`
- Cap setting: \`${CAP}%\`
- Compared engines:
  - Original VR (Playback)
  - Scenario VR (vFinal)
  - Explainable VR v1
- Required episodes:
  - 2011 Debt Ceiling
  - 2020 Covid Crash
  - 2022 Fed Bear
- Optional episode:
  - 2025 Tariff Shock when available

## Episode comparison tables
### Portfolio outcome and exposure
${markdownTable(summaryRows.map((row) => ({
    event: row.event_label as string,
    original_final: row.original_final_value as number,
    vfinal_final: row.vfinal_final_value as number,
    explainable_final: row.explainable_final_value as number,
    explainable_vs_original: row.explainable_vs_original_delta as number,
    explainable_vs_vfinal: row.explainable_vs_vfinal_delta as number,
    original_dd: row.original_max_drawdown_pct as number,
    vfinal_dd: row.vfinal_max_drawdown_pct as number,
    explainable_dd: row.explainable_max_drawdown_pct as number,
    original_avg_exposure: row.original_avg_event_exposure_pct as number | null,
    vfinal_avg_exposure: row.vfinal_avg_event_exposure_pct as number | null,
    explainable_avg_exposure: row.explainable_avg_event_exposure_pct as number | null,
  })))}

### Explainable state diagnostics
${markdownTable(stateRows.map((row) => ({
    event: row.event_label as string,
    normal_days: row.normal_days as number,
    warning_days: row.warning_days as number,
    risk_off_days: row.risk_off_days as number,
    bottom_watch_days: row.bottom_watch_days as number,
    re_entry_days: row.re_entry_days as number,
    first_risk_off: row.first_risk_off_date as string | null,
    first_reentry: row.first_reentry_date as string | null,
    partial_reentry_days: row.reentry_partial_days as number,
    snapback_entry_days: row.snapback_entry_reason_days as number,
    reentry_delayed_days: row.reentry_delayed_reason_days as number,
  })))}

## Key findings
- 2011 Debt Ceiling: first RISK_OFF at ${episode2011?.explainable_v1.first_risk_off_bar ?? '-'} bars, first RE_ENTRY at ${episode2011?.explainable_v1.first_reentry_bar ?? '-'} bars, snapback entries ${episode2011?.explainable_v1.snapback_entry_count ?? '-'}.
- 2020 Covid Crash: first RISK_OFF at ${episode2020?.explainable_v1.first_risk_off_bar ?? '-'} bars, BOTTOM_WATCH days ${episode2020?.explainable_v1.state_days.BOTTOM_WATCH ?? '-'}, snapback entries ${episode2020?.explainable_v1.snapback_entry_count ?? '-'}.
- 2022 Fed Bear: avg event exposure Original ${episode2022?.original.avg_event_exposure_pct ?? '-'} vs Explainable ${episode2022?.explainable_v1.avg_event_exposure_pct ?? '-'}, with BOTTOM_WATCH days ${episode2022?.explainable_v1.state_days.BOTTOM_WATCH ?? '-'} and RE_ENTRY delayed days ${episode2022?.explainable_v1.reentry_delayed_days ?? '-'}.

## Recommended next step
If the state machine is directionally correct but underperforms on a specific episode, tune thresholds inside the explainable engine only after reviewing:
- first RISK_OFF timing
- time spent in BOTTOM_WATCH
- first RE_ENTRY timing
- snapback versus delayed re-entry counts

## Known limitations
- Explainable VR v1 currently reuses the same playback environment and cap framework as vFinal, so it is comparable but not yet exposed as a first-class UI engine.
- This report focuses on replay auditability, not parameter optimization.
- Optional 2025 coverage depends on the local playback archive.
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
  if (!playbackView || missingRequired.length > 0) {
    throw new Error(`Missing required playback events: ${missingRequired.join(', ')}`)
  }

  const comparisons = buildEpisodeComparisons(playbackView)
  const summaryRows = buildSummaryRows(comparisons)
  const stateRows = buildStateRows(comparisons)

  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.json'), JSON.stringify(summaryRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_summary.csv'), toCsv(summaryRows))
  writeFileSync(join(OUTPUT_DIR, 'explainable_state_diagnostics.json'), JSON.stringify(stateRows, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'explainable_state_diagnostics.csv'), toCsv(stateRows))
  writeFileSync(join(OUTPUT_DIR, 'episode_comparison_full.json'), JSON.stringify(comparisons, null, 2))
  writeFileSync(REPORT_PATH, buildReportMarkdown(comparisons))

  console.log(`[explainable-vr-v1] wrote ${join(OUTPUT_DIR, 'episode_comparison_summary.csv')}`)
  console.log(`[explainable-vr-v1] wrote ${join(OUTPUT_DIR, 'explainable_state_diagnostics.csv')}`)
  console.log(`[explainable-vr-v1] wrote ${REPORT_PATH}`)
}

main()
