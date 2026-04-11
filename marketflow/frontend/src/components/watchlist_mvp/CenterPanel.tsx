import { useEffect, useMemo, useRef, useState } from 'react'

import SourceTable from '@/components/watchlist_mvp/SourceTable'
import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'
import type {
  ETDateString,
  ETTimezone,
  EvidenceRow,
  NewsDetail,
  TickerNewsItem,
} from '@/lib/terminal-mvp/types'

type SectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type ExportUiStatus = 'idle' | 'submitting' | 'success' | 'error'
type AskStatus = 'idle' | 'submitting' | 'ready' | 'error'

type CenterPanelProps = {
  selectedSymbol: string
  selectedItem: {
    symbol: string
    companyName?: string
    lastPrice: string
    changePercent: string
    rangeLabel: string
  } | null
  dateET: ETDateString
  timezone: ETTimezone
  timeline: TickerNewsItem[]
  timelineStatus: SectionStatus
  timelineError: string | null
  selectedNewsId: string | null
  onSelectNews: (item: TickerNewsItem) => void
  isDetailOpen: boolean
  detailStatus: SectionStatus
  detailError: string | null
  detail: NewsDetail | null
  onExportNews: (newsId: string) => Promise<unknown>
  askQuestionInput: string
  onAskQuestionInputChange: (value: string) => void
  onAskSubmit: () => Promise<void>
  askStatus: AskStatus
  askError: string | null
  askAnswerKo: string
  activeSessionId: string | null
  evidenceRows: EvidenceRow[]
  evidenceStatus: SectionStatus
  evidenceError: string | null
  onExportEvidenceToSheet: (sessionId: string) => Promise<unknown>
  onCloseDetail: () => void
  onRefreshNews: () => void
  isNewsRefreshing: boolean
  newsLastFetchedAt: Date | null
  todayOpen: number | null
  todayHigh: number | null
  todayLow: number | null
  todayClose: number | null
  todayVolume: number | null
}

const formatMetadataValue = (value?: string | number | null): string =>
  value == null || value === '' ? 'N/A' : String(value)

const formatPrice = (value: number): string => `$${value.toFixed(2)}`

const formatCompactNumber = (value: number): string => {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return `${Math.round(value)}`
}

const normalizeNewsText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const NEWS_CATALYST_KEYWORDS = [
  'earnings',
  'guidance',
  'analyst',
  'target',
  'rating',
  'upgrade',
  'downgrade',
  'revenue',
  'margin',
  'delivery',
  'deliveries',
  'shipment',
  'shipments',
  'order',
  'orders',
  'contract',
  'deal',
  'approval',
  'regulation',
  'probe',
  'tariff',
  'export',
  'supply chain',
  'ai',
  'artificial intelligence',
  'chip',
  'chips',
  'semiconductor',
  'semiconductors',
  'gpu',
  'data center',
  'cloud',
  'hyperscaler',
  'blackwell',
  'cuda',
  'inference',
  'server',
  'power',
  'oil',
  'crude',
  'rate',
  'rates',
  'inflation',
  'fed',
  'cpi',
  'ppi',
  'yield',
  'treasury',
  'geopolitical',
  'china',
  'iran',
  'israel',
  'cyber',
  'hack',
  'antitrust',
]

const NEWS_NOISE_KEYWORDS = [
  'sneaker',
  'fashion',
  'movie',
  'concert',
  'recipe',
  'celebrity',
  'sports',
  'wedding',
  'gossip',
  'travel',
  'airline',
  'hotel',
  'restaurant',
  'music',
  'beauty',
  'lifestyle',
]

const COMPANY_STOPWORDS = new Set([
  'inc',
  'incorporated',
  'corporation',
  'corp',
  'company',
  'co',
  'ltd',
  'limited',
  'holdings',
  'holding',
  'class',
  'common',
  'shares',
  'share',
])

const scoreNewsItem = (
  item: TickerNewsItem,
  symbol: string,
  companyName?: string,
): number => {
  const text = normalizeNewsText(`${item.headline || ''} ${item.summary || ''}`)
  const normalizedSymbol = normalizeNewsText(symbol)
  let score = 0

  if (normalizedSymbol && text.includes(normalizedSymbol)) {
    score += 6
  }

  const companyTokens = normalizeNewsText(companyName ?? '')
    .split(' ')
    .filter((token) => token.length >= 4 && !COMPANY_STOPWORDS.has(token))

  if (companyTokens.some((token) => text.includes(token))) {
    score += 4
  }

  if (NEWS_CATALYST_KEYWORDS.some((keyword) => text.includes(keyword))) {
    score += 3
  }

  if (NEWS_NOISE_KEYWORDS.some((keyword) => text.includes(keyword))) {
    score -= 3
  }

  if (!normalizedSymbol && !companyTokens.length) {
    score -= 1
  }

  return score
}

const selectRelevantNewsItems = (
  items: TickerNewsItem[],
  symbol: string,
  companyName?: string,
): TickerNewsItem[] => {
  const scored = items.map((item, index) => ({
    item,
    index,
    score: scoreNewsItem(item, symbol, companyName),
  }))

  const keepAtLeast = Math.min(5, scored.length)
  let selected = scored.filter((entry) => entry.score >= 1)

  if (selected.length < keepAtLeast) {
    const ranked = [...scored]
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .filter((entry) => !selected.some((picked) => picked.item.id === entry.item.id))
    selected = selected.concat(ranked.slice(0, keepAtLeast - selected.length))
  }

  if (selected.length > 12) {
    selected = [...selected]
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 12)
  }

  return selected
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item)
}

const buildMarketLead = (
  symbol: string,
  todayOpen: number | null,
  todayHigh: number | null,
  todayLow: number | null,
  todayClose: number | null,
  todayVolume: number | null,
  selectedItem: {
    lastPrice: string
    rangeLabel: string
  } | null,
): string => {
  const clauses: string[] = []

  if (todayOpen != null && todayClose != null) {
    clauses.push(`opened at ${formatPrice(todayOpen)} and closed at ${formatPrice(todayClose)}`)
  } else if (todayOpen != null) {
    clauses.push(`opened at ${formatPrice(todayOpen)}`)
  } else if (todayClose != null) {
    clauses.push(`closed at ${formatPrice(todayClose)}`)
  } else if (selectedItem?.lastPrice) {
    clauses.push(`last traded at ${selectedItem.lastPrice}`)
  }

  const baseForRange = todayOpen ?? todayClose
  if (todayHigh != null && todayLow != null && baseForRange != null && baseForRange > 0) {
    const rangePct = ((todayHigh - todayLow) / baseForRange) * 100
    if (Number.isFinite(rangePct)) {
      clauses.push(`trading in a ${rangePct.toFixed(2)}% intraday range`)
    }
  } else if (selectedItem?.rangeLabel) {
    clauses.push(selectedItem.rangeLabel.replace(/^Day Range(?: placeholder)?[:\s-]*/i, 'daily range '))
  }

  if (todayVolume != null) {
    clauses.push(`on ${formatCompactNumber(todayVolume)} shares`)
  }

  if (!clauses.length) return `${symbol}.`
  return `${symbol} ${clauses.join(', ')}.`
}

const stripLeadingTerminalNumbering = (text: string): string =>
  text.replace(/^\s*(?:\d+[.)]|[-*])\s*/u, '').trim()

const getCurrentEtDate = (): ETDateString =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const getCurrentEtMinutes = (): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

const parseClockMinutes = (value: string): number | null => {
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

const formatTerminalDateLabel = (dateET: ETDateString): string => {
  const parsed = new Date(`${dateET}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return dateET
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
  })
    .format(parsed)
    .toUpperCase()
  return `${dateET}  ${weekday}`
}

const formatTimelineDateHeader = (dateKey: string): string => {
  const parsed = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

const getNewsDateKey = (item: TickerNewsItem): string => {
  const matched = item.publishedAtET.match(/^\d{4}-\d{2}-\d{2}/)
  return matched?.[0] ?? item.dateET
}

const toBriefText = (
  symbol: string,
  item: TickerNewsItem,
  todayOpen: number | null,
  todayClose: number | null,
): string => {
  const headline = (item.headline || '').trim()
  const summary = (item.summary || '').trim()
  const body = [headline, summary].filter(Boolean).join(' ')
  // 09:30 ET -> open, 16:30 ET -> close
  const timeKey = item.timeET || ''
  const isOpen  = timeKey.startsWith('09:30') || timeKey.startsWith('9:30')
  const isClose = timeKey.startsWith('16:30')
  const price = isOpen ? todayOpen : isClose ? todayClose : null
  const priceStr = price != null ? ` $${price.toFixed(2)}` : ''
  const prefix = `${symbol}${priceStr}`
  return body ? `${prefix} ${body}` : prefix
}

export default function CenterPanel({
  selectedSymbol,
  selectedItem,
  dateET,
  timezone,
  timeline = [],
  timelineStatus,
  timelineError,
  selectedNewsId,
  onSelectNews,
  isDetailOpen,
  detailStatus,
  detailError,
  detail,
  onExportNews,
  askQuestionInput,
  onAskQuestionInputChange,
  onAskSubmit,
  askStatus,
  askError,
  askAnswerKo,
  activeSessionId,
  evidenceRows,
  evidenceStatus,
  evidenceError,
  onExportEvidenceToSheet,
  onCloseDetail,
  onRefreshNews,
  isNewsRefreshing,
  newsLastFetchedAt,
  todayOpen,
  todayHigh,
  todayLow,
  todayClose,
  todayVolume,
}: CenterPanelProps) {
  const dateLabel = useMemo(() => formatTerminalDateLabel(dateET), [dateET])
  const marketLead = useMemo(
    () => buildMarketLead(
      selectedSymbol,
      todayOpen,
      todayHigh,
      todayLow,
      todayClose,
      todayVolume,
      selectedItem,
    ),
    [selectedSymbol, todayOpen, todayHigh, todayLow, todayClose, todayVolume, selectedItem],
  )
  const newsMarketContext = useMemo(() => {
    const parts: string[] = []
    if (selectedItem?.lastPrice) parts.push(`${selectedSymbol} ${selectedItem.lastPrice}`)
    if (selectedItem?.changePercent) parts.push(`change ${selectedItem.changePercent}`)
    if (selectedItem?.rangeLabel) parts.push(selectedItem.rangeLabel)
    const joined = parts.filter(Boolean).join(' | ').trim()
    return joined || marketLead
  }, [marketLead, selectedItem, selectedSymbol])
  const currentEtDate = getCurrentEtDate()
  const currentEtMinutes = getCurrentEtMinutes()
  const groupedTimeline = useMemo(() => {
    const grouped = new Map<string, TickerNewsItem[]>()
    timeline
      .filter((item) => {
        if (item.dateET !== dateET) return false
        if (dateET !== currentEtDate) return true
        const itemMinutes = parseClockMinutes(item.timeET)
        if (itemMinutes == null) return true
        return itemMinutes <= currentEtMinutes
      })
      .forEach((item) => {
        const dateKey = getNewsDateKey(item)
        const items = grouped.get(dateKey) ?? []
        items.push(item)
        grouped.set(dateKey, items)
      })
    return Array.from(grouped.entries())
      .map(([dateKey, items]) => ({
        dateKey,
        dateLabel: formatTimelineDateHeader(dateKey),
        items: [...items].sort((a, b) => b.publishedAtET.localeCompare(a.publishedAtET)),
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }, [currentEtDate, currentEtMinutes, dateET, timeline])
  const [langMode, setLangMode] = useState<'EN' | 'KR'>('EN')
  const [synthEN, setSynthEN] = useState<Map<string, string>>(new Map())
  const [synthKO, setSynthKO] = useState<Map<string, string>>(new Map())
  const [isSynthesizingEN, setIsSynthesizingEN] = useState(false)
  const [isSynthesizingKO, setIsSynthesizingKO] = useState(false)
  const synthENRequested = useRef<Set<string>>(new Set())
  const synthKORequested = useRef<Set<string>>(new Set())

  const [exportStatus, setExportStatus] = useState<ExportUiStatus>('idle')
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)

  // ?щ낵 蹂寃????⑹꽦 罹먯떆 珥덇린??
  useEffect(() => {
    setSynthEN(new Map())
    setSynthKO(new Map())
    synthENRequested.current = new Set()
    synthKORequested.current = new Set()
    setLangMode('EN')
    setIsSynthesizingEN(false)
    setIsSynthesizingKO(false)
  }, [selectedSymbol])

  // EN ?먮룞 ?⑹꽦 (?щ낵/?댁뒪 濡쒕뱶 ??
  useEffect(() => {
    const allItems = groupedTimeline.flatMap(g => g.items)
    const pending = allItems.filter(item => !synthENRequested.current.has(item.id))
    if (!pending.length) return
    pending.forEach(item => synthENRequested.current.add(item.id))
    const selectedPending = selectRelevantNewsItems(
      pending,
      selectedSymbol,
      selectedItem?.companyName,
    )
    if (!selectedPending.length) return
    setIsSynthesizingEN(true)
    const run = async () => {
      try {
        const payload = selectedPending.map(item => ({ id: item.id, timeET: item.timeET, headline: item.headline ?? '', summary: item.summary ?? '' }))
        const res = await fetch('/api/terminal/news-synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: selectedSymbol,
            companyName: selectedItem?.companyName ?? '',
            items: payload,
            lang: 'en',
            marketContext: newsMarketContext,
          }),
        })
        if (!res.ok) return
        const data = await res.json() as { results: Array<{ id: string; text: string }> }
        setSynthEN(prev => {
          const next = new Map(prev)
          for (const r of data.results) {
            next.set(r.id, r.text.trim())
          }
          return next
        })
      } catch { /* ignore */ } finally { setIsSynthesizingEN(false) }
    }
    void run()
  }, [groupedTimeline, selectedItem?.companyName, selectedSymbol])

  // KR 踰꾪듉 ?대┃ ???쒓뎅???⑹꽦
  useEffect(() => {
    if (langMode !== 'KR') return
    const allItems = groupedTimeline.flatMap(g => g.items)
    const pending = allItems.filter(item => !synthKORequested.current.has(item.id))
    if (!pending.length) return
    pending.forEach(item => synthKORequested.current.add(item.id))
    const selectedPending = selectRelevantNewsItems(
      pending,
      selectedSymbol,
      selectedItem?.companyName,
    )
    if (!selectedPending.length) return
    setIsSynthesizingKO(true)
    const run = async () => {
      try {
        const payload = selectedPending.map(item => ({ id: item.id, timeET: item.timeET, headline: item.headline ?? '', summary: item.summary ?? '' }))
        const res = await fetch('/api/terminal/news-synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: selectedSymbol,
            companyName: selectedItem?.companyName ?? '',
            items: payload,
            lang: 'ko',
            marketContext: newsMarketContext,
          }),
        })
        if (!res.ok) return
        const data = await res.json() as { results: Array<{ id: string; text: string }> }
        setSynthKO(prev => {
          const next = new Map(prev)
          for (const r of data.results) {
            next.set(r.id, r.text.trim())
          }
          return next
        })
      } catch { /* ignore */ } finally { setIsSynthesizingKO(false) }
    }
    void run()
  }, [langMode, groupedTimeline, selectedItem?.companyName, selectedSymbol])

  useEffect(() => {
    setExportStatus('idle')
    setExportFeedback(null)
  }, [selectedNewsId, detail?.id, isDetailOpen])

  const handleExport = async () => {
    if (!detail || exportStatus === 'submitting') return
    setExportStatus('submitting')
    setExportFeedback(null)
    try {
      await onExportNews(detail.id)
      setExportStatus('success')
      setExportFeedback('Queued for export.')
    } catch {
      setExportStatus('error')
      setExportFeedback('Failed to queue export.')
    }
  }

  return (
    <section className={`${styles.panel} ${styles.centerPanel}`}>
      <header className={styles.panelHeader}>
        <p className={styles.panelLabel}>Portfolio Summary</p>
        <div className={styles.selectedHeaderRow}>
          <h2 className={styles.panelTitle}>{selectedSymbol || '---'} - Daily Brief Workspace</h2>
          <span className={styles.symbolChip}>{dateLabel}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
            {newsLastFetchedAt && (
              <span style={{ fontSize: '0.68rem', color: '#475569' }}>
                {new Intl.DateTimeFormat('en-US', {
                  timeZone: 'America/New_York',
                  hour: '2-digit', minute: '2-digit', hour12: false,
                }).format(newsLastFetchedAt)} ET
              </span>
            )}
            <button
              onClick={() => setLangMode(m => m === 'EN' ? 'KR' : 'EN')}
              title="?쒓뎅???곸뼱 ?꾪솚"
              style={{
                background: langMode === 'KR' ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${langMode === 'KR' ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 6,
                color: langMode === 'KR' ? '#7dd3fc' : '#64748b',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.2rem 0.55rem',
                letterSpacing: '0.05em',
              }}
            >
              {(langMode === 'EN' ? isSynthesizingEN : isSynthesizingKO) ? '...' : langMode}
            </button>
            <button
              onClick={onRefreshNews}
              disabled={isNewsRefreshing}
              title="?댁뒪 ?덈줈怨좎묠"
              style={{
                background: 'rgba(56,189,248,0.08)',
                border: '1px solid rgba(56,189,248,0.25)',
                borderRadius: 6,
                color: isNewsRefreshing ? '#475569' : '#38bdf8',
                cursor: isNewsRefreshing ? 'not-allowed' : 'pointer',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.2rem 0.55rem',
                letterSpacing: '0.04em',
                transition: 'opacity 0.15s',
                opacity: isNewsRefreshing ? 0.5 : 1,
              }}
            >
              {isNewsRefreshing ? '...' : '??Refresh'}
            </button>
          </div>
        </div>
      </header>

      <div className={styles.centerFeed}>
        <div className={styles.stack}>
          <div>
            {timelineStatus === 'loading' && (
              <div className={styles.panelStateBox}>Loading symbol news timeline from real API data...</div>
            )}
            {timelineStatus === 'error' && timelineError && (
              <div className={styles.panelStateBoxError}>{timelineError}</div>
            )}
            {(timelineStatus === 'ready' || timelineStatus === 'empty') && (
              <div className={styles.timelineList}>
                {groupedTimeline.map((group) => (
                  <section key={group.dateKey} className={styles.timelineDateGroup}>
                    <p className={styles.timelineDateHeader}>{group.dateLabel}</p>
                    {group.items.length ? (
                      group.items.map((item) => {
                        const isActive = selectedNewsId === item.id
                        const briefText = [item.headline, item.summary].filter(Boolean).join(' ')
                        const synthText = langMode === 'KR'
                          ? (synthKO.get(item.id) ?? (isSynthesizingKO ? '...' : (synthEN.get(item.id) ?? briefText)))
                          : (synthEN.get(item.id) ?? (isSynthesizingEN ? '...' : briefText))
                        const cleanedSynthText = synthText === '...' ? synthText : stripLeadingTerminalNumbering(synthText)
                        const narrativeText =
                          cleanedSynthText === '...'
                            ? cleanedSynthText
                            : `${marketLead} ${cleanedSynthText}`.trim()
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`${styles.timelineItem} ${isActive ? styles.timelineItemActive : ''}`}
                            onClick={() => onSelectNews(item)}
                          >
                            <div className={styles.timelineTop}>
                              <span className={styles.timelineTime}>{item.timeET}</span>
                              <span className={styles.timelineAction}>Open {'>'}</span>
                            </div>
                            <p className={styles.timelineSummary}>
                              {narrativeText}
                            </p>
                          </button>
                        )
                      })
                    ) : (
                      <div className={styles.panelStateBox}>No 09:30 / 16:30 checkpoint item captured for this date.</div>
                    )}
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className={styles.askPanel}>
        <div className={styles.askBox}>
          <div className={styles.askHeader}>
            <p className={styles.askTitle}>Ask Panel</p>
            <p className={styles.askContext}>
              Research session scope: {selectedSymbol || '---'}, {dateET} ({timezone}), same-day evidence only.
            </p>
          </div>
          <div className={styles.askInputRow}>
            <input
              className={styles.askInput}
              placeholder="Ask a same-day question for the selected symbol..."
              value={askQuestionInput}
              onChange={(e) => onAskQuestionInputChange(e.target.value)}
            />
            <button
              className={styles.askButton}
              type="button"
              onClick={() => void onAskSubmit()}
              disabled={askStatus === 'submitting'}
            >
              {askStatus === 'submitting' ? 'Researching...' : 'Submit'}
            </button>
          </div>

          {askError && (
            <div className={styles.panelStateBoxError}>{askError}</div>
          )}

          {!askError && askStatus === 'ready' && (
            <div className={styles.askAnswerBlock}>
              <p className={styles.askAnswerTitle}>
                Answer (KO) {activeSessionId ? `| Session ${activeSessionId.slice(0, 8)}` : ''}
              </p>
              <p className={styles.askAnswerText}>{askAnswerKo}</p>
            </div>
          )}

          <SourceTable
            sessionId={activeSessionId}
            rows={evidenceRows}
            status={evidenceStatus}
            errorMessage={evidenceError}
            onExportToSheet={onExportEvidenceToSheet}
          />

          <span className={styles.askHint}>
            Source table rows are loaded from internal evidence API and remain independent from sheet export.
          </span>
        </div>
      </footer>

      {isDetailOpen && (
        <div className={styles.detailOverlay} role="dialog" aria-modal="true" aria-label="News detail">
          <div className={styles.detailPanel}>
            <div className={styles.detailHeader}>
              <div>
                <p className={styles.panelLabel}>News Detail</p>
                <h3 className={styles.panelTitle}>Metadata View</h3>
              </div>
              <button type="button" className={styles.ghostButton} onClick={onCloseDetail}>
                Close
              </button>
            </div>

            {detailStatus === 'loading' && (
              <div className={styles.panelStateBox}>Loading selected news metadata...</div>
            )}
            {detailStatus === 'error' && detailError && (
              <div className={styles.panelStateBoxError}>{detailError}</div>
            )}
            {detailStatus === 'ready' && detail && (
              <div className={styles.detailBody}>
                <p className={styles.detailHeadline}>{detail.headline}</p>
                <div className={styles.detailMetaGrid}>
                  <p><strong>Source:</strong> {formatMetadataValue(detail.source)}</p>
                  <p><strong>Published (ET):</strong> {formatMetadataValue(detail.publishedAtET)}</p>
                  <p><strong>Symbol:</strong> {formatMetadataValue(detail.symbol)}</p>
                  <p><strong>Relevance:</strong> {formatMetadataValue(detail.relevanceScore)}</p>
                  <p><strong>Tags:</strong> {detail.tags?.length ? detail.tags.join(', ') : 'N/A'}</p>
                </div>
                <p className={styles.detailSummary}>{detail.summary}</p>
                <div className={styles.detailActions}>
                  {detail.url ? (
                    <a
                      href={detail.url}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.detailLinkButton}
                    >
                      Open Article
                    </a>
                  ) : (
                    <button type="button" className={styles.detailButtonDisabled} disabled>
                      Open Article
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.detailExportButton}
                    onClick={handleExport}
                    disabled={exportStatus === 'submitting'}
                  >
                    {exportStatus === 'submitting' ? 'Exporting...' : 'Export to Sheet'}
                  </button>
                </div>
                {exportFeedback && (
                  <p className={exportStatus === 'success' ? styles.detailExportSuccess : styles.detailExportError}>
                    {exportFeedback}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

