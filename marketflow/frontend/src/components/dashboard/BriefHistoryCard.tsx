// =============================================================================
// BriefHistoryCard.tsx  (WO-SA29)
// Compact list of past generated briefs (last 5)
// =============================================================================
import type { BriefHistoryEntry } from '@/types/brief'

const SESSION_COLOR: Record<string, string> = {
  PREMARKET:   '#818CF8',
  INTRADAY:    '#4ADE80',
  POSTMARKET:  '#F97316',
  DAILY_CLOSE: '#94A3B8',
}

interface Props {
  history: BriefHistoryEntry[]
}

export default function BriefHistoryCard({ history }: Props) {
  if (history.length === 0) return null

  const recent = history.slice(0, 5)

  return (
    <div style={{
      background:   '#070B10',
      border:       '1px solid rgba(148,163,184,0.09)',
      borderRadius: 12,
      overflow:     'hidden',
    }}>
      {/* Header */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        justifyContent:'space-between',
        padding:      '7px 10px',
        borderBottom: '1px solid rgba(148,163,184,0.07)',
      }}>
        <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 800, letterSpacing: '0.05em' }}>
          BRIEF HISTORY
        </span>
        <span style={{ color: '#374151', fontSize: '0.58rem' }}>{history.length} stored</span>
      </div>

      {/* Rows */}
      {recent.map((entry, i) => {
        const color  = SESSION_COLOR[entry.session_type] ?? '#94A3B8'
        const ts     = new Date(entry.as_of)
        const label  = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const isLast = i === recent.length - 1

        return (
          <div key={entry.id} style={{
            padding:      '6px 10px',
            borderBottom: isLast ? 'none' : '1px solid rgba(148,163,184,0.05)',
            display:      'flex',
            alignItems:   'center',
            gap:          8,
          }}>
            {/* Session dot */}
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />

            {/* Date + session */}
            <span style={{ color: '#374151', fontSize: '0.60rem', fontWeight: 700, flexShrink: 0, minWidth: 55 }}>
              {label}
            </span>
            <span style={{
              borderRadius: 4,
              background:   color + '12',
              border:       '1px solid ' + color + '28',
              color,
              fontSize:     '0.52rem',
              fontWeight:   800,
              padding:      '0 5px',
              letterSpacing:'0.04em',
              flexShrink:   0,
            }}>
              {entry.session_type.replace('_', ' ')}
            </span>

            {/* Headline */}
            <span style={{
              color:        '#4B5563',
              fontSize:     '0.63rem',
              lineHeight:   1.3,
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
              flex:         1,
            }}>
              {entry.headline}
            </span>
          </div>
        )
      })}
    </div>
  )
}
