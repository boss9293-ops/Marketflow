import type { CSSProperties } from 'react'
import type { ScenarioMapping } from '@/types/scenarioMapping'
import ScenarioFitBadge    from './ScenarioFitBadge'
import ScenarioReasonList  from './ScenarioReasonList'
import ScenarioMonitorNext from './ScenarioMonitorNext'
import Link from 'next/link'

const FIT_BORDER: Record<string, string> = {
  support:  'rgba(34,197,94,0.22)',
  mixed:    'rgba(251,191,36,0.16)',
  weak:     'rgba(255,255,255,0.06)',
  conflict: 'rgba(239,68,68,0.22)',
}

const linkBase: CSSProperties = {
  fontSize: '0.78rem', textDecoration: 'none',
  padding: '0.28rem 0.75rem', borderRadius: 7,
}

interface Props {
  mapping:      ScenarioMapping
  isVrAligned?: boolean
}

export default function ScenarioMapCard({ mapping, isVrAligned }: Props) {
  return (
    <div style={{
      background:    'rgba(255,255,255,0.025)',
      border:        `1px solid ${FIT_BORDER[mapping.fit] ?? 'rgba(255,255,255,0.06)'}`,
      borderRadius:  12,
      padding:       '1rem 1.1rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           10,
      position:      'relative',
    }}>

      {/* VR aligned indicator */}
      {isVrAligned && (
        <div style={{
          position:  'absolute', top: 10, right: 10,
          fontSize:  '0.67rem', color: '#818cf8',
          fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase',
          background: 'rgba(99,102,241,0.1)',
          border:     '1px solid rgba(99,102,241,0.22)',
          borderRadius: 5,
          padding:    '0.1rem 0.42rem',
        }}>
          VR Context
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingRight: isVrAligned ? 72 : 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>
            {mapping.scenario_label}
          </div>
          <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: 2 }}>
            {mapping.scenario_desc}
          </div>
        </div>
        <ScenarioFitBadge fit={mapping.fit} />
      </div>

      {/* Why mapped */}
      {mapping.why_mapped.length > 0 && (
        <div>
          <div style={{
            fontSize: '0.7rem', color: '#64748b', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
          }}>
            Why mapped
          </div>
          <ScenarioReasonList reasons={mapping.why_mapped} />
        </div>
      )}

      {/* Monitor next */}
      <ScenarioMonitorNext items={mapping.monitor_next} />

      {/* Action links */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 2 }}>
        <Link
          href={mapping.primary_href}
          style={{ ...linkBase, color: '#a5b4fc', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}
        >
          Open VR &#x2192;
        </Link>
        {mapping.secondary_href && (
          <Link
            href={mapping.secondary_href}
            style={{ ...linkBase, color: '#94a3b8', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {mapping.secondary_label ?? 'More'} &#x2192;
          </Link>
        )}
      </div>
    </div>
  )
}
