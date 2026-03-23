import type { CSSProperties } from 'react'
import type { ResearchStatus, ResearchMeta } from '@/types/research'

const C = {
  border:   '1px solid rgba(255,255,255,0.08)',
  radiusSm: 12,
  textDim:  '#64748b',
  teal:     '#5eead4',
  rose:     '#fca5a5',
}

const STATUS_CFG = {
  live:    { color: '#5eead4', label: 'LIVE' },
  loading: { color: '#64748b', label: 'LOADING' },
  failed:  { color: '#fca5a5', label: 'FAILED' },
  idle:    { color: '#64748b', label: 'IDLE' },
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return ts }
}

export default function ResearchTrustBar({ status, meta }: { status: ResearchStatus; meta?: ResearchMeta }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.idle

  return (
    <div style={{
      display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
      padding: '0.5rem 0.8rem',
      background: 'rgba(255,255,255,0.02)',
      border: C.border,
      borderRadius: C.radiusSm,
    } as CSSProperties}>
      <span title={`Result status: ${cfg.label}`} style={{
        fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em',
        color: cfg.color,
        background: `${cfg.color}18`,
        border: `1px solid ${cfg.color}40`,
        padding: '2px 9px', borderRadius: 99, cursor: 'help',
      }}>
        {cfg.label}
      </span>
      {meta && (
        <>
          <span style={{ fontSize: '0.72rem', color: C.textDim }}>AI Generated</span>
          <span style={{ fontSize: '0.72rem', color: C.textDim }}>{meta.provider} / {meta.model}</span>
          {meta.latency_ms != null && (
            <span title="Analysis latency" style={{ fontSize: '0.72rem', color: C.textDim, cursor: 'help' }}>
              {meta.latency_ms}ms
            </span>
          )}
          {meta.timestamp && (
            <span style={{ fontSize: '0.72rem', color: C.textDim }}>at {fmt(meta.timestamp)}</span>
          )}
          {meta.sources_used != null && (
            <span style={{ fontSize: '0.72rem', color: C.textDim }}>{meta.sources_used} sources</span>
          )}
        </>
      )}
      <span style={{ fontSize: '0.72rem', color: C.textDim, fontStyle: 'italic', marginLeft: 'auto' }}>
        Research summaries are AI-generated · not trading instructions
      </span>
    </div>
  )
}
