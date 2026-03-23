'use client'

import { useState, type CSSProperties } from 'react'
import type { ResearchSource, ResearchSourceType, ResearchSortKey, SourceReliability, SourceFreshness } from '@/types/research'
import { sortByReliability } from '@/lib/sourceRanking'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bgCard:   'rgba(255,255,255,0.03)',
  bgRow:    'rgba(255,255,255,0.022)',
  border:   '1px solid rgba(255,255,255,0.08)',
  radiusSm: 12,
  textDim:  '#64748b',
  textMuted:'#94a3b8',
  textSub:  '#cbd5e1',
  blue:     '#93c5fd',
  teal:     '#5eead4',
  amber:    '#fcd34d',
  rose:     '#fca5a5',
  slate:    '#94a3b8',
}

const TYPE_CFG: Record<ResearchSourceType, { label: string; color: string }> = {
  article:  { label: 'Article',  color: '#93c5fd' },
  report:   { label: 'Report',   color: '#86efac' },
  data:     { label: 'Data',     color: '#5eead4' },
  filing:   { label: 'Filing',   color: '#fcd34d' },
  analysis: { label: 'Analysis', color: '#c4b5fd' },
  news:     { label: 'News',     color: '#94a3b8' },
}

const RELIA_CFG: Record<SourceReliability, { label: string; color: string; bg: string; border: string }> = {
  high:   { label: 'High',   color: '#5eead4', bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.28)' },
  medium: { label: 'Med',    color: '#fcd34d', bg: 'rgba(252,211,77,0.07)',  border: 'rgba(252,211,77,0.25)' },
  low:    { label: 'Low',    color: '#fca5a5', bg: 'rgba(252,165,165,0.07)', border: 'rgba(252,165,165,0.25)' },
}

const FRESH_CFG: Record<SourceFreshness, { label: string; color: string }> = {
  current:    { label: '2026',       color: '#5eead4' },
  recent:     { label: '2025',       color: '#93c5fd' },
  dated:      { label: '2-3yr',      color: '#94a3b8' },
  historical: { label: 'Historical', color: '#475569' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function RelevanceBar({ value }: { value: number }) {
  const pct   = Math.round(value * 100)
  const color = pct >= 75 ? C.teal : pct >= 55 ? C.blue : C.slate
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 48, height: 4, borderRadius: 99, background: 'rgba(148,163,184,0.14)', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${pct}%`, background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: '0.73rem', color, fontWeight: 700, minWidth: 28 }}>{pct}%</span>
    </div>
  )
}

function Badge({ label, color, bg, border }: { label: string; color: string; bg?: string; border?: string }) {
  return (
    <span style={{
      fontSize: '0.63rem', fontWeight: 700, letterSpacing: '0.04em',
      color, background: bg ?? `${color}14`,
      border: `1px solid ${border ?? `${color}35`}`,
      padding: '1px 6px', borderRadius: 99, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function sortSources(sources: ResearchSource[], key: ResearchSortKey): ResearchSource[] {
  if (key === 'relevance')   return [...sources].sort((a, b) => b.relevance - a.relevance)
  if (key === 'reliability') return sortByReliability(sources)
  return [...sources].sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  })
}

const SORT_LABELS: Record<ResearchSortKey, string> = {
  relevance:   'Relevance',
  date:        'Recent',
  reliability: 'Reliability',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SourceTable({ sources }: { sources: ResearchSource[] }) {
  const [sortKey,  setSortKey]  = useState<ResearchSortKey>('relevance')
  const [expanded, setExpanded] = useState<string | null>(null)
  const sorted = sortSources(sources, sortKey)

  if (!sources.length) return (
    <div style={{ background: C.bgCard, border: C.border, borderRadius: C.radiusSm, padding: '1rem', fontSize: '0.84rem', color: C.textDim, fontStyle: 'italic' }}>
      No sources returned.
    </div>
  )

  return (
    <div style={{ background: C.bgCard, border: C.border, borderRadius: C.radiusSm, overflow: 'hidden' } as CSSProperties}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem 1rem', borderBottom: C.border }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: '0.7rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.13em', fontWeight: 600 }}>
            Sources
          </div>
          <span style={{ fontSize: '0.65rem', color: C.textDim, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', padding: '1px 7px', borderRadius: 99 }}>
            AI-identified · {sources.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {(Object.keys(SORT_LABELS) as ResearchSortKey[]).map(k => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              style={{
                fontSize: '0.68rem', fontWeight: 600,
                color:      sortKey === k ? C.blue : C.textDim,
                background: sortKey === k ? 'rgba(147,197,253,0.08)' : 'transparent',
                border:     `1px solid ${sortKey === k ? 'rgba(147,197,253,0.22)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 7, padding: '2px 8px', cursor: 'pointer',
              } as CSSProperties}
            >
              {SORT_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 156px 82px 84px 86px', padding: '0.4rem 1rem', borderBottom: C.border } as CSSProperties}>
        {['#', 'Title', 'Source', 'Type', 'Quality', 'Relevance'].map(h => (
          <div key={h} style={{ fontSize: '0.63rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      {sorted.map((src, i) => {
        const isOpen  = expanded === src.id
        const typeCfg = TYPE_CFG[src.type] ?? TYPE_CFG.article
        const reliaCfg = RELIA_CFG[src.reliability ?? 'medium']
        const freshCfg = FRESH_CFG[src.freshness ?? 'recent']
        const hasDetail = !!(src.relevance_reason || src.excerpt)
        return (
          <div key={src.id} style={{ borderBottom: i < sorted.length - 1 ? C.border : 'none', background: isOpen ? 'rgba(255,255,255,0.035)' : i % 2 === 1 ? C.bgRow : 'transparent' }}>
            <div
              onClick={() => hasDetail && setExpanded(isOpen ? null : src.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '26px 1fr 156px 82px 84px 86px',
                padding: '0.55rem 1rem', alignItems: 'center',
                cursor: hasDetail ? 'pointer' : 'default',
              } as CSSProperties}
            >
              {/* # */}
              <span style={{ fontSize: '0.68rem', color: C.textDim, fontWeight: 600 }}>{i + 1}</span>

              {/* Title */}
              <div style={{ paddingRight: 8, minWidth: 0 }}>
                <div style={{ fontSize: '0.83rem', color: C.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }} title={src.title}>
                  {src.title}
                </div>
                {hasDetail && (
                  <div style={{ fontSize: '0.62rem', color: C.textDim, marginTop: 1 }}>
                    {isOpen ? '▴ collapse' : '▾ details'}
                  </div>
                )}
              </div>

              {/* Source + category */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.77rem', color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }} title={src.source_name}>
                  {src.source_name}
                </div>
                {src.category && (
                  <div style={{ fontSize: '0.62rem', color: C.textDim, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {src.category}
                  </div>
                )}
              </div>

              {/* Type badge */}
              <Badge label={typeCfg.label} color={typeCfg.color} />

              {/* Quality: reliability + freshness stacked */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Badge label={`● ${reliaCfg.label}`} color={reliaCfg.color} bg={reliaCfg.bg} border={reliaCfg.border} />
                <span style={{ fontSize: '0.62rem', color: freshCfg.color, fontWeight: 600 }}>
                  {src.date ? src.date.slice(0, 4) : freshCfg.label}
                </span>
              </div>

              {/* Relevance bar */}
              <RelevanceBar value={src.relevance} />
            </div>

            {/* Expanded detail */}
            {isOpen && hasDetail && (
              <div style={{ padding: '0 1rem 0.75rem 2.6rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {src.relevance_reason && (
                  <div style={{ fontSize: '0.78rem', color: C.blue, lineHeight: 1.55 }}>
                    <span style={{ fontSize: '0.62rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginRight: 6 }}>
                      Why relevant:
                    </span>
                    {src.relevance_reason}
                  </div>
                )}
                {src.excerpt && (
                  <div style={{ fontSize: '0.79rem', color: C.textMuted, lineHeight: 1.6, fontStyle: 'italic', borderLeft: '2px solid rgba(255,255,255,0.09)', paddingLeft: 10 }}>
                    {src.excerpt}
                  </div>
                )}
                {src.tags && src.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {src.tags.map((tag, ti) => (
                      <span key={ti} style={{ fontSize: '0.62rem', color: C.textDim, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', padding: '1px 7px', borderRadius: 99 }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Footer */}
      <div style={{ padding: '0.45rem 1rem', borderTop: C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: '0.66rem', color: C.textDim, fontStyle: 'italic' }}>
          Sources are AI-identified references — not live-fetched. Verify against primary sources before use.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {([['high', C.teal], ['medium', C.amber], ['low', C.rose]] as [string, string][]).map(([label, color]) => (
            <span key={label} style={{ fontSize: '0.62rem', color, fontWeight: 600 }}>
              ● {label}
            </span>
          ))}
          <span style={{ fontSize: '0.62rem', color: C.textDim }}> reliability</span>
        </div>
      </div>
    </div>
  )
}
