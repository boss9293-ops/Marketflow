'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type EarningsPanelProps = {
  symbol: string
  fetchKey?: number
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Quarter = {
  date: string | null
  quarter: string
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  surprisePercent: number | null
}

type EarningsData = {
  symbol: string
  nextEarningsDate: string | null
  epsEstimate: number | null
  revenueEstimate: number | null
  quarters: Quarter[]
  summary: {
    beatRate: number
    totalQuarters: number
    avgSurprisePercent: number | null
    trend: 'positive' | 'mixed' | 'negative' | 'unknown'
    earningsMomentum: 'up' | 'down' | 'flat' | 'unknown'
  }
  rateLimited?: boolean
}

type AnalystData = {
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
  total: number
  consensus: string
  period: string | null
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtEps = (v: number | null | undefined) =>
  typeof v === 'number' && isFinite(v) ? `$${Math.abs(v).toFixed(2)}` : '--'

const fmtRev = (v: number | null | undefined) => {
  if (typeof v !== 'number' || !isFinite(v)) return '--'
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toFixed(0)}`
}

const fmtSurprise = (v: number | null | undefined) => {
  if (typeof v !== 'number' || !isFinite(v)) return null
  const pct = Math.abs(v) > 2 ? v : v * 100
  return { val: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, beat: pct > 0 }
}

const daysUntil = (dateStr: string | null) => {
  if (!dateStr) return null
  const diff = Math.round((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (diff < 0) return null
  return diff
}

const quarterLabel = (q: Quarter) => {
  if (!q.date) return q.quarter
  const d = new Date(q.date)
  const mo = d.getMonth() + 1
  const yr = String(d.getFullYear()).slice(2)
  if (mo <= 3) return `Q1'${yr}`
  if (mo <= 6) return `Q2'${yr}`
  if (mo <= 9) return `Q3'${yr}`
  return `Q4'${yr}`
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12 }}>
      {children}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'linear-gradient(145deg, rgba(30,33,41,0.95), rgba(20,22,29,0.95))',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 14,
      padding: '1rem 1.1rem',
      ...style,
    }}>
      {children}
    </div>
  )
}

function BeatPill({ beat, val }: { beat: boolean; val: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.45rem',
      borderRadius: 6,
      fontSize: '0.72rem',
      fontWeight: 700,
      background: beat ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
      color: beat ? '#4ade80' : '#f87171',
      border: `1px solid ${beat ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
    }}>
      {val}
    </span>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function EarningsPanel({ symbol, fetchKey = 0 }: EarningsPanelProps) {
  const [earnings, setEarnings] = useState<EarningsData | null>(null)
  const [analyst, setAnalyst] = useState<AnalystData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)
  const normalized = symbol.trim().toUpperCase()

  useEffect(() => {
    if (!normalized || !fetchKey) {
      setEarnings(null); setAnalyst(null); setLoading(false); setError(null)
      fetchingRef.current = false
      return
    }
    if (fetchingRef.current) return
    fetchingRef.current = true
    let active = true
    const ctrl = new AbortController()
    setLoading(true); setError(null)

    Promise.all([
      fetch(`/api/earnings/${normalized}`, { signal: ctrl.signal }).then(r => r.json()),
      fetch(`/api/analyst/${normalized}`, { signal: ctrl.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([earningsJson, analystJson]) => {
        if (!active) return
        if (earningsJson?.rateLimited) { setError('rate-limited'); return }
        setEarnings(earningsJson)
        setAnalyst(analystJson?.total > 0 ? analystJson : null)
      })
      .catch(err => {
        if (!active) return
        if (err.name === 'AbortError') return
        setError(err.message)
      })
      .finally(() => {
        fetchingRef.current = false
        if (active) setLoading(false)
      })

    return () => { active = false; ctrl.abort() }
  }, [normalized, fetchKey])

  // Sorted quarters newest→oldest
  const quarters = useMemo(() =>
    (earnings?.quarters ?? []).slice().sort((a, b) =>
      (a.date ?? '') > (b.date ?? '') ? -1 : 1
    ).slice(0, 8),
    [earnings]
  )

  const beatCount = useMemo(() =>
    quarters.filter(q => (q.surprisePercent ?? 0) > 0).length,
    [quarters]
  )

  const summary = earnings?.summary
  const beatRate = summary?.beatRate ?? 0
  const avgSurprise = summary?.avgSurprisePercent
  const trend = summary?.trend ?? 'unknown'
  const trendColor = trend === 'positive' ? '#4ade80' : trend === 'negative' ? '#f87171' : '#fbbf24'
  const days = daysUntil(earnings?.nextEarningsDate ?? null)

  // Analyst consensus bar widths
  const analystTotal = analyst?.total ?? 0
  const consensusColor = analyst?.consensus?.includes('Buy') ? '#4ade80' :
    analyst?.consensus?.includes('Sell') ? '#f87171' : '#fbbf24'

  if (!fetchKey) {
    return (
      <Card>
        <div style={{ color: '#475569', fontSize: '0.88rem', textAlign: 'center', padding: '2rem 0' }}>
          Click Analyze to load earnings data
        </div>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <div style={{ color: '#64748b', fontSize: '0.88rem', textAlign: 'center', padding: '2rem 0' }}>
          Loading earnings data...
        </div>
      </Card>
    )
  }

  if (error === 'rate-limited') {
    return (
      <Card>
        <div style={{ color: '#fbbf24', fontSize: '0.84rem', padding: '1rem', background: 'rgba(251,191,36,0.08)', borderRadius: 8 }}>
          Rate limit reached — try again in a few minutes
        </div>
      </Card>
    )
  }

  if (error || !earnings) {
    return (
      <Card>
        <div style={{ color: '#f87171', fontSize: '0.84rem' }}>{error ?? 'No earnings data available'}</div>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Row 1: Beat Summary Bar ── */}
      <Card>
        <SectionTitle>Earnings Track Record</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {/* Beat Rate */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Beat Rate</span>
              <span style={{ color: '#e2e8f0', fontSize: '0.88rem', fontWeight: 700 }}>
                {beatCount}/{quarters.length} &nbsp;
                <span style={{ color: beatRate >= 0.75 ? '#4ade80' : beatRate >= 0.5 ? '#fbbf24' : '#f87171' }}>
                  ({(beatRate * 100).toFixed(0)}%)
                </span>
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${beatRate * 100}%`,
                borderRadius: 3,
                background: beatRate >= 0.75 ? '#4ade80' : beatRate >= 0.5 ? '#fbbf24' : '#f87171',
                transition: 'width 0.6s ease',
              }} />
            </div>
          </div>
          {/* Avg Surprise */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: 4 }}>Avg Surprise</div>
            <div style={{
              fontSize: '1.5rem', fontWeight: 800,
              color: avgSurprise == null ? '#475569' : avgSurprise > 0 ? '#4ade80' : '#f87171',
            }}>
              {avgSurprise == null ? '--' : `${avgSurprise > 0 ? '+' : ''}${(Math.abs(avgSurprise) > 2 ? avgSurprise : avgSurprise * 100).toFixed(1)}%`}
            </div>
          </div>
          {/* Trend */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: 4 }}>Trend</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.3rem 0.75rem', borderRadius: 8, background: `${trendColor}18`, border: `1px solid ${trendColor}30` }}>
              <span style={{ color: trendColor, fontSize: '0.95rem', fontWeight: 800, textTransform: 'capitalize' }}>
                {trend === 'unknown' ? 'N/A' : trend.charAt(0).toUpperCase() + trend.slice(1)}
              </span>
              <span style={{ color: trendColor, fontSize: '1rem' }}>
                {trend === 'positive' ? '↑' : trend === 'negative' ? '↓' : '→'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Row 2: Next Earnings + Analyst Consensus ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>

        {/* Next Earnings */}
        <Card>
          <SectionTitle>Next Earnings</SectionTitle>
          {earnings.nextEarningsDate ? (
            <>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
                {earnings.nextEarningsDate}
              </div>
              {days !== null && (
                <div style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 6, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)', color: '#67e8f9', fontSize: '0.8rem', fontWeight: 600, marginBottom: 12 }}>
                  In {days} days
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>EPS Est</span>
                  <span style={{ color: '#cbd5e1', fontSize: '0.88rem', fontWeight: 600 }}>{fmtEps(earnings.epsEstimate)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Rev Est</span>
                  <span style={{ color: '#cbd5e1', fontSize: '0.88rem', fontWeight: 600 }}>{fmtRev(earnings.revenueEstimate)}</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: '#475569', fontSize: '0.84rem' }}>Date not available</div>
          )}
        </Card>

        {/* Analyst Consensus */}
        <Card>
          <SectionTitle>Analyst Consensus</SectionTitle>
          {analyst ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: consensusColor }}>{analyst.consensus}</span>
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{analyst.total} analysts</span>
                {analyst.period && <span style={{ color: '#475569', fontSize: '0.74rem', marginLeft: 'auto' }}>{analyst.period}</span>}
              </div>
              {/* Stacked bar */}
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 10, gap: 1 }}>
                {[
                  { count: analyst.strongBuy, color: '#16a34a' },
                  { count: analyst.buy, color: '#4ade80' },
                  { count: analyst.hold, color: '#fbbf24' },
                  { count: analyst.sell, color: '#f87171' },
                  { count: analyst.strongSell, color: '#dc2626' },
                ].filter(s => s.count > 0).map((s, i) => (
                  <div key={i} style={{ flex: s.count, background: s.color, minWidth: 2 }} />
                ))}
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Str Buy', count: analyst.strongBuy, color: '#16a34a' },
                  { label: 'Buy', count: analyst.buy, color: '#4ade80' },
                  { label: 'Hold', count: analyst.hold, color: '#fbbf24' },
                  { label: 'Sell', count: analyst.sell, color: '#f87171' },
                  { label: 'Str Sell', count: analyst.strongSell, color: '#dc2626' },
                ].filter(s => s.count > 0).map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                    <span style={{ color: '#94a3b8', fontSize: '0.74rem' }}>{s.label}</span>
                    <span style={{ color: '#e2e8f0', fontSize: '0.78rem', fontWeight: 700 }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: '#475569', fontSize: '0.84rem' }}>No analyst data available</div>
          )}
        </Card>
      </div>

      {/* ── Row 3: Quarterly Beat History ── */}
      <Card>
        <SectionTitle>Quarterly Beat History — Last {quarters.length} Quarters</SectionTitle>
        {quarters.length === 0 ? (
          <div style={{ color: '#475569', fontSize: '0.84rem' }}>No quarterly data</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${quarters.length}, 1fr)`, gap: 6, minWidth: 560 }}>
              {quarters.map((q, i) => {
                const surprise = fmtSurprise(q.surprisePercent)
                const beat = (q.surprisePercent ?? 0) > 0
                const revBeat = q.revenueActual !== null && q.revenueEstimate !== null
                  ? q.revenueActual >= q.revenueEstimate
                  : null
                return (
                  <div key={i} style={{
                    borderRadius: 10,
                    background: beat ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
                    border: `1px solid ${beat ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'}`,
                    padding: '0.6rem 0.5rem',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}>
                    {/* Quarter label */}
                    <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em' }}>
                      {quarterLabel(q)}
                    </div>
                    {/* EPS */}
                    <div>
                      <div style={{ color: '#64748b', fontSize: '0.65rem', marginBottom: 2 }}>EPS</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                        {q.epsActual !== null && (
                          <span style={{ color: beat ? '#4ade80' : '#f87171', fontSize: '0.82rem', fontWeight: 700 }}>
                            {fmtEps(q.epsActual)}
                          </span>
                        )}
                        {q.epsEstimate !== null && (
                          <span style={{ color: '#475569', fontSize: '0.68rem' }}>
                            est {fmtEps(q.epsEstimate)}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Revenue */}
                    {(q.revenueActual !== null || q.revenueEstimate !== null) && (
                      <div>
                        <div style={{ color: '#64748b', fontSize: '0.65rem', marginBottom: 2 }}>REV</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                          {q.revenueActual !== null && (
                            <span style={{ color: revBeat === null ? '#94a3b8' : revBeat ? '#4ade80' : '#f87171', fontSize: '0.76rem', fontWeight: 600 }}>
                              {fmtRev(q.revenueActual)}
                            </span>
                          )}
                          {q.revenueEstimate !== null && (
                            <span style={{ color: '#475569', fontSize: '0.65rem' }}>
                              est {fmtRev(q.revenueEstimate)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {/* Surprise badge */}
                    {surprise && (
                      <BeatPill beat={surprise.beat} val={surprise.val} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

    </div>
  )
}
