import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { hasPromoSignals, isFreeNewsSource, scoreNewsSource, scoreNewsText } from '@/lib/newsQuality'
import { resolveNewsHistoryCandidates } from '@/lib/newsHistoryPaths'
import { ET_TIMEZONE, type ETDateString, type NewsDetail, type TickerNewsItem } from '@/lib/terminal-mvp/types'
import { upsertNewsDetails } from '@/lib/terminal-mvp/serverNewsStore'

const TICKER_NEWS_CACHE_TTL_MS = 1000 * 60 * 30
const TICKER_NEWS_HISTORY_MAX_ITEMS = 50
const TICKER_NEWS_HISTORY_WINDOW_HOURS = 36
const TICKER_NEWS_FETCH_ATTEMPTS = 2
const TICKER_NEWS_RETRY_DELAY_MS = 250
const TICKER_NEWS_HISTORY_PATHS = resolveNewsHistoryCandidates('ticker-news-history-v2-1630.json')
const MARKET_OPEN_MINUTES_ET = 9 * 60 + 30
const MARKET_CLOSE_MINUTES_ET = 16 * 60 + 30

const tickerNewsCache = new Map<string, { expiresAt: number; payload: BuiltTickerNewsPayload }>()
const tickerNewsHistory = new Map<string, { timelineById: Map<string, TickerNewsItem>; detailsById: Map<string, NewsDetail> }>()
let tickerHistoryLoaded = false
let tickerHistoryWriteQueue: Promise<void> = Promise.resolve()

type YahooRssItem = {
  title: string
  link: string
  pubDateRaw: string
  source: string
  description: string
}

type StoredTickerNewsPayload = {
  updatedAt: string
  symbols: Record<string, { timeline: TickerNewsItem[]; details: NewsDetail[] }>
}

export type BuiltTickerNewsPayload = {
  timeline: TickerNewsItem[]
  details: NewsDetail[]
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

const toDateET = (value: Date): ETDateString =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)

const toTimeET = (value: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(value).replace(/^24:/, '00:')

const getNewsCheckpointKey = (now: Date = new Date()): 'preopen' | 'open' | 'close' => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  const totalMinutes = hour * 60 + minute
  if (totalMinutes < MARKET_OPEN_MINUTES_ET) return 'preopen'
  if (totalMinutes < MARKET_CLOSE_MINUTES_ET) return 'open'
  return 'close'
}

const buildIdFromYahoo = (symbol: string, item: YahooRssItem): string => {
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
  if (tokens.includes('fed') || tokens.includes('powell') || tokens.includes('rate')) tags.add('macro')
  if (!tags.size) tags.add('news')
  return [...tags]
}

const inferRelevanceScore = (symbol: string, headline: string, summary: string): number => {
  const text = `${headline} ${summary}`.toUpperCase()
  const directMentionBoost = text.includes(symbol.toUpperCase()) ? 0.2 : 0
  const topicalBoost = scoreNewsText(text) * 0.03
  const sourceBoost = scoreNewsSource(headline) > 0 ? 0.05 : 0
  const base = 0.48 + directMentionBoost + topicalBoost + sourceBoost
  return Math.max(0.35, Math.min(0.98, Number(base.toFixed(2))))
}

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

  for (const candidate of TICKER_NEWS_HISTORY_PATHS) {
    try {
      const raw = await fs.readFile(candidate, 'utf8')
      const parsed = JSON.parse(raw) as StoredTickerNewsPayload
      if (!parsed || typeof parsed !== 'object' || !parsed.symbols || typeof parsed.symbols !== 'object') {
        continue
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
      return
    } catch {
      // try next candidate
    }
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

  const payload: StoredTickerNewsPayload = {
    updatedAt: new Date().toISOString(),
    symbols,
  }
  let lastError: unknown = null
  for (const candidate of TICKER_NEWS_HISTORY_PATHS) {
    try {
      await fs.mkdir(path.dirname(candidate), { recursive: true })
      await fs.writeFile(candidate, JSON.stringify(payload, null, 2), 'utf8')
      return
    } catch (err) {
      lastError = err
    }
  }
  if (lastError) {
    console.warn('[terminal-ticker-news] history cache write failed:', lastError)
  }
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

const fetchWithTimeout = async (input: string, init: RequestInit, timeoutMs = 6000): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const fetchWithRetry = async (
  input: string,
  init: RequestInit,
  timeoutMs = 6000,
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

const parseYahooRss = (xml: string): YahooRssItem[] => {
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
  return itemBlocks
    .map((itemXml) => {
      const title = decodeHtml(itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
      const link = decodeHtml(itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '')
      const pubDateRaw = decodeHtml(itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '')
      const source = decodeHtml(itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || '') || 'Yahoo Finance'
      const description = stripHtml(decodeHtml(itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] || ''))
      return { title, link, pubDateRaw, source, description }
    })
    .filter((item) => item.title && item.link && item.pubDateRaw)
}

const readTag = (xmlBlock: string, tag: string): string => {
  const match = xmlBlock.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!match?.[1]) return ''
  return match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()
}

const parsePublishedAtTs = (publishedAtET: string): number => {
  const etMatch = publishedAtET.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}) ET$/)
  const normalized = etMatch ? `${etMatch[1]}T${etMatch[2]}-05:00` : publishedAtET
  const ts = Date.parse(normalized)
  return Number.isFinite(ts) ? ts : 0
}

const parseGoogleNewsRss = (xml: string): YahooRssItem[] => {
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
  return itemBlocks
    .map((itemXml) => {
      const rawTitle = decodeHtml(readTag(itemXml, 'title'))
      const source = decodeHtml(readTag(itemXml, 'source')) || 'Google News'
      const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)).trim() : rawTitle
      const link = decodeHtml(readTag(itemXml, 'link'))
      const pubDateRaw = decodeHtml(readTag(itemXml, 'pubDate'))
      const description = stripHtml(decodeHtml(readTag(itemXml, 'description')))
      return { title, link, pubDateRaw, source, description }
    })
    .filter((item) => item.title && item.link && item.pubDateRaw)
}

const buildPayloadFromYahoo = (
  symbol: string,
  parsedItems: YahooRssItem[],
): { timeline: TickerNewsItem[]; details: NewsDetail[] } => {
  type BucketSlot = { item: YahooRssItem; minuteGap: number; qualityScore: number } | null
  const buckets: Record<string, { am: BucketSlot; pm: BucketSlot }> = {}

  for (const item of parsedItems) {
    const published = new Date(item.pubDateRaw)
    if (Number.isNaN(published.valueOf())) continue

    const publishedDateET = toDateET(published)
    if (!buckets[publishedDateET]) buckets[publishedDateET] = { am: null, pm: null }

    const text = `${item.title} ${item.description}`
    if (!isFreeNewsSource(item.source) || hasPromoSignals(text)) continue

    const hhmm = new Intl.DateTimeFormat('en-US', {
      timeZone: ET_TIMEZONE,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).format(published)
    const [hourRaw, minuteRaw] = hhmm.split(':')
    const hour = Number(hourRaw)
    const minute = Number(minuteRaw)
    if (Number.isNaN(hour) || Number.isNaN(minute)) continue

    const slot = hour < 12 ? 'am' : 'pm'
    const minutesSinceMidnight = hour * 60 + minute
    const targetMinutes = slot === 'am' ? 9 * 60 + 30 : 16 * 60 + 30
    const minuteGap = Math.abs(minutesSinceMidnight - targetMinutes)
    const qualityScore = scoreNewsText(text) * 2 + scoreNewsSource(item.source)

    const current = buckets[publishedDateET][slot]
    if (!current || qualityScore > current.qualityScore || (qualityScore === current.qualityScore && minuteGap < current.minuteGap)) {
      buckets[publishedDateET][slot] = { item, minuteGap, qualityScore }
    }
  }

  const timeline: TickerNewsItem[] = []
  const details: NewsDetail[] = []

  Object.keys(buckets).sort((a, b) => b.localeCompare(a)).forEach((d) => {
    const b = buckets[d]
    const processSlot = (slotEntry: BucketSlot, isAm: boolean) => {
      if (!slotEntry) return
      const item = slotEntry.item
      const id = buildIdFromYahoo(symbol, item)
      const summary = item.description || 'Summary unavailable from source metadata.'
      const tags = inferTags(item.title, item.source)
      const relevanceScore = inferRelevanceScore(symbol, item.title, summary)
      const timeSlot = isAm ? '09:30' : '16:30'
      const timeET = `${timeSlot} ET`
      const publishedAtET = `${d}T${timeSlot}:00 ET`

      timeline.push({ id, symbol, dateET: d, publishedAtET, timeET, headline: item.title, source: item.source, summary, url: item.link })
      details.push({ id, symbol, dateET: d, publishedAtET, headline: item.title, source: item.source, summary, url: item.link, tags, relevanceScore })
    }
    processSlot(b.pm, false)
    processSlot(b.am, true)
  })

  return { timeline, details }
}

const fetchYahooFreeNews = async (symbol: string): Promise<{ timeline: TickerNewsItem[]; details: NewsDetail[] }> => {
  const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`
  const res = await fetchWithRetry(rssUrl, { next: { revalidate: 3600 } }, 4500)
  if (!res) throw new Error('Yahoo RSS request failed after retries')
  const xml = await res.text()
  return buildPayloadFromYahoo(symbol, parseYahooRss(xml))
}

const fetchGoogleFreeNews = async (symbol: string): Promise<{ timeline: TickerNewsItem[]; details: NewsDetail[] }> => {
  const query = `${symbol} stock`
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  const res = await fetchWithRetry(rssUrl, { next: { revalidate: 3600 } }, 4500)
  if (!res) throw new Error('Google News RSS request failed after retries')
  const xml = await res.text()
  return buildPayloadFromYahoo(symbol, parseGoogleNewsRss(xml))
}

const clonePayload = (payload: BuiltTickerNewsPayload): BuiltTickerNewsPayload => ({
  timeline: payload.timeline.map((item) => ({ ...item })),
  details: payload.details.map((item) => ({ ...item })),
})

export async function fetchTickerNewsFromYahoo(symbol: string, dateET: ETDateString): Promise<BuiltTickerNewsPayload> {
  await loadTickerHistoryFromDisk()
  void dateET

  const cacheKey = `v3-session:${symbol}:${dateET}:${getNewsCheckpointKey()}`
  const now = Date.now()
  const cached = tickerNewsCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return clonePayload(cached.payload)
  if (cached && cached.expiresAt <= now) tickerNewsCache.delete(cacheKey)

  let freshTimeline: TickerNewsItem[] = []
  let freshDetails: NewsDetail[] = []

  try {
    const built = await fetchYahooFreeNews(symbol)
    freshTimeline = built.timeline
    freshDetails = built.details
    if (!freshTimeline.length || !freshDetails.length) {
      const fallback = await fetchGoogleFreeNews(symbol)
      if (fallback.timeline.length || fallback.details.length) {
        freshTimeline = fallback.timeline
        freshDetails = fallback.details
      }
    }
  } catch (error) {
    try {
      const fallback = await fetchGoogleFreeNews(symbol)
      freshTimeline = fallback.timeline
      freshDetails = fallback.details
    } catch {
      const stale = tickerNewsHistory.get(symbol)
      if (stale?.timelineById?.size && stale?.detailsById?.size) {
        return clonePayload({
          timeline: sortNewsItems(Array.from(stale.timelineById.values())),
          details: sortNewsItems(Array.from(stale.detailsById.values())),
        })
      }
      throw error
    }
  }

  const symbolHistory = tickerNewsHistory.get(symbol) ?? {
    timelineById: new Map<string, TickerNewsItem>(),
    detailsById: new Map<string, NewsDetail>(),
  }

  freshTimeline.forEach((item) => symbolHistory.timelineById.set(item.id, item))
  freshDetails.forEach((item) => symbolHistory.detailsById.set(item.id, item))

  const cutoffTs = Date.now() - TICKER_NEWS_HISTORY_WINDOW_HOURS * 60 * 60 * 1000

  let mergedTimeline = sortNewsItems(
    Array.from(symbolHistory.timelineById.values()).filter((item) => parsePublishedAtTs(item.publishedAtET) >= cutoffTs),
  )
  let mergedDetails = sortNewsItems(
    Array.from(symbolHistory.detailsById.values()).filter((item) => parsePublishedAtTs(item.publishedAtET) >= cutoffTs),
  )

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
  upsertNewsDetails(mergedDetails)
  return clonePayload(payload)
}




