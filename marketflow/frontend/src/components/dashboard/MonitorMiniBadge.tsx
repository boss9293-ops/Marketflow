import type { CSSProperties } from 'react'
import type { MonitorStatus } from '@/types/researchMonitor'

const CFG: Record<MonitorStatus, { dot: string; label: string }> = {
  warning:  { dot: '#fca5a5', label: 'Warning'  },
  changed:  { dot: '#fcd34d', label: 'Changed'  },
  updated:  { dot: '#93c5fd', label: 'Updated'  },
  watching: { dot: '#5eead4', label: 'Watching' },
}

export default function MonitorMiniBadge({ status }: { status: MonitorStatus }) {
  const c = CFG[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 } as CSSProperties}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 } as CSSProperties} />
      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: c.dot, letterSpacing: '0.04em' }}>
        {c.label}
      </span>
    </span>
  )
}
