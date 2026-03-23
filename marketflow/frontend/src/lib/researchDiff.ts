import type { ResearchResponse } from '@/types/research'
import type { ChangeSummary, MonitorStatus } from '@/types/researchMonitor'

export const RISK_SCORE: Record<string, number> = {
  Low: 1, Moderate: 2, Elevated: 3, High: 4, Critical: 5,
}

export function diffResearch(
  previous: ResearchResponse,
  latest:   ResearchResponse,
): ChangeSummary {
  const notable: string[] = []

  // Risk level
  const prevScore = RISK_SCORE[previous.risk_level] ?? 2
  const latScore  = RISK_SCORE[latest.risk_level]   ?? 2
  const riskDelta = latScore - prevScore
  const risk_changed     = riskDelta !== 0
  const risk_direction   = riskDelta > 0 ? 'up' as const : riskDelta < 0 ? 'down' as const : undefined
  if (risk_changed) {
    notable.push(
      `Risk ${risk_direction === 'up' ? '\u2191' : '\u2193'} ${previous.risk_level} \u2192 ${latest.risk_level}`
    )
  }

  // Summary length delta > 15%
  const prevLen = previous.summary.length
  const latLen  = latest.summary.length
  const summary_changed = prevLen > 0 && Math.abs(latLen - prevLen) / prevLen > 0.15
  if (summary_changed) notable.push('Summary updated')

  // Evidence count
  const prevEv = previous.evidence.length
  const latEv  = latest.evidence.length
  const evidence_changed = prevEv !== latEv
  if (evidence_changed) {
    notable.push(`Evidence ${latEv > prevEv ? '+' : ''}${latEv - prevEv} (${latEv} total)`)
  }

  // Source count
  const prevSrc = previous.sources.length
  const latSrc  = latest.sources.length
  const source_count_changed = prevSrc !== latSrc
  const source_count_delta   = latSrc - prevSrc
  if (source_count_changed) {
    notable.push(`Sources ${source_count_delta > 0 ? '+' : ''}${source_count_delta} (${latSrc})`)
  }

  return {
    risk_changed,
    risk_direction,
    summary_changed,
    evidence_changed,
    source_count_changed,
    source_count_delta,
    notable,
  }
}

export function deriveMonitorStatus(
  diff:          ChangeSummary,
  prevRiskScore: number,
  latRiskScore:  number,
): MonitorStatus {
  const delta = latRiskScore - prevRiskScore
  if (delta >= 2) return 'warning'
  if (diff.risk_changed || (diff.evidence_changed && diff.summary_changed)) return 'changed'
  if (diff.notable.length > 0) return 'updated'
  return 'watching'
}
