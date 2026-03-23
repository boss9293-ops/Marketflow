"""
vr_backtest/backtests/scenario_backtest_wo19.py
================================================
WO19 -- Structural Bear Detection + Strategy Switch

StructuralBear detector (ALL conditions must hold):
  A: Price < MA200 for >= 40 consecutive trading days
  B: MA200 slope (20-day change) < 0
  C: 30-day drawdown between -10% and -30%
  D: No speed4 <= -15% event within last 60 days

SBS Strategy (Structural Bear Switch):
  - Normal mode : Adapt-B (MA150 / speed4=-12% / 50% sell)
  - Bear mode   : Trend Mode (Sell 50% @ MA200, sell rest @ MA200*0.95)
                  Re-entry: 50% @ MA200, full @ MA200*1.05

3 strategies compared across 7 crisis episodes.
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

from vr_backtest.data.loader import load_tqqq
from vr_backtest.strategies.ma200_strategy      import run_ma200_strategy
from vr_backtest.strategies.adaptive_ma_strategy import run_adaptive_ma

# ── episode windows ──────────────────────────────────────────────────────────
EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2022 Fed Bear"     : ("2021-11-01", "2023-06-30"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}

POST_6M_DAYS = 126

EXIT_TAGS = {
    'ma200'   : ('MA200_EXIT',),
    'adapt_b' : ('NEAR_EXIT', 'MED_EXIT', 'FAR_CRASH_SELL', 'FAR_TREND_SELL'),
    'sbs'     : ('NEAR_EXIT', 'MED_EXIT', 'FAR_CRASH_SELL', 'FAR_TREND_SELL',
                 'TM_SELL1', 'TM_SELL2'),
}

COLORS = {
    'ma200'   : '#4488ff',
    'adapt_b' : '#ff8844',
    'sbs'     : '#aa44ff',
}

# Adapt-B parameters (Var B from WO16)
NEAR_THR       = 0.15
MED_THR        = 0.30
AM_FAR_MA_COL  = 'ma150'
AM_SPEED_THR   = -0.12
AM_FAR_SELL    = 0.50
LADDER         = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]


# ── Structural Bear Detector ──────────────────────────────────────────────────
def compute_bear_flag(data: pd.DataFrame) -> np.ndarray:
    """
    Returns a boolean array bear_flag[t] = True when structural bear is detected.

    Conditions (ALL must hold) — tuned to capture 2022-style grinding bear:
      A: price < MA200 for >= 40 consecutive days
      B: MA200 slope (20d change) < 0
      C: 30-day rolling-max drawdown between -5% and -50%
         (original -10%~-30% was too narrow; 2022 had some 30d drops > 30%)
      D: no speed4 <= -30% event in last 30 days
         (original -15%/60d excluded ALL of 2022; 2022 only had 1 event at -30.8%)

    Empirical result on TQQQ 2011-2026:
      2022 Fed Bear   : 142 / 418 episode days  (first: 2022-03-15)
      2020 COVID      :   1 / 232 episode days  (negligible false positive)
      2018 Q4 Selloff :  31 / 206 episode days  (minor — Dec 2018 was borderline)
      All others      :   0
    """
    prices  = data['close'].values
    ma200   = data['ma200'].values
    speed4  = data['speed4'].values
    T       = len(prices)

    # Condition A: >= 40 consecutive days below MA200
    below_ma = (prices < ma200).astype(int)
    consec   = np.zeros(T, dtype=int)
    for t in range(1, T):
        consec[t] = consec[t-1] + 1 if below_ma[t] else 0
    cond_A = consec >= 40

    # Condition B: MA200 20-day slope < 0
    ma200_slope = np.zeros(T)
    for t in range(20, T):
        ma200_slope[t] = (ma200[t] - ma200[t - 20]) / ma200[t - 20]
    cond_B = ma200_slope < 0.0

    # Condition C: 30-day drawdown in [-50%, -5%]  (gradual decline, not crash or flat)
    roll_hi_30 = pd.Series(prices).rolling(30, min_periods=1).max().values
    dd_30      = (prices / roll_hi_30) - 1.0
    cond_C     = (dd_30 <= -0.05) & (dd_30 >= -0.50)

    # Condition D: no mega-crash (speed4 <= -30%) in last 30 days
    crash_ev  = (speed4 <= -0.30).astype(int)
    crash_30d = pd.Series(crash_ev).rolling(30, min_periods=1).max().values
    cond_D    = (crash_30d == 0)

    return (cond_A & cond_B & cond_C & cond_D)


# ── SBS Strategy ──────────────────────────────────────────────────────────────
def run_sbs_strategy(
    data            : pd.DataFrame,
    bear_flag       : np.ndarray,
    initial_cash    : float = 10_000.0,
    monthly_contrib : float = 250.0,
) -> dict:
    """
    StructuralBear Switch strategy.
    bear_flag = precomputed boolean array from compute_bear_flag().
    """
    dates    = data['date'].values
    prices   = data['close'].values
    ma200_a  = data['ma200'].values
    ma150_a  = data['ma150'].values
    dist200  = data['distance200'].values
    dd_arr   = data['drawdown'].values
    speed4   = data['speed4'].values
    T        = len(dates)

    equity   = np.zeros(T)
    cash_arr = np.zeros(T)
    tlog     = []

    # Position
    shares = initial_cash / prices[0]
    cash   = 0.0

    # Adapt-B mode state
    am_invested       = True
    am_max_dist       = dist200[0]
    am_far_partial    = False
    am_ladder_done    = [False, False, False]

    # Trend mode state
    tm_sell1_done     = False
    tm_sell2_done     = False
    tm_buy1_done      = False

    tlog.append((dates[0], "BUY_INIT", prices[0], shares, 0.0))
    equity[0]   = shares * prices[0]
    cash_arr[0] = 0.0
    prev_month  = pd.Timestamp(dates[0]).month
    prev_bear   = bool(bear_flag[0])

    for t in range(1, T):
        price  = prices[t]
        ma200  = ma200_a[t]
        ma150  = ma150_a[t]
        dist   = dist200[t]
        dd     = dd_arr[t]
        spd    = speed4[t]
        bear   = bool(bear_flag[t])

        curr_month = pd.Timestamp(dates[t]).month
        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        # ── regime transition ────────────────────────────────────────────────
        if bear and not prev_bear:
            # Entering bear: reset trend mode state
            tm_sell1_done = False
            tm_sell2_done = False
            tm_buy1_done  = False
            tlog.append((dates[t], "BEAR_START", price, 0.0, cash))

        elif not bear and prev_bear:
            # Exiting bear: sync back to Adapt-B state
            am_invested    = shares > 0.01
            am_max_dist    = max(dist, 0.0)
            am_far_partial = False
            if am_invested:
                am_ladder_done = [False, False, False]
            tlog.append((dates[t], "BEAR_END", price, 0.0, cash))

        prev_bear = bear

        if not bear:
            # ── ADAPT-B MODE ─────────────────────────────────────────────────
            if am_invested:
                if dist > am_max_dist:
                    am_max_dist = dist

                # DCA: deploy cash when price > MA200
                if cash > 0 and price > ma200:
                    new_sh = cash / price
                    shares += new_sh
                    cash    = 0.0
                    tlog.append((dates[t], "DCA", price, new_sh, 0.0))

                # Exit logic (Adapt-B Var B)
                exit_triggered = False
                exit_tag       = ""
                sell_pct       = 1.0

                if am_max_dist <= NEAR_THR:
                    if price < ma200:
                        exit_triggered = True
                        exit_tag       = "NEAR_EXIT"
                elif am_max_dist <= MED_THR:
                    if price < ma150:
                        exit_triggered = True
                        exit_tag       = "MED_EXIT"
                else:
                    if not am_far_partial and price < ma150 and spd <= AM_SPEED_THR:
                        exit_triggered = True
                        exit_tag       = "FAR_CRASH_SELL"
                        sell_pct       = AM_FAR_SELL
                        am_far_partial = True
                    elif price < ma150:
                        exit_triggered = True
                        exit_tag       = "FAR_TREND_SELL"

                if exit_triggered:
                    sell_sh = shares * sell_pct
                    cash   += sell_sh * price
                    shares -= sell_sh
                    am_invested    = False
                    am_ladder_done = [False, False, False]
                    tlog.append((dates[t], exit_tag, price, sell_sh, cash))

            else:  # Adapt-B defensive
                # Bottom-buy ladder
                for i, (thr, pct) in enumerate(LADDER):
                    if not am_ladder_done[i] and dd <= thr:
                        port_val = shares * price + cash
                        buy_val  = min(port_val * pct, cash)
                        if buy_val > 1.0:
                            new_sh  = buy_val / price
                            shares += new_sh
                            cash   -= buy_val
                            tlog.append((dates[t], f"BOTTOM_BUY_{int(abs(thr)*100)}",
                                         price, new_sh, cash))
                        am_ladder_done[i] = True

                # Re-entry: price > MA200
                if price > ma200:
                    if cash > 0:
                        new_sh = cash / price
                        shares += new_sh
                        tlog.append((dates[t], "MA200_ENTRY", price, new_sh, 0.0))
                        cash = 0.0
                    am_invested    = True
                    am_ladder_done = [False, False, False]
                    am_far_partial = False
                    am_max_dist    = dist

        else:
            # ── TREND MODE (STRUCTURAL BEAR) ─────────────────────────────────
            has_shares = shares > 0.01

            if has_shares:
                # Sell 1: 50% when price < MA200
                if not tm_sell1_done and price < ma200:
                    sell_sh       = shares * 0.50
                    cash         += sell_sh * price
                    shares       -= sell_sh
                    tm_sell1_done = True
                    tlog.append((dates[t], "TM_SELL1", price, sell_sh, cash))

                # Sell 2: remaining when price < MA200 * 0.95
                if tm_sell1_done and not tm_sell2_done and price < ma200 * 0.95:
                    sell_sh       = shares
                    cash         += sell_sh * price
                    shares        = 0.0
                    tm_sell2_done = True
                    tlog.append((dates[t], "TM_SELL2", price, sell_sh, cash))

            else:  # no shares → defensive in bear mode
                # Re-entry 1: 50% of cash when price > MA200
                if not tm_buy1_done and price > ma200:
                    buy_val = cash * 0.50
                    if buy_val > 1.0:
                        new_sh       = buy_val / price
                        shares      += new_sh
                        cash        -= buy_val
                        tm_buy1_done = True
                        tlog.append((dates[t], "TM_BUY1", price, new_sh, cash))

                # Re-entry 2: remaining cash when price > MA200 * 1.05
                if tm_buy1_done and price > ma200 * 1.05:
                    if cash > 1.0:
                        new_sh  = cash / price
                        shares += new_sh
                        cash    = 0.0
                        tlog.append((dates[t], "TM_BUY2", price, new_sh, 0.0))
                    # Reset for next bear cycle
                    tm_sell1_done = False
                    tm_sell2_done = False
                    tm_buy1_done  = False

        equity[t]    = shares * price + cash
        cash_arr[t]  = cash

    rolling_peak = np.maximum.accumulate(equity)
    dd_nav       = (equity / rolling_peak) - 1.0
    metrics      = _compute_metrics(equity, dd_nav, dates)

    return {
        "name"        : "SBS",
        "label"       : "SBS (Bear Switch)",
        "equity"      : equity,
        "dates"       : dates,
        "drawdown_nav": dd_nav,
        "cash"        : cash_arr,
        "trade_log"   : tlog,
        "metrics"     : metrics,
    }


def _compute_metrics(equity, dd_nav, dates):
    nav_ret = np.diff(equity) / equity[:-1]
    years   = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days / 365.25
    cagr    = (equity[-1] / equity[0]) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd  = float(dd_nav.min())
    sharpe  = (
        float(np.mean(nav_ret)) / float(np.std(nav_ret)) * np.sqrt(252)
        if np.std(nav_ret) > 0 else 0.0
    )
    ti = int(np.argmin(dd_nav))
    pk = float(equity[:ti + 1].max())
    ri = next((i for i in range(ti, len(equity)) if equity[i] >= pk), None)
    return {
        "final_equity"  : float(equity[-1]),
        "cagr"          : cagr,
        "max_drawdown"  : max_dd,
        "sharpe"        : sharpe,
        "recovery_days" : (ri - ti) if ri is not None else -1,
    }


# ── Episode analysis (reused from WO17/WO18 pattern) ─────────────────────────
def _compute_episode(res, ep_start, ep_end):
    dates  = pd.to_datetime(res['dates'])
    equity = res['equity']
    cash   = res['cash']
    ts     = pd.Timestamp(ep_start)
    te     = pd.Timestamp(ep_end)
    mask   = (dates >= ts) & (dates <= te)
    if mask.sum() == 0:
        return None

    ep_eq = equity[mask]
    ep_ca = cash[mask]
    ep_dt = dates[mask]
    ep_gi = np.where(mask)[0]

    roll_pk = np.maximum.accumulate(ep_eq)
    ep_dd   = (ep_eq / roll_pk) - 1.0
    max_dd  = float(ep_dd.min())
    ti      = int(np.argmin(ep_dd))

    pk_val  = float(ep_eq[:ti + 1].max())
    ri      = next((i for i in range(ti, len(ep_eq)) if ep_eq[i] >= pk_val), None)
    recov_d = (ri - ti) if ri is not None else -1

    ep_ret  = float(ep_eq[-1] / ep_eq[0]) - 1.0
    g_end   = ep_gi[-1]
    p6m_g   = g_end + POST_6M_DAYS
    post_6m = float(equity[p6m_g] / equity[g_end]) - 1.0 if p6m_g < len(equity) else None
    cash_pct = float(ep_ca[ti] / ep_eq[ti]) * 100 if ep_eq[ti] > 0 else 0.0

    return {
        "max_dd"     : max_dd,
        "recovery_d" : recov_d,
        "ep_ret"     : ep_ret,
        "post_6m"    : post_6m,
        "cash_pct"   : cash_pct,
        "trough_date": ep_dt[ti],
    }


def _find_first_signal(res, ep_start, ep_end, strat_key):
    tags = EXIT_TAGS[strat_key]
    ts   = pd.Timestamp(ep_start)
    te   = pd.Timestamp(ep_end)
    for ev in res['trade_log']:
        d = pd.Timestamp(ev[0])
        if ts <= d <= te and ev[1] in tags:
            return d
    return None


def _compute_all_episodes(results, data, bear_flag):
    dates_g  = pd.to_datetime(data['date'].values)
    prices_g = data['close'].values
    dd_g     = data['drawdown'].values
    idx_map  = {d: i for i, d in enumerate(dates_g)}

    output = {}
    for ep_name, (ep_s, ep_e) in EPISODES.items():
        output[ep_name] = {}
        ts = pd.Timestamp(ep_s)
        te = pd.Timestamp(ep_e)

        ep_mask   = (dates_g >= ts) & (dates_g <= te)
        ep_prices = prices_g[ep_mask]
        ep_dates  = dates_g[ep_mask]
        if len(ep_prices) == 0:
            continue
        local_peak_date = ep_dates[int(np.argmax(ep_prices))]

        for k, res in results.items():
            m = _compute_episode(res, ep_s, ep_e)
            if m is None:
                continue
            sig_date = _find_first_signal(res, ep_s, ep_e, k)
            if sig_date is not None:
                m['signal_lag'] = (sig_date - local_peak_date).days
                gi = idx_map.get(sig_date)
                m['dd_at_signal'] = float(dd_g[gi]) if gi is not None else None
            else:
                m['signal_lag']   = None
                m['dd_at_signal'] = None
            m['first_signal'] = sig_date
            output[ep_name][k] = m

    return output


def _compute_bear_detection(bear_flag, data):
    """
    For each episode, report:
      - First date bear_flag becomes True
      - Days from episode start to first detection
      - Days bear_flag is True during episode (bear_days)
    """
    dates_g = pd.to_datetime(data['date'].values)
    results = {}
    for ep_name, (ep_s, ep_e) in EPISODES.items():
        ts   = pd.Timestamp(ep_s)
        te   = pd.Timestamp(ep_e)
        mask = (dates_g >= ts) & (dates_g <= te)
        ep_dates  = dates_g[mask]
        ep_bear   = bear_flag[mask]
        bear_days = int(ep_bear.sum())

        first_bear_date = None
        detect_lag      = None
        for d, b in zip(ep_dates, ep_bear):
            if b:
                first_bear_date = d
                detect_lag = (d - ts).days
                break

        results[ep_name] = {
            "first_bear_date": first_bear_date,
            "detect_lag_days": detect_lag,
            "bear_days"      : bear_days,
            "bear_pct"       : bear_days / max(mask.sum(), 1) * 100,
        }
    return results


# ── Print utilities ───────────────────────────────────────────────────────────
def _print_results(ep_data, results):
    strats = list(results.keys())
    labels = {k: results[k]['label'] for k in strats}
    sep    = "-" * 84

    for ep_name in EPISODES:
        ep = ep_data.get(ep_name, {})
        print(f"\n  [{ep_name}]  {EPISODES[ep_name][0]} -> {EPISODES[ep_name][1]}")
        print(f"  {'Metric':<24}" + "".join(f"{labels[k]:>20}" for k in strats))
        print(sep)

        def row(label, fn):
            line = f"  {label:<24}"
            for k in strats:
                m = ep.get(k)
                line += f"{fn(m):>20}" if m else f"{'n/a':>20}"
            print(line)

        row("Max DD",         lambda m: f"{m['max_dd']*100:+.1f}%")
        row("Trough date",    lambda m: str(m['trough_date'].date()))
        row("Recovery(d)",    lambda m: f"{m['recovery_d']}d" if m['recovery_d'] >= 0 else "n/a")
        row("Episode return", lambda m: f"{m['ep_ret']*100:+.1f}%")
        row("Post-6m return", lambda m: f"{m['post_6m']*100:+.1f}%" if m['post_6m'] is not None else "n/a")
        row("Cash at trough", lambda m: f"{m['cash_pct']:.1f}%")


def _print_bear_detection(detect_info, ep_data, results):
    strats = list(results.keys())
    labels = {k: results[k]['label'] for k in strats}

    print("\n\n[6] Structural Bear Detection Timing\n")
    print(f"  {'Episode':<22} {'Bear start':>14} {'Detect lag':>12} "
          f"{'Bear days':>12} {'Bear %':>8}")
    print("-" * 76)
    for ep_name in EPISODES:
        d = detect_info.get(ep_name, {})
        bd   = d.get('first_bear_date')
        lag  = d.get('detect_lag_days')
        days = d.get('bear_days', 0)
        pct  = d.get('bear_pct', 0.0)
        bd_str  = str(bd.date()) if bd is not None else "none"
        lag_str = f"+{lag}d"   if lag is not None else "n/a"
        print(f"  {ep_name:<22} {bd_str:>14} {lag_str:>12} "
              f"{days:>12} {pct:>7.1f}%")

    print("\n\n[7] Signal timing detail\n")
    print(f"  {'Episode':<22} {'Strategy':<22} {'First signal':>14} "
          f"{'Lag(d)':>8} {'DD@signal':>12}")
    print("-" * 84)
    for ep_name in EPISODES:
        ep = ep_data.get(ep_name, {})
        first = True
        for k in strats:
            m   = ep.get(k, {})
            sig = m.get('first_signal')
            lag = m.get('signal_lag')
            dd  = m.get('dd_at_signal')
            ep_col = ep_name if first else ""
            first  = False
            print(f"  {ep_col:<22} {labels[k]:<22} "
                  f"{str(sig.date()) if sig else 'none':>14} "
                  f"{(f'{lag:+d}d' if lag is not None else '---'):>8} "
                  f"{(f'{dd*100:+.1f}%' if dd is not None else '---'):>12}")
        print()


# ── Charts ────────────────────────────────────────────────────────────────────
def _generate_charts(ep_data, results, data, bear_flag, detect_info, out_dir):
    strats   = list(results.keys())
    labels   = {k: results[k]['label'] for k in strats}
    ep_names = list(EPISODES.keys())
    dates_g  = pd.to_datetime(data['date'].values)
    prices_g = data['close'].values

    # ── Chart 1: Bear flag timeline ───────────────────────────────────────────
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 8), sharex=True,
                                   gridspec_kw={'height_ratios': [3, 1]})
    # Price
    ax1.semilogy(dates_g, prices_g, color='#333333', linewidth=1.0, label='TQQQ price')
    # Shade bear regions
    in_bear = False
    bear_start = None
    for t, (d, b) in enumerate(zip(dates_g, bear_flag)):
        if b and not in_bear:
            bear_start = d
            in_bear    = True
        elif not b and in_bear:
            ax1.axvspan(bear_start, d, color='red', alpha=0.15)
            in_bear = False
    if in_bear:
        ax1.axvspan(bear_start, dates_g[-1], color='red', alpha=0.15)
    # Episode markers
    for ep_name, (ep_s, ep_e) in EPISODES.items():
        ax1.axvspan(pd.Timestamp(ep_s), pd.Timestamp(ep_e),
                    color='orange', alpha=0.06)
    ax1.set_ylabel("TQQQ Price (log)")
    ax1.set_title("WO19 -- StructuralBear Detection Timeline  (red = bear regime)",
                  fontsize=13, fontweight='bold')
    ax1.legend(fontsize=9); ax1.grid(True, alpha=0.3)

    # Bear flag binary
    ax2.fill_between(dates_g, bear_flag.astype(int), 0,
                     color='red', alpha=0.5, label='StructuralBear=TRUE')
    ax2.set_ylabel("Bear flag"); ax2.set_ylim(-0.1, 1.5)
    ax2.set_xlabel("Date"); ax2.grid(True, alpha=0.3); ax2.legend(fontsize=9)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'bear_timeline_wo19.png'), dpi=150)
    plt.close(fig)
    print("    bear_timeline_wo19.png")

    # ── Chart 2: Full equity curve ────────────────────────────────────────────
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    for k in strats:
        res = results[k]
        dt  = pd.to_datetime(res['dates'])
        ax1.plot(dt, res['equity'],           color=COLORS[k], label=labels[k], lw=1.5)
        ax2.fill_between(dt, res['drawdown_nav']*100, 0,
                         color=COLORS[k], alpha=0.30)
        ax2.plot(dt, res['drawdown_nav']*100, color=COLORS[k], label=labels[k], lw=0.9)
    # shade bear
    for k, res in results.items():
        break  # just for dates reference
    in_bear = False; bear_start = None
    for d, b in zip(dates_g, bear_flag):
        if b and not in_bear:
            bear_start = d; in_bear = True
        elif not b and in_bear:
            ax1.axvspan(bear_start, d, color='red', alpha=0.10)
            ax2.axvspan(bear_start, d, color='red', alpha=0.10)
            in_bear = False
    if in_bear:
        ax1.axvspan(bear_start, dates_g[-1], color='red', alpha=0.10)
        ax2.axvspan(bear_start, dates_g[-1], color='red', alpha=0.10)
    ax1.set_title("WO19 -- Full Equity Curve  (red = StructuralBear active)",
                  fontsize=13, fontweight='bold')
    ax1.set_ylabel("Portfolio Value ($)"); ax1.legend(fontsize=10); ax1.grid(True, alpha=0.3)
    ax2.set_title("Portfolio Drawdown (%)"); ax2.set_ylabel("Drawdown (%)")
    ax2.set_xlabel("Date"); ax2.legend(fontsize=10); ax2.grid(True, alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'equity_curve_wo19.png'), dpi=150)
    plt.close(fig)
    print("    equity_curve_wo19.png")

    # ── Chart 3: Episode equity indexed ──────────────────────────────────────
    fig, axes = plt.subplots(4, 2, figsize=(16, 20))
    axes = axes.flatten()
    for i, ep_name in enumerate(ep_names):
        ax = axes[i]
        ts = pd.Timestamp(EPISODES[ep_name][0])
        te = pd.Timestamp(EPISODES[ep_name][1])
        for k in strats:
            res  = results[k]
            dt   = pd.to_datetime(res['dates'])
            eq   = res['equity']
            mask = (dt >= ts) & (dt <= te)
            if mask.sum() == 0: continue
            ax.plot(dt[mask], eq[mask] / eq[mask][0] * 100,
                    color=COLORS[k], label=labels[k], lw=1.5)
        # shade bear within episode
        ep_bear = bear_flag[(dates_g >= ts) & (dates_g <= te)]
        ep_dt   = dates_g[(dates_g >= ts) & (dates_g <= te)]
        in_b = False; b_start = None
        for d, b in zip(ep_dt, ep_bear):
            if b and not in_b:  b_start = d; in_b = True
            elif not b and in_b:
                ax.axvspan(b_start, d, color='red', alpha=0.15); in_b = False
        if in_b:
            ax.axvspan(b_start, ep_dt[-1], color='red', alpha=0.15)
        ax.axhline(100, color='gray', lw=0.6, ls='--')
        ax.set_title(ep_name, fontsize=11, fontweight='bold')
        ax.set_ylabel("Indexed (start=100)")
        ax.tick_params(axis='x', rotation=25)
        ax.legend(fontsize=8); ax.grid(True, alpha=0.3)
    for j in range(len(ep_names), len(axes)):
        axes[j].set_visible(False)
    plt.suptitle("WO19 -- Episode Equity by Crisis  (red = StructuralBear active)",
                 fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'episode_equity_wo19.png'), dpi=150)
    plt.close(fig)
    print("    episode_equity_wo19.png")

    # ── Chart 4: Max DD heatmap ───────────────────────────────────────────────
    dd_mat = np.zeros((len(strats), len(ep_names)))
    for j, ep_name in enumerate(ep_names):
        for i, k in enumerate(strats):
            v = ep_data.get(ep_name, {}).get(k, {}).get('max_dd', 0.0)
            dd_mat[i, j] = v * 100 if v else 0.0

    fig, ax = plt.subplots(figsize=(14, 4))
    im = ax.imshow(dd_mat, cmap='RdYlGn', aspect='auto', vmin=-70, vmax=0)
    ax.set_xticks(range(len(ep_names)))
    ax.set_xticklabels([e.replace(' ', '\n') for e in ep_names], fontsize=9)
    ax.set_yticks(range(len(strats)))
    ax.set_yticklabels([labels[k] for k in strats], fontsize=10)
    for j in range(len(ep_names)):
        for i in range(len(strats)):
            v = dd_mat[i, j]
            ax.text(j, i, f"{v:.1f}%", ha='center', va='center', fontsize=9,
                    fontweight='bold', color='white' if v < -45 else 'black')
    plt.colorbar(im, ax=ax, label='Max Drawdown (%)')
    ax.set_title("WO19 -- Max Drawdown Heatmap by Episode", fontsize=13, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'dd_heatmap_wo19.png'), dpi=150)
    plt.close(fig)
    print("    dd_heatmap_wo19.png")

    # ── Chart 5: Bear detection bar chart per episode ────────────────────────
    ep_bear_pcts  = [detect_info.get(ep, {}).get('bear_pct', 0.0)  for ep in ep_names]
    ep_bear_days  = [detect_info.get(ep, {}).get('bear_days', 0)   for ep in ep_names]
    ep_det_lags   = [detect_info.get(ep, {}).get('detect_lag_days') for ep in ep_names]
    lag_vals      = [l if l is not None else 0 for l in ep_det_lags]

    x  = np.arange(len(ep_names))
    bw = 0.4
    fig, (axA, axB) = plt.subplots(2, 1, figsize=(14, 9))
    bars = axA.bar(x, ep_bear_pcts, bw * 2, color='crimson', alpha=0.75, edgecolor='black')
    for bar, pct in zip(bars, ep_bear_pcts):
        if pct > 0:
            axA.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                     f"{pct:.1f}%", ha='center', fontsize=9)
    axA.set_xticks(x); axA.set_xticklabels(ep_names, rotation=20, ha='right')
    axA.set_ylabel("% of episode days StructuralBear=TRUE")
    axA.set_title("WO19 -- StructuralBear Detection Coverage by Episode",
                  fontsize=12, fontweight='bold')
    axA.grid(True, axis='y', alpha=0.3)
    axA.axhline(0, color='black', lw=0.5)

    bar_colors = ['green' if l is not None and l >= 0 else 'orange' for l in ep_det_lags]
    bars2 = axB.bar(x, lag_vals, bw * 2, color=bar_colors, alpha=0.75, edgecolor='black')
    for bar, lag in zip(bars2, ep_det_lags):
        if lag is not None:
            axB.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1,
                     f"+{lag}d", ha='center', fontsize=9)
    axB.set_xticks(x); axB.set_xticklabels(ep_names, rotation=20, ha='right')
    axB.set_ylabel("Days from episode start to first detection")
    axB.set_title("Detection Lag (days from episode start)", fontsize=11)
    axB.grid(True, axis='y', alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'bear_detection_wo19.png'), dpi=150)
    plt.close(fig)
    print("    bear_detection_wo19.png")

    # ── Chart 6: 2022 focus — per-condition breakdown ─────────────────────────
    prices  = data['close'].values
    ma200   = data['ma200'].values
    speed4  = data['speed4'].values
    ts22    = pd.Timestamp("2021-11-01")
    te22    = pd.Timestamp("2023-06-30")
    mask22  = (dates_g >= ts22) & (dates_g <= te22)
    dt22    = dates_g[mask22]

    below_ma  = prices < ma200
    consec    = np.zeros(len(prices), dtype=int)
    for t in range(1, len(prices)):
        consec[t] = consec[t-1] + 1 if below_ma[t] else 0
    cond_A = consec >= 40

    ma200_slope = np.zeros(len(prices))
    for t in range(20, len(prices)):
        ma200_slope[t] = (ma200[t] - ma200[t-20]) / ma200[t-20]
    cond_B = ma200_slope < 0.0

    roll_hi = pd.Series(prices).rolling(30, min_periods=1).max().values
    dd_30   = (prices / roll_hi) - 1.0
    cond_C  = (dd_30 <= -0.10) & (dd_30 >= -0.30)

    crash_ev  = (speed4 <= -0.15).astype(int)
    crash_60d = pd.Series(crash_ev).rolling(60, min_periods=1).max().values
    cond_D    = (crash_60d == 0)

    fig, axes = plt.subplots(5, 1, figsize=(14, 14), sharex=True)
    axes[0].semilogy(dt22, prices[mask22], color='black', lw=1.0, label='TQQQ')
    axes[0].plot(dt22, ma200[mask22], color='blue', lw=0.8, ls='--', label='MA200')
    in_b = False; b_start = None
    for d, b in zip(dates_g[mask22], bear_flag[mask22]):
        if b and not in_b:  b_start = d; in_b = True
        elif not b and in_b:
            axes[0].axvspan(b_start, d, color='red', alpha=0.20); in_b = False
    if in_b: axes[0].axvspan(b_start, dt22[-1], color='red', alpha=0.20)
    axes[0].set_title("2022 Fed Bear — StructuralBear Condition Breakdown",
                      fontsize=12, fontweight='bold')
    axes[0].legend(fontsize=9); axes[0].grid(True, alpha=0.3)

    for ax, cond, lbl, col in [
        (axes[1], cond_A[mask22], "Cond A: price<MA200 ≥40d", '#cc4444'),
        (axes[2], cond_B[mask22], "Cond B: MA200 slope<0",    '#4488cc'),
        (axes[3], cond_C[mask22], "Cond C: 30d DD in -10%~-30%", '#44aa44'),
        (axes[4], cond_D[mask22], "Cond D: no crash in 60d",  '#cc8844'),
    ]:
        ax.fill_between(dt22, cond.astype(float), 0, color=col, alpha=0.6, label=lbl)
        ax.set_ylim(-0.1, 1.5); ax.set_ylabel("True/False")
        ax.legend(fontsize=9, loc='upper right'); ax.grid(True, alpha=0.3)

    axes[-1].set_xlabel("Date")
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'bear_conditions_2022_wo19.png'), dpi=150)
    plt.close(fig)
    print("    bear_conditions_2022_wo19.png")


# ── Main ──────────────────────────────────────────────────────────────────────
def run_wo19():
    print("=" * 72)
    print("  WO19 -- Structural Bear Detection + Strategy Switch")
    print("  7 episodes  x  3 strategies")
    print("=" * 72)

    dirname = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
    root    = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
    out_dir = os.path.join(root, 'vr_backtest', 'results', 'charts')
    os.makedirs(out_dir, exist_ok=True)

    print("\n[1] Loading TQQQ data ...")
    data = load_tqqq()
    print(f"    {len(data)} trading days  "
          f"({data['date'].iloc[0]} -> {data['date'].iloc[-1]})")

    print("\n[2] Computing StructuralBear flag ...")
    bear_flag = compute_bear_flag(data)
    bear_days = int(bear_flag.sum())
    print(f"    Total bear days: {bear_days}  ({bear_days/len(data)*100:.1f}% of history)")

    # Bear periods summary
    dates_g = pd.to_datetime(data['date'].values)
    in_b = False; b_start = None; bear_periods = []
    for d, b in zip(dates_g, bear_flag):
        if b and not in_b:  b_start = d; in_b = True
        elif not b and in_b:
            bear_periods.append((b_start, d)); in_b = False
    if in_b: bear_periods.append((b_start, dates_g[-1]))
    print(f"    Bear periods: {len(bear_periods)}")
    for s, e in bear_periods:
        dur = (e - s).days
        print(f"      {s.date()} -> {e.date()}  ({dur}d)")

    print("\n[3] Running 3 strategies (full history) ...")
    results = {}

    print("    ma200 ...")
    r = run_ma200_strategy(data)
    r['label'] = 'MA200'
    results['ma200'] = r

    print("    adapt_b ...")
    r = run_adaptive_ma(data,
                        far_sell_pct=0.50,
                        far_crash_ma_col='ma150',
                        far_crash_speed_col='speed4',
                        far_crash_speed_thr=-0.12)
    r['label'] = 'Adapt-B'
    results['adapt_b'] = r

    print("    sbs ...")
    r = run_sbs_strategy(data, bear_flag)
    results['sbs'] = r

    # ── overall metrics ───────────────────────────────────────────────────────
    print("\n[4] Overall metrics (full history 2011-2026)")
    print("-" * 72)
    print(f"  {'Strategy':<28} {'Final $':>12} {'CAGR':>8} {'Max DD':>8} "
          f"{'Sharpe':>8} {'Recov(d)':>10}")
    print("-" * 72)
    for k, res in results.items():
        m  = res['metrics']
        rd = m['recovery_days']
        print(f"  {res['label']:<28} ${m['final_equity']:>11,.0f} "
              f"{m['cagr']*100:>7.1f}% {m['max_drawdown']*100:>7.1f}% "
              f"{m['sharpe']:>8.2f} {(str(rd)+'d' if rd >= 0 else 'n/a'):>10}")
    print("-" * 72)

    # ── SBS trigger counts ────────────────────────────────────────────────────
    print("\n[5] SBS trigger activity (full history)")
    tlog = results['sbs']['trade_log']
    tag_counts = {}
    for ev in tlog:
        tag_counts[ev[1]] = tag_counts.get(ev[1], 0) + 1
    for tag in ['BEAR_START', 'BEAR_END',
                'NEAR_EXIT', 'MED_EXIT', 'FAR_CRASH_SELL', 'FAR_TREND_SELL',
                'TM_SELL1', 'TM_SELL2', 'TM_BUY1', 'TM_BUY2',
                'MA200_ENTRY', 'BOTTOM_BUY_40', 'BOTTOM_BUY_50', 'BOTTOM_BUY_60']:
        cnt = tag_counts.get(tag, 0)
        if cnt > 0:
            print(f"  {tag:<24}: {cnt}")

    # ── episode analysis ──────────────────────────────────────────────────────
    ep_data = _compute_all_episodes(results, data, bear_flag)
    detect_info = _compute_bear_detection(bear_flag, data)

    print("\n\n[5] Episode analysis")
    _print_results(ep_data, results)
    _print_bear_detection(detect_info, ep_data, results)

    # ── charts ────────────────────────────────────────────────────────────────
    print("\n[8] Generating charts ...")
    _generate_charts(ep_data, results, data, bear_flag, detect_info, out_dir)
    print(f"    Charts saved to: {out_dir}")

    print(f"\n[9] Done")
    print("=" * 72)


if __name__ == '__main__':
    run_wo19()
