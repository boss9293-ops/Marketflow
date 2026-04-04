import { useEffect, useMemo, useState } from 'react'

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
}

const formatMetadataValue = (value?: string | number | null): string =>
  value == null || value === '' ? 'N/A' : String(value)

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

const toBriefText = (prefix: string, item: TickerNewsItem): string => {
  const headline = (item.headline || '').trim()
  const summary = (item.summary || '').trim()
  const body = [headline, summary].filter(Boolean).join(' ')
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
}: CenterPanelProps) {
  const dateLabel = useMemo(() => formatTerminalDateLabel(dateET), [dateET])
  const groupedTimeline = useMemo(() => {
    const grouped = new Map<string, TickerNewsItem[]>()
    timeline.forEach((item) => {
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
  }, [dateET, timeline])
  const [exportStatus, setExportStatus] = useState<ExportUiStatus>('idle')
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)

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

  const tickerPrefix = selectedItem ? `${selectedItem.symbol} ${selectedItem.lastPrice}` : selectedSymbol
  const selectedDayItems = useMemo(() => {
    const selected = groupedTimeline.find((group) => group.dateKey === dateET)
    return selected?.items ?? []
  }, [dateET, groupedTimeline])

  return (
    <section className={`${styles.panel} ${styles.centerPanel}`}>
      <header className={styles.panelHeader}>
        <p className={styles.panelLabel}>Portfolio Summary</p>
        <div className={styles.selectedHeaderRow}>
          <h2 className={styles.panelTitle}>{selectedSymbol || '---'} - Daily Brief Workspace</h2>
          <span className={styles.symbolChip}>{dateLabel}</span>
        </div>
      </header>

      <div className={styles.centerFeed}>
        <div className={styles.stack}>
          <div>
            <div className={styles.dailyDateBoundary}>
              <p className={styles.timelineDateHeader}>{formatTimelineDateHeader(dateET)}</p>
            </div>
            {selectedDayItems.length ? (
              selectedDayItems.map((item) => {
                const briefText = toBriefText(tickerPrefix, item)
                return (
                  <article key={`daily-${item.id}`} className={styles.briefCard}>
                    <p className={styles.briefTime}>{item.timeET}</p>
                    <p className={styles.timelineSummary}>{briefText}</p>
                  </article>
                )
              })
            ) : (
              <div className={styles.panelStateBox}>No 09:30 / 16:00 checkpoint item captured for this date.</div>
            )}
          </div>

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
                        const briefText = toBriefText(tickerPrefix, item)
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
                            <p className={styles.timelineSummary}>{briefText}</p>
                          </button>
                        )
                      })
                    ) : (
                      <div className={styles.panelStateBox}>No 09:30 / 16:00 checkpoint item captured for this date.</div>
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
