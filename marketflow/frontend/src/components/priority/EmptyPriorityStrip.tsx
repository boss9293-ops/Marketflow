import type { CSSProperties } from 'react'
import PriorityLinkBar from './PriorityLinkBar'

export default function EmptyPriorityStrip() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 12,
      padding: '0.65rem 0.9rem',
      background: '#070B10',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12,
    } as CSSProperties}>
      <div>
        <div style={{ fontSize: '0.63rem', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
          Priority Monitor
        </div>
        <div style={{ fontSize: '0.7rem', color: '#374151', marginTop: 2 }}>
          No watched topics yet. Open Research Workspace to start monitoring.
        </div>
      </div>
      <PriorityLinkBar />
    </div>
  )
}
