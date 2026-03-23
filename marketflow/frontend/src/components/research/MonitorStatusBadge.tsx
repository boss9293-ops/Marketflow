import type { CSSProperties } from 'react'
import type { MonitorStatus } from '@/types/researchMonitor'

const CONFIG: Record<MonitorStatus, { label: string; color: string; bg: string; border: string }> = {
  watching: { label: 'Watching',      color: '#5eead4', bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.25)'  },
  updated:  { label: 'Updated',       color: '#93c5fd', bg: 'rgba(147,197,253,0.08)', border: 'rgba(147,197,253,0.25)' },
  changed:  { label: 'Changed',       color: '#fcd34d', bg: 'rgba(252,211,77,0.08)',  border: 'rgba(252,211,77,0.25)'  },
  warning:  { label: '\u26a0 Warning', color: '#fca5a5', bg: 'rgba(252,165,165,0.1)', border: 'rgba(252,165,165,0.3)' },
}

export default function MonitorStatusBadge({ status }: { status: MonitorStatus }) {
  const c = CONFIG[status]
  return (
    <span style={{
      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.07em',
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
      padding: '2px 8px', borderRadius: 99,
    } as CSSProperties}>
      {c.label}
    </span>
  )
}
