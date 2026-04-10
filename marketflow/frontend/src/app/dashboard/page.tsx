import Link from 'next/link'
import { cookies } from 'next/headers'

import styles from '@/app/dashboard/dashboardTerminal.module.css'
import { renderEngineText, selectLocalizedText, type LocalizedText } from '@/lib/i18n/contentContract'
import { readCacheJson } from '@/lib/readCacheJson'
import { UI_LANG_COOKIE, normalizeUiLang, pickLang, type UiLang } from '@/lib/uiLang'

export const dynamic = 'force-dynamic'

type MarketTapeItem = {
  symbol?: string | null
  name?: string | null
  last?: number | null
  chg_pct?: number | null
}

type MarketTapeCache = {
  data_date?: string
  generated_at?: string
  items?: MarketTapeItem[]
}

type DailyBriefing = {
  data_date?: string | null
  generated_at?: string | null
  headline?: { ko?: string | null; en?: string | null } | string | null
  paragraphs?: {
    ko?: Array<{ text?: string | null }>
    en?: Array<{ text?: string | null }>
  } | null
  bullets?: {
    ko?: Array<{ label?: string | null; text?: string | null }>
    en?: Array<{ label?: string | null; text?: string | null }>
  } | null
  stance?: {
    action?: { ko?: string | null; en?: string | null } | string | null
    exposure_band?: string | null
    why?: string | null
  } | null
}

type SnapshotItem = {
  date?: string
  market_phase?: string | null
  risk_level?: string | null
  gate_score?: number | null
  gate_delta_5d?: number | null
  trend_state?: string | null
  total_stocks?: number | null
  phase_shift_flag?: number | null
  drawdown?: number | null
}

type SnapshotsCache = {
  snapshots?: SnapshotItem[]
}

type RiskV1Cache = {
  current?: {
    score?: number | null
    score_zone?: string | null
    level?: number | null
    dd_pct?: number | null
    context?: {
      final_exposure?: number | null
      final_risk?: string | null
      brief?: string | null
    } | null
  } | null
  breadth?: {
    pct_above_ma200?: number | null
    health_label?: string | null
    divergence_signal?: string | null
  } | null
  history?: Array<{
    date?: string | null
    score?: number | null
    dd_pct?: number | null
  }> | null
}

type VrPatternDashboard = {
  snapshot?: {
    as_of_date?: string | null
    market_pattern?: string | null
    tqqq_drawdown?: string | null
    recommended_posture?: string[] | null
  } | null
  suggested_posture?: string[] | null
  historical_analogs?: {
    top_pattern_summary?: string | null
  } | null
}

type Current90dCache = {
  risk_v1?: {
    playback?: Array<{
      d?: string | null
      tqqq_dd?: number | null
      tqqq_n?: number | null
    }> | null
  } | null
}

type LadderRow = {
  symbol: string
  label: string
  last: number | null
  chgPct: number | null
}

type MssSeriesPoint = {
  date: string
  score: number
}

const DASHBOARD_UI = {
  pageTitle: { ko: 'Risk Security Manager - Beta', en: 'Risk Security Manager - Beta' },
  pageSubtitle: { ko: 'Structure first. Detail later.', en: 'Structure first. Detail later.' },
  asOf: { ko: 'AS OF', en: 'AS OF' },
  cardRegime: { ko: 'Market Regime & Posture', en: 'Market Regime & Posture' },
  cardLeverage: { ko: 'Leverage Lens', en: 'Leverage Lens' },
  cardQueue: { ko: 'Positioning Queue', en: 'Positioning Queue' },
  cardEvent: { ko: 'Event Clock (24h)', en: 'Event Clock (24h)' },
  cardNews: { ko: 'News Slice', en: 'News Slice' },
  cardBreadth: { ko: 'Breadth & Flow', en: 'Breadth & Flow' },
  gateScore: { ko: 'Gate Score', en: 'Gate Score' },
  breadthPulse: { ko: 'Breadth Pulse', en: 'Breadth Pulse' },
  whyMatters: { ko: 'Why this matters', en: 'Why this matters' },
  openLeverageLens: { ko: 'Open Leverage Lens', en: 'Open Leverage Lens' },
  fullBriefing: { ko: 'Full Briefing', en: 'Full Briefing' },
  newsDetail: { ko: 'News Detail', en: 'News Detail' },
  railIndices: { ko: 'Indices', en: 'Indices' },
  railRatesFx: { ko: 'Rates & FX', en: 'Rates & FX' },
  railCommoditiesAlt: { ko: 'Commodities & Alt', en: 'Commodities & Alt' },
  railHeadlineTape: { ko: 'Headline Tape', en: 'Headline Tape' },
  sourceDailyBriefingCache: { ko: 'Source: Daily briefing cache', en: 'Source: Daily briefing cache' },
  gateEstimated: { ko: 'est', en: 'est' },
  flowShiftDetected: { ko: 'shift detected', en: 'shift detected' },
  flowMonitorMode: { ko: 'monitor mode', en: 'monitor mode' },
  labelRegime: { ko: 'Regime', en: 'Regime' },
  labelRisk: { ko: 'Risk', en: 'Risk' },
  labelExposure: { ko: 'Exposure', en: 'Exposure' },
  labelGate: { ko: 'Gate', en: 'Gate' },
  labelDrawdown: { ko: 'Drawdown', en: 'Drawdown' },
  labelFlow: { ko: 'Flow', en: 'Flow' },
  labelAboveMa200: { ko: 'Above MA200', en: 'Above MA200' },
  labelTracked: { ko: 'Tracked', en: 'Tracked' },
  labelNames: { ko: 'Names', en: 'Names' },
  labelBreadth: { ko: 'Breadth', en: 'Breadth' },
  labelDivergence: { ko: 'Divergence', en: 'Divergence' },
  labelPattern: { ko: 'Pattern', en: 'Pattern' },
  labelVrPosture: { ko: 'VR posture', en: 'VR posture' },
} as const

const DASHBOARD_ENGINE = {
  regimeHeadline: { ko: '{{regime}} regime with {{riskLevel}} risk posture', en: '{{regime}} regime with {{riskLevel}} risk posture' },
  gateZoneUnavailable: { ko: 'unavailable', en: 'unavailable' },
  gateZoneDefensive: { ko: 'defensive zone', en: 'defensive zone' },
  gateZoneNeutral: { ko: 'neutral zone', en: 'neutral zone' },
  gateZoneRiskOn: { ko: 'risk-on zone', en: 'risk-on zone' },
  gateGuide: {
    ko: 'Gate scale: 0-39 defensive, 40-69 neutral, 70-100 risk-on. Current {{current}} means {{zone}}.',
    en: 'Gate scale: 0-39 defensive, 40-69 neutral, 70-100 risk-on. Current {{current}} means {{zone}}.',
  },
  queueCore: {
    ko: 'Keep core exposure within {{exposureBand}} while regime is {{regime}}.',
    en: 'Keep core exposure within {{exposureBand}} while regime is {{regime}}.',
  },
  queueGateAvailable: {
    ko: 'Gate score {{gate}}: add risk only on pullback quality, not breakaway spikes.',
    en: 'Gate score {{gate}}: add risk only on pullback quality, not breakaway spikes.',
  },
  queueGateUnavailable: {
    ko: 'Gate score unavailable: keep risk parity posture until gate data confirms.',
    en: 'Gate score unavailable: keep risk parity posture until gate data confirms.',
  },
  queueHighRisk: {
    ko: 'Prioritize hedge and cash buffer; defer fresh leverage entries.',
    en: 'Prioritize hedge and cash buffer; defer fresh leverage entries.',
  },
  queueDefaultRisk: {
    ko: 'Use staged entries and reduce single-theme concentration risk.',
    en: 'Use staged entries and reduce single-theme concentration risk.',
  },
  event0830: {
    ko: '08:30 ET - Macro releases window (CPI/PPI/Jobs feed watch).',
    en: '08:30 ET - Macro releases window (CPI/PPI/Jobs feed watch).',
  },
  event1000: {
    ko: '10:00 ET - Intraday breadth check + rates trend confirmation.',
    en: '10:00 ET - Intraday breadth check + rates trend confirmation.',
  },
  event1400: {
    ko: '14:00 ET - Fed tape sensitivity window (headlines + yields).',
    en: '14:00 ET - Fed tape sensitivity window (headlines + yields).',
  },
  event1630: {
    ko: '16:30 ET - Close audit: rebalance only if signal drift persists.',
    en: '16:30 ET - Close audit: rebalance only if signal drift persists.',
  },
  leverageDeRiskLabel: { ko: 'DE-RISK LEVERAGE', en: 'DE-RISK LEVERAGE' },
  leverageDeRiskLine: {
    ko: 'Use smaller size, wait for breadth confirmation before adding leverage.',
    en: 'Use smaller size, wait for breadth confirmation before adding leverage.',
  },
  leverageMeasuredLabel: { ko: 'MEASURED LEVERAGE', en: 'MEASURED LEVERAGE' },
  leverageMeasuredLine: {
    ko: 'Keep leverage tactical and avoid overnight concentration.',
    en: 'Keep leverage tactical and avoid overnight concentration.',
  },
  leverageAllowedLabel: { ko: 'LEVERAGE ALLOWED', en: 'LEVERAGE ALLOWED' },
  leverageAllowedLine: {
    ko: 'Trend support is constructive, but entries should still be staged.',
    en: 'Trend support is constructive, but entries should still be staged.',
  },
  tqqqMeta: {
    ko: 'TQQQ DD {{dd}} - Bottom: {{bottom}} - Rebound: {{rebound}}',
    en: 'TQQQ DD {{dd}} - Bottom: {{bottom}} - Rebound: {{rebound}}',
  },
  tqqqDd135: {
    ko: 'TQQQ DD1/3/5: {{dd1}} / {{dd3}} / {{dd5}}',
    en: 'TQQQ DD1/3/5: {{dd1}} / {{dd3}} / {{dd5}}',
  },
  tqqqPeakBottom: {
    ko: 'Peak->Bottom DD (45D): {{drop}} - Bottom->Now Rebound: {{rebound}}{{bottomMeta}}',
    en: 'Peak->Bottom DD (45D): {{drop}} - Bottom->Now Rebound: {{rebound}}{{bottomMeta}}',
  },
  reboundStage: { ko: 'Rebound stage: {{stage}}', en: 'Rebound stage: {{stage}}' },
  bottomMeta: {
    ko: ' (bottom {{bottomDate}}, +{{days}}d)',
    en: ' (bottom {{bottomDate}}, +{{days}}d)',
  },
  bottomSignalPattern: { ko: 'Bottoming analog detected', en: 'Bottoming analog detected' },
  bottomSignalDeepDd: { ko: 'Deep DD zone: bottom watch only', en: 'Deep DD zone: bottom watch only' },
  bottomSignalEarlyWatch: { ko: 'Early bottom-watch posture', en: 'Early bottom-watch posture' },
  bottomSignalNone: { ko: 'No bottom confirmation', en: 'No bottom confirmation' },
  reboundSignalFragile: { ko: 'Rebound is fragile (dead-cat risk)', en: 'Rebound is fragile (dead-cat risk)' },
  reboundSignalPossible: {
    ko: 'Rebound possible with persistence confirmation',
    en: 'Rebound possible with persistence confirmation',
  },
  reboundSignalNone: { ko: 'Rebound not confirmed', en: 'Rebound not confirmed' },
  reboundStageNa: { ko: 'N/A', en: 'N/A' },
  reboundStageEscapeConviction: { ko: 'Escape conviction (+30)', en: 'Escape conviction (+30)' },
  reboundStageEscapeEntry: { ko: 'Escape entry (+25)', en: 'Escape entry (+25)' },
  reboundStageRebound: { ko: 'Rebound (+20)', en: 'Rebound (+20)' },
  reboundStageEarly: { ko: 'Early rebound (+15)', en: 'Early rebound (+15)' },
  reboundStageWatch: { ko: 'Watch zone (<+15)', en: 'Watch zone (<+15)' },
  breadthPending: { ko: 'Breadth data pending', en: 'Breadth data pending' },
  breadthImproving: { ko: 'Breadth improving', en: 'Breadth improving' },
  breadthMixed: { ko: 'Breadth mixed', en: 'Breadth mixed' },
  breadthWeak: { ko: 'Breadth weak', en: 'Breadth weak' },
  fallbackHeadline: {
    ko: 'Structure-first terminal dashboard is active.',
    en: 'Structure-first terminal dashboard is active.',
  },
  fallbackTeaser: {
    ko: "Signal context is loading. Use right rail for today's cross-asset pulse.",
    en: "Signal context is loading. Use right rail for today's cross-asset pulse.",
  },
  fallbackWhy: {
    ko: 'Keep posture and leverage in sync with regime, not with headline volatility.',
    en: 'Keep posture and leverage in sync with regime, not with headline volatility.',
  },
} as const

const uiText = (lang: UiLang, text: { ko: string; en: string }): string => pickLang(lang, text.ko, text.en)

const engineText = (lang: UiLang, template: LocalizedText, vars: Record<string, string | number> = {}): string =>
  selectLocalizedText(renderEngineText(template, vars), lang)

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const hasHangul = (value: string): boolean => /[\uac00-\ud7a3]/.test(value)
const hasLatin = (value: string): boolean => /[A-Za-z]/.test(value)

const preferLangText = (value: string | null | undefined, lang: UiLang): string => {
  const text = String(value || '').trim()
  if (!text) return ''
  if (lang === 'ko') return hasHangul(text) ? text : ''
  if (lang === 'en') return !hasHangul(text) || hasLatin(text) ? text : ''
  return text
}

const formatNumber = (value: number | null): string => {
  if (value == null || Number.isNaN(value)) return '--'
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (Math.abs(value) >= 100) return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const formatPct = (value: number | null): string => {
  if (value == null || Number.isNaN(value)) return '--'
  const signed = value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2)
  return `${signed}%`
}

const formatPct1 = (value: number | null): string => {
  if (value == null || Number.isNaN(value)) return '--'
  const signed = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
  return `${signed}%`
}

const toneClass = (value: number | null): string => {
  if (value == null || Number.isNaN(value)) return styles.chgFlat
  if (value > 0) return styles.chgUp
  if (value < 0) return styles.chgDown
  return styles.chgFlat
}

const pickText = (
  value: { ko?: string | null; en?: string | null } | string | null | undefined,
  lang: UiLang,
): string => {
  if (!value) return ''
  if (typeof value === 'string') return preferLangText(value, lang)
  if (lang === 'ko') return (value.ko || '').trim()
  return (value.en || '').trim()
}

const toTeaser = (value: string, max = 260): string => {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max).trimEnd()}...`
}

const REGIME_LABELS: Record<string, { ko: string; en: string }> = {
  TRANSITION: { ko: 'TRANSITION', en: 'TRANSITION' },
  BULL: { ko: 'BULL', en: 'BULL' },
  BEAR: { ko: 'BEAR', en: 'BEAR' },
  NEUTRAL: { ko: 'NEUTRAL', en: 'NEUTRAL' },
  RISK_ON: { ko: 'RISK_ON', en: 'RISK_ON' },
  RISK_OFF: { ko: 'RISK_OFF', en: 'RISK_OFF' },
}

const RISK_LABELS: Record<string, { ko: string; en: string }> = {
  LOW: { ko: 'LOW', en: 'LOW' },
  MEDIUM: { ko: 'MEDIUM', en: 'MEDIUM' },
  HIGH: { ko: 'HIGH', en: 'HIGH' },
  EXTREME: { ko: 'EXTREME', en: 'EXTREME' },
}

const BREADTH_LABELS: Record<string, { ko: string; en: string }> = {
  IMPROVING: { ko: 'IMPROVING', en: 'IMPROVING' },
  MIXED: { ko: 'MIXED', en: 'MIXED' },
  WEAK: { ko: 'WEAK', en: 'WEAK' },
  STRONG: { ko: 'STRONG', en: 'STRONG' },
  NORMAL: { ko: 'NORMAL', en: 'NORMAL' },
}

const DIVERGENCE_LABELS: Record<string, { ko: string; en: string }> = {
  TOP_WARNING_STRONG: { ko: 'TOP_WARNING_STRONG', en: 'TOP_WARNING_STRONG' },
  TOP_WARNING: { ko: 'TOP_WARNING', en: 'TOP_WARNING' },
  NONE: { ko: 'NONE', en: 'NONE' },
}

const toLabelKey = (value: string | null | undefined): string =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

const localizeByMap = (
  value: string | null | undefined,
  lang: UiLang,
  map: Record<string, { ko: string; en: string }>,
): string => {
  const key = toLabelKey(value)
  const row = map[key]
  if (row) return pickLang(lang, row.ko, row.en)
  if (!value) return '--'
  return String(value)
}

const parsePctString = (value: string | null | undefined): number | null => {
  if (!value) return null
  const normalized = String(value).replace('%', '').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const formatMiniDate = (date: string): string => {
  if (!date || date.length < 10) return '--'
  return date.slice(5)
}

const gaugeColor = (score: number): string => {
  if (score >= 70) return '#22c55e'
  if (score >= 45) return '#f59e0b'
  return '#ef4444'
}

function MiniMssChart({ series }: { series: MssSeriesPoint[] }) {
  if (series.length < 2) {
    return <div className={styles.mssEmpty}>MSS history is not available yet.</div>
  }

  const viewW = 360
  const viewH = 126
  const padX = 10
  const padY = 8
  const labelColW = 74
  const plotW = viewW - padX * 2 - labelColW
  const plotH = 94
  const scores = series.map((row) => row.score)
  const minScore = Math.min(...scores, 60)
  const maxScore = Math.max(...scores, 130)
  const safeMax = maxScore - minScore < 8 ? minScore + 8 : maxScore
  const range = Math.max(1, safeMax - minScore)

  const xAt = (index: number): number => {
    if (series.length <= 1) return padX
    return padX + (index / (series.length - 1)) * plotW
  }

  const yAt = (score: number): number => padY + ((safeMax - score) / range) * plotH

  const path = series
    .map((row, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(2)} ${yAt(row.score).toFixed(2)}`)
    .join(' ')

  const baselineY = yAt(100)
  const labelStartX = padX + plotW + 11
  const clampY = (y: number): number => clamp(y, padY + 7, padY + plotH - 4)
  const zoneLabels = [
    { label: 'BULL', score: 110, color: '#22c55e' },
    { label: 'NEUTRAL', score: 96, color: '#f59e0b' },
    { label: 'CRISIS', score: 75, color: '#ef4444' },
  ].map((item) => ({
    ...item,
    y: clampY(yAt(item.score)),
  }))
  const lastIndex = series.length - 1
  const lastPoint = series[lastIndex]
  const lastX = xAt(lastIndex)
  const lastY = yAt(lastPoint.score)

  return (
    <div className={styles.mssMiniBlock}>
      <div className={styles.mssMiniTop}>
        <span className={styles.mssMiniTitle}>MSS {series.length}D</span>
        <span className={styles.mssMiniNow}>{lastPoint.score.toFixed(1)}</span>
      </div>
      <svg viewBox={`0 0 ${viewW} ${viewH}`} className={styles.mssMiniSvg} preserveAspectRatio="none" aria-label="MSS mini chart">
        <rect x={padX} y={padY} width={plotW} height={plotH} className={styles.mssMiniBg} />
        <line x1={padX} y1={baselineY} x2={padX + plotW} y2={baselineY} className={styles.mssMiniBaseline} />
        <path d={path} className={styles.mssMiniLine} />
        <circle cx={lastX} cy={lastY} r={3.2} className={styles.mssMiniDot} />
        <line x1={padX + plotW + 2} y1={padY} x2={padX + plotW + 2} y2={padY + plotH} className={styles.mssMiniDivider} />
        {zoneLabels.map((zone) => (
          <g key={zone.label}>
            <line x1={padX + plotW + 2} y1={zone.y} x2={padX + plotW + 6} y2={zone.y} className={styles.mssMiniZoneTick} />
            <text x={labelStartX} y={zone.y + 1} className={styles.mssMiniZone} style={{ fill: zone.color }}>
              {zone.label}
            </text>
          </g>
        ))}
      </svg>
      <div className={styles.mssMiniAxis}>
        <span>{formatMiniDate(series[0].date)}</span>
        <span>{formatMiniDate(lastPoint.date)}</span>
      </div>
    </div>
  )
}

function HalfGauge({
  value,
  max = 100,
  width = 106,
  height = 74,
  valueFontSize = 18,
}: {
  value: number
  max?: number
  width?: number
  height?: number
  valueFontSize?: number
}) {
  const safeMax = max > 0 ? max : 100
  const safe = clamp(value, 0, safeMax)
  const pct = safe / safeMax
  const cx = 50
  const cy = 34
  const r = 26
  const theta = Math.PI * (1 - pct)
  const ex = cx + r * Math.cos(theta)
  const ey = cy - r * Math.sin(theta)
  const bgArc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  const fgArc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`
  const color = gaugeColor(Math.round((safe / safeMax) * 100))
  const valueColor = safe >= 70 ? '#86efac' : safe >= 45 ? '#fde68a' : '#fca5a5'

  return (
    <svg viewBox="0 0 100 78" width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <path d={bgArc} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8} strokeLinecap="round" />
      {pct > 0.01 && <path d={fgArc} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />}
      <text x="50" y="67" textAnchor="middle">
        <tspan fontSize={valueFontSize} fontWeight="900" fill={valueColor}>
          {Math.round(safe)}
        </tspan>
        <tspan dx="2" dy="-2" fontSize={10} fill="#e2e8f0">
          /{safeMax}
        </tspan>
      </text>
    </svg>
  )
}

const buildLadderRow = (
  tapeMap: Map<string, MarketTapeItem>,
  symbol: string,
  label: string,
  aliases: string[] = [],
): LadderRow => {
  const keys = [symbol, ...aliases].map((item) => item.toUpperCase())
  const found = keys.map((key) => tapeMap.get(key)).find(Boolean)
  return {
    symbol,
    label,
    last: typeof found?.last === 'number' ? found.last : null,
    chgPct: typeof found?.chg_pct === 'number' ? found.chg_pct : null,
  }
}

export default async function DashboardPage() {
  const uiLang = normalizeUiLang(cookies().get(UI_LANG_COOKIE)?.value)
  const contentLang: UiLang = uiLang

  const [marketTape, dailyBriefing, snapshots, riskV1, vrPattern, current90d] = await Promise.all([
    readCacheJson<MarketTapeCache>('market_tape.json', { items: [] }),
    readCacheJson<DailyBriefing>('daily_briefing.json', {}),
    readCacheJson<SnapshotsCache>('snapshots_120d.json', { snapshots: [] }),
    readCacheJson<RiskV1Cache>('risk_v1.json', {}),
    readCacheJson<VrPatternDashboard>('vr_pattern_dashboard.json', {}),
    readCacheJson<Current90dCache>('current_90d.json', {}),
  ])

  const tapeItems = Array.isArray(marketTape.items) ? marketTape.items : []
  const tapeMap = new Map<string, MarketTapeItem>()
  for (const row of tapeItems) {
    if (!row?.symbol) continue
    tapeMap.set(String(row.symbol).toUpperCase(), row)
  }

  const latestSnapshot = (snapshots.snapshots || []).at(-1) || null
  const regime = (latestSnapshot?.market_phase || 'TRANSITION').toUpperCase()
  const riskLevel = (latestSnapshot?.risk_level || 'MEDIUM').toUpperCase()
  const regimeLabel = localizeByMap(regime, contentLang, REGIME_LABELS)
  const riskLevelLabel = localizeByMap(riskLevel, contentLang, RISK_LABELS)
  const gateScore = typeof latestSnapshot?.gate_score === 'number' ? latestSnapshot.gate_score : null
  const exposureBand =
    dailyBriefing.stance?.exposure_band ||
    (typeof riskV1.current?.context?.final_exposure === 'number' ? `${riskV1.current.context.final_exposure}%` : '40~60%')

  const mssScore = typeof riskV1.current?.score === 'number' ? riskV1.current.score : null
  const mssWindowDays = 45
  const riskHistory = Array.isArray(riskV1.history) ? riskV1.history : []
  const mssSeries: MssSeriesPoint[] = riskHistory
    .filter((row): row is { date?: string | null; score?: number | null } => Boolean(row))
    .map((row) => ({
      date: typeof row.date === 'string' ? row.date : '',
      score: typeof row.score === 'number' ? row.score : NaN,
    }))
    .filter((row) => row.date && Number.isFinite(row.score))
    .slice(-mssWindowDays)
  const fallbackGate = mssScore != null ? clamp(Math.round(((mssScore - 60) / 60) * 100), 0, 100) : null
  const computedGate = gateScore ?? fallbackGate
  const regimeGauge = computedGate != null ? clamp(Math.round(computedGate), 0, 100) : null
  const gateIsEstimated = gateScore == null && computedGate != null
  const gateZoneLabel =
    regimeGauge == null
      ? engineText(contentLang, DASHBOARD_ENGINE.gateZoneUnavailable)
      : regimeGauge < 40
        ? engineText(contentLang, DASHBOARD_ENGINE.gateZoneDefensive)
        : regimeGauge < 70
          ? engineText(contentLang, DASHBOARD_ENGINE.gateZoneNeutral)
          : engineText(contentLang, DASHBOARD_ENGINE.gateZoneRiskOn)
  const drawdownPct =
    typeof latestSnapshot?.drawdown === 'number'
      ? latestSnapshot.drawdown
      : typeof riskV1.current?.dd_pct === 'number'
        ? riskV1.current.dd_pct
        : null

  const breadthPct = typeof riskV1.breadth?.pct_above_ma200 === 'number' ? riskV1.breadth.pct_above_ma200 : null
  const breadthGauge = clamp(Math.round(breadthPct ?? 45), 0, 100)
  const breadthState =
    breadthPct == null
      ? engineText(contentLang, DASHBOARD_ENGINE.breadthPending)
      : breadthPct >= 55
        ? engineText(contentLang, DASHBOARD_ENGINE.breadthImproving)
        : breadthPct >= 40
          ? engineText(contentLang, DASHBOARD_ENGINE.breadthMixed)
          : engineText(contentLang, DASHBOARD_ENGINE.breadthWeak)

  const headline = pickText(dailyBriefing.headline, contentLang) || engineText(contentLang, DASHBOARD_ENGINE.fallbackHeadline)
  const primaryParagraphCandidates = contentLang === 'ko' ? dailyBriefing.paragraphs?.ko : dailyBriefing.paragraphs?.en
  const primaryParagraph =
    primaryParagraphCandidates?.find((item) => item?.text?.trim())?.text?.trim() || ''
  const teaser = toTeaser(primaryParagraph || engineText(contentLang, DASHBOARD_ENGINE.fallbackTeaser), 280)
  const stanceWhy = preferLangText(dailyBriefing.stance?.why, contentLang)
  const whyMatters = toTeaser(
    stanceWhy || engineText(contentLang, DASHBOARD_ENGINE.fallbackWhy),
    140,
  )

  const indexRows: LadderRow[] = [
    buildLadderRow(tapeMap, 'SPY', 'S&P 500'),
    buildLadderRow(tapeMap, 'QQQ', 'NASDAQ 100'),
    buildLadderRow(tapeMap, 'IWM', 'Russell 2000'),
    buildLadderRow(tapeMap, 'VIX', 'Volatility'),
  ]

  const ratesFxRows: LadderRow[] = [
    buildLadderRow(tapeMap, 'US10Y', '10Y Treasury'),
    buildLadderRow(tapeMap, 'US5Y', '5Y Treasury'),
    buildLadderRow(tapeMap, 'DXY', 'Dollar Index'),
  ]

  const commodityRows: LadderRow[] = [
    buildLadderRow(tapeMap, 'GOLD', 'Gold', ['GC=F']),
    buildLadderRow(tapeMap, 'WTI', 'WTI', ['CL=F']),
    buildLadderRow(tapeMap, 'BTC', 'Bitcoin', ['BTCUSD']),
  ]

  const queueRows = [
    engineText(contentLang, DASHBOARD_ENGINE.queueCore, { exposureBand, regime: regimeLabel }),
    gateScore != null
      ? engineText(contentLang, DASHBOARD_ENGINE.queueGateAvailable, { gate: gateScore.toFixed(1) })
      : engineText(contentLang, DASHBOARD_ENGINE.queueGateUnavailable),
    riskLevel === 'HIGH'
      ? engineText(contentLang, DASHBOARD_ENGINE.queueHighRisk)
      : engineText(contentLang, DASHBOARD_ENGINE.queueDefaultRisk),
  ]

  const eventRows = [
    engineText(contentLang, DASHBOARD_ENGINE.event0830),
    engineText(contentLang, DASHBOARD_ENGINE.event1000),
    engineText(contentLang, DASHBOARD_ENGINE.event1400),
    engineText(contentLang, DASHBOARD_ENGINE.event1630),
  ]

  const tqqqPlayback = (current90d.risk_v1?.playback || [])
    .map((row) => ({
      date: typeof row?.d === 'string' ? row.d : '',
      tqqqDd: typeof row?.tqqq_dd === 'number' && Number.isFinite(row.tqqq_dd) ? row.tqqq_dd : null,
      tqqqN: typeof row?.tqqq_n === 'number' && Number.isFinite(row.tqqq_n) ? row.tqqq_n : null,
    }))
    .filter((row) => row.date)
  const tqqqDdSeries = tqqqPlayback
    .map((row) => row.tqqqDd)
    .filter((value): value is number => value != null)
  const pickTqqqDd = (days: number): number | null => {
    if (!tqqqDdSeries.length) return null
    const idx = Math.max(0, tqqqDdSeries.length - days)
    return tqqqDdSeries[idx]
  }
  const tqqqDd1 = pickTqqqDd(1)
  const tqqqDd3 = pickTqqqDd(3)
  const tqqqDd5 = pickTqqqDd(5)
  const tqqqMetricSeries = tqqqPlayback.filter(
    (row): row is { date: string; tqqqDd: number; tqqqN: number | null } => row.tqqqDd != null,
  )
  const swingLookbackDays = 45
  const swingWindow = tqqqMetricSeries.slice(-swingLookbackDays)
  let dropToBottomPct: number | null = null
  let reboundFromBottomPct: number | null = null
  let bottomDate = ''
  let daysSinceBottom: number | null = null
  if (swingWindow.length >= 2) {
    let troughIdx = 0
    for (let i = 1; i < swingWindow.length; i += 1) {
      if (swingWindow[i].tqqqDd < swingWindow[troughIdx].tqqqDd) troughIdx = i
    }
    const currentIdx = swingWindow.length - 1
    const trough = swingWindow[troughIdx]
    const current = swingWindow[currentIdx]
    bottomDate = trough.date
    daysSinceBottom = currentIdx - troughIdx

    // Peak -> bottom decline: prefer direct DD level when available.
    dropToBottomPct = trough.tqqqDd

    // Bottom -> now rebound:
    // 1) price-normalized (tqqq_n) when present.
    // 2) fallback to DD-based ratio when tqqq_n is missing.
    if (typeof trough.tqqqN === 'number' && trough.tqqqN > 0 && typeof current.tqqqN === 'number') {
      reboundFromBottomPct = (current.tqqqN / trough.tqqqN - 1) * 100
    } else {
      const troughBase = 1 + trough.tqqqDd / 100
      const currentBase = 1 + current.tqqqDd / 100
      if (troughBase > 0 && currentBase > 0) {
        reboundFromBottomPct = (currentBase / troughBase - 1) * 100
      }
    }
  }
  const vrTqqqDd = tqqqDd1 ?? parsePctString(vrPattern.snapshot?.tqqq_drawdown)
  const vrPosture = (
    Array.isArray(vrPattern.snapshot?.recommended_posture) && vrPattern.snapshot?.recommended_posture?.length
      ? vrPattern.snapshot.recommended_posture
      : vrPattern.suggested_posture
  ) || []
  const topPattern = (vrPattern.historical_analogs?.top_pattern_summary || vrPattern.snapshot?.market_pattern || '').trim()
  const topPatternLower = topPattern.toLowerCase()

  const bottomSignal =
    topPatternLower.includes('bottom')
      ? engineText(contentLang, DASHBOARD_ENGINE.bottomSignalPattern)
      : vrTqqqDd != null && vrTqqqDd <= -25
        ? engineText(contentLang, DASHBOARD_ENGINE.bottomSignalDeepDd)
        : vrPosture.some((line) => /trial entries|gradual rebuild/i.test(line))
          ? engineText(contentLang, DASHBOARD_ENGINE.bottomSignalEarlyWatch)
          : engineText(contentLang, DASHBOARD_ENGINE.bottomSignalNone)

  const reboundSignal =
    topPatternLower.includes('dead cat')
      ? engineText(contentLang, DASHBOARD_ENGINE.reboundSignalFragile)
      : vrPosture.some((line) => /persistence improves|rebuild/i.test(line)) || topPatternLower.includes('rebound')
        ? engineText(contentLang, DASHBOARD_ENGINE.reboundSignalPossible)
        : engineText(contentLang, DASHBOARD_ENGINE.reboundSignalNone)

  const reboundStage =
    reboundFromBottomPct == null
      ? engineText(contentLang, DASHBOARD_ENGINE.reboundStageNa)
      : reboundFromBottomPct >= 30
        ? engineText(contentLang, DASHBOARD_ENGINE.reboundStageEscapeConviction)
        : reboundFromBottomPct >= 25
          ? engineText(contentLang, DASHBOARD_ENGINE.reboundStageEscapeEntry)
          : reboundFromBottomPct >= 20
            ? engineText(contentLang, DASHBOARD_ENGINE.reboundStageRebound)
            : reboundFromBottomPct >= 15
              ? engineText(contentLang, DASHBOARD_ENGINE.reboundStageEarly)
              : engineText(contentLang, DASHBOARD_ENGINE.reboundStageWatch)

  const leverageMode =
    riskLevel === 'HIGH' || (gateScore != null && gateScore < 45)
      ? {
          label: engineText(contentLang, DASHBOARD_ENGINE.leverageDeRiskLabel),
          toneClassName: styles.pillRed,
          line: engineText(contentLang, DASHBOARD_ENGINE.leverageDeRiskLine),
        }
      : riskLevel === 'MEDIUM'
        ? {
            label: engineText(contentLang, DASHBOARD_ENGINE.leverageMeasuredLabel),
            toneClassName: styles.pillAmber,
            line: engineText(contentLang, DASHBOARD_ENGINE.leverageMeasuredLine),
          }
        : {
            label: engineText(contentLang, DASHBOARD_ENGINE.leverageAllowedLabel),
            toneClassName: styles.pillGreen,
            line: engineText(contentLang, DASHBOARD_ENGINE.leverageAllowedLine),
          }

  const bulletLines =
    (contentLang === 'ko' ? dailyBriefing.bullets?.ko : dailyBriefing.bullets?.en)
      ?.map((item) => item?.text?.trim())
      .filter((v): v is string => Boolean(v)) || []
  const tapeTimes = ['16:30 ET', '12:30 ET', '09:30 ET']
  const tapeHeadlines = (bulletLines.length ? bulletLines : [headline, teaser, whyMatters]).slice(0, 3).map((text, idx) => ({
    time: tapeTimes[idx] || '--:-- ET',
    text: toTeaser(text, 120),
  }))

  const asOf =
    marketTape.data_date ||
    dailyBriefing.data_date ||
    latestSnapshot?.date ||
    vrPattern.snapshot?.as_of_date ||
    '--'

  return (
    <div className={`${styles.page} ${uiLang === 'ko' ? styles.pageKo : styles.pageEn}`}>
      <div className={styles.shell}>
        <section className={styles.mainPanel}>
          <header className={styles.header}>
            <div>
              <h1 className={styles.title}>{uiText(uiLang, DASHBOARD_UI.pageTitle)}</h1>
              <p className={styles.subtitle}>{uiText(uiLang, DASHBOARD_UI.pageSubtitle)}</p>
            </div>
            <span className={styles.statusChip}>
              {uiText(uiLang, DASHBOARD_UI.asOf)} {asOf}
            </span>
          </header>

          <div className={styles.cards}>
            <article className={styles.card}>
              <p className={styles.kicker}>{uiText(uiLang, DASHBOARD_UI.cardRegime)}</p>
              <div className={`${styles.gaugeRow} ${regimeGauge == null ? styles.gaugeRowNoSide : ''}`}>
                <div>
                  <h3 className={styles.headline}>
                    {engineText(contentLang, DASHBOARD_ENGINE.regimeHeadline, { regime: regimeLabel, riskLevel: riskLevelLabel })}
                  </h3>
                  <div className={styles.valueRow}>
                    <span className={`${styles.pill} ${regime === 'BULL' ? styles.pillGreen : regime === 'BEAR' ? styles.pillRed : styles.pillAmber}`}>
                      {uiText(uiLang, DASHBOARD_UI.labelRegime)} {regimeLabel}
                    </span>
                    <span className={`${styles.pill} ${riskLevel === 'LOW' ? styles.pillGreen : riskLevel === 'HIGH' ? styles.pillRed : styles.pillAmber}`}>
                      {uiText(uiLang, DASHBOARD_UI.labelRisk)} {riskLevelLabel}
                    </span>
                    <span className={styles.pill}>{uiText(uiLang, DASHBOARD_UI.labelExposure)} {exposureBand}</span>
                  </div>
                  <p className={styles.meta}>
                    {uiText(uiLang, DASHBOARD_UI.labelGate)} {computedGate != null ? computedGate.toFixed(1) : '--'}
                    {gateIsEstimated ? ` (${uiText(uiLang, DASHBOARD_UI.gateEstimated)})` : ''} - MSS {mssScore != null ? mssScore.toFixed(1) : '--'} - {uiText(uiLang, DASHBOARD_UI.labelDrawdown)} {formatPct(drawdownPct)}
                  </p>
                  <p className={styles.gateGuide}>
                    {engineText(contentLang, DASHBOARD_ENGINE.gateGuide, {
                      current: regimeGauge ?? '--',
                      zone: gateZoneLabel,
                    })}
                  </p>
                  <MiniMssChart series={mssSeries} />
                </div>
                {regimeGauge != null ? (
                  <div className={styles.gaugeWrap}>
                    <HalfGauge value={regimeGauge} />
                    <p className={styles.gaugeLabel}>{uiText(uiLang, DASHBOARD_UI.gateScore)}</p>
                  </div>
                ) : null}
              </div>
            </article>

            <article className={styles.card}>
              <p className={styles.kicker}>{uiText(uiLang, DASHBOARD_UI.cardLeverage)}</p>
              <h3 className={styles.headline}>{leverageMode.label}</h3>
              <span className={`${styles.pill} ${leverageMode.toneClassName}`}>{leverageMode.label}</span>
              <p className={styles.teaser}>{leverageMode.line}</p>
              <p className={styles.meta}>
                {engineText(contentLang, DASHBOARD_ENGINE.tqqqMeta, {
                  dd: vrTqqqDd != null ? `${vrTqqqDd.toFixed(1)}%` : '--',
                  bottom: bottomSignal,
                  rebound: reboundSignal,
                })}
              </p>
              <p className={styles.meta}>
                {engineText(contentLang, DASHBOARD_ENGINE.tqqqDd135, {
                  dd1: formatPct1(tqqqDd1),
                  dd3: formatPct1(tqqqDd3),
                  dd5: formatPct1(tqqqDd5),
                })}
              </p>
              <p className={styles.meta}>
                {engineText(contentLang, DASHBOARD_ENGINE.tqqqPeakBottom, {
                  drop: formatPct1(dropToBottomPct),
                  rebound: formatPct1(reboundFromBottomPct),
                  bottomMeta: bottomDate
                    ? engineText(contentLang, DASHBOARD_ENGINE.bottomMeta, {
                        bottomDate,
                        days: daysSinceBottom ?? 0,
                      })
                    : '',
                })}
              </p>
              <p className={styles.meta}>{engineText(contentLang, DASHBOARD_ENGINE.reboundStage, { stage: reboundStage })}</p>
              {topPattern ? <p className={styles.meta}>{uiText(uiLang, DASHBOARD_UI.labelPattern)}: {toTeaser(topPattern, 64)}</p> : null}
              {vrPosture.length ? <p className={styles.meta}>{uiText(uiLang, DASHBOARD_UI.labelVrPosture)}: {toTeaser(vrPosture.slice(0, 2).join(' / '), 92)}</p> : null}
              <div className={styles.linkRow}>
                <Link href="/vr-survival" className={styles.linkPrimary}>
                  {uiText(uiLang, DASHBOARD_UI.openLeverageLens)}
                </Link>
              </div>
            </article>

            <article className={styles.card}>
              <p className={styles.kicker}>{uiText(uiLang, DASHBOARD_UI.cardQueue)}</p>
              <ul className={styles.list}>
                {queueRows.map((row, idx) => (
                  <li className={styles.listItem} key={`queue-${idx}`}>
                    <span className={styles.dot} />
                    <span className={styles.teaser}>{row}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className={styles.card}>
              <p className={styles.kicker}>{uiText(uiLang, DASHBOARD_UI.cardEvent)}</p>
              <ul className={styles.list}>
                {eventRows.map((row, idx) => (
                  <li className={styles.listItem} key={`event-${idx}`}>
                    <span className={styles.dot} />
                    <span className={styles.teaser}>{row}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className={`${styles.card} ${styles.cardNews}`}>
              <p className={styles.kicker}>{uiText(uiLang, DASHBOARD_UI.cardNews)}</p>
              <h3 className={styles.headline}>{toTeaser(headline, 95)}</h3>
              <p className={styles.teaser}>{teaser}</p>
              <p className={styles.meta}>{uiText(uiLang, DASHBOARD_UI.whyMatters)}: {whyMatters}</p>
              <div className={styles.linkRow}>
                <Link href="/briefing" className={styles.linkPrimary}>
                  {uiText(uiLang, DASHBOARD_UI.fullBriefing)}
                </Link>
                <Link href="/news" className={styles.linkSecondary}>
                  {uiText(uiLang, DASHBOARD_UI.newsDetail)}
                </Link>
              </div>
            </article>

            <article className={styles.card}>
              <p className={styles.kicker}>{uiText(uiLang, DASHBOARD_UI.cardBreadth)}</p>
              <div className={styles.gaugeRow}>
                <div>
                  <h3 className={styles.headline}>
                    {breadthState} - {uiText(uiLang, DASHBOARD_UI.labelFlow)}{' '}
                    {latestSnapshot?.phase_shift_flag
                      ? uiText(uiLang, DASHBOARD_UI.flowShiftDetected)
                      : uiText(uiLang, DASHBOARD_UI.flowMonitorMode)}
                  </h3>
                  <div className={styles.valueRow}>
                    <span className={styles.pill}>{uiText(uiLang, DASHBOARD_UI.labelAboveMa200)} {breadthPct != null ? `${breadthPct.toFixed(1)}%` : '--'}</span>
                    <span className={styles.pill}>{uiText(uiLang, DASHBOARD_UI.labelGate)} d5 {formatPct(typeof latestSnapshot?.gate_delta_5d === 'number' ? latestSnapshot.gate_delta_5d : null)}</span>
                    <span className={styles.pill}>{uiText(uiLang, DASHBOARD_UI.labelTracked)} {latestSnapshot?.total_stocks ?? '--'} {uiText(uiLang, DASHBOARD_UI.labelNames)}</span>
                  </div>
                  <p className={styles.meta}>
                    {uiText(uiLang, DASHBOARD_UI.labelBreadth)} {localizeByMap(riskV1.breadth?.health_label, contentLang, BREADTH_LABELS)} - {uiText(uiLang, DASHBOARD_UI.labelDivergence)} {localizeByMap(riskV1.breadth?.divergence_signal, contentLang, DIVERGENCE_LABELS)}
                  </p>
                </div>
                <div className={styles.gaugeWrap}>
                  <HalfGauge value={breadthGauge} />
                  <p className={styles.gaugeLabel}>{uiText(uiLang, DASHBOARD_UI.breadthPulse)}</p>
                </div>
              </div>
            </article>
          </div>
        </section>

        <aside className={styles.railPanel}>
          <section className={styles.railSection}>
            <p className={styles.railHeader}>{uiText(uiLang, DASHBOARD_UI.railIndices)}</p>
            <table className={styles.ladder}>
              <tbody>
                {indexRows.map((row) => (
                  <tr key={`idx-${row.symbol}`}>
                    <td className={styles.sym}>{row.symbol}</td>
                    <td className={toneClass(row.chgPct)}>{formatPct(row.chgPct)}</td>
                    <td className={styles.last}>{formatNumber(row.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.railSection}>
            <p className={styles.railHeader}>{uiText(uiLang, DASHBOARD_UI.railRatesFx)}</p>
            <table className={styles.ladder}>
              <tbody>
                {ratesFxRows.map((row) => (
                  <tr key={`rates-${row.symbol}`}>
                    <td className={styles.sym}>{row.symbol}</td>
                    <td className={toneClass(row.chgPct)}>{formatPct(row.chgPct)}</td>
                    <td className={styles.last}>{formatNumber(row.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.railSection}>
            <p className={styles.railHeader}>{uiText(uiLang, DASHBOARD_UI.railCommoditiesAlt)}</p>
            <table className={styles.ladder}>
              <tbody>
                {commodityRows.map((row) => (
                  <tr key={`cmd-${row.symbol}`}>
                    <td className={styles.sym}>{row.symbol}</td>
                    <td className={toneClass(row.chgPct)}>{formatPct(row.chgPct)}</td>
                    <td className={styles.last}>{formatNumber(row.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.railSection}>
            <p className={styles.railHeader}>{uiText(uiLang, DASHBOARD_UI.railHeadlineTape)}</p>
            <div className={styles.tapeList}>
              {tapeHeadlines.map((item, idx) => (
                <article className={styles.tapeItem} key={`tape-${idx}`}>
                  <p className={styles.tapeTime}>{item.time}</p>
                  <p className={styles.tapeHeadline}>{item.text}</p>
                  <p className={styles.tapeSource}>{uiText(uiLang, DASHBOARD_UI.sourceDailyBriefingCache)}</p>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}





