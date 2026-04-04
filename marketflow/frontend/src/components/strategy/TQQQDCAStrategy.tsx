'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  ComposedChart, AreaChart,
  Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, Scatter,
} from 'recharts'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface SymbolInfo {
  symbol: string
  name: string
  category: string
  category_label?: string
  subcategory?: string
  strategy_tier?: string
  direction?: string
  leverage_factor?: number | null
  priority?: number
  source?: string
  has_data?: number
  ohlcv_rows?: number
}

interface Params {
  ticker: string
  buy_frequency: 'Daily' | 'Weekly' | 'One Time'
  buy_day: string
  buy_type: 'amount' | 'quantity'
  buy_amount: number
  buy_quantity: number
  initial_capital: number
  start_date: string
  end_date: string
  use_take_profit: boolean; take_profit_pct: number
  use_stop_loss: boolean;   stop_loss_pct: number
  use_partial_sell: boolean; sell_ratio_pct: number
  use_rsi_buy: boolean;  rsi_buy_level: number;  rsi_length: number
  use_rsi_sell: boolean; rsi_sell_level: number
  use_macd_buy: boolean; use_macd_sell: boolean
  macd_fast: number; macd_slow: number; macd_signal: number
  use_ma_buy: boolean;     ma_buy_len: number;     ma_buy_pct: number
  use_ma_dip_buy: boolean; ma_dip_steps: { len: number; pct: number }[]
  use_ma_sell: boolean;    ma_sell_len: number;    ma_sell_pct: number
  use_v_buy: boolean; v_buy_ma_len: number; v_buy_drop_pct: number; v_buy_pct: number
}

interface Summary {
  ticker: string
  period: { start: string; end: string; days: number }
  initial_capital: number
  total_invested: number; final_value: number; total_return_pct: number
  cagr_pct: number; mdd_pct: number; realized_pnl: number
  unrealized_pnl: number; cash_realized: number; pool_balance: number
  buy_count: number; sell_count: number
  bh: {
    total_invested: number; final_value: number; total_return_pct: number
    cagr_pct: number; mdd_pct: number; pool_balance: number
  }
  generated: string
}
interface EquityPoint {
  d: string; close: number; current_value: number; cash_realized: number; pool_balance: number; total_value: number
  invested_cost: number; total_shares: number; profit_pct: number
  total_cost: number; bh_value: number; ma50: number | null; ma200: number | null
}
interface DdPoint { d: string; dd: number; bh_dd: number }
interface Signal {
  d: string
  type: 'buy' | 'sell'
  price: number
  shares: number
  amount: number
  current_value: number
  invested_cost: number
  total_cost: number
  reason: string
  pnl?: number
}
interface BacktestResult { summary: Summary; equity_curve: EquityPoint[]; dd_curve: DdPoint[]; signals: Signal[] }

/* ─── Defaults ──────────────────────────────────────────────────────────── */
const DEFAULT_TICKERS = ['TQQQ', 'QQQ', 'SPY', 'SOXL', 'TECL']
const DEFAULTS: Params = {
  ticker: 'TQQQ',
  buy_frequency: 'Weekly', buy_day: 'Wednesday', buy_type: 'amount', buy_amount: 100, buy_quantity: 1,
  initial_capital: 10000,
  start_date: '2023-01-01', end_date: '',
  use_take_profit: true,  take_profit_pct: 20,
  use_stop_loss: true,    stop_loss_pct: -10,
  use_partial_sell: true, sell_ratio_pct: 10,
  use_rsi_buy: false,  rsi_buy_level: 30, rsi_length: 14,
  use_rsi_sell: false, rsi_sell_level: 70,
  use_macd_buy: false, use_macd_sell: false,
  macd_fast: 12, macd_slow: 26, macd_signal: 9,
  use_ma_buy: false,     ma_buy_len: 50,  ma_buy_pct: 10,
  use_ma_dip_buy: false, ma_dip_steps: [{ len: 50, pct: 10 }, { len: 20, pct: 15 }, { len: 10, pct: 20 }],
  use_ma_sell: false,    ma_sell_len: 200, ma_sell_pct: 10,
  use_v_buy: false, v_buy_ma_len: 10, v_buy_drop_pct: -5, v_buy_pct: 10,
}

/* ─── Style helpers ─────────────────────────────────────────────────────── */
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12, padding: '1rem 1.1rem',
}
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }
const lbl: React.CSSProperties = { color: '#9ca3af', fontSize: '0.8rem', width: 120, flexShrink: 0 }
const inp = (w?: number): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 7, color: '#f3f4f6', padding: '0.3rem 0.5rem', fontSize: '0.82rem',
  width: w ?? 90, outline: 'none',
})
const toggleBtn = (on: boolean): React.CSSProperties => ({
  cursor: 'pointer', padding: '0.25rem 0.65rem', borderRadius: 999, fontSize: '0.75rem',
  fontWeight: 700, border: 'none', transition: 'all 120ms',
  background: on ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.07)',
  color: on ? '#86efac' : '#6b7280',
})
const metaCard = (color: string): React.CSSProperties => ({
  background: `rgba(${color},0.07)`, border: `1px solid rgba(${color},0.18)`,
  borderRadius: 10, padding: '0.7rem 0.9rem', flex: 1, minWidth: 110,
})

/* ─── Tooltip ───────────────────────────────────────────────────────────── */
function ChartTip({ active, payload, label: lbl2 }: any) {
  if (!active || !payload?.length) return null
  const labelText = formatTooltipDate(lbl2)
  return (
    <div style={{ background: 'rgba(15,20,30,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.78rem' }}>
      <div style={{ color: '#9ca3af', marginBottom: 4 }}>{labelText}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}</span>
          <span style={{ color: '#f3f4f6', fontWeight: 600 }}>
            {typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function triangleShape(fill: string, direction: 'up' | 'down') {
  return function Triangle({ cx, cy }: any) {
    if (cx == null || cy == null) return <g />
    const points = direction === 'up'
      ? `${cx},${cy - 8} ${cx - 5},${cy + 3} ${cx + 5},${cy + 3}`
      : `${cx},${cy + 8} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`
    return <polygon points={points} fill={fill} opacity={0.88} />
  }
}

function dateToTs(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function formatTsDate(ts: number) {
  return new Date(ts).toISOString().slice(2, 10)
}

function formatTooltipDate(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10)
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return new Date(Number(value)).toISOString().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  }
  return String(value)
}

/* ─── Ticker Picker ─────────────────────────────────────────────────────── */
function TickerPicker({
  activeTicker,
  pinnedTickers,
  onSelect,
  onAdd,
  onRemove,
}: {
  activeTicker: string
  pinnedTickers: string[]
  onSelect: (t: string) => void
  onAdd: (t: string) => void
  onRemove: (t: string) => void
}) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<SymbolInfo[]>([])
  const [loading, setLoading]   = useState(false)
  const [showDrop, setShowDrop] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [catSymbols, setCatSymbols]         = useState<SymbolInfo[]>([])
  const [catLoading, setCatLoading]         = useState(false)

  useEffect(() => {
    if (!query || query.length < 1) { setResults([]); setShowDrop(false); return }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`${API}/api/strategy/symbols?q=${encodeURIComponent(query)}&limit=20`)
        const data = await r.json()
        setResults(Array.isArray(data?.symbols) ? data.symbols.slice(0, 12) : [])
        setShowDrop(true)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 280)
  }, [query])

  useEffect(() => {
    if (!activeCategory) { setCatSymbols([]); return }
    setCatLoading(true)
    fetch(`${API}/api/etf/catalog?category=${activeCategory}&limit=120`)
      .then(r => r.json())
      .then(d => setCatSymbols(Array.isArray(d?.symbols) ? d.symbols : []))
      .catch(() => setCatSymbols([]))
      .finally(() => setCatLoading(false))
  }, [activeCategory])

  const pick = (sym: string) => {
    onAdd(sym)
    onSelect(sym)
    setQuery('')
    setResults([])
    setShowDrop(false)
  }

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      {/* Section title */}
      <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: '0.5rem', letterSpacing: '0.06em' }}>
        종목 선택
      </div>

      {/* Category filter tabs */}
      {(() => {
        const CATS: { key: string; label: string }[] = [
          { key: 'leverage',     label: '레버리지' },
          { key: 'index',        label: '지수' },
          { key: 'sector',       label: '섹터' },
          { key: 'reverse',      label: '인버스' },
          { key: 'dividend',     label: '배당' },
          { key: 'crypto',       label: '코인' },
          { key: 'ark',          label: 'ARK' },
        ]
        return (
          <div style={{ marginBottom: '0.55rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.4rem' }}>
              {CATS.map(c => {
                const active = activeCategory === c.key
                return (
                  <button key={c.key}
                    onClick={() => setActiveCategory(active ? null : c.key)}
                    style={{
                      padding: '0.2rem 0.55rem', borderRadius: 999, fontSize: '0.72rem',
                      border: `1px solid ${active ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.1)'}`,
                      background: active ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                      color: active ? '#a5b4fc' : '#6b7280', cursor: 'pointer',
                      transition: 'all 120ms',
                    }}
                  >{c.label}</button>
                )
              })}
            </div>
            {activeCategory && (
              <div style={{
                background: 'rgba(10,14,24,0.95)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8, padding: '0.5rem', maxHeight: 180, overflowY: 'auto',
                marginBottom: '0.4rem',
              }}>
                {catLoading ? (
                  <div style={{ color: '#4b5563', fontSize: '0.76rem', padding: '0.3rem' }}>로딩…</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {catSymbols.map(s => (
                      <button key={s.symbol}
                        onMouseDown={() => pick(s.symbol)}
                        title={s.name}
                        style={{
                          padding: '0.22rem 0.5rem', borderRadius: 6, fontSize: '0.76rem',
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: s.symbol === activeTicker
                            ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.05)',
                          color: s.symbol === activeTicker ? '#fbbf24' : '#d1d5db',
                          cursor: 'pointer', fontWeight: s.symbol === activeTicker ? 700 : 400,
                          opacity: s.has_data ? 1 : 0.4,
                        }}
                      >
                        {s.symbol}
                        {s.leverage_factor ? (
                          <span style={{ color: '#6b7280', fontSize: '0.66rem', marginLeft: 2 }}>
                            {s.leverage_factor}x
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Pinned chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.55rem' }}>
        {pinnedTickers.map(t => {
          const isActive = t === activeTicker
          return (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button
                onClick={() => onSelect(t)}
                style={{
                  padding: '0.28rem 0.55rem', borderRadius: '6px 0 0 6px',
                  border: `1px solid ${isActive ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'}`,
                  borderRight: 'none',
                  background: isActive ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.05)',
                  color: isActive ? '#fbbf24' : '#9ca3af',
                  cursor: 'pointer', fontSize: '0.8rem', fontWeight: isActive ? 700 : 400,
                  transition: 'all 120ms',
                }}
              >
                {t}
              </button>
              {/* Remove button - only for non-default tickers */}
              {!DEFAULT_TICKERS.includes(t) && (
                <button
                  onClick={() => onRemove(t)}
                  style={{
                    padding: '0.28rem 0.38rem', borderRadius: '0 6px 6px 0',
                    border: `1px solid ${isActive ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'}`,
                    background: isActive ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                    color: '#4b5563', cursor: 'pointer', fontSize: '0.68rem',
                    transition: 'all 120ms',
                  }}
                  title="제거"
                >
                  ✕
                </button>
              )}
              {DEFAULT_TICKERS.includes(t) && (
                <div style={{
                  padding: '0.28rem 0.38rem', borderRadius: '0 6px 6px 0',
                  border: `1px solid ${isActive ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'}`,
                  borderLeft: 'none',
                  background: isActive ? 'rgba(245,158,11,0.08)' : 'transparent',
                  width: 1,
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8, padding: '0.35rem 0.6rem' }}>
          <span style={{ color: '#4b5563', fontSize: '0.8rem' }}>+</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            onFocus={() => query && setShowDrop(true)}
            onBlur={() => setTimeout(() => setShowDrop(false), 180)}
            placeholder="종목 추가 (예: AAPL)"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: '#f3f4f6', fontSize: '0.82rem', width: '100%',
            }}
          />
          {loading && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>…</span>}
        </div>

        {/* Dropdown */}
        {showDrop && results.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
            background: 'rgba(15,20,30,0.98)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, marginTop: 4, maxHeight: 280, overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            {results.map(r => (
              <button
                key={r.symbol}
                onMouseDown={() => pick(r.symbol)}
                style={{
                  width: '100%', textAlign: 'left', background: 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  padding: '0.5rem 0.75rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: '0.84rem', width: 56 }}>{r.symbol}</span>
                <span style={{ color: '#9ca3af', fontSize: '0.76rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
                <span style={{ color: '#6b7280', fontSize: '0.72rem', flexShrink: 0 }}>
                  {r.category_label || r.category || r.strategy_tier || 'universe'}
                </span>
              </button>
            ))}
          </div>
        )}
        {showDrop && results.length === 0 && !loading && query.length >= 1 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
            background: 'rgba(15,20,30,0.98)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, marginTop: 4, padding: '0.7rem 0.75rem',
            color: '#6b7280', fontSize: '0.8rem',
          }}>
            결과 없음: {query}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Main Component ────────────────────────────────────────────────────── */
export default function TQQQDCAStrategy() {
  const [params, setParams]   = useState<Params>(DEFAULTS)
  const [pinned, setPinned]   = useState<string[]>(DEFAULT_TICKERS)
  const [result, setResult]   = useState<BacktestResult | null>(null)
  const [viewTab, setViewTab] = useState<'results' | 'logic'>('results')
  const [tradeFilter, setTradeFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const set = useCallback(<K extends keyof Params>(k: K, v: Params[K]) => {
    setParams(p => ({ ...p, [k]: v }))
  }, [])

  const selectTicker = useCallback((t: string) => {
    setParams(p => ({ ...p, ticker: t }))
  }, [])

  const addTicker = useCallback((t: string) => {
    setPinned(prev => prev.includes(t) ? prev : [...prev, t])
  }, [])

  const removeTicker = useCallback((t: string) => {
    setPinned(prev => prev.filter(x => x !== t))
    setParams(p => p.ticker === t ? { ...p, ticker: pinned.find(x => x !== t) ?? 'TQQQ' } : p)
  }, [pinned])

  const run = useCallback(async () => {
    setLoading(true); setError(null); setViewTab('results')
    try {
      const body = { ...params, end_date: params.end_date || null }
      const r = await fetch(`${API}/api/backtests/tqqq-dca/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (data.error) { setError(data.error); return }
      setResult(data)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [params])

  const buySignals = result?.signals.filter(s => s.type === 'buy') ?? []
  const sellSignals = result?.signals.filter(s => s.type === 'sell') ?? []
  const tpSignals = sellSignals.filter(s => s.reason === 'TP')
  const slSignals = sellSignals.filter(s => s.reason === 'SL')
  const maSellSignals = sellSignals.filter(s => s.reason === 'MA_SELL')
  const signalSellSignals = sellSignals.filter(s => s.reason === 'SIGNAL')
  const buyDots = buySignals.map(s => s.d)
  const sellDots = sellSignals.map(s => s.d)
  const s = result?.summary
  const initialCapital = params.initial_capital || 0
  const poolCash = s?.pool_balance ?? initialCapital
  const latestEquity = result?.equity_curve?.length ? result.equity_curve[result.equity_curve.length - 1] : null
  const equityHighlights = latestEquity ? [
    { label: '전략', value: latestEquity.total_value, color: '#f59e0b', hint: '전략 누적자산' },
    { label: 'B&H', value: latestEquity.bh_value, color: '#6366f1', hint: '동일 기간 매수후보유' },
    { label: '보유원가', value: latestEquity.invested_cost, color: '#94a3b8', hint: '현재 남아있는 보유분 원가' },
  ] : []
  const signalBreakdown = [
    { label: '매수', count: buySignals.length, color: '#22c55e', active: true },
    { label: 'TP', count: tpSignals.length, color: '#fbbf24', active: params.use_take_profit },
    { label: 'SL', count: slSignals.length, color: '#ef4444', active: params.use_stop_loss },
    { label: 'MA 매도', count: maSellSignals.length, color: '#fb923c', active: params.use_ma_sell },
    { label: '신호매도', count: signalSellSignals.length, color: '#a78bfa', active: params.use_rsi_sell || params.use_macd_sell },
  ]
  const equityChartData = (result?.equity_curve ?? []).map(p => ({ ...p, ts: dateToTs(p.d) }))
  const buyChartData = buySignals.map(sig => ({ d: sig.d, ts: dateToTs(sig.d), price: sig.price }))
  const tpChartData = tpSignals.map(sig => ({ d: sig.d, ts: dateToTs(sig.d), price: sig.price }))
  const slChartData = slSignals.map(sig => ({ d: sig.d, ts: dateToTs(sig.d), price: sig.price }))
  const maSellChartData = maSellSignals.map(sig => ({ d: sig.d, ts: dateToTs(sig.d), price: sig.price }))
  const signalSellChartData = signalSellSignals.map(sig => ({ d: sig.d, ts: dateToTs(sig.d), price: sig.price }))
  const assetValues = equityChartData.flatMap(p => [p.total_value, p.bh_value]).filter(v => Number.isFinite(v))
  const assetMin = assetValues.length ? Math.min(...assetValues) : 0
  const assetMax = assetValues.length ? Math.max(...assetValues) : 0
  const assetPad = assetValues.length ? Math.max((assetMax - assetMin) * 0.08, 500) : 1000
  const assetDomain: [number, number] = [Math.max(0, assetMin - assetPad), assetMax + assetPad]
  const costValues = equityChartData.map(p => p.invested_cost).filter(v => Number.isFinite(v))
  const costMax = costValues.length ? Math.max(...costValues) : 0
  const costDomain: [number, number] = [0, costMax + Math.max(costMax * 0.2, 100)]
  const priceValues = [...buySignals, ...sellSignals].map(sig => sig.price).filter(v => Number.isFinite(v))
  const priceMin = priceValues.length ? Math.min(...priceValues) : 0
  const priceMax = priceValues.length ? Math.max(...priceValues) : 0
  const pricePad = priceValues.length ? Math.max((priceMax - priceMin) * 0.15, 2) : 5
  const priceDomain: [number, number] = [Math.max(0, priceMin - pricePad), priceMax + pricePad]
  const panelTabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '0.5rem 0.65rem',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: 700,
    transition: 'all 120ms',
    background: active ? 'rgba(245,158,11,0.16)' : 'rgba(255,255,255,0.04)',
    color: active ? '#fbbf24' : '#6b7280',
  })
  const logicSections = useMemo(() => [
    {
      title: '1. 익절 / 손절 기준',
      lines: [
        '익절·손절 판정은 계좌 전체 수익률이 아니라 현재 남아 있는 보유분의 평가수익률 기준입니다.',
        `익절: ${params.use_take_profit ? `ON / ${params.take_profit_pct}%` : 'OFF'}`,
        `손절: ${params.use_stop_loss ? `ON / ${params.stop_loss_pct}%` : 'OFF'}`,
      ],
    },
    {
      title: '2. 부분매도 로직',
      lines: [
        params.use_partial_sell
          ? `TP / SL / SIGNAL 발생 시 보유 수량의 ${params.sell_ratio_pct}%를 매도합니다.`
          : 'TP / SL / SIGNAL 발생 시 전량매도합니다.',
        '부분매도는 수익금 비중이 아니라 현재 보유 주식 수량 비중 기준입니다.',
        'MA 매도는 별도 설정값인 MA 매도 %를 사용합니다.',
      ],
    },
    {
      title: '3. Pool(현금잔고) 로직',
      lines: [
        '초기투입금은 백테스트 시작 시점의 전체 계좌 현금으로 사용됩니다.',
        '매수하면 Pool에서 차감되고, 매도하면 매도대금이 Pool로 다시 들어옵니다.',
        '총자산은 Pool + 현재 보유 평가금액으로 계산됩니다.',
        'Pool이 부족하면 남아 있는 현금 한도 안에서만 축소 매수됩니다.',
      ],
    },
    {
      title: '4. 재매수 로직',
      lines: [
        '전량매도 후 자동으로 다음날 강제 재매수하지는 않습니다.',
        '기존 매수 규칙(Daily / Weekly / One Time, RSI, MACD, MA 등)이 다시 충족될 때만 재진입합니다.',
        '쿨다운 없이 현재 조건식 그대로 다시 판단합니다.',
      ],
    },
    {
      title: '5. V자 회복매수',
      lines: [
        params.use_v_buy
          ? `현재 설정: MA200 아래 + 최근 3일 평균 등락률 ${params.v_buy_drop_pct}% 이상 + MA${params.v_buy_ma_len} 상향돌파 시 보유수량의 ${params.v_buy_pct}% 추가매수`
          : '현재 OFF 상태입니다. ON이면 MA200 아래에서 낙폭 둔화와 단기 MA 상향돌파가 동시에 나올 때 추가매수합니다.',
        '급락 구간에서 바로 추격매수하지 않고, 하락 둔화와 단기 회복 확인이 같이 나와야 발동합니다.',
      ],
    },
  ], [params])
  const logicSectionsDetail = logicSections.map((section, idx) => {
    if (idx !== 4) return section
    return {
      title: '5. V자 회복매수 원칙',
      lines: [
        params.use_v_buy ? '현재 상태: ON' : '현재 상태: OFF',
        `원칙 1 - 추세 필터: 종가가 MA200 아래일 때만 작동합니다. 상승 추세의 중간 눌림이 아니라, 하락 추세의 끝자락에서만 V자 회복을 찾습니다.`,
        `원칙 2 - 회복 확인: 최근 3일 평균 등락률이 ${params.v_buy_drop_pct}% 이상일 때만 작동합니다. 급락이 계속되는 구간은 제외하고, 하락 속도가 둔화된 뒤의 회복만 봅니다.`,
        `원칙 3 - 진입 트리거: 종가가 MA${params.v_buy_ma_len}를 아래에서 위로 상향 돌파해야 합니다. 단기 이동평균을 되찾는 순간에만 추가매수합니다.`,
        `매수 규모: 보유 수량이 있으면 현재 보유 수량의 ${params.v_buy_pct}%를 추가매수하고, 보유가 없으면 기본 DCA 금액 기준으로 1회 진입합니다.`,
      ],
    }
  })

  return (
    <div style={{ padding: '1.8rem 2rem 3rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 1400 }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800, color: '#f3f4f6' }}>
          전략 <span style={{ color: '#f59e0b' }}>시뮬레이션</span>
        </h1>
        <p style={{ color: '#6b7280', margin: '0.3rem 0 0', fontSize: '0.9rem' }}>
          DCA 백테스터 · TradingView Pine Script 포팅 · 일봉 종가 기준 · DB 533개 종목
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── Parameters Panel ─────────────────────────────────────────────── */}
        <div style={{ ...card, width: 320, flexShrink: 0 }}>
          <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.9rem', letterSpacing: '0.05em' }}>
            ⚙️ 파라미터
          </div>

          {/* ① Ticker Picker */}
          <TickerPicker
            activeTicker={params.ticker}
            pinnedTickers={pinned}
            onSelect={selectTicker}
            onAdd={addTicker}
            onRemove={removeTicker}
          />

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '0.4rem 0 0.8rem' }} />

          {/* Initial capital + Pool */}
          <div style={{ marginBottom: '0.8rem' }}>
            <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: '0.4rem', letterSpacing: '0.04em' }}>
              초기 투입금
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.45rem 0.55rem' }}>
                <div style={{ color: '#6b7280', fontSize: '0.72rem', marginBottom: 4 }}>Initial</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>$</span>
                  <input
                    type="number"
                    value={params.initial_capital}
                    min={0}
                    onChange={e => set('initial_capital', Math.max(0, +e.target.value))}
                    style={{ ...inp(90), width: '100%' }}
                  />
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.45rem 0.55rem' }}>
                <div style={{ color: '#6b7280', fontSize: '0.72rem', marginBottom: 4 }}>Pool</div>
                <div style={{ color: poolCash >= 0 ? '#f3f4f6' : '#ef4444', fontWeight: 700 }}>
                  ${poolCash.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
            <div style={{ color: '#4b5563', fontSize: '0.7rem', marginTop: 6 }}>
              매수 후 남은 현금 기준
            </div>
          </div>
          <div style={{ color: '#4b5563', fontSize: '0.7rem', marginBottom: '0.8rem' }}>
            백테스트 후에는 실제 남은 현금 Pool 기준으로 표시됩니다.
          </div>

          {/* Buy frequency */}
          <div style={row}>
            <span style={lbl}>매수 주기</span>
            <select value={params.buy_frequency} onChange={e => set('buy_frequency', e.target.value as Params['buy_frequency'])} style={inp(110)}>
              <option>Daily</option><option>Weekly</option><option>One Time</option>
            </select>
          </div>
          {params.buy_frequency === 'Weekly' && (
            <div style={row}>
              <span style={lbl}>매수 요일</span>
              <select value={params.buy_day} onChange={e => set('buy_day', e.target.value)} style={inp(110)}>
                {['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div style={row}>
            <span style={lbl}>매수</span>
            <button style={toggleBtn(params.buy_type === 'amount')} onClick={() => set('buy_type', 'amount')}>금액</button>
            <button style={toggleBtn(params.buy_type === 'quantity')} onClick={() => set('buy_type', 'quantity')}>수량</button>
            {params.buy_type === 'amount'
              ? <><span style={{ color: '#6b7280', fontSize: '0.78rem' }}>$</span><input type="number" value={params.buy_amount} min={1} onChange={e => set('buy_amount', +e.target.value)} style={inp(80)} /></>
              : <><input type="number" value={params.buy_quantity} min={0.001} step={0.1} onChange={e => set('buy_quantity', +e.target.value)} style={inp(80)} /><span style={{ color: '#6b7280', fontSize: '0.78rem' }}>주</span></>
            }
          </div>
          <div style={row}>
            <span style={lbl}>시작일</span>
            <input type="date" value={params.start_date} onChange={e => set('start_date', e.target.value)} style={inp(130)} />
          </div>
          <div style={row}>
            <span style={lbl}>종료일</span>
            <input type="date" value={params.end_date} onChange={e => set('end_date', e.target.value)} style={inp(130)} />
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '0.7rem 0' }} />

          {/* Take Profit */}
          <div style={row}>
            <span style={lbl}>익절</span>
            <button style={toggleBtn(params.use_take_profit)} onClick={() => set('use_take_profit', !params.use_take_profit)}>
              {params.use_take_profit ? 'ON' : 'OFF'}
            </button>
            {params.use_take_profit && (
              <><span style={{ color: '#6b7280', fontSize: '0.78rem' }}>%</span>
              <input type="number" value={params.take_profit_pct} onChange={e => set('take_profit_pct', +e.target.value)} style={inp(60)} /></>
            )}
          </div>
          <div style={row}>
            <span style={lbl}>손절</span>
            <button style={toggleBtn(params.use_stop_loss)} onClick={() => set('use_stop_loss', !params.use_stop_loss)}>
              {params.use_stop_loss ? 'ON' : 'OFF'}
            </button>
            {params.use_stop_loss && (
              <><span style={{ color: '#6b7280', fontSize: '0.78rem' }}>%</span>
              <input type="number" value={params.stop_loss_pct} onChange={e => set('stop_loss_pct', +e.target.value)} style={inp(60)} /></>
            )}
          </div>
          <div style={row}>
            <span style={lbl}>부분매도</span>
            <button style={toggleBtn(params.use_partial_sell)} onClick={() => set('use_partial_sell', !params.use_partial_sell)}>
              {params.use_partial_sell ? 'ON' : 'OFF'}
            </button>
            {params.use_partial_sell && (
              <><span style={{ color: '#6b7280', fontSize: '0.78rem' }}>%</span>
              <input type="number" value={params.sell_ratio_pct} min={1} max={100} onChange={e => set('sell_ratio_pct', +e.target.value)} style={inp(60)} /></>
            )}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '0.7rem 0' }} />

          <div style={row}>
            <span style={lbl}>RSI 매수</span>
            <button style={toggleBtn(params.use_rsi_buy)} onClick={() => set('use_rsi_buy', !params.use_rsi_buy)}>
              {params.use_rsi_buy ? 'ON' : 'OFF'}
            </button>
            {params.use_rsi_buy && <input type="number" value={params.rsi_buy_level} min={1} max={100} onChange={e => set('rsi_buy_level', +e.target.value)} style={inp(55)} />}
          </div>
          <div style={row}>
            <span style={lbl}>RSI 매도</span>
            <button style={toggleBtn(params.use_rsi_sell)} onClick={() => set('use_rsi_sell', !params.use_rsi_sell)}>
              {params.use_rsi_sell ? 'ON' : 'OFF'}
            </button>
            {params.use_rsi_sell && <input type="number" value={params.rsi_sell_level} min={1} max={100} onChange={e => set('rsi_sell_level', +e.target.value)} style={inp(55)} />}
          </div>
          <div style={row}>
            <span style={lbl}>MACD 매수</span>
            <button style={toggleBtn(params.use_macd_buy)} onClick={() => set('use_macd_buy', !params.use_macd_buy)}>
              {params.use_macd_buy ? 'ON' : 'OFF'}
            </button>
          </div>
          <div style={row}>
            <span style={lbl}>MACD 매도</span>
            <button style={toggleBtn(params.use_macd_sell)} onClick={() => set('use_macd_sell', !params.use_macd_sell)}>
              {params.use_macd_sell ? 'ON' : 'OFF'}
            </button>
          </div>
          <div style={row}>
            <span style={lbl}>MA 매수</span>
            <button style={toggleBtn(params.use_ma_buy)} onClick={() => set('use_ma_buy', !params.use_ma_buy)}>
              {params.use_ma_buy ? 'ON' : 'OFF'}
            </button>
            {params.use_ma_buy && <>
              <input type="number" value={params.ma_buy_len} min={1} onChange={e => set('ma_buy_len', +e.target.value)} style={inp(50)} />
              <input type="number" value={params.ma_buy_pct} min={1} max={100} onChange={e => set('ma_buy_pct', +e.target.value)} style={inp(46)} />
              <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>%</span>
            </>}
          </div>
          {/* MA 하방매수 */}
          <div style={row}>
            <span style={lbl}>MA 하방매수</span>
            <button style={toggleBtn(params.use_ma_dip_buy)} onClick={() => set('use_ma_dip_buy', !params.use_ma_dip_buy)}>
              {params.use_ma_dip_buy ? 'ON' : 'OFF'}
            </button>
            {params.use_ma_dip_buy && (
              <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>MA 이하 돌파 → % 매수</span>
            )}
          </div>
          {params.use_ma_dip_buy && (
            <div style={{ paddingLeft: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {params.ma_dip_steps.map((step, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#38bdf8', fontSize: '0.75rem', width: 16, textAlign: 'right' }}>{idx + 1}</span>
                  <span style={{ color: '#6b7280', fontSize: '0.73rem' }}>MA</span>
                  <input type="number" value={step.len} min={1} max={199}
                    onChange={e => setParams(p => ({ ...p, ma_dip_steps: p.ma_dip_steps.map((s, i) => i === idx ? { ...s, len: +e.target.value } : s) }))}
                    style={inp(50)} />
                  <input type="number" value={step.pct} min={1} max={100}
                    onChange={e => setParams(p => ({ ...p, ma_dip_steps: p.ma_dip_steps.map((s, i) => i === idx ? { ...s, pct: +e.target.value } : s) }))}
                    style={inp(44)} />
                  <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>%</span>
                  <button onClick={() => setParams(p => ({ ...p, ma_dip_steps: p.ma_dip_steps.filter((_, i) => i !== idx) }))}
                    style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: '0.8rem', padding: '0 2px' }}>✕</button>
                </div>
              ))}
              {params.ma_dip_steps.length < 5 && (
                <button onClick={() => setParams(p => ({ ...p, ma_dip_steps: [...p.ma_dip_steps, { len: 50, pct: 10 }] }))}
                  style={{ alignSelf: 'flex-start', marginTop: 2, padding: '0.18rem 0.6rem', borderRadius: 5,
                    background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.25)',
                    color: '#38bdf8', fontSize: '0.72rem', cursor: 'pointer' }}>
                  + 단계 추가
                </button>
              )}
            </div>
          )}
          <div style={row}>
            <span style={lbl}>MA 매도</span>
            <button style={toggleBtn(params.use_ma_sell)} onClick={() => set('use_ma_sell', !params.use_ma_sell)}>
              {params.use_ma_sell ? 'ON' : 'OFF'}
            </button>
            {params.use_ma_sell && <>
              <input type="number" value={params.ma_sell_len} min={1} onChange={e => set('ma_sell_len', +e.target.value)} style={inp(50)} />
              <input type="number" value={params.ma_sell_pct} min={1} max={100} onChange={e => set('ma_sell_pct', +e.target.value)} style={inp(46)} />
              <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>%</span>
            </>}
          </div>


          {/* V자 회복매수 */}
          <div style={row}>
            <span style={lbl}>V자 회복매수</span>
            <button style={toggleBtn(params.use_v_buy)} onClick={() => set('use_v_buy', !params.use_v_buy)}>
              {params.use_v_buy ? 'ON' : 'OFF'}
            </button>
          </div>
          {params.use_v_buy && (
            <div style={{ paddingLeft: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#6b7280', fontSize: '0.73rem', width: 70 }}>MA 회복선</span>
                <input type="number" value={params.v_buy_ma_len} min={1} max={50}
                  onChange={e => set('v_buy_ma_len', +e.target.value)} style={inp(50)} />
                <span style={{ color: '#6b7280', fontSize: '0.73rem' }}>일선</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#6b7280', fontSize: '0.73rem', width: 70 }}>3일 낙폭한도</span>
                <input type="number" value={params.v_buy_drop_pct} min={-30} max={0} step={0.5}
                  onChange={e => set('v_buy_drop_pct', +e.target.value)} style={inp(60)} />
                <span style={{ color: '#6b7280', fontSize: '0.73rem' }}>% 이내</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#6b7280', fontSize: '0.73rem', width: 70 }}>매수 비율</span>
                <input type="number" value={params.v_buy_pct} min={1} max={100}
                  onChange={e => set('v_buy_pct', +e.target.value)} style={inp(50)} />
                <span style={{ color: '#6b7280', fontSize: '0.73rem' }}>%</span>
              </div>
              <span style={{ color: '#4b5563', fontSize: '0.7rem' }}>
                MA200 하방 · 3일 평균낙폭 {params.v_buy_drop_pct}% 이내 · MA{params.v_buy_ma_len} 상향 돌파
              </span>
            </div>
          )}

          {/* Run Button */}
          <button
            onClick={run} disabled={loading}
            style={{
              marginTop: '1rem', width: '100%', padding: '0.7rem',
              borderRadius: 9, border: 'none', cursor: loading ? 'wait' : 'pointer',
              background: loading ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.2)',
              color: loading ? '#9ca3af' : '#fbbf24', fontWeight: 700, fontSize: '0.9rem',
              transition: 'all 140ms',
            }}
          >
            {loading ? `⏳ ${params.ticker} 계산 중...` : `▶ ${params.ticker} 백테스트 실행`}
          </button>
          {error && (
            <div style={{ marginTop: 8, color: '#fca5a5', fontSize: '0.8rem', padding: '0.5rem', background: 'rgba(239,68,68,0.08)', borderRadius: 7 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: '0.85rem' }}>
            <button style={panelTabStyle(viewTab === 'results')} onClick={() => setViewTab('results')}>
              결과
            </button>
            <button style={panelTabStyle(viewTab === 'logic')} onClick={() => setViewTab('logic')}>
              로직 설명
            </button>
          </div>
          <div style={{ color: '#4b5563', fontSize: '0.7rem', marginTop: 6 }}>
            구독자용 설명 탭에서 현재 전략 규칙을 바로 확인할 수 있습니다.
          </div>
        </div>

        {/* ── Results Panel ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {viewTab === 'logic' && (
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '1rem' }}>전략 로직 설명</div>
                <div style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: 4 }}>
                  구독자가 바로 이해할 수 있도록 현재 시뮬레이터 규칙을 카드형으로 정리했습니다.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem' }}>
                {logicSectionsDetail.map(section => (
                  <div key={section.title} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.9rem 1rem' }}>
                    <div style={{ color: '#fbbf24', fontWeight: 800, fontSize: '0.84rem', marginBottom: '0.55rem' }}>
                      {section.title}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {section.lines.map((line, idx) => (
                        <div key={`${section.title}-${idx}`} style={{ color: '#d1d5db', fontSize: '0.8rem', lineHeight: 1.55 }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {viewTab === 'results' && !result && !loading && (
            <div style={{ ...card, textAlign: 'center', padding: '3rem', color: '#4b5563' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
              <div>종목을 선택하고 백테스트를 실행하세요</div>
              <div style={{ fontSize: '0.8rem', marginTop: 4, color: '#374151' }}>기본: TQQQ · 매주 수요일 $100 DCA · 2023-01-01~</div>
            </div>
          )}

          {viewTab === 'results' && result && s && (
            <>
              {/* Summary Cards */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {[
                  { label: '종목', val: s.ticker, color: '245,158,11' },
                  { label: '누적 매수액', val: `$${s.total_invested.toLocaleString()}`, color: '148,163,184' },
                  { label: '최종 계좌가치', val: `$${s.final_value.toLocaleString()}`, color: '245,158,11' },
                  { label: '수익률', val: `${s.total_return_pct > 0 ? '+' : ''}${s.total_return_pct.toFixed(1)}%`, color: s.total_return_pct >= 0 ? '34,197,94' : '239,68,68' },
                  { label: 'CAGR', val: `${s.cagr_pct > 0 ? '+' : ''}${s.cagr_pct.toFixed(1)}%`, color: s.cagr_pct >= 0 ? '99,102,241' : '239,68,68' },
                  { label: 'MDD', val: `${s.mdd_pct.toFixed(1)}%`, color: '239,68,68' },
                  { label: '매수/매도', val: `${s.buy_count}/${s.sell_count}`, color: '167,139,250' },
                  { label: '실현손익', val: `$${s.realized_pnl > 0 ? '+' : ''}${s.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: s.realized_pnl >= 0 ? '34,197,94' : '239,68,68' },
                ].map(m => (
                  <div key={m.label} style={metaCard(m.color)}>
                    <div style={{ color: `rgb(${m.color})`, fontSize: '0.72rem', marginBottom: 2 }}>{m.label}</div>
                    <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.0rem' }}>{m.val}</div>
                  </div>
                ))}
                <div style={metaCard('20,184,166')}>
                  <div style={{ color: 'rgb(20,184,166)', fontSize: '0.72rem', marginBottom: 2 }}>Pool</div>
                  <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.0rem' }}>
                    ${s.pool_balance.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* B&H Comparison */}
              <div style={{ ...card, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                  📌 Buy & Hold 비교 (동일 금액, 동일 날짜 매수)
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {[
                    { label: '최종 계좌가치', val: `$${s.bh.final_value.toLocaleString()}` },
                    { label: '수익률', val: `${s.bh.total_return_pct > 0 ? '+' : ''}${s.bh.total_return_pct.toFixed(1)}%` },
                    { label: 'CAGR', val: `${s.bh.cagr_pct > 0 ? '+' : ''}${s.bh.cagr_pct.toFixed(1)}%` },
                    { label: 'MDD', val: `${s.bh.mdd_pct.toFixed(1)}%` },
                    { label: 'Pool', val: `$${s.bh.pool_balance.toLocaleString()}` },
                    { label: '기간', val: `${s.period.start} ~ ${s.period.end} (${s.period.days}d)` },
                  ].map(m => (
                    <div key={m.label}>
                      <div style={{ color: '#6b7280', fontSize: '0.72rem' }}>{m.label}</div>
                      <div style={{ color: '#c7d2fe', fontWeight: 600, fontSize: '0.92rem' }}>{m.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Equity Curve */}
              <div style={card}>
                <div style={{ color: '#d1d5db', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                  💰 자산 곡선 — <span style={{ color: '#fbbf24' }}>{s.ticker}</span> 전략 vs B&H
                </div>
                <div style={{ color: '#6b7280', fontSize: '0.72rem', marginBottom: '0.6rem' }}>
                  좌측 축: 전략 / B&amp;H / 보유원가 · 우측 축: 매수 / 매도 가격
                </div>
                {equityHighlights.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    {equityHighlights.map(item => (
                      <div
                        key={item.label}
                        style={{
                          flex: '1 1 180px',
                          minWidth: 160,
                          background: 'rgba(255,255,255,0.03)',
                          border: `1px solid ${item.color}33`,
                          borderRadius: 12,
                          padding: '0.65rem 0.8rem',
                        }}
                      >
                        <div style={{ color: item.color, fontSize: '0.72rem', fontWeight: 700, marginBottom: 4 }}>
                          {item.label}
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '1rem' }}>
                          ${item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: 2 }}>
                          {item.hint}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={equityChartData} margin={{ top: 4, right: 16, bottom: 4, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickFormatter={v => formatTsDate(Number(v))}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      yAxisId="asset"
                      width={92}
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickFormatter={v => `$${Math.round(Number(v)).toLocaleString()}`}
                      domain={assetDomain}
                    />
                    <YAxis
                      yAxisId="cost"
                      hide
                      domain={costDomain}
                    />
                    <YAxis
                      yAxisId="price"
                      orientation="right"
                      width={68}
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickFormatter={v => `$${Math.round(Number(v)).toLocaleString()}`}
                      domain={priceDomain}
                    />
                    <Tooltip content={<ChartTip />} labelFormatter={(value) => formatTsDate(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: '0.78rem', color: '#9ca3af' }} />
                    <Area type="monotone" yAxisId="asset" dataKey="total_value"   name="전략" stroke="#f59e0b" fill="rgba(245,158,11,0.08)" strokeWidth={2} dot={false} />
                    <Area type="monotone" yAxisId="asset" dataKey="bh_value"      name="B&H"  stroke="#6366f1" fill="rgba(99,102,241,0.06)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    <Line  type="monotone" yAxisId="cost" dataKey="invested_cost" name="보유원가" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                    {buySignals.length > 0 && (
                      <Scatter
                        yAxisId="price"
                        name={`매수 (${buySignals.length})`}
                        data={buyChartData}
                        dataKey="price"
                        fill="#22c55e"
                        shape={triangleShape('#22c55e', 'up')}
                      />
                    )}
                    {tpSignals.length > 0 && (
                      <Scatter
                        yAxisId="price"
                        name={`TP 매도 (${tpSignals.length})`}
                        data={tpChartData}
                        dataKey="price"
                        fill="#fbbf24"
                        shape={triangleShape('#fbbf24', 'down')}
                      />
                    )}
                    {slSignals.length > 0 && (
                      <Scatter
                        yAxisId="price"
                        name={`SL 매도 (${slSignals.length})`}
                        data={slChartData}
                        dataKey="price"
                        fill="#ef4444"
                        shape={triangleShape('#ef4444', 'down')}
                      />
                    )}
                    {maSellSignals.length > 0 && (
                      <Scatter
                        yAxisId="price"
                        name={`MA 매도 (${maSellSignals.length})`}
                        data={maSellChartData}
                        dataKey="price"
                        fill="#fb923c"
                        shape={triangleShape('#fb923c', 'down')}
                      />
                    )}
                    {signalSellSignals.length > 0 && (
                      <Scatter
                        yAxisId="price"
                        name={`신호매도 (${signalSellSignals.length})`}
                        data={signalSellChartData}
                        dataKey="price"
                        fill="#a78bfa"
                        shape={triangleShape('#a78bfa', 'down')}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Drawdown Chart */}
              <div style={card}>
                <div style={{ color: '#d1d5db', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                  📉 낙폭 — 전략 vs B&H
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={result.dd_curve} margin={{ top: 4, right: 16, bottom: 4, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="d" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => v.slice(2)} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} />
                    <Tooltip content={<ChartTip />} />
                    <Legend wrapperStyle={{ fontSize: '0.78rem', color: '#9ca3af' }} />
                    <Area type="monotone" dataKey="dd"    name="전략 DD" stroke="#f59e0b" fill="rgba(245,158,11,0.12)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="bh_dd" name="B&H DD"  stroke="#ef4444" fill="rgba(239,68,68,0.08)"  strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Price Chart with Signals */}
              <div style={card}>
                <div style={{ color: '#d1d5db', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                  📈 <span style={{ color: '#fbbf24' }}>{s.ticker}</span> 가격 + 매매 시그널
                  <span style={{ color: '#6b7280', fontWeight: 400, fontSize: '0.75rem', marginLeft: 8 }}>🟢 매수  🔴 매도</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.65rem' }}>
                  {signalBreakdown.map(item => (
                    <div
                      key={item.label}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '0.28rem 0.55rem',
                        borderRadius: 999,
                        border: `1px solid ${item.color}33`,
                        background: item.active ? `${item.color}14` : 'rgba(255,255,255,0.04)',
                        color: item.active ? item.color : '#6b7280',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        opacity: item.count > 0 ? 1 : 0.65,
                      }}
                    >
                      <span>{item.label}</span>
                      <span>{item.count}</span>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={result.equity_curve} margin={{ top: 4, right: 16, bottom: 4, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="d" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => v.slice(2)} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `$${v.toFixed(0)}`} domain={['auto','auto']} />
                    <Tooltip content={<ChartTip />} />
                    <Legend wrapperStyle={{ fontSize: '0.75rem', color: '#9ca3af' }} />
                    <Line type="monotone" dataKey="close" name={s.ticker} stroke="#38bdf8" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="ma50"  name="MA50"  stroke="#fbbf24" strokeWidth={1} dot={false} strokeDasharray="3 2" connectNulls />
                    <Line type="monotone" dataKey="ma200" name="MA200" stroke="#f97316" strokeWidth={1.2} dot={false} strokeDasharray="6 2" connectNulls />
                    {false && (
                      <Scatter
                        name="매수"
                        data={(result?.equity_curve ?? []).filter(r => buyDots.includes(r.d)).map(r => ({ d: r.d, close: r.close }))}
                        dataKey="close"
                        fill="#22c55e"
                        shape={(props: any) => {
                          const { cx, cy } = props
                          return <polygon key={`b-${cx}-${cy}`} points={`${cx},${cy-8} ${cx-5},${cy+3} ${cx+5},${cy+3}`} fill="#22c55e" opacity={0.85} />
                        }}
                      />
                    )}
                    {false && (
                      <Scatter
                        name="매도"
                        data={(result?.equity_curve ?? []).filter(r => sellDots.includes(r.d)).map(r => ({ d: r.d, close: r.close }))}
                        dataKey="close"
                        fill="#ef4444"
                        shape={(props: any) => {
                          const { cx, cy } = props
                          return <polygon key={`s-${cx}-${cy}`} points={`${cx},${cy+8} ${cx-5},${cy-3} ${cx+5},${cy-3}`} fill="#ef4444" opacity={0.85} />
                        }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Signals Table */}
              {(() => {
                const allSigs   = [...result.signals].reverse()
                const buySigs   = allSigs.filter(s => s.type === 'buy')
                const sellSigs  = allSigs.filter(s => s.type === 'sell')
                const viewSigs  = tradeFilter === 'buy' ? buySigs : tradeFilter === 'sell' ? sellSigs : allSigs
                const tabStyle  = (active: boolean): React.CSSProperties => ({
                  padding: '0.28rem 0.75rem', borderRadius: 6, fontSize: '0.78rem',
                  fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 120ms',
                  background: active ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.05)',
                  color: active ? '#fbbf24' : '#6b7280',
                })
                return (
                  <div style={card}>
                    {/* 헤더 + 필터 탭 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ color: '#d1d5db', fontWeight: 700, fontSize: '0.85rem', marginRight: 4 }}>
                        🗒️ 거래 내역
                      </span>
                      <button style={tabStyle(tradeFilter === 'all')}  onClick={() => setTradeFilter('all')}>
                        전체 {allSigs.length}
                      </button>
                      <button style={tabStyle(tradeFilter === 'buy')}  onClick={() => setTradeFilter('buy')}>
                        <span style={{ color: '#86efac' }}>▲</span> 매수 {buySigs.length}
                      </button>
                      <button style={tabStyle(tradeFilter === 'sell')} onClick={() => setTradeFilter('sell')}>
                        <span style={{ color: '#fca5a5' }}>▼</span> 매도 {sellSigs.length}
                      </button>
                      <span style={{ marginLeft: 'auto', color: '#4b5563', fontSize: '0.72rem' }}>
                        최신순 · {viewSigs.length}건
                      </span>
                    </div>
                    {/* 테이블 */}
                    <div style={{ overflowY: 'auto', maxHeight: 380 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.97)', zIndex: 1 }}>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {['날짜','구분','가격','수량','금액','원금 / 평가액','이유','손익'].map(h => (
                              <th key={h} style={{ color: '#6b7280', fontWeight: 600, padding: '0.32rem 0.5rem', textAlign: 'left' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {viewSigs.map((sig, i) => (
                            <tr key={i} style={{
                              borderBottom: '1px solid rgba(255,255,255,0.04)',
                              background: sig.type === 'sell' ? 'rgba(239,68,68,0.04)' : 'transparent',
                            }}>
                              <td style={{ padding: '0.28rem 0.5rem', color: '#9ca3af' }}>{sig.d}</td>
                              <td style={{ padding: '0.28rem 0.5rem', color: sig.type === 'buy' ? '#86efac' : '#fca5a5', fontWeight: 700 }}>
                                {sig.type === 'buy' ? '▲ 매수' : '▼ 매도'}
                              </td>
                              <td style={{ padding: '0.28rem 0.5rem', color: '#f3f4f6' }}>${sig.price.toFixed(2)}</td>
                              <td style={{ padding: '0.28rem 0.5rem', color: '#d1d5db' }}>{sig.shares.toFixed(3)}</td>
                              <td style={{ padding: '0.28rem 0.5rem', color: '#d1d5db' }}>${sig.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td style={{ padding: '0.28rem 0.5rem', color: '#d1d5db' }}>
                                <div style={{ color: '#f3f4f6', fontWeight: 700 }}>
                                  평가액 ${sig.current_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                                <div style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: 1 }}>
                                  원금 ${sig.invested_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                              </td>
                              <td style={{ padding: '0.28rem 0.5rem', color: sig.reason === 'TP' ? '#86efac' : sig.reason === 'SL' ? '#fca5a5' : sig.reason === 'MA_SELL' ? '#fb923c' : sig.reason === 'MA_BUY' ? '#34d399' : sig.reason === 'MA_DIP' || sig.reason?.startsWith('DIP') ? '#38bdf8' : sig.reason?.startsWith('V') ? '#a78bfa' : '#a5b4fc' }}>
                                {sig.reason}
                              </td>
                              <td style={{ padding: '0.28rem 0.5rem', color: (sig.pnl ?? 0) >= 0 ? '#86efac' : '#fca5a5' }}>
                                {sig.pnl != null ? `$${sig.pnl > 0 ? '+' : ''}${sig.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
