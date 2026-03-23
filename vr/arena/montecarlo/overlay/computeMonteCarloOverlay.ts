import { formatOverlayReason } from './formatOverlayReason'
import { computeRegimeOverlay } from './computeRegimeOverlay'
import { computeAgreementOverlay } from './computeAgreementOverlay'
import { computeTrustScore } from '../calibration/computeTrustScore'

import type {
  CurrentMarketFeatureVector,
  MonteCarloCalibrationTable,
  MonteCarloOverlayScore,
  SimilarMonteCarloPath,
  WarningScenarioHint,
} from '../types'

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))))
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

function smoothPathProbability(raw: number, baseline: number, sampleCount: number) {
  const confidence = Math.min(0.8, sampleCount / 20)
  return clampScore(raw * confidence + baseline * (1 - confidence))
}

function dominantScenario(similarPaths: SimilarMonteCarloPath[]): WarningScenarioHint {
  if (!similarPaths.length) return 'Mixed'

  const scores = new Map<WarningScenarioHint, number>([
    ['V', 0],
    ['Correction', 0],
    ['Bear', 0],
    ['Mixed', 0],
  ])

  for (const path of similarPaths) {
    scores.set(
      path.fingerprint.dominantScenario,
      (scores.get(path.fingerprint.dominantScenario) ?? 0) + path.similarityScore
    )
  }

  return Array.from(scores.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'Mixed'
}

export function computeMonteCarloOverlay(args: {
  current: CurrentMarketFeatureVector
  similarPaths: SimilarMonteCarloPath[]
  calibrationTable?: MonteCarloCalibrationTable | null
}): MonteCarloOverlayScore {
  if (!args.similarPaths.length) {
    return {
      mcCrashRiskScore: 0,
      mcBearPathSimilarity: 0,
      mcVShapeOdds20d: 0,
      mcRecoveryOdds20d: 0,
      mcCashStressRisk: 0,
      mcFalseRecoveryRisk: 0,
      mcWarningConfidence: 0,
      dominantMcScenario: 'Mixed',
      mcCurrentRegime: 'NORMAL',
      mcNextStateOdds: {
        NORMAL: 1,
        SELLOFF: 0,
        PANIC: 0,
        BOTTOMING: 0,
        RECOVERY: 0,
      },
      mcPanicPersistenceRisk: 0,
      mcRecoveryTransitionOdds: 0,
      mcRegimeConfidence: 0,
      mcAgreementScore: 0,
      mcConflictScore: 0,
      mcInterpretationState: 'HIGH_UNCERTAINTY',
      mcAgreementReason: 'Monte Carlo overlay has no comparable path library yet.',
      mcTrustScore: 0,
      mcCalibrationBucket: 'LOW_CONFIDENCE',
      overlayReason: 'Monte Carlo overlay has no comparable path library yet.',
    }
  }

  const dominantMcScenario = dominantScenario(args.similarPaths)
  const regimeOverlay = computeRegimeOverlay({
    similarPaths: args.similarPaths,
  })
  const rawCrashContinuation = weightedAverage(args.similarPaths, (path) =>
    path.fingerprint.continuationRisk ? 100 : 0
  )
  const mcBearPathSimilarity = weightedAverage(args.similarPaths, (path) =>
    path.fingerprint.dominantScenario === 'Bear' ? 100 : path.fingerprint.dominantScenario === 'Mixed' ? 50 : 0
  )
  const mcVShapeOdds20d = weightedAverage(args.similarPaths, (path) =>
    path.fingerprint.vShape20d ? 100 : 0
  )
  const rawRecoveryOdds20d = weightedAverage(args.similarPaths, (path) =>
    path.fingerprint.recovery20d ? 100 : 0
  )
  const mcCashStressRisk = weightedAverage(args.similarPaths, (path) =>
    path.fingerprint.cashStress ? 100 : 0
  )
  const rawFalseRecoveryRisk = weightedAverage(args.similarPaths, (path) =>
    path.fingerprint.falseRecovery ? 100 : 0
  )
  const mcWarningConfidence = weightedAverage(args.similarPaths, (path) =>
    path.fingerprint.warningConfidenceScore ?? 50
  )
  let mcRecoveryOdds20d = smoothPathProbability(
    rawRecoveryOdds20d,
    dominantMcScenario === 'V' ? 58 : dominantMcScenario === 'Correction' ? 44 : 28,
    args.similarPaths.length
  )

  if (regimeOverlay.mcPanicPersistenceRisk > 70) {
    const recoveryCap = Math.max(
      34,
      82 - (regimeOverlay.mcPanicPersistenceRisk - 70) * 1.5
    )
    mcRecoveryOdds20d = Math.min(mcRecoveryOdds20d, recoveryCap)
  }

  if (regimeOverlay.mcRecoveryTransitionOdds > 70) {
    const persistenceCap = Math.max(
      34,
      82 - (regimeOverlay.mcRecoveryTransitionOdds - 70) * 1.5
    )
    regimeOverlay.mcPanicPersistenceRisk = Math.min(
      regimeOverlay.mcPanicPersistenceRisk,
      persistenceCap
    )
  }

  const relationalFalseRecoveryRisk = clampScore(
    regimeOverlay.mcPanicPersistenceRisk * 0.65 +
      (100 - regimeOverlay.mcRecoveryTransitionOdds) * 0.35 +
      (dominantMcScenario === 'V' && regimeOverlay.mcCurrentRegime !== 'RECOVERY' ? 8 : 0)
  )
  const mcFalseRecoveryRisk = clampScore(
    rawFalseRecoveryRisk * 0.45 + relationalFalseRecoveryRisk * 0.55
  )

  const agreementOverlay = computeAgreementOverlay({
    current: args.current,
    dominantMcScenario,
    mcCurrentRegime: regimeOverlay.mcCurrentRegime,
    mcRegimeConfidence: regimeOverlay.mcRegimeConfidence,
    mcWarningConfidence,
    mcPanicPersistenceRisk: regimeOverlay.mcPanicPersistenceRisk,
  })
  const trustOverlay = computeTrustScore({
    interpretationState: agreementOverlay.mcInterpretationState,
    agreementScore: agreementOverlay.mcAgreementScore,
    conflictScore: agreementOverlay.mcConflictScore,
    regimeConfidence: regimeOverlay.mcRegimeConfidence,
    calibrationTable: args.calibrationTable,
  })
  const mcCrashRiskScore = clampScore(
    rawCrashContinuation * 0.7 +
      mcBearPathSimilarity * 0.3 -
      mcRecoveryOdds20d * 0.35 -
      (dominantMcScenario === 'V' ? 10 : 0)
  )

  const overlay: MonteCarloOverlayScore = {
    mcCrashRiskScore,
    mcBearPathSimilarity,
    mcVShapeOdds20d,
    mcRecoveryOdds20d,
    mcCashStressRisk,
    mcFalseRecoveryRisk,
    mcWarningConfidence,
    dominantMcScenario,
    mcCurrentRegime: regimeOverlay.mcCurrentRegime,
    mcNextStateOdds: regimeOverlay.mcNextStateOdds,
    mcPanicPersistenceRisk: regimeOverlay.mcPanicPersistenceRisk,
    mcRecoveryTransitionOdds: regimeOverlay.mcRecoveryTransitionOdds,
    mcRegimeConfidence: regimeOverlay.mcRegimeConfidence,
    mcAgreementScore: agreementOverlay.mcAgreementScore,
    mcConflictScore: agreementOverlay.mcConflictScore,
    mcInterpretationState: agreementOverlay.mcInterpretationState,
    mcAgreementReason: agreementOverlay.mcAgreementReason,
    mcTrustScore: trustOverlay.mcTrustScore,
    mcCalibrationBucket: trustOverlay.mcCalibrationBucket,
    overlayReason: '',
  }

  overlay.overlayReason = formatOverlayReason(overlay, args.current)
  return overlay
}
