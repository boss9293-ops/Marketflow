import type { NarrativeSpine } from '@/lib/terminal-mvp/narrativeSpineBuilder'
import type { PriceAnchorResult } from '@/lib/terminal-mvp/priceAnchorLayer'

export type NarrativeRenderInput = {
  priceAnchor: PriceAnchorResult
  spine: NarrativeSpine
}

export type NarrativeRenderResult = {
  lines: string[]
  text: string
}

const cleanLine = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()

const ensureSentence = (value: string): string => {
  const cleaned = cleanLine(value)
  if (!cleaned) return ''
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`
}

const dedupeLines = (lines: string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    const cleaned = ensureSentence(line)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    result.push(cleaned)
  }
  return result
}

export function renderNarrativeBrief(input: NarrativeRenderInput): NarrativeRenderResult {
  const { priceAnchor, spine } = input

  const lines = dedupeLines([
    priceAnchor.line,
    spine.TIMELINE,
    spine.CATALYST,
    spine.INSTITUTION,
    spine.NUMBERS,
    [spine.RELATIVE_VIEW, spine.CONFIDENCE].filter(Boolean).join(' '),
    spine.RISK,
  ])

  const capped = lines.slice(0, 7)
  return {
    lines: capped,
    text: capped.join('\n'),
  }
}
