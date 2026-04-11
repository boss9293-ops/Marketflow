import { NextResponse } from 'next/server'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'
import { truncateText } from '@/lib/text/vrTone'
import { clusterNewsItems } from '@/lib/terminal-mvp/clusterEngine'
import { buildConfidenceProfile } from '@/lib/terminal-mvp/confidenceEngine'
import { buildRelativeView, type MarketTapeItem } from '@/lib/terminal-mvp/multiSymbolEngine'
import { buildNarrativeSpine } from '@/lib/terminal-mvp/narrativeSpineBuilder'
import { renderNarrativeBrief } from '@/lib/terminal-mvp/narrativeRenderer'
import { buildPriceAnchorLayer } from '@/lib/terminal-mvp/priceAnchorLayer'
import { buildSessionThesis } from '@/lib/terminal-mvp/sessionThesisEngine'
import { buildTimelineFlow } from '@/lib/terminal-mvp/timelineEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type NewsInputItem = {
  id: string
  timeET: string
  headline: string
  summary: string
}

type NewsSynthSession = 'morning' | 'afternoon' | 'auto'

type SynthesizeRequest = {
  symbol: string
  companyName?: string
  dateET?: string
  price?: number | null
  changePct?: number | null
  items: NewsInputItem[]
  lang: 'ko' | 'en'
  marketContext?: string
  session?: NewsSynthSession
}

type SynthesizedItem = {
  id: string
  text: string
}

type ItemBlock = {
  item: NewsInputItem
  sessionHint: 'morning' | 'afternoon'
}

const MAX_ITEMS_PER_BATCH = 20
const LOW_DENSITY_ITEM_THRESHOLD = 2
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const OPENAI_API = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = 'gpt-4o-mini'

const stripCodeFences = (value: string): string =>
  value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^a-z0-9\uac00-\ud7a3\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const parseClockMinutes = (value: string): number | null => {
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

const inferSessionHint = (timeET: string): 'morning' | 'afternoon' => {
  const minutes = parseClockMinutes(timeET)
  if (minutes == null) return 'afternoon'
  return minutes < 12 * 60 ? 'morning' : 'afternoon'
}

const sentenceCount = (value: string): number =>
  value
    .split(/[.!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean).length

const countNonSpaceChars = (value: string): number => value.replace(/\s+/gu, '').length

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword))

const hasKoreanFinal = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false
  const last = trimmed.charCodeAt(trimmed.length - 1)
  if (last < 0xac00 || last > 0xd7a3) return false
  return (last - 0xac00) % 28 !== 0
}

const particle = (value: string, consonant: string, vowel: string): string =>
  hasKoreanFinal(value) ? consonant : vowel

const COMPANY_NAME_STOPWORDS = new Set([
  'inc',
  'incorporated',
  'corporation',
  'corp',
  'company',
  'co',
  'ltd',
  'limited',
  'holdings',
  'holding',
  'class',
  'common',
  'shares',
  'share',
])

const NEWS_CATALYST_KEYWORDS = [
  'earnings',
  'guidance',
  'analyst',
  'target',
  'rating',
  'upgrade',
  'downgrade',
  'revenue',
  'margin',
  'delivery',
  'deliveries',
  'shipment',
  'shipments',
  'order',
  'orders',
  'contract',
  'deal',
  'approval',
  'regulation',
  'probe',
  'tariff',
  'export',
  'supply chain',
  'ai',
  'artificial intelligence',
  'chip',
  'chips',
  'semiconductor',
  'semiconductors',
  'gpu',
  'data center',
  'datacenter',
  'cloud',
  'hyperscaler',
  'blackwell',
  'cuda',
  'inference',
  'server',
  'power',
  'oil',
  'crude',
  'rate',
  'rates',
  'inflation',
  'fed',
  'cpi',
  'ppi',
  'yield',
  'treasury',
  'geopolitical',
  'china',
  'iran',
  'israel',
  'cyber',
  'hack',
  'antitrust',
]

const NEWS_NOISE_KEYWORDS = [
  'sneaker',
  'fashion',
  'movie',
  'concert',
  'recipe',
  'celebrity',
  'sports',
  'wedding',
  'gossip',
  'travel',
  'airline',
  'hotel',
  'restaurant',
  'music',
  'beauty',
  'lifestyle',
]

const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[^a-z0-9\uac00-\ud7a3\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const scoreNewsItem = (
  item: NewsInputItem,
  symbol: string,
  companyName?: string,
): number => {
  const text = normalizeForMatch(`${item.headline || ''} ${item.summary || ''}`)
  const normalizedSymbol = normalizeForMatch(symbol)
  let score = 0

  if (normalizedSymbol && text.includes(normalizedSymbol)) {
    score += 6
  }

  const companyTokens = normalizeForMatch(companyName ?? '')
    .split(' ')
    .filter((token) => token.length >= 4 && !COMPANY_NAME_STOPWORDS.has(token))

  if (companyTokens.some((token) => text.includes(token))) {
    score += 4
  }

  if (containsAny(text, NEWS_CATALYST_KEYWORDS)) {
    score += 3
  }

  if (containsAny(text, NEWS_NOISE_KEYWORDS)) {
    score -= 3
  }

  if (!normalizedSymbol && !companyTokens.length) {
    score -= 1
  }

  return score
}

const selectRelevantItems = (
  batch: NewsInputItem[],
  symbol: string,
  companyName?: string,
): NewsInputItem[] => {
  const scored = batch.map((item, index) => ({
    item,
    index,
    score: scoreNewsItem(item, symbol, companyName),
  }))

  const keepAtLeast = Math.min(5, scored.length)
  let selected = scored.filter((entry) => entry.score >= 1)

  if (selected.length < keepAtLeast) {
    const ranked = [...scored]
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .filter((entry) => !selected.some((picked) => picked.item.id === entry.item.id))
    selected = selected.concat(ranked.slice(0, keepAtLeast - selected.length))
  }

  if (selected.length > 12) {
    selected = [...selected]
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 12)
  }

  return selected
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item)
}



type EventCard = {
  eventType: string
  summary: string
  direction: 'positive' | 'negative' | 'neutral'
  impactHint: string
  source: string
  timeET: string
  sessionHint: 'morning' | 'afternoon'
  score: number
  confidence: number
}

type NarrativeSlot = {
  event: string
  why: string
  direction: 'positive' | 'negative' | 'neutral'
  score: number
  source: string
}

const EVENT_TYPE_RULES: Array<{
  type: string
  keywords: string[]
  impactHint: string
  priority: number
}> = [
  { type: 'analyst_action', keywords: ['price target', 'target', 'upgrade', 'downgrade', 'rating', 'analyst'], impactHint: 'valuation / expectations', priority: 5 },
  { type: 'earnings', keywords: ['earnings', 'guidance', 'revenue', 'margin', 'eps', 'sales'], impactHint: 'earnings / margin', priority: 5 },
  { type: 'delivery', keywords: ['delivery', 'deliveries', 'shipment', 'shipments', 'production', 'orders'], impactHint: 'demand / supply', priority: 4 },
  { type: 'macro_event', keywords: ['cpi', 'ppi', 'fed', 'powell', 'rates', 'yield', 'inflation', 'dollar', 'treasury'], impactHint: 'macro / rates', priority: 4 },
  { type: 'geopolitical', keywords: ['iran', 'hormuz', 'tariff', 'trump', 'war', 'attack', 'strike', 'ceasefire'], impactHint: 'geo / policy', priority: 4 },
  { type: 'product_cycle', keywords: ['launch', 'release', 'product', 'model', 'chip', 'platform', 'software', 'ai', 'gpu', 'data center', 'blackwell', 'cuda'], impactHint: 'product cycle', priority: 3 },
  { type: 'risk', keywords: ['probe', 'lawsuit', 'recall', 'investigation', 'ban', 'regulation', 'fraud'], impactHint: 'risk / legal', priority: 5 },
  { type: 'technical_setup', keywords: ['breakout', 'support', 'resistance', 'record high', 'record low', 'range'], impactHint: 'technical setup', priority: 3 },
  { type: 'sector_rotation', keywords: ['semiconductor', 'energy', 'oil', 'gold', 'utilities', 'software', 'health care', 'bank'], impactHint: 'sector rotation', priority: 3 },
]

const POSITIVE_HINTS = [
  'beat',
  'beats',
  'raise',
  'raised',
  'upgrade',
  'higher',
  'increase',
  'increased',
  'surge',
  'rally',
  'gain',
  'gains',
  'support',
  'approval',
  'launch',
  'deal',
  'contract',
  'record',
  'strong',
  'improve',
  'improved',
  'expansion',
  'buy',
  'outperform',
  'breakout',
  'recover',
  'recovery',
  'bull',
  'upside',
]

const NEGATIVE_HINTS = [
  'miss',
  'cuts',
  'cut',
  'lower',
  'downgrade',
  'weak',
  'decline',
  'slump',
  'pressure',
  'probe',
  'investigation',
  'risk',
  'concern',
  'tariff',
  'ban',
  'lawsuit',
  'recall',
  'delay',
  'shortfall',
  'selloff',
  'drop',
  'fall',
  'negative',
  'downside',
]

const eventDirection = (text: string): 'positive' | 'negative' | 'neutral' => {
  const lower = normalizeForMatch(text)
  const pos = POSITIVE_HINTS.filter((hint) => lower.includes(hint)).length
  const neg = NEGATIVE_HINTS.filter((hint) => lower.includes(hint)).length
  if (pos > neg + 1) return 'positive'
  if (neg > pos + 1) return 'negative'
  return 'neutral'
}

const eventTypeFromText = (text: string): { eventType: string; impactHint: string; direction: 'positive' | 'negative' | 'neutral'; priority: number } => {
  const lower = normalizeForMatch(text)
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      const direction = rule.type === 'risk' ? 'negative' : eventDirection(lower)
      return {
        eventType: rule.type,
        impactHint: rule.impactHint,
        direction,
        priority: rule.priority,
      }
    }
  }
  return {
    eventType: 'market_update',
    impactHint: 'broad market read-through',
    direction: eventDirection(lower),
    priority: 1,
  }
}

const eventCardScore = (card: EventCard, rank: number, total: number): number => {
  const directWeight =
    card.eventType === 'analyst_action' || card.eventType === 'earnings'
      ? 1.0
      : card.eventType === 'delivery' || card.eventType === 'macro_event' || card.eventType === 'geopolitical'
        ? 0.95
        : card.eventType === 'risk'
          ? 0.9
          : card.eventType === 'product_cycle'
            ? 0.8
            : 0.65

  const recency = 1.0 - ((rank / Math.max(1, total - 1)) * 0.3)
  const magnitude = containsAny(
    `${card.summary} ${card.impactHint}`,
    ['record', 'target', 'beat', 'miss', 'guidance', 'delivery', 'cpi', 'fed', 'tariff', 'breakout', 'deal', 'approval'],
  )
    ? 1.0
    : 0.6
  const directionBoost = card.direction === 'neutral' ? 0.78 : 1.0
  const score = (directWeight * 0.4) + (recency * 0.2) + (magnitude * 0.2) + (directionBoost * 0.2)
  return Math.max(0.05, Math.min(0.99, Number(score.toFixed(3))))
}

const buildEventCards = (batch: ItemBlock[], symbol: string, companyName?: string): EventCard[] => {
  const symbolToken = normalizeForMatch(symbol)
  const companyTokens = normalizeForMatch(companyName ?? '')
    .split(' ')
    .filter((token) => token.length >= 4)

  const cards = batch.map((block, rank) => {
    const combined = `${block.item.headline || ''} ${block.item.summary || ''}`.trim()
    const classified = eventTypeFromText(combined)
    const summary = stripLeadingNumbering(
      truncateText(
        block.item.summary?.trim()
          ? `${block.item.headline.trim()}. ${block.item.summary.trim()}`
          : block.item.headline.trim(),
        240,
      ),
    )
    const symbolHit = symbolToken && normalizeForMatch(combined).includes(symbolToken)
    const companyHit = companyTokens.some((token) => normalizeForMatch(combined).includes(token))
    const catalystHit = containsAny(normalizeForMatch(combined), NEWS_CATALYST_KEYWORDS)
    const noiseHit = containsAny(normalizeForMatch(combined), NEWS_NOISE_KEYWORDS)
    const boostedDirection =
      classified.direction === 'neutral'
        ? (symbolHit || companyHit || catalystHit ? eventDirection(combined) : 'neutral')
        : classified.direction

    const card: EventCard = {
      eventType: classified.eventType,
      summary,
      direction: boostedDirection,
      impactHint: classified.impactHint,
      source: 'news-batch',
      timeET: block.item.timeET || '',
      sessionHint: block.sessionHint,
      score: 0,
      confidence: 0,
    }

    const score = eventCardScore(card, rank, batch.length)
    const penalty = noiseHit ? 0.12 : 0
    card.score = Math.max(0.05, Math.min(0.99, Number((score - penalty).toFixed(3))))
    card.confidence = Math.max(0.1, Math.min(0.99, Number((card.score + (symbolHit || companyHit ? 0.05 : 0)).toFixed(2))))
    return card
  })

  return cards
    .sort((a, b) => b.score - a.score || a.timeET.localeCompare(b.timeET))
    .slice(0, 12)
}

const compactEventLabel = (value: string): string => {
  const cleaned = stripLeadingNumbering(value)
    .replace(/\s+/gu, ' ')
    .trim()

  if (!cleaned) return ''

  const driverMatch = cleaned.match(
    /(?:driven by|supported by|backed by|helped by|boosted by|from|amid|on|as)\s+(.+?)(?:[.;]|, while|, with| while | with |$)/i,
  )
  if (driverMatch?.[1]) {
    return truncateText(driverMatch[1].trim(), 140)
  }

  const firstSentence = cleaned.split(/(?<=[.!?])\s+/u)[0] ?? cleaned
  return truncateText(firstSentence.replace(/[^a-z0-9가-힣\s.,;:/'"()\-+%$]/giu, '').trim(), 140)
}

const buildNarrativePlan = (
  cards: EventCard[],
  symbol: string,
  companyName?: string,
  marketContext?: string,
): {
  price_context: string
  primary_driver: NarrativeSlot
  secondary_driver: NarrativeSlot
  counterweight: NarrativeSlot
  watchpoint: NarrativeSlot
  supporting_events: NarrativeSlot[]
} => {
  const marketContextHint = marketContext?.trim() || 'N/A'
  const label = [symbol, companyName].filter(Boolean).join(' / ') || symbol
  const priceContext = cards[0]?.summary?.trim()
    || (marketContextHint !== 'N/A' ? `Market context: ${marketContextHint}` : `Ticker context: ${label}`)

  if (!cards.length) {
    return {
      price_context: priceContext,
      primary_driver: { event: '', why: '', direction: 'neutral', score: 0, source: '' },
      secondary_driver: { event: '', why: '', direction: 'neutral', score: 0, source: '' },
      counterweight: { event: '', why: '', direction: 'neutral', score: 0, source: '' },
      watchpoint: { event: '', why: '', direction: 'neutral', score: 0, source: '' },
      supporting_events: [],
    }
  }

  const primary = [...cards].sort((a, b) => b.score - a.score)[0]
  const secondary = cards.find((card) => card.summary !== primary.summary && card.eventType !== primary.eventType)
  const counterweight =
    cards.find((card) => card.summary !== primary.summary && (
      (card.direction !== 'neutral' && card.direction !== primary.direction)
      || card.eventType === 'risk'
      || card.eventType === 'macro_event'
    ))
    ?? cards.find((card) => card.summary !== primary.summary)
  const watchpoint =
    cards.find((card) => (
      card.eventType === 'earnings'
      || card.eventType === 'macro_event'
      || card.eventType === 'geopolitical'
      || containsAny(normalizeForMatch(card.summary), ['next', 'upcoming', 'tomorrow', 'later', 'watch', 'this week'])
    ))
    ?? cards.find((card) => card.summary !== primary.summary && card.summary !== (secondary?.summary ?? ''))
    ?? primary

  const used = new Set([
    primary.summary,
    secondary?.summary ?? '',
    counterweight?.summary ?? '',
    watchpoint?.summary ?? '',
  ])

  const supporting_events = cards
    .filter((card) => !used.has(card.summary))
    .slice(0, 4)
    .map((card) => ({
      event: card.summary,
      why: card.impactHint,
      direction: card.direction,
      score: card.score,
      source: card.source,
    }))

  const slot = (card?: EventCard): NarrativeSlot => card ? {
    event: compactEventLabel(card.summary),
    why: card.impactHint,
    direction: card.direction,
    score: card.score,
    source: card.source,
  } : { event: '', why: '', direction: 'neutral', score: 0, source: '' }

  return {
    price_context: priceContext,
    primary_driver: slot(primary),
    secondary_driver: slot(secondary),
    counterweight: slot(counterweight),
    watchpoint: slot(watchpoint),
    supporting_events,
  }
}


type DigestResult = {
  text: string
}

const getCurrentEtDate = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const buildDigestSystemPrompt = (lang: 'ko' | 'en'): string =>
  lang === 'ko'
    ? [
        'You are an institutional financial terminal editor writing Korean outputs.',
        'Use the rendered narrative draft and structured spine as the only primary sources.',
        'Do not reference raw news or headlines.',
        'Write a 5 to 7 line market brief in a Terminal X style.',
        'Line 1 must include price, time, and change.',
        'Line 2 must describe the intraday progression or timeline flow.',
        'Later lines should cover the main catalyst, institutional or flow context, numbers or relative view, confidence tone, and risk.',
        'The final line must be the forward risk or checkpoint.',
        'Keep the tone dense, analytical, and explanation-first.',
        'Return JSON only in this exact shape: {"text":"..."}',
      ].join('\n')
    : [
        'You are an institutional financial terminal editor.',
        'Use the rendered narrative draft and structured spine as the only primary sources.',
        'Do not reference raw news or headlines.',
        'Write a 5 to 7 line market brief in a Terminal X style.',
        'Line 1 must include price, time, and change.',
        'Line 2 must describe the intraday progression or timeline flow.',
        'Later lines should cover the main catalyst, institutional or flow context, numbers or relative view, confidence tone, and risk.',
        'The final line must be the forward risk or checkpoint.',
        'Keep the tone dense, analytical, and explanation-first.',
        'Return JSON only in this exact shape: {"text":"..."}',
      ].join('\n')

const buildDigestPrompt = (
  symbol: string,
  _lang: 'ko' | 'en',
  marketContext?: string,
  companyName?: string,
  renderedDraft?: string,
  spineJson?: string,
  price?: number | null,
  changePct?: number | null,
  dateET?: string,
): string => {
  const marketContextBlock = marketContext?.trim() ? marketContext.trim() : 'N/A'
  const companyNameBlock = companyName?.trim() ? companyName.trim() : 'N/A'
  const renderedDraftBlock = renderedDraft?.trim() || '[]'
  const spineBlock = spineJson?.trim() || '{}'
  const priceBlock = Number.isFinite(price ?? NaN) ? `${Number(price).toFixed(2)}` : 'N/A'
  const changeBlock = Number.isFinite(changePct ?? NaN)
    ? `${Number(changePct) >= 0 ? '+' : ''}${Number(changePct).toFixed(2)}%`
    : 'N/A'
  const dateBlock = dateET?.trim() || 'N/A'

  return [
    `Symbol: ${symbol}`,
    `Company name: ${companyNameBlock}`,
    `Market context: ${marketContextBlock}`,
    `Date ET: ${dateBlock}`,
    `Price: ${priceBlock}`,
    `Change: ${changeBlock}`,
    '',
    'Write one digest note for the whole batch, not separate item notes.',
    'Use the rendered narrative draft and narrative spine as the only primary sources.',
    'Do not repeat headlines or mention raw items.',
    'The output should read like a Terminal X daily note: explanation-first, not headline-first.',
    'Use the spine fields in this priority order: PRICE, TIMELINE, CATALYST, INSTITUTION, NUMBERS, RELATIVE_VIEW, CONFIDENCE, RISK.',
    'Keep the narrative anchored to price action, intraday progression, relative view, confidence tone, numbers, and forward risk.',
    'The rendered draft is the preferred shape; improve fluency, but keep the causal chain and line order.',
    'Return JSON only: {"text":"..."}',
    '',
    'RENDERER DRAFT (Layer 5, line draft):',
    renderedDraftBlock,
    '',
    'NARRATIVE SPINE (Layer 3-6, primary source):',
    spineBlock,
  ].join('\n')
}

const buildSystemPrompt = (_lang: 'ko' | 'en'): string =>
  [
    'You are an institutional financial terminal editor.',
    'Turn each news item into a dense, explanation-first Terminal X-style note with Terminal X-level length.',
    'Treat the batch as a compact evidence pack, not isolated clips; if several items point to the same catalyst, connect them into one storyline.',
    'Do not repeat the headline verbatim. Use the headline and summary to explain why the item matters to the stock.',
    'Each item should be 3 to 5 sentences, not a headline fragment.',
    'Include one main catalyst, one or two secondary factors, a counterpoint or risk when possible, and one forward checkpoint.',
    'Korean outputs should target 300 to 400 characters excluding spaces. English outputs should target around 600 characters excluding spaces.',
    'If marketContext is provided, use it only to explain the news reaction; do not mechanically restate it.',
    'Morning-like items should emphasize premarket/open implications.',
    'Afternoon-like items should emphasize close/session reaction and the next checkpoint.',
    'Avoid hype, sensational language, and unsupported speculation.',
    'If evidence is thin, note that fresh material is limited without collapsing into a headline.',
    'Return JSON only in this exact shape: {"items":[{"id":"...","text":"..."}]}',
  ].join('\n')

const buildDigestRetryPrompt = (
  originalPrompt: string,
  validationReasons: string[],
  lang: 'ko' | 'en',
): string => {
  const reasons = validationReasons.join(', ')

  if (lang === 'ko') {
    return [
      '이전 출력은 Terminal X 스타일 기준을 충족하지 못했다.',
      `실패 사유: ${reasons}`,
      '',
      '다시 작성하라.',
      '',
      '조건:',
      '- 한국어',
      '- JSON만 반환',
      '- 5~7줄',
      '- 첫 줄에 가격, 시각, 등락률 포함',
      '- 둘째 줄은 intraday progression 또는 timeline flow를 설명할 것',
      '- 뉴스 제목 반복 금지',
      '- 원인, 보조 요인, 상대 비교, confidence, 리스크, 관전 포인트를 모두 담아라',
      '- 마지막 줄은 반드시 리스크 또는 다음 관전 포인트로 끝낼 것',
      '- 설명형 문장으로 쓰고 헤드라인처럼 끊지 말 것',
      '',
      '기존 의도는 유지하되, 더 설명적이고 Terminal X 수준의 길이로 다시 써라.',
      '',
      originalPrompt,
    ].join('\n')
  }

  return [
    'The previous output failed the Terminal X-style quality check.',
    `Failure reasons: ${reasons}`,
    '',
    'Rewrite the entire batch.',
    '',
    'Requirements:',
    '- English only',
    '- JSON only',
    '- 5 to 7 lines',
    '- First line must include price, time, and change',
    '- Second line must describe intraday progression or timeline flow',
    '- Do not repeat headlines',
    '- Include a main catalyst, secondary factor, relative view, confidence tone, risk, and a forward checkpoint',
    '- The final line must close on risk or the next checkpoint',
    '- Write dense explanation-first prose',
    '',
    'Keep the original intent, but make the output more explanatory and Terminal X-level in length.',
    '',
    originalPrompt,
  ].join('\n')
}

const buildDigestFallbackText = (
  symbol: string,
  _lang: 'ko' | 'en',
  spine: {
    PRICE: string
    TIMELINE: string
    CATALYST: string
    INSTITUTION: string
    NUMBERS: string
    RELATIVE_VIEW: string
    CONFIDENCE: string
    RISK: string
  },
  renderedDraft?: string,
  marketContext?: string,
): string => {
  if (renderedDraft?.trim()) {
    return renderedDraft.trim()
  }

  const lines = [
    spine.PRICE,
    spine.TIMELINE,
    spine.CATALYST,
    spine.INSTITUTION,
    spine.NUMBERS,
    [spine.CONFIDENCE, spine.RELATIVE_VIEW].filter(Boolean).join(' '),
    spine.RISK || (marketContext?.trim() ? `Market context: ${marketContext.trim()}` : `${symbol} remains tied to the tape and the next session follow-through.`),
  ]

  return lines.join('\n')
}

const parseDigestResponse = (raw: string): string | null => {
  const cleaned = stripCodeFences(raw)

  try {
    const parsed = JSON.parse(cleaned) as { text?: string } | string | null
    if (typeof parsed === 'string') {
      const text = parsed.trim()
      return text || null
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      const text = parsed.text.trim()
      return text || null
    }
  } catch {
    // Fall through to plain text.
  }

  const plain = cleaned.trim()
  return plain || null
}

const validateDigestText = (
  text: string,
  lang: 'ko' | 'en',
): { passed: boolean; reasons: string[] } => {
  const reasons: string[] = []
  const chars = countNonSpaceChars(text)
  const lines = text
    .split(/\r?\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)

  const minChars = lang === 'ko' ? 300 : 520
  const maxChars = lang === 'ko' ? 2200 : 2600
  const priceKeywords =
    lang === 'ko'
      ? ['가격', '등락', '시각', '마감', '장중', '오전', '오후', 'ET', '%']
      : ['price', 'time', 'change', 'opened', 'closed', '%', 'session']
  const timelineKeywords =
    lang === 'ko'
      ? ['장초반', '장중', '마감', '개장', '후반', '초반', '흐름', 'timeline']
      : ['premarket', 'open', 'midday', 'afternoon', 'close', 'early', 'late', 'timeline']
  const relativeKeywords =
    lang === 'ko'
      ? ['상대', '대비', '비교', 'QQQ', 'SPY', '시장', '업종']
      : ['relative', 'vs', 'outperform', 'underperform', 'QQQ', 'SPY', 'market', 'sector']
  const confidenceKeywords =
    lang === 'ko'
      ? ['확신', '신뢰', '강함', '혼재', '약함', 'conviction']
      : ['confidence', 'conviction', 'strong', 'mixed', 'weak', 'high conviction']
  const causeKeywords =
    lang === 'ko'
      ? ['영향', '반영', '힘입어', '지지', '부담', '촉매', '원인', '드라이버']
      : ['driven by', 'because', 'due to', 'catalyst', 'support', 'pressure', 'backed by', 'anchor']
  const riskKeywords =
    lang === 'ko'
      ? ['다만', '리스크', '주의', '관전', '주목', '향후', '다음', '변수', '점검']
      : ['however', 'risk', 'watch', 'checkpoint', 'next', 'variable', 'caution']
  const institutionKeywords =
    lang === 'ko'
      ? ['애널리스트', '기관', '목표가', '평가', '증권사', '매크로', '금리', '국채']
      : ['analyst', 'institution', 'target', 'rating', 'macro', 'rates', 'yield', 'wall street']

  if (chars < minChars) reasons.push('too_short')
  if (chars > maxChars) reasons.push('too_long')
  if (lines.length < 5) reasons.push('too_few_lines')
  if (lines.length > 7) reasons.push('too_many_lines')

  const firstLine = lines[0] || ''
  const lastLine = lines[lines.length - 1] || ''

  if (!containsAny(firstLine, priceKeywords)) {
    reasons.push('missing_price_context')
  }
  if (lines[1] && !containsAny(lines[1], timelineKeywords)) {
    reasons.push('missing_timeline')
  }
  if (!containsAny(text, relativeKeywords)) {
    reasons.push('missing_relative_view')
  }
  if (!containsAny(text, confidenceKeywords)) {
    reasons.push('missing_confidence')
  }
  if (!containsAny(text, causeKeywords)) {
    reasons.push('missing_cause')
  }
  if (!containsAny(text, riskKeywords)) {
    reasons.push('missing_risk')
  }
  if (!(containsAny(text, institutionKeywords) || containsAny(text, ['macro', 'rate', 'yield', 'inflation']))) {
    reasons.push('missing_institution_or_macro')
  }
  if (!containsAny(lastLine, riskKeywords)) {
    reasons.push('final_line_missing_risk')
  }
  if (!/\d/.test(text)) {
    reasons.push('missing_numbers')
  }
  if (lines.length <= 1) {
    reasons.push('headline_like')
  }

  return { passed: reasons.length === 0, reasons }
}

const buildItemBlocks = (batch: NewsInputItem[]): ItemBlock[] =>
  batch.map((item) => ({
    item,
    sessionHint: inferSessionHint(item.timeET),
  }))

const buildUserPrompt = (
  symbol: string,
  items: ItemBlock[],
  lang: 'ko' | 'en',
  marketContext?: string,
  companyName?: string,
  eventCardsJson?: string,
  narrativePlanJson?: string,
): string => {
  const marketContextBlock = marketContext?.trim()
    ? marketContext.trim()
    : 'N/A'
  const companyNameBlock = companyName?.trim()
    ? companyName.trim()
    : 'N/A'
  const eventCardsBlock = eventCardsJson?.trim() || '[]'
  const narrativePlanBlock = narrativePlanJson?.trim() || '{}'
  const layerHint = 'Primary sources are EVENT CARDS and NARRATIVE PLAN; raw items are supporting evidence only.'

  const itemText = items
    .map(({ item, sessionHint }, index) =>
      [
        `[ITEM-${index}]`,
        `id: ${item.id}`,
        `session_hint: ${sessionHint}`,
        `timeET: ${item.timeET}`,
        `headline: ${item.headline || ''}`,
        `summary: ${item.summary || ''}`,
      ].join('\n'),
    )
    .join('\n\n')

  if (lang === 'ko') {
    return [
      `醫낅ぉ: ${symbol}`,
      `?뚯궗紐? ${companyNameBlock}`,
      `?쒖옣 留λ씫: ${marketContextBlock}`,
      '',
      '?꾨옒 ?댁뒪 ??ぉ?ㅼ쓣 媛???ぉ蹂꾨줈 Terminal X ?ㅽ??쇱쓽 吏㏃?留?諛???믪? ?ㅻ챸??硫붾え濡?諛붽퓭??',
      layerHint,
      '??batch??媛숈? 醫낅ぉ???섎윭???곌뎄 ?⑦궎吏?대?濡? 鍮꾩듂??珥됰ℓ???쒕줈 ??뼱???섎굹???ㅽ넗由щ줈 ?뺣━?대룄 ?쒕떎.',
      '媛???ぉ? 3~4臾몄옣?쇰줈 ?곌퀬, ?댁뒪 ?쒕ぉ??洹몃?濡?蹂듭궗?섏? 留먭퀬, ?듭떖 珥됰ℓ? 蹂댁“ ?붿씤, 由ъ뒪???먮뒗 愿???ъ씤?몃? ?먯뿰?ㅻ읇寃???뼱??',
      '?쒖옣 留λ씫???덈뜑?쇰룄 媛寃⑹쓣 諛섎났?섏? 留먭퀬, 洹??댁뒪媛 ?꾩옱 醫낅ぉ ?먮쫫???대뼡 ?섎??몄? ?ㅻ챸?섎뒗 ?곕쭔 ?쒖슜?섎씪.',
      '?꾩묠 ?깃꺽(session_hint=morning)?대㈃ ?꾨━留덉폆/珥덈컲 ?몄뀡 ?댁꽍?? ?ㅽ썑 ?깃꺽(session_hint=afternoon)?대㈃ ?μ쨷 諛섏쓳怨??ㅼ쓬 泥댄겕?ъ씤?몃? ??遺꾨챸???쒕윭?대씪.',
      '異쒕젰? JSON留??덉슜?섎ŉ, 諛섎뱶???낅젰 ?쒖꽌瑜??좎??섍퀬 媛?id瑜?洹몃?濡??⑤씪.',
      '?뺤떇: {"items":[{"id":"...","text":"..."}]}',
      '',
      'EVENT CARDS (Layer 1-2, scored evidence pack):',
      eventCardsBlock,
      '',
      'NARRATIVE PLAN (Layer 3-4, storyline spine):',
      narrativePlanBlock,
      '',
      itemText,
    ].join('\n')
  }

  return [
    `Symbol: ${symbol}`,
    `Company name: ${companyNameBlock}`,
    `Market context: ${marketContextBlock}`,
    '',
    'Rewrite each news item as a dense, explanation-first terminal note.',
    'Treat the batch as a research packet and connect items that share the same catalyst or market reaction.',
    layerHint,
    'Keep each item to 3 to 5 sentences, preserve the input order, and keep the original ids.',
    'Korean outputs should target 300 to 400 characters excluding spaces. English outputs should target around 600 characters excluding spaces.',
    'Use the market context only to explain why the item matters; do not restate it mechanically.',
    'Morning-like items should emphasize premarket/open implications; afternoon-like items should emphasize session reaction and the next checkpoint.',
    'Return JSON only: {"items":[{"id":"...","text":"..."}]}',
    '',
    'EVENT CARDS (Layer 1-2, scored evidence pack):',
    eventCardsBlock,
    '',
    'NARRATIVE PLAN (Layer 3-4, storyline spine):',
    narrativePlanBlock,
    '',
    itemText,
  ].join('\n')
}

const stripLeadingNumbering = (text: string): string =>
  text.replace(/^\s*(?:\d+[.)]|[-*])\s*/u, '').trim()

const parseResponseItems = (raw: string, batch: NewsInputItem[]): SynthesizedItem[] | null => {
  const cleaned = stripCodeFences(raw)

  try {
    const parsed = JSON.parse(cleaned) as
      | { items?: Array<{ id?: string; text?: string }> | string[] }
      | Array<{ id?: string; text?: string }>
      | null
    const items = Array.isArray(parsed) ? parsed : parsed?.items
    if (Array.isArray(items) && items.length) {
      const mapped = items
        .map((entry, index) => {
          if (typeof entry === 'string') {
            return { id: batch[index]?.id ?? `item-${index}`, text: entry.trim() }
          }
          if (entry && typeof entry === 'object') {
            const id = typeof entry.id === 'string' && entry.id.trim()
              ? entry.id.trim()
              : batch[index]?.id ?? `item-${index}`
            const text = typeof entry.text === 'string' ? entry.text.trim() : ''
            return { id, text }
          }
          return null
        })
        .filter((entry): entry is SynthesizedItem => Boolean(entry && entry.text))

      if (mapped.length === batch.length) {
        return mapped
      }
    }
  } catch {
    // Fall through to delimiter parsing.
  }

  const delimiterParts = cleaned
    .split('|||')
    .map((part) => stripLeadingNumbering(part.trim()))
    .filter(Boolean)

  if (delimiterParts.length === batch.length) {
    return batch.map((item, index) => ({
      id: item.id,
      text: delimiterParts[index] ?? '',
    }))
  }

  return null
}

const validateResponseItems = (
  items: SynthesizedItem[],
  lang: 'ko' | 'en',
): { passed: boolean; reasons: string[] } => {
  const reasons: string[] = []
  const minChars = lang === 'ko' ? 300 : 520
  const maxChars = lang === 'ko' ? 420 : 720
  const causeKeywords =
    lang === 'ko'
      ? ['영향', '반영', '힘입어', '지지', '부담', '촉매', '원인', '드라이버', '가이던스', '계약', '규제']
      : ['driven by', 'because', 'due to', 'support', 'pressure', 'catalyst', 'risk', 'guidance', 'contract', 'regulation']
  const riskKeywords =
    lang === 'ko'
      ? ['다만', '리스크', '주의', '관전', '주목', '향후', '다음', '변수', '점검']
      : ['however', 'risk', 'watch', 'checkpoint', 'next', 'variable', 'limited']

  if (!items.length) {
    return { passed: false, reasons: ['no_items_returned'] }
  }

  items.forEach((item, index) => {
    const text = item.text.trim()
    const chars = countNonSpaceChars(text)
    const sentences = sentenceCount(text)
    const headlineLike = sentences <= 1 || chars < minChars

    if (chars < minChars) reasons.push(`item_${index}_too_short`)
    if (chars > maxChars) reasons.push(`item_${index}_too_long`)
    if (headlineLike) reasons.push(`item_${index}_headline_like`)
    if (sentences < 3) reasons.push(`item_${index}_too_few_sentences`)
    if (!containsAny(text, causeKeywords)) reasons.push(`item_${index}_missing_cause`)
    if (!containsAny(text, riskKeywords)) reasons.push(`item_${index}_missing_risk`)
  })

  return { passed: reasons.length === 0, reasons }
}

const validateResponseItem = (
  text: string,
  lang: 'ko' | 'en',
): { passed: boolean; reasons: string[] } => {
  return validateResponseItems([{ id: 'item', text }], lang)
}

const buildRetryPrompt = (
  originalPrompt: string,
  validationReasons: string[],
  lang: 'ko' | 'en',
): string => {
  const reasons = validationReasons.join(', ')

  if (lang === 'ko') {
    return [
      '이전 출력은 Terminal X 스타일 기준을 충족하지 못했다.',
      `실패 사유: ${reasons}`,
      '',
      '다시 작성하라.',
      '',
      '조건:',
      '- 한국어',
      '- JSON만 반환',
      '- 3~5문장',
      '- 헤드라인처럼 짧게 쓰지 말 것',
      '- 원인, 보조 요인, 리스크 또는 관전 포인트를 모두 포함할 것',
      '- 설명형 문장으로 작성할 것',
      '',
      '기존 의도는 유지하되, 더 설명적이고 Terminal X 수준의 길이로 다시 써라.',
      '',
      originalPrompt,
    ].join('\n')
  }

  return [
    'The previous output failed the Terminal X-style quality check.',
    `Failure reasons: ${reasons}`,
    '',
    'Rewrite the entire batch.',
    '',
    'Requirements:',
    '- English only',
    '- JSON only',
    '- 3 to 5 sentences per item',
    '- Korean outputs should target 300 to 400 characters excluding spaces.',
    '- English outputs should target around 600 characters excluding spaces.',
    '- Do not write headline fragments',
    '- Avoid news bullet lists',
    '- Include a main catalyst, secondary factor, and a risk or forward checkpoint',
    '- Use market context only for interpretation, not repetition',
    '',
    'Keep the original intent, but make the output more explanatory and Terminal X-level in length.',
    '',
    originalPrompt,
  ].join('\n')
}

const buildFallbackText = (
  item: NewsInputItem,
  lang: 'ko' | 'en',
  sessionHint: 'morning' | 'afternoon',
): string => {
  const headline = compactEventLabel(item.summary || item.headline || (lang === 'ko' ? '?대떦 ?댁뒪' : 'This item'))
  const summary = item.summary.trim()

  if (lang === 'ko') {
    const lead =
      sessionHint === 'morning'
        ? `${headline}????珥덈컲 ?먮쫫?먯꽌 ?댁꽍???꾩슂媛 ?덈떎.`
        : `${headline}????留덇컧 ?댄썑 ?댁꽍???꾩슂媛 ?덈떎.`
    const body = summary
      ? `${summary} ?쒕졆???좉퇋 ?щ즺???쒗븳?곸씠硫? 愿???쒖옣 ?먮쫫怨??섍툒 蹂?붽? 異붽? ?댁꽍??湲곗????쒕떎.`
      : '?쒕졆???좉퇋 ?щ즺???쒗븳?곸씠硫? 愿???쒖옣 ?먮쫫怨??섍툒 蹂?붽? 異붽? ?댁꽍??湲곗????쒕떎.'
    const watch =
      sessionHint === 'morning'
        ? '?쒖옣? ?대궇 異붽? ?댁뒪? 珥덈컲 ?섍툒 諛섏쓳??二쇱떆?섍퀬 ?덈떎.'
        : '?쒖옣? ?ㅼ쓬 嫄곕옒??異붽? ?댁뒪? ?낆쥌 ?먮쫫???뺤씤???꾨쭩?대떎.'
    return `${lead} ${body} ${watch}`
  }

  const lead =
    sessionHint === 'morning'
      ? `${headline} should be read against the early-session tape.`
      : `${headline} should be read against the closing tape.`
  const body = summary
    ? `${summary} Fresh material appears limited, so the broader market tone and positioning remain the key context.`
    : 'Fresh material appears limited, so the broader market tone and positioning remain the key context.'
  const watch =
    sessionHint === 'morning'
      ? 'The market will watch for follow-through in the session ahead.'
      : 'The next session will likely confirm whether the move has follow-through.'
  return `${lead} ${body} ${watch}`
}

async function synthesizeDigest(
  symbol: string,
  batch: NewsInputItem[],
  lang: 'ko' | 'en',
  marketContext: string | undefined,
  companyName: string | undefined,
  price?: number | null,
  changePct?: number | null,
  dateET?: string,
  session?: NewsSynthSession,
): Promise<DigestResult | null> {
  const selectedBatch = selectRelevantItems(batch, symbol, companyName)
  if (selectedBatch.length < 1) {
    return null
  }

  const digestDateET = dateET?.trim() || getCurrentEtDate()
  const clusters = clusterNewsItems(
    symbol,
    digestDateET,
    selectedBatch.map((item) => ({
      id: item.id,
      timeET: item.timeET,
      headline: item.headline,
      summary: item.summary || item.headline,
    })),
  ).clusters

  const thesis = buildSessionThesis(symbol, changePct ?? null, clusters)
  const sessionHint = session === 'morning' || session === 'afternoon' ? session : 'auto'
  const marketTape = await readCacheJsonOrNull<{ items?: MarketTapeItem[] | null }>('market_tape.json')
  const timeline = buildTimelineFlow({
    symbol,
    items: selectedBatch.map((item) => ({
      id: item.id,
      timeET: item.timeET,
      headline: item.headline,
      summary: item.summary || item.headline,
    })),
    clusters,
    priceChangePct: changePct ?? null,
    session: sessionHint,
  })
  const relativeView = buildRelativeView({
    symbol,
    companyName,
    priceChangePct: changePct ?? null,
    marketTapeItems: marketTape?.items ?? [],
    clusters,
  })
  const confidence = buildConfidenceProfile({
    symbol,
    priceChangePct: changePct ?? null,
    clusters,
    timeline,
    relativeView,
    rawCount: batch.length,
    selectedCount: selectedBatch.length,
  })
  const priceAnchor = buildPriceAnchorLayer({
    symbol,
    price: price ?? null,
    changePct: changePct ?? null,
    timeline,
    session: sessionHint,
  })
  const spine = buildNarrativeSpine({
    symbol,
    price: price ?? null,
    changePct: changePct ?? null,
    thesis: thesis.thesis,
    clusters,
    session: sessionHint,
    timeline,
    confidence,
    relativeView,
    priceAnchor,
  })
  const renderedDraft = renderNarrativeBrief({
    priceAnchor,
    spine,
  })

  if (selectedBatch.length <= LOW_DENSITY_ITEM_THRESHOLD) {
    return { text: renderedDraft.text }
  }

  const systemPrompt = buildDigestSystemPrompt(lang)
  const baseUserPrompt = buildDigestPrompt(
    symbol,
    lang,
    marketContext,
    companyName,
    renderedDraft.text,
    JSON.stringify(spine, null, 2),
    price ?? null,
    changePct ?? null,
    digestDateET,
  )

  const providers: Array<() => Promise<string>> = [
    () => callAnthropic(systemPrompt, baseUserPrompt),
    () => callOpenAI(systemPrompt, baseUserPrompt),
  ]

  for (const [providerIndex, provider] of providers.entries()) {
    try {
      const raw = await provider()
      const parsed = parseDigestResponse(raw)
      if (!parsed) continue
      const validation = validateDigestText(parsed, lang)
      if (validation.passed) {
        return { text: parsed }
      }

      const retryPrompt = buildDigestRetryPrompt(baseUserPrompt, validation.reasons, lang)
      const retryRaw = providerIndex === 0
        ? await callAnthropic(systemPrompt, retryPrompt)
        : await callOpenAI(systemPrompt, retryPrompt)
      const retryParsed = parseDigestResponse(retryRaw)
      if (!retryParsed) continue
      const retryValidation = validateDigestText(retryParsed, lang)
      if (retryValidation.passed) {
        return { text: retryParsed }
      }
    } catch (err) {
      console.error('[news-synthesize][digest] provider failed:', err)
      continue
    }
  }

  const fallback = buildDigestFallbackText(symbol, lang, spine, renderedDraft.text, marketContext)
  return { text: fallback }
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured.')
  }

  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 3200,
      temperature: 0.35,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(55_000),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Anthropic API ${response.status}: ${errorText}`)
  }

  const data = await response.json() as {
    content?: Array<{ type?: string; text?: string }>
    model?: string
  }
  const text = data.content?.find((part) => part.type === 'text')?.text?.trim() ?? ''
  if (!text) {
    throw new Error('Anthropic empty response.')
  }
  return text
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const response = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.35,
      max_tokens: 2500,
    }),
    signal: AbortSignal.timeout(55_000),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`OpenAI API ${response.status}: ${errorText}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!text) {
    throw new Error('OpenAI empty response.')
  }
  return text
}

async function synthesizeBatch(
  symbol: string,
  batch: NewsInputItem[],
  lang: 'ko' | 'en',
  marketContext?: string,
  companyName?: string,
): Promise<SynthesizedItem[]> {
  const selectedBatch = selectRelevantItems(batch, symbol, companyName)
  if (selectedBatch.length <= LOW_DENSITY_ITEM_THRESHOLD) {
    return selectedBatch.map((item, index) => ({
      id: item.id,
      text: buildFallbackText(
        item,
        lang,
        inferSessionHint(item.timeET || (index % 2 === 0 ? '09:30' : '16:30')),
      ),
    }))
  }

  const items = buildItemBlocks(selectedBatch)
  const eventCards = buildEventCards(items, symbol, companyName)
  const narrativePlan = buildNarrativePlan(eventCards, symbol, companyName, marketContext)
  const systemPrompt = buildSystemPrompt(lang)
  const baseUserPrompt = buildUserPrompt(
    symbol,
    items,
    lang,
    marketContext,
    companyName,
    JSON.stringify(eventCards, null, 2),
    JSON.stringify(narrativePlan, null, 2),
  )

  const providers: Array<() => Promise<string>> = [
    () => callAnthropic(systemPrompt, baseUserPrompt),
    () => callOpenAI(systemPrompt, baseUserPrompt),
  ]

  let raw: string | null = null
  let parsed: SynthesizedItem[] | null = null
  let validation = { passed: false, reasons: ['uninitialized'] }
  let bestCandidate: SynthesizedItem[] | null = null

  for (const [providerIndex, provider] of providers.entries()) {
    try {
      raw = await provider()
      parsed = parseResponseItems(raw, selectedBatch)
      if (!parsed) {
        continue
      }
      bestCandidate = parsed
      validation = validateResponseItems(parsed, lang)
      if (validation.passed) {
        return parsed
      }

      const retryPrompt = buildRetryPrompt(baseUserPrompt, validation.reasons, lang)
      const retryRaw = providerIndex === 0
        ? await callAnthropic(systemPrompt, retryPrompt)
        : await callOpenAI(systemPrompt, retryPrompt)
      const retryParsed = parseResponseItems(retryRaw, selectedBatch)
      if (!retryParsed) {
        continue
      }
      bestCandidate = retryParsed
      const retryValidation = validateResponseItems(retryParsed, lang)
      if (retryValidation.passed) {
        return retryParsed
      }
      validation = retryValidation
    } catch (err) {
      console.error('[news-synthesize] provider failed:', err)
      continue
    }
  }

  if (bestCandidate?.length === selectedBatch.length) {
    return bestCandidate.map((item, index) => {
      const itemValidation = validateResponseItem(item.text, lang)
      if (itemValidation.passed) {
        return item
      }
      const sourceItem = selectedBatch[index] ?? item
      return {
        id: sourceItem.id,
        text: buildFallbackText(
          sourceItem,
          lang,
          inferSessionHint(sourceItem.timeET || (index % 2 === 0 ? '09:30' : '16:30')),
        ),
      }
    })
  }

  return selectedBatch.map((item, index) => ({
    id: item.id,
    text: buildFallbackText(item, lang, inferSessionHint(item.timeET || (index % 2 === 0 ? '09:30' : '16:30'))),
  }))
}

export async function POST(req: Request) {
  let body: SynthesizeRequest
  try {
    body = (await req.json()) as SynthesizeRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  const items = Array.isArray(body.items) ? body.items : []
  const lang = body.lang === 'en' ? 'en' : 'ko'
  const marketContext = typeof body.marketContext === 'string' ? body.marketContext.trim() : ''
  const dateET = typeof body.dateET === 'string' ? body.dateET.trim() : ''
  const session = body.session === 'morning' || body.session === 'afternoon' ? body.session : 'auto'
  const price = typeof body.price === 'number' && Number.isFinite(body.price) ? body.price : null
  const changePct = typeof body.changePct === 'number' && Number.isFinite(body.changePct) ? body.changePct : null

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol.' }, { status: 400 })
  }
  if (!items.length) {
    return NextResponse.json({ error: 'Missing items.' }, { status: 400 })
  }

  const batch = items
    .slice(0, MAX_ITEMS_PER_BATCH)
    .map((item, index) => ({
      id: String(item.id || `item-${index}`),
      timeET: String(item.timeET || (index % 2 === 0 ? '09:30' : '16:30')),
      headline: String(item.headline || '').trim(),
      summary: String(item.summary || '').trim(),
    }))
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''

  try {
    const results = await synthesizeBatch(
      symbol,
      batch,
      lang,
      marketContext || undefined,
      companyName || undefined,
    )
    const digest = await synthesizeDigest(
      symbol,
      batch,
      lang,
      marketContext || undefined,
      companyName || undefined,
      price,
      changePct,
      dateET || undefined,
      session,
    )
    return NextResponse.json({
      results,
      digest: digest?.text ?? null,
      meta: {
        inputItems: batch.length,
        selectedItems: results.length,
        digestAvailable: Boolean(digest?.text),
      },
    })
  } catch (err) {
    console.error('[news-synthesize] error:', err)
    return NextResponse.json({ error: 'Synthesis failed.' }, { status: 500 })
  }
}
