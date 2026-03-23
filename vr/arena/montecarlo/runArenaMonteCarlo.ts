import {
  ARENA_CASH_FLOOR_PCT,
  ARENA_INITIAL_INVESTED_PCT,
  runStrategyArenaOnSyntheticPath,
} from '../compute_strategy_arena'

import { generateBlockBootstrapPaths } from './blockBootstrap'
import { buildSyntheticPricePath } from './buildSyntheticPath'
import { buildCalibrationTable } from './calibration/buildCalibrationTable'
import { computeWarningQuality } from './computeWarningQuality'
import { extractWarningEvents } from './extractWarningEvents'
import { extractWarningTrace } from './extractWarningTrace'
import { injectCrashEpisode } from './injectCrashEpisode'
import { buildCurrentMarketFeatureVector } from './overlay/buildFeatureVector'
import { buildScenarioFingerprintLibrary } from './overlay/buildScenarioFingerprintLibrary'
import { computeMonteCarloOverlay } from './overlay/computeMonteCarloOverlay'
import { findSimilarMonteCarloPaths } from './overlay/findSimilarMcPaths'
import { buildStateStats } from './regime/buildStateStats'
import { buildTransitionMatrix } from './regime/buildTransitionMatrix'
import { generateRegimePaths } from './regime/generateRegimePaths'
import { labelHistoricalRegimes } from './regime/labelHistoricalRegimes'
import {
  summarizeMonteCarloRuns,
  summarizeMonteCarloScenarioSlices,
} from './summarizeMonteCarlo'
import { summarizeWarningQuality } from './summarizeWarningQuality'
import type {
  ArenaStrategyKey,
  MonteCarloConfig,
  MonteCarloGeneratorMode,
  MonteCarloPath,
  MonteCarloRunOutput,
  MonteCarloStrategyRun,
  MonteCarloMeta,
  RegimeModel,
} from './types'
import { FINAL_ARENA_STRATEGIES } from './types'

const STRATEGY_KEY_MAP: Record<ArenaStrategyKey, keyof NonNullable<ReturnType<typeof runStrategyArenaOnSyntheticPath>>['metrics']> = {
  BUY_HOLD: 'buy_hold',
  VR_ORIGINAL_CAPPED: 'original_vr_scaled',
  MA200_50: 'ma200_risk_control_50',
  MA200_LB30: 'ma200_lb30_hybrid',
  LB30: 'low_based_lb30',
  LB25: 'low_based_lb25',
  ADAPTIVE: 'adaptive_exposure',
}

function getFinalEquityForStrategy(
  strategy: ArenaStrategyKey,
  arenaResult: NonNullable<ReturnType<typeof runStrategyArenaOnSyntheticPath>>
) {
  const last = arenaResult.chart_data[arenaResult.chart_data.length - 1]
  if (!last) return 0
  switch (strategy) {
    case 'BUY_HOLD':
      return last.buy_hold_equity
    case 'VR_ORIGINAL_CAPPED':
      return last.original_vr_scaled_equity ?? 0
    case 'MA200_50':
      return last.ma200_risk_control_50_equity
    case 'MA200_LB30':
      return last.ma200_lb30_hybrid_equity
    case 'LB30':
      return last.low_based_lb30_equity
    case 'LB25':
      return last.low_based_lb25_equity
    case 'ADAPTIVE':
      return last.adaptive_exposure_equity ?? 0
  }
}

function buildRunRecord(
  path: MonteCarloPath,
  strategy: ArenaStrategyKey,
  arenaResult: NonNullable<ReturnType<typeof runStrategyArenaOnSyntheticPath>>
): MonteCarloStrategyRun {
  const strategyKey = STRATEGY_KEY_MAP[strategy]
  const metric = arenaResult.metrics[strategyKey]
  const diagnostics = arenaResult.strategy_diagnostics[strategyKey]
  const finalEquity = getFinalEquityForStrategy(strategy, arenaResult)

  return {
    pathId: path.pathId,
    strategy,
    finalEquity,
    maxDrawdown: metric?.max_drawdown_pct ?? 0,
    recoveryDays: metric?.recovery_time_days ?? null,
    survival:
      finalEquity > 0 &&
      (diagnostics?.min_cash_pct_observed ?? ARENA_CASH_FLOOR_PCT) >= ARENA_CASH_FLOOR_PCT,
    minCashPctObserved: diagnostics?.min_cash_pct_observed ?? null,
    maxCapitalUsagePct: diagnostics?.max_capital_usage_pct ?? null,
    cycleCapHitCount: diagnostics?.cycle_cap_hit_count ?? null,
    warningLeadTimeAvg: diagnostics?.warning_lead_time_avg ?? null,
    falseDefenseRate: diagnostics?.false_defense_rate ?? null,
    missedReboundCost: diagnostics?.missed_rebound_cost ?? null,
    scenarioSeverity: path.scenarioMeta?.severity ?? null,
    scenarioRecoveryShape: path.scenarioMeta?.recoveryShape ?? null,
    scenarioTemplateKey: path.scenarioMeta?.episodeTemplateKey ?? null,
  }
}

function resolveGeneratorMode(config: MonteCarloConfig): MonteCarloGeneratorMode {
  if (config.generatorMode) return config.generatorMode
  if (config.crashInjection?.enabled) return 'BLOCK_PLUS_INJECTION'
  return 'BLOCK_BOOTSTRAP'
}

export async function runArenaMonteCarlo(
  historicalReturns: number[],
  config: MonteCarloConfig
): Promise<MonteCarloRunOutput> {
  if (config.initialInvestedPct !== 0.8 || config.initialCashPct !== 0.2) {
    throw new Error('Arena Monte Carlo requires the shared 80/20 starting condition.')
  }

  const generatorMode = resolveGeneratorMode(config)
  let regimeModel: RegimeModel | null = null
  const historicalPrices = buildSyntheticPricePath(historicalReturns, config.startPrice)

  const basePaths: MonteCarloPath[] =
    generatorMode === 'REGIME_STATE'
      ? (() => {
          const labels = labelHistoricalRegimes({ prices: historicalPrices })
          regimeModel = {
            states: ['NORMAL', 'SELLOFF', 'PANIC', 'BOTTOMING', 'RECOVERY'],
            transitionMatrix: buildTransitionMatrix(labels),
            stateStats: buildStateStats({
              returns: historicalReturns,
              labels,
            }),
          }
          return generateRegimePaths({
            model: regimeModel,
            config: {
              horizonDays: config.horizonDays,
              nPaths: config.nPaths,
              startPrice: config.startPrice,
              initialState: config.regimeConfig?.initialState,
              randomSeed: config.regimeConfig?.randomSeed ?? config.randomSeed,
            },
            blockSize: config.blockSize,
          })
        })()
      : generateBlockBootstrapPaths(historicalReturns, config)

  const paths: MonteCarloPath[] =
    generatorMode === 'BLOCK_PLUS_INJECTION'
      ? basePaths.map((path, pathIndex) => {
          const injection = injectCrashEpisode({
            pathId: path.pathId,
            baseReturns: path.returns,
            crashConfig: config.crashInjection,
            randomSeed:
              typeof config.randomSeed === 'number'
                ? config.randomSeed + pathIndex * 1009
                : undefined,
          })

          return {
            ...path,
            returns: injection.returns,
            prices: buildSyntheticPricePath(injection.returns, config.startPrice),
            scenarioMeta: injection.meta,
          }
        })
      : basePaths
  const runs: MonteCarloStrategyRun[] = []
  const warningTrace = []
  const warningEvents = []
  const warningQualityRuns = []

  for (const path of paths) {
    const arenaResult = runStrategyArenaOnSyntheticPath({
      prices: path.prices,
      initialInvestedPct: config.initialInvestedPct * 100,
      initialCashPct: config.initialCashPct * 100,
    })
    if (!arenaResult) continue

    const pathWarningTrace = extractWarningTrace({
      pathId: path.pathId,
      prices: path.prices,
      injectedScenarioMeta: path.scenarioMeta,
    })
    const pathWarningEvents = extractWarningEvents(pathWarningTrace)
    const pathWarningQuality = computeWarningQuality({
      pathId: path.pathId,
      trace: pathWarningTrace,
      events: pathWarningEvents,
      injectedScenarioMeta: path.scenarioMeta,
    })

    warningTrace.push(...pathWarningTrace)
    warningEvents.push(...pathWarningEvents)
    warningQualityRuns.push(pathWarningQuality)

    for (const strategy of FINAL_ARENA_STRATEGIES) {
      runs.push(buildRunRecord(path, strategy, arenaResult))
    }
  }

  const summaries = summarizeMonteCarloRuns(runs)
  const scenarioSliceSummaries = summarizeMonteCarloScenarioSlices(runs)
  const warningQualitySummaries = summarizeWarningQuality(warningQualityRuns)
  const scenarioFingerprintLibrary = buildScenarioFingerprintLibrary({
    paths,
    mcRuns: runs,
    warningTrace,
    warningQualityRuns,
    injectedScenarioMeta: paths
      .map((path) => path.scenarioMeta)
      .filter((meta): meta is NonNullable<typeof meta> => meta != null),
  })
  const calibrationTable = buildCalibrationTable({
    historicalPrices,
    library: scenarioFingerprintLibrary,
  })
  const exampleTracePoint = warningTrace.find((point) => point.warningState !== 'NORMAL')
  const overlayExample =
    exampleTracePoint != null
      ? (() => {
          const current = buildCurrentMarketFeatureVector({
            dd3: exampleTracePoint.dd3,
            dd5: exampleTracePoint.dd5,
            dd6: exampleTracePoint.dd6,
            peakDD: exampleTracePoint.peakDD,
            reboundFromLow: exampleTracePoint.reboundFromLow,
            ma200Gap: exampleTracePoint.ma200Gap,
            warningState: exampleTracePoint.warningState,
            scenarioHint: exampleTracePoint.scenarioHint ?? 'Mixed',
          })
          const similarPaths = findSimilarMonteCarloPaths({
            current,
            library: scenarioFingerprintLibrary,
            topK: 25,
          })
          return {
            current,
            overlay: computeMonteCarloOverlay({
              current,
              similarPaths,
              calibrationTable,
            }),
            similarPathIds: similarPaths.map((path) => path.pathId),
          }
        })()
      : null
  const meta: MonteCarloMeta = {
    generatorMode,
    sourceSeries: config.sourceSeries,
    horizonDays: config.horizonDays,
    blockSize: config.blockSize,
    nPaths: config.nPaths,
    randomSeed: config.randomSeed,
    initialInvestedPct: config.initialInvestedPct,
    initialCashPct: config.initialCashPct,
    strategies: FINAL_ARENA_STRATEGIES,
    crashInjection: config.crashInjection,
    regimeConfig: config.regimeConfig,
  }

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
    calibrationTable,
    overlayExample,
    regimeModel,
    meta,
  }
}

export {
  FINAL_ARENA_STRATEGIES,
  ARENA_INITIAL_INVESTED_PCT,
}
