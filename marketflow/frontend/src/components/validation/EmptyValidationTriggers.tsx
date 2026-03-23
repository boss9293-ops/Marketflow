import type { CSSProperties } from 'react'

export default function EmptyValidationTriggers() {
  return (
    <div style={{
      padding: '0.85rem 0.5rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
    } as CSSProperties}>
      <div>
        <div style={{ fontSize: '0.73rem', fontWeight: 600, color: '#475569' }}>
          No validation triggers surfaced
        </div>
        <div style={{ fontSize: '0.68rem', color: '#374151', marginTop: 3, lineHeight: 1.5 }}>
          Current monitor changes do not require elevated VR review beyond routine monitoring.
        </div>
      </div>
      <a
        href="/vr-survival"
        style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 600, textDecoration: 'none', flexShrink: 0 } as CSSProperties}
      >
        Open VR Survival \u2192
      </a>
    </div>
  )
}
