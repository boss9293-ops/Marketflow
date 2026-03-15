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

const parseEtTimeToMinutes = (value: string): number => {
  const matched = value.match(/^(\d{1,2}):(\d{2})/)
  if (!matched) return -1
  const hours = Number(matched[1])
  const minutes = Number(matched[2])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return -1
  return hours * 60 + minutes
}

type InitStatus = 'loading' | 'ready' | 'empty' | 'error'
type SectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type AskStatus = 'idle' | 'submitting' | 'ready' | 'error'

export default function AppShell() {
  const service = useMemo(() => createDashboardService({ mode: 'hybrid' }), [])
  const initialDateET = useMemo(() => formatDateET(new Date()), [])

  const [selectedDateET] = useState<ETDateString>(initialDateET)
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null)
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')

  const [tickerBriefs, setTickerBriefs] = useState<TickerBrief[]>([])
  const [tickerNews, setTickerNews] = useState<TickerNewsItem[]>([])

  const [marketHeadlines, setMarketHeadlines] = useState<Array<{
    id: string
    timeET: string
    headline: string
    source: string
  }>>([])

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

  const [askQuestionInput, setAskQuestionInput] = useState<string>('')
  const [askStatus, setAskStatus] = useState<AskStatus>('idle')
  const [askError, setAskError] = useState<string | null>(null)
  const [askAnswerKo, setAskAnswerKo] = useState<string>('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const [evidenceRows, setEvidenceRows] = useState<EvidenceRow[]>([])
  const [evidenceStatus, setEvidenceStatus] = useState<SectionStatus>('idle')
  const [evidenceError, setEvidenceError] = useState<string | null>(null)

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
          snapshot.marketHeadlines
            .map((h) => ({
              id: h.id,
              timeET: h.timeET,
              headline: h.headline,
              source: h.source,
            }))
            .sort((a, b) => parseEtTimeToMinutes(b.timeET) - parseEtTimeToMinutes(a.timeET)),
        )

        if (!snapshot.watchlistItems.length) {
          setInitStatus('empty')
          return
        }

        setSelectedSymbol(snapshot.watchlistItems[0].symbol)
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
    if (!selectedSymbol || initStatus === 'error' || initStatus === 'empty') return

    let cancelled = false
    const loadSymbolData = async () => {
      setTickerBriefs([])
      setTickerNews([])
      setBriefsStatus('loading')
      setBriefsError(null)
      setTimelineStatus('loading')
      setTimelineError(null)

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

      const [briefsResult, newsResult] = await Promise.allSettled([
        service.getTickerBriefs(selectedSymbol, selectedDateET),
        service.getTickerNews(selectedSymbol, selectedDateET),
      ])
      if (cancelled) return

      if (briefsResult.status === 'fulfilled') {
        const items = briefsResult.value.data.briefs
        setTickerBriefs(items)
        setBriefsStatus(items.length ? 'ready' : 'empty')
      } else {
        setTickerBriefs([])
        setBriefsStatus('error')
        setBriefsError(
          briefsResult.reason instanceof Error
            ? briefsResult.reason.message
            : 'Failed to load brief cards.',
        )
      }

      if (newsResult.status === 'fulfilled') {
        const items = newsResult.value.data.news
        setTickerNews(items)
        setTimelineStatus(items.length ? 'ready' : 'empty')
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

    void loadSymbolData()
    return () => {
      cancelled = true
    }
  }, [selectedDateET, initStatus, selectedSymbol, service])

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
        briefs={tickerBriefs}
        briefsStatus={briefsStatus}
        briefsError={briefsError}
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
      />
    </div>
  )
}
