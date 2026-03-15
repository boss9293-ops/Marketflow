/**
 * Market Stress Regime Filter (MSRF)
 * Classifies the current macro-financial environment into one of four regimes.
 *
 * Architecture:
 *   MPS → Market Regime Classifier → 12-Layer Risk Sensors → Crisis Propagation → Total Risk
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarketRegime = 'Expansion' | 'Early Stress' | 'Credit Stress' | 'Liquidity Crisis'

export interface RegimeInfo {
  regime: MarketRegime
  color: string
  desc: string
  confidence: number    // 0-100
  drivers: string[]
  weights: Partial<Record<string, number>>
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const REGIME_COLORS: Record<MarketRegime, string> = {
  'Expansion':       '#22c55e',
  'Early Stress':    '#f59e0b',
  'Credit Stress':   '#f97316',
  'Liquidity Crisis':'#ef4444',
}

export const REGIME_DESCS: Record<MarketRegime, string> = {
  'Expansion':
    'Credit stable, liquidity abundant. Normal risk-on market conditions.',
  'Early Stress':
    'Loan markets weakening, credit stress emerging. Early cracks in credit infrastructure.',
  'Credit Stress':
    'Credit spreads widening and financial sector under pressure. Transmission into banking system active.',
  'Liquidity Crisis':
    'Funding stress and liquidity breakdown. Acute conditions — 2008/2020-type event signals.',
}

/** Layer weight multipliers per regime.
 *  Affects interpretation display — does NOT alter raw layer scores. */
export const REGIME_WEIGHTS: Record<MarketRegime, Partial<Record<string, number>>> = {
  'Expansion': {
    equity: 1.2, breadth: 1.2,
    credit: 0.8, lev_loan: 0.8, credit_spread: 0.8,
    financial_stress: 0.8, liquidity_shock: 0.8,
  },
  'Early Stress': {
    lev_loan: 1.3, credit: 1.3, financial_stress: 1.2, funding: 1.2,
  },
  'Credit Stress': {
    credit_spread: 1.4, financial_stress: 1.4, credit: 1.3,
    lev_loan: 1.2, funding: 1.2,
  },
  'Liquidity Crisis': {
    liquidity_shock: 1.6, shock: 1.6, funding: 1.4, liquidity: 1.3,
  },
}

/** Tooltip descriptions shown on regime badge hover */
export const REGIME_TOOLTIP: Record<MarketRegime, string> = {
  'Expansion':
    'Market Regime: Expansion\n\nCredit stable, liquidity abundant.\nAll systemic risk layers benign.\nRisk-on conditions supported.',
  'Early Stress':
    'Market Regime: Early Stress\n\nLoan markets weakening, credit stress emerging.\nPrivate credit showing cracks.\nMonitor leveraged loan and financial stress layers.',
  'Credit Stress':
    'Market Regime: Credit Stress\n\nCredit spreads widening.\nFinancial sector under pressure.\nCredit-to-financial transmission active.',
  'Liquidity Crisis':
    'Market Regime: Liquidity Crisis\n\nFunding stress and liquidity breakdown.\nShock Detector or Liquidity Shock triggered.\nAcute systemic event — 2008/2020 pattern.',
}

// ── Historical Regime Map (for reference / testing) ───────────────────────────
//
//  Year/Period               Expected Regime
//  ─────────────────────────────────────────
//  2021 Bull Market          Expansion
//  2022 Fed Tightening       Early Stress
//  2023 SVB / Bank Stress    Credit Stress
//  2020 COVID Crash          Liquidity Crisis

// ── Utility Functions ─────────────────────────────────────────────────────────

/** Returns the weight multiplier for a given layer in the current regime. */
export function getRegimeWeight(regime: MarketRegime, layerKey: string): number {
  return REGIME_WEIGHTS[regime]?.[layerKey] ?? 1.0
}

/** Returns true if the layer is amplified (weight > 1) in the current regime. */
export function isAmplifiedLayer(regime: MarketRegime, layerKey: string): boolean {
  return getRegimeWeight(regime, layerKey) > 1.0
}

/** Returns true if the layer is de-emphasized (weight < 1) in the current regime. */
export function isDampedLayer(regime: MarketRegime, layerKey: string): boolean {
  return getRegimeWeight(regime, layerKey) < 1.0
}

/** Regime severity index: 0=Expansion, 1=Early Stress, 2=Credit Stress, 3=Liquidity Crisis */
export function regimeSeverity(regime: MarketRegime): number {
  const order: MarketRegime[] = ['Expansion', 'Early Stress', 'Credit Stress', 'Liquidity Crisis']
  return order.indexOf(regime)
}

/** Returns border/glow style object for a regime badge. */
export function regimeBadgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: '0.75rem',
    fontWeight: 800,
    color,
    background: `${color}12`,
    border: `1px solid ${color}40`,
    borderRadius: 6,
    padding: '3px 9px',
    display: 'inline-block',
    letterSpacing: '0.02em',
  }
}
