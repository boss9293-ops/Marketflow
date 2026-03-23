import { detectPatternMatches, type PatternDetectionResult } from '../../engine/pattern_detector'
import { buildExecutionPlayback } from './build_execution_playback'
import { buildEventCycleFramework } from './build_event_cycle_framework'
import { mapScenarioPlaybook } from '../playbooks/playbook_mapper'
import { initializeEventState } from '../scenario/initialize_event_state'
import { resolveVREventInterpretation, type TaggedVREvent, type VRSupportStatus } from './vr_event_interpreter'
import type { ScenarioPlaybookResult } from '../types/scenario'
import type { ExecutionPlaybackCollection } from '../types/execution_playback'
import type { EventInitializationScenario } from '../types/event_initial_state'
import type { EventCycleFramework } from '../types/event_replay_cycle'

type StandardPlaybackPoint = {
  d: string
  qqq_n: number | null
  ma50_n: number | null
  ma200_n: number | null
  tqqq_n: number | null
  dd: number | null
  tqqq_dd: number | null
  score: number | null
  level: number
  in_ev: boolean
  ev_type?: string
}

type SurvivalPlaybackPoint = {
  d: string
  qqq_n: number
  ma50_n: number
  ma200_n: number
  score: number
  level: number
  state: string
  pool_pct: number
  exposure_pct: number
  bh_10k: number
  vr_10k: number
  in_ev: boolean
  dd_pct: number
}

export type RawStandardPlaybackArchive = {
  run_id: string
  events: Array<{
    id: number
    name: string
    start: string
    end: string
    event_type?: string
    explanation?: string
    playback: StandardPlaybackPoint[]
  }>
}

export type RawVRSurvivalPlaybackArchive = {
  run_id: string
  events: Array<{
    id: number
    name: string
    start: string
    end: string
    stats?: {
      bh_trough?: number
      vr_trough?: number
      bh_final?: number
      vr_final?: number
      capital_saved_pct?: number
    }
    playback: SurvivalPlaybackPoint[]
  }>
}

export type VRPlaybackEventView = {
  id: string
  suite_id: string
  event_id: string
  name: string
  archive_name: string
  suite_group: 'Crash Tests' | 'Leverage Stress' | 'Corrections'
  suite_note: string
  start: string
  end: string
  duration_days: number
  standard_context?: string
  standard_explanation?: string
  vr_support_status: VRSupportStatus
  placeholder_messages: string[]
  chart_data: Array<{
    date: string
    qqq_n: number | null
    tqqq_n: number | null
    ma50_n: number | null
    ma200_n: number | null
    qqq_dd: number | null
    tqqq_dd: number | null
    score: number | null
    level: number | null
    in_event: boolean
  }>
  leveraged_stress: {
    qqq_drawdown_pct: number | null
    tqqq_drawdown_pct: number | null
    amplification: number | null
    real_tqqq_available: boolean
    tqqq_source: 'real' | 'synthetic' | 'unavailable'
  }
  recovery_path: {
    rebound_strength_pct: number | null
    rebound_persistence: string
    lower_high_failure_risk: string
    secondary_drawdown_risk: string
  }
  vr_tagged_event: TaggedVREvent
  pattern_matches: PatternDetectionResult
  scenario_playbook: ScenarioPlaybookResult
  cycle_start: EventInitializationScenario
  cycle_framework: EventCycleFramework
  execution_playback: ExecutionPlaybackCollection
}

export type VRPlaybackView = {
  events: VRPlaybackEventView[]
  archive_event_count: number
}

const CURATED_PLAYBACK_SUITE: Array<{
  suite_id: string
  event_id: string
  display_name: string
  group: 'Crash Tests' | 'Leverage Stress' | 'Corrections'
  note: string
}> = [
  {
    suite_id: '2020-02-covid-crash',
    event_id: '2020-02',
    display_name: '2020-02 COVID Crash',
    group: 'Crash Tests',
    note: 'Fast crash survival benchmark for leveraged drawdown and rebound failure risk.',
  },
  {
    suite_id: '2022-bear-market',
    event_id: '2021-12',
    display_name: '2022 Bear Market',
    group: 'Crash Tests',
    note: 'Uses the 2021-12 anchor to study the 2022 bear-market follow-through and prolonged weakness.',
  },
  {
    suite_id: '2008-09-gfc',
    event_id: '2007-07',
    display_name: '2008-09 GFC',
    group: 'Crash Tests',
    note: 'Uses the 2007-07 anchor to study the GFC crash and deep survival stress.',
  },
  {
    suite_id: '2018-10-volatility-shock',
    event_id: '2018-10',
    display_name: '2018-10 Volatility Shock',
    group: 'Leverage Stress',
    note: 'MA200 breach and volatility-shock benchmark for leverage stress behavior.',
  },
  {
    suite_id: '2011-08-debt-crisis',
    event_id: '2011-06',
    display_name: '2011-08 Debt Crisis',
    group: 'Leverage Stress',
    note: 'Uses the 2011-06 anchor to study the debt-crisis leverage shock sequence.',
  },
  {
    suite_id: '2015-08-china-shock',
    event_id: '2015-08',
    display_name: '2015-08 China Shock',
    group: 'Leverage Stress',
    note: 'Gap risk and rapid leverage-stress test around the China shock.',
  },
  {
    suite_id: '2024-07-yen-carry-unwind',
    event_id: '2024-07',
    display_name: '2024-07 Yen Carry Unwind',
    group: 'Leverage Stress',
    note: 'FX carry unwind and global leverage repositioning stress.',
  },
  {
    suite_id: '2021-12-liquidity-shift',
    event_id: '2021-12',
    display_name: '2021-12 Liquidity Shift',
    group: 'Corrections',
    note: 'Liquidity-shift correction lens using the same 2021-12 replay anchor.',
  },
  {
    suite_id: '2019-05-trade-war-dip',
    event_id: '2019-05',
    display_name: '2019-05 Trade War Dip',
    group: 'Corrections',
    note: 'Trade-war correction benchmark for controlled dip and recovery response.',
  },
  {
    suite_id: '2025-03-tariff-shock',
    event_id: '2025-01',
    display_name: '2025-03 Tariff Shock',
    group: 'Corrections',
    note: 'Trade policy shock and tariff escalation volatility episode.',
  },
  {
    suite_id: '2025-03-fragile-recovery',
    event_id: '2025-03',
    display_name: '2025-03 Fragile Recovery',
    group: 'Corrections',
    note: 'Post-shock rebound sequence with fragile stabilization and renewed downside sensitivity.',
  },
]

function countRealTqqqPoints(event: RawStandardPlaybackArchive['events'][number]) {
  return event.playback.filter((point) => typeof point.tqqq_n === 'number' || typeof point.tqqq_dd === 'number').length
}

function computeSupportStatus(event: RawStandardPlaybackArchive['events'][number]): VRSupportStatus {
  const year = Number(event.start.slice(0, 4))
  if (!Number.isFinite(year)) {
    return 'partial'
  }

  if (year < 2010) {
    return 'partial'
  }

  const realTqqqPoints = countRealTqqqPoints(event)
  if (realTqqqPoints > 0) {
    return 'ready'
  }

  return 'partial'
}

function buildSyntheticTqqqProxy(points: StandardPlaybackPoint[]) {
  let syntheticN: number | null = null
  let syntheticPeak: number | null = null

  return points.map((point, index) => {
    const prevQqq = index > 0 ? points[index - 1]?.qqq_n : null
    const currentQqq = point.qqq_n

    if (typeof currentQqq !== 'number') {
      return { tqqq_n: null, tqqq_dd: null }
    }

    if (syntheticN == null) {
      syntheticN = typeof point.qqq_n === 'number' && point.qqq_n > 0 ? point.qqq_n : 100
      syntheticPeak = syntheticN
    } else if (typeof prevQqq === 'number' && prevQqq > 0) {
      const qqqReturn = (currentQqq - prevQqq) / prevQqq
      syntheticN = Math.max(1, syntheticN * (1 + qqqReturn * 3))
      syntheticPeak = Math.max(syntheticPeak ?? syntheticN, syntheticN)
    }

    const tqqqDd =
      syntheticPeak && syntheticPeak > 0
        ? Number((((syntheticN - syntheticPeak) / syntheticPeak) * 100).toFixed(2))
        : null

    return {
      tqqq_n: Number(syntheticN.toFixed(2)),
      tqqq_dd: tqqqDd,
    }
  })
}

function computeReboundStrength(event: RawStandardPlaybackArchive['events'][number]) {
  const points = event.playback.filter((point) => point.in_ev && typeof point.qqq_n === 'number')
  if (!points.length) return null
  const trough = Math.min(...points.map((point) => point.qqq_n as number))
  const last = points[points.length - 1]?.qqq_n
  if (typeof last !== 'number' || trough <= 0) return null
  return Number((((last - trough) / trough) * 100).toFixed(1))
}

function computeRecoveryPath(event: RawStandardPlaybackArchive['events'][number]) {
  const reboundStrength = computeReboundStrength(event)
  return {
    rebound_strength_pct: reboundStrength,
    rebound_persistence:
      reboundStrength == null ? 'unavailable'
      : reboundStrength >= 12 ? 'improving'
      : reboundStrength >= 5 ? 'mixed'
      : 'weak',
    lower_high_failure_risk:
      reboundStrength == null ? 'unavailable'
      : reboundStrength >= 12 ? 'medium'
      : 'high',
    secondary_drawdown_risk:
      Math.min(...event.playback.map((point) => point.dd ?? 0)) <= -15 ? 'high' : 'medium',
  }
}

function inferDetectorInput(
  event: RawStandardPlaybackArchive['events'][number],
  syntheticTqqqDrawdownPct?: number | null
) {
  const durationDays = event.playback.filter((point) => point.in_ev).length || event.playback.length
  const qqqDrawdown = Math.min(...event.playback.map((point) => point.dd ?? 0)) / 100
  const tqqqSeries = event.playback
    .map((point) => point.tqqq_dd)
    .filter((value): value is number => typeof value === 'number')
  const tqqqDrawdown =
    tqqqSeries.length
      ? Math.min(...tqqqSeries) / 100
      : typeof syntheticTqqqDrawdownPct === 'number'
        ? syntheticTqqqDrawdownPct / 100
        : qqqDrawdown * 3
  const breachPoints = event.playback.filter(
    (point) =>
      typeof point.qqq_n === 'number' &&
      typeof point.ma200_n === 'number' &&
      point.qqq_n < point.ma200_n
  ).length

  return {
    nasdaq_drawdown: Number(qqqDrawdown.toFixed(4)),
    tqqq_drawdown: Number(tqqqDrawdown.toFixed(4)),
    duration_days: durationDays,
    ma200_relation: breachPoints >= 10 ? 'below' : breachPoints > 0 ? 'breach' : 'tested',
    volatility_regime:
      Math.abs(qqqDrawdown) >= 0.18 ? 'extreme'
      : Math.abs(qqqDrawdown) >= 0.1 ? 'high'
      : Math.abs(qqqDrawdown) >= 0.06 ? 'elevated'
      : 'moderate',
    price_structure:
      durationDays <= 15 && Math.abs(qqqDrawdown) >= 0.15 ? 'vertical_drop'
      : durationDays >= 35 && Math.abs(qqqDrawdown) >= 0.1 ? 'slow_bleed'
      : Math.abs(qqqDrawdown) <= 0.12 && durationDays >= 20 ? 'range_market'
      : breachPoints > 0 ? 'breakdown_retest'
      : 'trend_down',
    catalyst_type:
      event.name.includes('2026-02') || event.name.includes('2024-07')
        ? 'geopolitical_event'
        : event.name.includes('2020-02')
          ? 'volatility_spike'
          : undefined,
    rebound_behavior:
      computeReboundStrength(event) == null ? 'none'
      : (computeReboundStrength(event) as number) >= 12 ? 'strong'
      : (computeReboundStrength(event) as number) >= 5 ? 'mixed'
      : 'weak',
    trend_persistence:
      durationDays >= 30 && Math.abs(qqqDrawdown) >= 0.1 ? 'down'
      : durationDays >= 20 ? 'sideways'
      : 'up',
  } as const
}

export type VRPlaybackEventOverrides = {
  event_id: string
  simulation_start_date?: string
  initial_capital?: number
  stock_allocation_pct?: number
}

export function buildVRPlaybackView(input: {
  standardArchive: RawStandardPlaybackArchive | null
  survivalArchive: RawVRSurvivalPlaybackArchive | null
  rootDir: string
  eventOverrides?: VRPlaybackEventOverrides
}): VRPlaybackView | null {
  if (!input.standardArchive?.events?.length) return null

  const rawEventViews = input.standardArchive.events.map((event) => {
    const supportStatus = computeSupportStatus(event)
    const realTqqqPoints = countRealTqqqPoints(event)
    const syntheticProxy = Number(event.start.slice(0, 4)) < 2010 && realTqqqPoints === 0
    const syntheticTqqq = syntheticProxy ? buildSyntheticTqqqProxy(event.playback) : null
    const chartData = event.playback.map((point, index) => ({
      date: point.d,
      qqq_n: point.qqq_n,
      tqqq_n: syntheticProxy ? syntheticTqqq?.[index]?.tqqq_n ?? null : point.tqqq_n,
      ma50_n: point.ma50_n,
      ma200_n: point.ma200_n,
      qqq_dd: point.dd,
      tqqq_dd: syntheticProxy ? syntheticTqqq?.[index]?.tqqq_dd ?? null : point.tqqq_dd,
      score: typeof point.score === 'number' ? point.score : null,
      level: typeof point.level === 'number' ? point.level : null,
      in_event: point.in_ev,
    }))
    const qqqDrawdownPct = chartData.reduce((min, point) => {
      if (typeof point.qqq_dd !== 'number') return min
      return min == null ? point.qqq_dd : Math.min(min, point.qqq_dd)
    }, null as number | null)
    const tqqqDrawdownPct = chartData.reduce((min, point) => {
      if (typeof point.tqqq_dd !== 'number') return min
      return min == null ? point.tqqq_dd : Math.min(min, point.tqqq_dd)
    }, null as number | null)

    const detectorInput = inferDetectorInput(event, tqqqDrawdownPct)
    const patternMatches = detectPatternMatches(detectorInput, { rootDir: input.rootDir, limit: 3 })
    const scenarioPlaybook = mapScenarioPlaybook(patternMatches, { rootDir: input.rootDir, maxScenarios: 3 })

    const ma200Status =
      detectorInput.ma200_relation === 'below' ? 'Sustained Below MA200'
      : detectorInput.ma200_relation === 'breach' ? 'Breached MA200'
      : detectorInput.ma200_relation === 'tested' ? 'Testing MA200'
      : 'Above MA200'

    const reboundStrengthPct = computeReboundStrength(event)
    const vrTaggedEvent = resolveVREventInterpretation({
      rootDir: input.rootDir,
      eventName: event.name,
      supportStatus,
      syntheticProxy,
      patternMatches,
      ma200Status,
      tqqqDrawdownPct,
      reboundStrengthPct,
    })
    const eventId = event.start.slice(0, 7)
    const ov = input.eventOverrides?.event_id === eventId ? input.eventOverrides : undefined
    const cycleStart = initializeEventState({
      rootDir: input.rootDir,
      eventId,
      eventStartDate: event.start,
      eventEndDate: event.end,
      overrides: ov ? {
        simulation_start_date: ov.simulation_start_date,
        initial_capital: ov.initial_capital,
        stock_allocation_pct: ov.stock_allocation_pct != null ? ov.stock_allocation_pct / 100 : undefined,
        pool_allocation_pct: ov.stock_allocation_pct != null ? 1 - ov.stock_allocation_pct / 100 : undefined,
      } : undefined,
    })

    const placeholderMessages =
      supportStatus === 'pending_synthetic'
        ? [
            'TQQQ-specific VR playback is not yet available for this historical event.',
            'Synthetic TQQQ proxy support is pending.',
          ]
        : syntheticProxy
          ? [
              'TQQQ-specific VR playback is using a QQQ 3x synthetic proxy for this historical event.',
              'Real TQQQ history was not available before 2010.',
            ]
        : supportStatus === 'partial'
          ? ['VR playback is only partially available for this event. Missing sections are shown as placeholders.']
          : []

    const baseEventView = {
      id: `${event.id}`,
      suite_id: eventId,
      event_id: eventId,
      name: event.name,
      archive_name: event.name,
      suite_group: 'Corrections' as const,
      suite_note: '',
      start: event.start,
      end: event.end,
      duration_days: event.playback.filter((point) => point.in_ev).length || event.playback.length,
      standard_context: event.event_type,
      standard_explanation: event.explanation,
      vr_support_status: supportStatus,
      placeholder_messages: placeholderMessages,
      chart_data: chartData,
      leveraged_stress: {
        qqq_drawdown_pct: qqqDrawdownPct,
        tqqq_drawdown_pct: tqqqDrawdownPct,
        amplification:
          qqqDrawdownPct != null && tqqqDrawdownPct != null && qqqDrawdownPct !== 0
            ? Number((Math.abs(tqqqDrawdownPct) / Math.abs(qqqDrawdownPct)).toFixed(2))
            : null,
        real_tqqq_available: realTqqqPoints > 0,
        tqqq_source: realTqqqPoints > 0 ? 'real' : syntheticProxy ? 'synthetic' : 'unavailable',
      },
      recovery_path: computeRecoveryPath(event),
      vr_tagged_event: vrTaggedEvent,
      pattern_matches: patternMatches,
      scenario_playbook: scenarioPlaybook,
      cycle_start: cycleStart,
    }
    const eventView = {
      ...baseEventView,
      cycle_framework: buildEventCycleFramework({ event: baseEventView }),
    }
    return {
      ...eventView,
      execution_playback: buildExecutionPlayback(eventView),
    }
  })

  const eventById = new Map(rawEventViews.map((event) => [event.event_id, event]))
  const curatedEvents = CURATED_PLAYBACK_SUITE.map((suite, index) => {
    const base = eventById.get(suite.event_id)
    if (!base) return null
    return {
      ...base,
      id: `${base.id}-${suite.suite_id}-${index + 1}`,
      suite_id: suite.suite_id,
      name: suite.display_name,
      archive_name: base.archive_name,
      suite_group: suite.group,
      suite_note: suite.note,
    }
  }).filter(Boolean) as VRPlaybackEventView[]

  return { events: curatedEvents, archive_event_count: input.standardArchive.events.length }
}

export function runVRPlaybackReadinessExamples(view: VRPlaybackView | null) {
  const cases = [
    { name: '2026-02 Risk Event', expected: 'ready' },
    { name: '2018-10 Risk Event', expected: 'ready' },
    { name: '1999-04 Risk Event', expected: 'partial' },
  ] as const

  return cases.map((testCase) => {
    const event = view?.events.find((item) => item.name === testCase.name) ?? null
    return {
      name: testCase.name,
      passed:
        event?.vr_support_status === testCase.expected &&
        (event?.vr_support_status !== 'partial' || event.placeholder_messages.length > 0),
      vr_support_status: event?.vr_support_status ?? null,
      has_patterns: (event?.pattern_matches.top_matches.length ?? 0) > 0,
      has_scenarios: (event?.scenario_playbook.scenarios.length ?? 0) > 0,
    }
  })
}
