import { createHash } from 'crypto'

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

const stripHtml = (raw: string): string =>
  raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

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

const toTimeET = (value: Date): string =>
  `${new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)} ET`

const toPublishedAtET = (value: Date): string =>
  `${toDateET(value)}T${new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value).replace(',', '')} ET`

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
  return itemBlocks.map((itemXml) => {
    const title = decodeHtml(readTag(itemXml, 'title'))
    const link = decodeHtml(readTag(itemXml, 'link'))
    const pubDateRaw = decodeHtml(readTag(itemXml, 'pubDate'))
    const source = decodeHtml(readTag(itemXml, 'source')) || 'Yahoo Finance'
    const description = stripHtml(decodeHtml(readTag(itemXml, 'description')))
    return { title, link, pubDateRaw, source, description }
  }).filter((item) => item.title && item.link && item.pubDateRaw)
}

export type BuiltTickerNewsPayload = {
  timeline: TickerNewsItem[]
  details: NewsDetail[]
}

export async function fetchTickerNewsFromYahoo(symbol: string, dateET: ETDateString): Promise<BuiltTickerNewsPayload> {
  const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`
  const res = await fetch(rssUrl, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Yahoo RSS request failed (${res.status})`)
  }

  const xml = await res.text()
  const parsedItems = parseYahooRss(xml)

  const details: NewsDetail[] = []
  const timeline: TickerNewsItem[] = []

  for (const item of parsedItems) {
    const published = new Date(item.pubDateRaw)
    if (Number.isNaN(published.valueOf())) continue
    const publishedDateET = toDateET(published)
    if (publishedDateET !== dateET) continue

    const id = buildId(symbol, item)
    const summary = item.description || 'Summary unavailable from source metadata.'
    const tags = inferTags(item.title, item.source)
    const relevanceScore = inferRelevanceScore(symbol, item.title, summary)
    const publishedAtET = toPublishedAtET(published)
    const timeET = toTimeET(published)

    timeline.push({
      id,
      symbol,
      dateET,
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
      dateET,
      publishedAtET,
      headline: item.title,
      source: item.source,
      summary,
      url: item.link,
      tags,
      relevanceScore,
    })
  }

  return { timeline, details }
}
