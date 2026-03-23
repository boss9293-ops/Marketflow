"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExecutionPlayback = buildExecutionPlayback;
exports.buildVariantForCap = buildVariantForCap;
exports.buildComparisonView = buildComparisonView;
exports.runExecutionPlaybackExamples = runExecutionPlaybackExamples;
const CAP_OPTIONS = [
    { key: '30', pct: 30, label: '30%' },
    { key: '40', pct: 40, label: '40%' },
    { key: '50', pct: 50, label: '50%' },
    { key: 'unlimited', pct: null, label: 'Unlimited' },
];
const SCENARIO_SELL_POLICY = {
    vmaxVisualOnly: true,
    sellOnlyOnDefense: true,
    allowFirstCycleSell: false,
};
function findCycle(cycles, date) {
    return cycles.find((cycle) => date >= cycle.cycle_start_date && date <= cycle.cycle_end_date) ?? null;
}
function normalizeValue(value, base) {
    return base > 0 ? Number(((value / base) * 100).toFixed(2)) : 100;
}
function average(values) {
    if (!values.length)
        return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}
function rebaseNormalizedValue(normalizedValue, normalizedBase, actualBase) {
    if (typeof normalizedValue !== 'number' || normalizedValue <= 0)
        return actualBase;
    if (!(normalizedBase > 0) || !(actualBase > 0))
        return normalizedValue;
    return Number(((normalizedValue / normalizedBase) * actualBase).toFixed(2));
}
function shiftTradingIndex(length, index, delta) {
    return Math.max(0, Math.min(length - 1, index + delta));
}
function buildRepresentativePriceLevels(anchorPrice, side) {
    const offsets = side === 'buy' ? [-0.06, -0.12, -0.18] : [0.06, 0.12, 0.18];
    const weights = side === 'buy' ? [0.25, 0.35, 0.4] : [0.2, 0.3, 0.5];
    return offsets.map((offset, index) => ({
        level_no: index + 1,
        price: Number((anchorPrice * (1 + offset)).toFixed(2)),
        weight: weights[index],
    }));
}
function rollingMean(prices, i, window) {
    if (i < window - 1)
        return null;
    let sum = 0;
    for (let k = i - window + 1; k <= i; k++)
        sum += prices[k];
    return Number((sum / window).toFixed(2));
}
function buildMarketStructurePlayback(event) {
    const actualBasePrice = event.cycle_start.initial_state?.start_price ?? 0;
    const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100;
    // Compute TQQQ-specific rolling MA directly from TQQQ price series
    const tqqqPrices = event.chart_data.map((point) => rebaseNormalizedValue(point.tqqq_n, normalizedBase, actualBasePrice));
    // Pre-build rows so breach_points can reuse computed ma200 (avoids re-running rollingMean twice)
    const rows = event.chart_data.map((point, i) => ({
        date: point.date,
        tqqq_price: tqqqPrices[i],
        ma50: rollingMean(tqqqPrices, i, 50),
        // Use DB pre-computed MA200 (from source chart_data.ma200_n) to avoid 200-day local warmup.
        // DB value is QQQ MA200 normalized to the same base as tqqq_n, so rebaseNormalizedValue gives
        // a comparable scale: when qqq_n == ma200_n the lines meet, signaling the MA200 breach threshold.
        ma200: typeof point.ma200_n === 'number' && point.ma200_n > 0
            ? rebaseNormalizedValue(point.ma200_n, normalizedBase, actualBasePrice)
            : rollingMean(tqqqPrices, i, 200),
    }));
    return {
        rows,
        tqqq_price_series: rows.map((row) => ({
            date: row.date,
            value: row.tqqq_price,
        })),
        ma50_series: rows.map((row) => ({
            date: row.date,
            value: row.ma50,
        })),
        ma200_series: rows.map((row) => ({
            date: row.date,
            value: row.ma200,
        })),
        cycle_boundaries: event.cycle_framework.cycles.map((cycle) => ({
            date: cycle.cycle_start_date,
            cycle_no: cycle.cycle_no,
        })),
        event_window: {
            start_date: event.start,
            end_date: event.end,
        },
        // Breach detection uses DB QQQ vs QQQ MA200 (source of truth), not locally-computed TQQQ MA200.
        // qqq_n and ma200_n are on the same normalized scale — breach = qqq_n < ma200_n.
        breach_points: rows
            .map((row, i) => ({ row, point: event.chart_data[i] }))
            .filter(({ row, point }) => typeof point.qqq_n === 'number' && typeof point.ma200_n === 'number'
            ? point.qqq_n < point.ma200_n
            : typeof row.ma200 === 'number' && row.tqqq_price < row.ma200)
            .map(({ row }) => ({
            date: row.date,
            title: 'MA200 Breach',
            value: row.tqqq_price,
        })),
        recovery_markers: event.chart_data
            .filter((point) => typeof point.qqq_dd === 'number' && point.qqq_dd >= -5 && point.in_event)
            .map((point) => ({
            date: point.date,
            title: 'Recovery Attempt',
            value: rebaseNormalizedValue(point.tqqq_n, normalizedBase, actualBasePrice),
        })),
    };
}
function buildCycleExecutionSummaries(input) {
    const cycleNos = Array.from(new Set(input.points.map((point) => point.cycle_no).filter((cycleNo) => typeof cycleNo === 'number'))).sort((left, right) => left - right);
    return cycleNos.map((cycleNo) => {
        const cyclePoints = input.points.filter((point) => point.cycle_no === cycleNo);
        const firstPoint = cyclePoints[0];
        const lastPoint = cyclePoints[cyclePoints.length - 1];
        const buyCount = input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).length;
        const sellCount = input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).length;
        const defenseCount = input.defense_markers.filter((marker) => marker.cycle_no === cycleNo).length;
        const blockedBuyCount = input.pool_cap_flags.filter((marker) => marker.cycle_no === cycleNo).length;
        const executionPrices = [
            ...input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
            ...input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
            ...input.defense_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price),
        ];
        const buyPrices = input.buy_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price);
        const sellPrices = input.sell_markers.filter((marker) => marker.cycle_no === cycleNo).map((marker) => marker.price);
        const poolUsedPct = lastPoint?.cycle_pool_used_pct ?? 0;
        const poolSpent = input.initial_pool_cash > 0 ? Number(((input.initial_pool_cash * poolUsedPct) / 100).toFixed(2)) : 0;
        const startingEvaluationValue = Number((firstPoint?.evaluation_value_before_trade ?? firstPoint?.evaluation_value ?? 0).toFixed(2));
        const endingEvaluationValue = Number((lastPoint?.evaluation_value ?? 0).toFixed(2));
        const startingPoolCash = Number((firstPoint?.pool_cash_before_trade ?? firstPoint?.pool_cash_after_trade ?? 0).toFixed(2));
        const endingPoolCash = Number((lastPoint?.pool_cash_after_trade ?? 0).toFixed(2));
        const startingPortfolioValue = startingEvaluationValue + startingPoolCash;
        const endingPortfolioValue = endingEvaluationValue + endingPoolCash;
        const cycleMeta = input.cycles.find((cycle) => cycle.cycle_no === cycleNo);
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
            start_pool_pct: startingPortfolioValue > 0 ? Number(((startingPoolCash / startingPortfolioValue) * 100).toFixed(1)) : 0,
            end_pool_cash: endingPoolCash,
            end_pool_pct: endingPortfolioValue > 0 ? Number(((endingPoolCash / endingPortfolioValue) * 100).toFixed(1)) : 0,
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
        };
    });
}
function buildExecutionFocusWindow(input) {
    if (!input.points.length)
        return null;
    const firstBuySignalDate = input.trade_log.find((item) => item.buy_signal)?.replay_date ?? null;
    const firstDefenseDate = input.trade_log.find((item) => item.defense_signal)?.replay_date ?? null;
    const firstVminBreakDate = input.points.find((point) => point.in_event &&
        typeof point.vmin_eval === 'number' &&
        typeof point.evaluation_value === 'number' &&
        point.evaluation_value < point.vmin_eval)?.date ?? null;
    const eventPoints = input.points.filter((point) => point.in_event);
    const eventLowDate = eventPoints.reduce((lowest, point) => {
        if (!lowest || point.asset_price < lowest.asset_price)
            return point;
        return lowest;
    }, null)?.date ?? null;
    const stressCandidates = [firstBuySignalDate, firstDefenseDate, firstVminBreakDate].filter((date) => Boolean(date));
    const anchorStartDate = stressCandidates.sort()[0] ?? eventPoints[0]?.date ?? input.points[0].date;
    const anchorEndDate = eventLowDate ?? eventPoints[eventPoints.length - 1]?.date ?? input.points[input.points.length - 1].date;
    const startIndex = Math.max(0, input.points.findIndex((point) => point.date === anchorStartDate));
    const endIndexCandidate = input.points.findIndex((point) => point.date === anchorEndDate);
    const endIndex = endIndexCandidate >= 0 ? endIndexCandidate : input.points.length - 1;
    return {
        mode: 'auto_focus',
        start_date: input.points[shiftTradingIndex(input.points.length, startIndex, -5)]?.date ?? input.points[0].date,
        end_date: input.points[shiftTradingIndex(input.points.length, endIndex, 12)]?.date ??
            input.points[input.points.length - 1].date,
        first_buy_signal_date: firstBuySignalDate,
        first_defense_date: firstDefenseDate,
        first_vmin_break_date: firstVminBreakDate,
        event_low_date: eventLowDate,
    };
}
function buildVariant(event, capOption, mode = 'scenario') {
    const initialState = event.cycle_start.initial_state;
    const marketChart = buildMarketStructurePlayback(event);
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
        };
    }
    const basePrice = initialState.start_price > 0 ? initialState.start_price : event.chart_data[0]?.tqqq_n ?? 100;
    const normalizedBase = event.chart_data.find((point) => typeof point.tqqq_n === 'number' && point.tqqq_n > 0)?.tqqq_n ?? 100;
    const initialPoolCash = initialState.initial_pool_cash;
    const initialCapital = initialState.initial_capital;
    let shares = initialState.initial_share_count;
    let avgCost = initialState.initial_average_price;
    let poolCash = initialState.initial_pool_cash;
    let cumulativePoolSpent = 0;
    let currentCycleNo = null;
    let cyclePoolUsed = 0;
    let cycleStartPoolCash = poolCash;
    let blockedBuyCount = 0;
    let deferredBuyCount = 0;
    let executedBuyCount = 0;
    let executedSellCount = 0;
    let executedDefenseCount = 0;
    let buyLevelState = new Set();
    let sellLevelState = new Set();
    let defenseTriggered = false;
    let nextBuyLevelNo = 1;
    let buyReferenceShares = initialState.initial_share_count;
    let cycleBasePortfolio = initialCapital;
    let cycleBaseEvaluation = initialState.initial_share_count * basePrice;
    let cycleBasePrice = basePrice;
    let activeCyclePoolUsedPct = 0;
    let activeCycleBlockedBuyCount = 0;
    let lastTradeDate = null;
    let previousState = 'initialized';
    let underVminStart = null;
    let recoveryZones = [];
    let failedRecoveryZones = [];
    let dayInCycle = 0;
    const points = [];
    const buyMarkers = [];
    const sellMarkers = [];
    const defenseMarkers = [];
    const poolCapFlags = [];
    const avgCostLine = [];
    const scenarioPhaseZones = [];
    const tradeLog = [];
    const activeCycleNo = event.cycle_framework.cycles.find((cycle) => cycle.is_active_cycle)?.cycle_no ?? null;
    event.chart_data.forEach((point) => {
        const assetPrice = rebaseNormalizedValue(point.tqqq_n, normalizedBase, basePrice);
        const sharesBefore = shares;
        const avgCostBefore = avgCost;
        const poolCashBefore = poolCash;
        const stateBefore = previousState;
        const cycle = findCycle(event.cycle_framework.cycles, point.date);
        if (cycle?.cycle_no !== currentCycleNo) {
            currentCycleNo = cycle?.cycle_no ?? null;
            dayInCycle = 1;
            cyclePoolUsed = 0;
            cycleStartPoolCash = poolCash;
            buyLevelState = new Set();
            sellLevelState = new Set();
            defenseTriggered = false;
            nextBuyLevelNo = 1;
            if (cycle) {
                // Only update base values when entering a valid cycle — not in the post-event period
                // (where findCycle returns null). Without this guard, post-event points reset
                // cycleBaseEvaluation daily as TQQQ recovers, making vref/vmin/vmax shoot back up
                // to old high values, creating the "previous data comes back" visual tangling.
                cycleBasePortfolio = shares * assetPrice + poolCash;
                cycleBaseEvaluation = shares * assetPrice;
                cycleBasePrice = assetPrice;
                buyReferenceShares = shares;
            }
        }
        else {
            dayInCycle += 1;
        }
        const cycleCapAmount = capOption.pct == null ? Number.POSITIVE_INFINITY : cycleStartPoolCash * (capOption.pct / 100);
        const sellLevels = buildRepresentativePriceLevels(Math.max(avgCost, cycleBasePrice), 'sell');
        let tradeReason = null;
        let stateAfterTrade = 'hold';
        let buyBlockedByCycleCap = false;
        let tradeExecuted = false;
        let tradeType = null;
        let tradePrice = null;
        let triggerSource = null;
        let ladderLevelHit = null;
        const preTradeEvaluationValue = Number((shares * assetPrice).toFixed(2));
        const preTradeVminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2));
        const preTradeVmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2));
        const sellGateOpen = preTradeEvaluationValue >= preTradeVmaxEval;
        // Dynamic buy logic:
        //   L1 (first buy in cycle): triggers directly on evaluation <= Vmin breach.
        //     This fixes the split-adjusted low-price regime problem where the fixed -$1
        //     offset caused trigger miss even when evaluation was clearly below Vmin.
        //   L2+ (subsequent buys): use price-based ladder step-down logic.
        // Scenario VR pauses buys during defense regime (MA200 breach)
        const buysAllowed = mode === 'original' || !defenseTriggered;
        const isFirstBuyLevel = nextBuyLevelNo === 1;
        const preTradeBuyBasePrice = buyReferenceShares > 0 ? preTradeVminEval / buyReferenceShares : 0;
        // L1 signal: evaluation breach. L2+ signal: price ladder.
        const preBuyLevelPrice = isFirstBuyLevel
            ? null // L1 uses evaluation trigger, not price ladder
            : preTradeBuyBasePrice > 0 ? Number((preTradeBuyBasePrice - nextBuyLevelNo).toFixed(2)) : null;
        const buySignal = buysAllowed && poolCash > 0 && (isFirstBuyLevel
            ? preTradeEvaluationValue <= preTradeVminEval // L1: eval breach
            : preBuyLevelPrice != null && assetPrice <= preBuyLevelPrice // L2+: price ladder
        );
        // Execute buys: loop to handle multiple level triggers if price drops far in one day
        let buyAttempts = 0;
        while (buysAllowed && poolCash > 0 && shares > 0 && buyAttempts < 10) {
            const vminNow = cycleBaseEvaluation * 0.85;
            const isFirstLevel = nextBuyLevelNo === 1;
            const evalValue = shares * assetPrice;
            const buyBasePriceNow = buyReferenceShares > 0 ? vminNow / buyReferenceShares : 0;
            const nextLevelPrice = Number((buyBasePriceNow - nextBuyLevelNo).toFixed(2));
            // L1: trigger on evaluation breach; L2+: trigger on price ladder
            if (isFirstLevel ? evalValue > vminNow : assetPrice > nextLevelPrice)
                break;
            const remainingCycleCap = Math.max(0, cycleCapAmount - cyclePoolUsed);
            const desiredSpend = Number((initialPoolCash * 0.20).toFixed(2));
            const actualSpend = Math.min(poolCash, desiredSpend, remainingCycleCap);
            if (actualSpend > 0) {
                const newShares = Math.floor(actualSpend / assetPrice);
                if (newShares > 0) {
                    const totalCost = shares * avgCost + newShares * assetPrice;
                    shares += newShares;
                    buyReferenceShares = shares;
                    avgCost = shares > 0 ? Number((totalCost / shares).toFixed(2)) : avgCost;
                    poolCash = Number((poolCash - newShares * assetPrice).toFixed(2));
                    cyclePoolUsed = Number((cyclePoolUsed + newShares * assetPrice).toFixed(2));
                    cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2));
                    tradeReason = 'Vmin recovery attempt buy';
                    stateAfterTrade = 'buy_executed';
                    tradeExecuted = true;
                    tradeType = 'buy';
                    tradePrice = assetPrice;
                    triggerSource = 'buy_vmin_recovery';
                    ladderLevelHit = nextBuyLevelNo;
                    executedBuyCount += 1;
                    lastTradeDate = point.date;
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
                    });
                    nextBuyLevelNo += 1;
                }
                else {
                    break;
                }
            }
            else {
                buyBlockedByCycleCap = true;
                blockedBuyCount += 1;
                deferredBuyCount += 1;
                tradeType = tradeType ?? 'blocked_buy';
                tradePrice = tradePrice ?? assetPrice;
                triggerSource = triggerSource ?? 'cycle_cap_block';
                ladderLevelHit = ladderLevelHit ?? nextBuyLevelNo;
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
                });
                tradeReason = 'buy_blocked_by_cycle_cap';
                stateAfterTrade = 'buy_blocked';
                nextBuyLevelNo += 1;
                break;
            }
            buyAttempts += 1;
        }
        const ma200Breached = typeof point.qqq_n === 'number' && typeof point.ma200_n === 'number' && point.qqq_n < point.ma200_n;
        const defenseSignal = mode === 'scenario' && ma200Breached && !defenseTriggered && shares > 0;
        if (mode === 'scenario' && ma200Breached && !defenseTriggered && shares > 0) {
            const sharesToSell = Math.max(1, Math.floor(shares * 0.2));
            shares -= sharesToSell;
            const cashAdded = Number((sharesToSell * assetPrice).toFixed(2));
            poolCash = Number((poolCash + cashAdded).toFixed(2));
            defenseTriggered = true;
            tradeReason = 'defense_reduction';
            stateAfterTrade = 'defense_reduced';
            tradeExecuted = true;
            tradeType = 'defense';
            tradePrice = assetPrice;
            triggerSource = 'defense_reduction';
            ladderLevelHit = null;
            executedDefenseCount += 1;
            lastTradeDate = point.date;
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
            });
        }
        // [TEST] Original VR (Playback) sell execution disabled to isolate and validate the buy formula cleanly.
        // Sell markers are suppressed for playback mode=original in this test phase.
        const sellSignal = false;
        for (const level of sellLevels) {
            const key = `${currentCycleNo}-sell-${level.level_no}`;
            if (true)
                continue; // [TEST] Original sell execution disabled
            const sharesToSell = Math.max(1, Math.floor(shares * Math.min(0.2, level.weight)));
            shares -= sharesToSell;
            poolCash = Number((poolCash + sharesToSell * assetPrice).toFixed(2));
            tradeReason = 'representative_sell_ladder';
            stateAfterTrade = 'sell_executed';
            tradeExecuted = true;
            tradeType = 'sell';
            tradePrice = assetPrice;
            triggerSource = 'representative_sell_ladder';
            ladderLevelHit = level.level_no;
            executedSellCount += 1;
            lastTradeDate = point.date;
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
            });
            sellLevelState.add(key);
        }
        const evaluationValue = Number((shares * assetPrice).toFixed(2));
        const portfolioValue = Number((evaluationValue + poolCash).toFixed(2));
        const evaluationNormalized = normalizeValue(evaluationValue, cycleBaseEvaluation || 1);
        const portfolioNormalized = normalizeValue(portfolioValue, initialCapital);
        const vrefEval = Number(cycleBaseEvaluation.toFixed(2));
        const vminEval = Number((cycleBaseEvaluation * 0.85).toFixed(2));
        const vmaxEval = Number((cycleBaseEvaluation * 1.15).toFixed(2));
        const vrefLine = normalizeValue(cycleBasePortfolio, initialCapital);
        const vminLine = Number((vrefLine * 0.85).toFixed(2));
        const vmaxLine = Number((vrefLine * 1.15).toFixed(2));
        const vrefPrice = shares > 0 ? Number((vrefEval / shares).toFixed(2)) : null;
        const vminPrice = shares > 0 ? Number((vminEval / shares).toFixed(2)) : null;
        const vmaxPrice = shares > 0 ? Number((vmaxEval / shares).toFixed(2)) : null;
        if (evaluationValue < vminEval && underVminStart == null) {
            underVminStart = point.date;
        }
        else if (evaluationValue >= vminEval && underVminStart != null) {
            recoveryZones.push({
                start_date: underVminStart,
                end_date: point.date,
                label: 'Vmin Recovery Attempt',
            });
            underVminStart = null;
        }
        avgCostLine.push({
            date: point.date,
            value: normalizeValue(avgCost, basePrice),
        });
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
            cycle_pool_used_pct: initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0,
            cycle_pool_cap_pct: capOption.pct,
            cumulative_pool_spent: cumulativePoolSpent,
            buy_blocked_by_cycle_cap: buyBlockedByCycleCap,
            trade_reason: tradeReason,
            state_after_trade: stateAfterTrade,
            structural_state: 'NONE',
        });
        const cyclePoolUsedPct = initialPoolCash > 0 ? Number(((cyclePoolUsed / initialPoolCash) * 100).toFixed(2)) : 0;
        if (currentCycleNo === activeCycleNo) {
            activeCyclePoolUsedPct = cyclePoolUsedPct;
            if (buyBlockedByCycleCap) {
                activeCycleBlockedBuyCount += 1;
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
        });
        previousState = stateAfterTrade;
    });
    if (underVminStart && points.length) {
        failedRecoveryZones.push({
            start_date: underVminStart,
            end_date: points[points.length - 1].date,
            label: 'Failed Recovery',
        });
    }
    const regeneratedScenarioPhaseZones = event.cycle_framework.cycles
        .filter((cycle) => cycle.scenario_bias?.length)
        .map((cycle) => ({
        start_date: cycle.cycle_start_date,
        end_date: cycle.cycle_end_date,
        label: cycle.scenario_bias[0],
    }));
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
    };
}
// vFinal Crash Engine — DD5/DD10 crash detection, MA250 armed sell, ATH-based Vmin ladder, MA200 mop-up
function buildVariantVFinal(event, capOption) {
    const initialState = event.cycle_start.initial_state;
    const marketChart = buildMarketStructurePlayback(event);
    if (!initialState) {
        return {
            cap_option: capOption.key,
            cap_label: capOption.label,
            sell_policy: { vmax_visual_only: false, sell_only_on_defense: false, allow_first_cycle_sell: true },
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
        };
    }
    const normalizedBase = event.chart_data.find((p) => typeof p.tqqq_n === 'number' && p.tqqq_n > 0)?.tqqq_n ?? 100;
    const basePrice = initialState.start_price > 0 ? initialState.start_price : normalizedBase;
    const initialCapital = initialState.initial_capital;
    // Pre-compute price series for vFinal signals
    const tqqqPrices = event.chart_data.map((p) => rebaseNormalizedValue(p.tqqq_n, normalizedBase, basePrice));
    const ma200Series = tqqqPrices.map((_, i) => rollingMean(tqqqPrices, i, 200));
    const ma250Series = tqqqPrices.map((_, i) => rollingMean(tqqqPrices, i, 250));
    const dd5Series = tqqqPrices.map((p, i) => i >= 5 && tqqqPrices[i - 5] > 0 ? (p / tqqqPrices[i - 5]) - 1 : 0);
    const dd10Series = tqqqPrices.map((p, i) => i >= 10 && tqqqPrices[i - 10] > 0 ? (p / tqqqPrices[i - 10]) - 1 : 0);
    const athSeries = [];
    let athPeak = 0;
    for (let i = 0; i < tqqqPrices.length; i++) {
        if (tqqqPrices[i] > 0)
            athPeak = Math.max(athPeak, tqqqPrices[i]);
        athSeries.push(athPeak);
    }
    // Portfolio state (starts with event initial_state positions)
    let shares = initialState.initial_share_count;
    let avgCost = initialState.initial_average_price;
    let poolCash = initialState.initial_pool_cash;
    let vfState = 'NORMAL';
    let armedDays = 0;
    let crashCooldown = 0;
    // Re-entry flags — reset on each crash episode
    let vmin1Done = false; // price <= ATH * 0.60
    let vmin2Done = false; // price <= ATH * 0.50
    let vmin3Done = false; // price <= ATH * 0.40
    let ma200Done = false;
    let postExitCooldown = 0; // min days between exit and re-entry buys
    let structuralState = 'NONE';
    let stressStartDate = null; // when STRESS was entered
    let crashEpisodeStartDate = null;
    let crashEpisodeDays = 0;
    let sustainedImprovementDays = 0; // days of continuous structural improvement (for downgrade)
    // Cycle-based V-band reference (portfolio value at cycle start)
    let cycleBasePortfolio = initialCapital;
    let dayInCycle = 0;
    // Counters
    let executedBuyCount = 0;
    let executedSellCount = 0;
    let cumulativePoolSpent = 0;
    let lastTradeDate = null;
    let currentCycleNo = null;
    let previousState = 'initialized';
    // vFinal ARMED debug counters
    let dbg_armedEnterCount = 0;
    let dbg_cancelByRecovery = 0;
    let dbg_cancelByTimeout = 0;
    let dbg_ma250RetestWhileArmed = 0;
    let dbg_armedDaysAccum = 0;
    let dbg_armedExitCount = 0;
    // Pool / crash debug
    let dbg_crashTriggerDates = [];
    let dbg_normalVminBuys = [];
    let dbg_normalVminBlocked = 0; // crash active when price hit level
    let dbg_structuralTransitions = [];
    const points = [];
    const buyMarkers = [];
    const sellMarkers = [];
    const defenseMarkers = [];
    const poolCapFlags = [];
    const avgCostLine = [];
    const tradeLog = [];
    const activeCycleNo = event.cycle_framework.cycles.find((c) => c.is_active_cycle)?.cycle_no ?? null;
    event.chart_data.forEach((point, i) => {
        const assetPrice = rebaseNormalizedValue(point.tqqq_n, normalizedBase, basePrice);
        const sharesBefore = shares;
        const avgCostBefore = avgCost;
        const poolCashBefore = poolCash;
        const stateBefore = previousState;
        const cycle = findCycle(event.cycle_framework.cycles, point.date);
        if (cycle?.cycle_no !== currentCycleNo) {
            currentCycleNo = cycle?.cycle_no ?? null;
            dayInCycle = 1;
            if (cycle) {
                // Portfolio value at cycle start = V-band reference
                cycleBasePortfolio = Number((shares * assetPrice + poolCash).toFixed(2));
            }
        }
        else {
            dayInCycle += 1;
        }
        const ma200 = ma200Series[i];
        const ma250 = ma250Series[i];
        const dd5 = dd5Series[i];
        const dd10 = dd10Series[i];
        const ath = athSeries[i];
        const TRANCHE = Number((initialCapital * 0.20).toFixed(2));
        let tradeReason = null;
        let stateAfterTrade = 'hold';
        let tradeExecuted = false;
        let tradeType = null;
        let tradePrice = null;
        let triggerSource = null;
        let ladderLevelHit = null;
        const buySignal = false;
        const sellSignal = false;
        const defenseSignal = false;
        if (crashCooldown > 0)
            crashCooldown -= 1;
        if (postExitCooldown > 0)
            postExitCooldown -= 1;
        // ── NORMAL: crash detection ──
        if (vfState === 'NORMAL' && crashCooldown === 0) {
            const ma200Gate = ma200 != null && assetPrice <= ma200 * 1.05;
            const crashTrigger = dd5 <= -0.10 && dd10 <= -0.18 && ma200Gate;
            if (crashTrigger) {
                dbg_crashTriggerDates.push(point.date);
                if (crashEpisodeStartDate === null) {
                    crashEpisodeStartDate = point.date;
                    crashEpisodeDays = 0;
                }
                const ma250Retest = ma250 != null && assetPrice >= ma250 * 0.995;
                if (ma250Retest) {
                    // Immediate sell — price at or above MA250
                    if (shares > 0) {
                        const sharesToSell = shares;
                        const evalAtSell = Number((sharesToSell * assetPrice).toFixed(2));
                        const cashAdded = Number((sharesToSell * assetPrice).toFixed(2));
                        poolCash = Number((poolCash + cashAdded).toFixed(2));
                        shares = 0;
                        avgCost = 0;
                        vfState = 'EXIT_DONE';
                        postExitCooldown = 5;
                        ma200Done = false;
                        tradeReason = 'vFinal crash exit — MA250 retest immediate';
                        stateAfterTrade = 'sell_executed';
                        tradeExecuted = true;
                        tradeType = 'sell';
                        tradePrice = assetPrice;
                        triggerSource = 'representative_sell_ladder';
                        executedSellCount += 1;
                        lastTradeDate = point.date;
                        sellMarkers.push({
                            date: point.date,
                            price: assetPrice,
                            normalized_value: normalizeValue(assetPrice, basePrice),
                            cycle_no: currentCycleNo ?? 0,
                            title: 'Crash Exit',
                            reason: 'vFinal: DD5/DD10 crash + MA250 retest — 100% sell',
                            marker_type: 'sell',
                            trigger_source: 'representative_sell_ladder',
                            ladder_level_hit: 1,
                            sell_gate_open: true,
                            share_delta: -sharesToSell,
                            shares_after_trade: shares,
                            avg_cost_after_trade: 0,
                            pool_cash_after_trade: Number(poolCash.toFixed(2)),
                            total_portfolio_value: Number((poolCash).toFixed(2)),
                            cycle_pool_used_pct: 0,
                            evaluation_value: evalAtSell,
                            vref_eval: 0,
                            vmin_eval: 0,
                            vmax_eval: 0,
                            state_after_trade: stateAfterTrade,
                        });
                    }
                    else {
                        vfState = 'EXIT_DONE';
                        ma200Done = false;
                    }
                }
                else {
                    // ARMED — wait for MA250 retest
                    vfState = 'ARMED';
                    armedDays = 0;
                    dbg_armedEnterCount += 1;
                }
            }
            // Opportunistic Vmin pool deployment in NORMAL state (ATH-fraction ladder)
            // Shared vmin flags with EXIT_DONE prevent double-buying
            if (vfState === 'NORMAL' && poolCash >= 1) {
                const vminLevels = [
                    { done: vmin1Done, fraction: 0.60, label: 'Vmin -40% ATH', levelNo: 1 },
                    { done: vmin2Done, fraction: 0.50, label: 'Vmin -50% ATH', levelNo: 2 },
                    { done: vmin3Done, fraction: 0.40, label: 'Vmin -60% ATH', levelNo: 3 },
                ];
                for (const lvl of vminLevels) {
                    if (!lvl.done && ath > 0 && assetPrice <= ath * lvl.fraction && poolCash >= 1) {
                        const spend = Math.min(poolCash, TRANCHE);
                        const newShares = Math.floor(spend / assetPrice);
                        if (newShares > 0) {
                            const totalCost = shares * avgCost + newShares * assetPrice;
                            shares += newShares;
                            avgCost = Number((totalCost / shares).toFixed(2));
                            poolCash = Number((poolCash - newShares * assetPrice).toFixed(2));
                            cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2));
                            if (lvl.levelNo === 1)
                                vmin1Done = true;
                            else if (lvl.levelNo === 2)
                                vmin2Done = true;
                            else
                                vmin3Done = true;
                            dbg_normalVminBuys.push({ date: point.date, level: lvl.levelNo, price: assetPrice });
                            tradeReason = lvl.label;
                            stateAfterTrade = 'buy_executed';
                            tradeExecuted = true;
                            tradeType = 'buy';
                            tradePrice = assetPrice;
                            triggerSource = 'buy_vmin_recovery';
                            ladderLevelHit = lvl.levelNo;
                            executedBuyCount += 1;
                            lastTradeDate = point.date;
                            buyMarkers.push({
                                date: point.date,
                                price: assetPrice,
                                normalized_value: normalizeValue(assetPrice, basePrice),
                                cycle_no: currentCycleNo ?? 0,
                                title: lvl.label,
                                reason: lvl.label,
                                marker_type: 'buy',
                                trigger_source: 'buy_vmin_recovery',
                                ladder_level_hit: lvl.levelNo,
                                share_delta: newShares,
                                shares_after_trade: shares,
                                avg_cost_after_trade: Number(avgCost.toFixed(2)),
                                pool_cash_after_trade: Number(poolCash.toFixed(2)),
                                total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
                                cycle_pool_used_pct: initialCapital > 0
                                    ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
                                    : 0,
                                evaluation_value: Number((shares * assetPrice).toFixed(2)),
                                vref_eval: 0,
                                vmin_eval: 0,
                                vmax_eval: 0,
                                state_after_trade: stateAfterTrade,
                            });
                            break; // one tranche per day
                        }
                    }
                }
            }
        }
        // ── ARMED: short-validity crash sell signal (15 trading days) ──
        // Sell only on weak-rebound MA250 retest while crash signal is still active.
        // Cancel (no sell) if crash eases (recovery confirmation) or signal times out.
        else if (vfState === 'ARMED') {
            armedDays += 1;
            dbg_armedDaysAccum += 1;
            // Recovery confirmation → both dd5 AND dd10 must recover (AND, not OR)
            const crashRecovered = dd5 > -0.05 && dd10 > -0.10;
            // Timeout → stale signal → expire silently, no forced sell (15d)
            const signalExpired = armedDays >= 15;
            if (crashRecovered || signalExpired) {
                // Signal expired — return to NORMAL without any trade
                if (crashRecovered)
                    dbg_cancelByRecovery += 1;
                else
                    dbg_cancelByTimeout += 1;
                dbg_armedExitCount += 1;
                vfState = 'NORMAL';
                armedDays = 0;
                crashEpisodeStartDate = null;
                crashEpisodeDays = 0;
                structuralState = 'NONE';
                stressStartDate = null;
            }
            else {
                // MA250 retest: close retest OR high proxy (+3% of close, TQQQ intraday range)
                const closeRetest = ma250 != null && assetPrice >= ma250 * 0.995;
                const highProxyRetest = ma250 != null && assetPrice >= ma250 * 0.97;
                const ma250Retest = closeRetest || highProxyRetest;
                if (ma250Retest)
                    dbg_ma250RetestWhileArmed += 1;
                if (ma250Retest && armedDays >= 2) {
                    if (shares > 0) {
                        const sharesToSell = shares;
                        const evalAtSell = Number((sharesToSell * assetPrice).toFixed(2));
                        const cashAdded = Number((sharesToSell * assetPrice).toFixed(2));
                        poolCash = Number((poolCash + cashAdded).toFixed(2));
                        shares = 0;
                        avgCost = 0;
                        tradeReason = 'vFinal armed sell — MA250 retest (weak rebound)';
                        stateAfterTrade = 'sell_executed';
                        tradeExecuted = true;
                        tradeType = 'sell';
                        tradePrice = assetPrice;
                        triggerSource = 'representative_sell_ladder';
                        executedSellCount += 1;
                        lastTradeDate = point.date;
                        sellMarkers.push({
                            date: point.date,
                            price: assetPrice,
                            normalized_value: normalizeValue(assetPrice, basePrice),
                            cycle_no: currentCycleNo ?? 0,
                            title: 'Crash Exit (Armed)',
                            reason: tradeReason ?? '',
                            marker_type: 'sell',
                            trigger_source: 'representative_sell_ladder',
                            ladder_level_hit: 1,
                            sell_gate_open: true,
                            share_delta: -sharesToSell,
                            shares_after_trade: shares,
                            avg_cost_after_trade: 0,
                            pool_cash_after_trade: Number(poolCash.toFixed(2)),
                            total_portfolio_value: Number((poolCash).toFixed(2)),
                            cycle_pool_used_pct: 0,
                            evaluation_value: evalAtSell,
                            vref_eval: 0,
                            vmin_eval: 0,
                            vmax_eval: 0,
                            state_after_trade: stateAfterTrade,
                        });
                    }
                    vfState = 'EXIT_DONE';
                    postExitCooldown = 5;
                    ma200Done = false;
                }
            }
        }
        // ── EXIT_DONE: Vmin ATH ladder then MA200 mop-up ──
        else if (vfState === 'EXIT_DONE' && postExitCooldown === 0) {
            // Layer 1 — three Vmin tranches at ATH fractions
            const vminLevels = [
                { done: vmin1Done, fraction: 0.60, label: 'Vmin -40% ATH', levelNo: 1 },
                { done: vmin2Done, fraction: 0.50, label: 'Vmin -50% ATH', levelNo: 2 },
                { done: vmin3Done, fraction: 0.40, label: 'Vmin -60% ATH', levelNo: 3 },
            ];
            for (const lvl of vminLevels) {
                if (!lvl.done && ath > 0 && assetPrice <= ath * lvl.fraction && poolCash >= 1) {
                    const spend = Math.min(poolCash, TRANCHE);
                    const newShares = Math.floor(spend / assetPrice);
                    if (newShares > 0) {
                        const totalCost = shares * avgCost + newShares * assetPrice;
                        shares += newShares;
                        avgCost = Number((totalCost / shares).toFixed(2));
                        poolCash = Number((poolCash - newShares * assetPrice).toFixed(2));
                        cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2));
                        if (lvl.levelNo === 1)
                            vmin1Done = true;
                        else if (lvl.levelNo === 2)
                            vmin2Done = true;
                        else
                            vmin3Done = true;
                        tradeReason = lvl.label;
                        stateAfterTrade = 'buy_executed';
                        tradeExecuted = true;
                        tradeType = 'buy';
                        tradePrice = assetPrice;
                        triggerSource = 'buy_vmin_recovery';
                        ladderLevelHit = lvl.levelNo;
                        executedBuyCount += 1;
                        lastTradeDate = point.date;
                        buyMarkers.push({
                            date: point.date,
                            price: assetPrice,
                            normalized_value: normalizeValue(assetPrice, basePrice),
                            cycle_no: currentCycleNo ?? 0,
                            title: lvl.label,
                            reason: lvl.label,
                            marker_type: 'buy',
                            trigger_source: 'buy_vmin_recovery',
                            ladder_level_hit: lvl.levelNo,
                            share_delta: newShares,
                            shares_after_trade: shares,
                            avg_cost_after_trade: Number(avgCost.toFixed(2)),
                            pool_cash_after_trade: Number(poolCash.toFixed(2)),
                            total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
                            cycle_pool_used_pct: initialCapital > 0
                                ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
                                : 0,
                            evaluation_value: Number((shares * assetPrice).toFixed(2)),
                            vref_eval: 0,
                            vmin_eval: 0,
                            vmax_eval: 0,
                            state_after_trade: stateAfterTrade,
                        });
                    }
                }
            }
            // Layer 3 — MA200 mop-up (buy all remaining cash when price recovers above MA200)
            if (!ma200Done && ma200 != null && assetPrice >= ma200 && poolCash >= 1) {
                const spend = poolCash;
                const newShares = Math.floor(spend / assetPrice);
                if (newShares > 0) {
                    const totalCost = shares * avgCost + newShares * assetPrice;
                    shares += newShares;
                    avgCost = Number((totalCost / shares).toFixed(2));
                    poolCash = Number((poolCash - newShares * assetPrice).toFixed(2));
                    cumulativePoolSpent = Number((cumulativePoolSpent + newShares * assetPrice).toFixed(2));
                    ma200Done = true;
                    vfState = 'NORMAL';
                    crashCooldown = 10;
                    crashEpisodeStartDate = null;
                    crashEpisodeDays = 0;
                    structuralState = 'NONE';
                    stressStartDate = null;
                    tradeReason = 'vFinal MA200 mop-up — full re-entry';
                    stateAfterTrade = 'buy_executed';
                    tradeExecuted = true;
                    tradeType = 'buy';
                    tradePrice = assetPrice;
                    triggerSource = 'buy_vmin_recovery';
                    ladderLevelHit = 4;
                    executedBuyCount += 1;
                    lastTradeDate = point.date;
                    buyMarkers.push({
                        date: point.date,
                        price: assetPrice,
                        normalized_value: normalizeValue(assetPrice, basePrice),
                        cycle_no: currentCycleNo ?? 0,
                        title: 'MA200 Re-entry',
                        reason: 'vFinal: price crosses MA200 — buy all remaining cash',
                        marker_type: 'buy',
                        trigger_source: 'buy_vmin_recovery',
                        ladder_level_hit: 4,
                        share_delta: newShares,
                        shares_after_trade: shares,
                        avg_cost_after_trade: Number(avgCost.toFixed(2)),
                        pool_cash_after_trade: Number(poolCash.toFixed(2)),
                        total_portfolio_value: Number((shares * assetPrice + poolCash).toFixed(2)),
                        cycle_pool_used_pct: initialCapital > 0
                            ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
                            : 0,
                        evaluation_value: Number((shares * assetPrice).toFixed(2)),
                        vref_eval: 0,
                        vmin_eval: 0,
                        vmax_eval: 0,
                        state_after_trade: stateAfterTrade,
                    });
                }
            }
        }
        // Track B: Structural state update (WO60-B hybrid macro+internal+persistence+AI scoring)
        {
            // ── Macro flags (from MSS score + QQQ trend signals) ──
            const mssScore = typeof point.score === 'number' ? point.score : 100;
            const mssLevel = typeof point.level === 'number' ? point.level : 0;
            const qqqN = typeof point.qqq_n === 'number' ? point.qqq_n : 100;
            const ma50N = typeof point.ma50_n === 'number' ? point.ma50_n : 100;
            const ma200N = typeof point.ma200_n === 'number' ? point.ma200_n : 100;
            const tqqqDd = typeof point.tqqq_dd === 'number' ? point.tqqq_dd : 0;
            const liquidityTightening = mssScore < 95;
            const creditStress = mssScore < 88;
            const financialConditionsTight = mssScore < 84;
            const growthScare = mssLevel >= 3;
            const policyPressure = ma50N > 0 && qqqN < ma50N;
            const macroScore = Number(liquidityTightening) + Number(creditStress) +
                Number(financialConditionsTight) + Number(growthScare) + Number(policyPressure);
            // ── Internal flags ──
            const breadthWeak = ma200N > 0 && qqqN < ma200N;
            const reboundFailure = crashEpisodeDays > 30;
            const trendBroken = ma200N > 0 && qqqN < ma200N * 0.97;
            const volPersistent = tqqqDd < -15;
            const leverageWeakness = tqqqDd < -30;
            const internalScore = Number(breadthWeak) + Number(reboundFailure) +
                Number(trendBroken) + Number(volPersistent) + Number(leverageWeakness);
            // ── Persistence score ──
            // Note: persistenceScore >= 3 requires ep > 20d (gates premature escalation)
            //       persistenceScore >= 4 requires ep > 40d (gates CRASH entry)
            const persistenceScore = Number(crashEpisodeStartDate !== null) +
                Number(crashEpisodeDays > 20) +
                Number(crashEpisodeDays > 40) +
                Number(crashEpisodeDays > 60) +
                Number(dd10 < -0.08);
            // ── AI assessment (rule-based simulation — no live API call in playback loop) ──
            const totalScore = macroScore + internalScore + persistenceScore;
            const aiAssessment = totalScore >= 12 || (macroScore >= 4 && internalScore >= 4) ? 'structural_crash_candidate' :
                totalScore >= 8 || (macroScore >= 3 && internalScore >= 3) ? 'structural_deterioration' :
                    totalScore >= 5 || persistenceScore >= 3 ? 'persistent_stress' :
                        'temporary_shock';
            const athDD = ath > 0 ? (assetPrice / ath) - 1 : 0;
            const severeDamage = dd10 < -0.30 || athDD < -0.30;
            const prevStructural = structuralState;
            // ── Upgrade transitions (episode-driven; elif prevents same-day multi-level jumps) ──
            if (crashEpisodeStartDate !== null) {
                crashEpisodeDays += 1;
                // NONE -> STRUCTURAL_WATCH (requires persistenceScore >= 3, i.e. ep > 20d)
                if (structuralState === 'NONE') {
                    if (persistenceScore >= 3 &&
                        (macroScore >= 2 || internalScore >= 3 || aiAssessment === 'persistent_stress')) {
                        structuralState = 'STRUCTURAL_WATCH';
                        sustainedImprovementDays = 0;
                    }
                    // STRUCTURAL_WATCH -> STRUCTURAL_STRESS (elif: no same-day jump from NONE->WATCH->STRESS)
                }
                else if (structuralState === 'STRUCTURAL_WATCH') {
                    if (persistenceScore >= 3 &&
                        ((macroScore >= 3 && internalScore >= 3) ||
                            (aiAssessment === 'structural_deterioration' && macroScore >= 3))) {
                        structuralState = 'STRUCTURAL_STRESS';
                        stressStartDate = point.date;
                        sustainedImprovementDays = 0;
                    }
                    // STRUCTURAL_STRESS -> STRUCTURAL_CRASH (requires ep > 40d via persistenceScore >= 4)
                }
                else if (structuralState === 'STRUCTURAL_STRESS' && severeDamage) {
                    if (persistenceScore >= 4 &&
                        ((macroScore >= 4 && internalScore >= 3) ||
                            (aiAssessment === 'structural_crash_candidate' && macroScore >= 4))) {
                        structuralState = 'STRUCTURAL_CRASH';
                        sustainedImprovementDays = 0;
                    }
                }
            }
            // ── Downgrade logic: sustained improvement window (15 days) ──
            const structuralImproving = macroScore <= 1 &&
                internalScore <= 2 &&
                crashEpisodeStartDate === null &&
                (aiAssessment === 'temporary_shock' || aiAssessment === 'persistent_stress');
            if (structuralImproving && structuralState !== 'NONE') {
                sustainedImprovementDays += 1;
                if (sustainedImprovementDays >= 15) {
                    if (structuralState === 'STRUCTURAL_CRASH')
                        structuralState = 'STRUCTURAL_STRESS';
                    else if (structuralState === 'STRUCTURAL_STRESS')
                        structuralState = 'STRUCTURAL_WATCH';
                    else if (structuralState === 'STRUCTURAL_WATCH')
                        structuralState = 'NONE';
                    sustainedImprovementDays = 0;
                }
            }
            else if (!structuralImproving && crashEpisodeStartDate === null) {
                sustainedImprovementDays = 0;
            }
            // ── Log state transitions ──
            if (structuralState !== prevStructural) {
                dbg_structuralTransitions.push({
                    date: point.date,
                    from: prevStructural,
                    to: structuralState,
                    episode_day: crashEpisodeDays,
                    macro_score: macroScore,
                    internal_score: internalScore,
                    persistence_score: persistenceScore,
                    ai_assessment: aiAssessment,
                    ath_dd_pct: Math.round(athDD * 1000) / 10,
                    dd10_pct: Math.round(dd10 * 1000) / 10,
                });
            }
        }
        const evaluationValue = Number((shares * assetPrice).toFixed(2));
        const portfolioValue = Number((evaluationValue + poolCash).toFixed(2));
        const poolUsedPct = initialCapital > 0
            ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
            : 0;
        // V-band: portfolio-based reference from cycle start
        const vrefEval = Number(cycleBasePortfolio.toFixed(2));
        const vminEval = Number((cycleBasePortfolio * 0.85).toFixed(2));
        const vmaxEval = Number((cycleBasePortfolio * 1.15).toFixed(2));
        const vrefLine = normalizeValue(cycleBasePortfolio, initialCapital);
        const vminLine = Number((vrefLine * 0.85).toFixed(2));
        const vmaxLine = Number((vrefLine * 1.15).toFixed(2));
        avgCostLine.push({ date: point.date, value: normalizeValue(avgCost, basePrice) });
        points.push({
            date: point.date,
            in_event: point.in_event,
            cycle_no: currentCycleNo,
            day_in_cycle: dayInCycle,
            asset_price: Number(assetPrice.toFixed(2)),
            evaluation_value_before_trade: Number((sharesBefore * assetPrice).toFixed(2)),
            evaluation_value: evaluationValue,
            evaluation_normalized: normalizeValue(evaluationValue, initialCapital),
            tqqq_price_normalized: normalizeValue(assetPrice, basePrice),
            portfolio_value_before_trade: Number((sharesBefore * assetPrice + poolCashBefore).toFixed(2)),
            portfolio_value: portfolioValue,
            portfolio_normalized: normalizeValue(portfolioValue, initialCapital),
            vref_eval: vrefEval,
            vmin_eval: vminEval,
            vmax_eval: vmaxEval,
            vref_line: vrefLine,
            vmin_line: vminLine,
            vmax_line: vmaxLine,
            vref_price: shares > 0 ? Number((vrefEval / shares).toFixed(2)) : null,
            vmin_price: shares > 0 ? Number((vminEval / shares).toFixed(2)) : null,
            vmax_price: shares > 0 ? Number((vmaxEval / shares).toFixed(2)) : null,
            avg_cost_after_trade: Number(avgCost.toFixed(2)),
            avg_cost_normalized: normalizeValue(avgCost, basePrice),
            shares_before_trade: sharesBefore,
            shares_after_trade: shares,
            pool_cash_before_trade: Number(poolCashBefore.toFixed(2)),
            pool_cash_after_trade: Number(poolCash.toFixed(2)),
            cycle_pool_used_pct: poolUsedPct,
            cycle_pool_cap_pct: capOption.pct,
            cumulative_pool_spent: cumulativePoolSpent,
            buy_blocked_by_cycle_cap: false,
            trade_reason: tradeReason,
            state_after_trade: stateAfterTrade,
            structural_state: structuralState,
        });
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
            stock_evaluation_value: Number((sharesBefore * assetPrice).toFixed(2)),
            vref_eval: 0,
            vmax_eval: 0,
            sell_gate_open: false,
            shares_before: sharesBefore,
            shares_after: shares,
            avg_cost_before: Number(avgCostBefore.toFixed(2)),
            avg_cost_after: Number(avgCost.toFixed(2)),
            pool_cash_before: Number(poolCashBefore.toFixed(2)),
            pool_cash_after: Number(poolCash.toFixed(2)),
            cycle_pool_used_pct: poolUsedPct,
            blocked_by_cap: false,
            state_after: stateAfterTrade,
        });
        previousState = stateAfterTrade;
    });
    // ── vFinal ARMED debug log ──
    const avgArmedDays = dbg_armedExitCount > 0
        ? Number((dbg_armedDaysAccum / dbg_armedExitCount).toFixed(1))
        : dbg_armedDaysAccum;
    const poolUsedPct = initialCapital > 0
        ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(1))
        : 0;
    console.log('[vFinal ARMED]', 'event:', event.name, '| armedEnterCount:', dbg_armedEnterCount, '| cancel_by_recovery:', dbg_cancelByRecovery, '| cancel_by_timeout:', dbg_cancelByTimeout, '| ma250RetestWhileArmedCount:', dbg_ma250RetestWhileArmed, '| sellExecutionCount:', executedSellCount, '| buyExecutionCount:', executedBuyCount, '| avgArmedDays:', avgArmedDays, '| poolUsed%:', poolUsedPct, '| normalVminBuys:', dbg_normalVminBuys.length, '| crashTriggerDates:', dbg_crashTriggerDates, '| normalVminBuyDates:', dbg_normalVminBuys, '| structuralTransitions:', dbg_structuralTransitions);
    return {
        cap_option: capOption.key,
        cap_label: capOption.label,
        sell_policy: { vmax_visual_only: false, sell_only_on_defense: false, allow_first_cycle_sell: true },
        points,
        buy_markers: buyMarkers,
        sell_markers: sellMarkers,
        defense_markers: defenseMarkers,
        avg_cost_line: avgCostLine,
        pool_cap_flags: poolCapFlags,
        vmin_recovery_attempt_zones: [],
        failed_recovery_zones: [],
        scenario_phase_zones: [],
        pool_usage_summary: {
            initial_pool_cash: initialCapital,
            cycle_pool_cap_pct: capOption.pct,
            cycle_pool_used_pct: initialCapital > 0
                ? Number(((cumulativePoolSpent / initialCapital) * 100).toFixed(2))
                : 0,
            active_cycle_pool_used_pct: 0,
            pool_cash_remaining: points[points.length - 1]?.pool_cash_after_trade ?? 0,
            cumulative_pool_spent: cumulativePoolSpent,
            blocked_buy_count: 0,
            deferred_buy_count: 0,
            executed_buy_count: executedBuyCount,
            executed_sell_count: executedSellCount,
            executed_defense_count: 0,
            active_cycle_no: activeCycleNo,
            active_cycle_blocked_buy_count: 0,
            last_trade_date: lastTradeDate,
        },
        trade_log: tradeLog,
        validation_summary: {
            has_buy_execution: executedBuyCount > 0,
            has_sell_execution: executedSellCount > 0,
            has_defense_execution: false,
            avg_cost_changed: tradeLog.some((item) => item.avg_cost_after !== item.avg_cost_before),
            shares_changed: tradeLog.some((item) => item.shares_after !== item.shares_before),
            pool_cash_changed: tradeLog.some((item) => item.pool_cash_after !== item.pool_cash_before),
            blocked_by_cap_observed: false,
            executed_buy_count: executedBuyCount,
            executed_sell_count: executedSellCount,
            executed_defense_count: 0,
            blocked_buy_count: 0,
        },
        market_chart: marketChart,
        cycle_summaries: buildCycleExecutionSummaries({
            points,
            buy_markers: buyMarkers,
            sell_markers: sellMarkers,
            defense_markers: defenseMarkers,
            pool_cap_flags: poolCapFlags,
            initial_pool_cash: initialCapital,
            cycles: event.cycle_framework.cycles,
        }),
        focus_window: buildExecutionFocusWindow({ points, trade_log: tradeLog }),
    };
}
function buildExecutionPlayback(event, selectedCap = '50') {
    const originalVr = buildVariant(event, { key: 'unlimited', pct: null, label: 'Original VR (Playback)' }, 'original');
    const capOption = CAP_OPTIONS.find((o) => o.key === selectedCap) ?? CAP_OPTIONS[2];
    const variant = buildVariantVFinal(event, capOption);
    const comparison = buildComparisonView(originalVr, variant);
    return {
        default_cap_option: selectedCap,
        original_vr: originalVr,
        variants: { [selectedCap]: variant },
        comparison_by_cap: { [selectedCap]: comparison },
    };
}
/** Lazily build a single cap variant + comparison (for client-side on-demand compute). */
function buildVariantForCap(event, cap) {
    const originalVr = buildVariant(event, { key: 'unlimited', pct: null, label: 'Original VR (Playback)' }, 'original');
    const capOption = CAP_OPTIONS.find((o) => o.key === cap) ?? CAP_OPTIONS[2];
    const variant = buildVariantVFinal(event, capOption);
    return { variant, comparison: buildComparisonView(originalVr, variant) };
}
function summarizeVariant(variant) {
    const eventLowPoint = variant.points
        .filter((point) => point.in_event)
        .reduce((lowest, point) => {
        if (!lowest || point.asset_price < lowest.asset_price)
            return point;
        return lowest;
    }, null);
    const lowestPoolRemaining = variant.points.reduce((min, point) => Math.min(min, point.pool_cash_after_trade), Number.POSITIVE_INFINITY);
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
        final_unrealized_pl: Number((((variant.points[variant.points.length - 1]?.portfolio_value ?? 0) - (variant.points[0]?.portfolio_value ?? 0)).toFixed(2))),
        final_pool_cash_remaining: Number((variant.points[variant.points.length - 1]?.pool_cash_after_trade ?? 0).toFixed(2)),
        final_pool_used_pct: variant.pool_usage_summary.initial_pool_cash > 0
            ? Number(((variant.pool_usage_summary.cumulative_pool_spent / variant.pool_usage_summary.initial_pool_cash) * 100).toFixed(2))
            : 0,
    };
}
function formatDelta(delta, suffix = '') {
    const rounded = Number(delta.toFixed(2));
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded}${suffix}`;
}
function buildComparisonView(originalVr, scenarioVr) {
    const originalSummary = summarizeVariant(originalVr);
    const scenarioSummary = summarizeVariant(scenarioVr);
    const originalMap = new Map(originalVr.points.map((point) => [point.date, point]));
    const chartRows = scenarioVr.points.map((point) => {
        const originalPoint = originalMap.get(point.date) ?? originalVr.points[0];
        return {
            date: point.date,
            original_evaluation_value: originalPoint?.portfolio_value ?? 0,
            scenario_evaluation_value: point.portfolio_value,
            original_portfolio_value: originalPoint?.portfolio_value ?? 0,
            scenario_portfolio_value: point.portfolio_value,
            original_pool_remaining: originalPoint?.pool_cash_after_trade ?? 0,
            scenario_pool_remaining: point.pool_cash_after_trade,
        };
    });
    const behaviorRows = [
        {
            label: 'Buy Logic',
            original_value: 'Mechanical cycle-grid deployment',
            scenario_value: 'vFinal: ATH-based Vmin ladder (−40/−50/−60%) + MA200 full re-entry',
        },
        {
            label: 'Sell Logic',
            original_value: 'Representative sell ladder (not active in current test)',
            scenario_value: 'vFinal: 100% sell at MA250 on crash trigger (DD5≤−10% AND DD10≤−18%)',
        },
        {
            label: 'Crash Response',
            original_value: 'No explicit crash detection or exit',
            scenario_value: 'vFinal: immediate exit on MA250 retest; ARMED wait up to 60 days if below MA250',
        },
        {
            label: 'Re-entry Logic',
            original_value: 'Cycle-grid re-enters incrementally',
            scenario_value: 'vFinal: 20% each at ATH×0.60/0.50/0.40, then remaining cash at MA200 cross',
        },
        {
            label: 'Pool Usage',
            original_value: 'Deploys throughout cycle at grid levels',
            scenario_value: 'vFinal: holds 100% cash until ATH-fraction price targets or MA200 recovery',
        },
        {
            label: 'Objective',
            original_value: 'Cost-basis improvement via cycle-grid',
            scenario_value: 'Crash survival: full exit on signal, staged ATH-based re-entry, MA200 mop-up',
        },
        {
            label: 'Avg Cost Behavior',
            original_value: 'Gradually improves through grid buys',
            scenario_value: 'vFinal: resets to 0 on crash exit, rebuilds from deep Vmin levels',
        },
    ];
    const defenseDelta = scenarioSummary.defense_count - originalSummary.defense_count;
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
    ];
    return {
        chart_rows: chartRows,
        original_summary: originalSummary,
        scenario_summary: scenarioSummary,
        metric_cards: metricCards,
        behavior_rows: behaviorRows,
        interpretation: {
            headline: scenarioSummary.sell_count > 0
                ? 'Scenario VR (vFinal) executed a crash exit and staged re-entry via ATH-based Vmin ladder.'
                : 'Scenario VR (vFinal) held position — no crash trigger fired during this replay.',
            subline: scenarioSummary.sell_count > 0
                ? 'vFinal exits 100% at MA250 on DD5/DD10 crash signal, then re-enters at ATH×0.60/0.50/0.40 and MA200 recovery.'
                : 'Original VR (Playback) uses mechanical cycle-grid deployment; vFinal waits for crash trigger before deploying crash-survival logic.',
        },
    };
}
function runExecutionPlaybackExamples(events) {
    const event = events.find((item) => item.event_id === '2020-02') ?? events[0];
    const playback = event ? buildExecutionPlayback(event) : null;
    return {
        passed: Boolean(playback) &&
            Object.values(playback?.variants ?? {}).every((variant) => Array.isArray(variant.points)) &&
            (playback?.variants['50']?.pool_usage_summary.cycle_pool_cap_pct ?? null) === 50,
        default_cap_option: playback?.default_cap_option ?? null,
        point_count: playback?.variants['50']?.points.length ?? 0,
    };
}
