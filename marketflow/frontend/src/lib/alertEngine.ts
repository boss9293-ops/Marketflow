// =============================================================================
// lib/alertEngine.ts  (WO-SA26)
// Server-side: evaluate rules and return deduplicated alerts
// =============================================================================
import type { Alert } from '@/types/alert'
import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import { ALERT_RULES } from '@/lib/alertRules'

const MAX_ALERTS = 3

/**
 * Evaluate all rules against the current payload and return up to MAX_ALERTS
 * sorted HIGH → MEDIUM → LOW.
 *
 * Called server-side from dashboard/page.tsx — no localStorage here.
 * Deduplication by `id` is handled client-side in useAlerts.
 */
export function buildAlerts(
  payload: SmartAnalyzerViewPayload | null | undefined,
  date: string,
): Alert[] {
  if (!payload) return []

  const results: Alert[] = []

  for (const rule of ALERT_RULES) {
    try {
      const alert = rule.evaluate(payload, date)
      if (alert) results.push(alert)
    } catch {
      // rule threw — skip silently
    }
  }

  // Sort: HIGH first
  const ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  results.sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9))

  return results.slice(0, MAX_ALERTS)
}
