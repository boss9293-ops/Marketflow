'use client'
import { useEffect, useState } from 'react'

interface Earning {
  ticker: string
  name: string
  date: string
  estimate: number
  actual: number | null
  surprise_pct: number | null
}

type EarningsPayload = { earnings?: Earning[]; error?: string; rerun_hint?: string }

export default function EarningsPage() {
  const [data, setData] = useState<EarningsPayload | null>(null)

  useEffect(() => {
    fetch('http://localhost:5001/api/earnings')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
  }, [])

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white' }}>Earnings <span style={{ color: '#00D9FF' }}>Calendar</span></h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>주요 기업 실적 발표 일정</p>
      </div>
      <div style={{ background: '#1c1c1e', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
        {data === null ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading earnings...</div>
        ) : (data.earnings?.length ?? 0) === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
            <div>No earnings data.</div>
            {data.error ? <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#9ca3af' }}>{data.error}</div> : null}
            {data.rerun_hint ? <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#9ca3af' }}>{data.rerun_hint}</div> : null}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Date', 'Ticker', 'Company', 'EPS Est.', 'EPS Actual', 'Surprise'].map(h => (
                  <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.earnings || []).map((e) => (
                <tr key={e.ticker} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '0.75rem', color: '#9ca3af' }}>{e.date}</td>
                  <td style={{ padding: '0.75rem', fontWeight: 600, color: '#00D9FF' }}>{e.ticker}</td>
                  <td style={{ padding: '0.75rem', color: '#d1d5db' }}>{e.name}</td>
                  <td style={{ padding: '0.75rem', color: 'white' }}>${e.estimate}</td>
                  <td style={{ padding: '0.75rem', color: e.actual ? 'white' : '#4b5563' }}>{e.actual ? `$${e.actual}` : '-'}</td>
                  <td style={{ padding: '0.75rem', color: e.surprise_pct ? (e.surprise_pct > 0 ? '#22c55e' : '#ef4444') : '#4b5563' }}>
                    {e.surprise_pct ? `${e.surprise_pct > 0 ? '+' : ''}${e.surprise_pct}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
