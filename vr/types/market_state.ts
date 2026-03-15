export type MA200Relation = 'above' | 'test' | 'breach' | 'sustained_below'
export type VolatilityRegime = 'low' | 'moderate' | 'elevated' | 'extreme'
export type PriceStructure =
  | 'trend_down'
  | 'slow_bleed'
  | 'vertical_drop'
  | 'range_market'
  | 'sideways'
  | 'countertrend_rally'
  | 'breakdown_retest'
export type EventDependency =
  | 'none'
  | 'macro_rotation'
  | 'macro_uncertainty'
  | 'geopolitical_headline'
  | 'liquidity_shock'
  | 'volatility_spike'
  | 'sentiment_reversal'
export type ReboundBehavior = 'none' | 'weak' | 'mixed' | 'strong' | 'failed'
export type TrendPersistence = 'stable' | 'weakening' | 'persistent_down' | 'persistent_range'

export type PriceBar = {
  date: string
  close: number
  sma50?: number | null
  sma200?: number | null
  atr14?: number | null
}

export type VolBar = {
  date: string
  value: number
}

export type MarketState = {
  as_of_date: string
  nasdaq_drawdown: number
  tqqq_drawdown: number
  duration_days: number
  ma200_relation: MA200Relation
  volatility_regime: VolatilityRegime
  price_structure: PriceStructure
  event_dependency: EventDependency
  rebound_behavior: ReboundBehavior
  trend_persistence: TrendPersistence
}
