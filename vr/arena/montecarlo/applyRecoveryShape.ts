import type { CrashSeverity, RecoveryShape } from './types'

const SHAPE_END_RECOVERY: Record<RecoveryShape, Record<CrashSeverity, number>> = {
  V_SHAPE: { MILD: 0.95, SHARP: 0.85, SEVERE: 0.75 },
  DEAD_CAT: { MILD: 0.2, SHARP: 0.15, SEVERE: 0.1 },
  GRINDING_BEAR: { MILD: 0.18, SHARP: 0.12, SEVERE: 0.08 },
  DELAYED_RECOVERY: { MILD: 0.6, SHARP: 0.5, SEVERE: 0.4 },
}

const NOISE_SCALE: Record<RecoveryShape, number> = {
  V_SHAPE: 0.35,
  DEAD_CAT: 0.45,
  GRINDING_BEAR: 0.5,
  DELAYED_RECOVERY: 0.4,
}

function clampReturn(value: number) {
  return Number(Math.max(-0.95, Math.min(1.5, value)).toFixed(8))
}

function getRecoveryProgress(args: {
  shape: RecoveryShape
  progress: number
  endRecovery: number
}) {
  const { shape, progress, endRecovery } = args
  const u = Math.max(0, Math.min(1, progress))

  switch (shape) {
    case 'V_SHAPE':
      return endRecovery * (1 - (1 - u) ** 2.4)
    case 'DEAD_CAT': {
      const bouncePeak = Math.min(0.55, endRecovery + 0.35)
      if (u <= 0.35) {
        const phase = u / 0.35
        return bouncePeak * (1 - (1 - phase) ** 2)
      }
      const fadePhase = (u - 0.35) / 0.65
      return bouncePeak + (endRecovery - bouncePeak) * fadePhase
    }
    case 'GRINDING_BEAR':
      return Math.max(
        0,
        endRecovery * u + Math.sin(u * Math.PI * 4) * endRecovery * 0.12
      )
    case 'DELAYED_RECOVERY':
      if (u <= 0.5) {
        return endRecovery * 0.08 * (u / 0.5)
      }
      return endRecovery * (0.08 + ((u - 0.5) / 0.5) * 0.92)
  }
}

export function applyRecoveryShape(args: {
  returns: number[]
  crashEndIndex: number
  recoveryLengthDays: number
  recoveryShape: RecoveryShape
  severity: CrashSeverity
  crashReturns: number[]
  baseRecoveryReturns?: number[]
}) {
  const nextReturns = [...args.returns]
  const recoveryStart = args.crashEndIndex
  const recoveryEnd = Math.min(nextReturns.length, recoveryStart + args.recoveryLengthDays)
  if (recoveryStart >= recoveryEnd) return nextReturns

  const crashMultiplier = args.crashReturns.reduce(
    (value, dailyReturn) => value * (1 + dailyReturn),
    1
  )
  const endRecovery = SHAPE_END_RECOVERY[args.recoveryShape][args.severity]
  const baseRecoveryReturns = args.baseRecoveryReturns ?? []
  let previousSyntheticPrice = crashMultiplier

  for (let index = recoveryStart; index < recoveryEnd; index += 1) {
    const progress =
      recoveryEnd - recoveryStart <= 1
        ? 1
        : (index - recoveryStart + 1) / (recoveryEnd - recoveryStart)
    const recoveryProgress = getRecoveryProgress({
      shape: args.recoveryShape,
      progress,
      endRecovery,
    })
    const targetPrice =
      crashMultiplier + (1 - crashMultiplier) * recoveryProgress
    const shapedReturn = previousSyntheticPrice > 0
      ? targetPrice / previousSyntheticPrice - 1
      : 0
    const baseNoise =
      baseRecoveryReturns[index - recoveryStart] ?? 0
    const adjustedReturn = clampReturn(
      shapedReturn + baseNoise * NOISE_SCALE[args.recoveryShape]
    )

    nextReturns[index] = adjustedReturn
    previousSyntheticPrice *= 1 + adjustedReturn
  }

  return nextReturns
}
