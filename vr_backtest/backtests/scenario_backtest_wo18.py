"""
vr_backtest/backtests/scenario_backtest_wo18.py
================================================
WO18 -- Hybrid Crash + Trend Strategy Test

Strategies:
  MA200     : pure trend (sell when price < MA200, re-enter when price > MA200)
  Adapt-B   : crash detector (MA150 / 4d-12% / 50% sell)
  Hybrid    : crash layer (speed4 <= -15%, sell 50%)
              + trend layer (price < MA200, sell 30%)
              crash re-entry: price >= 10-day high
              trend re-entry: price > MA200

7 crisis episodes, same windows as WO17.
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from vr_backtest.data.loader import load_tqqq
from vr_backtest.strategies.ma200_strategy     import run_ma200_strategy
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

POST_6M_DAYS = 126   # ~6 calendar months in trading days

EXIT_TAGS = {
    'ma200'   : ('MA200_EXIT',),
    'adapt_b' : ('NEAR_EXIT', 'MED_EXIT', 'FAR_CRASH_SELL', 'FAR_TREND_SELL'),
    'hybrid'  : ('CRASH_SELL', 'TREND_SELL'),
}

COLORS = {
    'ma200'   : '#4488ff',
    'adapt_b' : '#ff8844',
    'hybrid'  : '#44cc88',
}


# ── Hybrid strategy ───────────────────────────────────────────────────────────
def run_hybrid_strategy(
    data            : pd.DataFrame,
    initial_cash    : float = 10_000.0,
    monthly_contrib : float = 250.0,
    crash_speed_thr : float = -0.15,   # 4-day return threshold
    crash_sell_pct  : float = 0.50,    # crash layer: sell 50% of current shares
    trend_sell_pct  : float = 0.30,    # trend layer: sell 30% of current shares
    crash_lookback  : int   = 10,      # crash re-entry: price >= n-day high
) -> dict:
    """
    Two-layer defensive strategy:
      Crash layer : fires when speed4 <= crash_speed_thr
                    sells crash_sell_pct of current shares
                    re-enters when price >= rolling n-day high
      Trend layer : fires when price < MA200
                    sells trend_sell_pct of current shares
                    re-enters when price > MA200
    Both layers are independent -- either or both can be active simultaneously.
    Monthly contributions accumulate as free_cash and deploy when both layers
    are recovered and price > MA200.
    """
    dates   = data["date"].values
    prices  = data["close"].values
    ma200_a = data["ma200"].values
    speed4  = data["speed4"].values
    T       = len(dates)

    # rolling n-day high (for crash re-entry condition)
    high_n = pd.Series(prices).rolling(crash_lookback, min_periods=1).max().values

    equity   = np.zeros(T)
    cash_arr = np.zeros(T)
    tlog     = []

    shares       = initial_cash / prices[0]
    crash_cash   = 0.0   # cash reserved from crash sell
    trend_cash   = 0.0   # cash reserved from trend sell
    free_cash    = 0.0   # monthly contributions (undeployed)
    crash_active = False
    trend_active = False

    tlog.append((dates[0], "BUY_INIT", prices[0], shares, 0.0))
    equity[0]   = shares * prices[0]
    cash_arr[0] = 0.0
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price = prices[t]
        spd   = speed4[t]
        ma    = ma200_a[t]
        hn    = high_n[t]
        curr_month = pd.Timestamp(dates[t]).month

        # monthly contribution
        if curr_month != prev_month:
            free_cash  += monthly_contrib
            prev_month  = curr_month

        # ── SELL TRIGGERS ────────────────────────────────────────────────────
        # Crash layer: speed4 <= threshold
        if not crash_active and spd <= crash_speed_thr:
            sell_sh      = shares * crash_sell_pct
            crash_cash  += sell_sh * price
            shares      -= sell_sh
            crash_active = True
            tlog.append((dates[t], "CRASH_SELL", price, sell_sh, crash_cash))

        # Trend layer: price < MA200
        if not trend_active and price < ma:
            sell_sh      = shares * trend_sell_pct
            trend_cash  += sell_sh * price
            shares      -= sell_sh
            trend_active = True
            tlog.append((dates[t], "TREND_SELL", price, sell_sh, trend_cash))

        # ── RE-ENTRY TRIGGERS ────────────────────────────────────────────────
        # Crash recovery: price >= rolling n-day high
        if crash_active and price >= hn:
            new_sh       = crash_cash / price
            shares      += new_sh
            crash_cash   = 0.0
            crash_active = False
            tlog.append((dates[t], "CRASH_REENTRY", price, new_sh, 0.0))

        # Trend recovery: price > MA200
        if trend_active and price > ma:
            new_sh       = trend_cash / price
            shares      += new_sh
            trend_cash   = 0.0
            trend_active = False
            tlog.append((dates[t], "TREND_REENTRY", price, new_sh, 0.0))

        # Deploy free cash when fully recovered and price > MA200
        if not crash_active and not trend_active and free_cash > 0 and price > ma:
            new_sh    = free_cash / price
            shares   += new_sh
            free_cash = 0.0
            tlog.append((dates[t], "DCA", price, new_sh, 0.0))

        total_cash   = crash_cash + trend_cash + free_cash
        equity[t]    = shares * price + total_cash
        cash_arr[t]  = total_cash

    rolling_peak = np.maximum.accumulate(equity)
    dd_nav       = (equity / rolling_peak) - 1.0
    metrics      = _compute_metrics(equity, dd_nav, dates)

    return {
        "name"        : "Hybrid_Crash_Trend",
        "label"       : "Hybrid (Crash+Trend)",
        "equity"      : equity,
        "dates"       : dates,
        "drawdown_nav": dd_nav,
        "cash"        : cash_arr,
        "trade_log"   : tlog,
        "metrics"     : metrics,
    }


def _compute_metrics(equity, dd_nav, dates):
    nav_returns = np.diff(equity) / equity[:-1]
    years       = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days / 365.25
    cagr        = (equity[-1] / equity[0]) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd      = float(dd_nav.min())
    sharpe      = (
        float(np.mean(nav_returns)) / float(np.std(nav_returns)) * np.sqrt(252)
        if np.std(nav_returns) > 0 else 0.0
    )
    trough_idx    = int(np.argmin(dd_nav))
    peak_nav      = float(equity[:trough_idx + 1].max())
    rec_idx       = next(
        (i for i in range(trough_idx, len(equity)) if equity[i] >= peak_nav), None
    )
    recovery_days = (rec_idx - trough_idx) if rec_idx is not None else -1
    return {
        "final_equity"  : float(equity[-1]),
        "cagr"          : cagr,
        "max_drawdown"  : max_dd,
        "sharpe"        : sharpe,
        "recovery_days" : recovery_days,
    }


# ── Episode analysis ──────────────────────────────────────────────────────────
def _compute_episode(res, ep_start, ep_end, global_idx_map):
    """Compute per-episode metrics from a strategy result."""
    dates  = pd.to_datetime(res['dates'])
    equity = res['equity']
    cash   = res['cash']
    ts     = pd.Timestamp(ep_start)
    te     = pd.Timestamp(ep_end)

    mask  = (dates >= ts) & (dates <= te)
    if mask.sum() == 0:
        return None

    ep_eq = equity[mask]
    ep_ca = cash[mask]
    ep_dt = dates[mask]
    ep_gi = np.where(mask)[0]   # global indices

    # max drawdown within episode
    roll_pk = np.maximum.accumulate(ep_eq)
    ep_dd   = (ep_eq / roll_pk) - 1.0
    max_dd  = float(ep_dd.min())
    trough_i = int(np.argmin(ep_dd))

    # recovery within episode
    pk_val  = float(ep_eq[:trough_i + 1].max())
    rec_i   = next((i for i in range(trough_i, len(ep_eq)) if ep_eq[i] >= pk_val), None)
    recov_d = (rec_i - trough_i) if rec_i is not None else -1

    # episode return
    ep_ret = float(ep_eq[-1] / ep_eq[0]) - 1.0

    # post-6m return
    g_end   = ep_gi[-1]
    p6m_g   = g_end + POST_6M_DAYS
    post_6m = float(equity[p6m_g] / equity[g_end]) - 1.0 if p6m_g < len(equity) else None

    # cash at trough
    cash_pct = float(ep_ca[trough_i] / ep_eq[trough_i]) * 100 if ep_eq[trough_i] > 0 else 0.0

    return {
        "max_dd"      : max_dd,
        "recovery_d"  : recov_d,
        "ep_ret"      : ep_ret,
        "post_6m"     : post_6m,
        "cash_pct"    : cash_pct,
        "trough_date" : ep_dt[trough_i],
    }


def _find_first_signal(res, ep_start, ep_end, strat_key):
    """Return (signal_date, signal_idx_in_res) for first exit within episode."""
    tags = EXIT_TAGS[strat_key]
    ts   = pd.Timestamp(ep_start)
    te   = pd.Timestamp(ep_end)
    for event in res['trade_log']:
        ev_date = pd.Timestamp(event[0])
        ev_tag  = event[1]
        if ts <= ev_date <= te and ev_tag in tags:
            return ev_date
    return None


def _compute_all_episodes(results, data):
    dates_g  = pd.to_datetime(data['date'].values)
    prices_g = data['close'].values
    dd_g     = data['drawdown'].values   # global rolling-peak drawdown

    # index map: timestamp -> position in data
    idx_map  = {d: i for i, d in enumerate(dates_g)}

    output = {}
    for ep_name, (ep_s, ep_e) in EPISODES.items():
        output[ep_name] = {}
        ts = pd.Timestamp(ep_s)
        te = pd.Timestamp(ep_e)

        # local price peak inside episode (for lag calculation)
        ep_mask   = (dates_g >= ts) & (dates_g <= te)
        ep_prices = prices_g[ep_mask]
        ep_dates  = dates_g[ep_mask]
        if len(ep_prices) == 0:
            continue
        local_peak_date = ep_dates[int(np.argmax(ep_prices))]

        for k, res in results.items():
            m = _compute_episode(res, ep_s, ep_e, idx_map)
            if m is None:
                continue

            sig_date = _find_first_signal(res, ep_s, ep_e, k)
            if sig_date is not None:
                m['signal_lag'] = (sig_date - local_peak_date).days
                sig_gi = idx_map.get(sig_date)
                m['dd_at_signal'] = float(dd_g[sig_gi]) if sig_gi is not None else None
            else:
                m['signal_lag']   = None
                m['dd_at_signal'] = None

            m['first_signal'] = sig_date
            output[ep_name][k] = m

    return output


# ── Print results ─────────────────────────────────────────────────────────────
def _print_results(ep_data, results):
    strats = list(results.keys())
    labels = {k: results[k]['label'] for k in strats}
    sep    = "-" * 80

    for ep_name in EPISODES:
        print(f"\n  [{ep_name}]  {EPISODES[ep_name][0]} -> {EPISODES[ep_name][1]}")
        print(f"  {'Metric':<24}" + "".join(f"{labels[k]:>18}" for k in strats))
        print(sep)

        ep = ep_data.get(ep_name, {})

        def row(label, fn):
            line = f"  {label:<24}"
            for k in strats:
                m = ep.get(k)
                line += f"{fn(m):>18}" if m else f"{'n/a':>18}"
            print(line)

        row("Max DD",          lambda m: f"{m['max_dd']*100:+.1f}%")
        row("Trough date",     lambda m: str(m['trough_date'].date()))
        row("Recovery(d)",     lambda m: f"{m['recovery_d']}d" if m['recovery_d'] >= 0 else "n/a")
        row("Episode return",  lambda m: f"{m['ep_ret']*100:+.1f}%")
        row("Post-6m return",  lambda m: f"{m['post_6m']*100:+.1f}%" if m['post_6m'] is not None else "n/a")
        row("Cash at trough",  lambda m: f"{m['cash_pct']:.1f}%")


def _print_signal_timing(ep_data, results):
    strats = list(results.keys())
    labels = {k: results[k]['label'] for k in strats}

    print("\n\n[5] Signal timing detail\n")
    print(f"  {'Episode':<22} {'Strategy':<22} {'First signal':>14} {'Lag(d)':>8} {'DD@signal':>12}")
    print("-" * 84)

    for ep_name in EPISODES:
        ep = ep_data.get(ep_name, {})
        first_row = True
        for k in strats:
            m   = ep.get(k, {})
            sig = m.get('first_signal')
            lag = m.get('signal_lag')
            dd  = m.get('dd_at_signal')

            ep_col  = ep_name if first_row else ""
            first_row = False
            sig_str = str(sig.date()) if sig is not None else "none"
            lag_str = f"{lag:+d}d"    if lag is not None else "---"
            dd_str  = f"{dd*100:+.1f}%" if dd is not None else "---"

            print(f"  {ep_col:<22} {labels[k]:<22} {sig_str:>14} {lag_str:>8} {dd_str:>12}")
        print()


# ── Charts ────────────────────────────────────────────────────────────────────
def _generate_charts(ep_data, results, data, out_dir):
    strats   = list(results.keys())
    labels   = {k: results[k]['label'] for k in strats}
    ep_names = list(EPISODES.keys())

    # ── Chart 1: Full equity + drawdown ───────────────────────────────────────
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    for k in strats:
        res = results[k]
        dt  = pd.to_datetime(res['dates'])
        ax1.plot(dt, res['equity'], color=COLORS[k], label=labels[k], linewidth=1.5)
        ax2.fill_between(dt, res['drawdown_nav'] * 100, 0,
                         color=COLORS[k], alpha=0.30, label=labels[k])
        ax2.plot(dt, res['drawdown_nav'] * 100, color=COLORS[k], linewidth=0.8)
    ax1.set_title("WO18 -- Full Equity Curve (2011-2026)", fontsize=13, fontweight='bold')
    ax1.set_ylabel("Portfolio Value ($)")
    ax1.legend(fontsize=10); ax1.grid(True, alpha=0.3)
    ax2.set_title("Portfolio Drawdown (%)")
    ax2.set_ylabel("Drawdown (%)"); ax2.set_xlabel("Date")
    ax2.legend(fontsize=10); ax2.grid(True, alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'equity_curve_wo18.png'), dpi=150)
    plt.close(fig)
    print("    equity_curve_wo18.png")

    # ── Chart 2: Episode equity (7-panel indexed) ─────────────────────────────
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
            if mask.sum() == 0:
                continue
            idx_arr = eq[mask]
            ax.plot(dt[mask], idx_arr / idx_arr[0] * 100,
                    color=COLORS[k], label=labels[k], linewidth=1.5)
        ax.axhline(100, color='gray', linewidth=0.6, linestyle='--')
        ax.set_title(ep_name, fontsize=11, fontweight='bold')
        ax.set_ylabel("Indexed (start=100)")
        ax.tick_params(axis='x', rotation=25)
        ax.legend(fontsize=8); ax.grid(True, alpha=0.3)
    for j in range(len(ep_names), len(axes)):
        axes[j].set_visible(False)
    plt.suptitle("WO18 -- Episode Equity by Crisis Period", fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'episode_equity_wo18.png'), dpi=150)
    plt.close(fig)
    print("    episode_equity_wo18.png")

    # ── Chart 3: Max DD heatmap ───────────────────────────────────────────────
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
            ax.text(j, i, f"{v:.1f}%", ha='center', va='center',
                    fontsize=9, fontweight='bold',
                    color='white' if v < -45 else 'black')
    plt.colorbar(im, ax=ax, label='Max Drawdown (%)')
    ax.set_title("WO18 -- Max Drawdown Heatmap by Episode", fontsize=13, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'dd_heatmap_wo18.png'), dpi=150)
    plt.close(fig)
    print("    dd_heatmap_wo18.png")

    # ── Chart 4: Cash at trough comparison ───────────────────────────────────
    x  = np.arange(len(ep_names))
    bw = 0.25
    fig, ax = plt.subplots(figsize=(14, 6))
    for i, k in enumerate(strats):
        vals = [ep_data.get(ep, {}).get(k, {}).get('cash_pct', 0.0) or 0.0
                for ep in ep_names]
        ax.bar(x + i * bw, vals, bw, label=labels[k], color=COLORS[k], alpha=0.85)
    ax.set_xticks(x + bw)
    ax.set_xticklabels(ep_names, rotation=20, ha='right')
    ax.set_ylabel("Cash at Trough (%)")
    ax.set_title("WO18 -- Cash at Trough by Episode", fontsize=13, fontweight='bold')
    ax.legend(); ax.grid(True, axis='y', alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'cash_at_trough_wo18.png'), dpi=150)
    plt.close(fig)
    print("    cash_at_trough_wo18.png")

    # ── Chart 5: Recovery days comparison ────────────────────────────────────
    fig, ax = plt.subplots(figsize=(14, 6))
    for i, k in enumerate(strats):
        vals = []
        for ep in ep_names:
            rd = ep_data.get(ep, {}).get(k, {}).get('recovery_d', -1)
            vals.append(rd if rd >= 0 else 0)
        ax.bar(x + i * bw, vals, bw, label=labels[k], color=COLORS[k], alpha=0.85)
    ax.set_xticks(x + bw)
    ax.set_xticklabels(ep_names, rotation=20, ha='right')
    ax.set_ylabel("Recovery Days")
    ax.set_title("WO18 -- Recovery Days by Episode", fontsize=13, fontweight='bold')
    ax.legend(); ax.grid(True, axis='y', alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'recovery_days_wo18.png'), dpi=150)
    plt.close(fig)
    print("    recovery_days_wo18.png")

    # ── Chart 6: Trigger activity (hybrid only) ───────────────────────────────
    hybrid_res = results['hybrid']
    tlog = hybrid_res['trade_log']
    tag_counts = {}
    for ev in tlog:
        tag = ev[1]
        tag_counts[tag] = tag_counts.get(tag, 0) + 1

    display_tags = ['CRASH_SELL', 'CRASH_REENTRY', 'TREND_SELL', 'TREND_REENTRY', 'DCA']
    counts = [tag_counts.get(t, 0) for t in display_tags]
    bar_colors = ['#cc4444', '#44cc88', '#cc8844', '#88aaff', '#aaaaaa']
    fig, ax = plt.subplots(figsize=(10, 5))
    bars = ax.bar(display_tags, counts, color=bar_colors, alpha=0.85, edgecolor='black')
    for bar, cnt in zip(bars, counts):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                str(cnt), ha='center', va='bottom', fontsize=11, fontweight='bold')
    ax.set_ylabel("Event Count (2011-2026)")
    ax.set_title("WO18 -- Hybrid Strategy Trigger Activity", fontsize=13, fontweight='bold')
    ax.grid(True, axis='y', alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'hybrid_triggers_wo18.png'), dpi=150)
    plt.close(fig)
    print("    hybrid_triggers_wo18.png")


# ── Main ──────────────────────────────────────────────────────────────────────
def run_wo18():
    print("=" * 72)
    print("  WO18 -- Hybrid Crash + Trend Strategy Test")
    print("  7 episodes  x  3 strategies")
    print("=" * 72)

    dirname = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
    root    = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
    out_dir = os.path.join(root, 'vr_backtest', 'results', 'charts')
    met_dir = os.path.join(root, 'vr_backtest', 'results', 'metrics')
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(met_dir, exist_ok=True)

    print("\n[1] Loading TQQQ data ...")
    data = load_tqqq()
    print(f"    {len(data)} trading days  ({data['date'].iloc[0]} -> {data['date'].iloc[-1]})")

    print("\n[2] Running 3 strategies (full history) ...")
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

    print("    hybrid ...")
    r = run_hybrid_strategy(data)
    results['hybrid'] = r

    # ── overall metrics ───────────────────────────────────────────────────────
    print("\n[3] Overall metrics (full history 2011-2026)")
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

    # ── trigger counts (hybrid) ───────────────────────────────────────────────
    print("\n[4] Hybrid trigger activity (full history)")
    tlog = results['hybrid']['trade_log']
    tag_counts = {}
    for ev in tlog:
        tag_counts[ev[1]] = tag_counts.get(ev[1], 0) + 1
    for tag in ['CRASH_SELL', 'CRASH_REENTRY', 'TREND_SELL', 'TREND_REENTRY', 'DCA']:
        print(f"  {tag:<20}: {tag_counts.get(tag, 0)}")

    # ── episode analysis ──────────────────────────────────────────────────────
    print("\n\n[5] Episode analysis")
    ep_data = _compute_all_episodes(results, data)
    _print_results(ep_data, results)
    _print_signal_timing(ep_data, results)

    # ── charts ────────────────────────────────────────────────────────────────
    print("\n[6] Generating charts ...")
    _generate_charts(ep_data, results, data, out_dir)
    print(f"    Charts saved to: {out_dir}")

    print(f"\n[7] Done")
    print("=" * 72)


if __name__ == '__main__':
    run_wo18()
