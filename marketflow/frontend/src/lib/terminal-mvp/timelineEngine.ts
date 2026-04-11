import type { DensityCluster, DensityNewsItem } from '@/lib/terminal-mvp/clusterEngine'

export type TimelinePhase = 'premarket' | 'open' | 'midday' | 'afternoon' | 'close'

export type TimelinePhaseEntry = {
  phase: TimelinePhase
  event: string
  direction: 'positive' | 'negative' | 'neutral'
  confidence: number
  catalystType: DensityCluster['type'] | 'unknown'
  itemIds: string[]
}

export type TimelineFlowResult = {
  line: string
  phaseEntries: TimelinePhaseEntry[]
  dominantPhase: TimelinePhase | null
  shiftDetected: boolean
}

export type TimelineFlowInput = {
  symbol: string
  items: DensityNewsItem[]
  clusters: DensityCluster[]
  priceChangePct?: number | null
  session?: 'morning' | 'afternoon' | 'auto'
}

const PHASE_ORDER: TimelinePhase[] = ['premarket', 'open', 'midday', 'afternoon', 'close']

const PHASE_LABELS: Record<TimelinePhase, string> = {
  premarket: 'Premarket',
  open: 'Open',
  midday: 'Midday',
  afternoon: 'Afternoon',
  close: 'Close',
}

const DEFAULT_PHASE_LINE: Record<TimelinePhase, string> = {
  premarket: 'Premarket set the tone.',
  open: 'Open anchored the tape.',
  midday: 'Midday kept the move in focus.',
  afternoon: 'Afternoon kept the flow intact.',
  close: 'Close confirmed the session tone.',
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const truncate = (value: string, maxChars = 120): string => {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

const parseClockMinutes = (value: string): number | null => {
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

const inferPhase = (timeET: string): TimelinePhase => {
  const minutes = parseClockMinutes(timeET)
  if (minutes == null) return 'open'
  if (minutes < 9 * 60 + 30) return 'premarket'
  if (minutes < 11 * 60) return 'open'
  if (minutes < 13 * 60 + 30) return 'midday'
  if (minutes < 15 * 60 + 30) return 'afternoon'
  return 'close'
}

const clusterByItemId = (clusters: DensityCluster[]): Map<string, DensityCluster> => {
  const map = new Map<string, DensityCluster>()
  for (const cluster of clusters) {
    for (const item of cluster.items) {
      if (!map.has(item.id)) {
        map.set(item.id, cluster)
      }
    }
  }
  return map
}

const directionFromCluster = (
  cluster: DensityCluster | null,
  priceChangePct: number | null | undefined,
): 'positive' | 'negative' | 'neutral' => {
  if (cluster?.direction && cluster.direction !== 'neutral') {
    return cluster.direction
  }
  if (!Number.isFinite(priceChangePct ?? NaN)) return 'neutral'
  return (priceChangePct ?? 0) >= 0 ? 'positive' : 'negative'
}

const buildPhaseEvent = (
  phase: TimelinePhase,
  items: DensityNewsItem[],
  clusterMap: Map<string, DensityCluster>,
  priceChangePct: number | null | undefined,
): TimelinePhaseEntry | null => {
  if (!items.length) return null

  const ranked = [...items].sort((left, right) => {
    const leftCluster = clusterMap.get(left.id)
    const rightCluster = clusterMap.get(right.id)
    const leftScore = (leftCluster?.importanceScore ?? 0) + (leftCluster?.count ?? 0) * 0.01
    const rightScore = (rightCluster?.importanceScore ?? 0) + (rightCluster?.count ?? 0) * 0.01
    return rightScore - leftScore || left.timeET.localeCompare(right.timeET)
  })

  const top = ranked[0]
  const topCluster = clusterMap.get(top.id) ?? null
  const topText = truncate(topCluster?.summary || top.summary || top.headline, 120)
  const phaseLabel = PHASE_LABELS[phase]
  const event = topText ? `${phaseLabel}: ${topText}` : DEFAULT_PHASE_LINE[phase]

  const clusterScore = clamp((topCluster?.importanceScore ?? 0.35) * 100, 10, 99)
  const direction = directionFromCluster(topCluster, priceChangePct)
  const catalystType = topCluster?.type ?? 'unknown'

  return {
    phase,
    event,
    direction,
    confidence: Math.round(clusterScore),
    catalystType,
    itemIds: ranked.slice(0, 3).map((item) => item.id),
  }
}

const buildFlowLine = (entries: TimelinePhaseEntry[], priceChangePct: number | null | undefined): string => {
  if (!entries.length) {
    return Number.isFinite(priceChangePct ?? NaN)
      ? `The session stayed tape-driven, with the stock moving ${Number(priceChangePct) >= 0 ? 'higher' : 'lower'} into the close.`
      : 'The session stayed tape-driven and the next catalyst remains the key checkpoint.'
  }

  const ordered = [...entries].sort((left, right) => PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase))
  const phrases = ordered.map((entry) => entry.event)
  if (phrases.length === 1) return phrases[0]
  if (phrases.length === 2) return `${phrases[0]} Then ${phrases[1].replace(/^[A-Z][a-z]+:\s*/u, '')}.`
  return phrases.join(' -> ')
}

export function buildTimelineFlow(input: TimelineFlowInput): TimelineFlowResult {
  const { symbol, items, clusters, priceChangePct } = input
  const clusterMap = clusterByItemId(clusters)
  const grouped = new Map<TimelinePhase, DensityNewsItem[]>()

  for (const item of items) {
    const phase = inferPhase(item.timeET)
    const bucket = grouped.get(phase) ?? []
    bucket.push(item)
    grouped.set(phase, bucket)
  }

  const phaseEntries = PHASE_ORDER.map((phase) =>
    buildPhaseEvent(phase, grouped.get(phase) ?? [], clusterMap, priceChangePct),
  ).filter((entry): entry is TimelinePhaseEntry => Boolean(entry))

  const dominantPhase = phaseEntries.length
    ? [...phaseEntries].sort((left, right) => right.confidence - left.confidence || PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase))[0]?.phase ?? null
    : null

  const shiftDetected =
    phaseEntries.some((entry) => entry.direction === 'negative') &&
    phaseEntries.some((entry) => entry.direction === 'positive')

  const flowLine = buildFlowLine(phaseEntries, priceChangePct)
  const line = symbol ? `${symbol}: ${flowLine}` : flowLine

  return {
    line,
    phaseEntries,
    dominantPhase,
    shiftDetected,
  }
}
