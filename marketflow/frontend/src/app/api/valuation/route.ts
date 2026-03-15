import { NextResponse } from 'next/server'

type ScenarioCase = {
  priceTarget: number | null
  pe: number | null
  epsNext: number | null
  growthPct: number | null
}

type ValuationResponse = {
  symbol: string
  price: number | null
  fairValue: number | null
  upside: number | null
  bearCase: ScenarioCase
  baseCase: ScenarioCase
  bullCase: ScenarioCase
  pe: number | null
  sectorPE: number | null
  pe5y: number | null
  peg: number | null
  evToEbitda: number | null
  epsGrowth3y: number | null
  revenueGrowth3y: number | null
  fcfGrowth3y: number | null
  aiSummary: string | null
  fetchedAt: string
  rateLimited?: boolean
  stale?: boolean
  dataSource?: 'live' | 'cache' | 'stale' | 'alpha-vantage' | 'yahoo' | 'polygon'
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000      // 6h — fresh
const STALE_TTL_MS = 24 * 60 * 60 * 1000     // 24h — stale fallback on 429
const cache = new Map<string, { ts: number; data: ValuationResponse }>()
const staleCache = new Map<string, { ts: number; data: ValuationResponse }>()
const IS_DEV = process.env.NODE_ENV !== 'production'

const toNum = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

const normalizeSymbol = (value: string) => {
  const raw = value.trim().toUpperCase()
  if (!raw) return ''
  if (raw.includes(':')) return raw.split(':').pop() || raw
  return raw
}

const pickNum = (obj: any, keys: string[]): number | null => {
  for (const key of keys) {
    const val = toNum(obj?.[key])
    if (val != null) return val
  }
  return null
}

const avg = (arr: number[]) => {
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

type FmpResult =
  | { ok: true; data: any }
  | { ok: false; rateLimited: boolean; status: number; error: string }

async function fmpFetch(path: string, apiKey: string, name: string): Promise<FmpResult> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://financialmodelingprep.com${path}${sep}apikey=${apiKey}`
  if (IS_DEV) console.info(`[valuation] fmp request ${name}`)
  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (IS_DEV) console.error(`[valuation] ${name} ${res.status} body=${text.slice(0, 160)}`)
      return { ok: false, rateLimited: res.status === 429, status: res.status, error: text.slice(0, 160) }
    }
    const json = await res.json().catch(() => null)
    if (IS_DEV) {
      const preview = Array.isArray(json) ? json[0] : json
      console.info(`[valuation] ${name} ok — preview=`, preview)
    }
    return { ok: true, data: json }
  } catch (e) {
    if (IS_DEV) console.error(`[valuation] ${name} network error`, e)
    return { ok: false, rateLimited: false, status: 0, error: String(e) }
  }
}

const calcGrowth = (arr: number[]) => {
  if (arr.length < 2) return null
  const first = arr[arr.length - 1]
  const last = arr[0]
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null
  return (last - first) / Math.abs(first)
}

// ── Alpha Vantage fallback (used when FMP returns 429) ───────────────────────
async function fetchValuationAV(symbol: string, avKey: string): Promise<ValuationResponse | null> {
  try {
    const base = 'https://www.alphavantage.co/query'
    const [ovRes, qtRes] = await Promise.all([
      fetch(`${base}?function=OVERVIEW&symbol=${symbol}&apikey=${avKey}`, { next: { revalidate: 0 } }),
      fetch(`${base}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${avKey}`, { next: { revalidate: 0 } }),
    ])
    if (!ovRes.ok || !qtRes.ok) return null
    const ov = await ovRes.json()
    const qt = await qtRes.json()
    if (ov['Note'] || ov['Information']) {
      if (IS_DEV) console.warn('[valuation] AV fallback rate limited')
      return null
    }
    const pe = toNum(ov.PERatio) ?? toNum(ov.ForwardPE)
    const peg = toNum(ov.PEGRatio)
    const evToEbitda = toNum(ov.EVToEBITDA)
    const eps = toNum(ov.EPS)
    const price = toNum(qt['Global Quote']?.['05. price']) ?? toNum(ov['50DayMovingAverage'])
    const target = toNum(ov.AnalystTargetPrice)
    const basePe = pe ?? 20
    const bullPe = basePe * 1.2

    const sc = (peVal: number | null, growth: number): ScenarioCase => {
      if (!peVal || eps == null) return { priceTarget: null, pe: peVal, epsNext: eps, growthPct: growth * 100 }
      return { priceTarget: eps * (1 + growth) * peVal, pe: peVal, epsNext: eps, growthPct: growth * 100 }
    }
    const bearCase = sc(20, 0.05)
    const baseCase = sc(basePe, 0.1)
    const bullCase = sc(bullPe, 0.18)
    const fairValue = target ?? baseCase.priceTarget
    const upside = price != null && fairValue != null ? (fairValue - price) / price : null

    return {
      symbol,
      price,
      fairValue,
      upside,
      bearCase,
      baseCase,
      bullCase,
      pe,
      sectorPE: null,
      pe5y: null,
      peg,
      evToEbitda,
      epsGrowth3y: null,
      revenueGrowth3y: null,
      fcfGrowth3y: null,
      aiSummary: target != null && price != null
        ? `${symbol} analyst price target: $${target.toFixed(0)} (${upside != null ? (upside > 0 ? '+' : '') + (upside * 100).toFixed(1) + '% upside' : 'N/A'}). PE: ${pe?.toFixed(1) ?? '--'} | PEG: ${peg?.toFixed(2) ?? '--'} | EV/EBITDA: ${evToEbitda?.toFixed(1) ?? '--'}. Source: Alpha Vantage.`
        : null,
      fetchedAt: new Date().toISOString(),
      rateLimited: false,
      stale: false,
      dataSource: 'alpha-vantage',
    }
  } catch (_e) {
    if (IS_DEV) console.warn('[valuation] AV fallback error', _e)
    return null
  }
}

// ── Yahoo Finance fallback (crumb-based, no key required) ────────────────────
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
    if (!crumb || crumb.includes('<')) return null  // HTML error page
    return { crumb: crumb.trim(), cookie }
  } catch (_e) {
    return null
  }
}

async function fetchValuationYahoo(symbol: string): Promise<ValuationResponse | null> {
  try {
    if (IS_DEV) console.info(`[valuation] Yahoo fallback fetching for ${symbol}`)
    const crumbData = await getYahooCrumb()
    const crumb = crumbData?.crumb ?? ''
    const cookie = crumbData?.cookie ?? ''
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics,summaryDetail,price${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ''}`
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
      if (IS_DEV) console.warn(`[valuation] Yahoo fallback status=${res.status}`)
      return null
    }
    const json = await res.json()
    const result = json?.quoteSummary?.result?.[0]
    if (!result) return null

    const fd = result.financialData || {}
    const ks = result.defaultKeyStatistics || {}
    const sd = result.summaryDetail || {}
    const pr = result.price || {}

    const price = toNum(fd.currentPrice?.raw) ?? toNum(pr.regularMarketPrice?.raw)
    const pe = toNum(sd.trailingPE?.raw) ?? toNum(sd.forwardPE?.raw)
    const peg = toNum(ks.pegRatio?.raw)
    const evToEbitda = toNum(ks.enterpriseToEbitda?.raw)
    const eps = toNum(ks.trailingEps?.raw)
    const target = toNum(fd.targetMeanPrice?.raw)
    const basePe = pe ?? 20
    const bullPe = basePe * 1.2

    const sc = (peVal: number | null, growth: number): ScenarioCase => {
      if (!peVal || eps == null) return { priceTarget: null, pe: peVal, epsNext: eps, growthPct: growth * 100 }
      return { priceTarget: eps * (1 + growth) * peVal, pe: peVal, epsNext: eps, growthPct: growth * 100 }
    }
    const bearCase = sc(20, 0.05)
    const baseCase = sc(basePe, 0.1)
    const bullCase = sc(bullPe, 0.18)
    const fairValue = target ?? baseCase.priceTarget
    const upside = price != null && fairValue != null ? (fairValue - price) / price : null

    if (IS_DEV) console.info(`[valuation] Yahoo success — price=${price} pe=${pe}`)
    return {
      symbol,
      price,
      fairValue,
      upside,
      bearCase,
      baseCase,
      bullCase,
      pe,
      sectorPE: null,
      pe5y: null,
      peg,
      evToEbitda,
      epsGrowth3y: null,
      revenueGrowth3y: null,
      fcfGrowth3y: null,
      aiSummary: price != null
        ? `${symbol} $${price.toFixed(2)}${target != null ? ` · target $${target.toFixed(0)} (${upside != null ? (upside > 0 ? '+' : '') + (upside * 100).toFixed(1) + '%' : ''})` : ''}. PE ${pe?.toFixed(1) ?? '--'} | PEG ${peg?.toFixed(2) ?? '--'} | EV/EBITDA ${evToEbitda?.toFixed(1) ?? '--'}. Source: Yahoo Finance.`
        : null,
      fetchedAt: new Date().toISOString(),
      rateLimited: false,
      stale: false,
      dataSource: 'yahoo',
    }
  } catch (_e) {
    if (IS_DEV) console.warn('[valuation] Yahoo fallback error', _e)
    return null
  }
}

// ── Polygon.io fallback ───────────────────────────────────────────────────────
async function fetchValuationPolygon(symbol: string, polygonKey: string): Promise<ValuationResponse | null> {
  try {
    if (IS_DEV) console.info(`[valuation] Polygon fallback for ${symbol}`)
    const [snapRes, finRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${polygonKey}`, { cache: 'no-store' }),
      fetch(`https://api.polygon.io/vX/reference/financials?ticker=${symbol}&timeframe=quarterly&limit=1&apiKey=${polygonKey}`, { cache: 'no-store' }),
    ])
    if (!snapRes.ok) {
      if (IS_DEV) console.warn(`[valuation] Polygon snapshot ${snapRes.status}`)
      return null
    }
    const snap = await snapRes.json()
    const price = toNum(snap?.ticker?.day?.c) ?? toNum(snap?.ticker?.lastTrade?.p) ?? toNum(snap?.ticker?.prevDay?.c)
    if (price == null) return null

    let eps: number | null = null
    if (finRes.ok) {
      const fin = await finRes.json()
      const inc = fin?.results?.[0]?.financials?.income_statement
      eps = toNum(inc?.diluted_earnings_per_share?.value) ?? toNum(inc?.basic_earnings_per_share?.value)
    }

    const pe = eps != null && eps !== 0 ? price / eps : null
    const basePe = pe ?? 20
    const bullPe = basePe * 1.2
    const sc = (peVal: number | null, growth: number): ScenarioCase => {
      if (!peVal || eps == null) return { priceTarget: null, pe: peVal, epsNext: eps, growthPct: growth * 100 }
      return { priceTarget: eps * (1 + growth) * peVal, pe: peVal, epsNext: eps, growthPct: growth * 100 }
    }
    const bearCase = sc(20, 0.05)
    const baseCase = sc(basePe, 0.1)
    const bullCase = sc(bullPe, 0.18)
    const fairValue = baseCase.priceTarget
    const upside = fairValue != null ? (fairValue - price) / price : null

    if (IS_DEV) console.info(`[valuation] Polygon success — price=${price} eps=${eps} pe=${pe}`)
    return {
      symbol,
      price,
      fairValue,
      upside,
      bearCase,
      baseCase,
      bullCase,
      pe,
      sectorPE: null,
      pe5y: null,
      peg: null,
      evToEbitda: null,
      epsGrowth3y: null,
      revenueGrowth3y: null,
      fcfGrowth3y: null,
      aiSummary: `${symbol} $${price.toFixed(2)} · PE ${pe?.toFixed(1) ?? '--'} · EPS ${eps?.toFixed(2) ?? '--'}. Source: Polygon.io.`,
      fetchedAt: new Date().toISOString(),
      rateLimited: false,
      stale: false,
      dataSource: 'polygon',
    }
  } catch (_e) {
    if (IS_DEV) console.warn('[valuation] Polygon fallback error', _e)
    return null
  }
}

const buildSummary = (payload: ValuationResponse) => {
  if (payload.price == null || payload.fairValue == null || payload.pe == null) return null
  const upsidePct = payload.upside != null ? `${(payload.upside * 100).toFixed(0)}%` : '--'
  const pe5y = payload.pe5y != null ? payload.pe5y.toFixed(1) : '--'
  const sectorPe = payload.sectorPE != null ? payload.sectorPE.toFixed(1) : '--'
  const epsGrowth = payload.epsGrowth3y != null ? `${(payload.epsGrowth3y * 100).toFixed(0)}%` : '--'
  return [
    `${payload.symbol} currently trades around ${payload.pe.toFixed(1)}x forward earnings.`,
    `Sector PE is ${sectorPe} and the 5-year average is ${pe5y}.`,
    `Based on EPS growth of ~${epsGrowth}, fair value is ${payload.fairValue.toFixed(0)} with ~${upsidePct} upside.`,
  ].join(' ')
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbolRaw = normalizeSymbol(searchParams.get('symbol') || '')
    if (!symbolRaw) {
      return NextResponse.json({ error: 'missing symbol' }, { status: 400 })
    }

    // Fresh cache check
    const cached = cache.get(symbolRaw)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      if (IS_DEV) console.info(`[valuation] cache hit for ${symbolRaw} (age ${Math.round((Date.now() - cached.ts) / 60000)}m)`)
      return NextResponse.json({ ...cached.data, dataSource: 'cache' as const }, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=21600' },
      })
    }
    if (IS_DEV) console.info(`[valuation] cache miss for ${symbolRaw} — fetching FMP`)

    const apiKey = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'missing FMP_API_KEY' }, { status: 500 })
    }

    // Core endpoints (required)
    const [ratiosRes, profileRes, quoteRes] = await Promise.all([
      fmpFetch(`/stable/ratios?symbol=${symbolRaw}`, apiKey, 'stable/ratios'),
      fmpFetch(`/stable/profile?symbol=${symbolRaw}`, apiKey, 'stable/profile'),
      fmpFetch(`/stable/quote?symbol=${symbolRaw}`, apiKey, 'stable/quote'),
    ])

    // 429 check — try Alpha Vantage, then stale cache
    const rateLimitedCores = [ratiosRes, profileRes, quoteRes].filter(r => !r.ok && r.rateLimited)
    if (rateLimitedCores.length > 0) {
      if (IS_DEV) console.warn(`[valuation] FMP rate limit (429) for ${symbolRaw} — trying Alpha Vantage`)
      const avKey = process.env.ALPHA_VANTAGE_KEY || ''
      if (avKey) {
        const avData = await fetchValuationAV(symbolRaw, avKey)
        if (avData) {
          if (IS_DEV) console.info(`[valuation] AV fallback success for ${symbolRaw}`)
          cache.set(symbolRaw, { ts: Date.now(), data: avData })
          staleCache.set(symbolRaw, { ts: Date.now(), data: avData })
          return NextResponse.json(avData)
        }
      }
      // AV also failed — try Yahoo Finance (no key required)
      if (IS_DEV) console.info(`[valuation] trying Yahoo Finance fallback for ${symbolRaw}`)
      const yahooData = await fetchValuationYahoo(symbolRaw)
      if (yahooData) {
        if (IS_DEV) console.info(`[valuation] Yahoo fallback success for ${symbolRaw}`)
        cache.set(symbolRaw, { ts: Date.now(), data: yahooData })
        staleCache.set(symbolRaw, { ts: Date.now(), data: yahooData })
        return NextResponse.json(yahooData)
      }
      // Yahoo also failed — try Polygon.io
      const polygonKey = process.env.POLYGON_KEY || ''
      if (polygonKey) {
        if (IS_DEV) console.info(`[valuation] trying Polygon fallback for ${symbolRaw}`)
        const polygonData = await fetchValuationPolygon(symbolRaw, polygonKey)
        if (polygonData) {
          if (IS_DEV) console.info(`[valuation] Polygon fallback success for ${symbolRaw}`)
          cache.set(symbolRaw, { ts: Date.now(), data: polygonData })
          staleCache.set(symbolRaw, { ts: Date.now(), data: polygonData })
          return NextResponse.json(polygonData)
        }
      }
      const stale = staleCache.get(symbolRaw)
      if (stale && Date.now() - stale.ts < STALE_TTL_MS) {
        if (IS_DEV) console.info(`[valuation] rate limit fallback: stale cache hit for ${symbolRaw}`)
        return NextResponse.json({ ...stale.data, stale: true, rateLimited: false, dataSource: 'stale' as const })
      }
      if (IS_DEV) console.warn(`[valuation] rate limit — no fallback available for ${symbolRaw}`)
      return NextResponse.json(
        { error: 'FMP rate limit reached', rateLimited: true, stale: false, message: 'Rate limit reached — try again in a few minutes' },
        { status: 429 }
      )
    }

    // Other failures — log and continue with what we have (partial data)
    const otherFailures = [ratiosRes, profileRes, quoteRes].filter(r => !r.ok && !r.rateLimited)
    if (otherFailures.length > 0 && IS_DEV) {
      console.warn(`[valuation] non-429 failures: ${otherFailures.map(r => !r.ok ? r.status : '?').join(', ')}`)
    }

    // analyst-estimates — premium only, always optional
    let estimatesArr: any[] = []
    try {
      const estRes = await fmpFetch(`/stable/analyst-estimates?symbol=${symbolRaw}&period=annual`, apiKey, 'stable/analyst-estimates')
      if (estRes.ok) {
        estimatesArr = Array.isArray(estRes.data) ? estRes.data : []
      } else if (estRes.rateLimited) {
        if (IS_DEV) console.warn('[valuation] analyst-estimates 429 — skipping')
      } else {
        if (IS_DEV) console.warn(`[valuation] analyst-estimates unavailable status=${estRes.status}`)
      }
    } catch (_e) {
      if (IS_DEV) console.warn('[valuation] analyst-estimates fetch error, skipping')
    }

    const ratiosArr = ratiosRes.ok ? (Array.isArray(ratiosRes.data) ? ratiosRes.data : []) : []
    const profileArr = profileRes.ok ? (Array.isArray(profileRes.data) ? profileRes.data : []) : []
    const quoteArr = quoteRes.ok ? (Array.isArray(quoteRes.data) ? quoteRes.data : []) : []

    if (IS_DEV) {
      console.info('[valuation] shapes ratios:', ratiosArr.length, Object.keys(ratiosArr[0] || {}))
      console.info('[valuation] shapes profile:', profileArr.length, Object.keys(profileArr[0] || {}))
      console.info('[valuation] shapes estimates:', estimatesArr.length, Object.keys(estimatesArr[0] || {}))
      console.info('[valuation] shapes quote:', quoteArr.length, Object.keys(quoteArr[0] || {}))
    }

    const ratiosLatest = ratiosArr[0] || {}
    const profileLatest = profileArr[0] || {}
    const quoteLatest = quoteArr[0] || {}

    const price = pickNum(quoteLatest, ['price', 'lastPrice', 'last']) ?? pickNum(profileLatest, ['price'])
    const pe = pickNum(ratiosLatest, ['priceToEarningsRatio', 'peRatio', 'peRatioTTM', 'priceEarningsRatio'])
      ?? pickNum(quoteLatest, ['pe'])
    const peg = pickNum(ratiosLatest, ['pegRatio', 'pegRatioTTM', 'priceToEarningsGrowthRatio', 'priceEarningsToGrowthRatio'])
      ?? pickNum(quoteLatest, ['priceEarningsGrowthRatio'])
    const evToEbitda = pickNum(ratiosLatest, ['evToEBITDA', 'evToEBITDATTM', 'enterpriseValueMultiple', 'evToEBITDAMultiple'])

    const pe5y = avg(
      ratiosArr
        .slice(0, 5)
        .map((r: any) => pickNum(r, ['priceToEarningsRatio', 'peRatio', 'peRatioTTM', 'priceEarningsRatio']))
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    )

    const epsSeries = estimatesArr
      .map((e: any) => pickNum(e, ['epsAvg', 'estimatedEpsAvg', 'estimatedEps', 'epsEstimated', 'epsEstimate']))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

    const revenueSeries = estimatesArr
      .map((e: any) => pickNum(e, ['revenueAvg', 'estimatedRevenueAvg', 'estimatedRevenue', 'revenueEstimated', 'revenueEstimate']))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

    const epsNext = epsSeries[0] ?? null
    const eps3y = epsSeries.length >= 3 ? epsSeries[2] : epsSeries[epsSeries.length - 1] ?? null
    const epsGrowth3y = epsSeries.length >= 3 && eps3y != null && epsNext != null && epsNext !== 0
      ? (eps3y - epsNext) / Math.abs(epsNext)
      : null

    const revenueGrowth3y = revenueSeries.length >= 3
      ? calcGrowth(revenueSeries.slice(0, 3))
      : null

    const fcfGrowth3y = null
    const sectorPE = null
    const basePE = sectorPE ?? pe ?? 20

    const bearPe = 20
    const basePe = basePE
    const bullPe = basePE ? basePE * 1.2 : null

    const bearGrowth = 0.05
    const baseGrowth = epsGrowth3y ?? 0.1
    const bullGrowth = epsGrowth3y != null ? clamp(epsGrowth3y * 1.5, 0.08, 0.25) : 0.18

    const epsTTM = pickNum(ratiosLatest, ['netIncomePerShare'])
      ?? pickNum(profileLatest, ['eps', 'epsTTM', 'ttmEps', 'epsActual'])
      ?? pickNum(quoteLatest, ['eps'])
    const epsBase = epsNext ?? epsTTM ?? (pe != null && price != null && pe !== 0 ? price / pe : null)

    const scenario = (peVal: number | null, growth: number): ScenarioCase => {
      if (!peVal || epsBase == null) {
        return { priceTarget: null, pe: peVal, epsNext: epsBase, growthPct: growth * 100 }
      }
      const epsFuture = epsBase * (1 + growth)
      return { priceTarget: epsFuture * peVal, pe: peVal, epsNext: epsBase, growthPct: growth * 100 }
    }

    const bearCase = scenario(bearPe, bearGrowth)
    const baseCase = scenario(basePe, baseGrowth)
    const bullCase = scenario(bullPe, bullGrowth)

    const fairValue = baseCase.priceTarget
    const upside = price != null && fairValue != null ? (fairValue - price) / price : null

    const data: ValuationResponse = {
      symbol: symbolRaw,
      price,
      fairValue,
      upside,
      bearCase,
      baseCase,
      bullCase,
      pe,
      sectorPE,
      pe5y,
      peg,
      evToEbitda,
      epsGrowth3y,
      revenueGrowth3y,
      fcfGrowth3y,
      aiSummary: null,
      fetchedAt: new Date().toISOString(),
      rateLimited: false,
      stale: false,
      dataSource: 'live',
    }

    data.aiSummary = buildSummary(data)

    const liveData = { ...data }
    cache.set(symbolRaw, { ts: Date.now(), data: liveData })
    staleCache.set(symbolRaw, { ts: Date.now(), data: liveData })
    if (IS_DEV) console.info(`[valuation] live data fetched + cached for ${symbolRaw}`)

    return NextResponse.json(liveData, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=21600' },
    })
  } catch (e) {
    return NextResponse.json({ error: 'FMP fetch failed', details: String(e) }, { status: 500 })
  }
}
