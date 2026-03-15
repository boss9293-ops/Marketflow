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

export type EventCyclePlaceholders = {
  vref: number | null
  vmin: number | null
  vmax: number | null
  cycle_no: number | null
  cycle_start_date: string | null
  cycle_end_date: string | null
}

export type EventInitialStateOverrides = {
  initial_capital?: number
  stock_allocation_pct?: number
  pool_allocation_pct?: number
  simulation_start_date?: string
  start_price_override?: number
  initial_average_price?: number
  initial_share_count?: number
  initial_pool_cash?: number
  advanced_mode?: boolean
}

export type EventInitializationValidation = {
  valid: boolean
  errors: string[]
}

export type EventInitializationScenario = {
  event_id: string
  ticker: 'TQQQ'
  event_start_date: string
  event_end_date: string
  simulation_start_date: string | null
  default_warmup_trading_days: number
  requested_warmup_trading_days: number
  initial_state: EventInitialState | null
  available_start_options: SimulationStartOption[]
  validation: EventInitializationValidation
  lookup_error?: string
  manual_start_price_override_allowed: boolean
  cycle_placeholders: EventCyclePlaceholders
}
