import type { CSSProperties } from 'react'
import type { DailyDigestTopic } from '@/types/digest'
import MonitorStatusBadge from '@/components/research/MonitorStatusBadge'

const RISK_COLOR: Record<string, string> = {
  Low: '#5eead4', Moderate: '#fcd34d', Elevated: '#fb923c', High: '#fca5a5', Critical: '#f87171',
}

export default function DigestHighlightCard({ topic }: { topic: DailyDigestTopic }) {
  const riskColor = RISK_COLOR[topic.risk_level ?? ''] ?? '#94a3b8'

  return (
    <div style={{
      padding: '0.65rem 0.75rem',
      background: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 6,
      height: '100%',
    } as CSSProperties}>

      {/* Badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {topic.status && <MonitorStatusBadge status={topic.status} />}
        {topic.risk_level && (
          <span style={{
            fontSize: '0.6rem', fontWeight: 700, color: riskColor,
            background: `${riskColor}12`, border: `1px solid ${riskColor}30`,
            padding: '1px 6px', borderRadius: 99,
          } as CSSProperties}>
            {topic.risk_level}
          </span>
        )}
        {topic.vr_state && (
          <span style={{
            fontSize: '0.6rem', color: '#94a3b8',
            background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.18)',
            padding: '1px 6px', borderRadius: 99,
          } as CSSProperties}>
            {topic.vr_state}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1', lineHeight: 1.4,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      } as CSSProperties}>
        {topic.title}
      </div>

      {/* Short reason */}
      {topic.short_reason && (
        <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.4, flexGrow: 1 }}>
          {topic.short_reason}
        </div>
      )}

      {/* Action link */}
      {topic.href && (
        <a
          href={topic.href}
          style={{ fontSize: '0.68rem', fontWeight: 600, color: '#818cf8', textDecoration: 'none' } as CSSProperties}
        >
          Open Research \u2192
        </a>
      )}
    </div>
  )
}
