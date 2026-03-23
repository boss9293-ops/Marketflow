"""
vr_backtest/backtests/scenario_backtest_wo25.py
================================================
WO25 -- Crash Sell Location Optimization

Crash trigger: DD5 <= -12% OR DD10 <= -18%

4 Sell Strategies:
  A: Immediate 50% sell
  B: MA200 Retest Sell  (above MA200 → immediate; below MA200 → MA200 반등 후 매도)
  C: Distance-based sell (Dist200 별 매도 비율)
  D: MA200 Anchor Sell  (above MA200 → MA200 하락 후 매도; below MA200 → 즉시)

추가 분석: P(retest MA200 | Crash Signal)

Episodes (VR scope — SRS 영역 2022 제외):
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
INITIAL_CASH     = 10_000.0
MONTHLY_CONTRIB  = 250.0

DD5_THR          = -0.12
DD10_THR         = -0.18

RETEST_TIMEOUT_B = 60   # days: below MA200 → wait for MA200 rally
RETEST_TIMEOUT_D = 30   # days: above MA200 → wait for MA200 breakdown

VMIN_LADDER = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]

# Strategy C: Dist200 → sell fraction
DIST_SELL_MAP = [
    (0.10,  0.50),   # > +10%    → sell 50%
    (0.05,  0.50),   # +5~+10%   → sell 50%
    (0.00,  0.40),   # 0~+5%     → sell 40%
    (-0.05, 0.30),   # -5~0%     → sell 30%
    (-999,  0.00),   # < -5%     → sell 0%
]

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo25_out.txt'
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

STRAT_LABELS = {
    'ma200'  : 'MA200',
    'adapt_b': 'Adapt-B',
    'A'      : 'A (Immediate)',
    'B'      : 'B (MA200 Retest)',
    'C'      : 'C (Dist-based)',
    'D'      : 'D (MA200 Anchor)',
}
STRAT_COLORS = {
    'ma200'  : '#2255cc',
    'adapt_b': '#cc4400',
    'A'      : '#9933ff',
    'B'      : '#00aa44',
    'C'      : '#ff9900',
    'D'      : '#cc0022',
}


# ═══════════════════════════════════════════════════════════════════════════════
# DETECTOR
# ═══════════════════════════════════════════════════════════════════════════════
def compute_ddvel(data: pd.DataFrame) -> tuple:
    prices = data['close'].values
    T = len(prices)
    dd5  = np.zeros(T)
    dd10 = np.zeros(T)
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    return (dd5 <= DD5_THR) | (dd10 <= DD10_THR), dd5, dd10


# ═══════════════════════════════════════════════════════════════════════════════
# P(RETEST MA200) ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════
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


def analyze_retest_probability(data: pd.DataFrame,
                                crash_sig: np.ndarray) -> pd.DataFrame:
    """
    각 crash signal (20일 쿨다운 적용) 에 대해:
      - above MA200: price가 MA200까지 하락하는 확률  (D 전략 근거)
      - below MA200: price가 MA200까지 반등하는 확률  (B 전략 근거)
    Returns DataFrame of signal records.
    """
    prices  = data['close'].values
    ma200   = data['ma200'].values
    dates   = data['date'].values
    ep_tags = _episode_tags(data)
    T = len(prices)

    records    = []
    last_sig_t = -999

    for t in range(200, T):
        if not crash_sig[t]:
            continue
        if t - last_sig_t < 20:
            continue
        if np.isnan(ma200[t]) or ma200[t] <= 0:
            continue
        last_sig_t = t

        above = bool(prices[t] > ma200[t])
        dist  = (prices[t] - ma200[t]) / ma200[t]
        ep    = ep_tags[t]

        retest = {}
        for win in (20, 30, 60):
            hit     = False
            hit_day = np.nan
            for s in range(t + 1, min(t + win + 1, T)):
                if np.isnan(ma200[s]):
                    continue
                if above:
                    # 위에서 MA200까지 하락
                    if prices[s] <= ma200[s] * 1.005:
                        hit = True;  hit_day = s - t;  break
                else:
                    # 아래서 MA200까지 반등
                    if prices[s] >= ma200[s] * 0.995:
                        hit = True;  hit_day = s - t;  break
            retest[f'hit_{win}'] = hit
            retest[f'day_{win}'] = hit_day

        records.append({
            'date'   : dates[t],
            'price'  : prices[t],
            'ma200'  : ma200[t],
            'dist200': dist,
            'above'  : above,
            'episode': ep,
            **retest,
        })

    return pd.DataFrame(records) if records else pd.DataFrame()


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
def _dist_sell_pct(dist200: float) -> float:
    for min_d, spct in DIST_SELL_MAP:
        if dist200 >= min_d:
            return spct
    return 0.0


def run_wo25_strategy(data: pd.DataFrame,
                      crash_sig: np.ndarray,
                      strategy: str) -> dict:
    """
    Strategies A / B / C / D.
    Re-entry (all): Vmin ladder (-40/-50/-60% ATH) + price > MA200 full buy.
    """
    prices  = data['close'].values
    ma200   = data['ma200'].values
    dd_arr  = data['drawdown'].values   # rolling 252-day ATH drawdown (from loader)
    dates   = data['date'].values
    T = len(prices)

    equity   = np.zeros(T)
    cash_arr = np.zeros(T)
    tlog     = []
    sell_log = []

    shares = INITIAL_CASH / prices[0]
    cash   = 0.0

    state = 'normal'   # 'normal' | 'armed' | 'defensive'

    # Armed state tracking
    armed_t    = 0
    armed_cond = None    # 'retest_up' | 'breakdown_down'
    armed_dist = 0.0
    armed_price= 0.0

    # Defensive state
    ladder_done = [False, False, False]

    # Cooldown (prevent re-trigger immediately after re-entry)
    crash_cooldown = 0

    equity[0]   = shares * prices[0]
    cash_arr[0] = cash
    tlog.append((dates[0], 'BUY_INIT', prices[0], shares, cash))
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price  = prices[t]
        ma200t = ma200[t] if (not np.isnan(ma200[t]) and ma200[t] > 0) else price
        dd_ath = dd_arr[t]
        date   = dates[t]

        # Monthly DCA
        curr_month = pd.Timestamp(date).month
        if curr_month != prev_month:
            cash      += MONTHLY_CONTRIB
            shares    += MONTHLY_CONTRIB / price
            prev_month = curr_month

        # ── ARMED: check sell trigger ──────────────────────────────────────
        if state == 'armed':
            days_armed = t - armed_t
            do_sell    = False
            sell_price = price
            disarm_no_sell = False

            if armed_cond == 'retest_up':
                # B: below MA200, waiting for rally back to MA200
                if price >= ma200t * 0.995:
                    do_sell    = True
                    sell_price = price   # sell at market when MA200 is touched
                elif days_armed >= RETEST_TIMEOUT_B:
                    do_sell    = True    # timeout: sell at market
                    sell_price = price

            elif armed_cond == 'breakdown_down':
                # D: above MA200, waiting for price to fall to MA200
                if price <= ma200t * 1.005:
                    do_sell    = True
                    sell_price = price
                elif days_armed >= RETEST_TIMEOUT_D:
                    # Timeout: if price still above MA200, market recovered → disarm
                    if price > ma200t:
                        disarm_no_sell = True
                    else:
                        do_sell    = True
                        sell_price = price

            if disarm_no_sell:
                state = 'normal'
                crash_cooldown = 5
                tlog.append((date, 'DISARM_RECOVERED', price, shares, cash))

            elif do_sell:
                sell_sh  = shares * 0.50
                proceeds = sell_sh * sell_price
                cash    += proceeds
                shares  -= sell_sh
                sell_log.append({
                    't'        : t,
                    'date'     : date,
                    'price'    : sell_price,
                    'sell_pct' : 0.50,
                    'type'     : f'{strategy}_armed',
                    'dist200'  : armed_dist,
                    'signal_t' : armed_t,
                    'sig_price': armed_price,
                })
                tlog.append((date, f'SELL_{strategy}_ARMED', sell_price, shares, cash))
                state = 'defensive'

        # ── DEFENSIVE: Vmin ladder + MA200 re-entry ───────────────────────
        elif state == 'defensive':
            for i, (vlevel, vbuy_pct) in enumerate(VMIN_LADDER):
                if not ladder_done[i] and dd_ath <= vlevel:
                    ladder_done[i] = True
                    buy_val = (cash + shares * price) * vbuy_pct
                    buy_val = min(buy_val, cash)
                    if buy_val > 0:
                        shares += buy_val / price
                        cash   -= buy_val
                        tlog.append((date, f'VMIN_BUY_{i+1}', price, shares, cash))

            # MA200 re-entry: full buy when price crosses above MA200
            if price > ma200t and crash_cooldown <= 0:
                if cash > 0:
                    shares += cash / price
                    cash    = 0.0
                    tlog.append((date, 'MA200_REENTRY', price, shares, cash))
                state       = 'normal'
                ladder_done = [False, False, False]
                crash_cooldown = 10

        # ── NORMAL: check crash signal ────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0 and not np.isnan(ma200[t]):
                dist200 = (price - ma200t) / ma200t

                if strategy == 'A':
                    # Immediate 50%
                    sell_sh  = shares * 0.50
                    cash    += sell_sh * price
                    shares  -= sell_sh
                    sell_log.append({'t': t, 'date': date, 'price': price,
                                     'sell_pct': 0.50, 'type': 'A_imm',
                                     'dist200': dist200, 'signal_t': t, 'sig_price': price})
                    tlog.append((date, 'SELL_A', price, shares, cash))
                    state = 'defensive'

                elif strategy == 'B':
                    if price > ma200t:
                        # Above MA200: immediate 50%
                        sell_sh  = shares * 0.50
                        cash    += sell_sh * price
                        shares  -= sell_sh
                        sell_log.append({'t': t, 'date': date, 'price': price,
                                         'sell_pct': 0.50, 'type': 'B_above_imm',
                                         'dist200': dist200, 'signal_t': t, 'sig_price': price})
                        tlog.append((date, 'SELL_B_ABOVE', price, shares, cash))
                        state = 'defensive'
                    else:
                        # Below MA200: arm retest_up
                        state      = 'armed'
                        armed_t    = t
                        armed_cond = 'retest_up'
                        armed_dist = dist200
                        armed_price= price
                        tlog.append((date, 'ARM_B_RETEST', price, shares, cash))

                elif strategy == 'C':
                    sell_pct = _dist_sell_pct(dist200)
                    if sell_pct > 0:
                        sell_sh  = shares * sell_pct
                        cash    += sell_sh * price
                        shares  -= sell_sh
                        state    = 'defensive'
                    # Always log (even 0% sell)
                    sell_log.append({'t': t, 'date': date, 'price': price,
                                     'sell_pct': sell_pct, 'type': 'C_dist',
                                     'dist200': dist200, 'signal_t': t, 'sig_price': price})
                    tlog.append((date, f'SELL_C_{sell_pct:.0%}', price, shares, cash))

                elif strategy == 'D':
                    if price > ma200t:
                        # Above MA200: arm breakdown_down
                        state      = 'armed'
                        armed_t    = t
                        armed_cond = 'breakdown_down'
                        armed_dist = dist200
                        armed_price= price
                        tlog.append((date, 'ARM_D_BREAKDOWN', price, shares, cash))
                    else:
                        # Below MA200: immediate 50%
                        sell_sh  = shares * 0.50
                        cash    += sell_sh * price
                        shares  -= sell_sh
                        sell_log.append({'t': t, 'date': date, 'price': price,
                                         'sell_pct': 0.50, 'type': 'D_below_imm',
                                         'dist200': dist200, 'signal_t': t, 'sig_price': price})
                        tlog.append((date, 'SELL_D_BELOW', price, shares, cash))
                        state = 'defensive'

        if crash_cooldown > 0:
            crash_cooldown -= 1

        equity[t]   = cash + shares * price
        cash_arr[t] = cash

    sl_df = pd.DataFrame(sell_log) if sell_log else pd.DataFrame()
    return {
        'equity'  : equity,
        'cash'    : cash_arr,
        'tlog'    : tlog,
        'sell_log': sl_df,
        'final'   : float(equity[-1]),
    }


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
    sharpe    = (float(daily_ret.mean() / daily_ret.std() * np.sqrt(252))
                 if daily_ret.std() > 0 else 0.0)

    return {'final': float(eq.iloc[-1]), 'cagr': cagr, 'max_dd': max_dd, 'sharpe': sharpe}


def _episode_return(equity: np.ndarray, dates,
                    ep_start: str, ep_end: str) -> tuple:
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
def analyze_sell_efficiency(sell_df: pd.DataFrame,
                             data: pd.DataFrame) -> pd.DataFrame:
    """
    각 매도 이벤트:
      sell_rel  = sell_price / signal_price  (>1: 신호보다 높은 가격에 팜)
      saved_30  = (sell_price - min30d_after) / sell_price * 100
      fav_30    = 30일 후 가격 < sell_price
    """
    if sell_df.empty:
        return pd.DataFrame()
    prices = data['close'].values
    T = len(prices)

    rows = []
    for _, row in sell_df.iterrows():
        sig_t  = int(row['signal_t'])
        sell_t = int(row['t'])
        sp     = float(row['price'])
        spct   = float(row['sell_pct'])
        if spct == 0:
            continue

        end30 = min(sell_t + 30 + 1, T)
        end60 = min(sell_t + 60 + 1, T)
        min30 = float(np.min(prices[sell_t:end30])) if end30 > sell_t else sp
        min60 = float(np.min(prices[sell_t:end60])) if end60 > sell_t else sp

        sig_price = prices[sig_t] if sig_t < T else sp
        sell_rel  = sp / sig_price if sig_price > 0 else 1.0
        saved30   = (sp - min30) / sp * 100
        saved60   = (sp - min60) / sp * 100

        rows.append({
            'date'    : row['date'],
            'type'    : row['type'],
            'dist200' : row['dist200'],
            'sell_pct': spct,
            'sell_rel': sell_rel,
            'saved30' : saved30,
            'saved60' : saved60,
            'fav30'   : min30 < sp,
            'fav60'   : min60 < sp,
        })
    return pd.DataFrame(rows)


# ═══════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═══════════════════════════════════════════════════════════════════════════════
def make_charts(data: pd.DataFrame, results: dict,
                retest_df: pd.DataFrame, out_dir: str):
    dates = pd.to_datetime(data['date'].values)
    _chart_equity(dates, results, out_dir)
    _chart_episode_heatmap(data, results, out_dir)
    _chart_retest_prob(retest_df, out_dir)
    _chart_sell_efficiency(results, out_dir)
    _chart_summary_bars(results, out_dir)


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)

    ax = axes[0]
    for name, res in results.items():
        eq = res['equity']
        lw = 2.0 if name in ('adapt_b', 'B', 'D') else 1.3
        ax.semilogy(dates, eq / eq[0],
                    label=STRAT_LABELS.get(name, name),
                    color=STRAT_COLORS.get(name, '#888'),
                    lw=lw, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log scale)')
    ax.legend(loc='upper left', fontsize=9)
    ax.set_title('WO25 — Equity Curves')
    ax.grid(True, alpha=0.2)

    ax2 = axes[1]
    for name, res in results.items():
        eq = res['equity']
        roll_max = np.maximum.accumulate(eq)
        dd = (eq - roll_max) / roll_max * 100
        ax2.plot(dates, dd,
                 color=STRAT_COLORS.get(name, '#888'), lw=1.0, alpha=0.7,
                 label=STRAT_LABELS.get(name, name))
    ax2.set_ylabel('Drawdown (%)')
    ax2.set_xlabel('Date')
    ax2.legend(loc='lower right', fontsize=8)
    ax2.grid(True, alpha=0.2)

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'equity_wo25.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    equity_wo25.png')


def _chart_episode_heatmap(data, results, out_dir):
    strat_order = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D']
    ep_names    = list(CRASH_EPISODES.keys())
    dates       = data['date'].values

    matrix = np.zeros((len(strat_order), len(ep_names)))
    for i, sn in enumerate(strat_order):
        eq = results[sn]['equity']
        for j, (ep_name, (ep_s, ep_e)) in enumerate(CRASH_EPISODES.items()):
            _, ep_dd = _episode_return(eq, dates, ep_s, ep_e)
            matrix[i, j] = ep_dd * 100 if not np.isnan(ep_dd) else 0

    fig, ax = plt.subplots(figsize=(12, 5))
    im = ax.imshow(matrix, cmap='RdYlGn', aspect='auto', vmin=-80, vmax=0)
    ax.set_xticks(range(len(ep_names)))
    ax.set_xticklabels(ep_names, rotation=20, ha='right', fontsize=9)
    ax.set_yticks(range(len(strat_order)))
    ax.set_yticklabels([STRAT_LABELS.get(n, n) for n in strat_order], fontsize=9)
    for i in range(len(strat_order)):
        for j in range(len(ep_names)):
            v = matrix[i, j]
            ax.text(j, i, f'{v:.0f}%', ha='center', va='center',
                    fontsize=8, color='black' if v > -40 else 'white')
    plt.colorbar(im, ax=ax, label='MaxDD (%)')
    ax.set_title('WO25 — Episode MaxDD Heatmap')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'ep_heatmap_wo25.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    ep_heatmap_wo25.png')


def _chart_retest_prob(retest_df, out_dir):
    if retest_df is None or retest_df.empty:
        return
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    for ax, above_flag, title, timeout in zip(
        axes,
        [True,  False],
        ['위MA200 신호 → MA200 하락 확률 (D 근거)', '아래MA200 신호 → MA200 반등 확률 (B 근거)'],
        [RETEST_TIMEOUT_D, RETEST_TIMEOUT_B],
    ):
        sub = retest_df[retest_df['above'] == above_flag]
        n   = len(sub)
        if n == 0:
            ax.set_title(f'{title}  (N=0)'); continue

        wins  = [20, 30, 60]
        probs = [sub[f'hit_{w}'].mean() * 100 for w in wins]
        bars  = ax.bar(wins, probs, color=['#4488ff', '#0066cc', '#003399'],
                       alpha=0.8, width=8)
        for bar, p in zip(bars, probs):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1.5,
                    f'{p:.0f}%', ha='center', va='bottom', fontsize=11,
                    fontweight='bold')
        ax.axvline(timeout, color='red', ls='--', lw=1.5, alpha=0.7,
                   label=f'timeout ({timeout}d)')
        ax.axhline(50, color='k', ls=':', lw=0.8, alpha=0.5)
        ax.set_xlim(0, 75);  ax.set_ylim(0, 100)
        ax.set_xlabel('Days after crash signal')
        ax.set_ylabel('Retest probability (%)')
        ax.set_title(f'{title}\n(N={n})')
        ax.legend(fontsize=9); ax.grid(True, alpha=0.2)

    fig.suptitle('WO25 — P(retest MA200 | Crash Signal)', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'retest_prob_wo25.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    retest_prob_wo25.png')


def _chart_sell_efficiency(results, out_dir):
    strats  = ['A', 'B', 'C', 'D']
    colors_list = [STRAT_COLORS[s] for s in strats]

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    # Panel 1: saved30 (saved vs 30-day low after sell)
    ax = axes[0]
    data_s30  = []
    lbl_list  = []
    for s in strats:
        se = results[s].get('sell_eff', pd.DataFrame())
        if se is not None and not se.empty and 'saved30' in se.columns:
            data_s30.append(se['saved30'].dropna().values)
            lbl_list.append(STRAT_LABELS.get(s, s))
    if data_s30:
        bp = ax.boxplot(data_s30, labels=lbl_list, patch_artist=True)
        for patch, c in zip(bp['boxes'], colors_list[:len(data_s30)]):
            patch.set_facecolor(c); patch.set_alpha(0.7)
    ax.axhline(0, color='k', ls='--', lw=0.8)
    ax.set_ylabel('Saved vs 30d Low (%)')
    ax.set_title('매도 효율: 30일 최저점 대비 절약액')
    ax.grid(True, alpha=0.2)

    # Panel 2: sell_rel (sell price / signal price)
    ax2 = axes[1]
    data_rel = []
    for s in strats:
        se = results[s].get('sell_eff', pd.DataFrame())
        if se is not None and not se.empty and 'sell_rel' in se.columns:
            data_rel.append(se['sell_rel'].dropna().values)
    if data_rel:
        bp2 = ax2.boxplot(data_rel,
                          labels=lbl_list[:len(data_rel)], patch_artist=True)
        for patch, c in zip(bp2['boxes'], colors_list[:len(data_rel)]):
            patch.set_facecolor(c); patch.set_alpha(0.7)
    ax2.axhline(1.0, color='k', ls='--', lw=0.8, label='신호가격=매도가격')
    ax2.set_ylabel('Sell Price / Signal Price')
    ax2.set_title('매도 위치: 신호 대비 실제 매도가')
    ax2.legend(fontsize=9); ax2.grid(True, alpha=0.2)

    fig.suptitle('WO25 — Sell Efficiency Analysis', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'sell_eff_wo25.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    sell_eff_wo25.png')


def _chart_summary_bars(results, out_dir):
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
                    bar.get_height() + 0.3,
                    f'{v:.2f}', ha='center', va='bottom', fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=20, ha='right', fontsize=8)
        ax.set_ylabel(ylabel); ax.set_title(title)
        ax.grid(True, alpha=0.2)

    fig.suptitle('WO25 — Strategy Comparison', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'summary_wo25.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    summary_wo25.png')


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    lines = []

    def h(s=''):
        lines.append(s)

    h('=' * 72)
    h('  WO25 -- Crash Sell Location Optimization')
    h('  Crash Signal 발생 시 MA200 기준 최적 매도 전략')
    h('=' * 72)
    h()

    # ── [1] Data ──────────────────────────────────────────────────────────────
    h('[1] TQQQ 데이터 로드 ...')
    data = load_tqqq()
    T    = len(data)
    h(f'    {T}개 거래일  ({data["date"].iloc[0].date()} ~ {data["date"].iloc[-1].date()})')
    h()

    # ── [2] Crash Signal ──────────────────────────────────────────────────────
    crash_sig, dd5, dd10 = compute_ddvel(data)
    ma200_arr = data['ma200'].values
    prices    = data['close'].values
    valid     = ~np.isnan(ma200_arr)

    n_sig    = int(crash_sig.sum())
    n_above  = int((crash_sig & valid & (prices > ma200_arr)).sum())
    n_below  = int((crash_sig & valid & (prices <= ma200_arr)).sum())

    h('[2] DDVel Crash Signal (DD5<=-12% OR DD10<=-18%)')
    h(f'    총 신호: {n_sig}개 ({n_sig/T*100:.1f}%)')
    h(f'    MA200 위 신호: {n_above}개 ({n_above/n_sig*100:.1f}%)')
    h(f'    MA200 아래 신호: {n_below}개 ({n_below/n_sig*100:.1f}%)')
    h()

    # ── [3] P(retest MA200) ───────────────────────────────────────────────────
    h('[3] P(retest MA200 | Crash Signal) 분석 ...')
    retest_df = analyze_retest_probability(data, crash_sig)
    n_rt      = len(retest_df)
    n_ra      = int(retest_df['above'].sum()) if not retest_df.empty else 0
    n_rb      = n_rt - n_ra
    h(f'    분석 신호: {n_rt}개  (쿨다운 20일)')
    h(f'    MA200 위: {n_ra}개  /  아래: {n_rb}개')
    h()

    # Above → drop to MA200
    h('  [위MA200 신호] → MA200까지 하락 확률  ← Strategy D 유효성 근거')
    sub_a = retest_df[retest_df['above']] if not retest_df.empty else pd.DataFrame()
    if len(sub_a) > 0:
        for win in (20, 30, 60):
            p  = sub_a[f'hit_{win}'].mean() * 100
            dm = sub_a.loc[sub_a[f'hit_{win}'] == True, f'day_{win}'].mean()
            dm_s = f'{dm:.0f}d' if not np.isnan(dm) else 'n/a'
            h(f'      {win:>2}일 내 MA200 하락  P = {p:.0f}%  (avg {dm_s})')
    else:
        h('      신호 없음')
    h()

    # Below → rally to MA200
    h('  [아래MA200 신호] → MA200까지 반등 확률  ← Strategy B 유효성 근거')
    sub_b = retest_df[~retest_df['above']] if not retest_df.empty else pd.DataFrame()
    if len(sub_b) > 0:
        for win in (20, 30, 60):
            p  = sub_b[f'hit_{win}'].mean() * 100
            dm = sub_b.loc[sub_b[f'hit_{win}'] == True, f'day_{win}'].mean()
            dm_s = f'{dm:.0f}d' if not np.isnan(dm) else 'n/a'
            h(f'      {win:>2}일 내 MA200 반등  P = {p:.0f}%  (avg {dm_s})')
    else:
        h('      신호 없음')
    h()

    # By episode (below MA200 → rally)
    h('  에피소드별 [아래MA200 → 60일 반등] 확률:')
    if len(sub_b) > 0:
        for ep in sub_b['episode'].unique():
            ep_sub = sub_b[sub_b['episode'] == ep]
            if len(ep_sub) == 0:
                continue
            p60   = ep_sub['hit_60'].mean() * 100
            dm60  = ep_sub.loc[ep_sub['hit_60'] == True, 'day_60'].mean()
            dm_s  = f'{dm60:.0f}d' if not np.isnan(dm60) else 'n/a'
            h(f'    {ep:<26}  N={len(ep_sub):>2}  P60={p60:.0f}%  avgDay={dm_s}')
    h()

    # ── [4] Strategy runs ─────────────────────────────────────────────────────
    h('[4] 전략 백테스트 실행 ...')
    results = {}

    h('    MA200 ...')
    r_ma200 = run_ma200_strategy(data)
    r_ma200.update(_compute_metrics(r_ma200['equity'], data['date'].values))
    results['ma200'] = r_ma200

    h('    Adapt-B ...')
    r_adapt = run_adaptive_ma(data)
    r_adapt.update(_compute_metrics(r_adapt['equity'], data['date'].values))
    results['adapt_b'] = r_adapt

    for sname in ('A', 'B', 'C', 'D'):
        h(f'    Strategy {sname} ({STRAT_LABELS[sname]}) ...')
        res = run_wo25_strategy(data, crash_sig, sname)
        res.update(_compute_metrics(res['equity'], data['date'].values))
        if not res['sell_log'].empty:
            res['sell_eff'] = analyze_sell_efficiency(res['sell_log'], data)
        else:
            res['sell_eff'] = pd.DataFrame()
        results[sname] = res
    h()

    # ── [5] Overall performance ───────────────────────────────────────────────
    h('[5] 전체 성과 비교 (2011-2026)')
    h('-' * 72)
    h(f"  {'전략':<28}  {'최종자산':>12}  {'CAGR':>6}  {'MaxDD':>7}  {'Sharpe':>7}")
    h('-' * 72)
    for name in ('ma200', 'adapt_b', 'A', 'B', 'C', 'D'):
        r   = results[name]
        lbl = STRAT_LABELS.get(name, name)
        h(f"  {lbl:<28}  ${r['final']:>10,.0f}  "
          f"{r['cagr']*100:>5.1f}%  "
          f"{r['max_dd']*100:>6.1f}%  "
          f"{r['sharpe']:>7.3f}")
    h('-' * 72)
    h()

    # ── [6] Episode breakdown ─────────────────────────────────────────────────
    h('[6] Crash 에피소드별 MaxDD 비교')
    h()
    strat_order = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D']
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f"  {'전략':<28}  {'MaxDD':>8}  {'EpRet':>8}")
        h('  ' + '-' * 50)
        for sn in strat_order:
            r = results[sn]
            ep_ret, ep_dd = _episode_return(r['equity'], data['date'].values, ep_s, ep_e)
            lbl  = STRAT_LABELS.get(sn, sn)
            dd_s = f'{ep_dd*100:.1f}%' if not np.isnan(ep_dd) else 'n/a'
            ret_s= f'{ep_ret*100:+.1f}%' if not np.isnan(ep_ret) else 'n/a'
            h(f'  {lbl:<28}  {dd_s:>8}  {ret_s:>8}')
        h()

    # ── [7] Sell efficiency ───────────────────────────────────────────────────
    h('[7] 매도 효율성 분석')
    h()
    h(f"  {'전략':<22}  {'건수':>4}  {'SellRel':>8}  {'Saved30':>8}  {'Fav30':>6}")
    h('  ' + '-' * 58)
    for sn in ('A', 'B', 'C', 'D'):
        se = results[sn].get('sell_eff', pd.DataFrame())
        if se is not None and not se.empty:
            n_s     = len(se)
            rel_avg = se['sell_rel'].mean()
            s30_avg = se['saved30'].mean()
            f30_avg = se['fav30'].mean() * 100
        else:
            n_s = 0; rel_avg = 0; s30_avg = 0; f30_avg = 0
        lbl = STRAT_LABELS.get(sn, sn)
        h(f'  {lbl:<22}  {n_s:>4}  {rel_avg:>7.3f}x  {s30_avg:>7.1f}%  {f30_avg:>5.0f}%')

        # B / D: break down by sell type
        if sn in ('B', 'D') and se is not None and not se.empty:
            for stype in se['type'].unique():
                sub_t  = se[se['type'] == stype]
                n_t    = len(sub_t)
                rel_t  = sub_t['sell_rel'].mean()
                s30_t  = sub_t['saved30'].mean()
                f30_t  = sub_t['fav30'].mean() * 100
                h(f'    [{stype:<20}]  {n_t:>4}  {rel_t:>7.3f}x  {s30_t:>7.1f}%  {f30_t:>5.0f}%')
    h()

    # ── [8] Research conclusions ──────────────────────────────────────────────
    h('[8] 핵심 연구 결론')
    h('-' * 72)
    h()

    adapt_sh = results['adapt_b']['sharpe']

    # Q1: immediate vs MA200-based
    h('  [Q] Q1. Crash 즉시 매도 vs MA200 기준 매도 — 어느 것이 유리한가?')
    for sn in ('A', 'B', 'C', 'D'):
        r   = results[sn]
        diff= r['sharpe'] - adapt_sh
        h(f'    {STRAT_LABELS[sn]:<25} Sharpe {r["sharpe"]:.3f}  '
          f'CAGR {r["cagr"]*100:.1f}%  MaxDD {r["max_dd"]*100:.1f}%  '
          f'(vs Adapt-B {diff:+.3f})')
    best_w = max(('A','B','C','D'), key=lambda n: results[n]['sharpe'])
    h(f'    → Sharpe 최우수: {STRAT_LABELS[best_w]}')
    h()

    # Q2: P(retest) implication for B
    h('  [Q] Q2. P(아래MA200 → MA200 반등) 의미 분석')
    if len(sub_b) > 0:
        p30b = sub_b['hit_30'].mean() * 100
        p60b = sub_b['hit_60'].mean() * 100
        h(f'    P(30일 반등) = {p30b:.0f}%  /  P(60일 반등) = {p60b:.0f}%')
        if p60b >= 50:
            h('    → 과반수 신호가 MA200 반등 → B 전략 MA200 Retest sell 유효')
            if results['B']['sharpe'] > results['A']['sharpe']:
                h('    → 실제 B 전략 Sharpe 우위 확인 ✓')
            else:
                h('    → 그러나 실제 백테스트에서 A보다 B가 낮음 (지연 비용 존재)')
        else:
            h('    → 반등 확률 50% 미만 → B 전략 aiming 위험 (장기 하락 구간)')
    h()

    # Q3: D strategy (MA200 anchor)
    h('  [Q] Q3. MA200 Anchor Sell (D) — 위MA200에서 MA200 하락 후 매도 효과?')
    if len(sub_a) > 0:
        p30d = sub_a['hit_30'].mean() * 100
        p60d = sub_a['hit_60'].mean() * 100
        h(f'    위MA200 신호: P(30일 MA200 하락) = {p30d:.0f}%  /  P(60일) = {p60d:.0f}%')
    r_d = results['D']
    r_a = results['A']
    if r_d['sharpe'] > r_a['sharpe']:
        h(f'    D Sharpe ({r_d["sharpe"]:.3f}) > A Sharpe ({r_a["sharpe"]:.3f})')
        h('    → MA200 까지 내려서 파는 것이 즉시 매도보다 유리')
    else:
        h(f'    D Sharpe ({r_d["sharpe"]:.3f}) < A Sharpe ({r_a["sharpe"]:.3f})')
        h('    → 즉시 매도(A)가 MA200 Anchor(D)보다 유리')
    h()

    # Q4: distance-based (C)
    h('  [Q] Q4. Distance-based sell (C) — panic bottom 보호 효과?')
    r_c = results['C']
    h(f'    C MaxDD {r_c["max_dd"]*100:.1f}%  vs  A MaxDD {r_a["max_dd"]*100:.1f}%')
    h(f'    C Sharpe {r_c["sharpe"]:.3f}  vs  A Sharpe {r_a["sharpe"]:.3f}')
    if r_c['sharpe'] > r_a['sharpe']:
        h('    → C 거리기반 매도가 Sharpe 우위 → 패닉 바텀 보호 유효')
    else:
        h('    → A 즉시 50% 단순 전략이 C보다 Sharpe 우위')
    h()

    # Q5: final recommendation
    best_all = max(('A','B','C','D'), key=lambda n: results[n]['sharpe'])
    h('  [Q] Q5. VR crash engine 최적 매도 방식?')
    h(f'    → Sharpe 최우수: {STRAT_LABELS[best_all]}')
    h(f'       CAGR {results[best_all]["cagr"]*100:.1f}%  '
      f'MaxDD {results[best_all]["max_dd"]*100:.1f}%  '
      f'Sharpe {results[best_all]["sharpe"]:.3f}')
    h(f'    → Adapt-B 대비: {results[best_all]["sharpe"] - adapt_sh:+.3f} Sharpe')
    h()

    # ── [9] Charts ────────────────────────────────────────────────────────────
    h('[9] 차트 저장 중 ...')
    make_charts(data, results, retest_df, OUT_DIR)
    h(f'    저장 위치: {ROOT_DIR}\\vr_backtest\\results\\charts')
    h()
    h('[10] 완료')
    h('=' * 72)

    output = '\n'.join(lines)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write(output)



if __name__ == '__main__':
    main()
