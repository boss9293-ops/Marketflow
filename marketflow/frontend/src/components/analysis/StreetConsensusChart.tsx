'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  AnalysisMode,
  StockAnalysisResponse,
  calcUpsidePct,
  fetchStockAnalysis,
  formatMultiple,
  formatPct,
  formatPrice,
  normalizeTicker,
} from '@/lib/stockAnalysis'
import { pickLang, useUiLang } from '@/lib/useLangMode'
import type { UiLang } from '@/lib/uiLang'

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

const STREET_TEXT = {
  loadingChart: { ko: '차트를 불러오는 중...', en: 'Loading chart...' },
  priceHistoryUnavailable: { ko: '가격 히스토리를 불러오지 못했습니다.', en: 'Price history unavailable.' },
  past12m: { ko: '최근 12개월', en: 'Past 12M' },
  high: { ko: '상단', en: 'HIGH' },
  average: { ko: '기준', en: 'AVG' },
  low: { ko: '하단', en: 'LOW' },
  history: { ko: '히스토리', en: 'History' },
  forwardPeStrip: { ko: '포워드 P/E 스트립', en: 'Forward P/E Strip' },
  priceProjectionNoEps: { ko: 'EPS 없음 - 가격 투영치', en: 'Price projection (no EPS data)' },
  seekingAlphaStyle: { ko: 'Seeking Alpha 스타일', en: 'Seeking Alpha style' },
  rowPe: { ko: 'P/E', en: 'P/E' },
  rowPrice: { ko: '가격', en: 'Price' },
  rowEps: { ko: 'EPS', en: 'EPS' },
  rowPriceChange: { ko: '가격 변화', en: 'Price Chg' },
  rowGrowth: { ko: '성장률', en: 'Growth' },
  actual: { ko: '실적', en: 'Actual' },
  estimate: { ko: '예상', en: 'Est' },
  now: { ko: '현재', en: 'NOW' },
  yearEstimateSuffix: { ko: '년 예상', en: 'Y Est' },
  methodologyTitle: { ko: '3년 목표주가 계산 로직', en: '3Y Target Price Logic' },
  year1Line: { ko: 'Year 1 (12개월): FMP 컨센서스 target mean / high / low', en: 'Year 1 (12M): FMP consensus target mean / high / low' },
  year2Line: { ko: 'Year 2 (24개월): eps_ladder[Y+1] × blended_multiple', en: 'Year 2 (24M): eps_ladder[Y+1] × blended_multiple' },
  year3Line: { ko: 'Year 3 (36개월): eps_ladder[Y+2] × compressed_multiple', en: 'Year 3 (36M): eps_ladder[Y+2] × compressed_multiple' },
  blendedMultiple: { ko: 'blended_multiple:', en: 'blended_multiple:' },
  baseY2Note: { ko: '보수적 평균회귀', en: 'conservative mean reversion' },
  baseY3Note: { ko: '완전 평균회귀', en: 'full mean reversion' },
  bearNote: { ko: '밸류에이션 디스카운트', en: 'valuation discount' },
  bullNote: { ko: '프리미엄 압축', en: 'premium compression' },
  whyMethodTitle: { ko: '이 방식의 이유', en: 'Why this method' },
  whyMethodBody: {
    ko: 'Year 1은 애널리스트 컨센서스를 사용하고, Year 2-3은 EPS 추정과 멀티플 정상화를 통해 시간에 따른 프리미엄 압축을 반영합니다.',
    en: 'Year 1 uses analyst consensus directly. Year 2-3 are built from EPS ladder and normalized valuation assumptions to reflect historical premium compression over time.',
  },
  metricGuide: { ko: '밸류에이션 지표 가이드', en: 'Valuation Metric Guide' },
  metric: { ko: '지표', en: 'Metric' },
  current: { ko: '현재값', en: 'Current' },
  description: { ko: '설명', en: 'Description' },
  interpretation: { ko: '해석 포인트', en: 'Interpretation' },
  failedToLoadData: { ko: '데이터를 불러오지 못했습니다.', en: 'Failed to load data' },
  sectionKicker: { ko: '스트리트 컨센서스 • 3년 전망', en: 'Street Consensus • 3-Year Outlook' },
  sectionTitleSuffix: { ko: '목표가 & 전망', en: 'Price Target & Forecast' },
  upside: { ko: '1년 업사이드', en: '1Y Upside' },
  basedOn: { ko: '기준', en: 'Based on' },
  basedOnTargets: { ko: '애널리스트 목표가', en: 'analyst price targets' },
  analysts: { ko: '애널리스트', en: 'analysts' },
  ratioHintPsr: { ko: '주가 / 주당매출', en: 'Price / Sales' },
  ratioHintPfcf: { ko: '주가 / 주당FCF', en: 'Price / FCF/share' },
  ratioHintPbr: { ko: '주가 / 주당순자산', en: 'Price / Book value' },
  ratioHintTpeg: { ko: '트레일링 PEG', en: 'Trailing PEG' },
} as const

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

  // Y1: analyst price targets preferred; fall back to EPS x PE
  if (y1.base == null && y1.high == null && y1.low == null) {
    if (fy1 != null) {
      // Use EPS x compressed current PE as 1Y price proxy
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

// Chart layout constants (module-level ??not reactive)
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
  uiLang,
}: {
  history: ChartPoint[]
  current: number | null
  forecast: Forecast3Y | null
  loading: boolean
  uiLang: UiLang
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
        ? {
            key: 'high',
            label: pickLang(uiLang, STREET_TEXT.high.ko, STREET_TEXT.high.en),
            value: forecast.y3.high,
            y: y3H,
            color: '#5eead4',
          }
        : null,
      forecast?.y3.base != null && y3B != null
        ? {
            key: 'avg',
            label: pickLang(uiLang, STREET_TEXT.average.ko, STREET_TEXT.average.en),
            value: forecast.y3.base,
            y: y3B,
            color: '#94a3b8',
          }
        : null,
      forecast?.y3.low != null && y3L != null
        ? {
            key: 'low',
            label: pickLang(uiLang, STREET_TEXT.low.ko, STREET_TEXT.low.en),
            value: forecast.y3.low,
            y: y3L,
            color: '#f472b6',
          }
        : null,
    ]
    const valid = raw.filter((x): x is LI => x != null).sort((a, b) => a.y - b.y)
    let prev = -Infinity
    return valid.map(item => {
      const y = Math.max(item.y, prev + 46)
      prev = y
      return { ...item, y }
    })
  }, [forecast, y3H, y3B, y3L, uiLang])

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
        {loading
          ? pickLang(uiLang, STREET_TEXT.loadingChart.ko, STREET_TEXT.loadingChart.en)
          : pickLang(uiLang, STREET_TEXT.priceHistoryUnavailable.ko, STREET_TEXT.priceHistoryUnavailable.en)}
      </div>
    )
  }

  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,31,0.96),rgba(7,11,20,0.98))] p-4">
      <div className="mb-3 flex items-center justify-between text-[12px] uppercase tracking-[0.22em]">
        <span className="text-cyan-200/95">{pickLang(uiLang, STREET_TEXT.past12m.ko, STREET_TEXT.past12m.en)}</span>
        <div className="flex gap-6 text-slate-400">
          <span className="text-teal-300/95">{uiLang === 'ko' ? '1년' : '1Y'}</span>
          <span className="text-teal-200/75">{uiLang === 'ko' ? '2년' : '2Y'}</span>
          <span className="text-teal-100/55">{uiLang === 'ko' ? '3년' : '3Y'}</span>
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
          letterSpacing="2" fill="rgba(203,213,225,0.95)">{uiLang === 'ko' ? '1년' : '1Y'}</text>
        <text x={X2} y={H - PB + 20} textAnchor="middle" fontSize="13"
          letterSpacing="2" fill="rgba(203,213,225,0.75)">{uiLang === 'ko' ? '2년' : '2Y'}</text>
        <text x={X3} y={H - PB + 20} textAnchor="middle" fontSize="13"
          letterSpacing="2" fill="rgba(203,213,225,0.55)">{uiLang === 'ko' ? '3년' : '3Y'}</text>

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
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sky-400" />
          {pickLang(uiLang, STREET_TEXT.history.ko, STREET_TEXT.history.en)}
        </span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal-300" />{pickLang(uiLang, STREET_TEXT.high.ko, STREET_TEXT.high.en)}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" />{pickLang(uiLang, STREET_TEXT.average.ko, STREET_TEXT.average.en)}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-pink-400" />{pickLang(uiLang, STREET_TEXT.low.ko, STREET_TEXT.low.en)}</span>
      </div>
    </div>
  )
}

function ForwardPEStrip({
  consensus,
  currentPrice,
  currentPe,
  forecast,
  uiLang,
}: {
  consensus: StockAnalysisResponse['consensus']
  currentPrice: number | null
  currentPe: number | null
  forecast: Forecast3Y | null
  uiLang: UiLang
}) {
  // Primary: forward_pe_ladder from backend
  const fwdLadder = consensus?.forward_pe_ladder ?? []
  const actuals = fwdLadder.filter(e => e.kind === 'actual')
  const estimates = fwdLadder.filter(e => e.kind !== 'actual')
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
    const epsActuals = epsLadder.filter(e => e.kind === 'actual')
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
      {
        year: nowYear,
        label: pickLang(uiLang, STREET_TEXT.now.ko, STREET_TEXT.now.en),
        kind: 'actual',
        eps: null,
        forward_pe: currentPe,
        growth_pct: null,
      },
      ...bases.map((base, i) => ({
        year: nowYear + i + 1,
        label: uiLang === 'ko' ? `${i + 1}${STREET_TEXT.yearEstimateSuffix.ko}` : `${i + 1}${STREET_TEXT.yearEstimateSuffix.en}`,
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
    return item.kind === 'actual'
      ? `${yr} ${pickLang(uiLang, STREET_TEXT.actual.ko, STREET_TEXT.actual.en)}`
      : `${yr} ${pickLang(uiLang, STREET_TEXT.estimate.ko, STREET_TEXT.estimate.en)}`
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[13px] uppercase tracking-[0.22em] text-slate-100">
        {pickLang(uiLang, STREET_TEXT.forwardPeStrip.ko, STREET_TEXT.forwardPeStrip.en)}
        {priceBased
          ? <span className="normal-case tracking-normal text-[12px] text-amber-300">• {pickLang(uiLang, STREET_TEXT.priceProjectionNoEps.ko, STREET_TEXT.priceProjectionNoEps.en)}</span>
          : <span className="normal-case tracking-normal text-[12px] text-slate-200">• {pickLang(uiLang, STREET_TEXT.seekingAlphaStyle.ko, STREET_TEXT.seekingAlphaStyle.en)}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/65">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-white/8">
              <th className="w-24 px-5 py-3 text-left text-[12px] uppercase tracking-[0.16em] text-slate-200" />
              {items.map((item, i) => (
                <th
                  key={i}
                  className={`px-5 py-3 text-right text-[12px] uppercase tracking-[0.12em] font-semibold ${
                    item.kind === 'actual' ? 'text-slate-100' : 'text-cyan-200'
                  }`}
                >
                  {colLabel(item)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/5">
              <td className="px-5 py-3 text-[12px] uppercase tracking-[0.1em] text-slate-100 font-semibold">
                {pickLang(uiLang, STREET_TEXT.rowPe.ko, STREET_TEXT.rowPe.en)}
              </td>
              {items.map((item, i) => (
                <td
                  key={i}
                  className={`px-5 py-3 text-right text-[27px] leading-none font-black ${
                    item.kind === 'actual' ? 'text-slate-50' : 'text-cyan-100'
                  }`}
                >
                  {item.forward_pe != null ? `${item.forward_pe.toFixed(1)}x` : '--'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-white/5">
              <td className="px-5 py-3 text-[12px] uppercase tracking-[0.1em] text-slate-100 font-semibold">
                {priceBased
                  ? pickLang(uiLang, STREET_TEXT.rowPrice.ko, STREET_TEXT.rowPrice.en)
                  : pickLang(uiLang, STREET_TEXT.rowEps.ko, STREET_TEXT.rowEps.en)}
              </td>
              {items.map((item, i) => (
                <td key={i} className="px-5 py-3 text-right text-[26px] leading-none text-slate-50">
                  {priceBased
                    ? (item.year === new Date().getFullYear()
                        ? (currentPrice != null ? `$${currentPrice.toFixed(2)}` : '--')
                        : (item._basePrice != null ? `$${item._basePrice.toFixed(2)}` : '--'))
                    : (item.eps != null ? `$${item.eps.toFixed(2)}` : '--')}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-5 py-3 text-[12px] uppercase tracking-[0.1em] text-slate-100 font-semibold">
                {priceBased
                  ? pickLang(uiLang, STREET_TEXT.rowPriceChange.ko, STREET_TEXT.rowPriceChange.en)
                  : pickLang(uiLang, STREET_TEXT.rowGrowth.ko, STREET_TEXT.rowGrowth.en)}
              </td>
              {items.map((item, i) => {
                const g = item.growth_pct
                const isActual = item.kind === 'actual'
                return (
                  <td
                    key={i}
                    className={`px-5 py-3 text-right text-[19px] leading-none font-bold ${
                      isActual || g == null
                        ? 'text-slate-300'
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

function MethodologyCard({
  currentPe,
  refPe,
  uiLang,
}: {
  currentPe: number | null
  refPe: number | null
  uiLang: UiLang
}) {
  const pe = currentPe != null && currentPe > 3 ? currentPe.toFixed(1) : '?'
  const ref = refPe != null && refPe > 3 ? refPe.toFixed(1) : '?'

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/65">
      <div className="border-b border-white/10 px-5 py-3 text-[13px] uppercase tracking-[0.18em] text-slate-50 font-semibold">
        {pickLang(uiLang, STREET_TEXT.methodologyTitle.ko, STREET_TEXT.methodologyTitle.en)}
      </div>
      <div className="px-5 py-4 font-mono text-[13px] leading-7 text-slate-100">
        <div className="text-slate-200">{pickLang(uiLang, STREET_TEXT.year1Line.ko, STREET_TEXT.year1Line.en)}</div>
        <div className="text-slate-200">{pickLang(uiLang, STREET_TEXT.year2Line.ko, STREET_TEXT.year2Line.en)}</div>
        <div className="text-slate-200">{pickLang(uiLang, STREET_TEXT.year3Line.ko, STREET_TEXT.year3Line.en)}</div>

        <div className="mt-4 text-slate-50 font-semibold">{pickLang(uiLang, STREET_TEXT.blendedMultiple.ko, STREET_TEXT.blendedMultiple.en)}</div>
        <div className="ml-4 mt-1 space-y-0.5">
          <div>
            <span className="text-slate-50">Base Y2:</span>{' '}
            <span className="text-amber-300">hist_pe_5y</span>
            <span className="text-slate-200"> ({ref}x) × 0.6 + </span>
            <span className="text-amber-300">current_pe</span>
            <span className="text-slate-200"> ({pe}x) × 0.4</span>
            <span className="ml-2 text-slate-300">({pickLang(uiLang, STREET_TEXT.baseY2Note.ko, STREET_TEXT.baseY2Note.en)})</span>
          </div>
          <div>
            <span className="text-slate-50">Base Y3:</span>{' '}
            <span className="text-amber-300">hist_pe_5y</span>
            <span className="text-slate-200"> ({ref}x)</span>
            <span className="ml-2 text-slate-300">({pickLang(uiLang, STREET_TEXT.baseY3Note.ko, STREET_TEXT.baseY3Note.en)})</span>
          </div>
          <div>
            <span className="text-slate-50">Bear:</span>{' '}
            <span className="text-amber-300">hist_pe_5y</span>
            <span className="text-slate-200"> × 0.80</span>
            <span className="ml-2 text-slate-300">({pickLang(uiLang, STREET_TEXT.bearNote.ko, STREET_TEXT.bearNote.en)})</span>
          </div>
          <div>
            <span className="text-slate-50">Bull:</span>{' '}
            <span className="text-amber-300">current_pe</span>
            <span className="text-slate-200"> × 0.90</span>
            <span className="ml-2 text-slate-300">({pickLang(uiLang, STREET_TEXT.bullNote.ko, STREET_TEXT.bullNote.en)})</span>
          </div>
        </div>

        <div className="mt-4 border-t border-white/10 pt-3 text-[12px] leading-6 text-slate-200">
          <span className="font-sans font-semibold uppercase tracking-[0.12em] text-amber-300">
            {pickLang(uiLang, STREET_TEXT.whyMethodTitle.ko, STREET_TEXT.whyMethodTitle.en)}
          </span>
          <span className="ml-2">
            {pickLang(uiLang, STREET_TEXT.whyMethodBody.ko, STREET_TEXT.whyMethodBody.en)}
          </span>
        </div>
      </div>
    </div>
  )
}

function RatioCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/20 bg-slate-800/55 px-3 py-2">
      <div className="text-[12px] uppercase tracking-[0.16em] text-slate-100">{label}</div>
      <div className="mt-1 text-[30px] leading-none font-black text-cyan-200">{value}</div>
      {hint && <div className="mt-1 text-[12px] text-slate-200 truncate">{hint}</div>}
    </div>
  )
}

function MetricGuideTable({
  rows,
  uiLang,
}: {
  rows: Array<{ metric: string; value: string; desc: string; read: string }>
  uiLang: UiLang
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/12 bg-slate-900/55">
      <div className="border-b border-white/8 px-4 py-2.5 text-[12px] uppercase tracking-[0.16em] text-cyan-200">
        {pickLang(uiLang, STREET_TEXT.metricGuide.ko, STREET_TEXT.metricGuide.en)}
      </div>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-white/8 text-slate-200">
            <th className="px-4 py-2.5 text-left font-semibold">{pickLang(uiLang, STREET_TEXT.metric.ko, STREET_TEXT.metric.en)}</th>
            <th className="px-4 py-2.5 text-left font-semibold">{pickLang(uiLang, STREET_TEXT.current.ko, STREET_TEXT.current.en)}</th>
            <th className="px-4 py-2.5 text-left font-semibold">{pickLang(uiLang, STREET_TEXT.description.ko, STREET_TEXT.description.en)}</th>
            <th className="px-4 py-2.5 text-left font-semibold">{pickLang(uiLang, STREET_TEXT.interpretation.ko, STREET_TEXT.interpretation.en)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.metric} className="border-b border-white/5 align-top">
              <td className="px-4 py-2.5 font-semibold text-slate-100">{row.metric}</td>
              <td className="px-4 py-2.5 text-cyan-200 font-semibold">{row.value}</td>
              <td className="px-4 py-2.5 text-slate-200">{row.desc}</td>
              <td className="px-4 py-2.5 text-slate-300">{row.read}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const uiLang = useUiLang()
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
        setFetchedError(
          e instanceof Error
            ? e.message
            : pickLang(uiLang, STREET_TEXT.failedToLoadData.ko, STREET_TEXT.failedToLoadData.en),
        )
      })
      .finally(() => { if (alive) setFetchedLoading(false) })
    return () => { alive = false; ctrl.abort() }
  }, [controlled, symbol, fetchKey, mode, uiLang])

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
  const stats = activeAnalysis?.stats
  const psr = formatMultiple(stats?.ps_ratio)
  const pbr = formatMultiple(stats?.pb_ratio)
  const pFcfRaw = (
    displayPrice != null &&
    Number.isFinite(displayPrice) &&
    stats?.fcf_per_share != null &&
    Number.isFinite(stats.fcf_per_share) &&
    stats.fcf_per_share > 0
  ) ? (displayPrice / stats.fcf_per_share) : null
  const pFcf = formatMultiple(pFcfRaw)
  const tPeg = formatMultiple(stats?.peg_ratio)
  const perNow = currentPe != null ? `${currentPe.toFixed(1)}x` : '--'

  const epsFromStats = toNumber(stats?.eps_reported)
  const epsLadderActual = useMemo(() => {
    const arr = (consensus?.eps_ladder ?? []).filter(e => e.kind === 'actual' && toNumber(e.eps) != null)
    if (arr.length === 0) return null
    const last = arr[arr.length - 1]
    return toNumber(last.eps)
  }, [consensus?.eps_ladder])
  const epsNow = epsFromStats ?? epsLadderActual
  const epsNowText = epsNow != null ? `$${epsNow.toFixed(2)}` : '--'

  const metricRows = [
    {
      metric: 'PER',
      value: perNow,
      desc: pickLang(uiLang, '주가 ÷ 주당순이익(EPS)', 'Price ÷ earnings per share (EPS).'),
      read: pickLang(uiLang, '높을수록 성장 프리미엄 반영. 동종 업종과 비교', 'Higher implies growth premium. Compare vs peers.'),
    },
    {
      metric: 'EPS',
      value: epsNowText,
      desc: pickLang(uiLang, '주당순이익(순이익의 1주당 환산)', 'Earnings per share (net income per share).'),
      read: pickLang(uiLang, '절대값보다 추세(증가/감소)가 더 중요', 'Trend direction matters more than one absolute value.'),
    },
    {
      metric: 'PSR (P/S)',
      value: activeLoading ? '--' : psr,
      desc: pickLang(uiLang, '주가 ÷ 주당매출', 'Price ÷ revenue per share.'),
      read: pickLang(uiLang, '적자 기업/초기 성장주 비교에 유용', 'Useful for pre-profit and early growth names.'),
    },
    {
      metric: 'P / FCF',
      value: activeLoading ? '--' : pFcf,
      desc: pickLang(uiLang, '주가 ÷ 주당잉여현금흐름', 'Price ÷ free cash flow per share.'),
      read: pickLang(uiLang, '낮을수록 현금창출 대비 가격 부담이 낮음', 'Lower usually means less valuation pressure vs cash generation.'),
    },
    {
      metric: 'PBR',
      value: activeLoading ? '--' : pbr,
      desc: pickLang(uiLang, '주가 ÷ 주당순자산(BVPS)', 'Price ÷ book value per share (BVPS).'),
      read: pickLang(uiLang, '업종별 기준 차이 큼(금융/제조/성장주 다름)', 'Interpretation differs by sector (finance/manufacturing/growth).'),
    },
    {
      metric: 'tPEG',
      value: activeLoading ? '--' : tPeg,
      desc: pickLang(uiLang, 'PER ÷ EPS 성장률(트레일링)', 'P/E ÷ trailing EPS growth rate.'),
      read: pickLang(uiLang, '1 전후면 밸류-성장 균형 구간으로 해석', 'Around 1 can indicate valuation-growth balance.'),
    },
  ]

  return (
    <section className={`rounded-3xl border border-white/10 bg-slate-950/88 shadow-[0_20px_60px_rgba(0,0,0,0.22)] ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/90">
            {pickLang(uiLang, STREET_TEXT.sectionKicker.ko, STREET_TEXT.sectionKicker.en)}
          </div>
          <h3 className="mt-2 text-2xl font-black text-white">
            {ticker} {pickLang(uiLang, STREET_TEXT.sectionTitleSuffix.ko, STREET_TEXT.sectionTitleSuffix.en)}
          </h3>
          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <div className="text-4xl font-black text-cyan-200">
              {consMean != null ? formatPrice(consMean) : formatPrice(displayPrice)}
            </div>
            {upside != null && (
              <div className={`text-[14px] font-semibold ${upside >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatPct(upside)} {pickLang(uiLang, STREET_TEXT.upside.ko, STREET_TEXT.upside.en)}
              </div>
            )}
          </div>
          {analystCnt != null && (
            <div className="mt-1.5 text-[12px] text-slate-300">
              {pickLang(uiLang, STREET_TEXT.basedOn.ko, STREET_TEXT.basedOn.en)} {Math.round(analystCnt)} {pickLang(uiLang, STREET_TEXT.basedOnTargets.ko, STREET_TEXT.basedOnTargets.en)}
            </div>
          )}
        </div>
        {analystCnt != null && (
          <span className="self-start rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-200">
            {Math.round(analystCnt)} {pickLang(uiLang, STREET_TEXT.analysts.ko, STREET_TEXT.analysts.en)}
          </span>
        )}
      </div>

      {activeError && (
        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/8 px-4 py-3 text-base text-rose-100">
          {activeError}
        </div>
      )}

      <div className="mt-5">
        <ForecastChart
          history={history}
          current={displayPrice}
          forecast={forecast}
          loading={Boolean(activeLoading)}
          uiLang={uiLang}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="space-y-3">
          <ForwardPEStrip consensus={consensus} currentPrice={displayPrice} currentPe={currentPe} forecast={forecast} uiLang={uiLang} />
          <div className="grid grid-cols-2 gap-2">
            <RatioCard label="PSR (P/S)" value={activeLoading ? '--' : psr} hint={pickLang(uiLang, STREET_TEXT.ratioHintPsr.ko, STREET_TEXT.ratioHintPsr.en)} />
            <RatioCard label="P / FCF" value={activeLoading ? '--' : pFcf} hint={pickLang(uiLang, STREET_TEXT.ratioHintPfcf.ko, STREET_TEXT.ratioHintPfcf.en)} />
            <RatioCard label="PBR" value={activeLoading ? '--' : pbr} hint={pickLang(uiLang, STREET_TEXT.ratioHintPbr.ko, STREET_TEXT.ratioHintPbr.en)} />
            <RatioCard label="tPEG" value={activeLoading ? '--' : tPeg} hint={pickLang(uiLang, STREET_TEXT.ratioHintTpeg.ko, STREET_TEXT.ratioHintTpeg.en)} />
          </div>
          <MetricGuideTable rows={metricRows} uiLang={uiLang} />
        </div>
        <MethodologyCard currentPe={currentPe} refPe={refPe} uiLang={uiLang} />
      </div>
    </section>
  )
}


