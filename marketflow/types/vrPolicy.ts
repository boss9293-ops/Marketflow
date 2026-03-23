import type { BridgeBuyBias, BridgePosture, BridgeReboundPermission, BridgeRiskPressure } from './bridge';

// =============================================================================
// vrPolicy.ts  (WO-SA8)
//
// 목적: Smart Analyzer 포지처 신호를 VR이 안전하게 소비할 수 있는
//       결정론적(deterministic) 정책 포트 타입 정의
// =============================================================================

export type VrPolicyState = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

export type VrPolicyResult = {
  version: string;
  source: 'SMART_ANALYZER';
  posture_bias: BridgePosture;
  risk_pressure: BridgeRiskPressure;
  buy_bias: BridgeBuyBias;
  rebound_permission: BridgeReboundPermission;
  continuation_bias: number;   // 0–100
  rebound_bias: number;        // 0–100
  sideways_bias: number;       // 0–100
  structural_risk_flag: boolean;
  shock_flag: boolean;
  policy_state: VrPolicyState;
  caution_reason: string;
  policy_summary: string;
};

export type VrPolicyDebug = {
  policy_state_rule: string;
  structural_risk_rule: string;
  buy_bias_source: string;
  shock_flag_source: string;
};
