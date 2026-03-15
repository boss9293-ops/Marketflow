type PatternMatch = {
  pattern_id: string
  pattern_name: string
  score: number
  explanation?: string[]
}

type ScenarioBranch = {
  scenario_id: string
  scenario_name: string
  description: string
  posture_guidance: string[]
}

type VRDashboardPatternSummary = {
  snapshot?: {
    as_of_date: string
    market_pattern: string
    nasdaq_drawdown: string
    tqqq_drawdown: string
    ma200_status: string
    market_structure: string
    volatility_regime: string
    recommended_posture: string[]
  }
  posture_message?: {
    headline: string
    subline?: string
    posture_tags?: string[]
    tone: 'neutral' | 'cautious' | 'defensive' | 'improving'
  }
  historical_analogs?: {
    analog_events: Array<{
      event_id: string
      pattern_type: string
      similarity_score: number
      summary?: string
    }>
    top_pattern_summary?: string
    context_note?: string
  }
  top_matches: PatternMatch[]
  scenarios: ScenarioBranch[]
  suggested_posture?: string[]
}

type DashboardCase = {
  name: string
  summary: VRDashboardPatternSummary | null
  expectedPatterns: string[]
  expectedScenarios: string[]
  expectedPostureTerms: string[]
  expectedScenarioTypes?: string[]
  expectedTone?: 'neutral' | 'cautious' | 'defensive' | 'improving'
}

function includesAny(values: string[], expected: string[]) {
  return expected.some((item) => values.includes(item))
}

function classifyScenarioType(scenarioId: string, scenarioName: string, description: string) {
  const key = `${scenarioId} ${scenarioName} ${description}`.toLowerCase()

  if (
    key.includes('breakdown') ||
    key.includes('lower_low') ||
    key.includes('decline') ||
    key.includes('crash') ||
    key.includes('bear') ||
    key.includes('extended_correction')
  ) {
    return 'Downside Risk'
  }

  if (
    key.includes('recovery') ||
    key.includes('rally') ||
    key.includes('breakout') ||
    key.includes('bottom') ||
    key.includes('stabilization')
  ) {
    return 'Recovery Attempt'
  }

  return 'Neutral / Monitoring'
}

export function runDashboardSummaryExamples() {
  const cases: DashboardCase[] = [
    {
      name: 'Event Driven Box',
      summary: {
        snapshot: {
          as_of_date: '2026-03-13',
          market_pattern: 'Event Driven Box',
          nasdaq_drawdown: '-11.0%',
          tqqq_drawdown: '-31.0%',
          ma200_status: 'Breached MA200',
          market_structure: 'Range Market',
          volatility_regime: 'Elevated',
          recommended_posture: ['Maintain Pool Bias', 'Trial Entries Only', 'Avoid Chasing Strength'],
        },
        posture_message: {
          headline: 'Maintain pool bias while rebound quality remains mixed.',
          subline: 'Range behavior remains active and aggressive chasing is not preferred.',
          posture_tags: ['Maintain Pool Bias', 'Trial Entries Only', 'Wait For Confirmation'],
          tone: 'cautious',
        },
        historical_analogs: {
          analog_events: [
            {
              event_id: '2026-02',
              pattern_type: 'geopolitical_shock_range',
              similarity_score: 82,
              summary: 'Headline-driven reversals amplified leveraged drawdowns and reduced rebound reliability.',
            },
            {
              event_id: '2018-10',
              pattern_type: 'ma200_breach_correction',
              similarity_score: 74,
              summary: 'Once MA200 broke, leverage risk rose faster than many users expected and rebound quality required much stricter confirmation.',
            },
            {
              event_id: '2020-09',
              pattern_type: 'dead_cat_bounce',
              similarity_score: 66,
              summary: 'The first rebound was not enough to confirm recovery and leveraged entries required tighter discipline.',
            },
          ],
          top_pattern_summary: 'Geopolitical Shock Range / MA200 Breach Correction',
          context_note: 'These analogs suggest a headline-sensitive correction regime with unstable rebound quality.',
        },
        top_matches: [
          {
            pattern_id: 'event_driven_box',
            pattern_name: 'Event Driven Box',
            score: 0.81,
            explanation: ['drawdown profile fits'],
          },
          {
            pattern_id: 'geopolitical_shock_range',
            pattern_name: 'Geopolitical Shock Range',
            score: 0.64,
            explanation: ['headline sensitivity overlaps'],
          },
        ],
        scenarios: [
          {
            scenario_id: 'range_continuation',
            scenario_name: 'Range Continuation',
            description: 'The market may continue to move sideways while reacting to headlines.',
            posture_guidance: ['maintain pool', 'trial entries only'],
          },
          {
            scenario_id: 'support_breakdown',
            scenario_name: 'Support Breakdown',
            description: 'Selling pressure remains active and recent support is under pressure.',
            posture_guidance: ['raise pool bias', 'defensive posture'],
          },
          {
            scenario_id: 'relief_rally_breakout',
            scenario_name: 'Relief Rally Breakout',
            description: 'A relief rally may emerge, but failed follow-through remains a risk.',
            posture_guidance: ['trial entries only', 'reduce chase'],
          },
        ],
        suggested_posture: ['Maintain Pool Bias', 'Trial Entries Only', 'Avoid Chasing Strength'],
      },
      expectedPatterns: ['event_driven_box'],
      expectedScenarios: ['range_continuation', 'support_breakdown', 'relief_rally_breakout'],
      expectedPostureTerms: ['Maintain Pool Bias', 'Trial Entries Only'],
      expectedScenarioTypes: ['Neutral / Monitoring', 'Downside Risk', 'Recovery Attempt'],
      expectedTone: 'cautious',
    },
    {
      name: 'Fast crash state',
      summary: {
        snapshot: {
          as_of_date: '2020-03-23',
          market_pattern: 'Crash Cascade',
          nasdaq_drawdown: '-19.0%',
          tqqq_drawdown: '-52.0%',
          ma200_status: 'Breached MA200',
          market_structure: 'Vertical Drop',
          volatility_regime: 'Extreme',
          recommended_posture: ['Defensive Posture', 'Avoid Aggressive Buying', 'Trial Entries Only'],
        },
        posture_message: {
          headline: 'Defensive posture remains appropriate while breakdown risk stays elevated.',
          subline: 'Recent rebound behavior is not yet strong enough to confirm stabilization.',
          posture_tags: ['Defensive Posture', 'Preserve Capital', 'Avoid Aggressive Buying'],
          tone: 'defensive',
        },
        historical_analogs: {
          analog_events: [
            {
              event_id: '2020-02',
              pattern_type: 'crash_cascade',
              similarity_score: 88,
              summary: 'Crash-speed declines created leverage damage far beyond normal correction assumptions.',
            },
            {
              event_id: '2018-10',
              pattern_type: 'ma200_breach_correction',
              similarity_score: 61,
              summary: 'Once MA200 broke, leverage risk rose faster than many users expected and rebound quality required much stricter confirmation.',
            },
            {
              event_id: '2020-09',
              pattern_type: 'dead_cat_bounce',
              similarity_score: 52,
              summary: 'The first rebound was not enough to confirm recovery and leveraged entries required tighter discipline.',
            },
          ],
          top_pattern_summary: 'Crash Cascade / MA200 Breach Correction',
          context_note: 'These analogs suggest a crash-speed regime rather than a clean range reset.',
        },
        top_matches: [
          {
            pattern_id: 'crash_cascade',
            pattern_name: 'Crash Cascade',
            score: 0.91,
            explanation: ['drawdown profile fits'],
          },
          {
            pattern_id: 'leveraged_washout',
            pattern_name: 'Leveraged Washout',
            score: 0.83,
            explanation: ['volatility regime matches'],
          },
        ],
        scenarios: [
          {
            scenario_id: 'secondary_crash',
            scenario_name: 'Secondary Crash',
            description: 'A second downside leg remains plausible if support fails again.',
            posture_guidance: ['defensive posture', 'avoid aggressive buying'],
          },
          {
            scenario_id: 'panic_bottom',
            scenario_name: 'Panic Bottom',
            description: 'Selling may exhaust quickly, but instability remains high.',
            posture_guidance: ['raise pool bias', 'trial entries only'],
          },
          {
            scenario_id: 'dead_cat_bounce',
            scenario_name: 'Dead Cat Bounce',
            description: 'A rebound may occur, but lower-high failure risk remains elevated.',
            posture_guidance: ['reduce chase', 'trial entries only'],
          },
        ],
        suggested_posture: ['Defensive Posture', 'Avoid Aggressive Buying', 'Trial Entries Only'],
      },
      expectedPatterns: ['crash_cascade', 'leveraged_washout'],
      expectedScenarios: ['secondary_crash', 'panic_bottom', 'dead_cat_bounce'],
      expectedPostureTerms: ['Defensive Posture', 'Avoid Aggressive Buying'],
      expectedScenarioTypes: ['Downside Risk', 'Recovery Attempt'],
      expectedTone: 'defensive',
    },
    {
      name: 'Seasonal correction state',
      summary: {
        snapshot: {
          as_of_date: '2026-01-15',
          market_pattern: 'Seasonal Correction',
          nasdaq_drawdown: '-9.0%',
          tqqq_drawdown: '-24.0%',
          ma200_status: 'Testing MA200',
          market_structure: 'Slow Bleed',
          volatility_regime: 'Moderate',
          recommended_posture: ['Maintain Pool Bias', 'Trial Entries Only', 'Wait For Confirmation'],
        },
        posture_message: {
          headline: 'Controlled rebuild is possible only if recovery persistence continues to improve.',
          subline: 'The rebound is constructive, but confirmation is still required.',
          posture_tags: ['Controlled Rebuild', 'Wait For Confirmation', 'Reduce Chase'],
          tone: 'improving',
        },
        historical_analogs: {
          analog_events: [
            {
              event_id: '2024-04',
              pattern_type: 'seasonal_correction',
              similarity_score: 79,
              summary: 'A standard-looking correction still became materially painful for leveraged exposure once MA200 was lost.',
            },
            {
              event_id: '2025-01',
              pattern_type: 'seasonal_correction',
              similarity_score: 73,
              summary: 'Moderate index weakness still produced meaningful leveraged stress without confirming a full crash regime.',
            },
            {
              event_id: '2021-12',
              pattern_type: 'bull_trend_pullback',
              similarity_score: 64,
              summary: 'Even healthy bull-trend pullbacks can generate uncomfortable leverage stress before trend continuation becomes clear.',
            },
          ],
          top_pattern_summary: 'Seasonal Correction / Bull Trend Pullback',
          context_note: 'These analogs suggest a correction regime that still needs confirmation before assuming durable recovery.',
        },
        top_matches: [
          {
            pattern_id: 'seasonal_correction',
            pattern_name: 'Seasonal Correction',
            score: 0.72,
            explanation: ['duration fits'],
          },
          {
            pattern_id: 'slow_grind_correction',
            pattern_name: 'Slow Grind Correction',
            score: 0.61,
            explanation: ['drawdown partially fits'],
          },
        ],
        scenarios: [
          {
            scenario_id: 'recovery',
            scenario_name: 'Recovery',
            description: 'A rebound is possible, but confirmation remains limited.',
            posture_guidance: ['trial entries only', 'observe / wait for confirmation'],
          },
          {
            scenario_id: 'extended_correction',
            scenario_name: 'Extended Correction',
            description: 'Weakness may persist in a broader corrective structure.',
            posture_guidance: ['maintain pool', 'observe / wait for confirmation'],
          },
          {
            scenario_id: 'dead_cat_bounce',
            scenario_name: 'Dead Cat Bounce',
            description: 'A rebound may occur, but lower-high failure risk remains elevated.',
            posture_guidance: ['reduce chase', 'trial entries only'],
          },
        ],
        suggested_posture: ['Maintain Pool Bias', 'Trial Entries Only', 'Wait For Confirmation'],
      },
      expectedPatterns: ['seasonal_correction', 'slow_grind_correction'],
      expectedScenarios: ['recovery', 'extended_correction', 'dead_cat_bounce'],
      expectedPostureTerms: ['Maintain Pool Bias', 'Trial Entries Only'],
      expectedScenarioTypes: ['Recovery Attempt', 'Downside Risk'],
      expectedTone: 'improving',
    },
    {
      name: 'Fallback empty state',
      summary: null,
      expectedPatterns: [],
      expectedScenarios: [],
      expectedPostureTerms: [],
    },
  ]

  return cases.map((testCase) => {
    const patternIds = testCase.summary?.top_matches.map((item) => item.pattern_id) ?? []
    const scenarioIds = testCase.summary?.scenarios.map((item) => item.scenario_id) ?? []
    const scenarioTypes =
      testCase.summary?.scenarios.map((item) =>
        classifyScenarioType(item.scenario_id, item.scenario_name, item.description)
      ) ?? []
    const posture = testCase.summary?.suggested_posture ?? []
    const postureMessage = testCase.summary?.posture_message ?? null
    const analogIds = testCase.summary?.historical_analogs?.analog_events.map((item) => item.event_id) ?? []

    return {
      name: testCase.name,
      passed:
        (testCase.summary === null || testCase.expectedPatterns.every((item) => patternIds.includes(item))) &&
        (testCase.summary === null || testCase.expectedScenarios.every((item) => scenarioIds.includes(item))) &&
        (testCase.summary === null || includesAny(posture, testCase.expectedPostureTerms)) &&
        (testCase.summary === null ||
          (testCase.expectedScenarioTypes ?? []).every((item) => scenarioTypes.includes(item))) &&
        (testCase.summary === null || !testCase.expectedTone || postureMessage?.tone === testCase.expectedTone) &&
        (testCase.summary === null || !postureMessage || (postureMessage.posture_tags?.length ?? 0) <= 3) &&
        (testCase.summary === null || Boolean(testCase.summary.snapshot)) &&
        analogIds.length <= 3 &&
        patternIds.length <= 3 &&
        scenarioIds.length <= 3,
      pattern_ids: patternIds,
      scenario_ids: scenarioIds,
      scenario_types: scenarioTypes,
      analog_ids: analogIds,
      posture_tone: postureMessage?.tone,
      suggested_posture: posture,
    }
  })
}
