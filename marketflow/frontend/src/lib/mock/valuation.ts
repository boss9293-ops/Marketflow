export type MockScenario = {
  priceTarget: number
  pe: number
  epsNext: number
  growthPct: number
}

export type MockValuation = {
  symbol: string
  currentPrice: number
  marketCap: number
  pe: number
  forwardPE: number
  peg: number
  evSales: number
  evEbitda: number
  fcfYield: number
  sectorPE: number
  sectorPEG: number
  avg5yPE: number
  avg5yEVSales: number
  fairValue: number
  upsidePct: number
  bearCase: MockScenario
  baseCase: MockScenario
  bullCase: MockScenario
  peerComparison: { symbol: string; pe: number; forwardPE: number; evEbitda: number }[]
  epsGrowth3y: number
  revenueGrowth3y: number
  fcfGrowth3y: number
  aiSummary: string
}

export const mockValuation: Record<string, MockValuation> = {
  AAPL: {
    symbol: 'AAPL',
    currentPrice: 182.4,
    marketCap: 2850000000000,
    pe: 27.1,
    forwardPE: 25.3,
    peg: 1.9,
    evSales: 7.1,
    evEbitda: 19.4,
    fcfYield: 0.036,
    sectorPE: 25.8,
    sectorPEG: 1.8,
    avg5yPE: 25.0,
    avg5yEVSales: 6.4,
    fairValue: 212,
    upsidePct: 0.162,
    bearCase: { priceTarget: 180, pe: 20, epsNext: 9.1, growthPct: 5 },
    baseCase: { priceTarget: 212, pe: 24, epsNext: 8.8, growthPct: 10 },
    bullCase: { priceTarget: 245, pe: 28, epsNext: 8.8, growthPct: 18 },
    peerComparison: [
      { symbol: 'MSFT', pe: 31.2, forwardPE: 29.1, evEbitda: 22.8 },
      { symbol: 'GOOGL', pe: 24.4, forwardPE: 22.7, evEbitda: 15.9 },
      { symbol: 'META', pe: 25.7, forwardPE: 22.8, evEbitda: 18.1 },
    ],
    epsGrowth3y: 0.09,
    revenueGrowth3y: 0.07,
    fcfGrowth3y: 0.08,
    aiSummary:
      'Apple trades around 27x forward earnings, slightly above its 5-year average. With high-quality cash flows and mid‑single‑digit revenue growth, fair value clusters near $210, leaving mid‑teens upside in the base case.',
  },
  TSLA: {
    symbol: 'TSLA',
    currentPrice: 192.7,
    marketCap: 615000000000,
    pe: 55.2,
    forwardPE: 42.3,
    peg: 2.3,
    evSales: 5.3,
    evEbitda: 26.8,
    fcfYield: 0.018,
    sectorPE: 23.4,
    sectorPEG: 1.6,
    avg5yPE: 78.0,
    avg5yEVSales: 7.2,
    fairValue: 205,
    upsidePct: 0.064,
    bearCase: { priceTarget: 150, pe: 25, epsNext: 6.0, growthPct: 5 },
    baseCase: { priceTarget: 205, pe: 32, epsNext: 6.4, growthPct: 10 },
    bullCase: { priceTarget: 265, pe: 38, epsNext: 7.0, growthPct: 18 },
    peerComparison: [
      { symbol: 'F', pe: 8.1, forwardPE: 7.5, evEbitda: 6.2 },
      { symbol: 'GM', pe: 5.9, forwardPE: 5.5, evEbitda: 5.1 },
      { symbol: 'BYDDF', pe: 24.1, forwardPE: 22.0, evEbitda: 13.8 },
    ],
    epsGrowth3y: 0.11,
    revenueGrowth3y: 0.14,
    fcfGrowth3y: 0.09,
    aiSummary:
      'Tesla’s valuation reflects a premium growth narrative. Base‑case upside is modest unless margin expansion re‑accelerates. Bull case assumes multiple expansion tied to AI‑driven software revenue.',
  },
  NVDA: {
    symbol: 'NVDA',
    currentPrice: 875,
    marketCap: 2160000000000,
    pe: 58.7,
    forwardPE: 39.5,
    peg: 1.6,
    evSales: 19.2,
    evEbitda: 31.4,
    fcfYield: 0.026,
    sectorPE: 30.2,
    sectorPEG: 2.0,
    avg5yPE: 45.5,
    avg5yEVSales: 12.8,
    fairValue: 940,
    upsidePct: 0.075,
    bearCase: { priceTarget: 720, pe: 28, epsNext: 25.7, growthPct: 6 },
    baseCase: { priceTarget: 940, pe: 32, epsNext: 29.4, growthPct: 12 },
    bullCase: { priceTarget: 1180, pe: 38, epsNext: 31.0, growthPct: 20 },
    peerComparison: [
      { symbol: 'AMD', pe: 45.1, forwardPE: 32.4, evEbitda: 19.3 },
      { symbol: 'AVGO', pe: 29.8, forwardPE: 27.5, evEbitda: 19.8 },
      { symbol: 'INTC', pe: 16.4, forwardPE: 15.2, evEbitda: 10.7 },
    ],
    epsGrowth3y: 0.22,
    revenueGrowth3y: 0.26,
    fcfGrowth3y: 0.21,
    aiSummary:
      'NVIDIA remains a high‑growth compounder with premium multiples. Fair value skews higher if AI datacenter demand stays strong through the next cycle.',
  },
}
