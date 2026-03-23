import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  buildVRPlaybackView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
  type VRPlaybackEventView,
} from './vr_playback_loader'
import { buildExecutionPlayback } from './build_execution_playback'
import type { ExecutionPlaybackVariant } from '../types/execution_playback'
import { readFileSync } from 'fs'

// =============================================================================
// validate_event_benchmark.ts
//
// Work Order: Event Market Benchmark Validation (FINAL)
// 3 episodes: 2011 / 2020 / 2025  (excluding 2022 Fed Bear)
// 3 engines:  VR Original v2 | Explainable VR (v1.5) | MA200 (50%)
// Goal: Prove Explainable VR wins where it matters
// =============================================================================

const TARGET_EPISODES = [
  { eventId: '2011-06', label: '2011 Debt Ceiling' },
  { eventId: '2020-02', label: '2020 Covid Crash' },
  { eventId: '2025-01', label: '2025 Tariff Shock' },
]

const CAP = '50' as const
const INITIAL_CAPITAL = 10000
const OUTPUT_DIR = join(process.cwd(), 'vr_backtest', 'results', 'event_benchmark')
const DOCS_DIR = join(process.cwd(), 'docs')

// =============================================================================
// UTILITY
// =============================================================================
function readJson<T>(filename: string): T {
  const base = join(process.cwd(), 'marketflow', 'backend', 'output')
  return JSON.parse(readFileSync(join(base, filename), 'utf-8')) as T
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function average(values: Array<number | null>): number | null {
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

function markdownTable(rows: Array<Record<string, string | number | null | boolean>>) {
  if (!rows.length) return 'No rows.'
  const headers = Object.keys(rows[0])
  const fmt = (v: string | number | null | boolean) => (v == null ? '-' : String(v))
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${headers.map((h) => fmt(r[h] as string | number | null | boolean)).join(' | ')} |`),
  ].join('\n')
}

// =============================================================================
// MA200 (50%) STRATEGY ENGINE
// Standalone simulation: hold 50% allocation when price >= MA200, else 0%
// Crossover-based: trade on crossover day only
// =============================================================================
type MA200SimResult = {
  final_value: number
  period_return_pct: number
  max_drawdown_pct: number
  recovery_days: number | null
  avg_exposure_pct: number
  buy_count: number
  sell_count: number
  portfolio_values: number[]
  exposure_series: number[]
}

function runMA200Engine(event: VRPlaybackEventView): MA200SimResult {
  const points = event.chart_data.filter((p) => p.in_event)
  if (!points.length) {
    return {
      final_value: INITIAL_CAPITAL,
      period_return_pct: 0,
      max_drawdown_pct: 0,
      recovery_days: null,
      avg_exposure_pct: 0,
      buy_count: 0,
      sell_count: 0,
      portfolio_values: [INITIAL_CAPITAL],
      exposure_series: [0],
    }
  }

  // Use qqq_n (normalized price) or raw price — qqq_n is normalized to 100 at start
  // We track allocation as shares * price + cash
  const firstPrice = points[0].qqq_n ?? 100
  const initialShares = Math.floor(INITIAL_CAPITAL * 0.5 / firstPrice)
  const initialCash = INITIAL_CAPITAL - initialShares * firstPrice

  let shares = initialShares
  let cash = initialCash
  let prevAboveMa200: boolean | null = null
  let buyCount = 0
  let sellCount = 0

  const portfolioValues: number[] = []
  const exposureList: number[] = []

  for (const point of points) {
    const price = point.qqq_n ?? firstPrice
    const ma200 = point.ma200_n
    const aboveMa200 = ma200 != null && ma200 > 0 && price >= ma200

    // Crossover logic
    if (prevAboveMa200 !== null && aboveMa200 !== prevAboveMa200) {
      if (aboveMa200) {
        // Buy: deploy 50% of total portfolio into equity
        const totalValue = cash + shares * price
        const targetEquity = totalValue * 0.5
        const currentEquity = shares * price
        const toDeploy = targetEquity - currentEquity
        if (toDeploy > 0 && price > 0) {
          const sharesToBuy = Math.floor(toDeploy / price)
          shares += sharesToBuy
          cash -= sharesToBuy * price
          if (sharesToBuy > 0) buyCount++
        }
      } else {
        // Sell all shares to cash
        if (shares > 0 && price > 0) {
          cash += shares * price
          shares = 0
          sellCount++
        }
      }
    }

    prevAboveMa200 = aboveMa200

    const totalValue = cash + shares * price
    portfolioValues.push(totalValue)
    const exposure = totalValue > 0 ? (shares * price) / totalValue * 100 : 0
    exposureList.push(exposure)
  }

  // Compute max drawdown
  let peak = portfolioValues[0] ?? INITIAL_CAPITAL
  let maxDrawdown = 0
  let troughIndex = 0
  for (let i = 0; i < portfolioValues.length; i++) {
    const v = portfolioValues[i]
    if (v > peak) peak = v
    const dd = peak > 0 ? (v / peak) - 1 : 0
    if (dd < maxDrawdown) { maxDrawdown = dd; troughIndex = i }
  }

  // Recovery days from trough
  const target = (portfolioValues[0] ?? INITIAL_CAPITAL) * 0.95
  let recoveryDays: number | null = null
  for (let i = troughIndex; i < portfolioValues.length; i++) {
    if (portfolioValues[i] >= target) { recoveryDays = i - troughIndex; break }
  }

  const finalValue = portfolioValues[portfolioValues.length - 1] ?? INITIAL_CAPITAL
  const initialValue = portfolioValues[0] ?? INITIAL_CAPITAL

  return {
    final_value: round(finalValue, 2),
    period_return_pct: initialValue > 0 ? round(((finalValue / initialValue) - 1) * 100, 2) : 0,
    max_drawdown_pct: round(maxDrawdown * 100, 2),
    recovery_days: recoveryDays,
    avg_exposure_pct: round(average(exposureList) ?? 0, 2),
    buy_count: buyCount,
    sell_count: sellCount,
    portfolio_values: portfolioValues,
    exposure_series: exposureList,
  }
}

// =============================================================================
// SNAPBACK WINDOW (Work Order spec)
// Start: event low bar
// End:   first bar where rebound from low >= 15%, or max 60 bars
// =============================================================================
function findSnapbackWindow(event: VRPlaybackEventView): { startBar: number | null; endBar: number | null; lowPrice: number } {
  const points = event.chart_data.filter((p) => p.in_event)
  if (!points.length) return { startBar: null, endBar: null, lowPrice: 0 }

  // Find event low
  let lowBar = 0
  let lowPrice = points[0].qqq_n ?? Infinity
  for (let i = 0; i < points.length; i++) {
    const price = points[i].qqq_n ?? Infinity
    if (price < lowPrice) { lowPrice = price; lowBar = i }
  }

  // Find end: first bar where (price / lowPrice - 1) >= 0.15, max 60 bars from low
  let endBar: number | null = null
  for (let i = lowBar + 1; i < points.length && i <= lowBar + 60; i++) {
    const price = points[i].qqq_n ?? lowPrice
    if (lowPrice > 0 && (price / lowPrice) - 1 >= 0.15) {
      endBar = i
      break
    }
  }
  if (endBar == null) endBar = Math.min(lowBar + 60, points.length - 1)

  return { startBar: lowBar, endBar, lowPrice }
}

// =============================================================================
// VARIANT STATS (for VR-based engines)
// =============================================================================
type EngineStats = {
  engine: string
  final_value: number
  period_return_pct: number
  max_drawdown_pct: number
  recovery_days: number | null
  avg_exposure_pct: number | null
  buy_count: number
  sell_count: number
  snapback_avg_exposure: number | null
  snapback_buy_count: number
  snapback_window_days: number | null
}

function variantStats(
  engine: string,
  variant: ExecutionPlaybackVariant,
  snapStart: number | null,
  snapEnd: number | null,
): EngineStats {
  const eventPoints = variant.points.filter((p) => p.in_event)
  const series = eventPoints.length > 0 ? eventPoints : variant.points

  const initialValue = series[0]?.portfolio_value ?? INITIAL_CAPITAL
  const finalValue = series[series.length - 1]?.portfolio_value ?? INITIAL_CAPITAL

  let peak = initialValue
  let maxDrawdown = 0
  let troughIndex = 0
  for (let i = 0; i < series.length; i++) {
    const v = series[i].portfolio_value
    if (v > peak) peak = v
    const dd = peak > 0 ? (v / peak) - 1 : 0
    if (dd < maxDrawdown) { maxDrawdown = dd; troughIndex = i }
  }

  const target = initialValue * 0.95
  let recoveryDays: number | null = null
  for (let i = troughIndex; i < series.length; i++) {
    if (series[i].portfolio_value >= target) { recoveryDays = i - troughIndex; break }
  }

  const avgExp = average(series.map((p) =>
    p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : null
  ))

  // Snapback window metrics
  let snapAvgExposure: number | null = null
  let snapBuyCount = 0
  let snapWindowDays: number | null = null

  if (snapStart != null && snapEnd != null && snapEnd >= snapStart) {
    const snapPoints = eventPoints.slice(snapStart, snapEnd + 1)
    snapWindowDays = snapEnd - snapStart + 1
    snapAvgExposure = average(snapPoints.map((p) =>
      p.portfolio_value > 0 ? (p.evaluation_value / p.portfolio_value) * 100 : null
    ))
    snapBuyCount = snapPoints.filter((p) => p.state_after_trade === 'buy_executed').length
  }

  return {
    engine,
    final_value: round(finalValue, 2),
    period_return_pct: initialValue > 0 ? round(((finalValue / initialValue) - 1) * 100, 2) : 0,
    max_drawdown_pct: round(maxDrawdown * 100, 2),
    recovery_days: recoveryDays,
    avg_exposure_pct: avgExp,
    buy_count: variant.buy_markers.length,
    sell_count: variant.sell_markers.length,
    snapback_avg_exposure: snapAvgExposure,
    snapback_buy_count: snapBuyCount,
    snapback_window_days: snapWindowDays,
  }
}

function ma200Stats(
  engine: string,
  sim: MA200SimResult,
  snapStart: number | null,
  snapEnd: number | null,
): EngineStats {
  let snapAvgExposure: number | null = null
  let snapBuyCount = 0
  let snapWindowDays: number | null = null

  if (snapStart != null && snapEnd != null && snapEnd >= snapStart) {
    snapWindowDays = snapEnd - snapStart + 1
    const snapExposures = sim.exposure_series.slice(snapStart, snapEnd + 1)
    snapAvgExposure = average(snapExposures)
    // Approximate buy count in window using exposure changes
    let buys = 0
    for (let i = snapStart + 1; i <= Math.min(snapEnd, sim.exposure_series.length - 1); i++) {
      const prev = sim.exposure_series[i - 1] ?? 0
      const curr = sim.exposure_series[i] ?? 0
      if (curr > prev + 5) buys++  // exposure jumped up = buy event
    }
    snapBuyCount = buys
  }

  return {
    engine,
    final_value: sim.final_value,
    period_return_pct: sim.period_return_pct,
    max_drawdown_pct: sim.max_drawdown_pct,
    recovery_days: sim.recovery_days,
    avg_exposure_pct: sim.avg_exposure_pct,
    buy_count: sim.buy_count,
    sell_count: sim.sell_count,
    snapback_avg_exposure: snapAvgExposure,
    snapback_buy_count: snapBuyCount,
    snapback_window_days: snapWindowDays,
  }
}

// =============================================================================
// KPI EVALUATION (Work Order §6)
// KPI-1: Expl vs MA200 — Final UP (expl_final > ma200_final)
// KPI-2: Expl vs MA200 — Recovery faster (expl_recovery_days < ma200_recovery_days)
// KPI-3: Expl vs VR — DD DOWN (expl_dd > vr_dd, i.e. less negative)
// KPI-4: Expl vs VR — Snapback >= 70% (expl_snap_exposure / vr_snap_exposure >= 0.70)
// =============================================================================
type KPIResult = {
  episode: string
  kpi1_final_up: boolean
  kpi1_expl_final: number
  kpi1_ma200_final: number
  kpi2_recovery_faster: boolean
  kpi2_expl_days: number | null
  kpi2_ma200_days: number | null
  kpi3_dd_down: boolean
  kpi3_expl_dd: number
  kpi3_vr_dd: number
  kpi4_snapback_ratio: number | null
  kpi4_pass: boolean
  all_pass: boolean
}

function evaluateKPI(
  episodeLabel: string,
  expl: EngineStats,
  ma200: EngineStats,
  vrv2: EngineStats,
): KPIResult {
  const kpi1 = expl.final_value > ma200.final_value
  const kpi2 = expl.recovery_days != null && ma200.recovery_days != null
    ? expl.recovery_days < ma200.recovery_days
    : expl.recovery_days != null  // if ma200 never recovered, expl wins
  const kpi3 = expl.max_drawdown_pct > vrv2.max_drawdown_pct  // less negative = better

  const snapRatio = (vrv2.snapback_avg_exposure != null && vrv2.snapback_avg_exposure > 0)
    ? round((expl.snapback_avg_exposure ?? 0) / vrv2.snapback_avg_exposure, 3)
    : null
  const kpi4 = snapRatio != null ? snapRatio >= 0.70 : (expl.snapback_avg_exposure ?? 0) >= 30  // fallback

  return {
    episode: episodeLabel,
    kpi1_final_up: kpi1,
    kpi1_expl_final: expl.final_value,
    kpi1_ma200_final: ma200.final_value,
    kpi2_recovery_faster: kpi2,
    kpi2_expl_days: expl.recovery_days,
    kpi2_ma200_days: ma200.recovery_days,
    kpi3_dd_down: kpi3,
    kpi3_expl_dd: expl.max_drawdown_pct,
    kpi3_vr_dd: vrv2.max_drawdown_pct,
    kpi4_snapback_ratio: snapRatio,
    kpi4_pass: kpi4,
    all_pass: kpi1 && kpi2 && kpi3 && kpi4,
  }
}

// =============================================================================
// REPORT BUILDER
// =============================================================================
function buildReport(
  rows: Array<{ episode: string; vr_v2: EngineStats; expl: EngineStats; ma200: EngineStats }>,
  kpis: KPIResult[],
): string {
  const allPass = kpis.every((k) => k.all_pass)
  const passCount = kpis.filter((k) => k.all_pass).length

  const summaryTable = rows.map((r) => ({
    episode: r.episode,
    'VR v2 final': r.vr_v2.final_value,
    'Expl final': r.expl.final_value,
    'MA200 final': r.ma200.final_value,
    'Expl vs MA200': round(r.expl.final_value - r.ma200.final_value, 2),
    'VR v2 DD%': r.vr_v2.max_drawdown_pct,
    'Expl DD%': r.expl.max_drawdown_pct,
    'MA200 DD%': r.ma200.max_drawdown_pct,
    'VR v2 recov': r.vr_v2.recovery_days,
    'Expl recov': r.expl.recovery_days,
    'MA200 recov': r.ma200.recovery_days,
  }))

  const snapTable = rows.map((r) => ({
    episode: r.episode,
    'VR v2 snap_exp%': r.vr_v2.snapback_avg_exposure,
    'Expl snap_exp%': r.expl.snapback_avg_exposure,
    'MA200 snap_exp%': r.ma200.snapback_avg_exposure,
    'snap_window_days': r.expl.snapback_window_days,
    'VR v2 snap_buys': r.vr_v2.snapback_buy_count,
    'Expl snap_buys': r.expl.snapback_buy_count,
  }))

  const kpiTable = kpis.map((k) => ({
    episode: k.episode,
    'KPI-1 final_up': k.kpi1_final_up ? 'PASS' : 'FAIL',
    'KPI-2 recov_faster': k.kpi2_recovery_faster ? 'PASS' : 'FAIL',
    'KPI-3 dd_down': k.kpi3_dd_down ? 'PASS' : 'FAIL',
    'KPI-4 snap_ratio': k.kpi4_snapback_ratio != null ? `${k.kpi4_snapback_ratio} (${k.kpi4_pass ? 'PASS' : 'FAIL'})` : 'N/A',
    'ALL': k.all_pass ? 'PASS ✅' : 'FAIL ❌',
  }))

  const verdict = allPass
    ? '## VERDICT: ACCEPT — Explainable VR wins on all 4 KPIs across all 3 episodes'
    : `## VERDICT: PARTIAL — ${passCount}/${kpis.length} episodes pass all KPIs`

  return `# Event Market Benchmark Validation Report

**Goal:** Prove Explainable VR wins where it matters
**Episodes:** 2011 Debt Ceiling | 2020 Covid Crash | 2025 Tariff Shock
**Engines:** VR Original v2 | Explainable VR (v1.5 primary) | MA200 (50%)
**Date:** ${new Date().toISOString().slice(0, 10)}

---

## 1. Episode Performance Summary

${markdownTable(summaryTable)}

---

## 2. Snapback Window Analysis

Snapback window: from event low bar to first bar where rebound >= 15% (max 60 bars)

${markdownTable(snapTable)}

---

## 3. KPI Evaluation

| KPI | Rule |
| --- | --- |
| KPI-1 | Expl final_value > MA200 final_value |
| KPI-2 | Expl recovery_days < MA200 recovery_days |
| KPI-3 | Expl max_dd > VR v2 max_dd (less negative = lower risk) |
| KPI-4 | Expl snapback exposure >= 70% of VR v2 snapback exposure |

${markdownTable(kpiTable)}

---

${verdict}

---

*Engines: vr_original_v2 is FROZEN. Explainable VR primary = v1.5 (enableMacroGating=true).*
`
}

// =============================================================================
// MAIN
// =============================================================================
function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  mkdirSync(DOCS_DIR, { recursive: true })

  const standardArchive = readJson<RawStandardPlaybackArchive>('risk_v1_playback.json')
  const survivalArchive = readJson<RawVRSurvivalPlaybackArchive>('vr_survival_playback.json')
  const playbackView = buildVRPlaybackView({ standardArchive, survivalArchive, rootDir: process.cwd() })

  if (!playbackView) throw new Error('buildVRPlaybackView returned null')

  const rows: Array<{ episode: string; vr_v2: EngineStats; expl: EngineStats; ma200: EngineStats }> = []
  const kpis: KPIResult[] = []
  const csvRows: Array<Record<string, string | number | null>> = []

  for (const spec of TARGET_EPISODES) {
    const event = playbackView.events.find((e) => e.event_id === spec.eventId)
    if (!event) {
      console.warn(`[SKIP] event not found: ${spec.eventId}`)
      continue
    }

    console.log(`\n[${spec.eventId}] ${spec.label}`)

    // 1. Run engines
    const vrV2Variant = buildExecutionPlayback(event, CAP, { scenarioEngine: 'vr_original_v2' }).variants[CAP]
    const explVariant = buildExecutionPlayback(event, CAP, { scenarioEngine: 'explainable_vr_v1' }).variants[CAP]
    const ma200Sim = runMA200Engine(event)

    if (!vrV2Variant || !explVariant) {
      console.warn(`[SKIP] variant build failed for ${spec.eventId}`)
      continue
    }

    // 2. Snapback window (shared across engines, based on chart_data)
    const { startBar, endBar } = findSnapbackWindow(event)
    console.log(`  snapback window: bar ${startBar} → ${endBar} (${endBar != null && startBar != null ? endBar - startBar + 1 : 0} days)`)

    // 3. Compute per-engine stats
    const vrStats = variantStats('vr_original_v2', vrV2Variant, startBar, endBar)
    const explStats = variantStats('explainable_vr_v1.5', explVariant, startBar, endBar)
    const ma200StatsObj = ma200Stats('ma200_50pct', ma200Sim, startBar, endBar)

    console.log(`  VR v2     : final=${vrStats.final_value}  dd=${vrStats.max_drawdown_pct}%  snap_exp=${vrStats.snapback_avg_exposure}%  recov=${vrStats.recovery_days}d`)
    console.log(`  Expl v1.5 : final=${explStats.final_value}  dd=${explStats.max_drawdown_pct}%  snap_exp=${explStats.snapback_avg_exposure}%  recov=${explStats.recovery_days}d`)
    console.log(`  MA200 50% : final=${ma200StatsObj.final_value}  dd=${ma200StatsObj.max_drawdown_pct}%  snap_exp=${ma200StatsObj.snapback_avg_exposure}%  recov=${ma200StatsObj.recovery_days}d`)

    // 4. KPI evaluation
    const kpi = evaluateKPI(spec.label, explStats, ma200StatsObj, vrStats)
    console.log(`  KPI: 1=${kpi.kpi1_final_up} 2=${kpi.kpi2_recovery_faster} 3=${kpi.kpi3_dd_down} 4=${kpi.kpi4_pass}  ALL=${kpi.all_pass}`)

    rows.push({ episode: spec.label, vr_v2: vrStats, expl: explStats, ma200: ma200StatsObj })
    kpis.push(kpi)

    csvRows.push({
      event_id: spec.eventId,
      event_label: spec.label,
      // VR v2
      vrv2_final: vrStats.final_value,
      vrv2_return_pct: vrStats.period_return_pct,
      vrv2_max_dd: vrStats.max_drawdown_pct,
      vrv2_recovery_days: vrStats.recovery_days,
      vrv2_avg_exposure: vrStats.avg_exposure_pct,
      vrv2_buy_count: vrStats.buy_count,
      vrv2_snap_avg_exp: vrStats.snapback_avg_exposure,
      vrv2_snap_buys: vrStats.snapback_buy_count,
      vrv2_snap_days: vrStats.snapback_window_days,
      // Explainable VR
      expl_final: explStats.final_value,
      expl_return_pct: explStats.period_return_pct,
      expl_max_dd: explStats.max_drawdown_pct,
      expl_recovery_days: explStats.recovery_days,
      expl_avg_exposure: explStats.avg_exposure_pct,
      expl_buy_count: explStats.buy_count,
      expl_snap_avg_exp: explStats.snapback_avg_exposure,
      expl_snap_buys: explStats.snapback_buy_count,
      expl_snap_days: explStats.snapback_window_days,
      // MA200
      ma200_final: ma200StatsObj.final_value,
      ma200_return_pct: ma200StatsObj.period_return_pct,
      ma200_max_dd: ma200StatsObj.max_drawdown_pct,
      ma200_recovery_days: ma200StatsObj.recovery_days,
      ma200_avg_exposure: ma200StatsObj.avg_exposure_pct,
      ma200_buy_count: ma200StatsObj.buy_count,
      ma200_snap_avg_exp: ma200StatsObj.snapback_avg_exposure,
      ma200_snap_buys: ma200StatsObj.snapback_buy_count,
      // KPI
      kpi1_final_up: kpi.kpi1_final_up,
      kpi2_recovery_faster: kpi.kpi2_recovery_faster,
      kpi3_dd_down: kpi.kpi3_dd_down,
      kpi4_snapback_ratio: kpi.kpi4_snapback_ratio,
      kpi4_pass: kpi.kpi4_pass,
      all_pass: kpi.all_pass,
    })
  }

  // Write outputs
  const csvPath = join(OUTPUT_DIR, 'event_benchmark_summary.csv')
  const kpiPath = join(OUTPUT_DIR, 'event_kpi_result.json')
  const reportPath = join(DOCS_DIR, 'event_validation_report.md')

  writeFileSync(csvPath, toCsv(csvRows))
  writeFileSync(kpiPath, JSON.stringify({ episodes: kpis, all_pass: kpis.every((k) => k.all_pass) }, null, 2))
  writeFileSync(reportPath, buildReport(rows, kpis))

  console.log(`\n[OUTPUT] ${csvPath}`)
  console.log(`[OUTPUT] ${kpiPath}`)
  console.log(`[OUTPUT] ${reportPath}`)

  const allPass = kpis.every((k) => k.all_pass)
  const passCount = kpis.filter((k) => k.all_pass).length
  console.log(`\n=== BENCHMARK RESULT: ${allPass ? 'ACCEPT ✅' : `PARTIAL ${passCount}/${kpis.length}`} ===`)
  if (!allPass) {
    for (const k of kpis.filter((k) => !k.all_pass)) {
      console.log(`  [FAIL] ${k.episode}: KPI1=${k.kpi1_final_up} KPI2=${k.kpi2_recovery_faster} KPI3=${k.kpi3_dd_down} KPI4=${k.kpi4_pass}`)
    }
  }
}

main()
