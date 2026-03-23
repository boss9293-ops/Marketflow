// =============================================================================
// buildDailySnapshot.ts  (WO-SA25)
// Derive today's snapshot and recent history from available data
// =============================================================================
import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'

export interface DailySnapshot {
  date:        string
  regime:      string
  runtime:     string
  buy_gate:    string
  risk_level:  string
  phase:       string | null
}

export interface DailyChange {
  field:    string
  from:     string
  to:       string
  severity: 'high' | 'medium' | 'low'
}

export interface DailySnapshotView {
  today:       DailySnapshot
  yesterday:   DailySnapshot | null
  changes:     DailyChange[]
  timeline:    { date: string; label: string; runtime: string }[]
  has_changes: boolean
}

// Map market_phase / risk_level to runtime label
function phaseToRuntime(phase: string | null | undefined, riskLevel: string | null | undefined): string {
  if (!phase && !riskLevel) return 'NORMAL'
  const p = (phase ?? '').toUpperCase()
  const r = (riskLevel ?? '').toUpperCase()
  if (p.includes('LOCKDOWN') || r.includes('EXTREME') || r.includes('HIGH RISK')) return 'LOCKDOWN'
  if (p.includes('DEFENSIVE') || r.includes('HIGH') || r.includes('RISK')) return 'DEFENSIVE'
  if (p.includes('LIMITED') || r.includes('CAUTION') || r.includes('WARNING')) return 'LIMITED'
  return 'NORMAL'
}

function riskLabel(riskLevel: string | null | undefined, gateScore: number | null | undefined): string {
  if (riskLevel) return riskLevel
  if (gateScore == null) return 'Unknown'
  if (gateScore >= 85) return 'Extreme'
  if (gateScore >= 70) return 'High'
  if (gateScore >= 50) return 'Elevated'
  if (gateScore >= 30) return 'Caution'
  return 'Normal'
}

type SnapshotItem = {
  date: string
  gate_score?: number | null
  market_phase?: string | null
  risk_level?: string | null
  risk_trend?: string | null
  phase_shift_flag?: number
}

function severityOf(from: string, to: string): 'high' | 'medium' | 'low' {
  const LEVELS = ['NORMAL', 'LIMITED', 'DEFENSIVE', 'LOCKDOWN']
  const fi = LEVELS.indexOf(from.toUpperCase())
  const ti = LEVELS.indexOf(to.toUpperCase())
  const diff = Math.abs(ti - fi)
  if (diff >= 2) return 'high'
  if (diff === 1) return 'medium'
  return 'low'
}

export function buildDailySnapshot(
  payload: SmartAnalyzerViewPayload | null | undefined,
  rawSnapshots: SnapshotItem[]
): DailySnapshotView {
  const today_date = new Date().toISOString().slice(0, 10)

  // Today's snapshot from saViewPayload
  const today: DailySnapshot = {
    date:       today_date,
    regime:     payload?.market_regime  ?? 'NORMAL',
    runtime:    payload?.runtime_mode   ?? 'NORMAL',
    buy_gate:   payload?.policy_link?.buy_gate    ?? 'OPEN',
    risk_level: 'Elevated',
    phase:      null,
  }

  // Sort snapshots by date desc
  const sorted = [...rawSnapshots]
    .filter(s => s.date)
    .sort((a, b) => b.date.localeCompare(a.date))

  // Yesterday = most recent snapshot entry
  const prevEntry = sorted[0] ?? null
  const yesterday: DailySnapshot | null = prevEntry ? {
    date:       prevEntry.date,
    regime:     today.regime,  // regime comes only from SA payload; assume same unless changed
    runtime:    phaseToRuntime(prevEntry.market_phase, prevEntry.risk_level),
    buy_gate:   prevEntry.gate_score != null
                  ? (prevEntry.gate_score >= 70 ? 'BLOCKED' : prevEntry.gate_score >= 50 ? 'LIMITED' : 'OPEN')
                  : today.buy_gate,
    risk_level: riskLabel(prevEntry.risk_level, prevEntry.gate_score),
    phase:      prevEntry.market_phase ?? null,
  } : null

  // Compute changes
  const changes: DailyChange[] = []
  if (yesterday) {
    if (yesterday.runtime !== today.runtime) {
      changes.push({ field: 'Runtime', from: yesterday.runtime, to: today.runtime, severity: severityOf(yesterday.runtime, today.runtime) })
    }
    if (yesterday.buy_gate !== today.buy_gate) {
      const gateDir: DailyChange['severity'] =
        (today.buy_gate === 'BLOCKED') ? 'high' :
        (today.buy_gate === 'LIMITED') ? 'medium' : 'low'
      changes.push({ field: 'Buy Gate', from: yesterday.buy_gate, to: today.buy_gate, severity: gateDir })
    }
  }

  // Timeline: last 5 snapshots
  const timeline = sorted.slice(0, 5).reverse().map(s => ({
    date:    s.date,
    label:   new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    runtime: phaseToRuntime(s.market_phase, s.risk_level),
  }))

  return { today, yesterday, changes, timeline, has_changes: changes.length > 0 }
}
