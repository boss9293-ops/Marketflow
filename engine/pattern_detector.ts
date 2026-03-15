import { readFileSync } from 'fs'
import { join } from 'path'

export type MarketState = {
  nasdaq_drawdown: number
  tqqq_drawdown: number
  duration_days: number
  ma200_relation: 'above' | 'near' | 'tested' | 'breach' | 'below' | 'irrelevant'
  volatility_regime: 'low' | 'moderate' | 'medium' | 'elevated' | 'high' | 'extreme'
  price_structure?: string
  catalyst_type?: string
  rebound_behavior?: string
  trend_persistence?: string
}

export type PatternMatch = {
  pattern_id: string
  pattern_name: string
  score: number
  explanation?: string[]
}

export type PatternDetectionResult = {
  top_matches: PatternMatch[]
  evaluated_count: number
}

type NumericRange = {
  min: number
  max: number
}

type PatternSignature = {
  duration_days?: NumericRange | [number, number]
  nasdaq_drawdown_pct?: NumericRange
  nasdaq_drawdown_range?: NumericRange
  tqqq_drawdown_pct?: NumericRange
  tqqq_drawdown_range?: NumericRange
  nasdaq_rebound_range?: NumericRange
  tqqq_rebound_range?: NumericRange
  ma200_status?: string
  ma200_behavior?: string
  volatility_level?: string
  volatility_profile?: string
  trend_direction?: string
  trend_structure?: string
  event_catalyst?: string
  catalyst_type?: string
}

type PatternDefinition = {
  pattern_id: string
  description?: string
  signature?: PatternSignature
}

type PatternIndex = {
  patterns: string[]
}

const CORE_WEIGHTS = {
  duration: 0.25,
  drawdown: 0.4,
  volatility: 0.2,
  ma200_relation: 0.15,
} as const

const CONTEXT_WEIGHT = 0.1

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeRange(range?: NumericRange | [number, number]): NumericRange | null {
  if (!range) return null

  if (Array.isArray(range) && range.length === 2) {
    return {
      min: Math.min(range[0], range[1]),
      max: Math.max(range[0], range[1]),
    }
  }

  if (!Array.isArray(range) && isFiniteNumber(range.min) && isFiniteNumber(range.max)) {
    return {
      min: Math.min(range.min, range.max),
      max: Math.max(range.min, range.max),
    }
  }

  return null
}

function normalizePctRange(range?: NumericRange): NumericRange | null {
  if (!range) return null
  if (!isFiniteNumber(range.min) || !isFiniteNumber(range.max)) return null

  const scale = Math.max(Math.abs(range.min), Math.abs(range.max)) > 1 ? 100 : 1
  return {
    min: Math.min(range.min / scale, range.max / scale),
    max: Math.max(range.min / scale, range.max / scale),
  }
}

function boundedScore(value: number, target: NumericRange): number {
  if (!isFiniteNumber(value) || !isFiniteNumber(target.min) || !isFiniteNumber(target.max)) {
    return 0
  }

  if (value >= target.min && value <= target.max) {
    return 1
  }

  const width = Math.max(Math.abs(target.max - target.min), 0.0001)
  const nearest = value < target.min ? target.min : target.max
  const gap = Math.abs(value - nearest)
  return Math.max(0, 1 - gap / width)
}

function durationScore(durationDays: number, signature: PatternSignature): number {
  const range = normalizeRange(signature.duration_days)
  return range ? boundedScore(durationDays, range) : 0.5
}

function drawdownScore(marketState: MarketState, signature: PatternSignature): number {
  const nasdaqRange =
    normalizePctRange(signature.nasdaq_drawdown_range) ??
    normalizePctRange(signature.nasdaq_drawdown_pct)

  const tqqqRange =
    normalizePctRange(signature.tqqq_drawdown_range) ??
    normalizePctRange(signature.tqqq_drawdown_pct)

  const nasdaqReboundRange = normalizePctRange(signature.nasdaq_rebound_range)
  const tqqqReboundRange = normalizePctRange(signature.tqqq_rebound_range)

  const scores: number[] = []

  if (nasdaqRange) {
    scores.push(boundedScore(marketState.nasdaq_drawdown, nasdaqRange))
  }
  if (tqqqRange) {
    scores.push(boundedScore(marketState.tqqq_drawdown, tqqqRange))
  }
  if (nasdaqReboundRange) {
    scores.push(boundedScore(Math.abs(marketState.nasdaq_drawdown), nasdaqReboundRange))
  }
  if (tqqqReboundRange) {
    scores.push(boundedScore(Math.abs(marketState.tqqq_drawdown), tqqqReboundRange))
  }

  if (!scores.length) {
    return 0.5
  }

  return scores.reduce((sum, item) => sum + item, 0) / scores.length
}

function volatilityScore(volatilityRegime: MarketState['volatility_regime'], signature: PatternSignature): number {
  const target = signature.volatility_profile ?? signature.volatility_level
  if (!target) return 0.5

  const order = ['low', 'moderate', 'medium', 'elevated', 'high', 'extreme']
  const targetIndex = order.indexOf(target)
  const currentIndex = order.indexOf(volatilityRegime)

  if (targetIndex === -1 || currentIndex === -1) {
    return 0.5
  }

  const diff = Math.abs(targetIndex - currentIndex)
  return Math.max(0, 1 - diff / 4)
}

function ma200RelationScore(ma200Relation: MarketState['ma200_relation'], signature: PatternSignature): number {
  const target = signature.ma200_behavior ?? signature.ma200_status
  if (!target) return 0.5

  const normalizedTarget =
    target === 'breached' ? 'breach'
    : target === 'test_or_breach' ? 'tested'
    : target === 'above_or_near' ? 'near'
    : target === 'sustained_below' ? 'below'
    : target === 'held' ? 'above'
    : target

  if (normalizedTarget === 'irrelevant') {
    return 1
  }

  if (normalizedTarget === ma200Relation) {
    return 1
  }

  const order = ['above', 'near', 'tested', 'breach', 'below']
  const targetIndex = order.indexOf(normalizedTarget)
  const currentIndex = order.indexOf(ma200Relation)

  if (targetIndex === -1 || currentIndex === -1) {
    return 0.5
  }

  const diff = Math.abs(targetIndex - currentIndex)
  return Math.max(0, 1 - diff / 3)
}

function contextScore(marketState: MarketState, signature: PatternSignature): number {
  const checks: number[] = []

  if (marketState.price_structure && signature.trend_structure) {
    checks.push(marketState.price_structure === signature.trend_structure ? 1 : 0)
  }

  if (marketState.catalyst_type) {
    const target = signature.catalyst_type ?? signature.event_catalyst
    if (target) {
      checks.push(marketState.catalyst_type === target ? 1 : 0)
    }
  }

  if (marketState.trend_persistence && signature.trend_direction) {
    checks.push(marketState.trend_persistence === signature.trend_direction ? 1 : 0)
  }

  if (!checks.length) {
    return 0.5
  }

  return checks.reduce((sum, item) => sum + item, 0) / checks.length
}

function toPatternName(patternId: string): string {
  return patternId
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function pushExplanation(explanations: string[], score: number, strong: string, partial: string) {
  if (score >= 0.95) {
    explanations.push(strong)
    return
  }

  if (score >= 0.6) {
    explanations.push(partial)
  }
}

function buildExplanation(
  marketState: MarketState,
  signature: PatternSignature,
  componentScores: {
    duration: number
    drawdown: number
    volatility: number
    ma200: number
    context: number
  }
): string[] {
  const explanations: string[] = []

  pushExplanation(explanations, componentScores.drawdown, 'drawdown profile fits', 'drawdown depth partially fits')
  pushExplanation(explanations, componentScores.duration, 'duration is consistent with this structure', 'duration partially fits')
  pushExplanation(explanations, componentScores.volatility, 'volatility regime matches', 'volatility profile only partially matches')
  pushExplanation(explanations, componentScores.ma200, 'MA200 breach matches', 'MA200 relation partially matches')

  if (marketState.price_structure && signature.trend_structure) {
    pushExplanation(
      explanations,
      marketState.price_structure === signature.trend_structure ? 1 : 0,
      `${marketState.price_structure.replaceAll('_', '-')} structure matches`,
      'structure partially overlaps'
    )
  }

  if (marketState.catalyst_type) {
    const target = signature.catalyst_type ?? signature.event_catalyst
    if (target) {
      pushExplanation(
        explanations,
        marketState.catalyst_type === target ? 1 : 0,
        `${target.replaceAll('_', ' ')} catalyst matches`,
        'catalyst partially overlaps'
      )
    }
  }

  if (marketState.rebound_behavior && signature.nasdaq_rebound_range) {
    explanations.push('rebound behavior overlap only')
  }

  if (!explanations.length) {
    explanations.push('limited overlap across core pattern inputs')
  }

  return explanations.slice(0, 4)
}

function loadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function loadPatternDefinition(patternDir: string, patternId: string): PatternDefinition | null {
  const loaded = loadJson<PatternDefinition>(join(patternDir, `${patternId}.json`))
  if (!loaded || typeof loaded.pattern_id !== 'string') {
    return null
  }
  return loaded
}

export function detectPatternMatches(
  marketState: MarketState,
  options?: { rootDir?: string; limit?: number }
): PatternDetectionResult {
  const rootDir = options?.rootDir ?? process.cwd()
  const patternDir = join(rootDir, 'vr', 'patterns')
  const index = loadJson<PatternIndex>(join(patternDir, 'pattern_index.json'))

  if (!index || !Array.isArray(index.patterns)) {
    return {
      top_matches: [],
      evaluated_count: 0,
    }
  }

  const ranked = index.patterns
    .map((patternId) => {
      const pattern = loadPatternDefinition(patternDir, patternId)
      if (!pattern) {
        return null
      }

      const signature = pattern.signature ?? {}
      const duration = durationScore(marketState.duration_days, signature)
      const drawdown = drawdownScore(marketState, signature)
      const volatility = volatilityScore(marketState.volatility_regime, signature)
      const ma200 = ma200RelationScore(marketState.ma200_relation, signature)
      const context = contextScore(marketState, signature)

      const coreScore =
        duration * CORE_WEIGHTS.duration +
        drawdown * CORE_WEIGHTS.drawdown +
        volatility * CORE_WEIGHTS.volatility +
        ma200 * CORE_WEIGHTS.ma200_relation

      const score = coreScore * (1 - CONTEXT_WEIGHT) + context * CONTEXT_WEIGHT

      return {
        pattern_id: pattern.pattern_id,
        pattern_name: toPatternName(pattern.pattern_id),
        score: Number(score.toFixed(2)),
        explanation: buildExplanation(marketState, signature, {
          duration,
          drawdown,
          volatility,
          ma200,
          context,
        }),
      }
    })
    .filter((item): item is Exclude<typeof item, null> => item !== null)
    .sort((a, b) => b.score - a.score)

  const limit = options?.limit ?? 3

  return {
    top_matches: ranked.slice(0, limit),
    evaluated_count: ranked.length,
  }
}

export function listPatternSeeds(options?: { rootDir?: string }): string[] {
  const rootDir = options?.rootDir ?? process.cwd()
  const patternDir = join(rootDir, 'vr', 'patterns')
  const index = loadJson<PatternIndex>(join(patternDir, 'pattern_index.json'))
  return index?.patterns ?? []
}
