import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import type { AnalyzerReliabilityPayload } from '@/types/analyzerReliability'

export type TransitionState = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
export type TransitionBias  = 'STABLE' | 'SOFTER' | 'TIGHTER'

export interface TransitionViewPayload {
  current_state:     TransitionState
  next_bias:         TransitionBias
  transition_scores: { stay: number; soften: number; tighten: number }
  summary:           string
  reasons:           string[]
  has_data:          boolean
}

export function buildTransitionView(
  payload?: SmartAnalyzerViewPayload | null,
  reliability?: AnalyzerReliabilityPayload | null
): TransitionViewPayload | null {
  if (!payload) return null

  const runtime = (payload.runtime_mode ?? 'NORMAL') as TransitionState
  const conf    = reliability?.confidence_level ?? 'LOW'

  const base: Record<TransitionState, { stay: number; soften: number; tighten: number }> = {
    LOCKDOWN:  { stay: 50, soften: 20, tighten: 0  },
    DEFENSIVE: { stay: 45, soften: 15, tighten: 20 },
    LIMITED:   { stay: 40, soften: 20, tighten: 20 },
    NORMAL:    { stay: 40, soften: 30, tighten: 10 },
  }
  const s = { ...base[runtime] }

  const buyGate     = payload.policy_link?.buy_gate    ?? 'OPEN'
  const reboundGate = payload.policy_link?.rebound_gate ?? 'OPEN'
  const riskPressure = payload.policy_link?.risk_pressure ?? 0

  if (conf === 'HIGH') s.stay += 8
  if (conf === 'MEDIUM') s.stay += 4
  if (buyGate === 'BLOCKED' && reboundGate === 'BLOCKED') s.tighten += 12
  if (buyGate === 'OPEN' && reboundGate === 'OPEN') s.soften += 10
  if (riskPressure > 70) s.tighten += 8
  if (riskPressure < 30) s.soften += 6

  const total = s.stay + s.soften + s.tighten
  const scores = {
    stay:    Math.round(s.stay    / total * 100),
    soften:  Math.round(s.soften  / total * 100),
    tighten: Math.round(s.tighten / total * 100),
  }

  const next_bias: TransitionBias =
    scores.soften  - scores.tighten > 5 ? 'SOFTER'  :
    scores.tighten - scores.soften  > 5 ? 'TIGHTER' : 'STABLE'

  const biasText = next_bias === 'SOFTER' ? 'easing' : next_bias === 'TIGHTER' ? 'tightening' : 'stable'
  const summary = 'Current ' + runtime + ' regime shows ' + biasText + ' tendency (' + scores.stay + '% stay / ' + scores.soften + '% soften / ' + scores.tighten + '% tighten).'

  const reasons: string[] = []
  if (reliability?.reasons) reasons.push(...reliability.reasons.slice(0, 2))

  return {
    current_state:     runtime,
    next_bias,
    transition_scores: scores,
    summary,
    reasons,
    has_data: true,
  }
}
