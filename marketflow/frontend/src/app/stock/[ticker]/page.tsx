'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import ChartValuationOverlay from '@/components/analysis/ChartValuationOverlay'
import StockHeader from '@/components/stock/StockHeader'
import StockConsensusPanel from '@/components/stock/StockConsensusPanel'
import StockScenarioPanel from '@/components/stock/StockScenarioPanel'
import StockSummaryPanel from '@/components/stock/StockSummaryPanel'
import StockValuationPanel from '@/components/stock/StockValuationPanel'
import {
  AnalysisMode,
  StockAnalysisResponse,
  fetchStockAnalysis,
  normalizeTicker,
} from '@/lib/stockAnalysis'

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
        active
          ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]'
          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

export default function StockTickerPage() {
  const params = useParams<{ ticker: string }>()
  const searchParams = useSearchParams()
  const queryValue = (key: string) => searchParams?.get(key)?.trim() || ''
  const ticker = useMemo(() => {
    const raw = Array.isArray(params?.ticker) ? params.ticker[0] : params?.ticker
    return normalizeTicker(raw || 'AAPL') || 'AAPL'
  }, [params])

  const newsHeadline = queryValue('headline')
  const newsSource = queryValue('source')
  const entrySource = queryValue('from')
  const hasNewsContext = entrySource === 'news' && Boolean(newsHeadline)

  const [mode, setMode] = useState<AnalysisMode>('auto')
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setLoading(true)
    setError(null)

    fetchStockAnalysis(ticker, mode, controller.signal)
      .then((payload) => {
        if (alive) setAnalysis(payload)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load analysis')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [ticker, mode])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.10),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_26%),linear-gradient(180deg,#020617_0%,#06111d_100%)] px-4 py-5 text-slate-100 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-slate-500">Auto Stock Analysis Engine V1</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-4xl">
              Stock <span className="text-cyan-300">Analysis</span>
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              News or watchlist entry point can send you here. The engine fills valuation, scenarios, and summary automatically.
            </p>
          </div>

          <Link
            href="/news"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
          >
            Back to News
          </Link>
        </div>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-slate-400">Mode</div>
            <div className="flex flex-wrap gap-2">
              <ModeButton active={mode === 'auto'} label="Auto" onClick={() => setMode('auto')} />
              <ModeButton active={mode === 'conservative'} label="Conservative" onClick={() => setMode('conservative')} />
              <ModeButton active={mode === 'aggressive'} label="Aggressive" onClick={() => setMode('aggressive')} />
            </div>
          </div>

          <div className="text-sm text-slate-400">
            Ticker: <span className="font-semibold text-white">{ticker}</span>
          </div>
        </section>

        {error && (
          <section className="rounded-3xl border border-rose-400/25 bg-rose-400/10 px-5 py-4 text-rose-100">
            {error}
          </section>
        )}

        {hasNewsContext && (
          <section className="rounded-3xl border border-cyan-400/20 bg-cyan-400/8 p-4">
            <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/70">From News</div>
            <div className="mt-2 text-sm leading-6 text-slate-100">{newsHeadline}</div>
            {newsSource && <div className="mt-1 text-xs text-slate-500">Source: {newsSource}</div>}
          </section>
        )}

        <StockHeader ticker={ticker} analysis={analysis} loading={loading} />

        <ChartValuationOverlay analysis={analysis} loading={loading} error={error} />

        <div className="grid gap-5 xl:grid-cols-2">
          <StockValuationPanel analysis={analysis} loading={loading} />
          <StockScenarioPanel analysis={analysis} loading={loading} />
        </div>

        <StockConsensusPanel analysis={analysis} loading={loading} />

        <StockSummaryPanel analysis={analysis} loading={loading} />
      </div>
    </div>
  )
}
