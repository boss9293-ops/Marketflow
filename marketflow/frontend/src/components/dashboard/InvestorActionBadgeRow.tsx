import type { InvestorActionPosture } from '../../types/investorAction'

// =============================================================================
// InvestorActionBadgeRow  (WO-SA17)
// Single posture badge with color coding
// =============================================================================

type BadgeTone = 'green' | 'amber' | 'orange' | 'red' | 'blue-gray' | 'neutral'

const POSTURE_CONFIG: Record<InvestorActionPosture, { label: string; tone: BadgeTone }> = {
  NORMAL_PARTICIPATION:    { label: 'Normal Participation', tone: 'neutral' },
  LIMITED_ENTRY:           { label: 'Limited Entry',        tone: 'amber' },
  DEFENSIVE_POSTURE:       { label: 'Defensive',            tone: 'orange' },
  RISK_REDUCTION_PRIORITY: { label: 'Risk Reduction',       tone: 'red' },
  OBSERVE_AND_WAIT:        { label: 'Observe & Wait',       tone: 'blue-gray' },
}

const TONE_COLOR: Record<BadgeTone, { bg: string; color: string; border: string }> = {
  neutral:    { bg: 'rgba(156,163,175,0.10)', color: '#9CA3AF', border: 'rgba(156,163,175,0.25)' },
  amber:      { bg: 'rgba(245,158,11,0.10)',  color: '#F59E0B', border: 'rgba(245,158,11,0.30)' },
  orange:     { bg: 'rgba(249,115,22,0.10)',  color: '#F97316', border: 'rgba(249,115,22,0.30)' },
  red:        { bg: 'rgba(239,68,68,0.10)',   color: '#EF4444', border: 'rgba(239,68,68,0.30)' },
  'blue-gray':{ bg: 'rgba(100,116,139,0.10)', color: '#94A3B8', border: 'rgba(100,116,139,0.25)' },
  green:      { bg: 'rgba(34,197,94,0.10)',   color: '#22C55E', border: 'rgba(34,197,94,0.30)' },
}

interface Props {
  posture: InvestorActionPosture
  size?: 'sm' | 'md'
}

export default function InvestorActionBadgeRow({ posture, size = 'md' }: Props) {
  const config = POSTURE_CONFIG[posture]
  const tone   = TONE_COLOR[config.tone]
  const fs     = size === 'sm' ? '0.60rem' : '0.66rem'
  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          5,
      background:   tone.bg,
      color:        tone.color,
      border:       `1px solid ${tone.border}`,
      borderRadius: 6,
      fontSize:     fs,
      fontWeight:   800,
      letterSpacing:'0.05em',
      padding:      size === 'sm' ? '1px 6px' : '3px 9px',
      whiteSpace:   'nowrap',
    }}>
      {config.label}
    </span>
  )
}
