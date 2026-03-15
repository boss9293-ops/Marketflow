import type { EventReplayCycle } from '../types/event_replay_cycle'
import type {
  CycleExecutionSummary,
  CyclePoolCapOption,
  ExecutionFocusWindow,
  ExecutionMarker,
  ExecutionPlaybackCollection,
  ExecutionPlaybackVariant,
  ExecutionPoint,
  ExecutionZone,
  MarketStructurePlayback,
  VRComparisonView,
  VRExecutionSummary,
} from '../types/execution_playback'

type ExecutionPlaybackSource = {
  start: string
  end: string
  chart_data: Array<{
    date: string
    qqq_n: number | null
    tqqq_n: number | null
    ma50_n: number | null
    ma200_n: number | null
    qqq_dd?: number | null
    in_event: boolean
  }>
  cycle_start: {
    initial_state: {
      initial_capital: number
      start_price: number
      initial_share_count: number
      initial_average_price: number
      initial_pool_cash: number
    } | null
  }
  cycle_framework: {
    cycles: EventReplayCycle[]
  }
}

const CAP_OPTIONS: Array<{ key: CyclePoolCapOption; pct: number | null; label: string }> = [
  { key: '30', pct: 30, label: '30%' },
  { key: '40', pct: 40, label: '40%' },
  { key: '50', pct: 50, label: '50%' },
  { key: 'unlimited', pct: null, label: 'Unlimited' },
]

const SCENARIO_SELL_POLICY = {
  vmaxVisualOnly: true,
  sellOnlyOnDefense: true,
  allowFirstCycleSell: false,
} as const

function findCycle(cycles: EventReplayCycle[], date: string) {
  return cycles.find((cycle) => date >= cycle.cycle_start_date && date <= cycle.cycle_end_date) ?? null
}

function normalizeValue(value: number, base: number) {
  return base > 0 ? Number(((value / base) * 100).toFixed(2)) : 100
}

function average(values: number[]) {
  if (!values.length) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
}

function rebaseNormalizedValue(normalizedValue: number | null | undefined, normalizedBase: number, actualBase: number) {
  if (typeof normalizedValue !== 'number' || normalizedValue <= 0) return actualBase
  if (!(normalizedBase > 0) || !(actualBase > 0)) return normalizedValue
  return Number(((normalizedValue / normalizedBase) * actualBase).toFixed(2))
}

function shiftTradingIndex(length: number, index: number, delta: number) {
  return Math.max(0, Math.min(length - 1, index + delta))
}

function buildRepresentativePriceLevels(anchorPrice: number, side: 'buy' | 'sell') {
  const offsets = side === 'buy' ? [-0.06, -0.12, -0.18] : [0.06, 0.12, 0.18]
  const weights = side === 'buy' ? [0.25, 0.35, 0.4] : [0.2, 0.3, 0.5]
  return offsets.map((offset, index) => ({
    level_no: index + 1,
    price: Number((anchorPrice * (1 + offset)).toFixed(2)),
    weight: weights[index],
  }))
}

function rollingMean(prices: number[], i: number, window: number): number | null {
  if (i < window - 1) return null
  let sum = 0
  for (let k = i - window + 1; k <= i; k++) sum += prices[k]
  return Number((sum / window).toFixed(2))
}

function buildMarketStructurePlayback(event: ExecutionPlaybackSource): MarketStructurePlayback {
  const actualBasePrice = event.cycle_start.initial_state?.start_price ?? 0
  const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100
  // Compute TQQQ-specific rolling MA directly from TQQQ price series
  const tqqqPrices = event.chart_data.map((point) => rebaseNormalizedValue(point.tqqq_n, normalizedBase, actualBasePrice))
  return {
    rows: event.chart_data.map((point, i) => ({
      date: point.date,
      tqqq_price: tqqqPrices[i],
      ma50: rollingMean(tqqqPrices, i, 50),
      ma200: rollingMean(tqqqPrices, i, 200),
    })),
    tqqq_price_series: event.chart_data.map((point, i) => ({
      date: point.date,
      value: tqqqPrices[i],
    })),
    ma50_series: event.chart_data.map((_, i) => ({
      date: event.chart_data[i].date,
      value: rollingMean(tqqqPrices, i, 50),
    })),
    ma200_series: event.chart_data.map((_, i) => ({
      date: event.chart_data[i].date,
      value: rollingMean(tqqqPrices, i, 200),
    })),
    cycle_boundaries: event.cycle_framework.cycles.map((cycle) => ({
      date: cycle.cycle_start_date,
      cycle_no: cycle.cycle_no,
    })),
    event_window: {
      start_date: event.start,
      end_date: event.end,
    },
    breach_points: event.chart_data
      .filter((point) => typeof point.qqq_n === 'number' && typeof point.ma200_n === 'number' && point.qqq_n < point.ma200_n)
      .map((point) => ({
        date: point.date,
        title: 'MA200 Breach',
        value: rebaseNormalizedValue(point.tqqq_n, normalizedBase, actualBasePrice),
      })),
    recovery_markers: event.chart_data
      .filter((point) => typeof point.qqq_dd === 'number' && point.qqq_dd >= -5 && point.in_event)
      .map((point) => ({
        date: point.date,
        title: 'Recovery Attempt',
        value: rebaseNormalizedValue(point.tqqq_n, normalizedBase, actualBasePrice),
      })),
  }
}

function buildCycleExecutionSummaries(input: {
  points: ExecutionPoint[]
  buy_markers: ExecutionMarker[]
  sell_markers: ExecutionMarker[]
  defense_markers: ExecutionMarker[]
  pool_cap_flags: ExecutionMarker[]
  initial_pool_cash: number
  cycles: EventReplayCycle[]
}): CycleExecutionSummary[] {
  const cycleNos = Array.from(
    new Set(input.points.map((point) => point.cycle_no).filter((cycleNo): cycleNo is number => typeof cycleNo === 'number'))
  ).sort((left, right) => left - right)

  return cycleNos.map((cycleNo) => {
    const cyclePoints = input.points.filter((point) => point.cycle_no === cycleNo)
    const firstPoint = cyclePoints[0]
    const lastPoint = cyclePoints[cyclePoints.length - 1]
    const buyCount = input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).length
    const sellCount = input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).length
    const defenseCount = input.defense_markers.filter((marker) => marker.cycle_no === cycleNo).length
    const blockedBuyCount = input.pool_cap_flags.filter((marker) => marker.cycle_no === cycleNo).length
    const executionPrices = [
      ...input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
      ...input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
      ...input.defense_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
    ]
    const buyPrices = input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price)
    const sellPrices = input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price)
    const poolUsedPct = lastPoint?.cycle_pool_used_pct ?? 0
    const poolSpent =
      input.initial_pool_cash > 0 ? Number(((input.initial_pool_cash * poolUsedPct) / 100).toFixed(2)) : 0
    const startingEvaluationValue = Number((firstPoint?.evaluation_value_before_trade ?? firstPoint?.evaluation_value ?? 0).toFixed(2))
    const endingEvaluationValue = Number((lastPoint?.evaluation_value ?? 0).toFixed(2))
    const startingPoolCash = Number((firstPoint?.pool_cash_before_trade ?? firstPoint?.pool_cash_after_trade ?? 0).toFixed(2))
    const endingPoolCash = Number((lastPoint?.pool_cash_after_trade ?? 0).toFixed(2))
    const startingPortfolioValue = startingEvaluationValue + startingPoolCash
    const endingPortfolioValue = endingEvaluationValue + endingPoolCash
    const cycleMeta = input.cycles.find((cycle) => cycle.cycle_no === cycleNo)

    return {
      cycle_no: cycleNo,
      cycle_window: `${firstPoint?.date ?? 'N/A'} - ${lastPoint?.date ?? 'N/A'}`,
      start_date: firstPoint?.date ?? '',
      end_date: lastPoint?.date ?? '',
      in_event: cyclePoints.some((point) => point.in_event),
      vref_eval: startingEvaluationValue,
      vmin_eval: Number((startingEvaluationValue * 0.85).toFixed(2)),
      vmax_eval: Number((startingEvaluationValue * 1.15).toFixed(2)),
      start_evaluation_value: startingEvaluationValue,
      avg_evaluation_value: average(cyclePoints.map((point) => point.evaluation_value)),
      end_evaluation_value: endingEvaluationValue,
      start_pool_cash: startingPoolCash,
      start_pool_pct:
        startingPortfolioValue > 0 ? Number(((startingPoolCash / startingPortfolioValue) * 100).toFixed(1)) : 0,
      end_pool_cash: endingPoolCash,
      end_pool_pct:
        endingPortfolioValue > 0 ? Number(((endingPoolCash / endingPortfolioValue) * 100).toFixed(1)) : 0,
      avg_avg_cost: average(cyclePoints.map((point) => point.avg_cost_after_trade)),
      avg_execution_price: executionPrices.length ? average(executionPrices) : null,
      avg_buy_price: buyPrices.length ? average(buyPrices) : null,
      avg_sell_price: sellPrices.length ? average(sellPrices) : null,
      pool_spent_in_cycle: poolSpent,
      pool_used_pct_in_cycle: poolUsedPct,
      end_shares: lastPoint?.shares_after_trade ?? 0,
      end_avg_cost: Number((lastPoint?.avg_cost_after_trade ?? 0).toFixed(2)),
      ending_state: lastPoint?.state_after_trade ?? 'pending',
      buy_count: buyCount,
      sell_count: sellCount,
      defense_count: defenseCount,
      blocked_buy_count: blockedBuyCount,
      scenario_bias: cycleMeta?.scenario_bias ?? [],
      playbook_bias: cycleMeta?.playbook_bias ?? [],
    }
  })
}

function buildExecutionFocusWindow(input: {
  points: ExecutionPoint[]
  trade_log: ExecutionPlaybackVariant['trade_log']
}): ExecutionFocusWindow | null {
  if (!input.points.length) return null

  const firstBuySignalDate = input.trade_log.find((item) => item.buy_signal)?.replay_date ?? null
  const firstDefenseDate = input.trade_log.find((item) => item.defense_signal)?.replay_date ?? null
  const firstVminBreakDate =
    input.points.find(
      (point) =>
        point.in_event &&
        typeof point.vmin_eval === 'number' &&
        typeof point.evaluation_value === 'number' &&
        point.evaluation_value < point.vmin_eval
    )?.date ?? null

  const eventPoints = input.points.filter((point) => point.in_event)
  const eventLowDate =
    eventPoints.reduce((lowest, point) => {
      if (!lowest || point.asset_price < lowest.asset_price) return point
      return lowest
    }, null as ExecutionPoint | null)?.date ?? null

  const stressCandidates = [firstBuySignalDate, firstDefenseDate, firstVminBreakDate].filter(
    (date): date is string => Boolean(date)
  )
  const anchorStartDate = stressCandidates.sort()[0] ?? eventPoints[0]?.date ?? input.points[0].date
  const anchorEndDate = eventLowDate ?? eventPoints[eventPoints.length - 1]?.date ?? input.points[input.points.length - 1].date

  const startIndex = Math.max(
    0,
    input.points.findIndex((point) => point.date === anchorStartDate)
  )
  const endIndexCandidate = input.points.findIndex((point) => point.date === anchorEndDate)
  const endIndex = endIndexCandidate >= 0 ? endIndexCandidate : input.points.length - 1

  return {
    mode: 'auto_focus',
    start_date: input.points[shiftTradingIndex(input.points.length, startIndex, -5)]?.date ?? input.points[0].date,
    end_date:
      input.points[shiftTradingIndex(input.points.length, endIndex, 12)]?.date ??
      input.points[input.points.length - 1].date,
    first_buy_signal_date: firstBuySignalDate,
    first_defense_date: firstDefenseDate,
    first_vmin_break_date: firstVminBreakDate,
    event_low_date: eventLowDate,
  }
}

function buildVariant(
  event: ExecutionPlaybackSource,
  capOption: { key: CyclePoolCapOption; pct: number | null; label: string },
  mode: 'original' | 'scenario' = 'scenario'
): ExecutionPlaybackVariant {
  const initialState = event.cycle_start.initial_state
  const marketChart = buildMarketStructurePlayback(event)

  if (!initialState) {
    return {
      cap_option: capOption.key,
      cap_label: capOption.label,
      sell_policy: {
        vmax_visual_only: mode === 'scenario' ? SCENARIO_SELL_POLICY.vmaxVisualOnly : false,
        sell_only_on_defense: mode === 'scenario' ? SCENARIO_SELL_POLICY.sellOnlyOnDefense : false,
        allow_first_cycle_sell: mode === 'scenario' ? SCENARIO_SELL_POLICY.allowFirstCycleSell : true,
      },
      points: [],
      buy_markers: [],
      sell_markers: [],
      defense_markers: [],
      avg_cost_line: [],
      pool_cap_flags: [],
      vmin_recovery_attempt_zones: [],
      failed_recovery_zones: [],
      scenario_phase_zones: [],
      pool_usage_summary: {
        initial_pool_cash: 0,
        cycle_pool_cap_pct: capOption.pct,
        cycle_pool_used_pct: 0,
        active_cycle_pool_used_pct: 0,
        pool_cash_remaining: 0,
        cumulative_pool_spent: 0,
        blocked_buy_count: 0,
        deferred_buy_count: 0,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        active_cycle_no: null,
        active_cycle_blocked_buy_count: 0,
        last_trade_date: null,
      },
      trade_log: [],
      validation_summary: {
        has_buy_execution: false,
        has_sell_execution: false,
        has_defense_execution: false,
        avg_cost_changed: false,
        shares_changed: false,
        pool_cash_changed: false,
        blocked_by_cap_observed: false,
        executed_buy_count: 0,
        executed_sell_count: 0,
        executed_defense_count: 0,
        blocked_buy_count: 0,
      },
      market_chart: marketChart,
      cycle_summaries: [],
      focus_window: null,
    }
  }

  const basePrice = initialState.start_price > 0 ? initialState.start_price : event.chart_data[0]?.tqqq_n ?? 100
  const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100
  const initialPoolCash = initialState.initial_pool_cash
  const initialCapital = initialState.initial_capital
  let shares = initialState.initial_share_count
  let avgCost = initialState.initial_average_price
  let poolCash = initialState.initial_pool_cash
  let cumulativePoolSpent = 0
  let currentCycleNo: number | null = null
  let cyclePoolUsed = 0
  let blockedBuyCount = 0
  let deferredBuyCount = 0
  let executedBuyCount = 0
  let executedSellCount = 0
  let executedDefenseCount = 0
  let buyLevelState = new Set<string>()
  let sellLevelState = new Set<string>()
  let defenseTriggered = false
  let nextBuyLevelNo = 1
  let cycleBasePortfolio = initialCapital
  let cycleBaseEvaluation = initialState.initial_share_count * basePrice
  let cycleBasePrice = basePrice
  let activeCyclePoolUsedPct = 0
  let activeCycleBlockedBuyCount = 0
  let lastTradeDate: string | null = null
  let previousState = 'initialized'
  let underVminStart: string | null = null
  let recoveryZones: ExecutionZone[] = []
  let failedRecoveryZones: ExecutionZone[] = []
  let dayInCycle = 0

  const points: ExecutionPoint[] = []
  const buyMarkers: ExecutionMarker[] = []
  const sellMarkers: ExecutionMarker[] = []
  const defenseMarkers: ExecutionMarker[] = []
  const poolCapFlags: ExecutionMarker[] = []
  const avgCostLine: Array<{ date: string; value: number }> = []
  const scenarioPhaseZones: ExecutionZone[] = []
  const tradeLog: ExecutionPlaybackVariant['trade_log'] = []
  const activeCycleNo = event.cycle_framework.cycles.find((cycle) => cycle.is_active_cycle)?.cycle_no ?? null

  event.chart_data.forEach((point) => {
    const assetPrice = rebaseNormalizedValue(point.tqqq_n, normalizedBase, basePrice)
    const sharesBefore = shares
    const avgCostBefore = avgCost
    const poolCashBefore = poolCash
    const stateBefore = previousState
    const cycle = findCycle(event.cycle_framework.cycles, point.date)
    if (cycle?.cycle_no !== currentCycleNo) {
      currentCycleNo = cycle?.cycle_no ?? null
      dayInCycle = 1
      cyclePoolUsed = 0
      buyLevelState = new Set<string>()
      sellLevelState = new Set<string>()
      defenseTriggered = false
      nextBuyLevelNo = 1
      if (cycle) {
        // Only update base values when entering a valid cycle — not in the post-event period
        // (where findCycle returns null). Without this guard, post-event points reset
        // cycleBaseEvaluation daily as TQQQ recovers, making vref/vmin/vmax shoot back up
        // to old high values, creating the "previous data comes back" visual tangling.
        cycleBasePortfolio = shares * assetPrice + poolCash
        cycleBaseEvaluation = shares * assetPrice
        cycleBasePrice = assetPrice
      }
    }
    else {
      dayInCycle += 1
    }

    const cycleCapAmount =
      mode === 'original' || capOption.pct == null ? Number.POSITIVE_INFINITY : initialPoolCash * (capOption.pct / 100)
    const sellLevels = buildRepresentativePriceLevels(Math.max(avgCost, cycleBasePrice), 'sell')
    let tradeReason: string | null = null
    let stateAfterTrade = 'hold'
    let buyBlockedByCycleCap = false
    let tradeExecuted = false
    let tradeType: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null = null
    let tradePrice: number | null = null
    let triggerSource: 'evaluation_vmax_gate' | 'representative_sell_ladder' | 'defense_reduction' | 'buy_vmin_recovery' | 'cycle_cap_block' | null = null
    let ladderLevelHit: number | null = null
    const preTradeEvaluationValue = Number((shares * assetPrice).toFixed(2))
    const preTradeVminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2))
    const preTradeVmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2))
    const sellGateOpen = preTradeEvaluationValue >= preTradeVmaxEval

    // Dynamic buy logic: buy_base_price = vmin_eval / current_shares, buy_level_n = buy_base_price - n
    // Scenario VR pauses buys during defense regime (MA200 breach)
    const buysAllowed = mode === 'original' || !defenseTriggered
    const preTradeBuyBasePrice = shares > 0 ? preTradeVminEval / shares : 0
    const preBuyLevelPrice = preTradeBuyBasePrice > 0 ? Number((preTradeBuyBasePrice - nextBuyLevelNo).toFixed(2)) : null
    const buySignal = buysAllowed && preBuyLevelPrice != null && assetPrice <= preBuyLevelPrice && poolCash > 0

    // Execute buys: loop to handle multiple level triggers if price drops far in one day
    let buyAttempts = 0
    while (buysAllowed && poolCash > 0 && shares > 0 && buyAttempts < 10) {
      const vminNow = cycleBaseEvaluation * 0.85
      const buyBasePriceNow = vminNow / shares
      const nextLevelPrice = Number((buyBasePriceNow - nextBuyLevelNo).toFixed(2))
      if (assetPrice > nextLevelPrice) break

      const remainingCycleCap = Math.max(0, cycleCapAmount - cyclePoolUsed)
      const desiredSpend = Number((initialPoolCash * 0.20).toFixed(2))
      const actualSpend = Math.min(poolCash, desiredSpend, remainingCycleCap)

      if (actualSpend > 0) {
        const newShares = Math.floor(actualSpend / assetPrice)
        if (newShares > 0) {
          const totalCost = shares * avgCost + newShares * assetPrice
          shares += newShares
          avgCost = shares > 0 ? Number((totalCost / shares).toFixed(2)) : avgCost
          poolCash = Number((poolCash - newShares * assetPrice).toFixed(2))
          cyclePoolUsed = Number((cyclePoolUsed + newShares * assetPrice).toFixed(2))
          cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2))
          tradeReason = 'Vmin recovery attempt buy'
          stateAfterTrade = 'buy_executed'
          tradeExecuted = true
          tradeType = 'buy'
          tradePrice = assetPrice
          triggerSource = 'buy_vmin_recovery'
          ladderLevelHit = nextBuyLevelNo
          executedBuyCount += 1
          lastTradeDate = point.date
          buyMarkers.push({
            date: point.date,
            price: assetPrice,
            normalized_value: normalizeValue(assetPrice, basePrice),
            cycle_no: currentCycleNo ?? 0,
            title: `Buy L${nextBuyLevelNo}`,
            reason: tradeReason,
            marker_type: 'buy',
            trigger_source: 'buy_vmin_recovery',
            ladder_level_hit: nextBuyLevelNo,
            share_delta: newShares,
            shares_after_trade: shares,
            avg_cost_after_trade: Number(avgCost.toFixed(2)),
            pool_cash_after_trade: Number(poolCash.toFixed(2)),
            total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
            cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
            evaluation_value: Number((shares * assetPrice).toFixed(2)),
            vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
            vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
            vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
            state_after_trade: stateAfterTrade,
          })
          nextBuyLevelNo += 1
        } else {
          break
        }
      } else {
        buyBlockedByCycleCap = true
        blockedBuyCount += 1
        deferredBuyCount += 1
        tradeType = tradeType ?? 'blocked_buy'
        tradePrice = tradePrice ?? assetPrice
        triggerSource = triggerSource ?? 'cycle_cap_block'
        ladderLevelHit = ladderLevelHit ?? nextBuyLevelNo
        poolCapFlags.push({
          date: point.date,
          price: assetPrice,
          normalized_value: normalizeValue(assetPrice, basePrice),
          cycle_no: currentCycleNo ?? 0,
          title: `Cap Block L${nextBuyLevelNo}`,
          reason: 'Buy blocked by cycle pool usage cap',
          marker_type: 'cap_block',
          trigger_source: 'cycle_cap_block',
          ladder_level_hit: nextBuyLevelNo,
          share_delta: 0,
          blocked_level_no: nextBuyLevelNo,
          shares_after_trade: shares,
          avg_cost_after_trade: Number(avgCost.toFixed(2)),
          pool_cash_after_trade: Number(poolCash.toFixed(2)),
          total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
          cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
          evaluation_value: Number((shares * assetPrice).toFixed(2)),
          vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
          vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
          vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
          state_after_trade: stateAfterTrade,
        })
        tradeReason = 'buy_blocked_by_cycle_cap'
        stateAfterTrade = 'buy_blocked'
        nextBuyLevelNo += 1
        break
      }
      buyAttempts += 1
    }

    const ma200Breached = typeof point.qqq_n === 'number' && typeof point.ma200_n === 'number' && point.qqq_n < point.ma200_n
    const defenseSignal = mode === 'scenario' && ma200Breached && !defenseTriggered && shares > 0
    if (mode === 'scenario' && ma200Breached && !defenseTriggered && shares > 0) {
      const sharesToSell = Math.max(1, Math.floor(shares * 0.2))
      shares -= sharesToSell
      const cashAdded = Number((sharesToSell * assetPrice).toFixed(2))
      poolCash = Number((poolCash + cashAdded).toFixed(2))
      defenseTriggered = true
      tradeReason = 'defense_reduction'
      stateAfterTrade = 'defense_reduced'
      tradeExecuted = true
      tradeType = 'defense'
      tradePrice = assetPrice
      triggerSource = 'defense_reduction'
      ladderLevelHit = null
      executedDefenseCount += 1
      lastTradeDate = point.date
      defenseMarkers.push({
        date: point.date,
        price: assetPrice,
        normalized_value: normalizeValue(assetPrice, basePrice),
        cycle_no: currentCycleNo ?? 0,
        title: 'Defense Reduce',
        reason: 'Forced reduction after MA200 breach',
        marker_type: 'defense',
        trigger_source: 'defense_reduction',
        ladder_level_hit: null,
        share_delta: -sharesToSell,
        shares_after_trade: shares,
        avg_cost_after_trade: Number(avgCost.toFixed(2)),
        pool_cash_after_trade: Number(poolCash.toFixed(2)),
        total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
        cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
        evaluation_value: Number((shares * assetPrice).toFixed(2)),
        vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
        vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
        vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
        state_after_trade: stateAfterTrade,
      })
    }

    // Sell ladder only fires when evaluation is above Vmax (sellGateOpen) — prevents misfires near Vmin
    const sellSignal = mode === 'original' && sellGateOpen && sellLevels.some((level) => {
      const key = `${currentCycleNo}-sell-${level.level_no}`
      return !sellLevelState.has(key) && assetPrice >= level.price && shares > 0
    })
    for (const level of sellLevels) {
      const key = `${currentCycleNo}-sell-${level.level_no}`
      if (mode !== 'original' || !sellGateOpen || sellLevelState.has(key) || assetPrice < level.price || shares <= 0) continue
      const sharesToSell = Math.max(1, Math.floor(shares * Math.min(0.2, level.weight)))
      shares -= sharesToSell
      poolCash = Number((poolCash + sharesToSell * assetPrice).toFixed(2))
      tradeReason = 'representative_sell_ladder'
      stateAfterTrade = 'sell_executed'
      tradeExecuted = true
      tradeType = 'sell'
      tradePrice = assetPrice
      triggerSource = 'representative_sell_ladder'
      ladderLevelHit = level.level_no
      executedSellCount += 1
      lastTradeDate = point.date
      sellMarkers.push({
        date: point.date,
        price: assetPrice,
        normalized_value: normalizeValue(assetPrice, basePrice),
        cycle_no: currentCycleNo ?? 0,
        title: `Sell L${level.level_no}`,
        reason: 'Representative cycle sell level touched',
        marker_type: 'sell',
        trigger_source: 'representative_sell_ladder',
        ladder_level_hit: level.level_no,
        sell_gate_open: true,
        share_delta: -sharesToSell,
        shares_after_trade: shares,
        avg_cost_after_trade: Number(avgCost.toFixed(2)),
        pool_cash_after_trade: Number(poolCash.toFixed(2)),
        total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
        cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
        evaluation_value: Number((shares * assetPrice).toFixed(2)),
        vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
        vmin_eval: Number((cycleBaseEvaluation * 0.85).toFixed(2)),
        vmax_eval: Number((cycleBaseEvaluation * 1.15).toFixed(2)),
        state_after_trade: stateAfterTrade,
      })
      sellLevelState.add(key)
    }

    const evaluationValue = Number((shares * assetPrice).toFixed(2))
    const portfolioValue = Number((evaluationValue + poolCash).toFixed(2))
    const evaluationNormalized = normalizeValue(evaluationValue, cycleBaseEvaluation || 1)
    const portfolioNormalized = normalizeValue(portfolioValue, initialCapital)
    const vrefEval = Number(cycleBaseEvaluation.toFixed(2))
    const vminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2))
    const vmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2))
    const vrefLine = normalizeValue(cycleBasePortfolio, initialCapital)
    const vminLine = Number((vrefLine * 0.85).toFixed(2))
    const vmaxLine = Number((vrefLine * 1.15).toFixed(2))
    const vrefPrice = shares > 0 ? Number((vrefEval / shares).toFixed(2)) : null
    const vminPrice = shares > 0 ? Number((vminEval / shares).toFixed(2)) : null
    const vmaxPrice = shares > 0 ? Number((vmaxEval / shares).toFixed(2)) : null

    if (evaluationValue < vminEval && underVminStart == null) {
      underVminStart = point.date
    } else if (evaluationValue >= vminEval && underVminStart != null) {
      recoveryZones.push({
        start_date: underVminStart,
        end_date: point.date,
        label: 'Vmin Recovery Attempt',
      })
      underVminStart = null
    }

    avgCostLine.push({
      date: point.date,
      value: normalizeValue(avgCost, basePrice),
    })
    points.push({
      date: point.date,
      in_event: point.in_event,
      cycle_no: currentCycleNo,
      day_in_cycle: currentCycleNo == null ? null : dayInCycle,
      asset_price: Number(assetPrice.toFixed(2)),
      evaluation_value_before_trade: preTradeEvaluationValue,
      evaluation_value: evaluationValue,
      evaluation_normalized: evaluationNormalized,
      tqqq_price_normalized: normalizeValue(assetPrice, basePrice),
      portfolio_value_before_trade: Number((preTradeEvaluationValue + poolCashBefore).toFixed(2)),
      portfolio_value: portfolioValue,
      portfolio_normalized: portfolioNormalized,
      vref_eval: vrefEval,
      vmin_eval: vminEval,
      vmax_eval: vmaxEval,
      vref_line: vrefLine,
      vmin_line: vminLine,
      vmax_line: vmaxLine,
      vref_price: vrefPrice,
      vmin_price: vminPrice,
      vmax_price: vmaxPrice,
      avg_cost_after_trade: Number(avgCost.toFixed(2)),
      avg_cost_normalized: normalizeValue(avgCost, basePrice),
      shares_before_trade: sharesBefore,
      shares_after_trade: shares,
      pool_cash_before_trade: Number(poolCashBefore.toFixed(2)),
      pool_cash_after_trade: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct:
        initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
      cycle_pool_cap_pct: capOption.pct,
      cumulative_pool_spent: cumulativePoolSpent,
      buy_blocked_by_cycle_cap: buyBlockedByCycleCap,
      trade_reason: tradeReason,
      state_after_trade: stateAfterTrade,
    })
    const cyclePoolUsedPct = initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0
    if (currentCycleNo === activeCycleNo) {
      activeCyclePoolUsedPct = cyclePoolUsedPct
      if (buyBlockedByCycleCap) {
        activeCycleBlockedBuyCount += 1
      }
    }
    tradeLog.push({
      replay_date: point.date,
      cycle_no: currentCycleNo,
      state_before: stateBefore,
      buy_signal: buySignal,
      sell_signal: sellSignal,
      defense_signal: defenseSignal,
      trade_executed: tradeExecuted,
      trade_type: tradeType,
      trigger_source: triggerSource,
      ladder_level_hit: ladderLevelHit,
      trade_price: tradePrice,
      stock_evaluation_value: preTradeEvaluationValue,
      vref_eval: Number(cycleBaseEvaluation.toFixed(2)),
      vmax_eval: preTradeVmaxEval,
      sell_gate_open: sellGateOpen,
      shares_before: sharesBefore,
      shares_after: shares,
      avg_cost_before: Number(avgCostBefore.toFixed(2)),
      avg_cost_after: Number(avgCost.toFixed(2)),
      pool_cash_before: Number(poolCashBefore.toFixed(2)),
      pool_cash_after: Number(poolCash.toFixed(2)),
      cycle_pool_used_pct: cyclePoolUsedPct,
      blocked_by_cap: buyBlockedByCycleCap,
      state_after: stateAfterTrade,
    })
    previousState = stateAfterTrade
  })

  if (underVminStart && points.length) {
    failedRecoveryZones.push({
      start_date: underVminStart,
      end_date: points[points.length - 1].date,
      label: 'Failed Recovery',
    })
  }

  const regeneratedScenarioPhaseZones = event.cycle_framework.cycles
    .filter((cycle) => cycle.scenario_bias?.length)
    .map((cycle) => ({
      start_date: cycle.cycle_start_date,
      end_date: cycle.cycle_end_date,
      label: cycle.scenario_bias[0],
    }))

  return {
    cap_option: capOption.key,
    cap_label: capOption.label,
    sell_policy: {
      vmax_visual_only: mode === 'scenario' ? SCENARIO_SELL_POLICY.vmaxVisualOnly : false,
      sell_only_on_defense: mode === 'scenario' ? SCENARIO_SELL_POLICY.sellOnlyOnDefense : false,
      allow_first_cycle_sell: mode === 'scenario' ? SCENARIO_SELL_POLICY.allowFirstCycleSell : true,
    },
    points,
    buy_markers: buyMarkers,
    sell_markers: sellMarkers,
    defense_markers: defenseMarkers,
    avg_cost_line: avgCostLine,
    pool_cap_flags: poolCapFlags,
    vmin_recovery_attempt_zones: recoveryZones,
    failed_recovery_zones: failedRecoveryZones,
    scenario_phase_zones: regeneratedScenarioPhaseZones,
      pool_usage_summary: {
      initial_pool_cash: initialPoolCash,
      cycle_pool_cap_pct: capOption.pct,
      cycle_pool_used_pct: points[points.length - 1]?.cycle_pool_used_pct ?? 0,
      active_cycle_pool_used_pct: activeCyclePoolUsedPct,
      pool_cash_remaining: points[points.length - 1]?.pool_cash_after_trade ?? 0,
      cumulative_pool_spent: cumulativePoolSpent,
      blocked_buy_count: blockedBuyCount,
      deferred_buy_count: deferredBuyCount,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: executedDefenseCount,
      active_cycle_no: activeCycleNo,
      active_cycle_blocked_buy_count: activeCycleBlockedBuyCount,
      last_trade_date: lastTradeDate,
    },
    trade_log: tradeLog,
    validation_summary: {
      has_buy_execution: executedBuyCount > 0,
      has_sell_execution: executedSellCount > 0,
      has_defense_execution: executedDefenseCount > 0,
      avg_cost_changed: tradeLog.some((item) => item.avg_cost_after !== item.avg_cost_before),
      shares_changed: tradeLog.some((item) => item.shares_after !== item.shares_before),
      pool_cash_changed: tradeLog.some((item) => item.pool_cash_after !== item.pool_cash_before),
      blocked_by_cap_observed: blockedBuyCount > 0,
      executed_buy_count: executedBuyCount,
      executed_sell_count: executedSellCount,
      executed_defense_count: executedDefenseCount,
      blocked_buy_count: blockedBuyCount,
    },
    market_chart: marketChart,
    cycle_summaries: buildCycleExecutionSummaries({
      points,
      buy_markers: buyMarkers,
      sell_markers: sellMarkers,
      defense_markers: defenseMarkers,
      pool_cap_flags: poolCapFlags,
      initial_pool_cash: initialPoolCash,
      cycles: event.cycle_framework.cycles,
    }),
    focus_window: buildExecutionFocusWindow({
      points,
      trade_log: tradeLog,
    }),
  }
}

export function buildExecutionPlayback(event: ExecutionPlaybackSource): ExecutionPlaybackCollection {
  const originalVr = buildVariant(
    event,
    { key: 'unlimited', pct: null, label: 'Original VR' },
    'original'
  )
  const variants = CAP_OPTIONS.reduce((acc, option) => {
    acc[option.key] = buildVariant(event, option, 'scenario')
    return acc
  }, {} as Record<CyclePoolCapOption, ExecutionPlaybackVariant>)

  const comparisonByCap = CAP_OPTIONS.reduce((acc, option) => {
    acc[option.key] = buildComparisonView(originalVr, variants[option.key])
    return acc
  }, {} as Record<CyclePoolCapOption, VRComparisonView>)

  return {
    default_cap_option: '50',
    original_vr: originalVr,
    variants,
    comparison_by_cap: comparisonByCap,
  }
}

function summarizeVariant(variant: ExecutionPlaybackVariant): VRExecutionSummary {
  const eventLowPoint = variant.points
    .filter((point) => point.in_event)
    .reduce((lowest, point) => {
      if (!lowest || point.asset_price < lowest.asset_price) return point
      return lowest
    }, null as ExecutionPoint | null)

  const lowestPoolRemaining = variant.points.reduce((min, point) => Math.min(min, point.pool_cash_after_trade), Number.POSITIVE_INFINITY)

  return {
    buy_count: variant.buy_markers.length,
    sell_count: variant.sell_markers.length,
    defense_count: variant.defense_markers.length,
    buy_pause_count: variant.pool_cap_flags.length,
    total_pool_spent: variant.pool_usage_summary.cumulative_pool_spent,
    lowest_pool_remaining: Number.isFinite(lowestPoolRemaining) ? Number(lowestPoolRemaining.toFixed(2)) : 0,
    avg_cost_at_event_low: eventLowPoint ? Number(eventLowPoint.avg_cost_after_trade.toFixed(2)) : null,
    final_evaluation_value: Number((variant.points[variant.points.length - 1]?.evaluation_value ?? 0).toFixed(2)),
    final_portfolio_value: Number((variant.points[variant.points.length - 1]?.portfolio_value ?? 0).toFixed(2)),
    final_unrealized_pl: Number(
      (((variant.points[variant.points.length - 1]?.portfolio_value ?? 0) - (variant.points[0]?.portfolio_value ?? 0)).toFixed(2))
    ),
    final_pool_cash_remaining: Number((variant.points[variant.points.length - 1]?.pool_cash_after_trade ?? 0).toFixed(2)),
    final_pool_used_pct:
      variant.pool_usage_summary.initial_pool_cash > 0
        ? Number(
            ((variant.pool_usage_summary.cumulative_pool_spent / variant.pool_usage_summary.initial_pool_cash) * 100).toFixed(2)
          )
        : 0,
  }
}

function formatDelta(delta: number, suffix = '') {
  const rounded = Number(delta.toFixed(2))
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}${suffix}`
}

function buildComparisonView(originalVr: ExecutionPlaybackVariant, scenarioVr: ExecutionPlaybackVariant): VRComparisonView {
  const originalSummary = summarizeVariant(originalVr)
  const scenarioSummary = summarizeVariant(scenarioVr)

  const originalMap = new Map(originalVr.points.map((point) => [point.date, point]))
  const chartRows = scenarioVr.points.map((point) => {
    const originalPoint = originalMap.get(point.date) ?? originalVr.points[0]
    return {
      date: point.date,
      original_evaluation_value: originalPoint?.evaluation_value ?? 0,
      scenario_evaluation_value: point.evaluation_value,
      original_portfolio_value: originalPoint?.portfolio_value ?? 0,
      scenario_portfolio_value: point.portfolio_value,
      original_pool_remaining: originalPoint?.pool_cash_after_trade ?? 0,
      scenario_pool_remaining: point.pool_cash_after_trade,
    }
  })

  const behaviorRows = [
    {
      label: 'Buy Logic',
      original_value: 'Mechanical cycle-grid deployment',
      scenario_value: 'Cap-aware overlay with slower early deployment',
    },
    {
      label: 'Pool Usage',
      original_value: 'Faster pool consumption',
      scenario_value: 'Pool preservation by cycle cap',
    },
    {
      label: 'Sell Logic',
      original_value: 'Representative sell ladder can trim into strength',
      scenario_value: 'No profit-harvest sells; reductions occur only through defense logic',
    },
    {
      label: 'Crash Response',
      original_value: 'No explicit defense reduction',
      scenario_value: 'Defense overlay is the only allowed reduction path',
    },
    {
      label: 'Avg Cost Behavior',
      original_value: 'Faster basis improvement when buys trigger',
      scenario_value: 'Slower basis improvement with preserved cash',
    },
    {
      label: 'Objective',
      original_value: 'Cost-basis improvement',
      scenario_value: 'Survival and late-stage optionality',
    },
    {
      label: 'Late-Stage Optionality',
      original_value: 'Weaker after deeper deployment',
      scenario_value: 'Stronger if pool remains available',
    },
  ]

  const defenseDelta = scenarioSummary.defense_count - originalSummary.defense_count
  const metricCards = [
    {
      label: 'Stock Evaluation Value',
      original_value: originalSummary.final_evaluation_value.toFixed(2),
      scenario_value: scenarioSummary.final_evaluation_value.toFixed(2),
      difference: formatDelta(scenarioSummary.final_evaluation_value - originalSummary.final_evaluation_value),
    },
    {
      label: 'Total Portfolio Value',
      original_value: originalSummary.final_portfolio_value.toFixed(2),
      scenario_value: scenarioSummary.final_portfolio_value.toFixed(2),
      difference: formatDelta(scenarioSummary.final_portfolio_value - originalSummary.final_portfolio_value),
    },
    {
      label: 'Unrealized P/L',
      original_value: originalSummary.final_unrealized_pl.toFixed(2),
      scenario_value: scenarioSummary.final_unrealized_pl.toFixed(2),
      difference: formatDelta(scenarioSummary.final_unrealized_pl - originalSummary.final_unrealized_pl),
    },
    {
      label: 'Pool Cash Remaining',
      original_value: originalSummary.final_pool_cash_remaining.toFixed(2),
      scenario_value: scenarioSummary.final_pool_cash_remaining.toFixed(2),
      difference: formatDelta(scenarioSummary.final_pool_cash_remaining - originalSummary.final_pool_cash_remaining),
    },
    {
      label: 'Pool Used %',
      original_value: `${originalSummary.final_pool_used_pct.toFixed(1)}%`,
      scenario_value: `${scenarioSummary.final_pool_used_pct.toFixed(1)}%`,
      difference: formatDelta(scenarioSummary.final_pool_used_pct - originalSummary.final_pool_used_pct, ' pts'),
    },
    {
      label: 'Buy Count',
      original_value: `${originalSummary.buy_count}`,
      scenario_value: `${scenarioSummary.buy_count}`,
      difference: formatDelta(scenarioSummary.buy_count - originalSummary.buy_count),
    },
    {
      label: 'Defense Activations',
      original_value: `${originalSummary.defense_count}`,
      scenario_value: `${scenarioSummary.defense_count}`,
      difference: formatDelta(defenseDelta),
    },
  ]

  return {
    chart_rows: chartRows,
    original_summary: originalSummary,
    scenario_summary: scenarioSummary,
    metric_cards: metricCards,
    behavior_rows: behaviorRows,
    interpretation: {
      headline:
        scenarioSummary.total_pool_spent <= originalSummary.total_pool_spent
          ? 'Scenario VR preserved more pool capacity while original VR deployed faster.'
          : 'Scenario VR stayed closer to original VR deployment during this replay.',
      subline:
        scenarioSummary.defense_count > 0
          ? 'The overlay adds defense reductions and slower capital usage, trading early basis improvement for later optionality.'
          : 'The overlay mainly changed the pace of deployment and preserved more flexibility into later stages of the event.',
    },
  }
}

export function runExecutionPlaybackExamples(
  events: Array<ExecutionPlaybackSource & { event_id?: string }>
) {
  const event = events.find((item) => item.event_id === '2020-02') ?? events[0]
  const playback = event ? buildExecutionPlayback(event) : null
  return {
    passed:
      Boolean(playback) &&
      Object.values(playback?.variants ?? {}).every((variant) => Array.isArray(variant.points)) &&
      (playback?.variants['50']?.pool_usage_summary.cycle_pool_cap_pct ?? null) === 50,
    default_cap_option: playback?.default_cap_option ?? null,
    point_count: playback?.variants['50']?.points.length ?? 0,
  }
}
