// =============================================================================
// DailyChangeCard.tsx  (WO-SA25)
// "What changed today?" block + mini 5-day timeline
// =============================================================================
import type { DailySnapshotView } from '@/lib/buildDailySnapshot'
import MiniTimeline from './MiniTimeline'

const SEVERITY_COLOR = { high: '#F87171', medium: '#FACC15', low: '#94A3B8' } as const

function ArrowBadge({ from, to, severity }: { from: string; to: string; severity: 'high' | 'medium' | 'low' }) {
  const color = SEVERITY_COLOR[severity]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: '#475569', fontSize: '0.65rem' }}>–</span>
      <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}>
        Runtime moved to{' '}
        <span style={{ color, fontWeight: 700 }}>{to}</span>
        {' '}(was {from})
        {severity === 'high' ? ' 🔺' : severity === 'medium' ? ' ▲' : ''}
      </span>
    </div>
  )
}

function GateChange({ from, to, severity }: { from: string; to: string; severity: 'high' | 'medium' | 'low' }) {
  const color = SEVERITY_COLOR[severity]
  const action = to === 'BLOCKED' ? 'restricted' : to === 'OPEN' ? 'reopened' : 'adjusted'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: '#475569', fontSize: '0.65rem' }}>–</span>
      <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}>
        Buy activity <span style={{ color, fontWeight: 700 }}>{action}</span>
        {' '}({from} → {to})
        {severity === 'high' ? ' 🔺' : ''}
      </span>
    </div>
  )
}

interface Props {
  view: DailySnapshotView | null
}

export default function DailyChangeCard({ view }: Props) {
  if (!view) return null
  const { changes, timeline, has_changes } = view

  return (
    <div style={{
      background:    '#070B10',
      border:        '1px solid rgba(148,163,184,0.09)',
      borderRadius:  12,
      padding:       '0.75rem 0.85rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           '0.65rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 18, borderRadius: 4, background: '#F59E0B', flexShrink: 0 }} />
          <span style={{ color: '#F8FAFC', fontSize: '0.78rem', fontWeight: 800 }}>What changed today?</span>
        </div>
        {/* Mini timeline */}
        {timeline.length > 0 && <MiniTimeline entries={timeline} />}
      </div>

      {/* Change list */}
      {!has_changes ? (
        <div style={{ color: '#374151', fontSize: '0.68rem', paddingLeft: 4 }}>
          No major changes today.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {changes.slice(0, 3).map((c, i) => {
            if (c.field === 'Runtime') {
              return <ArrowBadge key={i} from={c.from} to={c.to} severity={c.severity} />
            }
            if (c.field === 'Buy Gate') {
              return <GateChange key={i} from={c.from} to={c.to} severity={c.severity} />
            }
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#475569', fontSize: '0.65rem' }}>–</span>
                <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}>{c.field}: {c.from} → {c.to}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
