'use client'

import { useState, type CSSProperties } from 'react'
import { TOPIC_PACKS } from '@/lib/topicPacks'

const C = {
  bg:      'rgba(255,255,255,0.03)',
  border:  '1px solid rgba(255,255,255,0.08)',
  radius:  12,
  textDim: '#64748b',
  textSub: '#94a3b8',
  blue:    '#93c5fd',
  teal:    '#5eead4',
}

export default function TopicPackSelector({ onQuerySelect }: { onQuerySelect: (q: string) => void }) {
  const [activePack, setActivePack] = useState<string | null>(null)
  const pack = TOPIC_PACKS.find(p => p.id === activePack)

  return (
    <div style={{ background: C.bg, border: C.border, borderRadius: C.radius, padding: '0.75rem 1rem' } as CSSProperties}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.65rem', color: C.textDim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', flexShrink: 0 }}>
          Topic Packs
        </span>
        {TOPIC_PACKS.map(p => {
          const isActive = activePack === p.id
          return (
            <button
              key={p.id}
              onClick={() => setActivePack(isActive ? null : p.id)}
              style={{
                fontSize: '0.73rem', fontWeight: isActive ? 700 : 500,
                color:      isActive ? C.blue : C.textSub,
                background: isActive ? 'rgba(147,197,253,0.1)' : 'rgba(255,255,255,0.04)',
                border:     `1px solid ${isActive ? 'rgba(147,197,253,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 99, padding: '3px 12px',
                cursor: 'pointer', transition: 'all 0.15s',
              } as CSSProperties}
            >
              {p.title}
            </button>
          )
        })}
      </div>

      {pack && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: '0.71rem', color: C.textDim, fontStyle: 'italic', marginBottom: 8 }}>
            {pack.description}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {pack.queries.map((q, i) => (
              <button
                key={i}
                onClick={() => { onQuerySelect(q); setActivePack(null) }}
                style={{
                  textAlign: 'left',
                  fontSize: '0.82rem', color: '#cbd5e1',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 8, padding: '0.45rem 0.75rem',
                  cursor: 'pointer', lineHeight: 1.45,
                  transition: 'all 0.12s',
                } as CSSProperties}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(147,197,253,0.07)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(147,197,253,0.2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.07)' }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
