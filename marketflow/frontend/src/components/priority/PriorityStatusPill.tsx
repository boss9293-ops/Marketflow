import type { CSSProperties } from 'react'
import type { PriorityLevel } from '@/types/priority'

const CFG: Record<PriorityLevel, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'Critical', color: '#f87171', bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.3)' },
  high:     { label: 'High',     color: '#fca5a5', bg: 'rgba(252,165,165,0.08)', border: 'rgba(252,165,165,0.25)' },
  medium:   { label: 'Medium',   color: '#fcd34d', bg: 'rgba(252,211,77,0.08)',  border: 'rgba(252,211,77,0.22)'  },
  low:      { label: 'Low',      color: '#5eead4', bg: 'rgba(94,234,212,0.07)',  border: 'rgba(94,234,212,0.2)'   },
}

export default function PriorityStatusPill({ level }: { level: PriorityLevel }) {
  const c = CFG[level]
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em',
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
      padding: '1px 7px', borderRadius: 99,
    } as CSSProperties}>
      {c.label}
    </span>
  )
}
