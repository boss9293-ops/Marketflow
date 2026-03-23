import type { CSSProperties } from 'react'
import Link from 'next/link'

interface Props {
  count:       number
  warningCount: number
}

export default function MonitorWidgetHeader({ count, warningCount }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } as CSSProperties}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>
            Research Monitor
          </span>
          {warningCount > 0 && (
            <span style={{
              fontSize: '0.6rem', fontWeight: 800, color: '#fca5a5',
              background: 'rgba(252,165,165,0.1)', border: '1px solid rgba(252,165,165,0.3)',
              padding: '1px 6px', borderRadius: 99,
            } as CSSProperties}>
              {warningCount} need review
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 2 }}>
          {count} topic{count !== 1 ? 's' : ''} watched
        </div>
      </div>
      <Link
        href="/research"
        style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 600, textDecoration: 'none' }}
      >
        View all ↗
      </Link>
    </div>
  )
}
