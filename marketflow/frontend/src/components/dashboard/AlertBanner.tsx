'use client'
// =============================================================================
// AlertBanner.tsx  (WO-SA26)
// Full-width banner for HIGH severity alerts — placed above SmartAnalyzerHero
// =============================================================================
import { useAlerts } from '@/lib/useAlerts'
import type { Alert } from '@/types/alert'

const TYPE_ICON: Record<string, string> = {
  RUNTIME: '⚡',
  GATE:    '🚫',
  RISK:    '🔺',
}

interface Props {
  alerts: Alert[]
}

export default function AlertBanner({ alerts }: Props) {
  const { visible, dismiss } = useAlerts(alerts)

  const high = visible.filter(a => a.severity === 'HIGH')
  if (high.length === 0) return null

  const top = high[0]

  return (
    <div style={{
      background:    'rgba(239,68,68,0.08)',
      border:        '1px solid rgba(239,68,68,0.30)',
      borderRadius:  10,
      padding:       '0.65rem 0.9rem',
      display:       'flex',
      alignItems:    'center',
      justifyContent:'space-between',
      gap:           12,
      flexWrap:      'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>{TYPE_ICON[top.type] ?? '⚠️'}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ color: '#F87171', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.03em' }}>
            {top.title}
          </span>
          <span style={{ color: '#94A3B8', fontSize: '0.65rem', lineHeight: 1.4 }}>
            {top.message}
          </span>
        </div>
      </div>
      <button
        onClick={() => dismiss(top.id)}
        style={{
          background:  'transparent',
          border:      '1px solid rgba(248,113,113,0.25)',
          borderRadius: 6,
          color:       '#F87171',
          fontSize:    '0.60rem',
          fontWeight:  700,
          padding:     '3px 10px',
          cursor:      'pointer',
          flexShrink:  0,
          letterSpacing: '0.04em',
        }}
      >
        DISMISS
      </button>
    </div>
  )
}
