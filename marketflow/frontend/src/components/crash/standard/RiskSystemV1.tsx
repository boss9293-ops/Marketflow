'use client'

import { useState, useMemo, useEffect } from 'react'
import MonteCarloInterpretationCard from '@/components/MonteCarloInterpretationCard'
import { buildStandardInterpretationDisplayModel } from '@/lib/standard/buildStandardInterpretationDisplayModel'
import { pickLang, type UiLang } from '@/lib/uiLang'
import { UI_TEXT } from '@/lib/uiText'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
  ReferenceDot, ReferenceArea, Legend,
} from 'recharts'

// Types
type Component = { name: string; range?: string; weight?: number; desc: string }
type LevelTier  = { level: number; range: string; label: string; exposure: number; color: string }
type EventType  = { type: string; desc: string }
type ScoreZone = { range: string; label: string; desc: string }
type Methodology = {
  score_components: Component[]
  score_zones?: ScoreZone[]
  level_tiers: LevelTier[]
  event_types: EventType[]
  disclaimer: string
}

type HistPoint  = { date: string; score: number; level: number; vol_pct: number | null; dd_pct: number | null; event_type: string }
type EventRec   = {
  id: number; name: string; start: string; end: string; peak_score: number; peak_level: number;
  event_type: string; duration_days: number; level_label: string; explanation: string;
  qqq_drawdown_pct: number; tqqq_drawdown_pct: number | null;
  fwd_ret_1m: number | null; fwd_ret_3m: number | null; fwd_ret_6m: number | null; ongoing?: boolean;
}
type BtStats = { total_return: number; ann_return: number; max_drawdown: number; calmar: number | null }
type Backtest = {
  start_date: string; end_date: string; years: number; sell_rule: string; buy_rule: string;
  bh: BtStats; strategy: BtStats; days_in_cash: number; days_total: number; cash_pct: number;
}
type CurvePoint = { date: string; bh: number; strat: number; in_mkt: boolean }

type ContextItem = { score: number; state: string; vs_ma200: number | null; dd_pct: number | null; label: string }
type RotationItem = { state: string; rs_20d: number | null; rs_60d: number | null; label: string }
type ContextBlock = {
  spy: ContextItem; dia: ContextItem; rotation: RotationItem;
  final_risk: string; final_exposure: number; brief: string;
}
type Current = {
  date: string; score: number; level: number; level_label: string; event_type: string;
  exposure_pct: number; price: number; ma50: number | null; ma200: number | null;
  dd_pct: number; vol_pct: number; days_below_ma200: number;
  shock_p: number; struct_p: number; grind_p: number;
  components: { trend: number; depth: number; vol: number; dd: number };
  context?: ContextBlock;
}

type CtxHistPoint = { date: string; qqq_vs_ma200?: number | null; spy_vs_ma200: number | null; spy_dd: number; dia_vs_ma200: number | null; dia_dd: number | null; rs_n: number }
type LayerScore = { score: number; max: number; label: string; desc: string; key?: string; [key: string]: unknown }
type CrisisStage = { stage: number; label: string; plain_label_ko: string; all_labels_ko: string[]; color: string; desc: string; all_labels: string[]; all_colors: string[] }
type RegimeInfo = { regime: string; color: string; desc: string; confidence: number; drivers: string[]; weights: Record<string, number> }
type TotalRisk = {
  total: number; mps: number; regime: RegimeInfo; state: string; state_color: string; action: string; dominant_layer: string;
  crisis_stage: CrisisStage;
  layers: { equity: LayerScore; breadth: LayerScore; credit: LayerScore; lev_loan: LayerScore; liquidity: LayerScore; funding: LayerScore; macro: LayerScore; shock: LayerScore; cross_asset: LayerScore; credit_spread: LayerScore; liquidity_shock: LayerScore; financial_stress: LayerScore }
}
type TrackA = {
  z_credit: number | null; z_hy: number | null; z_ig: number | null;
  stage0: boolean; stage0_watch: boolean; consecutive_days: number;
  state: string; signal: string;
  roc_hy_5d: number | null; roc_ig_5d: number | null; hy_oas_current: number | null;
  as_of_date?: string;
  component_dates?: Record<string, string | null>;
  equity_filter: { qqq_above_ma50: boolean; qqq_drawdown_pct: number | null; equity_healthy: boolean };
}
type TrackAEarlyMetric = {
  key: string
  label: string
  z: number | null
  roc_5d: number | null
  stress: number
  triggered: boolean
}
type TrackAEarly = {
  score: number | null
  state: string
  signal: string
  equity_healthy: boolean
  trigger_count: number
  triggered: string[]
  as_of_date?: string
  component_dates?: Record<string, string | null>
  metrics?: TrackAEarlyMetric[]
}
type TrackC = {
  score: number; max_score: number;
  state: string;   // "Normal" | "Shock Watch" | "Shock Confirmed"
  shock_type: string;
  as_of_date?: string;
  sensor_dates?: Record<string, string | null>;
  triggered_sensors: Array<{ name: string; z: number; badge: string }>
  signal: string;
  sensors: { yen_carry_z: number | null; oil_shock_z: number | null; vix_velocity_z: number | null; safe_haven_z: number | null }
}
type TrackB = {
  mss_current: number
  mss_5d_ago: number
  mss_5d_delta: number
  mss_5d_ago_date?: string
  velocity_alert: boolean
  velocity_pct: number
  velocity_signal: string
}
type InputFreshnessItem = {
  source: string
  last_date: string | null
  days_stale: number | null
  is_stale: boolean
  cadence?: string | null
  note?: string | null
}
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
type MasterSignal = {
  mode: string;    // "ALL_CLEAR" | "EARLY_WARNING" | "CREDIT_CRISIS" | "HEDGE_AND_HOLD" | "COMPOUND_CRISIS"
  action: string;  // "HOLD" | "REDUCE" | "HEDGE"
  severity: string; detail: string;
  track_a_active: boolean; track_a_early_active?: boolean; track_c_active: boolean;
  escalation_conditions?: EscalationCondition[]
  mss_velocity_alert?: boolean
  mss_5d_delta?: number | null
}
type MarketRegime = {
  regime: string           // "Expansion" | "Early Stress" | "Credit Stress" | "Liquidity Crisis"
  regime_color: string
  regime_desc: string
  regime_confidence: number
  regime_drivers: string[]
  days_in_regime: number
  distance_to_boundary: number
  stability_score: number
  stability_label: string  // "STABLE" | "TRANSITIONING" | "UNSTABLE"
  stability_color: string
}
type RiskScenario = {
  scenario: string   // "A" | "B" | "C" | "D"
  label: string
  color: string
  fill: string
  desc: string
  action_hint: string
  confidence: number
}
type RiskContributionItem = {
  key: string; label: string; score: number; max: number
  ratio: number; contribution_pct: number
}
type EventSimilarityItem = {
  name: string; start: string; start_mss: number;
  peak_level: number; peak_mss: number;
  shock_category: string; regime_at_peak: string;
  qqq_drawdown_pct: number | null;
  duration_days: number;
  fwd_ret_1m: number | null; fwd_ret_3m: number | null;
  similarity_pct: number;
}
type TransmissionNode = {
  label: string; label_ko: string; stress: number; color: string; status: string;
}
type TransmissionEdge = {
  from: string; to: string; active: boolean; strength: number;
  label: string; label_ko: string;
}
type GlobalTransmission = {
  nodes: Record<string, TransmissionNode>;
  edges: TransmissionEdge[];
  tc_edge: TransmissionEdge;
  active_paths: string[];
  transmission_state: string;  // "Contained" | "Emerging" | "Active" | "Critical"
  transmission_color: string;
  n_active_edges: number;
}
type ConcentrationData = {
  available: boolean;
  mag7_5d: number | null; mag7_20d: number | null; mag7_60d: number | null;
  spy_5d:  number | null; spy_20d:  number | null; spy_60d:  number | null;
  rel_5d:  number | null; rel_20d:  number | null; rel_60d:  number | null;
  label: string; color: string; risk: string; count?: number;
}
type BreadthMetrics = {
  as_of: string
  universe_count: number
  pct_above_ma200: number | null
  pct_above_ma50: number | null
  pct_52w_high: number | null
  pct_52w_low: number | null
  divergence: boolean
  divergence_signal: string  // "HEALTHY" | "SOFTENING" | "TOP_WARNING" | "TOP_WARNING_STRONG"
  divergence_desc: string
  health_label: string
  health_color: string
}
type SignalRow = {
  date: string; mss: number;
  ret_30d: number | null; ret_60d: number | null; ret_90d: number | null;
  max_drop_60d: number; result: string;
}
type TrackAEarlyDetectionRow = {
  name: string
  event_start: string
  first_signal: string | null
  lead_days: number | null
  first_signal_triggered?: string[]
  first_strong_signal: string | null
  strong_lead_days: number | null
  first_strong_triggered?: string[]
  best_score_window: number | null
  best_state_window: string | null
  best_triggered?: string[]
  peak_level: number
  qqq_drawdown: number | null
}
type CondReturn = { n: number; mean: number; median: number; pos_rate: number; p10: number; p90: number }
type SignalAnalysis = {
  signal_count: number; true_positive: number; partial: number; false_alarm: number;
  tp_rate: number; avg_drop_60d: number;
  signals: SignalRow[];
  conditional_returns: Record<string, CondReturn>;
  event_detection: Array<{ name: string; event_start: string; first_signal: string | null; lead_days: number | null; qqq_drawdown: number; peak_level: number }>;
  track_a_early?: {
    event_detection: TrackAEarlyDetectionRow[]
    events_with_signal: number
    events_with_strong_signal: number
    avg_lead_days: number | null
    avg_strong_lead_days: number | null
  }
}
export type RiskV1Data = {
  run_id: string; current: Current; history: HistPoint[];
  context_history?: CtxHistPoint[];
  data_as_of?: string;
  input_freshness?: Record<string, InputFreshnessItem>;
  total_risk?: TotalRisk;
  track_a?: TrackA;
  track_a_early?: TrackAEarly;
  track_b?: TrackB;
  track_c?: TrackC;
  master_signal?: MasterSignal;
  events: EventRec[];
  backtest: Backtest; backtest_curve: CurvePoint[]; methodology: Methodology;
  signal_analysis?: SignalAnalysis;
  breadth?: BreadthMetrics
  concentration?: ConcentrationData;
  market_regime?: MarketRegime;
  risk_scenario?: RiskScenario;
  risk_contribution?: RiskContributionItem[];
  event_similarity?: EventSimilarityItem[];
  global_transmission?: GlobalTransmission;
}

function buildAxisTicks<T extends Record<string, unknown>>(
  points: T[],
  key: keyof T,
  desiredCount: number,
): Array<string | number> {
  const readTickValue = (point: T): string | number | null => {
    const value = point[key]
    return typeof value === 'string' || typeof value === 'number' ? value : null
  }
  if (!points.length) return []
  if (points.length <= desiredCount) {
    return points.map(readTickValue).filter((value): value is string | number => value !== null)
  }
  const step = Math.max(1, Math.floor((points.length - 1) / Math.max(1, desiredCount - 1)))
  const tickIndices: number[] = []
  for (let i = 0; i < points.length; i += step) {
    tickIndices.push(i)
  }

  const lastIndex = points.length - 1
  if (tickIndices[tickIndices.length - 1] !== lastIndex) {
    const prevIndex = tickIndices[tickIndices.length - 1]
    const minTailGap = Math.max(1, Math.floor(step * 0.6))
    if (lastIndex - prevIndex < minTailGap) {
      tickIndices[tickIndices.length - 1] = lastIndex
    } else {
      tickIndices.push(lastIndex)
    }
  }

  const seen = new Set<string | number>()
  const ticks: Array<string | number> = []
  tickIndices.forEach((index) => {
    const value = readTickValue(points[index])
    if (value == null || seen.has(value)) return
    seen.add(value)
    ticks.push(value)
  })
  return ticks
}

// Playback types
type PbPoint = {
  d: string; qqq_n: number; ma50_n: number | null; ma200_n: number | null; tqqq_n: number | null;
  dd: number; tqqq_dd: number | null; score: number; level: number; in_ev: boolean; ev_type: string;
}
type PbEvent = {
  id: number; name: string; start: string; end: string; event_type: string;
  explanation: string; risk_on_date: string | null; risk_off_date: string | null; playback: PbPoint[];
}

// Constants
const LEVEL_COLORS: Record<number, string> = {
  0: '#22c55e', 1: '#f59e0b', 2: '#f97316', 3: '#ef4444', 4: '#7c3aed',
}
const TYPE_COLORS: Record<string, string> = {
  'Shock': '#ef4444', 'Structural': '#f97316', 'Grinding': '#f59e0b', 'Mixed': '#a78bfa', 'Normal': '#22c55e',
}

const TABS = ['Overview', 'Event Library', 'Event Playback', 'Signal Analysis', 'Methodology'] as const
type Tab = typeof TABS[number]

const TAB_COPY: Record<Tab, { ko: string; en: string }> = {
  Overview: UI_TEXT.risk.overview,
  'Event Library': UI_TEXT.risk.eventLibrary,
  'Event Playback': UI_TEXT.risk.eventPlayback,
  'Signal Analysis': UI_TEXT.risk.signalAnalysis,
  Methodology: UI_TEXT.risk.methodology,
}

// Helpers
function card(extra?: object) {
  return { background: '#111318', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '1.3rem 1.43rem', ...extra } as const
}
function mini(extra?: object) {
  return { background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.65rem 0.91rem', ...extra } as const
}

function fmt(v: number | null | undefined, suffix = '%', decimals = 1) {
  if (v == null) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}${suffix}`
}
function fmtAbs(v: number | null | undefined, suffix = '%', decimals = 1) {
  if (v == null) return '--'
  return `${v.toFixed(decimals)}${suffix}`
}

function labelInput(name: string): string {
  return {
    qqq: 'QQQ',
    spy: 'SPY',
    hyg: 'HYG',
    lqd: 'LQD',
    dxy: 'DXY',
    vix: 'VIX',
    put_call: 'Put/Call',
    hy_oas: 'HY OAS',
    ig_oas: 'IG OAS',
    fsi: 'FSI',
    move: 'MOVE',
  }[name] || name
}

function HalfGauge({
  value,
  max,
  color,
  width = 96,
  height = 74,
  valueFontSize = 18,
  denomFontSize = 9,
}: {
  value: number
  max: number
  color: string
  width?: number
  height?: number
  valueFontSize?: number
  denomFontSize?: number
}) {
  const pct = Math.min(1, Math.max(0, value / max))
  const cx = 50
  const cy = 34
  const r = 26
  const theta = Math.PI * (1 - pct)
  const ex = cx + r * Math.cos(theta)
  const ey = cy - r * Math.sin(theta)
  const largeArc = 0
  const bgArc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  const fgArc = `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`
  return (
    <svg viewBox="0 0 100 78" width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <path d={bgArc} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8} strokeLinecap="round" />
      {pct > 0.01 && <path d={fgArc} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />}
      <text x="50" y="67" textAnchor="middle">
        <tspan fontSize={valueFontSize} fontWeight="900" fill={color}>{value}</tspan>
        <tspan dx="2" dy="-2" fontSize={denomFontSize} fill="#9ca3af">/{max}</tspan>
      </text>
    </svg>
  )
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

type MssZone = { key: string; label: string; min: number; max: number; color: string; fill: string }
const MSS_ZONES: MssZone[] = [
  { key: 'overheat', label: 'OVERHEAT',          min: 120, max: 130, color: '#84cc16', fill: 'rgba(132,204,22,0.12)' },
  { key: 'strong',   label: 'STRONG BULL',      min: 110, max: 120, color: '#22c55e', fill: 'rgba(34,197,94,0.12)' },
  { key: 'bull',     label: 'BULL / HEALTHY',   min: 100, max: 110, color: '#22d3ee', fill: 'rgba(34,211,238,0.10)' },
  { key: 'neutral',  label: 'NEUTRAL / WEAK',   min: 95,  max: 100, color: '#f59e0b', fill: 'rgba(245,158,11,0.10)' },
  { key: 'warning',  label: 'WARNING',          min: 90,  max: 95,  color: '#f97316', fill: 'rgba(249,115,22,0.12)' },
  { key: 'risk',     label: 'RISK',             min: 80,  max: 90,  color: '#ef4444', fill: 'rgba(239,68,68,0.12)' },
  { key: 'crisis',   label: 'CRISIS',           min: 60,  max: 80,  color: '#b91c1c', fill: 'rgba(185,28,28,0.14)' },
]

const RISK_ZONES = [
  { label: 'LOW',     min: 0,  max: 10, color: '#84cc16', fill: 'rgba(132,204,22,0.08)' },
  { label: 'GUARDED', min: 10, max: 20, color: '#f59e0b', fill: 'rgba(245,158,11,0.10)' },
  { label: 'ELEVATED',min: 20, max: 30, color: '#f97316', fill: 'rgba(249,115,22,0.12)' },
  { label: 'HIGH',    min: 30, max: 40, color: '#ef4444', fill: 'rgba(239,68,68,0.14)' },
  { label: 'CRISIS',  min: 40, max: 60, color: '#b91c1c', fill: 'rgba(185,28,28,0.18)' },
]

// Historical crisis period overlays for full MSS timeline chart
const CRISIS_OVERLAYS = [
  { label: '2000 Dotcom', x1: '2000-03-27', x2: '2002-10-09', color: '#ef4444', fill: 'rgba(239,68,68,0.09)' },
  { label: '2008 GFC',    x1: '2007-10-11', x2: '2009-03-09', color: '#f97316', fill: 'rgba(249,115,22,0.09)' },
  { label: '2018 US-CN Trade', x1: '2018-11-01', x2: '2018-12-31', labelX: '2018-08-01', color: '#f59e0b', fill: 'rgba(245,158,11,0.10)' },
  { label: '2020 COVID',  x1: '2020-02-20', x2: '2020-03-23', color: '#60a5fa', fill: 'rgba(96,165,250,0.12)' },
  { label: '2022 Tight.', x1: '2022-01-03', x2: '2022-10-13', color: '#a78bfa', fill: 'rgba(167,139,250,0.09)' },
  { label: '2024 Yen',    x1: '2024-08-01', x2: '2024-08-31', color: '#22d3ee', fill: 'rgba(34,211,238,0.11)' },
  { label: '2025 Trump Tariff', x1: '2025-04-01', x2: '2025-04-30', color: '#fb7185', fill: 'rgba(251,113,133,0.10)' },
] as const

function interpretMssZone(score: number | null | undefined) {
  if (score == null) return MSS_ZONES[3]
  if (score >= 120) return MSS_ZONES[0]
  if (score >= 110) return MSS_ZONES[1]
  if (score >= 100) return MSS_ZONES[2]
  if (score >= 95)  return MSS_ZONES[3]
  if (score >= 90)  return MSS_ZONES[4]
  if (score >= 80)  return MSS_ZONES[5]
  return MSS_ZONES[6]
}

function exposureBandFromScore(score: number | null | undefined) {
  if (score == null) return '--'
  if (score >= 120) return '75-100% (tighten risk)'
  if (score >= 110) return '100%'
  if (score >= 100) return '75-100%'
  if (score >= 95)  return '50-75%'
  if (score >= 90)  return '50%'
  if (score >= 80)  return '25-50%'
  return '0-25%'
}

function riskIntensityFromMss(score: number | null | undefined) {
  if (score == null) return null
  return Math.max(0, 130 - score)
}

// Tab bar
function TabBar({ tab, setTab, uiLang }: { tab: Tab; setTab: (t: Tab) => void; uiLang: UiLang }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {TABS.map((t) => {
        const on = t === tab
        return (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '0.45rem 1rem', borderRadius: 9,
            border: on ? '1px solid rgba(129,140,248,0.45)' : '1px solid rgba(148,163,184,0.16)',
            background: on ? 'rgba(99,102,241,0.16)' : 'rgba(255,255,255,0.03)',
            color: on ? '#eef3ff' : '#d7e1ee',
            fontSize: '0.9rem', fontWeight: on ? 700 : 600, letterSpacing: '0.01em', cursor: 'pointer',
          }}>{pickLang(uiLang, TAB_COPY[t].ko, TAB_COPY[t].en)}</button>
        )
      })}
    </div>
  )
}

// Overview Tab
function buildCausalChain(data: RiskV1Data, uiLang: UiLang): Array<{ step: string; text: string; color: string }> {
  const L = (ko: string, en: string) => pickLang(uiLang, ko, en)
  const mps = Math.round(data.total_risk?.mps ?? 0)
  const mss = data.current.score ?? 100
  const breadth = data.breadth
  const trackA = data.track_a
  const total = data.total_risk
  const levLoan = total?.layers.lev_loan
  const fin = total?.layers.financial_stress
  const totalScore = total?.total ?? 0

  let s1 = { step: 'Context', text: L('시장 조건은 전반적으로 안정적입니다.', 'Market conditions are broadly stable.'), color: '#22c55e' }
  if (mps >= 60) {
    s1 = { step: 'Context', text: L(`매크로 압력이 높습니다. MPS ${mps}.`, `Macro pressure is elevated. MPS ${mps}.`), color: '#ef4444' }
  } else if (breadth?.divergence) {
    s1 = { step: 'Context', text: L(`내부 breadth가 지수 대비 약합니다. MA200 breadth ${breadth.pct_above_ma200?.toFixed(0)}%.`, `Internal breadth is weak versus the index. MA200 breadth ${breadth.pct_above_ma200?.toFixed(0)}%.`), color: '#f97316' }
  } else if (mps >= 40) {
    s1 = { step: 'Context', text: L(`매크로 압력이 쌓이고 있습니다. MPS ${mps}.`, `Macro pressure is building. MPS ${mps}.`), color: '#f59e0b' }
  }

  let s2 = { step: 'Cause', text: L('핵심 경고 신호는 아직 제한적입니다.', 'Core warning signals remain limited.'), color: '#22c55e' }
  if (trackA?.stage0) {
    s2 = { step: 'Cause', text: L(`Track A credit stress가 확인되었습니다. Z ${trackA.z_credit?.toFixed(2)}.`, `Track A credit stress is confirmed. Z ${trackA.z_credit?.toFixed(2)}.`), color: '#ef4444' }
  } else if (levLoan && levLoan.score / levLoan.max > 0.6) {
    s2 = { step: 'Cause', text: L(`레버리지론 레이어가 약화되고 있습니다. ${levLoan.score}/${levLoan.max}.`, `The leveraged-loan layer is weakening. ${levLoan.score}/${levLoan.max}.`), color: '#f97316' }
  } else if (trackA?.hy_oas_current != null && trackA.hy_oas_current > 4.5) {
    s2 = { step: 'Cause', text: L(`HY OAS가 확대되고 있습니다. ${trackA.hy_oas_current.toFixed(1)}%.`, `HY OAS is widening. ${trackA.hy_oas_current.toFixed(1)}%.`), color: '#f97316' }
  } else if (fin && fin.score / fin.max > 0.5) {
    s2 = { step: 'Cause', text: L(`금융 스트레스 레이어가 상승 중입니다. ${fin.score}/${fin.max}.`, `The financial stress layer is rising. ${fin.score}/${fin.max}.`), color: '#f59e0b' }
  }

  let s3 = { step: 'Result', text: L(`MSS ${mss.toFixed(0)}가 구조를 대체로 유지합니다.`, `MSS ${mss.toFixed(0)} keeps structure broadly intact.`), color: '#22c55e' }
  if (mss < 92) {
    s3 = { step: 'Result', text: L(`MSS ${mss.toFixed(0)}. 구조적 약화가 진행 중입니다.`, `MSS ${mss.toFixed(0)}. Structural deterioration is in progress.`), color: '#ef4444' }
  } else if (mss < 100) {
    s3 = { step: 'Result', text: L(`MSS ${mss.toFixed(0)}. 100 아래에서 하방 압력이 지속됩니다.`, `MSS ${mss.toFixed(0)}. Downside pressure persists below 100.`), color: '#f97316' }
  } else if (totalScore >= 50 || breadth?.divergence) {
    s3 = { step: 'Result', text: L(`MSS ${mss.toFixed(0)}이지만 내부 신호는 약해지고 있습니다.`, `MSS ${mss.toFixed(0)}, but internal signals are softening.`), color: '#f59e0b' }
  }

  let s4 = { step: 'Action', text: L('포지션을 유지하고 단기 경계를 유지하세요.', 'Hold positioning and maintain short-term caution.'), color: '#22c55e' }
  if (trackA?.stage0) {
    s4 = { step: 'Action', text: L('추가 노출을 줄이고 방어적 전환을 준비하세요.', 'Reduce added exposure and prepare for a defensive rotation.'), color: '#ef4444' }
  } else if (mss < 92 && mps >= 50) {
    s4 = { step: 'Action', text: L('레버리지를 줄이고 점검 빈도를 높이세요.', 'Trim leverage and increase review frequency.'), color: '#f97316' }
  } else if (breadth?.divergence || mss < 100) {
    s4 = { step: 'Action', text: L('Track A 확인을 보면서 방어적으로 준비하세요.', 'Prepare defensively while watching for Track A confirmation.'), color: '#f59e0b' }
  }

  return [s1, s2, s3, s4]
}

function getConcentrationLabel(cn: RiskV1Data['concentration'] | null | undefined): string {
  if (!cn) return 'Balanced'
  if (cn.risk === 'high') return 'Concentration Risk'
  if (cn.risk === 'moderate') return 'Concentration Watch'
  if (cn.risk === 'mag7_weak') return 'Leadership Rollover'
  return 'Balanced Breadth'
}

function getBreadthDivergenceText(b: RiskV1Data['breadth'] | null | undefined): string {
  if (!b?.divergence) return 'Breadth is broadly aligned with the index.'
  if (b.divergence_signal === 'TOP_WARNING_STRONG') {
    return 'Index near highs while MA200 and MA50 participation are weakening - breadth top warning.'
  }
  if (b.divergence_signal === 'TOP_WARNING') {
    return 'Index resilience is outrunning internal breadth - monitor for a broader rollover.'
  }
  return 'Breadth divergence is active. Internal participation is weaker than the headline index.'
}

function getScenarioActionHint(rs: RiskScenario | null | undefined, uiLang: UiLang): string {
  const L = (ko: string, en: string) => pickLang(uiLang, ko, en)
  if (!rs) return L('시나리오는 참고용 맥락으로만 사용하세요. 실행 레이어가 아닙니다.', 'Use the scenario as context, not as the action layer.')
  const label = `${rs.scenario} ${getScenarioLabel(rs)}`.toLowerCase()
  if (label.includes('risk-on') || label.includes('expansion')) {
    return L('표준 익스포저를 유지하고 모멘텀 전략을 계속 사용하세요.', 'Maintain standard exposure and keep momentum tactics active.')
  }
  if (label.includes('late') || label.includes('cooling')) {
    return L('익스포저는 유지하되, 리스크 예산을 조이고 리더십을 면밀히 보세요.', 'Keep exposure, but tighten risk budgets and monitor leadership closely.')
  }
  if (label.includes('defensive') || label.includes('risk-off') || label.includes('contraction')) {
    return L('방어를 우선하고, 총 익스포저를 낮추며, 점검 빈도를 높이세요.', 'Favor defense, tighter gross exposure, and higher review frequency.')
  }
  return L('이 시나리오는 설명용 오버레이로만 사용하세요. 실행 레이어를 대체하지 않습니다.', 'Use this scenario as a descriptive overlay. It does not override the action layer.')
}

function getScenarioDescription(rs: RiskScenario | null | undefined, uiLang: UiLang): string {
  const L = (ko: string, en: string) => pickLang(uiLang, ko, en)
  if (!rs) return L('시나리오 컨텍스트를 사용할 수 없습니다.', 'Scenario context is unavailable.')
  const label = `${rs.scenario} ${getScenarioLabel(rs)}`.toLowerCase()
  if (label.includes('risk-on') || label.includes('expansion')) {
    return L('대부분의 입력이 안정적입니다. 구조는 표준 리스크를 감수할 수 있을 만큼 건강합니다.', 'Most inputs are stable. Structure is healthy enough for standard risk-taking.')
  }
  if (label.includes('late') || label.includes('cooling')) {
    return L('시장은 아직 지지받고 있지만, 내부 모멘텀은 점점 균일하지 않습니다.', 'The market still has support, but internal momentum is becoming less uniform.')
  }
  if (label.includes('defensive') || label.includes('risk-off')) {
    return L('방어적 로테이션이 우세합니다. 유연성을 보존하고 beta를 억지로 늘리지 마세요.', 'Defensive rotation is dominant. Preserve flexibility and avoid forcing beta.')
  }
  if (label.includes('contraction')) {
    return L('스트레스 경로는 수축을 가리킵니다. 리스크 예산은 타이트하게 유지하세요.', 'The path of stress points to contraction. Risk budgets should stay tight.')
  }
  return isAsciiText(rs.desc) ? rs.desc : L('시나리오 컨텍스트는 활성 상태지만, 설명 텍스트를 사용할 수 없습니다.', 'Scenario context is active, but its descriptive text is unavailable.')
}

function getMasterDetail(data: RiskV1Data, uiLang: UiLang): string {
  const L = (ko: string, en: string) => pickLang(uiLang, ko, en)
  const ms = data.master_signal
  const tae = data.track_a_early
  const ta = data.track_a
  const tc = data.track_c
  if (!ms) return L('핵심 트랙은 안정적입니다. 현재는 에스컬레이션이 필요하지 않습니다.', 'Core tracks are stable. No active escalation is required.')

  switch (ms.mode) {
    case 'EARLY_WARNING':
      return L(
        `[조기 전송 감시] Track A Early 상태는 ${tae?.state ?? 'active'}입니다. 공개시장 프록시가 약해지고 있습니다 (${(tae?.triggered ?? []).join(', ') || 'BDC/SPY, XLF/SPY, KRE/SPY'}). 스프레드는 아직 확인되지 않았으므로 포지션은 유지하되, 약화가 심해지면 Track A를 면밀히 점검하세요.`,
        `[Early transmission watch] Track A Early is ${tae?.state ?? 'active'}. Public-market proxies are weakening (${(tae?.triggered ?? []).join(', ') || 'BDC/SPY, XLF/SPY, KRE/SPY'}). Spreads are not confirmed yet, so keep positions but review Track A closely if weakness deepens.`
      )
    case 'CREDIT_CRISIS':
      return L('신용 스트레스가 확인되었습니다. 레버리지를 줄이고 총 익스포저를 낮추며 자본 보전을 우선하세요.', 'Credit stress is confirmed. Reduce leverage, tighten gross exposure, and prioritize capital preservation.')
    case 'HEDGE_AND_HOLD':
      return L('스트레스는 높지만 아직 혼란 단계는 아닙니다. 핵심 보유는 유지하고, 강제 청산보다 헤지를 추가하세요.', 'Stress is elevated but not yet disorderly. Maintain core holdings and add hedges rather than forcing exits.')
    case 'COMPOUND_CRISIS':
      return L('여러 스트레스 채널이 동시에 반응하고 있습니다. 자본 보전과 위기 대응 모드로 전환하세요.', 'Multiple stress channels are firing together. Shift to capital preservation and crisis response mode.')
    default:
      if (ta?.state && ta.state !== 'Normal') return L(`Track A는 ${ta.state}입니다. 공개 신용 스트레스는 더 이상 프록시 신호에만 머물지 않습니다.`, `Track A is ${ta.state}. Public credit stress is no longer only a proxy signal.`)
      if (tc?.state && tc.state !== 'Normal') return L(`Track C는 ${tc.state}입니다. 외부 shock 센서가 활성화되어 있습니다.`, `Track C is ${tc.state}. External shock sensors are active.`)
      return L('핵심 트랙은 안정적입니다. 현재는 에스컬레이션이 필요하지 않습니다.', 'Core tracks are stable. No active escalation is required.')
  }
}

function getTotalRiskActionLine(data: RiskV1Data, uiLang: UiLang): string {
  const L = (ko: string, en: string) => pickLang(uiLang, ko, en)
  const tr = data.total_risk
  const ms = data.master_signal
  if (!tr) return L('현재 엔진 상태는 구조, 신용, shock, 매크로 입력을 종합한 결과입니다.', 'Current engine state is based on combined structure, credit, shock, and macro inputs.')
  if (ms?.mode === 'EARLY_WARNING') {
    return L(
      `경고 -- 레버리지 노출을 줄이세요. 신용과 cross-asset 스트레스가 확산되고 있습니다. ${getMasterDetail(data, uiLang)}`,
      `WARNING -- Reduce leveraged exposure. Credit and cross-asset stress are spreading. ${getMasterDetail(data, uiLang)}`
    )
  }
  if (ms?.mode === 'COMPOUND_CRISIS') {
    return L('위기 -- 여러 레이어가 동시에 반응하고 있습니다. 방어와 자본 보전을 우선하세요.', 'CRISIS -- Multiple layers are firing together. Prioritize defense and capital preservation.')
  }
  if (ms?.mode === 'CREDIT_CRISIS') {
    return L('경고 -- 신용 스트레스가 확인되었습니다. 레버리지를 줄이고 즉시 리스크를 낮추세요.', 'WARNING -- Credit stress is confirmed. Reduce leverage and tighten risk immediately.')
  }
  return L(
    `${tr.state.toUpperCase()} -- 구조, 신용, shock, 매크로 입력을 종합해 익스포저를 조정하세요.`,
    `${tr.state.toUpperCase()} -- Manage exposure based on the combined structure, credit, shock, and macro inputs.`
  )
}

function getSafeScoreZoneRange(label: string, range?: string): string {
  const map: Record<string, string> = {
    Overheat: '>=120',
    'Strong Bull': '110-120',
    'Healthy Bull': '100-110',
    Neutral: '95-100',
    'Soft Risk': '90-95',
    'Risk Rising': '80-90',
    'Structural Risk': '<80',
  }
  return map[label] ?? range ?? '--'
}

function isAsciiText(value: string | null | undefined): boolean {
  return !!value && /^[\x20-\x7E]+$/.test(value)
}

function getCrisisStageLabels(): string[] {
  return ['Normal', 'Equity Selloff', 'Loan Stress', 'Credit Stress', 'Financial Stress', 'Policy Shock', 'Panic']
}

function getCrisisStageLabel(stage: number, fallback?: string): string {
  const labels = getCrisisStageLabels()
  return isAsciiText(fallback) ? fallback!.trim() : (labels[stage] ?? `Stage ${stage}`)
}

function getCrisisStageDescription(cs: CrisisStage | null | undefined): string {
  if (!cs) return 'Crisis-stage context is unavailable.'
  if (isAsciiText(cs.desc)) return cs.desc
  const descriptions: Record<number, string> = {
    0: 'No meaningful propagation is visible across the crisis chain.',
    1: 'Equity selling pressure is visible, but spillover remains limited.',
    2: 'Loan-market pressure is building and deserves closer monitoring.',
    3: 'Credit stress is widening beyond equity weakness alone.',
    4: 'Financial-sector weakness is visible and transmission risk is rising.',
    5: 'Policy or funding response pressure is becoming material.',
    6: 'Panic conditions are active across multiple transmission layers.',
  }
  return descriptions[cs.stage] ?? 'Crisis propagation is active.'
}

function getScenarioLabel(rs: RiskScenario | null | undefined): string {
  if (!rs) return '--'
  if (isAsciiText(rs.label)) return rs.label.trim()
  const map: Record<string, string> = {
    A: 'Defensive / Contraction',
    B: 'Defensive / Transition',
    C: 'Late Cycle / Cooling',
    D: 'Risk-On / Expansion',
  }
  return map[rs.scenario] ?? `Scenario ${rs.scenario}`
}

function getTransmissionNodeLabel(nodeKey: string, node: TransmissionNode | undefined): string {
  if (node && isAsciiText(node.label)) return node.label.trim()
  const map: Record<string, string> = {
    macro: 'Macro',
    equity: 'Equity',
    liquidity: 'Liquidity',
    credit: 'Credit',
    funding: 'Funding',
  }
  return map[nodeKey] ?? nodeKey.toUpperCase()
}

function splitTransmissionNodeLabel(label: string): [string, string?] {
  const compact = label.toUpperCase()
  if (compact === 'MACRO') return ['MACRO/GLOBAL']
  if (compact === 'EQUITY') return ['EQUITY', 'MARKET']
  if (compact === 'LIQUIDITY') return ['LIQUIDITY']
  if (compact === 'CREDIT') return ['CREDIT']
  if (compact === 'FUNDING') return ['FUNDING/BANKS']
  return [label]
}

function getTransmissionNodeStatus(nodeKey: string, node: TransmissionNode | undefined): string {
  const raw = (node?.status ?? '').trim()
  if (isAsciiText(raw)) return raw
  const map: Record<string, string> = {
    macro: 'Macro',
    equity: 'Equity',
    liquidity: 'Liquidity',
    credit: 'Credit',
    funding: 'Funding',
  }
  return map[nodeKey] ?? 'Active'
}

function getTransmissionPathLabel(path: string): string {
  if (isAsciiText(path)) return path
  if (path.includes('Macro') && path.includes('Equity')) return 'Macro -> Equity'
  if (path.includes('Macro') && path.includes('Credit')) return 'Macro -> Credit'
  if (path.includes('Macro') && path.includes('Liquidity')) return 'Macro -> Liquidity'
  if (path.includes('Credit') && path.includes('Funding')) return 'Credit -> Funding'
  if (path.includes('Equity') && path.includes('Credit')) return 'Equity -> Credit'
  return 'Transmission Path'
}

function getShortDominantLabel(label: string | null | undefined): string {
  const raw = (label ?? '').trim()
  if (!raw) return '--'
  if (raw === 'Macro / Defensive Rotation') return 'Macro/Def.Rot'
  if (raw === 'Financial Stress') return 'Fin. Stress'
  if (raw === 'Funding Stress') return 'Funding Stress'
  if (raw === 'Liquidity Stress') return 'Liquidity Stress'
  return raw
}

function generateNarrative(data: RiskV1Data, uiLang: UiLang): { paragraphs: string[]; color: string } {
  const L = (ko: string, en: string) => pickLang(uiLang, ko, en)
  const mss = data.current.score ?? 100
  const level = data.current.level ?? 1
  const regime = data.market_regime?.regime ?? 'Expansion'
  const scenario = data.risk_scenario
  const trackA = data.track_a
  const trackC = data.track_c
  const trackB = data.track_b
  const topDriver = data.risk_contribution?.[0]
  const trackAState = trackA?.state ?? 'Normal'
  const trackCState = trackC?.state ?? 'Normal'

  let p1 = ''
  if (mss >= 110) {
    p1 = L(`시장 구조(MSS ${mss.toFixed(0)})는 여전히 강합니다. ${regime} 레짐은 유지되고 있습니다.`, `Market structure (MSS ${mss.toFixed(0)}) remains strong. The ${regime} regime is intact.`)
  } else if (mss >= 100) {
    p1 = L(`시장 구조(MSS ${mss.toFixed(0)})는 아직 100 위지만, 내부 압력은 점검이 필요합니다.`, `Market structure (MSS ${mss.toFixed(0)}) is still above 100, but internal pressure needs monitoring.`)
  } else if (mss >= 92) {
    p1 = L(`시장 구조(MSS ${mss.toFixed(0)})가 경고 구간에 들어섰습니다. ${regime} 레짐 안에서 추가 약화를 주의하세요.`, `Market structure (MSS ${mss.toFixed(0)}) has entered a warning zone. Watch for further weakness within the ${regime} regime.`)
  } else {
    p1 = L(`시장 구조(MSS ${mss.toFixed(0)})는 취약합니다. ${regime} 레짐에서는 방어적 대응이 필요합니다.`, `Market structure (MSS ${mss.toFixed(0)}) is fragile. Defensive handling is warranted in the ${regime} regime.`)
  }

  let p2 = ''
  if (trackAState !== 'Normal') {
    const hy = trackA?.hy_oas_current != null ? ` HY OAS ${trackA.hy_oas_current.toFixed(1)}%.` : ''
    p2 = L(`Track A는 ${trackAState}입니다.${hy} 공개 신용시장 전이 여부를 계속 주시하세요.`, `Track A is ${trackAState}.${hy} Continue to watch for public credit-market transmission.`)
  } else if (trackCState !== 'Normal') {
    const shock = trackC?.shock_type && trackC.shock_type !== 'None' ? trackC.shock_type : 'external shock'
    p2 = L(`Track C는 ${trackCState}이며, ${shock} 신호가 감지되었습니다. 공격적 확장보다 방어적 검토를 우선하세요.`, `Track C is ${trackCState}, with ${shock} signals detected. Defensive review should take priority over aggressive expansion.`)
  } else {
    const scenarioText = scenario ? `${scenario.scenario} (${getScenarioLabel(scenario)}) - ${getScenarioActionHint(scenario, uiLang)}` : L('핵심 트랙은 대체로 안정적입니다.', 'Core tracks are broadly stable.')
    p2 = L(`Track A와 Track C는 현재 안정적입니다. ${scenarioText}`, `Track A and Track C are currently stable. ${scenarioText}`)
  }

  let p3 = ''
  if (topDriver) {
    p3 = L(`주요 스트레스 드라이버는 ${topDriver.label}이며, 기여도는 약 ${Math.round(topDriver.ratio * 100)}%입니다. `, `The main stress driver is ${topDriver.label}, contributing about ${Math.round(topDriver.ratio * 100)}%. `)
  }
  if (trackB?.velocity_alert) {
    const delta = trackB.mss_5d_delta != null ? trackB.mss_5d_delta.toFixed(1) : '?'
    p3 += L(`5일 MSS 변화가 ${delta}pt 상승하고 있어 구조적 velocity도 주의가 필요합니다.`, `The 5-day MSS change is rising by ${delta}pt, so structural velocity also warrants attention.`)
  } else {
    p3 += L('MSS velocity는 현재 관리 가능한 수준입니다.', 'MSS velocity remains manageable for now.')
  }

  const color = level <= 0 ? '#22c55e' : level === 1 ? '#f59e0b' : level === 2 ? '#f97316' : '#ef4444'
  return { paragraphs: [p1, p2, p3], color }
}

// Risk DNA Radar Chart sub-component (12-layer dodecagon with hover tooltip)
function RadarChart({
  layers,
  layerColors,
  dominantLayer,
  totalRisk,
}: {
  layers: LayerScore[]
  layerColors: string[]
  dominantLayer: string
  totalRisk: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const size = 500
  const cx = 250
  const cy = 270
  const r = 180
  const normalR = 0.3
  const n = layers.length

  const ang = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2
  const ptX = (i: number, ratio: number) => cx + r * ratio * Math.cos(ang(i))
  const ptY = (i: number, ratio: number) => cy + r * ratio * Math.sin(ang(i))
  const polyPts = (ratio: number) => layers.map((_, i) => `${ptX(i, ratio).toFixed(1)},${ptY(i, ratio).toFixed(1)}`).join(' ')

  const stressRatios = layers.map((layer) => (layer.max > 0 ? layer.score / layer.max : 0))
  const stressPoly = stressRatios.map((ratio, i) => `${ptX(i, ratio).toFixed(1)},${ptY(i, ratio).toFixed(1)}`).join(' ')
  const maxRatio = Math.max(...stressRatios)
  const compositeRatio = Math.max(0, Math.min(1, totalRisk / 120))
  const polyColor = maxRatio >= 0.65 ? '#ef4444' : maxRatio >= 0.48 ? '#f97316' : maxRatio >= 0.32 ? '#f59e0b' : '#22c55e'
  const stressLabel = maxRatio >= 0.65 ? 'CRITICAL' : maxRatio >= 0.48 ? 'HIGH' : maxRatio >= 0.32 ? 'ELEVATED' : 'NORMAL'
  const activeIndex = hovered ?? selected
  const layerShortMap: Record<string, string> = {
    equity: 'L1',
    breadth: 'L2',
    credit: 'L3',
    lev_loan: 'L4',
    liquidity: 'L5',
    funding: 'L6',
    macro: 'L7',
    shock: 'L8',
    cross_asset: 'L9',
    credit_spread: 'L10',
    liquidity_shock: 'L11',
    financial_stress: 'L12',
  }

  const getTooltipBox = (i: number) => {
    const a = ang(i)
    const vx = ptX(i, stressRatios[i])
    const vy = ptY(i, stressRatios[i])
    const w = 184
    const h = 86
    const offsetX = Math.cos(a) >= 0 ? 10 : -(w + 10)
    const offsetY = Math.sin(a) >= 0 ? 10 : -(h + 10)
    const tx = Math.min(Math.max(vx + offsetX, 4), size - w - 4)
    const ty = Math.min(Math.max(vy + offsetY, 4), size - h - 4)
    return { tx, ty, w, h }
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.8rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f3f4f6', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Risk DNA Radar
        </span>
        <span style={{ color: polyColor, background: `${polyColor}18`, border: `1px solid ${polyColor}44`, borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
          {stressLabel}
        </span>
        <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>12 structural layers - utilization %</span>
      </div>

      <svg viewBox="0 0 500 670" style={{ width: '100%', maxWidth: 620, display: 'block', margin: '0 auto' }}>
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <polygon key={ratio} points={polyPts(ratio)} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        ))}
        {layers.map((_, i) => (
          <line key={`axis-${i}`} x1={cx} y1={cy} x2={ptX(i, 1).toFixed(1)} y2={ptY(i, 1).toFixed(1)} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        ))}
        <polygon points={polyPts(normalR)} fill="rgba(34,197,94,0.14)" stroke="#22c55e" strokeWidth="1.2" strokeDasharray="4 3" />
        <polygon points={stressPoly} fill={`${polyColor}18`} stroke={polyColor} strokeWidth="2" />

        {layers.map((layer, i) => {
          const ratio = stressRatios[i]
          const short = layerShortMap[layer.key ?? ''] ?? `L${i + 1}`
          const isActive = activeIndex === i
          const isPeak = ratio === maxRatio && maxRatio > 0
          return (
            <g
              key={layer.key ?? i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected((prev) => (prev === i ? null : i))}
              style={{ cursor: 'pointer' }}
            >
              {isActive && (
                <circle cx={ptX(i, ratio)} cy={ptY(i, ratio)} r={11} fill={`${layerColors[i] ?? '#60a5fa'}22`} stroke={layerColors[i] ?? '#60a5fa'} strokeWidth={1.2} />
              )}
              <circle cx={ptX(i, ratio).toFixed(1)} cy={ptY(i, ratio).toFixed(1)} r={isActive ? 6.5 : 5} fill={layerColors[i] ?? '#60a5fa'} stroke="#0b0f14" strokeWidth={1.5} />
              <text x={ptX(i, 1.12).toFixed(1)} y={(ptY(i, 1.12) - 4).toFixed(1)} textAnchor="middle" fill={isActive ? '#f8fafc' : isPeak ? (layerColors[i] ?? polyColor) : '#e5e7eb'} fontSize="12" fontWeight={isPeak ? '900' : '800'}>{short}</text>
              <text x={ptX(i, 1.12).toFixed(1)} y={(ptY(i, 1.12) + 11).toFixed(1)} textAnchor="middle" fill={isPeak ? (layerColors[i] ?? polyColor) : '#cbd5e1'} fontSize="11.5" fontWeight={isPeak ? '800' : '600'}>{layer.score}/{layer.max}</text>
            </g>
          )
        })}

        <text x={250} y={28} textAnchor="middle" fill="#e5e7eb" fontSize="18" fontWeight="800">RISK DNA</text>
        <text x={250} y={50} textAnchor="middle" fill={polyColor} fontSize="16" fontWeight="900">Composite {Math.round(compositeRatio * 100)}%</text>
        <text x={250} y={498} textAnchor="middle" fill="#9ca3af" fontSize="11">Dominant</text>
        <text x={250} y={514} textAnchor="middle" fill="#9ca3af" fontSize="11">{getShortDominantLabel(dominantLayer)}</text>

        {activeIndex !== null && (() => {
          const box = getTooltipBox(activeIndex)
          const layer = layers[activeIndex]
          const ratio = Math.round(stressRatios[activeIndex] * 100)
          const short = layerShortMap[layer.key ?? ''] ?? `L${activeIndex + 1}`
          return (
            <g>
              <rect x={box.tx} y={box.ty} width={box.w} height={box.h} rx={10} fill="#0f172a" stroke="rgba(255,255,255,0.14)" />
              <text x={box.tx + 12} y={box.ty + 24} fill="#f8fafc" fontSize="14" fontWeight="700">{short} {layer.label}</text>
              <text x={box.tx + 12} y={box.ty + 46} fill="#cbd5e1" fontSize="13">{layer.score}/{layer.max} - {ratio}% utilized</text>
              <text x={box.tx + 12} y={box.ty + 66} fill="#94a3b8" fontSize="12">{layer.desc}</text>
            </g>
          )
        })()}

        {layers.map((layer, i) => {
          const short = layerShortMap[layer.key ?? ''] ?? `L${i + 1}`
          const x = 16 + (i % 4) * 122
          const y = 560 + Math.floor(i / 4) * 26
          const isActive = activeIndex === i
          const isPeak = stressRatios[i] === maxRatio && maxRatio > 0
          return (
            <g
              key={`legend-${layer.key ?? i}`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected((prev) => (prev === i ? null : i))}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={x} cy={y} r={4} fill={layerColors[i] ?? '#60a5fa'} />
              <text x={x + 9} y={y + 4} fill={isActive ? '#ffffff' : isPeak ? (layerColors[i] ?? polyColor) : '#cbd5e1'} fontSize="10.5" fontWeight={isPeak ? '900' : isActive ? '800' : '600'}>
                {short} {getShortDominantLabel(layer.label)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
function OverviewTab({
  data,
  uiLang,
}: {
  data: RiskV1Data
  uiLang: UiLang
}) {
  const { current: c, history, methodology } = data
  const interpretationModel = useMemo(() => buildStandardInterpretationDisplayModel(data, uiLang), [data, uiLang])
  const tier = methodology.level_tiers.find((t) => t.level === c.level) ?? methodology.level_tiers[0]
  const colNow = LEVEL_COLORS[c.level] ?? '#e5e7eb'
  const freshnessOrder = ['qqq', 'spy', 'hyg', 'lqd', 'dxy', 'vix', 'put_call', 'hy_oas', 'ig_oas', 'fsi', 'move']
  const [showFreshness, setShowFreshness] = useState(true)
  const orderedFreshness = Object.entries(data.input_freshness || {}).sort(
    (a, b) => freshnessOrder.indexOf(a[0]) - freshnessOrder.indexOf(b[0]),
  )
  const staleFreshness = orderedFreshness.filter(([, meta]) => meta?.is_stale)
  const cadenceFreshness = orderedFreshness.filter(([, meta]) => meta?.cadence && !meta?.is_stale)

  // Current live window (auto-fetch)
  const [cur90Pts,     setCur90Pts]     = useState<any[]>([])
  const [cur90Loading, setCur90Loading] = useState(false)
  const [chartMode,    setChartMode]    = useState<'score' | 'risk' | 'compare' | 'long-term'>('score')
  const [ltPts,        setLtPts]        = useState<Array<{d:string;s:number}>>([])
  const [ltLoading,    setLtLoading]    = useState(false)
  const [showRiskContribution, setShowRiskContribution] = useState(false)
  const [contextSignalTab, setContextSignalTab] = useState<'spy' | 'dia' | 'rotation'>('spy')
  const [mssCtxTab, setMssCtxTab] = useState<'mss' | 'risk' | 'both'>('mss')
  const [ovChartMode, setOvChartMode] = useState<'score' | 'risk' | 'compare' | 'long-term'>('score')
  const [ovTab, setOvTab] = useState<0|1|2|3|4>(0)

  const cur90ChartPts = useMemo(() => {
    if (!cur90Pts.length) return []
    // Find first TQQQ dd value in window for normalization
    const base0TqqqDd = cur90Pts.find((p: any) => p.tqqq_dd != null)?.tqqq_dd ?? 0
    return cur90Pts.map((p: any) => ({
      ...p,
      label: p.d.slice(2),
      // dd_rel: % change of QQQ from window start (qqq_n starts at 100)
      dd_rel: p.qqq_n != null ? p.qqq_n - 100 : 0,
      // tqqq_dd_rel: TQQQ ATH drawdown relative to window-start ATH drawdown
      tqqq_dd_rel: p.tqqq_dd != null ? p.tqqq_dd - base0TqqqDd : null,
      // risk_intensity: inverted view (higher = more dangerous)
      risk_intensity: riskIntensityFromMss(p.score),
    }))
  }, [cur90Pts])
  const cur90Latest = cur90ChartPts.length ? cur90ChartPts[cur90ChartPts.length - 1] : null
  const cur90AxisTicks = useMemo(() => buildAxisTicks(cur90ChartPts, 'label', 10), [cur90ChartPts])
  const cur90Zone = interpretMssZone(cur90Latest?.score)
  const cur90Exposure = exposureBandFromScore(cur90Latest?.score)

  // Auto-fetch on mount
  useEffect(() => {
    setCur90Loading(true)
    fetch('http://localhost:5001/api/current-90d')
      .then(r => r.json())
      .then(d => { setCur90Pts(d.risk_v1?.playback ?? []) })
      .catch(() => {})
      .finally(() => setCur90Loading(false))
  }, [])

  // Fetch full MSS history on demand (only once)
  useEffect(() => {
    if (chartMode !== 'long-term' || ltPts.length > 0) return
    setLtLoading(true)
    fetch('http://localhost:5001/api/mss-history')
      .then(r => r.json())
      .then(d => { setLtPts(d.data ?? []) })
      .catch(() => {})
      .finally(() => setLtLoading(false))
  }, [chartMode, ltPts.length])
  const ltAxisTicks = useMemo(() => buildAxisTicks(ltPts, 'd', 10), [ltPts])
  const ltLastDate = ltPts[ltPts.length - 1]?.d ?? ''
  const ltLatestScore = ltPts.length ? ltPts[ltPts.length - 1]?.s ?? null : null
  const ltYTicks = useMemo(() => {
    const baseTicks = [40, 65, 90, 130]
    if (ltLatestScore == null || !Number.isFinite(ltLatestScore)) return baseTicks
    const latestTick = Number(ltLatestScore.toFixed(1))
    return Array.from(new Set([...baseTicks, latestTick])).sort((a, b) => a - b)
  }, [ltLatestScore])


  const diagLayers = data.total_risk ? [
    data.total_risk.layers.equity,
    data.total_risk.layers.breadth,
    data.total_risk.layers.credit,
    data.total_risk.layers.lev_loan,
    data.total_risk.layers.liquidity,
    data.total_risk.layers.funding,
    data.total_risk.layers.macro,
    data.total_risk.layers.shock,
    data.total_risk.layers.cross_asset,
    data.total_risk.layers.credit_spread,
    data.total_risk.layers.liquidity_shock,
    data.total_risk.layers.financial_stress,
  ] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.17rem', WebkitFontSmoothing: 'antialiased' }}>

      {/* Final Risk Hero */}
      {(() => {
        const finalColorMap: Record<string, string> = {
          NORMAL: '#22c55e', WATCH: '#f59e0b', WARNING: '#f97316', DEFENSIVE: '#ef4444', SHOCK: '#b91c1c',
        }
        const stateColorMap: Record<string, string> = {
          Strong: '#22c55e', Stable: '#60a5fa', Supportive: '#22c55e',
          Weakening: '#f97316', Defensive: '#ef4444', Neutral: '#e5e7eb', Negative: '#f97316', Stress: '#ef4444',
        }
        const ctx = c.context
        const tr = data.total_risk
        const ta = data.track_a
        const tae = data.track_a_early
        const tb = data.track_b
        const tc = data.track_c
        const heroState = (ctx?.final_risk ?? tr?.state ?? c.level_label).toUpperCase()
        const heroColor = tr?.state_color ?? (ctx ? (finalColorMap[ctx.final_risk] ?? colNow) : colNow)
        const exposure = ctx?.final_exposure ?? tier.exposure
        const summaryLine = getTotalRiskActionLine(data, uiLang)
        const engineCards = [
          {
            label: pickLang(uiLang, '시스템 리스크', 'Systemic Risk'),
            value: tr ? `${tr.total}/120` : '--',
            sub: tr?.state ?? '--',
            color: tr?.state_color ?? heroColor,
          },
          {
            label: pickLang(uiLang, '시장 구조', 'Market Structure'),
            value: `MSS ${c.score.toFixed(0)}`,
            sub: pickLang(uiLang, `레벨 ${c.level} - ${tier.label}`, `Level ${c.level} - ${tier.label}`),
            color: colNow,
          },
          {
            label: pickLang(uiLang, 'Track A 조기', 'Track A Early'),
            value: tae?.state ?? '--',
            sub: tae?.as_of_date ? pickLang(uiLang, `점수 ${tae.score ?? '--'} - ${tae.as_of_date}`, `score ${tae.score ?? '--'} - ${tae.as_of_date}`) : pickLang(uiLang, '조기 전송 감시', 'Early transmission watch'),
            color: tae?.state === 'Early Watch' ? '#f97316' : tae?.state === 'Soft Watch' ? '#f59e0b' : tae?.state === 'Monitor' ? '#eab308' : '#22c55e',
          },
          {
            label: 'Track A',
            value: ta?.state ?? '--',
            sub: ta?.as_of_date ? pickLang(uiLang, `기준일 ${ta.as_of_date}`, `as-of ${ta.as_of_date}`) : pickLang(uiLang, '신용 조기 경고', 'Credit early warning'),
            color: ta?.state === 'Normal' ? '#22c55e' : '#f97316',
          },
          {
            label: 'Track B',
            value: tb?.mss_5d_delta != null ? `${tb.mss_5d_delta > 0 ? '+' : ''}${tb.mss_5d_delta.toFixed(1)}pt` : '--',
            sub: tb?.mss_5d_ago_date ? pickLang(uiLang, `비교 ${tb.mss_5d_ago_date}`, `vs ${tb.mss_5d_ago_date}`) : pickLang(uiLang, 'MSS 속도', 'MSS velocity'),
            color: tb?.velocity_alert ? '#ef4444' : '#22c55e',
          },
          {
            label: 'Track C',
            value: tc ? (tc.state === 'Normal' ? pickLang(uiLang, '정상', 'All Clear') : tc.state) : '--',
            sub: tc?.as_of_date ? pickLang(uiLang, `기준일 ${tc.as_of_date}`, `as-of ${tc.as_of_date}`) : pickLang(uiLang, '이벤트 / shock', 'Event / shock'),
            color: tc?.state === 'Normal' ? '#22c55e' : '#06b6d4',
          },
          {
            label: pickLang(uiLang, '매크로 압력', 'Macro Pressure'),
            value: tr ? `MPS ${tr.mps}` : '--',
            sub: pickLang(uiLang, '환경 압력', 'Environment pressure'),
            color: tr ? (tr.mps < 30 ? '#22c55e' : tr.mps < 50 ? '#84cc16' : tr.mps < 70 ? '#f59e0b' : tr.mps < 85 ? '#f97316' : '#ef4444') : '#e5e7eb',
          },
        ]
        return (
          <div style={{
            border: `1px solid ${heroColor}44`, borderLeft: `4px solid ${heroColor}`,
            borderRadius: 12, background: `${heroColor}08`, padding: '1rem 1.2rem',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.8rem', fontWeight: 800, color: heroColor, lineHeight: 1, WebkitTextStroke: '0.4px currentColor', letterSpacing: '0.02em' }}>
                    {heroState}
                  </span>
                  {tr && (
                    <span style={{
                      fontSize: '0.98rem', fontWeight: 700, color: heroColor,
                      background: `${heroColor}18`, border: `1px solid ${heroColor}44`,
                      borderRadius: 5, padding: '2px 9px',
                    }}>
                      {pickLang(uiLang, '12-레이어', '12-Layer')} {tr.total}/120
                    </span>
                  )}
                  {tr?.crisis_stage && (
                    <span style={{
                      fontSize: '0.96rem', fontWeight: 700, color: tr.crisis_stage.color,
                      background: `${tr.crisis_stage.color}12`, border: `1px solid ${tr.crisis_stage.color}33`,
                      borderRadius: 5, padding: '2px 9px',
                    }}>
                      {getCrisisStageLabel(tr.crisis_stage.stage, tr.crisis_stage.label)} - S{tr.crisis_stage.stage}
                    </span>
                  )}
                  {tr?.dominant_layer && (
                    <span style={{
                      fontSize: '0.92rem', fontWeight: 700, color: '#e5e7eb',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 5, padding: '2px 9px',
                    }}>
                      {tr.dominant_layer}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '1rem', color: '#e5e7eb', lineHeight: 1.55, maxWidth: 860 }}>
                  {summaryLine}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right', minWidth: 110 }}>
                <div style={{ fontSize: '0.85rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.08em' }}>
                  {pickLang(uiLang, '권장 익스포저', 'Recommended Exposure')}
                </div>
                <div style={{ fontSize: '1.7rem', fontWeight: 800, color: heroColor, lineHeight: 1, WebkitTextStroke: '0.4px currentColor', letterSpacing: '0.02em' }}>
                  {exposure}%
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {methodology.level_tiers.map((t) => {
                const active = t.exposure === exposure
                return (
                  <div key={t.level} style={{
                    flex: 1, textAlign: 'center', padding: '6px 6px', borderRadius: 5,
                    background: active ? `${t.color}22` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${active ? t.color + '55' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                    <div style={{ fontSize: '0.85rem', color: active ? t.color : '#e5e7eb', fontWeight: 700 }}>L{t.level}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: active ? t.color : '#e5e7eb' }}>{t.exposure}%</div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 6 }}>
              {engineCards.map(({ label, value, sub, color }) => (
                <div key={label} style={{
                  background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: '1.08rem', fontWeight: 800, color }}>{value}</div>
                  <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: 3, lineHeight: 1.35 }}>{sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {ctx && [
                { label: 'SPY', value: ctx.spy.state, sub: ctx.spy.vs_ma200 != null ? `MA200 ${ctx.spy.vs_ma200.toFixed(1)}%` : '', color: stateColorMap[ctx.spy.state] ?? '#e5e7eb' },
                { label: 'DIA', value: ctx.dia.state, sub: ctx.dia.vs_ma200 != null ? `MA200 ${ctx.dia.vs_ma200.toFixed(1)}%` : '', color: stateColorMap[ctx.dia.state] ?? '#e5e7eb' },
                { label: 'QQQ/SPY', value: ctx.rotation.state, sub: ctx.rotation.rs_20d != null ? `20d ${ctx.rotation.rs_20d.toFixed(1)}%` : '', color: stateColorMap[ctx.rotation.state] ?? '#e5e7eb' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} style={{
                  background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '6px 10px',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ fontSize: '0.8rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.06em' }}>{label}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color }}>{value}</div>
                  {sub && <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>{sub}</div>}
                </div>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                {[
                  { label: 'QQQ', value: `$${c.price.toFixed(0)}`, color: '#e5e7eb' as string },
                  { label: 'MA200', value: c.ma200 ? `$${c.ma200.toFixed(0)}` : '--', color: c.price > (c.ma200 ?? 0) ? '#22c55e' : '#ef4444' },
                  { label: 'DD', value: `${c.dd_pct.toFixed(1)}%`, color: c.dd_pct < -10 ? '#ef4444' : c.dd_pct < -5 ? '#f59e0b' : '#e5e7eb' },
                  { label: 'Vol', value: `${c.vol_pct.toFixed(0)}th`, color: c.vol_pct > 70 ? '#f59e0b' : '#e5e7eb' },
                  { label: 'Env', value: c.event_type, color: (TYPE_COLORS[c.event_type] ?? '#e5e7eb') as string },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.85rem', color: '#e5e7eb', fontWeight: 700 }}>{label}</div>
                    <div style={{ fontSize: '1.02rem', fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
      {/* ─── OVERVIEW SUB-TABS ─── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 8, marginTop: 4 }}>
        {(['Summary','Structure','Signals','Context','Live'] as const).map((label, idx) => (
          <button key={label} onClick={() => setOvTab(idx as 0|1|2|3|4)} style={{
            padding: '7px 18px', fontSize: '0.76rem', fontWeight: 700,
            color: ovTab === idx ? '#f8fafc' : '#475569',
            background: ovTab === idx ? (idx === 4 ? 'linear-gradient(180deg, rgba(251,146,60,0.24), rgba(239,68,68,0.12))' : 'rgba(99,102,241,0.15)') : 'transparent',
            border: 'none', borderBottom: ovTab === idx ? (idx === 4 ? '2px solid #fb923c' : '2px solid #6366f1') : '2px solid transparent',
            boxShadow: ovTab === idx && idx === 4 ? '0 0 18px rgba(251,146,60,0.15)' : 'none',
            cursor: 'pointer', letterSpacing: '0.07em', textTransform: 'uppercase',
            borderRadius: '6px 6px 0 0', transition: 'color 0.15s',
          }}>
            {idx === 4 ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: '#fb923c', boxShadow: '0 0 0 4px rgba(251,146,60,0.18)' }} />
                {label}
              </span>
            ) : label}
          </button>
        ))}
      </div>

      {ovTab === 2 && orderedFreshness.length > 0 && (
        <div
          style={{
            border: '1px solid rgba(99,102,241,0.18)',
            background: 'linear-gradient(180deg, rgba(8,13,25,0.95), rgba(8,12,20,0.9))',
            borderRadius: 18,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>Input Freshness</div>
              <div style={{ fontSize: 13, color: '#8fa3c8', marginTop: 4 }}>
                Current data timing for Track A / B / C inputs
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#9fb0d1', alignItems: 'center' }}>
              <span>Track A as-of: {data.track_a?.as_of_date || '—'}</span>
              <span>Track C as-of: {data.track_c?.as_of_date || '—'}</span>
              <span>Track B 5d ref: {data.track_b?.mss_5d_ago_date || '—'}</span>
              <button
                onClick={() => setShowFreshness((v) => !v)}
                style={{
                  marginLeft: 4,
                  padding: '3px 10px',
                  fontSize: 11,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 999,
                  color: '#9ca3af',
                  cursor: 'pointer',
                }}
              >
                {showFreshness ? '숨기기' : '카드 보기'}
              </button>
            </div>
          </div>

          {staleFreshness.length > 0 ? (
            <div
              style={{
                border: '1px solid rgba(239,68,68,0.35)',
                background: 'rgba(69,10,10,0.35)',
                borderRadius: 14,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fca5a5', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Stale Inputs
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {staleFreshness.map(([key, meta]) => (
                  <span
                    key={key}
                    style={{
                      fontSize: 12,
                      color: '#fecaca',
                      border: '1px solid rgba(248,113,113,0.28)',
                      background: 'rgba(127,29,29,0.3)',
                      borderRadius: 999,
                      padding: '5px 10px',
                    }}
                  >
                    {labelInput(key)} {meta?.last_date || '—'} · {meta?.days_stale ?? '—'}d stale
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div
              style={{
                border: '1px solid rgba(34,197,94,0.18)',
                background: 'rgba(20,83,45,0.22)',
                borderRadius: 14,
                padding: 14,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: '#86efac', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                No stale inputs
              </div>
              <div style={{ fontSize: 12, color: '#bbf7d0' }}>
                Core Track A / B / C dependencies are within freshness threshold.
              </div>
            </div>
          )}

          {cadenceFreshness.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {cadenceFreshness.map(([key, meta]) => (
                <span
                  key={key}
                  style={{
                    fontSize: 12,
                    color: '#fde68a',
                    border: '1px solid rgba(252,211,77,0.24)',
                    background: 'rgba(113,63,18,0.22)',
                    borderRadius: 999,
                    padding: '5px 10px',
                  }}
                >
                  {labelInput(key)} {meta?.cadence === 'W' ? 'weekly' : meta?.cadence} cadence
                </span>
              ))}
            </div>
          )}

{showFreshness && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {orderedFreshness.map(([key, meta]) => {
              const isWeekly = meta?.cadence === 'W'
              return (
                <div
                  key={key}
                  style={{
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 14,
                    padding: 14,
                    background: 'rgba(15,23,42,0.52)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc' }}>{labelInput(key)}</div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: meta?.is_stale ? '#fca5a5' : '#86efac',
                      }}
                    >
                      {meta?.is_stale ? 'Stale' : 'Fresh'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {isWeekly && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: '#fcd34d',
                          border: '1px solid rgba(252,211,77,0.35)',
                          borderRadius: 999,
                          padding: '2px 7px',
                        }}
                      >
                        Weekly
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{meta?.source || '—'}</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#e5e7eb' }}>{meta?.last_date || '—'}</div>
                  <div style={{ fontSize: 12, color: '#93c5fd', lineHeight: 1.45 }}>
                    {meta?.days_stale ?? '—'}d behind vs data as-of
                    <br />
                    {data.data_as_of || data.current.date || '—'}
                  </div>
                  {meta?.note && (
                    <div style={{ fontSize: 12, color: isWeekly ? '#7dd3fc' : '#94a3b8', lineHeight: 1.45 }}>
                      {meta.note}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
           MARKET STRUCTURE DIAGNOSTICS
           Score components · breadth · concentration · stress overlays
      ════════════════════════════════════════════════════ */}
      {ovTab === 1 && <div style={{
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.018)',
        padding: '1rem 1.1rem',
        display: 'flex', flexDirection: 'column', gap: '0.85rem',
      }}>
        {/* Group header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {pickLang(uiLang, '시장 구조 진단', 'Market Structure Diagnostics')}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#374151' }}>
            {pickLang(uiLang, '점수 · breadth · stress', 'score · breadth · stress')}
          </span>
        </div>

      {/* MSS components compact pill grid */}
      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: '0.99rem', color: '#e5e7eb', fontWeight: 700 }}>{pickLang(uiLang, 'MSS 구성요소', 'MSS Components')}</span>
          <span style={{ fontSize: '1.12rem', fontWeight: 700, color: colNow }}>{c.score.toFixed(1)}</span>
          {(c as any).score_zone && (
            <span style={{ fontSize: '0.9rem', color: '#e5e7eb', fontStyle: 'italic' }}>{(c as any).score_zone}</span>
          )}
          <span style={{ fontSize: '0.81rem', color: '#e5e7eb', marginLeft: 'auto' }}>
            100
            {[c.components.trend, c.components.depth, c.components.vol, c.components.dd].map((v, i) => (
              <span key={i} style={{ color: v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#e5e7eb' }}>
                {v >= 0 ? ` +${v.toFixed(0)}` : ` ${v.toFixed(0)}`}
              </span>
            ))}
            {' = '}<span style={{ color: colNow, fontWeight: 700 }}>{c.score.toFixed(0)}</span>
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {([
            { label: 'TrendAdj', val: c.components.trend, absMax: 12, desc: 'QQQ vs MA50/200' },
            { label: 'DepthAdj', val: c.components.depth, absMax: 12, desc: 'Breadth vs MA200' },
            { label: 'VolAdj',   val: c.components.vol,   absMax: 12, desc: 'VIX percentile' },
            { label: 'DDAdj',    val: c.components.dd,    absMax: 16, desc: 'Max drawdown' },
          ] as const).map(({ label, val, absMax, desc }) => {
            const barColor = val > 0 ? '#22c55e' : val < 0 ? '#ef4444' : '#e5e7eb'
            const pct = Math.min(100, Math.abs(val) / absMax * 100)
            return (
              <div key={label} style={{
                background: val !== 0 ? `${barColor}0e` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${val !== 0 ? barColor + '33' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: 8, padding: '7px 9px',
              }}>
                <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: barColor, lineHeight: 1, WebkitTextStroke: '0.3px currentColor', letterSpacing: '0.01em' }}>
                  {val > 0 ? `+${val.toFixed(0)}` : val.toFixed(0)}
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', margin: '5px 0 4px' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.35 }}>{desc}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Real Market Breadth */}
      {data.breadth && (() => {
        const b = data.breadth!
        const ma200ok   = (b.pct_above_ma200 ?? 0) >= 60
        const ma200Color = (b.pct_above_ma200 ?? 0) >= 65 ? '#22c55e' : (b.pct_above_ma200 ?? 0) >= 50 ? '#f59e0b' : '#ef4444'
        const ma50Color  = (b.pct_above_ma50  ?? 0) >= 60 ? '#22c55e' : (b.pct_above_ma50  ?? 0) >= 45 ? '#f59e0b' : '#ef4444'
        const hiColor    = (b.pct_52w_high    ?? 0) >= 5  ? '#22c55e' : '#e5e7eb'
        const loColor    = (b.pct_52w_low     ?? 0) >= 3  ? '#ef4444' : '#e5e7eb'
        return (
          <div style={card()}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.99rem', color: '#e5e7eb', fontWeight: 700 }}>Market Breadth</span>
              <span style={{
                fontSize: '0.81rem', fontWeight: 700, color: b.health_color,
                background: `${b.health_color}15`, border: `1px solid ${b.health_color}40`,
                borderRadius: 5, padding: '2px 8px',
              }}>{b.health_label}</span>
              <span style={{ fontSize: '0.78rem', color: '#e5e7eb' }}>{b.universe_count} stocks tracked</span>
              {b.divergence && (
                <div style={{
                  marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 700, color: '#f97316',
                  background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.35)',
                  borderRadius: 6, padding: '3px 9px',
                }}>
                  {getBreadthDivergenceText(b)}
                </div>
              )}
            </div>

            {/* 4-metric grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {[
                { label: 'MA200 Above', val: b.pct_above_ma200, color: ma200Color, bar: b.pct_above_ma200 ?? 0, desc: 'Long trend is healthier above 60%' },
                { label: 'MA50 Above',  val: b.pct_above_ma50,  color: ma50Color,  bar: b.pct_above_ma50  ?? 0, desc: 'Short momentum is healthier above 50%' },
                { label: '52W Highs',   val: b.pct_52w_high, color: hiColor, bar: Math.min(100, (b.pct_52w_high ?? 0) * 5), desc: 'Trend strength improves above 5%' },
                { label: '52W Lows',    val: b.pct_52w_low,  color: loColor, bar: Math.min(100, (b.pct_52w_low  ?? 0) * 8), desc: 'Selling pressure warning above 3%' },
              ].map(({ label, val, color, bar, desc }) => (
                <div key={label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 8, padding: '8px 10px',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color, lineHeight: 1 }}>
                    {val != null ? val.toFixed(1) : '--'}<span style={{ fontSize: '0.88rem', color: '#e5e7eb' }}>%</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, margin: '6px 0 4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${bar}%`, background: color, borderRadius: 2, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.35 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Divergence insight */}
            {b.divergence && (
              <div style={{
                marginTop: 8, padding: '6px 10px', borderRadius: 6,
                background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)',
                fontSize: '0.81rem', color: '#fb923c', lineHeight: 1.65,
              }}>
                The index may remain near highs while broad MA200 participation stays below 55%.
                This usually reflects weakening internal rotation and has often preceded a broader top by <strong style={{ color: '#f97316' }}>2-6 weeks</strong>.
              </div>
            )}
          </div>
        )
      })()}

      {/* MAG7 concentration and MSS momentum */}
      {(() => {
        const cn   = data.concentration
        const hist = data.history ?? []
        const hLen = hist.length
        const cur   = hLen > 0  ? hist[hLen - 1]  : null
        const h5    = hLen > 5  ? hist[hLen - 6]  : null
        const h20   = hLen > 20 ? hist[hLen - 21] : null
        const h60   = hLen > 60 ? hist[hLen - 61] : null
        const delta = (a: number | undefined, b: number | undefined): number | null =>
          a != null && b != null ? a - b : null
        const mss5d  = delta(cur?.score, h5?.score)
        const mss20d = delta(cur?.score, h20?.score)
        const mss60d = delta(cur?.score, h60?.score)
        const arrow  = (d: number | null) => d == null ? '--' : d > 0.5 ? 'UP' : d < -0.5 ? 'DN' : 'FLAT'
        const dColor = (d: number | null) => d == null ? '#e5e7eb' : d > 1 ? '#22c55e' : d < -1 ? '#ef4444' : '#f59e0b'
        const fmt    = (d: number | null) => d == null ? '--' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`
        const relFmt = (v: number | null) => v == null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
        const relColor = (v: number | null) =>
          v == null ? '#e5e7eb' : v > 3 ? '#22c55e' : v > 0 ? '#86efac' : v > -3 ? '#fca5a5' : '#ef4444'

        if (!cn?.available && hLen < 6) return null
        return (
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            {/* MSS momentum */}
            {hLen >= 6 && (
              <div style={{ flex: '0 0 auto', background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem', minWidth: 170 }}>
                <div style={{ fontSize: '0.72rem', color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>MSS Trend</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
                  {([['5D', mss5d], ['1M', mss20d], ['3M', mss60d]] as [string, number|null][]).map(([lbl, d]) => (
                    <div key={lbl} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '0.45rem 0.35rem' }}>
                      <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: 4, letterSpacing: '0.06em' }}>{lbl}</div>
                      <div style={{ fontSize: '0.98rem', fontWeight: 800, color: dColor(d), lineHeight: 1.05 }}>{fmt(d)}</div>
                      <div style={{ fontSize: '0.68rem', color: dColor(d), marginTop: 4, fontWeight: 700 }}>{arrow(d)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: 6, lineHeight: 1.35 }}>
                  Delta in MSS points. Green improves, red deteriorates.
                </div>
              </div>
            )}

            {/* MAG7 concentration */}
            {cn?.available && (
              <div style={{ flex: 1, background: '#0d1117', border: `1px solid ${cn.color}33`, borderLeft: `3px solid ${cn.color}`, borderRadius: 10, padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: '0.72rem', color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{pickLang(uiLang, 'MAG7 집중도', 'MAG7 Concentration')}</div>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: cn.color, background: `${cn.color}18`, border: `1px solid ${cn.color}33`, borderRadius: 5, padding: '1px 7px' }}>{getConcentrationLabel(cn)}</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {([['5D', cn.rel_5d], ['20D', cn.rel_20d], ['60D', cn.rel_60d]] as [string, number|null][]).map(([lbl, v]) => (
                    <div key={lbl} style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', marginBottom: 2 }}>{pickLang(uiLang, `SPY 대비 ${lbl}`, `vs SPY ${lbl}`)}</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: relColor(v), lineHeight: 1 }}>{relFmt(v)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.69rem', color: '#e5e7eb', marginTop: 5, lineHeight: 1.4 }}>
                  {cn.risk === 'high'
                    ? pickLang(uiLang, 'MAG7 집중도가 높아 광범위한 시장 강도를 과대평가할 수 있습니다.', 'MAG7 concentration is elevated and may overstate broad market strength.')
                    : cn.risk === 'moderate'
                      ? pickLang(uiLang, '집중도 리스크를 점검하세요. 리더십이 소수 종목으로 좁아지고 있습니다.', 'Monitor concentration risk. Leadership is narrowing toward a few names.')
                      : cn.risk === 'mag7_weak'
                        ? pickLang(uiLang, 'MAG7 약세가 확산 중이며 더 넓은 시장을 끌어내릴 수 있습니다.', 'MAG7 weakness is broadening and may lead the wider market lower.')
                        : pickLang(uiLang, '시장 수익률은 지수 전반에 더 고르게 분포되어 있습니다.', 'Market returns are more evenly distributed across the index.')}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* divider between score components and stress overlays */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '0.1rem 0' }} />

      <MonteCarloInterpretationCard
        summaryLine={interpretationModel.summaryLine}
        detailLines={interpretationModel.detailLines}
        forwardNarrativeLine={interpretationModel.forwardNarrativeLine}
        interpretationState={interpretationModel.interpretationState}
        currentRegime={interpretationModel.currentRegime}
        agreementScore={interpretationModel.agreementScore}
        conflictScore={interpretationModel.conflictScore}
        trustScore={interpretationModel.trustScore}
        subtext={interpretationModel.subtext}
        uiLang={uiLang}
      />


      {/* Market Regime and Risk Scenario */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.81rem', fontWeight: 700, color: '#e5e7eb', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Stress Lens
        </div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
          descriptive overlays, not the final action layer
        </div>
      </div>
      {(data.market_regime || data.risk_scenario) && (() => {
        const mr = data.market_regime
        const rs = data.risk_scenario
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

            {/* Market Regime */}
            {mr && (
              <div style={{
                background: `${mr.regime_color}0c`, border: `1px solid ${mr.regime_color}44`,
                borderLeft: `4px solid ${mr.regime_color}`, borderRadius: 10, padding: '0.7rem 0.9rem',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em' }}>
                    Market Regime Lens
                  </span>
                  <span style={{
                    fontSize: '0.95rem', fontWeight: 700, color: mr.regime_color,
                    background: `${mr.regime_color}18`, border: `1px solid ${mr.regime_color}44`,
                    borderRadius: 6, padding: '2px 9px',
                  }}>{mr.regime}</span>
                  <span style={{
                    fontSize: '0.78rem', fontWeight: 700, color: mr.stability_color,
                    background: `${mr.stability_color}18`, border: `1px solid ${mr.stability_color}44`,
                    borderRadius: 999, padding: '1px 7px',
                  }}>{mr.stability_label}</span>
                  <span style={{ fontSize: '0.78rem', color: '#9ca3af', marginLeft: 'auto' }}>
                    {mr.days_in_regime}d - {mr.regime_confidence}% conf
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af', lineHeight: 1.45 }}>
                  {mr.regime_drivers.slice(0, 2).join(' - ')}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.4 }}>
                  Stress lens based on funding, liquidity, shock, and credit transmission.
                </div>
                {/* Stability bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.72rem', color: '#6b7280', minWidth: 60 }}>Stability</span>
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${mr.stability_score}%`, background: mr.stability_color, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '0.72rem', color: mr.stability_color, fontWeight: 700, minWidth: 28, textAlign: 'right' }}>
                    {mr.stability_score}
                  </span>
                </div>
              </div>
            )}

            {/* Risk Scenario */}
            {rs && (
              <div style={{
                background: rs.fill, border: `1px solid ${rs.color}44`,
                borderLeft: `4px solid ${rs.color}`, borderRadius: 10, padding: '0.7rem 0.9rem',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em' }}>
                    {pickLang(uiLang, '주식 경로 시나리오', 'Equity Path Scenario')}
                  </span>
                  <span style={{
                    fontSize: '0.95rem', fontWeight: 700, color: rs.color,
                    background: `${rs.color}18`, border: `1px solid ${rs.color}44`,
                    borderRadius: 6, padding: '2px 9px',
                  }}>{rs.scenario}: {getScenarioLabel(rs)}</span>
                  <span style={{ fontSize: '0.78rem', color: '#9ca3af', marginLeft: 'auto' }}>
                    {pickLang(uiLang, `${rs.confidence}% 정렬`, `${rs.confidence}% aligned`)}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#d1d5db', lineHeight: 1.45 }}>
                  {getScenarioDescription(rs, uiLang)}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.4 }}>
                  {pickLang(uiLang, '스트레스 경로를 설명합니다. 최종 실행 레이어를 대체하지 않습니다.', 'Describes the path of stress. It does not override the final action layer.')}
                </div>
                <div style={{ fontSize: '0.78rem', color: rs.color, fontWeight: 600, lineHeight: 1.4 }}>
                  {getScenarioActionHint(rs, uiLang)}
                </div>
                {/* Confidence bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.72rem', color: '#6b7280', minWidth: 60 }}>{pickLang(uiLang, '신뢰도', 'Confidence')}</span>
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${rs.confidence}%`, background: rs.color, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '0.72rem', color: rs.color, fontWeight: 700, minWidth: 28, textAlign: 'right' }}>
                    {rs.confidence}%
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Primary Risk Drivers */}
      {(() => {
        const total = (data.total_risk?.total || 1)
        const sorted = [...diagLayers]
          .filter(l => l.score > 0)
          .sort((a, b) => (b.score / b.max) - (a.score / a.max))
        const top3 = sorted.slice(0, 3)
        const stressDescriptions: Record<string, string> = {
          'Macro / Defensive Rotation': 'Macro pressure and defensive rotation are setting the current tone.',
          'Financial Stress': 'Banks and financials are carrying visible transmission stress.',
          'Funding Stress': 'Funding conditions are tightening before broader stress confirmation.',
          'Liquidity Stress': 'Liquidity conditions are weakening across internal market plumbing.',
          'Equity Structure': 'Price structure is softening at the index level.',
          'Credit Stress': 'Credit transmission is active but not yet fully confirmed.',
          'Leveraged Loans': 'Leveraged-loan proxies are weakening ahead of spread confirmation.',
          'Market Breadth': 'Participation is narrowing beneath the surface of the tape.',
          'Shock Detector': 'Event-sensitive shock detectors are contributing to stress.',
          'Cross-Asset': 'Cross-asset defensiveness is reinforcing the current posture.',
          'Credit Spread': 'Spread widening is contributing directly to total stress.',
          'Liquidity Shock': 'Liquidity shock inputs are acting like acute accelerants.',
        }
        if (top3.length === 0) return null
        return (
          <div style={{
            background: 'rgba(245,158,11,0.05)',
            border: '1px solid rgba(245,158,11,0.22)',
            borderLeft: '4px solid #f59e0b',
            borderRadius: 12, padding: '0.85rem 1rem',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.81rem', fontWeight: 700, color: '#f59e0b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Stress Composition
              </span>
              <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                top 3 by stress utilization - total risk {total}/120
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {top3.map((layer, idx) => {
                const ratio = layer.score / layer.max
                const contribPct = layer.score / total * 100
                const lColor = ratio >= 0.7 ? '#ef4444' : ratio >= 0.5 ? '#f97316' : ratio >= 0.35 ? '#f59e0b' : '#84cc16'
                const bgColor = ratio >= 0.7 ? 'rgba(127, 29, 29, 0.35)' : ratio >= 0.5 ? 'rgba(124, 45, 18, 0.30)' : ratio >= 0.35 ? 'rgba(120, 53, 15, 0.22)' : 'rgba(20, 83, 45, 0.18)'
                return (
                  <div key={layer.label} style={{
                    background: bgColor,
                    border: `1px solid ${lColor}30`,
                    borderRadius: 10,
                    padding: '0.8rem 0.9rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'rgba(229,231,235,0.45)', fontWeight: 700, marginBottom: 4 }}>#{idx + 1}</div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 800, color: lColor }}>{layer.label}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#e5e7eb' }}>{layer.score}/{layer.max}</div>
                        <div style={{ fontSize: '0.75rem', color: lColor, fontWeight: 700 }}>{contribPct.toFixed(1)}%</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.77rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                      {stressDescriptions[layer.label] ?? 'This layer is a top contributor to the current stress mix.'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── AI Insight: Structure ── */}
      {(() => {
        type CompItem = { readonly name: string; readonly val: number; readonly desc: string }
        const comps1: CompItem[] = [
          { name: 'TrendAdj', val: c.components.trend, desc: '가격 추세 (MA50/200 대비)' },
          { name: 'DepthAdj', val: c.components.depth, desc: '시장 폭 (MA200 상회 비율)' },
          { name: 'VolAdj',   val: c.components.vol,   desc: '변동성 레짐 (VIX 백분위)' },
          { name: 'DDAdj',    val: c.components.dd,    desc: '최대낙폭 패널티' },
        ]
        const worst1 = comps1.reduce((a, b) => a.val < b.val ? a : b)
        const best1  = comps1.reduce((a, b) => a.val > b.val ? a : b)
        const negCnt1 = comps1.filter(x => x.val < 0).length
        const bPct1   = data.breadth?.pct_above_ma200
        const head1 = negCnt1 === 0
          ? '모든 MSS 구성 요소 긍정적 — 광범위한 구조적 지지'
          : negCnt1 === 1
            ? `${worst1.name}이 MSS의 단일 하락 요인 (${worst1.val})`
            : `${negCnt1}개 항목 부정적 — ${worst1.name}이 주요 압박 (${worst1.val})`
        const bNote1 = bPct1 != null
          ? bPct1 > 60 ? `${bPct1.toFixed(0)}%의 종목이 MA200 위 — 폭넓은 참여가 MSS를 지지합니다.`
          : bPct1 > 40 ? `${bPct1.toFixed(0)}%의 종목만 MA200 위 — 지수보다 시장 체력이 약합니다.`
          : `${bPct1.toFixed(0)}%의 종목만 MA200 위 — 시장 폭 위험 신호입니다.`
          : null
        const ins1 = negCnt1 === 0
          ? '현재 시장 구조는 전반적으로 건강합니다. 모든 지표 긍정적 — 추세를 유지하세요.'
          : c.score < 100
            ? `MSS가 100 아래로 내려왔습니다. ${worst1.name}이 가장 큰 압력 요인 — 방어적 포지션을 검토하세요.`
            : `MSS는 중립 이상이나 ${worst1.name}(${worst1.val})에 주의가 필요합니다. 구조 악화 진행 여부를 모니터링하세요.`
        return (
          <div style={{
            background: 'rgba(165,180,252,0.05)',
            border: '1px solid rgba(165,180,252,0.2)',
            borderLeft: '3px solid #a5b4fc',
            borderRadius: 10, padding: '0.85rem 1.1rem',
            display: 'flex', flexDirection: 'column', gap: 7,
            marginTop: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(165,180,252,0.15)', borderRadius: 4, padding: '1px 7px' }}>{pickLang(uiLang, 'AI 인사이트', 'AI Insight')}</span>
              <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>{head1}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                `• 가장 강한 항목: ${best1.name} (+${best1.val} / ${best1.desc})`,
                negCnt1 > 0 ? `• 가장 약한 항목: ${worst1.name} (${worst1.val} / ${worst1.desc})` : '',
                bNote1 ? `• 시장 폭: ${bNote1}` : '',
              ].filter(Boolean).map((b, i) => (
                <span key={i} style={{ fontSize: '0.77rem', color: '#94a3b8', lineHeight: 1.5 }}>{b}</span>
              ))}
            </div>
            <div style={{ borderTop: '1px solid rgba(165,180,252,0.12)', paddingTop: 5, fontSize: '0.78rem', color: '#cbd5e1' }}>
              <span style={{ color: '#a5b4fc', fontWeight: 700 }}>구독자 시사점: </span>{ins1}
            </div>
          </div>
        )
      })()}

      </div>}{/* end Market Structure Diagnostics group */}

      {/* ─── Risk Action Engine ─── */}
      {ovTab === 2 && <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: '0.15rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Risk Action Engine
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
        <span style={{ fontSize: '0.7rem', color: '#374151' }}>systemic score · tracks · final decision</span>
      </div>}

      {/* Current live comparison */}
      {/* Total Risk Score and 5-Layer systemic engine */}
      {data.total_risk && (() => {
        const tr = data.total_risk!
        const sc = tr.state_color
        const pct = (tr.total / 120) * 100
        const layers = [
          tr.layers.equity,
          tr.layers.breadth,
          tr.layers.credit,
          tr.layers.lev_loan,
          tr.layers.liquidity,
          tr.layers.funding,
          tr.layers.macro,
          tr.layers.shock,
          tr.layers.cross_asset,
          tr.layers.credit_spread,
          tr.layers.liquidity_shock,
          tr.layers.financial_stress,
        ]
        const layerColors = ['#6366f1', '#22d3ee', '#f59e0b', '#fb923c', '#06b6d4', '#a855f7', '#10b981', '#ef4444', '#f472b6', '#facc15', '#f43f5e', '#0ea5e9']
        const mpsColor = tr.mps < 30 ? '#22c55e' : tr.mps < 50 ? '#84cc16' : tr.mps < 70 ? '#f59e0b' : tr.mps < 85 ? '#f97316' : '#ef4444'
        const rg = tr.regime
        const rgColor = rg?.color ?? '#e5e7eb'
        const rgTooltip = rg
          ? [
              'Market Regime: ' + rg.regime + ' (' + String(rg.confidence) + '% confidence)',
              '',
              rg.desc,
              '',
              'Drivers:',
              ...(rg.drivers ?? []).map((d: string) => '\u2022 ' + d)
            ].join('\n')
          : ''
        const amplifiedLayers = new Set(Object.entries(rg?.weights ?? {}).filter(([,w]) => (w as number) > 1).map(([k]) => k))
        const ms = data.master_signal
        const exposurePct = data.current.exposure_pct ?? 100
        const dominantLayer = tr.dominant_layer ?? 'Balanced'
        const masterColorMap: Record<string, string> = {
          ALL_CLEAR: '#22c55e',
          EARLY_WARNING: '#f59e0b',
          CREDIT_CRISIS: '#f97316',
          HEDGE_AND_HOLD: '#06b6d4',
          COMPOUND_CRISIS: '#ef4444',
        }
        const masterColor = ms ? (masterColorMap[ms.mode] ?? '#22c55e') : '#22c55e'
        const masterModeLabel = ms?.mode ? ms.mode.replace(/_/g, ' ') : 'ALL CLEAR'
        const masterActionLabel = ms?.action ?? 'HOLD'
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {ovTab === 2 && <>

            {/* ── AI Insight: Signals ── */}
            {(() => {
              const masterMode2 = data.master_signal?.mode ?? 'UNKNOWN'
              type ModeInfo = { label: string; color: string; ko: string }
              const modeMap2: Record<string, ModeInfo> = {
                ALL_CLEAR:       { label: 'ALL CLEAR',      color: '#22c55e', ko: '현재 시장 구조는 안전합니다. QQQ/SPY 등 주식 포지션을 정상 비중으로 유지할 수 있는 구간입니다.' },
                EARLY_WARNING:   { label: 'EARLY WARNING',   color: '#f59e0b', ko: '초기 경고 신호가 감지됩니다. 주식 비중을 일부 축소하고 손절 라인을 재확인하세요.' },
                HEDGE_AND_HOLD:  { label: 'HEDGE & HOLD',    color: '#f97316', ko: '주식 비중을 줄이거나 헤지를 추가할 때입니다. 시장 하락이 가속될 수 있습니다.' },
                CREDIT_CRISIS:   { label: 'CREDIT CRISIS',   color: '#ef4444', ko: '신용 위기 신호입니다. 주식 포지션을 즉시 축소하고 현금 비중을 높이세요.' },
                COMPOUND_CRISIS: { label: 'COMPOUND CRISIS', color: '#dc2626', ko: '복합 위기입니다. 시스템 전반 스트레스가 극단적 — 주식 비중을 최소화하고 현금을 확보하세요.' },
              }
              const mi2: ModeInfo = modeMap2[masterMode2] ?? { label: masterMode2, color: '#94a3b8', ko: '신호를 분석 중입니다.' }
              const stage2 = tr.crisis_stage.stage
              const sNote2 = stage2 <= 2
                ? `위기 단계 ${stage2}: 전파 경로 초기 단계 — 아직 전면 위기는 아닙니다.`
                : stage2 <= 4
                  ? `위기 단계 ${stage2}: 위기가 신용 시장으로 전파 중 — 주의가 필요합니다.`
                  : `위기 단계 ${stage2}: 심각한 전파 단계 — 즉각적인 대응이 필요합니다.`
              const rNote2 = tr.total < 50
                ? `12-레이어 총 위험 ${tr.total}/120 — 경계 임계값(50) 이하`
                : tr.total < 70
                  ? `12-레이어 총 위험 ${tr.total}/120 — 경고 구간 진입`
                  : `12-레이어 총 위험 ${tr.total}/120 — 고위험 구간`
              return (
                <div style={{
                  background: 'rgba(165,180,252,0.05)',
                  border: '1px solid rgba(165,180,252,0.2)',
                  borderLeft: `3px solid ${mi2.color}`,
                  borderRadius: 10, padding: '0.85rem 1.1rem',
                  display: 'flex', flexDirection: 'column', gap: 7,
                  marginBottom: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(165,180,252,0.15)', borderRadius: 4, padding: '1px 7px' }}>{pickLang(uiLang, 'AI 인사이트', 'AI Insight')}</span>
                    <span style={{ fontSize: '0.73rem', fontWeight: 700, color: mi2.color, background: `${mi2.color}15`, border: `1px solid ${mi2.color}44`, borderRadius: 5, padding: '2px 9px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{mi2.label}</span>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>MSS {data.current.score.toFixed(0)} · Risk {tr.total}/120 · Stage {stage2}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[sNote2, rNote2].map((b, i) => (
                      <span key={i} style={{ fontSize: '0.77rem', color: '#94a3b8', lineHeight: 1.5 }}>• {b}</span>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid rgba(165,180,252,0.12)', paddingTop: 5, fontSize: '0.78rem', color: '#cbd5e1' }}>
                    <span style={{ color: '#a5b4fc', fontWeight: 700 }}>구독자 시사점: </span>{mi2.ko}
                  </div>
                </div>
              )
            })()}
            {/* Hero row */}
            <div style={{ background: '#0d1117', border: `1px solid ${sc}44`, borderLeft: `4px solid ${sc}`, borderRadius: 14, padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 5-column info strip: MPS | Total Risk | Crisis Stage | Final Decision | Stance */}
              <div style={{ display: 'grid', gridTemplateColumns: '0.82fr 1.35fr 1.18fr 1.62fr 1.08fr', gap: 12, alignItems: 'start' }}>
                {/* MPS ??half-circle gauge */}
                <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', paddingRight: 10 }}>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Macro Pressure</div>
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
                    <HalfGauge value={tr.mps} max={100} color={mpsColor} width={96} height={70} valueFontSize={18} denomFontSize={9} />
                  </div>
                </div>
                {/* Market Regime */}
                <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', paddingRight: 10 }}>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Regime Snapshot</div>
                  <div title={rgTooltip} style={{ cursor: 'help' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: rgColor, background: `${rgColor}12`, border: `1px solid ${rgColor}40`, borderRadius: 6, padding: '3px 8px', display: 'inline-block', marginBottom: 3 }}>{rg?.regime ?? '--'}</span>
                    {rg && <div style={{ fontSize: '0.75rem', color: '#e5e7eb', marginTop: 2 }}>{rg.confidence}% confidence</div>}
                    {rg?.drivers?.slice(0, 2).map((d: string) => (
                      <div key={d} style={{ fontSize: '0.78rem', color: '#e5e7eb', lineHeight: 1.4 }}>- {d}</div>
                    ))}
                  </div>
                </div>
                {/* Total Risk ??half-circle gauge */}
                <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', paddingRight: 10 }}>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>{pickLang(uiLang, '12-레이어 시스템 리스크', '12-Layer Systemic Risk')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
                    <HalfGauge value={tr.total} max={120} color={sc} width={116} height={74} valueFontSize={20} denomFontSize={10} />
                    <div style={{ fontSize: '0.99rem', fontWeight: 700, color: sc, letterSpacing: '0.05em', marginTop: 1 }}>{tr.state.toUpperCase()}</div>
                  </div>
                </div>
                {/* Crisis Stage */}
                <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', paddingRight: 10 }}>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Crisis Stage</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <div style={{ fontSize: '0.99rem', fontWeight: 700, color: tr.crisis_stage.color, background: `${tr.crisis_stage.color}12`, border: `1px solid ${tr.crisis_stage.color}33`, borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>{getCrisisStageLabel(tr.crisis_stage.stage, tr.crisis_stage.label)}</div>
                    <div style={{ fontSize: '0.78rem', color: '#e5e7eb' }}>S{tr.crisis_stage.stage}</div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', lineHeight: 1.45 }}>
                    {getCrisisStageDescription(tr.crisis_stage)}
                  </div>
                </div>
                {/* Final Decision */}
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#e5e7eb', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Final Decision</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: '1.02rem', fontWeight: 700, color: masterColor, background: `${masterColor}12`, border: `1px solid ${masterColor}33`, borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>
                      {masterActionLabel}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: masterColor, fontWeight: 700 }}>
                      {masterModeLabel}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#9ca3af', lineHeight: 1.45 }}>
                    Exposure {exposurePct}% - {dominantLayer}
                  </div>
                </div>
              </div>

              {/* Score bar ??gradient track with right-side mask */}
              <div>
                <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'linear-gradient(90deg, #22c55e 0%, #84cc16 25%, #f59e0b 42%, #f97316 58%, #ef4444 75%, #b91c1c 100%)', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `${100 - pct}%`, background: 'rgba(0,0,0,0.76)', transition: 'width 0.6s ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: '0.81rem', color: '#e5e7eb' }}>
                  <span>0 Normal</span><span>30 Caution</span><span>50 Warning</span><span>70 High Risk</span><span>90 Crisis</span>
                </div>
              </div>

              {/* Action line */}
              <div style={{ fontSize: '1.02rem', color: '#e5e7eb', background: `${sc}0d`, border: `1px solid ${sc}22`, borderRadius: 8, padding: '0.5rem 0.75rem', lineHeight: 1.5 }}>
                {getTotalRiskActionLine(data, uiLang)}
              </div>
            </div>

            {/* Master Signal ??Combined Track A + Track C recommendation */}
            {data.master_signal && data.master_signal.mode !== 'ALL_CLEAR' && (() => {
              const ms = data.master_signal!
              const MS_COLORS: Record<string, string> = {
                'EARLY_WARNING': '#f59e0b',
                'COMPOUND_CRISIS': '#ef4444',
                'CREDIT_CRISIS':   '#f97316',
                'HEDGE_AND_HOLD':  '#06b6d4',
              }
              const msColor = MS_COLORS[ms.mode] ?? '#e5e7eb'
              const velDelta = ms.mss_5d_delta
              const velAlert = Boolean(ms.mss_velocity_alert)
              const velColor = velAlert ? '#ef4444' : '#22c55e'
              const escList = (ms.escalation_conditions ?? []).slice(0, 3)
              return (
                <div style={{
                  background: `${msColor}18`, border: `1px solid ${msColor}55`,
                  borderLeft: `4px solid ${msColor}`, borderRadius: 10,
                  padding: '0.55rem 1rem', display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', width: '100%' }}>
                    <span style={{ fontSize: '0.72rem', color: '#e5e7eb', textTransform: 'uppercase', fontWeight: 700, flexShrink: 0 }}>Master</span>
                    <span style={{
                      fontSize: '1.02rem', fontWeight: 700, color: msColor,
                      background: `${msColor}22`, borderRadius: 5, padding: '2px 10px', flexShrink: 0,
                    }}>{ms.action}</span>
                    {velDelta != null && (
                      <span style={{
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: velColor,
                        background: `${velColor}22`,
                        border: `1px solid ${velColor}44`,
                        borderRadius: 999,
                        padding: '2px 9px',
                        flexShrink: 0,
                      }}>
                        MSS 5D {velDelta > 0 ? '+' : ''}{velDelta.toFixed(1)}pt {velAlert ? 'ALERT' : 'OK'}
                      </span>
                    )}
                    <span style={{ fontSize: '0.81rem', color: '#e5e7eb', lineHeight: 1.45, flexGrow: 1 }}>{getMasterDetail(data, uiLang)}</span>
                  </div>
                  {escList.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', width: '100%' }}>
                      <span style={{ fontSize: '0.72rem', color: '#e5e7eb', textTransform: 'uppercase', fontWeight: 700 }}>{pickLang(uiLang, '에스컬레이션', 'Escalation')}</span>
                      {escList.map((ec, idx) => {
                        const ecColor = ec.already_fired ? '#ef4444' : '#f59e0b'
                        return (
                          <span
                            key={`${ec.sensor_key}-${idx}`}
                            style={{
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              color: ecColor,
                              background: `${ecColor}18`,
                              border: `1px solid ${ecColor}44`,
                              borderRadius: 5,
                              padding: '2px 7px',
                            }}
                            title={`${ec.name} | ${ec.current ?? '--'} / ${ec.threshold ?? '--'} | ${ec.would_trigger}`}
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

            {/* Track A Early ??transmission watch before spread confirmation */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12, alignItems: 'stretch' }}>
            {data.track_a_early && (() => {
              const tae = data.track_a_early!
              const TAE_COLORS: Record<string, string> = {
                'Early Watch': '#f97316',
                'Soft Watch': '#f59e0b',
                'Monitor': '#eab308',
                'Normal': '#22c55e',
                'Unavailable': '#e5e7eb',
              }
              const taeColor = TAE_COLORS[tae.state] ?? '#e5e7eb'
              const triggered = tae.triggered ?? []
              return (
                <div style={{
                  background: `${taeColor}10`,
                  border: `1px solid ${taeColor}44`,
                  borderLeft: `3px solid ${taeColor}`,
                  borderRadius: 10,
                  padding: '0.65rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 10,
                }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: '0.72rem', color: '#e5e7eb', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>{pickLang(uiLang, 'Track A 조기', 'Track A Early')}</div>
                    <div style={{ fontSize: '0.75rem', color: '#e5e7eb' }}>Transmission Watch</div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <span style={{
                      fontSize: '0.95rem', fontWeight: 700, color: taeColor,
                      background: `${taeColor}15`, border: `1px solid ${taeColor}44`,
                      borderRadius: 6, padding: '2px 9px',
                    }}>{tae.state}</span>
                    <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#cbd5e1' }}>
                      score {tae.score != null ? tae.score.toFixed(2) : '--'} - {tae.trigger_count} trigger{tae.trigger_count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(tae.metrics ?? []).map((m) => (
                      <span
                        key={m.key}
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: m.triggered ? taeColor : '#94a3b8',
                          background: m.triggered ? `${taeColor}18` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${m.triggered ? taeColor + '44' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 999,
                          padding: '2px 8px',
                        }}
                        title={`${m.label} | z ${m.z ?? '--'} | 5d ${m.roc_5d ?? '--'}%`}
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#e5e7eb', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                    {tae.state === 'Normal' ? 'No early transmission warning yet.' : 'Proxy weakness is appearing before spread confirmation.'}
                    {tae.as_of_date ? ` As-of ${tae.as_of_date}.` : ''}
                    {!tae.equity_healthy ? ' Equity filter is no longer healthy.' : ''}
                  </div>
                </div>
              )
            })()}

            {/* Track A ??Credit Early Warning (2-Tier) */}
            {data.track_a && (() => {
              const ta = data.track_a!
              const TA_COLORS: Record<string, string> = {
                'Stealth Stress': '#f97316', 'Credit Watch': '#f59e0b',
                'Credit Alert': '#ef4444', 'Watch': '#f59e0b',
                'Elevated': '#eab308', 'Normal': '#22c55e', 'Unavailable': '#e5e7eb',
              }
              const taColor = TA_COLORS[ta.state] ?? '#e5e7eb'
              const isActive = ta.stage0 || ta.stage0_watch
              const streakDots = ta.stage0_watch ? [1, 2, 3].map(d => (
                <span key={d} style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  background: d <= (ta.consecutive_days ?? 0) ? taColor : 'rgba(255,255,255,0.12)',
                  margin: '0 2px',
                }} />
              )) : null
              return (
                <div style={{
                  background: isActive ? `${taColor}12` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isActive ? taColor + '55' : 'rgba(255,255,255,0.08)'}`,
                  borderLeft: `3px solid ${taColor}`,
                  borderRadius: 10, padding: '0.65rem 1rem',
                  display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 10,
                }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: '0.72rem', color: '#e5e7eb', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Track A</div>
                    <div style={{ fontSize: '0.75rem', color: '#e5e7eb' }}>Credit Early Warning</div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <span style={{
                      fontSize: '0.95rem', fontWeight: 700, color: taColor,
                      background: `${taColor}15`, border: `1px solid ${taColor}44`,
                      borderRadius: 6, padding: '2px 9px',
                    }}>{ta.state}{ta.stage0 ? ' - Confirmed' : ''}</span>
                    {ta.stage0_watch && (
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
                        {streakDots}
                        <span style={{ fontSize: '0.75rem', color: taColor, marginLeft: 4, fontWeight: 700 }}>
                          {ta.stage0 ? `CONFIRMED Day ${ta.consecutive_days}` : `Day ${ta.consecutive_days}/3`}
                        </span>
                      </div>
                    )}
                  </div>
                  {ta.z_credit != null && (() => {
                    const z = ta.z_credit
                    const zMin = -3, zMax = 3
                    const needle = Math.max(0, Math.min(100, (z - zMin) / (zMax - zMin) * 100))
                    const zLabel = z < 1.0 ? 'Normal' : z < 1.5 ? 'Watch' : z < 2.0 ? 'Alert' : 'Crisis'
                    return (
                      <div style={{ width: '100%', maxWidth: 220 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <span style={{ fontSize: '0.78rem', color: taColor, fontWeight: 700 }}>Z:{z.toFixed(2)}</span>
                          <span style={{ fontSize: '0.75rem', color: taColor, background: `${taColor}18`, border: `1px solid ${taColor}33`, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{zLabel}</span>
                          {ta.hy_oas_current != null && (
                            <span style={{ fontSize: '0.75rem', color: '#e5e7eb', marginLeft: 'auto' }}>
                              HY {ta.hy_oas_current.toFixed(1)}%
                              {ta.roc_hy_5d != null && (
                                <span style={{ color: ta.roc_hy_5d > 0 ? '#f97316' : '#22c55e' }}>
                                  {' '}{ta.roc_hy_5d > 0 ? '+' : ''}{ta.roc_hy_5d.toFixed(1)}%
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        <div style={{ position: 'relative', height: 9, borderRadius: 5,
                          background: 'linear-gradient(90deg, #22c55e 0%, #22c55e 66.7%, #f59e0b 66.7%, #f59e0b 75%, #f97316 75%, #f97316 83.3%, #ef4444 83.3%)',
                          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }}>
                          {[66.7, 75, 83.3].map(p => (
                            <div key={p} style={{ position: 'absolute', top: 1, bottom: 1, left: `${p}%`, width: 1.5, background: 'rgba(0,0,0,0.45)', borderRadius: 1 }} />
                          ))}
                          <div style={{ position: 'absolute', top: -4, width: 3, height: 17, borderRadius: 2,
                            background: 'white', boxShadow: '0 0 6px rgba(255,255,255,0.8)',
                            left: `${needle}%`, transform: 'translateX(-50%)' }} />
                        </div>
                        <div style={{ position: 'relative', height: 14, marginTop: 2, fontSize: '0.71rem' }}>
                          {([
                            { label: 'Normal', pos: 33.3, color: '#22c55e' },
                            { label: 'Watch',  pos: 70.8, color: '#f59e0b' },
                            { label: 'Alert',  pos: 79.2, color: '#f97316' },
                            { label: 'Crisis', pos: 91.6, color: '#ef4444' },
                          ] as const).map(({ label, pos, color }) => (
                            <span key={label} style={{ position: 'absolute', left: `${pos}%`, transform: 'translateX(-50%)', color, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  {(() => {
                    const z = ta.z_credit ?? 0
                    const hy = ta.hy_oas_current
                    const roc = ta.roc_hy_5d
                    const narrative = ta.state === 'Normal'
                      ? `Z-score ${z.toFixed(2)}. Credit spread conditions remain normal.`
                        + (hy != null ? ` HY OAS ${hy.toFixed(1)}%` + (roc != null ? `, 5d ${roc > 0 ? '+' : ''}${roc.toFixed(1)}% change` : '.') : '')
                        + ` No clear credit-market stress is visible.`
                      : ta.state === 'Credit Watch' || ta.stage0_watch
                        ? `Z-score ${z.toFixed(2)}. Early credit stress is developing. ${ta.consecutive_days} day(s) confirmed so far; 3 days confirm the warning.`
                      : ta.stage0
                        ? `Z-score ${z.toFixed(2)}. Credit alert is active. HY OAS is widening and a defensive review is warranted.`
                      : ta.signal
                    return (
                      <div style={{ fontSize: '0.84rem', color: isActive ? '#fde68a' : '#e5e7eb', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                        {narrative}
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            {/* Track B ??MSS Velocity Guard */}
            {(() => {
              const tb = data.track_b
              const ms = data.master_signal
              const delta = tb?.mss_5d_delta ?? ms?.mss_5d_delta
              const alert = Boolean(tb?.velocity_alert ?? ms?.mss_velocity_alert)
              if (delta == null) return null
              const tbColor = alert ? '#ef4444' : '#22c55e'
              const signal = tb?.velocity_signal ?? (alert ? 'Structure velocity alert. Reduce risk expansion pace.' : 'Structure velocity stable.')
              return (
                <div style={{
                  background: `${tbColor}0f`,
                  border: `1px solid ${tbColor}55`,
                  borderLeft: `3px solid ${tbColor}`,
                  borderRadius: 10,
                  padding: '0.65rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 10,
                }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: '0.72rem', color: '#e5e7eb', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Track B</div>
                    <div style={{ fontSize: '0.75rem', color: '#e5e7eb' }}>MSS Velocity Guard</div>
                  </div>
                  {/* MSS Level badge ??matches zone bar */}
                  {(() => {
                    const mss = tb?.mss_current
                    if (mss == null) return (
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: tbColor, background: `${tbColor}18`, border: `1px solid ${tbColor}44`, borderRadius: 6, padding: '2px 9px', flexShrink: 0 }}>
                        {alert ? 'Velocity Alert' : 'Normal'}
                      </span>
                    )
                    const lvColor = mss >= 110 ? '#22c55e' : mss >= 100 ? '#f59e0b' : mss >= 92 ? '#f97316' : mss >= 84 ? '#ef4444' : '#7c3aed'
                    const lvLabel = mss >= 110 ? 'L0 Normal' : mss >= 100 ? 'L1 Caution' : mss >= 92 ? 'L2 Warning' : mss >= 84 ? 'L3 High Risk' : 'L4 Crisis'
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                        <span style={{ fontSize: '0.95rem', fontWeight: 700, color: lvColor, background: `${lvColor}18`, border: `1px solid ${lvColor}44`, borderRadius: 6, padding: '2px 9px' }}>
                          {lvLabel}
                        </span>
                        {alert && (
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 5, padding: '1px 7px', textAlign: 'center' }}>
                            ??Velocity Alert
                          </span>
                        )}
                      </div>
                    )
                  })()}
                  {tb && (() => {
                    // MSS zone bar: left=L0 safe, right=L4 crisis
                    // Inverted scale: high MSS ??left (safe), low MSS ??right (danger)
                    const mss = tb.mss_current
                    const mssMin = 84, mssMax = 120, mssRange = mssMax - mssMin
                    const needle = Math.max(0, Math.min(100, (mssMax - mss) / mssRange * 100))
                    const mssLabel = mss >= 110 ? 'L0 Normal' : mss >= 100 ? 'L1 Caution' : mss >= 92 ? 'L2 Warning' : mss >= 84 ? 'L3 High Risk' : 'L4 Crisis'
                    const velColor = delta < -8 ? '#ef4444' : delta < -3 ? '#f59e0b' : delta > 3 ? '#22c55e' : '#22c55e'
                    return (
                      <div style={{ width: '100%', maxWidth: 220 }}>
                        {/* Label row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <span style={{ fontSize: '0.78rem', color: tbColor, fontWeight: 700 }}>{mss.toFixed(0)}</span>
                          <span style={{ fontSize: '0.75rem', color: tbColor, background: `${tbColor}18`, border: `1px solid ${tbColor}33`, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{mssLabel}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: velColor, marginLeft: 'auto' }}>
                            {delta >= 0 ? '+' : '-'}{Math.abs(delta).toFixed(1)}pt
                          </span>
                        </div>
                        {/* Zone bar */}
                        <div style={{ position: 'relative', height: 9, borderRadius: 5,
                          background: 'linear-gradient(90deg, #22c55e 0%, #22c55e 27.8%, #f59e0b 27.8%, #f59e0b 55.6%, #f97316 55.6%, #f97316 77.8%, #ef4444 77.8%, #ef4444 88.9%, #7c3aed 88.9%)',
                          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }}>
                          {/* Zone boundary dividers */}
                          {[27.8, 55.6, 77.8, 88.9].map(p => (
                            <div key={p} style={{ position: 'absolute', top: 1, bottom: 1, left: `${p}%`, width: 1.5, background: 'rgba(0,0,0,0.45)', borderRadius: 1 }} />
                          ))}
                          {/* Needle */}
                          <div style={{ position: 'absolute', top: -4, width: 3, height: 17, borderRadius: 2,
                            background: 'white', boxShadow: '0 0 6px rgba(255,255,255,0.8)',
                            left: `${needle}%`, transform: 'translateX(-50%)' }} />
                        </div>
                        {/* Zone labels ??centered in each zone */}
                        <div style={{ position: 'relative', height: 14, marginTop: 2, fontSize: '0.71rem' }}>
                          {([
                            { label: 'L0', pos: 13.9,  color: '#22c55e' },
                            { label: 'L1', pos: 41.7,  color: '#f59e0b' },
                            { label: 'L2', pos: 66.7,  color: '#f97316' },
                            { label: 'L3', pos: 83.35, color: '#ef4444' },
                            { label: 'L4', pos: 94.45, color: '#7c3aed' },
                          ] as const).map(({ label, pos, color }) => (
                            <span key={label} style={{ position: 'absolute', left: `${pos}%`, transform: 'translateX(-50%)', color, fontWeight: 700 }}>{label}</span>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  {tb && (() => {
                    const mss = tb.mss_current
                    const d5 = tb.mss_5d_delta
                    const velNote = d5 != null
                      ? (d5 < -8 ? `5d drop of ${Math.abs(d5).toFixed(1)}pt. High velocity alert.`
                        : d5 < 0 ? `5d decline of ${Math.abs(d5).toFixed(1)}pt, still within a normal caution range.`
                        : `5d rise of +${d5.toFixed(1)}pt.`)
                      : ''
                    const lvNote = mss >= 110
                      ? `MSS ${mss.toFixed(0)} is in L0 Normal. Structure remains healthy and risk appetite is intact.`
                      : mss >= 100
                        ? `MSS ${mss.toFixed(0)} is in L1 Caution. Still broadly normal, but watch for a move below 92 into L2.`
                        : mss >= 92
                          ? `MSS ${mss.toFixed(0)} is in L2 Warning. Review defensive sizing.`
                          : `MSS ${mss.toFixed(0)} is in a high-risk zone. Stronger de-risking is recommended.`
                    return (
                      <div style={{ fontSize: '0.84rem', color: alert ? '#fde68a' : '#e5e7eb', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                        {lvNote}{velNote ? ' ' + velNote : ''}
                      </div>
                    )
                  })()}
                  {!tb && (
                    <div style={{ fontSize: '0.84rem', color: '#e5e7eb', lineHeight: 1.45, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>{signal}</div>
                  )}
                </div>
              )
            })()}

            {/* Track C ??Event/Shock Tracker (always shown) */}
            {data.track_c && (() => {
              const tc = data.track_c!
              const isNormal = tc.state === 'Normal'
              const tcColor = tc.state === 'Shock Confirmed' ? '#06b6d4' : tc.state === 'Shock Watch' ? '#38bdf8' : '#e5e7eb'
              const tcBorderColor = isNormal ? 'rgba(34,197,94,0.25)' : `${tcColor}44`
              const tcBgColor = isNormal ? 'rgba(34,197,94,0.04)' : `${tcColor}10`
              return (
                <div style={{
                  background: tcBgColor, border: `1px solid ${tcBorderColor}`,
                  borderLeft: isNormal ? '3px solid rgba(255,255,255,0.1)' : `3px solid ${tcColor}`, borderRadius: 10,
                  padding: '0.65rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 10,
                  opacity: 1,
                }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: '0.72rem', color: '#e5e7eb', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Track C</div>
                    <div style={{ fontSize: '0.75rem', color: '#e5e7eb' }}>Event / Shock</div>
                  </div>
                  <span style={{
                    fontSize: '0.95rem', fontWeight: 700,
                    color: isNormal ? '#22c55e' : tcColor,
                    background: isNormal ? 'rgba(34,197,94,0.12)' : `${tcColor}18`,
                    border: `1px solid ${isNormal ? 'rgba(34,197,94,0.45)' : tcColor + '44'}`,
                    borderRadius: 6, padding: '2px 9px', flexShrink: 0,
                  }}>{isNormal ? 'All Clear' : tc.state}</span>
                  {/* 4-Sensor dot matrix: glow=triggered, dim=inactive */}
                  {(() => {
                    const SENSORS = [
                      { key: 'yen_carry_z',    badge: 'YEN',  label: 'YEN' },
                      { key: 'oil_shock_z',    badge: 'OIL',  label: 'OIL' },
                      { key: 'vix_velocity_z', badge: 'VIX',  label: 'VIX' },
                      { key: 'safe_haven_z',   badge: 'GOLD', label: 'GOLD' },
                    ] as const
                    return (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {SENSORS.map(({ key, badge, label }) => {
                          const trig = tc.triggered_sensors.find(s => s.badge === badge)
                          const zVal = (tc.sensors as Record<string, number | null>)[key]
                          return (
                            <div key={key} style={{
                              width: 52, textAlign: 'center', padding: '5px 4px 5px', borderRadius: 7,
                              background: trig ? `${tcColor}20` : isNormal ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)',
                              border: `1px solid ${trig ? tcColor + '66' : isNormal ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)'}`,
                              display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 5,
                            }}>
                              {/* Label */}
                              <div style={{ fontSize: '0.75rem', fontWeight: trig ? 800 : 600,
                                color: trig ? tcColor : isNormal ? '#4ade80' : '#e5e7eb',
                                letterSpacing: '0.04em', lineHeight: 1 }}>
                                {label}
                              </div>
                              {/* Unified status bar */}
                              {(() => {
                                if (trig) {
                                  return (
                                    <>
                                      <div style={{ height: 7, borderRadius: 3, background: tcColor,
                                        boxShadow: `0 0 8px ${tcColor}99` }} />
                                      <div style={{ fontSize: '0.72rem', color: tcColor, fontWeight: 700, marginTop: -1 }}>
                                        Z{trig.z > 0 ? '+' : ''}{trig.z.toFixed(1)}
                                      </div>
                                    </>
                                  )
                                }
                                const absZ = zVal != null ? Math.abs(zVal) : 0
                                const pct = Math.min(100, Math.round(absZ / 2.5 * 100))
                                const barColor = pct >= 80 ? '#f97316' : pct >= 50 ? '#f59e0b' : '#22c55e'
                                return (
                                  <div style={{ height: 7, borderRadius: 3,
                                    background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, background: barColor,
                                      borderRadius: 3, transition: 'width 0.4s',
                                      boxShadow: pct >= 50 ? `0 0 4px ${barColor}88` : 'none' }} />
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                  {(() => {
                    const narrative = tc.state === 'Normal'
                      ? pickLang(uiLang, '엔·유가·VIX·금이 모두 Z=2.5 임계치 아래입니다. 의미 있는 외부 충격은 아직 보이지 않습니다.', 'Yen, oil, VIX, and gold are all below the Z=2.5 threshold. No material external shock is visible.')
                      : tc.state === 'Shock Watch'
                        ? pickLang(
                            uiLang,
                            `${tc.triggered_sensors.map(s => s.name).join(', ')} 신호가 감지되었습니다 (${tc.score}/${tc.max_score}). 단일 센서만으로는 확정할 수 없으니 후속 움직임을 확인하세요.`,
                            `${tc.triggered_sensors.map(s => s.name).join(', ')} triggered (${tc.score}/${tc.max_score}). One sensor is not enough for confirmation, but follow-through should be watched.`
                          )
                        : pickLang(
                            uiLang,
                            `복합 충격 감지: ${tc.shock_type}. ${tc.triggered_sensors.map(s => s.badge + ' Z' + (s.z > 0 ? '+' : '') + s.z.toFixed(1)).join(', ')}.`,
                            `Composite shock detected: ${tc.shock_type}. ${tc.triggered_sensors.map(s => s.badge + ' Z' + (s.z > 0 ? '+' : '') + s.z.toFixed(1)).join(', ')}.`
                          )
                    return (
                      <div style={{ fontSize: '0.92rem', color: isNormal ? '#e5e7eb' : '#fde68a', lineHeight: 1.65, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                        {narrative}
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            {/* Integrated Narrative Summary */}
            </div>
            </>}
            {ovTab === 0 && (() => {
              const mss = data.current.score
              const totalScore = tr.total
              const stage = tr.crisis_stage.stage
              const stageLabel = getCrisisStageLabel(tr.crisis_stage.stage, tr.crisis_stage.label)
              const taeState = data.track_a_early?.state ?? 'Normal'
              const taState = data.track_a?.state ?? 'Normal'
              const tcState = data.track_c?.state ?? 'Normal'
              const trackBLevel = mss >= 110 ? 'L0' : mss >= 100 ? 'L1' : mss >= 92 ? 'L2' : mss >= 84 ? 'L3' : 'L4'

              const mssWarn    = mss < 100
              const stressWarn = totalScore >= 50
              const stageWarn  = stage >= 4
              const earlyWarn  = taeState !== 'Normal' && taeState !== 'Unavailable'
              const creditWarn = taState !== 'Normal'
              const shockWarn  = tcState !== 'Normal'
              const warnCount  = [mssWarn, stressWarn, stageWarn, earlyWarn, creditWarn, shockWarn].filter(Boolean).length

              const stageLabelKo = (() => {
                const koMap: Record<string, string> = {
                  Normal: '정상',
                  'Equity Selloff': '주식 급락',
                  'Loan Stress': '대출 스트레스',
                  'Credit Stress': '신용 스트레스',
                  'Financial Stress': '금융 스트레스',
                  'Policy Shock': '정책 충격',
                  Panic: '패닉',
                }
                return koMap[stageLabel] ?? `단계 ${stage}`
              })()

              let cColor = '#22c55e'
              let cLabel = pickLang(uiLang, '안정 구간', 'Stable Zone')
              if (warnCount >= 3 || (stageWarn && (creditWarn || mssWarn))) {
                cColor = '#ef4444'
                cLabel = pickLang(uiLang, '고위험 경보', 'High Alert')
              } else if (warnCount >= 2) {
                cColor = '#f97316'
                cLabel = pickLang(uiLang, '경계 상승', 'Escalating')
              } else if (warnCount >= 1) {
                cColor = '#f59e0b'
                cLabel = pickLang(uiLang, '모니터링 필요', 'Needs Monitoring')
              }

              // Narrative parts
              const p1 = !mssWarn
                ? pickLang(
                    uiLang,
                    `시장 구조(MSS ${mss.toFixed(0)})는 ${trackBLevel} 구간에서 아직 지지력을 유지하고 있습니다.`,
                    `Market structure (MSS ${mss.toFixed(0)}) remains constructive in ${trackBLevel}.`
                  )
                : pickLang(
                    uiLang,
                    `시장 구조(MSS ${mss.toFixed(0)})가 100 아래로 내려와 구조적 약화가 진행 중입니다.`,
                    `Market structure (MSS ${mss.toFixed(0)}) is below 100 and structural softening is underway.`
                  )
              const p2 = stageWarn
                ? pickLang(
                    uiLang,
                    `위기 전이 단계가 '${stageLabelKo}'에 진입했습니다. 아직 붕괴 구간은 아니지만 경계가 필요합니다.`,
                    `Crisis propagation has entered '${stageLabel}'. This is not collapse yet, but caution is warranted.`
                  )
                : pickLang(
                    uiLang,
                    `위기 전이는 ${stage}단계로, 뚜렷한 추가 악화 신호는 아직 없습니다.`,
                    `Crisis propagation is at stage ${stage} with no major escalation signal.`
                  )
              const p3 = !stressWarn
                ? pickLang(
                    uiLang,
                    `총 12-레이어 리스크(${totalScore}/120)는 경고 기준선 50 아래에 있습니다.`,
                    `Total 12-layer risk (${totalScore}/120) is still below the warning threshold of 50.`
                  )
                : pickLang(
                    uiLang,
                    `총 12-레이어 리스크(${totalScore}/120)가 경고 구간에 진입했습니다.`,
                    `Total 12-layer risk (${totalScore}/120) has entered the warning zone.`
                  )
              const p4 = !creditWarn && !shockWarn
                ? pickLang(
                    uiLang,
                    'Track A 신용 신호와 Track C 외부 충격 신호는 아직 통제 범위에 있습니다.',
                    'Track A credit and Track C shock signals remain contained.'
                  )
                : creditWarn
                  ? pickLang(
                      uiLang,
                      `Track A 신용 경고(${taState})가 활성화되어 방어적 점검이 필요합니다.`,
                      `Track A credit warning (${taState}) is active and requires a defensive review.`
                    )
                  : pickLang(
                      uiLang,
                      `Track C 외부 충격 경고(${tcState})가 활성화되어 후속 확인이 필요합니다.`,
                      `Track C shock warning (${tcState}) is active and needs follow-through monitoring.`
                    )

              const watchFor = warnCount === 0
                ? pickLang(
                    uiLang,
                    '주요 입력이 모두 안정적입니다. 현재 포지션을 유지하세요.',
                    'All major inputs are stable. Maintain current positioning.'
                  )
                : stageWarn && !creditWarn
                  ? pickLang(
                      uiLang,
                      '다음 핵심 판단은 Track A 확인 여부입니다. Track A가 Normal을 유지하면 포지션 규율을 지키세요.',
                      'The next key decision is whether Track A confirms. As long as Track A stays Normal, maintain position discipline.'
                    )
                  : creditWarn
                    ? pickLang(
                        uiLang,
                        '신용 경고가 활성화되었습니다. 레버리지 축소와 방어 비중 확대를 검토하세요.',
                        'Credit warning is active. Consider leverage reduction and additional defensive sizing.'
                      )
                    : pickLang(
                        uiLang,
                        'MSS가 추가 하락하거나 Track A가 확인되면 리스크를 신속히 축소하세요.',
                        'If MSS falls further or Track A confirms, reduce risk promptly.'
                      )

              return (
                <div style={{
                  background: `${cColor}08`,
                  border: `1px solid ${cColor}33`,
                  borderLeft: `4px solid ${cColor}`,
                  borderRadius: 10,
                  padding: '0.9rem 1.1rem',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                      {pickLang(uiLang, '핵심 근거', 'Core Evidence')}
                    </span>
                    <span style={{
                      fontSize: '1.06rem', fontWeight: 700, color: cColor,
                      background: `${cColor}20`, border: `1px solid ${cColor}44`,
                      borderRadius: 6, padding: '2px 10px',
                    }}>{cLabel}</span>
                    {warnCount > 0 && (
                      <span style={{ fontSize: '0.84rem', color: cColor, background: `${cColor}15`, borderRadius: 999, padding: '1px 8px', border: `1px solid ${cColor}33` }}>
                        {pickLang(uiLang, `${warnCount}개의 활성 경고`, `${warnCount} active warning${warnCount === 1 ? '' : 's'}`)}
                      </span>
                    )}
                    <span style={{ fontSize: '0.78rem', color: '#e5e7eb', marginLeft: 'auto' }}>
                      {pickLang(uiLang, '최상위 최종 판단 뒤의 세부 매트릭스', 'Detail matrix behind the top-level final decision')}
                    </span>
                  </div>

                  {/* ── AI Insight: Summary ── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px', background: 'rgba(165,180,252,0.04)', borderRadius: 7, border: '1px solid rgba(165,180,252,0.12)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(165,180,252,0.15)', borderRadius: 4, padding: '1px 7px' }}>{pickLang(uiLang, 'AI 인사이트', 'AI Insight')}</span>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>— {pickLang(uiLang, '현재 시장 상황 요약', 'Current market snapshot')}</span>
                    </div>
                    {[p1, p2, p3, p4].map((p, i) => (
                      <span key={i} style={{ fontSize: '0.86rem', color: '#cbd5e1', lineHeight: 1.65 }}>• {p}</span>
                    ))}
                    <div style={{ marginTop: 4, paddingTop: 5, borderTop: '1px solid rgba(165,180,252,0.1)', fontSize: '0.86rem', color: '#cbd5e1', lineHeight: 1.65 }}>
                      <span style={{ color: '#a5b4fc', fontWeight: 700 }}>구독자 시사점: </span>{watchFor}
                    </div>
                  </div>

                  {/* Indicator grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
                    {/* MSS */}
                    <div style={{ background: mssWarn ? 'rgba(239,68,68,0.07)' : 'rgba(34,197,94,0.06)', border: `1px solid ${mssWarn ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 7, padding: '7px 8px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>
                        {pickLang(uiLang, '시장 구조 (MSS)', 'Market Structure (MSS)')}
                      </div>
                      <div style={{ fontSize: '1.19rem', fontWeight: 700, color: mssWarn ? '#ef4444' : '#22c55e', lineHeight: 1 }}>
                        {mss.toFixed(0)} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: mssWarn ? '#ef4444' : '#4ade80' }}>{trackBLevel}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.45, marginTop: 4 }}>
                        {pickLang(uiLang, '구조적 시장 강도입니다. 100 초과 = 양호, 100 미만 = 약화.', 'Structural market strength. Above 100 = healthy, below 100 = weakening.')}
                      </div>
                    </div>

                    {/* 12-Layer */}
                    <div style={{ background: stressWarn ? 'rgba(249,115,22,0.07)' : 'rgba(34,197,94,0.06)', border: `1px solid ${stressWarn ? 'rgba(249,115,22,0.25)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 7, padding: '7px 8px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>
                        {pickLang(uiLang, '총 리스크 (12L)', 'Total Risk (12L)')}
                      </div>
                      <div style={{ fontSize: '1.19rem', fontWeight: 700, color: stressWarn ? '#f97316' : '#22c55e', lineHeight: 1 }}>
                        {totalScore}<span style={{ fontSize: '0.75rem', color: '#e5e7eb' }}>/120</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.45, marginTop: 4 }}>
                        {pickLang(uiLang, '12개 레이어의 합계입니다. 50+ = 경고, 70+ = 고위험.', 'Sum of 12 layers. 50+ = warning, 70+ = high risk.')}
                      </div>
                    </div>

                    {/* Crisis Stage */}
                    <div style={{ background: stageWarn ? 'rgba(249,115,22,0.07)' : 'rgba(34,197,94,0.06)', border: `1px solid ${stageWarn ? 'rgba(249,115,22,0.25)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 7, padding: '7px 8px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>
                        {pickLang(uiLang, '위기 단계', 'Crisis Stage')}
                      </div>
                      <div style={{ fontSize: '1.19rem', fontWeight: 700, color: stageWarn ? '#f97316' : '#22c55e', lineHeight: 1 }}>
                        {stage}<span style={{ fontSize: '0.75rem', color: stageWarn ? '#f97316' : '#4ade80', marginLeft: 3 }}>{stageLabel.split(' ')[0]}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.45, marginTop: 4 }}>
                        {pickLang(uiLang, '주식 -> 대출 -> 신용 -> 금융. Panic은 6단계입니다.', 'Equity -> loans -> credit -> finance. Panic is stage 6.')}
                      </div>
                    </div>

                    {/* Track A Early */}
                    <div style={{ background: earlyWarn ? 'rgba(245,158,11,0.07)' : 'rgba(34,197,94,0.06)', border: `1px solid ${earlyWarn ? 'rgba(245,158,11,0.25)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 7, padding: '7px 8px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>
                        {pickLang(uiLang, 'Track A 조기', 'Track A Early')}
                      </div>
                      <div style={{ fontSize: '1.19rem', fontWeight: 700, color: earlyWarn ? '#f59e0b' : '#22c55e', lineHeight: 1 }}>
                        {taeState}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.45, marginTop: 4 }}>
                        Transmission watch before spread confirmation.
                      </div>
                    </div>

                    {/* Track A */}
                    <div style={{ background: creditWarn ? 'rgba(249,115,22,0.07)' : 'rgba(34,197,94,0.06)', border: `1px solid ${creditWarn ? 'rgba(249,115,22,0.25)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 7, padding: '7px 8px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>
                        Credit Warning (A)
                      </div>
                      <div style={{ fontSize: '1.19rem', fontWeight: 700, color: creditWarn ? '#f97316' : '#22c55e', lineHeight: 1 }}>
                        {taState === 'Normal' ? 'Normal' : taState}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.45, marginTop: 4 }}>
                        Credit-market stress and early crisis transmission signal.
                      </div>
                    </div>

                    {/* Track C */}
                    <div style={{ background: shockWarn ? 'rgba(6,182,212,0.07)' : 'rgba(34,197,94,0.06)', border: `1px solid ${shockWarn ? 'rgba(6,182,212,0.25)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 7, padding: '7px 8px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>
                        External Shock (C)
                      </div>
                      <div style={{ fontSize: '1.19rem', fontWeight: 700, color: shockWarn ? '#06b6d4' : '#22c55e', lineHeight: 1 }}>
                        {tcState === 'Normal' ? 'All Clear' : tcState}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', lineHeight: 1.45, marginTop: 4 }}>
                        Watches yen, oil, VIX, and gold for concurrent shock signals.
                      </div>
                    </div>
                  </div>

                  {/* Causal chain */}
                  {(() => {
                    const chain = buildCausalChain(data, uiLang)
                    return (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 10 }}>
                        <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>
                          Interpretation Path
                        </div>
                        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto' }}>
                          {chain.map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                              <div style={{
                                background: `${item.color}0c`,
                                border: `1px solid ${item.color}30`,
                                borderRadius: 7, padding: '6px 10px', minWidth: 130,
                              }}>
                                <div style={{ fontSize: '0.71rem', color: '#e5e7eb', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>
                                  {item.step}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: item.color, fontWeight: 600, lineHeight: 1.5 }}>
                                  {item.text}
                                </div>
                              </div>
                              {idx < 3 && (
                                <div style={{ color: '#e5e7eb', fontSize: '1rem', padding: '0 5px', flexShrink: 0 }}>-&gt;</div>
                              )}
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: '0.81rem', color: cColor, fontWeight: 700, lineHeight: 1.5, marginTop: 6 }}>
                          {watchFor}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })()}



            {ovTab === 3 && <>
            {/* Forward Distribution and Event Similarity */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.81rem', fontWeight: 700, color: '#e5e7eb', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Probabilistic Context
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                conditional history and analogs, not a direct forecast
              </div>
            </div>
            {(() => {
              const lvl  = data.current.level ?? 1
              const cr   = data.signal_analysis?.conditional_returns?.[String(lvl)]
              const sim  = data.event_similarity
              if (!cr && (!sim || sim.length === 0)) return null
              return (
                <div style={{ display: 'grid', gridTemplateColumns: cr && sim?.length ? '1fr 1fr' : '1fr', gap: 8 }}>

                  {/* Forward Distribution */}
                  {cr && (() => {
                    const p10  = cr.p10
                    const med  = cr.median
                    const p90  = cr.p90
                    const mean = cr.mean
                    const rng  = Math.max(Math.abs(p10), Math.abs(p90), Math.abs(mean), Math.abs(med), 1)
                    const pos  = (v: number) => ((v + rng) / (2 * rng)) * 100
                    const LVL_LABELS: Record<number, string> = {0:'Normal',1:'Caution',2:'Warning',3:'High Risk',4:'Crisis'}
                    const left = pos(p10)
                    const right = pos(p90)
                    const medianPos = pos(med)
                    const meanPos = pos(mean)
                    const medianLabelPos = Math.min(Math.max(medianPos, 16), 84)
                    const meanLabelPos = Math.min(Math.max(meanPos, 16), 84)
                    return (
                      <div style={{
                        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.09)',
                        borderRadius: 12, padding: '0.85rem 1rem',
                        display: 'flex', flexDirection: 'column', gap: 8,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.81rem', fontWeight: 700, color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Conditional Forward Distribution
                          </span>
                          <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                            Level {lvl} ({LVL_LABELS[lvl]}) - 21 trading-day outlook - n={cr.n}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ fontSize: '0.76rem', color: '#9ca3af', lineHeight: 1.5 }}>
                            Historical 21-day return range conditioned on the current MSS level. This is a distribution view, not a forecast.
                          </div>
                          <div style={{ position: 'relative', height: 92, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(239,68,68,0.08) 0%, rgba(255,255,255,0.01) 50%, rgba(34,197,94,0.08) 100%)' }} />
                            <div style={{ position: 'absolute', inset: '0 6%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <div style={{ position: 'relative', width: '100%', height: 56 }}>
                                <div style={{ position: 'absolute', top: 28, bottom: 0, left: '50%', width: 1, height: 28, transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.18)' }} />
                                <div style={{ position: 'absolute', top: 28, left: `${left}%`, width: `${Math.max(right - left, 1)}%`, height: 10, transform: 'translateY(-50%)', background: 'rgba(148,163,184,0.28)', borderRadius: 999, border: '1px solid rgba(148,163,184,0.35)' }} />
                                <div style={{ position: 'absolute', top: 28, left: `${medianPos}%`, width: 2, height: 22, transform: 'translate(-50%, -50%)', background: '#e5e7eb', borderRadius: 999 }} />
                                <div style={{ position: 'absolute', top: 28, left: `${meanPos}%`, width: 12, height: 12, transform: 'translate(-50%, -50%)', background: '#60a5fa', border: '2px solid rgba(15,23,42,0.9)', borderRadius: '50%' }} />
                                <div style={{ position: 'absolute', top: 18, left: 0, fontSize: '0.74rem', color: '#ef4444', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  P10 {p10 > 0 ? '+' : ''}{p10.toFixed(1)}%
                                </div>
                                <div style={{ position: 'absolute', top: 18, right: 0, fontSize: '0.74rem', color: '#22c55e', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  P90 {p90 > 0 ? '+' : ''}{p90.toFixed(1)}%
                                </div>
                                <div style={{ position: 'absolute', top: 0, left: `${medianLabelPos}%`, transform: 'translateX(-50%)', fontSize: '0.74rem', color: '#e5e7eb', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  Median {med > 0 ? '+' : ''}{med.toFixed(1)}%
                                </div>
                                <div style={{ position: 'absolute', top: 40, left: `${meanLabelPos}%`, transform: 'translateX(-50%)', fontSize: '0.74rem', color: '#60a5fa', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  Mean {mean > 0 ? '+' : ''}{mean.toFixed(1)}%
                                </div>
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: '0.74rem', color: '#9ca3af' }}>
                            <span>Left tail: downside stress</span>
                            <span>Center line: zero return</span>
                            <span>Band: P10 to P90 range</span>
                            <span>Dot: mean</span>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                          Positive rate: <span style={{ color: cr.pos_rate >= 60 ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>{cr.pos_rate.toFixed(1)}%</span>
                          {' '} - based on {cr.n} historical cases at the same regime level
                        </div>
                        <div style={{ display: 'none', fontSize: '0.75rem', color: '#6b7280', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                          Positive rate: <span style={{ color: cr.pos_rate >= 60 ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>{cr.pos_rate.toFixed(1)}%</span>
                          {' '} - historical conditional distribution, not a forecast
                        </div>
                      </div>
                    )
                  })()}

                  {/* Event Similarity */}
                  {sim && sim.length > 0 && (
                    <div style={{
                      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.09)',
                      borderRadius: 12, padding: '0.85rem 1rem',
                      display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.81rem', fontWeight: 700, color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Historical Analogs
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                          entry MSS - historical outcome
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {sim.map(ev => {
                          const outcome1m = ev.fwd_ret_1m
                          const outcome3m = ev.fwd_ret_3m
                          const o1col = outcome1m == null ? '#9ca3af' : outcome1m >= 0 ? '#22c55e' : '#ef4444'
                          const o3col = outcome3m == null ? '#9ca3af' : outcome3m >= 0 ? '#22c55e' : '#ef4444'
                          return (
                            <div key={ev.name} style={{
                              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                              borderRadius: 8, padding: '7px 9px',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                                <span style={{ fontSize: '0.81rem', fontWeight: 700, color: '#e5e7eb' }}>{ev.name}</span>
                                <span style={{ fontSize: '0.72rem', color: '#6b7280', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 6px' }}>
                                  sim {ev.similarity_pct}%
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.75rem' }}>
                                <span style={{ color: '#9ca3af' }}>MSS {ev.start_mss} - {ev.shock_category}</span>
                                {outcome1m != null && (
                                  <span>1M <span style={{ color: o1col, fontWeight: 700 }}>{outcome1m > 0 ? '+' : ''}{outcome1m.toFixed(1)}%</span></span>
                                )}
                                {outcome3m != null && (
                                  <span>3M <span style={{ color: o3col, fontWeight: 700 }}>{outcome3m > 0 ? '+' : ''}{outcome3m.toFixed(1)}%</span></span>
                                )}
                                {ev.qqq_drawdown_pct != null && (
                                  <span style={{ color: '#9ca3af' }}>MDD {ev.qqq_drawdown_pct.toFixed(1)}%</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#4b5563', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 5 }}>
                        * Entry MSS is used for similarity only. This is reference context, not a forecast.
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Risk DNA Radar Chart */}
            <RadarChart
              layers={layers}
              layerColors={layerColors}
              dominantLayer={tr.dominant_layer}
              totalRisk={tr.total}
            />

            {/* Risk Contribution Distribution (below radar, mouse-toggle) */}
            {data.risk_contribution && data.risk_contribution.length > 0 && (() => {
              const rc = data.risk_contribution
              const driverDescriptions: Record<string, string> = {
                macro: 'Macro pressure and defensive rotation are driving the current tone.',
                funding: 'Funding conditions are tightening before broader stress confirmation.',
                liquidity: 'Liquidity conditions are weakening across internal market plumbing.',
                financial_stress: 'Banks and financials are carrying visible transmission stress.',
                equity: 'Price structure is softening at the index level.',
                breadth: 'Participation is narrowing beneath the surface of the tape.',
                credit: 'Credit transmission is active but not yet fully confirmed.',
                lev_loan: 'Leveraged-loan proxies are weakening ahead of spread confirmation.',
                cross_asset: 'Cross-asset defensiveness is reinforcing the current posture.',
                credit_spread: 'Spread widening is contributing directly to total stress.',
                liquidity_shock: 'Liquidity shock inputs are acting like acute accelerants.',
                shock: 'Event-sensitive shock detectors are contributing to stress.',
              }
              return (
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: 12, padding: '0.85rem 1rem',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: '0.81rem', fontWeight: 700, color: '#e5e7eb', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Risk Contribution
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                        12-layer attribution - sorted by impact
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowRiskContribution(prev => !prev)}
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.74rem',
                        color: '#e5e7eb',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.14)',
                        borderRadius: 6,
                        padding: '3px 10px',
                        fontWeight: 700,
                      }}
                      aria-label={showRiskContribution ? 'Hide full layer cards' : 'Show full layer cards'}
                    >
                      {showRiskContribution ? 'Hide details' : 'Show details'}
                    </button>
                  </div>
                  {showRiskContribution && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      paddingTop: 10,
                      marginTop: 4,
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                    }}>
                      <div style={{ fontSize: '0.74rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, paddingTop: 4 }}>
                        Full 12-Layer Cards
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                      {rc.map((r, idx) => {
                        const rColor = r.ratio >= 0.7 ? '#ef4444' : r.ratio >= 0.5 ? '#f97316' : r.ratio >= 0.35 ? '#f59e0b' : r.ratio >= 0.15 ? '#84cc16' : '#60a5fa'
                        const bgColor = r.ratio >= 0.7 ? 'rgba(127, 29, 29, 0.35)' : r.ratio >= 0.5 ? 'rgba(124, 45, 18, 0.32)' : r.ratio >= 0.35 ? 'rgba(120, 53, 15, 0.24)' : r.ratio >= 0.15 ? 'rgba(20, 83, 45, 0.18)' : 'rgba(15, 23, 42, 0.28)'
                        return (
                          <div key={r.key} style={{
                            background: bgColor,
                            border: `1px solid ${rColor}34`,
                            boxShadow: `inset 0 1px 0 ${rColor}12`,
                            borderRadius: 10,
                            padding: '0.8rem 0.9rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                              <div>
                                <div style={{ fontSize: '0.72rem', color: 'rgba(229,231,235,0.45)', fontWeight: 700, marginBottom: 4 }}>
                                  #{idx + 1}
                                </div>
                                <div style={{ fontSize: '0.9rem', color: rColor, fontWeight: 800 }}>
                                  {r.label}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 800 }}>
                                  {r.score}/{r.max}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: rColor, fontWeight: 700 }}>
                                  {r.contribution_pct.toFixed(1)}%
                                </div>
                              </div>
                            </div>
                            <div style={{ fontSize: '0.77rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                              {driverDescriptions[r.key] ?? 'This layer is a key contributor to the current stress mix.'}
                            </div>
                          </div>
                        )
                      })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}


            {/* Risk Narrative Engine (Rule-Based) */}
            {(() => {
              const { paragraphs, color } = generateNarrative(data, uiLang)
              return (
                <div style={{
                  background: color + '06',
                  border: '1px solid ' + color + '22',
                  borderLeft: '4px solid ' + color + '55',
                  borderRadius: 12, padding: '0.95rem 1.1rem',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.12em' }}>
                      Risk Narrative
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>rule-based - auto generated</span>
                  </div>
                  {paragraphs.map((p, i) => (
                    <p key={i} style={{ margin: 0, fontSize: '0.85rem', color: i === 0 ? '#e5e7eb' : '#d1d5db', lineHeight: 1.65 }}>
                      {p}
                    </p>
                  ))}
                </div>
              )
            })()}

            {/* Crisis Propagation Map */}
            {(() => {
              const cs = tr.crisis_stage
              const stages = getCrisisStageLabels()
              const colors = cs.all_colors
              return (
                <div style={{ background: '#0d1117', border: `1px solid ${cs.color}33`, borderLeft: `4px solid ${cs.color}`, borderRadius: 12, padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ fontSize: '0.88rem', color: '#e5e7eb', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>Crisis Propagation Path</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: cs.color, background: `${cs.color}18`, border: `1px solid ${cs.color}44`, borderRadius: 6, padding: '3px 10px' }}>{getCrisisStageLabel(cs.stage, cs.label)}</span>
                      <span style={{ fontSize: '0.75rem', color: '#e5e7eb', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 5px' }}>S{cs.stage}</span>
                    </div>
                  </div>

                  {/* Stage rail */}
                  <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
                    {stages.map((label, i) => {
                      const isActive = i === cs.stage
                      const isPast   = i < cs.stage
                      const sc2 = colors[i]
                      return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ height: 5, borderRadius: 3, background: isPast ? sc2 : isActive ? sc2 : 'rgba(255,255,255,0.07)', opacity: isPast ? 0.5 : 1, transition: 'background 0.3s' }} />
                          <div style={{ fontSize: '0.75rem', color: isActive ? sc2 : isPast ? '#e5e7eb' : '#e5e7eb', fontWeight: isActive ? 800 : 500, textAlign: 'center', lineHeight: 1.3 }}>
                            {stages[i]}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Stage description */}
                  <div style={{ fontSize: '0.95rem', color: '#e5e7eb', lineHeight: 1.6 }}>{getCrisisStageDescription(cs)}</div>
                </div>
              )
            })()}

            {/* Global Risk Transmission Map */}
            {data.global_transmission && (() => {
              const gt = data.global_transmission!
              const gtNode = (k: string) => gt.nodes[k]
              const gtEdge = (src: string, dst: string) => gt.edges.find(e => e.from === src && e.to === dst)

              const edgeColor = (e: { active: boolean; strength: number }) =>
                !e.active ? 'rgba(255,255,255,0.09)' :
                e.strength >= 0.52 ? '#ef4444' : e.strength >= 0.40 ? '#f97316' : '#f59e0b'

              const edgeW = (e: { active: boolean; strength: number }) =>
                e.active ? Math.max(1.5, 1 + e.strength * 4) : 1

              return (
                <div style={{
                  background: 'rgba(255,255,255,0.01)',
                  border: `1px solid ${gt.transmission_color}33`,
                  borderRadius: 14, padding: '0.9rem 1rem',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.81rem', fontWeight: 700, color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      Global Transmission Map
                    </span>
                    <span style={{
                      fontSize: '0.85rem', fontWeight: 700, color: gt.transmission_color,
                      background: gt.transmission_color + '18',
                      border: `1px solid ${gt.transmission_color}44`,
                      borderRadius: 6, padding: '2px 10px',
                    }}>{gt.transmission_state}</span>
                    <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                      {gt.n_active_edges} active paths
                    </span>
                  </div>

                  {/* SVG network viewBox 520x390 */}
                  <svg viewBox="0 0 520 390" style={{ width: '100%', maxHeight: 390, display: 'block' }}>
                    <defs>
                      <marker id="gt-arr-a" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
                      </marker>
                      <marker id="gt-arr-r" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="#ef4444" />
                      </marker>
                      <marker id="gt-arr-d" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <polygon points="0 0, 6 3, 0 6" fill="rgba(255,255,255,0.15)" />
                      </marker>
                      <marker id="gt-arr-tc" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="#06b6d4" />
                      </marker>
                    </defs>

                    {/* Track C external shock (top-right ??equity node) */}
                    {gt.tc_edge.active && (
                      <g>
                        <line x1={500} y1={88} x2={114} y2={141}
                          stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 3"
                          markerEnd="url(#gt-arr-tc)" />
                        <text x={497} y={83} textAnchor="end" fontSize={9} fill="#06b6d4" fontWeight={700}>
                          EXTERNAL
                        </text>
                      </g>
                    )}

                    {/* Edges (draw before nodes) */}
                    {[
                      { src:'macro',     dst:'equity',    x1:225, y1:103, x2:106, y2:141 },
                      { src:'macro',     dst:'credit',    x1:238, y1:113, x2:167, y2:249 },
                      { src:'macro',     dst:'liquidity', x1:295, y1:103, x2:414, y2:141 },
                      { src:'equity',    dst:'credit',    x1:82,  y1:211, x2:112, y2:249 },
                      { src:'credit',    dst:'funding',   x1:170, y1:285, x2:352, y2:285 },
                      { src:'liquidity', dst:'funding',   x1:437, y1:211, x2:427, y2:249 },
                      { src:'credit',    dst:'liquidity', x1:169, y1:270, x2:413, y2:189 },
                    ].map(({ src, dst, x1, y1, x2, y2 }) => {
                      const e = gtEdge(src, dst)
                      if (!e) return null
                      const ec = edgeColor(e)
                      const ew = edgeW(e)
                      const markEnd = e.active
                        ? (e.strength >= 0.52 ? 'url(#gt-arr-r)' : 'url(#gt-arr-a)')
                        : 'url(#gt-arr-d)'
                      return (
                        <line key={`${src}-${dst}`}
                          x1={x1} y1={y1} x2={x2} y2={y2}
                          stroke={ec} strokeWidth={ew}
                          strokeDasharray={e.active ? undefined : '4 3'}
                          opacity={e.active ? 1 : 0.3}
                          markerEnd={markEnd}
                        />
                      )
                    })}

                    {/* Nodes */}
                    {([
                      { key:'macro',     cx:260, cy:75  },
                      { key:'equity',    cx:70,  cy:175 },
                      { key:'liquidity', cx:450, cy:175 },
                      { key:'credit',    cx:130, cy:285 },
                      { key:'funding',   cx:390, cy:285 },
                    ] as const).map(({ key, cx, cy }) => {
                      const n = gtNode(key)
                      if (!n) return null
                      const stressed = n.stress >= 0.32
                      return (
                        <g key={key}>
                          {stressed && (
                            <circle cx={cx} cy={cy} r={60} fill={n.color} opacity={0.07} />
                          )}
                          <circle cx={cx} cy={cy} r={47}
                            fill="rgba(13,17,23,0.95)"
                            stroke={n.color}
                            strokeWidth={stressed ? 2.5 : 1.5}
                          />
                          {(() => {
                            const [line1, line2] = splitTransmissionNodeLabel(getTransmissionNodeLabel(key, n))
                            return (
                              <>
                                <text x={cx} y={cy - 12} textAnchor="middle"
                                  fontSize={8.5} fontWeight={700} fill={n.color}
                                  style={{ textTransform: 'uppercase' as const, letterSpacing: 0.35 }}>
                                  {line1}
                                </text>
                                {line2 && (
                                  <text x={cx} y={cy - 2} textAnchor="middle"
                                    fontSize={8.5} fontWeight={700} fill={n.color}
                                    style={{ textTransform: 'uppercase' as const, letterSpacing: 0.35 }}>
                                    {line2}
                                  </text>
                                )}
                              </>
                            )
                          })()}
                          <text x={cx} y={cy + 10} textAnchor="middle"
                            fontSize={14} fontWeight={800} fill={n.color}>
                            {Math.round(n.stress * 100)}%
                          </text>
                          <text x={cx} y={cy + 28} textAnchor="middle"
                            fontSize={10.5} fill="#cbd5e1">
                            {getTransmissionNodeStatus(key, n)}
                          </text>
                        </g>
                      )
                    })}
                  </svg>

                  {/* Active paths */}
                  {gt.active_paths.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 8 }}>
                      <span style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700, alignSelf: 'center', marginRight: 4 }}>
                        Active
                      </span>
                      {gt.active_paths.map((path, idx) => (
                        <span key={idx} style={{
                          fontSize: '0.75rem', fontWeight: 600,
                          color: gt.transmission_color,
                          background: gt.transmission_color + '15',
                          border: `1px solid ${gt.transmission_color}33`,
                          borderRadius: 5, padding: '2px 8px',
                        }}>{getTransmissionPathLabel(path)}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}


            {/* ── AI Insight: Context ── */}
            {(() => {
              const lvl3 = data.current.level ?? 1
              const cr3  = data.signal_analysis?.conditional_returns?.[String(lvl3)]
              const sim3 = data.event_similarity
              const LVL3: Record<number, string> = {0:'Normal',1:'Caution',2:'Warning',3:'High Risk',4:'Crisis'}
              const lvlLbl3 = LVL3[lvl3] ?? String(lvl3)
              if (!cr3 && (!sim3 || sim3.length === 0)) return null
              const med3  = cr3?.median
              const p10_3 = cr3?.p10
              const p90_3 = cr3?.p90
              const n3    = cr3?.n ?? 0
              const pr3   = cr3?.pos_rate ?? null
              const oCol3 = med3 == null ? '#94a3b8'
                : med3 > 3 ? '#22c55e' : med3 > 0 ? '#86efac' : med3 > -3 ? '#f59e0b' : '#ef4444'
              const oLbl3 = med3 == null ? '데이터 없음'
                : med3 > 3 ? `강세 편향 (중앙값 +${med3.toFixed(1)}%)`
                : med3 > 0 ? `소폭 상승 편향 (중앙값 +${med3.toFixed(1)}%)`
                : med3 > -3 ? `약세 편향 (중앙값 ${med3.toFixed(1)}%)`
                : `강한 약세 편향 (중앙값 ${med3.toFixed(1)}%)`
              const top3 = sim3?.[0]
              const insight3 = lvl3 <= 1
                ? `현재 레벨(${lvlLbl3})의 역사적 21일 수익률은 긍정적인 편입니다. 과도한 방어보다 현 포지션을 유지하세요.`
                : lvl3 <= 2
                  ? `경고 구간(${lvlLbl3})입니다. 하방 위험(P10: ${p10_3?.toFixed(1) ?? '--'}%)을 고려해 포지션 크기를 점검하세요.`
                  : `고위험 구간(${lvlLbl3})입니다. 역사적 최악 케이스(${p10_3?.toFixed(1) ?? '--'}%)에 대비한 방어 설정이 필요합니다.`
              return (
                <div style={{
                  background: 'rgba(165,180,252,0.05)',
                  border: '1px solid rgba(165,180,252,0.2)',
                  borderLeft: `3px solid ${oCol3}`,
                  borderRadius: 10, padding: '0.85rem 1.1rem',
                  display: 'flex', flexDirection: 'column', gap: 7,
                  marginTop: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(165,180,252,0.15)', borderRadius: 4, padding: '1px 7px' }}>{pickLang(uiLang, 'AI 인사이트', 'AI Insight')}</span>
                    <span style={{ fontSize: '0.8rem', color: oCol3, fontWeight: 600 }}>21일 전망: {oLbl3}</span>
                    <span style={{ fontSize: '0.72rem', color: '#475569' }}>Level {lvl3} ({lvlLbl3}) · n={n3}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[
                      cr3 && `• 21일 수익률 분포: P10=${p10_3?.toFixed(1) ?? '--'}% | 중앙값=${med3?.toFixed(1) ?? '--'}% | P90=${p90_3?.toFixed(1) ?? '--'}%`,
                      (cr3 && pr3 != null) && `• 역사적 상승 확률: ${pr3}% (${n3}개 케이스 기준)`,
                      top3 && `• 가장 유사한 과거 구간: ${top3.name} (유사도 ${top3.similarity_pct}%)`,
                    ].filter(Boolean).map((b, i) => (
                      <span key={i} style={{ fontSize: '0.77rem', color: '#94a3b8', lineHeight: 1.5 }}>{b as string}</span>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid rgba(165,180,252,0.12)', paddingTop: 5, fontSize: '0.78rem', color: '#cbd5e1' }}>
                    <span style={{ color: '#a5b4fc', fontWeight: 700 }}>구독자 시사점: </span>{insight3}
                  </div>
                </div>
              )
            })()}
            </>}
          </div>
        )
      })()}

      {ovTab === 4 && <div style={{ display:'flex', flexDirection:'column', gap:'1.3rem' }}>

        {cur90ChartPts.length > 0 && (
          <>
            {/* Cur90 section title */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, paddingBottom:2 }}>
              <div>
                <div style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:'1.15rem', fontWeight:900, color:'#fb923c', letterSpacing:'0.09em', textTransform:'uppercase' }}>
                  <span style={{ width:8, height:8, borderRadius:999, background:'#fb923c', boxShadow:'0 0 0 5px rgba(251,146,60,0.16)' }} />
                  LIVE
                </div>
                <div style={{ fontSize:'0.78rem', color:'#94a3b8', marginTop:4, letterSpacing:'0.03em' }}>
                  {cur90ChartPts[0]?.d} → {cur90ChartPts[cur90ChartPts.length-1]?.d} &nbsp;·&nbsp; Live window
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                {cur90Zone && (
                  <span style={{ fontSize:'0.75rem', fontWeight:700, color: cur90Zone.color,
                    background: cur90Zone.color + '18', border: `1px solid ${cur90Zone.color}44`,
                    borderRadius:6, padding:'3px 10px', letterSpacing:'0.06em', textTransform:'uppercase' }}>
                    {cur90Zone.label}
                  </span>
                )}
                <span style={{ fontSize:'0.82rem', color:'#94a3b8' }}>
                  MSS&nbsp;<strong style={{ color:'#e2e8f0' }}>{cur90Latest?.score?.toFixed(1) ?? '--'}</strong>
                </span>
                <span style={{ fontSize:'0.82rem', color:'#94a3b8' }}>
                  QQQ DD&nbsp;<strong style={{ color: cur90Latest?.dd_rel != null && cur90Latest.dd_rel < 0 ? '#ef4444' : '#22c55e' }}>
                    {cur90Latest?.dd_rel != null ? `${cur90Latest.dd_rel.toFixed(1)}%` : '--'}
                  </strong>
                </span>
              </div>
            </div>


            {/* ── AI Insight: LIVE ── */}
            {(() => {
              const firstPt4   = cur90ChartPts[0]
              const lastScore4 = cur90Latest?.score
              const firstScore4 = firstPt4?.score
              const change4     = (firstScore4 != null && lastScore4 != null) ? lastScore4 - firstScore4 : null
              const trending4   = change4 == null ? 'flat' : change4 > 3 ? 'up' : change4 < -3 ? 'down' : 'flat'
              const tColor4 = trending4 === 'up' ? '#22c55e' : trending4 === 'down' ? '#ef4444' : '#f59e0b'
              const tLabel4 = trending4 === 'up' ? '개선 중' : trending4 === 'down' ? '악화 중' : '보합세'
              const mssVal4 = lastScore4?.toFixed(1) ?? '--'
              const ddVal4  = cur90Latest?.dd_rel?.toFixed(1) ?? '--'
              const near100 = lastScore4 != null && Math.abs(lastScore4 - 100) < 5
              const near110 = lastScore4 != null && Math.abs(lastScore4 - 110) < 5
              const nextLine4 = (lastScore4 ?? 0) > 100 ? 100 : 110
               const insight4 = trending4 === 'up' && (lastScore4 ?? 0) >= 100
                 ? `LIVE MSS가 ${change4 != null ? `+${change4.toFixed(1)}pt` : ''} 개선되었습니다. 구조가 강화되고 있으니 공격 전환은 가능하지만 100선 유지 여부를 계속 확인하세요.`
                 : trending4 === 'down' && (lastScore4 ?? 0) < 100
                   ? `LIVE MSS가 ${change4 != null ? `${change4.toFixed(1)}pt` : ''} 하락했습니다. 100 아래에서는 방어적 포지션을 유지하세요.`
                   : (near100 || near110)
                     ? `LIVE MSS ${mssVal4}는 경계 구간입니다. 현재 레벨을 확인하면서 노출을 보수적으로 유지하세요.`
                     : `LIVE MSS ${mssVal4}는 중립 구간입니다. 다음 기준선 ${nextLine4}pt를 주시하세요.`
              return (
                <div style={{
                  background: 'rgba(165,180,252,0.05)',
                  border: '1px solid rgba(165,180,252,0.2)',
                  borderLeft: `3px solid ${tColor4}`,
                  borderRadius: 10, padding: '0.85rem 1.1rem',
                  display: 'flex', flexDirection: 'column', gap: 7,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(165,180,252,0.15)', borderRadius: 4, padding: '1px 7px' }}>{pickLang(uiLang, 'AI 인사이트', 'AI Insight')}</span>
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#fb923c', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(251,146,60,0.14)', borderRadius: 4, padding: '1px 7px' }}>LIVE</span>
                    <span style={{ fontSize: '0.8rem', color: tColor4, fontWeight: 600 }}>{pickLang(uiLang, 'LIVE MSS 추세:', 'LIVE MSS Trend:')} {tLabel4}</span>
                    {change4 != null && (
                      <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                        {firstScore4?.toFixed(1)} → {mssVal4} ({change4 >= 0 ? '+' : ''}{change4.toFixed(1)}pt)
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[
                      `• 현재 MSS: ${mssVal4} — 구간: ${cur90Zone?.label ?? '--'}`,
                      `• QQQ 기간 내 최대낙폭: ${ddVal4}%`,
                      (near100 || near110)
                        ? `• ⚠ 주요 경계선 근처 — MSS ${near100 ? '100' : '110'} 돌파 여부 주시`
                        : `• 다음 주요 경계선: ${nextLine4}pt`,
                    ].map((b, i) => (
                      <span key={i} style={{ fontSize: '0.77rem', color: '#94a3b8', lineHeight: 1.5 }}>{b}</span>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid rgba(165,180,252,0.12)', paddingTop: 5, fontSize: '0.78rem', color: '#cbd5e1' }}>
                    <span style={{ color: '#a5b4fc', fontWeight: 700 }}>LIVE </span>{insight4}
                  </div>
                </div>
              )
            })()}
            {/* Cur90 Panel 3: MSS Score / Risk View */}
            <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:'0.91rem 1.04rem' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
                <div>
                  <div style={{ fontSize: '1.12rem', fontWeight:800, color:'#e5e7eb' }}>
                    {chartMode === 'risk' ? 'Risk Intensity - Live Window' : 'Market Structure Score (MSS) - Live Window'}
                  </div>
                  <div style={{ fontSize: '0.99rem', color:'#e5e7eb', marginTop:4 }}>
                    {chartMode === 'risk' ? 'Higher = more danger (inverted from MSS)' : '100 = structural baseline'}
                  </div>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  {(['score','risk','compare','long-term'] as const).map((m) => {
                    const on = chartMode === m
                    const label = m === 'score' ? 'Score View' : m === 'risk' ? 'Risk View' : m === 'compare' ? 'Compare' : 'Full History'
                    return (
                      <button key={m} onClick={() => setChartMode(m)} style={{
                        padding:'0.3rem 0.7rem', borderRadius:999,
                        border: on ? '1px solid rgba(34,211,238,0.55)' : '1px solid rgba(255,255,255,0.08)',
                        background: on ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.02)',
                        color: on ? '#99f6e4' : '#e5e7eb', fontSize: '0.95rem', fontWeight:700,
                      }}>{label}</button>
                    )
                  })}
                </div>
              </div>
              <div style={{ fontSize: '0.99rem', color:'#e5e7eb', marginTop:6, lineHeight:1.6 }}>
                {chartMode === 'long-term'
                  ? 'Full MSS history (1999-present) with historical crisis periods overlaid. Shaded = known crisis events.'
                  : chartMode === 'risk'
                    ? 'Risk Intensity is the inverted view of MSS, designed for users who prefer higher values to represent higher danger.'
                    : 'Market Structure Score (MSS) measures how healthy the market structure is relative to its long-term baseline. Higher = stronger, lower = riskier.'}
              </div>
              {/* Long-term MSS history with crisis overlays */}
              {chartMode === 'long-term' && (
                ltLoading
                  ? <div style={{ textAlign:'center', padding:40, color:'#9ca3af', fontSize:'0.9rem' }}>Loading full history...</div>
                  : ltPts.length === 0
                    ? <div style={{ textAlign:'center', padding:40, color:'#6b7280', fontSize:'0.9rem' }}>No data ??run build_risk_v1.py</div>
                    : <>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:6, marginTop:4 }}>
                          {CRISIS_OVERLAYS.map(co => (
                            <span key={co.label} style={{
                              fontSize:'0.72rem', fontWeight:700, color: co.color,
                              background: co.fill, borderRadius:4, padding:'2px 7px',
                              border: `1px solid ${co.color}44`,
                            }}>{co.label}</span>
                          ))}
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                          <ComposedChart data={ltPts} margin={{ top:4, right:48, left:0, bottom:0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis
                              dataKey="d"
                              tick={{ fontSize:10, fill:'#9ca3af' }}
                              ticks={ltAxisTicks}
                              interval={0}
                              tickFormatter={(d:string) => (d === ltLastDate ? d.slice(2) : d.slice(0,4))}
                            />
                            <YAxis
                              domain={[40, 130]}
                              ticks={ltYTicks}
                              tick={{ fontSize:11, fill:'#e5e7eb' }}
                              tickFormatter={(v:number) => (Number.isInteger(v) ? `${v}` : v.toFixed(1))}
                              width={34}
                            />
                            <Tooltip contentStyle={{ background:'#1c1f26', border:'1px solid rgba(255,255,255,0.1)', fontSize:'0.95rem', borderRadius:6 }}
                              formatter={(v:number) => [v?.toFixed(1), 'MSS']}
                              labelFormatter={(d:string) => d} />
                            {MSS_ZONES.map((z) => (
                              <ReferenceArea key={`zone-${z.key}`} y1={z.min} y2={z.max} fill={z.fill} strokeOpacity={0} />
                            ))}
                            {CRISIS_OVERLAYS.map(co => (
                              <ReferenceArea key={co.label} x1={co.x1} x2={co.x2}
                                fill={co.fill} strokeOpacity={0} />
                            ))}
                            {CRISIS_OVERLAYS.map(co => (
                              <ReferenceLine
                                key={`overlay-label-${co.label}`}
                                x={'labelX' in co ? co.labelX : co.x1}
                                stroke="rgba(0,0,0,0)"
                                label={{ value: co.label, position:'insideTopLeft', fill: co.color, fontSize:9, fontWeight:700 }}
                              />
                            ))}
                            <ReferenceLine y={100} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 2" />
                            {ltLatestScore != null && Number.isFinite(ltLatestScore) && (
                              <ReferenceLine
                                y={ltLatestScore}
                                stroke="#ef4444"
                                strokeWidth={1.6}
                                strokeDasharray="4 2"
                                label={{ value: `Latest ${ltLatestScore.toFixed(1)}`, position: 'right', fill: '#ef4444', fontSize: 10, fontWeight: 700 }}
                              />
                            )}
                            <Line dataKey="s" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="MSS" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </>
              )}
              {chartMode !== 'long-term' && <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={cur90ChartPts} margin={{ top:4, right:48, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#e5e7eb' }} ticks={cur90AxisTicks} interval={0} />
                  {chartMode !== 'risk' && (
                    <YAxis yAxisId="score" domain={[60, 130]} tick={{ fontSize: 12, fill: '#e5e7eb' }} width={28} />
                  )}
                  {chartMode === 'risk' && (
                    <YAxis yAxisId="risk" domain={[0, 60]} tick={{ fontSize: 12, fill: '#e5e7eb' }} width={28} />
                  )}
                  {chartMode === 'compare' && (
                    <YAxis yAxisId="risk" orientation="right" domain={[0, 60]} tick={{ fontSize: 12, fill: '#e5e7eb' }} width={28} />
                  )}
                  <Tooltip contentStyle={{ background:'#1c1f26', border:'1px solid rgba(255,255,255,0.1)', fontSize: '1.1rem', borderRadius:6 }}
                    formatter={(v:number) => v?.toFixed(1)} />
                  {chartMode !== 'risk' && MSS_ZONES.map((z) => (
                    <ReferenceArea key={`zone-${z.key}`} yAxisId="score" y1={z.min} y2={z.max} fill={z.fill} strokeOpacity={0} />
                  ))}
                  {chartMode === 'risk' && RISK_ZONES.map((z) => (
                    <ReferenceArea key={`rzone-${z.label}`} yAxisId="risk" y1={z.min} y2={z.max} fill={z.fill} strokeOpacity={0} />
                  ))}
                  {chartMode !== 'risk' && MSS_ZONES.map((z) => (
                    <ReferenceLine key={`label-${z.key}`} yAxisId="score" y={(z.min + z.max) / 2} stroke="rgba(255,255,255,0.06)" label={{ value: z.label, fill: z.color, fontSize: 10, position: 'right' }} />
                  ))}
                  {chartMode === 'risk' && RISK_ZONES.map((z) => (
                    <ReferenceLine key={`rlabel-${z.label}`} yAxisId="risk" y={(z.min + z.max) / 2} stroke="rgba(255,255,255,0.06)" label={{ value: z.label, fill: z.color, fontSize: 10, position: 'right' }} />
                  ))}
                  {chartMode !== 'risk' && (
                    <ReferenceLine yAxisId="score" y={100} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 2" />
                  )}
                  {chartMode === 'score' && (
                    <>
                      <Line yAxisId="score" dataKey="score" stroke="#22d3ee" strokeWidth={1.9} dot={false} name="MSS" />
                      {cur90Latest?.score != null && (
                        <ReferenceDot yAxisId="score" x={cur90Latest.label} y={cur90Latest.score} r={4} fill="#22d3ee" stroke="#ffffff" strokeWidth={1} />
                      )}
                    </>
                  )}
                  {chartMode === 'risk' && (
                    <>
                      <Line yAxisId="risk" dataKey="risk_intensity" stroke="#ef4444" strokeWidth={1.9} dot={false} name="Risk Intensity" />
                      {cur90Latest?.risk_intensity != null && (
                        <ReferenceDot yAxisId="risk" x={cur90Latest.label} y={cur90Latest.risk_intensity} r={4} fill="#ef4444" stroke="#ffffff" strokeWidth={1} />
                      )}
                    </>
                  )}
                  {chartMode === 'compare' && (
                    <>
                      <Line yAxisId="score" dataKey="score" stroke="#22d3ee" strokeWidth={1.7} dot={false} name="MSS (health)" />
                      <Line yAxisId="risk" dataKey="risk_intensity" stroke="#ef4444" strokeWidth={1.7} dot={false} name="Risk Intensity" />
                      <Legend verticalAlign="top" align="right" height={24} wrapperStyle={{ color:'#e5e7eb', fontSize: '0.88rem' }} />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginTop:10 }}>
                {[
                  { label:'Current MSS', value: cur90Latest?.score != null ? cur90Latest.score.toFixed(1) : '--', color:'#a5b4fc' },
                  { label:'Current Zone', value: cur90Zone?.label ?? '--', color: cur90Zone?.color ?? '#e5e7eb' },
                  { label:'Recommended Exposure', value: cur90Exposure, color:'#e5e7eb' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background:'rgba(255,255,255,0.03)', borderRadius:8, padding:'0.52rem 0.65rem' }}>
                    <div style={{ fontSize: '0.95rem', color:'#e5e7eb', marginBottom:2 }}>{label}</div>
                    <div style={{ fontSize:'1.02rem', fontWeight:800, color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cur90 Panel 1: QQQ + MA50 + MA200 */}
            <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:'0.91rem 1.04rem' }}>
              <div style={{ fontSize: '1.06rem', color:'#e5e7eb', marginBottom:8 }}>QQQ + MA50 + MA200 (base=100) - Live</div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={cur90ChartPts} margin={{ top:4, right:48, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#e5e7eb' }} ticks={cur90AxisTicks} interval={0} />
                  <YAxis tick={{ fontSize: 12, fill: '#e5e7eb' }} domain={['auto','auto']} width={32} />
                  <Tooltip contentStyle={{ background:'#1c1f26', border:'1px solid rgba(255,255,255,0.1)', fontSize: '1.1rem', borderRadius:6 }}
                    formatter={(v:number) => v?.toFixed(1)} />
                  <ReferenceLine y={100} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 2" />
                  <Line dataKey="qqq_n"   stroke="#e5e7eb" strokeWidth={1.5} dot={false} name="QQQ" />
                  <Line dataKey="ma50_n"  stroke="#60a5fa" strokeWidth={1}   dot={false} name="MA50"  strokeDasharray="4 2" />
                  <Line dataKey="ma200_n" stroke="#fb923c" strokeWidth={1}   dot={false} name="MA200" strokeDasharray="4 2" />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ fontSize: '0.99rem', color:'#e5e7eb', marginTop:4 }}>Legend: QQQ / MA50 / MA200</div>
            </div>

            {/* Cur90 Panel 2: QQQ DD + TQQQ DD */}
            <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:'0.91rem 1.04rem' }}>
              <div style={{ fontSize: '1.06rem', color:'#e5e7eb', marginBottom:8 }}>Window-relative drawdown (QQQ % vs TQQQ DD) - Live</div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={cur90ChartPts} margin={{ top:4, right:48, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#e5e7eb' }} ticks={cur90AxisTicks} interval={0} />
                  <YAxis tick={{ fontSize: 12, fill: '#e5e7eb' }} tickFormatter={(v) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background:'#1c1f26', border:'1px solid rgba(255,255,255,0.1)', fontSize: '1.1rem', borderRadius:6 }}
                    formatter={(v:number) => `${v?.toFixed(2)}%`} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />
                  <Area dataKey="dd_rel"      stroke="#ef4444" fill="rgba(239,68,68,0.15)" strokeWidth={1.5} dot={false} name="QQQ DD" />
                  <Area dataKey="tqqq_dd_rel" stroke="#a78bfa" fill="rgba(167,139,250,0.10)" strokeWidth={1.5} dot={false} name="TQQQ DD" />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ fontSize: '0.99rem', color:'#e5e7eb', marginTop:4 }}>Legend: QQQ DD / TQQQ DD</div>
            </div>

          </>
        )}
      </div>}

      {/* Context History Charts (SPY and Rotation) */}
      {ovTab === 4 && data.context_history && data.context_history.length > 0 && (() => {
        const ch = data.context_history!
        const historyTicks = buildAxisTicks(ch, 'date', 6)
        const formatHistoryDate = (d: unknown) => typeof d === 'string' ? d.slice(2) : ''
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* QQQ vs MA200 */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.91rem 1.04rem' }}>
              <div style={{ fontSize: '1.06rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>QQQ Core Structure — Live</div>
              <div style={{ fontSize: '0.95rem', color: '#e5e7eb', marginBottom: 8 }}>QQQ distance from MA200 (%) - positive = above MA200</div>
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={ch} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} ticks={historyTicks} interval={0} tickFormatter={formatHistoryDate} />
                  <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={30} />
                  <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.06rem', borderRadius: 6 }}
                    formatter={(v: number) => [`${v?.toFixed(2)}%`, 'QQQ vs MA200']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="3 2" />
                  <ReferenceLine y={-5} stroke="#ef4444" strokeDasharray="2 3" strokeWidth={0.8} label={{ value: '-5%', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                  <Area dataKey="qqq_vs_ma200" stroke="#a78bfa" fill="rgba(167,139,250,0.14)" strokeWidth={1.5} dot={false} name="QQQ vs MA200" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* SPY vs MA200 */}
            <div style={{ display: 'none', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.91rem 1.04rem' }}>
              <div style={{ fontSize: '1.06rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>SPY Broad Market Context — Live</div>
              <div style={{ fontSize: '0.95rem', color: '#e5e7eb', marginBottom: 8 }}>SPY distance from MA200 (%) - positive = above MA200</div>
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={ch} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} ticks={historyTicks} interval={0} tickFormatter={formatHistoryDate} />
                  <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={30} />
                  <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.06rem', borderRadius: 6 }}
                    formatter={(v: number) => [`${v?.toFixed(2)}%`, 'SPY vs MA200']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="3 2" />
                  <ReferenceLine y={-5} stroke="#ef4444" strokeDasharray="2 3" strokeWidth={0.8} label={{ value: '-5%', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                  <Area dataKey="spy_vs_ma200" stroke="#60a5fa" fill="rgba(96,165,250,0.15)" strokeWidth={1.5} dot={false} name="SPY vs MA200" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.91rem 1.04rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '1.06rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>Risk Signal Context — Live</div>
                  <div style={{ fontSize: '0.95rem', color: '#e5e7eb' }}>SPY, DIA, and QQQ/SPY rotation in one tabbed view</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {([
                    { key: 'spy', label: 'SPY', color: '#60a5fa' },
                    { key: 'dia', label: 'DIA', color: '#fbbf24' },
                    { key: 'rotation', label: 'QQQ/SPY', color: '#a78bfa' },
                  ] as const).map((tab) => {
                    const on = contextSignalTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setContextSignalTab(tab.key)}
                        style={{
                          cursor: 'pointer',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: on ? tab.color : '#cbd5e1',
                          background: on ? `${tab.color}18` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${on ? tab.color + '44' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 999,
                          padding: '4px 10px',
                        }}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {contextSignalTab === 'spy' && (
                <>
                  <div style={{ fontSize: '0.95rem', color: '#e5e7eb' }}>SPY distance from MA200 (%) - positive = above MA200</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <ComposedChart data={ch} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} ticks={historyTicks} interval={0} tickFormatter={formatHistoryDate} />
                      <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={30} />
                      <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.06rem', borderRadius: 6 }}
                        formatter={(v: number) => [`${v?.toFixed(2)}%`, 'SPY vs MA200']} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="3 2" />
                      <ReferenceLine y={-5} stroke="#ef4444" strokeDasharray="2 3" strokeWidth={0.8} label={{ value: '-5%', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                      <Area dataKey="spy_vs_ma200" stroke="#60a5fa" fill="rgba(96,165,250,0.15)" strokeWidth={1.5} dot={false} name="SPY vs MA200" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </>
              )}
              {contextSignalTab === 'dia' && (
                <>
                  <div style={{ fontSize: '0.95rem', color: '#e5e7eb' }}>DIA distance from MA200 (%) - Dow Jones 30 industrial/cyclical proxy</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <ComposedChart data={ch} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} ticks={historyTicks} interval={0} tickFormatter={formatHistoryDate} />
                      <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={30} />
                      <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.06rem', borderRadius: 6 }}
                        formatter={(v: number) => [`${v?.toFixed(2)}%`, 'DIA vs MA200']} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="3 2" />
                      <ReferenceLine y={-5} stroke="#ef4444" strokeDasharray="2 3" strokeWidth={0.8} label={{ value: '-5%', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                      <Area dataKey="dia_vs_ma200" stroke="#fbbf24" fill="rgba(251,191,36,0.12)" strokeWidth={1.5} dot={false} name="DIA vs MA200" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </>
              )}
              {contextSignalTab === 'rotation' && (
                <>
                  <div style={{ fontSize: '0.95rem', color: '#e5e7eb' }}>100 = window start - rising = Nasdaq leading - falling = rotation away from tech</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <ComposedChart data={ch} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} ticks={historyTicks} interval={0} tickFormatter={formatHistoryDate} />
                      <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} domain={['auto', 'auto']} width={30} />
                      <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.06rem', borderRadius: 6 }}
                        formatter={(v: number) => [v?.toFixed(1), 'RS (base=100)']} />
                      <ReferenceLine y={100} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} strokeDasharray="3 2" />
                      <Line dataKey="rs_n" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="QQQ/SPY RS" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
            {/* DIA Industrial Context */}
            <div style={{ display: 'none', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.91rem 1.04rem' }}>
              <div style={{ fontSize: '1.06rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>DIA Industrial Context — Live</div>
              <div style={{ fontSize: '0.95rem', color: '#e5e7eb', marginBottom: 8 }}>DIA distance from MA200 (%) - Dow Jones 30 industrial/cyclical proxy</div>
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={ch} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} ticks={historyTicks} interval={0} tickFormatter={formatHistoryDate} />
                  <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={30} />
                  <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.06rem', borderRadius: 6 }}
                    formatter={(v: number) => [`${v?.toFixed(2)}%`, 'DIA vs MA200']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="3 2" />
                  <ReferenceLine y={-5} stroke="#ef4444" strokeDasharray="2 3" strokeWidth={0.8} label={{ value: '-5%', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                  <Area dataKey="dia_vs_ma200" stroke="#fbbf24" fill="rgba(251,191,36,0.12)" strokeWidth={1.5} dot={false} name="DIA vs MA200" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* QQQ/SPY Rotation */}
            <div style={{ display: 'none', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.91rem 1.04rem' }}>
              <div style={{ fontSize: '1.06rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>QQQ/SPY Relative Strength — Live</div>
              <div style={{ fontSize: '0.95rem', color: '#e5e7eb', marginBottom: 8 }}>100 = window start - rising = Nasdaq leading - falling = rotation away from tech</div>
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={ch} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} ticks={historyTicks} interval={0} tickFormatter={formatHistoryDate} />
                  <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} domain={['auto', 'auto']} width={30} />
                  <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.06rem', borderRadius: 6 }}
                    formatter={(v: number) => [v?.toFixed(1), 'RS (base=100)']} />
                  <ReferenceLine y={100} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} strokeDasharray="3 2" />
                  <Line dataKey="rs_n" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="QQQ/SPY RS" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })()}

      {/* Disclaimer */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: '0.78rem 1.04rem', fontSize: '1.02rem', color: '#e5e7eb', lineHeight: 1.5 }}>
        ??This system measures risk environment probability ??it does NOT predict market bottoms or tops.
        Like a weather forecast, it describes current conditions to guide exposure decisions.
        Historical backtest results do not guarantee future performance.
      </div>
    </div>
  )
}

// Event Library Tab
function EventLibraryTab({ events }: { events: EventRec[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.1fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr', gap: 6, padding: '0 0.65rem' }}>
        {['Event', 'Type', 'QQQ DD', 'TQQQ DD', '1M', '3M', '6M'].map((h) => (
          <div key={h} style={{ fontSize: '0.99rem', color: '#e5e7eb', fontWeight: 700 }}>{h}</div>
        ))}
      </div>
      {[...events].sort((a, b) => b.start.localeCompare(a.start)).map((ev) => {
        const col = LEVEL_COLORS[ev.peak_level] ?? '#e5e7eb'
        const tCol = TYPE_COLORS[ev.event_type] ?? '#e5e7eb'
        return (
          <div key={ev.id} style={{
            display: 'grid', gridTemplateColumns: '1.6fr 1.1fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr', gap: 6,
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
            borderLeft: `3px solid ${col}`, borderRadius: 8, padding: '0.59rem 0.78rem', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: '1.17rem', fontWeight: 700, color: '#e5e7eb' }}>{ev.name}</div>
              <div style={{ fontSize: '0.99rem', color: '#e5e7eb' }}>
                {ev.start} - {ev.duration_days}d - Score {ev.peak_score} - {ev.level_label}
                {ev.ongoing && <span style={{ color: '#f59e0b' }}> [Ongoing]</span>}
              </div>
            </div>
            <div>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: tCol, background: `${tCol}22`, padding: '0.13rem 0.45rem', borderRadius: 4 }}>
                {ev.event_type}
              </span>
            </div>
            <div style={{ fontSize: '1.23rem', fontWeight: 700, color: ev.qqq_drawdown_pct < -15 ? '#ef4444' : '#f97316' }}>
              {ev.qqq_drawdown_pct.toFixed(1)}%
            </div>
            <div style={{ fontSize: '1.23rem', fontWeight: 700, color: (ev.tqqq_drawdown_pct ?? 0) < -30 ? '#7c3aed' : '#ef4444' }}>
              {ev.tqqq_drawdown_pct != null ? `${ev.tqqq_drawdown_pct.toFixed(1)}%` : '--'}
            </div>
            {[ev.fwd_ret_1m, ev.fwd_ret_3m, ev.fwd_ret_6m].map((r, i) => (
              <div key={i} style={{ fontSize: '1.17rem', fontWeight: 700, color: (r ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                {r != null ? `${r.toFixed(1)}%` : '--'}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// Event Playback Tab
function EventPlaybackTab({ events }: { events: EventRec[] }) {
  const [selId, setSelId] = useState<number>(events[0]?.id ?? 0)
  const [signalTab, setSignalTab] = useState<'mss' | 'risk' | 'both'>('both')
  const [pbData, setPbData] = useState<Record<number, PbPoint[]>>({})
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (fetched) return
    setFetched(true)
    setLoading(true)
    fetch('/api/risk-v1-playback')
      .then((r) => r.json())
      .then((d) => {
        const map: Record<number, PbPoint[]> = {}
        if (d.events) {
          for (const ev of d.events) map[ev.id] = ev.playback
        }
        setPbData(map)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fetched])

  const selEvent = events.find((e) => e.id === selId)
  const pts = pbData[selId] ?? []
  const scoreToRiskBand = (score: number) =>
    score >= 110 ? 110 :
    score >= 100 ? 100 :
    score >= 92 ? 92 :
    score >= 84 ? 84 : 76
  const scoreToRiskLevel = (score: number) =>
    score >= 110 ? 'L0' :
    score >= 100 ? 'L1' :
    score >= 92 ? 'L2' :
    score >= 84 ? 'L3' : 'L4'
  const chartPts = useMemo(() => pts.map((p) => {
    const riskBand = scoreToRiskBand(p.score)
    const riskLevel = scoreToRiskLevel(p.score)
    return {
      ...p,
      label: p.d.slice(2),
      risk_band: riskBand,
      risk_level_label: riskLevel,
    }
  }), [pts])
  const chartTicks = useMemo(() => buildAxisTicks(chartPts, 'label', 10), [chartPts])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.17rem' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {[...events].sort((a, b) => b.start.localeCompare(a.start)).map((ev) => {
          const on = ev.id === selId
          const col = LEVEL_COLORS[ev.peak_level] ?? '#e5e7eb'
          return (
            <button
              key={ev.id}
              onClick={() => setSelId(ev.id)}
              style={{
                padding: '0.26rem 0.72rem',
                borderRadius: 6,
                border: on ? `1px solid ${col}` : '1px solid rgba(255,255,255,0.08)',
                background: on ? `${col}22` : 'rgba(255,255,255,0.02)',
                color: on ? col : '#e5e7eb',
                fontSize: '1.05rem',
                fontWeight: on ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              {ev.name.split('/')[0].trim()}
            </button>
          )
        })}
      </div>

      {loading && <div style={{ color: '#e5e7eb', fontSize: '1.17rem' }}>Loading chart data...</div>}

      {selEvent && (
        <>
          <div style={{ ...card(), borderLeft: `3px solid ${LEVEL_COLORS[selEvent.peak_level]}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: '1.17rem', fontWeight: 700, color: '#e5e7eb' }}>{selEvent.name}</div>
                <div style={{ fontSize: '1.05rem', color: '#e5e7eb', marginTop: 2 }}>
                  {selEvent.start} - {selEvent.end} - {selEvent.duration_days}d - Peak Score {selEvent.peak_score} - {selEvent.level_label}
                </div>
              </div>
              <span
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: TYPE_COLORS[selEvent.event_type] ?? '#e5e7eb',
                  background: `${TYPE_COLORS[selEvent.event_type] ?? '#e5e7eb'}22`,
                  padding: '0.2rem 0.65rem',
                  borderRadius: 6,
                }}
              >
                {selEvent.event_type}
              </span>
            </div>
            <div style={{ marginTop: 8, fontSize: '1.1rem', color: '#e5e7eb', lineHeight: 1.5, fontStyle: 'italic' }}>
              "{selEvent.explanation}"
            </div>
          </div>

          {chartPts.length > 0 ? (
            <>
              <div style={card()}>
                <div style={{ fontSize: '1.06rem', color: '#e5e7eb', marginBottom: 8 }}>Panel 1 - QQQ + MA50 + MA200 (base=100)</div>
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={chartPts} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#e5e7eb' }} ticks={chartTicks} interval={0} />
                    <YAxis tick={{ fontSize: 13, fill: '#e5e7eb' }} domain={['auto', 'auto']} width={32} />
                    <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.1rem', borderRadius: 6 }} formatter={(v: number) => v.toFixed(1)} />
                    <ReferenceLine y={100} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 2" />
                    <Line dataKey="ma200_n" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="MA200" strokeDasharray="4 2" />
                    <Line dataKey="ma50_n" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="MA50" strokeDasharray="4 2" />
                    <Line dataKey="qqq_n" stroke="#e5e7eb" strokeWidth={2} dot={false} name="QQQ" />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ fontSize: '0.99rem', color: '#e5e7eb', marginTop: 4 }}>QQQ with MA50 and MA200 reference lines.</div>
              </div>

              <div style={card()}>
                <div style={{ fontSize: '1.06rem', color: '#e5e7eb', marginBottom: 8 }}>Panel 2 - Drawdown % (QQQ vs TQQQ)</div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartPts} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#e5e7eb' }} ticks={chartTicks} interval={0} />
                    <YAxis domain={['auto', 10]} tick={{ fontSize: 13, fill: '#e5e7eb' }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                    <Tooltip contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.1rem', borderRadius: 6 }} formatter={(v: number) => `${v.toFixed(1)}%`} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                    <Area dataKey="dd" stroke="#ef4444" fill="rgba(239,68,68,0.1)" strokeWidth={1.5} dot={false} name="QQQ DD" />
                    <Area dataKey="tqqq_dd" stroke="#7c3aed" fill="rgba(124,58,237,0.08)" strokeWidth={1.5} dot={false} name="TQQQ DD" />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ fontSize: '0.99rem', color: '#e5e7eb', marginTop: 4 }}>Compare base drawdown with leveraged drawdown acceleration.</div>
              </div>

              <div style={card()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ fontSize: '1.06rem', color: '#e5e7eb' }}>Panel 3 - MSS / Risk / Both</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {([
                      { key: 'mss', label: 'MSS', color: '#e2e8f0' },
                      { key: 'risk', label: 'Risk', color: '#f97316' },
                      { key: 'both', label: 'Both', color: '#60a5fa' },
                    ] as const).map((tab) => {
                      const on = signalTab === tab.key
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setSignalTab(tab.key)}
                          style={{
                            cursor: 'pointer',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            color: on ? tab.color : '#cbd5e1',
                            background: on ? `${tab.color}18` : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${on ? `${tab.color}44` : 'rgba(255,255,255,0.08)'}`,
                            borderRadius: 999,
                            padding: '4px 10px',
                          }}
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={210}>
                  <ComposedChart data={chartPts} margin={{ top: 4, right: 64, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#e5e7eb' }} ticks={chartTicks} interval={0} />
                    <YAxis yAxisId="mss" domain={[68, 132]} ticks={[70, 76, 84, 92, 100, 110, 120, 130]} tick={{ fontSize: 11, fill: '#e5e7eb' }} width={28} />
                    <Tooltip
                      contentStyle={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.1rem', borderRadius: 6 }}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null
                        const row = payload[0]?.payload
                        if (!row) return null
                        return (
                          <div style={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1.1rem', borderRadius: 6, padding: '0.7rem 0.85rem' }}>
                            <div style={{ color: '#f8fafc', marginBottom: 6 }}>{row.d}</div>
                            <div style={{ color: '#e2e8f0', marginBottom: 4 }}>MSS : {Number(row.score).toFixed(1)}</div>
                            <div style={{ color: '#f59e0b' }}>Risk Level : {row.risk_level_label}</div>
                          </div>
                        )
                      }}
                    />
                    <>
                      <ReferenceArea yAxisId="mss" y1={110} y2={132} fill="#22c55e" fillOpacity={0.07} />
                      <ReferenceArea yAxisId="mss" y1={100} y2={110} fill="#f59e0b" fillOpacity={0.09} />
                      <ReferenceArea yAxisId="mss" y1={92} y2={100} fill="#f97316" fillOpacity={0.11} />
                      <ReferenceArea yAxisId="mss" y1={84} y2={92} fill="#ef4444" fillOpacity={0.13} />
                      <ReferenceArea yAxisId="mss" y1={76} y2={84} fill="#7c3aed" fillOpacity={0.13} />
                      <ReferenceArea yAxisId="mss" y1={68} y2={76} fill="#581c87" fillOpacity={0.13} />
                    </>
                    {(() => {
                      const evPts = chartPts.filter((p) => p.in_ev)
                      const x1 = evPts[0]?.label
                      const x2 = evPts[evPts.length - 1]?.label
                      return x1 && x2 ? <ReferenceArea x1={x1} x2={x2} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} /> : null
                    })()}
                    <>
                      <ReferenceLine yAxisId="mss" y={110} stroke="#22c55e" strokeDasharray="3 2" strokeWidth={1} label={{ value: 'L0', fill: '#22c55e', fontSize: 10, position: 'right' }} />
                      <ReferenceLine yAxisId="mss" y={100} stroke="#f59e0b" strokeDasharray="3 2" strokeWidth={1} label={{ value: 'L1', fill: '#f59e0b', fontSize: 10, position: 'right' }} />
                      <ReferenceLine yAxisId="mss" y={92} stroke="#f97316" strokeDasharray="3 2" strokeWidth={1} label={{ value: 'L2', fill: '#f97316', fontSize: 10, position: 'right' }} />
                      <ReferenceLine yAxisId="mss" y={84} stroke="#ef4444" strokeDasharray="3 2" strokeWidth={1} label={{ value: 'L3', fill: '#ef4444', fontSize: 10, position: 'right' }} />
                      <ReferenceLine yAxisId="mss" y={76} stroke="#7c3aed" strokeDasharray="3 2" strokeWidth={1} label={{ value: 'L4', fill: '#7c3aed', fontSize: 10, position: 'right' }} />
                    </>
                    {(signalTab === 'mss' || signalTab === 'both') && (
                      <Line yAxisId="mss" dataKey="score" stroke="#e2e8f0" strokeWidth={2} dot={false} name="MSS" connectNulls />
                    )}
                    {(signalTab === 'risk' || signalTab === 'both') && (
                      <Line yAxisId="mss" type="stepAfter" dataKey="risk_band" stroke="#f59e0b" strokeWidth={2.2} dot={false} name="Risk Level" connectNulls />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: '0.93rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {(signalTab === 'risk' || signalTab === 'both') && (
                    <span style={{ color: '#f97316', fontWeight: 700, marginRight: 6 }}>
                      Risk level line on MSS thresholds
                    </span>
                  )}
                  <span style={{ color: '#22c55e' }}>L0 110+ Normal</span>
                  <span style={{ color: '#f59e0b' }}>L1 100-110 Caution</span>
                  <span style={{ color: '#f97316' }}>L2 92-100 Warning</span>
                  <span style={{ color: '#ef4444' }}>L3 84-92 High Risk</span>
                  <span style={{ color: '#7c3aed' }}>L4 &lt;84 Crisis</span>
                </div>
              </div>
            </>
          ) : (
            !loading && <div style={{ color: '#e5e7eb', fontSize: '1.17rem', padding: '1.3rem' }}>Playback data is loading...</div>
          )}
        </>
      )}

    </div>
  )
}

function SignalAnalysisTab({ data }: { data: RiskV1Data }) {
  const sa = data.signal_analysis
  const [taeSort, setTaeSort] = useState<'lead' | 'strong' | 'score' | 'latest'>('lead')
  if (!sa) return (
    <div style={{ color: '#e5e7eb', padding: '2rem', textAlign: 'center' }}>
      signal_analysis data not available ??re-run build_risk_v1.py
    </div>
  )

  const LEVEL_LABEL: Record<string, string> = {
    '0': 'L0 Normal', '1': 'L1 Caution', '2': 'L2 Warning', '3': 'L3 High Risk', '4': 'L4 Crisis',
  }
  const LEVEL_CLR: Record<string, string> = {
    '0': '#22c55e', '1': '#f59e0b', '2': '#f97316', '3': '#ef4444', '4': '#7c3aed',
  }

  const resultColor = (r: string) =>
    r === 'Good' ? '#22c55e' : r === 'Mixed' ? '#f59e0b' : '#ef4444'
  const leadColor = (v: number | null) =>
    v == null ? '#e5e7eb' : v > 0 ? '#22c55e' : v === 0 ? '#f59e0b' : '#ef4444'
  const pct = (v: number | null) =>
    v == null ? <span style={{ color: '#e5e7eb' }}>--</span> : (
      <span style={{ color: v >= 0 ? '#22c55e' : '#ef4444' }}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</span>
    )
  const taeRows = useMemo(() => {
    const rows = [...(sa.track_a_early?.event_detection ?? [])]
    const byNumber = (a: number | null | undefined, b: number | null | undefined) => {
      const av = a ?? Number.NEGATIVE_INFINITY
      const bv = b ?? Number.NEGATIVE_INFINITY
      return bv - av
    }
    if (taeSort === 'lead') {
      rows.sort((a, b) => byNumber(a.lead_days, b.lead_days))
    } else if (taeSort === 'strong') {
      rows.sort((a, b) => byNumber(a.strong_lead_days, b.strong_lead_days))
    } else if (taeSort === 'score') {
      rows.sort((a, b) => byNumber(a.best_score_window, b.best_score_window))
    } else {
      rows.sort((a, b) => String(b.event_start).localeCompare(String(a.event_start)))
    }
    return rows
  }, [sa.track_a_early?.event_detection, taeSort])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.17rem' }}>

      {/* Section 1: Signal Accuracy Scorecard */}
      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 10 }}>
          Signal Accuracy Scorecard
          <span style={{ fontSize: '0.99rem', color: '#e5e7eb', fontWeight: 400, marginLeft: 8 }}>
            L2+ entry signals (transition from below L2) - QQQ sample since 1999
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { label: 'Signals', value: String(sa.signal_count), color: '#e2e8f0' },
            { label: 'TP Rate', value: `${sa.tp_rate.toFixed(1)}%`, color: sa.tp_rate >= 50 ? '#22c55e' : '#f59e0b',
              sub: `${sa.true_positive} true / ${sa.partial} partial` },
            { label: 'Avg Max Drop 60d', value: `${sa.avg_drop_60d.toFixed(1)}%`, color: '#ef4444' },
            { label: 'False Alarms', value: String(sa.false_alarm),
              color: sa.false_alarm / sa.signal_count < 0.25 ? '#22c55e' : '#f97316',
              sub: `${(sa.false_alarm / sa.signal_count * 100).toFixed(0)}% of signals` },
          ].map(({ label, value, color, sub }) => (
            <div key={label} style={mini()}>
              <div style={{ fontSize: '0.95rem', color: '#e5e7eb', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              {sub && <div style={{ fontSize: '0.9rem', color: '#e5e7eb', marginTop: 3 }}>{sub}</div>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, padding: '0.7rem 0.95rem', background: 'rgba(99,102,241,0.08)', borderRadius: 8, borderLeft: '3px solid #6366f1' }}>
          <div style={{ fontSize: '1.02rem', color: '#c7d2fe', lineHeight: 1.75 }}>
            <strong style={{ color: '#a5b4fc' }}>How to read this section</strong>
            <div style={{ marginTop: 5, color: '#e5e7eb' }}>
              A signal is recorded when MSS first enters <strong style={{ color: '#f97316' }}>L2 (Warning)</strong> or above.
              If QQQ falls at least 3% within 60 days after the signal, it counts as a <strong style={{ color: '#22c55e' }}>True Positive</strong>.
            </div>
            <div style={{ marginTop: 6, color: '#fbbf24' }}>
              This scorecard separates confirmed warnings, partial warnings, and false alarms so you can judge signal quality instead of just signal frequency.
            </div>
            <div style={{ marginTop: 4, color: '#e5e7eb', fontSize: '0.95rem' }}>
              TP = max drop &gt; 3% within 60d &nbsp;|&nbsp; Partial = 0~3% drop &nbsp;|&nbsp; FA = no decline
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Conditional Forward Returns by Level */}
      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 10 }}>
          Conditional Forward Returns (QQQ ~30d) by MSS Level
        </div>
        <div style={{ marginBottom: 12, padding: '0.7rem 0.95rem', background: 'rgba(239,68,68,0.07)', borderRadius: 8, borderLeft: '3px solid #ef4444' }}>
          <div style={{ fontSize: '1.02rem', lineHeight: 1.75 }}>
            <strong style={{ color: '#f87171' }}>Key takeaway: focus on tail risk, not just average returns.</strong>
            <div style={{ marginTop: 5, color: '#e5e7eb' }}>
              Mean and median returns change less than many people expect. The larger difference is usually in downside dispersion.
            </div>
            <div style={{ marginTop: 5, color: '#fca5a5' }}>
              <strong>P10 (worst 10%)</strong> expands materially as regime quality deteriorates, even when average return stays near flat.
            </div>
            <div style={{ marginTop: 5, color: '#e5e7eb', fontSize: '0.95rem' }}>
              This section focuses on <strong style={{ color: '#f87171' }}>tail-risk defense</strong>, not just average return.
              Extreme downside dispersion is often the more important signal.
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.05rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Level', 'N', 'Mean', 'Median', 'Win%', 'P10', 'P90'].map((h) => (
                  <th key={h} style={{ padding: '4px 8px', color: '#e5e7eb', fontWeight: 600,
                    textAlign: h === 'Level' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([0, 1, 2, 3, 4] as const).map((lv) => {
                const cr = sa.conditional_returns[String(lv)]
                if (!cr) return null
                const clr = LEVEL_CLR[String(lv)]
                return (
                  <tr key={lv} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '6px 8px', color: clr, fontWeight: 700 }}>
                      {LEVEL_LABEL[String(lv)]}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#e5e7eb', textAlign: 'right' }}>{cr.n}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right',
                      color: cr.mean >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                      {cr.mean >= 0 ? '+' : ''}{cr.mean.toFixed(2)}%
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right',
                      color: cr.median >= 0 ? '#22c55e' : '#ef4444' }}>
                      {cr.median >= 0 ? '+' : ''}{cr.median.toFixed(2)}%
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right',
                      color: cr.pos_rate >= 60 ? '#22c55e' : cr.pos_rate >= 45 ? '#f59e0b' : '#ef4444' }}>
                      {cr.pos_rate.toFixed(1)}%
                    </td>
                    <td style={{ padding: '6px 8px', color: '#ef4444', textAlign: 'right' }}>
                      {cr.p10.toFixed(1)}%
                    </td>
                    <td style={{ padding: '6px 8px', color: '#22c55e', textAlign: 'right' }}>
                      {cr.p90.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, fontSize: '0.95rem', color: '#e5e7eb' }}>
          Using a 21-trading-day (~30 calendar day) forward window. Full QQQ history since 1999.
        </div>
      </div>

      {/* Section 3: Event Detection Table */}
      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 10 }}>
          Event Detection ??First L2+ Signal Lead Time
        </div>
        <div style={{ marginBottom: 12, padding: '0.6rem 0.9rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: '0.99rem', color: '#e5e7eb', lineHeight: 1.75 }}>
            <strong style={{ color: '#e2e8f0' }}>Lead Days</strong>
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem' }}>
              <span><span style={{ color: '#22c55e', fontWeight: 700 }}>+88d</span> = signal appeared 88 days before the event start</span>
              <span><span style={{ color: '#f97316', fontWeight: 700 }}>0d</span> = signal appeared on the event start date</span>
              <span><span style={{ color: '#ef4444', fontWeight: 700 }}>-Nd</span> = signal appeared after the event had already started</span>
            </div>
            <div style={{ marginTop: 4, color: '#e5e7eb', fontSize: '0.93rem' }}>
              QQQ DD = max QQQ drawdown during the event window | Peak L = highest risk level reached
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.02rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Event', 'Start', 'First Signal', 'Lead Days', 'QQQ DD', 'Peak L'].map((h) => (
                  <th key={h} style={{ padding: '4px 8px', color: '#e5e7eb', fontWeight: 600,
                    textAlign: h === 'Event' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sa.event_detection.slice(0, 20).map((ev) => (
                <tr key={ev.event_start} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '5px 8px', color: '#e2e8f0', maxWidth: 160,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.name}
                  </td>
                  <td style={{ padding: '5px 8px', color: '#e5e7eb', textAlign: 'right' }}>{ev.event_start}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right',
                    color: ev.first_signal ? '#22c55e' : '#e5e7eb' }}>
                    {ev.first_signal ?? '--'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right',
                    color: ev.lead_days != null ? (ev.lead_days > 0 ? '#22c55e' : '#f97316') : '#e5e7eb',
                    fontWeight: 700 }}>
                    {ev.lead_days != null ? `${ev.lead_days > 0 ? '+' : ''}${ev.lead_days}d` : '--'}
                  </td>
                  <td style={{ padding: '5px 8px', color: '#ef4444', textAlign: 'right' }}>
                    {ev.qqq_drawdown.toFixed(1)}%
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right',
                    color: LEVEL_CLR[String(ev.peak_level)] ?? '#e5e7eb' }}>
                    L{ev.peak_level}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      <div style={{ marginTop: 8, fontSize: '0.95rem', color: '#e5e7eb' }}>
          Lead Days = event start ??first L2+ signal. +N = signal fired N days before event peak.
        </div>
      </div>

      {/* Section 4: Track A Early Lead Validation */}
      {sa.track_a_early && (
        <div style={card()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700 }}>
              Track A Early Lead Validation
              <span style={{ fontSize: '0.99rem', color: '#e5e7eb', fontWeight: 400, marginLeft: 8 }}>
                Private credit / financial proxy watch before spread confirmation
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                ['lead', 'Lead'],
                ['strong', 'Strong Lead'],
                ['score', 'Best Score'],
                ['latest', 'Latest'],
              ] as const).map(([key, label]) => {
                const active = taeSort === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTaeSort(key)}
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: active ? '#0f172a' : '#cbd5e1',
                      background: active ? '#fbbf24' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: 999,
                      padding: '5px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'Events With Signal', value: String(sa.track_a_early.events_with_signal), color: '#f59e0b' },
              { label: 'Events With Strong Signal', value: String(sa.track_a_early.events_with_strong_signal), color: '#f97316' },
              {
                label: 'Avg Lead Days',
                value: sa.track_a_early.avg_lead_days != null ? `${sa.track_a_early.avg_lead_days.toFixed(1)}d` : '--',
                color: sa.track_a_early.avg_lead_days != null && sa.track_a_early.avg_lead_days > 0 ? '#22c55e' : '#e5e7eb',
              },
              {
                label: 'Avg Strong Lead',
                value: sa.track_a_early.avg_strong_lead_days != null ? `${sa.track_a_early.avg_strong_lead_days.toFixed(1)}d` : '--',
                color: sa.track_a_early.avg_strong_lead_days != null && sa.track_a_early.avg_strong_lead_days > 0 ? '#22c55e' : '#e5e7eb',
              },
            ].map(({ label, value, color }) => (
              <div key={label} style={mini()}>
                <div style={{ fontSize: '0.95rem', color: '#e5e7eb', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: '1.55rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 12, padding: '0.6rem 0.9rem', background: 'rgba(245,158,11,0.08)', borderRadius: 8, borderLeft: '3px solid #f59e0b' }}>
            <div style={{ fontSize: '0.99rem', color: '#e5e7eb', lineHeight: 1.75 }}>
              <strong style={{ color: '#fbbf24' }}>What this captures</strong>
              <div style={{ marginTop: 4 }}>
                Track A Early focuses on public-market transmission proxies like `BDC/SPY`, `XLF/SPY`, `KRE/SPY`, and `BKLN/HYG` before HY/IG spread confirmation.
              </div>
              <div style={{ marginTop: 4, color: '#fde68a' }}>
                `First Signal` is the first date with `Soft Watch` or higher. `First Strong` is the first date with `Early Watch`.
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.02rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Event', 'Start', 'First Signal', 'Triggered', 'Lead', 'First Strong', 'Strong Lead', 'Best State', 'Best Score'].map((h) => (
                    <th key={h} style={{ padding: '4px 8px', color: '#e5e7eb', fontWeight: 600, textAlign: h === 'Event' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taeRows.slice(0, 12).map((ev) => (
                  <tr key={`${ev.name}-${ev.event_start}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '5px 8px', color: '#e2e8f0', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.name}
                    </td>
                    <td style={{ padding: '5px 8px', color: '#e5e7eb', textAlign: 'right' }}>{ev.event_start}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: ev.first_signal ? '#22c55e' : '#e5e7eb' }}>
                      {ev.first_signal ?? '--'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#cbd5e1', maxWidth: 180 }}>
                      {ev.first_signal_triggered?.length ? (
                        <div
                          title={ev.best_triggered?.length ? `Best window: ${ev.best_triggered.join(', ')}` : undefined}
                          style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}
                        >
                          {ev.first_signal_triggered.map((item) => (
                            <span
                              key={item}
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#fbbf24',
                                background: 'rgba(251,191,36,0.12)',
                                border: '1px solid rgba(251,191,36,0.28)',
                                borderRadius: 999,
                                padding: '2px 7px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : '--'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: leadColor(ev.lead_days), fontWeight: 700 }}>
                      {ev.lead_days != null ? `${ev.lead_days > 0 ? '+' : ''}${ev.lead_days}d` : '--'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: ev.first_strong_signal ? '#f59e0b' : '#e5e7eb' }}>
                      {ev.first_strong_signal ?? '--'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: leadColor(ev.strong_lead_days), fontWeight: 700 }}>
                      {ev.strong_lead_days != null ? `${ev.strong_lead_days > 0 ? '+' : ''}${ev.strong_lead_days}d` : '--'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: ev.best_state_window === 'Early Watch' ? '#f97316' : ev.best_state_window === 'Soft Watch' ? '#f59e0b' : '#e5e7eb' }}>
                      {ev.best_state_window ?? '--'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#e5e7eb' }}>
                      {ev.best_score_window != null ? ev.best_score_window.toFixed(2) : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 5: Signal History Table */}
      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 10 }}>
          Recent Signal History (L2+ Entry ??latest first)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.02rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Date', 'MSS', '30d', '60d', '90d', 'Max Drop 60d', 'Result'].map((h) => (
                  <th key={h} style={{ padding: '4px 8px', color: '#e5e7eb', fontWeight: 600,
                    textAlign: h === 'Date' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sa.signals.map((s) => (
                <tr key={s.date} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '5px 8px', color: '#e5e7eb' }}>{s.date}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right',
                    color: s.mss >= 100 ? '#f59e0b' : s.mss >= 92 ? '#f97316' : '#ef4444', fontWeight: 700 }}>
                    {s.mss.toFixed(1)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{pct(s.ret_30d)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{pct(s.ret_60d)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{pct(s.ret_90d)}</td>
                  <td style={{ padding: '5px 8px', color: '#ef4444', textAlign: 'right', fontWeight: 700 }}>
                    {s.max_drop_60d.toFixed(1)}%
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right',
                    color: resultColor(s.result), fontWeight: 700, fontSize: '1rem' }}>
                    {s.result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: '0.95rem' }}>
          <span style={{ color: '#22c55e' }}><strong>True Positive</strong>: 60d return falls at least 3%</span>
          <span style={{ color: '#f59e0b' }}><strong>Partial</strong>: 60d return is between 0% and -3%</span>
          <span style={{ color: '#ef4444' }}><strong>False Alarm</strong>: no meaningful decline after the signal</span>
          <span style={{ color: '#e5e7eb' }}><strong>--</strong>: 60d outcome is not available yet</span>
        </div>
        <div style={{ marginTop: 6, fontSize: '0.93rem', color: '#e5e7eb' }}>
          30d/60d/90d = QQQ return after the signal | Max Drop 60d = worst drawdown within 60 days after the signal
        </div>
      </div>

    </div>
  )
}

// Methodology Tab
function MethodologyTab({ m, uiLang }: { m: Methodology; uiLang: UiLang }) {
  const L = (ko: string, en: string) => pickLang(uiLang, ko, en)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.17rem' }}>
      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 4 }}>{L('MSS 구성요소 (시장 구조 점수)', 'MSS Components (Market Structure Score)')}</div>
        <div style={{ fontSize: '1.02rem', color: '#e5e7eb', marginBottom: 10 }}>{L('공식: MSS = 100 + TrendAdj + DepthAdj + VolAdj + DDAdj', 'Formula: MSS = 100 + TrendAdj + DepthAdj + VolAdj + DDAdj')}</div>
        {m.score_components.map((c) => (
          <div key={c.name} style={{ marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '1.14rem', fontWeight: 700, color: '#e5e7eb' }}>{c.name}</span>
              <span style={{ fontSize: '1.1rem', color: '#a5b4fc' }}>{c.range ?? (c.weight != null ? `${c.weight}%` : '')}</span>
            </div>
            <div style={{ fontSize: '1.05rem', color: '#e5e7eb', marginTop: 4 }}>{c.desc}</div>
          </div>
        ))}
      </div>

      {m.score_zones && (
      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 10 }}>{L('MSS 점수 구간', 'MSS Score Zones')}</div>
        {m.score_zones.map((z) => {
          const zColor = z.label === 'Strong Bull' || z.label === 'Overheat' ? '#22c55e'
            : z.label === 'Healthy Bull' ? '#86efac'
            : z.label === 'Neutral' ? '#e5e7eb'
            : z.label === 'Soft Risk' ? '#f59e0b'
            : z.label === 'Risk Rising' ? '#f97316'
            : '#ef4444'
          return (
          <div key={z.label} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 64, fontSize: '1.05rem', fontWeight: 700, color: zColor, paddingTop: 2 }}>{getSafeScoreZoneRange(z.label, z.range)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: zColor }}>{z.label}</div>
              <div style={{ fontSize: '1.02rem', color: '#e5e7eb', marginTop: 2 }}>{z.desc}</div>
            </div>
          </div>
          )
        })}
      </div>
      )}

      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 10 }}>{L('레벨 구간 및 익스포저 가이드', 'Level Tiers and Exposure Guide')}</div>
        {m.level_tiers.map((t) => (
          <div key={t.level} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 700, color: t.color }}>{L(`레벨 ${t.level} - ${t.label}`, `Level ${t.level} - ${t.label}`)}</span>
              <span style={{ fontSize: '1.05rem', color: '#e5e7eb' }}> (MSS {t.range})</span>
            </div>
            <div style={{ fontSize: '1.1rem', color: '#e5e7eb' }}>{L(`권장 익스포저 ${t.exposure}%`, `Recommended exposure ${t.exposure}%`)}</div>
          </div>
        ))}
      </div>

      <div style={card()}>
        <div style={{ fontSize: '1.15rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 10 }}>{L('이벤트 타입 분류', 'Event Type Classification')}</div>
        {m.event_types.map((e) => (
          <div key={e.type} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: '1.14rem', fontWeight: 700, color: TYPE_COLORS[e.type] ?? '#e5e7eb' }}>{e.type}</div>
            <div style={{ fontSize: '1.05rem', color: '#e5e7eb', marginTop: 2 }}>{e.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(255,165,0,0.05)', border: '1px solid rgba(255,165,0,0.15)', borderRadius: 8, padding: '0.98rem 1.17rem', fontSize: '1.05rem', color: '#e5e7eb', lineHeight: 1.6 }}>
        <strong style={{ color: '#f59e0b' }}>{L('톤 정책', 'Tone Policy')}</strong><br />
        {L('이 시스템은 설명용이지 예언용이 아닙니다. 날씨 리스크 대시보드처럼 보세요.', 'This system is descriptive, not prophetic. Use it the way you would use a weather risk dashboard.')}<br />
        {L('"환경이 하방 위험을 높인다." - 허용', '"Environment suggests elevated downside risk." - OK')}<br />
        {L('"과거 패턴이 구조적 악화를 시사한다." - 허용', '"Historical pattern indicates structural deterioration." - OK')}<br />
        {L('"시장이 폭락할 것이다." - 금지', '"Market will crash." - Not allowed')}<br />
        {L('"무조건 방어된다." - 금지', '"Guaranteed protection." - Not allowed')}<br />
        <br />
        {m.disclaimer}
      </div>
    </div>
  )
}

// Main
export default function RiskSystemV1({
  data,
  uiLang,
}: {
  data: RiskV1Data
  uiLang: UiLang
}) {
  const [tab, setTab] = useState<Tab>('Overview')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.17rem', WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
      <TabBar tab={tab} setTab={setTab} uiLang={uiLang} />
      {tab === 'Overview'        && <OverviewTab      data={data} uiLang={uiLang} />}
      {tab === 'Event Library'   && <EventLibraryTab  events={data.events} />}
      {tab === 'Event Playback'  && <EventPlaybackTab events={data.events} />}
      {tab === 'Signal Analysis' && <SignalAnalysisTab data={data} />}
      {tab === 'Methodology'     && <MethodologyTab    m={data.methodology} uiLang={uiLang} />}
    </div>
  )
}

