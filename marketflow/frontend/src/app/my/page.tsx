'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
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
  sparkline_30?: number[]
}

type HoldingsSummary = {
  total_equity?: number | null
  total_cost?: number | null
  total_pnl?: number | null
  total_pnl_pct?: number | null
  today_pnl?: number | null
  mdd_portfolio_pct?: number | null
  cash?: number | null
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
  }>
  goal?: {
    positions?: Array<Record<string, any>>
    positions_columns?: string[]
    history?: HoldingPosition[]
  }
  rerun_hint?: string
  summary?: { point_count?: number; date_min?: string | null; date_max?: string | null }
  generated_at?: string
  sheet_id?: string
}

type ColumnKey =
  | 'symbol'
  | 'yesterday_close'
  | 'today_close'
  | 'change_pct'
  | 'pnl_today'
  | 'avg_cost'
  | 'equity'
  | 'cost_basis'
  | 'buy_total'
  | 'rsi'
  | 'position_pct'
  | 'shares'
  | 'cum_return_pct'
  | 'cum_pnl_usd'
  | 'mdd_pct'
  | 'volume_k'
  | 'high_52w'
  | 'low_52w'
  | 'ma5'
  | 'ma120'
  | 'ma200'
  | 'note'
  | 'sparkline_30'

type ColumnDef = {
  key: ColumnKey
  label: string
  kind: 'text' | 'money' | 'pct' | 'num' | 'sparkline'
  defaultVisible: boolean
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'

const COLUMNS: ColumnDef[] = [
  { key: 'symbol', label: 'Symbol', kind: 'text', defaultVisible: true },
  { key: 'sparkline_30', label: 'Sparkline', kind: 'sparkline', defaultVisible: true },
  { key: 'shares', label: 'Shares', kind: 'num', defaultVisible: true },
  { key: 'position_pct', label: 'Position %', kind: 'pct', defaultVisible: true },
  { key: 'today_close', label: 'Today Close', kind: 'money', defaultVisible: true },
  { key: 'yesterday_close', label: 'Yesterday Close', kind: 'money', defaultVisible: false },
  { key: 'change_pct', label: 'Change %', kind: 'pct', defaultVisible: true },
  { key: 'pnl_today', label: 'PnL Today', kind: 'money', defaultVisible: true },
  { key: 'avg_cost', label: 'Avg Cost', kind: 'money', defaultVisible: true },
  { key: 'equity', label: 'Equity', kind: 'money', defaultVisible: true },
  { key: 'cost_basis', label: 'Cost Basis', kind: 'money', defaultVisible: true },
  { key: 'buy_total', label: 'Buy Total', kind: 'money', defaultVisible: false },
  { key: 'cum_pnl_usd', label: 'Cum PnL USD', kind: 'money', defaultVisible: true },
  { key: 'cum_return_pct', label: 'Cum Return %', kind: 'pct', defaultVisible: true },
  { key: 'mdd_pct', label: 'MDD %', kind: 'pct', defaultVisible: false },
  { key: 'rsi', label: 'RSI', kind: 'num', defaultVisible: true },
  { key: 'volume_k', label: 'Volume (K)', kind: 'num', defaultVisible: true },
  { key: 'high_52w', label: '52W High', kind: 'money', defaultVisible: false },
  { key: 'low_52w', label: '52W Low', kind: 'money', defaultVisible: false },
  { key: 'ma5', label: 'MA5', kind: 'money', defaultVisible: false },
  { key: 'ma120', label: 'MA120', kind: 'money', defaultVisible: false },
  { key: 'ma200', label: 'MA200', kind: 'money', defaultVisible: false },
  { key: 'note', label: 'Note', kind: 'text', defaultVisible: true },
]

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

function Sparkline({ values }: { values?: number[] }) {
  const series = Array.isArray(values) ? values.filter((v) => typeof v === 'number' && !Number.isNaN(v)) : []
  if (series.length < 2) {
    return <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>-</span>
  }
  const w = 88
  const h = 24
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = Math.max(max - min, 1e-9)
  const step = w / (series.length - 1)
  const points = series
    .map((v, i) => {
      const x = i * step
      const y = h - ((v - min) / span) * (h - 2) - 1
      return `${x},${y}`
    })
    .join(' ')
  const up = series[series.length - 1] >= series[0]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: 88, height: 24 }}>
      <polyline fill="none" stroke={up ? '#22c55e' : '#ef4444'} strokeWidth="1.6" points={points} />
    </svg>
  )
}

const DONUT_COLORS = ['#22c55e', '#60a5fa', '#f59e0b', '#ef4444', '#14b8a6', '#a78bfa', '#eab308', '#f43f5e', '#38bdf8', '#4ade80']
const DONUT_MAX_SLICES = 10
const DONUT_LABEL_MIN_PCT = 2

function renderPieLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent, name } = props
  if (typeof percent === 'number' && percent * 100 < DONUT_LABEL_MIN_PCT) return null
  const labelName = asText(name)
  const RADIAN = Math.PI / 180
  const radius = outerRadius + 16
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  const anchor = x > cx ? 'start' : 'end'
  const pct = typeof percent === 'number' ? `${(percent * 100).toFixed(1)}%` : ''
  return (
    <text x={x} y={y} fill="#cbd5e1" textAnchor={anchor} dominantBaseline="central" fontSize={11}>
      {labelName} {pct}
    </text>
  )
}

function defaultVisibleMap(): Record<ColumnKey, boolean> {
  const map = {} as Record<ColumnKey, boolean>
  for (const c of COLUMNS) map[c.key] = c.defaultVisible
  return map
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
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filtered} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis yAxisId="left" domain={leftDomain} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" domain={rightDomain} tick={{ fill: '#f59e0b', fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="total" stroke="#22c55e" dot={false} name="Total" />
            <Line yAxisId="left" type="monotone" dataKey="in" stroke="#60a5fa" dot={false} name="In" />
            <Line yAxisId="left" type="monotone" dataKey="pl" stroke="#f97316" dot={false} name="P/L" />
            <Line yAxisId="right" type="monotone" dataKey="pl_pct" stroke="#eab308" dot={false} name="P/L(%)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function MyPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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
  const [visibleMap, setVisibleMap] = useState<Record<ColumnKey, boolean>>(defaultVisibleMap())
  const [sortKey, setSortKey] = useState<ColumnKey>('change_pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [rsiFilter, setRsiFilter] = useState<'all' | 'overbought' | 'oversold'>('all')
  const [sparklineMap, setSparklineMap] = useState<Record<string, number[]>>({})
  const sparklinePending = useRef<Set<string>>(new Set())
  const [credsStatus, setCredsStatus] = useState<{ configured: boolean; source: string } | null>(null)
  const [saJsonInput, setSaJsonInput] = useState('')
  const [credsLoading, setCredsLoading] = useState(false)
  const [credsOpen, setCredsOpen] = useState(false)
  const [portfolioNarrative, setPortfolioNarrative] = useState<StructuredNarrative | null>(null)

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

  const FALLBACK_SA_EMAIL = 'boss9293@gmail.com'

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
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage('Google credentials saved.')
        setSaJsonInput('')
        setCredsOpen(false)
        await fetchCredsStatus()
      } else {
        setMessage(json?.error || 'Failed to save credentials.')
      }
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

  const filteredSortedRows = useMemo(() => {
    let rows = [...(data.positions || [])]
    if (rsiFilter === 'overbought') {
      rows = rows.filter((r) => typeof r.rsi === 'number' && r.rsi >= 70)
    } else if (rsiFilter === 'oversold') {
      rows = rows.filter((r) => typeof r.rsi === 'number' && r.rsi <= 30)
    }

    const getVal = (row: HoldingPosition, key: ColumnKey): number | string => {
      if (key === 'symbol') return String(row.symbol || '')
      if (key === 'note') return String(row.note || '')
      if (key === 'sparkline_30') return Array.isArray(row.sparkline_30) ? row.sparkline_30.length : 0
      const num = row[key] as number | null | undefined
      return typeof num === 'number' ? num : Number.NEGATIVE_INFINITY
    }

    rows.sort((a, b) => {
      const av = getVal(a, sortKey)
      const bv = getVal(b, sortKey)
      let cmp = 0
      if (typeof av === 'string' || typeof bv === 'string') {
        cmp = String(av).localeCompare(String(bv))
      } else {
        cmp = av === bv ? 0 : av > bv ? 1 : -1
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [data.positions, rsiFilter, sortDir, sortKey])

  const summary = data.summary || {}
  const totalEquity = typeof summary.total_equity === 'number' ? summary.total_equity : 0

  const tsGoalHistory = tsData?.goal?.history || []
  const tsRerun = tsData?.rerun_hint

  const positionsByTab = data.positions_by_tab || {}
  const positionTabs = Object.keys(positionsByTab)
  useEffect(() => {
    if (positionTabs.length && (!activePositionsTab || !positionsByTab[activePositionsTab])) {
      setActivePositionsTab(positionTabs[0])
    }
  }, [positionTabs.join('|'), activePositionsTab])
  const activePositionsRows = positionsByTab[activePositionsTab] || []
  const activePositionsColumns = useMemo(() => {
    const raw =
      data.positions_columns_by_tab?.[activePositionsTab] || deriveColumnsFromRows(activePositionsRows)
    return (raw || []).map((c) => asText(c)).filter((c) => c)
  }, [data.positions_columns_by_tab, activePositionsTab, activePositionsRows])

  const symbolColumnKey = useMemo(() => {
    const candidates = ['\uC885\uBAA9', 'symbol', 'Symbol', '\uD2F0\uCEE4', 'Ticker']
    for (const c of candidates) {
      if (activePositionsColumns.includes(c)) return c
    }
    for (const row of activePositionsRows) {
      for (const c of candidates) {
        if (row?.[c]) return c
      }
    }
    return ''
  }, [activePositionsColumns, activePositionsRows])

  const positionsColumnsView = useMemo(() => {
    const cols = [...activePositionsColumns]
    if (!symbolColumnKey) return cols
    if (cols.includes('__sparkline')) return cols
    const idx = cols.indexOf(symbolColumnKey)
    if (idx >= 0) {
      cols.splice(idx, 0, '__sparkline')
    } else {
      cols.unshift('__sparkline')
    }
    return cols
  }, [activePositionsColumns, symbolColumnKey])

  useEffect(() => {
    if (!symbolColumnKey || activePositionsRows.length === 0) return
    const symbols = activePositionsRows
      .map((row) => String(row?.[symbolColumnKey] || '').trim())
      .filter((s) => s)
    const unique = Array.from(new Set(symbols)).slice(0, 12)
    unique.forEach((sym) => {
      if (sparklineMap[sym] || sparklinePending.current.has(sym)) return
      sparklinePending.current.add(sym)
      fetch(`${API_BASE}/api/chart/${encodeURIComponent(sym)}?days=30`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((json) => {
          const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
          const values = rows
            .map((row: any) => (typeof row?.close === 'number' ? row.close : parseLooseNumber(row?.close)))
            .filter((v: number | null): v is number => typeof v === 'number' && !Number.isNaN(v))
          setSparklineMap((prev) => ({ ...prev, [sym]: values }))
        })
        .catch(() => {})
        .finally(() => {
          sparklinePending.current.delete(sym)
        })
    })
  }, [activePositionsRows, symbolColumnKey])

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
    const valueKeys = ['\uD3C9\uAC00\uC561', 'equity', 'Equity', 'market_value', 'value', '\uC2DC\uC7A5\uAC00\uCE58', '\uD3C9\uAC00\uAE08\uC561']
    const avgKeys = ['\uD3C9\uB2E8\uAC00', 'avg_cost', 'Avg Cost', '\uD3C9\uADE0\uB2E8\uAC00', '\uB9E4\uC218\uAC00']

    const rows = activePositionsRows.length
      ? activePositionsRows
      : positionTabs.flatMap((t) => positionsByTab[t] || [])

    const data = rows
      .map((row) => {
        const symbol = getFirstString(row, symbolKeys)
        const equity = getFirstNumber(row, valueKeys)
        const avg = getFirstNumber(row, avgKeys)
        if (!symbol || (equity === null && avg === null)) return null
        return {
          symbol,
          equity: equity ?? 0,
          avg: avg ?? 0,
        }
      })
      .filter((r): r is { symbol: string; equity: number; avg: number } => !!r)

    return data.sort((a, b) => (b.equity || 0) - (a.equity || 0)).slice(0, 12)
  }, [activePositionsRows, positionTabs.join('|')])

  const donutRows = useMemo(() => {
    if (activePositionsRows.length) {
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

      const hasPct = entries.some((e) => typeof e.pct === 'number' && e.pct > 0)
      let rows = []
      if (hasPct) {
        rows = entries
          .map((e) => ({ symbol: e.symbol, pct: Math.max(0, e.pct || 0) }))
          .filter((x) => x.pct > 0)
      } else {
        const total = entries.reduce((sum, e) => sum + (e.equity || 0), 0)
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
    }

    const rows = filteredSortedRows
      .map((r) => {
        const symbol = asText(r.symbol)
        const pct =
          typeof r.position_pct === 'number'
            ? r.position_pct
            : totalEquity > 0 && typeof r.equity === 'number'
            ? (r.equity / totalEquity) * 100
            : 0
        return { symbol, pct: Math.max(0, pct) }
      })
      .filter((x) => x.symbol && x.pct > 0)
      .sort((a, b) => b.pct - a.pct)

    if (rows.length > 0) {
      if (rows.length <= DONUT_MAX_SLICES) return rows
      const head = rows.slice(0, DONUT_MAX_SLICES - 1)
      const rest = rows.slice(DONUT_MAX_SLICES - 1)
      const restPct = rest.reduce((sum, r) => sum + r.pct, 0)
      if (restPct > 0) head.push({ symbol: 'Others', pct: restPct })
      return head
    }

    const sourceRows = positionTabs.flatMap((t) => positionsByTab[t] || [])
    const bySymbol = new Map<string, number>()
    for (const row of sourceRows) {
      const sym = getFirstString(row, ['symbol', 'Symbol', '\uC885\uBAA9', '\uD2F0\uCEE4', 'Ticker'])
      const val = getFirstNumber(row, ['equity', 'Equity', '\uD3C9\uAC00\uC561', '\uC2DC\uC7A5\uAC00\uCE58', 'value', 'market_value'])
      if (!sym || typeof val !== 'number' || val <= 0) continue
      bySymbol.set(sym, (bySymbol.get(sym) || 0) + val)
    }

    const total = Array.from(bySymbol.values()).reduce((a, b) => a + b, 0)
    if (total <= 0) return []
    const merged = Array.from(bySymbol.entries())
      .map(([symbol, value]) => ({ symbol, pct: (value / total) * 100 }))
      .filter((x) => x.pct > 0)
      .sort((a, b) => b.pct - a.pct)
    if (merged.length <= DONUT_MAX_SLICES) return merged
    const head = merged.slice(0, DONUT_MAX_SLICES - 1)
    const rest = merged.slice(DONUT_MAX_SLICES - 1)
    const restPct = rest.reduce((sum, r) => sum + r.pct, 0)
    if (restPct > 0) head.push({ symbol: 'Others', pct: restPct })
    return head
  }, [filteredSortedRows, totalEquity, activePositionsRows, positionTabs.join('|')])

  const donutBg = useMemo(() => {
    const top = donutRows.slice(0, 10)
    if (!top.length) return 'conic-gradient(#374151 0% 100%)'
    const colors = ['#22c55e', '#60a5fa', '#f59e0b', '#ef4444', '#14b8a6', '#a78bfa', '#eab308', '#f43f5e', '#38bdf8', '#4ade80']
    let acc = 0
    const chunks = top.map((row, i) => {
      const start = acc
      acc += row.pct
      return `${colors[i % colors.length]} ${start}% ${Math.min(acc, 100)}%`
    })
    if (acc < 100) chunks.push(`#334155 ${acc}% 100%`)
    return `conic-gradient(${chunks.join(', ')})`
  }, [donutRows])

  const visibleColumns = COLUMNS.filter((c) => visibleMap[c.key])

  function toggleColumn(key: ColumnKey) {
    setVisibleMap((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function selectSort(key: ColumnKey, direction: 'asc' | 'desc') {
    setSortKey(key)
    setSortDir(direction)
  }

  function renderCell(row: HoldingPosition, col: ColumnDef) {
    if (col.key === 'symbol') return <span style={{ color: '#f3f4f6', fontWeight: 700 }}>{asText(row.symbol) || '-'}</span>
    if (col.key === 'note') return <span style={{ color: '#c7cede' }}>{asText(row.note) || '-'}</span>
    if (col.key === 'sparkline_30') return <Sparkline values={row.sparkline_30} />
    const value = row[col.key] as number | null | undefined
    if (col.kind === 'money') return <span style={{ color: '#d1d5db' }}>{fmtMoney(value)}</span>
    if (col.kind === 'pct') {
      const color = typeof value === 'number' ? (value >= 0 ? '#22c55e' : '#ef4444') : '#9ca3af'
      return <span style={{ color }}>{fmtPct(value)}</span>
    }
    if (col.kind === 'num') return <span style={{ color: '#d1d5db' }}>{fmtNum(value, col.key === 'shares' ? 4 : 2)}</span>
    return <span style={{ color: '#d1d5db' }}>{asText(value ?? '-')}</span>
  }

  const topWeight = donutRows[0]
  const snapshotNormalized = (data.snapshot_summary && typeof data.snapshot_summary === 'object' ? data.snapshot_summary.normalized : null) as
    | Record<string, number | string | null | undefined>
    | null
  const snapshotRawRows = (data.snapshot_summary && typeof data.snapshot_summary === 'object' && Array.isArray(data.snapshot_summary.raw)
    ? data.snapshot_summary.raw
    : []) as Array<{ label?: string; value?: string }>
  const snapshotNum = (key: string): number | null => {
    if (!snapshotNormalized) return null
    const v = snapshotNormalized[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = Number(String(v).replace(/[,%$,\s]/g, ''))
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  const top3WeightPct = donutRows.slice(0, 3).reduce((sum, r) => sum + (Number.isFinite(r.pct) ? r.pct : 0), 0)
  const cashRatioPct =
    (() => {
      const cashBase = snapshotNum('cash')
      const equityBase = snapshotNum('account_total') ?? snapshotNum('total_equity') ?? (typeof summary.total_equity === 'number' ? summary.total_equity : null)
      const cashVal = cashBase ?? (typeof summary.cash === 'number' ? summary.cash : null)
      return typeof cashVal === 'number' && typeof equityBase === 'number' && equityBase > 0 ? (cashVal / equityBase) * 100 : null
    })()
  const concentrationTone =
    top3WeightPct >= 65 ? 'high' : top3WeightPct >= 45 ? 'mid' : 'low'
  const diversificationText =
    concentrationTone === 'high'
      ? '상위 종목 집중도가 높아 개별 종목 변동 영향이 큽니다.'
      : concentrationTone === 'mid'
        ? '집중도는 중간 수준이며 상위 종목 흐름이 성과를 좌우합니다.'
        : '비중이 비교적 분산되어 개별 종목 충격 완화에 유리합니다.'
  const pnlTone = typeof summary.total_pnl_pct === 'number' ? (summary.total_pnl_pct >= 0 ? 'plus' : 'minus') : 'na'
  const todayPnlValue =
    typeof snapshotNum('today_pnl') === 'number'
      ? (snapshotNum('today_pnl') as number)
      : typeof summary.today_pnl === 'number'
        ? summary.today_pnl
      : activePositionsRows.reduce((sum, row) => sum + (typeof row.pnl_today === 'number' ? row.pnl_today : 0), 0)
  const todayPnlPct =
    typeof snapshotNum('today_pnl_pct') === 'number'
      ? (snapshotNum('today_pnl_pct') as number)
      : typeof todayPnlValue === 'number' &&
    Number.isFinite(todayPnlValue) &&
    typeof summary.total_equity === 'number' &&
    Number.isFinite(summary.total_equity) &&
    summary.total_equity - todayPnlValue > 0
      ? (todayPnlValue / (summary.total_equity - todayPnlValue)) * 100
      : null
  const activeSymbolCount = Array.isArray(activePositionsRows)
    ? activePositionsRows.filter((r) => !!asText(r.symbol)).length
    : 0

  useEffect(() => {
    if (loading) return

    const controller = new AbortController()
    let active = true
    setPortfolioNarrative(null)

    const fallbackPayload = {
      summary: concentrationTone === 'high' ? 'Overexposed' : concentrationTone === 'mid' ? 'Aligned' : 'Defensive',
      structure: diversificationText,
      risk: topWeight
        ? `Risk is concentrated in ${topWeight.symbol} at ${topWeight.pct.toFixed(1)}%.`
        : 'Risk concentration is not available.',
      alignment:
        typeof cashRatioPct === 'number'
          ? `Cash buffer is ${cashRatioPct.toFixed(1)}%.`
          : 'Cash buffer is not available.',
      action:
        concentrationTone === 'high'
          ? 'Reduce the largest concentration first and keep sizing tight.'
          : concentrationTone === 'mid'
            ? 'Keep the current structure under MSS + Track and watch concentration.'
            : 'Maintain the defensive tilt and avoid adding leverage too early.',
      tqqq:
        pnlTone === 'plus'
          ? 'TQQQ remains a separate leverage decision from the core stock basket.'
          : 'TQQQ should stay separate from the core basket until structure improves.',
    }

    const loadPortfolioNarrative = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/narrative/portfolio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            portfolio_data: data,
            engine_data: {
              as_of_date: data.as_of_date,
              total_equity: summary.total_equity,
              total_cost: summary.total_cost,
              total_pnl: summary.total_pnl,
              total_pnl_pct: summary.total_pnl_pct,
              cash: summary.cash,
              cash_ratio_pct: cashRatioPct,
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
      } catch {
        if (!active) return
        setPortfolioNarrative(mapPortfolioNarrative(fallbackPayload))
      }
    }

    void loadPortfolioNarrative()
    return () => {
      active = false
      controller.abort()
    }
  }, [
    API_BASE,
    cashRatioPct,
    concentrationTone,
    data,
    diversificationText,
    loading,
    pnlTone,
    summary.cash,
    summary.total_cost,
    summary.total_equity,
    summary.total_pnl,
    summary.total_pnl_pct,
    top3WeightPct,
    topWeight?.pct,
    topWeight?.symbol,
  ])

  const resolvedPortfolioNarrative = useMemo(
    () =>
      portfolioNarrative ??
      mapPortfolioNarrative({
        summary: concentrationTone === 'high' ? 'Overexposed' : concentrationTone === 'mid' ? 'Aligned' : 'Defensive',
        structure: diversificationText,
        risk: topWeight
          ? `Risk is concentrated in ${topWeight.symbol} at ${topWeight.pct.toFixed(1)}%.`
          : 'Risk concentration is not available.',
        alignment:
          typeof cashRatioPct === 'number'
            ? `Cash buffer is ${cashRatioPct.toFixed(1)}%.`
            : 'Cash buffer is not available.',
        action:
          concentrationTone === 'high'
            ? 'Reduce the largest concentration first and keep sizing tight.'
            : concentrationTone === 'mid'
              ? 'Keep the current structure under MSS + Track and watch concentration.'
              : 'Maintain the defensive tilt and avoid adding leverage too early.',
        tqqq:
          pnlTone === 'plus'
            ? 'TQQQ remains a separate leverage decision from the core stock basket.'
            : 'TQQQ should stay separate from the core basket until structure improves.',
      }),
    [cashRatioPct, concentrationTone, diversificationText, pnlTone, portfolioNarrative, topWeight],
  )

  const snapshotExtraRows = useMemo(() => {
    const duplicateKeys = [
      '평가액',
      '매수액',
      '매수원금',
      '계좌수익률',
      '현금잔고',
      '현금 비중',
      '금일수익',
      '금일 변동',
      '금일변동',
      '보유 종목수',
    ]
    const filtered = snapshotRawRows.filter((r) => {
      const label = asText(r.label)
      if (!label) return false
      return !duplicateKeys.some((d) => label.includes(d))
    })
    if (filtered.length > 0) return filtered.slice(0, 4)
    return [
      { label: 'Top1 비중', value: topWeight ? `${topWeight.symbol} ${topWeight.pct.toFixed(1)}%` : '-' },
      { label: 'Top3 비중', value: donutRows.length ? `${top3WeightPct.toFixed(1)}%` : '-' },
      { label: '집중도', value: concentrationTone === 'high' ? '집중 높음' : concentrationTone === 'mid' ? '집중 중간' : '분산 양호' },
      { label: '현금 비중', value: typeof cashRatioPct === 'number' ? `${cashRatioPct.toFixed(1)}%` : '-' },
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
          <div style={{ color: '#dce9f8', fontWeight: 800, fontSize: '0.9rem' }}>오늘의 포트폴리오 요약</div>
          <div style={{ color: '#b9c9dd', fontSize: '0.72rem' }}>Portfolio Snapshot</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8, marginTop: 2 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.45rem 0.55rem' }}>
              <div style={{ color: '#b9c9dd', fontSize: '0.68rem' }}>금일 손익</div>
              <div style={{ color: todayPnlValue >= 0 ? '#34d399' : '#f87171', fontWeight: 800, fontSize: '0.92rem', marginTop: 2 }}>
                {fmtMoney(todayPnlValue)}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.45rem 0.55rem' }}>
              <div style={{ color: '#b9c9dd', fontSize: '0.68rem' }}>금일 변동</div>
              <div style={{ color: typeof todayPnlPct === 'number' ? (todayPnlPct >= 0 ? '#34d399' : '#f87171') : '#dce9f8', fontWeight: 800, fontSize: '0.92rem', marginTop: 2 }}>
                {typeof todayPnlPct === 'number' ? fmtPct(todayPnlPct) : '-'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8, borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: 10 }}>
          {snapshotExtraRows.map((item, idx) => (
            <div key={`${asText(item.label)}-${idx}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.45rem 0.55rem' }}>
              <div style={{ color: '#b9c9dd', fontSize: '0.68rem' }}>{asText(item.label) || '-'}</div>
              <div style={{ color: '#dce9f8', fontWeight: 800, fontSize: '0.88rem', marginTop: 2 }}>{asText(item.value) || '-'}</div>
            </div>
          ))}
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
            {diversificationText} {typeof cashRatioPct === 'number' ? `현금 ${cashRatioPct.toFixed(1)}%.` : ''}{' '}
            {typeof summary.total_pnl_pct === 'number' ? `누적 수익률 ${fmtPct(summary.total_pnl_pct)}.` : ''}
          </div>
          {resolvedPortfolioNarrative ? (
            <NarrativeBlocks data={resolvedPortfolioNarrative} density="compact" />
          ) : (
            <div style={{ color: '#8b93a8', fontSize: '0.78rem', lineHeight: 1.45 }}>
              Portfolio narrative is unavailable.
            </div>
          )}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {[
          { title: 'Total Equity', value: fmtMoney(summary.total_equity), color: '#f3f4f6' },
          { title: 'Total Cost', value: fmtMoney(summary.total_cost), color: '#9cdcfe' },
          { title: 'Total PnL', value: fmtMoney(summary.total_pnl), color: (summary.total_pnl || 0) >= 0 ? '#22c55e' : '#ef4444' },
          { title: 'PnL %', value: fmtPct(summary.total_pnl_pct), color: (summary.total_pnl_pct || 0) >= 0 ? '#22c55e' : '#ef4444' },
          { title: 'MDD (Port)', value: fmtPct(summary.mdd_portfolio_pct), color: '#f59e0b' },
          { title: 'Cash %', value: typeof cashRatioPct === 'number' ? `${cashRatioPct.toFixed(1)}%` : '-', color: '#93c5fd' },
        ].map((kpi) => (
          <div key={kpi.title} style={panelStyle()}>
            <div style={{ color: '#9ca3af', fontSize: '0.72rem', marginBottom: 6 }}>{kpi.title}</div>
            <div style={{ color: kpi.color, fontWeight: 800, fontSize: '1.03rem' }}>{kpi.value}</div>
          </div>
        ))}
      </section>

      <section style={{ ...panelStyle(), display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: '#d1d5db', fontWeight: 700, minWidth: 120 }}>Position Charts</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ flex: 1.7, minWidth: 260 }}>
            <div style={{ color: '#b9c9dd', fontSize: '0.72rem', marginBottom: 5 }}>Portfolio vs Avg Cost</div>
            {positionBars.length === 0 ? (
              <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No position values.</div>
            ) : (
              <div style={{ width: '100%', height: 205 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={positionBars} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis dataKey="symbol" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                      <Bar dataKey="equity" name="Portfolio" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="avg" name="Avg Cost" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div style={{ flex: 0.95, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#b9c9dd', fontSize: '0.72rem', minWidth: 120 }}>Weights Donut</div>
            {donutRows.length === 0 ? (
              <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No position weights.</div>
            ) : (
              <div style={{ width: '100%', height: 205 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutRows}
                      dataKey="pct"
                      nameKey="symbol"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={1}
                      labelLine={false}
                      label={renderPieLabel}
                    >
                      {donutRows.map((entry, index) => (
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
              <div style={{ color: '#b9c9dd', fontSize: '0.72rem', marginTop: 2 }}>Portfolio Read</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
              <div style={{ padding: '0.45rem 0.55rem', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#b9c9dd', fontSize: '0.68rem' }}>Top Holding</div>
                <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '0.95rem', marginTop: 2 }}>
                  {topWeight ? topWeight.symbol : '-'}
                </div>
                <div style={{ color: '#8fe8ff', fontSize: '0.72rem', marginTop: 2 }}>
                  {topWeight ? `${topWeight.pct.toFixed(1)}%` : '—'}
                </div>
              </div>
              <div style={{ padding: '0.45rem 0.55rem', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#b9c9dd', fontSize: '0.68rem' }}>Top 3 Weight</div>
                <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '0.95rem', marginTop: 2 }}>
                  {donutRows.length ? `${top3WeightPct.toFixed(1)}%` : '-'}
                </div>
                <div style={{ color: concentrationTone === 'high' ? '#f59e0b' : concentrationTone === 'mid' ? '#93c5fd' : '#34d399', fontSize: '0.72rem', marginTop: 2 }}>
                  {concentrationTone === 'high' ? '집중 높음' : concentrationTone === 'mid' ? '집중 중간' : '분산 양호'}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ color: '#dce9f8', fontSize: '0.79rem', lineHeight: 1.45 }}>
                {diversificationText}
              </div>
              <div style={{ color: '#dce9f8', fontSize: '0.79rem', lineHeight: 1.45 }}>
                {typeof cashRatioPct === 'number'
                  ? `현금 비중은 약 ${cashRatioPct.toFixed(1)}%로 ${cashRatioPct >= 15 ? '완충 여력이 있는 편입니다.' : '완충 여력이 크지 않을 수 있습니다.'}`
                  : '현금 비중 데이터가 없어 완충 여력 평가는 제한됩니다.'}
              </div>
              <div style={{ color: pnlTone === 'plus' ? '#34d399' : pnlTone === 'minus' ? '#f87171' : '#b9c9dd', fontSize: '0.79rem', lineHeight: 1.45 }}>
                {typeof summary.total_pnl_pct === 'number'
                  ? `누적 성과는 ${fmtPct(summary.total_pnl_pct)} 수준이며, 상위 비중 종목의 변동이 체감 수익률에 크게 반영됩니다.`
                  : '누적 성과 데이터가 충분하지 않아 성과 해석은 제한됩니다.'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {positionTabs.length > 0 ? (
        <section style={panelStyle()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ color: '#e5e7eb', fontWeight: 700 }}>Positions (Sheet)</div>
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
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
          <div style={{ overflowX: 'auto' }}>
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
                        if (col === '__sparkline') {
                          const sym = symbolColumnKey ? String(row?.[symbolColumnKey] || '').trim() : ''
                          const values = sym ? sparklineMap[sym] : undefined
                          return (
                            <td
                              key={`${activePositionsTab}-${idx}-${col}`}
                              style={{ padding: '0.42rem 0.3rem', textAlign: 'left', whiteSpace: 'nowrap' }}
                            >
                              <Sparkline values={values} />
                            </td>
                          )
                        }
                        return (
                          <td
                            key={`${activePositionsTab}-${idx}-${col}`}
                            style={{
                              padding: '0.42rem 0.3rem',
                              textAlign: 'left',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {asText(row?.[col]) || '-'}
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
            <div style={{ color: '#e5e7eb', fontWeight: 800, fontSize: '1.1rem' }}>Account History (Cumulative)</div>
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
          {tsLoading ? <div style={{ color: '#9ca3af' }}>Loading history...</div> : <AccountHistoryChart history={tsGoalHistory} />}
        </div>
        {tsRerun ? <div style={{ color: '#8b93a8', fontSize: '0.75rem' }}>rerun: {tsRerun}</div> : null}
      </section>

      <section style={panelStyle()}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            onClick={() => selectSort('change_pct', 'desc')}
            style={{ border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)', color: '#86efac', borderRadius: 8, padding: '0.25rem 0.55rem', fontSize: '0.74rem', cursor: 'pointer' }}
          >
              rise (change% desc)
          </button>
          <button
            onClick={() => selectSort('volume_k', 'desc')}
            style={{ border: '1px solid rgba(59,130,246,0.35)', background: 'rgba(59,130,246,0.12)', color: '#93c5fd', borderRadius: 8, padding: '0.25rem 0.55rem', fontSize: '0.74rem', cursor: 'pointer' }}
          >
              volume (volume_k desc)
          </button>
          <button
            onClick={() => selectSort('rsi', 'desc')}
            style={{ border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.12)', color: '#fcd34d', borderRadius: 8, padding: '0.25rem 0.55rem', fontSize: '0.74rem', cursor: 'pointer' }}
          >
            RSI (desc)
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['all', 'overbought', 'oversold'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setRsiFilter(mode)}
                style={{
                  border: mode === rsiFilter ? '1px solid rgba(0,217,255,0.45)' : '1px solid rgba(255,255,255,0.14)',
                  background: mode === rsiFilter ? 'rgba(0,217,255,0.14)' : 'rgba(255,255,255,0.04)',
                  color: mode === rsiFilter ? '#67e8f9' : '#9ca3af',
                  borderRadius: 8,
                  padding: '0.25rem 0.55rem',
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ color: '#cbd5e1', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>Columns (show/hide)</summary>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
            {COLUMNS.map((col) => (
              <label key={col.key} style={{ color: '#9ca3af', fontSize: '0.74rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!visibleMap[col.key]} onChange={() => toggleColumn(col.key)} />
                {col.label}
              </label>
            ))}
          </div>
        </details>

        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ color: '#9ca3af', fontSize: '0.82rem' }}>Loading holdings...</div>
          ) : filteredSortedRows.length === 0 ? (
            <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No positions to display.</div>
          ) : visibleColumns.length === 0 ? (
            <div style={{ color: '#8b93a8', fontSize: '0.82rem' }}>No visible columns selected.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: 960 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => {
                        if (sortKey === col.key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortKey(col.key)
                          setSortDir('desc')
                        }
                      }}
                      style={{
                        textAlign: col.kind === 'text' || col.kind === 'sparkline' ? 'left' : 'right',
                        padding: '0.45rem 0.3rem',
                        color: '#9ca3af',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}
                      {sortKey === col.key ? ` ${sortDir === 'desc' ? 'v' : '^'}` : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSortedRows.map((row, idx) => (
                  <tr key={`${row.symbol}-${idx}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {visibleColumns.map((col) => (
                      <td
                        key={`${row.symbol}-${idx}-${col.key}`}
                        style={{
                          padding: '0.42rem 0.3rem',
                          textAlign: col.kind === 'text' || col.kind === 'sparkline' ? 'left' : 'right',
                          whiteSpace: col.key === 'note' ? 'normal' : 'nowrap',
                        }}
                      >
                        {renderCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}





