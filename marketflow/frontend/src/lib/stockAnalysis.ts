export type AnalysisMode = 'auto' | 'conservative' | 'aggressive'

export type StockAnalysisResponse = {
  ticker: string
  current_price?: number | null
  current_change_pct?: number | null
  name?: string
  sector?: string
  industry?: string
  exchange?: string
  current_pe?: number | null
  historical_pe?: {
    pe_3y?: number | null
    pe_5y?: number | null
  }
  sector_pe?: number | null
  growth?: {
    bear?: number | null
    base?: number | null
    bull?: number | null
    hist_5y?: number | null
    hist_3y?: number | null
    forward?: number | null
    base_raw?: number | null
    quality_penalty?: number | null
  }
  multiple?: {
    bear?: number | null
    base?: number | null
    bull?: number | null
    pe_5y?: number | null
    pe_3y?: number | null
    sector?: number | null
    peers?: number | null
    base_raw?: number | null
  }
  scenario?: {
    bear?: number | null
    base?: number | null
    bull?: number | null
  }
  confidence?: 'high' | 'medium' | 'low' | string
  today_summary?: string
  summary?: string
  price_history?: Array<{
    date?: string
    close?: number | null
  }>
  valuation_state?: {
    label?: 'premium' | 'fair' | 'discount' | string
    detail?: string
    reference?: string | null
  }
  narrative?: {
    headline?: string
    summary?: string
    bull_case?: string
    bear_case?: string
    risk_note?: string
    confidence_note?: string
    consensus_note?: string
  }
  consensus?: {
    source?: string
    captured_at?: string | null
    source_asof?: string | null
    eps_estimate_fy1?: number | null
    eps_estimate_fy2?: number | null
    eps_ladder?: Array<{
      year?: number | null
      label?: string
      detail?: string
      kind?: string
      eps?: number | null
      eps_low?: number | null
      eps_high?: number | null
      analyst_count?: number | null
      growth_pct?: number | null
      raw_date?: string | null
    }>
    forward_pe_ladder?: Array<{
      year?: number | null
      label?: string
      detail?: string
      kind?: string
      eps?: number | null
      eps_low?: number | null
      eps_high?: number | null
      analyst_count?: number | null
      growth_pct?: number | null
      raw_date?: string | null
      forward_pe?: number | null
    }>
    target_mean?: number | null
    target_high?: number | null
    target_low?: number | null
    analyst_count?: number | null
    target_analyst_count?: number | null
    target_vs_current_pct?: number | null
  }
  analysis_mode?: AnalysisMode
  valuation?: {
    eps_ttm?: number | null
    eps_forward?: number | null
    revenue_growth?: number | null
    gross_margin?: number | null
    operating_margin?: number | null
    net_margin?: number | null
    debt_to_equity?: number | null
    current_ratio?: number | null
    market_cap?: number | null
    price_high_1y?: number | null
    price_low_1y?: number | null
    price_high_3y?: number | null
    price_low_3y?: number | null
    price_high_5y?: number | null
    price_low_5y?: number | null
    sma20?: number | null
    sma50?: number | null
    sma120?: number | null
    sma200?: number | null
    rsi14?: number | null
    vol20?: number | null
    perf_1w?: number | null
    perf_1m?: number | null
    perf_3m?: number | null
    perf_6m?: number | null
    perf_1y?: number | null
    perf_ytd?: number | null
    source?: string
    historical_multiple_source?: string
  }
  stats?: {
    ps_ratio?: number | null
    pb_ratio?: number | null
    peg_ratio?: number | null
    ev_ebitda?: number | null
    roe?: number | null
    roa?: number | null
    roic?: number | null
    asset_turnover?: number | null
    ebitda_margin?: number | null
    enterprise_value?: number | null
    ev_sales?: number | null
    ev_fcf?: number | null
    ev_opcf?: number | null
    fcf_per_share?: number | null
    revenue_per_share?: number | null
    roic_km?: number | null
    revenue?: number | null
    gross_profit?: number | null
    operating_income?: number | null
    net_income?: number | null
    ebitda?: number | null
    eps_reported?: number | null
    income_period?: string | number | null
    cash?: number | null
    total_debt?: number | null
    net_debt?: number | null
    total_assets?: number | null
    employees?: number | null
  }
  warnings?: string[]
  meta?: Record<string, unknown>
}

export function normalizeTicker(value: string): string {
  const raw = (value || '').trim().toUpperCase()
  if (!raw) return ''
  if (raw.includes(':')) return raw.split(':').pop() || raw
  return raw
}

export async function fetchStockAnalysis(
  ticker: string,
  mode: AnalysisMode = 'auto',
  signal?: AbortSignal,
): Promise<StockAnalysisResponse> {
  const normalized = normalizeTicker(ticker)
  if (!normalized) {
    throw new Error('Ticker is required')
  }

  const res = await fetch('/api/analyze/stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker: normalized, mode }),
    signal,
    cache: 'no-store',
  })

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'Failed to analyze stock'
    throw new Error(message)
  }

  return payload as StockAnalysisResponse
}

export function formatCurrency(value?: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

export function formatPrice(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatPct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
}

export function formatMultiple(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value.toFixed(1)}x`
}

export function calcUpsidePct(current?: number | null, target?: number | null): number | null {
  if (current == null || target == null) return null
  if (!Number.isFinite(current) || !Number.isFinite(target) || current <= 0) return null
  return (target - current) / current
}

export function pickConfidenceTone(confidence?: string | null): 'high' | 'medium' | 'low' {
  if (confidence === 'high' || confidence === 'medium' || confidence === 'low') return confidence
  return 'low'
}
