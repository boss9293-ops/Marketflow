'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mockValuation } from '@/lib/mock/valuation'

type ValuationPanelProps = {
  symbol: string
  fetchKey?: number   // 0 = idle (do not auto-fetch); increment to trigger load
}

type ScenarioCase = {
  priceTarget: number | null
  pe: number | null
  epsNext: number | null
  growthPct: number | null
}

type ValuationResponse = {
  symbol: string
  price: number | null
  fairValue: number | null
  upside: number | null
  bearCase: ScenarioCase
  baseCase: ScenarioCase
  bullCase: ScenarioCase
  pe: number | null
  sectorPE: number | null
  pe5y: number | null
  peg: number | null
  evToEbitda: number | null
  epsGrowth3y: number | null
  revenueGrowth3y: number | null
  fcfGrowth3y: number | null
  aiSummary: string | null
  fetchedAt: string
  rateLimited?: boolean
  stale?: boolean
  dataSource?: string
}

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '0.95rem',
}

const fmtNum = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '--'
const fmtPct = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '--'
const fmtMoney = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '--'
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_STOCK_DATA === 'true'

export default function ValuationPanel({ symbol, fetchKey = 0 }: ValuationPanelProps) {
  const [data, setData] = useState<ValuationResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)

  const normalized = useMemo(() => {
    const raw = symbol.trim().toUpperCase()
    if (!raw) return raw
    if (raw.includes(':')) return raw.split(':').pop() || raw
    return raw
  }, [symbol])

  useEffect(() => {
    if (!normalized) return
    if (!fetchKey) {
      setData(null); setLoading(false); setError(null); fetchingRef.current = false
      return
    }
    if (USE_MOCK) {
      const mock = mockValuation[normalized] || mockValuation.AAPL
      setData({
        symbol: mock.symbol,
        price: mock.currentPrice,
        fairValue: mock.fairValue,
        upside: mock.upsidePct,
        bearCase: mock.bearCase,
        baseCase: mock.baseCase,
        bullCase: mock.bullCase,
        pe: mock.pe,
        sectorPE: mock.sectorPE,
        pe5y: mock.avg5yPE,
        peg: mock.peg,
        evToEbitda: mock.evEbitda,
        epsGrowth3y: mock.epsGrowth3y,
        revenueGrowth3y: mock.revenueGrowth3y,
        fcfGrowth3y: mock.fcfGrowth3y,
        aiSummary: mock.aiSummary,
        fetchedAt: new Date().toISOString(),
        dataSource: 'mock',
      })
      setLoading(false)
      setError(null)
      fetchingRef.current = false
      return
    }
    if (fetchingRef.current) return   // guard: skip if already in-flight
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    fetchingRef.current = true
    setLoading(true)
    setError(null)
    fetch(`/api/valuation?symbol=${encodeURIComponent(normalized)}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json()
        if (json?.rateLimited) throw new Error('rate-limited')
        if (!res.ok) throw new Error('Failed to load valuation')
        return json
      })
      .then((json) => {
        if (!active) return
        setData(json)
      })
      .catch((err: Error) => {
        if (!active) return
        if (err.name === 'AbortError') {
          setError('Timeout')
        } else if (err.message === 'rate-limited') {
          setError('rate-limited')
        } else {
          setError(err.message)
        }
      })
      .finally(() => {
        fetchingRef.current = false
        if (!active) return
        clearTimeout(timeout)
        setLoading(false)
      })

    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [normalized, fetchKey])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>Valuation Snapshot</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', marginBottom: 10 }}>
          Ticker: {normalized}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div style={{ borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.7rem' }}>
            <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>Current Price</div>
            <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{fmtMoney(data?.price)}</div>
          </div>
          <div style={{ borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.7rem' }}>
            <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>Fair Value (AI)</div>
            <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{fmtMoney(data?.fairValue)}</div>
          </div>
          <div style={{ borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.7rem' }}>
            <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>Upside %</div>
            <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{fmtPct(data?.upside)}</div>
          </div>
        </div>
        {!fetchKey && !loading && !data && (
          <div style={{ marginTop: 10, color: '#6b7280', fontSize: '0.78rem' }}>
            Click ↻ Refresh to load data
          </div>
        )}
        {loading && <div style={{ marginTop: 10, color: '#9ca3af', fontSize: '0.8rem' }}>Loading valuation...</div>}
        {error === 'rate-limited' && (
          <div style={{ marginTop: 10, color: '#fbbf24', fontSize: '0.78rem', background: 'rgba(251,191,36,0.08)', borderRadius: 6, padding: '0.4rem 0.6rem' }}>
            Rate limit reached — try again in a few minutes
          </div>
        )}
        {error && error !== 'rate-limited' && <div style={{ marginTop: 10, color: '#fca5a5', fontSize: '0.8rem' }}>{error}</div>}
        {data?.stale && !loading && (
          <div style={{ marginTop: 8, color: '#6b7280', fontSize: '0.72rem' }}>
            Using cached data
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Scenario Model</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {[
            { label: 'Bear Case', data: data?.bearCase },
            { label: 'Base Case', data: data?.baseCase },
            { label: 'Bull Case', data: data?.bullCase },
          ].map((c) => (
            <div key={c.label} style={{ borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.7rem' }}>
              <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{c.label}</div>
              <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{fmtMoney(c.data?.priceTarget)}</div>
              <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: 4 }}>
                PE {fmtNum(c.data?.pe, 1)} · EPS {fmtNum(c.data?.epsNext, 2)} · Growth {fmtPct((c.data?.growthPct ?? 0) / 100)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Multiples</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {[
              { label: 'PE vs Sector', value: fmtNum(data?.pe, 1), sub: fmtNum(data?.sectorPE, 1) },
              { label: 'PE vs 5Y Avg', value: fmtNum(data?.pe, 1), sub: fmtNum(data?.pe5y, 1) },
              { label: 'PEG', value: fmtNum(data?.peg, 2) },
              { label: 'EV / EBITDA', value: fmtNum(data?.evToEbitda, 2) },
            ].map((m) => (
              <div key={m.label} style={{ borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.6rem' }}>
                <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{m.label}</div>
                <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{m.value}</div>
                {m.sub != null && m.sub !== '--' && (
                  <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Ref: {m.sub}</div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Growth</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {[
              { label: 'EPS Growth 3Y', value: fmtPct(data?.epsGrowth3y) },
              { label: 'Revenue Growth 3Y', value: fmtPct(data?.revenueGrowth3y) },
              { label: 'FCF Growth', value: fmtPct(data?.fcfGrowth3y) },
            ].map((m) => (
              <div key={m.label} style={{ borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.6rem' }}>
                <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{m.label}</div>
                <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>AI Valuation Summary</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', lineHeight: 1.6 }}>
          {data?.aiSummary || 'Summary will appear after data fetch.'}
        </div>
      {data?.fetchedAt && (
        <div style={{ marginTop: 10, color: '#64748b', fontSize: '0.72rem' }}>
          Updated: {data.fetchedAt.slice(0, 16).replace('T', ' ')}
        </div>
      )}
    </div>

    <div style={{ ...cardStyle, opacity: 0.65, filter: 'blur(0.8px)' }}>
      <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>Peer Comparison (Premium)</div>
      <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>
        Unlock premium to view peer valuation dispersion and institutional consensus heatmap.
      </div>
    </div>
  </div>
  )
}
