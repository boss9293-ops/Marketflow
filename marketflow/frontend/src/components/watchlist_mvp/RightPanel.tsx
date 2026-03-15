import ChartPanel from '@/components/watchlist_mvp/ChartPanel'
import MarketNewsPanel from '@/components/watchlist_mvp/MarketNewsPanel'
import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'

type RightPanelProps = {
  selectedSymbol: string
  selectedItem: {
    symbol: string
    lastPrice: string
    changePercent: string
    rangeLabel: string
  } | null
  headlines: Array<{
    id: string
    timeET: string
    headline: string
    source: string
  }>
  isChartLoading: boolean
  chartError: string | null
  isHeadlinesLoading: boolean
  headlinesError: string | null
}

export default function RightPanel({
  selectedSymbol,
  selectedItem,
  headlines,
  isChartLoading,
  chartError,
  isHeadlinesLoading,
  headlinesError,
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
      />
    </aside>
  )
}
