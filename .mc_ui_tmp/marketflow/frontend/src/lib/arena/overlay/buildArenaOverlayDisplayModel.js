"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildArenaOverlayDisplayModel = buildArenaOverlayDisplayModel;
const WARNING_STATE_SEVERITY = {
    NORMAL: 0,
    WATCH: 1,
    ALERT: 2,
    DEFENSE_READY: 3,
    DEFENSE_ACTIVE: 4,
    RECOVERY_MODE: 3,
};
function buildInterpretationNote(args) {
    if (!args.mcOverlay) {
        return 'Monte Carlo overlay unavailable. Rule-based warning remains the primary layer.';
    }
    if (args.interpretationAlignment === 'ALIGNED') {
        return `Rule-based warning and MC overlay are aligned toward ${args.mcOverlay.dominantMcScenario.toLowerCase()}-path risk.`;
    }
    if (args.interpretationAlignment === 'CONFLICTED') {
        return `Rule-based scenario and MC overlay are conflicted; ${args.mcOverlay.dominantMcScenario === 'V' ? 'recovery odds are higher than the warning layer implies.' : 'continuation risk remains higher than a clean rebound path suggests.'}`;
    }
    return 'Signal mix is inconclusive; interpret with caution.';
}
function buildArenaOverlayDisplayModel(args) {
    let interpretationAlignment = 'NEUTRAL';
    if (args.mcOverlay) {
        const sameScenario = args.scenarioHint !== 'Mixed' &&
            args.mcOverlay.dominantMcScenario !== 'Mixed' &&
            args.scenarioHint === args.mcOverlay.dominantMcScenario;
        const directionalConflict = (args.scenarioHint === 'Bear' && args.mcOverlay.dominantMcScenario === 'V') ||
            (args.scenarioHint === 'V' && args.mcOverlay.dominantMcScenario === 'Bear');
        const lowConfidenceConflict = WARNING_STATE_SEVERITY[args.warningState] >= WARNING_STATE_SEVERITY.DEFENSE_READY &&
            args.mcOverlay.mcWarningConfidence < 45;
        if (sameScenario) {
            interpretationAlignment = 'ALIGNED';
        }
        else if (directionalConflict || lowConfidenceConflict) {
            interpretationAlignment = 'CONFLICTED';
        }
    }
    return {
        warningState: args.warningState,
        warningReason: args.warningReason,
        scenarioHint: args.scenarioHint,
        mcOverlay: args.mcOverlay,
        interpretationAlignment,
        interpretationNote: buildInterpretationNote({
            scenarioHint: args.scenarioHint,
            mcOverlay: args.mcOverlay,
            interpretationAlignment,
        }),
    };
}
