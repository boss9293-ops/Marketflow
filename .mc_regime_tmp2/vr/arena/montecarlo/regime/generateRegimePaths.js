"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRegimePaths = generateRegimePaths;
const buildSyntheticPath_1 = require("../buildSyntheticPath");
const REGIME_STATES = [
    'NORMAL',
    'SELLOFF',
    'PANIC',
    'BOTTOMING',
    'RECOVERY',
];
const STATE_DURATION_BOUNDS = {
    NORMAL: { min: 15, max: 40 },
    SELLOFF: { min: 5, max: 15 },
    PANIC: { min: 3, max: 8 },
    BOTTOMING: { min: 10, max: 30 },
    RECOVERY: { min: 10, max: 30 },
};
function createSeededRandom(seed) {
    let state = (seed ?? Date.now()) >>> 0;
    return function seededRandom() {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
function sampleStandardNormal(random) {
    const u1 = Math.max(random(), 1e-9);
    const u2 = Math.max(random(), 1e-9);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function sampleDwellDays(state, avgDurationDays, random) {
    const bounds = STATE_DURATION_BOUNDS[state];
    const sampled = avgDurationDays + sampleStandardNormal(random) * Math.max(1, avgDurationDays * 0.35);
    return clamp(Math.round(sampled), bounds.min, bounds.max);
}
function sampleNextState(currentState, transitionMatrix, random) {
    const row = transitionMatrix[currentState];
    const draw = random();
    let cumulative = 0;
    for (const candidate of REGIME_STATES) {
        cumulative += row[candidate];
        if (draw <= cumulative) {
            return candidate;
        }
    }
    return REGIME_STATES[REGIME_STATES.length - 1];
}
function sampleStateReturn(state, stats, random) {
    const z = sampleStandardNormal(random);
    let sampled = stats.meanReturn + stats.volReturn * z;
    if (state === 'PANIC') {
        sampled = stats.meanReturn + stats.volReturn * (z < 0 ? z * 1.45 : z * 0.55);
    }
    else if (state === 'RECOVERY') {
        sampled = stats.meanReturn + stats.volReturn * (z > 0 ? z * 1.25 : z * 0.7);
    }
    else if (state === 'BOTTOMING') {
        sampled = stats.meanReturn + stats.volReturn * (z > 0 ? z * 0.8 : z * 1.1);
    }
    else if (state === 'SELLOFF') {
        sampled = stats.meanReturn + stats.volReturn * (z < 0 ? z * 1.15 : z * 0.75);
    }
    const lowerBound = stats.minReturn != null ? stats.minReturn * 1.2 : -0.95;
    const upperBound = stats.maxReturn != null ? stats.maxReturn * 1.2 : 1.5;
    return Number(clamp(sampled, Math.max(-0.95, lowerBound), Math.min(1.5, upperBound)).toFixed(8));
}
function generateRegimePaths(args) {
    const paths = [];
    const baseRandom = createSeededRandom(args.config.randomSeed);
    for (let pathIndex = 0; pathIndex < args.config.nPaths; pathIndex += 1) {
        const random = createSeededRandom(Math.floor(baseRandom() * 1_000_000_000) + pathIndex);
        const returns = [];
        const regimeStates = [];
        let currentState = args.config.initialState ?? 'NORMAL';
        while (returns.length < args.config.horizonDays) {
            const stats = args.model.stateStats[currentState];
            const dwellDays = sampleDwellDays(currentState, stats.avgDurationDays, random);
            for (let day = 0; day < dwellDays && returns.length < args.config.horizonDays; day += 1) {
                returns.push(sampleStateReturn(currentState, stats, random));
                regimeStates.push(currentState);
            }
            currentState = sampleNextState(currentState, args.model.transitionMatrix, random);
        }
        paths.push({
            pathId: `mc-${String(pathIndex + 1).padStart(4, '0')}`,
            blockSize: args.blockSize ?? 10,
            horizonDays: args.config.horizonDays,
            sampledBlockStarts: [],
            returns,
            prices: (0, buildSyntheticPath_1.buildSyntheticPricePath)(returns, args.config.startPrice),
            regimeStates,
        });
    }
    return paths;
}
