import type { VrPolicyResult } from '../types/vrPolicy';
import type {
  VrGate,
  VrRuntimeMode,
  VrRuntimePolicyDebug,
  VrRuntimePolicyResult,
} from '../types/vrRuntimePolicy';

// =============================================================================
// vrRuntimePolicyAdapter.ts  (WO-SA9)
//
// 목적: VR Policy Port 결과를 VR 런타임이 즉시 소비 가능한
//       실행 게이트 + 사이징 파라미터로 변환
//
// 규칙:
//   - 새로운 분류 로직 없음
//   - VrPolicyResult만 소비 (SmartAnalyzerResult 직접 참조 금지)
//   - 결정론적 매핑 전용
//   - 보수적 우선 (LOCKDOWN → DEFENSIVE → LIMITED → NORMAL)
// =============================================================================

// =============================================================================
// RUNTIME MODE
// =============================================================================

type RuntimeModeDecision = { mode: VrRuntimeMode; rule: string };

function resolveRuntimeMode(vp: VrPolicyResult): RuntimeModeDecision {
  // LOCKDOWN (most conservative)
  if (
    vp.policy_state === 'RED' &&
    (vp.shock_flag || vp.structural_risk_flag) &&
    vp.buy_bias === 'BLOCK'
  ) {
    return { mode: 'LOCKDOWN', rule: 'LOCKDOWN: RED+(shock|structural)+buy=BLOCK' };
  }

  // DEFENSIVE
  if (vp.policy_state === 'RED') {
    return { mode: 'DEFENSIVE', rule: 'DEFENSIVE: policy_state=RED' };
  }
  if (vp.posture_bias === 'DEFENSIVE') {
    return { mode: 'DEFENSIVE', rule: 'DEFENSIVE: posture_bias=DEFENSIVE' };
  }
  if (vp.continuation_bias >= 60) {
    return { mode: 'DEFENSIVE', rule: 'DEFENSIVE: continuation_bias>=60' };
  }

  // LIMITED
  if (vp.policy_state === 'ORANGE') {
    return { mode: 'LIMITED', rule: 'LIMITED: policy_state=ORANGE' };
  }
  if (vp.posture_bias === 'CAUTIOUS') {
    return { mode: 'LIMITED', rule: 'LIMITED: posture_bias=CAUTIOUS' };
  }
  if (vp.buy_bias === 'LIMIT') {
    return { mode: 'LIMITED', rule: 'LIMITED: buy_bias=LIMIT' };
  }

  // NORMAL
  return { mode: 'NORMAL', rule: 'NORMAL: fallback' };
}

// =============================================================================
// BUY GATE
// =============================================================================

type GateDecision = { gate: VrGate; rule: string };

function resolveBuyGate(buyBias: string): GateDecision {
  if (buyBias === 'ALLOW') return { gate: 'OPEN',    rule: 'buy_gate: buy_bias=ALLOW→OPEN' };
  if (buyBias === 'LIMIT') return { gate: 'LIMITED', rule: 'buy_gate: buy_bias=LIMIT→LIMITED' };
  return                          { gate: 'BLOCKED', rule: 'buy_gate: buy_bias=BLOCK→BLOCKED' };
}

// =============================================================================
// REBOUND GATE
// =============================================================================

function resolveReboundGate(reboundPermission: string): GateDecision {
  if (reboundPermission === 'OPEN')    return { gate: 'OPEN',    rule: 'rebound_gate: OPEN' };
  if (reboundPermission === 'LIMITED') return { gate: 'LIMITED', rule: 'rebound_gate: LIMITED' };
  return                                      { gate: 'BLOCKED', rule: 'rebound_gate: BLOCKED' };
}

// =============================================================================
// ADD EXPOSURE GATE
// =============================================================================

function resolveAddExposureGate(mode: VrRuntimeMode): GateDecision {
  if (mode === 'LOCKDOWN')  return { gate: 'BLOCKED', rule: 'add_exposure_gate: LOCKDOWN→BLOCKED' };
  if (mode === 'DEFENSIVE') return { gate: 'BLOCKED', rule: 'add_exposure_gate: DEFENSIVE→BLOCKED' };
  if (mode === 'LIMITED')   return { gate: 'LIMITED', rule: 'add_exposure_gate: LIMITED→LIMITED' };
  return                           { gate: 'OPEN',    rule: 'add_exposure_gate: NORMAL→OPEN' };
}

// =============================================================================
// SIZING BIAS  (0–100)
// =============================================================================

type NumberDecision = { value: number; rule: string };

function resolveSizingBias(
  mode: VrRuntimeMode,
  shockFlag: boolean,
  reboundBias: number,
  structuralRiskFlag: boolean,
): NumberDecision {
  if (mode === 'LOCKDOWN') {
    return { value: 0, rule: 'sizing_bias: LOCKDOWN→0' };
  }
  if (mode === 'DEFENSIVE') {
    const v = shockFlag ? Math.min(20, 20) : 20;
    return { value: v, rule: `sizing_bias: DEFENSIVE→${v}${shockFlag ? ' (shock_flag cap)' : ''}` };
  }
  if (mode === 'LIMITED') {
    return { value: 50, rule: 'sizing_bias: LIMITED→50' };
  }
  // NORMAL
  const base = reboundBias >= 50 ? 85 : 80;
  const v    = shockFlag ? Math.min(base, 20) : (structuralRiskFlag ? Math.min(base, 60) : base);
  return { value: v, rule: `sizing_bias: NORMAL→${v}` };
}

// =============================================================================
// DEFENSIVE BIAS  (0–100)
// =============================================================================

function resolveDefensiveBias(
  mode: VrRuntimeMode,
  shockFlag: boolean,
  structuralRiskFlag: boolean,
): NumberDecision {
  if (mode === 'LOCKDOWN') {
    return { value: 100, rule: 'defensive_bias: LOCKDOWN→100' };
  }
  if (mode === 'DEFENSIVE') {
    const v = shockFlag ? Math.max(80, 85) : 80;
    return { value: v, rule: `defensive_bias: DEFENSIVE→${v}` };
  }
  if (mode === 'LIMITED') {
    const v = shockFlag ? Math.max(50, 85) : (structuralRiskFlag ? Math.max(50, 70) : 50);
    return { value: v, rule: `defensive_bias: LIMITED→${v}` };
  }
  // NORMAL
  const v = shockFlag ? Math.max(20, 85) : (structuralRiskFlag ? Math.max(20, 70) : 20);
  return { value: v, rule: `defensive_bias: NORMAL→${v}` };
}

// =============================================================================
// RUNTIME REASON / SUMMARY
// =============================================================================

function buildRuntimeReason(mode: VrRuntimeMode, vp: VrPolicyResult): string {
  if (mode === 'LOCKDOWN') {
    return '충격 + 구조적 압력 + 매수 차단이 동시 발생해 모든 포지션 추가가 잠금 상태입니다.';
  }
  if (mode === 'DEFENSIVE') {
    if (vp.shock_flag) return '급락 속도 이상으로 방어 모드가 활성화되었습니다.';
    if (vp.continuation_bias >= 60) return '지속 하락 압력이 높아 방어 우선 실행 상태입니다.';
    return '정책 상태 RED로 방어 실행 모드가 적용됩니다.';
  }
  if (mode === 'LIMITED') {
    return '제한적 대응 범위 내에서만 진입이 허용됩니다.';
  }
  return '반등 여지가 열려 있어 정상 실행 모드입니다.';
}

function buildRuntimeSummary(mode: VrRuntimeMode): string {
  if (mode === 'LOCKDOWN')  return 'VR 런타임은 LOCKDOWN 상태로, 모든 매수·추가 진입이 차단됩니다.';
  if (mode === 'DEFENSIVE') return 'VR 런타임은 DEFENSIVE 상태로, 신규 매수는 최소화하고 방어 비중을 높입니다.';
  if (mode === 'LIMITED')   return 'VR 런타임은 LIMITED 상태로, 제한된 범위 내 대응만 허용됩니다.';
  return 'VR 런타임은 NORMAL 상태로, 정상 범위의 진입과 반등 대응이 가능합니다.';
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function buildVrRuntimePolicy(vrPolicy: VrPolicyResult): {
  result: VrRuntimePolicyResult;
  debug: VrRuntimePolicyDebug;
} {
  const { mode, rule: modeRule }             = resolveRuntimeMode(vrPolicy);
  const { gate: buyGate, rule: buyGateRule } = resolveBuyGate(vrPolicy.buy_bias);
  const { gate: reboundGate, rule: reboundGateRule } = resolveReboundGate(vrPolicy.rebound_permission);
  const { gate: addGate, rule: addGateRule }         = resolveAddExposureGate(mode);
  const { value: sizingBias, rule: sizingBiasRule }  = resolveSizingBias(
    mode, vrPolicy.shock_flag, vrPolicy.rebound_bias, vrPolicy.structural_risk_flag,
  );
  const { value: defensiveBias } = resolveDefensiveBias(
    mode, vrPolicy.shock_flag, vrPolicy.structural_risk_flag,
  );

  const runtimeReason  = buildRuntimeReason(mode, vrPolicy);
  const runtimeSummary = buildRuntimeSummary(mode);

  return {
    result: {
      runtime_mode:          mode,
      buy_gate:              buyGate,
      rebound_gate:          reboundGate,
      add_exposure_gate:     addGate,
      sizing_bias:           sizingBias,
      defensive_bias:        defensiveBias,
      continuation_pressure: vrPolicy.continuation_bias,
      policy_applied:        true,
      policy_source:         'VR_POLICY_PORT',
      runtime_reason:        runtimeReason,
      runtime_summary:       runtimeSummary,
    },
    debug: {
      runtime_mode_rule:       modeRule,
      buy_gate_rule:           buyGateRule,
      rebound_gate_rule:       reboundGateRule,
      add_exposure_gate_rule:  addGateRule,
      sizing_bias_rule:        sizingBiasRule,
    },
  };
}
