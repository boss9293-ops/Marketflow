'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { loadMonitoredTopics } from '@/lib/researchMonitorStorage'
import { buildPriorityItems } from '@/lib/priorityBuilder'
import PriorityItemCard    from './PriorityItemCard'
import EmptyPriorityStrip  from './EmptyPriorityStrip'
import PriorityLinkBar     from './PriorityLinkBar'

export default function UnifiedPriorityStrip() {
  const [topics, setTopics] = useState<MonitoredTopic[]>([])

  useEffect(() => {
    setTopics(loadMonitoredTopics())
  }, [])

  const items     = buildPriorityItems(topics)
  const highCount = items.filter(i => i.level === 'critical' || i.level === 'high').length

  if (topics.length === 0) return <EmptyPriorityStrip />

  return (
    <div style={{
      background: '#070B10',
      border: highCount > 0
        ? '1px solid rgba(252,165,165,0.15)'
        : '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      padding: '0.75rem 0.9rem',
    } as CSSProperties}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
            Priority Monitor
          </span>
          {highCount > 0 && (
            <span style={{
              fontSize: '0.6rem', fontWeight: 800, color: '#fca5a5',
              background: 'rgba(252,165,165,0.1)', border: '1px solid rgba(252,165,165,0.28)',
              padding: '1px 6px', borderRadius: 99,
            } as CSSProperties}>
              {highCount} high priority
            </span>
          )}
        </div>
        <PriorityLinkBar />
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {items.map(item => (
          <PriorityItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
