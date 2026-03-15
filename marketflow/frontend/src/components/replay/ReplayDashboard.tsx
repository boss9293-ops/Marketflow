'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

type LayerScore = { score: number; max: number; label: string }
type EscalationCondition = {
  name: string
  badge: string
  sensor_key: string
  current: number | null
  threshold: number | null
  unit?: string
  pct_to_trigger: number
  gap: string
  direction: string
  already_fired: boolean
  would_trigger: string
  category: string
}

type Snapshot = {
  date: string
  mps: number
  regime: string
  regime_confidence: number
  regime_drivers: string[]
  total_risk: number
  state: string
  state_color: string
  crisis_stage: number
  crisis_stage_label: string
  crisis_stage_color: string
  dominant_signal: string
  mss: number
  layers: Record<string, LayerScore>
  refs: Record<string, number | null>
  data_gaps: string[]
  track_a?: { z_credit: number | null; state: string; stage0: boolean; stage0_watch: boolean; consecutive_days: number; roc_hy_5d: number | null; hy_oas_current: number | null }
  track_b?: { mss_current: number; mss_5d_ago: number; mss_5d_delta: number; velocity_alert: boolean; velocity_pct: number; velocity_signal: string }
  track_c?: { state: string; shock_type: string; score: number; triggered_sensors: Array<{ name: string; z: number; badge: string }> }
  master_signal?: {
    mode: string; action: string; severity: string; detail: string
    escalation_conditions?: EscalationCondition[]
    mss_velocity_alert?: boolean
    mss_5d_delta?: number | null
  }
  mss_velocity_alert?: boolean
  mss_5d_delta?: number | null
}

type RegimeDist = {
  pct: Record<string, number>
  first_change_date: string | null
  longest_streak: Record<string, number>
  change_count: number
}

type Summary = {
  trading_days: number
  first_warning: Record<string, string | null>
  peak: {
    date: string; total_risk: number; mps: number
    crisis_stage: number; crisis_stage_label: string
    regime: string; dominant_signal: string; state: string
  }
  regime_distribution: RegimeDist
  stage_transitions: Array<{ date: string; stage: number; label: string }>
  max_high_stage_days: number
  dominant_distribution: {
    pct: Record<string, number>
    first_dominant: string
    at_peak: string
    change_count: number
  }
  track_a_summary?: {
    first_tier1_date: string | null; tier1_days: number;
    first_tier2_date: string | null; tier2_days: number;
    first_stage0_date: string | null; stage0_days: number;
    first_watch_date: string | null; watch_days: number;
    peak_z_credit: number | null;
    state_distribution: Record<string, number>;
  }
  track_c_summary?: {
    first_shock_watch_date: string | null
    first_shock_confirmed_date: string | null
    shock_confirmed_days: number
    shock_watch_days: number
    shock_types_seen: string[]
  }
  data_gap_summary: {
    layers_with_gaps: string[]
    gap_day_counts: Record<string, number>
  }
}

export type ReplayWindow = {
  window: string
  generated_at: string
  trading_days: number
  date_range: { start: string; end: string }
  summary: Summary
  snapshots: Snapshot[]
}

type Props = { windows: ReplayWindow[] }

// ── Constants ──────────────────────────────────────────────────────────────────

const REGIME_COLORS: Record<string, string> = {
  'Expansion':       '#22c55e',
  'Early Stress':    '#f59e0b',
  'Credit Stress':   '#f97316',
  'Liquidity Crisis':'#ef4444',
}

const STAGE_COLORS = [
  '#22c55e','#84cc16','#f59e0b','#fb923c','#f97316','#ef4444','#b91c1c'
]

const STATE_COLORS: Record<string, string> = {
  'Normal':    '#22c55e',
  'Caution':   '#f59e0b',
  'Warning':   '#f97316',
  'High Risk': '#ef4444',
  'Crisis':    '#b91c1c',
}

const WINDOW_LABELS: Record<string, string> = {
  '2020_covid':      '2020 COVID Crash',
  '2022_tightening': '2022 Fed Tightening',
  '2023_bank_stress':'2023 SVB Bank Stress',
  '2025_current':    '2025-26 Current',
}

const LAYER_ORDER = [
  'equity','breadth','credit','lev_loan','liquidity','funding',
  'macro','shock','cross_asset','credit_spread','liquidity_shock','financial_stress'
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function heatColor(ratio: number): string {
  // 0=green, 0.5=amber, 1=red
  if (ratio <= 0) return '#22c55e'
  if (ratio >= 1) return '#ef4444'
  if (ratio < 0.5) {
    const t = ratio / 0.5
    return `rgb(${Math.round(34 + t*(245-34))},${Math.round(197 + t*(158-197))},${Math.round(94 + t*(11-94))})`
  }
  const t = (ratio - 0.5) / 0.5
  return `rgb(${Math.round(245 + t*(239-245))},${Math.round(158 + t*(68-158))},${Math.round(11 + t*(68-11))})`
}

function mpsColor(mps: number): string {
  if (mps < 30) return '#22c55e'
  if (mps < 50) return '#84cc16'
  if (mps < 70) return '#f59e0b'
  if (mps < 85) return '#f97316'
  return '#ef4444'
}

function escBadgeLabel(sensorKey?: string, badge?: string) {
  const key = (sensorKey ?? '').toLowerCase()
  if (key === 'yen_carry_z') return 'YEN'
  if (key === 'oil_shock_z') return 'OIL'
  if (key === 'vix_velocity_z') return 'VIX'
  if (key === 'safe_haven_z') return 'GOLD'
  if (key === 'z_credit') return 'CREDIT'
  if (key === 'mss_5d_delta') return 'MSS'
  const clean = (badge ?? '').replace(/[^\x20-\x7E]/g, '').trim()
  return clean || 'SIG'
}

function fmtDate(d: string): string {
  return d ? d.slice(0, 10) : ''
}

// ── SVG Timeline Chart ─────────────────────────────────────────────────────────

function TimelineChart({
  snapshots, currentIdx, onSeek
}: {
  snapshots: Snapshot[]
  currentIdx: number
  onSeek: (idx: number) => void
}) {
  const W = 900, H = 160, PAD = { l: 8, r: 8, t: 12, b: 24 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const n = snapshots.length
  if (n === 0) return null

  const xScale = (i: number) => PAD.l + (i / (n - 1)) * cW
  const yScale = (v: number) => PAD.t + cH - (v / 120) * cH

  // Total risk polyline
  const riskPts = snapshots.map((s, i) => `${xScale(i).toFixed(1)},${yScale(s.total_risk).toFixed(1)}`).join(' ')
  const mpsPts  = snapshots.map((s, i) => `${xScale(i).toFixed(1)},${yScale(s.mps * 1.2).toFixed(1)}`).join(' ')

  // Regime background bands
  const bands: Array<{ x1: number; x2: number; regime: string }> = []
  let bandStart = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || snapshots[i]?.regime !== snapshots[i-1]?.regime) {
      bands.push({ x1: xScale(bandStart), x2: xScale(Math.min(i, n-1)), regime: snapshots[bandStart].regime })
      bandStart = i
    }
  }

  // Y-axis grid lines
  const yLines = [0, 30, 50, 70, 90, 120]

  // Cursor x
  const cx = xScale(currentIdx)

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width * W - PAD.l
    const idx = Math.round((relX / cW) * (n - 1))
    onSeek(Math.max(0, Math.min(n - 1, idx)))
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: H, display: 'block', cursor: 'crosshair' }}
      onClick={handleClick}
    >
      {/* Regime bands */}
      {bands.map((b, i) => (
        <rect key={i} x={b.x1} y={PAD.t} width={b.x2 - b.x1} height={cH}
          fill={REGIME_COLORS[b.regime] ?? '#6b7280'} opacity={0.08} />
      ))}

      {/* Y-axis grid */}
      {yLines.map(v => (
        <g key={v}>
          <line x1={PAD.l} y1={yScale(v)} x2={W - PAD.r} y2={yScale(v)}
            stroke='rgba(255,255,255,0.06)' strokeWidth={0.8} />
          <text x={PAD.l} y={yScale(v) - 2} fontSize={8} fill='#4b5563'>{v}</text>
        </g>
      ))}

      {/* MPS line (dashed, scaled *1.2 to share y-axis) */}
      <polyline points={mpsPts} fill='none' stroke='#f59e0b'
        strokeWidth={1.2} strokeDasharray='4 3' opacity={0.6} strokeLinejoin='round' />

      {/* Total risk line */}
      <polyline points={riskPts} fill='none' stroke='#60a5fa'
        strokeWidth={1.8} strokeLinejoin='round' strokeLinecap='round' />

      {/* State zone coloring on line */}
      {snapshots.map((s, i) => {
        if (i === 0) return null
        const x1 = xScale(i-1).toFixed(1), y1 = yScale(snapshots[i-1].total_risk).toFixed(1)
        const x2 = xScale(i).toFixed(1),   y2 = yScale(s.total_risk).toFixed(1)
        const sc = STATE_COLORS[s.state] ?? '#60a5fa'
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={sc} strokeWidth={2.2} strokeLinecap='round' />
      })}

      {/* Cursor */}
      <line x1={cx} y1={PAD.t} x2={cx} y2={H - PAD.b}
        stroke='rgba(255,255,255,0.5)' strokeWidth={1.2} strokeDasharray='4 3' />
      <circle cx={cx} cy={yScale(snapshots[currentIdx]?.total_risk ?? 0)}
        r={3.5} fill='white' stroke='rgba(255,255,255,0.4)' strokeWidth={1} />

      {/* X-axis labels — show ~6 dates */}
      {[0, Math.floor(n/5), Math.floor(2*n/5), Math.floor(3*n/5), Math.floor(4*n/5), n-1].map(idx => {
        if (idx >= n) return null
        return (
          <text key={idx} x={xScale(idx)} y={H - 4} fontSize={8} fill='#4b5563'
            textAnchor='middle'>{snapshots[idx].date.slice(5)}</text>
        )
      })}

      {/* Tier 1: Credit Watch (amber diamond) — day 1+ awareness */}
      {snapshots.map((s, i) => {
        if (!s.track_a?.stage0_watch || s.track_a?.stage0) return null
        return <rect key={i} x={xScale(i) - 3} y={H - PAD.b + 4} width={6} height={6}
          fill='#f59e0b' opacity={0.75} transform={`rotate(45,${xScale(i)},${H - PAD.b + 7})`} />
      })}

      {/* Tier 2: Stage 0 CONFIRMED (orange dot) — 3-day streak */}
      {snapshots.map((s, i) => {
        if (!s.track_a?.stage0) return null
        return <circle key={i} cx={xScale(i)} cy={H - PAD.b + 7} r={3.5} fill='#f97316' opacity={0.9} />
      })}

      {/* Track B: MSS Velocity alert markers (magenta square) */}
      {snapshots.map((s, i) => {
        const fired = Boolean(s.track_b?.velocity_alert || s.mss_velocity_alert || s.master_signal?.mss_velocity_alert)
        if (!fired) return null
        return <rect key={i} x={xScale(i) - 2.5} y={H - PAD.b + 10.5} width={5} height={5} rx={1}
          fill='#e879f9' opacity={0.95} />
      })}

      {/* Track C: Event/Shock markers (cyan, row below Track A markers) */}
      {snapshots.map((s, i) => {
        if (!s.track_c || s.track_c.state === 'Normal') return null
        const isConfirmed = s.track_c.state === 'Shock Confirmed'
        return <circle key={i} cx={xScale(i)} cy={H - PAD.b + 15}
          r={isConfirmed ? 3.5 : 2.5}
          fill={isConfirmed ? '#06b6d4' : '#38bdf8'} opacity={0.85} />
      })}

      {/* Legend */}
      <line x1={W-120} y1={10} x2={W-100} y2={10} stroke='#60a5fa' strokeWidth={2} />
      <text x={W-96} y={13} fontSize={8} fill='#9ca3af'>Total Risk</text>
      <line x1={W-120} y1={22} x2={W-100} y2={22} stroke='#f59e0b' strokeWidth={1.5} strokeDasharray='4 3' />
      <text x={W-96} y={25} fontSize={8} fill='#9ca3af'>MPS (scaled)</text>
      <rect x={W-113} y={30} width={6} height={6} fill='#f59e0b'
        transform={`rotate(45,${W-110},${W > 200 ? 33 : 33})`} />
      <text x={W-96} y={36} fontSize={8} fill='#9ca3af'>Watch (T1)</text>
      <circle cx={W-110} cy={44} r={3} fill='#f97316' />
      <text x={W-96} y={47} fontSize={8} fill='#9ca3af'>Stage 0 (T2)</text>
      <circle cx={W-110} cy={54} r={2.5} fill='#38bdf8' />
      <text x={W-96} y={57} fontSize={8} fill='#9ca3af'>Event Watch</text>
      <circle cx={W-110} cy={64} r={3.5} fill='#06b6d4' />
      <text x={W-96} y={67} fontSize={8} fill='#9ca3af'>Event Confirmed</text>
      <rect x={W-113} y={72} width={6} height={6} rx={1} fill='#e879f9' />
      <text x={W-96} y={77} fontSize={8} fill='#9ca3af'>MSS Velocity</text>
    </svg>
  )
}

// ── Layer Heatmap ──────────────────────────────────────────────────────────────

function LayerHeatmap({
  snapshots, currentIdx
}: {
  snapshots: Snapshot[]
  currentIdx: number
}) {
  const n = snapshots.length
  if (n === 0 || !snapshots[0]) return null

  // Sample columns to max 80 for display
  const maxCols = 80
  const step = Math.max(1, Math.floor(n / maxCols))
  const indices = Array.from({ length: Math.ceil(n / step) }, (_, i) => Math.min(i * step, n - 1))

  const CELL_W = 8, CELL_H = 16, LABEL_W = 110, PAD_B = 20
  const W = LABEL_W + indices.length * CELL_W + 20
  const H = LAYER_ORDER.length * CELL_H + PAD_B

  // Find current column
  const curColIdx = indices.reduce((best, idx, ci) =>
    Math.abs(idx - currentIdx) < Math.abs(indices[best] - currentIdx) ? ci : best, 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: Math.min(W, 900), height: H, display: 'block' }}>
        {LAYER_ORDER.map((key, row) => {
          const yTop = row * CELL_H
          const label = snapshots[0]?.layers[key]?.label ?? key
          return (
            <g key={key}>
              <text x={LABEL_W - 4} y={yTop + CELL_H * 0.72} fontSize={8.5}
                fill='#9ca3af' textAnchor='end'>{label}</text>
              {indices.map((snapIdx, col) => {
                const snap = snapshots[snapIdx]
                const layer = snap?.layers[key]
                if (!layer) return null
                const ratio = layer.max > 0 ? layer.score / layer.max : 0
                const isCur = col === curColIdx
                return (
                  <rect key={col}
                    x={LABEL_W + col * CELL_W} y={yTop + 1}
                    width={CELL_W - 1} height={CELL_H - 2}
                    fill={heatColor(ratio)}
                    opacity={isCur ? 1 : 0.8}
                    stroke={isCur ? 'white' : 'none'}
                    strokeWidth={isCur ? 0.8 : 0}
                  />
                )
              })}
            </g>
          )
        })}
        {/* Date axis */}
        {[0, Math.floor(indices.length/4), Math.floor(indices.length/2), Math.floor(3*indices.length/4), indices.length-1].map(ci => {
          const si = indices[ci]
          if (si === undefined || si >= n) return null
          return (
            <text key={ci} x={LABEL_W + ci * CELL_W + CELL_W/2}
              y={H - 4} fontSize={7} fill='#6b7280' textAnchor='middle'>
              {snapshots[si]?.date.slice(5)}
            </text>
          )
        })}
        {/* Current date cursor */}
        <line
          x1={LABEL_W + curColIdx * CELL_W + CELL_W/2}
          y1={0}
          x2={LABEL_W + curColIdx * CELL_W + CELL_W/2}
          y2={H - PAD_B}
          stroke='rgba(255,255,255,0.6)' strokeWidth={1} strokeDasharray='3 2'
        />
      </svg>
    </div>
  )
}

// ── Regime / Stage Timeline Bars ───────────────────────────────────────────────

function TimelineBars({ snapshots, currentIdx }: { snapshots: Snapshot[]; currentIdx: number }) {
  const W = 900, ROW_H = 20, PAD_L = 90, PAD_R = 8
  const n = snapshots.length
  if (n === 0) return null

  const xScale = (i: number) => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R)
  const cx = xScale(currentIdx)

  function makeSegments<T extends string | number>(
    values: T[], colorFn: (v: T) => string
  ): Array<{ x1: number; x2: number; color: string; label: string | number }> {
    const segs: Array<{ x1: number; x2: number; color: string; label: string | number }> = []
    let start = 0
    for (let i = 1; i <= n; i++) {
      if (i === n || values[i] !== values[i-1]) {
        segs.push({
          x1: xScale(start), x2: xScale(Math.min(i, n-1)),
          color: colorFn(values[start]),
          label: values[start],
        })
        start = i
      }
    }
    return segs
  }

  const regimeSegs = makeSegments(snapshots.map(s => s.regime),
    (r) => REGIME_COLORS[r] ?? '#6b7280')
  const stageSegs  = makeSegments(snapshots.map(s => s.crisis_stage),
    (s) => STAGE_COLORS[s as number] ?? '#6b7280')
  const domSegs    = makeSegments(snapshots.map(s => s.dominant_signal),
    () => '#60a5fa')

  const ROWS = [
    { label: 'Regime',   segs: regimeSegs, showLabel: true },
    { label: 'Stage',    segs: stageSegs,  showLabel: true },
    { label: 'Dominant', segs: domSegs,    showLabel: false },
  ]
  const totalH = ROWS.length * ROW_H + 16

  return (
    <svg viewBox={`0 0 ${W} ${totalH}`} style={{ width: '100%', height: totalH, display: 'block' }}>
      {ROWS.map((row, ri) => {
        const y = ri * ROW_H
        return (
          <g key={ri}>
            <text x={0} y={y + ROW_H * 0.72} fontSize={8.5} fill='#6b7280'>{row.label}</text>
            {row.segs.map((seg, si) => (
              <g key={si}>
                <rect x={seg.x1} y={y + 2} width={seg.x2 - seg.x1} height={ROW_H - 4}
                  fill={seg.color} opacity={0.75} rx={1} />
                {row.showLabel && (seg.x2 - seg.x1) > 30 && (
                  <text x={(seg.x1 + seg.x2) / 2} y={y + ROW_H * 0.72}
                    fontSize={7.5} fill='rgba(255,255,255,0.85)' textAnchor='middle'>
                    {String(seg.label).replace('Expansion','Exp').replace('Liquidity Crisis','Liq Crisis')}
                  </text>
                )}
              </g>
            ))}
          </g>
        )
      })}
      {/* Dominant signal labels at changes */}
      {domSegs.filter((s, i) => i === 0 || s.x2 - s.x1 > 50).map((seg, si) => (
        <text key={si} x={seg.x1 + 2} y={ROWS.length * ROW_H - 2}
          fontSize={6.5} fill='rgba(255,255,255,0.6)' style={{ pointerEvents: 'none' }}>
          {String(seg.label).split(' ').slice(0, 2).join(' ')}
        </text>
      ))}
      {/* Cursor */}
      <line x1={cx} y1={0} x2={cx} y2={totalH - 14}
        stroke='rgba(255,255,255,0.5)' strokeWidth={1.2} strokeDasharray='4 3' />
      {/* X-axis date labels */}
      {[0, Math.floor(n/4), Math.floor(n/2), Math.floor(3*n/4), n-1].map(idx => {
        if (idx >= n) return null
        return (
          <text key={idx} x={xScale(idx)} y={totalH - 2} fontSize={7.5} fill='#4b5563' textAnchor='middle'>
            {snapshots[idx]?.date.slice(0, 7)}
          </text>
        )
      })}
    </svg>
  )
}

// ── Summary Table ──────────────────────────────────────────────────────────────

function SummaryPanel({ summary }: { summary: Summary }) {
  const sc = (c: string) => ({ color: c })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* First Warning Dates */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>First Warning Dates</div>
        {Object.entries(summary.first_warning).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
              {k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())}
            </span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: v ? '#f59e0b' : '#4b5563' }}>
              {v ?? 'never'}
            </span>
          </div>
        ))}
      </div>

      {/* Peak Stress */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Peak Stress</div>
        {[
          ['Date',     summary.peak.date],
          ['Total',    `${summary.peak.total_risk}/120 (${summary.peak.state})`],
          ['MPS',      `${summary.peak.mps}/100`],
          ['Stage',    `${summary.peak.crisis_stage} - ${summary.peak.crisis_stage_label}`],
          ['Regime',   summary.peak.regime],
          ['Dominant', summary.peak.dominant_signal],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{label}</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#e5e7eb' }}>{val}</span>
          </div>
        ))}
      </div>

      {/* Regime Distribution */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Regime Distribution</div>
        {Object.entries(summary.regime_distribution.pct).sort(([,a],[,b]) => b-a).map(([regime, pct]) => (
          <div key={regime} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: '0.68rem', color: REGIME_COLORS[regime] ?? '#9ca3af', fontWeight: 700 }}>{regime}</span>
              <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{pct.toFixed(1)}%</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
              <div style={{ height: 4, width: `${pct}%`, background: REGIME_COLORS[regime] ?? '#6b7280', borderRadius: 2, opacity: 0.7 }} />
            </div>
          </div>
        ))}
        <div style={{ fontSize: '0.62rem', color: '#4b5563', marginTop: 4 }}>
          Changes: {summary.regime_distribution.change_count} | First change: {summary.regime_distribution.first_change_date ?? 'none'}
        </div>
      </div>

      {/* Dominant Signal */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Dominant Signal %</div>
        {Object.entries(summary.dominant_distribution.pct).sort(([,a],[,b]) => b-a).map(([sig, pct]) => (
          <div key={sig} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>{sig}</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#e5e7eb' }}>{pct.toFixed(1)}%</span>
          </div>
        ))}
        {summary.track_a_summary && (() => {
          const tas = summary.track_a_summary!
          return (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '0.6rem', color: '#f97316', fontWeight: 700, marginBottom: 4 }}>Track A (Credit Early Warning)</div>
              {[
                ['Tier 1 Watch first date', tas.first_tier1_date ?? 'None', '#f59e0b'],
                ['Tier 1 Watch days', String(tas.tier1_days ?? tas.watch_days ?? 0), '#f59e0b'],
                ['Tier 2 Confirmed first date', tas.first_tier2_date ?? tas.first_stage0_date ?? 'None', '#f97316'],
                ['Tier 2 Confirmed days', String(tas.tier2_days ?? tas.stage0_days ?? 0), '#f97316'],
                ['Peak Z-Credit', tas.peak_z_credit != null ? tas.peak_z_credit.toFixed(2) : '—', '#e5e7eb'],
              ].map(([label, val, col]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>{label}</span>
                  <span style={{ fontSize: '0.67rem', fontWeight: 700, color: val !== 'None' && val !== '0' ? col : '#6b7280' }}>{val}</span>
                </div>
              ))}
            </div>
          )
        })()}
        {summary.track_c_summary && (() => {
          const tcs = summary.track_c_summary!
          return (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '0.6rem', color: '#06b6d4', fontWeight: 700, marginBottom: 4 }}>Track C (Event/Shock)</div>
              {[
                ['First Watch date',     tcs.first_shock_watch_date ?? 'None',     '#38bdf8'],
                ['First Confirmed date', tcs.first_shock_confirmed_date ?? 'None', '#06b6d4'],
                ['Confirmed days',       String(tcs.shock_confirmed_days ?? 0),    '#06b6d4'],
                ['Watch days',           String(tcs.shock_watch_days ?? 0),        '#38bdf8'],
                ['Shock types',          (tcs.shock_types_seen ?? []).join(', ') || 'None', '#e5e7eb'],
              ].map(([label, val, col]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>{label}</span>
                  <span style={{ fontSize: '0.67rem', fontWeight: 700, color: val !== 'None' && val !== '0' ? col : '#6b7280' }}>{val}</span>
                </div>
              ))}
            </div>
          )
        })()}
        {summary.data_gap_summary.layers_with_gaps.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '0.62rem', color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>DATA GAPS:</div>
            {summary.data_gap_summary.layers_with_gaps.map(l => (
              <div key={l} style={{ fontSize: '0.6rem', color: '#6b7280' }}>
                {l}: {summary.data_gap_summary.gap_day_counts[l]}d
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function ReplayDashboard({ windows }: Props) {
  const [selWindow, setSelWindow] = useState(windows[0]?.window ?? '')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(120)
  const [activeTab, setActiveTab] = useState<'timeline'|'heatmap'|'bars'|'summary'>('timeline')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const win = windows.find(w => w.window === selWindow) ?? windows[0]
  const snaps = win?.snapshots ?? []
  const snap = snaps[currentIdx]

  const play = useCallback(() => {
    intervalRef.current = setInterval(() => {
      setCurrentIdx(idx => {
        if (idx >= snaps.length - 1) { setIsPlaying(false); return idx }
        return idx + 1
      })
    }, playSpeed)
  }, [snaps.length, playSpeed])

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (isPlaying) play()
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isPlaying, play])

  // Reset on window change
  useEffect(() => {
    setCurrentIdx(0)
    setIsPlaying(false)
  }, [selWindow])

  const sc = snap ? (STATE_COLORS[snap.state] ?? '#9ca3af') : '#9ca3af'
  const rc = snap ? (REGIME_COLORS[snap.regime] ?? '#9ca3af') : '#9ca3af'
  const stageColor = snap ? (STAGE_COLORS[snap.crisis_stage] ?? '#9ca3af') : '#9ca3af'
  const mc = snap ? mpsColor(snap.mps) : '#9ca3af'
  const pct = snap ? (snap.total_risk / 120) * 100 : 0

  const labelStyle: React.CSSProperties = {
    fontSize: '0.58rem', color: '#6b7280', letterSpacing: '0.1em',
    textTransform: 'uppercase', fontWeight: 700, marginBottom: 4,
  }
  const divider: React.CSSProperties = {
    borderRight: '1px solid rgba(255,255,255,0.07)', paddingRight: 10, marginRight: 4
  }

  return (
    <div style={{ background: '#0a0c10', minHeight: '100vh', padding: '1.2rem 1.4rem', display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'monospace' }}>

      {/* Window Selector Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.65rem', color: '#4b5563', fontWeight: 700, letterSpacing: '0.1em' }}>REPLAY ENGINE</span>
        {windows.map(w => (
          <button key={w.window} onClick={() => setSelWindow(w.window)}
            style={{
              fontSize: '0.72rem', fontWeight: 700, padding: '5px 12px', borderRadius: 6,
              border: selWindow === w.window ? '1px solid rgba(96,165,250,0.6)' : '1px solid rgba(255,255,255,0.1)',
              background: selWindow === w.window ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: selWindow === w.window ? '#60a5fa' : '#6b7280',
              cursor: 'pointer',
            }}>
            {WINDOW_LABELS[w.window] ?? w.window}
          </button>
        ))}
        <span style={{ fontSize: '0.62rem', color: '#4b5563', marginLeft: 'auto' }}>
          {win?.date_range?.start} → {win?.date_range?.end}  ({win?.trading_days}d)
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => setIsPlaying(p => !p)}
          style={{
            fontSize: '0.75rem', fontWeight: 700, padding: '5px 14px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)', background: isPlaying ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
            color: isPlaying ? '#ef4444' : '#22c55e', cursor: 'pointer', flexShrink: 0,
          }}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <input type='range' min={0} max={snaps.length - 1} value={currentIdx}
          onChange={e => { setIsPlaying(false); setCurrentIdx(Number(e.target.value)) }}
          style={{ flex: 1, accentColor: '#60a5fa' }} />
        <span style={{ fontSize: '0.7rem', color: '#e5e7eb', minWidth: 90 }}>
          {snap?.date ?? '---'}
        </span>
        <select value={playSpeed} onChange={e => setPlaySpeed(Number(e.target.value))}
          style={{ fontSize: '0.65rem', background: '#111827', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '3px 6px' }}>
          <option value={50}>Fast</option>
          <option value={120}>Normal</option>
          <option value={300}>Slow</option>
        </select>
      </div>

      {/* Header Snapshot — 5-column */}
      {snap && (
        <div style={{ background: '#0d1117', border: `1px solid ${sc}44`, borderLeft: `4px solid ${sc}`, borderRadius: 12, padding: '0.9rem 1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '0.75fr 1.3fr 1.8fr 1.6fr 1.1fr', gap: 10, alignItems: 'start' }}>
            {/* MPS */}
            <div style={divider}>
              <div style={labelStyle}>Macro Pressure</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                <span style={{ fontSize: '2rem', fontWeight: 900, color: mc, lineHeight: 1 }}>{snap.mps}</span>
                <span style={{ fontSize: '0.7rem', color: '#4b5563' }}>/100</span>
              </div>
            </div>
            {/* Market Regime */}
            <div style={divider}>
              <div style={labelStyle}>Market Regime</div>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: rc, background: `${rc}12`, border: `1px solid ${rc}40`, borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>
                {snap.regime}
              </span>
              <div style={{ fontSize: '0.6rem', color: '#6b7280', marginTop: 3 }}>{snap.regime_confidence}% confidence</div>
            </div>
            {/* Total Risk */}
            <div style={divider}>
              <div style={labelStyle}>12-Layer Systemic Risk</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: '2.8rem', fontWeight: 900, color: sc, lineHeight: 1 }}>{snap.total_risk}</span>
                <span style={{ fontSize: '0.9rem', color: '#6b7280' }}>/120</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: sc }}>{snap.state.toUpperCase()}</span>
              </div>
              {/* Gradient bar */}
              <div style={{ position: 'relative', height: 5, borderRadius: 3, marginTop: 6, background: 'linear-gradient(90deg,#22c55e 0%,#84cc16 25%,#f59e0b 42%,#f97316 58%,#ef4444 75%,#b91c1c 100%)', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `${100 - pct}%`, background: 'rgba(0,0,0,0.76)' }} />
              </div>
            </div>
            {/* Crisis Stage */}
            <div style={divider}>
              <div style={labelStyle}>Crisis Stage</div>
              <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginBottom: 3 }}>Stage {snap.crisis_stage}</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: stageColor, background: `${stageColor}12`, border: `1px solid ${stageColor}33`, borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>
                {snap.crisis_stage_label}
              </div>
            </div>
            {/* Dominant */}
            <div>
              <div style={labelStyle}>Dominant Signal</div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e5e7eb', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>
                {snap.dominant_signal}
              </span>
              <div style={{ marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {(['SPY','QQQ','VIX','HY_OAS'] as const).map(r => (
                  snap.refs[r] !== null && snap.refs[r] !== undefined && (
                    <span key={r} style={{ fontSize: '0.6rem', color: '#4b5563' }}>
                      {r}: <span style={{ color: '#9ca3af' }}>{snap.refs[r]?.toFixed(r === 'VIX' || r === 'HY_OAS' ? 1 : 2)}</span>
                    </span>
                  )
                ))}
              </div>
            </div>
          </div>

          {/* Track A — Credit Early Warning strip (2-Tier) */}
          {(() => {
            const velDelta = snap.track_b?.mss_5d_delta ?? snap.master_signal?.mss_5d_delta ?? snap.mss_5d_delta ?? null
            const velAlert = Boolean(snap.track_b?.velocity_alert ?? snap.master_signal?.mss_velocity_alert ?? snap.mss_velocity_alert)
            const velColor = velAlert ? '#ef4444' : '#22c55e'
            if (velDelta == null) return null
            return (
              <div style={{
                marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: '0.52rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Track B</span>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 800, color: velColor,
                  background: `${velColor}15`, border: `1px solid ${velColor}44`,
                  borderRadius: 5, padding: '2px 8px',
                }}>
                  MSS 5D {velDelta > 0 ? '+' : ''}{velDelta.toFixed(1)}pt {velAlert ? 'ALERT' : 'OK'}
                </span>
                <span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>
                  {snap.track_b?.velocity_signal ?? (velAlert ? '구조 가속 경보' : '정상 범위')}
                </span>
              </div>
            )
          })()}

          {snap.track_a && (() => {
            const ta = snap.track_a!
            const TA_COLORS: Record<string, string> = {
              'Stealth Stress': '#f97316', 'Credit Watch': '#f59e0b',
              'Credit Alert': '#ef4444', 'Watch': '#f59e0b',
              'Elevated': '#eab308', 'Normal': '#22c55e', 'Unavailable': '#6b7280',
            }
            const taColor = TA_COLORS[ta.state] ?? '#9ca3af'
            return (
              <div style={{
                marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: '0.52rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Track A</span>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 800, color: taColor,
                  background: `${taColor}15`, border: `1px solid ${taColor}44`,
                  borderRadius: 5, padding: '2px 8px',
                }}>{ta.state}{ta.stage0 ? ' ⚠' : ''}</span>
                {ta.stage0_watch && (
                  <span style={{ fontSize: '0.6rem', color: taColor, fontWeight: 700 }}>
                    {ta.stage0 ? `CONFIRMED Day ${ta.consecutive_days}` : `Day ${ta.consecutive_days}/3`}
                  </span>
                )}
                <span style={{ fontSize: '0.6rem', color: '#6b7280' }}>
                  Z: <span style={{ color: taColor, fontWeight: 700 }}>{ta.z_credit?.toFixed(2) ?? '—'}</span>
                </span>
                {ta.hy_oas_current != null && (
                  <span style={{ fontSize: '0.6rem', color: '#6b7280' }}>
                    HY OAS: <span style={{ color: '#e5e7eb', fontWeight: 700 }}>{ta.hy_oas_current.toFixed(1)}%</span>
                    {ta.roc_hy_5d != null && (
                      <span style={{ color: ta.roc_hy_5d > 0 ? '#f97316' : '#22c55e', marginLeft: 4 }}>
                        {ta.roc_hy_5d > 0 ? '+' : ''}{ta.roc_hy_5d.toFixed(1)}% 5d
                      </span>
                    )}
                  </span>
                )}
              </div>
            )
          })()}

          {/* Master Signal Banner */}
          {snap.master_signal && snap.master_signal.mode !== 'ALL_CLEAR' && (() => {
            const ms = snap.master_signal!
            const msColors: Record<string, string> = {
              'COMPOUND_CRISIS': '#ef4444',
              'CREDIT_CRISIS':   '#f97316',
              'HEDGE_AND_HOLD':  '#06b6d4',
            }
            const msColor = msColors[ms.mode] ?? '#9ca3af'
            const velDelta = ms.mss_5d_delta
            const velAlert = Boolean(ms.mss_velocity_alert)
            const velColor = velAlert ? '#ef4444' : '#22c55e'
            const escList = (ms.escalation_conditions ?? []).slice(0, 3)
            return (
              <div style={{
                marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)',
                borderLeft: `3px solid ${msColor}`, paddingLeft: 10,
                background: `${msColor}10`, borderRadius: '0 6px 6px 0',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.52rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Master</span>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 900, color: msColor,
                    background: `${msColor}20`, border: `1px solid ${msColor}60`,
                    borderRadius: 5, padding: '2px 8px',
                  }}>{ms.action}</span>
                  {velDelta != null && (
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 800, color: velColor,
                      background: `${velColor}18`, border: `1px solid ${velColor}44`,
                      borderRadius: 999, padding: '2px 8px',
                    }}>
                      MSS 5D {velDelta > 0 ? '+' : ''}{velDelta.toFixed(1)}pt {velAlert ? 'ALERT' : 'OK'}
                    </span>
                  )}
                  <span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>{ms.detail}</span>
                </div>
                {escList.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.52rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Escalation</span>
                    {escList.map((ec, idx) => {
                      const ecColor = ec.already_fired ? '#ef4444' : '#f59e0b'
                      return (
                        <span
                          key={`${ec.sensor_key}-${idx}`}
                          title={`${ec.name} | ${ec.current ?? '--'} / ${ec.threshold ?? '--'} | ${ec.would_trigger}`}
                          style={{
                            fontSize: '0.58rem',
                            fontWeight: 700,
                            color: ecColor,
                            background: `${ecColor}18`,
                            border: `1px solid ${ecColor}44`,
                            borderRadius: 5,
                            padding: '2px 7px',
                          }}
                        >
                          {escBadgeLabel(ec.sensor_key, ec.badge)}: {ec.pct_to_trigger}%
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Track C — Event/Shock strip */}
          {snap.track_c && snap.track_c.state !== 'Normal' && (() => {
            const tc = snap.track_c!
            const tcColor = tc.state === 'Shock Confirmed' ? '#06b6d4' : '#38bdf8'
            return (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.52rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>Track C</span>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 800, color: tcColor,
                  background: `${tcColor}15`, border: `1px solid ${tcColor}44`,
                  borderRadius: 5, padding: '2px 8px',
                }}>{tc.state}</span>
                {tc.triggered_sensors.map((ts) => (
                  <span key={ts.badge} style={{
                    fontSize: '0.62rem', fontWeight: 700, color: tcColor,
                    background: `${tcColor}12`, border: `1px solid ${tcColor}30`,
                    borderRadius: 4, padding: '1px 6px',
                  }}>{ts.badge} Z:{ts.z.toFixed(1)}</span>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 6 }}>
        {(['timeline','heatmap','bars','summary'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '4px 12px', borderRadius: 5,
              border: activeTab === tab ? '1px solid rgba(96,165,250,0.5)' : '1px solid transparent',
              background: activeTab === tab ? 'rgba(96,165,250,0.1)' : 'transparent',
              color: activeTab === tab ? '#60a5fa' : '#6b7280', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
            {tab === 'timeline' ? 'Timeline' : tab === 'heatmap' ? 'Layer Heatmap' : tab === 'bars' ? 'Regime/Stage' : 'Summary'}
          </button>
        ))}
      </div>

      {/* Chart panels */}
      <div style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '1rem' }}>
        {activeTab === 'timeline' && (
          <>
            <div style={{ fontSize: '0.62rem', color: '#6b7280', marginBottom: 8, fontWeight: 700, letterSpacing: '0.08em' }}>
              TOTAL RISK (colored) + MPS (dashed amber)  |  Y-axis: 0-120
            </div>
            <TimelineChart snapshots={snaps} currentIdx={currentIdx} onSeek={setCurrentIdx} />
          </>
        )}
        {activeTab === 'heatmap' && (
          <>
            <div style={{ fontSize: '0.62rem', color: '#6b7280', marginBottom: 8, fontWeight: 700, letterSpacing: '0.08em' }}>
              LAYER HEATMAP — Score/Max ratio  |  Green=low, Red=high  |  Highlighted column = current date
            </div>
            <LayerHeatmap snapshots={snaps} currentIdx={currentIdx} />
          </>
        )}
        {activeTab === 'bars' && (
          <>
            <div style={{ fontSize: '0.62rem', color: '#6b7280', marginBottom: 8, fontWeight: 700, letterSpacing: '0.08em' }}>
              REGIME / STAGE / DOMINANT SIGNAL TIMELINE
            </div>
            <TimelineBars snapshots={snaps} currentIdx={currentIdx} />
          </>
        )}
        {activeTab === 'summary' && win?.summary && (
          <SummaryPanel summary={win.summary} />
        )}
      </div>

      {/* Data gap notice */}
      {snap?.data_gaps?.length > 0 && (
        <div style={{ fontSize: '0.6rem', color: '#ef4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '6px 10px' }}>
          Data gaps on {snap.date}: {snap.data_gaps.join(', ')}
        </div>
      )}
    </div>
  )
}
