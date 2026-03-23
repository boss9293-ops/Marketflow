import type { ValidationTrigger, ValidationTriggerLevel, ValidationTarget } from '@/types/validationTrigger'
import type { MonitoredTopic } from '@/types/researchMonitor'
import type { UnifiedPriorityItem } from '@/types/priority'
import { sortValidationTriggers } from './validationTriggerScoring'

const VR_CHECKLISTS: Record<string, string[]> = {
  REENTRY: [
    'Check whether rebound quality still supports the re-entry interpretation.',
    'Review Crash Analysis for false stabilization risk.',
    'Compare strategy behavior under similar prior rebound attempts.',
    'Validate analog consistency with current regime.',
  ],
  ARMED: [
    'Validate whether the defensive posture remains justified.',
    'Check drawdown acceleration and crash-structure persistence.',
    'Review whether elevated risk is broadening or narrowing.',
    'Confirm strategy position still aligns with current regime.',
  ],
  EXIT_DONE: [
    'Confirm whether post-exit capital preservation remains appropriate.',
    'Check whether recovery evidence is strengthening or still fragile.',
    'Review conditions under which de-risking remains valid.',
  ],
  CAUTION: [
    'Review whether research changes are broadening the risk profile.',
    'Check if risk posture warrants an upgrade.',
    'Validate whether the current regime interpretation holds.',
  ],
  NORMAL: [
    'Review whether current research changes materially affect the VR regime.',
    'Check if any new evidence shifts the baseline posture.',
  ],
}

function getChecklist(vrState?: string): string[] {
  return VR_CHECKLISTS[vrState ?? ''] ?? VR_CHECKLISTS['NORMAL']
}

function getPrimaryLink(
  vrState?: string,
  level?: ValidationTriggerLevel,
): { target: ValidationTarget; href: string } {
  if (level === 'critical' || level === 'elevated') {
    return { target: 'crash_analysis', href: '/vr-survival?tab=Crash+Analysis' }
  }
  if (vrState === 'REENTRY') {
    return { target: 'strategy_lab', href: '/vr-survival?tab=Strategy+Lab' }
  }
  return { target: 'vr', href: '/vr-survival' }
}

interface BuildParams {
  monitorTopics?: MonitoredTopic[]
  priorityItems?: UnifiedPriorityItem[]
  vrContext?:     { vr_state?: string; crash_trigger?: boolean; confidence?: string }
}

export function buildValidationTriggers({
  monitorTopics = [],
}: BuildParams): ValidationTrigger[] {
  const triggers: ValidationTrigger[] = []

  monitorTopics.forEach(m => {
    const vrState   = m.vr_context?.vr_state
    const riskLevel = m.latest.risk_level
    const status    = m.status

    // Only trigger for VR-linked topics with meaningful changes
    if (!vrState) return
    if (status === 'watching' && !m.change_summary?.risk_changed) return

    const reasons: string[] = []
    if (status === 'warning')                  reasons.push('Monitored topic escalated to warning status.')
    if (status === 'changed')                  reasons.push('Research findings changed since the previous check.')
    if (m.change_summary?.risk_changed)        reasons.push('Risk profile changed since the previous check.')
    if (m.change_summary?.summary_changed)     reasons.push('Narrative drift detected in the latest research interpretation.')
    if (m.change_summary?.evidence_changed)    reasons.push('Evidence base updated since the previous check.')
    if (m.vr_context?.crash_trigger)           reasons.push('This topic is linked to an active crash trigger context.')

    if (reasons.length === 0) return

    const level: ValidationTriggerLevel =
      status === 'warning'
        ? 'critical'
        : (riskLevel === 'High' || riskLevel === 'Critical')
          ? 'elevated'
          : status === 'changed'
            ? 'review'
            : 'watch'

    const vrSummary =
      vrState === 'REENTRY'
        ? 'Recent research changes should be validated against the current re-entry regime.'
        : vrState === 'ARMED'
          ? 'Recent research changes should be checked against the current defensive posture.'
          : vrState === 'EXIT_DONE'
            ? 'Recent changes warrant reviewing post-exit capital preservation logic.'
            : 'Recent monitored changes warrant renewed VR review.'

    const rawTitle = m.query.length > 52 ? m.query.slice(0, 50) + '\u2026' : m.query
    const { target, href } = getPrimaryLink(vrState, level)

    triggers.push({
      id:               `trigger-${m.id}`,
      level,
      title:            `${rawTitle} \u2014 VR validation required`,
      summary:          vrSummary,
      source_type:      'monitor',
      linked_topic_id:  m.id,
      linked_vr_state:  vrState,
      crash_trigger:    m.vr_context?.crash_trigger,
      confidence:       m.vr_context?.confidence,
      risk_level:       riskLevel,
      reasons,
      checklist:        getChecklist(vrState),
      primary_target:   target,
      primary_href:     href,
      secondary_href:   `/research?load_monitor=${m.id}`,
      secondary_label:  'Open Research',
      created_at:       m.last_checked,
    })
  })

  return sortValidationTriggers(triggers).slice(0, 5)
}
