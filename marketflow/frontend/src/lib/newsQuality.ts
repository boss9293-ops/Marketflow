const BLOCKED_SOURCE_PATTERNS: RegExp[] = [
  /tipranks/i,
  /barron'?s/i,
  /seeking alpha/i,
  /\bwsj\b/i,
  /wall street journal/i,
  /financial times/i,
  /bloomberg/i,
  /press release/i,
  /pr newswire/i,
  /business wire/i,
  /accesswire/i,
  /globenewswire/i,
  /sponsored/i,
  /partner content/i,
  /paid content/i,
]

const PREFERRED_SOURCE_BONUSES: Array<{ pattern: RegExp; bonus: number }> = [
  { pattern: /reuters/i, bonus: 2.6 },
  { pattern: /associated press|\bap news\b|\bap\b/i, bonus: 2.4 },
  { pattern: /yahoo finance/i, bonus: 1.8 },
  { pattern: /marketwatch/i, bonus: 1.5 },
  { pattern: /cnbc/i, bonus: 1.3 },
  { pattern: /nasdaq/i, bonus: 1.2 },
  { pattern: /benzinga/i, bonus: 0.9 },
  { pattern: /simply wall st/i, bonus: 0.7 },
]

const NEWS_KEYWORDS = [
  'fed',
  'powell',
  'rate',
  'yield',
  'treasury',
  'cpi',
  'inflation',
  'ppi',
  'liquidity',
  'qt',
  'qe',
  'balance sheet',
  'rrp',
  'repo',
  'credit spread',
  'vix',
  'volatility',
  'bitcoin',
  'btc',
  'gold',
  'real yield',
  'tips',
  'm2',
  'earnings',
  'guidance',
  'margins',
  'tariff',
  'oil',
  'geopolitical',
  'delivery',
  'orders',
  'margin',
]

export const isBlockedNewsSource = (source?: string | null): boolean => {
  const normalized = String(source || '').toLowerCase()
  if (!normalized) return false
  return BLOCKED_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export const isFreeNewsSource = (source?: string | null): boolean => !isBlockedNewsSource(source)

export const scoreNewsSource = (source?: string | null): number => {
  const normalized = String(source || '')
  if (isBlockedNewsSource(normalized)) return -4

  let bonus = 0
  for (const { pattern, bonus: candidate } of PREFERRED_SOURCE_BONUSES) {
    if (pattern.test(normalized)) {
      bonus = Math.max(bonus, candidate)
    }
  }
  return bonus
}

export const scoreNewsText = (text: string): number => {
  const lower = String(text || '').toLowerCase()
  let hits = 0
  for (const keyword of NEWS_KEYWORDS) {
    if (lower.includes(keyword)) hits += 1
  }
  return hits
}

export const hasPromoSignals = (text: string): boolean => {
  const lower = String(text || '').toLowerCase()
  return /press release|sponsored|partner content|paid content/.test(lower)
}
