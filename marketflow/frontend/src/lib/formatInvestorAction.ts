// =============================================================================
// formatInvestorAction.ts  (WO-SA17)
//
// Derives InvestorActionViewPayload from Smart Analyzer + VR policy state.
// Deterministic mapping only — no AI/fuzzy logic.
// Provides investor-facing action posture interpretation.
// =============================================================================

import type { InvestorActionPosture, InvestorActionViewPayload } from '../types/investorAction'
import type { SmartAnalyzerViewPayload } from './formatSmartAnalyzer'

type RuntimeMode = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
type GateValue   = 'OPEN' | 'LIMITED' | 'BLOCKED'
type Regime      = 'NORMAL' | 'EVENT' | 'STRUCTURAL' | 'HYBRID'

interface FormatInput {
  runtime_mode?:   RuntimeMode | null
  market_regime?:  Regime | null
  buy_gate?:       GateValue | null
  rebound_gate?:   GateValue | null
  risk_pressure?:  number | null
  confidence?:     number | null
  updated_at?:     string | null
}

// =============================================================================
// POSTURE RESOLUTION
// =============================================================================

function resolvePosture(input: FormatInput): InvestorActionPosture {
  const { runtime_mode, market_regime, buy_gate, rebound_gate } = input

  // Priority 1: Lockdown
  if (runtime_mode === 'LOCKDOWN') return 'RISK_REDUCTION_PRIORITY'

  // Priority 2: Defensive
  if (runtime_mode === 'DEFENSIVE') return 'DEFENSIVE_POSTURE'

  // Priority 3: Shock / unstable (shock = structural + rebound blocked)
  if (market_regime === 'STRUCTURAL' && rebound_gate === 'BLOCKED')
    return 'OBSERVE_AND_WAIT'

  // Priority 4: Limited mode or gates constrained
  if (runtime_mode === 'LIMITED' || buy_gate === 'LIMITED' || buy_gate === 'BLOCKED')
    return 'LIMITED_ENTRY'

  // Priority 5: Event-driven with partial rebound constraint
  if (market_regime === 'EVENT' && rebound_gate === 'LIMITED')
    return 'LIMITED_ENTRY'

  // Priority 6: Mixed regime, no severe constraint
  if (market_regime === 'HYBRID') return 'LIMITED_ENTRY'

  // Default: Normal
  return 'NORMAL_PARTICIPATION'
}

// =============================================================================
// POSTURE → TITLE / SUMMARY
// =============================================================================

const POSTURE_TITLE: Record<InvestorActionPosture, string> = {
  NORMAL_PARTICIPATION:    'Normal participation',
  LIMITED_ENTRY:           'Limited entry posture',
  DEFENSIVE_POSTURE:       'Defensive posture',
  RISK_REDUCTION_PRIORITY: 'Risk reduction priority',
  OBSERVE_AND_WAIT:        'Observe and wait',
}

const POSTURE_SUMMARY: Record<InvestorActionPosture, string> = {
  NORMAL_PARTICIPATION:
    'Broad participation remains open with no major runtime constraints.',
  LIMITED_ENTRY:
    'New exposure should remain selective as runtime constraints are active.',
  DEFENSIVE_POSTURE:
    'Capital preservation is taking priority as buy activity is constrained.',
  RISK_REDUCTION_PRIORITY:
    'The system is prioritizing defense while new risk-taking remains blocked.',
  OBSERVE_AND_WAIT:
    'Conditions remain unstable enough to favor patience over active positioning.',
}

// =============================================================================
// CONSTRAINTS / SUPPORTS / CAUTIONS BUILDER
// =============================================================================

function buildConstraints(input: FormatInput): string[] {
  const c: string[] = []
  if (input.buy_gate === 'BLOCKED')     c.push('Base buy is blocked')
  if (input.rebound_gate === 'BLOCKED') c.push('Rebound entries remain blocked')
  if (input.runtime_mode === 'LOCKDOWN') c.push('Aggressive adds are disabled')
  if (input.buy_gate === 'LIMITED')     c.push('Buy activity is limited — selective entries only')
  if (input.rebound_gate === 'LIMITED') c.push('Rebound gate is limited — no aggressive chasing')
  return c.slice(0, 3)
}

function buildSupports(input: FormatInput): string[] {
  const s: string[] = []
  if (input.runtime_mode !== 'LOCKDOWN') s.push('Defensive positioning remains allowed')
  if (input.runtime_mode === 'NORMAL' || input.runtime_mode === 'LIMITED')
    s.push('Existing posture can be maintained selectively')
  if (input.buy_gate === 'OPEN') s.push('Base buy gate is open under current policy')
  return s.slice(0, 2)
}

function buildCautions(input: FormatInput): string[] {
  const c: string[] = []
  if (input.market_regime === 'STRUCTURAL') c.push('Structural pressure remains active')
  if (input.market_regime === 'EVENT')      c.push('Event-driven volatility may persist')
  if (input.rebound_gate === 'BLOCKED')     c.push('Shock persistence is constraining rebound plays')
  if ((input.risk_pressure ?? 0) >= 70)     c.push('Risk pressure is elevated — size conservatively')
  return c.slice(0, 2)
}

// =============================================================================
// PUBLIC FORMATTER
// =============================================================================

export function formatInvestorAction(
  input: FormatInput,
): InvestorActionViewPayload {
  const posture = resolvePosture(input)

  return {
    action_posture:      posture,
    title:               POSTURE_TITLE[posture],
    summary:             POSTURE_SUMMARY[posture],
    participation_label: input.buy_gate ? `Buy gate: ${input.buy_gate}` : undefined,
    risk_label:          input.runtime_mode ?? undefined,
    constraints:         buildConstraints(input),
    supports:            buildSupports(input),
    cautions:            buildCautions(input),
    linked_state: {
      market_regime: input.market_regime ?? undefined,
      runtime_mode:  input.runtime_mode ?? undefined,
      buy_gate:      input.buy_gate ?? undefined,
      rebound_gate:  input.rebound_gate ?? undefined,
    },
    confidence:  input.confidence ?? undefined,
    updated_at:  input.updated_at ?? undefined,
  }
}

/**
 * Derive investor action payload from SmartAnalyzerViewPayload.
 * Returns null if no data.
 */
export function formatInvestorActionView(
  saPayload: SmartAnalyzerViewPayload | null | undefined,
): InvestorActionViewPayload | null {
  if (!saPayload) return null

  return formatInvestorAction({
    runtime_mode:   saPayload.runtime_mode ?? null,
    market_regime:  saPayload.market_regime ?? null,
    buy_gate:       saPayload.policy_link?.buy_gate ?? null,
    rebound_gate:   saPayload.policy_link?.rebound_gate ?? null,
    risk_pressure:  saPayload.policy_link?.risk_pressure ?? null,
    confidence:     saPayload.confidence ?? null,
    updated_at:     saPayload.updated_at ?? null,
  })
}
