// =============================================================================
// formatAnalog.ts — Format AnalogMatch[] for display  (WO-SA20)
// =============================================================================
import type { AnalogMatch } from '@/types/analog'

export interface FormattedAnalog {
  label:           string
  period:          string
  score:           number
  regime:          string
  runtime:         string
  similarity_tags: string[]
  fwd_5d?:         number
  fwd_20d?:        number
  max_dd?:         number
  notes:           string
}

export function formatAnalogView(matches: AnalogMatch[]): FormattedAnalog[] {
  return matches.map(m => ({
    label:           m.label,
    period:          m.start_date,
    score:           m.match_score,
    regime:          m.entry.regime,
    runtime:         m.entry.runtime_mode,
    similarity_tags: m.similarity_summary.split(' · ').filter(Boolean),
    fwd_5d:          m.forward_return_5d,
    fwd_20d:         m.forward_return_20d,
    max_dd:          m.max_drawdown,
    notes:           m.notes ?? '',
  }))
}
