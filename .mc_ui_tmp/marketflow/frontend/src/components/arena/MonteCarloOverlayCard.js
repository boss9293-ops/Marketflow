"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MonteCarloOverlayCard;
const jsx_runtime_1 = require("react/jsx-runtime");
function formatScore(value) {
    return `${Math.round(value)}`;
}
function scoreRow(label, value, detail) {
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.2fr) auto',
            gap: 12,
            alignItems: 'start',
            padding: '0.65rem 0',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
        }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#e5e7eb', fontSize: '0.84rem', fontWeight: 700 }, children: label }), detail ? (0, jsx_runtime_1.jsx)("div", { style: { color: '#94a3b8', fontSize: '0.76rem', marginTop: 4 }, children: detail }) : null] }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '0.92rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }, children: value })] }, label));
}
function MonteCarloOverlayCard({ model, }) {
    if (!model.mcOverlay) {
        return ((0, jsx_runtime_1.jsxs)("div", { style: {
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 18,
                padding: '1rem 1.05rem',
            }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }, children: "Monte Carlo Overlay" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.84rem', lineHeight: 1.6, marginTop: 10 }, children: "Monte Carlo overlay unavailable. The rule-based warning layer remains active and unchanged." }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.6, marginTop: 12 }, children: ["Monte Carlo overlay summarizes how similar synthetic stress paths behaved.", (0, jsx_runtime_1.jsx)("br", {}), "Overlay is interpretive, not executable."] })] }));
    }
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 18,
            padding: '1rem 1.05rem',
        }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }, children: "Monte Carlo Overlay" }), (0, jsx_runtime_1.jsx)("div", { style: { color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.55, marginTop: 8 }, children: model.mcOverlay.overlayReason }), (0, jsx_runtime_1.jsxs)("div", { style: { marginTop: 14 }, children: [scoreRow('Crash Risk', formatScore(model.mcOverlay.mcCrashRiskScore), 'Continuation / further damage risk'), scoreRow('V-Shape Odds (20d)', formatScore(model.mcOverlay.mcVShapeOdds20d), 'Strong rebound odds in the next 20 trading days'), scoreRow('Recovery Odds (20d)', formatScore(model.mcOverlay.mcRecoveryOdds20d), 'Broader stabilization and recovery odds'), scoreRow('Cash Stress Risk', formatScore(model.mcOverlay.mcCashStressRisk), 'Cash-floor / cycle-cap stress on constrained strategies'), scoreRow('False Recovery Risk', formatScore(model.mcOverlay.mcFalseRecoveryRisk), 'Dead-cat / false-bottom risk'), scoreRow('Warning Confidence', formatScore(model.mcOverlay.mcWarningConfidence), 'How informative similar warning states were'), scoreRow('Dominant MC Scenario', model.mcOverlay.dominantMcScenario)] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.6, marginTop: 12 }, children: ["Monte Carlo overlay summarizes how similar synthetic stress paths behaved.", (0, jsx_runtime_1.jsx)("br", {}), "Overlay is interpretive, not executable."] })] }));
}
