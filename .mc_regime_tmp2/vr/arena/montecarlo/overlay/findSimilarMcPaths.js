"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findSimilarMonteCarloPaths = findSimilarMonteCarloPaths;
const WARNING_STATE_SEVERITY = {
    NORMAL: 0,
    WATCH: 1,
    ALERT: 2,
    DEFENSE_READY: 3,
    DEFENSE_ACTIVE: 4,
    RECOVERY_MODE: 3,
};
const NUMERIC_FEATURES = [
    { currentKey: 'dd3', fingerprintKey: 'dd3Min', weight: 1.5, scale: 15 },
    { currentKey: 'dd5', fingerprintKey: 'dd5Min', weight: 2.5, scale: 20 },
    { currentKey: 'dd6', fingerprintKey: 'dd6Min', weight: 1.5, scale: 20 },
    { currentKey: 'peakDD', fingerprintKey: 'peakDDMin', weight: 2.5, scale: 40 },
    { currentKey: 'reboundFromLow', fingerprintKey: 'rebound20d', weight: 2, scale: 40 },
    { currentKey: 'ma200Gap', fingerprintKey: 'ma200GapMin', weight: 2, scale: 20 },
];
function toSimilarity(distanceScore) {
    return Number((100 / (1 + distanceScore)).toFixed(2));
}
function findSimilarMonteCarloPaths(args) {
    const scored = args.library.map((fingerprint) => {
        let distanceScore = 0;
        let contributingFeatures = 0;
        for (const feature of NUMERIC_FEATURES) {
            const currentValue = args.current[feature.currentKey];
            const fingerprintValue = fingerprint[feature.fingerprintKey];
            if (currentValue == null || fingerprintValue == null)
                continue;
            distanceScore +=
                (Math.abs(currentValue - fingerprintValue) / feature.scale) * feature.weight;
            contributingFeatures += 1;
        }
        if (args.current.warningState !== fingerprint.referenceWarningState) {
            distanceScore +=
                0.75 *
                    Math.abs(WARNING_STATE_SEVERITY[args.current.warningState] -
                        WARNING_STATE_SEVERITY[fingerprint.referenceWarningState]);
        }
        if (args.current.scenarioHint !== fingerprint.dominantScenario) {
            distanceScore += 4;
        }
        if (!contributingFeatures) {
            distanceScore += 10;
        }
        return {
            pathId: fingerprint.pathId,
            distanceScore: Number(distanceScore.toFixed(4)),
            similarityScore: toSimilarity(distanceScore),
            fingerprint,
        };
    });
    scored.sort((left, right) => right.similarityScore - left.similarityScore);
    const topK = Math.max(1, Math.min(args.topK ?? 50, scored.length));
    return scored.slice(0, topK);
}
