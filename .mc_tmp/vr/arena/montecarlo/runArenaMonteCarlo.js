"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARENA_INITIAL_INVESTED_PCT = exports.FINAL_ARENA_STRATEGIES = void 0;
exports.runArenaMonteCarlo = runArenaMonteCarlo;
const compute_strategy_arena_1 = require("../compute_strategy_arena");
Object.defineProperty(exports, "ARENA_INITIAL_INVESTED_PCT", { enumerable: true, get: function () { return compute_strategy_arena_1.ARENA_INITIAL_INVESTED_PCT; } });
const blockBootstrap_1 = require("./blockBootstrap");
const buildSyntheticPath_1 = require("./buildSyntheticPath");
const computeWarningQuality_1 = require("./computeWarningQuality");
const extractWarningEvents_1 = require("./extractWarningEvents");
const extractWarningTrace_1 = require("./extractWarningTrace");
const injectCrashEpisode_1 = require("./injectCrashEpisode");
const buildFeatureVector_1 = require("./overlay/buildFeatureVector");
const buildScenarioFingerprintLibrary_1 = require("./overlay/buildScenarioFingerprintLibrary");
const computeMonteCarloOverlay_1 = require("./overlay/computeMonteCarloOverlay");
const findSimilarMcPaths_1 = require("./overlay/findSimilarMcPaths");
const summarizeMonteCarlo_1 = require("./summarizeMonteCarlo");
const summarizeWarningQuality_1 = require("./summarizeWarningQuality");
const types_1 = require("./types");
Object.defineProperty(exports, "FINAL_ARENA_STRATEGIES", { enumerable: true, get: function () { return types_1.FINAL_ARENA_STRATEGIES; } });
const STRATEGY_KEY_MAP = {
    BUY_HOLD: 'buy_hold',
    VR_ORIGINAL_CAPPED: 'original_vr_scaled',
    MA200_50: 'ma200_risk_control_50',
    MA200_LB30: 'ma200_lb30_hybrid',
    LB30: 'low_based_lb30',
    LB25: 'low_based_lb25',
    ADAPTIVE: 'adaptive_exposure',
};
function getFinalEquityForStrategy(strategy, arenaResult) {
    const last = arenaResult.chart_data[arenaResult.chart_data.length - 1];
    if (!last)
        return 0;
    switch (strategy) {
        case 'BUY_HOLD':
            return last.buy_hold_equity;
        case 'VR_ORIGINAL_CAPPED':
            return last.original_vr_scaled_equity ?? 0;
        case 'MA200_50':
            return last.ma200_risk_control_50_equity;
        case 'MA200_LB30':
            return last.ma200_lb30_hybrid_equity;
        case 'LB30':
            return last.low_based_lb30_equity;
        case 'LB25':
            return last.low_based_lb25_equity;
        case 'ADAPTIVE':
            return last.adaptive_exposure_equity ?? 0;
    }
}
function buildRunRecord(path, strategy, arenaResult) {
    const strategyKey = STRATEGY_KEY_MAP[strategy];
    const metric = arenaResult.metrics[strategyKey];
    const diagnostics = arenaResult.strategy_diagnostics[strategyKey];
    const finalEquity = getFinalEquityForStrategy(strategy, arenaResult);
    return {
        pathId: path.pathId,
        strategy,
        finalEquity,
        maxDrawdown: metric?.max_drawdown_pct ?? 0,
        recoveryDays: metric?.recovery_time_days ?? null,
        survival: finalEquity > 0 &&
            (diagnostics?.min_cash_pct_observed ?? compute_strategy_arena_1.ARENA_CASH_FLOOR_PCT) >= compute_strategy_arena_1.ARENA_CASH_FLOOR_PCT,
        minCashPctObserved: diagnostics?.min_cash_pct_observed ?? null,
        maxCapitalUsagePct: diagnostics?.max_capital_usage_pct ?? null,
        cycleCapHitCount: diagnostics?.cycle_cap_hit_count ?? null,
        warningLeadTimeAvg: diagnostics?.warning_lead_time_avg ?? null,
        falseDefenseRate: diagnostics?.false_defense_rate ?? null,
        missedReboundCost: diagnostics?.missed_rebound_cost ?? null,
        scenarioSeverity: path.scenarioMeta?.severity ?? null,
        scenarioRecoveryShape: path.scenarioMeta?.recoveryShape ?? null,
        scenarioTemplateKey: path.scenarioMeta?.episodeTemplateKey ?? null,
    };
}
async function runArenaMonteCarlo(historicalReturns, config) {
    if (config.initialInvestedPct !== 0.8 || config.initialCashPct !== 0.2) {
        throw new Error('Arena Monte Carlo requires the shared 80/20 starting condition.');
    }
    const basePaths = (0, blockBootstrap_1.generateBlockBootstrapPaths)(historicalReturns, config);
    const paths = basePaths.map((path, pathIndex) => {
        const injection = (0, injectCrashEpisode_1.injectCrashEpisode)({
            pathId: path.pathId,
            baseReturns: path.returns,
            crashConfig: config.crashInjection,
            randomSeed: typeof config.randomSeed === 'number'
                ? config.randomSeed + pathIndex * 1009
                : undefined,
        });
        return {
            ...path,
            returns: injection.returns,
            prices: (0, buildSyntheticPath_1.buildSyntheticPricePath)(injection.returns, config.startPrice),
            scenarioMeta: injection.meta,
        };
    });
    const runs = [];
    const warningTrace = [];
    const warningEvents = [];
    const warningQualityRuns = [];
    for (const path of paths) {
        const arenaResult = (0, compute_strategy_arena_1.runStrategyArenaOnSyntheticPath)({
            prices: path.prices,
            initialInvestedPct: config.initialInvestedPct * 100,
            initialCashPct: config.initialCashPct * 100,
        });
        if (!arenaResult)
            continue;
        const pathWarningTrace = (0, extractWarningTrace_1.extractWarningTrace)({
            pathId: path.pathId,
            prices: path.prices,
            injectedScenarioMeta: path.scenarioMeta,
        });
        const pathWarningEvents = (0, extractWarningEvents_1.extractWarningEvents)(pathWarningTrace);
        const pathWarningQuality = (0, computeWarningQuality_1.computeWarningQuality)({
            pathId: path.pathId,
            trace: pathWarningTrace,
            events: pathWarningEvents,
            injectedScenarioMeta: path.scenarioMeta,
        });
        warningTrace.push(...pathWarningTrace);
        warningEvents.push(...pathWarningEvents);
        warningQualityRuns.push(pathWarningQuality);
        for (const strategy of types_1.FINAL_ARENA_STRATEGIES) {
            runs.push(buildRunRecord(path, strategy, arenaResult));
        }
    }
    const summaries = (0, summarizeMonteCarlo_1.summarizeMonteCarloRuns)(runs);
    const scenarioSliceSummaries = (0, summarizeMonteCarlo_1.summarizeMonteCarloScenarioSlices)(runs);
    const warningQualitySummaries = (0, summarizeWarningQuality_1.summarizeWarningQuality)(warningQualityRuns);
    const scenarioFingerprintLibrary = (0, buildScenarioFingerprintLibrary_1.buildScenarioFingerprintLibrary)({
        paths,
        mcRuns: runs,
        warningTrace,
        warningQualityRuns,
        injectedScenarioMeta: paths
            .map((path) => path.scenarioMeta)
            .filter((meta) => meta != null),
    });
    const exampleTracePoint = warningTrace.find((point) => point.warningState !== 'NORMAL');
    const overlayExample = exampleTracePoint != null
        ? (() => {
            const current = (0, buildFeatureVector_1.buildCurrentMarketFeatureVector)({
                dd3: exampleTracePoint.dd3,
                dd5: exampleTracePoint.dd5,
                dd6: exampleTracePoint.dd6,
                peakDD: exampleTracePoint.peakDD,
                reboundFromLow: exampleTracePoint.reboundFromLow,
                ma200Gap: exampleTracePoint.ma200Gap,
                warningState: exampleTracePoint.warningState,
                scenarioHint: exampleTracePoint.scenarioHint ?? 'Mixed',
            });
            const similarPaths = (0, findSimilarMcPaths_1.findSimilarMonteCarloPaths)({
                current,
                library: scenarioFingerprintLibrary,
                topK: 25,
            });
            return {
                current,
                overlay: (0, computeMonteCarloOverlay_1.computeMonteCarloOverlay)({ current, similarPaths }),
                similarPathIds: similarPaths.map((path) => path.pathId),
            };
        })()
        : null;
    const meta = {
        sourceSeries: config.sourceSeries,
        horizonDays: config.horizonDays,
        blockSize: config.blockSize,
        nPaths: config.nPaths,
        randomSeed: config.randomSeed,
        initialInvestedPct: config.initialInvestedPct,
        initialCashPct: config.initialCashPct,
        strategies: types_1.FINAL_ARENA_STRATEGIES,
        crashInjection: config.crashInjection,
    };
    return {
        runs,
        summaries,
        scenarioSliceSummaries,
        injectedScenarios: paths.map((path) => path.scenarioMeta).filter((meta) => meta != null),
        warningTrace,
        warningEvents,
        warningQualityRuns,
        warningQualitySummaries,
        scenarioFingerprintLibrary,
        overlayExample,
        meta,
    };
}
