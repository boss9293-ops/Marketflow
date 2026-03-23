// =============================================================================
// analogFinder.ts — Find top analog matches  (WO-SA20)
// =============================================================================
import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import type { AnalogMatch } from '@/types/analog'
import { ANALOG_CATALOG } from '@/lib/analogCatalog'
import { scoreAnalog } from '@/lib/analogScoring'

const MIN_SCORE  = 45
const MAX_RESULTS = 3

export function findAnalogs(
  payload: SmartAnalyzerViewPayload | null | undefined
): AnalogMatch[] {
  if (!payload) return []

  const scored = ANALOG_CATALOG
    .map(entry => ({
      entry,
      score: scoreAnalog(payload, entry),
    }))
    .filter(x => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)

  return scored.map(({ entry, score }) => ({
    entry,
    score,
    label:              entry.label,
    start_date:         entry.period,
    match_score:        score,
    similarity_summary: buildSummary(entry, score),
    forward_return_5d:  entry.forward_return_5d,
    forward_return_20d: entry.forward_return_20d,
    max_drawdown:       entry.max_drawdown,
    notes:              entry.notes,
  }))
}

function buildSummary(entry: (typeof ANALOG_CATALOG)[0], score: number): string {
  const strength = score >= 65 ? 'Strong' : score >= 55 ? 'Moderate' : 'Weak'
  return strength + ' match · ' + entry.regime + ' regime · ' + entry.runtime_mode + ' mode'
}
