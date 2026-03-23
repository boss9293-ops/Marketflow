// =============================================================================
// smartAnalyzerLabels.ts  (WO-SA16)
//
// Single source of truth for all status labels used across
// Smart Analyzer Hero, VR Audit, VR Timeline, and VR Survival panels.
// Import from here — do NOT duplicate these maps in individual files.
// =============================================================================

export type SARegime  = 'NORMAL' | 'EVENT' | 'STRUCTURAL' | 'HYBRID'
export type SARuntimeMode = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
export type SAGate    = 'OPEN' | 'LIMITED' | 'BLOCKED'
export type SADecision = 'EXECUTE' | 'PARTIAL_EXECUTE' | 'SKIP' | 'PRIORITIZE_DEFENSE'
export type SAPermission = 'ALLOW' | 'LIMIT' | 'BLOCK' | 'PRIORITIZE'
export type SABadgeTone = 'green' | 'amber' | 'orange' | 'red' | 'purple' | 'neutral'

// ── Level 1: Market Regime ────────────────────────────────────────────────────

export const REGIME_LABEL: Record<SARegime, string> = {
  NORMAL:     'Normal regime',
  EVENT:      'Event-driven stress',
  STRUCTURAL: 'Structural stress',
  HYBRID:     'Mixed regime',
}

export const REGIME_TONE: Record<SARegime, SABadgeTone> = {
  NORMAL:     'neutral',
  EVENT:      'orange',
  STRUCTURAL: 'red',
  HYBRID:     'amber',
}

// ── Level 2: Runtime Mode ─────────────────────────────────────────────────────

export const RUNTIME_LABEL: Record<SARuntimeMode, string> = {
  NORMAL:    'Normal',
  LIMITED:   'Limited',
  DEFENSIVE: 'Defensive',
  LOCKDOWN:  'Lockdown',
}

export const RUNTIME_TONE: Record<SARuntimeMode, SABadgeTone> = {
  NORMAL:    'neutral',
  LIMITED:   'amber',
  DEFENSIVE: 'orange',
  LOCKDOWN:  'red',
}

// ── Level 3: Policy Gate ──────────────────────────────────────────────────────

export const GATE_LABEL: Record<SAGate, string> = {
  OPEN:    'Open',
  LIMITED: 'Limited',
  BLOCKED: 'Blocked',
}

export const GATE_TONE: Record<SAGate, SABadgeTone> = {
  OPEN:    'green',
  LIMITED: 'amber',
  BLOCKED: 'red',
}

// ── Level 4: Execution ────────────────────────────────────────────────────────

export const DECISION_LABEL: Record<SADecision, string> = {
  EXECUTE:            'Executed',
  PARTIAL_EXECUTE:    'Partial Execution',
  SKIP:               'Blocked',              // unified: always "Blocked" not "Skipped"
  PRIORITIZE_DEFENSE: 'Defense Prioritized',
}

export const DECISION_TONE: Record<SADecision, SABadgeTone> = {
  EXECUTE:            'green',
  PARTIAL_EXECUTE:    'amber',
  SKIP:               'red',
  PRIORITIZE_DEFENSE: 'purple',
}

export const PERMISSION_LABEL: Record<SAPermission, string> = {
  ALLOW:     'Allowed',
  LIMIT:     'Limited',
  BLOCK:     'Blocked',
  PRIORITIZE: 'Defense Priority',
}

// ── Action classes ────────────────────────────────────────────────────────────

export const ACTION_LABEL: Record<string, string> = {
  BASE_BUY:        'Base Buy',
  REBOUND_BUY:     'Rebound Buy',
  AGGRESSIVE_ADD:  'Aggressive Add',
  DEFENSIVE_BUY:   'Defensive Buy',
  MAINTENANCE_BUY: 'Maintenance Buy',
  REDUCE_RISK:     'Reduce Risk',
  HOLD:            'Hold',
}

export const ACTION_SHORT: Record<string, string> = {
  BASE_BUY:        'Base',
  REBOUND_BUY:     'Rebound',
  AGGRESSIVE_ADD:  'Add',
  DEFENSIVE_BUY:   'Defensive',
  MAINTENANCE_BUY: 'Maintain',
  REDUCE_RISK:     'Reduce',
  HOLD:            'Hold',
}

// ── Cross-panel link text ─────────────────────────────────────────────────────

export const CROSS_LINK_AUDIT =
  'This action reflects the current Smart Analyzer runtime mode and policy state.'

export const CROSS_LINK_TIMELINE =
  'Timeline shows how analyzer posture shifts affected VR execution over time.'

// ── Posture-aware default headlines ──────────────────────────────────────────

export function deriveDefaultHeadline(
  regime: SARegime,
  runtime?: SARuntimeMode,
): string {
  // Priority 1: Lockdown / Defensive
  if (runtime === 'LOCKDOWN')  return 'Lockdown posture active under elevated structural pressure'
  if (runtime === 'DEFENSIVE') return 'Defensive posture persists — buy activity constrained'
  // Priority 2: Structural regime
  if (regime === 'STRUCTURAL') return 'Structural stress is constraining market participation'
  // Priority 3: Event-driven
  if (regime === 'EVENT')      return 'Event-driven pressure limiting entry conditions'
  // Priority 4: Mixed
  if (runtime === 'LIMITED')   return 'Mixed macro regime keeps posture limited'
  if (regime === 'HYBRID')     return 'Mixed signals — selective positioning favored'
  // Priority 5: Normal
  return 'Normal regime — no major execution constraints'
}
