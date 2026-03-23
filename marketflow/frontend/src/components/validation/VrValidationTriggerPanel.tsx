'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { loadMonitoredTopics }      from '@/lib/researchMonitorStorage'
import { buildPriorityItems }       from '@/lib/priorityBuilder'
import { buildValidationTriggers }  from '@/lib/validationTriggerBuilder'
import ValidationTriggerCard        from './ValidationTriggerCard'
import EmptyValidationTriggers      from './EmptyValidationTriggers'

export default function VrValidationTriggerPanel() {
  const [topics, setTopics] = useState<MonitoredTopic[]>([])

  useEffect(() => {
    setTopics(loadMonitoredTopics())
  }, [])

  const priorityItems   = buildPriorityItems(topics)
  const triggers        = buildValidationTriggers({ monitorTopics: topics, priorityItems })
  const criticalCount   = triggers.filter(t => t.level === 'critical' || t.level === 'elevated').length

  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(8,12,22,0.96), rgba(9,11,17,0.99))',
      border:       criticalCount > 0
        ? '1px solid rgba(248,113,113,0.18)'
        : '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      padding:      '0.9rem 1rem',
    } as CSSProperties}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: '0.63rem', color: '#64748b',
              textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700,
            }}>
              VR Validation Triggers
            </span>
            {criticalCount > 0 && (
              <span style={{
                fontSize: '0.6rem', fontWeight: 800, color: '#f87171',
                background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.28)',
                padding: '1px 7px', borderRadius: 99,
              } as CSSProperties}>
                {criticalCount} require review
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#374151', marginTop: 2 }}>
            Research and monitor changes that warrant renewed VR validation.
          </div>
        </div>
        <a
          href="/vr-survival"
          style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 600, textDecoration: 'none' } as CSSProperties}
        >
          Open VR \u2197
        </a>
      </div>

      {triggers.length === 0 ? (
        <EmptyValidationTriggers />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {triggers.map(t => (
            <ValidationTriggerCard key={t.id} trigger={t} />
          ))}
        </div>
      )}
    </div>
  )
}
