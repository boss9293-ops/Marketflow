// =============================================================================
// types/analyzerReliability.ts  (WO-SA18)
// Reliability / Confidence layer for Smart Analyzer output
// =============================================================================

export type ConfidenceLevel   = 'HIGH' | 'MEDIUM' | 'LOW'
export type EvidenceStrength  = 'STRONG' | 'MODERATE' | 'WEAK'
export type SignalAgreement   = 'ALIGNED' | 'MIXED' | 'CONFLICTED'

export interface AnalyzerReliabilityPayload {
  confidence_level:  ConfidenceLevel
  evidence_strength: EvidenceStrength
  signal_agreement:  SignalAgreement

  instability_flag?: boolean   // regime state changed frequently
  noise_flag?:       boolean   // short-term shock without sustained posture

  confidence_score?: number    // 0-100 optional internal use
  freshness_label?:  string    // e.g. "Updated 12m ago"

  reasons?: string[]           // up to 3 bullet explanations
}
