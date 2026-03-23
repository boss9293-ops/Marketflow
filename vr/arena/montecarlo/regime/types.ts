export type RegimeState =
  | 'NORMAL'
  | 'SELLOFF'
  | 'PANIC'
  | 'BOTTOMING'
  | 'RECOVERY'

export interface RegimeLabelPoint {
  dayIndex: number
  state: RegimeState
  dd3: number | null
  dd5: number | null
  dd6: number | null
  peakDD: number | null
  reboundFromLow: number | null
  ma200Gap: number | null
}

export interface RegimeStateStats {
  state: RegimeState
  meanReturn: number
  volReturn: number
  avgDurationDays: number
  minReturn: number | null
  maxReturn: number | null
}

export type RegimeTransitionMatrix = Record<RegimeState, Record<RegimeState, number>>

export interface RegimeModel {
  states: RegimeState[]
  transitionMatrix: RegimeTransitionMatrix
  stateStats: Record<RegimeState, RegimeStateStats>
}

export interface RegimeMonteCarloConfig {
  horizonDays: number
  nPaths: number
  startPrice: number
  initialState?: RegimeState
  randomSeed?: number
}
