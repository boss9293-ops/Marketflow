import type {
  RawStandardPlaybackArchive,
  RawVRSurvivalPlaybackArchive,
} from '../playback/vr_playback_loader'

type StrategyKey = 'buy_hold' | 'ma200_risk_control' | 'fixed_stop_loss' | 'vr_engine'

type StandardPlaybackPoint = RawStandardPlaybackArchive['events'][number]['playback'][number]
type SurvivalPlaybackPoint = RawVRSurvivalPlaybackArchive['events'][number]['playback'][number]

export type StrategyArenaMetric = {
  final_return_pct: number
  max_drawdown_pct: number
  recovery_time_days: number | null
  exposure_stability_pct: number
}

export type StrategyArenaEventView = {
  id: string
  label: string
  standard_event_name: string
  playback_event_id: string
  start: string
  end: string
  vr_source: 'survival_archive' | 'level_proxy'
  metrics: Record<StrategyKey, StrategyArenaMetric>
  chart_data: Array<{
    date: string
    buy_hold_equity: number
    ma200_risk_control_equity: number
    fixed_stop_loss_equity: number
    vr_engine_equity: number
    buy_hold_drawdown: number
    ma200_risk_control_drawdown: number
    fixed_stop_loss_drawdown: number
    vr_engine_drawdown: number
    buy_hold_exposure: number
    ma200_risk_control_exposure: number
    fixed_stop_loss_exposure: number
    vr_engine_exposure: number
  }>
}

export type StrategyArenaView = {
  events: StrategyArenaEventView[]
  methodology: {
    fixed_stop_loss_rule: string
    ma200_rule: string
    vr_source_priority: string
  }
}

const ARENA_TARGETS = [
  { id: '2008-crash', label: '2008 Crash', standard_event_name: '2007-07 Risk Event' },
  { id: '2011-debt-crisis', label: '2011 Debt Crisis', standard_event_name: '2011-06 Risk Event' },
  { id: '2018-volmageddon', label: '2018 Volmageddon', standard_event_name: '2018-02 Risk Event' },
  { id: '2020-covid-crash', label: '2020 COVID Crash', standard_event_name: '2020-02 Risk Event' },
  { id: '2022-bear-market', label: '2022 Bear Market', standard_event_name: '2021-12 Risk Event' },
  { id: '2024-correction', label: '2024 Correction', standard_event_name: '2024-04 Risk Event' },
  { id: '2026-risk-event', label: '2026 Risk Event', standard_event_name: '2026-02 Risk Event' },
] as const

const VR_PROXY_EXPOSURE_BY_LEVEL: Record<number, number> = {
  0: 100,
  1: 75,
  2: 50,
  3: 25,
  4: 0,
}

function toDateValue(value: string) {
  return new Date(`${value}T00:00:00Z`).getTime()
}

function overlapDays(
  left: Pick<RawStandardPlaybackArchive['events'][number], 'start' | 'end'>,
  right: Pick<RawVRSurvivalPlaybackArchive['events'][number], 'start' | 'end'>
) {
  const start = Math.max(toDateValue(left.start), toDateValue(right.start))
  const end = Math.min(toDateValue(left.end), toDateValue(right.end))
  if (end < start) return 0
  return Math.floor((end - start) / 86400000) + 1
}

function buildSyntheticTqqqProxy(points: StandardPlaybackPoint[]) {
  let syntheticN: number | null = null

  return points.map((point, index) => {
    const prevQqq = index > 0 ? points[index - 1]?.qqq_n : null
    const currentQqq = point.qqq_n

    if (typeof currentQqq !== 'number') {
      return null
    }

    if (syntheticN == null) {
      syntheticN = currentQqq > 0 ? currentQqq : 100
    } else if (typeof prevQqq === 'number' && prevQqq > 0) {
      const qqqReturn = (currentQqq - prevQqq) / prevQqq
      syntheticN = Math.max(1, syntheticN * (1 + qqqReturn * 3))
    }

    return Number(syntheticN.toFixed(2))
  })
}

function findMatchingSurvivalEvent(
  standardEvent: RawStandardPlaybackArchive['events'][number],
  survivalArchive: RawVRSurvivalPlaybackArchive | null
) {
  if (!survivalArchive?.events?.length) return null

  const exact = survivalArchive.events.find((event) => event.name === standardEvent.name)
  if (exact) return exact

  const ranked = survivalArchive.events
    .map((event) => ({
      event,
      overlap: overlapDays(standardEvent, event),
    }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)

  return ranked[0]?.event ?? null
}

function normalizeCurve(points: Array<{ date: string; value: number; exposure: number }>) {
  const peakSeed = points[0]?.value ?? 100
  let peak = peakSeed

  return points.map((point) => {
    peak = Math.max(peak, point.value)
    const drawdown = peak > 0 ? Number((((point.value - peak) / peak) * 100).toFixed(2)) : 0
    return {
      date: point.date,
      equity: Number(point.value.toFixed(2)),
      drawdown,
      exposure: Number(point.exposure.toFixed(2)),
    }
  })
}

function computeRecoveryTimeDays(curve: Array<{ equity: number }>) {
  if (!curve.length) return null
  let peak = curve[0].equity
  let troughIndex = 0
  let troughDrawdown = 0

  for (let index = 0; index < curve.length; index += 1) {
    peak = Math.max(peak, curve[index].equity)
    const dd = peak > 0 ? (curve[index].equity - peak) / peak : 0
    if (dd < troughDrawdown) {
      troughDrawdown = dd
      troughIndex = index
    }
  }

  if (troughDrawdown === 0) return 0

  const targetPeak = curve.slice(0, troughIndex + 1).reduce((best, point) => Math.max(best, point.equity), curve[0].equity)
  for (let index = troughIndex + 1; index < curve.length; index += 1) {
    if (curve[index].equity >= targetPeak) {
      return index - troughIndex
    }
  }

  return null
}

function computeExposureStability(exposures: number[]) {
  if (exposures.length <= 1) return 100
  let totalChange = 0
  for (let index = 1; index < exposures.length; index += 1) {
    totalChange += Math.abs(exposures[index] - exposures[index - 1])
  }
  const maxChange = (exposures.length - 1) * 100
  if (maxChange === 0) return 100
  return Number((100 - (totalChange / maxChange) * 100).toFixed(1))
}

function computeMetric(curve: Array<{ equity: number; drawdown: number; exposure: number }>): StrategyArenaMetric {
  const first = curve[0]?.equity ?? 100
  const last = curve[curve.length - 1]?.equity ?? first
  const maxDrawdown = curve.reduce((best, point) => Math.min(best, point.drawdown), 0)
  return {
    final_return_pct: Number((((last / first) - 1) * 100).toFixed(1)),
    max_drawdown_pct: Number(maxDrawdown.toFixed(1)),
    recovery_time_days: computeRecoveryTimeDays(curve),
    exposure_stability_pct: computeExposureStability(curve.map((point) => point.exposure)),
  }
}

function buildBuyHoldCurve(assetSeries: Array<{ date: string; asset_n: number }>) {
  const first = assetSeries[0]?.asset_n ?? 100
  return normalizeCurve(
    assetSeries.map((point) => ({
      date: point.date,
      value: (point.asset_n / first) * 100,
      exposure: 100,
    }))
  )
}

function buildMA200Curve(assetSeries: Array<{ date: string; asset_n: number; qqq_n: number; ma200_n: number | null }>) {
  let equity = 100
  let exposure = assetSeries[0] && assetSeries[0].qqq_n >= (assetSeries[0].ma200_n ?? Number.NEGATIVE_INFINITY) ? 100 : 0
  const points: Array<{ date: string; value: number; exposure: number }> = [
    { date: assetSeries[0]?.date ?? '', value: equity, exposure },
  ]

  for (let index = 1; index < assetSeries.length; index += 1) {
    const prev = assetSeries[index - 1]
    const current = assetSeries[index]
    const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0
    equity *= 1 + assetReturn * (exposure / 100)
    exposure = current.qqq_n >= (current.ma200_n ?? Number.NEGATIVE_INFINITY) ? 100 : 0
    points.push({ date: current.date, value: equity, exposure })
  }

  return normalizeCurve(points)
}

function buildFixedStopCurve(assetSeries: Array<{ date: string; asset_n: number; qqq_n: number; ma50_n: number | null }>) {
  let equity = 100
  let exposure = 100
  let inPosition = true
  let peakSinceEntry = assetSeries[0]?.asset_n ?? 100
  const points: Array<{ date: string; value: number; exposure: number }> = [
    { date: assetSeries[0]?.date ?? '', value: equity, exposure },
  ]

  for (let index = 1; index < assetSeries.length; index += 1) {
    const prev = assetSeries[index - 1]
    const current = assetSeries[index]
    const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0
    equity *= 1 + assetReturn * (exposure / 100)

    if (inPosition) {
      peakSinceEntry = Math.max(peakSinceEntry, current.asset_n)
      const drawdownFromPeak = peakSinceEntry > 0 ? (current.asset_n - peakSinceEntry) / peakSinceEntry : 0
      if (drawdownFromPeak <= -0.12) {
        inPosition = false
        exposure = 0
      }
    } else {
      const prevQqq = index > 0 ? assetSeries[index - 1]?.qqq_n : current.qqq_n
      const canReEnter =
        current.qqq_n > (current.ma50_n ?? Number.POSITIVE_INFINITY * -1) &&
        current.qqq_n >= prevQqq
      if (canReEnter) {
        inPosition = true
        exposure = 100
        peakSinceEntry = current.asset_n
      }
    }

    points.push({ date: current.date, value: equity, exposure })
  }

  return normalizeCurve(points)
}

function buildVRProxyCurve(
  assetSeries: Array<{ date: string; asset_n: number; level: number }>,
  survivalEvent: RawVRSurvivalPlaybackArchive['events'][number] | null
) {
  if (survivalEvent?.playback?.length) {
    const first = survivalEvent.playback[0]?.vr_10k ?? 10000
    return normalizeCurve(
      survivalEvent.playback.map((point) => ({
        date: point.d,
        value: (point.vr_10k / first) * 100,
        exposure: point.exposure_pct,
      }))
    )
  }

  let equity = 100
  let exposure = VR_PROXY_EXPOSURE_BY_LEVEL[assetSeries[0]?.level ?? 0] ?? 100
  const points: Array<{ date: string; value: number; exposure: number }> = [
    { date: assetSeries[0]?.date ?? '', value: equity, exposure },
  ]

  for (let index = 1; index < assetSeries.length; index += 1) {
    const prev = assetSeries[index - 1]
    const current = assetSeries[index]
    const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0
    equity *= 1 + assetReturn * (exposure / 100)
    exposure = VR_PROXY_EXPOSURE_BY_LEVEL[current.level] ?? 100
    points.push({ date: current.date, value: equity, exposure })
  }

  return normalizeCurve(points)
}

function zipChartData(input: {
  buyHold: ReturnType<typeof buildBuyHoldCurve>
  ma200: ReturnType<typeof buildMA200Curve>
  fixedStop: ReturnType<typeof buildFixedStopCurve>
  vrEngine: ReturnType<typeof buildVRProxyCurve>
}) {
  const length = Math.min(input.buyHold.length, input.ma200.length, input.fixedStop.length, input.vrEngine.length)
  return Array.from({ length }, (_, index) => ({
    date: input.buyHold[index].date,
    buy_hold_equity: input.buyHold[index].equity,
    ma200_risk_control_equity: input.ma200[index].equity,
    fixed_stop_loss_equity: input.fixedStop[index].equity,
    vr_engine_equity: input.vrEngine[index].equity,
    buy_hold_drawdown: input.buyHold[index].drawdown,
    ma200_risk_control_drawdown: input.ma200[index].drawdown,
    fixed_stop_loss_drawdown: input.fixedStop[index].drawdown,
    vr_engine_drawdown: input.vrEngine[index].drawdown,
    buy_hold_exposure: input.buyHold[index].exposure,
    ma200_risk_control_exposure: input.ma200[index].exposure,
    fixed_stop_loss_exposure: input.fixedStop[index].exposure,
    vr_engine_exposure: input.vrEngine[index].exposure,
  }))
}

export function buildStrategyArena(input: {
  standardArchive: RawStandardPlaybackArchive | null
  survivalArchive: RawVRSurvivalPlaybackArchive | null
}): StrategyArenaView | null {
  if (!input.standardArchive?.events?.length) return null

  const events = ARENA_TARGETS.map((target) => {
    const standardEvent = input.standardArchive?.events.find((event) => event.name === target.standard_event_name)
    if (!standardEvent) return null

    const survivalEvent = findMatchingSurvivalEvent(standardEvent, input.survivalArchive)
    const standardSynthetic = buildSyntheticTqqqProxy(standardEvent.playback)
    const standardByDate = new Map(
      standardEvent.playback.map((point, index) => [
        point.d,
        {
          point,
          synthetic_tqqq_n: standardSynthetic[index] ?? null,
        },
      ])
    )

    const masterDates =
      survivalEvent?.playback?.length ? survivalEvent.playback.map((point) => point.d) : standardEvent.playback.map((point) => point.d)

    const assetSeries = masterDates
      .map((date) => {
        const standardPoint = standardByDate.get(date)?.point
        if (!standardPoint || typeof standardPoint.qqq_n !== 'number') return null
        const assetN =
          typeof standardPoint.tqqq_n === 'number'
            ? standardPoint.tqqq_n
            : standardByDate.get(date)?.synthetic_tqqq_n
        if (typeof assetN !== 'number') return null

        return {
          date,
          asset_n: assetN,
          qqq_n: standardPoint.qqq_n,
          ma50_n: standardPoint.ma50_n,
          ma200_n: standardPoint.ma200_n,
          level: standardPoint.level,
        }
      })
      .filter((point): point is NonNullable<typeof point> => Boolean(point))

    if (assetSeries.length < 2) return null

    const buyHold = buildBuyHoldCurve(assetSeries)
    const ma200 = buildMA200Curve(assetSeries)
    const fixedStop = buildFixedStopCurve(assetSeries)
    const vrEngine = buildVRProxyCurve(assetSeries, survivalEvent)

    return {
      id: target.id,
      label: target.label,
      standard_event_name: standardEvent.name,
      playback_event_id: standardEvent.start.slice(0, 7),
      start: assetSeries[0].date,
      end: assetSeries[assetSeries.length - 1].date,
      vr_source: survivalEvent ? 'survival_archive' : 'level_proxy',
      metrics: {
        buy_hold: computeMetric(buyHold),
        ma200_risk_control: computeMetric(ma200),
        fixed_stop_loss: computeMetric(fixedStop),
        vr_engine: computeMetric(vrEngine),
      },
      chart_data: zipChartData({ buyHold, ma200, fixedStop, vrEngine }),
    }
  }).filter((event): event is StrategyArenaEventView => Boolean(event))

  return {
    events,
    methodology: {
      fixed_stop_loss_rule: 'Exit after a 12% instrument drawdown from entry peak. Re-enter on MA50 reclaim with improving price.',
      ma200_rule: 'Stay fully invested above MA200 and move to cash below MA200.',
      vr_source_priority: 'Use survival archive when available. Otherwise use standard event levels mapped to VR exposure caps.',
    },
  }
}

export function runStrategyArenaExamples(view: StrategyArenaView | null) {
  const cases = [
    { label: '2008 Crash', expect: '2007-07 Risk Event' },
    { label: '2020 COVID Crash', expect: '2020-02 Risk Event' },
    { label: '2026 Risk Event', expect: '2026-02 Risk Event' },
  ] as const

  return cases.map((testCase) => {
    const event = view?.events.find((item) => item.label === testCase.label) ?? null
    return {
      label: testCase.label,
      passed:
        event?.standard_event_name === testCase.expect &&
        event.chart_data.length > 1 &&
        Object.values(event.metrics).every((metric) => Number.isFinite(metric.final_return_pct)),
      vr_source: event?.vr_source ?? null,
      standard_event_name: event?.standard_event_name ?? null,
    }
  })
}
