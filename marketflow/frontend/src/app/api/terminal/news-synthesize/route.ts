import { NextResponse } from 'next/server'
import { truncateText } from '@/lib/text/vrTone'

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
    .replace(/[^a-z0-9가-힣\s]/gu, ' ')
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
    .replace(/[^a-z0-9가-힣\s]/gu, ' ')
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
  return truncateText(firstSentence.replace(/[。！？]+$/u, '').trim(), 140)
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

const buildDigestSystemPrompt = (lang: 'ko' | 'en'): string =>
  lang === 'ko'
    ? [
        'You are an institutional financial terminal editor writing Korean outputs.',
        'Combine the batch into one company/day digest note with Terminal X-like density.',
        'Do not write item-by-item notes.',
        'Use EVENT CARDS and NARRATIVE PLAN as the primary truth source; raw items are supporting evidence only.',
        'Start with price, time, and change, then the main catalyst, secondary factors, counterweight or risk, and one forward checkpoint.',
        'Write 4 to 6 sentences. Korean outputs should target 420 to 700 non-space characters.',
        'Return JSON only in this exact shape: {"text":"..."}',
      ].join('\n')
    : [
        'You are an institutional financial terminal editor.',
        'Combine the batch into one company/day digest note with Terminal X-like density.',
        'Do not write item-by-item notes.',
        'Use EVENT CARDS and NARRATIVE PLAN as the primary truth source; raw items are supporting evidence only.',
        'Start with price and time, then the main catalyst, secondary factors, counterweight or risk, and one forward checkpoint.',
        'Write 4 to 6 sentences. English outputs should target around 900 non-space characters.',
        'Return JSON only in this exact shape: {"text":"..."}',
      ].join('\n')

const buildDigestPrompt = (
  symbol: string,
  items: ItemBlock[],
  lang: 'ko' | 'en',
  marketContext?: string,
  companyName?: string,
  eventCardsJson?: string,
  narrativePlanJson?: string,
): string => {
  const marketContextBlock = marketContext?.trim() ? marketContext.trim() : 'N/A'
  const companyNameBlock = companyName?.trim() ? companyName.trim() : 'N/A'
  const eventCardsBlock = eventCardsJson?.trim() || '[]'
  const narrativePlanBlock = narrativePlanJson?.trim() || '{}'
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

  return [
    `Symbol: ${symbol}`,
    `Company name: ${companyNameBlock}`,
    `Market context: ${marketContextBlock}`,
    '',
    'Write one digest note for the whole batch, not separate item notes.',
    'Use the narrative plan as the spine and the raw items as supporting evidence.',
    'Primary sources are EVENT CARDS and NARRATIVE PLAN; raw items are supporting evidence only.',
    'The output should read like a Terminal X daily note: explanation-first, not headline-first.',
    'Include one main catalyst, one or two secondary factors, a counterweight or risk, and a forward checkpoint.',
    'Do not repeat the headlines verbatim.',
    'Return JSON only: {"text":"..."}',
    '',
    'EVENT CARDS (Layer 1-2, scored evidence pack):',
    eventCardsBlock,
    '',
    'NARRATIVE PLAN (Layer 3-4, storyline spine):',
    narrativePlanBlock,
    '',
    'RAW ITEMS (supporting evidence):',
    itemText,
  ].join('\n')
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
  const sentences = sentenceCount(text)
  const minChars = lang === 'ko' ? 340 : 560
  const maxChars = lang === 'ko' ? 1100 : 1300
  const priceKeywords = lang === 'ko'
    ? ['가격', '등락', '상승', '하락', '시각', '장중', '마감', '%', '원']
    : ['price', 'time', 'trading', 'closed', 'opened', '$', 'up', 'down', 'session']
  const causeKeywords = lang === 'ko'
    ? ['영향', '반영', '힘입어', '지지', '압박', '촉매', '원인', '재료', '실적', '가이던스', '목표가', '공급', '계약', '규제']
    : ['driven by', 'because', 'due to', 'catalyst', 'support', 'pressure', 'backed by', 'anchor']
  const riskKeywords = lang === 'ko'
    ? ['다만', '리스크', '변수', '주목', '주시', '향후', '관전 포인트', '다음', '이벤트']
    : ['however', 'risk', 'watch', 'checkpoint', 'next', 'variable', 'caution']

  if (chars < minChars) reasons.push('too_short')
  if (chars > maxChars) reasons.push('too_long')
  if (sentences < 4) reasons.push('too_few_sentences')
  if (sentences > 6) reasons.push('too_many_sentences')

  const firstSentence = text
    .split(/[.!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean)[0] || ''
  if (!containsAny(firstSentence, priceKeywords)) {
    reasons.push('missing_price_context')
  }
  if (!containsAny(text, causeKeywords)) {
    reasons.push('missing_cause')
  }
  if (!containsAny(text, riskKeywords)) {
    reasons.push('missing_risk')
  }
  if (sentences <= 1) {
    reasons.push('headline_like')
  }

  return { passed: reasons.length === 0, reasons }
}

const buildDigestFallbackText = (
  symbol: string,
  lang: 'ko' | 'en',
  narrativePlan: ReturnType<typeof buildNarrativePlan>,
  marketContext?: string,
): string => {
  const leadContext = marketContext?.trim()
    ? marketContext.trim().replace(/\s*\|\s*/g, ' · ')
    : narrativePlan.price_context
        .replace(/^Market context:\s*/i, '')
        .replace(/^Ticker context:\s*/i, '')
        .trim()
  const priceContext = narrativePlan.price_context
    .replace(/^Market context:\s*/i, '')
    .replace(/^Ticker context:\s*/i, '')
    .trim()
  const primaryWhy = narrativePlan.primary_driver.why || 'the main catalyst'
  const secondaryWhy = narrativePlan.secondary_driver.why || 'broader support'
  const counterWhy = narrativePlan.counterweight.why || 'risk to the move'
  const watchWhy = narrativePlan.watchpoint.why || 'confirmation of the thesis'
  const translateImpactHint = (hint: string): string => {
    if (lang !== 'ko') {
      return hint
    }
    const normalized = hint.toLowerCase().trim()
    const mapping: Array<[string, string]> = [
      ['valuation / expectations', '밸류에이션 기대'],
      ['earnings / margin', '실적과 마진 모멘텀'],
      ['demand / supply', '수요와 공급 균형'],
      ['macro / rates', '매크로와 금리 환경'],
      ['geo / policy', '지정학과 정책 변수'],
      ['product cycle', '제품 사이클'],
      ['risk / legal', '리스크와 법적 이슈'],
      ['technical setup', '기술적 수급'],
      ['sector rotation', '섹터 로테이션'],
      ['broad market read-through', '시장 전반의 해석'],
      ['confirmation of growth thesis', '성장 논리 확인'],
      ['confirmation of the thesis', '논리 확인'],
      ['risk to the move', '상승 여력에 대한 부담'],
      ['broader support', '추가 지지'],
      ['the main catalyst', '핵심 촉매'],
    ]
    const found = mapping.find(([key]) => normalized.includes(key))
    return found ? found[1] : hint
  }
  const primaryLabel = translateImpactHint(primaryWhy)
  const secondaryLabel = translateImpactHint(secondaryWhy)
  const counterLabel = translateImpactHint(counterWhy)
  const watchLabel = translateImpactHint(watchWhy)
  const resolvedSecondaryLabel = secondaryLabel === primaryLabel ? (lang === 'ko' ? '추가 지지' : 'secondary support') : secondaryLabel
  const resolvedCounterLabel = counterLabel === primaryLabel || counterLabel === secondaryLabel
    ? (lang === 'ko' ? '상단 제한 요인' : 'counterweight')
    : counterLabel
  const resolvedWatchLabel = watchLabel === primaryLabel || watchLabel === secondaryLabel || watchLabel === counterLabel
    ? (lang === 'ko' ? '다음 거래일 확인 포인트' : 'next checkpoint')
    : watchLabel

  if (lang === 'ko') {
    return `${symbol}는 ${leadContext || priceContext || '현재 흐름'} 속에서 ${primaryLabel}${particle(primaryLabel, '이', '가')} 장세를 이끌고 있다. ${resolvedSecondaryLabel}${particle(resolvedSecondaryLabel, '이', '가')} 보조 재료로 붙으며 투자심리를 지지했고, ${resolvedCounterLabel}${particle(resolvedCounterLabel, '이', '가')} 남아 있다. 다만 다음 거래일에는 추가 뉴스와 업종 흐름을 확인해야 한다.`
  }

  return `${symbol} traded against ${leadContext || priceContext || 'the current tape'} with ${primaryLabel} as the main catalyst driving the session narrative. ${resolvedSecondaryLabel} added a secondary layer of support, while ${resolvedCounterLabel} remained the counterweight that kept the move from becoming one-way. The next checkpoint is ${resolvedWatchLabel}, where the market will test whether ${watchWhy} still holds.`
}

async function synthesizeDigest(
  symbol: string,
  batch: NewsInputItem[],
  lang: 'ko' | 'en',
  marketContext: string | undefined,
  companyName: string | undefined,
): Promise<DigestResult | null> {
  const selectedBatch = selectRelevantItems(batch, symbol, companyName)
  if (selectedBatch.length < 2) {
    return null
  }

  const items = buildItemBlocks(selectedBatch)
  const eventCards = buildEventCards(items, symbol, companyName)
  const narrativePlan = buildNarrativePlan(eventCards, symbol, companyName, marketContext)
  const systemPrompt = buildDigestSystemPrompt(lang)
  const baseUserPrompt = buildDigestPrompt(
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

  let best: string | null = null
  let validation = { passed: false, reasons: ['uninitialized'] }

  for (const [providerIndex, provider] of providers.entries()) {
    try {
      const raw = await provider()
      const parsed = parseDigestResponse(raw)
      if (!parsed) continue
      best = parsed
      validation = validateDigestText(parsed, lang)
      if (validation.passed) {
        return { text: parsed }
      }

      const retryPrompt = buildRetryPrompt(baseUserPrompt, validation.reasons, lang)
      const retryRaw = providerIndex === 0
        ? await callAnthropic(systemPrompt, retryPrompt)
        : await callOpenAI(systemPrompt, retryPrompt)
      const retryParsed = parseDigestResponse(retryRaw)
      if (!retryParsed) continue
      best = retryParsed
      const retryValidation = validateDigestText(retryParsed, lang)
      if (retryValidation.passed) {
        return { text: retryParsed }
      }
      validation = retryValidation
    } catch (err) {
      console.error('[news-synthesize][digest] provider failed:', err)
      continue
    }
  }

  const fallback = buildDigestFallbackText(symbol, lang, narrativePlan, marketContext)
  return { text: fallback }
}

const buildSystemPrompt = (lang: 'ko' | 'en'): string =>
  lang === 'ko'
    ? [
        '당신은 기관투자자용 금융 터미널 브리핑 에디터다.',
        '목표는 개별 뉴스 항목을 Terminal X 스타일의 설명형 시장 메모로 바꾸는 것이다.',
        '뉴스 제목을 복사하지 말고, headline과 summary를 바탕으로 왜 이 뉴스가 종목 흐름에 중요한지 설명하라.',
        '각 항목은 3~4문장으로 작성하고, 한 줄 헤드라인처럼 짧게 쓰지 말라.',
        '핵심 원인 1개, 보조 요인 1~2개, 가능하면 반대 요인 또는 리스크 1개, 마지막에는 관전 포인트 1개를 자연스럽게 포함하라.',
        'marketContext가 주어지면 가격 상황을 반복하지 말고 뉴스의 의미를 설명하는 데만 활용하라.',
        '아침 성격이면 장중/프리마켓 해석에, 오후 성격이면 장 마감/세션 반응에 더 무게를 둬라.',
        '과장 표현, 선정적 표현, 근거 없는 추측은 금지한다.',
        '정보가 약하면 "뚜렷한 신규 재료는 제한적"에 준하는 표현으로 정리하되, 문단이 빈약해지지 않게 한다.',
        '반드시 한국어로만 답하고 JSON만 반환하라.',
        '응답 형식은 {"items":[{"id":"...","text":"..."}]} 여야 한다.',
      ].join('\n')
    : [
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
      `종목: ${symbol}`,
      `회사명: ${companyNameBlock}`,
      `시장 맥락: ${marketContextBlock}`,
      '',
      '아래 뉴스 항목들을 각 항목별로 Terminal X 스타일의 짧지만 밀도 높은 설명형 메모로 바꿔라.',
      layerHint,
      '이 batch는 같은 종목을 둘러싼 연구 패키지이므로, 비슷한 촉매는 서로 엮어서 하나의 스토리로 정리해도 된다.',
      '각 항목은 3~4문장으로 쓰고, 뉴스 제목을 그대로 복사하지 말고, 핵심 촉매와 보조 요인, 리스크 또는 관전 포인트를 자연스럽게 엮어라.',
      '시장 맥락이 있더라도 가격을 반복하지 말고, 그 뉴스가 현재 종목 흐름에 어떤 의미인지 설명하는 데만 활용하라.',
      '아침 성격(session_hint=morning)이면 프리마켓/초반 세션 해석을, 오후 성격(session_hint=afternoon)이면 장중 반응과 다음 체크포인트를 더 분명히 드러내라.',
      '출력은 JSON만 허용하며, 반드시 입력 순서를 유지하고 각 id를 그대로 써라.',
      '형식: {"items":[{"id":"...","text":"..."}]}',
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
  const causeKeywords = lang === 'ko'
    ? ['영향', '반영', '힘입어', '지지', '부담', '촉매', '실적', '가이던스', '공급망', '계약', '규제']
    : ['driven by', 'because', 'due to', 'support', 'pressure', 'catalyst', 'risk', 'guidance', 'contract', 'regulation']
  const riskKeywords = lang === 'ko'
    ? ['다만', '리스크', '주시', '관전', '포인트', '향후', '변수', '제한']
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
      '이전 출력은 터미널 스타일 기준을 충족하지 못했다.',
      `실패 사유: ${reasons}`,
      '',
      '다시 작성하라.',
      '',
      '조건:',
      '- 한국어',
      '- JSON만 반환',
      '- 각 항목은 3~4문장',
      '- 헤드라인처럼 짧게 쓰지 말 것',
      '- 뉴스 나열 금지',
      '- 핵심 원인, 보조 요인, 리스크 또는 관전 포인트를 모두 포함할 것',
      '- 시장 맥락이 있으면 가격을 반복하지 말고 의미만 설명할 것',
      '',
      '원본 지시를 유지하되, 설명형 문단으로 다시 써라.',
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
  const headline = compactEventLabel(item.summary || item.headline || (lang === 'ko' ? '해당 뉴스' : 'This item'))
  const summary = item.summary.trim()

  if (lang === 'ko') {
    const lead =
      sessionHint === 'morning'
        ? `${headline}는 장 초반 흐름에서 해석할 필요가 있다.`
        : `${headline}는 장 마감 이후 해석할 필요가 있다.`
    const body = summary
      ? `${summary} 뚜렷한 신규 재료는 제한적이며, 관련 시장 흐름과 수급 변화가 추가 해석의 기준이 된다.`
      : '뚜렷한 신규 재료는 제한적이며, 관련 시장 흐름과 수급 변화가 추가 해석의 기준이 된다.'
    const watch =
      sessionHint === 'morning'
        ? '시장은 이날 추가 뉴스와 초반 수급 반응을 주시하고 있다.'
        : '시장은 다음 거래일 추가 뉴스와 업종 흐름을 확인할 전망이다.'
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
