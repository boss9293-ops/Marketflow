import type { PatternDetectionResult } from '../../engine/pattern_detector'
import type { ScenarioPlaybookResult } from '../types/scenario'
import { mapPatternToScenarios } from './scenario_mapper'

export function mapScenarioPlaybook(
  detectionResult: PatternDetectionResult,
  options?: { rootDir?: string; maxScenarios?: number }
): ScenarioPlaybookResult {
  const primaryPattern = detectionResult.top_matches[0] ?? null
  if (!primaryPattern) {
    return {
      primary_pattern: null,
      scenarios: [],
    }
  }

  const maxScenarios = options?.maxScenarios ?? 3
  const scenarios = mapPatternToScenarios(primaryPattern, options).slice(0, maxScenarios)

  return {
    primary_pattern: {
      pattern_id: primaryPattern.pattern_id,
      pattern_name: primaryPattern.pattern_name,
      score: primaryPattern.score,
    },
    scenarios,
  }
}

export function runScenarioPlaybookExamples(rootDir = process.cwd()) {
  const cases: Array<{
    name: string
    input: PatternDetectionResult
    expectedScenarioIds: string[]
  }> = [
    {
      name: 'Geopolitical shock range',
      input: {
        top_matches: [
          { pattern_id: 'geopolitical_shock_range', pattern_name: 'Geopolitical Shock Range', score: 0.81 },
        ],
        evaluated_count: 10,
      },
      expectedScenarioIds: ['range_continuation', 'support_breakdown', 'relief_rally_breakout'],
    },
    {
      name: 'Seasonal correction',
      input: {
        top_matches: [
          { pattern_id: 'seasonal_correction', pattern_name: 'Seasonal Correction', score: 0.72 },
        ],
        evaluated_count: 10,
      },
      expectedScenarioIds: ['A', 'B', 'C'],
    },
    {
      name: 'Crash cascade',
      input: {
        top_matches: [
          { pattern_id: 'crash_cascade', pattern_name: 'Crash Cascade', score: 0.91 },
        ],
        evaluated_count: 10,
      },
      expectedScenarioIds: ['A', 'B', 'C'],
    },
  ]

  return cases.map((testCase) => {
    const result = mapScenarioPlaybook(testCase.input, { rootDir })
    const scenarioIds = result.scenarios.map((scenario) => scenario.scenario_id)
    const passed =
      result.primary_pattern?.pattern_id === testCase.input.top_matches[0]?.pattern_id &&
      testCase.expectedScenarioIds.every((id) => scenarioIds.includes(id)) &&
      result.scenarios.every((scenario) => scenario.posture_guidance.length > 0) &&
      result.scenarios.length <= 3

    return {
      name: testCase.name,
      passed,
      scenario_ids: scenarioIds,
      result,
    }
  })
}
