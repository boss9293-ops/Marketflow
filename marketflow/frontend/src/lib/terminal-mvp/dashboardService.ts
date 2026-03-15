import { createMockClient } from '@/lib/terminal-mvp/mockClient'
import { createRealClient } from '@/lib/terminal-mvp/realClient'
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
  TerminalMvpApiClient,
} from '@/lib/terminal-mvp/types'

export type ClientMode = 'mock' | 'real' | 'hybrid'

export type DashboardSnapshot = {
  watchlists: GetWatchlistsResponse['data']['watchlists']
  selectedWatchlistId: string | null
  watchlistItems: GetWatchlistItemsResponse['data']['items']
  marketHeadlines: GetMarketHeadlinesResponse['data']['headlines']
}

export type DashboardService = {
  getDashboardSnapshot(dateET: ETDateString): Promise<DashboardSnapshot>
  getTickerBriefs(symbol: string, dateET: ETDateString): Promise<GetTickerBriefsResponse>
  getTickerNews(symbol: string, dateET: ETDateString): Promise<GetTickerNewsResponse>
  getNewsDetail(newsId: string): Promise<GetNewsDetailResponse>
  getEvidence(sessionId: string): Promise<GetEvidenceResponse>
  logNewsClick(newsId: string, payload: NewsClickLogRequest): Promise<PostNewsClickResponse>
  exportNewsToSheet(newsId: string, payload: SheetExportRequest): Promise<PostNewsExportSheetResponse>
  exportEvidenceToSheet(
    payload: EvidenceSheetExportRequest,
  ): Promise<PostEvidenceExportSheetResponse>
  askQuestion(payload: AskQuestionRequest): Promise<PostAskQuestionResponse>
}

export type CreateDashboardServiceOptions = {
  mode?: ClientMode
}

const createClient = (mode: ClientMode): TerminalMvpApiClient =>
  mode === 'real' ? createRealClient() : createMockClient()

export function createDashboardService(
  options: CreateDashboardServiceOptions = {},
): DashboardService {
  const mode = options.mode ?? 'hybrid'
  const mockClient = createMockClient()
  const realClient = createRealClient()
  const singleClient = createClient(mode === 'hybrid' ? 'mock' : mode)

  const useRealNewsMethods = mode === 'hybrid'

  return {
    async getDashboardSnapshot(dateET: ETDateString) {
      const watchlistsRes = await singleClient.getWatchlists()
      const watchlists = watchlistsRes.data.watchlists
      const selectedWatchlistId = watchlists[0]?.id ?? null

      if (!selectedWatchlistId) {
        return {
          watchlists,
          selectedWatchlistId: null,
          watchlistItems: [],
          marketHeadlines: [],
        }
      }

      const [itemsRes, headlinesRes] = await Promise.all([
        singleClient.getWatchlistItems(selectedWatchlistId),
        singleClient.getMarketHeadlines(dateET),
      ])

      return {
        watchlists,
        selectedWatchlistId,
        watchlistItems: itemsRes.data.items,
        marketHeadlines: headlinesRes.data.headlines,
      }
    },

    async getTickerBriefs(symbol: string, dateET: ETDateString) {
      return singleClient.getTickerBriefs(symbol, dateET)
    },

    async getTickerNews(symbol: string, dateET: ETDateString) {
      if (useRealNewsMethods) {
        return realClient.getTickerNews(symbol, dateET)
      }
      return singleClient.getTickerNews(symbol, dateET)
    },

    async getNewsDetail(newsId: string) {
      if (useRealNewsMethods) {
        return realClient.getNewsDetail(newsId)
      }
      return singleClient.getNewsDetail(newsId)
    },

    async getEvidence(sessionId: string) {
      if (useRealNewsMethods) {
        return realClient.getEvidence(sessionId)
      }
      return singleClient.getEvidence(sessionId)
    },

    async logNewsClick(newsId: string, payload: NewsClickLogRequest) {
      if (useRealNewsMethods) {
        return realClient.postNewsClick(newsId, payload)
      }
      return singleClient.postNewsClick(newsId, payload)
    },

    async exportNewsToSheet(newsId: string, payload: SheetExportRequest) {
      if (useRealNewsMethods) {
        return realClient.postNewsExportSheet(newsId, payload)
      }
      return singleClient.postNewsExportSheet(newsId, payload)
    },

    async exportEvidenceToSheet(payload: EvidenceSheetExportRequest) {
      if (useRealNewsMethods) {
        return realClient.postEvidenceExportSheet(payload)
      }
      return singleClient.postEvidenceExportSheet(payload)
    },

    async askQuestion(payload: AskQuestionRequest) {
      if (useRealNewsMethods) {
        return realClient.postQaAsk(payload)
      }
      return singleClient.postQaAsk(payload)
    },
  }
}
