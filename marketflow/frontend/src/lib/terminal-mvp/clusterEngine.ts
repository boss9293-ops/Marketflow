import { clusterNewsEvents, type NewsClusterResult } from '@/lib/terminal-mvp/newsClustering'
import type { ETDateString, NewsDetail } from '@/lib/terminal-mvp/types'

export type DensityNewsItem = {
  id: string
  timeET: string
  headline: string
  summary: string
}

export type DensityClusterType =
  | 'analyst'
  | 'macro'
  | 'earnings'
  | 'sector'
  | 'company_event'
  | 'price_action'
  | 'other'

export type DensityCluster = {
  clusterId: string
  type: DensityClusterType
  count: number
  summary: string
  direction: 'positive' | 'negative' | 'neutral'
  importanceScore: number
  eventTags: string[]
  items: DensityNewsItem[]
}

export type DensityClusterResult = {
  rawCount: number
  dedupedCount: number
  clusters: DensityCluster[]
}

const ANALYST_KEYWORDS = ['price target', 'target', 'upgrade', 'downgrade', 'reiterate', 'rating', 'analyst']
const MACRO_KEYWORDS = ['yield', 'inflation', 'fed', 'rates', 'treasury', 'cpi', 'ppi', 'dollar', 'macro']
const EARNINGS_KEYWORDS = ['earnings', 'guidance', 'revenue', 'margin', 'eps', 'sales', 'beat', 'miss']
const SECTOR_KEYWORDS = ['semiconductor', 'chip', 'chips', 'sector', 'software', 'energy', 'bank', 'health care']
const COMPANY_EVENT_KEYWORDS = ['launch', 'release', 'contract', 'deal', 'partnership', 'delivery', 'shipment', 'production', 'buyback', 'filing', 'recall', 'lawsuit', 'approval', 'product']
const PRICE_ACTION_KEYWORDS = ['breakout', 'support', 'resistance', 'record high', 'record low', 'range', 'volatility', 'rally', 'selloff', 'death cross']

const TYPE_PRIORITY: Record<DensityClusterType, number> = {
  macro: 5,
  analyst: 4,
  earnings: 4,
  sector: 3,
  company_event: 3,
  price_action: 2,
  other: 1,
}

const toLower = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim()

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword))

const normalizeTimeET = (dateET: ETDateString, timeET: string): string => {
  const clock = /^\d{2}:\d{2}/.test(timeET) ? `${timeET.slice(0, 5)}:00` : '09:30:00'
  return `${dateET}T${clock} ET`
}

const normalizeType = (text: string): DensityClusterType => {
  if (containsAny(text, ANALYST_KEYWORDS)) return 'analyst'
  if (containsAny(text, MACRO_KEYWORDS)) return 'macro'
  if (containsAny(text, EARNINGS_KEYWORDS)) return 'earnings'
  if (containsAny(text, SECTOR_KEYWORDS)) return 'sector'
  if (containsAny(text, COMPANY_EVENT_KEYWORDS)) return 'company_event'
  if (containsAny(text, PRICE_ACTION_KEYWORDS)) return 'price_action'
  return 'other'
}

const normalizeDirection = (text: string): 'positive' | 'negative' | 'neutral' => {
  const positiveSignals = ['beat', 'raise', 'raised', 'upgrade', 'higher', 'increase', 'support', 'approval', 'launch', 'deal', 'record', 'strong', 'improve', 'recovery', 'upside']
  const negativeSignals = ['miss', 'cut', 'lower', 'downgrade', 'weak', 'decline', 'slump', 'pressure', 'probe', 'risk', 'concern', 'delay', 'shortfall', 'selloff', 'drop', 'fall', 'downside']
  const pos = positiveSignals.filter((hint) => text.includes(hint)).length
  const neg = negativeSignals.filter((hint) => text.includes(hint)).length
  if (pos > neg + 1) return 'positive'
  if (neg > pos + 1) return 'negative'
  return 'neutral'
}

const buildTypeSummary = (type: DensityClusterType, count: number, summaries: string[]): string => {
  const first = summaries[0] ?? ''
  const second = summaries[1] ?? ''
  if (count === 1) return first

  switch (type) {
    case 'analyst':
      return 'Multiple analyst actions and price-target revisions are shaping valuation expectations.'
    case 'macro':
      return 'Macro and rates pressure is driving the tape and keeping growth valuations under scrutiny.'
    case 'earnings':
      return 'Earnings and guidance updates are framing the session narrative.'
    case 'sector':
      return 'Sector rotation and peer read-throughs are influencing the move.'
    case 'company_event':
      return 'Multiple company-specific catalysts are clustering around the stock.'
    case 'price_action':
      return 'Price action and technical levels are reinforcing the move.'
    default:
      return second ? `${first} / ${second}` : first
  }
}

const buildClusterKey = (type: DensityClusterType, text: string): string => {
  const normalized = toLower(text)
  const keywordGroups: Record<DensityClusterType, string[]> = {
    analyst: ANALYST_KEYWORDS,
    macro: MACRO_KEYWORDS,
    earnings: EARNINGS_KEYWORDS,
    sector: SECTOR_KEYWORDS,
    company_event: COMPANY_EVENT_KEYWORDS,
    price_action: PRICE_ACTION_KEYWORDS,
    other: [],
  }
  const group = keywordGroups[type]
  const hit = group.find((keyword) => normalized.includes(keyword))
  return hit ? `${type}:${hit}` : `${type}:misc`
}

const buildNewsDetails = (symbol: string, dateET: ETDateString, items: DensityNewsItem[]): NewsDetail[] =>
  items.map((item, index) => ({
    id: item.id || `${symbol}-${index}`,
    symbol,
    dateET,
    publishedAtET: normalizeTimeET(dateET, item.timeET),
    headline: item.headline,
    source: 'terminal-batch',
    summary: item.summary || item.headline,
    tags: [],
    relevanceScore: 0.5,
    url: undefined,
  }))

const summarizeCluster = (type: DensityClusterType, items: DensityNewsItem[]): string => {
  const summaries = items
    .map((item) => item.summary?.trim() || item.headline?.trim() || '')
    .filter(Boolean)
  return buildTypeSummary(type, items.length, summaries)
}

export function clusterNewsItems(
  symbol: string,
  dateET: ETDateString,
  items: DensityNewsItem[],
): DensityClusterResult {
  if (!items.length) {
    return { rawCount: 0, dedupedCount: 0, clusters: [] }
  }

  const details = buildNewsDetails(symbol, dateET, items)
  const clustering: NewsClusterResult = clusterNewsEvents(symbol, dateET, details)
  const lookup = new Map(items.map((item) => [item.id, item]))
  const groups = new Map<string, DensityNewsItem[]>()

  for (const clusterItem of clustering.clusterItems) {
    const sourceItem = lookup.get(clusterItem.newsId)
    if (!sourceItem) continue
    const bucket = groups.get(clusterItem.clusterId) ?? []
    bucket.push(sourceItem)
    groups.set(clusterItem.clusterId, bucket)
  }

  const clusters = clustering.clusters.map((cluster) => {
    const text = `${cluster.representativeTitle} ${cluster.representativeSummary} ${cluster.eventTags.join(' ')}`
    const type = normalizeType(toLower(text))
    const itemsForCluster = groups.get(cluster.clusterId) ?? []
    const summary = summarizeCluster(type, itemsForCluster.length ? itemsForCluster : [lookup.get(cluster.representativeNewsId) ?? items[0]])
    return {
      clusterId: cluster.clusterId,
      type,
      count: cluster.relatedArticleCount,
      summary,
      direction: normalizeDirection(toLower(summary)),
      importanceScore: cluster.importanceScore,
      eventTags: cluster.eventTags,
      items: itemsForCluster.length ? itemsForCluster : [items[0]],
    }
  })

  const sortedClusters = [...clusters].sort(
    (a, b) =>
      TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type] ||
      b.importanceScore - a.importanceScore ||
      b.count - a.count ||
      a.summary.localeCompare(b.summary),
  )

  return {
    rawCount: items.length,
    dedupedCount: clustering.dedupedCount,
    clusters: sortedClusters,
  }
}

