import type {
  MonteCarloCalibrationBucket,
  MonteCarloCalibrationTable,
  MonteCarloInterpretationState,
  MonteCarloOverlayScore,
} from '../types'

export const DEFAULT_CALIBRATION_PRIORS: Record<MonteCarloInterpretationState, number> = {
  STRONG_BEAR_CONFIRMATION: 0.74,
  WEAK_BEAR: 0.55,
  FALSE_RECOVERY_RISK: 0.67,
  EARLY_RECOVERY: 0.5,
  MIXED: 0.36,
  HIGH_UNCERTAINTY: 0.24,
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))))
}

function resolveCalibrationBucket(score: number): MonteCarloCalibrationBucket {
  if (score > 70) return 'HIGH_CONFIDENCE'
  if (score >= 40) return 'MEDIUM_CONFIDENCE'
  return 'LOW_CONFIDENCE'
}

function resolveBaseReliability(args: {
  interpretationState: MonteCarloInterpretationState
  calibrationTable?: MonteCarloCalibrationTable | null
}) {
  return (
    args.calibrationTable?.[args.interpretationState]?.calibratedReliability ??
    DEFAULT_CALIBRATION_PRIORS[args.interpretationState]
  )
}

export function computeTrustScore(args: {
  interpretationState: MonteCarloInterpretationState
  agreementScore: number
  conflictScore: number
  regimeConfidence: number
  calibrationTable?: MonteCarloCalibrationTable | null
}): Pick<MonteCarloOverlayScore, 'mcTrustScore' | 'mcCalibrationBucket'> {
  const baseReliability = resolveBaseReliability(args)
  const baseScore = baseReliability * 100
  const agreementAdjustment = (args.agreementScore - 50) * 0.18
  const regimeAdjustment = (args.regimeConfidence - 50) * 0.12
  const conflictPenalty = args.conflictScore * 0.1

  const mcTrustScore = clampScore(
    baseScore + agreementAdjustment + regimeAdjustment - conflictPenalty
  )

  return {
    mcTrustScore,
    mcCalibrationBucket: resolveCalibrationBucket(mcTrustScore),
  }
}
