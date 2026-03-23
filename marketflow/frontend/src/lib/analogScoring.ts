// =============================================================================
// analogScoring.ts — Score payload against catalog entries  (WO-SA20)
// =============================================================================
import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import type { AnalogEntry, AnalogMatch } from '@/types/analog'

const REGIME_SCORE: Record<string, Record<string, number>> = {
  STRUCTURAL: { STRUCTURAL: 30, HYBRID: 15, EVENT: 8, NORMAL: 0 },
  EVENT:      { EVENT: 30, HYBRID: 18, STRUCTURAL: 8, NORMAL: 5 },
  HYBRID:     { HYBRID: 30, STRUCTURAL: 18, EVENT: 18, NORMAL: 10 },
  NORMAL:     { NORMAL: 30, HYBRID: 15, EVENT: 5, STRUCTURAL: 5 },
}

const RUNTIME_SCORE: Record<string, Record<string, number>> = {
  LOCKDOWN:  { LOCKDOWN: 25, DEFENSIVE: 12, LIMITED: 6, NORMAL: 0 },
  DEFENSIVE: { DEFENSIVE: 25, LOCKDOWN: 15, LIMITED: 12, NORMAL: 5 },
  LIMITED:   { LIMITED: 25, DEFENSIVE: 15, LOCKDOWN: 8, NORMAL: 10 },
  NORMAL:    { NORMAL: 25, LIMITED: 15, DEFENSIVE: 8, LOCKDOWN: 0 },
}

const GATE_SCORE: Record<string, Record<string, number>> = {
  BLOCKED: { BLOCKED: 20, LIMITED: 10, OPEN: 0 },
  LIMITED: { LIMITED: 20, BLOCKED: 12, OPEN: 8 },
  OPEN:    { OPEN: 20, LIMITED: 12, BLOCKED: 0 },
}

function get<T extends Record<string, Record<string, number>>>(
  table: T, a: string, b: string
): number {
  return table[a]?.[b] ?? 0
}

export function scoreAnalog(
  payload: SmartAnalyzerViewPayload,
  entry: AnalogEntry
): number {
  const regime      = payload.market_regime  ?? 'NORMAL'
  const runtime     = payload.runtime_mode   ?? 'NORMAL'
  const buyGate     = payload.policy_link?.buy_gate    ?? 'OPEN'
  const reboundGate = payload.policy_link?.rebound_gate ?? 'OPEN'
  const gate        = buyGate === 'BLOCKED' || reboundGate === 'BLOCKED'
    ? 'BLOCKED'
    : buyGate === 'LIMITED' || reboundGate === 'LIMITED' ? 'LIMITED' : 'OPEN'

  const regimeScore  = get(REGIME_SCORE,  regime,  entry.regime)
  const runtimeScore = get(RUNTIME_SCORE, runtime, entry.runtime_mode)
  const gateScore    = get(GATE_SCORE,    gate,     entry.policy_gates)

  return regimeScore + runtimeScore + gateScore  // max = 75
}
