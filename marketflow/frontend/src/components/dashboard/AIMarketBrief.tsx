'use client'

import Link from 'next/link'
import { useEffect, useState, type CSSProperties } from 'react'

import BilLabel from '@/components/BilLabel'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'

interface BriefingCardPayload {
  success: boolean
  text: string
  prompt_version: string
  prompt_key: string
  prompt_source: string
  fallback_used: boolean
  message: string
}

interface BriefingCardsResponse {
  macro_brief?: BriefingCardPayload
  risk_brief?: BriefingCardPayload
  market_structure_brief?: BriefingCardPayload
}

interface AIMarketBriefProps {
  style?: CSSProperties
  linesKo?: string[]
  linesEn?: string[]
  environmentFit?: 'Low' | 'Medium' | 'High'
  explainRows?: Array<{ keyLabel: string; value: string }>
}

const toPreview = (value: string, max = 170): string => {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max).trimEnd()}…`
}

function fitColorOf(value: AIMarketBriefProps['environmentFit']): string {
  if (value === 'High') return '#22C55E'
  if (value === 'Low') return '#F97316'
  return '#FACC15'
}

function BriefCard({
  title,
  payload,
}: {
  title: string
  payload?: BriefingCardPayload | null
}) {
  const loading = payload === undefined

  if (loading) {
    return (
      <div
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 10,
          padding: '0.8rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <h4 style={{ color: '#D8E6F5', fontSize: '0.78rem', margin: 0 }}>{title}</h4>
        <div style={{ color: '#64748B', fontSize: '0.75rem', marginTop: 4 }}>Loading...</div>
      </div>
    )
  }

  const hasContent = payload?.text && payload.text.trim().length > 0
  if (!payload || !payload.success || !hasContent) {
    return (
      <div
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 10,
          padding: '0.8rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <h4 style={{ color: '#D8E6F5', fontSize: '0.78rem', margin: 0 }}>{title}</h4>
        <div style={{ color: '#EF4444', fontSize: '0.75rem', marginTop: 4 }}>
          {payload?.message || 'Unable to load briefing content.'}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 10,
        padding: '0.8rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ color: '#D8E6F5', fontSize: '0.78rem', margin: 0, fontWeight: 700 }}>{title}</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {payload.fallback_used && (
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 600,
                color: '#FACC15',
                background: 'rgba(250,204,21,0.1)',
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid rgba(250,204,21,0.2)',
              }}
            >
              Fallback
            </span>
          )}
          <span style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace' }}>
            {payload.prompt_version}
          </span>
        </div>
      </div>

      <div style={{ color: '#E2E8F0', fontSize: '0.8rem', lineHeight: 1.5, letterSpacing: '-0.01em' }}>
        {toPreview(payload.text, 170)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Link
          href="/briefing"
          style={{
            textDecoration: 'none',
            border: '1px solid rgba(125,211,252,0.28)',
            background: 'rgba(14,165,233,0.1)',
            color: '#BAE6FD',
            borderRadius: 999,
            padding: '3px 10px',
            fontSize: '0.68rem',
            fontWeight: 700,
          }}
        >
          Full Briefing →
        </Link>
        <Link
          href="/news"
          style={{
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(255,255,255,0.04)',
            color: '#CBD5E1',
            borderRadius: 999,
            padding: '3px 10px',
            fontSize: '0.68rem',
            fontWeight: 700,
          }}
        >
          News Detail →
        </Link>
      </div>
    </div>
  )
}

export default function AIMarketBrief({
  style,
  linesKo = [],
  linesEn = [],
  environmentFit = 'Medium',
}: AIMarketBriefProps) {
  const [data, setData] = useState<BriefingCardsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fitColor = fitColorOf(environmentFit)
  const newsSlice = (
    linesEn.find((line) => line?.trim()) ||
    linesKo.find((line) => line?.trim()) ||
    ''
  ).trim()

  useEffect(() => {
    let active = true
    setError(null)

    fetch(`${API_BASE}/api/briefing-cards`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API error ${res.status}`)
        return res.json()
      })
      .then((json: BriefingCardsResponse) => {
        if (active) setData(json)
      })
      .catch((err) => {
        if (active) setError(String(err))
      })

    return () => {
      active = false
    }
  }, [])

  if (error) {
    return (
      <section
        style={{
          background: '#0B0F14',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: '0.85rem',
          ...style,
        }}
      >
        <BilLabel ko="스마트 애널라이저" en="Smart Analyzer" variant="label" />
        <div style={{ color: '#EF4444', fontSize: '0.84rem', marginTop: 10 }}>
          Failed to load Smart Analyzer: {error}
        </div>
      </section>
    )
  }

  return (
    <section
      style={{
        background: '#0B0F14',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: '0.85rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <BilLabel ko="AI 시장 브리핑" en="Smart Analyzer" variant="label" />
        <span
          style={{
            borderRadius: 999,
            border: `1px solid ${fitColor}44`,
            background: `${fitColor}1A`,
            color: fitColor,
            fontSize: '0.65rem',
            fontWeight: 800,
            padding: '2px 8px',
            letterSpacing: '0.04em',
          }}
        >
          ENV {environmentFit.toUpperCase()}
        </span>
      </div>

      {newsSlice && (
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(15,23,42,0.45)',
            borderRadius: 10,
            padding: '0.65rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ color: '#7DD3FC', fontSize: '0.62rem', letterSpacing: '0.06em', fontWeight: 800 }}>
            NEWS SLICE
          </span>
          <span style={{ color: '#E2E8F0', fontSize: '0.74rem', lineHeight: 1.45 }}>
            {toPreview(newsSlice, 140)}
          </span>
          <div>
            <Link
              href="/news"
              style={{
                textDecoration: 'none',
                color: '#93C5FD',
                fontSize: '0.69rem',
                fontWeight: 700,
              }}
            >
              Open full article flow →
            </Link>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: '0.6rem' }}>
        <BriefCard title="Macro Brief" payload={data ? data.macro_brief : undefined} />
        <BriefCard title="Risk Brief" payload={data ? data.risk_brief : undefined} />
        <BriefCard title="Market Structure Brief" payload={data ? data.market_structure_brief : undefined} />
      </div>
    </section>
  )
}

