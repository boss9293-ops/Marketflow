"""
vr_backtest/backtests/scenario_backtest_wo27b.py
=================================================
WO27b -- Sell Anchor Fine Scan  (MA250 Zone)

Trigger  : DD5 <= -12% OR DD10 <= -18%  (original DDVel)
Anchors  :
  A  Immediate   — no anchor
  B  MA250
  C  MA275       — mid-zone (new)
  D  MA300

Rule     : Price >= Anchor → immediate 50% sell
           Price <  Anchor → arm retest (60d timeout) → sell at anchor touch
Re-entry : Vmin ladder (-40/-50/-60% ATH)  +  price > MA200 full buy

목적  : MA250~300 구간에서 sweet-spot anchor 확정
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
RETEST_TIMEOUT  = 60
VMIN_LADDER     = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo27b_out.txt'
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

ANCHORS = [
    ('A', None,     'Immediate'),
    ('B', 'ma250',  'MA250'),
    ('C', 'ma275',  'MA275'),
    ('D', 'ma300',  'MA300'),
]
STRAT_COLORS = {
    'ma200'  : '#2255cc',
    'adapt_b': '#cc4400',
    'A'      : '#888888',
    'B'      : '#009933',
    'C'      : '#0099cc',
    'D'      : '#cc0099',
}
STRAT_LABELS = {
    'ma200'  : 'MA200',
    'adapt_b': 'Adapt-B',
    'A'      : 'A (Immediate)',
    'B'      : 'B (MA250)',
    'C'      : 'C (MA275)',
    'D'      : 'D (MA300)',
}


# ═══════════════════════════════════════════════════════════════════════════════
# DATA PREPARATION
# ═══════════════════════════════════════════════════════════════════════════════
def prepare_data(data: pd.DataFrame) -> pd.DataFrame:
    data = data.copy()
    s = pd.Series(data['close'].values)
    data['ma250'] = s.rolling(250, min_periods=1).mean().values
    data['ma275'] = s.rolling(275, min_periods=1).mean().values
    data['ma300'] = s.rolling(300, min_periods=300).mean().values  # NaN <300d

    prices = data['close'].values
    T = len(prices)
    dd5 = np.zeros(T); dd10 = np.zeros(T)
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    data['dd5']  = dd5
    data['dd10'] = dd10
    return data


def build_crash_sig(data: pd.DataFrame) -> np.ndarray:
    return (data['dd5'].values <= -0.12) | (data['dd10'].values <= -0.18)


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
def analyze_retest_probs(data: pd.DataFrame,
                          crash_sig: np.ndarray) -> pd.DataFrame:
    """
    For each crash signal (20-day cooldown):
      For each anchor in {ma250, ma275, ma300}:
        - above/below flag
        - P(reaches anchor within 20/30/60d) when below
        - avg wait days
    """
    prices  = data['close'].values
    ep_tags = _episode_tags(data)
    dates   = data['date'].values
    T       = len(prices)
    anchor_arr = {
        'ma250': data['ma250'].values,
        'ma275': data['ma275'].values,
        'ma300': data['ma300'].values,
    }

    records    = []
    last_sig_t = -999

    for t in range(300, T):
        if not crash_sig[t]:
            continue
        if t - last_sig_t < 20:
            continue
        last_sig_t = t

        rec = {'date': dates[t], 'price': prices[t], 'episode': ep_tags[t]}
        for acol, avals in anchor_arr.items():
            av = avals[t]
            if np.isnan(av) or av <= 0:
                rec[f'{acol}_above'] = np.nan
                for win in (20, 30, 60):
                    rec[f'{acol}_hit{win}'] = np.nan
                    rec[f'{acol}_day{win}'] = np.nan
                continue
            above = bool(prices[t] > av)
            rec[f'{acol}_above'] = above
            rec[f'{acol}_dist']  = (prices[t] - av) / av
            for win in (20, 30, 60):
                hit = False; hit_day = np.nan
                if not above:
                    for s in range(t + 1, min(t + win + 1, T)):
                        if prices[s] >= avals[s] * 0.995:
                            hit = True; hit_day = s - t; break
                rec[f'{acol}_hit{win}'] = hit
                rec[f'{acol}_day{win}'] = hit_day
        records.append(rec)

    return pd.DataFrame(records) if records else pd.DataFrame()


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
def run_anchor_strategy(data: pd.DataFrame,
                        crash_sig: np.ndarray,
                        anchor_col: str | None) -> dict:
    """
    anchor_col = None    → immediate 50% sell
    anchor_col = 'maXXX' → retest strategy
    """
    prices   = data['close'].values
    ma200    = data['ma200'].values
    dd_arr   = data['drawdown'].values
    dates    = data['date'].values
    anchor_v = data[anchor_col].values if anchor_col else None
    T        = len(prices)

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

        av = None
        if anchor_v is not None:
            av = anchor_v[t]
            if np.isnan(av) or av <= 0:
                av = None

        # ── ARMED ──────────────────────────────────────────────────────────
        if state == 'armed':
            days_armed = t - armed_t
            cur_av  = av if av else price
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

        # ── DEFENSIVE ──────────────────────────────────────────────────────
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

        # ── NORMAL ──────────────────────────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0:
                dist200 = (price - ma200t) / ma200t if ma200t > 0 else 0
                if anchor_col is None or av is None or price >= av * 0.995:
                    sell_sh  = shares * 0.50
                    cash    += sell_sh * price; shares -= sell_sh
                    sell_log.append({
                        't': t, 'date': date, 'price': price,
                        'sell_pct': 0.50, 'type': 'immediate',
                        'dist200': dist200,
                        'signal_t': t, 'sig_price': price, 'days_wait': 0,
                    })
                    state = 'defensive'
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
    max_dd= float(((eq - eq.cummax()) / eq.cummax()).min())
    dr    = eq.pct_change().dropna()
    sharpe= float(dr.mean() / dr.std() * np.sqrt(252)) if dr.std() > 0 else 0.0
    return {'final': float(eq.iloc[-1]), 'cagr': cagr, 'max_dd': max_dd, 'sharpe': sharpe}


def _ep_return(equity, dates, ep_s, ep_e):
    dt   = pd.to_datetime(dates)
    idx  = np.where((dt >= ep_s) & (dt <= ep_e))[0]
    if len(idx) < 2: return np.nan, np.nan
    eq   = equity[idx]
    roll = np.maximum.accumulate(eq)
    return eq[-1]/eq[0]-1, float(np.min((eq-roll)/roll))


def _sell_eff(sell_df, data):
    if sell_df.empty: return pd.DataFrame()
    prices = data['close'].values; T = len(prices)
    rows   = []
    for _, row in sell_df.iterrows():
        sp    = float(row['price']); sig_t = int(row['signal_t']); sel_t = int(row['t'])
        if float(row['sell_pct']) == 0: continue
        min30 = float(np.min(prices[sel_t:min(sel_t+31,T)])) if sel_t < T else sp
        sp_s  = prices[sig_t] if sig_t < T else sp
        rows.append({
            'type'     : row['type'],
            'dist200'  : row['dist200'],
            'sell_rel' : sp / sp_s if sp_s > 0 else 1.0,
            'saved30'  : (sp - min30) / sp * 100,
            'fav30'    : min30 < sp,
            'days_wait': row['days_wait'],
        })
    return pd.DataFrame(rows)


# ═══════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═══════════════════════════════════════════════════════════════════════════════
def make_charts(data, results, retest_df, out_dir):
    dates = pd.to_datetime(data['date'].values)
    _chart_equity(dates, results, out_dir)
    _chart_ep_heatmap(data, results, out_dir)
    _chart_retest_prob(retest_df, out_dir)
    _chart_fine_scan(results, out_dir)
    _chart_sell_eff_detail(results, out_dir)


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    ax = axes[0]
    for sname in ('ma200', 'adapt_b', 'A', 'B', 'C', 'D'):
        eq  = results[sname]['equity']
        lw  = 2.0 if sname in ('adapt_b', 'C', 'D') else 1.3
        ax.semilogy(dates, eq/eq[0],
                    label=STRAT_LABELS.get(sname, sname),
                    color=STRAT_COLORS.get(sname, '#888'), lw=lw, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log)'); ax.legend(loc='upper left', fontsize=9)
    ax.set_title('WO27b — Anchor Fine Scan: Equity Curves'); ax.grid(True, alpha=0.2)

    ax2 = axes[1]
    for sname in ('ma200', 'adapt_b', 'A', 'B', 'C', 'D'):
        eq = results[sname]['equity']
        dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
        ax2.plot(dates, dd, color=STRAT_COLORS.get(sname,'#888'), lw=1.0, alpha=0.7)
    ax2.set_ylabel('Drawdown (%)'); ax2.set_xlabel('Date'); ax2.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir,'equity_wo27b.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    equity_wo27b.png')


def _chart_ep_heatmap(data, results, out_dir):
    order    = ['ma200','adapt_b','A','B','C','D']
    ep_names = list(CRASH_EPISODES.keys())
    dates    = data['date'].values
    mat      = np.zeros((len(order), len(ep_names)))
    for i, sn in enumerate(order):
        eq = results[sn]['equity']
        for j, (en,(es,ee)) in enumerate(CRASH_EPISODES.items()):
            _, dd = _ep_return(eq, dates, es, ee)
            mat[i,j] = dd*100 if not np.isnan(dd) else 0
    fig, ax = plt.subplots(figsize=(12, 5))
    im = ax.imshow(mat, cmap='RdYlGn', aspect='auto', vmin=-80, vmax=0)
    ax.set_xticks(range(len(ep_names))); ax.set_xticklabels(ep_names, rotation=20, ha='right', fontsize=9)
    ax.set_yticks(range(len(order))); ax.set_yticklabels([STRAT_LABELS.get(n,n) for n in order], fontsize=9)
    for i in range(len(order)):
        for j in range(len(ep_names)):
            v = mat[i,j]
            ax.text(j, i, f'{v:.0f}%', ha='center', va='center',
                    fontsize=8, color='black' if v > -40 else 'white')
    plt.colorbar(im, ax=ax, label='MaxDD (%)')
    ax.set_title('WO27b — Episode MaxDD Heatmap')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir,'ep_heatmap_wo27b.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    ep_heatmap_wo27b.png')


def _chart_retest_prob(retest_df, out_dir):
    if retest_df is None or retest_df.empty: return
    anchors = [('ma250','MA250','#009933'),
               ('ma275','MA275','#0099cc'),
               ('ma300','MA300','#cc0099')]
    wins = [20, 30, 60]
    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    for ax, (acol, alabel, acolor) in zip(axes, anchors):
        col_above = f'{acol}_above'
        if col_above not in retest_df.columns: ax.set_title(f'{alabel} (no data)'); continue
        sub = retest_df[retest_df[col_above] == False]
        n   = len(sub)
        probs = [sub[f'{acol}_hit{w}'].mean()*100 if (n>0 and f'{acol}_hit{w}' in sub) else 0
                 for w in wins]
        bars = ax.bar(wins, probs, color=acolor, alpha=0.8, width=8)
        for bar, p in zip(bars, probs):
            ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+1.5,
                    f'{p:.0f}%', ha='center', va='bottom', fontsize=11, fontweight='bold')
        ax.axhline(50, color='k', ls=':', lw=0.8, alpha=0.5)
        ax.axvline(RETEST_TIMEOUT, color='red', ls='--', lw=1.5, alpha=0.7,
                   label=f'timeout {RETEST_TIMEOUT}d')
        ax.set_xlim(0,75); ax.set_ylim(0,100)
        ax.set_xlabel('Days after crash signal'); ax.set_ylabel('P(%)')
        ax.set_title(f'{alabel}  N={n}  (아래anchor→반등)'); ax.legend(fontsize=9); ax.grid(True,alpha=0.2)
    fig.suptitle('WO27b — P(retest Anchor | below anchor at crash)', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir,'retest_prob_wo27b.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    retest_prob_wo27b.png')


def _chart_fine_scan(results, out_dir):
    """Line chart: Sharpe/CAGR/MaxDD trend across anchor periods."""
    periods = [0, 250, 275, 300]
    labels  = ['Immediate','MA250','MA275','MA300']
    keys    = ['A', 'B', 'C', 'D']

    sharpes = [results[k]['sharpe']   for k in keys]
    cagrs   = [results[k]['cagr']*100 for k in keys]
    maxdds  = [abs(results[k]['max_dd']*100) for k in keys]

    adapt_sh = results['adapt_b']['sharpe']
    adapt_ca = results['adapt_b']['cagr'] * 100

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    x = [1, 2, 3, 4]

    for ax, vals, ylabel, title, ref, ref_lbl in [
        (axes[0], sharpes, 'Sharpe',      'Sharpe vs Anchor', adapt_sh, f'Adapt-B {adapt_sh:.3f}'),
        (axes[1], cagrs,   'CAGR (%)',     'CAGR vs Anchor',  adapt_ca, f'Adapt-B {adapt_ca:.1f}%'),
        (axes[2], maxdds,  '|MaxDD| (%)',  'MaxDD vs Anchor', None,     None),
    ]:
        ax.plot(x, vals, 'o-', lw=2, ms=8, color='#0066cc')
        for xi, v, lbl in zip(x, vals, labels):
            fmt = f'{v:.3f}' if ylabel=='Sharpe' else f'{v:.1f}'
            ax.annotate(f'{lbl}\n{fmt}', (xi, v),
                        textcoords='offset points', xytext=(0, 10),
                        ha='center', fontsize=8)
        if ref is not None:
            ax.axhline(ref, color='red', ls='--', lw=1.5, alpha=0.7, label=ref_lbl)
            ax.legend(fontsize=8)
        ax.set_xticks(x); ax.set_xticklabels(labels, rotation=10, fontsize=9)
        ax.set_ylabel(ylabel); ax.set_title(title); ax.grid(True, alpha=0.2)

    fig.suptitle('WO27b — Fine Scan: Metric Trend by Anchor Period', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir,'fine_scan_wo27b.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    fine_scan_wo27b.png')


def _chart_sell_eff_detail(results, out_dir):
    """SellRel / Saved30 / AvgWait per anchor, split armed vs immediate."""
    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    strats = ['A', 'B', 'C', 'D']
    colors = [STRAT_COLORS[s] for s in strats]
    lbls   = [STRAT_LABELS[s] for s in strats]
    x      = np.arange(len(strats))

    for ax, metric, ylabel, title in [
        (axes[0], 'sell_rel',  'Sell Price / Signal Price', 'SellRel 비교'),
        (axes[1], 'saved30',   'Saved vs 30d Low (%)',       'Saved30 비교'),
        (axes[2], 'days_wait', 'Armed: Avg Wait Days',        'Armed 평균 대기일'),
    ]:
        vals = []
        for s in strats:
            se = results[s].get('sell_eff', pd.DataFrame())
            if se is not None and not se.empty and metric in se.columns:
                if metric == 'days_wait':
                    sub = se[se['type'] == 'armed']
                    vals.append(sub[metric].mean() if len(sub) > 0 else 0)
                else:
                    vals.append(se[metric].mean())
            else:
                vals.append(0)
        bars = ax.bar(x, vals, color=colors, alpha=0.8)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.2,
                    f'{v:.3f}' if metric=='sell_rel' else f'{v:.1f}',
                    ha='center', va='bottom', fontsize=9)
        if metric == 'sell_rel':
            ax.axhline(1.0, color='k', ls='--', lw=0.8)
        ax.set_xticks(x); ax.set_xticklabels(lbls, rotation=10, fontsize=9)
        ax.set_ylabel(ylabel); ax.set_title(title); ax.grid(True, alpha=0.2)

    fig.suptitle('WO27b — Sell Efficiency by Anchor', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir,'sell_eff_wo27b.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    sell_eff_wo27b.png')


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    lines = []
    def h(s=''): lines.append(s)

    h('=' * 72)
    h('  WO27b -- Sell Anchor Fine Scan  (MA250 Zone)')
    h('  Trigger: DD5<=-12% OR DD10<=-18%  |  Anchor: MA250 / MA275 / MA300')
    h('=' * 72); h()

    # [1] Load
    h('[1] TQQQ 데이터 로드 ...')
    data = prepare_data(load_tqqq())
    T    = len(data)
    h(f'    {T}개 거래일  ({data["date"].iloc[0].date()} ~ {data["date"].iloc[-1].date()})'); h()

    # [2] Crash signal
    crash_sig = build_crash_sig(data)
    prices    = data['close'].values
    n_sig     = int(crash_sig.sum())
    h('[2] DDVel 신호 (DD5<=-12% OR DD10<=-18%)')
    h(f'    총 신호: {n_sig}개 ({n_sig/T*100:.1f}%)')
    for acol, alabel in [('ma250','MA250'),('ma275','MA275'),('ma300','MA300')]:
        av = data[acol].values
        valid = crash_sig & ~np.isnan(av)
        n_a = int((valid & (prices > av)).sum())
        n_b = int((valid & (prices <= av)).sum())
        n_v = n_a + n_b
        if n_v > 0:
            h(f'    {alabel}: 위 {n_a}개 ({n_a/n_v*100:.0f}%)  '
              f'/ 아래 {n_b}개 ({n_b/n_v*100:.0f}%)  (유효 {n_v}개)')
    h()

    # [3] P(retest)
    h('[3] P(retest Anchor | crash, below anchor)  [쿨다운 20일]')
    retest_df = analyze_retest_probs(data, crash_sig)
    h(f'    분석 신호: {len(retest_df)}개'); h()
    for acol, alabel in [('ma250','MA250'),('ma275','MA275'),('ma300','MA300')]:
        col_a = f'{acol}_above'
        if col_a not in retest_df.columns: continue
        sub_b = retest_df[retest_df[col_a] == False]
        n = len(sub_b)
        parts = [f'  {alabel} (N={n})  아래→반등:']
        for win in (20, 30, 60):
            col_h = f'{acol}_hit{win}'; col_d = f'{acol}_day{win}'
            if col_h in sub_b.columns and n > 0:
                p  = sub_b[col_h].mean() * 100
                dm = sub_b.loc[sub_b[col_h]==True, col_d].mean()
                dm_s = f'{dm:.0f}d' if not np.isnan(dm) else 'n/a'
                parts.append(f'P{win}d={p:.0f}% (avg {dm_s})')
        h('   '.join(parts)); h()

    # P by episode (MA275 reference)
    h('  에피소드별 MA275 아래→반등 P60:')
    if 'ma275_above' in retest_df.columns:
        sub275 = retest_df[retest_df['ma275_above'] == False]
        for ep in sub275['episode'].unique():
            ep_sub = sub275[sub275['episode'] == ep]
            p60 = ep_sub['ma275_hit60'].mean() * 100
            dm  = ep_sub.loc[ep_sub['ma275_hit60']==True, 'ma275_day60'].mean()
            dm_s = f'{dm:.0f}d' if not np.isnan(dm) else 'n/a'
            h(f'    {ep:<26}  N={len(ep_sub):>2}  P60={p60:.0f}%  avgDay={dm_s}')
    h()

    # [4] Strategy runs
    h('[4] 전략 백테스트 실행 ...')
    results = {}

    h('    MA200 ...')
    r = run_ma200_strategy(data); r.update(_metrics(r['equity'], data['date'].values))
    results['ma200'] = r

    h('    Adapt-B ...')
    r = run_adaptive_ma(data); r.update(_metrics(r['equity'], data['date'].values))
    results['adapt_b'] = r

    for sname, acol, alabel in ANCHORS:
        h(f'    {sname}: {alabel} ...')
        r = run_anchor_strategy(data, crash_sig, acol)
        r.update(_metrics(r['equity'], data['date'].values))
        r['sell_eff'] = _sell_eff(r['sell_log'], data)
        results[sname] = r
    h()

    # [5] Performance table
    h('[5] 전체 성과 비교 (2011-2026)')
    h('-' * 72)
    h(f"  {'전략':<26}  {'최종자산':>12}  {'CAGR':>6}  {'MaxDD':>7}  {'Sharpe':>7}")
    h('-' * 72)
    for name in ('ma200','adapt_b','A','B','C','D'):
        r   = results[name]; lbl = STRAT_LABELS.get(name, name)
        h(f"  {lbl:<26}  ${r['final']:>10,.0f}  "
          f"{r['cagr']*100:>5.1f}%  {r['max_dd']*100:>6.1f}%  {r['sharpe']:>7.3f}")
    h('-' * 72); h()

    # Fine scan trend
    h('  [Sharpe 추이] Immediate → MA250 → MA275 → MA300')
    for sname, _, alabel in ANCHORS:
        r = results[sname]
        adapt_diff = r['sharpe'] - results['adapt_b']['sharpe']
        h(f'    {alabel:<12}  Sharpe {r["sharpe"]:.3f}  '
          f'CAGR {r["cagr"]*100:.1f}%  (vs Adapt-B {adapt_diff:+.3f})')
    h()

    # [6] Episode MaxDD
    h('[6] Crash 에피소드별 MaxDD 비교')
    h()
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f"  {'전략':<26}  {'MaxDD':>8}  {'EpRet':>8}")
        h('  ' + '-' * 48)
        for sn in ('ma200','adapt_b','A','B','C','D'):
            ret, dd = _ep_return(results[sn]['equity'], data['date'].values, ep_s, ep_e)
            lbl = STRAT_LABELS.get(sn, sn)
            h(f'  {lbl:<26}  {dd*100:.1f}%  {ret*100:+.1f}%')
        h()

    # [7] Sell efficiency
    h('[7] 매도 효율성 분석')
    h()
    h(f"  {'전략':<18}  {'건수':>4}  {'즉시':>4}  {'Armed':>6}  {'Timeout':>8}  "
      f"{'SellRel':>8}  {'ArmSR':>7}  {'Saved30':>8}  {'AvgWait':>8}")
    h('  ' + '-' * 80)
    for sname, _, alabel in ANCHORS:
        se = results[sname].get('sell_eff', pd.DataFrame())
        lbl = f'{sname}: {alabel}'
        if se is not None and not se.empty:
            n_tot  = len(se)
            n_imm  = int((se['type']=='immediate').sum())
            n_arm  = int((se['type']=='armed').sum())
            n_to   = int((se['type']=='timeout').sum())
            rel    = se['sell_rel'].mean()
            s30    = se['saved30'].mean()
            ar_sub = se[se['type']=='armed']
            ar_rel = ar_sub['sell_rel'].mean() if len(ar_sub)>0 else 0.0
            dw     = ar_sub['days_wait'].mean() if len(ar_sub)>0 else 0.0
        else:
            n_tot=n_imm=n_arm=n_to=0; rel=ar_rel=s30=dw=0
        h(f'  {lbl:<18}  {n_tot:>4}  {n_imm:>4}  {n_arm:>6}  {n_to:>8}  '
          f'{rel:>7.3f}x  {ar_rel:>6.3f}x  {s30:>7.1f}%  {dw:>7.0f}d')
    h()

    # [8] Research conclusions
    h('[8] 핵심 연구 결론')
    h('=' * 72); h()
    adapt_sh = results['adapt_b']['sharpe']

    # Q1: Best anchor
    best_sname = max(('A','B','C','D'), key=lambda s: results[s]['sharpe'])
    h('[Q1] MA250 / MA275 / MA300 중 Sharpe 최적 anchor는?')
    for sname, _, alabel in ANCHORS:
        r    = results[sname]
        diff = r['sharpe'] - adapt_sh
        h(f'    {alabel:<12}  Sharpe {r["sharpe"]:.3f}  '
          f'CAGR {r["cagr"]*100:.1f}%  MaxDD {r["max_dd"]*100:.1f}%  '
          f'(vs Adapt-B {diff:+.3f})')
    h(f'    -> 최우수: {STRAT_LABELS[best_sname]}')
    h()

    # Q2: Delay cost trend
    h('[Q2] Anchor 높아질수록 delay cost (avg wait days)?')
    for sname, acol, alabel in ANCHORS:
        if acol is None: continue
        se = results[sname].get('sell_eff', pd.DataFrame())
        if se is not None and not se.empty:
            ar_sub = se[se['type']=='armed']
            dw  = ar_sub['days_wait'].mean() if len(ar_sub)>0 else 0.0
            rel = ar_sub['sell_rel'].mean()  if len(ar_sub)>0 else 0.0
            n   = len(ar_sub)
            h(f'    {alabel:<12}  Armed N={n:>2}  avgWait {dw:.0f}d  armed SellRel {rel:.3f}x')
    h()

    # Q3: Sell efficiency peak
    h('[Q3] Sell efficiency 최고 anchor?')
    for sname, _, alabel in ANCHORS:
        se = results[sname].get('sell_eff', pd.DataFrame())
        if se is not None and not se.empty:
            h(f'    {alabel:<12}  SellRel {se["sell_rel"].mean():.3f}x  '
              f'Saved30 {se["saved30"].mean():.1f}%  '
              f'Fav30 {se["fav30"].mean()*100:.0f}%')
    h()

    # Q4: Final anchor recommendation
    h('[Q4] VR crash sell 최종 anchor 추천?')
    h(f'    -> {STRAT_LABELS[best_sname]}')
    h(f'       CAGR {results[best_sname]["cagr"]*100:.1f}%  '
      f'MaxDD {results[best_sname]["max_dd"]*100:.1f}%  '
      f'Sharpe {results[best_sname]["sharpe"]:.3f}')
    h(f'       Adapt-B 대비: {results[best_sname]["sharpe"]-adapt_sh:+.3f} Sharpe')
    h()

    # [9] Charts
    h('[9] 차트 저장 중 ...')
    make_charts(data, results, retest_df, OUT_DIR)
    h(f'    저장 위치: {ROOT_DIR}\\vr_backtest\\results\\charts'); h()
    h('[10] 완료')
    h('=' * 72)

    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
