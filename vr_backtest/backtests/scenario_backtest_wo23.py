"""
vr_backtest/backtests/scenario_backtest_wo23.py
================================================
WO23 -- Defense Ladder Timing Optimization

연구 목표:
  DDVel crash signal 이후 25%-20%-15% ladder의 최적 실행 타이밍 결정

Groups:
  A (Time-based)  : Step2/3를 signal day 기준 N 거래일 후 실행
  B (Price-based) : Step2/3를 이전 step 가격 대비 X% 추가 하락 시 실행
  C (Hybrid)      : 시간 조건 + 가격/변동성 조건 동시 충족

Variants: A1/A2/A3/A4 + B1/B2/B3 + C1/C2/C3 (10개) + MA200 + Adapt-B

Crash Trigger: dd5 <= -12% OR dd10 <= -18%
Re-entry: Vmin ladder (-40/-50/-60% ATH) + MA200 full re-entry

분석 대상 crash 에피소드:
  2011 Debt Ceiling, 2015 China Shock, 2018 Vol Spike,
  2018 Q4 Selloff, 2020 COVID Crash
  (2022 Fed Bear: SRS 영역 — 분석 제외)
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

# ── 에피소드 (전체 분석용) ────────────────────────────────────────────────────
ALL_EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2022 Fed Bear"     : ("2021-11-01", "2023-06-30"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}
# VR 분석 대상 (SRS 영역 제외)
CRASH_EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
}

POST_6M_DAYS    = 126
INITIAL_CASH    = 10_000.0
MONTHLY_CONTRIB = 250.0

# Defense ladder: Step1=25%, Step2=20%, Step3=15% of shares at Step1 execution
STEP_PCT = [0.25, 0.20, 0.15]
# Vmin re-entry ladder
VMIN_LADDER = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]

# ── 전략 설정 ──────────────────────────────────────────────────────────────────
# Group A: s2_d, s3_d = days from signal (step1) day
# Group B: s2_p, s3_p = price drop % from previous step
# Group C: s2_d, s2_c (condition), s3_d, s3_c (condition)
VARIANTS = {
    'A1': {'group': 'A', 's2_d':  3, 's3_d':  5},
    'A2': {'group': 'A', 's2_d':  2, 's3_d':  4},
    'A3': {'group': 'A', 's2_d':  3, 's3_d':  6},
    'A4': {'group': 'A', 's2_d':  5, 's3_d': 10},
    'B1': {'group': 'B', 's2_p': -0.05, 's3_p': -0.05},
    'B2': {'group': 'B', 's2_p': -0.04, 's3_p': -0.06},
    'B3': {'group': 'B', 's2_p': -0.05, 's3_p': -0.08},
    'C1': {'group': 'C', 's2_d': 2, 's2_c': 'lower_low',  's3_d': 2, 's3_c': 'new_low'},
    'C2': {'group': 'C', 's2_d': 3, 's2_c': 'dd10_thresh', 's3_d': 2, 's3_c': 'vol_or_dd'},
    'C3': {'group': 'C', 's2_d': 3, 's2_c': 'below_step1', 's3_d': 5, 's3_c': 'new_low'},
}

LABELS = {
    'ma200'  : 'MA200',
    'adapt_b': 'Adapt-B',
    'A1': 'A1 (+3,+5d)',     'A2': 'A2 (+2,+4d)',
    'A3': 'A3 (+3,+6d)',     'A4': 'A4 (+5,+10d)',
    'B1': 'B1 (-5%,-5%)',    'B2': 'B2 (-4%,-6%)',    'B3': 'B3 (-5%,-8%)',
    'C1': 'C1 (2d+low)',     'C2': 'C2 (3d+DD10)',    'C3': 'C3 (3d+below/5d+low)',
}
COLORS = {
    'ma200'  : '#2255cc', 'adapt_b': '#cc4400',
    'A1': '#9933ff', 'A2': '#bb55ff', 'A3': '#dd88ff', 'A4': '#eeaaff',
    'B1': '#ff3344', 'B2': '#ff7755', 'B3': '#ffaa88',
    'C1': '#00aa44', 'C2': '#44cc77', 'C3': '#88ddaa',
}

GROUP_COLORS = {'A': '#9933ff', 'B': '#ff3344', 'C': '#00aa44'}


# ═══════════════════════════════════════════════════════════════════════════════
# DETECTORS
# ═══════════════════════════════════════════════════════════════════════════════
def compute_ddvel(data: pd.DataFrame,
                  dd5_thr: float = -0.12,
                  dd10_thr: float = -0.18) -> tuple:
    prices = data['close'].values
    T      = len(prices)
    dd5    = np.zeros(T)
    dd10   = np.zeros(T)
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    return (dd5 <= dd5_thr) | (dd10 <= dd10_thr), dd5, dd10


def compute_rvol(data: pd.DataFrame, vol_hi_pct: float = 0.80) -> tuple:
    prices = data['close'].values
    T      = len(prices)
    rets   = np.zeros(T)
    for t in range(1, T): rets[t] = np.log(prices[t] / prices[t-1])
    rvol10 = np.zeros(T)
    for t in range(10, T): rvol10[t] = np.std(rets[t-9:t+1]) * np.sqrt(252)
    vol_80 = float(np.percentile(rvol10[10:], vol_hi_pct * 100))
    return rvol10, vol_80


# ═══════════════════════════════════════════════════════════════════════════════
# DEFENSE LADDER STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
def run_ladder_strategy(data         : pd.DataFrame,
                        crash_sig    : np.ndarray,
                        dd10_arr     : np.ndarray,
                        rvol10       : np.ndarray,
                        vol_80       : float,
                        cfg          : dict,
                        initial_cash : float = INITIAL_CASH,
                        monthly_contrib: float = MONTHLY_CONTRIB) -> dict:
    """
    25%-20%-15% Defense Ladder Strategy.
    Re-entry: Vmin ladder + MA200 full re-entry.
    """
    dates   = data['date'].values
    prices  = data['close'].values
    ma200_a = data['ma200'].values
    dd_arr  = data['drawdown'].values   # ATH drawdown for Vmin ladder
    T       = len(dates)
    grp     = cfg['group']

    equity   = np.zeros(T)
    cash_arr = np.zeros(T)
    tlog     = []

    shares  = initial_cash / prices[0]
    cash    = 0.0

    # State machine
    step_count    = 0     # 0=normal, 1/2/3=steps done
    step1_shares  = 0.0   # shares at Step1 execution
    step1_price   = 0.0
    step2_price   = 0.0
    step1_day     = -1
    step2_day     = -1
    min_s1        = 1e9   # min price since step1 (for "lower low" conditions)
    min_s2        = 1e9   # min price since step2 (for "new low" conditions)
    ladder_done   = [False, False, False]

    # Pre-compute dd10 as absolute return (separate from dd10_arr which is rolling-high-based)
    # dd10_arr already passed in as dd10 time-series (from compute_ddvel)

    tlog.append((dates[0], "BUY_INIT", prices[0], shares, 0.0))
    equity[0]   = shares * prices[0]
    cash_arr[0] = 0.0
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price  = prices[t]
        ma200  = ma200_a[t]
        dd_ath = dd_arr[t]    # from ATH (for Vmin ladder)
        crash  = bool(crash_sig[t])
        d10    = dd10_arr[t]  # 10d return (from compute_ddvel dd10)
        rvol   = rvol10[t]

        curr_month = pd.Timestamp(dates[t]).month
        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        # Update running minimums
        if step_count >= 1:
            min_s1 = min(min_s1, price)
        if step_count >= 2:
            min_s2 = min(min_s2, price)

        days_s1 = t - step1_day if step1_day >= 0 else 0
        days_s2 = t - step2_day if step2_day >= 0 else 0

        if step_count == 0:
            # Normal: DCA
            if cash > 0.5:
                ns = cash / price; shares += ns; cash = 0.0
                tlog.append((dates[t], "DCA", price, ns, 0.0))

            # Crash trigger → Step1
            if crash and shares > 0.01:
                step1_shares = shares
                step1_price  = price
                step1_day    = t
                min_s1       = price
                min_s2       = 1e9
                ladder_done  = [False, False, False]

                ss = shares * STEP_PCT[0]
                cash += ss * price; shares -= ss
                step_count = 1
                tlog.append((dates[t], "STEP1_25", price, ss, cash))

        else:
            # --- Step2 trigger ---
            if step_count == 1:
                s2_ok = False
                if grp == 'A':
                    s2_ok = (days_s1 >= cfg['s2_d'])
                elif grp == 'B':
                    s2_ok = (price <= step1_price * (1.0 + cfg['s2_p']))
                elif grp == 'C':
                    cond  = cfg['s2_c']
                    time_ok = (days_s1 >= cfg['s2_d'])
                    if cond == 'lower_low':
                        s2_ok = time_ok and (price < step1_price)
                    elif cond == 'dd10_thresh':
                        s2_ok = time_ok and (d10 <= -0.18)
                    elif cond == 'below_step1':
                        s2_ok = time_ok and (price < step1_price)

                if s2_ok and shares > 0.001:
                    ss = min(step1_shares * STEP_PCT[1], shares)
                    if ss > 0.001:
                        cash += ss * price; shares -= ss
                        step2_price = price
                        step2_day   = t
                        min_s2      = price
                        step_count  = 2
                        tlog.append((dates[t], "STEP2_20", price, ss, cash))

            # --- Step3 trigger ---
            if step_count == 2:
                s3_ok = False
                if grp == 'A':
                    s3_ok = (days_s1 >= cfg['s3_d'])
                elif grp == 'B':
                    s3_ok = (price <= step2_price * (1.0 + cfg['s3_p']))
                elif grp == 'C':
                    cond    = cfg['s3_c']
                    time_ok = (days_s2 >= cfg['s3_d'])
                    if cond == 'new_low':
                        s3_ok = time_ok and (price < min_s2)
                    elif cond == 'vol_or_dd':
                        s3_ok = time_ok and (
                            rvol >= vol_80 or price <= step2_price * 0.95)

                if s3_ok and shares > 0.001:
                    ss = min(step1_shares * STEP_PCT[2], shares)
                    if ss > 0.001:
                        cash += ss * price; shares -= ss
                        step_count = 3
                        tlog.append((dates[t], "STEP3_15", price, ss, cash))

            # --- Vmin re-entry ladder ---
            for i, (thr, pct) in enumerate(VMIN_LADDER):
                if not ladder_done[i] and dd_ath <= thr and cash > 1.0:
                    pv = shares * price + cash
                    bv = min(pv * pct, cash)
                    if bv > 1.0:
                        ns = bv / price; shares += ns; cash -= bv
                        tlog.append((dates[t], f"VMIN_{int(abs(thr)*100)}",
                                     price, ns, cash))
                    ladder_done[i] = True

            # --- Full re-entry at MA200 ---
            if price > ma200 and cash > 0.5:
                ns = cash / price; shares += ns
                tlog.append((dates[t], "MA200_REENTRY", price, ns, 0.0))
                cash = 0.0
                step_count  = 0
                step1_shares = 0.0; step1_price = 0.0; step2_price = 0.0
                step1_day   = -1; step2_day = -1
                min_s1      = 1e9; min_s2 = 1e9
                ladder_done = [False, False, False]

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    years   = T / 252
    cagr    = (equity[-1] / equity[0]) ** (1/years) - 1
    peak    = np.maximum.accumulate(equity)
    dd_s    = (equity - peak) / peak
    max_dd  = float(dd_s.min())
    rets    = np.diff(equity) / equity[:-1]
    sharpe  = rets.mean() / rets.std() * np.sqrt(252) if rets.std() > 0 else 0.0
    in_dd   = dd_s < -0.01
    recov_d = int(np.where(in_dd)[0][-1] - np.where(in_dd)[0][0]) if in_dd.any() else 0

    return {
        'equity'  : equity, 'cash': cash_arr, 'tlog': tlog,
        'final'   : float(equity[-1]),
        'cagr'    : cagr,   'max_dd': max_dd, 'sharpe': sharpe, 'recov_d': recov_d,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# DEFENSE TIMING STATISTICS
# ═══════════════════════════════════════════════════════════════════════════════
def analyze_defense_timing(tlog: list, data: pd.DataFrame,
                           crash_sig: np.ndarray) -> dict:
    """
    각 crash 이벤트에서 step이 몇 개 실행됐는지, 각 step의 DD, 간격 분석.
    Whipsaw: Step1 발생 후 Step2 미발생 (가격 회복으로 인한 미실행) 횟수.
    """
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values

    # crash 이벤트별로 Step1 기준으로 묶기
    events = []
    current_ev = None

    for dt_v, tag, pr, sh, ca in tlog:
        sig_d = pd.Timestamp(dt_v)
        if tag == 'STEP1_25':
            if current_ev:
                events.append(current_ev)
            current_ev = {
                'step1_date': sig_d, 'step1_price': pr,
                'step2': None, 'step3': None, 'reentry': None,
            }
        elif current_ev is not None:
            if tag == 'STEP2_20':
                current_ev['step2'] = {'date': sig_d, 'price': pr}
            elif tag == 'STEP3_15':
                current_ev['step3'] = {'date': sig_d, 'price': pr}
            elif tag in ('MA200_REENTRY', 'VMIN_40', 'VMIN_50', 'VMIN_60'):
                if current_ev['reentry'] is None:
                    current_ev['reentry'] = {'date': sig_d, 'price': pr, 'tag': tag}
    if current_ev:
        events.append(current_ev)

    total_step1 = len(events)
    step2_fired = sum(1 for e in events if e['step2'] is not None)
    step3_fired = sum(1 for e in events if e['step3'] is not None)

    # Whipsaw: Step1 fired, Step2 NOT fired, price recovered above Step1 before reentry
    whipsaws = 0
    for e in events:
        if e['step2'] is None:
            # check if price recovered above step1_price
            s1_i = np.searchsorted(dates, e['step1_date'])
            re_i = len(dates) - 1
            if e['reentry']:
                re_i = np.searchsorted(dates, e['reentry']['date'])
            # look for price > step1_price between s1_i and re_i
            window = prices[s1_i:re_i+1]
            if (window > e['step1_price']).any():
                whipsaws += 1

    # Average DD at each step (crash episodes only)
    step1_dds = []
    step2_dds = []
    step3_dds = []

    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        ep_dt_s = pd.Timestamp(ep_s)
        ep_dt_e = pd.Timestamp(ep_e)
        ep_mask = (dates >= ep_s) & (dates <= ep_e)
        ep_prices = prices[ep_mask]
        if len(ep_prices) == 0: continue
        ep_peak = ep_prices.max()

        for e in events:
            if ep_dt_s <= e['step1_date'] <= ep_dt_e:
                s1_dd = (e['step1_price'] / ep_peak) - 1.0
                step1_dds.append(s1_dd)
                if e['step2']:
                    s2_dd = (e['step2']['price'] / ep_peak) - 1.0
                    step2_dds.append(s2_dd)
                if e['step3']:
                    s3_dd = (e['step3']['price'] / ep_peak) - 1.0
                    step3_dds.append(s3_dd)

    return {
        'total_step1'   : total_step1,
        'step2_fired'   : step2_fired,
        'step3_fired'   : step3_fired,
        'step2_rate'    : step2_fired / total_step1 if total_step1 > 0 else 0,
        'step3_rate'    : step3_fired / total_step1 if total_step1 > 0 else 0,
        'whipsaws'      : whipsaws,
        'whipsaw_rate'  : whipsaws / total_step1 if total_step1 > 0 else 0,
        'avg_dd_step1'  : np.mean(step1_dds)  if step1_dds  else None,
        'avg_dd_step2'  : np.mean(step2_dds)  if step2_dds  else None,
        'avg_dd_step3'  : np.mean(step3_dds)  if step3_dds  else None,
        'events'        : events,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# EPISODE METRICS
# ═══════════════════════════════════════════════════════════════════════════════
def compute_episode_metrics(results: dict, data: pd.DataFrame) -> dict:
    dates  = pd.to_datetime(data['date'].values)
    ep_out = {}
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        mask = (dates >= ep_s) & (dates <= ep_e)
        idxs = np.where(mask)[0]
        if len(idxs) == 0: ep_out[ep_name] = {}; continue

        ep_metrics = {}
        for strat, res in results.items():
            eq    = res['equity']
            cash  = res['cash']
            ep_eq = eq[idxs]
            peak  = np.maximum.accumulate(ep_eq)
            dd_ep = (ep_eq - peak) / peak
            max_dd   = float(dd_ep.min())
            trough_i = int(np.argmin(ep_eq))

            recov_d = None
            if max_dd < -0.01:
                pre_peak = ep_eq[:trough_i + 1].max()
                for k in range(trough_i + 1, len(ep_eq)):
                    if ep_eq[k] >= pre_peak:
                        recov_d = int(idxs[k] - idxs[trough_i]); break

            ep_ret = float((ep_eq[-1] / ep_eq[0]) - 1.0)
            trough_cash = float(cash[idxs[trough_i]])
            trough_eq_v = float(eq[idxs[trough_i]])
            cash_pct    = trough_cash / trough_eq_v if trough_eq_v > 0 else 0.0

            ep_metrics[strat] = {
                'max_dd'  : max_dd,
                'ep_ret'  : ep_ret,
                'recov_d' : recov_d,
                'cash_pct': cash_pct,
            }
        ep_out[ep_name] = ep_metrics
    return ep_out


def _add_metrics(res: dict, T: int) -> dict:
    eq = res['equity']
    years = T / 252
    res['cagr']   = (eq[-1] / eq[0]) ** (1/years) - 1
    peak          = np.maximum.accumulate(eq)
    dd_s          = (eq - peak) / peak
    res['max_dd'] = float(dd_s.min())
    rets          = np.diff(eq) / eq[:-1]
    res['sharpe'] = rets.mean() / rets.std() * np.sqrt(252) if rets.std() > 0 else 0.0
    in_dd         = dd_s < -0.01
    res['recov_d'] = int(np.where(in_dd)[0][-1] - np.where(in_dd)[0][0]) if in_dd.any() else 0
    res['final']  = float(eq[-1])
    if 'tlog' not in res: res['tlog'] = []
    return res


# ═══════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═══════════════════════════════════════════════════════════════════════════════
def make_charts(data, results, det_stats, crash_sig, ep_metrics, out_dir):
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values

    _chart_equity(dates, results, out_dir)
    _chart_drawdown(dates, results, out_dir)
    _chart_ep_comparison(ep_metrics, results, out_dir)
    _chart_step_timing(data, results, crash_sig, dates, prices, out_dir)
    _chart_covid_execution(data, results, crash_sig, dates, prices, out_dir)


def _ep_shade(ax, dates, crash_only=True):
    ep_src = CRASH_EPISODES if crash_only else ALL_EPISODES
    for ep, (s, e) in ep_src.items():
        m = (dates >= s) & (dates <= e)
        if m.any():
            ax.axvspan(dates[m][0], dates[m][-1], alpha=0.15, color='#ffddaa', zorder=0)


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(3, 1, figsize=(15, 14), sharex=True)

    groups = [('A', ['A1','A2','A3','A4']),
              ('B', ['B1','B2','B3']),
              ('C', ['C1','C2','C3'])]

    for ax, (grp_name, grp_keys) in zip(axes, groups):
        # baselines
        ax.semilogy(dates, results['ma200']['equity'],
                    color=COLORS['ma200'], lw=1.0, ls=':', label='MA200', alpha=0.6)
        ax.semilogy(dates, results['adapt_b']['equity'],
                    color=COLORS['adapt_b'], lw=1.2, ls='--', label='Adapt-B', alpha=0.7)
        for k in grp_keys:
            ax.semilogy(dates, results[k]['equity'],
                        color=COLORS[k], lw=1.2, label=LABELS[k])
        _ep_shade(ax, dates)
        ax.set_title(f"Group {grp_name} — Equity Curves")
        ax.set_ylabel("Portfolio ($, log)")
        ax.legend(fontsize=8, loc='upper left', ncol=2)
        ax.grid(True, alpha=0.2)

    fig.suptitle("WO23 — Defense Ladder: Equity Curves by Group", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "equity_wo23.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    equity_wo23.png")


def _chart_drawdown(dates, results, out_dir):
    fig, axes = plt.subplots(3, 1, figsize=(15, 12), sharex=True)
    groups = [('A', ['A1','A2','A3','A4']),
              ('B', ['B1','B2','B3']),
              ('C', ['C1','C2','C3'])]

    for ax, (grp_name, grp_keys) in zip(axes, groups):
        for k in ['ma200', 'adapt_b']:
            eq = results[k]['equity']
            dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
            ax.plot(dates, dd, color=COLORS[k], lw=0.9, ls='--',
                    label=LABELS[k], alpha=0.6)
        for k in grp_keys:
            eq = results[k]['equity']
            dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
            ax.plot(dates, dd, color=COLORS[k], lw=1.1, label=LABELS[k])
        ax.axhline(0, color='k', lw=0.4)
        _ep_shade(ax, dates)
        ax.set_title(f"Group {grp_name} — Drawdown")
        ax.set_ylabel("DD (%)")
        ax.legend(fontsize=8, loc='lower left', ncol=2)
        ax.grid(True, alpha=0.2)

    fig.suptitle("WO23 — Drawdown by Group", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "drawdown_wo23.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    drawdown_wo23.png")


def _chart_ep_comparison(ep_metrics, results, out_dir):
    """에피소드별 MaxDD 비교 (crash episodes만)"""
    ep_names   = list(CRASH_EPISODES.keys())
    strat_keys = list(results.keys())
    n_ep       = len(ep_names)
    n_st       = len(strat_keys)

    matrix = np.full((n_st, n_ep), np.nan)
    for j, ep in enumerate(ep_names):
        for i, k in enumerate(strat_keys):
            m = ep_metrics.get(ep, {}).get(k)
            if m: matrix[i, j] = m['max_dd'] * 100

    fig, ax = plt.subplots(figsize=(14, 7))
    im = ax.imshow(matrix, cmap='RdYlGn', vmin=-60, vmax=0, aspect='auto')
    plt.colorbar(im, ax=ax, label='Max DD (%)')

    ax.set_xticks(range(n_ep))
    ax.set_xticklabels([e[:14] for e in ep_names], rotation=25, ha='right', fontsize=9)
    ax.set_yticks(range(n_st))
    ax.set_yticklabels([LABELS.get(k, k) for k in strat_keys], fontsize=9)
    ax.set_title("WO23 — Crash Episode Max DD Heatmap (Green=Better)")

    for i in range(n_st):
        for j in range(n_ep):
            v = matrix[i, j]
            if not np.isnan(v):
                ax.text(j, i, f'{v:.0f}', ha='center', va='center',
                        fontsize=7, color='black')

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "ep_heatmap_wo23.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    ep_heatmap_wo23.png")


def _chart_step_timing(data, results, crash_sig, dates, prices, out_dir):
    """2020 COVID에서 각 그룹의 Step 실행 시점 비교"""
    ep_s, ep_e = "2020-02-01", "2020-12-31"
    mask = (dates >= ep_s) & (dates <= ep_e)
    ep_d = dates[mask]
    ep_p = prices[mask]

    fig, axes = plt.subplots(3, 1, figsize=(14, 12), sharex=True)
    groups = [('A', ['A1','A2','A3','A4']),
              ('B', ['B1','B2','B3']),
              ('C', ['C1','C2','C3'])]

    for ax, (grp_name, grp_keys) in zip(axes, groups):
        ax.plot(ep_d, ep_p, color='#333', lw=1.5, label='TQQQ', zorder=5)

        step_tags = {'STEP1_25': ('v', 14, '#ff4400'),
                     'STEP2_20': ('v', 11, '#ff8800'),
                     'STEP3_15': ('v', 9,  '#ffcc00'),
                     'MA200_REENTRY': ('^', 11, '#00aa44'),
                     'VMIN_40': ('^', 9, '#44ccaa'),
                     'VMIN_50': ('^', 9, '#44ccaa'),
                     'VMIN_60': ('^', 9, '#44ccaa')}

        # Show only first variant in group for clarity
        k = grp_keys[0]
        res = results[k]
        for dt_v, tag, pr, sh, ca in res['tlog']:
            sd = pd.Timestamp(dt_v)
            if pd.Timestamp(ep_s) <= sd <= pd.Timestamp(ep_e):
                if tag in step_tags:
                    m_sym, m_sz, m_col = step_tags[tag]
                    ax.plot(sd, pr, marker=m_sym, color=m_col,
                            markersize=m_sz, zorder=10, label=tag)

        ax.set_title(f"2020 COVID — Group {grp_name} Step Execution ({grp_keys[0]})")
        ax.set_ylabel("Price ($)")
        # deduplicate legend
        handles, lbls = ax.get_legend_handles_labels()
        seen = {}
        for h, l in zip(handles, lbls):
            if l not in seen: seen[l] = h
        ax.legend(seen.values(), seen.keys(), fontsize=8, loc='upper right')
        ax.grid(True, alpha=0.2)

    fig.suptitle("WO23 — 2020 COVID: Defense Step Execution Timing", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "step_timing_wo23.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    step_timing_wo23.png")


def _chart_covid_execution(data, results, crash_sig, dates, prices, out_dir):
    """2020 COVID: 전략별 현금 비율 비교 (Sell timing vs crash progression)"""
    ep_s, ep_e = "2020-02-01", "2020-12-31"
    mask = (dates >= ep_s) & (dates <= ep_e)
    ep_d = dates[mask]

    fig, axes = plt.subplots(4, 1, figsize=(13, 14), sharex=True)

    # Panel 1: Price
    ax = axes[0]
    ax.plot(ep_d, prices[mask], color='#333', lw=1.5)
    ax.set_title("TQQQ Price — 2020 COVID")
    ax.set_ylabel("Price ($)")
    ax.grid(True, alpha=0.2)

    # Panels 2-4: Cash % for each group
    groups = [('A', ['A1','A2','A3','A4']),
              ('B', ['B1','B2','B3']),
              ('C', ['C1','C2','C3'])]

    for ax, (grp_name, grp_keys) in zip(axes[1:], groups):
        for k in grp_keys:
            eq   = results[k]['equity'][mask]
            cash = results[k]['cash'][mask]
            pct  = np.where(eq > 0, cash / eq * 100, 0)
            ax.plot(ep_d, pct, color=COLORS[k], lw=1.3, label=LABELS[k])
        ax.set_title(f"Cash % — Group {grp_name}")
        ax.set_ylabel("Cash %")
        ax.set_ylim(0, 85)
        ax.legend(fontsize=8, loc='upper right', ncol=2)
        ax.grid(True, alpha=0.2)

    fig.suptitle("WO23 — 2020 COVID: Sell Timing vs Crash Progression", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "covid_timing_wo23.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    covid_timing_wo23.png")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    dirname = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
    OUT_DIR = (f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
               r'\vr_backtest\results\charts')
    os.makedirs(OUT_DIR, exist_ok=True)

    print("=" * 72)
    print("  WO23 -- Defense Ladder Timing Optimization")
    print("  25%-20%-15% ladder 최적 실행 타이밍 결정")
    print("=" * 72)

    # [1] 데이터
    print("\n[1] TQQQ 데이터 로드 ...")
    data   = load_tqqq()
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values
    T      = len(dates)
    print(f"    {T}개 거래일  ({dates[0].date()} → {dates[-1].date()})")

    # [2] Detector
    print("\n[2] Detector 계산 ...")
    crash_sig, dd5_arr, dd10_arr = compute_ddvel(data, dd5_thr=-0.12, dd10_thr=-0.18)
    rvol10, vol_80               = compute_rvol(data)

    total = crash_sig.sum()
    print(f"    DDVel 신호: {total}일 ({total/T*100:.1f}%)  "
          f"[dd5<=-12% OR dd10<=-18%]")
    print(f"    rvol 80th pct: {vol_80*100:.0f}%  (C2 Step3 조건)")
    print()
    print("    에피소드별 신호:")
    for ep, (s, e) in ALL_EPISODES.items():
        m  = (dates >= s) & (dates <= e)
        sd = crash_sig[m].sum()
        star = " ← SRS 영역" if ep == "2022 Fed Bear" else ""
        print(f"      {ep:<22}: {sd:>3}일 ({sd/m.sum()*100:.1f}%){star}")

    # [3] 전략 실행
    print("\n[3] 전략 백테스트 실행 ...")
    print("    MA200 ...")
    res_ma200 = _add_metrics(run_ma200_strategy(data), T)
    print("    Adapt-B ...")
    res_adapt = _add_metrics(run_adaptive_ma(data), T)

    results = {'ma200': res_ma200, 'adapt_b': res_adapt}
    for vk, cfg in VARIANTS.items():
        print(f"    {LABELS[vk]} ...")
        results[vk] = run_ladder_strategy(
            data, crash_sig, dd10_arr, rvol10, vol_80, cfg)

    # [4] 전체 성과
    print("\n[4] 전체 성과 지표 (2011-2026)")
    print("-" * 74)
    print(f"  {'전략':<26} {'최종자산':>12} {'CAGR':>7} {'MaxDD':>7} {'Sharpe':>7}")
    print("-" * 74)
    for k, res in results.items():
        lbl = LABELS.get(k, k)
        print(f"  {lbl:<26} ${res['final']:>11,.0f}"
              f"  {res['cagr']*100:>5.1f}%"
              f"  {res['max_dd']*100:>5.1f}%"
              f"  {res['sharpe']:>5.3f}")
    print("-" * 74)

    # Group 평균
    print("\n  [그룹 평균]")
    for grp_name, grp_keys in [('A', ['A1','A2','A3','A4']),
                                 ('B', ['B1','B2','B3']),
                                 ('C', ['C1','C2','C3'])]:
        avg_cagr  = np.mean([results[k]['cagr']   * 100 for k in grp_keys])
        avg_dd    = np.mean([results[k]['max_dd']  * 100 for k in grp_keys])
        avg_shp   = np.mean([results[k]['sharpe']        for k in grp_keys])
        print(f"  Group {grp_name}  CAGR avg {avg_cagr:.1f}%  "
              f"MaxDD avg {avg_dd:.1f}%  Sharpe avg {avg_shp:.3f}")

    # [5] Defense Timing 통계
    print("\n[5] Defense Timing 통계")
    print()
    print(f"  {'전략':<26} {'S1발생':>6} {'S2율':>6} {'S3율':>6} "
          f"{'Whipsaw율':>10} {'S1 DD':>8} {'S2 DD':>8} {'S3 DD':>8}")
    print("  " + "-" * 80)

    det_stats = {}
    for vk in VARIANTS:
        stat = analyze_defense_timing(results[vk]['tlog'], data, crash_sig)
        det_stats[vk] = stat
        s1   = stat['total_step1']
        s2r  = stat['step2_rate']  * 100
        s3r  = stat['step3_rate']  * 100
        wsr  = stat['whipsaw_rate']* 100
        d1   = f"{stat['avg_dd_step1']*100:+.1f}%" if stat['avg_dd_step1'] else "n/a"
        d2   = f"{stat['avg_dd_step2']*100:+.1f}%" if stat['avg_dd_step2'] else "n/a"
        d3   = f"{stat['avg_dd_step3']*100:+.1f}%" if stat['avg_dd_step3'] else "n/a"
        print(f"  {LABELS[vk]:<26} {s1:>5}  {s2r:>5.0f}%  {s3r:>5.0f}%"
              f"  {wsr:>8.0f}%  {d1:>8}  {d2:>8}  {d3:>8}")

    # [6] 에피소드별 MaxDD 비교
    print("\n[6] Crash 에피소드별 MaxDD 비교")
    ep_metrics = compute_episode_metrics(results, data)
    strat_keys = list(results.keys())

    for ep_name, ep_data in ep_metrics.items():
        if not ep_data: continue
        s, e = CRASH_EPISODES[ep_name]
        print(f"\n  [{ep_name}]  {s}~{e}")
        print(f"  {'지표':<12}", end="")
        for k in strat_keys:
            print(f"  {LABELS.get(k,k)[:12]:>12}", end="")
        print()
        print("  " + "-" * (12 + 14 * len(strat_keys)))

        for metric, fn in [
            ("MaxDD",       lambda m: f"{m['max_dd']*100:+.1f}%"),
            ("에피소드Ret", lambda m: f"{m['ep_ret']*100:+.1f}%"),
            ("회복(d)",    lambda m: (f"{m['recov_d']}d" if m['recov_d'] else "n/a")),
            ("현금@저점",   lambda m: f"{m['cash_pct']*100:.0f}%"),
        ]:
            print(f"  {metric:<12}", end="")
            for k in strat_keys:
                m   = ep_data.get(k, {})
                try:
                    val = fn(m) if m else "n/a"
                except:
                    val = "n/a"
                print(f"  {val:>12}", end="")
            print()

    # [7] 그룹별 2020 COVID 성과 (핵심 에피소드)
    print("\n[7] 2020 COVID 핵심 비교 (MaxDD / 에피소드수익 / Sharpe)")
    print()
    covid_ep = "2020 COVID"
    print(f"  {'전략':<26} {'MaxDD':>8} {'에피소드수익':>12} {'Sharpe':>8}")
    print("  " + "-" * 58)
    for k, res in results.items():
        em = ep_metrics.get(covid_ep, {}).get(k, {})
        if em:
            print(f"  {LABELS.get(k,k):<26}"
                  f"  {em['max_dd']*100:>6.1f}%"
                  f"  {em['ep_ret']*100:>10.1f}%"
                  f"  {res['sharpe']:>7.3f}")

    # [8] 결론
    print("\n[8] 연구 결론")
    print("-" * 72)

    # Best Sharpe among variants
    var_keys = list(VARIANTS.keys())
    best_sharpe = max(var_keys, key=lambda k: results[k]['sharpe'])
    best_cagr   = max(var_keys, key=lambda k: results[k]['cagr'])
    best_dd     = min(var_keys, key=lambda k: results[k]['max_dd'])
    best_covid  = max(var_keys,
                      key=lambda k: (ep_metrics.get(covid_ep,{}).get(k,{}).get('ep_ret',
                                                                               -999)))

    # Group averages for conclusion
    grp_avg = {}
    for grp_name, grp_keys in [('A', ['A1','A2','A3','A4']),
                                 ('B', ['B1','B2','B3']),
                                 ('C', ['C1','C2','C3'])]:
        grp_avg[grp_name] = {
            'sharpe': np.mean([results[k]['sharpe'] for k in grp_keys]),
            'cagr'  : np.mean([results[k]['cagr']   for k in grp_keys]),
            'max_dd': np.mean([results[k]['max_dd']  for k in grp_keys]),
        }
    best_grp = max(grp_avg, key=lambda g: grp_avg[g]['sharpe'])

    print(f"""
  ■ Q1. 2차/3차 방어: 시간 기반 vs 가격 기반 vs 혼합형?
    - Group A (시간) Sharpe avg:  {grp_avg['A']['sharpe']:.3f}
    - Group B (가격) Sharpe avg:  {grp_avg['B']['sharpe']:.3f}
    - Group C (혼합) Sharpe avg:  {grp_avg['C']['sharpe']:.3f}
    - 우수 그룹: Group {best_grp} (Sharpe {grp_avg[best_grp]['sharpe']:.3f})

  ■ Q2. 3일/5일 규칙이 유효한가?
    - A1(+3,+5): CAGR {results['A1']['cagr']*100:.1f}%, Sharpe {results['A1']['sharpe']:.3f}
    - A3(+3,+6): CAGR {results['A3']['cagr']*100:.1f}%, Sharpe {results['A3']['sharpe']:.3f}
    - A4(+5,+10): CAGR {results['A4']['cagr']*100:.1f}%, Sharpe {results['A4']['sharpe']:.3f}

  ■ Q3. 추가 하락 조건이 필요한가? (Hybrid C 그룹 효과)
    - C1 Whipsaw율: {det_stats['C1']['whipsaw_rate']*100:.0f}%  vs  A1 Whipsaw율: {det_stats['A1']['whipsaw_rate']*100:.0f}%
    - C2 Step2/3 완료율: {det_stats['C2']['step2_rate']*100:.0f}%/{det_stats['C2']['step3_rate']*100:.0f}%

  ■ Q4. 25-20-15 ladder 최적 실행 타이밍?
    - Sharpe 최고:    {LABELS[best_sharpe]} (Sharpe {results[best_sharpe]['sharpe']:.3f})
    - CAGR 최고:      {LABELS[best_cagr]}   (CAGR {results[best_cagr]['cagr']*100:.1f}%)
    - MaxDD 최소:     {LABELS[best_dd]}     (DD {results[best_dd]['max_dd']*100:.1f}%)
    - 2020 COVID 수익 최고: {LABELS[best_covid]}

  ■ Q5. VR crash engine 최적 defense schedule?
    - Sharpe 기준: {LABELS[best_sharpe]}
    - Adapt-B 대비 CAGR:   {(results[best_cagr]['cagr'] - results['adapt_b']['cagr'])*100:+.1f}%p
    - Adapt-B 대비 Sharpe: {results[best_sharpe]['sharpe'] - results['adapt_b']['sharpe']:+.3f}
""")

    # [9] 차트
    print("[9] 차트 생성 중 ...")
    make_charts(data, results, det_stats, crash_sig, ep_metrics, OUT_DIR)
    print(f"    저장 위치: {OUT_DIR}")

    print("\n[10] 완료")
    print("=" * 72)


if __name__ == "__main__":
    main()
