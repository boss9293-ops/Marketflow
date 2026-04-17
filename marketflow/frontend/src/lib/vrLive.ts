export type Current90dPlaybackRow = {
  d?: string | null
  qqq_n?: number | null
  ma50_n?: number | null
  ma200_n?: number | null
  dd?: number | null
  tqqq_dd?: number | null
  tqqq_n?: number | null
  tqqq_close?: number | null
  tqqq_ma20?: number | null
  tqqq_ma50?: number | null
  tqqq_ma200?: number | null
  tqqq_rsi14?: number | null
  tqqq_rv20?: number | null
  score?: number | null
  level?: number | null
  event_type?: string | null
  in_ev?: boolean | null
}

export type Current90dCache = {
  generated?: string | null
  window_start?: string | null
  window_end?: string | null
  trading_days?: number | null
  risk_v1?: {
    playback?: Current90dPlaybackRow[] | null
  } | null
  vr_survival?: {
    playback?: Array<Record<string, unknown>> | null
  } | null
}

export type LiveSignalTone = 'neutral' | 'watch' | 'danger' | 'recovery' | 'safe' | 'escape'

export type LiveDrawdownBasis = 'peak90' | 'peak45' | 'peak20'

export type LiveDrawdownBasisOption = {
  value: LiveDrawdownBasis
  label: string
  description: string
  lookback: number
}

export const LIVE_DRAWDOWN_BASIS_OPTIONS: LiveDrawdownBasisOption[] = [
  {
    value: 'peak90',
    label: '90D Peak',
    description: 'Drawdown from the highest close in the trailing 90 sessions.',
    lookback: 90,
  },
  {
    value: 'peak45',
    label: '45D Peak',
    description: 'Drawdown from the highest close in the trailing 45 sessions.',
    lookback: 45,
  },
  {
    value: 'peak20',
    label: '20D Peak',
    description: 'Drawdown from the highest close in the trailing 20 sessions.',
    lookback: 20,
  },
]

export type LiveSignal = {
  label: string
  value: string
  detail: string
  tone: LiveSignalTone
}

export type LiveMotionPoint = {
  date: string
  tqqqClose: number | null
  qqqNormalized: number | null
  ma50Normalized: number | null
  ma200Normalized: number | null
  qqqDrawdownPct: number | null
  tqqqNormalized: number | null
  tqqqMa20: number | null
  tqqqMa50: number | null
  tqqqMa200: number | null
  tqqqRsi14: number | null
  tqqqRv20: number | null
  selectedDrawdownPct: number | null
  selectedDrawdownPeak: number | null
  selectedDrawdownPeakDate: string | null
  eventType: string | null
  inEvent: boolean
}

export type LiveMotionModel = {
  rows: LiveMotionPoint[]
  generated: string | null
  windowStart: string | null
  windowEnd: string | null
  tradingDays: number | null
  basis: LiveDrawdownBasis
  basisLabel: string
  basisDescription: string
  basisLookback: number
  latest: LiveMotionPoint | null
  prior: LiveMotionPoint | null
  trough: LiveMotionPoint | null
  troughIndex: number | null
  daysSinceTrough: number | null
  latestClose: number | null
  latestChange1dPct: number | null
  latestChange3dPct: number | null
  latestChange5dPct: number | null
  latestRsi14: number | null
  latestRsiDelta5d: number | null
  latestRv20: number | null
  latestRvDelta5d: number | null
  latestMa20: number | null
  latestMa50: number | null
  latestMa200: number | null
  latestPriceVsMa20Pct: number | null
  latestPriceVsMa50Pct: number | null
  latestPriceVsMa200Pct: number | null
  selectedDrawdownPct: number | null
  selectedDrawdownDelta5dPct: number | null
  selectedDrawdownPeak: number | null
  selectedDrawdownPeakDate: string | null
  reboundFromTroughPct: number | null
  latestDrawdownLabel: string
  directionLabel: string
  phaseLabel: string
  phaseDetail: string
  phaseTone: LiveSignalTone
  signals: {
    crash: LiveSignal
    bottom: LiveSignal
    safe: LiveSignal
    escape: LiveSignal
  }
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatPrice(value: number | null) {
  return value == null
    ? 'n/a'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(value)
}

function formatLiveDateLabel(value?: string | number | null) {
  if (value == null) return 'n/a'
  const raw = String(value)
  const normalized = /^\d{4}-\d{2}-\d{2}/.test(raw) ? `${raw.slice(0, 10)}T00:00:00Z` : raw
  const date = new Date(normalized)
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date)
  }
  return raw
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function roundTo(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function pickRow(rows: LiveMotionPoint[], offsetFromLatest: number) {
  return rows.length >= offsetFromLatest ? rows[rows.length - offsetFromLatest] ?? null : null
}

function pickDaysAgo(rows: LiveMotionPoint[], daysAgo: number) {
  return pickRow(rows, daysAgo + 1)
}

function pctChange(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null
  return roundTo((current / previous - 1) * 100, 2)
}

function computeMovingAverage(values: Array<number | null>, window: number) {
  const out: Array<number | null> = Array(values.length).fill(null)
  for (let i = window - 1; i < values.length; i += 1) {
    const chunk = values.slice(i - window + 1, i + 1)
    if (chunk.some((value) => value == null)) continue
    const sum = chunk.reduce<number>((acc, value) => acc + (value ?? 0), 0)
    out[i] = roundTo(sum / window, 4)
  }
  return out
}

function computeRsi(values: Array<number | null>, period = 14) {
  const out: Array<number | null> = Array(values.length).fill(null)
  for (let i = period; i < values.length; i += 1) {
    const chunk = values.slice(i - period, i + 1)
    if (chunk.some((value) => value == null)) continue
    const changes: number[] = []
    for (let j = 1; j < chunk.length; j += 1) {
      changes.push((chunk[j] ?? 0) - (chunk[j - 1] ?? 0))
    }
    const avgGain = changes.reduce<number>((acc, value) => acc + Math.max(value, 0), 0) / period
    const avgLoss = changes.reduce<number>((acc, value) => acc + Math.max(-value, 0), 0) / period
    if (avgLoss === 0) {
      out[i] = 100
      continue
    }
    const rs = avgGain / avgLoss
    out[i] = roundTo(100 - 100 / (1 + rs), 2)
  }
  return out
}

function computeRealizedVol(values: Array<number | null>, window = 20) {
  const out: Array<number | null> = Array(values.length).fill(null)
  for (let i = window; i < values.length; i += 1) {
    const chunk = values.slice(i - window, i + 1)
    if (chunk.some((value) => value == null)) continue
    const returns: number[] = []
    for (let j = 1; j < chunk.length; j += 1) {
      const prev = chunk[j - 1] ?? 0
      const cur = chunk[j] ?? 0
      if (prev === 0) {
        returns.length = 0
        break
      }
      returns.push(cur / prev - 1)
    }
    if (returns.length !== window) continue
    const mean = returns.reduce<number>((acc, value) => acc + value, 0) / returns.length
    const variance = returns.reduce<number>((acc, value) => acc + ((value - mean) ** 2), 0) / returns.length
    out[i] = roundTo(Math.sqrt(variance) * Math.sqrt(252) * 100, 2)
  }
  return out
}

function computeTrailingPeakSeries(values: Array<number | null>, dates: string[], lookback: number) {
  const drawdowns: Array<number | null> = Array(values.length).fill(null)
  const peaks: Array<number | null> = Array(values.length).fill(null)
  const peakDates: Array<string | null> = Array(values.length).fill(null)

  for (let i = 0; i < values.length; i += 1) {
    const current = values[i]
    if (current == null) continue

    const start = Math.max(0, i - lookback + 1)
    let peakValue: number | null = null
    let peakIndex = -1

    for (let j = start; j <= i; j += 1) {
      const candidate = values[j]
      if (candidate == null) continue
      if (peakValue == null || candidate > peakValue) {
        peakValue = candidate
        peakIndex = j
      }
    }

    if (peakValue == null || peakValue <= 0) continue
    drawdowns[i] = roundTo((current / peakValue - 1) * 100, 2)
    peaks[i] = roundTo(peakValue, 2)
    peakDates[i] = peakIndex >= 0 ? dates[peakIndex] : null
  }

  return { drawdowns, peaks, peakDates }
}

function toneForDrawdown(value: number | null): LiveSignalTone {
  if (value == null) return 'neutral'
  if (value <= -25) return 'danger'
  if (value <= -15) return 'watch'
  if (value <= -8) return 'neutral'
  return 'recovery'
}

function describeDirection(dd1: number | null, dd3: number | null, dd5: number | null) {
  if (dd1 == null || dd3 == null || dd5 == null) {
    return 'Warm-up'
  }
  if (dd1 < dd3 && dd3 < dd5) return 'Falling'
  if (dd1 > dd3 && dd3 > dd5) return 'Rebounding'
  if (dd1 < dd5) return 'Lower low pressure'
  if (dd1 > dd5) return 'Base building'
  return 'Choppy'
}

function signalValue(score: number | null) {
  return score == null ? 'n/a' : `${Math.round(score)}/100`
}

function signalToneFromRiskScore(score: number | null): LiveSignalTone {
  if (score == null) return 'neutral'
  if (score >= 70) return 'danger'
  if (score >= 45) return 'watch'
  return 'recovery'
}

function signalToneFromPositiveScore(score: number | null, strongestTone: LiveSignalTone): LiveSignalTone {
  if (score == null) return 'neutral'
  if (score >= 70) return strongestTone
  if (score >= 45) return 'recovery'
  return 'neutral'
}

function buildLiveSignalDetail(
  title: string,
  dd: number | null,
  rsi: number | null,
  rv: number | null,
  ma50Spread: number | null,
  ma200Spread: number | null,
  extra: string,
) {
  const parts = [title]
  if (dd != null) parts.push(`DD ${formatSignedPercent(dd)}`)
  if (rsi != null) parts.push(`RSI ${rsi.toFixed(1)}`)
  if (rv != null) parts.push(`RV20 ${rv.toFixed(1)}%`)
  if (ma50Spread != null) parts.push(`vs MA50 ${formatSignedPercent(ma50Spread)}`)
  if (ma200Spread != null) parts.push(`vs MA200 ${formatSignedPercent(ma200Spread)}`)
  if (extra.trim()) parts.push(extra.trim())
  return parts.join(' · ')
}

export function buildLiveMotionModel(current90d?: Current90dCache | null, basis: LiveDrawdownBasis = 'peak90', lang: 'en' | 'ko' = 'en'): LiveMotionModel {
  const basisConfig = LIVE_DRAWDOWN_BASIS_OPTIONS.find((option) => option.value === basis) ?? LIVE_DRAWDOWN_BASIS_OPTIONS[0]
  const rawRows = current90d?.risk_v1?.playback ?? []
  const rowsBase = rawRows
    .map((row) => {
      if (typeof row?.d !== 'string' || !row.d.trim()) return null
      const tqqqClose = toFiniteNumber(row.tqqq_close) ?? toFiniteNumber(row.tqqq_n)
      return {
        date: row.d,
        tqqqClose,
        qqqNormalized: toFiniteNumber(row.qqq_n),
        ma50Normalized: toFiniteNumber(row.ma50_n),
        ma200Normalized: toFiniteNumber(row.ma200_n),
        qqqDrawdownPct: toFiniteNumber(row.dd),
        tqqqNormalized: toFiniteNumber(row.tqqq_n),
        tqqqMa20: toFiniteNumber(row.tqqq_ma20),
        tqqqMa50: toFiniteNumber(row.tqqq_ma50),
        tqqqMa200: toFiniteNumber(row.tqqq_ma200),
        tqqqRsi14: toFiniteNumber(row.tqqq_rsi14),
        tqqqRv20: toFiniteNumber(row.tqqq_rv20),
        selectedDrawdownPct: null as number | null,
        selectedDrawdownPeak: null as number | null,
        selectedDrawdownPeakDate: null as string | null,
        eventType: typeof row.event_type === 'string' ? row.event_type : null,
        inEvent: Boolean(row.in_ev),
      }
    })
    .filter((row): row is LiveMotionPoint => row != null)

  const dates = rowsBase.map((row) => row.date)
  const closeSeries = rowsBase.map((row) => row.tqqqClose ?? row.tqqqNormalized)
  const computedMa20 = computeMovingAverage(closeSeries, 20)
  const computedMa50 = computeMovingAverage(closeSeries, 50)
  const computedMa200 = computeMovingAverage(closeSeries, 200)
  const computedRsi14 = computeRsi(closeSeries, 14)
  const computedRv20 = computeRealizedVol(closeSeries, 20)
  const selectedDrawdownSeries = computeTrailingPeakSeries(closeSeries, dates, basisConfig.lookback)

  const rows = rowsBase.map((row, index) => ({
    ...row,
    tqqqMa20: row.tqqqMa20 ?? computedMa20[index] ?? null,
    tqqqMa50: row.tqqqMa50 ?? computedMa50[index] ?? null,
    tqqqMa200: row.tqqqMa200 ?? computedMa200[index] ?? null,
    tqqqRsi14: row.tqqqRsi14 ?? computedRsi14[index] ?? null,
    tqqqRv20: row.tqqqRv20 ?? computedRv20[index] ?? null,
    selectedDrawdownPct: selectedDrawdownSeries.drawdowns[index] ?? null,
    selectedDrawdownPeak: selectedDrawdownSeries.peaks[index] ?? null,
    selectedDrawdownPeakDate: selectedDrawdownSeries.peakDates[index] ?? null,
  }))

  const latest = pickRow(rows, 1)
  const prior = pickRow(rows, 2)
  const latestClose = latest?.tqqqClose ?? latest?.tqqqNormalized ?? null
  const close1dAgo = pickDaysAgo(rows, 1)?.tqqqClose ?? pickDaysAgo(rows, 1)?.tqqqNormalized ?? null
  const close3dAgo = pickDaysAgo(rows, 3)?.tqqqClose ?? pickDaysAgo(rows, 3)?.tqqqNormalized ?? null
  const close5dAgo = pickDaysAgo(rows, 5)?.tqqqClose ?? pickDaysAgo(rows, 5)?.tqqqNormalized ?? null
  const latestChange1dPct = pctChange(latestClose, close1dAgo)
  const latestChange3dPct = pctChange(latestClose, close3dAgo)
  const latestChange5dPct = pctChange(latestClose, close5dAgo)

  const latestRsi14 = latest?.tqqqRsi14 ?? null
  const rsi5dAgo = pickDaysAgo(rows, 5)?.tqqqRsi14 ?? null
  const latestRsiDelta5d = latestRsi14 != null && rsi5dAgo != null ? roundTo(latestRsi14 - rsi5dAgo, 2) : null

  const latestRv20 = latest?.tqqqRv20 ?? null
  const rv5dAgo = pickDaysAgo(rows, 5)?.tqqqRv20 ?? null
  const latestRvDelta5d = latestRv20 != null && rv5dAgo != null ? roundTo(latestRv20 - rv5dAgo, 2) : null

  const latestMa20 = latest?.tqqqMa20 ?? null
  const latestMa50 = latest?.tqqqMa50 ?? null
  const latestMa200 = latest?.tqqqMa200 ?? null
  const latestPriceVsMa20Pct = pctChange(latestClose, latestMa20)
  const latestPriceVsMa50Pct = pctChange(latestClose, latestMa50)
  const latestPriceVsMa200Pct = pctChange(latestClose, latestMa200)

  const selectedDrawdownPct = latest?.selectedDrawdownPct ?? null
  const selectedDrawdown5dAgo = pickDaysAgo(rows, 5)?.selectedDrawdownPct ?? null
  const selectedDrawdownDelta5dPct =
    selectedDrawdownPct != null && selectedDrawdown5dAgo != null
      ? roundTo(selectedDrawdownPct - selectedDrawdown5dAgo, 2)
      : null
  const selectedDrawdownPeak = latest?.selectedDrawdownPeak ?? null
  const selectedDrawdownPeakDate = latest?.selectedDrawdownPeakDate ?? null
  const latestDrawdownLabel = selectedDrawdownPct == null ? 'n/a' : formatSignedPercent(selectedDrawdownPct)

  const troughWindow = rows.slice(-45)
  const troughEntry = troughWindow.reduce<{
    index: number
    row: LiveMotionPoint | null
  }>(
    (best, row, index) => {
      if (row.selectedDrawdownPct == null) return best
      if (!best.row || row.selectedDrawdownPct < (best.row.selectedDrawdownPct ?? Number.POSITIVE_INFINITY)) {
        return { index, row }
      }
      return best
    },
    { index: -1, row: null },
  )

  const trough = troughEntry.row
  const troughIndex = troughEntry.index >= 0 ? rows.length - troughWindow.length + troughEntry.index : null
  const daysSinceTrough = troughIndex != null && latest ? rows.length - 1 - troughIndex : null
  const reboundFromTroughPct =
    latest?.tqqqClose != null && trough?.tqqqClose != null && trough.tqqqClose > 0
      ? pctChange(latest.tqqqClose, trough.tqqqClose)
      : latest?.tqqqNormalized != null && trough?.tqqqNormalized != null && trough.tqqqNormalized > 0
        ? pctChange(latest.tqqqNormalized, trough.tqqqNormalized)
        : null

  const dd1 = selectedDrawdownPct
  const dd3 = pickDaysAgo(rows, 3)?.selectedDrawdownPct ?? null
  const dd5 = pickDaysAgo(rows, 5)?.selectedDrawdownPct ?? null
  const directionLabelEn = describeDirection(dd1, dd3, dd5)
  const DIR_KO: Record<string, string> = {
    'Warm-up': '준비', 'Falling': '하락 중', 'Rebounding': '반등 중',
    'Lower low pressure': '저점 압박', 'Base building': '저점 다지기', 'Choppy': '혼조',
  }
  const directionLabel = lang === 'ko' ? (DIR_KO[directionLabelEn] ?? directionLabelEn) : directionLabelEn

  const priceBelowMa50 = latestClose != null && latestMa50 != null ? latestClose < latestMa50 : null
  const priceBelowMa200 = latestClose != null && latestMa200 != null ? latestClose < latestMa200 : null
  const priceAboveMa50 = latestClose != null && latestMa50 != null ? latestClose > latestMa50 : null
  const priceAboveMa200 = latestClose != null && latestMa200 != null ? latestClose > latestMa200 : null

  const riskScore = clamp(
    (selectedDrawdownPct != null ? clamp((-selectedDrawdownPct - 5) * 2.4, 0, 40) : 0) +
      (latestRsi14 != null ? clamp((50 - latestRsi14) * 1.0, 0, 18) : 0) +
      (latestRvDelta5d != null && latestRvDelta5d > 0 ? clamp(latestRvDelta5d * 1.2, 0, 18) : 0) +
      (priceBelowMa50 ? 15 : 0) +
      (priceBelowMa200 ? 10 : 0),
    0,
    100,
  )

  const bottomScore = clamp(
    (selectedDrawdownPct != null ? clamp((-selectedDrawdownPct - 8) * 2.0, 0, 30) : 0) +
      (selectedDrawdownDelta5dPct != null ? clamp(selectedDrawdownDelta5dPct * 2.2, 0, 25) : 0) +
      (latestRsi14 != null ? clamp((latestRsi14 - 30) * 0.9, 0, 20) : 0) +
      (latestRsiDelta5d != null && latestRsiDelta5d > 0 ? clamp(latestRsiDelta5d * 1.5, 0, 10) : 0) +
      (latestRvDelta5d != null && latestRvDelta5d <= 0 ? 10 : 0),
    0,
    100,
  )

  const safeScore = clamp(
    (priceAboveMa50 ? 25 : 0) +
      (priceAboveMa200 ? 20 : 0) +
      (selectedDrawdownPct != null && selectedDrawdownPct > -10 ? 20 : 0) +
      (latestRsi14 != null && latestRsi14 >= 50 ? 20 : 0) +
      (latestRvDelta5d != null && latestRvDelta5d <= 0 ? 15 : 0) +
      (selectedDrawdownDelta5dPct != null && selectedDrawdownDelta5dPct > 0 ? 10 : 0),
    0,
    100,
  )

  const escapeScore = clamp(
    (priceAboveMa200 ? 35 : 0) +
      (priceAboveMa50 ? 20 : 0) +
      (selectedDrawdownPct != null && selectedDrawdownPct > -5 ? 20 : 0) +
      (latestRsi14 != null && latestRsi14 >= 55 ? 15 : 0) +
      (latestRvDelta5d != null && latestRvDelta5d <= 0 ? 10 : 0),
    0,
    100,
  )

  const riskDetail = buildLiveSignalDetail(
    lang === 'ko' ? '선택된 DD 기준으로 충돌 압력을 측정합니다.' : 'Crash pressure is measured from the selected drawdown basis.',
    selectedDrawdownPct,
    latestRsi14,
    latestRv20,
    latestPriceVsMa50Pct,
    latestPriceVsMa200Pct,
    priceBelowMa50 === true
      ? (lang === 'ko' ? '가격이 MA50 아래입니다.' : 'Price is still below MA50.')
      : priceBelowMa200 === true
        ? (lang === 'ko' ? '가격이 MA200 아래입니다.' : 'Price remains below MA200.')
        : (lang === 'ko' ? '모멘텀이 아직 완전히 회복되지 않았습니다.' : 'Momentum is not yet fully repaired.'),
  )
  const bottomDetail = buildLiveSignalDetail(
    lang === 'ko' ? 'DD 악화가 멈추고 RSI가 반등하면 바닥이 형성됩니다.' : 'Bottoming improves when DD stops worsening and RSI turns up.',
    selectedDrawdownPct,
    latestRsi14,
    latestRv20,
    latestPriceVsMa50Pct,
    latestPriceVsMa200Pct,
    selectedDrawdownDelta5dPct != null && selectedDrawdownDelta5dPct > 0
      ? (lang === 'ko' ? `5세션 동안 DD ${formatSignedPercent(selectedDrawdownDelta5dPct)} 개선.` : `DD improved by ${formatSignedPercent(selectedDrawdownDelta5dPct)} over 5 sessions.`)
      : (lang === 'ko' ? 'DD가 아직 명확히 개선되지 않았습니다.' : 'DD has not clearly improved yet.'),
  )
  const safeDetail = buildLiveSignalDetail(
    lang === 'ko' ? '가격이 추세 위로 회복되고 변동성이 낮아지면 안전 구간입니다.' : 'Safety means price has rebuilt above trend and volatility is cooling.',
    selectedDrawdownPct,
    latestRsi14,
    latestRv20,
    latestPriceVsMa50Pct,
    latestPriceVsMa200Pct,
    priceAboveMa50 === true
      ? (lang === 'ko' ? '가격이 MA50 위에 있습니다.' : 'Price is above MA50.')
      : (lang === 'ko' ? 'MA50 회복이 더 필요합니다.' : 'Need a stronger MA50 reclaim.'),
  )
  const escapeDetail = buildLiveSignalDetail(
    lang === 'ko' ? '더 큰 추세의 확실한 회복이 탈출의 조건입니다.' : 'Escape wants a confirmed reclaim of the larger trend.',
    selectedDrawdownPct,
    latestRsi14,
    latestRv20,
    latestPriceVsMa50Pct,
    latestPriceVsMa200Pct,
    priceAboveMa200 === true
      ? (lang === 'ko' ? '가격이 MA200을 회복했습니다.' : 'Price has reclaimed MA200.')
      : (lang === 'ko' ? 'MA200 회복이 아직 없습니다.' : 'MA200 reclaim is still missing.'),
  )

  let phaseLabel = lang === 'ko' ? '모니터링' : 'Monitor'
  let phaseTone: LiveSignalTone = 'neutral'
  let phaseDetail = lang === 'ko'
    ? '충돌 압력, 바닥 형성, 안전, 탈출 신호를 Live 테이프에서 관찰 중입니다.'
    : 'The live tape is being observed for crash pressure, bottom formation, safety, and escape confirmation.'

  if (escapeScore >= 70) {
    phaseLabel = lang === 'ko' ? '탈출' : 'Escape'
    phaseTone = 'escape'
    phaseDetail = escapeDetail
  } else if (safeScore >= 60) {
    phaseLabel = lang === 'ko' ? '안전' : 'Safe'
    phaseTone = 'safe'
    phaseDetail = safeDetail
  } else if (bottomScore >= 55) {
    phaseLabel = lang === 'ko' ? '바닥 형성' : 'Bottoming'
    phaseTone = 'recovery'
    phaseDetail = bottomDetail
  } else if (riskScore >= 60) {
    phaseLabel = lang === 'ko' ? '충돌 위험' : 'Crash Risk'
    phaseTone = 'danger'
    phaseDetail = riskDetail
  }

  return {
    rows,
    generated: typeof current90d?.generated === 'string' ? current90d.generated : null,
    windowStart: typeof current90d?.window_start === 'string' ? current90d.window_start : null,
    windowEnd: typeof current90d?.window_end === 'string' ? current90d.window_end : null,
    tradingDays: typeof current90d?.trading_days === 'number' ? current90d.trading_days : null,
    basis: basisConfig.value,
    basisLabel: basisConfig.label,
    basisDescription: basisConfig.description,
    basisLookback: basisConfig.lookback,
    latest,
    prior,
    trough,
    troughIndex,
    daysSinceTrough,
    latestClose,
    latestChange1dPct,
    latestChange3dPct,
    latestChange5dPct,
    latestRsi14,
    latestRsiDelta5d,
    latestRv20,
    latestRvDelta5d,
    latestMa20,
    latestMa50,
    latestMa200,
    latestPriceVsMa20Pct,
    latestPriceVsMa50Pct,
    latestPriceVsMa200Pct,
    selectedDrawdownPct,
    selectedDrawdownDelta5dPct,
    selectedDrawdownPeak,
    selectedDrawdownPeakDate,
    reboundFromTroughPct,
    latestDrawdownLabel,
    directionLabel,
    phaseLabel,
    phaseDetail,
    phaseTone,
    signals: {
      crash: {
        label: lang === 'ko' ? '충돌 위험' : 'Crash Risk',
        value: signalValue(riskScore),
        detail: riskDetail,
        tone: signalToneFromRiskScore(riskScore),
      },
      bottom: {
        label: lang === 'ko' ? '바닥 형성' : 'Bottoming',
        value: signalValue(bottomScore),
        detail: bottomDetail,
        tone: bottomScore >= 70 ? 'recovery' : bottomScore >= 45 ? 'watch' : 'neutral',
      },
      safe: {
        label: lang === 'ko' ? '안전' : 'Safety',
        value: signalValue(safeScore),
        detail: safeDetail,
        tone: signalToneFromPositiveScore(safeScore, 'safe'),
      },
      escape: {
        label: lang === 'ko' ? '탈출' : 'Escape',
        value: signalValue(escapeScore),
        detail: escapeDetail,
        tone: signalToneFromPositiveScore(escapeScore, 'escape'),
      },
    },
  }
}
