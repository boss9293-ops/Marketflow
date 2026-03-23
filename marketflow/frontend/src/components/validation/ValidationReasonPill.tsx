import type { CSSProperties } from 'react'

export default function ValidationReasonPill({ reason }: { reason: string }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' } as CSSProperties}>
      <span style={{ fontSize: '0.62rem', color: '#475569', flexShrink: 0, marginTop: 2 }}>\u00b7</span>
      <span style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.45 }}>{reason}</span>
    </div>
  )
}
