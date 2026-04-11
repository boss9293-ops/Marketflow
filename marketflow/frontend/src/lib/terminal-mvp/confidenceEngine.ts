import type { DensityCluster } from '@/lib/terminal-mvp/clusterEngine'
import type { TimelineFlowResult } from '@/lib/terminal-mvp/timelineEngine'
import type { RelativeViewResult } from '@/lib/terminal-mvp/multiSymbolEngine'

export type ConfidenceTone = 'strong' | 'mixed' | 'weak'

export type ConfidenceResult = {
  score: number
  label: 'HIGH_CONVICTION' | 'MIXED' | 'WEAK'
  tone: ConfidenceTone
  line: string
  signals: string[]
}

export type ConfidenceInput = {
  symbol: string
  priceChangePct?: number | null
  clusters: DensityCluster[]
  timeline: TimelineFlowResult
  relativeView?: RelativeViewResult | null
  rawCount?: number
  selectedCount?: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const sign = (value: number | null | undefined): 'positive' | 'negative' | 'neutral' => {
  if (!Number.isFinite(value ?? NaN)) return 'neutral'
  return (value ?? 0) >= 0 ? 'positive' : 'negative'
}

const sortClusters = (clusters: DensityCluster[]): DensityCluster[] =>
  [...clusters].sort((left, right) =>
    right.importanceScore - left.importanceScore ||
    right.count - left.count ||
    left.type.localeCompare(right.type),
  )

const countTypes = (clusters: DensityCluster[]): Set<DensityCluster['type']> =>
  new Set(clusters.map((cluster) => cluster.type))

export function buildConfidenceProfile(input: ConfidenceInput): ConfidenceResult {
  const { priceChangePct, clusters, timeline, relativeView, rawCount = clusters.length, selectedCount = clusters.length } = input
  const sorted = sortClusters(clusters)
  const priceDirection = sign(priceChangePct)
  const dominant = sorted[0] ?? null
  const dominantDirection = dominant?.direction ?? 'neutral'
  const typeSet = countTypes(clusters)
  const signals: string[] = []
  let score = 0

  if (dominant) {
    if (dominantDirection === priceDirection && priceDirection !== 'neutral') {
      score += 30
      signals.push('price-aligns-with-dominant-catalyst')
    } else if (dominantDirection === 'neutral') {
      score += 15
      signals.push('dominant-catalyst-neutral')
    } else {
      score += 10
      signals.push('dominant-catalyst-opposes-price')
    }
  }

  const repeatedClusters = sorted.filter((cluster) => cluster.count >= 2).length
  if (repeatedClusters >= 2) {
    score += 20
    signals.push('repeated-event-clusters')
  } else if (repeatedClusters === 1) {
    score += 10
    signals.push('single-repeat-cluster')
  }

  const macroSectorAnalyst =
    (typeSet.has('macro') ? 1 : 0) +
    (typeSet.has('sector') ? 1 : 0) +
    (typeSet.has('analyst') ? 1 : 0) +
    (typeSet.has('company_event') ? 1 : 0) +
    (typeSet.has('earnings') ? 1 : 0)
  if (macroSectorAnalyst >= 3) {
    score += 20
    signals.push('macro-sector-analyst-mix')
  } else if (macroSectorAnalyst >= 2) {
    score += 12
    signals.push('multi-source-catalyst-mix')
  }

  const phaseCoverage = timeline.phaseEntries.length
  if (phaseCoverage >= 4) {
    score += 15
    signals.push('broad-intraday-coverage')
  } else if (phaseCoverage >= 3) {
    score += 10
    signals.push('intraday-coverage')
  } else if (phaseCoverage >= 2) {
    score += 6
    signals.push('limited-intraday-coverage')
  }

  if (typeof relativeView?.tone === 'string' && relativeView.tone !== 'neutral') {
    score += 10
    signals.push('clear-relative-view')
  } else if (relativeView?.line) {
    score += 5
    signals.push('relative-view-present')
  }

  if (rawCount > 0) {
    const density = selectedCount / Math.max(1, rawCount)
    if (density >= 0.75) {
      score += 10
      signals.push('high-signal-density')
    } else if (density >= 0.5) {
      score += 6
      signals.push('moderate-signal-density')
    } else {
      score += 2
      signals.push('thin-signal-density')
    }
  }

  if (timeline.shiftDetected) {
    score += 4
    signals.push('intraday-shift-present')
  }

  score = clamp(score, 0, 100)

  const label: ConfidenceResult['label'] =
    score >= 75 ? 'HIGH_CONVICTION' : score >= 50 ? 'MIXED' : 'WEAK'
  const tone: ConfidenceTone =
    label === 'HIGH_CONVICTION' ? 'strong' : label === 'MIXED' ? 'mixed' : 'weak'

  const signalLine = signals.length ? signals.slice(0, 3).join(', ') : 'signals remain mixed'
  const line = `Confidence: ${label} (${score}/100); ${signalLine}.`

  return {
    score,
    label,
    tone,
    line,
    signals,
  }
}
