import type { MonitoredTopic } from '@/types/researchMonitor'
import type { ScenarioMapping } from '@/types/scenarioMapping'
import { SCENARIO_DEFINITIONS } from './scenarioMappingLabels'
import { scoreTopicForScenario, fitLevelFromScore } from './scenarioMappingScoring'

export function buildScenarioMappings(topics: MonitoredTopic[]): ScenarioMapping[] {
  if (topics.length === 0) return []

  return SCENARIO_DEFINITIONS
    .map((def): ScenarioMapping => {
      let totalSupport = 0
      let totalConflict = 0
      const allReasons: string[] = []
      let matchedTopics = 0

      for (const topic of topics) {
        const { support, conflict, reasons } = scoreTopicForScenario(topic, def)
        if (support > 0 || conflict > 0) {
          totalSupport  += support
          totalConflict += conflict
          allReasons.push(...reasons)
          if (support > 5) matchedTopics++
        }
      }

      const fit       = fitLevelFromScore(totalSupport, totalConflict, matchedTopics)
      const fit_score = Math.min(100, Math.max(0, totalSupport - Math.round(totalConflict * 0.6)))

      // Deduplicate reasons
      const why_mapped = [...new Set(allReasons)]
        .slice(0, 4)
        .concat(
          fit === 'conflict' && allReasons.length === 0
            ? ['Evidence contradicts this scenario path']
            : allReasons.length === 0
              ? ['Insufficient signal from current topics']
              : []
        )
        .slice(0, 4)

      const monitor_next = _buildMonitorNext(topics, def)

      return {
        scenario_id:     def.id,
        scenario_label:  def.label,
        scenario_desc:   def.desc,
        fit,
        fit_score,
        why_mapped,
        monitor_next,
        topic_count:     matchedTopics,
        primary_href:    def.primary_href,
        secondary_href:  def.secondary_href,
        secondary_label: def.secondary_label,
      }
    })
    .sort((a, b) => b.fit_score - a.fit_score)
}

function _buildMonitorNext(
  topics: MonitoredTopic[],
  def:    typeof SCENARIO_DEFINITIONS[number],
): string[] {
  const items = [...def.monitor_next_default]
  for (const t of topics) {
    const q = t.query.toLowerCase()
    if (def.keywords.some(kw => q.includes(kw))) {
      const label = t.query.length > 40 ? t.query.slice(0, 38) + '…' : t.query
      const prefix = label.slice(0, 15).toLowerCase()
      if (!items.some(it => it.toLowerCase().includes(prefix))) {
        items.push('Update: ' + label)
      }
    }
  }
  return items.slice(0, 4)
}
