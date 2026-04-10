import type { ToneCode, ToneName } from './toneSelector'

export type NarrativeArticle = {
  title?: string | null
  publisher?: string | null
  published_at?: string | null
  url?: string | null
}

export type NarrativeInput = {
  toneCode: ToneCode
  toneName: ToneName
  sensors: {
    lpiBand?: string | null
    rpiBand?: string | null
    vriBand?: string | null
    xconf?: string | null
    ghedge?: string | null
    structure?: 'Strong' | 'Balanced' | 'Weak'
  }
  articles: NarrativeArticle[]
}

export type NarrativeOutput = {
  title: string
  subtitle: string
  paragraphs: string[]
  sources: string[]
}

const OPENING: Record<ToneCode, string> = {
  T0: 'Market conditions are calm and orderly.',
  T1: 'Market conditions are confirming the current trend.',
  T2: 'Market conditions are cautious and deserve attention.',
  T3: 'Market conditions are defensive and should be handled carefully.',
  T4: 'Market conditions warrant a shock-watch posture.',
}

const FOLLOW_UP: Record<ToneCode, string> = {
  T0: 'The base case is steady price action with limited stress.',
  T1: 'Momentum is still intact, but confirmation matters more than speed.',
  T2: 'The setup is mixed, so risk controls matter more than chasing moves.',
  T3: 'Defensive positioning is reasonable until the signal improves.',
  T4: 'Stay alert for fast repricing and keep the narrative tight.',
}

function normalize(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function structureText(v?: 'Strong' | 'Balanced' | 'Weak'): string {
  if (v === 'Strong') return 'strong'
  if (v === 'Weak') return 'weak'
  return 'balanced'
}

function pickSources(articles: NarrativeArticle[]): string[] {
  return (articles || [])
    .slice(0, 2)
    .map((article) => {
      const publisher = article.publisher || 'Unknown'
      const published = String(article.published_at || '').slice(0, 16).replace('T', ' ')
      return `${publisher} (${published})`
    })
}

function articleNarrativeLine(articles: NarrativeArticle[]): string {
  const items = (articles || []).slice(0, 2)
  if (!items.length) {
    return 'No fresh headlines were selected, so the read leans on the sensor snapshot.'
  }

  const formatted = items.map((article) => {
    const title = normalize(article.title || 'Untitled headline')
    const publisher = article.publisher || 'News source'
    return `${title} (${publisher})`
  })

  if (formatted.length === 1) {
    return `The day is centered on ${formatted[0]}, keeping the tape tied to a single catalyst.`
  }

  return `The day is centered on ${formatted[0]} and ${formatted[1]}, which keeps the session event-driven rather than purely technical.`
}

export function buildMarketNarrative(input: NarrativeInput): NarrativeOutput {
  const lpi = input.sensors.lpiBand || 'Neutral'
  const rpi = input.sensors.rpiBand || 'Stable'
  const vri = input.sensors.vriBand || 'Normal'
  const xconf = input.sensors.xconf || 'Mixed'
  const ghedge = input.sensors.ghedge || 'Mixed'
  const structure = structureText(input.sensors.structure)

  const paragraphs = [
    `${OPENING[input.toneCode]} The setup is ${structure}, so the move still depends on follow-through rather than one strong headline.`,
    `LPI is ${lpi}, RPI is ${rpi}, and VRI is ${vri}, which keeps the macro read from leaning too far in one direction.`,
    `XCONF is ${xconf} and Ghedge is ${ghedge}, so confirmation still matters before the tape can be called settled.`,
    articleNarrativeLine(input.articles),
    FOLLOW_UP[input.toneCode],
  ]
    .map(normalize)
    .filter(Boolean)

  return {
    title: normalize(`${input.toneName} market context`),
    subtitle: normalize(`${lpi}/${rpi}/${vri} | XCONF: ${xconf}`),
    paragraphs,
    sources: pickSources(input.articles),
  }
}
