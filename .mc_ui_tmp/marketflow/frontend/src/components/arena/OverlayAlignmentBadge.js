"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = OverlayAlignmentBadge;
const jsx_runtime_1 = require("react/jsx-runtime");
function tone(alignment) {
    switch (alignment) {
        case 'ALIGNED':
            return {
                border: '1px solid rgba(16,185,129,0.32)',
                background: 'rgba(16,185,129,0.12)',
                color: '#34d399',
            };
        case 'CONFLICTED':
            return {
                border: '1px solid rgba(251,146,60,0.32)',
                background: 'rgba(251,146,60,0.12)',
                color: '#fb923c',
            };
        default:
            return {
                border: '1px solid rgba(148,163,184,0.24)',
                background: 'rgba(148,163,184,0.08)',
                color: '#cbd5e1',
            };
    }
}
function OverlayAlignmentBadge({ alignment, note, }) {
    const palette = tone(alignment);
    return ((0, jsx_runtime_1.jsxs)("div", { style: {
            ...palette,
            borderRadius: 14,
            padding: '0.9rem 1rem',
        }, children: [(0, jsx_runtime_1.jsxs)("div", { style: {
                    fontSize: '0.72rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    fontWeight: 800,
                    marginBottom: 6,
                }, children: ["Interpretation ", alignment] }), (0, jsx_runtime_1.jsx)("div", { style: { fontSize: '0.82rem', lineHeight: 1.55 }, children: note })] }));
}
