import type { BridgeBuyBias, BridgePosture, BridgeReboundPermission, BridgeRiskPressure } from './bridge';
import type { ScenarioPath } from './scenario';
import type { SmartAnalyzerConfidence, SmartAnalyzerMarketType, SmartAnalyzerStrategy } from './smartAnalyzer';

// =============================================================================
// researchDesk.ts  (WO-SA6)
//
// 목적: Smart Analyzer 결과를 dashboard / research desk 소비용 display 구조로 정의
// 이 타입들은 formatter 전용이며 엔진 로직을 포함하지 않는다.
// =============================================================================

export type ResearchDeskTone = 'NEUTRAL' | 'CAUTION' | 'RISK';

export type ResearchDeskHeadline = {
  title: string;
  subtitle: string;
  tone: ResearchDeskTone;
};

export type ResearchDeskRegimeCard = {
  market_type: SmartAnalyzerMarketType;
  confidence: SmartAnalyzerConfidence;
  strategy: SmartAnalyzerStrategy;
  summary: string;
};

export type ResearchDeskScenarioCard = {
  dominant_path: ScenarioPath;
  rebound_probability: number;
  sideways_probability: number;
  continuation_probability: number;
  summary: string;
};

export type ResearchDeskPostureCard = {
  posture: BridgePosture;
  risk_pressure: BridgeRiskPressure;
  rebound_permission: BridgeReboundPermission;
  buy_bias: BridgeBuyBias;
  summary: string;
};

export type ResearchDeskEvidenceCard = {
  macro: number;
  persistence: number;
  reaction: number;
  event: number;
  velocity: number;
  liquidity?: number;
  credit?: number;
  internals?: number;
};

export type ResearchDeskMemoryCard = {
  top_match: string;
  similarity_score: number;
  structural_probability: number;
  rebound_probability: number;
  continuation_probability: number;
  summary: string;
};

export type ResearchDeskPayload = {
  headline: ResearchDeskHeadline;
  regime_card: ResearchDeskRegimeCard;
  scenario_card: ResearchDeskScenarioCard;
  posture_card: ResearchDeskPostureCard;
  key_points: string[];
  evidence_card: ResearchDeskEvidenceCard;
  memory_card?: ResearchDeskMemoryCard;
  research_note: string;
};
