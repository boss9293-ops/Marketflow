"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SuggestedPostureStrip;
const jsx_runtime_1 = require("react/jsx-runtime");
function toneStyle(tone) {
    if (tone === 'defensive') {
        return {
            border: '1px solid rgba(239,68,68,0.24)',
            background: 'linear-gradient(180deg, rgba(80,16,16,0.44), rgba(22,10,10,0.92))',
            accent: '#fca5a5',
        };
    }
    if (tone === 'improving') {
        return {
            border: '1px solid rgba(34,197,94,0.22)',
            background: 'linear-gradient(180deg, rgba(12,52,26,0.44), rgba(9,18,14,0.92))',
            accent: '#86efac',
        };
    }
    if (tone === 'cautious') {
        return {
            border: '1px solid rgba(245,158,11,0.22)',
            background: 'linear-gradient(180deg, rgba(74,43,10,0.42), rgba(18,15,9,0.92))',
            accent: '#fcd34d',
        };
    }
    return {
        border: '1px solid rgba(96,165,250,0.2)',
        background: 'linear-gradient(180deg, rgba(13,34,58,0.4), rgba(9,13,20,0.92))',
        accent: '#93c5fd',
    };
}
function SuggestedPostureStrip({ message, }) {
    const fallback = {
        headline: 'No posture summary available yet.',
        subline: 'Current scenario interpretation is still loading.',
        posture_tags: [],
        tone: 'neutral',
    };
    const current = message ?? fallback;
    const tone = toneStyle(current.tone);
    const accent = tone.accent ?? '#93c5fd';
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            border: tone.border,
            background: tone.background,
            borderRadius: 18,
            padding: '1rem 1.15rem',
            boxShadow: '0 14px 30px rgba(0,0,0,0.16)',
        }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gap: 8 }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: accent, fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }, children: "Suggested Posture" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.35 }, children: current.headline }), current.subline ? ((0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.55 }, children: current.subline })) : null] }), (0, jsx_runtime_1.jsx)("div", { style: {
                            padding: '0.35rem 0.65rem',
                            borderRadius: 999,
                            border: tone.border,
                            color: accent,
                            background: 'rgba(255,255,255,0.03)',
                            fontSize: '0.76rem',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                        }, children: current.tone })] }), current.posture_tags?.length ? ((0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }, children: current.posture_tags.slice(0, 3).map((item) => ((0, jsx_runtime_1.jsx)("div", { style: {
                        padding: '0.45rem 0.7rem',
                        borderRadius: 999,
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'rgba(255,255,255,0.03)',
                        color: '#e5e7eb',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                    }, children: item }, item))) })) : null] }));
}
