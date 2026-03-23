import type {
  ArenaMonteCarloOverlayView,
  ArenaOverlayScenarioHint,
  ArenaOverlayWarningState,
} from './buildArenaOverlayDisplayModel'

export interface OverlayHumanReadable {
  summaryLine: string
  detailLines: string[]
}

function confidencePhrase(bucket: ArenaMonteCarloOverlayView['mcCalibrationBucket']) {
  switch (bucket) {
    case 'HIGH_CONFIDENCE':
      return 'high'
    case 'MEDIUM_CONFIDENCE':
      return 'moderate'
    default:
      return 'low'
  }
}

function alignmentPhrase(agreementScore: number, conflictScore: number) {
  if (conflictScore >= 60) return 'Signals remain conflicted across the interpretation stack.'
  if (agreementScore >= 75) return 'Rule-based warning, MC overlay, and regime context are strongly aligned.'
  if (agreementScore >= 55) return 'Signals show partial alignment rather than full confirmation.'
  return 'Alignment remains limited across rule, MC, and regime layers.'
}

function regimePhrase(regime: ArenaMonteCarloOverlayView['mcCurrentRegime']) {
  switch (regime) {
    case 'PANIC':
      return 'Regime context remains in a panic phase.'
    case 'BOTTOMING':
      return 'Regime context remains in a bottoming phase.'
    case 'RECOVERY':
      return 'Regime context has transitioned into a recovery phase.'
    case 'SELLOFF':
      return 'Regime context remains in a selloff phase.'
    default:
      return 'Regime context remains near a normal state.'
  }
}

function scenarioPhrase(args: {
  scenarioHint: ArenaOverlayScenarioHint
  warningState: ArenaOverlayWarningState
  overlay: ArenaMonteCarloOverlayView
}) {
  if (args.overlay.dominantMcScenario === 'Mixed') {
    return 'MC paths remain mixed without a dominant directional scenario.'
  }
  if (args.scenarioHint === args.overlay.dominantMcScenario) {
    return `Rule-based scenario and MC overlay are both consistent with a ${args.overlay.dominantMcScenario.toLowerCase()} path.`
  }
  return `Rule-based scenario remains ${args.scenarioHint.toLowerCase()}, while MC paths lean ${args.overlay.dominantMcScenario.toLowerCase()}.`
}

function persistencePhrase(overlay: ArenaMonteCarloOverlayView) {
  if (overlay.mcCurrentRegime === 'RECOVERY') {
    return `Recovery transition odds are ${Math.round(overlay.mcRecoveryTransitionOdds)}, while panic persistence risk is ${Math.round(overlay.mcPanicPersistenceRisk)}.`
  }
  return `Panic persistence risk is ${Math.round(overlay.mcPanicPersistenceRisk)}, while recovery transition odds are ${Math.round(overlay.mcRecoveryTransitionOdds)}.`
}

function trustPhrase(overlay: ArenaMonteCarloOverlayView) {
  return `Historical reliability for this configuration is ${confidencePhrase(overlay.mcCalibrationBucket)} at ${Math.round(overlay.mcTrustScore)}.`
}

function buildSummaryLine(overlay: ArenaMonteCarloOverlayView) {
  switch (overlay.mcInterpretationState) {
    case 'STRONG_BEAR_CONFIRMATION':
      return 'Downside pressure is structurally confirmed with high confidence.'
    case 'FALSE_RECOVERY_RISK':
      return 'Rebound signals appear, but structural instability suggests risk of failure.'
    case 'EARLY_RECOVERY':
      return 'Early recovery signals are emerging, though confirmation is still limited.'
    case 'WEAK_BEAR':
      return 'Bearish pressure remains, but structural alignment is not yet strong.'
    case 'HIGH_UNCERTAINTY':
      return 'Signals are mixed and confidence is low.'
    default:
      return 'Market signals are currently mixed without a dominant direction.'
  }
}

export function buildOverlayHumanReadable(args: {
  warningState: ArenaOverlayWarningState
  scenarioHint: ArenaOverlayScenarioHint
  overlay: ArenaMonteCarloOverlayView | null
}): OverlayHumanReadable {
  if (!args.overlay) {
    return {
      summaryLine: 'Monte Carlo overlay is currently unavailable.',
      detailLines: [
        'Rule-based warning remains the primary layer.',
        'Overlay availability does not change warning or execution behavior.',
      ],
    }
  }

  const overlay = args.overlay
  const detailLines = [alignmentPhrase(overlay.mcAgreementScore, overlay.mcConflictScore)]

  switch (overlay.mcInterpretationState) {
    case 'STRONG_BEAR_CONFIRMATION':
      detailLines.push(regimePhrase(overlay.mcCurrentRegime))
      detailLines.push(trustPhrase(overlay))
      break
    case 'FALSE_RECOVERY_RISK':
      detailLines.push(
        overlay.mcCurrentRegime === 'RECOVERY'
          ? 'MC rebound evidence improved, but regime stability remains incomplete.'
          : 'MC rebound evidence improved, but regime context has not yet moved into recovery.'
      )
      detailLines.push(persistencePhrase(overlay))
      break
    case 'EARLY_RECOVERY':
      detailLines.push(regimePhrase(overlay.mcCurrentRegime))
      detailLines.push(
        `Trust remains ${confidencePhrase(overlay.mcCalibrationBucket)} because confirmation is still early-stage.`
      )
      break
    case 'WEAK_BEAR':
      detailLines.push(regimePhrase(overlay.mcCurrentRegime))
      detailLines.push(
        `MC bear confirmation remains limited, with agreement ${Math.round(overlay.mcAgreementScore)} and trust ${Math.round(overlay.mcTrustScore)}.`
      )
      break
    case 'HIGH_UNCERTAINTY':
      detailLines.push('Regime confidence remains low and MC paths do not converge on one structure.')
      detailLines.push(trustPhrase(overlay))
      break
    case 'MIXED':
      detailLines.push(scenarioPhrase(args))
      detailLines.push(trustPhrase(overlay))
      break
  }

  return {
    summaryLine: buildSummaryLine(overlay),
    detailLines: detailLines.slice(0, 3),
  }
}
