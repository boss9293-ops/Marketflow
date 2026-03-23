// =============================================================================
// formatVrTimeline.ts  (WO-SA13)
//
// 목적: VR 시간축 audit 데이터를 UI-friendly 형태로 변환
// =============================================================================

import { resolveBadgeTone, type VrAuditBadgeTone } from './formatVrAudit'

export type VrTimelineRuntimeMode = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
export type VrTimelinePermission  = 'ALLOW' | 'LIMIT' | 'BLOCK' | 'PRIORITIZE'
export type VrTimelineDecision    = 'EXECUTE' | 'PARTIAL_EXECUTE' | 'SKIP' | 'PRIORITIZE_DEFENSE'

export interface VrTimelineRow {
  timestamp:          string
  price?:             number
  raw_action_class:   string
  runtime_mode:       VrTimelineRuntimeMode
  permission:         VrTimelinePermission
  execution_decision: VrTimelineDecision
  raw_qty?:           number
  final_qty?:         number
  sizing_cap_pct?:    number
  policy_reason:      string
  execution_reason:   string
  shock_flag?:        boolean
  structural_flag?:   boolean
}

// =============================================================================
// LABEL MAPS
// =============================================================================

const MODE_LABEL: Record<string, string> = {
  NORMAL:    'Normal',
  LIMITED:   'Limited',
  DEFENSIVE: 'Defensive',
  LOCKDOWN:  'Lockdown',
}

const ACTION_SHORT: Record<string, string> = {
  BASE_BUY:        'Base',
  REBOUND_BUY:     'Rebound',
  AGGRESSIVE_ADD:  'Add',
  DEFENSIVE_BUY:   'Defensive',
  MAINTENANCE_BUY: 'Maintain',
  REDUCE_RISK:     'Reduce',
  HOLD:            'Hold',
}

const DECISION_SHORT: Record<string, string> = {
  EXECUTE:             'Executed',
  PARTIAL_EXECUTE:     'Partial',
  SKIP:                'Blocked',
  PRIORITIZE_DEFENSE:  'Prioritized',
}

// =============================================================================
// MODE BADGE TONE
// =============================================================================

export type VrModeBadgeTone = 'gray' | 'amber' | 'orange' | 'red'

export function resolveModeTone(mode: string): VrModeBadgeTone {
  if (mode === 'LOCKDOWN')  return 'red'
  if (mode === 'DEFENSIVE') return 'orange'
  if (mode === 'LIMITED')   return 'amber'
  return 'gray'
}

// =============================================================================
// BLOCK STREAK COMPUTATION
// =============================================================================

export interface BlockStreaks {
  [actionClass: string]: number
}

export function computeBlockStreaks(rows: VrTimelineRow[]): BlockStreaks[] {
  const counters: Record<string, number> = {}
  return rows.map(row => {
    const ac = row.raw_action_class
    if (row.execution_decision === 'SKIP') {
      counters[ac] = (counters[ac] ?? 0) + 1
    } else {
      counters[ac] = 0
    }
    return { ...counters }
  })
}

// =============================================================================
// TRANSITION DETECTION
// =============================================================================

export function isTransitionRow(rows: VrTimelineRow[], index: number): boolean {
  if (index === 0) return false
  return rows[index].runtime_mode !== rows[index - 1].runtime_mode
}

// =============================================================================
// REASON LINES
// =============================================================================

function buildReasonLines(row: VrTimelineRow): string[] {
  const lines: string[] = []
  if (row.shock_flag)      lines.push('Shock flag active')
  if (row.structural_flag) lines.push('Structural pressure active')
  if (row.execution_decision === 'SKIP') {
    lines.push(`${ACTION_SHORT[row.raw_action_class] ?? row.raw_action_class} buy blocked`)
  } else if (row.execution_decision === 'PARTIAL_EXECUTE') {
    const cap = row.sizing_cap_pct !== undefined ? `${row.sizing_cap_pct}% cap` : 'partial cap'
    lines.push(`${ACTION_SHORT[row.raw_action_class] ?? row.raw_action_class} limited — ${cap}`)
    if (row.raw_qty !== undefined && row.final_qty !== undefined) {
      lines.push(`${row.raw_qty} → ${row.final_qty} shares`)
    }
  } else if (row.execution_decision === 'PRIORITIZE_DEFENSE') {
    lines.push('Defense action runs first')
  }
  // Append policy reason if short and not a duplicate
  if (row.policy_reason && row.policy_reason.length <= 60) {
    lines.push(row.policy_reason)
  }
  return lines
}

// =============================================================================
// FORMATTED ROW
// =============================================================================

export interface VrTimelineFormattedRow {
  timestamp:      string
  date_label:     string
  price_label:    string
  mode_label:     string
  mode_tone:      VrModeBadgeTone
  action_label:   string
  decision_label: string
  decision_tone:  VrAuditBadgeTone
  result_text:    string
  reason_lines:   string[]
  is_transition:  boolean
  block_streak:   number
  shock_flag:     boolean
  structural_flag: boolean
}

export function formatTimelineRow(
  row: VrTimelineRow,
  index: number,
  allRows: VrTimelineRow[],
  streaks: BlockStreaks[],
): VrTimelineFormattedRow {
  const isTransition  = isTransitionRow(allRows, index)
  const streakMap     = streaks[index] ?? {}
  const blockStreak   = streakMap[row.raw_action_class] ?? 0

  const modeTone      = resolveModeTone(row.runtime_mode)
  const decisionTone  = resolveBadgeTone(row.execution_decision)

  // Date label — show just date portion
  const dateLabel = row.timestamp.length >= 10 ? row.timestamp.slice(0, 10) : row.timestamp
  const priceLabel = row.price !== undefined ? `$${row.price.toFixed(2)}` : '—'

  // Result text
  let resultText = DECISION_SHORT[row.execution_decision] ?? row.execution_decision
  if (row.execution_decision === 'PARTIAL_EXECUTE' && row.sizing_cap_pct !== undefined) {
    resultText = `Partial (${row.sizing_cap_pct}%)`
  }

  return {
    timestamp:      row.timestamp,
    date_label:     dateLabel,
    price_label:    priceLabel,
    mode_label:     MODE_LABEL[row.runtime_mode] ?? row.runtime_mode,
    mode_tone:      modeTone,
    action_label:   ACTION_SHORT[row.raw_action_class] ?? row.raw_action_class,
    decision_label: resultText,
    decision_tone:  decisionTone,
    result_text:    resultText,
    reason_lines:   buildReasonLines(row),
    is_transition:  isTransition,
    block_streak:   blockStreak,
    shock_flag:     row.shock_flag ?? false,
    structural_flag: row.structural_flag ?? false,
  }
}

// =============================================================================
// FULL TIMELINE FORMATTER
// =============================================================================

export function formatVrTimeline(rows: VrTimelineRow[], maxRows = 100): VrTimelineFormattedRow[] {
  const limited = rows.slice(-maxRows) // keep most recent N
  const streaks = computeBlockStreaks(limited)
  return limited.map((row, i) => formatTimelineRow(row, i, limited, streaks))
}

// =============================================================================
// SAMPLE DATA GENERATOR (for dev/demo use)
// =============================================================================

export function buildSampleTimeline(): VrTimelineRow[] {
  const modes: VrTimelineRuntimeMode[]   = ['NORMAL', 'NORMAL', 'LIMITED', 'LIMITED', 'DEFENSIVE', 'LOCKDOWN', 'LOCKDOWN', 'DEFENSIVE', 'LIMITED', 'NORMAL']
  const actions                          = ['BASE_BUY', 'BASE_BUY', 'BASE_BUY', 'REBOUND_BUY', 'DEFENSIVE_BUY', 'REDUCE_RISK', 'REDUCE_RISK', 'DEFENSIVE_BUY', 'BASE_BUY', 'BASE_BUY']
  const decisions: VrTimelineDecision[]  = ['EXECUTE', 'EXECUTE', 'PARTIAL_EXECUTE', 'PARTIAL_EXECUTE', 'SKIP', 'PRIORITIZE_DEFENSE', 'PRIORITIZE_DEFENSE', 'SKIP', 'PARTIAL_EXECUTE', 'EXECUTE']
  const prices = [480, 475, 465, 450, 430, 400, 390, 405, 425, 450]
  const base = new Date('2022-02-15')

  return modes.map((mode, i) => {
    const date = new Date(base)
    date.setDate(base.getDate() + i * 3)
    const decision = decisions[i]
    const isPartial = decision === 'PARTIAL_EXECUTE'
    return {
      timestamp:          date.toISOString().slice(0, 10),
      price:              prices[i],
      raw_action_class:   actions[i],
      runtime_mode:       mode,
      permission:         (decision === 'SKIP' ? 'BLOCK' : decision === 'PARTIAL_EXECUTE' ? 'LIMIT' : decision === 'PRIORITIZE_DEFENSE' ? 'PRIORITIZE' : 'ALLOW') as VrTimelinePermission,
      execution_decision: decision,
      raw_qty:            100,
      final_qty:          isPartial ? 50 : decision === 'SKIP' ? 0 : 100,
      sizing_cap_pct:     isPartial ? 50 : 100,
      policy_reason:      mode === 'LOCKDOWN' ? 'RED+shock+BLOCK' : mode === 'DEFENSIVE' ? 'Defensive mode' : mode === 'LIMITED' ? 'Limited mode cap' : 'Normal operation',
      execution_reason:   decision === 'SKIP' ? `${mode} mode blocked this action` : decision === 'PARTIAL_EXECUTE' ? 'Sized down per policy cap' : 'Full execution allowed',
      shock_flag:         i >= 4 && i <= 6,
      structural_flag:    i >= 3 && i <= 7,
    }
  })
}
