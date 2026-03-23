import type { BridgePosture } from '../types/bridge';
import type {
  ResearchDeskEvidenceCard,
  ResearchDeskHeadline,
  ResearchDeskMemoryCard,
  ResearchDeskPayload,
  ResearchDeskPostureCard,
  ResearchDeskRegimeCard,
  ResearchDeskScenarioCard,
  ResearchDeskTone,
} from '../types/researchDesk';
import type { ScenarioPath } from '../types/scenario';
import type { SmartAnalyzerMarketType, SmartAnalyzerResult } from '../types/smartAnalyzer';

// =============================================================================
// researchDeskFormatter.ts  (WO-SA6)
//
// 목적: Smart Analyzer 출력을 dashboard / research desk 소비용 display payload로 변환
// 순수 포매팅·매핑 레이어 — 새로운 비즈니스 로직 없음, 점수 재계산 없음.
// =============================================================================

// =============================================================================
// HEADLINE
// =============================================================================

function buildTone(
  marketType: SmartAnalyzerMarketType,
  posture: BridgePosture,
  dominantPath: ScenarioPath,
): ResearchDeskTone {
  if (marketType === 'STRUCTURAL' && (posture === 'DEFENSIVE' || posture === 'CAUTIOUS')) {
    return 'RISK';
  }
  if (marketType === 'EVENT' && dominantPath === 'REBOUND' && posture !== 'DEFENSIVE') {
    return 'NEUTRAL';
  }
  return 'CAUTION';
}

function buildHeadlineTitle(
  marketType: SmartAnalyzerMarketType,
  posture: BridgePosture,
  dominantPath: ScenarioPath,
): string {
  if (marketType === 'STRUCTURAL') {
    if (posture === 'DEFENSIVE' || posture === 'CAUTIOUS') {
      return '구조적 리스크 압력이 남아 있습니다';
    }
    return '구조적 하락 압력이 감지됩니다';
  }

  if (marketType === 'EVENT') {
    if (dominantPath === 'REBOUND' && posture !== 'DEFENSIVE') {
      return '이벤트성 충격이지만 반등 가능성도 열려 있습니다';
    }
    return '이벤트성 충격이 시장에 영향을 주고 있습니다';
  }

  // HYBRID
  if (dominantPath === 'SIDEWAYS') {
    return '혼합 신호 구간으로 방향성 확신은 아직 제한적입니다';
  }
  if (dominantPath === 'CONTINUATION') {
    return '혼합 신호지만 하락 지속 가능성이 높아 주의가 필요합니다';
  }
  return '혼합 신호 구간이지만 단기 반등 가능성이 열려 있습니다';
}

function buildHeadline(result: SmartAnalyzerResult): ResearchDeskHeadline {
  const { market_type, bridge, scenario } = result;
  const posture = bridge.posture;
  const dominantPath = scenario.dominant_path;

  return {
    title: buildHeadlineTitle(market_type, posture, dominantPath),
    subtitle: `현재 분류: ${market_type} · 우세 경로: ${dominantPath} · 포지션 편향: ${posture}`,
    tone: buildTone(market_type, posture, dominantPath),
  };
}

// =============================================================================
// REGIME CARD
// =============================================================================

function buildRegimeCard(result: SmartAnalyzerResult): ResearchDeskRegimeCard {
  return {
    market_type: result.market_type,
    confidence: result.confidence,
    strategy: result.strategy,
    summary: result.summary,
  };
}

// =============================================================================
// SCENARIO CARD
// =============================================================================

function buildScenarioCardSummary(dominantPath: ScenarioPath): string {
  if (dominantPath === 'CONTINUATION') return '추가 하락 지속 가능성이 가장 우세합니다.';
  if (dominantPath === 'SIDEWAYS') return '횡보 후 방향 결정 가능성이 높아 보입니다.';
  return '반등 가능성이 열려 있으나 확인 과정이 더 필요합니다.';
}

function buildScenarioCard(result: SmartAnalyzerResult): ResearchDeskScenarioCard {
  const { scenario } = result;
  return {
    dominant_path: scenario.dominant_path,
    rebound_probability: scenario.rebound_probability,
    sideways_probability: scenario.sideways_probability,
    continuation_probability: scenario.continuation_probability,
    summary: buildScenarioCardSummary(scenario.dominant_path),
  };
}

// =============================================================================
// POSTURE CARD
// =============================================================================

function buildPostureCardSummary(posture: BridgePosture): string {
  if (posture === 'DEFENSIVE') return '방어 우선 구간으로 반등 참여는 현재 제한됩니다.';
  if (posture === 'CAUTIOUS') return '제한적 반등 참여는 가능하나 과도한 확신은 피해야 합니다.';
  if (posture === 'BALANCED') return '균형 대응 구간이며 공격적 진입보다 확인이 우선입니다.';
  return '이벤트성 반등 구간으로 제한적 진입은 가능합니다.';
}

function buildPostureCard(result: SmartAnalyzerResult): ResearchDeskPostureCard {
  const { bridge } = result;
  return {
    posture: bridge.posture,
    risk_pressure: bridge.risk_pressure,
    rebound_permission: bridge.rebound_permission,
    buy_bias: bridge.vr_hint.buy_bias,
    summary: buildPostureCardSummary(bridge.posture),
  };
}

// =============================================================================
// KEY POINTS
// =============================================================================

function buildKeyPoints(result: SmartAnalyzerResult): string[] {
  const points: string[] = [];
  const { market_type, scenario, bridge, memory, debug } = result;

  // 1. Regime driver
  if (market_type === 'STRUCTURAL') {
    points.push('구조적 압력이 우세한 국면으로 빠른 회복을 기대하기 어렵습니다.');
  } else if (market_type === 'EVENT') {
    points.push('이벤트성 충격이 주된 원인으로 거시 배경 추가 확인이 필요합니다.');
  } else {
    points.push('이벤트와 구조 압력이 혼재한 혼합형 국면입니다.');
  }

  // 2. Scenario driver
  if (scenario.dominant_path === 'CONTINUATION') {
    points.push(`단기 우세 경로는 추가 하락 지속(${scenario.continuation_probability}%)입니다.`);
  } else if (scenario.dominant_path === 'SIDEWAYS') {
    points.push(`단기 우세 경로는 횡보 후 관망(${scenario.sideways_probability}%)입니다.`);
  } else {
    points.push(`단기 우세 경로는 반등 가능성(${scenario.rebound_probability}%)이며 추가 확인이 필요합니다.`);
  }

  // 3. Posture driver
  points.push(`브리지 포지셔닝은 ${bridge.posture}로 해석됩니다.`);

  // 4. Memory driver (if available)
  if (memory.top_match) {
    const structuralDominant = memory.structural_probability > memory.rebound_probability;
    if (structuralDominant) {
      points.push('과거 유사 사례는 구조적 하락 지속 위험을 시사합니다.');
    } else {
      points.push('과거 유사 사례는 단기 반등 가능성을 부분적으로 지지합니다.');
    }
  }

  // 5. Elevated risk signal
  if (debug.velocity_score >= 75) {
    points.push('하락 속도 지표가 높아 단기 리스크 경계가 필요합니다.');
  } else if (debug.liquidity_score >= 60 || debug.credit_score >= 60) {
    points.push('유동성 또는 신용 스트레스 지표가 상승해 있습니다.');
  }

  return points.slice(0, 5);
}

// =============================================================================
// EVIDENCE CARD
// =============================================================================

function buildEvidenceCard(result: SmartAnalyzerResult): ResearchDeskEvidenceCard {
  const d = result.debug;
  const card: ResearchDeskEvidenceCard = {
    macro: d.macro_score,
    persistence: d.persistence_score,
    reaction: d.reaction_score,
    event: d.event_score,
    velocity: d.velocity_score,
  };
  if (d.liquidity_score > 0) card.liquidity = d.liquidity_score;
  if (d.credit_score > 0) card.credit = d.credit_score;
  if (d.internals_score > 0) card.internals = d.internals_score;
  return card;
}

// =============================================================================
// MEMORY CARD
// =============================================================================

function buildMemoryCard(result: SmartAnalyzerResult): ResearchDeskMemoryCard | undefined {
  const { memory } = result;
  if (!memory.top_match || memory.similarity === null) return undefined;

  const continuation_probability = Math.max(
    0,
    100 - memory.structural_probability - memory.rebound_probability,
  );
  const summary =
    memory.structural_probability > memory.rebound_probability
      ? '유사 과거 패턴은 구조적 지속 위험을 시사합니다.'
      : '과거 유사 사례는 단기 반등 가능성을 지지합니다.';

  return {
    top_match: memory.top_match,
    similarity_score: memory.similarity,
    structural_probability: memory.structural_probability,
    rebound_probability: memory.rebound_probability,
    continuation_probability,
    summary,
  };
}

// =============================================================================
// RESEARCH NOTE
// =============================================================================

function buildResearchNote(result: SmartAnalyzerResult): string {
  const { market_type, scenario, bridge, memory } = result;
  const sentences: string[] = [];

  // S1: regime
  if (market_type === 'STRUCTURAL') {
    sentences.push('현재 구간은 구조적 압력이 남아 있는 것으로 해석됩니다.');
  } else if (market_type === 'EVENT') {
    sentences.push('현재 구간은 이벤트성 충격이 주된 원인으로 작용하고 있습니다.');
  } else {
    sentences.push('현재 구간은 이벤트와 구조 압력이 혼재하는 혼합형 국면입니다.');
  }

  // S2: scenario
  if (scenario.dominant_path === 'CONTINUATION') {
    sentences.push('단기 우세 경로도 추가 하락 지속 쪽에 더 가깝습니다.');
  } else if (scenario.dominant_path === 'SIDEWAYS') {
    sentences.push('단기적으로는 방향성이 결정되지 않은 횡보 가능성이 더 높습니다.');
  } else {
    sentences.push('단기적으로는 반등 가능성이 열려 있으나 추가 확인이 필요합니다.');
  }

  // S3: posture
  if (bridge.posture === 'DEFENSIVE') {
    sentences.push('따라서 브리지 포지셔닝은 방어 우선으로 보는 것이 적절합니다.');
  } else if (bridge.posture === 'CAUTIOUS') {
    sentences.push('따라서 브리지 포지셔닝은 신중한 접근이 권고됩니다.');
  } else if (bridge.posture === 'BALANCED') {
    sentences.push('따라서 균형 잡힌 포지셔닝이 현재 상황에 적절합니다.');
  } else {
    sentences.push('따라서 브리지 포지셔닝은 제한적 공격 참여도 가능한 구간으로 봅니다.');
  }

  // S4: memory (if additive)
  if (memory.top_match) {
    const structuralDominant = memory.structural_probability > memory.rebound_probability;
    if (structuralDominant && bridge.posture === 'DEFENSIVE') {
      sentences.push('과거 유사 패턴도 현재 방어 편향을 지지합니다.');
    } else if (!structuralDominant && bridge.posture !== 'DEFENSIVE') {
      sentences.push('과거 유사 사례는 단기 반등 가능성을 부분적으로 지지합니다.');
    }
  }

  return sentences.join(' ');
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function formatResearchDeskPayload(result: SmartAnalyzerResult): ResearchDeskPayload {
  return {
    headline: buildHeadline(result),
    regime_card: buildRegimeCard(result),
    scenario_card: buildScenarioCard(result),
    posture_card: buildPostureCard(result),
    key_points: buildKeyPoints(result),
    evidence_card: buildEvidenceCard(result),
    memory_card: buildMemoryCard(result),
    research_note: buildResearchNote(result),
  };
}
