'use client';
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = VRSurvival;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const recharts_1 = require("recharts");
const HistoricalAnalogPanel_1 = __importDefault(require("./HistoricalAnalogPanel"));
const StrategyLabTab_1 = require("./StrategyLabTab");
const ScenarioEnginePanel_1 = __importDefault(require("./ScenarioEnginePanel"));
const SuggestedPostureStrip_1 = __importDefault(require("./SuggestedPostureStrip"));
const OverlayAlignmentBadge_1 = __importDefault(require("@/components/arena/OverlayAlignmentBadge"));
const MonteCarloOverlayCard_1 = __importDefault(require("@/components/arena/MonteCarloOverlayCard"));
const OverlayScoreStrip_1 = __importDefault(require("@/components/arena/OverlayScoreStrip"));
const buildArenaOverlayDisplayModel_1 = require("@/lib/arena/overlay/buildArenaOverlayDisplayModel");
const build_execution_playback_1 = require("../../../../../../vr/playback/build_execution_playback");
const CycleSummaryCard_1 = __importDefault(require("../../vr/CycleSummaryCard"));
const PLAYBACK_SUITE_GROUP_ORDER = ['Crash Tests', 'Leverage Stress', 'Corrections'];
const TABS = ['Overview', 'Strategy Lab', 'Crash Analysis', 'Backtest', 'Playback', 'Pool Logic', 'Options Overlay', 'Philosophy'];
const HEATMAP_SYMBOLS = ['TQQQ', 'SOXL', 'TECL', 'SPXL', 'UPRO', 'LABU'];
const STRATEGY_LABELS = {
    buy_hold: 'Buy & Hold',
    ma200_risk_control_50: 'MA200 (50%)',
    ma200_lb30_hybrid: 'MA200 + LB30',
    low_based_lb30: 'LB30',
    low_based_lb25: 'LB25',
    adaptive_exposure: 'Adaptive Exposure',
    original_vr_scaled: 'VR Original (Capped)',
};
const STRATEGY_CHIP_LABELS = {
    buy_hold: 'Buy & Hold',
    ma200_risk_control_50: 'MA200 (50%)',
    ma200_lb30_hybrid: 'MA200 + LB30',
    low_based_lb30: 'LB30',
    low_based_lb25: 'LB25',
    adaptive_exposure: 'Adaptive Exposure',
    original_vr_scaled: 'VR Original (Capped)',
};
const STRATEGY_COLORS = {
    buy_hold: '#9CA3AF',
    ma200_risk_control_50: '#F59E0B',
    ma200_lb30_hybrid: '#C084FC',
    low_based_lb30: '#14B8A6',
    low_based_lb25: '#22D3EE',
    adaptive_exposure: '#10B981',
    original_vr_scaled: '#3B82F6',
};
const ARENA_BACKTEST_TEXT = {
    en: {
        backtest: {
            philosophy: {
                eyebrow: 'Backtest Philosophy',
                title: 'Positioning Map, Not Winner Selection',
                body: [
                    'This backtest is not designed to identify the best strategy.',
                    'Instead, it shows how different approaches are positioned under the same market conditions.',
                    'Each approach reflects a different balance between risk, drawdown, recovery behavior, and psychological stability.',
                    'The warning layer comes before execution. It is designed to flag abnormal downside behavior early, not to auto-trade by itself.',
                ],
                footer: 'Backtest is a map, not the answer.',
            },
            conditions: {
                eyebrow: 'Test Conditions',
                title: 'What This Comparison Is Testing',
                labels: {
                    period: 'Period',
                    asset: 'Asset',
                    execution: 'Execution',
                    purpose: 'Purpose',
                    note: 'Important Note',
                },
                asset: {
                    name: 'TQQQ',
                    detail: 'A 3x leveraged Nasdaq-100 ETF with much higher volatility than standard ETFs.',
                },
                execution: 'Signals are evaluated at the close of each trading day and applied on the next trading session. All Arena strategies begin from the same 80% invested / 20% cash allocation.',
                purpose: 'This comparison is intended to show positioning differences, not to determine a superior strategy.',
                note: 'Leveraged ETFs amplify both gains and losses, which can lead to large drawdowns and rapid rebounds.',
                marketContextByEventId: {
                    '2008-crash': 'A prolonged global deleveraging period tied to the credit crisis.',
                    '2011-debt-crisis': 'US downgrade stress and Eurozone instability created a sharp risk-off phase.',
                    '2018-volmageddon': 'A volatility shock and rapid deleveraging event hit leveraged Nasdaq exposure.',
                    '2020-covid-crash': 'Pandemic panic and policy shock created a historic crash followed by a violent rebound.',
                    '2022-bear-market': 'A prolonged bearish market with rising rates and persistent inflation pressure.',
                    '2024-yen-carry': 'A fast unwind in crowded risk positioning produced a sharp selloff and rebound.',
                    '2025-tariff': 'This period reflects tariff-related uncertainty and policy-driven volatility. Markets experienced intermittent drawdowns, uneven recoveries, and elevated sensitivity to macro and geopolitical signals.',
                },
                purposeByEventId: {
                    '2025-tariff': 'To observe how different approaches behave under non-linear, macro-driven stress conditions.',
                },
            },
            summary: {
                adaptive: {
                    title: 'Adaptive Exposure',
                    fallback: 'Featured advanced defensive approach',
                },
                lb30: {
                    title: 'LB30',
                    detail: 'Default low-based recovery | Slower re-risking, lower flip-flop',
                },
                ma200: {
                    title: 'MA200 (50%)',
                    detail: 'Psychological stability reference | Simpler, slower response',
                },
                hybrid: {
                    title: 'MA200 + LB30',
                    detail: 'MA200 defense with low-based recovery | Hybrid reference',
                },
                vr: {
                    title: 'VR Original (Capped)',
                    detail: 'Original VR reference | Core comparison baseline from the VR family',
                },
            },
        },
        strategy: {
            buy_hold: 'Starts with 80% invested in TQQQ and keeps a permanent 20% cash reserve. It does not rebalance, defend, or re-enter, so it serves as the plain market baseline under the shared Arena allocation.',
            ma200_risk_control: 'Starts from the shared 80 / 20 Arena allocation, moves to cash below the 200-day moving average, and restores to the 80% invested cap above it. This is a stricter research reference, not the main anchor for this page.',
            ma200_risk_control_50: 'Starts from the shared 80 / 20 Arena allocation, reduces exposure to 50% when price falls below the 200-day moving average, and restores to the 80% invested cap when price recovers above it. Its primary purpose is psychological stability, helping investors stay invested during large drawdowns. This is a familiar reference approach, not a return-maximizing strategy.',
            ma200_risk_control_50_early_rebuy: 'A traditional MA200-based defensive approach with an optional early re-entry feature. After reducing exposure below the 200-day moving average, a partial re-entry is triggered if price rebounds significantly from the local low. This helps reduce delayed re-entry during recovery phases while keeping the MA200 framework intact.',
            ma200_lb30_hybrid: 'Uses a simple MA200 defense on the way down, then re-adds risk through the LB30 low-based rebound ladder instead of waiting for a full MA200-only recovery.',
            fixed_stop_loss: 'A hard stop-based defensive rule that exits after a deep instrument drawdown and waits for a cleaner re-entry setup.',
            low_based_lb30: 'Default low-based recovery approach. It keeps the existing Adaptive downside evidence, caps the deepest defense at 40% invested, and re-adds risk through slower 30% / 40% / 50%-or-MA200 rebound steps.',
            low_based_lb25: 'Bear-market reference version of the low-based recovery ladder. It uses the same downside evidence, but re-enters a bit earlier with 25% / 35% / 45%-or-MA200 rebound steps.',
            adaptive_exposure: 'Adaptive keeps the current evidence-based defensive ladder unchanged. In Arena, it is used as the fast-recovery and V-shape reference rather than the default low-based recovery model.',
            adaptive_exposure_fast_reentry: 'Experimental variant of Adaptive Exposure with a faster rebound step from 25% back to 50%.',
            adaptive_exposure_relaxed_reentry: 'Experimental variant of Adaptive Exposure with a looser condition for returning from 50% back to the 80% Arena cap.',
            adaptive_exposure_step_reentry: 'Experimental variant of Adaptive Exposure that re-risks in smaller staged steps.',
            original_vr_scaled: 'Original VR reference that reuses archive VR defense and Vmin-buy intent on the Arena-local TQQQ path. Vmin-triggered rebuys are constrained by a 50% per-cycle capital cap and a permanent 20% cash floor, making it a controlled baseline rather than an unbounded averaging system.',
        },
    },
};
const BACKTEST_COPY = ARENA_BACKTEST_TEXT.en;
const ARENA_TOOLTIP_ORDER = [
    'buy_hold',
    'original_vr_scaled',
    'ma200_risk_control_50',
    'ma200_lb30_hybrid',
    'low_based_lb30',
    'low_based_lb25',
    'adaptive_exposure',
];
const STRATEGY_SERIES_KEYS = {
    buy_hold: {
        equity: 'buy_hold_equity',
        drawdown: 'buy_hold_drawdown',
        exposure: 'buy_hold_exposure',
    },
    ma200_risk_control_50: {
        equity: 'ma200_risk_control_50_equity',
        drawdown: 'ma200_risk_control_50_drawdown',
        exposure: 'ma200_risk_control_50_exposure',
    },
    ma200_lb30_hybrid: {
        equity: 'ma200_lb30_hybrid_equity',
        drawdown: 'ma200_lb30_hybrid_drawdown',
        exposure: 'ma200_lb30_hybrid_exposure',
    },
    low_based_lb30: {
        equity: 'low_based_lb30_equity',
        drawdown: 'low_based_lb30_drawdown',
        exposure: 'low_based_lb30_exposure',
    },
    low_based_lb25: {
        equity: 'low_based_lb25_equity',
        drawdown: 'low_based_lb25_drawdown',
        exposure: 'low_based_lb25_exposure',
    },
    adaptive_exposure: {
        equity: 'adaptive_exposure_equity',
        drawdown: 'adaptive_exposure_drawdown',
        exposure: 'adaptive_exposure_exposure',
    },
    original_vr_scaled: {
        equity: 'original_vr_scaled_equity',
        drawdown: 'original_vr_scaled_drawdown',
        exposure: 'original_vr_scaled_exposure',
    },
};
const STRATEGY_SETUP_NOTES = {
    buy_hold: BACKTEST_COPY.strategy.buy_hold,
    ma200_risk_control_50: BACKTEST_COPY.strategy.ma200_risk_control_50,
    ma200_lb30_hybrid: BACKTEST_COPY.strategy.ma200_lb30_hybrid,
    low_based_lb30: BACKTEST_COPY.strategy.low_based_lb30,
    low_based_lb25: BACKTEST_COPY.strategy.low_based_lb25,
    adaptive_exposure: BACKTEST_COPY.strategy.adaptive_exposure,
    original_vr_scaled: BACKTEST_COPY.strategy.original_vr_scaled,
};
function formatAdaptiveTransitionSummary(transitions) {
    return transitions
        .map((transition) => `${transition.from_exposure}->${transition.to_exposure} ${transition.date} (${transition.reason})`)
        .join('; ');
}
function formatAdaptiveExplainability(report) {
    if (!report)
        return '';
    const visibleTransitionKeys = new Set(report.visible_transitions.map((transition) => `${transition.date}|${transition.from_exposure}|${transition.to_exposure}|${transition.reason}`));
    const earlierTransitions = report.full_transitions.filter((transition) => !visibleTransitionKeys.has(`${transition.date}|${transition.from_exposure}|${transition.to_exposure}|${transition.reason}`));
    return [
        `Visible start posture: ${report.initial_state.exposure}% (${report.initial_state.reason}).`,
        earlierTransitions.length
            ? `Earlier full-series transitions: ${formatAdaptiveTransitionSummary(earlierTransitions)}.`
            : 'No earlier full-series transitions before the visible window.',
        report.visible_transitions.length
            ? `Visible-window transitions: ${formatAdaptiveTransitionSummary(report.visible_transitions)}.`
            : 'No exposure transitions inside the visible window.',
    ].join(' ');
}
function formatStrategyExplainability(report) {
    if (!report)
        return '';
    const transitionSummary = (transitions) => transitions
        .map((transition) => `${transition.from_exposure}->${transition.to_exposure} ${transition.date} (${transition.reason})`)
        .join('; ');
    return [
        `Visible start posture: ${report.initial_state.exposure}% (${report.initial_state.reason}).`,
        report.visible_transitions.length
            ? `Visible-window transitions: ${transitionSummary(report.visible_transitions)}.`
            : 'No exposure transitions inside the visible window.',
    ].join(' ');
}
function formatWarningExplainability(report) {
    if (!report)
        return '';
    const visibleTransitionSummary = report.visible_transitions
        .map((transition) => `${transition.from_state} → ${transition.to_state} ${transition.date}`)
        .join('; ');
    return [
        `Current warning state: ${formatWarningStateLabel(report.warning_state)}.`,
        `Reason: ${report.warning_reason}`,
        `Scenario hint: ${report.scenario_hint}.`,
        report.visible_transitions.length
            ? `Visible-window state changes: ${visibleTransitionSummary}.`
            : 'No warning-state transitions inside the visible window.',
        'This system detects abnormal downside behavior before executing defensive actions.',
        'Warning does not equal trading.',
    ].join(' ');
}
function warningStateTone(state) {
    switch (state) {
        case 'NORMAL':
            return '#94a3b8';
        case 'WATCH':
            return '#fbbf24';
        case 'ALERT':
            return '#fb923c';
        case 'DEFENSE_READY':
            return '#f97316';
        case 'DEFENSE_ACTIVE':
            return '#ef4444';
        case 'RECOVERY_MODE':
            return '#10b981';
        default:
            return '#cbd5e1';
    }
}
function formatOptionalPercent(value) {
    if (value == null || Number.isNaN(value))
        return 'n/a';
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}
function formatWarningStateLabel(value) {
    return value.split('_').join(' ');
}
function panelStyle(extra) {
    return {
        background: 'linear-gradient(180deg, rgba(8,12,22,0.94), rgba(9,11,17,0.98))',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        padding: '1.35rem 1.45rem',
        boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
        ...extra,
    };
}
function tabStyle(active) {
    return {
        padding: '0.65rem 1rem',
        borderRadius: 999,
        border: active ? '1px solid rgba(148,163,184,0.3)' : '1px solid rgba(255,255,255,0.08)',
        background: active ? 'rgba(148,163,184,0.16)' : 'rgba(255,255,255,0.03)',
        color: active ? '#f8fafc' : '#94a3b8',
        fontSize: '0.9rem',
        fontWeight: 700,
        cursor: 'pointer',
    };
}
function SectionHeader({ eyebrow, title, note, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 14,
        }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [eyebrow ? ((0, jsx_runtime_1.jsx)("div", { style: {
                            color: '#64748b',
                            fontSize: '0.72rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.12em',
                            marginBottom: 4,
                        }, children: eyebrow })) : null, (0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1.08rem', fontWeight: 800 }, children: title })] }), note ? (0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.8rem', maxWidth: 460, lineHeight: 1.55 }, children: note }) : null] }));
}
function PlaceholderCard({ label, text, detail, compact, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
            padding: compact ? '0.8rem 0.9rem' : '1rem',
            minHeight: compact ? 96 : 132,
        }, children: [(0, jsx_runtime_1.jsx)("div", { style: {
                    fontSize: '0.71rem',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                }, children: label }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#e5e7eb', fontSize: compact ? '0.96rem' : '1rem', fontWeight: 700, marginTop: compact ? 8 : 10 }, children: text }), detail ? (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: compact ? '0.78rem' : '0.82rem', lineHeight: 1.5, marginTop: compact ? 8 : 10 }, children: detail }) : null] }));
}
function PlaceholderSection({ eyebrow, title, note, cards, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: eyebrow, title: title, note: note }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: cards.map((card) => ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: card.label, text: card.text }, card.label))) })] }));
}
function formatDisplayLabel(value) {
    return value
        .split('_')
        .map((part) => (part.toLowerCase() === 'ma200' ? 'MA200' : part.charAt(0).toUpperCase() + part.slice(1)))
        .join(' ');
}
function formatSignedPercent(value) {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}
function formatRecoveryDays(value) {
    return value == null ? 'Not Recovered' : `${value}d`;
}
function formatArenaPeriodRange(start, end) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
    const startValue = new Date(`${start}T00:00:00Z`);
    const endValue = new Date(`${end}T00:00:00Z`);
    return `${formatter.format(startValue)} - ${formatter.format(endValue)}`;
}
function formatArenaDelta(value, suffix = 'pts') {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)} ${suffix}`;
}
function arenaDeltaTone(value) {
    if (value > 0.05)
        return '#10b981';
    if (value < -0.05)
        return '#ef4444';
    return '#94a3b8';
}
function getArenaLineVisuals(strategyKey) {
    if (strategyKey === 'adaptive_exposure') {
        return { strokeWidth: 2.8, strokeOpacity: 1, strokeDasharray: undefined };
    }
    if (strategyKey === 'ma200_risk_control_50') {
        return { strokeWidth: 1.9, strokeOpacity: 0.95, strokeDasharray: '6 4' };
    }
    if (strategyKey === 'ma200_lb30_hybrid') {
        return { strokeWidth: 2.1, strokeOpacity: 0.95, strokeDasharray: '7 3' };
    }
    if (strategyKey === 'low_based_lb30') {
        return { strokeWidth: 2.15, strokeOpacity: 0.98, strokeDasharray: undefined };
    }
    if (strategyKey === 'low_based_lb25') {
        return { strokeWidth: 1.95, strokeOpacity: 0.9, strokeDasharray: '5 3' };
    }
    if (strategyKey === 'buy_hold') {
        return { strokeWidth: 1.9, strokeOpacity: 0.95, strokeDasharray: undefined };
    }
    if (strategyKey === 'original_vr_scaled') {
        return { strokeWidth: 2, strokeOpacity: 0.95, strokeDasharray: '5 3' };
    }
    return { strokeWidth: 1.35, strokeOpacity: 0.58, strokeDasharray: undefined };
}
function BacktestChartTooltip({ active, payload, label, visibleStrategyKeys, metricKind = 'equity', }) {
    if (!active || !payload?.length)
        return null;
    const visibleKeySet = new Set(visibleStrategyKeys);
    const payloadByStrategy = new Map();
    Object.keys(STRATEGY_SERIES_KEYS).forEach((strategyKey) => {
        const seriesKey = STRATEGY_SERIES_KEYS[strategyKey][metricKind];
        const entry = payload.find((item) => item.dataKey === seriesKey);
        if (entry) {
            payloadByStrategy.set(strategyKey, { value: entry.value ?? null, color: entry.color });
        }
    });
    const orderedItems = ARENA_TOOLTIP_ORDER
        .filter((strategyKey) => visibleKeySet.has(strategyKey))
        .map((strategyKey) => ({
        strategyKey,
        entry: payloadByStrategy.get(strategyKey),
    }))
        .filter((item) => item.entry && typeof item.entry.value === 'number');
    if (!orderedItems.length)
        return null;
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            background: '#111827',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '0.75rem 0.85rem',
            minWidth: 200,
        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.84rem', fontWeight: 700, marginBottom: 8 }, children: label }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 6 }, children: orderedItems.map(({ strategyKey, entry }) => ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: '0.79rem' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'inline-flex', alignItems: 'center', gap: 8, color: '#cbd5e1' }, children: [(0, jsx_runtime_1.jsx)("span", { style: {
                                        width: 8,
                                        height: 8,
                                        borderRadius: 999,
                                        background: entry?.color ?? STRATEGY_COLORS[strategyKey],
                                    } }), STRATEGY_CHIP_LABELS[strategyKey]] }), (0, jsx_runtime_1.jsx)("span", { style: { color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }, children: metricKind === 'equity'
                                ? entry?.value?.toFixed(2)
                                : metricKind === 'drawdown'
                                    ? formatSignedPercent(entry?.value ?? 0)
                                    : `${(entry?.value ?? 0).toFixed(0)}%` })] }, strategyKey))) })] }));
}
function CycleStartPanel({ cycleStart, eventId, eventStart, eventEnd, chartData, onApply, }) {
    const [mode, setMode] = (0, react_1.useState)('basic');
    const [applying, setApplying] = (0, react_1.useState)(false);
    const [applyError, setApplyError] = (0, react_1.useState)(null);
    const [initialCapital, setInitialCapital] = (0, react_1.useState)(cycleStart.initial_state?.initial_capital ?? 10000);
    const [stockAllocationPct, setStockAllocationPct] = (0, react_1.useState)(Math.round((cycleStart.initial_state?.stock_allocation_pct ?? 0.8) * 100));
    const [poolAllocationPct, setPoolAllocationPct] = (0, react_1.useState)(Math.round((cycleStart.initial_state?.pool_allocation_pct ?? 0.2) * 100));
    const [simulationStartDate, setSimulationStartDate] = (0, react_1.useState)(cycleStart.simulation_start_date ?? '');
    const [manualStartPrice, setManualStartPrice] = (0, react_1.useState)(cycleStart.initial_state?.start_price ?? 0);
    const [initialAveragePrice, setInitialAveragePrice] = (0, react_1.useState)(cycleStart.initial_state?.initial_average_price ?? 0);
    const [initialShareCount, setInitialShareCount] = (0, react_1.useState)(cycleStart.initial_state?.initial_share_count ?? 0);
    const [initialPoolCash, setInitialPoolCash] = (0, react_1.useState)(cycleStart.initial_state?.initial_pool_cash ?? 0);
    const selectedStartOption = cycleStart.available_start_options.find((option) => option.date === simulationStartDate) ?? cycleStart.available_start_options[0];
    const basicStartPrice = selectedStartOption?.start_price ?? manualStartPrice;
    const derivedShareCount = Math.floor((initialCapital * (stockAllocationPct / 100)) / basicStartPrice);
    const derivedStockCost = Number((derivedShareCount * basicStartPrice).toFixed(2));
    const derivedPoolCash = Number((initialCapital - derivedStockCost).toFixed(2));
    const effectiveInitialState = mode === 'basic'
        ? {
            initial_capital: initialCapital,
            stock_allocation_pct: stockAllocationPct / 100,
            pool_allocation_pct: poolAllocationPct / 100,
            start_price: basicStartPrice,
            initial_share_count: derivedShareCount,
            initial_average_price: basicStartPrice,
            initial_stock_cost: derivedStockCost,
            initial_pool_cash: derivedPoolCash,
        }
        : {
            initial_capital: initialCapital,
            stock_allocation_pct: stockAllocationPct / 100,
            pool_allocation_pct: poolAllocationPct / 100,
            start_price: manualStartPrice || basicStartPrice,
            initial_share_count: initialShareCount,
            initial_average_price: initialAveragePrice,
            initial_stock_cost: Number((initialShareCount * initialAveragePrice).toFixed(2)),
            initial_pool_cash: initialPoolCash,
        };
    const localErrors = [];
    if (!simulationStartDate)
        localErrors.push('Simulation start date is required.');
    if (!(effectiveInitialState.start_price > 0))
        localErrors.push('Start price must be greater than zero.');
    if (!(effectiveInitialState.initial_capital > 0))
        localErrors.push('Initial capital must be greater than zero.');
    if (mode === 'basic' && stockAllocationPct + poolAllocationPct !== 100) {
        localErrors.push('Stock allocation and pool allocation must sum to 100% in Basic Mode.');
    }
    if (effectiveInitialState.initial_pool_cash < 0)
        localErrors.push('Initial pool cash cannot be negative.');
    if (effectiveInitialState.initial_share_count < 0)
        localErrors.push('Initial share count must be zero or greater.');
    const mergedErrors = Array.from(new Set([...(cycleStart.validation.errors ?? []), ...(cycleStart.lookup_error ? [cycleStart.lookup_error] : []), ...localErrors]));
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Cycle Start", title: "Event Initial State", note: "Default warm-up is 150 trading days with an 80 / 20 stock-to-pool split. Advanced overrides are local to this view." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }, children: [(0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setMode('basic'), style: tabStyle(mode === 'basic'), children: "Basic Mode" }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setMode('advanced'), style: tabStyle(mode === 'advanced'), children: "Advanced Mode" })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Simulation Start", text: simulationStartDate || 'Not available', detail: `${cycleStart.default_warmup_trading_days} trading days of effective warm-up before ${cycleStart.event_start_date}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Event Window", text: `${cycleStart.event_start_date} to ${cycleStart.event_end_date}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Start Price Source", text: selectedStartOption
                            ? selectedStartOption.price_source === 'synthetic_tqqq_3x'
                                ? 'Synthetic TQQQ 3x'
                                : 'Real TQQQ'
                            : 'Manual Override', detail: `Ticker ${cycleStart.ticker}` })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }, children: [(0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Initial Capital", (0, jsx_runtime_1.jsx)("input", { type: "number", value: initialCapital, onChange: (event) => setInitialCapital(Number(event.target.value || 0)), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' } })] }), (0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Simulation Start Date", (0, jsx_runtime_1.jsx)("select", { value: simulationStartDate, onChange: (event) => setSimulationStartDate(event.target.value), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }, children: cycleStart.available_start_options.map((option) => ((0, jsx_runtime_1.jsxs)("option", { value: option.date, children: [option.date, " | ", option.price_source === 'synthetic_tqqq_3x' ? 'Synthetic' : 'Real', " | ", option.start_price.toFixed(2)] }, option.date))) })] }), (0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Stock Allocation %", (0, jsx_runtime_1.jsx)("input", { type: "number", value: stockAllocationPct, onChange: (event) => setStockAllocationPct(Number(event.target.value || 0)), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' } })] }), (0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Pool Allocation %", (0, jsx_runtime_1.jsx)("input", { type: "number", value: poolAllocationPct, onChange: (event) => setPoolAllocationPct(Number(event.target.value || 0)), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' } })] })] }), cycleStart.manual_start_price_override_allowed ? ((0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }, children: (0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Manual Start Price Override", (0, jsx_runtime_1.jsx)("input", { type: "number", value: manualStartPrice, onChange: (event) => setManualStartPrice(Number(event.target.value || 0)), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' } })] }) })) : null, mode === 'advanced' ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }, children: [(0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Initial Average Price", (0, jsx_runtime_1.jsx)("input", { type: "number", value: initialAveragePrice, onChange: (event) => setInitialAveragePrice(Number(event.target.value || 0)), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' } })] }), (0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Initial Share Count", (0, jsx_runtime_1.jsx)("input", { type: "number", value: initialShareCount, onChange: (event) => setInitialShareCount(Number(event.target.value || 0)), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' } })] }), (0, jsx_runtime_1.jsxs)("label", { style: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }, children: ["Initial Pool Cash", (0, jsx_runtime_1.jsx)("input", { type: "number", value: initialPoolCash, onChange: (event) => setInitialPoolCash(Number(event.target.value || 0)), style: { background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' } })] })] })) : null, mergedErrors.length ? ((0, jsx_runtime_1.jsxs)("div", { style: {
                    marginBottom: 16,
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.18)',
                    borderRadius: 16,
                    padding: '0.9rem 1rem',
                    display: 'grid',
                    gap: 6,
                }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#fecaca', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Initialization Validation" }), mergedErrors.map((error) => ((0, jsx_runtime_1.jsx)("div", { style: { color: '#fca5a5', fontSize: '0.86rem', lineHeight: 1.5 }, children: error }, error)))] })) : null, (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Start Price", text: effectiveInitialState.start_price.toFixed(2), detail: `Average ${effectiveInitialState.initial_average_price.toFixed(2)}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Initial Shares", text: `${effectiveInitialState.initial_share_count}`, detail: `Stock Cost ${effectiveInitialState.initial_stock_cost.toFixed(2)}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Initial Pool Cash", text: effectiveInitialState.initial_pool_cash.toFixed(2), detail: `Capital ${effectiveInitialState.initial_capital.toFixed(2)}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Allocation", text: `${(effectiveInitialState.stock_allocation_pct * 100).toFixed(0)} / ${(effectiveInitialState.pool_allocation_pct * 100).toFixed(0)}`, detail: "Stock / Pool allocation" }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Cycle Placeholders", text: "Vref / Vmin / Vmax", detail: `cycle_no ${cycleStart.cycle_placeholders.cycle_no ?? 'pending'} | cycle_start ${cycleStart.cycle_placeholders.cycle_start_date ?? 'pending'} | cycle_end ${cycleStart.cycle_placeholders.cycle_end_date ?? 'pending'}` })] }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }, children: (0, jsx_runtime_1.jsx)("button", { type: "button", disabled: applying, onClick: () => {
                        setApplying(true);
                        const base = window.location.pathname;
                        const params = new URLSearchParams(window.location.search);
                        params.set('sim_event', eventId);
                        params.set('event', eventId);
                        params.set('sim_start', simulationStartDate || '');
                        params.set('sim_capital', String(initialCapital));
                        params.set('sim_stock_pct', String(stockAllocationPct));
                        params.set('tab', 'Playback');
                        window.location.href = base + '?' + params.toString();
                    }, style: {
                        padding: '0.55rem 1.4rem',
                        borderRadius: 10,
                        background: applying ? 'rgba(99,102,241,0.45)' : 'rgba(99,102,241,0.85)',
                        color: '#fff',
                        border: 'none',
                        cursor: applying ? 'not-allowed' : 'pointer',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                    }, children: applying ? 'Running...' : 'Apply & Re-run' }) })] }));
}
function CycleFrameworkPanel({ framework }) {
    const snapshot = framework.snapshot;
    const active = framework.active_selection.active_cycle;
    return ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Cycle Engine", title: "Cycle Snapshot Framework", note: "Two-week cycle segmentation, placeholder VR state, trigger log, and chart overlay contract." }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }, children: framework.cycles.map((cycle) => ((0, jsx_runtime_1.jsxs)("div", { style: {
                                ...tabStyle(cycle.is_active_cycle),
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                minWidth: 148,
                                cursor: 'default',
                            }, children: [(0, jsx_runtime_1.jsx)("span", { children: `Cycle ${cycle.cycle_no}` }), (0, jsx_runtime_1.jsxs)("span", { style: { fontSize: '0.72rem', color: cycle.is_active_cycle ? '#e5e7eb' : '#94a3b8' }, children: [cycle.cycle_start_date, " - ", cycle.cycle_end_date] })] }, cycle.cycle_no))) }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Active Cycle", text: active ? `Cycle ${active.cycle_no}` : 'No Active Cycle', detail: active ? `${active.cycle_start_date} - ${active.cycle_end_date}` : 'Playback range did not yield a cycle window.' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Previous Cycle", text: framework.active_selection.previous_cycle ? `Cycle ${framework.active_selection.previous_cycle.cycle_no}` : 'None', detail: framework.active_selection.previous_cycle
                                    ? `${framework.active_selection.previous_cycle.cycle_start_date} - ${framework.active_selection.previous_cycle.cycle_end_date}`
                                    : 'No prior cycle in the replay window.' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Next Cycle", text: framework.active_selection.next_cycle ? `Cycle ${framework.active_selection.next_cycle.cycle_no}` : 'None', detail: framework.active_selection.next_cycle
                                    ? `${framework.active_selection.next_cycle.cycle_start_date} - ${framework.active_selection.next_cycle.cycle_end_date}`
                                    : 'No next cycle in the replay window.' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Overlay Contract", text: `${framework.chart_overlay.cycle_boundary_markers.length} boundaries`, detail: `${framework.chart_overlay.trigger_flags.length} trigger flags | ${framework.chart_overlay.reference_lines.length} reference lines` })] })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Snapshot Table", title: "Active Cycle Snapshot" }), snapshot ? ((0, jsx_runtime_1.jsx)("div", { style: { overflowX: 'auto' }, children: (0, jsx_runtime_1.jsx)("table", { style: { width: '100%', borderCollapse: 'collapse' }, children: (0, jsx_runtime_1.jsx)("tbody", { children: [
                                            ['Cycle No', `${snapshot.cycle_no}`],
                                            ['Cycle Window', snapshot.cycle_window],
                                            ['Vref', snapshot.vref],
                                            ['Vmin', snapshot.vmin],
                                            ['Vmax', snapshot.vmax],
                                            ['Pattern Type', snapshot.pattern_type],
                                            ['MA200 Status', snapshot.ma200_status],
                                            ['Leverage Stress', snapshot.leverage_stress],
                                            ['Recovery Quality', snapshot.recovery_quality],
                                            ['Buy Permission', snapshot.buy_permission],
                                            ['Defense State', snapshot.defense_state],
                                            ['Scenario Bias', snapshot.scenario_bias.join(', ') || 'Pending'],
                                            ['Playbook Bias', snapshot.playbook_bias.join(', ') || 'Pending'],
                                            ['Representative Buy Levels', snapshot.representative_buy_levels.join(' | ') || 'Pending'],
                                            ['Representative Sell Levels', snapshot.representative_sell_levels.join(' | ') || 'Pending'],
                                            ['Key Trigger Notes', snapshot.key_trigger_notes.join(' | ') || 'Pending'],
                                        ].map(([label, value]) => ((0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { style: {
                                                        padding: '0.7rem 0.8rem',
                                                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                        color: '#94a3b8',
                                                        fontSize: '0.8rem',
                                                        width: '34%',
                                                        verticalAlign: 'top',
                                                    }, children: label }), (0, jsx_runtime_1.jsx)("td", { style: {
                                                        padding: '0.7rem 0.8rem',
                                                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                        color: '#e5e7eb',
                                                        fontSize: '0.85rem',
                                                        lineHeight: 1.55,
                                                    }, children: value })] }, label))) }) }) })) : ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Active Cycle Snapshot", text: "No cycle snapshot available" }))] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Trigger Log", title: "Diagnostic Trigger Events" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 8 }, children: framework.trigger_log.slice(0, 6).map((item) => ((0, jsx_runtime_1.jsxs)("div", { style: {
                                                border: '1px solid rgba(255,255,255,0.06)',
                                                borderRadius: 14,
                                                padding: '0.8rem 0.9rem',
                                                background: 'rgba(255,255,255,0.02)',
                                            }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.86rem', fontWeight: 700 }, children: item.title }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.78rem', marginTop: 4 }, children: [item.timestamp, " | Cycle ", item.cycle_no, " | ", formatDisplayLabel(item.event_type)] }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5, marginTop: 6 }, children: item.message })] }, `${item.timestamp}-${item.title}`))) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Grid Contract", title: "Representative Grid Placeholders" }), active ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 10 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Representative Buy Grid", text: active.representative_buy_grid.length ? active.representative_buy_grid.map((level) => `${level.level_no}:${level.price.toFixed(2)}`).join(' | ') : 'Pending' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Representative Sell Grid", text: active.representative_sell_grid.length ? active.representative_sell_grid.map((level) => `${level.level_no}:${level.price.toFixed(2)}`).join(' | ') : 'Pending' })] })) : ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Representative Grid", text: "No active cycle selected" }))] })] })] })] }));
}
function deriveVRState(data) {
    const current = data.current;
    const target = data.pool_logic.level_pools.find((item) => item.level === current.level);
    const drawdownVelocity = current.dd_pct <= -12 || current.components.dd >= 12 ? 3 :
        current.dd_pct <= -8 || current.components.dd >= 6 ? 2 :
            current.dd_pct <= -4 || current.components.dd >= 2 ? 1 : 0;
    const trendFailure = current.price < current.ma200 ? 3 :
        current.price < current.ma50 || current.days_below_ma200 > 0 ? 2 :
            current.price / current.ma200 < 1.04 ? 1 : 0;
    const volatilityExpansion = current.vol_pct >= 85 || current.components.vol >= 18 ? 3 :
        current.vol_pct >= 70 || current.components.vol >= 12 ? 2 :
            current.vol_pct >= 55 || current.components.vol >= 6 ? 1 : 0;
    const reboundFailure = current.shock_cooldown > 0 || (current.survival_active && current.pool_pct >= 75) ? 3 :
        current.price < current.ma50 && current.dd_pct <= -6 ? 2 :
            current.pool_pct > 0 || current.survival_active ? 1 : 0;
    const fragilityScore = drawdownVelocity + trendFailure + volatilityExpansion + reboundFailure;
    const fragilityState = fragilityScore >= 9 ? 'Breakdown Risk' :
        fragilityScore >= 6 ? 'Fragile' :
            fragilityScore >= 3 ? 'Weak' : 'Stable';
    const eventState = current.state.toUpperCase() === 'SHOCK' || current.shock_cooldown > 0 || (current.dd_pct <= -10 && current.vol_pct >= 75)
        ? 'Crash Event'
        : current.dd_pct <= -5 || current.vol_pct >= 65 || current.components.dd >= 3
            ? 'Stress Event'
            : 'Normal';
    const downsideState = eventState === 'Crash Event'
        ? 'Active Downside'
        : current.pool_pct > 0 && current.exposure_pct > 0 && current.price >= current.ma50
            ? 'Exhaustion Emerging'
            : 'Potential Exhaustion';
    const reentryStatus = downsideState === 'Exhaustion Emerging' && fragilityState !== 'Fragile' && current.days_below_ma200 === 0
        ? 'Recovery Confirming'
        : downsideState !== 'Active Downside' && fragilityState !== 'Breakdown Risk' && current.price >= current.ma50
            ? 'Trial Eligible'
            : 'Not Qualified';
    const phaseMap = eventState === 'Crash Event' && fragilityState === 'Breakdown Risk' ? 'Collapse Phase' :
        eventState === 'Stress Event' && fragilityState === 'Fragile' ? 'Panic Phase' :
            downsideState === 'Potential Exhaustion' ? 'Exhaustion Phase' :
                reentryStatus === 'Trial Eligible' ? 'Recovery Attempt Phase' :
                    reentryStatus === 'Recovery Confirming' ? 'Recovery Confirming Phase' :
                        'Collapse Phase';
    const leveragePosture = reentryStatus === 'Trial Eligible' || reentryStatus === 'Recovery Confirming' ? 'Re-entry Watch' :
        fragilityState === 'Breakdown Risk' ? 'High Risk' :
            fragilityState === 'Fragile' ? 'Defensive Bias' :
                fragilityState === 'Weak' ? 'Caution' : 'Normal';
    const poolGuidance = reentryStatus === 'Trial Eligible' || reentryStatus === 'Recovery Confirming' ? 'Pool may be redeployed selectively' :
        fragilityState === 'Breakdown Risk' ? 'Raise pool aggressively' :
            fragilityState === 'Weak' || fragilityState === 'Fragile' ? 'Raise pool gradually' :
                'Maintain pool';
    const buyAttemptSignal = reentryStatus === 'Recovery Confirming' ? 'Recovery Attempt Active' :
        reentryStatus === 'Trial Eligible' ? 'Limited Buy Attempt Reasonable' :
            downsideState === 'Active Downside' ? 'Avoid Aggressive Buying' :
                'Watch for Exhaustion';
    return {
        current,
        target,
        fragilityState,
        eventState,
        downsideState,
        reentryStatus,
        phaseMap,
        leveragePosture,
        poolGuidance,
        buyAttemptSignal,
        fragilityDrivers: {
            drawdownVelocity,
            trendFailure,
            volatilityExpansion,
            reboundFailure,
        },
    };
}
function classifyHeatmapState(item) {
    if (!item ||
        item.ret_1d == null ||
        item.ret_5d == null ||
        item.ret_20d == null ||
        item.vol_surge == null ||
        item.above_sma50 == null ||
        item.above_sma200 == null) {
        return 'No Data';
    }
    const total = (item.ret_20d <= -20 ? 3 : item.ret_20d <= -10 ? 2 : item.ret_20d <= -4 ? 1 : 0) +
        (item.ret_5d <= -8 || item.ret_1d <= -6 ? 3 : item.ret_5d <= -5 || item.ret_1d <= -3 ? 2 : item.ret_5d <= -2 ? 1 : 0) +
        (item.vol_surge >= 1.6 ? 3 : item.vol_surge >= 1.3 ? 2 : item.vol_surge >= 1.1 ? 1 : 0) +
        (item.above_sma50 === false && item.above_sma200 === false ? 3 : item.above_sma50 === false ? 1 : 0);
    return total >= 9 ? 'Breakdown Risk' : total >= 6 ? 'Fragile' : total >= 3 ? 'Weak' : 'Stable';
}
function heatmapTone(state) {
    if (state === 'Stable') {
        return { border: '1px solid rgba(34,197,94,0.32)', background: 'rgba(34,197,94,0.12)', color: '#86efac' };
    }
    if (state === 'Weak') {
        return { border: '1px solid rgba(250,204,21,0.32)', background: 'rgba(250,204,21,0.12)', color: '#fde68a' };
    }
    if (state === 'Fragile') {
        return { border: '1px solid rgba(249,115,22,0.32)', background: 'rgba(249,115,22,0.12)', color: '#fdba74' };
    }
    if (state === 'Breakdown Risk') {
        return { border: '1px solid rgba(239,68,68,0.32)', background: 'rgba(239,68,68,0.12)', color: '#fca5a5' };
    }
    return { border: '1px solid rgba(100,116,139,0.26)', background: 'rgba(100,116,139,0.1)', color: '#94a3b8' };
}
function playbackStatusTone(status) {
    if (status === 'ready') {
        return { border: '1px solid rgba(34,197,94,0.32)', background: 'rgba(34,197,94,0.12)', color: '#86efac' };
    }
    if (status === 'partial') {
        return { border: '1px solid rgba(250,204,21,0.32)', background: 'rgba(250,204,21,0.12)', color: '#fde68a' };
    }
    return { border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(148,163,184,0.1)', color: '#cbd5e1' };
}
function formatPlaybackStatus(status) {
    if (status === 'ready')
        return 'Ready';
    if (status === 'partial')
        return 'Partial';
    return 'Pending Synthetic';
}
function formatPlaybackToken(value) {
    return value
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
function renderTokenChips(values) {
    return ((0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: values.map((value) => ((0, jsx_runtime_1.jsx)("div", { style: {
                padding: '0.45rem 0.7rem',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: '#cbd5e1',
                fontSize: '0.82rem',
                fontWeight: 700,
            }, children: formatPlaybackToken(value) }, value))) }));
}
function PlaybackChartTooltip({ active, payload, label, resolveByDate, variant = 'execution', }) {
    if (!active || !payload?.length)
        return null;
    if (variant === 'market') {
        const source = payload.find((entry) => entry.payload)?.payload ?? null;
        const title = typeof source?.title === 'string' ? source.title : label;
        return ((0, jsx_runtime_1.jsxs)("div", { style: {
                background: '#111827',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '0.7rem 0.8rem',
            }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.84rem', marginBottom: 6 }, children: title }), label ? (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem', marginBottom: 6 }, children: ["Date: ", label] }) : null, typeof source?.tqqq_price === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["TQQQ Price: ", source.tqqq_price.toFixed(2)] })) : null, typeof source?.ma50 === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["MA50: ", source.ma50.toFixed(2)] })) : null, typeof source?.ma200 === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["MA200: ", source.ma200.toFixed(2)] })) : null, typeof source?.value === 'number' && typeof source?.title === 'string' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: [source.title, ": ", source.value.toFixed(2)] })) : null] }));
    }
    if (variant === 'evaluation_compare') {
        const source = payload.find((entry) => entry.payload)?.payload ?? null;
        const originalEval = typeof source?.original_evaluation_value === 'number' ? source.original_evaluation_value : null;
        const scenarioEval = typeof source?.scenario_evaluation_value === 'number' ? source.scenario_evaluation_value : null;
        const delta = originalEval != null && scenarioEval != null ? scenarioEval - originalEval : null;
        return ((0, jsx_runtime_1.jsxs)("div", { style: {
                background: '#111827',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '0.7rem 0.8rem',
                minWidth: 180,
            }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.84rem', fontWeight: 700, marginBottom: 6 }, children: typeof source?.date === 'string' ? source.date : label }), originalEval != null ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Original VR (Playback): ", originalEval.toFixed(2)] })) : null, scenarioEval != null ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#34d399', fontSize: '0.72rem' }, children: ["Scenario VR: ", scenarioEval.toFixed(2)] })) : null, delta != null ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: delta >= 0 ? '#34d399' : '#f87171', fontSize: '0.72rem', marginTop: 4, fontWeight: 600 }, children: [delta >= 0 ? '+' : '', delta.toFixed(2)] })) : null] }));
    }
    if (variant === 'portfolio_compare' || variant === 'pool_compare') {
        const source = payload.find((entry) => entry.payload)?.payload ?? null;
        const originalKey = variant === 'portfolio_compare' ? 'original_portfolio_value' : 'original_pool_remaining';
        const scenarioKey = variant === 'portfolio_compare' ? 'scenario_portfolio_value' : 'scenario_pool_remaining';
        const originalValue = typeof source?.[originalKey] === 'number' ? source[originalKey] : null;
        const scenarioValue = typeof source?.[scenarioKey] === 'number' ? source[scenarioKey] : null;
        return ((0, jsx_runtime_1.jsxs)("div", { style: {
                background: '#111827',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '0.7rem 0.8rem',
            }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.84rem', marginBottom: 6 }, children: label }), typeof originalValue === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Original VR (Playback): ", originalValue.toFixed(2)] })) : null, typeof scenarioValue === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Scenario VR: ", scenarioValue.toFixed(2)] })) : null] }));
    }
    const source = payload.find((entry) => entry.payload)?.payload ?? resolveByDate?.(label) ?? null;
    const displayDate = typeof source?.date === 'string' ? source.date : typeof label === 'string' ? label : null;
    const title = typeof source?.title === 'string' ? source.title : displayDate;
    const reason = typeof source?.reason === 'string' ? source.reason : null;
    const closeValue = typeof source?.asset_price === 'number' ? source.asset_price : typeof source?.price === 'number' ? source.price : null;
    const evaluationValue = typeof source?.evaluation_value === 'number' ? source.evaluation_value : null;
    const totalPortfolioValue = typeof source?.portfolio_value === 'number'
        ? source.portfolio_value
        : typeof source?.total_portfolio_value === 'number'
            ? source.total_portfolio_value
            : typeof evaluationValue === 'number' && typeof source?.pool_cash_after_trade === 'number'
                ? evaluationValue + source.pool_cash_after_trade
                : null;
    const vrefEval = typeof source?.vref_eval === 'number' ? source.vref_eval : null;
    const vminEval = typeof source?.vmin_eval === 'number' ? source.vmin_eval : null;
    const vmaxEval = typeof source?.vmax_eval === 'number' ? source.vmax_eval : null;
    const markerType = typeof source?.marker_type === 'string' ? source.marker_type : null;
    const shareDelta = typeof source?.share_delta === 'number' ? source.share_delta : null;
    const blockedLevelNo = typeof source?.blocked_level_no === 'number' ? source.blocked_level_no : null;
    const triggerSource = typeof source?.trigger_source === 'string' ? source.trigger_source : null;
    const ladderLevelHit = typeof source?.ladder_level_hit === 'number' ? source.ladder_level_hit : null;
    const sellGateOpen = typeof source?.sell_gate_open === 'boolean' ? source.sell_gate_open : null;
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            background: '#111827',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: '0.7rem 0.8rem',
        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.84rem', marginBottom: 6 }, children: title }), reason ? (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.72rem', marginBottom: 6 }, children: reason }) : null, typeof source?.cycle_no === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem', marginTop: 6 }, children: ["Cycle: ", source.cycle_no] })) : null, typeof source?.day_in_cycle === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Day In Cycle: ", source.day_in_cycle] })) : null, displayDate ? (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Date: ", displayDate] }) : null, typeof closeValue === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Close: ", closeValue.toFixed(2)] })) : null, typeof source?.shares_after_trade === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Shares After: ", source.shares_after_trade] })) : null, typeof evaluationValue === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Evaluation Value: ", evaluationValue.toFixed(2)] })) : null, typeof source?.avg_cost_after_trade === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Avg Cost After: ", source.avg_cost_after_trade.toFixed(2)] })) : null, typeof source?.pool_cash_after_trade === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Pool Cash: ", source.pool_cash_after_trade.toFixed(2)] })) : null, typeof totalPortfolioValue === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Total Portfolio Value: ", totalPortfolioValue.toFixed(2)] })) : null, typeof vrefEval === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Vref Eval: ", vrefEval.toFixed(2)] })) : null, typeof vminEval === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Vmin Eval: ", vminEval.toFixed(2)] })) : null, typeof vmaxEval === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Vmax Eval: ", vmaxEval.toFixed(2)] })) : null, typeof source?.cycle_pool_used_pct === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Cycle Pool Used: ", source.cycle_pool_used_pct.toFixed(1), "%"] })) : null, triggerSource ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Trigger Source: ", formatPlaybackToken(triggerSource)] })) : null, typeof ladderLevelHit === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Ladder Level: L", ladderLevelHit] })) : null, typeof sellGateOpen === 'boolean' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["Sell Gate Open: ", sellGateOpen ? 'Yes' : 'No'] })) : null, markerType === 'buy' && typeof shareDelta === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#34d399', fontSize: '0.72rem' }, children: ["Buy Executed: +", shareDelta, " shares"] })) : null, markerType === 'sell' && typeof shareDelta === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#f59e0b', fontSize: '0.72rem' }, children: ["Sell Executed: ", shareDelta, " shares"] })) : null, markerType === 'defense' && typeof shareDelta === 'number' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#ef4444', fontSize: '0.72rem' }, children: ["Defense Reduction: ", shareDelta, " shares"] })) : null, markerType === 'cap_block' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#a78bfa', fontSize: '0.72rem' }, children: ["Blocked Buy", typeof blockedLevelNo === 'number' ? `: level ${blockedLevelNo}` : '', " due to cycle cap"] })) : null, typeof source?.state_after_trade === 'string' ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.72rem' }, children: ["State After: ", source.state_after_trade] })) : null] }));
}
function collectNumericValues(values) {
    return values.filter((value) => typeof value === 'number' && Number.isFinite(value));
}
function buildAxisDomain(values, paddingRatio = 0.08) {
    const numericValues = collectNumericValues(values);
    if (!numericValues.length)
        return ['auto', 'auto'];
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const span = Math.max(max - min, Math.abs(max) * paddingRatio, 1);
    const padding = span * paddingRatio;
    return [Number((min - padding).toFixed(2)), Number((max + padding).toFixed(2))];
}
function quantile(sortedValues, q) {
    if (!sortedValues.length)
        return 0;
    if (sortedValues.length === 1)
        return sortedValues[0];
    const index = (sortedValues.length - 1) * q;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper)
        return sortedValues[lower];
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
function buildFocusedAxisDomain(values, paddingRatio = 0.04, lowerQuantile = 0.05, upperQuantile = 0.95) {
    const numericValues = collectNumericValues(values).sort((a, b) => a - b);
    if (!numericValues.length)
        return ['auto', 'auto'];
    const focusedMin = quantile(numericValues, lowerQuantile);
    const focusedMax = quantile(numericValues, upperQuantile);
    const span = Math.max(focusedMax - focusedMin, 1);
    const padding = span * paddingRatio;
    return [Number((focusedMin - padding).toFixed(2)), Number((focusedMax + padding).toFixed(2))];
}
function buildDateAxisTicks(dates, cycleBoundaryDates) {
    if (!dates.length)
        return [];
    const tickSet = new Set([dates[0], dates[dates.length - 1]]);
    cycleBoundaryDates.forEach((date) => {
        if (dates.includes(date))
            tickSet.add(date);
    });
    return dates.filter((date) => tickSet.has(date));
}
function sortByDateAsc(rows) {
    return [...rows].sort((left, right) => left.date.localeCompare(right.date));
}
function formatAxisDateTick(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match)
        return date;
    return `${match[1].slice(2)}-${match[2]}-${match[3]}`;
}
function toChartTimestamp(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match)
        return Number.NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
function mapRowsWithTimestamp(rows) {
    return rows.map((row) => ({
        ...row,
        date_ts: toChartTimestamp(row.date),
    }));
}
function toTimestampOrNull(date) {
    if (!date)
        return null;
    const ts = toChartTimestamp(date);
    return Number.isFinite(ts) ? ts : null;
}
function PlaybackExplorerPanel({ playbackData }) {
    const events = playbackData?.events ?? [];
    const groupedEvents = PLAYBACK_SUITE_GROUP_ORDER.map((group) => ({
        group,
        items: events.filter((event) => event.suite_group === group),
    })).filter((group) => group.items.length > 0);
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Playback Explorer", title: "Curated VR Test Suite", note: "Playback is a focused strategy research suite: crash tests, leverage stress cases, and corrections." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: {
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 16,
                            padding: '1rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                        }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 6 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }, children: events.length ? `${events.length} curated playback cases` : 'Playback archive not available' }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.86rem', lineHeight: 1.55 }, children: playbackData?.archive_event_count
                                            ? `${playbackData.archive_event_count} raw archive events remain in the data layer, but the main UI now focuses on the curated VR test suite.`
                                            : 'Open the playback explorer to compare current structure against curated historical leverage cases.' })] }), (0, jsx_runtime_1.jsx)("a", { href: "/vr-survival?tab=Playback", style: {
                                    ...tabStyle(false),
                                    textDecoration: 'none',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                }, children: "Open Playback Explorer" })] }), groupedEvents.length ? ((0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 12 }, children: groupedEvents.map((group) => ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 10 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: group.group }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: group.items.map((event) => ((0, jsx_runtime_1.jsxs)("a", { href: `/vr-survival?tab=Playback&event=${event.suite_id}`, style: {
                                            textDecoration: 'none',
                                            color: 'inherit',
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: 16,
                                            padding: '1rem',
                                            display: 'grid',
                                            gap: 8,
                                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.95rem', fontWeight: 800 }, children: event.name }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.8rem', lineHeight: 1.5 }, children: event.suite_note }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.72rem' }, children: event.archive_name })] }, event.id))) })] }, group.group))) })) : null] })] }));
}
function MethodologyPanel() {
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Methodology", title: "How The VR Engine Works", note: "Interpretation only. The engine summarizes risk structure, historical analogs, scenarios, and posture without forecasting exact outcomes." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Market Data", text: "Internal DB State", detail: "QQQ, TQQQ, MA200 relation, volatility regime, drawdown depth, and rebound behavior." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Pattern Detection", text: "Pattern Memory", detail: "Current structure is matched against the VR pattern library using deterministic rule scoring." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Historical Analogs", text: "Tagged Cases", detail: "The engine compares current conditions against curated VR-tagged historical events." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Scenario Engine", text: "Path Monitoring", detail: "Scenario branches highlight downside risk, neutral monitoring, and recovery-attempt paths." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Posture Messaging", text: "Executive Summary", detail: "Suggested posture compresses the current structure into high-signal, non-deterministic guidance." })] })] }));
}
function OverviewTab({ data, patternDashboard, playbackData, }) {
    const vr = deriveVRState(data);
    return ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle({ borderColor: 'rgba(56,189,248,0.2)' }), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Current State", title: "Current Market Snapshot", note: "DB-backed market state, pattern match, and scenario posture summary for the current leveraged ETF regime." }), patternDashboard?.snapshot ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Market Pattern", text: patternDashboard.snapshot.market_pattern, detail: `As of ${patternDashboard.snapshot.as_of_date}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Nasdaq Drawdown", text: patternDashboard.snapshot.nasdaq_drawdown }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "TQQQ Drawdown", text: patternDashboard.snapshot.tqqq_drawdown }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "MA200 Status", text: patternDashboard.snapshot.ma200_status }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Market Structure", text: patternDashboard.snapshot.market_structure }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Volatility", text: patternDashboard.snapshot.volatility_regime })] }), patternDashboard.snapshot.recommended_posture.length ? ((0, jsx_runtime_1.jsxs)("div", { style: {
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    borderRadius: 16,
                                    padding: '1rem',
                                }, children: [(0, jsx_runtime_1.jsx)("div", { style: {
                                            fontSize: '0.71rem',
                                            color: '#94a3b8',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.08em',
                                            marginBottom: 10,
                                        }, children: "Recommended Posture" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 8 }, children: patternDashboard.snapshot.recommended_posture.slice(0, 3).map((item) => ((0, jsx_runtime_1.jsx)("div", { style: { color: '#e5e7eb', fontSize: '0.95rem', fontWeight: 700 }, children: item }, item))) })] })) : null, (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [(0, jsx_runtime_1.jsx)("a", { href: "/vr-survival", style: { ...tabStyle(false), textDecoration: 'none' }, children: "View Closest Patterns" }), (0, jsx_runtime_1.jsx)("a", { href: "/vr-survival", style: { ...tabStyle(false), textDecoration: 'none' }, children: "Open Historical Analog" }), (0, jsx_runtime_1.jsx)("a", { href: "/vr-survival", style: { ...tabStyle(false), textDecoration: 'none' }, children: "View Scenario Playbook" })] })] })) : ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Market Pattern", text: "Not Classified Yet" }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Snapshot", text: "Current market snapshot not available" })] }))] }), (0, jsx_runtime_1.jsx)(SuggestedPostureStrip_1.default, { message: patternDashboard?.posture_message }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Pattern Memory", title: "Closest Pattern Matches", note: "Current-market historical analogs from the VR pattern engine." }), patternDashboard?.top_matches.length ? ((0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }, children: patternDashboard.top_matches.slice(0, 3).map((match) => ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: match.pattern_name, text: match.score.toFixed(2), detail: match.explanation?.join(' | ') ?? 'Historical analog overlap only.' }), (0, jsx_runtime_1.jsx)("a", { href: "/vr-survival", style: { color: '#94a3b8', fontSize: '0.8rem', textDecoration: 'none', paddingLeft: 4 }, children: "View in Playback" })] }, match.pattern_id))) })) : ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Closest Pattern Matches", text: "No pattern analog available yet" }))] }), (0, jsx_runtime_1.jsx)(HistoricalAnalogPanel_1.default, { analogs: patternDashboard?.historical_analogs }), (0, jsx_runtime_1.jsx)(ScenarioEnginePanel_1.default, { scenarios: patternDashboard?.scenarios ?? [], suggested_posture: patternDashboard?.suggested_posture, historical_analogs: patternDashboard?.historical_analogs }), (0, jsx_runtime_1.jsx)(PlaybackExplorerPanel, { playbackData: playbackData }), (0, jsx_runtime_1.jsx)(MethodologyPanel, {}), (0, jsx_runtime_1.jsx)("div", { style: {
                    ...panelStyle(),
                    paddingTop: '1rem',
                    color: '#94a3b8',
                    fontSize: '0.84rem',
                    lineHeight: 1.65,
                }, children: vr.current.explain })] }));
}
function PlaybackTab({ playbackData, initialPlaybackEventId, }) {
    const events = playbackData?.events ?? [];
    const initialEvent = (initialPlaybackEventId
        ? events.find((event) => event.suite_id === initialPlaybackEventId ||
            event.event_id === initialPlaybackEventId ||
            event.name.startsWith(initialPlaybackEventId) ||
            event.start.startsWith(initialPlaybackEventId))
        : null) ?? events[0];
    const [selId, setSelId] = (0, react_1.useState)(initialEvent?.id ?? '');
    const [cyclePoolCap, setCyclePoolCap] = (0, react_1.useState)(initialEvent?.execution_playback.default_cap_option ?? '50');
    const [variantCache, setVariantCache] = (0, react_1.useState)({});
    const [playbackLayer, setPlaybackLayer] = (0, react_1.useState)('cycle');
    const [dailyWindowMode, setDailyWindowMode] = (0, react_1.useState)('auto_focus');
    const [executionMode, setExecutionMode] = (0, react_1.useState)('scenario');
    const [cursorMode, setCursorMode] = (0, react_1.useState)('daily');
    const [lockedCursorDate, setLockedCursorDate] = (0, react_1.useState)(null);
    const [hoveredCursorDate, setHoveredCursorDate] = (0, react_1.useState)(null);
    const [hoveredExecutionPayload, setHoveredExecutionPayload] = (0, react_1.useState)(null);
    const [hoveredComparisonPayload, setHoveredComparisonPayload] = (0, react_1.useState)(null);
    const [selectedCycleNo, setSelectedCycleNo] = (0, react_1.useState)(null);
    const [executionOverride, setExecutionOverride] = (0, react_1.useState)(null);
    const selected = events.find((event) => event.id === selId) ?? events[0];
    const groupedEvents = PLAYBACK_SUITE_GROUP_ORDER.map((group) => ({
        group,
        items: events.filter((event) => event.suite_group === group),
    })).filter((group) => group.items.length > 0);
    (0, react_1.useEffect)(() => {
        setCyclePoolCap(selected.execution_playback.default_cap_option);
        setPlaybackLayer('cycle');
        setDailyWindowMode('auto_focus');
        setExecutionMode('scenario');
        setCursorMode('daily');
        setLockedCursorDate(null);
        setHoveredCursorDate(null);
        setHoveredExecutionPayload(null);
        setHoveredComparisonPayload(null);
        setSelectedCycleNo(null);
        setExecutionOverride(null);
        setVariantCache({});
    }, [selected.id, selected.execution_playback.default_cap_option]);
    (0, react_1.useEffect)(() => {
        if (playbackLayer === 'cycle' && executionMode === 'compare') {
            setExecutionMode('scenario');
        }
    }, [playbackLayer, executionMode]);
    (0, react_1.useEffect)(() => {
        setLockedCursorDate(null);
        setHoveredCursorDate(null);
        setHoveredExecutionPayload(null);
        setHoveredComparisonPayload(null);
    }, [executionMode, dailyWindowMode, cursorMode]);
    // Lazy: compute variant only for the selected cap option
    (0, react_1.useEffect)(() => {
        const ep = selected.execution_playback;
        if (ep.variants[cyclePoolCap] || variantCache[cyclePoolCap])
            return;
        const eventSrc = selected;
        const { variant, comparison } = (0, build_execution_playback_1.buildVariantForCap)(eventSrc, cyclePoolCap);
        setVariantCache((prev) => ({ ...prev, [cyclePoolCap]: { variant, comparison } }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cyclePoolCap, selected.id]);
    if (!selected) {
        return ((0, jsx_runtime_1.jsx)(PlaceholderSection, { eyebrow: "Playback", title: "Historical Playback", note: "Playback archive is not available.", cards: [
                { label: 'Event Selector', text: 'No event archive loaded' },
                { label: 'VR Readiness', text: 'Unavailable' },
            ] }));
    }
    const eventDates = selected.chart_data.filter((point) => point.in_event);
    const x1 = eventDates[0]?.date;
    const x2 = eventDates[eventDates.length - 1]?.date;
    const resolvedActiveCycle = (selectedCycleNo != null
        ? selected.cycle_framework.cycles.find((cycle) => cycle.cycle_no === selectedCycleNo)
        : null) ?? selected.cycle_framework.active_selection.active_cycle;
    const activeCycleHighlight = resolvedActiveCycle
        ? { start_date: resolvedActiveCycle.cycle_start_date, end_date: resolvedActiveCycle.cycle_end_date }
        : selected.cycle_framework.chart_overlay.active_cycle_highlight;
    const activeCycleNo = resolvedActiveCycle?.cycle_no ?? null;
    const _ep = executionOverride?.execution_playback ?? selected.execution_playback;
    const executionVariant = _ep.variants[cyclePoolCap] ??
        variantCache[cyclePoolCap]?.variant ??
        _ep.variants[_ep.default_cap_option];
    // Playback "original" mode always uses the archive replay baseline, not Arena "Original VR (Scaled)".
    const displayedExecutionVariant = executionMode === 'original' ? (executionOverride?.execution_playback ?? selected.execution_playback).original_vr : executionVariant;
    const comparisonView = _ep.comparison_by_cap[cyclePoolCap] ??
        variantCache[cyclePoolCap]?.comparison ??
        _ep.comparison_by_cap[_ep.default_cap_option];
    const marketRows = displayedExecutionVariant.market_chart.rows;
    const cycleBoundaries = displayedExecutionVariant.market_chart.cycle_boundaries;
    const cycleSummaries = displayedExecutionVariant.cycle_summaries;
    const focusWindow = displayedExecutionVariant.focus_window;
    const firstCycleStartDate = selected.cycle_framework.cycles[0]?.cycle_start_date ??
        cycleSummaries[0]?.start_date ??
        displayedExecutionVariant.points.find((pt) => pt.cycle_no != null)?.date ??
        selected.cycle_start.simulation_start_date ??
        displayedExecutionVariant.points[0]?.date ??
        selected.start;
    const fullEventStartDate = firstCycleStartDate;
    const lastMeaningfulExecutionPoint = [...displayedExecutionVariant.points]
        .reverse()
        .find((point) => point.cycle_no != null || point.in_event) ?? null;
    const fullEventEndDate = selected.cycle_framework.cycles[selected.cycle_framework.cycles.length - 1]?.cycle_end_date ??
        cycleSummaries[cycleSummaries.length - 1]?.end_date ??
        lastMeaningfulExecutionPoint?.date ??
        selected.end;
    const resolvedDailyWindow = dailyWindowMode === 'full_event'
        ? { start_date: fullEventStartDate, end_date: fullEventEndDate }
        : focusWindow ?? { start_date: fullEventStartDate, end_date: fullEventEndDate };
    const dailyWindowStartDate = resolvedDailyWindow.start_date;
    const dailyWindowEndDate = resolvedDailyWindow.end_date;
    const isInDailyWindow = (date) => date >= dailyWindowStartDate && date <= dailyWindowEndDate;
    const clipZoneToDailyWindow = (zone) => {
        const start = zone.start_date < dailyWindowStartDate ? dailyWindowStartDate : zone.start_date;
        const end = zone.end_date > dailyWindowEndDate ? dailyWindowEndDate : zone.end_date;
        if (start > end)
            return null;
        return { ...zone, start_date: start, end_date: end };
    };
    const filteredExecutionPoints = sortByDateAsc(displayedExecutionVariant.points.filter((point) => isInDailyWindow(point.date)));
    const filteredComparisonRows = sortByDateAsc(comparisonView.chart_rows.filter((row) => isInDailyWindow(row.date)));
    const filteredBuyMarkers = sortByDateAsc(displayedExecutionVariant.buy_markers.filter((marker) => isInDailyWindow(marker.date)));
    const filteredSellMarkers = sortByDateAsc(displayedExecutionVariant.sell_markers.filter((marker) => isInDailyWindow(marker.date)));
    const filteredDefenseMarkers = sortByDateAsc(displayedExecutionVariant.defense_markers.filter((marker) => isInDailyWindow(marker.date)));
    const filteredPoolCapFlags = sortByDateAsc(displayedExecutionVariant.pool_cap_flags.filter((marker) => isInDailyWindow(marker.date)));
    const filteredScenarioZones = displayedExecutionVariant.scenario_phase_zones
        .filter((zone) => zone.end_date >= dailyWindowStartDate)
        .map((zone) => clipZoneToDailyWindow(zone))
        .filter((zone) => zone != null);
    const filteredRecoveryZones = displayedExecutionVariant.vmin_recovery_attempt_zones
        .map((zone) => clipZoneToDailyWindow(zone))
        .filter((zone) => zone != null);
    const filteredFailedZones = displayedExecutionVariant.failed_recovery_zones
        .map((zone) => clipZoneToDailyWindow(zone))
        .filter((zone) => zone != null);
    const filteredMarketRows = sortByDateAsc(marketRows.filter((row) => isInDailyWindow(row.date)));
    // Daily display starts at the actual event window; cycle overlays share the same boundary.
    const filteredCycleBoundaries = sortByDateAsc(cycleBoundaries.filter((boundary) => isInDailyWindow(boundary.date) &&
        boundary.date >= dailyWindowStartDate));
    const filteredBreachPoints = sortByDateAsc(displayedExecutionVariant.market_chart.breach_points.filter((point) => isInDailyWindow(point.date)));
    const filteredRecoveryMarkers = sortByDateAsc(displayedExecutionVariant.market_chart.recovery_markers.filter((point) => isInDailyWindow(point.date)));
    const dailyEventDates = filteredExecutionPoints.filter((point) => point.in_event).map((point) => point.date);
    const dailyEventWindowStart = dailyEventDates[0] ?? x1;
    const dailyEventWindowEnd = dailyEventDates[dailyEventDates.length - 1] ?? x2;
    const buyMarkerByDate = new Map(filteredBuyMarkers.map((marker) => [marker.date, marker]));
    const sellMarkerByDate = new Map(filteredSellMarkers.map((marker) => [marker.date, marker]));
    const defenseMarkerByDate = new Map(filteredDefenseMarkers.map((marker) => [marker.date, marker]));
    const capBlockMarkerByDate = new Map(filteredPoolCapFlags.map((marker) => [marker.date, marker]));
    const mergedExecutionRows = filteredExecutionPoints.map((point) => {
        const primaryMarker = defenseMarkerByDate.get(point.date) ??
            sellMarkerByDate.get(point.date) ??
            buyMarkerByDate.get(point.date) ??
            capBlockMarkerByDate.get(point.date) ??
            null;
        return {
            ...point,
            title: primaryMarker?.title ?? point.date,
            reason: primaryMarker?.reason ?? point.trade_reason ?? null,
            marker_type: primaryMarker?.marker_type ?? null,
            trigger_source: primaryMarker?.trigger_source ?? null,
            ladder_level_hit: primaryMarker?.ladder_level_hit ?? null,
            sell_gate_open: primaryMarker?.sell_gate_open ?? null,
            share_delta: primaryMarker?.share_delta ?? null,
            blocked_level_no: primaryMarker?.blocked_level_no ?? null,
            buy_marker_eval: buyMarkerByDate.get(point.date)?.evaluation_value ?? null,
            sell_marker_eval: sellMarkerByDate.get(point.date)?.evaluation_value ?? null,
            defense_marker_eval: defenseMarkerByDate.get(point.date)?.evaluation_value ?? null,
            cap_block_marker_eval: capBlockMarkerByDate.get(point.date)?.evaluation_value ?? null,
            buy_marker_portfolio: buyMarkerByDate.get(point.date)?.total_portfolio_value ?? null,
            sell_marker_portfolio: sellMarkerByDate.get(point.date)?.total_portfolio_value ?? null,
            defense_marker_portfolio: defenseMarkerByDate.get(point.date)?.total_portfolio_value ?? null,
        };
    });
    const executionChartRows = mapRowsWithTimestamp(mergedExecutionRows);
    const comparisonChartRows = mapRowsWithTimestamp(filteredComparisonRows);
    const executionDateTicks = buildDateAxisTicks((executionMode === 'compare' ? filteredComparisonRows : mergedExecutionRows).map((row) => row.date), filteredCycleBoundaries.map((boundary) => boundary.date));
    const executionTimestampTicks = executionDateTicks
        .map((date) => ({ date, ts: toChartTimestamp(date) }))
        .filter((entry) => Number.isFinite(entry.ts));
    const executionDateByTimestamp = new Map(executionTimestampTicks.map((entry) => [entry.ts, entry.date]));
    const executionStartTs = executionChartRows[0]?.date_ts;
    const executionEndTs = executionChartRows[executionChartRows.length - 1]?.date_ts;
    const marketDateTicks = buildDateAxisTicks(filteredMarketRows.map((row) => row.date), filteredCycleBoundaries.map((boundary) => boundary.date));
    const avgCyclePoolUsed = cycleSummaries.length > 0
        ? cycleSummaries.reduce((sum, cycle) => sum + cycle.pool_used_pct_in_cycle, 0) / cycleSummaries.length
        : 0;
    const maxCyclePoolUsed = cycleSummaries.length > 0 ? Math.max(...cycleSummaries.map((cycle) => cycle.pool_used_pct_in_cycle)) : 0;
    const activeCycleSummary = cycleSummaries.find((cycle) => cycle.cycle_no === activeCycleNo) ?? cycleSummaries[cycleSummaries.length - 1] ?? null;
    const cycleChartRows = cycleSummaries.map((cycle) => ({
        cycle_label: `C${cycle.cycle_no}`,
        cycle_no: cycle.cycle_no,
        cycle_window: cycle.cycle_window,
        vref_eval: cycle.vref_eval,
        vmin_eval: cycle.vmin_eval,
        vmax_eval: cycle.vmax_eval,
        start_evaluation_value: cycle.start_evaluation_value,
        end_evaluation_value: cycle.end_evaluation_value,
        start_pool_pct: cycle.start_pool_pct,
        end_pool_pct: cycle.end_pool_pct,
        pool_used_pct_in_cycle: cycle.pool_used_pct_in_cycle,
        buy_count: cycle.buy_count,
        sell_count: cycle.sell_count,
        defense_count: cycle.defense_count,
    }));
    const cycleByNo = new Map(selected.cycle_framework.cycles.map((cycle) => [cycle.cycle_no, cycle]));
    const filteredExecutionPointByDate = new Map(mergedExecutionRows.map((point) => [point.date, point]));
    const filteredExecutionPointByTimestamp = new Map(executionChartRows.map((point) => [point.date_ts, point]));
    const filteredComparisonRowByDate = new Map(filteredComparisonRows.map((row) => [row.date, row]));
    const filteredComparisonRowByTimestamp = new Map(comparisonChartRows.map((row) => [row.date_ts, row]));
    const executionPointByDate = new Map(displayedExecutionVariant.points.map((point) => [point.date, point]));
    const resolveExecutionPointByDate = (date) => {
        if (date == null)
            return null;
        const dateKey = typeof date === 'number'
            ? filteredExecutionPointByTimestamp.get(date)?.date ?? executionDateByTimestamp.get(date)
            : date;
        if (!dateKey)
            return null;
        const point = filteredExecutionPointByDate.get(dateKey) ?? executionPointByDate.get(dateKey) ?? null;
        if (!point)
            return null;
        if (cursorMode === 'daily')
            return point;
        const cycle = typeof point.cycle_no === 'number' ? cycleByNo.get(point.cycle_no) : null;
        return cycle?.cycle_start_date
            ? filteredExecutionPointByDate.get(cycle.cycle_start_date) ??
                executionPointByDate.get(cycle.cycle_start_date) ??
                point
            : point;
    };
    const resolveLockedDate = (date) => {
        if (date == null)
            return null;
        const dateKey = typeof date === 'number'
            ? filteredExecutionPointByTimestamp.get(date)?.date ?? executionDateByTimestamp.get(date)
            : date;
        if (!dateKey)
            return null;
        if (cursorMode === 'daily')
            return dateKey;
        const point = resolveExecutionPointByDate(dateKey);
        const cycle = typeof point?.cycle_no === 'number' ? cycleByNo.get(point.cycle_no) : null;
        return cycle?.cycle_start_date ?? dateKey;
    };
    const handleDailyChartClick = (state) => {
        const payloadDate = state?.activePayload?.[0]?.payload?.date ?? state?.activePayload?.[0]?.payload?.date_ts;
        const resolvedDate = resolveLockedDate(payloadDate ?? state?.activeLabel);
        if (!resolvedDate)
            return;
        setLockedCursorDate((current) => (current === resolvedDate ? null : resolvedDate));
    };
    const handleDailyChartMove = (state) => {
        if (lockedCursorDate)
            return;
        const payloadDate = state?.activePayload?.[0]?.payload?.date ?? state?.activePayload?.[0]?.payload?.date_ts;
        const resolvedDate = resolveLockedDate(payloadDate ?? state?.activeLabel);
        if (executionMode === 'compare') {
            setHoveredComparisonPayload(resolveComparisonRowByDate(resolvedDate ?? payloadDate ?? state?.activeLabel) ?? null);
            setHoveredExecutionPayload(null);
        }
        else {
            setHoveredExecutionPayload(resolveExecutionPointByDate(resolvedDate ?? payloadDate ?? state?.activeLabel) ?? null);
            setHoveredComparisonPayload(null);
        }
        setHoveredCursorDate(resolvedDate ?? null);
    };
    const handleDailyChartLeave = () => {
        if (!lockedCursorDate) {
            setHoveredCursorDate(null);
            setHoveredExecutionPayload(null);
            setHoveredComparisonPayload(null);
        }
    };
    const jumpToCycleDaily = (cycleNo, cycleStartDate) => {
        setSelectedCycleNo(cycleNo);
        setPlaybackLayer('daily');
        setDailyWindowMode('full_event');
        setCursorMode('cycle');
        setLockedCursorDate(cycleStartDate);
    };
    const currentCursorDate = lockedCursorDate ?? hoveredCursorDate;
    const currentCursorTs = currentCursorDate ? toChartTimestamp(currentCursorDate) : null;
    const lockedExecutionPoint = resolveExecutionPointByDate(currentCursorDate ?? undefined);
    const resolveComparisonRowByDate = (date) => {
        if (date == null)
            return null;
        const dateKey = typeof date === 'number'
            ? filteredComparisonRowByTimestamp.get(date)?.date ?? executionDateByTimestamp.get(date)
            : date;
        if (!dateKey)
            return null;
        return filteredComparisonRowByDate.get(dateKey) ?? null;
    };
    const lockedComparisonRow = resolveComparisonRowByDate(currentCursorDate ?? undefined);
    const currentExecutionPopupSource = executionMode === 'compare'
        ? (lockedComparisonRow ?? hoveredComparisonPayload)
        : (lockedExecutionPoint ?? hoveredExecutionPayload);
    const cursorCycleForHighlight = cursorMode === 'cycle' && currentCursorDate
        ? (selected.cycle_framework.cycles.find((cycle) => currentCursorDate >= cycle.cycle_start_date && currentCursorDate <= cycle.cycle_end_date) ?? null)
        : null;
    const effectiveCycleHighlight = cursorCycleForHighlight
        ? { start_date: cursorCycleForHighlight.cycle_start_date, end_date: cursorCycleForHighlight.cycle_end_date }
        : activeCycleHighlight;
    const clippedCycleHighlight = effectiveCycleHighlight
        ? {
            start_date: effectiveCycleHighlight.start_date < dailyWindowStartDate ? dailyWindowStartDate : effectiveCycleHighlight.start_date,
            end_date: effectiveCycleHighlight.end_date > dailyWindowEndDate ? dailyWindowEndDate : effectiveCycleHighlight.end_date,
        }
        : null;
    const visibleCycleHighlight = clippedCycleHighlight && clippedCycleHighlight.start_date <= clippedCycleHighlight.end_date ? clippedCycleHighlight : null;
    const executionChartData = executionMode === 'compare' ? comparisonChartRows : executionChartRows;
    const dailyEventWindowStartTs = toTimestampOrNull(dailyEventWindowStart);
    const dailyEventWindowEndTs = toTimestampOrNull(dailyEventWindowEnd);
    const visibleCycleHighlightStartTs = toTimestampOrNull(visibleCycleHighlight?.start_date);
    const visibleCycleHighlightEndTs = toTimestampOrNull(visibleCycleHighlight?.end_date);
    const executionEvaluationDomain = buildAxisDomain(mergedExecutionRows.flatMap((point) => executionMode === 'scenario'
        ? [point.portfolio_value, point.vref_eval, point.vmin_eval, point.vmax_eval].filter((v) => typeof v === 'number' && v > 0)
        : [point.evaluation_value, point.vref_eval, point.vmin_eval, point.vmax_eval]), 0.05);
    const cycleEvaluationDomain = buildAxisDomain(cycleChartRows.flatMap((row) => [row.start_evaluation_value, row.end_evaluation_value]), 0.1);
    const cyclePoolDomain = buildAxisDomain(cycleChartRows.flatMap((row) => [row.start_pool_pct, row.end_pool_pct, row.pool_used_pct_in_cycle]), 0.08);
    const marketPriceDomain = dailyWindowMode === 'full_event'
        ? buildFocusedAxisDomain(filteredMarketRows.flatMap((row) => [row.tqqq_price, row.ma50, row.ma200]), 0.04, 0.06, 0.94)
        : buildAxisDomain(filteredMarketRows.flatMap((row) => [row.tqqq_price, row.ma50, row.ma200]), 0.05);
    return ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Playback", title: "Historical Event Playback", note: "Standard remains the master archive. VR adds readiness state, leveraged interpretation, and scenario mapping." }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 12, width: '100%' }, children: groupedEvents.map((group) => ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: group.group }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: group.items.map((event) => {
                                            const on = event.id === selected.id;
                                            const tone = playbackStatusTone(event.vr_support_status);
                                            return ((0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setSelId(event.id), style: {
                                                    ...tabStyle(on),
                                                    textAlign: 'left',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: 4,
                                                    minWidth: 220,
                                                }, children: [(0, jsx_runtime_1.jsx)("span", { children: event.name }), (0, jsx_runtime_1.jsx)("span", { style: { color: '#94a3b8', fontSize: '0.72rem', lineHeight: 1.4 }, children: event.suite_note }), (0, jsx_runtime_1.jsx)("span", { style: {
                                                            alignSelf: 'flex-start',
                                                            padding: '2px 8px',
                                                            borderRadius: 999,
                                                            fontSize: '0.72rem',
                                                            fontWeight: 800,
                                                            ...tone,
                                                        }, children: formatPlaybackStatus(event.vr_support_status) })] }, event.id));
                                        }) })] }, group.group))) }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Event Header", title: selected.name, note: `${selected.start} - ${selected.end}` }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Duration", text: `${selected.duration_days} trading days` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Playback Group", text: selected.suite_group, detail: selected.archive_name }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "VR Support", text: formatPlaybackStatus(selected.vr_support_status) }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "VR Pattern", text: selected.vr_tagged_event.vr_analysis.pattern_type ?? 'Not Classified Yet', detail: selected.suite_note })] })] }), (0, jsx_runtime_1.jsx)(CycleStartPanel, { cycleStart: executionOverride?.cycle_start ?? selected.cycle_start, eventId: selected.event_id, eventStart: selected.start, eventEnd: selected.end, chartData: selected.chart_data, onApply: (data) => {
                    setExecutionOverride(data);
                    setCyclePoolCap(data.execution_playback.default_cap_option);
                } }, selected.event_id), (0, jsx_runtime_1.jsx)(CycleFrameworkPanel, { framework: selected.cycle_framework }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Execution Playback", title: "VR Execution Playback", note: playbackLayer === 'cycle'
                            ? 'Cycle View summarizes pool consumption, average execution conditions, and how each two-week cycle ended.'
                            : executionMode === 'compare'
                                ? 'Compare the original grid-following VR against the scenario overlay engine across portfolio path, pool preservation, and execution behavior.'
                                : 'Evaluation value path and V-band only. Price and cost remain in tooltip and the lower market chart.' }), (0, jsx_runtime_1.jsx)(CycleSummaryCard_1.default, { cycleSummaries: cycleSummaries }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: ['cycle', 'daily'].map((layer) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setPlaybackLayer(layer), style: tabStyle(playbackLayer === layer), children: layer === 'cycle' ? 'Cycle View' : 'Daily View' }, layer))) }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: playbackLayer === 'daily' ? ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.82rem', display: 'flex', alignItems: 'center' }, children: "Daily Window" }), ['auto_focus', 'full_event'].map((mode) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setDailyWindowMode(mode), style: tabStyle(dailyWindowMode === mode), children: mode === 'auto_focus' ? 'Auto Focus' : 'Full Event' }, mode)))] })) : null }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.82rem', display: 'flex', alignItems: 'center' }, children: "Cycle Pool Usage Cap" }), ['30', '40', '50', 'unlimited'].map((cap) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setCyclePoolCap(cap), style: tabStyle(cyclePoolCap === cap), children: cap === 'unlimited' ? 'Unlimited' : `${cap}%` }, cap)))] }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: (playbackLayer === 'cycle' ? ['original', 'scenario'] : ['original', 'scenario', 'compare']).map((mode) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setExecutionMode(mode), style: tabStyle(executionMode === mode), children: mode === 'original' ? 'Original VR (Playback)' : mode === 'scenario' ? 'Scenario VR' : 'Compare' }, mode))) })] }), playbackLayer === 'cycle' ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Cycles Covered", text: `${cycleSummaries.length}`, detail: `Engine: ${executionMode === 'original' ? 'Original VR (Playback)' : 'Scenario VR'}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Average Pool Used / Cycle", text: `${avgCyclePoolUsed.toFixed(1)}%`, detail: `Max ${maxCyclePoolUsed.toFixed(1)}%` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Active Cycle End State", text: activeCycleSummary ? formatPlaybackToken(activeCycleSummary.ending_state) : 'Not available', detail: activeCycleSummary ? `Cycle ${activeCycleSummary.cycle_no} | Cash ${activeCycleSummary.end_pool_pct.toFixed(1)}%` : 'No cycle summary' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Active Cycle Pool Spend", text: activeCycleSummary ? activeCycleSummary.pool_spent_in_cycle.toFixed(2) : '0.00', detail: activeCycleSummary ? `${activeCycleSummary.pool_used_pct_in_cycle.toFixed(1)}% of initial pool` : 'No cycle summary' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Current Pool Remaining", text: displayedExecutionVariant.pool_usage_summary.pool_cash_remaining.toFixed(2), detail: `Latest replay state | Cycle ${displayedExecutionVariant.pool_usage_summary.active_cycle_no ?? 'N/A'}` })] }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.84rem', lineHeight: 1.6 }, children: "Cycle View answers how much pool each two-week cycle consumed, the average execution conditions inside the cycle, and how the cycle ended." }), (0, jsx_runtime_1.jsxs)("div", { style: {
                                    background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    borderRadius: 18,
                                    padding: '1rem',
                                }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#e5e7eb', fontSize: '0.92rem', fontWeight: 700, marginBottom: 6 }, children: "Full Event Cycle Overview" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.8rem', marginBottom: 12, lineHeight: 1.6 }, children: "This chart compresses the full event into cycle-level checkpoints so you can see how evaluation value evolved across the entire replay." }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 280, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: cycleChartRows, margin: { top: 4, right: 10, left: 0, bottom: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "cycle_label", tick: { fontSize: 11, fill: '#e5e7eb' } }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { yAxisId: "evaluation", tick: { fontSize: 11, fill: '#e5e7eb' }, width: 56, domain: cycleEvaluationDomain, label: { value: 'Evaluation Value', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 } }), activeCycleSummary ? ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: `C${activeCycleSummary.cycle_no}`, x2: `C${activeCycleSummary.cycle_no}`, yAxisId: "evaluation", fill: "rgba(96,165,250,0.08)", strokeOpacity: 0 })) : null, (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { formatter: (value, name) => {
                                                        if (typeof value !== 'number')
                                                            return [value, name];
                                                        if (name.includes('%'))
                                                            return [`${value.toFixed(1)}%`, name];
                                                        return [value.toFixed(2), name];
                                                    }, labelFormatter: (label) => {
                                                        const row = cycleChartRows.find((item) => item.cycle_label === label);
                                                        return row ? `${row.cycle_label} | ${row.cycle_window}` : String(label);
                                                    }, contentStyle: {
                                                        background: '#111827',
                                                        border: '1px solid rgba(255,255,255,0.08)',
                                                        borderRadius: 12,
                                                        color: '#f8fafc',
                                                    } }), (0, jsx_runtime_1.jsx)(recharts_1.Legend, { wrapperStyle: { fontSize: 12, color: '#cbd5e1' } }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "monotone", dataKey: "start_evaluation_value", name: "Start Eval", stroke: "rgba(148,163,184,0.55)", strokeWidth: 1.4, dot: false }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "monotone", dataKey: "end_evaluation_value", name: "End Eval", stroke: "#f8fafc", strokeWidth: 2.4, dot: { r: 2.5, fill: '#f8fafc' }, activeDot: { r: 4 } }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "monotone", dataKey: "vref_eval", name: "Vref Eval", stroke: "#34d399", strokeWidth: 2, dot: false, strokeDasharray: "6 4" }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "monotone", dataKey: "vmin_eval", name: "Vmin Eval", stroke: "#ef4444", strokeWidth: 1.4, dot: false, strokeDasharray: "4 4" }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "monotone", dataKey: "vmax_eval", name: "Vmax Eval", stroke: "#f59e0b", strokeWidth: 1.4, dot: false, strokeDasharray: "4 4" })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: {
                                    background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    borderRadius: 18,
                                    padding: '1rem',
                                }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#e5e7eb', fontSize: '0.92rem', fontWeight: 700, marginBottom: 6 }, children: "Cycle Pool Overview" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.8rem', marginBottom: 12, lineHeight: 1.6 }, children: "Pool cash ratio and per-cycle pool usage are separated below so you can compare capital preservation directly against the cycle evaluation chart above." }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 220, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: cycleChartRows, margin: { top: 4, right: 10, left: 0, bottom: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "cycle_label", tick: { fontSize: 11, fill: '#e5e7eb' } }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { yAxisId: "pool", tick: { fontSize: 11, fill: '#94a3b8' }, width: 58, domain: cyclePoolDomain, label: { value: 'Cash Ratio / Pool Used %', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 } }), activeCycleSummary ? ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: `C${activeCycleSummary.cycle_no}`, x2: `C${activeCycleSummary.cycle_no}`, yAxisId: "pool", fill: "rgba(96,165,250,0.08)", strokeOpacity: 0 })) : null, (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { formatter: (value, name) => {
                                                        if (typeof value !== 'number')
                                                            return [value, name];
                                                        return [`${value.toFixed(1)}%`, name];
                                                    }, labelFormatter: (label) => {
                                                        const row = cycleChartRows.find((item) => item.cycle_label === label);
                                                        return row ? `${row.cycle_label} | ${row.cycle_window}` : String(label);
                                                    }, contentStyle: {
                                                        background: '#111827',
                                                        border: '1px solid rgba(255,255,255,0.08)',
                                                        borderRadius: 12,
                                                        color: '#f8fafc',
                                                    } }), (0, jsx_runtime_1.jsx)(recharts_1.Legend, { wrapperStyle: { fontSize: 12, color: '#cbd5e1' } }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "pool", type: "monotone", dataKey: "start_pool_pct", name: "Start Pool %", stroke: "#38bdf8", strokeWidth: 1.4, dot: false, strokeDasharray: "4 4" }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "pool", type: "monotone", dataKey: "end_pool_pct", name: "End Pool %", stroke: "#34d399", strokeWidth: 2, dot: { r: 2.5, fill: '#34d399' } }), (0, jsx_runtime_1.jsx)(recharts_1.Area, { yAxisId: "pool", type: "monotone", dataKey: "pool_used_pct_in_cycle", name: "Pool Used %", fill: "rgba(245,158,11,0.18)", stroke: "#f59e0b", strokeWidth: 1.5 })] }) })] }), (0, jsx_runtime_1.jsx)("div", { style: { overflowX: 'auto' }, children: (0, jsx_runtime_1.jsxs)("table", { style: { width: '100%', borderCollapse: 'collapse', minWidth: 1100, tableLayout: 'fixed' }, children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsx)("tr", { style: { textAlign: 'left' }, children: [
                                                    'Cycle',
                                                    'Window',
                                                    'Vref',
                                                    'Vmin',
                                                    'Vmax',
                                                    'Start Eval',
                                                    'End Eval',
                                                    'Start Pool',
                                                    'End Pool (%)',
                                                    'Pool Used',
                                                    'Pool Spent',
                                                    'Avg Buy Px',
                                                    'Avg Sell Px',
                                                    'Buys',
                                                    'Sells',
                                                    'Defense',
                                                    'Blocked',
                                                    'End Shares',
                                                    'End Avg Cost',
                                                    'End State',
                                                    'Scenario Bias',
                                                    'Playbook Bias',
                                                ].map((label) => ((0, jsx_runtime_1.jsx)("th", { style: {
                                                        padding: '0.18rem 0.28rem',
                                                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                                                        color: '#94a3b8',
                                                        fontSize: '0.62rem',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.05em',
                                                        width: label === 'Cycle'
                                                            ? 38
                                                            : label === 'Window'
                                                                ? 148
                                                                : label === 'Scenario Bias' || label === 'Playbook Bias'
                                                                    ? 90
                                                                    : 58,
                                                    }, children: label }, label))) }) }), (0, jsx_runtime_1.jsx)("tbody", { children: cycleSummaries.map((cycle) => {
                                                const active = cycle.cycle_no === activeCycleNo;
                                                return ((0, jsx_runtime_1.jsxs)("tr", { style: { background: active ? 'rgba(96,165,250,0.08)' : 'transparent' }, children: [(0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f8fafc', fontWeight: 800, whiteSpace: 'nowrap', fontSize: '0.78rem' }, children: (0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => jumpToCycleDaily(cycle.cycle_no, cycle.start_date), style: {
                                                                    background: 'transparent',
                                                                    border: 'none',
                                                                    color: '#f8fafc',
                                                                    fontWeight: 800,
                                                                    padding: 0,
                                                                    cursor: 'pointer',
                                                                }, children: ["C", cycle.cycle_no] }) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', minWidth: 148, lineHeight: 1.38, fontSize: '0.72rem' }, children: cycle.cycle_window }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#34d399', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: Math.round(cycle.vref_eval) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ef4444', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: Math.round(cycle.vmin_eval) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f59e0b', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: Math.round(cycle.vmax_eval) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: Math.round(cycle.start_evaluation_value) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: Math.round(cycle.end_evaluation_value) }), (0, jsx_runtime_1.jsxs)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', lineHeight: 1.32, fontSize: '0.72rem' }, children: [Math.round(cycle.start_pool_cash), " (", cycle.start_pool_pct.toFixed(0), "%)"] }), (0, jsx_runtime_1.jsxs)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', lineHeight: 1.28, fontSize: '0.72rem' }, children: [cycle.end_pool_pct.toFixed(0), "%", (0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.66rem', marginTop: 2 }, children: Math.round(cycle.end_pool_cash) })] }), (0, jsx_runtime_1.jsxs)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e5e7eb', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: [cycle.pool_used_pct_in_cycle.toFixed(0), "%"] }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: Math.round(cycle.pool_spent_in_cycle) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#34d399', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: cycle.avg_buy_price == null ? 'N/A' : Math.round(cycle.avg_buy_price) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f59e0b', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: cycle.avg_sell_price == null ? 'N/A' : Math.round(cycle.avg_sell_price) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#34d399', textAlign: 'center', fontSize: '0.72rem' }, children: cycle.buy_count }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f59e0b', textAlign: 'center', fontSize: '0.72rem' }, children: cycle.sell_count }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ef4444', textAlign: 'center', fontSize: '0.72rem' }, children: cycle.defense_count }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#a78bfa', textAlign: 'center', fontSize: '0.72rem' }, children: cycle.blocked_buy_count }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: cycle.end_shares }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }, children: cycle.end_avg_cost.toFixed(1) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f8fafc', lineHeight: 1.28, fontSize: '0.71rem' }, children: formatPlaybackToken(cycle.ending_state) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', minWidth: 90, fontSize: '0.72rem', lineHeight: 1.25 }, children: cycle.scenario_bias.length ? cycle.scenario_bias.slice(0, 2).map(formatPlaybackToken).join(', ') : (0, jsx_runtime_1.jsx)("span", { style: { color: '#64748b' }, children: "N/A" }) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', minWidth: 90, fontSize: '0.72rem', lineHeight: 1.25 }, children: cycle.playbook_bias.length ? cycle.playbook_bias.slice(0, 2).map(formatPlaybackToken).join(', ') : (0, jsx_runtime_1.jsx)("span", { style: { color: '#64748b' }, children: "N/A" }) })] }, cycle.cycle_no));
                                            }) })] }) })] })) : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [dailyWindowMode === 'auto_focus' && focusWindow ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12, lineHeight: 1.6 }, children: ["Auto Focus: ", focusWindow.start_date, " to ", focusWindow.end_date, ". Anchored from the earliest stress trigger to the early recovery window after the event low."] })) : null, (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }, children: (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.82rem', display: 'flex', alignItems: 'center' }, children: "Cursor Mode" }), ['daily', 'cycle'].map((mode) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setCursorMode(mode), style: tabStyle(cursorMode === mode), children: mode === 'daily' ? 'Daily Cursor' : 'Cycle Cursor' }, mode)))] }) }), (0, jsx_runtime_1.jsx)("div", { style: { position: 'relative' }, children: (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 420, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: executionChartData, margin: { top: 10, right: 18, left: 12, bottom: 10 }, onClick: handleDailyChartClick, onMouseMove: handleDailyChartMove, onMouseLeave: handleDailyChartLeave, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { type: "number", dataKey: "date_ts", domain: executionStartTs != null && executionEndTs != null ? [executionStartTs, executionEndTs] : ['dataMin', 'dataMax'], ticks: executionTimestampTicks.map((entry) => entry.ts), scale: "time", allowDuplicatedCategory: false, height: 50, tick: { fontSize: 11, fill: '#e5e7eb' }, tickFormatter: (value) => formatAxisDateTick(executionDateByTimestamp.get(Number(value)) ?? ''), angle: -28, textAnchor: "end" }), executionMode === 'compare' ? ((0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fontSize: 12, fill: '#e5e7eb' }, width: 78, tickCount: 6, domain: buildAxisDomain(comparisonView.chart_rows.flatMap((row) => [row.original_evaluation_value, row.scenario_evaluation_value]), 0.08), label: { value: 'Evaluation Value', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 } })) : ((0, jsx_runtime_1.jsx)(jsx_runtime_1.Fragment, { children: (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { yAxisId: "evaluation", tick: { fontSize: 12, fill: '#e5e7eb' }, width: 82, tickCount: 6, domain: executionEvaluationDomain, label: { value: 'Evaluation Value', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 } }) })), (0, jsx_runtime_1.jsx)(recharts_1.Legend, { wrapperStyle: { fontSize: 12, color: '#cbd5e1' } }), dailyEventWindowStartTs != null && dailyEventWindowEndTs != null ? ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: dailyEventWindowStartTs, x2: dailyEventWindowEndTs, fill: "rgba(255,255,255,0.03)", stroke: "rgba(255,255,255,0.08)" })) : null, filteredCycleBoundaries.map((boundary) => ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceLine, { x: toChartTimestamp(boundary.date), ...(executionMode !== 'compare' ? { yAxisId: 'evaluation' } : {}), stroke: "rgba(148,163,184,0.14)", strokeDasharray: "2 3", label: { value: `C${boundary.cycle_no}`, position: 'insideTop', fill: '#64748b', fontSize: 10 } }, `execution-boundary-${boundary.date}`))), currentCursorTs != null ? ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceLine, { x: currentCursorTs, yAxisId: executionMode === 'compare' ? undefined : 'evaluation', stroke: lockedCursorDate ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.32)', strokeDasharray: lockedCursorDate ? '3 3' : '2 3' })) : null, executionMode !== 'compare' && filteredScenarioZones.map((zone) => ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: toChartTimestamp(zone.start_date), x2: toChartTimestamp(zone.end_date), fill: "rgba(148,163,184,0.05)", strokeOpacity: 0 }, `scenario-${zone.start_date}-${zone.end_date}`))), executionMode !== 'compare' && filteredRecoveryZones.map((zone) => ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: toChartTimestamp(zone.start_date), x2: toChartTimestamp(zone.end_date), fill: "rgba(52,211,153,0.08)", strokeOpacity: 0 }, `recover-${zone.start_date}-${zone.end_date}`))), executionMode !== 'compare' && filteredFailedZones.map((zone) => ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: toChartTimestamp(zone.start_date), x2: toChartTimestamp(zone.end_date), fill: "rgba(239,68,68,0.08)", strokeOpacity: 0 }, `failed-${zone.start_date}-${zone.end_date}`))), executionMode !== 'compare' && visibleCycleHighlightStartTs != null && visibleCycleHighlightEndTs != null ? ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: visibleCycleHighlightStartTs, x2: visibleCycleHighlightEndTs, fill: cursorCycleForHighlight ? 'rgba(96,165,250,0.16)' : 'rgba(96,165,250,0.08)', stroke: cursorCycleForHighlight ? 'rgba(96,165,250,0.5)' : 'rgba(96,165,250,0.22)', strokeWidth: cursorCycleForHighlight ? 1.5 : 1 })) : null, executionMode === 'compare' ? ((0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(PlaybackChartTooltip, { variant: "evaluation_compare" }) })) : ((0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(PlaybackChartTooltip, { resolveByDate: resolveExecutionPointByDate, variant: "execution" }) })), executionMode === 'compare' ? ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "original_evaluation_value", stroke: "#94a3b8", strokeWidth: 2, dot: false, name: "Original VR (Playback) Portfolio Value", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "scenario_evaluation_value", stroke: "#34d399", strokeWidth: 2.4, dot: false, name: "Scenario Portfolio Value", connectNulls: true })] })) : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", dataKey: executionMode === 'scenario' ? 'portfolio_value' : 'evaluation_value', stroke: executionMode === 'original' ? '#94a3b8' : '#e5e7eb', strokeWidth: 2.4, dot: false, name: executionMode === 'original' ? 'Original VR (Playback) Evaluation Value' : 'Portfolio Value (Stock + Cash)', connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "stepAfter", dataKey: "vref_eval", stroke: "#34d399", strokeWidth: 2.2, strokeDasharray: "6 4", dot: false, name: "Vref Eval", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "stepAfter", dataKey: "vmin_eval", stroke: "#ef4444", strokeWidth: 1.5, dot: false, name: "Vmin Eval", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { yAxisId: "evaluation", type: "stepAfter", dataKey: "vmax_eval", stroke: "#f59e0b", strokeWidth: 1.5, dot: false, name: "Vmax Eval", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Scatter, { yAxisId: "evaluation", data: executionChartRows, dataKey: executionMode === 'scenario' ? 'buy_marker_portfolio' : 'buy_marker_eval', fill: "#34d399", name: "Buy Executions" }), (0, jsx_runtime_1.jsx)(recharts_1.Scatter, { yAxisId: "evaluation", data: executionChartRows, dataKey: executionMode === 'scenario' ? 'sell_marker_portfolio' : 'sell_marker_eval', fill: "#f59e0b", name: "Sell Executions" }), (0, jsx_runtime_1.jsx)(recharts_1.Scatter, { yAxisId: "evaluation", data: executionChartRows, dataKey: executionMode === 'scenario' ? 'defense_marker_portfolio' : 'defense_marker_eval', fill: "#ef4444", name: "Defense Reductions" }), (0, jsx_runtime_1.jsx)(recharts_1.Scatter, { yAxisId: "evaluation", data: executionChartRows, dataKey: "cap_block_marker_eval", fill: "#a78bfa", name: "Cap Blocked Buys" })] }))] }) }) }), executionMode === 'compare' ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12, marginTop: 12 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.84rem', lineHeight: 1.6 }, children: "Compare the original grid-following VR against the scenario overlay engine across portfolio path, pool preservation, and execution behavior." }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }, children: comparisonView.metric_cards.map((metric) => ((0, jsx_runtime_1.jsxs)("div", { style: {
                                                background: 'rgba(255,255,255,0.03)',
                                                border: '1px solid rgba(255,255,255,0.06)',
                                                borderRadius: 14,
                                                padding: '0.9rem',
                                                display: 'grid',
                                                gap: 5,
                                            }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: metric.label }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#cbd5e1', fontSize: '0.8rem' }, children: ["Original: ", metric.original_value] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#f8fafc', fontSize: '0.86rem', fontWeight: 700 }, children: ["Scenario: ", metric.scenario_value] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.8rem' }, children: ["Delta: ", metric.difference] })] }, metric.label))) })] })) : null] }))] }), playbackLayer === 'daily' ? ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Panel 2", title: "Real TQQQ + MA50 / MA200", note: "Actual leveraged market path with structural references, event window shading, and cycle boundaries." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Active Cycle Pool Used", text: `${displayedExecutionVariant.pool_usage_summary.active_cycle_pool_used_pct.toFixed(1)}%`, detail: `Cycle ${displayedExecutionVariant.pool_usage_summary.active_cycle_no ?? 'N/A'} | Cap ${displayedExecutionVariant.pool_usage_summary.cycle_pool_cap_pct == null ? 'Unlimited' : `${displayedExecutionVariant.pool_usage_summary.cycle_pool_cap_pct}%`}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Pool Cash Remaining", text: displayedExecutionVariant.pool_usage_summary.pool_cash_remaining.toFixed(2), detail: `Cumulative spent ${displayedExecutionVariant.pool_usage_summary.cumulative_pool_spent.toFixed(2)}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Blocked Buys", text: `${displayedExecutionVariant.pool_usage_summary.blocked_buy_count}`, detail: `Active cycle blocked ${displayedExecutionVariant.pool_usage_summary.active_cycle_blocked_buy_count}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Execution State", text: displayedExecutionVariant.points[displayedExecutionVariant.points.length - 1]?.state_after_trade ?? 'Pending', detail: displayedExecutionVariant.points[displayedExecutionVariant.points.length - 1]?.trade_reason ?? 'No recent trade marker' })] }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 300, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: filteredMarketRows, margin: { top: 8, right: 14, left: 8, bottom: 8 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "date", ticks: marketDateTicks, interval: 0, minTickGap: 0, height: 50, tick: { fontSize: 11, fill: '#e5e7eb' }, tickFormatter: formatAxisDateTick, angle: -28, textAnchor: "end" }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fontSize: 12, fill: '#e5e7eb' }, width: 72, tickCount: 6, domain: marketPriceDomain, label: { value: 'TQQQ / MA50 / MA200', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 } }), (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(PlaybackChartTooltip, { variant: "market" }) }), (0, jsx_runtime_1.jsx)(recharts_1.Legend, { wrapperStyle: { fontSize: 12, color: '#cbd5e1' } }), dailyEventWindowStart && dailyEventWindowEnd ? ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceArea, { x1: dailyEventWindowStart, x2: dailyEventWindowEnd, fill: "rgba(255,255,255,0.03)", stroke: "rgba(255,255,255,0.08)" })) : null, filteredCycleBoundaries.map((boundary) => ((0, jsx_runtime_1.jsx)(recharts_1.ReferenceLine, { x: boundary.date, stroke: "rgba(148,163,184,0.16)", strokeDasharray: "2 3" }, `boundary-${boundary.date}`))), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "tqqq_price", stroke: "#e5e7eb", strokeWidth: 2.2, dot: false, name: "TQQQ Price", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "ma50", stroke: "#60a5fa", strokeWidth: 1.5, dot: false, name: "MA50", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "ma200", stroke: "#f59e0b", strokeWidth: 1.5, dot: false, name: "MA200", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Scatter, { data: filteredBreachPoints, dataKey: "value", fill: "#ef4444", name: "MA200 Breach" }), (0, jsx_runtime_1.jsx)(recharts_1.Scatter, { data: filteredRecoveryMarkers, dataKey: "value", fill: "#34d399", name: "Recovery Marker" })] }) }), selected.leveraged_stress.tqqq_source === 'synthetic' ? ((0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.82rem', marginTop: 8 }, children: "TQQQ comparison is using a QQQ 3x synthetic proxy because real TQQQ history was not available before 2010." })) : selected.leveraged_stress.tqqq_source === 'unavailable' ? ((0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.82rem', marginTop: 8 }, children: "TQQQ-specific comparison is not available for this event in the real Standard archive." })) : null] })) : null, playbackLayer === 'daily' ? ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Execution Validation", title: "Execution Validation Pass", note: "Trade log, state transitions, and validation flags sourced from the same replay execution stream." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Buy Executions", text: `${displayedExecutionVariant.validation_summary.executed_buy_count}`, detail: displayedExecutionVariant.validation_summary.has_buy_execution ? 'Detected in replay' : 'No buy executions' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Sell Executions", text: `${displayedExecutionVariant.validation_summary.executed_sell_count}`, detail: displayedExecutionVariant.validation_summary.has_sell_execution ? 'Detected in replay' : 'No sell executions' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Defense Events", text: `${displayedExecutionVariant.validation_summary.executed_defense_count}`, detail: displayedExecutionVariant.validation_summary.has_defense_execution ? 'Detected in replay' : 'No defense reductions' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Cap Blocking", text: displayedExecutionVariant.validation_summary.blocked_by_cap_observed ? 'Observed' : 'None', detail: `${displayedExecutionVariant.validation_summary.blocked_buy_count} blocked buys` })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Recent Trade Log" }), displayedExecutionVariant.trade_log.filter((item) => item.trade_executed || item.blocked_by_cap).slice(-8).reverse().map((item) => ((0, jsx_runtime_1.jsxs)("div", { style: {
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    borderRadius: 14,
                                    padding: '0.85rem 0.95rem',
                                    display: 'grid',
                                    gap: 4,
                                }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { color: '#f8fafc', fontSize: '0.9rem', fontWeight: 700 }, children: [item.replay_date, " | Cycle ", item.cycle_no ?? 'N/A', " | ", item.trade_type ?? 'none'] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem' }, children: ["State ", item.state_before, " ", '\u2192', " ", item.state_after, " | Shares ", item.shares_before, " ", '\u2192', " ", item.shares_after, " | Avg Cost ", item.avg_cost_before.toFixed(2), " ", '\u2192', " ", item.avg_cost_after.toFixed(2)] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.8rem' }, children: ["Pool ", item.pool_cash_before.toFixed(2), " ", '\u2192', " ", item.pool_cash_after.toFixed(2), " | Cycle Pool Used ", item.cycle_pool_used_pct.toFixed(1), "%", item.blocked_by_cap ? ' | blocked by cap' : ''] })] }, `${item.replay_date}-${item.trade_type ?? 'none'}-${item.cycle_no ?? 'x'}`))), !displayedExecutionVariant.trade_log.some((item) => item.trade_executed || item.blocked_by_cap) ? ((0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: "No execution records generated yet for this replay variant." })) : null] })] })) : null, playbackLayer === 'daily' && executionMode === 'compare' ? ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Comparison Layer", title: "Original VR (Playback) vs Scenario Overlay", note: "Mechanical baseline versus scenario-aware overlay, with emphasis on deployment pace, pool survival, and late-stage optionality." }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }, children: comparisonView.metric_cards.map((metric) => ((0, jsx_runtime_1.jsxs)("div", { style: {
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                borderRadius: 16,
                                padding: '1rem',
                                display: 'grid',
                                gap: 6,
                            }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: metric.label }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem' }, children: ["Original VR (Playback): ", metric.original_value] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#f8fafc', fontSize: '0.88rem', fontWeight: 700 }, children: ["Scenario VR: ", metric.scenario_value] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.8rem' }, children: ["Difference: ", metric.difference] })] }, metric.label))) }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12, marginBottom: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }, children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Portfolio Path", title: "Portfolio Path Comparison", note: "Original VR (Playback) versus scenario overlay portfolio value through the replay." }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 220, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: comparisonView.chart_rows, margin: { top: 4, right: 8, left: 0, bottom: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "date", tick: { fontSize: 11, fill: '#e5e7eb' }, interval: Math.max(1, Math.floor(comparisonView.chart_rows.length / 10)) }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fontSize: 11, fill: '#e5e7eb' }, width: 60, domain: buildAxisDomain(comparisonView.chart_rows.flatMap((row) => [row.original_portfolio_value, row.scenario_portfolio_value]), 0.08) }), (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(PlaybackChartTooltip, { variant: "portfolio_compare" }) }), (0, jsx_runtime_1.jsx)(recharts_1.Legend, { wrapperStyle: { fontSize: 12, color: '#cbd5e1' } }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "original_portfolio_value", stroke: "#94a3b8", strokeWidth: 2, dot: false, name: "Original VR (Playback) Portfolio", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "scenario_portfolio_value", stroke: "#34d399", strokeWidth: 2.4, dot: false, name: "Scenario VR Portfolio", connectNulls: true })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: { ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }, children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Pool Survival", title: "Pool Survival Comparison", note: "How much pool capital remained available through the event." }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 220, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: comparisonView.chart_rows, margin: { top: 4, right: 8, left: 0, bottom: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "date", tick: { fontSize: 11, fill: '#e5e7eb' }, interval: Math.max(1, Math.floor(comparisonView.chart_rows.length / 10)) }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fontSize: 11, fill: '#e5e7eb' }, width: 60, domain: buildAxisDomain(comparisonView.chart_rows.flatMap((row) => [row.original_pool_remaining, row.scenario_pool_remaining]), 0.08) }), (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(PlaybackChartTooltip, { variant: "pool_compare" }) }), (0, jsx_runtime_1.jsx)(recharts_1.Legend, { wrapperStyle: { fontSize: 12, color: '#cbd5e1' } }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "original_pool_remaining", stroke: "#94a3b8", strokeWidth: 2, dot: false, name: "Original VR (Playback) Pool Remaining", connectNulls: true }), (0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: "scenario_pool_remaining", stroke: "#60a5fa", strokeWidth: 2.4, dot: false, name: "Scenario VR Pool Remaining", connectNulls: true })] }) })] })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }, children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Behavior Difference", title: "Structural Comparison" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 10 }, children: comparisonView.behavior_rows.map((row) => ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 10, alignItems: 'start' }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700 }, children: row.label }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5 }, children: row.original_value }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.82rem', lineHeight: 1.5 }, children: row.scenario_value })] }, row.label))) })] }), (0, jsx_runtime_1.jsxs)("div", { style: { ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }, children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Interpretation", title: "What Changed" }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.5 }, children: comparisonView.interpretation.headline }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.84rem', lineHeight: 1.6 }, children: comparisonView.interpretation.subline })] })] })] })] })) : null, (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Panel 3", title: "Recovery Path", note: "Compact rebound-quality summary." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Rebound Strength", text: selected.recovery_path.rebound_strength_pct == null
                                            ? 'Unavailable'
                                            : `${selected.recovery_path.rebound_strength_pct.toFixed(1)}%` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Rebound Persistence", text: selected.recovery_path.rebound_persistence }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Lower-High Failure Risk", text: selected.recovery_path.lower_high_failure_risk }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Secondary Drawdown Risk", text: selected.recovery_path.secondary_drawdown_risk })] })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "VR Interpretation", title: "Event-Level VR Metadata", note: "Manual priority tags first, fallback interpretation otherwise." }), selected.vr_tagged_event.source === 'fallback' ? ((0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: 12 }, children: "This event remains available in Standard playback, but curated VR interpretation metadata has not yet been attached." })) : null, (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Pattern Type", text: selected.vr_tagged_event.vr_analysis.pattern_type
                                                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.pattern_type)
                                                    : 'Not Classified Yet' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "MA200 Status", text: selected.vr_tagged_event.vr_analysis.ma200_status
                                                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.ma200_status)
                                                    : 'Not available' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Leverage Stress", text: selected.vr_tagged_event.vr_analysis.leverage_stress
                                                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.leverage_stress)
                                                    : 'Not available' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Recovery Quality", text: selected.vr_tagged_event.vr_analysis.recovery_quality
                                                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.recovery_quality)
                                                    : 'Not available' })] }), (0, jsx_runtime_1.jsxs)("div", { style: { ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }, children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "VR Tags", title: "Tags" }), selected.vr_tagged_event.vr_analysis.tags.length
                                                ? renderTokenChips(selected.vr_tagged_event.vr_analysis.tags)
                                                : (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: "Not available" })] }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Key Lesson", text: selected.vr_tagged_event.vr_analysis.lesson ?? 'Not yet tagged for curated VR playback.' }), (0, jsx_runtime_1.jsxs)("div", { style: { ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }, children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Scenario Bias", title: "Scenario Bias" }), selected.vr_tagged_event.vr_analysis.scenario_bias?.length
                                                ? renderTokenChips(selected.vr_tagged_event.vr_analysis.scenario_bias)
                                                : (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: "Not available" })] }), (0, jsx_runtime_1.jsxs)("div", { style: { ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }, children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Playbook Bias", title: "Playbook Bias" }), selected.vr_tagged_event.vr_analysis.playbook_bias?.length
                                                ? renderTokenChips(selected.vr_tagged_event.vr_analysis.playbook_bias)
                                                : (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: "Not available" })] })] })] })] }), selected.vr_support_status === 'pending_synthetic' ? ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle({ borderColor: 'rgba(148,163,184,0.18)' }), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "VR Placeholder", title: "Pending Synthetic Support" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 8 }, children: selected.placeholder_messages.map((message) => ((0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.92rem', lineHeight: 1.6 }, children: message }, message))) })] })) : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [selected.placeholder_messages.length ? ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle({ borderColor: 'rgba(148,163,184,0.16)' }), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "VR Note", title: "Playback Source Notes" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 8 }, children: selected.placeholder_messages.map((message) => ((0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }, children: message }, message))) })] })) : null, (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Pattern Detector", title: "Closest Pattern Matches" }), selected.pattern_matches.top_matches.length ? ((0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }, children: selected.pattern_matches.top_matches.map((match) => ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: match.pattern_name, text: match.score.toFixed(2), detail: match.explanation?.join(' | ') ?? 'Historical analog overlap only.' }, match.pattern_id))) })) : ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Closest Pattern Matches", text: "No VR pattern analog available yet" }))] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Scenario Playbook", title: "Possible Scenarios", note: "Maximum 3 scenarios, derived from the current primary match." }), selected.scenario_playbook.scenarios.length ? ((0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }, children: selected.scenario_playbook.scenarios.map((scenario) => ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: scenario.scenario_name, text: scenario.description, detail: `Posture: ${scenario.posture_guidance.join(', ')}` }, scenario.scenario_id))) })) : ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Scenario Playbook", text: "Scenario mapping not available" }))] })] }))] }));
}
function BacktestTab({ strategyArena }) {
    const events = strategyArena?.events ?? [];
    const [selectedId, setSelectedId] = (0, react_1.useState)(events[0]?.id ?? '');
    const [arenaViewMode, setArenaViewMode] = (0, react_1.useState)('charts');
    const selected = events.find((event) => event.id === selectedId) ?? events[0];
    if (!selected) {
        return ((0, jsx_runtime_1.jsx)(PlaceholderSection, { eyebrow: "Strategy Arena", title: "Strategy Comparison Arena", note: "Historical strategy comparison is not available yet.", cards: [{ label: 'Strategy Arena', text: 'No event comparison data loaded' }] }));
    }
    const strategyKeys = ARENA_TOOLTIP_ORDER;
    const displayStrategyKeys = strategyKeys.filter((strategyKey) => strategyKey !== 'original_vr_scaled' || selected.vr_source === 'survival_archive');
    const metricRows = displayStrategyKeys.reduce((rows, strategyKey) => {
        const metric = selected.metrics[strategyKey];
        if (metric) {
            rows.push({ strategyKey, metric });
        }
        return rows;
    }, []);
    const bestFinalPerformer = metricRows.length
        ? metricRows.reduce((best, row) => (row.metric.final_return_pct > best.metric.final_return_pct ? row : best), metricRows[0])
        : null;
    const lowestDrawdownPerformer = metricRows.length
        ? metricRows.reduce((best, row) => (row.metric.max_drawdown_pct > best.metric.max_drawdown_pct ? row : best), metricRows[0])
        : null;
    const buyHoldMetric = selected.metrics.buy_hold;
    const originalVrMetric = selected.metrics.original_vr_scaled;
    const ma200HalfMetric = selected.metrics.ma200_risk_control_50;
    const ma200Lb30HybridMetric = selected.metrics.ma200_lb30_hybrid;
    const lowBasedLb30Metric = selected.metrics.low_based_lb30;
    const lowBasedLb25Metric = selected.metrics.low_based_lb25;
    const adaptiveMetric = selected.metrics.adaptive_exposure;
    const warningLayer = selected.warning_layer;
    const overlayDisplayModel = warningLayer
        ? (0, buildArenaOverlayDisplayModel_1.buildArenaOverlayDisplayModel)({
            warningState: warningLayer.warning_state,
            warningReason: warningLayer.warning_reason,
            scenarioHint: warningLayer.scenario_hint,
            mcOverlay: warningLayer.mc_overlay,
        })
        : null;
    const adaptiveDrawdownDelta = adaptiveMetric && buyHoldMetric
        ? adaptiveMetric.max_drawdown_pct - buyHoldMetric.max_drawdown_pct
        : null;
    const adaptiveReturnDelta = adaptiveMetric && buyHoldMetric
        ? adaptiveMetric.final_return_pct - buyHoldMetric.final_return_pct
        : null;
    const visibleStrategyNotes = displayStrategyKeys;
    const currentMarketContext = BACKTEST_COPY.backtest.conditions.marketContextByEventId[selected.id] ?? 'A historical stress period used to compare positioning differences under the same market conditions.';
    const currentPurpose = BACKTEST_COPY.backtest.conditions.purposeByEventId?.[selected.id] ?? BACKTEST_COPY.backtest.conditions.purpose;
    return ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Strategy Arena", title: "Strategy Comparison Arena", note: "Same-condition TQQQ stress comparison. Warning comes before execution, and Arena remains a positioning tool rather than a winner-selection engine." }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }, children: events.map((event) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setSelectedId(event.id), style: tabStyle(selected.id === event.id), children: event.label }, event.id))) }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }, children: [
                            { key: 'charts', label: 'Charts' },
                            { key: 'test_setup', label: 'Test Setup' },
                        ].map((item) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setArenaViewMode(item.key), style: tabStyle(arenaViewMode === item.key), children: item.label }, item.key))) }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Source Event", text: selected.standard_event_name, detail: `${selected.start} to ${selected.end}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Execution Stack", text: "Forecast first, execution second", detail: selected.vr_source === 'survival_archive'
                                    ? 'The warning layer is read-only. Arena execution engines remain local, and the survival archive is used only to provide VR Original defense and Vmin-buy intent.'
                                    : 'The warning layer is read-only. Arena execution engines remain local, and no survival archive is attached for the VR Original reference.' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Playback", text: "Open Event Study", detail: `Use /vr-survival?tab=Playback&event=${selected.playback_event_id} to review the full playback case.` })] })] }), arenaViewMode === 'charts' ? ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [warningLayer ? ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle({ padding: '1rem 1.1rem' }), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Forecast Layer", title: "Downside Warning State", note: "This system detects abnormal downside behavior before executing defensive actions. Warning does not equal trading." }), overlayDisplayModel ? (0, jsx_runtime_1.jsx)(OverlayScoreStrip_1.default, { model: overlayDisplayModel }) : null, (0, jsx_runtime_1.jsxs)("div", { style: {
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                    gap: 12,
                                    marginTop: 12,
                                }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Trigger Snapshot", text: `dd3 ${formatOptionalPercent(warningLayer.trigger_metrics.dd3)} | dd5 ${formatOptionalPercent(warningLayer.trigger_metrics.dd5)}`, detail: `dd6 ${formatOptionalPercent(warningLayer.trigger_metrics.dd6)} | PeakDD ${formatOptionalPercent(warningLayer.trigger_metrics.peakDD)} | Rebound ${formatOptionalPercent(warningLayer.trigger_metrics.rebound_from_low_pct)} | MA200 gap ${formatOptionalPercent(warningLayer.trigger_metrics.distance_to_ma200_pct)}` }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "VR Band Context", text: `Level ${warningLayer.trigger_metrics.vr_band_level ?? 'n/a'}`, detail: strategyArena?.methodology.warning_layer_rule }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Overlay Status", text: warningLayer.mc_overlay ? 'Available' : 'Unavailable', detail: warningLayer.mc_overlay
                                            ? `Dominant MC scenario: ${warningLayer.mc_overlay.dominantMcScenario}`
                                            : 'Monte Carlo overlay is optional. Rule-based warning remains primary.' })] }), (0, jsx_runtime_1.jsx)("div", { style: { marginTop: 12, color: warningStateTone(warningLayer.warning_state), fontSize: '0.82rem', fontWeight: 700 }, children: formatWarningExplainability(warningLayer) }), overlayDisplayModel ? ((0, jsx_runtime_1.jsxs)("div", { style: {
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(0, 1.3fr) minmax(260px, 0.95fr)',
                                    gap: 12,
                                    marginTop: 14,
                                }, children: [(0, jsx_runtime_1.jsx)(MonteCarloOverlayCard_1.default, { model: overlayDisplayModel }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(OverlayAlignmentBadge_1.default, { alignment: overlayDisplayModel.interpretationAlignment, note: overlayDisplayModel.interpretationNote }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Overlay Use", text: "Interpretive Only", detail: "Monte Carlo overlay summarizes how similar synthetic stress paths behaved. Overlay is interpretive, not executable." })] })] })) : null] })) : null, (0, jsx_runtime_1.jsxs)("div", { style: panelStyle({ padding: '1rem 1.1rem' }), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: BACKTEST_COPY.backtest.philosophy.eyebrow, title: BACKTEST_COPY.backtest.philosophy.title }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 8 }, children: [BACKTEST_COPY.backtest.philosophy.body.map((line) => ((0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.92rem', lineHeight: 1.65 }, children: line }, line))), (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.82rem', fontWeight: 700, marginTop: 2 }, children: BACKTEST_COPY.backtest.philosophy.footer })] })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle({ padding: '1rem 1.1rem' }), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: BACKTEST_COPY.backtest.conditions.eyebrow, title: BACKTEST_COPY.backtest.conditions.title, note: "Simple English framing so the chart can be read as a positioning map." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: BACKTEST_COPY.backtest.conditions.labels.period, text: formatArenaPeriodRange(selected.start, selected.end), detail: currentMarketContext }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: BACKTEST_COPY.backtest.conditions.labels.asset, text: BACKTEST_COPY.backtest.conditions.asset.name, detail: BACKTEST_COPY.backtest.conditions.asset.detail }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: BACKTEST_COPY.backtest.conditions.labels.execution, text: "Close signal, next-session action", detail: BACKTEST_COPY.backtest.conditions.execution }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: BACKTEST_COPY.backtest.conditions.labels.purpose, text: "Positioning differences", detail: currentPurpose }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: BACKTEST_COPY.backtest.conditions.labels.note, text: "Leveraged ETF behavior matters", detail: BACKTEST_COPY.backtest.conditions.note })] })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Metrics", title: "Final Return, Max Drawdown, Recovery Time, Exposure Stability", note: "Arena compares seven response profiles under the same starting allocation and next-bar execution rules." }), (0, jsx_runtime_1.jsx)("div", { style: { overflowX: 'auto' }, children: (0, jsx_runtime_1.jsxs)("table", { style: { width: '100%', borderCollapse: 'collapse' }, children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsx)("tr", { children: ['Strategy', 'Final Return', 'Max Drawdown', 'Recovery Time', 'Exposure Stability'].map((header) => ((0, jsx_runtime_1.jsx)("th", { style: {
                                                        padding: '0.8rem 0.85rem',
                                                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                        color: '#94a3b8',
                                                        textAlign: 'left',
                                                        fontSize: '0.78rem',
                                                        textTransform: 'uppercase',
                                                    }, children: header }, header))) }) }), (0, jsx_runtime_1.jsx)("tbody", { children: displayStrategyKeys.map((strategyKey) => {
                                                const metric = selected.metrics[strategyKey];
                                                if (!metric)
                                                    return null;
                                                return ((0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsxs)("td", { style: { padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e5e7eb', fontWeight: 700 }, children: [(0, jsx_runtime_1.jsx)("span", { style: { display: 'inline-flex', width: 10, height: 10, borderRadius: 999, background: STRATEGY_COLORS[strategyKey], marginRight: 10 } }), STRATEGY_LABELS[strategyKey]] }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }, children: formatSignedPercent(metric.final_return_pct) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }, children: formatSignedPercent(metric.max_drawdown_pct) }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }, children: formatRecoveryDays(metric.recovery_time_days) }), (0, jsx_runtime_1.jsxs)("td", { style: { padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }, children: [metric.exposure_stability_pct.toFixed(1), "%"] })] }, strategyKey));
                                            }) })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Chart 1", title: "Equity Curve Comparison" }), (0, jsx_runtime_1.jsxs)("div", { style: {
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                                    gap: 10,
                                    marginBottom: 14,
                                }, children: [(0, jsx_runtime_1.jsxs)("div", { style: {
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: 14,
                                            padding: '0.85rem 0.95rem',
                                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#10B981', fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }, children: "Adaptive Exposure" }), adaptiveMetric && buyHoldMetric ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 4, fontSize: '0.82rem' }, children: [(0, jsx_runtime_1.jsxs)("span", { style: { color: arenaDeltaTone(adaptiveDrawdownDelta ?? 0) }, children: ["DD vs B&H ", formatArenaDelta(adaptiveDrawdownDelta ?? 0)] }), (0, jsx_runtime_1.jsxs)("span", { style: { color: arenaDeltaTone(adaptiveReturnDelta ?? 0) }, children: ["Return vs B&H ", formatArenaDelta(adaptiveReturnDelta ?? 0)] })] })) : ((0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.8rem' }, children: "Adaptive Exposure is unavailable for this event." }))] }), (0, jsx_runtime_1.jsxs)("div", { style: {
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: 14,
                                            padding: '0.85rem 0.95rem',
                                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: STRATEGY_COLORS.ma200_risk_control_50, fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }, children: BACKTEST_COPY.backtest.summary.ma200.title }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6 }, children: BACKTEST_COPY.backtest.summary.ma200.detail }), ma200HalfMetric ? ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.77rem', marginTop: 6 }, children: ["MA200 (50%) ", formatSignedPercent(ma200HalfMetric.final_return_pct), " | Max DD ", formatSignedPercent(ma200HalfMetric.max_drawdown_pct)] }), ma200Lb30HybridMetric ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.77rem', marginTop: 4 }, children: ["MA200 + LB30 ", formatSignedPercent(ma200Lb30HybridMetric.final_return_pct), " | Max DD ", formatSignedPercent(ma200Lb30HybridMetric.max_drawdown_pct)] })) : null] })) : null] }), (0, jsx_runtime_1.jsxs)("div", { style: {
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: 14,
                                            padding: '0.85rem 0.95rem',
                                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: STRATEGY_COLORS.low_based_lb30, fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }, children: BACKTEST_COPY.backtest.summary.lb30.title }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6 }, children: BACKTEST_COPY.backtest.summary.lb30.detail }), lowBasedLb30Metric ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.77rem', marginTop: 6 }, children: ["Final return ", formatSignedPercent(lowBasedLb30Metric.final_return_pct), " | Max DD ", formatSignedPercent(lowBasedLb30Metric.max_drawdown_pct)] })) : ((0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.77rem', marginTop: 6 }, children: "Default low-based recovery reference for this event." }))] }), (0, jsx_runtime_1.jsxs)("div", { style: {
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: 14,
                                            padding: '0.85rem 0.95rem',
                                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: STRATEGY_COLORS.original_vr_scaled, fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }, children: BACKTEST_COPY.backtest.summary.vr.title }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6 }, children: BACKTEST_COPY.backtest.summary.vr.detail }), originalVrMetric ? ((0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.77rem', marginTop: 6 }, children: ["Final return ", formatSignedPercent(originalVrMetric.final_return_pct), " | Max DD ", formatSignedPercent(originalVrMetric.max_drawdown_pct)] })) : ((0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.77rem', marginTop: 6 }, children: "VR Original (Capped) is hidden for this event because no survival archive is attached." }))] })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }, children: [displayStrategyKeys.map((strategyKey) => ((0, jsx_runtime_1.jsxs)("div", { title: strategyKey === 'original_vr_scaled'
                                            ? 'VR Original (Capped): Reuses archive VR defense and Vmin-buy intent on the Arena-local TQQQ path. Rebuys are capped to 50% added capital per cycle and exposure never re-risks above 80%.'
                                            : undefined, style: {
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '0.45rem 0.7rem',
                                            borderRadius: 999,
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            background: 'rgba(255,255,255,0.03)',
                                            color: '#cbd5e1',
                                            fontSize: '0.8rem',
                                            cursor: strategyKey === 'original_vr_scaled' ? 'help' : undefined,
                                        }, children: [(0, jsx_runtime_1.jsx)("span", { style: { width: 10, height: 10, borderRadius: 999, background: STRATEGY_COLORS[strategyKey] } }), STRATEGY_CHIP_LABELS[strategyKey], strategyKey === 'original_vr_scaled' && ((0, jsx_runtime_1.jsx)("span", { style: { fontSize: '0.68rem', color: '#64748b', marginLeft: 2 }, children: "i" }))] }, strategyKey))), selected.vr_source !== 'survival_archive' && ((0, jsx_runtime_1.jsx)("div", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.7rem', borderRadius: 999, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', color: '#475569', fontSize: '0.78rem', fontStyle: 'italic' }, children: "VR Original (Capped) reference hidden for this event because no survival archive is attached" }))] }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 320, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: selected.chart_data, margin: { top: 8, right: 8, left: -16, bottom: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "date", tick: { fontSize: 11, fill: '#94a3b8' } }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fontSize: 11, fill: '#94a3b8' } }), (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(BacktestChartTooltip, { visibleStrategyKeys: displayStrategyKeys, metricKind: "equity" }) }), displayStrategyKeys.map((strategyKey) => {
                                            const lineVisuals = getArenaLineVisuals(strategyKey);
                                            return ((0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: STRATEGY_SERIES_KEYS[strategyKey].equity, stroke: STRATEGY_COLORS[strategyKey], strokeWidth: lineVisuals.strokeWidth, strokeOpacity: lineVisuals.strokeOpacity, strokeDasharray: lineVisuals.strokeDasharray, dot: false, name: STRATEGY_LABELS[strategyKey], connectNulls: false }, strategyKey));
                                        })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Chart 2", title: "Drawdown Comparison" }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 280, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: selected.chart_data, margin: { top: 8, right: 8, left: -16, bottom: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "date", tick: { fontSize: 11, fill: '#94a3b8' } }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fontSize: 11, fill: '#94a3b8' } }), (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(BacktestChartTooltip, { visibleStrategyKeys: displayStrategyKeys, metricKind: "drawdown" }) }), displayStrategyKeys.map((strategyKey) => {
                                            const lineVisuals = getArenaLineVisuals(strategyKey);
                                            return ((0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: STRATEGY_SERIES_KEYS[strategyKey].drawdown, stroke: STRATEGY_COLORS[strategyKey], strokeWidth: strategyKey === 'adaptive_exposure' ? 2.2 : Math.max(1.2, lineVisuals.strokeWidth - 0.35), strokeOpacity: lineVisuals.strokeOpacity, strokeDasharray: lineVisuals.strokeDasharray, dot: false, name: `${STRATEGY_LABELS[strategyKey]} DD`, connectNulls: false }, strategyKey));
                                        }), (0, jsx_runtime_1.jsx)(recharts_1.ReferenceLine, { y: 0, stroke: "rgba(255,255,255,0.12)" })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Chart 3", title: "Exposure Timeline", note: "Exposure is shown as a percent of capital deployed to the leveraged instrument." }), (0, jsx_runtime_1.jsx)(recharts_1.ResponsiveContainer, { width: "100%", height: 280, children: (0, jsx_runtime_1.jsxs)(recharts_1.ComposedChart, { data: selected.chart_data, margin: { top: 8, right: 8, left: -16, bottom: 0 }, children: [(0, jsx_runtime_1.jsx)(recharts_1.CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.04)" }), (0, jsx_runtime_1.jsx)(recharts_1.XAxis, { dataKey: "date", tick: { fontSize: 11, fill: '#94a3b8' } }), (0, jsx_runtime_1.jsx)(recharts_1.YAxis, { tick: { fontSize: 11, fill: '#94a3b8' }, domain: [0, 100] }), (0, jsx_runtime_1.jsx)(recharts_1.Tooltip, { content: (0, jsx_runtime_1.jsx)(BacktestChartTooltip, { visibleStrategyKeys: displayStrategyKeys, metricKind: "exposure" }) }), displayStrategyKeys.map((strategyKey) => {
                                            const lineVisuals = getArenaLineVisuals(strategyKey);
                                            return ((0, jsx_runtime_1.jsx)(recharts_1.Line, { dataKey: STRATEGY_SERIES_KEYS[strategyKey].exposure, stroke: STRATEGY_COLORS[strategyKey], strokeWidth: strategyKey === 'adaptive_exposure' ? 2.2 : Math.max(1.2, lineVisuals.strokeWidth - 0.35), strokeOpacity: lineVisuals.strokeOpacity, strokeDasharray: lineVisuals.strokeDasharray, dot: false, name: `${STRATEGY_LABELS[strategyKey]} Exposure`, connectNulls: false }, strategyKey));
                                        })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Method", title: "Strategy Rules Used In This Arena" }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "MA200 (50%)", text: "80 -> 50 -> 80", detail: strategyArena?.methodology.ma200_rule }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "MA200 + LB30", text: "50% MA defense + low-based recovery", detail: strategyArena?.methodology.ma200_rule }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "LB30 / LB25", text: "Adaptive downside + low-based re-risk", detail: strategyArena?.methodology.vr_source_priority }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Adaptive Exposure", text: "V-shape reference", detail: strategyArena?.methodology.vr_source_priority }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "VR Original (Capped)", text: "Controlled VR baseline", detail: "Archive VR defense and Vmin-buy intent are replayed on the Arena-local TQQQ path, but rebuys stay capped so the baseline remains controlled." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Warning Layer", text: "Forecast first", detail: strategyArena?.methodology.warning_layer_rule }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Vmin Handling", text: "Visual only", detail: "Vmin remains a reference band for Arena warning and low-based engines. VR Original alone is allowed to reuse archive Vmin-buy intent, but those rebuys are capped by cycle capital and cash-preservation rules." })] }), (0, jsx_runtime_1.jsx)("div", { style: { marginTop: 12 }, children: (0, jsx_runtime_1.jsxs)("a", { href: `/vr-survival?tab=Playback&event=${selected.playback_event_id}`, style: { ...tabStyle(false), textDecoration: 'none' }, children: ["Open Playback For ", selected.label] }) })] })] })) : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Test Setup", title: "Initial Conditions", note: "Arena compares same-condition TQQQ paths. Playback remains a separate archive replay tab." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Asset", text: "TQQQ", detail: "Common leveraged instrument across this Arena event." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Initial Value", text: "100", detail: "Normalized starting value for every visible curve." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Date Range", text: `${selected.start} to ${selected.end}`, detail: "Current selected event window." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Price Series", text: "Common TQQQ series", detail: "All Arena curves are compared on the same TQQQ baseline." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Comparison Basis", text: "Same-condition Arena", detail: "Each strategy is measured inside the same event window." }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Baseline Note", text: "Common start, different path", detail: "All curves start from the same baseline; only paths differ." }), selected.adaptive_exposure_report ? ((0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Adaptive Start", text: `${selected.adaptive_exposure_report.initial_state.exposure}%`, detail: selected.adaptive_exposure_report.initial_state.reason })) : null, warningLayer ? ((0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Warning Start", text: formatWarningStateLabel(warningLayer.warning_state), detail: warningLayer.warning_reason })) : null] })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Strategy Notes", title: "What Each Curve Represents" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }, children: visibleStrategyNotes.map((strategyKey) => ((0, jsx_runtime_1.jsx)(PlaceholderCard, { label: STRATEGY_LABELS[strategyKey], text: STRATEGY_LABELS[strategyKey], detail: strategyKey === 'adaptive_exposure'
                                        ? `${STRATEGY_SETUP_NOTES[strategyKey]} ${formatAdaptiveExplainability(selected.adaptive_exposure_report)}`
                                        : strategyKey === 'low_based_lb30' ||
                                            strategyKey === 'low_based_lb25' ||
                                            strategyKey === 'ma200_lb30_hybrid' ||
                                            strategyKey === 'ma200_risk_control_50'
                                            ? `${STRATEGY_SETUP_NOTES[strategyKey]} ${formatStrategyExplainability(selected.strategy_reports?.[strategyKey])}`
                                            : strategyKey === 'original_vr_scaled'
                                                ? `${STRATEGY_SETUP_NOTES[strategyKey]} ${formatStrategyExplainability(selected.strategy_reports?.[strategyKey])}${selected.vr_source !== 'survival_archive' ? ' Hidden for this event because no survival archive is attached.' : ''}`
                                                : STRATEGY_SETUP_NOTES[strategyKey] }, strategyKey))) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Read Guide", title: "How to Read Results" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 10 }, children: [
                                    'Higher equity curve = stronger cumulative growth.',
                                    'Smaller drawdown = better downside control.',
                                    'Curves are compared under the same TQQQ baseline.',
                                    'VR Original uses archive VR defense and Vmin-buy intent, but applies it as a controlled Arena-local baseline with capped rebuys.',
                                    'Warning state is forecast-first. It prepares interpretation and comparison, but does not directly trade.',
                                ].map((note) => ((0, jsx_runtime_1.jsx)("div", { style: {
                                        background: 'rgba(255,255,255,0.03)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        borderRadius: 14,
                                        padding: '0.85rem 0.95rem',
                                        color: '#cbd5e1',
                                        fontSize: '0.84rem',
                                        lineHeight: 1.55,
                                    }, children: note }, note))) })] }), (0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Quick Summary", title: "Current Event Snapshot", note: metricRows.length ? 'Uses the visible Arena metrics for this selected event.' : 'Static explanatory text only.' }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Highest Final Return", text: bestFinalPerformer ? STRATEGY_LABELS[bestFinalPerformer.strategyKey] : 'Metrics not available', detail: bestFinalPerformer ? `Final return ${formatSignedPercent(bestFinalPerformer.metric.final_return_pct)} | Read as a positioning outcome, not a winner.` : 'Quick summary falls back to static setup guidance.' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Lowest Drawdown", text: lowestDrawdownPerformer ? STRATEGY_LABELS[lowestDrawdownPerformer.strategyKey] : 'Metrics not available', detail: lowestDrawdownPerformer ? `Max drawdown ${formatSignedPercent(lowestDrawdownPerformer.metric.max_drawdown_pct)}` : 'Use the charts tab for visual inspection.' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "Adaptive vs Buy & Hold", text: adaptiveMetric && buyHoldMetric
                                            ? adaptiveMetric.final_return_pct > buyHoldMetric.final_return_pct
                                                ? 'Adaptive Exposure finished above Buy & Hold'
                                                : adaptiveMetric.final_return_pct < buyHoldMetric.final_return_pct
                                                    ? 'Adaptive Exposure finished below Buy & Hold'
                                                    : 'Adaptive Exposure matched Buy & Hold'
                                            : 'Adaptive Exposure not available', detail: adaptiveMetric && buyHoldMetric
                                            ? `${formatSignedPercent(adaptiveMetric.final_return_pct)} vs ${formatSignedPercent(buyHoldMetric.final_return_pct)} final return`
                                            : 'Adaptive metrics are unavailable for this event.' }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { compact: true, label: "LB30 vs LB25", text: lowBasedLb30Metric && lowBasedLb25Metric
                                            ? lowBasedLb30Metric.final_return_pct >= lowBasedLb25Metric.final_return_pct
                                                ? 'LB30 finished above LB25'
                                                : 'LB25 finished above LB30'
                                            : 'Low-based comparison unavailable', detail: lowBasedLb30Metric && lowBasedLb25Metric
                                            ? `${formatSignedPercent(lowBasedLb30Metric.final_return_pct)} vs ${formatSignedPercent(lowBasedLb25Metric.final_return_pct)} final return`
                                            : 'This card compares the two low-based recovery ladders for the selected event.' })] })] })] }))] }));
}
function PoolLogicTab() {
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Pool Logic", title: "Pool Survival Mechanism", note: "Pool is the capital buffer that lets VR reduce leverage early and restore it in controlled stages." }), (0, jsx_runtime_1.jsx)("div", { style: { overflowX: 'auto' }, children: (0, jsx_runtime_1.jsxs)("table", { style: { width: '100%', borderCollapse: 'collapse' }, children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { style: {
                                            padding: '0.8rem 0.85rem',
                                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                                            color: '#94a3b8',
                                            textAlign: 'left',
                                            fontSize: '0.78rem',
                                            textTransform: 'uppercase',
                                        }, children: "State" }), (0, jsx_runtime_1.jsx)("th", { style: {
                                            padding: '0.8rem 0.85rem',
                                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                                            color: '#94a3b8',
                                            textAlign: 'left',
                                            fontSize: '0.78rem',
                                            textTransform: 'uppercase',
                                        }, children: "Pool Goal" }), (0, jsx_runtime_1.jsx)("th", { style: {
                                            padding: '0.8rem 0.85rem',
                                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                                            color: '#94a3b8',
                                            textAlign: 'left',
                                            fontSize: '0.78rem',
                                            textTransform: 'uppercase',
                                        }, children: "Exposure Rule" }), (0, jsx_runtime_1.jsx)("th", { style: {
                                            padding: '0.8rem 0.85rem',
                                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                                            color: '#94a3b8',
                                            textAlign: 'left',
                                            fontSize: '0.78rem',
                                            textTransform: 'uppercase',
                                        }, children: "Recovery Rule" })] }) }), (0, jsx_runtime_1.jsxs)("tbody", { children: [(0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#f59e0b', fontWeight: 800 }, children: "Caution" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "15%" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "Trim slightly" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "Wait for stabilization" })] }), (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fb923c', fontWeight: 800 }, children: "Defense Prep" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "25-35%" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "Reduce leverage" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "Wait for recovery signals" })] }), (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ef4444', fontWeight: 800 }, children: "Defense" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "50%+" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "Capital preservation" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }, children: "Avoid aggressive re-entry" })] }), (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', color: '#38bdf8', fontWeight: 800 }, children: "Re-entry Trial" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', color: '#cbd5e1' }, children: "Deploy small" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', color: '#cbd5e1' }, children: "Test market" }), (0, jsx_runtime_1.jsx)("td", { style: { padding: '0.8rem 0.85rem', color: '#cbd5e1' }, children: "Scale if recovery persists" })] })] })] }) })] }));
}
function OptionsOverlayTab() {
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle({ borderColor: 'rgba(56,189,248,0.28)' }), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Advanced Overlay", title: "Options Overlay", note: "Supplementary only. This tab does not override VR signals." }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))', gap: 12 }, children: [(0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "Put/Call Ratio", text: "Advanced overlay placeholder" }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "VIX Term Structure", text: "Advanced overlay placeholder" }), (0, jsx_runtime_1.jsx)(PlaceholderCard, { label: "VVIX", text: "Advanced overlay placeholder" })] })] }));
}
function PhilosophyTab({ runId }) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "Philosophy", title: "VR Survival Framework", note: `Loaded from vr_survival.json (${runId}).` }), (0, jsx_runtime_1.jsxs)("div", { style: {
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 16,
                    padding: '1rem',
                    color: '#cbd5e1',
                    lineHeight: 1.8,
                    fontSize: '0.98rem',
                }, children: [(0, jsx_runtime_1.jsx)("div", { children: "Standard defines the environment." }), (0, jsx_runtime_1.jsx)("div", { children: "VR defines leverage exposure." }), (0, jsx_runtime_1.jsx)("div", { style: { marginTop: 10 }, children: "Standard evaluates systemic conditions." }), (0, jsx_runtime_1.jsx)("div", { children: "VR controls leverage exposure and survival posture." }), (0, jsx_runtime_1.jsx)("div", { style: { marginTop: 10 }, children: "VR may turn defensive earlier than Standard." })] })] }));
}
function LeverageStressHeatmap({ heatmapData }) {
    const leverageItems = heatmapData?.sections?.leverage?.items ?? [];
    const rows = HEATMAP_SYMBOLS.map((symbol) => {
        const item = leverageItems.find((entry) => entry.symbol === symbol);
        return {
            symbol,
            item,
            state: classifyHeatmapState(item),
        };
    });
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsx)(SectionHeader, { eyebrow: "System View", title: "Leverage Stress Heatmap", note: "Green stable, yellow weak, orange fragile, red breakdown risk. Missing backend rows remain no data." }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }, children: rows.map((row) => {
                    const tone = heatmapTone(row.state);
                    return ((0, jsx_runtime_1.jsxs)("div", { style: {
                            borderRadius: 16,
                            padding: '1rem',
                            minHeight: 132,
                            ...tone,
                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: {
                                    fontSize: '0.71rem',
                                    color: '#cbd5e1',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                }, children: row.symbol }), (0, jsx_runtime_1.jsx)("div", { style: { fontSize: '1rem', fontWeight: 800, marginTop: 10 }, children: row.state }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.5, marginTop: 10 }, children: row.item
                                    ? `20d ${row.item.ret_20d?.toFixed(1)}% | 5d ${row.item.ret_5d?.toFixed(1)}% | Vol ${row.item.vol_surge?.toFixed(2)}x`
                                    : 'No existing output row in etf_room.json' })] }, row.symbol));
                }) })] }));
}
function VRSurvival({ data, heatmapData, patternDashboard, playbackData, strategyArena, initialTab, initialPlaybackEventId, }) {
    const [tab, setTab] = (0, react_1.useState)(TABS.includes(initialTab ?? 'Overview') ? initialTab : 'Overview');
    return ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [(0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: TABS.map((item) => ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setTab(item), style: tabStyle(tab === item), children: item }, item))) }), tab === 'Overview' ? ((0, jsx_runtime_1.jsx)(OverviewTab, { data: data, patternDashboard: patternDashboard, playbackData: playbackData })) : null, tab === 'Playback' ? ((0, jsx_runtime_1.jsx)(PlaybackTab, { playbackData: playbackData, initialPlaybackEventId: initialPlaybackEventId })) : null, tab === 'Backtest' ? (0, jsx_runtime_1.jsx)(BacktestTab, { strategyArena: strategyArena }) : null, tab === 'Pool Logic' ? (0, jsx_runtime_1.jsx)(PoolLogicTab, {}) : null, tab === 'Options Overlay' ? (0, jsx_runtime_1.jsx)(OptionsOverlayTab, {}) : null, tab === 'Philosophy' ? (0, jsx_runtime_1.jsx)(PhilosophyTab, { runId: data.run_id }) : null, tab === 'Crash Analysis' ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: {
                            background: 'rgba(252,165,165,0.05)',
                            border: '1px solid rgba(252,165,165,0.18)',
                            borderRadius: 14,
                            padding: '0.75rem 1rem',
                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.13em', fontWeight: 600, marginBottom: 6 }, children: "Crash Analysis \u00B7 Validation Layer" }), (0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.55 }, children: "Use this view to validate the AI interpretation above against observed engine behavior. Pattern matches and historical analogs here should confirm or challenge the scenarios in the AI panel \u2014 not replace them. Discrepancies between AI scenario probabilities and historical pattern data are signal, not noise." })] }), (0, jsx_runtime_1.jsx)(OverviewTab, { data: data, patternDashboard: patternDashboard, playbackData: playbackData })] })) : null, tab === 'Strategy Lab' ? ((0, jsx_runtime_1.jsx)(StrategyLabTab_1.StrategyLabTab, { events: (playbackData?.events ?? []) })) : null, (0, jsx_runtime_1.jsx)(LeverageStressHeatmap, { heatmapData: heatmapData })] }));
}
