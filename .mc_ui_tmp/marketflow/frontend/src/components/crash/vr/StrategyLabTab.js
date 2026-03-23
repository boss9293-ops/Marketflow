'use client';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategyLabTab = StrategyLabTab;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const recharts_1 = require("recharts");
// ─── Constants ────────────────────────────────────────────────────────────────
const STRATEGY_IDS = [
    'original_vr', 'drawdown_ladder', 'bottom_reentry', 'ma200_trend', 'vr_hybrid',
];
const STRATEGY_META = {
    original_vr: { label: 'Original VR (Playback)', color: '#6366f1', desc: 'Pre-computed archive playback execution; separate from Arena scaled curve' },
    drawdown_ladder: { label: 'Drawdown Ladder', color: '#10b981', desc: 'Buy tiers at QQQ DD -15/-25/-35/-45% (25% pool each)' },
    bottom_reentry: { label: 'Bottom Re-entry', color: '#f59e0b', desc: 'Deep buy at QQQ DD <= -35%, reversal buy on recovery from -20%' },
    ma200_trend: { label: 'MA200 Trend', color: '#ef4444', desc: 'Buy 40% pool on MA200 cross-above, sell 30% on cross-below' },
    vr_hybrid: { label: 'VR Hybrid', color: '#8b5cf6', desc: 'Ladder with MA200 size multiplier (1.0x above / 0.5x below)' },
};
const REPLAY_INTERVALS = {
    instant: 0,
    '1x': 150,
    '5x': 30,
    '20x': 10,
};
// ─── Simulation Engine ────────────────────────────────────────────────────────
function toPrice(tqqq_n, startPrice, normBase) {
    if (tqqq_n == null || normBase === 0)
        return null;
    return tqqq_n * (startPrice / normBase);
}
function runSimulation(event, strategy) {
    const state = event.cycle_start.initial_state;
    if (!state) {
        return {
            points: [], buyCount: 0, sellCount: 0, finalEquity: 0,
            maxDrawdown: 0, recoveryDays: -1, poolRemaining: 0,
            crashDepth: 0, defenseTiming: null, bottomDetection: null,
        };
    }
    // Original VR (Playback): use pre-computed archive playback points directly.
    if (strategy === 'original_vr') {
        const playbackPoints = event.execution_playback?.original_vr?.points ?? [];
        const playbackSummary = event.execution_playback?.original_vr?.pool_usage_summary;
        const equities = playbackPoints.map(p => p.portfolio_value);
        let maxDD = 0;
        let peakSoFar = equities[0] ?? 0;
        for (const v of equities) {
            if (v > peakSoFar)
                peakSoFar = v;
            const dd = peakSoFar > 0 ? (peakSoFar - v) / peakSoFar : 0;
            if (dd > maxDD)
                maxDD = dd;
        }
        const peakEquity = Math.max(...equities);
        const peakIdx = equities.indexOf(peakEquity);
        const postPeak = equities.slice(peakIdx);
        const recoveryIdx = postPeak.findIndex((v, i) => i > 0 && v >= peakEquity);
        const inEventPoints = event.chart_data.filter(p => p.in_event);
        const qqq_dds = inEventPoints.map(p => p.qqq_dd ?? 0);
        const crashDepth = Math.abs(Math.min(...qqq_dds, 0));
        return {
            points: playbackPoints.map(p => ({
                date: p.date,
                portfolio: p.portfolio_value,
                shares: p.shares_after_trade,
                poolCash: p.pool_cash_after_trade,
                avgCost: p.avg_cost_after_trade,
                buys: 0,
                sells: 0,
            })),
            buyCount: playbackSummary?.executed_buy_count ?? 0,
            sellCount: playbackSummary?.executed_sell_count ?? 0,
            finalEquity: playbackPoints.length > 0 ? playbackPoints[playbackPoints.length - 1].portfolio_value : 0,
            maxDrawdown: maxDD,
            recoveryDays: recoveryIdx < 0 ? -1 : recoveryIdx,
            poolRemaining: playbackPoints.length > 0 ? playbackPoints[playbackPoints.length - 1].pool_cash_after_trade : 0,
            crashDepth,
            defenseTiming: null,
            bottomDetection: null,
        };
    }
    const { initial_capital, start_price, initial_share_count, initial_pool_cash } = state;
    const normPoint = event.chart_data.find(p => p.tqqq_n != null);
    const normBase = normPoint?.tqqq_n ?? 1;
    let shares = initial_share_count;
    let poolCash = initial_pool_cash;
    let avgCost = start_price;
    let buyCount = 0;
    let sellCount = 0;
    const points = [];
    // Use numeric keys for tiers: -15, -25, -35, -45, -20 (reversal = -20.5)
    const buyLevelsFired = new Set();
    let prevMa200Below = false;
    let prevQqqDd = 0;
    let defenseTiming = null;
    let bottomDetection = null;
    let dayIdx = 0;
    for (const p of event.chart_data) {
        const price = toPrice(p.tqqq_n, start_price, normBase);
        if (price == null) {
            dayIdx++;
            continue;
        }
        const ma200Price = toPrice(p.ma200_n, start_price, normBase);
        const isAboveMa200 = ma200Price != null ? price > ma200Price : true;
        const qqqDd = p.qqq_dd ?? 0;
        if (strategy === 'drawdown_ladder') {
            for (const tier of [-15, -25, -35, -45]) {
                if (!buyLevelsFired.has(tier) && qqqDd <= tier && poolCash > 0) {
                    const spend = Math.min(poolCash, initial_pool_cash * 0.25);
                    const newShares = Math.floor(spend / price);
                    if (newShares > 0) {
                        const totalCost = shares * avgCost + newShares * price;
                        shares += newShares;
                        avgCost = totalCost / shares;
                        poolCash -= newShares * price;
                        buyCount++;
                        buyLevelsFired.add(tier);
                        if (defenseTiming == null && tier <= -35)
                            defenseTiming = dayIdx;
                    }
                }
            }
            const stockEval = shares * price;
            if (stockEval > initial_capital * 1.2 && shares > 0) {
                const sellShares = Math.floor(shares * 0.30);
                if (sellShares > 0) {
                    shares -= sellShares;
                    poolCash += sellShares * price;
                    sellCount++;
                }
            }
        }
        else if (strategy === 'bottom_reentry') {
            if (!buyLevelsFired.has(-35) && qqqDd <= -35 && poolCash > 0) {
                const spend = Math.min(poolCash, initial_pool_cash * 0.25);
                const newShares = Math.floor(spend / price);
                if (newShares > 0) {
                    const totalCost = shares * avgCost + newShares * price;
                    shares += newShares;
                    avgCost = totalCost / shares;
                    poolCash -= newShares * price;
                    buyCount++;
                    buyLevelsFired.add(-35);
                    if (defenseTiming == null)
                        defenseTiming = dayIdx;
                }
            }
            // Reversal buy key = -20.5
            if (!buyLevelsFired.has(-20.5) && prevQqqDd <= -20 && qqqDd > prevQqqDd && poolCash > 0) {
                const spend = Math.min(poolCash, initial_pool_cash * 0.50);
                const newShares = Math.floor(spend / price);
                if (newShares > 0) {
                    const totalCost = shares * avgCost + newShares * price;
                    shares += newShares;
                    avgCost = totalCost / shares;
                    poolCash -= newShares * price;
                    buyCount++;
                    buyLevelsFired.add(-20.5);
                    if (bottomDetection == null)
                        bottomDetection = dayIdx;
                }
            }
        }
        else if (strategy === 'ma200_trend') {
            const nowBelowMa200 = !isAboveMa200;
            if (prevMa200Below && !nowBelowMa200 && poolCash > 0) {
                const spend = Math.min(poolCash, initial_pool_cash * 0.40);
                const newShares = Math.floor(spend / price);
                if (newShares > 0) {
                    const totalCost = shares * avgCost + newShares * price;
                    shares += newShares;
                    avgCost = totalCost / shares;
                    poolCash -= newShares * price;
                    buyCount++;
                    if (bottomDetection == null)
                        bottomDetection = dayIdx;
                }
            }
            if (!prevMa200Below && nowBelowMa200 && shares > 0) {
                const sellShares = Math.floor(shares * 0.30);
                if (sellShares > 0) {
                    shares -= sellShares;
                    poolCash += sellShares * price;
                    sellCount++;
                    if (defenseTiming == null)
                        defenseTiming = dayIdx;
                }
            }
            prevMa200Below = nowBelowMa200;
        }
        else if (strategy === 'vr_hybrid') {
            const sz = isAboveMa200 ? 1.0 : 0.5;
            for (const tier of [-10, -20, -30, -40]) {
                if (!buyLevelsFired.has(tier) && qqqDd <= tier && poolCash > 0) {
                    const spend = Math.min(poolCash, initial_pool_cash * 0.20 * sz);
                    const newShares = Math.floor(spend / price);
                    if (newShares > 0) {
                        const totalCost = shares * avgCost + newShares * price;
                        shares += newShares;
                        avgCost = totalCost / shares;
                        poolCash -= newShares * price;
                        buyCount++;
                        buyLevelsFired.add(tier);
                        if (defenseTiming == null && !isAboveMa200)
                            defenseTiming = dayIdx;
                    }
                }
            }
            const nowBelowMa200 = !isAboveMa200;
            if (prevMa200Below && !nowBelowMa200 && shares > 0) {
                const sellShares = Math.floor(shares * 0.20);
                if (sellShares > 0) {
                    shares -= sellShares;
                    poolCash += sellShares * price;
                    sellCount++;
                    if (bottomDetection == null)
                        bottomDetection = dayIdx;
                }
            }
            prevMa200Below = nowBelowMa200;
        }
        prevQqqDd = qqqDd;
        dayIdx++;
        points.push({
            date: p.date,
            portfolio: Number((shares * price + poolCash).toFixed(2)),
            shares,
            poolCash: Number(poolCash.toFixed(2)),
            avgCost: Number(avgCost.toFixed(2)),
            buys: buyCount,
            sells: sellCount,
        });
    }
    const equities = points.map(pt => pt.portfolio);
    let maxDD = 0;
    let peakSoFar = equities[0] ?? initial_capital;
    for (const v of equities) {
        if (v > peakSoFar)
            peakSoFar = v;
        const dd = peakSoFar > 0 ? (peakSoFar - v) / peakSoFar : 0;
        if (dd > maxDD)
            maxDD = dd;
    }
    const finalEquity = points.length > 0 ? points[points.length - 1].portfolio : initial_capital;
    const peakEquity = equities.length > 0 ? Math.max(...equities) : initial_capital;
    const peakIdx = equities.indexOf(peakEquity);
    const postPeak = equities.slice(peakIdx);
    const recoveryIdx = postPeak.findIndex((v, i) => i > 0 && v >= peakEquity);
    const inEventPoints = event.chart_data.filter(pt => pt.in_event);
    const qqq_dds = inEventPoints.map(pt => pt.qqq_dd ?? 0);
    const crashDepth = Math.abs(Math.min(...qqq_dds, 0));
    return {
        points,
        buyCount,
        sellCount,
        finalEquity,
        maxDrawdown: maxDD,
        recoveryDays: recoveryIdx < 0 ? -1 : recoveryIdx,
        poolRemaining: points.length > 0 ? points[points.length - 1].poolCash : initial_pool_cash,
        crashDepth,
        defenseTiming,
        bottomDetection,
    };
}
function buildChartData(event, results, maxStep) {
    const state = event.cycle_start.initial_state;
    if (!state)
        return [];
    const normPoint = event.chart_data.find(p => p.tqqq_n != null);
    const normBase = normPoint?.tqqq_n ?? 1;
    const { initial_capital, start_price } = state;
    const bhShares = initial_capital / start_price;
    const pointMaps = {};
    for (const sid of STRATEGY_IDS) {
        const res = results[sid];
        if (!res)
            continue;
        const map = new Map();
        for (const pt of res.points)
            map.set(pt.date, pt.portfolio);
        pointMaps[sid] = map;
    }
    return event.chart_data.slice(0, maxStep + 1).map(p => {
        const tqqq_price = toPrice(p.tqqq_n, start_price, normBase);
        return {
            date: p.date,
            tqqq_bh: tqqq_price != null ? Number((bhShares * tqqq_price).toFixed(2)) : null,
            // Playback-only archive series. Arena renders Original VR (Scaled) separately.
            original_vr: pointMaps['original_vr']?.get(p.date) ?? null,
            drawdown_ladder: pointMaps['drawdown_ladder']?.get(p.date) ?? null,
            bottom_reentry: pointMaps['bottom_reentry']?.get(p.date) ?? null,
            ma200_trend: pointMaps['ma200_trend']?.get(p.date) ?? null,
            vr_hybrid: pointMaps['vr_hybrid']?.get(p.date) ?? null,
        };
    });
}
function StrategyLabTab({ events }) {
    const [selectedEventId, setSelectedEventId] = (0, react_1.useState)(events[0]?.event_id ?? '');
    const [enabledStrategies, setEnabledStrategies] = (0, react_1.useState)(new Set(STRATEGY_IDS));
    const [results, setResults] = (0, react_1.useState)({});
    const [replaySpeed, setReplaySpeed] = (0, react_1.useState)('instant');
    const [isPlaying, setIsPlaying] = (0, react_1.useState)(false);
    const [currentStep, setCurrentStep] = (0, react_1.useState)(0);
    const [totalSteps, setTotalSteps] = (0, react_1.useState)(0);
    const [chartData, setChartData] = (0, react_1.useState)([]);
    const [running, setRunning] = (0, react_1.useState)(false);
    const intervalRef = (0, react_1.useRef)(null);
    const selectedEvent = events.find(e => e.event_id === selectedEventId) ?? events[0];
    const stopReplay = (0, react_1.useCallback)(() => {
        if (intervalRef.current != null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        setIsPlaying(false);
    }, []);
    (0, react_1.useEffect)(() => {
        if (!selectedEvent)
            return;
        stopReplay();
        setRunning(true);
        setTimeout(() => {
            const newResults = {};
            for (const sid of STRATEGY_IDS) {
                if (enabledStrategies.has(sid)) {
                    newResults[sid] = runSimulation(selectedEvent, sid);
                }
            }
            const steps = selectedEvent.chart_data.length - 1;
            setResults(newResults);
            setTotalSteps(steps);
            setCurrentStep(replaySpeed === 'instant' ? steps : 0);
            setRunning(false);
        }, 16);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEventId, enabledStrategies]);
    (0, react_1.useEffect)(() => {
        if (!selectedEvent || Object.keys(results).length === 0)
            return;
        setChartData(buildChartData(selectedEvent, results, currentStep));
    }, [selectedEvent, results, currentStep]);
    (0, react_1.useEffect)(() => {
        if (!isPlaying)
            return;
        if (replaySpeed === 'instant') {
            setCurrentStep(totalSteps);
            setIsPlaying(false);
            return;
        }
        const ms = REPLAY_INTERVALS[replaySpeed];
        intervalRef.current = setInterval(() => {
            setCurrentStep(prev => {
                if (prev >= totalSteps) {
                    stopReplay();
                    return prev;
                }
                return prev + 1;
            });
        }, ms);
        return () => { if (intervalRef.current)
            clearInterval(intervalRef.current); };
    }, [isPlaying, replaySpeed, totalSteps, stopReplay]);
    const handlePlay = () => {
        if (currentStep >= totalSteps)
            setCurrentStep(0);
        setIsPlaying(true);
    };
    const handleEnd = () => { stopReplay(); setCurrentStep(totalSteps); };
    const handleReset = () => { stopReplay(); setCurrentStep(0); };
    const toggleStrategy = (sid) => {
        setEnabledStrategies(prev => {
            const next = new Set(prev);
            if (next.has(sid))
                next.delete(sid);
            else
                next.add(sid);
            return next;
        });
    };
    const initialCapital = selectedEvent?.cycle_start.initial_state?.initial_capital ?? 100000;
    const fmt = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const fmtPct = (v) => (v * 100).toFixed(1) + '%';
    // B&H equity for results table
    const bhFinalEquity = (() => {
        if (!selectedEvent?.cycle_start.initial_state)
            return null;
        const { initial_capital: ic, start_price: sp } = selectedEvent.cycle_start.initial_state;
        const normPoint = selectedEvent.chart_data.find(p => p.tqqq_n != null);
        const normBase = normPoint?.tqqq_n ?? 1;
        const last = selectedEvent.chart_data[selectedEvent.chart_data.length - 1];
        const finalPrice = toPrice(last?.tqqq_n ?? null, sp, normBase);
        if (finalPrice == null)
            return null;
        return (ic / sp) * finalPrice;
    })();
    const bhMaxDD = (() => {
        if (!selectedEvent?.cycle_start.initial_state)
            return 0;
        const { initial_capital: ic, start_price: sp } = selectedEvent.cycle_start.initial_state;
        const normPoint = selectedEvent.chart_data.find(p => p.tqqq_n != null);
        const normBase = normPoint?.tqqq_n ?? 1;
        const bhShares = ic / sp;
        let peak = 0, maxDD = 0;
        for (const p of selectedEvent.chart_data) {
            const price = toPrice(p.tqqq_n, sp, normBase);
            if (price == null)
                continue;
            const val = bhShares * price;
            if (val > peak)
                peak = val;
            const dd = peak > 0 ? (peak - val) / peak : 0;
            if (dd > maxDD)
                maxDD = dd;
        }
        return maxDD;
    })();
    return ((0, jsx_runtime_1.jsxs)("div", { style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: 13, fontWeight: 700, color: '#c7d2fe', letterSpacing: 1 }, children: "STRATEGY LAB" }), (0, jsx_runtime_1.jsx)("select", { value: selectedEventId, onChange: e => setSelectedEventId(e.target.value), style: {
                            background: 'rgba(30,27,75,0.8)', border: '1px solid rgba(99,102,241,0.35)',
                            color: '#e2e8f0', padding: '4px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        }, children: events.map(ev => ((0, jsx_runtime_1.jsxs)("option", { value: ev.event_id, children: [ev.event_id, " \u2014 ", ev.name] }, ev.event_id))) }), running && ((0, jsx_runtime_1.jsx)("span", { style: { fontSize: 11, color: '#a5b4fc', opacity: 0.7 }, children: "Simulating\u2026" }))] }), (0, jsx_runtime_1.jsxs)("div", { style: {
                    background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 8, padding: '12px 14px',
                }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }, children: "STRATEGIES" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: STRATEGY_IDS.map(sid => {
                            const meta = STRATEGY_META[sid];
                            const active = enabledStrategies.has(sid);
                            return ((0, jsx_runtime_1.jsx)("button", { onClick: () => toggleStrategy(sid), title: meta.desc, style: {
                                    background: active ? `${meta.color}22` : 'rgba(30,27,75,0.5)',
                                    border: `1px solid ${active ? meta.color : 'rgba(99,102,241,0.2)'}`,
                                    color: active ? meta.color : '#64748b',
                                    padding: '4px 10px', borderRadius: 5, fontSize: 11,
                                    cursor: 'pointer', fontWeight: active ? 600 : 400, transition: 'all 0.15s',
                                }, children: meta.label }, sid));
                        }) })] }), (0, jsx_runtime_1.jsx)("div", { style: {
                    background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 8, padding: '12px 14px',
                }, children: (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: 11, color: '#94a3b8', letterSpacing: 0.5, minWidth: 50 }, children: "REPLAY" }), ['instant', '1x', '5x', '20x'].map(s => ((0, jsx_runtime_1.jsx)("button", { onClick: () => { stopReplay(); setReplaySpeed(s); }, style: {
                                background: replaySpeed === s ? 'rgba(99,102,241,0.3)' : 'rgba(30,27,75,0.5)',
                                border: `1px solid ${replaySpeed === s ? '#6366f1' : 'rgba(99,102,241,0.2)'}`,
                                color: replaySpeed === s ? '#a5b4fc' : '#64748b',
                                padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                            }, children: s }, s))), (0, jsx_runtime_1.jsx)("div", { style: { width: 1, height: 16, background: 'rgba(99,102,241,0.2)' } }), (0, jsx_runtime_1.jsx)("button", { onClick: isPlaying ? stopReplay : handlePlay, disabled: replaySpeed === 'instant', style: {
                                background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)',
                                color: '#a5b4fc', padding: '3px 12px', borderRadius: 4, fontSize: 11,
                                cursor: replaySpeed === 'instant' ? 'not-allowed' : 'pointer',
                                opacity: replaySpeed === 'instant' ? 0.4 : 1,
                            }, children: isPlaying ? '⏸ Pause' : '▶ Play' }), (0, jsx_runtime_1.jsx)("button", { onClick: handleEnd, style: {
                                background: 'rgba(30,27,75,0.5)', border: '1px solid rgba(99,102,241,0.2)',
                                color: '#94a3b8', padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                            }, children: "\u23ED End" }), (0, jsx_runtime_1.jsx)("button", { onClick: handleReset, style: {
                                background: 'rgba(30,27,75,0.5)', border: '1px solid rgba(99,102,241,0.2)',
                                color: '#94a3b8', padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                            }, children: "\u23EE Reset" }), (0, jsx_runtime_1.jsx)("div", { style: { flex: 1, minWidth: 100 }, children: (0, jsx_runtime_1.jsx)("div", { style: { height: 4, background: 'rgba(99,102,241,0.15)', borderRadius: 2 }, children: (0, jsx_runtime_1.jsx)("div", { style: {
                                        height: '100%', borderRadius: 2, background: '#6366f1', transition: 'width 0.1s',
                                        width: totalSteps > 0 ? `${(currentStep / totalSteps) * 100}%` : '0%',
                                    } }) }) }), (0, jsx_runtime_1.jsxs)("span", { style: { fontSize: 10, color: '#64748b', minWidth: 60, textAlign: 'right' }, children: [currentStep, "/", totalSteps] })] }) }), (0, jsx_runtime_1.jsxs)("div", { style: {
                    background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 8, padding: '12px 14px',
                }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }, children: "EQUITY CURVES" }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 260, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: chartData, margin: { top: 4, right: 8, bottom: 0, left: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(99,102,241,0.1)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "date", tick: { fill: '#64748b', fontSize: 10 }, tickFormatter: d => String(d ?? '').slice(0, 7), interval: "preserveStartEnd" }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fill: '#64748b', fontSize: 10 }, tickFormatter: v => `$${(Number(v) / 1000).toFixed(0)}k`, width: 48 }), (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { contentStyle: {
                                        background: 'rgba(15,10,40,0.95)', border: '1px solid rgba(99,102,241,0.3)',
                                        borderRadius: 6, fontSize: 11,
                                    }, formatter: (v) => [`$${fmt(Number(v))}`, ''], labelStyle: { color: '#94a3b8' } }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "tqqq_bh", stroke: "#94a3b8", strokeWidth: 1.5, dot: false, isAnimationActive: false, strokeDasharray: "4 2", name: "TQQQ B&H" }), STRATEGY_IDS.filter(sid => enabledStrategies.has(sid)).map(sid => ((0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: sid, stroke: STRATEGY_META[sid].color, strokeWidth: 2, dot: false, isAnimationActive: false, name: STRATEGY_META[sid].label }, sid))), (0, jsx_runtime_1.jsx)(recharts_1.ReferenceLine, { y: initialCapital, stroke: "rgba(99,102,241,0.3)", strokeDasharray: "2 2" })] }) }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { width: 20, height: 2, background: '#94a3b8', opacity: 0.6 } }), (0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#64748b' }, children: "TQQQ B&H" })] }), STRATEGY_IDS.filter(sid => enabledStrategies.has(sid)).map(sid => ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { width: 20, height: 2, background: STRATEGY_META[sid].color } }), (0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#94a3b8' }, children: STRATEGY_META[sid].label })] }, sid)))] })] }), (0, jsx_runtime_1.jsxs)("div", { style: {
                    background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 8, padding: '12px 14px',
                }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }, children: "RESULTS" }), (0, jsx_runtime_1.jsx)("div", { style: { overflowX: 'auto' }, children: (0, jsx_runtime_1.jsxs)("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 }, children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsx)("tr", { style: { borderBottom: '1px solid rgba(99,102,241,0.2)' }, children: ['Strategy', 'Final Equity', 'Return', 'Max DD', 'Recovery', 'Pool Left', 'Buys', 'Sells'].map(h => ((0, jsx_runtime_1.jsx)("th", { style: { padding: '4px 8px', textAlign: 'left', color: '#64748b', fontWeight: 500 }, children: h }, h))) }) }), (0, jsx_runtime_1.jsxs)("tbody", { children: [bhFinalEquity != null && ((0, jsx_runtime_1.jsxs)("tr", { style: { borderBottom: '1px solid rgba(99,102,241,0.08)', opacity: 0.6 }, children: [(0, jsx_runtime_1.jsxs)("td", { style: { padding: '4px 8px', color: '#94a3b8' }, children: [(0, jsx_runtime_1.jsx)("span", { style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', marginRight: 4 } }), "TQQQ B&H"] }), (0, jsx_runtime_1.jsxs)("td", { style: { padding: '4px 8px', color: '#e2e8f0' }, children: ["$", fmt(bhFinalEquity)] }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: bhFinalEquity >= initialCapital ? '#10b981' : '#ef4444' }, children: fmtPct((bhFinalEquity - initialCapital) / initialCapital) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#ef4444' }, children: fmtPct(bhMaxDD) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#94a3b8' }, children: "\u2014" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#94a3b8' }, children: "\u2014" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#94a3b8' }, children: "\u2014" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#94a3b8' }, children: "\u2014" })] })), STRATEGY_IDS.filter(sid => enabledStrategies.has(sid) && results[sid]).map(sid => {
                                            const r = results[sid];
                                            const ret = (r.finalEquity - initialCapital) / initialCapital;
                                            const meta = STRATEGY_META[sid];
                                            return ((0, jsx_runtime_1.jsxs)("tr", { style: { borderBottom: '1px solid rgba(99,102,241,0.08)' }, children: [(0, jsx_runtime_1.jsxs)("td", { style: { padding: '4px 8px' }, children: [(0, jsx_runtime_1.jsx)("span", { style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: meta.color, marginRight: 4 } }), (0, jsx_runtime_1.jsx)("span", { style: { color: meta.color }, children: meta.label })] }), (0, jsx_runtime_1.jsxs)("td", { style: { padding: '4px 8px', color: '#e2e8f0' }, children: ["$", fmt(r.finalEquity)] }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: ret >= 0 ? '#10b981' : '#ef4444' }, children: fmtPct(ret) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#ef4444' }, children: fmtPct(r.maxDrawdown) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#94a3b8' }, children: r.recoveryDays < 0 ? 'N/A' : `${r.recoveryDays}d` }), (0, jsx_runtime_1.jsxs)("td", { style: { padding: '4px 8px', color: '#a5b4fc' }, children: ["$", fmt(r.poolRemaining)] }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#10b981' }, children: r.buyCount }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '4px 8px', color: '#f59e0b' }, children: r.sellCount })] }, sid));
                                        })] })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: {
                    background: 'rgba(15,10,40,0.6)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 8, padding: '12px 14px',
                }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: 0.5 }, children: "CRASH ANALYSIS" }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8 }, children: [STRATEGY_IDS.filter(sid => enabledStrategies.has(sid) && results[sid]).map(sid => {
                                const r = results[sid];
                                const meta = STRATEGY_META[sid];
                                return ((0, jsx_runtime_1.jsxs)("div", { style: {
                                        background: 'rgba(15,10,40,0.5)', border: `1px solid ${meta.color}33`,
                                        borderRadius: 6, padding: '8px 12px', minWidth: 160,
                                    }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: 10, color: meta.color, fontWeight: 600, marginBottom: 6 }, children: meta.label }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: 3 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#64748b' }, children: "Crash Depth" }), (0, jsx_runtime_1.jsxs)("span", { style: { fontSize: 10, color: '#ef4444' }, children: [r.crashDepth.toFixed(1), "%"] })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#64748b' }, children: "Defense Timing" }), (0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#f59e0b' }, children: r.defenseTiming != null ? `Day ${r.defenseTiming}` : '—' })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#64748b' }, children: "Bottom Detection" }), (0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#10b981' }, children: r.bottomDetection != null ? `Day ${r.bottomDetection}` : '—' })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#64748b' }, children: "Recovery Days" }), (0, jsx_runtime_1.jsx)("span", { style: { fontSize: 10, color: '#a5b4fc' }, children: r.recoveryDays < 0 ? 'Not yet' : `${r.recoveryDays}d` })] })] })] }, sid));
                            }), Object.keys(results).length === 0 && ((0, jsx_runtime_1.jsx)("div", { style: { fontSize: 11, color: '#475569', fontStyle: 'italic' }, children: "Enable strategies to see crash analysis" }))] })] })] }));
}
