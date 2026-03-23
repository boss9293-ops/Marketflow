'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type LabEvent = {
  event_id: string
  name: string
  start: string
  end: string
  suite_group?: string
  chart_data: Array<{
    date: string
    qqq_n: number | null
    tqqq_n: number | null
    ma200_n: number | null
    qqq_dd: number | null
    in_event: boolean
  }>
  cycle_start: {
    simulation_start_date: string | null
    initial_state: {
      initial_capital: number
      start_price: number
      initial_share_count: number
      initial_pool_cash: number
      stock_allocation_pct: number
    } | null
  }
  execution_playback: {
    // Playback-only archive replay baseline. Arena keeps its own scaled series.
    original_vr: {
      points: Array<{
        date: string
        portfolio_value: number
        pool_cash_after_trade: number
        shares_after_trade: number
        avg_cost_after_trade: number
        state_after_trade: string
      }>
      pool_usage_summary: {
        executed_buy_count: number
        executed_sell_count: number
        executed_defense_count: number
      }
    }
  }
}

type StrategyId = 'original_vr' | 'drawdown_ladder' | 'bottom_reentry' | 'ma200_trend' | 'vr_hybrid'
type ReplaySpeed = 'instant' | '1x' | '5x' | '20x'

interface SimPoint {
  date: string
  portfolio: number
  shares: number
  poolCash: number
  avgCost: number
  buys: number
  sells: number
}

interface SimResult {
  points: SimPoint[]
  buyCount: number
  sellCount: number
  finalEquity: number
  maxDrawdown: number
  recoveryDays: number
  poolRemaining: number
  crashDepth: number
  defenseTiming: number | null
  bottomDetection: number | null
}

interface ChartPoint {
  date: string
  tqqq_bh: number | null
  // Playback-only archive series key. Arena uses original_vr_scaled separately.
  original_vr: number | null
  drawdown_ladder: number | null
  bottom_reentry: number | null
  ma200_trend: number | null
  vr_hybrid: number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STRATEGY_IDS: StrategyId[] = [
  'original_vr', 'drawdown_ladder', 'bottom_reentry', 'ma200_trend', 'vr_hybrid',
]

const STRATEGY_META: Record<StrategyId, { label: string; color: string; desc: string }> = {
  original_vr:      { label: 'Original VR (Playback)', color: '#6366f1', desc: 'Pre-computed archive playback execution; separate from Arena scaled curve' },
  drawdown_ladder:  { label: 'Drawdown Ladder',   color: '#10b981', desc: 'Buy tiers at QQQ DD -15/-25/-35/-45% (25% pool each)' },
  bottom_reentry:   { label: 'Bottom Re-entry',   color: '#f59e0b', desc: 'Deep buy at QQQ DD <= -35%, reversal buy on recovery from -20%' },
  ma200_trend:      { label: 'MA200 Trend',       color: '#ef4444', desc: 'Buy 40% pool on MA200 cross-above, sell 30% on cross-below' },
  vr_hybrid:        { label: 'VR Hybrid',         color: '#8b5cf6', desc: 'Ladder with MA200 size multiplier (1.0x above / 0.5x below)' },
}

const REPLAY_INTERVALS: Record<ReplaySpeed, number> = {
  instant: 0,
  '1x': 150,
  '5x': 30,
  '20x': 10,
}

// ─── Simulation Engine ────────────────────────────────────────────────────────

function toPrice(tqqq_n: number | null, startPrice: number, normBase: number): number | null {
  if (tqqq_n == null || normBase === 0) return null
  return tqqq_n * (startPrice / normBase)
}

function runSimulation(event: LabEvent, strategy: StrategyId): SimResult {
  const state = event.cycle_start.initial_state
  if (!state) {
    return {
      points: [], buyCount: 0, sellCount: 0, finalEquity: 0,
      maxDrawdown: 0, recoveryDays: -1, poolRemaining: 0,
      crashDepth: 0, defenseTiming: null, bottomDetection: null,
    }
  }

  // Original VR (Playback): use pre-computed archive playback points directly.
  if (strategy === 'original_vr') {
    const playbackPoints = event.execution_playback?.original_vr?.points ?? []
    const playbackSummary = event.execution_playback?.original_vr?.pool_usage_summary
    const equities = playbackPoints.map(p => p.portfolio_value)
    let maxDD = 0
    let peakSoFar = equities[0] ?? 0
    for (const v of equities) {
      if (v > peakSoFar) peakSoFar = v
      const dd = peakSoFar > 0 ? (peakSoFar - v) / peakSoFar : 0
      if (dd > maxDD) maxDD = dd
    }
    const peakEquity = Math.max(...equities)
    const peakIdx = equities.indexOf(peakEquity)
    const postPeak = equities.slice(peakIdx)
    const recoveryIdx = postPeak.findIndex((v, i) => i > 0 && v >= peakEquity)

    const inEventPoints = event.chart_data.filter(p => p.in_event)
    const qqq_dds = inEventPoints.map(p => p.qqq_dd ?? 0)
    const crashDepth = Math.abs(Math.min(...qqq_dds, 0))

    return {
      points: playbackPoints.map(p => ({
        date: p.date,
        portfolio: p.portfolio_value,
        shares: p.shares_after_trade,
        poolCash: p.pool_cash_after_trade,
        avgCost: p.avg_cost_after_trade,
        buys: 0,
        sells: 0,
      })),
      buyCount: playbackSummary?.executed_buy_count ?? 0,
      sellCount: playbackSummary?.executed_sell_count ?? 0,
      finalEquity: playbackPoints.length > 0 ? playbackPoints[playbackPoints.length - 1].portfolio_value : 0,
      maxDrawdown: maxDD,
      recoveryDays: recoveryIdx < 0 ? -1 : recoveryIdx,
      poolRemaining: playbackPoints.length > 0 ? playbackPoints[playbackPoints.length - 1].pool_cash_after_trade : 0,
      crashDepth,
      defenseTiming: null,
      bottomDetection: null,
    }
  }

  const { initial_capital, start_price, initial_share_count, initial_pool_cash } = state
  const normPoint = event.chart_data.find(p => p.tqqq_n != null)
  const normBase = normPoint?.tqqq_n ?? 1

  let shares = initial_share_count
  let poolCash = initial_pool_cash
  let avgCost = start_price
  let buyCount = 0
  let sellCount = 0

  const points: SimPoint[] = []
  // Use numeric keys for tiers: -15, -25, -35, -45, -20 (reversal = -20.5)
  const buyLevelsFired = new Set<number>()
  let prevMa200Below = false
  let prevQqqDd = 0
  let defenseTiming: number | null = null
  let bottomDetection: number | null = null
  let dayIdx = 0

  for (const p of event.chart_data) {
    const price = toPrice(p.tqqq_n, start_price, normBase)
    if (price == null) { dayIdx++; continue }

    const ma200Price = toPrice(p.ma200_n, start_price, normBase)
    const isAboveMa200 = ma200Price != null ? price > ma200Price : true
    const qqqDd = p.qqq_dd ?? 0

    if (strategy === 'drawdown_ladder') {
      for (const tier of [-15, -25, -35, -45]) {
        if (!buyLevelsFired.has(tier) && qqqDd <= tier && poolCash > 0) {
          const spend = Math.min(poolCash, initial_pool_cash * 0.25)
          const newShares = Math.floor(spend / price)
          if (newShares > 0) {
            const totalCost = shares * avgCost + newShares * price
            shares += newShares
            avgCost = totalCost / shares
            poolCash -= newShares * price
            buyCount++
            buyLevelsFired.add(tier)
            if (defenseTiming == null && tier <= -35) defenseTiming = dayIdx
          }
        }
      }
      const stockEval = shares * price
      if (stockEval > initial_capital * 1.2 && shares > 0) {
        const sellShares = Math.floor(shares * 0.30)
        if (sellShares > 0) {
          shares -= sellShares
          poolCash += sellShares * price
          sellCount++
        }
      }

    } else if (strategy === 'bottom_reentry') {
      if (!buyLevelsFired.has(-35) && qqqDd <= -35 && poolCash > 0) {
        const spend = Math.min(poolCash, initial_pool_cash * 0.25)
        const newShares = Math.floor(spend / price)
        if (newShares > 0) {
          const totalCost = shares * avgCost + newShares * price
          shares += newShares
          avgCost = totalCost / shares
          poolCash -= newShares * price
          buyCount++
          buyLevelsFired.add(-35)
          if (defenseTiming == null) defenseTiming = dayIdx
        }
      }
      // Reversal buy key = -20.5
      if (!buyLevelsFired.has(-20.5) && prevQqqDd <= -20 && qqqDd > prevQqqDd && poolCash > 0) {
        const spend = Math.min(poolCash, initial_pool_cash * 0.50)
        const newShares = Math.floor(spend / price)
        if (newShares > 0) {
          const totalCost = shares * avgCost + newShares * price
          shares += newShares
          avgCost = totalCost / shares
          poolCash -= newShares * price
          buyCount++
          buyLevelsFired.add(-20.5)
          if (bottomDetection == null) bottomDetection = dayIdx
        }
      }

    } else if (strategy === 'ma200_trend') {
      const nowBelowMa200 = !isAboveMa200
      if (prevMa200Below && !nowBelowMa200 && poolCash > 0) {
        const spend = Math.min(poolCash, initial_pool_cash * 0.40)
        const newShares = Math.floor(spend / price)
        if (newShares > 0) {
          const totalCost = shares * avgCost + newShares * price
          shares += newShares
          avgCost = totalCost / shares
          poolCash -= newShares * price
          buyCount++
          if (bottomDetection == null) bottomDetection = dayIdx
        }
      }
      if (!prevMa200Below && nowBelowMa200 && shares > 0) {
        const sellShares = Math.floor(shares * 0.30)
        if (sellShares > 0) {
          shares -= sellShares
          poolCash += sellShares * price
          sellCount++
          if (defenseTiming == null) defenseTiming = dayIdx
        }
      }
      prevMa200Below = nowBelowMa200

    } else if (strategy === 'vr_hybrid') {
      const sz = isAboveMa200 ? 1.0 : 0.5
      for (const tier of [-10, -20, -30, -40]) {
        if (!buyLevelsFired.has(tier) && qqqDd <= tier && poolCash > 0) {
          const spend = Math.min(poolCash, initial_pool_cash * 0.20 * sz)
          const newShares = Math.floor(spend / price)
          if (newShares > 0) {
            const totalCost = shares * avgCost + newShares * price
            shares += newShares
            avgCost = totalCost / shares
            poolCash -= newShares * price
            buyCount++
            buyLevelsFired.add(tier)
            if (defenseTiming == null && !isAboveMa200) defenseTiming = dayIdx
          }
        }
      }
      const nowBelowMa200 = !isAboveMa200
      if (prevMa200Below && !nowBelowMa200 && shares > 0) {
        const sellShares = Math.floor(shares * 0.20)
        if (sellShares > 0) {
          shares -= sellShares
          poolCash += sellShares * price
          sellCount++
          if (bottomDetection == null) bottomDetection = dayIdx
        }
      }
      prevMa200Below = nowBelowMa200
    }

    prevQqqDd = qqqDd
    dayIdx++
    points.push({
      date: p.date,
      portfolio: Number((shares * price + poolCash).toFixed(2)),
      shares,
      poolCash: Number(poolCash.toFixed(2)),
      avgCost: Number(avgCost.toFixed(2)),
      buys: buyCount,
      sells: sellCount,
    })
  }

  const equities = points.map(pt => pt.portfolio)
  let maxDD = 0
  let peakSoFar = equities[0] ?? initial_capital
  for (const v of equities) {
    if (v > peakSoFar) peakSoFar = v
    const dd = peakSoFar > 0 ? (peakSoFar - v) / peakSoFar : 0
    if (dd > maxDD) maxDD = dd
  }
  const finalEquity = points.length > 0 ? points[points.length - 1].portfolio : initial_capital
  const peakEquity = equities.length > 0 ? Math.max(...equities) : initial_capital
  const peakIdx = equities.indexOf(peakEquity)
  const postPeak = equities.slice(peakIdx)
  const recoveryIdx = postPeak.findIndex((v, i) => i > 0 && v >= peakEquity)

  const inEventPoints = event.chart_data.filter(pt => pt.in_event)
  const qqq_dds = inEventPoints.map(pt => pt.qqq_dd ?? 0)
  const crashDepth = Math.abs(Math.min(...qqq_dds, 0))

  return {
    points,
    buyCount,
    sellCount,
    finalEquity,
    maxDrawdown: maxDD,
    recoveryDays: recoveryIdx < 0 ? -1 : recoveryIdx,
    poolRemaining: points.length > 0 ? points[points.length - 1].poolCash : initial_pool_cash,
    crashDepth,
    defenseTiming,
    bottomDetection,
  }
}

function buildChartData(
  event: LabEvent,
  results: Partial<Record<StrategyId, SimResult>>,
  maxStep: number,
): ChartPoint[] {
  const state = event.cycle_start.initial_state
  if (!state) return []

  const normPoint = event.chart_data.find(p => p.tqqq_n != null)
  const normBase = normPoint?.tqqq_n ?? 1
  const { initial_capital, start_price } = state
  const bhShares = initial_capital / start_price

  const pointMaps: Partial<Record<StrategyId, Map<string, number>>> = {}
  for (const sid of STRATEGY_IDS) {
    const res = results[sid]
    if (!res) continue
    const map = new Map<string, number>()
    for (const pt of res.points) map.set(pt.date, pt.portfolio)
    pointMaps[sid] = map
  }

  return event.chart_data.slice(0, maxStep + 1).map(p => {
    const tqqq_price = toPrice(p.tqqq_n, start_price, normBase)
    return {
      date: p.date,
      tqqq_bh: tqqq_price != null ? Number((bhShares * tqqq_price).toFixed(2)) : null,
      // Playback-only archive series. Arena renders Original VR (Scaled) separately.
      original_vr:     pointMaps['original_vr']?.get(p.date) ?? null,
      drawdown_ladder: pointMaps['drawdown_ladder']?.get(p.date) ?? null,
      bottom_reentry:  pointMaps['bottom_reentry']?.get(p.date) ?? null,
      ma200_trend:     pointMaps['ma200_trend']?.get(p.date) ?? null,
      vr_hybrid:       pointMaps['vr_hybrid']?.get(p.date) ?? null,
    }
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  events: LabEvent[]
}

export function StrategyLabTab({ events }: Props) {
  const [selectedEventId, setSelectedEventId] = useState<string>(events[0]?.event_id ?? '')
  const [enabledStrategies, setEnabledStrategies] = useState<Set<StrategyId>>(
    new Set<StrategyId>(STRATEGY_IDS),
  )
  const [results, setResults] = useState<Partial<Record<StrategyId, SimResult>>>({})
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>('instant')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedEvent = events.find(e => e.event_id === selectedEventId) ?? events[0]

  const stopReplay = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsPlaying(false)
  }, [])

  useEffect(() => {
    if (!selectedEvent) return
    stopReplay()
    setRunning(true)
    setTimeout(() => {
      const newResults: Partial<Record<StrategyId, SimResult>> = {}
      for (const sid of STRATEGY_IDS) {
        if (enabledStrategies.has(sid)) {
          newResults[sid] = runSimulation(selectedEvent, sid)
        }
      }
      const steps = selectedEvent.chart_data.length - 1
      setResults(newResults)
      setTotalSteps(steps)
      setCurrentStep(replaySpeed === 'instant' ? steps : 0)
      setRunning(false)
    }, 16)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId, enabledStrategies])

  useEffect(() => {
    if (!selectedEvent || Object.keys(results).length === 0) return
    setChartData(buildChartData(selectedEvent, results, currentStep))
  }, [selectedEvent, results, currentStep])

  useEffect(() => {
    if (!isPlaying) return
    if (replaySpeed === 'instant') {
      setCurrentStep(totalSteps)
      setIsPlaying(false)
      return
    }
    const ms = REPLAY_INTERVALS[replaySpeed]
    intervalRef.current = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= totalSteps) { stopReplay(); return prev }
        return prev + 1
      })
    }, ms)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isPlaying, replaySpeed, totalSteps, stopReplay])

  const handlePlay = () => {
    if (currentStep >= totalSteps) setCurrentStep(0)
    setIsPlaying(true)
  }
  const handleEnd = () => { stopReplay(); setCurrentStep(totalSteps) }
  const handleReset = () => { stopReplay(); setCurrentStep(0) }

  const toggleStrategy = (sid: StrategyId) => {
    setEnabledStrategies(prev => {
      const next = new Set(prev)
      if (next.has(sid)) next.delete(sid)
      else next.add(sid)
      return next
    })
  }

  const initialCapital = selectedEvent?.cycle_start.initial_state?.initial_capital ?? 100000
  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const fmtPct = (v: number) => (v * 100).toFixed(1) + '%'

  // B&H equity for results table
  const bhFinalEquity = (() => {
    if (!selectedEvent?.cycle_start.initial_state) return null
    const { initial_capital: ic, start_price: sp } = selectedEvent.cycle_start.initial_state
    const normPoint = selectedEvent.chart_data.find(p => p.tqqq_n != null)
    const normBase = normPoint?.tqqq_n ?? 1
    const last = selectedEvent.chart_data[selectedEvent.chart_data.length - 1]
    const finalPrice = toPrice(last?.tqqq_n ?? null, sp, normBase)
    if (finalPrice == null) return null
    return (ic / sp) * finalPrice
  })()

  const bhMaxDD = (() => {
    if (!selectedEvent?.cycle_start.initial_state) return 0
    const { initial_capital: ic, start_price: sp } = selectedEvent.cycle_start.initial_state
    const normPoint = selectedEvent.chart_data.find(p => p.tqqq_n != null)
    const normBase = normPoint?.tqqq_n ?? 1
    const bhShares = ic / sp
    let peak = 0, maxDD = 0
    for (const p of selectedEvent.chart_data) {
      const price = toPrice(p.tqqq_n, sp, normBase)
      if (price == null) continue
      const val = bhShares * price
      if (val > peak) peak = val
      const dd = peak > 0 ? (peak - val) / peak : 0
      if (dd > maxDD) maxDD = dd
    }
    return maxDD
  })()

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header + Event Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#c7d2fe', letterSpacing: 1 }}>
          STRATEGY LAB
        </div>
        <select
          value={selectedEventId}
          onChange={e => setSelectedEventId(e.target.value)}
          style={{
            background: 'rgba(30,27,75,0.8)', border: '1px solid rgba(99,102,241,0.35)',
            color: '#e2e8f0', padding: '4px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          {events.map(ev => (
            <option key={ev.event_id} value={ev.event_id}>
              {ev.event_id} — {ev.name}
            </option>
          ))}
        </select>
        {running && (
          <span style={{ fontSize: 11, color: '#a5b4fc', opacity: 0.7 }}>Simulating…</span>
        )}
      </div>

      {/* Strategy Selector */}
      <div style={{
        background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8, padding: '12px 14px',
      }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }}>STRATEGIES</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STRATEGY_IDS.map(sid => {
            const meta = STRATEGY_META[sid]
            const active = enabledStrategies.has(sid)
            return (
              <button
                key={sid}
                onClick={() => toggleStrategy(sid)}
                title={meta.desc}
                style={{
                  background: active ? `${meta.color}22` : 'rgba(30,27,75,0.5)',
                  border: `1px solid ${active ? meta.color : 'rgba(99,102,241,0.2)'}`,
                  color: active ? meta.color : '#64748b',
                  padding: '4px 10px', borderRadius: 5, fontSize: 11,
                  cursor: 'pointer', fontWeight: active ? 600 : 400, transition: 'all 0.15s',
                }}
              >
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Replay Controls */}
      <div style={{
        background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8, padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 0.5, minWidth: 50 }}>REPLAY</div>
          {(['instant', '1x', '5x', '20x'] as ReplaySpeed[]).map(s => (
            <button
              key={s}
              onClick={() => { stopReplay(); setReplaySpeed(s) }}
              style={{
                background: replaySpeed === s ? 'rgba(99,102,241,0.3)' : 'rgba(30,27,75,0.5)',
                border: `1px solid ${replaySpeed === s ? '#6366f1' : 'rgba(99,102,241,0.2)'}`,
                color: replaySpeed === s ? '#a5b4fc' : '#64748b',
                padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
              }}
            >{s}</button>
          ))}
          <div style={{ width: 1, height: 16, background: 'rgba(99,102,241,0.2)' }} />
          <button
            onClick={isPlaying ? stopReplay : handlePlay}
            disabled={replaySpeed === 'instant'}
            style={{
              background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)',
              color: '#a5b4fc', padding: '3px 12px', borderRadius: 4, fontSize: 11,
              cursor: replaySpeed === 'instant' ? 'not-allowed' : 'pointer',
              opacity: replaySpeed === 'instant' ? 0.4 : 1,
            }}
          >{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
          <button
            onClick={handleEnd}
            style={{
              background: 'rgba(30,27,75,0.5)', border: '1px solid rgba(99,102,241,0.2)',
              color: '#94a3b8', padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}
          >⏭ End</button>
          <button
            onClick={handleReset}
            style={{
              background: 'rgba(30,27,75,0.5)', border: '1px solid rgba(99,102,241,0.2)',
              color: '#94a3b8', padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}
          >⏮ Reset</button>
          <div style={{ flex: 1, minWidth: 100 }}>
            <div style={{ height: 4, background: 'rgba(99,102,241,0.15)', borderRadius: 2 }}>
              <div style={{
                height: '100%', borderRadius: 2, background: '#6366f1', transition: 'width 0.1s',
                width: totalSteps > 0 ? `${(currentStep / totalSteps) * 100}%` : '0%',
              }} />
            </div>
          </div>
          <span style={{ fontSize: 10, color: '#64748b', minWidth: 60, textAlign: 'right' }}>
            {currentStep}/{totalSteps}
          </span>
        </div>
      </div>

      {/* Equity Curve Chart */}
      <div style={{
        background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8, padding: '12px 14px',
      }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }}>EQUITY CURVES</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickFormatter={d => String(d ?? '').slice(0, 7)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,10,40,0.95)', border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 6, fontSize: 11,
              }}
              formatter={(v: unknown) => [`$${fmt(Number(v))}`, '']}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Line dataKey="tqqq_bh" stroke="#94a3b8" strokeWidth={1.5} dot={false}
              isAnimationActive={false} strokeDasharray="4 2" name="TQQQ B&H" />
            {STRATEGY_IDS.filter(sid => enabledStrategies.has(sid)).map(sid => (
              <Line
                key={sid}
                dataKey={sid}
                stroke={STRATEGY_META[sid].color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                name={STRATEGY_META[sid].label}
              />
            ))}
            <ReferenceLine y={initialCapital} stroke="rgba(99,102,241,0.3)" strokeDasharray="2 2" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 20, height: 2, background: '#94a3b8', opacity: 0.6 }} />
            <span style={{ fontSize: 10, color: '#64748b' }}>TQQQ B&amp;H</span>
          </div>
          {STRATEGY_IDS.filter(sid => enabledStrategies.has(sid)).map(sid => (
            <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 20, height: 2, background: STRATEGY_META[sid].color }} />
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{STRATEGY_META[sid].label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Results Table */}
      <div style={{
        background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8, padding: '12px 14px',
      }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }}>RESULTS</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(99,102,241,0.2)' }}>
                {['Strategy', 'Final Equity', 'Return', 'Max DD', 'Recovery', 'Pool Left', 'Buys', 'Sells'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: '#64748b', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bhFinalEquity != null && (
                <tr style={{ borderBottom: '1px solid rgba(99,102,241,0.08)', opacity: 0.6 }}>
                  <td style={{ padding: '4px 8px', color: '#94a3b8' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', marginRight: 4 }} />
                    TQQQ B&amp;H
                  </td>
                  <td style={{ padding: '4px 8px', color: '#e2e8f0' }}>${fmt(bhFinalEquity)}</td>
                  <td style={{ padding: '4px 8px', color: bhFinalEquity >= initialCapital ? '#10b981' : '#ef4444' }}>
                    {fmtPct((bhFinalEquity - initialCapital) / initialCapital)}
                  </td>
                  <td style={{ padding: '4px 8px', color: '#ef4444' }}>{fmtPct(bhMaxDD)}</td>
                  <td style={{ padding: '4px 8px', color: '#94a3b8' }}>—</td>
                  <td style={{ padding: '4px 8px', color: '#94a3b8' }}>—</td>
                  <td style={{ padding: '4px 8px', color: '#94a3b8' }}>—</td>
                  <td style={{ padding: '4px 8px', color: '#94a3b8' }}>—</td>
                </tr>
              )}
              {STRATEGY_IDS.filter(sid => enabledStrategies.has(sid) && results[sid]).map(sid => {
                const r = results[sid]!
                const ret = (r.finalEquity - initialCapital) / initialCapital
                const meta = STRATEGY_META[sid]
                return (
                  <tr key={sid} style={{ borderBottom: '1px solid rgba(99,102,241,0.08)' }}>
                    <td style={{ padding: '4px 8px' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: meta.color, marginRight: 4 }} />
                      <span style={{ color: meta.color }}>{meta.label}</span>
                    </td>
                    <td style={{ padding: '4px 8px', color: '#e2e8f0' }}>${fmt(r.finalEquity)}</td>
                    <td style={{ padding: '4px 8px', color: ret >= 0 ? '#10b981' : '#ef4444' }}>{fmtPct(ret)}</td>
                    <td style={{ padding: '4px 8px', color: '#ef4444' }}>{fmtPct(r.maxDrawdown)}</td>
                    <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{r.recoveryDays < 0 ? 'N/A' : `${r.recoveryDays}d`}</td>
                    <td style={{ padding: '4px 8px', color: '#a5b4fc' }}>${fmt(r.poolRemaining)}</td>
                    <td style={{ padding: '4px 8px', color: '#10b981' }}>{r.buyCount}</td>
                    <td style={{ padding: '4px 8px', color: '#f59e0b' }}>{r.sellCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Crash Analysis */}
      <div style={{
        background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8, padding: '12px 14px',
      }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }}>CRASH ANALYSIS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {STRATEGY_IDS.filter(sid => enabledStrategies.has(sid) && results[sid]).map(sid => {
            const r = results[sid]!
            const meta = STRATEGY_META[sid]
            return (
              <div key={sid} style={{
                background: 'rgba(15,10,40,0.5)', border: `1px solid ${meta.color}33`,
                borderRadius: 6, padding: '8px 12px', minWidth: 160,
              }}>
                <div style={{ fontSize: 10, color: meta.color, fontWeight: 600, marginBottom: 6 }}>
                  {meta.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10, color: '#64748b' }}>Crash Depth</span>
                    <span style={{ fontSize: 10, color: '#ef4444' }}>{r.crashDepth.toFixed(1)}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10, color: '#64748b' }}>Defense Timing</span>
                    <span style={{ fontSize: 10, color: '#f59e0b' }}>
                      {r.defenseTiming != null ? `Day ${r.defenseTiming}` : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10, color: '#64748b' }}>Bottom Detection</span>
                    <span style={{ fontSize: 10, color: '#10b981' }}>
                      {r.bottomDetection != null ? `Day ${r.bottomDetection}` : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10, color: '#64748b' }}>Recovery Days</span>
                    <span style={{ fontSize: 10, color: '#a5b4fc' }}>
                      {r.recoveryDays < 0 ? 'Not yet' : `${r.recoveryDays}d`}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
          {Object.keys(results).length === 0 && (
            <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
              Enable strategies to see crash analysis
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
