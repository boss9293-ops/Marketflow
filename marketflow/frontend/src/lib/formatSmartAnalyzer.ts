// =============================================================================
// formatSmartAnalyzer.ts  (WO-SA14 / SA16 — unified labels)
import { REGIME_LABEL, REGIME_TONE, RUNTIME_LABEL, RUNTIME_TONE, deriveDefaultHeadline } from './smartAnalyzerLabels'
// Types + formatter: SmartAnalyzerViewPayload → SmartAnalyzerDisplayModel
// =============================================================================

export type SmartAnalyzerViewRegime  = 'NORMAL' | 'EVENT' | 'STRUCTURAL' | 'HYBRID'
export type SmartAnalyzerViewRuntime = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
export type SADisplayTone = 'red' | 'orange' | 'amber' | 'green' | 'purple' | 'neutral'
export type GateValue     = 'OPEN' | 'LIMITED' | 'BLOCKED'

export interface SmartAnalyzerViewPayload {
  market_regime:   SmartAnalyzerViewRegime
  runtime_mode?:   SmartAnalyzerViewRuntime
  posture_label:   string
  posture_bias?:   string
  headline_risk:   string
  concise_summary: string
  top_drivers:     { label: string; impact?: 'LOW' | 'MEDIUM' | 'HIGH' }[]
  scenario_view?:  { name: string; probability: number }[]
  confidence?:     number
  policy_link?: {
    buy_gate?:      GateValue
    rebound_gate?:  GateValue
    risk_pressure?: number
  }
  updated_at?: string
}

export interface SmartAnalyzerScenarioItem {
  name:        string
  probability: number
}

export interface SmartAnalyzerMetricItem {
  label: string
  value: string
  tone:  SADisplayTone
}

export interface SmartAnalyzerDisplayModel {
  regime_label:     string
  regime_tone:      SADisplayTone
  runtime_label:    string
  runtime_tone:     SADisplayTone
  posture_label:    string
  headline:         string
  summary:          string
  updated_label:    string
  confidence_label: string
  metric_items:     SmartAnalyzerMetricItem[]
  driver_lines:     string[]
  driver_impacts:   SADisplayTone[]
  has_scenario:     boolean
  has_policy:       boolean
  scenario_items:   SmartAnalyzerScenarioItem[]
  vr_link_lines:    string[]
}

// =============================================================================
// Helpers
// =============================================================================

function gateLabel(g?: GateValue): string {
  return g === 'OPEN' ? 'Open' : g === 'LIMITED' ? 'Limited' : g === 'BLOCKED' ? 'Blocked' : '—'
}

function gateTone(g?: GateValue): SADisplayTone {
  return g === 'OPEN' ? 'green' : g === 'LIMITED' ? 'amber' : g === 'BLOCKED' ? 'red' : 'neutral'
}

function postureTone(posture?: string): SADisplayTone {
  if (posture === 'DEFENSIVE') return 'red'
  if (posture === 'CAUTIOUS')  return 'orange'
  if (posture === 'BALANCED')  return 'amber'
  if (posture === 'OFFENSIVE') return 'green'
  return 'neutral'
}

function confTone(conf: number): SADisplayTone {
  return conf >= 70 ? 'green' : conf >= 50 ? 'amber' : 'orange'
}

function impactTone(impact?: 'LOW' | 'MEDIUM' | 'HIGH'): SADisplayTone {
  return impact === 'HIGH' ? 'red' : impact === 'MEDIUM' ? 'amber' : 'neutral'
}

// =============================================================================
// Null-safe formatter
// =============================================================================

const NULL_MODEL: SmartAnalyzerDisplayModel = {
  regime_label: 'Unknown', regime_tone: 'neutral',
  runtime_label: '—', runtime_tone: 'neutral',
  posture_label: 'Unknown',
  headline: 'Smart Analyzer data unavailable',
  summary: '', updated_label: '', confidence_label: '—',
  metric_items: [], driver_lines: [], driver_impacts: [],
  has_scenario: false, has_policy: false,
  scenario_items: [], vr_link_lines: [],
}

export function formatSmartAnalyzerView(
  payload: SmartAnalyzerViewPayload | null | undefined,
): SmartAnalyzerDisplayModel {
  if (!payload) return NULL_MODEL

  const regime = payload.market_regime
  const regimeTone: SADisplayTone = (REGIME_TONE[regime] ?? 'neutral') as SADisplayTone
  const regimeLabel = REGIME_LABEL[regime] ?? 'Unknown regime'

  const rt = payload.runtime_mode
  const runtimeTone: SADisplayTone = rt ? ((RUNTIME_TONE[rt] ?? 'neutral') as SADisplayTone) : 'neutral'
  const runtimeLabel = rt ? (RUNTIME_LABEL[rt] ?? '—') : '—'

  const conf            = payload.confidence
  const confidenceLabel = conf != null ? `${Math.round(conf)}%` : '—'
  const updatedLabel    = payload.updated_at ? payload.updated_at.slice(0, 10) : ''

  const metric_items: SmartAnalyzerMetricItem[] = [
    { label: 'Regime',  value: regimeLabel,          tone: regimeTone },
    { label: 'Runtime', value: runtimeLabel,          tone: runtimeTone },
    { label: 'Posture', value: payload.posture_label, tone: postureTone(payload.posture_bias) },
  ]
  if (conf != null) metric_items.push({ label: 'Confidence', value: confidenceLabel, tone: confTone(conf) })
  const pl = payload.policy_link
  if (pl?.buy_gate)     metric_items.push({ label: 'Buy Gate',     value: gateLabel(pl.buy_gate),     tone: gateTone(pl.buy_gate) })
  if (pl?.rebound_gate) metric_items.push({ label: 'Rebound Gate', value: gateLabel(pl.rebound_gate), tone: gateTone(pl.rebound_gate) })

  const drivers        = (payload.top_drivers ?? []).slice(0, 5)
  const driver_lines   = drivers.map(d => d.label)
  const driver_impacts = drivers.map(d => impactTone(d.impact))

  const scenario_items: SmartAnalyzerScenarioItem[] = (payload.scenario_view ?? [])
    .slice().sort((a, b) => b.probability - a.probability)
    .map(s => ({ name: s.name, probability: s.probability }))
  const has_scenario = scenario_items.length > 0

  const vr_link_lines: string[] = []
  if (pl?.buy_gate)               vr_link_lines.push(`Buy gate: ${gateLabel(pl.buy_gate)}`)
  if (pl?.rebound_gate)           vr_link_lines.push(`Rebound gate: ${gateLabel(pl.rebound_gate)}`)
  if (pl?.risk_pressure != null)  vr_link_lines.push(`Risk pressure: ${pl.risk_pressure}%`)
  if (rt && rt !== 'NORMAL')      vr_link_lines.push(`Runtime posture: ${runtimeLabel}`)
  const has_policy = vr_link_lines.length > 0

  // Use posture-aware default headline if backend didn't provide one (SA16)
  const resolvedHeadline = payload.headline_risk?.trim()
    || deriveDefaultHeadline(regime, rt)

  return {
    regime_label: regimeLabel, regime_tone: regimeTone,
    runtime_label: runtimeLabel, runtime_tone: runtimeTone,
    posture_label: payload.posture_label,
    headline:      resolvedHeadline,
    summary:       payload.concise_summary,
    updated_label: updatedLabel,
    confidence_label: confidenceLabel,
    metric_items, driver_lines, driver_impacts,
    has_scenario, has_policy, scenario_items, vr_link_lines,
  }
}
