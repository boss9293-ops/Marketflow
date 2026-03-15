'use client'

import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid, ReferenceArea,
} from 'recharts'

const API = 'http://localhost:5001'

// ── Types ──────────────────────────────────────────────────────────────────
type LevelInfo = { level: number; label: string; range: string; color: string; action: string }
type Indicator = { id: number; name: string; max: number; score: number | null; value?: number | null; unit?: string; threshold?: number | null; desc: string }
type HistoryPoint = { date: string; qqq: number | null; ma200: number | null; ma50: number | null; score: number | null; level: number; vix: number | null; hy_oas: number | null }
type EventRecord = { id: number; name: string; start: string; end: string; duration_days: number; peak_score: number; peak_level: number; qqq_drawdown_pct: number; fwd_ret_1m: number | null; fwd_ret_3m: number | null; fwd_ret_6m: number | null }
type Backtest = { start_date: string; end_date: string; years: number; sell_rule: string; buy_rule: string; bh: { total_return: number; ann_return: number; max_drawdown: number }; strategy: { total_return: number; ann_return: number; max_drawdown: number }; days_in_cash: number; days_total: number; cash_pct: number; events_avoided: number }
type MethodologyIndicator = { id: number; name: string; max: number; desc: string }
type Methodology = { indicators: MethodologyIndicator[]; levels: LevelInfo[]; event_detection: string; backtest_logic: string; data_sources: string[] }

// Playback types (from separate API)
type PlaybackPoint = { date: string; qqq_n: number | null; ma200_n: number | null; ma50_n: number | null; score: number | null; level: number; in_ev: boolean }
type PlaybackEvent = { id: number; name: string; start: string; end: string; playback: PlaybackPoint[] }
type PlaybackData = { run_id: string; events: PlaybackEvent[] }

export type RiskAlertData = {
  run_id: string
  generated: string
  current: {
    date: string; score: number; level: number; level_label: string; level_color: string
    action: string; score_trend: string; score_7d_ago: number
  }
  indicators: Indicator[]
  history: HistoryPoint[]
  events: EventRecord[]
  backtest: Backtest
  methodology: Methodology
}

// ── Helpers ────────────────────────────────────────────────────────────────
const LEVEL_COLORS: Record<number, string> = {
  0: '#22c55e', 1: '#f59e0b', 2: '#f97316', 3: '#ef4444', 4: '#7c3aed',
}
const LEVEL_BG: Record<number, string> = {
  0: 'rgba(34,197,94,0.10)', 1: 'rgba(245,158,11,0.10)', 2: 'rgba(249,115,22,0.10)',
  3: 'rgba(239,68,68,0.10)', 4: 'rgba(124,58,237,0.12)',
}

function pill(label: string, color: string, bg: string) {
  return (
    <span style={{ fontSize: '0.81rem', fontWeight: 700, color, background: bg, border: `1px solid ${color}44`, borderRadius: 5, padding: '1px 6px' }}>
      {label}
    </span>
  )
}

function card(extra?: object) {
  return {
    background: '#111318',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: '1.3rem 1.43rem',
    ...extra,
  } as const
}

function scoreBar(score: number, max: number, color: string) {
  const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0
  return (
    <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 999, transition: 'width 0.4s' }} />
    </div>
  )
}

// ── Tab Buttons ────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Event Library', 'Event Playback', 'Methodology'] as const
type Tab = typeof TABS[number]

function TabBar({ active, setActive }: { active: Tab; setActive: (t: Tab) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {TABS.map((t) => {
        const on = t === active
        return (
          <button key={t} onClick={() => setActive(t)} style={{
            padding: '0.39rem 0.98rem',
            borderRadius: 8,
            border: on ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.09)',
            background: on ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.02)',
            color: on ? '#a5b4fc' : '#9ca3af',
            fontSize: '0.94rem', fontWeight: on ? 700 : 500,
            cursor: 'pointer',
          }}>
            {t}
          </button>
        )
      })}
    </div>
  )
}

// ── Overview Tab ───────────────────────────────────────────────────────────
function OverviewTab({ data }: { data: RiskAlertData }) {
  const { current, indicators, history } = data
  const col = current.level_color
  const bg  = LEVEL_BG[current.level]

  const chartData = history.map((h) => ({
    date: h.date.slice(2),
    qqq:  h.qqq,
    ma200: h.ma200,
    ma50:  h.ma50,
    score: h.score,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
      {/* Hero score card */}
      <div style={{ ...card(), background: bg, borderColor: `${col}44` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '1.3rem', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <svg width={100} height={56}>
              <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={8} strokeLinecap="round" />
              {(() => {
                const pct = current.score / 100
                const angle = Math.PI * pct
                const ex = 50 + 40 * Math.cos(Math.PI - angle)
                const ey = 50 - 40 * Math.sin(angle)
                return (
                  <path d={`M 10 50 A 40 40 0 ${pct > 0.5 ? 1 : 0} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`}
                    fill="none" stroke={col} strokeWidth={8} strokeLinecap="round" />
                )
              })()}
              <text x={50} y={46} textAnchor="middle" fill={col} fontSize={18} fontWeight={900}>{current.score}</text>
            </svg>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: -8 }}>/ 100</div>
          </div>
          <div>
            <div style={{ fontSize: '1.82rem', fontWeight: 900, color: col }}>{current.level_label}</div>
            <div style={{ fontSize: '1.04rem', color: '#d1d5db', marginTop: 4 }}>{current.action}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {pill(`Level ${current.level}`, col, bg)}
              {pill(current.score_trend === 'Rising' ? '▲ Rising' : current.score_trend === 'Falling' ? '▼ Falling' : '● Stable',
                current.score_trend === 'Rising' ? '#ef4444' : current.score_trend === 'Falling' ? '#22c55e' : '#9ca3af',
                'rgba(255,255,255,0.04)')}
              <span style={{ fontSize: '0.81rem', color: '#9ca3af' }}>7d ago: {current.score_7d_ago}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.88rem', color: '#9ca3af' }}>
            <div>as of</div>
            <div style={{ color: '#9ca3af', fontWeight: 600 }}>{current.date}</div>
          </div>
        </div>
      </div>

      {/* Score history chart */}
      <div style={card()}>
        <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 8, letterSpacing: '0.08em' }}>MACRO SCORE — 90 DAY HISTORY</div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 14, fill: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 14, fill: '#9ca3af' }} />
            <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.94rem', borderRadius: 8 }} />
            <ReferenceLine y={50} stroke="#f97316" strokeDasharray="4 2" strokeWidth={1} label={{ value: 'Risk', fill: '#f97316', fontSize: 14, position: 'insideTopRight' }} />
            <ReferenceLine y={30} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1} label={{ value: 'Caution', fill: '#f59e0b', fontSize: 14, position: 'insideTopRight' }} />
            <Area dataKey="score" fill="rgba(99,102,241,0.12)" stroke="#6366f1" strokeWidth={1.5} dot={false} name="Score" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Indicator breakdown */}
      <div style={card()}>
        <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 10, letterSpacing: '0.08em' }}>9-INDICATOR BREAKDOWN</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {indicators.map((ind) => {
            const s = ind.score ?? 0
            const pct = ind.max > 0 ? s / ind.max : 0
            const icolor = pct >= 0.7 ? '#ef4444' : pct >= 0.4 ? '#f97316' : pct >= 0.1 ? '#f59e0b' : '#22c55e'
            return (
              <div key={ind.id} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 40px', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: '0.91rem', color: '#d1d5db', fontWeight: 600 }}>{ind.name}</div>
                {scoreBar(s, ind.max, icolor)}
                <div style={{ fontSize: '0.91rem', color: icolor, fontWeight: 700, textAlign: 'right' }}>{s}/{ind.max}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* QQQ price chart */}
      <div style={card()}>
        <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 8, letterSpacing: '0.08em' }}>QQQ PRICE — 90 DAYS</div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 14, fill: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 14, fill: '#9ca3af' }} domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.94rem', borderRadius: 8 }} />
            <Line dataKey="qqq"   stroke="#60a5fa" strokeWidth={1.5} dot={false} name="QQQ" />
            <Line dataKey="ma200" stroke="#a78bfa" strokeWidth={1} dot={false} strokeDasharray="5 3" name="MA200" />
            <Line dataKey="ma50"  stroke="#fbbf24" strokeWidth={1} dot={false} strokeDasharray="3 2" name="MA50" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Event Library Tab ──────────────────────────────────────────────────────
function EventLibraryTab({ data }: { data: RiskAlertData }) {
  const { events } = data
  const sorted = [...events].sort((a, b) => b.peak_score - a.peak_score)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.98rem' }}>
      <div style={{ fontSize: '0.91rem', color: '#9ca3af' }}>
        {events.length} risk events detected (1999–present) where score crossed Level 2+
      </div>
      {sorted.map((ev) => {
        const col = LEVEL_COLORS[ev.peak_level] ?? '#9ca3af'
        const bg  = LEVEL_BG[ev.peak_level] ?? 'rgba(255,255,255,0.04)'
        const dd = ev.qqq_drawdown_pct
        return (
          <div key={ev.id} style={{ ...card(), borderLeft: `3px solid ${col}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
              <div>
                <div style={{ fontSize: '1.14rem', fontWeight: 800, color: '#f3f4f6' }}>{ev.name}</div>
                <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginTop: 2 }}>
                  {ev.start} → {ev.end} · {ev.duration_days}d
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {pill(`Peak ${ev.peak_score}`, col, bg)}
                {pill(`L${ev.peak_level}`, col, bg)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 10 }}>
              {[
                { label: 'QQQ Draw', value: `${dd.toFixed(1)}%`, color: dd < -15 ? '#ef4444' : dd < -8 ? '#f97316' : '#f59e0b' },
                { label: '1M After', value: ev.fwd_ret_1m != null ? `${ev.fwd_ret_1m.toFixed(1)}%` : '--', color: (ev.fwd_ret_1m ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
                { label: '3M After', value: ev.fwd_ret_3m != null ? `${ev.fwd_ret_3m.toFixed(1)}%` : '--', color: (ev.fwd_ret_3m ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
                { label: '6M After', value: ev.fwd_ret_6m != null ? `${ev.fwd_ret_6m.toFixed(1)}%` : '--', color: (ev.fwd_ret_6m ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.45rem 0.65rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{label}</div>
                  <div style={{ color, fontWeight: 700, fontSize: '1.07rem' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Custom Tooltip for Playback Chart ──────────────────────────────────────
function PlaybackTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div style={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '0.65rem 0.98rem', fontSize: '0.91rem' }}>
      <div style={{ color: '#9ca3af', marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : '--'}
        </div>
      ))}
    </div>
  )
}

// ── Event Playback Tab ─────────────────────────────────────────────────────
function EventPlaybackTab({ events }: { events: EventRecord[] }) {
  const [selectedId, setSelectedId] = useState<number>(events[0]?.id ?? 1)
  const [pbData, setPbData] = useState<PlaybackData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Lazy-fetch playback data on mount (once)
  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/risk-alert-playback`)
      .then((r) => r.json())
      .then((d) => { setPbData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  const ev = events.find((e) => e.id === selectedId) ?? events[0]
  const pbEv = pbData?.events.find((e) => e.id === selectedId)
  const col = LEVEL_COLORS[ev?.peak_level ?? 0]

  // Build chart data from playback
  const chartData = (pbEv?.playback ?? []).map((p) => ({
    date:    p.date.slice(2),
    qqq_n:   p.qqq_n,
    ma200_n: p.ma200_n,
    ma50_n:  p.ma50_n,
    score:   p.score,
    in_ev:   p.in_ev,
  }))

  // Find event region start/end dates for ReferenceArea
  const evPoints = chartData.filter((d) => d.in_ev)
  const evStart = evPoints[0]?.date
  const evEnd   = evPoints[evPoints.length - 1]?.date

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
      {/* Event selector */}
      <div style={card()}>
        <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 8 }}>SELECT EVENT TO REPLAY</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {events.map((e) => {
            const c = LEVEL_COLORS[e.peak_level] ?? '#9ca3af'
            const on = e.id === selectedId
            return (
              <button key={e.id} onClick={() => setSelectedId(e.id)} style={{
                padding: '0.33rem 0.78rem',
                borderRadius: 7,
                border: on ? `1px solid ${c}66` : '1px solid rgba(255,255,255,0.08)',
                background: on ? `${c}18` : 'rgba(255,255,255,0.02)',
                color: on ? c : '#9ca3af',
                fontSize: '0.86rem', fontWeight: on ? 700 : 500, cursor: 'pointer',
              }}>
                {e.name.split(' (')[0].split(' ').slice(0, 3).join(' ')} {e.start.slice(0, 7)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected event header */}
      {ev && (
        <div style={{ ...card(), borderLeft: `3px solid ${col}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f3f4f6' }}>{ev.name}</div>
              <div style={{ fontSize: '0.94rem', color: '#9ca3af', marginTop: 4 }}>
                {ev.start} → {ev.end} · {ev.duration_days} days · Peak score {ev.peak_score}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {pill(`L${ev.peak_level}`, col, LEVEL_BG[ev.peak_level])}
              {pill(`Peak ${ev.peak_score}`, col, LEVEL_BG[ev.peak_level])}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 10 }}>
            {[
              { label: 'QQQ Draw', value: `${ev.qqq_drawdown_pct.toFixed(1)}%`, color: ev.qqq_drawdown_pct < -15 ? '#ef4444' : '#f97316' },
              { label: '1M After', value: ev.fwd_ret_1m != null ? `${ev.fwd_ret_1m.toFixed(1)}%` : '--', color: (ev.fwd_ret_1m ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
              { label: '3M After', value: ev.fwd_ret_3m != null ? `${ev.fwd_ret_3m.toFixed(1)}%` : '--', color: (ev.fwd_ret_3m ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
              { label: '6M After', value: ev.fwd_ret_6m != null ? `${ev.fwd_ret_6m.toFixed(1)}%` : '--', color: (ev.fwd_ret_6m ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.45rem 0.65rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{label}</div>
                <div style={{ color, fontWeight: 700, fontSize: '1.12rem' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      {loading ? (
        <div style={{ ...card(), textAlign: 'center', padding: '2.6rem', color: '#9ca3af' }}>
          <div style={{ fontSize: '1.04rem', marginBottom: 6 }}>Loading playback data...</div>
          <div style={{ height: 4, borderRadius: 999, background: 'rgba(99,102,241,0.2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '60%', background: '#6366f1', borderRadius: 999, animation: 'shimmer 1.2s infinite' }} />
          </div>
        </div>
      ) : error ? (
        <div style={{ ...card(), color: '#ef4444', fontSize: '1.04rem', textAlign: 'center', padding: '1.95rem' }}>
          Failed to load playback data. Is the backend running?
        </div>
      ) : chartData.length > 0 ? (
        <>
          {/* QQQ normalized chart */}
          <div style={card()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.88rem', color: '#9ca3af', letterSpacing: '0.08em' }}>
                QQQ (이벤트 시작=100 기준) · 4개월 전→3개월 후
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: '0.78rem' }}>
                <span style={{ color: '#60a5fa' }}>— QQQ</span>
                <span style={{ color: '#a78bfa' }}>- MA200</span>
                <span style={{ color: '#fbbf24' }}>- MA50</span>
                <span style={{ color: `${col}99`, background: `${col}18`, border: `1px solid ${col}44`, borderRadius: 3, padding: '0 4px' }}>이벤트 구간</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 14, fill: '#9ca3af' }} interval={Math.floor(chartData.length / 8)} />
                <YAxis tick={{ fontSize: 14, fill: '#9ca3af' }} domain={['auto', 'auto']}
                  tickFormatter={(v) => `${v.toFixed(0)}`} />
                <Tooltip content={<PlaybackTooltip />} />
                {/* Event period shading */}
                {evStart && evEnd && (
                  <ReferenceArea x1={evStart} x2={evEnd} fill={col} fillOpacity={0.08} stroke={col} strokeOpacity={0.3} strokeWidth={1} />
                )}
                {/* 100 baseline */}
                <ReferenceLine y={100} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" strokeWidth={1} />
                <Line dataKey="ma200_n" stroke="#a78bfa" strokeWidth={1.2} dot={false} strokeDasharray="5 3" name="MA200" connectNulls />
                <Line dataKey="ma50_n"  stroke="#fbbf24" strokeWidth={1.2} dot={false} strokeDasharray="3 2" name="MA50"  connectNulls />
                <Line dataKey="qqq_n"   stroke="#60a5fa" strokeWidth={2}   dot={false} name="QQQ" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Score chart */}
          <div style={card()}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 8, letterSpacing: '0.08em' }}>
              MACRO SCORE · 이벤트 기간 전후
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 14, fill: '#9ca3af' }} interval={Math.floor(chartData.length / 8)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 14, fill: '#9ca3af' }} />
                <Tooltip content={<PlaybackTooltip />} />
                {evStart && evEnd && (
                  <ReferenceArea x1={evStart} x2={evEnd} fill={col} fillOpacity={0.08} stroke={col} strokeOpacity={0.3} strokeWidth={1} />
                )}
                <ReferenceLine y={50} stroke="#f97316" strokeDasharray="4 2" strokeWidth={1} label={{ value: 'Risk', fill: '#f97316', fontSize: 14 }} />
                <ReferenceLine y={30} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1} label={{ value: 'Caution', fill: '#f59e0b', fontSize: 14 }} />
                <Area dataKey="score" fill={`${col}18`} stroke={col} strokeWidth={1.5} dot={false} name="Score" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div style={{ ...card(), textAlign: 'center', color: '#9ca3af', padding: '2.6rem' }}>
          No playback data for this event
        </div>
      )}

    </div>
  )
}

// ── Methodology Tab ────────────────────────────────────────────────────────
function MethodologyTab({ data }: { data: RiskAlertData }) {
  const { methodology } = data
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
      <div style={card()}>
        <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 10, letterSpacing: '0.08em' }}>SCORE LEVELS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {methodology.levels.map((lv) => (
            <div key={lv.level} style={{ display: 'grid', gridTemplateColumns: '60px 80px 1fr', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: '0.94rem', fontWeight: 700, color: lv.color }}>{lv.label}</div>
              <div style={{ fontSize: '0.81rem', color: '#9ca3af' }}>{lv.range}</div>
              <div style={{ fontSize: '0.88rem', color: '#9ca3af' }}>{lv.action}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={card()}>
        <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 10, letterSpacing: '0.08em' }}>9-INDICATOR SYSTEM</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {methodology.indicators.map((ind) => (
            <div key={ind.id} style={{ borderLeft: '2px solid rgba(99,102,241,0.3)', paddingLeft: '0.98rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: '0.91rem', fontWeight: 700, color: '#a5b4fc' }}>{ind.name}</span>
                <span style={{ fontSize: '0.78rem', color: '#9ca3af', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4, padding: '0 4px' }}>max {ind.max}</span>
              </div>
              <div style={{ fontSize: '0.88rem', color: '#9ca3af' }}>{ind.desc}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={card()}>
        <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 10, letterSpacing: '0.08em' }}>RULES</div>
        {[
          { label: 'Event Detection', value: methodology.event_detection },
          { label: 'Backtest Logic',  value: methodology.backtest_logic },
        ].map(({ label, value }) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#d1d5db', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: '0.91rem', color: '#9ca3af' }}>{value}</div>
          </div>
        ))}
        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#d1d5db', marginBottom: 4 }}>Data Sources</div>
        {methodology.data_sources.map((s) => (
          <div key={s} style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 2 }}>· {s}</div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function RiskAlertSystem({ data }: { data: RiskAlertData }) {
  const [tab, setTab] = useState<Tab>('Overview')

  if (!data || !data.current) {
    return (
      <div style={{ ...card(), textAlign: 'center', color: '#9ca3af', padding: '2.6rem' }}>
        <div style={{ fontSize: '1.17rem' }}>Risk Alert data not available</div>
        <div style={{ fontSize: '0.94rem', marginTop: 6 }}>Run: python backend/scripts/build_risk_alert.py</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.17rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: '1.43rem', fontWeight: 800, color: '#f3f4f6' }}>
            Standard Risk <span style={{ color: '#ef4444' }}>Alert System</span>
          </div>
          <div style={{ fontSize: '0.91rem', color: '#9ca3af', marginTop: 2 }}>
            9-indicator Macro Score · {data.events.length} historical events · {data.backtest.years}y backtest
          </div>
        </div>
        <div style={{ fontSize: '0.78rem', color: '#6b7280', textAlign: 'right' }}>
          <div>{data.run_id}</div>
          <div>{data.generated.slice(0, 10)}</div>
        </div>
      </div>

      <TabBar active={tab} setActive={setTab} />

      {tab === 'Overview'       && <OverviewTab      data={data} />}
      {tab === 'Event Library'  && <EventLibraryTab  data={data} />}
      {tab === 'Event Playback' && <EventPlaybackTab events={data.events} />}
      {tab === 'Methodology'    && <MethodologyTab   data={data} />}

      <style>{`@keyframes shimmer { 0%{transform:translateX(-200%)} 100%{transform:translateX(200%)} }`}</style>
    </div>
  )
}
