import type { MonitoredTopic } from '@/types/researchMonitor'
import type { ScenarioFitLevel } from '@/types/scenarioMapping'
import type { ScenarioDefinition } from './scenarioMappingLabels'
import { RISK_SCORE } from './researchDiff'

export function scoreTopicForScenario(
  topic:   MonitoredTopic,
  def:     ScenarioDefinition,
): { support: number; conflict: number; reasons: string[] } {
  const q = (topic.query + ' ' + (topic.topic_label ?? '')).toLowerCase()
  const riskScore = RISK_SCORE[topic.latest.risk_level] ?? 2
  const reasons: string[] = []
  let support = 0
  let conflict = 0

  // Keyword match in query
  const matched = def.keywords.filter(kw => q.includes(kw))
  if (matched.length > 0) {
    support += matched.length * 8
    reasons.push('Research signals match scenario keywords.')
  }

  // Conflict keyword match
  const conflictMatched = def.conflict_keywords.filter(kw => q.includes(kw))
  if (conflictMatched.length > 0) conflict += conflictMatched.length * 10

  // Risk level
  if (riskScore >= 4) {
    support += 15
    reasons.push(`${topic.latest.risk_level} risk assessment is active.`)
  } else if (riskScore <= 1) {
    conflict += 8
  }

  // VR state alignment
  const vrState = topic.vr_context?.vr_state ?? ''
  if (vrState && def.vr_states.includes(vrState)) {
    support += 12
    reasons.push('Current VR engine state aligns with this scenario.')
  }

  // Crash trigger
  if (
    topic.vr_context?.crash_trigger &&
    (def.id === 'bear_market' || def.id === 'vol_spike')
  ) {
    support += 10
    reasons.push('A crash trigger flag is active.')
  }

  // Monitor status
  if (topic.status === 'warning') {
    support += 10
    reasons.push('Topic risk level has escalated to warning.')
  } else if (topic.status === 'changed') {
    support += 5
  }

  // Risk direction
  const BEARISH_IDS = ['bear_market', 'credit_stress', 'vol_spike', 'liquidity_crunch'] as const
  if (topic.change_summary?.risk_direction === 'up') {
    if ((BEARISH_IDS as readonly string[]).includes(def.id)) {
      support += 8
      reasons.push('Risk is increasing within this research area.')
    }
  } else if (topic.change_summary?.risk_direction === 'down') {
    if ((BEARISH_IDS as readonly string[]).includes(def.id)) {
      conflict += 8
    }
  }

  return { support, conflict, reasons: reasons.slice(0, 3) }
}

export function fitLevelFromScore(
  support:    number,
  conflict:   number,
  topicCount: number,
): ScenarioFitLevel {
  if (topicCount === 0) return 'weak'
  const net = support - conflict * 0.6
  if (net >= 50)                   return 'support'
  if (net >= 25)                   return 'mixed'
  if (conflict > support * 1.2)    return 'conflict'
  return 'weak'
}
