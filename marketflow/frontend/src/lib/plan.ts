/**
 * plan.ts - Freemium feature flag
 * Set NEXT_PUBLIC_PLAN=pro in .env.local to unlock all features.
 * Default: 'free'
 */
export const PLAN: 'free' | 'pro' =
  (process.env.NEXT_PUBLIC_PLAN === 'pro' ? 'pro' : 'free')

export const isPro = PLAN === 'pro'
export const isFree = PLAN === 'free'
export const isProEnabled = () => isPro

/** Returns true if the feature is available on the current plan. */
export function canAccess(feature: 'signals_full' | 'smart_money_full' | 'ml_prediction'): boolean {
  if (isPro) return true
  // Free plan limitations
  if (feature === 'signals_full') return false
  if (feature === 'smart_money_full') return false
  if (feature === 'ml_prediction') return false
  return true
}
