import type { CSSProperties } from 'react'
import type { ResearchResponse, TakeawaySentiment, ResearchRiskLevel } from '@/types/research'

const C = {
  bgCard:      'rgba(255,255,255,0.03)',
  border:      '1px solid rgba(255,255,255,0.08)',
  radiusSm:    12,
  textPrimary: '#f8fafc',
  textSub:     '#cbd5e1',
  textMuted:   '#94a3b8',
  textDim:     '#64748b',
  blue:        '#93c5fd',
  teal:        '#5eead4',
  amber:       '#fcd34d',
  rose:        '#fca5a5',
}

function card(extra?: CSSProperties): CSSProperties {
  return { background: C.bgCard, border: C.border, borderRadius: C.radiusSm, padding: '0.9rem 1rem', ...extra }
}

function sectionLabel(text: string) {
  return (
    <div style={{ fontSize: '0.7rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.13em', marginBottom: 8, fontWeight: 600 }}>
      {text}
    </div>
  )
}

function microLabel(text: string, color = C.textDim) {
  return <div style={{ fontSize: '0.68rem', color, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 8 }}>{text}</div>
}

const RISK_CFG: Record<ResearchRiskLevel, { color: string; bg: string; border: string }> = {
  Low:      { color: '#5eead4', bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.25)' },
  Moderate: { color: '#93c5fd', bg: 'rgba(147,197,253,0.08)', border: 'rgba(147,197,253,0.25)' },
  Elevated: { color: '#fcd34d', bg: 'rgba(252,211,77,0.08)',  border: 'rgba(252,211,77,0.25)' },
  High:     { color: '#fca5a5', bg: 'rgba(252,165,165,0.09)', border: 'rgba(252,165,165,0.28)' },
  Critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.09)',   border: 'rgba(239,68,68,0.3)' },
}

const RELIA_DOT: Record<string, string> = {
  high: '#5eead4', medium: '#fcd34d', low: '#fca5a5',
}

const SENTIMENT_CFG: Record<TakeawaySentiment, { color: string; bg: string }> = {
  bullish: { color: '#5eead4', bg: 'rgba(94,234,212,0.07)' },
  bearish: { color: '#fca5a5', bg: 'rgba(252,165,165,0.07)' },
  neutral: { color: '#94a3b8', bg: 'rgba(148,163,184,0.07)' },
  caution: { color: '#fcd34d', bg: 'rgba(252,211,77,0.07)' },
}

function BulletList({ items, accent }: { items: string[]; accent: string }) {
  if (!items.length) return <div style={{ fontSize: '0.84rem', color: C.textDim, fontStyle: 'italic' }}>None identified.</div>
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span style={{ color: accent, fontSize: '0.78rem', marginTop: 3, flexShrink: 0 }}>•</span>
          <span style={{ fontSize: '0.88rem', color: C.textSub, lineHeight: 1.55 }}>{item}</span>
        </div>
      ))}
    </div>
  )
}

export default function ResearchSummaryPanel({ result }: { result: ResearchResponse }) {
  const riskCfg   = RISK_CFG[result.risk_level] ?? RISK_CFG.Moderate
  const topSources = [...result.sources]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 } as CSSProperties}>

      {/* Summary card */}
      <div style={{ ...card(), borderColor: 'rgba(147,197,253,0.15)', background: 'rgba(147,197,253,0.04)', borderLeft: '3px solid rgba(147,197,253,0.4)' }}>
        {sectionLabel('Research Summary')}
        <p style={{ fontSize: '0.97rem', color: C.textPrimary, margin: 0, lineHeight: 1.7, fontWeight: 500 }}>
          {result.summary}
        </p>
        {/* Top-source linkage row */}
        {topSources.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.62rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, flexShrink: 0 }}>
              Top sources
            </span>
            {topSources.map(s => (
              <span
                key={s.id}
                title={s.relevance_reason ?? s.excerpt ?? s.title}
                style={{
                  fontSize: '0.68rem', color: C.textMuted, cursor: s.relevance_reason ? 'help' : 'default',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: '1px 9px', borderRadius: 99,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {s.reliability && (
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: RELIA_DOT[s.reliability] ?? C.textDim, display: 'inline-block', flexShrink: 0 }} />
                )}
                {s.source_name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Risk level row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...card({ padding: '0.65rem 1rem', flex: '0 0 auto' }) }}>
          <div style={{ fontSize: '0.65rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 600 }}>
            Risk Assessment
          </div>
          <span style={{
            fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.06em',
            color: riskCfg.color, background: riskCfg.bg,
            border: `1px solid ${riskCfg.border}`,
            padding: '3px 12px', borderRadius: 99,
          }}>
            {result.risk_level}
          </span>
        </div>
        {result.risk_rationale && (
          <div style={{ ...card({ flex: '1 1 220px' }) }}>
            <div style={{ fontSize: '0.65rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5, fontWeight: 600 }}>
              Rationale
            </div>
            <p style={{ fontSize: '0.86rem', color: C.textSub, margin: 0, lineHeight: 1.6 }}>
              {result.risk_rationale}
            </p>
          </div>
        )}
      </div>

      {/* Key Takeaways */}
      {result.key_takeaways.length > 0 && (
        <div style={card()}>
          {sectionLabel('Key Takeaways')}
          <div style={{ display: 'grid', gap: 8 }}>
            {result.key_takeaways.map((t, i) => {
              const scfg = SENTIMENT_CFG[t.sentiment]
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, flexShrink: 0, marginTop: 3,
                    color: scfg.color, background: scfg.bg,
                    border: `1px solid ${scfg.color}30`,
                    padding: '1px 6px', borderRadius: 99,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {t.sentiment}
                  </span>
                  <span style={{ fontSize: '0.88rem', color: C.textSub, lineHeight: 1.55 }}>{t.text}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Evidence + Contradictions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={card()}>
          {sectionLabel('Evidence')}
          {microLabel('Signals supporting the research assessment', 'rgba(94,234,212,0.6)')}
          <BulletList items={result.evidence} accent={C.teal} />
        </div>
        <div style={{ ...card(), border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.04)' }}>
          {sectionLabel('Contradictions')}
          {microLabel('Counter-signals or limiting factors', 'rgba(252,211,77,0.65)')}
          <BulletList items={result.contradictions} accent={C.amber} />
        </div>
      </div>
    </div>
  )
}
