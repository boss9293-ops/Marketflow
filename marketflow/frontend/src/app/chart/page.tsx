'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import TopicTabs, { type TabType } from '@/components/analysis/TopicTabs'
import ChartPanel from '@/components/analysis/ChartPanel'
import ValuationPanel from '@/components/analysis/ValuationPanel'
import StatisticsPanel from '@/components/analysis/StatisticsPanel'
import FinancialsPanel from '@/components/analysis/FinancialsPanel'
import { stockProfiles } from '@/lib/mock/stockProfile'

type DepthType = 'beginner' | 'intermediate' | 'quant'

const panelStyle = {
  background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '0.95rem',
} as const

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_STOCK_DATA === 'true'

const SYMBOL_META: Record<string, { name: string; exchange: string; sector: string }> = {
  // Mega-cap tech
  AAPL: { name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Technology' },
  MSFT: { name: 'Microsoft', exchange: 'NASDAQ', sector: 'Technology' },
  NVDA: { name: 'NVIDIA', exchange: 'NASDAQ', sector: 'Technology' },
  GOOG: { name: 'Alphabet', exchange: 'NASDAQ', sector: 'Communication' },
  GOOGL: { name: 'Alphabet', exchange: 'NASDAQ', sector: 'Communication' },
  META: { name: 'Meta Platforms', exchange: 'NASDAQ', sector: 'Communication' },
  AMZN: { name: 'Amazon.com', exchange: 'NASDAQ', sector: 'Consumer Discretionary' },
  TSLA: { name: 'Tesla', exchange: 'NASDAQ', sector: 'Consumer Discretionary' },
  // Semiconductors
  AMD: { name: 'Advanced Micro Devices', exchange: 'NASDAQ', sector: 'Technology' },
  INTC: { name: 'Intel', exchange: 'NASDAQ', sector: 'Technology' },
  AVGO: { name: 'Broadcom', exchange: 'NASDAQ', sector: 'Technology' },
  QCOM: { name: 'Qualcomm', exchange: 'NASDAQ', sector: 'Technology' },
  // Finance
  BRK: { name: 'Berkshire Hathaway', exchange: 'NYSE', sector: 'Financials' },
  JPM: { name: 'JPMorgan Chase', exchange: 'NYSE', sector: 'Financials' },
  V: { name: 'Visa', exchange: 'NYSE', sector: 'Financials' },
  MA: { name: 'Mastercard', exchange: 'NYSE', sector: 'Financials' },
  GS: { name: 'Goldman Sachs', exchange: 'NYSE', sector: 'Financials' },
  // Healthcare
  UNH: { name: 'UnitedHealth Group', exchange: 'NYSE', sector: 'Healthcare' },
  JNJ: { name: 'Johnson & Johnson', exchange: 'NYSE', sector: 'Healthcare' },
  LLY: { name: 'Eli Lilly', exchange: 'NYSE', sector: 'Healthcare' },
  // Consumer
  COST: { name: 'Costco', exchange: 'NASDAQ', sector: 'Consumer Staples' },
  WMT: { name: 'Walmart', exchange: 'NYSE', sector: 'Consumer Staples' },
  HD: { name: 'Home Depot', exchange: 'NYSE', sector: 'Consumer Discretionary' },
  NKE: { name: 'Nike', exchange: 'NYSE', sector: 'Consumer Discretionary' },
  // Other large cap
  NFLX: { name: 'Netflix', exchange: 'NASDAQ', sector: 'Communication' },
  CRM: { name: 'Salesforce', exchange: 'NYSE', sector: 'Technology' },
  ORCL: { name: 'Oracle', exchange: 'NYSE', sector: 'Technology' },
  ADBE: { name: 'Adobe', exchange: 'NASDAQ', sector: 'Technology' },
  NOW: { name: 'ServiceNow', exchange: 'NYSE', sector: 'Technology' },
  UBER: { name: 'Uber', exchange: 'NYSE', sector: 'Technology' },
  // ETFs
  QQQ: { name: 'Invesco QQQ', exchange: 'NASDAQ', sector: 'ETF' },
  TQQQ: { name: 'ProShares UltraPro QQQ', exchange: 'NASDAQ', sector: 'ETF' },
  SPY: { name: 'SPDR S&P 500', exchange: 'NYSE Arca', sector: 'ETF' },
  IWM: { name: 'iShares Russell 2000', exchange: 'NYSE Arca', sector: 'ETF' },
  DIA: { name: 'SPDR Dow Jones', exchange: 'NYSE Arca', sector: 'ETF' },
  SOXL: { name: 'Direxion Semis 3X', exchange: 'NYSE Arca', sector: 'ETF' },
}

export default function StockAnalysisPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [committedSymbol, setCommittedSymbol] = useState('AAPL')
  const [ownedToggle, setOwnedToggle] = useState<'new' | 'owned'>('new')
  const depth: DepthType = 'intermediate'
  const [activeTab, setActiveTab] = useState<TabType>('chart')
  const analyzeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [valKey, setValKey] = useState(0)
  const [statsKey, setStatsKey] = useState(0)
  const [finKey, setFinKey] = useState(0)

  const handleAnalyze = useCallback(() => {
    const next = symbol.trim().toUpperCase()
    if (!next || next === committedSymbol || analyzing) return
    if (analyzeDebounceRef.current) clearTimeout(analyzeDebounceRef.current)
    setAnalyzing(true)
    setCommittedSymbol(next)
    setValKey((k) => k + 1)
    setStatsKey((k) => k + 1)
    setFinKey((k) => k + 1)
    analyzeDebounceRef.current = setTimeout(() => setAnalyzing(false), 2000)
  }, [symbol, committedSymbol, analyzing])

  const handleRefresh = useCallback(() => {
    setValKey((k) => k + 1)
    setStatsKey((k) => k + 1)
    setFinKey((k) => k + 1)
  }, [])

  const tvSymbol = useMemo(() => {
    const raw = committedSymbol.trim().toUpperCase()
    if (!raw) return 'NASDAQ:AAPL'
    if (raw.includes(':')) return raw
    const map: Record<string, string> = {
      SPY: 'AMEX:SPY',
      QQQ: 'NASDAQ:QQQ',
      TQQQ: 'NASDAQ:TQQQ',
      IWM: 'AMEX:IWM',
      DIA: 'AMEX:DIA',
      VIX: 'CBOE:VIX',
      SOXL: 'NASDAQ:SOXL',
      TECL: 'NASDAQ:TECL',
      AAPL: 'NASDAQ:AAPL',
      MSFT: 'NASDAQ:MSFT',
      NVDA: 'NASDAQ:NVDA',
    }
    return map[raw] || `NASDAQ:${raw}`
  }, [committedSymbol])

  const baseSymbol = useMemo(() => {
    const raw = committedSymbol.trim().toUpperCase()
    if (!raw) return 'AAPL'
    if (raw.includes(':')) return raw.split(':').pop() || raw
    return raw
  }, [committedSymbol])

  const meta = USE_MOCK
    ? (stockProfiles[baseSymbol] || stockProfiles.AAPL)
    : (SYMBOL_META[baseSymbol] || { name: 'Unknown', exchange: '--', sector: '--' })

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 1380,
        margin: '0 auto',
        padding: '1.35rem 1.25rem 2.2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
          Stock <span style={{ color: '#00D9FF' }}>Analysis</span>
        </h1>
        <div style={{ color: '#8b93a8', fontSize: '0.82rem', marginTop: 4 }}>
          Topic-based analysis workspace for one ticker at a time.
        </div>
      </div>

      {/* Symbol + Active Meta (Merged 2+3) */}
      <section style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#aeb6c8', fontSize: '0.78rem' }}>Ticker</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze() }}
              placeholder="AAPL"
              style={{
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.04)',
                color: '#f4f6fb',
                borderRadius: 8,
                padding: '0.36rem 0.55rem',
                minWidth: 120,
                textTransform: 'uppercase',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ color: '#6b7280', fontSize: '0.72rem' }}>
            Panels update only when you press Analyze.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {(['new', 'owned'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setOwnedToggle(mode)}
                style={{
                  border: `1px solid ${ownedToggle === mode ? 'rgba(0,217,255,0.45)' : 'rgba(255,255,255,0.12)'}`,
                  background: ownedToggle === mode ? 'rgba(0,217,255,0.16)' : 'rgba(255,255,255,0.04)',
                  color: ownedToggle === mode ? '#67e8f9' : '#9ca3af',
                  borderRadius: 999,
                  padding: '0.28rem 0.7rem',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {mode === 'new' ? 'New' : 'Owned'}
              </button>
            ))}
          </div>

          <button
            style={{
              border: '1px solid rgba(148,163,184,0.35)',
              background: 'rgba(148,163,184,0.12)',
              color: '#cbd5f5',
              borderRadius: 8,
              padding: '0.34rem 0.62rem',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            History
          </button>

          <button
            onClick={handleAnalyze}
            disabled={analyzing || symbol.trim().toUpperCase() === committedSymbol}
            style={{
              border: `1px solid ${analyzing ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.35)'}`,
              background: analyzing ? 'rgba(34,197,94,0.06)' : 'rgba(34,197,94,0.14)',
              color: analyzing ? '#6b7280' : '#86efac',
              borderRadius: 8,
              padding: '0.34rem 0.62rem',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: analyzing ? 'not-allowed' : 'pointer',
            }}
          >
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </button>

          <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: '0.74rem' }}>
            Active: {tvSymbol}
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f3f4f6' }}>{baseSymbol}</div>
          <div style={{ color: '#9ca3af', fontSize: '0.86rem', marginTop: 2 }}>
            {meta.name} - {meta.exchange}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 2 }}>{meta.sector}</div>
        </div>
      </section>

      {/* Topic Tabs + Refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TopicTabs activeTab={activeTab} onChange={setActiveTab} />
        {activeTab !== 'chart' && (
          <button
            onClick={handleRefresh}
            style={{
              marginLeft: 'auto',
              border: '1px solid rgba(0,217,255,0.35)',
              background: 'rgba(0,217,255,0.10)',
              color: '#67e8f9',
              borderRadius: 8,
              padding: '0.34rem 0.75rem',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            ↻ Refresh
          </button>
        )}
      </div>

      {/* Active Panel — chart is conditionally mounted (TradingView widget is heavy) */}
      {activeTab === 'chart' && (
        <ChartPanel symbol={tvSymbol} depth={depth} />
      )}

      {/* Data panels stay mounted to preserve fetched data across tab switches */}
      <div style={{ display: activeTab === 'valuation' ? undefined : 'none' }}>
        <ValuationPanel symbol={committedSymbol} fetchKey={valKey} />
      </div>
      <div style={{ display: activeTab === 'statistics' ? undefined : 'none' }}>
        <StatisticsPanel symbol={committedSymbol} fetchKey={statsKey} />
      </div>
      <div style={{ display: activeTab === 'financials' ? undefined : 'none' }}>
        <FinancialsPanel symbol={committedSymbol} fetchKey={finKey} />
      </div>
    </div>
  )
}
