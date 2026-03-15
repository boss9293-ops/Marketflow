export interface StrategyInputs {
  symbol: string
  startDate: string
  initialCapital: number
  rebalanceDays: number
  growthRate: number
  fixedAdd: number
  upperMult: number
  lowerMult: number
  initialGValue: number
  gAnnualIncrement: number
  periodsPerYear: number
  minimumOrderCash: number
  initialBuyPercent: number
  targetCapMultiple: number
  allowFractionalShares: boolean
}

export interface DailyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type TradeAction = 'INIT_BUY' | 'BUY' | 'SELL'

export interface PortfolioState {
  date: string
  close: number
  cash: number
  shares: number
  marketValue: number
  portfolioValue: number
  avgCost: number
  totalDays: number
  currentPeriod: number
  currentGValue: number
  targetValue: number
  upperBand: number
  lowerBand: number
  pvRatio: number
  realizedPnl: number
  unrealizedPnl: number
  totalReturnPct: number
}

export interface TradeEvent {
  id: string
  date: string
  action: TradeAction
  price: number
  orderAmount: number
  quantity: number
  cashAfterTrade: number
  sharesAfterTrade: number
  avgCostAfterTrade: number
  portfolioValueAfterTrade: number
  targetValue: number
  upperBand: number
  lowerBand: number
  pvRatio: number
  realizedPnl: number
  reason: string
}

export interface BacktestRow extends PortfolioState {
  action: TradeAction | null
  reason: string | null
  orderAmount: number
  buyAmount: number
  sellAmount: number
  tradeQty: number
  buySignal: boolean
  sellSignal: boolean
}

export interface BacktestSummary {
  symbol: string
  startDate: string | null
  endDate: string | null
  totalBars: number
  eligibleBars: number
  tradeCount: number
  initialized: boolean
}

export interface PerformanceMetrics {
  symbol: string
  finalPortfolioValue: number
  totalReturnPct: number
  realizedPnl: number
  unrealizedPnl: number
  maxDrawdownPct: number
  buyTrades: number
  sellTrades: number
  cashBalance: number
  currentShares: number
  currentAvgCost: number
  currentTargetValue: number
  currentUpperBand: number
  currentLowerBand: number
  currentPvRatio: number
  elapsedDays: number
  elapsedYears: number
  currentGValue: number
}

export interface ValidationIssue {
  field: keyof StrategyInputs | 'bars'
  message: string
}

export interface BacktestResult {
  symbol: string
  inputs: StrategyInputs
  rows: BacktestRow[]
  trades: TradeEvent[]
  summary: BacktestSummary
  validationIssues: ValidationIssue[]
}

export interface EngineTradeRequest {
  action: TradeAction
  amount?: number
  quantity?: number
  reason: string
}

export interface EngineStepContext {
  bar: DailyBar
  index: number
  inputs: StrategyInputs
  state: PortfolioState
  previousRow: BacktestRow | null
}

export interface EngineStepResult {
  statePatch?: Partial<PortfolioState>
  trade?: EngineTradeRequest | null
}

export interface BacktestEngineHooks {
  onStart?: (context: EngineStepContext) => EngineStepResult | void
  onBar?: (context: EngineStepContext) => EngineStepResult | void
}
