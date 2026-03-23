import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  buildVRPlaybackView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
} from './vr_playback_loader'
import {
  buildExecutionPlayback,
  type ExecutionPlaybackBuildOptions,
  type ExecutionPlaybackSource,
} from './build_execution_playback'
import { computeMode, computeMacroState, computeMa200Slope, computeDD20 } from './macro_policy_layer'
import { buildStateStats } from '../arena/montecarlo/regime/buildStateStats'
import { buildTransitionMatrix } from '../arena/montecarlo/regime/buildTransitionMatrix'
import { generateRegimePaths } from '../arena/montecarlo/regime/generateRegimePaths'
import { labelHistoricalRegimes } from '../arena/montecarlo/regime/labelHistoricalRegimes'

// =============================================================================
// validate_final_engine.ts
//
// WORK ORDER: Explainable VR Finalization
//
// Engine configs:
//   A = v1.3 baseline: explainable_vr_v1, enableMacroGating: false
//   B = v1.5 macro OFF: explainable_vr_v1, enableMacroGating: false (same as A)
//   C = v1.5 macro ON:  explainable_vr_v1, enableMacroGating: true (default)
//   BENCH = vr_original_v2
//
// TARGET_EPISODES = ['2011-06', '2020-02', '2021-12', '2025-01']
//
// Output files (vr_backtest/results/final_engine/):
//   vr_final_engine_summary.json
//   vr_mode_stats.csv
//   vr_mc_comparison.csv
//   vr_decision_log.md
//   docs/vr_final_engine_report.md
// =============================================================================

const OUTPUT_DIR = join(process.cwd(), 'vr_backtest', 'results', 'final_engine')
const DOCS_DIR = join(process.cwd(), 'docs')
const N_PATHS = 500
const HORIZON_DAYS = 252
const START_PRICE = 50
const RANDOM_SEED = 42
const CAP = '50' as const

const TARGET_EPISODES = ['2011-06', '2020-02', '2021-12', '2025-01']

type EngineLabel = 'A_v1.3' | 'B_v1.5_off' | 'C_v1.5_on' | 'BENCH'

const ENGINE_CONFIGS: Array<{
  label: EngineLabel
  options: ExecutionPlaybackBuildOptions
  description: string
}> = [
  {
    label: 'A_v1.3',
    options: { scenarioEngine: 'explainable_vr_v1', enableMacroGating: false },
    description: 'v1.3 baseline: explainable_vr_v1, macro gating OFF',
  },
  {
    label: 'B_v1.5_off',
    options: { scenarioEngine: 'explainable_vr_v1', enableMacroGating: false },
    description: 'v1.5 macro OFF: same behavior as A',
  },
  {
    label: 'C_v1.5_on',
    options: { scenarioEngine: 'explainable_vr_v1', enableMacroGating: true },
    description: 'v1.5 macro ON: explainable_vr_v1 with CRISIS/macro gating',
  },
  {
    label: 'BENCH',
    options: { scenarioEngine: 'vr_original_v2' },
    description: 'Benchmark: vr_original_v2',
  },
]

// =============================================================================
// Helpers
// =============================================================================

function readJson<T>(filename: string): T {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'marketflow', 'backend', 'output', filename), 'utf-8'),
  ) as T
}

function round(v: number, d = 2): number {
  return Math.round(v * 10 ** d) / 10 ** d
}

function rollingMean(prices: number[], idx: number, window: number): number | null {
  if (idx < window - 1) return null
  let sum = 0
  for (let i = idx - window + 1; i <= idx; i++) sum += prices[i]
  return sum / window
}

function toCsv(rows: Array<Record<string, string | number | null | boolean>>): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  return (
    [headers.join(','), ...rows.map((r) => headers.map((h) => (r[h] == null ? '' : String(r[h]))).join(','))].join(
      '\n',
    ) + '\n'
  )
}

function pctile(sorted: number[], p: number): number {
  return sorted[Math.floor(p * (sorted.length - 1))] ?? 0
}

function summarize(values: number[]) {
  if (!values.length) return { mean: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  return {
    mean: round(values.reduce((a, b) => a + b, 0) / n, 3),
    p5: round(pctile(sorted, 0.05), 3),
    p25: round(pctile(sorted, 0.25), 3),
    p50: round(pctile(sorted, 0.5), 3),
    p75: round(pctile(sorted, 0.75), 3),
    p95: round(pctile(sorted, 0.95), 3),
    min: round(sorted[0], 3),
    max: round(sorted[n - 1], 3),
  }
}

// =============================================================================
// buildSyntheticEventView
// (copied from run_mc_explainable_v1_3.ts)
// =============================================================================
function buildSyntheticEventView(prices: number[]): ExecutionPlaybackSource {
  const startDate = '2020-01-01'
  const initialCapital = 10000
  const initialShares = Math.floor((initialCapital * 0.8) / prices[0])
  const initialPoolCash = initialCapital * 0.2

  const chartData = prices.map((price, i) => {
    const ma200 = rollingMean(prices, i, 200)
    const ma50 = rollingMean(prices, i, 50)
    const d = new Date(startDate)
    d.setDate(d.getDate() + Math.floor(i * 1.4))
    const dateStr = d.toISOString().slice(0, 10)
    return {
      date: dateStr,
      tqqq_n: round(price, 4),
      qqq_n: round(price * 0.6, 4),
      ma50_n: ma50 != null ? round(ma50, 4) : null,
      ma200_n: ma200 != null ? round(ma200, 4) : null,
      qqq_dd: null,
      tqqq_dd: null,
      score: null,
      level: null,
      in_event: true,
    }
  })

  const cycleStartDate = chartData[0]?.date ?? startDate
  const cycleEndDate = chartData[chartData.length - 1]?.date ?? startDate

  return {
    start: cycleStartDate,
    end: cycleEndDate,
    chart_data: chartData,
    cycle_start: {
      initial_state: {
        initial_capital: initialCapital,
        start_price: prices[0],
        initial_share_count: initialShares,
        initial_average_price: prices[0],
        initial_pool_cash: initialPoolCash,
      },
    },
    cycle_framework: {
      cycles: [
        {
          cycle_no: 1,
          cycle_start_date: cycleStartDate,
          cycle_end_date: cycleEndDate,
          event_id: 'mc_synthetic',
          event_date: cycleStartDate,
          is_active_cycle: true,
          days_from_event_start: 0,
          days_to_event_end: chartData.length,
          vref: null,
          vmin: null,
          vmax: null,
          ma200_status: null,
          leverage_stress: null,
          recovery_quality: null,
          pattern_type: null,
          scenario_bias: [],
          playbook_bias: [],
          buy_permission_state: 'active',
          defense_state: 'pending',
          theoretical_buy_grid: [],
          theoretical_sell_grid: [],
          representative_buy_grid: [],
          representative_sell_grid: [],
        } as any,
      ],
    },
  }
}

// =============================================================================
// computeSnapbackWindow
// =============================================================================
function computeSnapbackWindow(prices: number[]): { lowIdx: number; windowEnd: number } {
  let lowIdx = 0
  let lowPrice = prices[0]
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] < lowPrice) {
      lowPrice = prices[i]
      lowIdx = i
    }
  }
  let windowEnd = Math.min(lowIdx + 20, prices.length - 1)
  for (let i = lowIdx + 1; i < prices.length; i++) {
    if (lowPrice > 0 && prices[i] / lowPrice - 1 >= 0.15) {
      windowEnd = i
      break
    }
  }
  return { lowIdx, windowEnd }
}

// =============================================================================
// PART 1 — Deterministic Episode Metrics
// =============================================================================
type EpisodeMetrics = {
  episode: string
  engine: EngineLabel
  final_value: number
  max_drawdown_pct: number
  avg_exposure_pct: number
  snapback_capture_score: number
  buy_count: number
  defense_count: number
}

function computeEpisodeMetrics(
  event: ExecutionPlaybackSource,
  episodeId: string,
  engineLabel: EngineLabel,
  options: ExecutionPlaybackBuildOptions,
): EpisodeMetrics {
  const result = buildExecutionPlayback(event as any, CAP, options)
  const variant = result.variants[CAP]

  if (!variant || !variant.points.length) {
    return {
      episode: episodeId,
      engine: engineLabel,
      final_value: 0,
      max_drawdown_pct: 0,
      avg_exposure_pct: 0,
      snapback_capture_score: 0,
      buy_count: 0,
      defense_count: 0,
    }
  }

  const pts = variant.points
  const finalValue = pts[pts.length - 1]?.portfolio_value ?? 0
  const initValue = pts[0]?.portfolio_value ?? 10000

  // Max drawdown
  let peak = initValue
  let maxDD = 0
  for (const p of pts) {
    if (p.portfolio_value > peak) peak = p.portfolio_value
    const dd = peak > 0 ? p.portfolio_value / peak - 1 : 0
    if (dd < maxDD) maxDD = dd
  }

  // Avg exposure
  const exposures = pts.map((p) => (p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : 0))
  const avgExposure = exposures.reduce((a, b) => a + b, 0) / (exposures.length || 1)

  // Snapback score (Work Order definition)
  // find event low bar, window = low+1 to min(low+20, end)
  // score = avg_exposure_in_window / 100 * 0.5 + (buy_count_in_window > 0 ? 0.5 : 0)
  const prices = event.chart_data.map((d) => d.tqqq_n ?? 50)
  const { lowIdx, windowEnd } = computeSnapbackWindow(prices)
  const windowStart = lowIdx + 1
  const snapPts = pts.slice(windowStart, windowEnd + 1)
  const snapExposures = snapPts.map((p) =>
    p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : 0,
  )
  const snapAvgExp = snapExposures.reduce((a, b) => a + b, 0) / (snapExposures.length || 1)
  const snapBuyCount = snapPts.filter((p) => (p as any).state_after_trade === 'buy_executed').length
  const captureScore = round((snapAvgExp / 100) * 0.5 + (snapBuyCount > 0 ? 0.5 : 0), 3)

  return {
    episode: episodeId,
    engine: engineLabel,
    final_value: round(finalValue, 2),
    max_drawdown_pct: round(maxDD * 100, 2),
    avg_exposure_pct: round(avgExposure, 2),
    snapback_capture_score: captureScore,
    buy_count: variant.buy_markers?.length ?? 0,
    defense_count: variant.defense_markers?.length ?? 0,
  }
}

// =============================================================================
// PART 2 — Mode Statistics
// =============================================================================
type ModeStats = {
  episode: string
  total_bars: number
  normal_days: number
  crisis_days: number
  crisis_ratio: number
  macro_active_days: number
}

function computeModeStats(episodeId: string, chartData: ExecutionPlaybackSource['chart_data']): ModeStats {
  const prices = chartData.map((d) => d.tqqq_n ?? 50)
  const ma200Series = chartData.map((d) => d.ma200_n ?? null)

  let normalDays = 0
  let crisisDays = 0
  let macroActiveDays = 0
  let runningMin = prices[0]

  for (let i = 0; i < chartData.length; i++) {
    const tqqq_n = prices[i]
    const ma200_n = ma200Series[i]

    if (tqqq_n < runningMin) runningMin = tqqq_n
    const reboundFromLow = runningMin > 0 ? tqqq_n / runningMin - 1 : 0

    const mode = computeMode(tqqq_n, ma200_n)
    if (mode === 'NORMAL') {
      normalDays++
    } else {
      crisisDays++
      const ma200Slope = computeMa200Slope(ma200Series, i)
      const dd20 = computeDD20(prices, i)
      const macroState = computeMacroState({
        ma200Slope,
        dd20,
        reboundFromLow,
        price: tqqq_n,
        ma200: ma200_n,
      })
      if (macroState === 'POLICY_HEADWIND') {
        macroActiveDays++
      }
    }
  }

  const total = chartData.length
  return {
    episode: episodeId,
    total_bars: total,
    normal_days: normalDays,
    crisis_days: crisisDays,
    crisis_ratio: round(total > 0 ? crisisDays / total : 0, 4),
    macro_active_days: macroActiveDays,
  }
}

// =============================================================================
// PART 3 — Behavior Delta (A vs C)
// =============================================================================
type BehaviorDelta = {
  episode: string
  v1_3_final: number
  v1_5_on_final: number
  v1_3_vs_v1_5_diff: number
  macro_on_vs_off_diff: number
  blocked_entries_count: number
  delayed_entries_count: number
}

// =============================================================================
// PART 4 — Monte Carlo per-path metrics
// =============================================================================
type MCEngine = 'A_v1.3' | 'C_v1.5_on' | 'BENCH'

type MCPathMetrics = {
  engine: MCEngine
  finalValue: number
  maxDrawdownPct: number
  avgExposurePct: number
  timeInMarketPct: number
  buyCount: number
  defenseCount: number
  snapbackCaptureScore: number
}

function computeMCPathMetrics(
  event: ExecutionPlaybackSource,
  engineLabel: MCEngine,
  options: ExecutionPlaybackBuildOptions,
  prices: number[],
): MCPathMetrics {
  const result = buildExecutionPlayback(event as any, CAP, options)
  const variant = result.variants[CAP]

  if (!variant || !variant.points.length) {
    return { engine: engineLabel, finalValue: 0, maxDrawdownPct: 0, avgExposurePct: 0, timeInMarketPct: 0, buyCount: 0, defenseCount: 0, snapbackCaptureScore: 0 }
  }

  const pts = variant.points
  const finalValue = pts[pts.length - 1]?.portfolio_value ?? 0
  const initValue = pts[0]?.portfolio_value ?? 10000

  let peak = initValue
  let maxDD = 0
  for (const p of pts) {
    if (p.portfolio_value > peak) peak = p.portfolio_value
    const dd = peak > 0 ? p.portfolio_value / peak - 1 : 0
    if (dd < maxDD) maxDD = dd
  }

  const exposures = pts.map((p) => (p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : 0))
  const avgExposure = exposures.reduce((a, b) => a + b, 0) / (exposures.length || 1)
  const timeInMarket = (exposures.filter((e) => e > 5).length / (exposures.length || 1)) * 100

  // Snapback score (run_mc_explainable_v1_3 style with 4-factor formula)
  const { lowIdx, windowEnd } = computeSnapbackWindow(prices)
  const snapPts = pts.slice(lowIdx, windowEnd + 1)
  const snapExposures = snapPts.map((p) =>
    p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : 0,
  )
  const snapAvgExp = snapExposures.reduce((a, b) => a + b, 0) / (snapExposures.length || 1)
  const snapBuys = snapPts.filter((p) => (p as any).state_after_trade === 'buy_executed').length
  const windDays = windowEnd - lowIdx + 1
  const firstBuyInWindow = snapPts.findIndex((p) => (p as any).state_after_trade === 'buy_executed')
  const earlyBonus = firstBuyInWindow >= 0 ? Math.max(0, 1 - firstBuyInWindow / windDays) : 0
  const captureScore = round(
    0.4 * Math.min(snapAvgExp / 100, 1) +
      0.3 * Math.min((variant.pool_usage_summary?.cumulative_pool_spent ?? 0) / 1000, 1) +
      0.2 * earlyBonus +
      0.1 * (snapBuys > 0 ? 1 : 0),
    3,
  )

  return {
    engine: engineLabel,
    finalValue: round(finalValue, 2),
    maxDrawdownPct: round(maxDD * 100, 2),
    avgExposurePct: round(avgExposure, 2),
    timeInMarketPct: round(timeInMarket, 2),
    buyCount: variant.buy_markers?.length ?? 0,
    defenseCount: variant.defense_markers?.length ?? 0,
    snapbackCaptureScore: captureScore,
  }
}

type MCEngineStats = {
  n_paths: number
  p5_final: number
  median_final: number
  median_mdd: number
  time_in_market_mean: number
  avg_exposure_mean: number
  snapback_capture_score_mean: number
  snapback_success_rate: number
  tail_loss_5pct: number
  worst_case_dd: number
}

function aggregateMCStats(metrics: MCPathMetrics[]): MCEngineStats {
  const finals = metrics.map((m) => m.finalValue)
  const mdds = metrics.map((m) => m.maxDrawdownPct)
  const exposures = metrics.map((m) => m.avgExposurePct)
  const times = metrics.map((m) => m.timeInMarketPct)
  const snapScores = metrics.map((m) => m.snapbackCaptureScore)
  const finalsSorted = [...finals].sort((a, b) => a - b)
  const mddsSorted = [...mdds].sort((a, b) => a - b)
  const n = metrics.length || 1
  return {
    n_paths: n,
    p5_final: round(pctile(finalsSorted, 0.05), 3),
    median_final: round(pctile(finalsSorted, 0.5), 3),
    median_mdd: round(pctile(mddsSorted, 0.5), 3),
    time_in_market_mean: round(times.reduce((a, b) => a + b, 0) / n, 2),
    avg_exposure_mean: round(exposures.reduce((a, b) => a + b, 0) / n, 2),
    snapback_capture_score_mean: round(snapScores.reduce((a, b) => a + b, 0) / n, 3),
    snapback_success_rate: round((snapScores.filter((s) => s >= 0.3).length / n) * 100, 2),
    tail_loss_5pct: round(pctile(finalsSorted, 0.05), 3),
    worst_case_dd: round(mddsSorted[0] ?? 0, 2),
  }
}

// =============================================================================
// MAIN
// =============================================================================
function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  mkdirSync(DOCS_DIR, { recursive: true })

  // --- Load playback archives ---
  const standardArchive = readJson<RawStandardPlaybackArchive>('risk_v1_playback.json')
  const survivalArchive = readJson<RawVRSurvivalPlaybackArchive>('vr_survival_playback.json')
  const playbackView = buildVRPlaybackView({
    standardArchive,
    survivalArchive,
    rootDir: process.cwd(),
  })
  if (!playbackView) throw new Error('buildVRPlaybackView returned null')

  // --- Match target episodes ---
  const episodeSources: Array<{ episodeId: string; source: ExecutionPlaybackSource }> = []
  for (const ev of playbackView.events) {
    const eid = (ev as any).event_id ?? ''
    if (TARGET_EPISODES.includes(eid)) {
      episodeSources.push({
        episodeId: eid,
        source: {
          start: ev.start,
          end: ev.end,
          chart_data: ev.chart_data,
          cycle_start: ev.cycle_start as any,
          cycle_framework: ev.cycle_framework as any,
        },
      })
    }
  }

  // Deduplicate (some episodes appear multiple times in suite)
  const seenEpisodes = new Set<string>()
  const uniqueEpisodeSources = episodeSources.filter(({ episodeId }) => {
    if (seenEpisodes.has(episodeId)) return false
    seenEpisodes.add(episodeId)
    return true
  })

  console.log(`[Final Engine] Matched episodes: ${uniqueEpisodeSources.map((e) => e.episodeId).join(', ')}`)
  if (uniqueEpisodeSources.length === 0) {
    console.warn('[WARN] No episodes matched. Check event_ids in playback archive.')
  }

  // ============================================================
  // PART 1: Deterministic Episode Comparison (Table 5.1)
  // ============================================================
  console.log('\n[PART 1] Deterministic Episode Comparison (Table 5.1)...')
  const table51: EpisodeMetrics[] = []

  for (const { episodeId, source } of uniqueEpisodeSources) {
    for (const cfg of ENGINE_CONFIGS) {
      try {
        const m = computeEpisodeMetrics(source, episodeId, cfg.label, cfg.options)
        table51.push(m)
        console.log(
          `  [${episodeId}][${cfg.label}] final=${m.final_value}  mdd=${m.max_drawdown_pct}%  exp=${m.avg_exposure_pct}%  snap=${m.snapback_capture_score}`,
        )
      } catch (e) {
        console.error(`  [ERROR] ${episodeId} ${cfg.label}: ${e}`)
      }
    }
  }

  // ============================================================
  // PART 2: Mode Statistics (Table 5.2)
  // ============================================================
  console.log('\n[PART 2] Mode Statistics (Table 5.2)...')
  const table52: ModeStats[] = []
  for (const { episodeId, source } of uniqueEpisodeSources) {
    const stats = computeModeStats(episodeId, source.chart_data)
    table52.push(stats)
    console.log(
      `  [${episodeId}] normal=${stats.normal_days}  crisis=${stats.crisis_days}  crisis_ratio=${(stats.crisis_ratio * 100).toFixed(1)}%  headwind=${stats.macro_active_days}`,
    )
  }

  // ============================================================
  // PART 3: Behavior Delta A vs C (Table 5.3)
  // ============================================================
  console.log('\n[PART 3] Behavior Delta A vs C (Table 5.3)...')
  const table53: BehaviorDelta[] = []
  for (const { episodeId } of uniqueEpisodeSources) {
    const aM = table51.find((r) => r.episode === episodeId && r.engine === 'A_v1.3')
    const cM = table51.find((r) => r.episode === episodeId && r.engine === 'C_v1.5_on')
    if (!aM || !cM) continue
    const delta: BehaviorDelta = {
      episode: episodeId,
      v1_3_final: aM.final_value,
      v1_5_on_final: cM.final_value,
      v1_3_vs_v1_5_diff: round(cM.final_value - aM.final_value, 2),
      macro_on_vs_off_diff: round(cM.final_value - aM.final_value, 2),
      blocked_entries_count: aM.buy_count - cM.buy_count,
      delayed_entries_count: 0,
    }
    table53.push(delta)
    console.log(
      `  [${episodeId}] A_final=${delta.v1_3_final}  C_final=${delta.v1_5_on_final}  diff=${delta.v1_3_vs_v1_5_diff}  blocked=${delta.blocked_entries_count}`,
    )
  }

  // ============================================================
  // PART 4: Monte Carlo (500 paths, 252 days)
  // ============================================================
  console.log(`\n[PART 4] Monte Carlo (${N_PATHS} paths, ${HORIZON_DAYS} days)...`)

  // Build regime model from first historical event
  const firstEvent = playbackView.events[0]
  const historicalPrices = firstEvent.chart_data.map((p) => p.tqqq_n ?? 50)
  const historicalReturns = historicalPrices.map((p, i) =>
    i === 0 || historicalPrices[i - 1] <= 0 ? 0 : p / historicalPrices[i - 1] - 1,
  )

  const labels = labelHistoricalRegimes({ prices: historicalPrices })
  const regimeModel = {
    states: ['NORMAL', 'SELLOFF', 'PANIC', 'BOTTOMING', 'RECOVERY'] as const,
    transitionMatrix: buildTransitionMatrix(labels),
    stateStats: buildStateStats({ returns: historicalReturns, labels }),
  }

  const paths = generateRegimePaths({
    model: regimeModel as any,
    config: { horizonDays: HORIZON_DAYS, nPaths: N_PATHS, startPrice: START_PRICE, randomSeed: RANDOM_SEED },
  })

  console.log(`[PART 4] Generated ${paths.length} paths. Running engines...`)

  const mcMetricsA: MCPathMetrics[] = []
  const mcMetricsC: MCPathMetrics[] = []
  const mcMetricsBench: MCPathMetrics[] = []

  for (let i = 0; i < paths.length; i++) {
    if (i % 100 === 0) console.log(`  path ${i + 1}/${paths.length}...`)
    const path = paths[i]
    const event = buildSyntheticEventView(path.prices)

    try { mcMetricsA.push(computeMCPathMetrics(event, 'A_v1.3', { scenarioEngine: 'explainable_vr_v1', enableMacroGating: false }, path.prices)) } catch (_) { /* skip */ }
    try { mcMetricsC.push(computeMCPathMetrics(event, 'C_v1.5_on', { scenarioEngine: 'explainable_vr_v1', enableMacroGating: true }, path.prices)) } catch (_) { /* skip */ }
    try { mcMetricsBench.push(computeMCPathMetrics(event, 'BENCH', { scenarioEngine: 'vr_original_v2' }, path.prices)) } catch (_) { /* skip */ }
  }

  console.log(`[PART 4] A=${mcMetricsA.length}  C=${mcMetricsC.length}  BENCH=${mcMetricsBench.length}`)

  const mcStatsA = aggregateMCStats(mcMetricsA)
  const mcStatsC = aggregateMCStats(mcMetricsC)
  const mcStatsBench = aggregateMCStats(mcMetricsBench)

  console.log('\n=== MC STATS ===')
  console.log(`  A (v1.3):    p5=${mcStatsA.p5_final}  med=${mcStatsA.median_final}  mdd=${mcStatsA.median_mdd}%  snap_rate=${mcStatsA.snapback_success_rate}%`)
  console.log(`  C (v1.5 ON): p5=${mcStatsC.p5_final}  med=${mcStatsC.median_final}  mdd=${mcStatsC.median_mdd}%  snap_rate=${mcStatsC.snapback_success_rate}%`)
  console.log(`  BENCH:       p5=${mcStatsBench.p5_final}  med=${mcStatsBench.median_final}  mdd=${mcStatsBench.median_mdd}%  snap_rate=${mcStatsBench.snapback_success_rate}%`)

  // ============================================================
  // PART 5: Decision (Work Order §8)
  // ============================================================
  console.log('\n[PART 5] Evaluating Decision Criteria (§8)...')

  // Criterion 1: 2022 (2021-12) C.final >= A.final
  const ep2022A = table51.find((r) => r.episode === '2021-12' && r.engine === 'A_v1.3')
  const ep2022C = table51.find((r) => r.episode === '2021-12' && r.engine === 'C_v1.5_on')
  const crit1 =
    ep2022A != null && ep2022C != null
      ? { pass: ep2022C.final_value >= ep2022A.final_value, a_val: ep2022A.final_value, c_val: ep2022C.final_value }
      : { pass: false, a_val: 0, c_val: 0 }

  // Criterion 2: MC tail_loss_5pct (C) >= A * 0.95
  const crit2 = {
    pass: mcStatsC.tail_loss_5pct >= mcStatsA.tail_loss_5pct * 0.95,
    a_val: mcStatsA.tail_loss_5pct,
    c_val: mcStatsC.tail_loss_5pct,
    threshold: round(mcStatsA.tail_loss_5pct * 0.95, 3),
  }

  // Criterion 3: No degradation in 2011/2020/2025 (C >= A * 0.95)
  const crit3Episodes = ['2011-06', '2020-02', '2025-01']
  const crit3Details = crit3Episodes.map((ep) => {
    const aVal = table51.find((r) => r.episode === ep && r.engine === 'A_v1.3')?.final_value ?? 0
    const cVal = table51.find((r) => r.episode === ep && r.engine === 'C_v1.5_on')?.final_value ?? 0
    return { episode: ep, a_val: aVal, c_val: cVal, pass: aVal === 0 || cVal >= aVal * 0.95 }
  })
  const crit3 = { pass: crit3Details.every((d) => d.pass), details: crit3Details }

  // Criterion 4: MC snapback_success_rate (C) >= A * 0.70
  const crit4 = {
    pass: mcStatsC.snapback_success_rate >= mcStatsA.snapback_success_rate * 0.70,
    a_val: mcStatsA.snapback_success_rate,
    c_val: mcStatsC.snapback_success_rate,
    threshold: round(mcStatsA.snapback_success_rate * 0.70, 2),
  }

  const allPass = crit1.pass && crit2.pass && crit3.pass && crit4.pass
  const decision = allPass ? 'ACCEPT' : 'FALLBACK'

  console.log(`  Crit 1 — 2022 final C>=A:          ${crit1.pass ? 'PASS' : 'FAIL'}  A=${crit1.a_val}  C=${crit1.c_val}`)
  console.log(`  Crit 2 — MC tail C>=A*0.95:        ${crit2.pass ? 'PASS' : 'FAIL'}  A=${crit2.a_val}  C=${crit2.c_val}  thr=${crit2.threshold}`)
  console.log(`  Crit 3 — No degrade 2011/2020/2025: ${crit3.pass ? 'PASS' : 'FAIL'}`)
  for (const d of crit3.details) {
    console.log(`    [${d.episode}] A=${d.a_val}  C=${d.c_val}  ${d.pass ? 'OK' : 'FAIL'}`)
  }
  console.log(`  Crit 4 — Snapback rate C>=A*0.70:  ${crit4.pass ? 'PASS' : 'FAIL'}  A=${crit4.a_val}%  C=${crit4.c_val}%  thr=${crit4.threshold}%`)
  console.log(`\n  ==> DECISION: ${decision}`)

  // ============================================================
  // PART 6: Write output files
  // ============================================================
  console.log('\n[PART 6] Writing output files...')

  // vr_final_engine_summary.json
  const summaryJson = {
    generated_at: new Date().toISOString(),
    target_episodes: TARGET_EPISODES,
    engine_configs: ENGINE_CONFIGS.map((c) => ({ label: c.label, description: c.description })),
    table_51_episode_comparison: table51,
    table_52_mode_stats: table52,
    table_53_behavior_delta: table53,
    monte_carlo: {
      n_paths: N_PATHS,
      horizon_days: HORIZON_DAYS,
      start_price: START_PRICE,
      random_seed: RANDOM_SEED,
      A_v1_3: mcStatsA,
      C_v1_5_on: mcStatsC,
      BENCH: mcStatsBench,
    },
    decision: {
      result: decision,
      all_criteria_pass: allPass,
      criterion_1_2022_final: crit1,
      criterion_2_mc_tail: crit2,
      criterion_3_no_degradation: crit3,
      criterion_4_snapback_rate: crit4,
    },
  }
  writeFileSync(join(OUTPUT_DIR, 'vr_final_engine_summary.json'), JSON.stringify(summaryJson, null, 2))

  // vr_mode_stats.csv
  writeFileSync(join(OUTPUT_DIR, 'vr_mode_stats.csv'), toCsv(table52))

  // vr_mc_comparison.csv
  const mcRows: Array<Record<string, string | number | null | boolean>> = [
    { engine: 'A_v1.3', ...mcStatsA },
    { engine: 'C_v1.5_on', ...mcStatsC },
    { engine: 'BENCH', ...mcStatsBench },
  ]
  writeFileSync(join(OUTPUT_DIR, 'vr_mc_comparison.csv'), toCsv(mcRows))

  // vr_decision_log.md
  const decisionMd = [
    '# VR Final Engine Decision Log',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `## Decision: **${decision}**`,
    '',
    '## Criteria',
    '',
    '### Criterion 1 — 2022 Episode (2021-12): C.final >= A.final',
    `- A (v1.3): ${crit1.a_val}`,
    `- C (v1.5 ON): ${crit1.c_val}`,
    `- Result: **${crit1.pass ? 'PASS' : 'FAIL'}**`,
    '',
    '### Criterion 2 — MC Tail Loss: C.tail_p5 >= A.tail_p5 * 0.95',
    `- A tail_p5: ${crit2.a_val}`,
    `- C tail_p5: ${crit2.c_val}`,
    `- Threshold: ${crit2.threshold}`,
    `- Result: **${crit2.pass ? 'PASS' : 'FAIL'}**`,
    '',
    '### Criterion 3 — No Degradation in 2011/2020/2025: C.final >= A.final * 0.95',
    ...crit3.details.map((d) => `- ${d.episode}: A=${d.a_val}  C=${d.c_val}  => **${d.pass ? 'PASS' : 'FAIL'}**`),
    `- Overall: **${crit3.pass ? 'PASS' : 'FAIL'}**`,
    '',
    '### Criterion 4 — MC Snapback Success Rate: C.rate >= A.rate * 0.70',
    `- A rate: ${crit4.a_val}%`,
    `- C rate: ${crit4.c_val}%`,
    `- Threshold: ${crit4.threshold}%`,
    `- Result: **${crit4.pass ? 'PASS' : 'FAIL'}**`,
    '',
    `## Conclusion`,
    '',
    decision === 'ACCEPT'
      ? 'v1.5 macro ON is **ACCEPTED** as production engine. All 4 criteria passed.'
      : 'Falling back to v1.3 baseline. One or more criteria failed. The macro gating layer needs further calibration.',
    '',
  ].join('\n')
  writeFileSync(join(OUTPUT_DIR, 'vr_decision_log.md'), decisionMd)

  // docs/vr_final_engine_report.md
  const table51Rows = table51
    .map((r) => `| ${r.episode} | ${r.engine} | ${r.final_value} | ${r.max_drawdown_pct} | ${r.avg_exposure_pct} | ${r.snapback_capture_score} |`)
    .join('\n')
  const table52Rows = table52
    .map((s) => `| ${s.episode} | ${s.total_bars} | ${s.normal_days} | ${s.crisis_days} | ${(s.crisis_ratio * 100).toFixed(1)}% | ${s.macro_active_days} |`)
    .join('\n')
  const table53Rows = table53
    .map((d) => `| ${d.episode} | ${d.v1_3_final} | ${d.v1_5_on_final} | ${d.v1_3_vs_v1_5_diff} | ${d.blocked_entries_count} |`)
    .join('\n')

  const reportMd = [
    '# VR Final Engine Validation Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Overview',
    '',
    'This report validates the Explainable VR engine finalization.',
    '',
    '| Label | Engine | Macro Gating | Description |',
    '|-------|--------|-------------|-------------|',
    '| A (v1.3) | explainable_vr_v1 | OFF | Baseline |',
    '| B (v1.5 off) | explainable_vr_v1 | OFF | Same as A |',
    '| C (v1.5 on) | explainable_vr_v1 | ON | Production candidate |',
    '| BENCH | vr_original_v2 | N/A | Benchmark |',
    '',
    `**Target Episodes:** ${TARGET_EPISODES.join(', ')}`,
    '',
    '---',
    '',
    '## Table 5.1 — Deterministic Episode Comparison',
    '',
    '| Episode | Engine | Final Value | Max DD% | Avg Exp% | Snapback Score |',
    '|---------|--------|-------------|---------|----------|----------------|',
    table51Rows,
    '',
    '---',
    '',
    '## Table 5.2 — Mode Statistics',
    '',
    '| Episode | Total Bars | Normal | Crisis | Crisis Ratio | Macro Headwind |',
    '|---------|-----------|--------|--------|-------------|----------------|',
    table52Rows,
    '',
    '---',
    '',
    '## Table 5.3 — Behavior Delta (A vs C)',
    '',
    '| Episode | A Final | C Final | Diff | Blocked Entries |',
    '|---------|---------|---------|------|----------------|',
    table53Rows,
    '',
    '---',
    '',
    `## Part 4 — Monte Carlo Results (${N_PATHS} paths, ${HORIZON_DAYS} days)`,
    '',
    '| Engine | N | P5 Final | Median Final | Median MDD | Avg Exposure | Snap Score | Snap Success% | Tail P5 | Worst DD |',
    '|--------|---|----------|-------------|-----------|-------------|-----------|-------------|--------|---------|',
    `| A_v1.3 | ${mcStatsA.n_paths} | ${mcStatsA.p5_final} | ${mcStatsA.median_final} | ${mcStatsA.median_mdd}% | ${mcStatsA.avg_exposure_mean}% | ${mcStatsA.snapback_capture_score_mean} | ${mcStatsA.snapback_success_rate}% | ${mcStatsA.tail_loss_5pct} | ${mcStatsA.worst_case_dd}% |`,
    `| C_v1.5_on | ${mcStatsC.n_paths} | ${mcStatsC.p5_final} | ${mcStatsC.median_final} | ${mcStatsC.median_mdd}% | ${mcStatsC.avg_exposure_mean}% | ${mcStatsC.snapback_capture_score_mean} | ${mcStatsC.snapback_success_rate}% | ${mcStatsC.tail_loss_5pct} | ${mcStatsC.worst_case_dd}% |`,
    `| BENCH | ${mcStatsBench.n_paths} | ${mcStatsBench.p5_final} | ${mcStatsBench.median_final} | ${mcStatsBench.median_mdd}% | ${mcStatsBench.avg_exposure_mean}% | ${mcStatsBench.snapback_capture_score_mean} | ${mcStatsBench.snapback_success_rate}% | ${mcStatsBench.tail_loss_5pct} | ${mcStatsBench.worst_case_dd}% |`,
    '',
    '---',
    '',
    '## Part 5 — Decision (§8 Acceptance Criteria)',
    '',
    '| Criterion | Threshold | A Value | C Value | Pass |',
    '|-----------|-----------|---------|---------|------|',
    `| 1. 2022 final C>=A | C >= A | ${crit1.a_val} | ${crit1.c_val} | ${crit1.pass ? 'YES' : 'NO'} |`,
    `| 2. MC tail C>=A*0.95 | ${crit2.threshold} | ${crit2.a_val} | ${crit2.c_val} | ${crit2.pass ? 'YES' : 'NO'} |`,
    `| 3. No degrade 2011/2020/2025 | C>=A*0.95 per ep | — | — | ${crit3.pass ? 'YES' : 'NO'} |`,
    `| 4. Snapback rate C>=A*0.70 | ${crit4.threshold}% | ${crit4.a_val}% | ${crit4.c_val}% | ${crit4.pass ? 'YES' : 'NO'} |`,
    '',
    `## Final Decision: **${decision}**`,
    '',
    decision === 'ACCEPT'
      ? '**v1.5 macro ON is accepted.** All 4 acceptance criteria passed. Macro policy gating (CRISIS/POLICY_HEADWIND) approved for production.'
      : '**FALLBACK to v1.3 baseline.** One or more acceptance criteria failed. Macro gating needs further calibration.',
    '',
    '---',
    '',
    '## Output Files',
    '',
    '- `vr_backtest/results/final_engine/vr_final_engine_summary.json`',
    '- `vr_backtest/results/final_engine/vr_mode_stats.csv`',
    '- `vr_backtest/results/final_engine/vr_mc_comparison.csv`',
    '- `vr_backtest/results/final_engine/vr_decision_log.md`',
    '- `docs/vr_final_engine_report.md`',
    '',
  ].join('\n')

  writeFileSync(join(DOCS_DIR, 'vr_final_engine_report.md'), reportMd)

  console.log(`\n[Final Engine] Output dir: ${OUTPUT_DIR}`)
  console.log(`[Final Engine] Report: ${DOCS_DIR}/vr_final_engine_report.md`)
  console.log(`\n==> FINAL DECISION: ${decision}`)
}

main()
