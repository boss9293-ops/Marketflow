import type { CSSProperties, ReactNode } from 'react'
import GeminiBriefingPanel from '@/components/briefing/GeminiBriefingPanel'
import DataPlaceholder from '@/components/DataPlaceholder'

type LangText =
  | string
  | number
  | { ko?: string | number | null; en?: string | number | null }
  | null
  | undefined

type StatePill = {
  value?: LangText
  label?: LangText
  color?: string | null
  detail?: LangText
}

export type MarketState = {
  data_date?: LangText
  phase?: StatePill | null
  gate?: (StatePill & { avg10d?: number | null; delta5d?: number | null }) | null
  risk?: (StatePill & { vol_pct?: number | null; var95?: number | null }) | null
  trend?: (StatePill & { pct_from_sma200?: number | null; qqq_close?: number | null; data_date?: string | null }) | null
}

export type HealthSnapshot = {
  breadth_greed?: { label?: LangText; greed_proxy?: number | null } | null
}

export type BriefingBullet = {
  label?: LangText
  text?: LangText
  evidence?: string[]
}

export type DailyBriefing = {
  data_date?: LangText
  headline?: LangText
  bullets?: BriefingBullet[] | { ko?: BriefingBullet[]; en?: BriefingBullet[] }
  stance?: { label?: LangText; action?: LangText; exposure_band?: LangText; why?: LangText }
}

export type TapeItem = {
  symbol?: string | null
  name?: string | null
  last?: number | null
  chg?: number | null
  chg_pct?: number | null
  spark_1d?: number[] | null
}

export type MarketTapeCache = {
  data_date?: string | null
  generated_at?: string | null
  items?: TapeItem[] | null
}

type Props = {
  briefing: DailyBriefing
  ms: MarketState
  health: HealthSnapshot
  tape: MarketTapeCache
}

const MISSING_BRIEFING = {
  reason: 'daily briefing unavailable',
  cacheFile: 'cache/daily_briefing.json',
  script: 'python backend/scripts/build_daily_briefing.py',
}

const MISSING_STATE = {
  reason: 'market state unavailable',
  cacheFile: 'cache/market_state.json',
  script: 'python backend/scripts/build_market_state.py',
}

const MISSING_TAPE = {
  reason: 'market tape unavailable',
  cacheFile: 'cache/market_tape.json',
  script: 'python backend/scripts/build_market_tape.py',
}

const CARD_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(16,18,24,0.96) 0%, rgba(10,12,18,0.98) 100%)',
  border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 16,
  boxShadow: '0 16px 36px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.03)',
}

const INNER_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 14,
}

const labelStyle: CSSProperties = {
  color: '#7f8aa4',
  fontSize: '0.68rem',
  letterSpacing: '0.16em',
  fontWeight: 700,
  textTransform: 'uppercase',
}

function pickText(value: LangText, prefer: 'en' | 'ko' = 'en'): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const primary = value?.[prefer]
    const secondary = value?.[prefer === 'en' ? 'ko' : 'en']
    if (typeof primary === 'string' || typeof primary === 'number') return String(primary)
    if (typeof secondary === 'string' || typeof secondary === 'number') return String(secondary)
  }
  return null
}

function pickBullets(value: DailyBriefing['bullets']): BriefingBullet[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    if (Array.isArray(value.en)) return value.en
    if (Array.isArray(value.ko)) return value.ko
  }
  return []
}

function fmtSigned(value?: number | null, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

function fmtPrice(value?: number | null, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function changeColor(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '#758199'
  return value >= 0 ? '#22c55e' : '#ef4444'
}

function SectionLabel({ text, accent }: { text: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: accent || '#22d3ee', boxShadow: `0 0 14px ${accent || '#22d3ee'}88` }} />
      <span style={labelStyle}>{text}</span>
    </div>
  )
}

function StatusChip({
  label,
  value,
  detail,
  color,
}: {
  label: string
  value?: ReactNode
  detail?: ReactNode
  color?: string | null
}) {
  const c = color || '#64748b'
  return (
    <div
      style={{
        ...INNER_STYLE,
        minWidth: 128,
        padding: '0.7rem 0.8rem',
        background: `${c}10`,
        borderColor: `${c}44`,
      }}
    >
      <div style={{ color: '#7f8aa4', fontSize: '0.58rem', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ color: c, fontWeight: 900, fontSize: '0.95rem', marginTop: 3, lineHeight: 1.1 }}>
        {value || <DataPlaceholder {...MISSING_STATE} />}
      </div>
      {detail && (
        <div style={{ color: '#94a3b8', fontSize: '0.68rem', marginTop: 4, lineHeight: 1.35 }}>
          {detail}
        </div>
      )}
    </div>
  )
}

function watchlistFill(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'rgba(100,116,139,0.18)'
  return value >= 0 ? 'rgba(34,197,94,0.92)' : 'rgba(249,115,22,0.92)'
}

function WatchlistRow({ item }: { item: TapeItem }) {
  const symbol = item.symbol || '--'
  const pct = item.chg_pct ?? null
  const pctLabel = typeof pct === 'number' && !Number.isNaN(pct) ? `${fmtSigned(pct)}%` : '--'
  const pctFill = watchlistFill(pct)
  const priceColor = changeColor(pct)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 88px 88px',
        alignItems: 'stretch',
        minHeight: 42,
        borderTop: '1px solid rgba(148,163,184,0.16)',
        background: 'rgba(255,255,255,0.012)',
      }}
    >
      <div style={{ padding: '0.6rem 0.75rem', minWidth: 0, borderRight: '1px solid rgba(148,163,184,0.14)', display: 'flex', alignItems: 'center' }}>
        <span style={{ color: '#8ddcff', fontSize: '0.84rem', fontWeight: 900, letterSpacing: '0.04em' }}>
          {symbol}
        </span>
      </div>
      <div
        style={{
          margin: 0,
          borderRadius: 0,
          background: pctFill,
          color: '#08111f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.74rem',
          fontWeight: 900,
          letterSpacing: '0.03em',
          borderRight: '1px solid rgba(148,163,184,0.14)',
        }}
      >
        {pctLabel}
      </div>
      <div
        style={{
          padding: '0.6rem 0.75rem',
          textAlign: 'right',
          color: priceColor,
          fontSize: '0.8rem',
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        {fmtPrice(item.last)}
      </div>
    </div>
  )
}

function WatchlistSectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0.65rem 0.75rem',
        borderTop: '1px solid rgba(148,163,184,0.16)',
        borderBottom: '1px solid rgba(148,163,184,0.16)',
        background: 'rgba(255,255,255,0.01)',
      }}
    >
      <span style={{ color: '#f8fbff', fontSize: '0.72rem', letterSpacing: '0.06em', fontWeight: 900 }}>
        {title}
      </span>
    </div>
  )
}

function TerminalIndexRail({ tape }: { tape: MarketTapeCache }) {
  const items = Array.isArray(tape.items) ? tape.items : []
  const indexSymbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX']
  const bySymbol = new Map(items.map((item) => [item.symbol || '', item]))
  const pick = (symbols: string[]) => symbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean) as TapeItem[]
  const indexItems = pick(indexSymbols)
  const activeItems = items.filter((item) => !indexSymbols.includes(item.symbol || ''))
  const groups = [
    { title: 'US Markets', items: indexItems },
    { title: 'Most Active', items: activeItems },
  ].filter((group) => group.items.length > 0)
  const hasAny = items.length > 0

  return (
    <aside
      style={{
        ...CARD_STYLE,
        padding: '0.85rem',
        position: 'sticky',
        top: '1rem',
        maxHeight: 'calc(100vh - 2rem)',
        overflowY: 'auto',
        width: '100%',
        maxWidth: 348,
        borderRadius: 0,
        boxShadow: 'none',
        background: 'linear-gradient(180deg, rgba(13,14,18,0.98) 0%, rgba(9,10,13,0.98) 100%)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#22d3ee', fontSize: '0.72rem', letterSpacing: '0.24em', fontWeight: 900 }}>
            WATCHLIST &gt;
          </div>
          <div style={{ color: '#7c879d', fontSize: '0.72rem', marginTop: 6, lineHeight: 1.4 }}>
            Vertical tape for the session
          </div>
        </div>
        <div style={{ color: '#64748b', fontSize: '0.64rem', letterSpacing: '0.14em', whiteSpace: 'nowrap' }}>
          {tape.data_date || <DataPlaceholder {...MISSING_TAPE} />}
        </div>
      </div>

      {!hasAny ? (
        <div style={{ color: '#94a3b8', fontSize: '0.78rem', padding: '0.35rem 0.1rem' }}>
          <DataPlaceholder {...MISSING_TAPE} />
        </div>
      ) : (
        <div
          style={{
            borderRadius: 0,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.015)',
            border: '1px solid rgba(148,163,184,0.16)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 88px 88px',
              alignItems: 'center',
              background: 'rgba(255,255,255,0.03)',
              borderBottom: '1px solid rgba(148,163,184,0.16)',
            }}
          >
            <div style={{ padding: '0.62rem 0.75rem', color: '#cbd5e1', fontSize: '0.67rem', letterSpacing: '0.12em', borderRight: '1px solid rgba(148,163,184,0.14)' }}>
              search ...
            </div>
            <div style={{ padding: '0.62rem 0.4rem', color: '#64748b', fontSize: '0.64rem', textAlign: 'center', borderRight: '1px solid rgba(148,163,184,0.14)' }}>
              --
            </div>
            <div style={{ padding: '0.62rem 0.75rem', color: '#64748b', fontSize: '0.64rem', textAlign: 'right' }}>
              --
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 88px 88px',
              alignItems: 'center',
              borderBottom: '1px solid rgba(148,163,184,0.16)',
              background: 'rgba(255,255,255,0.015)',
            }}
          >
            <div style={{ padding: '0.56rem 0.75rem', color: '#9fb0c9', fontSize: '0.64rem', letterSpacing: '0.14em', borderRight: '1px solid rgba(148,163,184,0.14)' }}>
              Ticker
            </div>
            <div style={{ padding: '0.56rem 0.4rem', color: '#9fb0c9', fontSize: '0.64rem', letterSpacing: '0.14em', textAlign: 'center', borderRight: '1px solid rgba(148,163,184,0.14)' }}>
              % 1D
            </div>
            <div style={{ padding: '0.56rem 0.75rem', color: '#9fb0c9', fontSize: '0.64rem', letterSpacing: '0.14em', textAlign: 'right' }}>
              Price
            </div>
          </div>

          {groups.map((group) => (
            <div key={group.title}>
              <WatchlistSectionHeader title={group.title} />
              {group.items.map((item, index) => (
                <WatchlistRow key={`${group.title}-${item.symbol || item.name || index}`} item={item} />
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

function BriefingBulletRow({ bullet }: { bullet: BriefingBullet }) {
  return (
    <div
      style={{
        ...INNER_STYLE,
        padding: '0.72rem 0.8rem',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ color: '#7dd3fc', fontSize: '0.68rem', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 800 }}>
        {pickText(bullet.label, 'en') || 'NOTE'}
      </div>
      <div style={{ color: '#e2e8f0', fontSize: '0.85rem', lineHeight: 1.65, marginTop: 6 }}>
        {pickText(bullet.text, 'en') || <DataPlaceholder {...MISSING_BRIEFING} />}
      </div>
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

export default function TerminalBriefingView({ briefing, ms, health, tape }: Props) {
  const bullets = pickBullets(briefing.bullets)
  const briefingNotes = bullets.slice(1)
  const stance = briefing.stance || {}
  const briefDate = pickText(briefing.data_date, 'en') || null
  const stateDate = pickText(ms.data_date, 'en') || null
  const tapeDate = tape.data_date || null
  const asofDay = tapeDate || stateDate || briefDate || null
  const briefHeadline = pickText(briefing.headline, 'en') || 'Daily briefing unavailable'
  const greedLabel = pickText(health.breadth_greed?.label, 'en') || null
  const greedVal = typeof health.breadth_greed?.greed_proxy === 'number'
    ? `${health.breadth_greed.greed_proxy.toFixed(0)}`
    : null
  const updatedAt = tape.generated_at ? new Date(tape.generated_at).toLocaleString('en-US', { hour12: false }) : null
  const statusChips = [
    { label: 'PHASE', value: pickText(ms.phase?.label, 'en'), detail: pickText(ms.phase?.detail, 'en'), color: ms.phase?.color },
    { label: 'GATE', value: pickText(ms.gate?.label, 'en'), detail: pickText(ms.gate?.detail, 'en'), color: ms.gate?.color },
    { label: 'RISK', value: pickText(ms.risk?.label, 'en'), detail: pickText(ms.risk?.detail, 'en'), color: ms.risk?.color },
    { label: 'TREND', value: pickText(ms.trend?.label, 'en'), detail: pickText(ms.trend?.detail, 'en'), color: ms.trend?.color },
    { label: 'BREADTH', value: greedLabel, detail: greedVal ? `Greed ${greedVal}` : null, color: '#22c55e' },
    { label: 'GREED', value: greedVal, detail: greedLabel ? `Label ${greedLabel}` : null, color: '#f59e0b' },
  ]

  return (
    <div
      style={{
        minHeight: '100%',
        padding: '1.2rem 1.25rem 2rem',
        background: 'radial-gradient(circle at top left, rgba(34,211,238,0.08), transparent 28%), radial-gradient(circle at top right, rgba(245,158,11,0.08), transparent 22%), linear-gradient(180deg, #07090e 0%, #090b11 100%)',
        color: '#e5eefb',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header
          style={{
            ...CARD_STYLE,
            padding: '1rem 1.05rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#22d3ee', fontSize: '0.72rem', letterSpacing: '0.28em', textTransform: 'uppercase', fontWeight: 800 }}>
                BRIEFING / TERMINAL MODE
              </div>
              <h1 style={{ margin: '0.45rem 0 0', fontSize: '2rem', lineHeight: 1, fontWeight: 900, color: '#f8fbff' }}>
                Daily <span style={{ color: '#22d3ee' }}>Briefing</span>
              </h1>
              <div style={{ color: '#7c879d', fontSize: '0.86rem', marginTop: 8, lineHeight: 1.55 }}>
                Left side for the daily summary. Right side for the session tape.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ ...INNER_STYLE, padding: '0.42rem 0.6rem', color: '#22d3ee', borderColor: 'rgba(34,211,238,0.3)', fontSize: '0.68rem' }}>
                  BRIEF {briefDate || '--'}
                </span>
                <span style={{ ...INNER_STYLE, padding: '0.42rem 0.6rem', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.3)', fontSize: '0.68rem' }}>
                  STATE {stateDate || '--'}
                </span>
                <span style={{ ...INNER_STYLE, padding: '0.42rem 0.6rem', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)', fontSize: '0.68rem' }}>
                  TAPE {tapeDate || '--'}
                </span>
                {updatedAt && (
                  <span style={{ ...INNER_STYLE, padding: '0.42rem 0.6rem', color: '#94a3b8', borderColor: 'rgba(148,163,184,0.25)', fontSize: '0.68rem' }}>
                    UPDATED {updatedAt}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_348px] gap-6 items-start">
          <main style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <section style={{ ...CARD_STYLE, padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <SectionLabel text="SUMMARY STACK" accent="#22d3ee" />
                <div style={{ color: '#64748b', fontSize: '0.68rem', letterSpacing: '0.12em' }}>
                  SESSION VIEW
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,320px)] gap-3 mt-3">
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ color: '#7c879d', fontSize: '0.72rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 800 }}>
                      TODAY
                    </div>
                    <div style={{ marginTop: 8, color: '#f8fbff', fontSize: '1.1rem', lineHeight: 1.45, fontWeight: 900 }}>
                      {briefHeadline}
                    </div>
                    <div style={{ marginTop: 8, color: '#8b94a8', fontSize: '0.82rem', lineHeight: 1.6 }}>
                      Terminal-style summary with the AI brief underneath.
                    </div>
                  </div>

                  <div style={{ ...INNER_STYLE, padding: '0.82rem 0.88rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                      <SectionLabel text="AI BRIEF" accent="#f59e0b" />
                      <span style={{ color: '#64748b', fontSize: '0.66rem', letterSpacing: '0.14em' }}>
                        {asofDay || <DataPlaceholder {...MISSING_BRIEFING} />}
                      </span>
                    </div>
                    <GeminiBriefingPanel asofDay={asofDay} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                      <SectionLabel text="BRIEFING NOTES" accent="#7dd3fc" />
                      <span style={{ color: '#64748b', fontSize: '0.66rem', letterSpacing: '0.14em' }}>
                        {briefingNotes.length} ITEMS
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {briefingNotes.length > 0 ? (
                        briefingNotes.map((bullet, index) => (
                          <BriefingBulletRow key={`${pickText(bullet.label, 'en') || 'note'}-${index}`} bullet={bullet} />
                        ))
                      ) : (
                        <div style={{ ...INNER_STYLE, padding: '0.9rem', color: '#94a3b8', fontSize: '0.82rem' }}>
                          <DataPlaceholder {...MISSING_BRIEFING} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      ...INNER_STYLE,
                      padding: '0.9rem',
                      background: 'linear-gradient(180deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.03) 100%)',
                    }}
                  >
                    <div style={{ ...labelStyle, marginBottom: 8 }}>STANCE</div>
                    <div style={{ color: '#f8fbff', fontSize: '1.2rem', fontWeight: 900 }}>
                      {pickText(stance.label, 'en') || <DataPlaceholder {...MISSING_BRIEFING} />}
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5 }}>
                      <div>
                        Action: <span style={{ color: '#f8fbff', fontWeight: 800 }}>{pickText(stance.action, 'en') || <DataPlaceholder {...MISSING_BRIEFING} />}</span>
                      </div>
                      <div>
                        Exposure: <span style={{ color: '#f8fbff', fontWeight: 800 }}>{pickText(stance.exposure_band, 'en') || <DataPlaceholder {...MISSING_BRIEFING} />}</span>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, color: '#94a3b8', fontSize: '0.75rem', lineHeight: 1.6 }}>
                      {pickText(stance.why, 'en') || <DataPlaceholder {...MISSING_BRIEFING} />}
                    </div>
                  </div>

                  <div style={{ ...INNER_STYLE, padding: '0.9rem' }}>
                    <div style={{ ...labelStyle, marginBottom: 10 }}>SESSION READOUT</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {statusChips.map((chip) => (
                        <StatusChip
                          key={chip.label}
                          label={chip.label}
                          value={chip.value || <DataPlaceholder {...MISSING_STATE} />}
                          detail={chip.detail || undefined}
                          color={chip.color}
                        />
                      ))}
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, color: '#64748b', fontSize: '0.72rem' }}>
                      <span>BRIEF {briefDate || '--'}</span>
                      <span>STATE {stateDate || '--'}</span>
                      <span>TAPE {tapeDate || '--'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>

          <TerminalIndexRail tape={tape} />
        </div>
      </div>
    </div>
  )
}
