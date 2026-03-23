import type {
  BridgeBuyBias,
  BridgeDebug,
  BridgePosture,
  BridgeReboundPermission,
  BridgeRiskPressure,
  BridgeResult,
} from '../types/bridge';
import type { ScenarioPath } from '../types/scenario';
import type { SmartAnalyzerMarketType, SmartAnalyzerStrategy } from '../types/smartAnalyzer';

// =============================================================================
// bridgeEngine.ts  (WO-SA5)
//
// 목적: Smart Analyzer 출력을 MC·VR 하위 시스템용 포지처 정책 신호로 변환
// 분류·시나리오 확률은 변경하지 않는다.
//
// 포지처 결정 순서 (보수적 우선):
//   Rule A → DEFENSIVE
//   Rule B → CAUTIOUS
//   Rule C → BALANCED
//   Rule D → OFFENSIVE
//   Fallback → BALANCED
// =============================================================================

export type BridgeEngineInput = {
  market_type: SmartAnalyzerMarketType;
  strategy: SmartAnalyzerStrategy;
  velocity_score: number;
  credit_score: number;
  liquidity_score: number;
  internals_score: number;
  persistence_score: number;
  continuation_probability: number;
  rebound_probability: number;
  sideways_probability: number;
  dominant_path: ScenarioPath;
};

// =============================================================================
// POSTURE RESOLUTION (WO §7)
// =============================================================================

type PostureDecision = { posture: BridgePosture; rule: string };

function resolvePosture(input: BridgeEngineInput): PostureDecision {
  const {
    strategy, market_type, velocity_score, credit_score,
    liquidity_score, internals_score, persistence_score,
    continuation_probability, dominant_path,
  } = input;

  // Rule A — DEFENSIVE (보수적 우선 첫 번째 검사)
  if (strategy === 'DEFENSIVE') {
    return { posture: 'DEFENSIVE', rule: 'Rule A: strategy=DEFENSIVE' };
  }
  if (continuation_probability >= 65) {
    return { posture: 'DEFENSIVE', rule: 'Rule A: continuation_probability>=65' };
  }
  if (velocity_score >= 80) {
    return { posture: 'DEFENSIVE', rule: 'Rule A: velocity_score>=80' };
  }
  if (market_type === 'STRUCTURAL' && (credit_score >= 70 || liquidity_score >= 75)) {
    return { posture: 'DEFENSIVE', rule: 'Rule A: STRUCTURAL+credit/liquidity_stress' };
  }

  // Rule B — CAUTIOUS
  if (market_type === 'STRUCTURAL') {
    return { posture: 'CAUTIOUS', rule: 'Rule B: market_type=STRUCTURAL' };
  }
  if (continuation_probability >= 50) {
    return { posture: 'CAUTIOUS', rule: 'Rule B: continuation_probability>=50' };
  }
  if (internals_score >= 60) {
    return { posture: 'CAUTIOUS', rule: 'Rule B: internals_score>=60' };
  }
  if (persistence_score >= 60) {
    return { posture: 'CAUTIOUS', rule: 'Rule B: persistence_score>=60' };
  }

  // Rule C — BALANCED
  if (market_type === 'HYBRID') {
    return { posture: 'BALANCED', rule: 'Rule C: market_type=HYBRID' };
  }
  if (dominant_path === 'SIDEWAYS') {
    return { posture: 'BALANCED', rule: 'Rule C: dominant_path=SIDEWAYS' };
  }

  // Rule D — OFFENSIVE
  if (
    market_type === 'EVENT' &&
    dominant_path === 'REBOUND' &&
    velocity_score < 60 &&
    credit_score < 50 &&
    liquidity_score < 50
  ) {
    return { posture: 'OFFENSIVE', rule: 'Rule D: EVENT+REBOUND+low_stress' };
  }

  // Fallback
  return { posture: 'BALANCED', rule: 'Fallback: BALANCED' };
}

// =============================================================================
// RISK PRESSURE (WO §8)
// =============================================================================

type RiskPressureDecision = { level: BridgeRiskPressure; rule: string };

function resolveRiskPressure(input: BridgeEngineInput): RiskPressureDecision {
  const { continuation_probability, velocity_score, credit_score, liquidity_score, internals_score, persistence_score } = input;

  if (continuation_probability >= 60) return { level: 'HIGH', rule: 'HIGH: continuation_probability>=60' };
  if (velocity_score >= 75) return { level: 'HIGH', rule: 'HIGH: velocity_score>=75' };
  if (credit_score >= 70) return { level: 'HIGH', rule: 'HIGH: credit_score>=70' };
  if (liquidity_score >= 75) return { level: 'HIGH', rule: 'HIGH: liquidity_score>=75' };

  if (continuation_probability >= 40) return { level: 'MED', rule: 'MED: continuation_probability>=40' };
  if (internals_score >= 50) return { level: 'MED', rule: 'MED: internals_score>=50' };
  if (persistence_score >= 50) return { level: 'MED', rule: 'MED: persistence_score>=50' };

  return { level: 'LOW', rule: 'LOW: no_elevated_signals' };
}

// =============================================================================
// REBOUND PERMISSION (WO §9)
// =============================================================================

type ReboundPermissionDecision = { permission: BridgeReboundPermission; rule: string };

function resolveReboundPermission(
  posture: BridgePosture,
  dominant_path: ScenarioPath,
  continuation_probability: number,
): ReboundPermissionDecision {
  if (posture === 'DEFENSIVE') {
    return { permission: 'BLOCKED', rule: 'BLOCKED: posture=DEFENSIVE' };
  }
  if (dominant_path === 'REBOUND' && continuation_probability < 40) {
    return { permission: 'OPEN', rule: 'OPEN: dominant=REBOUND+continuation<40' };
  }
  return { permission: 'LIMITED', rule: 'LIMITED: default' };
}

// =============================================================================
// BUY BIAS MAPPING
// =============================================================================

function resolveBuyBias(posture: BridgePosture): BridgeBuyBias {
  if (posture === 'OFFENSIVE') return 'ALLOW';
  if (posture === 'DEFENSIVE') return 'BLOCK';
  return 'LIMIT';  // BALANCED, CAUTIOUS
}

// =============================================================================
// VR CAUTION REASON (한국어)
// =============================================================================

function buildCautionReason(
  posture: BridgePosture,
  dominant_path: ScenarioPath,
  input: BridgeEngineInput,
): string {
  if (posture === 'DEFENSIVE') {
    if (input.continuation_probability >= 65) {
      return '구조적 하락 지속 가능성이 높아 방어 우선입니다.';
    }
    if (input.velocity_score >= 80) {
      return '하락 속도가 극단적이라 즉각적 방어가 필요합니다.';
    }
    return '구조적 압력과 전략적 판단 모두 방어 포지처를 지지합니다.';
  }
  if (posture === 'CAUTIOUS') {
    if (input.persistence_score >= 60) {
      return '지속 압력이 남아 있어 공격적 참여는 제한합니다.';
    }
    if (input.internals_score >= 60) {
      return '하락 속도와 지속 압력이 병존해 신중한 접근이 필요합니다.';
    }
    return '압력이 완전히 해소되지 않아 보수적 접근이 적절합니다.';
  }
  if (posture === 'BALANCED') {
    if (dominant_path === 'SIDEWAYS') {
      return '횡보 가능성이 높아 공격적 진입은 제한합니다.';
    }
    return '혼합형 신호로 균형적 접근이 적절합니다.';
  }
  // OFFENSIVE
  return '이벤트성 반등 여지가 있어 제한적 진입은 가능합니다.';
}

// =============================================================================
// BRIDGE SUMMARY (한국어, 기관 투자자 어조)
// =============================================================================

function buildBridgeSummary(
  posture: BridgePosture,
  dominant_path: ScenarioPath,
  rebound_permission: BridgeReboundPermission,
): string {
  if (posture === 'DEFENSIVE') {
    return '구조적 압력이 강해 MC와 VR 모두 보수적 편향으로 해석하는 것이 맞습니다.';
  }
  if (posture === 'CAUTIOUS') {
    if (rebound_permission === 'LIMITED' && dominant_path === 'REBOUND') {
      return '단기 반등 여지는 있으나 방어 우위 구간으로 보수적 접근이 우선합니다.';
    }
    return '단기적으로는 방어 우위 구간으로 해석되며, 반등 참여는 제한적으로 보는 것이 적절합니다.';
  }
  if (posture === 'BALANCED') {
    if (dominant_path === 'REBOUND') {
      return '반등 시나리오가 우세하지만 과도한 확신보다는 균형적 대응이 적절합니다.';
    }
    if (dominant_path === 'SIDEWAYS') {
      return '방향성이 아직 결정되지 않아 중립적 포지션 유지가 적절합니다.';
    }
    return '혼합형 국면으로 균형적 접근이 적절합니다.';
  }
  // OFFENSIVE
  return '이벤트성 반등 국면으로 보이며, MC와 VR 모두 반등 편향으로 접근할 수 있습니다.';
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function computeBridgeSignal(input: BridgeEngineInput): {
  result: BridgeResult;
  debug: BridgeDebug;
} {
  const { posture, rule: postureRule } = resolvePosture(input);
  const { level: riskPressure, rule: riskRule } = resolveRiskPressure(input);
  const { permission: reboundPermission, rule: reboundRule } = resolveReboundPermission(
    posture,
    input.dominant_path,
    input.continuation_probability,
  );
  const buyBias = resolveBuyBias(posture);
  const cautionReason = buildCautionReason(posture, input.dominant_path, input);
  const bridgeSummary = buildBridgeSummary(posture, input.dominant_path, reboundPermission);

  // MC bias: v1 = 1:1 mapping from scenario probabilities (투명성 우선)
  const mcBias = {
    rebound_weight: input.rebound_probability,
    sideways_weight: input.sideways_probability,
    continuation_weight: input.continuation_probability,
  };

  return {
    result: {
      posture,
      risk_pressure: riskPressure,
      rebound_permission: reboundPermission,
      continuation_bias: input.continuation_probability,
      rebound_bias: input.rebound_probability,
      sideways_bias: input.sideways_probability,
      mc_bias: mcBias,
      vr_hint: {
        posture_bias: posture,
        buy_bias: buyBias,
        caution_reason: cautionReason,
      },
      bridge_summary: bridgeSummary,
    },
    debug: {
      posture_rule: postureRule,
      risk_pressure_rule: riskRule,
      rebound_permission_rule: reboundRule,
      mc_bias_source: 'scenario_probability_direct_v1',
    },
  };
}
