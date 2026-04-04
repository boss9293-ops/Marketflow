import ChartPanel from '@/components/watchlist_mvp/ChartPanel'
import MarketNewsPanel from '@/components/watchlist_mvp/MarketNewsPanel'
import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'
import type { MarketHeadlinesHealth, WatchlistItem } from '@/lib/terminal-mvp/types'

type RightPanelProps = {
  selectedSymbol: string
  selectedItem: WatchlistItem | null
  headlines: Array<{
    id: string
    dateET: string
    publishedAtET: string
    timeET: string
    headline: string
    source: string
    url: string
  }>
  isChartLoading: boolean
  chartError: string | null
  isHeadlinesLoading: boolean
  headlinesError: string | null
  headlinesHealth: MarketHeadlinesHealth | null
}

export default function RightPanel({
  selectedSymbol,
  selectedItem,
  headlines,
  isChartLoading,
  chartError,
  isHeadlinesLoading,
  headlinesError,
  headlinesHealth,
}: RightPanelProps) {
  return (
    <aside className={`${styles.panel} ${styles.rightPanel}`}>
      <ChartPanel
        selectedSymbol={selectedSymbol}
        selectedItem={selectedItem}
        isLoading={isChartLoading}
        errorMessage={chartError}
      />
      <MarketNewsPanel
        headlines={headlines}
        isLoading={isHeadlinesLoading}
        errorMessage={headlinesError}
        health={headlinesHealth}
      />
    </aside>
  )
}
