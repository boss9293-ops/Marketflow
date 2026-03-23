export type BridgePosture = 'OFFENSIVE' | 'BALANCED' | 'CAUTIOUS' | 'DEFENSIVE';

export type BridgeRiskPressure = 'LOW' | 'MED' | 'HIGH';

export type BridgeReboundPermission = 'OPEN' | 'LIMITED' | 'BLOCKED';

export type BridgeBuyBias = 'ALLOW' | 'LIMIT' | 'BLOCK';

export type BridgeMCBias = {
  rebound_weight: number;
  sideways_weight: number;
  continuation_weight: number;
};

export type BridgeVRHint = {
  posture_bias: BridgePosture;
  buy_bias: BridgeBuyBias;
  caution_reason: string;
};

export type BridgeResult = {
  posture: BridgePosture;
  risk_pressure: BridgeRiskPressure;
  rebound_permission: BridgeReboundPermission;
  continuation_bias: number;
  rebound_bias: number;
  sideways_bias: number;
  mc_bias: BridgeMCBias;
  vr_hint: BridgeVRHint;
  bridge_summary: string;
};

export type BridgeDebug = {
  posture_rule: string;
  risk_pressure_rule: string;
  rebound_permission_rule: string;
  mc_bias_source: string;
};
