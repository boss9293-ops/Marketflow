'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { loadMonitoredTopics } from '@/lib/researchMonitorStorage'
import { buildPriorityItems }  from '@/lib/priorityBuilder'
import { buildDailyDigest }    from '@/lib/dailyDigestBuilder'
import {
  formatDigestDate,
  formatDigestCountLabel,
  getDigestHeadlineClass,
  HEADLINE_COLOR,
} from '@/lib/digestFormatting'
import DigestSection       from './DigestSection'
import DigestHighlightCard from './DigestHighlightCard'
import DigestTopicRow      from './DigestTopicRow'
import DigestVrImpactBox   from './DigestVrImpactBox'
import EmptyDailyDigest    from './EmptyDailyDigest'

export default function DailyDigestPanel() {
  const [topics, setTopics] = useState<MonitoredTopic[]>([])

  useEffect(() => {
    setTopics(loadMonitoredTopics())
  }, [])

  const priorityItems   = buildPriorityItems(topics)
  const digest          = buildDailyDigest({ monitorTopics: topics, priorityItems })
  const headlineClass   = getDigestHeadlineClass(digest)
  const headlineColor   = HEADLINE_COLOR[headlineClass]

  const METRICS = [
    { label: 'Priority',     value: digest.priority_count, color: '#818cf8' },
    { label: 'Changed',      value: digest.changed_count,  color: '#fcd34d' },
    { label: 'Needs Review', value: digest.warning_count,  color: '#fca5a5' },
  ]

  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(8,12,22,0.96), rgba(9,11,17,0.99))',
      border:       '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      padding:      '1rem 1.1rem',
    } as CSSProperties}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 14, flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.62rem', color: '#64748b',
            textTransform: 'uppercase', letterSpacing: '0.13em', fontWeight: 700, marginBottom: 4,
          }}>
            Daily Research Digest
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: headlineColor, lineHeight: 1.25 }}>
            {digest.headline}
          </div>
          <div style={{ fontSize: '0.73rem', color: '#475569', marginTop: 4, lineHeight: 1.5, maxWidth: 560 }}>
            {digest.summary}
          </div>
        </div>
        <div style={{ fontSize: '0.62rem', color: '#374151', flexShrink: 0, paddingTop: 2 }}>
          {formatDigestDate(digest.date)}
        </div>
      </div>

      {digest.empty ? (
        <EmptyDailyDigest />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Metrics row */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {METRICS.map(m => (
              <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{
                  fontSize: '1.1rem', fontWeight: 900, lineHeight: 1,
                  color: m.value > 0 ? m.color : '#374151',
                }}>
                  {m.value}
                </span>
                <span style={{
                  fontSize: '0.61rem', color: '#475569', fontWeight: 600, letterSpacing: '0.05em',
                }}>
                  {m.label}
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

          {/* Section 1: Today's Priority */}
          {digest.top_topics.length > 0 && (
            <DigestSection
              title="Today's Priority"
              subtitle={formatDigestCountLabel(digest.top_topics.length, 'item') + ' surfaced'}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {digest.top_topics.map(t => (
                  <div key={t.id} style={{ flex: '1 1 190px', minWidth: 0 }}>
                    <DigestHighlightCard topic={t} />
                  </div>
                ))}
              </div>
            </DigestSection>
          )}

          {/* Section 2: Changed Topics */}
          {digest.changed_topics.length > 0 && (
            <DigestSection
              title="Changed Topics"
              subtitle={formatDigestCountLabel(digest.changed_topics.length, 'topic') + ' since last check'}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {digest.changed_topics.map(t => (
                  <DigestTopicRow key={t.id} topic={t} />
                ))}
              </div>
            </DigestSection>
          )}

          {/* Section 3: Research Highlights */}
          {digest.research_highlights.length > 0 && (
            <DigestSection title="Research Highlights">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {digest.research_highlights.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.68rem', color: '#475569', flexShrink: 0, marginTop: 2 }}>\u00b7</span>
                    <span style={{ fontSize: '0.76rem', color: '#94a3b8', lineHeight: 1.5 }}>{h}</span>
                  </div>
                ))}
              </div>
            </DigestSection>
          )}

          {/* Section 4: Why this matters for VR */}
          <DigestSection title="Why this matters for VR">
            <DigestVrImpactBox summary={digest.vr_impact_summary} />
          </DigestSection>

          <div style={{ fontSize: '0.63rem', color: '#1f2937', textAlign: 'right' }}>
            A surfaced daily view of monitored research changes and VR-linked priorities. Not a trading signal.
          </div>

        </div>
      )}
    </div>
  )
}
