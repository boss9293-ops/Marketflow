/**
 * WO54 — Trust Deriver
 *
 * Derives Confidence / Alignment / Clarity from existing signals.
 * No new analytics — reads scenario mappings + monitored topics.
 */
import type { MonitoredTopic }  from '@/types/researchMonitor'
import type { ScenarioMapping } from '@/types/scenarioMapping'

export type ConfidenceLevel = 'High'   | 'Medium' | 'Low'
export type AlignmentLevel  = 'Strong' | 'Mixed'  | 'Conflicting'
export type ClarityLevel    = 'Clear'  | 'Transitional' | 'Unstable'

export interface VRTrustData {
  confidence: ConfidenceLevel
  alignment:  AlignmentLevel
  clarity:    ClarityLevel
  has_data:   boolean
}

export const EMPTY_TRUST: VRTrustData = {
  confidence: 'Low',
  alignment:  'Mixed',
  clarity:    'Transitional',
  has_data:   false,
}

/**
 * Derives trust axes from existing scenario mapping + monitor data.
 * Inputs come entirely from localStorage — no new computation.
 */
export function deriveTrustData(
  topics:   MonitoredTopic[],
  mappings: ScenarioMapping[],
): VRTrustData {
  if (topics.length === 0 && mappings.length === 0) return EMPTY_TRUST

  const activeMappings = mappings.filter(m => m.topic_count > 0)
  const supportCount   = mappings.filter(m => m.fit === 'support').length
  const conflictCount  = mappings.filter(m => m.fit === 'conflict').length
  const mixedCount     = mappings.filter(m => m.fit === 'mixed').length
  const maxScore       = activeMappings.length > 0
    ? Math.max(...activeMappings.map(m => m.fit_score))
    : 0

  // ── Confidence: how strong and consistent are the signals ─────────────────
  let confidence: ConfidenceLevel
  if (activeMappings.length === 0) {
    confidence = 'Low'
  } else if (supportCount >= 2 && maxScore >= 60) {
    confidence = 'High'
  } else if (supportCount >= 1 || maxScore >= 30) {
    confidence = 'Medium'
  } else {
    confidence = 'Low'
  }

  // ── Alignment: are signals pointing the same direction ────────────────────
  let alignment: AlignmentLevel
  if (conflictCount > supportCount && conflictCount >= 2) {
    alignment = 'Conflicting'
  } else if (conflictCount >= 1 || mixedCount > supportCount) {
    alignment = 'Mixed'
  } else if (supportCount >= 1 && conflictCount === 0) {
    alignment = 'Strong'
  } else {
    alignment = 'Mixed'
  }

  // ── Clarity: how legible is the current regime ────────────────────────────
  const warningCount = topics.filter(t => t.status === 'warning').length
  const changedCount = topics.filter(t => t.status === 'changed').length

  let clarity: ClarityLevel
  if (warningCount >= 2 || conflictCount >= 2) {
    clarity = 'Unstable'
  } else if (warningCount >= 1 || changedCount >= 2 || mixedCount > supportCount) {
    clarity = 'Transitional'
  } else if (supportCount >= 1 && conflictCount === 0) {
    clarity = 'Clear'
  } else {
    clarity = 'Transitional'
  }

  return { confidence, alignment, clarity, has_data: true }
}
