import type { InvestorActionViewPayload, InvestorActionPosture } from '../../types/investorAction'
import type { AnalyzerReliabilityPayload } from '../../types/analyzerReliability'
import InvestorActionBadgeRow from './InvestorActionBadgeRow'
import SectionIntro from '../common/SectionIntro'
import EmptyStateCard from '../common/EmptyStateCard'
import { SECTION_INTRO, EMPTY_STATE } from '../../lib/uxCopy'

// =============================================================================
// InvestorActionConsole  (WO-SA17)
//
// Translates Smart Analyzer regime + VR runtime constraints into
// a clear investor-facing action posture frame.
//
// NOT a trade signal. Posture interpretation only.
// =============================================================================

type BulletTone = 'constraint' | 'support' | 'caution' | 'neutral'

const BULLET_COLOR: Record<BulletTone, string> = {
  constraint: '#EF4444',
  support:    '#22C55E',
  caution:    '#F59E0B',
  neutral:    '#6B7280',
}

function BulletList({ items, tone }: { items: string[]; tone: BulletTone }) {
  if (!items || items.length === 0) return null
  const color = BULLET_COLOR[tone]
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ color, fontSize: '0.62rem', flexShrink: 0, marginTop: 3 }}>•</span>
          <span style={{ color: '#94A3B8', fontSize: '0.70rem', lineHeight: 1.45 }}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function SectionLabel({ text }: { text: string }) {
  return (
    <span style={{ color: '#4B5563', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.07em' }}>
      {text}
    </span>
  )
}

const ACCENT_COLOR: Record<InvestorActionPosture, string> = {
  NORMAL_PARTICIPATION:    '#9CA3AF',
  LIMITED_ENTRY:           '#F59E0B',
  DEFENSIVE_POSTURE:       '#F97316',
  RISK_REDUCTION_PRIORITY: '#EF4444',
  OBSERVE_AND_WAIT:        '#94A3B8',
}

interface Props {
  payload?:     InvestorActionViewPayload | null
  reliability?: AnalyzerReliabilityPayload | null
}

export default function InvestorActionConsole({ payload, reliability }: Props) {
  if (!payload) {
    return (
      <div style={cardStyle}>
        <Header accentColor="#4B5563" />
        <SectionIntro text={SECTION_INTRO.INVESTOR_ACTION} />
        <EmptyStateCard title={EMPTY_STATE.INVESTOR_ACTION.title} />
      </div>
    )
  }

  const accentColor = ACCENT_COLOR[payload.action_posture] ?? '#6B7280'
  const hasConstraints = payload.constraints.length > 0
  const hasSupports    = (payload.supports ?? []).length > 0
  const hasCautions    = (payload.cautions ?? []).length > 0

  return (
    <div style={cardStyle}>
      <Header accentColor={accentColor} />
      <SectionIntro text={SECTION_INTRO.INVESTOR_ACTION} />

      {/* ── Posture badge + title ── */}
      <div style={{
        background:   'rgba(255,255,255,0.02)',
        border:       '1px solid rgba(255,255,255,0.05)',
        borderRadius: 10,
        padding:      '10px 12px',
        display:      'flex',
        flexDirection: 'column',
        gap:          6,
        borderLeft:   `3px solid ${accentColor}`,
      }}>
        <InvestorActionBadgeRow posture={payload.action_posture} />
        <p style={{ margin: 0, color: '#F1F5F9', fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.35 }}>
          {payload.title}
        </p>
        <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.72rem', lineHeight: 1.5 }}>
          {payload.summary}
        </p>
      </div>

      {/* ── 3-column constraint / support / caution grid ── */}
      {(hasConstraints || hasSupports || hasCautions) && (
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap:                 '0.6rem',
        }}>
          {hasConstraints && (
            <div style={sectionCard}>
              <SectionLabel text="CONSTRAINTS" />
              <BulletList items={payload.constraints} tone="constraint" />
            </div>
          )}
          {hasSupports && (
            <div style={sectionCard}>
              <SectionLabel text="SUPPORTS" />
              <BulletList items={payload.supports!} tone="support" />
            </div>
          )}
          {hasCautions && (
            <div style={sectionCard}>
              <SectionLabel text="CAUTIONS" />
              <BulletList items={payload.cautions!} tone="caution" />
            </div>
          )}
        </div>
      )}

      {/* ── Cross-panel link + reliability note (SA16/SA17/SA18) ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {reliability && (
          <span style={{ color: '#4B5563', fontSize: '0.62rem' }}>
            {reliability.confidence_level === 'HIGH' && reliability.signal_agreement === 'ALIGNED'
              ? 'Posture is based on well-aligned, high-confidence evidence.'
              : reliability.confidence_level === 'LOW' || reliability.signal_agreement === 'CONFLICTED'
              ? 'Confidence is reduced by signal conflict — interpret posture conservatively.'
              : 'This posture is based on mixed but still actionable evidence.'}
          </span>
        )}
        <span style={{ color: '#374151', fontSize: '0.60rem' }}>
          Derived from current analyzer regime and VR policy.
        </span>
      </div>
    </div>
  )
}

function Header({ accentColor }: { accentColor: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 4, height: 20, borderRadius: 4, background: accentColor, flexShrink: 0 }} />
      <span style={{ color: '#F8FAFC', fontSize: '0.80rem', fontWeight: 800, letterSpacing: '0.04em' }}>
        Investor Action Console
      </span>
      <span style={{ color: '#6B7280', fontSize: '0.70rem', fontWeight: 600 }}>· Posture interpretation</span>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background:    '#070B10',
  border:        '1px solid rgba(148,163,184,0.09)',
  borderRadius:  16,
  padding:       '0.85rem',
  display:       'flex',
  flexDirection: 'column',
  gap:           '0.7rem',
}

const sectionCard: React.CSSProperties = {
  background:    '#11161C',
  border:        '1px solid rgba(255,255,255,0.06)',
  borderRadius:  9,
  padding:       '8px 10px',
  display:       'flex',
  flexDirection: 'column',
  gap:           5,
}
