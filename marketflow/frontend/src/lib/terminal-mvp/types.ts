export const ET_TIMEZONE = 'America/New_York' as const

export type ETTimezone = typeof ET_TIMEZONE
export type ETDateString = string
export type ISODateTimeString = string

export type ApiEnvelope<TData> = {
  data: TData
  meta: {
    timezone: ETTimezone
    dateET?: ETDateString
  }
}

export type Watchlist = {
  id: string
  name: string
  isDefault: boolean
  createdAtET: ISODateTimeString
  updatedAtET: ISODateTimeString
}

export type WatchlistItem = {
  id: string
  watchlistId: string
  symbol: string
  companyName: string
  lastPrice: string
  changePercent: string
  rangeLabel: string
}

export type TickerBriefCheckpoint = '09:30' | '16:00'

export type TickerBrief = {
  id: string
  symbol: string
  dateET: ETDateString
  checkpointET: TickerBriefCheckpoint
  headline: string
  source: string
  summary: string
}

export type TickerNewsItem = {
  id: string
  symbol: string
  dateET: ETDateString
  publishedAtET: ISODateTimeString
  timeET: string
  headline: string
  source: string
  summary: string
  url: string
}

export type MarketHeadline = {
  id: string
  dateET: ETDateString
  publishedAtET: ISODateTimeString
  timeET: string
  headline: string
  source: string
  summary: string
  url: string
}

export type NewsDetail = {
  id: string
  symbol?: string
  dateET: ETDateString
  publishedAtET: ISODateTimeString
  headline: string
  source: string
  summary: string
  url?: string
  tags?: string[]
  relevanceScore?: number
}

export type NewsClickLogRequest = {
  actorId: string
  actorType: 'user'
  contextSymbol?: string
  clickedAtET: ISODateTimeString
}

export type NewsClickLogResponse = {
  logId: string
  logged: true
}

export type SheetExportRequest = {
  sheetName: string
  requestedBy: string
  requestedAtET: ISODateTimeString
}

export type SheetExportResponse = {
  exportJobId: string
  queued: true
}

export type AskQuestionRequest = {
  symbol: string
  question: string
  dateET: ETDateString
  timezone: ETTimezone
}

export type QAQuestionType =
  | 'move_explainer'
  | 'open_summary'
  | 'close_summary'
  | 'general_daily_summary'

export type AskQuestionResponse = {
  sessionId: string
  symbol: string
  dateET: ETDateString
  question: string
  questionType: QAQuestionType
  answerKo: string
}

export type EvidenceSourceType = 'brief' | 'ticker_news' | 'market_headline' | 'news_cluster'

export type EvidenceRow = {
  id: string
  sessionId: string
  symbol: string
  dateET: ETDateString
  sourceType: EvidenceSourceType
  sourceId: string
  title: string
  source: string
  summary: string
  publishedAtET: ISODateTimeString
  publishedAtTs: number
  aiRelevancy: number
  url?: string
  createdAtET: ISODateTimeString
}

export type NewsClusterRecord = {
  clusterId: string
  sessionId: string
  symbol: string
  dateET: ETDateString
  representativeNewsId: string
  representativeTitle: string
  representativeSource: string
  representativeSummary: string
  representativePublishedAtET: ISODateTimeString
  representativeUrl?: string
  relatedArticleCount: number
  importanceScore: number
  eventTags: string[]
  createdAtET: ISODateTimeString
}

export type NewsClusterItemRecord = {
  clusterItemId: string
  clusterId: string
  sessionId: string
  newsId: string
  headline: string
  source: string
  publishedAtET: ISODateTimeString
  url?: string
  canonicalUrl: string
  normalizedTitle: string
  tags: string[]
  isRepresentative: boolean
  duplicateCount: number
  createdAtET: ISODateTimeString
}

export type EvidenceSheetExportRequest = {
  sessionId: string
  sheetName: string
  requestedBy: string
  requestedAtET: ISODateTimeString
}

export type EvidenceSheetExportResponse = {
  exportJobId: string
  status: 'queued'
  queued: true
  rowCount: number
}

export type GetWatchlistsResponse = ApiEnvelope<{ watchlists: Watchlist[] }>
export type GetWatchlistItemsResponse = ApiEnvelope<{
  watchlistId: string
  items: WatchlistItem[]
}>
export type GetTickerBriefsResponse = ApiEnvelope<{
  symbol: string
  briefs: TickerBrief[]
}>
export type GetTickerNewsResponse = ApiEnvelope<{
  symbol: string
  news: TickerNewsItem[]
}>
export type GetMarketHeadlinesResponse = ApiEnvelope<{
  headlines: MarketHeadline[]
}>
export type GetNewsDetailResponse = ApiEnvelope<{ news: NewsDetail }>
export type GetEvidenceResponse = ApiEnvelope<{
  sessionId: string
  rows: EvidenceRow[]
}>
export type PostNewsClickResponse = ApiEnvelope<NewsClickLogResponse>
export type PostNewsExportSheetResponse = ApiEnvelope<SheetExportResponse>
export type PostAskQuestionResponse = ApiEnvelope<AskQuestionResponse>
export type PostEvidenceExportSheetResponse = ApiEnvelope<EvidenceSheetExportResponse>

export interface TerminalMvpApiClient {
  getWatchlists(): Promise<GetWatchlistsResponse>
  getWatchlistItems(watchlistId: string): Promise<GetWatchlistItemsResponse>
  getTickerBriefs(symbol: string, dateET: ETDateString): Promise<GetTickerBriefsResponse>
  getTickerNews(symbol: string, dateET: ETDateString): Promise<GetTickerNewsResponse>
  getMarketHeadlines(dateET: ETDateString): Promise<GetMarketHeadlinesResponse>
  getNewsDetail(newsId: string): Promise<GetNewsDetailResponse>
  getEvidence(sessionId: string): Promise<GetEvidenceResponse>
  postNewsClick(newsId: string, payload: NewsClickLogRequest): Promise<PostNewsClickResponse>
  postNewsExportSheet(newsId: string, payload: SheetExportRequest): Promise<PostNewsExportSheetResponse>
  postEvidenceExportSheet(
    payload: EvidenceSheetExportRequest,
  ): Promise<PostEvidenceExportSheetResponse>
  postQaAsk(payload: AskQuestionRequest): Promise<PostAskQuestionResponse>
}
