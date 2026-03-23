// =============================================================================
// formatAnalyzerReliability.ts  (WO-SA18)
//
// Derives AnalyzerReliabilityPayload from Smart Analyzer view state.
// Deterministic mapping only — no AI/fuzzy.
// Calibrates trust level without overriding core regime/runtime decisions.
// =============================================================================

import type {
  AnalyzerReliabilityPayload,
  ConfidenceLevel,
  EvidenceStrength,
  SignalAgreement,
} from '../types/analyzerReliability'

type Regime  = 'NORMAL' | 'EVENT' | 'STRUCTURAL' | 'HYBRID'
type Runtime = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
type Gate    = 'OPEN' | 'LIMITED' | 'BLOCKED'

interface ReliabilityInput {
  market_regime?:  Regime | null
  runtime_mode?:   Runtime | null
  buy_gate?:       Gate | null
  rebound_gate?:   Gate | null
  risk_pressure?:  number | null
  raw_confidence?: number | null   // 0-100 from smart_analyzer (HIGH=80, MED=55, LOW=30)
  driver_count?:   number | null
  updated_at?:     string | null
}

// =============================================================================
// Confidence level
// =============================================================================

function resolveConfidence(i: ReliabilityInput): ConfidenceLevel {
  const { market_regime: r, runtime_mode: rt, buy_gate, rebound_gate, raw_confidence } = i

  // Use raw confidence score if available
  if (raw_confidence != null) {
    if (raw_confidence >= 70) return 'HIGH'
    if (raw_confidence >= 45) return 'MEDIUM'
    return 'LOW'
  }

  // Structural + hard lockdown/defensive — strong directional clarity
  if (r === 'STRUCTURAL' && (rt === 'LOCKDOWN' || rt === 'DEFENSIVE')) return 'HIGH'
  // Lockdown with blocked gates — very clear
  if (rt === 'LOCKDOWN' && buy_gate === 'BLOCKED' && rebound_gate === 'BLOCKED') return 'HIGH'
  // Fully normal with open gates
  if (r === 'NORMAL' && rt === 'NORMAL' && buy_gate !== 'BLOCKED' && rebound_gate !== 'BLOCKED') return 'HIGH'
  // Hybrid / event / limited mode — inherently mixed
  if (r === 'HYBRID' || r === 'EVENT') return 'MEDIUM'
  if (rt === 'LIMITED') return 'MEDIUM'
  // Conflicting (normal regime, non-normal runtime)
  if (r === 'NORMAL' && rt && rt !== 'NORMAL') return 'LOW'

  return 'MEDIUM'
}

// =============================================================================
// Evidence strength
// =============================================================================

function resolveEvidence(i: ReliabilityInput): EvidenceStrength {
  const { market_regime: r, runtime_mode: rt, buy_gate, rebound_gate, risk_pressure, driver_count } = i

  let score = 0
  // Strong regime signal
  if (r === 'STRUCTURAL' || r === 'EVENT') score += 2
  else if (r === 'NORMAL') score += 2
  // Runtime confirms regime
  if ((r === 'STRUCTURAL' || r === 'EVENT') && (rt === 'LOCKDOWN' || rt === 'DEFENSIVE')) score += 2
  if (r === 'NORMAL' && rt === 'NORMAL') score += 2
  // Gate confirmation
  if (buy_gate === 'BLOCKED' || rebound_gate === 'BLOCKED') score += 1
  if (buy_gate === 'OPEN' && r === 'NORMAL') score += 1
  // Risk pressure
  if ((risk_pressure ?? 0) >= 70) score += 1
  // Driver count
  if ((driver_count ?? 0) >= 3) score += 1

  if (score >= 5) return 'STRONG'
  if (score >= 3) return 'MODERATE'
  return 'WEAK'
}

// =============================================================================
// Signal agreement
// =============================================================================

function resolveAgreement(i: ReliabilityInput): SignalAgreement {
  const { market_regime: r, runtime_mode: rt, buy_gate, rebound_gate } = i

  // Stress regime + stress runtime + blocked gates → ALIGNED
  const stressRegime  = r === 'STRUCTURAL' || r === 'EVENT'
  const stressRuntime = rt === 'LOCKDOWN' || rt === 'DEFENSIVE'
  const gatesBlocked  = buy_gate === 'BLOCKED' || rebound_gate === 'BLOCKED'

  if (stressRegime && stressRuntime && gatesBlocked) return 'ALIGNED'
  if (r === 'NORMAL' && rt === 'NORMAL' && !gatesBlocked)  return 'ALIGNED'

  // Core layer disagreement → CONFLICTED
  if (r === 'NORMAL' && stressRuntime) return 'CONFLICTED'
  if (stressRegime && rt === 'NORMAL') return 'CONFLICTED'

  // Partial agreement → MIXED
  return 'MIXED'
}

// =============================================================================
// Instability / noise flags
// =============================================================================

function resolveFlags(i: ReliabilityInput): { instability: boolean; noise: boolean } {
  const { market_regime: r, runtime_mode: rt } = i
  // Hybrid regime is inherently unstable
  const instability = r === 'HYBRID'
  // Noise: event-driven without full structural support + limited mode
  const noise = r === 'EVENT' && rt === 'LIMITED'
  return { instability, noise }
}

// =============================================================================
// Reason lines builder
// =============================================================================

function buildReasons(
  i: ReliabilityInput,
  confidence: ConfidenceLevel,
  evidence: EvidenceStrength,
  agreement: SignalAgreement,
): string[] {
  const lines: string[] = []
  const { market_regime: r, runtime_mode: rt } = i

  if (agreement === 'ALIGNED') {
    if (r === 'STRUCTURAL') lines.push('Structural evidence is supported by runtime and policy layers')
    else if (r === 'NORMAL') lines.push('Macro and runtime signals are broadly aligned')
    else lines.push('Core signals remain in agreement')
  } else if (agreement === 'MIXED') {
    lines.push('Primary posture is intact, but signals are mixed')
    if (r === 'HYBRID') lines.push('Mixed regime creates inherent directional uncertainty')
  } else {
    lines.push('Core layers show conflicting signals — posture should be interpreted cautiously')
  }

  if (evidence === 'WEAK') {
    lines.push('Evidence base is limited to short-term signals')
  } else if (evidence === 'STRONG' && confidence === 'HIGH') {
    lines.push('Multiple confirming indicators reduce interpretation risk')
  }

  if (rt === 'LOCKDOWN' && confidence === 'HIGH') {
    lines.push('Lockdown posture has strong directional backing')
  } else if (rt === 'LIMITED' || r === 'HYBRID') {
    lines.push('Confidence is reduced by recent mixed signals')
  }

  return lines.slice(0, 3)
}

// =============================================================================
// Freshness label
// =============================================================================

function buildFreshnessLabel(updated_at?: string | null): string | undefined {
  if (!updated_at) return undefined
  try {
    const d = new Date(updated_at)
    const now = new Date()
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000)
    if (diffMin < 2)   return 'Updated just now'
    if (diffMin < 60)  return `Updated ${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24)    return `Updated ${diffH}h ago`
    return 'Updated today'
  } catch {
    return undefined
  }
}

// =============================================================================
// Public formatter
// =============================================================================

export function formatAnalyzerReliability(
  input: ReliabilityInput | null | undefined,
): AnalyzerReliabilityPayload | null {
  if (!input) return null
  if (!input.market_regime && !input.runtime_mode) return null

  const confidence = resolveConfidence(input)
  const evidence   = resolveEvidence(input)
  const agreement  = resolveAgreement(input)
  const flags      = resolveFlags(input)
  const reasons    = buildReasons(input, confidence, evidence, agreement)
  const freshness  = buildFreshnessLabel(input.updated_at)

  return {
    confidence_level:  confidence,
    evidence_strength: evidence,
    signal_agreement:  agreement,
    instability_flag:  flags.instability || undefined,
    noise_flag:        flags.noise || undefined,
    confidence_score:  input.raw_confidence ?? undefined,
    freshness_label:   freshness,
    reasons,
  }
}

/**
 * Derive from SmartAnalyzerViewPayload shape directly.
 */
export function formatAnalyzerReliabilityFromView(view: {
  market_regime?:  string
  runtime_mode?:   string
  policy_link?:    { buy_gate?: string; rebound_gate?: string; risk_pressure?: number }
  confidence?:     number
  top_drivers?:    unknown[]
  updated_at?:     string
} | null | undefined): AnalyzerReliabilityPayload | null {
  if (!view) return null
  return formatAnalyzerReliability({
    market_regime:   view.market_regime   as Regime  | null ?? null,
    runtime_mode:    view.runtime_mode    as Runtime | null ?? null,
    buy_gate:        view.policy_link?.buy_gate      as Gate | null ?? null,
    rebound_gate:    view.policy_link?.rebound_gate  as Gate | null ?? null,
    risk_pressure:   view.policy_link?.risk_pressure ?? null,
    raw_confidence:  view.confidence ?? null,
    driver_count:    (view.top_drivers ?? []).length,
    updated_at:      view.updated_at ?? null,
  })
}
