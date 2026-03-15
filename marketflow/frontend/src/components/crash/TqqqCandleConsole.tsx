'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Candle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

type ChartResponse = {
  symbol: string
  candles?: Candle[]
  error?: string
  rerun_hint?: string
}

type RangeKey = '1W' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y'
type FrameKey = '1D' | '1W'

type Props = {
  tailPercentile?: number | null
  panicThreshold?: number
  lang?: 'ko' | 'en'
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'
const RANGE_DAYS: Record<RangeKey, number> = {
  '1W': 5,
  '1M': 22,
  '3M': 63,
  '6M': 126,
  '1Y': 252,
  '2Y': 504,
  '5Y': 1260,
}

const MA_WINDOWS = [5, 10, 20, 50, 100, 200]
const MA_COLORS: Record<number, string> = {
  5: '#7aa7ff',
  10: '#8dd1d1',
  20: '#94d1b0',
  50: '#c2b082',
  100: '#b79bd2',
  200: '#a3a3a3',
}

function movingAverage(candles: Candle[], window: number): Array<number | undefined> {
  if (window <= 0) return candles.map(() => undefined)
  let sum = 0
  const out: Array<number | undefined> = []
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= window) sum -= candles[i - window].close
    out.push(i >= window - 1 ? sum / window : undefined)
  }
  return out
}

function compactWeek(candles: Candle[]): Candle[] {
  if (candles.length < 6) return candles
  const grouped: Candle[] = []
  for (let i = 0; i < candles.length; i += 5) {
    const slice = candles.slice(i, i + 5)
    if (!slice.length) continue
    const open = slice[0].open
    const close = slice[slice.length - 1].close
    const high = Math.max(...slice.map((c) => c.high))
    const low = Math.min(...slice.map((c) => c.low))
    grouped.push({
      date: slice[slice.length - 1].date,
      open,
      close,
      high,
      low,
      volume: slice.reduce((acc, c) => acc + (c.volume ?? 0), 0),
    })
  }
  return grouped
}

function formatPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function PriceChart({
  candles,
  maMap,
  showMA,
  showHigh60,
  showPanic,
  high60,
  panicLine,
  hoverIndex,
  onHoverIndex,
  autoCenter,
  onPanStart,
  onPanMove,
  onPanEnd,
  priceShift,
}: {
  candles: Candle[]
  maMap: Record<number, Array<number | undefined>>
  showMA: Record<number, boolean>
  showHigh60: boolean
  showPanic: boolean
  high60?: number | null
  panicLine?: number | null
  hoverIndex: number | null
  onHoverIndex: (idx: number | null) => void
  autoCenter: boolean
  onPanStart: (clientY: number) => void
  onPanMove: (deltaPx: number, pricePerPx: number, span: number) => void
  onPanEnd: () => void
  priceShift: number
}) {
  const w = 1040
  const h = 420
  const left = 50
  const right = 86
  const top = 14
  const bottom = 34

  if (!candles.length) return <div style={{ color: '#8b93a8' }}>No price data.</div>

  const prices: number[] = []
  candles.forEach((c, i) => {
    prices.push(c.low, c.high)
    MA_WINDOWS.forEach((win) => {
      if (!showMA[win]) return
      const v = maMap[win]?.[i]
      if (typeof v === 'number') prices.push(v)
    })
  })
  if (showHigh60 && typeof high60 === 'number') prices.push(high60)
  if (showPanic && typeof panicLine === 'number') prices.push(panicLine)

  const minRaw = Math.min(...prices)
  const maxRaw = Math.max(...prices)
  const pad = (maxRaw - minRaw) * 0.08
  const min = minRaw - pad + priceShift
  const max = maxRaw + pad + priceShift
  const span = Math.max(1, max - min)
  const cw = w - left - right
  const ch = h - top - bottom
  const xStep = cw / candles.length
  const bodyW = Math.max(2, Math.min(10, xStep * 0.62))
  const y = (p: number) => top + ((max - p) / span) * ch
  const pricePerPx = span / ch

  const points = (series?: Array<number | undefined>) =>
    candles
      .map((_, i) => (typeof series?.[i] === 'number' ? `${left + xStep * i + xStep * 0.5},${y(series[i] as number)}` : ''))
      .filter(Boolean)
      .join(' ')

  const tickIndices = [0, Math.floor(candles.length * 0.25), Math.floor(candles.length * 0.5), Math.floor(candles.length * 0.75), candles.length - 1]
    .filter((v, i, arr) => v >= 0 && v < candles.length && arr.indexOf(v) === i)

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: '100%', height: '100%', cursor: autoCenter ? 'crosshair' : 'grab' }}
      onMouseLeave={() => {
        onHoverIndex(null)
        onPanEnd()
      }}
      onMouseMove={(event) => {
        const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
        const x = event.clientX - rect.left
        const raw = (x - left) / xStep - 0.5
        const idx = Math.max(0, Math.min(candles.length - 1, Math.round(raw)))
        onHoverIndex(Number.isFinite(idx) ? idx : null)
        if (!autoCenter) {
          onPanMove(event.clientY, pricePerPx, span)
        }
      }}
      onMouseDown={(event) => {
        if (!autoCenter) {
          onPanStart(event.clientY)
        }
      }}
      onMouseUp={() => onPanEnd()}
    >
      {[0, 1, 2, 3, 4, 5].map((g) => {
        const yy = top + (ch * g) / 5
        const p = max - (span * g) / 5
        return (
          <g key={`y-${g}`}>
            <line x1={left} y1={yy} x2={w - right} y2={yy} stroke="rgba(255,255,255,0.05)" />
            <text x={w - right + 8} y={yy + 4} fill="#7f889d" fontSize="11">
              {p.toFixed(2)}
            </text>
          </g>
        )
      })}

      {tickIndices.map((idx) => {
        const x = left + xStep * idx + xStep * 0.5
        return (
          <g key={`x-${idx}`}>
            <line x1={x} y1={top} x2={x} y2={h - bottom} stroke="rgba(255,255,255,0.04)" />
            <text x={x} y={h - 11} fill="#8b93a8" fontSize="11" textAnchor="middle">
              {(candles[idx]?.date || '').slice(5)}
            </text>
          </g>
        )
      })}

      {showHigh60 && typeof high60 === 'number' ? (
        <line x1={left} y1={y(high60)} x2={w - right} y2={y(high60)} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
      ) : null}
      {showPanic && typeof panicLine === 'number' ? (
        <line x1={left} y1={y(panicLine)} x2={w - right} y2={y(panicLine)} stroke="rgba(201,168,106,0.55)" strokeDasharray="2 6" />
      ) : null}

      {candles.map((c, i) => {
        const cx = left + xStep * i + xStep * 0.5
        const yo = y(c.open)
        const yc = y(c.close)
        const yh = y(c.high)
        const yl = y(c.low)
        const prevClose = i > 0 ? candles[i - 1].close : c.open
        const up = c.close >= prevClose
        const color = up ? '#7fc6b2' : '#d36b6b'
        return (
          <g key={`${c.date}-${i}`}>
            <line x1={cx} y1={yh} x2={cx} y2={yl} stroke={color} />
            <rect
              x={cx - bodyW / 2}
              y={Math.min(yo, yc)}
              width={bodyW}
              height={Math.max(1.4, Math.abs(yc - yo))}
              fill={up ? 'none' : color}
              stroke={color}
              strokeWidth={1}
              rx={1}
            />
          </g>
        )
      })}

      {typeof hoverIndex === 'number' && candles[hoverIndex] ? (
        <line
          x1={left + xStep * hoverIndex + xStep * 0.5}
          y1={top}
          x2={left + xStep * hoverIndex + xStep * 0.5}
          y2={h - bottom}
          stroke="rgba(203,213,245,0.7)"
          strokeDasharray="3 5"
        />
      ) : null}

      {MA_WINDOWS.map((win) =>
        showMA[win] ? (
          <polyline
            key={`ma-${win}`}
            fill="none"
            stroke={
              win === 5
                ? '#7aa7ff'
                : win === 10
                  ? '#8dd1d1'
                  : win === 20
                    ? '#94d1b0'
                    : win === 50
                      ? '#c2b082'
                      : win === 100
                        ? '#b79bd2'
                        : '#a3a3a3'
            }
            strokeWidth={win >= 100 ? 1.35 : 1.1}
            points={points(maMap[win])}
            opacity={0.85}
          />
        ) : null
      )}
    </svg>
  )
}

export default function TqqqCandleConsole({ tailPercentile, panicThreshold = -0.19, lang = 'ko' }: Props) {
  const t = (ko: string, en: string) => (lang === 'en' ? en : ko)
  const [range, setRange] = useState<RangeKey>('1Y')
  const [frame, setFrame] = useState<FrameKey>('1D')
  const [polling, setPolling] = useState(false)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [autoCenter, setAutoCenter] = useState(true)
  const [priceShift, setPriceShift] = useState(0)
  const dragRef = useRef<{ y: number; shift: number } | null>(null)
  const [showMA, setShowMA] = useState<Record<number, boolean>>(() =>
    MA_WINDOWS.reduce((acc, win) => {
      acc[win] = win === 20 || win === 50 || win === 200
      return acc
    }, {} as Record<number, boolean>)
  )
  const [showHigh60, setShowHigh60] = useState(true)
  const [showPanic, setShowPanic] = useState(false)
  const [chart, setChart] = useState<ChartResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchChart = async (showSpinner: boolean) => {
    const days = RANGE_DAYS[range]
    const extra = frame === '1W' ? 1100 : 220
    const fetchDays = Math.max(days + extra, 320)
    if (showSpinner) setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/chart/TQQQ?days=${fetchDays}`, { cache: 'no-store' })
      const data = await res.json()
      setChart(data)
    } catch (err) {
      setChart({ symbol: 'TQQQ', candles: [], error: 'Failed to load chart data.' })
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    if (!alive) return
    fetchChart(true)
    return () => {
      alive = false
    }
  }, [range, frame])

  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => {
      fetchChart(false)
    }, 60000)
    return () => clearInterval(id)
  }, [polling, range])

  const fullCandles = useMemo(() => {
    const candles = Array.isArray(chart?.candles) ? chart.candles : []
    return candles
  }, [chart])

  const baseCandles = useMemo(() => {
    const days = RANGE_DAYS[range]
    return fullCandles.slice(-days)
  }, [fullCandles, range])

  const weeklyFull = useMemo(() => compactWeek(fullCandles), [fullCandles])
  const weeklyRange = useMemo(() => {
    const weeks = Math.max(1, Math.round(RANGE_DAYS[range] / 5))
    return weeklyFull.slice(-weeks)
  }, [weeklyFull, range])
  const displayCandles = frame === '1W' ? weeklyRange : baseCandles

  const maMap = useMemo(() => {
    const map: Record<number, Array<number | undefined>> = {}
    if (frame === '1W') {
      MA_WINDOWS.forEach((win) => {
        const full = movingAverage(weeklyFull, win)
        map[win] = full.slice(-weeklyRange.length)
      })
      return map
    }
    const fullMap: Record<number, Array<number | undefined>> = {}
    MA_WINDOWS.forEach((win) => {
      fullMap[win] = movingAverage(fullCandles, win)
      map[win] = fullMap[win].slice(-baseCandles.length)
    })
    return map
  }, [frame, weeklyFull, weeklyRange.length, fullCandles, baseCandles.length])

  const activeIndex = typeof hoverIndex === 'number' ? hoverIndex : displayCandles.length - 1
  const activeCandle = displayCandles[activeIndex]
  const latestClose = activeCandle?.close ?? null
  const latestDate = activeCandle?.date ?? ''
  const hoverPct = displayCandles.length ? (activeIndex + 0.5) / displayCandles.length : 1
  const tableLeftPct = Math.min(0.98, Math.max(0.02, hoverPct))
  const tableTransform = hoverPct > 0.82 ? 'translateX(-102%)' : 'translateX(10px)'
  const closeAt = (back: number) => displayCandles[activeIndex - back]?.close ?? null
  const ret2 = latestClose && closeAt(2) ? latestClose / closeAt(2) - 1 : null
  const ret3 = latestClose && closeAt(3) ? latestClose / closeAt(3) - 1 : null
  const ret5 = latestClose && closeAt(5) ? latestClose / closeAt(5) - 1 : null
  const highWindow = frame === '1W' ? 12 : 60
  const highSlice = displayCandles.slice(Math.max(0, activeIndex - highWindow + 1), activeIndex + 1)
  const high60 = highSlice.reduce((acc, c) => Math.max(acc, c.close), Number.NEGATIVE_INFINITY)
  const dd60 = latestClose && Number.isFinite(high60) ? latestClose / high60 - 1 : null

  const panicLine = latestClose ? latestClose * (1 + panicThreshold) : null
  const latestMAValues = MA_WINDOWS.map((win) => ({
    win,
    value: maMap[win]?.[activeIndex],
  })).filter((entry) => showMA[entry.win] && typeof entry.value === 'number')

  const ma200Value = maMap[200]?.[activeIndex]
  const ma200GapPct =
    latestClose && typeof ma200Value === 'number' && ma200Value !== 0 ? latestClose / ma200Value - 1 : null
  const ma200GapAbs = ma200GapPct === null ? null : Math.abs(ma200GapPct) * 100
  const ma200GapLabel =
    ma200GapAbs === null
      ? '-'
      : ma200GapAbs <= 2
        ? t('\uac00\uac11\ub2e4', 'Near')
        : ma200GapAbs <= 6
          ? t('\ubcf4\ud1b5', 'Moderate')
          : t('\uba40\ub2e4', 'Far')
  const ma200GapDir =
    ma200GapPct === null ? '' : ma200GapPct >= 0 ? t('\uc0c1\ub2e8', 'Above') : t('\ud558\ub2e8', 'Below')


  const metricsPayload = useMemo(
    () => ({
      date: latestDate,
      close: latestClose,
      ret2,
      ret3,
      ret5,
      dd60,
      ma50: maMap[50]?.[activeIndex] ?? null,
      ma200: maMap[200]?.[activeIndex] ?? null,
      ma200GapAbs,
      ma200GapDir,
      ma200GapLabel,
    }),
    [
      latestDate,
      latestClose,
      ret2,
      ret3,
      ret5,
      dd60,
      maMap,
      activeIndex,
      ma200GapAbs,
      ma200GapDir,
      ma200GapLabel,
    ]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('tqqq-metrics', { detail: metricsPayload }))
  }, [metricsPayload])

  return (
    <section
      style={{
        background: '#0f1522',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
        padding: '1.4rem 1.6rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['1W', '1M', '3M', '6M', '1Y', '2Y', '5Y'] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                border: range === r ? '1px solid rgba(148,163,184,0.5)' : '1px solid rgba(255,255,255,0.12)',
                background: range === r ? 'rgba(148,163,184,0.16)' : 'rgba(255,255,255,0.04)',
                color: range === r ? '#e2e8f0' : '#9ca3af',
                borderRadius: 8,
                padding: '0.28rem 0.6rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['1D', '1W'] as FrameKey[]).map((f) => (
            <button
              key={f}
              onClick={() => setFrame(f)}
              style={{
                border: frame === f ? '1px solid rgba(201,168,106,0.5)' : '1px solid rgba(255,255,255,0.12)',
                background: frame === f ? 'rgba(201,168,106,0.16)' : 'rgba(255,255,255,0.04)',
                color: frame === f ? '#e6d0a0' : '#9ca3af',
                borderRadius: 8,
                padding: '0.28rem 0.6rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {f === '1D' ? 'D' : 'W'}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.74rem', color: '#9ca3af' }}>
          <input type="checkbox" checked={polling} onChange={(e) => setPolling(e.target.checked)} />
          {t('Live refresh 60s', 'Live refresh 60s')}
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.74rem', color: '#9ca3af' }}>
          <input
            type="checkbox"
            checked={autoCenter}
            onChange={(e) => {
              const next = e.target.checked
              setAutoCenter(next)
              if (next) {
                setPriceShift(0)
                dragRef.current = null
              }
            }}
          />
          {t('Auto center', 'Auto center')}
        </label>
        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          {MA_WINDOWS.map((win) => (
            <label key={win} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.74rem', color: '#9ca3af' }}>
              <input
                type="checkbox"
                checked={showMA[win]}
                onChange={(e) => setShowMA((prev) => ({ ...prev, [win]: e.target.checked }))}
              />
              MA{win}
            </label>
          ))}
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.74rem', color: '#9ca3af' }}>
            <input type="checkbox" checked={showHigh60} onChange={(e) => setShowHigh60(e.target.checked)} />
            60D High
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.74rem', color: '#9ca3af' }}>
            <input type="checkbox" checked={showPanic} onChange={(e) => setShowPanic(e.target.checked)} />
            Panic Ref
          </label>
        </div>
      </div>

      <div style={{ width: '100%', minHeight: 420, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 14,
            background: 'rgba(10,15,26,0.85)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            padding: '0.45rem 0.6rem',
            fontSize: '0.78rem',
            color: '#cbd5f5',
            display: 'grid',
            gap: '0.2rem',
          }}
        >
          <div>{t('2D drop', '2D drop')}: {formatPct(ret2)}</div>
          <div>{t('3D drop', '3D drop')}: {formatPct(ret3)}</div>
          <div>{t('5D drop', '5D drop')}: {formatPct(ret5)}</div>
          <div>{t('60D drawdown', '60D drawdown')}: {formatPct(dd60)}</div>
          <div>{t('Tail percentile', 'Tail percentile')}: {tailPercentile === null || tailPercentile === undefined ? '-' : `${tailPercentile.toFixed(1)}%`}</div>
          <div>
            {t('MA200 Gap', 'MA200 Gap')}: {ma200GapAbs === null ? '-' : `${ma200GapAbs.toFixed(1)}%`} {ma200GapDir} · {ma200GapLabel}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: `${(tableLeftPct * 100).toFixed(2)}%`,
            background: 'rgba(10,15,26,0.9)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            padding: '0.5rem 0.7rem',
            fontSize: '0.78rem',
            color: '#e5e7eb',
            minWidth: 120,
            transform: tableTransform,
            pointerEvents: 'none',
          }}
        >
          <div style={{ color: '#cbd5f5', marginBottom: 4 }}>{latestDate ? latestDate.slice(2) : '-'}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span>{t('Price', 'Price')}</span>
            <span>{latestClose ? latestClose.toFixed(2) : '-'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#94a3b8' }}>
            <span>{t('60D High', '60D High')}</span>
            <span>{Number.isFinite(high60) ? high60.toFixed(2) : '-'}</span>
          </div>
          {latestMAValues.map((entry) => (
            <div
              key={entry.win}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                color: MA_COLORS[entry.win] ?? '#cbd5f5',
              }}
            >
              <span>MA{entry.win}</span>
              <span>{(entry.value as number).toFixed(2)}</span>
            </div>
          ))}
        </div>
        {loading ? (
          <div style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Loading TQQQ chart...</div>
        ) : (
          <PriceChart
            candles={displayCandles}
            maMap={maMap}
            showMA={showMA}
            showHigh60={showHigh60}
            showPanic={showPanic}
            high60={Number.isFinite(high60) ? high60 : null}
            panicLine={panicLine}
            hoverIndex={hoverIndex}
            onHoverIndex={setHoverIndex}
            autoCenter={autoCenter}
            priceShift={priceShift}
            onPanStart={(clientY) => {
              dragRef.current = { y: clientY, shift: priceShift }
            }}
            onPanMove={(clientY, pricePerPx, span) => {
              if (!dragRef.current || autoCenter) return
              const delta = clientY - dragRef.current.y
              const next = dragRef.current.shift + delta * pricePerPx
              const clamp = span * 0.8
              setPriceShift(Math.max(-clamp, Math.min(clamp, next)))
            }}
            onPanEnd={() => {
              dragRef.current = null
            }}
          />
        )}
        {chart?.error ? <div style={{ marginTop: 8, color: '#fca5a5', fontSize: '0.76rem' }}>{chart.error}</div> : null}
      </div>
    </section>
  )
}
