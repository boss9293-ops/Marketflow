import type { NewsClickLogRequest, NewsDetail, SheetExportRequest } from '@/lib/terminal-mvp/types'

type ClickLogEntry = {
  id: string
  newsId: string
  payload: NewsClickLogRequest
  loggedAt: string
}

type ExportQueueEntry = {
  id: string
  newsId: string
  payload: SheetExportRequest
  queuedAt: string
  metadata: {
    headline: string
    source: string
    publishedAtET: string
    summary: string
    url?: string
    symbol?: string
    tags?: string[]
    relevanceScore?: number
  }
}

const newsDetailStore = new Map<string, NewsDetail>()
const clickLogStore: ClickLogEntry[] = []
const exportQueueStore: ExportQueueEntry[] = []

export const upsertNewsDetails = (details: NewsDetail[]) => {
  for (const item of details) {
    newsDetailStore.set(item.id, item)
  }
}

export const getNewsDetailById = (newsId: string): NewsDetail | null =>
  newsDetailStore.get(newsId) ?? null

export const appendNewsClick = (newsId: string, payload: NewsClickLogRequest): string => {
  const id = `click-${newsId}-${Date.now()}`
  clickLogStore.push({
    id,
    newsId,
    payload,
    loggedAt: new Date().toISOString(),
  })
  return id
}

export const appendNewsExport = (
  newsId: string,
  payload: SheetExportRequest,
  news: NewsDetail,
): string => {
  const id = `export-${newsId}-${Date.now()}`
  exportQueueStore.push({
    id,
    newsId,
    payload,
    queuedAt: new Date().toISOString(),
    metadata: {
      headline: news.headline,
      source: news.source,
      publishedAtET: news.publishedAtET,
      summary: news.summary,
      url: news.url,
      symbol: news.symbol,
      tags: news.tags,
      relevanceScore: news.relevanceScore,
    },
  })
  return id
}
