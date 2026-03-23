import type { CSSProperties } from 'react'

export default function EmptyDailyDigest() {
  return (
    <div style={{
      padding: '1.2rem 0.5rem',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center',
    } as CSSProperties}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>
        No elevated daily research priorities
      </div>
      <div style={{ fontSize: '0.73rem', color: '#374151', lineHeight: 1.55, maxWidth: 320 }}>
        Monitored topics will surface here when changes are detected.
        Refresh monitored topics in Research Workspace to check for updates.
      </div>
      <a
        href="/research"
        style={{
          marginTop: 4, fontSize: '0.72rem', fontWeight: 600,
          color: '#818cf8', textDecoration: 'none',
          padding: '0.3rem 0.85rem',
          background: 'rgba(129,140,248,0.07)',
          border: '1px solid rgba(129,140,248,0.22)',
          borderRadius: 8,
        } as CSSProperties}
      >
        Open Research Desk \u2192
      </a>
    </div>
  )
}
