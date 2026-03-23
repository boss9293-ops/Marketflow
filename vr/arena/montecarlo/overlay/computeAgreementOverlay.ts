import type {
  CurrentMarketFeatureVector,
  MonteCarloOverlayScore,
  RegimeState,
  WarningScenarioHint,
  WarningState,
} from '../types'

type DirectionBias = 'BEAR' | 'NEUTRAL' | 'RECOVERY'

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))))
}

function scoreToBias(value: number): DirectionBias {
  if (value <= -0.35) return 'BEAR'
  if (value >= 0.35) return 'RECOVERY'
  return 'NEUTRAL'
}

function ruleSignalValue(warningState: WarningState) {
  switch (warningState) {
    case 'DEFENSE_ACTIVE':
      return -1
    case 'DEFENSE_READY':
      return -0.9
    case 'ALERT':
      return -0.65
    case 'WATCH':
      return -0.25
    case 'RECOVERY_MODE':
      return 0.7
    default:
      return 0
  }
}

function mcScenarioValue(scenario: WarningScenarioHint) {
  switch (scenario) {
    case 'Bear':
      return -0.9
    case 'Correction':
      return -0.3
    case 'V':
      return 0.8
    default:
      return 0
  }
}

function regimeValue(regime: RegimeState) {
  switch (regime) {
    case 'PANIC':
      return -1
    case 'BOTTOMING':
      return -0.65
    case 'SELLOFF':
      return -0.45
    case 'RECOVERY':
      return 0.85
    default:
      return 0.05
  }
}

function pairAgreement(left: number, right: number) {
  return Math.max(0, 1 - Math.abs(left - right) / 2)
}

function buildAgreementReason(state: MonteCarloOverlayScore['mcInterpretationState']) {
  switch (state) {
    case 'STRONG_BEAR_CONFIRMATION':
      return 'Rule, MC, and regime context all align around bearish structure.'
    case 'WEAK_BEAR':
      return 'Rule warning remains defensive, but MC and regime confirmation are only partial.'
    case 'FALSE_RECOVERY_RISK':
      return 'MC rebound evidence conflicts with a still-unstable structural regime backdrop.'
    case 'EARLY_RECOVERY':
      return 'Recovery evidence improved in MC and regime context before the rule warning fully relaxed.'
    case 'HIGH_UNCERTAINTY':
      return 'Agreement is low and regime conviction is weak across similar paths.'
    default:
      return 'Rule warning, MC scenario, and regime context are not yet pointing in one clear direction.'
  }
}

export function computeAgreementOverlay(args: {
  current: CurrentMarketFeatureVector
  dominantMcScenario: WarningScenarioHint
  mcCurrentRegime: RegimeState
  mcRegimeConfidence: number
  mcWarningConfidence: number
  mcPanicPersistenceRisk?: number
}): Pick<
  MonteCarloOverlayScore,
  'mcAgreementScore' | 'mcConflictScore' | 'mcInterpretationState' | 'mcAgreementReason'
> {
  const ruleValue = ruleSignalValue(args.current.warningState)
  const mcValue = mcScenarioValue(args.dominantMcScenario)
  const regimeValueScore = regimeValue(args.mcCurrentRegime)

  const ruleBias = scoreToBias(ruleValue)
  const mcBias = scoreToBias(mcValue)
  const regimeBias = scoreToBias(regimeValueScore)

  const mcWeightFactor = args.dominantMcScenario === 'Mixed' ? 0.55 : 1
  const regimeWeightFactor = args.mcRegimeConfidence < 50 ? 0.75 : 1

  const weightedPairs = [
    { weight: 0.4 * mcWeightFactor, score: pairAgreement(ruleValue, mcValue) },
    { weight: 0.3 * mcWeightFactor * regimeWeightFactor, score: pairAgreement(mcValue, regimeValueScore) },
    { weight: 0.3 * regimeWeightFactor, score: pairAgreement(ruleValue, regimeValueScore) },
  ]
  const totalWeight = weightedPairs.reduce((sum, pair) => sum + pair.weight, 0)
  const mcAgreementScore =
    totalWeight > 0
      ? clampScore(
          (weightedPairs.reduce((sum, pair) => sum + pair.score * pair.weight, 0) / totalWeight) *
            100
        )
      : 0

  let penalty = 0

  const directRuleMcContradiction =
    (ruleBias === 'BEAR' && mcBias === 'RECOVERY') ||
    (ruleBias === 'RECOVERY' && mcBias === 'BEAR')
  const directRuleRegimeContradiction =
    (ruleBias === 'BEAR' && regimeBias === 'RECOVERY') ||
    (ruleBias === 'RECOVERY' && regimeBias === 'BEAR')
  const directMcRegimeContradiction =
    (mcBias === 'BEAR' && regimeBias === 'RECOVERY') ||
    (mcBias === 'RECOVERY' && regimeBias === 'BEAR')

  if (directRuleMcContradiction) penalty += 45
  if (directMcRegimeContradiction) penalty += 28
  if (directRuleRegimeContradiction) penalty += 27
  if (args.dominantMcScenario === 'Mixed') penalty += 18
  if (args.mcRegimeConfidence < 45) penalty += (45 - args.mcRegimeConfidence) * 0.6
  if (args.mcWarningConfidence < 45) penalty += (45 - args.mcWarningConfidence) * 0.4

  const mcConflictScore = clampScore(penalty)
  const panicPersistenceRisk =
    typeof args.mcPanicPersistenceRisk === 'number'
      ? args.mcPanicPersistenceRisk
      : args.mcCurrentRegime === 'PANIC' || args.mcCurrentRegime === 'BOTTOMING'
        ? 65
        : args.mcCurrentRegime === 'RECOVERY'
          ? 25
          : 35

  let mcInterpretationState: MonteCarloOverlayScore['mcInterpretationState'] = 'MIXED'

  if (
    mcAgreementScore >= 75 &&
    ruleBias === 'BEAR' &&
    mcBias === 'BEAR' &&
    (args.mcCurrentRegime === 'PANIC' || args.mcCurrentRegime === 'BOTTOMING')
  ) {
    mcInterpretationState = 'STRONG_BEAR_CONFIRMATION'
  } else if (
    args.dominantMcScenario === 'V' &&
    args.mcCurrentRegime !== 'RECOVERY' &&
    panicPersistenceRisk >= 40
  ) {
    mcInterpretationState = 'FALSE_RECOVERY_RISK'
  } else if (
    args.dominantMcScenario === 'V' &&
    args.mcCurrentRegime === 'RECOVERY' &&
    panicPersistenceRisk < 40
  ) {
    mcInterpretationState = 'EARLY_RECOVERY'
  } else if (
    ruleBias === 'BEAR' &&
    args.dominantMcScenario !== 'Bear' &&
    (args.mcCurrentRegime === 'NORMAL' || args.mcCurrentRegime === 'SELLOFF')
  ) {
    mcInterpretationState = 'WEAK_BEAR'
  } else if (
    (mcAgreementScore < 45 && args.mcRegimeConfidence < 45) ||
    (mcConflictScore >= 60 && args.mcRegimeConfidence < 35) ||
    (args.dominantMcScenario === 'Mixed' && args.mcRegimeConfidence < 45)
  ) {
    mcInterpretationState = 'HIGH_UNCERTAINTY'
  } else {
    mcInterpretationState = 'MIXED'
  }

  return {
    mcAgreementScore,
    mcConflictScore,
    mcInterpretationState,
    mcAgreementReason: buildAgreementReason(mcInterpretationState),
  }
}
