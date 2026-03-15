'use client'

import { useEffect, useMemo, useRef } from 'react'
import { mockValuation } from '@/lib/mock/valuation'

type DepthType = 'beginner' | 'intermediate' | 'quant'

type ChartPanelProps = {
  symbol: string
  depth: DepthType
}

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '0.95rem',
}

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_STOCK_DATA === 'true'

export default function ChartPanel({ symbol, depth }: ChartPanelProps) {
  const tvContainerRef = useRef<HTMLDivElement | null>(null)

  const tvSymbol = useMemo(() => {
    const raw = symbol.trim().toUpperCase()
    if (!raw) return 'NASDAQ:AAPL'
    if (raw.includes(':')) return raw
    return `NASDAQ:${raw}`
  }, [symbol])

  useEffect(() => {
    if (USE_MOCK) return
    if (!tvContainerRef.current) return
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
      hotlist: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    })
    tvContainerRef.current.appendChild(script)
    return () => {
      if (tvContainerRef.current) tvContainerRef.current.innerHTML = ''
    }
  }, [tvSymbol])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 0.9fr', gap: 12 }}>
      <div style={{ ...cardStyle, padding: '0.6rem 0.6rem 0.9rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.4rem 0.6rem' }}>
          <div style={{ color: '#d1d5db', fontWeight: 700 }}>TradingView Chart</div>
          <div style={{ color: '#6b7280', fontSize: '0.74rem' }}>{tvSymbol}</div>
        </div>
        {USE_MOCK ? (
          <div
            style={{
              width: '100%',
              height: 560,
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'linear-gradient(180deg, rgba(15,18,26,0.95), rgba(7,10,16,0.95))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9ca3af',
              fontSize: '0.9rem',
            }}
          >
            Mock mode enabled — external chart disabled
          </div>
        ) : (
          <div
            ref={tvContainerRef}
            style={{
              width: '100%',
              height: 560,
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)',
              background: '#0b0f15',
            }}
          />
        )}
        <div style={{ color: '#6b7280', fontSize: '0.72rem', marginTop: 6, paddingLeft: 6 }}>
          {USE_MOCK ? 'Mock data mode: chart disabled' : 'Powered by TradingView (free widget with branding).'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
        <div style={cardStyle}>
          <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>Technical Indicators</div>
          <ul style={{ color: '#9ca3af', fontSize: '0.82rem', lineHeight: 1.6, paddingLeft: 16 }}>
            <li>Trend: SMA20 / SMA50 / SMA200</li>
            <li>Momentum: RSI(14), MACD</li>
            <li>Volatility: ATR, Bollinger Bands</li>
            <li>Volume: OBV / VWAP</li>
          </ul>
        </div>
        <div style={cardStyle}>
          <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>AI Chart Summary</div>
          <div style={{ color: '#9ca3af', fontSize: '0.82rem', lineHeight: 1.6 }}>
            Depth: <span style={{ color: '#e5e7eb', fontWeight: 700 }}>{depth}</span>
            <div style={{ marginTop: 8 }}>
              {USE_MOCK
                ? (() => {
                    const base = tvSymbol.includes(':') ? tvSymbol.split(':').pop() || 'AAPL' : tvSymbol
                    const mock = mockValuation[base] || mockValuation.AAPL
                    return `${mock.symbol} trades around $${mock.currentPrice.toFixed(2)} with ${Math.round(mock.upsidePct * 100)}% base-case upside. Trend remains constructive but watch momentum around the next earnings window.`
                  })()
                : 'Auto summary will be updated after data pipeline is connected.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
