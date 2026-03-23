import type { CSSProperties } from 'react'

const C = {
  bgCard:   'rgba(255,255,255,0.03)',
  border:   '1px solid rgba(255,255,255,0.08)',
  radiusSm: 12,
  textDim:  '#64748b',
  textMuted:'#94a3b8',
}

function card(extra?: CSSProperties): CSSProperties {
  return { background: C.bgCard, border: C.border, borderRadius: C.radiusSm, ...extra }
}

export default function ResearchLoadingState({ query }: { query: string }) {
  return (
    <div style={card({ padding: '2.5rem 2rem', textAlign: 'center' })}>
      <style>{`
        @keyframes rPulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
        .r-dot{width:9px;height:9px;border-radius:50%;background:rgba(148,163,184,.6);display:inline-block;
          animation:rPulse 1.3s ease-in-out infinite;margin:0 3px}
        .r-dot:nth-child(2){animation-delay:.18s}.r-dot:nth-child(3){animation-delay:.36s}
      `}</style>
      <div style={{ marginBottom: 18 }}>
        <span className="r-dot" /><span className="r-dot" /><span className="r-dot" />
      </div>
      <div style={{ fontSize: '0.88rem', color: C.textMuted, letterSpacing: '0.03em', marginBottom: 6 }}>
        Researching
      </div>
      {query && (
        <div style={{
          fontSize: '0.8rem', color: C.textDim, fontStyle: 'italic',
          maxWidth: 440, margin: '0 auto', lineHeight: 1.5,
        }}>
          &ldquo;{query.length > 80 ? query.slice(0, 80) + '…' : query}&rdquo;
        </div>
      )}
      <div style={{ fontSize: '0.73rem', color: C.textDim, marginTop: 16 }}>
        Retrieving sources · synthesizing analysis · mapping to engine context…
      </div>
    </div>
  )
}
