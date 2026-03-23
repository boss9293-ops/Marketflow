import type { VrAuditBadgeTone } from '../../lib/formatVrAudit'
import type { VrModeBadgeTone } from '../../lib/formatVrTimeline'

// =============================================================================
// VrTimelineBadge  (WO-SA13)
// Compact badge for timeline rows — mode + execution + action variants
// =============================================================================

const EXECUTION_TONE_STYLE: Record<VrAuditBadgeTone, { bg: string; color: string; border: string }> = {
  positive: { bg: 'rgba(34,197,94,0.12)',  color: '#22C55E', border: 'rgba(34,197,94,0.25)' },
  amber:    { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: 'rgba(245,158,11,0.25)' },
  red:      { bg: 'rgba(239,68,68,0.12)',  color: '#EF4444', border: 'rgba(239,68,68,0.25)' },
  purple:   { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6', border: 'rgba(139,92,246,0.25)' },
  gray:     { bg: 'rgba(156,163,175,0.08)', color: '#9CA3AF', border: 'rgba(156,163,175,0.18)' },
}

const MODE_TONE_STYLE: Record<VrModeBadgeTone, { bg: string; color: string; border: string }> = {
  red:    { bg: 'rgba(239,68,68,0.12)',   color: '#EF4444', border: 'rgba(239,68,68,0.25)' },
  orange: { bg: 'rgba(249,115,22,0.12)',  color: '#F97316', border: 'rgba(249,115,22,0.25)' },
  amber:  { bg: 'rgba(245,158,11,0.12)',  color: '#F59E0B', border: 'rgba(245,158,11,0.25)' },
  gray:   { bg: 'rgba(156,163,175,0.08)', color: '#9CA3AF', border: 'rgba(156,163,175,0.18)' },
}

const BASE_STYLE: React.CSSProperties = {
  display:       'inline-flex',
  alignItems:    'center',
  borderRadius:  4,
  fontSize:      '0.60rem',
  fontWeight:    700,
  letterSpacing: '0.04em',
  padding:       '1px 5px',
  whiteSpace:    'nowrap',
}

export function VrExecutionTimelineBadge({ label, tone }: { label: string; tone: VrAuditBadgeTone }) {
  const s = EXECUTION_TONE_STYLE[tone] ?? EXECUTION_TONE_STYLE.gray
  return (
    <span style={{ ...BASE_STYLE, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {label}
    </span>
  )
}

export function VrModeTimelineBadge({ label, tone }: { label: string; tone: VrModeBadgeTone }) {
  const s = MODE_TONE_STYLE[tone] ?? MODE_TONE_STYLE.gray
  return (
    <span style={{ ...BASE_STYLE, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {label}
    </span>
  )
}

export function VrActionTimelineBadge({ label }: { label: string }) {
  return (
    <span style={{
      ...BASE_STYLE,
      background:   'rgba(99,102,241,0.10)',
      color:        '#A5B4FC',
      border:       '1px solid rgba(99,102,241,0.20)',
    }}>
      {label}
    </span>
  )
}

export function VrTransitionMarker() {
  return (
    <span
      title="Mode transition"
      style={{
        display:     'inline-flex',
        alignItems:  'center',
        justifyContent: 'center',
        width:       14,
        height:      14,
        borderRadius: '50%',
        background:  'rgba(251,191,36,0.20)',
        color:       '#FBBF24',
        fontSize:    '0.55rem',
        fontWeight:  900,
        flexShrink:  0,
        border:      '1px solid rgba(251,191,36,0.35)',
      }}
    >
      ▲
    </span>
  )
}

export function VrShockMarker({ type }: { type: 'shock' | 'structural' }) {
  return (
    <span
      title={type === 'shock' ? 'Shock flag active' : 'Structural pressure'}
      style={{
        display:     'inline-flex',
        alignItems:  'center',
        justifyContent: 'center',
        borderRadius: 3,
        background:  type === 'shock' ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)',
        color:       type === 'shock' ? '#F87171' : '#C4B5FD',
        fontSize:    '0.55rem',
        fontWeight:  700,
        padding:     '1px 4px',
        border:      `1px solid ${type === 'shock' ? 'rgba(239,68,68,0.25)' : 'rgba(139,92,246,0.25)'}`,
        whiteSpace:  'nowrap',
        flexShrink:  0,
      }}
    >
      {type === 'shock' ? '⚡ SHOCK' : '⬛ STRUCT'}
    </span>
  )
}
