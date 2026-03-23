import type { CSSProperties } from 'react'
import type { ScenarioFitLevel } from '@/types/scenarioMapping'

const FIT_CONFIG: Record<ScenarioFitLevel, { label: string; bg: string; color: string }> = {
  support:  { label: 'Support',  bg: 'rgba(34,197,94,0.12)',  color: '#86efac' },
  mixed:    { label: 'Mixed',    bg: 'rgba(251,191,36,0.12)', color: '#fde68a' },
  weak:     { label: 'Weak',     bg: 'rgba(148,163,184,0.08)',color: '#94a3b8' },
  conflict: { label: 'Conflict', bg: 'rgba(239,68,68,0.12)',  color: '#fca5a5' },
}

export default function ScenarioFitBadge({ fit }: { fit: ScenarioFitLevel }) {
  const cfg = FIT_CONFIG[fit]
  const style: CSSProperties = {
    display:        'inline-block',
    padding:        '0.18rem 0.6rem',
    borderRadius:   6,
    fontSize:       '0.71rem',
    fontWeight:     700,
    letterSpacing:  '0.06em',
    textTransform:  'uppercase',
    background:     cfg.bg,
    color:          cfg.color,
    whiteSpace:     'nowrap',
    flexShrink:     0,
  }
  return <span style={style}>{cfg.label}</span>
}
