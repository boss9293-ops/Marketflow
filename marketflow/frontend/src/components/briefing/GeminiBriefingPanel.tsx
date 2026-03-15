'use client'

import { useEffect, useMemo, useState } from 'react'

type BriefResponse = {
  paragraphs?: string[]
  warnings?: string[]
  provider?: string
  model?: string
  fetchedAt?: string
}

type GeminiBriefingPanelProps = {
  asofDay?: string | null
}

const CACHE_KEY_PREFIX = 'daily-briefing:gemini:'

const formatLocalDate = (d: Date) => {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function GeminiBriefingPanel({ asofDay }: GeminiBriefingPanelProps) {
  const [paragraphs, setParagraphs] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [provider, setProvider] = useState<string>('auto')
  const [model, setModel] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const effectiveAsof = useMemo(() => asofDay || formatLocalDate(new Date()), [asofDay])
  const cacheKey = useMemo(() => `${CACHE_KEY_PREFIX}${effectiveAsof}`, [effectiveAsof])

  useEffect(() => {
    if (!effectiveAsof || !cacheKey) return
    try {
      const cachedRaw = localStorage.getItem(cacheKey)
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as BriefResponse
        if (Array.isArray(cached.paragraphs)) {
          setParagraphs(cached.paragraphs)
          setWarnings(Array.isArray(cached.warnings) ? cached.warnings : [])
          setProvider(typeof cached.provider === 'string' ? cached.provider : 'auto')
          setModel(typeof cached.model === 'string' ? cached.model : '')
          return
        }
      }
    } catch {
      // ignore cache errors
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    setLoading(true)
    setError(null)
    fetch('/api/live-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asof: effectiveAsof,
        forceRefresh: refreshToken > 0,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load daily review')
        return res.json()
      })
      .then((data: BriefResponse) => {
        setParagraphs(Array.isArray(data.paragraphs) ? data.paragraphs : [])
        setWarnings(Array.isArray(data.warnings) ? data.warnings : [])
        setProvider(typeof data.provider === 'string' ? data.provider : 'auto')
        setModel(typeof data.model === 'string' ? data.model : '')
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              paragraphs: data.paragraphs ?? [],
              warnings: data.warnings ?? [],
              provider: data.provider ?? 'auto',
              model: data.model ?? '',
            })
          )
        } catch {
          // ignore cache write errors
        }
      })
      .catch((err: Error) => {
        setError(err.name === 'AbortError' ? 'Timeout' : err.message)
      })
      .finally(() => {
        clearTimeout(timeout)
        setLoading(false)
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [effectiveAsof, cacheKey, refreshToken])

  const handleRefresh = () => {
    if (!cacheKey) return
    try {
      localStorage.removeItem(cacheKey)
    } catch {
      // ignore storage errors
    }
    setRefreshToken((v) => v + 1)
    setParagraphs([])
    setWarnings([])
    setProvider('auto')
    setModel('')
    setError(null)
    setLoading(false)
  }

  if (!effectiveAsof) {
    return (
      <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
        Daily review unavailable (missing date).
      </div>
    )
  }

  return (
    <div style={{
      marginTop: 14,
      padding: '0.75rem 0.9rem',
      borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: '#60a5fa', fontWeight: 700 }}>
          AI DAILY REVIEW
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
            {provider.toUpperCase()}{model ? ` · ${model}` : ''}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              color: '#e5e7eb',
              borderRadius: 999,
              fontSize: '0.65rem',
              padding: '0.15rem 0.5rem',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, color: '#e5e7eb', fontSize: '0.78rem', lineHeight: 1.6 }}>
        {loading && <div style={{ color: '#9ca3af' }}>Loading daily review...</div>}
        {!loading && error && <div style={{ color: '#f87171' }}>Failed to load daily review: {error}</div>}
        {!loading && !error && paragraphs.length === 0 && (
          <div style={{ color: '#9ca3af' }}>Daily review is not ready yet.</div>
        )}
        {!loading && !error && paragraphs.map((p, idx) => (
          <div key={`gemini-${idx}`}>{p}</div>
        ))}
        {!loading && !error && warnings.length > 0 && (
          <div style={{ marginTop: 6, color: '#cbd5f5', fontSize: '0.72rem' }}>
            {warnings.map((w, idx) => (
              <div key={`warn-${idx}`}>{w}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
