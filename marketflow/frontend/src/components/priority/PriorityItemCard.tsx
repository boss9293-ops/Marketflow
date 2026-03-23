import type { CSSProperties } from 'react'
import type { UnifiedPriorityItem } from '@/types/priority'
import PriorityStatusPill from './PriorityStatusPill'

const SOURCE_LABEL: Record<string, string> = {
  vr: 'VR', research: 'Research', monitor: 'Monitor',
}
const SOURCE_COLOR: Record<string, string> = {
  vr: '#818cf8', research: '#a78bfa', monitor: '#5eead4',
}

export default function PriorityItemCard({ item }: { item: UnifiedPriorityItem }) {
  const srcColor = SOURCE_COLOR[item.source] ?? '#94a3b8'
  const isCritical = item.level === 'critical'
  const isHigh     = item.level === 'high'

  return (
    <div style={{
      flex: '1 1 220px', minWidth: 0, maxWidth: 380,
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '0.75rem 0.85rem',
      background: isCritical
        ? 'rgba(248,113,113,0.04)'
        : isHigh
          ? 'rgba(252,165,165,0.03)'
          : 'rgba(255,255,255,0.015)',
      border: isCritical
        ? '1px solid rgba(248,113,113,0.2)'
        : isHigh
          ? '1px solid rgba(252,165,165,0.15)'
          : '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
    } as CSSProperties}>

      {/* Source + level */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em',
          color: srcColor, background: `${srcColor}12`, border: `1px solid ${srcColor}28`,
          padding: '1px 6px', borderRadius: 99,
        } as CSSProperties}>
          {SOURCE_LABEL[item.source] ?? item.source}
        </span>
        <PriorityStatusPill level={item.level} />
      </div>

      {/* Title */}
      <div style={{
        fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1', lineHeight: 1.4,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      } as CSSProperties}>
        {item.title}
      </div>

      {/* Summary */}
      <div
        style={{
          fontSize: '0.7rem', color: '#64748b', lineHeight: 1.4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        } as CSSProperties}
        title={item.summary}
      >
        {item.summary}
      </div>

      {/* Badge */}
      {item.badge && (
        <div style={{ fontSize: '0.63rem', color: item.badge_color ?? '#94a3b8', fontWeight: 600 }}>
          {item.badge}
        </div>
      )}

      {/* Action */}
      <a
        href={item.action_href}
        style={{
          marginTop: 'auto', paddingTop: 2,
          fontSize: '0.68rem', fontWeight: 600, color: '#818cf8', textDecoration: 'none',
        } as CSSProperties}
      >
        {item.action_label}
      </a>
    </div>
  )
}
