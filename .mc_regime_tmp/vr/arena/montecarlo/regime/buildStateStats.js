"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStateStats = buildStateStats;
const REGIME_STATES = [
    'NORMAL',
    'SELLOFF',
    'PANIC',
    'BOTTOMING',
    'RECOVERY',
];
const FALLBACK_STATS = {
    NORMAL: {
        state: 'NORMAL',
        meanReturn: 0.0007,
        volReturn: 0.012,
        avgDurationDays: 24,
        minReturn: -0.03,
        maxReturn: 0.03,
    },
    SELLOFF: {
        state: 'SELLOFF',
        meanReturn: -0.0025,
        volReturn: 0.02,
        avgDurationDays: 9,
        minReturn: -0.06,
        maxReturn: 0.025,
    },
    PANIC: {
        state: 'PANIC',
        meanReturn: -0.008,
        volReturn: 0.04,
        avgDurationDays: 5,
        minReturn: -0.14,
        maxReturn: 0.04,
    },
    BOTTOMING: {
        state: 'BOTTOMING',
        meanReturn: -0.0005,
        volReturn: 0.025,
        avgDurationDays: 18,
        minReturn: -0.06,
        maxReturn: 0.05,
    },
    RECOVERY: {
        state: 'RECOVERY',
        meanReturn: 0.004,
        volReturn: 0.022,
        avgDurationDays: 16,
        minReturn: -0.04,
        maxReturn: 0.08,
    },
};
function computeStd(values) {
    if (values.length <= 1)
        return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}
function segmentDurations(labels) {
    const durations = new Map();
    for (const state of REGIME_STATES) {
        durations.set(state, []);
    }
    if (!labels.length)
        return durations;
    let current = labels[0].state;
    let length = 1;
    for (let index = 1; index < labels.length; index += 1) {
        if (labels[index].state === current) {
            length += 1;
            continue;
        }
        durations.get(current)?.push(length);
        current = labels[index].state;
        length = 1;
    }
    durations.get(current)?.push(length);
    return durations;
}
function buildStateStats(args) {
    const returnsByState = new Map();
    for (const state of REGIME_STATES) {
        returnsByState.set(state, []);
    }
    for (let index = 1; index < args.labels.length; index += 1) {
        const dailyReturn = args.returns[index - 1];
        if (!Number.isFinite(dailyReturn))
            continue;
        returnsByState.get(args.labels[index].state)?.push(dailyReturn);
    }
    const durations = segmentDurations(args.labels);
    const stats = {};
    for (const state of REGIME_STATES) {
        const stateReturns = returnsByState.get(state) ?? [];
        const stateDurations = durations.get(state) ?? [];
        const fallback = FALLBACK_STATS[state];
        const meanReturn = stateReturns.length
            ? stateReturns.reduce((sum, value) => sum + value, 0) / stateReturns.length
            : fallback.meanReturn;
        const volReturn = stateReturns.length
            ? Math.max(0.0001, computeStd(stateReturns))
            : fallback.volReturn;
        const avgDurationDays = stateDurations.length
            ? stateDurations.reduce((sum, value) => sum + value, 0) / stateDurations.length
            : fallback.avgDurationDays;
        stats[state] = {
            state,
            meanReturn: Number(meanReturn.toFixed(8)),
            volReturn: Number(volReturn.toFixed(8)),
            avgDurationDays: Number(avgDurationDays.toFixed(2)),
            minReturn: stateReturns.length ? Number(Math.min(...stateReturns).toFixed(8)) : fallback.minReturn,
            maxReturn: stateReturns.length ? Number(Math.max(...stateReturns).toFixed(8)) : fallback.maxReturn,
        };
    }
    return stats;
}
