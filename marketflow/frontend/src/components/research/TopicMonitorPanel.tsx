import type { CSSProperties } from 'react'
import type { MonitoredTopic } from '@/types/researchMonitor'
import MonitorTopicCard from './MonitorTopicCard'

interface Props {
  topics:   MonitoredTopic[]
  onUpdate: (t: MonitoredTopic) => void
  onRemove: (id: string) => void
  onLoad:   (t: MonitoredTopic) => void
}

export default function TopicMonitorPanel({ topics, onUpdate, onRemove, onLoad }: Props) {
  if (topics.length === 0) return null

  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(8,12,22,0.96), rgba(9,11,17,0.99))',
      border:       '1px solid rgba(255,255,255,0.08)',
      borderRadius: 18,
      padding:      '1rem 1.1rem',
    } as CSSProperties}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>
          Topic Monitor
        </div>
        <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 2 }}>
          {topics.length} topic{topics.length !== 1 ? 's' : ''} watched \u00b7 click card to load, \u21bb to refresh
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 8,
      }}>
        {topics.map(t => (
          <MonitorTopicCard
            key={t.id}
            topic={t}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onLoad={onLoad}
          />
        ))}
      </div>
    </div>
  )
}
