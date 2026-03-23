// =============================================================================
// lib/alertRules.ts  (WO-SA26)
// Declarative rules that map state transitions to Alert objects
// =============================================================================
import type { Alert, AlertSeverity } from '@/types/alert'
import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'

export interface AlertRule {
  id:       string
  evaluate: (payload: SmartAnalyzerViewPayload, date: string) => Alert | null
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeId(type: string, value: string, date: string) {
  return type + '_' + value + '_' + date
}

function isoDate(date: string) {
  // Accept YYYY-MM-DD or Date
  return date.slice(0, 10)
}

// ── Runtime rule ─────────────────────────────────────────────────────────────

const RUNTIME_SEVERITY: Record<string, AlertSeverity> = {
  LOCKDOWN:  'HIGH',
  DEFENSIVE: 'HIGH',
  LIMITED:   'MEDIUM',
  NORMAL:    'LOW',
}

const runtimeRule: AlertRule = {
  id: 'RUNTIME_STATE',
  evaluate(payload, date) {
    const runtime = payload?.runtime_mode ?? null
    if (!runtime) return null

    const severity = RUNTIME_SEVERITY[runtime] ?? 'LOW'
    if (severity === 'LOW') return null   // NORMAL state — not noteworthy

    return {
      id:        makeId('RUNTIME', runtime, isoDate(date)),
      type:      'RUNTIME',
      severity,
      title:     'Posture: ' + runtime,
      message:
        runtime === 'LOCKDOWN'
          ? 'Market posture is LOCKDOWN — new positions blocked, reduce exposure.'
          : runtime === 'DEFENSIVE'
          ? 'Market posture is DEFENSIVE — reduce leverage, tighten stops.'
          : 'Market posture is LIMITED — reduced position sizing recommended.',
      timestamp: date,
    }
  },
}

// ── Buy-gate rule ─────────────────────────────────────────────────────────────

const GATE_SEVERITY: Record<string, AlertSeverity> = {
  BLOCKED: 'HIGH',
  LIMITED: 'MEDIUM',
  OPEN:    'LOW',
}

const gateRule: AlertRule = {
  id: 'GATE_STATE',
  evaluate(payload, date) {
    const gate = payload?.policy_link?.buy_gate ?? null
    if (!gate) return null

    const severity = GATE_SEVERITY[gate] ?? 'LOW'
    if (severity === 'LOW') return null   // OPEN — not noteworthy

    return {
      id:        makeId('GATE', gate, isoDate(date)),
      type:      'GATE',
      severity,
      title:     'Buy Gate: ' + gate,
      message:
        gate === 'BLOCKED'
          ? 'Buy gate is BLOCKED — avoid new long entries until conditions improve.'
          : 'Buy gate is LIMITED — only high-conviction setups qualify.',
      timestamp: date,
    }
  },
}

// ── Risk-level rule ───────────────────────────────────────────────────────────

const riskRule: AlertRule = {
  id: 'RISK_LEVEL',
  evaluate(payload, date) {
    const risk = payload?.policy_link?.risk_pressure ?? null
    if (risk === null || risk === undefined) return null

    const numRisk = Number(risk)
    if (isNaN(numRisk) || numRisk < 0.60) return null   // low pressure — not noteworthy

    const severity: AlertSeverity = numRisk >= 0.85 ? 'HIGH' : 'MEDIUM'

    return {
      id:        makeId('RISK', numRisk >= 0.85 ? 'HIGH' : 'MED', isoDate(date)),
      type:      'RISK',
      severity,
      title:     'Risk Pressure: ' + Math.round(numRisk * 100) + '%',
      message:
        numRisk >= 4
          ? 'Extreme risk conditions detected. Defensive posture required.'
          : 'Elevated risk level. Review exposure and tighten position sizing.',
      timestamp: date,
    }
  },
}

// ── Export ────────────────────────────────────────────────────────────────────

export const ALERT_RULES: AlertRule[] = [runtimeRule, gateRule, riskRule]
