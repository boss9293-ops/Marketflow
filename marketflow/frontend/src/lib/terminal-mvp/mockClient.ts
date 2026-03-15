import {
  ET_TIMEZONE,
  type AskQuestionRequest,
  type EvidenceSheetExportRequest,
  type EvidenceRow,
  type ETDateString,
  type MarketHeadline,
  type NewsDetail,
  type NewsClickLogRequest,
  type TerminalMvpApiClient,
  type TickerBrief,
  type TickerNewsItem,
  type Watchlist,
  type WatchlistItem,
  type SheetExportRequest,
} from '@/lib/terminal-mvp/types'

const WATCHLISTS: Watchlist[] = [
  {
    id: 'wl-default-core',
    name: 'Default Watchlist',
    isDefault: true,
    createdAtET: '2026-03-01T09:00:00-05:00',
    updatedAtET: '2026-03-11T08:45:00-05:00',
  },
]

const WATCHLIST_ITEMS: Record<string, WatchlistItem[]> = {
  'wl-default-core': [
    { id: 'wli-nflx', watchlistId: 'wl-default-core', symbol: 'NFLX', companyName: 'Netflix, Inc.', lastPrice: '$96.94', changePercent: '-1.40%', rangeLabel: 'Day Range placeholder: $95.80 - $98.70' },
    { id: 'wli-aapl', watchlistId: 'wl-default-core', symbol: 'AAPL', companyName: 'Apple Inc.', lastPrice: '$192.21', changePercent: '+0.17%', rangeLabel: 'Day Range placeholder: $190.90 - $193.10' },
    { id: 'wli-googl', watchlistId: 'wl-default-core', symbol: 'GOOGL', companyName: 'Alphabet Inc. Class A', lastPrice: '$176.08', changePercent: '+0.41%', rangeLabel: 'Day Range placeholder: $174.85 - $176.70' },
    { id: 'wli-tsla', watchlistId: 'wl-default-core', symbol: 'TSLA', companyName: 'Tesla, Inc.', lastPrice: '$208.53', changePercent: '+0.37%', rangeLabel: 'Day Range placeholder: $204.40 - $210.20' },
    { id: 'wli-nvda', watchlistId: 'wl-default-core', symbol: 'NVDA', companyName: 'NVIDIA Corporation', lastPrice: '$918.62', changePercent: '+0.49%', rangeLabel: 'Day Range placeholder: $905.00 - $922.40' },
    { id: 'wli-ibm', watchlistId: 'wl-default-core', symbol: 'IBM', companyName: 'International Business Machines', lastPrice: '$184.09', changePercent: '-1.24%', rangeLabel: 'Day Range placeholder: $183.20 - $187.00' },
    { id: 'wli-intc', watchlistId: 'wl-default-core', symbol: 'INTC', companyName: 'Intel Corporation', lastPrice: '$43.87', changePercent: '+0.73%', rangeLabel: 'Day Range placeholder: $42.90 - $44.10' },
    { id: 'wli-xom', watchlistId: 'wl-default-core', symbol: 'XOM', companyName: 'Exxon Mobil Corporation', lastPrice: '$108.12', changePercent: '-0.20%', rangeLabel: 'Day Range placeholder: $107.20 - $109.00' },
  ],
}

const BRIEF_COPY: Record<string, { openHeadline: string; openSource: string; openSummary: string; closeHeadline: string; closeSource: string; closeSummary: string }> = {
  NFLX: {
    openHeadline: 'Street desks flag softer subscription momentum after overnight analyst note.',
    openSource: 'Reuters',
    openSummary: 'Open brief placeholder: flow defensive, ad-tier economics and pricing power remain key.',
    closeHeadline: 'Stock closes lower as media basket underperforms broad growth cohort.',
    closeSource: 'Bloomberg',
    closeSummary: 'Close brief placeholder: late-session pressure tied to target-reset narrative.',
  },
  AAPL: {
    openHeadline: 'Pre-open checks indicate stable iPhone channel inventory through quarter-end.',
    openSource: 'CNBC',
    openSummary: 'Open brief placeholder: demand baseline stable, services mix still supportive.',
    closeHeadline: 'Shares finish modestly higher as software-heavy basket leads late session.',
    closeSource: 'Reuters',
    closeSummary: 'Close brief placeholder: quality-growth rotation offsets hardware caution.',
  },
  GOOGL: {
    openHeadline: 'Agency checks point to steady search ad pricing into month-end.',
    openSource: 'Financial Times',
    openSummary: 'Open brief placeholder: ad baseline steady while cloud margin pace is monitored.',
    closeHeadline: 'Shares close higher after AI product update receives constructive feedback.',
    closeSource: 'Bloomberg',
    closeSummary: 'Close brief placeholder: monetization confidence improves on product cadence.',
  },
  TSLA: {
    openHeadline: 'Pre-open sentiment softens after mixed regional pricing checks.',
    openSource: 'Reuters',
    openSummary: 'Open brief placeholder: margin concern competes with software optionality.',
    closeHeadline: 'Stock recovers late as high-beta growth basket rebounds.',
    closeSource: 'Bloomberg',
    closeSummary: 'Close brief placeholder: intraday volatility driven by positioning swings.',
  },
  NVDA: {
    openHeadline: 'Data-center channel read-through stays constructive into spending update.',
    openSource: 'Bloomberg',
    openSummary: 'Open brief placeholder: AI capex demand remains core support.',
    closeHeadline: 'Shares outperform as semis catch late-session momentum bid.',
    closeSource: 'Reuters',
    closeSummary: 'Close brief placeholder: leadership tone holds with elevated valuation sensitivity.',
  },
  IBM: {
    openHeadline: 'Pre-open commentary highlights steady consulting backlog.',
    openSource: 'Reuters',
    openSummary: 'Open brief placeholder: defensiveness helps while growth optics stay mixed.',
    closeHeadline: 'Shares close lower as value-tech basket lags growth rebound.',
    closeSource: 'Bloomberg',
    closeSummary: 'Close brief placeholder: rotation pressure offsets stability narrative.',
  },
  INTC: {
    openHeadline: 'Foundry commentary supports incremental confidence into roadmap checkpoints.',
    openSource: 'Bloomberg',
    openSummary: 'Open brief placeholder: execution trajectory improving but event-sensitive.',
    closeHeadline: 'Stock ends higher as value-semi names catch bid in afternoon trade.',
    closeSource: 'Reuters',
    closeSummary: 'Close brief placeholder: turnaround narrative supports selective buying.',
  },
  XOM: {
    openHeadline: 'Crude opens choppy as macro growth expectations are repriced.',
    openSource: 'Reuters',
    openSummary: 'Open brief placeholder: integrated majors viewed as defensive carry.',
    closeHeadline: 'Shares finish slightly lower after range-bound commodity session.',
    closeSource: 'Bloomberg',
    closeSummary: 'Close brief placeholder: stable cash-flow tone, limited directional follow-through.',
  },
}

const TICKER_NEWS_BY_SYMBOL: Record<string, Array<Omit<TickerNewsItem, 'dateET'>>> = {
  NFLX: [
    { id: 'nflx-news-1', symbol: 'NFLX', publishedAtET: '2026-03-11T15:31:00-05:00', timeET: '15:31 ET', headline: 'Streaming peers reprice after mixed ad-tier update.', source: 'Reuters', summary: 'Peer valuation pressure expands after mixed ad-tier KPI commentary.', url: 'https://example.com/news/nflx-1' },
    { id: 'nflx-news-2', symbol: 'NFLX', publishedAtET: '2026-03-11T13:08:00-05:00', timeET: '13:08 ET', headline: 'Analyst trims target while keeping neutral stance.', source: 'Bloomberg', summary: 'Target revision highlights near-term multiple compression risk.', url: 'https://example.com/news/nflx-2' },
    { id: 'nflx-news-3', symbol: 'NFLX', publishedAtET: '2026-03-11T10:12:00-05:00', timeET: '10:12 ET', headline: 'Options flow skews defensive into close.', source: 'WSJ', summary: 'Put demand rises as intraday implied volatility drifts higher.', url: 'https://example.com/news/nflx-3' },
  ],
  AAPL: [
    { id: 'aapl-news-1', symbol: 'AAPL', publishedAtET: '2026-03-11T15:41:00-05:00', timeET: '15:41 ET', headline: 'Ecosystem monetization narrative regains attention.', source: 'Bloomberg', summary: 'Services durability and attach rates support sentiment.', url: 'https://example.com/news/aapl-1' },
    { id: 'aapl-news-2', symbol: 'AAPL', publishedAtET: '2026-03-11T12:27:00-05:00', timeET: '12:27 ET', headline: 'Supplier update suggests no major demand shock.', source: 'Nikkei', summary: 'Channel checks imply stable unit path into quarter close.', url: 'https://example.com/news/aapl-2' },
    { id: 'aapl-news-3', symbol: 'AAPL', publishedAtET: '2026-03-11T10:03:00-05:00', timeET: '10:03 ET', headline: 'Large-cap tech basket opens firm versus index.', source: 'WSJ', summary: 'Quality factor bid supports downside resilience early session.', url: 'https://example.com/news/aapl-3' },
  ],
}

const MARKET_HEADLINES_TEMPLATE: Array<Omit<MarketHeadline, 'dateET'>> = [
  { id: 'mh-1', publishedAtET: '2026-03-11T15:46:00-05:00', timeET: '15:46 ET', headline: 'Oracle posts first 20%+ growth in 15 years and lifts cloud target.', source: 'Bloomberg', summary: 'Cloud guidance revision drives software tape into close.', url: 'https://example.com/news/market-1' },
  { id: 'mh-2', publishedAtET: '2026-03-11T15:19:00-05:00', timeET: '15:19 ET', headline: 'After-hours buying accelerates as software backlog revisions surprise.', source: 'Reuters', summary: 'Enterprise demand signal boosts late-session sentiment.', url: 'https://example.com/news/market-2' },
  { id: 'mh-3', publishedAtET: '2026-03-11T15:16:00-05:00', timeET: '15:16 ET', headline: 'Active managers rotate from gold into energy on macro repricing.', source: 'Financial Times', summary: 'Positioning shift indicates tactical risk rebalancing.', url: 'https://example.com/news/market-3' },
  { id: 'mh-4', publishedAtET: '2026-03-11T11:32:00-05:00', timeET: '11:32 ET', headline: 'Recession odds drift higher after mixed labor and inflation signals.', source: 'WSJ', summary: 'Macro uncertainty remains elevated across rates-sensitive sectors.', url: 'https://example.com/news/market-4' },
]

const delay = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))
const MOCK_EVIDENCE_BY_SESSION: Record<string, EvidenceRow[]> = {}

const envelope = <TData>(data: TData, dateET?: ETDateString) => ({
  data,
  meta: { timezone: ET_TIMEZONE, dateET },
})

const buildBriefs = (symbol: string, dateET: ETDateString): TickerBrief[] => {
  const base = BRIEF_COPY[symbol] ?? BRIEF_COPY.NFLX
  return [
    {
      id: `${symbol.toLowerCase()}-brief-0930`,
      symbol,
      dateET,
      checkpointET: '09:30',
      headline: base.openHeadline,
      source: base.openSource,
      summary: base.openSummary,
    },
    {
      id: `${symbol.toLowerCase()}-brief-1600`,
      symbol,
      dateET,
      checkpointET: '16:00',
      headline: base.closeHeadline,
      source: base.closeSource,
      summary: base.closeSummary,
    },
  ]
}

const buildTickerNews = (symbol: string, dateET: ETDateString): TickerNewsItem[] => {
  const fromMap = TICKER_NEWS_BY_SYMBOL[symbol]
  if (fromMap?.length) {
    return fromMap.map((item) => ({ ...item, dateET }))
  }
  const generic = TICKER_NEWS_BY_SYMBOL.NFLX.map((item, idx) => ({
    ...item,
    id: `${symbol.toLowerCase()}-news-${idx + 1}`,
    symbol,
    dateET,
    headline: item.headline.replace('Streaming', symbol),
    url: `https://example.com/news/${symbol.toLowerCase()}-${idx + 1}`,
  }))
  return generic
}

const buildMarketHeadlines = (dateET: ETDateString): MarketHeadline[] =>
  MARKET_HEADLINES_TEMPLATE.map((item) => ({ ...item, dateET }))

const buildNewsDetail = (newsId: string, dateET: ETDateString): NewsDetail => ({
  id: newsId,
  symbol: newsId.includes('-news-') ? newsId.split('-news-')[0].toUpperCase() : undefined,
  dateET,
  publishedAtET: `${dateET}T15:00:00-05:00`,
  headline: 'Placeholder detail headline generated from metadata contract.',
  source: 'Metadata Source',
  summary: 'This detail payload stays metadata-only and intentionally excludes full article storage.',
  url: `https://example.com/news/${newsId}`,
  tags: ['metadata-only', 'mvp'],
  relevanceScore: 0.68,
})

export function createMockClient(): TerminalMvpApiClient {
  return {
    async getWatchlists() {
      await delay()
      return envelope({ watchlists: WATCHLISTS })
    },

    async getWatchlistItems(watchlistId: string) {
      await delay()
      const items = WATCHLIST_ITEMS[watchlistId] ?? []
      return envelope({ watchlistId, items })
    },

    async getTickerBriefs(symbol: string, dateET: ETDateString) {
      await delay()
      return envelope({ symbol, briefs: buildBriefs(symbol, dateET) }, dateET)
    },

    async getTickerNews(symbol: string, dateET: ETDateString) {
      await delay()
      return envelope({ symbol, news: buildTickerNews(symbol, dateET) }, dateET)
    },

    async getMarketHeadlines(dateET: ETDateString) {
      await delay()
      return envelope({ headlines: buildMarketHeadlines(dateET) }, dateET)
    },

    async getNewsDetail(newsId: string) {
      await delay()
      const dateET = '2026-03-11'
      return envelope({ news: buildNewsDetail(newsId, dateET) }, dateET)
    },

    async getEvidence(sessionId: string) {
      await delay(40)
      return envelope({
        sessionId,
        rows: MOCK_EVIDENCE_BY_SESSION[sessionId] ?? [],
      })
    },

    async postNewsClick(newsId: string, payload: NewsClickLogRequest) {
      await delay(50)
      return envelope({
        logId: `click-${newsId}-${payload.actorId}-${Date.now()}`,
        logged: true as const,
      })
    },

    async postNewsExportSheet(newsId: string, payload: SheetExportRequest) {
      await delay(50)
      return envelope({
        exportJobId: `sheet-${newsId}-${payload.requestedBy}-${Date.now()}`,
        queued: true as const,
      })
    },

    async postEvidenceExportSheet(payload: EvidenceSheetExportRequest) {
      await delay(80)
      return envelope({
        exportJobId: `ev-sheet-${payload.sessionId}-${Date.now()}`,
        status: 'queued' as const,
        queued: true as const,
        rowCount: MOCK_EVIDENCE_BY_SESSION[payload.sessionId]?.length ?? 0,
      })
    },

    async postQaAsk(payload: AskQuestionRequest) {
      await delay()
      const sessionId = `mock-session-${payload.symbol.toLowerCase()}-${Date.now()}`
      MOCK_EVIDENCE_BY_SESSION[sessionId] = [
        {
          id: `${sessionId}-ev-1`,
          sessionId,
          symbol: payload.symbol,
          dateET: payload.dateET,
          sourceType: 'brief',
          sourceId: `${payload.symbol.toLowerCase()}-brief-0930`,
          title: `${payload.symbol} 09:30 ET 오픈 브리프`,
          source: 'Terminal Brief Engine',
          summary: '오픈 구간의 핵심 수급/체크포인트 요약입니다.',
          publishedAtET: `${payload.dateET}T09:30:00 ET`,
          publishedAtTs: Date.now() - 1000 * 60 * 60 * 5,
          aiRelevancy: 0.84,
          createdAtET: new Date().toISOString(),
        },
        {
          id: `${sessionId}-ev-2`,
          sessionId,
          symbol: payload.symbol,
          dateET: payload.dateET,
          sourceType: 'ticker_news',
          sourceId: `${payload.symbol.toLowerCase()}-news-1`,
          title: `${payload.symbol} intraday sentiment update`,
          source: 'Reuters',
          summary: '중요 헤드라인 기반 당일 심리 변화 설명입니다.',
          publishedAtET: `${payload.dateET}T12:05:00 ET`,
          publishedAtTs: Date.now() - 1000 * 60 * 60 * 2,
          aiRelevancy: 0.79,
          url: `https://example.com/news/${payload.symbol.toLowerCase()}-1`,
          createdAtET: new Date().toISOString(),
        },
      ]
      return envelope(
        {
          sessionId,
          symbol: payload.symbol,
          dateET: payload.dateET,
          question: payload.question,
          questionType: 'general_daily_summary' as const,
          answerKo:
            `${payload.symbol} ${payload.dateET} 기준으로 세션을 생성했습니다. ` +
            '오픈 브리프와 당일 뉴스를 근거로 요약하면, 장중 해석은 뉴스 모멘텀 대비 가격 반응 확인이 핵심입니다.',
        },
        payload.dateET,
      )
    },
  }
}
