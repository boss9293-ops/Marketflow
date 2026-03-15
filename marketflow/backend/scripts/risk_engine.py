"""
risk_engine.py — Computes Risk Engine metrics for the Overview page.

Reads existing cache files (no new DB queries) and derives:
  - shock_probability  : heuristic 30-day drawdown probability
  - defensive_trigger  : ON/OFF based on gate_score / risk_level / trend
  - phase_transition   : market cycle phase + progress %
  - tail_risk          : CVaR-based sigma gauge

Output: backend/output/cache/risk_engine.json
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime


# ── Path resolution ───────────────────────────────────────────────────────────

def _find_root() -> str:
    _cand = os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    )
    if os.path.exists(os.path.join(_cand, 'data', 'marketflow.db')):
        return _cand
    for _item in os.listdir(r'd:\Youtube_pro\000-Code_develop'):
        _full = os.path.join(
            r'd:\Youtube_pro\000-Code_develop', _item,
            'us_market_complete', 'marketflow'
        )
        if os.path.exists(os.path.join(_full, 'data', 'marketflow.db')):
            return _full
    return _cand


ROOT = _find_root()
CACHE_DIR = os.path.join(ROOT, 'backend', 'output', 'cache')


# ── Loaders ───────────────────────────────────────────────────────────────────

def _load(filename: str) -> dict:
    p = os.path.join(CACHE_DIR, filename)
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def _load_safe(filename: str) -> dict:
    try:
        return _load(filename)
    except Exception:
        return {}


# ── Shock Probability ─────────────────────────────────────────────────────────

def compute_shock_probability(
    gate_score: float | None,
    risk_level: str,
    risk_trend: str,
    gate_delta5d: float | None,
    vix_last: float | None,
) -> dict:
    vix = vix_last or 20.0

    # Base from VIX
    if vix < 13:
        base = 6
    elif vix < 16:
        base = 10
    elif vix < 20:
        base = 17
    elif vix < 25:
        base = 28
    elif vix < 30:
        base = 40
    else:
        base = 58

    # Adjustments
    rl = risk_level.upper()
    if rl == 'HIGH':
        base += 12
    elif rl == 'LOW':
        base -= 6

    rt = risk_trend
    if rt == 'Deteriorating':
        base += 8
    elif rt == 'Improving':
        base -= 5

    gs = gate_score or 50.0
    if gs < 35:
        base += 12
    elif gs < 45:
        base += 5
    elif gs > 65:
        base -= 5
    elif gs > 75:
        base -= 8

    gd = gate_delta5d or 0.0
    if gd < -12:
        base += 7
    elif gd < -6:
        base += 3
    elif gd > 6:
        base -= 3

    prob = max(3, min(80, round(base)))

    # Trend direction
    trend = 'Increasing' if (gd < -5 or rt == 'Deteriorating') else 'Decreasing'
    trend_icon = '↑' if trend == 'Increasing' else '↓'

    if prob < 20:
        color, border, label = '#22c55e', '#22c55e', 'Low'
    elif prob < 35:
        color, border, label = '#f59e0b', '#f59e0b', 'Moderate'
    else:
        color, border, label = '#ef4444', '#ef4444', 'Elevated'

    return {
        'value': prob,
        'label': label,
        'trend': trend,
        'trend_icon': trend_icon,
        'color': color,
        'border_color': border,
        'description': (
            f'Probability of >5% drawdown in next 30 days. '
            f'VIX={vix:.1f}, Gate delta={gd:+.1f}, Risk={rl}'
        ),
    }


# ── Defensive Trigger ─────────────────────────────────────────────────────────

def compute_defensive_trigger(
    gate_score: float | None,
    risk_level: str,
    pct_from_sma200: float | None,
    qqq_sma200: float | None,
    risk_trend: str,
) -> dict:
    gs = gate_score or 50.0
    rl = risk_level.upper()
    pct = pct_from_sma200 or 0.0

    conditions: list[str] = []
    if gs < 40:
        conditions.append(f'Gate score {gs:.1f} < 40')
    if rl == 'HIGH':
        conditions.append('Risk level HIGH')
    if pct < -3:
        conditions.append(f'QQQ {pct:+.1f}% below SMA200')

    active = len(conditions) > 0

    trigger_level = round(qqq_sma200 * 0.97, 2) if qqq_sma200 else None

    if active:
        reason = '; '.join(conditions)
        color, border = '#ef4444', '#ef4444'
    else:
        parts = []
        if pct > 0:
            parts.append(f'QQQ +{pct:.1f}% above SMA200')
        if gs >= 50:
            parts.append(f'Gate score {gs:.1f}')
        reason = '. '.join(parts) if parts else 'All conditions nominal.'
        color, border = '#3b82f6', '#3b82f6'

    return {
        'active': active,
        'label': 'ON' if active else 'OFF',
        'status': 'Risk-Off' if active else 'Risk-On',
        'color': color,
        'border_color': border,
        'reason': reason,
        'trigger_level': trigger_level,
        'conditions_met': len(conditions),
    }


# ── Phase Transition ──────────────────────────────────────────────────────────

CYCLE_PHASES = ['Recovery', 'Expansion', 'Slowdown', 'Contraction']

_PHASE_MAP = {
    'BULL': 'Expansion',
    'BULLISH': 'Expansion',
    'NEUTRAL': 'Recovery',
    'DEFENSIVE': 'Slowdown',
    'SHOCK': 'Contraction',
    'BEARISH': 'Contraction',
    'BEAR': 'Contraction',
}

_PHASE_COLORS = {
    'Recovery': '#3b82f6',
    'Expansion': '#22c55e',
    'Slowdown': '#f59e0b',
    'Contraction': '#ef4444',
}


def compute_phase_transition(
    market_phase: str,
    gate_score: float | None,
    risk_trend: str,
    phase_shift_flag: int,
) -> dict:
    mp = market_phase.upper()
    # Refine Neutral by trend
    if mp == 'NEUTRAL':
        mp = 'BULLISH' if risk_trend == 'Improving' else 'DEFENSIVE'

    current = _PHASE_MAP.get(mp, 'Recovery')
    idx = CYCLE_PHASES.index(current)
    gs = gate_score or 50.0

    # Progress within phase
    if current == 'Expansion':
        progress = min(95, max(5, int(gs)))
    elif current == 'Recovery':
        progress = min(95, max(5, int(gs * 0.75)))
    elif current == 'Slowdown':
        progress = min(95, max(5, int(100 - gs)))
    else:  # Contraction
        progress = min(95, max(5, int(max(5, 50 - gs * 0.4))))

    color = _PHASE_COLORS.get(current, '#6b7280')
    transitioning = phase_shift_flag == 1

    next_phase = CYCLE_PHASES[(idx + 1) % 4]
    desc = (
        f'Phase transition signal active — watch for shift to {next_phase}. '
        if transitioning else
        f'Progressing through {current} phase. '
    ) + f'Gate score: {gs:.1f}/100.'

    return {
        'phase': current,
        'phase_idx': idx,
        'progress': progress,
        'color': color,
        'border_color': color,
        'all_phases': CYCLE_PHASES,
        'transition_signal': transitioning,
        'next_phase': next_phase,
        'description': desc,
    }


# ── Tail Risk Gauge ───────────────────────────────────────────────────────────

def compute_tail_risk(
    cvar95_port: float | None,
    portfolio_vol: float | None,
    vix_last: float | None,
) -> dict:
    cv = cvar95_port or -1.65
    pv = portfolio_vol or 15.0
    vix = vix_last or 20.0

    daily_vol = pv / math.sqrt(252)
    sigma = round(abs(cv) / daily_vol, 1) if daily_vol > 0 else 1.65

    # VIX skew
    if vix > 28:
        skew_label, skew_color = 'High Skew', '#ef4444'
    elif vix > 22:
        skew_label, skew_color = 'Elevated Skew', '#f59e0b'
    elif vix > 16:
        skew_label, skew_color = 'Normal Range', '#6b7280'
    else:
        skew_label, skew_color = 'Low Skew', '#22c55e'

    if sigma < 1.5:
        color, border, label = '#22c55e', '#22c55e', 'Contained'
    elif sigma < 2.0:
        color, border, label = '#f59e0b', '#f59e0b', 'Moderate'
    elif sigma < 2.5:
        color, border, label = '#f97316', '#f97316', 'Elevated'
    else:
        color, border, label = '#ef4444', '#ef4444', 'High'

    return {
        'sigma': sigma,
        'label': label,
        'skew_label': skew_label,
        'skew_color': skew_color,
        'color': color,
        'border_color': border,
        'cvar95': cv,
        'portfolio_vol': pv,
        'description': (
            f'CVaR(95%) = {cv:.2f}%. '
            f'Portfolio vol = {pv:.1f}% annualized. '
            f'VIX: {vix:.2f}.'
        ),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    overview = _load('overview.json')
    tape     = _load_safe('market_tape.json')
    state    = _load_safe('market_state.json')

    vix_item = next(
        (i for i in tape.get('items', []) if i.get('symbol') == 'VIX'), None
    )
    vix_last: float | None = vix_item.get('last') if vix_item else None

    gate_score    = overview.get('gate_score')
    risk_level    = (overview.get('risk_level') or 'MEDIUM')
    risk_trend    = (overview.get('risk_trend') or 'Stable')
    gate_delta5d  = overview.get('gate_delta5d')
    pct_sma200    = overview.get('pct_from_sma200')
    qqq_sma200    = overview.get('qqq_sma200')
    market_phase  = (overview.get('market_phase') or 'NEUTRAL')
    phase_shift   = int(overview.get('phase_shift_flag') or 0)
    cvar95        = overview.get('cvar95_port')
    port_vol      = overview.get('portfolio_volatility')

    shock    = compute_shock_probability(gate_score, risk_level, risk_trend, gate_delta5d, vix_last)
    defense  = compute_defensive_trigger(gate_score, risk_level, pct_sma200, qqq_sma200, risk_trend)
    phase    = compute_phase_transition(market_phase, gate_score, risk_trend, phase_shift)
    tail     = compute_tail_risk(cvar95, port_vol, vix_last)

    result = {
        'generated_at':      datetime.now().isoformat(),
        'data_date':         overview.get('latest_date') or overview.get('gate_date'),
        'shock_probability': shock,
        'defensive_trigger': defense,
        'phase_transition':  phase,
        'tail_risk':         tail,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    out_path = os.path.join(CACHE_DIR, 'risk_engine.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(
        f'risk_engine.json written — '
        f'shock={shock["value"]}% ({shock["label"]}), '
        f'trigger={defense["label"]}, '
        f'phase={phase["phase"]} {phase["progress"]}%, '
        f'sigma={tail["sigma"]} ({tail["label"]})'
    )


if __name__ == '__main__':
    main()
