import { NextResponse } from 'next/server'

type NormalizedQuarter = {
  date: string
  quarter: string
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  surprisePercent: number | null
}

type NormalizedResponse = {
  symbol: string
  nextEarningsDate: string | null
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  surprisePercent: number | null
  quarters: NormalizedQuarter[]
  summary: {
    beatRate: number
    totalQuarters: number
    avgSurprisePercent: number | null
    trend: 'positive' | 'mixed' | 'negative' | 'unknown'
    estimateRevision30dPct: number | null
    earningsMomentum: 'up' | 'down' | 'flat' | 'unknown'
  }
  rateLimited?: boolean
  stale?: boolean
  dataSource?: 'live' | 'cache' | 'stale' | 'alpha-vantage' | 'yahoo' | 'polygon'
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000      // 6h — fresh
const STALE_TTL_MS = 24 * 60 * 60 * 1000     // 24h — stale fallback on 429
const cache = new Map<string, { ts: number; data: NormalizedResponse }>()
const staleCache = new Map<string, { ts: number; data: NormalizedResponse }>()
const IS_DEV = process.env.NODE_ENV !== 'production'

const toNum = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

const toDate = (value: any): string | null => {
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10)
  return null
}

const quarterFromDate = (dateStr: string | null) => {
  if (!dateStr) return 'Q?'
  const month = Number(dateStr.slice(5, 7))
  if (month >= 1 && month <= 3) return 'Q1'
  if (month >= 4 && month <= 6) return 'Q2'
  if (month >= 7 && month <= 9) return 'Q3'
  if (month >= 10 && month <= 12) return 'Q4'
  return 'Q?'
}

type FmpCallResult = {
  name: string
  url: string
  status: number
  ok: boolean
  rateLimited: boolean
  data?: any
  error?: string
}

const logShape = (name: string, data: any) => {
  const sample = Array.isArray(data) ? data[0] : data
  const keys = sample && typeof sample === 'object' ? Object.keys(sample) : []
  const rootKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : []
  console.info(`[earnings] ${name} root keys=${rootKeys.join(',')} sample keys=${keys.join(',')}`)
}

const toArray = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    const candidates = [
      payload.data,
      payload.historical,
      payload.earnings,
      payload.items,
      payload.calendar,
      payload.results,
    ]
    for (const c of candidates) {
      if (Array.isArray(c)) return c
    }
  }
  return []
}

async function fmpFetch(path: string, apiKey: string, name: string): Promise<FmpCallResult> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://financialmodelingprep.com${path}${sep}apikey=${apiKey}`
  console.info(`[earnings] fmp request ${name} -> ${url}`)
  const res = await fetch(url, { next: { revalidate: 0 } })
  const status = res.status
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (IS_DEV) console.error(`[earnings] fmp error ${name} status=${status} body=${text.slice(0, 200)}`)
    return { name, url, status, ok: false, rateLimited: status === 429, error: text.slice(0, 200) }
  }
  let json: any = null
  try {
    json = await res.json()
  } catch (err: any) {
    const message = err?.message || 'invalid json'
    if (IS_DEV) console.error(`[earnings] fmp json parse error ${name}: ${message}`)
    return { name, url, status, ok: false, rateLimited: false, error: message }
  }
  if (IS_DEV) {
    const preview = Array.isArray(json) ? json[0] : json
    console.info(`[earnings] fmp response ${name} status=${status} preview=`, preview)
    logShape(name, json)
  }
  return { name, url, status, ok: true, rateLimited: false, data: json }
}

const calcTrend = (beatRate: number, avgSurprise: number | null, total: number) => {
  if (total === 0) return 'unknown'
  if (avgSurprise != null && avgSurprise > 0 && beatRate >= 0.6) return 'positive'
  if (avgSurprise != null && avgSurprise < 0 && beatRate <= 0.4) return 'negative'
  return 'mixed'
}

const normalizeSymbol = (value: string) => {
  const raw = value.trim().toUpperCase()
  if (!raw) return ''
  if (raw.includes(':')) {
    return raw.split(':').pop() || raw
  }
  return raw
}

const pickNum = (obj: any, keys: string[]): number | null => {
  for (const key of keys) {
    const val = toNum(obj?.[key])
    if (val != null) return val
  }
  return null
}

const pickDate = (obj: any, keys: string[]): string | null => {
  for (const key of keys) {
    const val = toDate(obj?.[key])
    if (val) return val
  }
  return null
}

const toTime = (dateStr: string | null) => {
  if (!dateStr) return null
  const t = Date.parse(dateStr)
  return Number.isFinite(t) ? t : null
}

const calcEstimateRevision30d = (estimates: { date: string; eps: number }[]) => {
  if (estimates.length < 2) return { revisionPct: null, momentum: 'unknown' as const }
  const sorted = [...estimates].sort((a, b) => toTime(a.date)! - toTime(b.date)!)
  const latest = sorted[sorted.length - 1]
  const latestTime = toTime(latest.date)
  if (!latestTime) return { revisionPct: null, momentum: 'unknown' as const }
  const targetTime = latestTime - 30 * 24 * 60 * 60 * 1000
  let prior: { date: string; eps: number } | null = null
  for (let i = sorted.length - 2; i >= 0; i -= 1) {
    const t = toTime(sorted[i].date)
    if (t != null && t <= targetTime) {
      prior = sorted[i]
      break
    }
  }
  const revisionPct =
    prior && prior.eps !== 0 ? ((latest.eps - prior.eps) / Math.abs(prior.eps)) * 100 : null

  const recent = sorted.slice(-3)
  let momentum: 'up' | 'down' | 'flat' | 'unknown' = 'unknown'
  if (recent.length >= 2) {
    const deltas = recent.slice(1).map((r, idx) => r.eps - recent[idx].eps)
    const up = deltas.every((d) => d > 0)
    const down = deltas.every((d) => d < 0)
    momentum = up ? 'up' : down ? 'down' : 'flat'
  }

  return { revisionPct, momentum }
}

// ── Alpha Vantage fallback (used when FMP returns 429) ───────────────────────
async function fetchEarningsAV(symbol: string, avKey: string): Promise<NormalizedResponse | null> {
  try {
    const url = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${symbol}&apikey=${avKey}`
    if (IS_DEV) console.info(`[earnings] AV fallback fetching ${url}`)
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) return null
    const json = await res.json()
    // AV signals rate limit via Note/Information fields
    if (json['Note'] || json['Information']) {
      if (IS_DEV) console.warn('[earnings] AV fallback rate limited')
      return null
    }
    const quarterly: any[] = json.quarterlyEarnings ?? []
    if (!quarterly.length) return null

    const quarters: NormalizedQuarter[] = quarterly.slice(0, 8).map((q: any) => {
      const epsAct = toNum(q.reportedEPS)
      const epsEst = toNum(q.estimatedEPS)
      const surprise = toNum(q.surprisePercentage)  // AV already in %
      return {
        date: q.fiscalDateEnding || '----',
        quarter: quarterFromDate(q.fiscalDateEnding),
        epsEstimate: epsEst,
        epsActual: epsAct,
        revenueEstimate: null,
        revenueActual: null,
        surprisePercent: surprise,
      }
    })

    const beats = quarters
      .map((q) => q.surprisePercent)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const totalQuarters = beats.length
    const beatRate = totalQuarters ? beats.filter((v) => v > 0).length / totalQuarters : 0
    const avgSurprisePercent = totalQuarters ? beats.reduce((a, b) => a + b, 0) / totalQuarters : null
    const lastCompleted = quarters.find((q) => q.epsActual != null) ?? null

    return {
      symbol,
      nextEarningsDate: null,
      epsEstimate: quarters[0]?.epsEstimate ?? null,
      epsActual: lastCompleted?.epsActual ?? null,
      revenueEstimate: null,
      revenueActual: null,
      surprisePercent: lastCompleted?.surprisePercent ?? null,
      quarters,
      summary: {
        beatRate,
        totalQuarters,
        avgSurprisePercent,
        trend: calcTrend(beatRate, avgSurprisePercent, totalQuarters),
        estimateRevision30dPct: null,
        earningsMomentum: 'unknown',
      },
      rateLimited: false,
      stale: false,
      dataSource: 'alpha-vantage',
    }
  } catch (_e) {
    if (IS_DEV) console.warn('[earnings] AV fallback error', _e)
    return null
  }
}

// ── Yahoo Finance crumb helper ────────────────────────────────────────────────
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const r = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
    })
    const cookie = r.headers.get('set-cookie') ?? ''
    if (!r.ok) return null
    const crumb = await r.text()
    if (!crumb || crumb.includes('<')) return null
    return { crumb: crumb.trim(), cookie }
  } catch (_e) {
    return null
  }
}

// ── Yahoo Finance fallback (crumb-based, no key required) ────────────────────
async function fetchEarningsYahoo(symbol: string): Promise<NormalizedResponse | null> {
  try {
    if (IS_DEV) console.info(`[earnings] Yahoo fallback fetching for ${symbol}`)
    const crumbData = await getYahooCrumb()
    const crumb = crumbData?.crumb ?? ''
    const cookie = crumbData?.cookie ?? ''
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=earningsHistory,earningsTrend${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ''}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      if (IS_DEV) console.warn(`[earnings] Yahoo fallback status=${res.status}`)
      return null
    }
    const json = await res.json()
    const result = json?.quoteSummary?.result?.[0]
    if (!result) return null

    const history: any[] = result.earningsHistory?.history ?? []
    const trend: any[] = result.earningsTrend?.trend ?? []

    const quarters: NormalizedQuarter[] = history.slice(0, 8).map((h: any) => {
      const epsAct = toNum(h.epsActual?.raw)
      const epsEst = toNum(h.epsEstimate?.raw)
      // Yahoo surprisePercent is decimal (0.02 = 2%) — convert to %
      const surpriseRaw = toNum(h.surprisePercent?.raw)
      const surprise = surpriseRaw != null ? surpriseRaw * 100 : null
      const ts = h.quarter?.raw
      const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '----'
      return {
        date,
        quarter: quarterFromDate(date),
        epsEstimate: epsEst,
        epsActual: epsAct,
        revenueEstimate: null,
        revenueActual: null,
        surprisePercent: surprise,
      }
    }).sort((a, b) => (a.date > b.date ? -1 : 1))

    // Next earnings estimate from trend[0] (shortest period = current quarter)
    const nextTrend = trend.find((t: any) => t.period === '0q') ?? trend[0]
    const nextEarningsDate = nextTrend?.endDate ?? null
    const nextEpsEstimate = toNum(nextTrend?.earningsEstimate?.avg?.raw)

    const beats = quarters
      .map((q) => q.surprisePercent)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const totalQuarters = beats.length
    const beatRate = totalQuarters ? beats.filter((v) => v > 0).length / totalQuarters : 0
    const avgSurprisePercent = totalQuarters ? beats.reduce((a, b) => a + b, 0) / totalQuarters : null
    const lastCompleted = quarters.find((q) => q.epsActual != null) ?? null

    return {
      symbol,
      nextEarningsDate,
      epsEstimate: nextEpsEstimate ?? quarters[0]?.epsEstimate ?? null,
      epsActual: lastCompleted?.epsActual ?? null,
      revenueEstimate: null,
      revenueActual: null,
      surprisePercent: lastCompleted?.surprisePercent ?? null,
      quarters,
      summary: {
        beatRate,
        totalQuarters,
        avgSurprisePercent,
        trend: calcTrend(beatRate, avgSurprisePercent, totalQuarters),
        estimateRevision30dPct: null,
        earningsMomentum: 'unknown',
      },
      rateLimited: false,
      stale: false,
      dataSource: 'yahoo',
    }
  } catch (_e) {
    if (IS_DEV) console.warn('[earnings] Yahoo fallback error', _e)
    return null
  }
}

// ── Polygon.io fallback ───────────────────────────────────────────────────────
async function fetchEarningsPolygon(symbol: string, polygonKey: string): Promise<NormalizedResponse | null> {
  try {
    if (IS_DEV) console.info(`[earnings] Polygon fallback for ${symbol}`)
    const url = `https://api.polygon.io/vX/reference/financials?ticker=${symbol}&timeframe=quarterly&limit=8&apiKey=${polygonKey}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      if (IS_DEV) console.warn(`[earnings] Polygon financials ${res.status}`)
      return null
    }
    const json = await res.json()
    const results: any[] = json?.results ?? []
    if (!results.length) return null

    const quarters: NormalizedQuarter[] = results.map((r: any) => {
      const inc = r.financials?.income_statement || {}
      const epsAct = toNum(inc.diluted_earnings_per_share?.value) ?? toNum(inc.basic_earnings_per_share?.value)
      const revAct = toNum(inc.revenues?.value)
      const date = r.end_date || '----'
      const quarter = r.fiscal_period ?? quarterFromDate(date)
      return {
        date,
        quarter,
        epsEstimate: null,
        epsActual: epsAct,
        revenueEstimate: null,
        revenueActual: revAct,
        surprisePercent: null,
      }
    }).sort((a, b) => (a.date > b.date ? -1 : 1))

    const totalQuarters = quarters.filter(q => q.epsActual != null).length
    const lastCompleted = quarters.find((q) => q.epsActual != null) ?? null
    if (IS_DEV) console.info(`[earnings] Polygon success — ${totalQuarters} quarters`)
    return {
      symbol,
      nextEarningsDate: null,
      epsEstimate: null,
      epsActual: lastCompleted?.epsActual ?? null,
      revenueEstimate: null,
      revenueActual: lastCompleted?.revenueActual ?? null,
      surprisePercent: null,
      quarters,
      summary: {
        beatRate: 0,
        totalQuarters,
        avgSurprisePercent: null,
        trend: 'unknown',
        estimateRevision30dPct: null,
        earningsMomentum: 'unknown',
      },
      rateLimited: false,
      stale: false,
      dataSource: 'polygon',
    }
  } catch (_e) {
    if (IS_DEV) console.warn('[earnings] Polygon fallback error', _e)
    return null
  }
}

export async function GET(request: Request, { params }: { params: { symbol: string } }) {
  try {
    const symbolRaw = normalizeSymbol(params.symbol || '')
    console.info(`[earnings] incoming symbol=${params.symbol} normalized=${symbolRaw}`)
    if (!symbolRaw) {
      return NextResponse.json({ error: 'missing symbol' }, { status: 400 })
    }

    const cached = cache.get(symbolRaw)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      if (IS_DEV) console.info(`[earnings] cache hit for ${symbolRaw} (age ${Math.round((Date.now() - cached.ts) / 60000)}m)`)
      return NextResponse.json({ ...cached.data, dataSource: 'cache' as const }, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=21600' },
      })
    }
    if (IS_DEV) console.info(`[earnings] cache miss for ${symbolRaw} — fetching FMP`)

    const apiKey = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'missing FMP_API_KEY' }, { status: 500 })
    }

    const [earningsRes, calendarRes, estimatesRes] = await Promise.all([
      fmpFetch(`/stable/earnings?symbol=${symbolRaw}`, apiKey, 'stable/earnings'),
      fmpFetch(`/stable/earnings-calendar?symbol=${symbolRaw}`, apiKey, 'stable/earnings-calendar'),
      fmpFetch(`/stable/analyst-estimates?symbol=${symbolRaw}&period=quarter`, apiKey, 'stable/analyst-estimates'),
    ])

    const rateLimitedCalls = [earningsRes, calendarRes].filter((r) => r.rateLimited)
    const otherFailures = [earningsRes, calendarRes].filter((r) => !r.ok && !r.rateLimited)

    if (rateLimitedCalls.length > 0) {
      if (IS_DEV) console.warn(`[earnings] FMP rate limit (429) for ${symbolRaw} — trying Alpha Vantage`)
      const avKey = process.env.ALPHA_VANTAGE_KEY || ''
      if (avKey) {
        const avData = await fetchEarningsAV(symbolRaw, avKey)
        if (avData) {
          if (IS_DEV) console.info(`[earnings] AV fallback success for ${symbolRaw}`)
          cache.set(symbolRaw, { ts: Date.now(), data: avData })
          staleCache.set(symbolRaw, { ts: Date.now(), data: avData })
          return NextResponse.json(avData)
        }
      }
      // AV also failed — try Yahoo Finance (no key required)
      if (IS_DEV) console.info(`[earnings] trying Yahoo Finance fallback for ${symbolRaw}`)
      const yahooData = await fetchEarningsYahoo(symbolRaw)
      if (yahooData) {
        if (IS_DEV) console.info(`[earnings] Yahoo fallback success for ${symbolRaw}`)
        cache.set(symbolRaw, { ts: Date.now(), data: yahooData })
        staleCache.set(symbolRaw, { ts: Date.now(), data: yahooData })
        return NextResponse.json(yahooData)
      }
      // Yahoo also failed — try Polygon.io
      const polygonKey = process.env.POLYGON_KEY || ''
      if (polygonKey) {
        if (IS_DEV) console.info(`[earnings] trying Polygon fallback for ${symbolRaw}`)
        const polygonData = await fetchEarningsPolygon(symbolRaw, polygonKey)
        if (polygonData) {
          if (IS_DEV) console.info(`[earnings] Polygon fallback success for ${symbolRaw}`)
          cache.set(symbolRaw, { ts: Date.now(), data: polygonData })
          staleCache.set(symbolRaw, { ts: Date.now(), data: polygonData })
          return NextResponse.json(polygonData)
        }
      }
      const stale = staleCache.get(symbolRaw)
      if (stale && Date.now() - stale.ts < STALE_TTL_MS) {
        if (IS_DEV) console.info(`[earnings] rate limit fallback: stale cache hit for ${symbolRaw}`)
        return NextResponse.json({ ...stale.data, stale: true, rateLimited: false, dataSource: 'stale' as const })
      }
      if (IS_DEV) console.warn(`[earnings] rate limit — no fallback available for ${symbolRaw}`)
      return NextResponse.json(
        { error: 'FMP rate limit reached', rateLimited: true, stale: false, message: 'Rate limit reached — try again in a few minutes' },
        { status: 429 }
      )
    }
    if (otherFailures.length) {
      const errorPayload = {
        error: 'FMP request failed',
        failures: otherFailures.map((f) => ({ name: f.name, url: f.url, status: f.status, error: f.error })),
      }
      if (IS_DEV) return NextResponse.json(errorPayload, { status: 502 })
      throw new Error(`FMP request failed: ${otherFailures.map((f) => f.name).join(', ')}`)
    }

    const earnings = earningsRes.data ?? []
    const calendar = calendarRes.data ?? []
    if (!estimatesRes.ok) {
      console.warn(`[earnings] optional analyst-estimates failed status=${estimatesRes.status} error=${estimatesRes.error}`)
    }
    const estimates = estimatesRes.ok ? estimatesRes.data ?? [] : []

    const earningsArr = toArray(earnings)
    if (earningsArr.length === 0) {
      console.warn('[earnings] empty data from stable/earnings')
      if (IS_DEV) {
        return NextResponse.json(
          {
            error: 'Normalization failed',
            endpoint: 'stable/earnings',
            rawSample: Array.isArray(earnings) ? earnings[0] ?? null : earnings,
          },
          { status: 500 }
        )
      }
    }
    const last = earningsArr[0] || {}
    const epsActual = pickNum(last, ['epsActual', 'actualEps', 'actualEPS', 'eps', 'reportedEPS', 'reportedEps', 'epsReported', 'eps_actual', 'actual_eps'])
    let epsEstimate = pickNum(last, ['epsEstimated', 'epsEstimate', 'estimatedEPS', 'consensusEPS', 'epsConsensus', 'eps_estimate', 'estimated_eps', 'eps_estimated'])
    const revenueActual = pickNum(last, ['revenueActual', 'actualRevenue', 'revenue', 'revenueReported', 'reportedRevenue', 'totalRevenue', 'sales', 'revenue_actual', 'actual_revenue'])
    let revenueEstimate = pickNum(last, ['revenueEstimated', 'revenueEstimate', 'estimatedRevenue', 'revenueConsensus', 'salesEstimated', 'revenue_estimate', 'estimated_revenue'])
    // surprisePercent: 가장 최근 실제값이 있는 완료 분기 기준
    const lastCompletedRaw = earningsArr.find((s: any) =>
      pickNum(s, ['epsActual', 'actualEps', 'actualEPS', 'eps', 'reportedEPS', 'reportedEps', 'epsReported', 'eps_actual', 'actual_eps']) != null
    ) || null
    let surprisePercent: number | null = null
    if (lastCompletedRaw) {
      surprisePercent = pickNum(lastCompletedRaw, ['surprisePercent', 'epsSurprisePercent', 'surprise_percent'])
      if (surprisePercent == null) {
        const cAct = pickNum(lastCompletedRaw, ['epsActual', 'actualEps', 'actualEPS', 'eps', 'reportedEPS', 'reportedEps', 'epsReported', 'eps_actual', 'actual_eps'])
        const cEst = pickNum(lastCompletedRaw, ['epsEstimated', 'epsEstimate', 'estimatedEPS', 'consensusEPS', 'epsConsensus', 'eps_estimate', 'estimated_eps', 'eps_estimated'])
        if (cAct != null && cEst != null && cEst !== 0) {
          surprisePercent = ((cAct - cEst) / Math.abs(cEst)) * 100
        }
      }
    }

    const estimatesArr = toArray(estimates)
    if (epsEstimate == null && estimatesArr.length) {
      epsEstimate = pickNum(estimatesArr[0], ['estimatedEpsAvg', 'estimatedEps', 'epsEstimated', 'epsEstimate'])
    }
    if (revenueEstimate == null && estimatesArr.length) {
      revenueEstimate = pickNum(estimatesArr[0], ['estimatedRevenueAvg', 'estimatedRevenue', 'revenueEstimated', 'revenueEstimate'])
    }

    const estimateSeries = estimatesArr
      .map((e: any) => ({
        date: pickDate(e, ['date', 'reportedDate', 'fiscalDate', 'reported_date', 'fiscal_date']) || '',
        eps: pickNum(e, ['estimatedEpsAvg', 'estimatedEps', 'epsEstimated', 'epsEstimate']),
      }))
      .filter((e: { date: string; eps: number | null }) => e.date && e.eps != null)
      .map((e: { date: string; eps: number | null }) => ({ date: e.date, eps: e.eps as number }))

    const quarters: NormalizedQuarter[] = earningsArr
      .map((s: any) => {
        const date = pickDate(s, ['date', 'fiscalDateEnding', 'reportDate', 'periodEndDate', 'fiscal_date_ending', 'report_date']) || '----'
        const epsAct = pickNum(s, ['epsActual', 'actualEps', 'actualEPS', 'eps', 'reportedEPS', 'reportedEps', 'epsReported', 'eps_actual', 'actual_eps'])
        const epsEst = pickNum(s, ['epsEstimated', 'epsEstimate', 'estimatedEPS', 'consensusEPS', 'epsConsensus', 'eps_estimate', 'estimated_eps', 'eps_estimated'])
        const revAct = pickNum(s, ['revenueActual', 'actualRevenue', 'revenue', 'revenueReported', 'reportedRevenue', 'totalRevenue', 'sales', 'revenue_actual', 'actual_revenue'])
        const revEst = pickNum(s, ['revenueEstimated', 'revenueEstimate', 'estimatedRevenue', 'revenueConsensus', 'salesEstimated', 'revenue_estimate', 'estimated_revenue'])
        let surprise = pickNum(s, ['surprisePercent', 'epsSurprisePercent', 'surprise_percent'])
        if (surprise == null && epsAct != null && epsEst != null && epsEst !== 0) {
          surprise = ((epsAct - epsEst) / Math.abs(epsEst)) * 100
        }
        return {
          date,
          quarter: s.quarter || s.period || quarterFromDate(date),
          epsEstimate: epsEst,
          epsActual: epsAct,
          revenueEstimate: revEst,
          revenueActual: revAct,
          surprisePercent: surprise,
        }
      })
      .sort((a, b) => (a.date > b.date ? -1 : 1))
      .slice(0, 8)

    const estimateSeriesFallback = estimateSeries.length
      ? estimateSeries
      : quarters
          .filter((q) => q.epsEstimate != null && q.date && q.date !== '----')
          .map((q) => ({ date: q.date, eps: q.epsEstimate as number }))

    const { revisionPct, momentum } = calcEstimateRevision30d(estimateSeriesFallback)

    const lastWithActual = quarters.find((q) => q.epsActual != null || q.revenueActual != null) || null
    const lastWithEstimate = quarters.find((q) => q.epsEstimate != null || q.revenueEstimate != null) || null
    const epsActualFinal = epsActual ?? lastWithActual?.epsActual ?? null
    const revenueActualFinal = revenueActual ?? lastWithActual?.revenueActual ?? null
    const epsEstimateFinal = epsEstimate ?? lastWithEstimate?.epsEstimate ?? null
    const revenueEstimateFinal = revenueEstimate ?? lastWithEstimate?.revenueEstimate ?? null

  const beats = quarters
    .map((q) => q.surprisePercent)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const totalQuarters = beats.length
  const beatRate = totalQuarters ? beats.filter((v) => v > 0).length / totalQuarters : 0
  const avgSurprisePercent = totalQuarters
    ? beats.reduce((a, b) => a + b, 0) / totalQuarters
    : null

  const trend = calcTrend(beatRate, avgSurprisePercent, totalQuarters)

    const calendarArr = toArray(calendar)
    const nextEarningsDate = calendarArr.length
      ? pickDate(calendarArr[0], ['date', 'fiscalDate', 'reportDate', 'fiscal_date', 'report_date']) ?? null
      : null
    if (calendarArr.length === 0) {
      console.warn('[earnings] empty data from stable/earnings-calendar')
      if (IS_DEV) {
        return NextResponse.json(
          {
            error: 'Normalization failed',
            endpoint: 'stable/earnings-calendar',
            rawSample: Array.isArray(calendar) ? calendar[0] ?? null : calendar,
          },
          { status: 500 }
        )
      }
    }

    const lastAllNull = [epsEstimateFinal, epsActualFinal, revenueEstimateFinal, revenueActualFinal, surprisePercent].every((v) => v == null)
    if (lastAllNull && IS_DEV) {
      return NextResponse.json(
        {
          error: 'Normalization failed',
          endpoint: 'stable/earnings',
          rawSample: last,
        },
        { status: 500 }
      )
    }

    const data: NormalizedResponse = {
      symbol: symbolRaw,
      nextEarningsDate,
      epsEstimate: epsEstimateFinal,
      epsActual: epsActualFinal,
      revenueEstimate: revenueEstimateFinal,
      revenueActual: revenueActualFinal,
      surprisePercent,
      quarters,
      summary: {
        beatRate,
        totalQuarters,
        avgSurprisePercent,
        trend,
        estimateRevision30dPct: revisionPct,
        earningsMomentum: momentum,
      },
    }

    const liveData: NormalizedResponse = { ...data, rateLimited: false, stale: false, dataSource: 'live' }
    cache.set(symbolRaw, { ts: Date.now(), data: liveData })
    staleCache.set(symbolRaw, { ts: Date.now(), data: liveData })
    if (IS_DEV) console.info(`[earnings] live data fetched + cached for ${symbolRaw}`)
    return NextResponse.json(liveData, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=21600' },
    })
  } catch (e) {
    return Response.json(
      { error: 'FMP fetch failed', details: String(e) },
      { status: 500 }
    )
  }
}
