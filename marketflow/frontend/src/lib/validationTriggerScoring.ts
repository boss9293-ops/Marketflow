import type { ValidationTrigger } from '@/types/validationTrigger'

export function scoreValidationTrigger(trigger: ValidationTrigger): number {
  let score = 0
  if      (trigger.level === 'critical') score += 100
  else if (trigger.level === 'elevated') score += 70
  else if (trigger.level === 'review')   score += 40
  else                                   score += 15

  if (trigger.crash_trigger)                                       score += 15
  if (trigger.linked_vr_state === 'ARMED')                         score += 10
  if (trigger.linked_vr_state === 'REENTRY')                       score +=  8
  if (trigger.risk_level === 'High' || trigger.risk_level === 'Critical') score += 10
  if ((trigger.reasons?.length ?? 0) >= 3)                         score +=  5

  return score
}

export function sortValidationTriggers(
  triggers: ValidationTrigger[],
): ValidationTrigger[] {
  return [...triggers]
    .map(t => ({ ...t, score: scoreValidationTrigger(t) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}
