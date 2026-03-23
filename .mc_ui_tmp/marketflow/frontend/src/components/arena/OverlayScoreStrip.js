"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = OverlayScoreStrip;
const jsx_runtime_1 = require("react/jsx-runtime");
function formatScore(value) {
    return value == null || Number.isNaN(value) ? 'n/a' : `${Math.round(value)}`;
}
function tile(label, text, detail) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14,
            padding: '0.8rem 0.9rem',
            minHeight: 88,
        }, children: [(0, jsx_runtime_1.jsx)("div", { style: {
                    fontSize: '0.7rem',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                }, children: label }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.96rem', fontWeight: 800, marginTop: 8 }, children: text }), detail ? (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.78rem', marginTop: 8, lineHeight: 1.45 }, children: detail }) : null] }, label));
}
function OverlayScoreStrip({ model, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }, children: [tile('Warning State', model.warningState.split('_').join(' '), model.warningReason ?? undefined), tile('Scenario Hint', model.scenarioHint), tile('MC Crash Risk', model.mcOverlay ? formatScore(model.mcOverlay.mcCrashRiskScore) : 'Unavailable', model.mcOverlay ? '0-100 overlay score' : 'Monte Carlo overlay unavailable'), tile('MC Recovery Odds (20d)', model.mcOverlay ? formatScore(model.mcOverlay.mcRecoveryOdds20d) : 'Unavailable', model.mcOverlay ? 'Meaningful recovery odds' : 'Rule-based warning remains primary'), tile('MC Bear Similarity', model.mcOverlay ? formatScore(model.mcOverlay.mcBearPathSimilarity) : 'Unavailable', model.mcOverlay ? 'Grinding-bear path similarity' : 'No MC library loaded')] }));
}
