// =============================================================================
// buildSmartAnalyzerView.ts  (WO-SA14 / SA15)
// raw Smart Analyzer output JSON → SmartAnalyzerViewPayload
// =============================================================================

import type { SmartAnalyzerViewPayload, SmartAnalyzerViewRegime, SmartAnalyzerViewRuntime } from './formatSmartAnalyzer'

interface RawAnalyzerOutput {
  market_type?:  string
  confidence?:   string
  key_drivers?:  string[]
  interpretation?: string
  strategy?:     string
  summary?:      string
  vr_policy?: {
    posture_bias?:         string
    risk_pressure?:        string
    buy_bias?:             string
    rebound_permission?:   string
    policy_state?:         string
    caution_reason?:       string
    continuation_bias?:    number
    shock_flag?:           boolean
    structural_risk_flag?: boolean
  }
  vr_runtime_policy?: {
    runtime_mode?:      string
    buy_gate?:          string
    rebound_gate?:      string
    defensive_bias?:    number
    sizing_bias?:       number
  }
  scenario?: {
    rebound_probability?:      number
    sideways_probability?:     number
    continuation_probability?: number
    dominant_path?:            string
  }
  research_desk?: {
    headline?: { title?: string; subtitle?: string; tone?: string }
    posture_card?: { posture?: string; risk_pressure?: string }
  }
  debug?: { shock_flag?: boolean }
  updated_at?: string
}

function buildDrivers(kd?: string[]): SmartAnalyzerViewPayload['top_drivers'] {
  if (!kd || kd.length === 0) return []
  return kd.slice(0, 5).map(label => ({ label, impact: undefined as 'LOW' | 'MEDIUM' | 'HIGH' | undefined }))
}

function buildScenario(s?: RawAnalyzerOutput['scenario']): SmartAnalyzerViewPayload['scenario_view'] {
  if (!s) return undefined
  const items: NonNullable<SmartAnalyzerViewPayload['scenario_view']> = []
  if (typeof s.continuation_probability === 'number' && s.continuation_probability > 0)
    items.push({ name: 'Continuation drawdown', probability: Math.round(s.continuation_probability) })
  if (typeof s.sideways_probability === 'number' && s.sideways_probability > 0)
    items.push({ name: 'Sideways / recovery', probability: Math.round(s.sideways_probability) })
  if (typeof s.rebound_probability === 'number' && s.rebound_probability > 0)
    items.push({ name: 'Rebound stabilization', probability: Math.round(s.rebound_probability) })
  return items.length > 0 ? items : undefined
}

function parseConfidence(raw?: string): number | undefined {
  if (!raw) return undefined
  if (raw === 'HIGH') return 80
  if (raw === 'MED')  return 55
  if (raw === 'LOW')  return 30
  const n = Number(raw)
  return isNaN(n) ? undefined : n
}

type GateValue = 'OPEN' | 'LIMITED' | 'BLOCKED'

function mapGate(g?: string): GateValue | undefined {
  if (g === 'OPEN' || g === 'ALLOW') return 'OPEN'
  if (g === 'LIMITED' || g === 'LIMIT') return 'LIMITED'
  if (g === 'BLOCKED' || g === 'BLOCK') return 'BLOCKED'
  return undefined
}

function mapRegime(raw?: string): SmartAnalyzerViewRegime {
  if (raw === 'STRUCTURAL') return 'STRUCTURAL'
  if (raw === 'EVENT')      return 'EVENT'
  if (raw === 'HYBRID')     return 'HYBRID'
  return 'NORMAL'
}

function mapRuntime(raw?: string): SmartAnalyzerViewRuntime | undefined {
  if (raw === 'LOCKDOWN')  return 'LOCKDOWN'
  if (raw === 'DEFENSIVE') return 'DEFENSIVE'
  if (raw === 'LIMITED')   return 'LIMITED'
  if (raw === 'NORMAL')    return 'NORMAL'
  return undefined
}

export function buildSmartAnalyzerView(
  raw: RawAnalyzerOutput | null | undefined,
  updatedAt?: string,
): SmartAnalyzerViewPayload | null {
  if (!raw) return null

  const regime  = mapRegime(raw.market_type)
  const runtime = mapRuntime(raw.vr_runtime_policy?.runtime_mode)

  const headline = raw.research_desk?.headline?.title ?? raw.interpretation ?? ''
  const summary  = raw.research_desk?.headline?.subtitle ?? raw.summary ?? ''

  const postureBias  = raw.vr_policy?.posture_bias ?? raw.research_desk?.posture_card?.posture
  const postureLabel = postureBias
    ? (postureBias === 'DEFENSIVE' ? 'Defensive' : postureBias === 'CAUTIOUS' ? 'Cautious' : postureBias === 'BALANCED' ? 'Balanced' : 'Offensive')
    : 'Unknown'

  const topDrivers   = buildDrivers(raw.key_drivers)
  const scenarioView = buildScenario(raw.scenario)
  const confidence   = parseConfidence(raw.confidence)

  const buyGate     = mapGate(raw.vr_runtime_policy?.buy_gate) ?? mapGate(raw.vr_policy?.buy_bias)
  const reboundGate = mapGate(raw.vr_runtime_policy?.rebound_gate) ?? mapGate(raw.vr_policy?.rebound_permission)
  const riskPressure = raw.vr_policy?.risk_pressure === 'HIGH' ? 80
    : raw.vr_policy?.risk_pressure === 'MED' ? 50
    : raw.vr_policy?.risk_pressure === 'LOW' ? 20
    : undefined
  const hasPolicy = !!(buyGate || reboundGate || riskPressure !== undefined)

  return {
    market_regime:   regime,
    runtime_mode:    runtime,
    posture_label:   postureLabel,
    posture_bias:    postureBias,
    headline_risk:   headline,
    concise_summary: summary,
    top_drivers:     topDrivers,
    scenario_view:   scenarioView,
    confidence,
    policy_link: hasPolicy ? { buy_gate: buyGate, rebound_gate: reboundGate, risk_pressure: riskPressure } : undefined,
    updated_at:  updatedAt ?? raw.updated_at,
  }
}
