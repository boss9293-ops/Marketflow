import type { CSSProperties } from 'react'
import type { DailyDigestTopic } from '@/types/digest'
import MonitorStatusBadge from '@/components/research/MonitorStatusBadge'

const RISK_COLOR: Record<string, string> = {
  Low: '#5eead4', Moderate: '#fcd34d', Elevated: '#fb923c', High: '#fca5a5', Critical: '#f87171',
}

export default function DigestTopicRow({ topic }: { topic: DailyDigestTopic }) {
  const riskColor = RISK_COLOR[topic.risk_level ?? ''] ?? '#94a3b8'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '0.45rem 0.65rem',
      background: 'rgba(255,255,255,0.01)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 8,
    } as CSSProperties}>

      {topic.status && (
        <div style={{ flexShrink: 0, paddingTop: 1 }}>
          <MonitorStatusBadge status={topic.status} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          } as CSSProperties}
          title={topic.title}
        >
          {topic.title}
        </div>
        {topic.short_reason && (
          <div style={{ fontSize: '0.67rem', color: '#64748b', marginTop: 2 }}>
            {topic.short_reason}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        {topic.risk_level && (
          <span style={{
            fontSize: '0.6rem', fontWeight: 700, color: riskColor,
            background: `${riskColor}12`, border: `1px solid ${riskColor}28`,
            padding: '1px 5px', borderRadius: 99,
          } as CSSProperties}>
            {topic.risk_level}
          </span>
        )}
        {topic.vr_state && (
          <span style={{
            fontSize: '0.58rem', color: '#64748b',
            background: 'rgba(100,116,139,0.07)', border: '1px solid rgba(100,116,139,0.15)',
            padding: '1px 5px', borderRadius: 99,
          } as CSSProperties}>
            {topic.vr_state}
          </span>
        )}
        {topic.href && (
          <a
            href={topic.href}
            style={{ fontSize: '0.65rem', color: '#818cf8', fontWeight: 600, textDecoration: 'none' } as CSSProperties}
            title="Open in Research"
          >
            \u2192
          </a>
        )}
      </div>
    </div>
  )
}
