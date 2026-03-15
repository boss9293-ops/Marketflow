import type { PatternDetectionResult } from '../../engine/pattern_detector'
import type { PriorityEventVRTag } from '../types/priority_event_vr_tag'
import { loadPriorityEventTags } from './load_priority_event_tags'

export type AttachedVREventTag = {
  source: 'priority_tag' | 'fallback'
  tag: PriorityEventVRTag
}

function inferLeverageStress(tqqqDrawdownPct: number | null): PriorityEventVRTag['vr_analysis']['leverage_stress'] {
  if (tqqqDrawdownPct == null) return 'medium'
  const magnitude = Math.abs(tqqqDrawdownPct)
  if (magnitude >= 50) return 'extreme'
  if (magnitude >= 30) return 'high'
  if (magnitude >= 15) return 'medium'
  return 'low'
}

function inferRecoveryQuality(reboundStrengthPct: number | null): PriorityEventVRTag['vr_analysis']['recovery_quality'] {
  if (reboundStrengthPct == null) return 'mixed'
  if (reboundStrengthPct >= 18) return 'strong'
  if (reboundStrengthPct >= 8) return 'improving'
  if (reboundStrengthPct >= 3) return 'mixed'
  return 'weak'
}

export function attachPriorityEventVRTag(input: {
  rootDir: string
  eventId: string
  supportStatus: PriorityEventVRTag['vr_support_status']
  syntheticProxy?: boolean
  patternMatches: PatternDetectionResult
  ma200Status: string
  tqqqDrawdownPct: number | null
  reboundStrengthPct: number | null
}): AttachedVREventTag {
  const priorityEventTags = loadPriorityEventTags(input.rootDir)
  const seeded = priorityEventTags[input.eventId]

  if (seeded) {
    return {
      source: 'priority_tag',
      tag: {
        ...seeded,
        vr_support_status: input.supportStatus === 'pending_synthetic' ? 'pending_synthetic' : seeded.vr_support_status,
      },
    }
  }

  const topPattern = input.patternMatches.top_matches[0]

  return {
    source: 'fallback',
    tag: {
      event_id: input.eventId,
      vr_support_status: input.supportStatus,
      vr_analysis: {
        pattern_type: topPattern?.pattern_id ?? 'not_classified',
        ma200_status:
          input.ma200Status === 'Sustained Below MA200' ? 'sustained_below'
          : input.ma200Status === 'Breached MA200' ? 'breached'
          : input.ma200Status === 'Testing MA200' ? 'tested'
          : 'above',
        leverage_stress: inferLeverageStress(input.tqqqDrawdownPct),
        recovery_quality: inferRecoveryQuality(input.reboundStrengthPct),
        tags: topPattern?.pattern_id ? [topPattern.pattern_id, 'fallback_interpretation'] : ['fallback_interpretation', 'untagged_event'],
        lesson:
          input.supportStatus === 'pending_synthetic'
            ? 'Synthetic TQQQ-based VR interpretation pending.'
            : 'Not yet tagged for curated VR playback.',
        scenario_bias: [],
        playbook_bias: [],
      },
    },
  }
}

export function runPriorityEventTagExamples(rootDir: string) {
  const cases = [
    { eventId: '2026-02', expectedSource: 'priority_tag' },
    { eventId: '2020-02', expectedSource: 'priority_tag' },
    { eventId: '1999-04', expectedSource: 'fallback' },
  ] as const

  const tags = loadPriorityEventTags(rootDir)

  return cases.map((testCase) => ({
    event_id: testCase.eventId,
    passed:
      (testCase.expectedSource === 'priority_tag' && Boolean(tags[testCase.eventId])) ||
      (testCase.expectedSource === 'fallback' && !tags[testCase.eventId]),
  }))
}
