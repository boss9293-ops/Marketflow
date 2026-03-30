import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'
import type { Watchlist, WatchlistItem } from '@/lib/terminal-mvp/types'

type LeftPanelProps = {
  items: WatchlistItem[]
  watchlists: Watchlist[]
  selectedWatchlistId: string | null
  selectedSymbol: string
  onSelectSymbol: (symbol: string) => void
  isLoading: boolean
  errorMessage: string | null
  isEmpty: boolean
}

export default function LeftPanel({
  items,
  watchlists,
  selectedWatchlistId,
  selectedSymbol,
  onSelectSymbol,
  isLoading,
  errorMessage,
  isEmpty,
}: LeftPanelProps) {
  const selectedWatchlist =
    watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? watchlists[0] ?? null
  const groupLabel = (selectedWatchlist?.name ?? 'Default Watchlist').toUpperCase()

  return (
    <aside className={`${styles.panel} ${styles.leftPanel}`}>
      <header className={styles.leftHeader}>
        <p className={styles.panelLabel}>My Watchlist</p>
        <div className={styles.leftHeaderRow}>
          <h2 className={styles.panelTitle}>Watchlist</h2>
          <div className={styles.leftHeaderActions}>
            <button type="button" className={styles.ghostButton}>
              + Add Group
            </button>
            <button type="button" className={styles.ghostButton}>
              Edit
            </button>
          </div>
        </div>
      </header>

      <section className={styles.watchlistGroup}>
        <header className={styles.watchlistGroupHeader}>
          <span>{`${groupLabel} (${items.length})`}</span>
        </header>

        {isLoading && <div className={styles.panelStateBox}>Loading watchlist...</div>}

        {!isLoading && errorMessage && <div className={styles.panelStateBoxError}>{errorMessage}</div>}

        {!isLoading && !errorMessage && isEmpty && (
          <div className={styles.panelStateBox}>No watchlist items available for this view.</div>
        )}

        {!isLoading &&
          !errorMessage &&
          !isEmpty &&
          items.map((item) => {
            const isSelected = item.symbol === selectedSymbol
            const isDown = item.changePercent.trim().startsWith('-')

            return (
              <button
                key={item.symbol}
                type="button"
                className={`${styles.watchItemRow} ${isSelected ? styles.watchItemRowSelected : ''}`}
                aria-selected={isSelected}
                onClick={() => onSelectSymbol(item.symbol)}
              >
                <div className={styles.watchItemMain}>
                  <div className={styles.watchItemTopRow}>
                    <p className={styles.watchSymbol}>{item.symbol}</p>
                    <span className={isDown ? styles.watchMoveDown : styles.watchMoveUp}>
                      {item.changePercent}
                    </span>
                  </div>
                  <p className={styles.watchName}>{item.companyName}</p>
                </div>
              </button>
            )
          })}
      </section>

      <footer className={styles.addTickerArea}>
        <p className={styles.addTickerLabel}>Add Ticker</p>
        <div className={styles.addTickerRow}>
          <input className={styles.addTickerInput} placeholder="Enter symbol (e.g., MSFT)" readOnly />
          <button type="button" className={styles.addTickerButton}>
            Add
          </button>
        </div>
      </footer>
    </aside>
  )
}
