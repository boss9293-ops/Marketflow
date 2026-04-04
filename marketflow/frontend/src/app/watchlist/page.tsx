import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'
import AppShell from '@/components/watchlist_mvp/AppShell'

export default function WatchlistPage() {
  return (
    <div className={`${styles.terminalPageScope} ${styles.terminalTheme}`}>
      <AppShell />
    </div>
  )
}
