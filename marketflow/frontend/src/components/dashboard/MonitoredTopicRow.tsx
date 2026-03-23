import type { CSSProperties } from 'react'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { formatAgoShort } from '@/lib/dashboardMonitorView'
import MonitorMiniBadge from './MonitorMiniBadge'

const RISK_COLOR: Record<string, string> = {
  Low: '#5eead4', Moderate: '#fcd34d', Elevated: '#fb923c', High: '#fca5a5', Critical: '#f87171',
}

export default function MonitoredTopicRow({ topic }: { topic: MonitoredTopic }) {
  const risk      = topic.latest.risk_level
  const riskColor = RISK_COLOR[risk] ?? '#94a3b8'
  const vrc       = topic.vr_context
  const href      = `/research?load_monitor=${topic.id}`

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0.52rem 0.65rem',
      borderRadius: 9,
      background: topic.status === 'warning'
        ? 'rgba(252,165,165,0.04)'
        : topic.status === 'changed'
          ? 'rgba(252,211,77,0.04)'
          : 'rgba(255,255,255,0.015)',
      border: topic.status === 'warning'
        ? '1px solid rgba(252,165,165,0.12)'
        : topic.status === 'changed'
          ? '1px solid rgba(252,211,77,0.12)'
          : '1px solid rgba(255,255,255,0.05)',
    } as CSSProperties}>

      {/* Status dot */}
      <div style={{ flexShrink: 0 }}>
        <MonitorMiniBadge status={topic.status} />
      </div>

      {/* Query text */}
      <div style={{
        flex: 1, minWidth: 0,
        fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      } as CSSProperties}
        title={topic.query}
      >
        {topic.query}
      </div>

      {/* Risk badge */}
      <span style={{
        fontSize: '0.6rem', fontWeight: 700, color: riskColor,
        background: `${riskColor}12`, border: `1px solid ${riskColor}30`,
        padding: '1px 6px', borderRadius: 99, flexShrink: 0,
      } as CSSProperties}>
        {risk}
      </span>

      {/* VR state */}
      {vrc?.vr_state && (
        <span style={{
          fontSize: '0.58rem', color: '#64748b',
          background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.18)',
          padding: '1px 5px', borderRadius: 99, flexShrink: 0,
        } as CSSProperties}>
          {vrc.vr_state}
        </span>
      )}

      {/* Last checked */}
      <span style={{ fontSize: '0.6rem', color: '#374151', flexShrink: 0 }}>
        {formatAgoShort(topic.last_checked)}
      </span>

      {/* Open link */}
      <a
        href={href}
        style={{ fontSize: '0.65rem', color: '#818cf8', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}
        title="Open in Research Workspace"
      >
        Open →
      </a>
    </div>
  )
}
