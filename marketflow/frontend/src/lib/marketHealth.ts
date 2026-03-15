export type HealthMode = 'standard' | 'retirement'
export type ScoringMode = 'threshold' | 'percentile'
export type WeightsPreset = 'fixed' | 'regimeAdaptive'

export type HealthBucketKey = 'strong' | 'stable' | 'transition' | 'fragile' | 'risk'

export type HealthBucket = {
  key: HealthBucketKey
  min: number
  max: number
  labelEn: string
  labelKo: string
  color: string
}

export type StructuralComponent = {
  key: 'trend' | 'vol' | 'breadth' | 'liquidity'
  labelEn: string
  labelKo: string
  value: number // 0-25
  stateEn: string
  stateKo: string
}

export type RegimeMatrixState = {
  trendState: 'Positive' | 'Neutral' | 'Weak'
  volState: 'Compressed' | 'Normal' | 'Expanding'
  breadthState: 'Broad' | 'Mixed' | 'Narrow'
  liquidityState: 'Loose' | 'Neutral' | 'Tight'
  x: number // -1..1 breadth
  y: number // -1..1 liquidity (tight=-1 loose=1)
  zoneLabelEn: string
  zoneLabelKo: string
  quadrantLabelEn?: string
  quadrantLabelKo?: string
  zoneNarrativeEn?: string
  zoneNarrativeKo?: string
}

export type DiagnosticMetric = {
  key: string
  labelEn: string
  labelKo: string
  valueText: string
  status?: 'GOOD' | 'WATCH' | 'RISK' | 'NA'
  referenceText?: string
  sourceNote?: string
  meaningEn: string
  meaningKo: string
}

export type MetricRow = {
  key: string
  label: string
  labelKo: string
  labelEn: string
  valueText: string
  status: 'GOOD' | 'WATCH' | 'RISK' | 'NA'
  referenceText: string
  referenceKo: string
  referenceEn: string
  meaningText: string
  meaningKo: string
  meaningEn: string
  sourceNote?: string
}

export type RawInputs = {
  price_vs_sma200?: number
  sma50_vs_sma200?: number
  slope_sma200?: number
  vix_level?: number
  vix_change_5d?: number
  realized_vol_20d?: number
  pct_above_sma200?: number
  advance_decline?: number
  credit_spread?: number
  financial_conditions?: number
  dxy_change_20d?: number
}

export type ScoreComponent = {
  score: number
  confidence: number
  details: Array<{ key: string; s: number; weight: number }>
}

export type StructuralComponentScores = {
  trend: ScoreComponent
  vol: ScoreComponent
  breadth: ScoreComponent
  liquidity: ScoreComponent
}

export type StructuralScore = {
  total_raw: number
  total_smoothed: number
  total_final: number
  bucket: 'Strong' | 'Stable' | 'Transition' | 'Fragile' | 'Risk'
  components: StructuralComponentScores
  confidence?: number
  explain?: {
    topDrivers: {
      weakest: Array<{ key: keyof StructuralComponentScores; score: number }>
      strongest: Array<{ key: keyof StructuralComponentScores; score: number }>
    }
    whyText: { en: string; ko: string }
  }
}

export type StructuralScoringConfig = {
  scoringMode: ScoringMode
  weightsPreset: WeightsPreset
  alpha: number
  maxStep: number
}

export type SHSActionGuide = {
  equityTilt: { en: string; ko: string }
  riskPosture: { en: string; ko: string }
  exposureBand: string
  rebalanceBias: { en: 'Add risk' | 'Hold' | 'Trim risk'; ko: '리스크 추가' | '유지' | '리스크 축소' }
  reason: { en: string; ko: string }
  guardrails: Array<{ en: string; ko: string }>
}

export const MARKET_HEALTH_CONFIG: StructuralScoringConfig = {
  scoringMode: 'threshold',
  weightsPreset: 'fixed',
  alpha: 0.25,
  maxStep: 8,
}

export const HEALTH_BUCKETS: HealthBucket[] = [
  { key: 'strong', min: 80, max: 100, labelEn: 'Structurally Strong', labelKo: '구조적으로 강함', color: 'var(--risk-1)' },
  { key: 'stable', min: 60, max: 79, labelEn: 'Stable', labelKo: '안정', color: 'var(--risk-0)' },
  { key: 'transition', min: 40, max: 59, labelEn: 'Transition', labelKo: '전환', color: 'var(--risk-2)' },
  { key: 'fragile', min: 20, max: 39, labelEn: 'Fragile', labelKo: '취약', color: 'var(--risk-3)' },
  { key: 'risk', min: 0, max: 19, labelEn: 'Structural Risk', labelKo: '구조 리스크', color: 'var(--risk-4)' },
]

export function scoreToBucket(score: number): HealthBucket {
  return HEALTH_BUCKETS.find((b) => score >= b.min && score <= b.max) ?? HEALTH_BUCKETS[2]
}

export function shsBucketFromScore(score: number): StructuralScore['bucket'] {
  if (score >= 80) return 'Strong'
  if (score >= 60) return 'Stable'
  if (score >= 40) return 'Transition'
  if (score >= 20) return 'Fragile'
  return 'Risk'
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function aggregateThresholdComponent(
  rows: Array<{ key: string; weight: number; value: number | undefined; scoreFn: (v: number) => number }>,
): ScoreComponent {
  const details: Array<{ key: string; s: number; weight: number }> = []
  let weighted = 0
  let used = 0
  let total = 0
  for (const r of rows) {
    total += r.weight
    if (typeof r.value !== 'number' || Number.isNaN(r.value)) continue
    const s = clamp(r.scoreFn(r.value), 0, 25)
    details.push({ key: r.key, s, weight: r.weight })
    weighted += s * r.weight
    used += r.weight
  }
  if (used === 0) {
    return { score: 12.5, confidence: 0, details: [] }
  }
  return {
    score: Number((weighted / used).toFixed(2)),
    confidence: Number((used / total).toFixed(2)),
    details,
  }
}

function tierScore(v: number, cuts: Array<{ test: (x: number) => boolean; score: number }>, fallback = 12.5) {
  for (const c of cuts) if (c.test(v)) return c.score
  return fallback
}

function thresholdModuleScores(inputs: RawInputs) {
  const trend = aggregateThresholdComponent([
    {
      key: 'price_vs_sma200',
      weight: 0.5,
      value: inputs.price_vs_sma200,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x >= 5, score: 25 },
          { test: (x) => x >= 1, score: 20 },
          { test: (x) => x > -2, score: 12.5 },
          { test: (x) => x > -6, score: 5 },
          { test: () => true, score: 0 },
        ]),
    },
    {
      key: 'sma50_vs_sma200',
      weight: 0.3,
      value: inputs.sma50_vs_sma200,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x >= 2, score: 25 },
          { test: (x) => x >= 0, score: 20 },
          { test: (x) => x > -2, score: 10 },
          { test: () => true, score: 0 },
        ]),
    },
    {
      key: 'slope_sma200',
      weight: 0.2,
      value: inputs.slope_sma200,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x > 0.15, score: 25 },
          { test: (x) => x > 0.03, score: 18 },
          { test: (x) => x >= -0.03, score: 10 },
          { test: () => true, score: 2 },
        ]),
    },
  ])

  const vol = aggregateThresholdComponent([
    {
      key: 'vix_level',
      weight: 0.45,
      value: inputs.vix_level,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x < 15, score: 25 },
          { test: (x) => x < 18, score: 20 },
          { test: (x) => x < 24, score: 12.5 },
          { test: (x) => x < 30, score: 5 },
          { test: () => true, score: 0 },
        ]),
    },
    {
      key: 'vix_change_5d',
      weight: 0.25,
      value: inputs.vix_change_5d,
      scoreFn: (v) => {
        const a = Math.abs(v)
        return tierScore(a, [
          { test: (x) => x < 3, score: 20 },
          { test: (x) => x < 8, score: 12.5 },
          { test: (x) => x < 15, score: 5 },
          { test: () => true, score: 0 },
        ])
      },
    },
    {
      key: 'realized_vol_20d',
      weight: 0.3,
      value: inputs.realized_vol_20d,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x < 14, score: 23 },
          { test: (x) => x < 20, score: 18 },
          { test: (x) => x < 28, score: 10 },
          { test: () => true, score: 3 },
        ]),
    },
  ])

  const breadth = aggregateThresholdComponent([
    {
      key: 'pct_above_sma200',
      weight: 0.65,
      value: inputs.pct_above_sma200,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x >= 70, score: 25 },
          { test: (x) => x >= 55, score: 20 },
          { test: (x) => x >= 40, score: 12.5 },
          { test: (x) => x >= 25, score: 5 },
          { test: () => true, score: 0 },
        ]),
    },
    {
      key: 'advance_decline',
      weight: 0.35,
      value: inputs.advance_decline,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x >= 1, score: 24 },
          { test: (x) => x >= 0.2, score: 18 },
          { test: (x) => x > -0.2, score: 10 },
          { test: (x) => x > -1, score: 4 },
          { test: () => true, score: 0 },
        ]),
    },
  ])

  const liquidity = aggregateThresholdComponent([
    {
      key: 'credit_spread',
      weight: 0.45,
      value: inputs.credit_spread,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x < 1.1, score: 24 },
          { test: (x) => x < 1.6, score: 18 },
          { test: (x) => x < 2.2, score: 10 },
          { test: () => true, score: 2 },
        ]),
    },
    {
      key: 'financial_conditions',
      weight: 0.35,
      value: inputs.financial_conditions,
      scoreFn: (v) =>
        tierScore(v, [
          { test: (x) => x < -0.3, score: 24 },
          { test: (x) => x < 0.2, score: 18 },
          { test: (x) => x < 0.8, score: 10 },
          { test: () => true, score: 2 },
        ]),
    },
    {
      key: 'dxy_change_20d',
      weight: 0.2,
      value: inputs.dxy_change_20d,
      scoreFn: (v) => {
        const a = Math.abs(v)
        return tierScore(a, [
          { test: (x) => x < 2, score: 22 },
          { test: (x) => x < 5, score: 15 },
          { test: (x) => x < 8, score: 8 },
          { test: () => true, score: 2 },
        ])
      },
    },
  ])
  return { trend, vol, breadth, liquidity }
}

function renormalizedTotal(components: StructuralScore['components']) {
  const vals = Object.values(components)
  const present = vals.filter((c) => c.confidence > 0)
  if (!present.length) return { total: 50, confidence: 0 }
  const sum = present.reduce((acc, c) => acc + c.score, 0)
  const total = (sum / (present.length * 25)) * 100
  const confidence = vals.reduce((acc, c) => acc + c.confidence, 0) / vals.length
  return { total: clamp(total, 0, 100), confidence: clamp(confidence, 0, 1) }
}

function moduleDisplayName(key: keyof StructuralScore['components']) {
  switch (key) {
    case 'trend':
      return { en: 'trend alignment', ko: '추세 정렬도' }
    case 'vol':
      return { en: 'volatility stability', ko: '변동성 안정성' }
    case 'breadth':
      return { en: 'breadth strength', ko: '시장 확산도' }
    case 'liquidity':
      return { en: 'liquidity condition', ko: '유동성 상태' }
  }
}

export function buildSHSExplain(components: StructuralScore['components']) {
  const ranked = (Object.entries(components) as Array<[keyof StructuralScore['components'], ScoreComponent]>)
    .map(([key, comp]) => ({ key, score: Number(comp.score.toFixed(2)) }))
    .sort((a, b) => a.score - b.score)
  const weakest = ranked.slice(0, 2)
  const strongest = [...ranked].reverse().slice(0, 2)
  const w0 = weakest[0] ? moduleDisplayName(weakest[0].key) : null
  const w1 = weakest[1] ? moduleDisplayName(weakest[1].key) : null
  const s0 = strongest[0] ? moduleDisplayName(strongest[0].key) : null

  return {
    topDrivers: { weakest, strongest },
    whyText: {
      en: `${w0?.en ?? 'Structure'} is the weakest link${w1 ? `, and ${w1.en} is also soft` : ''}; ${s0?.en ?? 'another module'} remains relatively supportive.`,
      ko: `${w0?.ko ?? '구조'}가 가장 약한 축이며${w1 ? `, ${w1.ko}도 부담 요인입니다` : ''}. 반면 ${s0?.ko ?? '다른 축'}는 상대적으로 지지력이 있습니다.`,
    },
  }
}

export function getModeCopy(
  mode: HealthMode,
  context?: { bucketKey?: HealthBucketKey | null; stale?: boolean; confidence?: number | null },
) {
  const weak = context?.bucketKey === 'fragile' || context?.bucketKey === 'risk'
  if (mode === 'retirement') {
    return {
      title: { ko: '자본 안정성 관점', en: 'Capital Stability View' },
      summary: weak
        ? { ko: '낙폭 압력과 인출 안정성을 우선 점검하는 보수적 해석이 필요합니다.', en: 'Prioritize drawdown pressure and withdrawal safety before adding risk.' }
        : { ko: '안정성과 인출 안전성을 우선하면서 점진적으로 참여하는 해석이 적합합니다.', en: 'Keep participation measured while prioritizing stability and withdrawal safety.' },
      bullets: [
        { ko: '자본 보존 우선', en: 'Preserve capital first' },
        { ko: '현금 버퍼 유지', en: 'Keep a cash buffer' },
        { ko: '무리한 리스크 확대 자제', en: 'Avoid forced risk expansion' },
      ],
    }
  }
  return {
    title: { ko: '구조 건강도 관점', en: 'Structural Health View' },
    summary: weak
      ? { ko: '구조 취약성이 높아 포지션 속도 조절과 확인 신호가 중요합니다.', en: 'Structure is fragile enough to justify slower positioning and cleaner confirmation.' }
      : { ko: '구조는 점진적 포지셔닝을 지지하며, 확산도와 유동성이 속도 조절 기준입니다.', en: 'Structure supports measured positioning; breadth and liquidity should guide pacing.' },
    bullets: [
      { ko: '구조 기준으로 비중 조절', en: 'Size positions by structure' },
      { ko: '확산도 약할 때 추격 자제', en: 'Avoid chasing weak breadth' },
      { ko: '유동성 악화 시 재점검', en: 'Reassess if liquidity tightens' },
    ],
  }
}

export function computeStructuralHealthScore(
  inputs: RawInputs,
  ctx: { lookbackSeries: Record<string, number[]>; prevScore?: number; prevEma?: number },
  cfg: Partial<StructuralScoringConfig> = {},
): StructuralScore {
  const config: StructuralScoringConfig = { ...MARKET_HEALTH_CONFIG, ...cfg }
  const components = thresholdModuleScores(inputs)
  // percentile mode reserved for next step
  void ctx.lookbackSeries
  void config.scoringMode
  void config.weightsPreset

  const { total, confidence } = renormalizedTotal(components)
  const total_raw = Number(total.toFixed(2))
  const prevEma = typeof ctx.prevEma === 'number' ? ctx.prevEma : ctx.prevScore
  const alpha = clamp(config.alpha, 0.05, 0.95)
  const total_smoothed = Number((prevEma == null ? total_raw : alpha * total_raw + (1 - alpha) * prevEma).toFixed(2))

  let total_final = total_smoothed
  if (typeof ctx.prevScore === 'number') {
    const maxStep = clamp(config.maxStep, 1, 20)
    total_final = clamp(total_smoothed, ctx.prevScore - maxStep, ctx.prevScore + maxStep)
  }
  // Small confidence penalty only when data is materially limited
  if (confidence < 0.7) {
    total_final = total_final * (0.92 + confidence * 0.08)
  }
  total_final = Number(clamp(total_final, 0, 100).toFixed(2))

  return {
    total_raw,
    total_smoothed,
    total_final,
    bucket: shsBucketFromScore(total_final),
    components,
    confidence: Number(confidence.toFixed(2)),
    explain: buildSHSExplain(components),
  }
}

type SummaryInput = {
  trend: StructuralComponent
  vol: StructuralComponent
  breadth: StructuralComponent
  liquidity: StructuralComponent
  scoreBucket: HealthBucket
  mode: HealthMode
}

export function generateStructuralSummary(input: SummaryInput) {
  const postureKo =
    input.scoreBucket.key === 'strong' || input.scoreBucket.key === 'stable'
      ? '구조적 안정성이 유지되는 편입니다'
      : input.scoreBucket.key === 'transition'
      ? '구조 신호가 혼합되어 확인 구간으로 보는 편이 합리적입니다'
      : '구조적 취약성이 커져 보수적 해석이 필요합니다'
  const postureEn =
    input.scoreBucket.key === 'strong' || input.scoreBucket.key === 'stable'
      ? 'Structural conditions remain broadly supportive.'
      : input.scoreBucket.key === 'transition'
      ? 'Signals are mixed, so a confirmation mindset is more appropriate.'
      : 'Structural fragility is elevated, calling for a more defensive read.'

  if (input.mode === 'retirement') {
    return {
      ko: `${postureKo} 은퇴 관점에서는 낙폭 지속성과 현금흐름 안정성을 우선 확인해야 합니다. 변동성보다 자본 보존 리듬에 초점을 맞추는 해석이 유리합니다.`,
      en: `${postureEn} In retirement mode, prioritize drawdown persistence and capital stability over short-term upside. Focus on preservation rhythm rather than market speed.`,
    }
  }

  return {
    ko: `${postureKo} 추세·변동성·확산도·유동성 조합을 보면 공격/방어를 크게 바꾸기보다 구조 확인에 맞춘 포지션 조절이 유효합니다.`,
    en: `${postureEn} The trend-volatility-breadth-liquidity mix supports position sizing based on structure confirmation rather than abrupt shifts in stance.`,
  }
}

export function mapBucketToPosture(bucket: HealthBucket, mode: HealthMode) {
  if (mode === 'retirement') {
    if (bucket.key === 'strong') return { equityTiltEn: 'Overweight', equityTiltKo: '확대', riskPostureEn: 'Balanced', riskPostureKo: '균형', noteEn: 'Preservation rules still apply.', noteKo: '자본 보존 규칙은 유지하세요.' }
    if (bucket.key === 'stable') return { equityTiltEn: 'Neutral', equityTiltKo: '중립', riskPostureEn: 'Balanced', riskPostureKo: '균형', noteEn: 'Rebalance gradually.', noteKo: '점진적 리밸런싱 중심.' }
    if (bucket.key === 'transition') return { equityTiltEn: 'Neutral', equityTiltKo: '중립', riskPostureEn: 'Defensive', riskPostureKo: '방어적', noteEn: 'Trim speed before size.', noteKo: '비중보다 속도 조절 우선.' }
    return { equityTiltEn: 'Underweight', equityTiltKo: '축소', riskPostureEn: 'Defensive', riskPostureKo: '방어적', noteEn: 'Protect withdrawal runway.', noteKo: '인출 여력 보존 우선.' }
  }

  if (bucket.key === 'strong') return { equityTiltEn: 'Overweight', equityTiltKo: '확대', riskPostureEn: 'Offensive', riskPostureKo: '공격적', noteEn: 'Still scale in, do not chase.', noteKo: '추격보다 분할 접근 유지.' }
  if (bucket.key === 'stable') return { equityTiltEn: 'Neutral', equityTiltKo: '중립', riskPostureEn: 'Balanced', riskPostureKo: '균형', noteEn: 'Add selectively on confirmation.', noteKo: '확인 신호 중심 선택적 확대.' }
  if (bucket.key === 'transition') return { equityTiltEn: 'Neutral', equityTiltKo: '중립', riskPostureEn: 'Balanced', riskPostureKo: '균형', noteEn: 'Wait for cleaner structure.', noteKo: '구조 확인 전까지 속도 조절.' }
  if (bucket.key === 'fragile') return { equityTiltEn: 'Underweight', equityTiltKo: '축소', riskPostureEn: 'Defensive', riskPostureKo: '방어적', noteEn: 'Preserve flexibility.', noteKo: '현금/유연성 확보 우선.' }
  return { equityTiltEn: 'Underweight', equityTiltKo: '축소', riskPostureEn: 'Defensive', riskPostureKo: '방어적', noteEn: 'Risk control first.', noteKo: '리스크 관리 최우선.' }
}

export function mapSHSToAction(
  bucket: StructuralScore['bucket'],
  components: StructuralScore['components'],
  mode: HealthMode = 'standard',
): SHSActionGuide {
  const breadthWeak = components.breadth.score < 10
  const volWeak = components.vol.score < 10
  const trendStrong = components.trend.score >= 18
  const weakest = (Object.entries(components) as Array<[keyof StructuralScore['components'], ScoreComponent]>)
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, 2)
    .map(([k]) => k)
  const guardrailsByWeakness = () => {
    const out: Array<{ en: string; ko: string }> = []
    if (weakest.includes('breadth')) out.push({ en: 'Avoid concentration in narrow leadership', ko: '좁은 주도주 집중을 피하세요' })
    if (weakest.includes('liquidity')) out.push({ en: 'Keep a cash buffer and reduce leverage speed', ko: '현금 버퍼를 유지하고 레버리지 속도를 낮추세요' })
    if (weakest.includes('vol')) out.push({ en: 'Prefer staged entries over aggressive adds', ko: '공격적 확대보다 분할 진입을 우선하세요' })
    if (weakest.includes('trend')) out.push({ en: 'Wait for cleaner trend confirmation', ko: '추세 확인 신호를 더 기다리세요' })
    return out.slice(0, 2)
  }
  const rebalanceBias = (b: StructuralScore['bucket']): SHSActionGuide['rebalanceBias'] =>
    b === 'Strong'
      ? { en: 'Add risk', ko: '리스크 추가' }
      : b === 'Stable' || b === 'Transition'
      ? { en: 'Hold', ko: '유지' }
      : { en: 'Trim risk', ko: '리스크 축소' }

  if (mode === 'retirement') {
    if (bucket === 'Strong') {
      return {
        equityTilt: { en: 'Overweight', ko: '확대' },
        riskPosture: { en: 'Balanced', ko: '균형' },
        exposureBand: '70–90',
        rebalanceBias: { en: 'Hold', ko: '유지' },
        reason: {
          en: 'Structure is supportive, but retirement mode still prioritizes capital stability rules.',
          ko: '구조는 우호적이지만, 은퇴 모드에서는 자본 안정성 규칙을 우선합니다.',
        },
        guardrails: [
          { en: 'Keep withdrawal reserve intact', ko: '인출용 현금 버퍼를 유지하세요' },
          { en: 'Add risk gradually, not all at once', ko: '비중 확대는 한 번에 하지 말고 점진적으로 진행하세요' },
        ],
      }
    }
    if (bucket === 'Stable') {
      return {
        equityTilt: { en: 'Neutral', ko: '중립' },
        riskPosture: { en: 'Balanced', ko: '균형' },
        exposureBand: '50–70',
        rebalanceBias: { en: 'Hold', ko: '유지' },
        reason: {
          en: 'Stable structure supports gradual rebalancing rather than aggressive shifts.',
          ko: '안정 구간이므로 공격적 전환보다 점진적 리밸런싱이 적합합니다.',
        },
        guardrails: [
          { en: 'Rebalance in small steps', ko: '리밸런싱은 작은 단위로 진행하세요' },
          { en: 'Favor quality and lower drawdown profiles', ko: '낙폭이 낮은 자산 비중을 우선하세요' },
        ],
      }
    }
    if (bucket === 'Transition') {
      return {
        equityTilt: { en: 'Neutral', ko: '중립' },
        riskPosture: { en: 'Defensive', ko: '방어적' },
        exposureBand: '40–60',
        rebalanceBias: { en: 'Trim risk', ko: '리스크 축소' },
        reason: {
          en: 'Mixed structure suggests reducing pace until conditions confirm.',
          ko: '구조 신호가 혼합되어 있어 확인 전까지 속도 조절이 필요합니다.',
        },
        guardrails: [
          { en: 'Reduce cyclicality before size increases', ko: '비중 확대 전 경기민감 비중부터 줄이세요' },
          { en: 'Maintain capital preservation bias', ko: '자본 보존 성향을 유지하세요' },
        ],
      }
    }
    return {
      equityTilt: { en: 'Underweight', ko: '축소' },
      riskPosture: { en: 'Defensive', ko: '방어적' },
      exposureBand: '30–50',
      rebalanceBias: { en: 'Trim risk', ko: '리스크 축소' },
      reason: {
        en: 'Fragile conditions favor capital preservation and withdrawal runway protection.',
        ko: '취약 구간에서는 자본 보존과 인출 여력 보호가 우선입니다.',
      },
      guardrails: [
        { en: 'Protect withdrawal runway first', ko: '인출 여력 보호를 최우선으로 두세요' },
        { en: 'Keep higher cash / short-duration buffer', ko: '현금/단기 안전자산 비중을 높게 유지하세요' },
      ],
    }
  }

  if (bucket === 'Strong') {
    return {
      equityTilt: { en: 'Overweight', ko: '확대' },
      riskPosture: { en: 'Offensive', ko: '공격적' },
      exposureBand: trendStrong ? '70–90' : '60–80',
      rebalanceBias: rebalanceBias(bucket),
      reason: {
        en: 'Structure is broadly supportive, but position sizing should still be scaled in.',
        ko: '구조가 전반적으로 우호적이지만, 비중은 분할 방식으로 확대하는 편이 좋습니다.',
      },
      guardrails: [
        { en: 'Scale in rather than chase breakouts', ko: '추격보다 분할 확대를 유지하세요' },
        { en: 'Avoid single-theme concentration', ko: '단일 테마 집중을 피하세요' },
      ],
    }
  }
  if (bucket === 'Stable') {
    return {
      equityTilt: { en: 'Neutral', ko: '중립' },
      riskPosture: { en: 'Balanced', ko: '균형' },
      exposureBand: breadthWeak ? '50–70' : '60–80',
      rebalanceBias: rebalanceBias(bucket),
      reason: {
        en: 'Stable conditions support selective adds, with confirmation preferred over chasing.',
        ko: '안정 구간에서는 추격보다 확인 신호 중심의 선택적 확대가 적합합니다.',
      },
      guardrails: guardrailsByWeakness(),
    }
  }
  if (bucket === 'Transition') {
    return {
      equityTilt: { en: 'Neutral', ko: '중립' },
      riskPosture: { en: 'Balanced', ko: '균형' },
      exposureBand: '50–70',
      rebalanceBias: rebalanceBias(bucket),
      reason: {
        en: 'Mixed structure argues for neutral positioning until trend and breadth align.',
        ko: '추세와 확산도가 정렬되기 전까지는 중립 포지셔닝이 합리적입니다.',
      },
      guardrails: guardrailsByWeakness(),
    }
  }
  if (bucket === 'Fragile') {
    return {
      equityTilt: { en: 'Underweight', ko: '축소' },
      riskPosture: { en: 'Defensive', ko: '방어적' },
      exposureBand: volWeak ? '30–50' : '20–40',
      rebalanceBias: rebalanceBias(bucket),
      reason: {
        en: 'Fragile structure raises the value of flexibility and capital preservation.',
        ko: '구조 취약 구간에서는 유연성과 자본 보존의 가치가 커집니다.',
      },
      guardrails: guardrailsByWeakness(),
    }
  }
  return {
    equityTilt: { en: 'Underweight', ko: '축소' },
    riskPosture: { en: 'Defensive', ko: '방어적' },
    exposureBand: '10–30',
    rebalanceBias: rebalanceBias(bucket),
    reason: {
      en: 'Structural risk is dominant; risk control should take priority over return-seeking.',
      ko: '구조 리스크가 우세하여 수익 추구보다 리스크 관리가 우선입니다.',
    },
    guardrails: [
      { en: 'Prioritize risk control over return-seeking', ko: '수익 추구보다 리스크 관리를 우선하세요' },
      { en: 'Keep exposure light and liquid', ko: '노출은 낮고 유동적인 자산 중심으로 유지하세요' },
    ],
  }
}

type RegimeRawInputs = {
  distPct?: number | null
  volRatio?: number | null
  gateScore?: number | null
  liquidityScore?: number | null
  scoreBucket: HealthBucket
}

export function computeRegimeState(raw: RegimeRawInputs): RegimeMatrixState {
  const trendState: RegimeMatrixState['trendState'] =
    raw.distPct == null ? 'Neutral' : raw.distPct >= 2 ? 'Positive' : raw.distPct <= -2 ? 'Weak' : 'Neutral'
  const volState: RegimeMatrixState['volState'] =
    raw.volRatio == null ? 'Normal' : raw.volRatio < 0.95 ? 'Compressed' : raw.volRatio > 1.15 ? 'Expanding' : 'Normal'
  const breadthState: RegimeMatrixState['breadthState'] =
    raw.gateScore == null ? 'Mixed' : raw.gateScore >= 65 ? 'Broad' : raw.gateScore >= 40 ? 'Mixed' : 'Narrow'
  const liquidityState: RegimeMatrixState['liquidityState'] =
    raw.liquidityScore == null ? 'Neutral' : raw.liquidityScore >= 60 ? 'Loose' : raw.liquidityScore >= 40 ? 'Neutral' : 'Tight'
  const x = breadthState === 'Broad' ? 0.8 : breadthState === 'Mixed' ? 0 : -0.8
  const y = liquidityState === 'Loose' ? 0.8 : liquidityState === 'Neutral' ? 0 : -0.8
  const quadrant =
    x >= 0 && y >= 0
      ? { en: 'Supportive (Broad + Loose)', ko: '지지 구간 (확산 + 완화)' }
      : x < 0 && y >= 0
      ? { en: 'Late-cycle risk (Narrow + Loose)', ko: '후반부 리스크 (협소 + 완화)' }
      : x >= 0 && y < 0
      ? { en: 'Selective (Broad + Tight)', ko: '선별 구간 (확산 + 타이트)' }
      : { en: 'Fragile (Narrow + Tight)', ko: '취약 구간 (협소 + 타이트)' }
  const zoneNarrativeEn =
    raw.scoreBucket.key === 'transition'
      ? `Transition zone with ${liquidityState.toLowerCase()} liquidity — avoid aggressive expansion.`
      : raw.scoreBucket.key === 'fragile' || raw.scoreBucket.key === 'risk'
      ? `${quadrant.en}. Prioritize resilience and cleaner confirmation before adding risk.`
      : `${quadrant.en}. Structure is supportive enough for measured positioning.`
  const zoneNarrativeKo =
    raw.scoreBucket.key === 'transition'
      ? `전환 구간이며 유동성은 ${liquidityState === 'Tight' ? '타이트' : liquidityState === 'Loose' ? '완화' : '중립'}합니다. 공격적 확대는 자제하세요.`
      : raw.scoreBucket.key === 'fragile' || raw.scoreBucket.key === 'risk'
      ? `${quadrant.ko}. 리스크 확대보다 복원력 확보와 확인 신호가 우선입니다.`
      : `${quadrant.ko}. 구조가 비교적 우호적이므로 점진적 포지셔닝이 가능합니다.`
  return {
    trendState,
    volState,
    breadthState,
    liquidityState,
    x,
    y,
    zoneLabelEn: raw.scoreBucket.labelEn,
    zoneLabelKo: raw.scoreBucket.labelKo,
    quadrantLabelEn: quadrant.en,
    quadrantLabelKo: quadrant.ko,
    zoneNarrativeEn,
    zoneNarrativeKo,
  }
}

function metricStatusBadge(
  status: 'GOOD' | 'WATCH' | 'RISK' | 'NA',
): { en: string; ko: string } {
  if (status === 'GOOD') return { en: 'GOOD', ko: '양호' }
  if (status === 'WATCH') return { en: 'WATCH', ko: '관찰' }
  if (status === 'RISK') return { en: 'RISK', ko: '주의' }
  return { en: 'NA', ko: '없음' }
}

export function formatMetricRow(
  metricKey: string,
  value: number | string | null | undefined,
  mode: HealthMode,
  ctx?: { p20?: number; p50?: number; p80?: number; lookbackLabel?: string },
): MetricRow {
  const v = value ?? null
  const isNum = typeof v === 'number' && Number.isFinite(v)
  const rawText = isNum ? String(v) : (typeof v === 'string' && v ? v : '—')
  const lb = ctx?.lookbackLabel ? ` (${ctx.lookbackLabel})` : ''

  const map: Record<string, Omit<DiagnosticMetric, 'key' | 'valueText'>> = {
    expected_move_95: {
      labelEn: 'Daily expected move (95%)',
      labelKo: '일간 기대 변동폭 (95%)',
      status: !isNum ? 'NA' : Math.abs(v as number) <= 1.0 ? 'GOOD' : Math.abs(v as number) <= 2.2 ? 'WATCH' : 'RISK',
      referenceText: `Normal${lb}: 1.0–2.2%`,
      meaningEn: isNum ? (Math.abs(v as number) <= 1.5 ? 'Typical range remains manageable.' : 'Range is wide; expect larger swings.') : 'Needs verification',
      meaningKo: isNum ? (Math.abs(v as number) <= 1.5 ? '일반적 범위로 관리 가능한 수준입니다.' : '변동폭이 넓어 체감 변동이 커질 수 있습니다.') : '확인 필요',
    },
    tail_prob_30d: {
      labelEn: 'Tail risk probability (30d)',
      labelKo: '테일 리스크 확률 (30일)',
      status: !isNum ? 'NA' : (v as number) < 15 ? 'GOOD' : (v as number) < 30 ? 'WATCH' : 'RISK',
      referenceText: `Good <15%, Watch 15–30%, Risk >30%`,
      meaningEn: isNum ? ((v as number) < 15 ? 'Tail stress is not dominant.' : (v as number) < 30 ? 'Tail stress is worth monitoring.' : 'Tail stress is elevated.') : 'Needs verification',
      meaningKo: isNum ? ((v as number) < 15 ? '꼬리 리스크 우세 구간은 아닙니다.' : (v as number) < 30 ? '꼬리 리스크 모니터링이 필요합니다.' : '꼬리 리스크가 높아진 상태입니다.') : '확인 필요',
    },
    drawdown_risk_30d: {
      labelEn: 'Drawdown risk (30d)',
      labelKo: '하락폭 리스크 (30일)',
      status: typeof v === 'string' ? (String(v).toLowerCase() === 'low' ? 'GOOD' : String(v).toLowerCase() === 'medium' ? 'WATCH' : 'RISK') : 'NA',
      referenceText: 'Low / Medium / High bucket',
      meaningEn: typeof v === 'string' ? 'Probability bucket for near-term drawdown stress.' : 'Needs verification',
      meaningKo: typeof v === 'string' ? '단기 낙폭 스트레스 가능성 구간입니다.' : '확인 필요',
    },
    credit_condition: {
      labelEn: 'Credit condition',
      labelKo: '신용 환경',
      status: typeof v === 'string' ? (String(v).toLowerCase() === 'improving' ? 'GOOD' : String(v).toLowerCase() === 'stable' ? 'WATCH' : 'RISK') : 'NA',
      referenceText: 'Improving / Stable / Worsening',
      meaningEn: typeof v === 'string' ? 'Used as a background risk appetite check.' : 'Needs verification',
      meaningKo: typeof v === 'string' ? '리스크 선호 배경 점검용 지표입니다.' : '확인 필요',
    },
    max_dd_12m: {
      labelEn: 'Max Drawdown (12M)',
      labelKo: '최대 낙폭 (12개월)',
      status: !isNum ? 'NA' : Math.abs(v as number) < 15 ? 'GOOD' : Math.abs(v as number) < 25 ? 'WATCH' : 'RISK',
      referenceText: 'Normal: -15% to -25% (context-dependent)',
      meaningEn: isNum ? (Math.abs(v as number) < 15 ? 'Historical drawdown stress is moderate.' : 'Historical drawdown stress is meaningful.') : 'Needs verification',
      meaningKo: isNum ? (Math.abs(v as number) < 15 ? '과거 낙폭 스트레스가 비교적 완만합니다.' : '과거 낙폭 스트레스가 유의미합니다.') : '확인 필요',
    },
    ulcer_index: {
      labelEn: 'Ulcer Index',
      labelKo: '울서 지수',
      status: !isNum ? 'NA' : (v as number) < 8 ? 'GOOD' : (v as number) < 15 ? 'WATCH' : 'RISK',
      referenceText: 'Normal: 8–15, Risk >15',
      meaningEn: isNum ? ((v as number) < 8 ? 'Drawdown persistence is low.' : (v as number) < 15 ? 'Drawdown persistence is moderate.' : 'Drawdown persistence is elevated.') : 'Needs verification',
      meaningKo: isNum ? ((v as number) < 8 ? '낙폭 지속성이 낮은 편입니다.' : (v as number) < 15 ? '낙폭 지속성이 보통 수준입니다.' : '낙폭 지속성이 높은 편입니다.') : '확인 필요',
    },
    cvar95: {
      labelEn: 'CVaR 95',
      labelKo: 'CVaR 95',
      status: !isNum ? 'NA' : Math.abs(v as number) < 1.5 ? 'GOOD' : Math.abs(v as number) < 3.0 ? 'WATCH' : 'RISK',
      referenceText: 'Good <1.5, Watch 1.5–3.0, Risk >3.0',
      meaningEn: isNum ? 'Expected shortfall under stressed conditions.' : 'Needs verification',
      meaningKo: isNum ? '스트레스 상황의 평균 손실 추정입니다.' : '확인 필요',
    },
    cvar99: {
      labelEn: 'CVaR 99',
      labelKo: 'CVaR 99',
      status: !isNum ? 'NA' : Math.abs(v as number) < 2.0 ? 'GOOD' : Math.abs(v as number) < 4.0 ? 'WATCH' : 'RISK',
      referenceText: 'Good <2.0, Watch 2.0–4.0, Risk >4.0',
      meaningEn: isNum ? 'Tail-focused expected shortfall estimate.' : 'Needs verification',
      meaningKo: isNum ? '꼬리구간 중심 평균 손실 추정입니다.' : '확인 필요',
    },
    dd_prob_12m: {
      labelEn: '12M drawdown probability',
      labelKo: '12개월 낙폭 확률',
      status: !isNum ? 'NA' : (v as number) < 20 ? 'GOOD' : (v as number) < 40 ? 'WATCH' : 'RISK',
      referenceText: 'Good <20%, Watch 20–40%, Risk >40%',
      meaningEn: isNum ? ((v as number) < 20 ? 'Capital stability backdrop is acceptable.' : 'Capital stability backdrop requires caution.') : 'Needs verification',
      meaningKo: isNum ? ((v as number) < 20 ? '자본 안정성 배경이 양호한 편입니다.' : '자본 안정성 관점에서 경계가 필요합니다.') : '확인 필요',
    },
  }

  const base = map[metricKey] ?? {
    labelEn: metricKey,
    labelKo: metricKey,
    status: 'NA' as const,
    referenceText: 'Reference unavailable',
    meaningEn: mode === 'retirement' ? 'Retirement-mode diagnostic.' : 'Structural diagnostic metric.',
    meaningKo: mode === 'retirement' ? '은퇴 모드 진단 지표입니다.' : '구조 진단 지표입니다.',
  }
  return {
    key: metricKey,
    label: mode === 'retirement' ? base.labelKo : base.labelEn,
    labelKo: base.labelKo,
    labelEn: base.labelEn,
    valueText: rawText,
    status: base.status ?? 'NA',
    referenceText: base.referenceText ?? 'Reference unavailable',
    referenceKo:
      metricKey === 'expected_move_95' ? `정상${lb}: 1.0–2.2%` :
      metricKey === 'tail_prob_30d' ? '양호 <15%, 관찰 15–30%, 위험 >30%' :
      metricKey === 'drawdown_risk_30d' ? 'Low / Medium / High 구간' :
      metricKey === 'credit_condition' ? '개선 / 안정 / 악화' :
      metricKey === 'max_dd_12m' ? '정상: -15%~-25% (맥락 의존)' :
      metricKey === 'ulcer_index' ? '정상: 8–15, 위험 >15' :
      metricKey === 'cvar95' ? '양호 <1.5, 관찰 1.5–3.0, 위험 >3.0' :
      metricKey === 'cvar99' ? '양호 <2.0, 관찰 2.0–4.0, 위험 >4.0' :
      metricKey === 'dd_prob_12m' ? '양호 <20%, 관찰 20–40%, 위험 >40%' :
      '참고 범위 없음',
    referenceEn: base.referenceText ?? 'Reference unavailable',
    meaningText: mode === 'retirement' ? base.meaningKo : base.meaningEn,
    meaningKo: base.meaningKo,
    meaningEn: base.meaningEn,
    sourceNote: base.sourceNote,
  }
}

export function formatMetricWithMeaning(metricKey: string, value: number | string | null | undefined, mode: HealthMode): DiagnosticMetric {
  const row = formatMetricRow(metricKey, value, mode)
  const statusLabel = metricStatusBadge(row.status)
  return {
    key: row.key,
    labelEn: metricKey,
    labelKo: metricKey,
    valueText: row.valueText,
    status: row.status,
    referenceText: row.referenceText,
    sourceNote: row.sourceNote,
    meaningEn: `${statusLabel.en} · ${row.referenceText} · ${row.meaningText}`,
    meaningKo: `${statusLabel.ko} · ${row.referenceText} · ${row.meaningText}`,
  }
}

export function runMarketHealthSanityChecks() {
  const boundaryChecks = [
    { score: 80, expect: 'Strong' },
    { score: 60, expect: 'Stable' },
    { score: 40, expect: 'Transition' },
    { score: 20, expect: 'Fragile' },
    { score: 19, expect: 'Risk' },
  ].every((t) => shsBucketFromScore(t.score) === t.expect)

  const a = computeStructuralHealthScore({}, { lookbackSeries: {}, prevScore: 50 }, { maxStep: 8, alpha: 0.25 })
  const rateLimiterCheck = Math.abs(a.total_final - 50) <= 8

  const b = computeStructuralHealthScore(
    { pct_above_sma200: 75, advance_decline: 1.1 },
    { lookbackSeries: {} },
    { alpha: 0.25, maxStep: 8 },
  )
  const confidenceCheck = (b.confidence ?? 0) < 1 && (b.confidence ?? 0) > 0

  const noCrashCheck = (() => {
    try {
      computeStructuralHealthScore(
        {
          vix_level: undefined,
          credit_spread: undefined,
        },
        { lookbackSeries: {} },
      )
      return true
    } catch {
      return false
    }
  })()

  return {
    boundaryChecks,
    rateLimiterCheck,
    confidenceCheck,
    noCrashCheck,
    pass: boundaryChecks && rateLimiterCheck && confidenceCheck && noCrashCheck,
  }
}
