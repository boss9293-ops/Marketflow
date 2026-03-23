"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractWarningEvents = extractWarningEvents;
const WARNING_STATE_SEVERITY = {
    NORMAL: 0,
    WATCH: 1,
    ALERT: 2,
    DEFENSE_READY: 3,
    DEFENSE_ACTIVE: 4,
    RECOVERY_MODE: 3,
};
function extractWarningEvents(trace) {
    if (!trace.length)
        return [];
    const events = [];
    let activePoints = [];
    const flushEvent = () => {
        if (!activePoints.length)
            return;
        const start = activePoints[0];
        const end = activePoints[activePoints.length - 1];
        const peak = activePoints.reduce((best, point) => WARNING_STATE_SEVERITY[point.warningState] > WARNING_STATE_SEVERITY[best.warningState]
            ? point
            : best);
        events.push({
            pathId: start.pathId,
            startDay: start.dayIndex,
            peakWarningState: peak.warningState,
            endDay: end.dayIndex,
            durationDays: end.dayIndex - start.dayIndex + 1,
            firstAlertDay: activePoints.find((point) => point.warningState === 'ALERT')?.dayIndex ?? null,
            firstDefenseReadyDay: activePoints.find((point) => point.warningState === 'DEFENSE_READY')?.dayIndex ?? null,
            firstDefenseActiveDay: activePoints.find((point) => point.warningState === 'DEFENSE_ACTIVE')?.dayIndex ?? null,
            firstRecoveryModeDay: activePoints.find((point) => point.warningState === 'RECOVERY_MODE')?.dayIndex ?? null,
        });
        activePoints = [];
    };
    for (const point of trace) {
        if (point.warningState === 'NORMAL') {
            flushEvent();
            continue;
        }
        activePoints.push(point);
    }
    flushEvent();
    return events;
}
