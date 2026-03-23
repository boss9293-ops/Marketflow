import type {
  MonteCarloOverlayScore,
  RegimeState,
  SimilarMonteCarloPath,
} from '../types'

const REGIME_STATES: RegimeState[] = [
  'NORMAL',
  'SELLOFF',
  'PANIC',
  'BOTTOMING',
  'RECOVERY',
]

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))))
}

function buildEmptyNextStateOdds(): Record<RegimeState, number> {
  return {
    NORMAL: 1,
    SELLOFF: 0,
    PANIC: 0,
    BOTTOMING: 0,
    RECOVERY: 0,
  }
}

function normalizeOdds(weights: Record<RegimeState, number>) {
  const totalWeight = REGIME_STATES.reduce((sum, state) => sum + weights[state], 0)
  if (totalWeight <= 0) {
    return buildEmptyNextStateOdds()
  }

  const odds = {} as Record<RegimeState, number>
  let runningTotal = 0

  for (const state of REGIME_STATES) {
    const value = Number((weights[state] / totalWeight).toFixed(6))
    odds[state] = value
    runningTotal += value
  }

  const remainder = Number((1 - runningTotal).toFixed(6))
  if (Math.abs(remainder) > 0.000001) {
    const topState = REGIME_STATES.reduce((best, state) =>
      weights[state] > weights[best] ? state : best
    )
    odds[topState] = Number((odds[topState] + remainder).toFixed(6))
  }

  return odds
}

function blendOddsWithUniform(
  rawOdds: Record<RegimeState, number>,
  sampleCount: number
) {
  const confidence = Math.min(0.8, sampleCount / 20)
  const uniformWeight = 1 / REGIME_STATES.length
  const blended = {} as Record<RegimeState, number>

  for (const state of REGIME_STATES) {
    blended[state] = rawOdds[state] * confidence + uniformWeight * (1 - confidence)
  }

  return normalizeOdds(blended)
}

function weightedAverage(
  similarPaths: SimilarMonteCarloPath[],
  selector: (path: SimilarMonteCarloPath) => number
) {
  if (!similarPaths.length) return 0
  const totalWeight = similarPaths.reduce((sum, path) => sum + path.similarityScore, 0)
  if (totalWeight <= 0) return 0
  return clampScore(
    similarPaths.reduce((sum, path) => sum + selector(path) * path.similarityScore, 0) /
      totalWeight
  )
}

function fallbackCurrentRegime(path: SimilarMonteCarloPath): RegimeState {
  const fingerprint = path.fingerprint as SimilarMonteCarloPath['fingerprint'] & {
    currentRegime?: RegimeState
  }
  if (fingerprint.currentRegime) {
    return fingerprint.currentRegime
  }
  if (fingerprint.referenceWarningState === 'RECOVERY_MODE') return 'RECOVERY'
  if (fingerprint.referenceWarningState === 'DEFENSE_ACTIVE') return 'PANIC'
  if (fingerprint.referenceWarningState === 'DEFENSE_READY') return 'SELLOFF'
  if (fingerprint.dominantScenario === 'Bear') return 'BOTTOMING'
  return 'NORMAL'
}

function fallbackNextRegime(path: SimilarMonteCarloPath, currentRegime: RegimeState): RegimeState {
  const fingerprint = path.fingerprint as SimilarMonteCarloPath['fingerprint'] & {
    nextRegime?: RegimeState
  }
  if (fingerprint.nextRegime) {
    return fingerprint.nextRegime
  }
  if (fingerprint.recovery20d) return 'RECOVERY'
  if (fingerprint.continuationRisk) {
    return currentRegime === 'PANIC' ? 'BOTTOMING' : 'PANIC'
  }
  return currentRegime
}

function baselinePanicPersistence(regime: RegimeState) {
  switch (regime) {
    case 'PANIC':
      return 65
    case 'BOTTOMING':
      return 55
    case 'SELLOFF':
      return 40
    case 'RECOVERY':
      return 22
    default:
      return 18
  }
}

function baselineRecoveryTransition(regime: RegimeState) {
  switch (regime) {
    case 'RECOVERY':
      return 70
    case 'BOTTOMING':
      return 45
    case 'SELLOFF':
      return 28
    case 'PANIC':
      return 18
    default:
      return 30
  }
}

function smoothScore(raw: number, baseline: number, sampleCount: number) {
  const confidence = Math.min(0.8, sampleCount / 20)
  return clampScore(raw * confidence + baseline * (1 - confidence))
}

function coupleOpposingScores(left: number, right: number) {
  let coupledLeft = left
  let coupledRight = right

  if (coupledLeft > 70) {
    const rightCap = Math.max(32, 80 - (coupledLeft - 70) * 1.6)
    coupledRight = Math.min(coupledRight, rightCap)
  }
  if (coupledRight > 70) {
    const leftCap = Math.max(32, 80 - (coupledRight - 70) * 1.6)
    coupledLeft = Math.min(coupledLeft, leftCap)
  }

  return [clampScore(coupledLeft), clampScore(coupledRight)] as const
}

export function computeRegimeOverlay(args: {
  similarPaths: SimilarMonteCarloPath[]
}): Pick<
  MonteCarloOverlayScore,
  | 'mcCurrentRegime'
  | 'mcNextStateOdds'
  | 'mcPanicPersistenceRisk'
  | 'mcRecoveryTransitionOdds'
  | 'mcRegimeConfidence'
> {
  if (!args.similarPaths.length) {
    return {
      mcCurrentRegime: 'NORMAL',
      mcNextStateOdds: buildEmptyNextStateOdds(),
      mcPanicPersistenceRisk: 0,
      mcRecoveryTransitionOdds: 0,
      mcRegimeConfidence: 0,
    }
  }

  const currentStateWeights = {
    NORMAL: 0,
    SELLOFF: 0,
    PANIC: 0,
    BOTTOMING: 0,
    RECOVERY: 0,
  } satisfies Record<RegimeState, number>

  const nextStateWeights = {
    NORMAL: 0,
    SELLOFF: 0,
    PANIC: 0,
    BOTTOMING: 0,
    RECOVERY: 0,
  } satisfies Record<RegimeState, number>

  for (const path of args.similarPaths) {
    const currentRegime = fallbackCurrentRegime(path)
    const nextRegime = fallbackNextRegime(path, currentRegime)
    currentStateWeights[currentRegime] += path.similarityScore
    nextStateWeights[nextRegime] += path.similarityScore
  }

  const totalCurrentWeight = REGIME_STATES.reduce(
    (sum, state) => sum + currentStateWeights[state],
    0
  )
  const mcCurrentRegime = REGIME_STATES.reduce((best, state) =>
    currentStateWeights[state] > currentStateWeights[best] ? state : best
  )
  const mcRegimeConfidence =
    totalCurrentWeight > 0
      ? clampScore((currentStateWeights[mcCurrentRegime] / totalCurrentWeight) * 100)
      : 0
  const rawNextStateOdds = normalizeOdds(nextStateWeights)
  const mcNextStateOdds = blendOddsWithUniform(rawNextStateOdds, args.similarPaths.length)
  const rawPanicPersistenceRisk = weightedAverage(args.similarPaths, (path) =>
    ((path.fingerprint as SimilarMonteCarloPath['fingerprint'] & { panicPersistence?: boolean })
      .panicPersistence ??
      (path.fingerprint.continuationRisk &&
        fallbackCurrentRegime(path) !== 'RECOVERY')) ? 100 : 0
  )
  const rawRecoveryTransitionOdds = weightedAverage(args.similarPaths, (path) =>
    ((path.fingerprint as SimilarMonteCarloPath['fingerprint'] & { recoveryTransition?: boolean })
      .recoveryTransition ?? path.fingerprint.recovery20d) ? 100 : 0
  )

  let mcPanicPersistenceRisk = smoothScore(
    rawPanicPersistenceRisk,
    baselinePanicPersistence(mcCurrentRegime),
    args.similarPaths.length
  )
  let mcRecoveryTransitionOdds = smoothScore(
    rawRecoveryTransitionOdds,
    baselineRecoveryTransition(mcCurrentRegime),
    args.similarPaths.length
  )

  const panicStructuralBias = clampScore(
    mcNextStateOdds.PANIC * 100 +
      mcNextStateOdds.BOTTOMING * 55 +
      (mcCurrentRegime === 'PANIC' ? 18 : mcCurrentRegime === 'BOTTOMING' ? 10 : 0)
  )
  const recoveryStructuralBias = clampScore(
    mcNextStateOdds.RECOVERY * 100 +
      (mcCurrentRegime === 'RECOVERY' ? 15 : mcCurrentRegime === 'BOTTOMING' ? 6 : 0)
  )

  mcPanicPersistenceRisk = clampScore(
    mcPanicPersistenceRisk * 0.72 + panicStructuralBias * 0.28
  )
  mcRecoveryTransitionOdds = clampScore(
    mcRecoveryTransitionOdds * 0.72 + recoveryStructuralBias * 0.28
  )

  ;[mcPanicPersistenceRisk, mcRecoveryTransitionOdds] = coupleOpposingScores(
    mcPanicPersistenceRisk,
    mcRecoveryTransitionOdds
  )

  if (
    mcCurrentRegime === 'RECOVERY' &&
    mcNextStateOdds.RECOVERY >= mcNextStateOdds.PANIC &&
    mcRecoveryTransitionOdds >= 60
  ) {
    mcPanicPersistenceRisk = Math.min(mcPanicPersistenceRisk, 48)
  }

  if (
    mcCurrentRegime === 'PANIC' &&
    mcNextStateOdds.PANIC + mcNextStateOdds.BOTTOMING >= 0.55 &&
    mcPanicPersistenceRisk >= 60
  ) {
    mcRecoveryTransitionOdds = Math.min(mcRecoveryTransitionOdds, 58)
  }

  return {
    mcCurrentRegime,
    mcNextStateOdds,
    mcPanicPersistenceRisk,
    mcRecoveryTransitionOdds,
    mcRegimeConfidence,
  }
}
