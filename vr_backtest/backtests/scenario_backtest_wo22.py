"""
vr_backtest/backtests/scenario_backtest_wo22.py
================================================
WO22 -- Crash Action Mapping Research

연구 질문:
  Crash detector가 울렸을 때 언제, 얼마나, 어떻게 탈출/재진입할 것인가?

4 Exit Rules (Primary: DDVel detector):
  A  Early Defense  : 신호 → 25% 즉시 + DD20% → 추가 25%
  B  Half Exit      : 신호 → 50% 즉시
  C  Staged Exit    : 신호 → 25% / DD15% → +25% / DD25% → +25%
  D  Hybrid Confirm : DDVel 신호 후 VolReg 확인 시 → 50%

2 Re-entry Rules:
  R1  Vmin Ladder   : -40%/-50%/-60% ladder buy + MA200 재진입
  R2  Vol Recovery  : rvol 정상화 + 5일 상승 모멘텀 → 전량 재진입

비교: 8 variants + MA200 + Adapt-B (총 10개 전략)

주의: 2008 GFC는 TQQQ 데이터(2011년 시작) 없어 분석 제외.
      Normal mode: Buy-and-Hold (VR은 Crash velocity에만 개입)
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

# ── 에피소드 ───────────────────────────────────────────────────────────────────
EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2022 Fed Bear"     : ("2021-11-01", "2023-06-30"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}
CRASH_EPISODES = {"2011 Debt Ceiling", "2018 Q4 Selloff", "2020 COVID"}
BEAR_EPISODES  = {"2022 Fed Bear"}
CORR_EPISODES  = {"2015 China Shock", "2018 Vol Spike", "2025 Correction"}

POST_6M_DAYS    = 126
INITIAL_CASH    = 10_000.0
MONTHLY_CONTRIB = 250.0

VARIANTS = {
    'A_R1': ('A', 'R1'),  'A_R2': ('A', 'R2'),
    'B_R1': ('B', 'R1'),  'B_R2': ('B', 'R2'),
    'C_R1': ('C', 'R1'),  'C_R2': ('C', 'R2'),
    'D_R1': ('D', 'R1'),  'D_R2': ('D', 'R2'),
}

LABELS = {
    'ma200'  : 'MA200',
    'adapt_b': 'Adapt-B',
    'A_R1'   : 'A(조기25%)+Ladder',
    'A_R2'   : 'A(조기25%)+VolExit',
    'B_R1'   : 'B(50%즉시)+Ladder',
    'B_R2'   : 'B(50%즉시)+VolExit',
    'C_R1'   : 'C(단계적)+Ladder',
    'C_R2'   : 'C(단계적)+VolExit',
    'D_R1'   : 'D(이중확인)+Ladder',
    'D_R2'   : 'D(이중확인)+VolExit',
}

COLORS = {
    'ma200'  : '#2255cc',
    'adapt_b': '#cc4400',
    'A_R1'   : '#9933ff',  'A_R2': '#cc66ff',
    'B_R1'   : '#ff3344',  'B_R2': '#ff9966',
    'C_R1'   : '#00aa44',  'C_R2': '#66cc88',
    'D_R1'   : '#0099cc',  'D_R2': '#66ccee',
}

# Adapt-B 파라미터 (addmetrics용)
NEAR_THR = 0.15; MED_THR = 0.30
LADDER_THRS = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]


# ═══════════════════════════════════════════════════════════════════════════════
# DETECTORS
# ═══════════════════════════════════════════════════════════════════════════════
def compute_ddvel(data: pd.DataFrame,
                  dd5_thr: float = -0.10,
                  dd10_thr: float = -0.18) -> tuple:
    prices = data['close'].values
    T      = len(prices)
    dd5    = np.zeros(T)
    dd10   = np.zeros(T)
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    return (dd5 <= dd5_thr) | (dd10 <= dd10_thr), dd5, dd10


def compute_volreg(data: pd.DataFrame,
                   vol_hi_pct: float = 0.80,
                   dd_thr     : float = -0.07) -> tuple:
    prices = data['close'].values
    T      = len(prices)
    rets   = np.zeros(T)
    for t in range(1, T): rets[t] = np.log(prices[t] / prices[t-1])
    rvol10 = np.zeros(T)
    for t in range(10, T): rvol10[t] = np.std(rets[t-9:t+1]) * np.sqrt(252)
    vol_80 = float(np.percentile(rvol10[10:], vol_hi_pct * 100))
    vol_50 = float(np.percentile(rvol10[10:], 50))
    rhi10  = pd.Series(prices).rolling(10, min_periods=1).max().values
    dd10r  = (prices / rhi10) - 1.0
    sig    = (rvol10 >= vol_80) & (dd10r <= dd_thr)
    return sig, rvol10, vol_80, vol_50


# ═══════════════════════════════════════════════════════════════════════════════
# CRASH ACTION STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
def run_crash_action(data          : pd.DataFrame,
                     crash_sig     : np.ndarray,
                     vol_sig       : np.ndarray,
                     rvol10        : np.ndarray,
                     vol_50        : float,
                     exit_mode     : str,
                     reentry_mode  : str,
                     initial_cash  : float = INITIAL_CASH,
                     monthly_contrib: float = MONTHLY_CONTRIB) -> dict:
    """
    Normal mode: Buy-and-Hold with monthly DCA
    Crash mode : exit according to exit_mode; re-enter according to reentry_mode

    exit_mode:
      'A' → 25% on signal + 25% at DD20% from crash high
      'B' → 50% on signal (single shot)
      'C' → 25% on signal + 25% at DD15% + 25% at DD25%
      'D' → wait for VolReg confirmation, then 50%
    reentry_mode:
      'R1' → -40/-50/-60% ladder buys + full re-entry at MA200 cross
      'R2' → re-enter when rvol < median AND 5d return > 0
    """
    dates   = data['date'].values
    prices  = data['close'].values
    ma200_a = data['ma200'].values
    dd_arr  = data['drawdown'].values   # all-time-high drawdown (for ladder)
    T       = len(dates)

    equity   = np.zeros(T)
    cash_arr = np.zeros(T)
    tlog     = []

    shares  = initial_cash / prices[0]
    cash    = 0.0

    in_crash    = False
    crash_high  = 1.0
    exit_done   = [False, False, False]
    ladder_done = [False, False, False]

    # Pre-compute 5d return for R2 momentum condition
    r5 = np.zeros(T)
    for t in range(5, T): r5[t] = prices[t] / prices[t-5] - 1.0

    tlog.append((dates[0], "BUY_INIT", prices[0], shares, 0.0))
    equity[0]   = shares * prices[0]
    cash_arr[0] = 0.0
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price  = prices[t]
        ma200  = ma200_a[t]
        dd     = dd_arr[t]
        crash  = bool(crash_sig[t])
        volreg = bool(vol_sig[t])
        rvol   = rvol10[t]
        ret5   = r5[t]

        curr_month = pd.Timestamp(dates[t]).month
        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        dd_ch = (price / crash_high) - 1.0 if in_crash else 0.0

        if not in_crash:
            # Normal mode: invest accumulated cash immediately
            if cash > 0.5:
                ns = cash / price; shares += ns; cash = 0.0
                tlog.append((dates[t], "DCA", price, ns, 0.0))

            # Detect crash signal
            if crash and shares > 0.01:
                in_crash    = True
                crash_high  = price
                exit_done   = [False, False, False]
                ladder_done = [False, False, False]
                tlog.append((dates[t], "CRASH_DETECT", price, 0.0, cash))

                # Immediate exit (A, B, C) or deferred (D)
                if exit_mode == 'A':
                    ss = shares * 0.25
                    cash += ss * price; shares -= ss; exit_done[0] = True
                    tlog.append((dates[t], "EXIT_A1_25", price, ss, cash))
                elif exit_mode == 'B':
                    ss = shares * 0.50
                    cash += ss * price; shares -= ss; exit_done[0] = True
                    tlog.append((dates[t], "EXIT_B_50", price, ss, cash))
                elif exit_mode == 'C':
                    ss = shares * 0.25
                    cash += ss * price; shares -= ss; exit_done[0] = True
                    tlog.append((dates[t], "EXIT_C1_25", price, ss, cash))
                # D: no immediate exit — wait for VolReg

        else:
            # In crash mode — staged exits
            if exit_mode == 'A':
                if exit_done[0] and not exit_done[1] and dd_ch <= -0.20:
                    ss = shares * 0.25
                    cash += ss * price; shares -= ss; exit_done[1] = True
                    tlog.append((dates[t], "EXIT_A2_25_DD20", price, ss, cash))

            elif exit_mode == 'C':
                if exit_done[0] and not exit_done[1] and dd_ch <= -0.15:
                    ss = shares * 0.25
                    cash += ss * price; shares -= ss; exit_done[1] = True
                    tlog.append((dates[t], "EXIT_C2_25_DD15", price, ss, cash))
                if exit_done[1] and not exit_done[2] and dd_ch <= -0.25:
                    ss = shares * 0.25
                    cash += ss * price; shares -= ss; exit_done[2] = True
                    tlog.append((dates[t], "EXIT_C3_25_DD25", price, ss, cash))

            elif exit_mode == 'D' and not exit_done[0] and volreg:
                ss = shares * 0.50
                cash += ss * price; shares -= ss; exit_done[0] = True
                tlog.append((dates[t], "EXIT_D_50_CONF", price, ss, cash))

            # Re-entry
            if reentry_mode == 'R1':
                for i, (thr, pct) in enumerate(LADDER_THRS):
                    if not ladder_done[i] and dd <= thr and cash > 1.0:
                        pv = shares * price + cash
                        bv = min(pv * pct, cash)
                        if bv > 1.0:
                            ns = bv / price; shares += ns; cash -= bv
                            tlog.append((dates[t], f"LADDER_{int(abs(thr)*100)}",
                                         price, ns, cash))
                        ladder_done[i] = True
                # Full re-entry at MA200
                if price > ma200 and cash > 0.5:
                    ns = cash / price; shares += ns
                    tlog.append((dates[t], "MA200_REENTRY", price, ns, 0.0))
                    cash = 0.0
                    in_crash = False; exit_done = [False]*3; ladder_done = [False]*3

            elif reentry_mode == 'R2':
                # Vol normalized AND positive 5d momentum → full re-entry
                if rvol < vol_50 and ret5 > 0.0 and cash > 0.5:
                    ns = cash / price; shares += ns
                    tlog.append((dates[t], "VOL_REENTRY", price, ns, 0.0))
                    cash = 0.0
                    in_crash = False; exit_done = [False]*3; ladder_done = [False]*3

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    years   = T / 252
    cagr    = (equity[-1] / equity[0]) ** (1 / years) - 1
    peak    = np.maximum.accumulate(equity)
    dd_s    = (equity - peak) / peak
    max_dd  = dd_s.min()
    rets    = np.diff(equity) / equity[:-1]
    sharpe  = rets.mean() / rets.std() * np.sqrt(252) if rets.std() > 0 else 0.0
    in_dd   = dd_s < -0.01
    recov_d = int(np.where(in_dd)[0][-1] - np.where(in_dd)[0][0]) if in_dd.any() else 0

    return {
        'equity' : equity, 'cash' : cash_arr, 'tlog' : tlog,
        'final'  : float(equity[-1]),
        'cagr'   : cagr, 'max_dd': max_dd, 'sharpe': sharpe, 'recov_d': recov_d,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# EPISODE METRICS
# ═══════════════════════════════════════════════════════════════════════════════
def compute_episode_metrics(results: dict, data: pd.DataFrame) -> dict:
    dates  = pd.to_datetime(data['date'].values)
    ep_out = {}

    for ep_name, (ep_s, ep_e) in EPISODES.items():
        mask  = (dates >= ep_s) & (dates <= ep_e)
        idxs  = np.where(mask)[0]
        if len(idxs) == 0:
            ep_out[ep_name] = {}; continue

        ep_metrics = {}
        for strat, res in results.items():
            eq   = res['equity']
            cash = res['cash']
            ep_eq = eq[idxs]
            peak  = np.maximum.accumulate(ep_eq)
            dd_ep = (ep_eq - peak) / peak
            max_dd   = float(dd_ep.min())
            trough_i = int(np.argmin(ep_eq))
            trough_d = dates[idxs[trough_i]]

            recov_d = None
            if max_dd < -0.01:
                pre_peak = ep_eq[:trough_i + 1].max()
                for k in range(trough_i + 1, len(ep_eq)):
                    if ep_eq[k] >= pre_peak:
                        recov_d = int(idxs[k] - idxs[trough_i]); break

            ep_ret = float((ep_eq[-1] / ep_eq[0]) - 1.0)
            end_i  = idxs[-1]
            post_i = min(end_i + POST_6M_DAYS, len(eq) - 1)
            post_6m = float((eq[post_i] / eq[end_i]) - 1.0) if post_i > end_i else None

            trough_cash = float(cash[idxs[trough_i]])
            trough_eq_v = float(eq[idxs[trough_i]])
            cash_pct = trough_cash / trough_eq_v if trough_eq_v > 0 else 0.0

            # 첫 exit 신호일
            EXIT_TAGS = {'EXIT_A1_25','EXIT_A2_25_DD20','EXIT_B_50','EXIT_C1_25',
                         'EXIT_C2_25_DD15','EXIT_C3_25_DD25','EXIT_D_50_CONF',
                         'NEAR_EXIT','MED_EXIT','FAR_CRASH_SELL','FAR_TREND_SELL',
                         'MA200_EXIT','CRASH_SELL'}
            first_sig = None
            for dt_v, tag, pr, sh, ca in res['tlog']:
                if tag in EXIT_TAGS:
                    sd = pd.Timestamp(dt_v)
                    if pd.Timestamp(ep_s) <= sd <= pd.Timestamp(ep_e):
                        first_sig = sd; break

            ep_metrics[strat] = {
                'max_dd'   : max_dd,
                'trough_d' : trough_d,
                'recov_d'  : recov_d,
                'ep_ret'   : ep_ret,
                'post_6m'  : post_6m,
                'cash_pct' : cash_pct,
                'first_sig': first_sig,
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
def make_charts(data: pd.DataFrame, results: dict,
                crash_sig: np.ndarray, vol_sig: np.ndarray,
                rvol10: np.ndarray, vol_50: float,
                ep_metrics: dict, out_dir: str) -> None:
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values

    _chart_equity_split(dates, results, out_dir)
    _chart_drawdown(dates, results, out_dir)
    _chart_ep_maxdd_heatmap(ep_metrics, results, out_dir)
    _chart_crash_cash(data, results, crash_sig, out_dir)
    _chart_summary_bars(results, out_dir)


def _ep_band(ax, dates):
    clr = {**{k:'#ffdddd' for k in CRASH_EPISODES},
           **{k:'#fff0cc'  for k in BEAR_EPISODES},
           **{k:'#e8ffe8'  for k in CORR_EPISODES}}
    for ep, (s, e) in EPISODES.items():
        m = (dates >= s) & (dates <= e)
        if m.any():
            ax.axvspan(dates[m][0], dates[m][-1], alpha=0.2,
                       color=clr.get(ep,'#eee'), zorder=0)


def _chart_equity_split(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(15, 12), sharex=True)

    for ax, reentry, title in zip(
            axes,
            ['R1', 'R2'],
            ['Re-entry R1 (Vmin Ladder + MA200)', 'Re-entry R2 (Vol Recovery)']):
        ax.semilogy(dates, results['ma200']['equity'],
                    color=COLORS['ma200'], lw=1.2, ls='--', label='MA200', alpha=0.7)
        ax.semilogy(dates, results['adapt_b']['equity'],
                    color=COLORS['adapt_b'], lw=1.5, ls='--', label='Adapt-B', alpha=0.7)
        for em in ['A','B','C','D']:
            k = f'{em}_{reentry}'
            ax.semilogy(dates, results[k]['equity'],
                        color=COLORS[k], lw=1.0, label=LABELS[k])
        _ep_band(ax, dates)
        ax.set_title(title)
        ax.set_ylabel("Portfolio ($, log)")
        ax.legend(fontsize=8, loc='upper left', ncol=2)
        ax.grid(True, alpha=0.25)

    fig.suptitle("WO22 — Equity Curves: Exit A/B/C/D", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "equity_wo22.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    equity_wo22.png")


def _chart_drawdown(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(15, 10), sharex=True)

    for ax, reentry, title in zip(
            axes, ['R1', 'R2'],
            ['Drawdown R1 (Ladder)', 'Drawdown R2 (Vol Recovery)']):
        for k in ['ma200', 'adapt_b']:
            eq   = results[k]['equity']
            peak = np.maximum.accumulate(eq)
            dd   = (eq - peak) / peak * 100
            ax.plot(dates, dd, color=COLORS[k], lw=1.2, ls='--',
                    label=LABELS[k], alpha=0.7)
        for em in ['A','B','C','D']:
            k  = f'{em}_{reentry}'
            eq = results[k]['equity']
            peak = np.maximum.accumulate(eq)
            dd   = (eq - peak) / peak * 100
            ax.plot(dates, dd, color=COLORS[k], lw=1.0, label=LABELS[k])
        ax.axhline(0, color='k', lw=0.5)
        _ep_band(ax, dates)
        ax.set_title(title)
        ax.set_ylabel("Drawdown (%)")
        ax.legend(fontsize=8, loc='lower left', ncol=2)
        ax.grid(True, alpha=0.25)

    fig.suptitle("WO22 — Drawdown Comparison", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "drawdown_wo22.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    drawdown_wo22.png")


def _chart_ep_maxdd_heatmap(ep_metrics, results, out_dir):
    """에피소드 × 전략 Max DD 히트맵"""
    strat_keys = list(results.keys())
    ep_names   = list(EPISODES.keys())
    matrix     = np.full((len(strat_keys), len(ep_names)), np.nan)

    for j, ep in enumerate(ep_names):
        for i, k in enumerate(strat_keys):
            m = ep_metrics.get(ep, {}).get(k)
            if m:
                matrix[i, j] = m['max_dd'] * 100

    fig, ax = plt.subplots(figsize=(14, 7))
    im = ax.imshow(matrix, cmap='RdYlGn', vmin=-60, vmax=0, aspect='auto')
    plt.colorbar(im, ax=ax, label='Max DD (%)')

    ax.set_xticks(range(len(ep_names)))
    ax.set_xticklabels([e[:14] for e in ep_names], rotation=30, ha='right', fontsize=9)
    ax.set_yticks(range(len(strat_keys)))
    ax.set_yticklabels([LABELS.get(k, k) for k in strat_keys], fontsize=9)
    ax.set_title("WO22 — Episode Max DD Heatmap (Green=Better)")

    for i in range(len(strat_keys)):
        for j in range(len(ep_names)):
            v = matrix[i, j]
            if not np.isnan(v):
                ax.text(j, i, f'{v:.0f}%', ha='center', va='center',
                        fontsize=7, color='black')

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "ep_heatmap_wo22.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    ep_heatmap_wo22.png")


def _chart_crash_cash(data, results, crash_sig, out_dir):
    """2020 COVID 에피소드: 전략별 현금 비율 추이"""
    dates  = pd.to_datetime(data['date'].values)
    ep_s, ep_e = "2020-02-01", "2020-12-31"
    mask  = (dates >= ep_s) & (dates <= ep_e)

    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)

    for ax, reentry, title in zip(axes, ['R1','R2'],
                                   ['2020 COVID Cash% — R1 Ladder',
                                    '2020 COVID Cash% — R2 Vol Recovery']):
        for em in ['A','B','C','D']:
            k    = f'{em}_{reentry}'
            res  = results[k]
            eq   = res['equity'][mask]
            cash = res['cash'][mask]
            cash_pct = np.where(eq > 0, cash / eq * 100, 0)
            ax.plot(dates[mask], cash_pct, color=COLORS[k], lw=1.5, label=LABELS[k])

        # Crash signal overlay
        sig_dates = dates[mask & crash_sig]
        for sd in sig_dates[:5]:
            ax.axvline(sd, color='gray', lw=0.6, alpha=0.4)

        ax.set_ylabel("Cash % of Portfolio")
        ax.set_ylim(0, 100)
        ax.set_title(title)
        ax.legend(fontsize=9)
        ax.grid(True, alpha=0.3)

    fig.suptitle("WO22 — 2020 COVID: Cash Level by Strategy", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "covid_cash_wo22.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    covid_cash_wo22.png")


def _chart_summary_bars(results, out_dir):
    """전략별 CAGR / Sharpe / Max DD 3-panel 막대"""
    keys   = list(results.keys())
    lbls   = [LABELS.get(k, k) for k in keys]
    colors = [COLORS.get(k, '#888') for k in keys]

    cagrs  = [results[k]['cagr']    * 100 for k in keys]
    sharps = [results[k]['sharpe']        for k in keys]
    maxdds = [abs(results[k]['max_dd']) * 100 for k in keys]

    fig, axes = plt.subplots(1, 3, figsize=(16, 6))

    for ax, vals, title, unit in zip(
            axes,
            [cagrs, sharps, maxdds],
            ['CAGR', 'Sharpe', 'Max DD'],
            ['%', '', '%']):
        bars = ax.barh(lbls, vals, color=colors, alpha=0.85)
        ax.set_title(title)
        ax.set_xlabel(f'{title} ({unit})' if unit else title)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_width() + 0.05,
                    bar.get_y() + bar.get_height() / 2,
                    f'{v:.2f}{unit}', va='center', fontsize=8)

    fig.suptitle("WO22 — Strategy Summary", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "summary_wo22.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    summary_wo22.png")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    dirname = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
    OUT_DIR = (f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
               r'\vr_backtest\results\charts')
    os.makedirs(OUT_DIR, exist_ok=True)

    print("=" * 72)
    print("  WO22 -- Crash Action Mapping Research")
    print("  Crash Detector → 최적 탈출/재진입 규칙 결정")
    print("=" * 72)

    # [1] 데이터 로드
    print("\n[1] TQQQ 데이터 로드 ...")
    data   = load_tqqq()
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values
    T      = len(dates)
    print(f"    {T}개 거래일  ({dates[0].date()} → {dates[-1].date()})")
    print("    ※ 2008 GFC: TQQQ 데이터 없어 분석 제외")

    # [2] 검출기 계산
    print("\n[2] DDVel + VolReg Detector 계산 ...")
    crash_sig, dd5, dd10 = compute_ddvel(data)
    vol_sig, rvol10, vol_80, vol_50 = compute_volreg(data)

    print(f"    DDVel  신호: {crash_sig.sum()}일 ({crash_sig.sum()/T*100:.1f}%)"
          f"  [dd5<=-10% OR dd10<=-18%]")
    print(f"    VolReg 신호: {vol_sig.sum()}일  ({vol_sig.sum()/T*100:.1f}%)"
          f"  [rvol>={vol_80*100:.0f}% AND dd10<=-7%]")
    print(f"    rvol 50th pct (R2 기준): {vol_50*100:.1f}%")

    # DDVel 에피소드별 신호 현황
    print("\n    DDVel 신호 분포:")
    for ep, (s, e) in EPISODES.items():
        m  = (dates >= s) & (dates <= e)
        sd = crash_sig[m].sum()
        print(f"      {ep:<22}: {sd:>3}일 ({sd/m.sum()*100:.1f}%)")

    # [3] 전략 실행
    print("\n[3] 전략 백테스트 실행 ...")

    print("    MA200 ...")
    res_ma200 = _add_metrics(run_ma200_strategy(data), T)

    print("    Adapt-B ...")
    res_adapt = _add_metrics(run_adaptive_ma(data), T)

    results = {'ma200': res_ma200, 'adapt_b': res_adapt}

    for vk, (em, rm) in VARIANTS.items():
        print(f"    {LABELS[vk]} ...")
        results[vk] = run_crash_action(
            data, crash_sig, vol_sig, rvol10, vol_50, em, rm)

    # [4] 전체 성과 지표
    print("\n[4] 전체 성과 지표 (2011-2026)")
    print("-" * 78)
    print(f"  {'전략':<24} {'최종자산':>12} {'CAGR':>7} {'MaxDD':>7} {'Sharpe':>7} {'회복(d)':>8}")
    print("-" * 78)
    for k, res in results.items():
        lbl = LABELS.get(k, k)
        print(f"  {lbl:<24} ${res['final']:>11,.0f} "
              f" {res['cagr']*100:>5.1f}%"
              f" {res['max_dd']*100:>5.1f}%"
              f"  {res['sharpe']:>5.2f}"
              f"  {res['recov_d']:>7}d")
    print("-" * 78)

    # [5] 에피소드별 MaxDD 비교
    print("\n[5] 에피소드별 MaxDD 비교")
    ep_metrics = compute_episode_metrics(results, data)

    strat_keys = list(results.keys())

    # Print per-episode Max DD table
    for ep_name, ep_data in ep_metrics.items():
        if not ep_data: continue
        cat = ('★Crash' if ep_name in CRASH_EPISODES else
               '▲Bear'  if ep_name in BEAR_EPISODES  else '●Corr')
        s, e = EPISODES[ep_name]
        print(f"\n  [{ep_name}]  {s}~{e}  ({cat})")
        print(f"  {'지표':<14}", end="")
        for k in strat_keys:
            lbl = LABELS.get(k, k)[:13]
            print(f"  {lbl:>13}", end="")
        print()
        print("  " + "-" * (14 + 15 * len(strat_keys)))

        for metric, fmt_fn in [
            ("MaxDD",       lambda m: f"{m['max_dd']*100:+.1f}%" if m else "n/a"),
            ("트로프일",    lambda m: str(m['trough_d'].date())   if m else "n/a"),
            ("회복(d)",    lambda m: (f"{m['recov_d']}d" if m['recov_d'] else 'n/a') if m else "n/a"),
            ("에피소드Ret", lambda m: f"{m['ep_ret']*100:+.1f}%" if m else "n/a"),
            ("현금@트로프",  lambda m: f"{m['cash_pct']*100:.0f}%" if m else "n/a"),
        ]:
            print(f"  {metric:<14}", end="")
            for k in strat_keys:
                val = fmt_fn(ep_data.get(k))
                print(f"  {val:>13}", end="")
            print()

    # [6] Exit Mode별 집계 비교
    print("\n[6] Exit Mode별 성과 집계 (R1/R2 평균)")
    print()
    print(f"  {'Exit':<6} {'CAGR(R1)':>10} {'CAGR(R2)':>10} "
          f"{'Sharpe(R1)':>12} {'Sharpe(R2)':>12} "
          f"{'MaxDD(R1)':>11} {'MaxDD(R2)':>11}")
    print("  " + "-" * 75)
    for em in ['A', 'B', 'C', 'D']:
        r1, r2 = results[f'{em}_R1'], results[f'{em}_R2']
        print(f"  {em:<6}"
              f"  {r1['cagr']*100:>8.1f}%  {r2['cagr']*100:>8.1f}%"
              f"  {r1['sharpe']:>10.3f}  {r2['sharpe']:>10.3f}"
              f"  {r1['max_dd']*100:>9.1f}%  {r2['max_dd']*100:>9.1f}%")
    print()
    print(f"  {'Baseline':<6}"
          f"  {'MA200:':>8} {results['ma200']['cagr']*100:.1f}%"
          f"  {'Adapt-B:':>10} {results['adapt_b']['cagr']*100:.1f}%")

    # [7] 최종 질문에 대한 답
    print("\n[7] 연구 결론")
    print("-" * 72)

    # Best overall Sharpe
    variant_keys = [k for k in results if k not in ('ma200', 'adapt_b')]
    best_sharpe_k = max(variant_keys, key=lambda k: results[k]['sharpe'])
    best_cagr_k   = max(variant_keys, key=lambda k: results[k]['cagr'])
    best_dd_k     = min(variant_keys, key=lambda k: results[k]['max_dd'])

    # Compare R1 vs R2 average
    r1_avg_cagr = np.mean([results[f'{em}_R1']['cagr'] for em in 'ABCD']) * 100
    r2_avg_cagr = np.mean([results[f'{em}_R2']['cagr'] for em in 'ABCD']) * 100
    r1_avg_dd   = np.mean([results[f'{em}_R1']['max_dd'] for em in 'ABCD']) * 100
    r2_avg_dd   = np.mean([results[f'{em}_R2']['max_dd'] for em in 'ABCD']) * 100

    print(f"""
  ■ Q1. Crash detector 이후 최적 탈출 규모는?
    - Sharpe 최고: {LABELS[best_sharpe_k]} (Sharpe {results[best_sharpe_k]['sharpe']:.3f})
    - CAGR 최고:   {LABELS[best_cagr_k]}   (CAGR {results[best_cagr_k]['cagr']*100:.1f}%)
    - MaxDD 최소:  {LABELS[best_dd_k]}     (DD {results[best_dd_k]['max_dd']*100:.1f}%)

  ■ Q2. Staged exit이 Single exit보다 우수한가?
    - A(25%+25%): CAGR {results['A_R1']['cagr']*100:.1f}%, Sharpe {results['A_R1']['sharpe']:.3f}
    - B(50%즉시): CAGR {results['B_R1']['cagr']*100:.1f}%, Sharpe {results['B_R1']['sharpe']:.3f}
    - C(단계25/25/25): CAGR {results['C_R1']['cagr']*100:.1f}%, Sharpe {results['C_R1']['sharpe']:.3f}

  ■ Q3. Re-entry: Vmin Ladder(R1) vs Volatility Recovery(R2)?
    - R1 평균 CAGR: {r1_avg_cagr:.1f}%  |  R2 평균 CAGR: {r2_avg_cagr:.1f}%
    - R1 평균 MaxDD: {r1_avg_dd:.1f}%  |  R2 평균 MaxDD: {r2_avg_dd:.1f}%
    - 우수한 Re-entry: {'R1 (Vmin Ladder)' if r1_avg_cagr >= r2_avg_cagr else 'R2 (Vol Recovery)'}

  ■ Q4. VR 시스템에 가장 안정적인 crash 대응 구조는?
    - Sharpe 기준 최적: {LABELS[best_sharpe_k]}
    - CAGR + MaxDD 균형: {LABELS[best_sharpe_k]}

  ■ Adapt-B 대비 개선 여부:
    - 최고 CAGR 변화:   {(results[best_cagr_k]['cagr'] - results['adapt_b']['cagr'])*100:+.1f}%p
    - 최고 Sharpe 변화: {results[best_sharpe_k]['sharpe'] - results['adapt_b']['sharpe']:+.3f}
""")

    # [8] 차트 생성
    print("[8] 차트 생성 중 ...")
    make_charts(data, results, crash_sig, vol_sig, rvol10, vol_50, ep_metrics, OUT_DIR)
    print(f"    저장 위치: {OUT_DIR}")

    print("\n[9] 완료")
    print("=" * 72)


if __name__ == "__main__":
    main()
