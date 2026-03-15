import { ReactNode } from 'react'

export default function ChartShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section
      style={{
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(15,20,30,0.92)',
        padding: '1rem 1rem 0.75rem',
      }}
    >
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ color: '#f8fafc', fontWeight: 700 }}>{title}</div>
        <div style={{ color: '#8ea1b9', fontSize: '0.8rem', marginTop: 4 }}>{subtitle}</div>
      </div>
      <div style={{ width: '100%', height: 300 }}>{children}</div>
    </section>
  )
}

