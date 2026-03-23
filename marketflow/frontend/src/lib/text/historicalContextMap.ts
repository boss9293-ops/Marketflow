/**
 * WO55 — Historical Context Map
 *
 * Predefined lookup: scenario_id → 1-2 labeled historical episodes.
 * No similarity engine. No ML. Static, curated, institutional.
 */
import type { ScenarioId } from '@/types/scenarioMapping'

export interface HistoricalItem {
  label:       string
  description: string
}

export interface HistoricalContext {
  items:              HistoricalItem[]
  interpretation:     string
  scenario_label:     string
}

/** Max historical items to show per scenario. */
export const MAX_HISTORY_ITEMS = 2

/**
 * Curated historical episodes per scenario.
 * Each description follows [What happened]. [System implication].
 */
export const SCENARIO_HISTORY_MAP: Partial<Record<ScenarioId, HistoricalItem[]>> = {
  bear_market: [
    {
      label:       '2022 Bear Market',
      description: 'Broad conditions deteriorated over 12 months as fundamentals weakened. VR remained in a defensive posture throughout the drawdown period.',
    },
    {
      label:       '2008 Financial Crisis',
      description: 'Structural breakdown occurred across multiple asset classes. Defensive positioning reduced exposure to the extended drawdown.',
    },
  ],
  credit_stress: [
    {
      label:       '2022 Fed Tightening Phase',
      description: 'Credit spreads widened as rate increases accelerated throughout the year. Funding conditions tightened across corporate debt markets.',
    },
    {
      label:       '2018 Q4 Sell-Off',
      description: 'Rapid spread widening occurred as liquidity conditions deteriorated. Conditions stabilized over the following quarter as pressure eased.',
    },
  ],
  vol_spike: [
    {
      label:       '2020 COVID Crash',
      description: 'Volatility escalated rapidly across all asset classes within weeks. Conditions normalized as liquidity support was restored.',
    },
    {
      label:       '2018 Volmageddon',
      description: 'A short-volatility unwind caused an abrupt spike in implied volatility. Conditions stabilized after the deleveraging process completed.',
    },
  ],
  liquidity_crunch: [
    {
      label:       '2022 Fed Balance Sheet Reduction',
      description: 'Liquidity deteriorated as the Fed reduced its balance sheet through the year. Market conditions became less stable through the mid-year period.',
    },
    {
      label:       '2019 Repo Market Stress',
      description: 'Short-term funding markets experienced stress as reserve levels declined. Conditions normalized after liquidity support was provided.',
    },
  ],
  rates_driven: [
    {
      label:       '2022 Rate Shock',
      description: 'Aggressive rate increases caused rapid duration repricing across fixed income. Rate-sensitive areas experienced extended pressure through the year.',
    },
    {
      label:       '2013 Taper Tantrum',
      description: 'Unexpected rate guidance caused broad repricing across duration-sensitive assets. Markets stabilized after forward guidance improved.',
    },
  ],
  leverage_unwind: [
    {
      label:       '2022 Leveraged ETF Drawdown Period',
      description: 'Volatility decay increased in leveraged instruments as the drawdown extended. Leverage amplified pressure throughout the period.',
    },
    {
      label:       '2020 March Deleveraging',
      description: 'Forced deleveraging amplified the initial drawdown across leveraged structures. The process completed within a few weeks.',
    },
  ],
}

/** Interpretation lines by scenario — institutional, non-predictive. */
export const SCENARIO_INTERPRETATION: Partial<Record<ScenarioId, string>> = {
  bear_market:      'These environments were characterized by sustained structural deterioration. Defensive positioning reduced drawdown exposure.',
  credit_stress:    'These environments were characterized by tightening financial conditions and spread widening. Stability returned as conditions normalized.',
  vol_spike:        'These environments were characterized by rapid volatility escalation. Conditions normalized after the deleveraging process completed.',
  liquidity_crunch: 'These environments were characterized by deteriorating funding conditions. Stability returned once liquidity conditions improved.',
  rates_driven:     'These environments were characterized by rapid duration repricing. Markets stabilized as rate expectations became more predictable.',
  leverage_unwind:  'These environments were characterized by forced deleveraging and amplified drawdowns. Pressure eased after leverage reduction completed.',
}
