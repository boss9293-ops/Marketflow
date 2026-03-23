import type {
  InjectedScenarioMeta,
  WarningEvent,
  WarningQualityRun,
  WarningState,
  WarningTracePoint,
} from './types'

const FALSE_ALERT_LOOKAHEAD_DAYS = 10
const FALSE_DEFENSE_LOOKAHEAD_DAYS = 10

function findProxyCrashAnchor(trace: WarningTracePoint[]) {
  return (
    trace.find(
      (point) =>
        (point.peakDD != null && point.peakDD <= -15) ||
        (point.dd5 != null && point.dd5 <= -12)
    )?.dayIndex ?? null
  )
}

function getTraceSlice(trace: WarningTracePoint[], startDay: number, endDay: number) {
  return trace.filter((point) => point.dayIndex >= startDay && point.dayIndex <= endDay)
}

function getFirstStateDay(
  trace: WarningTracePoint[],
  states: WarningState[],
  startDay: number,
  endDay: number
) {
  return (
    trace.find(
      (point) =>
        point.dayIndex >= startDay &&
        point.dayIndex <= endDay &&
        states.includes(point.warningState)
    )?.dayIndex ?? null
  )
}

function findPrimaryEvent(
  events: WarningEvent[],
  crashAnchorDay: number | null
) {
  if (!events.length) return null
  if (crashAnchorDay == null) return events[0]

  const overlapping = events.find(
    (event) => event.startDay <= crashAnchorDay && event.endDay >= crashAnchorDay
  )
  if (overlapping) return overlapping

  return events.reduce((best, event) => {
    const bestDistance = Math.min(
      Math.abs(best.startDay - crashAnchorDay),
      Math.abs(best.endDay - crashAnchorDay)
    )
    const eventDistance = Math.min(
      Math.abs(event.startDay - crashAnchorDay),
      Math.abs(event.endDay - crashAnchorDay)
    )
    return eventDistance < bestDistance ? event : best
  }, events[0])
}

function hasMeaningfulCrash(trace: WarningTracePoint[], startDay: number, endDay: number) {
  return getTraceSlice(trace, startDay, endDay).some(
    (point) =>
      (point.peakDD != null && point.peakDD <= -15) ||
      (point.dd5 != null && point.dd5 <= -12)
  )
}

function hasMeaningfulDefenseCase(trace: WarningTracePoint[], startDay: number, endDay: number) {
  return getTraceSlice(trace, startDay, endDay).some(
    (point) =>
      (point.peakDD != null && point.peakDD <= -20) ||
      (point.dd5 != null && point.dd5 <= -15)
  )
}

export function computeWarningQuality(args: {
  pathId: string
  trace: WarningTracePoint[]
  events: WarningEvent[]
  injectedScenarioMeta?: InjectedScenarioMeta | null
}): WarningQualityRun {
  const injected = args.injectedScenarioMeta?.injectionApplied === true
  const crashAnchorDay = injected
    ? args.injectedScenarioMeta?.injectAtDay ?? null
    : findProxyCrashAnchor(args.trace)
  const crashEndDay =
    injected && crashAnchorDay != null && args.injectedScenarioMeta?.crashLengthDays != null
      ? crashAnchorDay + args.injectedScenarioMeta.crashLengthDays - 1
      : crashAnchorDay != null
        ? crashAnchorDay + FALSE_ALERT_LOOKAHEAD_DAYS
        : null
  const recoveryStartDay =
    injected && crashAnchorDay != null && args.injectedScenarioMeta?.crashLengthDays != null
      ? crashAnchorDay + args.injectedScenarioMeta.crashLengthDays
      : null

  const evaluationWindowStart = crashAnchorDay != null ? Math.max(0, crashAnchorDay - 15) : 0
  const evaluationWindowEnd =
    crashEndDay != null
      ? crashEndDay + FALSE_DEFENSE_LOOKAHEAD_DAYS
      : args.trace[args.trace.length - 1]?.dayIndex ?? 0

  const firstAlertDay =
    crashAnchorDay != null
      ? getFirstStateDay(args.trace, ['ALERT'], evaluationWindowStart, evaluationWindowEnd)
      : null
  const firstDefenseReadyDay =
    crashAnchorDay != null
      ? getFirstStateDay(args.trace, ['DEFENSE_READY'], evaluationWindowStart, evaluationWindowEnd)
      : null
  const firstDefenseActiveDay =
    crashAnchorDay != null
      ? getFirstStateDay(args.trace, ['DEFENSE_ACTIVE'], evaluationWindowStart, evaluationWindowEnd)
      : null
  const firstRecoveryModeDay =
    recoveryStartDay != null
      ? getFirstStateDay(
          args.trace,
          ['RECOVERY_MODE'],
          Math.max(0, crashAnchorDay ?? 0),
          args.trace[args.trace.length - 1]?.dayIndex ?? recoveryStartDay
        )
      : null

  const falseAlertCount = args.events.filter((event) => {
    const endDay = event.startDay + FALSE_ALERT_LOOKAHEAD_DAYS
    const crashWithinWindow =
      crashAnchorDay != null &&
      crashAnchorDay >= event.startDay &&
      crashAnchorDay <= endDay
    return !crashWithinWindow && !hasMeaningfulCrash(args.trace, event.startDay, endDay)
  }).length

  const falseDefenseCount = args.events.filter((event) => {
    const defenseDay = event.firstDefenseReadyDay ?? event.firstDefenseActiveDay
    if (defenseDay == null) return false
    const endDay = defenseDay + FALSE_DEFENSE_LOOKAHEAD_DAYS
    const crashWithinWindow =
      crashAnchorDay != null && crashAnchorDay >= defenseDay && crashAnchorDay <= endDay
    return !crashWithinWindow && !hasMeaningfulDefenseCase(args.trace, defenseDay, endDay)
  }).length

  const missedCrash =
    crashAnchorDay != null &&
    crashEndDay != null &&
    getFirstStateDay(
      args.trace,
      ['ALERT', 'DEFENSE_READY', 'DEFENSE_ACTIVE'],
      crashAnchorDay,
      crashEndDay
    ) == null

  const primaryEvent = findPrimaryEvent(args.events, crashAnchorDay)

  return {
    pathId: args.pathId,
    strategyContext: null,
    injectionApplied: injected,
    severity: args.injectedScenarioMeta?.severity ?? null,
    recoveryShape: args.injectedScenarioMeta?.recoveryShape ?? null,
    leadTimeToAlert:
      crashAnchorDay != null && firstAlertDay != null ? crashAnchorDay - firstAlertDay : null,
    leadTimeToDefenseReady:
      crashAnchorDay != null && firstDefenseReadyDay != null
        ? crashAnchorDay - firstDefenseReadyDay
        : null,
    leadTimeToDefenseActive:
      crashAnchorDay != null && firstDefenseActiveDay != null
        ? crashAnchorDay - firstDefenseActiveDay
        : null,
    missedCrash,
    falseAlertCount,
    falseDefenseCount,
    recoveryDetectionLag:
      recoveryStartDay != null && firstRecoveryModeDay != null
        ? firstRecoveryModeDay - recoveryStartDay
        : null,
    warningPersistenceDays: primaryEvent?.durationDays ?? null,
  }
}
