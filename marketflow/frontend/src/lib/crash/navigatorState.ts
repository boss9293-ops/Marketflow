export type NavigatorStateName =
  | 'NORMAL'
  | 'ACCELERATION_WATCH'
  | 'DEFENSE_MODE'
  | 'PANIC_EXTENSION'
  | 'STABILIZATION'
  | 'STRUCTURAL_MODE'

export type NavigatorInput = {
  date?: string
  close: number
  ret_1d: number
  ret_2d: number
  ret_3d: number
  ma50: number | null
  ma200: number | null
  dd_60d: number
}

export type NavigatorEvidence = {
  ret_2d: number
  ret_3d: number
  dd_60d: number
  ma50: number | null
  ma200: number | null
  above_ma50: boolean | null
  above_ma200: boolean | null
}

export type NavigatorTriggerDistance = {
  defense_ret2: number | null
  defense_ret3: number | null
  panic_ret3: number | null
}

export type NavigatorMeta = {
  days_since_low: number
  last_low: number | null
  below_ma200_days: number
  lower_high_streak: number
  false_bounce_guard: boolean
  ret3d_tail_pct: number | null
  pending_deescalation: boolean
  pending_target: NavigatorStateName | null
  pending_days: number
}

export type NavigatorOutput = {
  date?: string
  state: NavigatorStateName
  evidence: NavigatorEvidence
  trigger_distance: NavigatorTriggerDistance
  meta: NavigatorMeta
}

export type NavigatorOptions = {
  stabilization_days?: number
  watch_ret2?: number
  watch_ret3?: number
  def_ret2?: number
  def_ret3?: number
  panic_ret3?: number
  ret3d_history?: number[]
  min_history?: number
}

function numOrNull(value: number | undefined | null): number | null {
  if (value === null || value === undefined) return null
  if (Number.isNaN(value)) return null
  return value
}

function upperBound(sorted: number[], value: number) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (sorted[mid] <= value) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

export function computeNavigatorStates(
  rows: NavigatorInput[],
  options: NavigatorOptions = {}
): NavigatorOutput[] {
  const stabilizationDays = options.stabilization_days ?? 3
  const watchRet2 = options.watch_ret2 ?? -0.09
  const watchRet3 = options.watch_ret3 ?? -0.13
  const defRet2 = options.def_ret2 ?? -0.1
  const defRet3 = options.def_ret3 ?? -0.16
  const panicRet3 = options.panic_ret3 ?? -0.19
  const minHistory = options.min_history ?? 252

  const closes: number[] = []
  let lastLow = Number.POSITIVE_INFINITY
  let lastLowIndex = -1
  let prevCommitted: NavigatorStateName = 'NORMAL'
  let belowMa200Days = 0
  let lowerHighStreak = 0
  let stabilizationStart = -1
  let stabilizationLow = Number.POSITIVE_INFINITY
  let candidateState: NavigatorStateName | null = null
  let candidateDays = 0

  const historyRaw =
    options.ret3d_history && options.ret3d_history.length > 0
      ? options.ret3d_history
      : rows.map((r) => r.ret_3d).filter((v) => Number.isFinite(v))
  const histSorted = historyRaw.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  const hasHistory = histSorted.length >= minHistory

  const orderMap: Record<NavigatorStateName, number> = {
    NORMAL: 0,
    ACCELERATION_WATCH: 1,
    STABILIZATION: 2,
    DEFENSE_MODE: 3,
    PANIC_EXTENSION: 4,
    STRUCTURAL_MODE: 3,
  }

  return rows.map((row, idx) => {
    const ret2 = row.ret_2d
    const ret3 = row.ret_3d

    closes.push(row.close)

    if (Number.isFinite(row.close) && row.close < lastLow) {
      lastLow = row.close
      lastLowIndex = idx
    }

    const daysSinceLow = lastLowIndex >= 0 ? idx - lastLowIndex : 0

    if (row.ma200 !== null && Number.isFinite(row.ma200)) {
      if (row.close < row.ma200) {
        belowMa200Days += 1
      } else {
        belowMa200Days = 0
      }
    } else {
      belowMa200Days = 0
    }

    const currentHigh20 =
      closes.length >= 20 ? Math.max(...closes.slice(-20)) : Number.NEGATIVE_INFINITY
    const prevHigh20 =
      closes.length >= 40 ? Math.max(...closes.slice(-40, -20)) : Number.NEGATIVE_INFINITY
    const lowerHigh = prevHigh20 !== Number.NEGATIVE_INFINITY && currentHigh20 < prevHigh20
    if (lowerHigh) {
      lowerHighStreak += 1
    } else {
      lowerHighStreak = 0
    }

    const structuralMode = belowMa200Days >= 30 && lowerHighStreak >= 5

    let rawState: NavigatorStateName = 'NORMAL'

    if (ret3 <= panicRet3) {
      rawState = 'PANIC_EXTENSION'
    } else if (ret2 <= defRet2 || ret3 <= defRet3) {
      rawState = 'DEFENSE_MODE'
    } else if (structuralMode) {
      rawState = 'STRUCTURAL_MODE'
    } else if (ret2 <= watchRet2 || ret3 <= watchRet3) {
      rawState = 'ACCELERATION_WATCH'
    } else if (
      (prevCommitted === 'PANIC_EXTENSION' || prevCommitted === 'DEFENSE_MODE') &&
      ret3 > 0 &&
      daysSinceLow >= stabilizationDays
    ) {
      rawState = 'STABILIZATION'
    }

    let committed = prevCommitted
    let pending = false

    if (rawState === 'STRUCTURAL_MODE') {
      committed = 'STRUCTURAL_MODE'
      candidateState = null
      candidateDays = 0
    } else {
      const rawOrder = orderMap[rawState]
      const prevOrder = orderMap[prevCommitted]
      if (rawOrder > prevOrder) {
        committed = rawState
        candidateState = null
        candidateDays = 0
      } else if (rawOrder < prevOrder) {
        if (candidateState === rawState) {
          candidateDays += 1
        } else {
          candidateState = rawState
          candidateDays = 1
        }
        if (candidateDays >= 2) {
          committed = rawState
          candidateState = null
          candidateDays = 0
        } else {
          committed = prevCommitted
          pending = true
        }
      } else {
        committed = prevCommitted
        candidateState = null
        candidateDays = 0
      }
    }

    let falseBounceGuard = false
    if (committed === 'STABILIZATION') {
      if (stabilizationStart < 0 || prevCommitted !== 'STABILIZATION') {
        stabilizationStart = idx
        stabilizationLow = row.close
      } else {
        const daysFromStart = idx - stabilizationStart
        if (daysFromStart <= 3 && row.close < stabilizationLow) {
          falseBounceGuard = true
          committed = 'ACCELERATION_WATCH'
          stabilizationStart = -1
          stabilizationLow = Number.POSITIVE_INFINITY
        }
      }
    } else if (prevCommitted !== 'STABILIZATION') {
      stabilizationStart = -1
      stabilizationLow = Number.POSITIVE_INFINITY
    }

    const evidence: NavigatorEvidence = {
      ret_2d: ret2,
      ret_3d: ret3,
      dd_60d: row.dd_60d,
      ma50: row.ma50,
      ma200: row.ma200,
      above_ma50: row.ma50 === null ? null : row.close > row.ma50,
      above_ma200: row.ma200 === null ? null : row.close > row.ma200,
    }

    const trigger_distance: NavigatorTriggerDistance = {
      defense_ret2: numOrNull(ret2) === null ? null : ret2 - defRet2,
      defense_ret3: numOrNull(ret3) === null ? null : ret3 - defRet3,
      panic_ret3: numOrNull(ret3) === null ? null : ret3 - panicRet3,
    }

    const tailPct =
      hasHistory && Number.isFinite(ret3)
        ? (upperBound(histSorted, ret3) / histSorted.length) * 100
        : null

    const out: NavigatorOutput = {
      date: row.date,
      state: committed,
      evidence,
      trigger_distance,
      meta: {
        days_since_low: daysSinceLow,
        last_low: Number.isFinite(lastLow) ? lastLow : null,
        below_ma200_days: belowMa200Days,
        lower_high_streak: lowerHighStreak,
        false_bounce_guard: falseBounceGuard,
        ret3d_tail_pct: tailPct,
        pending_deescalation: pending,
        pending_target: pending ? candidateState : null,
        pending_days: pending ? candidateDays : 0,
      },
    }

    prevCommitted = committed
    return out
  })
}
