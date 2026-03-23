// =============================================================================
// types/investorAction.ts  (WO-SA17)
// Investor Action Console — types
// =============================================================================

export type InvestorActionPosture =
  | 'NORMAL_PARTICIPATION'
  | 'LIMITED_ENTRY'
  | 'DEFENSIVE_POSTURE'
  | 'RISK_REDUCTION_PRIORITY'
  | 'OBSERVE_AND_WAIT'

export interface InvestorActionViewPayload {
  action_posture: InvestorActionPosture

  title:   string
  summary: string

  participation_label?: string
  risk_label?:          string

  constraints: string[]
  supports?:   string[]
  cautions?:   string[]

  linked_state?: {
    market_regime?: 'EVENT' | 'STRUCTURAL' | 'HYBRID' | 'NORMAL'
    runtime_mode?:  'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
    buy_gate?:      'OPEN' | 'LIMITED' | 'BLOCKED'
    rebound_gate?:  'OPEN' | 'LIMITED' | 'BLOCKED'
  }

  confidence?: number
  updated_at?: string
}
