// =============================================================================
// analog.ts — Historical Analog types  (WO-SA20)
// =============================================================================

export interface AnalogEntry {
  label:            string
  period:           string
  regime:           'EVENT' | 'STRUCTURAL' | 'HYBRID' | 'NORMAL'
  runtime_mode:     'LOCKDOWN' | 'DEFENSIVE' | 'LIMITED' | 'NORMAL'
  shock_type:       'MACRO' | 'CREDIT' | 'LIQUIDITY' | 'POLICY' | 'NONE'
  macro_env:        'TIGHTENING' | 'EASING' | 'NEUTRAL'
  policy_gates:     'BLOCKED' | 'LIMITED' | 'OPEN'
  forward_return_5d?:   number
  forward_return_20d?:  number
  max_drawdown?:        number
  notes:            string
}

export interface AnalogMatch {
  entry:              AnalogEntry
  score:              number
  label:              string
  start_date:         string
  match_score:        number
  similarity_summary: string
  forward_return_5d?:  number
  forward_return_20d?: number
  max_drawdown?:       number
  notes?:             string
}
