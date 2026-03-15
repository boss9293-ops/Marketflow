import type { PatternDetectionResult } from '../../engine/pattern_detector'
import type { PriorityEventVRAnalysis, PriorityEventVRTag, PriorityVRSupportStatus } from '../types/priority_event_vr_tag'
import { attachPriorityEventVRTag, type AttachedVREventTag } from './attach_vr_event_tags'
import { validatePriorityEventTags } from './load_priority_event_tags'

export type VRSupportStatus = PriorityVRSupportStatus
export type VREventAnalysis = PriorityEventVRAnalysis
export type TaggedVREvent = PriorityEventVRTag

export { validatePriorityEventTags }

export function resolveVREventInterpretation(input: {
  rootDir: string
  eventName: string
  supportStatus: VRSupportStatus
  syntheticProxy?: boolean
  patternMatches: PatternDetectionResult
  ma200Status: string
  tqqqDrawdownPct: number | null
  reboundStrengthPct: number | null
}): TaggedVREvent & { source?: AttachedVREventTag['source'] } {
  const attached = attachPriorityEventVRTag({
    rootDir: input.rootDir,
    eventId: input.eventName.slice(0, 7),
    supportStatus: input.supportStatus,
    syntheticProxy: input.syntheticProxy,
    patternMatches: input.patternMatches,
    ma200Status: input.ma200Status,
    tqqqDrawdownPct: input.tqqqDrawdownPct,
    reboundStrengthPct: input.reboundStrengthPct,
  })

  return {
    ...attached.tag,
    source: attached.source,
  }
}
