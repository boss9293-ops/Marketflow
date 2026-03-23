// =============================================================================
// formatVrAudit.ts  (WO-SA12)
//
// 목적: VR execution hook / action policy debug 데이터를 UI 텍스트로 변환
// =============================================================================

export type VrAuditPermission = 'ALLOW' | 'LIMIT' | 'BLOCK' | 'PRIORITIZE';
export type VrAuditDecision   = 'EXECUTE' | 'PARTIAL_EXECUTE' | 'SKIP' | 'PRIORITIZE_DEFENSE';
export type VrAuditRuntimeMode = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN';

export interface VrAuditViewPayload {
  raw_action_class: string;
  runtime_mode:     VrAuditRuntimeMode;
  permission:       VrAuditPermission;
  execution_decision: VrAuditDecision;
  blocked:       boolean;
  limited:       boolean;
  prioritized:   boolean;
  raw_qty?:      number;
  final_qty?:    number;
  raw_notional?: number;
  final_notional?: number;
  sizing_cap_pct?: number;
  policy_reason:   string;
  execution_reason: string;
  note?: string;
  debug_policy?: {
    mode_rule?:         string;
    shock_override?:    string;
    structural_override?: string;
    gate_rule?:         string;
  };
}

// =============================================================================
// LABEL MAPS
// =============================================================================

const PERMISSION_LABEL: Record<string, string> = {
  ALLOW:     'Allowed',
  LIMIT:     'Limited',
  BLOCK:     'Blocked',
  PRIORITIZE: 'Defense Priority',
};

const DECISION_LABEL: Record<string, string> = {
  EXECUTE:             'Executed',
  PARTIAL_EXECUTE:     'Partial Execution',
  SKIP:                'Blocked',  // unified per SA16: always Blocked
  PRIORITIZE_DEFENSE:  'Defense Prioritized',
};

const MODE_LABEL: Record<string, string> = {
  NORMAL:    'Normal',
  LIMITED:   'Limited',
  DEFENSIVE: 'Defensive',
  LOCKDOWN:  'Lockdown',
};

const ACTION_LABEL: Record<string, string> = {
  BASE_BUY:        'Base Buy',
  REBOUND_BUY:     'Rebound Buy',
  AGGRESSIVE_ADD:  'Aggressive Add',
  DEFENSIVE_BUY:   'Defensive Buy',
  MAINTENANCE_BUY: 'Maintenance Buy',
  REDUCE_RISK:     'Reduce Risk',
  HOLD:            'Hold',
};

// =============================================================================
// BADGE TONES
// =============================================================================

export type VrAuditBadgeTone = 'positive' | 'amber' | 'red' | 'purple' | 'gray';

export function resolveBadgeTone(decision: string): VrAuditBadgeTone {
  if (decision === 'EXECUTE')             return 'positive';
  if (decision === 'PARTIAL_EXECUTE')     return 'amber';
  if (decision === 'SKIP')               return 'red';
  if (decision === 'PRIORITIZE_DEFENSE') return 'purple';
  return 'gray';
}

// =============================================================================
// REASON LINES BUILDER
// =============================================================================

function buildReasonLines(payload: VrAuditViewPayload): string[] {
  const lines: string[] = [];
  const { debug_policy, execution_decision, raw_qty, final_qty, raw_notional, final_notional, sizing_cap_pct } = payload;

  // Mode rule
  if (debug_policy?.mode_rule) {
    lines.push(`Runtime mode: ${MODE_LABEL[payload.runtime_mode] ?? payload.runtime_mode}`);
  }

  // Shock override
  if (debug_policy?.shock_override && !debug_policy.shock_override.includes('false')) {
    lines.push(`Shock override: applied`);
  }

  // Structural override
  if (debug_policy?.structural_override && !debug_policy.structural_override.includes('false')) {
    lines.push(`Structural override: applied`);
  }

  // Gate rule
  if (debug_policy?.gate_rule && debug_policy.gate_rule !== 'no_gate_override') {
    lines.push(`Gate rule: ${debug_policy.gate_rule}`);
  }

  // Execution result line
  if (execution_decision === 'SKIP') {
    lines.push(`${ACTION_LABEL[payload.raw_action_class] ?? payload.raw_action_class} blocked — execution skipped`);
  } else if (execution_decision === 'PARTIAL_EXECUTE') {
    const capStr = sizing_cap_pct !== undefined ? `${sizing_cap_pct}%` : 'partial';
    if (raw_qty !== undefined && final_qty !== undefined) {
      lines.push(`Execution reduced from ${raw_qty} to ${final_qty} shares (${capStr} cap)`);
    } else if (raw_notional !== undefined && final_notional !== undefined) {
      lines.push(`Execution reduced from $${raw_notional.toFixed(0)} to $${final_notional.toFixed(0)} (${capStr} cap)`);
    } else {
      lines.push(`Execution capped at ${capStr}`);
    }
  } else if (execution_decision === 'PRIORITIZE_DEFENSE') {
    lines.push(`Reduce-risk action retained — defense runs first this cycle`);
  } else {
    lines.push(`Action passes through at full size`);
  }

  return lines;
}

// =============================================================================
// PUBLIC FORMATTER
// =============================================================================

export interface VrAuditFormatResult {
  action_label:    string;
  mode_label:      string;
  permission_label: string;
  decision_label:  string;
  badge_label:     string;
  badge_tone:      VrAuditBadgeTone;
  policy_text:     string;
  execution_text:  string;
  reason_lines:    string[];
  sizing_display?: string;
  qty_display?: {
    raw:   string;
    final: string;
    pct?:  string;
  };
}

export function formatVrAuditReason(payload: VrAuditViewPayload | null | undefined): VrAuditFormatResult {
  if (!payload) {
    return {
      action_label:    '—',
      mode_label:      '—',
      permission_label: '—',
      decision_label:  '—',
      badge_label:     '—',
      badge_tone:      'gray',
      policy_text:     'No VR audit data available',
      execution_text:  '',
      reason_lines:    [],
    };
  }

  const tone          = resolveBadgeTone(payload.execution_decision);
  const reasonLines   = buildReasonLines(payload);
  const permLabel     = PERMISSION_LABEL[payload.permission]  ?? payload.permission;
  const decisionLabel = DECISION_LABEL[payload.execution_decision] ?? payload.execution_decision;
  const actionLabel   = ACTION_LABEL[payload.raw_action_class] ?? payload.raw_action_class;
  const modeLabel     = MODE_LABEL[payload.runtime_mode]       ?? payload.runtime_mode;

  // Sizing display
  let sizingDisplay: string | undefined;
  if (payload.sizing_cap_pct !== undefined && payload.limited) {
    sizingDisplay = `${payload.sizing_cap_pct}% executed`;
  }

  // Qty display
  let qtyDisplay: VrAuditFormatResult['qty_display'] | undefined;
  if (payload.raw_qty !== undefined || payload.raw_notional !== undefined) {
    const rawStr   = payload.raw_qty     !== undefined ? `${payload.raw_qty} shares`    : `$${payload.raw_notional?.toFixed(0)}`;
    const finalStr = payload.final_qty   !== undefined ? `${payload.final_qty} shares`  : `$${payload.final_notional?.toFixed(0)}`;
    const pct      = payload.sizing_cap_pct !== undefined ? `${payload.sizing_cap_pct}%` : undefined;
    qtyDisplay = { raw: rawStr, final: finalStr, pct };
  }

  return {
    action_label:    actionLabel,
    mode_label:      modeLabel,
    permission_label: permLabel,
    decision_label:  decisionLabel,
    badge_label:     decisionLabel,
    badge_tone:      tone,
    policy_text:     payload.policy_reason   || permLabel,
    execution_text:  payload.execution_reason || decisionLabel,
    reason_lines:    reasonLines,
    sizing_display:  sizingDisplay,
    qty_display:     qtyDisplay,
  };
}
