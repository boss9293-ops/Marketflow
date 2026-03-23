import type { CSSProperties } from 'react'

export default function DigestVrImpactBox({ summary }: { summary: string }) {
  return (
    <div style={{
      padding: '0.75rem 0.9rem',
      background: 'rgba(129,140,248,0.04)',
      border: '1px solid rgba(129,140,248,0.15)',
      borderRadius: 10,
    } as CSSProperties}>
      <div style={{
        fontSize: '0.6rem', color: '#818cf8', fontWeight: 700,
        letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6,
      }}>
        VR Engine Relevance
      </div>
      <div style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.55 }}>
        {summary}
      </div>
    </div>
  )
}
