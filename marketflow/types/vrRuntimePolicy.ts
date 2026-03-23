import type { BridgeBuyBias, BridgePosture, BridgeReboundPermission } from './bridge';

// =============================================================================
// vrRuntimePolicy.ts  (WO-SA9)
//
// 목적: VR 런타임이 소비할 정책 게이트 결과 타입 정의
// vr_policy(SA8) → vr_runtime_policy(SA9) 변환 결과
// =============================================================================

export type VrRuntimeMode = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN';

export type VrGate = 'OPEN' | 'LIMITED' | 'BLOCKED';

export type VrRuntimePolicyResult = {
  runtime_mode: VrRuntimeMode;
  buy_gate: VrGate;
  rebound_gate: VrGate;
  add_exposure_gate: VrGate;
  sizing_bias: number;          // 0–100
  defensive_bias: number;       // 0–100
  continuation_pressure: number; // 0–100 (= continuation_bias pass-through)
  policy_applied: boolean;
  policy_source: 'VR_POLICY_PORT';
  runtime_reason: string;
  runtime_summary: string;
};

export type VrRuntimePolicyDebug = {
  runtime_mode_rule: string;
  buy_gate_rule: string;
  rebound_gate_rule: string;
  add_exposure_gate_rule: string;
  sizing_bias_rule: string;
};
