"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOverlayReason = formatOverlayReason;
function formatOverlayReason(overlay, current) {
    const primaryParts = [];
    const secondaryParts = [];
    if (overlay.dominantMcScenario === 'V' &&
        overlay.mcRecoveryOdds20d >= Math.max(35, overlay.mcCrashRiskScore - 5)) {
        primaryParts.push('Similar MC paths lean more toward rebound stabilization than extended bear continuation.');
    }
    else if (overlay.mcCrashRiskScore >= 65 || overlay.mcBearPathSimilarity >= 65) {
        primaryParts.push('Similar MC paths lean toward continued downside pressure rather than a clean rebound.');
    }
    else if (overlay.mcVShapeOdds20d >= 65 || overlay.mcRecoveryOdds20d >= 65) {
        primaryParts.push('Similar MC paths show better-than-usual recovery odds over the next 20 trading days.');
    }
    if (overlay.mcFalseRecoveryRisk >= 25) {
        secondaryParts.push('False-recovery risk remains elevated, so rebounds should be treated cautiously.');
    }
    else if (overlay.mcWarningConfidence >= 65) {
        secondaryParts.push('Historical and synthetic analogs suggest the current warning state has been reasonably informative.');
    }
    let conflictNote = null;
    if (current && current.scenarioHint !== overlay.dominantMcScenario) {
        conflictNote =
            `Rule-based hint (${current.scenarioHint}) and MC overlay (${overlay.dominantMcScenario}) are not fully aligned.`;
    }
    const parts = [...primaryParts];
    if (conflictNote) {
        parts.push(conflictNote);
    }
    else if (secondaryParts.length) {
        parts.push(secondaryParts[0]);
    }
    if (!parts.length) {
        return 'Monte Carlo overlay is mixed. It is interpretive, not executable.';
    }
    return parts.slice(0, 2).join(' ');
}
