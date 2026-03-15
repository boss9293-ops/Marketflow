export type MockEarningsQuarter = {
  date: string
  quarter: string
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  surprisePercent: number | null
}

export type MockEarnings = {
  symbol: string
  nextEarningsDate: string
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  surprisePercent: number | null
  quarters: MockEarningsQuarter[]
  beatRate: number
  avgSurprisePercent: number
  trend: 'positive' | 'mixed' | 'negative' | 'unknown'
  aiInsight: string
}

export const mockEarnings: Record<string, MockEarnings> = {
  AAPL: {
    symbol: 'AAPL',
    nextEarningsDate: '2026-04-30',
    epsEstimate: 2.08,
    epsActual: 2.15,
    revenueEstimate: 118000000000,
    revenueActual: 120400000000,
    surprisePercent: 3.3,
    quarters: [
      { date: '2026-01-30', quarter: 'Q1', epsEstimate: 2.05, epsActual: 2.12, revenueEstimate: 116000000000, revenueActual: 118800000000, surprisePercent: 3.4 },
      { date: '2025-10-30', quarter: 'Q4', epsEstimate: 1.84, epsActual: 1.95, revenueEstimate: 96500000000, revenueActual: 98900000000, surprisePercent: 6.0 },
      { date: '2025-08-01', quarter: 'Q3', epsEstimate: 1.32, epsActual: 1.39, revenueEstimate: 82600000000, revenueActual: 84100000000, surprisePercent: 5.3 },
      { date: '2025-05-02', quarter: 'Q2', epsEstimate: 1.52, epsActual: 1.58, revenueEstimate: 94500000000, revenueActual: 95800000000, surprisePercent: 4.0 },
      { date: '2025-02-01', quarter: 'Q1', epsEstimate: 1.92, epsActual: 2.00, revenueEstimate: 111000000000, revenueActual: 113500000000, surprisePercent: 4.2 },
      { date: '2024-10-31', quarter: 'Q4', epsEstimate: 1.70, epsActual: 1.78, revenueEstimate: 89000000000, revenueActual: 91200000000, surprisePercent: 4.7 },
      { date: '2024-08-01', quarter: 'Q3', epsEstimate: 1.24, epsActual: 1.30, revenueEstimate: 80600000000, revenueActual: 81900000000, surprisePercent: 4.8 },
      { date: '2024-05-02', quarter: 'Q2', epsEstimate: 1.45, epsActual: 1.50, revenueEstimate: 92900000000, revenueActual: 93800000000, surprisePercent: 3.4 },
    ],
    beatRate: 0.75,
    avgSurprisePercent: 4.1,
    trend: 'positive',
    aiInsight:
      'AAPL beat EPS estimates in 6 of the last 8 quarters, with an average surprise of 4.1%. Earnings momentum remains positive with steady revenue beats.',
  },
  TSLA: {
    symbol: 'TSLA',
    nextEarningsDate: '2026-04-23',
    epsEstimate: 0.62,
    epsActual: 0.58,
    revenueEstimate: 26800000000,
    revenueActual: 26200000000,
    surprisePercent: -6.5,
    quarters: [
      { date: '2026-01-22', quarter: 'Q4', epsEstimate: 0.65, epsActual: 0.60, revenueEstimate: 27900000000, revenueActual: 27100000000, surprisePercent: -7.7 },
      { date: '2025-10-23', quarter: 'Q3', epsEstimate: 0.70, epsActual: 0.66, revenueEstimate: 28400000000, revenueActual: 27800000000, surprisePercent: -5.7 },
      { date: '2025-07-24', quarter: 'Q2', epsEstimate: 0.75, epsActual: 0.73, revenueEstimate: 29500000000, revenueActual: 28900000000, surprisePercent: -2.7 },
      { date: '2025-04-23', quarter: 'Q1', epsEstimate: 0.82, epsActual: 0.85, revenueEstimate: 30100000000, revenueActual: 30500000000, surprisePercent: 3.6 },
      { date: '2025-01-29', quarter: 'Q4', epsEstimate: 0.88, epsActual: 0.86, revenueEstimate: 31200000000, revenueActual: 30900000000, surprisePercent: -2.3 },
      { date: '2024-10-23', quarter: 'Q3', epsEstimate: 0.90, epsActual: 0.92, revenueEstimate: 32000000000, revenueActual: 32200000000, surprisePercent: 2.2 },
      { date: '2024-07-23', quarter: 'Q2', epsEstimate: 0.95, epsActual: 0.98, revenueEstimate: 33100000000, revenueActual: 33500000000, surprisePercent: 3.2 },
      { date: '2024-04-23', quarter: 'Q1', epsEstimate: 1.02, epsActual: 0.97, revenueEstimate: 34000000000, revenueActual: 33200000000, surprisePercent: -4.9 },
    ],
    beatRate: 0.38,
    avgSurprisePercent: -2.0,
    trend: 'mixed',
    aiInsight:
      'TSLA has delivered mixed results with a recent run of modest EPS misses. Revenue beats remain uneven, keeping earnings momentum neutral to slightly negative.',
  },
  NVDA: {
    symbol: 'NVDA',
    nextEarningsDate: '2026-05-21',
    epsEstimate: 5.20,
    epsActual: 5.60,
    revenueEstimate: 31700000000,
    revenueActual: 33500000000,
    surprisePercent: 7.7,
    quarters: [
      { date: '2026-02-20', quarter: 'Q4', epsEstimate: 5.10, epsActual: 5.55, revenueEstimate: 30500000000, revenueActual: 32900000000, surprisePercent: 8.8 },
      { date: '2025-11-20', quarter: 'Q3', epsEstimate: 4.60, epsActual: 4.95, revenueEstimate: 28000000000, revenueActual: 29900000000, surprisePercent: 7.6 },
      { date: '2025-08-21', quarter: 'Q2', epsEstimate: 4.05, epsActual: 4.44, revenueEstimate: 25500000000, revenueActual: 27300000000, surprisePercent: 9.6 },
      { date: '2025-05-22', quarter: 'Q1', epsEstimate: 3.40, epsActual: 3.76, revenueEstimate: 22900000000, revenueActual: 24600000000, surprisePercent: 10.6 },
      { date: '2025-02-21', quarter: 'Q4', epsEstimate: 2.60, epsActual: 2.95, revenueEstimate: 18500000000, revenueActual: 20400000000, surprisePercent: 13.5 },
      { date: '2024-11-21', quarter: 'Q3', epsEstimate: 2.20, epsActual: 2.48, revenueEstimate: 16200000000, revenueActual: 17800000000, surprisePercent: 12.7 },
      { date: '2024-08-22', quarter: 'Q2', epsEstimate: 1.70, epsActual: 1.97, revenueEstimate: 13500000000, revenueActual: 15100000000, surprisePercent: 15.9 },
      { date: '2024-05-23', quarter: 'Q1', epsEstimate: 1.30, epsActual: 1.50, revenueEstimate: 11800000000, revenueActual: 13100000000, surprisePercent: 15.4 },
    ],
    beatRate: 1.0,
    avgSurprisePercent: 11.5,
    trend: 'positive',
    aiInsight:
      'NVDA continues to post outsized beats with double‑digit surprise rates. Earnings momentum remains decisively positive as AI demand drives revenue growth.',
  },
}
