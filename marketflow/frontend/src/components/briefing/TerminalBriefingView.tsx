import type { CSSProperties } from 'react'
import DataPlaceholder from '@/components/DataPlaceholder'
import type { AiBriefingV2 } from '@/components/briefing/AIBriefingV2'
import TerminalIndexRailClient from '@/components/briefing/TerminalIndexRailClient'
import MarketSnapshotRail from '@/components/briefing/MarketSnapshotRail'
import TopBriefingSection, { type TopBriefingSnapshot } from '@/components/briefing/TopBriefingSection'
import StructuredBriefingPanel from '@/components/briefing/StructuredBriefingPanel'
import {
  type BriefingSourceMeta,
  type FusionBriefingOutput,
  formatTimestampUtc,
  humanizeIdentifier,
  type StructuredBriefingOutput,
} from '@/lib/briefing-data'

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
  structuredBriefing: StructuredBriefingOutput | null
  fusionBriefing: FusionBriefingOutput | null
  tape: MarketTapeCache
  topBriefing: TopBriefingSnapshot
  sourceMeta: BriefingSourceMeta
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

const SANS_FONT_STACK = `var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)`
const MONO_FONT_STACK = `var(--font-terminal-mono, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)`

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

const labelStyle: CSSProperties = {
  color: '#7f8aa4',
  fontSize: '0.68rem',
  letterSpacing: '0.16em',
  fontWeight: 700,
  textTransform: 'uppercase',
}

const MONO: CSSProperties = {
  fontFamily: MONO_FONT_STACK,
}

// US market index / futures symbols (shown first)
const US_MARKET_SYMBOLS = ['ES=F', 'NQ=F', 'YM=F', 'VIX', 'DXY', 'BTCUSD', 'SPY', 'QQQ', 'DIA', 'IWM']
// User watchlist symbols
const WATCHLIST_SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'GOOGL', 'NFLX', 'MSFT', 'AMZN', 'META']

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

function pickAiSummaryHeadline(aiBriefing: AiBriefingV2): string | null {
  const summaryStatement =
    typeof aiBriefing.summary_statement === 'string' ? aiBriefing.summary_statement.trim() : ''
  if (summaryStatement) return summaryStatement

  const todayContext =
    typeof aiBriefing.today_context === 'string' ? aiBriefing.today_context.trim() : ''
  if (todayContext) {
    const sentence = todayContext.split(/(?<=[.!?]|다\.)\s+/)[0]?.trim()
    if (sentence) return sentence
  }

  const marketNarrative =
    typeof aiBriefing.daily_briefing?.market_narrative === 'string'
      ? aiBriefing.daily_briefing.market_narrative.trim()
      : ''
  if (marketNarrative) {
    const sentence = marketNarrative.split(/(?<=[.!?]|다\.)\s+/)[0]?.trim()
    if (sentence) return sentence
  }

  const sections = Array.isArray(aiBriefing.sections) ? aiBriefing.sections : []
  for (const section of sections) {
    const bodyKo = typeof section.body_ko === 'string' ? section.body_ko.trim() : ''
    const bodyEn = typeof section.body_en === 'string' ? section.body_en.trim() : ''
    const body = bodyKo || bodyEn
    if (!body) continue
    const firstLine = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (!firstLine) continue
    const cleaned = firstLine.replace(/^\s*[•\-]\s*/, '').trim()
    const sentence = cleaned.split(/(?<=[.!?]|다\.)\s+/)[0]?.trim()
    return sentence || cleaned
  }
  return null
}

function formatSummaryDate(dateRaw: string | null): string | null {
  if (!dateRaw) return null
  const m = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return dateRaw
  const mm = Number(m[2])
  const dd = Number(m[3])
  if (!Number.isFinite(mm) || !Number.isFinite(dd)) return dateRaw
  return `${mm}월 ${dd}일`
}

function fmtSigned(value?: number | null, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

function fmtPrice(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  if (value >= 10000) return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  if (value >= 100)   return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function pctFill(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'rgba(100,116,139,0.18)'
  return value >= 0 ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)'
}

function TapeRow({ item }: { item: TapeItem }) {
  const symbol   = item.symbol || '--'
  const pct      = item.chg_pct ?? null
  const pctLabel = typeof pct === 'number' && !Number.isNaN(pct) ? `${fmtSigned(pct)}%` : '--'
  const fill     = pctFill(pct)
  const priceCol = changeColor(pct)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) 80px 84px',
      alignItems: 'stretch',
      minHeight: 38,
      borderTop: '1px solid rgba(148,163,184,0.12)',
    }}>
      <div style={{ padding: '0.5rem 0.7rem', borderRight: '1px solid rgba(148,163,184,0.10)', display: 'flex', alignItems: 'center' }}>
        <span style={{ ...MONO, color: '#8ddcff', fontSize: '0.8rem', fontWeight: 900, letterSpacing: '0.04em' }}>
          {symbol}
        </span>
      </div>
      <div style={{
        background: fill,
        color: '#08111f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.02em',
        borderRight: '1px solid rgba(148,163,184,0.10)',
        ...MONO,
      }}>
        {pctLabel}
      </div>
      <div style={{
        padding: '0.5rem 0.7rem',
        textAlign: 'right',
        color: priceCol,
        fontSize: '0.76rem',
        fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        ...MONO,
      }}>
        {fmtPrice(item.last)}
      </div>
    </div>
  )
}

function TapeGroupHeader({ title }: { title: string }) {
  return (
    <div style={{
      padding: '0.5rem 0.7rem',
      borderTop: '1px solid rgba(148,163,184,0.12)',
      background: 'rgba(255,255,255,0.012)',
    }}>
      <span style={{ ...MONO, color: '#f8fbff', fontSize: '0.68rem', letterSpacing: '0.08em', fontWeight: 900 }}>
        {title}
      </span>
    </div>
  )
}

function TerminalIndexRail({ tape }: { tape: MarketTapeCache }) {
  const items    = Array.isArray(tape.items) ? tape.items : []
  const bySymbol = new Map(items.map((item) => [item.symbol || '', item]))

  const pick = (symbols: string[]) =>
    symbols.map((s) => bySymbol.get(s)).filter(Boolean) as TapeItem[]

  const usMarkets  = pick(US_MARKET_SYMBOLS)
  const watchlist  = pick(WATCHLIST_SYMBOLS)
  const usSet      = new Set(US_MARKET_SYMBOLS)
  const watchSet   = new Set(WATCHLIST_SYMBOLS)
  const mostActive = items.filter((item) => {
    const s = item.symbol || ''
    return !usSet.has(s) && !watchSet.has(s)
  })

  const groups = [
    { title: 'US Markets',  items: usMarkets  },
    { title: 'Most Active', items: mostActive  },
    { title: 'Watchlist',   items: watchlist   },
  ].filter((g) => g.items.length > 0)

  const hasAny = items.length > 0

  return (
    <aside style={{
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
    }}>
      {/* Panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.8rem 0.9rem',
        borderBottom: '1px solid rgba(148,163,184,0.12)',
        background: 'rgba(255,255,255,0.015)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 10px #22d3ee88' }} />
          <span style={{ ...MONO, color: '#22d3ee', fontSize: '0.62rem', letterSpacing: '0.22em', fontWeight: 800, textTransform: 'uppercase' }}>
            WATCHLIST &gt;
          </span>
        </div>
        <span style={{ ...MONO, color: '#334155', fontSize: '0.6rem', letterSpacing: '0.1em' }}>
          {tape.data_date || '--'}
        </span>
      </div>

      {!hasAny ? (
        <div style={{ padding: '1rem 0.9rem' }}>
          <div style={{ ...MONO, color: '#475569', fontSize: '0.72rem', letterSpacing: '0.06em', marginBottom: 10 }}>
            — no tape data —
          </div>
          <DataPlaceholder {...MISSING_TAPE} />
        </div>
      ) : (
        <div>
          {/* Column header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 80px 84px',
            borderBottom: '1px solid rgba(148,163,184,0.14)',
            background: 'rgba(255,255,255,0.02)',
          }}>
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

function BriefingBulletRow({ bullet }: { bullet: BriefingBullet }) {
  return (
    <div style={{ ...INNER_STYLE, padding: '0.72rem 0.8rem', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ color: '#7dd3fc', fontSize: '0.68rem', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 800 }}>
        {pickText(bullet.label, 'en') || 'NOTE'}
      </div>
      <div style={{ color: '#e2e8f0', fontSize: '0.85rem', lineHeight: 1.65, marginTop: 6 }}>
        {pickText(bullet.text, 'en') || <DataPlaceholder {...MISSING_BRIEFING} />}
      </div>
      {Array.isArray(bullet.evidence) && bullet.evidence.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {bullet.evidence.slice(0, 3).map((item, index) => (
            <span key={`${item}-${index}`} style={{
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#a8b2c8',
              padding: '2px 8px',
              fontSize: '0.62rem',
            }}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TerminalBriefingView({
  structuredBriefing,
  fusionBriefing,
  tape,
  topBriefing,
  sourceMeta,
}: Props) {
  const asOfLabel =
    sourceMeta.as_of ||
    structuredBriefing?.data_source_meta?.as_of ||
    structuredBriefing?.date ||
    fusionBriefing?.date ||
    null
  const asOfDisplay = formatTimestampUtc(asOfLabel) || asOfLabel
  const updatedAtLabel = formatTimestampUtc(sourceMeta.fetched_at)
  const freshnessLabel =
    sourceMeta.stale
      ? 'STALE'
      : sourceMeta.age_minutes !== null && sourceMeta.age_minutes !== undefined
        ? `${Math.max(0, Math.round(sourceMeta.age_minutes))}m`
        : '--'

  const sourceChips = [
    sourceMeta.structured_loaded ? 'STRUCTURED OK' : 'STRUCTURED MISSING',
    sourceMeta.fusion_loaded ? 'FUSION OK' : 'FUSION MISSING',
    sourceMeta.light_theme_loaded ? 'THEME OK' : null,
    asOfDisplay ? `AS OF ${asOfDisplay}` : 'AS OF --',
    `FRESH ${freshnessLabel}`,
    `MODE ${humanizeIdentifier(sourceMeta.mode)}`,
    sourceMeta.snapshot_source ? `SRC ${sourceMeta.snapshot_source}` : null,
    updatedAtLabel ? `UPDATED ${updatedAtLabel}` : null,
  ].filter(Boolean) as string[]

  return (
    <div
      style={{
        minHeight: '100%',
        padding: '0.72rem 0.9rem 1.1rem',
        background:
          'radial-gradient(circle at top left, rgba(34,211,238,0.02), transparent 22%), radial-gradient(circle at top right, rgba(148,163,184,0.02), transparent 20%), linear-gradient(180deg, #010204 0%, #040609 100%)',
        color: '#e5eefb',
        fontFamily: SANS_FONT_STACK,
      }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <header style={{ ...CARD_STYLE, padding: '0.72rem 0.84rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  ...MONO,
                  color: '#22d3ee',
                  fontSize: '0.62rem',
                  letterSpacing: '0.28em',
                  textTransform: 'uppercase',
                  fontWeight: 800,
                }}
              >
                DAILY BRIEFING / TERMINAL MODE
              </div>
              <h1
                style={{
                  margin: '0.28rem 0 0',
                  fontSize: '1.85rem',
                  lineHeight: 1,
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  color: '#f8fbff',
                }}
              >
                Daily <span style={{ color: '#22d3ee' }}>Briefing</span>
              </h1>
              <div style={{ color: '#8793a8', fontSize: '0.78rem', marginTop: 4, lineHeight: 1.45 }}>
                Market structure + news fusion summary
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {sourceChips.map((chip) => (
                  <span
                    key={chip}
                    style={{
                      ...INNER_STYLE,
                      ...MONO,
                      padding: '0.24rem 0.48rem',
                      color: '#a7f3d0',
                      borderColor: 'rgba(148,163,184,0.14)',
                      fontSize: '0.58rem',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <div style={{ color: '#64748b', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Source-aware, snapshot-driven briefing
              </div>
            </div>
          </div>
        </header>

        <TopBriefingSection data={topBriefing} />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
          <main style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <StructuredBriefingPanel structuredBriefing={structuredBriefing} fusionBriefing={fusionBriefing} />
          </main>

          <div className="flex w-full flex-col gap-3 xl:max-w-[336px]">
            <TerminalIndexRailClient tape={tape} />
            <MarketSnapshotRail structuredBriefing={structuredBriefing} />
          </div>
        </div>
      </div>
    </div>
  )
}
