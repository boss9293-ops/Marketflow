import { Fragment } from 'react'

import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'
import type { MarketHeadlinesHealth } from '@/lib/terminal-mvp/types'

type MarketNewsPanelProps = {
  headlines: Array<{
    id: string
    dateET: string
    publishedAtET: string
    timeET: string
    headline: string
    source: string
    url: string
  }>
  isLoading: boolean
  errorMessage: string | null
  health: MarketHeadlinesHealth | null
}

const formatEtDateLabel = (dateET: string): string => {
  const parsed = new Date(`${dateET}T12:00:00-05:00`)
  if (Number.isNaN(parsed.valueOf())) return dateET
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

const getHeadlineEpoch = (item: MarketNewsPanelProps['headlines'][number]): number => {
  const ts = Date.parse(item.publishedAtET || '')
  if (Number.isFinite(ts)) return ts
  const fallbackTs = Date.parse(`${item.dateET}T00:00:00-05:00`)
  return Number.isFinite(fallbackTs) ? fallbackTs : 0
}

const sortHeadlines = (rows: MarketNewsPanelProps['headlines']) =>
  [...rows].sort((a, b) => getHeadlineEpoch(b) - getHeadlineEpoch(a))

const statusLabelMap: Record<NonNullable<MarketNewsPanelProps['health']>['status'], string> = {
  ok: 'LIVE',
  degraded: 'DEGRADED',
  down: 'DOWN',
}

const getStatusClassName = (
  status: NonNullable<MarketNewsPanelProps['health']>['status'] | undefined,
): string => {
  if (status === 'ok') return styles.feedHealthBadgeOk
  if (status === 'degraded') return styles.feedHealthBadgeDegraded
  return styles.feedHealthBadgeDown
}

export default function MarketNewsPanel({
  headlines,
  isLoading,
  errorMessage,
  health,
}: MarketNewsPanelProps) {
  const feed = sortHeadlines(headlines)

  return (
    <article className={styles.marketPanel}>
      <p className={styles.panelLabel}>Portal Headlines</p>
      <p className={styles.panelSubtle}>Real-time feed | cumulative cache | headline/source/time/url only</p>
      {!isLoading && (
        <div className={styles.feedHealthRow}>
          <span className={`${styles.feedHealthBadge} ${getStatusClassName(health?.status)}`}>
            {health ? statusLabelMap[health.status] : 'UNKNOWN'}
          </span>
          <span className={styles.feedHealthMeta}>{health?.message || 'No health telemetry yet.'}</span>
        </div>
      )}
      {!isLoading && !!health?.sources?.length && (
        <p className={styles.feedHealthSources}>
          {health.sources
            .map((source) => `${source.name.toUpperCase()} ${source.status}${source.items ? `(${source.items})` : ''}`)
            .join(' | ')}
        </p>
      )}

      {isLoading && (
        <div className={styles.panelStateBox}>
          Loading portal headlines...
        </div>
      )}

      {!isLoading && errorMessage && (
        <div className={styles.panelStateBoxError}>
          {errorMessage}
        </div>
      )}

      {!isLoading && !errorMessage && !headlines.length && (
        <div className={styles.panelStateBox}>
          No portal headlines available for this ET date.
        </div>
      )}

      {!isLoading && !errorMessage && !!feed.length && (
        <div className={styles.stack}>
          {feed.map((item, index) => (
            <Fragment key={item.id}>
              {(index === 0 || feed[index - 1]?.dateET !== item.dateET) && (
                <p className={styles.timelineDateHeader}>{formatEtDateLabel(item.dateET)}</p>
              )}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.headlineCard} ${index === 0 ? styles.breakingHeadlineCard : ''}`}
              >
                <div className={styles.headlineTop}>
                  <p className={index === 0 ? styles.breakingHeadlineTime : styles.headlineTime}>{item.timeET}</p>
                  <span className={styles.headlineAction}>Open {'>'}</span>
                </div>
                <p className={styles.headlineText}>{item.headline}</p>
                <p className={styles.headlineSource}>Source: {item.source}</p>
              </a>
            </Fragment>
          ))}
        </div>
      )}
    </article>
  )
}
