import type {
  AskQuestionRequest,
  EvidenceSheetExportRequest,
  ETDateString,
  GetMarketHeadlinesResponse,
  GetNewsDetailResponse,
  GetEvidenceResponse,
  GetTickerBriefsResponse,
  GetTickerNewsResponse,
  GetWatchlistItemsResponse,
  GetWatchlistsResponse,
  NewsClickLogRequest,
  PostAskQuestionResponse,
  PostEvidenceExportSheetResponse,
  PostNewsClickResponse,
  PostNewsExportSheetResponse,
  SheetExportRequest,
} from '@/lib/terminal-mvp/types'

type HttpMethod = 'GET' | 'POST'

export type EndpointContract<TRequest, TResponse> = {
  method: HttpMethod
  path: string
  describe: string
  requestExample?: TRequest
  responseExample?: TResponse
}

export const endpoints = {
  getWatchlists: {
    method: 'GET',
    path: '/watchlists',
    describe: 'GET /watchlists',
  } satisfies EndpointContract<void, GetWatchlistsResponse>,

  getWatchlistItems: {
    method: 'GET',
    path: '/watchlists/{id}/items',
    describe: 'GET /watchlists/{id}/items',
  } satisfies EndpointContract<{ id: string }, GetWatchlistItemsResponse>,

  getTickerBriefs: {
    method: 'GET',
    path: '/ticker/{symbol}/briefs?date=YYYY-MM-DD',
    describe: 'GET /ticker/{symbol}/briefs?date=YYYY-MM-DD',
  } satisfies EndpointContract<{ symbol: string; date: ETDateString }, GetTickerBriefsResponse>,

  getTickerNews: {
    method: 'GET',
    path: '/ticker/{symbol}/news?date=YYYY-MM-DD',
    describe: 'GET /ticker/{symbol}/news?date=YYYY-MM-DD',
  } satisfies EndpointContract<{ symbol: string; date: ETDateString }, GetTickerNewsResponse>,

  getMarketHeadlines: {
    method: 'GET',
    path: '/market/headlines?date=YYYY-MM-DD',
    describe: 'GET /market/headlines?date=YYYY-MM-DD',
  } satisfies EndpointContract<{ date: ETDateString }, GetMarketHeadlinesResponse>,

  getNewsDetail: {
    method: 'GET',
    path: '/news/{id}',
    describe: 'GET /news/{id}',
  } satisfies EndpointContract<{ id: string }, GetNewsDetailResponse>,

  getEvidence: {
    method: 'GET',
    path: '/evidence?sessionId=...',
    describe: 'GET /evidence?sessionId=...',
  } satisfies EndpointContract<{ sessionId: string }, GetEvidenceResponse>,

  postNewsClick: {
    method: 'POST',
    path: '/news/{id}/click',
    describe: 'POST /news/{id}/click',
  } satisfies EndpointContract<{ id: string; body: NewsClickLogRequest }, PostNewsClickResponse>,

  postNewsExportSheet: {
    method: 'POST',
    path: '/news/{id}/export-sheet',
    describe: 'POST /news/{id}/export-sheet',
  } satisfies EndpointContract<{ id: string; body: SheetExportRequest }, PostNewsExportSheetResponse>,

  postQaAsk: {
    method: 'POST',
    path: '/qa/ask',
    describe: 'POST /qa/ask',
  } satisfies EndpointContract<AskQuestionRequest, PostAskQuestionResponse>,

  postEvidenceExportSheet: {
    method: 'POST',
    path: '/evidence/export-sheet',
    describe: 'POST /evidence/export-sheet',
  } satisfies EndpointContract<EvidenceSheetExportRequest, PostEvidenceExportSheetResponse>,
} as const

export const endpointPath = {
  watchlists: () => '/watchlists',
  watchlistItems: (id: string) => `/watchlists/${id}/items`,
  tickerBriefs: (symbol: string, date: ETDateString) =>
    `/ticker/${encodeURIComponent(symbol)}/briefs?date=${encodeURIComponent(date)}`,
  tickerNews: (symbol: string, date: ETDateString) =>
    `/ticker/${encodeURIComponent(symbol)}/news?date=${encodeURIComponent(date)}`,
  marketHeadlines: (date: ETDateString) =>
    `/market/headlines?date=${encodeURIComponent(date)}`,
  newsDetail: (id: string) => `/news/${encodeURIComponent(id)}`,
  evidence: (sessionId: string) =>
    `/evidence?sessionId=${encodeURIComponent(sessionId)}`,
  newsClick: (id: string) => `/news/${encodeURIComponent(id)}/click`,
  newsExportSheet: (id: string) => `/news/${encodeURIComponent(id)}/export-sheet`,
  qaAsk: () => '/qa/ask',
  evidenceExportSheet: () => '/evidence/export-sheet',
  evidenceExportCsv: (sessionId: string) =>
    `/evidence/export-csv?sessionId=${encodeURIComponent(sessionId)}`,
} as const
