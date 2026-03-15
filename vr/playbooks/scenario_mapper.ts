import { readFileSync } from 'fs'
import { join } from 'path'
import type { PatternMatch } from '../../engine/pattern_detector'
import type { ScenarioBranch, ZoneActions } from '../types/scenario'

type PatternScenarioSeed =
  | string
  | {
      id?: string
      title?: string
      posture?: string
      description?: string
    }

type PatternInterpretationBranch = {
  scenario_id?: string
  scenario_name?: string
  description?: string
  posture_guidance?: string[]
  zone_actions?: ZoneActions
}

type PatternSeed = {
  pattern_id: string
  description?: string
  scenario_set?: PatternScenarioSeed[]
  playbook?: Record<string, string>
  pattern_interpretation?: {
    scenario_branches?: PatternInterpretationBranch[]
  }
}

function loadPatternSeed(rootDir: string, patternId: string): PatternSeed | null {
  try {
    const filePath = join(rootDir, 'vr', 'patterns', `${patternId}.json`)
    return JSON.parse(readFileSync(filePath, 'utf-8')) as PatternSeed
  } catch {
    return null
  }
}

function titleize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function inferDescription(name: string): string {
  const key = name.toLowerCase()
  if (key.includes('range_continuation')) return 'The market may continue to move sideways while reacting to headlines.'
  if (key.includes('support_breakdown')) return 'Selling pressure remains active and recent support is under pressure.'
  if (key.includes('relief_rally_breakout')) return 'A relief rally may emerge, but failed follow-through remains a risk.'
  if (key.includes('relief_rally')) return 'A rebound is possible, but confirmation remains limited.'
  if (key.includes('recovery')) return 'A rebound is possible, but confirmation remains limited.'
  if (key.includes('dead_cat_bounce')) return 'A rebound may occur, but lower-high failure risk remains elevated.'
  if (key.includes('extended_correction')) return 'Weakness may persist in a broader corrective structure.'
  if (key.includes('panic_bottom')) return 'Selling may exhaust quickly, but instability remains high.'
  if (key.includes('secondary_crash')) return 'A second downside leg remains plausible if support fails again.'
  if (key.includes('extended_bear_move')) return 'The correction may deepen into a more persistent bear phase.'
  if (key.includes('range')) return 'The market may continue moving sideways while direction remains unresolved.'
  if (key.includes('breakdown')) return 'The lower boundary of the structure fails and downside pressure resumes.'
  if (key.includes('breakout')) return 'A rebound may push through resistance, but confirmation remains limited.'
  if (key.includes('bounce')) return 'A rebound may occur, but failed follow-through remains a risk.'
  return 'This branch represents a plausible next path for the current market structure.'
}

function inferPostureGuidance(name: string, explicitPosture?: string): string[] {
  if (explicitPosture) {
    return [explicitPosture]
  }

  const key = name.toLowerCase()
  if (key.includes('breakdown') || key.includes('crash') || key.includes('extended')) {
    return ['raise pool bias', 'avoid aggressive buying', 'defensive posture']
  }
  if (key.includes('range')) {
    return ['maintain pool', 'observe / wait for confirmation', 'trial entries only']
  }
  if (key.includes('rally') || key.includes('recovery') || key.includes('bottom') || key.includes('bounce')) {
    return ['trial entries only', 'reduce chase', 'gradual rebuild only if persistence improves']
  }
  return ['observe / wait for confirmation']
}

function mapPlaybookToZoneActions(playbook?: Record<string, string>): ZoneActions | undefined {
  if (!playbook) return undefined

  const zoneActions: ZoneActions = {
    support_zone: playbook.support,
    mid_range: playbook.mid_range,
    resistance_zone: playbook.resistance,
    breakdown: playbook.breakdown,
  }

  if (!zoneActions.support_zone && !zoneActions.mid_range && !zoneActions.resistance_zone && !zoneActions.breakdown) {
    return undefined
  }

  return zoneActions
}

function buildFallbackScenarios(match: PatternMatch, seed: PatternSeed): ScenarioBranch[] {
  const scenarioSeeds = Array.isArray(seed.scenario_set) ? seed.scenario_set : []
  const zoneActions = mapPlaybookToZoneActions(seed.playbook)

  return scenarioSeeds
    .slice(0, 3)
    .map((scenario, index) => {
      const rawName =
        typeof scenario === 'string'
          ? scenario
          : scenario.title ?? scenario.id ?? `scenario_${index + 1}`

      return {
        scenario_id:
          typeof scenario === 'string'
            ? scenario
            : scenario.id ?? rawName.toLowerCase().replace(/\s+/g, '_'),
        scenario_name: titleize(rawName),
        source_pattern_id: match.pattern_id,
        source_pattern_name: match.pattern_name,
        match_score: match.score,
        description:
          typeof scenario === 'string'
            ? inferDescription(scenario)
            : scenario.description ?? inferDescription(rawName),
        posture_guidance:
          typeof scenario === 'string'
            ? inferPostureGuidance(scenario)
            : inferPostureGuidance(rawName, scenario.posture),
        zone_actions: zoneActions,
      }
    })
    .filter((scenario) => Boolean(scenario.scenario_id && scenario.scenario_name && scenario.description))
}

export function mapPatternToScenarios(
  match: PatternMatch,
  options?: { rootDir?: string }
): ScenarioBranch[] {
  const rootDir = options?.rootDir ?? process.cwd()
  const seed = loadPatternSeed(rootDir, match.pattern_id)
  if (!seed) return []

  const interpretationBranches = seed.pattern_interpretation?.scenario_branches
  if (Array.isArray(interpretationBranches) && interpretationBranches.length > 0) {
    return interpretationBranches
      .slice(0, 3)
      .map((branch, index) => ({
        scenario_id: branch.scenario_id ?? `scenario_${index + 1}`,
        scenario_name: branch.scenario_name ?? `Scenario ${index + 1}`,
        source_pattern_id: match.pattern_id,
        source_pattern_name: match.pattern_name,
        match_score: match.score,
        description: branch.description ?? 'Scenario description not provided.',
        posture_guidance:
          Array.isArray(branch.posture_guidance) && branch.posture_guidance.length > 0
            ? branch.posture_guidance
            : ['observe / wait for confirmation'],
        zone_actions: branch.zone_actions,
      }))
      .filter((branch) => Boolean(branch.scenario_id && branch.scenario_name && branch.description))
  }

  return buildFallbackScenarios(match, seed)
}
