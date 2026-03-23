"""
vr_backtest/backtests/scenario_backtest_wo29.py
=================================================
WO29 -- Sell Size Optimization

Fixed  : Trigger = DD5<=-10% AND DD10<=-18%  (WO28 최우수 C)
         Anchor  = MA250
         Re-entry: Vmin ladder (-40/-50/-60% ATH) + MA200 full buy
Variable: Sell size  30% / 40% / 50% / 60% / 70% / 100%

추가 메트릭:
  Recovery time      : 매도(defensive 진입) → MA200 재진입까지 평균 일수
  Rebound capture loss: 재진입 가격 / 매도 가격 - 1  (양수 = 반등 놓침)
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
import pandas as pd
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

SELL_SIZES = [
    ('A', 0.30, '30%'),
    ('B', 0.40, '40%'),
    ('C', 0.50, '50%'),   # WO28 baseline
    ('D', 0.60, '60%'),
    ('E', 0.70, '70%'),
    ('F', 1.00, '100%'),
]

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo29_out.txt'
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

STRAT_COLORS = {
    'ma200'  : '#666666',
    'adapt_b': '#FF5722',
    'A'      : '#1A237E',
    'B'      : '#1976D2',
    'C'      : '#4CAF50',
    'D'      : '#FF9800',
    'E'      : '#E53935',
    'F'      : '#6A1B9A',
}
STRAT_LABELS = {
    'ma200'  : 'MA200',
    'adapt_b': 'Adapt-B',
    **{k: f'{k} (Sell {pct})' for k, _, pct in SELL_SIZES},
}


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
    data['dd5']  = dd5
    data['dd10'] = dd10
    return data


def build_crash_sig(data: pd.DataFrame) -> np.ndarray:
    """WO28 최우수 Trigger C: DD5<=-10% AND DD10<=-18%"""
    return (data['dd5'].values <= -0.10) & (data['dd10'].values <= -0.18)


def apply_cooldown(sig: np.ndarray, cd: int = 20) -> np.ndarray:
    out = np.zeros(len(sig), dtype=bool)
    last = -(cd + 1)
    for i in range(len(sig)):
        if sig[i] and (i - last) > cd:
            out[i] = True; last = i
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE  (parameterized sell_pct)
# ═══════════════════════════════════════════════════════════════════════════════
def run_sell_size_strategy(data: pd.DataFrame,
                           crash_sig: np.ndarray,
                           sell_pct: float) -> dict:
    """
    MA250 anchor strategy with variable sell_pct.

    Returns equity, sell_log, reentry_log.
    reentry_log tracks: sell_price, reentry_price, days (recovery time).
    """
    prices   = data['close'].values
    ma200    = data['ma200'].values
    dd_arr   = data['drawdown'].values
    dates    = data['date'].values
    anchor_v = data['ma250'].values
    T        = len(prices)

    equity      = np.zeros(T)
    sell_log    = []     # sell events
    reentry_log = []     # defensive → normal transitions
    ep_sells    = []     # open sell events pending reentry

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

    # track current defensive session
    def_sell_t    = None   # day we sold (entered defensive)
    def_sell_price = None  # price at sell

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
            cur_av  = av if av else price
            do_sell = False; stype = 'armed'

            if price >= cur_av * 0.995:
                do_sell = True
            elif days_armed >= RETEST_TIMEOUT:
                do_sell = True; stype = 'timeout'

            if do_sell:
                sell_sh   = shares * sell_pct
                cash     += sell_sh * price
                shares   -= sell_sh
                dist200   = (price - ma200t) / ma200t if ma200t > 0 else 0
                sell_log.append({
                    't': t, 'date': date, 'price': price,
                    'sell_pct': sell_pct, 'type': stype,
                    'dist200': armed_dist,
                    'signal_t': armed_t, 'sig_price': armed_price,
                    'days_wait': days_armed,
                })
                def_sell_t     = t
                def_sell_price = price
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
                # Record recovery
                if def_sell_t is not None and def_sell_price is not None:
                    recovery_days = t - def_sell_t
                    rebound       = price / def_sell_price - 1.0
                    reentry_log.append({
                        'sell_t'       : def_sell_t,
                        'sell_price'   : def_sell_price,
                        'reentry_t'    : t,
                        'reentry_price': price,
                        'recovery_days': recovery_days,
                        'rebound'      : rebound,   # reentry/sell - 1  (+ = missed upside)
                    })
                    def_sell_t = def_sell_price = None
                state = 'normal'; ladder_done = [False, False, False]
                crash_cooldown = 10

        # ── NORMAL ─────────────────────────────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0:
                dist200 = (price - ma200t) / ma200t if ma200t > 0 else 0
                if av is None or price >= av * 0.995:
                    sell_sh   = shares * sell_pct
                    cash     += sell_sh * price; shares -= sell_sh
                    sell_log.append({
                        't': t, 'date': date, 'price': price,
                        'sell_pct': sell_pct, 'type': 'immediate',
                        'dist200': dist200,
                        'signal_t': t, 'sig_price': price, 'days_wait': 0,
                    })
                    def_sell_t     = t
                    def_sell_price = price
                    state = 'defensive'
                    ladder_done = [False, False, False]
                else:
                    state = 'armed'; armed_t = t
                    armed_dist  = dist200; armed_price = price

        if crash_cooldown > 0:
            crash_cooldown -= 1
        equity[t] = cash + shares * price

    sl_df = pd.DataFrame(sell_log)    if sell_log else pd.DataFrame()
    re_df = pd.DataFrame(reentry_log) if reentry_log else pd.DataFrame()
    return {'equity': equity, 'sell_log': sl_df, 'reentry_log': re_df,
            'final': float(equity[-1])}


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
        min30  = float(np.min(prices[sel_t:min(sel_t+31, T)])) if sel_t < T else sp
        sp_s   = prices[sig_t] if sig_t < T else sp
        rows.append({
            'type'     : row['type'],
            'sell_rel' : sp / sp_s if sp_s > 0 else 1.0,
            'saved30'  : (sp - min30) / sp * 100,
            'fav30'    : bool(min30 < sp),
            'days_wait': row['days_wait'],
        })
    return pd.DataFrame(rows)


def _recovery_stats(reentry_log: pd.DataFrame) -> dict:
    """Recovery time and rebound capture stats."""
    if reentry_log.empty:
        return {'avg_days': np.nan, 'avg_rebound': np.nan,
                'pct_above': np.nan, 'n': 0}
    n         = len(reentry_log)
    avg_days  = reentry_log['recovery_days'].mean()
    avg_rb    = reentry_log['rebound'].mean()    # + = re-entered above sell (missed upside)
    pct_above = (reentry_log['rebound'] > 0).mean() * 100  # % re-entered above sell price
    return {'avg_days': avg_days, 'avg_rebound': avg_rb,
            'pct_above': pct_above, 'n': n}


# ═══════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═══════════════════════════════════════════════════════════════════════════════
def make_charts(data, results, out_dir):
    dates = pd.to_datetime(data['date'].values)
    _chart_equity(dates, results, out_dir)
    _chart_perf_vs_sell(results, out_dir)
    _chart_ep_heatmap(data, results, out_dir)
    _chart_recovery(results, out_dir)
    _chart_sell_eff(results, out_dir)


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    ax = axes[0]
    order = ['ma200', 'adapt_b'] + [k for k, _, _ in SELL_SIZES]
    for sn in order:
        if sn not in results: continue
        eq  = results[sn]['equity']
        lw  = 2.0 if sn in ('adapt_b',) else (1.0 if sn in ('ma200',) else 1.5)
        ls  = '--' if sn in ('ma200', 'adapt_b') else '-'
        m   = results[sn]
        ax.semilogy(dates, eq/eq[0],
                    label=f"{STRAT_LABELS.get(sn,sn)} ({m['cagr']*100:.1f}% S={m['sharpe']:.3f})",
                    color=STRAT_COLORS.get(sn, '#888'), lw=lw, ls=ls, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log)')
    ax.legend(loc='upper left', fontsize=8)
    ax.set_title('WO29 - Sell Size Optimization: Equity Curves')
    ax.grid(True, alpha=0.2)

    ax2 = axes[1]
    for sn in order:
        if sn not in results: continue
        eq = results[sn]['equity']
        dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
        ax2.plot(dates, dd, color=STRAT_COLORS.get(sn,'#888'), lw=0.9, alpha=0.75)
    ax2.set_ylabel('Drawdown (%)')
    ax2.set_xlabel('Date')
    ax2.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'equity_wo29.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    equity_wo29.png')


def _chart_perf_vs_sell(results, out_dir):
    """Sharpe / CAGR / MaxDD vs sell_pct line chart."""
    keys      = [k for k, _, _ in SELL_SIZES if k in results]
    pcts      = [p for k, p, _ in SELL_SIZES if k in results]
    pct_lbls  = [lbl for k, _, lbl in SELL_SIZES if k in results]

    sharpes = [results[k]['sharpe']       for k in keys]
    cagrs   = [results[k]['cagr']*100     for k in keys]
    maxdds  = [abs(results[k]['max_dd'])*100 for k in keys]

    adapt_sh = results['adapt_b']['sharpe']
    adapt_ca = results['adapt_b']['cagr'] * 100

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    x = list(range(len(keys)))

    for ax, vals, ylabel, title, ref, ref_lbl in [
        (axes[0], sharpes, 'Sharpe',     'Sharpe vs Sell Size', adapt_sh, f'Adapt-B {adapt_sh:.3f}'),
        (axes[1], cagrs,   'CAGR (%)',    'CAGR vs Sell Size',  adapt_ca, f'Adapt-B {adapt_ca:.1f}%'),
        (axes[2], maxdds,  '|MaxDD| (%)', 'MaxDD vs Sell Size', None, None),
    ]:
        ax.plot(x, vals, 'o-', lw=2, ms=8, color='#1976D2')
        for xi, v, lbl in zip(x, vals, pct_lbls):
            fmt = f'{v:.3f}' if ylabel == 'Sharpe' else f'{v:.1f}%'
            ax.annotate(f'{lbl}\n{fmt}', (xi, v),
                        textcoords='offset points', xytext=(0, 10),
                        ha='center', fontsize=8)
        if ref is not None:
            ax.axhline(ref, color='red', ls='--', lw=1.5, alpha=0.7, label=ref_lbl)
            ax.legend(fontsize=8)
        ax.set_xticks(x); ax.set_xticklabels(pct_lbls, fontsize=9)
        ax.set_ylabel(ylabel); ax.set_title(title); ax.grid(True, alpha=0.2)

    fig.suptitle('WO29 - Performance Trend by Sell Size', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'perf_trend_wo29.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    perf_trend_wo29.png')


def _chart_ep_heatmap(data, results, out_dir):
    order    = ['ma200', 'adapt_b'] + [k for k, _, _ in SELL_SIZES]
    order    = [o for o in order if o in results]
    ep_names = list(CRASH_EPISODES.keys())
    dates    = data['date'].values
    mat = np.zeros((len(order), len(ep_names)))
    for i, sn in enumerate(order):
        eq = results[sn]['equity']
        for j, (en, (es, ee)) in enumerate(CRASH_EPISODES.items()):
            _, dd = _ep_return(eq, dates, es, ee)
            mat[i, j] = dd*100 if not np.isnan(dd) else 0

    fig, ax = plt.subplots(figsize=(13, 6))
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
    ax.set_title('WO29 - Episode MaxDD Heatmap')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'ep_heatmap_wo29.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    ep_heatmap_wo29.png')


def _chart_recovery(results, out_dir):
    """Recovery time and rebound capture by sell size."""
    keys     = [k for k, _, _ in SELL_SIZES if k in results]
    pct_lbls = [lbl for k, _, lbl in SELL_SIZES if k in results]
    colors   = [STRAT_COLORS.get(k,'#888') for k in keys]
    x        = np.arange(len(keys))

    rec_days   = []
    rebound_pct = []
    pct_above  = []

    for k in keys:
        rs = results[k].get('recovery', {})
        rec_days.append(rs.get('avg_days', 0) or 0)
        rebound_pct.append((rs.get('avg_rebound', 0) or 0) * 100)
        pct_above.append(rs.get('pct_above', 0) or 0)

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))

    ax = axes[0]
    bars = ax.bar(x, rec_days, color=colors, alpha=0.85)
    for bar, v in zip(bars, rec_days):
        ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.5,
                f'{v:.0f}d', ha='center', va='bottom', fontsize=9)
    ax.set_xticks(x); ax.set_xticklabels(pct_lbls)
    ax.set_ylabel('Days'); ax.set_title('Avg Recovery Time (sell to MA200 re-entry)')
    ax.grid(True, axis='y', alpha=0.3)

    ax = axes[1]
    bars = ax.bar(x, rebound_pct, color=colors, alpha=0.85)
    ax.axhline(0, color='black', ls='-', lw=0.8)
    for bar, v in zip(bars, rebound_pct):
        yoff = 0.3 if v >= 0 else -1.5
        ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+yoff,
                f'{v:+.1f}%', ha='center', va='bottom', fontsize=9)
    ax.set_xticks(x); ax.set_xticklabels(pct_lbls)
    ax.set_ylabel('Rebound at Re-entry (%)')
    ax.set_title('Avg Rebound Capture Loss\n(reentry_price/sell_price-1, + = missed upside)')
    ax.grid(True, axis='y', alpha=0.3)

    ax = axes[2]
    bars = ax.bar(x, pct_above, color=colors, alpha=0.85)
    ax.axhline(50, color='gray', ls='--', lw=0.8, label='50%')
    for bar, v in zip(bars, pct_above):
        ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.5,
                f'{v:.0f}%', ha='center', va='bottom', fontsize=9)
    ax.set_xticks(x); ax.set_xticklabels(pct_lbls)
    ax.set_ylabel('%'); ax.set_title('% Episodes Re-entered Above Sell Price\n(higher = more rebound missed)')
    ax.legend(fontsize=8); ax.grid(True, axis='y', alpha=0.3)

    fig.suptitle('WO29 - Recovery Time & Rebound Capture', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'recovery_wo29.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    recovery_wo29.png')


def _chart_sell_eff(results, out_dir):
    keys     = [k for k, _, _ in SELL_SIZES if k in results
                and 'sell_eff' in results[k]
                and not results[k]['sell_eff'].empty]
    if not keys: return
    pct_lbls = [lbl for k, _, lbl in SELL_SIZES if k in keys]
    colors   = [STRAT_COLORS.get(k,'#888') for k in keys]
    x        = np.arange(len(keys))

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    for ax, metric, ylabel, title in [
        (axes[0], 'sell_rel',  'Sell Price / Signal Price', 'SellRel'),
        (axes[1], 'saved30',   'Saved vs 30d Low (%)',       'Saved30 (%)'),
        (axes[2], 'days_wait', 'Armed Avg Wait Days',         'AvgWait (armed)'),
    ]:
        vals = []
        for k in keys:
            se = results[k]['sell_eff']
            if metric == 'days_wait':
                sub = se[se['type'] == 'armed']
                vals.append(sub[metric].mean() if len(sub) > 0 else 0)
            else:
                vals.append(se[metric].mean() if len(se) > 0 else (1.0 if metric == 'sell_rel' else 0))
        bars = ax.bar(x, vals, color=colors, alpha=0.85)
        if metric == 'sell_rel':
            ax.axhline(1.0, color='black', ls='--', lw=0.8)
        for bar, v in zip(bars, vals):
            fmt = f'{v:.3f}x' if metric == 'sell_rel' else f'{v:.1f}'
            ax.text(bar.get_x()+bar.get_width()/2,
                    bar.get_height() + abs(bar.get_height())*0.015,
                    fmt, ha='center', va='bottom', fontsize=9)
        ax.set_xticks(x); ax.set_xticklabels(pct_lbls)
        ax.set_ylabel(ylabel); ax.set_title(title); ax.grid(True, alpha=0.3)
    fig.suptitle('WO29 - Sell Efficiency by Sell Size', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'sell_eff_wo29.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    sell_eff_wo29.png')


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
    h('  WO29 -- Sell Size Optimization')
    h('  Trigger: DD5<=-10% AND DD10<=-18%  |  Anchor: MA250')
    h('=' * 72); h()

    # [1] Load + prepare
    h('[1] TQQQ 데이터 로드 ...')
    data      = prepare_data(load_tqqq())
    crash_raw = build_crash_sig(data)
    crash_cd  = apply_cooldown(crash_raw)
    prices    = data['close'].values
    ma250     = data['ma250'].values
    T         = len(prices)

    raw_n = int(crash_raw.sum())
    cd_n  = int(crash_cd.sum())
    above = int((crash_cd & (prices >= ma250)).sum())
    below = int((crash_cd & (prices <  ma250)).sum())

    h(f'    {T}개 거래일  ({data["date"].iloc[0].date()} ~ {data["date"].iloc[-1].date()})')
    h()
    h('[2] Trigger 신호 (DD5<=-10% AND DD10<=-18%)')
    h(f'    Raw: {raw_n}개  Post-CD(20d): {cd_n}개  ({cd_n/T*100:.1f}%)')
    h(f'    MA250 >= 위: {above}개({above/cd_n*100:.0f}%)  '
      f'아래: {below}개({below/cd_n*100:.0f}%)')
    h()

    # [3] Backtest
    h('[3] 전략 백테스트 실행 ...')
    results = {}

    h('    MA200 ...')
    r = run_ma200_strategy(data)
    r.update(_metrics(r['equity'], data['date'].values))
    results['ma200'] = r

    h('    Adapt-B ...')
    r = run_adaptive_ma(data)
    r.update(_metrics(r['equity'], data['date'].values))
    results['adapt_b'] = r

    for k, sp, lbl in SELL_SIZES:
        h(f'    {k}: Sell {lbl} ...')
        r   = run_sell_size_strategy(data, crash_cd, sp)
        r.update(_metrics(r['equity'], data['date'].values))
        se  = _sell_eff(r['sell_log'], data)
        rec = _recovery_stats(r['reentry_log'])
        r['sell_eff'] = se
        r['recovery'] = rec
        r['sell_pct'] = sp
        results[k] = r
    h()

    # [4] Performance table
    h('[4] 전체 성과 비교 (2011-2026)')
    h('-' * 82)
    h(f'  {"전략":<36}  {"최종자산":>12}  {"CAGR":>7}  {"MaxDD":>7}  {"Sharpe":>7}')
    h('-' * 82)

    for key, label in [('ma200','MA200'), ('adapt_b','Adapt-B')]:
        m = results[key]
        h(f'  {label:<36}  ${m["final"]:>11,.0f}  {m["cagr"]*100:>6.1f}%  '
          f'{m["max_dd"]*100:>6.1f}%  {m["sharpe"]:>7.3f}')
    h('  ' + '·' * 78)
    for k, _, lbl in SELL_SIZES:
        if k not in results: continue
        m = results[k]
        d = m['sharpe'] - results['adapt_b']['sharpe']
        label = f'{k}: Sell {lbl}'
        h(f'  {label:<36}  ${m["final"]:>11,.0f}  {m["cagr"]*100:>6.1f}%  '
          f'{m["max_dd"]*100:>6.1f}%  {m["sharpe"]:>7.3f}  (vs Adapt-B {d:+.3f})')
    h('-' * 82)
    h()

    # Sharpe trend
    h('  [Sharpe / CAGR 추이]  30% → 40% → 50% → 60% → 70% → 100%')
    for k, _, lbl in SELL_SIZES:
        if k not in results: continue
        m = results[k]
        d = m['sharpe'] - results['adapt_b']['sharpe']
        h(f'    {lbl:<6}  Sharpe {m["sharpe"]:.3f}  CAGR {m["cagr"]*100:.1f}%  '
          f'MaxDD {m["max_dd"]*100:.1f}%  (vs Adapt-B {d:+.3f})')
    h()

    # [5] Recovery time & Rebound capture
    h('[5] Recovery Time & Rebound Capture Loss')
    h(f'  {"Sell":<6}  {"N":>4}  {"AvgRecovery":>12}  {"AvgRebound":>11}  '
      f'{"PctAbove":>9}  (re-entry > sell price)')
    h('  ' + '-' * 58)
    for k, _, lbl in SELL_SIZES:
        if k not in results: continue
        rs = results[k]['recovery']
        n       = rs['n']
        avg_d   = rs['avg_days']
        avg_rb  = rs['avg_rebound']
        pct_ab  = rs['pct_above']
        avg_d_s  = f'{avg_d:.0f}d'  if not np.isnan(avg_d)  else 'N/A'
        avg_rb_s = f'{avg_rb*100:+.1f}%' if not np.isnan(avg_rb) else 'N/A'
        pct_ab_s = f'{pct_ab:.0f}%'     if not np.isnan(pct_ab) else 'N/A'
        h(f'  {lbl:<6}  {n:>4}  {avg_d_s:>12}  {avg_rb_s:>11}  {pct_ab_s:>9}')
    h()

    # [6] Sell efficiency
    h('[6] 매도 효율성 분석')
    h(f'  {"Sell":<6}  {"건수":>5}  {"Imm":>5}  {"Armed":>6}  {"TO":>4}  '
      f'{"SellRel":>9}  {"ArmSR":>8}  {"Saved30":>8}  {"AvgWait":>9}')
    h('  ' + '-' * 72)
    for k, _, lbl in SELL_SIZES:
        if k not in results: continue
        se = results[k].get('sell_eff', pd.DataFrame())
        if se is None or se.empty:
            h(f'  {lbl:<6}    0'); continue
        n_all = len(se)
        n_imm = int((se['type'] == 'immediate').sum())
        n_arm = int((se['type'] == 'armed').sum())
        n_to  = int((se['type'] == 'timeout').sum())
        sr_all = se['sell_rel'].mean()
        sr_arm = se[se['type']=='armed']['sell_rel'].mean() if n_arm > 0 else np.nan
        sv30   = se['saved30'].mean()
        wait   = se[se['type']=='armed']['days_wait'].mean() if n_arm > 0 else 0
        sr_arm_s = f'{sr_arm:.3f}x' if not np.isnan(sr_arm) else '   -  '
        h(f'  {lbl:<6}  {n_all:>5}  {n_imm:>5}  {n_arm:>6}  {n_to:>4}  '
          f'{sr_all:>8.3f}x  {sr_arm_s:>8}  {sv30:>7.1f}%  {wait:>8.0f}d')
    h()

    # [7] Episode MaxDD
    h('[7] Crash 에피소드별 MaxDD')
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'\n  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f'  {"전략":<36}  {"MaxDD":>8}  {"EpRet":>8}')
        h('  ' + '-' * 56)
        for key, lbl in [('ma200','MA200'), ('adapt_b','Adapt-B')] + \
                        [(k, f'Sell {pctlbl}') for k, _, pctlbl in SELL_SIZES if k in results]:
            ep_ret, ep_dd = _ep_return(results[key]['equity'], data['date'].values, ep_s, ep_e)
            if np.isnan(ep_dd): continue
            h(f'  {lbl:<36}  {ep_dd*100:>7.1f}%  {ep_ret*100:>7.1f}%')
    h()

    # [8] Conclusions
    h('[8] 핵심 연구 결론')
    h('=' * 72)

    valid_k = [k for k, _, _ in SELL_SIZES if k in results]
    best_sh = max(valid_k, key=lambda k: results[k]['sharpe'])
    best_ca = max(valid_k, key=lambda k: results[k]['cagr'])
    best_dd = max(valid_k, key=lambda k: results[k]['max_dd'])  # least negative

    h()
    h('[Q1] Sharpe vs Sell Size — Sweet Spot?')
    for k, _, lbl in SELL_SIZES:
        if k not in results: continue
        m = results[k]
        d = m['sharpe'] - results['adapt_b']['sharpe']
        mark = '  <-- Sharpe 최우수' if k == best_sh else (
               '  <-- CAGR 최우수' if k == best_ca else (
               '  <-- MaxDD 최우수' if k == best_dd else ''))
        h(f'  {lbl:<6}  Sharpe {m["sharpe"]:.3f}  CAGR {m["cagr"]*100:.1f}%  '
          f'MaxDD {m["max_dd"]*100:.1f}%  (vs Adapt-B {d:+.3f}){mark}')

    h()
    h('[Q2] 매도 비율 높을수록 DrawDown 개선?')
    for k, _, lbl in SELL_SIZES:
        if k not in results: continue
        m = results[k]
        rs = results[k]['recovery']
        rb_s = f'{rs["avg_rebound"]*100:+.1f}%' if not np.isnan(rs["avg_rebound"]) else 'N/A'
        h(f'  {lbl:<6}  MaxDD {m["max_dd"]*100:.1f}%  '
          f'AvgRecovery {rs["avg_days"]:.0f}d  AvgRebound {rb_s}')

    h()
    h('[Q3] Rebound Capture Loss vs Protection — 최적 트레이드오프?')
    for k, _, lbl in SELL_SIZES:
        if k not in results: continue
        rs = results[k]['recovery']
        m  = results[k]
        rb_s = f'{rs["avg_rebound"]*100:+.1f}%' if not np.isnan(rs["avg_rebound"]) else 'N/A'
        h(f'  {lbl:<6}  Sharpe {m["sharpe"]:.3f}  MaxDD {m["max_dd"]*100:.1f}%  '
          f'ReboundCaptureLoss {rb_s}  PctAbove {rs["pct_above"]:.0f}%')

    h()
    h('[WO29 최종 결론]')
    br = results[best_sh]
    d  = br['sharpe'] - results['adapt_b']['sharpe']
    _, best_lbl, best_pct = next((k, lbl, p) for k, p, lbl in SELL_SIZES if k == best_sh)
    h(f'  최우수 Sell Size: {best_sh} (Sell {best_lbl})')
    h(f'  CAGR {br["cagr"]*100:.1f}%  MaxDD {br["max_dd"]*100:.1f}%  Sharpe {br["sharpe"]:.3f}')
    h(f'  Adapt-B 대비 Sharpe: {d:+.3f}')

    # [9] Charts
    h()
    h('[9] 차트 저장 중 ...')
    make_charts(data, results, OUT_DIR)
    h(f'    저장 위치: {OUT_DIR}')

    h()
    h('[10] 완료')
    h('=' * 72)

    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
