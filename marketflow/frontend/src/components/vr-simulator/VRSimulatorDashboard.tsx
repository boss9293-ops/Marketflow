'use client'

import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import CapitalChart from '@/components/vr-simulator/CapitalChart'
import DebugStateTable from '@/components/vr-simulator/DebugStateTable'
import InputPanel from '@/components/vr-simulator/InputPanel'
import PortfolioChart from '@/components/vr-simulator/PortfolioChart'
import PriceChart from '@/components/vr-simulator/PriceChart'
import RatioChart from '@/components/vr-simulator/RatioChart'
import SummaryCards from '@/components/vr-simulator/SummaryCards'
import TradeLogTable from '@/components/vr-simulator/TradeLogTable'
import { LocalVrDataSource } from '@/data/sampleData'
import { buildPerformanceMetrics } from '@/lib/backtest/metrics'
import { BacktestResult, DailyBar, StrategyInputs } from '@/lib/backtest/types'
import { runVrGValueBacktest, VR_G_VALUE_DEFAULTS } from '@/lib/backtest/vrGValueStrategy'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'

const tabs = ['Charts', 'Trades', 'Debug'] as const
type DashboardTab = (typeof tabs)[number]

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: DashboardTab
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 999,
        border: `1px solid ${active ? 'rgba(196,255,13,0.24)' : 'rgba(255,255,255,0.08)'}`,
        background: active ? 'rgba(196,255,13,0.10)' : 'rgba(255,255,255,0.03)',
        color: active ? '#d9f99d' : '#cbd5e1',
        padding: '0.55rem 0.9rem',
        fontSize: '0.82rem',
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {tab}
    </button>
  )
}

export default function VRSimulatorDashboard({
  sources,
  datasets,
  defaultSymbol,
}: {
  sources: LocalVrDataSource[]
  datasets: Record<string, DailyBar[]>
  defaultSymbol: string
}) {
  const [localDatasets, setLocalDatasets] = useState<Record<string, DailyBar[]>>(() => datasets)
  const [fetchingSymbol, setFetchingSymbol] = useState<string | null>(null)
  const [inputs, setInputs] = useState<StrategyInputs>({
    ...VR_G_VALUE_DEFAULTS,
    symbol: defaultSymbol,
  })
  const [result, setResult] = useState<BacktestResult>(() =>
    runVrGValueBacktest(localDatasets[defaultSymbol] ?? [], {
      ...VR_G_VALUE_DEFAULTS,
      symbol: defaultSymbol,
    }),
  )
  const [activeTab, setActiveTab] = useState<DashboardTab>('Charts')
  const deferredInputs = useDeferredValue(inputs)

  useEffect(() => {
    const sym = deferredInputs.symbol
    if (localDatasets[sym]) return
    setFetchingSymbol(sym)
    fetch(`/api/vr-ohlcv/${encodeURIComponent(sym)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.bars) return
        const bars: DailyBar[] = (d.bars as any[]).map(b => ({
          date: b.d, open: b.o ?? b.c, high: b.h ?? b.c,
          low: b.l ?? b.c, close: b.c, volume: b.v ?? 0,
        }))
        setLocalDatasets(prev => ({ ...prev, [sym]: bars }))
      })
      .catch(() => {})
      .finally(() => setFetchingSymbol(null))
  }, [deferredInputs.symbol, localDatasets])

  useEffect(() => {
    const bars = localDatasets[deferredInputs.symbol] ?? []
    const nextResult = runVrGValueBacktest(bars, deferredInputs)
    startTransition(() => {
      setResult(nextResult)
    })
  }, [localDatasets, deferredInputs])

  const metrics = buildPerformanceMetrics(result.symbol, result.rows, result.trades)
  const symbolLabel = sources.find((source) => source.symbol === inputs.symbol)?.label ?? inputs.symbol

  return (
    <div
      style={{
        padding: '1.5rem',
        background:
          'radial-gradient(circle at top right, rgba(245,158,11,0.10), transparent 28%), radial-gradient(circle at top left, rgba(56,189,248,0.10), transparent 32%), #05070b',
        color: '#f8fafc',
      }}
    >
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(300px, 360px) minmax(0, 1fr)',
            gap: '1rem',
            alignItems: 'start',
          }}
        >
          <InputPanel
            inputs={inputs}
            validationIssues={result.validationIssues}
            symbolOptions={sources.map((source) => ({
              symbol: source.symbol,
              label: source.label,
            }))}
            onChange={(field, value) => {
              setInputs((previous) => ({
                ...previous,
                [field]: value,
              }))
            }}
          />

          <div style={{ display: 'grid', gap: '1rem' }}>
            <header>
              <div style={{ color: '#d9f99d', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                VR-Test Phase 4
              </div>
              <h1 style={{ margin: '0.35rem 0 0', fontSize: '2rem', fontWeight: 800 }}>
                VR G-Value Simulator
              </h1>
              <p style={{ color: '#b9c9dd', maxWidth: 860, lineHeight: 1.6, marginTop: '0.45rem' }}>
                The server only delivers sample historical OHLCV data. The client owns the strategy inputs and reruns the full account-based backtest immediately on every valid change.
              </p>
              <div style={{ color: '#8ea1b9', fontSize: '0.84rem', marginTop: '0.5rem' }}>
                Symbol: {result.symbol} · {symbolLabel} · Eligible bars: {result.summary.eligibleBars} · Trades: {result.summary.tradeCount}{fetchingSymbol ? ' · loading…' : ''}
              </div>
            </header>

            <SummaryCards metrics={metrics} />

            <section
              style={{
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(15,20,30,0.92)',
                padding: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {tabs.map((tab) => (
                  <TabButton key={tab} tab={tab} active={tab === activeTab} onClick={() => setActiveTab(tab)} />
                ))}
              </div>
            </section>

            {result.rows.length > 0 && activeTab === 'Charts' ? (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <PriceChart rows={result.rows} />
                <PortfolioChart rows={result.rows} />
                <CapitalChart rows={result.rows} />
                <RatioChart rows={result.rows} />
              </div>
            ) : null}

            {activeTab === 'Trades' ? <TradeLogTable trades={result.trades} /> : null}
            {activeTab === 'Debug' ? <DebugStateTable rows={result.rows} /> : null}

            {result.rows.length === 0 ? (
              <section
                style={{
                    borderRadius: 18,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(15,20,30,0.92)',
                    padding: '1rem',
                    color: '#cbd5e1',
                    lineHeight: 1.6,
                }}
              >
                Fix the validation issues in the input panel to produce a backtest result.
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
