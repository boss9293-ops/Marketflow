export type Direction = 'HIGH_BAD' | 'LOW_BAD' | 'BOTH_BAD'

export type Point = {
  date: string
  value: number | null
}

export type BandResult = {
  label: 'Normal' | 'Watch' | 'Risk'
  percentile: number
}

export function rollingPercentile(series: Point[], lookbackDays = 756): number | null {
  if (!Array.isArray(series) || series.length === 0) return null
  const tail = series.slice(-Math.max(1, lookbackDays))
  const values = tail
    .map((p) => (typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null))
    .filter((v): v is number => v !== null)

  const expected = tail.length
  const coverage = expected > 0 ? values.length / expected : 0
  if (coverage < 0.6 || values.length === 0) return null

  const current = values[values.length - 1]
  if (!Number.isFinite(current)) return null
  if (values.length === 1) return 50

  const rank = values.filter((v) => v <= current).length
  return (100 * (rank - 1)) / (values.length - 1)
}

export function bandFromPercentile(percentile: number | null, direction: Direction): BandResult | null {
  if (percentile == null || !Number.isFinite(percentile)) return null
  let p = percentile
  if (direction === 'LOW_BAD') p = 100 - p
  // BOTH_BAD assumes input is already ABS-based percentile, per spec.

  let label: BandResult['label'] = 'Normal'
  if (p >= 85) label = 'Risk'
  else if (p >= 66) label = 'Watch'
  return { label, percentile: p }
}

export function refBandText(direction: Direction): string {
  if (direction === 'BOTH_BAD') {
    return 'Bands are 3Y percentiles. Risk when moves are extreme (|Δ| percentile > P85).'
  }
  return 'Bands are 3Y percentiles. Normal <P66, Watch P66–P85, Risk >P85'
}
