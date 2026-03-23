import type { MonitoredTopic } from '@/types/researchMonitor'
import type { UnifiedPriorityItem } from '@/types/priority'
import { scoreMonitorTopic, scoreToPriorityLevel } from './priorityScoring'

const RISK_BADGE_COLOR: Record<string, string> = {
  Low: '#5eead4', Moderate: '#fcd34d', Elevated: '#fb923c', High: '#fca5a5', Critical: '#f87171',
}

const STATUS_SUMMARY: Record<string, string> = {
  warning:  'Risk level is escalating. Validation is recommended.',
  changed:  'Research findings have changed. Review updated analysis.',
  updated:  'New data is available for this topic.',
  watching: 'Monitoring is active. No signal changes are detected.',
}

export function buildPriorityItems(topics: MonitoredTopic[]): UnifiedPriorityItem[] {
  if (topics.length === 0) return []

  return topics
    .map((t): UnifiedPriorityItem => {
      const score = scoreMonitorTopic(t)
      const level = scoreToPriorityLevel(score)
      const source = t.vr_context?.vr_state ? 'vr' : 'monitor'
      const riskColor = RISK_BADGE_COLOR[t.latest.risk_level] ?? '#94a3b8'
      const changeSummary = t.change_summary?.notable.length
        ? t.change_summary.notable.slice(0, 2).join(' \u00b7 ')
        : STATUS_SUMMARY[t.status] ?? ''

      const badgeParts: string[] = [t.latest.risk_level + ' Risk']
      if (t.vr_context?.vr_state) badgeParts.push(t.vr_context.vr_state)
      if (t.vr_context?.crash_trigger) badgeParts.push('Crash Trigger')

      const title = t.query.length > 60 ? t.query.slice(0, 57) + '\u2026' : t.query

      return {
        id:           t.id,
        source,
        level,
        title,
        summary:      changeSummary,
        action_label: 'Open Research \u2192',
        action_href:  `/research?load_monitor=${t.id}`,
        score,
        badge:        badgeParts.join(' \u00b7 '),
        badge_color:  riskColor,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}
