'use client'
import { useEffect, useState } from 'react'
import type { ScenarioMapping } from '@/types/scenarioMapping'
import type { MonitoredTopic }   from '@/types/researchMonitor'
import { loadMonitoredTopics }   from '@/lib/researchMonitorStorage'
import { buildScenarioMappings } from '@/lib/scenarioMappingBuilder'
import { SCENARIO_DEFINITIONS }  from '@/lib/scenarioMappingLabels'
import ScenarioMapCard  from './ScenarioMapCard'
import EmptyScenarioMap from './EmptyScenarioMap'

interface Props {
  /** Pass current VR engine state (e.g. "ARMED") for VR-page framing. */
  vrState?: string
}

export default function ResearchScenarioMapPanel({ vrState }: Props) {
  const [mappings, setMappings] = useState<ScenarioMapping[]>([])
  const [ready,    setReady]    = useState(false)

  useEffect(() => {
    const topics: MonitoredTopic[] = loadMonitoredTopics()
    setMappings(buildScenarioMappings(topics))
    setReady(true)
  }, [])

  if (!ready) return null

  const supportCount  = mappings.filter(m => m.fit === 'support').length
  const conflictCount = mappings.filter(m => m.fit === 'conflict').length
  const hasContent    = mappings.some(m => m.topic_count > 0)

  // Scenarios whose vr_states include the current VR state
  const vrAlignedIds = new Set<string>(
    vrState
      ? SCENARIO_DEFINITIONS
          .filter(d => d.vr_states.includes(vrState))
          .map(d => d.id)
      : []
  )

  // VR state badge colour
  const VR_STATE_COLOR: Record<string, string> = {
    ARMED:      '#fca5a5',
    EXIT_DONE:  '#fde68a',
    REENTRY:    '#86efac',
    CAUTION:    '#fdba74',
    INACTIVE:   '#94a3b8',
  }
  const vrColor = vrState ? (VR_STATE_COLOR[vrState] ?? '#94a3b8') : undefined

  return (
    <section style={{
      background:   'rgba(255,255,255,0.015)',
      border:       '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14,
      padding:      '1rem 1.25rem',
    }}>
      {/* Panel header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   '0.9rem',
        gap:            12,
        flexWrap:       'wrap',
      }}>
        <div>
          <div style={{
            fontSize: '0.73rem', color: '#64748b',
            textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700,
          }}>
            Scenario Mapping
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9' }}>
              Research → VR Scenarios
            </div>
            {vrState && vrColor && (
              <span style={{
                fontSize:      '0.72rem',
                fontWeight:    700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color:         vrColor,
                background:    'rgba(255,255,255,0.05)',
                border:        `1px solid ${vrColor}44`,
                borderRadius:  6,
                padding:       '0.15rem 0.55rem',
              }}>
                VR: {vrState}
              </span>
            )}
          </div>
          {vrState && (
            <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: 3 }}>
              Cards marked{' '}
              <span style={{ color: '#818cf8', fontWeight: 600 }}>VR Context</span>
              {' '}align with the current engine state.
            </div>
          )}
        </div>
        {hasContent && (
          <div style={{ fontSize: '0.73rem', color: '#64748b', flexShrink: 0 }}>
            {supportCount} supported · {conflictCount} conflict
            {vrState && vrAlignedIds.size > 0 && (
              <> · {vrAlignedIds.size} VR-aligned</>
            )}
          </div>
        )}
      </div>

      {!hasContent
        ? <EmptyScenarioMap />
        : (
          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap:                 '0.85rem',
          }}>
            {mappings.map(m => (
              <ScenarioMapCard
                key={m.scenario_id}
                mapping={m}
                isVrAligned={vrAlignedIds.has(m.scenario_id)}
              />
            ))}
          </div>
        )
      }

      <div style={{
        fontSize: '0.7rem', color: '#4b5563',
        textAlign: 'center', marginTop: '0.9rem',
      }}>
        Scenario mapping derived from monitored research topics — analytical interpretation only, not a trading signal
      </div>
    </section>
  )
}
