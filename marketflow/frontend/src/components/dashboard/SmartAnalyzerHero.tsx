import {
  formatSmartAnalyzerView,
  type SmartAnalyzerViewPayload,
  type SADisplayTone,
} from '../../lib/formatSmartAnalyzer'
import SmartAnalyzerMetricStrip from './SmartAnalyzerMetricStrip'
import SmartAnalyzerDriverList from './SmartAnalyzerDriverList'
import SmartAnalyzerScenarioCard from './SmartAnalyzerScenarioCard'
import AnalyzerReliabilityStrip from './AnalyzerReliabilityStrip'
import AnalyzerEvidenceList from './AnalyzerEvidenceList'
import type { AnalyzerReliabilityPayload } from '../../types/analyzerReliability'
import SectionIntro from '../common/SectionIntro'
import EmptyStateCard from '../common/EmptyStateCard'
import InfoTooltip from '../common/InfoTooltip'
import { SECTION_INTRO, MICRO_GUIDE } from '../../lib/uxCopy'

// SmartAnalyzerHero  (WO-SA14)

const TONE_STYLE: Record<SADisplayTone, { color: string; bg: string; border: string }> = {
  red:     { color: '#EF4444', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.25)' },
  orange:  { color: '#F97316', bg: 'rgba(249,115,22,0.10)',  border: 'rgba(249,115,22,0.25)' },
  amber:   { color: '#F59E0B', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)' },
  green:   { color: '#22C55E', bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.25)' },
  purple:  { color: '#8B5CF6', bg: 'rgba(139,92,246,0.10)',  border: 'rgba(139,92,246,0.25)' },
  neutral: { color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)', border: 'rgba(156,163,175,0.18)' },
}

function ToneBadge({ label, tone }: { label: string; tone: SADisplayTone }) {
  const s = TONE_STYLE[tone] ?? TONE_STYLE.neutral
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: 5, fontSize: '0.65rem', fontWeight: 800,
      letterSpacing: '0.04em', padding: '2px 7px', whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

interface Props {
  payload?:     SmartAnalyzerViewPayload | null
  reliability?: AnalyzerReliabilityPayload | null
}

export default function SmartAnalyzerHero({ payload, reliability }: Props) {
  const fmt = formatSmartAnalyzerView(payload)
  const accentColor =
    fmt.regime_tone === 'red'    ? '#EF4444'
    : fmt.regime_tone === 'orange' ? '#F97316'
    : fmt.regime_tone === 'amber'  ? '#F59E0B'
    : '#C4FF0D'

  return (
    <section style={{
      background: '#070B10', border: '1px solid rgba(148,163,184,0.09)',
      borderRadius: 16, padding: '0.85rem',
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 4, height: 22, borderRadius: 4, background: accentColor, flexShrink: 0 }} />
          <span style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.04em' }}>Market Intelligence</span>
          <span style={{ color: '#6B7280', fontSize: '0.72rem', fontWeight: 600 }}>· Smart Analyzer</span>
        </div>
        {fmt.updated_label && (
          <span style={{ color: '#374151', fontSize: '0.62rem' }}>as of {fmt.updated_label}</span>
        )}
      </div>
      <SectionIntro text={SECTION_INTRO.SMART_ANALYZER} />

      <div style={{
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
        borderLeft: `3px solid ${accentColor}`,
      }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ToneBadge label={fmt.regime_label} tone={fmt.regime_tone} />
          {fmt.runtime_label !== '—' && <ToneBadge label={fmt.runtime_label} tone={fmt.runtime_tone} />}
        </div>
        <p style={{ margin: 0, color: '#F1F5F9', fontSize: '0.88rem', fontWeight: 700, lineHeight: 1.4 }}>{fmt.headline}</p>
        {fmt.summary && (
          <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.75rem', lineHeight: 1.55 }}>{fmt.summary}</p>
        )}
        {/* VR posture context (SA16) */}
        {fmt.runtime_label !== '—' && (
          <p style={{ margin: 0, color: '#4B5563', fontSize: '0.65rem', lineHeight: 1.4 }}>
            VR posture is currently {fmt.runtime_label.toLowerCase()} due to {fmt.regime_label.toLowerCase()}.
          </p>
        )}
      </div>

      <SmartAnalyzerMetricStrip items={fmt.metric_items} />

      {/* ── Reliability strip (SA18) ── */}
      {reliability && <AnalyzerReliabilityStrip payload={reliability} />}
      {reliability?.reasons && reliability.reasons.length > 0 && (
        <AnalyzerEvidenceList reasons={reliability.reasons} compact />
      )}

      {(fmt.driver_lines.length > 0 || fmt.has_scenario || fmt.has_policy) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
          {fmt.driver_lines.length > 0 && (
            <SmartAnalyzerDriverList lines={fmt.driver_lines} impacts={fmt.driver_impacts} />
          )}
          {(fmt.has_scenario || fmt.has_policy) && (
            <SmartAnalyzerScenarioCard items={fmt.scenario_items} vrLinkLines={fmt.vr_link_lines} />
          )}
        </div>
      )}

      {/* Micro-guide for first-time users (SA19) */}
      {!payload && <EmptyStateCard title="Smart Analyzer data is currently unavailable." detail="Please check back after the next data refresh." />}
      {payload && (
        <p style={{ margin: 0, color: '#374151', fontSize: '0.60rem', lineHeight: 1.4 }}>{MICRO_GUIDE}</p>
      )}
    </section>
  )
}
