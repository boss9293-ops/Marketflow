import type { CurrentMarketFeatureVector } from '../types'

function normalize(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(value.toFixed(2))
    : null
}

export function buildCurrentMarketFeatureVector(args: {
  dd3: number | null
  dd5: number | null
  dd6: number | null
  peakDD: number | null
  reboundFromLow: number | null
  ma200Gap: number | null
  warningState: CurrentMarketFeatureVector['warningState']
  scenarioHint: CurrentMarketFeatureVector['scenarioHint']
}): CurrentMarketFeatureVector {
  return {
    dd3: normalize(args.dd3),
    dd5: normalize(args.dd5),
    dd6: normalize(args.dd6),
    peakDD: normalize(args.peakDD),
    reboundFromLow: normalize(args.reboundFromLow),
    ma200Gap: normalize(args.ma200Gap),
    warningState: args.warningState,
    scenarioHint: args.scenarioHint,
  }
}
