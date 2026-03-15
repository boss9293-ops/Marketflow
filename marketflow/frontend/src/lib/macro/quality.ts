export type SeriesPoint = { date: string; value: number | null }
export type FreqType = 'daily' | 'weekly' | 'monthly'
export type QualityEnum = 'OK' | 'Partial' | 'Stale' | 'RevisionRisk' | 'NA'

export function coverageRatio(series: SeriesPoint[], lookbackDays = 756): number {
  if (!Array.isArray(series) || series.length === 0) return 0
  const tail = series.slice(-Math.max(1, lookbackDays))
  const expected = tail.length
  if (expected === 0) return 0
  const valid = tail.filter((p) => typeof p.value === 'number' && Number.isFinite(p.value)).length
  return valid / expected
}

function businessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0
  const d = new Date(start)
  d.setHours(0, 0, 0, 0)
  const e = new Date(end)
  e.setHours(0, 0, 0, 0)
  let cnt = 0
  while (d < e) {
    d.setDate(d.getDate() + 1)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) cnt += 1
  }
  return cnt
}

export function isStale(last_updated: string | null | undefined, freqType: FreqType): boolean {
  if (!last_updated) return true
  const d = new Date(last_updated)
  if (Number.isNaN(d.getTime())) return true
  const now = new Date()
  if (freqType === 'daily') {
    return businessDaysBetween(d, now) > 2
  }
  const calendarDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
  if (freqType === 'weekly') return calendarDays > 10
  return calendarDays > 45
}

export function qualityLabel(input: {
  coverage: number
  stale: boolean
  revisionRisk: boolean
  proxyUsed: boolean
}): { label: QualityEnum } {
  if (input.revisionRisk) return { label: 'RevisionRisk' }
  if (input.stale) return { label: 'Stale' }
  if (!Number.isFinite(input.coverage) || input.coverage < 0.6) return { label: 'NA' }
  if (input.coverage < 0.95 || input.proxyUsed) return { label: 'Partial' }
  return { label: 'OK' }
}
