export type MockSentiment = {
  symbol: string
  analystConsensus: string
  targetPrice: number
  buyHoldSell: { buy: number; hold: number; sell: number }
  newsSentiment: 'Bullish' | 'Bearish' | 'Neutral'
  newsScore: number
  socialSentiment: string
  searchTrend: string
  keyTopics: string[]
  aiSummary: string
  premiumNotes?: string[]
  recentNews: { title: string; publishedDate: string; sentiment: string }[]
}

export const mockSentiment: Record<string, MockSentiment> = {
  AAPL: {
    symbol: 'AAPL',
    analystConsensus: 'Moderate Buy',
    targetPrice: 205,
    buyHoldSell: { buy: 28, hold: 12, sell: 3 },
    newsSentiment: 'Bullish',
    newsScore: 0.42,
    socialSentiment: 'Positive',
    searchTrend: 'Rising',
    keyTopics: ['AI iPhone', 'Services growth', 'Buybacks'],
    aiSummary:
      'News flow remains constructive with focus on AI‑driven upgrades and resilient services revenue. Social sentiment is mildly positive, and analyst targets imply mid‑teens upside.',
    premiumNotes: ['Institutional positioning remains supportive', 'Options skew tilted to calls'],
    recentNews: [
      { title: 'Apple rumored to refresh iPhone AI features in 2026', publishedDate: '2026-03-05', sentiment: 'positive' },
      { title: 'Services revenue expected to set new record', publishedDate: '2026-03-03', sentiment: 'positive' },
      { title: 'EU antitrust headline keeps regulatory risk in focus', publishedDate: '2026-02-28', sentiment: 'neutral' },
    ],
  },
  TSLA: {
    symbol: 'TSLA',
    analystConsensus: 'Hold',
    targetPrice: 210,
    buyHoldSell: { buy: 18, hold: 20, sell: 9 },
    newsSentiment: 'Neutral',
    newsScore: 0.05,
    socialSentiment: 'Mixed',
    searchTrend: 'Stable',
    keyTopics: ['Price cuts', 'Margins', 'Energy storage'],
    aiSummary:
      'Sentiment is mixed as pricing actions weigh on margins while energy storage growth offsets some concerns. Analyst targets sit close to spot, implying limited near‑term upside.',
    premiumNotes: ['Hedge fund exposure reduced in last 4 weeks', 'Retail sentiment diverging'],
    recentNews: [
      { title: 'Tesla adjusts pricing across key models', publishedDate: '2026-03-04', sentiment: 'neutral' },
      { title: 'Energy storage deployments hit record quarter', publishedDate: '2026-03-01', sentiment: 'positive' },
      { title: 'China sales data show softening demand', publishedDate: '2026-02-27', sentiment: 'negative' },
    ],
  },
  NVDA: {
    symbol: 'NVDA',
    analystConsensus: 'Strong Buy',
    targetPrice: 980,
    buyHoldSell: { buy: 42, hold: 6, sell: 1 },
    newsSentiment: 'Bullish',
    newsScore: 0.62,
    socialSentiment: 'Very Positive',
    searchTrend: 'Surging',
    keyTopics: ['AI datacenter', 'GPU supply', 'Enterprise demand'],
    aiSummary:
      'Sentiment remains strongly positive with AI datacenter demand still accelerating. Most analysts maintain high targets, supporting a bullish tone.',
    premiumNotes: ['Buy‑side conviction elevated', 'AI capex momentum still accelerating'],
    recentNews: [
      { title: 'NVIDIA raises datacenter GPU production targets', publishedDate: '2026-03-06', sentiment: 'positive' },
      { title: 'Cloud providers expand multi‑year AI capex plans', publishedDate: '2026-03-02', sentiment: 'positive' },
      { title: 'Semiconductor supply chain tightness persists', publishedDate: '2026-02-26', sentiment: 'neutral' },
    ],
  },
}
