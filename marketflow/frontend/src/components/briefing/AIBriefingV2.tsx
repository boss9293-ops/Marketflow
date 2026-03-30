import type { CSSProperties } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
export type AiBriefingV2Section = {
  id: string
  title_ko?: string
  title_en?: string
  body_ko?: string
  body_en?: string
  signal?: 'bull' | 'caution' | 'bear' | 'neutral' | string
  tags?: string[]
  color?: string
}

export type AiBriefingV2 = {
  generated_at?: string
  data_date?: string
  provider?: string
  model?: string
  tokens?: {
    input?: number
    output?: number
    cost_usd?: number
  }
  sections?: AiBriefingV2Section[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SIGNAL_ICON: Record<string, string> = {
  bull:    '▲',
  caution: '◆',
  bear:    '▼',
  neutral: '●',
}

const SECTION_ORDER = ['market_structure', 'sector_flow', 'risk_radar', 'watch_signals']

function formatCost(cost?: number): string {
  if (typeof cost !== 'number') return ''
  if (cost < 0.001) return `$${(cost * 1000).toFixed(2)}m`
  return `$${cost.toFixed(4)}`
}

function formatDate(s?: string): string {
  if (!s) return ''
  // "9/9/2025" → show as-is; ISO → date portion
  if (s.includes('T')) return s.slice(0, 10)
  return s
}

function formatModel(provider?: string, model?: string): string {
  if (model) return model
  if (provider) return provider
  return 'AI'
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionCard({ sec }: { sec: AiBriefingV2Section }) {
  const color   = sec.color || '#64748b'
  const signal  = sec.signal || 'neutral'
  const icon    = SIGNAL_ICON[signal] || '●'
  const title   = sec.title_ko || sec.title_en || sec.id
  const body    = sec.body_ko  || sec.body_en  || ''
  const tags    = sec.tags || []

  const cardStyle: CSSProperties = {
    background: 'linear-gradient(160deg, rgba(16,18,26,0.97) 0%, rgba(10,12,20,0.99) 100%)',
    border: '1px solid rgba(148,163,184,0.10)',
    borderTop: `2px solid ${color}`,
    borderRadius: 14,
    padding: '1.1rem 1.2rem 0.95rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 148,
    boxShadow: `0 4px 24px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(255,255,255,0.03)`,
    position: 'relative',
    overflow: 'hidden',
  }

  const glowStyle: CSSProperties = {
    position: 'absolute',
    top: -30,
    left: -30,
    width: 100,
    height: 100,
    borderRadius: '50%',
    background: `${color}18`,
    filter: 'blur(28px)',
    pointerEvents: 'none',
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
  }

  const iconStyle: CSSProperties = {
    color,
    fontSize: '0.62rem',
    lineHeight: 1,
    fontWeight: 900,
  }

  const titleStyle: CSSProperties = {
    color: '#e2e8f0',
    fontSize: '0.72rem',
    fontWeight: 800,
    letterSpacing: '0.13em',
    textTransform: 'uppercase',
  }

  const bodyStyle: CSSProperties = {
    color: '#94a3b8',
    fontSize: '0.82rem',
    lineHeight: 1.65,
    flexGrow: 1,
    wordBreak: 'keep-all',
  }

  const tagsStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 2,
  }

  const tagStyle: CSSProperties = {
    background: `${color}18`,
    border: `1px solid ${color}44`,
    color,
    fontSize: '0.60rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '2px 7px',
    borderRadius: 20,
    textTransform: 'uppercase',
  }

  return (
    <div style={cardStyle}>
      <div style={glowStyle} />
      <div style={headerStyle}>
        <span style={iconStyle}>{icon}</span>
        <span style={titleStyle}>{title}</span>
      </div>
      <p style={bodyStyle}>{body}</p>
      {tags.length > 0 && (
        <div style={tagsStyle}>
          {tags.map((tag, i) => (
            <span key={i} style={tagStyle}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AIBriefingV2({ data }: { data: AiBriefingV2 }) {
  const sections = SECTION_ORDER.map(
    id => (data.sections || []).find(s => s.id === id)
  ).filter(Boolean) as AiBriefingV2Section[]

  if (sections.length === 0) return null

  const wrapStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  }

  const headerRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 2px',
  }

  const labelStyle: CSSProperties = {
    color: '#7f8aa4',
    fontSize: '0.60rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
  }

  const badgeStyle: CSSProperties = {
    background: 'rgba(34,211,238,0.10)',
    border: '1px solid rgba(34,211,238,0.28)',
    color: '#22d3ee',
    fontSize: '0.60rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '2px 8px',
    borderRadius: 20,
  }

  const dimBadgeStyle: CSSProperties = {
    ...badgeStyle,
    background: 'rgba(148,163,184,0.07)',
    border: '1px solid rgba(148,163,184,0.18)',
    color: '#64748b',
  }

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10,
  }

  const cost    = data.tokens?.cost_usd
  const model   = formatModel(data.provider, data.model)
  const dateStr = formatDate(data.data_date)

  return (
    <div style={wrapStyle}>
      {/* Header */}
      <div style={headerRowStyle}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 8px #22d3ee88' }} />
        <span style={labelStyle}>AI BRIEFING</span>
        <span style={badgeStyle}>{model}</span>
        {dateStr && <span style={dimBadgeStyle}>{dateStr}</span>}
        {cost !== undefined && <span style={dimBadgeStyle}>{formatCost(cost)}</span>}
      </div>

      {/* 2×2 grid */}
      <div style={gridStyle}>
        {sections.map(sec => (
          <SectionCard key={sec.id} sec={sec} />
        ))}
      </div>
    </div>
  )
}
