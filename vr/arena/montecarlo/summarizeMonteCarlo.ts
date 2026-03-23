import type {
  MonteCarloScenarioSliceSummary,
  MonteCarloStrategyRun,
  MonteCarloStrategySummary,
} from './types'

function percentile(values: number[], pct: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const rank = (sorted.length - 1) * pct
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  const weight = rank - low
  return sorted[low] * (1 - weight) + sorted[high] * weight
}

function median(values: number[]) {
  return percentile(values, 0.5)
}

function downsideTailPercentile(values: number[], pct: number) {
  if (!values.length) return null
  const magnitudes = values.map((value) => Math.abs(value))
  const tail = percentile(magnitudes, pct)
  return tail == null ? null : -tail
}

function summarizeNullableMetric(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return valid.length ? median(valid) : null
}

export function summarizeMonteCarloRuns(
  runs: MonteCarloStrategyRun[]
): MonteCarloStrategySummary[] {
  const grouped = new Map<string, MonteCarloStrategyRun[]>()
  for (const run of runs) {
    const bucket = grouped.get(run.strategy) ?? []
    bucket.push(run)
    grouped.set(run.strategy, bucket)
  }

  return Array.from(grouped.entries()).map(([strategy, strategyRuns]) => {
    const finalEquity = strategyRuns.map((run) => run.finalEquity)
    const maxDrawdowns = strategyRuns.map((run) => run.maxDrawdown)
    const recoveryDays = strategyRuns
      .map((run) => run.recoveryDays)
      .filter((value): value is number => typeof value === 'number')

    return {
      strategy: strategy as MonteCarloStrategySummary['strategy'],
      nRuns: strategyRuns.length,
      medianFinalEquity: Number((median(finalEquity) ?? 0).toFixed(2)),
      p10FinalEquity: Number((percentile(finalEquity, 0.10) ?? 0).toFixed(2)),
      p90FinalEquity: Number((percentile(finalEquity, 0.90) ?? 0).toFixed(2)),
      medianMaxDrawdown: Number((median(maxDrawdowns) ?? 0).toFixed(2)),
      p90MaxDrawdown: Number((downsideTailPercentile(maxDrawdowns, 0.90) ?? 0).toFixed(2)),
      medianRecoveryDays: recoveryDays.length ? Number((median(recoveryDays) ?? 0).toFixed(2)) : null,
      worst5RecoveryDays: recoveryDays.length ? Number((percentile(recoveryDays, 0.95) ?? 0).toFixed(2)) : null,
      survivalProbability: Number(
        (strategyRuns.filter((run) => run.survival).length / strategyRuns.length).toFixed(4)
      ),
      medianMinCashPctObserved: summarizeNullableMetric(strategyRuns.map((run) => run.minCashPctObserved)),
      medianMaxCapitalUsagePct: summarizeNullableMetric(strategyRuns.map((run) => run.maxCapitalUsagePct)),
      medianCycleCapHitCount: summarizeNullableMetric(strategyRuns.map((run) => run.cycleCapHitCount)),
      medianWarningLeadTime: summarizeNullableMetric(strategyRuns.map((run) => run.warningLeadTimeAvg)),
      medianFalseDefenseRate: summarizeNullableMetric(strategyRuns.map((run) => run.falseDefenseRate)),
      medianMissedReboundCost: summarizeNullableMetric(strategyRuns.map((run) => run.missedReboundCost)),
    }
  })
}

export function summarizeMonteCarloScenarioSlices(
  runs: MonteCarloStrategyRun[]
): MonteCarloScenarioSliceSummary[] {
  const injectedRuns = runs.filter(
    (run): run is MonteCarloStrategyRun & {
      scenarioSeverity: NonNullable<MonteCarloStrategyRun['scenarioSeverity']>
      scenarioRecoveryShape: NonNullable<MonteCarloStrategyRun['scenarioRecoveryShape']>
    } => run.scenarioSeverity != null && run.scenarioRecoveryShape != null
  )

  const grouped = new Map<string, typeof injectedRuns>()
  for (const run of injectedRuns) {
    const key = `${run.strategy}|${run.scenarioSeverity}|${run.scenarioRecoveryShape}`
    const bucket = grouped.get(key) ?? []
    bucket.push(run)
    grouped.set(key, bucket)
  }

  return Array.from(grouped.values()).map((strategyRuns) => {
    const first = strategyRuns[0]
    const finalEquity = strategyRuns.map((run) => run.finalEquity)
    const maxDrawdowns = strategyRuns.map((run) => run.maxDrawdown)
    const recoveryDays = strategyRuns
      .map((run) => run.recoveryDays)
      .filter((value): value is number => typeof value === 'number')

    return {
      strategy: first.strategy,
      severity: first.scenarioSeverity,
      recoveryShape: first.scenarioRecoveryShape,
      nRuns: strategyRuns.length,
      survivalProbability: Number(
        (strategyRuns.filter((run) => run.survival).length / strategyRuns.length).toFixed(4)
      ),
      medianFinalEquity: Number((median(finalEquity) ?? 0).toFixed(2)),
      medianMaxDrawdown: Number((median(maxDrawdowns) ?? 0).toFixed(2)),
      medianRecoveryDays: recoveryDays.length ? Number((median(recoveryDays) ?? 0).toFixed(2)) : null,
    }
  })
}
