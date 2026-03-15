import { NextResponse } from 'next/server'

type EarningsResponse = {
  symbol: string
  nextEarnings: string | null
  lastQuarter: {
    date: string | null
    epsEstimate: number | null
    epsActual: number | null
    revenueEstimate: number | null
    revenueActual: number | null
    surprisePct: number | null
  }
  recentSurprises: {
    date: string | null
    epsEstimate: number | null
    epsActual: number | null
    revenueEstimate: number | null
    revenueActual: number | null
    surprisePct: number | null
  }[]
  beatRate: number | null
  avgSurprise: number | null
  yoyRevenueGrowth: number | null
  guidanceSentiment: 'Positive' | 'Neutral' | 'Negative'
  aiInsight: string | null
  fetchedAt: string
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { ts: number; data: EarningsResponse }>()

const toNum = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

async function fmpFetch(path: string, apiKey: string) {
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://financialmodelingprep.com/api/v3${path}${sep}apikey=${apiKey}`
  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`FMP ${res.status} ${text.slice(0, 160)}`)
  }
  return res.json()
}

const scoreGuidance = (text: string) => {
  const lower = text.toLowerCase()
  const posWords = ['raise', 'raised', 'strong', 'improve', 'beat', 'outperform', 'upgrade', 'tailwind']
  const negWords = ['lower', 'cut', 'weak', 'miss', 'downgrade', 'headwind', 'uncertain', 'pressure']
  let score = 0
  posWords.forEach((w) => { if (lower.includes(w)) score += 1 })
  negWords.forEach((w) => { if (lower.includes(w)) score -= 1 })
  if (score >= 2) return 'Positive'
  if (score <= -2) return 'Negative'
  return 'Neutral'
}

async function buildAiInsight(payload: EarningsResponse): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  if (!apiKey) return null

  const prompt = [
    'You are an equity research analyst. Write a single short, neutral earnings insight paragraph (3-5 sentences).',
    'Avoid predictions or trading advice. Focus on facts and interpretation.',
    `Symbol: ${payload.symbol}`,
    `Next earnings: ${payload.nextEarnings ?? '--'}`,
    `EPS: ${payload.lastQuarter.epsActual ?? '--'} vs ${payload.lastQuarter.epsEstimate ?? '--'}`,
    `Revenue: ${payload.lastQuarter.revenueActual ?? '--'} vs ${payload.lastQuarter.revenueEstimate ?? '--'}`,
    `Surprise: ${payload.lastQuarter.surprisePct ?? '--'}`,
    `Beat rate (8Q): ${payload.beatRate ?? '--'}`,
    `Avg surprise: ${payload.avgSurprise ?? '--'}`,
    `YoY revenue growth: ${payload.yoyRevenueGrowth ?? '--'}`,
    `Guidance sentiment: ${payload.guidanceSentiment}`,
    'Output in Korean.',
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      input: prompt,
      temperature: 0.3,
      max_output_tokens: 220,
    }),
  })
  if (!res.ok) {
    return null
  }
  const data = await res.json()
  const text: string | undefined = data?.output_text
  return text?.trim() || null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbolRaw = (searchParams.get('symbol') || '').trim().toUpperCase()
  if (!symbolRaw) {
    return NextResponse.json({ error: 'missing symbol' }, { status: 400 })
  }

  const cached = cache.get(symbolRaw)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' },
    })
  }

  const apiKey = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY || ''
  if (!apiKey) {
    return NextResponse.json({ error: 'missing FMP_API_KEY' }, { status: 500 })
  }

  const [surprises, calendar, transcript] = await Promise.all([
    fmpFetch(`/earnings-surprises/${symbolRaw}`, apiKey).catch(() => []),
    fmpFetch(`/earning_calendar?symbol=${symbolRaw}&limit=8`, apiKey).catch(() => []),
    fmpFetch(`/earning_call_transcript/${symbolRaw}`, apiKey).catch(() => []),
  ])

  const surprisesArr = Array.isArray(surprises) ? surprises : []
  const last = surprisesArr[0] || {}
  const epsActual = toNum(last.actualEarning ?? last.actualEPS)
  const epsEstimate = toNum(last.estimatedEarning ?? last.estimatedEPS)
  const revenueActual = toNum(last.actualRevenue)
  const revenueEstimate = toNum(last.estimatedRevenue)
  const surprisePct = toNum(last.surprisePercent)
  const lastDate = last.date || last.fiscalDateEnding || null

  const recentSurprises = surprisesArr.slice(0, 8).map((s: any) => ({
    date: s.date || s.fiscalDateEnding || null,
    epsEstimate: toNum(s.estimatedEarning ?? s.estimatedEPS),
    epsActual: toNum(s.actualEarning ?? s.actualEPS),
    revenueEstimate: toNum(s.estimatedRevenue),
    revenueActual: toNum(s.actualRevenue),
    surprisePct: toNum(s.surprisePercent),
  }))

  const beats = recentSurprises
    .map((s) => s.surprisePct)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

  const beatRate = beats.length ? beats.filter((v) => v > 0).length / beats.length : null
  const avgSurprise = beats.length ? beats.reduce((a, b) => a + b, 0) / beats.length : null

  let yoyRevenueGrowth: number | null = null
  if (recentSurprises.length >= 5) {
    const latestRev = recentSurprises[0]?.revenueActual
    const priorRev = recentSurprises[4]?.revenueActual
    if (latestRev != null && priorRev != null && priorRev !== 0) {
      yoyRevenueGrowth = (latestRev - priorRev) / priorRev
    }
  } else {
    const beatRevenues = surprisesArr
      .map((s: any) => toNum(s.actualRevenue))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (beatRevenues.length >= 5 && beatRevenues[4] !== 0) {
      yoyRevenueGrowth = (beatRevenues[0] - beatRevenues[4]) / beatRevenues[4]
    }
  }

  const beatsLegacy = surprisesArr
    .map((s: any) => toNum(s.surprisePercent))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const beatRateLegacy = beatsLegacy.length ? beatsLegacy.filter((v) => v > 0).length / beatsLegacy.length : null
  const avgSurpriseLegacy = beatsLegacy.length ? beatsLegacy.reduce((a, b) => a + b, 0) / beatsLegacy.length : null

  const nextEarnings = Array.isArray(calendar) && calendar.length
    ? calendar[0]?.date || calendar[0]?.fiscalDate || null
    : null

  const transcriptText = Array.isArray(transcript)
    ? (transcript[0]?.content || transcript[0]?.transcript || '')
    : ''
  const guidanceSentiment = transcriptText
    ? scoreGuidance(String(transcriptText))
    : 'Neutral'

  const response: EarningsResponse = {
    symbol: symbolRaw,
    nextEarnings,
    lastQuarter: {
      date: lastDate,
      epsEstimate,
      epsActual,
      revenueEstimate,
      revenueActual,
      surprisePct,
    },
    recentSurprises,
    beatRate: beatRate ?? beatRateLegacy,
    avgSurprise: avgSurprise ?? avgSurpriseLegacy,
    yoyRevenueGrowth,
    guidanceSentiment,
    aiInsight: null,
    fetchedAt: new Date().toISOString(),
  }

  response.aiInsight = await buildAiInsight(response)
  cache.set(symbolRaw, { ts: Date.now(), data: response })
  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' },
  })
}
