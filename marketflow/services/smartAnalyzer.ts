import { loadEnginePrompt } from './promptLoader';
import {
  buildMemoryInterpretation,
  buildMemoryKeyDrivers,
  findSimilarCases,
} from './memoryEngine';
import { computeScenarioProbabilities } from './scenarioEngine';
import { computeBridgeSignal } from './bridgeEngine';
import { formatResearchDeskPayload } from './researchDeskFormatter';
import { buildVrPolicyPort } from './vrPolicyPort';
import { buildVrRuntimePolicy } from './vrRuntimePolicyAdapter';
import { buildVrActionPolicy } from './vrActionModel';
import type {
  SmartAnalyzerConfidence,
  SmartAnalyzerDebug,
  SmartAnalyzerInput,
  SmartAnalyzerMarketType,
  SmartAnalyzerResult,
  SmartAnalyzerStrategy,
} from '../types/smartAnalyzer';
import type { SmartAnalyzerMemoryDebug, SmartAnalyzerMemorySummary } from '../types/memory';

const SMART_ANALYZER_PROMPT_FILE = 'smart_market_analyzer.md';

// Placeholder thresholds are intentionally simple and transparent for v1.
const HY_OAS_STRESS_THRESHOLD = 4.5;
const IG_SPREAD_STRESS_THRESHOLD = 1.75;
const RRP_DRAIN_PROXY_THRESHOLD = 0.5;

const NEGATIVE_MACRO_KEYWORDS = [
  'inflation',
  'sticky',
  'hot cpi',
  'hot ppi',
  'higher for longer',
  'restrictive',
  'tightening',
  'hawkish',
  'slowdown',
  'recession',
  'stagnation',
  'jobless',
  'labor weakness',
  'policy pressure',
  'liquidity stress',
];

const POSITIVE_MACRO_KEYWORDS = [
  'cooling',
  'disinflation',
  'easing',
  'dovish',
  'stabilizing',
  'soft landing',
  'improving',
];

const WORSENING_KEYWORDS = [
  'worsening',
  'deteriorating',
  'persistent',
  'ongoing',
  'structural',
  'higher for longer',
  'tightening',
];

const PERSISTENCE_KEYWORDS = [
  'persistent',
  'ongoing',
  'structural',
  'repeated',
  'failed rally',
  'rolling',
  'continuing',
  'broadening',
  'deteriorating',
  'multi-week',
  'risk-off confirmed',
];

const SHARP_REACTION_KEYWORDS = [
  'panic',
  'capitulation',
  'gap lower',
  'gap down',
  'washout',
  'selloff',
  'air pocket',
  'shock',
  'violent',
  'breakdown',
  'drawdown',
];

const REBOUND_KEYWORDS = [
  'rebound',
  'snapback',
  'oversold',
  'relief rally',
  'stabilizing',
  'bounce',
];

const EVENT_KEYWORDS = [
  'war',
  'attack',
  'invasion',
  'tariff',
  'sanction',
  'banking',
  'bank run',
  'pandemic',
  'earthquake',
  'election',
  'downgrade',
  'emergency',
  'policy headline',
  'geopolitical',
  'headline shock',
];

const ONE_OFF_EVENT_KEYWORDS = [
  'sudden',
  'one-off',
  'isolated',
  'headline',
  'emergency',
  'surprise',
  'temporary',
];

type ScoreDetail = {
  score: number;
  reasons: string[];
};

type ScoreState = Omit<SmartAnalyzerDebug, 'classification_reason'>;

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function countDistinctMatches(text: string, keywords: string[]): number {
  return keywords.filter((keyword) => text.includes(keyword)).length;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function pushUnique(items: string[], value: string): void {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function normalizeLevel(level: string | undefined): string {
  return normalizeText(level);
}

function hasReboundSignal(input: SmartAnalyzerInput): boolean {
  const combined = `${normalizeText(input.price_state)} ${normalizeText(input.vr_state)}`.trim();
  return includesAny(combined, REBOUND_KEYWORDS);
}

function scoreMacro(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const macroState = normalizeText(input.macro_state);
  const macroTrend = normalizeText(input.macro_trend);
  const macroText = `${macroState} ${macroTrend}`.trim();

  let score = 0;
  const negativeMatchCount = countDistinctMatches(macroText, NEGATIVE_MACRO_KEYWORDS);
  const positiveMatchCount = countDistinctMatches(macroText, POSITIVE_MACRO_KEYWORDS);

  if (negativeMatchCount > 0) {
    score += Math.min(negativeMatchCount * 12, 36);
    pushUnique(reasons, '인플레이션·긴축·경기둔화 신호가 거시 압력을 높입니다.');
  }

  if (includesAny(macroTrend, WORSENING_KEYWORDS)) {
    score += 20;
    pushUnique(reasons, 'macro_trend가 악화 방향이라 구조 압력이 이어질 가능성이 큽니다.');
  }

  if (input.rates.us10y >= 4.75) {
    score += 18;
    pushUnique(reasons, 'US10Y가 높은 구간이라 할인율 부담이 큽니다.');
  } else if (input.rates.us10y >= 4.25) {
    score += 12;
    pushUnique(reasons, 'US10Y가 주식 밸류에이션에 부담을 줍니다.');
  } else if (input.rates.us10y >= 3.75) {
    score += 6;
    pushUnique(reasons, 'US10Y가 중립보다 높은 수준입니다.');
  }

  if (input.rates.us2y >= 5.0) {
    score += 16;
    pushUnique(reasons, 'US2Y가 높아 단기 정책 긴축 신호가 강합니다.');
  } else if (input.rates.us2y >= 4.5) {
    score += 10;
    pushUnique(reasons, 'US2Y가 단기 정책 부담을 시사합니다.');
  } else if (input.rates.us2y >= 4.0) {
    score += 5;
    pushUnique(reasons, 'US2Y가 아직 완화적이라고 보기 어렵습니다.');
  }

  if (input.rates.spread <= -0.5) {
    score += 14;
    pushUnique(reasons, '장단기 금리 스프레드 악화가 구조 압력을 보강합니다.');
  } else if (input.rates.spread <= -0.2) {
    score += 10;
    pushUnique(reasons, '장단기 금리 역전이 경기 둔화 우려를 지지합니다.');
  } else if (input.rates.spread < 0) {
    score += 5;
    pushUnique(reasons, '스프레드가 마이너스라 경기 민감 자산에 부담입니다.');
  }

  if (positiveMatchCount > 0) {
    score -= Math.min(positiveMatchCount * 8, 16);
    pushUnique(reasons, '일부 완화 신호가 있어 거시 점수는 조정됩니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scorePersistence(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const priceState = normalizeText(input.price_state);
  const vrState = normalizeText(input.vr_state);
  const macroTrend = normalizeText(input.macro_trend);
  const combined = `${priceState} ${vrState} ${macroTrend}`.trim();

  let score = 0;
  const persistenceMatchCount = countDistinctMatches(combined, PERSISTENCE_KEYWORDS);

  if (persistenceMatchCount > 0) {
    score += Math.min(persistenceMatchCount * 12, 36);
    pushUnique(reasons, '반복 하락 압력 또는 지속성 신호가 감지됩니다.');
  }

  if (includesAny(combined, ['failed rally', 'rolling', 'breakdown', 'risk-off confirmed'])) {
    score += 25;
    pushUnique(reasons, '반등 실패 또는 rolling weakness가 확인됩니다.');
  }

  if (includesAny(macroTrend, WORSENING_KEYWORDS)) {
    score += 15;
    pushUnique(reasons, 'macro_trend가 악화 방향이라 압력의 지속성이 높습니다.');
  }

  if (normalizeLevel(input.volatility.level) === 'high' || (input.volatility.vix ?? 0) >= 28) {
    score += 10;
    pushUnique(reasons, '높은 변동성이 단기 이벤트보다 오래 남을 수 있습니다.');
  }

  if (includesAny(combined, REBOUND_KEYWORDS)) {
    score -= 15;
    pushUnique(reasons, '반등 여지가 있어 persistence 점수는 일부 낮아집니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreReaction(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const priceState = normalizeText(input.price_state);
  const vrState = normalizeText(input.vr_state);
  const volatilityLevel = normalizeLevel(input.volatility.level);

  let score = 0;

  if (input.volatility.spike) {
    score += 25;
    pushUnique(reasons, '변동성 spike가 즉각적인 스트레스 반응을 보여줍니다.');
  }

  if ((input.volatility.vix ?? 0) >= 35) {
    score += 30;
    pushUnique(reasons, 'VIX가 극단적 스트레스 구간입니다.');
  } else if ((input.volatility.vix ?? 0) >= 25) {
    score += 20;
    pushUnique(reasons, 'VIX가 높은 수준이라 시장 반응이 강합니다.');
  } else if ((input.volatility.vix ?? 0) >= 18 || volatilityLevel === 'elevated') {
    score += 10;
    pushUnique(reasons, 'VIX가 평시보다 높아 반응 강도가 올라갑니다.');
  }

  if (includesAny(priceState, SHARP_REACTION_KEYWORDS)) {
    score += 25;
    pushUnique(reasons, '급락과 패닉형 가격 반응이 감지됩니다.');
  }

  if (includesAny(vrState, ['risk-off', 'washout', 'stress'])) {
    score += 10;
    pushUnique(reasons, 'vr_state가 스트레스성 시장 반응을 확인합니다.');
  }

  if (hasReboundSignal(input)) {
    score += 10;
    pushUnique(reasons, '급락 뒤 반등 가능성도 함께 열려 있습니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreEvent(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const newsText = input.news_summary.map((item) => normalizeText(item)).join(' ');
  const priceState = normalizeText(input.price_state);

  let score = 0;
  const matchedEventTerms = countDistinctMatches(newsText, EVENT_KEYWORDS);
  const matchedOneOffTerms = countDistinctMatches(newsText, ONE_OFF_EVENT_KEYWORDS);

  if (matchedEventTerms > 0) {
    score += Math.min(matchedEventTerms * 20, 60);
    pushUnique(reasons, '식별 가능한 이벤트 트리거가 존재합니다.');
  }

  if (matchedOneOffTerms > 0) {
    score += Math.min(matchedOneOffTerms * 8, 16);
    pushUnique(reasons, 'one-off 뉴스 트리거 성격이 확인됩니다.');
  }

  if (input.volatility.spike && matchedEventTerms > 0) {
    score += 10;
    pushUnique(reasons, '뉴스 트리거와 시장 충격이 같은 구간에서 맞물립니다.');
  }

  if (includesAny(priceState, ['gap lower', 'panic', 'washout', 'shock']) && matchedEventTerms > 0) {
    score += 10;
    pushUnique(reasons, '이벤트 직후 sharp reaction이 나타납니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreVelocity(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const dd3 = input.drawdown?.dd3;
  const dd5 = input.drawdown?.dd5;
  const peakDd = input.drawdown?.peak_dd;

  let score = 0;

  if (typeof dd3 === 'number' && dd3 <= -0.08) {
    score += 40;
    pushUnique(reasons, 'dd3가 -8% 이하라 단기 하락 속도가 빠릅니다.');
  }

  if (typeof dd5 === 'number' && dd5 <= -0.12) {
    score += 40;
    pushUnique(reasons, 'dd5가 -12% 이하라 단기 누적 훼손이 큽니다.');
  }

  if (typeof peakDd === 'number' && peakDd <= -0.15) {
    score += 10;
    pushUnique(reasons, 'peak_dd가 깊어 속도 충격이 잡음 수준을 넘습니다.');
  }

  if (typeof dd3 === 'number' && typeof dd5 === 'number' && dd3 <= -0.08 && dd5 <= -0.12) {
    score += 10;
    pushUnique(reasons, 'dd3와 dd5가 동시에 악화되어 가속 하락 신호가 강화됩니다.');
  }

  if (typeof dd3 === 'number' && typeof dd5 === 'number' && dd5 < 0 && dd3 <= dd5 * 0.8) {
    score += 10;
    pushUnique(reasons, '근접 구간 하락 속도가 둔화되지 않아 추가 경계가 필요합니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreLiquidity(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const liquidity = input.liquidity;

  if (!liquidity) {
    return { score: 0, reasons };
  }

  let score = 0;
  let restrictiveCount = 0;

  if (liquidity.fed_balance_sheet_trend === 'SHRINKING') {
    score += 30;
    restrictiveCount += 1;
    pushUnique(reasons, '연준 대차대조표 축소가 유동성 환경을 긴축적으로 만듭니다.');
  }

  if (liquidity.m2_trend === 'DOWN') {
    score += 25;
    restrictiveCount += 1;
    pushUnique(reasons, 'M2 감소가 유동성 지원 여력을 약화시킵니다.');
  }

  if (liquidity.tga_trend === 'UP') {
    score += 20;
    restrictiveCount += 1;
    pushUnique(reasons, 'TGA 증가가 시장 유동성 흡수 압력을 높입니다.');
  }

  if (
    typeof liquidity.rrp === 'number' &&
    liquidity.rrp <= RRP_DRAIN_PROXY_THRESHOLD &&
    restrictiveCount >= 1
  ) {
    score += 15;
    pushUnique(reasons, '낮은 RRP 잔고가 긴축 배경에서 완충 장치 약화를 시사합니다.');
  }

  if (restrictiveCount >= 2) {
    score += 10;
    pushUnique(reasons, '유동성 긴축 조건이 두 가지 이상 겹쳐 구조 압력을 보강합니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreCredit(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const credit = input.credit;

  if (!credit) {
    return { score: 0, reasons };
  }

  let score = 0;
  let hyStress = false;
  let igStress = false;

  if (credit.credit_state === 'STRESSING') {
    score += 35;
    pushUnique(reasons, 'credit_state가 STRESSING이라 신용 전이 위험이 높습니다.');
  }

  if (typeof credit.hy_oas === 'number' && credit.hy_oas >= HY_OAS_STRESS_THRESHOLD) {
    score += 35;
    hyStress = true;
    pushUnique(reasons, 'HY OAS가 의미 있는 스트레스 구간에 들어와 있습니다.');
  }

  if (typeof credit.ig_spread === 'number' && credit.ig_spread >= IG_SPREAD_STRESS_THRESHOLD) {
    score += 20;
    igStress = true;
    pushUnique(reasons, 'IG 스프레드가 투자등급 영역에서도 압박이 커졌음을 시사합니다.');
  }

  if (hyStress && igStress) {
    score += 10;
    pushUnique(reasons, 'HY와 IG가 함께 악화되어 신용 스트레스 확산 가능성을 높입니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreInternals(input: SmartAnalyzerInput): ScoreDetail {
  const reasons: string[] = [];
  const internals = input.internals;

  if (!internals) {
    return { score: 0, reasons };
  }

  let score = 0;

  if (internals.breadth_state === 'WEAK') {
    score += 25;
    pushUnique(reasons, '시장 폭이 약해 지수 표면 아래 손상이 누적됩니다.');
  }

  if (internals.ad_line_trend === 'DOWN') {
    score += 20;
    pushUnique(reasons, 'AD 라인 하락이 내부 약세 확산을 확인합니다.');
  }

  if (internals.new_high_low_state === 'NEGATIVE') {
    score += 20;
    pushUnique(reasons, '신고가/신저가 구성이 부정적이라 내부 모멘텀이 약합니다.');
  }

  if (internals.volume_state === 'EXPANDING_SELL') {
    score += 20;
    pushUnique(reasons, '매도 거래량 확대가 하락 압력의 질을 악화시킵니다.');
  }

  if (internals.divergence_state === 'RISK') {
    score += 15;
    pushUnique(reasons, '내부 다이버전스 리스크가 지수보다 약한 기초체력을 시사합니다.');
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function buildScoreState(
  macro: ScoreDetail,
  persistence: ScoreDetail,
  reaction: ScoreDetail,
  event: ScoreDetail,
  velocity: ScoreDetail,
  liquidity: ScoreDetail,
  credit: ScoreDetail,
  internals: ScoreDetail,
): ScoreState {
  return {
    macro_score: macro.score,
    persistence_score: persistence.score,
    reaction_score: reaction.score,
    event_score: event.score,
    velocity_score: velocity.score,
    liquidity_score: liquidity.score,
    credit_score: credit.score,
    internals_score: internals.score,
    shock_flag: velocity.score >= 70,
  };
}

function resolveBaseMarketType(scoreState: ScoreState): SmartAnalyzerMarketType {
  if (scoreState.macro_score >= 60 && scoreState.persistence_score >= 60) {
    return 'STRUCTURAL';
  }

  if (
    scoreState.event_score >= 60 &&
    scoreState.persistence_score <= 40 &&
    scoreState.macro_score <= 50
  ) {
    return 'EVENT';
  }

  return 'HYBRID';
}

function applyVelocityAdjustment(
  baseMarketType: SmartAnalyzerMarketType,
  scoreState: ScoreState,
): { marketType: SmartAnalyzerMarketType; reasons: string[] } {
  const reasons: string[] = [];
  let marketType = baseMarketType;

  if (baseMarketType === 'EVENT' && scoreState.velocity_score >= 60) {
    marketType = 'HYBRID';
    pushUnique(reasons, 'velocity_score가 60 이상이라 EVENT를 HYBRID로 한 단계 낮춥니다.');
  }

  if (baseMarketType === 'HYBRID' && scoreState.velocity_score >= 70 && scoreState.macro_score >= 50) {
    marketType = 'STRUCTURAL';
    pushUnique(reasons, '속도와 거시 약세가 함께 보여 HYBRID를 STRUCTURAL로 강화합니다.');
  }

  return {
    marketType,
    reasons,
  };
}

function applyMacroExpansionAdjustment(
  currentMarketType: SmartAnalyzerMarketType,
  scoreState: ScoreState,
): { marketType: SmartAnalyzerMarketType; reasons: string[] } {
  const reasons: string[] = [];
  let marketType = currentMarketType;

  if (
    currentMarketType === 'HYBRID' &&
    scoreState.macro_score >= 55 &&
    scoreState.persistence_score >= 55 &&
    (scoreState.liquidity_score >= 60 || scoreState.credit_score >= 60)
  ) {
    marketType = 'STRUCTURAL';
    pushUnique(reasons, '거시·지속성·유동성/신용 스트레스가 함께 높아 HYBRID를 STRUCTURAL로 강화합니다.');
  }

  if (
    currentMarketType === 'EVENT' &&
    (scoreState.credit_score >= 55 || scoreState.internals_score >= 60) &&
    scoreState.persistence_score >= 45
  ) {
    marketType = 'HYBRID';
    pushUnique(reasons, '신용/내부지표 약화가 persistence와 결합되어 EVENT를 HYBRID로 보수화합니다.');
  }

  return {
    marketType,
    reasons,
  };
}

function buildClassificationReason(
  input: SmartAnalyzerInput,
  scoreState: ScoreState,
  baseMarketType: SmartAnalyzerMarketType,
  velocityAdjustedMarketType: SmartAnalyzerMarketType,
  finalMarketType: SmartAnalyzerMarketType,
  velocity: ScoreDetail,
  liquidity: ScoreDetail,
  credit: ScoreDetail,
  internals: ScoreDetail,
  adjustmentReasons: string[],
): string[] {
  const reasons: string[] = [];

  pushUnique(reasons, `기본 분류는 ${baseMarketType}입니다.`);

  if (scoreState.macro_score >= 60) {
    pushUnique(reasons, 'macro_score가 60 이상이라 구조 압력이 강합니다.');
  } else {
    pushUnique(reasons, 'macro_score가 60 미만이라 구조 압력 단독 지배는 아닙니다.');
  }

  if (scoreState.persistence_score >= 60) {
    pushUnique(reasons, 'persistence_score가 60 이상이라 반복 압력이 확인됩니다.');
  } else if (scoreState.persistence_score <= 40) {
    pushUnique(reasons, 'persistence_score가 40 이하라 일회성 충격 가능성이 남아 있습니다.');
  } else {
    pushUnique(reasons, 'persistence_score가 중간 구간이라 지속성 판단이 고정되지는 않습니다.');
  }

  if (scoreState.event_score >= 60) {
    pushUnique(reasons, 'event_score가 60 이상이라 이벤트 트리거가 충분히 강합니다.');
  } else {
    pushUnique(reasons, 'event_score가 60 미만이라 뉴스만으로 분류하지 않습니다.');
  }

  if (scoreState.reaction_score >= 60) {
    pushUnique(reasons, 'reaction_score가 높아 시장 반응 강도가 분명합니다.');
  }

  if (scoreState.velocity_score >= 70) {
    pushUnique(reasons, 'velocity_score가 70 이상이라 비정상적 하락 가속이 감지됩니다.');
  } else if (scoreState.velocity_score >= 60) {
    pushUnique(reasons, 'velocity_score가 높아 하락 속도를 무시할 수 없습니다.');
  } else if (input.drawdown) {
    pushUnique(reasons, 'drawdown 입력은 있으나 속도 충격은 아직 임계치를 넘지 않았습니다.');
  }

  if (scoreState.liquidity_score >= 60) {
    pushUnique(reasons, 'liquidity_score가 높아 유동성 배경이 구조 압력을 보강합니다.');
  } else if (input.liquidity) {
    pushUnique(reasons, 'liquidity 입력은 있으나 유동성 압력은 아직 임계치 미만입니다.');
  }

  if (scoreState.credit_score >= 55) {
    pushUnique(reasons, 'credit_score가 높아 스트레스가 신용시장으로 번질 가능성을 시사합니다.');
  } else if (input.credit) {
    pushUnique(reasons, 'credit 입력은 있으나 신용 스트레스는 아직 구조적 수준으로 보지 않습니다.');
  }

  if (scoreState.internals_score >= 60) {
    pushUnique(reasons, 'internals_score가 높아 지수 표면 아래 약세가 확인됩니다.');
  } else if (input.internals) {
    pushUnique(reasons, 'internals 입력은 있으나 내부 약세는 아직 부분적입니다.');
  }

  if (scoreState.shock_flag) {
    pushUnique(reasons, 'shock_flag가 true라 속도 기반 경계 수준을 높입니다.');
  }

  if (input.rates.spread < 0) {
    pushUnique(reasons, 'spread 악화가 구조 압력 판단을 보강합니다.');
  }

  if (includesAny(normalizeText(input.macro_trend), WORSENING_KEYWORDS)) {
    pushUnique(reasons, 'macro_trend가 worsening 성격이라 구조 압력 해석을 보강합니다.');
  }

  if (includesAny(normalizeText(input.price_state), ['failed rally', 'rolling', 'breakdown'])) {
    pushUnique(reasons, 'rally failure 또는 반복 하락 패턴이 감지됩니다.');
  }

  for (const reason of velocity.reasons.slice(0, 2)) {
    pushUnique(reasons, reason);
  }

  for (const reason of liquidity.reasons.slice(0, 2)) {
    pushUnique(reasons, reason);
  }

  for (const reason of credit.reasons.slice(0, 2)) {
    pushUnique(reasons, reason);
  }

  for (const reason of internals.reasons.slice(0, 2)) {
    pushUnique(reasons, reason);
  }

  if (velocityAdjustedMarketType !== baseMarketType) {
    pushUnique(reasons, `속도 조정 후 분류는 ${velocityAdjustedMarketType}입니다.`);
  }

  for (const reason of adjustmentReasons) {
    pushUnique(reasons, reason);
  }

  if (finalMarketType !== velocityAdjustedMarketType) {
    pushUnique(reasons, `거시 확장 레이어 반영 후 최종 분류는 ${finalMarketType}입니다.`);
  }

  return reasons;
}

function resolveConfidence(
  marketType: SmartAnalyzerMarketType,
  scoreState: ScoreState,
): SmartAnalyzerConfidence {
  if (marketType === 'STRUCTURAL') {
    let strongCount = 0;

    if (scoreState.macro_score > 75) {
      strongCount += 1;
    }
    if (scoreState.persistence_score > 75) {
      strongCount += 1;
    }
    if (scoreState.liquidity_score >= 60 || scoreState.credit_score >= 60) {
      strongCount += 1;
    }
    if (scoreState.velocity_score >= 70 || scoreState.internals_score >= 60) {
      strongCount += 1;
    }

    return strongCount >= 2 ? 'HIGH' : 'MED';
  }

  if (marketType === 'EVENT') {
    if (
      scoreState.event_score > 75 &&
      scoreState.reaction_score >= 60 &&
      scoreState.velocity_score < 60 &&
      scoreState.credit_score < 55 &&
      scoreState.liquidity_score < 60 &&
      scoreState.internals_score < 60
    ) {
      return 'HIGH';
    }
    return 'MED';
  }

  if (
    scoreState.velocity_score >= 70 ||
    scoreState.credit_score >= 55 ||
    scoreState.internals_score >= 60
  ) {
    return 'MED';
  }
  if (scoreState.macro_score >= 40 && scoreState.event_score >= 40) {
    return 'MED';
  }
  if (
    scoreState.reaction_score >= 60 &&
    (
      scoreState.macro_score >= 40 ||
      scoreState.event_score >= 40 ||
      scoreState.liquidity_score >= 50
    )
  ) {
    return 'MED';
  }
  return 'LOW';
}

function resolveStrategy(
  marketType: SmartAnalyzerMarketType,
  scoreState: ScoreState,
): SmartAnalyzerStrategy {
  let strategy: SmartAnalyzerStrategy;

  if (marketType === 'STRUCTURAL') {
    strategy =
      scoreState.macro_score >= 75 ||
      scoreState.persistence_score >= 75 ||
      scoreState.shock_flag ||
      scoreState.credit_score >= 70 ||
      scoreState.liquidity_score >= 75
        ? 'DEFENSIVE'
        : 'WAIT';
  } else if (marketType === 'EVENT') {
    strategy =
      scoreState.reaction_score >= 70 &&
      scoreState.macro_score <= 35 &&
      scoreState.velocity_score < 60 &&
      scoreState.credit_score < 55 &&
      scoreState.liquidity_score < 60 &&
      scoreState.internals_score < 60
        ? 'ENTER'
        : 'PARTIAL';
  } else {
    strategy =
      scoreState.event_score >= 55 &&
      scoreState.reaction_score >= 60 &&
      scoreState.velocity_score < 80 &&
      scoreState.credit_score < 55 &&
      scoreState.liquidity_score < 60
        ? 'PARTIAL'
        : 'WAIT';
  }

  if (scoreState.velocity_score >= 80) {
    return 'DEFENSIVE';
  }

  if (scoreState.credit_score >= 70 || scoreState.liquidity_score >= 75) {
    if (scoreState.velocity_score >= 70 || marketType === 'STRUCTURAL') {
      return 'DEFENSIVE';
    }
    if (marketType === 'HYBRID') {
      return 'WAIT';
    }
    if (strategy === 'ENTER') {
      return 'PARTIAL';
    }
  }

  return strategy;
}

function buildKeyDrivers(
  marketType: SmartAnalyzerMarketType,
  scoreState: ScoreState,
  input: SmartAnalyzerInput,
): string[] {
  const drivers: string[] = [];

  const structuralDrivers = [
    scoreState.macro_score >= 60 ? '금리와 인플레이션 압력이 구조적 부담으로 작용합니다.' : '',
    scoreState.liquidity_score >= 60 ? '유동성 배경이 긴축적으로 남아 있어 압력이 쉽게 풀리기 어렵습니다.' : '',
    scoreState.credit_score >= 60 ? '신용 스프레드가 구조적 스트레스를 시사합니다.' : '',
    scoreState.persistence_score >= 60 ? '반복 하락 압력과 반등 실패 패턴이 누적됩니다.' : '',
    scoreState.internals_score >= 60 ? '시장 내부 지표 약세가 지수 표면 아래 손상을 확인합니다.' : '',
    scoreState.velocity_score >= 60 ? '하락 속도가 비정상적으로 빨라 경계가 필요합니다.' : '',
    scoreState.reaction_score >= 60 ? '변동성 급등과 급격한 가격 반응이 확인됩니다.' : '',
  ];

  const eventDrivers = [
    scoreState.event_score >= 60 ? '이벤트성 충격이 촉발 요인으로 작동했습니다.' : '',
    scoreState.reaction_score >= 60 ? '시장 반응 강도가 높아 충격 해석이 분명합니다.' : '',
    scoreState.velocity_score >= 60 ? '하락 속도가 빨라 단순 이벤트 낙관을 유지하기 어렵습니다.' : '',
    scoreState.credit_score >= 55 ? '신용 스트레스가 커져 이벤트 해석을 더 보수적으로 봐야 합니다.' : '',
    scoreState.internals_score >= 60 ? '시장 내부 약세가 헤드라인 이상의 손상을 시사합니다.' : '',
    scoreState.liquidity_score >= 60 ? '유동성 배경이 우호적이지 않아 단순 이벤트로 끝나기 어렵습니다.' : '',
    scoreState.persistence_score <= 40 ? '압력이 아직 구조적으로 고착됐다고 보기는 어렵습니다.' : '',
  ];

  const hybridDrivers = [
    scoreState.macro_score >= 40 ? '거시 부담이 남아 있어 이벤트만으로 설명되지는 않습니다.' : '',
    scoreState.liquidity_score >= 60 ? '유동성 여건이 긴축적으로 남아 있어 리스크 해석을 보수화합니다.' : '',
    scoreState.credit_score >= 55 ? '신용 스프레드가 넓어지며 스트레스 전이 가능성을 높입니다.' : '',
    scoreState.internals_score >= 60 ? '시장 내부 지표 약세가 헤드라인 이상의 손상을 확인합니다.' : '',
    scoreState.velocity_score >= 60 ? '단기 하락 속도가 빨라 리스크 해석을 더 보수적으로 봐야 합니다.' : '',
    scoreState.event_score >= 40 ? '이벤트 요인이 방향성을 증폭시키고 있습니다.' : '',
    scoreState.reaction_score >= 60 ? '시장 반응이 충분히 강해 체제 전환 가능성을 열어둬야 합니다.' : '',
    input.rates.spread < 0 ? '장단기 스프레드 악화가 경기 민감 자산에 부담입니다.' : '',
  ];

  const orderedDrivers =
    marketType === 'STRUCTURAL'
      ? structuralDrivers
      : marketType === 'EVENT'
        ? eventDrivers
        : hybridDrivers;

  for (const driver of orderedDrivers) {
    if (driver) {
      pushUnique(drivers, driver);
    }
  }

  if (drivers.length === 0) {
    pushUnique(drivers, '입력 신호가 혼재해 단일 드라이버보다 복합 해석이 필요합니다.');
  }

  return drivers.slice(0, 4);
}

function buildInterpretation(
  marketType: SmartAnalyzerMarketType,
  scoreState: ScoreState,
): string {
  const speedSentence =
    scoreState.velocity_score >= 60
      ? '하락 속도도 비정상적으로 빨라 단순 헤드라인 변동으로만 보기 어렵습니다.'
      : '';

  const liquidityCreditSentence =
    scoreState.liquidity_score >= 60 && scoreState.credit_score >= 60
      ? '유동성과 신용 여건이 함께 경직돼 압력이 더 오래 남을 수 있습니다.'
      : scoreState.liquidity_score >= 60
        ? '유동성 여건도 우호적이지 않아 압력이 쉽게 풀리기 어렵습니다.'
        : scoreState.credit_score >= 60
          ? '신용 스프레드가 넓어져 스트레스 전이 가능성을 시사합니다.'
          : '';

  const internalsSentence =
    scoreState.internals_score >= 60
      ? '시장 내부 지표 약세가 지수 표면 아래 손상을 확인합니다.'
      : '';

  if (marketType === 'STRUCTURAL') {
    return [
      '현재 국면은 거시 압력과 지속성이 높은 구조적 환경에 가깝습니다.',
      liquidityCreditSentence || '금리와 스프레드 부담이 남아 있고 하락 압력이 반복됩니다.',
      speedSentence || internalsSentence || '시장 반응도 이미 약세 체제를 확인하는 쪽에 가깝습니다.',
      '따라서 대응은 보수적으로 두는 편이 일관됩니다.',
    ].join(' ');
  }

  if (marketType === 'EVENT') {
    return [
      '현재 국면은 식별 가능한 이벤트 트리거가 먼저 충격을 만든 상황에 가깝습니다.',
      '시장 반응은 강하지만 구조적 압력과 지속성 점수는 아직 지배적이지 않습니다.',
      liquidityCreditSentence || internalsSentence || '핵심은 뉴스 자체보다 이 충격이 일회성인지, 과민반응인지 확인하는 것입니다.',
      '따라서 이벤트 중심 해석이 타당합니다.',
    ].join(' ');
  }

  const balanceSentence =
    scoreState.macro_score >= scoreState.event_score
      ? '거시 부담이 더 크지만 이벤트가 하락 압력을 증폭시키고 있습니다.'
      : '이벤트 충격이 먼저 보이지만 거시 배경이 약해 쉽게 끝난다고 단정하기 어렵습니다.';

  return [
    '현재 국면은 이벤트와 구조 압력이 함께 작동하는 혼합형 구간입니다.',
    liquidityCreditSentence || balanceSentence,
    speedSentence || internalsSentence || '시장 반응은 충분히 강하지만 체제가 완전히 한쪽으로 고정됐다고 보기는 어렵습니다.',
    '따라서 과도한 확신보다 중립적 해석이 적절합니다.',
  ].join(' ');
}

function buildSummary(
  marketType: SmartAnalyzerMarketType,
  strategy: SmartAnalyzerStrategy,
  scoreState: ScoreState,
): string {
  if (scoreState.velocity_score >= 80) {
    return `하락 속도 리스크가 커서 전략은 ${strategy}로 더 보수적으로 둡니다.`;
  }

  if (scoreState.credit_score >= 70 || scoreState.liquidity_score >= 75) {
    return `유동성·신용 여건이 빡빡해 전략은 ${strategy}로 더 보수적으로 둡니다.`;
  }

  if (marketType === 'STRUCTURAL') {
    return `구조 압력이 우세하므로 전략은 ${strategy} 쪽이 적절합니다.`;
  }
  if (marketType === 'EVENT') {
    return `이벤트 충격 국면으로 보며 전략은 ${strategy}로 대응합니다.`;
  }
  return `혼합형 국면이므로 전략은 ${strategy}로 보수적으로 접근합니다.`;
}

function shouldLog(): boolean {
  return process.env.SMART_ANALYZER_LOG !== '0';
}

export function getSmartAnalyzerPrompt(): string {
  return loadEnginePrompt(SMART_ANALYZER_PROMPT_FILE);
}

export function analyzeMarket(input: SmartAnalyzerInput): SmartAnalyzerResult {
  const macro = scoreMacro(input);
  const persistence = scorePersistence(input);
  const reaction = scoreReaction(input);
  const event = scoreEvent(input);
  const velocity = scoreVelocity(input);
  const liquidity = scoreLiquidity(input);
  const credit = scoreCredit(input);
  const internals = scoreInternals(input);

  const scoreState = buildScoreState(
    macro,
    persistence,
    reaction,
    event,
    velocity,
    liquidity,
    credit,
    internals,
  );

  const baseMarketType = resolveBaseMarketType(scoreState);
  const velocityAdjusted = applyVelocityAdjustment(baseMarketType, scoreState);
  const expansionAdjusted = applyMacroExpansionAdjustment(velocityAdjusted.marketType, scoreState);
  const finalMarketType = expansionAdjusted.marketType;

  // ── Memory Layer (WO §7) ───────────────────────────────────────────────────
  // Classification is NOT changed by memory.
  // Memory adjusts confidence and enriches interpretation only.
  const memoryOutput = findSimilarCases(input, {
    velocity_score: scoreState.velocity_score,
    credit_score: scoreState.credit_score,
    internals_score: scoreState.internals_score,
  });

  const { aggregated_insight: memInsight, matched_cases: memMatches } = memoryOutput;
  const topMatch = memMatches[0] ?? null;

  // Confidence: base resolution first, then apply memory boost (WO §8)
  let confidence = resolveConfidence(finalMarketType, scoreState);
  if (
    finalMarketType === 'HYBRID' &&
    memInsight.structural_probability >= 70 &&
    confidence === 'MED'
  ) {
    confidence = 'HIGH';
  }

  const strategy = resolveStrategy(finalMarketType, scoreState);

  // Key drivers: add up to 1 memory-driven driver (WO §10)
  const baseDrivers = buildKeyDrivers(finalMarketType, scoreState, input);
  const memDrivers = buildMemoryKeyDrivers(memoryOutput);
  const keyDrivers = [...baseDrivers, ...memDrivers].slice(0, 5);

  // Interpretation: append memory sentence (WO §9)
  const baseInterpretation = buildInterpretation(finalMarketType, scoreState);
  const memSentence = buildMemoryInterpretation(memoryOutput, finalMarketType);
  const interpretation = memSentence
    ? `${baseInterpretation} ${memSentence}`
    : baseInterpretation;

  // ── Scenario Engine (WO-SA4) ──────────────────────────────────────────────
  // classification 변경 없음. 순수 forward path 확률만 계산.
  const scenarioInput = {
    market_type: finalMarketType,
    confidence,
    macro_score: scoreState.macro_score,
    persistence_score: scoreState.persistence_score,
    reaction_score: scoreState.reaction_score,
    event_score: scoreState.event_score,
    velocity_score: scoreState.velocity_score,
    liquidity_score: scoreState.liquidity_score,
    credit_score: scoreState.credit_score,
    internals_score: scoreState.internals_score,
    memory_structural_probability: memInsight.structural_probability,
    memory_rebound_probability: memInsight.rebound_probability,
    memory_continuation_probability: memInsight.continuation_probability,
  };
  const { result: scenarioResult, debug: scenarioDebug } = computeScenarioProbabilities(scenarioInput);

  // ── Bridge Layer (WO-SA5) ─────────────────────────────────────────────────
  // SA 출력 → MC·VR 포지처 신호 변환. 분류·확률 변경 없음.
  const bridgeInput = {
    market_type: finalMarketType,
    strategy,
    velocity_score: scoreState.velocity_score,
    credit_score: scoreState.credit_score,
    liquidity_score: scoreState.liquidity_score,
    internals_score: scoreState.internals_score,
    persistence_score: scoreState.persistence_score,
    continuation_probability: scenarioResult.continuation_probability,
    rebound_probability: scenarioResult.rebound_probability,
    sideways_probability: scenarioResult.sideways_probability,
    dominant_path: scenarioResult.dominant_path,
  };
  const { result: bridgeResult, debug: bridgeDebug } = computeBridgeSignal(bridgeInput);

  // ── Research Desk Formatter (WO-SA6) ──────────────────────────────────────
  // 부분 result를 먼저 조립해 formatter에 전달 (debug는 아직 미완이므로 임시 조립)
  // formatter는 순수 포매팅 전용 — 엔진 로직 없음.

  // Memory summary (WO §11, §12)
  const memorySummary: SmartAnalyzerMemorySummary = {
    top_match: topMatch?.id ?? null,
    similarity: topMatch?.similarity_score ?? null,
    structural_probability: memInsight.structural_probability,
    rebound_probability: memInsight.rebound_probability,
  };

  const memoryDebug: SmartAnalyzerMemoryDebug = {
    top_match_id: topMatch?.id ?? null,
    similarity_score: topMatch?.similarity_score ?? null,
    structural_probability: memInsight.structural_probability,
    rebound_probability: memInsight.rebound_probability,
  };

  const debug: SmartAnalyzerDebug = {
    ...scoreState,
    classification_reason: buildClassificationReason(
      input,
      scoreState,
      baseMarketType,
      velocityAdjusted.marketType,
      finalMarketType,
      velocity,
      liquidity,
      credit,
      internals,
      [...velocityAdjusted.reasons, ...expansionAdjusted.reasons],
    ),
    memory: memoryDebug,
  };

  // ── Research Desk Formatter 호출 (WO-SA6 §17) ─────────────────────────────
  // preResult: formatter가 필요한 모든 필드를 포함. research_desk 제외.
  // formatter는 순수 포매팅 — preResult를 읽기만 한다.
  const preResult = {
    market_type: finalMarketType,
    confidence,
    key_drivers: keyDrivers,
    interpretation,
    strategy,
    summary: buildSummary(finalMarketType, strategy, scoreState),
    memory: memorySummary,
    scenario: scenarioResult,
    bridge: bridgeResult,
    debug,
    debug_scenario: scenarioDebug,
    debug_bridge: bridgeDebug,
  } as SmartAnalyzerResult;

  const researchDesk = formatResearchDeskPayload(preResult);

  // ── VR Policy Port (WO-SA8) ─────────────────────────────────────────────
  // SA 결과 → VR 소비용 정책 포트. 분류·실행 로직 없음.
  const preResult2 = { ...preResult, research_desk: researchDesk } as SmartAnalyzerResult;
  const { result: vrPolicyResult, debug: vrPolicyDebug } = buildVrPolicyPort(preResult2);

  // ── VR Runtime Policy Adapter (WO-SA9) ──────────────────────────────────
  // VrPolicyResult → VR 런타임 실행 게이트 + 사이징 파라미터
  const { result: vrRuntimeResult, debug: vrRuntimeDebug } = buildVrRuntimePolicy(vrPolicyResult);

  // ── VR Action Model (WO-SA10) ─────────────────────────────────────────
  // VrRuntimePolicyResult → 액션 클래스별 허용/제한/차단 권한
  const { result: vrActionResult, debug: vrActionDebug } = buildVrActionPolicy(vrRuntimeResult);

  const result: SmartAnalyzerResult = {
    ...preResult2,
    vr_policy: vrPolicyResult,
    vr_runtime_policy: vrRuntimeResult,
    vr_action_policy: vrActionResult,
    debug_vr_policy: vrPolicyDebug,
    debug_vr_runtime_policy: vrRuntimeDebug,
    debug_vr_action_policy: vrActionDebug,
  };

  if (shouldLog()) {
    console.info(
      '[smartAnalyzer]',
      JSON.stringify(
        {
          input,
          result,
        },
        null,
        2,
      ),
    );
  }

  return result;
}
