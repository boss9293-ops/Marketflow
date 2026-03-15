export interface LocalVrDataSource {
  symbol: string
  label: string
  color: string
  relativePath: string[]
}

export const LOCAL_VR_DATA_SOURCES: LocalVrDataSource[] = [
  {
    symbol: 'TQQQ',
    label: 'ProShares UltraPro QQQ',
    color: '#f59e0b',
    relativePath: ['..', 'data', 'tqqq_history.csv'],
  },
  {
    symbol: 'QQQ',
    label: 'Invesco QQQ Trust',
    color: '#38bdf8',
    relativePath: ['..', 'data', 'qqq_history.csv'],
  },
  {
    symbol: 'SPY',
    label: 'SPDR S&P 500 ETF Trust',
    color: '#22c55e',
    relativePath: ['..', '..', 'marketflow_data', 'prices', 'raw_csv', 'spy.us.csv'],
  },
]

export const DEFAULT_VR_SYMBOL = 'TQQQ'

