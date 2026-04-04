import type {
  AskQuestionRequest,
  EvidenceSheetExportRequest,
  ETDateString,
  NewsClickLogRequest,
  SheetExportRequest,
  TerminalMvpApiClient,
} from '@/lib/terminal-mvp/types'

const NOT_SUPPORTED_MESSAGE =
  'This method is intentionally mocked in this MVP phase. Use the hybrid dashboard service.'

const notSupported = (): never => {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

type JsonValue = Record<string, unknown>

const readErrorMessage = async (res: Response): Promise<string> => {
  const fallback = `HTTP ${res.status}`
  try {
    const raw = (await res.json()) as JsonValue
    const error = raw.error
    return typeof error === 'string' && error ? error : fallback
  } catch {
    return fallback
  }
}

async function fetchJson<TResponse>(input: string, init?: RequestInit): Promise<TResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timer)
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res))
  }
  return (await res.json()) as TResponse
}

export function createRealClient(): TerminalMvpApiClient {
  return {
    async getWatchlists() {
      return notSupported()
    },

    async getWatchlistItems(_watchlistId: string) {
      return notSupported()
    },

    async getTickerBriefs(_symbol: string, _dateET: ETDateString) {
      return notSupported()
    },

    async getTickerNews(symbol: string, dateET: ETDateString) {
      return fetchJson(`/api/terminal/ticker/${encodeURIComponent(symbol)}/news?date=${encodeURIComponent(dateET)}`)
    },

    async getMarketHeadlines(_dateET: ETDateString) {
      return notSupported()
    },

    async getNewsDetail(newsId: string) {
      return fetchJson(`/api/terminal/news/${encodeURIComponent(newsId)}`)
    },

    async getEvidence(sessionId: string) {
      return fetchJson(`/api/evidence?sessionId=${encodeURIComponent(sessionId)}`)
    },

    async postNewsClick(newsId: string, payload: NewsClickLogRequest) {
      return fetchJson(`/api/terminal/news/${encodeURIComponent(newsId)}/click`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },

    async postNewsExportSheet(newsId: string, payload: SheetExportRequest) {
      return fetchJson(`/api/terminal/news/${encodeURIComponent(newsId)}/export-sheet`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },

    async postEvidenceExportSheet(payload: EvidenceSheetExportRequest) {
      return fetchJson('/api/evidence/export-sheet', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },

    async postQaAsk(_payload: AskQuestionRequest) {
      return fetchJson('/api/qa/ask', {
        method: 'POST',
        body: JSON.stringify(_payload),
      })
    },
  }
}
