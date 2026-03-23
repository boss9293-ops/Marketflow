import type { OverlayHumanReadable } from './interpretationMapper'
import { buildOverlayHumanReadable } from './interpretationMapper'

export type ArenaOverlayWarningState =
  | 'NORMAL'
  | 'WATCH'
  | 'ALERT'
  | 'DEFENSE_READY'
  | 'DEFENSE_ACTIVE'
  | 'RECOVERY_MODE'

export type ArenaOverlayScenarioHint = 'V' | 'Correction' | 'Bear' | 'Mixed'
export type ArenaOverlayRegime =
  | 'NORMAL'
  | 'SELLOFF'
  | 'PANIC'
  | 'BOTTOMING'
  | 'RECOVERY'

export interface ArenaMonteCarloOverlayView {
  mcCrashRiskScore: number
  mcBearPathSimilarity: number
  mcVShapeOdds20d: number
  mcRecoveryOdds20d: number
  mcCashStressRisk: number
  mcFalseRecoveryRisk: number
  mcWarningConfidence: number
  dominantMcScenario: ArenaOverlayScenarioHint
  mcCurrentRegime: ArenaOverlayRegime
  mcNextStateOdds: Record<ArenaOverlayRegime, number>
  mcPanicPersistenceRisk: number
  mcRecoveryTransitionOdds: number
  mcRegimeConfidence: number
  mcAgreementScore: number
  mcConflictScore: number
  mcInterpretationState:
    | 'STRONG_BEAR_CONFIRMATION'
    | 'WEAK_BEAR'
    | 'MIXED'
    | 'EARLY_RECOVERY'
    | 'FALSE_RECOVERY_RISK'
    | 'HIGH_UNCERTAINTY'
  mcAgreementReason: string
  mcTrustScore: number
  mcCalibrationBucket: 'HIGH_CONFIDENCE' | 'MEDIUM_CONFIDENCE' | 'LOW_CONFIDENCE'
  overlayReason: string
}

export interface ArenaOverlayDisplayModel {
  warningState: ArenaOverlayWarningState
  warningReason: string | null
  scenarioHint: ArenaOverlayScenarioHint
  mcOverlay: ArenaMonteCarloOverlayView | null
  interpretationAlignment: 'ALIGNED' | 'CONFLICTED' | 'NEUTRAL'
  interpretationNote: string
  humanReadable: OverlayHumanReadable
}

const WARNING_STATE_SEVERITY: Record<ArenaOverlayWarningState, number> = {
  NORMAL: 0,
  WATCH: 1,
  ALERT: 2,
  DEFENSE_READY: 3,
  DEFENSE_ACTIVE: 4,
  RECOVERY_MODE: 3,
}

function buildInterpretationNote(args: {
  scenarioHint: ArenaOverlayScenarioHint
  mcOverlay: ArenaMonteCarloOverlayView | null
  interpretationAlignment: ArenaOverlayDisplayModel['interpretationAlignment']
}) {
  if (!args.mcOverlay) {
    return 'Monte Carlo overlay unavailable. Rule-based warning remains the primary layer.'
  }
  return args.mcOverlay.mcAgreementReason
}

export function buildArenaOverlayDisplayModel(args: {
  warningState: ArenaOverlayWarningState
  warningReason: string | null
  scenarioHint: ArenaOverlayScenarioHint
  mcOverlay: ArenaMonteCarloOverlayView | null
}): ArenaOverlayDisplayModel {
  let interpretationAlignment: ArenaOverlayDisplayModel['interpretationAlignment'] = 'NEUTRAL'

  if (args.mcOverlay) {
    if (args.mcOverlay.mcConflictScore >= 60) {
      interpretationAlignment = 'CONFLICTED'
    } else if (args.mcOverlay.mcAgreementScore >= 65) {
      interpretationAlignment = 'ALIGNED'
    } else if (
      WARNING_STATE_SEVERITY[args.warningState] >= WARNING_STATE_SEVERITY.DEFENSE_READY &&
      args.mcOverlay.mcWarningConfidence < 45
    ) {
      interpretationAlignment = 'CONFLICTED'
    }
  }

  return {
    warningState: args.warningState,
    warningReason: args.warningReason,
    scenarioHint: args.scenarioHint,
    mcOverlay: args.mcOverlay,
    interpretationAlignment,
    interpretationNote: buildInterpretationNote({
      scenarioHint: args.scenarioHint,
      mcOverlay: args.mcOverlay,
      interpretationAlignment,
    }),
    humanReadable: buildOverlayHumanReadable({
      warningState: args.warningState,
      scenarioHint: args.scenarioHint,
      overlay: args.mcOverlay,
    }),
  }
}
