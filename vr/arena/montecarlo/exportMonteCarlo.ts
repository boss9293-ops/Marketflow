import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  MonteCarloCalibrationTable,
  InjectedScenarioMeta,
  MonteCarloOverlayExample,
  MonteCarloMeta,
  MonteCarloScenarioFingerprint,
  MonteCarloScenarioSliceSummary,
  MonteCarloStrategyRun,
  MonteCarloStrategySummary,
  RegimeModel,
  WarningEvent,
  WarningQualityRun,
  WarningQualitySummary,
  WarningTracePoint,
} from './types'

function toCsv<T extends object>(rows: T[]) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0] as Record<string, unknown>)
  const escapeValue = (value: unknown) => {
    if (value == null) return ''
    const raw = String(value)
    return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
  }
  return [
    headers.join(','),
    ...rows.map((row) => {
      const record = row as Record<string, unknown>
      return headers.map((header) => escapeValue(record[header])).join(',')
    }),
  ].join('\n')
}

export async function exportMonteCarloResults(args: {
  runs: MonteCarloStrategyRun[]
  summaries: MonteCarloStrategySummary[]
  scenarioSliceSummaries?: MonteCarloScenarioSliceSummary[]
  injectedScenarios?: InjectedScenarioMeta[]
  warningTrace?: WarningTracePoint[]
  warningEvents?: WarningEvent[]
  warningQualityRuns?: WarningQualityRun[]
  warningQualitySummaries?: WarningQualitySummary[]
  scenarioFingerprintLibrary?: MonteCarloScenarioFingerprint[]
  calibrationTable?: MonteCarloCalibrationTable | null
  overlayExample?: MonteCarloOverlayExample | null
  regimeModel?: RegimeModel | null
  meta: MonteCarloMeta
  outputDir?: string
}): Promise<void> {
  const outputDir = args.outputDir ?? join(process.cwd(), 'marketflow_data', 'arena_mc')
  await mkdir(outputDir, { recursive: true })

  await Promise.all([
    writeFile(join(outputDir, 'arena_mc_runs.json'), JSON.stringify(args.runs, null, 2), 'utf-8'),
    writeFile(join(outputDir, 'arena_mc_summary.json'), JSON.stringify(args.summaries, null, 2), 'utf-8'),
    writeFile(
      join(outputDir, 'arena_mc_scenario_slice_summary.json'),
      JSON.stringify(args.scenarioSliceSummaries ?? [], null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_injected_scenarios.json'),
      JSON.stringify(args.injectedScenarios ?? [], null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_warning_trace.json'),
      JSON.stringify(args.warningTrace ?? [], null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_warning_events.json'),
      JSON.stringify(args.warningEvents ?? [], null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_warning_quality.json'),
      JSON.stringify(args.warningQualityRuns ?? [], null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_warning_quality_summary.json'),
      JSON.stringify(args.warningQualitySummaries ?? [], null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_fingerprint_library.json'),
      JSON.stringify(args.scenarioFingerprintLibrary ?? [], null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_calibration_table.json'),
      JSON.stringify(args.calibrationTable ?? null, null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_overlay_example.json'),
      JSON.stringify(args.overlayExample ?? null, null, 2),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_regime_model.json'),
      JSON.stringify(args.regimeModel ?? null, null, 2),
      'utf-8'
    ),
    writeFile(join(outputDir, 'arena_mc_meta.json'), JSON.stringify(args.meta, null, 2), 'utf-8'),
    writeFile(join(outputDir, 'arena_mc_runs.csv'), toCsv(args.runs), 'utf-8'),
    writeFile(join(outputDir, 'arena_mc_summary.csv'), toCsv(args.summaries), 'utf-8'),
    writeFile(
      join(outputDir, 'arena_mc_scenario_slice_summary.csv'),
      toCsv(args.scenarioSliceSummaries ?? []),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_injected_scenarios.csv'),
      toCsv(args.injectedScenarios ?? []),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_warning_quality.csv'),
      toCsv(args.warningQualityRuns ?? []),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_warning_quality_summary.csv'),
      toCsv(args.warningQualitySummaries ?? []),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_fingerprint_library.csv'),
      toCsv(args.scenarioFingerprintLibrary ?? []),
      'utf-8'
    ),
    writeFile(
      join(outputDir, 'arena_mc_calibration_table.csv'),
      toCsv(args.calibrationTable ? Object.values(args.calibrationTable) : []),
      'utf-8'
    ),
  ])
}
