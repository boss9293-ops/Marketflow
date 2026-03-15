export type ZoneActions = {
  support_zone?: string
  mid_range?: string
  resistance_zone?: string
  breakdown?: string
}

export type ScenarioBranch = {
  scenario_id: string
  scenario_name: string
  source_pattern_id: string
  source_pattern_name: string
  match_score: number
  description: string
  posture_guidance: string[]
  zone_actions?: ZoneActions
}

export type ScenarioPlaybookResult = {
  primary_pattern: {
    pattern_id: string
    pattern_name: string
    score: number
  } | null
  scenarios: ScenarioBranch[]
}
