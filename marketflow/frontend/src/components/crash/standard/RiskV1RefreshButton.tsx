'use client'

import { useState } from 'react'

export default function RiskV1RefreshButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')

  const onRefresh = async () => {
    if (status === 'running') return
    setStatus('running')
    try {
      const res = await fetch('/api/risk-v1/refresh', { method: 'POST' })
      if (!res.ok) throw new Error(`refresh failed: ${res.status}`)
      window.location.reload()
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2500)
    }
  }

  return (
    <button
      onClick={onRefresh}
      style={{
        fontSize: '0.85rem',
        color: status === 'error' ? '#fca5a5' : '#9ca3af',
        textDecoration: 'none',
        padding: '0.39rem 0.91rem',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        background: status === 'running' ? 'rgba(99,102,241,0.12)' : 'transparent',
        cursor: status === 'running' ? 'not-allowed' : 'pointer',
      }}
      title="Run risk_v1 refresh"
    >
      {status === 'running' ? 'Refreshing...' : 'Refresh'}
    </button>
  )
}
