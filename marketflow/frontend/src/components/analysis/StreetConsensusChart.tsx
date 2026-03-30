'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  AnalysisMode,
  StockAnalysisResponse,
  calcUpsidePct,
  fetchStockAnalysis,
  formatPct,
  formatPrice,
  normalizeTicker,
} from '@/lib/stockAnalysis'

type Props = {
  symbol?: string
  fetchKey?: number
  mode?: AnalysisMode
  analysis?: StockAnalysisResponse | null
  loading?: boolean
  error?: string | null
  compact?: boolean
}

type ChartPoint = { date: string; close: number }

type Forecast3Y = {
  y1: { high: number | null; base: number | null; low: number | null }
  y2: { high: number | null; base: number | null; low: number | null }
  y3: { high: number | null; base: number | null; low: number | null }
}

type EpsEntry = {
  year?: number | null
  eps?: number | null
  eps_low?: number | null
  eps_high?: number | null
  kind?: string
}

function toNumber(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (isNaN(d.getTime())) return dateStr
  return new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit' })
    .format(d)
    .replace(/(\d{2})$/, "'$1")
}

function buildHistory(raw: Array<{ date?: string | null; close?: number | null }>): ChartPoint[] {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 13)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const cleaned = raw
    .map(p => ({ date: String(p?.date ?? '').trim(), close: toNumber(p?.close) }))
    .filter((p): p is ChartPoint => Boolean(p.date) && p.close != null && p.close > 0 && p.date >= cutoffStr)

  if (cleaned.length <= 80) return cleaned
  const step = Math.max(1, Math.ceil(cleaned.length / 80))
  const sampled = cleaned.filter((_, i) => i % step === 0)
  if (sampled[0]?.date !== cleaned[0]?.date) sampled.unshift(cleaned[0])
  if (sampled[sampled.length - 1]?.date !== cleaned[cleaned.length - 1]?.date) sampled.push(cleaned[cleaned.length - 1])
  return sampled
}

function buildForecast3Y(args: {
  current: number | null
  currentPe: number | null
  refPe: number | null
  consensusHigh: number | null
  consensusMean: number | null
  consensusLow: number | null
  epsLadder: EpsEntry[]
}): Forecast3Y | null {
  const { current, currentPe, refPe, consensusHigh, consensusMean, consensusLow, epsLadder } = args
  if (!current) return null

  let y1: Forecast3Y['y1'] = { high: consensusHigh, base: consensusMean, low: consensusLow }

  const pe = currentPe != null && currentPe > 3 && currentPe < 500 ? currentPe : 20
  const ref = refPe != null && refPe > 3 && refPe < 300 ? refPe : pe * 0.85

  const bull2 = pe * 0.90
  const base2 = ref * 0.6 + pe * 0.4
  const bear2 = ref * 0.80
  const bull3 = bull2 * 0.95
  const base3 = ref
  const bear3 = bear2 * 0.90

  const nowYear = new Date().getFullYear()
  const estimates = epsLadder.filter(
    (e): e is EpsEntry & { year: number; eps: number } =>
      e.kind !== 'actual' && e.eps != null && e.year != null,
  )

  // Also include actuals for fy1 fallback (current year may still be 'actual')
  const allEntries = epsLadder.filter(
    (e): e is EpsEntry & { year: number; eps: number } =>
      e.eps != null && e.year != null,
  )

  const findFY = (yr: number) =>
    estimates.find(e => e.year === yr) ??
    estimates.find(e => e.year === yr - 1) ??
    null

  // fy1: current/next year estimate for Y1 fallback when no price targets
  const fy1 =
    estimates.find(e => e.year === nowYear) ??
    estimates.find(e => e.year === nowYear + 1) ??
    allEntries.find(e => e.year === nowYear) ??
    allEntries[allEntries.length - 1] ??
    null

  const fy2 = findFY(nowYear + 1)
  const fy3 = findFY(nowYear + 2)

  function prices(
    entry: (EpsEntry & { year: number; eps: number }) | null,
    bullPe: number, basePe: number, bearPe: number,
  ): Forecast3Y['y1'] {
    if (!entry) return { high: null, base: null, low: null }
    const avg = entry.eps
    const hi = entry.eps_high != null ? entry.eps_high : avg * 1.28
    const lo = entry.eps_low != null ? entry.eps_low : avg * 0.76
    return {
      high: hi > 0 ? hi * bullPe : null,
      base: avg > 0 ? avg * basePe : null,
      low: lo > 0 ? lo * bearPe : null,
    }
  }

  // Y1: analyst price targets preferred; fall back to EPS × PE
  if (y1.base == null && y1.high == null && y1.low == null) {
    if (fy1 != null) {
      // Use EPS × compressed current PE as 1Y price proxy
      y1 = prices(fy1, pe * 0.92, pe * 0.87, pe * 0.72)
    }
  }

  let y2 = prices(fy2, bull2, base2, bear2)
  let y3 = prices(fy3, bull3, base3, bear3)

  // Fallback: project from y1 if y2 EPS missing
  if (y2.base == null && y1.base != null) {
    y2 = {
      high: y1.high != null ? y1.high * 1.14 : null,
      base: y1.base * 1.09,
      low: y1.low != null ? y1.low * 1.01 : null,
    }
  }
  if (y3.base == null && y2.base != null) {
    y3 = {
      high: y2.high != null ? y2.high * 1.12 : null,
      base: y2.base * 1.08,
      low: y2.low != null ? y2.low * 1.01 : null,
    }
  }

  // Final fallback: simple price projection if absolutely no data
  if (y1.base == null && y2.base == null && current != null) {
    y1 = { high: current * 1.18, base: current * 1.07, low: current * 0.87 }
    y2 = { high: current * 1.32, base: current * 1.14, low: current * 0.80 }
    y3 = { high: current * 1.48, base: current * 1.22, low: current * 0.74 }
  }

  return { y1, y2, y3 }
}

// Chart layout constants (module-level — not reactive)
const W = 1100
const H = 320
const PL = 58
const PR = 120
const PT = 28
const PB = 48
const PW = W - PL - PR
const PH = H - PT - PB
const HW = PW * 0.38
const FW = PW * 0.62
const SW = FW / 3
const X0 = PL
const XN = PL + HW
const X1 = XN + SW
const X2 = XN + SW * 2
const X3 = XN + FW

function ForecastChart({
  history,
  current,
  forecast,
  loading,
}: {
  history: ChartPoint[]
  current: number | null
  forecast: Forecast3Y | null
  loading: boolean
}) {
  const allVals = [
    ...history.map(p => p.close),
    current,
    forecast?.y1.high, forecast?.y1.base, forecast?.y1.low,
    forecast?.y2.high, forecast?.y2.base, forecast?.y2.low,
    forecast?.y3.high, forecast?.y3.base, forecast?.y3.low,
  ]
  const finite = allVals.filter((v): v is number => v != null && Number.isFinite(v))
  const rawMin = finite.length > 0 ? Math.min(...finite) : 0
  const rawMax = finite.length > 0 ? Math.max(...finite) : 100
  const spread = rawMax - rawMin
  const pad = spread > 0 ? spread * 0.12 : Math.abs(rawMax) * 0.08 || 5
  const rMin = rawMin - pad
  const rMax = rawMax + pad
  const rSpan = rMax - rMin

  const yFor = (v: number | null): number | null => {
    if (v == null || !Number.isFinite(v)) return null
    return PT + ((rMax - v) / rSpan) * PH
  }

  const ticks = [0, 1, 2, 3, 4].map(i => rMax - (rSpan * i) / 4)

  const histPts = history.map((p, i) => ({
    x: X0 + (history.length <= 1 ? 0 : (i / (history.length - 1)) * HW),
    y: yFor(p.close) ?? PT + PH / 2,
  }))
  const lastPt = histPts[histPts.length - 1] ?? { x: XN, y: PT + PH / 2 }
  const nowY = yFor(current) ?? lastPt.y

  const y1H = yFor(forecast?.y1.high ?? null)
  const y1B = yFor(forecast?.y1.base ?? null)
  const y1L = yFor(forecast?.y1.low ?? null)
  const y2H = yFor(forecast?.y2.high ?? null)
  const y2B = yFor(forecast?.y2.base ?? null)
  const y2L = yFor(forecast?.y2.low ?? null)
  const y3H = yFor(forecast?.y3.high ?? null)
  const y3B = yFor(forecast?.y3.base ?? null)
  const y3L = yFor(forecast?.y3.low ?? null)

  const fanPts: string[] = [`${lastPt.x},${nowY}`]
  if (y1H != null) fanPts.push(`${X1},${y1H}`)
  if (y2H != null) fanPts.push(`${X2},${y2H}`)
  if (y3H != null) fanPts.push(`${X3},${y3H}`)
  if (y3L != null) fanPts.push(`${X3},${y3L}`)
  if (y2L != null) fanPts.push(`${X2},${y2L}`)
  if (y1L != null) fanPts.push(`${X1},${y1L}`)
  const fanPolygon = fanPts.length >= 6 ? fanPts.join(' ') : ''

  const mkPoly = (pairs: Array<[number, number | null]>) =>
    pairs
      .filter((p): p is [number, number] => p[1] != null)
      .map(([x, y]) => `${x},${y}`)
      .join(' ')

  const highPts = mkPoly([[lastPt.x, nowY], [X1, y1H], [X2, y2H], [X3, y3H]])
  const basePts = mkPoly([[lastPt.x, nowY], [X1, y1B], [X2, y2B], [X3, y3B]])
  const lowPts  = mkPoly([[lastPt.x, nowY], [X1, y1L], [X2, y2L], [X3, y3L]])

  const histD = histPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaD = histPts.length > 1
    ? `${histD} L ${lastPt.x} ${PT + PH} L ${X0} ${PT + PH} Z`
    : ''

  const dateTicks = useMemo(() => {
    if (history.length === 0) return []
    const n = history.length - 1
    return [0, Math.round(n / 2), n].map(i => ({
      x: X0 + (n === 0 ? 0 : (i / n) * HW),
      label: fmtDate(history[Math.min(i, n)]?.date ?? ''),
    }))
  }, [history])

  const rightLabels = useMemo(() => {
    type LI = { key: string; label: string; value: number; y: number; color: string }
    const raw: Array<LI | null> = [
      forecast?.y3.high != null && y3H != null
        ? { key: 'high', label: 'HIGH', value: forecast.y3.high, y: y3H, color: '#5eead4' }
        : null,
      forecast?.y3.base != null && y3B != null
        ? { key: 'avg', label: 'AVG', value: forecast.y3.base, y: y3B, color: '#94a3b8' }
        : null,
      forecast?.y3.low != null && y3L != null
        ? { key: 'low', label: 'LOW', value: forecast.y3.low, y: y3L, color: '#f472b6' }
        : null,
    ]
    const valid = raw.filter((x): x is LI => x != null).sort((a, b) => a.y - b.y)
    let prev = -Infinity
    return valid.map(item => {
      const y = Math.max(item.y, prev + 46)
      prev = y
      return { ...item, y }
    })
  }, [forecast, y3H, y3B, y3L])

  // 1Y and 2Y price labels with collision avoidance
  const mkYearLabels = (
    vals: Array<{ key: string; value: number | null | undefined; y: number | null; color: string }>,
  ) => {
    type LI = { key: string; value: number; y: number; color: string }
    const valid = vals
      .filter((x): x is LI => x.value != null && x.y != null)
      .sort((a, b) => a.y - b.y)
    let prev = -Infinity
    return valid.map(item => {
      const labelY = Math.max(item.y, prev + 38)
      prev = labelY
      return { ...item, origY: item.y, y: labelY }  // origY = dot position, y = label position
    })
  }

  const y1Labels = useMemo(
    () => mkYearLabels([
      { key: 'h', value: forecast?.y1.high,  y: y1H, color: '#5eead4' },
      { key: 'b', value: forecast?.y1.base,  y: y1B, color: '#94a3b8' },
      { key: 'l', value: forecast?.y1.low,   y: y1L, color: '#f472b6' },
    ]),
    [forecast, y1H, y1B, y1L],
  )

  const y2Labels = useMemo(
    () => mkYearLabels([
      { key: 'h', value: forecast?.y2.high,  y: y2H, color: '#5eead4' },
      { key: 'b', value: forecast?.y2.base,  y: y2B, color: '#94a3b8' },
      { key: 'l', value: forecast?.y2.low,   y: y2L, color: '#f472b6' },
    ]),
    [forecast, y2H, y2B, y2L],
  )

  if (histPts.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm text-slate-500">
        {loading ? 'Loading chart...' : 'Price history unavailable.'}
      </div>
    )
  }

  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,31,0.96),rgba(7,11,20,0.98))] p-4">
      <div className="mb-3 flex items-center justify-between text-[12px] uppercase tracking-[0.22em]">
        <span className="text-cyan-200/95">Past 12M</span>
        <div className="flex gap-6 text-slate-400">
          <span className="text-teal-300/95">1Y</span>
          <span className="text-teal-200/75">2Y</span>
          <span className="text-teal-100/55">3Y</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[290px] w-full overflow-visible">
        <defs>
          <linearGradient id="scc-hist-area" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(37,99,235,0.22)" />
            <stop offset="100%" stopColor="rgba(37,99,235,0.02)" />
          </linearGradient>
          <linearGradient id="scc-hist-line" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(59,130,246,0.92)" />
            <stop offset="100%" stopColor="rgba(14,165,233,0.96)" />
          </linearGradient>
        </defs>

        {ticks.map(tick => {
          const y = yFor(tick)
          if (y == null) return null
          return (
            <g key={tick}>
              <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="rgba(148,163,184,0.10)" />
              <text x={PL - 8} y={y + 4} textAnchor="end" fontSize="13" fill="rgba(226,232,240,0.90)">
                {formatPrice(tick)}
              </text>
            </g>
          )
        })}

        <line x1={XN} x2={XN} y1={PT} y2={PT + PH} stroke="rgba(255,255,255,0.18)" />
        <line x1={X1} x2={X1} y1={PT} y2={PT + PH} stroke="rgba(255,255,255,0.07)" strokeDasharray="5 5" />
        <line x1={X2} x2={X2} y1={PT} y2={PT + PH} stroke="rgba(255,255,255,0.07)" strokeDasharray="5 5" />

        {fanPolygon && <polygon points={fanPolygon} fill="rgba(94,234,212,0.06)" stroke="none" />}

        {areaD && <path d={areaD} fill="url(#scc-hist-area)" />}
        {histD && (
          <path d={histD} fill="none" stroke="url(#scc-hist-line)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" />
        )}

        {highPts && (
          <polyline points={highPts} fill="none" stroke="rgba(94,234,212,0.90)"
            strokeWidth="2.2" strokeDasharray="6 4" strokeLinecap="round" />
        )}
        {basePts && (
          <polyline points={basePts} fill="none" stroke="rgba(148,163,184,0.80)"
            strokeWidth="2.0" strokeDasharray="6 4" strokeLinecap="round" />
        )}
        {lowPts && (
          <polyline points={lowPts} fill="none" stroke="rgba(244,114,182,0.85)"
            strokeWidth="2.2" strokeDasharray="6 4" strokeLinecap="round" />
        )}

        <circle cx={lastPt.x} cy={nowY} r={5.5} fill="rgba(103,232,249,0.95)"
          stroke="rgba(8,15,28,0.95)" strokeWidth="2" />
        <text x={lastPt.x} y={Math.max(PT + 14, nowY - 14)} textAnchor="middle"
          fontSize="9" letterSpacing="2" fill="rgba(186,230,253,0.88)">NOW</text>

        {dateTicks.map(t => (
          <text key={t.label} x={t.x} y={H - PB + 20} textAnchor="middle"
            fontSize="13" fill="rgba(203,213,225,0.80)">{t.label}</text>
        ))}
        <text x={X1} y={H - PB + 20} textAnchor="middle" fontSize="13"
          letterSpacing="2" fill="rgba(203,213,225,0.95)">1Y</text>
        <text x={X2} y={H - PB + 20} textAnchor="middle" fontSize="13"
          letterSpacing="2" fill="rgba(203,213,225,0.75)">2Y</text>
        <text x={X3} y={H - PB + 20} textAnchor="middle" fontSize="13"
          letterSpacing="2" fill="rgba(203,213,225,0.55)">3Y</text>

        {rightLabels.map(item => (
          <g key={item.key}>
            <text x={X3 + 12} y={item.y + 2} fontSize="13" fill={item.color}
              letterSpacing="1.5" fontWeight="700">{item.label}</text>
            <text x={X3 + 12} y={item.y + 17} fontSize="16" fill={item.color}
              fontWeight="800">{formatPrice(item.value)}</text>
          </g>
        ))}

        {/* 1Y price dots + labels (above dot) */}
        {y1Labels.map(item => (
          <g key={`y1-${item.key}`}>
            <circle cx={X1} cy={item.origY} r={4} fill={item.color} opacity="0.95"
              stroke="rgba(8,15,28,0.8)" strokeWidth="1.5" />
            <text x={X1} y={item.y - 9} textAnchor="middle" fontSize="12" fill={item.color}
              fontWeight="700">{formatPrice(item.value)}</text>
          </g>
        ))}

        {/* 2Y price dots + labels (above dot) */}
        {y2Labels.map(item => (
          <g key={`y2-${item.key}`}>
            <circle cx={X2} cy={item.origY} r={4} fill={item.color} opacity="0.95"
              stroke="rgba(8,15,28,0.8)" strokeWidth="1.5" />
            <text x={X2} y={item.y - 9} textAnchor="middle" fontSize="12" fill={item.color}
              fontWeight="700">{formatPrice(item.value)}</text>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-5 text-[12px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />History</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal-300" />High</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" />Base</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-pink-400" />Low</span>
      </div>
    </div>
  )
}

function ForwardPEStrip({
  consensus,
  currentPrice,
  currentPe,
  forecast,
}: {
  consensus: StockAnalysisResponse['consensus']
  currentPrice: number | null
  currentPe: number | null
  forecast: Forecast3Y | null
}) {
  // Primary: forward_pe_ladder from backend
  const fwdLadder  = consensus?.forward_pe_ladder ?? []
  const actuals    = fwdLadder.filter(e => e.kind === 'actual')
  const estimates  = fwdLadder.filter(e => e.kind !== 'actual')
  const lastActual = actuals[actuals.length - 1]

  type PeRow = {
    year?: number | null; label?: string; kind?: string
    eps?: number | null; forward_pe?: number | null; growth_pct?: number | null
    _priceBased?: boolean; _basePrice?: number | null
  }

  let items: PeRow[] = [...(lastActual ? [lastActual] : []), ...estimates.slice(0, 3)].slice(0, 4)
  let priceBased = false

  // Fallback 2: build from eps_ladder + current price
  if (items.length === 0 && (consensus?.eps_ladder ?? []).length > 0) {
    const epsLadder = consensus?.eps_ladder ?? []
    const epsActuals   = epsLadder.filter(e => e.kind === 'actual')
    const epsEstimates = epsLadder.filter(e => e.kind !== 'actual')
    const lastEpsActual = epsActuals[epsActuals.length - 1]
    const candidates = [...(lastEpsActual ? [lastEpsActual] : []), ...epsEstimates.slice(0, 3)].slice(0, 4)
    items = candidates.map(e => ({
      ...e,
      forward_pe: currentPrice != null && e.eps != null && e.eps > 0
        ? Math.round((currentPrice / e.eps) * 10) / 10
        : null,
    }))
  }

  // Fallback 3: build from forecast prices when no EPS data at all
  if (items.length === 0 && forecast != null && currentPrice != null) {
    priceBased = true
    const nowYear = new Date().getFullYear()
    const bases = [forecast.y1.base, forecast.y2.base, forecast.y3.base]
    const prevBases = [currentPrice, forecast.y1.base ?? currentPrice, forecast.y2.base ?? forecast.y1.base ?? currentPrice]
    items = [
      { year: nowYear, label: 'NOW', kind: 'actual', eps: null, forward_pe: currentPe, growth_pct: null },
      ...bases.map((base, i) => ({
        year: nowYear + i + 1,
        label: `${i + 1}Y Est`,
        kind: 'estimate',
        eps: null,
        forward_pe: null,
        growth_pct: base != null && prevBases[i] != null && prevBases[i]! > 0
          ? (base - prevBases[i]!) / prevBases[i]!
          : null,
        _priceBased: true,
        _basePrice: base ?? null,
      })),
    ].filter(r => r.year != null)
  }

  if (items.length === 0) return null

  const colLabel = (item: typeof items[0]) => {
    const yr = item.year ?? '?'
    return item.kind === 'actual' ? `${yr} Actual` : `${yr} Est`
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[12px] uppercase tracking-[0.24em] text-slate-300">
        Forward P/E Strip
        {priceBased
          ? <span className="normal-case tracking-normal text-amber-500/70">· Price projection (no EPS data)</span>
          : <span className="normal-case tracking-normal text-slate-400">· Seeking Alpha style</span>}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/8 bg-slate-900/60">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/8">
              <th className="w-24 px-5 py-4 text-left text-[11px] uppercase tracking-[0.2em] text-slate-500" />
              {items.map((item, i) => (
                <th
                  key={i}
                  className={`px-5 py-4 text-right text-[12px] uppercase tracking-[0.14em] font-semibold ${
                    item.kind === 'actual' ? 'text-slate-300' : 'text-cyan-300'
                  }`}
                >
                  {colLabel(item)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/5">
              <td className="px-5 py-4 text-[12px] uppercase tracking-[0.12em] text-slate-300 font-medium">P/E</td>
              {items.map((item, i) => (
                <td
                  key={i}
                  className={`px-5 py-4 text-right text-lg font-black ${
                    item.kind === 'actual' ? 'text-slate-200' : 'text-cyan-100'
                  }`}
                >
                  {item.forward_pe != null ? `${item.forward_pe.toFixed(1)}x` : '--'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-white/5">
              <td className="px-5 py-4 text-[12px] uppercase tracking-[0.12em] text-slate-300 font-medium">
                {priceBased ? 'Price' : 'EPS'}
              </td>
              {items.map((item, i) => (
                <td key={i} className="px-5 py-4 text-right text-base text-slate-200">
                  {priceBased
                    ? (item.year === new Date().getFullYear()
                        ? (currentPrice != null ? `$${currentPrice.toFixed(2)}` : '--')
                        : (item._basePrice != null ? `$${item._basePrice.toFixed(2)}` : '--'))
                    : (item.eps != null ? `$${item.eps.toFixed(2)}` : '--')}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-5 py-4 text-[12px] uppercase tracking-[0.12em] text-slate-300 font-medium">
                {priceBased ? 'Price Chg' : 'Growth'}
              </td>
              {items.map((item, i) => {
                const g = item.growth_pct
                const isActual = item.kind === 'actual'
                return (
                  <td
                    key={i}
                    className={`px-5 py-4 text-right text-base font-bold ${
                      isActual || g == null
                        ? 'text-slate-500'
                        : g >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                    }`}
                  >
                    {isActual ? '--' : g != null ? `${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)}%` : '--'}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}


function MethodologyCard({ currentPe, refPe }: { currentPe: number | null; refPe: number | null }) {
  const pe  = currentPe != null && currentPe > 3 ? currentPe.toFixed(1) : '?'
  const ref = refPe    != null && refPe    > 3 ? refPe.toFixed(1)    : '?'

  return (
    <div className="overflow-hidden rounded-xl border border-white/8 bg-slate-900/60">
      <div className="border-b border-white/8 px-5 py-3.5 text-[12px] uppercase tracking-[0.22em] text-slate-300 font-semibold">
        3년 예상주가 계산 로직
      </div>
      <div className="px-5 py-5 font-mono text-[13px] leading-7 text-slate-200">
        <div>
          <span className="text-slate-400">Year 1 (12개월):</span>{' '}
          <span className="text-teal-300">FMP consensus</span>{' '}
          <span className="text-slate-300">target_mean/high/low 직접 사용</span>
        </div>
        <div>
          <span className="text-slate-400">Year 2 (24개월):</span>{' '}
          <span className="text-cyan-300">eps_ladder[Y+1]</span>{' '}
          <span className="text-slate-500">×</span>{' '}
          <span className="text-slate-300">blended_multiple</span>
        </div>
        <div>
          <span className="text-slate-400">Year 3 (36개월):</span>{' '}
          <span className="text-violet-300">eps_ladder[Y+2]</span>{' '}
          <span className="text-slate-500">×</span>{' '}
          <span className="text-slate-300">compressed_multiple</span>
        </div>

        <div className="mt-3 text-slate-300 font-semibold">blended_multiple:</div>
        <div className="ml-4 mt-1 space-y-0.5">
          <div>
            <span className="text-slate-400">Base Y2:</span>{' '}
            <span className="text-amber-300">hist_pe_5y</span>
            <span className="text-slate-300"> ({ref}x) × 0.6 + </span>
            <span className="text-amber-300">current_pe</span>
            <span className="text-slate-300"> ({pe}x) × 0.4</span>
            <span className="ml-2 text-slate-500">("점진적 평균 회귀)</span>
          </div>
          <div>
            <span className="text-slate-400">Base Y3:</span>{' '}
            <span className="text-amber-300">hist_pe_5y</span>
            <span className="text-slate-300"> ({ref}x)</span>
            <span className="ml-2 text-slate-500">("완전 평균 회귀)</span>
          </div>
          <div>
            <span className="text-slate-400">Bear&nbsp;&nbsp;:</span>{' '}
            <span className="text-amber-300">hist_pe_5y</span>
            <span className="text-slate-300"> × 0.80</span>
            <span className="ml-2 text-slate-500">("밸류에이션 디스카운트)</span>
          </div>
          <div>
            <span className="text-slate-400">Bull&nbsp;&nbsp;:</span>{' '}
            <span className="text-amber-300">current_pe</span>
            <span className="text-slate-300"> × 0.90</span>
            <span className="ml-2 text-slate-500">("프리미엄 소폭 압축)</span>
          </div>
        </div>

        <div className="mt-4 border-t border-white/5 pt-3 text-[12px] text-slate-300">
          <span className="font-sans font-semibold uppercase tracking-[0.15em] text-amber-400/60">왜 이 방식인가?</span>
          <span className="ml-2">
            Year 1은 애널리스트 컨센서스를 그대로 사용(가장 신뢰). Year 2-3은 EPS 추정치에
            P/E 평균회귀를 적용 — 성장주 프리미엄이 시간이 지남에 따라 압축되는 역사적 패턴 반영.
          </span>
        </div>
      </div>
    </div>
  )
}

export default function StreetConsensusChart({
  symbol = 'AAPL',
  fetchKey = 0,
  mode = 'auto',
  analysis,
  loading,
  error,
  compact = false,
}: Props) {
  const controlled = analysis !== undefined || loading !== undefined || error !== undefined
  const [fetchedAnalysis, setFetchedAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [fetchedLoading, setFetchedLoading] = useState(true)
  const [fetchedError, setFetchedError] = useState<string | null>(null)

  useEffect(() => {
    if (controlled) return
    const ticker = normalizeTicker(symbol) || 'AAPL'
    const ctrl = new AbortController()
    let alive = true
    setFetchedLoading(true)
    setFetchedError(null)
    setFetchedAnalysis(null)
    fetchStockAnalysis(ticker, mode, ctrl.signal)
      .then(d => { if (alive) setFetchedAnalysis(d) })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (!alive) return
        setFetchedError(e instanceof Error ? e.message : 'Failed to load data')
      })
      .finally(() => { if (alive) setFetchedLoading(false) })
    return () => { alive = false; ctrl.abort() }
  }, [controlled, symbol, fetchKey, mode])

  const activeAnalysis = analysis !== undefined ? analysis : fetchedAnalysis
  const activeLoading  = loading  !== undefined ? loading  : fetchedLoading
  const activeError    = error    !== undefined ? error    : fetchedError

  const ticker      = activeAnalysis?.ticker || normalizeTicker(symbol) || 'AAPL'
  const current     = toNumber(activeAnalysis?.current_price)
  const history     = useMemo(() => buildHistory(activeAnalysis?.price_history ?? []), [activeAnalysis?.price_history])
  const latestClose = history.length > 0 ? history[history.length - 1]?.close ?? null : null
  const displayPrice = current ?? latestClose

  const consensus  = activeAnalysis?.consensus
  const currentPe  = toNumber(activeAnalysis?.current_pe)
  const refPe      = toNumber(activeAnalysis?.historical_pe?.pe_5y ?? activeAnalysis?.historical_pe?.pe_3y)
  const consMean   = toNumber(consensus?.target_mean)
  const consHigh   = toNumber(consensus?.target_high)
  const consLow    = toNumber(consensus?.target_low)
  const analystCnt = toNumber(consensus?.analyst_count ?? consensus?.target_analyst_count)
  const epsLadder  = consensus?.eps_ladder

  const forecast = useMemo(() => buildForecast3Y({
    current: displayPrice,
    currentPe,
    refPe,
    consensusHigh: consHigh,
    consensusMean: consMean,
    consensusLow: consLow,
    epsLadder: epsLadder ?? [],
  }), [displayPrice, currentPe, refPe, consHigh, consMean, consLow, epsLadder])

  const upside = calcUpsidePct(displayPrice, consMean)

  return (
    <section className={`rounded-3xl border border-white/10 bg-slate-950/88 shadow-[0_20px_60px_rgba(0,0,0,0.22)] ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/75">Street Consensus · 3-Year Outlook</div>
          <h3 className="mt-2 text-xl font-black text-white">{ticker} Price Target &amp; Forecast</h3>
          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <div className="text-4xl font-black text-cyan-200">
              {consMean != null ? formatPrice(consMean) : formatPrice(displayPrice)}
            </div>
            {upside != null && (
              <div className={`text-sm font-semibold ${upside >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatPct(upside)} 1Y Upside
              </div>
            )}
          </div>
          {analystCnt != null && (
            <div className="mt-1.5 text-xs text-slate-500">
              Based on {Math.round(analystCnt)} analyst price targets
            </div>
          )}
        </div>
        {analystCnt != null && (
          <span className="self-start rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-300">
            {Math.round(analystCnt)} analysts
          </span>
        )}
      </div>

      {activeError && (
        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/8 px-4 py-3 text-sm text-rose-100">
          {activeError}
        </div>
      )}

      <div className="mt-5">
        <ForecastChart
          history={history}
          current={displayPrice}
          forecast={forecast}
          loading={Boolean(activeLoading)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
        <ForwardPEStrip consensus={consensus} currentPrice={displayPrice} currentPe={currentPe} forecast={forecast} />
        <MethodologyCard currentPe={currentPe} refPe={refPe} />
      </div>
    </section>
  )
}
