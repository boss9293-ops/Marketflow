import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

import { ET_TIMEZONE, type ETDateString, type NewsDetail, type TickerNewsItem } from '@/lib/terminal-mvp/types'

type YahooRssItem = {
  title: string
  link: string
  pubDateRaw: string
  source: string
  description: string
}

const decodeHtml = (raw: string): string =>
  raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()

const stripHtml = (raw: string): string => raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

const readTag = (xmlBlock: string, tag: string): string => {
  const match = xmlBlock.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!match?.[1]) return ''
  return match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()
}

const toDateET = (value: Date): ETDateString =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)

const buildId = (symbol: string, item: YahooRssItem): string => {
  const raw = `${symbol}|${item.link}|${item.pubDateRaw}|${item.title}`
  return `${symbol.toLowerCase()}-${createHash('sha1').update(raw).digest('hex').slice(0, 16)}`
}

const inferTags = (headline: string, source: string): string[] => {
  const tokens = `${headline} ${source}`.toLowerCase()
  const tags = new Set<string>()
  if (tokens.includes('upgrade') || tokens.includes('downgrade') || tokens.includes('analyst')) tags.add('analyst')
  if (tokens.includes('earnings') || tokens.includes('revenue')) tags.add('earnings')
  if (tokens.includes('guidance')) tags.add('guidance')
  if (tokens.includes('sec') || tokens.includes('doj') || tokens.includes('investigation')) tags.add('regulatory')
  if (!tags.size) tags.add('news')
  return [...tags]
}

const inferRelevanceScore = (symbol: string, headline: string, summary: string): number => {
  const text = `${headline} ${summary}`.toUpperCase()
  const directMentionBoost = text.includes(symbol.toUpperCase()) ? 0.2 : 0
  const base = 0.5 + directMentionBoost
  return Math.max(0.35, Math.min(0.98, Number(base.toFixed(2))))
}

const parseYahooRss = (xml: string): YahooRssItem[] => {
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
  return itemBlocks
    .map((itemXml) => {
      const title = decodeHtml(readTag(itemXml, 'title'))
      const link = decodeHtml(readTag(itemXml, 'link'))
      const pubDateRaw = decodeHtml(readTag(itemXml, 'pubDate'))
      const source = decodeHtml(readTag(itemXml, 'source')) || 'Yahoo Finance'
      const description = stripHtml(decodeHtml(readTag(itemXml, 'description')))
      return { title, link, pubDateRaw, source, description }
    })
    .filter((item) => item.title && item.link && item.pubDateRaw)
}

export type BuiltTickerNewsPayload = {
  timeline: TickerNewsItem[]
  details: NewsDetail[]
}

const TICKER_NEWS_CACHE_TTL_MS = 1000 * 60 * 30
const TICKER_NEWS_HISTORY_MAX_ITEMS = 720
const TICKER_NEWS_FETCH_ATTEMPTS = 2
const TICKER_NEWS_RETRY_DELAY_MS = 250
const TICKER_NEWS_HISTORY_PATH = path.join(process.cwd(), '.cache', 'ticker-news-history.json')
const tickerNewsCache = new Map<string, { expiresAt: number; payload: BuiltTickerNewsPayload }>()
const tickerNewsHistory = new Map<
  string,
  { timelineById: Map<string, TickerNewsItem>; detailsById: Map<string, NewsDetail> }
>()
let tickerHistoryLoaded = false
let tickerHistoryWriteQueue: Promise<void> = Promise.resolve()

type StoredTickerNewsPayload = {
  updatedAt: string
  symbols: Record<
    string,
    {
      timeline: TickerNewsItem[]
      details: NewsDetail[]
    }
  >
}

const clonePayload = (payload: BuiltTickerNewsPayload): BuiltTickerNewsPayload => ({
  timeline: payload.timeline.map((item) => ({ ...item })),
  details: payload.details.map((item) => ({ ...item })),
})

const getEtHourMinute = (value: Date): { hour: number; minute: number } => {
  const hhmm = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
  const [hourRaw, minuteRaw] = hhmm.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  return { hour, minute }
}

type BucketSlot = { item: YahooRssItem; minuteGap: number } | null

const sortNewsItems = <T extends { publishedAtET: string; dateET: ETDateString }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const byTimestamp = b.publishedAtET.localeCompare(a.publishedAtET)
    if (byTimestamp !== 0) return byTimestamp
    return b.dateET.localeCompare(a.dateET)
  })

const isTickerNewsItem = (value: unknown): value is TickerNewsItem => {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.symbol === 'string' &&
    typeof row.dateET === 'string' &&
    typeof row.publishedAtET === 'string' &&
    typeof row.timeET === 'string' &&
    typeof row.headline === 'string' &&
    typeof row.source === 'string' &&
    typeof row.summary === 'string' &&
    typeof row.url === 'string'
  )
}

const isNewsDetail = (value: unknown): value is NewsDetail => {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.dateET === 'string' &&
    typeof row.publishedAtET === 'string' &&
    typeof row.headline === 'string' &&
    typeof row.source === 'string' &&
    typeof row.summary === 'string'
  )
}

const loadTickerHistoryFromDisk = async (): Promise<void> => {
  if (tickerHistoryLoaded) return
  tickerHistoryLoaded = true

  try {
    const raw = await fs.readFile(TICKER_NEWS_HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw) as StoredTickerNewsPayload
    if (!parsed || typeof parsed !== 'object' || !parsed.symbols || typeof parsed.symbols !== 'object') {
      return
    }

    for (const [symbol, payload] of Object.entries(parsed.symbols)) {
      if (!payload || typeof payload !== 'object') continue
      const timeline = Array.isArray(payload.timeline)
        ? payload.timeline.filter(isTickerNewsItem).slice(0, TICKER_NEWS_HISTORY_MAX_ITEMS)
        : []
      if (!timeline.length) continue
      const keepIds = new Set(timeline.map((item) => item.id))
      const details = Array.isArray(payload.details)
        ? payload.details.filter(isNewsDetail).filter((item) => keepIds.has(item.id))
        : []
      tickerNewsHistory.set(symbol, {
        timelineById: new Map(sortNewsItems(timeline).map((item) => [item.id, item])),
        detailsById: new Map(sortNewsItems(details).map((item) => [item.id, item])),
      })
    }
  } catch {
    // No prior cache file, or parse issue.
  }
}

const persistTickerHistoryNow = async (): Promise<void> => {
  const symbols: StoredTickerNewsPayload['symbols'] = {}

  for (const [symbol, history] of tickerNewsHistory.entries()) {
    const timeline = sortNewsItems(Array.from(history.timelineById.values())).slice(0, TICKER_NEWS_HISTORY_MAX_ITEMS)
    if (!timeline.length) continue
    const keepIds = new Set(timeline.map((item) => item.id))
    const details = sortNewsItems(Array.from(history.detailsById.values())).filter((item) => keepIds.has(item.id))
    symbols[symbol] = { timeline, details }
  }

  await fs.mkdir(path.dirname(TICKER_NEWS_HISTORY_PATH), { recursive: true })
  const payload: StoredTickerNewsPayload = {
    updatedAt: new Date().toISOString(),
    symbols,
  }
  await fs.writeFile(TICKER_NEWS_HISTORY_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

const persistTickerHistoryQueued = (): Promise<void> => {
  tickerHistoryWriteQueue = tickerHistoryWriteQueue
    .then(() => persistTickerHistoryNow())
    .catch((error) => {
      console.warn('[terminal-ticker-news] history cache write failed:', error)
    })
  return tickerHistoryWriteQueue
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const fetchWithRetry = async (
  input: string,
  init: RequestInit,
  timeoutMs = 4500,
  attempts = TICKER_NEWS_FETCH_ATTEMPTS,
): Promise<Response | null> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs)
      if (response.ok) return response
    } catch {
      // noop
    }

    if (attempt < attempts) {
      await sleep(TICKER_NEWS_RETRY_DELAY_MS * attempt)
    }
  }

  return null
}
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

export async function fetchTickerNewsFromYahoo(symbol: string, dateET: ETDateString): Promise<BuiltTickerNewsPayload> {
  await loadTickerHistoryFromDisk()

  const cacheKey = symbol
  const now = Date.now()
  const cached = tickerNewsCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return clonePayload(cached.payload)
  }
  if (cached && cached.expiresAt <= now) {
    tickerNewsCache.delete(cacheKey)
  }

  let parsedItems: YahooRssItem[] = []
  try {
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`
    const res = await fetchWithRetry(rssUrl, { next: { revalidate: 3600 } }, 4500)
    if (!res) {
      throw new Error('Yahoo RSS request failed after retries')
    }

    const xml = await res.text()
    parsedItems = parseYahooRss(xml)
  } catch (error) {
    const stale = tickerNewsHistory.get(symbol)
    if (stale?.timelineById?.size && stale?.detailsById?.size) {
      const stalePayload: BuiltTickerNewsPayload = {
        timeline: sortNewsItems(Array.from(stale.timelineById.values())),
        details: sortNewsItems(Array.from(stale.detailsById.values())),
      }
      return clonePayload(stalePayload)
    }
    throw error
  }

  const details: NewsDetail[] = []
  const timeline: TickerNewsItem[] = []

  // dateET is kept for API compatibility; history is accumulated per symbol.
  void dateET

  // Bucket items by [dateET][slot], keeping the headline closest to each checkpoint.
  const buckets: Record<string, { am: BucketSlot; pm: BucketSlot }> = {}

  for (const item of parsedItems) {
    const published = new Date(item.pubDateRaw)
    if (Number.isNaN(published.valueOf())) continue

    const publishedDateET = toDateET(published)
    if (!buckets[publishedDateET]) {
      buckets[publishedDateET] = { am: null, pm: null }
    }

    const { hour, minute } = getEtHourMinute(published)
    if (Number.isNaN(hour) || Number.isNaN(minute)) continue

    const slot = hour < 12 ? 'am' : 'pm'
    const minutesSinceMidnight = hour * 60 + minute
    const targetMinutes = slot === 'am' ? 9 * 60 + 30 : 16 * 60
    const minuteGap = Math.abs(minutesSinceMidnight - targetMinutes)

    const current = buckets[publishedDateET][slot]
    if (!current || minuteGap < current.minuteGap) {
      buckets[publishedDateET][slot] = { item, minuteGap }
    }
  }

  const dateKeys = Object.keys(buckets).sort((a, b) => b.localeCompare(a))
  dateKeys.forEach((d) => {
    const b = buckets[d]

    const processSlot = (slotEntry: BucketSlot, isAm: boolean) => {
      if (!slotEntry) return

      const item = slotEntry.item
      const id = buildId(symbol, item)
      const summary = item.description || 'Summary unavailable from source metadata.'
      const tags = inferTags(item.title, item.source)
      const relevanceScore = inferRelevanceScore(symbol, item.title, summary)

      const timeSlot = isAm ? '09:30' : '16:00'
      const timeET = `${timeSlot} EDT`
      const publishedAtET = `${d}T${timeSlot}:00 EDT`

      timeline.push({
        id,
        symbol,
        dateET: d,
        publishedAtET,
        timeET,
        headline: item.title,
        source: item.source,
        summary,
        url: item.link,
      })

      details.push({
        id,
        symbol,
        dateET: d,
        publishedAtET,
        headline: item.title,
        source: item.source,
        summary,
        url: item.link,
        tags,
        relevanceScore,
      })
    }

    processSlot(b.pm, false) // 16:00
    processSlot(b.am, true) // 09:30
  })

  const symbolHistory = tickerNewsHistory.get(symbol) ?? {
    timelineById: new Map<string, TickerNewsItem>(),
    detailsById: new Map<string, NewsDetail>(),
  }

  timeline.forEach((item) => {
    symbolHistory.timelineById.set(item.id, item)
  })
  details.forEach((item) => {
    symbolHistory.detailsById.set(item.id, item)
  })

  let mergedTimeline = sortNewsItems(Array.from(symbolHistory.timelineById.values()))
  let mergedDetails = sortNewsItems(Array.from(symbolHistory.detailsById.values()))

  if (mergedTimeline.length > TICKER_NEWS_HISTORY_MAX_ITEMS) {
    mergedTimeline = mergedTimeline.slice(0, TICKER_NEWS_HISTORY_MAX_ITEMS)
    const keepIds = new Set(mergedTimeline.map((item) => item.id))
    mergedDetails = mergedDetails.filter((item) => keepIds.has(item.id))
  }

  symbolHistory.timelineById = new Map(mergedTimeline.map((item) => [item.id, item]))
  symbolHistory.detailsById = new Map(mergedDetails.map((item) => [item.id, item]))
  tickerNewsHistory.set(symbol, symbolHistory)
  await persistTickerHistoryQueued()

  const payload: BuiltTickerNewsPayload = { timeline: mergedTimeline, details: mergedDetails }
  tickerNewsCache.set(cacheKey, { expiresAt: now + TICKER_NEWS_CACHE_TTL_MS, payload })
  return clonePayload(payload)
}
