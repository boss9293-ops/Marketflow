"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = HistoricalAnalogPanel;
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
function eventLabel(eventId) {
    return `${eventId} Risk Event`;
}
function HistoricalAnalogPanel({ analogs, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: panelStyle(), children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }, children: "Historical Analog Events" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1.08rem', fontWeight: 800 }, children: "Current Structure Most Similar To" }), analogs?.top_pattern_summary ? ((0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.92rem', fontWeight: 700, marginTop: 8 }, children: analogs.top_pattern_summary })) : null] }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#64748b', fontSize: '0.8rem', maxWidth: 420, lineHeight: 1.55 }, children: "Historical VR-tagged events ranked by deterministic similarity to the current market structure." })] }), analogs?.analog_events.length ? ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 12 }, children: [analogs.analog_events.slice(0, 3).map((event, index) => ((0, jsx_runtime_1.jsxs)("div", { style: {
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 16,
                            padding: '1rem',
                            display: 'grid',
                            gridTemplateColumns: '72px 1fr',
                            gap: 12,
                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.9rem', fontWeight: 800, paddingTop: 4 }, children: `${index + 1}.` }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 8 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 4 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }, children: eventLabel(event.event_id) }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.88rem' }, children: titleize(event.pattern_type) })] }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#e5e7eb', fontSize: '0.9rem', fontWeight: 800 }, children: `Similarity ${event.similarity_score}%` })] }), event.summary ? ((0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.55 }, children: event.summary })) : null, (0, jsx_runtime_1.jsx)("div", { children: (0, jsx_runtime_1.jsx)("a", { href: `/vr-survival?tab=Playback&event=${event.event_id}`, style: {
                                                textDecoration: 'none',
                                                color: '#cbd5e1',
                                                fontSize: '0.84rem',
                                                fontWeight: 700,
                                                padding: '0.55rem 0.8rem',
                                                borderRadius: 999,
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                background: 'rgba(255,255,255,0.03)',
                                                display: 'inline-flex',
                                            }, children: "Open Playback" }) })] })] }, event.event_id))), analogs.context_note ? ((0, jsx_runtime_1.jsxs)("div", { style: {
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 16,
                            padding: '1rem',
                        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }, children: "What This Means" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }, children: analogs.context_note })] })) : null] })) : ((0, jsx_runtime_1.jsxs)("div", { style: {
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 16,
                    padding: '1rem',
                    color: '#94a3b8',
                    fontSize: '0.9rem',
                }, children: [(0, jsx_runtime_1.jsx)("div", { children: "No strong historical analog detected." }), (0, jsx_runtime_1.jsx)("div", { style: { marginTop: 8, fontSize: '0.82rem', color: '#64748b' }, children: "The current structure does not closely match the curated historical VR event set." })] }))] }));
}
