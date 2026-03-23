import type { CurrentMarketFeatureVector, MonteCarloOverlayScore } from '../types'

export function formatOverlayReason(
  overlay: MonteCarloOverlayScore,
  current?: Pick<CurrentMarketFeatureVector, 'scenarioHint'>
) {
  const primaryParts: string[] = []
  const secondaryParts: string[] = []

  if (
    overlay.dominantMcScenario === 'V' &&
    overlay.mcRecoveryOdds20d >= Math.max(35, overlay.mcCrashRiskScore - 5)
  ) {
    primaryParts.push('Similar MC paths lean more toward rebound stabilization than extended bear continuation.')
  } else if (overlay.mcCrashRiskScore >= 65 || overlay.mcBearPathSimilarity >= 65) {
    primaryParts.push('Similar MC paths lean toward continued downside pressure rather than a clean rebound.')
  } else if (overlay.mcVShapeOdds20d >= 65 || overlay.mcRecoveryOdds20d >= 65) {
    primaryParts.push('Similar MC paths show better-than-usual recovery odds over the next 20 trading days.')
  }

  if (
    overlay.mcCurrentRegime === 'PANIC' ||
    overlay.mcCurrentRegime === 'BOTTOMING'
  ) {
    secondaryParts.push(
      `Regime analogs cluster around ${overlay.mcCurrentRegime.toLowerCase()} conditions rather than a fully normalized market state.`
    )
  } else if (
    overlay.mcCurrentRegime === 'RECOVERY' &&
    overlay.mcRecoveryTransitionOdds >= 55
  ) {
    secondaryParts.push('Regime analogs increasingly point toward recovery-state transition rather than renewed panic.')
  }

  if (overlay.mcFalseRecoveryRisk >= 25) {
    secondaryParts.push('False-recovery risk remains elevated, so rebounds should be treated cautiously.')
  } else if (overlay.mcPanicPersistenceRisk >= 60) {
    secondaryParts.push('Panic persistence risk remains elevated across similar stress paths.')
  } else if (overlay.mcWarningConfidence >= 65) {
    secondaryParts.push('Historical and synthetic analogs suggest the current warning state has been reasonably informative.')
  }

  let conflictNote: string | null = null
  if (current && current.scenarioHint !== overlay.dominantMcScenario) {
    conflictNote =
      `Rule-based hint (${current.scenarioHint}) and MC overlay (${overlay.dominantMcScenario}) are not fully aligned.`
  }

  const parts = [...primaryParts]

  if (conflictNote) {
    parts.push(conflictNote)
  } else if (secondaryParts.length) {
    parts.push(secondaryParts[0])
  }

  if (!parts.length) {
    return 'Monte Carlo overlay is mixed. It is interpretive, not executable.'
  }

  return parts.slice(0, 2).join(' ')
}
