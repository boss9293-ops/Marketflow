'use client'

import { useState, useMemo } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'

// ── Types ──────────────────────────────────────────────────────────────────
type CurvePoint = { date: string; bh: number; strat: number; in_mkt: boolean }
type EventRecord = { id: number; name: string; start: string; end: string; peak_score: number; peak_level: number; qqq_drawdown_pct: number; fwd_ret_1m: number | null; fwd_ret_3m: number | null; fwd_ret_6m: number | null; duration_days: number }
type BtStats = { start_date: string; end_date: string; years: number; sell_rule: string; buy_rule: string; bh: { total_return: number; ann_return: number; max_drawdown: number }; strategy: { total_return: number; ann_return: number; max_drawdown: number }; days_in_cash: number; days_total: number; cash_pct: number }

export type BacktestData = {
  backtest: BtStats
  events: EventRecord[]
  backtest_curve: CurvePoint[]
}

// ── Constants ──────────────────────────────────────────────────────────────
const LEVEL_COLORS: Record<number, string> = {
  0: '#22c55e', 1: '#f59e0b', 2: '#f97316', 3: '#ef4444', 4: '#7c3aed',
}

const PERIODS = ['1Y', '3Y', '5Y', '10Y', '20Y', 'All'] as const
type Period = typeof PERIODS[number]

const PERIOD_DAYS: Record<Period, number | null> = {
  '1Y':  365,
  '3Y':  365 * 3,
  '5Y':  365 * 5,
  '10Y': 365 * 10,
  '20Y': 365 * 20,
  'All': null,
}

const VIEWS = ['누적 수익률', '드로다운', '이벤트별 성과'] as const
type ViewKey = typeof VIEWS[number]

// ── Helpers ────────────────────────────────────────────────────────────────
function card(extra?: object) {
  return {
    background: '#111318',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: '1.3rem 1.43rem',
    ...extra,
  } as const
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '0.91rem 1.1rem' }}>
      <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.56rem', fontWeight: 900, color: color ?? '#f3f4f6', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.81rem', color: '#9ca3af', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ── Date Input ─────────────────────────────────────────────────────────────
function DateInput({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ fontSize: '0.72rem', color: '#9ca3af', letterSpacing: '0.06em' }}>{label}</label>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 6,
          color: '#c4c9d4',
          fontSize: '0.85rem',
          padding: '0.23rem 0.52rem',
          outline: 'none',
          cursor: 'pointer',
          colorScheme: 'dark',
        }}
      />
    </div>
  )
}

// ── Period + Date Selector ─────────────────────────────────────────────────
function RangeSelector({
  period, setPeriod,
  customStart, customEnd,
  onStartChange, onEndChange,
  minDate, maxDate,
}: {
  period: Period; setPeriod: (p: Period) => void
  customStart: string; customEnd: string
  onStartChange: (v: string) => void; onEndChange: (v: string) => void
  minDate: string; maxDate: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {/* Preset buttons */}
      <div style={{ display: 'flex', gap: 3 }}>
        {PERIODS.map((p) => {
          const on = p === period && !customStart && !customEnd
          return (
            <button key={p} onClick={() => { setPeriod(p); onStartChange(''); onEndChange('') }} style={{
              padding: '0.2rem 0.62rem',
              borderRadius: 6,
              border: on ? '1px solid rgba(99,102,241,0.6)' : '1px solid rgba(255,255,255,0.08)',
              background: on ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.02)',
              color: on ? '#a5b4fc' : '#9ca3af',
              fontSize: '0.82rem', fontWeight: on ? 800 : 500,
              cursor: 'pointer',
            }}>{p}</button>
          )
        })}
      </div>
      {/* Divider */}
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />
      {/* Custom date inputs */}
      <DateInput label="시작일" value={customStart} min={minDate} max={customEnd || maxDate} onChange={onStartChange} />
      <span style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 12 }}>~</span>
      <DateInput label="종료일" value={customEnd} min={customStart || minDate} max={maxDate} onChange={onEndChange} />
      {(customStart || customEnd) && (
        <button onClick={() => { onStartChange(''); onEndChange('') }} style={{
          marginTop: 12,
          padding: '0.2rem 0.52rem',
          borderRadius: 6,
          border: '1px solid rgba(239,68,68,0.3)',
          background: 'rgba(239,68,68,0.08)',
          color: '#f87171',
          fontSize: '0.78rem',
          cursor: 'pointer',
        }}>✕ 초기화</button>
      )}
    </div>
  )
}

// ── Tooltip ─────────────────────────────────────────────────────────────────
function CurveTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '0.65rem 0.98rem', fontSize: '0.91rem' }}>
      <div style={{ color: '#9ca3af', marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, fontWeight: 600, marginBottom: 1 }}>
          {p.name}: {typeof p.value === 'number' ? (p.value / 100).toFixed(2) + 'x' : '--'}
        </div>
      ))}
    </div>
  )
}

function fmtY(v: number) { return `${(v / 100).toFixed(0)}x` }

// ── Main Component ─────────────────────────────────────────────────────────
export default function BacktestView({ data }: { data: BacktestData }) {
  const [view, setView]           = useState<ViewKey>('누적 수익률')
  const [period, setPeriod]       = useState<Period>('All')
  const [customStart, setCustomStart] = useState('')
  const [customEnd,   setCustomEnd]   = useState('')

  const { backtest: bt, events, backtest_curve } = data
  const delta_ann = bt.strategy.ann_return - bt.bh.ann_return
  const delta_mdd = bt.strategy.max_drawdown - bt.bh.max_drawdown

  // ── Full downsampled curve (every 4th point) ──────────────────────────────
  const allCurveData = useMemo(() => {
    return backtest_curve
      .filter((_, i) => i % 4 === 0 || i === backtest_curve.length - 1)
      .map((p) => ({
        date:     p.date.slice(2),
        fullDate: p.date,
        bh:       p.bh,
        strat:    p.strat,
        in_mkt:   p.in_mkt,
      }))
  }, [backtest_curve])

  // ── Full drawdown curve ────────────────────────────────────────────────────
  const allDdData = useMemo(() => {
    let bhPeak = 0, stratPeak = 0
    return backtest_curve
      .filter((_, i) => i % 4 === 0 || i === backtest_curve.length - 1)
      .map((p) => {
        bhPeak    = Math.max(bhPeak,    p.bh)
        stratPeak = Math.max(stratPeak, p.strat)
        const bhDD   = bhPeak   > 0 ? (p.bh    - bhPeak)    / bhPeak    * 100 : 0
        const stratDD = stratPeak > 0 ? (p.strat - stratPeak) / stratPeak * 100 : 0
        return { date: p.date.slice(2), fullDate: p.date, bhDD: +bhDD.toFixed(2), stratDD: +stratDD.toFixed(2) }
      })
  }, [backtest_curve])

  // ── Effective date range (custom > period) ─────────────────────────────────
  const { effStart, effEnd } = useMemo(() => {
    if (customStart || customEnd) {
      return {
        effStart: customStart || bt.start_date,
        effEnd:   customEnd   || bt.end_date,
      }
    }
    const days = PERIOD_DAYS[period]
    if (!days || allCurveData.length === 0) {
      return { effStart: bt.start_date, effEnd: bt.end_date }
    }
    const lastDate = new Date(allCurveData[allCurveData.length - 1].fullDate)
    const cutoff   = new Date(lastDate.getTime() - days * 86400000)
    return { effStart: cutoff.toISOString().slice(0, 10), effEnd: bt.end_date }
  }, [customStart, customEnd, period, allCurveData, bt.start_date, bt.end_date])

  // ── Period-filtered data ───────────────────────────────────────────────────
  const curveData = useMemo(() => {
    return allCurveData.filter((p) => p.fullDate >= effStart && p.fullDate <= effEnd)
  }, [allCurveData, effStart, effEnd])

  const ddData = useMemo(() => {
    return allDdData.filter((p) => p.fullDate >= effStart && p.fullDate <= effEnd)
  }, [allDdData, effStart, effEnd])

  // ── Date range label ────────────────────────────────────────────────────────
  const rangeLabel = curveData.length > 0
    ? `${curveData[0].fullDate} → ${curveData[curveData.length - 1].fullDate}`
    : `${bt.start_date} → ${bt.end_date}`

  // ── Event markers within visible range ─────────────────────────────────────
  const eventMarkers = useMemo(() => {
    return events
      .filter((ev) => ev.start >= effStart && ev.start <= effEnd)
      .map((ev) => ({ date: ev.start.slice(2), level: ev.peak_level, name: ev.name }))
  }, [events, effStart, effEnd])

  const xInterval  = Math.max(1, Math.floor(curveData.length / 10))
  const ddInterval = Math.max(1, Math.floor(ddData.length   / 10))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>

      {/* ── Summary stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <div style={{ ...card(), borderLeft: '3px solid #60a5fa' }}>
          <div style={{ fontSize: '0.88rem', color: '#60a5fa', fontWeight: 700, marginBottom: 8 }}>Buy & Hold QQQ</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <StatBox label="수익률(연)" value={`${bt.bh.ann_return.toFixed(1)}%`} color="#60a5fa" />
            <StatBox label="총 수익"   value={`${bt.bh.total_return.toFixed(0)}%`} color="#60a5fa" />
            <StatBox label="Max DD"   value={`${bt.bh.max_drawdown.toFixed(1)}%`} color="#ef4444" />
          </div>
        </div>
        <div style={{ ...card(), borderLeft: '3px solid #22c55e' }}>
          <div style={{ fontSize: '0.88rem', color: '#22c55e', fontWeight: 700, marginBottom: 8 }}>Risk Alert Strategy</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <StatBox label="수익률(연)" value={`${bt.strategy.ann_return.toFixed(1)}%`} color="#22c55e" />
            <StatBox label="총 수익"   value={`${bt.strategy.total_return.toFixed(0)}%`} color="#22c55e" />
            <StatBox label="Max DD"   value={`${bt.strategy.max_drawdown.toFixed(1)}%`} color="#f59e0b" />
          </div>
        </div>
      </div>

      {/* ── Alpha strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[
          { label: '연 초과수익 (Alpha)', value: `${delta_ann >= 0 ? '+' : ''}${delta_ann.toFixed(1)}%`, color: delta_ann >= 0 ? '#22c55e' : '#ef4444' },
          { label: 'DD 감소',            value: `${delta_mdd.toFixed(1)}%pt`,                            color: delta_mdd < 0 ? '#22c55e' : '#ef4444' },
          { label: '현금 보유일',         value: `${bt.cash_pct.toFixed(1)}%`,  color: '#9ca3af', sub: `${bt.days_in_cash}일` },
          { label: '백테스트 기간',        value: `${bt.years}년`,              color: '#9ca3af', sub: `${bt.start_date} →` },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.59rem 0.78rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 3 }}>{label}</div>
            <div style={{ color, fontWeight: 800, fontSize: '1.17rem' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* ── View tab row ── */}
      <div style={{ display: 'flex', gap: 6 }}>
        {VIEWS.map((v) => {
          const on = v === view
          return (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '0.36rem 0.91rem', borderRadius: 8,
              border: on ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.09)',
              background: on ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.02)',
              color: on ? '#a5b4fc' : '#9ca3af',
              fontSize: '0.91rem', fontWeight: on ? 700 : 500, cursor: 'pointer',
            }}>{v}</button>
          )
        })}
      </div>

      {/* ── Range selector — only for chart tabs ── */}
      {view !== '이벤트별 성과' && (
        <div style={{ ...card({ padding: '0.78rem 1.17rem' }) }}>
          <RangeSelector
            period={period} setPeriod={setPeriod}
            customStart={customStart} customEnd={customEnd}
            onStartChange={setCustomStart} onEndChange={setCustomEnd}
            minDate={bt.start_date} maxDate={bt.end_date}
          />
        </div>
      )}

      {/* ── 누적 수익률 chart ── */}
      {view === '누적 수익률' && (
        <div style={card()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
            <div>
              <div style={{ fontSize: '0.88rem', color: '#9ca3af', letterSpacing: '0.08em' }}>누적 수익률 (시작 시점=1x)</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>{rangeLabel}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: '0.78rem' }}>
              <span style={{ color: '#60a5fa' }}>— B&H QQQ</span>
              <span style={{ color: '#22c55e' }}>— Strategy</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={curveData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fontSize: 13, fill: '#6b7280' }} interval={xInterval} />
              <YAxis tick={{ fontSize: 14, fill: '#9ca3af' }} tickFormatter={fmtY} domain={['auto', 'auto']} />
              <Tooltip content={<CurveTooltip />} />
              <ReferenceLine y={100} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 2" />
              {eventMarkers.map((m) => (
                <ReferenceLine key={m.date + m.level} x={m.date}
                  stroke={LEVEL_COLORS[m.level] ?? '#9ca3af'} strokeWidth={1} strokeDasharray="3 3" />
              ))}
              <Line dataKey="bh"    stroke="#60a5fa" strokeWidth={1.5} dot={false} name="B&H QQQ" />
              <Line dataKey="strat" stroke="#22c55e" strokeWidth={2}   dot={false} name="Strategy" />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 8, fontSize: '0.81rem', color: '#6b7280' }}>
            {bt.sell_rule} · {bt.buy_rule} · 컬러 수직선 = Risk 이벤트
          </div>
        </div>
      )}

      {/* ── 드로다운 chart ── */}
      {view === '드로다운' && (
        <div style={card()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
            <div>
              <div style={{ fontSize: '0.88rem', color: '#9ca3af', letterSpacing: '0.08em' }}>드로다운 비교 (고점 대비 %)</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>{rangeLabel}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: '0.78rem' }}>
              <span style={{ color: '#ef4444' }}>— B&H QQQ</span>
              <span style={{ color: '#f59e0b' }}>— Strategy</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={ddData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fontSize: 13, fill: '#6b7280' }} interval={ddInterval} />
              <YAxis tick={{ fontSize: 14, fill: '#9ca3af' }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.91rem', borderRadius: 8 }}
                formatter={(v: number) => `${v.toFixed(1)}%`} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              {eventMarkers.map((m) => (
                <ReferenceLine key={m.date + m.level} x={m.date}
                  stroke={LEVEL_COLORS[m.level] ?? '#9ca3af'} strokeWidth={1} strokeDasharray="3 3" />
              ))}
              <Area dataKey="bhDD"    stroke="#ef4444" fill="rgba(239,68,68,0.12)"  strokeWidth={1.5} dot={false} name="B&H DD" />
              <Area dataKey="stratDD" stroke="#f59e0b" fill="rgba(245,158,11,0.08)" strokeWidth={1.5} dot={false} name="Strategy DD" />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.65rem 0.91rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>B&H 최대 낙폭</div>
              <div style={{ fontSize: '1.56rem', fontWeight: 900, color: '#ef4444' }}>{bt.bh.max_drawdown.toFixed(1)}%</div>
            </div>
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '0.65rem 0.91rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>전략 최대 낙폭</div>
              <div style={{ fontSize: '1.56rem', fontWeight: 900, color: '#f59e0b' }}>{bt.strategy.max_drawdown.toFixed(1)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* ── 이벤트별 성과 ── */}
      {view === '이벤트별 성과' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6, padding: '0 0.65rem' }}>
            {['이벤트', '낙폭', '1M후', '3M후', '6M후', '기간'].map((h) => (
              <div key={h} style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 700 }}>{h}</div>
            ))}
          </div>
          {[...events].sort((a, b) => a.start.localeCompare(b.start)).map((ev) => {
            const col = LEVEL_COLORS[ev.peak_level] ?? '#9ca3af'
            const dd  = ev.qqq_drawdown_pct
            return (
              <div key={ev.id} style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 6,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                borderLeft: `3px solid ${col}`, borderRadius: 8, padding: '0.52rem 0.65rem',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: '0.94rem', fontWeight: 700, color: '#e5e7eb' }}>{ev.name}</div>
                  <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{ev.start} · {ev.duration_days}d · score {ev.peak_score}</div>
                </div>
                <div style={{ fontSize: '1.01rem', fontWeight: 700, color: dd < -15 ? '#ef4444' : '#f97316' }}>{dd.toFixed(1)}%</div>
                {[ev.fwd_ret_1m, ev.fwd_ret_3m, ev.fwd_ret_6m].map((r, i) => (
                  <div key={i} style={{ fontSize: '1.01rem', fontWeight: 700, color: (r ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                    {r != null ? `${r.toFixed(1)}%` : '--'}
                  </div>
                ))}
                <div style={{ fontSize: '0.91rem', color: '#9ca3af' }}>{ev.duration_days}d</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
