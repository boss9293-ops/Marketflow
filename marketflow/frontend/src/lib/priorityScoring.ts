import type { MonitoredTopic, MonitorStatus } from '@/types/researchMonitor'
import type { PriorityLevel } from '@/types/priority'

const RISK_SCORE: Record<string, number> = {
  Low: 0, Moderate: 6, Elevated: 13, High: 21, Critical: 30,
}

const STATUS_SCORE: Record<MonitorStatus, number> = {
  watching:  10,
  updated:   32,
  changed:   57,
  warning:   82,
}

const VR_STATE_SCORE: Record<string, number> = {
  NORMAL:    0,
  CAUTION:   5,
  REENTRY:   8,
  EXIT_DONE: 12,
  ARMED:     18,
}

export function scoreMonitorTopic(topic: MonitoredTopic): number {
  const base      = STATUS_SCORE[topic.status] ?? 10
  const risk      = RISK_SCORE[topic.latest.risk_level] ?? 0
  const vrc       = topic.vr_context?.vr_state
    ? (VR_STATE_SCORE[topic.vr_context.vr_state] ?? 0)
    : 0
  const crash     = topic.vr_context?.crash_trigger ? 8 : 0
  return Math.min(100, base + risk + vrc + crash)
}

export function scoreToPriorityLevel(score: number): PriorityLevel {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}
