import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  EventMemoryCase,
  MemoryAggregatedInsight,
  MemoryClassification,
  MemoryEngineOutput,
  MemoryInflationRegime,
  MemoryLiquidityState,
  MemoryMatch,
  MemoryRatesTrend,
} from '../types/memory';
import type { SmartAnalyzerInput } from '../types/smartAnalyzer';

// =============================================================================
// memoryEngine.ts
//
// Historical Event Memory Layer — deterministic similarity matching only.
// No ML. JSON DB. Top-3 matches returned.
//
// Scoring:
//   Macro match:  +20 each (inflation, rates_trend, liquidity)  → max 60
//   Velocity:     +20 (diff ≤ 15) | +10 (diff ≤ 30)            → max 20
//   Credit:       +10 (diff ≤ 15)                               → max 10
//   Internals:    +10 (diff ≤ 15)                               → max 10
//   Total max:    100
// =============================================================================

const DB_PATH = join(process.cwd(), 'marketflow', 'data', 'eventMemoryDB.json');
const TOP_N = 3;

let _cachedDB: EventMemoryCase[] | null = null;

function loadDB(): EventMemoryCase[] {
  if (_cachedDB) return _cachedDB;
  try {
    _cachedDB = JSON.parse(readFileSync(DB_PATH, 'utf-8')) as EventMemoryCase[];
  } catch {
    _cachedDB = [];
  }
  return _cachedDB;
}

// =============================================================================
// CURRENT STATE DERIVATION
// Derives macro context from SmartAnalyzerInput for similarity matching
// =============================================================================

function deriveInflation(input: SmartAnalyzerInput): MemoryInflationRegime {
  const text = `${input.macro_state} ${input.macro_trend}`.toLowerCase();
  const highKeywords = ['inflation', 'sticky', 'hot cpi', 'hot ppi', 'higher for longer', 'hawkish', 'restrictive'];
  const lowKeywords = ['disinflation', 'cooling', 'deflation', 'soft landing', 'dovish'];
  if (highKeywords.some((k) => text.includes(k))) return 'HIGH';
  if (lowKeywords.some((k) => text.includes(k))) return 'LOW';
  return 'NORMAL';
}

function deriveRatesTrend(input: SmartAnalyzerInput): MemoryRatesTrend {
  const text = `${input.macro_state} ${input.macro_trend}`.toLowerCase();
  const upKeywords = ['hiking', 'tightening', 'rate hike', 'restrictive'];
  const downKeywords = ['cutting', 'easing', 'rate cut', 'dovish', 'pivot'];
  if (upKeywords.some((k) => text.includes(k)) || input.rates.us10y >= 4.5) return 'UP';
  if (downKeywords.some((k) => text.includes(k)) || input.rates.us10y <= 2.5) return 'DOWN';
  return 'FLAT';
}

function deriveLiquidity(input: SmartAnalyzerInput): MemoryLiquidityState {
  if (!input.liquidity) return 'NEUTRAL';
  const l = input.liquidity;
  const tightCount = [
    l.fed_balance_sheet_trend === 'SHRINKING',
    l.m2_trend === 'DOWN',
    l.tga_trend === 'UP',
  ].filter(Boolean).length;
  if (tightCount >= 2) return 'TIGHT';
  const looseCount = [
    l.fed_balance_sheet_trend === 'EXPANDING',
    l.m2_trend === 'UP',
    l.tga_trend === 'DOWN',
  ].filter(Boolean).length;
  if (looseCount >= 2) return 'LOOSE';
  return 'NEUTRAL';
}

// =============================================================================
// SIMILARITY SCORING (deterministic)
// =============================================================================
function scoreSimilarity(
  candidate: EventMemoryCase,
  inflation: MemoryInflationRegime,
  ratesTrend: MemoryRatesTrend,
  liquidity: MemoryLiquidityState,
  velocityScore: number,
  creditScore: number,
  internalsScore: number,
): number {
  let score = 0;

  // Macro match (max 60)
  if (candidate.macro_context.inflation === inflation) score += 20;
  if (candidate.macro_context.rates_trend === ratesTrend) score += 20;
  if (candidate.macro_context.liquidity === liquidity) score += 20;

  // Velocity proximity (max 20)
  const vDiff = Math.abs(candidate.market_context.velocity_score - velocityScore);
  if (vDiff <= 15) score += 20;
  else if (vDiff <= 30) score += 10;

  // Credit proximity (max 10)
  const cDiff = Math.abs(candidate.market_context.credit_score - creditScore);
  if (cDiff <= 15) score += 10;

  // Internals proximity (max 10)
  const iDiff = Math.abs(candidate.market_context.internals_score - internalsScore);
  if (iDiff <= 15) score += 10;

  return score;
}

// =============================================================================
// AGGREGATED INSIGHT
// =============================================================================
function buildAggregatedInsight(matches: MemoryMatch[]): MemoryAggregatedInsight {
  if (!matches.length) {
    return { structural_probability: 0, event_probability: 0, rebound_probability: 0, continuation_probability: 0 };
  }

  const totalWeight = matches.reduce((sum, m) => sum + m.similarity_score, 0);

  function weightedProbability(predicate: (m: MemoryMatch) => boolean): number {
    if (totalWeight === 0) return 0;
    const weighted = matches
      .filter(predicate)
      .reduce((sum, m) => sum + m.similarity_score, 0);
    return Math.round((weighted / totalWeight) * 100);
  }

  return {
    structural_probability: weightedProbability((m) => m.classification === 'STRUCTURAL'),
    event_probability: weightedProbability((m) => m.classification === 'EVENT'),
    rebound_probability: weightedProbability((m) => m.outcome.rebound),
    continuation_probability: weightedProbability((m) => m.outcome.continuation),
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================
export type CurrentMarketState = {
  velocity_score: number;
  credit_score: number;
  internals_score: number;
};

export function findSimilarCases(
  input: SmartAnalyzerInput,
  marketState: CurrentMarketState,
): MemoryEngineOutput {
  const db = loadDB();

  const inflation = deriveInflation(input);
  const ratesTrend = deriveRatesTrend(input);
  const liquidity = deriveLiquidity(input);

  const scored = db.map((candidate) => ({
    candidate,
    score: scoreSimilarity(
      candidate,
      inflation,
      ratesTrend,
      liquidity,
      marketState.velocity_score,
      marketState.credit_score,
      marketState.internals_score,
    ),
  }));

  const topMatches: MemoryMatch[] = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .filter((s) => s.score > 0)
    .map((s) => ({
      id: s.candidate.id,
      similarity_score: s.score,
      classification: s.candidate.classification as MemoryClassification,
      outcome: s.candidate.outcome,
      event_type: s.candidate.event_type,
    }));

  return {
    matched_cases: topMatches,
    aggregated_insight: buildAggregatedInsight(topMatches),
  };
}

// =============================================================================
// INTERPRETATION SENTENCES — called by smartAnalyzer.ts
// =============================================================================
export function buildMemoryInterpretation(
  output: MemoryEngineOutput,
  currentClassification: string,
): string {
  const { aggregated_insight: insight, matched_cases: matches } = output;
  if (!matches.length) return '';

  const top = matches[0];
  const parts: string[] = [];

  if (insight.continuation_probability >= 65) {
    parts.push('과거 유사 국면들을 보면 초기 충격 이후에도 압력이 이어진 경우가 많았습니다.');
  } else if (insight.rebound_probability >= 65) {
    parts.push('역사적으로 유사한 충격 이후에는 단기 반등이 뒤따른 사례가 더 많았습니다.');
  }

  if (insight.structural_probability >= 60 && currentClassification !== 'STRUCTURAL') {
    parts.push('현재 여건은 과거 구조적 하락 구간과 더 가깝게 정렬됩니다.');
  } else if (insight.event_probability >= 60 && currentClassification !== 'EVENT') {
    parts.push('과거 경험상 이 구조는 일회성 충격에 더 가까운 패턴을 보였습니다.');
  }

  if (parts.length === 0 && top.similarity_score >= 60) {
    parts.push(`${top.event_type}와 유사한 조건에서 과거 시장은 ${top.outcome.rebound ? '단기 반등' : '지속 하락'} 흐름을 보였습니다.`);
  }

  return parts.join(' ');
}

// =============================================================================
// MEMORY KEY DRIVERS — optional additions to key_drivers
// =============================================================================
export function buildMemoryKeyDrivers(output: MemoryEngineOutput): string[] {
  const { aggregated_insight: insight } = output;
  const drivers: string[] = [];

  if (insight.continuation_probability >= 65) {
    drivers.push('역사적 패턴은 지속 하락 위험을 시사합니다.');
  }

  if (insight.rebound_probability >= 65) {
    drivers.push('과거 유사 사례들은 단기 반등 가능성을 지지합니다.');
  }

  if (insight.structural_probability >= 70) {
    drivers.push('현재 환경은 과거 구조적 압력 구간과 정렬됩니다.');
  }

  return drivers.slice(0, 1);  // max 1 memory-driven key driver
}
