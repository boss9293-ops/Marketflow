'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { mockEarnings } from '@/lib/mock/earnings'

type EarningsPanelProps = {
  symbol: string
  fetchKey?: number   // 0 = idle (do not auto-fetch); increment to trigger load
}

type EarningsResponse = {
  symbol: string
  nextEarningsDate: string | null
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  surprisePercent: number | null
  quarters: {
    date: string | null
    quarter: string
    epsEstimate: number | null
    epsActual: number | null
    revenueEstimate: number | null
    revenueActual: number | null
    surprisePercent: number | null
  }[]
  summary: {
    beatRate: number
    totalQuarters: number
    avgSurprisePercent: number | null
    trend: 'positive' | 'mixed' | 'negative' | 'unknown'
    estimateRevision30dPct: number | null
    earningsMomentum: 'up' | 'down' | 'flat' | 'unknown'
  }
  rateLimited?: boolean
  stale?: boolean
  dataSource?: string
}

const cardStyle: CSSProperties = {
  background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '0.95rem',
}

const fmtNum = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '--'
const fmtPct = (v: number | null | undefined, digits = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%` : '--'
const fmtSurprise = (v: number | null | undefined, digits = 2) => {
  if (v == null || !Number.isFinite(v)) return '--'
  const pct = Math.abs(v) > 2 ? v : v * 100
  return `${v > 0 ? '+' : ''}${pct.toFixed(digits)}%`
}
const fmtCurrency = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v)
    : '--'
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_STOCK_DATA === 'true'

export default function EarningsPanel({ symbol, fetchKey = 0 }: EarningsPanelProps) {
  const [data, setData] = useState<EarningsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)

  const normalized = useMemo(() => symbol.trim().toUpperCase(), [symbol])

  useEffect(() => {
    if (!normalized) return
    if (!fetchKey) {
      setData(null); setLoading(false); setError(null); fetchingRef.current = false
      return
    }
    if (USE_MOCK) {
      const mock = mockEarnings[normalized] || mockEarnings.AAPL
      setData({
        symbol: mock.symbol,
        nextEarningsDate: mock.nextEarningsDate,
        epsEstimate: mock.epsEstimate,
        epsActual: mock.epsActual,
        revenueEstimate: mock.revenueEstimate,
        revenueActual: mock.revenueActual,
        surprisePercent: mock.surprisePercent,
        quarters: mock.quarters,
        summary: {
          beatRate: mock.beatRate,
          totalQuarters: mock.quarters.length,
          avgSurprisePercent: mock.avgSurprisePercent,
          trend: mock.trend,
          estimateRevision30dPct: null,
          earningsMomentum: 'unknown',
        },
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

    fetch(`/api/earnings/${normalized}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json()
        if (json?.rateLimited) throw new Error('rate-limited')
        if (!res.ok) throw new Error('Failed to load earnings')
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

  const overview = [
    { label: 'Next Earnings', value: data?.nextEarningsDate ?? 'TBD' },
    { label: 'EPS (Est/Act)', value: `${fmtNum(data?.epsEstimate, 2)} / ${fmtNum(data?.epsActual, 2)}` },
    { label: 'Revenue (Est/Act)', value: `${fmtCurrency(data?.revenueEstimate)} / ${fmtCurrency(data?.revenueActual)}` },
    { label: 'Surprise %', value: fmtSurprise(data?.surprisePercent, 2) },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Earnings Overview</div>
          <div style={{ color: '#9ca3af', fontSize: '0.82rem', marginBottom: 12 }}>
            Ticker: {normalized} {data?.quarters?.[0]?.date ? `· Latest: ${data.quarters[0].date}` : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {overview.map((m) => (
              <div
                key={m.label}
                style={{
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: '0.6rem',
                }}
              >
                <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{m.label}</div>
                <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{m.value}</div>
              </div>
            ))}
          </div>
          {data && data.summary.totalQuarters === 0 && (
            <div style={{ marginTop: 10, color: '#6b7280', fontSize: '0.78rem' }}>
              Earnings data unavailable for this ticker.
            </div>
          )}
          {!fetchKey && !loading && !data && (
            <div style={{ marginTop: 10, color: '#6b7280', fontSize: '0.78rem' }}>
              Click ↻ Refresh to load data
            </div>
          )}
          {loading && <div style={{ marginTop: 10, color: '#9ca3af', fontSize: '0.8rem' }}>Loading earnings...</div>}
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
          <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Surprise Analysis</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Beat Rate (8Q)', value: fmtPct(data?.summary.beatRate, 0) },
              { label: 'Avg Surprise', value: fmtSurprise(data?.summary.avgSurprisePercent, 2) },
              { label: 'Estimate Revision (30D)', value: fmtSurprise(data?.summary.estimateRevision30dPct, 2) },
              { label: 'Earnings Momentum', value: data?.summary.earningsMomentum ?? 'unknown' },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: '0.6rem',
                }}
              >
                <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{m.label}</div>
                <div style={{ color: '#e5e7eb', fontWeight: 700, marginTop: 4 }}>{m.value}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, color: '#9ca3af', fontSize: '0.78rem' }}>Last 8 surprises</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 6 }}>
            {(data?.quarters ?? []).map((q, idx) => {
              const val = q.surprisePercent
              const color = val == null ? '#94a3b8' : val >= 0 ? '#34d399' : '#f87171'
              return (
                <div
                  key={`${q.date ?? 'q'}-${idx}`}
                  style={{
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: '0.45rem',
                    textAlign: 'center',
                    color,
                    fontSize: '0.74rem',
                  }}
                >
                  <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
                    {q.quarter} {q.date ? q.date.slice(2, 10) : ''}
                  </div>
                  <div>{fmtSurprise(val, 1)}</div>
                </div>
              )
            })}
            {(!data || data.quarters?.length === 0) && (
              <div style={{ gridColumn: '1 / -1', color: '#6b7280', fontSize: '0.75rem' }}>No recent surprises.</div>
            )}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>AI Earnings Insight</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', lineHeight: 1.6 }}>
          {data
            ? (() => {
                const total = data.summary.totalQuarters
                const beatCount = total ? Math.round(data.summary.beatRate * total) : 0
                const avg = fmtSurprise(data.summary.avgSurprisePercent, 2)
                const trend =
                  data.summary.trend === 'positive' ? 'positive'
                  : data.summary.trend === 'negative' ? 'negative'
                  : data.summary.trend === 'mixed' ? 'mixed'
                  : 'unknown'
                return `${data.symbol} beat EPS estimates in ${beatCount} of the last ${total} quarters, with an average surprise of ${avg}. Earnings trend currently looks ${trend}.`
              })()
            : 'AI insight will appear after data fetch.'}
        </div>
      </div>

      <div style={{ ...cardStyle, opacity: 0.65, filter: 'blur(0.8px)' }}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>Premium Earnings Pack</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem' }}>
          Unlock transcript highlights, guidance tone, and institutional revisions.
        </div>
      </div>
    </div>
  )
}
