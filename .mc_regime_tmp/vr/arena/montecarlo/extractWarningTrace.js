"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractWarningTrace = extractWarningTrace;
const DEFAULT_REASON = 'No unusual downside speed is currently detected.';
function buildRollingMean(values, window) {
    const output = [];
    let sum = 0;
    const queue = [];
    for (let index = 0; index < values.length; index += 1) {
        sum += values[index];
        queue.push(values[index]);
        if (queue.length > window) {
            sum -= queue.shift() ?? 0;
        }
        output.push(queue.length === window ? Number((sum / window).toFixed(6)) : null);
    }
    return output;
}
function inferProxyScenarioHint(prices) {
    if (prices.length < 2)
        return 'Mixed';
    let rollingPeak = prices[0];
    let anchorIndex = -1;
    for (let index = 1; index < prices.length; index += 1) {
        rollingPeak = Math.max(rollingPeak, prices[index]);
        const peakDD = rollingPeak > 0 ? prices[index] / rollingPeak - 1 : null;
        const dd5 = index >= 5 && prices[index - 5] > 0 ? prices[index] / prices[index - 5] - 1 : null;
        if ((peakDD != null && peakDD <= -0.15) || (dd5 != null && dd5 <= -0.12)) {
            anchorIndex = index;
            break;
        }
    }
    if (anchorIndex < 0)
        return 'Mixed';
    const window = prices.slice(anchorIndex);
    const duration = window.length;
    const bottomIndex = window.reduce((best, point, index, array) => (point < array[best] ? index : best), 0);
    const peakBeforeBottom = window
        .slice(0, bottomIndex + 1)
        .reduce((best, point) => Math.max(best, point), window[0]);
    const recoveryIndex = window.findIndex((point, index) => index > bottomIndex && point >= peakBeforeBottom * 0.95);
    const reboundBars = recoveryIndex >= 0 ? recoveryIndex - bottomIndex : Number.POSITIVE_INFINITY;
    if (duration <= 60 && reboundBars <= 20)
        return 'V';
    if (duration > 120)
        return 'Bear';
    if (duration <= 120)
        return 'Correction';
    return 'Mixed';
}
function resolveScenarioHint(prices, injectedScenarioMeta) {
    if (!injectedScenarioMeta?.injectionApplied || !injectedScenarioMeta.recoveryShape) {
        return inferProxyScenarioHint(prices);
    }
    switch (injectedScenarioMeta.recoveryShape) {
        case 'V_SHAPE':
            return 'V';
        case 'GRINDING_BEAR':
            return 'Bear';
        case 'DELAYED_RECOVERY':
            return 'Correction';
        case 'DEAD_CAT':
            return 'Mixed';
    }
}
function extractWarningTrace(args) {
    if (!args.prices.length)
        return [];
    const ma200 = buildRollingMean(args.prices, 200);
    const scenarioHint = resolveScenarioHint(args.prices, args.injectedScenarioMeta);
    let recentPeak = args.prices[0];
    let cycleActive = false;
    let cyclePeak = null;
    let trackedLow = null;
    let consecutiveWarningDays = 0;
    let currentState = 'NORMAL';
    let currentReason = DEFAULT_REASON;
    const trace = [
        {
            pathId: args.pathId,
            dayIndex: 0,
            warningState: currentState,
            warningReason: currentReason,
            dd3: null,
            dd5: null,
            dd6: null,
            peakDD: null,
            reboundFromLow: null,
            ma200Gap: null,
            scenarioHint,
        },
    ];
    for (let index = 1; index < args.prices.length; index += 1) {
        const current = args.prices[index];
        if (!cycleActive) {
            recentPeak = Math.max(recentPeak, current);
        }
        const dd3 = index >= 3 && args.prices[index - 3] > 0 ? current / args.prices[index - 3] - 1 : null;
        const dd5 = index >= 5 && args.prices[index - 5] > 0 ? current / args.prices[index - 5] - 1 : null;
        const dd6 = index >= 6 && args.prices[index - 6] > 0 ? current / args.prices[index - 6] - 1 : null;
        const peakDD = recentPeak > 0 ? current / recentPeak - 1 : null;
        const distanceToMa = typeof ma200[index] === 'number' && ma200[index] > 0
            ? current / ma200[index] - 1
            : null;
        const warningHitCount = [
            dd3 != null && dd3 <= -0.1,
            dd5 != null && dd5 <= -0.15,
            dd6 != null && dd6 <= -0.17,
        ].filter(Boolean).length;
        const hasWarning = warningHitCount > 0;
        const belowMa = typeof ma200[index] === 'number' && current < ma200[index];
        consecutiveWarningDays = hasWarning ? consecutiveWarningDays + 1 : 0;
        if (!cycleActive && peakDD != null && peakDD <= -0.25) {
            cycleActive = true;
            cyclePeak = recentPeak;
            trackedLow = current;
        }
        if (cycleActive) {
            trackedLow = trackedLow == null ? current : Math.min(trackedLow, current);
        }
        const reboundFromLow = trackedLow != null && trackedLow > 0 ? current / trackedLow - 1 : null;
        let nextState = 'NORMAL';
        let nextReason = DEFAULT_REASON;
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
        currentState = nextState;
        currentReason = nextReason;
        trace.push({
            pathId: args.pathId,
            dayIndex: index,
            warningState: currentState,
            warningReason: currentReason,
            dd3: dd3 != null ? Number((dd3 * 100).toFixed(2)) : null,
            dd5: dd5 != null ? Number((dd5 * 100).toFixed(2)) : null,
            dd6: dd6 != null ? Number((dd6 * 100).toFixed(2)) : null,
            peakDD: peakDD != null ? Number((peakDD * 100).toFixed(2)) : null,
            reboundFromLow: reboundFromLow != null ? Number((reboundFromLow * 100).toFixed(2)) : null,
            ma200Gap: distanceToMa != null ? Number((distanceToMa * 100).toFixed(2)) : null,
            scenarioHint,
        });
        if (cycleActive && cyclePeak != null && current >= cyclePeak * 0.95) {
            cycleActive = false;
            cyclePeak = null;
            trackedLow = null;
            recentPeak = current;
        }
    }
    return trace;
}
