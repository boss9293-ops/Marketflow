import type { MarketState } from '../types/market_state'

export type VRPostureMessage = {
  headline: string
  subline?: string
  posture_tags?: string[]
  tone: 'neutral' | 'cautious' | 'defensive' | 'improving'
}

type ScenarioInput = {
  scenario_id: string
  scenario_name: string
  description: string
  posture_guidance: string[]
}

type BuildPostureMessageInput = {
  marketState: MarketState
  primaryPatternName?: string
  scenarios: ScenarioInput[]
  suggestedPosture?: string[]
}

type ScenarioType = 'Downside Risk' | 'Neutral / Monitoring' | 'Recovery Attempt'

function classifyScenarioType(scenario: ScenarioInput): ScenarioType {
  const key = `${scenario.scenario_id} ${scenario.scenario_name} ${scenario.description}`.toLowerCase()

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

function titleize(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizePostureTags(tags?: string[]) {
  return (tags ?? []).slice(0, 3).map(titleize)
}

export function buildPostureMessage(input: BuildPostureMessageInput): VRPostureMessage {
  const scenarios = input.scenarios.slice(0, 3)
  const types = scenarios.map(classifyScenarioType)
  const downsideCount = types.filter((type) => type === 'Downside Risk').length
  const recoveryCount = types.filter((type) => type === 'Recovery Attempt').length
  const neutralCount = types.filter((type) => type === 'Neutral / Monitoring').length
  const postureTags = normalizePostureTags(input.suggestedPosture)
  const hasDefensiveLanguage = (input.suggestedPosture ?? []).some((tag) =>
    ['defensive_posture', 'preserve_capital', 'avoid_aggressive_buying'].includes(tag)
  )
  const hasImprovingLanguage = (input.suggestedPosture ?? []).some((tag) =>
    ['controlled_rebuild_only', 'reduce_chase', 'wait_for_confirmation'].includes(tag)
  )

  const tone: VRPostureMessage['tone'] =
    downsideCount > recoveryCount &&
    (input.marketState.ma200_relation === 'breach' ||
      input.marketState.ma200_relation === 'sustained_below' ||
      Math.abs(input.marketState.tqqq_drawdown) >= 0.25 ||
      hasDefensiveLanguage)
      ? 'defensive'
      : recoveryCount > downsideCount &&
          input.marketState.rebound_behavior !== 'failed' &&
          (input.marketState.rebound_behavior === 'strong' ||
            input.marketState.rebound_behavior === 'mixed' ||
            hasImprovingLanguage)
        ? 'improving'
        : neutralCount > 0 ||
            input.marketState.price_structure === 'range_market' ||
            input.marketState.price_structure === 'slow_bleed' ||
            input.marketState.rebound_behavior === 'weak' ||
            input.marketState.rebound_behavior === 'mixed'
          ? 'cautious'
          : 'neutral'

  if (!scenarios.length) {
    return {
      headline: 'No posture summary available yet.',
      subline: 'Current scenario interpretation is still loading.',
      posture_tags: postureTags,
      tone: 'neutral',
    }
  }

  if (tone === 'defensive') {
    return {
      headline: 'Defensive posture remains appropriate while breakdown risk stays elevated.',
      subline:
        input.marketState.rebound_behavior === 'failed' || input.marketState.rebound_behavior === 'weak'
          ? 'Recent rebound behavior is not yet strong enough to confirm stabilization.'
          : 'Downside-heavy scenario paths still argue against aggressive buying.',
      posture_tags: postureTags,
      tone,
    }
  }

  if (tone === 'improving') {
    return {
      headline: 'Controlled rebuild is possible only if recovery persistence continues to improve.',
      subline:
        input.marketState.rebound_behavior === 'strong'
          ? 'The rebound is constructive, but confirmation is still required.'
          : 'Recovery paths are visible, but trend confirmation is still incomplete.',
      posture_tags: postureTags,
      tone,
    }
  }

  if (tone === 'cautious') {
    return {
      headline: 'Maintain pool bias while rebound quality remains mixed.',
      subline:
        input.marketState.price_structure === 'range_market'
          ? 'Range behavior remains active and aggressive chasing is not preferred.'
          : 'The structure remains unresolved, so posture should stay confirmation-based.',
      posture_tags: postureTags,
      tone,
    }
  }

  return {
    headline: 'Current posture remains balanced while the structure stays under review.',
    subline:
      input.primaryPatternName
        ? `${input.primaryPatternName} remains the leading reference, but no single path dominates.`
        : 'Current scenario interpretation remains observational rather than directional.',
    posture_tags: postureTags,
    tone,
  }
}

export function runPostureMessageExamples() {
  const baseScenarios = [
    {
      scenario_id: 'range_continuation',
      scenario_name: 'Range Continuation',
      description: 'The market may continue to move sideways while reacting to headlines.',
      posture_guidance: ['maintain_pool_bias', 'trial_entries_only'],
    },
  ]

  return [
    buildPostureMessage({
      marketState: {
        as_of_date: '2026-03-14',
        nasdaq_drawdown: -0.1,
        tqqq_drawdown: -0.28,
        duration_days: 22,
        ma200_relation: 'breach',
        volatility_regime: 'elevated',
        price_structure: 'range_market',
        event_dependency: 'geopolitical_headline',
        rebound_behavior: 'mixed',
        trend_persistence: 'persistent_range',
      },
      primaryPatternName: 'Geopolitical Shock Range',
      scenarios: [
        ...baseScenarios,
        {
          scenario_id: 'support_breakdown',
          scenario_name: 'Support Breakdown',
          description: 'The lower range boundary fails and downside pressure resumes.',
          posture_guidance: ['maintain_pool_bias', 'trial_entries_only'],
        },
        {
          scenario_id: 'relief_rally_breakout',
          scenario_name: 'Relief Rally Breakout',
          description: 'A rebound pushes above the range, but confirmation is still required.',
          posture_guidance: ['wait_for_confirmation'],
        },
      ],
      suggestedPosture: ['maintain_pool_bias', 'trial_entries_only', 'wait_for_confirmation'],
    }),
    buildPostureMessage({
      marketState: {
        as_of_date: '2026-03-14',
        nasdaq_drawdown: -0.18,
        tqqq_drawdown: -0.52,
        duration_days: 8,
        ma200_relation: 'breach',
        volatility_regime: 'extreme',
        price_structure: 'vertical_drop',
        event_dependency: 'liquidity_shock',
        rebound_behavior: 'weak',
        trend_persistence: 'persistent_down',
      },
      primaryPatternName: 'Crash Cascade',
      scenarios: [
        {
          scenario_id: 'secondary_crash',
          scenario_name: 'Secondary Crash',
          description: 'A second downside leg remains plausible if support fails again.',
          posture_guidance: ['defensive_posture'],
        },
        {
          scenario_id: 'panic_bottom',
          scenario_name: 'Panic Bottom',
          description: 'Selling may exhaust quickly, but instability remains high.',
          posture_guidance: ['preserve_capital'],
        },
      ],
      suggestedPosture: ['defensive_posture', 'preserve_capital', 'avoid_aggressive_buying'],
    }),
    buildPostureMessage({
      marketState: {
        as_of_date: '2026-03-14',
        nasdaq_drawdown: -0.06,
        tqqq_drawdown: -0.14,
        duration_days: 14,
        ma200_relation: 'above',
        volatility_regime: 'moderate',
        price_structure: 'countertrend_rally',
        event_dependency: 'none',
        rebound_behavior: 'strong',
        trend_persistence: 'stable',
      },
      primaryPatternName: 'Recovery Attempt',
      scenarios: [
        {
          scenario_id: 'recovery_confirming',
          scenario_name: 'Recovery Confirming',
          description: 'The rebound is improving, but persistence still needs confirmation.',
          posture_guidance: ['controlled_rebuild_only'],
        },
        {
          scenario_id: 'extended_range',
          scenario_name: 'Extended Range',
          description: 'The market may stabilize before a clearer directional move develops.',
          posture_guidance: ['wait_for_confirmation'],
        },
      ],
      suggestedPosture: ['controlled_rebuild_only', 'wait_for_confirmation', 'reduce_chase'],
    }),
  ]
}
