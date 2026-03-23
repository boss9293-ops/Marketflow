"""
vr_backtest/backtests/scenario_backtest_wo27.py
================================================
WO27 -- Final VR Crash Engine Validation

3 Triggers x 3 Anchors = 9 combinations

Triggers:
  T1: DD5 <= -12%                           (baseline)
  T2: DD5 <= -12% AND DD10 <= -18%          (cluster — 동시 조건)
  T3: DD5 <= -12% AND DD3 <= -8%            (velocity — 단기 속도 확인)

Anchors:
  A: Immediate 50% sell  (no anchor)
  B: MA250 Anchor
  C: MA300 Anchor

Total: 9 combos  (T1-A .. T3-C)  +  MA200 / Adapt-B  baselines

Re-entry (all): Vmin ladder (-40/-50/-60% ATH) + price > MA200 full buy
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
from vr_backtest.strategies.ma200_strategy       import run_ma200_strategy
from vr_backtest.strategies.adaptive_ma_strategy  import run_adaptive_ma

# ── Constants ──────────────────────────────────────────────────────────────────
INITIAL_CASH    = 10_000.0
MONTHLY_CONTRIB = 250.0

RETEST_TIMEOUT  = 60      # days to wait for anchor retest

VMIN_LADDER = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo27_out.txt'
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

TRIGGER_NAMES = {
    'T1': 'DD5<=-12%',
    'T2': 'DD5+DD10 cluster',
    'T3': 'DD5+DD3 velocity',
}
ANCHOR_NAMES = {
    'A': 'Immediate',
    'B': 'MA250',
    'C': 'MA300',
}

# Combo display label
def combo_label(t, a):
    return f'{t}-{a} ({TRIGGER_NAMES[t]} / {ANCHOR_NAMES[a]})'

# Color scheme: rows (triggers) × cols (anchors)
TRIGGER_BASE = {'T1': '#666666', 'T2': '#0066cc', 'T3': '#cc4400'}
ANCHOR_ALPHA  = {'A': 1.0, 'B': 0.8, 'C': 0.6}


# ═══════════════════════════════════════════════════════════════════════════════
# DATA PREPARATION
# ═══════════════════════════════════════════════════════════════════════════════
def prepare_data(data: pd.DataFrame) -> pd.DataFrame:
    """Add MA250, MA300, DD3, DD5, DD10, episode tags."""
    data = data.copy()
    s = pd.Series(data['close'].values)
    data['ma250'] = s.rolling(250, min_periods=1).mean().values
    data['ma300'] = s.rolling(300, min_periods=300).mean().values  # NaN for t<300

    prices = data['close'].values
    T = len(prices)
    dd3  = np.zeros(T)
    dd5  = np.zeros(T)
    dd10 = np.zeros(T)
    for t in range(3,  T): dd3[t]  = prices[t] / prices[t-3]  - 1.0
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    data['dd3']  = dd3
    data['dd5']  = dd5
    data['dd10'] = dd10
    return data


def build_triggers(data: pd.DataFrame) -> dict:
    dd3  = data['dd3'].values
    dd5  = data['dd5'].values
    dd10 = data['dd10'].values
    return {
        'T1': (dd5  <= -0.12),
        'T2': (dd5  <= -0.12) & (dd10 <= -0.18),
        'T3': (dd5  <= -0.12) & (dd3  <= -0.08),
    }


def _episode_tags(data: pd.DataFrame) -> list:
    dates = pd.to_datetime(data['date'])
    T = len(data)
    tags = ['normal'] * T
    for ep_name, (ep_s, ep_e) in ALL_EPISODES.items():
        mask = (dates >= ep_s) & (dates <= ep_e)
        for i in range(T):
            if mask.iloc[i]:
                tags[i] = ep_name
    return tags


# ═══════════════════════════════════════════════════════════════════════════════
# P(RETEST ANCHOR)
# ═══════════════════════════════════════════════════════════════════════════════
def analyze_retest_probs(data: pd.DataFrame, triggers: dict) -> pd.DataFrame:
    """
    For each (trigger, signal), compute P(price reaches MA250/MA300 within N days)
    when price is below anchor at signal time. 20d cooldown applied.
    """
    prices  = data['close'].values
    ma250   = data['ma250'].values
    ma300   = data['ma300'].values
    ep_tags = _episode_tags(data)
    dates   = data['date'].values
    T       = len(prices)

    records = []
    for tname, tsig in triggers.items():
        last_sig = -999
        for t in range(300, T):
            if not tsig[t]:
                continue
            if t - last_sig < 20:
                continue
            last_sig = t
            p = prices[t]
            rec = {'trigger': tname, 'date': dates[t], 'price': p,
                   'episode': ep_tags[t]}
            for acol, avals, alabel in [
                ('ma250', ma250, 'ma250'),
                ('ma300', ma300, 'ma300'),
            ]:
                av = avals[t]
                if np.isnan(av) or av <= 0:
                    rec[f'{acol}_above'] = np.nan
                    for win in (20, 30, 60):
                        rec[f'{acol}_hit{win}'] = np.nan
                        rec[f'{acol}_day{win}'] = np.nan
                    continue
                above = bool(p > av)
                rec[f'{acol}_above'] = above
                rec[f'{acol}_dist']  = (p - av) / av
                for win in (20, 30, 60):
                    hit = False; hit_day = np.nan
                    if not above:
                        for s in range(t+1, min(t+win+1, T)):
                            if prices[s] >= avals[s] * 0.995:
                                hit = True; hit_day = s - t; break
                    rec[f'{acol}_hit{win}'] = hit
                    rec[f'{acol}_day{win}'] = hit_day
            records.append(rec)

    return pd.DataFrame(records) if records else pd.DataFrame()


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
def run_combo(data: pd.DataFrame,
              crash_sig: np.ndarray,
              anchor_col: str | None) -> dict:
    """
    anchor_col = None   → Immediate 50% sell
    anchor_col = 'ma250'/'ma300'  → retest strategy
      Above anchor → immediate sell
      Below anchor → arm retest → sell at retest (timeout 60d)
    Re-entry: Vmin ladder + price > MA200
    """
    prices   = data['close'].values
    ma200    = data['ma200'].values
    dd_arr   = data['drawdown'].values
    dates    = data['date'].values
    anchor_v = (data[anchor_col].values if anchor_col else None)
    T        = len(prices)

    equity   = np.zeros(T)
    sell_log = []

    shares = INITIAL_CASH / prices[0]
    cash   = 0.0

    state  = 'normal'
    armed_t    = 0
    armed_dist = 0.0
    armed_price= 0.0
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

        # Anchor value at t (might be NaN for MA300 early on)
        if anchor_v is not None:
            av = anchor_v[t]
            av = av if (not np.isnan(av) and av > 0) else None
        else:
            av = None   # Immediate: no anchor

        # ── ARMED ──────────────────────────────────────────────────────────
        if state == 'armed':
            days_armed = t - armed_t
            # Use current anchor value (might drift slightly from armed_t)
            cur_av = av if av else price   # fallback to price if anchor NaN
            do_sell = False; sell_price = price
            stype   = 'armed'

            if price >= cur_av * 0.995:
                do_sell = True; sell_price = price
            elif days_armed >= RETEST_TIMEOUT:
                do_sell = True; sell_price = price; stype = 'timeout'

            if do_sell:
                sell_sh  = shares * 0.50
                cash    += sell_sh * sell_price
                shares  -= sell_sh
                dist200  = (price - ma200t) / ma200t if ma200t > 0 else 0
                sell_log.append({
                    't': t, 'date': date, 'price': sell_price,
                    'sell_pct': 0.50, 'type': stype,
                    'dist200': armed_dist,
                    'signal_t': armed_t, 'sig_price': armed_price,
                    'days_wait': days_armed,
                })
                state = 'defensive'

        # ── DEFENSIVE ──────────────────────────────────────────────────────
        elif state == 'defensive':
            for i, (vlevel, vbuy_pct) in enumerate(VMIN_LADDER):
                if not ladder_done[i] and dd_ath <= vlevel:
                    ladder_done[i] = True
                    buy_val = min((cash + shares * price) * vbuy_pct, cash)
                    if buy_val > 0:
                        shares += buy_val / price
                        cash   -= buy_val
            if price > ma200t and crash_cooldown <= 0:
                if cash > 0:
                    shares += cash / price; cash = 0.0
                state = 'normal'; ladder_done = [False, False, False]
                crash_cooldown = 10

        # ── NORMAL ──────────────────────────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0:
                dist200 = (price - ma200t) / ma200t if ma200t > 0 else 0

                if anchor_col is None or av is None or price >= av * 0.995:
                    # Immediate sell (no anchor, or NaN anchor, or above anchor)
                    sell_sh  = shares * 0.50
                    cash    += sell_sh * price
                    shares  -= sell_sh
                    sell_log.append({
                        't': t, 'date': date, 'price': price,
                        'sell_pct': 0.50, 'type': 'immediate',
                        'dist200': dist200,
                        'signal_t': t, 'sig_price': price, 'days_wait': 0,
                    })
                    state = 'defensive'
                else:
                    # Below anchor: arm retest
                    state      = 'armed'
                    armed_t    = t
                    armed_dist = dist200
                    armed_price= price

        if crash_cooldown > 0:
            crash_cooldown -= 1
        equity[t] = cash + shares * price

    sl_df = pd.DataFrame(sell_log) if sell_log else pd.DataFrame()
    return {'equity': equity, 'sell_log': sl_df, 'final': float(equity[-1])}


# ═══════════════════════════════════════════════════════════════════════════════
# METRICS
# ═══════════════════════════════════════════════════════════════════════════════
def _compute_metrics(equity, dates, initial_cash=INITIAL_CASH):
    eq    = pd.Series(equity, index=pd.to_datetime(dates))
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr  = (eq.iloc[-1] / initial_cash) ** (1 / years) - 1 if years > 0 else 0.0
    roll_max  = eq.cummax()
    max_dd    = float(((eq - roll_max) / roll_max).min())
    daily_ret = eq.pct_change().dropna()
    sharpe    = (float(daily_ret.mean() / daily_ret.std() * np.sqrt(252))
                 if daily_ret.std() > 0 else 0.0)
    return {'final': float(eq.iloc[-1]), 'cagr': cagr, 'max_dd': max_dd, 'sharpe': sharpe}


def _episode_return(equity, dates, ep_start, ep_end):
    dt   = pd.to_datetime(dates)
    mask = (dt >= ep_start) & (dt <= ep_end)
    idx  = np.where(mask)[0]
    if len(idx) < 2:
        return np.nan, np.nan
    eq   = equity[idx]
    ret  = eq[-1] / eq[0] - 1
    roll = np.maximum.accumulate(eq)
    mdd  = float(np.min((eq - roll) / roll))
    return ret, mdd


def sell_efficiency(sell_df, data):
    if sell_df.empty:
        return pd.DataFrame()
    prices = data['close'].values
    T = len(prices)
    rows = []
    for _, row in sell_df.iterrows():
        sp    = float(row['price'])
        sig_t = int(row['signal_t'])
        sel_t = int(row['t'])
        if float(row['sell_pct']) == 0:
            continue
        min30 = float(np.min(prices[sel_t:min(sel_t+31,T)])) if sel_t < T else sp
        sp_sig= prices[sig_t] if sig_t < T else sp
        rows.append({
            'type'    : row['type'],
            'sell_rel': sp / sp_sig if sp_sig > 0 else 1.0,
            'saved30' : (sp - min30) / sp * 100,
            'fav30'   : min30 < sp,
            'days_wait': row['days_wait'],
        })
    return pd.DataFrame(rows)


# ═══════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═══════════════════════════════════════════════════════════════════════════════
def make_charts(data, results, retest_df, triggers, out_dir):
    dates = pd.to_datetime(data['date'].values)
    _chart_sharpe_heatmap(results, triggers, out_dir)
    _chart_cagr_heatmap(results, triggers, out_dir)
    _chart_equity_best(dates, results, triggers, out_dir)
    _chart_retest_prob(retest_df, out_dir)
    _chart_sell_eff_heatmap(results, triggers, out_dir)


def _get_matrix(results, triggers, metric):
    """Return 3x3 matrix: rows=triggers, cols=anchors."""
    tkeys = ['T1', 'T2', 'T3']
    akeys = ['A',  'B',  'C']
    mat   = np.zeros((3, 3))
    for i, t in enumerate(tkeys):
        for j, a in enumerate(akeys):
            key = f'{t}-{a}'
            if key in results:
                mat[i, j] = results[key][metric]
    return mat


def _chart_sharpe_heatmap(results, triggers, out_dir):
    tkeys = ['T1', 'T2', 'T3']
    akeys = ['A',  'B',  'C']
    mat   = _get_matrix(results, triggers, 'sharpe')

    fig, ax = plt.subplots(figsize=(7, 5))
    im = ax.imshow(mat, cmap='RdYlGn', aspect='auto',
                   vmin=0.85, vmax=1.05)
    ax.set_xticks(range(3))
    ax.set_xticklabels([f'{a}: {ANCHOR_NAMES[a]}' for a in akeys], fontsize=10)
    ax.set_yticks(range(3))
    ax.set_yticklabels([f'{t}: {TRIGGER_NAMES[t]}' for t in tkeys], fontsize=9)
    for i in range(3):
        for j in range(3):
            v = mat[i, j]
            ax.text(j, i, f'{v:.3f}', ha='center', va='center',
                    fontsize=12, fontweight='bold',
                    color='black' if 0.9 < v < 1.0 else 'white')

    # Add adapt-B reference line annotation
    adapt_sh = results.get('adapt_b', {}).get('sharpe', 1.029)
    ax.set_title(f'WO27 — Sharpe Heatmap  (Adapt-B ref={adapt_sh:.3f})')
    plt.colorbar(im, ax=ax, label='Sharpe')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'sharpe_heatmap_wo27.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    sharpe_heatmap_wo27.png')


def _chart_cagr_heatmap(results, triggers, out_dir):
    tkeys = ['T1', 'T2', 'T3']
    akeys = ['A',  'B',  'C']

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for ax, metric, title, vmin, vmax, fmt in [
        (axes[0], 'cagr',   'CAGR (%)',   0.35, 0.55, lambda v: f'{v*100:.1f}%'),
        (axes[1], 'max_dd', 'MaxDD (%)', -0.90, -0.40, lambda v: f'{v*100:.0f}%'),
    ]:
        mat = _get_matrix(results, triggers, metric)
        im  = ax.imshow(mat, cmap=('RdYlGn' if metric=='cagr' else 'RdYlGn_r'),
                        aspect='auto', vmin=vmin, vmax=vmax)
        ax.set_xticks(range(3))
        ax.set_xticklabels([ANCHOR_NAMES[a] for a in akeys], fontsize=10)
        ax.set_yticks(range(3))
        ax.set_yticklabels([TRIGGER_NAMES[t] for t in tkeys], fontsize=9)
        for i in range(3):
            for j in range(3):
                ax.text(j, i, fmt(mat[i, j]),
                        ha='center', va='center', fontsize=10, fontweight='bold')
        plt.colorbar(im, ax=ax)
        ax.set_title(f'WO27 — {title}')

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'perf_heatmap_wo27.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    perf_heatmap_wo27.png')


def _chart_equity_best(dates, results, triggers, out_dir):
    """Show equity curves: baselines + best per trigger + best overall."""
    # Find best combo per trigger (by Sharpe)
    best_per_trigger = {}
    for t in ['T1', 'T2', 'T3']:
        best_key = max([f'{t}-A', f'{t}-B', f'{t}-C'],
                       key=lambda k: results.get(k, {}).get('sharpe', 0))
        best_per_trigger[t] = best_key

    plot_keys = ['ma200', 'adapt_b'] + list(best_per_trigger.values())
    colors_map = {
        'ma200'  : '#2255cc',
        'adapt_b': '#cc4400',
        best_per_trigger.get('T1',''): '#666666',
        best_per_trigger.get('T2',''): '#0066cc',
        best_per_trigger.get('T3',''): '#cc4400',
    }
    # Dedupe and use distinct colors
    clr_list = ['#2255cc', '#cc4400', '#666666', '#009933', '#cc0099']

    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    ax = axes[0]
    for i, name in enumerate(plot_keys):
        if name not in results:
            continue
        eq  = results[name]['equity']
        lbl = name if name in ('ma200', 'adapt_b') else f'Best {name.split("-")[0]}: {name}'
        ax.semilogy(dates, eq / eq[0], label=lbl,
                    color=clr_list[i % len(clr_list)], lw=1.8, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log)')
    ax.set_title('WO27 — Best Strategy per Trigger + Baselines')
    ax.legend(loc='upper left', fontsize=9); ax.grid(True, alpha=0.2)

    ax2 = axes[1]
    for i, name in enumerate(plot_keys):
        if name not in results:
            continue
        eq = results[name]['equity']
        dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
        ax2.plot(dates, dd, color=clr_list[i % len(clr_list)], lw=1.0, alpha=0.7)
    ax2.set_ylabel('Drawdown (%)'); ax2.set_xlabel('Date')
    ax2.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'equity_wo27.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    equity_wo27.png')


def _chart_retest_prob(retest_df, out_dir):
    if retest_df is None or retest_df.empty:
        return
    tkeys = ['T1', 'T2', 'T3']
    anchors = ['ma250', 'ma300']
    wins    = [20, 30, 60]

    fig, axes = plt.subplots(len(anchors), len(tkeys),
                             figsize=(14, 8), sharex=True, sharey=True)
    for row, acol in enumerate(anchors):
        for col, tname in enumerate(tkeys):
            ax  = axes[row][col]
            sub = retest_df[(retest_df['trigger'] == tname) &
                            (retest_df[f'{acol}_above'] == False)]
            n   = len(sub)
            probs = []
            for win in wins:
                col_h = f'{acol}_hit{win}'
                probs.append(sub[col_h].mean() * 100 if (n > 0 and col_h in sub.columns) else 0)

            anchor_lbl = 'MA250' if acol == 'ma250' else 'MA300'
            colors = ['#4488ff', '#0066cc', '#003399']
            bars = ax.bar(wins, probs, color=colors, alpha=0.8, width=7)
            for bar, p in zip(bars, probs):
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height()+2,
                        f'{p:.0f}%', ha='center', va='bottom', fontsize=9,
                        fontweight='bold')
            ax.axhline(50, color='k', ls=':', lw=0.8)
            ax.axvline(RETEST_TIMEOUT, color='red', ls='--', lw=1, alpha=0.7)
            ax.set_xlim(0, 75); ax.set_ylim(0, 100)
            ax.set_title(f'{anchor_lbl} | {TRIGGER_NAMES[tname]}  (N={n})', fontsize=8)
            if row == len(anchors)-1: ax.set_xlabel('Days')
            if col == 0:              ax.set_ylabel('P(retest %)')
            ax.grid(True, alpha=0.2)

    fig.suptitle('WO27 — P(retest Anchor | below anchor at crash)', fontsize=12)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'retest_prob_wo27.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    retest_prob_wo27.png')


def _chart_sell_eff_heatmap(results, triggers, out_dir):
    """SellRel and Saved30 heatmaps for the 3×3 grid."""
    tkeys = ['T1', 'T2', 'T3']
    akeys = ['A',  'B',  'C']

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for ax, metric, title, vmin, vmax in [
        (axes[0], 'sell_rel', 'SellRel (sell/signal)',  0.95, 1.15),
        (axes[1], 'saved30',  'Saved30 (%)',             5.0, 20.0),
    ]:
        mat = np.zeros((3, 3))
        for i, t in enumerate(tkeys):
            for j, a in enumerate(akeys):
                key = f'{t}-{a}'
                if key in results:
                    se = results[key].get('sell_eff', pd.DataFrame())
                    if se is not None and not se.empty and metric in se.columns:
                        mat[i, j] = se[metric].mean()

        im = ax.imshow(mat, cmap='RdYlGn', aspect='auto', vmin=vmin, vmax=vmax)
        ax.set_xticks(range(3))
        ax.set_xticklabels([ANCHOR_NAMES[a] for a in akeys], fontsize=10)
        ax.set_yticks(range(3))
        ax.set_yticklabels([TRIGGER_NAMES[t] for t in tkeys], fontsize=9)
        for i in range(3):
            for j in range(3):
                v = mat[i, j]
                fmt = f'{v:.3f}' if metric == 'sell_rel' else f'{v:.1f}%'
                ax.text(j, i, fmt, ha='center', va='center', fontsize=10, fontweight='bold')
        plt.colorbar(im, ax=ax)
        ax.set_title(f'WO27 — {title}')

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'sell_eff_heatmap_wo27.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    sell_eff_heatmap_wo27.png')


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    lines = []
    def h(s=''): lines.append(s)

    h('=' * 72)
    h('  WO27 -- Final VR Crash Engine Validation')
    h('  3 Triggers x 3 Anchors = 9 combinations')
    h('=' * 72)
    h()

    # [1] Load
    h('[1] TQQQ 데이터 로드 ...')
    data = prepare_data(load_tqqq())
    T    = len(data)
    h(f'    {T}개 거래일  ({data["date"].iloc[0].date()} ~ {data["date"].iloc[-1].date()})')
    h()

    # [2] Trigger signal counts
    triggers = build_triggers(data)
    prices   = data['close'].values
    h('[2] Trigger 신호 수 비교')
    h(f"  {'Trigger':<30}  {'신호수':>6}  {'MA250위':>8}  {'MA250아래':>10}  "
      f"{'MA300위':>8}  {'MA300아래':>10}")
    h('  ' + '-' * 78)
    for tname, tsig in triggers.items():
        n_t  = int(tsig.sum())
        ma250 = data['ma250'].values; ma300 = data['ma300'].values
        valid = tsig & ~np.isnan(ma250)
        n250a = int((valid & (prices > ma250)).sum())
        n250b = int((valid & (prices <= ma250)).sum())
        v300  = tsig & ~np.isnan(ma300)
        n300a = int((v300 & (prices > ma300)).sum())
        n300b = int((v300 & (prices <= ma300)).sum())
        h(f'  {tname}: {TRIGGER_NAMES[tname]:<26}  {n_t:>6}  '
          f'{n250a:>7} ({n250a/n_t*100:.0f}%)  {n250b:>7} ({n250b/n_t*100:.0f}%)  '
          f'{n300a:>7} ({n300a/n_t*100:.0f}%)  {n300b:>7} ({n300b/n_t*100:.0f}%)')
    h()

    # [3] P(retest)
    h('[3] P(retest Anchor | below anchor)  [쿨다운 20일]')
    retest_df = analyze_retest_probs(data, triggers)
    h(f'    분석 신호 총계: {len(retest_df)}개')
    h()
    for tname in ('T1', 'T2', 'T3'):
        sub_t = retest_df[retest_df['trigger'] == tname]
        h(f'  [{tname}: {TRIGGER_NAMES[tname]}]  분석신호 {len(sub_t)}개')
        for acol, alabel in [('ma250','MA250'), ('ma300','MA300')]:
            col_above = f'{acol}_above'
            if col_above not in sub_t.columns:
                continue
            sub_b = sub_t[sub_t[col_above] == False]
            n = len(sub_b)
            if n == 0:
                h(f'    {alabel}: 아래신호 없음')
                continue
            row_parts = [f'    {alabel} (N={n}):']
            for win in (20, 30, 60):
                col_h = f'{acol}_hit{win}'
                if col_h in sub_b.columns:
                    p = sub_b[col_h].mean() * 100
                    row_parts.append(f'P{win}d={p:.0f}%')
            h('  '.join(row_parts))
        h()

    # [4] Run all 9 combos + baselines
    h('[4] 전략 백테스트 실행 (9 combos + 2 baselines) ...')
    results = {}

    h('    MA200 ...')
    r = run_ma200_strategy(data)
    r.update(_compute_metrics(r['equity'], data['date'].values))
    results['ma200'] = r

    h('    Adapt-B ...')
    r = run_adaptive_ma(data)
    r.update(_compute_metrics(r['equity'], data['date'].values))
    results['adapt_b'] = r

    anchor_map = {'A': None, 'B': 'ma250', 'C': 'ma300'}
    for tname, tsig in triggers.items():
        for aname, acol in anchor_map.items():
            key = f'{tname}-{aname}'
            h(f'    {key} ({TRIGGER_NAMES[tname]} / {ANCHOR_NAMES[aname]}) ...')
            r = run_combo(data, tsig, acol)
            r.update(_compute_metrics(r['equity'], data['date'].values))
            r['sell_eff'] = sell_efficiency(r['sell_log'], data)
            results[key] = r
    h()

    # [5] Performance table — 3×3 grid
    h('[5] 전략 성과 비교 (3 x 3 Grid)')
    h()
    # Header
    h(f"  {'Trigger':<28}  "
      f"{'Immediate':>16}  {'MA250 Anchor':>16}  {'MA300 Anchor':>16}")
    h('  ' + '-' * 78)
    for tname in ('T1', 'T2', 'T3'):
        row_vals = []
        for aname in ('A', 'B', 'C'):
            key = f'{tname}-{aname}'
            r   = results[key]
            row_vals.append(f"S={r['sharpe']:.3f} C={r['cagr']*100:.1f}%")
        h(f'  {TRIGGER_NAMES[tname]:<28}  '
          f'{row_vals[0]:>16}  {row_vals[1]:>16}  {row_vals[2]:>16}')
    h()

    # Full table
    h('[6] 전체 성과 표 (Sharpe / CAGR / MaxDD / Final)')
    h('-' * 78)
    h(f"  {'전략':<30}  {'최종자산':>12}  {'CAGR':>6}  {'MaxDD':>7}  {'Sharpe':>7}")
    h('-' * 78)
    # Baselines
    for name, lbl in [('ma200','MA200'), ('adapt_b','Adapt-B')]:
        r = results[name]
        h(f"  {lbl:<30}  ${r['final']:>10,.0f}  "
          f"{r['cagr']*100:>5.1f}%  {r['max_dd']*100:>6.1f}%  {r['sharpe']:>7.3f}")
    h('  ' + '·' * 76)
    # Combos
    for tname in ('T1', 'T2', 'T3'):
        for aname in ('A', 'B', 'C'):
            key = f'{tname}-{aname}'
            r   = results[key]
            lbl = f'{key} ({ANCHOR_NAMES[aname]})'
            h(f"  {lbl:<30}  ${r['final']:>10,.0f}  "
              f"{r['cagr']*100:>5.1f}%  {r['max_dd']*100:>6.1f}%  {r['sharpe']:>7.3f}")
        h()
    h('-' * 78)
    h()

    # [7] Episode MaxDD — best combos only
    h('[7] Crash 에피소드별 MaxDD  (핵심 전략 비교)')
    h()
    # Select: baselines + T1-A (baseline combo) + best B combo + best C combo
    best_B = max(['T1-B','T2-B','T3-B'], key=lambda k: results[k]['sharpe'])
    best_C = max(['T1-C','T2-C','T3-C'], key=lambda k: results[k]['sharpe'])
    show_keys = ['ma200', 'adapt_b', 'T1-A', best_B, best_C]
    show_labels = {
        'ma200'  : 'MA200',
        'adapt_b': 'Adapt-B',
        'T1-A'   : 'T1-A (Immediate)',
        best_B   : f'{best_B} [best MA250]',
        best_C   : f'{best_C} [best MA300]',
    }
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f"  {'전략':<30}  {'MaxDD':>8}  {'EpRet':>8}")
        h('  ' + '-' * 52)
        for sn in show_keys:
            if sn not in results: continue
            ret, dd = _episode_return(results[sn]['equity'], data['date'].values, ep_s, ep_e)
            lbl = show_labels.get(sn, sn)
            h(f'  {lbl:<30}  {dd*100:.1f}%  {ret*100:+.1f}%')
        h()

    # [8] Sell efficiency
    h('[8] 매도 효율성 분석  (armed 케이스 집중)')
    h()
    h(f"  {'전략':<24}  {'건수':>4}  {'Armed':>6}  {'Timeout':>8}  "
      f"{'SellRel':>8}  {'Armed SR':>9}  {'Saved30':>8}")
    h('  ' + '-' * 76)
    for tname in ('T1', 'T2', 'T3'):
        for aname in ('B', 'C'):
            key = f'{tname}-{aname}'
            r   = results[key]
            se  = r.get('sell_eff', pd.DataFrame())
            lbl = f'{key} ({ANCHOR_NAMES[aname]})'
            if se is not None and not se.empty:
                n_s  = len(se)
                n_ar = int((se['type'] == 'armed').sum())
                n_to = int((se['type'] == 'timeout').sum())
                rel  = se['sell_rel'].mean()
                ar_sub = se[se['type'] == 'armed']
                ar_rel = ar_sub['sell_rel'].mean() if len(ar_sub) > 0 else 0
                s30  = se['saved30'].mean()
            else:
                n_s=n_ar=n_to=0; rel=ar_rel=s30=0
            h(f'  {lbl:<24}  {n_s:>4}  {n_ar:>6}  {n_to:>8}  '
              f'{rel:>7.3f}x  {ar_rel:>8.3f}x  {s30:>7.1f}%')
    h()

    # [9] Research conclusions
    h('[9] 핵심 연구 결론')
    h('=' * 72)
    h()
    adapt_sh = results['adapt_b']['sharpe']

    # Best overall
    all_combos = [f'{t}-{a}' for t in ('T1','T2','T3') for a in ('A','B','C')]
    best_combo = max(all_combos, key=lambda k: results[k]['sharpe'])
    best_r     = results[best_combo]

    # Q1: MA250 vs MA300
    h('  [Q1] MA250 vs MA300 — 어느 anchor가 더 효율적?')
    for aname in ('B', 'C'):
        best_a = max([f'T1-{aname}',f'T2-{aname}',f'T3-{aname}'],
                     key=lambda k: results[k]['sharpe'])
        r = results[best_a]
        h(f'    {ANCHOR_NAMES[aname]} 최우수: {best_a}  '
          f'Sharpe {r["sharpe"]:.3f}  CAGR {r["cagr"]*100:.1f}%  MaxDD {r["max_dd"]*100:.1f}%')
    h()

    # Q2: Trigger quality impact
    h('  [Q2] Trigger quality → Sharpe 개선?')
    for tname in ('T1', 'T2', 'T3'):
        best_t = max([f'{tname}-A',f'{tname}-B',f'{tname}-C'],
                     key=lambda k: results[k]['sharpe'])
        r = results[best_t]
        diff = r['sharpe'] - adapt_sh
        h(f'    {tname} 최우수: {best_t}  Sharpe {r["sharpe"]:.3f}  '
          f'(vs Adapt-B {diff:+.3f})')
    h()

    # Q3: Optimal VR structure
    h('  [Q3] 최적 VR Crash Sell 구조?')
    h(f'    -> 최우수 전략: {best_combo}')
    h(f'       {TRIGGER_NAMES[best_combo[:2]]} + {ANCHOR_NAMES[best_combo[3:]]} Anchor')
    h(f'       최종자산 ${best_r["final"]:,.0f}  CAGR {best_r["cagr"]*100:.1f}%  '
      f'MaxDD {best_r["max_dd"]*100:.1f}%  Sharpe {best_r["sharpe"]:.3f}')
    h(f'       Adapt-B 대비 Sharpe: {best_r["sharpe"] - adapt_sh:+.3f}')
    h()

    # Final VR Engine spec
    h('  [VR Crash Engine 확정 구조]')
    h(f'    Crash Detector  : {TRIGGER_NAMES[best_combo[:2]]}')
    h(f'    Sell Anchor     : {ANCHOR_NAMES[best_combo[3:]]}')
    h(f'    Sell Size       : 50% of shares')
    h(f'    Re-entry        : Vmin ladder (-40/-50/-60% ATH) + MA200 full')
    h()

    # [10] Charts
    h('[10] 차트 저장 중 ...')
    make_charts(data, results, retest_df, triggers, OUT_DIR)
    h(f'    저장 위치: {ROOT_DIR}\\vr_backtest\\results\\charts')
    h()
    h('[11] 완료')
    h('=' * 72)

    output = '\n'.join(lines)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write(output)


if __name__ == '__main__':
    main()
