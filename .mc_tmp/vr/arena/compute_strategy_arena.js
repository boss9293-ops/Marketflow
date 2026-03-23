"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARENA_CYCLE_CAP_PCT = exports.ARENA_CASH_FLOOR_PCT = exports.ARENA_MAX_INVESTED_PCT = exports.ARENA_INITIAL_INVESTED_PCT = void 0;
exports.runStrategyArenaOnSyntheticPath = runStrategyArenaOnSyntheticPath;
exports.buildStrategyArena = buildStrategyArena;
exports.runStrategyArenaExamples = runStrategyArenaExamples;
const ARENA_TARGETS = [
    { id: '2008-crash', label: '2008 Crash', standard_event_name: '2007-07 Risk Event' },
    { id: '2011-debt-crisis', label: '2011 Debt Crisis', standard_event_name: '2011-06 Risk Event' },
    { id: '2018-volmageddon', label: '2018 Volmageddon', standard_event_name: '2018-02 Risk Event' },
    { id: '2020-covid-crash', label: '2020 COVID Crash', standard_event_name: '2020-02 Risk Event' },
    { id: '2022-bear-market', label: '2022 Bear Market', standard_event_name: '2021-12 Risk Event' },
    { id: '2024-yen-carry', label: '2024 Yen Carry', standard_event_name: '2024-07 Risk Event', visible_start: '2024-04-01' },
    {
        id: '2025-tariff',
        label: '2025 Tariff Volatility Period',
        standard_event_name: '2025-01 Risk Event',
        visible_start: '2024-12-01',
        visible_end: '2025-08-30',
    },
];
exports.ARENA_INITIAL_INVESTED_PCT = 80;
exports.ARENA_MAX_INVESTED_PCT = 80;
exports.ARENA_CASH_FLOOR_PCT = 20;
exports.ARENA_CYCLE_CAP_PCT = 50;
function toDateValue(value) {
    return new Date(`${value}T00:00:00Z`).getTime();
}
function overlapDays(left, right) {
    const start = Math.max(toDateValue(left.start), toDateValue(right.start));
    const end = Math.min(toDateValue(left.end), toDateValue(right.end));
    if (end < start)
        return 0;
    return Math.floor((end - start) / 86400000) + 1;
}
function buildSyntheticTqqqProxy(points) {
    let syntheticN = null;
    return points.map((point, index) => {
        const prevQqq = index > 0 ? points[index - 1]?.qqq_n : null;
        const currentQqq = point.qqq_n;
        if (typeof currentQqq !== 'number') {
            return null;
        }
        if (syntheticN == null) {
            syntheticN = currentQqq > 0 ? currentQqq : 100;
        }
        else if (typeof prevQqq === 'number' && prevQqq > 0) {
            const qqqReturn = (currentQqq - prevQqq) / prevQqq;
            syntheticN = Math.max(1, syntheticN * (1 + qqqReturn * 3));
        }
        return Number(syntheticN.toFixed(2));
    });
}
function findMatchingSurvivalEvent(standardEvent, survivalArchive) {
    if (!survivalArchive?.events?.length)
        return null;
    const exact = survivalArchive.events.find((event) => event.name === standardEvent.name);
    if (exact)
        return exact;
    const ranked = survivalArchive.events
        .map((event) => ({
        event,
        overlap: overlapDays(standardEvent, event),
    }))
        .filter((item) => item.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap);
    return ranked[0]?.event ?? null;
}
function buildExtendedSurvivalPlayback(targetEvent, allEvents, visibleStart) {
    if (!targetEvent.playback.length || targetEvent.playback[0].d <= visibleStart) {
        return targetEvent.playback;
    }
    const targetFirstDate = targetEvent.playback[0].d;
    const bestCandidate = allEvents
        .filter((event) => event.name !== targetEvent.name)
        .map((event) => {
        const candidatePlayback = event.playback;
        if (!candidatePlayback.length || candidatePlayback[0].d >= targetFirstDate)
            return null;
        const overlapCount = candidatePlayback.filter((point) => targetEvent.playback.some((targetPoint) => targetPoint.d === point.d)).length;
        if (!overlapCount)
            return null;
        const preEventPoints = candidatePlayback.filter((point) => point.d < targetFirstDate);
        if (!preEventPoints.length)
            return null;
        return {
            overlapCount,
            earliestDate: candidatePlayback[0].d,
            preVisibleCount: preEventPoints.filter((point) => point.d < visibleStart).length,
            preEventPoints,
        };
    })
        .filter((candidate) => candidate != null)
        .sort((left, right) => {
        if (right.preVisibleCount !== left.preVisibleCount)
            return right.preVisibleCount - left.preVisibleCount;
        if (right.overlapCount !== left.overlapCount)
            return right.overlapCount - left.overlapCount;
        return left.earliestDate.localeCompare(right.earliestDate);
    })[0];
    if (!bestCandidate?.preVisibleCount) {
        return targetEvent.playback;
    }
    return [...bestCandidate.preEventPoints, ...targetEvent.playback];
}
function normalizeCurve(points) {
    const peakSeed = points[0]?.value ?? 100;
    let peak = peakSeed;
    return points.map((point) => {
        peak = Math.max(peak, point.value);
        const drawdown = peak > 0 ? Number((((point.value - peak) / peak) * 100).toFixed(2)) : 0;
        return {
            date: point.date,
            equity: Number(point.value.toFixed(2)),
            drawdown,
            exposure: Number(point.exposure.toFixed(2)),
        };
    });
}
function computeRecoveryTimeDays(curve) {
    if (!curve.length)
        return null;
    let peak = curve[0].equity;
    let troughIndex = 0;
    let troughDrawdown = 0;
    for (let index = 0; index < curve.length; index += 1) {
        peak = Math.max(peak, curve[index].equity);
        const dd = peak > 0 ? (curve[index].equity - peak) / peak : 0;
        if (dd < troughDrawdown) {
            troughDrawdown = dd;
            troughIndex = index;
        }
    }
    if (troughDrawdown === 0)
        return 0;
    const targetPeak = curve.slice(0, troughIndex + 1).reduce((best, point) => Math.max(best, point.equity), curve[0].equity);
    for (let index = troughIndex + 1; index < curve.length; index += 1) {
        if (curve[index].equity >= targetPeak) {
            return index - troughIndex;
        }
    }
    return null;
}
function computeExposureStability(exposures) {
    if (exposures.length <= 1)
        return 100;
    let totalChange = 0;
    for (let index = 1; index < exposures.length; index += 1) {
        totalChange += Math.abs(exposures[index] - exposures[index - 1]);
    }
    const maxChange = (exposures.length - 1) * 100;
    if (maxChange === 0)
        return 100;
    return Number((100 - (totalChange / maxChange) * 100).toFixed(1));
}
function computeMetric(curve) {
    const first = curve[0]?.equity ?? 100;
    const last = curve[curve.length - 1]?.equity ?? first;
    const maxDrawdown = curve.reduce((best, point) => Math.min(best, point.drawdown), 0);
    return {
        final_return_pct: Number((((last / first) - 1) * 100).toFixed(1)),
        max_drawdown_pct: Number(maxDrawdown.toFixed(1)),
        recovery_time_days: computeRecoveryTimeDays(curve),
        exposure_stability_pct: computeExposureStability(curve.map((point) => point.exposure)),
    };
}
function computeCurveCapitalDiagnostics(curve, options) {
    const exposures = curve.map((point) => point.exposure);
    const maxCapitalUsagePct = exposures.length ? Math.max(...exposures) : exports.ARENA_INITIAL_INVESTED_PCT;
    const minCashPctObserved = exposures.length
        ? Math.min(...exposures.map((exposure) => 100 - exposure))
        : exports.ARENA_CASH_FLOOR_PCT;
    return {
        min_cash_pct_observed: Number(minCashPctObserved.toFixed(2)),
        max_capital_usage_pct: Number(maxCapitalUsagePct.toFixed(2)),
        cycle_cap_hit_count: options?.cycleCapHitCount ?? null,
    };
}
function computeMissedReboundCost(strategyCurve, buyHoldCurve) {
    if (strategyCurve.length < 21 || buyHoldCurve.length < 21)
        return null;
    let bottomIndex = 0;
    for (let index = 1; index < buyHoldCurve.length; index += 1) {
        if (buyHoldCurve[index].equity < buyHoldCurve[bottomIndex].equity) {
            bottomIndex = index;
        }
    }
    const endIndex = Math.min(strategyCurve.length - 1, bottomIndex + 20);
    const buyHoldStart = buyHoldCurve[bottomIndex]?.equity ?? 0;
    const strategyStart = strategyCurve[bottomIndex]?.equity ?? 0;
    if (buyHoldStart <= 0 || strategyStart <= 0)
        return null;
    const buyHoldReturn = (buyHoldCurve[endIndex].equity - buyHoldStart) / buyHoldStart;
    const strategyReturn = (strategyCurve[endIndex].equity - strategyStart) / strategyStart;
    return Number(((buyHoldReturn - strategyReturn) * 100).toFixed(2));
}
function rebaseCurveFromIndex(curve, startIndex, endDate) {
    const visibleCurve = curve
        .slice(startIndex)
        .filter((point) => (endDate ? point.date <= endDate : true));
    const startEquity = visibleCurve[0]?.equity ?? 100;
    if (!visibleCurve.length || startEquity <= 0)
        return [];
    return normalizeCurve(visibleCurve.map((point) => ({
        date: point.date,
        value: (point.equity / startEquity) * 100,
        exposure: point.exposure,
    })));
}
function buildBuyHoldCurve(assetSeries) {
    const first = assetSeries[0]?.asset_n ?? 100;
    return normalizeCurve(assetSeries.map((point) => ({
        date: point.date,
        value: exports.ARENA_CASH_FLOOR_PCT + (point.asset_n / first) * exports.ARENA_INITIAL_INVESTED_PCT,
        exposure: exports.ARENA_INITIAL_INVESTED_PCT,
    })));
}
function buildRollingMean(values, window) {
    let rollingSum = 0;
    return values.map((value, index) => {
        rollingSum += value;
        if (index >= window) {
            rollingSum -= values[index - window];
        }
        if (index < window - 1) {
            return null;
        }
        return Number((rollingSum / window).toFixed(2));
    });
}
function validateAdaptiveTransitionSequence(transitions) {
    const allowedTransitionsByReason = {
        'dd3 shock': [[100, 80]],
        'dd5 shock': [[100, 80]],
        'below MA200': [
            [100, 50],
            [80, 50],
        ],
        'panic drawdown': [
            [100, 25],
            [80, 25],
            [50, 25],
        ],
        'early rebound signal': [
            [25, 50],
            [25, 80],
            [50, 80],
        ],
        'recovery failure': [
            [80, 50],
            [50, 25],
        ],
        'rebound +15%': [[25, 50]],
        'recovered above MA200': [
            [50, 80],
        ],
    };
    for (let index = 0; index < transitions.length; index += 1) {
        const current = transitions[index];
        if (current.from_exposure === current.to_exposure) {
            throw new Error(`Adaptive report contains a no-op transition on ${current.date}: ${current.from_exposure}->${current.to_exposure}`);
        }
        const allowedPairs = allowedTransitionsByReason[current.reason] ?? [];
        const isAllowed = allowedPairs.some(([fromExposure, toExposure]) => fromExposure === current.from_exposure && toExposure === current.to_exposure);
        if (!isAllowed) {
            throw new Error(`Adaptive report contains an invalid transition on ${current.date}: ` +
                `${current.from_exposure}->${current.to_exposure} (${current.reason})`);
        }
        const previous = transitions[index - 1];
        if (!previous)
            continue;
        if (current.date <= previous.date) {
            throw new Error(`Adaptive report is not strictly chronological: ${previous.date} ${previous.from_exposure}->${previous.to_exposure}, ` +
                `${current.date} ${current.from_exposure}->${current.to_exposure}`);
        }
        if (current.from_exposure !== previous.to_exposure) {
            throw new Error(`Adaptive report breaks state continuity: ${previous.date} ended at ${previous.to_exposure}, ` +
                `but ${current.date} starts from ${current.from_exposure}`);
        }
    }
}
function validateAdaptiveVisibleTransitions(fullTransitions, visibleTransitions) {
    let searchIndex = 0;
    for (const visible of visibleTransitions) {
        const matchIndex = fullTransitions.findIndex((transition, index) => {
            if (index < searchIndex)
                return false;
            return (transition.date === visible.date &&
                transition.from_exposure === visible.from_exposure &&
                transition.to_exposure === visible.to_exposure &&
                transition.reason === visible.reason);
        });
        if (matchIndex === -1) {
            throw new Error(`Adaptive visible transition is not a chronological subset of full transitions: ` +
                `${visible.date} ${visible.from_exposure}->${visible.to_exposure}`);
        }
        searchIndex = matchIndex + 1;
    }
}
function validateStrategyTransitionSequence(transitions) {
    for (let index = 0; index < transitions.length; index += 1) {
        const current = transitions[index];
        if (current.from_exposure === current.to_exposure) {
            throw new Error(`Strategy report contains a no-op transition on ${current.date}: ${current.from_exposure}->${current.to_exposure}`);
        }
        const previous = transitions[index - 1];
        if (!previous)
            continue;
        if (current.date <= previous.date) {
            throw new Error(`Strategy report is not strictly chronological: ${previous.date} ${previous.from_exposure}->${previous.to_exposure}, ` +
                `${current.date} ${current.from_exposure}->${current.to_exposure}`);
        }
        if (current.from_exposure !== previous.to_exposure) {
            throw new Error(`Strategy report breaks state continuity: ${previous.date} ended at ${previous.to_exposure}, ` +
                `but ${current.date} starts from ${current.from_exposure}`);
        }
    }
}
function validateStrategyVisibleTransitions(fullTransitions, visibleTransitions) {
    let searchIndex = 0;
    for (const visible of visibleTransitions) {
        const matchIndex = fullTransitions.findIndex((transition, index) => {
            if (index < searchIndex)
                return false;
            return (transition.date === visible.date &&
                transition.from_exposure === visible.from_exposure &&
                transition.to_exposure === visible.to_exposure &&
                transition.reason === visible.reason);
        });
        if (matchIndex === -1) {
            throw new Error(`Strategy visible transition is not a chronological subset of full transitions: ` +
                `${visible.date} ${visible.from_exposure}->${visible.to_exposure}`);
        }
        searchIndex = matchIndex + 1;
    }
}
function describeInitialStrategyState(exposure, hadEarlierTransitions, options) {
    if (exposure === exports.ARENA_MAX_INVESTED_PCT) {
        return hadEarlierTransitions
            ? 'fully re-risked to the 80% Arena cap before visible window'
            : '80% invested with a 20% reserve at visible window start';
    }
    if (options?.ma200Aware && exposure === 50) {
        return 'MA200 defense already active before visible window';
    }
    if (options?.lowBased && exposure <= 40) {
        return 'low-based defensive posture already active before visible window';
    }
    if (exposure === 80) {
        return 'shock defense already active before visible window';
    }
    if (exposure === 50) {
        return 'trend-breakdown defense already active before visible window';
    }
    return `${exposure}% partial recovery posture already active before visible window`;
}
function buildStrategyReport(curve, transitions, visibleStartDate, visibleStartIndex, options) {
    validateStrategyTransitionSequence(transitions);
    const visibleTransitions = transitions.filter((transition) => transition.date >= visibleStartDate);
    validateStrategyVisibleTransitions(transitions, visibleTransitions);
    const initialVisiblePoint = curve[visibleStartIndex] ?? curve[0];
    const hadEarlierTransitions = transitions.some((transition) => transition.date < visibleStartDate);
    return {
        initial_state: {
            exposure: initialVisiblePoint?.exposure ?? exports.ARENA_INITIAL_INVESTED_PCT,
            reason: options?.initialReason ??
                describeInitialStrategyState(initialVisiblePoint?.exposure ?? exports.ARENA_INITIAL_INVESTED_PCT, hadEarlierTransitions, options),
        },
        full_transitions: transitions,
        visible_transitions: visibleTransitions,
    };
}
const WARNING_STATE_SEVERITY = {
    NORMAL: 0,
    WATCH: 1,
    ALERT: 2,
    DEFENSE_READY: 3,
    DEFENSE_ACTIVE: 4,
    RECOVERY_MODE: 3,
};
function classifyScenarioCase(assetSeries, eventStartDate, eventEndDate) {
    const eventSeries = assetSeries.filter((point) => point.date >= eventStartDate && point.date <= eventEndDate);
    if (eventSeries.length < 2)
        return 'Mixed';
    const duration = eventSeries.length;
    const bottomIndex = eventSeries.reduce((best, point, index, array) => (point.asset_n < array[best].asset_n ? index : best), 0);
    const peakBeforeBottom = eventSeries
        .slice(0, bottomIndex + 1)
        .reduce((best, point) => Math.max(best, point.asset_n), eventSeries[0].asset_n);
    const recoveryIndex = eventSeries.findIndex((point, index) => index > bottomIndex && point.asset_n >= peakBeforeBottom * 0.95);
    const reboundBars = recoveryIndex >= 0
        ? recoveryIndex - bottomIndex
        : Number.POSITIVE_INFINITY;
    if (duration <= 60 && reboundBars <= 20) {
        return 'V';
    }
    if (duration > 120) {
        return 'Bear';
    }
    if (duration <= 120) {
        return 'Correction';
    }
    return 'Mixed';
}
function buildWarningLayerView(assetSeries, visibleStartDate, visibleEndDate, eventStartDate, eventEndDate) {
    if (assetSeries.length < 2)
        return null;
    let recentPeak = assetSeries[0].asset_n;
    let cycleActive = false;
    let cyclePeak = null;
    let trackedLow = null;
    let consecutiveWarningDays = 0;
    let currentState = 'NORMAL';
    let currentReason = 'No unusual downside speed is currently detected.';
    let peakState = 'NORMAL';
    const transitions = [];
    const visibleSnapshots = [];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const current = assetSeries[index];
        if (!cycleActive) {
            recentPeak = Math.max(recentPeak, current.asset_n);
        }
        const dd3 = index >= 3 && assetSeries[index - 3].asset_n > 0
            ? current.asset_n / assetSeries[index - 3].asset_n - 1
            : null;
        const dd5 = index >= 5 && assetSeries[index - 5].asset_n > 0
            ? current.asset_n / assetSeries[index - 5].asset_n - 1
            : null;
        const dd6 = index >= 6 && assetSeries[index - 6].asset_n > 0
            ? current.asset_n / assetSeries[index - 6].asset_n - 1
            : null;
        const peakDD = recentPeak > 0 ? current.asset_n / recentPeak - 1 : null;
        const distanceToMa = typeof current.tqqq_ma200_n === 'number' && current.tqqq_ma200_n > 0
            ? current.asset_n / current.tqqq_ma200_n - 1
            : null;
        const warningHitCount = [
            dd3 != null && dd3 <= -0.1,
            dd5 != null && dd5 <= -0.15,
            dd6 != null && dd6 <= -0.17,
        ].filter(Boolean).length;
        const hasWarning = warningHitCount > 0;
        const belowMa = typeof current.tqqq_ma200_n === 'number' && current.asset_n < current.tqqq_ma200_n;
        consecutiveWarningDays = hasWarning ? consecutiveWarningDays + 1 : 0;
        if (!cycleActive && peakDD != null && peakDD <= -0.25) {
            cycleActive = true;
            cyclePeak = recentPeak;
            trackedLow = current.asset_n;
        }
        if (cycleActive) {
            trackedLow = trackedLow == null ? current.asset_n : Math.min(trackedLow, current.asset_n);
        }
        const reboundFromLow = trackedLow != null && trackedLow > 0
            ? current.asset_n / trackedLow - 1
            : null;
        let nextState = 'NORMAL';
        let nextReason = 'No unusual downside speed is currently detected.';
        if (cycleActive) {
            if (reboundFromLow != null && reboundFromLow >= 0.1) {
                nextState = 'RECOVERY_MODE';
                nextReason =
                    'Crash cycle is still active, but rebound from the tracked low is now underway.';
            }
            else {
                nextState = 'DEFENSE_ACTIVE';
                nextReason =
                    'Crash-cycle conditions are active. Execution engines may respond, but this warning layer does not trade.';
            }
        }
        else if (peakDD != null &&
            peakDD <= -0.22 &&
            (warningHitCount >= 2 || (belowMa && distanceToMa != null && distanceToMa <= -0.06))) {
            nextState = 'DEFENSE_READY';
            nextReason =
                'Downside speed and broader damage now resemble prior crash-onset conditions.';
        }
        else if (warningHitCount >= 2 ||
            consecutiveWarningDays >= 2 ||
            (peakDD != null &&
                peakDD <= -0.18 &&
                (belowMa || (distanceToMa != null && distanceToMa <= -0.04)))) {
            nextState = 'ALERT';
            nextReason =
                'Short-term downside behavior now resembles prior shock and correction cases.';
        }
        else if (hasWarning) {
            nextState = 'WATCH';
            nextReason =
                'Abnormal downside speed detected. Monitoring has intensified.';
        }
        if (nextState !== currentState) {
            transitions.push({
                date: current.date,
                from_state: currentState,
                to_state: nextState,
                reason: nextReason,
            });
        }
        currentState = nextState;
        currentReason = nextReason;
        if (WARNING_STATE_SEVERITY[currentState] > WARNING_STATE_SEVERITY[peakState]) {
            peakState = currentState;
        }
        if (current.date >= visibleStartDate && current.date <= visibleEndDate) {
            visibleSnapshots.push({
                date: current.date,
                state: currentState,
                reason: currentReason,
                dd3: dd3 != null ? Number((dd3 * 100).toFixed(2)) : null,
                dd5: dd5 != null ? Number((dd5 * 100).toFixed(2)) : null,
                dd6: dd6 != null ? Number((dd6 * 100).toFixed(2)) : null,
                peakDD: peakDD != null ? Number((peakDD * 100).toFixed(2)) : null,
                distance_to_ma200_pct: distanceToMa != null ? Number((distanceToMa * 100).toFixed(2)) : null,
                vr_band_level: Number.isFinite(current.level) ? current.level : null,
            });
        }
        if (cycleActive && cyclePeak != null && current.asset_n >= cyclePeak * 0.95) {
            cycleActive = false;
            cyclePeak = null;
            trackedLow = null;
            recentPeak = current.asset_n;
        }
    }
    const latestVisibleSnapshot = visibleSnapshots[visibleSnapshots.length - 1] ??
        {
            date: assetSeries[assetSeries.length - 1].date,
            state: currentState,
            reason: currentReason,
            dd3: null,
            dd5: null,
            dd6: null,
            peakDD: null,
            distance_to_ma200_pct: null,
            vr_band_level: Number.isFinite(assetSeries[assetSeries.length - 1].level)
                ? assetSeries[assetSeries.length - 1].level
                : null,
        };
    return {
        warning_state: latestVisibleSnapshot.state,
        peak_warning_state: peakState,
        warning_reason: latestVisibleSnapshot.reason,
        trigger_metrics: {
            dd3: latestVisibleSnapshot.dd3,
            dd5: latestVisibleSnapshot.dd5,
            dd6: latestVisibleSnapshot.dd6,
            peakDD: latestVisibleSnapshot.peakDD,
            distance_to_ma200_pct: latestVisibleSnapshot.distance_to_ma200_pct,
            vr_band_level: latestVisibleSnapshot.vr_band_level,
        },
        scenario_hint: classifyScenarioCase(assetSeries, eventStartDate, eventEndDate),
        full_transitions: transitions,
        visible_transitions: transitions.filter((transition) => transition.date >= visibleStartDate && transition.date <= visibleEndDate),
    };
}
function median(values) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
    }
    return sorted[midpoint];
}
function buildExtendedRealTqqqHistory(targetEvent, allEvents, visibleStart) {
    const targetReal = targetEvent.playback
        .filter((point) => typeof point.tqqq_n === 'number')
        .map((point) => ({ date: point.d, tqqq_n: point.tqqq_n }));
    if (!targetReal.length)
        return [];
    const firstVisibleRealIndex = targetReal.findIndex((point) => point.date >= visibleStart);
    if (firstVisibleRealIndex >= 199) {
        return targetReal;
    }
    const targetByDate = new Map(targetReal.map((point) => [point.date, point.tqqq_n]));
    const targetFirstDate = targetReal[0].date;
    const bestCandidate = allEvents
        .filter((event) => event.name !== targetEvent.name)
        .map((event) => {
        const candidateReal = event.playback
            .filter((point) => typeof point.tqqq_n === 'number')
            .map((point) => ({ date: point.d, tqqq_n: point.tqqq_n }));
        if (!candidateReal.length || candidateReal[0].date >= targetFirstDate)
            return null;
        const overlapRatios = candidateReal
            .filter((point) => targetByDate.has(point.date) && point.tqqq_n > 0)
            .map((point) => targetByDate.get(point.date) / point.tqqq_n);
        const scale = median(overlapRatios);
        if (scale == null)
            return null;
        const preEventPoints = candidateReal
            .filter((point) => point.date < targetFirstDate)
            .map((point) => ({
            date: point.date,
            tqqq_n: Number((point.tqqq_n * scale).toFixed(2)),
        }));
        return {
            overlapCount: overlapRatios.length,
            earliestDate: candidateReal[0].date,
            preVisibleCount: preEventPoints.filter((point) => point.date < visibleStart).length + firstVisibleRealIndex,
            preEventPoints,
        };
    })
        .filter((candidate) => candidate != null && candidate.overlapCount > 0 && candidate.preEventPoints.length > 0)
        .sort((left, right) => {
        const leftWarmupReady = left.preVisibleCount >= 199 ? 1 : 0;
        const rightWarmupReady = right.preVisibleCount >= 199 ? 1 : 0;
        if (rightWarmupReady !== leftWarmupReady)
            return rightWarmupReady - leftWarmupReady;
        if (right.preVisibleCount !== left.preVisibleCount)
            return right.preVisibleCount - left.preVisibleCount;
        if (right.overlapCount !== left.overlapCount)
            return right.overlapCount - left.overlapCount;
        return left.earliestDate.localeCompare(right.earliestDate);
    })[0];
    if (!bestCandidate) {
        return targetReal;
    }
    return [...bestCandidate.preEventPoints, ...targetReal];
}
function getMA200SignalState(point) {
    if (typeof point.tqqq_signal_n !== 'number' || typeof point.tqqq_ma200_n !== 'number')
        return null;
    return point.tqqq_signal_n >= point.tqqq_ma200_n ? 'above' : 'below';
}
function isAdaptiveAboveMa(point, multiplier) {
    return typeof point.tqqq_ma200_n === 'number' && point.asset_n >= point.tqqq_ma200_n * multiplier;
}
function buildMA200Curve(assetSeries, belowExposure, config, reportContext) {
    let equity = 100;
    let previousState = assetSeries[0] ? getMA200SignalState(assetSeries[0]) : null;
    let exposure = previousState === 'below' ? belowExposure : exports.ARENA_MAX_INVESTED_PCT;
    let ma200Defensive = exposure < exports.ARENA_MAX_INVESTED_PCT;
    let trackedLow = ma200Defensive ? assetSeries[0]?.asset_n ?? null : null;
    let earlyRebuyDone = false;
    const transitions = [];
    const points = [
        { date: assetSeries[0]?.date ?? '', value: equity, exposure },
    ];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const prev = assetSeries[index - 1];
        const current = assetSeries[index];
        const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0;
        equity *= 1 + assetReturn * (exposure / 100);
        const currentState = getMA200SignalState(current);
        let transitionReason = null;
        if (previousState === 'above' && currentState === 'below') {
            exposure = belowExposure;
            ma200Defensive = true;
            trackedLow = current.asset_n;
            earlyRebuyDone = false;
            transitionReason = 'below MA200';
        }
        else if (previousState === 'below' && currentState === 'above') {
            exposure = exports.ARENA_MAX_INVESTED_PCT;
            ma200Defensive = false;
            trackedLow = null;
            earlyRebuyDone = false;
            transitionReason = 'recovered above MA200';
        }
        else if (previousState == null && currentState != null) {
            exposure = currentState === 'above' ? exports.ARENA_MAX_INVESTED_PCT : belowExposure;
            ma200Defensive = currentState === 'below';
            trackedLow = ma200Defensive ? current.asset_n : null;
            earlyRebuyDone = false;
        }
        else if (config?.earlyRebuyReboundThreshold != null &&
            typeof config.earlyRebuyExposure === 'number' &&
            ma200Defensive &&
            currentState === 'below') {
            trackedLow = trackedLow == null ? current.asset_n : Math.min(trackedLow, current.asset_n);
            const reboundFromLow = trackedLow > 0
                ? current.asset_n / trackedLow - 1
                : null;
            if (!earlyRebuyDone &&
                exposure === belowExposure &&
                reboundFromLow != null &&
                reboundFromLow >= config.earlyRebuyReboundThreshold) {
                exposure = config.earlyRebuyExposure;
                earlyRebuyDone = true;
                transitionReason = `rebound +${Math.round(config.earlyRebuyReboundThreshold * 100)}%`;
            }
        }
        if (currentState != null) {
            previousState = currentState;
        }
        if (reportContext && transitionReason != null) {
            const previousExposure = points[points.length - 1]?.exposure ?? exports.ARENA_INITIAL_INVESTED_PCT;
            if (exposure !== previousExposure) {
                transitions.push({
                    date: current.date,
                    from_exposure: previousExposure,
                    to_exposure: exposure,
                    reason: transitionReason,
                });
            }
        }
        points.push({ date: current.date, value: equity, exposure });
    }
    const curve = normalizeCurve(points);
    return {
        curve,
        report: reportContext ? buildStrategyReport(curve, transitions, reportContext.visibleStartDate, reportContext.visibleStartIndex, { ma200Aware: true }) : undefined,
    };
}
function buildLowBasedRecoveryCurve(assetSeries, config, reportContext) {
    if (assetSeries.length < 2)
        return null;
    let equity = 100;
    let exposure = exports.ARENA_INITIAL_INVESTED_PCT;
    let recentPeak = assetSeries[0]?.asset_n ?? 100;
    let cycleActive = false;
    let cyclePeak = null;
    let trackedLow = null;
    let capitalUsed = 0;
    let cycleCapHitCount = 0;
    let step1Done = false;
    let step2Done = false;
    let step3Done = false;
    const transitions = [];
    const points = [
        { date: assetSeries[0]?.date ?? '', value: equity, exposure },
    ];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const prev = assetSeries[index - 1];
        const current = assetSeries[index];
        const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0;
        equity *= 1 + assetReturn * (exposure / 100);
        if (!cycleActive && exposure === exports.ARENA_MAX_INVESTED_PCT) {
            recentPeak = Math.max(recentPeak, current.asset_n);
        }
        const dd3 = index >= 3 && assetSeries[index - 3].asset_n > 0
            ? current.asset_n / assetSeries[index - 3].asset_n - 1
            : null;
        const dd5 = index >= 5 && assetSeries[index - 5].asset_n > 0
            ? current.asset_n / assetSeries[index - 5].asset_n - 1
            : null;
        const peakDD = recentPeak > 0 ? current.asset_n / recentPeak - 1 : null;
        const hasMa = typeof current.tqqq_ma200_n === 'number';
        const isBelowMa = hasMa ? current.asset_n < current.tqqq_ma200_n : false;
        if (!cycleActive && peakDD != null && peakDD <= -0.25) {
            cycleActive = true;
            cyclePeak = recentPeak;
            trackedLow = current.asset_n;
            capitalUsed = 0;
            step1Done = false;
            step2Done = false;
            step3Done = false;
        }
        if (cycleActive) {
            trackedLow = trackedLow == null ? current.asset_n : Math.min(trackedLow, current.asset_n);
        }
        const reboundFromLow = trackedLow != null && trackedLow > 0
            ? current.asset_n / trackedLow - 1
            : null;
        const shockTriggered = (dd3 != null && dd3 <= -0.1) || (dd5 != null && dd5 <= -0.15);
        const panicTriggered = (peakDD != null && peakDD <= -0.25) || (dd5 != null && dd5 <= -0.2);
        let nextExposure = exposure;
        let transitionReason = null;
        if (panicTriggered && exposure > 40) {
            nextExposure = 40;
            transitionReason = 'panic drawdown';
        }
        else if (isBelowMa && exposure > 50) {
            nextExposure = 50;
            transitionReason = 'below MA200';
        }
        else if (shockTriggered && exposure === exports.ARENA_MAX_INVESTED_PCT) {
            nextExposure = 80;
            transitionReason = dd3 != null && dd3 <= -0.1 ? 'dd3 shock' : 'dd5 shock';
        }
        const applyStep = (requestedAdd, reason) => {
            const remainingCycleCapital = Math.max(0, exports.ARENA_CYCLE_CAP_PCT - capitalUsed);
            const remainingExposureRoom = Math.max(0, exports.ARENA_MAX_INVESTED_PCT - nextExposure);
            const actualAdd = Math.min(requestedAdd, remainingCycleCapital, remainingExposureRoom);
            if (actualAdd > 0) {
                nextExposure += actualAdd;
                capitalUsed += actualAdd;
                transitionReason = reason;
            }
            else if (requestedAdd > 0 && cycleActive) {
                cycleCapHitCount += 1;
            }
        };
        if (cycleActive && reboundFromLow != null) {
            if (!step1Done && reboundFromLow >= config.step1Threshold) {
                step1Done = true;
                applyStep(25, `rebound +${Math.round(config.step1Threshold * 100)}%`);
            }
            if (!step2Done && reboundFromLow >= config.step2Threshold) {
                step2Done = true;
                applyStep(25, `rebound +${Math.round(config.step2Threshold * 100)}%`);
            }
            if (!step3Done && (reboundFromLow >= config.step3Threshold || (hasMa && current.asset_n >= current.tqqq_ma200_n))) {
                step3Done = true;
                applyStep(30, hasMa && current.asset_n >= current.tqqq_ma200_n ? 'recovered above MA200' : `rebound +${Math.round(config.step3Threshold * 100)}%`);
            }
        }
        if (cycleActive && cyclePeak != null && current.asset_n >= cyclePeak * 0.95) {
            cycleActive = false;
            cyclePeak = null;
            trackedLow = null;
            capitalUsed = 0;
            step1Done = false;
            step2Done = false;
            step3Done = false;
            if (nextExposure === exports.ARENA_MAX_INVESTED_PCT) {
                recentPeak = current.asset_n;
            }
        }
        if (reportContext && nextExposure !== exposure && transitionReason != null) {
            transitions.push({
                date: current.date,
                from_exposure: exposure,
                to_exposure: nextExposure,
                reason: transitionReason,
            });
        }
        exposure = nextExposure;
        points.push({ date: current.date, value: equity, exposure });
    }
    const curve = normalizeCurve(points);
    return {
        curve,
        cycleCapHitCount,
        report: reportContext ? buildStrategyReport(curve, transitions, reportContext.visibleStartDate, reportContext.visibleStartIndex, { lowBased: true }) : undefined,
    };
}
function buildMA200LB30HybridCurve(assetSeries, reportContext) {
    if (assetSeries.length < 2)
        return null;
    let equity = 100;
    let exposure = getMA200SignalState(assetSeries[0]) === 'below' ? 50 : exports.ARENA_MAX_INVESTED_PCT;
    let recentPeak = assetSeries[0]?.asset_n ?? 100;
    let cycleActive = false;
    let cyclePeak = null;
    let trackedLow = null;
    let capitalUsed = 0;
    let cycleCapHitCount = 0;
    let step1Done = false;
    let step2Done = false;
    let step3Done = false;
    const transitions = [];
    const points = [
        { date: assetSeries[0]?.date ?? '', value: equity, exposure },
    ];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const prev = assetSeries[index - 1];
        const current = assetSeries[index];
        const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0;
        equity *= 1 + assetReturn * (exposure / 100);
        if (!cycleActive && exposure === exports.ARENA_MAX_INVESTED_PCT) {
            recentPeak = Math.max(recentPeak, current.asset_n);
        }
        const dd3 = index >= 3 && assetSeries[index - 3].asset_n > 0
            ? current.asset_n / assetSeries[index - 3].asset_n - 1
            : null;
        const dd5 = index >= 5 && assetSeries[index - 5].asset_n > 0
            ? current.asset_n / assetSeries[index - 5].asset_n - 1
            : null;
        const peakDD = recentPeak > 0 ? current.asset_n / recentPeak - 1 : null;
        const currentState = getMA200SignalState(current);
        if (!cycleActive && peakDD != null && peakDD <= -0.25) {
            cycleActive = true;
            cyclePeak = recentPeak;
            trackedLow = current.asset_n;
            capitalUsed = 0;
            step1Done = false;
            step2Done = false;
            step3Done = false;
        }
        if (cycleActive) {
            trackedLow = trackedLow == null ? current.asset_n : Math.min(trackedLow, current.asset_n);
        }
        const reboundFromLow = trackedLow != null && trackedLow > 0
            ? current.asset_n / trackedLow - 1
            : null;
        let nextExposure = exposure;
        let transitionReason = null;
        if (currentState === 'below' && exposure > 50) {
            nextExposure = 50;
            transitionReason = 'below MA200';
        }
        const applyStep = (requestedAdd, reason) => {
            const remainingCycleCapital = Math.max(0, exports.ARENA_CYCLE_CAP_PCT - capitalUsed);
            const remainingExposureRoom = Math.max(0, exports.ARENA_MAX_INVESTED_PCT - nextExposure);
            const actualAdd = Math.min(requestedAdd, remainingCycleCapital, remainingExposureRoom);
            if (actualAdd > 0) {
                nextExposure += actualAdd;
                capitalUsed += actualAdd;
                transitionReason = reason;
            }
            else if (requestedAdd > 0 && cycleActive) {
                cycleCapHitCount += 1;
            }
        };
        if (cycleActive && reboundFromLow != null) {
            if (!step1Done && reboundFromLow >= 0.3) {
                step1Done = true;
                applyStep(25, 'rebound +30%');
            }
            if (!step2Done && reboundFromLow >= 0.4) {
                step2Done = true;
                applyStep(25, 'rebound +40%');
            }
            if (!step3Done && (reboundFromLow >= 0.5 || currentState === 'above')) {
                step3Done = true;
                applyStep(30, currentState === 'above' ? 'recovered above MA200' : 'rebound +50%');
            }
        }
        if (cycleActive && cyclePeak != null && current.asset_n >= cyclePeak * 0.95) {
            cycleActive = false;
            cyclePeak = null;
            trackedLow = null;
            capitalUsed = 0;
            step1Done = false;
            step2Done = false;
            step3Done = false;
        }
        if (reportContext && nextExposure !== exposure && transitionReason != null) {
            transitions.push({
                date: current.date,
                from_exposure: exposure,
                to_exposure: nextExposure,
                reason: transitionReason,
            });
        }
        exposure = nextExposure;
        points.push({ date: current.date, value: equity, exposure });
    }
    const curve = normalizeCurve(points);
    return {
        curve,
        cycleCapHitCount,
        report: reportContext
            ? buildStrategyReport(curve, transitions, reportContext.visibleStartDate, reportContext.visibleStartIndex, {
                ma200Aware: true,
                lowBased: true,
            })
            : undefined,
    };
}
function buildFixedStopCurve(assetSeries) {
    let equity = 100;
    let exposure = exports.ARENA_INITIAL_INVESTED_PCT;
    let inPosition = exposure > 0;
    let peakSinceEntry = assetSeries[0]?.asset_n ?? 100;
    const points = [
        { date: assetSeries[0]?.date ?? '', value: equity, exposure },
    ];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const prev = assetSeries[index - 1];
        const current = assetSeries[index];
        const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0;
        equity *= 1 + assetReturn * (exposure / 100);
        if (inPosition) {
            peakSinceEntry = Math.max(peakSinceEntry, current.asset_n);
            const drawdownFromPeak = peakSinceEntry > 0 ? (current.asset_n - peakSinceEntry) / peakSinceEntry : 0;
            if (drawdownFromPeak <= -0.12) {
                inPosition = false;
                exposure = 0;
            }
        }
        else {
            const prevQqq = index > 0 ? assetSeries[index - 1]?.qqq_n : current.qqq_n;
            const canReEnter = current.qqq_n > (current.ma50_n ?? Number.POSITIVE_INFINITY * -1) &&
                current.qqq_n >= prevQqq;
            if (canReEnter) {
                inPosition = true;
                exposure = exports.ARENA_MAX_INVESTED_PCT;
                peakSinceEntry = current.asset_n;
            }
        }
        points.push({ date: current.date, value: equity, exposure });
    }
    return normalizeCurve(points);
}
// Adaptive Exposure: Arena-local crash evidence state machine with staged re-entry
// De-risk by shock, trend breakdown, and panic evidence; re-enter by early partial rebound and MA200 confirmation.
function buildAdaptiveExposureCurveCore(assetSeries, config, reportContext) {
    if (assetSeries.length < 2)
        return null;
    let equity = 100;
    let exposure = exports.ARENA_INITIAL_INVESTED_PCT;
    let recentPeak = assetSeries[0]?.asset_n ?? 100;
    let trackedLow = null;
    let consecutiveUpDays = 0;
    const transitions = [];
    const points = [
        { date: assetSeries[0]?.date ?? '', value: equity, exposure },
    ];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const prev = assetSeries[index - 1];
        const current = assetSeries[index];
        const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0;
        equity *= 1 + assetReturn * (exposure / 100);
        consecutiveUpDays = current.asset_n > prev.asset_n ? consecutiveUpDays + 1 : 0;
        if (exposure === exports.ARENA_MAX_INVESTED_PCT) {
            recentPeak = Math.max(recentPeak, current.asset_n);
        }
        if (exposure === 25) {
            trackedLow = trackedLow == null ? current.asset_n : Math.min(trackedLow, current.asset_n);
        }
        const dd3 = index >= 3 && assetSeries[index - 3].asset_n > 0
            ? current.asset_n / assetSeries[index - 3].asset_n - 1
            : null;
        const dd5 = index >= 5 && assetSeries[index - 5].asset_n > 0
            ? current.asset_n / assetSeries[index - 5].asset_n - 1
            : null;
        const peakDD = recentPeak > 0 ? current.asset_n / recentPeak - 1 : null;
        const reboundFromLow = trackedLow != null && trackedLow > 0
            ? current.asset_n / trackedLow - 1
            : null;
        const hasMa = typeof current.tqqq_ma200_n === 'number';
        const isBelowMa = hasMa ? current.asset_n < current.tqqq_ma200_n : false;
        const shockTriggered = (dd3 != null && dd3 <= -0.1) || (dd5 != null && dd5 <= -0.15);
        const panicTriggered = (peakDD != null && peakDD <= -0.25) || (dd5 != null && dd5 <= -0.2);
        const isDefensive = exposure < exports.ARENA_MAX_INVESTED_PCT;
        let nextExposure = exposure;
        let transitionReason = null;
        if (exposure > 25 && panicTriggered) {
            nextExposure = 25;
            transitionReason = 'panic drawdown';
        }
        else if (exposure > 50 && isBelowMa) {
            nextExposure = 50;
            transitionReason = 'below MA200';
        }
        else if (exposure === exports.ARENA_MAX_INVESTED_PCT && shockTriggered) {
            nextExposure = 80;
            transitionReason = dd3 != null && dd3 <= -0.1 ? 'dd3 shock' : 'dd5 shock';
        }
        if (config.enableEarlyReentry &&
            isDefensive &&
            nextExposure === exposure) {
            const earlySignal = (reboundFromLow != null && reboundFromLow >= (config.earlyReentryScaleTo50Rebound ?? 0.03)) ||
                (dd3 != null && dd3 > 0) ||
                consecutiveUpDays >= (config.earlyReentryConsecutiveUpDays ?? 3);
            if (earlySignal) {
                const stagedEarlyExposure = reboundFromLow != null && reboundFromLow >= (config.earlyReentryScaleTo80Rebound ?? 0.1)
                    ? 80
                    : 50;
                if (stagedEarlyExposure > nextExposure) {
                    nextExposure = stagedEarlyExposure;
                    transitionReason = reportContext ? 'early rebound signal' : null;
                }
            }
        }
        if (config.enableEarlyReentry &&
            isDefensive &&
            nextExposure === exposure &&
            reboundFromLow != null &&
            reboundFromLow < (config.failedRecoveryReboundFloor ?? 0.02) &&
            dd3 != null &&
            dd3 < (config.failedRecoveryDd3Floor ?? -0.03)) {
            const reducedExposure = exposure >= 80
                ? 50
                : exposure >= 50
                    ? 25
                    : exposure;
            if (reducedExposure < nextExposure) {
                nextExposure = reducedExposure;
                transitionReason = reportContext ? 'recovery failure' : null;
            }
        }
        if (exposure === 25 && nextExposure === 25 && reboundFromLow != null && reboundFromLow >= config.reboundTo50Threshold) {
            nextExposure = 50;
            if (reportContext) {
                transitionReason =
                    config.reboundTo50Threshold <= 0.1 ? 'rebound +10%' : 'rebound +15%';
            }
        }
        else if (exposure === 50 &&
            nextExposure === 50 &&
            typeof config.intermediateReentryMaMultiplier === 'number' &&
            isAdaptiveAboveMa(current, config.intermediateReentryMaMultiplier)) {
            nextExposure = 80;
        }
        else if (((exposure === 50 && nextExposure === 50) || (exposure === 80 && nextExposure === 80)) &&
            isAdaptiveAboveMa(current, config.fullRiskMaMultiplier)) {
            nextExposure = exports.ARENA_MAX_INVESTED_PCT;
            if (reportContext) {
                transitionReason =
                    config.fullRiskMaMultiplier < 1 ? 'recovered near MA200' : 'recovered above MA200';
            }
        }
        if (nextExposure === 25) {
            trackedLow = trackedLow == null ? current.asset_n : Math.min(trackedLow, current.asset_n);
        }
        else if (exposure === 25 && nextExposure > 25) {
            trackedLow = null;
        }
        if (nextExposure === exports.ARENA_MAX_INVESTED_PCT && exposure < exports.ARENA_MAX_INVESTED_PCT) {
            recentPeak = current.asset_n;
        }
        if (reportContext && nextExposure !== exposure && transitionReason != null) {
            transitions.push({
                date: current.date,
                from_exposure: exposure,
                to_exposure: nextExposure,
                reason: transitionReason,
                asset_n: Number(current.asset_n.toFixed(2)),
                tqqq_ma200_n: typeof current.tqqq_ma200_n === 'number' ? Number(current.tqqq_ma200_n.toFixed(2)) : null,
                dd3: dd3 != null ? Number((dd3 * 100).toFixed(2)) : null,
                dd5: dd5 != null ? Number((dd5 * 100).toFixed(2)) : null,
                peak_dd: peakDD != null ? Number((peakDD * 100).toFixed(2)) : null,
                rebound_from_low: reboundFromLow != null ? Number((reboundFromLow * 100).toFixed(2)) : null,
            });
        }
        exposure = nextExposure;
        points.push({ date: current.date, value: equity, exposure });
    }
    const curve = normalizeCurve(points);
    if (!reportContext) {
        return { curve };
    }
    validateAdaptiveTransitionSequence(transitions);
    const visibleTransitions = transitions.filter((transition) => transition.date >= reportContext.visibleStartDate);
    validateAdaptiveVisibleTransitions(transitions, visibleTransitions);
    const initialVisiblePoint = curve[reportContext.visibleStartIndex] ?? curve[0];
    const hadEarlierTransitions = transitions.some((transition) => transition.date < reportContext.visibleStartDate);
    const initialStateReason = initialVisiblePoint.exposure === exports.ARENA_MAX_INVESTED_PCT
        ? hadEarlierTransitions
            ? 'fully re-risked to the 80% Arena cap before visible window'
            : '80% invested with a 20% reserve at visible window start'
        : initialVisiblePoint.exposure === 50
            ? 'trend-breakdown defense already active before visible window'
            : 'panic defense already active before visible window';
    return {
        curve,
        report: {
            event: reportContext.eventLabel,
            initial_state: {
                exposure: initialVisiblePoint.exposure,
                reason: initialStateReason,
            },
            full_transitions: transitions,
            visible_transitions: visibleTransitions,
        },
    };
}
function buildAdaptiveExposureCurve(assetSeries, eventLabel, visibleStartDate, visibleStartIndex) {
    return buildAdaptiveExposureCurveCore(assetSeries, {
        reboundTo50Threshold: 0.15,
        fullRiskMaMultiplier: 1,
        enableEarlyReentry: true,
        earlyReentryConsecutiveUpDays: 3,
        earlyReentryScaleTo50Rebound: 0.03,
        earlyReentryScaleTo80Rebound: 0.1,
        failedRecoveryReboundFloor: 0.02,
        failedRecoveryDd3Floor: -0.03,
    }, {
        eventLabel,
        visibleStartDate,
        visibleStartIndex,
    });
}
function buildAdaptiveFastReentryCurve(assetSeries) {
    return buildAdaptiveExposureCurveCore(assetSeries, {
        reboundTo50Threshold: 0.1,
        fullRiskMaMultiplier: 1,
    });
}
function buildAdaptiveRelaxedReentryCurve(assetSeries) {
    return buildAdaptiveExposureCurveCore(assetSeries, {
        reboundTo50Threshold: 0.15,
        fullRiskMaMultiplier: 0.98,
    });
}
function buildAdaptiveStepReentryCurve(assetSeries) {
    return buildAdaptiveExposureCurveCore(assetSeries, {
        reboundTo50Threshold: 0.1,
        intermediateReentryMaMultiplier: 0.98,
        fullRiskMaMultiplier: 1,
    });
}
// Original VR (Scaled): pre-computed vr_10k from survival archive, scaled to TQQQ magnitude
// Formula: TQQQ_BH[t] × (vr_10k[t] / bh_10k[t])
// This preserves the VR engine's QQQ-space alpha while placing the curve on the same
// TQQQ scale as all other Backtest curves — making divergence from Adaptive Exposure visible.
function buildOriginalVRCurve(survivalPlayback, assetSeries, reportContext) {
    if (!survivalPlayback?.length || assetSeries.length < 2)
        return null;
    const vrByDate = new Map(survivalPlayback.map((point) => [point.d, point]));
    const firstArchivePoint = assetSeries.find((point) => vrByDate.has(point.date));
    const initialExposure = Math.min(exports.ARENA_MAX_INVESTED_PCT, Math.max(0, vrByDate.get(firstArchivePoint?.date ?? '')?.exposure_pct ?? 100));
    let equity = 100;
    let exposure = initialExposure;
    let recentPeak = assetSeries[0]?.asset_n ?? 100;
    let cycleActive = false;
    let cyclePeak = null;
    let capitalUsed = 0;
    let cycleCapHitCount = 0;
    const transitions = [];
    const points = [
        { date: assetSeries[0]?.date ?? '', value: equity, exposure },
    ];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const prev = assetSeries[index - 1];
        const current = assetSeries[index];
        const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0;
        equity *= 1 + assetReturn * (exposure / 100);
        if (!cycleActive) {
            recentPeak = Math.max(recentPeak, current.asset_n);
        }
        const peakDD = recentPeak > 0 ? current.asset_n / recentPeak - 1 : null;
        if (!cycleActive && peakDD != null && peakDD <= -0.25) {
            cycleActive = true;
            cyclePeak = recentPeak;
            capitalUsed = 0;
        }
        const desiredExposure = Math.min(exports.ARENA_MAX_INVESTED_PCT, Math.max(0, vrByDate.get(current.date)?.exposure_pct ?? exposure));
        let nextExposure = exposure;
        let transitionReason = null;
        if (desiredExposure < nextExposure) {
            nextExposure = desiredExposure;
            transitionReason = 'VR defense reduction';
        }
        else if (desiredExposure > nextExposure) {
            const remainingExposureRoom = Math.max(0, exports.ARENA_MAX_INVESTED_PCT - nextExposure);
            const remainingCycleCapital = cycleActive ? Math.max(0, exports.ARENA_CYCLE_CAP_PCT - capitalUsed) : remainingExposureRoom;
            const actualAdd = Math.min(desiredExposure - nextExposure, remainingExposureRoom, remainingCycleCapital);
            if (actualAdd > 0) {
                nextExposure += actualAdd;
                if (cycleActive) {
                    capitalUsed += actualAdd;
                }
                transitionReason = 'Vmin recovery buy';
            }
            else if (cycleActive) {
                cycleCapHitCount += 1;
            }
        }
        if (cycleActive && cyclePeak != null && current.asset_n >= cyclePeak * 0.95) {
            cycleActive = false;
            cyclePeak = null;
            capitalUsed = 0;
            recentPeak = current.asset_n;
        }
        if (reportContext && transitionReason != null && nextExposure !== exposure) {
            transitions.push({
                date: current.date,
                from_exposure: exposure,
                to_exposure: nextExposure,
                reason: transitionReason,
            });
        }
        exposure = nextExposure;
        points.push({ date: current.date, value: equity, exposure });
    }
    const curve = normalizeCurve(points);
    return {
        curve,
        cycleCapHitCount,
        report: reportContext
            ? buildStrategyReport(curve, transitions, reportContext.visibleStartDate, reportContext.visibleStartIndex)
            : undefined,
    };
}
function buildOriginalVRCappedSyntheticCurve(assetSeries, reportContext) {
    if (assetSeries.length < 2)
        return null;
    let equity = 100;
    let exposure = exports.ARENA_INITIAL_INVESTED_PCT;
    let recentPeak = assetSeries[0]?.asset_n ?? 100;
    let cycleActive = false;
    let cyclePeak = null;
    let capitalUsed = 0;
    let cycleCapHitCount = 0;
    let vmin1Done = false;
    let vmin2Done = false;
    let vmin3Done = false;
    const transitions = [];
    const points = [
        { date: assetSeries[0]?.date ?? '', value: equity, exposure },
    ];
    for (let index = 1; index < assetSeries.length; index += 1) {
        const prev = assetSeries[index - 1];
        const current = assetSeries[index];
        const assetReturn = prev.asset_n > 0 ? (current.asset_n - prev.asset_n) / prev.asset_n : 0;
        equity *= 1 + assetReturn * (exposure / 100);
        if (!cycleActive) {
            recentPeak = Math.max(recentPeak, current.asset_n);
        }
        const dd3 = index >= 3 && assetSeries[index - 3].asset_n > 0
            ? current.asset_n / assetSeries[index - 3].asset_n - 1
            : null;
        const dd5 = index >= 5 && assetSeries[index - 5].asset_n > 0
            ? current.asset_n / assetSeries[index - 5].asset_n - 1
            : null;
        const peakDD = recentPeak > 0 ? current.asset_n / recentPeak - 1 : null;
        const isBelowMa = typeof current.tqqq_ma200_n === 'number' && current.asset_n < current.tqqq_ma200_n;
        const shockTriggered = (dd3 != null && dd3 <= -0.1) || (dd5 != null && dd5 <= -0.15);
        const panicTriggered = (peakDD != null && peakDD <= -0.25) || (dd5 != null && dd5 <= -0.2);
        if (!cycleActive && peakDD != null && peakDD <= -0.25) {
            cycleActive = true;
            cyclePeak = recentPeak;
            capitalUsed = 0;
            vmin1Done = false;
            vmin2Done = false;
            vmin3Done = false;
        }
        let nextExposure = exposure;
        let transitionReason = null;
        if (panicTriggered && exposure > 40) {
            nextExposure = 40;
            transitionReason = 'VR defense reduction';
        }
        else if (isBelowMa && exposure > 50) {
            nextExposure = 50;
            transitionReason = 'VR defense reduction';
        }
        else if (shockTriggered && exposure > exports.ARENA_MAX_INVESTED_PCT) {
            nextExposure = exports.ARENA_MAX_INVESTED_PCT;
            transitionReason = 'VR defense reduction';
        }
        const applyVminStep = (requestedAdd, reason) => {
            const remainingCycleCapital = Math.max(0, exports.ARENA_CYCLE_CAP_PCT - capitalUsed);
            const remainingExposureRoom = Math.max(0, exports.ARENA_MAX_INVESTED_PCT - nextExposure);
            const actualAdd = Math.min(requestedAdd, remainingCycleCapital, remainingExposureRoom);
            if (actualAdd > 0) {
                nextExposure += actualAdd;
                capitalUsed += actualAdd;
                transitionReason = reason;
            }
            else if (cycleActive) {
                cycleCapHitCount += 1;
            }
        };
        if (cycleActive && cyclePeak != null) {
            if (!vmin1Done && current.asset_n <= cyclePeak * 0.6) {
                vmin1Done = true;
                applyVminStep(20, 'Vmin recovery buy');
            }
            else if (!vmin2Done && current.asset_n <= cyclePeak * 0.5) {
                vmin2Done = true;
                applyVminStep(20, 'Vmin recovery buy');
            }
            else if (!vmin3Done && current.asset_n <= cyclePeak * 0.4) {
                vmin3Done = true;
                applyVminStep(10, 'Vmin recovery buy');
            }
        }
        if (cycleActive && cyclePeak != null && current.asset_n >= cyclePeak * 0.95) {
            cycleActive = false;
            cyclePeak = null;
            capitalUsed = 0;
            vmin1Done = false;
            vmin2Done = false;
            vmin3Done = false;
            recentPeak = current.asset_n;
        }
        if (reportContext && transitionReason != null && nextExposure !== exposure) {
            transitions.push({
                date: current.date,
                from_exposure: exposure,
                to_exposure: nextExposure,
                reason: transitionReason,
            });
        }
        exposure = nextExposure;
        points.push({ date: current.date, value: equity, exposure });
    }
    const curve = normalizeCurve(points);
    return {
        curve,
        cycleCapHitCount,
        report: reportContext
            ? buildStrategyReport(curve, transitions, reportContext.visibleStartDate, reportContext.visibleStartIndex)
            : undefined,
    };
}
function zipChartData(input) {
    const ma20050ByDate = new Map(input.ma20050.map((point) => [point.date, point]));
    const ma200Lb30HybridByDate = new Map(input.ma200Lb30Hybrid.map((point) => [point.date, point]));
    const lowBasedLb30ByDate = new Map(input.lowBasedLb30.map((point) => [point.date, point]));
    const lowBasedLb25ByDate = new Map(input.lowBasedLb25.map((point) => [point.date, point]));
    const adaptiveExposureByDate = new Map((input.adaptiveExposure ?? []).map((point) => [point.date, point]));
    const originalVRByDate = new Map((input.originalVR ?? []).map((point) => [point.date, point]));
    return input.buyHold.map((point) => {
        const ma20050Point = ma20050ByDate.get(point.date);
        const ma200Lb30HybridPoint = ma200Lb30HybridByDate.get(point.date);
        const lowBasedLb30Point = lowBasedLb30ByDate.get(point.date);
        const lowBasedLb25Point = lowBasedLb25ByDate.get(point.date);
        const adaptiveExposurePoint = adaptiveExposureByDate.get(point.date);
        const originalVRPoint = originalVRByDate.get(point.date);
        return {
            date: point.date,
            buy_hold_equity: point.equity,
            ma200_risk_control_50_equity: ma20050Point?.equity ?? point.equity,
            ma200_lb30_hybrid_equity: ma200Lb30HybridPoint?.equity ?? point.equity,
            low_based_lb30_equity: lowBasedLb30Point?.equity ?? point.equity,
            low_based_lb25_equity: lowBasedLb25Point?.equity ?? point.equity,
            adaptive_exposure_equity: adaptiveExposurePoint?.equity ?? null,
            original_vr_scaled_equity: originalVRPoint?.equity ?? null,
            buy_hold_drawdown: point.drawdown,
            ma200_risk_control_50_drawdown: ma20050Point?.drawdown ?? point.drawdown,
            ma200_lb30_hybrid_drawdown: ma200Lb30HybridPoint?.drawdown ?? point.drawdown,
            low_based_lb30_drawdown: lowBasedLb30Point?.drawdown ?? point.drawdown,
            low_based_lb25_drawdown: lowBasedLb25Point?.drawdown ?? point.drawdown,
            adaptive_exposure_drawdown: adaptiveExposurePoint?.drawdown ?? null,
            original_vr_scaled_drawdown: originalVRPoint?.drawdown ?? null,
            buy_hold_exposure: point.exposure,
            ma200_risk_control_50_exposure: ma20050Point?.exposure ?? point.exposure,
            ma200_lb30_hybrid_exposure: ma200Lb30HybridPoint?.exposure ?? point.exposure,
            low_based_lb30_exposure: lowBasedLb30Point?.exposure ?? point.exposure,
            low_based_lb25_exposure: lowBasedLb25Point?.exposure ?? point.exposure,
            adaptive_exposure_exposure: adaptiveExposurePoint?.exposure ?? null,
            original_vr_scaled_exposure: originalVRPoint?.exposure ?? null,
        };
    });
}
function buildSyntheticArenaSeries(prices) {
    const dates = prices.map((_, index) => `MC-${String(index).padStart(4, '0')}`);
    const ma200 = buildRollingMean(prices, 200);
    return prices.map((price, index) => ({
        date: dates[index],
        asset_n: Number(price.toFixed(6)),
        tqqq_signal_n: Number(price.toFixed(6)),
        tqqq_ma200_n: ma200[index] ?? null,
        level: Number.NaN,
    }));
}
function runStrategyArenaOnSyntheticPath(input) {
    if (input.initialInvestedPct != null && input.initialInvestedPct !== exports.ARENA_INITIAL_INVESTED_PCT) {
        throw new Error('Arena Monte Carlo synthetic runner requires the shared 80% invested start.');
    }
    if (input.initialCashPct != null && input.initialCashPct !== exports.ARENA_CASH_FLOOR_PCT) {
        throw new Error('Arena Monte Carlo synthetic runner requires the shared 20% cash reserve.');
    }
    if (!input.prices.length || input.prices.length < 2)
        return null;
    const arenaSeries = buildSyntheticArenaSeries(input.prices);
    const visibleStart = arenaSeries[0].date;
    const visibleEnd = arenaSeries[arenaSeries.length - 1].date;
    const reportContext = {
        visibleStartDate: visibleStart,
        visibleStartIndex: 0,
    };
    const buyHold = buildBuyHoldCurve(arenaSeries);
    const ma20050Result = buildMA200Curve(arenaSeries, 50, undefined, reportContext);
    const ma200Lb30HybridResult = buildMA200LB30HybridCurve(arenaSeries, reportContext);
    const lowBasedLb30Result = buildLowBasedRecoveryCurve(arenaSeries, { step1Threshold: 0.3, step2Threshold: 0.4, step3Threshold: 0.5 }, reportContext);
    const lowBasedLb25Result = buildLowBasedRecoveryCurve(arenaSeries, { step1Threshold: 0.25, step2Threshold: 0.35, step3Threshold: 0.45 }, reportContext);
    const adaptiveExposureResult = buildAdaptiveExposureCurve(arenaSeries, 'Monte Carlo Synthetic Path', visibleStart, 0);
    const originalVRResult = buildOriginalVRCappedSyntheticCurve(arenaSeries, reportContext);
    const warningLayer = buildWarningLayerView(arenaSeries, visibleStart, visibleEnd, visibleStart, visibleEnd);
    const ma20050 = ma20050Result.curve;
    const ma200Lb30Hybrid = ma200Lb30HybridResult?.curve ?? [];
    const lowBasedLb30 = lowBasedLb30Result?.curve ?? [];
    const lowBasedLb25 = lowBasedLb25Result?.curve ?? [];
    const adaptiveExposure = adaptiveExposureResult?.curve ?? null;
    const originalVR = originalVRResult?.curve ?? null;
    const strategyReports = {
        buy_hold: buildStrategyReport(buyHold, [], visibleStart, 0),
        ma200_risk_control_50: ma20050Result.report,
        ...(ma200Lb30HybridResult?.report ? { ma200_lb30_hybrid: ma200Lb30HybridResult.report } : {}),
        ...(lowBasedLb30Result?.report ? { low_based_lb30: lowBasedLb30Result.report } : {}),
        ...(lowBasedLb25Result?.report ? { low_based_lb25: lowBasedLb25Result.report } : {}),
        ...(adaptiveExposureResult?.report
            ? {
                adaptive_exposure: {
                    initial_state: adaptiveExposureResult.report.initial_state,
                    full_transitions: adaptiveExposureResult.report.full_transitions.map((transition) => ({
                        date: transition.date,
                        from_exposure: transition.from_exposure,
                        to_exposure: transition.to_exposure,
                        reason: transition.reason,
                    })),
                    visible_transitions: adaptiveExposureResult.report.visible_transitions.map((transition) => ({
                        date: transition.date,
                        from_exposure: transition.from_exposure,
                        to_exposure: transition.to_exposure,
                        reason: transition.reason,
                    })),
                },
            }
            : {}),
        ...(originalVRResult?.report ? { original_vr_scaled: originalVRResult.report } : {}),
    };
    const warningLeadTimeAvg = null;
    const falseDefenseRate = null;
    const strategyDiagnostics = {
        buy_hold: {
            ...computeCurveCapitalDiagnostics(buyHold, { cycleCapHitCount: 0 }),
            warning_lead_time_avg: warningLeadTimeAvg,
            false_defense_rate: falseDefenseRate,
            missed_rebound_cost: 0,
        },
        ma200_risk_control_50: {
            ...computeCurveCapitalDiagnostics(ma20050, { cycleCapHitCount: 0 }),
            warning_lead_time_avg: warningLeadTimeAvg,
            false_defense_rate: falseDefenseRate,
            missed_rebound_cost: computeMissedReboundCost(ma20050, buyHold),
        },
        ...(ma200Lb30HybridResult
            ? {
                ma200_lb30_hybrid: {
                    ...computeCurveCapitalDiagnostics(ma200Lb30Hybrid, {
                        cycleCapHitCount: ma200Lb30HybridResult.cycleCapHitCount,
                    }),
                    warning_lead_time_avg: warningLeadTimeAvg,
                    false_defense_rate: falseDefenseRate,
                    missed_rebound_cost: computeMissedReboundCost(ma200Lb30Hybrid, buyHold),
                },
            }
            : {}),
        ...(lowBasedLb30Result
            ? {
                low_based_lb30: {
                    ...computeCurveCapitalDiagnostics(lowBasedLb30, {
                        cycleCapHitCount: lowBasedLb30Result.cycleCapHitCount,
                    }),
                    warning_lead_time_avg: warningLeadTimeAvg,
                    false_defense_rate: falseDefenseRate,
                    missed_rebound_cost: computeMissedReboundCost(lowBasedLb30, buyHold),
                },
            }
            : {}),
        ...(lowBasedLb25Result
            ? {
                low_based_lb25: {
                    ...computeCurveCapitalDiagnostics(lowBasedLb25, {
                        cycleCapHitCount: lowBasedLb25Result.cycleCapHitCount,
                    }),
                    warning_lead_time_avg: warningLeadTimeAvg,
                    false_defense_rate: falseDefenseRate,
                    missed_rebound_cost: computeMissedReboundCost(lowBasedLb25, buyHold),
                },
            }
            : {}),
        ...(adaptiveExposure
            ? {
                adaptive_exposure: {
                    ...computeCurveCapitalDiagnostics(adaptiveExposure, { cycleCapHitCount: 0 }),
                    warning_lead_time_avg: warningLeadTimeAvg,
                    false_defense_rate: falseDefenseRate,
                    missed_rebound_cost: computeMissedReboundCost(adaptiveExposure, buyHold),
                },
            }
            : {}),
        ...(originalVRResult && originalVR
            ? {
                original_vr_scaled: {
                    ...computeCurveCapitalDiagnostics(originalVR, {
                        cycleCapHitCount: originalVRResult.cycleCapHitCount,
                    }),
                    warning_lead_time_avg: warningLeadTimeAvg,
                    false_defense_rate: falseDefenseRate,
                    missed_rebound_cost: computeMissedReboundCost(originalVR, buyHold),
                },
            }
            : {}),
    };
    return {
        metrics: {
            buy_hold: computeMetric(buyHold),
            ma200_risk_control_50: computeMetric(ma20050),
            ...(ma200Lb30Hybrid.length ? { ma200_lb30_hybrid: computeMetric(ma200Lb30Hybrid) } : {}),
            ...(lowBasedLb30.length ? { low_based_lb30: computeMetric(lowBasedLb30) } : {}),
            ...(lowBasedLb25.length ? { low_based_lb25: computeMetric(lowBasedLb25) } : {}),
            ...(adaptiveExposure ? { adaptive_exposure: computeMetric(adaptiveExposure) } : {}),
            ...(originalVR ? { original_vr_scaled: computeMetric(originalVR) } : {}),
        },
        strategy_reports: strategyReports,
        ...(warningLayer ? { warning_layer: warningLayer } : {}),
        strategy_diagnostics: strategyDiagnostics,
        chart_data: zipChartData({
            buyHold,
            ma20050,
            ma200Lb30Hybrid,
            lowBasedLb30,
            lowBasedLb25,
            adaptiveExposure,
            originalVR,
        }),
    };
}
function buildStrategyArena(input) {
    if (!input.standardArchive?.events?.length)
        return null;
    const events = ARENA_TARGETS.map((target) => {
        const standardEvent = input.standardArchive?.events.find((event) => event.name === target.standard_event_name);
        if (!standardEvent)
            return null;
        const survivalEvent = findMatchingSurvivalEvent(standardEvent, input.survivalArchive);
        const standardSynthetic = buildSyntheticTqqqProxy(standardEvent.playback);
        const standardByDate = new Map(standardEvent.playback.map((point, index) => [
            point.d,
            {
                point,
                synthetic_tqqq_n: standardSynthetic[index] ?? null,
            },
        ]));
        const masterDates = standardEvent.playback.map((point) => point.d);
        const assetSeries = masterDates
            .map((date) => {
            const standardPoint = standardByDate.get(date)?.point;
            if (!standardPoint || typeof standardPoint.qqq_n !== 'number')
                return null;
            const assetN = typeof standardPoint.tqqq_n === 'number'
                ? standardPoint.tqqq_n
                : standardByDate.get(date)?.synthetic_tqqq_n;
            if (typeof assetN !== 'number')
                return null;
            return {
                date,
                asset_n: assetN,
                qqq_n: standardPoint.qqq_n,
                ma50_n: standardPoint.ma50_n,
                tqqq_signal_n: typeof standardPoint.tqqq_n === 'number' ? standardPoint.tqqq_n : null,
                level: standardPoint.level,
            };
        })
            .filter((point) => Boolean(point));
        if (assetSeries.length < 2)
            return null;
        const visibleStart = target.visible_start ?? standardEvent.start;
        const visibleEnd = target.visible_end ?? standardEvent.end;
        const extendedSurvivalPlayback = survivalEvent && input.survivalArchive?.events?.length
            ? buildExtendedSurvivalPlayback(survivalEvent, input.survivalArchive.events, visibleStart)
            : null;
        const extendedRealTqqqHistory = buildExtendedRealTqqqHistory(standardEvent, input.standardArchive.events, visibleStart);
        const realTqqqDates = extendedRealTqqqHistory.map((point) => point.date);
        const realTqqqValues = extendedRealTqqqHistory.map((point) => point.tqqq_n);
        const realTqqqMa200 = buildRollingMean(realTqqqValues, 200);
        const realTqqqMa200ByDate = new Map(realTqqqDates.map((date, index) => [date, realTqqqMa200[index] ?? null]));
        const arenaSeries = assetSeries.map((point) => ({
            ...point,
            tqqq_ma200_n: realTqqqMa200ByDate.get(point.date) ?? null,
        }));
        const eventStartIndex = Math.max(0, arenaSeries.findIndex((point) => point.date >= visibleStart));
        const visibleSeries = arenaSeries.filter((point) => point.date >= visibleStart && point.date <= visibleEnd);
        const buyHold = buildBuyHoldCurve(visibleSeries);
        const reportContext = {
            visibleStartDate: visibleStart,
            visibleStartIndex: eventStartIndex,
        };
        const ma20050Result = buildMA200Curve(arenaSeries, 50, undefined, reportContext);
        const ma200Lb30HybridResult = buildMA200LB30HybridCurve(arenaSeries, reportContext);
        const lowBasedLb30Result = buildLowBasedRecoveryCurve(arenaSeries, { step1Threshold: 0.3, step2Threshold: 0.4, step3Threshold: 0.5 }, reportContext);
        const lowBasedLb25Result = buildLowBasedRecoveryCurve(arenaSeries, { step1Threshold: 0.25, step2Threshold: 0.35, step3Threshold: 0.45 }, reportContext);
        const warningLayer = buildWarningLayerView(arenaSeries, visibleStart, visibleEnd, standardEvent.start, target.visible_end ?? standardEvent.end);
        const ma20050 = rebaseCurveFromIndex(ma20050Result.curve, eventStartIndex, visibleEnd);
        const ma200Lb30Hybrid = ma200Lb30HybridResult
            ? rebaseCurveFromIndex(ma200Lb30HybridResult.curve, eventStartIndex, visibleEnd)
            : [];
        const lowBasedLb30 = lowBasedLb30Result
            ? rebaseCurveFromIndex(lowBasedLb30Result.curve, eventStartIndex, visibleEnd)
            : [];
        const lowBasedLb25 = lowBasedLb25Result
            ? rebaseCurveFromIndex(lowBasedLb25Result.curve, eventStartIndex, visibleEnd)
            : [];
        const adaptiveExposureResult = buildAdaptiveExposureCurve(arenaSeries, target.label, visibleStart, eventStartIndex);
        const adaptiveExposure = adaptiveExposureResult
            ? rebaseCurveFromIndex(adaptiveExposureResult.curve, eventStartIndex, visibleEnd)
            : null;
        const originalVRResult = buildOriginalVRCurve(extendedSurvivalPlayback, arenaSeries, reportContext);
        const originalVR = originalVRResult
            ? rebaseCurveFromIndex(originalVRResult.curve, eventStartIndex, visibleEnd)
            : null;
        const buyHoldReport = buildStrategyReport(buyHold, [], visibleStart, 0);
        const originalVRReport = originalVRResult?.report;
        const strategyReports = {
            buy_hold: buyHoldReport,
            ma200_risk_control_50: ma20050Result.report,
            ...(ma200Lb30HybridResult?.report ? { ma200_lb30_hybrid: ma200Lb30HybridResult.report } : {}),
            ...(lowBasedLb30Result?.report ? { low_based_lb30: lowBasedLb30Result.report } : {}),
            ...(lowBasedLb25Result?.report ? { low_based_lb25: lowBasedLb25Result.report } : {}),
            ...(adaptiveExposureResult?.report
                ? {
                    adaptive_exposure: {
                        initial_state: adaptiveExposureResult.report.initial_state,
                        full_transitions: adaptiveExposureResult.report.full_transitions.map((transition) => ({
                            date: transition.date,
                            from_exposure: transition.from_exposure,
                            to_exposure: transition.to_exposure,
                            reason: transition.reason,
                        })),
                        visible_transitions: adaptiveExposureResult.report.visible_transitions.map((transition) => ({
                            date: transition.date,
                            from_exposure: transition.from_exposure,
                            to_exposure: transition.to_exposure,
                            reason: transition.reason,
                        })),
                    },
                }
                : {}),
            ...(originalVRReport ? { original_vr_scaled: originalVRReport } : {}),
        };
        return {
            id: target.id,
            label: target.label,
            standard_event_name: standardEvent.name,
            playback_event_id: standardEvent.start.slice(0, 7),
            start: visibleStart,
            end: visibleEnd,
            vr_source: survivalEvent ? 'survival_archive' : null,
            ...(adaptiveExposureResult ? { adaptive_exposure_report: adaptiveExposureResult.report } : {}),
            strategy_reports: strategyReports,
            ...(warningLayer ? { warning_layer: warningLayer } : {}),
            metrics: {
                buy_hold: computeMetric(buyHold),
                ma200_risk_control_50: computeMetric(ma20050),
                ...(ma200Lb30Hybrid.length ? { ma200_lb30_hybrid: computeMetric(ma200Lb30Hybrid) } : {}),
                ...(lowBasedLb30.length ? { low_based_lb30: computeMetric(lowBasedLb30) } : {}),
                ...(lowBasedLb25.length ? { low_based_lb25: computeMetric(lowBasedLb25) } : {}),
                ...(adaptiveExposure ? { adaptive_exposure: computeMetric(adaptiveExposure) } : {}),
                ...(originalVR ? { original_vr_scaled: computeMetric(originalVR) } : {}),
            },
            chart_data: zipChartData({
                buyHold,
                ma20050,
                ma200Lb30Hybrid,
                lowBasedLb30,
                lowBasedLb25,
                adaptiveExposure,
                originalVR,
            }),
        };
    })
        // Validation log — verify all curves start at 100 and share same TQQQ baseline
        .map((event) => {
        if (!event)
            return null;
        const cd = event.chart_data;
        const startDate = cd[0]?.date ?? 'n/a';
        const first5 = (vals) => JSON.stringify(vals.filter(v => v != null).slice(0, 5).map(v => +v.toFixed(2)));
        const curves = [
            ['Buy & Hold', cd.map(p => p.buy_hold_equity)],
            ['VR Original (Capped)', cd.map(p => p.original_vr_scaled_equity)],
            ['MA200 (50%)', cd.map(p => p.ma200_risk_control_50_equity)],
            ['MA200 + LB30', cd.map(p => p.ma200_lb30_hybrid_equity)],
            ['LB30', cd.map(p => p.low_based_lb30_equity)],
            ['LB25', cd.map(p => p.low_based_lb25_equity)],
            ['Adaptive Exposure', cd.map(p => p.adaptive_exposure_equity)],
        ];
        curves.forEach(([name, vals]) => {
            if (!vals?.length)
                return;
            const first = vals.find(v => v != null);
            const warn = (first != null && Math.abs(first - 100) > 0.5) ? ' ⚠ DOES NOT START AT 100' : '';
            console.log(`Arena ${event.label} | ${name} | asset=TQQQ | start=${startDate} | first5=${first5(vals)}${warn}`);
        });
        return event;
    })
        .filter((event) => event !== null);
    return {
        events,
        methodology: {
            fixed_stop_loss_rule: 'Exit after a 12% instrument drawdown from entry peak. Re-enter on MA50 reclaim with improving price.',
            ma200_rule: 'By close, compare TQQQ against its own 200-day moving average. MA200 (50%) starts from the shared 80 / 20 Arena allocation, reduces exposure to 50% below MA200, and restores to the 80% invested cap above it. MA200 + LB30 keeps the same MA200 defense, then re-adds risk through the LB30 rebound ladder while preserving the same next-bar execution timing.',
            vr_source_priority: 'All Arena strategies now start from the same 80% invested / 20% cash allocation. LB30 and LB25 keep the existing Adaptive downside evidence: shock (dd3/dd5), trend breakdown versus TQQQ MA200, and panic drawdown. Re-entry is low-based and cycle-bound, with per-cycle capital capped and recovery exposure constrained. Adaptive Exposure remains unchanged as the V-shape reference. VR Original now reuses archive VR defense and Vmin-buy intent on the Arena-local TQQQ path, but caps cycle rebuys at 50% total added capital and preserves at least 20% cash.',
            warning_layer_rule: 'The warning layer quantizes downside behavior with dd3, dd5, dd6, peak drawdown expansion, MA200 distance, and VR-band context to move through NORMAL, WATCH, ALERT, DEFENSE_READY, DEFENSE_ACTIVE, and RECOVERY_MODE. It produces a scenario hint for handoff and interpretation, but it does not directly trade.',
        },
    };
}
function runStrategyArenaExamples(view) {
    const cases = [
        { label: '2008 Crash', expect: '2007-07 Risk Event' },
        { label: '2020 COVID Crash', expect: '2020-02 Risk Event' },
        { label: '2026 Risk Event', expect: '2026-02 Risk Event' },
    ];
    return cases.map((testCase) => {
        const event = view?.events.find((item) => item.label === testCase.label) ?? null;
        return {
            label: testCase.label,
            passed: event?.standard_event_name === testCase.expect &&
                event.chart_data.length > 1 &&
                Object.values(event.metrics).every((metric) => Number.isFinite(metric.final_return_pct)),
            vr_source: event?.vr_source ?? null,
            standard_event_name: event?.standard_event_name ?? null,
        };
    });
}
