import type { ScenarioDebug, ScenarioPath, ScenarioResult } from '../types/scenario';
import type { SmartAnalyzerConfidence, SmartAnalyzerMarketType } from '../types/smartAnalyzer';

// =============================================================================
// scenarioEngine.ts  (WO-SA4)
//
// 목적: 현재 분석 결과 + 메모리 인사이트를 합산해 단기 forward path 확률 계산
// 분류(market_type)를 뒤집지 않는다. 순수하게 경로 확률만 추정.
//
// 원시 점수 구조:
//   rebound_raw      (max 100) — 이벤트 반등 신호 강도
//   continuation_raw (max 100) — 구조적 하락 지속 신호 강도
//   sideways_raw     (max 90)  — 혼합형 횡보 신호 강도
//
// 정규화 후 합계 = 100 보장.
// =============================================================================

export type ScenarioEngineInput = {
  market_type: SmartAnalyzerMarketType;
  confidence: SmartAnalyzerConfidence;
  macro_score: number;
  persistence_score: number;
  reaction_score: number;
  event_score: number;
  velocity_score: number;
  liquidity_score: number;
  credit_score: number;
  internals_score: number;
  // memory layer evidence
  memory_structural_probability: number;
  memory_rebound_probability: number;
  memory_continuation_probability: number;
};

// =============================================================================
// RAW PATH SCORE COMPUTATION
// =============================================================================

function computeReboundRaw(input: ScenarioEngineInput): number {
  let score = 0;

  // 분류 기여 (+25)
  if (input.market_type === 'EVENT') score += 25;

  // 이벤트 트리거 강도 (+20)
  if (input.event_score >= 60) score += 20;

  // 지속성 낮을수록 일회성 → 반등 유리 (+15)
  if (input.persistence_score <= 40) score += 15;

  // 하락 속도 완만 → 반등 여지 (+10)
  if (input.velocity_score <= 40) score += 10;

  // 유동성 스트레스 낮음 → 반등 지지 (+10)
  if (input.liquidity_score <= 40) score += 10;

  // 신용 스트레스 낮음 → 반등 지지 (+10)
  if (input.credit_score <= 40) score += 10;

  // 메모리 반등 확률 보강 (+15)
  if (input.memory_rebound_probability >= 60) score += 15;

  return Math.min(score, 100);
}

function computeContinuationRaw(input: ScenarioEngineInput): number {
  let score = 0;

  // 분류 기여 (+25)
  if (input.market_type === 'STRUCTURAL') score += 25;

  // 지속성 확인 (+20)
  if (input.persistence_score >= 60) score += 20;

  // 하락 속도 유지 → 추세 지속 (+15)
  if (input.velocity_score >= 60) score += 15;

  // 유동성 긴축 → 압력 지속 (+15)
  if (input.liquidity_score >= 60) score += 15;

  // 신용 스트레스 → 압력 지속 (+15)
  if (input.credit_score >= 60) score += 15;

  // 내부 지표 약세 → 표면 아래 손상 지속 (+10)
  if (input.internals_score >= 60) score += 10;

  // 메모리 지속 확률 보강 (+15)
  if (input.memory_continuation_probability >= 60) score += 15;

  return Math.min(score, 100);
}

function computeSidewaysRaw(
  input: ScenarioEngineInput,
  reboundRaw: number,
  continuationRaw: number,
): number {
  let score = 0;

  // HYBRID 분류 → 횡보 기본 편향 (+25)
  if (input.market_type === 'HYBRID') score += 25;

  // 중간 신뢰도 → 방향 불확실 (+10)
  if (input.confidence === 'MED') score += 10;

  // 반등·지속 모두 비지배적 → 횡보 가능성 (+20)
  if (reboundRaw < 50 && continuationRaw < 50) score += 20;

  // 메모리 신호 혼재 (반등·지속 모두 60 미만) → 불확실 (+15)
  const mixedMemory =
    input.memory_rebound_probability < 60 &&
    input.memory_continuation_probability < 60;
  if (mixedMemory) score += 15;

  // 속도 중간 구간 → 극단적 방향 결정 어려움 (+10)
  if (input.velocity_score >= 35 && input.velocity_score < 60) score += 10;

  // 신용·유동성 모두 임계치 미만 → 대형 이벤트 없음 (+10)
  if (input.credit_score < 60 && input.liquidity_score < 60) score += 10;

  return Math.min(score, 90);
}

// =============================================================================
// NORMALIZATION
// =============================================================================

function normalize(
  reboundRaw: number,
  sidewaysRaw: number,
  continuationRaw: number,
): { rebound: number; sideways: number; continuation: number } {
  const total = reboundRaw + sidewaysRaw + continuationRaw;

  if (total === 0) {
    return { rebound: 33, sideways: 34, continuation: 33 };
  }

  const rebound = Math.round((reboundRaw / total) * 100);
  const sideways = Math.round((sidewaysRaw / total) * 100);
  const continuation = 100 - rebound - sideways;

  // continuation 역산 → 음수 보호
  if (continuation < 0) {
    const excess = -continuation;
    if (sideways >= excess) {
      return { rebound, sideways: sideways - excess, continuation: 0 };
    }
    return { rebound: rebound - (excess - sideways), sideways: 0, continuation: 0 };
  }

  return { rebound, sideways, continuation };
}

// =============================================================================
// DOMINANT PATH SELECTION
// 동점 시 보수적 우선: SIDEWAYS > CONTINUATION > REBOUND
// =============================================================================

function selectDominant(
  rebound: number,
  sideways: number,
  continuation: number,
): ScenarioPath {
  const max = Math.max(rebound, sideways, continuation);
  const tied: ScenarioPath[] = [];
  if (rebound === max) tied.push('REBOUND');
  if (sideways === max) tied.push('SIDEWAYS');
  if (continuation === max) tied.push('CONTINUATION');

  if (tied.length === 1) return tied[0];
  if (tied.includes('SIDEWAYS')) return 'SIDEWAYS';
  if (tied.includes('CONTINUATION')) return 'CONTINUATION';
  return 'REBOUND';
}

// =============================================================================
// PATH SUMMARY — 한국어, 기관 투자자 어조
// =============================================================================

function buildPathSummary(
  dominant: ScenarioPath,
  input: ScenarioEngineInput,
  rebound: number,
  continuation: number,
): string {
  if (dominant === 'REBOUND') {
    if (input.confidence === 'HIGH' && input.event_score >= 60) {
      return '이벤트성 충격 이후 단기 반등 가능성이 높아 보입니다.';
    }
    if (continuation >= 30) {
      return '단기 반등 가능성이 있으나 추세 전환 확신은 아직 약합니다.';
    }
    return '반등 여지가 열려 있으나 거시 배경을 함께 확인해야 합니다.';
  }

  if (dominant === 'CONTINUATION') {
    if (input.confidence === 'HIGH') {
      return '구조적 압력이 남아 있어 추가 하락 지속 가능성이 더 큽니다.';
    }
    if (input.velocity_score >= 70) {
      return '하락 속도와 지속성 압력이 맞물려 추세 지속 쪽으로 무게가 실립니다.';
    }
    return '압력이 아직 남아 있어 단순 반등으로 끝나기 어렵습니다.';
  }

  // SIDEWAYS
  if (rebound >= 30 && continuation >= 30) {
    return '반등과 지속 압력이 균형을 이뤄 방향이 아직 결정되지 않았습니다.';
  }
  if (input.market_type === 'HYBRID') {
    return '횡보 후 방향 결정 가능성이 높아 보입니다.';
  }
  return '현재 신호가 혼재해 단기 방향 결정이 어려운 구간입니다.';
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function computeScenarioProbabilities(input: ScenarioEngineInput): {
  result: ScenarioResult;
  debug: ScenarioDebug;
} {
  const reboundRaw = computeReboundRaw(input);
  const continuationRaw = computeContinuationRaw(input);
  const sidewaysRaw = computeSidewaysRaw(input, reboundRaw, continuationRaw);

  const { rebound, sideways, continuation } = normalize(reboundRaw, sidewaysRaw, continuationRaw);
  const dominant = selectDominant(rebound, sideways, continuation);
  const summary = buildPathSummary(dominant, input, rebound, continuation);

  return {
    result: {
      rebound_probability: rebound,
      sideways_probability: sideways,
      continuation_probability: continuation,
      dominant_path: dominant,
      path_summary: summary,
    },
    debug: {
      rebound_raw: reboundRaw,
      sideways_raw: sidewaysRaw,
      continuation_raw: continuationRaw,
      dominant_path: dominant,
    },
  };
}
