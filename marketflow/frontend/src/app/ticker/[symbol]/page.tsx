'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWatchlist } from '@/contexts/WatchlistContext'
import BilLabel from '@/components/BilLabel'
import TickerReportCard from '@/components/ticker/TickerReportCard'
import { buildTickerReport } from '@/lib/tickerReport'

type Candle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  adj_close?: number | null
  volume?: number | null
}

type SignalItem = {
  date?: string
  signal_type?: string
  score?: number | null
  status?: string | null
  payload_json?: string | null
}

type ChartResponse = {
  symbol: string
  name?: string
  sector?: string | null
  exchange?: string | null
  candles?: Candle[]
  error?: string
  rerun_hint?: string
}

type SummaryResponse = {
  symbol: string
  name?: string
  sector?: string | null
  industry?: string | null
  exchange?: string | null
  date?: string
  close?: number
  change_pct?: number
  indicators?: {
    sma20?: number | null
    sma50?: number | null
    sma200?: number | null
    rsi14?: number | null
    macd?: number | null
    macd_signal?: number | null
  }
  signals?: SignalItem[]
  ai_brief_v1?: string
  error?: string
  rerun_hint?: string
}

type RangeKey = '1M' | '3M' | '6M' | '1Y'
type EnrichedCandle = Candle & { sma20?: number; sma50?: number; sma200?: number }

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'

function panelStyle() {
  return {
    background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '0.92rem',
  } as const
}

function fmt(v?: number | null, digits = 2) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return v.toFixed(digits)
}

function fmtPct(v?: number | null) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
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

function enrichCandles(candles: Candle[]): EnrichedCandle[] {
  const sma20 = movingAverage(candles, 20)
  const sma50 = movingAverage(candles, 50)
  const sma200 = movingAverage(candles, 200)
  return candles.map((c, i) => ({ ...c, sma20: sma20[i], sma50: sma50[i], sma200: sma200[i] }))
}

function CandleSvg({ candles }: { candles: EnrichedCandle[] }) {
  const w = 1040
  const h = 380
  const left = 46
  const right = 88
  const top = 12
  const bottom = 34
  if (!candles.length) return <div style={{ color: '#8b93a8' }}>No candle data.</div>

  const prices: number[] = []
  candles.forEach((c) => {
    prices.push(c.low, c.high)
    if (typeof c.sma20 === 'number') prices.push(c.sma20)
    if (typeof c.sma50 === 'number') prices.push(c.sma50)
    if (typeof c.sma200 === 'number') prices.push(c.sma200)
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

  const points = (k: 'sma20' | 'sma50' | 'sma200') =>
    candles
      .map((c, i) => (typeof c[k] === 'number' ? `${left + xStep * i + xStep * 0.5},${y(c[k] as number)}` : ''))
      .filter(Boolean)
      .join(' ')

  const dateTicks = 6
  const tickIndices = Array.from({ length: dateTicks }, (_, i) =>
    Math.round((i * (candles.length - 1)) / Math.max(1, dateTicks - 1)),
  )

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '100%' }}>
      {[0, 1, 2, 3, 4, 5].map((g) => {
        const yy = top + (ch * g) / 5
        const p = max - (span * g) / 5
        return (
          <g key={`g-y-${g}`}>
            <line x1={left} y1={yy} x2={w - right} y2={yy} stroke="rgba(255,255,255,0.06)" />
            <text x={w - right + 8} y={yy + 4} fill="#7f889d" fontSize="11">
              {p.toFixed(2)}
            </text>
          </g>
        )
      })}

      {tickIndices.map((idx) => {
        const x = left + xStep * idx + xStep * 0.5
        const date = candles[idx]?.date || ''
        return (
          <g key={`g-x-${idx}`}>
            <line x1={x} y1={top} x2={x} y2={h - bottom} stroke="rgba(255,255,255,0.04)" />
            <text x={x} y={h - 11} fill="#8b93a8" fontSize="11" textAnchor="middle">
              {date ? date.slice(5) : ''}
            </text>
          </g>
        )
      })}

      {points('sma20') ? <polyline fill="none" stroke="#00d9ff" strokeWidth="1.1" points={points('sma20')} /> : null}
      {points('sma50') ? <polyline fill="none" stroke="#22c55e" strokeWidth="1.2" points={points('sma50')} /> : null}
      {points('sma200') ? <polyline fill="none" stroke="#ef4444" strokeWidth="1.35" points={points('sma200')} /> : null}

      {candles.map((c, i) => {
        const cx = left + xStep * i + xStep * 0.5
        const yo = y(c.open)
        const yc = y(c.close)
        const yh = y(c.high)
        const yl = y(c.low)
        const up = c.close >= c.open
        const color = up ? '#22c55e' : '#ef4444'
        return (
          <g key={`c-${c.date}-${i}`}>
            <line x1={cx} y1={yh} x2={cx} y2={yl} stroke={color} />
            <rect
              x={cx - bodyW / 2}
              y={Math.min(yo, yc)}
              width={bodyW}
              height={Math.max(1.5, Math.abs(yc - yo))}
              fill={color}
              rx={1}
            />
          </g>
        )
      })}
    </svg>
  )
}

export default function TickerDetailPage({ params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent((params.symbol || '').toUpperCase())
  const { setSelectedSymbol } = useWatchlist()
  const [range, setRange] = useState<RangeKey>('3M')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [chart, setChart] = useState<ChartResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (symbol) setSelectedSymbol(symbol)
  }, [symbol, setSelectedSymbol])

  useEffect(() => {
    if (!symbol) return
    let alive = true
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/api/ticker-summary?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null),
      fetch(`${API_BASE}/api/chart?symbol=${encodeURIComponent(symbol)}&days=400`, { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([s, c]) => {
        if (!alive) return
        setSummary(s)
        setChart(c)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [symbol])

  const allCandles = useMemo(() => {
    const candles = Array.isArray(chart?.candles) ? chart.candles : []
    return enrichCandles(candles)
  }, [chart])

  const candles = useMemo(() => {
    const bars = range === '1M' ? 22 : range === '3M' ? 63 : range === '6M' ? 126 : 252
    return allCandles.slice(Math.max(0, allCandles.length - bars))
  }, [allCandles, range])

  const latest = allCandles.length ? allCandles[allCandles.length - 1] : undefined
  const signals = Array.isArray(summary?.signals) ? summary!.signals! : []
  const report = useMemo(() => buildTickerReport({ symbol, summary, chart }), [symbol, summary, chart])
  const newsBullets = useMemo(() => report.bullets.slice(0, 5), [report])

  const fallbackText =
    chart?.error || summary?.error
      ? `${chart?.error || summary?.error}${chart?.rerun_hint || summary?.rerun_hint ? ` | rerun: ${chart?.rerun_hint || summary?.rerun_hint}` : ''}`
      : ''

  return (
    <div style={{ padding: '1.5rem 1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 800, color: '#f3f4f6' }}>
            {summary?.name || symbol} <span style={{ color: '#00D9FF' }}>Ticker Detail</span>
          </h1>
          <div style={{ color: '#8b93a8', fontSize: '0.8rem', marginTop: 4 }}>
            {summary?.symbol || symbol} {summary?.sector ? `| ${summary.sector}` : ''}{' '}
            {summary?.exchange ? `| ${summary.exchange}` : ''}
          </div>
        </div>
        <Link href="/chart" style={{ border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.04)', color: '#d1d5db', borderRadius: 8, padding: '0.42rem 0.68rem', textDecoration: 'none', fontSize: '0.78rem' }}>
          Back to Chart
        </Link>
      </div>

      <TickerReportCard report={report} />

      <section style={{ ...panelStyle(), display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ color: 'var(--text-secondary)' }}>
          <BilLabel ko="차트 보기 범위" en="Chart range" variant="micro" />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['1M', '3M', '6M', '1Y'] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                border: range === r ? '1px solid rgba(0,217,255,0.45)' : '1px solid rgba(255,255,255,0.12)',
                background: range === r ? 'rgba(0,217,255,0.14)' : 'rgba(255,255,255,0.04)',
                color: range === r ? '#67e8f9' : '#9ca3af',
                borderRadius: 8,
                padding: '0.28rem 0.62rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 10 }}>
        <section style={panelStyle()}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8, color: '#9ca3af', fontSize: '0.74rem' }}>
            <span>MA20 (cyan)</span>
            <span>MA50 (green)</span>
            <span>MA200 (red)</span>
          </div>
          {loading ? (
            <div style={{ color: '#9ca3af', fontSize: '0.86rem' }}>Loading chart...</div>
          ) : (
            <div style={{ width: '100%', height: 380 }}>
              <CandleSvg candles={candles} />
            </div>
          )}
          {fallbackText ? <div style={{ marginTop: 8, color: '#fca5a5', fontSize: '0.76rem' }}>{fallbackText}</div> : null}
        </section>

        <section style={panelStyle()}>
          <div style={{ color: 'var(--text-primary)', marginBottom: 8 }}>
            <BilLabel ko="핵심 지표" en="Key Indicators" variant="label" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 }}>
            <div style={{ color: '#8b93a8', fontSize: '0.76rem' }}>MA20</div>
            <div style={{ color: '#f3f4f6', textAlign: 'right' }}>{fmt(latest?.sma20)}</div>
            <div style={{ color: '#8b93a8', fontSize: '0.76rem' }}>MA50</div>
            <div style={{ color: '#f3f4f6', textAlign: 'right' }}>{fmt(latest?.sma50)}</div>
            <div style={{ color: '#8b93a8', fontSize: '0.76rem' }}>MA200</div>
            <div style={{ color: '#f3f4f6', textAlign: 'right' }}>{fmt(latest?.sma200)}</div>
            <div style={{ color: '#8b93a8', fontSize: '0.76rem' }}>MACD</div>
            <div style={{ color: '#f3f4f6', textAlign: 'right' }}>{fmt(summary?.indicators?.macd, 3)}</div>
            <div style={{ color: '#8b93a8', fontSize: '0.76rem' }}>MACD Signal</div>
            <div style={{ color: '#f3f4f6', textAlign: 'right' }}>{fmt(summary?.indicators?.macd_signal, 3)}</div>
          </div>
        </section>
      </div>

      <section style={panelStyle()}>
        <div style={{ color: 'var(--text-primary)', marginBottom: 10 }}>
          <BilLabel ko="요약 브리프 / 뉴스 포인트" en="Concise Brief / News Bullets" variant="label" />
        </div>
        {newsBullets.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            <BilLabel
              ko="요약 포인트를 만들 수 있는 데이터가 아직 부족합니다."
              en="Not enough data yet to generate concise bullets."
              variant="micro"
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {newsBullets.map((b, idx) => (
              <div
                key={`${b.title.en}-${idx}`}
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.02)',
                  padding: '0.65rem 0.75rem',
                }}
              >
                <div style={{ color: 'var(--text-primary)' }}>
                  <BilLabel ko={b.title.ko} en={b.title.en} variant="micro" />
                </div>
                <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                  <BilLabel ko={b.body.ko} en={b.body.en} variant="micro" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
