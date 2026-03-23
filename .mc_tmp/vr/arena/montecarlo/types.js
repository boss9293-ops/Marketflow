"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MONTE_CARLO_CONFIG_PRESETS = exports.DEFAULT_MONTE_CARLO_CONFIG = exports.FINAL_ARENA_STRATEGIES = void 0;
exports.FINAL_ARENA_STRATEGIES = [
    'BUY_HOLD',
    'VR_ORIGINAL_CAPPED',
    'MA200_50',
    'MA200_LB30',
    'LB30',
    'LB25',
    'ADAPTIVE',
];
exports.DEFAULT_MONTE_CARLO_CONFIG = {
    horizonDays: 252,
    blockSize: 10,
    nPaths: 1000,
    startPrice: 100,
    initialInvestedPct: 0.8,
    initialCashPct: 0.2,
    sourceSeries: 'QQQ',
    randomSeed: 42,
    crashInjection: {
        enabled: false,
        crashLengthDays: 15,
        recoveryLengthDays: 40,
        severity: 'SHARP',
        recoveryShape: 'V_SHAPE',
        useHistoricalEpisodeTemplate: false,
        episodeTemplateKey: null,
    },
};
exports.MONTE_CARLO_CONFIG_PRESETS = {
    bs5: { ...exports.DEFAULT_MONTE_CARLO_CONFIG, blockSize: 5 },
    bs10: { ...exports.DEFAULT_MONTE_CARLO_CONFIG, blockSize: 10 },
    bs20: { ...exports.DEFAULT_MONTE_CARLO_CONFIG, blockSize: 20 },
};
