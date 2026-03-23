import type { StrategyArenaSyntheticRun } from '../compute_strategy_arena'
import type {
  RegimeLabelPoint,
  RegimeModel,
  RegimeMonteCarloConfig,
  RegimeState,
  RegimeStateStats,
  RegimeTransitionMatrix,
} from './regime/types'

export type ArenaStrategyKey =
  | 'BUY_HOLD'
  | 'VR_ORIGINAL_CAPPED'
  | 'MA200_50'
  | 'MA200_LB30'
  | 'LB30'
  | 'LB25'
  | 'ADAPTIVE'

export type MonteCarloSourceSeries =
  | 'QQQ'
  | 'NDX'
  | 'TQQQ'
  | 'SYNTH_3X'

export type MonteCarloGeneratorMode =
  | 'BLOCK_BOOTSTRAP'
  | 'BLOCK_PLUS_INJECTION'
  | 'REGIME_STATE'

export type CrashSeverity = 'MILD' | 'SHARP' | 'SEVERE'

export type RecoveryShape =
  | 'V_SHAPE'
  | 'DEAD_CAT'
  | 'GRINDING_BEAR'
  | 'DELAYED_RECOVERY'

export type WarningState =
  | 'NORMAL'
  | 'WATCH'
  | 'ALERT'
  | 'DEFENSE_READY'
  | 'DEFENSE_ACTIVE'
  | 'RECOVERY_MODE'

export type WarningScenarioHint = 'V' | 'Correction' | 'Bear' | 'Mixed'

export interface CrashInjectionConfig {
  enabled: boolean
  injectAtDay?: number
  crashLengthDays: number
  recoveryLengthDays: number
  severity: CrashSeverity
  recoveryShape: RecoveryShape
  useHistoricalEpisodeTemplate?: boolean
  episodeTemplateKey?: string | null
}

export interface CrashEpisodeTemplate {
  key: string
  label: string
  source: 'HISTORICAL' | 'SYNTHETIC'
  crashReturns: number[]
  notes?: string
}

export interface InjectedScenarioMeta {
  pathId: string
  injectionApplied: boolean
  injectAtDay: number | null
  crashLengthDays: number | null
  recoveryLengthDays: number | null
  severity: CrashSeverity | null
  recoveryShape: RecoveryShape | null
  episodeTemplateKey: string | null
}

export interface WarningTracePoint {
  pathId: string
  dayIndex: number
  warningState: WarningState
  warningReason: string | null
  dd3: number | null
  dd5: number | null
  dd6: number | null
  peakDD: number | null
  reboundFromLow: number | null
  ma200Gap: number | null
  scenarioHint: WarningScenarioHint | null
}

export interface WarningEvent {
  pathId: string
  startDay: number
  peakWarningState: Exclude<WarningState, 'NORMAL'>
  endDay: number
  durationDays: number
  firstAlertDay: number | null
  firstDefenseReadyDay: number | null
  firstDefenseActiveDay: number | null
  firstRecoveryModeDay: number | null
}

export interface WarningQualityRun {
  pathId: string
  strategyContext?: string | null
  injectionApplied: boolean
  severity: CrashSeverity | null
  recoveryShape: RecoveryShape | null
  leadTimeToAlert: number | null
  leadTimeToDefenseReady: number | null
  leadTimeToDefenseActive: number | null
  missedCrash: boolean
  falseAlertCount: number
  falseDefenseCount: number
  recoveryDetectionLag: number | null
  warningPersistenceDays: number | null
}

export interface WarningQualitySummary {
  severity: CrashSeverity | 'ALL'
  recoveryShape: RecoveryShape | 'ALL'
  nRuns: number
  medianLeadTimeToAlert: number | null
  medianLeadTimeToDefenseReady: number | null
  medianLeadTimeToDefenseActive: number | null
  missedCrashRate: number
  avgFalseAlertCount: number
  avgFalseDefenseCount: number
  medianRecoveryDetectionLag: number | null
}

export interface CurrentMarketFeatureVector {
  dd3: number | null
  dd5: number | null
  dd6: number | null
  peakDD: number | null
  reboundFromLow: number | null
  ma200Gap: number | null
  warningState: WarningState
  scenarioHint: WarningScenarioHint
}

export interface MonteCarloScenarioFingerprint {
  pathId: string
  severity: CrashSeverity | null
  recoveryShape: RecoveryShape | null
  dd3Min: number | null
  dd5Min: number | null
  dd6Min: number | null
  peakDDMin: number | null
  rebound20d: number | null
  ma200GapMin: number | null
  dominantScenario: WarningScenarioHint
  referenceWarningState: WarningState
  currentRegime: RegimeState
  nextRegime: RegimeState
  panicPersistence: boolean
  recoveryTransition: boolean
  continuationRisk: boolean
  vShape20d: boolean
  recovery20d: boolean
  cashStress: boolean
  falseRecovery: boolean
  warningConfidenceScore: number | null
  survivalStats?: {
    buyHold: number | null
    vrOriginalCapped: number | null
    ma200_50: number | null
    ma200_lb30: number | null
    lb30: number | null
    lb25: number | null
    adaptive: number | null
  }
}

export interface SimilarMonteCarloPath {
  pathId: string
  distanceScore: number
  similarityScore: number
  fingerprint: MonteCarloScenarioFingerprint
}

export type MonteCarloInterpretationState =
  | 'STRONG_BEAR_CONFIRMATION'
  | 'WEAK_BEAR'
  | 'MIXED'
  | 'EARLY_RECOVERY'
  | 'FALSE_RECOVERY_RISK'
  | 'HIGH_UNCERTAINTY'

export type MonteCarloCalibrationBucket =
  | 'HIGH_CONFIDENCE'
  | 'MEDIUM_CONFIDENCE'
  | 'LOW_CONFIDENCE'

export interface MonteCarloCalibrationEntry {
  interpretationState: MonteCarloInterpretationState
  sampleCount: number
  successCount: number
  rawReliability: number
  calibratedReliability: number
  medianForwardReturn5d: number | null
  medianForwardReturn10d: number | null
  medianForwardReturn20d: number | null
  medianForwardMaxDrawdown20d: number | null
  medianForwardRebound20d: number | null
}

export type MonteCarloCalibrationTable = Record<
  MonteCarloInterpretationState,
  MonteCarloCalibrationEntry
>

export interface MonteCarloOverlayScore {
  mcCrashRiskScore: number
  mcBearPathSimilarity: number
  mcVShapeOdds20d: number
  mcRecoveryOdds20d: number
  mcCashStressRisk: number
  mcFalseRecoveryRisk: number
  mcWarningConfidence: number
  dominantMcScenario: WarningScenarioHint
  mcCurrentRegime: RegimeState
  mcNextStateOdds: Record<RegimeState, number>
  mcPanicPersistenceRisk: number
  mcRecoveryTransitionOdds: number
  mcRegimeConfidence: number
  mcAgreementScore: number
  mcConflictScore: number
  mcInterpretationState: MonteCarloInterpretationState
  mcAgreementReason: string
  mcTrustScore: number
  mcCalibrationBucket: MonteCarloCalibrationBucket
  overlayReason: string
}

export interface MonteCarloOverlayExample {
  current: CurrentMarketFeatureVector
  overlay: MonteCarloOverlayScore
  similarPathIds: string[]
}

export interface MonteCarloConfig {
  horizonDays: number
  blockSize: 5 | 10 | 20
  nPaths: number
  startPrice: number
  initialInvestedPct: number
  initialCashPct: number
  sourceSeries: MonteCarloSourceSeries
  randomSeed?: number
  generatorMode?: MonteCarloGeneratorMode
  crashInjection?: CrashInjectionConfig
  regimeConfig?: RegimeMonteCarloConfig
}

export interface MonteCarloPath {
  pathId: string
  blockSize: 5 | 10 | 20
  horizonDays: number
  sampledBlockStarts: number[]
  returns: number[]
  prices: number[]
  scenarioMeta?: InjectedScenarioMeta
  regimeStates?: RegimeState[]
}

export interface MonteCarloStrategyRun {
  pathId: string
  strategy: ArenaStrategyKey
  finalEquity: number
  maxDrawdown: number
  recoveryDays: number | null
  survival: boolean
  minCashPctObserved: number | null
  maxCapitalUsagePct: number | null
  cycleCapHitCount: number | null
  warningLeadTimeAvg: number | null
  falseDefenseRate: number | null
  missedReboundCost: number | null
  scenarioSeverity?: CrashSeverity | null
  scenarioRecoveryShape?: RecoveryShape | null
  scenarioTemplateKey?: string | null
}

export interface MonteCarloScenarioSliceSummary {
  strategy: ArenaStrategyKey
  severity: CrashSeverity
  recoveryShape: RecoveryShape
  nRuns: number
  survivalProbability: number
  medianFinalEquity: number
  medianMaxDrawdown: number
  medianRecoveryDays: number | null
}

export interface MonteCarloStrategySummary {
  strategy: ArenaStrategyKey
  nRuns: number
  medianFinalEquity: number
  p10FinalEquity: number
  p90FinalEquity: number
  medianMaxDrawdown: number
  p90MaxDrawdown: number
  medianRecoveryDays: number | null
  worst5RecoveryDays: number | null
  survivalProbability: number
  medianMinCashPctObserved: number | null
  medianMaxCapitalUsagePct: number | null
  medianCycleCapHitCount: number | null
  medianWarningLeadTime: number | null
  medianFalseDefenseRate: number | null
  medianMissedReboundCost: number | null
}

export interface MonteCarloMeta {
  generatorMode: MonteCarloGeneratorMode
  sourceSeries: MonteCarloSourceSeries
  horizonDays: number
  blockSize: 5 | 10 | 20
  nPaths: number
  randomSeed?: number
  initialInvestedPct: number
  initialCashPct: number
  strategies: ArenaStrategyKey[]
  crashInjection?: CrashInjectionConfig
  regimeConfig?: RegimeMonteCarloConfig
}

export interface MonteCarloRunOutput {
  runs: MonteCarloStrategyRun[]
  summaries: MonteCarloStrategySummary[]
  scenarioSliceSummaries: MonteCarloScenarioSliceSummary[]
  injectedScenarios: InjectedScenarioMeta[]
  warningTrace: WarningTracePoint[]
  warningEvents: WarningEvent[]
  warningQualityRuns: WarningQualityRun[]
  warningQualitySummaries: WarningQualitySummary[]
  scenarioFingerprintLibrary: MonteCarloScenarioFingerprint[]
  calibrationTable: MonteCarloCalibrationTable | null
  overlayExample: MonteCarloOverlayExample | null
  regimeModel: RegimeModel | null
  meta: MonteCarloMeta
}

export type MonteCarloArenaSyntheticRun = StrategyArenaSyntheticRun

export const FINAL_ARENA_STRATEGIES: ArenaStrategyKey[] = [
  'BUY_HOLD',
  'VR_ORIGINAL_CAPPED',
  'MA200_50',
  'MA200_LB30',
  'LB30',
  'LB25',
  'ADAPTIVE',
]

export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  horizonDays: 252,
  blockSize: 10,
  nPaths: 1000,
  startPrice: 100,
  initialInvestedPct: 0.8,
  initialCashPct: 0.2,
  sourceSeries: 'QQQ',
  randomSeed: 42,
  generatorMode: 'BLOCK_BOOTSTRAP',
  crashInjection: {
    enabled: false,
    crashLengthDays: 15,
    recoveryLengthDays: 40,
    severity: 'SHARP',
    recoveryShape: 'V_SHAPE',
    useHistoricalEpisodeTemplate: false,
    episodeTemplateKey: null,
  },
}

export const MONTE_CARLO_CONFIG_PRESETS: Record<'bs5' | 'bs10' | 'bs20', MonteCarloConfig> = {
  bs5: { ...DEFAULT_MONTE_CARLO_CONFIG, blockSize: 5 },
  bs10: { ...DEFAULT_MONTE_CARLO_CONFIG, blockSize: 10 },
  bs20: { ...DEFAULT_MONTE_CARLO_CONFIG, blockSize: 20 },
}

export type {
  RegimeLabelPoint,
  RegimeModel,
  RegimeMonteCarloConfig,
  RegimeState,
  RegimeStateStats,
  RegimeTransitionMatrix,
}
