"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyScenarioType = classifyScenarioType;
exports.default = ScenarioEnginePanel;
const jsx_runtime_1 = require("react/jsx-runtime");
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
function titleize(value) {
    return value
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
function classifyScenarioType(scenario) {
    const key = `${scenario.scenario_id} ${scenario.scenario_name} ${scenario.description}`.toLowerCase();
    if (key.includes('breakdown') ||
        key.includes('lower_low') ||
        key.includes('decline') ||
        key.includes('crash') ||
        key.includes('bear') ||
        key.includes('extended_correction')) {
        return 'Downside Risk';
    }
    if (key.includes('recovery') ||
        key.includes('rally') ||
        key.includes('breakout') ||
        key.includes('bottom') ||
        key.includes('stabilization')) {
        return 'Recovery Attempt';
    }
    return 'Neutral / Monitoring';
}
function typeTone(type) {
    if (type === 'Downside Risk') {
        return {
            border: '1px solid rgba(239,68,68,0.24)',
            background: 'rgba(239,68,68,0.08)',
            color: '#fca5a5',
        };
    }
    if (type === 'Recovery Attempt') {
        return {
            border: '1px solid rgba(34,197,94,0.22)',
            background: 'rgba(34,197,94,0.08)',
            color: '#86efac',
        };
    }
    return {
        border: '1px solid rgba(96,165,250,0.22)',
        background: 'rgba(96,165,250,0.08)',
        color: '#93c5fd',
    };
}
function buildScenarioPostureSummary(scenarios, suggestedPosture) {
    if (!scenarios.length)
        return undefined;
    const scenarioTypes = new Set(scenarios.map(classifyScenarioType));
    const posture = suggestedPosture?.slice(0, 2) ?? [];
    const parts = [];
    if (scenarioTypes.has('Neutral / Monitoring')) {
        parts.push('Maintain monitoring posture while direction remains unresolved.');
    }
    if (scenarioTypes.has('Downside Risk')) {
        parts.push('Keep downside protection in focus until support proves durable.');
    }
    if (scenarioTypes.has('Recovery Attempt')) {
        parts.push('Treat rebounds as controlled recovery attempts until persistence improves.');
    }
    if (posture.length) {
        parts.push(`Current posture emphasis: ${posture.join(', ')}.`);
    }
    return parts.slice(0, 2).join(' ');
}
function buildMonitoringNote(scenarios) {
    if (!scenarios.length)
        return undefined;
    const ids = scenarios.map((scenario) => scenario.scenario_id);
    const notes = [];
    if (ids.some((id) => id.includes('breakdown') || id.includes('lower_low') || id.includes('crash'))) {
        notes.push('Watch whether recent support fails.');
    }
    if (ids.some((id) => id.includes('range') || id.includes('sideways') || id.includes('extended_range'))) {
        notes.push('Watch whether the current range resolves above resistance or below support.');
    }
    if (ids.some((id) => id.includes('recovery') || id.includes('rally') || id.includes('breakout') || id.includes('bottom'))) {
        notes.push('Watch rebound persistence over the next few sessions.');
    }
    return notes.slice(0, 2).join(' ');
}
function ScenarioEnginePanel({ scenarios, suggested_posture, historical_analogs, }) {
    const displayedScenarios = scenarios.slice(0, 3);
    const primaryAnalogEvent = historical_analogs?.analog_events[0]?.event_id;
    const postureSummary = buildScenarioPostureSummary(displayedScenarios, suggested_posture);
    const monitoringNote = buildMonitoringNote(displayedScenarios);
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }, children: "Scenario Engine" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1.08rem', fontWeight: 800 }, children: "Plausible Market Paths" })] }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.8rem', maxWidth: 460, lineHeight: 1.55 }, children: "These branches show what to monitor next without implying a single exact outcome." })] }), !displayedScenarios.length ? ((0, jsx_runtime_1.jsxs)("div", { style: {
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 16,
                    padding: '1rem',
                    color: '#94a3b8',
                    fontSize: '0.9rem',
                }, children: [(0, jsx_runtime_1.jsx)("div", { children: "No scenario branches available yet." }), (0, jsx_runtime_1.jsx)("div", { style: { marginTop: 8, fontSize: '0.82rem', color: '#64748b' }, children: "Scenario mapping is not available for the current state." })] })) : ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [postureSummary ? ((0, jsx_runtime_1.jsxs)("div", { style: {
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 16,
                            padding: '1rem',
                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }, children: "Scenario-Based Posture" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }, children: postureSummary })] })) : null, (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }, children: displayedScenarios.map((scenario) => {
                            const scenarioType = classifyScenarioType(scenario);
                            const tone = typeTone(scenarioType);
                            return ((0, jsx_runtime_1.jsxs)("div", { style: {
                                    background: 'rgba(255,255,255,0.03)',
                                    border: tone.border,
                                    borderRadius: 16,
                                    padding: '1rem',
                                    display: 'grid',
                                    gap: 10,
                                }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }, children: scenario.scenario_name || titleize(scenario.scenario_id) }), (0, jsx_runtime_1.jsx)("div", { style: {
                                                    ...tone,
                                                    padding: '0.35rem 0.6rem',
                                                    borderRadius: 999,
                                                    fontSize: '0.76rem',
                                                    fontWeight: 800,
                                                }, children: scenarioType })] }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.55 }, children: scenario.description }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }, children: "Posture" }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'grid', gap: 6 }, children: scenario.posture_guidance.map((item) => ((0, jsx_runtime_1.jsx)("div", { style: { color: '#e5e7eb', fontSize: '0.86rem', lineHeight: 1.5 }, children: `- ${titleize(item)}` }, item))) })] }), primaryAnalogEvent ? ((0, jsx_runtime_1.jsx)("div", { children: (0, jsx_runtime_1.jsx)("a", { href: `/vr-survival?tab=Playback&event=${primaryAnalogEvent}`, style: {
                                                textDecoration: 'none',
                                                color: '#cbd5e1',
                                                fontSize: '0.82rem',
                                                fontWeight: 700,
                                                padding: '0.5rem 0.75rem',
                                                borderRadius: 999,
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                background: 'rgba(255,255,255,0.03)',
                                                display: 'inline-flex',
                                            }, children: "Open Related Historical Analog" }) })) : null] }, scenario.scenario_id));
                        }) }), monitoringNote ? ((0, jsx_runtime_1.jsxs)("div", { style: {
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 16,
                            padding: '1rem',
                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }, children: "What To Watch Next" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }, children: monitoringNote })] })) : null] }))] }));
}
