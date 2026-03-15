'use client'

import { useEffect, useMemo, useState } from 'react'

type AiResponse = {
  weather?: string
  evidence?: string
  action?: string
  psychology?: string
  model?: string
  asof?: string
  cached?: boolean
  filled?: boolean
  error?: string
}

type Props = {
  contextPack: Record<string, unknown>
  fallback: {
    weather: string
    evidence: string
    action: string
    psychology: string
  }
  currentState: string
  lang?: 'ko' | 'en'
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'

function renderLine(label: string, value?: string) {
  return `${label}: ${value ?? '-'}`
}

export default function NavigatorAIAnalysis({ contextPack, fallback, currentState, lang = 'ko' }: Props) {
  const t = (ko: string, en: string) => (lang === 'en' ? en : ko)
  const [loading, setLoading] = useState(false)
  const [gpt, setGpt] = useState<AiResponse | null>(null)
  const [gemini, setGemini] = useState<AiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoRun, setAutoRun] = useState(false)
  const [lastRunState, setLastRunState] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<'gemini' | 'gpt' | 'both'>('gemini')

  const payload = useMemo(() => ({ context_pack: contextPack }), [contextPack])
  const payloadKey = useMemo(() => JSON.stringify(contextPack), [contextPack])

  const runAnalysis = async (mode: 'gemini' | 'gpt' | 'both' = runMode) => {
    setLoading(true)
    setError(null)
    try {
      const fetchAi = async (url: string) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        return { status: res.status, data }
      }
      const tasks: Array<Promise<{ status: number; data: AiResponse }>> = []
      if (mode === 'gpt' || mode === 'both') tasks.push(fetchAi(`${API_BASE}/api/crash/navigator/ai/gpt`))
      if (mode === 'gemini' || mode === 'both') tasks.push(fetchAi(`${API_BASE}/api/crash/navigator/ai/gemini`))
      const results = await Promise.all(tasks)
      const gptRes = mode === 'gemini' ? null : results.shift() || null
      const gemRes = mode === 'gpt' ? null : results.shift() || null

      if (gptRes) setGpt(gptRes.data as AiResponse)
      if (gemRes) setGemini(gemRes.data as AiResponse)

      const hit429 = (gptRes?.status === 429) || (gemRes?.status === 429)
      const hasError =
        Boolean((gptRes?.data as AiResponse | undefined)?.error) ||
        Boolean((gemRes?.data as AiResponse | undefined)?.error)
      if (hit429) {
        setError('Daily AI limit reached.')
      } else if (hasError) {
        setError('AI unavailable')
      } else {
        setLastRunState(currentState)
      }
    } catch (err) {
      setError('AI unavailable')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!autoRun || loading) return
    if (!lastRunState) return
    if (currentState !== lastRunState) {
      runAnalysis()
    }
  }, [autoRun, currentState, lastRunState, loading])

  useEffect(() => {
    let alive = true
    const loadCached = async (provider: 'gpt' | 'gemini', setter: (v: AiResponse | null) => void) => {
      try {
        const res = await fetch(`${API_BASE}/api/crash/navigator/ai/cache`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context_pack: contextPack, provider }),
        })
        const data = (await res.json()) as AiResponse
        if (!alive) return
        if (data?.cached) {
          setter(data)
        }
      } catch (err) {
        if (!alive) return
      }
    }
    loadCached('gpt', setGpt)
    loadCached('gemini', setGemini)
    return () => {
      alive = false
    }
  }, [payloadKey])

  const renderCard = (title: string, data: AiResponse | null) => {
    const useFallback = !data || data.error
    const showUnavailable = Boolean(data?.error)
    const lines = useFallback
      ? {
          weather: fallback.weather,
          evidence: fallback.evidence,
          action: fallback.action,
          psychology: fallback.psychology,
        }
      : {
          weather: data.weather ?? fallback.weather,
          evidence: data.evidence ?? fallback.evidence,
          action: data.action ?? fallback.action,
          psychology: data.psychology ?? fallback.psychology,
        }

    return (
      <div
        style={{
          background: '#0f1522',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          padding: '1rem 1.1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: '0.88rem', color: '#cbd5f5', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('오늘의 위험예보', 'Weather')}</div>
          <div style={{ marginBottom: 10 }}>{lines.weather ?? '-'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('근거', 'Evidence')}</div>
          <div style={{ marginBottom: 10 }}>{lines.evidence ?? '-'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('행동', 'Action')}</div>
          <div style={{ marginBottom: 10 }}>{lines.action ?? '-'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('심리', 'Psychology')}</div>
          <div>{lines.psychology ?? '-'}</div>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          {data?.model ? `model: ${data.model}` : 'model: -'}
        </div>
        <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
          {data?.asof ? `Last generated: ${data.asof}` : 'Last generated: -'} {data?.cached ? '· cached' : ''}
        </div>
        {data?.filled ? <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>filled from context</div> : null}
        {showUnavailable && <div style={{ fontSize: '0.76rem', color: '#f2c9a0' }}>AI unavailable</div>}
      </div>
    )
  }

  return (
    <section
      style={{
        background: '#0f1522',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14,
        padding: '1.2rem 1.4rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem' }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>AI Analysis</div>
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
            {t('Weather-forecast style narration', 'Weather-forecast style narration')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
            {t('상태 변경 시 자동 실행', 'Auto-run on state change')}
          </label>
          <select
            value={runMode}
            onChange={(e) => setRunMode(e.target.value as 'gemini' | 'gpt' | 'both')}
            style={{
              background: 'rgba(148,163,184,0.18)',
              color: '#e5e7eb',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              padding: '0.35rem 0.6rem',
              fontSize: '0.78rem',
            }}
          >
            <option value="gemini">{t('제미나이만', 'Gemini only')}</option>
            <option value="gpt">{t('GPT만', 'GPT only')}</option>
            <option value="both">{t('둘 다', 'Both')}</option>
          </select>
          <button
            onClick={() => runAnalysis()}
            disabled={loading}
            style={{
              background: 'rgba(148,163,184,0.18)',
              color: '#e5e7eb',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              padding: '0.4rem 0.8rem',
              fontSize: '0.78rem',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? t('실행 중...', 'Running...') : t('AI 분석 실행', 'Run AI Analysis')}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        {renderCard('AI Brief (GPT)', gpt)}
        {renderCard('AI Brief (Gemini)', gemini)}
      </div>

      <details>
        <summary style={{ fontSize: '0.78rem', color: '#9ca3af', cursor: 'pointer' }}>
          {t('입력값', 'inputs')}
        </summary>
        <pre
          style={{
            marginTop: 8,
            background: '#0b111c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            padding: '0.75rem',
            fontSize: '0.74rem',
            color: '#cbd5f5',
            overflowX: 'auto',
          }}
        >
          {JSON.stringify(contextPack, null, 2)}
        </pre>
      </details>

      {error && <div style={{ fontSize: '0.78rem', color: '#f2c9a0' }}>{error}</div>}
    </section>
  )
}
