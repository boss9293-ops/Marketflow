import type { VrAuditBadgeTone } from '../../lib/formatVrAudit'

// =============================================================================
// VrExecutionBadge  (WO-SA12)
// Small reusable status badge — calm institutional style
// =============================================================================

const TONE_STYLE: Record<VrAuditBadgeTone, { bg: string; color: string; border: string }> = {
  positive: { bg: 'rgba(34,197,94,0.10)',  color: '#22C55E', border: 'rgba(34,197,94,0.25)' },
  amber:    { bg: 'rgba(245,158,11,0.10)', color: '#F59E0B', border: 'rgba(245,158,11,0.25)' },
  red:      { bg: 'rgba(239,68,68,0.10)',  color: '#EF4444', border: 'rgba(239,68,68,0.25)' },
  purple:   { bg: 'rgba(139,92,246,0.10)', color: '#8B5CF6', border: 'rgba(139,92,246,0.25)' },
  gray:     { bg: 'rgba(156,163,175,0.08)', color: '#9CA3AF', border: 'rgba(156,163,175,0.20)' },
}

interface Props {
  label:   string;
  tone:    VrAuditBadgeTone;
  size?:   'sm' | 'md';
}

export default function VrExecutionBadge({ label, tone, size = 'sm' }: Props) {
  const s = TONE_STYLE[tone] ?? TONE_STYLE.gray
  const fontSize = size === 'md' ? '0.72rem' : '0.64rem'
  const px       = size === 'md' ? '8px'     : '6px'
  const py       = size === 'md' ? '3px'     : '2px'

  return (
    <span
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        background:   s.bg,
        color:        s.color,
        border:       `1px solid ${s.border}`,
        borderRadius: 4,
        fontSize,
        fontWeight:   700,
        letterSpacing: '0.04em',
        padding:      `${py} ${px}`,
        whiteSpace:   'nowrap',
      }}
    >
      {label}
    </span>
  )
}
