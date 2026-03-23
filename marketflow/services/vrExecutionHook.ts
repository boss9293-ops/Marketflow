import type { VrActionClass } from '../types/vrAction';
import type {
  VrExecutionDebug,
  VrExecutionDecision,
  VrExecutionHookInput,
  VrExecutionHookResult,
  VR_ACTION_PRIORITY,
} from '../types/vrExecution';

// Re-export priority constant so callers can import from the service
export { VR_ACTION_PRIORITY } from '../types/vrExecution';

// =============================================================================
// vrExecutionHook.ts  (WO-SA11)
//
// 목적: VrGatedAction 결과를 실제 VR 실행 결정(EXECUTE/PARTIAL/SKIP/PRIORITIZE)으로
//       변환하는 execution hook.
//
// 규칙:
//   - raw strategy signal 수정 없음
//   - execution commit 직전 최종 필터 역할
//   - BLOCK = skip, LIMIT = partial sizing, PRIORITIZE = defense first
//   - 음수/NaN 금지
//   - 결정론적 매핑 전용
// =============================================================================

// =============================================================================
// PARTIAL QTY COMPUTATION
// =============================================================================

function applyCapToQty(raw: number | undefined, capPct: number): number | undefined {
  if (raw === undefined) return undefined;
  const v = Math.floor(raw * capPct / 100);
  return Math.max(0, v);
}

function applyCapToNotional(raw: number | undefined, capPct: number): number | undefined {
  if (raw === undefined) return undefined;
  const v = raw * capPct / 100;
  return Math.max(0, isNaN(v) ? 0 : v);
}

// =============================================================================
// DECISION RESOLVER
// =============================================================================

function resolveDecision(
  permission: string,
  finalQty: number | undefined,
  finalNotional: number | undefined,
): VrExecutionDecision {
  if (permission === 'BLOCK') return 'SKIP';
  if (permission === 'PRIORITIZE') return 'PRIORITIZE_DEFENSE';
  if (permission === 'LIMIT') {
    // If rounding caused qty/notional to be 0 → treat as SKIP
    const qty0 = finalQty !== undefined && finalQty <= 0;
    const not0 = finalNotional !== undefined && finalNotional <= 0;
    const bothZero = finalQty !== undefined && qty0 && finalNotional !== undefined && not0;
    const onlyQtyZero = finalQty !== undefined && qty0 && finalNotional === undefined;
    const onlyNotZero = finalNotional !== undefined && not0 && finalQty === undefined;
    if (bothZero || onlyQtyZero || onlyNotZero) return 'SKIP';
    return 'PARTIAL_EXECUTE';
  }
  return 'EXECUTE';
}

// =============================================================================
// NOTE / REASON BUILDERS
// =============================================================================

function buildExecutionNote(
  decision: VrExecutionDecision,
  input: VrExecutionHookInput,
  finalQty: number | undefined,
  finalNotional: number | undefined,
): string {
  const { raw_action_class: ac, gated_action: ga, vr_runtime_mode: mode } = input;

  if (decision === 'SKIP') {
    return `${ac} skipped in ${mode} mode — ${ga.note ?? 'blocked by policy'}`;
  }
  if (decision === 'PRIORITIZE_DEFENSE') {
    return `${ac} prioritized — defense action runs first this cycle`;
  }
  if (decision === 'PARTIAL_EXECUTE') {
    const qty  = finalQty     !== undefined ? ` qty=${finalQty}`          : '';
    const not  = finalNotional !== undefined ? ` notional=${finalNotional.toFixed(2)}` : '';
    return `${ac} partial execution at ${ga.sizing_cap_pct}% cap —${qty}${not}`;
  }
  // EXECUTE
  const qty = input.raw_qty     !== undefined ? ` qty=${input.raw_qty}` : '';
  const not = input.raw_notional !== undefined ? ` notional=${input.raw_notional.toFixed(2)}` : '';
  return `${ac} executed at full size —${qty}${not}`;
}

function buildExecutionReason(decision: VrExecutionDecision, mode: string, permission: string): string {
  if (decision === 'SKIP') {
    return `Policy permission=${permission} in runtime_mode=${mode} prevents execution.`;
  }
  if (decision === 'PRIORITIZE_DEFENSE') {
    return `REDUCE_RISK action prioritized in ${mode} mode per policy governance.`;
  }
  if (decision === 'PARTIAL_EXECUTE') {
    return `Policy permission=LIMIT in ${mode} mode — sizing capped per action policy profile.`;
  }
  return `Policy permission=ALLOW — raw action passes through unchanged.`;
}

// =============================================================================
// PUBLIC API — single action hook
// =============================================================================

export function buildVrExecutionHookResult(input: VrExecutionHookInput): VrExecutionHookResult {
  const { gated_action: ga, raw_qty, raw_notional } = input;

  // Compute final sizes
  let finalQty:      number | undefined;
  let finalNotional: number | undefined;

  if (ga.permission === 'BLOCK') {
    finalQty      = raw_qty      !== undefined ? 0 : undefined;
    finalNotional = raw_notional !== undefined ? 0 : undefined;
  } else if (ga.permission === 'LIMIT') {
    finalQty      = applyCapToQty(raw_qty, ga.sizing_cap_pct);
    finalNotional = applyCapToNotional(raw_notional, ga.sizing_cap_pct);
  } else {
    // ALLOW or PRIORITIZE — pass through raw
    finalQty      = raw_qty;
    finalNotional = raw_notional;
  }

  const decision = resolveDecision(ga.permission, finalQty, finalNotional);
  const executed = decision !== 'SKIP';
  const partial  = decision === 'PARTIAL_EXECUTE';
  const note     = buildExecutionNote(decision, input, finalQty, finalNotional);
  const reason   = buildExecutionReason(decision, input.vr_runtime_mode, ga.permission);

  return {
    execution_decision: decision,
    executed,
    partial,
    final_qty:      finalQty,
    final_notional: finalNotional,
    raw_qty,
    raw_notional,
    sizing_cap_pct: ga.sizing_cap_pct,
    execution_note: note,
    execution_reason: reason,
  };
}

// Alias for symmetry with applyVrActionPolicy naming
export const applyVrExecutionHook = buildVrExecutionHookResult;

// =============================================================================
// MULTI-ACTION PRIORITY RESOLVER
// =============================================================================

import { VR_ACTION_PRIORITY as PRIORITY_ORDER } from '../types/vrExecution';

export interface VrCandidateAction {
  action_class: VrActionClass;
  raw_qty?:     number;
  raw_notional?: number;
  raw_price?:   number;
}

export interface VrResolvedAction extends VrCandidateAction {
  priority_rank: number;
  suppressed:    boolean;
  suppression_reason?: string;
}

/**
 * Resolves priority ordering across a batch of candidate actions.
 * In LOCKDOWN / DEFENSIVE modes: offensive actions are suppressed
 * when a REDUCE_RISK action is present in the same cycle.
 */
export function resolveVrActionPriority(
  candidates: VrCandidateAction[],
  runtimeMode: string,
): VrResolvedAction[] {
  const hasReduceRisk = candidates.some(c => c.action_class === 'REDUCE_RISK');
  const defensiveModes = new Set(['LOCKDOWN', 'DEFENSIVE']);
  const offensiveClasses = new Set<VrActionClass>(['BASE_BUY', 'REBOUND_BUY', 'AGGRESSIVE_ADD']);

  return candidates
    .map(c => {
      const rank = PRIORITY_ORDER.indexOf(c.action_class);
      const priorityRank = rank === -1 ? 99 : rank;

      // In LOCKDOWN/DEFENSIVE, suppress offensive actions when REDUCE_RISK is active
      const suppressed =
        defensiveModes.has(runtimeMode) &&
        hasReduceRisk &&
        offensiveClasses.has(c.action_class);

      return {
        ...c,
        priority_rank:    priorityRank,
        suppressed,
        suppression_reason: suppressed
          ? `${c.action_class} suppressed in ${runtimeMode} mode — REDUCE_RISK takes priority this cycle`
          : undefined,
      };
    })
    .sort((a, b) => a.priority_rank - b.priority_rank);
}

// =============================================================================
// BUILD EXECUTION DEBUG RECORD
// =============================================================================

export function buildVrExecutionDebug(
  input: VrExecutionHookInput,
  result: VrExecutionHookResult,
): VrExecutionDebug {
  return {
    raw_action_class:   input.raw_action_class,
    raw_qty:            input.raw_qty,
    raw_notional:       input.raw_notional,
    permission:         input.gated_action.permission,
    blocked:            input.gated_action.blocked,
    limited:            input.gated_action.limited,
    sizing_cap_pct:     input.gated_action.sizing_cap_pct,
    execution_decision: result.execution_decision,
    final_qty:          result.final_qty,
    final_notional:     result.final_notional,
    execution_note:     result.execution_note,
    execution_reason:   result.execution_reason,
  };
}
