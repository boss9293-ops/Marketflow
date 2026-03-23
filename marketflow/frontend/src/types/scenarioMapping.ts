export type ScenarioFitLevel =
  | 'support'
  | 'mixed'
  | 'weak'
  | 'conflict'

export type ScenarioId =
  | 'bear_market'
  | 'credit_stress'
  | 'vol_spike'
  | 'liquidity_crunch'
  | 'rates_driven'
  | 'leverage_unwind'

export interface ScenarioMapping {
  scenario_id:      ScenarioId
  scenario_label:   string
  scenario_desc:    string
  fit:              ScenarioFitLevel
  fit_score:        number
  why_mapped:       string[]
  monitor_next:     string[]
  topic_count:      number
  primary_href:     string
  secondary_href?:  string
  secondary_label?: string
}
