export type StandardInterpretationSource = {
  current?: {
    score?: number | null
    level?: number | null
    exposure_pct?: number | null
  } | null
  total_risk?: {
    state?: string | null
  } | null
  master_signal?: {
    mode?: string | null
  } | null
  market_regime?: {
    regime?: string | null
    regime_confidence?: number | null
    stability_score?: number | null
    stability_label?: string | null
  } | null
  risk_scenario?: {
    scenario?: string | null
    confidence?: number | null
    label?: string | null
  } | null
  track_a?: {
    state?: string | null
    stage0?: boolean | null
  } | null
  track_a_early?: {
    state?: string | null
    trigger_count?: number | null
  } | null
  track_c?: {
    state?: string | null
  } | null
  breadth?: {
    divergence?: boolean | null
  } | null
}

export type StandardInterpretationDisplayModel = {
  summaryLine: string
  detailLines: string[]
  forwardNarrativeLine?: string
  interpretationState: string
  currentRegime: string
  agreementScore: number
  conflictScore: number
  trustScore: number
  subtext?: string
  isFallback: boolean
}

type StandardNarrativeState =
  | 'CALM'
  | 'WATCH'
  | 'FRAGILE'
  | 'DEFENSIVE'
  | 'UNCONFIRMED_RECOVERY'
  | 'UNAVAILABLE'

type ForwardNarrativeCategory =
  | 'LOW_RISK'
  | 'MIXED'
  | 'ELEVATED'
  | 'TAIL_HEAVY'

type StandardTemplateKey =
  | 'stable_watch'
  | 'internal_pressure_building'
  | 'fragile_watch'
  | 'credit_confirmation_pending'
  | 'shock_not_confirmed'
  | 'defensive_bias_active'
  | 'stabilizing_but_unconfirmed'
  | 'overlay_unavailable'

type StandardTemplateContext = {
  currentRegime: string
  alignmentDescriptor: string
  confidenceDescriptor: string
  mode: string
  hasEarlySignal: boolean
  hasBroadDivergence: boolean
  hasCreditConfirmation: boolean
}

type StandardNarrativeTemplate = {
  summaryLine: (context: StandardTemplateContext) => string
  detailLines: (context: StandardTemplateContext) => [string, string]
  forwardNarrativeLine?: (context: StandardTemplateContext) => string
  subtext?: string
}

const STANDARD_INTERPRETATION_SUBTEXT =
  'Interpretive layer only; base engine remains primary.'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function hasStandardInterpretationSource(input: StandardInterpretationSource) {
  return Boolean(input.current && input.total_risk)
}

function normalizeRegime(regime: string | null | undefined) {
  const value = String(regime ?? '').toLowerCase()
  if (value.includes('liquidity crisis')) return 'Liquidity Crisis'
  if (value.includes('credit stress')) return 'Credit Stress'
  if (value.includes('early stress')) return 'Early Stress'
  if (value.includes('expansion')) return 'Expansion'
  return regime?.trim() || 'Base Engine'
}

function regimePressure(regime: string) {
  if (regime === 'Liquidity Crisis') return 88
  if (regime === 'Credit Stress') return 74
  if (regime === 'Early Stress') return 48
  if (regime === 'Expansion') return 18
  return 50
}

function scenarioPressure(scenario: string | null | undefined) {
  if (scenario === 'A') return 80
  if (scenario === 'B') return 65
  if (scenario === 'C') return 45
  if (scenario === 'D') return 18
  return 50
}

function rulePressure(input: StandardInterpretationSource) {
  const level = input.current?.level ?? 1
  const mode = input.master_signal?.mode ?? 'ALL_CLEAR'
  let base = level <= 0 ? 18 : level === 1 ? 34 : level === 2 ? 56 : level === 3 ? 76 : 88
  if (mode === 'EARLY_WARNING') base = Math.max(base, 58)
  if (mode === 'HEDGE_AND_HOLD') base = Math.max(base, 64)
  if (mode === 'CREDIT_CRISIS') base = Math.max(base, 78)
  if (mode === 'COMPOUND_CRISIS') base = Math.max(base, 90)
  return base
}

function buildAgreementScore(input: StandardInterpretationSource, rule: number, regime: number, scenario: number) {
  const regimeConf = input.market_regime?.regime_confidence ?? 45
  const scenarioConf = input.risk_scenario?.confidence ?? 45
  const spread = Math.max(rule, regime, scenario) - Math.min(rule, regime, scenario)
  let score = 82 - spread * 0.9
  score += (regimeConf - 50) * 0.12
  score += (scenarioConf - 50) * 0.08
  if (rule >= 65 && regime >= 65 && scenario >= 55) score += 6
  if (rule <= 35 && regime <= 35 && scenario <= 35) score += 6
  if ((input.track_a_early?.state ?? 'Normal') !== 'Normal' && input.breadth?.divergence) score += 4
  return clamp(score, 18, 94)
}

function buildConflictScore(input: StandardInterpretationSource, rule: number, regime: number, scenario: number, agreement: number) {
  const spread = Math.max(rule, regime, scenario) - Math.min(rule, regime, scenario)
  let score = spread * 1.05
  if (rule >= 70 && scenario <= 35) score += 18
  if (rule <= 35 && regime >= 70) score += 18
  if ((input.master_signal?.mode ?? 'ALL_CLEAR') === 'EARLY_WARNING' && regime <= 35 && scenario <= 35) score += 10
  if (agreement >= 70) score -= 18
  return clamp(score, 4, 88)
}

function buildTrustScore(input: StandardInterpretationSource, agreement: number, conflict: number) {
  const regimeConf = input.market_regime?.regime_confidence ?? 45
  const scenarioConf = input.risk_scenario?.confidence ?? 45
  const stabilityLabel = input.market_regime?.stability_label ?? 'TRANSITIONING'
  const mode = input.master_signal?.mode ?? 'ALL_CLEAR'
  const stabilityAdj =
    stabilityLabel === 'STABLE' ? 8 :
    stabilityLabel === 'UNSTABLE' ? -6 :
    0
  const confirmationBoost =
    input.track_a?.stage0 || mode === 'CREDIT_CRISIS' || mode === 'COMPOUND_CRISIS'
      ? 10
      : mode === 'EARLY_WARNING' || (input.track_a_early?.state ?? 'Normal') !== 'Normal'
        ? 3
        : 0
  const raw =
    regimeConf * 0.38 +
    scenarioConf * 0.24 +
    agreement * 0.23 +
    (100 - conflict) * 0.1 +
    stabilityAdj +
    confirmationBoost
  return clamp(raw, 12, 90)
}

function buildInterpretationState(input: StandardInterpretationSource, regime: string) {
  const mode = input.master_signal?.mode ?? 'ALL_CLEAR'
  const level = input.current?.level ?? 1
  const earlyState = input.track_a_early?.state ?? 'Normal'
  if (mode === 'COMPOUND_CRISIS' || mode === 'CREDIT_CRISIS' || level >= 3) return 'DEFENSIVE REVIEW'
  if (mode === 'EARLY_WARNING' || earlyState !== 'Normal' || level === 2) return 'WATCH CONDITION'
  if (regime !== 'Expansion' || input.breadth?.divergence) return 'PRESSURE BUILDING'
  return 'BASE ENGINE STABLE'
}

function confidenceDescriptor(score: number) {
  if (score >= 70) return 'high confidence'
  if (score >= 45) return 'moderate confidence'
  return 'limited confidence'
}

function alignmentDescriptor(agreement: number, conflict: number) {
  if (conflict >= 60) return 'mixed alignment'
  if (agreement >= 72) return 'broad alignment'
  if (agreement >= 55) return 'partial alignment'
  return 'early alignment'
}

function buildNarrativeState(
  input: StandardInterpretationSource,
  currentRegime: string,
  interpretationState: string
): StandardNarrativeState {
  const mode = input.master_signal?.mode ?? 'ALL_CLEAR'
  const earlyTriggers = input.track_a_early?.trigger_count ?? 0
  const hasEarlySignal = (input.track_a_early?.state ?? 'Normal') !== 'Normal'
  const hasBroadDivergence = Boolean(input.breadth?.divergence)
  const hasCreditConfirmation = Boolean(input.track_a?.stage0)

  if (interpretationState === 'DEFENSIVE REVIEW') return 'DEFENSIVE'

  if (interpretationState === 'BASE ENGINE STABLE' && currentRegime !== 'Expansion') {
    return 'UNCONFIRMED_RECOVERY'
  }

  if (interpretationState === 'WATCH CONDITION') {
    if (hasBroadDivergence || hasCreditConfirmation || earlyTriggers >= 2 || currentRegime === 'Credit Stress') {
      return 'FRAGILE'
    }
    return 'WATCH'
  }

  if (interpretationState === 'PRESSURE BUILDING') {
    if (hasBroadDivergence || hasCreditConfirmation || currentRegime === 'Credit Stress' || currentRegime === 'Liquidity Crisis') {
      return 'FRAGILE'
    }
    if (mode === 'ALL_CLEAR' && !hasEarlySignal) return 'UNCONFIRMED_RECOVERY'
    return 'WATCH'
  }

  return 'CALM'
}

function selectTemplateKey(
  narrativeState: StandardNarrativeState,
  input: StandardInterpretationSource,
  currentRegime: string
): StandardTemplateKey {
  if (narrativeState === 'UNAVAILABLE') return 'overlay_unavailable'
  if (narrativeState === 'CALM') return 'stable_watch'
  if (narrativeState === 'DEFENSIVE') return 'defensive_bias_active'
  if (narrativeState === 'UNCONFIRMED_RECOVERY') return 'stabilizing_but_unconfirmed'
  if (narrativeState === 'FRAGILE') {
    return currentRegime === 'Credit Stress' || Boolean(input.track_a?.stage0)
      ? 'credit_confirmation_pending'
      : 'fragile_watch'
  }
  return (input.track_a_early?.state ?? 'Normal') !== 'Normal' || (input.master_signal?.mode ?? 'ALL_CLEAR') === 'EARLY_WARNING'
    ? 'internal_pressure_building'
    : 'shock_not_confirmed'
}

function buildForwardNarrativeCategory(
  narrativeState: StandardNarrativeState,
  currentRegime: string,
  agreementScore: number,
  conflictScore: number,
  trustScore: number
): ForwardNarrativeCategory {
  if (narrativeState === 'DEFENSIVE') {
    if (conflictScore <= 36 && trustScore >= 58) return 'TAIL_HEAVY'
    return 'ELEVATED'
  }

  if (narrativeState === 'FRAGILE') {
    if (currentRegime === 'Credit Stress' || currentRegime === 'Liquidity Crisis') return 'TAIL_HEAVY'
    return 'ELEVATED'
  }

  if (narrativeState === 'UNCONFIRMED_RECOVERY') return 'MIXED'

  if (narrativeState === 'WATCH') {
    if (agreementScore >= 62 && conflictScore <= 42) return 'ELEVATED'
    return 'MIXED'
  }

  if (narrativeState === 'CALM') {
    if (conflictScore >= 52 || trustScore < 45) return 'MIXED'
    return 'LOW_RISK'
  }

  return 'MIXED'
}

function buildForwardNarrativeLine(
  narrativeState: StandardNarrativeState,
  category: ForwardNarrativeCategory
): string | undefined {
  if (narrativeState === 'UNAVAILABLE') return undefined

  if (narrativeState === 'DEFENSIVE') {
    return category === 'TAIL_HEAVY'
      ? 'Downside scenarios remain active, and stabilization may take time before a sustained recovery can form.'
      : 'Downside pressure remains active, and stabilization may take time even if conditions begin to steady.'
  }

  if (narrativeState === 'FRAGILE') {
    return category === 'TAIL_HEAVY'
      ? 'Short-term moves may appear stable, but the structure is vulnerable to further deterioration if pressure continues.'
      : 'Short-term conditions may hold for a time, but further deterioration remains possible if pressure broadens.'
  }

  if (narrativeState === 'UNCONFIRMED_RECOVERY') {
    return 'Recovery attempts are forming, but confirmation is still limited and setbacks remain possible.'
  }

  if (narrativeState === 'WATCH') {
    return category === 'ELEVATED'
      ? 'Near-term conditions may stay orderly, but early pressure often tends to build before broader confirmation appears.'
      : 'Near-term conditions remain stable, but early signs of pressure are building beneath the surface.'
  }

  if (narrativeState === 'CALM') {
    return category === 'LOW_RISK'
      ? 'Near-term conditions appear stable, though early shifts in pressure may still emerge beneath the surface.'
      : 'Signals are mixed, suggesting a period of instability rather than a clear directional move.'
  }

  return 'Signals are mixed, suggesting a period of instability rather than a clear directional move.'
}

const STANDARD_NARRATIVE_TEMPLATES: Record<StandardTemplateKey, StandardNarrativeTemplate> = {
  stable_watch: {
    summaryLine: () => 'Base conditions remain stable, and watch signals stay contained.',
    detailLines: ({ currentRegime, alignmentDescriptor: alignment, confidenceDescriptor: confidence }) => [
      currentRegime === 'Expansion'
        ? 'No active external shock is confirmed, and pressure is not yet broad across the market.'
        : `${currentRegime} remains the main backdrop, though stress is not yet broad-based.`,
      `This is a light watch condition with ${alignment} and ${confidence}.`,
    ],
    forwardNarrativeLine: () => 'Near-term conditions remain stable, but early signs of pressure are building beneath the surface.',
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
  internal_pressure_building: {
    summaryLine: () => 'Internal pressure is rising, but broad confirmation is incomplete.',
    detailLines: ({ hasEarlySignal, confidenceDescriptor: confidence, alignmentDescriptor: alignment }) => [
      hasEarlySignal
        ? 'Early signal transmission is active before full market-wide confirmation.'
        : 'Pressure is appearing internally before it becomes broad across the tape.',
      `This is a watch condition with ${alignment} and ${confidence}.`,
    ],
    forwardNarrativeLine: () => 'Near-term conditions remain stable, but early signs of pressure are building beneath the surface.',
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
  fragile_watch: {
    summaryLine: () => 'The market backdrop looks fragile, though confirmation is not yet broad.',
    detailLines: ({ hasBroadDivergence, currentRegime, confidenceDescriptor: confidence }) => [
      hasBroadDivergence
        ? 'Breadth and cross-asset behavior suggest pressure is spreading beyond a single pocket.'
        : `${currentRegime} remains the main structural backdrop as pressure broadens in sensitive areas.`,
      `This remains a fragile watch condition with ${confidence}.`,
    ],
    forwardNarrativeLine: () => 'Short-term moves may appear stable, but the structure is vulnerable to further deterioration if pressure continues.',
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
  credit_confirmation_pending: {
    summaryLine: () => 'Credit-sensitive pressure is building, but confirmation remains pending.',
    detailLines: ({ hasCreditConfirmation, confidenceDescriptor: confidence }) => [
      hasCreditConfirmation
        ? 'Credit-sensitive weakness is visible, but full market-wide confirmation is still developing.'
        : 'Credit-sensitive areas are weakening before full market-wide confirmation.',
      `This points to a watch phase with defensive bias and ${confidence}.`,
    ],
    forwardNarrativeLine: () => 'Short-term moves may appear stable, but the structure is vulnerable to further deterioration if pressure continues.',
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
  shock_not_confirmed: {
    summaryLine: () => 'Internal pressure is visible, but no active external shock is confirmed.',
    detailLines: ({ currentRegime, alignmentDescriptor: alignment, confidenceDescriptor: confidence }) => [
      `${currentRegime} remains the main backdrop while confirmation is not yet broad across the market.`,
      `This is a watch condition with ${alignment} and ${confidence}.`,
    ],
    forwardNarrativeLine: () => 'Near-term conditions remain stable, but early signs of pressure are building beneath the surface.',
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
  defensive_bias_active: {
    summaryLine: () => 'Downside pressure is broadly confirmed, and a defensive bias is active.',
    detailLines: ({ currentRegime, hasCreditConfirmation, alignmentDescriptor: alignment, confidenceDescriptor: confidence }) => [
      hasCreditConfirmation
        ? 'Credit-sensitive weakness is confirmed and no longer limited to early internal signals.'
        : `${currentRegime} remains the dominant backdrop, with pressure no longer confined to a narrow signal set.`,
      `Alignment is ${alignment}, and confidence remains ${confidence.replace(' confidence', '')}.`,
    ],
    forwardNarrativeLine: () => 'Downside scenarios remain active, and stabilization may take time before a sustained recovery can form.',
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
  stabilizing_but_unconfirmed: {
    summaryLine: () => 'Stabilization is appearing, but confirmation is still limited.',
    detailLines: ({ currentRegime, confidenceDescriptor: confidence, alignmentDescriptor: alignment }) => [
      currentRegime === 'Expansion'
        ? 'Internal pressure has eased, though the recovery signal is not yet broad enough to confirm.'
        : `${currentRegime} remains the backdrop even as conditions appear to steady.`,
      `This is a stabilization watch with ${alignment} and ${confidence}.`,
    ],
    forwardNarrativeLine: () => 'Recovery attempts are forming, but confirmation is still limited and setbacks remain possible.',
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
  overlay_unavailable: {
    summaryLine: () => 'Interpretive overlay unavailable.',
    detailLines: () => [
      'Base engine remains active; narrative layer not generated today.',
      'Final Decision continues to reflect the underlying risk engine.',
    ],
    subtext: STANDARD_INTERPRETATION_SUBTEXT,
  },
}

export function buildStandardInterpretationDisplayModel(
  input: StandardInterpretationSource
): StandardInterpretationDisplayModel {
  if (!hasStandardInterpretationSource(input)) {
    const template = STANDARD_NARRATIVE_TEMPLATES.overlay_unavailable
    const fallbackContext: StandardTemplateContext = {
      currentRegime: normalizeRegime(input.market_regime?.regime),
      alignmentDescriptor: 'mixed alignment',
      confidenceDescriptor: 'limited confidence',
      mode: input.master_signal?.mode ?? 'ALL_CLEAR',
      hasEarlySignal: false,
      hasBroadDivergence: false,
      hasCreditConfirmation: false,
    }
    return {
      summaryLine: template.summaryLine(fallbackContext),
      detailLines: template.detailLines(fallbackContext),
      forwardNarrativeLine: template.forwardNarrativeLine?.(fallbackContext),
      interpretationState: 'UNAVAILABLE',
      currentRegime: fallbackContext.currentRegime,
      agreementScore: Number.NaN,
      conflictScore: Number.NaN,
      trustScore: Number.NaN,
      subtext: template.subtext,
      isFallback: true,
    }
  }

  const currentRegime = normalizeRegime(input.market_regime?.regime)
  const rule = rulePressure(input)
  const regime = regimePressure(currentRegime)
  const scenario = scenarioPressure(input.risk_scenario?.scenario)
  const agreementScore = buildAgreementScore(input, rule, regime, scenario)
  const conflictScore = buildConflictScore(input, rule, regime, scenario, agreementScore)
  const trustScore = buildTrustScore(input, agreementScore, conflictScore)
  const rawInterpretationState = buildInterpretationState(input, currentRegime)
  const narrativeState = buildNarrativeState(input, currentRegime, rawInterpretationState)
  const templateKey = selectTemplateKey(narrativeState, input, currentRegime)
  const template = STANDARD_NARRATIVE_TEMPLATES[templateKey]
  const forwardNarrativeCategory = buildForwardNarrativeCategory(
    narrativeState,
    currentRegime,
    agreementScore,
    conflictScore,
    trustScore
  )
  const templateContext: StandardTemplateContext = {
    currentRegime,
    alignmentDescriptor: alignmentDescriptor(agreementScore, conflictScore),
    confidenceDescriptor: confidenceDescriptor(trustScore),
    mode: input.master_signal?.mode ?? 'ALL_CLEAR',
    hasEarlySignal: (input.track_a_early?.state ?? 'Normal') !== 'Normal',
    hasBroadDivergence: Boolean(input.breadth?.divergence),
    hasCreditConfirmation: Boolean(input.track_a?.stage0),
  }

  return {
    summaryLine: template.summaryLine(templateContext),
    detailLines: template.detailLines(templateContext),
    forwardNarrativeLine:
      buildForwardNarrativeLine(narrativeState, forwardNarrativeCategory) ??
      template.forwardNarrativeLine?.(templateContext),
    interpretationState: narrativeState,
    currentRegime,
    agreementScore,
    conflictScore,
    trustScore,
    subtext: template.subtext,
    isFallback: false,
  }
}
