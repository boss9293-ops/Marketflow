import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  buildVRPlaybackView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
} from './vr_playback_loader'
import { buildExecutionPlayback } from './build_execution_playback'
import { buildStateStats } from '../arena/montecarlo/regime/buildStateStats'
import { buildTransitionMatrix } from '../arena/montecarlo/regime/buildTransitionMatrix'
import { generateRegimePaths } from '../arena/montecarlo/regime/generateRegimePaths'
import { labelHistoricalRegimes } from '../arena/montecarlo/regime/labelHistoricalRegimes'
import { buildSyntheticPricePath } from '../arena/montecarlo/buildSyntheticPath'

// =============================================================================
// run_mc_explainable_v1_3.ts
//
// Monte Carlo integration for Explainable VR v1.3  (Phase 1)
// - REGIME_STATE path generation
// - Per-path engine execution (explainable_vr_v1_3 vs vr_original_v2)
// - Distribution metrics + snapback metrics + risk comparison
// =============================================================================

const OUTPUT_DIR = join(process.cwd(), 'vr_backtest', 'results', 'mc_v1_3')
const N_PATHS = 500
const HORIZON_DAYS = 252  // 1년
const START_PRICE = 50
const RANDOM_SEED = 42
const CAP = '50' as const

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), 'marketflow', 'backend', 'output', filename), 'utf-8')) as T
}

function round(v: number, d = 2) {
  return Math.round(v * 10 ** d) / 10 ** d
}

function rollingMean(prices: number[], idx: number, window: number): number | null {
  if (idx < window - 1) return null
  let sum = 0
  for (let i = idx - window + 1; i <= idx; i++) sum += prices[i]
  return sum / window
}

// =============================================================================
// Per-path synthetic VRPlaybackEventView 구성
// generateRegimePaths → prices 배열 → explainable_vr v1.3 engine 입력
// =============================================================================
function buildSyntheticEventView(prices: number[], regimeStates: string[]): Parameters<typeof buildExecutionPlayback>[0] {
  const startDate = '2020-01-01'
  const initialCapital = 10000
  const initialShares = Math.floor(initialCapital * 0.8 / prices[0])
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
// Snapback window 계산 (validate_vr_original_v2.ts 동일 로직)
// =============================================================================
function computeSnapbackWindow(prices: number[]): { startBar: number; endBar: number } {
  let lowIdx = 0
  let lowPrice = prices[0]
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] < lowPrice) { lowPrice = prices[i]; lowIdx = i }
  }
  // window start = event low bar
  const windowStart = lowIdx
  // window end = rebound >= 15% OR start+20 bars
  let windowEnd = Math.min(windowStart + 20, prices.length - 1)
  for (let i = windowStart + 1; i < prices.length; i++) {
    if (lowPrice > 0 && (prices[i] / lowPrice) - 1 >= 0.15) { windowEnd = i; break }
  }
  return { startBar: windowStart, endBar: windowEnd }
}

// =============================================================================
// Per-path metrics 집계
// =============================================================================
type PathMetrics = {
  engine: 'explainable_v1_3' | 'vr_original_v2'
  finalValue: number
  maxDrawdownPct: number
  avgExposurePct: number
  buyCount: number
  defenseCount: number
  snapbackAvgExposure: number
  snapbackBuyCount: number
  snapbackCapturScore: number
  timeInMarketPct: number
}

function computeEngineMetrics(
  event: ReturnType<typeof buildSyntheticEventView>,
  engine: 'explainable_vr_v1' | 'vr_original_v2',
  engineLabel: PathMetrics['engine'],
  prices: number[],
): PathMetrics {
  const result = buildExecutionPlayback(event as any, CAP, { scenarioEngine: engine })
  const variant = result.variants[CAP]
  if (!variant) {
    return { engine: engineLabel, finalValue: 0, maxDrawdownPct: 0, avgExposurePct: 0, buyCount: 0, defenseCount: 0, snapbackAvgExposure: 0, snapbackBuyCount: 0, snapbackCapturScore: 0, timeInMarketPct: 0 }
  }

  const pts = variant.points
  const finalValue = pts[pts.length - 1]?.portfolio_value ?? 0
  const initValue = pts[0]?.portfolio_value ?? 10000

  // Max drawdown
  let peak = initValue
  let maxDD = 0
  for (const p of pts) {
    if (p.portfolio_value > peak) peak = p.portfolio_value
    const dd = peak > 0 ? (p.portfolio_value / peak) - 1 : 0
    if (dd < maxDD) maxDD = dd
  }

  // avg exposure
  const exposures = pts.map((p) => p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : 0)
  const avgExposure = exposures.reduce((a, b) => a + b, 0) / (exposures.length || 1)
  const timeInMarket = exposures.filter((e) => e > 5).length / (exposures.length || 1) * 100

  // snapback window
  const { startBar, endBar } = computeSnapbackWindow(prices)
  const snapPts = pts.slice(startBar, endBar + 1)
  const snapExposures = snapPts.map((p) => p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : 0)
  const snapAvgExp = snapExposures.reduce((a, b) => a + b, 0) / (snapExposures.length || 1)
  const snapBuys = snapPts.filter((p) => p.state_after_trade === 'buy_executed').length
  const windDays = endBar - startBar + 1
  const firstBuyInWindow = snapPts.findIndex((p) => p.state_after_trade === 'buy_executed')
  const earlyBonus = firstBuyInWindow >= 0 ? Math.max(0, 1 - firstBuyInWindow / windDays) : 0

  const captureScore = round(
    0.4 * Math.min(snapAvgExp / 100, 1) +
    0.3 * Math.min((variant.pool_usage_summary.cumulative_pool_spent / 1000), 1) +
    0.2 * earlyBonus +
    0.1 * (snapBuys > 0 ? 1 : 0),
    3
  )

  return {
    engine: engineLabel,
    finalValue: round(finalValue, 2),
    maxDrawdownPct: round(maxDD * 100, 2),
    avgExposurePct: round(avgExposure, 2),
    buyCount: variant.buy_markers.length,
    defenseCount: variant.defense_markers.length,
    snapbackAvgExposure: round(snapAvgExp, 2),
    snapbackBuyCount: snapBuys,
    snapbackCapturScore: captureScore,
    timeInMarketPct: round(timeInMarket, 2),
  }
}

// =============================================================================
// Distribution 집계
// =============================================================================
function summarize(values: number[]) {
  if (!values.length) return { mean: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const pct = (p: number) => sorted[Math.floor(p * (n - 1))]
  return {
    mean: round(values.reduce((a, b) => a + b, 0) / n, 3),
    p5: round(pct(0.05), 3),
    p25: round(pct(0.25), 3),
    p50: round(pct(0.50), 3),
    p75: round(pct(0.75), 3),
    p95: round(pct(0.95), 3),
    min: round(sorted[0], 3),
    max: round(sorted[n - 1], 3),
  }
}

function toCsv(rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  return [headers.join(','), ...rows.map((r) => headers.map((h) => r[h] ?? '').join(','))].join('\n') + '\n'
}

// =============================================================================
// MAIN
// =============================================================================
function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // 1. 역사 데이터 로드 → regime model 구축
  const standardArchive = readJson<RawStandardPlaybackArchive>('risk_v1_playback.json')
  const survivalArchive = readJson<RawVRSurvivalPlaybackArchive>('vr_survival_playback.json')
  const playbackView = buildVRPlaybackView({ standardArchive, survivalArchive, rootDir: process.cwd() })
  if (!playbackView) throw new Error('playback view load failed')

  // 역사 가격 series (첫 이벤트 기반 proxy)
  const firstEvent = playbackView.events[0]
  const historicalPrices = firstEvent.chart_data.map((p) => p.tqqq_n ?? 50)
  const historicalReturns = historicalPrices.map((p, i) =>
    i === 0 || historicalPrices[i - 1] <= 0 ? 0 : (p / historicalPrices[i - 1]) - 1
  )

  // 2. Regime model 구축
  const labels = labelHistoricalRegimes({ prices: historicalPrices })
  const regimeModel = {
    states: ['NORMAL', 'SELLOFF', 'PANIC', 'BOTTOMING', 'RECOVERY'] as const,
    transitionMatrix: buildTransitionMatrix(labels),
    stateStats: buildStateStats({ returns: historicalReturns, labels }),
  }

  // 3. Regime paths 생성
  console.log(`[MC v1.3] generating ${N_PATHS} regime paths (horizon=${HORIZON_DAYS})...`)
  const paths = generateRegimePaths({
    model: regimeModel as any,
    config: {
      horizonDays: HORIZON_DAYS,
      nPaths: N_PATHS,
      startPrice: START_PRICE,
      randomSeed: RANDOM_SEED,
    },
  })

  // 4. 각 path에서 두 엔진 실행
  const explMetrics: PathMetrics[] = []
  const v2Metrics: PathMetrics[] = []

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    if (i % 100 === 0) console.log(`[MC v1.3] path ${i + 1}/${N_PATHS}...`)

    const event = buildSyntheticEventView(path.prices, path.regimeStates ?? [])

    try {
      const explResult = computeEngineMetrics(event, 'explainable_vr_v1', 'explainable_v1_3', path.prices)
      explMetrics.push(explResult)
    } catch (e) {
      // path 실패 시 skip
    }

    try {
      const v2Result = computeEngineMetrics(event, 'vr_original_v2', 'vr_original_v2', path.prices)
      v2Metrics.push(v2Result)
    } catch (e) {
      // path 실패 시 skip
    }
  }

  console.log(`[MC v1.3] expl paths: ${explMetrics.length}, v2 paths: ${v2Metrics.length}`)

  // 5. Distribution 집계
  const explFinals = explMetrics.map((m) => m.finalValue)
  const v2Finals = v2Metrics.map((m) => m.finalValue)
  const explDDs = explMetrics.map((m) => m.maxDrawdownPct)
  const v2DDs = v2Metrics.map((m) => m.maxDrawdownPct)
  const explSnap = explMetrics.map((m) => m.snapbackCapturScore)
  const v2Snap = v2Metrics.map((m) => m.snapbackCapturScore)

  const summary = {
    engine_explainable_v1_3: {
      n_paths: explMetrics.length,
      final_value: summarize(explFinals),
      max_drawdown_pct: summarize(explDDs),
      avg_exposure_pct: summarize(explMetrics.map((m) => m.avgExposurePct)),
      time_in_market_pct: summarize(explMetrics.map((m) => m.timeInMarketPct)),
      buy_count: summarize(explMetrics.map((m) => m.buyCount)),
      defense_count: summarize(explMetrics.map((m) => m.defenseCount)),
      snapback_capture_score: summarize(explSnap),
      snapback_avg_exposure: summarize(explMetrics.map((m) => m.snapbackAvgExposure)),
      snapback_success_rate: round(explSnap.filter((s) => s >= 0.3).length / (explSnap.length || 1) * 100, 2),
      tail_loss_5pct: summarize(explFinals).p5,
      tail_loss_1pct: round(explFinals.sort((a, b) => a - b)[Math.floor(explFinals.length * 0.01)] ?? 0, 2),
      worst_case_drawdown: summarize(explDDs).min,
    },
    engine_vr_original_v2: {
      n_paths: v2Metrics.length,
      final_value: summarize(v2Finals),
      max_drawdown_pct: summarize(v2DDs),
      avg_exposure_pct: summarize(v2Metrics.map((m) => m.avgExposurePct)),
      time_in_market_pct: summarize(v2Metrics.map((m) => m.timeInMarketPct)),
      buy_count: summarize(v2Metrics.map((m) => m.buyCount)),
      defense_count: summarize(v2Metrics.map((m) => m.defenseCount)),
      snapback_capture_score: summarize(v2Snap),
      snapback_avg_exposure: summarize(v2Metrics.map((m) => m.snapbackAvgExposure)),
      snapback_success_rate: round(v2Snap.filter((s) => s >= 0.3).length / (v2Snap.length || 1) * 100, 2),
      tail_loss_5pct: summarize(v2Finals).p5,
      tail_loss_1pct: round(v2Finals.sort((a, b) => a - b)[Math.floor(v2Finals.length * 0.01)] ?? 0, 2),
      worst_case_drawdown: summarize(v2DDs).min,
    },
  }

  // Success criteria evaluation (Work Order §8)
  const e = summary.engine_explainable_v1_3
  const v2 = summary.engine_vr_original_v2
  const successCriteria = {
    '1_tail_risk_down': { result: e.tail_loss_5pct > v2.tail_loss_5pct, expl: e.tail_loss_5pct, v2: v2.tail_loss_5pct },
    '2_max_dd_down': { result: e.max_drawdown_pct.p50 > v2.max_drawdown_pct.p50, expl: e.max_drawdown_pct.p50, v2: v2.max_drawdown_pct.p50 },
    '3_recovery_speed': { result: e.time_in_market_pct.mean >= v2.time_in_market_pct.mean * 0.5, expl: e.time_in_market_pct.mean, v2: v2.time_in_market_pct.mean },
    '4_snapback_80pct': { result: e.snapback_capture_score.mean >= v2.snapback_capture_score.mean * 0.8, expl: e.snapback_capture_score.mean, v2: v2.snapback_capture_score.mean },
    '5_time_in_market_down': { result: e.time_in_market_pct.mean < v2.time_in_market_pct.mean, expl: e.time_in_market_pct.mean, v2: v2.time_in_market_pct.mean },
  }

  // 6. CSV 파일 생성
  // arena_mc_distribution.csv — per-engine distribution rows
  const distRows = [
    { engine: 'explainable_v1_3', metric: 'final_value', ...summarize(explFinals) },
    { engine: 'explainable_v1_3', metric: 'max_drawdown_pct', ...summarize(explDDs) },
    { engine: 'explainable_v1_3', metric: 'avg_exposure_pct', ...summarize(explMetrics.map((m) => m.avgExposurePct)) },
    { engine: 'explainable_v1_3', metric: 'snapback_capture_score', ...summarize(explSnap) },
    { engine: 'explainable_v1_3', metric: 'time_in_market_pct', ...summarize(explMetrics.map((m) => m.timeInMarketPct)) },
    { engine: 'vr_original_v2', metric: 'final_value', ...summarize(v2Finals) },
    { engine: 'vr_original_v2', metric: 'max_drawdown_pct', ...summarize(v2DDs) },
    { engine: 'vr_original_v2', metric: 'avg_exposure_pct', ...summarize(v2Metrics.map((m) => m.avgExposurePct)) },
    { engine: 'vr_original_v2', metric: 'snapback_capture_score', ...summarize(v2Snap) },
    { engine: 'vr_original_v2', metric: 'time_in_market_pct', ...summarize(v2Metrics.map((m) => m.timeInMarketPct)) },
  ]

  // arena_mc_snapback.csv — snapback comparison
  const snapRows = [
    { engine: 'explainable_v1_3', snapback_success_rate: e.snapback_success_rate, snapback_score_mean: e.snapback_capture_score.mean, snapback_score_p25: e.snapback_capture_score.p25, snapback_score_p75: e.snapback_capture_score.p75, snapback_avg_exposure_mean: e.snapback_avg_exposure.mean },
    { engine: 'vr_original_v2', snapback_success_rate: v2.snapback_success_rate, snapback_score_mean: v2.snapback_capture_score.mean, snapback_score_p25: v2.snapback_capture_score.p25, snapback_score_p75: v2.snapback_capture_score.p75, snapback_avg_exposure_mean: v2.snapback_avg_exposure.mean },
  ]

  writeFileSync(join(OUTPUT_DIR, 'arena_mc_summary.json'), JSON.stringify({ summary, successCriteria }, null, 2))
  writeFileSync(join(OUTPUT_DIR, 'arena_mc_distribution.csv'), toCsv(distRows))
  writeFileSync(join(OUTPUT_DIR, 'arena_mc_snapback.csv'), toCsv(snapRows))

  console.log(`\n[MC v1.3] wrote ${OUTPUT_DIR}`)
  console.log('\n=== SUCCESS CRITERIA ===')
  for (const [key, val] of Object.entries(successCriteria)) {
    const icon = val.result ? '✅' : '❌'
    console.log(`  ${icon} ${key}: expl=${val.expl}  v2=${val.v2}`)
  }

  console.log('\n=== DISTRIBUTION SUMMARY ===')
  console.log(`  explainable_v1_3:`)
  console.log(`    final_value   p50=${e.final_value.p50}  p5=${e.tail_loss_5pct}  worst_dd=${e.worst_case_drawdown}%`)
  console.log(`    snapback      score=${e.snapback_capture_score.mean}  success_rate=${e.snapback_success_rate}%`)
  console.log(`    exposure      avg=${e.avg_exposure_pct.mean}%  time_in_mkt=${e.time_in_market_pct.mean}%`)
  console.log(`  vr_original_v2:`)
  console.log(`    final_value   p50=${v2.final_value.p50}  p5=${v2.tail_loss_5pct}  worst_dd=${v2.worst_case_drawdown}%`)
  console.log(`    snapback      score=${v2.snapback_capture_score.mean}  success_rate=${v2.snapback_success_rate}%`)
  console.log(`    exposure      avg=${v2.avg_exposure_pct.mean}%  time_in_mkt=${v2.time_in_market_pct.mean}%`)
}

main()
