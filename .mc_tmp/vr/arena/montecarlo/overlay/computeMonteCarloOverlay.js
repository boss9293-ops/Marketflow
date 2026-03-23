"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMonteCarloOverlay = computeMonteCarloOverlay;
const formatOverlayReason_1 = require("./formatOverlayReason");
function clampScore(value) {
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}
function weightedAverage(similarPaths, selector) {
    if (!similarPaths.length)
        return 0;
    const totalWeight = similarPaths.reduce((sum, path) => sum + path.similarityScore, 0);
    if (totalWeight <= 0)
        return 0;
    return clampScore(similarPaths.reduce((sum, path) => sum + selector(path) * path.similarityScore, 0) /
        totalWeight);
}
function dominantScenario(similarPaths) {
    if (!similarPaths.length)
        return 'Mixed';
    const scores = new Map([
        ['V', 0],
        ['Correction', 0],
        ['Bear', 0],
        ['Mixed', 0],
    ]);
    for (const path of similarPaths) {
        scores.set(path.fingerprint.dominantScenario, (scores.get(path.fingerprint.dominantScenario) ?? 0) + path.similarityScore);
    }
    return Array.from(scores.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'Mixed';
}
function computeMonteCarloOverlay(args) {
    if (!args.similarPaths.length) {
        return {
            mcCrashRiskScore: 0,
            mcBearPathSimilarity: 0,
            mcVShapeOdds20d: 0,
            mcRecoveryOdds20d: 0,
            mcCashStressRisk: 0,
            mcFalseRecoveryRisk: 0,
            mcWarningConfidence: 0,
            dominantMcScenario: 'Mixed',
            overlayReason: 'Monte Carlo overlay has no comparable path library yet.',
        };
    }
    const dominantMcScenario = dominantScenario(args.similarPaths);
    const rawCrashContinuation = weightedAverage(args.similarPaths, (path) => path.fingerprint.continuationRisk ? 100 : 0);
    const mcBearPathSimilarity = weightedAverage(args.similarPaths, (path) => path.fingerprint.dominantScenario === 'Bear' ? 100 : path.fingerprint.dominantScenario === 'Mixed' ? 50 : 0);
    const mcVShapeOdds20d = weightedAverage(args.similarPaths, (path) => path.fingerprint.vShape20d ? 100 : 0);
    const mcRecoveryOdds20d = weightedAverage(args.similarPaths, (path) => path.fingerprint.recovery20d ? 100 : 0);
    const mcCashStressRisk = weightedAverage(args.similarPaths, (path) => path.fingerprint.cashStress ? 100 : 0);
    const mcFalseRecoveryRisk = weightedAverage(args.similarPaths, (path) => path.fingerprint.falseRecovery ? 100 : 0);
    const mcWarningConfidence = weightedAverage(args.similarPaths, (path) => path.fingerprint.warningConfidenceScore ?? 50);
    const mcCrashRiskScore = clampScore(rawCrashContinuation * 0.7 +
        mcBearPathSimilarity * 0.3 -
        mcRecoveryOdds20d * 0.35 -
        (dominantMcScenario === 'V' ? 10 : 0));
    const overlay = {
        mcCrashRiskScore,
        mcBearPathSimilarity,
        mcVShapeOdds20d,
        mcRecoveryOdds20d,
        mcCashStressRisk,
        mcFalseRecoveryRisk,
        mcWarningConfidence,
        dominantMcScenario,
        overlayReason: '',
    };
    overlay.overlayReason = (0, formatOverlayReason_1.formatOverlayReason)(overlay, args.current);
    return overlay;
}
