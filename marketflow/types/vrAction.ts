// =============================================================================
// vrAction.ts  (WO-SA10)
//
// 목적: VR Runtime Policy → 명시적 액션 클래스별 허용/제한/차단 권한 모델
// =============================================================================

import type { VrRuntimeMode } from './vrRuntimePolicy';

export type VrActionClass =
  | 'BASE_BUY'
  | 'REBOUND_BUY'
  | 'AGGRESSIVE_ADD'
  | 'DEFENSIVE_BUY'
  | 'MAINTENANCE_BUY'
  | 'REDUCE_RISK'
  | 'HOLD';

export type VrActionPermission = 'ALLOW' | 'LIMIT' | 'BLOCK';

export type VrReduceRiskPermission = 'ALLOW' | 'PRIORITIZE';

export type VrActionPermissions = {
  base_buy:        VrActionPermission;
  rebound_buy:     VrActionPermission;
  aggressive_add:  VrActionPermission;
  defensive_buy:   VrActionPermission;
  maintenance_buy: VrActionPermission;
  reduce_risk:     VrReduceRiskPermission;
  hold:            'ALLOW';
};

export type VrActionSizingProfile = {
  base_buy_pct:        number;   // 0–100 runtime cap
  rebound_buy_pct:     number;
  aggressive_add_pct:  number;
  defensive_buy_pct:   number;
  maintenance_buy_pct: number;
};

export type VrActionPolicyResult = {
  runtime_mode:    VrRuntimeMode;
  permissions:     VrActionPermissions;
  sizing_profile:  VrActionSizingProfile;
  action_summary:  string;
  action_reason:   string;
};

export type VrActionPolicyDebug = {
  mode_rule:              string;
  gate_consistency_rule:  string;
  shock_override_rule:    string;
  structural_override_rule: string;
};

// Candidate action gating result
export type VrGatedAction = {
  action_class:    VrActionClass;
  permission:      VrActionPermission | VrReduceRiskPermission;
  sizing_cap_pct:  number;
  blocked:         boolean;
  limited:         boolean;
  note:            string;
};
