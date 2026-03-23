"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBlockBootstrapPaths = generateBlockBootstrapPaths;
const buildSyntheticPath_1 = require("./buildSyntheticPath");
function createSeededRandom(seed) {
    let state = (seed ?? Date.now()) >>> 0;
    return function seededRandom() {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
function generateBlockBootstrapPaths(historicalReturns, config) {
    if (historicalReturns.length <= config.blockSize) {
        throw new Error('Historical return history is shorter than the requested block size.');
    }
    const random = createSeededRandom(config.randomSeed);
    const paths = [];
    for (let pathIndex = 0; pathIndex < config.nPaths; pathIndex += 1) {
        const sampledReturns = [];
        const sampledBlockStarts = [];
        while (sampledReturns.length < config.horizonDays) {
            const maxStart = historicalReturns.length - config.blockSize;
            const blockStart = Math.floor(random() * (maxStart + 1));
            sampledBlockStarts.push(blockStart);
            sampledReturns.push(...historicalReturns.slice(blockStart, blockStart + config.blockSize));
        }
        const returns = sampledReturns.slice(0, config.horizonDays).map((value) => Number(value.toFixed(8)));
        const prices = (0, buildSyntheticPath_1.buildSyntheticPricePath)(returns, config.startPrice);
        paths.push({
            pathId: `mc-${String(pathIndex + 1).padStart(4, '0')}`,
            blockSize: config.blockSize,
            horizonDays: config.horizonDays,
            sampledBlockStarts,
            returns,
            prices,
        });
    }
    return paths;
}
