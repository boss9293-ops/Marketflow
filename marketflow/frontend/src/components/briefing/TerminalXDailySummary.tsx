'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { AiBriefingV2, AiBriefingV2Section } from '@/components/briefing/AIBriefingV2'
import DataPlaceholder from '@/components/DataPlaceholder'

type Props = {
  data: AiBriefingV2
  lang?: 'ko' | 'en'
}

const SECTION_DISPLAY: Record<string, { ko: string; en: string }> = {
  top_themes_today: { ko: '오늘의 테마', en: 'Top Themes Today' },
  market_narrative: { ko: '시장 내러티브', en: 'Market Narrative' },
  supporting_highlights: { ko: '보조 하이라이트', en: 'Supporting Highlights' },
  market_indices: { ko: '주요 지수 실적', en: 'Major Indices' },
  sector_performance: { ko: '섹터 수익률', en: 'Sector Performance' },
  commodities_bonds: { ko: '원자재·채권', en: 'Commodities & Bonds' },
  stock_highlights: { ko: '주요 종목·이슈', en: 'Stock Highlights' },
  major_events: { ko: '주요 이벤트', en: 'Major Events' },
  macro_fed: { ko: '매크로·연준', en: 'Macro & Fed' },
  market_positioning: { ko: '시장 포지셔닝', en: 'Market Positioning' },
  market_structure: { ko: '시장 구조', en: 'Market Structure' },
  sector_flow: { ko: '섹터 플로우', en: 'Sector Flow' },
  risk_radar: { ko: '리스크 레이더', en: 'Risk Radar' },
  watch_signals: { ko: '주목 신호', en: 'Watch Signals' },
}

const SIGNAL_COLOR: Record<string, string> = {
  bull: '#22c55e',
  caution: '#f59e0b',
  bear: '#ef4444',
  neutral: '#64748b',
}

const UI_FONT_STACK = `var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)`

const UI_TEXT_BASE: CSSProperties = {
  fontFamily: UI_FONT_STACK,
  fontWeight: 400,
}

const CARD_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(7,9,13,0.96) 0%, rgba(5,7,10,0.98) 100%)',
  border: '1px solid rgba(148,163,184,0.08)',
  borderRadius: 10,
  boxShadow: 'none',
}

const INNER_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.015)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 10,
}

const MONO: CSSProperties = {
  fontFamily: `var(--font-terminal-mono, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)`,
}

function pickText(section: AiBriefingV2Section, lang: 'ko' | 'en', field: 'title' | 'body'): string {
  const koKey = `${field}_ko` as keyof AiBriefingV2Section
  const enKey = `${field}_en` as keyof AiBriefingV2Section
  const primary = lang === 'ko' ? section[koKey] : section[enKey]
  const fallback = lang === 'ko' ? section[enKey] : section[koKey]
  return (primary as string) || (fallback as string) || ''
}

function formatDate(value?: string): string {
  if (!value) return ''
  return value.includes('T') ? value.slice(0, 10) : value
}

function getSectionTitle(section: AiBriefingV2Section, lang: 'ko' | 'en'): string {
  const display = SECTION_DISPLAY[section.id ?? '']
  if (display) return lang === 'ko' ? display.ko : display.en
  const title = pickText(section, lang, 'title')
  return title || section.id || ''
}

function signalColor(signal?: string | null): string {
  if (!signal) return '#64748b'
  return SIGNAL_COLOR[signal] || '#64748b'
}

function isBulletLine(line: string): boolean {
  return /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)
}

function stripBulletMarker(line: string): string {
  return line
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .trim()
}

type RenderLine = {
  kind: 'bullet' | 'text'
  text: string
}

function buildCompactSectionLines(section: AiBriefingV2Section, lang: 'ko' | 'en'): RenderLine[] | null {
  const raw = pickText(section, lang, 'body')
  if (!raw.trim()) return null

  const segments = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (segments.length === 0) return null

  const lines: RenderLine[] = []

  for (const segment of segments) {
    if (isBulletLine(segment)) {
      lines.push({ kind: 'bullet', text: stripBulletMarker(segment) })
      continue
    }

    lines.push({ kind: 'text', text: segment })
  }

  return lines.length > 0 ? lines : null
}

function SectionBody({ lines }: { lines: RenderLine[] }) {
  return (
    <div style={{ marginLeft: 22, borderLeft: '1px solid rgba(148,163,184,0.12)', paddingLeft: 8, marginBottom: 8 }}>
      {lines.map((line, lineIdx) => {
        if (line.kind === 'bullet') {
          return (
            <div
              key={`line-${lineIdx}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '10px minmax(0,1fr)',
                gap: 7,
                alignItems: 'start',
                color: '#dbe7f8',
                fontSize: '0.94rem',
                lineHeight: 1.55,
                marginBottom: 1,
                fontWeight: 500,
              }}
            >
              <span style={{ color: '#8ddcff', fontWeight: 900 }}>-</span>
              <span>{line.text}</span>
            </div>
          )
        }

        return (
            <div
            key={`line-${lineIdx}`}
            style={{
              color: '#cbd5e1',
              fontSize: '0.94rem',
              lineHeight: 1.58,
              marginTop: lineIdx === 0 ? 0 : 4,
              whiteSpace: 'pre-wrap',
            }}
          >
            {line.text}
          </div>
        )
      })}
    </div>
  )
}

function TapeRow({ item }: { item: { symbol?: string | null; last?: number | null; chg_pct?: number | null } }) {
  const symbol = item.symbol || '--'
  const pct = item.chg_pct ?? null
  const pctLabel = typeof pct === 'number' && !Number.isNaN(pct) ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '--'
  const fill = typeof pct !== 'number' || Number.isNaN(pct) ? 'rgba(100,116,139,0.18)' : pct >= 0 ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)'
  const priceColor = typeof pct !== 'number' || Number.isNaN(pct) ? '#758199' : pct >= 0 ? '#22c55e' : '#ef4444'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 80px 84px',
        alignItems: 'stretch',
        minHeight: 38,
        borderTop: '1px solid rgba(148,163,184,0.12)',
      }}
    >
      <div style={{ padding: '0.5rem 0.7rem', borderRight: '1px solid rgba(148,163,184,0.10)', display: 'flex', alignItems: 'center' }}>
        <span style={{ ...MONO, color: '#8ddcff', fontSize: '0.8rem', fontWeight: 900, letterSpacing: '0.04em' }}>{symbol}</span>
      </div>
      <div
        style={{
          background: fill,
          color: '#08111f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.72rem',
          fontWeight: 900,
          letterSpacing: '0.02em',
          borderRight: '1px solid rgba(148,163,184,0.10)',
          ...MONO,
        }}
      >
        {pctLabel}
      </div>
      <div
        style={{
          padding: '0.5rem 0.7rem',
          textAlign: 'right',
          color: priceColor,
          fontSize: '0.76rem',
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          ...MONO,
        }}
      >
        {typeof item.last === 'number' && !Number.isNaN(item.last) ? item.last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
      </div>
    </div>
  )
}

function TapeGroupHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        padding: '0.5rem 0.7rem',
        borderTop: '1px solid rgba(148,163,184,0.12)',
        background: 'rgba(255,255,255,0.012)',
      }}
    >
      <span style={{ ...MONO, color: '#f8fbff', fontSize: '0.68rem', letterSpacing: '0.08em', fontWeight: 900 }}>{title}</span>
    </div>
  )
}

function TerminalIndexRail({ tape }: { tape: { data_date?: string | null; items?: { symbol?: string | null; last?: number | null; chg_pct?: number | null }[] | null } }) {
  const items = Array.isArray(tape.items) ? tape.items : []
  const bySymbol = new Map(items.map((item) => [item.symbol || '', item]))

  const pick = (symbols: string[]) => symbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean) as Array<{ symbol?: string | null; last?: number | null; chg_pct?: number | null }>

  const usMarketSymbols = ['ES=F', 'NQ=F', 'YM=F', 'VIX', 'DXY', 'BTCUSD', 'SPY', 'QQQ', 'DIA', 'IWM']
  const watchlistSymbols = ['AAPL', 'NVDA', 'TSLA', 'GOOGL', 'NFLX', 'MSFT', 'AMZN', 'META']
  const usMarkets = pick(usMarketSymbols)
  const watchlist = pick(watchlistSymbols)
  const usSet = new Set(usMarketSymbols)
  const watchSet = new Set(watchlistSymbols)
  const mostActive = items.filter((item) => {
    const symbol = item.symbol || ''
    return !usSet.has(symbol) && !watchSet.has(symbol)
  })

  const groups = [
    { title: 'US Markets', items: usMarkets },
    { title: 'Most Active', items: mostActive },
    { title: 'Watchlist', items: watchlist },
  ].filter((group) => group.items.length > 0)

  const hasAny = items.length > 0

  return (
    <aside
      style={{
        ...CARD_STYLE,
        position: 'sticky',
        top: '1rem',
        maxHeight: 'calc(100vh - 2rem)',
        overflowY: 'auto',
        width: '100%',
        maxWidth: 340,
        borderRadius: 0,
        boxShadow: 'none',
        background: 'linear-gradient(180deg, rgba(10,11,16,0.99) 0%, rgba(7,8,12,0.99) 100%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.8rem 0.9rem',
          borderBottom: '1px solid rgba(148,163,184,0.12)',
          background: 'rgba(255,255,255,0.015)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 10px #22d3ee88' }} />
          <span style={{ ...MONO, color: '#22d3ee', fontSize: '0.62rem', letterSpacing: '0.22em', fontWeight: 800, textTransform: 'uppercase' }}>
            WATCHLIST &gt;
          </span>
        </div>
        <span style={{ ...MONO, color: '#334155', fontSize: '0.6rem', letterSpacing: '0.1em' }}>{tape.data_date || '--'}</span>
      </div>

      {!hasAny ? (
        <div style={{ padding: '1rem 0.9rem' }}>
          <div style={{ ...MONO, color: '#475569', fontSize: '0.72rem', letterSpacing: '0.06em', marginBottom: 10 }}>no tape data</div>
          <DataPlaceholder reason="market tape unavailable" cacheFile="cache/market_tape.json" script="python backend/scripts/build_market_tape.py" />
        </div>
      ) : (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 80px 84px',
              borderBottom: '1px solid rgba(148,163,184,0.14)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div style={{ ...MONO, padding: '0.45rem 0.7rem', color: '#3d4d66', fontSize: '0.6rem', letterSpacing: '0.14em', borderRight: '1px solid rgba(148,163,184,0.10)' }}>
              Ticker
            </div>
            <div style={{ ...MONO, padding: '0.45rem 0.4rem', color: '#3d4d66', fontSize: '0.6rem', letterSpacing: '0.14em', textAlign: 'center', borderRight: '1px solid rgba(148,163,184,0.10)' }}>
              % 1D
            </div>
            <div style={{ ...MONO, padding: '0.45rem 0.7rem', color: '#3d4d66', fontSize: '0.6rem', letterSpacing: '0.14em', textAlign: 'right' }}>
              Price
            </div>
          </div>

          {groups.map((group) => (
            <div key={group.title}>
              <TapeGroupHeader title={group.title} />
              {group.items.map((item, index) => (
                <TapeRow key={`${group.title}-${item.symbol || index}`} item={item} />
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

function SectionLabel({ text, accent }: { text: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: accent || '#22d3ee', boxShadow: `0 0 14px ${accent || '#22d3ee'}88` }} />
      <span style={{ color: '#7f8aa4', fontSize: '0.68rem', letterSpacing: '0.16em', fontWeight: 700, textTransform: 'uppercase' }}>{text}</span>
    </div>
  )
}

function BriefingBulletRow({ bullet }: { bullet: { label?: string | null; text?: string | null; evidence?: string[] } }) {
  return (
    <div style={{ ...INNER_STYLE, padding: '0.72rem 0.8rem', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ color: '#7dd3fc', fontSize: '0.68rem', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 800 }}>
        {bullet.label?.trim() || 'NOTE'}
      </div>
      <div style={{ color: '#e2e8f0', fontSize: '0.85rem', lineHeight: 1.65, marginTop: 6 }}>{bullet.text || <DataPlaceholder reason="daily briefing unavailable" cacheFile="cache/daily_briefing.json" script="python backend/scripts/build_daily_briefing.py" />}</div>
      {Array.isArray(bullet.evidence) && bullet.evidence.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {bullet.evidence.slice(0, 3).map((item, index) => (
            <span
              key={`${item}-${index}`}
              style={{
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#a8b2c8',
                padding: '2px 8px',
                fontSize: '0.62rem',
              }}
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TerminalXDailySummary({ data, lang = 'ko' }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const sections = Array.isArray(data.sections) ? data.sections : []
  const dateStr = formatDate(data.data_date)
  const model = (data.model || data.provider || 'AI').toUpperCase()
  const cost = data.tokens?.cost_usd
  const isLoading = status === 'loading'

  async function handleGenerate() {
    setStatus('loading')
    setErrMsg(null)
    const t0 = Date.now()

    try {
      const res = await fetch('/api/briefing/v2/generate', { method: 'POST' })
      const json = await res.json().catch(() => ({ ok: false, error: 'flask unavailable' }))
      const sec = Math.round((Date.now() - t0) / 100) / 10
      setElapsed(sec)

      if (!res.ok || !json.ok) {
        setStatus('error')
        setErrMsg(json.error ?? 'Unknown error')
        return
      }

      setStatus('done')
      router.refresh()
    } catch (error: unknown) {
      const sec = Math.round((Date.now() - t0) / 100) / 10
      setElapsed(sec)
      setStatus('error')
      setErrMsg(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div
      style={{
        ...UI_TEXT_BASE,
        borderRadius: 10,
        border: '1px solid rgba(148,163,184,0.08)',
        background: 'linear-gradient(180deg, rgba(7,9,13,0.96) 0%, rgba(5,7,10,0.98) 100%)',
        boxShadow: 'none',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0.55rem 0.9rem',
          borderBottom: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(255,255,255,0.012)',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {dateStr && <span style={{ color: '#64748b', fontSize: '0.62rem', letterSpacing: '0.12em' }}>{dateStr}</span>}
          <span style={{ ...MONO, background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.18)', color: '#22d3ee', fontSize: '0.56rem', letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>
            {model}
          </span>
          {typeof cost === 'number' && cost > 0 && (
            <span style={{ ...MONO, color: '#475569', fontSize: '0.56rem', letterSpacing: '0.08em' }}>{cost < 0.001 ? `$${(cost * 1000).toFixed(2)}m` : `$${cost.toFixed(4)}`}</span>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading}
            style={{
              border: `1px solid ${status === 'error' ? 'rgba(239,68,68,0.45)' : 'rgba(34,211,238,0.22)'}`,
              background: isLoading ? 'rgba(34,211,238,0.05)' : 'rgba(34,211,238,0.08)',
              color: status === 'error' ? '#ef4444' : '#22d3ee',
              borderRadius: 6,
              fontSize: '0.58rem',
              letterSpacing: '0.1em',
              padding: '0.18rem 0.55rem',
              cursor: isLoading ? 'wait' : 'pointer',
              fontWeight: 700,
              transition: 'opacity 0.15s',
              opacity: isLoading ? 0.6 : 1,
              fontFamily: MONO.fontFamily,
            }}
          >
            {isLoading ? '생성 중...' : status === 'done' ? `완료 ${elapsed}s` : status === 'error' ? '오류' : 'AI 생성'}
          </button>
        </div>
      </div>

      {status === 'error' && errMsg && (
        <div style={{ padding: '0.4rem 0.9rem', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.16)', color: '#fca5a5', fontSize: '0.68rem', letterSpacing: '0.04em' }}>
          {errMsg}
        </div>
      )}

      {isLoading && (
        <div style={{ padding: '0.4rem 0.9rem', background: 'rgba(34,211,238,0.04)', borderBottom: '1px solid rgba(34,211,238,0.10)', color: '#7dd3fc', fontSize: '0.68rem', letterSpacing: '0.08em' }}>
          AI brief is generating...
        </div>
      )}

      <div style={{ padding: '0.95rem 1rem 1.05rem' }}>
        {sections.length === 0 ? (
          <div style={{ color: '#475569', fontSize: '0.76rem', letterSpacing: '0.08em' }}>
            No briefing sections available.
          </div>
        ) : (
          <>
            {sections.map((section, idx) => {
              const title = getSectionTitle(section, lang)
              const body = pickText(section, lang, 'body')
              const color = signalColor(section.signal)
              const sectionNo = String(idx + 1).padStart(2, '0')
              const isLast = idx === sections.length - 1
              const compactLines = buildCompactSectionLines(section, lang)
              const renderLines: RenderLine[] =
                compactLines ??
                (body.trim()
                  ? body
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line) => (isBulletLine(line) ? { kind: 'bullet' as const, text: stripBulletMarker(line) } : { kind: 'text' as const, text: line }))
                  : [])

              return (
                <div key={section.id || `sec-${idx}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ ...MONO, color: '#334155', fontSize: '0.56rem', fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0, minWidth: 16 }}>
                      {sectionNo}
                    </span>
                    <div style={{ width: 14, height: 1, background: `${color}44`, flexShrink: 0 }} />
                    <span style={{ color: '#d1ddf5', fontSize: '1.24rem', fontWeight: 700, letterSpacing: '-0.18px', lineHeight: 1.18, flexShrink: 0 }}>
                      {title}
                    </span>
                    <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.07)', minWidth: 10 }} />
                    {section.signal && (
                      <span
                        style={{
                          ...MONO,
                          fontSize: '0.54rem',
                          letterSpacing: '0.1em',
                          color,
                          border: `1px solid ${color}44`,
                          padding: '1px 6px',
                          borderRadius: 6,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        {section.signal}
                      </span>
                    )}
                  </div>

                  {renderLines.length > 0 && <SectionBody lines={renderLines} />}

                  {!compactLines && Array.isArray(section.tags) && section.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 22, marginBottom: isLast ? 0 : 12 }}>
                      {section.tags.map((tag, i) => (
                        <span
                          key={`${tag}-${i}`}
                          style={{
                            color: '#3d4d66',
                            fontSize: '0.56rem',
                            letterSpacing: '0.08em',
                            border: '1px solid rgba(61,77,102,0.5)',
                            padding: '1px 6px',
                            borderRadius: 2,
                            fontWeight: 600,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {!isLast && <div style={{ height: 1, background: 'rgba(148,163,184,0.06)', margin: '2px 0 12px' }} />}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
