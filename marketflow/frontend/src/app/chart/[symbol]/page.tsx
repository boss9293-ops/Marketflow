'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Candle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

type ChartResponse = {
  symbol: string
  name?: string
  candles?: Candle[]
  error?: string
  rerun_hint?: string
}

type SummaryResponse = {
  symbol: string
  name?: string
  close?: number
  change_pct?: number
  indicators?: {
    sma20?: number | null
    sma50?: number | null
    sma200?: number | null
    rsi14?: number | null
    macd?: number | null
  }
  error?: string
}

type RangeKey = '1M' | '3M' | '6M' | '1Y'
type ViewMode = 'candle' | 'line'

type Enriched = Candle & { sma20?: number; sma50?: number; sma200?: number }

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'
const RANGE_TO_DAYS: Record<RangeKey, number> = { '1M': 22, '3M': 63, '6M': 126, '1Y': 252 }

function panelStyle() {
  return {
    background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '0.92rem',
  } as const
}

function movingAverage(candles: Candle[], window: number): Array<number | undefined> {
  if (window <= 0) return candles.map(() => undefined)
  let sum = 0
  const out: Array<number | undefined> = []
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= window) sum -= candles[i - window].close
    out.push(i >= window - 1 ? sum / window : undefined)
  }
  return out
}

function enrich(candles: Candle[]): Enriched[] {
  const sma20 = movingAverage(candles, 20)
  const sma50 = movingAverage(candles, 50)
  const sma200 = movingAverage(candles, 200)
  return candles.map((c, i) => ({ ...c, sma20: sma20[i], sma50: sma50[i], sma200: sma200[i] }))
}

function fmt(v?: number | null, digits = 2) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return v.toFixed(digits)
}

function fmtPct(v?: number | null) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function PriceChart({
  candles,
  mode,
  show20,
  show50,
  show200,
}: {
  candles: Enriched[]
  mode: ViewMode
  show20: boolean
  show50: boolean
  show200: boolean
}) {
  const w = 1020
  const h = 380
  const left = 46
  const right = 86
  const top = 12
  const bottom = 34

  if (!candles.length) return <div style={{ color: '#8b93a8' }}>No price data.</div>

  const prices: number[] = []
  candles.forEach((c) => {
    prices.push(c.low, c.high, c.close)
    if (show20 && typeof c.sma20 === 'number') prices.push(c.sma20)
    if (show50 && typeof c.sma50 === 'number') prices.push(c.sma50)
    if (show200 && typeof c.sma200 === 'number') prices.push(c.sma200)
  })
  const minRaw = Math.min(...prices)
  const maxRaw = Math.max(...prices)
  const pad = (maxRaw - minRaw) * 0.06
  const min = minRaw - pad
  const max = maxRaw + pad
  const span = Math.max(1, max - min)
  const cw = w - left - right
  const ch = h - top - bottom
  const xStep = cw / candles.length
  const bodyW = Math.max(2, Math.min(10, xStep * 0.62))
  const y = (p: number) => top + ((max - p) / span) * ch

  const points = (key: 'close' | 'sma20' | 'sma50' | 'sma200') =>
    candles
      .map((c, i) => (typeof c[key] === 'number' ? `${left + xStep * i + xStep * 0.5},${y(c[key] as number)}` : ''))
      .filter(Boolean)
      .join(' ')

  const tickIndices = [0, Math.floor(candles.length * 0.25), Math.floor(candles.length * 0.5), Math.floor(candles.length * 0.75), candles.length - 1]
    .filter((v, i, arr) => v >= 0 && v < candles.length && arr.indexOf(v) === i)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '100%' }}>
      {[0, 1, 2, 3, 4, 5].map((g) => {
        const yy = top + (ch * g) / 5
        const p = max - (span * g) / 5
        return (
          <g key={`y-${g}`}>
            <line x1={left} y1={yy} x2={w - right} y2={yy} stroke="rgba(255,255,255,0.06)" />
            <text x={w - right + 8} y={yy + 4} fill="#7f889d" fontSize="11">
              {p.toFixed(2)}
            </text>
          </g>
        )
      })}

      {tickIndices.map((idx) => {
        const x = left + xStep * idx + xStep * 0.5
        return (
          <g key={`x-${idx}`}>
            <line x1={x} y1={top} x2={x} y2={h - bottom} stroke="rgba(255,255,255,0.04)" />
            <text x={x} y={h - 11} fill="#8b93a8" fontSize="11" textAnchor="middle">
              {(candles[idx]?.date || '').slice(5)}
            </text>
          </g>
        )
      })}

      {mode === 'line' ? (
        <polyline fill="none" stroke="#60a5fa" strokeWidth="1.6" points={points('close')} />
      ) : (
        candles.map((c, i) => {
          const cx = left + xStep * i + xStep * 0.5
          const yo = y(c.open)
          const yc = y(c.close)
          const yh = y(c.high)
          const yl = y(c.low)
          const up = c.close >= c.open
          const color = up ? '#22c55e' : '#ef4444'
          return (
            <g key={`${c.date}-${i}`}>
              <line x1={cx} y1={yh} x2={cx} y2={yl} stroke={color} />
              <rect x={cx - bodyW / 2} y={Math.min(yo, yc)} width={bodyW} height={Math.max(1.5, Math.abs(yc - yo))} fill={color} rx={1} />
            </g>
          )
        })
      )}

      {show20 ? <polyline fill="none" stroke="#00d9ff" strokeWidth="1.1" points={points('sma20')} /> : null}
      {show50 ? <polyline fill="none" stroke="#22c55e" strokeWidth="1.2" points={points('sma50')} /> : null}
      {show200 ? <polyline fill="none" stroke="#ef4444" strokeWidth="1.35" points={points('sma200')} /> : null}
    </svg>
  )
}

export default function SymbolChartPage({ params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent((params.symbol || '').toUpperCase()).trim()
  const symbolValid = /^[A-Z0-9.\-]{1,10}$/.test(symbol)
  const [range, setRange] = useState<RangeKey>('1Y')
  const days = RANGE_TO_DAYS[range]
  const [mode, setMode] = useState<ViewMode>('candle')
  const [show20, setShow20] = useState(true)
  const [show50, setShow50] = useState(true)
  const [show200, setShow200] = useState(true)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [chart, setChart] = useState<ChartResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!symbolValid) {
      setSummary(null)
      return
    }
    let alive = true
    fetch(`${API_BASE}/api/ticker-summary?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((s) => {
        if (!alive) return
        setSummary(s)
      })
      .catch(() => {
        if (!alive) return
        setSummary({ symbol, error: 'Failed to load ticker summary.' })
      })
    return () => {
      alive = false
    }
  }, [symbol, symbolValid])

  useEffect(() => {
    if (!symbolValid) {
      setChart(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    fetch(`${API_BASE}/api/chart/${encodeURIComponent(symbol)}?days=${days}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((c) => {
        if (!alive) return
        setChart(c)
      })
      .catch(() => {
        if (!alive) return
        setChart({ symbol, candles: [], error: 'Failed to load chart data.' })
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [days, symbol, symbolValid])

  const candles = useMemo(() => enrich(Array.isArray(chart?.candles) ? chart.candles : []), [chart])

  const fallback = chart?.error || summary?.error
    ? `${chart?.error || summary?.error}${chart?.rerun_hint ? ` | rerun: ${chart.rerun_hint}` : ''}`
    : ''

  if (!symbol) {
    return (
      <div style={{ padding: '1.5rem 1.75rem 2rem' }}>
        <section style={panelStyle()}>
          <div style={{ color: '#fca5a5', fontWeight: 700, marginBottom: 6 }}>Missing symbol</div>
          <div style={{ color: '#9ca3af', fontSize: '0.84rem' }}>Open this page with a symbol, for example: /chart/AAPL</div>
          <div style={{ marginTop: 10 }}>
            <Link href="/chart" style={{ color: '#9ca3af', textDecoration: 'none' }}>
              Back to Chart
            </Link>
          </div>
        </section>
      </div>
    )
  }

  if (!symbolValid) {
    return (
      <div style={{ padding: '1.5rem 1.75rem 2rem' }}>
        <section style={panelStyle()}>
          <div style={{ color: '#fca5a5', fontWeight: 700, marginBottom: 6 }}>Invalid symbol</div>
          <div style={{ color: '#9ca3af', fontSize: '0.84rem' }}>
            Symbol must match letters, digits, dot or dash and be 1-10 chars.
          </div>
          <div style={{ marginTop: 10 }}>
            <Link href="/chart" style={{ color: '#9ca3af', textDecoration: 'none' }}>
              Back to Chart
            </Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem 1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
            {summary?.name || symbol} <span style={{ color: '#00D9FF' }}>Chart</span>
          </h1>
          <div style={{ color: '#8b93a8', fontSize: '0.78rem', marginTop: 4 }}>
            Last close: {fmt(summary?.close)} | 1D: <span style={{ color: (summary?.change_pct || 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtPct(summary?.change_pct)}</span>
          </div>
        </div>
        <Link href="/chart" style={{ color: '#9ca3af', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '0.38rem 0.65rem', fontSize: '0.76rem' }}>
          Back to Chart
        </Link>
      </div>

      <section style={{ ...panelStyle(), display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['1M', '3M', '6M', '1Y'] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                border: range === r ? '1px solid rgba(0,217,255,0.45)' : '1px solid rgba(255,255,255,0.12)',
                background: range === r ? 'rgba(0,217,255,0.14)' : 'rgba(255,255,255,0.04)',
                color: range === r ? '#67e8f9' : '#9ca3af',
                borderRadius: 8,
                padding: '0.26rem 0.58rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 6 }}>
          <button
            onClick={() => setMode('candle')}
            style={{
              border: mode === 'candle' ? '1px solid rgba(251,191,36,0.45)' : '1px solid rgba(255,255,255,0.12)',
              background: mode === 'candle' ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.04)',
              color: mode === 'candle' ? '#fbbf24' : '#9ca3af',
              borderRadius: 8,
              padding: '0.26rem 0.58rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Candle
          </button>
          <button
            onClick={() => setMode('line')}
            style={{
              border: mode === 'line' ? '1px solid rgba(96,165,250,0.45)' : '1px solid rgba(255,255,255,0.12)',
              background: mode === 'line' ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.04)',
              color: mode === 'line' ? '#60a5fa' : '#9ca3af',
              borderRadius: 8,
              padding: '0.26rem 0.58rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Line
          </button>
        </div>
        <label style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: '0.75rem', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={show20} onChange={(e) => setShow20(e.target.checked)} /> SMA20
        </label>
        <label style={{ color: '#9ca3af', fontSize: '0.75rem', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={show50} onChange={(e) => setShow50(e.target.checked)} /> SMA50
        </label>
        <label style={{ color: '#9ca3af', fontSize: '0.75rem', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={show200} onChange={(e) => setShow200(e.target.checked)} /> SMA200
        </label>
      </section>

      <section style={panelStyle()}>
        {loading ? (
          <div style={{ color: '#9ca3af', fontSize: '0.84rem' }}>Loading chart...</div>
        ) : (
          <div style={{ width: '100%', height: 380 }}>
            <PriceChart candles={candles} mode={mode} show20={show20} show50={show50} show200={show200} />
          </div>
        )}
        {fallback ? <div style={{ marginTop: 8, color: '#fca5a5', fontSize: '0.76rem' }}>{fallback}</div> : null}
      </section>
    </div>
  )
}
