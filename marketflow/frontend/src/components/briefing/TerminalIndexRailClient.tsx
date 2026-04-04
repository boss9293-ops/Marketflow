'use client'

import { useEffect, useMemo, useState } from 'react'

type TapeItem = {
  symbol?: string | null
  name?: string | null
  last?: number | null
  chg?: number | null
  chg_pct?: number | null
  spark_1d?: number[] | null
}

type MarketTapeCache = {
  data_date?: string | null
  generated_at?: string | null
  items?: TapeItem[] | null
}

type QuoteRequest = {
  display: string
  api: string
  aliases?: string[]
}

const CARD_STYLE = {
  background: 'linear-gradient(180deg, rgba(10,11,16,0.99) 0%, rgba(7,8,12,0.99) 100%)',
  border: '1px solid rgba(148,163,184,0.12)',
  boxShadow: 'none',
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }

const US_MARKET_SYMBOLS = ['ES=F', 'NQ=F', 'VIX', 'DXY', 'BTCUSD']
const MOST_ACTIVE_SYMBOLS = ['MSFT', 'AAPL', 'V', 'XOM', 'NFLX', 'AMD', 'GOOGL', 'NVDA', 'TSLA', 'JPM']
const WATCHLIST_SYMBOLS = ['AMZN', 'META']

const QUOTE_REQUESTS: QuoteRequest[] = [
  { display: 'ES=F', api: 'ES=F' },
  { display: 'NQ=F', api: 'NQ=F' },
  { display: 'VIX', api: '^VIX', aliases: ['VIX'] },
  { display: 'DXY', api: 'DX-Y.NYB', aliases: ['DXY'] },
  { display: 'BTCUSD', api: 'BTC-USD', aliases: ['BTCUSD'] },
  ...MOST_ACTIVE_SYMBOLS.map((symbol) => ({ display: symbol, api: symbol })),
  ...WATCHLIST_SYMBOLS.map((symbol) => ({ display: symbol, api: symbol })),
]

const ROW_ORDER = Array.from(new Set(QUOTE_REQUESTS.map((item) => item.display)))

function normalizeSymbol(value?: string | null): string {
  return (value || '').trim().toUpperCase()
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function fmtSigned(value?: number | null, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

function fmtPrice(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  if (value >= 10000) return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pctFill(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'rgba(100,116,139,0.18)'
  return value >= 0 ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)'
}

function priceColor(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '#758199'
  return value >= 0 ? '#22c55e' : '#ef4444'
}

function buildPlaceholderItems(): TapeItem[] {
  return ROW_ORDER.map((symbol) => ({ symbol, name: symbol, last: null, chg: null, chg_pct: null, spark_1d: [] }))
}

function buildLiveItems(quotes: Array<Record<string, unknown>>): TapeItem[] {
  const quoteMap = new Map<string, Record<string, unknown>>()
  for (const quote of quotes) {
    const sym = normalizeSymbol(String(quote.symbol || ''))
    if (sym) quoteMap.set(sym, quote)
  }

  return QUOTE_REQUESTS.map((request) => {
    const keys = [request.api, request.display, ...(request.aliases || [])].map(normalizeSymbol)
    const matched = keys.map((key) => quoteMap.get(key)).find(Boolean)
    return {
      symbol: request.display,
      name: typeof matched?.name === 'string' ? matched.name : request.display,
      last: toNumber(matched?.price),
      chg: null,
      chg_pct: toNumber(matched?.changePercent),
      spark_1d: [],
    }
  })
}

function TapeGroupHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        padding: '0.45rem 0.65rem',
        borderTop: '1px solid rgba(148,163,184,0.10)',
        background: 'rgba(255,255,255,0.012)',
      }}
    >
      <span style={{ ...MONO, color: '#f8fbff', fontSize: '0.64rem', letterSpacing: '0.08em', fontWeight: 900 }}>{title}</span>
    </div>
  )
}

function TapeRow({ item }: { item: TapeItem }) {
  const symbol = item.symbol || '--'
  const pct = item.chg_pct ?? null
  const pctLabel = typeof pct === 'number' && !Number.isNaN(pct) ? `${fmtSigned(pct)}%` : '--'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 80px 84px',
        alignItems: 'stretch',
        minHeight: 36,
        borderTop: '1px solid rgba(148,163,184,0.10)',
      }}
    >
      <div
        style={{
          padding: '0.45rem 0.65rem',
          borderRight: '1px solid rgba(148,163,184,0.10)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span style={{ ...MONO, color: '#8ddcff', fontSize: '0.76rem', fontWeight: 900, letterSpacing: '0.04em' }}>{symbol}</span>
      </div>
      <div
        style={{
          background: pctFill(pct),
          color: '#08111f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.68rem',
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
          padding: '0.45rem 0.65rem',
          textAlign: 'right',
          color: priceColor(pct),
          fontSize: '0.72rem',
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          ...MONO,
        }}
      >
        {fmtPrice(item.last)}
      </div>
    </div>
  )
}

export default function TerminalIndexRailClient({ tape }: { tape: MarketTapeCache }) {
  const cachedItems = useMemo(() => {
    if (!Array.isArray(tape.items)) return []
    return tape.items
      .filter(Boolean)
      .map((item) => ({
        symbol: item.symbol || item.name || '--',
        name: item.name || item.symbol || '--',
        last: toNumber(item.last),
        chg: toNumber(item.chg),
        chg_pct: toNumber(item.chg_pct),
        spark_1d: Array.isArray(item.spark_1d) ? item.spark_1d : [],
      }))
  }, [tape.items])

  const hasCached = cachedItems.length > 0
  const [items, setItems] = useState<TapeItem[]>(hasCached ? cachedItems : buildPlaceholderItems())
  const [loading, setLoading] = useState(!hasCached)
  const [source, setSource] = useState<'CACHE' | 'LIVE' | 'DEFAULT'>(hasCached ? 'CACHE' : 'LIVE')

  useEffect(() => {
    if (hasCached) {
      setItems(cachedItems)
      setLoading(false)
      setSource('CACHE')
      return
    }

    let active = true
    const run = async () => {
      try {
        const params = new URLSearchParams({
          symbols: QUOTE_REQUESTS.map((request) => request.api).join(','),
        })
        const res = await fetch(`/api/quote?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`quote api status ${res.status}`)
        const json = await res.json()
        const quotes = Array.isArray(json?.quotes) ? json.quotes : []
        if (!active) return
        if (quotes.length > 0) {
          setItems(buildLiveItems(quotes))
          setSource('LIVE')
        } else {
          setSource('DEFAULT')
        }
      } catch {
        if (!active) return
        setSource('DEFAULT')
      } finally {
        if (active) setLoading(false)
      }
    }

    run()
    return () => {
      active = false
    }
  }, [hasCached, cachedItems])

  const bySymbol = useMemo(() => {
    const map = new Map<string, TapeItem>()
    for (const item of items) map.set(normalizeSymbol(item.symbol), item)
    return map
  }, [items])

  const pick = (symbols: string[]) => symbols.map((symbol) => bySymbol.get(normalizeSymbol(symbol))).filter(Boolean) as TapeItem[]

  const groups = [
    { title: 'US Markets', items: pick(US_MARKET_SYMBOLS) },
    { title: 'Most Active', items: pick(MOST_ACTIVE_SYMBOLS) },
    { title: 'Watchlist', items: pick(WATCHLIST_SYMBOLS) },
  ].filter((group) => group.items.length > 0)

  const displayDate = tape.data_date || new Date().toISOString().slice(0, 10)

  return (
    <aside
      style={{
        ...CARD_STYLE,
        position: 'sticky',
        top: '0.9rem',
        maxHeight: 'calc(100vh - 1.8rem)',
        overflowY: 'auto',
        width: '100%',
        maxWidth: 336,
        borderRadius: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.7rem 0.8rem',
          borderBottom: '1px solid rgba(148,163,184,0.10)',
          background: 'rgba(255,255,255,0.012)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 10px #22d3ee88' }} />
          <span
            style={{
              ...MONO,
              color: '#22d3ee',
              fontSize: '0.62rem',
              letterSpacing: '0.22em',
              fontWeight: 800,
              textTransform: 'uppercase',
            }}
          >
            WATCHLIST &gt;
          </span>
        </div>
        <span style={{ ...MONO, color: '#334155', fontSize: '0.56rem', letterSpacing: '0.08em' }}>
          {displayDate} {source}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 80px 84px',
          borderBottom: '1px solid rgba(148,163,184,0.10)',
          background: 'rgba(255,255,255,0.015)',
        }}
      >
        <div
          style={{
            ...MONO,
            padding: '0.4rem 0.65rem',
            color: '#3d4d66',
            fontSize: '0.6rem',
            letterSpacing: '0.14em',
            borderRight: '1px solid rgba(148,163,184,0.10)',
          }}
        >
          Ticker
        </div>
        <div
          style={{
            ...MONO,
            padding: '0.45rem 0.4rem',
            color: '#3d4d66',
            fontSize: '0.58rem',
            letterSpacing: '0.14em',
            textAlign: 'center',
            borderRight: '1px solid rgba(148,163,184,0.10)',
          }}
        >
          % 1D
        </div>
        <div style={{ ...MONO, padding: '0.4rem 0.65rem', color: '#3d4d66', fontSize: '0.58rem', letterSpacing: '0.14em', textAlign: 'right' }}>
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

      {loading && (
        <div style={{ ...MONO, color: '#475569', fontSize: '0.66rem', letterSpacing: '0.06em', padding: '0.7rem 0.9rem' }}>
          loading quotes...
        </div>
      )}
    </aside>
  )
}
