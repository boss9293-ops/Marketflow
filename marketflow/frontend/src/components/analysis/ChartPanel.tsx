'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { type StockAnalysisResponse } from '@/lib/stockAnalysis'

type DepthType = 'beginner' | 'intermediate' | 'quant'

type ChartPanelProps = {
  symbol: string
  depth: DepthType
}

const card: React.CSSProperties = {
  background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '0.85rem 0.95rem',
}

const sectionTitle: React.CSSProperties = {
  color: '#cbd5e1',
  fontSize: '0.82rem',
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  marginBottom: 10,
}

const fmt2 = (v: number | null | undefined) =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(2) : '--'

const fmtPct = (v: number | null | undefined) =>
  typeof v === 'number' && isFinite(v)
    ? `${v >= 0 ? '\u25b2' : '\u25bc'}${Math.abs(v * 100).toFixed(1)}%`
    : '--'

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_STOCK_DATA === 'true'

export default function ChartPanel({ symbol, depth }: ChartPanelProps) {
  const tvContainerRef = useRef<HTMLDivElement | null>(null)
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisNotFound, setAnalysisNotFound] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  const tvSymbol = useMemo(() => {
    const raw = symbol.trim().toUpperCase()
    if (!raw) return 'NASDAQ:AAPL'
    if (raw.includes(':')) return raw
    return `NASDAQ:${raw}`
  }, [symbol])

  const baseSymbol = useMemo(() => {
    const raw = symbol.trim().toUpperCase()
    if (raw.includes(':')) return raw.split(':').pop() || raw
    return raw || 'AAPL'
  }, [symbol])

  // Fetch analysis for right panel cards
  useEffect(() => {
    if (!baseSymbol || USE_MOCK) return
    let alive = true
    const ctrl = new AbortController()
    setLoadingAnalysis(true)
    setAnalysisError(null)
    setAnalysisNotFound(false)
    fetch('/api/analyze/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: baseSymbol }),
      signal: ctrl.signal,
    })
      .then(async r => {
        if (!r.ok) throw new Error(`Server error (${r.status})`)
        return r.json()
      })
      .then(d => {
        if (!alive) return
        if (!d || !d.current_price) setAnalysisNotFound(true)
        else setAnalysis(d)
      })
      .catch(err => {
        if (!alive || err.name === 'AbortError') return
        setAnalysisError(err.message || 'Failed to load data')
      })
      .finally(() => { if (alive) setLoadingAnalysis(false) })
    return () => { alive = false; ctrl.abort() }
  }, [baseSymbol, retryKey])

  // TradingView widget — MA 20/50/120/200 pre-loaded
  useEffect(() => {
    if (USE_MOCK || !tvContainerRef.current) return
    tvContainerRef.current.innerHTML = ''
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: 'D',
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: false,
      details: true,
      hotlist: false,
      calendar: false,
      studies: [
        { id: 'MASimple@tv-basicstudies', inputs: { length: 20 } },
        { id: 'MASimple@tv-basicstudies', inputs: { length: 50 } },
        { id: 'MASimple@tv-basicstudies', inputs: { length: 120 } },
        { id: 'MASimple@tv-basicstudies', inputs: { length: 200 } },
        { id: 'RSI@tv-basicstudies' },
      ],
      support_host: 'https://www.tradingview.com',
    })
    tvContainerRef.current.appendChild(script)
    return () => { if (tvContainerRef.current) tvContainerRef.current.innerHTML = '' }
  }, [tvSymbol])

  // Technical signal
  const tech = useMemo(() => {
    if (!analysis) return null
    const v = analysis.valuation
    const price = analysis.current_price
    if (!price || !v) return null

    const sma20 = v.sma20 ?? null
    const sma50 = v.sma50 ?? null
    const sma120 = v.sma120 ?? null
    const sma200 = v.sma200 ?? null
    const rsi = v.rsi14 ?? null

    let trendLabel = 'Unknown'
    let trendColor = '#9ca3af'
    if (sma20 !== null && sma50 !== null && sma200 !== null) {
      if (price > sma20 && sma20 > sma50 && sma50 > sma200) {
        trendLabel = 'Strong Bull'; trendColor = '#4ade80'
      } else if (price > sma50 && sma50 > sma200) {
        trendLabel = 'Bullish'; trendColor = '#86efac'
      } else if (price > sma200) {
        trendLabel = 'Neutral +'; trendColor = '#fbbf24'
      } else if (price < sma20 && sma20 < sma50 && sma50 < sma200) {
        trendLabel = 'Strong Bear'; trendColor = '#f87171'
      } else if (price < sma50 && sma50 < sma200) {
        trendLabel = 'Bearish'; trendColor = '#fca5a5'
      } else {
        trendLabel = 'Neutral -'; trendColor = '#f97316'
      }
    }

    const rsiLabel = rsi !== null ? rsi.toFixed(1) : '--'
    const rsiSub = rsi === null ? '' : rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral'
    const rsiColor = rsi === null ? '#9ca3af' : rsi > 70 ? '#f87171' : rsi < 30 ? '#4ade80' : '#fbbf24'

    const hi1y = v.price_high_1y
    const lo1y = v.price_low_1y
    const posLabel =
      hi1y && lo1y && hi1y > lo1y
        ? `${Math.round(((price - lo1y) / (hi1y - lo1y)) * 100)}%`
        : '--'

    return { trendLabel, trendColor, rsiLabel, rsiSub, rsiColor, posLabel, sma20, sma50, sma120, sma200 }
  }, [analysis])

  // Key price levels
  const levels = useMemo(() => {
    if (!analysis) return []
    const p = analysis.current_price
    const v = analysis.valuation
    const c = analysis.consensus
    const s = analysis.scenario
    if (!p) return []

    const row = (label: string, val: number | null | undefined, col: string) => {
      if (val == null || !isFinite(val)) return null
      return { label, val, pct: (val - p) / p, col }
    }

    return [
      row('52W High', v?.price_high_1y, '#4ade80'),
      row('52W Low', v?.price_low_1y, '#f87171'),
      row('Analyst Target', c?.target_mean, '#67e8f9'),
      row('Bull Case (3Y)', s?.bull, '#86efac'),
      row('Bear Case (3Y)', s?.bear, '#fca5a5'),
      row('SMA 200', v?.sma200, '#94a3b8'),
    ].filter(Boolean) as Array<{ label: string; val: number; pct: number; col: string }>
  }, [analysis])

  // Price performance periods
  const perfRows = useMemo(() => {
    const v = analysis?.valuation
    if (!v) return []
    return [
      { label: '1W', key: 'perf_1w' as const },
      { label: '1M', key: 'perf_1m' as const },
      { label: '3M', key: 'perf_3m' as const },
      { label: '6M', key: 'perf_6m' as const },
      { label: '1Y', key: 'perf_1y' as const },
      { label: 'YTD', key: 'perf_ytd' as const },
    ].map(r => ({ label: r.label, pct: v[r.key] ?? null }))
  }, [analysis])

  const MAs = [
    { label: 'MA 20',  key: 'sma20'  as const, color: '#ef4444' },
    { label: 'MA 50',  key: 'sma50'  as const, color: '#f97316' },
    { label: 'MA 120', key: 'sma120' as const, color: '#eab308' },
    { label: 'MA 200', key: 'sma200' as const, color: '#e2e8f0' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 300px', gap: 12 }}>

      {/* Left: TradingView chart */}
      <div style={{ ...card, padding: '0.6rem 0.6rem 0.9rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.4rem 0.6rem' }}>
          <div style={{ color: '#d1d5db', fontWeight: 700 }}>TradingView Chart</div>
          <div style={{ color: '#6b7280', fontSize: '0.74rem' }}>{tvSymbol}</div>
        </div>
        {USE_MOCK ? (
          <div style={{ width: '100%', height: 660, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#0b0f15', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
            Mock mode — chart disabled
          </div>
        ) : (
          <div ref={tvContainerRef} style={{ width: '100%', height: 660, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#0b0f15' }} />
        )}
        <div style={{ color: '#4b5563', fontSize: '0.72rem', marginTop: 6, paddingLeft: 6 }}>
          Powered by TradingView (free widget) · MA 20 / 50 / 120 / 200 pre-loaded
        </div>
      </div>

      {/* Right: signal cards (or error/loading state) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Error state — Terminal Signal */}
        {analysisError && (
          <div style={{ position: 'relative', background: '#080808', borderLeft: '3px solid #FF5C33', overflow: 'hidden', borderRadius: 2, padding: '22px 20px 22px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 200 }}>
            <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#FF5C33', opacity: 0.07, top: 10, right: -10, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>ERR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
              <span style={{ display: 'inline-block', background: 'rgba(255,92,51,0.09)', color: '#FF5C33', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>CONNECTION_FAILED</span>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>데이터를 불러올 수 없습니다</div>
              <div style={{ color: '#4a4a4a', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.7 }}>{analysisError}</div>
            </div>
            <button
              onClick={() => { setAnalysisError(null); setRetryKey(k => k + 1) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(255,92,51,0.33)', background: 'transparent', color: '#FF5C33', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, fontWeight: 600, letterSpacing: '1px', padding: '6px 12px', borderRadius: 2, cursor: 'pointer', width: 'fit-content', marginTop: 12 }}
            >
              ↻  RETRY
            </button>
          </div>
        )}

        {/* Symbol not found — Terminal Signal */}
        {analysisNotFound && (
          <div style={{ position: 'relative', background: '#080808', borderLeft: '3px solid #FF8400', overflow: 'hidden', borderRadius: 2, padding: '22px 20px 22px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 200 }}>
            <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#FF8400', opacity: 0.06, top: 10, right: -10, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>404</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
              <span style={{ display: 'inline-block', background: 'rgba(255,132,0,0.09)', color: '#FF8400', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>TICKER_NOT_FOUND</span>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>종목을 찾을 수 없습니다</div>
              <div style={{ color: '#4a4a4a', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.7 }}>유효하지 않은 티커입니다. 심볼을 다시 확인하세요.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <div style={{ width: 16, height: 1, background: 'rgba(255,132,0,0.27)' }} />
              <span style={{ color: '#333', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '1.5px' }}>AAPL  NVDA  MSFT  QQQ</span>
            </div>
          </div>
        )}

        {/* Normal cards — hidden when error or notFound */}
        <div style={{ display: analysisError || analysisNotFound ? 'none' : 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Card 1: Technical Signal */}
        <div style={card}>
          <div style={sectionTitle}>Technical Signal</div>
          {loadingAnalysis && !tech ? (
            <div style={{ color: '#64748b', fontSize: '0.84rem' }}>Analyzing...</div>
          ) : tech ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: 10 }}>
                {[
                  { lbl: 'TREND', val: tech.trendLabel, sub: '', color: tech.trendColor },
                  { lbl: 'RSI 14', val: tech.rsiLabel, sub: tech.rsiSub, color: tech.rsiColor },
                  { lbl: '52W POS', val: tech.posLabel, sub: '', color: '#e2e8f0' },
                ].map(pill => (
                  <div key={pill.lbl} style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.45rem 0.3rem', textAlign: 'center' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginBottom: 3, letterSpacing: '0.1em' }}>{pill.lbl}</div>
                    <div style={{ color: pill.color, fontWeight: 700, fontSize: '0.78rem', lineHeight: 1.2 }}>{pill.val}</div>
                    {pill.sub && <div style={{ color: pill.color, fontSize: '0.70rem', opacity: 0.8 }}>{pill.sub}</div>}
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {MAs.map(ma => (
                  <div key={ma.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: ma.color, fontSize: '0.80rem', fontWeight: 600 }}>{ma.label}</span>
                    <span style={{ color: '#e2e8f0', fontSize: '0.82rem' }}>
                      {tech[ma.key] !== null ? `$${fmt2(tech[ma.key])}` : '--'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: '#64748b', fontSize: '0.82rem' }}>No data available</div>
          )}
        </div>

        {/* Card 2: Key Levels */}
        <div style={card}>
          <div style={sectionTitle}>Key Levels</div>
          {loadingAnalysis && levels.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '0.84rem' }}>Loading...</div>
          ) : levels.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {levels.map(l => (
                <div key={l.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#94a3b8', fontSize: '0.80rem' }}>{l.label}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ color: l.col, fontWeight: 700, fontSize: '0.82rem' }}>${fmt2(l.val)}</span>
                    <span style={{ color: l.pct >= 0 ? '#4ade80' : '#f87171', fontSize: '0.72rem', minWidth: 48, textAlign: 'right' }}>
                      {fmtPct(l.pct)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#64748b', fontSize: '0.82rem' }}>No data available</div>
          )}
        </div>

        {/* Card 3: Performance */}
        <div style={card}>
          <div style={sectionTitle}>Price Performance</div>
          {loadingAnalysis && !analysis ? (
            <div style={{ color: '#64748b', fontSize: '0.84rem' }}>Loading...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
              {perfRows.map(r => {
                const pct = r.pct
                const color = pct == null ? '#4b5563' : pct >= 0 ? '#4ade80' : '#f87171'
                const val = pct == null
                  ? '--'
                  : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`
                return (
                  <div key={r.label} style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.4rem 0.3rem', textAlign: 'center' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginBottom: 3, letterSpacing: '0.1em' }}>{r.label}</div>
                    <div style={{ color, fontWeight: 700, fontSize: '0.84rem' }}>{val}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        </div>
      </div>
    </div>
  )
}
