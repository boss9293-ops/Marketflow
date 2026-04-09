import { NextResponse } from 'next/server'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

const FLASK_URL = resolveBackendBaseUrl()

type QuoteFallbackRow = {
  symbol: string
  price: number | null
  changePercent: number | null
  dayLow: number | null
  dayHigh: number | null
  name?: string
  source?: string
  asOf?: string | null
}

async function buildQuoteFallback(request: Request, ticker: string) {
  if (!ticker) return null
  try {
    const origin = new URL(request.url).origin
    const quoteRes = await fetch(
      `${origin}/api/quote?symbols=${encodeURIComponent(ticker)}&mode=delayed`,
      { cache: 'no-store', signal: AbortSignal.timeout(10_000) },
    )
    if (!quoteRes.ok) return null
    const quotePayload = await quoteRes.json().catch(() => null) as { quotes?: QuoteFallbackRow[] } | null
    const q = quotePayload?.quotes?.[0]
    if (!q || q.price == null) return null

    return {
      ticker: q.symbol || ticker,
      name: q.name || ticker,
      current_price: q.price,
      current_change_pct:
        typeof q.changePercent === 'number' && Number.isFinite(q.changePercent)
          ? q.changePercent / 100
          : null,
      valuation: {
        price_high_1y: null,
        price_low_1y: null,
        sma20: null,
        sma50: null,
        sma120: null,
        sma200: null,
        rsi14: null,
        perf_1w: null,
        perf_1m: null,
        perf_3m: null,
        perf_6m: null,
        perf_1y: null,
        perf_ytd: null,
      },
      consensus: {
        target_mean: null,
        target_high: null,
        target_low: null,
      },
      scenario: {
        bear: null,
        base: null,
        bull: null,
      },
      warnings: [
        'backend_unavailable_fallback',
        'analysis cards are running in delayed quote fallback mode',
      ],
      meta: {
        fallback: true,
        source: q.source || 'quote_api',
        asOf: q.asOf || null,
      },
    }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const ticker =
    typeof body === 'object' && body !== null && 'ticker' in body
      ? String((body as { ticker?: unknown }).ticker || '').trim().toUpperCase()
      : ''

  try {
    const res = await fetch(`${FLASK_URL}/api/analyze/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })

    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { error: text || 'Invalid response from backend' }
    }

    // Keep UX alive when backend is down / unavailable: serve delayed-quote fallback.
    if (!res.ok && res.status >= 500 && ticker) {
      const fallback = await buildQuoteFallback(request, ticker)
      if (fallback) return NextResponse.json(fallback, { status: 200 })
    }

    return NextResponse.json(data ?? {}, { status: res.status })
  } catch (error: any) {
    if (ticker) {
      const fallback = await buildQuoteFallback(request, ticker)
      if (fallback) return NextResponse.json(fallback, { status: 200 })
    }
    return NextResponse.json(
      {
        error: 'Backend analysis service unavailable',
        details: error?.message || String(error),
      },
      { status: 503 },
    )
  }
}
