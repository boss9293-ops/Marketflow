import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'

type MarketNewsPanelProps = {
  headlines: Array<{
    id: string
    timeET: string
    headline: string
    source: string
  }>
  isLoading: boolean
  errorMessage: string | null
}

const formatEtDateLabel = (): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

export default function MarketNewsPanel({
  headlines,
  isLoading,
  errorMessage,
}: MarketNewsPanelProps) {
  const dateLabel = formatEtDateLabel()

  return (
    <article className={styles.marketPanel}>
      <p className={styles.panelLabel}>Market Live</p>

      {isLoading && (
        <div className={styles.panelStateBox}>
          Loading market headline metadata...
        </div>
      )}

      {!isLoading && errorMessage && (
        <div className={styles.panelStateBoxError}>
          {errorMessage}
        </div>
      )}

      {!isLoading && !errorMessage && !headlines.length && (
        <div className={styles.panelStateBox}>
          No market headlines available for this ET date.
        </div>
      )}

      {!isLoading && !errorMessage && !!headlines.length && (
        <div className={styles.stack}>
          <p className={styles.timelineDateHeader}>{dateLabel}</p>
          {headlines.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.headlineCard} ${index === 0 ? styles.breakingHeadlineCard : ''}`}
            >
              <div className={styles.headlineTop}>
                <p className={index === 0 ? styles.breakingHeadlineTime : styles.headlineTime}>{item.timeET}</p>
                <span className={styles.headlineAction}>Open {'>'}</span>
              </div>
              <p className={styles.headlineText}>{item.headline}</p>
              <p className={styles.headlineSource}>Source: {item.source}</p>
            </button>
          ))}
        </div>
      )}
    </article>
  )
}
