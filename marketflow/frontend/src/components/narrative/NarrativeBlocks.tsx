import type { CSSProperties, ReactNode } from 'react'

export type StructuredNarrative = {
  eyebrow?: string
  badge?: string
  symbol?: string
  title: string
  subThemes: string[]
  interpretation: string
  action: string
  tqqq: string
  accent?: string
}

type NarrativeBlockProps = {
  data: StructuredNarrative
  density?: 'normal' | 'compact'
}

const PORTFOLIO_CLASSIFICATIONS = ['Aligned', 'Overexposed', 'Fragile', 'Defensive'] as const

function pickText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') {
    return value.trim().replace(/\s+/g, ' ')
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim()
  }
  if (Array.isArray(value)) {
    return value.map((item) => pickText(item)).filter(Boolean).join(' ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.ko === 'string') return pickText(record.ko)
    if (typeof record.en === 'string') return pickText(record.en)
  }
  return ''
}

function pickList(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.flatMap((item) => pickList(item))
  }

  const text = pickText(value)
  if (!text) return []

  return text
    .replace(/[•·;]/g, '\n')
    .split(/\r?\n+/)
    .map((item) => item.trim().replace(/^[\-\*]\s*/, ''))
    .filter(Boolean)
}

function joinParagraph(...values: unknown[]): string {
  return values.map((value) => pickText(value)).filter(Boolean).join(' ')
}

function findClassification(text: string): string | undefined {
  return PORTFOLIO_CLASSIFICATIONS.find((label) => new RegExp(`\\b${label}\\b`, 'i').test(text))
}

function sectionText(section: unknown): string {
  if (!section || typeof section !== 'object') return ''
  const record = section as Record<string, unknown>
  return pickText(record.body_ko || record.body_en || record.body || record.title_ko || record.title_en || record.title)
}

function findSection(sections: unknown[], id: string): unknown | undefined {
  return sections.find((section) => {
    if (!section || typeof section !== 'object') return false
    return String((section as Record<string, unknown>).id || '') === id
  })
}

export function mapBriefingNarrative(raw: unknown): StructuredNarrative | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const directTitle = pickText(record.main_theme || record.mainTheme || record.summary || record.headline || record.title)
  const directSubThemes = pickList(record.sub_themes || record.subThemes || record.themes || record.key_points)
  const directInterpretation = pickText(record.interpretation || record.analysis || record.explanation || record.summary)
  const directAction = pickText(record.action || record.guidance || record.posture)
  const directTqqq = pickText(record.tqqq || record.leverage)

  if (directTitle || directSubThemes.length || directInterpretation || directAction || directTqqq) {
    return {
      eyebrow: 'AI BRIEFING',
      badge: 'MSS + Track',
      title: directTitle || 'Market Briefing',
      subThemes: directSubThemes,
      interpretation: directInterpretation || directTitle,
      action: directAction || directInterpretation || directTitle,
      tqqq: directTqqq || directAction || directInterpretation,
      accent: '#22d3ee',
    }
  }

  const sections = Array.isArray(record.sections) ? record.sections : []
  if (!sections.length) return null

  const marketStructure = findSection(sections, 'market_structure') || sections[0]
  const sectorFlow = findSection(sections, 'sector_flow') || sections[1]
  const riskRadar = findSection(sections, 'risk_radar') || sections[2]
  const watchSignals = findSection(sections, 'watch_signals') || sections[3]

  const title = sectionText(marketStructure) || 'Market Briefing'
  const subThemes = [sectionText(sectorFlow), sectionText(riskRadar), sectionText(watchSignals)].filter(Boolean)
  const interpretation = sectionText(marketStructure) || title
  const action = sectionText(watchSignals) || sectionText(riskRadar) || title
  const tqqq = sectionText(riskRadar) || sectionText(watchSignals) || title

  return {
    eyebrow: 'AI BRIEFING',
    badge: 'MSS + Track',
    title,
    subThemes,
    interpretation,
    action,
    tqqq,
    accent: '#22d3ee',
  }
}

export function mapWatchlistNarrative(raw: unknown, fallbackSymbol?: string): StructuredNarrative | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const symbol = pickText(record.symbol || record.ticker || fallbackSymbol)
  const title = pickText(record.summary || record.main_theme || record.mainTheme || record.headline || symbol || 'Watchlist Narrative')
  const context = pickText(record.context || record.market_context || record.marketContext)
  const significance = pickText(record.significance || record.classification || record.type || record.signal)
  const subThemes = pickList(record.sub_themes || record.subThemes || [context, significance])
  const interpretation = joinParagraph(context, significance) || title
  const action = pickText(record.action || record.guidance || record.next_step)
  const tqqq = pickText(record.tqqq || record.leverage || record.leverage_note)

  if (!title && !subThemes.length && !interpretation && !action && !tqqq) return null

  return {
    eyebrow: symbol ? 'WATCHLIST NARRATIVE' : 'WATCHLIST NARRATIVE',
    badge: symbol || fallbackSymbol || undefined,
    symbol: symbol || fallbackSymbol || undefined,
    title,
    subThemes,
    interpretation,
    action: action || interpretation || title,
    tqqq: tqqq || action || interpretation,
    accent: '#ff8c00',
  }
}

export function mapPortfolioNarrative(raw: unknown): StructuredNarrative | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const title = pickText(record.summary || record.main_theme || record.mainTheme || record.classification || 'Portfolio Narrative')
  const structure = pickText(record.structure || record.allocation || record.holdings_structure)
  const risk = pickText(record.risk || record.risk_concentration || record.concentration)
  const alignment = pickText(record.alignment || record.market_alignment || record.regime_alignment)
  const subThemes = pickList(record.sub_themes || record.subThemes || [structure, risk, alignment])
  const interpretation = joinParagraph(structure, alignment) || title
  const action = pickText(record.action || record.guidance || record.rebalance_action)
  const tqqq = pickText(record.tqqq || record.leverage || record.leverage_note)
  const badge = findClassification(joinParagraph(title, structure, risk, alignment, action, tqqq))

  if (!title && !subThemes.length && !interpretation && !action && !tqqq) return null

  return {
    eyebrow: 'PORTFOLIO NARRATIVE',
    badge,
    title,
    subThemes,
    interpretation,
    action: action || interpretation || title,
    tqqq: tqqq || action || interpretation,
    accent: '#38bdf8',
  }
}

function Block({
  label,
  first = false,
  children,
  dense,
}: {
  label: string
  first?: boolean
  children: ReactNode
  dense: boolean
}) {
  const labelStyle: CSSProperties = {
    color: '#7f8aa4',
    fontSize: dense ? '0.58rem' : '0.60rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    marginBottom: dense ? 5 : 6,
  }

  return (
    <section
      style={{
        display: 'grid',
        gap: dense ? 7 : 8,
        paddingTop: first ? 0 : dense ? 10 : 12,
        borderTop: first ? 'none' : '1px solid rgba(148,163,184,0.10)',
      }}
    >
      <div style={labelStyle}>{label}</div>
      {children}
    </section>
  )
}

export default function NarrativeBlocks({ data, density = 'normal' }: NarrativeBlockProps) {
  const dense = density === 'compact'
  const accent = data.accent || '#22d3ee'
  const titleSize = dense ? '0.98rem' : '1.08rem'
  const bodySize = dense ? '0.79rem' : '0.84rem'
  const lineHeight = dense ? 1.5 : 1.56

  return (
    <article
      style={{
        position: 'relative',
        borderRadius: 14,
        border: '1px solid rgba(148,163,184,0.12)',
        borderTop: `2px solid ${accent}`,
        background: 'linear-gradient(180deg, rgba(10,14,22,0.98) 0%, rgba(7,10,16,0.99) 100%)',
        padding: dense ? '0.9rem 1rem' : '1.05rem 1.1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: dense ? 10 : 12,
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -24,
          right: -18,
          width: 92,
          height: 92,
          borderRadius: '50%',
          background: `${accent}16`,
          filter: 'blur(24px)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {data.eyebrow && (
            <span
              style={{
                color: accent,
                fontSize: dense ? '0.60rem' : '0.62rem',
                fontWeight: 800,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              {data.eyebrow}
            </span>
          )}
          {data.symbol && (
            <span
              style={{
                borderRadius: 999,
                border: `1px solid ${accent}40`,
                background: `${accent}12`,
                color: accent,
                fontSize: dense ? '0.60rem' : '0.62rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                padding: '2px 8px',
                textTransform: 'uppercase',
              }}
            >
              {data.symbol}
            </span>
          )}
        </div>

        {data.badge && (
          <span
            style={{
              borderRadius: 999,
              border: '1px solid rgba(148,163,184,0.18)',
              background: 'rgba(148,163,184,0.08)',
              color: '#cbd5e1',
              fontSize: dense ? '0.60rem' : '0.62rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              padding: '2px 8px',
              textTransform: 'uppercase',
            }}
          >
            {data.badge}
          </span>
        )}
      </div>

      <Block label="MAIN THEME" first dense={dense}>
        <h3
          style={{
            margin: 0,
            color: '#f8fbff',
            fontSize: titleSize,
            lineHeight: 1.35,
            fontWeight: 800,
            wordBreak: 'keep-all',
          }}
        >
          {data.title}
        </h3>
      </Block>

      <Block label="SUB THEMES" dense={dense}>
        {data.subThemes.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: dense ? 5 : 6 }}>
            {data.subThemes.map((item, index) => (
              <li key={`${item}-${index}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: accent,
                    marginTop: 6,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    color: '#dbe5f3',
                    fontSize: bodySize,
                    lineHeight,
                    wordBreak: 'keep-all',
                  }}
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: '#90a3bb', fontSize: bodySize, lineHeight, wordBreak: 'keep-all' }}>No sub themes returned.</p>
        )}
      </Block>

      <Block label="INTERPRETATION" dense={dense}>
        <p style={{ margin: 0, color: '#dbe5f3', fontSize: bodySize, lineHeight, wordBreak: 'keep-all' }}>
          {data.interpretation || 'No interpretation returned.'}
        </p>
      </Block>

      <Block label="ACTION" dense={dense}>
        <p style={{ margin: 0, color: '#dbe5f3', fontSize: bodySize, lineHeight, wordBreak: 'keep-all' }}>
          {data.action || 'No action guidance returned.'}
        </p>
      </Block>

      <Block label="TQQQ" dense={dense}>
        <p style={{ margin: 0, color: '#dbe5f3', fontSize: bodySize, lineHeight, wordBreak: 'keep-all' }}>
          {data.tqqq || 'No TQQQ note returned.'}
        </p>
      </Block>
    </article>
  )
}
