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

const PUB_WEIGHT: Record<string, number> = {
  reuters: 2.0,
  wsj: 2.0,
  bloomberg: 2.0,
  'financial times': 2.0,
  cnbc: 1.5,
  marketwatch: 1.5,
  barron: 1.5,
}

const CLUSTER_RULES: Array<{ cluster: NewsCluster; words: string[] }> = [
  { cluster: 'rates', words: ['fed', 'powell', 'rate', 'yield', 'treasury', 'cpi', 'inflation', 'ppi'] },
  { cluster: 'liquidity', words: ['liquidity', 'qt', 'qe', 'balance sheet', 'rrp', 'repo', 'credit'] },
  { cluster: 'volatility', words: ['vix', 'volatility', 'hedge', 'risk'] },
  { cluster: 'cross_asset', words: ['bitcoin', 'btc', 'gold', 'real yield', 'tips', 'm2'] },
]

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((v) => v.length >= 2)
}

function cosine(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (!ta.length || !tb.length) return 0
  const fa = new Map<string, number>()
  const fb = new Map<string, number>()
  for (const w of ta) fa.set(w, (fa.get(w) || 0) + 1)
  for (const w of tb) fb.set(w, (fb.get(w) || 0) + 1)
  let dot = 0
  let aa = 0
  let bb = 0
  const keys = new Set([...Array.from(fa.keys()), ...Array.from(fb.keys())])
  for (const k of Array.from(keys)) {
    const va = fa.get(k) || 0
    const vb = fb.get(k) || 0
    dot += va * vb
    aa += va * va
    bb += vb * vb
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1)
}

function hoursFromNow(ts?: string | null): number {
  if (!ts) return 999
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 999
  return Math.max(0, (Date.now() - d.getTime()) / 36e5)
}

function recencyScore(hours: number): number {
  if (hours <= 6) return 3
  if (hours <= 24) return 2
  if (hours <= 48) return 1
  return 0
}

function publisherScore(pub?: string | null): number {
  const p = String(pub || '').toLowerCase()
  let best = 1.0
  for (const [k, v] of Object.entries(PUB_WEIGHT)) {
    if (p.includes(k)) best = Math.max(best, v)
  }
  return best
}

function keywordHits(text: string): number {
  const s = text.toLowerCase()
  let hits = 0
  for (const rule of CLUSTER_RULES) {
    for (const w of rule.words) {
      if (s.includes(w)) hits += 1
    }
  }
  return hits
}

function classifyCluster(text: string): NewsCluster {
  const s = text.toLowerCase()
  let best: NewsCluster = 'general'
  let maxHits = 0
  for (const rule of CLUSTER_RULES) {
    const hits = rule.words.reduce((acc, w) => acc + (s.includes(w) ? 1 : 0), 0)
    if (hits > maxHits) {
      maxHits = hits
      best = rule.cluster
    }
  }
  return best
}

function sharedKeywordCount(a: string, b: string): number {
  const sa = new Set(tokenize(a))
  const sb = new Set(tokenize(b))
  let n = 0
  for (const w of Array.from(sa)) if (sb.has(w)) n += 1
  return n
}

export function postProcessNews(input: NewsArticle[], maxItems = 6): ProcessedNews {
  const items = (input || []).map((a) => {
    const text = `${a.title || ''} ${a.summary || ''}`
    const hours = hoursFromNow(a.published_at)
    const score = keywordHits(text) * 2 + recencyScore(hours) + publisherScore(a.publisher)
    const cluster = classifyCluster(text)
    return { ...a, score, cluster }
  })

  items.sort((a, b) => b.score - a.score)

  // dedup: similarity >0.85 OR shared keywords >=6 within 12h
  const deduped: Array<NewsArticle & { score: number; cluster: NewsCluster }> = []
  for (const cur of items) {
    const cText = `${cur.title || ''} ${cur.summary || ''}`
    const cHour = hoursFromNow(cur.published_at)
    const dupIdx = deduped.findIndex((ex) => {
      const eText = `${ex.title || ''} ${ex.summary || ''}`
      const eHour = hoursFromNow(ex.published_at)
      const sim = cosine(cText, eText)
      const shared = sharedKeywordCount(cText, eText)
      return sim > 0.85 || (shared >= 6 && Math.abs(cHour - eHour) <= 12)
    })
    if (dupIdx < 0) {
      deduped.push(cur)
      continue
    }
    const ex = deduped[dupIdx]
    if (cur.score > ex.score || (cur.score === ex.score && cHour < hoursFromNow(ex.published_at))) {
      deduped[dupIdx] = cur
    }
  }

  // cluster pick: one per major cluster, then fill by score
  const picked: Array<NewsArticle & { score: number; cluster: NewsCluster }> = []
  const used = new Set<string>()
  for (const c of ['rates', 'liquidity', 'volatility', 'cross_asset'] as NewsCluster[]) {
    const top = deduped.find((x) => x.cluster === c)
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
    if (picked.length >= Math.max(1, Math.min(6, maxItems))) break
  }
  const selected = picked.slice(0, Math.max(1, Math.min(6, maxItems)))
  const freshCount = deduped.filter((x) => hoursFromNow(x.published_at) <= 24).length
  const quality: ProcessedNews['quality'] = freshCount >= 4 ? 'Fresh' : freshCount >= 1 ? 'Partial' : 'Stale'

  return { quality, selected }
}

