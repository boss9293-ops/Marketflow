import type { VrTimelineFormattedRow } from '../../lib/formatVrTimeline'
import {
  VrExecutionTimelineBadge,
  VrModeTimelineBadge,
  VrActionTimelineBadge,
  VrTransitionMarker,
  VrShockMarker,
} from './VrTimelineBadge'

// =============================================================================
// VrTimelineRow  (WO-SA13)
// Single timeline row — compact tabular design
// =============================================================================

interface Props {
  row:        VrTimelineFormattedRow;
  showReason?: boolean;
}

export default function VrTimelineRow({ row, showReason = false }: Props) {
  const isHighlighted = row.is_transition

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        gap:           4,
        padding:       '7px 10px',
        borderRadius:  8,
        background:    isHighlighted
          ? 'rgba(251,191,36,0.04)'
          : 'rgba(255,255,255,0.015)',
        border:        isHighlighted
          ? '1px solid rgba(251,191,36,0.18)'
          : '1px solid rgba(255,255,255,0.05)',
        position:      'relative',
      }}
    >
      {/* ── Transition accent line ── */}
      {isHighlighted && (
        <div style={{
          position:    'absolute',
          left:        0,
          top:         0,
          bottom:      0,
          width:       3,
          borderRadius: '4px 0 0 4px',
          background:  '#FBBF24',
        }} />
      )}

      {/* ── Main row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Date + price */}
        <span style={{ color: '#64748B', fontSize: '0.65rem', fontWeight: 600, minWidth: 72 }}>
          {row.date_label}
        </span>
        {row.price_label !== '—' && (
          <span style={{ color: '#94A3B8', fontSize: '0.63rem' }}>{row.price_label}</span>
        )}

        {/* Divider */}
        <span style={{ color: 'rgba(255,255,255,0.10)', fontSize: '0.60rem' }}>|</span>

        {/* Transition marker */}
        {row.is_transition && <VrTransitionMarker />}

        {/* Mode badge */}
        <VrModeTimelineBadge label={row.mode_label} tone={row.mode_tone} />

        {/* Action badge */}
        <VrActionTimelineBadge label={row.action_label} />

        {/* Decision badge */}
        <VrExecutionTimelineBadge label={row.result_text} tone={row.decision_tone} />

        {/* Qty display */}
        {row.decision_tone === 'amber' && (
          <span style={{ color: '#6B7280', fontSize: '0.62rem' }}>
            ({(row as any).raw_qty ?? '?'} → {(row as any).final_qty ?? '?'})
          </span>
        )}

        {/* Shock / structural markers */}
        {row.shock_flag      && <VrShockMarker type="shock" />}
        {row.structural_flag && <VrShockMarker type="structural" />}

        {/* Block streak badge */}
        {row.block_streak >= 2 && (
          <span style={{
            color:        '#F87171',
            fontSize:     '0.60rem',
            fontWeight:   700,
            background:   'rgba(239,68,68,0.08)',
            border:       '1px solid rgba(239,68,68,0.18)',
            borderRadius: 3,
            padding:      '1px 4px',
          }}>
            ×{row.block_streak} consecutive block
          </span>
        )}
      </div>

      {/* ── Reason lines (collapsible) ── */}
      {showReason && row.reason_lines.length > 0 && (
        <ul style={{ margin: 0, padding: 0, paddingLeft: 72, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {row.reason_lines.map((line, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
              <span style={{ color: '#374151', fontSize: '0.60rem', flexShrink: 0 }}>·</span>
              <span style={{ color: '#6B7280', fontSize: '0.63rem', lineHeight: 1.4 }}>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
