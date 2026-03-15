export type TickerSummaryLike = {
  symbol?: string
  name?: string
  date?: string
  close?: number
  change_pct?: number
  indicators?: {
    sma20?: number | null
    sma50?: number | null
    sma200?: number | null
    rsi14?: number | null
  } | null
  signals?: Array<{
    date?: string
    signal_type?: string
    score?: number | null
    status?: string | null
  }> | null
  ai_brief_v1?: string
  valuation?: {
    pe?: number | null
    fwd_pe?: number | null
    rev_growth_yoy?: number | null
    fcf_margin?: number | null
  } | null
} | null

export type TickerChartLike = {
  candles?: Array<{
    date: string
    high: number
    low: number
    close: number
  }> | null
} | null

export type TickerGauge = {
  key: 'move' | 'expectation' | 'vr' | 'trend'
  title: { ko: string; en: string }
  valueText: string
  levelText?: { ko: string; en: string }
  pct?: number | null
  color?: string
}

export type TickerScenario = {
  title: { ko: string; en: string }
  conditions: Array<{ ko: string; en: string }>
  reactionRange?: string | null
}

export type TickerReportModel = {
  header: {
    symbol: string
    name: string
    price?: number | null
    changePct?: number | null
  }
  event: {
    nextEarningsDday?: number | null
  } | null
  symbol: string
  name?: string | null
  asOf?: string | null
  price?: number | null
  changePct?: number | null
  eventD?: number | null
  gauges: TickerGauge[]
  bullCase?: TickerScenario | null
  bearCase?: TickerScenario | null
  actionLine?: { ko: string; en: string } | null
  bullets: Array<{ title: { ko: string; en: string }; body: { ko: string; en: string } }>
  valuation?: Array<{ label: { ko: string; en: string }; value: string }> | null
}

const C = {
  bull: 'var(--state-bull)',
  transition: 'var(--state-transition)',
  defensive: 'var(--state-defensive)',
  neutral: 'var(--state-neutral)',
} as const

function fmtPct(v: number | null | undefined, digits = 1) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function recentMoveRangePct(chart: TickerChartLike): number | null {
  const candles = Array.isArray(chart?.candles) ? chart.candles.slice(-20) : []
  if (!candles.length) return null
  const highs = candles.map((c) => c.high).filter((v) => typeof v === 'number')
  const lows = candles.map((c) => c.low).filter((v) => typeof v === 'number')
  const last = candles[candles.length - 1]?.close
  if (!highs.length || !lows.length || typeof last !== 'number' || last <= 0) return null
  const avgRange = candles.reduce((acc, c) => acc + Math.max(0, c.high - c.low), 0) / candles.length
  return (avgRange / last) * 100
}

function trendHealth(summary: TickerSummaryLike) {
  const close = summary?.close
  const sma20 = summary?.indicators?.sma20 ?? null
  const sma50 = summary?.indicators?.sma50 ?? null
  const sma200 = summary?.indicators?.sma200 ?? null
  if (typeof close !== 'number') return { label: { ko: '확인 필요', en: 'Needs verification' }, pct: null, color: C.neutral }
  let score = 50
  if (typeof sma20 === 'number') score += close >= sma20 ? 12 : -12
  if (typeof sma50 === 'number') score += close >= sma50 ? 16 : -16
  if (typeof sma200 === 'number') score += close >= sma200 ? 22 : -22
  score = Math.max(0, Math.min(100, score))
  if (score >= 65) return { label: { ko: '상승', en: 'UP' }, pct: score, color: C.bull }
  if (score <= 35) return { label: { ko: '하락', en: 'DOWN' }, pct: score, color: C.defensive }
  return { label: { ko: '횡보', en: 'SIDE' }, pct: score, color: C.transition }
}

function vrRisk(summary: TickerSummaryLike, chart: TickerChartLike) {
  const rsi = summary?.indicators?.rsi14 ?? null
  const move = recentMoveRangePct(chart)
  let score = 40
  if (typeof move === 'number') score += Math.min(35, move * 8)
  if (typeof rsi === 'number') score += rsi >= 75 || rsi <= 25 ? 20 : rsi >= 65 || rsi <= 35 ? 10 : 0
  score = Math.max(0, Math.min(100, score))
  if (score >= 75) return { label: { ko: '스트레스', en: 'STRESS' }, pct: score, color: C.defensive }
  if (score >= 50) return { label: { ko: '상승 위험', en: 'ELEVATED' }, pct: score, color: C.transition }
  return { label: { ko: '안정', en: 'STABLE' }, pct: score, color: C.bull }
}

function expectationGauge(summary: TickerSummaryLike) {
  const signals = Array.isArray(summary?.signals) ? summary.signals : []
  const scoreVals = signals.map((s) => (typeof s.score === 'number' ? s.score : null)).filter((v): v is number => v !== null)
  const avg = scoreVals.length ? scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length : null
  if (avg === null) return { label: { ko: '보통', en: 'MED' }, pct: null, color: C.neutral, valueText: '—' }
  const pct = Math.max(0, Math.min(100, avg))
  const label = pct >= 67 ? { ko: '높음', en: 'HIGH' } : pct >= 34 ? { ko: '보통', en: 'MED' } : { ko: '낮음', en: 'LOW' }
  const color = pct >= 67 ? C.defensive : pct >= 34 ? C.transition : C.bull
  return { label, pct, color, valueText: `${Math.round(pct)}` }
}

function signalEventD(summary: TickerSummaryLike): number | null {
  const txt = Array.isArray(summary?.signals)
    ? summary!.signals!.map((s) => `${s.signal_type || ''} ${s.status || ''}`).join(' ')
    : ''
  if (!txt) return null
  return /earn/i.test(txt) ? 0 : null
}

export function buildTickerReportModel(params: {
  symbol: string
  summary?: TickerSummaryLike
  chart?: TickerChartLike
}): TickerReportModel {
  const symbol = (params.symbol || '').toUpperCase()
  const summary = params.summary || null
  const chart = params.chart || null

  const movePct = recentMoveRangePct(chart)
  const moveGauge: TickerGauge | null = movePct == null ? null : {
    key: 'move',
    title: { ko: '예상 변동', en: 'MOVE Gauge' },
    valueText: fmtPct(movePct, 1) || '—',
    levelText: movePct > 3 ? { ko: '큰 변동', en: 'WIDE' } : movePct > 1.5 ? { ko: '보통', en: 'MID' } : { ko: '좁음', en: 'TIGHT' },
    pct: Math.min(100, movePct * 20),
    color: movePct > 3 ? C.defensive : movePct > 1.5 ? C.transition : C.bull,
  }

  const exp = expectationGauge(summary)
  const vr = vrRisk(summary, chart)
  const trend = trendHealth(summary)

  const gauges: TickerGauge[] = [
    ...(moveGauge ? [moveGauge] : []),
    {
      key: 'expectation',
      title: { ko: '기대치', en: 'Expectation Gauge' },
      valueText: exp.valueText,
      levelText: exp.label,
      pct: exp.pct,
      color: exp.color,
    },
    {
      key: 'vr',
      title: { ko: 'VR 리스크', en: 'VR Risk Gauge' },
      valueText: vr.pct != null ? String(Math.round(vr.pct)) : '—',
      levelText: vr.label,
      pct: vr.pct,
      color: vr.color,
    },
    {
      key: 'trend',
      title: { ko: '추세 건전성', en: 'Trend Health Gauge' },
      valueText: trend.pct != null ? String(Math.round(trend.pct)) : '—',
      levelText: trend.label,
      pct: trend.pct,
      color: trend.color,
    },
  ]

  const close = summary?.close ?? null
  const sma50 = summary?.indicators?.sma50 ?? null
  const sma200 = summary?.indicators?.sma200 ?? null
  const rsi = summary?.indicators?.rsi14 ?? null

  const bullConditions = [
    typeof sma20orcloseAbove(close, summary?.indicators?.sma20 ?? null) === 'boolean'
      ? {
          ko: close && summary?.indicators?.sma20 ? `종가가 SMA20 위 (${close.toFixed(2)} > ${(summary!.indicators!.sma20 as number).toFixed(2)})` : '단기 추세 상단 유지',
          en: 'Close holds above SMA20',
        }
      : null,
    typeof sma50 === 'number' && typeof close === 'number'
      ? { ko: `SMA50 대비 ${close >= sma50 ? '우위' : '하회'}`, en: close >= sma50 ? 'Above SMA50' : 'Below SMA50' }
      : { ko: '거래량 동반 돌파 확인', en: 'Confirm breakout with volume' },
    { ko: '시가 이후 눌림 지지 확인 시 분할 접근', en: 'Scale in only after support holds post-open' },
  ].filter(Boolean) as TickerScenario['conditions']

  const bearConditions = [
    typeof sma200 === 'number' && typeof close === 'number'
      ? { ko: `SMA200 ${close < sma200 ? '하회' : '근접'} 여부 확인`, en: close < sma200 ? 'Watch for sustained move below SMA200' : 'Watch for rejection near SMA200' }
      : { ko: '전일 저점 이탈 여부 확인', en: 'Watch prior-day low breakdown' },
    typeof rsi === 'number'
      ? { ko: `RSI ${rsi.toFixed(1)} 과열/과매도 반전 확인`, en: `Monitor RSI ${rsi.toFixed(1)} for reversal signal` }
      : { ko: '모멘텀 약화 확인', en: 'Confirm momentum deterioration' },
    { ko: '손실 관리 가격대를 먼저 정한 뒤 대응', en: 'Define invalidation level before acting' },
  ]

  const todayMove = summary?.change_pct ?? null
  const actionLine = (() => {
    const trendLabel = trend.label.en
    if (trendLabel === 'UP' && (vr.pct ?? 50) < 65) {
      return {
        ko: '추세 우위 가능성이 있어 추격보다 눌림 확인 후 분할 진입이 유리합니다.',
        en: 'Trend may be supportive; favor staged entries on pullbacks instead of chasing.',
      }
    }
    if (trendLabel === 'DOWN' || (vr.pct ?? 50) >= 75) {
      return {
        ko: '변동성 스트레스가 높아 신규 비중 확대보다 손실 제한 규칙 점검이 우선입니다.',
        en: 'Volatility stress is elevated; prioritize risk limits before adding exposure.',
      }
    }
    return {
      ko: '방향 확인 전 구간으로 보고 진입 속도보다 신호 품질을 우선하세요.',
      en: 'Treat this as a confirmation zone; prioritize signal quality over speed of entry.',
    }
  })()

  const bullets = [
    {
      title: { ko: '오늘 변화', en: 'Today move' },
      body: {
        ko: `일간 변동률 ${fmtPct(todayMove, 2) || '—'}${summary?.date ? ` (기준일 ${summary.date})` : ''}`,
        en: `Daily change ${fmtPct(todayMove, 2) || '—'}${summary?.date ? ` (as of ${summary.date})` : ''}`,
      },
    },
    ...(typeof rsi === 'number'
      ? [{
          title: { ko: '모멘텀', en: 'Momentum' },
          body: {
            ko: `RSI14 ${rsi.toFixed(1)} 기준으로 과열/과매도 반전 여부를 함께 확인하세요.`,
            en: `RSI14 ${rsi.toFixed(1)} should be read with reversal context, not in isolation.`,
          },
        }]
      : []),
    ...(summary?.ai_brief_v1
      ? [{
          title: { ko: '자동 브리프', en: 'AI brief' },
          body: {
            ko: summary.ai_brief_v1.slice(0, 120),
            en: summary.ai_brief_v1.slice(0, 120),
          },
        }]
      : []),
    ...((Array.isArray(summary?.signals) ? summary!.signals! : []).slice(0, 3).map((s, idx) => ({
      title: { ko: `시그널 ${idx + 1}`, en: `Signal ${idx + 1}` },
      body: {
        ko: `${s.signal_type || 'N/A'} · 점수 ${typeof s.score === 'number' ? s.score.toFixed(1) : '—'} · ${s.date || '—'}`,
        en: `${s.signal_type || 'N/A'} · score ${typeof s.score === 'number' ? s.score.toFixed(1) : '—'} · ${s.date || '—'}`,
      },
    }))),
  ].slice(0, 5)

  return {
    header: {
      symbol,
      name: summary?.name || symbol,
      price: typeof summary?.close === 'number' ? summary.close : null,
      changePct: typeof summary?.change_pct === 'number' ? summary.change_pct : null,
    },
    event: {
      nextEarningsDday: signalEventD(summary),
    },
    symbol,
    name: summary?.name || null,
    asOf: summary?.date || null,
    price: typeof summary?.close === 'number' ? summary.close : null,
    changePct: typeof summary?.change_pct === 'number' ? summary.change_pct : null,
    eventD: signalEventD(summary),
    gauges,
    bullCase: {
      title: { ko: '상승 시나리오', en: 'Bull Case' },
      conditions: bullConditions.slice(0, 3),
      reactionRange: movePct != null ? `${(movePct * 0.8).toFixed(1)}% ~ ${(movePct * 1.3).toFixed(1)}%` : null,
    },
    bearCase: {
      title: { ko: '하락 시나리오', en: 'Bear Case' },
      conditions: bearConditions.slice(0, 3),
      reactionRange: movePct != null ? `-${(movePct * 0.8).toFixed(1)}% ~ -${(movePct * 1.4).toFixed(1)}%` : null,
    },
    actionLine,
    bullets,
    valuation: (() => {
      const v = summary?.valuation
      if (!v) return null
      const rows = [
        typeof v.pe === 'number' ? { label: { ko: 'PER', en: 'P/E' }, value: v.pe.toFixed(1) } : null,
        typeof v.fwd_pe === 'number' ? { label: { ko: '선행 PER', en: 'FWD P/E' }, value: v.fwd_pe.toFixed(1) } : null,
        typeof v.rev_growth_yoy === 'number' ? { label: { ko: '매출 성장', en: 'Rev growth' }, value: `${v.rev_growth_yoy.toFixed(1)}%` } : null,
        typeof v.fcf_margin === 'number' ? { label: { ko: 'FCF 마진', en: 'FCF margin' }, value: `${v.fcf_margin.toFixed(1)}%` } : null,
      ].filter(Boolean) as Array<{ label: { ko: string; en: string }; value: string }>
      return rows.length ? rows.slice(0, 3) : null
    })(),
  }
}

export const buildTickerReport = buildTickerReportModel

function sma20orcloseAbove(close: number | null | undefined, sma20: number | null | undefined): boolean | null {
  if (typeof close !== 'number' || typeof sma20 !== 'number') return null
  return close >= sma20
}
