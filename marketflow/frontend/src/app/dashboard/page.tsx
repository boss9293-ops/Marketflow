import fs from 'fs/promises'
import path from 'path'
import Link from 'next/link'
import HotPanel from '@/components/HotPanel'
import BilLabel from '@/components/BilLabel'
import StructurePanel from '@/components/StructurePanel'
import RiskPanel from '@/components/RiskPanel'
import MarketHistoryStrip from '@/components/MarketHistoryStrip'
import RecentAlertsCard from '@/components/RecentAlertsCard'
import AdvancedMetricsDrawer from '@/components/AdvancedMetricsDrawer'
import LanguageModeToggle from '@/components/LanguageModeToggle'
import AIMarketBrief from '@/components/dashboard/AIMarketBrief'
import ActionGuidanceCard from '@/components/dashboard/ActionGuidanceCard'
import TodaySnapshotBar from '@/components/dashboard/TodaySnapshotBar'
import CrossAssetStripCompact from '@/components/dashboard/CrossAssetStripCompact'
import RiskEngineSummaryBar from '@/components/dashboard/RiskEngineSummaryBar'
import type { SmartMoneyCache } from '@/components/SmartMoneyView'
import type { OverviewHomeData } from '@/components/HotPanel'
import type { AlertEvidenceContext } from '@/components/AlertDetailDrawer'
import { readCacheJson } from '@/lib/readCacheJson'
import { accentColorFromLevel, getRiskSecondaryAccents, riskLevelToToken } from '@/lib/riskPalette'

// ── Cache types ───────────────────────────────────────────────────

type SnapshotItem = {
  date: string
  gate_score?: number | null
  market_phase?: string | null
  risk_level?: string | null
  gate_score_10d_avg?: number | null
  gate_delta_5d?: number | null
  risk_trend?: string | null
  phase_shift_flag?: number
}

type SnapshotsCache = { snapshots?: SnapshotItem[] }

type AlertItem = {
  date?: string
  signal_type?: string
  score?: number
  strength?: number
  streak?: number
  status?: string
  severity_label?: 'HIGH' | 'MED' | 'LOW' | string
  regime_label?: 'STRUCTURAL' | 'EVENT' | 'NOISE' | string
  payload_json?: {
    rule?: string | null
    trend?: {
      gate_score?: number | null
      market_phase?: string | null
      risk_level?: string | null
      risk_trend?: string | null
      phase_shift_flag?: number | null
      gate_delta_5d?: number | null
    } | null
  } | null
}

type AlertsCache = { alerts?: AlertItem[] }

type DailyBriefing = {
  data_date?: string | null
  headline?: string | null
  bullets?: { label?: string | null; text?: string | null }[]
  stance?: { action?: string | null; exposure_band?: string | null }
}

type HealthcheckCache = {
  ok?: boolean
  data_date?: string | null
  missing_files?: string[]
  schema_errors?: string[]
  warnings?: string[]
}

type HealthSnapshotCache = {
  data_date?: string | null
  trend?: { dist_pct?: number | null } | null
  risk?: {
    var95_1d?: number | null
    cvar95_1d?: number | null
    vol_ratio?: number | null
  } | null
}

type ActionSnapshotCache = {
  data_date?: string | null
  exposure_guidance?: {
    action_label?: string | null
    exposure_band?: string | null
  } | null
}

type TapeItem = {
  symbol?: string | null
  last?: number | null
  chg_pct?: number | null
  spark_1d?: number[] | null
}
type MarketTapeCache = { items?: TapeItem[] | null }

type SectorPerfItem = {
  symbol?: string | null
  name?: string | null
  change_1d?: number | null
  change_1w?: number | null
}
type SectorRotationCache = { sector_perf?: SectorPerfItem[] | null }

type MacroStateChip = {
  label: string
  value: string
  tone?: 'green' | 'amber' | 'red' | 'blue' | 'neutral'
}

// ── Palette ────────────────────────────────────────────────────────

const C = {
  bull:       '#00C853',
  transition: '#FFB300',
  defensive:  '#FF7043',
  shock:      '#D32F2F',
  neutral:    '#D8E6F5',
} as const

// ── Helpers ────────────────────────────────────────────────────────

function phaseColor(phase?: string | null) {
  if (phase === 'BULL')    return C.bull
  if (phase === 'BEAR')    return C.defensive
  if (phase === 'NEUTRAL') return C.transition
  return C.neutral
}

function riskColor(level?: string | null) {
  if (level === 'LOW')    return C.bull
  if (level === 'MEDIUM') return C.transition
  if (level === 'HIGH')   return C.defensive
  return C.neutral
}

function gateColor(score?: number | null): string {
  if (score == null) return C.neutral
  if (score > 60)    return C.bull
  if (score > 40)    return C.transition
  return C.defensive
}

function severityStyle(s?: string) {
  if (s === 'HIGH') return { color: '#fecaca', bg: `${C.defensive}28`,  border: `${C.defensive}50`  }
  if (s === 'MED')  return { color: '#fde68a', bg: `${C.transition}22`, border: `${C.transition}45` }
  return                   { color: '#bbf7d0', bg: `${C.bull}22`,       border: `${C.bull}45`        }
}

function regimeStyle(r?: string) {
  if (r === 'STRUCTURAL') return { color: '#ddd6fe', bg: 'rgba(139,92,246,0.16)', border: 'rgba(139,92,246,0.32)' }
  if (r === 'EVENT')      return { color: '#fed7aa', bg: 'rgba(249,115,22,0.16)', border: 'rgba(249,115,22,0.32)' }
  return                         { color: '#d1d5db', bg: 'rgba(107,114,128,0.16)',border: 'rgba(107,114,128,0.32)'}
}

function card(extra?: object) {
  return {
    background: '#11161C',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14,
    padding: '1.1rem',
    ...extra,
  } as const
}

function fmtPct(v?: number | null, digits = 2) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function fmtCompact(v?: number | null) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '--'
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (abs >= 100) return v.toFixed(1)
  return v.toFixed(2)
}

function miniSparkPath(pts?: number[] | null) {
  if (!Array.isArray(pts) || pts.length < 2) return null
  const w = 42
  const h = 14
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min || 1
  return pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

async function readOutputJson<T>(filename: string, fallback: T): Promise<T> {
  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', filename),
    path.resolve(process.cwd(), 'backend', 'output', filename),
    path.resolve(process.cwd(), '..', 'output', filename),
    path.resolve(process.cwd(), 'output', filename),
  ]
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, 'utf-8')) as T
    } catch {
      // try next
    }
  }
  return fallback
}

function pickText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if (typeof obj.ko === 'string') return obj.ko
    if (typeof obj.en === 'string') return obj.en
  }
  return null
}

function pickBullets(v: unknown): Array<{ label?: string | null; text?: string | null }> {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if (Array.isArray(obj.ko)) return obj.ko
    if (Array.isArray(obj.en)) return obj.en
  }
  return []
}

const EMPTY_HOME: OverviewHomeData = {
  hot_top5: [], volume_spike_top5: [], ai_picks_top5: [], streak_hot_top10: [],
}
const SMART_FLOW_FALLBACK: SmartMoneyCache = {
  date: null,
  top: [],
  watch: [],
  sectors: { top: [], bottom: [], all: [] },
  coverage: {},
  count: 0,
  data_version: 'smart_money_v1',
  generated_at: null,
  rerun_hint: 'python backend/scripts/build_smart_money.py',
}

// ── Page ──────────────────────────────────────────────────────────

export default async function Dashboard() {
  const [snapshotsData, alertsData, overviewHome, dailyBriefing, healthcheck, healthSnapshot, actionSnapshot, marketTape, smartMoney, sectorRotation] = await Promise.all([
    readCacheJson<SnapshotsCache>('snapshots_120d.json', { snapshots: [] }),
    readCacheJson<AlertsCache>('alerts_recent.json', { alerts: [] }),
    readCacheJson<OverviewHomeData>('overview_home.json', EMPTY_HOME),
    readCacheJson<DailyBriefing>('daily_briefing.json', { bullets: [] }),
    readCacheJson<HealthcheckCache>('healthcheck.json', {}),
    readCacheJson<HealthSnapshotCache>('health_snapshot.json', {}),
    readCacheJson<ActionSnapshotCache>('action_snapshot.json', {}),
    readCacheJson<MarketTapeCache>('market_tape.json', { items: [] }),
    readCacheJson<SmartMoneyCache>('smart_money.json', SMART_FLOW_FALLBACK),
    readOutputJson<SectorRotationCache>('sector_rotation.json', { sector_perf: [] }),
  ])

  const snapshots     = Array.isArray(snapshotsData.snapshots) ? snapshotsData.snapshots : []
  const recent5Market = snapshots.slice(-5).reverse()
  const alerts        = Array.isArray(alertsData.alerts) ? alertsData.alerts : []

  const severityCount = {
    HIGH: alerts.filter((a) => (a.severity_label || '').toUpperCase() === 'HIGH').length,
    MED:  alerts.filter((a) => (a.severity_label || '').toUpperCase() === 'MED').length,
    LOW:  alerts.filter((a) => (a.severity_label || '').toUpperCase() === 'LOW').length,
  }
  const maxStreak = alerts.reduce((m, x) => Math.max(m, Number(x.streak || 0)), 0)
  const latestSnapshot = recent5Market[0] || snapshots[snapshots.length - 1] || null
  const vixLast = Array.isArray(marketTape.items)
    ? (marketTape.items.find((i) => i?.symbol === 'VIX')?.last ?? null)
    : null
  const alertsEvidence: AlertEvidenceContext = {
    gateScore: latestSnapshot?.gate_score ?? null,
    phase: latestSnapshot?.market_phase ?? null,
    riskLabel: latestSnapshot?.risk_level ?? null,
    riskScore: typeof healthSnapshot.risk?.var95_1d === 'number' ? Math.abs(healthSnapshot.risk.var95_1d) * 10 : null,
    vix: typeof vixLast === 'number' ? vixLast : null,
    qqqDistPct: healthSnapshot.trend?.dist_pct ?? null,
    exposureBand: actionSnapshot.exposure_guidance?.exposure_band ?? null,
    asOfDate: actionSnapshot.data_date || healthSnapshot.data_date || latestSnapshot?.date || null,
  }

  // Briefing preview
  const briefingAction   = pickText(dailyBriefing.stance?.action) || null
  const briefingBand     = pickText(dailyBriefing.stance?.exposure_band) || null
  const hcWarnings = healthcheck.warnings || []
  const primaryActionBand = actionSnapshot.exposure_guidance?.exposure_band || briefingBand || null
  const actionBand = primaryActionBand || '60-90%'
  const primaryActionLabel = actionSnapshot.exposure_guidance?.action_label || briefingAction || null
  const distPct = typeof healthSnapshot.trend?.dist_pct === 'number' ? healthSnapshot.trend.dist_pct : null
  const riskProxy = typeof healthSnapshot.risk?.var95_1d === 'number' ? Math.abs(healthSnapshot.risk.var95_1d) * 10 : null
  const var95_1d = typeof healthSnapshot.risk?.var95_1d === 'number' ? healthSnapshot.risk.var95_1d : null
  const cvar95_1d = typeof healthSnapshot.risk?.cvar95_1d === 'number' ? healthSnapshot.risk.cvar95_1d : null
  const volRatio = typeof healthSnapshot.risk?.vol_ratio === 'number' ? healthSnapshot.risk.vol_ratio : null
  const regimeNow = latestSnapshot?.market_phase || (distPct != null ? (distPct > 3 ? 'BULL' : distPct < -3 ? 'DEFENSIVE' : 'TRANSITION') : 'NEUTRAL')
  const vixChg = Array.isArray(marketTape.items)
    ? (marketTape.items.find((i) => i?.symbol === 'VIX')?.chg_pct ?? null)
    : null
  const strategyHeadline = primaryActionLabel === 'Increase'
    ? 'Accumulate'
    : primaryActionLabel === 'Decrease'
    ? 'Defend'
    : 'Rebalance'
  const strategySub = primaryActionLabel === 'Increase'
    ? { ko: '변동성 압축 구간 분할 진입', en: 'Scale into volatility compression' }
    : primaryActionLabel === 'Decrease'
    ? { ko: '리스크 방어 우선시', en: 'Prioritize capital defense' }
    : { ko: '리밸런싱 중심 대기', en: 'Rebalance and wait for confirmation' }
  const actionProgress = primaryActionBand?.match(/(\d+)\D+(\d+)/)
    ? Math.min(100, Math.max(8, Math.round((Number(primaryActionBand.match(/(\d+)\D+(\d+)/)?.[2] || 0)))))
    : 55
  const pulseSymbols = ['SPY', 'QQQ', 'IWM', 'DIA', 'VIX']
  const pulseTiles = pulseSymbols
    .map((sym) => Array.isArray(marketTape.items) ? marketTape.items.find((i) => i?.symbol === sym) : null)
    .filter((x): x is TapeItem => !!x)
  const actionLineKo = primaryActionLabel === 'Increase'
    ? `노출 ${actionBand} 구간으로 점진적으로`
    : primaryActionLabel === 'Decrease'
    ? '자금 안보 개선, 신규 레버리지 진입은 보류'
    : '리밸런싱 중심으로 대기, 급등 추격은 보류'
  const actionLineEn = primaryActionLabel === 'Increase'
    ? `Scale exposure gradually toward ${actionBand}`
    : primaryActionLabel === 'Decrease'
    ? 'Prioritize cash buffer and pause new leveraged entries'
    : 'Stay patient and rebalance; avoid chasing sharp moves'
  const sectorLabelMap: Record<string, string> = {
    XLK: 'Tech',
    XLY: 'Cons Disc',
    XLC: 'Comm Svcs',
    XLF: 'Fin',
    XLI: 'Ind',
    XLE: 'Energy',
    XLV: 'Hlth Care',
    XLU: 'Utils',
    XLP: 'Cons Def',
    XLB: 'Materials',
    XLRE: 'RE',
  }
  const sectorPerfRows = Array.isArray(sectorRotation.sector_perf) ? sectorRotation.sector_perf : []
  const sectorBars = sectorPerfRows
    .map((s) => ({
      key: sectorLabelMap[String(s.symbol || '')] || String(s.symbol || s.name || 'Sector'),
      v: typeof s.change_1w === 'number' ? s.change_1w : (typeof s.change_1d === 'number' ? s.change_1d : null),
    }))
    .filter((x): x is { key: string; v: number } => typeof x.v === 'number' && Number.isFinite(x.v))
    .sort((a, b) => b.v - a.v)
    .slice(0, 11)
  const liquidityState = gateColor(latestSnapshot?.gate_score ?? null) === C.bull ? 'High' : gateColor(latestSnapshot?.gate_score ?? null) === C.transition ? 'Mid' : 'Tight'
  const breadthState = (latestSnapshot?.gate_score ?? 0) >= 60 ? 'Strong' : (latestSnapshot?.gate_score ?? 0) >= 40 ? 'Neutral' : 'Weak'
  const momentumState = distPct == null ? 'Flat' : distPct >= 0 ? 'Pos' : 'Neg'
  const shockProb30d = typeof riskProxy === 'number' ? Math.max(4, Math.min(95, Math.round(riskProxy * 0.55))) : null
  const defensiveTriggerOn = (latestSnapshot?.risk_level || '').toUpperCase() === 'HIGH' || (riskProxy ?? 0) >= 75
  const phaseTransitionText =
    regimeNow === 'BULL' ? 'Accumulation'
    : regimeNow === 'BEAR' || regimeNow === 'DEFENSIVE' ? 'Defense'
    : regimeNow === 'TRANSITION' ? 'Transition'
    : 'Neutral'
  const tailSigma = typeof riskProxy === 'number' ? Math.max(0.6, Math.min(6.2, riskProxy / 9.2)) : null
  const tailSkewLabel = (riskProxy ?? 0) >= 75 ? 'Elevated Skew' : (riskProxy ?? 0) >= 45 ? 'Moderate Skew' : 'Benign Skew'
  const tqqqScore = Math.max(10, Math.min(95, Math.round((distPct ?? 1.8) * 9 + 55 - (riskProxy ?? 25) * 0.35)))
  const soxlScore = Math.max(10, Math.min(95, Math.round((distPct ?? 0.8) * 7 + 52 - (riskProxy ?? 25) * 0.25)))
  const tqqqMode = tqqqScore >= 65 ? { badge: 'CLEAR', color: '#22C55E', line: 'Bullish Trend', lineKo: '상승 추세 유지' } : tqqqScore >= 45 ? { badge: 'WATCH', color: '#FACC15', line: 'Mixed Trend', lineKo: '혼조 추세' } : { badge: 'RISK', color: '#F97316', line: 'Gap Risk', lineKo: '갭 리스크 주의' }
  const soxlMode = soxlScore >= 62 ? { badge: 'CLEAR', color: '#22C55E', line: 'Strong Beta', lineKo: '고베타 강세' } : soxlScore >= 42 ? { badge: 'CHOPPY', color: '#FACC15', line: 'High Beta', lineKo: '변동성 높음' } : { badge: 'RISK', color: '#F97316', line: 'Wide Swings', lineKo: '급등락 주의' }
  const weeklyLeverageForecast = [
    { day: 'Monday', level: (riskProxy ?? 0) > 70 ? 'Medium Risk' : 'Low Risk' },
    { day: 'Tuesday', level: (riskProxy ?? 0) > 65 ? 'Medium Risk' : 'Low Risk' },
    { day: 'Wednesday', level: 'Medium (Fed Minutes)' },
    { day: 'Thursday', level: (riskProxy ?? 0) > 75 ? 'High Risk' : 'Low to Medium' },
    { day: 'Friday', level: (riskProxy ?? 0) > 60 ? 'Medium Risk' : 'Low Risk' },
  ]
  const retirementAllocation = (riskProxy ?? 0) >= 70 ? { eq: 65, safe: 35 } : (riskProxy ?? 0) >= 45 ? { eq: 75, safe: 25 } : { eq: 80, safe: 20 }
  const withdrawalSafe = (riskProxy ?? 0) < 70 && String(regimeNow || '').toUpperCase() !== 'BEAR'
  const riskToken = riskLevelToToken({ riskScore: riskProxy, riskLevel: latestSnapshot?.risk_level ?? null })
  const riskAccents = getRiskSecondaryAccents({
    vixChange1d: vixChg,
    volRatio,
    cvar95: cvar95_1d,
    tailSigma,
    shockProb30d,
  })
  const riskSummaryPills = [
    { label: 'Shock% / 쇼크', value: shockProb30d != null ? `${shockProb30d}%` : '--', tone: accentColorFromLevel(riskAccents.shockStress) },
    { label: 'Defensive / 방어', value: defensiveTriggerOn ? 'ON' : 'OFF', tone: defensiveTriggerOn ? riskToken.colorVar : 'var(--risk-accent-cooling)' },
    { label: 'Phase / 국면', value: phaseTransitionText, tone: riskToken.colorVar },
    { label: 'Tail Sigma / 테일', value: tailSigma != null ? tailSigma.toFixed(1) : '--', tone: accentColorFromLevel(riskAccents.tailStress) },
  ]

  const volState = volRatio == null && vixChg == null
    ? { ko: '확인 필요', en: 'Needs verification', tone: 'neutral' as const }
    : (volRatio != null && volRatio < 0.95) || (typeof vixChg === 'number' && vixChg < 2)
    ? { ko: '안정/압축', en: 'compressing', tone: 'green' as const }
    : (volRatio != null && volRatio > 1.1) || (typeof vixChg === 'number' && vixChg > 5)
    ? { ko: '확장/경계', en: 'expanding', tone: 'amber' as const }
    : { ko: '혼합', en: 'mixed', tone: 'blue' as const }
  const liqStateMap = liquidityState === 'High'
    ? { ko: '양호', en: 'healthy', tone: 'green' as const }
    : liquidityState === 'Mid'
    ? { ko: '보통', en: 'mixed', tone: 'amber' as const }
    : { ko: '타이트', en: 'tight', tone: 'red' as const }
  const breadthStateMap = breadthState === 'Strong'
    ? { ko: '강함', en: 'strong', tone: 'green' as const }
    : breadthState === 'Neutral'
    ? { ko: '혼합', en: 'mixed', tone: 'amber' as const }
    : { ko: '약함', en: 'weak', tone: 'red' as const }
  const ratesState =
    typeof latestSnapshot?.gate_delta_5d === 'number'
      ? latestSnapshot.gate_delta_5d > 3
        ? { en: 'easing', tone: 'green' as const }
        : latestSnapshot.gate_delta_5d < -3
        ? { en: 'tight', tone: 'red' as const }
        : { en: 'steady', tone: 'blue' as const }
      : { en: 'steady', tone: 'neutral' as const }
  const macroState: MacroStateChip[] = [
    { label: 'Liquidity', value: liqStateMap.en, tone: liqStateMap.tone },
    { label: 'Rates', value: ratesState.en, tone: ratesState.tone },
    { label: 'Volatility', value: volState.en, tone: volState.tone },
    { label: 'Breadth', value: breadthStateMap.en, tone: breadthStateMap.tone },
    {
      label: 'Trend',
      value: momentumState === 'Pos' ? 'up' : momentumState === 'Neg' ? 'down' : 'flat',
      tone: momentumState === 'Pos' ? 'green' : momentumState === 'Neg' ? 'red' : 'blue',
    },
  ]
  const phaseCycle =
    regimeNow === 'BULL'
      ? 'EXPAN'
      : regimeNow === 'BEAR' || regimeNow === 'DEFENSIVE'
      ? 'CONTR'
      : regimeNow === 'TRANSITION'
      ? 'SLOW'
      : 'RECOV'
  const actionGuidance = {
    label: strategyHeadline,
    band: actionBand,
    subKo: strategySub.ko,
    subEn: strategySub.en,
    progress: actionProgress,
  }
  const ssot = {
    globalRiskToken: riskToken,
    marketRegime: String(regimeNow || 'TRANSITION'),
    phase: phaseCycle,
    macroState,
    actionGuidance,
  }

  const riskHighNarrative = (riskProxy ?? 0) >= 70 || String(regimeNow).toUpperCase() === 'BEAR' || String(regimeNow).toUpperCase() === 'DEFENSIVE'
  const mixedNarrative = !riskHighNarrative && ((riskProxy ?? 0) >= 45 || latestSnapshot?.phase_shift_flag === 1)
  const narrativeKo = riskHighNarrative
    ? [
        '리스크 보호가 개선되는 구간이며, 단기 변동성 가능성은 염두에 둘 필요가 있습니다.',
        '변동성 상승과 함께 할 경우 수익 추구보다 손실 관리가 더욱 중요해집니다.',
        '확인 신호가 이어지기까지는 신규 레버리지 진입은 보수적으로 보는 것이 합리적입니다.',
      ]
    : mixedNarrative
    ? [
        '현재 국면의 방향이 확정되지 않은 상황에서 혼합 신호 구간입니다.',
        '변동성과 리스크 지속은 관리가 필요하지만 속도 조절이 중요한 상황입니다.',
        '브레이크스루 게이트 조건이 개선되기까지는 분할 접근이 합리적입니다.',
      ]
    : [
        '추세가 아직 지지되지만 내부 지표(Breadth)에 한해 약화 신호가 있습니다.',
        '변동성은 상승보다는 안정 쪽에 가까워져 진입 리스크가 낮아진 구간입니다.',
        '단, 급등이 타이트하면 추격 매수보다 분할 전략이 합리적입니다.',
      ]
  const narrativeEn = riskHighNarrative
    ? [
        'Risk signals are currently dominant, with a higher chance of short-term volatility expansion.',
        'When volatility rises alongside weak internal breadth, drawdown control matters more than return pursuit.',
        'Until confirmation improves, new leveraged entries should be evaluated conservatively.',
      ]
    : mixedNarrative
    ? [
        'The current regime is a mixed-signal zone without full directional confirmation.',
        'Volatility and risk metrics remain manageable, but position speed should stay measured.',
        'A gradual approach is preferred until breadth and gate conditions improve.',
      ]
    : [
        'Markets are holding a constructive uptrend, but internal breadth remains soft.',
        'Volatility is stabilizing rather than expanding, which supports gradual risk-on.',
        'Liquidity is still tight, so we prefer scaling in rather than chasing.',
      ]
  const regimeKoMap: Record<string, string> = {
    BULL: '상승',
    BEAR: '하락',
    DEFENSIVE: '방어',
    TRANSITION: '전환',
    NEUTRAL: '중립',
  }
  const phaseKoMap: Record<string, string> = {
    RECOV: '회복',
    EXPAN: '확장',
    SLOW: '둔화',
    CONTR: '수축',
  }
  const actionKoMap: Record<string, string> = {
    Accumulate: '축적',
    Defend: '방어',
    Rebalance: '리밸런스',
  }
  const regimeKo = regimeKoMap[String(regimeNow || 'TRANSITION')] || String(regimeNow || 'TRANSITION')
  const phaseKo = phaseKoMap[phaseCycle] || phaseCycle
  const actionLabelKo = actionKoMap[strategyHeadline] || strategyHeadline
  const narrativeActionKo = `오늘의 액션: ${actionLineKo}`
  const narrativeActionEn = `Action: ${actionLineEn}`
  const briefLinesKo = [narrativeKo[0], narrativeKo[1], narrativeActionKo]
  const briefLinesEn = [narrativeEn[0], narrativeEn[1], narrativeActionEn]
  const snapshotSummaryKo = `${regimeKo} / ${phaseKo} · ${actionLabelKo} · 리스??${ssot.globalRiskToken.key}`.slice(0, 90)
  const snapshotSummaryEn = `${ssot.marketRegime} / ${ssot.phase} · ${ssot.actionGuidance.label} bias · Risk ${ssot.globalRiskToken.key}`.slice(0, 90)

  const flowSummary = (smartMoney as any)?.smart_flow || {}
  const flowRegime: string = flowSummary.regime || 'Neutral'
  const flowRegimeFit =
    flowRegime === 'Expansion' ? 'High' :
    flowRegime === 'Neutral' ? 'Medium' :
    flowRegime === 'Contraction' ? 'Low' :
    'Very Low'
  const flowShockProb = typeof flowSummary.shock_prob_30d === 'number' ? flowSummary.shock_prob_30d : null
  const flowTailSigma = typeof flowSummary.tail_sigma === 'number' ? flowSummary.tail_sigma : null
  const flowVolRisk =
    (flowShockProb != null && flowShockProb > 0.20) || (flowTailSigma != null && flowTailSigma >= 2.5)
      ? 'High'
      : (flowTailSigma != null && flowTailSigma >= 2.0)
      ? 'Medium'
      : 'Low'
  const environmentFit =
    flowRegimeFit === 'Low' || flowRegimeFit === 'Very Low' || flowVolRisk === 'High'
      ? 'Low'
      : flowRegimeFit === 'High' && flowVolRisk !== 'High'
      ? 'High'
      : 'Medium'

  const structureConfidence =
    environmentFit === 'High' && breadthState === 'Strong' && (flowSummary.acceleration_state === 'Expanding' || flowSummary.acceleration_state == null)
      ? 'High'
      : environmentFit === 'Low' || breadthState === 'Weak'
      ? 'Low'
      : 'Medium'
  const confidenceSubline =
    structureConfidence === 'High'
      ? 'Leaders Confirmed · Breadth Stable · Vol Controlled'
      : structureConfidence === 'Low'
      ? 'Leaders Thin · Breadth Weak · Vol Sensitive'
      : 'Leaders Mixed · Breadth Mixed · Vol Balanced'
  const narrativeChips = [
    { ko: `변동성: ${volState.ko}`, en: `Vol: ${volState.en}`, tone: volState.tone },
    { ko: `유동성: ${liqStateMap.ko}`, en: `Liquidity: ${liqStateMap.en}`, tone: liqStateMap.tone },
    { ko: `시장 확산: ${breadthStateMap.ko}`, en: `Breadth: ${breadthStateMap.en}`, tone: breadthStateMap.tone },
  ]
  const narrativeExplainRows = [
    { keyLabel: 'risk_trend / 리스크 추세', value: latestSnapshot?.risk_trend || '--' },
    { keyLabel: 'gate_score / 게이트 점수', value: latestSnapshot?.gate_score != null ? latestSnapshot.gate_score.toFixed(1) : '--' },
    { keyLabel: 'phase_shift_flag / 국면 전환', value: latestSnapshot?.phase_shift_flag != null ? String(latestSnapshot.phase_shift_flag) : '--' },
    { keyLabel: 'VaR95 (1d) / VaR95', value: var95_1d != null ? `${var95_1d.toFixed(2)}%` : '--' },
    { keyLabel: 'CVaR95 (1d) / CVaR95', value: cvar95_1d != null ? `${cvar95_1d.toFixed(2)}%` : '--' },
    { keyLabel: 'VolRatio / 변동비율', value: volRatio != null ? volRatio.toFixed(2) : '--' },
    { keyLabel: 'VIX tone / VIX 색조', value: riskAccents.vixPulse || 'neutral' },
  ]

  // Healthcheck indicator
  const hcHasData  = typeof healthcheck.ok === 'boolean'
  const hcOk       = healthcheck.ok === true
  const hcColor    = !hcHasData ? C.neutral : hcOk ? (hcWarnings.length ? C.transition : C.bull) : C.defensive
  const hcTitle    = !hcHasData
    ? 'healthcheck.json missing'
    : hcOk && !hcWarnings.length
    ? 'Cache OK'
    : `${hcOk ? 'Cache OK (warnings)' : 'Cache FAILED'} ??${[...healthcheck.missing_files || [], ...healthcheck.schema_errors || []].join(', ') || hcWarnings.join(', ')}`

  // ── Portal Simplify: new derived variables ──
  const riskModeLabel =
    (defensiveTriggerOn && (riskProxy ?? 0) >= 75) ? 'SHOCK' :
    (defensiveTriggerOn || (latestSnapshot?.risk_level || '').toUpperCase() === 'HIGH') ? 'RED' :
    ((latestSnapshot?.risk_level || '').toUpperCase() === 'MEDIUM' || (riskProxy ?? 0) >= 45) ? 'YELLOW' :
    'GREEN'
  const riskModeColor =
    riskModeLabel === 'SHOCK' ? '#D32F2F' :
    riskModeLabel === 'RED' ? '#FF7043' :
    riskModeLabel === 'YELLOW' ? '#FFB300' :
    '#00C853'
  const sectorTop3 = sectorBars.slice(0, 3)
  const sectorBottom3 = sectorBars.length >= 3 ? [...sectorBars].reverse().slice(0, 3) : []
  const rotationPositiveCount = sectorBars.filter(s => s.v > 0).length
  const rotationInterpretation =
    rotationPositiveCount >= 8 ? 'Broad Strength' :
    rotationPositiveCount >= 5 ? 'Selective / Mixed' :
    'Defensive Tilt'
  const rotationToneColor =
    rotationPositiveCount >= 8 ? '#22C55E' :
    rotationPositiveCount >= 5 ? '#FACC15' :
    '#F87171'
  const riskSummaryPillsCompressed = riskSummaryPills.map(p => ({
    ...p,
    value:
      p.label.startsWith('Shock%')
        ? ((shockProb30d ?? 0) >= 60 ? 'HIGH' : (shockProb30d ?? 0) >= 30 ? 'MED' : 'LOW')
        : p.label.startsWith('Tail')
        ? ((tailSigma ?? 0) >= 3 ? 'ELEVATED' : (tailSigma ?? 0) >= 2 ? 'MODERATE' : 'BENIGN')
        : p.value,
  }))
  const sectorLeaders = sectorTop3.map((s) => s.key).join(', ') || '--'
  const sectorLaggards = sectorBottom3.map((s) => s.key).join(', ') || '--'
  const momentumKo = momentumState === 'Pos' ? '상승' : momentumState === 'Neg' ? '약세' : '보합'
  const momentumEn = momentumState === 'Pos' ? 'positive' : momentumState === 'Neg' ? 'negative' : 'flat'
  const vixLevelText = typeof vixLast === 'number' ? vixLast.toFixed(1) : '--'
  const vixChangeText = fmtPct(vixChg, 2)
  const shockText = shockProb30d != null ? `${shockProb30d}%` : '--'
  const tailText = tailSigma != null ? tailSigma.toFixed(1) : '--'
  const todayChanges = [
    {
      ko: `섹터 순환: 강세 ${sectorLeaders} · 약세 ${sectorLaggards}`,
      en: `Sector rotation: leaders ${sectorLeaders} · laggards ${sectorLaggards}`,
    },
    {
      ko: `브레드스: ${breadthStateMap.ko} · 모멘텀 ${momentumKo}`,
      en: `Breadth: ${breadthStateMap.en} · Momentum ${momentumEn}`,
    },
    {
      ko: `VIX ${vixLevelText}${vixChangeText ? ` (${vixChangeText})` : ''}`,
      en: `VIX ${vixLevelText}${vixChangeText ? ` (${vixChangeText})` : ''}`,
    },
    {
      ko: `리스크 드라이버: 충격확률 ${shockText}, 꼬리 ${tailText}, 방어모드 ${defensiveTriggerOn ? 'ON' : 'OFF'}`,
      en: `Risk drivers: Shock ${shockText}, Tail ${tailText}, Defensive ${defensiveTriggerOn ? 'ON' : 'OFF'}`,
    },
  ]

  return (
    <div
      className="mf-dashboard-root px-3 py-4 sm:px-4 sm:py-5 lg:px-6 lg:pb-12"
      style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', overflowX: 'hidden' }}
    >
      {/* ────────────────── PORTAL CARD ────────────────── */}
      <section
        style={{
          background: '#06090D',
          border: '1px solid rgba(148,163,184,0.10)',
          borderRadius: 16,
          padding: '0.7rem 0.85rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          fontFamily: 'var(--font-ui-sans)',
        }}
      >
        {/* Nav row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: '#D7FF37', color: '#0b0f14', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: '0.78rem', boxShadow: '0 0 0 1px rgba(215,255,55,0.25)' }}>C</div>
            <div style={{ color: '#F8FAFC', fontWeight: 800, fontSize: '1.05rem', lineHeight: 1 }}>Capital OS</div>
            <div style={{ color: '#D8E6F5', fontSize: '0.74rem', letterSpacing: '0.08em', fontWeight: 700 }}>INSTITUTIONAL GRADE</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
            <LanguageModeToggle />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {[
              { ko: '시장 상태', en: 'Market State', active: true },
              { ko: '리스크 엔진', en: 'Risk Engine' },
              { ko: '은퇴', en: 'Retirement' },
              { ko: '레버리지', en: 'Leverage' },
            ].map((tab) => (
              <span
                key={tab.en}
                style={{
                  borderRadius: 999,
                  border: tab.active ? '1px solid rgba(215,255,55,0.65)' : '1px solid rgba(255,255,255,0.07)',
                  background: tab.active ? '#D7FF37' : 'rgba(255,255,255,0.02)',
                  padding: '4px 11px',
                  color: tab.active ? '#0B0F14' : '#D8E6F5',
                }}
              >
                <BilLabel ko={tab.ko} en={tab.en} variant="micro" />
              </span>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
              <div style={{ width: 280, maxWidth: '40vw', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '0 12px', display: 'flex', alignItems: 'center', color: '#D8E6F5', fontSize: '0.9rem' }}>
                <span style={{ marginRight: 8 }}>&#128269;</span>
                <span>Search ticker, risk factor...</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
                  <span style={{ color: '#F8FAFC', fontWeight: 800, fontSize: '0.95rem' }}>Alexander V.</span>
                  <span style={{ color: '#D7FF37', fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.06em' }}>PRO ACCOUNT</span>
                </div>
                <span style={{ width: 30, height: 30, borderRadius: 999, background: 'linear-gradient(135deg,#38bdf8,#f472b6)', display: 'inline-block' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Title row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#F8FAFC', fontSize: 'clamp(1.9rem, 3vw, 2.35rem)', fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.02em' }}>Market State</div>
            <div style={{ color: '#D8E6F5', fontSize: '0.82rem', marginTop: 5 }}>
              <BilLabel ko="현재 레지먼 분석과 전략 포지셔닝" en="Current Regime Analysis & Strategic Posture" variant="micro" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <AdvancedMetricsDrawer warnings={hcWarnings}>
              <RecentAlertsCard
                alerts={Array.isArray(alerts) ? alerts : []}
                severityCount={severityCount}
                maxStreak={maxStreak}
                evidence={alertsEvidence}
              />
              <MarketHistoryStrip rows={recent5Market} emptyText="No snapshot data -- run pipeline" />
              <RiskPanel />
              <StructurePanel />
            </AdvancedMetricsDrawer>
            <span style={{ borderRadius: 999, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.24)', padding: '2px 8px', color: '#22C55E' }}>
              <BilLabel ko="실시간 데이터" en="LIVE DATA" variant="micro" />
            </span>
            <span style={{ color: '#D8E6F5', fontSize: '0.76rem' }}>
              {actionSnapshot.data_date || healthSnapshot.data_date || latestSnapshot?.date || '--'}
            </span>
            <span title={hcTitle} style={{ width: 8, height: 8, borderRadius: 999, background: hcColor, border: '1px solid rgba(255,255,255,0.15)' }} />
          </div>
        </div>

        {/* PORTAL BLOCK 1: Structural State Badge Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', paddingTop: '0.05rem' }}>
          {macroState.map((chip) => {
            const tc =
              chip.tone === 'green' ? '#22C55E' :
              chip.tone === 'red'   ? '#F87171' :
              chip.tone === 'amber' ? '#FACC15' :
              chip.tone === 'blue'  ? '#60A5FA' : '#94A3B8'
            return (
              <span
                key={chip.label}
                style={{ borderRadius: 999, border: `1px solid ${tc}44`, background: `${tc}14`, color: tc, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}
              >
                {chip.label}:{chip.value}
              </span>
            )
          })}
          <Link href="/macro" style={{ marginLeft: 'auto', color: '#7DD3FC', fontSize: '0.71rem', fontWeight: 700, textDecoration: 'none' }}>
            Market Health &#8594;
          </Link>
          <span style={{ borderRadius: 999, border: `1px solid ${ssot.globalRiskToken.borderVar}`, background: ssot.globalRiskToken.bgVar, color: ssot.globalRiskToken.colorVar, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 800 }}>
            {ssot.globalRiskToken.key}
          </span>
        </div>

        {/* PORTAL BLOCK 2: Cross-Asset Strip */}
        <CrossAssetStripCompact items={Array.isArray(marketTape.items) ? marketTape.items : []} defaultTab="All" />

        {/* PORTAL BLOCK 2.5: Today Changes */}
        <section
          style={{
            background: '#0B0F14',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: '0.95rem 1.05rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#F8FAFC', fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.06em' }}>Today Changes</div>
              <div style={{ color: '#94A3B8', fontSize: '0.7rem', marginTop: 2 }}>
                <BilLabel ko="시장 변화 요약" en="Market change summary" variant="micro" />
              </div>
            </div>
            <span style={{ color: '#D8E6F5', fontSize: '0.72rem' }}>{alertsEvidence.asOfDate || '--'}</span>
          </div>
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {todayChanges.map((line, idx) => (
              <div key={`${line.en}-${idx}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#D8E6F5', fontSize: '0.82rem', lineHeight: 1.4 }}>
                <span style={{ width: 6, height: 6, marginTop: 6, borderRadius: 999, background: '#D7FF37', boxShadow: '0 0 0 2px rgba(215,255,55,0.15)' }} />
                <BilLabel ko={line.ko} en={line.en} variant="micro" />
              </div>
            ))}
          </div>
        </section>

        {/* PORTAL BLOCK 3 + 4: AI Brief | Decision Panel */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4" style={{ minWidth: 0, alignItems: 'stretch' }}>
          <AIMarketBrief
            linesKo={briefLinesKo}
            linesEn={briefLinesEn}
            environmentFit={environmentFit}
            explainRows={narrativeExplainRows}
          />

          {/* Decision Panel - Risk Mode + Exposure Range only */}
          <section
            style={{
              background: '#0B0F14',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14,
              padding: '1rem 1.1rem',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.9rem',
              justifyContent: 'center',
            }}
          >
            <div style={{ color: '#94A3B8', fontSize: '0.68rem', letterSpacing: '0.07em', fontWeight: 700 }}>
              <BilLabel ko="포지셔닝 결론" en="DECISION PANEL" variant="micro" />
            </div>

            {/* Risk Mode */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ color: '#94A3B8', fontSize: '0.8rem', fontWeight: 600, minWidth: 90 }}>
                <BilLabel ko="리스크 모드" en="Risk Mode" variant="micro" />
              </span>
              <span
                style={{
                  borderRadius: 8,
                  background: `${riskModeColor}22`,
                  border: `1px solid ${riskModeColor}44`,
                  color: riskModeColor,
                  padding: '5px 16px',
                  fontWeight: 800,
                  fontSize: '0.92rem',
                  letterSpacing: '0.05em',
                }}
              >
                {riskModeLabel}
              </span>
            </div>

            {/* Exposure Range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ color: '#94A3B8', fontSize: '0.8rem', fontWeight: 600, minWidth: 90 }}>
                <BilLabel ko="노출 범위" en="Exposure" variant="micro" />
              </span>
              <span style={{ color: '#D7FF37', fontWeight: 900, fontSize: '1.25rem', lineHeight: 1 }}>
                {actionBand}
              </span>
            </div>

            {/* 1-line structural note */}
            <div
              style={{
                borderTop: '1px solid rgba(255,255,255,0.07)',
                paddingTop: '0.55rem',
                color: '#94A3B8',
                fontSize: '0.76rem',
                lineHeight: 1.4,
              }}
            >
              <BilLabel ko={actionLineKo} en={actionLineEn} variant="micro" />
            </div>
          </section>
        </section>
      </section>

      {/* ────── MARKET STRUCTURE (collapsed) ────── */}
      <details
        style={{
          background: '#070B10',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
          padding: '0.75rem 0.85rem',
        }}
      >
        <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 4, height: 24, borderRadius: 4, background: '#2563EB' }} />
          <div style={{ color: '#F8FAFC' }}>
            <BilLabel ko="시장 구조" en="Market Structure" variant="label" />
          </div>
          <span style={{ color: '#D8E6F5', fontSize: '0.72rem' }}>근거 열기 / Evidence only</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'Liquidity', value: liquidityState },
              { label: 'Breadth', value: breadthState },
              { label: 'Momentum', value: momentumState },
              { label: 'Gate', value: latestSnapshot?.gate_score != null ? latestSnapshot.gate_score.toFixed(0) : '--' },
            ].map((chip) => (
              <span key={chip.label} style={{ borderRadius: 999, border: '1px solid rgba(148,163,184,0.24)', background: 'rgba(255,255,255,0.02)', color: '#D8E6F5', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700 }}>
                {chip.label}: {chip.value}
              </span>
            ))}
          </span>
        </summary>
        <div style={{ marginTop: 10 }}>
          <div className="grid grid-cols-1 xl:grid-cols-[0.92fr_1.08fr] gap-4" style={{ minWidth: 0 }}>
            <div style={{ background: '#0E131A', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
              {[
                { key: 'LIQUIDITY', val: liquidityState, tone: '#60A5FA' },
                { key: 'BREADTH', val: breadthState, tone: '#C084FC' },
                { key: 'MOMENTUM', val: momentumState, tone: '#FB923C' },
                { key: 'GATE', val: latestSnapshot?.gate_score != null ? latestSnapshot.gate_score.toFixed(0) : '--', tone: gateColor(latestSnapshot?.gate_score ?? null) },
              ].map((m) => (
                <div key={m.key} style={{ borderRadius: 10, background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.75rem' }}>
                  <div style={{ color: '#D8E6F5', fontSize: '0.88rem', letterSpacing: '0.04em' }}>{m.key}</div>
                  <div style={{ marginTop: 6, color: '#F8FAFC', fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.15 }}>{m.val}</div>
                  <div style={{ marginTop: 8, height: 4, borderRadius: 999, background: 'rgba(148,163,184,0.12)', overflow: 'hidden' }}>
                    <div style={{ width: `${m.key === 'GATE' ? Math.max(8, Math.min(100, Math.round(latestSnapshot?.gate_score ?? 35))) : m.key === 'MOMENTUM' ? Math.max(10, Math.min(100, Math.round(((distPct ?? 0) + 10) * 5))) : 70}%`, height: '100%', background: m.tone as string }} />
                  </div>
                </div>
              ))}
              <div style={{ borderRadius: 10, background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.75rem', gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ color: '#D8E6F5', fontSize: '0.88rem', letterSpacing: '0.04em' }}>STRUCTURE CONFIDENCE</div>
                  <span
                    title="시장 레지먼/변동성/확산 상태와 리더 흐름을 종합한 구조 신뢰도 상참 지표. 종목 추천이 아닌 매크로 구조 판단에만 사용합니다."
                    style={{ color: '#94A3B8', fontSize: '0.8rem', cursor: 'help' }}
                  >
                    &#8505;&#65039;
                  </span>
                  <div style={{ marginLeft: 'auto', color: '#F8FAFC', fontSize: '0.95rem', fontWeight: 800 }}>{structureConfidence}</div>
                </div>
                <div style={{ marginTop: 6, color: '#94A3B8', fontSize: '0.78rem' }}>{confidenceSubline}</div>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ listStyle: 'none', cursor: 'pointer', color: '#93C5FD', fontSize: '0.76rem', fontWeight: 700 }}>
                    View Components
                  </summary>
                  <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 }}>
                    <div style={{ color: '#9CA3AF', fontSize: '0.72rem' }}>Regime</div>
                    <div style={{ color: '#E2E8F0', fontSize: '0.72rem', textAlign: 'right' }}>{flowRegime}</div>
                    <div style={{ color: '#9CA3AF', fontSize: '0.72rem' }}>Vol Risk</div>
                    <div style={{ color: '#E2E8F0', fontSize: '0.72rem', textAlign: 'right' }}>{flowVolRisk}</div>
                    <div style={{ color: '#9CA3AF', fontSize: '0.72rem' }}>Breadth</div>
                    <div style={{ color: '#E2E8F0', fontSize: '0.72rem', textAlign: 'right' }}>{breadthState}</div>
                    <div style={{ color: '#9CA3AF', fontSize: '0.72rem' }}>Leader Expansion</div>
                    <div style={{ color: '#E2E8F0', fontSize: '0.72rem', textAlign: 'right' }}>{flowSummary.acceleration_state || 'Flat'}</div>
                  </div>
                </details>
              </div>
            </div>

            {/* Sector Rotation - top 3 / bottom 3 */}
            <div
              style={{
                background: '#0E131A',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: '0.9rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ color: '#D8E6F5' }}>
                  <BilLabel ko="섹터 로테이션 (1W)" en="SECTOR ROTATION (1W)" variant="micro" />
                </div>
                <span style={{ color: rotationToneColor, fontSize: '0.78rem', fontWeight: 700 }}>
                  {rotationInterpretation}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {sectorTop3.map((s) => (
                  <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderRadius: 7, background: 'rgba(74,222,128,0.06)' }}>
                    <span style={{ color: '#D8E6F5', fontSize: '0.82rem' }}>{s.key}</span>
                    <span style={{ color: '#86EFAC', fontWeight: 700, fontSize: '0.82rem' }}>{fmtPct(s.v, 2)}</span>
                  </div>
                ))}
                {sectorTop3.length > 0 && sectorBottom3.length > 0 && (
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
                )}
                {sectorBottom3.map((s) => (
                  <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderRadius: 7, background: 'rgba(248,113,113,0.06)' }}>
                    <span style={{ color: '#D8E6F5', fontSize: '0.82rem' }}>{s.key}</span>
                    <span style={{ color: '#FCA5A5', fontWeight: 700, fontSize: '0.82rem' }}>{fmtPct(s.v, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* ────── MACRO PRESSURE (collapsed) ────── */}
      <details
        style={{
          background: '#070B10',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
          padding: '0.75rem 0.85rem',
        }}
      >
        <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 4, height: 24, borderRadius: 4, background: '#F59E0B' }} />
          <div style={{ color: '#F8FAFC' }}>
            <BilLabel ko="매크로 압력" en="Macro Pressure" variant="label" />
          </div>
          <span style={{ color: '#D8E6F5', fontSize: '0.72rem' }}>근거 열기 / Evidence</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'Rates', value: ratesState.en, tone: ratesState.tone },
              { label: 'Liquidity', value: liqStateMap.en, tone: liqStateMap.tone },
              { label: 'Vol', value: volState.en, tone: volState.tone },
            ].map((chip) => {
              const tc = chip.tone === 'green' ? '#22C55E' : chip.tone === 'red' ? '#F87171' : chip.tone === 'amber' ? '#FACC15' : '#60A5FA'
              return (
                <span key={chip.label} style={{ borderRadius: 999, border: `1px solid ${tc}33`, background: `${tc}10`, color: tc, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700 }}>
                  {chip.label}:{chip.value}
                </span>
              )
            })}
          </span>
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" style={{ marginTop: 10 }}>
          <div style={{ background: '#0E131A', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#94A3B8', fontSize: '0.75rem', letterSpacing: '0.04em', fontWeight: 700 }}>RATES PRESSURE</div>
            <div style={{ color: ratesState.tone === 'green' ? '#22C55E' : ratesState.tone === 'red' ? '#F87171' : '#60A5FA', fontSize: '1rem', fontWeight: 800 }}>{ratesState.en}</div>
            <div style={{ color: '#94A3B8', fontSize: '0.72rem' }}>
              {ratesState.en === 'easing' ? 'Rate conditions loosening' : ratesState.en === 'tight' ? 'Rate conditions restrictive' : 'Rate conditions stable'}
            </div>
          </div>
          <div style={{ background: '#0E131A', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#94A3B8', fontSize: '0.75rem', letterSpacing: '0.04em', fontWeight: 700 }}>USD / CREDIT PRESSURE</div>
            <div style={{ color: volState.tone === 'green' ? '#22C55E' : volState.tone === 'amber' ? '#FACC15' : '#60A5FA', fontSize: '1rem', fontWeight: 800 }}>{volState.en}</div>
            <div style={{ color: '#94A3B8', fontSize: '0.72rem' }}>
              {volState.en === 'compressing' ? 'Vol compression -- credit supportive' : volState.en === 'expanding' ? 'Vol expansion -- credit stress' : 'Vol mixed -- monitor USD levels'}
            </div>
          </div>
          <div style={{ background: '#0E131A', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#94A3B8', fontSize: '0.75rem', letterSpacing: '0.04em', fontWeight: 700 }}>LIQUIDITY PRESSURE</div>
            <div style={{ color: liqStateMap.tone === 'green' ? '#22C55E' : liqStateMap.tone === 'red' ? '#F87171' : '#FACC15', fontSize: '1rem', fontWeight: 800 }}>{liqStateMap.en}</div>
            <div style={{ color: '#94A3B8', fontSize: '0.72rem' }}>
              {liquidityState === 'High' ? 'Liquidity conditions healthy' : liquidityState === 'Mid' ? 'Mixed liquidity -- watch flow' : 'Tight liquidity -- speed control'}
            </div>
          </div>
        </div>
      </details>

      {/* ────── RISK ENGINE (collapsed, numbers hidden) ────── */}
      <details
        style={{
          background: '#070B10',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
          padding: '0.75rem 0.85rem',
        }}
      >
        <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 6, height: 26, borderRadius: 999, background: ssot.globalRiskToken.colorVar }} />
          <div style={{ color: '#F8FAFC' }}>
            <BilLabel ko="리스크 엔진" en="Risk Engine" variant="label" />
          </div>
          <span style={{ borderRadius: 999, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#F87171', padding: '0.2rem 0.55rem', fontSize: '0.68rem', fontWeight: 700 }}>
            <BilLabel ko="독점 지표" en="Proprietary" variant="micro" />
          </span>
          <span style={{ marginLeft: 'auto', color: '#D8E6F5', fontSize: '0.72rem', fontWeight: 700 }}>
            Defensive: {defensiveTriggerOn ? 'ON' : 'OFF'} &middot; Phase: {phaseTransitionText}
          </span>
          <Link href="/risk-engine" style={{ color: '#93C5FD', fontSize: '0.72rem', fontWeight: 700, textDecoration: 'none' }}>
            <BilLabel ko="상세 &#8594;" en="Open &#8594;" variant="micro" />
          </Link>
        </summary>
        <div style={{ marginTop: 10 }}>
          <RiskEngineSummaryBar pills={riskSummaryPillsCompressed} riskToken={ssot.globalRiskToken} />
        </div>
      </details>

      {/* ────── MY CONTEXT ────── */}
      <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ color: '#E2E8F0' }}>
          <BilLabel ko="나의 콘텍스트" en="My Context" variant="micro" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ minWidth: 0 }}>
          <section style={{ background: '#070B10', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.78rem 0.88rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#94A3B8', fontSize: '0.7rem', letterSpacing: '0.05em', fontWeight: 700 }}>
              <BilLabel ko="레버리지" en="LEVERAGE" variant="micro" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ borderRadius: 6, background: `${tqqqMode.color}18`, border: `1px solid ${tqqqMode.color}30`, color: tqqqMode.color, padding: '3px 12px', fontWeight: 800, fontSize: '0.88rem' }}>
                {tqqqMode.badge}
              </span>
              <span style={{ color: '#D8E6F5', fontSize: '0.82rem' }}>{tqqqMode.line}</span>
            </div>
            <Link href="/etf" style={{ color: '#7DD3FC', fontSize: '0.78rem', fontWeight: 700, textDecoration: 'none' }}>
              <BilLabel ko="레버리지 상세 &#8594;" en="Open Leverage &#8594;" variant="micro" />
            </Link>
          </section>
          <section style={{ background: '#070B10', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.78rem 0.88rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#94A3B8', fontSize: '0.7rem', letterSpacing: '0.05em', fontWeight: 700 }}>
              <BilLabel ko="은퇴 포트폴리오" en="RETIREMENT" variant="micro" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  borderRadius: 6,
                  background: withdrawalSafe ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                  border: `1px solid ${withdrawalSafe ? 'rgba(34,197,94,0.30)' : 'rgba(245,158,11,0.30)'}`,
                  color: withdrawalSafe ? '#22C55E' : '#F59E0B',
                  padding: '3px 12px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                }}
              >
                {withdrawalSafe ? 'STABLE' : 'WATCH'}
              </span>
              <span style={{ color: '#D8E6F5', fontSize: '0.82rem' }}>{retirementAllocation.eq}/{retirementAllocation.safe}</span>
            </div>
            <Link href="/retirement" style={{ color: '#A7F3D0', fontSize: '0.78rem', fontWeight: 700, textDecoration: 'none' }}>
              <BilLabel ko="은퇴 상세 &#8594;" en="Open Retirement &#8594;" variant="micro" />
            </Link>
          </section>
        </div>
      </section>

      {/* ────── INTEL / DISCOVERY (collapsed) ────── */}
      <details
        style={{
          background: '#070B10',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
          padding: '0.75rem 0.85rem',
        }}
      >
        <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 4, height: 24, borderRadius: 4, background: '#EC4899' }} />
          <div style={{ color: '#F8FAFC' }}>
            <BilLabel ko="인텔 / 발굴" en="Intel / Discovery" variant="label" />
          </div>
          <span style={{ color: '#D8E6F5', fontSize: '0.72rem', marginLeft: 6 }}>열기 / Open</span>
        </summary>
        <div style={{ marginTop: 10, minWidth: 0 }}>
          <HotPanel data={overviewHome} />
        </div>
      </details>

      {/* Disclaimer */}
      <div
        style={{
          borderRadius: 8,
          padding: '0.6rem 1rem',
          fontSize: '0.68rem',
          color: '#D8E6F5',
          borderLeft: '2px solid rgba(217,119,6,0.28)',
          lineHeight: 1.45,
        }}
      >
        <div>본 자료는 교육 목적으로만 제공됩니다. 실제 투자 결과를 보장하지 않습니다.</div>
        <div>Not financial advice. Educational purposes only. Past performance does not guarantee future results.</div>
        <div>노출 가이던스는 확률적이며 개인의 리스크 허용 범위에 따라 평가해야 합니다.</div>
        <div>Exposure guidance is probabilistic and must be evaluated against your personal risk tolerance.</div>
      </div>
    </div>
  )
}
