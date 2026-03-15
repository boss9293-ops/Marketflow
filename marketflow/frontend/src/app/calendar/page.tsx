'use client'
import { useEffect, useState } from 'react'

interface Event {
  date: string
  time: string
  event: string
  importance: string
  forecast: string
  actual: string | null
}

type CalendarPayload = { events?: Event[]; error?: string; rerun_hint?: string }
const EMPTY_PAYLOAD: CalendarPayload = { events: [] }

export default function CalendarPage() {
  const [data, setData] = useState<CalendarPayload | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/calendar')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (cancelled) return
        const safe = (json && typeof json === 'object') ? json as CalendarPayload : EMPTY_PAYLOAD
        setData({
          ...safe,
          events: Array.isArray(safe.events) ? safe.events : [],
        })
      })
      .catch((err) => {
        if (cancelled) return
        setData({
          events: [],
          error: err instanceof Error ? err.message : 'Calendar feed unavailable',
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const importanceColors: Record<string, string> = {
    High: '#ef4444',
    Medium: '#f97316',
    Low: '#6b7280',
  }

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white' }}>Economic <span style={{ color: '#00D9FF' }}>Calendar</span></h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>주요 경제 지표 발표 일정</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {data === null ? (
          <div style={{ background: '#1c1c1e', borderRadius: '12px', padding: '3rem', border: '1px solid rgba(255,255,255,0.05)', textAlign: 'center', color: '#6b7280' }}>Loading calendar...</div>
        ) : (data.events?.length ?? 0) === 0 ? (
          <div style={{ background: '#1c1c1e', borderRadius: '12px', padding: '3rem', border: '1px solid rgba(255,255,255,0.05)', textAlign: 'center', color: '#6b7280' }}>
            <div>No calendar data.</div>
            {data.error ? <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#9ca3af' }}>{data.error}</div> : null}
            {data.rerun_hint ? <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#9ca3af' }}>{data.rerun_hint}</div> : null}
          </div>
        ) : (data.events || []).map((e, i) => (
          <div key={i} style={{ background: '#1c1c1e', borderRadius: '12px', padding: '1rem 1.5rem', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '100px' }}>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{e.date}</div>
              <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>{e.time} ET</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'white' }}>{e.event}</div>
            </div>
            <div>
              <span style={{ padding: '2px 8px', borderRadius: '9999px', background: `${importanceColors[e.importance]}20`, color: importanceColors[e.importance], fontSize: '0.7rem', fontWeight: 600 }}>{e.importance}</span>
            </div>
            <div style={{ minWidth: '80px', textAlign: 'right' }}>
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Forecast</div>
              <div style={{ color: '#9ca3af' }}>{e.forecast}</div>
            </div>
            <div style={{ minWidth: '80px', textAlign: 'right' }}>
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Actual</div>
              <div style={{ color: e.actual ? 'white' : '#4b5563' }}>{e.actual || '-'}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
