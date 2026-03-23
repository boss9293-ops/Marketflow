import type { CSSProperties, ReactNode } from 'react'

interface Props {
  title:     string
  subtitle?: string
  children:  ReactNode
}

export default function DigestSection({ title, subtitle, children }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 } as CSSProperties}>
      <div>
        <div style={{
          fontSize: '0.63rem', color: '#64748b',
          textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700,
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: '0.68rem', color: '#374151', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
