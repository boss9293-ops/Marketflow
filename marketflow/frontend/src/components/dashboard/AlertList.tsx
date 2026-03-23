'use client'
// =============================================================================
// AlertList.tsx  (WO-SA26)
// Compact list of active alerts — placed below SmartAnalyzerHero
// Shows all severity levels; HIGH in red, MEDIUM in yellow, LOW in slate
// =============================================================================
import { useAlerts } from '@/lib/useAlerts'
import type { Alert, AlertSeverity } from '@/types/alert'

const SEV_COLOR: Record<AlertSeverity, string> = {
  HIGH:   '#F87171',
  MEDIUM: '#FACC15',
  LOW:    '#94A3B8',
}

const TYPE_LABEL: Record<string, string> = {
  RUNTIME: 'POSTURE',
  GATE:    'GATE',
  RISK:    'RISK',
}

interface Props {
  alerts: Alert[]
}

function AlertRow({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const color = SEV_COLOR[alert.severity]
  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      justifyContent:'space-between',
      gap:           10,
      padding:       '5px 10px',
      borderBottom:  '1px solid rgba(148,163,184,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        {/* severity dot */}
        <span style={{
          width:        6,
          height:       6,
          borderRadius: '50%',
          background:   color,
          flexShrink:   0,
        }} />
        {/* type badge */}
        <span style={{
          borderRadius:  4,
          background:    color + '14',
          border:        '1px solid ' + color + '30',
          color,
          fontSize:      '0.55rem',
          fontWeight:    800,
          padding:       '1px 5px',
          letterSpacing: '0.04em',
          flexShrink:    0,
        }}>
          {TYPE_LABEL[alert.type] ?? alert.type}
        </span>
        <span style={{ color: '#CBD5E1', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {alert.title}
        </span>
      </div>
      <button
        onClick={onDismiss}
        title="Dismiss"
        style={{
          background:  'transparent',
          border:      'none',
          color:       '#374151',
          fontSize:    '0.75rem',
          cursor:      'pointer',
          padding:     '0 2px',
          lineHeight:  1,
          flexShrink:  0,
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function AlertList({ alerts }: Props) {
  const { visible, dismissAll, dismiss } = useAlerts(alerts)

  if (visible.length === 0) return null

  return (
    <div style={{
      background:   '#070B10',
      border:       '1px solid rgba(148,163,184,0.09)',
      borderRadius: 10,
      overflow:     'hidden',
    }}>
      {/* Header */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        padding:       '6px 10px',
        borderBottom:  '1px solid rgba(148,163,184,0.09)',
      }}>
        <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 800, letterSpacing: '0.05em' }}>
          ACTIVE ALERTS ({visible.length})
        </span>
        <button
          onClick={dismissAll}
          style={{
            background:  'transparent',
            border:      'none',
            color:       '#374151',
            fontSize:    '0.60rem',
            fontWeight:  700,
            cursor:      'pointer',
            letterSpacing: '0.04em',
          }}
        >
          CLEAR ALL
        </button>
      </div>

      {/* Rows */}
      {visible.map(a => (
        <AlertRow key={a.id} alert={a} onDismiss={() => dismiss(a.id)} />
      ))}
    </div>
  )
}
