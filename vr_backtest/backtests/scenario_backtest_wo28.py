"""
vr_backtest/backtests/scenario_backtest_wo28.py
=================================================
WO28 -- Crash Trigger Refinement

Fixed: Anchor=MA250, Sell=50%, Re-entry=Vmin ladder + MA200
Variable: 5 Trigger variants

  A  DD5<=-12% OR DD10<=-18%              (baseline DDVel)
  B  DD5<=-12% AND DD10<=-18%             (AND filter - stricter cluster)
  C  DD5<=-10% AND DD10<=-18%             (velocity - relaxed DD5 gate)
  D  DD5<=-12% AND VIX>=25               (DD5 + volatility confirmation)
  E  DD5<=-12% AND DD10<=-18% AND VIX>=25 (cluster + volatility)

목적 : 트리거 품질 개선 → Sharpe ↑, False Signal ↓, Sell Efficiency ↑
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
import pandas as pd
import sqlite3
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import warnings
warnings.filterwarnings('ignore')

from vr_backtest.data.loader import load_tqqq
from vr_backtest.strategies.ma200_strategy      import run_ma200_strategy
from vr_backtest.strategies.adaptive_ma_strategy import run_adaptive_ma

# ── Constants ──────────────────────────────────────────────────────────────────
INITIAL_CASH    = 10_000.0
MONTHLY_CONTRIB = 250.0
RETEST_TIMEOUT  = 60
VMIN_LADDER     = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
CACHE_DB = os.path.join(ROOT_DIR, 'data', 'db', 'cache.db')
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo28_out.txt'
os.makedirs(OUT_DIR, exist_ok=True)

ALL_EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2022 Fed Bear"     : ("2021-11-01", "2023-06-30"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}
CRASH_EPISODES = {k: v for k, v in ALL_EPISODES.items() if k != "2022 Fed Bear"}

RVOL_THRESHOLD = 0.80   # TQQQ annualized 20d realized vol >= 80%  ≈  VIX > 25

TRIGGERS = {
    'A': ('DD5<=-12% OR DD10<=-18%',              'baseline DDVel'),
    'B': ('DD5<=-12% AND DD10<=-18%',              'AND cluster'),
    'C': ('DD5<=-10% AND DD10<=-18%',              'velocity (relaxed DD5)'),
    'D': (f'DD5<=-12% AND RVol20>={RVOL_THRESHOLD:.0%}',
          'DD5 + vol spike (RVol20>=80%)'),
    'E': (f'DD5<=-12% AND DD10<=-18% AND RVol20>={RVOL_THRESHOLD:.0%}',
          'cluster + vol spike'),
}

STRAT_COLORS = {
    'ma200'  : '#666666',
    'adapt_b': '#FF5722',
    'A'      : '#2196F3',
    'B'      : '#4CAF50',
    'C'      : '#FF9800',
    'D'      : '#9C27B0',
    'E'      : '#F44336',
}
STRAT_LABELS = {
    'ma200'  : 'MA200',
    'adapt_b': 'Adapt-B',
    'A'      : 'A (DD5 OR DD10)',
    'B'      : 'B (DD5 AND DD10)',
    'C'      : 'C (DD5-10% AND DD10)',
    'D'      : 'D (DD5 AND VIX)',
    'E'      : 'E (DD5 AND DD10 AND VIX)',
}


# ═══════════════════════════════════════════════════════════════════════════════
# REALIZED VOLATILITY  (VIX proxy - TQQQ 20d annualized realized vol)
# ═══════════════════════════════════════════════════════════════════════════════
# VIX (CBOE) is only available in DB from 2021-02 onwards - insufficient to cover
# crash episodes (2011/2015/2018/2020).
# Instead we use TQQQ 20d realized volatility (annualized) as a volatility-spike
# indicator.  TQQQ rvol >= 80% corresponds roughly to QQQ implied vol > 25%
# (i.e., VIX-like stress), since TQQQ leverage ~3x amplifies realized vol.
# This indicator is available for the full 2011-2026 history.

def compute_rvol20(data: pd.DataFrame) -> np.ndarray:
    """20-day rolling annualized realized volatility of TQQQ close returns."""
    close  = pd.Series(data['close'].values)
    log_r  = np.log(close / close.shift(1))
    rvol20 = log_r.rolling(20, min_periods=10).std() * np.sqrt(252)
    return rvol20.fillna(0).values


# ═══════════════════════════════════════════════════════════════════════════════
# DATA PREPARATION
# ═══════════════════════════════════════════════════════════════════════════════
def prepare_data(raw: pd.DataFrame) -> pd.DataFrame:
    data = raw.copy()
    data['date'] = pd.to_datetime(data['date'])

    s = pd.Series(data['close'].values)
    data['ma250'] = s.rolling(250, min_periods=1).mean().values

    prices = data['close'].values
    T = len(prices)
    dd5 = np.zeros(T); dd10 = np.zeros(T)
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    data['dd5']   = dd5
    data['dd10']  = dd10
    data['rvol20'] = compute_rvol20(data)
    return data


def build_triggers(data: pd.DataFrame) -> dict[str, np.ndarray]:
    dd5   = data['dd5'].values
    dd10  = data['dd10'].values
    rvol  = data['rvol20'].values

    return {
        'A': (dd5 <= -0.12) | (dd10 <= -0.18),
        'B': (dd5 <= -0.12) & (dd10 <= -0.18),
        'C': (dd5 <= -0.10) & (dd10 <= -0.18),
        'D': (dd5 <= -0.12) & (rvol >= RVOL_THRESHOLD),
        'E': (dd5 <= -0.12) & (dd10 <= -0.18) & (rvol >= RVOL_THRESHOLD),
    }


def apply_cooldown(sig: np.ndarray, cd: int = 20) -> np.ndarray:
    out = np.zeros(len(sig), dtype=bool)
    last = -(cd + 1)
    for i in range(len(sig)):
        if sig[i] and (i - last) > cd:
            out[i] = True; last = i
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# FALSE SIGNAL RATE
# ═══════════════════════════════════════════════════════════════════════════════
def false_signal_rate(data: pd.DataFrame,
                      sig_cd: np.ndarray,
                      window: int = 20,
                      threshold: float = 0.05) -> tuple[int, int, float]:
    """
    False signal: after signal fires, min price in next `window` days
    stays above signal_price * (1 - threshold).
    → crash did NOT materialize (< threshold% additional drop).
    """
    close = data['close'].values
    T = len(close)
    total = int(sig_cd.sum())
    false_cnt = 0
    for t in range(T):
        if not sig_cd[t]:
            continue
        end = min(t + window + 1, T)
        if (t + 1) >= T:
            continue
        min_future = close[t+1:end].min()
        if min_future > close[t] * (1 - threshold):
            false_cnt += 1
    rate = false_cnt / total if total > 0 else np.nan
    return false_cnt, total, rate


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE  (MA250 anchor, same logic as WO27b)
# ═══════════════════════════════════════════════════════════════════════════════
def run_anchor_strategy(data: pd.DataFrame, crash_sig: np.ndarray) -> dict:
    """Fixed MA250 anchor strategy."""
    prices  = data['close'].values
    ma200   = data['ma200'].values
    dd_arr  = data['drawdown'].values
    dates   = data['date'].values
    anchor_v = data['ma250'].values
    T = len(prices)

    equity   = np.zeros(T)
    sell_log = []

    shares = INITIAL_CASH / prices[0]
    cash   = 0.0
    state  = 'normal'

    armed_t     = 0
    armed_dist  = 0.0
    armed_price = 0.0
    ladder_done     = [False, False, False]
    crash_cooldown  = 0

    equity[0]  = shares * prices[0]
    prev_month = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price  = prices[t]
        ma200t = ma200[t] if (not np.isnan(ma200[t]) and ma200[t] > 0) else price
        dd_ath = dd_arr[t]
        date   = dates[t]

        curr_month = pd.Timestamp(date).month
        if curr_month != prev_month:
            cash      += MONTHLY_CONTRIB
            shares    += MONTHLY_CONTRIB / price
            prev_month = curr_month

        av = anchor_v[t]
        if np.isnan(av) or av <= 0:
            av = None

        # ── ARMED ──────────────────────────────────────────────────────────────
        if state == 'armed':
            days_armed = t - armed_t
            cur_av = av if av else price
            do_sell = False; stype = 'armed'

            if price >= cur_av * 0.995:
                do_sell = True
            elif days_armed >= RETEST_TIMEOUT:
                do_sell = True; stype = 'timeout'

            if do_sell:
                sell_sh  = shares * 0.50
                cash    += sell_sh * price
                shares  -= sell_sh
                dist200  = (price - ma200t) / ma200t if ma200t > 0 else 0
                sell_log.append({
                    't': t, 'date': date, 'price': price,
                    'sell_pct': 0.50, 'type': stype,
                    'dist200': armed_dist,
                    'signal_t': armed_t, 'sig_price': armed_price,
                    'days_wait': days_armed,
                })
                state = 'defensive'

        # ── DEFENSIVE ──────────────────────────────────────────────────────────
        elif state == 'defensive':
            for i, (vlevel, vbuy_pct) in enumerate(VMIN_LADDER):
                if not ladder_done[i] and dd_ath <= vlevel:
                    ladder_done[i] = True
                    buy_val = min((cash + shares * price) * vbuy_pct, cash)
                    if buy_val > 0:
                        shares += buy_val / price; cash -= buy_val
            if price > ma200t and crash_cooldown <= 0:
                if cash > 0:
                    shares += cash / price; cash = 0.0
                state = 'normal'; ladder_done = [False, False, False]
                crash_cooldown = 10

        # ── NORMAL ─────────────────────────────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0:
                dist200 = (price - ma200t) / ma200t if ma200t > 0 else 0
                if av is None or price >= av * 0.995:
                    sell_sh  = shares * 0.50
                    cash    += sell_sh * price; shares -= sell_sh
                    sell_log.append({
                        't': t, 'date': date, 'price': price,
                        'sell_pct': 0.50, 'type': 'immediate',
                        'dist200': dist200,
                        'signal_t': t, 'sig_price': price, 'days_wait': 0,
                    })
                    state = 'defensive'
                    ladder_done = [False, False, False]
                else:
                    state = 'armed'; armed_t = t
                    armed_dist  = dist200; armed_price = price

        if crash_cooldown > 0:
            crash_cooldown -= 1
        equity[t] = cash + shares * price

    sl_df = pd.DataFrame(sell_log) if sell_log else pd.DataFrame()
    return {'equity': equity, 'sell_log': sl_df, 'final': float(equity[-1])}


# ═══════════════════════════════════════════════════════════════════════════════
# METRICS
# ═══════════════════════════════════════════════════════════════════════════════
def _metrics(equity, dates, initial_cash=INITIAL_CASH):
    eq    = pd.Series(equity, index=pd.to_datetime(dates))
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr  = (eq.iloc[-1] / initial_cash) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd = float(((eq - eq.cummax()) / eq.cummax()).min())
    dr    = eq.pct_change().dropna()
    sharpe = float(dr.mean() / dr.std() * np.sqrt(252)) if dr.std() > 0 else 0.0
    return {'final': float(eq.iloc[-1]), 'cagr': cagr, 'max_dd': max_dd, 'sharpe': sharpe}


def _ep_return(equity, dates, ep_s, ep_e):
    dt  = pd.to_datetime(dates)
    idx = np.where((dt >= ep_s) & (dt <= ep_e))[0]
    if len(idx) < 2: return np.nan, np.nan
    eq   = equity[idx]
    roll = np.maximum.accumulate(eq)
    return eq[-1]/eq[0]-1, float(np.min((eq - roll) / roll))


def _sell_eff(sell_df: pd.DataFrame, data: pd.DataFrame) -> pd.DataFrame:
    if sell_df.empty: return pd.DataFrame()
    prices = data['close'].values; T = len(prices)
    rows = []
    for _, row in sell_df.iterrows():
        sp    = float(row['price'])
        sig_t = int(row['signal_t']); sel_t = int(row['t'])
        if float(row['sell_pct']) == 0: continue
        min30  = float(np.min(prices[sel_t:min(sel_t+31, T)])) if sel_t < T else sp
        sp_s   = prices[sig_t] if sig_t < T else sp
        rows.append({
            'type'     : row['type'],
            'dist200'  : row['dist200'],
            'sell_rel' : sp / sp_s if sp_s > 0 else 1.0,
            'saved30'  : (sp - min30) / sp * 100,
            'fav30'    : bool(min30 < sp),
            'days_wait': row['days_wait'],
        })
    return pd.DataFrame(rows)


# ═══════════════════════════════════════════════════════════════════════════════
# P(RETEST MA250 | crash, below MA250)  - section [3]
# ═══════════════════════════════════════════════════════════════════════════════
def analyze_retest_ma250(data: pd.DataFrame,
                          sig_A_raw: np.ndarray) -> dict:
    """
    For each A-signal (20d cooldown), record whether price is above/below MA250
    and compute P(retest MA250 within 20/30/60d) when below.
    """
    prices  = data['close'].values
    anchor  = data['ma250'].values
    T       = len(prices)
    records = []
    last_t  = -999

    for t in range(T):
        if not sig_A_raw[t]: continue
        if t - last_t < 20:  continue
        last_t = t
        av = anchor[t]
        if np.isnan(av) or av <= 0: continue

        above = bool(prices[t] > av)
        rec   = {'above': above}
        for win in (20, 30, 60):
            hit = False; hit_day = np.nan
            if not above:
                for s in range(t+1, min(t+win+1, T)):
                    if prices[s] >= anchor[s] * 0.995:
                        hit = True; hit_day = s - t; break
            rec[f'hit{win}']  = hit
            rec[f'day{win}']  = hit_day
        records.append(rec)

    if not records:
        return {}
    df = pd.DataFrame(records)
    below = df[df['above'] == False]
    n = len(below)
    out = {}
    for win in (20, 30, 60):
        p   = below[f'hit{win}'].mean() * 100 if n > 0 else np.nan
        dm  = below.loc[below[f'hit{win}'] == True, f'day{win}'].mean()
        out[win] = (p, dm, n)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═══════════════════════════════════════════════════════════════════════════════
def make_charts(data, results, sig_stats, out_dir):
    dates = pd.to_datetime(data['date'].values)
    _chart_equity(dates, results, out_dir)
    _chart_perf_bars(results, out_dir)
    _chart_signal_quality(sig_stats, out_dir)
    _chart_sell_eff(results, out_dir)
    _chart_ep_heatmap(data, results, out_dir)


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    ax = axes[0]
    order = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D', 'E']
    for sn in order:
        if sn not in results: continue
        eq  = results[sn]['equity']
        lw  = 2.0 if sn in ('adapt_b',) else 1.3
        ls  = '--' if sn in ('ma200', 'adapt_b') else '-'
        lbl = STRAT_LABELS.get(sn, sn)
        m   = results[sn]
        ax.semilogy(dates, eq/eq[0],
                    label=f"{lbl} ({m['cagr']:.1%}  S={m['sharpe']:.3f})",
                    color=STRAT_COLORS.get(sn, '#888'), lw=lw, ls=ls, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log)')
    ax.legend(loc='upper left', fontsize=8)
    ax.set_title('WO28 - Crash Trigger Refinement: Equity Curves')
    ax.grid(True, alpha=0.2)

    ax2 = axes[1]
    for sn in order:
        if sn not in results: continue
        eq = results[sn]['equity']
        dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
        ax2.plot(dates, dd, color=STRAT_COLORS.get(sn,'#888'), lw=0.9, alpha=0.7)
    ax2.set_ylabel('Drawdown (%)')
    ax2.set_xlabel('Date')
    ax2.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'equity_wo28.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    equity_wo28.png')


def _chart_perf_bars(results, out_dir):
    order  = ['MA200', 'Adapt-B', 'A', 'B', 'C', 'D', 'E']
    keys   = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D', 'E']
    valid  = [(lbl, k) for lbl, k in zip(order, keys) if k in results]
    lbls   = [v[0] for v in valid]
    ks     = [v[1] for v in valid]
    colors = [STRAT_COLORS.get(k, '#888') for k in ks]

    metrics_cfg = [
        ('sharpe', 'Sharpe',   lambda v: v,       '{:.3f}'),
        ('cagr',   'CAGR (%)', lambda v: v*100,   '{:.1f}%'),
        ('max_dd', 'MaxDD (%)',lambda v: v*100,   '{:.1f}%'),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    for ax, (mk, title, fn, fmt) in zip(axes, metrics_cfg):
        vals = [fn(results[k][mk]) for k in ks]
        bars = ax.bar(lbls, vals, color=colors, alpha=0.8, edgecolor='white')
        ax.set_title(title)
        ax.grid(True, axis='y', alpha=0.3)
        for bar, v, k in zip(bars, vals, ks):
            yoff = abs(bar.get_height()) * 0.015
            ax.text(bar.get_x()+bar.get_width()/2,
                    bar.get_height() + (yoff if bar.get_height() >= 0 else -yoff*4),
                    fmt.format(v), ha='center', va='bottom', fontsize=7.5)
        ax.tick_params(axis='x', rotation=25, labelsize=8)
    fig.suptitle('WO28 - Performance by Trigger', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'perf_bars_wo28.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    perf_bars_wo28.png')


def _chart_signal_quality(sig_stats, out_dir):
    """Signal count (raw/post-CD) + false signal rate bar chart."""
    keys   = [k for k in 'ABCDE' if k in sig_stats]
    if not keys: return
    raw_c  = [sig_stats[k]['raw']  for k in keys]
    cd_c   = [sig_stats[k]['cd']   for k in keys]
    fr_pct = [sig_stats[k]['false_rate']*100 if not np.isnan(sig_stats[k]['false_rate']) else 0
              for k in keys]
    colors = [STRAT_COLORS.get(k,'#888') for k in keys]
    x = np.arange(len(keys))

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    ax = axes[0]
    ax.bar(x - 0.2, raw_c, 0.38, label='Raw', color='#BBDEFB', edgecolor='white')
    ax.bar(x + 0.2, cd_c,  0.38, label='Post-CD(20d)', color='#2196F3', edgecolor='white')
    ax.set_xticks(x); ax.set_xticklabels(keys)
    ax.set_title('Signal Count (Raw vs Post-Cooldown 20d)')
    ax.legend(); ax.grid(True, axis='y', alpha=0.3)
    for xi, r, c in zip(x, raw_c, cd_c):
        ax.text(xi-0.2, r+0.5, str(r), ha='center', va='bottom', fontsize=9)
        ax.text(xi+0.2, c+0.5, str(c), ha='center', va='bottom', fontsize=9)

    ax = axes[1]
    bars = ax.bar(keys, fr_pct, color=colors, alpha=0.85, edgecolor='white')
    ax.set_title('False Signal Rate (%) - crash<5% in next 20d')
    ax.set_ylabel('%')
    ax.grid(True, axis='y', alpha=0.3)
    for bar, v in zip(bars, fr_pct):
        ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.3,
                f'{v:.1f}%', ha='center', va='bottom', fontsize=9)

    fig.suptitle('WO28 - Signal Quality', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'signal_quality_wo28.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    signal_quality_wo28.png')


def _chart_sell_eff(results, out_dir):
    tkeys  = [k for k in 'ABCDE' if k in results and 'sell_eff' in results[k]
              and results[k]['sell_eff'] is not None and not results[k]['sell_eff'].empty]
    if not tkeys: return
    colors = [STRAT_COLORS.get(k,'#888') for k in tkeys]
    x = np.arange(len(tkeys))

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    for ax, metric, ylabel, title in [
        (axes[0], 'sell_rel',  'Sell Price / Signal Price', 'SellRel'),
        (axes[1], 'saved30',   'Saved vs 30d Low (%)',       'Saved30 (%)'),
        (axes[2], 'days_wait', 'Armed Avg Wait Days',         'AvgWait (armed)'),
    ]:
        vals = []
        for k in tkeys:
            se = results[k]['sell_eff']
            if metric == 'days_wait':
                sub = se[se['type'] == 'armed']
                vals.append(sub[metric].mean() if len(sub) > 0 else 0)
            else:
                vals.append(se[metric].mean() if len(se) > 0 else (1.0 if metric=='sell_rel' else 0))
        bars = ax.bar(x, vals, color=colors, alpha=0.85)
        if metric == 'sell_rel':
            ax.axhline(1.0, color='black', ls='--', lw=0.8)
        for bar, v in zip(bars, vals):
            fmt = f'{v:.3f}x' if metric=='sell_rel' else f'{v:.1f}'
            ax.text(bar.get_x()+bar.get_width()/2,
                    bar.get_height() + abs(bar.get_height())*0.015,
                    fmt, ha='center', va='bottom', fontsize=9)
        ax.set_xticks(x); ax.set_xticklabels(tkeys)
        ax.set_ylabel(ylabel); ax.set_title(title); ax.grid(True, alpha=0.3)
    fig.suptitle('WO28 - Sell Efficiency by Trigger', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'sell_eff_wo28.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    sell_eff_wo28.png')


def _chart_ep_heatmap(data, results, out_dir):
    order    = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D', 'E']
    order    = [o for o in order if o in results]
    ep_names = list(CRASH_EPISODES.keys())
    dates    = data['date'].values
    mat = np.zeros((len(order), len(ep_names)))
    for i, sn in enumerate(order):
        eq = results[sn]['equity']
        for j, (en, (es, ee)) in enumerate(CRASH_EPISODES.items()):
            _, dd = _ep_return(eq, dates, es, ee)
            mat[i, j] = dd*100 if not np.isnan(dd) else 0
    fig, ax = plt.subplots(figsize=(13, 5))
    im = ax.imshow(mat, cmap='RdYlGn', aspect='auto', vmin=-80, vmax=0)
    ax.set_xticks(range(len(ep_names)))
    ax.set_xticklabels(ep_names, rotation=20, ha='right', fontsize=9)
    ax.set_yticks(range(len(order)))
    ax.set_yticklabels([STRAT_LABELS.get(n, n) for n in order], fontsize=9)
    for i in range(len(order)):
        for j in range(len(ep_names)):
            v = mat[i, j]
            ax.text(j, i, f'{v:.0f}%', ha='center', va='center',
                    fontsize=8, color='black' if v > -40 else 'white')
    plt.colorbar(im, ax=ax, label='MaxDD (%)')
    ax.set_title('WO28 - Episode MaxDD Heatmap')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'ep_heatmap_wo28.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    ep_heatmap_wo28.png')


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    lines = []
    def h(s=''):
        try:
            print(s)
        except UnicodeEncodeError:
            print(s.encode('cp949', errors='replace').decode('cp949'))
        lines.append(s)

    h('=' * 72)
    h('  WO28 -- Crash Trigger Refinement')
    h('  Anchor: MA250 (fixed)  |  Triggers: A / B / C / D / E')
    h('=' * 72); h()

    # [1] Load TQQQ
    h('[1] TQQQ 데이터 로드 ...')
    raw  = load_tqqq()
    data = prepare_data(raw)
    h(f'    {len(data)}개 거래일  ({data["date"].iloc[0].date()} ~ {data["date"].iloc[-1].date()})')
    h()

    # [2] Volatility indicator
    h('[2] 변동성 지표 (RVol20) ...')
    rvol = data['rvol20'].values
    rvol_high = (rvol >= RVOL_THRESHOLD).sum()
    h(f'    TQQQ 20d 실현변동성 >= {RVOL_THRESHOLD:.0%}: {rvol_high}일  '
      f'({rvol_high/len(data)*100:.1f}%)')
    h(f'    [참고] VIX DB 데이터는 2021+ 만 존재 → 전 기간 커버를 위해')
    h(f'    TQQQ RVol20 >= {RVOL_THRESHOLD:.0%} 를 VIX>=25 프록시로 사용')
    h()

    # [3] Trigger signals
    h('[3] Trigger 신호 분석  [MA250 위치 포함]')
    trig_raw = build_triggers(data)
    trig_cd  = {}
    prices   = data['close'].values
    ma250    = data['ma250'].values
    T        = len(prices)

    h(f'  {"Trig":<4}  {"설명":<42}  {"Raw":>5}  {"CD":>5}  {"Rate":>6}  '
      f'{"≥MA250":>7}  {"<MA250":>7}')
    h('  ' + '-' * 82)

    for k in 'ABCDE':
        sig_raw = trig_raw[k].astype(bool)
        sig_cd  = apply_cooldown(sig_raw)
        trig_cd[k] = sig_cd

        raw_n = int(sig_raw.sum())
        cd_n  = int(sig_cd.sum())
        rate  = raw_n / T * 100

        above = int((sig_cd & (prices >= ma250)).sum())
        below = int((sig_cd & (prices <  ma250)).sum())
        ab_pct = above/cd_n*100 if cd_n > 0 else 0
        bel_pct = below/cd_n*100 if cd_n > 0 else 0

        desc, _ = TRIGGERS[k]
        h(f'  {k:<4}  {desc:<42}  {raw_n:>5}  {cd_n:>5}  {rate:>5.1f}%  '
          f'{above:>4}({ab_pct:.0f}%)  {below:>4}({bel_pct:.0f}%)')
    h()

    # [4] P(retest MA250 | A-signal, below MA250)
    h('[4] P(retest MA250 | A 신호, below MA250)  [쿨다운 20일]')
    retest = analyze_retest_ma250(data, trig_raw['A'].astype(bool))
    if retest:
        for win in (20, 30, 60):
            p, dm, n = retest[win]
            dm_s = f'{dm:.0f}d' if not np.isnan(dm) else 'n/a'
            h(f'    P{win:2d}d = {p:.0f}%  (avg {dm_s})  N={n}')
    else:
        h('    데이터 없음')
    h()

    # [5] False signal rate analysis (pre-backtest)
    h('[5] False Signal Rate 분석  [기준: 20일 내 추가 하락 < 5%]')
    sig_stats = {}
    h(f'  {"Trig":<4}  {"Raw":>5}  {"CD":>5}  {"False#":>7}  {"Total":>7}  {"FalseRate":>10}')
    h('  ' + '-' * 50)
    for k in 'ABCDE':
        raw_n = int(trig_raw[k].sum())
        cd_n  = int(trig_cd[k].sum())
        fc, tot, fr = false_signal_rate(data, trig_cd[k])
        fr_s = f'{fr*100:.1f}%' if not np.isnan(fr) else 'N/A'
        h(f'  {k:<4}  {raw_n:>5}  {cd_n:>5}  {fc:>7}  {tot:>7}  {fr_s:>10}')
        sig_stats[k] = {'raw': raw_n, 'cd': cd_n,
                        'false_cnt': fc, 'false_total': tot, 'false_rate': fr}
    h()

    # [6] Backtest
    h('[6] 전략 백테스트 실행 ...')
    results = {}

    h('    MA200 ...')
    r = run_ma200_strategy(data)
    r.update(_metrics(r['equity'], data['date'].values))
    results['ma200'] = r

    h('    Adapt-B ...')
    r = run_adaptive_ma(data)
    r.update(_metrics(r['equity'], data['date'].values))
    results['adapt_b'] = r

    for k in 'ABCDE':
        h(f'    {k}: {TRIGGERS[k][0]} ...')
        r = run_anchor_strategy(data, trig_cd[k])
        r.update(_metrics(r['equity'], data['date'].values))
        se = _sell_eff(r['sell_log'], data)
        r['sell_eff'] = se
        results[k] = r

    h()

    # [7] Performance table
    h('[7] 전체 성과 비교 (2011-2026)')
    h('-' * 80)
    h(f'  {"전략":<40}  {"최종자산":>12}  {"CAGR":>7}  {"MaxDD":>7}  {"Sharpe":>7}')
    h('-' * 80)

    def _row(key, label):
        if key not in results: return
        m = results[key]
        adapt_diff = ''
        if key not in ('ma200', 'adapt_b') and 'adapt_b' in results:
            d = m['sharpe'] - results['adapt_b']['sharpe']
            adapt_diff = f'  (vs Adapt-B {d:+.3f})'
        h(f'  {label:<40}  ${m["final"]:>11,.0f}  {m["cagr"]*100:>6.1f}%  '
          f'{m["max_dd"]*100:>6.1f}%  {m["sharpe"]:>7.3f}{adapt_diff}')

    _row('ma200',   'MA200')
    _row('adapt_b', 'Adapt-B')
    h('  ' + '·' * 76)
    for k in 'ABCDE':
        if k in results:
            _row(k, f'{k}: {TRIGGERS[k][0][:37]}')
    h('-' * 80)
    h()

    # Sharpe 추이
    h('  [Sharpe 추이]  A → B → C → D → E')
    for k in 'ABCDE':
        if k not in results: continue
        m = results[k]
        d = m['sharpe'] - results['adapt_b']['sharpe']
        h(f'    {k}  {TRIGGERS[k][1]:<30}  Sharpe {m["sharpe"]:.3f}  CAGR {m["cagr"]*100:.1f}%  '
          f'(vs Adapt-B {d:+.3f})')
    h()

    # [8] Episode MaxDD
    h('[8] Crash 에피소드별 MaxDD')
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'\n  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f'  {"전략":<42}  {"MaxDD":>8}  {"EpRet":>8}')
        h('  ' + '-' * 62)
        for key, lbl in [('ma200','MA200'), ('adapt_b','Adapt-B')] + \
                        [(k, f'{k}: {TRIGGERS[k][1]}') for k in 'ABCDE' if k in results]:
            ep_ret, ep_dd = _ep_return(results[key]['equity'], data['date'].values, ep_s, ep_e)
            if np.isnan(ep_dd): continue
            h(f'  {lbl:<42}  {ep_dd*100:>7.1f}%  {ep_ret*100:>7.1f}%')
    h()

    # [9] Sell efficiency
    h('[9] 매도 효율성 분석')
    h(f'  {"Trig":<4}  {"건수":>5}  {"Imm":>5}  {"Armed":>6}  {"Timeout":>8}  '
      f'{"SellRel":>9}  {"ArmSR":>7}  {"Saved30":>8}  {"AvgWait":>9}')
    h('  ' + '-' * 75)

    for k in 'ABCDE':
        if k not in results: continue
        se = results[k].get('sell_eff', pd.DataFrame())
        if se is None or se.empty:
            h(f'  {k:<4}    0'); continue
        n_all = len(se)
        n_imm = int((se['type'] == 'immediate').sum())
        n_arm = int((se['type'] == 'armed').sum())
        n_to  = int((se['type'] == 'timeout').sum())
        sr_all = se['sell_rel'].mean()
        sr_arm = se[se['type']=='armed']['sell_rel'].mean() if n_arm > 0 else np.nan
        sv30   = se['saved30'].mean()
        wait   = se[se['type']=='armed']['days_wait'].mean() if n_arm > 0 else 0
        sr_arm_s = f'{sr_arm:.3f}x' if not np.isnan(sr_arm) else '   -  '
        h(f'  {k:<4}  {n_all:>5}  {n_imm:>5}  {n_arm:>6}  {n_to:>8}  '
          f'{sr_all:>8.3f}x  {sr_arm_s:>7}  {sv30:>7.1f}%  {wait:>8.0f}d')
    h()

    # [10] Conclusions
    h('[10] 핵심 연구 결론')
    h('=' * 72)

    valid_k = [k for k in 'ABCDE' if k in results]

    best_sharpe = max(valid_k, key=lambda k: results[k]['sharpe'])
    best_cagr   = max(valid_k, key=lambda k: results[k]['cagr'])
    best_quality = min(
        [k for k in valid_k if not np.isnan(sig_stats[k]['false_rate'])],
        key=lambda k: sig_stats[k]['false_rate']
    ) if valid_k else None

    h()
    h('[Q1] Sharpe 최우수 Trigger?')
    for k in valid_k:
        m = results[k]
        d = m['sharpe'] - results['adapt_b']['sharpe']
        mark = '  <-- 최우수' if k == best_sharpe else ''
        h(f'  {k}: {TRIGGERS[k][0]:<42}  Sharpe {m["sharpe"]:.3f}'
          f'  CAGR {m["cagr"]*100:.1f}%  MaxDD {m["max_dd"]*100:.1f}%{mark}')

    h()
    h('[Q2] 신호수 vs False Signal Rate 트레이드오프?')
    for k in valid_k:
        ss = sig_stats[k]
        fr_s = f'{ss["false_rate"]*100:.1f}%' if not np.isnan(ss["false_rate"]) else 'N/A'
        h(f'  {k}: CD 신호 {ss["cd"]:>3}개   FalseRate {fr_s}   '
          f'({TRIGGERS[k][1]})')

    h()
    h('[Q3] VIX 조건 추가 효과 (A vs D vs E)?')
    for k in ['A', 'D', 'E']:
        if k not in results: continue
        m  = results[k]
        ss = sig_stats[k]
        d  = m['sharpe'] - results['A']['sharpe']
        fr_s = f'{ss["false_rate"]*100:.1f}%' if not np.isnan(ss["false_rate"]) else 'N/A'
        h(f'  {k}: Sharpe {m["sharpe"]:.3f}  (A 대비 {d:+.3f})  '
          f'신호 {ss["cd"]}개  FalseRate {fr_s}')

    h()
    h('[Q4] AND 필터 효과 (A vs B)?')
    for k in ['A', 'B']:
        if k not in results: continue
        m  = results[k]
        ss = sig_stats[k]
        fr_s = f'{ss["false_rate"]*100:.1f}%' if not np.isnan(ss["false_rate"]) else 'N/A'
        h(f'  {k}: Sharpe {m["sharpe"]:.3f}  CAGR {m["cagr"]*100:.1f}%  '
          f'신호 {ss["cd"]}개  FalseRate {fr_s}')

    h()
    h('[WO28 최종 결론]')
    if best_sharpe and best_sharpe in results:
        br = results[best_sharpe]
        d  = br['sharpe'] - results['adapt_b']['sharpe']
        h(f'  최우수 Trigger: {best_sharpe} - {TRIGGERS[best_sharpe][0]}')
        h(f'  CAGR {br["cagr"]*100:.1f}%  MaxDD {br["max_dd"]*100:.1f}%  Sharpe {br["sharpe"]:.3f}')
        h(f'  Adapt-B 대비 Sharpe: {d:+.3f}')

    # [11] Charts
    h()
    h('[11] 차트 저장 중 ...')
    make_charts(data, results, sig_stats, OUT_DIR)
    h(f'    저장 위치: {OUT_DIR}')

    h()
    h('[12] 완료')
    h('=' * 72)

    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
