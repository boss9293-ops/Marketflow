import type {
  CrashSeverity,
  RecoveryShape,
  WarningQualityRun,
  WarningQualitySummary,
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

function summarizeNullableMetric(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return valid.length ? Number((median(valid) ?? 0).toFixed(2)) : null
}

export function summarizeWarningQuality(
  runs: WarningQualityRun[]
): WarningQualitySummary[] {
  const severities: Array<CrashSeverity | 'ALL'> = ['ALL', 'MILD', 'SHARP', 'SEVERE']
  const recoveryShapes: Array<RecoveryShape | 'ALL'> = [
    'ALL',
    'V_SHAPE',
    'DEAD_CAT',
    'GRINDING_BEAR',
    'DELAYED_RECOVERY',
  ]

  const summaries: WarningQualitySummary[] = []

  for (const severity of severities) {
    for (const recoveryShape of recoveryShapes) {
      if (severity === 'ALL' && recoveryShape === 'ALL') {
        // allowed
      }

      const bucket = runs.filter((run) => {
        const severityMatch = severity === 'ALL' ? true : run.severity === severity
        const recoveryMatch = recoveryShape === 'ALL' ? true : run.recoveryShape === recoveryShape
        return severityMatch && recoveryMatch
      })

      if (!bucket.length) continue

      summaries.push({
        severity,
        recoveryShape,
        nRuns: bucket.length,
        medianLeadTimeToAlert: summarizeNullableMetric(bucket.map((run) => run.leadTimeToAlert)),
        medianLeadTimeToDefenseReady: summarizeNullableMetric(
          bucket.map((run) => run.leadTimeToDefenseReady)
        ),
        medianLeadTimeToDefenseActive: summarizeNullableMetric(
          bucket.map((run) => run.leadTimeToDefenseActive)
        ),
        missedCrashRate: Number(
          (bucket.filter((run) => run.missedCrash).length / bucket.length).toFixed(4)
        ),
        avgFalseAlertCount: Number(
          (bucket.reduce((sum, run) => sum + run.falseAlertCount, 0) / bucket.length).toFixed(4)
        ),
        avgFalseDefenseCount: Number(
          (bucket.reduce((sum, run) => sum + run.falseDefenseCount, 0) / bucket.length).toFixed(4)
        ),
        medianRecoveryDetectionLag: summarizeNullableMetric(
          bucket.map((run) => run.recoveryDetectionLag)
        ),
      })
    }
  }

  return summaries
}
