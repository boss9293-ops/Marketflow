"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTransitionMatrix = buildTransitionMatrix;
const REGIME_STATES = [
    'NORMAL',
    'SELLOFF',
    'PANIC',
    'BOTTOMING',
    'RECOVERY',
];
const PRIOR_COUNTS = {
    NORMAL: { NORMAL: 6, SELLOFF: 3, PANIC: 0, BOTTOMING: 0, RECOVERY: 1 },
    SELLOFF: { NORMAL: 1, SELLOFF: 3, PANIC: 3, BOTTOMING: 1, RECOVERY: 1 },
    PANIC: { NORMAL: 0, SELLOFF: 1, PANIC: 2, BOTTOMING: 4, RECOVERY: 2 },
    BOTTOMING: { NORMAL: 0, SELLOFF: 2, PANIC: 1, BOTTOMING: 4, RECOVERY: 3 },
    RECOVERY: { NORMAL: 4, SELLOFF: 2, PANIC: 0, BOTTOMING: 1, RECOVERY: 3 },
};
function toSegments(labels) {
    if (!labels.length)
        return [];
    const segments = [];
    let current = labels[0].state;
    let start = labels[0].dayIndex;
    for (let index = 1; index < labels.length; index += 1) {
        if (labels[index].state !== current) {
            segments.push({
                state: current,
                start,
                end: labels[index - 1].dayIndex,
            });
            current = labels[index].state;
            start = labels[index].dayIndex;
        }
    }
    segments.push({
        state: current,
        start,
        end: labels[labels.length - 1].dayIndex,
    });
    return segments;
}
function buildTransitionMatrix(labels) {
    const counts = JSON.parse(JSON.stringify(PRIOR_COUNTS));
    const segments = toSegments(labels);
    for (let index = 0; index < segments.length - 1; index += 1) {
        const from = segments[index].state;
        const to = segments[index + 1].state;
        counts[from][to] += 1;
    }
    const matrix = {};
    for (const state of REGIME_STATES) {
        const rowTotal = REGIME_STATES.reduce((sum, nextState) => sum + counts[state][nextState], 0);
        matrix[state] = {};
        for (const nextState of REGIME_STATES) {
            matrix[state][nextState] = Number((counts[state][nextState] / rowTotal).toFixed(6));
        }
    }
    return matrix;
}
