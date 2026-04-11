'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import CenterPanel from '@/components/watchlist_mvp/CenterPanel'
import LeftPanel from '@/components/watchlist_mvp/LeftPanel'
import RightPanel from '@/components/watchlist_mvp/RightPanel'
import { createDashboardService } from '@/lib/terminal-mvp/dashboardService'
import {
  ET_TIMEZONE,
  type ETDateString,
  type EvidenceRow,
  type NewsDetail,
  type MarketHeadlinesHealth,
  type TickerBrief,
  type TickerNewsItem,
  type Watchlist,
  type WatchlistItem,
} from '@/lib/terminal-mvp/types'
import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'

const formatDateET = (date: Date): ETDateString =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

const MARKET_OPEN_MINUTES_ET = 9 * 60 + 30
const MARKET_CLOSE_MINUTES_ET = 16 * 60 + 30
const NEWS_REFRESH_POLL_MS = 60_000

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

type NewsRefreshCheckpointState = {
  dateET: ETDateString
  closeTriggered: boolean
}

const createNewsRefreshCheckpointState = (now: Date = new Date()): NewsRefreshCheckpointState => {
  const { year, month, day, hour, minute } = getEtClockParts(now)
  const dateET = toYmd(year, month, day)
  const currentMinutes = hour * 60 + minute
  return {
    dateET,
    closeTriggered: currentMinutes >= MARKET_CLOSE_MINUTES_ET,
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

const holidaySetByYear = new Map<number, Set<string>>()

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
  const ymd = toYmd(year, month, day)
  return getUsMarketHolidaySet(year).has(ymd)
}

const isRegularSessionOpenET = (now: Date = new Date()): boolean => {
  const { weekday, hour, minute } = getEtClockParts(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  if (isUsMarketHolidayET(now)) return false
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false

  const totalMinutes = hour * 60 + minute
  return totalMinutes >= MARKET_OPEN_MINUTES_ET && totalMinutes < MARKET_CLOSE_MINUTES_ET
}

const isNewsRefreshAllowedET = (now: Date = new Date()): boolean => {
  const { weekday } = getEtClockParts(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return !isUsMarketHolidayET(now)
}

const getLatestTradingDateET = (now: Date = new Date()): ETDateString => {
  const cursor = new Date(now)
  for (let i = 0; i < 10; i += 1) {
    const { year, month, day, weekday } = getEtClockParts(cursor)
    const candidate = toYmd(year, month, day)
    if (weekday !== 'Sat' && weekday !== 'Sun' && !isUsMarketHolidayET(cursor)) {
      return candidate
    }
    cursor.setDate(cursor.getDate() - 1)
  }
  const { year, month, day } = getEtClockParts(now)
  return toYmd(year, month, day)
}

type MarketHeadlineView = {
  id: string
  dateET: string
  publishedAtET: string
  timeET: string
  headline: string
  source: string
  url: string
}

const getHeadlineEpoch = (item: MarketHeadlineView): number => {
  const ts = Date.parse(item.publishedAtET || '')
  if (Number.isFinite(ts)) return ts
  const fallbackTs = Date.parse(`${item.dateET}T00:00:00-05:00`)
  return Number.isFinite(fallbackTs) ? fallbackTs : 0
}

const sortHeadlines = (items: MarketHeadlineView[]): MarketHeadlineView[] =>
  [...items].sort((a, b) => getHeadlineEpoch(b) - getHeadlineEpoch(a))

const normalizeHeadlines = (
  rows: Array<{
    id: string
    dateET: string
    publishedAtET: string
    timeET: string
    headline: string
    source: string
    url: string
  }>,
  ): MarketHeadlineView[] =>
  sortHeadlines(
    rows.map((item) => ({
      id: item.id,
      dateET: item.dateET,
      publishedAtET: item.publishedAtET,
      timeET: item.timeET,
      headline: item.headline,
      source: item.source,
      url: item.url,
    })),
  )

const mergeHeadlines = (
  previous: MarketHeadlineView[],
  incoming: MarketHeadlineView[],
): MarketHeadlineView[] => {
  const merged = new Map<string, MarketHeadlineView>()
  for (const item of [...incoming, ...previous]) {
    const key = item.id || `${item.dateET}|${item.timeET}|${item.source}|${item.headline}`
    const existing = merged.get(key)
    if (!existing || getHeadlineEpoch(item) > getHeadlineEpoch(existing)) {
      merged.set(key, item)
    }
  }
  return sortHeadlines(Array.from(merged.values()))
}

// Keep one ET day on screen for now; bump this to 2 when the two-day view ships.
const MARKET_HEADLINE_DAYS_TO_KEEP = 1

const limitHeadlinesToRecentDates = (
  items: MarketHeadlineView[],
  daysToKeep: number,
): MarketHeadlineView[] => {
  if (daysToKeep <= 0) return []

  const sorted = sortHeadlines(items)
  const keptDates = new Set<string>()
  const filtered: MarketHeadlineView[] = []

  for (const item of sorted) {
    if (keptDates.has(item.dateET)) {
      filtered.push(item)
      continue
    }
    if (keptDates.size >= daysToKeep) continue
    keptDates.add(item.dateET)
    filtered.push(item)
  }

  return filtered
}

type InitStatus = 'loading' | 'ready' | 'empty' | 'error'
type SectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type AskStatus = 'idle' | 'submitting' | 'ready' | 'error'

const WATCHLIST_QUOTE_REFRESH_MS = 20_000
const SYMBOL_SNAPSHOT_CACHE_TTL_MS = 1000 * 60 * 5

type SymbolSnapshotCacheEntry = {
  briefs: TickerBrief[]
  news: TickerNewsItem[]
  todayOpen: number | null
  todayHigh: number | null
  todayLow: number | null
  todayClose: number | null
  todayVolume: number | null
  fetchedAt: Date
  refreshTick: number
}

export default function AppShell() {
  const service = useMemo(() => createDashboardService({ mode: 'hybrid' }), [])
  const [selectedDateET, setSelectedDateET] = useState<ETDateString>(() => getLatestTradingDateET(new Date()))
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null)
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')

  const [tickerBriefs, setTickerBriefs] = useState<TickerBrief[]>([])
  const [tickerNews, setTickerNews] = useState<TickerNewsItem[]>([])
  const [newsRefreshTick, setNewsRefreshTick] = useState(0)  // ?섎룞 ?덈줈怨좎묠 ?몃━嫄?
  const [isNewsRefreshing, setIsNewsRefreshing] = useState(false)
  const [newsLastFetchedAt, setNewsLastFetchedAt] = useState<Date | null>(null)
  const [todayOpen, setTodayOpen] = useState<number | null>(null)
  const [todayHigh, setTodayHigh] = useState<number | null>(null)
  const [todayLow, setTodayLow] = useState<number | null>(null)
  const [todayClose, setTodayClose] = useState<number | null>(null)
  const [todayVolume, setTodayVolume] = useState<number | null>(null)

  const [marketHeadlines, setMarketHeadlines] = useState<MarketHeadlineView[]>([])
  const [marketHeadlinesHealth, setMarketHeadlinesHealth] = useState<MarketHeadlinesHealth | null>(null)

  const [initStatus, setInitStatus] = useState<InitStatus>('loading')
  const [initError, setInitError] = useState<string | null>(null)

  const [briefsStatus, setBriefsStatus] = useState<SectionStatus>('idle')
  const [briefsError, setBriefsError] = useState<string | null>(null)
  const [timelineStatus, setTimelineStatus] = useState<SectionStatus>('idle')
  const [timelineError, setTimelineError] = useState<string | null>(null)

  const [selectedNewsId, setSelectedNewsId] = useState<string | null>(null)
  const [newsDetail, setNewsDetail] = useState<NewsDetail | null>(null)
  const [newsDetailStatus, setNewsDetailStatus] = useState<SectionStatus>('idle')
  const [newsDetailError, setNewsDetailError] = useState<string | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false)
  const detailRequestSeqRef = useRef(0)
  const briefingRefreshStateRef = useRef<NewsRefreshCheckpointState>(createNewsRefreshCheckpointState())

  const [askQuestionInput, setAskQuestionInput] = useState<string>('')
  const [askStatus, setAskStatus] = useState<AskStatus>('idle')
  const [askError, setAskError] = useState<string | null>(null)
  const [askAnswerKo, setAskAnswerKo] = useState<string>('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const [evidenceRows, setEvidenceRows] = useState<EvidenceRow[]>([])
  const [evidenceStatus, setEvidenceStatus] = useState<SectionStatus>('idle')
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const symbolSnapshotCacheRef = useRef(new Map<string, SymbolSnapshotCacheEntry>())

  useEffect(() => {
    const syncSelectedDate = () => {
      const nextDateET = getLatestTradingDateET(new Date())
      setSelectedDateET((current) => (current === nextDateET ? current : nextDateET))
    }

    syncSelectedDate()
    const timer = setInterval(syncSelectedDate, 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadInitial = async () => {
      setInitStatus('loading')
      setInitError(null)
      try {
        const snapshot = await service.getDashboardSnapshot(selectedDateET)
        if (cancelled) return

        setWatchlists(snapshot.watchlists)
        setSelectedWatchlistId(snapshot.selectedWatchlistId)
        setWatchlistItems(snapshot.watchlistItems)
        setMarketHeadlines(
          limitHeadlinesToRecentDates(
            normalizeHeadlines(snapshot.marketHeadlines),
            MARKET_HEADLINE_DAYS_TO_KEEP,
          ),
        )
        setMarketHeadlinesHealth(snapshot.marketHeadlinesHealth ?? null)

        if (!snapshot.watchlistItems.length) {
          setInitStatus('empty')
          return
        }

        setSelectedSymbol((current) => {
          if (!snapshot.watchlistItems.length) return ''
          if (current && snapshot.watchlistItems.some((item) => item.symbol === current)) return current
          return snapshot.watchlistItems[0].symbol
        })
        setInitStatus('ready')
      } catch (error) {
        if (cancelled) return
        setInitError(error instanceof Error ? error.message : 'Failed to load dashboard shell data.')
        setInitStatus('error')
      }
    }

    void loadInitial()
    return () => {
      cancelled = true
    }
  }, [selectedDateET, service])

  useEffect(() => {
    if (initStatus !== 'ready') return

    let cancelled = false

    const refreshHeadlines = async () => {
      try {
        const headlinesRes = await service.getMarketHeadlines(selectedDateET)
        if (cancelled) return
        const incoming = normalizeHeadlines(headlinesRes.data.headlines)
        setMarketHeadlines((previous) =>
          limitHeadlinesToRecentDates(
            mergeHeadlines(previous, incoming),
            MARKET_HEADLINE_DAYS_TO_KEEP,
          ),
        )
        setMarketHeadlinesHealth(headlinesRes.data.health ?? null)
      } catch {
        // Keep existing panel data if refresh fails.
        if (cancelled) return
        setMarketHeadlinesHealth({
          status: 'degraded',
          updatedAt: new Date().toISOString(),
          sources: [],
          message: 'Headline refresh failed. Showing last cached data.',
        })
      }
    }

    void refreshHeadlines()
    return () => {
      cancelled = true
    }
  }, [initStatus, newsRefreshTick, selectedDateET, service])

  useEffect(() => {
    if (initStatus !== 'ready' || !selectedWatchlistId) return
    if (!isRegularSessionOpenET()) return

    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const refreshWatchlistQuotes = async () => {
      if (!isRegularSessionOpenET()) return
      try {
        const itemsRes = await service.getWatchlistItems(selectedWatchlistId)
        if (cancelled) return
        const nextItems = itemsRes.data.items
        setWatchlistItems(nextItems)
        setSelectedSymbol((current) => {
          if (!nextItems.length) return ''
          if (current && nextItems.some((item) => item.symbol === current)) return current
          return nextItems[0].symbol
        })
      } catch {
        // Keep the previous snapshot when quote refresh fails.
      }
    }

    void refreshWatchlistQuotes()
    timer = setInterval(() => {
      if (!isRegularSessionOpenET()) {
        if (timer) clearInterval(timer)
        timer = null
        return
      }
      void refreshWatchlistQuotes()
    }, WATCHLIST_QUOTE_REFRESH_MS)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [initStatus, selectedWatchlistId, service])

  useEffect(() => {
    if (!selectedSymbol || initStatus === 'error' || initStatus === 'empty') return

    let cancelled = false
    const cacheKey = `${selectedDateET}|${selectedSymbol}`

    const hydrateSnapshot = (snapshot: SymbolSnapshotCacheEntry) => {
      setTickerBriefs(snapshot.briefs)
      setBriefsStatus(snapshot.briefs.length ? 'ready' : 'empty')
      setBriefsError(null)
      setTickerNews(snapshot.news)
      setTimelineStatus(snapshot.news.length ? 'ready' : 'empty')
      setTimelineError(null)
      setTodayOpen(snapshot.todayOpen)
      setTodayHigh(snapshot.todayHigh)
      setTodayLow(snapshot.todayLow)
      setTodayClose(snapshot.todayClose)
      setTodayVolume(snapshot.todayVolume)
      setNewsLastFetchedAt(snapshot.fetchedAt)
    }

    const loadSymbolData = async () => {
      const cachedSnapshot = symbolSnapshotCacheRef.current.get(cacheKey)
      const cacheAgeMs = cachedSnapshot ? Date.now() - cachedSnapshot.fetchedAt.getTime() : Number.POSITIVE_INFINITY
      const shouldRevalidate =
        !cachedSnapshot ||
        cachedSnapshot.refreshTick !== newsRefreshTick ||
        cacheAgeMs > SYMBOL_SNAPSHOT_CACHE_TTL_MS

      if (cachedSnapshot) {
        hydrateSnapshot(cachedSnapshot)
        setIsNewsRefreshing(shouldRevalidate)
      } else {
        setTickerBriefs([])
        setTickerNews([])
        setBriefsStatus('loading')
        setBriefsError(null)
        setTimelineStatus('loading')
        setTimelineError(null)
        setTodayOpen(null)
        setTodayHigh(null)
        setTodayLow(null)
        setTodayClose(null)
        setTodayVolume(null)
        setIsNewsRefreshing(true)
      }

      setSelectedNewsId(null)
      setNewsDetail(null)
      setNewsDetailError(null)
      setNewsDetailStatus('idle')
      setIsDetailOpen(false)

      setAskQuestionInput('')
      setAskStatus('idle')
      setAskError(null)
      setAskAnswerKo('')
      setActiveSessionId(null)
      setEvidenceRows([])
      setEvidenceStatus('idle')
      setEvidenceError(null)

      if (!shouldRevalidate) {
        setIsNewsRefreshing(false)
        return
      }

      const [briefsResult, newsResult, ohlcvResult] = await Promise.allSettled([
        service.getTickerBriefs(selectedSymbol, selectedDateET),
        service.getTickerNews(selectedSymbol, selectedDateET),
        fetch(`/api/vr-ohlcv/${encodeURIComponent(selectedSymbol)}`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
      ])
      if (cancelled) return

      if (briefsResult.status === 'fulfilled') {
        const items = briefsResult.value.data.briefs
        const nextBriefsStatus: SectionStatus = items.length ? 'ready' : 'empty'
        setTickerBriefs(items)
        setBriefsStatus(nextBriefsStatus)
        setBriefsError(null)
      } else {
        if (cachedSnapshot) {
          setTickerBriefs(cachedSnapshot.briefs)
          setBriefsStatus(cachedSnapshot.briefs.length ? 'ready' : 'empty')
          setBriefsError(null)
        } else {
          setTickerBriefs([])
          setBriefsStatus('error')
          setBriefsError(
            briefsResult.reason instanceof Error
              ? briefsResult.reason.message
              : 'Failed to load brief cards.',
          )
        }
      }

      if (newsResult.status === 'fulfilled') {
        const items = newsResult.value.data.news
        const nextTimelineStatus: SectionStatus = items.length ? 'ready' : 'empty'
        setTickerNews(items)
        setTimelineStatus(nextTimelineStatus)
        setTimelineError(null)
      } else {
        if (cachedSnapshot) {
          setTickerNews(cachedSnapshot.news)
          setTimelineStatus(cachedSnapshot.news.length ? 'ready' : 'empty')
          setTimelineError(null)
        } else {
          setTickerNews([])
          setTimelineStatus('error')
          setTimelineError(
            newsResult.reason instanceof Error
              ? newsResult.reason.message
              : 'Failed to load news timeline.',
          )
        }
      }
      // ?ㅻ뒛 ?쒓?/醫낃? 異붿텧
      if (ohlcvResult.status === 'fulfilled' && ohlcvResult.value?.bars?.length) {
        const bars = ohlcvResult.value.bars as Array<{ d: string; o: number; h: number; l: number; c: number; v: number }>
        const todayBar = bars[bars.length - 1]  // 理쒖떊 諛?(DESC?뭨eversed ??留덉?留??ㅻ뒛)
        setTodayOpen(todayBar?.o ?? null)
        setTodayHigh(todayBar?.h ?? null)
        setTodayLow(todayBar?.l ?? null)
        setTodayClose(todayBar?.c ?? null)
        setTodayVolume(todayBar?.v ?? null)
      }
      if (
        briefsResult.status === 'fulfilled' &&
        newsResult.status === 'fulfilled' &&
        ohlcvResult.status === 'fulfilled'
      ) {
        symbolSnapshotCacheRef.current.set(cacheKey, {
          briefs: briefsResult.value.data.briefs,
          news: newsResult.value.data.news,
          todayOpen: ohlcvResult.value?.bars?.length
            ? ohlcvResult.value.bars[ohlcvResult.value.bars.length - 1]?.o ?? null
            : null,
          todayHigh: ohlcvResult.value?.bars?.length
            ? ohlcvResult.value.bars[ohlcvResult.value.bars.length - 1]?.h ?? null
            : null,
          todayLow: ohlcvResult.value?.bars?.length
            ? ohlcvResult.value.bars[ohlcvResult.value.bars.length - 1]?.l ?? null
            : null,
          todayClose: ohlcvResult.value?.bars?.length
            ? ohlcvResult.value.bars[ohlcvResult.value.bars.length - 1]?.c ?? null
            : null,
          todayVolume: ohlcvResult.value?.bars?.length
            ? ohlcvResult.value.bars[ohlcvResult.value.bars.length - 1]?.v ?? null
            : null,
          fetchedAt: new Date(),
          refreshTick: newsRefreshTick,
        })
      }
      setIsNewsRefreshing(false)
      setNewsLastFetchedAt(new Date())
    }

    void loadSymbolData()
    return () => {
      cancelled = true
    }
  }, [selectedDateET, initStatus, selectedSymbol, service, newsRefreshTick])

  useEffect(() => {
    if (!selectedSymbol || initStatus !== 'ready') return
    if (!isNewsRefreshAllowedET()) return

    briefingRefreshStateRef.current = createNewsRefreshCheckpointState()

    const pollForCheckpointRefresh = () => {
      const now = new Date()
      const { year, month, day, hour, minute } = getEtClockParts(now)
      const currentDateET = toYmd(year, month, day)
      const currentMinutes = hour * 60 + minute
      const state = briefingRefreshStateRef.current

      if (state.dateET !== currentDateET) {
        briefingRefreshStateRef.current = createNewsRefreshCheckpointState(now)
        return
      }

      if (!state.closeTriggered && currentMinutes >= MARKET_CLOSE_MINUTES_ET) {
        state.closeTriggered = true
        setNewsRefreshTick((tick) => tick + 1)
      }
    }

    const timer = setInterval(pollForCheckpointRefresh, NEWS_REFRESH_POLL_MS)
    return () => clearInterval(timer)
  }, [selectedSymbol, initStatus])

  useEffect(() => {
    if (!activeSessionId) {
      setEvidenceRows([])
      setEvidenceStatus('idle')
      setEvidenceError(null)
      return
    }

    let cancelled = false
    const loadEvidenceRows = async () => {
      setEvidenceStatus('loading')
      setEvidenceError(null)
      try {
        const evidenceRes = await service.getEvidence(activeSessionId)
        if (cancelled) return
        const rows = evidenceRes.data.rows
        setEvidenceRows(rows)
        setEvidenceStatus(rows.length ? 'ready' : 'empty')
      } catch (error) {
        if (cancelled) return
        setEvidenceRows([])
        setEvidenceStatus('error')
        setEvidenceError(
          error instanceof Error ? error.message : 'Failed to load source table rows.',
        )
      }
    }

    void loadEvidenceRows()
    return () => {
      cancelled = true
    }
  }, [activeSessionId, service])

  const selectedItem = useMemo(
    () => watchlistItems.find((item) => item.symbol === selectedSymbol) ?? null,
    [watchlistItems, selectedSymbol],
  )

  const openNewsDetail = (newsItem: TickerNewsItem) => {
    setSelectedNewsId(newsItem.id)
    setIsDetailOpen(true)
    setNewsDetail(null)
    setNewsDetailError(null)
    setNewsDetailStatus('loading')

    const requestId = ++detailRequestSeqRef.current
    void service
      .logNewsClick(newsItem.id, {
        actorId: 'terminal-mvp-user',
        actorType: 'user',
        contextSymbol: selectedSymbol || undefined,
        clickedAtET: new Date().toISOString(),
      })
      .catch(() => {
        // Logging is intentionally non-blocking.
      })

    void service
      .getNewsDetail(newsItem.id)
      .then((res) => {
        if (requestId !== detailRequestSeqRef.current) return
        setNewsDetail(res.data.news)
        setNewsDetailStatus('ready')
      })
      .catch((error) => {
        if (requestId !== detailRequestSeqRef.current) return
        setNewsDetail(null)
        setNewsDetailStatus('error')
        setNewsDetailError(error instanceof Error ? error.message : 'Failed to load news metadata.')
      })
  }

  const exportNewsToSheet = (newsId: string) =>
    service.exportNewsToSheet(newsId, {
      sheetName: 'terminal_mvp_news_export',
      requestedBy: 'terminal-mvp-user',
      requestedAtET: new Date().toISOString(),
    })

  const exportEvidenceToSheet = (sessionId: string) =>
    service.exportEvidenceToSheet({
      sessionId,
      sheetName: 'terminal_mvp_evidence_export',
      requestedBy: 'terminal-mvp-user',
      requestedAtET: new Date().toISOString(),
    })

  const submitAsk = async () => {
    const question = askQuestionInput.trim()
    if (!selectedSymbol || !question) {
      setAskStatus('error')
      setAskError('Please enter a question before submitting.')
      return
    }

    setAskStatus('submitting')
    setAskError(null)
    setAskAnswerKo('')
    setActiveSessionId(null)
    setEvidenceRows([])
    setEvidenceStatus('idle')
    setEvidenceError(null)

    try {
      const askRes = await service.askQuestion({
        symbol: selectedSymbol,
        question,
        dateET: selectedDateET,
        timezone: ET_TIMEZONE,
      })
      setAskAnswerKo(askRes.data.answerKo)
      setActiveSessionId(askRes.data.sessionId)
      setAskStatus('ready')
    } catch (error) {
      setAskStatus('error')
      setAskError(error instanceof Error ? error.message : 'Failed to create research session.')
      setEvidenceRows([])
      setEvidenceStatus('idle')
      setEvidenceError(null)
    }
  }

  return (
    <div className={styles.shell}>
      <LeftPanel
        items={watchlistItems}
        watchlists={watchlists}
        selectedWatchlistId={selectedWatchlistId}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
        isLoading={initStatus === 'loading'}
        errorMessage={initStatus === 'error' ? initError : null}
        isEmpty={initStatus === 'empty'}
      />
      <CenterPanel
        selectedSymbol={selectedSymbol}
        selectedItem={selectedItem}
        dateET={selectedDateET}
        onRefreshNews={() => {
          if (!isNewsRefreshAllowedET()) return
          setNewsRefreshTick((t) => t + 1)
        }}
        isRefreshLocked={!isNewsRefreshAllowedET()}
        isNewsRefreshing={isNewsRefreshing}
        newsLastFetchedAt={newsLastFetchedAt}
        todayOpen={todayOpen}
        todayHigh={todayHigh}
        todayLow={todayLow}
        todayClose={todayClose}
        todayVolume={todayVolume}
        timeline={tickerNews}
        timelineStatus={timelineStatus}
        timelineError={timelineError}
        timezone={ET_TIMEZONE}
        selectedNewsId={selectedNewsId}
        onSelectNews={openNewsDetail}
        isDetailOpen={isDetailOpen}
        detailStatus={newsDetailStatus}
        detailError={newsDetailError}
        detail={newsDetail}
        onExportNews={exportNewsToSheet}
        askQuestionInput={askQuestionInput}
        onAskQuestionInputChange={setAskQuestionInput}
        onAskSubmit={submitAsk}
        askStatus={askStatus}
        askError={askError}
        askAnswerKo={askAnswerKo}
        activeSessionId={activeSessionId}
        evidenceRows={evidenceRows}
        evidenceStatus={evidenceStatus}
        evidenceError={evidenceError}
        onExportEvidenceToSheet={exportEvidenceToSheet}
        onCloseDetail={() => setIsDetailOpen(false)}
      />
      <RightPanel
        selectedSymbol={selectedSymbol}
        selectedItem={selectedItem}
        headlines={marketHeadlines}
        isChartLoading={initStatus === 'loading' || briefsStatus === 'loading'}
        chartError={briefsStatus === 'error' ? briefsError : null}
        isHeadlinesLoading={initStatus === 'loading'}
        headlinesError={initStatus === 'error' ? initError : null}
        headlinesHealth={marketHeadlinesHealth}
      />
    </div>
  )
}

