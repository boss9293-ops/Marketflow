'use client'

import { useEffect, useState } from 'react'
import MacroDetailCard from '@/components/macro/MacroDetailCard'
import PublicMacroContext from '@/components/macro/PublicMacroContext'
import RealTimeTab from '@/components/macro/tabs/RealTimeTab'
import EarlyWarningTab from '@/components/macro/tabs/EarlyWarningTab'
import LanguageModeToggle from '@/components/LanguageModeToggle'
import InfoTip from '@/components/ui/InfoTip'
import { refreshMacroStore, useMacroStore } from '@/stores/macroStore'
import { pickLang, useLangMode } from '@/lib/useLangMode'
import { MACRO_TERM_COPY } from '@/lib/macroCopy'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'
const HISTORY_LOOKBACK_DAYS = 1095
const HISTORY_TABLE_ROWS = 30

type MacroHistoryRow = {
  snapshot_date: string
  mps: number | null
  lpi: number | null
  rpi: number | null
  vri: number | null
  csi?: { value?: number | null; state?: string }
  csi_value?: number | null
  xconf: string
  ghedge: string
  quality_overall: string
  validation_status: 'OK' | 'Watch'
  revision_detected: boolean
  drift_flag?: boolean
  series?: Record<string, any>
}

type RevisionRow = {
  detected_at: string
  series_id: string
  change_summary: string
  severity: 'Low' | 'Medium' | 'High'
}

type TerminalSeriesRow = {
  date: string
  BTC: number | null
  QQQ: number | null
  PRICE: number | null
  M2: number | null
  M2Raw: number | null
  M2Nowcast: number | null
  M2YoY: number | null
  M2YoYRaw: number | null
  M2YoYNowcast: number | null
}

function fmt(v: any, digits = 1, suffix = '') {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)}${suffix}`
}

function qualityWeight(quality?: string) {
  const q = String(quality || '').toUpperCase()
  if (q === 'OK') return 1
  if (q === 'PARTIAL') return 0.6
  if (q === 'STALE') return 0.3
  return 0
}

function sourceBadgeClass(source: string) {
  const s = String(source || '').toUpperCase()
  if (s === 'FRED') return 'border-sky-400/20 text-sky-200 bg-sky-500/10'
  if (s === 'CBOE' || s === 'STOOQ') return 'border-amber-400/20 text-amber-200 bg-amber-500/10'
  if (s === 'PROXY') return 'border-violet-400/20 text-violet-200 bg-violet-500/10'
  return 'border-white/10 text-slate-300 bg-white/5'
}

function bandFromValue(v: number | null): string {
  if (typeof v !== 'number') return 'NA'
  if (v >= 66) return 'Risk'
  if (v >= 33) return 'Watch'
  return 'Normal'
}

function auxStateClass(state?: string) {
  const s = String(state || 'NA').toLowerCase()
  if (s === 'stress' || s === 'risk') return 'border-rose-400/30 text-rose-200 bg-rose-500/10'
  if (s === 'watch') return 'border-amber-400/30 text-amber-200 bg-amber-500/10'
  if (s === 'normal') return 'border-emerald-400/30 text-emerald-200 bg-emerald-500/10'
  return 'border-white/15 text-slate-200 bg-white/5'
}

function pickSeriesLatest(row: MacroHistoryRow, key: string): number | null {
  const raw = row?.series?.[key]?.latest?.value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw
}

function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null
  const p = ((cur - prev) / Math.abs(prev)) * 100
  return Number.isFinite(p) ? p : null
}

function pctFromLookback<T extends Record<string, any>>(
  arr: T[],
  key: string,
  lookback: number
): number | null {
  if (!Array.isArray(arr) || arr.length <= lookback) return null
  const cur = arr[arr.length - 1]?.[key]
  const prev = arr[arr.length - 1 - lookback]?.[key]
  if (typeof cur !== 'number' || typeof prev !== 'number') return null
  return pctChange(cur, prev)
}

function paddedDomain([dataMin, dataMax]: [number, number]) {
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return [0, 1]
  if (dataMin === dataMax) {
    const base = Math.abs(dataMin) > 1 ? Math.abs(dataMin) * 0.05 : 1
    return [dataMin - base, dataMax + base]
  }
  const span = dataMax - dataMin
  const pad = span * 0.08
  return [dataMin - pad, dataMax + pad]
}

function compactTick(v: any) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${Math.round(n)}`
}

function computeDomainFromRows(rows: Array<Record<string, any>>, key: string) {
  const values = rows
    .map((r) => Number(r?.[key]))
    .filter((v) => Number.isFinite(v)) as number[]
  if (!values.length) return [0, 1] as [number, number]
  const min = Math.min(...values)
  const max = Math.max(...values)
  return paddedDomain([min, max]) as [number, number]
}

function formatUsd(v: any, digits = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function formatM2Trillion(v: any, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const t = n / 1000 // M2SL is roughly in billions; convert to trillions for display
  return `${t.toFixed(digits)}T`
}

function formatPct(v: any, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

function formatUsdLogTick(v: any) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000) return `$${compactTick(n)}`
  if (n >= 1) return `$${Math.round(n)}`
  return `$${n.toFixed(2)}`
}

function robustDomain(values: number[]): [number, number] {
  if (!values.length) return [1, 10]
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length < 20) return paddedDomain([sorted[0], sorted[sorted.length - 1]]) as [number, number]
  const loIdx = Math.max(0, Math.floor(sorted.length * 0.02))
  const hiIdx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.98))
  const lo = sorted[loIdx]
  const hi = sorted[hiIdx]
  return paddedDomain([lo, hi]) as [number, number]
}

function weekBucket(dateStr: string) {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const day = d.getDay() // 0(Sun)~6(Sat)
  const deltaToSunday = 7 - day
  const sunday = new Date(d)
  sunday.setDate(d.getDate() + (day === 0 ? 0 : deltaToSunday))
  const y = sunday.getFullYear()
  const m = String(sunday.getMonth() + 1).padStart(2, '0')
  const dd = String(sunday.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function aggregateWeeklyTerminal(rows: Array<Record<string, any>>) {
  if (!rows.length) return rows
  const map = new Map<string, Record<string, any>>()
  for (const row of rows) {
    const key = weekBucket(String(row.date))
    map.set(key, { ...row, date: key }) // keep last row in same week
  }
  return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

export default function MacroRoomV2() {
  const state = useMacroStore()
  const mode = useLangMode()
  const langKey = mode === 'ko' ? 'KR' : 'EN'
  const bandsTip = MACRO_TERM_COPY.BANDS_PERCENTILES[langKey].body
  const driversTip = mode === 'ko'
    ? 'Drivers는 해당 지표를 구성하는 입력 지표들의 목록입니다. 숫자들의 방향성과 강도를 반영합니다.'
    : 'Drivers are the input sources used to build the metric. They reflect direction and intensity of inputs.'
  const impactTip = mode === 'ko'
    ? '각 지표가 어떤 입력(Drivers)으로 계산되는지와 압력 점수에 어떻게 반영되는지 보여줍니다.'
    : 'Shows how each metric is built from its drivers and how it maps into pressure scores.'
  const [viewTab, setViewTab] = useState<'realtime' | 'context' | 'early_warning' | 'history' | 'debug'>('realtime')
  const [historyRange, setHistoryRange] = useState<'1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL'>('1Y')
  const [zoomSpan, setZoomSpan] = useState<number | null>(null)
  const [showHistorySensors, setShowHistorySensors] = useState(false)
  const [historySensorKeys, setHistorySensorKeys] = useState<Array<'LPI' | 'RPI' | 'VRI' | 'CSI'>>(['LPI', 'VRI'])
  const [m2Scope, setM2Scope] = useState<'US' | 'GLOBAL'>('US')
  const [history, setHistory] = useState<MacroHistoryRow[]>([])
  const [revisions, setRevisions] = useState<RevisionRow[]>([])
  const [terminalSeries, setTerminalSeries] = useState<TerminalSeriesRow[]>([])
  const [terminalMeta, setTerminalMeta] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!state.data && !state.loading && !state.error) refreshMacroStore()
  }, [state.data, state.loading, state.error])

  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/macro/snapshots?limit=${HISTORY_LOOKBACK_DAYS}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((json) => {
        if (alive) setHistory(Array.isArray(json) ? json : [])
      })
      .catch(() => {
        if (alive) setHistory([])
      })
    return () => {
      alive = false
    }
  }, [state.fetchedAt])

  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/macro/terminal_series?years=3&scope=${m2Scope}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((json) => {
        const rows = Array.isArray(json?.rows) ? json.rows : []
        if (!alive) return
        setTerminalMeta((json?.meta || {}) as Record<string, any>)
        setTerminalSeries(
          rows.map((r: any) => ({
            date: String(r?.date || ''),
            BTC: typeof r?.BTC === 'number' ? r.BTC : null,
            QQQ: typeof r?.QQQ === 'number' ? r.QQQ : null,
            PRICE: typeof r?.PRICE === 'number' ? r.PRICE : null,
            M2: typeof r?.M2 === 'number' ? r.M2 : null,
            M2Raw: typeof r?.M2Raw === 'number' ? r.M2Raw : null,
            M2Nowcast: typeof r?.M2Nowcast === 'number' ? r.M2Nowcast : null,
            M2YoY: typeof r?.M2YoY === 'number' ? r.M2YoY : null,
            M2YoYRaw: typeof r?.M2YoYRaw === 'number' ? r.M2YoYRaw : null,
            M2YoYNowcast: typeof r?.M2YoYNowcast === 'number' ? r.M2YoYNowcast : null,
          }))
        )
      })
      .catch(() => {
        if (alive) {
          setTerminalMeta({})
          setTerminalSeries([])
        }
      })
    return () => {
      alive = false
    }
  }, [state.fetchedAt, m2Scope])

  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/macro/revisions?limit=10`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((json) => {
        if (alive) setRevisions(Array.isArray(json) ? json : [])
      })
      .catch(() => {
        if (alive) setRevisions([])
      })
    return () => {
      alive = false
    }
  }, [state.fetchedAt])

  useEffect(() => {
    // Keep zoom state consistent when range or history payload changes.
    setZoomSpan(null)
  }, [historyRange, history.length])

  if (state.loading) return <div className="text-slate-400 text-sm">{pickLang(mode, '매크로 스냅샷 로딩 중...', 'Loading macro snapshot...')}</div>
  if (state.error) return <div className="text-red-400 text-sm">{pickLang(mode, '오류', 'Error')}: {state.error}</div>
  if (!state.data) return <div className="text-slate-400 text-sm">{pickLang(mode, '사용 가능한 매크로 스냅샷이 없습니다.', 'No macro snapshot available.')}</div>

  const data = state.data
  const c = data.computed || {}
  const series = (data.series || {}) as Record<string, any>
  const health = ((data as any).health?.series || {}) as Record<string, any>

  const lpi = typeof c?.LPI?.value === 'number' ? c.LPI.value : 0
  const rpi = typeof c?.RPI?.value === 'number' ? c.RPI.value : 0
  const vri = typeof c?.VRI?.value === 'number' ? c.VRI.value : 0
  const csi = typeof c?.CSI?.value === 'number' ? c.CSI.value : 0
  const mps = typeof c?.MPS?.value === 'number' ? c.MPS.value : 0
  const mpsQuality = String(c?.MPS?.quality_effective || c?.MPS?.quality || (data as any)?.quality_summary?.overall || '')
  const mpsUpdatedAt = String(c?.MPS?.updated || (data as any)?.asof || '')
  const mpsAgeMinutes = (() => {
    const keys = ['WALCL', 'M2SL', 'RRP', 'EFFR', 'DFII10', 'VIX', 'HY_OAS']
    const ages = keys
      .map((k) => Number((health as any)?.[k]?.age_minutes))
      .filter((v) => Number.isFinite(v)) as number[]
    if (!ages.length) return null
    return Math.max(...ages)
  })()

  const phase = String(c?.PHASE?.phase || 'Expansion')
  const phaseDrivers = (c?.PHASE?.drivers || []) as string[]
  const defensiveMode = String(c?.DEFENSIVE?.mode || 'OFF')
  const shockProb = typeof c?.SHOCK?.probability_30d === 'number' ? c.SHOCK.probability_30d : null
  const shockState = String(c?.SHOCK?.state || 'Low')
  const shockDrivers = (c?.SHOCK?.drivers || []) as string[]
  const shockScores = (c?.SHOCK?.components?.scores || {}) as Record<string, number>
  const shockWeights = (c?.SHOCK?.components?.weights || {}) as Record<string, number>
  const shockContrib = (c?.SHOCK?.components?.contrib || {}) as Record<string, number>
  const xconf = String(c?.XCONF?.status || c?.XCONF?.label || 'NA')
  const ghedge = String(c?.GHEDGE?.status || c?.GHEDGE?.label || 'NA')
  const qqqRv20 = typeof c?.SHOCK?.components?.raw?.realized_vol_20d === 'number' ? c.SHOCK.components.raw.realized_vol_20d : null
  const qqqDdVel10 = typeof c?.SHOCK?.components?.raw?.dd_velocity_10d === 'number' ? c.SHOCK.components.raw.dd_velocity_10d : null
  const btcM2 = (c?.BTC_M2 || {}) as Record<string, any>
  const btcM2State = String(btcM2?.state || btcM2?.status || 'NA')
  const btcM2Divergence = typeof btcM2?.divergence === 'number' ? btcM2.divergence : null
  const btcM2Btc30 = typeof btcM2?.btc_30d_roc === 'number' ? btcM2.btc_30d_roc : null
  const btcM2Btc90 = typeof btcM2?.btc_90d_roc === 'number' ? btcM2.btc_90d_roc : null
  const btcM2M2Yoy = typeof btcM2?.m2_yoy === 'number' ? btcM2.m2_yoy : null
  const btcM2Ratio = typeof btcM2?.ratio === 'number' ? btcM2.ratio : null
  const m2Freq = String(series?.M2?.freq || series?.M2SL?.freq || 'M').toUpperCase()
  const qqqAge = typeof (data as any)?.meta?.data_age_summary?.QQQ === 'number' ? (data as any).meta.data_age_summary.QQQ : null
  const tqqqAge = typeof (data as any)?.meta?.data_age_summary?.TQQQ === 'number' ? (data as any).meta.data_age_summary.TQQQ : null
  const tqqqHasSeries = Boolean(data?.series?.TQQQ?.latest?.date)
  const tqqqConnected = tqqqHasSeries && (tqqqAge !== null || typeof (data as any)?.meta?.sensor_latency_ms?.TQQQ === 'number')

  const publicRows = (c?.PUBLIC_CONTEXT?.rows || []) as any[]

  const confidenceRows = Object.values(health)
  const confidenceScore = confidenceRows.length
    ? Math.round((confidenceRows.reduce((acc: number, row: any) => acc + qualityWeight(row?.quality_effective || row?.base_quality), 0) / confidenceRows.length) * 100)
    : 0

  const srcFed = String(series?.EFFR?.source || 'FRED')
  const srcRates = String(series?.DGS10?.source || 'FRED')
  const srcCurve = String(series?.DGS2?.source || 'FRED')
  const srcHy = String(series?.HY_OAS?.source || 'FRED')
  const srcVix = String(series?.VIX?.source || 'CBOE')
  const srcPc = String(series?.PUT_CALL?.source || 'PROXY')
  const srcLiq = String(series?.M2SL?.source || 'FRED')

  // Backend can return multiple snapshots for the same snapshot_date (intraday rebuilds).
  // Keep one row per date to prevent vertical spike artifacts in line charts.
  const historyDedup = (() => {
    const byDate = new Map<string, MacroHistoryRow>()
    for (const row of history) {
      const d = String(row?.snapshot_date || '')
      if (!d) continue
      // history payload is typically desc by date; keep first (latest) row per day.
      if (!byDate.has(d)) byDate.set(d, row)
    }
    return Array.from(byDate.values())
  })()
  const historyAsc = [...historyDedup].sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)))
  const historyDesc = [...historyDedup].sort((a, b) => String(b.snapshot_date).localeCompare(String(a.snapshot_date)))
  const engineChartData = historyAsc.map((row) => ({
    date: row.snapshot_date,
    MPS: typeof row.mps === 'number' ? row.mps : null,
    LPI: typeof row.lpi === 'number' ? row.lpi : null,
    RPI: typeof row.rpi === 'number' ? row.rpi : null,
    VRI: typeof row.vri === 'number' ? row.vri : null,
    CSI:
      typeof row.csi_value === 'number'
        ? row.csi_value
        : typeof row.csi?.value === 'number'
          ? row.csi.value
          : null,
  }))
  const mpsRawVals = engineChartData
    .map((r) => Number(r.MPS))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 1000) as number[]
  const median = (arr: number[]) => {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  }
  const oldWindow = mpsRawVals.slice(0, Math.max(0, mpsRawVals.length - 30))
  const newWindow = mpsRawVals.slice(Math.max(0, mpsRawVals.length - 30))
  const oldMed = median(oldWindow)
  const newMed = median(newWindow)
  // Legacy snapshots in this project occasionally used compressed 0~10 scale.
  // For history readability only, normalize legacy points to 0~100 when regime-break is detected.
  const legacyScaleDetected = oldMed != null && newMed != null && oldMed > 0 && oldMed <= 10 && newMed >= 20

  const mpsOnlyData = engineChartData
    .map((row) => {
      let raw = Number(row.MPS)
      if (!Number.isFinite(raw)) return null
      if (legacyScaleDetected && raw <= 10) raw = raw * 10
      // Defensive guard: MPS is a 0~100 score. Drop obviously broken points.
      if (raw < -100 || raw > 1000) return null
      const clamped = Math.max(0, Math.min(100, raw))
      return { date: row.date, MPS: clamped }
    })
    .filter(Boolean)
    .sort((a, b) => String(a!.date).localeCompare(String(b!.date))) as Array<{ date: string; MPS: number }>
  const pickMpsYMax = (maxVal: number) => {
    if (!Number.isFinite(maxVal) || maxVal <= 0) return 30
    if (maxVal <= 8) return 10
    if (maxVal <= 12) return 15
    if (maxVal <= 25) return 30
    if (maxVal <= 40) return 50
    if (maxVal <= 60) return 70
    return 100
  }
  const mpsObservedMax = mpsOnlyData.length ? Math.max(...mpsOnlyData.map((r) => Number(r.MPS) || 0)) : 0
  const mpsYMax = pickMpsYMax(mpsObservedMax)
  const mpsNow = mpsOnlyData.length ? mpsOnlyData[mpsOnlyData.length - 1].MPS : null
  const mps30Prev = mpsOnlyData.length > 30 ? mpsOnlyData[mpsOnlyData.length - 31].MPS : null
  const mps30Delta = mpsNow != null && mps30Prev != null ? mpsNow - mps30Prev : null
  const mps30Avg = (() => {
    if (!mpsOnlyData.length) return null
    const window = mpsOnlyData.slice(Math.max(0, mpsOnlyData.length - 30))
    if (!window.length) return null
    const sum = window.reduce((acc, row) => acc + (Number.isFinite(row.MPS) ? row.MPS : 0), 0)
    return sum / window.length
  })()
  const mpsDirection = mps30Delta == null ? 'flat' : mps30Delta > 2 ? 'up' : mps30Delta < -2 ? 'down' : 'flat'
  const mpsDirectionText = mpsDirection === 'up'
    ? pickLang(mode, '↗ 압박 상승', '↗ Pressure Rising')
    : mpsDirection === 'down'
      ? pickLang(mode, '↘ 압박 완화', '↘ Pressure Easing')
      : pickLang(mode, '→ 압박 중립', '→ Pressure Neutral')
  const mpsZoneText = (() => {
    if (mpsNow == null) return pickLang(mode, 'N/A', 'N/A')
    if (mpsNow < 30) return 'LOW'
    if (mpsNow < 50) return 'MODERATE'
    if (mpsNow < 70) return 'ELEVATED'
    return 'HIGH'
  })()
  const macroChartData = historyAsc.map((row) => ({
    date: row.snapshot_date,
    EFFR: pickSeriesLatest(row, 'EFFR'),
    DGS10: pickSeriesLatest(row, 'DGS10'),
    DGS2: pickSeriesLatest(row, 'DGS2'),
    VIX: pickSeriesLatest(row, 'VIX'),
    HY_OAS: pickSeriesLatest(row, 'HY_OAS'),
    M2SL: pickSeriesLatest(row, 'M2SL'),
    WALCL: pickSeriesLatest(row, 'WALCL'),
    DXY: pickSeriesLatest(row, 'DXY') ?? pickSeriesLatest(row, 'USD_BROAD'),
    BTC: pickSeriesLatest(row, 'BTC'),
    GLD: pickSeriesLatest(row, 'GLD'),
  }))
  const historyPriceByDate = new Map(
    macroChartData
      .map((r) => ({ date: String(r.date), price: (typeof r.BTC === 'number' ? r.BTC : (typeof (r as any).QQQ === 'number' ? (r as any).QQQ : null)) }))
      .filter((r) => typeof r.price === 'number')
      .map((r) => [r.date, r.price as number])
  )
  const similarPattern = (() => {
    if (mpsNow == null || mpsOnlyData.length < 120) return null
    const cutoffIdx = mpsOnlyData.length - 90
    let best: { idx: number; diff: number } | null = null
    for (let i = 0; i < cutoffIdx; i += 1) {
      const v = mpsOnlyData[i].MPS
      const diff = Math.abs(v - mpsNow)
      if (!best || diff < best.diff) best = { idx: i, diff }
    }
    if (!best) return null
    const baseDate = mpsOnlyData[best.idx].date
    const next30Idx = Math.min(mpsOnlyData.length - 1, best.idx + 30)
    const nextDate = mpsOnlyData[next30Idx].date
    const p0 = historyPriceByDate.get(baseDate)
    const p1 = historyPriceByDate.get(nextDate)
    const chg = p0 && p1 && p0 !== 0 ? ((p1 - p0) / Math.abs(p0)) * 100 : null
    return { date: baseDate, change30d: chg }
  })()
  const detailObservedMax = (() => {
    if (!engineChartData.length || !historySensorKeys.length) return 0
    let mx = 0
    for (const row of engineChartData as any[]) {
      for (const k of historySensorKeys) {
        const v = Number(row?.[k])
        if (Number.isFinite(v) && v > mx) mx = v
      }
    }
    return mx
  })()
  const detailYMax = 50

  // Build weekly chart rows:
  // 1) price rows from daily snapshots -> weekly bucket(last in week)
  // 2) M2 monthly print points -> weekly bucket only (no interpolation)
  const terminalSeriesDaily = historyAsc.map((row) => {
    const btc = pickSeriesLatest(row, 'BTC')
    const qqq = pickSeriesLatest(row, 'QQQ')
    return {
      date: String(row.snapshot_date || ''),
      BTC: btc,
      QQQ: qqq,
      PRICE: btc ?? qqq,
    }
  }).filter((r) => r.date && r.PRICE != null)

  const weeklyPriceRows = aggregateWeeklyTerminal(terminalSeriesDaily as any[])

  const m2ByWeek = (() => {
    const monthlyPoints: Array<{ date: Date; value: number }> = []
    for (const row of historyAsc) {
      const d = String(row?.series?.M2SL?.latest?.date || row?.series?.M2?.latest?.date || '')
      const v = pickSeriesLatest(row, 'M2SL') ?? pickSeriesLatest(row, 'M2')
      if (!d || v == null) continue
      const dt = new Date(d)
      if (Number.isNaN(dt.getTime())) continue
      monthlyPoints.push({ date: dt, value: v })
    }
    monthlyPoints.sort((a, b) => a.date.getTime() - b.date.getTime())
    return { monthlyPoints }
  })()
  const m2YoyByWeek = (() => {
    const out = new Map<string, number>()
    const m = m2ByWeek.monthlyPoints
    for (let i = 12; i < m.length; i++) {
      const cur = m[i].value
      const prev = m[i - 12].value
      if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) continue
      out.set(weekBucket(m[i].date.toISOString().slice(0, 10)), ((cur - prev) / Math.abs(prev)) * 100)
    }
    return out
  })()

  const m2CarryByWeek = (() => {
    const out = new Map<string, number | null>()
    const m = m2ByWeek.monthlyPoints
    if (!weeklyPriceRows.length) return out
    let idx = 0
    let last: number | null = null
    for (const r of weeklyPriceRows as any[]) {
      const d = new Date(String(r.date))
      if (Number.isNaN(d.getTime())) {
        out.set(String(r.date), last)
        continue
      }
      while (idx < m.length && m[idx].date.getTime() <= d.getTime()) {
        last = m[idx].value
        idx += 1
      }
      out.set(String(r.date), last)
    }
    return out
  })()

  const terminalChartDataFallback = weeklyPriceRows.map((r: any) => {
    const wk = String(r.date)
    const m2 = m2CarryByWeek.get(wk) ?? null
    return {
      date: String(r.date),
      BTC: (typeof r.BTC === 'number' ? r.BTC : null),
      QQQ: (typeof r.QQQ === 'number' ? r.QQQ : null),
      PRICE: (typeof r.PRICE === 'number' ? r.PRICE : null),
      M2: m2,
      M2Raw: m2,
      M2Nowcast: null,
      M2YoY: m2YoyByWeek.get(wk) ?? null,
      M2YoYRaw: m2YoyByWeek.get(wk) ?? null,
      M2YoYNowcast: null,
    }
  })

  // Prefer backend-aligned raw cache series when available,
  // but guard against sparse PRICE payload.
  const backendPriceCount = terminalSeries.filter((r) => typeof r?.PRICE === 'number' && Number.isFinite(r.PRICE)).length
  const useBackendTerminal = terminalSeries.length > 0 && backendPriceCount >= 12

  const fallbackPriceByDate = new Map(
    (terminalChartDataFallback as any[])
      .filter((r) => typeof r?.PRICE === 'number' && Number.isFinite(r.PRICE))
      .map((r) => [String(r.date), Number(r.PRICE)])
  )

  const sourceTerminalRows = (useBackendTerminal ? terminalSeries : terminalChartDataFallback) as any[]
  const sourceBtcCount = sourceTerminalRows.filter((r: any) => typeof r?.BTC === 'number' && Number.isFinite(r.BTC)).length
  const useBtcPrimary = sourceBtcCount >= 12

  const terminalChartDataBase = sourceTerminalRows.map((r: any) => {
    const date = String(r?.date || '')
    const btc = typeof r?.BTC === 'number' && Number.isFinite(r.BTC) ? r.BTC : null
    const qqq = typeof r?.QQQ === 'number' && Number.isFinite(r.QQQ) ? r.QQQ : null
    const rawPrice = typeof r?.PRICE === 'number' && Number.isFinite(r.PRICE) ? r.PRICE : null
    const pPrimary = useBtcPrimary ? btc : (rawPrice ?? qqq)
    const p = pPrimary ?? fallbackPriceByDate.get(date) ?? null
    return {
      ...r,
      date,
      BTC: btc,
      QQQ: qqq,
      PRICE: p,
    }
  })

  // Keep YoY visible on weekly axis: carry last valid monthly YoY forward (step-like).
  const terminalChartData = (() => {
    // Pass 1) carry-forward valid YoY from backend
    let lastYoy: number | null = null
    const rows = (terminalChartDataBase as any[]).map((r) => {
      const current = Number(r?.M2YoY)
      if (Number.isFinite(current)) lastYoy = current
      return {
        ...r,
        M2YoYRaw: Number.isFinite(current) ? current : r?.M2YoYRaw ?? null,
        M2YoY: lastYoy,
      }
    })

    // Pass 2) frontend fallback: derive YoY from M2 level (52-week lookback)
    for (let i = 0; i < rows.length; i += 1) {
      const cur = Number(rows[i]?.M2Raw ?? rows[i]?.M2)
      const prevIdx = i - 52
      const prev = prevIdx >= 0 ? Number(rows[prevIdx]?.M2Raw ?? rows[prevIdx]?.M2) : NaN
      const derived = Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0
        ? ((cur - prev) / Math.abs(prev)) * 100
        : NaN

      if (!Number.isFinite(Number(rows[i]?.M2YoY)) && Number.isFinite(derived)) {
        rows[i].M2YoY = derived
      }
    }
    return rows
  })()

  const hasBtcSeries = useBtcPrimary
  const priceLabel = hasBtcSeries ? pickLang(mode, 'BTC 가격', 'BTC Price') : pickLang(mode, 'QQQ 가격', 'QQQ Price')
  const priceLineLabel = hasBtcSeries ? 'Bitcoin Price' : 'QQQ Price'
  const terminalLast = terminalChartData[terminalChartData.length - 1] || {}
  const terminalPrev = terminalChartData.length > 1 ? terminalChartData[terminalChartData.length - 2] : {}
  const btcDelta1d = pctChange((terminalLast as any).PRICE ?? null, (terminalPrev as any).PRICE ?? null)
  const btcDelta7d = pctFromLookback(terminalChartData as any[], 'PRICE', 1)
  const btcDelta30d = pctFromLookback(terminalChartData as any[], 'PRICE', 4)
  const m2Delta1d = pctChange((terminalLast as any).M2 ?? null, (terminalPrev as any).M2 ?? null)
  const btcAth = (terminalChartData as any[]).reduce((mx, row) => {
    const v = row?.PRICE
    if (typeof v !== 'number') return mx
    return v > mx ? v : mx
  }, 0)
  const btcAthGap = pctChange((terminalLast as any).PRICE ?? null, btcAth || null)
  const latestPrice = (terminalLast as any).PRICE ?? null
  const latestM2 = (terminalLast as any).M2 ?? null
  const m2FallbackToUs = Boolean(terminalMeta?.m2_fallback_to_us)
  const m2SymbolUsed = String(terminalMeta?.m2_symbol_used || (m2Scope === 'GLOBAL' ? 'GLOBAL_M2' : 'M2SL'))
  const m2LineLabel = m2Scope === 'US' ? 'US M2 Supply' : (m2FallbackToUs ? 'Global M2 Supply (US fallback)' : 'Global M2 Supply')
  const m2LatestDateFromChart = (() => {
    for (let i = terminalChartData.length - 1; i >= 0; i -= 1) {
      const row: any = terminalChartData[i]
      if (typeof row?.M2 === 'number' && Number.isFinite(row.M2) && row?.date) return String(row.date)
    }
    return ''
  })()
  const latestM2YoY = (() => {
    for (let i = terminalChartData.length - 1; i >= 0; i -= 1) {
      const v = Number((terminalChartData as any[])[i]?.M2YoY)
      if (Number.isFinite(v)) return v
    }
    return null
  })()

  // YoY domain must include negative percentages as well.
  const yoyValues = (terminalChartData as any[])
    .map((r) => Number(r?.M2YoY))
    .filter((v) => Number.isFinite(v)) as number[]
  const yoyAxisDomain: [number, number] = (() => {
    if (!yoyValues.length) return [-5, 20]
    const minV = Math.min(...yoyValues)
    const maxV = Math.max(...yoyValues)
    const lo = Math.min(minV, 0)
    const hi = Math.max(maxV, 0)
    return paddedDomain([lo, hi]) as [number, number]
  })()

  const rangeDaysMap: Record<'1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL', number | null> = {
    '1M': 30,
    '3M': 90,
    '6M': 180,
    '1Y': 365,
    '3Y': 1095,
    ALL: null,
  }
  const selectedRangeDays = rangeDaysMap[historyRange]
  const terminalChartFiltered = (() => {
    if (!terminalChartData.length || selectedRangeDays == null) return terminalChartData
    const end = new Date(String(terminalChartData[terminalChartData.length - 1]?.date))
    if (Number.isNaN(end.getTime())) return terminalChartData
    const cutoff = new Date(end)
    cutoff.setDate(cutoff.getDate() - selectedRangeDays)
    return terminalChartData.filter((row) => {
      const d = new Date(String((row as any).date))
      return !Number.isNaN(d.getTime()) && d >= cutoff
    })
  })()
  const terminalChartZoomed = (() => {
    const n = terminalChartFiltered.length
    if (!n) return terminalChartFiltered
    if (zoomSpan == null || zoomSpan >= n) return terminalChartFiltered
    const start = Math.max(0, n - zoomSpan)
    return terminalChartFiltered.slice(start)
  })()
  const leftValues = terminalChartZoomed
    .map((r: any) => Number(r?.PRICE))
    .filter((v: number) => Number.isFinite(v) && v > 0)
  const leftAxisDomain = leftValues.length > 0 ? robustDomain(leftValues) : ([1, 10] as [number, number])
  const leftAxisScale: 'log' | 'linear' = leftValues.length > 0 ? 'log' : 'linear'
  const rightAxisDomain = computeDomainFromRows(terminalChartZoomed as any[], 'M2')

  // X-axis: 1M or 2M tick intervals, snapped to nearest actual data date
  const xAxisTicks = (() => {
    const data = terminalChartZoomed as any[]
    if (data.length < 2) return undefined
    const first = new Date(String(data[0].date))
    const last  = new Date(String(data[data.length - 1].date))
    if (isNaN(first.getTime()) || isNaN(last.getTime())) return undefined
    const totalMonths =
      (last.getFullYear() - first.getFullYear()) * 12 +
      (last.getMonth() - first.getMonth())
    // step: 1M if ≤ 14 months visible, else 2M
    const step = totalMonths <= 14 ? 1 : 2
    const ticks: string[] = []
    // start at the 1st day of the month after the first visible date
    const cur = new Date(first.getFullYear(), first.getMonth() + 1, 1)
    while (cur <= last) {
      const target = cur.getTime()
      let best = data[0]
      let bestDiff = Math.abs(new Date(String(data[0].date)).getTime() - target)
      for (const row of data) {
        const diff = Math.abs(new Date(String(row.date)).getTime() - target)
        if (diff < bestDiff) { bestDiff = diff; best = row }
      }
      ticks.push(String(best.date))
      cur.setMonth(cur.getMonth() + step)
    }
    return Array.from(new Set(ticks))
  })()

  const handleTerminalWheel = (e: any) => {
    if (!terminalChartFiltered.length) return
    e.preventDefault?.()
    const n = terminalChartFiltered.length
    const minSpan = Math.min(20, n)
    const step = Math.max(8, Math.round(n * 0.08))
    setZoomSpan((prev) => {
      const cur = prev == null ? n : prev
      const next = e.deltaY < 0 ? Math.max(minSpan, cur - step) : Math.min(n, cur + step)
      return next >= n ? null : next
    })
  }

  const toggleHistorySensor = (k: 'LPI' | 'RPI' | 'VRI' | 'CSI') => {
    setHistorySensorKeys((prev) => {
      if (prev.includes(k)) return prev.filter((x) => x !== k)
      if (prev.length >= 2) return [...prev.slice(1), k]
      return [...prev, k]
    })
  }

  const renderTerminalTooltip = ({ active, payload, label }: any) => {
    if (!active || !Array.isArray(payload) || payload.length === 0) return null
    const row = payload[0]?.payload || {}
    const yoy = Number(row?.M2YoY)
    const m2 = Number(row?.M2Raw ?? row?.M2)
    const price = Number(row?.PRICE)
    return (
      <div className="rounded-xl border border-slate-700 bg-[#070b14] px-3 py-2 text-sm shadow-xl">
        <div className="text-slate-300 text-xs mb-1">{String(label || '')}</div>
        <div className={`${Number.isFinite(yoy) ? (yoy >= 0 ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-400'} font-medium`}>
          {pickLang(mode, 'M2 성장률(YoY)', 'M2 Growth (%)')}: {Number.isFinite(yoy) ? formatPct(yoy, 2) : 'N/A'}
        </div>
        <div className="text-fuchsia-300 font-medium">
          {pickLang(mode, 'US M2 공급', 'US M2 Supply')}: {Number.isFinite(m2) ? formatM2Trillion(m2, 3) : 'N/A'}
        </div>
        <div className="text-amber-300 font-medium">
          {priceLineLabel}: {Number.isFinite(price) ? formatUsd(price, 0) : 'N/A'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-slate-300">
          {pickLang(mode, '스냅샷', 'Snapshot')}: <span className="text-white font-semibold">{data.snapshot_date}</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageModeToggle />
          <button
            type="button"
            onClick={() => refreshMacroStore()}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-slate-200 hover:bg-white/5"
          >
            {pickLang(mode, '새로고침', 'Refresh')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {[
          { key: 'realtime', label: pickLang(mode, 'Real-time', 'Real-time') },
          { key: 'context', label: pickLang(mode, 'Context', 'Context') },
          { key: 'early_warning', label: pickLang(mode, 'Early Warning', 'Early Warning') },
          { key: 'history', label: pickLang(mode, 'History', 'History') },
          { key: 'debug', label: 'Debug' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setViewTab(tab.key as 'realtime' | 'context' | 'early_warning' | 'history' | 'debug')}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              viewTab === tab.key
                ? 'border-cyan-400/40 text-cyan-200 bg-cyan-500/10'
                : 'border-white/10 text-slate-300 hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {viewTab === 'realtime' && (
        <RealTimeTab
          mode={mode}
          lpi={lpi}
          rpi={rpi}
          vri={vri}
          csi={csi}
          mps={mps}
          phase={phase}
          defensiveMode={defensiveMode}
          shockProb={shockProb}
          shockState={shockState}
          shockRaw={typeof c?.SHOCK?.value === 'number' ? c.SHOCK.value : null}
          drivers={shockDrivers.length ? shockDrivers : phaseDrivers}
          shockContrib={shockContrib}
          shockScores={shockScores}
          quality={mpsQuality}
          updatedAt={mpsUpdatedAt}
          ageMinutes={mpsAgeMinutes}
          xconf={xconf}
          ghedge={ghedge}
          xconfGlobal={c?.XCONF_GLOBAL || null}
        />
      )}

      {viewTab === 'early_warning' && (
        <EarlyWarningTab
          mode={mode}
          vri={vri}
          csi={csi}
          shockProb={shockProb}
          phase={phase}
          defensiveMode={defensiveMode}
          qqqRealizedVol20d={qqqRv20}
          qqqDdVelocity10d={qqqDdVel10}
          qqqAgeMinutes={qqqAge}
          tqqqAgeMinutes={tqqqAge}
          tqqqConnected={tqqqConnected}
          defensiveTrigger={c?.DEFENSIVE_TRIGGER || null}
        />
      )}

      {viewTab === 'context' && (
        <div className="space-y-4">
          <div className="bg-[#17191d] rounded-2xl p-5 border border-white/10">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xl md:text-2xl font-extrabold tracking-tight text-slate-100">{pickLang(mode, '데이터 신뢰도', 'Data Confidence')}</div>
              <div className="text-base md:text-lg font-semibold text-slate-100">
                {confidenceScore}%
              </div>
            </div>
            <div className="mt-3 h-3 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400" style={{ width: `${Math.max(0, Math.min(100, confidenceScore))}%` }} />
            </div>
          </div>

          <PublicMacroContext rows={publicRows} mode={mode} />

          <div className="bg-[#16181c] rounded-2xl p-4 border border-white/10">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-lg md:text-xl font-bold tracking-tight text-slate-100">
                  {pickLang(mode, 'BTC–M2 유동성 오버레이', 'BTC–M2 Liquidity Overlay')}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {pickLang(
                    mode,
                    'BTC는 유동성 변화에 민감하게 반응할 수 있습니다. M2는 월간 발표값을 일간 축에서 계단형(step+ffill)으로 표시합니다.',
                    'BTC can react to liquidity changes. M2 is monthly and shown as step+ffill on daily axis.'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="px-2 py-1 rounded-md border border-sky-400/20 text-sky-200 bg-sky-500/10">Aux</span>
                <span className="px-2 py-1 rounded-md border border-violet-400/20 text-violet-200 bg-violet-500/10">No-score</span>
                <span className="px-2 py-1 rounded-md border border-amber-400/20 text-amber-200 bg-amber-500/10">
                  {pickLang(mode, '월간(M2)', 'Monthly(M2)')}
                </span>
                <span className="px-2 py-1 rounded-md border border-cyan-400/20 text-cyan-200 bg-cyan-500/10">Step</span>
                <span className={`px-2 py-1 rounded-md border ${auxStateClass(btcM2State)}`}>{btcM2State}</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="text-slate-400">{pickLang(mode, 'BTC', 'BTC')}</div>
                <div className="text-slate-100 font-semibold">{formatUsd((terminalLast as any).PRICE, 0)}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="text-slate-400">BTC 30D</div>
                <div className={`${(btcM2Btc30 ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold`}>{fmt(btcM2Btc30, 2, '%')}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="text-slate-400">BTC 90D</div>
                <div className={`${(btcM2Btc90 ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold`}>{fmt(btcM2Btc90, 2, '%')}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="text-slate-400">M2 YoY</div>
                <div className={`${(btcM2M2Yoy ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold`}>{fmt(btcM2M2Yoy, 2, '%')}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="text-slate-400">{pickLang(mode, '디버전스', 'Divergence')}</div>
                <div className={`${(btcM2Divergence ?? 0) >= 0 ? 'text-amber-300' : 'text-cyan-300'} font-semibold`}>{fmt(btcM2Divergence, 2, '%')}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="text-slate-400">BTC/M2</div>
                <div className="text-slate-100 font-semibold">{fmt(btcM2Ratio, 6)}</div>
              </div>
            </div>

            <div className="mt-3 h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={terminalChartZoomed as any[]} margin={{ top: 10, right: 72, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} />
                  <YAxis yAxisId="left" scale={leftAxisScale} tick={{ fill: '#e2e8f0', fontSize: 11 }} tickFormatter={formatUsdLogTick} width={62} domain={leftAxisDomain as any} />
                  <YAxis yAxisId="yoy" orientation="right" tick={{ fill: '#93c5fd', fontSize: 11 }} tickFormatter={(v) => formatPct(v, 0)} width={48} domain={yoyAxisDomain as any} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#60a5fa', fontSize: 11 }} tickFormatter={formatM2Trillion} width={62} domain={rightAxisDomain as any} dx={34} axisLine={false} tickLine={false} />
                  <Tooltip content={renderTerminalTooltip as any} />
                  <Legend wrapperStyle={{ color: '#cbd5e1', fontSize: 11 }} />
                  <ReferenceLine yAxisId="yoy" y={0} stroke="#334155" strokeDasharray="3 3" />
                  <Bar yAxisId="yoy" dataKey="M2YoY" name="M2 Growth (%)" barSize={5}>
                    {(terminalChartZoomed as any[]).map((entry: any, idx: number) => (
                      <Cell key={`ctx-yoy-${idx}`} fill={Number(entry?.M2YoY) >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.8} />
                    ))}
                  </Bar>
                  <Line yAxisId="right" dataKey="M2Raw" name="US M2 Supply" type="stepAfter" stroke="#3b82f6" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line yAxisId="left" dataKey="PRICE" name={priceLineLabel} type="linear" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-[#16181c] rounded-2xl p-4 border border-white/10">
            <h3 className="text-xl md:text-2xl font-extrabold tracking-tight text-slate-100 flex items-center gap-2">
              {pickLang(mode, '영향 매핑', 'Impact Mapping')}
              <InfoTip content={impactTip} />
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 flex items-center justify-between gap-2">
                <div className="text-slate-300">{pickLang(mode, '정책금리 · 10년물 · 2s10s → RPI', 'Fed Rate · 10Y · 2s10s → RPI')}</div>
                <div className="flex items-center gap-1">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(srcFed)}`}>{srcFed}</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(srcRates)}`}>{srcRates}</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(srcCurve)}`}>{srcCurve}</span>
                  <span className="text-emerald-300 font-medium">{fmt(rpi)}</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 flex items-center justify-between gap-2">
                <div className="text-slate-300">{pickLang(mode, 'HY OAS → CSI', 'HY OAS → CSI')}</div>
                <div className="flex items-center gap-1">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(srcHy)}`}>{srcHy}</span>
                  <span className="text-emerald-300 font-medium">{fmt(csi)}</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 flex items-center justify-between gap-2">
                <div className="text-slate-300">{pickLang(mode, 'VIX + 풋/콜 → VRI', 'VIX + Put/Call → VRI')}</div>
                <div className="flex items-center gap-1">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(srcVix)}`}>{srcVix}</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(srcPc)}`}>{srcPc}</span>
                  <span className="text-emerald-300 font-medium">{fmt(vri)}</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 flex items-center justify-between gap-2">
                <div className="text-slate-300">{pickLang(mode, 'M2 + WALCL + RRP → LPI', 'M2 + WALCL + RRP → LPI')}</div>
                <div className="flex items-center gap-1">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(srcLiq)}`}>{srcLiq}</span>
                  <span className="text-emerald-300 font-medium">{fmt(lpi)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold text-slate-100">
                {pickLang(mode, 'Shock 분해(근거)', 'Shock Decomposition (Evidence)')}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {pickLang(mode, '기여도 = 점수(0~100) × 가중치', 'Contribution = score(0~100) × weight')}
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                {[
                  ['VRI', shockScores.VRI, shockWeights.VRI, shockContrib.VRI],
                  ['CSI', shockScores.CSI, shockWeights.CSI, shockContrib.CSI],
                  ['REALIZED_VOL', shockScores.REALIZED_VOL, shockWeights.RV20, shockContrib.REALIZED_VOL],
                  ['DD_VELOCITY', shockScores.DD_VELOCITY, shockWeights.DD_VEL, shockContrib.DD_VELOCITY],
                ].map(([name, score, weight, contrib]) => (
                  <div key={String(name)} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 flex items-center justify-between gap-2">
                    <span className="text-slate-300">{String(name)}</span>
                    <span className="text-slate-200 tabular-nums">
                      {typeof score === 'number' ? score.toFixed(1) : '—'} × {typeof weight === 'number' ? weight.toFixed(2) : '—'} ={' '}
                      <span className="text-cyan-300 font-semibold">{typeof contrib === 'number' ? contrib.toFixed(1) : '—'}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                {pickLang(mode, 'RAW 입력값', 'RAW inputs')}: RV20 {qqqRv20 != null ? qqqRv20.toFixed(6) : '—'}, DD_VEL {qqqDdVel10 != null ? qqqDdVel10.toFixed(6) : '—'}
              </div>
            </div>
          </div>

          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MacroDetailCard
              title={pickLang(mode, '유동성 (LPI)', 'Liquidity (LPI)')}
              titleTip={MACRO_TERM_COPY.LPI[langKey].body}
              subtitle={pickLang(mode, '시장 유동성 압박 정도 - Drivers: M2, WALCL, RRP', 'Relative pressure in market liquidity - Drivers: M2, WALCL, RRP')}
              subtitleTip={driversTip}
              value={fmt(lpi)}
              statusLabel={bandFromValue(lpi)}
              refTip={bandsTip}
              refText={pickLang(mode, 'Bands는 3Y 퍼센타일 기준입니다. Normal <P66, Watch P66-85, Risk >P85', 'Bands are 3Y percentiles. Normal <P66, Watch P66-85, Risk >P85')}
              updated={String(c?.LPI?.updated || '—')}
              quality={String(c?.LPI?.quality_effective || c?.LPI?.quality || 'NA')}
            />
            <MacroDetailCard
              title={pickLang(mode, '금리 (RPI)', 'Rates (RPI)')}
              titleTip={MACRO_TERM_COPY.RPI[langKey].body}
              subtitle={pickLang(mode, '금리/실질금리 부담 - Drivers: Fed Funds, 10Y, 2s10s', 'Relative pressure from policy and real rates - Drivers: Fed Funds, 10Y, 2s10s')}
              subtitleTip={driversTip}
              value={fmt(rpi)}
              statusLabel={bandFromValue(rpi)}
              refTip={bandsTip}
              refText={pickLang(mode, 'Bands는 3Y 퍼센타일 기준입니다. Normal <P66, Watch P66-85, Risk >P85', 'Bands are 3Y percentiles. Normal <P66, Watch P66-85, Risk >P85')}
              updated={String(c?.RPI?.updated || '—')}
              quality={String(c?.RPI?.quality_effective || c?.RPI?.quality || 'NA')}
            />
            <MacroDetailCard
              title={pickLang(mode, '변동성 (VRI)', 'Volatility (VRI)')}
              titleTip={MACRO_TERM_COPY.VRI[langKey].body}
              subtitle={pickLang(mode, '시장 변동성 체계 - Drivers: VIX, Put/Call', 'Regime pressure from market volatility - Drivers: VIX, Put/Call')}
              subtitleTip={driversTip}
              value={fmt(vri)}
              statusLabel={bandFromValue(vri)}
              refTip={bandsTip}
              refText={pickLang(mode, 'Bands는 3Y 퍼센타일 기준입니다. Normal <P66, Watch P66-85, Risk >P85', 'Bands are 3Y percentiles. Normal <P66, Watch P66-85, Risk >P85')}
              updated={String(c?.VRI?.updated || '—')}
              quality={String(c?.VRI?.quality_effective || c?.VRI?.quality || 'NA')}
            />
            <MacroDetailCard
              title={pickLang(mode, '신용 스프레드 (CSI)', 'Credit Spread (CSI)')}
              titleTip={MACRO_TERM_COPY.CSI[langKey].body}
              subtitle={pickLang(mode, '신용시장 스트레스 - Driver: HY OAS', 'Relative stress in credit spreads - Driver: HY OAS')}
              subtitleTip={driversTip}
              value={fmt(csi)}
              statusLabel={bandFromValue(csi)}
              refTip={bandsTip}
              refText={pickLang(mode, 'Bands는 3Y 퍼센타일 기준입니다. Normal <P66, Watch P66-85, Risk >P85', 'Bands are 3Y percentiles. Normal <P66, Watch P66-85, Risk >P85')}
              updated={String(c?.CSI?.updated || '—')}
              quality={String(c?.CSI?.quality_effective || c?.CSI?.quality || 'NA')}
            />
          </div>

        </div>
      )}

      {viewTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-[#1a1a1a] rounded-2xl p-4 border border-[#2a2a2a]">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm text-slate-200 font-semibold mb-1">
                  {pickLang(mode, '매크로 압박 추이 (MPS)', 'Macro Pressure Trend (MPS)')}
                </div>
                <div className="text-xs text-slate-400 mb-2">
                  {pickLang(mode, '선은 하나만 보여주고, 배경 색으로 구간을 읽는 구조입니다.', 'Single-line trend with zone-color background.')}
                </div>
              </div>
              <div className="text-[11px] text-slate-400 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                {pickLang(mode, '현재는 과거 고위험 구간과 구조가 동일하다고 볼 근거가 제한적입니다.', 'Current structure is not necessarily equivalent to past extreme-risk regimes.')}
              </div>
            </div>
            <div className="text-sm font-semibold mb-2 text-cyan-200">{mpsDirectionText}</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="text-[11px] text-slate-400">{pickLang(mode, '최근 30일 평균 MPS', 'Last 30D Avg MPS')}</div>
                <div className="text-sm text-slate-100 font-semibold">
                  {mps30Avg == null ? '—' : fmt(mps30Avg, 1)}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="text-[11px] text-slate-400">{pickLang(mode, '현재 구간', 'Current Zone')}</div>
                <div className="text-sm text-slate-100 font-semibold">{mpsZoneText}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="text-[11px] text-slate-400">{pickLang(mode, '과거 유사 구간', 'Similar Past Window')}</div>
                <div className="text-sm text-slate-100 font-semibold">
                  {similarPattern
                    ? `${similarPattern.date}${similarPattern.change30d == null ? '' : ` · ${pickLang(mode, '30일', '30D')} ${fmt(similarPattern.change30d, 1, '%')}`}`
                    : '—'}
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-400 mb-3">
              {pickLang(mode, '배경 기준: 0–30 안정 / 30–50 보통 / 50–70 경계 / 70+ 위험', 'Zone guide: 0–30 Calm / 30–50 Moderate / 50–70 Caution / 70+ Risk')}
            </div>
            {engineChartData.length < 2 ? (
              <div className="text-sm text-slate-400">{pickLang(mode, '히스토리 데이터가 부족합니다.', 'Not enough history data.')}</div>
            ) : (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mpsOnlyData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#263041" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis
                      domain={[0, mpsYMax]}
                      allowDataOverflow={false}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={(v: any) => {
                        const n = Number(v)
                        return Number.isFinite(n) ? n.toFixed(1) : ''
                      }}
                    />
                    <ReferenceArea y1={0} y2={Math.min(30, mpsYMax)} fill="#34d399" fillOpacity={0.08} />
                    {mpsYMax > 30 && <ReferenceArea y1={30} y2={Math.min(50, mpsYMax)} fill="#facc15" fillOpacity={0.07} />}
                    {mpsYMax > 50 && <ReferenceArea y1={50} y2={Math.min(70, mpsYMax)} fill="#fb923c" fillOpacity={0.07} />}
                    {mpsYMax > 70 && <ReferenceArea y1={70} y2={Math.min(100, mpsYMax)} fill="#fb7185" fillOpacity={0.07} />}
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#cbd5e1' }}
                      itemStyle={{ color: '#e2e8f0' }}
                    />
                    <Line type="monotone" dataKey="MPS" name="MPS" stroke="#f8fafc" strokeWidth={2.8} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowHistorySensors((v) => !v)}
                className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-slate-200 hover:bg-white/5"
              >
                {showHistorySensors
                  ? pickLang(mode, '세부 센서 숨기기', 'Hide Sensor Details')
                  : pickLang(mode, '세부 센서 보기', 'Show Sensor Details')}
              </button>
            </div>
            {showHistorySensors && engineChartData.length >= 2 && (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2 flex-wrap">
                  {(['LPI', 'RPI', 'VRI', 'CSI'] as const).map((k) => {
                    const on = historySensorKeys.includes(k)
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleHistorySensor(k)}
                        className={`px-2.5 py-1 text-[11px] rounded-md border ${
                          on ? 'border-cyan-400/40 text-cyan-200 bg-cyan-500/10' : 'border-white/10 text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {k}
                      </button>
                    )
                  })}
                  <span className="text-[11px] text-slate-500">{pickLang(mode, '최대 2개 선택', 'Max 2 selections')}</span>
                </div>
              </div>
            )}
            {showHistorySensors && engineChartData.length >= 2 && (
              <div className="mt-1 h-[180px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={engineChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#263041" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis domain={[0, detailYMax]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#cbd5e1' }}
                      itemStyle={{ color: '#e2e8f0' }}
                    />
                    <Legend wrapperStyle={{ color: '#cbd5e1', fontSize: 10 }} />
                    {historySensorKeys.includes('LPI') && <Line type="linear" dataKey="LPI" stroke="#34d399" strokeWidth={1.8} dot={false} />}
                    {historySensorKeys.includes('RPI') && <Line type="linear" dataKey="RPI" stroke="#60a5fa" strokeWidth={1.8} dot={false} />}
                    {historySensorKeys.includes('VRI') && <Line type="linear" dataKey="VRI" stroke="#f59e0b" strokeWidth={1.8} dot={false} />}
                    {historySensorKeys.includes('CSI') && <Line type="linear" dataKey="CSI" stroke="#f97316" strokeWidth={1.8} dot={false} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black p-0 overflow-hidden">
            <div className="px-4 py-2 border-b border-white/10 bg-[#07080a]">
              <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-3 text-[11px]">
                <div>
                  <div className="text-slate-400">{priceLabel}</div>
                  <div className="text-slate-100 font-semibold">{fmt((terminalLast as any).PRICE, 0)}</div>
                </div>
                <div>
                  <div className="text-slate-400">24h %</div>
                  <div className={`${(btcDelta1d ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold`}>{fmt(btcDelta1d, 2, '%')}</div>
                </div>
                <div>
                  <div className="text-slate-400">7d %</div>
                  <div className={`${(btcDelta7d ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold`}>{fmt(btcDelta7d, 2, '%')}</div>
                </div>
                <div>
                  <div className="text-slate-400">1M %</div>
                  <div className={`${(btcDelta30d ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold`}>{fmt(btcDelta30d, 2, '%')}</div>
                </div>
                <div>
                  <div className="text-slate-400">ATH</div>
                  <div className="text-slate-100 font-semibold">{fmt(btcAth || null, 0)}</div>
                </div>
                <div>
                  <div className="text-slate-400">ATH ▼ %</div>
                  <div className={`${(btcAthGap ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'} font-semibold`}>{fmt(btcAthGap, 2, '%')}</div>
                </div>
                <div>
                  <div className="text-slate-400">{m2Scope === 'US' ? pickLang(mode, '미국 M2', 'US M2') : pickLang(mode, '글로벌 M2', 'Global M2')}</div>
                  <div className="text-fuchsia-300 font-semibold">{formatM2Trillion((terminalLast as any).M2, 2)}</div>
                </div>
                <div>
                  <div className="text-slate-400">{m2Scope === 'US' ? pickLang(mode, '미국 M2 YoY', 'US M2 YoY') : pickLang(mode, '글로벌 M2 YoY', 'Global M2 YoY')}</div>
                  <div className="text-indigo-300 font-semibold">{fmt(latestM2YoY, 2, '%')}</div>
                </div>
                <div>
                  <div className="text-slate-400">VIX</div>
                  <div className="text-slate-100 font-semibold">{fmt(pickSeriesLatest(data as any, 'VIX'), 2)}</div>
                </div>
                <div>
                  <div className="text-slate-400">{pickLang(mode, '공포/탐욕(프록시)', 'Fear & Greed (Proxy)')}</div>
                  <div className="text-slate-100 font-semibold">{shockProb == null ? '—' : `${Math.round(Math.max(0, Math.min(100, 100 - shockProb)))}/100`}</div>
                </div>
              </div>
            </div>

            <div className="px-4 pt-4 pb-2 text-center">
              <div className="text-xl md:text-2xl text-slate-100 tracking-tight">
                {m2Scope === 'US'
                  ? pickLang(mode, 'US M2 공급 및 YoY 변화율', 'US M2 Supply and YoY Growth')
                  : pickLang(mode, 'Global M2 공급 및 YoY 변화율', 'Global M2 Supply and YoY Growth')}
              </div>
              <div className="mt-1 text-sm text-slate-400">
                {m2Scope === 'US'
                  ? pickLang(
                      mode,
                      '현재는 FRED M2SL(미국 M2) 기준입니다. M2는 월간 평균 데이터이며 계단형(step) 표시가 정상입니다.',
                      'Currently based on FRED M2SL (US M2). M2 is monthly-average data and step-line rendering is expected.'
                    )
                  : pickLang(
                      mode,
                      m2FallbackToUs
                        ? 'Global M2 모드지만, 현재 캐시에 글로벌 집계가 없어 US M2로 대체 표시 중입니다. (보조/Aux, 점수 미반영)'
                        : 'Global M2 모드입니다. 보조(Aux) 컨텍스트 레이어이며 엔진 점수에는 반영되지 않습니다.',
                      m2FallbackToUs
                        ? 'Global M2 mode requested, but cache currently falls back to US M2. (Aux only, no score impact)'
                        : 'Global M2 mode. This is an auxiliary context layer and is not included in engine scoring.'
                    )}
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setM2Scope('US')}
                  className={`px-2.5 py-1 rounded-md border ${m2Scope === 'US' ? 'border-cyan-400/40 text-cyan-200 bg-cyan-500/10' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}
                >
                  US M2
                </button>
                <button
                  type="button"
                  onClick={() => setM2Scope('GLOBAL')}
                  className={`px-2.5 py-1 rounded-md border ${m2Scope === 'GLOBAL' ? 'border-cyan-400/40 text-cyan-200 bg-cyan-500/10' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}
                >
                  Global M2
                </button>
                <span className="px-2 py-0.5 rounded border border-sky-400/20 text-sky-200 bg-sky-500/10">Aux</span>
                <span className="px-2 py-0.5 rounded border border-violet-400/20 text-violet-200 bg-violet-500/10">No-score</span>
                <span className="px-2 py-0.5 rounded border border-amber-400/20 text-amber-200 bg-amber-500/10">
                  {pickLang(mode, '최근 업데이트', 'Last update')}: {m2LatestDateFromChart || String(series?.M2SL?.latest?.date || series?.M2?.latest?.date || '—')}
                </span>
                <span className="px-2 py-0.5 rounded border border-white/10 text-slate-300 bg-white/5">
                  {pickLang(mode, '사용 심볼', 'Symbol')}: {m2SymbolUsed}
                </span>
                {m2Scope === 'GLOBAL' && m2FallbackToUs && (
                  <span className="px-2 py-0.5 rounded border border-rose-400/20 text-rose-200 bg-rose-500/10">
                    {pickLang(mode, 'GLOBAL 데이터 없음 → US 대체', 'GLOBAL unavailable → US fallback')}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                {(['1M', '3M', '6M', '1Y', '3Y', 'ALL'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setHistoryRange(r)}
                    className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                      historyRange === r
                        ? 'border-cyan-400/40 text-cyan-200 bg-cyan-500/10'
                        : 'border-white/10 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                {pickLang(mode, '차트 위에서 마우스 휠로 확대/축소', 'Use mouse wheel over chart to zoom in/out')}
              </div>
            </div>

            {terminalChartZoomed.length < 2 ? (
              <div className="px-4 pb-4 text-sm text-slate-400">{pickLang(mode, '히스토리 데이터가 부족합니다.', 'Not enough history data.')}</div>
            ) : (
              <div className="h-[520px] w-full px-2 pb-3" onWheel={handleTerminalWheel}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={terminalChartZoomed} margin={{ top: 12, right: 72, left: 12, bottom: 6 }}>
                    <CartesianGrid stroke="#1a1f2e" vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      ticks={xAxisTicks}
                      interval={0}
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickLine={false}
                      tickFormatter={(v: string) => {
                        const d = new Date(v)
                        if (isNaN(d.getTime())) return v
                        return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                      }}
                    />
                    <YAxis
                      yAxisId="left"
                      scale={leftAxisScale}
                      domain={leftAxisDomain as any}
                      tick={{ fill: '#e2e8f0', fontSize: 11 }}
                      tickFormatter={formatUsdLogTick}
                      width={62}
                    />
                    <YAxis
                      yAxisId="yoy"
                      domain={yoyAxisDomain}
                      orientation="right"
                      tick={{ fill: '#93c5fd', fontSize: 11 }}
                      tickFormatter={(v) => formatPct(v, 0)}
                      width={48}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="right"
                      domain={rightAxisDomain as any}
                      orientation="right"
                      tick={{ fill: '#60a5fa', fontSize: 11 }}
                      tickFormatter={formatM2Trillion}
                      width={62}
                      dx={34}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={renderTerminalTooltip as any} />
                    <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12, paddingTop: 4 }} iconType="line" />
                    {latestPrice != null && (
                      <ReferenceLine
                        yAxisId="left"
                        y={latestPrice}
                        stroke="#475569"
                        strokeDasharray="3 5"
                        label={{ value: compactTick(latestPrice), fill: '#f8fafc', position: 'insideTopLeft', fontSize: 11 }}
                      />
                    )}
                    {latestM2 != null && (
                      <ReferenceLine
                        yAxisId="right"
                        y={latestM2}
                        stroke="#9d174d"
                        strokeDasharray="3 5"
                        label={{ value: formatM2Trillion(latestM2, 3), fill: '#f9a8d4', position: 'insideTopRight', fontSize: 11 }}
                      />
                    )}
                    {latestM2YoY != null && (
                      <ReferenceLine
                        yAxisId="yoy"
                        y={latestM2YoY}
                        stroke="#2563eb"
                        strokeDasharray="3 5"
                        label={{ value: formatPct(latestM2YoY, 2), fill: '#93c5fd', position: 'insideBottomLeft', fontSize: 10 }}
                      />
                    )}
                    <ReferenceLine yAxisId="yoy" y={0} stroke="#334155" strokeDasharray="3 3" />
                    <Bar yAxisId="yoy" dataKey="M2YoY" name="M2 Growth (%)" barSize={6}>
                      {terminalChartZoomed.map((entry: any, idx: number) => (
                        <Cell key={`main-yoy-${idx}`} fill={Number(entry?.M2YoY) >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.82} />
                      ))}
                    </Bar>
                    <Line yAxisId="right" type="stepAfter" dataKey="M2Raw" name={m2LineLabel} stroke="#3b82f6" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} />
                    <Line yAxisId="left" type="linear" dataKey="PRICE" name={priceLineLabel} stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="bg-[#1a1a1a] rounded-2xl p-4 border border-[#2a2a2a]">
            <div className="text-sm text-slate-200 font-semibold mb-3">
              {pickLang(
                mode,
                `스냅샷 이력 (최근 ${HISTORY_TABLE_ROWS}건, 차트는 최대 3년)`,
                `Snapshot History (Latest ${HISTORY_TABLE_ROWS}, chart up to 3Y)`
              )}
            </div>
            {historyDesc.length === 0 ? (
              <div className="text-sm text-slate-400">{pickLang(mode, '사용 가능한 스냅샷이 없습니다.', 'No snapshots available.')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-400">
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 pr-3">Date</th>
                      <th className="text-left py-2 pr-3">Validation</th>
                      <th className="text-left py-2 pr-3">Quality</th>
                      <th className="text-left py-2 pr-3">MPS</th>
                      <th className="text-left py-2 pr-3">LPI/RPI/VRI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyDesc.slice(0, HISTORY_TABLE_ROWS).map((row, idx) => (
                      <tr key={`${row.snapshot_date}-${idx}`} className="border-b border-white/5">
                        <td className="py-2 pr-3 text-slate-100">{row.snapshot_date}</td>
                        <td className="py-2 pr-3 text-slate-300">{row.validation_status}</td>
                        <td className="py-2 pr-3 text-slate-300">{row.quality_overall || 'NA'}</td>
                        <td className="py-2 pr-3 text-slate-100">{fmt(row.mps)}</td>
                        <td className="py-2 pr-3 text-slate-300">{fmt(row.lpi)} / {fmt(row.rpi)} / {fmt(row.vri)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-[#1a1a1a] rounded-2xl p-4 border border-[#2a2a2a]">
            <div className="text-sm text-slate-200 font-semibold mb-3">Revisions</div>
            {revisions.length === 0 ? (
              <div className="text-sm text-slate-400">No revisions logged.</div>
            ) : (
              <div className="space-y-2">
                {revisions.map((r, idx) => (
                  <div key={`${r.detected_at}-${r.series_id}-${idx}`} className="p-2 rounded border border-white/10 bg-white/[0.02]">
                    <div className="text-xs text-slate-200">{r.detected_at}</div>
                    <div className="text-xs text-slate-100 mt-1">{r.series_id}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{r.change_summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {viewTab === 'debug' && (
        <div className="space-y-4">
          <div className="bg-[#1a1a1a] rounded-2xl p-4 border border-[#2a2a2a]">
            <div className="text-sm text-slate-200 font-semibold mb-3">
              {pickLang(mode, '데이터 품질 상세(Debug)', 'Data Quality Detail (Debug)')}
            </div>
            <div className="text-xs text-slate-400 mb-3">
              {pickLang(mode, 'freshness / coverage / source를 여기서 점검합니다.', 'Inspect freshness / coverage / source here.')}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400">
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 pr-3">Series</th>
                    <th className="text-left py-2 pr-3">Source</th>
                    <th className="text-left py-2 pr-3">Quality</th>
                    <th className="text-left py-2 pr-3">Age(min)</th>
                    <th className="text-left py-2 pr-3">Stale</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(health).map(([k, v]: any) => (
                    <tr key={k} className="border-b border-white/5">
                      <td className="py-2 pr-3 text-slate-100">{k}</td>
                      <td className="py-2 pr-3 text-slate-300">{String(v?.source || series?.[k]?.source || '—')}</td>
                      <td className="py-2 pr-3 text-slate-300">{String(v?.quality_effective || v?.base_quality || '—')}</td>
                      <td className="py-2 pr-3 text-slate-300">{typeof v?.age_minutes === 'number' ? v.age_minutes.toFixed(1) : '—'}</td>
                      <td className="py-2 pr-3 text-slate-300">{v?.stale ? 'Y' : 'N'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
