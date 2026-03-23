import type { ResearchSource, SourceReliability, SourceFreshness } from '@/types/research'

const RELIA_W: Record<SourceReliability, number> = { high: 1.0, medium: 0.6, low: 0.25 }
const FRESH_W: Record<SourceFreshness,   number> = { current: 1.0, recent: 0.75, dated: 0.45, historical: 0.2 }

export interface RankedSource extends ResearchSource {
  _composite: number  // 0–1 weighted score
  _rank:      number  // 1-based
}

export function rankSources(sources: ResearchSource[]): RankedSource[] {
  const scored = sources.map(s => ({
    ...s,
    _composite:
      (s.relevance ?? 0.5)                         * 0.55 +
      RELIA_W[s.reliability ?? 'medium']           * 0.28 +
      FRESH_W[s.freshness   ?? 'recent']           * 0.17,
    _rank: 0,
  }))
  scored.sort((a, b) => b._composite - a._composite)
  return scored.map((s, i) => ({ ...s, _rank: i + 1 }))
}

export function sortByReliability(sources: ResearchSource[]): ResearchSource[] {
  const order: Record<string, number> = { high: 3, medium: 2, low: 1 }
  return [...sources].sort((a, b) => {
    const diff = (order[b.reliability ?? 'medium'] ?? 2) - (order[a.reliability ?? 'medium'] ?? 2)
    return diff !== 0 ? diff : b.relevance - a.relevance
  })
}
