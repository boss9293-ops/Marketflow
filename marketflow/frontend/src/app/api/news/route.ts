import { NextResponse } from 'next/server'

import { hasPromoSignals, isFreeNewsSource, scoreNewsSource, scoreNewsText } from '@/lib/newsQuality'

const FETCH_ATTEMPTS = 2
const RETRY_DELAY_MS = 250
const MIN_BRIEF_SCORE = 3

type BriefItem = {
  id: string
  ticker?: string
  symbol: string
  checkpointET?: string
  headline: string
  source?: string
  summary?: string
  url?: string
  dateET?: string
  publishedAtET?: string
  score?: number
}

type FinnhubNewsItem = {
  id?: number
  datetime?: number
  headline?: string
  source?: string
  url?: string
  summary?: string
}

type YahooSearchNewsItem = {
  uuid?: string
  title?: string
  link?: string
  providerPublishTime?: number
  publisher?: string
  summary?: string
}

const formatDate = (date: Date) => date.toISOString().split('T')[0]

const toETDate = (value: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)

const toETTime = (value: Date): string =>
  `${new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)} ET`

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs = 4500,
): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const fetchWithRetry = async (
  input: string,
  init: RequestInit,
  timeoutMs = 4500,
  attempts = FETCH_ATTEMPTS,
): Promise<Response | null> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs)
      if (response.ok) return response
    } catch {
      // noop
    }
    if (attempt < attempts) {
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
  return null
}

const normalizeHeadline = (value: string): string =>
  value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value: string): string => {
  try {
    const u = new URL(value)
    return `${u.origin}${u.pathname}`.toLowerCase().replace(/\/+$/, '')
  } catch {
    return value.toLowerCase().trim()
  }
}

const recencyScore = (publishedAt?: string): number => {
  if (!publishedAt) return 0
  const ts = Date.parse(publishedAt)
  if (!Number.isFinite(ts)) return 0
  const ageHours = (Date.now() - ts) / 36e5
  if (ageHours <= 6) return 3
  if (ageHours <= 24) return 2
  if (ageHours <= 48) return 1
  return 0
}

const scoreBriefItem = (item: BriefItem): number => {
  const text = `${item.headline || ''} ${item.summary || ''}`
  return scoreNewsText(text) * 2 + recencyScore(item.publishedAtET || item.dateET) + scoreNewsSource(item.source)
}

const mapFinnhubItem = (symbol: string, item: FinnhubNewsItem, idx: number): BriefItem | null => {
  if (!item || typeof item !== 'object') return null
  const headline = String(item.headline || '').trim()
  const source = String(item.source || '').trim()
  const url = String(item.url || '').trim()
  const timestampSec = Number(item.datetime || 0)
  if (!headline || !source || !url || !Number.isFinite(timestampSec) || timestampSec <= 0) return null
  if (!isFreeNewsSource(source) || hasPromoSignals(headline)) return null

  const dt = new Date(timestampSec * 1000)
  const dateET = toETDate(dt)
  return {
    id: `news-fh-${symbol}-${item.id ?? `${timestampSec}-${idx}`}`,
    ticker: symbol,
    symbol,
    checkpointET: toETTime(dt),
    headline,
    source,
    summary: String(item.summary || '').trim() || `${headline}.`,
    url,
    dateET,
    publishedAtET: dt.toISOString(),
  }
}

const mapYahooSearchItem = (symbol: string, item: YahooSearchNewsItem, idx: number): BriefItem | null => {
  const headline = String(item.title || '').trim()
  const source = String(item.publisher || 'Yahoo Finance').trim()
  const url = String(item.link || '').trim()
  if (!headline || !source || !url) return null
  if (!isFreeNewsSource(source) || hasPromoSignals(headline)) return null

  const pubTime = item.providerPublishTime ? new Date(item.providerPublishTime * 1000) : new Date()
  const dateET = toETDate(pubTime)
  return {
    id: `news-yh-${symbol}-${item.uuid || `${idx}`}`,
    ticker: symbol,
    symbol,
    checkpointET: toETTime(pubTime),
    headline,
    source,
    summary: String(item.summary || '').trim() || `${headline}.`,
    url,
    dateET,
    publishedAtET: pubTime.toISOString(),
  }
}

const dedupeAndRank = (rows: BriefItem[], maxItems = 5): BriefItem[] => {
  const sorted = [...rows].sort((a, b) => scoreBriefItem(b) - scoreBriefItem(a))
  const seenHeadline = new Set<string>()
  const seenUrl = new Set<string>()
  const output: BriefItem[] = []

  for (const row of sorted) {
    const score = scoreBriefItem(row)
    if (score < MIN_BRIEF_SCORE) continue
    const headlineKey = normalizeHeadline(row.headline)
    const urlKey = normalizeUrl(row.url || '')
    if (!headlineKey || !urlKey) continue
    if (seenHeadline.has(headlineKey) || seenUrl.has(urlKey)) continue
    seenHeadline.add(headlineKey)
    seenUrl.add(urlKey)
    output.push(row)
    if (output.length >= maxItems) break
  }

  return output
}

async function fetchFinnhubNews(symbol: string, fromDate: Date, toDate: Date): Promise<BriefItem[]> {
  const finnhubKey = process.env.FINNHUB_API_KEY || process.env.NEXT_PUBLIC_FINNHUB_API_KEY || ''
  if (!finnhubKey) return []

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${formatDate(fromDate)}&to=${formatDate(toDate)}&token=${finnhubKey}`
    const res = await fetchWithRetry(url, { cache: 'no-store' }, 4500)
    if (!res) return []
    const data = await res.json()
    if (!Array.isArray(data) || !data.length) return []
    return data
      .slice(0, 12)
      .map((item, idx) => mapFinnhubItem(symbol, item as FinnhubNewsItem, idx))
      .filter((item: BriefItem | null): item is BriefItem => Boolean(item))
  } catch (err) {
    console.warn('[news API] Finnhub fetch failed:', err)
    return []
  }
}

async function fetchYahooSearchNews(symbol: string): Promise<BriefItem[]> {
  try {
    const yhUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=8&enableFuzzyQuery=false&enableNews=true`
    const yhRes = await fetchWithRetry(yhUrl, { cache: 'no-store' }, 4500)
    if (!yhRes) return []
    const data = await yhRes.json()
    if (!data || !Array.isArray(data.news) || !data.news.length) return []
    return data.news
      .slice(0, 12)
      .map((item: YahooSearchNewsItem, idx: number): BriefItem | null => mapYahooSearchItem(symbol, item, idx))
      .filter((item: BriefItem | null): item is BriefItem => Boolean(item))
  } catch (err) {
    console.warn('[news API] Yahoo fallback failed:', err)
    return []
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim().toUpperCase()

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol parameter' }, { status: 400 })
  }

  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(toDate.getDate() - 7)

  const [finnhubItems, yahooItems] = await Promise.all([
    fetchFinnhubNews(symbol, fromDate, toDate),
    fetchYahooSearchNews(symbol),
  ])

  const mapped = dedupeAndRank([...finnhubItems, ...yahooItems], 5)
  return NextResponse.json({ briefs: mapped })
}