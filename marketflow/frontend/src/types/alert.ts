// =============================================================================
// types/alert.ts  (WO-SA26)
// =============================================================================

export type AlertType     = 'RUNTIME' | 'GATE' | 'RISK'
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Alert {
  id:        string          // dedup key e.g. "RUNTIME_DEFENSIVE_2026-03-22"
  type:      AlertType
  severity:  AlertSeverity
  title:     string
  message:   string
  timestamp: string          // ISO date string
}
