import type { CSSProperties } from 'react'

const LINKS = [
  { label: 'VR Survival', href: '/vr-survival', color: '#818cf8' },
  { label: 'Research',    href: '/research',    color: '#a78bfa' },
  { label: 'Risk System', href: '/risk-v1',     color: '#5eead4' },
]

export default function PriorityLinkBar() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' } as CSSProperties}>
      <span style={{ fontSize: '0.58rem', color: '#374151', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
        Quick Access
      </span>
      {LINKS.map(l => (
        <a
          key={l.href}
          href={l.href}
          style={{ fontSize: '0.68rem', color: l.color, fontWeight: 600, textDecoration: 'none' } as CSSProperties}
        >
          {l.label} \u2192
        </a>
      ))}
    </div>
  )
}
