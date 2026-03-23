import { writeFileSync } from 'fs'
import { join } from 'path'
import type { PatternMatch } from '../../engine/pattern_detector'
import { loadPriorityEventTags } from '../playback/load_priority_event_tags'
import type { MarketState } from '../types/market_state'
import type { PriorityEventVRTag } from '../types/priority_event_vr_tag'
import { scoreEventSimilarity, type CurrentAnalogFeatures } from './score_event_similarity'

export type CurrentMarketAnalog = {
  event_id: string
  pattern_type: string
  similarity_score: number
  summary?: string
}

export type CurrentMarketAnalogResult = {
  as_of_date: string
  analog_events: CurrentMarketAnalog[]
  top_pattern_summary?: string
  context_note?: string
}

function titleize(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function lowercaseFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value
}

function mapMA200Status(value: MarketState['ma200_relation']): PriorityEventVRTag['vr_analysis']['ma200_status'] {
  if (value === 'test') return 'tested'
  if (value === 'breach') return 'breached'
  if (value === 'sustained_below') return 'sustained_below'
  return 'above'
}

function mapLeverageStress(drawdown: number): PriorityEventVRTag['vr_analysis']['leverage_stress'] {
  const magnitude = Math.abs(drawdown)
  if (magnitude >= 0.5) return 'extreme'
  if (magnitude >= 0.25) return 'high'
  if (magnitude >= 0.12) return 'medium'
  return 'low'
}

function mapRecoveryQuality(state: MarketState): PriorityEventVRTag['vr_analysis']['recovery_quality'] {
  if (state.rebound_behavior === 'strong' && state.trend_persistence === 'stable') return 'strong'
  if (state.rebound_behavior === 'strong' || state.rebound_behavior === 'mixed') return 'improving'
  if (state.rebound_behavior === 'failed') return 'weak'
  if (state.rebound_behavior === 'weak') return 'mixed'
  return 'weak'
}

function deriveCurrentTags(state: MarketState): string[] {
  const tags = new Set<string>()

  tags.add(state.price_structure)

  if (state.ma200_relation === 'breach' || state.ma200_relation === 'sustained_below') {
    tags.add('ma200_breach')
  }
  if (state.event_dependency === 'geopolitical_headline') {
    tags.add('headline_driven')
  }
  if (state.event_dependency === 'liquidity_shock') {
    tags.add('panic_selling')
  }
  if (state.event_dependency === 'volatility_spike') {
    tags.add('extreme_volatility')
  }
  if (state.price_structure === 'vertical_drop') {
    tags.add('vertical_drop')
  }
  if (state.price_structure === 'slow_bleed') {
    tags.add('slow_bleed')
  }
  if (state.price_structure === 'range_market') {
    tags.add('range_market')
  }
  if (state.price_structure === 'sideways') {
    tags.add('sideways')
  }
  if (state.trend_persistence === 'persistent_down') {
    tags.add('persistent_down')
  }
  if (state.rebound_behavior === 'failed') {
    tags.add('failed_recovery')
  }

  return [...tags]
}

export function buildCurrentAnalogFeatures(input: {
  marketState: MarketState
  topPattern?: PatternMatch | null
}): CurrentAnalogFeatures {
  return {
    pattern_type: input.topPattern?.pattern_id,
    ma200_status: mapMA200Status(input.marketState.ma200_relation),
    leverage_stress: mapLeverageStress(input.marketState.tqqq_drawdown),
    recovery_quality: mapRecoveryQuality(input.marketState),
    tags: deriveCurrentTags(input.marketState),
  }
}

export function computeCurrentMarketAnalogs(input: {
  rootDir: string
  marketState: MarketState
  topPattern?: PatternMatch | null
  minScore?: number
  preloadedStandard?: { events?: Array<{ name?: string }> } | null
}): CurrentMarketAnalogResult {
  const minScore = input.minScore ?? 40
  const tags = Object.values(loadPriorityEventTags(input.rootDir, input.preloadedStandard))
  const current = buildCurrentAnalogFeatures({
    marketState: input.marketState,
    topPattern: input.topPattern,
  })

  const analogEvents = tags
    .map((event) => ({
      event_id: event.event_id,
      pattern_type: event.vr_analysis.pattern_type,
      similarity_score: scoreEventSimilarity(current, event),
      summary: event.vr_analysis.lesson,
    }))
    .filter((event) => event.similarity_score > minScore)
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, 3)

  const summaryPatterns = analogEvents.slice(0, 2).map((event) => titleize(event.pattern_type))
  const topPatternSummary = summaryPatterns.length ? summaryPatterns.join(' / ') : undefined
  const contextNote = analogEvents[0]?.summary
    ? `These analogs suggest ${lowercaseFirst(analogEvents[0].summary ?? '')}`
    : undefined

  return {
    as_of_date: input.marketState.as_of_date,
    analog_events: analogEvents,
    top_pattern_summary: topPatternSummary,
    context_note: contextNote,
  }
}

export function writeCurrentMarketAnalogsJson(rootDir: string, result: CurrentMarketAnalogResult) {
  const outputPath = join(rootDir, 'vr', 'analog', 'current_market_analogs.json')
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8')
  return outputPath
}

export function runCurrentMarketAnalogExamples() {
  const cases: Array<{ name: string; features: CurrentAnalogFeatures; historical: PriorityEventVRTag; minScore: number }> = [
    {
      name: 'Crash-like market',
      features: {
        pattern_type: 'crash_cascade',
        ma200_status: 'breached',
        leverage_stress: 'extreme',
        recovery_quality: 'weak',
        tags: ['vertical_drop', 'panic_selling', 'extreme_volatility'],
      },
      historical: {
        event_id: '2020-02',
        vr_support_status: 'ready',
        vr_analysis: {
          pattern_type: 'crash_cascade',
          ma200_status: 'breached',
          leverage_stress: 'extreme',
          recovery_quality: 'weak',
          tags: ['leveraged_washout', 'panic_selling', 'vertical_drop', 'extreme_volatility'],
          lesson: 'x',
          scenario_bias: ['panic_bottom'],
          playbook_bias: ['defensive_posture'],
        },
      },
      minScore: 70,
    },
    {
      name: 'MA200 breakdown correction',
      features: {
        pattern_type: 'ma200_breach_correction',
        ma200_status: 'breached',
        leverage_stress: 'high',
        recovery_quality: 'mixed',
        tags: ['ma200_breach', 'failed_recovery', 'correction_phase'],
      },
      historical: {
        event_id: '2018-10',
        vr_support_status: 'ready',
        vr_analysis: {
          pattern_type: 'ma200_breach_correction',
          ma200_status: 'breached',
          leverage_stress: 'high',
          recovery_quality: 'mixed',
          tags: ['ma200_breach', 'failed_recovery', 'correction_phase'],
          lesson: 'x',
          scenario_bias: ['support_recovery'],
          playbook_bias: ['trial_entries_only'],
        },
      },
      minScore: 70,
    },
    {
      name: 'Range market',
      features: {
        pattern_type: 'geopolitical_shock_range',
        ma200_status: 'breached',
        leverage_stress: 'high',
        recovery_quality: 'weak',
        tags: ['event_driven_box', 'range_market', 'headline_driven', 'ma200_breach'],
      },
      historical: {
        event_id: '2026-02',
        vr_support_status: 'ready',
        vr_analysis: {
          pattern_type: 'geopolitical_shock_range',
          ma200_status: 'breached',
          leverage_stress: 'high',
          recovery_quality: 'weak',
          tags: ['event_driven_box', 'range_market', 'headline_driven', 'ma200_breach'],
          lesson: 'x',
          scenario_bias: ['range_continuation'],
          playbook_bias: ['maintain_pool_bias'],
        },
      },
      minScore: 80,
    },
  ]

  return cases.map((testCase) => ({
    name: testCase.name,
    score: scoreEventSimilarity(testCase.features, testCase.historical),
    passed: scoreEventSimilarity(testCase.features, testCase.historical) >= testCase.minScore,
  }))
}
