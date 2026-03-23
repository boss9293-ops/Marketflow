import type { ResearchSource, SourceReliability, SourceFreshness } from '@/types/research'

// ── Reliability inference ─────────────────────────────────────────────────────

const HIGH_REL: string[] = [
  'federal reserve', 'st. louis fed', 'new york fed', 'kansas city fed',
  'ecb', 'european central bank', 'bank of england', 'bank of japan', 'boj',
  'bis', 'bank for international settlements',
  'imf', 'international monetary fund', 'world bank',
  'sec', 'cftc', 'finra', 'fdic', 'occ',
  'u.s. treasury', 'us treasury', 'department of the treasury',
  'bureau of labor statistics', 'bls', 'bureau of economic analysis', 'bea',
  'census bureau', 'nber', 'cbo', 'congressional budget office',
  'bloomberg', 'financial times', 'wall street journal', 'wsj',
  'reuters', 'associated press', 's&p global', 'moody',
]

const LOW_REL: string[] = [
  'reddit', 'twitter', 'x.com', 'seekingalpha', 'seeking alpha',
  'motley fool', 'zerohedge', 'medium.com', 'substack',
]

export function inferReliability(
  source_name: string,
  type: ResearchSource['type'],
): SourceReliability {
  const lower = source_name.toLowerCase()
  if (HIGH_REL.some(k => lower.includes(k))) return 'high'
  if (LOW_REL.some(k => lower.includes(k))) return 'low'
  if (type === 'filing' || type === 'data') return 'high'
  return 'medium'
}

// ── Freshness inference ───────────────────────────────────────────────────────

export function inferFreshness(date?: string): SourceFreshness {
  if (!date) return 'recent'
  const m = date.match(/\d{4}/)
  if (!m) return 'recent'
  const year = parseInt(m[0])
  const now  = new Date().getFullYear()
  if (year >= now)      return 'current'
  if (year >= now - 1)  return 'recent'
  if (year >= now - 3)  return 'dated'
  return 'historical'
}

// ── Category inference ────────────────────────────────────────────────────────

const CAT_MAP: [string, string][] = [
  ['federal reserve', 'Central Bank'], ['st. louis fed', 'Central Bank'],
  ['new york fed', 'Central Bank'],    ['ecb', 'Central Bank'],
  ['bank of england', 'Central Bank'], ['bank of japan', 'Central Bank'],
  ['boj', 'Central Bank'],             ['peoples bank', 'Central Bank'],
  ['bis', 'International'],            ['imf', 'International'],
  ['world bank', 'International'],     ['oecd', 'International'],
  ['sec', 'Regulatory'],               ['cftc', 'Regulatory'],
  ['finra', 'Regulatory'],             ['fdic', 'Regulatory'],
  ['treasury', 'Government'],          ['bls', 'Government Data'],
  ['bureau of labor', 'Government Data'], ['bea', 'Government Data'],
  ['census bureau', 'Government Data'],   ['cbo', 'Government'],
  ['nber', 'Academic'],                ['university', 'Academic'],
  ['brookings', 'Academic'],           ['peterson', 'Academic'],
  ['bloomberg', 'Market Data'],        ['refinitiv', 'Market Data'],
  ['cme group', 'Market Data'],        ['nasdaq', 'Market Data'],
  ['s&p global', 'Market Data'],       ['ice data', 'Market Data'],
  ['moody', 'Credit Research'],        ['fitch', 'Credit Research'],
  ['wall street journal', 'Financial News'], ['wsj', 'Financial News'],
  ['financial times', 'Financial News'],     ['reuters', 'Financial News'],
  ['barron', 'Financial News'],
]

export function inferCategory(
  source_name: string,
  type: ResearchSource['type'],
): string {
  const lower = source_name.toLowerCase()
  for (const [key, cat] of CAT_MAP) {
    if (lower.includes(key)) return cat
  }
  if (type === 'filing')   return 'Regulatory Filing'
  if (type === 'data')     return 'Market Data'
  if (type === 'report')   return 'Research Report'
  if (type === 'news')     return 'News'
  if (type === 'analysis') return 'Analysis'
  return 'Reference'
}

// ── Enrich + dedupe ───────────────────────────────────────────────────────────

export function enrichSources(sources: ResearchSource[]): ResearchSource[] {
  const seenIds    = new Set<string>()
  const seenTitles = new Set<string>()
  return sources
    .filter(s => {
      const tk = s.title.slice(0, 50).toLowerCase().replace(/\s+/g, ' ').trim()
      if (seenIds.has(s.id) || seenTitles.has(tk)) return false
      seenIds.add(s.id)
      seenTitles.add(tk)
      return true
    })
    .map(s => ({
      ...s,
      reliability: s.reliability ?? inferReliability(s.source_name, s.type),
      freshness:   s.freshness   ?? inferFreshness(s.date),
      category:    s.category    ?? inferCategory(s.source_name, s.type),
    }))
}
