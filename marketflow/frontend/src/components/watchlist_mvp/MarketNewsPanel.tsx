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

const MAX_HEADLINES_PER_DAY = 5

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
  const latestDate = feed[0]?.dateET ?? null
  const visibleFeed = latestDate
    ? feed.filter((item) => item.dateET === latestDate).slice(0, MAX_HEADLINES_PER_DAY)
    : feed.slice(0, MAX_HEADLINES_PER_DAY)
  const dateLabel = latestDate ? formatEtDateLabel(latestDate) : 'Latest ET day'

  return (
    <article className={styles.marketPanel}>
      <p className={styles.panelLabel}>Daily Headlines</p>
      <p className={styles.panelSubtle}>One ET day for now | headline, source, time, and links only</p>
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
          No headlines available for the current ET day yet.
        </div>
      )}

      {!isLoading && !errorMessage && !!visibleFeed.length && (
        <div className={styles.stack}>
          <p className={styles.timelineDateHeader}>{dateLabel}</p>
          {visibleFeed.map((item, index) => (
            <a
              key={item.id}
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
          ))}
        </div>
      )}
    </article>
  )
}
