'use client'

import { useEffect, useState } from 'react'
import { mockSentiment } from '@/lib/mock/sentiment'

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
  fetchKey?: number   // 0 = idle (do not auto-fetch); increment to trigger load
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

export default function SentimentPanel({ symbol, fetchKey = 0 }: SentimentPanelProps) {
  const [data, setData] = useState<SentimentData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol) return
    if (!fetchKey) {
      setData(null); setLoading(false); setError(null)
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
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { if (e !== 'abort') { setError(String(e)); setLoading(false) } })
    return () => ctrl.abort()
  }, [symbol, fetchKey])

  const metrics = [
    {
      label: 'News Sentiment',
      value: loading ? 'Loading...' : (data?.newsSentiment ?? '--'),
      color: data ? sentimentColor(data.newsSentiment) : '#9ca3af',
    },
    {
      label: 'Social / Reddit',
      value: data?.socialSentiment ?? '--',
      color: '#9ca3af',
    },
    {
      label: 'Search Trend',
      value: data?.searchTrend ?? '--',
      color: '#9ca3af',
    },
    {
      label: 'Key Topics',
      value: data?.keyTopics?.slice(0, 3).join(', ') || (loading ? '...' : '--'),
      color: '#e5e7eb',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Sentiment Snapshot</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', marginBottom: 12 }}>Ticker: {symbol}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {metrics.map((m) => (
            <div key={m.label} style={{ borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.6rem' }}>
              <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{m.label}</div>
              <div style={{ color: m.color, fontWeight: 700, marginTop: 4, fontSize: '0.9rem' }}>{m.value}</div>
            </div>
          ))}
        </div>
        {data?.newsScore != null && (
          <div style={{ marginTop: 10, color: '#6b7280', fontSize: '0.72rem' }}>
            News score: {data.newsScore > 0 ? '+' : ''}{data.newsScore} &nbsp;|&nbsp; Based on {data.recentNews?.length ?? 0} articles
          </div>
        )}
        {!fetchKey && !loading && !data && (
          <div style={{ marginTop: 10, color: '#6b7280', fontSize: '0.78rem' }}>
            Click ↻ Refresh to load data
          </div>
        )}
        {loading && !data && (
          <div style={{ marginTop: 10, color: '#9ca3af', fontSize: '0.8rem' }}>Loading sentiment...</div>
        )}
        {error && (
          <div style={{ marginTop: 8, color: '#f87171', fontSize: '0.72rem' }}>Failed to load sentiment data</div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>AI Sentiment Summary</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', lineHeight: 1.6 }}>
          {loading
            ? '뉴스 감성 분석 중...'
            : (data?.aiSummaryKo || data?.aiSummary)
            ?? '데이터 로드 후 뉴스 감성 요약이 여기에 표시됩니다.'}
        </div>
        {data?.recentNews && data.recentNews.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#6b7280', fontSize: '0.72rem', marginBottom: 6 }}>Recent Headlines</div>
            {data.recentNews.slice(0, 3).map((n, i) => (
              <div key={i} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ color: sentimentColor(n.sentiment), fontSize: '0.68rem', marginTop: 2, flexShrink: 0 }}>
                    {n.sentiment === 'positive' ? '+' : n.sentiment === 'negative' ? '-' : '~'}
                  </span>
                  <span style={{ color: '#d1d5db', fontSize: '0.75rem', lineHeight: 1.4 }}>
                    {n.titleKo || n.title}
                    {n.titleKo && (
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
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>Premium Signals</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem' }}>
          Institutional flow, options skew, and fund positioning are available in Premium.
        </div>
      </div>
    </div>
  )
}
