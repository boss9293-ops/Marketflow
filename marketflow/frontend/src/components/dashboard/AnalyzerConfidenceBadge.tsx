import type { ConfidenceLevel, EvidenceStrength, SignalAgreement } from '../../types/analyzerReliability'

// =============================================================================
// AnalyzerConfidenceBadge  (WO-SA18)
// Single chip: HIGH / MEDIUM / LOW for confidence, evidence, or agreement
// =============================================================================

type ChipVariant = 'confidence' | 'evidence' | 'agreement'

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string>  = { HIGH: 'High',     MEDIUM: 'Medium',   LOW: 'Low' }
const EVIDENCE_LABEL:   Record<EvidenceStrength, string> = { STRONG: 'Strong',  MODERATE: 'Moderate', WEAK: 'Weak' }
const AGREEMENT_LABEL:  Record<SignalAgreement, string>  = { ALIGNED: 'Aligned', MIXED: 'Mixed',  CONFLICTED: 'Conflicted' }

type ChipTone = 'positive' | 'amber' | 'muted-red' | 'neutral'

function confidenceTone(v: ConfidenceLevel): ChipTone {
  return v === 'HIGH' ? 'positive' : v === 'MEDIUM' ? 'amber' : 'muted-red'
}
function evidenceTone(v: EvidenceStrength): ChipTone {
  return v === 'STRONG' ? 'positive' : v === 'MODERATE' ? 'amber' : 'muted-red'
}
function agreementTone(v: SignalAgreement): ChipTone {
  return v === 'ALIGNED' ? 'positive' : v === 'MIXED' ? 'amber' : 'muted-red'
}

const TONE_STYLE: Record<ChipTone, { color: string; bg: string; border: string }> = {
  positive:  { color: '#4ADE80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.20)' },
  amber:     { color: '#FBBF24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.20)' },
  'muted-red':{ color: '#F87171', bg: 'rgba(248,113,113,0.08)',border: 'rgba(248,113,113,0.20)' },
  neutral:   { color: '#9CA3AF', bg: 'rgba(156,163,175,0.07)', border: 'rgba(156,163,175,0.18)' },
}

interface Props {
  variant: ChipVariant
  value:   ConfidenceLevel | EvidenceStrength | SignalAgreement
  showLabel?: boolean
}

export default function AnalyzerConfidenceBadge({ variant, value, showLabel = true }: Props) {
  let label: string
  let tone: ChipTone

  if (variant === 'confidence') {
    label = CONFIDENCE_LABEL[value as ConfidenceLevel]
    tone  = confidenceTone(value as ConfidenceLevel)
  } else if (variant === 'evidence') {
    label = EVIDENCE_LABEL[value as EvidenceStrength]
    tone  = evidenceTone(value as EvidenceStrength)
  } else {
    label = AGREEMENT_LABEL[value as SignalAgreement]
    tone  = agreementTone(value as SignalAgreement)
  }

  const s = TONE_STYLE[tone]
  const prefix = variant === 'confidence' ? 'Confidence' : variant === 'evidence' ? 'Evidence' : 'Signals'

  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          4,
      background:   s.bg,
      border:       `1px solid ${s.border}`,
      borderRadius: 5,
      padding:      '2px 7px',
      whiteSpace:   'nowrap',
    }}>
      {showLabel && (
        <span style={{ color: '#4B5563', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em' }}>
          {prefix.toUpperCase()}
        </span>
      )}
      <span style={{ color: s.color, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.04em' }}>
        {label.toUpperCase()}
      </span>
    </span>
  )
}
