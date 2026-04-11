import type { TimelineFlowResult, TimelinePhase } from '@/lib/terminal-mvp/timelineEngine'

export type PriceAnchorInput = {
  symbol: string
  price: number | null
  changePct: number | null
  timeline?: TimelineFlowResult | null
  session?: 'morning' | 'afternoon' | 'auto'
}

export type PriceAnchorResult = {
  line: string
  direction: 'positive' | 'negative' | 'neutral'
  sessionLabel: string
  flowHint: string
}

const formatChange = (value: number | null): string => {
  if (!Number.isFinite(value ?? NaN)) return '0.00%'
  const safe = Number(value)
  return `${safe >= 0 ? '+' : ''}${safe.toFixed(2)}%`
}

const formatPrice = (value: number | null): string => {
  if (!Number.isFinite(value ?? NaN)) return '$0.00'
  return `$${Number(value).toFixed(2)}`
}

const PHASE_HINTS: Record<TimelinePhase, string> = {
  premarket: 'premarket positioning',
  open: 'open weakness',
  midday: 'midday drift',
  afternoon: 'afternoon stabilization',
  close: 'close confirmation',
}

const PHASE_ORDER: TimelinePhase[] = ['premarket', 'open', 'midday', 'afternoon', 'close']

const toDirection = (changePct: number | null): 'positive' | 'negative' | 'neutral' => {
  if (!Number.isFinite(changePct ?? NaN)) return 'neutral'
  if ((changePct ?? 0) > 0) return 'positive'
  if ((changePct ?? 0) < 0) return 'negative'
  return 'neutral'
}

const getSessionLabel = (
  session: 'morning' | 'afternoon' | 'auto',
  timeline?: TimelineFlowResult | null,
): string => {
  if (timeline?.dominantPhase === 'close') return '16:00 ET'
  if (timeline?.dominantPhase === 'premarket' || timeline?.dominantPhase === 'open') return '09:30 ET'
  if (timeline?.dominantPhase === 'midday') return '12:30 ET'
  if (timeline?.dominantPhase === 'afternoon') return '15:00 ET'
  return session === 'morning' ? '09:30 ET' : session === 'afternoon' ? '16:00 ET' : 'session tape'
}

const buildFlowHint = (
  timeline?: TimelineFlowResult | null,
  direction: 'positive' | 'negative' | 'neutral' = 'neutral',
): string => {
  const entries = timeline?.phaseEntries ?? []
  if (!entries.length) {
    if (direction === 'negative') return 'early weakness extended before stabilizing'
    if (direction === 'positive') return 'early strength held into the close'
    return 'the tape stayed event-driven'
  }

  const ordered = [...entries].sort(
    (left, right) =>
      PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase) ||
      right.confidence - left.confidence,
  )
  const first = PHASE_HINTS[ordered[0]?.phase ?? 'open']
  const last = PHASE_HINTS[ordered[ordered.length - 1]?.phase ?? 'close']

  if (!first || !last) {
    return direction === 'negative'
      ? 'early weakness extended before stabilizing'
      : direction === 'positive'
        ? 'early strength held into the close'
        : 'the tape stayed event-driven'
  }

  if (ordered.length === 1 || first === last) {
    return `${first} stayed in focus`
  }

  return `${first} gave way to ${last}`
}

export function buildPriceAnchorLayer(input: PriceAnchorInput): PriceAnchorResult {
  const { symbol, price, changePct, timeline, session = 'auto' } = input
  const direction = toDirection(changePct)
  const sessionLabel = getSessionLabel(session, timeline)
  const flowHint = buildFlowHint(timeline, direction)

  if (!Number.isFinite(price ?? NaN)) {
    const fallbackLine =
      direction === 'negative'
        ? `${symbol} remained under pressure as of ${sessionLabel}, with ${flowHint}.`
        : direction === 'positive'
          ? `${symbol} stayed firm as of ${sessionLabel}, with ${flowHint}.`
          : `${symbol} stayed tape-driven as of ${sessionLabel}, with ${flowHint}.`

    return {
      line: fallbackLine,
      direction,
      sessionLabel,
      flowHint,
    }
  }

  const signedChange = formatChange(changePct)
  const priceText = formatPrice(price)
  const line = `${symbol} ${signedChange} at ${priceText} as of ${sessionLabel}, with ${flowHint}.`

  return {
    line,
    direction,
    sessionLabel,
    flowHint,
  }
}
