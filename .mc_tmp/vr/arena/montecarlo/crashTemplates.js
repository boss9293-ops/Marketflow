"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCrashEpisodeTemplates = listCrashEpisodeTemplates;
exports.getCrashEpisodeTemplate = getCrashEpisodeTemplate;
exports.buildSyntheticCrashReturns = buildSyntheticCrashReturns;
exports.resolveCrashTemplateReturns = resolveCrashTemplateReturns;
const HISTORICAL_INSPIRED_TEMPLATES = [
    {
        key: 'COVID_2020',
        label: 'COVID-style shock',
        source: 'HISTORICAL',
        crashReturns: [-0.052, -0.044, -0.061, -0.038, 0.012, -0.071, -0.048, -0.036, -0.029, -0.041],
        notes: 'Normalized crash shape inspired by the 2020 shock leg.',
    },
    {
        key: 'VOLMAGEDDON_2018',
        label: 'Volmageddon-style correction',
        source: 'HISTORICAL',
        crashReturns: [-0.031, -0.024, -0.045, -0.039, 0.009, -0.028, -0.017, -0.014],
        notes: 'Normalized correction shape inspired by the 2018 vol shock.',
    },
    {
        key: 'BEAR_LEG_2022',
        label: '2022 bear-leg',
        source: 'HISTORICAL',
        crashReturns: [-0.018, -0.012, -0.021, -0.015, -0.008, -0.019, -0.011, -0.017, -0.009, -0.014, -0.012, -0.01],
        notes: 'Normalized bear-leg shape inspired by the 2022 grinding drawdown.',
    },
];
const SEVERITY_TOTAL_DRAWDOWN = {
    MILD: -0.16,
    SHARP: -0.24,
    SEVERE: -0.34,
};
function resampleReturns(returns, targetLength) {
    if (targetLength <= 0)
        return [];
    if (returns.length === targetLength) {
        return returns.map((value) => Number(value.toFixed(8)));
    }
    const resampled = [];
    const maxSourceIndex = Math.max(returns.length - 1, 1);
    for (let index = 0; index < targetLength; index += 1) {
        const sourcePosition = targetLength === 1 ? 0 : (index / (targetLength - 1)) * maxSourceIndex;
        const leftIndex = Math.floor(sourcePosition);
        const rightIndex = Math.min(maxSourceIndex, Math.ceil(sourcePosition));
        const weight = sourcePosition - leftIndex;
        const left = returns[leftIndex] ?? returns[returns.length - 1] ?? 0;
        const right = returns[rightIndex] ?? left;
        resampled.push(Number((left * (1 - weight) + right * weight).toFixed(8)));
    }
    return resampled;
}
function listCrashEpisodeTemplates() {
    return [...HISTORICAL_INSPIRED_TEMPLATES];
}
function getCrashEpisodeTemplate(templateKey) {
    if (!templateKey)
        return null;
    return HISTORICAL_INSPIRED_TEMPLATES.find((template) => template.key === templateKey) ?? null;
}
function buildSyntheticCrashReturns(args) {
    const totalDrawdown = SEVERITY_TOTAL_DRAWDOWN[args.severity];
    const weights = Array.from({ length: args.length }, (_, index) => Math.max(0.4, args.length - index));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const totalLogReturn = Math.log(1 + totalDrawdown);
    return weights.map((weight) => {
        const dailyLogReturn = (totalLogReturn * weight) / totalWeight;
        return Number((Math.exp(dailyLogReturn) - 1).toFixed(8));
    });
}
function resolveCrashTemplateReturns(args) {
    const template = args.useHistoricalEpisodeTemplate && args.episodeTemplateKey
        ? getCrashEpisodeTemplate(args.episodeTemplateKey)
        : null;
    if (template) {
        return {
            template,
            crashReturns: resampleReturns(template.crashReturns, args.crashLengthDays),
        };
    }
    return {
        template: null,
        crashReturns: buildSyntheticCrashReturns({
            severity: args.severity,
            length: args.crashLengthDays,
        }),
    };
}
