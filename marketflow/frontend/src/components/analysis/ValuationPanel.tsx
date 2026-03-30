'use client'

import { useEffect, useState } from 'react'

import StreetConsensusChart from '@/components/analysis/StreetConsensusChart'
import { AnalysisMode, StockAnalysisResponse, fetchStockAnalysis, normalizeTicker } from '@/lib/stockAnalysis'

export type ValuationDashboardProps = {
  symbol?: string
  fetchKey?: number
  mode?: AnalysisMode
}

export default function ValuationPanel({ symbol = 'NVDA', fetchKey = 0, mode = 'auto' }: ValuationDashboardProps) {
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ticker = normalizeTicker(symbol) || 'NVDA'
    const controller = new AbortController()
    let alive = true
    setLoading(true)
    setError(null)

    fetchStockAnalysis(ticker, mode, controller.signal)
      .then(payload => { if (alive) setAnalysis(payload) })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load valuation')
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false; controller.abort() }
  }, [symbol, fetchKey, mode])

  return (
    <div className="mx-auto w-full max-w-[1380px]">
      <StreetConsensusChart analysis={analysis} loading={loading} error={error} />
    </div>
  )
}
