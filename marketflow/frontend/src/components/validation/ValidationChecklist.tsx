import type { CSSProperties } from 'react'

interface Props {
  items:    string[]
  maxShow?: number
}

export default function ValidationChecklist({ items, maxShow = 3 }: Props) {
  const visible = items.slice(0, maxShow)
  const hidden  = items.length - visible.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 } as CSSProperties}>
      {visible.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
          <span style={{ fontSize: '0.63rem', color: '#4b5563', flexShrink: 0, marginTop: 2 }}>\u25a1</span>
          <span style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.5 }}>{item}</span>
        </div>
      ))}
      {hidden > 0 && (
        <div style={{ fontSize: '0.63rem', color: '#374151', paddingLeft: 14 }}>
          +{hidden} more
        </div>
      )}
    </div>
  )
}
