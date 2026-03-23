import type { AnalyzerReliabilityPayload } from '../../types/analyzerReliability'
import AnalyzerConfidenceBadge from './AnalyzerConfidenceBadge'

// =============================================================================
// AnalyzerReliabilityStrip  (WO-SA18)
// Compact horizontal strip: Confidence + Evidence + Agreement + flags
// =============================================================================

interface Props {
  payload?: AnalyzerReliabilityPayload | null
}

export default function AnalyzerReliabilityStrip({ payload }: Props) {
  if (!payload) return null

  return (
    <div style={{
      display:      'flex',
      alignItems:   'center',
      gap:          6,
      flexWrap:     'wrap',
    }}>
      <AnalyzerConfidenceBadge variant="confidence" value={payload.confidence_level} />
      <AnalyzerConfidenceBadge variant="evidence"   value={payload.evidence_strength} />
      <AnalyzerConfidenceBadge variant="agreement"  value={payload.signal_agreement} />

      {payload.instability_flag && (
        <span style={{
          display:      'inline-flex', alignItems: 'center',
          background:   'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)',
          borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap',
          color: '#FBBF24', fontSize: '0.60rem', fontWeight: 700, letterSpacing: '0.04em',
        }}>⚠ UNSTABLE</span>
      )}
      {payload.noise_flag && (
        <span style={{
          display:      'inline-flex', alignItems: 'center',
          background:   'rgba(156,163,175,0.07)', border: '1px solid rgba(156,163,175,0.18)',
          borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap',
          color: '#9CA3AF', fontSize: '0.60rem', fontWeight: 700, letterSpacing: '0.04em',
        }}>NOISY</span>
      )}
      {payload.freshness_label && (
        <span style={{ color: '#374151', fontSize: '0.60rem', marginLeft: 2 }}>
          {payload.freshness_label}
        </span>
      )}
    </div>
  )
}
