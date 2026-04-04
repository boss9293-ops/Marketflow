'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'

interface TodayContextPayload {
  success: boolean
  text: string
  prompt_version: string
  prompt_key: string
  prompt_source: string
  fallback_used: boolean
  message: string
}

const toPreview = (value: string, max = 190): string => {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max).trimEnd()}…`
}

export default function TodayContextCard({
  style,
}: { style?: React.CSSProperties }) {
  const [payload, setPayload] = useState<TodayContextPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    
    fetch(`${API_BASE}/api/today-context`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API error ${res.status}`)
        return res.json()
      })
      .then((json: TodayContextPayload) => {
        if (active) {
          setPayload(json)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          setError(String(err))
          setLoading(false)
        }
      })
      
    return () => { active = false }
  }, [])

  // Basic styles for the bridge card
  const bridgeStyle: React.CSSProperties = {
    background: '#0B1015',
    border: '1px solid rgba(148, 163, 184, 0.15)',
    borderLeft: '3px solid #60A5FA', // Interpretive blue
    borderRadius: 10,
    padding: '0.85rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    ...style
  }

  if (loading) {
    return (
      <div style={bridgeStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#D8E6F5' }}>Today Context</span>
          <span style={{ fontSize: '0.72rem', color: '#64748B' }}>Loading interpretive context...</span>
        </div>
      </div>
    )
  }

  const hasContent = payload?.text && payload.text.trim().length > 0;
  
  // Safe Empty / Error State
  if (error || !payload || !payload.success || !hasContent) {
    return (
      <div style={{ ...bridgeStyle, borderLeftColor: '#EF4444' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#D8E6F5' }}>Today Context</span>
          <span style={{ fontSize: '0.72rem', color: '#EF4444' }}>
            {error || payload?.message || "현재 시장의 핵심 맥락을 불러오지 못했습니다."}
          </span>
        </div>
      </div>
    )
  }

  // Success State
  return (
    <div style={bridgeStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#D8E6F5', letterSpacing: '0.02em' }}>Today Context</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {payload.fallback_used && (
            <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#FACC15', background: 'rgba(250,204,21,0.1)', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(250,204,21,0.2)' }}>
              Fallback
            </span>
          )}
          <span style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace' }}>
            {payload.prompt_version}
          </span>
        </div>
      </div>
      <div style={{ color: '#E2E8F0', fontSize: '0.86rem', lineHeight: 1.5, letterSpacing: '-0.015em' }}>
        {toPreview(payload.text, 190)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link
          href="/context"
          style={{
            textDecoration: 'none',
            border: '1px solid rgba(125,211,252,0.28)',
            background: 'rgba(14,165,233,0.10)',
            color: '#BAE6FD',
            borderRadius: 999,
            padding: '2px 9px',
            fontSize: '0.63rem',
            fontWeight: 700,
          }}
        >
          Full Context →
        </Link>
        <Link
          href="/news"
          style={{
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(255,255,255,0.04)',
            color: '#CBD5E1',
            borderRadius: 999,
            padding: '2px 9px',
            fontSize: '0.63rem',
            fontWeight: 700,
          }}
        >
          News Detail →
        </Link>
      </div>
    </div>
  )
}
