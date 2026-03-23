"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCurrentMarketFeatureVector = buildCurrentMarketFeatureVector;
function normalize(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Number(value.toFixed(2))
        : null;
}
function buildCurrentMarketFeatureVector(args) {
    return {
        dd3: normalize(args.dd3),
        dd5: normalize(args.dd5),
        dd6: normalize(args.dd6),
        peakDD: normalize(args.peakDD),
        reboundFromLow: normalize(args.reboundFromLow),
        ma200Gap: normalize(args.ma200Gap),
        warningState: args.warningState,
        scenarioHint: args.scenarioHint,
    };
}
