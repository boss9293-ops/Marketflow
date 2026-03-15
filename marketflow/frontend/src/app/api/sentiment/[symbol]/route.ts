import { NextResponse } from 'next/server'

type NewsItem = {
  title: string
  titleKo: string | null
  publishedDate: string
  url: string
  sentiment: 'positive' | 'negative' | 'neutral'
  score: number
}

type SentimentResponse = {
  symbol: string
  newsSentiment: 'Bullish' | 'Bearish' | 'Neutral' | null
  newsScore: number | null
  socialSentiment: string | null
  searchTrend: string | null
  keyTopics: string[]
  recentNews: NewsItem[]
  aiSummary: string | null
  aiSummaryKo: string | null
  fetchedAt: string
  dataSource?: string
}

const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { ts: number; data: SentimentResponse }>()
const IS_DEV = process.env.NODE_ENV !== 'production'

const normalizeSymbol = (v: string) => {
  const raw = v.trim().toUpperCase()
  if (!raw) return ''
  return raw.includes(':') ? raw.split(':').pop() || raw : raw
}

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Keyword-based sentiment scoring
const POS_WORDS = ['beat', 'surge', 'rally', 'gain', 'record', 'profit', 'growth', 'strong',
  'upgrade', 'buy', 'outperform', 'above', 'exceed', 'positive', 'rise', 'jump', 'soar',
  'bullish', 'upbeat', 'optimistic', 'revenue', 'expand', 'breakthrough', 'launch', 'high',
  'rebound', 'recovery', 'advance', 'top', 'leads', 'win', 'success']
const NEG_WORDS = ['miss', 'drop', 'fall', 'decline', 'loss', 'weak', 'sell', 'downgrade',
  'below', 'concern', 'risk', 'fear', 'bearish', 'crash', 'cut', 'layoff', 'warn',
  'disappoint', 'slump', 'plunge', 'tumble', 'investigation', 'recall', 'lawsuit', 'low',
  'down', 'tariff', 'tariffs', 'trade war', 'recession', 'inflation']

const scoreText = (text: string): number => {
  const lower = text.toLowerCase()
  let score = 0
  for (const w of POS_WORDS) if (lower.includes(w)) score += 1
  for (const w of NEG_WORDS) if (lower.includes(w)) score -= 1
  return Math.max(-3, Math.min(3, score))
}

const extractTopics = (titles: string[], symbol: string): string[] => {
  const stopwords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'is', 'are', 'for', 'to',
    'of', 'and', 'or', 'with', 'as', 'it', 'its', 'by', 'from', 'was', 'has', 'have',
    'will', 'can', 'new', 'says', 'said', 'after', 'how', 'what', 'why', 'when', 'where',
    symbol.toLowerCase()])
  const freq: Record<string, number> = {}
  for (const t of titles) {
    const words = t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
    for (const w of words) {
      if (w.length < 4 || stopwords.has(w)) continue
      freq[w] = (freq[w] || 0) + 1
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1))
}

// Google Translate unofficial API (free, no key, cached server-side)
async function translateKo(text: string): Promise<string | null> {
  if (!text) return null
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': CHROME_UA },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json()
    const translated = (json?.[0] as any[])?.map((t: any) => t?.[0]).filter(Boolean).join('') || null
    return translated
  } catch {
    return null
  }
}

// Source 1: Yahoo Finance stock-specific news (no API key needed)
type RawArticle = { title: string; publishedDate: string; url: string }

async function fetchNewsYahoo(symbol: string): Promise<RawArticle[]> {
  try {
    // Get crumb
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': CHROME_UA, Accept: '*/*' },
      cache: 'no-store',
    })
    const cookie = crumbRes.headers.get('set-cookie') ?? ''
    const crumbText = crumbRes.ok ? await crumbRes.text() : ''
    const crumb = crumbText.trim()
    const crumbParam = (crumb && !crumb.includes('<')) ? `&crumb=${encodeURIComponent(crumb)}` : ''

    // Primary: symbols-specific news (more relevant than general search)
    const symbolsUrl = `https://query2.finance.yahoo.com/v2/finance/news?symbols=${symbol}&count=20${crumbParam}`
    const res1 = await fetch(symbolsUrl, {
      headers: { 'User-Agent': CHROME_UA, Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      cache: 'no-store',
    })
    if (res1.ok) {
      const json = await res1.json()
      const items: any[] = json?.items?.result ?? json?.news ?? []
      if (items.length > 0) {
        if (IS_DEV) console.info(`[sentiment] Yahoo symbols news count=${items.length}`)
        return items.map((a: any) => ({
          title: a.title || a.headline || '',
          publishedDate: a.pubTime
            ? new Date(a.pubTime * 1000).toISOString().slice(0, 10)
            : (a.providerPublishTime
              ? new Date(a.providerPublishTime * 1000).toISOString().slice(0, 10)
              : (a.published_at || '').slice(0, 10)),
          url: a.link || a.url || a.clickThroughUrl?.url || '',
        })).filter(a => a.title)
      }
    }

    // Fallback: general search
    const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol + ' stock')}&newsCount=20&quotesCount=0${crumbParam}`
    const res2 = await fetch(searchUrl, {
      headers: { 'User-Agent': CHROME_UA, Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      cache: 'no-store',
    })
    if (!res2.ok) {
      if (IS_DEV) console.warn(`[sentiment] Yahoo search fallback status=${res2.status}`)
      return []
    }
    const json2 = await res2.json()
    const items2: any[] = json2?.news ?? []
    if (IS_DEV) console.info(`[sentiment] Yahoo search news count=${items2.length}`)
    return items2.map((a: any) => ({
      title: a.title || '',
      publishedDate: a.providerPublishTime
        ? new Date(a.providerPublishTime * 1000).toISOString().slice(0, 10) : '',
      url: a.link || '',
    })).filter(a => a.title)
  } catch (e) {
    if (IS_DEV) console.warn('[sentiment] Yahoo news error', e)
    return []
  }
}

// Source 2: Alpha Vantage NEWS_SENTIMENT (uses existing AV key)
async function fetchNewsAV(symbol: string, avKey: string): Promise<RawArticle[]> {
  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=20&apikey=${avKey}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []
    const json = await res.json()
    if (json?.Note || json?.Information) {
      if (IS_DEV) console.warn('[sentiment] AV rate limited')
      return []
    }
    const feed: any[] = json?.feed ?? []
    if (IS_DEV) console.info(`[sentiment] AV news count=${feed.length}`)
    return feed.map((a: any) => ({
      title: a.title || '',
      publishedDate: a.time_published
        ? `${a.time_published.slice(0, 4)}-${a.time_published.slice(4, 6)}-${a.time_published.slice(6, 8)}`
        : '',
      url: a.url || '',
    })).filter(a => a.title)
  } catch (e) {
    if (IS_DEV) console.warn('[sentiment] AV news error', e)
    return []
  }
}

const emptyResponse = (symbolRaw: string): SentimentResponse => ({
  symbol: symbolRaw,
  newsSentiment: null,
  newsScore: null,
  socialSentiment: null,
  searchTrend: null,
  keyTopics: [],
  recentNews: [],
  aiSummary: null,
  aiSummaryKo: null,
  fetchedAt: new Date().toISOString(),
})

export async function GET(request: Request, { params }: { params: { symbol: string } }) {
  try {
    const symbolRaw = normalizeSymbol(params.symbol || '')
    if (!symbolRaw) return NextResponse.json({ error: 'missing symbol' }, { status: 400 })

    const cached = cache.get(symbolRaw)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data)
    }

    if (IS_DEV) console.info(`[sentiment] fetching news for ${symbolRaw}`)

    // Source 1: Yahoo Finance
    let rawArticles: RawArticle[] = await fetchNewsYahoo(symbolRaw)
    let dataSource = 'yahoo'

    // Source 2: Alpha Vantage fallback
    if (rawArticles.length === 0) {
      const avKey = process.env.ALPHA_VANTAGE_KEY || ''
      if (avKey) {
        rawArticles = await fetchNewsAV(symbolRaw, avKey)
        dataSource = 'alpha-vantage'
      }
    }

    if (rawArticles.length === 0) {
      if (IS_DEV) console.warn(`[sentiment] no news found for ${symbolRaw}`)
      const empty = emptyResponse(symbolRaw)
      cache.set(symbolRaw, { ts: Date.now(), data: empty })
      return NextResponse.json(empty)
    }

    // Score all articles
    const scored = rawArticles.slice(0, 15).map((a) => {
      const s = scoreText(a.title)
      return { ...a, score: s, sentiment: s > 0 ? 'positive' as const : s < 0 ? 'negative' as const : 'neutral' as const }
    })

    const avgScore = scored.reduce((s, n) => s + n.score, 0) / scored.length
    const newsSentiment: SentimentResponse['newsSentiment'] =
      avgScore > 0.3 ? 'Bullish' : avgScore < -0.3 ? 'Bearish' : 'Neutral'
    const topics = extractTopics(scored.map(n => n.title), symbolRaw)

    // Translate top 5 headlines to Korean (cached for 1h, only paid once)
    const top5 = scored.slice(0, 5)
    const translatedTitles = await Promise.all(top5.map(a => translateKo(a.title)))
    if (IS_DEV) console.info(`[sentiment] translated ${translatedTitles.filter(Boolean).length}/5 titles`)

    const news: NewsItem[] = top5.map((a, i) => ({
      title: a.title,
      titleKo: translatedTitles[i] ?? null,
      publishedDate: a.publishedDate,
      url: a.url,
      sentiment: a.sentiment,
      score: a.score,
    }))

    const posCount = scored.filter(n => n.sentiment === 'positive').length
    const negCount = scored.filter(n => n.sentiment === 'negative').length
    const sentimentLabel = newsSentiment === 'Bullish' ? '긍정적 (Bullish)' : newsSentiment === 'Bearish' ? '부정적 (Bearish)' : '중립 (Neutral)'
    const aiSummary = `${symbolRaw}: ${posCount} positive / ${negCount} negative out of ${scored.length} articles. Overall tone: ${newsSentiment}. (Source: ${dataSource})`
    const aiSummaryKo = `${symbolRaw} 최근 ${scored.length}개 기사 중 긍정 ${posCount}건 / 부정 ${negCount}건. 전반적 시장 심리: ${sentimentLabel}.`

    const data: SentimentResponse = {
      symbol: symbolRaw,
      newsSentiment,
      newsScore: Math.round(avgScore * 100) / 100,
      socialSentiment: null,
      searchTrend: null,
      keyTopics: topics,
      recentNews: news,
      aiSummary,
      aiSummaryKo,
      fetchedAt: new Date().toISOString(),
      dataSource,
    }

    cache.set(symbolRaw, { ts: Date.now(), data })
    if (IS_DEV) console.info(`[sentiment] done source=${dataSource} articles=${scored.length} sentiment=${newsSentiment}`)
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' },
    })
  } catch (e) {
    return NextResponse.json({ error: 'sentiment fetch failed', details: String(e) }, { status: 500 })
  }
}
