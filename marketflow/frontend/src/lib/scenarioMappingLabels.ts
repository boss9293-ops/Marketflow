import type { ScenarioId } from '@/types/scenarioMapping'

export interface ScenarioDefinition {
  id:                   ScenarioId
  label:                string
  desc:                 string
  keywords:             string[]
  vr_states:            string[]
  primary_href:         string
  secondary_href?:      string
  secondary_label?:     string
  monitor_next_default: string[]
  conflict_keywords:    string[]
}

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id:           'bear_market',
    label:        'Bear Market',
    desc:         'Broad market conditions are deteriorating across price and breadth signals. Structural pressure is increasing as fundamentals weaken.',
    keywords:     ['bear', 'decline', 'selloff', 'downturn', 'correction', 'crash', 'recession', 'contraction', 'drawdown'],
    vr_states:    ['ARMED', 'EXIT_DONE'],
    primary_href: '/vr-survival',
    secondary_href:  '/vr-survival?tab=Crash+Analysis',
    secondary_label: 'Crash Analysis',
    monitor_next_default: [
      'QQQ vs MA200 cross',
      'Breadth deterioration',
      'Earnings revision trend',
    ],
    conflict_keywords: ['recovery', 'rally', 'bull run', 'breakout', 'all-time high', 'ath'],
  },
  {
    id:           'credit_stress',
    label:        'Credit Stress',
    desc:         'Credit spreads are widening and financial conditions are tightening. This reduces risk capacity and increases funding pressure.',
    keywords:     ['credit', 'spread', 'default', 'high yield', 'hy', 'investment grade', 'debt', 'bond', 'oas', 'cds'],
    vr_states:    ['ARMED', 'CAUTION'],
    primary_href: '/vr-survival?tab=Crash+Analysis',
    secondary_href:  '/risk-v1',
    secondary_label: 'Risk System',
    monitor_next_default: [
      'HY OAS spread level',
      'IG spread trajectory',
      'Bank lending standards',
    ],
    conflict_keywords: ['tight spreads', 'spread tightening', 'credit rally', 'upgrade cycle'],
  },
  {
    id:           'vol_spike',
    label:        'Volatility Spike',
    desc:         'Volatility is entering an elevated regime. Increased volatility reduces market predictability and raises drawdown risk.',
    keywords:     ['vix', 'volatility', 'vol spike', 'vol regime', 'options', 'skew', 'fear', 'panic', 'implied vol'],
    vr_states:    ['ARMED', 'CAUTION'],
    primary_href: '/vr-survival?tab=Crash+Analysis',
    monitor_next_default: [
      'VIX term structure shape',
      'Skew index level',
      'Options net gamma exposure',
    ],
    conflict_keywords: ['low vol', 'vol crush', 'calm market', 'complacency', 'vix below 15'],
  },
  {
    id:           'liquidity_crunch',
    label:        'Liquidity Crunch',
    desc:         'Market liquidity and funding conditions are deteriorating. Reduced liquidity amplifies price instability and cross-asset pressure.',
    keywords:     ['liquidity', 'funding', 'repo', 'fed', 'qt', 'balance sheet', 'money market', 'tga', 'rrp', 'reserve'],
    vr_states:    ['ARMED', 'CAUTION', 'REENTRY'],
    primary_href: '/vr-survival?tab=Crash+Analysis',
    secondary_href:  '/risk-v1',
    secondary_label: 'Risk System',
    monitor_next_default: [
      'Fed balance sheet trajectory',
      'Money market rate spreads',
      'Repo market overnight rate',
    ],
    conflict_keywords: ['ample liquidity', 'qe', 'fed easing', 'abundant reserves'],
  },
  {
    id:           'rates_driven',
    label:        'Rates-Driven Repricing',
    desc:         'Interest rate moves are driving equity repricing. Duration sensitivity is increasing and amplifying drawdown in rate-sensitive areas.',
    keywords:     ['rates', 'yield', 'treasury', 'fed funds', 'inflation', 'cpi', 'fomc', 'hike', 'duration', 'tlt', 'tips'],
    vr_states:    ['CAUTION', 'REENTRY'],
    primary_href: '/risk-v1',
    secondary_href:  '/vr-survival',
    secondary_label: 'VR Survival',
    monitor_next_default: [
      '10Y yield trajectory',
      'Real yield direction',
      'FOMC meeting expectations',
    ],
    conflict_keywords: ['rate pause confirmed', 'cuts priced in', 'dovish pivot complete'],
  },
  {
    id:           'leverage_unwind',
    label:        'Leverage Unwind',
    desc:         'Deleveraging pressure is increasing across leveraged exposures. Forced reduction of leverage amplifies volatility in affected instruments.',
    keywords:     ['leverage', 'margin', 'tqqq', 'sqqq', 'leveraged etf', 'volatility decay', 'unwind', 'forced selling', 'deleveraging'],
    vr_states:    ['ARMED', 'EXIT_DONE', 'REENTRY'],
    primary_href: '/vr-survival?tab=Strategy+Lab',
    secondary_href:  '/vr-survival',
    secondary_label: 'VR Survival',
    monitor_next_default: [
      'Leveraged ETF fund flows',
      'Margin debt level changes',
      'TQQQ vs QQQ divergence',
    ],
    conflict_keywords: ['derisking complete', 'positions reset', 'clean positioning', 'low margin debt'],
  },
]
