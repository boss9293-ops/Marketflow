import type { CSSProperties } from 'react'

const C = {
  bgCard:   'rgba(255,255,255,0.02)',
  border:   '1px solid rgba(255,255,255,0.07)',
  radiusSm: 12,
  textDim:  '#64748b',
  textMuted:'#94a3b8',
  blue:     '#93c5fd',
}

const SUGGESTED = [
  'What is the current state of credit markets?',
  'How does Fed policy affect leveraged ETF positioning?',
  'Explain the current volatility regime and its drivers',
  'How does this market compare to the 2022 Fed tightening cycle?',
  'What are the key tail risks for TQQQ positions right now?',
]

export default function EmptyResearchState({ onQuery }: { onQuery: (q: string) => void }) {
  return (
    <div style={{
      background: C.bgCard, border: C.border, borderRadius: C.radiusSm,
      padding: '2rem 1.5rem',
    }}>
      <div style={{ fontSize: '0.7rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.13em', marginBottom: 14, fontWeight: 600 }}>
        Suggested Queries
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {SUGGESTED.map((q, i) => (
          <button
            key={i}
            onClick={() => onQuery(q)}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 9,
              padding: '0.6rem 0.9rem',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex', alignItems: 'flex-start', gap: 10,
              transition: 'all 0.15s',
            } as CSSProperties}
          >
            <span style={{ fontSize: '0.75rem', color: C.textDim, marginTop: 1, flexShrink: 0 }}>{i + 1}.</span>
            <span style={{ fontSize: '0.86rem', color: C.textMuted, lineHeight: 1.5 }}>{q}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 18, fontSize: '0.73rem', color: C.textDim, fontStyle: 'italic', lineHeight: 1.6 }}>
        Research summaries are AI-generated from publicly available market analysis. They do not constitute trading advice and should be validated against primary sources.
      </div>
    </div>
  )
}
