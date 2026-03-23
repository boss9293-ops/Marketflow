// =============================================================================
// DailyStatusStrip.tsx  (WO-SA25)
// Compact daily status bar — shows today's regime/runtime/gate + change badges
// Placement: immediately after SmartAnalyzerHero
// =============================================================================
import type { DailySnapshotView } from '@/lib/buildDailySnapshot'

const RUNTIME_COLOR: Record<string, string> = {
  LOCKDOWN:  '#F87171',
  DEFENSIVE: '#F97316',
  LIMITED:   '#FACC15',
  NORMAL:    '#4ADE80',
}

const GATE_COLOR: Record<string, string> = {
  BLOCKED: '#F87171',
  LIMITED: '#FACC15',
  OPEN:    '#4ADE80',
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0 }}>
        {label}
      </span>
      <span style={{
        borderRadius:  5,
        background:    color + '14',
        border:        '1px solid ' + color + '30',
        color,
        fontSize:      '0.68rem',
        fontWeight:    800,
        padding:       '2px 8px',
        letterSpacing: '0.03em',
      }}>
        {value}
      </span>
    </div>
  )
}

function ChangeArrow({ from, to, severity }: { from: string; to: string; severity: 'high' | 'medium' | 'low' }) {
  const color = severity === 'high' ? '#F87171' : severity === 'medium' ? '#FACC15' : '#94A3B8'
  return (
    <span style={{ fontSize: '0.63rem', color, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {from} → {to} {severity === 'high' ? '🔺' : severity === 'medium' ? '▲' : ''}
    </span>
  )
}

interface Props {
  view: DailySnapshotView | null
}

export default function DailyStatusStrip({ view }: Props) {
  if (!view) return null
  const { today, changes } = view

  const runtimeColor = RUNTIME_COLOR[today.runtime] ?? '#94A3B8'
  const gateColor    = GATE_COLOR[today.buy_gate]   ?? '#94A3B8'
  const hasChanges   = changes.length > 0

  return (
    <div style={{
      background:    '#070B10',
      border:        hasChanges
        ? '1px solid rgba(248,113,113,0.22)'
        : '1px solid rgba(148,163,184,0.09)',
      borderRadius:  12,
      padding:       '0.65rem 0.85rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           6,
    }}>
      {/* Top row — status chips */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 4, height: 18, borderRadius: 4, background: runtimeColor, flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em' }}>
            TODAY
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Chip label="REGIME"  value={today.regime}  color={'#818CF8'} />
          <Chip label="POSTURE" value={today.runtime}  color={runtimeColor} />
          <Chip label="BUY GATE" value={today.buy_gate} color={gateColor} />
        </div>
      </div>

      {/* Change row */}
      {hasChanges ? (
        <div style={{
          background:   'rgba(248,113,113,0.05)',
          border:       '1px solid rgba(248,113,113,0.14)',
          borderRadius: 6,
          padding:      '4px 10px',
          display:      'flex',
          alignItems:   'center',
          gap:          8,
          flexWrap:     'wrap',
        }}>
          <span style={{ color: '#F87171', fontSize: '0.60rem', fontWeight: 800, letterSpacing: '0.04em', flexShrink: 0 }}>
            NEW TODAY
          </span>
          {changes.slice(0, 3).map((c, i) => (
            <ChangeArrow key={i} from={c.from} to={c.to} severity={c.severity} />
          ))}
        </div>
      ) : (
        <div style={{ color: '#374151', fontSize: '0.62rem', paddingLeft: 10 }}>
          No major changes today.
        </div>
      )}
    </div>
  )
}
