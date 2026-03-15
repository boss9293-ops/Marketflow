'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine
} from 'recharts'
import { getGlossaryTitle } from '@/lib/macro/glossary'
import ConditionStudyCard, { type ConditionStudyCache } from '@/components/macro/ConditionStudyCard'
import MarkdownRenderer from '@/components/shared/MarkdownRenderer'

type ValidationSummary = {
  policy_version: string
  window: string
  start_date: string
  end_date: string
  metrics: {
    avg_lead_time_vix: number | null
    avg_lead_time_dd: number | null
    false_alarm_rate: number
    coverage: number
    stability_95: number
    counts: {
      macro: number
      vix: number
      dd: number
      false_alarms: number
    }
  }
  events: {
    macro_events: any[]
    vix_events: any[]
    dd_events: any[]
  }
}

type ValidationTimeseries = {
  date: string[]
  MPS: number[]
  LPI: number[]
  RPI: number[]
  VRI: number[]
  VIX: number[]
  QQQ: number[]
  drawdown: number[]
  tqqq_drawdown: number[] | null
  ytd_return?: number[] | null
  tqqq_ytd_return?: number[] | null
  is_mps_ge_70: boolean[]
  is_vix_ge_25: boolean[]
  is_dd_le_neg10: boolean[]
  is_tqqq_dd_le_neg30: boolean[] | null
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'

export default function ValidationRoom({ conditionStudy }: { conditionStudy?: ConditionStudyCache | null }) {
  const [selectedWindow, setSelectedWindow] = useState('2020')
  const [summary, setSummary] = useState<ValidationSummary | null>(null)
  const [timeseries, setTimeseries] = useState<ValidationTimeseries | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playbackMarkdown, setPlaybackMarkdown] = useState<string>('')
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [selectedWindow])

  useEffect(() => {
    const slugMap: Record<string, string> = {
      '2020': '2020-crisis',
      '2022': '2022-tightening',
      '2024': '2024-yen-carry',
      '2025': '2025-tariff-shock',
    }
    const slug = slugMap[selectedWindow]
    if (!slug) {
      setPlaybackMarkdown('')
      setPlaybackError(null)
      setPlaybackLoading(false)
      return
    }

    let active = true
    setPlaybackLoading(true)
    setPlaybackError(null)
    fetch(`/api/playback-events/${slug}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load narrative')
        return res.text()
      })
      .then((content) => {
        if (!active) return
        setPlaybackMarkdown(content)
      })
      .catch((err: Error) => {
        if (!active) return
        setPlaybackError(err.message)
      })
      .finally(() => {
        if (!active) return
        setPlaybackLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedWindow])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sumRes, tsRes] = await Promise.all([
        fetch(`${API_BASE}/api/macro/validation/summary?window=${selectedWindow}`),
        fetch(`${API_BASE}/api/macro/validation/timeseries?window=${selectedWindow}`)
      ])

      if (!sumRes.ok || !tsRes.ok) {
        const sumErr = !sumRes.ok  ?  await sumRes.text().catch(() => '') : ''
        const tsErr = !tsRes.ok  ?  await tsRes.text().catch(() => '') : ''
        throw new Error(sumErr || tsErr || 'Failed to fetch validation data')
      }

      const sumData = await sumRes.json()
      const tsData = await tsRes.json()

      setSummary(sumData)
      setTimeseries(tsData)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const eventSummary = useMemo(() => {
    if (!timeseries?.date?.length) return null
    const dates = timeseries.date || []
    if (!dates.length) return null
    const startDate = dates[0]
    const endDate = dates[dates.length - 1]
    const n = dates.length

    const qqqSeries = Array.isArray(timeseries.QQQ)  ?  timeseries.QQQ : []
    const vixSeries = Array.isArray(timeseries.VIX)  ?  timeseries.VIX : []
    const mpsSeries = Array.isArray(timeseries.MPS)  ?  timeseries.MPS : []
    const ytdSeries = Array.isArray(timeseries.ytd_return)  ?  (timeseries.ytd_return as number[]) : []
    const tqqqYtdSeries = Array.isArray(timeseries.tqqq_ytd_return)  ?  (timeseries.tqqq_ytd_return as number[]) : []

    const qqqStart = qqqSeries[0]
    const qqqEnd = qqqSeries[qqqSeries.length - 1]
    const qqqReturn = typeof qqqStart === 'number' && typeof qqqEnd === 'number' && qqqStart !== 0
       ?  ((qqqEnd / qqqStart) - 1) * 100
      : null

    const tqqqReturn =
      tqqqYtdSeries.length >= 2
         ?  (tqqqYtdSeries[tqqqYtdSeries.length - 1] - tqqqYtdSeries[0]) * 100
        : null

    const buildSyntheticPrice = (ytdArr: number[]) => {
      if (!ytdArr.length) return []
      return ytdArr.map((v) => 100 * (1 + v))
    }

    const computeBestWorst5d = (series: number[]) => {
      if (series.length < 5) return null
      let minVal = Infinity
      let maxVal = -Infinity
      let minIdx = 4
      let maxIdx = 4
      for (let i = 4; i < series.length; i++) {
        const base = series[i - 4]
        const cur = series[i]
        if (typeof base !== 'number' || typeof cur !== 'number' || base === 0) continue
        const ret = ((cur / base) - 1) * 100
        if (ret < minVal) {
          minVal = ret
          minIdx = i
        }
        if (ret > maxVal) {
          maxVal = ret
          maxIdx = i
        }
      }
      if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return null
      return {
        worst: { value: minVal, end: minIdx },
        best: { value: maxVal, end: maxIdx },
      }
    }

    const qqqSeriesFor5d =
      qqqSeries.length >= 5
         ?  qqqSeries
        : ytdSeries.length >= 5
           ?  buildSyntheticPrice(ytdSeries)
          : []
    const tqqqSeriesFor5d =
      tqqqYtdSeries.length >= 5
         ?  buildSyntheticPrice(tqqqYtdSeries)
        : []

    const qqq5d = computeBestWorst5d(qqqSeriesFor5d)
    const tqqq5d = computeBestWorst5d(tqqqSeriesFor5d)

    let qqqReturnFallback: number | null = null
    if (qqqReturn == null && ytdSeries.length >= 2) {
      qqqReturnFallback = (ytdSeries[ytdSeries.length - 1] - ytdSeries[0]) * 100
    }

    const maxVix = vixSeries.reduce((acc, v, idx) => {
      if (typeof v !== 'number') return acc
      if (!acc || v > acc.value) return { value: v, date: dates[idx] }
      return acc
    }, null as null | { value: number; date: string })

    const mpsStats = mpsSeries.reduce((acc, v, idx) => {
      if (typeof v !== 'number') return acc
      const date = dates[idx]
      if (!acc) return { min: v, max: v, maxDate: date }
      const min = v < acc.min  ?  v : acc.min
      const max = v > acc.max  ?  v : acc.max
      const maxDate = v > acc.max  ?  date : acc.maxDate
      return { min, max, maxDate }
    }, null as null | { min: number; max: number; maxDate: string })

    const stressDays = dates.reduce((acc, _d, idx) => {
      const mps = mpsSeries[idx]
      const vix = vixSeries[idx]
      const isStress = (typeof mps === 'number' && mps >= 70) || (typeof vix === 'number' && vix >= 25)
      return acc + (isStress  ?  1 : 0)
    }, 0)

    return {
      n,
      startDate,
      endDate,
      qqqReturn,
      qqqReturnFallback,
      tqqqReturn,
      maxVix,
      mpsStats,
      stressDays,
      qqq5d,
      tqqq5d,
    }
  }, [timeseries])

  const windowSnapshot = useMemo(() => {
    if (!eventSummary || !timeseries?.date?.length) return null
    const dates = timeseries.date
    const worstQqq = eventSummary.qqq5d?.worst
    const worstTqqq = eventSummary.tqqq5d?.worst
    return {
      mpsMax: eventSummary.mpsStats  ?  { value: eventSummary.mpsStats.max, date: eventSummary.mpsStats.maxDate } : null,
      vixMax: eventSummary.maxVix  ?  { value: eventSummary.maxVix.value, date: eventSummary.maxVix.date } : null,
      worst5: {
        qqq: worstQqq
           ?  { value: worstQqq.value, start: dates[worstQqq.end - 4], end: dates[worstQqq.end] }
          : null,
        tqqq: worstTqqq
           ?  { value: worstTqqq.value, start: dates[worstTqqq.end - 4], end: dates[worstTqqq.end] }
          : null,
      },
    }
  }, [eventSummary, timeseries?.date])

  const usesYtd = Array.isArray(timeseries?.ytd_return)
  const usesTqqqYtd = Array.isArray(timeseries?.tqqq_ytd_return)
  const ytdSeries = useMemo(() => {
    if (!timeseries?.date?.length) return []
    if (usesYtd) return timeseries.ytd_return as number[]
    if (Array.isArray(timeseries.QQQ) && timeseries.QQQ.length) {
      const base = timeseries.QQQ[0] || 1
      return timeseries.QQQ.map((v) => (base  ?  (v / base) - 1 : 0))
    }
    return []
  }, [timeseries, usesYtd])
  const tqqqYtdSeries = useMemo(() => {
    if (!timeseries?.date?.length) return []
    if (usesTqqqYtd) return timeseries.tqqq_ytd_return as number[]
    return []
  }, [timeseries, usesTqqqYtd])

  const chartData = useMemo(() => {
    if (!timeseries?.date?.length) return []
    return timeseries.date.map((d, i) => ({
      date: d,
      MPS: timeseries.MPS[i],
      VIX: timeseries.VIX[i],
      QQQ: timeseries.QQQ[i],
      QQQ_YTD: typeof ytdSeries[i] === 'number'  ?  50 + (ytdSeries[i] * 100) : null,
      TQQQ_YTD: typeof tqqqYtdSeries[i] === 'number'  ?  50 + (tqqqYtdSeries[i] * 100) : null,
      isMPS: timeseries.is_mps_ge_70[i],
      isVIX: timeseries.is_vix_ge_25[i],
      isDD: timeseries.is_dd_le_neg10[i],
      isTQQQ: timeseries.is_tqqq_dd_le_neg30  ?  timeseries.is_tqqq_dd_le_neg30[i] : false,
    }))
  }, [timeseries, ytdSeries, tqqqYtdSeries])
  const chartDataWindow = useMemo(() => {
    if (selectedWindow === '2020' || selectedWindow === '2022' || selectedWindow === '2024' || selectedWindow === '2025') {
      const start = `${selectedWindow}-01-01`
      const end = `${selectedWindow}-12-31`
      const filtered = chartData.filter((row) => row.date >= start && row.date <= end)
      return filtered.length ? filtered : chartData
    }
    return chartData.length > 60 ? chartData.slice(-60) : chartData
  }, [chartData, selectedWindow])
    if (loading) return <div className="p-10 text-center text-slate-400">Loading historical validation data...</div>
  if (error) return <div className="p-10 text-center text-red-400">Error: {error}</div>
  if (!summary || !timeseries) return null

  const windows = ['2020', '2022', '2024', '2025', 'baseline'] as const
  const windowLabel = (w: (typeof windows)[number]) => {
    if (w === '2020') return '2020 Crisis'
    if (w === '2022') return '2022 Tightening'
    if (w === '2024') return '2024 Yen Carry Shock'
    if (w === '2025') return '2025 Tariff Shock'
    return 'Baseline (2017-19)'
  }

  const legendFormatter = (value: string) => {
    const mpsTitle = getGlossaryTitle('MPS')
    const vixTitle = getGlossaryTitle('VIX')
    const ytdTitle = getGlossaryTitle('QQQ_TQQQ_YTD')
    const title =
      value === 'Macro Pressure Score'
         ?  mpsTitle
        : value === 'VIX'
           ?  vixTitle
          : value.includes('YTD')
             ?  ytdTitle
            : 'Drawdown: peak-to-trough decline.'
    return <span title={title}>{value}</span>
  }

  
  
  
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Window Selector */}
      <div className="flex items-center gap-2 bg-[#1a1a1a] p-1 rounded-xl border border-[#2a2a2a] w-fit flex-wrap">
        {windows.map((w) => {
          const isActive = selectedWindow === w
          return (
            <button
              key={w}
              onClick={() => setSelectedWindow(w)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${isActive
                  ? 'bg-white/10 text-white border border-white/10'
                  : 'text-slate-400 hover:text-white'}`}
            >
              {windowLabel(w)}
            </button>
          )
        })}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs uppercase tracking-wider text-slate-400">Window</div>
        <div className="text-xs text-slate-300">
          {summary.start_date}{' -> '}{summary.end_date} | {summary.window || '--'}
        </div>
      </div>

      {/* Primary Timeline Chart */}
      <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">Historical Playback Timeline</h3>
          <div className="flex gap-4 text-[10px] text-slate-400 text-right">
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-500/20 rounded-sm"></div> MPS {'>'}= 70</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500/20 rounded-sm"></div> Stress (VIX/QQQ)</div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300 mb-3">
          This chart summarizes macro pressure, volatility, and price response for the selected historical window.
          <br />
          It is designed for historical interpretation and playback, not prediction.
        </div>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartDataWindow}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#9ca3af"
                tick={{ fill: '#cbd5f5', fontSize: 10 }}
                tickFormatter={(d) => d.slice(5)}
                minTickGap={30}
              />
              <YAxis yAxisId="left" stroke="#888" fontSize={10} domain={[0, 100]} />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#888"
                fontSize={10}
                domain={[0, 100]}
                tick={{ fill: '#cbd5f5', fontSize: 10 }}
              />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (value == null || Number.isNaN(value)) return ['--', name]
                  const v = typeof value === 'number'  ?  value : Number(value)
                  if (name.includes('YTD')) return [`${(v - 50).toFixed(2)}%`, name]
                  return [v.toFixed(2), name]
                }}
                labelFormatter={(label) => `Date: ${label}`}
                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px', fontSize: '11px' }}
                itemStyle={{ padding: '2px 0' }}
              />
              <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} formatter={legendFormatter} />

              <ReferenceLine
                yAxisId="left"
                y={70}
                stroke="#f59e0b"
                strokeOpacity={0.4}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'MPS 70', position: 'insideRight', fill: '#fbbf24', fontSize: 10 }}
              />
              <ReferenceLine
                yAxisId="left"
                y={85}
                stroke="#ef4444"
                strokeOpacity={0.4}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'MPS 85', position: 'insideRight', fill: '#f87171', fontSize: 10 }}
              />
              <ReferenceLine
                yAxisId="left"
                y={25}
                stroke="#f59e0b"
                strokeOpacity={0.35}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'VIX 25', position: 'insideRight', fill: '#fbbf24', fontSize: 10 }}
              />
              <ReferenceLine
                yAxisId="left"
                y={35}
                stroke="#ef4444"
                strokeOpacity={0.35}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: 'VIX 35', position: 'insideRight', fill: '#f87171', fontSize: 10 }}
              />

              {/* Pressure Highlight Zones (MPS >= 70) */}
              {chartDataWindow.map((d, i) => {
                if (d.isMPS) {
                  return <ReferenceArea key={`mps-${i}`} x1={d.date} x2={chartDataWindow[i + 1]?.date || d.date} yAxisId="left" fill="#10b981" fillOpacity={0.08} stroke="none" />
                }
                return null
              })}

              {/* Stress Highlight Zones (VIX >= 25 or DD <= -10%) */}
              {chartDataWindow.map((d, i) => {
                if (d.isVIX || d.isDD) {
                  return <ReferenceArea key={`stress-${i}`} x1={d.date} x2={chartDataWindow[i + 1]?.date || d.date} yAxisId="left" fill="#ef4444" fillOpacity={0.08} stroke="none" />
                }
                return null
              })}

              <Line yAxisId="left" type="monotone" dataKey="MPS" stroke="#10b981" strokeWidth={2} dot={false} name="Macro Pressure Score" />
              <Line yAxisId="left" type="monotone" dataKey="VIX" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="VIX" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="QQQ_YTD"
                stroke="#ef4444"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                name="QQQ YTD"
              />
              {chartDataWindow.some(d => d.TQQQ_YTD != null) && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="TQQQ_YTD"
                  stroke="#f97316"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  name="TQQQ YTD"
                  connectNulls={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      <div className="text-[11px] text-slate-500 mt-2">
        Tip: MPS = environment pressure, VIX = volatility regime, YTD% = cumulative response.
      </div>
    </div>

    {eventSummary && (
      <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-[#2a2a2a]">
        <div className="text-sm font-semibold text-slate-100 mb-3">Event Summary</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">Window</div>
            <div className="text-slate-100 font-semibold">
              {eventSummary.startDate}{' -> '}{eventSummary.endDate} | {eventSummary.n} trading days
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">QQQ Return (Window)</div>
            <div className="text-slate-100 font-semibold">
              {eventSummary.qqqReturn != null
                 ?  `${eventSummary.qqqReturn.toFixed(2)}%`
                : eventSummary.qqqReturnFallback != null
                   ?  `${eventSummary.qqqReturnFallback.toFixed(2)}%`
                  : '--'}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">TQQQ Return (Window)</div>
            <div className="text-slate-100 font-semibold">
              {eventSummary.tqqqReturn != null
                 ?  `${eventSummary.tqqqReturn.toFixed(2)}%`
                : '--'}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">Max VIX in Window</div>
            <div className="text-slate-100 font-semibold">
              {eventSummary.maxVix  ?  `${eventSummary.maxVix.value.toFixed(2)} (${eventSummary.maxVix.date})` : '--'}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">MPS: min / max in Window</div>
            <div className="text-slate-100 font-semibold">
              {eventSummary.mpsStats
                 ?  `${eventSummary.mpsStats.min.toFixed(0)} -> ${eventSummary.mpsStats.max.toFixed(0)} (${eventSummary.mpsStats.maxDate})`
                : '--'}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-400">Stress Days</div>
            <div className="text-slate-100 font-semibold">{eventSummary.stressDays}</div>
          </div>
        </div>
        <div className="mt-4 border-t border-white/10 pt-3 text-sm">
          <div className="text-xs text-slate-400 mb-2">Speed (5D)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="text-xs text-slate-400">Worst 5D Drop (QQQ)</div>
              <div className="text-slate-100 font-semibold">
                {eventSummary.qqq5d
                   ?  `${eventSummary.qqq5d.worst.value.toFixed(2)}% (${timeseries.date[eventSummary.qqq5d.worst.end - 4]} -> ${timeseries.date[eventSummary.qqq5d.worst.end]})`
                  : '--'}
              </div>
              <div className="text-xs text-slate-400 mt-2">Best 5D Rebound (QQQ)</div>
              <div className="text-slate-100 font-semibold">
                {eventSummary.qqq5d
                   ?  `${eventSummary.qqq5d.best.value.toFixed(2)}% (${timeseries.date[eventSummary.qqq5d.best.end - 4]} -> ${timeseries.date[eventSummary.qqq5d.best.end]})`
                  : '--'}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="text-xs text-slate-400">Worst 5D Drop (TQQQ)</div>
              <div className="text-slate-100 font-semibold">
                {eventSummary.tqqq5d
                   ?  `${eventSummary.tqqq5d.worst.value.toFixed(2)}% (${timeseries.date[eventSummary.tqqq5d.worst.end - 4]} -> ${timeseries.date[eventSummary.tqqq5d.worst.end]})`
                  : '--'}
              </div>
              <div className="text-xs text-slate-400 mt-2">Best 5D Rebound (TQQQ)</div>
              <div className="text-slate-100 font-semibold">
                {eventSummary.tqqq5d
                   ?  `${eventSummary.tqqq5d.best.value.toFixed(2)}% (${timeseries.date[eventSummary.tqqq5d.best.end - 4]} -> ${timeseries.date[eventSummary.tqqq5d.best.end]})`
                  : '--'}
              </div>
            </div>
          </div>
        </div>
        <div className="text-[11px] text-slate-500 mt-3">
          Stress Days = days with (MPS {'>='} 70) OR (VIX {'>='} 25)
        </div>
      </div>
    )}


    <ConditionStudyCard conditionStudy={conditionStudy} windowSnapshot={windowSnapshot} />

    <div className="bg-[#1a1a1a] rounded-2xl border border-[#2a2a2a] p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="text-lg font-semibold">Narrative Analysis</div>
        <div className="text-xs text-slate-400">Blog-style playback narrative</div>
      </div>
      {playbackLoading && <div className="text-sm text-slate-400">Loading narrative...</div>}
      {!playbackLoading && playbackError && (
        <div className="text-sm text-red-400">Failed to load narrative.</div>
      )}
      {!playbackLoading && !playbackError && playbackMarkdown ? (
        <div className="text-[15px] leading-[1.8] text-slate-200">
          <MarkdownRenderer content={playbackMarkdown} />
        </div>
      ) : null}
      {!playbackLoading && !playbackError && !playbackMarkdown && (
        <div className="text-sm text-slate-400">Narrative is available for 2020/2022/2024/2025 windows only.</div>
      )}
    </div>

    </div>
  )
}
