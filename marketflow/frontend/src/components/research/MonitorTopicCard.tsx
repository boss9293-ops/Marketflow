'use client'

import { useState, type CSSProperties } from 'react'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { normalizeResearchResponse } from '@/lib/normalizeResearchResponse'
import { diffResearch, deriveMonitorStatus, RISK_SCORE } from '@/lib/researchDiff'
import { updateMonitoredTopic } from '@/lib/researchMonitorStorage'
import MonitorStatusBadge from './MonitorStatusBadge'
import ChangeSummaryStrip from './ChangeSummaryStrip'
import RefreshTopicButton from './RefreshTopicButton'

const RISK_COLOR: Record<string, string> = {
  Low: '#5eead4', Moderate: '#fcd34d', Elevated: '#fb923c', High: '#fca5a5', Critical: '#f87171',
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface Props {
  topic:    MonitoredTopic
  onUpdate: (t: MonitoredTopic) => void
  onRemove: (id: string) => void
  onLoad:   (t: MonitoredTopic) => void
}

export default function MonitorTopicCard({ topic, onUpdate, onRemove, onLoad }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleRefresh() {
    setLoading(true)
    try {
      const res = await fetch('/api/research', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: topic.query }),
      })
      const raw = await res.json() as Record<string, unknown>
      if (!res.ok || raw._error) return
      const latest    = normalizeResearchResponse(raw)
      const diff      = diffResearch(topic.latest, latest)
      const prevScore = RISK_SCORE[topic.latest.risk_level] ?? 2
      const latScore  = RISK_SCORE[latest.risk_level]       ?? 2
      const updated: MonitoredTopic = {
        ...topic,
        previous:       topic.latest,
        latest,
        status:         deriveMonitorStatus(diff, prevScore, latScore),
        change_summary: diff,
        last_checked:   new Date().toISOString(),
      }
      updateMonitoredTopic(updated)
      onUpdate(updated)
    } finally {
      setLoading(false)
    }
  }

  const risk      = topic.latest.risk_level
  const riskColor = RISK_COLOR[risk] ?? '#94a3b8'
  const vrc       = topic.vr_context

  return (
    <div style={{
      background:   'rgba(255,255,255,0.02)',
      border:       '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
      padding:      '0.75rem 0.9rem',
    } as CSSProperties}>

      {/* Top row: status badge + remove */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <MonitorStatusBadge status={topic.status} />
        <button
          onClick={() => onRemove(topic.id)}
          title="Remove from watchlist"
          style={{ fontSize: '0.72rem', color: '#374151', background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px' }}
        >
          \u00d7
        </button>
      </div>

      {/* Query — click to load */}
      <div
        onClick={() => onLoad(topic)}
        title="Click to load this research result"
        style={{
          fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1', lineHeight: 1.45,
          cursor: 'pointer', marginBottom: 6,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        } as CSSProperties}
      >
        {topic.query}
      </div>

      {/* Risk + VR badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.62rem', fontWeight: 700, color: riskColor,
          background: `${riskColor}14`, border: `1px solid ${riskColor}35`,
          padding: '1px 7px', borderRadius: 99,
        } as CSSProperties}>
          {risk} Risk
        </span>
        {vrc?.vr_state && (
          <span style={{
            fontSize: '0.6rem', color: '#94a3b8',
            background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.15)',
            padding: '1px 7px', borderRadius: 99,
          } as CSSProperties}>
            {vrc.vr_state}
          </span>
        )}
        {vrc?.crash_trigger && (
          <span style={{
            fontSize: '0.6rem', color: '#fca5a5',
            background: 'rgba(252,165,165,0.07)', border: '1px solid rgba(252,165,165,0.2)',
            padding: '1px 7px', borderRadius: 99,
          } as CSSProperties}>
            Crash Trigger
          </span>
        )}
      </div>

      {/* Change summary */}
      {topic.change_summary && topic.change_summary.notable.length > 0 && (
        <ChangeSummaryStrip summary={topic.change_summary} />
      )}

      {/* Footer: timestamp + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: '0.61rem', color: '#374151' }}>
          checked {formatAgo(topic.last_checked)}
        </span>
        <RefreshTopicButton loading={loading} onRefresh={handleRefresh} />
      </div>
    </div>
  )
}
