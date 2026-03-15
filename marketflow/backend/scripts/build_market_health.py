#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_market_health.py v2.0
Market Health 4-score system (25pts each, 0-100 total).
Reads overview.json + market_tape.json; outputs market_health.json.
"""
from __future__ import annotations
import json, os, sys
from datetime import datetime


def _find_root() -> str:
    cand = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    if os.path.exists(os.path.join(cand, 'data', 'marketflow.db')):
        return cand
    base = r'd:\\Youtube_pro\\000-Code_develop'
    for item in os.listdir(base):
        full = os.path.join(base, item, 'us_market_complete', 'marketflow')
        if os.path.exists(os.path.join(full, 'data', 'marketflow.db')):
            return full
    return cand


ROOT = _find_root()
CACHE_DIR = os.path.join(ROOT, 'backend', 'output', 'cache')
OUTPUT_PATH = os.path.join(CACHE_DIR, 'market_health.json')


def _load(filename: str) -> dict:
    for p in [os.path.join(CACHE_DIR, filename), os.path.join(ROOT, 'backend', 'output', filename)]:
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
    return {}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ── Score 1: Trend Alignment 0-25 ──────────────────────────────────────────
def compute_trend(dist_pct, gate_score, risk_trend) -> dict:
    d = dist_pct if dist_pct is not None else 0.0
    if d >= 15:    base = 25
    elif d >= 10:  base = 22
    elif d >= 5:   base = 18
    elif d >= 0:   base = 14
    elif d >= -5:  base = 10
    elif d >= -10: base = 6
    else:          base = 2

    gs = gate_score if gate_score is not None else 50.0
    gate_adj = 3 if gs >= 70 else (1 if gs >= 55 else (0 if gs >= 40 else (-1 if gs >= 25 else -3)))

    rt = (risk_trend or '').upper()
    trend_adj = 2 if rt == 'IMPROVING' else (-2 if rt == 'DETERIORATING' else 0)

    score = int(clamp(base + gate_adj + trend_adj, 0, 25))
    if score >= 22:   lk, le, cf = '\uc5c8\uc138', 'Bullish', 90
    elif score >= 17: lk, le, cf = '\uc591\ud638', 'Good', 75
    elif score >= 11: lk, le, cf = '\ud63c\uc870', 'Mixed', 60
    elif score >= 6:  lk, le, cf = '\uc57d\uc138', 'Weak', 70
    else:             lk, le, cf = '\ub9e4\uc6b0\uc57d\uc138', 'Very Weak', 85

    return {'score': score, 'max': 25, 'label_ko': lk, 'label_en': le, 'confidence': cf}


# ── Score 2: Volatility Stability 0-25 ──────────────────────────────────────
def compute_volatility(vix, port_vol) -> dict:
    v = vix if vix is not None else 20.0
    if v < 14:   base = 25
    elif v < 16: base = 22
    elif v < 18: base = 20
    elif v < 20: base = 17
    elif v < 23: base = 13
    elif v < 27: base = 9
    elif v < 32: base = 5
    else:         base = 2

    pv = port_vol if port_vol is not None else 0.15
    vol_adj = 2 if pv < 0.10 else (1 if pv < 0.14 else (0 if pv < 0.18 else (-1 if pv < 0.22 else -3)))

    score = int(clamp(base + vol_adj, 0, 25))
    if score >= 22:   lk, le, cf = '\uc548\uc815', 'Stable', 92
    elif score >= 17: lk, le, cf = '\ubcf4\ud1b5', 'Normal', 78
    elif score >= 11: lk, le, cf = '\uacbd\uacc4', 'Caution', 68
    elif score >= 6:  lk, le, cf = '\ubd88\uc548', 'Unstable', 75
    else:             lk, le, cf = '\uc704\ud5d8', 'Danger', 88

    return {'score': score, 'max': 25, 'label_ko': lk, 'label_en': le, 'confidence': cf}


# ── Score 3: Market Breadth 0-25 ────────────────────────────────────────────
def compute_breadth(gate_score, gate_delta5d) -> dict:
    gs = gate_score if gate_score is not None else 50.0
    gd = gate_delta5d if gate_delta5d is not None else 0.0
    base = round(gs / 100.0 * 25)
    delta_adj = 3 if gd >= 5 else (1 if gd >= 2 else (0 if gd >= -2 else (-1 if gd >= -5 else -3)))

    score = int(clamp(base + delta_adj, 0, 25))
    if score >= 22:   lk, le, cf = '\uc2dc\uc7a5\ud655\uc0b0', 'Strong Breadth', 88
    elif score >= 17: lk, le, cf = '\ubcf4\ud1b5\ud655\uc0b0', 'Normal Breadth', 74
    elif score >= 11: lk, le, cf = '\ud611\uc18c', 'Narrow', 65
    elif score >= 6:  lk, le, cf = '\ub9e4\uc6b0\ud611\uc18c', 'Very Narrow', 72
    else:             lk, le, cf = '\ubd95\uad34', 'Breakdown', 82

    return {'score': score, 'max': 25, 'label_ko': lk, 'label_en': le, 'confidence': cf}


# ── Score 4: Liquidity State 0-25 ───────────────────────────────────────────
def compute_liquidity(vix, risk_level, dxy_chg_pct) -> dict:
    v = vix if vix is not None else 20.0
    vix_sub = 10 if v < 15 else (8 if v < 18 else (6 if v < 22 else (3 if v < 27 else 1)))

    rl = (risk_level or '').upper()
    risk_sub = 8 if rl in ('LOW', 'LOW_RISK') else (6 if rl == 'MODERATE' else (3 if rl in ('ELEVATED', 'HIGH') else 5))

    dx = dxy_chg_pct if dxy_chg_pct is not None else 0.0
    dxy_sub = 7 if dx <= -1.0 else (6 if dx <= -0.3 else (5 if dx <= 0.3 else (3 if dx <= 1.0 else 1)))

    score = int(clamp(vix_sub + risk_sub + dxy_sub, 0, 25))
    if score >= 22:   lk, le, cf = '\ud48d\ubd80', 'Abundant', 85
    elif score >= 17: lk, le, cf = '\ubcf4\ud1b5', 'Normal', 72
    elif score >= 11: lk, le, cf = '\ud0c0\uc774\ud2b8', 'Tight', 67
    elif score >= 6:  lk, le, cf = '\uc704\ud5d8', 'Danger', 75
    else:             lk, le, cf = '\uacbd\uc0c9', 'Frozen', 88

    return {'score': score, 'max': 25, 'label_ko': lk, 'label_en': le, 'confidence': cf}


# ── Total bucket ─────────────────────────────────────────────────────────────
def total_bucket(total: int):
    if total >= 75:   return '\uac74\uac15', 'Healthy', '#22c55e'
    elif total >= 55: return '\uc591\ud638', 'Good', '#84cc16'
    elif total >= 40: return '\uc911\ub9bd', 'Neutral', '#f59e0b'
    elif total >= 20: return '\uacbd\uacc4', 'Caution', '#ef4444'
    else:             return '\uc704\ud5d8', 'Danger', '#dc2626'


# ── Korean narrative ─────────────────────────────────────────────────────────
def generate_narrative(trend: dict, vol: dict, breadth: dict, liq: dict, total: int) -> dict:
    label_ko, label_en, color = total_bucket(total)

    TREND_P = {
        '\uc5c8\uc138': '\ucd94\uc138 \uad6c\uc870\ub294 \uc0c1\uc2b9 \ud750\ub984\uc744 \uc720\uc9c0\ud558\uba70',
        '\uc591\ud638': '\ucd94\uc138 \uc815\ub82c\uc774 \uc591\ud638\ud55c \uc0c1\ud0dc\uc5d0\uc11c',
        '\ud63c\uc870': '\ucd94\uc138\ub294 \ud63c\uc870\uc138\ub97c \ubcf4\uc774\uba70',
        '\uc57d\uc138': '\ucd94\uc138\uac00 \uc57d\ud654\ub418\ub294 \ud750\ub984 \uc18d\uc5d0\uc11c',
        '\ub9e4\uc6b0\uc57d\uc138': '\ucd94\uc138 \uad6c\uc870\uac00 \ud06c\uac8c \ud6fc\uc190\ub41c \uc0c1\ud669\uc5d0\uc11c',
    }
    VOL_P = {
        '\uc548\uc815': '\ubcc0\ub3d9\uc131\uc740 \ub9e4\uc6b0 \uc548\uc815\uc801\uc785\ub2c8\ub2e4.',
        '\ubcf4\ud1b5': '\ubcc0\ub3d9\uc131\uc740 \ud1b5\uc81c \uac00\ub2a5\ud55c \uc218\uc900\uc785\ub2c8\ub2e4.',
        '\uacbd\uacc4': '\ubcc0\ub3d9\uc131 \ud655\ub300\uc5d0 \uacbd\uacc4\uac00 \ud544\uc694\ud569\ub2c8\ub2e4.',
        '\ubd88\uc548': '\ubcc0\ub3d9\uc131\uc774 \ubd88\uc548\uc815\ud558\uac8c \ud655\ub300\ub418\uace0 \uc788\uc2b5\ub2c8\ub2e4.',
        '\uc704\ud5d8': '\ubcc0\ub3d9\uc131\uc774 \uc704\ud5d8 \uc218\uc900\uc5d0 \ub2ec\ud574 \uc788\uc2b5\ub2c8\ub2e4.',
    }
    BREADTH_P = {
        '\uc2dc\uc7a5\ud655\uc0b0': '\uc2dc\uc7a5 \ud655\uc0b0 \uac15\ub3c4\ub3c4 \ub113\uace0 \uac15\ud558\uba70',
        '\ubcf4\ud1b5\ud655\uc0b0': '\uc2dc\uc7a5 \ud655\uc0b0\uc740 \ud3c9\uade0\uc801 \uc218\uc900\uc774\uba70',
        '\ud611\uc18c': '\uc2dc\uc7a5 \ud655\uc0b0\uc774 \uc88c\uc544\uc9c0\uace0 \uc788\uc73c\uba70',
        '\ub9e4\uc6b0\ud611\uc18c': '\uc18c\uc218 \uc885\ubaa9\uc5d0 \uc9d1\uc911\ub41c \uc88c\uc740 \uc2dc\uc7a5\uc774\uba70',
        '\ubd95\uad34': '\uc2dc\uc7a5 \ud655\uc0b0\uc774 \ud06c\uac8c \ubd95\uad34\ub418\uc5b4 \uc788\uc73c\uba70',
    }
    LIQ_P = {
        '\ud48d\ubd80': '\uc720\ub3d9\uc131\uc740 \ud48d\ubd80\ud569\ub2c8\ub2e4.',
        '\ubcf4\ud1b5': '\uc720\ub3d9\uc131\uc740 \uc801\uc815 \uc218\uc900\uc785\ub2c8\ub2e4.',
        '\ud0c0\uc774\ud2b8': '\uc720\ub3d9\uc131\uc774 \ub2e4\uc18c \ud0c0\uc774\ud2b8\ud569\ub2c8\ub2e4.',
        '\uc704\ud5d8': '\uc720\ub3d9\uc131 \uc0c1\ud0dc\uac00 \uc704\ud5d8 \uc218\uc900\uc785\ub2c8\ub2e4.',
        '\uacbd\uc0c9': '\uc720\ub3d9\uc131\uc774 \uae09\uaca9\ud788 \uacbd\uc0c9\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4.',
    }

    t = TREND_P.get(trend['label_ko'], '\ucd94\uc138\ub294 \uc911\ub9bd \uc0c1\ud0dc\uc774\uba70')
    v = VOL_P.get(vol['label_ko'], '\ubcc0\ub3d9\uc131\uc740 \ubcf4\ud1b5\uc785\ub2c8\ub2e4.')
    b = BREADTH_P.get(breadth['label_ko'], '\uc2dc\uc7a5 \ud655\uc0b0\uc740 \uc911\ub9bd\uc785\ub2c8\ub2e4.')
    l = LIQ_P.get(liq['label_ko'], '\uc720\ub3d9\uc131\uc740 \uc801\uc815 \uc218\uc900\uc785\ub2c8\ub2e4.')

    ko = f'{t} {b} {l} {v}'
    en = (f'Market health score {total}/100 ({label_en}). '
          f'Trend: {trend["label_en"]}, Volatility: {vol["label_en"]}, '
          f'Breadth: {breadth["label_en"]}, Liquidity: {liq["label_en"]}.')

    return {'ko': ko, 'en': en, 'label_ko': label_ko, 'label_en': label_en, 'color': color, 'total': total}


# ── Positioning guide ────────────────────────────────────────────────────────
def compute_positioning(total: int) -> dict:
    if total >= 75:
        return {'equity_tilt': '\uc801\uadf9 \ud655\ub300', 'risk_posture': '\uacf5\uaca9\uc801',
                'exposure_band': '80-100%', 'rebalance_bias': '\ucd94\uac00 \ub9e4\uc218'}
    elif total >= 55:
        return {'equity_tilt': '\ube44\uc911 \uc720\uc9c0', 'risk_posture': '\uc911\ub9bd',
                'exposure_band': '60-80%', 'rebalance_bias': '\ud640\ub4dc'}
    elif total >= 40:
        return {'equity_tilt': '\uc18c\ud3ed \ucd95\uc18c', 'risk_posture': '\ubc29\uc5b4\uc801',
                'exposure_band': '40-60%', 'rebalance_bias': '\ubd80\ubd84 \ucc28\uc775'}
    elif total >= 20:
        return {'equity_tilt': '\uc801\uadf9 \ucd95\uc18c', 'risk_posture': '\ub9ac\uc2a4\ud06c \uc624\ud504',
                'exposure_band': '20-40%', 'rebalance_bias': '\ud5e4\uc9c0 \uac15\ud654'}
    else:
        return {'equity_tilt': '\ud604\uae08 \uc804\ud658', 'risk_posture': '\uc704\uae30 \ub300\uc751',
                'exposure_band': '0-20%', 'rebalance_bias': '\uc804\uba74 \ucd95\uc18c'}


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    overview = _load('overview.json')
    tape = _load('market_tape.json')

    gate_score   = overview.get('gate_score')
    risk_level   = overview.get('risk_level')
    risk_trend   = overview.get('risk_trend')
    gate_delta5d = overview.get('gate_delta5d')
    dist_pct     = overview.get('dist_pct')
    qqq_close    = overview.get('qqq_close')
    qqq_sma200   = overview.get('qqq_sma200')
    port_vol     = overview.get('portfolio_volatility')
    data_date    = overview.get('data_date')

    if dist_pct is None and qqq_close and qqq_sma200 and qqq_sma200 > 0:
        dist_pct = ((qqq_close / qqq_sma200) - 1) * 100

    vix_last = None
    dxy_chg_pct = None
    if tape and isinstance(tape.get('items'), list):
        for item in tape['items']:
            sym = (item.get('symbol') or '').upper()
            if sym == 'VIX':
                vix_last = item.get('last')
            elif sym == 'DXY':
                dxy_chg_pct = item.get('chg_pct')

    if vix_last is None:
        md = _load('market_data.json')
        if md:
            vix_last = (md.get('volatility') or {}).get('vix_last')

    trend_r   = compute_trend(dist_pct, gate_score, risk_trend)
    vol_r     = compute_volatility(vix_last, port_vol)
    breadth_r = compute_breadth(gate_score, gate_delta5d)
    liq_r     = compute_liquidity(vix_last, risk_level, dxy_chg_pct)

    total     = trend_r['score'] + vol_r['score'] + breadth_r['score'] + liq_r['score']
    narrative = generate_narrative(trend_r, vol_r, breadth_r, liq_r, total)
    positioning = compute_positioning(total)
    label_ko, label_en, color = total_bucket(total)

    result = {
        'generated_at': datetime.now().isoformat(),
        'data_date': data_date,
        'total': total,
        'label_ko': label_ko,
        'label_en': label_en,
        'color': color,
        'scores': {
            'trend':      trend_r,
            'volatility': vol_r,
            'breadth':    breadth_r,
            'liquidity':  liq_r,
        },
        'narrative': narrative,
        'positioning': positioning,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    sys.stdout.buffer.write(
        f'market_health.json written: total={total} ({label_en})\n'.encode('utf-8', 'replace')
    )


if __name__ == '__main__':
    main()
