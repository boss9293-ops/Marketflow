/**
 * WO56 — Action Guide Map
 *
 * Behavioral guidance per VR tone. Non-trading, non-directive.
 * Structure: [Mindset] + [Risk Focus] + [Behavior Constraint]
 */
import type { VrTone } from './vrTone'
import type { AlignmentLevel, ConfidenceLevel } from './trustDeriver'

export interface ActionGuide {
  message:  string    // Core message (1 sentence)
  bullets:  string[]  // Max 3 supporting points
  posture:  string    // Label shown in tag
  tone:     VrTone
}

/** Base guides by VR tone (posture-driven). */
export const ACTION_GUIDE_MAP: Record<VrTone, ActionGuide> = {
  defensive: {
    tone:    'defensive',
    posture: 'Defensive',
    message: 'Maintain a defensive mindset while downside instability remains elevated.',
    bullets: [
      'Emphasize capital preservation over participation.',
      'Avoid reactive decisions during volatile conditions.',
      'Wait for improved signal alignment before reconsidering.',
    ],
  },
  cautious: {
    tone:    'cautious',
    posture: 'Cautious',
    message: 'Maintain a cautious approach while signals remain mixed.',
    bullets: [
      'Monitor for clearer signal direction before acting.',
      'Focus on understanding current conditions rather than anticipating outcomes.',
      'Avoid expanding risk while clarity remains limited.',
    ],
  },
  stable: {
    tone:    'stable',
    posture: 'Stable',
    message: 'Conditions are stable and within normal operating parameters.',
    bullets: [
      'Maintain current risk awareness.',
      'Continue monitoring for early signs of regime change.',
      'No additional caution is warranted at this time.',
    ],
  },
  transitional: {
    tone:    'transitional',
    posture: 'Transitional',
    message: 'Conditions are shifting and regime direction requires confirmation.',
    bullets: [
      'Wait for signal alignment before adjusting approach.',
      'Monitor for confirmation that a regime change is underway.',
      'Remain aware that volatility is elevated during transitions.',
    ],
  },
}

/** Fallback guide when no VR state is available. */
export const FALLBACK_GUIDE: ActionGuide = {
  tone:    'cautious',
  posture: 'Evaluating',
  message: 'Maintain a balanced approach while the system evaluates current conditions.',
  bullets: [
    'Continue monitoring for directional signal clarity.',
    'Avoid forming strong conclusions while the assessment is incomplete.',
  ],
}

/**
 * Returns a guide refined by trust axes.
 * Adds a bullet when alignment is conflicting or confidence is low.
 */
export function refineGuide(
  base:        ActionGuide,
  alignment:   AlignmentLevel,
  confidence:  ConfidenceLevel,
): ActionGuide {
  const extraBullets: string[] = []

  if (alignment === 'Conflicting') {
    extraBullets.push('Signals are conflicting — wait for resolution before drawing conclusions.')
  }
  if (confidence === 'Low') {
    extraBullets.push('Signal confidence is low. Treat current assessments as preliminary.')
  }

  if (extraBullets.length === 0) return base

  // Merge, keeping total ≤ 3 bullets (extra bullets take priority)
  const merged = [...extraBullets, ...base.bullets].slice(0, 3)
  return { ...base, bullets: merged }
}
