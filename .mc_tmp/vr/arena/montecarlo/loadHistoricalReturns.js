"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadHistoricalReturnsForMonteCarlo = loadHistoricalReturnsForMonteCarlo;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
function parseCsvReturns(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 3)
        return [];
    const rows = lines.slice(1).map((line) => line.split(','));
    const closes = rows
        .map((columns) => Number(columns[4]))
        .filter((value) => Number.isFinite(value) && value > 0);
    const returns = [];
    for (let index = 1; index < closes.length; index += 1) {
        returns.push(Number(((closes[index] / closes[index - 1]) - 1).toFixed(8)));
    }
    return returns;
}
function buildSynthetic3xReturns(baseReturns) {
    return baseReturns.map((value) => {
        const leveraged = value * 3;
        const clamped = Math.max(-0.95, Math.min(1.5, leveraged));
        return Number(clamped.toFixed(8));
    });
}
async function loadHistoricalReturnsForMonteCarlo(source) {
    const priceDir = (0, node_path_1.join)(process.cwd(), 'marketflow_data', 'prices', 'raw_csv');
    const qqqCsv = await (0, promises_1.readFile)((0, node_path_1.join)(priceDir, 'qqq.us.csv'), 'utf-8');
    const qqqReturns = parseCsvReturns(qqqCsv);
    if (source === 'QQQ' || source === 'NDX') {
        return qqqReturns;
    }
    if (source === 'SYNTH_3X') {
        return buildSynthetic3xReturns(qqqReturns);
    }
    const tqqqCsv = await (0, promises_1.readFile)((0, node_path_1.join)(priceDir, 'tqqq.us.csv'), 'utf-8');
    return parseCsvReturns(tqqqCsv);
}
