'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { readStoredContentLang, persistContentLang, type UiLang } from '@/lib/uiLang'
import ContentLangToggle from '@/components/ContentLangToggle'
import {
  ResponsiveContainer,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts'

import NarrativeBlocks, {
  mapPortfolioNarrative,
  type StructuredNarrative,
} from '@/components/narrative/NarrativeBlocks'

type HoldingPosition = {
  symbol?: string
  date?: string
  total?: number | null
  in?: number | null
  pl?: number | null
  pl_pct?: number | null
  delta?: number | null
  yesterday_close?: number | null
  today_close?: number | null
  change_pct?: number | null
  pnl_today?: number | null
  avg_cost?: number | null
  equity?: number | null
  cost_basis?: number | null
  buy_total?: number | null
  rsi?: number | null
  position_pct?: number | null
  shares?: number | null
  cum_return_pct?: number | null
  cum_pnl_usd?: number | null
  mdd_pct?: number | null
  volume_k?: number | null
  high_52w?: number | null
  low_52w?: number | null
  ma5?: number | null
  ma120?: number | null
  ma200?: number | null
  note?: string
}

type HoldingsSummary = {
  total_equity?: number | null
  total_value?: number | null
  total_cost?: number | null
  total_invested?: number | null
  total_pnl?: number | null
  total_pnl_pct?: number | null
  today_pnl?: number | null
  today_pnl_pct?: number | null
  mdd_portfolio_pct?: number | null
  cash?: number | null
  cash_ratio_pct?: number | null
  position_count?: number | null
  as_of_date?: string | null
}

type HoldingsPayload = {
  data_version?: string
  generated_at?: string
  status?: string
  as_of_date?: string | null
  summary?: HoldingsSummary
  snapshot_summary?: {
    raw?: Array<{ label?: string; value?: string }>
    normalized?: Record<string, number | string | null | undefined>
    range?: string
  } | null
  positions: HoldingPosition[]
  positions_by_tab?: Record<string, Array<Record<string, any>>>
  positions_columns_by_tab?: Record<string, string[]>
  selected_tabs?: string[]
  errors?: Array<{ type?: string; line?: number; symbol?: string; message?: string; column?: string }>
  rerun_hint?: string
  error?: string
}

type TabMeta = { title: string; name?: string; kind?: string; excluded?: boolean }
type SheetTabsPayload = {
  sheet_id?: string
  tabs?: TabMeta[]
  selectable?: string[]
  excluded_default?: string[]
  generated_at?: string
  rerun_hint?: string
  source?: string
  error?: string
}

type HoldingsTsPayload = {
  data_version?: string
  status?: string
  active_tabs?: string[]
  tabs?: Array<{
    name?: string
    type?: string
    positions?: Array<Record<string, any>>
    positions_columns?: string[]
    history?: HoldingPosition[]
    snapshot_summary?: any
  }>
  goal?: {
    positions?: Array<Record<string, any>>
    positions_columns?: string[]
    history?: HoldingPosition[]
    snapshot_summary?: any
  }
  rerun_hint?: string
  summary?: { point_count?: number; date_min?: string | null; date_max?: string | null }
  generated_at?: string
  sheet_id?: string
}

type MarketIndicesPayload = {
  timestamp?: string
  indices?: Record<string, { name?: string; price?: number; change_pct?: number }>
  volatility?: Record<string, { name?: string; price?: number; change_pct?: number }>
  bonds?: Record<string, { name?: string; price?: number; change_pct?: number }>
  currencies?: Record<string, { name?: string; price?: number; change_pct?: number }>
  commodities?: Record<string, { name?: string; price?: number; change_pct?: number }>
  error?: string
}

type PortfolioNarrativeMeta = {
  cached?: boolean
  cache_mode?: string
  cache_date?: string
  analysis_date?: string
  generated_at?: string
  saved_at?: string
  cache_tab?: string
  cache_version?: string
  cache_scope?: string
  cache_namespace?: string
}

const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? '/api/flask'  // Vercel: proxy via next.config.js rewrites → Railway
  : (process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001')
const PORTFOLIO_NARRATIVE_VERSION = 'news_first_v3'

function panelStyle() {
  return {
    background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '0.92rem',
  } as const
}

function fmtNum(v?: number | null, digits = 2) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function fmtMoney(v?: number | null) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}

function fmtPct(v?: number | null) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  const text = `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  return text
}

function fmtDateOnly(value?: string | null) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length >= 10) return text.slice(0, 10)
  return text
}

function cleanMessage(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (/httperror\s*403/i.test(text) || /does not have permission/i.test(text)) {
    return 'No permission: Check Google Sheet sharing permissions (service account email needs read access).'
  }
  let t = text.replace(/\s+/g, ' ')
  if (/FutureWarning/i.test(t)) {
    const failIdx = t.indexOf('[FAIL]')
    const httpIdx = t.search(/HttpError/i)
    const cutIdx = failIdx >= 0 ? failIdx : httpIdx
    if (cutIdx >= 0) t = t.slice(cutIdx).trim()
    t = t.replace(/FutureWarning.*?(?=\[FAIL\]|HttpError|$)/i, '').trim()
  }
  if (t.length > 180) t = `${t.slice(0, 180)}...`
  return t
}

function asText(value: any): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const ko = value?.ko
    const en = value?.en
    if (typeof ko === 'string') return ko
    if (typeof en === 'string') return en
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseLooseNumber(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return null
  let t = v.trim()
  if (!t) return null
  t = t.replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '')
  if (t.startsWith('(') && t.endsWith(')')) t = `-${t.slice(1, -1)}`
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function getFirstString(row: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const val = row?.[k]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return ''
}

function getFirstNumber(row: Record<string, any>, keys: string[]): number | null {
  for (const k of keys) {
    const val = parseLooseNumber(row?.[k])
    if (val !== null) return val
  }
  return null
}

const DONUT_COLORS = ['#22c55e', '#60a5fa', '#f59e0b', '#ef4444', '#14b8a6', '#a78bfa', '#eab308', '#f43f5e', '#38bdf8', '#4ade80']
const DONUT_MAX_SLICES = 10

function renderPieLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent, name } = props
  const labelName = asText(name)
  if (!labelName) return null
  const RADIAN = Math.PI / 180
  const distance = outerRadius + 18
  const x = cx + distance * Math.cos(-midAngle * RADIAN)
  const y = cy + distance * Math.sin(-midAngle * RADIAN)
  const textAnchor = x > cx ? 'start' : 'end'
  const pct = typeof percent === 'number' ? ` ${Math.round(percent * 1000) / 10}%` : ''
  return (
    <text x={x} y={y} fill="#cbd5e1" textAnchor={textAnchor} dominantBaseline="central" fontSize={11}>
      {labelName}
      {pct}
    </text>
  )
}

function extractSheetId(input: string): string | null {
  const raw = (input || '').trim()
  if (!raw) return null
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (match && match[1]) return match[1]
  if (/^[a-zA-Z0-9-_]+$/.test(raw)) return raw
  return null
}

function defaultSelectedTabs(meta?: SheetTabsPayload): string[] {
  if (!meta?.tabs) return ['Goal']
  const available = meta.tabs.filter((t) => !t.excluded)
  const result = available.map((t) => asText(t.title || t.name || '')).filter(Boolean)
  return result.length ? Array.from(new Set(result)) : ['Goal']
}

function deriveColumnsFromRows(rows: Array<Record<string, any>>): string[] {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns
}

function isKoreanTabName(tabName: string): boolean {
  return /한국/.test(tabName || '')
}

function renderSheetCellValue(value: any, column: string) {
  const text = asText(value).trim()
  if (!text) return <span style={{ color: '#6b7280' }}>-</span>
  if (text === '-') return <span style={{ color: '#6b7280' }}>-</span>

  const isUp = /^[▲△+]/.test(text)
  const isDown = /^[▼▽-]/.test(text)
  const color = isUp ? '#22c55e' : isDown ? '#ef4444' : '#d1d5db'

  if (column === '순서') {
    return <span style={{ color: '#f3f4f6', fontWeight: 700 }}>{text}</span>
  }

  return <span style={{ color }}>{text}</span>
}

function normalizeTabColumns(tabName: string, rawColumns: string[]): string[] {
  const isKorean = isKoreanTabName(tabName)
  const filtered: string[] = []
  const seen = new Set<string>()

  for (const raw of rawColumns || []) {
    const col = asText(raw)
    if (!col) continue

    if (!isKorean && (col === 'Sparkline' || col === '__sparkline' || col === '10 일선' || col === '50 일선')) {
      continue
    }

    const normalized = !isKorean && col === 'col_1' ? '순서' : col
    if (seen.has(normalized)) continue
    seen.add(normalized)
    filtered.push(normalized)
  }

  if (isKorean) return filtered

  if (!filtered.includes('순서')) {
    filtered.unshift('순서')
  }

  const orderIdx = filtered.indexOf('순서')
  if (orderIdx > 0) {
    filtered.splice(orderIdx, 1)
    filtered.unshift('순서')
  }

  const symbolIdx = filtered.indexOf('종목')
  if (symbolIdx > 1) {
    filtered.splice(symbolIdx, 1)
    filtered.splice(1, 0, '종목')
  } else if (symbolIdx === 0 && filtered.length > 1) {
    const [symbol] = filtered.splice(0, 1)
    filtered.splice(1, 0, symbol)
  }

  return filtered
}

import { ComposedChart } from 'recharts';

function AccountHistoryChart({ history }: { history: HoldingPosition[] }) {
  const [yLMin, setYLMin] = useState('')
  const [yLMax, setYLMax] = useState('')
  const [yRMin, setYRMin] = useState('')
  const [yRMax, setYRMax] = useState('')
  const [xFrom, setXFrom] = useState('')
  const [xTo, setXTo] = useState('')

  if (!history || history.length < 2) {
    return <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No history data.</div>
  }

  const filtered = history.filter((p) => {
    if (xFrom && p.date && p.date < xFrom) return false
    if (xTo && p.date && p.date > xTo) return false
    return true
  })

  const toNum = (v: string) => (v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined)
  const leftDomain: [number | 'auto', number | 'auto'] = [toNum(yLMin) ?? 'auto', toNum(yLMax) ?? 'auto']
  const rightDomain: [number | 'auto', number | 'auto'] = [toNum(yRMin) ?? 'auto', toNum(yRMax) ?? 'auto']

  const inputStyle = {
    width: 72,
    padding: '0.18rem 0.3rem',
    background: 'rgba(17,24,39,0.8)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#e5e7eb',
    borderRadius: 5,
    fontSize: '0.68rem',
  } as const

  const labelStyle = { color: '#6b7280', fontSize: '0.68rem', whiteSpace: 'nowrap' } as const

  const reset = () => { setYLMin(''); setYLMax(''); setYRMin(''); setYRMax(''); setXFrom(''); setXTo('') }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, padding: '0.4rem 0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
        <span style={{ color: '#9ca3af', fontSize: '0.7rem', fontWeight: 600 }}>Scale</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={labelStyle}>Year Min</span>
          <input style={inputStyle} value={yLMin} onChange={(e) => setYLMin(e.target.value)} placeholder="auto" />
          <span style={labelStyle}>Max</span>
          <input style={inputStyle} value={yLMax} onChange={(e) => setYLMax(e.target.value)} placeholder="auto" />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={labelStyle}>YvMin</span>
          <input style={inputStyle} value={yRMin} onChange={(e) => setYRMin(e.target.value)} placeholder="auto" />
          <span style={labelStyle}>Max</span>
          <input style={inputStyle} value={yRMax} onChange={(e) => setYRMax(e.target.value)} placeholder="auto" />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={labelStyle}>X From</span>
          <input style={{ ...inputStyle, width: 90 }} value={xFrom} onChange={(e) => setXFrom(e.target.value)} placeholder="2025-01-01" />
          <span style={labelStyle}>To</span>
          <input style={{ ...inputStyle, width: 90 }} value={xTo} onChange={(e) => setXTo(e.target.value)} placeholder="2026-12-31" />
        </div>
        <button onClick={reset} style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#9ca3af', borderRadius: 5, padding: '0.18rem 0.4rem', fontSize: '0.68rem', cursor: 'pointer' }}>
          Reset
        </button>
        <span style={{ color: '#6b7280', fontSize: '0.66rem', marginLeft: 4 }}>{filtered.length} / {history.length} pts</span>
      </div>
      <div style={{ width: '100%', height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={filtered} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis yAxisId="left" domain={leftDomain} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" domain={rightDomain} tick={{ fill: '#f59e0b', fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: 'rgba(17,24,39,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: '0.8rem' }} />
            <Legend />
            <Bar yAxisId="left" dataKey="delta" fill="#93c5fd" opacity={0.4} name="Delta" />
            <Line yAxisId="left" type="monotone" dataKey="total" stroke="#f8fafc" strokeWidth={2} dot={false} name="총액 (Total)" />
            <Line yAxisId="left" type="monotone" dataKey="in" stroke="#ef4444" strokeWidth={2} dot={false} name="투자금 (In)" />
            <Line yAxisId="left" type="monotone" dataKey="pl" stroke="#f59e0b" strokeWidth={2} dot={false} name="수익금 (PnL)" />
            <Line yAxisId="right" type="monotone" dataKey="pl_pct" stroke="#34d399" strokeWidth={2} dot={false} name="수익률 % (PnL%)" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function MyPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [contentLang, setContentLang] = useState<UiLang>('ko')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [tsLoading, setTsLoading] = useState(true)
  const [tabsLoading, setTabsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [data, setData] = useState<HoldingsPayload>({ positions: [] })
  const [tabsMeta, setTabsMeta] = useState<SheetTabsPayload | null>(null)
  const [tsData, setTsData] = useState<HoldingsTsPayload | null>(null)
  const [sheetUrl, setSheetUrl] = useState<string>(() => {
    try { return localStorage.getItem('holdings_sheet_url') || '' } catch { return '' }
  })
  const [saEmail, setSaEmail] = useState<string | null>(null)
  const [selectedTabs, setSelectedTabs] = useState<string[]>([])
  const [activePositionsTab, setActivePositionsTab] = useState<string>('')
  const [credsStatus, setCredsStatus] = useState<{ configured: boolean; source: string } | null>(null)
  const [saJsonInput, setSaJsonInput] = useState('')
  const [credsLoading, setCredsLoading] = useState(false)
  const [credsOpen, setCredsOpen] = useState(false)
  const [credsMessage, setCredsMessage] = useState('')
  const [portfolioNarrative, setPortfolioNarrative] = useState<StructuredNarrative | null>(null)
  const [portfolioNarrativeMeta, setPortfolioNarrativeMeta] = useState<PortfolioNarrativeMeta | null>(null)
  const [portfolioNarrativeLoading, setPortfolioNarrativeLoading] = useState(false)
  const portfolioNarrativeAbortRef = useRef<AbortController | null>(null)
  const portfolioNarrativeLoadedSignatureRef = useRef<string>('')
  const [marketIndices, setMarketIndices] = useState<MarketIndicesPayload | null>(null)

  async function fetchHoldings() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setData({
          data_version: json.data_version,
          generated_at: json.generated_at,
          status: json.status,
          as_of_date: json.as_of_date,
          summary: json.summary,
          positions: Array.isArray(json.positions) ? json.positions : [],
          positions_by_tab: json.positions_by_tab || {},
          positions_columns_by_tab: json.positions_columns_by_tab || {},
          selected_tabs: json.selected_tabs || [],
          errors: Array.isArray(json.errors) ? json.errors : [],
          rerun_hint: json.rerun_hint,
        })
      } else {
        setData({
          positions: [],
          status: 'error',
          error: json?.error || 'Failed to load holdings.',
          positions_by_tab: json?.positions_by_tab || {},
          positions_columns_by_tab: json?.positions_columns_by_tab || {},
          selected_tabs: json?.selected_tabs || [],
          errors: Array.isArray(json?.errors) ? json.errors : [],
          rerun_hint: json?.rerun_hint,
        })
      }
    } catch {
      setData({ positions: [], status: 'error', error: 'Failed to load holdings (network).' })
    } finally {
      setLoading(false)
    }
  }

  async function refreshTabs(preserveSelection = false) {
    setTabsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings/tabs`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setTabsMeta(json)
        setSelectedTabs((prev) => {
          if (preserveSelection && prev.length > 0) return prev
          return defaultSelectedTabs(json)
        })
        if (!sheetUrl && json.sheet_id) setSheetUrl(json.sheet_id)
        if (json?.error) setMessage(cleanMessage(json.error))
      } else if (json?.error) {
        setMessage(cleanMessage(json.error))
      }
    } catch {
      setMessage('Failed to load tabs (backend not running).')
    } finally {
      setTabsLoading(false)
    }
  }

  async function refreshTs() {
    setTsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings/ts`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setTsData(json)
        if (!sheetUrl && json.sheet_id) setSheetUrl(json.sheet_id)
      }
    } finally {
      setTsLoading(false)
    }
  }

  async function fetchCredsStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings/credentials`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setCredsStatus(json)
    } catch {}
  }

  async function fetchMarketIndices() {
    try {
      const res = await fetch(`${API_BASE}/api/market/indices`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setMarketIndices(json)
    } catch {}
  }

  const FALLBACK_SA_EMAIL = '서비스 계정 JSON을 설정해주세요 (우측 상단 관리 버튼)'

  async function fetchSaEmail() {
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings/sa-email`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      setSaEmail(json.email || FALLBACK_SA_EMAIL)
    } catch {
      setSaEmail(FALLBACK_SA_EMAIL)
    }
  }

  async function saveCreds() {
    if (!saJsonInput.trim()) return
    setCredsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_account_json: saJsonInput.trim() }),
      })
      let json: Record<string, unknown> = {}
      let rawBody = ''
      try {
        rawBody = await res.text()
        json = JSON.parse(rawBody)
      } catch { /* non-json body */ }
      if (res.ok) {
        setCredsMessage('저장 완료. (재배포 시 초기화됩니다 — Railway Variables에 GOOGLE_SERVICE_ACCOUNT_JSON 설정 권장)')
        setSaJsonInput('')
        setCredsOpen(false)
        await fetchCredsStatus()
        await fetchSaEmail()
      } else {
        const errMsg = (json?.error as string) || rawBody.slice(0, 120) || 'Failed to save credentials.'
        setCredsMessage(`[${res.status}] ${errMsg}`)
      }
    } catch (err) {
      setCredsMessage(`네트워크 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCredsLoading(false)
    }
  }

  async function clearCreds() {
    setCredsLoading(true)
    try {
      await fetch(`${API_BASE}/api/my/holdings/credentials`, { method: 'DELETE' })
      setMessage('Credentials removed.')
      await fetchCredsStatus()
    } finally {
      setCredsLoading(false)
    }
  }

  async function handleLoadTabs() {
    const sheetId = extractSheetId(sheetUrl)
    if (!sheetId) {
      setMessage('Invalid Google Sheets link or ID.')
      return
    }
    setTabsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings/list-tabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_id: sheetId }),
      })
      const json = await res.json().catch(() => ({}))
      const tmeta = json.tabs || {}
      if (!res.ok) {
        setMessage(cleanMessage(json?.error || tmeta?.error || json?.stderr || 'Failed to load tabs.'))
        return
      }
      setTabsMeta(tmeta)
      setSelectedTabs(defaultSelectedTabs(tmeta))
      setSheetUrl(sheetId)
      setMessage(cleanMessage(tmeta?.error || 'Tabs loaded.'))
    } catch {
      setMessage('Failed to load tabs (network).')
    } finally {
      setTabsLoading(false)
    }
  }

  async function handleImportTabs() {
    const sheetId = extractSheetId(sheetUrl)
    if (!sheetId) {
      setMessage('Invalid Google Sheets link or ID.')
      return
    }
    const tabsCsv = selectedTabs.join(',')
    if (!tabsCsv) {
      setMessage('Select at least one tab to import.')
      return
    }
    setTabsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/my/holdings/import-tabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_id: sheetId, tabs: tabsCsv }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(cleanMessage(json?.error || json?.stderr_import || 'Import tabs failed.'))
        return
      }
      setSheetUrl(sheetId)
      setMessage(cleanMessage(`Imported tabs: ${tabsCsv}`))
      await refreshTabs(true)
      await refreshTs()
    } catch {
      setMessage('Import failed (network).')
    } finally {
      setTabsLoading(false)
    }
  }

  // localStorage에 sheetUrl 저장
  useEffect(() => {
    if (sheetUrl) try { localStorage.setItem('holdings_sheet_url', sheetUrl) } catch {}
  }, [sheetUrl])

  useEffect(() => {
    fetchHoldings()
    fetchSaEmail()
    fetchMarketIndices()
    refreshTabs().then(() => {
      // localStorage에 저장된 URL이 있고 탭 메타가 없으면 자동 로드
      const saved = (() => { try { return localStorage.getItem('holdings_sheet_url') || '' } catch { return '' } })()
      if (saved && !tabsMeta) handleLoadTabs()
    })
    refreshTs()
    fetchCredsStatus()
  }, [])

  async function onChooseFile(file: File | null) {
    if (!file) return
    setImporting(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API_BASE}/api/my/import-csv`, { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(json?.error || 'Import failed.')
        return
      }
      setMessage(
        `Imported ${json?.positions ?? 0} positions` +
          (json?.enriched === false ? ' (enrichment failed, check rerun_hint)' : ''),
      )
      await fetchHoldings()
    } catch {
      setMessage('Import failed (network).')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const positionsByTab = data.positions_by_tab || {}
  const positionTabs = Object.keys(positionsByTab)
  useEffect(() => {
    if (positionTabs.length && (!activePositionsTab || !positionsByTab[activePositionsTab])) {
      setActivePositionsTab(positionTabs[0])
    }
  }, [positionTabs.join('|'), activePositionsTab])

  const tsActiveHistory = useMemo(() => {
    const activeTabObj = tsData?.tabs?.find((t) => t.name === activePositionsTab)
    if (activeTabObj?.history && activeTabObj.history.length > 0) {
      return activeTabObj.history
    }
    if (activePositionsTab === 'Goal') {
      return tsData?.goal?.history || []
    }
    return []
  }, [tsData, activePositionsTab])

  const tsRerun = tsData?.rerun_hint

  const activePositionsRows = positionsByTab[activePositionsTab] || []
  const activePositionsColumns = useMemo(() => {
    const raw =
      data.positions_columns_by_tab?.[activePositionsTab] || deriveColumnsFromRows(activePositionsRows)
    return (raw || []).map((c) => asText(c)).filter((c) => c)
  }, [data.positions_columns_by_tab, activePositionsTab, activePositionsRows])

  const positionsColumnsView = useMemo(() => {
    return normalizeTabColumns(activePositionsTab, activePositionsColumns)
  }, [activePositionsColumns, activePositionsTab])

  const activeTabSnapshotEntry = useMemo(() => {
    const tabEntry = tsData?.tabs?.find((t) => t.name === activePositionsTab)
    if (tabEntry?.snapshot_summary) return tabEntry.snapshot_summary
    if (activePositionsTab === 'Goal') return tsData?.goal?.snapshot_summary || null
    return null
  }, [tsData, activePositionsTab])

  const activeTabSnapshotNormalized = (
    activeTabSnapshotEntry && typeof activeTabSnapshotEntry === 'object' ? activeTabSnapshotEntry.normalized : null
  ) as Record<string, number | string | null | undefined> | null

  const activeTabSnapshotRawRows = (
    activeTabSnapshotEntry && typeof activeTabSnapshotEntry === 'object' && Array.isArray(activeTabSnapshotEntry.raw)
      ? activeTabSnapshotEntry.raw
      : []
  ) as Array<{ label?: string; value?: string }>

  const activeTabSnapshotNum = (key: string): number | null => {
    if (!activeTabSnapshotNormalized) return null
    const v = activeTabSnapshotNormalized[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = Number(String(v).replace(/[,%$,\s]/g, ''))
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  const activeTabAsOfDate = asText(tsActiveHistory[tsActiveHistory.length - 1]?.date || data.as_of_date) || data.as_of_date || null

  const activeTabTotalEquity =
    activeTabSnapshotNum('account_total') ??
    activeTabSnapshotNum('total_equity') ??
    activeTabSnapshotNum('total_value') ??
    activePositionsRows.reduce((sum, row) => sum + (typeof row.equity === 'number' ? row.equity : 0), 0)

  const activeTabTotalCost =
    activeTabSnapshotNum('buy_total') ??
    activeTabSnapshotNum('total_invested') ??
    activeTabSnapshotNum('total_cost') ??
    activePositionsRows.reduce(
      (sum, row) => sum + (typeof row.buy_total === 'number' ? row.buy_total : typeof row.cost_basis === 'number' ? row.cost_basis : 0),
      0,
    )

  const activeTabTotalPnl =
    activeTabSnapshotNum('total_pnl') ??
    activeTabSnapshotNum('cum_pnl_usd') ??
    activeTabSnapshotNum('today_pnl') ??
    activePositionsRows.reduce(
      (sum, row) => sum + (typeof row.cum_pnl_usd === 'number' ? row.cum_pnl_usd : typeof row.pnl_today === 'number' ? row.pnl_today : 0),
      0,
    )

  const activeTabReturnPct =
    activeTabSnapshotNum('total_pnl_pct') ??
    activeTabSnapshotNum('account_return_pct') ??
    (typeof activeTabTotalCost === 'number' && activeTabTotalCost !== 0 ? (activeTabTotalPnl / activeTabTotalCost) * 100 : null)

  const activeTabCash = activeTabSnapshotNum('cash') ?? activeTabSnapshotNum('cash_balance')
  const activeTabCashRatioPct =
    typeof activeTabCash === 'number' && typeof activeTabTotalEquity === 'number' && activeTabTotalEquity > 0
      ? (activeTabCash / activeTabTotalEquity) * 100
      : null

  const activeTabTodayPnlValue =
    activeTabSnapshotNum('today_pnl') ??
    activeTabSnapshotNum('day_pnl') ??
    activePositionsRows.reduce((sum, row) => sum + (typeof row.pnl_today === 'number' ? row.pnl_today : 0), 0)

  const activeTabTodayPnlPct =
    activeTabSnapshotNum('today_pnl_pct') ??
    activeTabSnapshotNum('daily_pnl_pct') ??
    activeTabSnapshotNum('day_pnl_pct') ??
    (typeof activeTabTodayPnlValue === 'number' &&
    typeof activeTabTotalEquity === 'number' &&
    activeTabTotalEquity - activeTabTodayPnlValue > 0
      ? (activeTabTodayPnlValue / (activeTabTotalEquity - activeTabTodayPnlValue)) * 100
      : null)

  const activeTabPnlTone = typeof activeTabReturnPct === 'number' ? (activeTabReturnPct >= 0 ? 'plus' : 'minus') : 'na'
  const isLeverageSymbol = (symbol: string) => /TQQQ|SOXL|SPXL|TECL|FNGU|UPRO|UDOW|TNA|LABU|UYG/i.test(symbol)

  const selectableTabs = useMemo(() => {
    const tabs = (tabsMeta?.tabs || []).filter((t) => !t.excluded)
    const names = tabs.map((t) => asText(t.title || t.name || '')).filter((n) => n)
    return Array.from(new Set(names))
  }, [tabsMeta])
  const allTabsSelected = selectableTabs.length > 0 && selectableTabs.every((t) => selectedTabs.includes(t))
  const toggleAllTabs = () => {
    setSelectedTabs(allTabsSelected ? [] : selectableTabs)
  }

  const positionBars = useMemo(() => {
    const symbolKeys = ['symbol', 'Symbol', '\uC885\uBAA9', '\uD2F0\uCEE4', 'Ticker']
    const valuationKeys = ['\uD3C9\uAC00\uC561', 'equity', 'Equity', 'market_value', 'value', '\uC2DC\uC7A5\uAC00\uCE58', '\uD3C9\uAC00\uAE08\uC561']
    const buyAmountKeys = ['\uB9E4\uC218\uC561', '\uB9E4\uC218\uCD1D\uC561', 'buy_total', 'buy_amount', 'cost_basis', '\uD22C\uC785\uC561']

    const rows = activePositionsRows

    const data = rows
      .map((row) => {
        const symbol = getFirstString(row, symbolKeys)
        const valuation = getFirstNumber(row, valuationKeys)
        const buyAmount = getFirstNumber(row, buyAmountKeys)
        if (!symbol || (valuation === null && buyAmount === null)) return null
        return {
          symbol,
          valuation: valuation ?? 0,
          buyAmount: buyAmount ?? 0,
        }
      })
      .filter((r): r is { symbol: string; valuation: number; buyAmount: number } => !!r)

    return data.sort((a, b) => (b.valuation || 0) - (a.valuation || 0)).slice(0, 12)
  }, [activePositionsRows])

  const donutRows = useMemo(() => {
    const symbolKeys = ['symbol', 'Symbol', '\uC885\uBAA9', '\uD2F0\uCEE4', 'Ticker']
    const pctKeys = ['position_pct', 'Position %', '\uD3EC\uC9C0\uC158(%)', '\uBE44\uC911', '\uBE44\uC911(%)']
    const equityKeys = ['equity', 'Equity', '\uD3C9\uAC00\uC561', '\uC2DC\uC7A5\uAC00\uCE58', 'value', 'market_value']

    const entries = activePositionsRows
      .map((row) => {
        const symbol = getFirstString(row, symbolKeys)
        const pct = getFirstNumber(row, pctKeys)
        const equity = getFirstNumber(row, equityKeys)
        return { symbol, pct, equity }
      })
      .filter((r) => r.symbol)

    if (entries.length === 0) return []

    const hasPct = entries.some((e) => typeof e.pct === 'number' && e.pct > 0)
    let rows: Array<{ symbol: string; pct: number }>
    if (hasPct) {
      rows = entries
        .map((e) => ({ symbol: e.symbol, pct: Math.max(0, e.pct || 0) }))
        .filter((x) => x.pct > 0)
    } else {
      const total = typeof activeTabTotalEquity === 'number' && activeTabTotalEquity > 0
        ? activeTabTotalEquity
        : entries.reduce((sum, e) => sum + (e.equity || 0), 0)
      rows = entries
        .map((e) => ({
          symbol: e.symbol,
          pct: total > 0 && e.equity ? (e.equity / total) * 100 : 0,
        }))
        .filter((x) => x.pct > 0)
    }

    rows.sort((a, b) => b.pct - a.pct)
    if (rows.length <= DONUT_MAX_SLICES) return rows
    const head = rows.slice(0, DONUT_MAX_SLICES - 1)
    const rest = rows.slice(DONUT_MAX_SLICES - 1)
    const restPct = rest.reduce((sum, r) => sum + r.pct, 0)
    if (restPct > 0) head.push({ symbol: 'Others', pct: restPct })
    return head
  }, [activePositionsRows, activeTabTotalEquity])

  const topWeight = donutRows[0]
  const snapshotNormalized = activeTabSnapshotNormalized
  const snapshotRawRows = activeTabSnapshotRawRows
  const snapshotNum = activeTabSnapshotNum
  const top3WeightPct = donutRows.slice(0, 3).reduce((sum, r) => sum + (Number.isFinite(r.pct) ? r.pct : 0), 0)
  const cashRatioPct = activeTabCashRatioPct
  const cashRatioText = cashRatioPct != null ? `${cashRatioPct.toFixed(1)}%` : '-'
  const concentrationTone = top3WeightPct >= 65 ? 'high' : top3WeightPct >= 45 ? 'mid' : 'low'
  const diversificationText =
    concentrationTone === 'high'
      ? '상위 종목 집중도가 높아 개별 종목 변동 영향이 큽니다.'
      : concentrationTone === 'mid'
        ? '집중도는 중간 수준이며 상위 종목 흐름이 성과를 좌우합니다.'
        : '비중이 비교적 분산되어 개별 종목 충격 완화에 유리합니다.'
  const pnlTone = activeTabPnlTone
  const todayPnlValue = activeTabTodayPnlValue
  const todayPnlPct = activeTabTodayPnlPct
  const activeSymbolCount = Array.isArray(activePositionsRows)
    ? activePositionsRows.filter((r) => !!asText(r.symbol)).length
    : 0
  const activeTabSummary = useMemo(
    () => ({
      total_equity: activeTabTotalEquity,
      total_cost: activeTabTotalCost,
      total_pnl: activeTabTotalPnl,
      total_pnl_pct: activeTabReturnPct,
      today_pnl: activeTabTodayPnlValue,
      today_pnl_pct: activeTabTodayPnlPct,
      cash: activeTabCash,
      cash_ratio_pct: activeTabCashRatioPct,
      position_count: activeSymbolCount,
      as_of_date: activeTabAsOfDate,
    }),
    [
      activeTabCash,
      activeTabCashRatioPct,
      activeTabReturnPct,
      activeTabTodayPnlPct,
      activeTabTodayPnlValue,
      activeTabTotalCost,
      activeTabTotalEquity,
      activeTabTotalPnl,
      activeSymbolCount,
      activeTabAsOfDate,
    ],
  )

  const tabPositionBars = useMemo(() => {
    const symbolKeys = ['symbol', 'Symbol', '\uC885\uBAA9', '\uD2F0\uCEE4', 'Ticker']
    const valuationKeys = ['\uD3C9\uAC00\uC561', 'equity', 'Equity', 'market_value', 'value', '\uC2DC\uC7A5\uAC00\uCE58', '\uD3C9\uAC00\uAE08\uC561']
    const buyAmountKeys = ['\uB9E4\uC218\uC561', '\uB9E4\uC218\uCD1D\uC561', 'buy_total', 'buy_amount', 'cost_basis', '\uD22C\uC785\uC561']

    const rows = activePositionsRows

    const data = rows
      .map((row) => {
        const symbol = getFirstString(row, symbolKeys)
        const valuation = getFirstNumber(row, valuationKeys)
        const buyAmount = getFirstNumber(row, buyAmountKeys)
        if (!symbol || (valuation === null && buyAmount === null)) return null
        return {
          symbol,
          valuation: valuation ?? 0,
          buyAmount: buyAmount ?? 0,
        }
      })
      .filter((r): r is { symbol: string; valuation: number; buyAmount: number } => !!r)

    return data.sort((a, b) => (b.valuation || 0) - (a.valuation || 0)).slice(0, 12)
  }, [activePositionsRows])

  const tabDonutRows = useMemo(() => {
    const symbolKeys = ['symbol', 'Symbol', '\uC885\uBAA9', '\uD2F0\uCEE4', 'Ticker']
    const pctKeys = ['position_pct', 'Position %', '\uD3EC\uC9C0\uC158(%)', '\uBE44\uC911', '\uBE44\uC911(%)']
    const equityKeys = ['equity', 'Equity', '\uD3C9\uAC00\uC561', '\uC2DC\uC7A5\uAC00\uCE58', 'value', 'market_value']

    const entries = activePositionsRows
      .map((row) => {
        const symbol = getFirstString(row, symbolKeys)
        const pct = getFirstNumber(row, pctKeys)
        const equity = getFirstNumber(row, equityKeys)
        return { symbol, pct, equity }
      })
      .filter((r) => r.symbol)

    if (entries.length === 0) return []

    const hasPct = entries.some((e) => typeof e.pct === 'number' && e.pct > 0)
    let rows: Array<{ symbol: string; pct: number }>
    if (hasPct) {
      rows = entries
        .map((e) => ({ symbol: e.symbol, pct: Math.max(0, e.pct || 0) }))
        .filter((x) => x.pct > 0)
    } else {
      const snapshotTotalEquity =
        activeTabSnapshotNum('account_total') ??
        activeTabSnapshotNum('total_equity') ??
        null
      const total =
        typeof snapshotTotalEquity === 'number' && snapshotTotalEquity > 0
          ? snapshotTotalEquity
          : entries.reduce((sum, e) => sum + (e.equity || 0), 0)
      rows = entries
        .map((e) => ({
          symbol: e.symbol,
          pct: total > 0 && e.equity ? (e.equity / total) * 100 : 0,
        }))
        .filter((x) => x.pct > 0)
    }

    rows.sort((a, b) => b.pct - a.pct)
    return rows
  }, [activePositionsRows, activeTabSnapshotNormalized])

  const tabTopWeight = tabDonutRows[0]
  const tabTop3WeightPct = tabDonutRows.slice(0, 3).reduce((sum, r) => sum + (Number.isFinite(r.pct) ? r.pct : 0), 0)
  const tabTotalEquity =
    activeTabSnapshotNum('account_total') ??
    activeTabSnapshotNum('total_equity') ??
    activePositionsRows.reduce((sum, row) => sum + (typeof row.equity === 'number' ? row.equity : 0), 0)
  const tabSnapshotTotalPnl = activeTabSnapshotNum('total_pnl') ?? activeTabSnapshotNum('today_pnl')
  const tabSnapshotTotalCost = activeTabSnapshotNum('buy_total') ?? activeTabSnapshotNum('total_invested')
  const tabSnapshotCash = activeTabSnapshotNum('cash')
  const tabSnapshotTodayPnlValue = activeTabSnapshotNum('today_pnl')
  const tabSnapshotTodayPnlPct = activeTabSnapshotNum('today_pnl_pct')
  const tabReturnPct =
    activeTabSnapshotNum('total_pnl_pct') ??
    activeTabSnapshotNum('account_return_pct') ??
    (typeof tabSnapshotTotalPnl === 'number' && typeof tabSnapshotTotalCost === 'number' && tabSnapshotTotalCost !== 0
      ? (tabSnapshotTotalPnl / tabSnapshotTotalCost) * 100
      : null)
  const tabCashRatioPct =
    typeof tabSnapshotCash === 'number' && typeof tabTotalEquity === 'number' && tabTotalEquity > 0
      ? (tabSnapshotCash / tabTotalEquity) * 100
      : null
  const tabCashRatioText = tabCashRatioPct != null ? `${tabCashRatioPct.toFixed(1)}%` : '-'
  const tabConcentrationTone = tabTop3WeightPct >= 65 ? 'high' : tabTop3WeightPct >= 45 ? 'mid' : 'low'
  const tabDiversificationText =
    tabConcentrationTone === 'high'
      ? '상위 종목 집중도가 높아 개별 종목 변동이 탭 성과에 크게 영향을 줍니다.'
      : tabConcentrationTone === 'mid'
        ? '집중도는 중간 구간이며 상위 종목의 흐름이 성과를 좌우합니다.'
        : '비중이 비교적 분산되어 있어 개별 종목 충격에 대한 완충이 있습니다.'
  const tabPnlTone = typeof tabReturnPct === 'number' ? (tabReturnPct >= 0 ? 'plus' : 'minus') : 'na'
  const tabTodayPnlValue =
    typeof tabSnapshotTodayPnlValue === 'number'
      ? tabSnapshotTodayPnlValue
      : activePositionsRows.reduce(
          (sum, row) => sum + (typeof row.pnl_today === 'number' ? row.pnl_today : 0),
          0,
        )
  const tabTodayPnlPct =
    typeof tabSnapshotTodayPnlPct === 'number'
      ? tabSnapshotTodayPnlPct
      : typeof tabTodayPnlValue === 'number' && typeof tabTotalEquity === 'number' && tabTotalEquity - tabTodayPnlValue > 0
        ? (tabTodayPnlValue / (tabTotalEquity - tabTodayPnlValue)) * 100
        : null
  const tabActiveSymbolCount = Array.isArray(activePositionsRows)
    ? activePositionsRows.filter((r) => !!asText(r.symbol)).length
    : 0
  const narrativeSheetId = useMemo(() => {
    const fromInput = extractSheetId(sheetUrl)
    if (fromInput) return fromInput
    const fromTabsMeta = extractSheetId(asText(tabsMeta?.sheet_id))
    if (fromTabsMeta) return fromTabsMeta
    const fromTs = extractSheetId(asText(tsData?.sheet_id))
    if (fromTs) return fromTs
    return ''
  }, [sheetUrl, tabsMeta?.sheet_id, tsData?.sheet_id])
  const portfolioNarrativeInputSignature = useMemo(() => {
    const rowBits = activePositionsRows.slice(0, 12).map((row, idx) => {
      const raw = row as Record<string, unknown>
      const symbol =
        asText(raw.symbol ?? raw.Symbol ?? raw['종목'] ?? raw['티커'] ?? raw.Ticker) || `row${idx}`
      const pctValue = raw.position_pct ?? raw['포지션(%)'] ?? raw['비중'] ?? raw['비중(%)']
      const equityValue = raw.equity ?? raw['평가액'] ?? raw.market_value ?? raw.value ?? raw['시장가치']
      const pnlValue = raw.pnl_today ?? raw['오늘 수익'] ?? raw.change_pct ?? raw['변동(%)']
      const safePct = typeof pctValue === 'number' && Number.isFinite(pctValue) ? pctValue.toFixed(2) : '-'
      const safeEquity =
        typeof equityValue === 'number' && Number.isFinite(equityValue) ? equityValue.toFixed(0) : '-'
      const safePnl = typeof pnlValue === 'number' && Number.isFinite(pnlValue) ? pnlValue.toFixed(2) : '-'
      return [symbol, safePct, safeEquity, safePnl].join(':')
    }).join('|')
    return [
      PORTFOLIO_NARRATIVE_VERSION,
      narrativeSheetId || '',
      activePositionsTab || '',
      activeTabAsOfDate || '',
      activeTabTotalEquity ?? '-',
      activeTabTotalCost ?? '-',
      activeTabTotalPnl ?? '-',
      activeTabCashRatioPct ?? '-',
      topWeight?.symbol ?? '-',
      topWeight?.pct ?? '-',
      top3WeightPct,
      activeSymbolCount,
      rowBits,
    ].join('::')
  }, [
    activePositionsRows,
    narrativeSheetId,
    activePositionsTab,
    activeTabAsOfDate,
    activeTabTotalEquity,
    activeTabTotalCost,
    activeTabTotalPnl,
    activeTabCashRatioPct,
    topWeight?.symbol,
    topWeight?.pct,
    top3WeightPct,
    activeSymbolCount,
  ])
  const leverageExposureWeightPct = donutRows.reduce(
    (sum, row) => (isLeverageSymbol(row.symbol) ? sum + row.pct : sum),
    0,
  )
  const spyMarketChangePct =
    typeof marketIndices?.indices?.SPY?.change_pct === 'number' ? marketIndices.indices.SPY.change_pct : null
  const topHoldingRow = topWeight
    ? activePositionsRows.find((row) => asText(row.symbol) === topWeight.symbol)
    : null
  const topHoldingChangePct = typeof topHoldingRow?.change_pct === 'number' ? topHoldingRow.change_pct : null
  const topHoldingVsSpyPct =
    spyMarketChangePct != null && topHoldingChangePct != null ? topHoldingChangePct - spyMarketChangePct : null
  const topHoldingVsSpyText =
    topHoldingVsSpyPct != null && topWeight
      ? `${topWeight.symbol} is ${topHoldingVsSpyPct >= 0 ? 'above' : 'below'} SPY by ${Math.abs(topHoldingVsSpyPct).toFixed(2)}pp today.`
      : ''
  const activeTabPortfolioData = useMemo(
    () => ({
      sheet_id: narrativeSheetId || null,
      tab_name: activePositionsTab || null,
      summary: activeTabSummary,
      portfolio_snapshot: {
        total_value: activeTabSummary.total_equity,
        cash_weight: activeTabSummary.cash_ratio_pct,
        daily_pnl_pct: activeTabSummary.today_pnl_pct,
        total_pnl_pct: activeTabSummary.total_pnl_pct,
        top3_weight: top3WeightPct,
        leverage_exposure_weight: leverageExposureWeightPct,
        sector_exposure: [],
        position_count: activeTabSummary.position_count,
      },
      market_reference: marketIndices?.indices?.SPY
        ? {
            symbol: 'SPY',
            name: asText(marketIndices.indices.SPY.name) || 'S&P 500',
            price:
              typeof marketIndices.indices.SPY.price === 'number'
                ? marketIndices.indices.SPY.price
                : parseLooseNumber(marketIndices.indices.SPY.price),
            daily_change_pct:
              typeof marketIndices.indices.SPY.change_pct === 'number'
                ? marketIndices.indices.SPY.change_pct
                : parseLooseNumber(marketIndices.indices.SPY.change_pct),
            as_of: asText(marketIndices.timestamp),
          }
        : null,
      portfolio_daily_change: {
        daily_pnl: activeTabSummary.today_pnl,
        daily_pnl_pct: activeTabSummary.today_pnl_pct,
      },
      holdings: activePositionsRows.map((row) => ({
        symbol: asText(row.symbol),
        weight: typeof row.position_pct === 'number' ? row.position_pct : null,
        daily_change_pct: typeof row.change_pct === 'number' ? row.change_pct : null,
        total_return_pct: typeof row.cum_return_pct === 'number' ? row.cum_return_pct : null,
        contribution_today:
          typeof row.pnl_today === 'number' && typeof activeTabSummary.total_equity === 'number' && activeTabSummary.total_equity > 0
            ? (row.pnl_today / activeTabSummary.total_equity) * 100
            : null,
        is_leverage: isLeverageSymbol(asText(row.symbol)),
        sector: '',
        trend_5d: '',
        avg_price: typeof row.avg_cost === 'number' ? row.avg_cost : null,
        current_price: typeof row.today_close === 'number' ? row.today_close : null,
        avg_cost: typeof row.avg_cost === 'number' ? row.avg_cost : null,
        rsi: typeof row.rsi === 'number' ? row.rsi : null,
        volume_k: typeof row.volume_k === 'number' ? row.volume_k : null,
        mdd_pct: typeof row.mdd_pct === 'number' ? row.mdd_pct : null,
        ma5: typeof row.ma5 === 'number' ? row.ma5 : null,
        ma120: typeof row.ma120 === 'number' ? row.ma120 : null,
        ma200: typeof row.ma200 === 'number' ? row.ma200 : null,
        note: asText(row.note),
        name: asText(row.symbol),
      })),
      watchlist_snapshot: {
        focus: [],
        moves: [],
        symbols: [],
      },
      watchlist: [],
      index_summary: [],
      sector_summary: {
        portfolio_exposure: [],
        market_leaders: [],
        market_laggards: [],
      },
      symbol_news: [],
      positions: activePositionsRows,
      positions_columns: activePositionsColumns,
    }),
    [
      activePositionsRows,
      activePositionsColumns,
      activeTabSummary,
      activePositionsTab,
      narrativeSheetId,
      leverageExposureWeightPct,
      marketIndices,
      top3WeightPct,
    ],
  )

  async function loadPortfolioNarrative(forceRefresh = false, requestSignature = portfolioNarrativeInputSignature) {
    if (loading || tabsLoading || !activePositionsTab) return

    portfolioNarrativeAbortRef.current?.abort()
    const controller = new AbortController()
    portfolioNarrativeAbortRef.current = controller
    let active = true
    setPortfolioNarrativeLoading(true)

    try {
      const response = await fetch(`${API_BASE}/api/narrative/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force_refresh: forceRefresh,
          sheet_id: narrativeSheetId || null,
          subscriber_key: narrativeSheetId || null,
          portfolio_data: activeTabPortfolioData,
          engine_data: {
            tab_name: activePositionsTab || null,
            narrative_version: PORTFOLIO_NARRATIVE_VERSION,
            sheet_id: narrativeSheetId || null,
            subscriber_key: narrativeSheetId || null,
            today: new Date().toISOString().slice(0, 10),
            as_of_date: activeTabSummary.as_of_date,
            total_equity: activeTabSummary.total_equity,
            total_cost: activeTabSummary.total_cost,
            total_pnl: activeTabSummary.total_pnl,
            total_pnl_pct: activeTabSummary.total_pnl_pct,
            today_pnl: activeTabSummary.today_pnl,
            today_pnl_pct: activeTabSummary.today_pnl_pct,
            cash: activeTabSummary.cash,
            cash_ratio_pct: activeTabSummary.cash_ratio_pct,
            top_weight_symbol: topWeight?.symbol || null,
            top_weight_pct: topWeight?.pct ?? null,
            top3_weight_pct: top3WeightPct,
            concentration_tone: concentrationTone,
            diversification_text: diversificationText,
            pnl_tone: pnlTone,
          },
        }),
        cache: 'no-store',
        signal: controller.signal,
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to load portfolio narrative.')
      }

      if (!active) return
      setPortfolioNarrative(mapPortfolioNarrative(json))
        setPortfolioNarrativeMeta({
          cached: !!json?.cached,
          cache_mode: asText(json?.cache_mode) || 'daily',
          cache_date: asText(json?.cache_date) || '',
          analysis_date: asText(json?.analysis_date) || '',
          generated_at: asText(json?.generated_at) || '',
          saved_at: asText(json?.saved_at) || '',
          cache_tab: asText(json?.cache_tab) || asText(json?.tab_name) || activePositionsTab,
          cache_version: asText(json?.cache_version) || PORTFOLIO_NARRATIVE_VERSION,
          cache_scope: asText(json?.cache_scope) || 'subscriber_daily',
          cache_namespace: asText(json?.cache_namespace) || '',
        })
        portfolioNarrativeLoadedSignatureRef.current = requestSignature
      } catch {
        if (!active) return
        setPortfolioNarrativeMeta((prev) =>
          prev
            ? {
                ...prev,
                cached: true,
                cache_mode: 'sticky_on_error',
              }
            : prev,
        )
        portfolioNarrativeLoadedSignatureRef.current = requestSignature
      } finally {
      if (active) {
        setPortfolioNarrativeLoading(false)
      }
      if (portfolioNarrativeAbortRef.current === controller) {
        portfolioNarrativeAbortRef.current = null
      }
    }
  }

  useEffect(() => {
    if (loading || tabsLoading || !activePositionsTab) return
    if (portfolioNarrativeLoadedSignatureRef.current === portfolioNarrativeInputSignature) return
    void loadPortfolioNarrative(false, portfolioNarrativeInputSignature)
  }, [activePositionsTab, loading, tabsLoading, portfolioNarrativeInputSignature])

  useEffect(() => {
    return () => {
      portfolioNarrativeAbortRef.current?.abort()
    }
  }, [])

  const resolvedPortfolioNarrative = useMemo(
    () =>
      portfolioNarrative ??
      mapPortfolioNarrative({
        headline:
          concentrationTone === 'high'
            ? topWeight
              ? `Fragile: ${topWeight.symbol} dominates the account and needs trimming before new risk.`
              : 'Fragile: the account is too concentrated and needs trimming before new risk.'
            : concentrationTone === 'mid'
              ? 'Overexposed: the core is fine, but concentration needs to be reduced before adding new risk.'
              : 'Defensive: preserve cash and keep leverage separate until the structure is cleaner.',
        daily_brief:
          typeof activeTabTotalPnl === 'number'
            ? `Account PnL is ${fmtMoney(activeTabTotalPnl)}${typeof activeTabReturnPct === 'number' ? ` (${fmtPct(activeTabReturnPct)})` : ''}.${spyMarketChangePct != null ? ` SPY is ${fmtPct(spyMarketChangePct)} today.` : ''}`
            : 'Account structure matters more than adding fresh risk today.',
        stock_focus: [
          topWeight
            ? {
                symbol: topWeight.symbol,
                type: concentrationTone === 'high' ? 'risk' : 'core',
                summary: `Largest holding at ${topWeight.pct.toFixed(1)}% requires active management.${topHoldingVsSpyText ? ` ${topHoldingVsSpyText}` : ''}`,
              }
            : null,
        ].filter(Boolean),
        portfolio_structure: diversificationText,
        watchlist_insight: 'Use watchlist names as comparison points and keep them tied to the current account theme.',
        action_advice:
          concentrationTone === 'high'
            ? 'Trim the largest position first and avoid adding leverage.'
            : concentrationTone === 'mid'
              ? 'Rebalance the biggest sleeve before adding new exposure.'
              : 'Maintain the defensive tilt and wait for a cleaner setup before increasing exposure.',
        risk_flags: [concentrationTone === 'high' ? 'single_stock_concentration' : null].filter(Boolean),
        summary:
          concentrationTone === 'high'
            ? topWeight
              ? `Fragile: ${topWeight.symbol} dominates the book, so trim the largest line before adding fresh risk.`
              : 'Fragile: the book is too concentrated, so trim the largest line before adding fresh risk.'
            : concentrationTone === 'mid'
              ? 'Overexposed: keep the core, but rebalance concentration before adding new risk.'
              : 'Defensive: preserve the cash buffer and keep leverage separate until the structure is cleaner.',
        structure: diversificationText,
        risk: topWeight
          ? `The main risk is concentration in ${topWeight.symbol} at ${topWeight.pct.toFixed(1)}%.`
          : 'The main risk is that the portfolio is still concentrated across a few positions.',
        alignment:
          cashRatioPct != null
            ? `Cash buffer is ${cashRatioText}, so it can help absorb volatility if you keep new risk small.`
            : 'Cash buffer is not available, so the advice is to stay conservative until the structure is clearer.',
        action:
          concentrationTone === 'high'
            ? 'Trim the largest position first and avoid adding leverage.'
            : concentrationTone === 'mid'
              ? 'Rebalance the biggest sleeve before adding new exposure.'
              : 'Maintain the defensive tilt and wait for a cleaner setup before increasing exposure.',
        tqqq:
          pnlTone === 'plus'
            ? 'Treat TQQQ as a separate tactical sleeve, not part of the core basket.'
            : 'Keep TQQQ separate from the core basket until the structure improves.',
      }),
    [cashRatioPct, concentrationTone, diversificationText, marketIndices, pnlTone, portfolioNarrative, topHoldingVsSpyText, topWeight],
  )

  const portfolioNarrativeDate = fmtDateOnly(
    portfolioNarrativeMeta?.generated_at ||
      portfolioNarrativeMeta?.analysis_date ||
      portfolioNarrativeMeta?.cache_date ||
      activeTabAsOfDate,
  )

  const snapshotExtraRows = useMemo(() => {
    return [
      { label: '총 평가액', value: fmtMoney(activeTabTotalEquity) },
      { label: '총 매수액', value: fmtMoney(activeTabTotalCost) },
      {
        label: '금일손익',
        value:
          typeof todayPnlValue === 'number'
            ? `${fmtMoney(todayPnlValue)}${typeof todayPnlPct === 'number' ? ` (${fmtPct(todayPnlPct)})` : ''}`
            : '-',
      },
      { label: '누적손익', value: fmtMoney(activeTabTotalPnl) },
      { label: 'Top1 비중', value: topWeight ? `${topWeight.symbol} ${topWeight.pct.toFixed(1)}%` : '-' },
      { label: 'Top3 비중', value: donutRows.length ? `${top3WeightPct.toFixed(1)}%` : '-' },
      { label: '현금 비중', value: cashRatioText },
    ]
    // Just map the raw box values from the Sheet snapshot
    const rows = snapshotRawRows.filter(r => asText(r.label))
    if (rows.length > 0) return rows
    
    // Fallback if data is not available
    return [
      { label: 'Top1 비중', value: topWeight ? `${topWeight.symbol} ${topWeight.pct.toFixed(1)}%` : '-' },
      { label: 'Top3 비중', value: donutRows.length ? `${top3WeightPct.toFixed(1)}%` : '-' },
      { label: '집중도', value: concentrationTone === 'high' ? '집중 높음' : concentrationTone === 'mid' ? '집중 중간' : '분산 양호' },
      { label: '현금 비중', value: cashRatioText },
    ]
  }, [snapshotRawRows, activeSymbolCount, cashRatioPct, topWeight, donutRows, top3WeightPct])

  return (
    <div style={{ padding: '1.5rem 1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
            My <span style={{ color: '#00D9FF' }}>Holdings v2</span>
          </h1>
          <div style={{ color: '#8b93a8', fontSize: '0.78rem', marginTop: 4 }}>
            As of: {asText(data.as_of_date) || '-'} | Generated: {asText(data.generated_at) || '-'} | Status: {asText(data.status) || '-'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <ContentLangToggle
            value={contentLang}
            onChange={(next) => { setContentLang(next); persistContentLang(next) }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => onChooseFile(e.target.files?.[0] || null)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{
              border: '1px solid rgba(96,165,250,0.35)',
              background: importing ? 'rgba(255,255,255,0.04)' : 'rgba(96,165,250,0.14)',
              color: importing ? '#9ca3af' : '#bfdbfe',
              borderRadius: 8,
              padding: '0.35rem 0.62rem',
              fontSize: '0.76rem',
              cursor: importing ? 'default' : 'pointer',
            }}
          >
            {importing ? 'Importing...' : 'Import CSV'}
          </button>
          <a
            href={`${API_BASE}/api/my/export?format=csv`}
            target="_blank"
            style={{
              border: '1px solid rgba(34,197,94,0.35)',
              background: 'rgba(34,197,94,0.12)',
              color: '#86efac',
              borderRadius: 8,
              padding: '0.35rem 0.62rem',
              fontSize: '0.76rem',
              textDecoration: 'none',
            }}
          >
            Export CSV
          </a>
          <a
            href={`${API_BASE}/api/my/export?format=json`}
            target="_blank"
            style={{
              border: '1px solid rgba(245,158,11,0.35)',
              background: 'rgba(245,158,11,0.12)',
              color: '#fcd34d',
              borderRadius: 8,
              padding: '0.35rem 0.62rem',
              fontSize: '0.76rem',
              textDecoration: 'none',
            }}
          >
            Export JSON
          </a>
          <a
            href={`${API_BASE}/api/my/template-csv`}
            target="_blank"
            style={{
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.04)',
              color: '#cbd5e1',
              borderRadius: 8,
              padding: '0.35rem 0.62rem',
              fontSize: '0.76rem',
              textDecoration: 'none',
            }}
          >
            Template v2
          </a>
        </div>
      </div>

      {message ? <div style={{ color: '#fbbf24', fontSize: '0.76rem' }}>{asText(message)}</div> : null}
      {data.error ? <div style={{ color: '#fca5a5', fontSize: '0.76rem' }}>{asText(data.error)}</div> : null}
      {data.rerun_hint ? <div style={{ color: '#8b93a8', fontSize: '0.75rem' }}>hint: {asText(data.rerun_hint)}</div> : null}

      {Array.isArray(data.errors) && data.errors.length > 0 ? (
        <section style={{ ...panelStyle(), border: '1px solid rgba(239,68,68,0.25)' }}>
          <div style={{ color: '#fca5a5', fontWeight: 700, marginBottom: 8 }}>Import / Build Errors ({data.errors.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.errors.slice(0, 12).map((err, idx) => (
              <div key={`err-${idx}`} style={{ color: '#fecaca', fontSize: '0.76rem' }}>
                {asText(err.type) || 'error'}
                {typeof err.line === 'number' ? ` (line ${err.line})` : ''}
                {err.symbol ? ` [${asText(err.symbol)}]` : ''}: {asText(err.message || 'unknown')}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        style={{
          ...panelStyle(),
          padding: '0.85rem 0.95rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: 10 }}>
          <div style={{ color: '#dce9f8', fontWeight: 800, fontSize: '0.9rem' }}>주요 요소 및 성과 요약</div>
          <div style={{ color: '#b9c9dd', fontSize: '0.72rem' }}>Performance Snapshot</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8, marginTop: 2 }}>
            {snapshotExtraRows.length > 0 ? (
              snapshotExtraRows.map((item, idx) => (
                <div key={`${asText(item.label)}-${idx}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.45rem 0.55rem' }}>
                  <div style={{ color: '#b9c9dd', fontSize: '0.68rem', marginBottom: 2 }}>{asText(item.label) || '-'}</div>
                  <div style={{ color: '#dce9f8', fontWeight: 800, fontSize: '0.92rem' }}>{asText(item.value) || '-'}</div>
                </div>
              ))
            ) : (
              <div style={{ color: '#8b93a8', fontSize: '0.75rem', gridColumn: 'span 2' }}>시트에서 주요 요소 데이터를 가져오지 못했습니다.</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ color: '#dce9f8', fontWeight: 700, fontSize: '0.84rem' }}>집중도 / 분산도</div>
            <div style={{ color: '#b9c9dd', fontSize: '0.7rem' }}>보유 {activeSymbolCount}종목</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', borderRadius: 999, padding: '0.28rem 0.55rem', color: '#dce9f8', fontSize: '0.74rem' }}>
              Top1 {topWeight ? `${topWeight.symbol} ${topWeight.pct.toFixed(1)}%` : '—'}
            </div>
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', borderRadius: 999, padding: '0.28rem 0.55rem', color: '#dce9f8', fontSize: '0.74rem' }}>
              Top3 {donutRows.length ? `${top3WeightPct.toFixed(1)}%` : '—'}
            </div>
            <div
              style={{
                border: concentrationTone === 'high' ? '1px solid rgba(245,158,11,0.35)' : concentrationTone === 'mid' ? '1px solid rgba(96,165,250,0.35)' : '1px solid rgba(34,197,94,0.35)',
                background: concentrationTone === 'high' ? 'rgba(245,158,11,0.10)' : concentrationTone === 'mid' ? 'rgba(96,165,250,0.10)' : 'rgba(34,197,94,0.10)',
                borderRadius: 999,
                padding: '0.28rem 0.55rem',
                color: concentrationTone === 'high' ? '#fbbf24' : concentrationTone === 'mid' ? '#93c5fd' : '#86efac',
                fontSize: '0.74rem',
              }}
            >
              {concentrationTone === 'high' ? '집중 높음' : concentrationTone === 'mid' ? '집중 중간' : '분산 양호'}
            </div>
          </div>
          <div style={{ color: '#dce9f8', fontSize: '0.78rem', lineHeight: 1.45, display: 'none' }}>
            {diversificationText} {cashRatioPct != null ? `현금 ${cashRatioText}.` : ''}{' '}
            {typeof activeTabSummary.total_pnl_pct === 'number' ? `누적 수익률 ${fmtPct(activeTabSummary.total_pnl_pct)}.` : ''}
          </div>
          {resolvedPortfolioNarrative ? (
            <NarrativeBlocks
              data={resolvedPortfolioNarrative}
              density="compact"
              headerLeft={
                portfolioNarrativeDate ? (
                  <span
                    style={{
                      color: '#93c5fd',
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      padding: '2px 7px',
                      borderRadius: 999,
                      border: '1px solid rgba(59,130,246,0.24)',
                      background: 'rgba(59,130,246,0.10)',
                    }}
                  >
                    {portfolioNarrativeDate}
                  </span>
                ) : null
              }
              headerRight={
                <button
                  type="button"
                  onClick={() => void loadPortfolioNarrative(true, portfolioNarrativeInputSignature)}
                  disabled={portfolioNarrativeLoading}
                  style={{
                    border: '1px solid rgba(16,185,129,0.35)',
                    background: portfolioNarrativeLoading ? 'rgba(16,185,129,0.10)' : 'rgba(16,185,129,0.16)',
                    color: portfolioNarrativeLoading ? '#86efac' : '#6ee7b7',
                    borderRadius: 999,
                    padding: '0.22rem 0.55rem',
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: portfolioNarrativeLoading ? 'default' : 'pointer',
                  }}
                >
                  {portfolioNarrativeLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              }
            />
          ) : (
            <div style={{ color: '#8b93a8', fontSize: '0.78rem', lineHeight: 1.45 }}>
              Portfolio narrative is unavailable.
            </div>
          )}
        </div>
      </section>

      <section style={{ ...panelStyle(), display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ color: '#d1d5db', fontWeight: 700, minWidth: 120 }}>Position Charts</div>
          <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>Selected tab: {asText(activePositionsTab) || '-'}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ flex: 1.7, minWidth: 260 }}>
            <div style={{ color: '#b9c9dd', fontSize: '0.72rem', marginBottom: 5 }}>평가액 / 매수액</div>
            {tabPositionBars.length === 0 ? (
              <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No position values.</div>
            ) : (
              <div style={{ width: '100%', height: 205 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tabPositionBars} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis dataKey="symbol" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                      <Bar dataKey="valuation" name="평가액" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="buyAmount" name="매수액" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div style={{ flex: 0.95, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#b9c9dd', fontSize: '0.72rem', minWidth: 120 }}>Weights Donut</div>
            {tabDonutRows.length === 0 ? (
              <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No position weights.</div>
            ) : (
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 26, right: 28, left: 28, bottom: 26 }}>
                    <Pie
                      data={tabDonutRows}
                      dataKey="pct"
                      nameKey="symbol"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={1}
                      labelLine={false}
                      label={renderPieLabel}
                    >
                      {tabDonutRows.map((entry, index) => (
                        <Cell key={`cell-${entry.symbol}-${index}`} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 250,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.02)',
              padding: '0.8rem 0.9rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div>
              <div style={{ color: '#dce9f8', fontWeight: 700, fontSize: '0.92rem' }}>내 포트폴리오 분석</div>
              <div style={{ color: '#b9c9dd', fontSize: '0.72rem', marginTop: 2 }}>Evidence Summary</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
              <div style={{ padding: '0.45rem 0.55rem', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#b9c9dd', fontSize: '0.68rem' }}>Top Holding</div>
                <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '0.95rem', marginTop: 2 }}>
                  {tabTopWeight ? tabTopWeight.symbol : '-'}
                </div>
                <div style={{ color: '#8fe8ff', fontSize: '0.72rem', marginTop: 2 }}>
                  {tabTopWeight ? `${tabTopWeight.pct.toFixed(1)}%` : '-'}
                </div>
              </div>
              <div style={{ padding: '0.45rem 0.55rem', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#b9c9dd', fontSize: '0.68rem' }}>Top 3 Weight</div>
                <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '0.95rem', marginTop: 2 }}>
                  {tabDonutRows.length ? `${tabTop3WeightPct.toFixed(1)}%` : '-'}
                </div>
                <div style={{ color: tabConcentrationTone === 'high' ? '#f59e0b' : tabConcentrationTone === 'mid' ? '#93c5fd' : '#34d399', fontSize: '0.72rem', marginTop: 2 }}>
                  {tabConcentrationTone === 'high' ? '집중 높음' : tabConcentrationTone === 'mid' ? '집중 중간' : '분산 양호'}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ color: '#dce9f8', fontSize: '0.79rem', lineHeight: 1.45 }}>
                {tabDiversificationText}
              </div>
              <div style={{ color: '#dce9f8', fontSize: '0.79rem', lineHeight: 1.45 }}>
                {tabCashRatioPct != null
                  ? `현금 비중은 약 ${tabCashRatioText}로 ${tabCashRatioPct >= 15 ? '완충 여력이 있는 편입니다.' : '완충 여력이 크지 않을 수 있습니다.'}`
                  : '현금 비중 데이터가 없어 완충 여력을 제한적으로 봅니다.'}
              </div>
              <div style={{ color: tabPnlTone === 'plus' ? '#34d399' : tabPnlTone === 'minus' ? '#f87171' : '#b9c9dd', fontSize: '0.79rem', lineHeight: 1.45 }}>
                {typeof tabReturnPct === 'number'
                  ? `누적 성과는 ${fmtPct(tabReturnPct)} 수준이며, 상위 비중 종목의 변동이 체감 수익률에 크게 반영됩니다.`
                  : '누적 성과 데이터가 충분하지 않아 해석을 제한합니다.'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {positionTabs.length > 0 ? (
        <section style={panelStyle()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ color: '#e5e7eb', fontWeight: 700 }}>Active Tab Selector</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Active tab: {asText(activePositionsTab) || '-'}</div>
              <button
                onClick={handleImportTabs}
                disabled={tabsLoading}
                style={{ border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.16)', color: '#6ee7b7', borderRadius: 6, padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                  {tabsLoading ? 'Loading...' : 'Reload Tabs'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {positionTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActivePositionsTab(tab)}
                style={{
                  border: activePositionsTab === tab ? '1px solid rgba(0,217,255,0.45)' : '1px solid rgba(255,255,255,0.14)',
                  background: activePositionsTab === tab ? 'rgba(0,217,255,0.14)' : 'rgba(255,255,255,0.04)',
                  color: activePositionsTab === tab ? '#67e8f9' : '#9ca3af',
                  borderRadius: 8,
                  padding: '0.25rem 0.55rem',
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                }}
              >
                {asText(tab)}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            {activePositionsRows.length === 0 ? (
              <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No positions for selected tab.</div>
            ) : positionsColumnsView.length === 0 ? (
              <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No columns detected.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: 960 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    {positionsColumnsView.map((col) => (
                      <th
                        key={col}
                        style={{
                          textAlign: 'left',
                          padding: '0.45rem 0.3rem',
                          color: '#9ca3af',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col === '__sparkline' ? 'Sparkline' : col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePositionsRows.map((row, idx) => (
                    <tr key={`${activePositionsTab}-${idx}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {positionsColumnsView.map((col) => {
                        const rawValue = col === '순서' ? (row?.순서 ?? row?.col_1 ?? idx + 1) : row?.[col]
                        return (
                          <td
                            key={`${activePositionsTab}-${idx}-${col}`}
                            style={{
                              padding: '0.42rem 0.3rem',
                              textAlign: 'left',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {renderSheetCellValue(rawValue, col)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : null}

      <section style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ color: '#e5e7eb', fontWeight: 800, fontSize: '1.1rem' }}>Active Tab History (Cumulative)</div>
            <div style={{ color: '#9ca3af', fontSize: '0.78rem' }}>
              Cache-only | generated: {tsData?.generated_at || '-'} | tabs: {(tsData?.active_tabs || []).join(', ') || '-'}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
              maxWidth: 520,
              justifyContent: 'flex-end',
              marginLeft: 'auto',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140, flex: '1 1 140px' }}>
              <div style={{ color: '#9ca3af', fontSize: '0.7rem' }}>Google Sheet Link / ID</div>
              <input
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                style={{
                  padding: '0.25rem 0.4rem',
                  background: 'rgba(31,41,55,0.8)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e5e7eb',
                  borderRadius: 8,
                  fontSize: '0.72rem',
                }}
              />
            </div>
            <button
              onClick={handleLoadTabs}
              style={{
                border: '1px solid rgba(14,165,233,0.4)',
                background: 'rgba(14,165,233,0.15)',
                color: '#7dd3fc',
                borderRadius: 8,
                padding: '0.25rem 0.45rem',
                fontSize: '0.7rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {tabsLoading ? 'Loading...' : 'Load'}
            </button>
            <button
              onClick={handleImportTabs}
              style={{
                border: '1px solid rgba(16,185,129,0.4)',
                background: 'rgba(16,185,129,0.16)',
                color: '#6ee7b7',
                borderRadius: 8,
                padding: '0.25rem 0.45rem',
                fontSize: '0.7rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Import
            </button>
            <button
              onClick={refreshTs}
              style={{
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.06)',
                color: '#e5e7eb',
                borderRadius: 8,
                padding: '0.25rem 0.45rem',
                fontSize: '0.7rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Refresh
            </button>
            <a
              href={`${API_BASE}/api/my/holdings/ts/export?format=csv`}
              target="_blank"
              style={{
                border: '1px solid rgba(234,179,8,0.35)',
                background: 'rgba(234,179,8,0.12)',
                color: '#fde68a',
                borderRadius: 8,
                padding: '0.25rem 0.45rem',
                fontSize: '0.7rem',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Export TS
            </a>
          </div>
        </div>

        {/* Google Sheet Setup Guide — 구독자용 */}
        <div style={{ marginBottom: 10, padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid rgba(14,165,233,0.2)', background: 'rgba(14,165,233,0.05)' }}>
          <div style={{ color: '#7dd3fc', fontWeight: 700, fontSize: '0.78rem', marginBottom: 6 }}>
            Google Sheet 연결 방법
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ color: '#cbd5e1', fontSize: '0.73rem' }}>
              <span style={{ color: '#7dd3fc', fontWeight: 700 }}>Step 1.</span>{' '}
              아래 이메일에 내 Google Sheet 공유 (편집자 또는 뷰어 권한)
            </div>
            {saEmail ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <code style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(14,165,233,0.3)', color: '#38bdf8', borderRadius: 5, padding: '0.18rem 0.5rem', fontSize: '0.72rem', userSelect: 'all' }}>
                  {saEmail}
                </code>
                <button
                  onClick={() => { try { navigator.clipboard.writeText(saEmail) } catch {} }}
                  style={{ border: '1px solid rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.1)', color: '#7dd3fc', borderRadius: 5, padding: '0.15rem 0.4rem', fontSize: '0.65rem', cursor: 'pointer' }}
                >
                  Copy
                </button>
              </div>
            ) : (
              <div style={{ color: '#6b7280', fontSize: '0.72rem' }}>이메일 로딩 중...</div>
            )}
            <div style={{ color: '#cbd5e1', fontSize: '0.73rem', marginTop: 2 }}>
              <span style={{ color: '#7dd3fc', fontWeight: 700 }}>Step 2.</span>{' '}
              위 URL 입력란에 내 Google Sheet 주소 붙여넣기 → Load → Import
            </div>
          </div>
          {/* 관리자 전용: SA JSON 설정 (접기/펼치기) */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ color: '#6b7280', fontSize: '0.68rem', cursor: 'pointer' }}>
              Admin: Service Account 설정 ({credsStatus === null ? '...' : credsStatus?.configured ? `configured (${credsStatus.source})` : 'not configured'})
            </summary>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ color: '#6b7280', fontSize: '0.65rem', marginBottom: 3 }}>
                서비스 계정 JSON 전체를 붙여넣기 후 저장. 재배포 시 초기화되므로 <strong style={{ color: '#fbbf24' }}>Railway 대시보드 → Variables → <code>GOOGLE_SERVICE_ACCOUNT_JSON</code></strong> 에 설정하면 영구 보존됩니다.
              </div>
              <textarea
                value={saJsonInput}
                onChange={(e) => setSaJsonInput(e.target.value)}
                placeholder='{"type":"service_account","project_id":"...","private_key":"..."}'
                rows={4}
                style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af', borderRadius: 6, padding: '0.35rem 0.45rem', fontSize: '0.65rem', fontFamily: 'monospace', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={saveCreds}
                  disabled={credsLoading || !saJsonInput.trim()}
                  style={{ border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.15)', color: '#86efac', borderRadius: 6, padding: '0.2rem 0.5rem', fontSize: '0.68rem', cursor: 'pointer' }}
                >
                  {credsLoading ? 'Saving...' : 'Save SA JSON'}
                </button>
                {credsStatus?.configured && (
                  <button
                    onClick={clearCreds}
                    disabled={credsLoading}
                    style={{ border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', borderRadius: 6, padding: '0.2rem 0.5rem', fontSize: '0.68rem', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {credsMessage && (
                <div style={{ color: credsMessage.includes('완료') || credsMessage.includes('Saved') || credsMessage.includes('saved') ? '#86efac' : '#fca5a5', fontSize: '0.68rem', marginTop: 4, padding: '0.25rem 0.4rem', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }}>
                  {credsMessage}
                </div>
              )}
            </div>
          </details>
        </div>

        {tabsMeta?.tabs ? (
          <details open style={{ marginBottom: 10 }}>
            <summary style={{ color: '#cbd5e1', cursor: 'pointer', fontWeight: 700 }}>Tab Selector</summary>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                Selected: {selectedTabs.length}/{selectableTabs.length || 0}
              </div>
              <button
                onClick={toggleAllTabs}
                style={{
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: allTabsSelected ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                  color: allTabsSelected ? '#fca5a5' : '#e5e7eb',
                  borderRadius: 8,
                  padding: '0.2rem 0.5rem',
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {allTabsSelected ? 'All Off' : 'All On'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
              {tabsMeta.tabs
                .filter((t) => !t.excluded)
                .map((t) => {
                  const name = asText(t.title || t.name || '')
                  const checked = selectedTabs.includes(name)
                  return (
                    <label key={name} style={{ color: '#e5e7eb', fontSize: '0.78rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedTabs((prev) =>
                            checked ? prev.filter((x) => x !== name) : Array.from(new Set([...prev, name])),
                          )
                        }
                      />
                      {name} {t.kind ? `(${t.kind})` : ''}
                    </label>
                  )
                })}
            </div>
            {tabsMeta.excluded_default && tabsMeta.excluded_default.length > 0 ? (
              <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: 6 }}>
                Excluded by default: {tabsMeta.excluded_default.join(', ')}
              </div>
            ) : null}
          </details>
        ) : (
          <div style={{ color: '#9ca3af', fontSize: '0.78rem', marginBottom: 8 }}>
            {tabsLoading ? 'Loading tabs...' : 'No tabs metadata. Load tabs first.'}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          {tsLoading ? <div style={{ color: '#9ca3af' }}>Loading history...</div> : <AccountHistoryChart history={tsActiveHistory} />}
        </div>
        {tsRerun ? <div style={{ color: '#8b93a8', fontSize: '0.75rem' }}>rerun: {tsRerun}</div> : null}
      </section>

    </div>
  )
}




