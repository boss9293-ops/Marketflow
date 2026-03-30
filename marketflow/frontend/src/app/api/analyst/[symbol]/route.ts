import { NextResponse } from 'next/server'

export type AnalystRecommendation = {
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
  total: number
  consensus: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell' | 'N/A'
  period: string | null
}

const cache = new Map<string, { ts: number; data: AnalystRecommendation }>()
const TTL = 6 * 60 * 60 * 1000 // 6h

function computeConsensus(sb: number, b: number, h: number, s: number, ss: number): AnalystRecommendation['consensus'] {
  const total = sb + b + h + s + ss
  if (total === 0) return 'N/A'
  const score = (sb * 5 + b * 4 + h * 3 + s * 2 + ss * 1) / total
  if (score >= 4.5) return 'Strong Buy'
  if (score >= 3.75) return 'Buy'
  if (score >= 2.75) return 'Hold'
  if (score >= 2.0) return 'Sell'
  return 'Strong Sell'
}

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  const symbol = (params.symbol || '').trim().toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  const cached = cache.get(symbol)
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json(cached.data)
  }

  const apiKey = process.env.FINNHUB_API_KEY || ''
  if (!apiKey) {
    return NextResponse.json({ error: 'FINNHUB_API_KEY not set' }, { status: 503 })
  }

  try {
    const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: `Finnhub ${res.status}` }, { status: res.status })
    }
    const json: any[] = await res.json()
    if (!Array.isArray(json) || json.length === 0) {
      return NextResponse.json({ error: 'no data' }, { status: 404 })
    }

    // Most recent period first
    const latest = json[0]
    const sb = Number(latest.strongBuy ?? 0)
    const b = Number(latest.buy ?? 0)
    const h = Number(latest.hold ?? 0)
    const s = Number(latest.sell ?? 0)
    const ss = Number(latest.strongSell ?? 0)

    const result: AnalystRecommendation = {
      strongBuy: sb,
      buy: b,
      hold: h,
      sell: s,
      strongSell: ss,
      total: sb + b + h + s + ss,
      consensus: computeConsensus(sb, b, h, s, ss),
      period: latest.period ?? null,
    }

    cache.set(symbol, { ts: Date.now(), data: result })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'unknown' }, { status: 500 })
  }
}
