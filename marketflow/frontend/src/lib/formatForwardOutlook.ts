// =============================================================================
// formatForwardOutlook.ts  (WO-SA21)
// =============================================================================
import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import type { AnalyzerReliabilityPayload } from '@/types/analyzerReliability'
import { findAnalogs } from '@/lib/analogFinder'

export type ForwardBias = 'UPSIDE' | 'DOWNSIDE' | 'BALANCED'

export interface ForwardOutlookPayload {
  bias:           ForwardBias
  confidence:     'HIGH' | 'MEDIUM' | 'LOW'
  expected_range: { downside_20d?: number; upside_20d?: number }
  path_summary:   string
  drivers:        string[]
  has_data:       boolean
}

export function buildForwardOutlook(
  payload?: SmartAnalyzerViewPayload | null,
  reliability?: AnalyzerReliabilityPayload | null
): ForwardOutlookPayload | null {
  if (!payload) return null

  const regime  = payload.market_regime  ?? 'NORMAL'
  const runtime = payload.runtime_mode   ?? 'NORMAL'
  const buyGate = payload.policy_link?.buy_gate ?? 'OPEN'

  // Bias
  let bias: ForwardBias = 'BALANCED'
  if (runtime === 'LOCKDOWN' || runtime === 'DEFENSIVE') {
    bias = 'DOWNSIDE'
  } else if ((regime === 'STRUCTURAL' || regime === 'EVENT') && runtime === 'LIMITED') {
    bias = 'DOWNSIDE'
  } else if (regime === 'NORMAL' && buyGate === 'OPEN') {
    bias = 'UPSIDE'
  } else if (runtime === 'NORMAL' && buyGate === 'OPEN') {
    bias = 'UPSIDE'
  }

  // Confidence
  const conf = reliability?.confidence_level ?? 'LOW'

  // Range from analogs
  const analogs  = findAnalogs(payload)
  const returns  = analogs.map(a => a.forward_return_20d).filter((v): v is number => v !== undefined)
  const expected_range: { downside_20d?: number; upside_20d?: number } = {}
  if (returns.length > 0) {
    expected_range.downside_20d = Math.min(...returns)
    expected_range.upside_20d   = Math.max(...returns)
  }

  // Path summary
  const summaryMap: Record<string, string> = {
    DOWNSIDE: 'Current conditions suggest continued pressure with limited recovery window.',
    UPSIDE:   'Conditions align with historical recovery patterns; upside bias near-term.',
    BALANCED: 'Mixed signals — path uncertain; watch for regime confirmation.',
  }
  const path_summary = summaryMap[bias]

  // Drivers
  const drivers: string[] = []
  const topDriverLabels = (payload.top_drivers ?? []).slice(0, 2).map(d => d.label)
  drivers.push(...topDriverLabels)
  if (reliability?.reasons) {
    for (const r of reliability.reasons) {
      if (drivers.length >= 3) break
      drivers.push(r)
    }
  }

  return {
    bias,
    confidence:     conf,
    expected_range,
    path_summary,
    drivers,
    has_data:       analogs.length > 0,
  }
}
