'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { loadMonitoredTopics } from '@/lib/researchMonitorStorage'
import { sortForDashboard, STATUS_PRIORITY } from '@/lib/dashboardMonitorView'
import MonitorWidgetHeader from './MonitorWidgetHeader'
import MonitoredTopicRow  from './MonitoredTopicRow'

export default function MonitoredTopicsWidget() {
  const [topics, setTopics] = useState<MonitoredTopic[]>([])

  useEffect(() => {
    setTopics(loadMonitoredTopics())
  }, [])

  const sorted       = sortForDashboard(topics)
  const warningCount = topics.filter(t => STATUS_PRIORITY[t.status] >= 3).length

  if (topics.length === 0) {
    return (
      <div style={{
        background: '#070B10',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14,
        padding: '0.75rem 0.9rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      } as CSSProperties}>
        <div>
          <div style={{ fontSize: '0.65rem', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>
            Research Monitor
          </div>
          <div style={{ fontSize: '0.72rem', color: '#374151', marginTop: 3 }}>
            No watched topics. Open Research Workspace to watch topics.
          </div>
        </div>
        <a
          href="/research"
          style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}
        >
          Open ↗
        </a>
      </div>
    )
  }

  return (
    <div style={{
      background: '#070B10',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      padding: '0.75rem 0.9rem',
    } as CSSProperties}>
      <MonitorWidgetHeader count={topics.length} warningCount={warningCount} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sorted.map(t => (
          <MonitoredTopicRow key={t.id} topic={t} />
        ))}
      </div>
      {topics.length > 5 && (
        <div style={{ marginTop: 8, fontSize: '0.64rem', color: '#374151', textAlign: 'right' }}>
          +{topics.length - 5} more ·{' '}
          <a href="/research" style={{ color: '#818cf8', textDecoration: 'none' }}>view all</a>
        </div>
      )}
    </div>
  )
}
