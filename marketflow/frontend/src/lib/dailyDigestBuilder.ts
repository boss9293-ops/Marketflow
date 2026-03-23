import type { DailyDigest, DailyDigestTopic } from '@/types/digest'
import type { MonitoredTopic } from '@/types/researchMonitor'
import type { UnifiedPriorityItem } from '@/types/priority'

interface BuildParams {
  monitorTopics?: MonitoredTopic[]
  priorityItems?: UnifiedPriorityItem[]
}

export function buildDailyDigest({
  monitorTopics = [],
  priorityItems = [],
}: BuildParams): DailyDigest {

  const warningTopics = monitorTopics.filter(m => m.status === 'warning')
  const changedTopics = monitorTopics.filter(m => m.status === 'changed' || m.status === 'warning')

  // ── Today's Priority — top 3 from priority items, enriched from monitor topic ──
  const topTopics: DailyDigestTopic[] = priorityItems.slice(0, 3).map(p => {
    const src = monitorTopics.find(m => m.id === p.id)
    return {
      id:           p.id,
      title:        p.title,
      status:       src?.status,
      risk_level:   src?.latest.risk_level,
      vr_state:     src?.vr_context?.vr_state,
      confidence:   src?.vr_context?.confidence,
      short_reason: p.summary || undefined,
      href:         p.action_href,
    }
  })

  // ── Changed Topics — from monitor directly ──
  const changed_topics: DailyDigestTopic[] = changedTopics.slice(0, 5).map(m => ({
    id:    m.id,
    title: m.query.length > 72 ? m.query.slice(0, 70) + '\u2026' : m.query,
    status: m.status,
    risk_level:   m.latest.risk_level,
    vr_state:     m.vr_context?.vr_state,
    confidence:   m.vr_context?.confidence,
    short_reason:
      m.change_summary?.risk_changed
        ? 'Risk profile changed since last check.'
        : m.change_summary?.summary_changed
          ? 'Research narrative updated since last check.'
          : m.change_summary?.evidence_changed
            ? 'Evidence base changed since last check.'
            : 'Updated context requires review.',
    href: `/research?load_monitor=${m.id}`,
  }))

  // ── Research Highlights ──
  const research_highlights: string[] = []
  if (warningTopics.length > 0) {
    research_highlights.push(
      `${warningTopics.length} monitored topic${warningTopics.length > 1 ? 's' : ''} require elevated review.`
    )
  }
  if (changedTopics.length > 0) {
    research_highlights.push(
      `${changedTopics.length} topic${changedTopics.length > 1 ? 's' : ''} changed since the previous check.`
    )
  }
  if (monitorTopics.length > 0 && changedTopics.length === 0 && warningTopics.length === 0) {
    research_highlights.push('All monitored topics are current \u2014 no changes detected today.')
  }
  const vrLinked = monitorTopics.filter(m => m.vr_context?.vr_state).length
  if (vrLinked > 0) {
    research_highlights.push(
      `${vrLinked} monitored topic${vrLinked > 1 ? 's are' : ' is'} linked to VR engine context.`
    )
  }

  // ── VR Impact ──
  const vrStates = priorityItems
    .map(p => monitorTopics.find(m => m.id === p.id)?.vr_context?.vr_state)
    .filter((s): s is string => !!s)
  const vr_impact_summary =
    vrStates.includes('ARMED')
      ? 'Monitor changes support continued defensive validation under an ARMED VR regime.'
      : vrStates.includes('REENTRY')
        ? 'Research changes should be interpreted cautiously under a REENTRY regime \u2014 false stabilization risk remains.'
        : vrStates.includes('EXIT_DONE')
          ? "Today\u2019s research context remains relevant for post-exit capital preservation review."
          : priorityItems.length > 0
            ? "Today\u2019s research changes do not currently override routine VR review procedures."
            : 'No monitored topics with VR context currently flagged for review.'

  const empty = monitorTopics.length === 0

  return {
    date:            new Date().toISOString(),
    headline:
      empty               ? 'No elevated daily research priorities'
      : warningTopics.length > 0 ? 'Elevated research changes surfaced today'
      : changedTopics.length > 0 ? 'Research monitor changes surfaced today'
      :                     'Routine daily research review',
    summary:
      empty
        ? 'No monitored research items currently require review. Open Research Workspace to start monitoring topics.'
        : "Today\u2019s digest summarizes monitored research changes and their relevance to the current VR context.",
    priority_count:      priorityItems.length,
    changed_count:       changedTopics.length,
    warning_count:       warningTopics.length,
    top_topics:          topTopics,
    changed_topics,
    research_highlights: research_highlights.slice(0, 4),
    vr_impact_summary,
    empty,
  }
}
