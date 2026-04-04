'use client'

import { useEffect, useState } from 'react'
import { mockSentiment } from '@/lib/mock/sentiment'
import { pickLang, useUiLang } from '@/lib/useLangMode'

type SentimentData = {
  symbol: string
  newsSentiment: 'Bullish' | 'Bearish' | 'Neutral' | null
  newsScore: number | null
  socialSentiment: string | null
  searchTrend: string | null
  keyTopics: string[]
  recentNews: { title: string; titleKo?: string | null; publishedDate: string; sentiment: string }[]
  aiSummary: string | null
  aiSummaryKo?: string | null
}

type SentimentPanelProps = {
  symbol: string
  fetchKey?: number // 0 = idle (do not auto-fetch); increment to trigger load
}

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '0.95rem',
}

const sentimentColor = (s: string | null) => {
  if (s === 'Bullish' || s === 'positive') return '#4ade80'
  if (s === 'Bearish' || s === 'negative') return '#f87171'
  return '#9ca3af'
}

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_STOCK_DATA === 'true'

const SENTIMENT_TEXT = {
  labels: {
    newsSentiment: { ko: '뉴스 심리', en: 'News Sentiment' },
    socialReddit: { ko: '소셜 / 레딧', en: 'Social / Reddit' },
    searchTrend: { ko: '검색 트렌드', en: 'Search Trend' },
    keyTopics: { ko: '핵심 토픽', en: 'Key Topics' },
  },
  snapshotTitle: { ko: '심리 스냅샷', en: 'Sentiment Snapshot' },
  ticker: { ko: '티커', en: 'Ticker' },
  loadingShort: { ko: '불러오는 중...', en: 'Loading...' },
  scorePrefix: { ko: '뉴스 점수', en: 'News score' },
  basedOn: { ko: '기사 기준', en: 'Based on' },
  articles: { ko: '건', en: 'articles' },
  clickRefresh: { ko: '데이터를 불러오려면 Refresh를 눌러주세요.', en: 'Click Refresh to load data.' },
  loadingSentiment: { ko: '심리 데이터를 불러오는 중...', en: 'Loading sentiment...' },
  failedSentiment: { ko: '심리 데이터 로드에 실패했습니다.', en: 'Failed to load sentiment data' },
  aiSummaryTitle: { ko: 'AI 심리 요약', en: 'AI Sentiment Summary' },
  aiSummaryLoading: { ko: '뉴스 감성 분석 중...', en: 'Analyzing sentiment...' },
  aiSummaryFallback: {
    ko: '데이터 로드 후 뉴스 감성 요약이 여기에 표시됩니다.',
    en: 'A sentiment summary will appear here after data loads.',
  },
  recentHeadlines: { ko: '최근 헤드라인', en: 'Recent Headlines' },
  premiumSignals: { ko: '프리미엄 시그널', en: 'Premium Signals' },
  premiumDescription: {
    ko: '기관 수급, 옵션 스큐, 펀드 포지셔닝은 Premium에서 제공합니다.',
    en: 'Institutional flow, options skew, and fund positioning are available in Premium.',
  },
} as const

export default function SentimentPanel({ symbol, fetchKey = 0 }: SentimentPanelProps) {
  const uiLang = useUiLang()
  const [data, setData] = useState<SentimentData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol) return
    if (!fetchKey) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    const normalized = symbol.includes(':') ? symbol.split(':').pop()! : symbol
    if (USE_MOCK) {
      const mock = mockSentiment[normalized] || mockSentiment.AAPL
      setData({
        symbol: mock.symbol,
        newsSentiment: mock.newsSentiment,
        newsScore: mock.newsScore,
        socialSentiment: mock.socialSentiment,
        searchTrend: mock.searchTrend,
        keyTopics: mock.keyTopics,
        recentNews: mock.recentNews,
        aiSummary: mock.aiSummary,
      })
      setLoading(false)
      setError(null)
      return
    }

    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    fetch(`/api/sentiment/${encodeURIComponent(normalized)}`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => {
        setData(d)
        setLoading(false)
      })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(String(e))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [symbol, fetchKey])

  const metrics = [
    {
      label: pickLang(uiLang, SENTIMENT_TEXT.labels.newsSentiment.ko, SENTIMENT_TEXT.labels.newsSentiment.en),
      value: loading ? pickLang(uiLang, SENTIMENT_TEXT.loadingShort.ko, SENTIMENT_TEXT.loadingShort.en) : (data?.newsSentiment ?? '--'),
      color: data ? sentimentColor(data.newsSentiment) : '#9ca3af',
    },
    {
      label: pickLang(uiLang, SENTIMENT_TEXT.labels.socialReddit.ko, SENTIMENT_TEXT.labels.socialReddit.en),
      value: data?.socialSentiment ?? '--',
      color: '#9ca3af',
    },
    {
      label: pickLang(uiLang, SENTIMENT_TEXT.labels.searchTrend.ko, SENTIMENT_TEXT.labels.searchTrend.en),
      value: data?.searchTrend ?? '--',
      color: '#9ca3af',
    },
    {
      label: pickLang(uiLang, SENTIMENT_TEXT.labels.keyTopics.ko, SENTIMENT_TEXT.labels.keyTopics.en),
      value: data?.keyTopics?.slice(0, 3).join(', ') || (loading ? '...' : '--'),
      color: '#e5e7eb',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>
          {pickLang(uiLang, SENTIMENT_TEXT.snapshotTitle.ko, SENTIMENT_TEXT.snapshotTitle.en)}
        </div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', marginBottom: 12 }}>
          {pickLang(uiLang, SENTIMENT_TEXT.ticker.ko, SENTIMENT_TEXT.ticker.en)}: {symbol}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {metrics.map(m => (
            <div
              key={m.label}
              style={{
                borderRadius: 10,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '0.6rem',
              }}
            >
              <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{m.label}</div>
              <div style={{ color: m.color, fontWeight: 700, marginTop: 4, fontSize: '0.9rem' }}>{m.value}</div>
            </div>
          ))}
        </div>
        {data?.newsScore != null && (
          <div style={{ marginTop: 10, color: '#6b7280', fontSize: '0.72rem' }}>
            {pickLang(uiLang, SENTIMENT_TEXT.scorePrefix.ko, SENTIMENT_TEXT.scorePrefix.en)}: {data.newsScore > 0 ? '+' : ''}
            {data.newsScore} | {pickLang(uiLang, SENTIMENT_TEXT.basedOn.ko, SENTIMENT_TEXT.basedOn.en)} {data.recentNews?.length ?? 0}{' '}
            {pickLang(uiLang, SENTIMENT_TEXT.articles.ko, SENTIMENT_TEXT.articles.en)}
          </div>
        )}
        {!fetchKey && !loading && !data && (
          <div style={{ marginTop: 10, color: '#6b7280', fontSize: '0.78rem' }}>
            {pickLang(uiLang, SENTIMENT_TEXT.clickRefresh.ko, SENTIMENT_TEXT.clickRefresh.en)}
          </div>
        )}
        {loading && !data && (
          <div style={{ marginTop: 10, color: '#9ca3af', fontSize: '0.8rem' }}>
            {pickLang(uiLang, SENTIMENT_TEXT.loadingSentiment.ko, SENTIMENT_TEXT.loadingSentiment.en)}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8, color: '#f87171', fontSize: '0.72rem' }}>
            {pickLang(uiLang, SENTIMENT_TEXT.failedSentiment.ko, SENTIMENT_TEXT.failedSentiment.en)}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>
          {pickLang(uiLang, SENTIMENT_TEXT.aiSummaryTitle.ko, SENTIMENT_TEXT.aiSummaryTitle.en)}
        </div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', lineHeight: 1.6 }}>
          {loading
            ? pickLang(uiLang, SENTIMENT_TEXT.aiSummaryLoading.ko, SENTIMENT_TEXT.aiSummaryLoading.en)
            : (data?.aiSummaryKo || data?.aiSummary) ??
              pickLang(uiLang, SENTIMENT_TEXT.aiSummaryFallback.ko, SENTIMENT_TEXT.aiSummaryFallback.en)}
        </div>
        {data?.recentNews && data.recentNews.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#6b7280', fontSize: '0.72rem', marginBottom: 6 }}>
              {pickLang(uiLang, SENTIMENT_TEXT.recentHeadlines.ko, SENTIMENT_TEXT.recentHeadlines.en)}
            </div>
            {data.recentNews.slice(0, 3).map((n, i) => (
              <div key={i} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ color: sentimentColor(n.sentiment), fontSize: '0.68rem', marginTop: 2, flexShrink: 0 }}>
                    {n.sentiment === 'positive' ? '+' : n.sentiment === 'negative' ? '-' : '~'}
                  </span>
                  <span style={{ color: '#d1d5db', fontSize: '0.75rem', lineHeight: 1.4 }}>
                    {uiLang === 'ko' && n.titleKo ? n.titleKo : n.title}
                    {uiLang === 'ko' && n.titleKo && (
                      <span style={{ display: 'block', color: '#6b7280', fontSize: '0.68rem', marginTop: 2 }}>{n.title}</span>
                    )}
                  </span>
                </div>
                <div style={{ color: '#4b5563', fontSize: '0.68rem', marginTop: 2, paddingLeft: 14 }}>{n.publishedDate}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, opacity: 0.65, filter: 'blur(0.8px)' }}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>
          {pickLang(uiLang, SENTIMENT_TEXT.premiumSignals.ko, SENTIMENT_TEXT.premiumSignals.en)}
        </div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem' }}>
          {pickLang(uiLang, SENTIMENT_TEXT.premiumDescription.ko, SENTIMENT_TEXT.premiumDescription.en)}
        </div>
      </div>
    </div>
  )
}
