export const LIVE_WINDOWS = {
  decision: 20,
  context: 60,
} as const

export const LIVE_THRESHOLDS = {
  calm: { mps: 50, vix: 20 },
  watch: { mps: 60, vix: 25 },
  unstable: { mps: 70, vix: 30 },
  stress: { mps: 70, vix: 30 },
  shock: { vix: 30, worst5d: -5 },
} as const

export type LiveRegimeStatus = 'CALM' | 'WATCH' | 'UNSTABLE' | 'STRESS' | 'SHOCK'

export function classifyLiveRegime({
  mps,
  vix,
  worst5d,
}: {
  mps: number | null
  vix: number | null
  worst5d: number | null
}): LiveRegimeStatus {
  const mpsVal = mps ?? 0
  const vixVal = vix ?? 0
  const worst = worst5d ?? 0
  if (vixVal >= LIVE_THRESHOLDS.shock.vix && worst <= LIVE_THRESHOLDS.shock.worst5d) return 'SHOCK'
  if (mpsVal >= LIVE_THRESHOLDS.stress.mps || vixVal >= LIVE_THRESHOLDS.stress.vix) return 'STRESS'
  if (mpsVal >= LIVE_THRESHOLDS.unstable.mps || vixVal >= LIVE_THRESHOLDS.unstable.vix) return 'UNSTABLE'
  if (mpsVal >= LIVE_THRESHOLDS.watch.mps || vixVal >= LIVE_THRESHOLDS.watch.vix) return 'WATCH'
  return 'CALM'
}
