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
  pageTitle: { ko: '리스크 시큐리티 매니저-베타', en: 'Risk Security Manager-Beta' },
  pageSubtitle: { ko: '레트로 터미널 포지션 보드 - 구조 우선 - 디테일은 후속', en: 'retro terminal posture board - structure first - detail later' },
  asOf: { ko: '기준', en: 'AS OF' },
  cardRegime: { ko: '시장 국면 & 포지션', en: 'Market Regime & Posture' },
  cardLeverage: { ko: '레버리지 렌즈', en: 'Leverage Lens' },
  cardQueue: { ko: '포지셔닝 큐', en: 'Positioning Queue' },
  cardEvent: { ko: '이벤트 시계 (24h)', en: 'Event Clock (24h)' },
  cardNews: { ko: '뉴스 슬라이스', en: 'News Slice' },
  cardBreadth: { ko: '브레드스 & 플로우', en: 'Breadth & Flow' },
  gateScore: { ko: '게이트 스코어', en: 'Gate Score' },
  breadthPulse: { ko: '브레드스 펄스', en: 'Breadth Pulse' },
  whyMatters: { ko: '핵심 해석', en: 'Why this matters' },
  openLeverageLens: { ko: '레버리지 렌즈 열기', en: 'Open Leverage Lens' },
  fullBriefing: { ko: '전체 브리핑', en: 'Full Briefing' },
  newsDetail: { ko: '뉴스 상세', en: 'News Detail' },
  railIndices: { ko: '지수', en: 'Indices' },
  railRatesFx: { ko: '금리 & 환율', en: 'Rates & FX' },
  railCommoditiesAlt: { ko: '원자재 & 대체자산', en: 'Commodities & Alt' },
  railHeadlineTape: { ko: '헤드라인 테이프', en: 'Headline Tape' },
  sourceDailyBriefingCache: { ko: '출처: 데일리 브리핑 캐시', en: 'Source: Daily briefing cache' },
  gateEstimated: { ko: '추정', en: 'est' },
  flowShiftDetected: { ko: '플로우 전환 감지', en: 'shift detected' },
  flowMonitorMode: { ko: '플로우 모니터 모드', en: 'monitor mode' },
  labelRegime: { ko: '레짐', en: 'Regime' },
  labelRisk: { ko: '리스크', en: 'Risk' },
  labelExposure: { ko: '익스포저', en: 'Exposure' },
  labelGate: { ko: '게이트', en: 'Gate' },
  labelDrawdown: { ko: '드로우다운', en: 'Drawdown' },
  labelFlow: { ko: '플로우', en: 'Flow' },
  labelAboveMa200: { ko: 'MA200 상회', en: 'Above MA200' },
  labelTracked: { ko: '추적', en: 'Tracked' },
  labelNames: { ko: '종목', en: 'names' },
  labelBreadth: { ko: '브레드스', en: 'Breadth' },
  labelDivergence: { ko: '다이버전스', en: 'Divergence' },
  labelPattern: { ko: '패턴', en: 'Pattern' },
  labelVrPosture: { ko: 'VR 포지션', en: 'VR posture' },
} as const

const DASHBOARD_ENGINE = {
  regimeHeadline: { ko: '{{regime}} 레짐 · 리스크 {{riskLevel}}', en: '{{regime}} regime with {{riskLevel}} risk posture' },
  gateZoneUnavailable: { ko: '게이트 데이터 없음', en: 'unavailable' },
  gateZoneDefensive: { ko: '방어 구간', en: 'defensive zone' },
  gateZoneNeutral: { ko: '중립 구간', en: 'neutral zone' },
  gateZoneRiskOn: { ko: '리스크온 구간', en: 'risk-on zone' },
  gateGuide:
    { ko: '게이트 구간: 0-39 방어, 40-69 중립, 70-100 리스크온. 현재 {{current}}은(는) {{zone}}입니다.', en: 'Gate scale: 0-39 defensive, 40-69 neutral, 70-100 risk-on. Current {{current}} means {{zone}}.' },
  queueCore:
    { ko: '레짐 {{regime}} 동안 핵심 익스포저를 {{exposureBand}} 안에서 유지합니다.', en: 'Keep core exposure within {{exposureBand}} while regime is {{regime}}.' },
  queueGateAvailable:
    { ko: '게이트 {{gate}}: 돌파 추격보다 눌림 품질 확인 후 리스크를 추가합니다.', en: 'Gate score {{gate}}: add risk only on pullback quality, not breakaway spikes.' },
  queueGateUnavailable:
    { ko: '게이트 미확인: 게이트가 확인되기 전까지 리스크 패리티 포지션 유지.', en: 'Gate score unavailable: keep risk parity posture until gate data confirms.' },
  queueHighRisk:
    { ko: '헤지와 현금 버퍼를 우선하고 신규 레버리지는 보류합니다.', en: 'Prioritize hedge and cash buffer; defer fresh leverage entries.' },
  queueDefaultRisk:
    { ko: '분할 진입하고 단일 테마 집중도를 낮춥니다.', en: 'Use staged entries and reduce single-theme concentration risk.' },
  event0830:
    { ko: '08:30 ET - 매크로 발표 구간 (CPI/PPI/고용) 모니터링.', en: '08:30 ET - Macro releases window (CPI/PPI/Jobs feed watch).' },
  event1000:
    { ko: '10:00 ET - 장중 브레드스 + 금리 추세 재확인.', en: '10:00 ET - Intraday breadth check + rates trend confirmation.' },
  event1400:
    { ko: '14:00 ET - 연준 민감 시간대 (헤드라인 + 금리).', en: '14:00 ET - Fed tape sensitivity window (headlines + yields).' },
  event1600:
    { ko: '16:00 ET - 종가 점검: 신호 이탈 시에만 리밸런싱.', en: '16:00 ET - Close audit: rebalance only if signal drift persists.' },
  leverageDeRiskLabel: { ko: '레버리지 축소', en: 'DE-RISK LEVERAGE' },
  leverageDeRiskLine:
    { ko: '브레드스 확인 전까지 레버리지 규모를 줄이고 대기합니다.', en: 'Use smaller size, wait for breadth confirmation before adding leverage.' },
  leverageMeasuredLabel: { ko: '측정형 레버리지', en: 'MEASURED LEVERAGE' },
  leverageMeasuredLine:
    { ko: '레버리지는 전술적으로만 사용하고 오버나잇 집중을 피합니다.', en: 'Keep leverage tactical and avoid overnight concentration.' },
  leverageAllowedLabel: { ko: '레버리지 허용', en: 'LEVERAGE ALLOWED' },
  leverageAllowedLine:
    { ko: '추세가 우호적이지만 진입은 여전히 분할로 진행합니다.', en: 'Trend support is constructive, but entries should still be staged.' },
  tqqqMeta:
    { ko: 'TQQQ DD {{dd}} - 바닥: {{bottom}} - 반등: {{rebound}}', en: 'TQQQ DD {{dd}} - Bottom: {{bottom}} - Rebound: {{rebound}}' },
  tqqqDd135:
    { ko: 'TQQQ DD1/3/5: {{dd1}} / {{dd3}} / {{dd5}}', en: 'TQQQ DD1/3/5: {{dd1}} / {{dd3}} / {{dd5}}' },
  tqqqPeakBottom:
    { ko: '피크→저점 DD (45D): {{drop}} - 저점→현재 반등: {{rebound}}{{bottomMeta}}', en: 'Peak->Bottom DD (45D): {{drop}} - Bottom->Now Rebound: {{rebound}}{{bottomMeta}}' },
  reboundStage: { ko: '반등 단계: {{stage}}', en: 'Rebound stage: {{stage}}' },
  bottomMeta:
    { ko: ' (저점 {{bottomDate}}, +{{days}}일)', en: ' (bottom {{bottomDate}}, +{{days}}d)' },
  bottomSignalPattern: { ko: '바닥 패턴 감지', en: 'Bottoming analog detected' },
  bottomSignalDeepDd: { ko: '깊은 DD 구간: 바닥 확인 전 관망', en: 'Deep DD zone: bottom watch only' },
  bottomSignalEarlyWatch: { ko: '초기 바닥 관찰 구간', en: 'Early bottom-watch posture' },
  bottomSignalNone: { ko: '바닥 확인 신호 없음', en: 'No bottom confirmation' },
  reboundSignalFragile: { ko: '반등 취약 (데드캣 위험)', en: 'Rebound is fragile (dead-cat risk)' },
  reboundSignalPossible: { ko: '지속 확인 시 반등 가능', en: 'Rebound possible with persistence confirmation' },
  reboundSignalNone: { ko: '반등 미확인', en: 'Rebound not confirmed' },
  reboundStageNa: { ko: 'N/A', en: 'N/A' },
  reboundStageEscapeConviction: { ko: '탈출 확신 (+30)', en: 'Escape conviction (+30)' },
  reboundStageEscapeEntry: { ko: '탈출 진입 (+25)', en: 'Escape entry (+25)' },
  reboundStageRebound: { ko: '반등 (+20)', en: 'Rebound (+20)' },
  reboundStageEarly: { ko: '반등 초입 (+15)', en: 'Early rebound (+15)' },
  reboundStageWatch: { ko: '관찰 구간 (<+15)', en: 'Watch zone (<+15)' },
  breadthPending: { ko: '브레드스 데이터 대기', en: 'Breadth data pending' },
  breadthImproving: { ko: '브레드스 개선', en: 'Breadth improving' },
  breadthMixed: { ko: '브레드스 혼조', en: 'Breadth mixed' },
  breadthWeak: { ko: '브레드스 약세', en: 'Breadth weak' },
  fallbackHeadline: { ko: '구조 중심 터미널 대시보드가 활성화되었습니다.', en: 'Structure-first terminal dashboard is active.' },
  fallbackTeaser: { ko: '신호 맥락을 불러오는 중입니다. 우측 레일에서 오늘의 크로스에셋 펄스를 확인하세요.', en: 'Signal context is loading. Use right rail for today\'s cross-asset pulse.' },
  fallbackWhy: { ko: '헤드라인 변동성보다 레짐과 레버리지의 정합성을 우선합니다.', en: 'Keep posture and leverage in sync with regime, not with headline volatility.' },
} as const

const uiText = (lang: UiLang, text: { ko: string; en: string }): string => pickLang(lang, text.ko, text.en)

const engineText = (lang: UiLang, template: LocalizedText, vars: Record<string, string | number> = {}): string =>
  selectLocalizedText(renderEngineText(template, vars), lang)

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const hasHangul = (value: string): boolean => /[가-힣]/.test(value)
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
  TRANSITION: { ko: '전환', en: 'TRANSITION' },
  BULL: { ko: '강세', en: 'BULL' },
  BEAR: { ko: '약세', en: 'BEAR' },
  NEUTRAL: { ko: '중립', en: 'NEUTRAL' },
  RISK_ON: { ko: '리스크온', en: 'RISK_ON' },
  RISK_OFF: { ko: '리스크오프', en: 'RISK_OFF' },
}

const RISK_LABELS: Record<string, { ko: string; en: string }> = {
  LOW: { ko: '낮음', en: 'LOW' },
  MEDIUM: { ko: '중간', en: 'MEDIUM' },
  HIGH: { ko: '높음', en: 'HIGH' },
  EXTREME: { ko: '극단', en: 'EXTREME' },
}

const BREADTH_LABELS: Record<string, { ko: string; en: string }> = {
  IMPROVING: { ko: '개선', en: 'IMPROVING' },
  MIXED: { ko: '혼조', en: 'MIXED' },
  WEAK: { ko: '약화', en: 'WEAK' },
  STRONG: { ko: '강함', en: 'STRONG' },
  NORMAL: { ko: '보통', en: 'NORMAL' },
}

const DIVERGENCE_LABELS: Record<string, { ko: string; en: string }> = {
  TOP_WARNING_STRONG: { ko: '상단 경고(강)', en: 'TOP_WARNING_STRONG' },
  TOP_WARNING: { ko: '상단 경고', en: 'TOP_WARNING' },
  NONE: { ko: '없음', en: 'NONE' },
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
    engineText(contentLang, DASHBOARD_ENGINE.event1600),
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
  const tapeTimes = ['16:00 ET', '12:30 ET', '09:30 ET']
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
