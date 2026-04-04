import { NextResponse } from 'next/server'

type QuoteMode = 'auto' | 'live' | 'delayed'
type QuoteSource = 'finnhub_realtime' | 'fmp_realtime' | 'yahoo_delayed'

type QuoteRow = {
  symbol: string
  price: number | null
  changePercent: number | null
  dayLow: number | null
  dayHigh: number | null
  name: string
  source: QuoteSource
  asOf: string | null
  stale?: boolean
}

type CachedQuote = {
  quote: QuoteRow
  fetchedAt: number
  tier: 'live' | 'delayed'
}

const ET_TIMEZONE = 'America/New_York' as const
const MAX_SYMBOLS = 40
const LIVE_CACHE_MS = 20_000
const DELAYED_CACHE_MS = 12 * 60 * 1000
const MARKET_OPEN_MINUTES_ET = 9 * 60 + 30
const MARKET_CLOSE_MINUTES_ET = 16 * 60

const quoteCache = new Map<string, CachedQuote>()
const holidaySetByYear = new Map<number, Set<string>>()

const pad2 = (value: number): string => String(value).padStart(2, '0')

const toYmd = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month)}-${pad2(day)}`

const getEtClockParts = (now: Date = new Date()): {
  year: number
  month: number
  day: number
  weekday: string
  hour: number
  minute: number
} => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    year: Number(read('year') || '0'),
    month: Number(read('month') || '0'),
    day: Number(read('day') || '0'),
    weekday: read('weekday'),
    hour: Number(read('hour') || '0'),
    minute: Number(read('minute') || '0'),
  }
}

const nthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  nth: number,
): number => {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const offset = (weekday - firstDow + 7) % 7
  return 1 + offset + (nth - 1) * 7
}

const lastWeekdayOfMonth = (year: number, month: number, weekday: number): number => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay()
  const offset = (lastDow - weekday + 7) % 7
  return lastDay - offset
}

const observedFixedHolidayYmd = (year: number, month: number, day: number): string => {
  const observed = new Date(Date.UTC(year, month - 1, day))
  const dow = observed.getUTCDay()
  if (dow === 6) observed.setUTCDate(observed.getUTCDate() - 1)
  else if (dow === 0) observed.setUTCDate(observed.getUTCDate() + 1)
  return toYmd(
    observed.getUTCFullYear(),
    observed.getUTCMonth() + 1,
    observed.getUTCDate(),
  )
}

const easterSundayUTC = (year: number): Date => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const getUsMarketHolidaySet = (year: number): Set<string> => {
  const cached = holidaySetByYear.get(year)
  if (cached) return cached

  const holidays = new Set<string>()
  const addIfYearMatches = (ymd: string) => {
    if (ymd.startsWith(`${year}-`)) holidays.add(ymd)
  }

  addIfYearMatches(observedFixedHolidayYmd(year, 1, 1)) // New Year's Day
  holidays.add(toYmd(year, 1, nthWeekdayOfMonth(year, 1, 1, 3))) // MLK Day
  holidays.add(toYmd(year, 2, nthWeekdayOfMonth(year, 2, 1, 3))) // Presidents Day
  holidays.add(toYmd(year, 5, lastWeekdayOfMonth(year, 5, 1))) // Memorial Day
  addIfYearMatches(observedFixedHolidayYmd(year, 6, 19)) // Juneteenth
  addIfYearMatches(observedFixedHolidayYmd(year, 7, 4)) // Independence Day
  holidays.add(toYmd(year, 9, nthWeekdayOfMonth(year, 9, 1, 1))) // Labor Day
  holidays.add(toYmd(year, 11, nthWeekdayOfMonth(year, 11, 4, 4))) // Thanksgiving
  addIfYearMatches(observedFixedHolidayYmd(year, 12, 25)) // Christmas

  const goodFriday = easterSundayUTC(year)
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2)
  holidays.add(toYmd(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()))

  holidaySetByYear.set(year, holidays)
  return holidays
}

const isUsMarketHolidayET = (now: Date = new Date()): boolean => {
  const { year, month, day } = getEtClockParts(now)
  if (!year || !month || !day) return false
  return getUsMarketHolidaySet(year).has(toYmd(year, month, day))
}

const isRegularSessionOpenET = (now: Date = new Date()): boolean => {
  const { weekday, hour, minute } = getEtClockParts(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  if (isUsMarketHolidayET(now)) return false
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const totalMinutes = hour * 60 + minute
  return totalMinutes >= MARKET_OPEN_MINUTES_ET && totalMinutes < MARKET_CLOSE_MINUTES_ET
}

const toNum = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toIsoFromEpochSec = (value: unknown): string | null => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

const parseMode = (raw: string | null): QuoteMode => {
  const mode = (raw || 'auto').trim().toLowerCase()
  if (mode === 'live' || mode === 'delayed' || mode === 'auto') return mode
  return 'auto'
}

const parseSymbols = (raw: string): string[] => {
  const unique = new Set<string>()
  for (const token of raw.split(',')) {
    const sym = token.trim().toUpperCase()
    if (!sym) continue
    unique.add(sym)
  }
  return Array.from(unique)
}

const getFreshCachedQuotes = (symbols: string[], mode: QuoteMode, now: number): Map<string, QuoteRow> => {
  const out = new Map<string, QuoteRow>()
  for (const sym of symbols) {
    const cached = quoteCache.get(sym)
    if (!cached) continue
    const age = now - cached.fetchedAt
    if (cached.tier === 'live') {
      if (mode === 'delayed') continue
      if (age <= LIVE_CACHE_MS) out.set(sym, cached.quote)
      continue
    }
    if (mode === 'live') continue
    if (age <= DELAYED_CACHE_MS) out.set(sym, cached.quote)
  }
  return out
}

const getStaleCachedQuote = (symbol: string): QuoteRow | null => {
  const cached = quoteCache.get(symbol)
  if (!cached?.quote) return null
  return { ...cached.quote, stale: true }
}

const cacheQuotes = (quotes: QuoteRow[]): void => {
  const now = Date.now()
  for (const row of quotes) {
    const tier = row.source === 'yahoo_delayed' ? 'delayed' : 'live'
    quoteCache.set(row.symbol, {
      quote: row,
      fetchedAt: now,
      tier,
    })
  }
}

const fetchFinnhubRealtime = async (symbols: string[]): Promise<QuoteRow[]> => {
  const key = process.env.FINNHUB_API_KEY || process.env.NEXT_PUBLIC_FINNHUB_API_KEY || ''
  if (!key || symbols.length === 0) return []

  try {
    const tasks = symbols.map(async (symbol): Promise<QuoteRow | null> => {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`, {
        cache: 'no-store',
      })
      if (!res.ok) return null
      const data = await res.json()
      const price = toNum(data.c)
      if (price == null || price <= 0) return null

      return {
        symbol,
        price,
        changePercent: toNum(data.dp),
        dayLow: toNum(data.l),
        dayHigh: toNum(data.h),
        name: symbol,
        source: 'finnhub_realtime',
        asOf: toIsoFromEpochSec(data.t),
      }
    })

    const settled = await Promise.allSettled(tasks)
    return settled
      .filter((item): item is PromiseFulfilledResult<QuoteRow | null> => item.status === 'fulfilled')
      .map((item) => item.value)
      .filter((item): item is QuoteRow => Boolean(item))
  } catch (err: any) {
    console.warn('[quote API - Finnhub] Realtime fetch failed:', err?.message || String(err))
    return []
  }
}

const fetchFmpRealtime = async (symbols: string[]): Promise<QuoteRow[]> => {
  const key = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY || ''
  if (!key || symbols.length === 0) return []

  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbols.join(',')}?apikey=${key}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []

    return data
      .map((row: any): QuoteRow | null => {
        const symbol = String(row?.symbol || '').toUpperCase()
        const price = toNum(row?.price)
        if (!symbol || price == null || price <= 0) return null
        return {
          symbol,
          price,
          changePercent: toNum(row?.changesPercentage),
          dayLow: toNum(row?.dayLow),
          dayHigh: toNum(row?.dayHigh),
          name: String(row?.name || symbol),
          source: 'fmp_realtime',
          asOf: toIsoFromEpochSec(row?.timestamp),
        }
      })
      .filter((row: QuoteRow | null): row is QuoteRow => Boolean(row))
  } catch (err: any) {
    console.warn('[quote API - FMP] Realtime fetch failed:', err?.message || String(err))
    return []
  }
}

const fetchYahooDelayed = async (symbols: string[]): Promise<QuoteRow[]> => {
  if (symbols.length === 0) return []
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!res.ok) return []

    const data = await res.json()
    const sparkResults = Array.isArray(data?.spark?.result) ? data.spark.result : []

    return sparkResults
      .map((row: any): QuoteRow | null => {
        const meta = row?.response?.[0]?.meta || row
        const symbol = String(meta?.symbol || row?.symbol || '').toUpperCase()
        const price = toNum(meta?.regularMarketPrice)
        if (!symbol || price == null || price <= 0) return null

        const prevClose = toNum(meta?.chartPreviousClose) ?? price
        const changePercent =
          prevClose > 0 && price > 0 ? ((price - prevClose) / prevClose) * 100 : 0

        return {
          symbol,
          price,
          changePercent,
          dayLow: toNum(meta?.regularMarketDayLow),
          dayHigh: toNum(meta?.regularMarketDayHigh),
          name: String(meta?.shortName || symbol),
          source: 'yahoo_delayed',
          asOf: toIsoFromEpochSec(meta?.regularMarketTime),
        }
      })
      .filter((row: QuoteRow | null): row is QuoteRow => Boolean(row))
  } catch (err: any) {
    console.warn('[quote API - Yahoo] Delayed fetch failed:', err?.message || String(err))
    return []
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbolsRaw = searchParams.get('symbols')
  const mode = parseMode(searchParams.get('mode'))
  const sessionOpenET = isRegularSessionOpenET()
  const effectiveMode: QuoteMode = mode === 'auto' && !sessionOpenET ? 'delayed' : mode

  if (!symbolsRaw) {
    return NextResponse.json({ error: 'Missing symbols parameter' }, { status: 400 })
  }

  const symbolArray = parseSymbols(symbolsRaw)
  if (symbolArray.length === 0) {
    return NextResponse.json({ error: 'No valid symbols provided' }, { status: 400 })
  }
  if (symbolArray.length > MAX_SYMBOLS) {
    return NextResponse.json(
      { error: `Too many symbols. Max ${MAX_SYMBOLS} per request.` },
      { status: 400 },
    )
  }

  const now = Date.now()
  const freshCached = getFreshCachedQuotes(symbolArray, effectiveMode, now)
  const quoteMap = new Map<string, QuoteRow>(freshCached)

  const missing = symbolArray.filter((symbol) => !quoteMap.has(symbol))

  if (missing.length > 0) {
    if (effectiveMode !== 'delayed') {
      const liveFinnhub = await fetchFinnhubRealtime(missing)
      for (const row of liveFinnhub) quoteMap.set(row.symbol, row)

      const stillMissingAfterFinnhub = missing.filter((symbol) => !quoteMap.has(symbol))
      if (stillMissingAfterFinnhub.length > 0) {
        const liveFmp = await fetchFmpRealtime(stillMissingAfterFinnhub)
        for (const row of liveFmp) quoteMap.set(row.symbol, row)
      }
    }

    const stillMissing = symbolArray.filter((symbol) => !quoteMap.has(symbol))
    if (stillMissing.length > 0) {
      const delayedQuotes = await fetchYahooDelayed(stillMissing)
      for (const row of delayedQuotes) quoteMap.set(row.symbol, row)
    }
  }

  const unresolved = symbolArray.filter((symbol) => !quoteMap.has(symbol))
  if (unresolved.length > 0) {
    for (const symbol of unresolved) {
      const stale = getStaleCachedQuote(symbol)
      if (stale) quoteMap.set(symbol, stale)
    }
  }

  const quotes = symbolArray
    .map((symbol) => quoteMap.get(symbol))
    .filter((row): row is QuoteRow => Boolean(row))

  if (quotes.length === 0) {
    return NextResponse.json(
      { error: 'Quote providers unavailable for requested symbols.' },
      { status: 503 },
    )
  }

  cacheQuotes(quotes.filter((row) => !row.stale))

  const liveCount = quotes.filter((row) => row.source !== 'yahoo_delayed').length
  const delayedCount = quotes.length - liveCount
  const staleCount = quotes.filter((row) => row.stale).length

  return NextResponse.json({
    quotes,
    meta: {
      modeRequested: mode,
      modeEffective: effectiveMode,
      sessionOpenET,
      cachePolicy: {
        liveTtlMs: LIVE_CACHE_MS,
        delayedTtlMs: DELAYED_CACHE_MS,
      },
      counts: {
        requested: symbolArray.length,
        returned: quotes.length,
        live: liveCount,
        delayed: delayedCount,
        stale: staleCount,
      },
    },
  })
}
