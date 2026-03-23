// =============================================================================
// LatestBriefCard.tsx  (WO-SA29)
// Displays the most recently stored generated brief
// Distinguished from NarrativeBriefCard (live view) by showing generated timestamp
// =============================================================================
import type { DailyBrief } from '@/types/brief'

const SESSION_COLOR: Record<string, string> = {
  PREMARKET:   '#818CF8',
  INTRADAY:    '#4ADE80',
  POSTMARKET:  '#F97316',
  DAILY_CLOSE: '#94A3B8',
}

function SessionBadge({ session }: { session: string }) {
  const color = SESSION_COLOR[session] ?? '#94A3B8'
  return (
    <span style={{
      borderRadius:  5,
      background:    color + '14',
      border:        '1px solid ' + color + '30',
      color,
      fontSize:      '0.55rem',
      fontWeight:    800,
      padding:       '1px 7px',
      letterSpacing: '0.05em',
    }}>
      {session.replace('_', ' ')}
    </span>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 6 }}>
          <span style={{ color: '#334155', fontSize: '0.60rem', flexShrink: 0 }}>—</span>
          <span style={{ color: '#94A3B8', fontSize: '0.67rem', lineHeight: 1.5 }}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(148,163,184,0.07)', margin: '0.5rem 0' }} />
}

interface Props {
  brief: DailyBrief | null
}

export default function LatestBriefCard({ brief }: Props) {
  if (!brief) {
    return (
      <div style={{
        background:   '#070B10',
        border:       '1px solid rgba(148,163,184,0.09)',
        borderRadius: 12,
        padding:      '0.75rem 0.9rem',
        color:        '#374151',
        fontSize:     '0.68rem',
      }}>
        No generated brief available yet.
      </div>
    )
  }

  const { narrative_view: nv, session_type, date, as_of } = brief
  const ts = new Date(as_of)
  const tsLabel = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <div style={{
      background:    '#070B10',
      border:        '1px solid rgba(148,163,184,0.09)',
      borderRadius:  12,
      padding:       '0.8rem 0.95rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           0,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: '0.55rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 18, borderRadius: 4, background: '#22D3EE', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em' }}>
            GENERATED BRIEF
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SessionBadge session={session_type} />
          <span style={{ color: '#374151', fontSize: '0.58rem' }}>{date} · {tsLabel}</span>
        </div>
      </div>

      {/* Headline */}
      <div style={{ color: '#F8FAFC', fontSize: '0.80rem', fontWeight: 700, lineHeight: 1.35, marginBottom: '0.4rem' }}>
        {nv.headline}
      </div>

      {/* Summary */}
      <div style={{ color: '#94A3B8', fontSize: '0.67rem', lineHeight: 1.55 }}>
        {nv.summary}
      </div>

      {/* Key points */}
      {nv.key_points.length > 0 && (
        <>
          <Divider />
          <div style={{ color: '#475569', fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.06em', marginBottom: 4 }}>
            KEY POINTS
          </div>
          <BulletList items={nv.key_points} />
        </>
      )}

      {/* Watch next */}
      {nv.watch_items.length > 0 && (
        <>
          <Divider />
          <div style={{ color: '#475569', fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.06em', marginBottom: 4 }}>
            WATCH NEXT
          </div>
          <BulletList items={nv.watch_items} />
        </>
      )}

      {/* Posture line */}
      <Divider />
      <div style={{ color: '#64748B', fontSize: '0.63rem', lineHeight: 1.5 }}>
        {nv.posture_line}
      </div>

      {/* Closing */}
      <Divider />
      <div style={{ color: '#1E293B', fontSize: '0.59rem', lineHeight: 1.5, fontStyle: 'italic' }}>
        {nv.closing_line}
      </div>
    </div>
  )
}
