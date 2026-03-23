// =============================================================================
// vrExecution.ts  (WO-SA11)
//
// 목적: VR 실행 훅 — action policy 결과를 실제 실행 결정으로 변환
// =============================================================================

import type { VrActionClass } from './vrAction';
import type { VrRuntimeMode } from './vrRuntimePolicy';

export type VrExecutionDecision =
  | 'EXECUTE'
  | 'PARTIAL_EXECUTE'
  | 'SKIP'
  | 'PRIORITIZE_DEFENSE';

export type VrExecutionPermission = 'ALLOW' | 'LIMIT' | 'BLOCK' | 'PRIORITIZE';

export interface VrGatedActionInput {
  blocked:        boolean;
  limited:        boolean;
  sizing_cap_pct: number;
  note?:          string;
  permission:     VrExecutionPermission;
}

export interface VrExecutionHookInput {
  raw_action_class: VrActionClass;
  raw_qty?:         number;
  raw_notional?:    number;
  raw_price?:       number;
  vr_runtime_mode:  VrRuntimeMode;
  gated_action:     VrGatedActionInput;
}

export interface VrExecutionHookResult {
  execution_decision: VrExecutionDecision;
  executed:           boolean;
  partial:            boolean;
  final_qty?:         number;
  final_notional?:    number;
  raw_qty?:           number;
  raw_notional?:      number;
  sizing_cap_pct:     number;
  execution_note:     string;
  execution_reason:   string;
}

export interface VrExecutionDebug {
  raw_action_class:   VrActionClass;
  raw_qty?:           number;
  raw_notional?:      number;
  permission:         VrExecutionPermission;
  blocked:            boolean;
  limited:            boolean;
  sizing_cap_pct:     number;
  execution_decision: VrExecutionDecision;
  final_qty?:         number;
  final_notional?:    number;
  execution_note:     string;
  execution_reason:   string;
}

// Action priority ordering (lower index = higher priority)
export const VR_ACTION_PRIORITY: VrActionClass[] = [
  'REDUCE_RISK',
  'DEFENSIVE_BUY',
  'MAINTENANCE_BUY',
  'BASE_BUY',
  'REBOUND_BUY',
  'AGGRESSIVE_ADD',
  'HOLD',
];
