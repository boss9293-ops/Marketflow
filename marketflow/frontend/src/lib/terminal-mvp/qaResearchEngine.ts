import { randomUUID } from 'crypto'

import {
  clusterNewsEvents,
  type NewsCluster,
  type NewsClusterItem,
} from '@/lib/terminal-mvp/newsClustering'
import { ET_TIMEZONE, type ETDateString, type EvidenceRow, type QAQuestionType } from '@/lib/terminal-mvp/types'
import { fetchTickerNewsFromYahoo } from '@/lib/terminal-mvp/serverTickerNews'

type AskPipelineInput = {
  symbol: string
  dateET: ETDateString
  question: string
}

type AskPipelineResult = {
  sessionId: string
  questionType: QAQuestionType
  answerKo: string
  evidenceRows: EvidenceRow[]
  newsClusters: NewsCluster[]
  newsClusterItems: NewsClusterItem[]
}

type SessionBucket = 'premarket' | 'regular' | 'afterhours' | 'unknown'

type RankingContext = {
  symbol: string
  questionType: QAQuestionType
  questionTokens: Set<string>
  nowTs: number
  clusterImportanceById: Map<string, number>
  clusterArticleCountById: Map<string, number>
}

const KOR_OPEN = '\uac1c\uc7a5'
const KOR_CLOSE = '\ub9c8\uac10'
const KOR_WHY = '\uc774\uc720'
const KOR_MOVE = '\ubcc0\ub3d9'
const KOR_RISE = '\uae09\ub4f1'
const KOR_DROP = '\uae09\ub77d'

const TOKEN_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'what',
  'when',
  'where',
  'which',
  'how',
  'why',
  'did',
  'does',
  'is',
  'are',
  'was',
  'were',
  'to',
  'in',
  'on',
  'at',
  'of',
  'a',
  'an',
  'it',
  'as',
  'today',
  'daily',
  'summary',
  'about',
  'please',
  'tell',
  'me',
  'open',
  'close',
])

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const tokenize = (value: string): Set<string> => {
  const normalized = normalizeText(value)
  if (!normalized) return new Set<string>()
  return new Set(
    normalized
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !TOKEN_STOPWORDS.has(token)),
  )
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const parsePublishedAtTs = (publishedAtET: string): number => {
  const etMatch = publishedAtET.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}) ET$/)
  const normalized = etMatch
    ? `${etMatch[1]}T${etMatch[2]}-05:00`
    : publishedAtET
  const ts = Date.parse(normalized)
  return Number.isNaN(ts) ? Date.now() : ts
}

const parseEtMinutes = (publishedAtET: string): number | null => {
  const match = publishedAtET.match(/T(\d{2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null
  return hour * 60 + minute
}

const resolveSessionBucket = (row: EvidenceRow): SessionBucket => {
  const minutes = parseEtMinutes(row.publishedAtET)
  if (minutes == null) return 'unknown'
  if (minutes < 9 * 60 + 30) return 'premarket'
  if (minutes <= 16 * 60) return 'regular'
  return 'afterhours'
}

const includesAny = (source: string, keywords: string[]): boolean =>
  keywords.some((keyword) => source.includes(keyword))

const classifyQuestionType = (question: string): QAQuestionType => {
  const lower = question.toLowerCase()
  if (includesAny(lower, ['open', '09:30', KOR_OPEN, '\uc624\ud508'])) {
    return 'open_summary'
  }
  if (includesAny(lower, ['close', '16:00', KOR_CLOSE, '\ud074\ub85c\uc988'])) {
    return 'close_summary'
  }
  if (includesAny(lower, ['why', KOR_WHY, 'move', 'up', 'down', KOR_RISE, KOR_DROP, KOR_MOVE])) {
    return 'move_explainer'
  }
  return 'general_daily_summary'
}

const buildBriefRows = (
  sessionId: string,
  symbol: string,
  dateET: ETDateString,
): EvidenceRow[] => {
  const createdAt = new Date().toISOString()
  return [
    {
      id: randomUUID(),
      sessionId,
      symbol,
      dateET,
      sourceType: 'brief',
      sourceId: `${symbol.toLowerCase()}-brief-0930`,
      title: `${symbol} 09:30 ET Open Brief`,
      source: 'Terminal Brief Engine',
      summary: `${symbol} open session flow and premarket checkpoints.`,
      publishedAtET: `${dateET}T09:30:00 ET`,
      publishedAtTs: parsePublishedAtTs(`${dateET}T09:30:00 ET`),
      aiRelevancy: 0,
      createdAtET: createdAt,
    },
    {
      id: randomUUID(),
      sessionId,
      symbol,
      dateET,
      sourceType: 'brief',
      sourceId: `${symbol.toLowerCase()}-brief-1600`,
      title: `${symbol} 16:00 ET Close Brief`,
      source: 'Terminal Brief Engine',
      summary: `${symbol} close summary with session reaction and key events.`,
      publishedAtET: `${dateET}T16:00:00 ET`,
      publishedAtTs: parsePublishedAtTs(`${dateET}T16:00:00 ET`),
      aiRelevancy: 0,
      createdAtET: createdAt,
    },
  ]
}

const buildMarketHeadlineRows = (
  sessionId: string,
  symbol: string,
  dateET: ETDateString,
): EvidenceRow[] => {
  const createdAt = new Date().toISOString()
  const rows = [
    {
      sourceId: `market-headline-${dateET}-1`,
      title: 'Fed policy path remains data-dependent as rates volatility cools',
      source: 'Bloomberg',
      summary: 'Rates volatility cooled while policy path remained data dependent.',
      publishedAtET: `${dateET}T11:30:00 ET`,
      url: 'https://example.com/market-headline-1',
    },
    {
      sourceId: `market-headline-${dateET}-2`,
      title: 'Mega-cap leadership narrows while cyclicals stabilize intraday',
      source: 'Reuters',
      summary: 'Leadership narrowed as cyclicals stabilized through the session.',
      publishedAtET: `${dateET}T14:20:00 ET`,
      url: 'https://example.com/market-headline-2',
    },
  ]

  return rows.map((row) => ({
    id: randomUUID(),
    sessionId,
    symbol,
    dateET,
    sourceType: 'market_headline' as const,
    sourceId: row.sourceId,
    title: row.title,
    source: row.source,
    summary: row.summary,
    publishedAtET: row.publishedAtET,
    publishedAtTs: parsePublishedAtTs(row.publishedAtET),
    aiRelevancy: 0,
    url: row.url,
    createdAtET: createdAt,
  }))
}

const buildClusterRows = (
  sessionId: string,
  symbol: string,
  dateET: ETDateString,
  clusters: NewsCluster[],
): EvidenceRow[] =>
  clusters.map((cluster) => {
    const relatedSuffix =
      cluster.relatedArticleCount > 1
        ? ` [Clustered ${cluster.relatedArticleCount} related articles]`
        : ''
    return {
      id: randomUUID(),
      sessionId,
      symbol,
      dateET,
      sourceType: 'news_cluster' as const,
      sourceId: cluster.clusterId,
      title: cluster.representativeTitle,
      source: cluster.representativeSource,
      summary: `${cluster.representativeSummary}${relatedSuffix}`,
      publishedAtET: cluster.representativePublishedAtET,
      publishedAtTs: parsePublishedAtTs(cluster.representativePublishedAtET),
      aiRelevancy: 0,
      url: cluster.representativeUrl,
      createdAtET: cluster.createdAtET,
    }
  })

const sessionPreference = (row: EvidenceRow, questionType: QAQuestionType): number => {
  const bucket = resolveSessionBucket(row)
  const minutes = parseEtMinutes(row.publishedAtET)
  const isOpenBrief = row.sourceType === 'brief' && row.sourceId.endsWith('0930')
  const isCloseBrief = row.sourceType === 'brief' && row.sourceId.endsWith('1600')

  if (questionType === 'open_summary') {
    if (isOpenBrief) return 1
    if (bucket === 'premarket') return 0.95
    if (bucket === 'regular' && minutes != null && minutes <= 11 * 60 + 30) return 0.82
    if (bucket === 'regular') return 0.42
    if (bucket === 'afterhours') return 0.2
    return 0.35
  }

  if (questionType === 'close_summary') {
    if (isCloseBrief) return 1
    if (bucket === 'regular' && minutes != null && minutes >= 15 * 60) return 0.95
    if (bucket === 'regular') return 0.82
    if (bucket === 'afterhours') return 0.78
    if (bucket === 'premarket') return 0.25
    return 0.4
  }

  if (questionType === 'move_explainer') {
    if (bucket === 'regular') return 0.88
    if (bucket === 'premarket') return 0.7
    if (bucket === 'afterhours') return 0.76
    return 0.5
  }

  if (bucket === 'regular') return 0.86
  if (bucket === 'premarket') return 0.68
  if (bucket === 'afterhours') return 0.66
  return 0.5
}

const sourceIntentPreference = (row: EvidenceRow, questionType: QAQuestionType): number => {
  const isOpenBrief = row.sourceType === 'brief' && row.sourceId.endsWith('0930')
  const isCloseBrief = row.sourceType === 'brief' && row.sourceId.endsWith('1600')

  if (questionType === 'move_explainer') {
    if (row.sourceType === 'news_cluster') return 0.98
    if (row.sourceType === 'ticker_news') return 0.9
    if (row.sourceType === 'market_headline') return 0.68
    if (row.sourceType === 'brief') return 0.56
    return 0.55
  }

  if (questionType === 'open_summary') {
    if (isOpenBrief) return 1
    if (row.sourceType === 'news_cluster') return 0.84
    if (row.sourceType === 'ticker_news') return 0.78
    if (row.sourceType === 'market_headline') return 0.62
    if (isCloseBrief) return 0.24
    return 0.5
  }

  if (questionType === 'close_summary') {
    if (isCloseBrief) return 1
    if (row.sourceType === 'news_cluster') return 0.9
    if (row.sourceType === 'ticker_news') return 0.82
    if (row.sourceType === 'market_headline') return 0.72
    if (isOpenBrief) return 0.24
    return 0.55
  }

  if (row.sourceType === 'news_cluster') return 0.9
  if (row.sourceType === 'market_headline') return 0.84
  if (row.sourceType === 'ticker_news') return 0.82
  if (row.sourceType === 'brief') return 0.78
  return 0.7
}

const computeKeywordMatch = (questionTokens: Set<string>, row: EvidenceRow): number => {
  if (!questionTokens.size) return 0.5
  const rowTokens = tokenize(`${row.title} ${row.summary} ${row.source}`)
  if (!rowTokens.size) return 0.3

  let overlap = 0
  for (const token of questionTokens) {
    if (rowTokens.has(token)) overlap += 1
  }
  const ratio = overlap / Math.max(1, Math.min(questionTokens.size, 8))
  return clamp(ratio, 0, 1)
}

const computeSymbolMatch = (row: EvidenceRow, symbol: string): number => {
  const normalized = `${row.title} ${row.summary} ${row.source}`.toUpperCase()
  let score = row.symbol.toUpperCase() === symbol.toUpperCase() ? 0.7 : 0
  if (normalized.includes(symbol.toUpperCase())) score += 0.3
  return clamp(score, 0, 1)
}

const resolveSourceTrustScore = (row: EvidenceRow): number => {
  const source = row.source.toLowerCase()
  const text = `${row.source} ${row.title} ${row.summary} ${row.url ?? ''}`.toLowerCase()

  if (/\bsec\b|edgar|10-k|10-q|8-k|form 4|official filing/.test(text)) return 1
  if (/reuters|bloomberg|wall street journal|wsj|financial times|ft|associated press|ap news/.test(source)) return 0.92
  if (/cnbc|marketwatch|yahoo finance|nasdaq/.test(source)) return 0.82
  if (/press release|pr newswire|business wire|accesswire/.test(text)) return 0.72
  if (source.includes('terminal brief engine')) return 0.8
  return 0.66
}

const computeRecencyScore = (row: EvidenceRow, nowTs: number): number => {
  const ageHours = Math.max(0, (nowTs - row.publishedAtTs) / (1000 * 60 * 60))
  return clamp(1 - ageHours / 48, 0, 1)
}

const computeClusterScore = (
  row: EvidenceRow,
  clusterImportanceById: Map<string, number>,
  clusterArticleCountById: Map<string, number>,
): number => {
  if (row.sourceType !== 'news_cluster') return 0.45
  const importance = clamp(clusterImportanceById.get(row.sourceId) ?? 0.5, 0, 1)
  const relatedCount = clusterArticleCountById.get(row.sourceId) ?? 1
  const representativeBoost = clamp((relatedCount - 1) / 6, 0, 0.28)
  return clamp(importance + representativeBoost, 0, 1)
}

const fallbackRelevanceScore = (
  row: EvidenceRow,
  context: RankingContext,
): number => {
  const recency = computeRecencyScore(row, context.nowTs)
  const cluster = computeClusterScore(
    row,
    context.clusterImportanceById,
    context.clusterArticleCountById,
  )
  const sourceTrust = resolveSourceTrustScore(row)
  const score = 0.18 + recency * 0.42 + cluster * 0.3 + sourceTrust * 0.1
  return Number(clamp(score, 0.05, 0.99).toFixed(3))
}

const scoreEvidenceRowAdvanced = (row: EvidenceRow, context: RankingContext): number => {
  try {
    const intent = sourceIntentPreference(row, context.questionType)
    const session = sessionPreference(row, context.questionType)
    const keyword = computeKeywordMatch(context.questionTokens, row)
    const sourceTrust = resolveSourceTrustScore(row)
    const cluster = computeClusterScore(
      row,
      context.clusterImportanceById,
      context.clusterArticleCountById,
    )
    const recency = computeRecencyScore(row, context.nowTs)
    const symbol = computeSymbolMatch(row, context.symbol)

    const weighted =
      intent * 0.24 +
      session * 0.18 +
      keyword * 0.15 +
      sourceTrust * 0.13 +
      cluster * 0.13 +
      recency * 0.09 +
      symbol * 0.08

    const raw = 0.05 + weighted
    if (!Number.isFinite(raw)) {
      throw new Error('Advanced score produced non-finite value.')
    }
    return Number(clamp(raw, 0.05, 0.99).toFixed(3))
  } catch {
    return fallbackRelevanceScore(row, context)
  }
}

const sortRowsForSourceTable = (rows: EvidenceRow[]): EvidenceRow[] =>
  [...rows].sort(
    (a, b) =>
      b.aiRelevancy - a.aiRelevancy ||
      b.publishedAtTs - a.publishedAtTs ||
      a.source.localeCompare(b.source),
  )

const buildAnswerKo = (
  symbol: string,
  dateET: ETDateString,
  questionType: QAQuestionType,
  question: string,
  rankedRows: EvidenceRow[],
  clusters: NewsCluster[],
): string => {
  const top = rankedRows.slice(0, 4)

  const typeLabel: Record<QAQuestionType, string> = {
    move_explainer: '\ubcc0\ub3d9 \uc6d0\uc778 \uc124\uba85',
    open_summary: '\uac1c\uc7a5 \uc694\uc57d(09:30 ET)',
    close_summary: '\ub9c8\uac10 \uc694\uc57d(16:00 ET)',
    general_daily_summary: '\uc77c\ubc18 \ub370\uc77c\ub9ac \uc694\uc57d',
  }

  const evidenceLine = top
    .map(
      (row, index) =>
        `${index + 1}) ${row.publishedAtET} | ${row.source} | ${row.title} | score ${row.aiRelevancy.toFixed(3)}`,
    )
    .join(' / ')

  const clusterLine =
    clusters.length > 0
      ? `\uc911\ubcf5 \uae30\uc0ac\ub97c \ud1b5\ud569\ud574 ${clusters.length}\uac1c \uc774\ubca4\ud2b8 \ud074\ub7ec\uc2a4\ud130\ub85c \uadfc\uac70\ub97c \uad6c\uc131\ud588\uc2b5\ub2c8\ub2e4.`
      : '\ud074\ub7ec\uc2a4\ud130\ub9c1 \ub300\uc0c1 \uae30\uc0ac\uac00 \ucda9\ubd84\ud558\uc9c0 \uc54a\uc544 \ube0c\ub9ac\ud504/\ub9c8\ucf13 \ud5e4\ub4dc\ub77c\uc778 \uc911\uc2ec\uc73c\ub85c \ub2f5\ubcc0\ud588\uc2b5\ub2c8\ub2e4.'

  return [
    `${symbol} ${dateET} \ub9ac\uc11c\uce58 \uc138\uc158\uc774 \uc0dd\uc131\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc9c8\ubb38 \uc720\ud615\uc740 "${typeLabel[questionType]}" \uc785\ub2c8\ub2e4.`,
    `\uc9c8\ubb38: "${question}"`,
    clusterLine,
    `\uc0c1\uc704 \uadfc\uac70: ${evidenceLine}`,
    '\ub2f5\ubcc0\uc740 Source Table\uc758 \uc0c1\uc704 \ub7ad\ud0b9 \uadfc\uac70\ub97c \ub3d9\uc77c \ub85c\uc9c1\uc73c\ub85c \uc0ac\uc6a9\ud574 \uc0dd\uc131\ub418\uc5c8\uc2b5\ub2c8\ub2e4.',
  ].join(' ')
}

export async function runAskResearchPipeline(
  input: AskPipelineInput,
): Promise<AskPipelineResult> {
  const symbol = input.symbol.trim().toUpperCase()
  const questionType = classifyQuestionType(input.question)
  const sessionId = randomUUID()
  const nowTs = Date.now()

  const briefRows = buildBriefRows(sessionId, symbol, input.dateET)
  const marketRows = buildMarketHeadlineRows(sessionId, symbol, input.dateET)

  const tickerNewsPayload = await fetchTickerNewsFromYahoo(symbol, input.dateET).catch(
    () => ({ timeline: [], details: [] }),
  )

  const clustering = clusterNewsEvents(symbol, input.dateET, tickerNewsPayload.details)
  const clusterRows = buildClusterRows(sessionId, symbol, input.dateET, clustering.clusters)
  const allRows = [...briefRows, ...clusterRows, ...marketRows]

  const context: RankingContext = {
    symbol,
    questionType,
    questionTokens: tokenize(input.question),
    nowTs,
    clusterImportanceById: new Map(
      clustering.clusters.map((cluster) => [cluster.clusterId, cluster.importanceScore]),
    ),
    clusterArticleCountById: new Map(
      clustering.clusters.map((cluster) => [cluster.clusterId, cluster.relatedArticleCount]),
    ),
  }

  const scoredRows = allRows.map((row) => ({
    ...row,
    aiRelevancy: scoreEvidenceRowAdvanced(row, context),
  }))

  const rankedRows = sortRowsForSourceTable(scoredRows)
  const answerKo = buildAnswerKo(
    symbol,
    input.dateET,
    questionType,
    input.question,
    rankedRows,
    clustering.clusters,
  )

  return {
    sessionId,
    questionType,
    answerKo,
    evidenceRows: rankedRows,
    newsClusters: clustering.clusters,
    newsClusterItems: clustering.clusterItems,
  }
}

export const QA_ET_TIMEZONE = ET_TIMEZONE

