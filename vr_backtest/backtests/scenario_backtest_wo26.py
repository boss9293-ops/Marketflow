"""
vr_backtest/backtests/scenario_backtest_wo26.py
================================================
WO26 -- Sell Anchor Optimization

Crash trigger: DD5 <= -12% OR DD10 <= -18%

공통 로직:
  Price > Anchor  → 즉시 50% sell
  Price < Anchor  → Anchor retest 대기 후 sell (timeout 60d)

전략 비교:
  A  : Immediate 50% (anchor 없음, baseline)
  B  : MA150 Anchor
  C  : MA200 Anchor
  D  : MA250 Anchor

추가 분석:
  P(retest anchor | crash, below anchor)  — 20 / 30 / 60일

Episodes (VR scope, SRS 제외):
  2011 Debt Ceiling, 2015 China Shock,
  2018 Vol Spike, 2018 Q4 Selloff, 2020 COVID, 2025 Correction
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

DD5_THR         = -0.12
DD10_THR        = -0.18

RETEST_TIMEOUT  = 60     # days to wait for anchor retest before force-sell

VMIN_LADDER = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo26_out.txt'
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

# Anchor configs: (col_name, display_label, window)
ANCHORS = {
    'B': ('ma150', 'MA150'),
    'C': ('ma200', 'MA200'),
    'D': ('ma250', 'MA250'),
}

STRAT_LABELS = {
    'ma200'  : 'MA200 (baseline)',
    'adapt_b': 'Adapt-B',
    'A'      : 'A (Immediate)',
    'B'      : 'B (MA150 Anchor)',
    'C'      : 'C (MA200 Anchor)',
    'D'      : 'D (MA250 Anchor)',
}
STRAT_COLORS = {
    'ma200'  : '#2255cc',
    'adapt_b': '#cc4400',
    'A'      : '#888888',
    'B'      : '#009933',
    'C'      : '#0066cc',
    'D'      : '#cc0099',
}


# ═══════════════════════════════════════════════════════════════════════════════
# DATA PREPARATION
# ═══════════════════════════════════════════════════════════════════════════════
def add_ma250(data: pd.DataFrame) -> pd.DataFrame:
    """Add MA250 column (not included in default loader output)."""
    data = data.copy()
    s    = pd.Series(data['close'].values)
    data['ma250'] = s.rolling(250, min_periods=1).mean().values
    return data


def compute_ddvel(data: pd.DataFrame) -> tuple:
    prices = data['close'].values
    T = len(prices)
    dd5  = np.zeros(T)
    dd10 = np.zeros(T)
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    return (dd5 <= DD5_THR) | (dd10 <= DD10_THR), dd5, dd10


def _episode_tags(data: pd.DataFrame) -> list:
    dates = pd.to_datetime(data['date'])
    T     = len(data)
    tags  = ['normal'] * T
    for ep_name, (ep_s, ep_e) in ALL_EPISODES.items():
        mask = (dates >= ep_s) & (dates <= ep_e)
        for i in range(T):
            if mask.iloc[i]:
                tags[i] = ep_name
    return tags


# ═══════════════════════════════════════════════════════════════════════════════
# P(RETEST ANCHOR) ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════
def analyze_retest_probs(data: pd.DataFrame,
                          crash_sig: np.ndarray) -> pd.DataFrame:
    """
    For each crash signal (20-day cooldown):
      For each anchor (MA150/200/250):
        - above/below at signal
        - P(reaches anchor within 20/30/60d) when below
    """
    prices   = data['close'].values
    ep_tags  = _episode_tags(data)
    dates    = data['date'].values
    T        = len(prices)

    anchor_cols = {'ma150': data['ma150'].values,
                   'ma200': data['ma200'].values,
                   'ma250': data['ma250'].values}

    records    = []
    last_sig_t = -999

    for t in range(250, T):
        if not crash_sig[t]:
            continue
        if t - last_sig_t < 20:
            continue
        last_sig_t = t

        rec = {'date': dates[t], 'price': prices[t], 'episode': ep_tags[t]}

        for acol, avals in anchor_cols.items():
            av   = avals[t]
            if np.isnan(av) or av <= 0:
                rec[f'{acol}_above'] = np.nan
                for win in (20, 30, 60):
                    rec[f'{acol}_hit{win}']    = np.nan
                    rec[f'{acol}_day{win}']    = np.nan
                continue

            above = bool(prices[t] > av)
            rec[f'{acol}_above'] = above
            rec[f'{acol}_dist']  = (prices[t] - av) / av

            for win in (20, 30, 60):
                hit = False; hit_day = np.nan
                if not above:
                    # Below anchor: check if price rallies to anchor
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
                        anchor_col: str) -> dict:
    """
    Generic anchor strategy:
      Price > anchor  → immediate 50% sell
      Price < anchor  → arm retest (wait for price >= anchor) → sell 50%
      Timeout 60d     → force-sell at market

    Re-entry: Vmin ladder + price > MA200 full.
    anchor_col = 'ma150' | 'ma200' | 'ma250'  (or None for Immediate A)
    """
    prices   = data['close'].values
    ma200    = data['ma200'].values
    anchor_v = data[anchor_col].values
    dd_arr   = data['drawdown'].values
    dates    = data['date'].values
    T        = len(prices)

    equity   = np.zeros(T)
    tlog     = []
    sell_log = []

    shares = INITIAL_CASH / prices[0]
    cash   = 0.0

    state   = 'normal'   # 'normal' | 'armed' | 'defensive'
    armed_t    = 0
    armed_av   = 0.0     # anchor value at arm time
    armed_dist = 0.0
    armed_price= 0.0
    ladder_done = [False, False, False]
    crash_cooldown = 0

    equity[0]  = shares * prices[0]
    prev_month = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price   = prices[t]
        ma200t  = ma200[t]  if (not np.isnan(ma200[t])  and ma200[t]  > 0) else price
        anchort = anchor_v[t] if (not np.isnan(anchor_v[t]) and anchor_v[t] > 0) else price
        dd_ath  = dd_arr[t]
        date    = dates[t]

        # Monthly DCA
        curr_month = pd.Timestamp(date).month
        if curr_month != prev_month:
            cash      += MONTHLY_CONTRIB
            shares    += MONTHLY_CONTRIB / price
            prev_month = curr_month

        # ── ARMED ─────────────────────────────────────────────────────────────
        if state == 'armed':
            days_armed = t - armed_t
            do_sell    = False
            sell_price = price

            # Price rallied back to anchor (from below)
            if price >= anchort * 0.995:
                do_sell    = True
                sell_price = price
            elif days_armed >= RETEST_TIMEOUT:
                do_sell    = True   # timeout: sell at market
                sell_price = price

            if do_sell:
                sell_sh  = shares * 0.50
                cash    += sell_sh * sell_price
                shares  -= sell_sh
                sell_log.append({
                    't'        : t, 'date': date, 'price': sell_price,
                    'sell_pct' : 0.50,
                    'type'     : 'armed' if days_armed < RETEST_TIMEOUT else 'timeout',
                    'dist200'  : armed_dist,
                    'signal_t' : armed_t,
                    'sig_price': armed_price,
                    'days_wait': days_armed,
                })
                tlog.append((date, f'SELL_ARMED_{anchor_col.upper()}', sell_price, shares, cash))
                state = 'defensive'

        # ── DEFENSIVE ─────────────────────────────────────────────────────────
        elif state == 'defensive':
            for i, (vlevel, vbuy_pct) in enumerate(VMIN_LADDER):
                if not ladder_done[i] and dd_ath <= vlevel:
                    ladder_done[i] = True
                    buy_val = (cash + shares * price) * vbuy_pct
                    buy_val = min(buy_val, cash)
                    if buy_val > 0:
                        shares += buy_val / price
                        cash   -= buy_val
                        tlog.append((date, f'VMIN_{i+1}', price, shares, cash))

            # MA200 re-entry
            if price > ma200t and crash_cooldown <= 0:
                if cash > 0:
                    shares += cash / price
                    cash    = 0.0
                    tlog.append((date, 'REENTRY', price, shares, cash))
                state       = 'normal'
                ladder_done = [False, False, False]
                crash_cooldown = 10

        # ── NORMAL ────────────────────────────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0:
                dist200 = (price - ma200t) / ma200t if ma200t > 0 else 0

                if price >= anchort * 0.995:
                    # Above (or at) anchor: immediate sell
                    sell_sh  = shares * 0.50
                    cash    += sell_sh * price
                    shares  -= sell_sh
                    sell_log.append({
                        't': t, 'date': date, 'price': price,
                        'sell_pct': 0.50, 'type': 'immediate',
                        'dist200': dist200,
                        'signal_t': t, 'sig_price': price,
                        'days_wait': 0,
                    })
                    tlog.append((date, f'SELL_IMM_{anchor_col.upper()}', price, shares, cash))
                    state = 'defensive'
                else:
                    # Below anchor: arm retest
                    state      = 'armed'
                    armed_t    = t
                    armed_av   = anchort
                    armed_dist = dist200
                    armed_price= price
                    tlog.append((date, f'ARM_{anchor_col.upper()}', price, shares, cash))

        if crash_cooldown > 0:
            crash_cooldown -= 1

        equity[t] = cash + shares * price

    sl_df = pd.DataFrame(sell_log) if sell_log else pd.DataFrame()
    return {'equity': equity, 'tlog': tlog, 'sell_log': sl_df, 'final': float(equity[-1])}


def run_immediate_strategy(data: pd.DataFrame, crash_sig: np.ndarray) -> dict:
    """Strategy A: Immediate 50% sell on crash signal."""
    prices   = data['close'].values
    ma200    = data['ma200'].values
    dd_arr   = data['drawdown'].values
    dates    = data['date'].values
    T        = len(prices)

    equity   = np.zeros(T)
    sell_log = []
    tlog     = []

    shares = INITIAL_CASH / prices[0]
    cash   = 0.0

    state  = 'normal'
    ladder_done   = [False, False, False]
    crash_cooldown = 0

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

        if state == 'defensive':
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
                state = 'normal'; ladder_done = [False,False,False]
                crash_cooldown = 10

        elif state == 'normal' and crash_sig[t] and crash_cooldown <= 0:
            dist200  = (price - ma200t) / ma200t if ma200t > 0 else 0
            sell_sh  = shares * 0.50
            cash    += sell_sh * price
            shares  -= sell_sh
            sell_log.append({'t': t, 'date': date, 'price': price,
                             'sell_pct': 0.50, 'type': 'immediate',
                             'dist200': dist200, 'signal_t': t,
                             'sig_price': price, 'days_wait': 0})
            tlog.append((date, 'SELL_A', price, shares, cash))
            state = 'defensive'

        if crash_cooldown > 0:
            crash_cooldown -= 1
        equity[t] = cash + shares * price

    sl_df = pd.DataFrame(sell_log) if sell_log else pd.DataFrame()
    return {'equity': equity, 'tlog': tlog, 'sell_log': sl_df, 'final': float(equity[-1])}


# ═══════════════════════════════════════════════════════════════════════════════
# METRICS
# ═══════════════════════════════════════════════════════════════════════════════
def _compute_metrics(equity: np.ndarray, dates,
                     initial_cash: float = INITIAL_CASH) -> dict:
    eq    = pd.Series(equity, index=pd.to_datetime(dates))
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr  = (eq.iloc[-1] / initial_cash) ** (1 / years) - 1 if years > 0 else 0.0
    roll_max = eq.cummax()
    dd_series= (eq - roll_max) / roll_max
    max_dd   = float(dd_series.min())
    daily_ret = eq.pct_change().dropna()
    sharpe = (float(daily_ret.mean() / daily_ret.std() * np.sqrt(252))
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


# ═══════════════════════════════════════════════════════════════════════════════
# SELL EFFICIENCY
# ═══════════════════════════════════════════════════════════════════════════════
def analyze_sell_efficiency(sell_df: pd.DataFrame, data: pd.DataFrame) -> pd.DataFrame:
    if sell_df.empty:
        return pd.DataFrame()
    prices = data['close'].values
    T = len(prices)
    rows = []
    for _, row in sell_df.iterrows():
        sig_t  = int(row['signal_t'])
        sell_t = int(row['t'])
        sp     = float(row['price'])
        if float(row['sell_pct']) == 0:
            continue
        end30 = min(sell_t + 31, T)
        end60 = min(sell_t + 61, T)
        min30 = float(np.min(prices[sell_t:end30])) if end30 > sell_t else sp
        min60 = float(np.min(prices[sell_t:end60])) if end60 > sell_t else sp
        sig_price = prices[sig_t] if sig_t < T else sp
        rows.append({
            'date'     : row['date'],
            'type'     : row['type'],
            'dist200'  : row['dist200'],
            'sell_pct' : row['sell_pct'],
            'days_wait': row['days_wait'],
            'sell_rel' : sp / sig_price if sig_price > 0 else 1.0,
            'saved30'  : (sp - min30) / sp * 100,
            'saved60'  : (sp - min60) / sp * 100,
            'fav30'    : min30 < sp,
            'fav60'    : min60 < sp,
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
    _chart_sell_eff(results, out_dir)
    _chart_summary(results, out_dir)


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    ax = axes[0]
    for name, res in results.items():
        eq = res['equity']
        lw = 2.0 if name in ('adapt_b', 'B', 'C', 'D') else 1.3
        ax.semilogy(dates, eq / eq[0],
                    label=STRAT_LABELS.get(name, name),
                    color=STRAT_COLORS.get(name, '#888'), lw=lw, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log scale)')
    ax.legend(loc='upper left', fontsize=9); ax.grid(True, alpha=0.2)
    ax.set_title('WO26 — Equity Curves: Sell Anchor Comparison')

    ax2 = axes[1]
    for name, res in results.items():
        eq = res['equity']
        dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
        ax2.plot(dates, dd, color=STRAT_COLORS.get(name, '#888'),
                 lw=1.0, alpha=0.7, label=STRAT_LABELS.get(name, name))
    ax2.set_ylabel('Drawdown (%)'); ax2.set_xlabel('Date')
    ax2.legend(loc='lower right', fontsize=8); ax2.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'equity_wo26.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    equity_wo26.png')


def _chart_ep_heatmap(data, results, out_dir):
    order     = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D']
    ep_names  = list(CRASH_EPISODES.keys())
    dates     = data['date'].values
    matrix    = np.zeros((len(order), len(ep_names)))
    for i, sn in enumerate(order):
        eq = results[sn]['equity']
        for j, (ep_name, (ep_s, ep_e)) in enumerate(CRASH_EPISODES.items()):
            _, ep_dd = _episode_return(eq, dates, ep_s, ep_e)
            matrix[i, j] = ep_dd * 100 if not np.isnan(ep_dd) else 0

    fig, ax = plt.subplots(figsize=(12, 5))
    im = ax.imshow(matrix, cmap='RdYlGn', aspect='auto', vmin=-80, vmax=0)
    ax.set_xticks(range(len(ep_names)))
    ax.set_xticklabels(ep_names, rotation=20, ha='right', fontsize=9)
    ax.set_yticks(range(len(order)))
    ax.set_yticklabels([STRAT_LABELS.get(n, n) for n in order], fontsize=9)
    for i in range(len(order)):
        for j in range(len(ep_names)):
            v = matrix[i, j]
            ax.text(j, i, f'{v:.0f}%', ha='center', va='center',
                    fontsize=8, color='black' if v > -40 else 'white')
    plt.colorbar(im, ax=ax, label='MaxDD (%)')
    ax.set_title('WO26 — Episode MaxDD Heatmap')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'ep_heatmap_wo26.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    ep_heatmap_wo26.png')


def _chart_retest_prob(retest_df, out_dir):
    if retest_df is None or retest_df.empty:
        return
    anchors = [('ma150', 'MA150', '#009933'),
               ('ma200', 'MA200', '#0066cc'),
               ('ma250', 'MA250', '#cc0099')]
    wins    = [20, 30, 60]

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    for ax, (acol, alabel, acolor) in zip(axes, anchors):
        sub = retest_df[retest_df[f'{acol}_above'] == False]
        n   = len(sub)
        probs = []
        for win in wins:
            col = f'{acol}_hit{win}'
            if col in sub.columns and n > 0:
                probs.append(sub[col].mean() * 100)
            else:
                probs.append(0)

        bars = ax.bar(wins, probs, color=acolor, alpha=0.8, width=8)
        for bar, p in zip(bars, probs):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1.5,
                    f'{p:.0f}%', ha='center', va='bottom', fontsize=11, fontweight='bold')
        ax.axhline(50, color='k', ls=':', lw=0.8, alpha=0.5)
        ax.axvline(RETEST_TIMEOUT, color='red', ls='--', lw=1.5, alpha=0.7,
                   label=f'timeout ({RETEST_TIMEOUT}d)')
        ax.set_xlim(0, 75); ax.set_ylim(0, 100)
        ax.set_xlabel('Days after crash signal')
        ax.set_ylabel('Retest probability (%)')
        ax.set_title(f'{alabel} Anchor\n아래신호 → Anchor 반등 P  (N={n})')
        ax.legend(fontsize=9); ax.grid(True, alpha=0.2)

    fig.suptitle('WO26 — P(retest Anchor | below Anchor at crash)', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'retest_prob_wo26.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    retest_prob_wo26.png')


def _chart_sell_eff(results, out_dir):
    strats  = ['A', 'B', 'C', 'D']
    colors  = [STRAT_COLORS[s] for s in strats]
    lbls    = [STRAT_LABELS[s] for s in strats]

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))

    for ax, metric, ylabel, title in [
        (axes[0], 'sell_rel',  'Sell Price / Signal Price',  '매도가 / 신호가 (SellRel)'),
        (axes[1], 'saved30',   'Saved vs 30d Low (%)',        '30일 최저 대비 절약 (%)'),
        (axes[2], 'days_wait', 'Days waited (armed only)',    '매도 대기일 (armed 케이스)'),
    ]:
        data_list = []
        for s in strats:
            se = results[s].get('sell_eff', pd.DataFrame())
            if se is not None and not se.empty and metric in se.columns:
                if metric == 'days_wait':
                    vals = se[se['type'] == 'armed'][metric].dropna().values
                else:
                    vals = se[metric].dropna().values
                data_list.append(vals)
            else:
                data_list.append(np.array([]))

        valid = [(i, d) for i, d in enumerate(data_list) if len(d) > 0]
        if valid:
            idxs, dvals = zip(*valid)
            bp = ax.boxplot(dvals, positions=list(range(1, len(idxs)+1)),
                            labels=[lbls[i] for i in idxs], patch_artist=True)
            for patch, i in zip(bp['boxes'], idxs):
                patch.set_facecolor(colors[i]); patch.set_alpha(0.7)

        if metric == 'sell_rel':
            ax.axhline(1.0, color='k', ls='--', lw=0.8)
        ax.set_ylabel(ylabel); ax.set_title(title)
        ax.grid(True, alpha=0.2)
        plt.setp(ax.get_xticklabels(), rotation=15, ha='right', fontsize=8)

    fig.suptitle('WO26 — Sell Efficiency by Anchor', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'sell_eff_wo26.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    sell_eff_wo26.png')


def _chart_summary(results, out_dir):
    names  = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D']
    labels = [STRAT_LABELS.get(n, n) for n in names]
    colors = [STRAT_COLORS.get(n, '#888') for n in names]
    x      = np.arange(len(names))

    cagrs  = [results[n]['cagr']   * 100 for n in names]
    mxdds  = [abs(results[n]['max_dd'] * 100) for n in names]
    sharps = [results[n]['sharpe'] for n in names]

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    for ax, vals, ylabel, title in [
        (axes[0], cagrs,  'CAGR (%)',    'CAGR'),
        (axes[1], mxdds,  '|MaxDD| (%)', 'MaxDD (abs)'),
        (axes[2], sharps, 'Sharpe',      'Sharpe Ratio'),
    ]:
        bars = ax.bar(x, vals, color=colors, alpha=0.8)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + 0.2,
                    f'{v:.2f}', ha='center', va='bottom', fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=20, ha='right', fontsize=8)
        ax.set_ylabel(ylabel); ax.set_title(title)
        ax.grid(True, alpha=0.2)

    fig.suptitle('WO26 — Anchor Strategy Comparison', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'summary_wo26.png'), dpi=110, bbox_inches='tight')
    plt.close(); print('    summary_wo26.png')


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    lines = []
    def h(s=''): lines.append(s)

    h('=' * 72)
    h('  WO26 -- Sell Anchor Optimization')
    h('  Crash 발생 시 최적 Sell Anchor (MA150 / MA200 / MA250) 탐색')
    h('=' * 72)
    h()

    # [1] Load + prepare
    h('[1] TQQQ 데이터 로드 ...')
    data = load_tqqq()
    data = add_ma250(data)
    T    = len(data)
    h(f'    {T}개 거래일  ({data["date"].iloc[0].date()} ~ {data["date"].iloc[-1].date()})')
    h()

    # [2] Crash signal
    crash_sig, dd5, dd10 = compute_ddvel(data)
    n_sig  = int(crash_sig.sum())
    prices = data['close'].values
    h('[2] DDVel Crash Signal (DD5<=-12% OR DD10<=-18%)')
    h(f'    총 신호: {n_sig}개 ({n_sig/T*100:.1f}%)')
    h()

    # [3] MA 상대 위치 분포
    h('[3] Crash Signal 발생 시 MA 상대 위치')
    for acol, alabel in [('ma150', 'MA150'), ('ma200', 'MA200'), ('ma250', 'MA250')]:
        av     = data[acol].values
        valid  = crash_sig & ~np.isnan(av)
        n_above = int((valid & (prices > av)).sum())
        n_below = int((valid & (prices <= av)).sum())
        n_v     = n_above + n_below
        h(f'    {alabel}: 위 {n_above}개 ({n_above/n_v*100:.0f}%)  '
          f'/ 아래 {n_below}개 ({n_below/n_v*100:.0f}%)  '
          f'  (전체 {n_v}개)')
    h()

    # [4] P(retest anchor)
    h('[4] P(retest Anchor | crash, below anchor)  [쿨다운 20일]')
    retest_df = analyze_retest_probs(data, crash_sig)
    n_rt = len(retest_df)
    h(f'    분석 신호: {n_rt}개')
    h()

    for acol, alabel in [('ma150', 'MA150'), ('ma200', 'MA200'), ('ma250', 'MA250')]:
        col_above = f'{acol}_above'
        if col_above not in retest_df.columns:
            continue
        sub = retest_df[retest_df[col_above] == False]
        n   = len(sub)
        h(f'  [{alabel} Anchor]  아래MA 신호 N={n}')
        for win in (20, 30, 60):
            col = f'{acol}_hit{win}'
            dcol= f'{acol}_day{win}'
            if col in sub.columns and n > 0:
                p  = sub[col].mean() * 100
                dm = sub.loc[sub[col] == True, dcol].mean()
                dm_s = f'{dm:.0f}d' if not np.isnan(dm) else 'n/a'
                h(f'    {win:>2}일 내 반등  P = {p:.0f}%  (hit avg {dm_s})')
        h()

    # P by episode (MA200 reference)
    h('  에피소드별 MA200 아래 → 60일 반등 확률:')
    if not retest_df.empty and 'ma200_above' in retest_df.columns:
        sub200 = retest_df[retest_df['ma200_above'] == False]
        for ep in sub200['episode'].unique():
            ep_sub = sub200[sub200['episode'] == ep]
            p60 = ep_sub['ma200_hit60'].mean() * 100
            h(f'    {ep:<26}  N={len(ep_sub):>2}  P60={p60:.0f}%')
    h()

    # [5] Strategy runs
    h('[5] 전략 백테스트 실행 ...')
    results = {}

    h('    MA200 (baseline) ...')
    r = run_ma200_strategy(data)
    r.update(_compute_metrics(r['equity'], data['date'].values))
    results['ma200'] = r

    h('    Adapt-B ...')
    r = run_adaptive_ma(data)
    r.update(_compute_metrics(r['equity'], data['date'].values))
    results['adapt_b'] = r

    h('    A (Immediate) ...')
    r = run_immediate_strategy(data, crash_sig)
    r.update(_compute_metrics(r['equity'], data['date'].values))
    r['sell_eff'] = analyze_sell_efficiency(r['sell_log'], data)
    results['A'] = r

    for sname, (acol, alabel) in ANCHORS.items():
        h(f'    {sname} ({alabel} Anchor) ...')
        r = run_anchor_strategy(data, crash_sig, acol)
        r.update(_compute_metrics(r['equity'], data['date'].values))
        r['sell_eff'] = analyze_sell_efficiency(r['sell_log'], data)
        results[sname] = r
    h()

    # [6] Overall performance
    h('[6] 전체 성과 비교 (2011-2026)')
    h('-' * 72)
    h(f"  {'전략':<28}  {'최종자산':>12}  {'CAGR':>6}  {'MaxDD':>7}  {'Sharpe':>7}")
    h('-' * 72)
    for name in ('ma200', 'adapt_b', 'A', 'B', 'C', 'D'):
        r   = results[name]
        lbl = STRAT_LABELS.get(name, name)
        h(f"  {lbl:<28}  ${r['final']:>10,.0f}  "
          f"{r['cagr']*100:>5.1f}%  {r['max_dd']*100:>6.1f}%  {r['sharpe']:>7.3f}")
    h('-' * 72)
    h()

    # [7] Episode MaxDD
    h('[7] Crash 에피소드별 MaxDD 비교')
    h()
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f"  {'전략':<28}  {'MaxDD':>8}  {'EpRet':>8}")
        h('  ' + '-' * 50)
        for sn in ('ma200', 'adapt_b', 'A', 'B', 'C', 'D'):
            r   = results[sn]
            ret, dd = _episode_return(r['equity'], data['date'].values, ep_s, ep_e)
            lbl = STRAT_LABELS.get(sn, sn)
            dd_s  = f'{dd*100:.1f}%' if not np.isnan(dd)  else 'n/a'
            ret_s = f'{ret*100:+.1f}%' if not np.isnan(ret) else 'n/a'
            h(f'  {lbl:<28}  {dd_s:>8}  {ret_s:>8}')
        h()

    # [8] Sell efficiency
    h('[8] 매도 효율성 분석')
    h()
    h(f"  {'전략':<22}  {'건수':>4}  {'Armed':>6}  {'Timeout':>8}  "
      f"{'SellRel':>8}  {'Saved30':>8}  {'Fav30':>6}")
    h('  ' + '-' * 72)
    for sn in ('A', 'B', 'C', 'D'):
        se = results[sn].get('sell_eff', pd.DataFrame())
        if se is not None and not se.empty:
            n_s      = len(se)
            n_armed  = int((se['type'] == 'armed').sum())
            n_timeout= int((se['type'] == 'timeout').sum())
            rel_avg  = se['sell_rel'].mean()
            s30_avg  = se['saved30'].mean()
            f30_avg  = se['fav30'].mean() * 100
        else:
            n_s = n_armed = n_timeout = 0
            rel_avg = s30_avg = f30_avg = 0
        lbl = STRAT_LABELS.get(sn, sn)
        h(f'  {lbl:<22}  {n_s:>4}  {n_armed:>6}  {n_timeout:>8}  '
          f'{rel_avg:>7.3f}x  {s30_avg:>7.1f}%  {f30_avg:>5.0f}%')
    h()

    # Armed vs Immediate breakdown for B/C/D
    h('  [Armed vs Immediate 분해]')
    for sn in ('B', 'C', 'D'):
        se = results[sn].get('sell_eff', pd.DataFrame())
        lbl= STRAT_LABELS.get(sn, sn)
        h(f'  {lbl}:')
        if se is not None and not se.empty:
            for stype in ('immediate', 'armed', 'timeout'):
                sub = se[se['type'] == stype]
                if len(sub) == 0:
                    continue
                rel = sub['sell_rel'].mean()
                s30 = sub['saved30'].mean()
                dw  = sub['days_wait'].mean()
                h(f'    [{stype:<10}]  N={len(sub):>3}  SellRel={rel:.3f}x  '
                  f'Saved30={s30:.1f}%  AvgWait={dw:.0f}d')
    h()

    # [9] Research conclusions
    h('[9] 핵심 연구 결론')
    h('-' * 72)
    h()

    adapt_sh = results['adapt_b']['sharpe']

    # Q1: MA150 vs MA200 vs MA250 Sharpe
    h('  [Q1] MA150 / MA200 / MA250 중 최적 anchor는?')
    for sn in ('A', 'B', 'C', 'D'):
        r    = results[sn]
        diff = r['sharpe'] - adapt_sh
        h(f'    {STRAT_LABELS[sn]:<25}  Sharpe {r["sharpe"]:.3f}  '
          f'CAGR {r["cagr"]*100:.1f}%  MaxDD {r["max_dd"]*100:.1f}%  '
          f'(vs Adapt-B {diff:+.3f})')
    best_w = max(('A','B','C','D'), key=lambda n: results[n]['sharpe'])
    h(f'    -> Sharpe 최우수: {STRAT_LABELS[best_w]}')
    h()

    # Q2: Retest P 비교
    if not retest_df.empty:
        h('  [Q2] Anchor별 P(retest 60일)  (아래 anchor 신호만):')
        for acol, alabel in [('ma150','MA150'),('ma200','MA200'),('ma250','MA250')]:
            col_above = f'{acol}_above'
            if col_above in retest_df.columns:
                sub = retest_df[retest_df[col_above] == False]
                if len(sub) > 0:
                    p = sub[f'{acol}_hit60'].mean() * 100
                    h(f'    {alabel}: P60 = {p:.0f}%  (N={len(sub)})')
    h()

    # Q3: delay cost (lower anchor = higher P but lower SellRel)
    h('  [Q3] Anchor 낮을수록 (MA150) delay cost 감소?')
    for sn in ('B', 'C', 'D'):
        se  = results[sn].get('sell_eff', pd.DataFrame())
        lbl = STRAT_LABELS.get(sn, sn)
        if se is not None and not se.empty:
            armed_sub = se[se['type'] == 'armed']
            if len(armed_sub) > 0:
                dw  = armed_sub['days_wait'].mean()
                rel = armed_sub['sell_rel'].mean()
                h(f'    {lbl:<25}: armed avg wait {dw:.0f}d  SellRel {rel:.3f}x')
    h()

    # Q4: higher anchor = better sell price?
    h('  [Q4] Anchor 높을수록 (MA250) sell efficiency 향상?')
    for sn in ('B', 'C', 'D'):
        se  = results[sn].get('sell_eff', pd.DataFrame())
        lbl = STRAT_LABELS.get(sn, sn)
        if se is not None and not se.empty:
            rel  = se['sell_rel'].mean()
            s30  = se['saved30'].mean()
            f30  = se['fav30'].mean() * 100
            h(f'    {lbl:<25}: SellRel {rel:.3f}x  Saved30 {s30:.1f}%  Fav30 {f30:.0f}%')
    h()

    # Q5: final recommendation
    best_all = max(('A','B','C','D'), key=lambda n: results[n]['sharpe'])
    h('  [Q5] VR crash sell 최적 anchor?')
    h(f'    -> {STRAT_LABELS[best_all]}')
    h(f'       CAGR {results[best_all]["cagr"]*100:.1f}%  '
      f'MaxDD {results[best_all]["max_dd"]*100:.1f}%  '
      f'Sharpe {results[best_all]["sharpe"]:.3f}')
    h(f'    -> Adapt-B 대비 Sharpe: {results[best_all]["sharpe"] - adapt_sh:+.3f}')
    h()

    # [10] Charts
    h('[10] 차트 저장 중 ...')
    make_charts(data, results, retest_df, OUT_DIR)
    h(f'    저장 위치: {ROOT_DIR}\\vr_backtest\\results\\charts')
    h()
    h('[11] 완료')
    h('=' * 72)

    output = '\n'.join(lines)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write(output)


if __name__ == '__main__':
    main()
