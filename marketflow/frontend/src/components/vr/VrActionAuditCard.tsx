import { formatVrAuditReason, type VrAuditViewPayload } from '../../lib/formatVrAudit'
import VrExecutionBadge from './VrExecutionBadge'
import VrPolicyReasonList from './VrPolicyReasonList'
import SectionIntro from '../common/SectionIntro'
import EmptyStateCard from '../common/EmptyStateCard'
import { SECTION_INTRO, EMPTY_STATE } from '../../lib/uxCopy'

// =============================================================================
// VrActionAuditCard  (WO-SA12)
//
// Displays one execution hook result: raw → policy → execution → why
// Props accept raw VrAuditViewPayload — formatter handles all labeling
// =============================================================================

interface Props {
  payload?: VrAuditViewPayload | null;
  compact?: boolean;
}

function Row({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <span style={{ color: '#6B7280', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.03em' }}>
        {label}
      </span>
      <span style={{ color: valueColor ?? '#D1D5DB', fontSize: '0.70rem', fontWeight: 700 }}>
        {value}
      </span>
    </div>
  )
}

export default function VrActionAuditCard({ payload, compact = false }: Props) {
  const fmt = formatVrAuditReason(payload)

  if (!payload) {
    return (
      <div style={cardStyle}>
        <Label />
        <SectionIntro text={SECTION_INTRO.VR_AUDIT} />
        <EmptyStateCard
          title={EMPTY_STATE.VR_AUDIT.title}
          compact
        />
      </div>
    )
  }

  const TONE_COLOR = {
    positive: '#22C55E',
    amber:    '#F59E0B',
    red:      '#EF4444',
    purple:   '#8B5CF6',
    gray:     '#9CA3AF',
  }
  const decisionColor = TONE_COLOR[fmt.badge_tone] ?? '#9CA3AF'

  return (
    <div style={cardStyle}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Label />
        <VrExecutionBadge label={fmt.badge_label} tone={fmt.badge_tone} size="md" />
      </div>
      <SectionIntro text={SECTION_INTRO.VR_AUDIT} />

      {/* ── Core rows ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
        <Row label="Raw Action"    value={fmt.action_label} />
        <Row label="Runtime Mode"  value={fmt.mode_label} />
        <Row label="Permission"    value={fmt.permission_label} />
        <Row label="Decision"      value={fmt.decision_label} valueColor={decisionColor} />

        {/* Qty rows — show only when data exists */}
        {fmt.qty_display && (
          <>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '2px 0' }} />
            <Row label="Raw Qty / Notional"   value={fmt.qty_display.raw} />
            <Row
              label="Final Qty / Notional"
              value={fmt.qty_display.final}
              valueColor={payload.blocked ? '#EF4444' : payload.limited ? '#F59E0B' : '#22C55E'}
            />
            {fmt.sizing_display && (
              <Row label="Sizing Cap" value={fmt.sizing_display} valueColor="#F59E0B" />
            )}
          </>
        )}
      </div>

      {/* ── Reason lines ── */}
      {!compact && fmt.reason_lines.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <VrPolicyReasonList lines={fmt.reason_lines} heading="DECISION TRACE" />
        </div>
      )}

      {/* ── Execution note ── */}
      {!compact && fmt.execution_text && (
        <div style={{
          marginTop: 6,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 6,
          padding: '5px 8px',
        }}>
          <span style={{ color: '#64748B', fontSize: '0.66rem' }}>{fmt.execution_text}</span>
        </div>
      )}

      {/* ── Cross-panel link (SA16) ── */}
      {!compact && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 5, marginTop: 2 }}>
          <span style={{ color: '#374151', fontSize: '0.62rem', lineHeight: 1.4 }}>
            This action reflects the current Smart Analyzer runtime mode and policy state.
          </span>
        </div>
      )}
    </div>
  )
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Label() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 3, height: 16, borderRadius: 3, background: '#6366F1', flexShrink: 0 }} />
      <span style={{ color: '#F8FAFC', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
        VR Execution Audit
      </span>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background:   '#11161C',
  border:       '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10,
  padding:      '10px 12px',
  display:      'flex',
  flexDirection: 'column',
  gap:          6,
}
