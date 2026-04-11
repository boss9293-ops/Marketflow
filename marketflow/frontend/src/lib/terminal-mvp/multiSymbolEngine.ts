import type { DensityCluster } from '@/lib/terminal-mvp/clusterEngine'

export type MarketTapeItem = {
  symbol?: string | null
  name?: string | null
  last?: number | null
  chg?: number | null
  chg_pct?: number | null
}

export type RelativeViewTone = 'outperform' | 'underperform' | 'mixed' | 'neutral'

export type RelativeViewResult = {
  line: string
  tone: RelativeViewTone
  primaryBenchmark: string | null
  secondaryBenchmark: string | null
  relativeToPrimary: number | null
  relativeToSecondary: number | null
}

export type MultiSymbolInput = {
  symbol: string
  companyName?: string
  priceChangePct?: number | null
  marketTapeItems?: MarketTapeItem[] | null
  clusters?: DensityCluster[]
}

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim()

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword))

const findTapeItem = (items: MarketTapeItem[], symbol: string): MarketTapeItem | null =>
  items.find((item) => normalize(String(item.symbol ?? '')) === normalize(symbol)) ?? null

const describeDiff = (diff: number): string =>
  `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} pts`

const chooseBenchmarks = (symbol: string, companyName?: string, clusters?: DensityCluster[]) => {
  const combined = normalize(
    [
      symbol,
      companyName ?? '',
      ...(clusters ?? []).map((cluster) => `${cluster.type} ${cluster.summary} ${cluster.eventTags.join(' ')}`),
    ].join(' '),
  )
  const techBias = containsAny(combined, [
    'ai',
    'chip',
    'chips',
    'semiconductor',
    'software',
    'cloud',
    'gpu',
    'data center',
    'internet',
    'platform',
    'technology',
    'tech',
  ])
  return {
    primary: techBias ? 'QQQ' : 'SPY',
    secondary: techBias ? 'SPY' : 'QQQ',
  }
}

export function buildRelativeView(input: MultiSymbolInput): RelativeViewResult {
  const { symbol, companyName, priceChangePct, marketTapeItems = [], clusters = [] } = input
  const items = Array.isArray(marketTapeItems) ? marketTapeItems : []
  const stockChange = Number.isFinite(priceChangePct ?? NaN) ? Number(priceChangePct) : null
  const { primary, secondary } = chooseBenchmarks(symbol, companyName, clusters)
  const primaryItem = findTapeItem(items, primary)
  const secondaryItem = findTapeItem(items, secondary)
  const primaryChange = typeof primaryItem?.chg_pct === 'number' && Number.isFinite(primaryItem.chg_pct) ? Number(primaryItem.chg_pct) : null
  const secondaryChange = typeof secondaryItem?.chg_pct === 'number' && Number.isFinite(secondaryItem.chg_pct) ? Number(secondaryItem.chg_pct) : null

  if (stockChange == null || (primaryChange == null && secondaryChange == null)) {
    return {
      line: `${symbol} remains tied to the broader tape, with no clean relative benchmark available.`,
      tone: 'neutral',
      primaryBenchmark: primaryItem?.symbol ?? null,
      secondaryBenchmark: secondaryItem?.symbol ?? null,
      relativeToPrimary: null,
      relativeToSecondary: null,
    }
  }

  const primaryDiff = primaryChange == null ? null : stockChange - primaryChange
  const secondaryDiff = secondaryChange == null ? null : stockChange - secondaryChange
  const diffs = [primaryDiff, secondaryDiff].filter((value): value is number => typeof value === 'number')
  const meanDiff = diffs.length ? diffs.reduce((sum, value) => sum + value, 0) / diffs.length : null
  const compareNamePrimary = primaryItem?.symbol ?? primary
  const compareNameSecondary = secondaryItem?.symbol ?? secondary

  let tone: RelativeViewTone = 'mixed'
  if (primaryDiff != null || secondaryDiff != null) {
    const bestDiff = primaryDiff ?? secondaryDiff ?? 0
    if (bestDiff >= 0.5) tone = 'outperform'
    else if (bestDiff <= -0.5) tone = 'underperform'
    else tone = 'neutral'
  }

  let line: string
  if (primaryDiff != null && secondaryDiff != null) {
    if (Math.abs(primaryDiff) >= 0.5 || Math.abs(secondaryDiff) >= 0.5) {
      line = `${symbol} ${primaryDiff >= 0 ? 'outperformed' : 'underperformed'} ${compareNamePrimary} by ${describeDiff(primaryDiff)} and ${compareNameSecondary} by ${describeDiff(secondaryDiff)}, pointing to ${tone === 'outperform' ? 'stock-specific strength' : 'idiosyncratic pressure'}.`
    } else {
      line = `${symbol} tracked ${compareNamePrimary} and ${compareNameSecondary} closely, so the move looks mostly tape-driven.`
    }
  } else if (primaryDiff != null) {
    if (Math.abs(primaryDiff) >= 0.5) {
      line = `${symbol} ${primaryDiff >= 0 ? 'outperformed' : 'underperformed'} ${compareNamePrimary} by ${describeDiff(primaryDiff)}, pointing to ${tone === 'outperform' ? 'stock-specific strength' : 'idiosyncratic pressure'}.`
    } else {
      line = `${symbol} tracked ${compareNamePrimary} closely, so the move looks mostly tape-driven.`
    }
  } else if (secondaryDiff != null) {
    if (Math.abs(secondaryDiff) >= 0.5) {
      line = `${symbol} ${secondaryDiff >= 0 ? 'outperformed' : 'underperformed'} ${compareNameSecondary} by ${describeDiff(secondaryDiff)}, pointing to ${tone === 'outperform' ? 'stock-specific strength' : 'idiosyncratic pressure'}.`
    } else {
      line = `${symbol} tracked ${compareNameSecondary} closely, so the move looks mostly tape-driven.`
    }
  } else {
    line = `${symbol} remains tied to the broader tape, with no clean relative benchmark available.`
  }

  return {
    line,
    tone,
    primaryBenchmark: compareNamePrimary,
    secondaryBenchmark: compareNameSecondary,
    relativeToPrimary: primaryDiff,
    relativeToSecondary: secondaryDiff,
  }
}
