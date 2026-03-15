export type EventInitialState = {
  initial_capital: number
  stock_allocation_pct: number
  pool_allocation_pct: number
  start_price: number
  initial_share_count: number
  initial_average_price: number
  initial_stock_cost: number
  initial_pool_cash: number
}

export type SimulationStartOption = {
  date: string
  start_price: number
  price_source: 'real_tqqq' | 'synthetic_tqqq_3x'
}

export type EventCycleStartScenario = {
  event_id: string
  ticker: 'TQQQ'
  event_start_date: string
  event_end_date: string
  simulation_start_date: string
  default_warmup_trading_days: number
  requested_warmup_trading_days: number
  initial_state: EventInitialState
  available_start_options: SimulationStartOption[]
}
