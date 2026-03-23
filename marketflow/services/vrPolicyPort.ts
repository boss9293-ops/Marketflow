import type { BridgePosture } from '../types/bridge';
import type { SmartAnalyzerMarketType, SmartAnalyzerResult } from '../types/smartAnalyzer';
import type { VrPolicyDebug, VrPolicyResult, VrPolicyState } from '../types/vrPolicy';

// =============================================================================
// vrPolicyPort.ts  (WO-SA8)
//
// 목적: Smart Analyzer 결과를 VR 소비 가능한 정책 포트로 변환
//
// 규칙:
//   - 새로운 분류 로직 없음
//   - VR 거래 실행 없음
//   - 결정론적 매핑 전용
//   - 버전 관리 포함
//
// policy_state 우선순위 (보수적 우선):
//   RED → ORANGE → YELLOW → GREEN
// =============================================================================

const VR_POLICY_VERSION = 'v1';

// =============================================================================
// POLICY STATE
// =============================================================================

type PolicyStateDecision = { state: VrPolicyState; rule: string };

function resolvePolicyState(
  posture: BridgePosture,
  buyBias: string,
  reboundPermission: string,
  riskPressure: string,
  continuationBias: number,
): PolicyStateDecision {
  // RED (most conservative — checked first)
  if (posture === 'DEFENSIVE') {
    return { state: 'RED', rule: 'RED: posture=DEFENSIVE' };
  }
  if (buyBias === 'BLOCK') {
    return { state: 'RED', rule: 'RED: buy_bias=BLOCK' };
  }
  if (reboundPermission === 'BLOCKED') {
    return { state: 'RED', rule: 'RED: rebound_permission=BLOCKED' };
  }
  if (riskPressure === 'HIGH') {
    return { state: 'RED', rule: 'RED: risk_pressure=HIGH' };
  }

  // ORANGE
  if (posture === 'CAUTIOUS') {
    return { state: 'ORANGE', rule: 'ORANGE: posture=CAUTIOUS' };
  }
  if (reboundPermission === 'LIMITED') {
    return { state: 'ORANGE', rule: 'ORANGE: rebound_permission=LIMITED' };
  }
  if (riskPressure === 'MED' && continuationBias >= 40) {
    return { state: 'ORANGE', rule: 'ORANGE: risk_pressure=MED+continuation_bias>=40' };
  }

  // YELLOW
  if (posture === 'BALANCED') {
    return { state: 'YELLOW', rule: 'YELLOW: posture=BALANCED' };
  }
  if (buyBias === 'LIMIT') {
    return { state: 'YELLOW', rule: 'YELLOW: buy_bias=LIMIT' };
  }

  // GREEN
  if (posture === 'OFFENSIVE' && buyBias === 'ALLOW' && reboundPermission === 'OPEN' && riskPressure === 'LOW') {
    return { state: 'GREEN', rule: 'GREEN: OFFENSIVE+ALLOW+OPEN+LOW' };
  }

  // Fallback
  return { state: 'YELLOW', rule: 'YELLOW: fallback' };
}

// =============================================================================
// STRUCTURAL RISK FLAG
// =============================================================================

type StructuralRiskDecision = { flag: boolean; rule: string };

function resolveStructuralRiskFlag(
  marketType: SmartAnalyzerMarketType,
  continuationBias: number,
  creditScore: number,
  liquidityScore: number,
): StructuralRiskDecision {
  if (marketType === 'STRUCTURAL') {
    return { flag: true, rule: 'market_type=STRUCTURAL' };
  }
  if (continuationBias >= 60) {
    return { flag: true, rule: 'continuation_bias>=60' };
  }
  if (creditScore >= 70) {
    return { flag: true, rule: 'credit_score>=70' };
  }
  if (liquidityScore >= 75) {
    return { flag: true, rule: 'liquidity_score>=75' };
  }
  return { flag: false, rule: 'no_structural_trigger' };
}

// =============================================================================
// CAUTION REASON
// =============================================================================

function buildCautionReason(
  state: VrPolicyState,
  shockFlag: boolean,
  structuralRiskFlag: boolean,
  continuationBias: number,
  sidewaysBias: number,
): string {
  if (state === 'RED') {
    if (shockFlag) {
      return '하락 속도 이상징후가 있어 반등 추격은 차단하는 편이 안전합니다.';
    }
    if (structuralRiskFlag) {
      return '구조적 압력이 높아 방어 우선으로 해석됩니다.';
    }
    return '리스크 지표가 임계치를 넘어 신규 매수는 차단 상태입니다.';
  }

  if (state === 'ORANGE') {
    if (continuationBias >= 40) {
      return '지속 하락 압력과 횡보 가능성이 높아 적극적 참여는 제한됩니다.';
    }
    return '이벤트성 반등 여지가 있으나 확인 전까지는 제한적 대응이 적절합니다.';
  }

  if (state === 'YELLOW') {
    if (sidewaysBias >= 40) {
      return '횡보 가능성이 높아 공격적 진입은 제한됩니다.';
    }
    return '확인 신호가 나오기 전까지는 균형 접근이 적절합니다.';
  }

  // GREEN
  return '반등 여지가 열려 있어 제한적 진입이 가능합니다.';
}

// =============================================================================
// POLICY SUMMARY
// =============================================================================

function buildPolicySummary(state: VrPolicyState): string {
  if (state === 'RED') {
    return 'VR는 현재 RED 정책 상태로, 신규 매수는 차단하고 방어 우선으로 해석하는 것이 적절합니다.';
  }
  if (state === 'ORANGE') {
    return '현재는 ORANGE 상태로, 제한적 대응은 가능하지만 적극적 매수는 보류하는 편이 맞습니다.';
  }
  if (state === 'YELLOW') {
    return '현재는 YELLOW 상태로, 구조적 붕괴 신호는 약하나 확인 중심 접근이 필요합니다.';
  }
  return '현재는 GREEN 상태로, 반등 참여가 열려 있습니다.';
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function buildVrPolicyPort(result: SmartAnalyzerResult): {
  result: VrPolicyResult;
  debug: VrPolicyDebug;
} {
  const { bridge, market_type, debug: dbg } = result;

  // Source fields
  const postureBias      = bridge.posture;
  const riskPressure     = bridge.risk_pressure;
  const buyBias          = bridge.vr_hint.buy_bias;
  const reboundPermission = bridge.rebound_permission;
  const continuationBias = bridge.continuation_bias;
  const reboundBias      = bridge.rebound_bias;
  const sidewaysBias     = bridge.sideways_bias;
  const creditScore      = dbg.credit_score;
  const liquidityScore   = dbg.liquidity_score;
  const shockFlag        = dbg.shock_flag;

  // Resolutions
  const { state: policyState, rule: policyStateRule }         = resolvePolicyState(postureBias, buyBias, reboundPermission, riskPressure, continuationBias);
  const { flag: structuralRiskFlag, rule: structuralRiskRule } = resolveStructuralRiskFlag(market_type, continuationBias, creditScore, liquidityScore);
  const cautionReason   = buildCautionReason(policyState, shockFlag, structuralRiskFlag, continuationBias, sidewaysBias);
  const policySummary   = buildPolicySummary(policyState);

  return {
    result: {
      version:              VR_POLICY_VERSION,
      source:               'SMART_ANALYZER',
      posture_bias:         postureBias,
      risk_pressure:        riskPressure,
      buy_bias:             buyBias,
      rebound_permission:   reboundPermission,
      continuation_bias:    continuationBias,
      rebound_bias:         reboundBias,
      sideways_bias:        sidewaysBias,
      structural_risk_flag: structuralRiskFlag,
      shock_flag:           shockFlag,
      policy_state:         policyState,
      caution_reason:       cautionReason,
      policy_summary:       policySummary,
    },
    debug: {
      policy_state_rule:   policyStateRule,
      structural_risk_rule: structuralRiskRule,
      buy_bias_source:     'bridge.vr_hint.buy_bias',
      shock_flag_source:   'analyzer.debug.shock_flag',
    },
  };
}
