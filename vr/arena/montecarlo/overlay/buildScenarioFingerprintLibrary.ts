import type {
  ArenaStrategyKey,
  InjectedScenarioMeta,
  MonteCarloPath,
  MonteCarloScenarioFingerprint,
  MonteCarloStrategyRun,
  RegimeState,
  WarningQualityRun,
  WarningScenarioHint,
  WarningState,
  WarningTracePoint,
} from '../types'

const CONSTRAINED_STRATEGIES: ArenaStrategyKey[] = [
  'VR_ORIGINAL_CAPPED',
  'MA200_50',
  'MA200_LB30',
  'LB30',
  'LB25',
  'ADAPTIVE',
]

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint]
}

function findProxyAnchorDay(trace: WarningTracePoint[]) {
  return (
    trace.find(
      (point) =>
        (point.peakDD != null && point.peakDD <= -15) ||
        (point.dd5 != null && point.dd5 <= -12)
    )?.dayIndex ?? null
  )
}

function dominantScenarioFromTrace(trace: WarningTracePoint[]) {
  const counts = new Map<WarningScenarioHint, number>()
  for (const point of trace) {
    const hint = point.scenarioHint ?? 'Mixed'
    counts.set(hint, (counts.get(hint) ?? 0) + 1)
  }
  let winner: WarningScenarioHint = 'Mixed'
  let winnerCount = -1
  for (const [hint, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = hint
      winnerCount = count
    }
  }
  return winner
}

function mapRecoveryShapeToScenario(
  meta?: InjectedScenarioMeta | null
): WarningScenarioHint {
  switch (meta?.recoveryShape) {
    case 'V_SHAPE':
      return 'V'
    case 'GRINDING_BEAR':
      return 'Bear'
    case 'DELAYED_RECOVERY':
      return 'Correction'
    case 'DEAD_CAT':
      return 'Mixed'
    default:
      return 'Mixed'
  }
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))))
}

function inferRegimeStateFromPoint(point?: WarningTracePoint): RegimeState {
  if (!point) return 'NORMAL'

  if (
    (point.dd3 != null && point.dd3 <= -10) ||
    (point.dd5 != null && point.dd5 <= -15) ||
    (point.dd6 != null && point.dd6 <= -17) ||
    ((point.peakDD ?? 0) <= -25 && (point.dd5 ?? 0) <= -8)
  ) {
    return 'PANIC'
  }

  if (
    point.warningState === 'RECOVERY_MODE' ||
    ((point.reboundFromLow ?? 0) >= 10 && (point.dd3 ?? 0) > -3)
  ) {
    return 'RECOVERY'
  }

  if (
    (point.peakDD ?? 0) <= -20 &&
    (point.reboundFromLow ?? 0) >= 0 &&
    (point.reboundFromLow ?? 0) < 12
  ) {
    return 'BOTTOMING'
  }

  if (
    (point.dd3 != null && point.dd3 <= -5) ||
    (point.dd5 != null && point.dd5 <= -8) ||
    ((point.peakDD ?? 0) <= -10 && (point.ma200Gap ?? 0) <= -3)
  ) {
    return 'SELLOFF'
  }

  return 'NORMAL'
}

function buildRegimeTimeline(path: MonteCarloPath, trace: WarningTracePoint[]) {
  if (path.regimeStates?.length) {
    const aligned = [path.regimeStates[0] ?? 'NORMAL', ...path.regimeStates]
    return aligned.slice(0, trace.length || aligned.length)
  }
  return trace.map((point) => inferRegimeStateFromPoint(point))
}

function resolveCurrentRegime(regimeTimeline: RegimeState[], referenceIndex: number) {
  if (!regimeTimeline.length) return 'NORMAL' as RegimeState
  return regimeTimeline[Math.max(0, Math.min(referenceIndex, regimeTimeline.length - 1))] ?? 'NORMAL'
}

function resolveNextRegime(regimeTimeline: RegimeState[], referenceIndex: number) {
  if (!regimeTimeline.length) return 'NORMAL' as RegimeState
  const currentRegime = resolveCurrentRegime(regimeTimeline, referenceIndex)
  const searchEnd = Math.min(regimeTimeline.length - 1, referenceIndex + 10)
  for (let index = referenceIndex + 1; index <= searchEnd; index += 1) {
    const candidate = regimeTimeline[index]
    if (candidate && candidate !== currentRegime) {
      return candidate
    }
  }
  return currentRegime
}

function hasRegimeWithinWindow(
  regimeTimeline: RegimeState[],
  referenceIndex: number,
  targetState: RegimeState,
  windowDays: number
) {
  if (!regimeTimeline.length) return false
  const searchEnd = Math.min(regimeTimeline.length - 1, referenceIndex + windowDays)
  for (let index = referenceIndex; index <= searchEnd; index += 1) {
    if (regimeTimeline[index] === targetState) {
      return true
    }
  }
  return false
}

export function buildScenarioFingerprintLibrary(args: {
  paths: MonteCarloPath[]
  mcRuns: MonteCarloStrategyRun[]
  warningTrace: WarningTracePoint[]
  warningQualityRuns?: WarningQualityRun[]
  injectedScenarioMeta?: InjectedScenarioMeta[]
}): MonteCarloScenarioFingerprint[] {
  const traceByPath = new Map<string, WarningTracePoint[]>()
  for (const point of args.warningTrace) {
    const bucket = traceByPath.get(point.pathId) ?? []
    bucket.push(point)
    traceByPath.set(point.pathId, bucket)
  }

  const runsByPath = new Map<string, MonteCarloStrategyRun[]>()
  for (const run of args.mcRuns) {
    const bucket = runsByPath.get(run.pathId) ?? []
    bucket.push(run)
    runsByPath.set(run.pathId, bucket)
  }

  const qualityByPath = new Map<string, WarningQualityRun>()
  for (const run of args.warningQualityRuns ?? []) {
    qualityByPath.set(run.pathId, run)
  }

  const scenarioMetaByPath = new Map<string, InjectedScenarioMeta>()
  for (const meta of args.injectedScenarioMeta ?? []) {
    scenarioMetaByPath.set(meta.pathId, meta)
  }

  return args.paths.map((path) => {
    const trace = traceByPath.get(path.pathId) ?? []
    const pathRuns = runsByPath.get(path.pathId) ?? []
    const quality = qualityByPath.get(path.pathId)
    const scenarioMeta = scenarioMetaByPath.get(path.pathId) ?? path.scenarioMeta ?? null
    const anchorDay = scenarioMeta?.injectAtDay ?? findProxyAnchorDay(trace)
    const crashEndDay =
      anchorDay != null && scenarioMeta?.crashLengthDays != null
        ? anchorDay + scenarioMeta.crashLengthDays - 1
        : anchorDay
    const recoveryStartDay =
      anchorDay != null && scenarioMeta?.crashLengthDays != null
        ? anchorDay + scenarioMeta.crashLengthDays
        : anchorDay
    const reboundWindow = trace.filter(
      (point) =>
        recoveryStartDay != null &&
        point.dayIndex >= recoveryStartDay &&
        point.dayIndex <= recoveryStartDay + 20
    )
    const referencePoint =
      (anchorDay != null
        ? trace.find((point) => point.dayIndex >= anchorDay)
        : trace.find((point) => point.warningState !== 'NORMAL')) ??
      trace[trace.length - 1]
    const referenceIndex = referencePoint?.dayIndex ?? Math.max(0, trace.length - 1)
    const regimeTimeline = buildRegimeTimeline(path, trace)
    const currentRegime = resolveCurrentRegime(regimeTimeline, referenceIndex)
    const nextRegime = resolveNextRegime(regimeTimeline, referenceIndex)

    const dd3Values = trace.map((point) => point.dd3).filter((value): value is number => value != null)
    const dd5Values = trace.map((point) => point.dd5).filter((value): value is number => value != null)
    const dd6Values = trace.map((point) => point.dd6).filter((value): value is number => value != null)
    const peakDDValues = trace.map((point) => point.peakDD).filter((value): value is number => value != null)
    const ma200GapValues = trace.map((point) => point.ma200Gap).filter((value): value is number => value != null)
    const reboundValues = reboundWindow.length
      ? reboundWindow.map((point) => point.reboundFromLow).filter((value): value is number => value != null)
      : trace.map((point) => point.reboundFromLow).filter((value): value is number => value != null)

    const constrainedRuns = pathRuns.filter((run) => CONSTRAINED_STRATEGIES.includes(run.strategy))
    const cycleCapHits = constrainedRuns.reduce(
      (sum, run) => sum + (run.cycleCapHitCount ?? 0),
      0
    )
    const warningConfidenceScore = (() => {
      if (!quality) return null
      let score = 100
      if (quality.missedCrash) score -= 60
      if (typeof quality.leadTimeToAlert === 'number' && quality.leadTimeToAlert < 0) {
        score -= Math.min(30, Math.abs(quality.leadTimeToAlert) * 3)
      }
      if (
        typeof quality.leadTimeToDefenseReady === 'number' &&
        quality.leadTimeToDefenseReady < 0
      ) {
        score -= Math.min(20, Math.abs(quality.leadTimeToDefenseReady) * 2)
      }
      score -= quality.falseAlertCount * 10
      score -= quality.falseDefenseCount * 15
      if (
        typeof quality.recoveryDetectionLag === 'number' &&
        quality.recoveryDetectionLag > 20
      ) {
        score -= Math.min(20, quality.recoveryDetectionLag - 20)
      }
      return clampScore(score)
    })()

    const anchorPeakDD =
      anchorDay != null
        ? trace.find((point) => point.dayIndex >= anchorDay)?.peakDD ?? null
        : null
    const next20PeakDDValues = trace
      .filter(
        (point) =>
          anchorDay != null &&
          point.dayIndex >= anchorDay &&
          point.dayIndex <= anchorDay + 20 &&
          point.peakDD != null
      )
      .map((point) => point.peakDD as number)
    const minNext20PeakDD = next20PeakDDValues.length ? Math.min(...next20PeakDDValues) : null
    const rebound20d = reboundValues.length ? Number((Math.max(...reboundValues)).toFixed(2)) : null
    const dominantScenario = scenarioMeta?.injectionApplied
      ? mapRecoveryShapeToScenario(scenarioMeta)
      : dominantScenarioFromTrace(trace)
    const continuationRisk =
      dominantScenario === 'Bear' ||
      scenarioMeta?.recoveryShape === 'DEAD_CAT' ||
      ((anchorPeakDD != null &&
        minNext20PeakDD != null &&
        minNext20PeakDD <= anchorPeakDD - 5) &&
        (rebound20d == null || rebound20d < 12))

    const survivalStatsMap = new Map(pathRuns.map((run) => [run.strategy, run.finalEquity]))

    return {
      pathId: path.pathId,
      severity: scenarioMeta?.severity ?? null,
      recoveryShape: scenarioMeta?.recoveryShape ?? null,
      dd3Min: dd3Values.length ? Number(Math.min(...dd3Values).toFixed(2)) : null,
      dd5Min: dd5Values.length ? Number(Math.min(...dd5Values).toFixed(2)) : null,
      dd6Min: dd6Values.length ? Number(Math.min(...dd6Values).toFixed(2)) : null,
      peakDDMin: peakDDValues.length ? Number(Math.min(...peakDDValues).toFixed(2)) : null,
      rebound20d,
      ma200GapMin: ma200GapValues.length ? Number(Math.min(...ma200GapValues).toFixed(2)) : null,
      dominantScenario,
      referenceWarningState: referencePoint?.warningState ?? 'NORMAL',
      currentRegime,
      nextRegime,
      panicPersistence:
        currentRegime === 'PANIC'
          ? hasRegimeWithinWindow(regimeTimeline, referenceIndex, 'PANIC', 10)
          : hasRegimeWithinWindow(regimeTimeline, referenceIndex + 1, 'PANIC', 10),
      recoveryTransition:
        currentRegime === 'RECOVERY'
          ? true
          : hasRegimeWithinWindow(regimeTimeline, referenceIndex + 1, 'RECOVERY', 10),
      continuationRisk,
      vShape20d: dominantScenario === 'V' && rebound20d != null && rebound20d >= 15,
      recovery20d:
        (typeof quality?.recoveryDetectionLag === 'number' && quality.recoveryDetectionLag <= 20) ||
        (dominantScenario === 'V' && rebound20d != null && rebound20d >= 10) ||
        (dominantScenario === 'Correction' && rebound20d != null && rebound20d >= 12),
      cashStress: cycleCapHits > 0,
      falseRecovery:
        scenarioMeta?.recoveryShape === 'DEAD_CAT' ||
        (quality?.falseDefenseCount ?? 0) > 0 ||
        ((rebound20d ?? 0) >= 10 && continuationRisk),
      warningConfidenceScore,
      survivalStats: {
        buyHold: survivalStatsMap.get('BUY_HOLD') ?? null,
        vrOriginalCapped: survivalStatsMap.get('VR_ORIGINAL_CAPPED') ?? null,
        ma200_50: survivalStatsMap.get('MA200_50') ?? null,
        ma200_lb30: survivalStatsMap.get('MA200_LB30') ?? null,
        lb30: survivalStatsMap.get('LB30') ?? null,
        lb25: survivalStatsMap.get('LB25') ?? null,
        adaptive: survivalStatsMap.get('ADAPTIVE') ?? null,
      },
    }
  })
}
