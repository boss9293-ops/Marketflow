import { hasPromoSignals, isFreeNewsSource, scoreNewsSource } from '@/lib/newsQuality'

export type NewsArticle = {
  title?: string | null
  publisher?: string | null
  published_at?: string | null
  url?: string | null
  summary?: string | null
}

export type NewsCluster = 'rates' | 'liquidity' | 'volatility' | 'cross_asset' | 'general'

export type ProcessedNews = {
  quality: 'Fresh' | 'Partial' | 'Stale'
  selected: Array<NewsArticle & { score: number; cluster: NewsCluster }>
}

const CLUSTER_RULES: Array<{ cluster: NewsCluster; words: string[] }> = [
  { cluster: 'rates', words: ['fed', 'powell', 'rate', 'yield', 'treasury', 'cpi', 'inflation', 'ppi'] },
  { cluster: 'liquidity', words: ['liquidity', 'qt', 'qe', 'balance sheet', 'rrp', 'repo', 'credit'] },
  { cluster: 'volatility', words: ['vix', 'volatility', 'hedge', 'risk'] },
  { cluster: 'cross_asset', words: ['bitcoin', 'btc', 'gold', 'real yield', 'tips', 'm2'] },
]

function tokenize(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || []
}

function cosine(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (!ta.length || !tb.length) return 0

  const fa = new Map<string, number>()
  const fb = new Map<string, number>()
  for (const word of ta) fa.set(word, (fa.get(word) || 0) + 1)
  for (const word of tb) fb.set(word, (fb.get(word) || 0) + 1)

  let dot = 0
  let aa = 0
  let bb = 0
  const keys = new Set([...Array.from(fa.keys()), ...Array.from(fb.keys())])
  for (const key of Array.from(keys)) {
    const va = fa.get(key) || 0
    const vb = fb.get(key) || 0
    dot += va * vb
    aa += va * va
    bb += vb * vb
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1)
}

function hoursFromNow(ts?: string | null): number {
  if (!ts) return 999
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return 999
  return Math.max(0, (Date.now() - date.getTime()) / 36e5)
}

function recencyScore(hours: number): number {
  if (hours <= 6) return 3
  if (hours <= 24) return 2
  if (hours <= 48) return 1
  return 0
}

function keywordHits(text: string): number {
  const lower = text.toLowerCase()
  let hits = 0
  for (const rule of CLUSTER_RULES) {
    for (const word of rule.words) {
      if (lower.includes(word)) hits += 1
    }
  }
  return hits
}

function classifyCluster(text: string): NewsCluster {
  const lower = text.toLowerCase()
  let best: NewsCluster = 'general'
  let bestHits = 0
  for (const rule of CLUSTER_RULES) {
    const hits = rule.words.reduce((count, word) => count + (lower.includes(word) ? 1 : 0), 0)
    if (hits > bestHits) {
      bestHits = hits
      best = rule.cluster
    }
  }
  return best
}

function sharedKeywordCount(a: string, b: string): number {
  const sa = new Set(tokenize(a))
  const sb = new Set(tokenize(b))
  let count = 0
  for (const word of Array.from(sa)) {
    if (sb.has(word)) count += 1
  }
  return count
}

function publisherScore(pub?: string | null): number {
  return scoreNewsSource(pub)
}

export function postProcessNews(input: NewsArticle[], maxItems = 5): ProcessedNews {
  const items = (input || [])
    .filter((article) => isFreeNewsSource(article.publisher) && !hasPromoSignals(`${article.title || ''} ${article.summary || ''}`))
    .map((article) => {
      const text = `${article.title || ''} ${article.summary || ''}`
      const hours = hoursFromNow(article.published_at)
      const score = keywordHits(text) * 2 + recencyScore(hours) + publisherScore(article.publisher)
      const cluster = classifyCluster(text)
      return { ...article, score, cluster }
    })

  items.sort((a, b) => b.score - a.score)

  const deduped: Array<NewsArticle & { score: number; cluster: NewsCluster }> = []
  for (const current of items) {
    const currentText = `${current.title || ''} ${current.summary || ''}`
    const currentHours = hoursFromNow(current.published_at)
    const dupIdx = deduped.findIndex((existing) => {
      const existingText = `${existing.title || ''} ${existing.summary || ''}`
      const existingHours = hoursFromNow(existing.published_at)
      const sim = cosine(currentText, existingText)
      const shared = sharedKeywordCount(currentText, existingText)
      return sim > 0.85 || (shared >= 6 && Math.abs(currentHours - existingHours) <= 12)
    })

    if (dupIdx < 0) {
      deduped.push(current)
      continue
    }

    const existing = deduped[dupIdx]
    if (current.score > existing.score || (current.score === existing.score && currentHours < hoursFromNow(existing.published_at))) {
      deduped[dupIdx] = current
    }
  }

  const picked: Array<NewsArticle & { score: number; cluster: NewsCluster }> = []
  const used = new Set<string>()

  for (const cluster of ['rates', 'liquidity', 'volatility', 'cross_asset'] as NewsCluster[]) {
    const top = deduped.find((item) => item.cluster === cluster)
    if (top) {
      picked.push(top)
      used.add(top.url || top.title || `${top.publisher}-${top.published_at}`)
    }
  }

  for (const row of deduped) {
    const key = row.url || row.title || `${row.publisher}-${row.published_at}`
    if (used.has(key)) continue
    picked.push(row)
    used.add(key)
    if (picked.length >= Math.max(1, Math.min(5, maxItems))) break
  }

  const selected = picked.slice(0, Math.max(1, Math.min(5, maxItems)))
  const freshCount = deduped.filter((item) => hoursFromNow(item.published_at) <= 24).length
  const quality: ProcessedNews['quality'] = freshCount >= 4 ? 'Fresh' : freshCount >= 1 ? 'Partial' : 'Stale'

  return { quality, selected }
}