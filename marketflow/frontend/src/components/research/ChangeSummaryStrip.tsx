import type { CSSProperties } from 'react'
import type { ChangeSummary } from '@/types/researchMonitor'

export default function ChangeSummaryStrip({ summary }: { summary: ChangeSummary }) {
  if (!summary.notable.length) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 5,
      padding: '0.4rem 0.6rem',
      background: 'rgba(252,211,77,0.04)',
      border: '1px solid rgba(252,211,77,0.15)',
      borderRadius: 8, marginTop: 6,
    } as CSSProperties}>
      {summary.notable.map((note, i) => (
        <span key={i} style={{
          fontSize: '0.65rem', color: '#fcd34d',
          background: 'rgba(252,211,77,0.07)',
          border: '1px solid rgba(252,211,77,0.18)',
          padding: '1px 7px', borderRadius: 99,
        } as CSSProperties}>
          {note}
        </span>
      ))}
    </div>
  )
}
