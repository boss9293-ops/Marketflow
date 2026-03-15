'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from 'recharts'

type LivePoint = {
  date: string
  mps?: number | null
  vix?: number | null
  qqq_n?: number | null
  tqqq_n?: number | null
  qqq_ret?: number | null
  tqqq_ret?: number | null
  tqqq_dd?: number | null
}

type LiveTimelineProps = {
  series: LivePoint[]
  currentMps?: number | null
  currentVix?: number | null
  dataDate?: string | null
}

type RangeStat = {
  minVal: number | null
  minDate: string | null
  maxVal: number | null
  maxDate: string | null
}

type BestWorst = {
  worst: { value: number; startIndex: number; endIndex: number }
  best: { value: number; startIndex: number; endIndex: number }
}

type BriefSource = {
  title: string
  url: string
  date?: string
}

type WindowMode = 'YTD' | '6M' | '1Y' | '3Y'

const WINDOW_OPTIONS: Array<{ value: WindowMode; label: string }> = [
  { value: 'YTD', label: 'YTD' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
]

const formatShortDate = (value?: string | null) => {
  if (!value) return '--'
  const parts = value.split('-')
  if (parts.length >= 3) {
    return `${parts[1]}/${parts[2]}`
  }
  return value
}

const formatDateWithYear = (value?: string | null) => {
  if (!value) return '--'
  const parts = value.split('-')
  if (parts.length >= 3) {
    return `${parts[0]}-${parts[1]}-${parts[2]}`
  }
  return value
}

const formatSigned = (value: number | null, digits = 1) => {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

const formatPct = (value: number | null, digits = 1) => {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${formatSigned(value, digits)}%`
}

const calcReturn = (start?: number | null, end?: number | null) => {
  if (typeof start !== 'number' || typeof end !== 'number' || start === 0) return null
  return ((end / start) - 1) * 100
}

const ensureStartRow = (arr: LivePoint[], startDate: string) => {
  if (!arr.length) return arr
  if (arr[0].date <= startDate) return arr
  const seed = arr[0]
  return [
    {
      date: startDate,
      mps: seed.mps ?? null,
      vix: seed.vix ?? null,
      qqq_n: seed.qqq_n ?? null,
      tqqq_n: seed.tqqq_n ?? null,
      qqq_ret: seed.qqq_ret ?? null,
      tqqq_ret: seed.tqqq_ret ?? null,
      tqqq_dd: seed.tqqq_dd ?? null,
    },
    ...arr,
  ]
}

const filterFromDate = (arr: LivePoint[], startDate: string) =>
  ensureStartRow(arr.filter((p) => p.date >= startDate), startDate)

const resolveYearStart = (arr: LivePoint[]) => {
  const last = arr[arr.length - 1]?.date
  if (typeof last === 'string' && last.length >= 4) {
    return `${last.slice(0, 4)}-01-01`
  }
  return `${new Date().getFullYear()}-01-01`
}

const subtractMonths = (date: string, months: number) => {
  const base = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return date
  base.setUTCMonth(base.getUTCMonth() - months)
  return base.toISOString().slice(0, 10)
}

const resolveWindowStart = (arr: LivePoint[], mode: WindowMode) => {
  const last = arr[arr.length - 1]?.date
  if (!last) return `${new Date().getFullYear()}-01-01`
  if (mode === 'YTD') return resolveYearStart(arr)
  if (mode === '6M') return subtractMonths(last, 6)
  if (mode === '1Y') return subtractMonths(last, 12)
  return subtractMonths(last, 36)
}

const formatWindowRange = (start?: string | null, end?: string | null) => {
  if (!start || !end) return '--'
  return `${start} -> ${end}`
}

const getBaseValue = (arr: LivePoint[], key: keyof LivePoint) => {
  for (const p of arr) {
    const v = p[key]
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return v
  }
  return null
}

const getUsDateString = (d = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

const withReturnSeries = (arr: LivePoint[]) => {
  const qqqBase = getBaseValue(arr, 'qqq_n')
  const tqqqBase = getBaseValue(arr, 'tqqq_n')
  return arr.map((p) => ({
    ...p,
    qqq_ret:
      typeof p.qqq_n === 'number' && qqqBase
        ? ((p.qqq_n / qqqBase) - 1) * 100
        : null,
    tqqq_ret:
      typeof p.tqqq_n === 'number' && tqqqBase
        ? ((p.tqqq_n / tqqqBase) - 1) * 100
        : null,
  }))
}

const computeExtremes = (arr: LivePoint[], key: keyof LivePoint): RangeStat => {
  let minVal: number | null = null
  let maxVal: number | null = null
  let minDate: string | null = null
  let maxDate: string | null = null
  arr.forEach((p) => {
    const v = p[key]
    if (typeof v !== 'number') return
    if (minVal == null || v < minVal) {
      minVal = v
      minDate = p.date
    }
    if (maxVal == null || v > maxVal) {
      maxVal = v
      maxDate = p.date
    }
  })
  return { minVal, minDate, maxVal, maxDate }
}

const computeBestWorst5d = (arr: LivePoint[], key: keyof LivePoint): BestWorst | null => {
  if (arr.length < 6) return null
  let worst = Infinity
  let best = -Infinity
  let worstEnd = 5
  let bestEnd = 5
  for (let i = 5; i < arr.length; i++) {
    const base = arr[i - 5]?.[key]
    const cur = arr[i]?.[key]
    if (typeof base !== 'number' || typeof cur !== 'number' || base === 0) continue
    const ret = ((cur / base) - 1) * 100
    if (ret < worst) {
      worst = ret
      worstEnd = i
    }
    if (ret > best) {
      best = ret
      bestEnd = i
    }
  }
  if (!Number.isFinite(worst) || !Number.isFinite(best)) return null
  return {
    worst: { value: worst, startIndex: Math.max(0, worstEnd - 5), endIndex: worstEnd },
    best: { value: best, startIndex: Math.max(0, bestEnd - 5), endIndex: bestEnd },
  }
}

export default function LiveTimeline({ series, currentMps, currentVix, dataDate }: LiveTimelineProps) {
  const [selectedWindow, setSelectedWindow] = useState<WindowMode>('YTD')
  const contextSeriesRaw = useMemo(() => {
    const windowStart = resolveWindowStart(series, selectedWindow)
    return filterFromDate(series, windowStart)
  }, [selectedWindow, series])
  const contextSeries = useMemo(() => withReturnSeries(contextSeriesRaw), [contextSeriesRaw])
  const focusSeriesRaw = useMemo(() => contextSeriesRaw, [contextSeriesRaw])
  const focusSeries = useMemo(() => withReturnSeries(focusSeriesRaw), [focusSeriesRaw])
  const focusWithFlags = useMemo(
    () =>
      focusSeries.map((p) => ({
        ...p,
        isMpsHigh: typeof p.mps === 'number' && p.mps >= 70,
        isVixHigh: typeof p.vix === 'number' && p.vix >= 25,
        isStress: (typeof p.mps === 'number' && p.mps >= 70) || (typeof p.vix === 'number' && p.vix >= 25),
      })),
    [focusSeries]
  )
  const yearBreakDates = useMemo(
    () =>
      new Set(
        focusWithFlags
          .filter((point, index, arr) => index === 0 || point.date.slice(0, 4) !== arr[index - 1].date.slice(0, 4))
          .map((point) => point.date)
      ),
    [focusWithFlags]
  )
  const formatAxisTick = (value: string | number) => {
    if (typeof value !== 'string') return value
    if (selectedWindow === 'YTD') return value.slice(5)
    if (yearBreakDates.has(value)) return `${value.slice(0, 4)}-${value.slice(5, 7)}`
    return value.slice(5)
  }

  const lastPoint = focusSeriesRaw[focusSeriesRaw.length - 1]
  const prev5 = focusSeriesRaw.length >= 6 ? focusSeriesRaw[focusSeriesRaw.length - 6] : null
  const mpsCurrent = (typeof lastPoint?.mps === 'number' ? lastPoint.mps : null) ?? currentMps ?? null
  const vixCurrent = (typeof lastPoint?.vix === 'number' ? lastPoint.vix : null) ?? currentVix ?? null

  const qqq5dChange = calcReturn(prev5?.qqq_n ?? null, lastPoint?.qqq_n ?? null)
  const tqqq5dChange = calcReturn(prev5?.tqqq_n ?? null, lastPoint?.tqqq_n ?? null)
  const qqqWindowReturn = calcReturn(contextSeries[0]?.qqq_n ?? null, lastPoint?.qqq_n ?? null)
  const tqqqWindowReturn = calcReturn(contextSeries[0]?.tqqq_n ?? null, lastPoint?.tqqq_n ?? null)
  const windowLabel = selectedWindow
  const responseLabel = selectedWindow === 'YTD' ? 'YTD response' : `${selectedWindow} response`

  const mpsRange = computeExtremes(contextSeries, 'mps')
  const vixRange = computeExtremes(contextSeries, 'vix')
  const qqqMoves = computeBestWorst5d(contextSeriesRaw, 'qqq_n')
  const tqqqMoves = computeBestWorst5d(contextSeriesRaw, 'tqqq_n')

  const stressDays = contextSeries.reduce((acc, p) => {
    const mps = p.mps
    const vix = p.vix
    return acc + ((typeof mps === 'number' && mps >= 70) || (typeof vix === 'number' && vix >= 25) ? 1 : 0)
  }, 0)

  const localUpdate = dataDate ? new Date(dataDate).toLocaleString('en-US') : '--'
  const utcUpdate = dataDate ? new Date(dataDate).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '--'

  const rightDomain = useMemo<[string, string]>(() => ['auto', 'auto'], [])

  const [brief, setBrief] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [sources, setSources] = useState<BriefSource[]>([])
  const [provider, setProvider] = useState<string>('auto')
  const [model, setModel] = useState<string>('')
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const lastBriefKeyRef = useRef<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [dataRefreshing, setDataRefreshing] = useState(false)
  const [dataRefreshError, setDataRefreshError] = useState<string | null>(null)
  const [manualDraft, setManualDraft] = useState('')
  const [useManual, setUseManual] = useState(false)

  const asofDay = useMemo(() => {
    const raw = lastPoint?.date ?? dataDate ?? ''
    if (!raw) return null
    return raw.slice(0, 10)
  }, [lastPoint?.date, dataDate])

  useEffect(() => {
    if (!asofDay) return
    const key = `live-brief:manual:${asofDay}`
    try {
      const saved = localStorage.getItem(key) ?? ''
      setManualDraft(saved)
      setUseManual(Boolean(saved))
    } catch {
      // ignore storage read failures
    }
  }, [asofDay])

  const runDataRefresh = async (force = false) => {
    if (dataRefreshing) return
    setDataRefreshing(true)
    setDataRefreshError(null)
    try {
      const res = await fetch('/api/macro-live/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (!res.ok) throw new Error(`refresh failed: ${res.status}`)
      window.location.reload()
    } catch (err) {
      setDataRefreshError(err instanceof Error ? err.message : 'refresh failed')
      setTimeout(() => setDataRefreshError(null), 3000)
    } finally {
      setDataRefreshing(false)
    }
  }

  useEffect(() => {
    if (!dataDate) return
    const today = getUsDateString()
    const last = String(dataDate).slice(0, 10)
    if (last >= today) return
    const key = `macro-live:auto-refresh:${today}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      // ignore storage failures
    }
    runDataRefresh(false)
  }, [dataDate])

  useEffect(() => {
    if (!contextSeries.length || !asofDay) return
    const cacheKey = `live-brief:${asofDay}:${selectedWindow}`
    if (lastBriefKeyRef.current === cacheKey) return
    lastBriefKeyRef.current = cacheKey

    try {
      const cachedRaw = localStorage.getItem(cacheKey)
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { paragraphs?: string[]; warnings?: string[] }
        if (Array.isArray(cached.paragraphs)) {
          setBrief(cached.paragraphs)
          setWarnings(Array.isArray(cached.warnings) ? cached.warnings : [])
          setBriefLoading(false)
          setBriefError(null)
          return
        }
      }
    } catch {
      // ignore cache read failures
    }

    const payload = {
      asof: asofDay,
      windowLabel: selectedWindow,
      windowDays: contextSeries.length,
      focusDays: focusSeries.length,
      forceRefresh: refreshToken > 0,
      mpsNow: mpsCurrent,
      vixNow: vixCurrent,
      mpsRange,
      vixRange,
      qqqWindowReturn,
      tqqqWindowReturn,
      qqq5dChange,
      tqqq5dChange,
      qqq5dWorst: qqqMoves?.worst,
      qqq5dBest: qqqMoves?.best,
      tqqq5dWorst: tqqqMoves?.worst,
      tqqq5dBest: tqqqMoves?.best,
      qqq5dWorstDate: contextSeriesRaw[qqqMoves?.worst?.endIndex ?? 0]?.date ?? null,
      qqq5dBestDate: contextSeriesRaw[qqqMoves?.best?.endIndex ?? 0]?.date ?? null,
      tqqq5dWorstDate: contextSeriesRaw[tqqqMoves?.worst?.endIndex ?? 0]?.date ?? null,
      tqqq5dBestDate: contextSeriesRaw[tqqqMoves?.best?.endIndex ?? 0]?.date ?? null,
      stressDays,
    }

    let active = true
    setBriefLoading(true)
    setBriefError(null)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    fetch('/api/live-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load brief')
        return res.json()
      })
      .then((data) => {
        if (!active) return
        setBrief(Array.isArray(data.paragraphs) ? data.paragraphs : [])
        setWarnings(Array.isArray(data.warnings) ? data.warnings : [])
        setSources(Array.isArray(data.sources) ? data.sources : [])
        setProvider(typeof data.provider === 'string' ? data.provider : 'auto')
        setModel(typeof data.model === 'string' ? data.model : '')
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              paragraphs: data.paragraphs ?? [],
              warnings: data.warnings ?? [],
              sources: data.sources ?? [],
              provider: data.provider ?? 'auto',
              model: data.model ?? '',
            })
          )
        } catch {
          // ignore cache write failures
        }
      })
      .catch((err: Error) => {
        if (!active) return
        setBriefError(err.name === 'AbortError' ? 'Timeout' : err.message)
        setBrief([
          '뉴스 요약/리뷰 영역입니다. 현재 API 응답이 지연되거나 실패했습니다.',
          '서버 콘솔에서 /api/live-brief 호출 로그와 Gemini 응답 상태를 확인해 주세요.',
        ])
        setWarnings([])
        setSources([])
        setProvider('error')
        setModel('')
      })
      .finally(() => {
        if (!active) return
        clearTimeout(timeout)
        setBriefLoading(false)
      })

    return () => {
      active = false
    }
  }, [asofDay, refreshToken, selectedWindow, contextSeries.length, focusSeries.length, mpsCurrent, vixCurrent, qqqWindowReturn, tqqqWindowReturn, qqq5dChange, tqqq5dChange, stressDays])

  const displayedParagraphs =
    useManual && manualDraft.trim().length
      ? manualDraft.split(/\n+/).filter(Boolean)
      : brief
  const displayedProvider = useManual && manualDraft.trim().length ? 'manual' : provider
  const displayedModel = useManual && manualDraft.trim().length ? '' : model

  const handleRetry = () => {
    if (!asofDay) return
    const cacheKey = `live-brief:${asofDay}:${selectedWindow}`
    try {
      localStorage.removeItem(cacheKey)
    } catch {
      // ignore storage failures
    }
    lastBriefKeyRef.current = null
    setRefreshToken((v) => v + 1)
  }

  const handleManualSave = () => {
    if (!asofDay) return
    const key = `live-brief:manual:${asofDay}`
    try {
      localStorage.setItem(key, manualDraft)
    } catch {
      // ignore storage failures
    }
    setUseManual(true)
  }

  const handleManualClear = () => {
    if (!asofDay) return
    const key = `live-brief:manual:${asofDay}`
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore storage failures
    }
    setManualDraft('')
    setUseManual(false)
  }

  if (!contextSeries.length) {
    return (
      <div className="text-sm text-slate-400">
        Live data is not available yet. Generate cache files to render the live view.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 text-base leading-[1.7]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-lg font-semibold text-white">Real-time Timeline</div>
            <div className="text-xs text-slate-400">MPS + VIX + {responseLabel} - updated daily</div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-1">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedWindow(option.value)}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                  selectedWindow === option.value
                    ? 'bg-sky-500/20 text-sky-200'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => runDataRefresh(true)}
              className="px-3 py-1 rounded-md border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors"
              disabled={dataRefreshing}
              title="Refresh live data"
            >
              {dataRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            {dataRefreshError ? (
              <span className="text-xs text-red-300">{dataRefreshError}</span>
            ) : null}
          </div>
        </div>
        <div className="text-xs text-slate-400 text-right">
          <div>This is a live monitoring view, not forecasting.</div>
          <div>Update local: {localUpdate}</div>
          <div>Update UTC: {utcUpdate}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-xs uppercase tracking-wider text-slate-300 mb-2">{windowLabel} Focus Window</div>
        <div className="mb-3 text-xs text-slate-500">
          {formatWindowRange(contextSeriesRaw[0]?.date ?? null, contextSeriesRaw[contextSeriesRaw.length - 1]?.date ?? null)}
        </div>
        <div className="h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={focusWithFlags} margin={{ top: 12, right: 20, left: 0, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#cbd5f5', fontSize: 10 }}
                tickFormatter={formatAxisTick}
                minTickGap={30}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="left"
                domain={[0, 100]}
                stroke="#888"
                fontSize={10}
                tick={{ fill: '#cbd5f5', fontSize: 10 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={rightDomain}
                stroke="#888"
                fontSize={10}
                tick={false}
                tickLine={false}
                axisLine
                tickFormatter={(v) => {
                  if (!Number.isFinite(v)) return ''
                  return `${Math.round(v)}`
                }}
                tickMargin={8}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name.toUpperCase().includes('QQQ')) {
                    return [formatPct(typeof value === 'number' ? value : null), name]
                  }
                  return [value?.toFixed?.(2) ?? value, name]
                }}
                labelFormatter={(label: string) => `Date ${label}`}
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)' }}
              />
              <ReferenceLine
                yAxisId="left"
                y={70}
                stroke="#f59e0b"
                strokeOpacity={0.4}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'MPS 70', position: 'right', fill: '#fbbf24', fontSize: 10, dx: 8 }}
              />
              <ReferenceLine
                yAxisId="left"
                y={85}
                stroke="#ef4444"
                strokeOpacity={0.4}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'MPS 85', position: 'right', fill: '#f87171', fontSize: 10, dx: 8 }}
              />
              <ReferenceLine
                yAxisId="left"
                y={25}
                stroke="#f59e0b"
                strokeOpacity={0.35}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'VIX 25', position: 'right', fill: '#fbbf24', fontSize: 10, dx: 8 }}
              />
              <ReferenceLine
                yAxisId="left"
                y={35}
                stroke="#ef4444"
                strokeOpacity={0.35}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'VIX 35', position: 'right', fill: '#f87171', fontSize: 10, dx: 8 }}
              />
              {focusWithFlags.map((d, i) => {
                if (d.isMpsHigh) {
                  return (
                    <ReferenceArea
                      key={`mps-${d.date}-${i}`}
                      x1={d.date}
                      x2={focusWithFlags[i + 1]?.date || d.date}
                      yAxisId="left"
                      fill="#10b981"
                      fillOpacity={0.08}
                      stroke="none"
                    />
                  )
                }
                return null
              })}
              {focusWithFlags.map((d, i) => {
                if (d.isVixHigh) {
                  return (
                    <ReferenceArea
                      key={`stress-${d.date}-${i}`}
                      x1={d.date}
                      x2={focusWithFlags[i + 1]?.date || d.date}
                      yAxisId="left"
                      fill="#ef4444"
                      fillOpacity={0.08}
                      stroke="none"
                    />
                  )
                }
                return null
              })}
              <Line yAxisId="left" type="monotone" dataKey="mps" stroke="#10b981" strokeWidth={2} dot={false} name="Macro Pressure Score" />
              <Line yAxisId="left" type="monotone" dataKey="vix" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="VIX" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="qqq_ret"
                stroke="#ef4444"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                name={`QQQ ${windowLabel}`}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="tqqq_ret"
                stroke="#f97316"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                name={`TQQQ ${windowLabel}`}
              />
              <Legend
                verticalAlign="bottom"
                height={22}
                wrapperStyle={{ fontSize: '10px', paddingTop: '10px', color: '#94a3b8' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="text-sm font-semibold text-slate-100 mb-3">Window Summary ({windowLabel})</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 md:col-span-2">
            <div className="text-xs text-slate-400">Today</div>
            <div className="text-slate-100 font-semibold">
              {formatDateWithYear(lastPoint?.date ?? dataDate ?? null)} · MPS {mpsCurrent != null ? mpsCurrent.toFixed(0) : '--'} · VIX {vixCurrent != null ? vixCurrent.toFixed(1) : '--'} · QQQ {formatPct(qqq5dChange)} (5D) · TQQQ {formatPct(tqqq5dChange)} (5D)
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">MPS Range ({windowLabel})</div>
            <div className="text-slate-100 font-semibold">
              {mpsRange.minVal != null ? mpsRange.minVal.toFixed(0) : '--'} ({formatDateWithYear(mpsRange.minDate)}){' -> '}{mpsRange.maxVal != null ? mpsRange.maxVal.toFixed(0) : '--'} ({formatDateWithYear(mpsRange.maxDate)})
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">VIX Range ({windowLabel})</div>
            <div className="text-slate-100 font-semibold">
              {vixRange.minVal != null ? vixRange.minVal.toFixed(1) : '--'} ({formatDateWithYear(vixRange.minDate)}){' -> '}{vixRange.maxVal != null ? vixRange.maxVal.toFixed(1) : '--'} ({formatDateWithYear(vixRange.maxDate)})
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">{windowLabel} Return</div>
            <div className="text-slate-100 font-semibold">
              QQQ {formatPct(qqqWindowReturn)} / TQQQ {formatPct(tqqqWindowReturn)}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">QQQ 5D Worst / Best</div>
            <div className="text-slate-100 font-semibold">
              {formatPct(qqqMoves?.worst?.value ?? null)} ({formatShortDate(contextSeriesRaw[qqqMoves?.worst?.endIndex ?? 0]?.date)}) / {formatPct(qqqMoves?.best?.value ?? null)} ({formatShortDate(contextSeriesRaw[qqqMoves?.best?.endIndex ?? 0]?.date)})
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">TQQQ 5D Worst / Best</div>
            <div className="text-slate-100 font-semibold">
              {formatPct(tqqqMoves?.worst?.value ?? null)} ({formatShortDate(contextSeriesRaw[tqqqMoves?.worst?.endIndex ?? 0]?.date)}) / {formatPct(tqqqMoves?.best?.value ?? null)} ({formatShortDate(contextSeriesRaw[tqqqMoves?.best?.endIndex ?? 0]?.date)})
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h4 className="text-sm font-semibold text-slate-100">Indicator Guide</h4>
          <div className="mt-4 space-y-4 text-base leading-[1.7] text-slate-300">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">MPS (0-100)</div>
              <div>유동성, 금리, 변동성, 신용을 종합한 매크로 압력 지표입니다. 70/85는 고압 및 위기 구간입니다.</div>
              <div className="text-xs text-slate-400 mt-2">해석: 상승/유지 = 압력 누적, 급락 = 압력 해소</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">VIX</div>
              <div>25/35는 변동성 임계 구간이며, 레벨만큼 기울기(상승 속도)가 중요합니다.</div>
              <div className="text-xs text-slate-400 mt-2">해석: 급상승은 가격 스트레스 선행 신호</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">QQQ / TQQQ</div>
              <div>가격 반응은 QQQ/TQQQ로 확인하며, 레버리지는 단기 변동성에 과민합니다.</div>
              <div className="text-xs text-slate-400 mt-2">{windowLabel}는 누적 반응이며 드로우다운과 구분합니다.</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Stress Day</div>
              <div>MPS {'>='} 70 또는 VIX {'>='} 25 인 날을 의미합니다.</div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-100">Daily AI Analysis (Auto)</h4>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">
                {displayedProvider.toUpperCase()}{displayedModel ? ` · ${displayedModel}` : ''}
              </span>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded border border-white/10 px-2 py-1 text-slate-300 hover:text-white hover:border-white/30"
              >
                Retry
              </button>
            </div>
          </div>
          <div className="mt-4 text-[16px] leading-[1.75] text-slate-200 space-y-3">
            {briefLoading && <div className="text-sm text-slate-400">Loading daily analysis...</div>}
            {!briefLoading && briefError && <div className="text-sm text-red-400">Failed to load daily analysis.</div>}
            {!briefLoading && !briefError && displayedParagraphs.map((line, idx) => (
              <p key={`brief-${idx}`}>{line}</p>
            ))}
            {!briefLoading && !briefError && warnings.length > 0 && (
              <div className="mt-2 text-sm text-slate-300 space-y-1">
                {warnings.map((line, idx) => (
                  <div key={`warn-${idx}`}>{line}</div>
                ))}
              </div>
            )}
            {!briefLoading && !briefError && sources.length > 0 && (
              <div className="mt-3 text-xs text-slate-400 space-y-1">
                <div className="uppercase tracking-wider text-slate-500">Sources</div>
                {sources.slice(0, 3).map((src, idx) => (
                  <div key={`src-${idx}`}>
                    <a className="hover:text-slate-200" href={src.url} target="_blank" rel="noreferrer">
                      {src.title || src.url}
                    </a>
                    {src.date ? ` (${src.date})` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">Manual Review</div>
            <textarea
              className="mt-2 w-full min-h-[110px] rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-white/30"
              placeholder="뉴스 요약/리뷰를 직접 입력하세요 (줄바꿈으로 단락 구분)"
              value={manualDraft}
              onChange={(e) => setManualDraft(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={handleManualSave}
                className="rounded border border-white/10 px-2 py-1 text-slate-300 hover:text-white hover:border-white/30"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleManualClear}
                className="rounded border border-white/10 px-2 py-1 text-slate-300 hover:text-white hover:border-white/30"
              >
                Clear
              </button>
              <label className="flex items-center gap-2 text-slate-400">
                <input
                  type="checkbox"
                  checked={useManual}
                  onChange={(e) => setUseManual(e.target.checked)}
                />
                Use manual text
              </label>
            </div>
          </div>
          <div className="mt-4 text-xs text-slate-500">Auto-generated from the latest snapshot. Interpretation only.</div>
        </div>
      </div>
    </div>
  )
}

