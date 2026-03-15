export type StockProfile = {
  symbol: string
  name: string
  exchange: string
  sector: string
  industry?: string
  description?: string
}

export const stockProfiles: Record<string, StockProfile> = {
  AAPL: {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    description: 'Global consumer hardware + services ecosystem leader.',
  },
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    exchange: 'NASDAQ',
    sector: 'Consumer Cyclical',
    industry: 'Auto Manufacturers',
    description: 'EV leader with software-driven margin structure.',
  },
  NVDA: {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Semiconductors',
    description: 'AI compute platform leader across data center + edge.',
  },
}
