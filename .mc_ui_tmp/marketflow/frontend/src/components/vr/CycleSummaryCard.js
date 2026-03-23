"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CycleSummaryCard;
const jsx_runtime_1 = require("react/jsx-runtime");
// ── Helpers ──────────────────────────────────────────────────────────────────
function ddColor(dd) {
    if (dd < -40)
        return '#fca5a5'; // red-300
    if (dd < -20)
        return '#fb923c'; // orange-400
    return '#86efac'; // green-300
}
function fmtDd(dd) {
    return (dd >= 0 ? '+' : '') + dd.toFixed(1) + '%';
}
function recoveryDays(cs) {
    if (!cs.end_date || !cs.start_date)
        return null;
    const ms = new Date(cs.end_date).getTime() - new Date(cs.start_date).getTime();
    if (isNaN(ms) || ms < 0)
        return null;
    return Math.round(ms / 86400000);
}
// ── Sub-component ─────────────────────────────────────────────────────────────
function CycleCard({ cs }) {
    const dd = cs.start_evaluation_value > 0
        ? ((cs.end_evaluation_value / cs.start_evaluation_value) - 1) * 100
        : 0;
    const color = ddColor(dd);
    const days = recoveryDays(cs);
    const pool = cs.pool_used_pct_in_cycle;
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            flexShrink: 0,
            width: 110,
            padding: '0.6rem 0.75rem',
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
        }, children: [(0, jsx_runtime_1.jsxs)("div", { style: {
                    fontSize: '0.62rem',
                    color: '#475569',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                }, children: ["C", cs.cycle_no] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.6rem', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "DD" }), (0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.82rem', fontWeight: 700, color, letterSpacing: '0.02em' }, children: fmtDd(dd) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.6rem', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Days" }), (0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8' }, children: days !== null ? days : '—' })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.6rem', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Pool" }), (0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }, children: pool > 0 ? pool.toFixed(0) + '%' : '—' })] })] }));
}
// ── Main export ───────────────────────────────────────────────────────────────
function CycleSummaryCard({ cycleSummaries }) {
    if (!cycleSummaries || cycleSummaries.length === 0)
        return null;
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.55rem',
            overflowX: 'auto',
            paddingBottom: '0.25rem',
            marginBottom: '0.5rem',
            scrollbarWidth: 'thin',
        }, children: [(0, jsx_runtime_1.jsx)("div", { style: {
                    flexShrink: 0,
                    paddingTop: '0.6rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                }, children: (0, jsx_runtime_1.jsx)("div", { style: {
                        fontSize: '0.62rem',
                        color: '#334155',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                    }, children: "Cycles" }) }), cycleSummaries.map((cs) => ((0, jsx_runtime_1.jsx)(CycleCard, { cs: cs }, cs.cycle_no)))] }));
}
