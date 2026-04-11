import type { DensityCluster } from '@/lib/terminal-mvp/clusterEngine'

export type SessionThesisResult = {
  thesis: string
  direction: 'strength' | 'weakness'
  primary: DensityCluster | null
  secondary: DensityCluster | null
}

const TYPE_PRIORITY: Record<string, number> = {
  macro: 5,
  analyst: 4,
  sector: 3,
  company_event: 3,
  earnings: 3,
  price_action: 2,
  other: 1,
}

const cleanText = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[.。]+$/g, '')
    .trim()

const sortClusters = (clusters: DensityCluster[]): DensityCluster[] =>
  [...clusters].sort(
    (a, b) =>
      TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type] ||
      b.importanceScore - a.importanceScore ||
      b.count - a.count ||
      a.summary.localeCompare(b.summary),
  )

export function buildSessionThesis(
  symbol: string,
  priceChangePct: number | null | undefined,
  clusters: DensityCluster[],
): SessionThesisResult {
  const sorted = sortClusters(clusters)
  const direction = (priceChangePct ?? 0) < 0 ? 'weakness' : 'strength'
  const primary = sorted[0] ?? null
  const secondary = sorted.find((cluster) => cluster.clusterId !== primary?.clusterId) ?? null

  if (!primary && !secondary) {
    return {
      thesis:
        direction === 'weakness'
          ? `${symbol} weakness is mostly tape-driven, with limited fresh catalyst follow-through.`
          : `${symbol} strength is mostly tape-driven, with limited fresh catalyst follow-through.`
      ,
      direction,
      primary: null,
      secondary: null,
    }
  }

  const primaryText = cleanText(primary?.summary || '')
  const secondaryText = cleanText(secondary?.summary || '')

  const thesis =
    direction === 'weakness'
      ? `${symbol} weakness is being driven by ${primaryText || 'the main catalyst'}${secondaryText ? ` and ${secondaryText}` : ''}.`
      : `${symbol} strength is being driven by ${primaryText || 'the main catalyst'}${secondaryText ? ` and ${secondaryText}` : ''}.`

  return {
    thesis,
    direction,
    primary,
    secondary,
  }
}

