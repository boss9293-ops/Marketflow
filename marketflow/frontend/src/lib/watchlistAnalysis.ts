import { type AnalysisMode, type StockAnalysisResponse, normalizeTicker } from '@/lib/stockAnalysis'

export type WatchlistAnalysisItem = {
  ticker: string
  name?: string | null
  current_price?: number | null
  state?: 'premium' | 'fair' | 'discount' | string
  position_vs_base_pct?: number | null
  confidence?: 'high' | 'medium' | 'low' | string
  risk_tag?: string | null
  summary_line?: string | null
  analysis?: StockAnalysisResponse | null
  error?: string | null
}

export type WatchlistAnalysisSummary = {
  ticker_count?: number
  analyzed_count?: number
  premium_count?: number
  fair_count?: number
  discount_count?: number
  confidence_breakdown?: {
    high?: number
    medium?: number
    low?: number
  }
  headline?: string
}

export type WatchlistAnalysisResponse = {
  watchlist_name?: string | null
  mode?: AnalysisMode
  items?: WatchlistAnalysisItem[]
  summary?: WatchlistAnalysisSummary
  errors?: Array<{ ticker?: string; error?: string }>
  meta?: Record<string, unknown>
}

export type WatchlistAnalysisRequest = {
  tickers: string[]
  mode?: AnalysisMode
  watchlist_name?: string | null
}

export function normalizeWatchlistTickers(items: Array<{ ticker?: string; symbol?: string }>): string[] {
  return items
    .map((item) => normalizeTicker(item.ticker || item.symbol || ''))
    .filter((ticker, index, list) => ticker && list.indexOf(ticker) === index)
}

export async function fetchWatchlistAnalysis(
  payload: WatchlistAnalysisRequest,
  signal?: AbortSignal,
): Promise<WatchlistAnalysisResponse> {
  const res = await fetch('/api/analyze/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
    cache: 'no-store',
  })

  const response = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof response?.error === 'string' ? response.error : 'Failed to analyze watchlist'
    throw new Error(message)
  }

  return response as WatchlistAnalysisResponse
}

