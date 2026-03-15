import { randomUUID } from 'crypto'

import type { ETDateString, NewsDetail } from '@/lib/terminal-mvp/types'

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'after',
  'into',
  'over',
  'under',
  'amid',
  'near',
  'ahead',
  'news',
  'market',
  'stock',
  'shares',
  'report',
  'says',
  'said',
  'update',
  'updates',
  'today',
  'et',
  'inc',
  'corp',
  'co',
  'to',
  'of',
  'in',
  'on',
  'at',
  'is',
  'are',
  'be',
  'as',
  'by',
  'an',
  'a',
])

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const normalizeSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim()

const normalizeTitle = (value: string): string =>
  normalizeSpaces(value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' '))

const normalizeSource = (value: string): string => normalizeTitle(value)

const normalizeToken = (value: string): string => normalizeTitle(value).replace(/\s/g, '')

const parsePublishedAtTs = (publishedAtET: string): number => {
  const etMatch = publishedAtET.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}) ET$/)
  const normalized = etMatch ? `${etMatch[1]}T${etMatch[2]}-05:00` : publishedAtET
  const ts = Date.parse(normalized)
  return Number.isNaN(ts) ? Date.now() : ts
}

const canonicalizeUrl = (raw?: string): string => {
  if (!raw) return ''
  try {
    const url = new URL(raw)
    url.hash = ''
    const blockedParams = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'cmpid',
      'ref',
      'src',
    ])
    const nextParams = new URLSearchParams()
    url.searchParams.forEach((value, key) => {
      if (!blockedParams.has(key.toLowerCase())) {
        nextParams.append(key, value)
      }
    })
    const nextSearch = nextParams.toString()
    url.search = nextSearch ? `?${nextSearch}` : ''
    const pathname = url.pathname.replace(/\/+$/, '')
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}${url.search}`
  } catch {
    return raw.trim()
  }
}

const extractKeywords = (headline: string, summary: string): Set<string> => {
  const normalized = normalizeTitle(`${headline} ${summary}`)
  const tokens = normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  return new Set(tokens.slice(0, 30))
}

const overlapRatio = (left: Set<string>, right: Set<string>): number => {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / Math.max(1, Math.min(left.size, right.size))
}

type PreparedNewsItem = {
  newsId: string
  symbol: string
  dateET: ETDateString
  headline: string
  source: string
  summary: string
  publishedAtET: string
  publishedAtTs: number
  relevanceScore: number
  url?: string
  canonicalUrl: string
  normalizedTitle: string
  normalizedSource: string
  keywords: Set<string>
  tags: Set<string>
  duplicateCount: number
  createdAtET: string
}

type MutableCluster = {
  clusterId: string
  symbol: string
  dateET: ETDateString
  items: PreparedNewsItem[]
  keywordIndex: Set<string>
  tagIndex: Set<string>
  newestTs: number
}

export type NewsCluster = {
  clusterId: string
  symbol: string
  dateET: ETDateString
  representativeNewsId: string
  representativeTitle: string
  representativeSource: string
  representativeSummary: string
  representativePublishedAtET: string
  representativeUrl?: string
  relatedArticleCount: number
  importanceScore: number
  eventTags: string[]
  createdAtET: string
}

export type NewsClusterItem = {
  clusterItemId: string
  clusterId: string
  newsId: string
  headline: string
  source: string
  publishedAtET: string
  url?: string
  canonicalUrl: string
  normalizedTitle: string
  tags: string[]
  isRepresentative: boolean
  duplicateCount: number
  createdAtET: string
}

export type NewsClusterResult = {
  rawCount: number
  dedupedCount: number
  clusters: NewsCluster[]
  clusterItems: NewsClusterItem[]
}

const prepareNewsItem = (
  raw: NewsDetail,
  fallbackSymbol: string,
  fallbackDateET: ETDateString,
): PreparedNewsItem => {
  const normalizedTitle = normalizeTitle(raw.headline)
  const canonicalUrl = canonicalizeUrl(raw.url)
  const createdAtET = new Date().toISOString()
  return {
    newsId: raw.id,
    symbol: (raw.symbol ?? fallbackSymbol).toUpperCase(),
    dateET: raw.dateET || fallbackDateET,
    headline: normalizeSpaces(raw.headline),
    source: normalizeSpaces(raw.source),
    summary: normalizeSpaces(raw.summary),
    publishedAtET: raw.publishedAtET,
    publishedAtTs: parsePublishedAtTs(raw.publishedAtET),
    relevanceScore: clamp(raw.relevanceScore ?? 0.5, 0.1, 0.99),
    url: raw.url,
    canonicalUrl,
    normalizedTitle,
    normalizedSource: normalizeSource(raw.source),
    keywords: extractKeywords(raw.headline, raw.summary),
    tags: new Set((raw.tags ?? []).map(normalizeToken).filter(Boolean)),
    duplicateCount: 1,
    createdAtET,
  }
}

const isExactDuplicate = (candidate: PreparedNewsItem, target: PreparedNewsItem): boolean => {
  if (candidate.canonicalUrl && target.canonicalUrl && candidate.canonicalUrl === target.canonicalUrl) {
    return true
  }

  const timeDeltaMs = Math.abs(candidate.publishedAtTs - target.publishedAtTs)
  if (candidate.normalizedTitle && candidate.normalizedTitle === target.normalizedTitle) {
    if (candidate.normalizedSource === target.normalizedSource) {
      return true
    }
    if (timeDeltaMs <= 90 * 60 * 1000) {
      return true
    }
  }

  if (
    candidate.normalizedSource === target.normalizedSource &&
    timeDeltaMs <= 30 * 60 * 1000 &&
    (candidate.normalizedTitle.startsWith(target.normalizedTitle) ||
      target.normalizedTitle.startsWith(candidate.normalizedTitle))
  ) {
    return true
  }

  return false
}

const dedupeExactNews = (items: PreparedNewsItem[]): PreparedNewsItem[] => {
  const sorted = [...items].sort((a, b) => b.publishedAtTs - a.publishedAtTs)
  const deduped: PreparedNewsItem[] = []

  for (const item of sorted) {
    const duplicate = deduped.find((existing) => isExactDuplicate(item, existing))
    if (!duplicate) {
      deduped.push({ ...item })
      continue
    }
    duplicate.duplicateCount += 1
    for (const token of item.keywords) duplicate.keywords.add(token)
    for (const tag of item.tags) duplicate.tags.add(tag)
    if (item.relevanceScore > duplicate.relevanceScore + 0.08) {
      duplicate.headline = item.headline
      duplicate.summary = item.summary
      duplicate.source = item.source
      duplicate.url = item.url
      duplicate.canonicalUrl = item.canonicalUrl
      duplicate.publishedAtET = item.publishedAtET
      duplicate.publishedAtTs = item.publishedAtTs
      duplicate.relevanceScore = item.relevanceScore
      duplicate.newsId = item.newsId
      duplicate.createdAtET = item.createdAtET
    }
  }

  return deduped
}

const scoreClusterMatch = (item: PreparedNewsItem, cluster: MutableCluster): number => {
  let score = 0

  if (item.symbol === cluster.symbol) score += 1

  const keywordOverlap = overlapRatio(item.keywords, cluster.keywordIndex)
  if (keywordOverlap >= 0.2) score += 1
  else if (keywordOverlap >= 0.1) score += 0.5

  const tagOverlap = overlapRatio(item.tags, cluster.tagIndex)
  if (tagOverlap > 0) score += 0.9

  const timeDeltaMinutes = Math.abs(item.publishedAtTs - cluster.newestTs) / (1000 * 60)
  if (timeDeltaMinutes <= 240) score += 1
  else if (timeDeltaMinutes <= 720) score += 0.5

  if (timeDeltaMinutes <= 120 && keywordOverlap >= 0.12) score += 0.3
  return score
}

const pickRepresentative = (items: PreparedNewsItem[], nowTs: number): PreparedNewsItem => {
  let best = items[0]
  let bestScore = -1
  for (const item of items) {
    const ageDays = Math.max(0, (nowTs - item.publishedAtTs) / (1000 * 60 * 60 * 24))
    const recencyScore = clamp(1 - ageDays, 0, 1)
    const duplicateBoost = clamp((item.duplicateCount - 1) / 4, 0, 0.25)
    const keywordDepth = clamp(item.keywords.size / 12, 0, 0.2)
    const score =
      item.relevanceScore * 0.65 +
      recencyScore * 0.2 +
      duplicateBoost +
      keywordDepth
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best
}

const toSortedTags = (items: PreparedNewsItem[]): string[] => {
  const countByTag = new Map<string, number>()
  for (const item of items) {
    for (const tag of item.tags) {
      countByTag.set(tag, (countByTag.get(tag) ?? 0) + item.duplicateCount)
    }
  }
  return [...countByTag.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([tag]) => tag)
}

const computeImportanceScore = (
  representative: PreparedNewsItem,
  clusterItems: PreparedNewsItem[],
  eventTagCount: number,
  nowTs: number,
): number => {
  const articleCount = clusterItems.reduce((total, item) => total + item.duplicateCount, 0)
  const avgRelevance =
    clusterItems.reduce((total, item) => total + item.relevanceScore, 0) /
    Math.max(1, clusterItems.length)
  const recencyDays = Math.max(0, (nowTs - representative.publishedAtTs) / (1000 * 60 * 60 * 24))
  const recencyScore = clamp(1 - recencyDays, 0, 1)
  const relatedBoost = clamp(Math.log2(1 + articleCount) / 3, 0, 0.3)
  const tagBoost = clamp(eventTagCount / 8, 0, 0.15)
  return Number(
    clamp(
      representative.relevanceScore * 0.45 +
        avgRelevance * 0.2 +
        recencyScore * 0.15 +
        relatedBoost +
        tagBoost,
      0.05,
      0.99,
    ).toFixed(3),
  )
}

export function clusterNewsEvents(
  symbol: string,
  dateET: ETDateString,
  details: NewsDetail[],
): NewsClusterResult {
  if (!details.length) {
    return {
      rawCount: 0,
      dedupedCount: 0,
      clusters: [],
      clusterItems: [],
    }
  }

  const prepared = details.map((detail) => prepareNewsItem(detail, symbol, dateET))
  const deduped = dedupeExactNews(prepared)
  const sorted = [...deduped].sort((a, b) => b.publishedAtTs - a.publishedAtTs)
  const mutableClusters: MutableCluster[] = []

  for (const item of sorted) {
    let bestCluster: MutableCluster | null = null
    let bestScore = 0

    for (const cluster of mutableClusters) {
      const score = scoreClusterMatch(item, cluster)
      if (score > bestScore) {
        bestScore = score
        bestCluster = cluster
      }
    }

    if (!bestCluster || bestScore < 2.2) {
      const clusterId = randomUUID()
      mutableClusters.push({
        clusterId,
        symbol: item.symbol,
        dateET: item.dateET,
        items: [item],
        keywordIndex: new Set(item.keywords),
        tagIndex: new Set(item.tags),
        newestTs: item.publishedAtTs,
      })
      continue
    }

    bestCluster.items.push(item)
    for (const token of item.keywords) bestCluster.keywordIndex.add(token)
    for (const tag of item.tags) bestCluster.tagIndex.add(tag)
    if (item.publishedAtTs > bestCluster.newestTs) {
      bestCluster.newestTs = item.publishedAtTs
    }
  }

  const nowTs = Date.now()
  const clusters: NewsCluster[] = []
  const clusterItems: NewsClusterItem[] = []

  for (const cluster of mutableClusters) {
    const representative = pickRepresentative(cluster.items, nowTs)
    const eventTags = toSortedTags(cluster.items)
    const relatedArticleCount = cluster.items.reduce(
      (total, item) => total + item.duplicateCount,
      0,
    )
    const importanceScore = computeImportanceScore(
      representative,
      cluster.items,
      eventTags.length,
      nowTs,
    )

    clusters.push({
      clusterId: cluster.clusterId,
      symbol: cluster.symbol,
      dateET: cluster.dateET,
      representativeNewsId: representative.newsId,
      representativeTitle: representative.headline,
      representativeSource: representative.source,
      representativeSummary: representative.summary,
      representativePublishedAtET: representative.publishedAtET,
      representativeUrl: representative.url,
      relatedArticleCount,
      importanceScore,
      eventTags,
      createdAtET: representative.createdAtET,
    })

    for (const item of cluster.items) {
      clusterItems.push({
        clusterItemId: randomUUID(),
        clusterId: cluster.clusterId,
        newsId: item.newsId,
        headline: item.headline,
        source: item.source,
        publishedAtET: item.publishedAtET,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        normalizedTitle: item.normalizedTitle,
        tags: [...item.tags],
        isRepresentative: item.newsId === representative.newsId,
        duplicateCount: item.duplicateCount,
        createdAtET: item.createdAtET,
      })
    }
  }

  const sortedClusters = [...clusters].sort(
    (a, b) =>
      b.importanceScore - a.importanceScore ||
      parsePublishedAtTs(b.representativePublishedAtET) -
        parsePublishedAtTs(a.representativePublishedAtET),
  )

  return {
    rawCount: prepared.length,
    dedupedCount: deduped.length,
    clusters: sortedClusters,
    clusterItems,
  }
}

