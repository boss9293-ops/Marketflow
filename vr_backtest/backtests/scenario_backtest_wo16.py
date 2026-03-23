"""
vr_backtest/backtests/scenario_backtest_wo16.py
================================================
WO16: Crash Trigger Timing Optimization

Variants (Far regime, sell 50%):
  A  MA120  4d  -15%  (WO14/15 baseline)
  B  MA150  4d  -12%  (slightly earlier)
  C  MA120  3d  -12%  (earlier speed detection)
  D  MA150  3d  -10%  (early crash signal)

Charts:
  equity_curve_wo16.png
  drawdown_curve_wo16.png
  trigger_timing_wo16.png
  crash_period_comparison_wo16.png

Usage
-----
python -m vr_backtest.backtests.scenario_backtest_wo16
"""
from __future__ import annotations

import os
import sys
import json
import datetime

import numpy as np
import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, '..', '..'))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from vr_backtest.data.loader                     import load_tqqq
from vr_backtest.strategies.buy_hold             import run_buy_hold
from vr_backtest.strategies.ma200_strategy       import run_ma200_strategy
from vr_backtest.strategies.ma200_bottom_buy     import run_ma200_bottom_buy
from vr_backtest.strategies.adaptive_ma_strategy import run_adaptive_ma


CRASH_PERIODS = {
    '2018 Volatility': ('2018-09-01', '2019-06-30'),
    '2020 COVID':      ('2020-02-01', '2020-12-31'),
    '2022 Tightening': ('2021-11-01', '2023-06-30'),
}

RESULTS_DIR = os.path.join(_ROOT, 'vr_backtest', 'results')
CHARTS_DIR  = os.path.join(RESULTS_DIR, 'charts')
METRICS_DIR = os.path.join(RESULTS_DIR, 'metrics')

# Variant definitions
VARIANTS = {
    'A': dict(far_crash_ma_col='ma120', far_crash_speed_col='speed4',
              far_crash_speed_thr=-0.15, label='Var A  MA120/4d/-15%'),
    'B': dict(far_crash_ma_col='ma150', far_crash_speed_col='speed4',
              far_crash_speed_thr=-0.12, label='Var B  MA150/4d/-12%'),
    'C': dict(far_crash_ma_col='ma120', far_crash_speed_col='speed3',
              far_crash_speed_thr=-0.12, label='Var C  MA120/3d/-12%'),
    'D': dict(far_crash_ma_col='ma150', far_crash_speed_col='speed3',
              far_crash_speed_thr=-0.10, label='Var D  MA150/3d/-10%'),
}

COLOURS = {
    'buy_hold':  '#9E9E9E',
    'ma200':     '#FF9800',
    'ma200_bb':  '#2196F3',
    'adapt_A':   '#4CAF50',
    'adapt_B':   '#E91E63',
    'adapt_C':   '#FF5722',
    'adapt_D':   '#9C27B0',
}
LABELS = {
    'buy_hold':  'Buy & Hold',
    'ma200':     'MA200',
    'ma200_bb':  'MA200 + Bottom Buy',
    'adapt_A':   'Var A  MA120/4d/-15%',
    'adapt_B':   'Var B  MA150/4d/-12%',
    'adapt_C':   'Var C  MA120/3d/-12%',
    'adapt_D':   'Var D  MA150/3d/-10%',
}


def main():
    SEP = '=' * 72
    print(SEP)
    print('  WO16 -- Crash Trigger Timing Optimization')
    print('  Period: 2011-01-03 to 2026-03-13  |  Far sell = 50%')
    print(SEP)

    print('\n[1] Loading TQQQ data ...')
    data = load_tqqq(start='2011-01-01')
    print(f'    {len(data)} trading days  '
          f'({data["date"].iloc[0].date()} -> {data["date"].iloc[-1].date()})')

    print('\n[2] Running 7 strategies ...')
    results = {}
    runners = [
        ('buy_hold',  lambda d: run_buy_hold(d)),
        ('ma200',     lambda d: run_ma200_strategy(d)),
        ('ma200_bb',  lambda d: run_ma200_bottom_buy(d)),
    ]
    for v_key, v_cfg in VARIANTS.items():
        k = f'adapt_{v_key}'
        cfg = {k_: v_ for k_, v_ in v_cfg.items() if k_ != 'label'}
        runners.append((k, (lambda d, c=cfg: run_adaptive_ma(d, far_sell_pct=0.50, **c))))

    for key, runner in runners:
        print(f'    {key} ...')
        r = runner(data)
        r['label'] = LABELS[key]
        results[key] = r

    print('\n[3] Summary')
    _print_summary(results)

    print('\n[4] Trigger activity')
    _print_trigger_counts(results)

    print('\n[5] Crash Trigger Timing Analysis')
    _print_timing_analysis(results, data)

    print('\n[6] Crash Period Analysis')
    _print_crash_analysis(results, data)

    print('\n[7] Generating charts ...')
    try:
        _generate_charts(results, data)
        print(f'    Charts saved to: {CHARTS_DIR}')
    except Exception as e:
        import traceback
        print(f'    Chart error: {e}')
        traceback.print_exc()

    _save_metrics(results)
    print(f'\n[8] Metrics saved to: {METRICS_DIR}')
    print('\n' + SEP)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def _print_summary(results):
    SEP = '-' * 72
    hdr = (f'  {"Strategy":<26} {"Final $":>11}  {"CAGR":>7}  '
           f'{"Max DD":>7}  {"Sharpe":>7}  {"Recov(d)":>9}')
    print(SEP)
    print(hdr)
    print(SEP)
    for key, res in results.items():
        m    = res['metrics']
        rec  = m['recovery_days']
        rstr = f'{rec:>9}' if rec >= 0 else '      n/a'
        print(
            f'  {res["label"]:<26}'
            f' ${m["final_equity"]:>10,.0f}'
            f'  {m["cagr"]:>7.1%}'
            f'  {m["max_drawdown"]:>7.1%}'
            f'  {m["sharpe"]:>7.2f}'
            f'  {rstr}'
        )
    print(SEP)


# ---------------------------------------------------------------------------
# Trigger counts
# ---------------------------------------------------------------------------

def _count(tl, *types):
    return sum(1 for e in tl if e[1] in types)


def _print_trigger_counts(results):
    SEP = '-' * 72
    print(f'  {"Strategy":<26}  {"NEAR":>5}  {"MED":>5}  {"FAR-C":>6}  '
          f'{"FAR-T":>6}  {"BB40":>5}  {"BB50":>5}  {"RE":>5}')
    print(SEP)
    for key, res in results.items():
        tl = res['trade_log']
        print(
            f'  {res["label"]:<26}'
            f'  {_count(tl, "NEAR_EXIT"):>5}'
            f'  {_count(tl, "MED_EXIT"):>5}'
            f'  {_count(tl, "FAR_CRASH_SELL"):>6}'
            f'  {_count(tl, "FAR_TREND_SELL"):>6}'
            f'  {_count(tl, "BOTTOM_BUY_40"):>5}'
            f'  {_count(tl, "BOTTOM_BUY_50"):>5}'
            f'  {_count(tl, "MA200_ENTRY"):>5}'
        )


# ---------------------------------------------------------------------------
# Timing analysis
# ---------------------------------------------------------------------------

def _print_timing_analysis(results, data):
    dist_arr  = data['distance200'].values
    dates_arr = data['date'].values
    date_to_idx = {d: i for i, d in enumerate(dates_arr)}

    adapt_keys = [k for k in results if k.startswith('adapt_')]
    SEP = '-' * 72

    print(f'\n  {"Strategy":<26}  {"FAR-C":>5}  {"Avg dist":>9}  '
          f'{"Min dist":>9}  {"Max dist":>9}  {"Avg recov(d)":>13}')
    print(SEP)
    for key in adapt_keys:
        res = results[key]
        tl  = res['trade_log']
        far_sells  = [(e[0], e[2]) for e in tl if e[1] == 'FAR_CRASH_SELL']
        entries    = [e[0] for e in tl if e[1] == 'MA200_ENTRY']
        dists, recovs = [], []

        for sell_date, _ in far_sells:
            idx = date_to_idx.get(sell_date)
            if idx is not None:
                dists.append(dist_arr[idx])
            sell_ts = pd.Timestamp(sell_date)
            future  = [pd.Timestamp(e) for e in entries if pd.Timestamp(e) > sell_ts]
            if future:
                recovs.append((min(future) - sell_ts).days)

        n      = len(far_sells)
        avg_d  = f'{float(np.mean(dists)):+.1%}'  if dists  else 'n/a'
        min_d  = f'{float(np.min(dists)):+.1%}'   if dists  else 'n/a'
        max_d  = f'{float(np.max(dists)):+.1%}'   if dists  else 'n/a'
        avg_r  = f'{float(np.mean(recovs)):.0f}d' if recovs else 'n/a'
        print(
            f'  {res["label"]:<26}'
            f'  {n:>5}'
            f'  {avg_d:>9}'
            f'  {min_d:>9}'
            f'  {max_d:>9}'
            f'  {avg_r:>13}'
        )

    # Per-event table for all variants
    print(f'\n  FAR_CRASH_SELL event detail (all variants):')
    print(f'  {"Date":<12}  {"Price":>8}  {"Dist200":>9}  {"Variant"}')
    print(SEP)
    for key in adapt_keys:
        tl = results[key]['trade_log']
        vname = results[key]['label'][:18]
        for e in tl:
            if e[1] == 'FAR_CRASH_SELL':
                idx  = date_to_idx.get(e[0])
                dist = dist_arr[idx] if idx is not None else float('nan')
                print(
                    f'  {str(pd.Timestamp(e[0]).date()):<12}'
                    f'  {e[2]:>8.2f}'
                    f'  {dist:>+9.1%}'
                    f'  {vname}'
                )


# ---------------------------------------------------------------------------
# Crash period analysis
# ---------------------------------------------------------------------------

def _print_crash_analysis(results, data):
    SEP = '-' * 72
    for period_name, (start, end) in CRASH_PERIODS.items():
        mask  = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        idx_s = data.index[mask][0]
        idx_e = data.index[mask][-1]
        print(f'\n  {period_name}  ({start} -> {end})')
        print(f'  {"Strategy":<26} {"Period DD":>10}  {"Recovery(d)":>12}  {"End Equity":>12}')
        print(SEP)
        for key, res in results.items():
            eq   = res['equity'][idx_s:idx_e + 1]
            if len(eq) == 0:
                continue
            peak      = float(res['equity'][:idx_s + 1].max()) if idx_s > 0 else eq[0]
            trough    = float(eq.min())
            period_dd = (trough / peak) - 1.0 if peak > 0 else 0.0
            end_eq    = float(res['equity'][idx_e])
            trough_rel = int(np.argmin(eq))
            rec_days   = -1
            for i in range(trough_rel, len(eq)):
                if eq[i] >= peak:
                    rec_days = i - trough_rel
                    break
            rstr = f'{rec_days:>11}' if rec_days >= 0 else '        n/a'
            print(
                f'  {res["label"]:<26}'
                f' {period_dd:>10.1%}'
                f'  {rstr}'
                f'  ${end_eq:>11,.0f}'
            )


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def _generate_charts(results, data):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    from matplotlib.gridspec import GridSpec

    os.makedirs(CHARTS_DIR, exist_ok=True)
    dates    = pd.to_datetime(data['date'].values)
    dist_arr = data['distance200'].values

    keys_all    = ['buy_hold', 'ma200', 'ma200_bb', 'adapt_A', 'adapt_B', 'adapt_C', 'adapt_D']
    keys_adapt  = ['adapt_A', 'adapt_B', 'adapt_C', 'adapt_D']
    date_to_idx = {d: i for i, d in enumerate(data['date'].values)}

    def shade_crashes(ax):
        for _, (s, e) in CRASH_PERIODS.items():
            ax.axvspan(pd.Timestamp(s), pd.Timestamp(e), alpha=0.07, color='red')

    def fmt_ax(ax, ylabel='', legend=True):
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
        ax.xaxis.set_major_locator(mdates.YearLocator(2))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha='right')
        if ylabel:
            ax.set_ylabel(ylabel)
        if legend:
            ax.legend(fontsize=9)

    # ---- Chart 1: Equity (log + linear) ----
    fig, axes = plt.subplots(2, 1, figsize=(14, 11), sharex=True)
    for k in keys_all:
        if k not in results:
            continue
        lw = 2.0 if k in keys_adapt else 1.2
        ls = '-'  if k in keys_adapt else '--'
        axes[0].semilogy(dates, results[k]['equity'],
                         label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
        axes[1].plot(dates, results[k]['equity'],
                     label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
    for ax in axes:
        shade_crashes(ax)
        fmt_ax(ax, ylabel='Portfolio Value ($)')
    axes[0].set_title('Equity Curves (log) -- WO16', fontsize=12, fontweight='bold')
    axes[1].set_title('Equity Curves (linear) -- WO16', fontsize=12, fontweight='bold')
    fig.suptitle('WO16 -- Crash Trigger Timing: Equity', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'equity_curve_wo16.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 2: Drawdown ----
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    for k in keys_all:
        if k not in results:
            continue
        lw = 1.8 if k in keys_adapt else 1.1
        ls = '-'  if k in keys_adapt else '--'
        axes[0].plot(dates, results[k]['drawdown_nav'] * 100,
                     label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
    axes[0].set_title('NAV Drawdown -- All Strategies', fontsize=12, fontweight='bold')
    shade_crashes(axes[0])
    fmt_ax(axes[0], ylabel='Drawdown (%)')

    for k in keys_adapt:
        if k not in results:
            continue
        axes[1].plot(dates, results[k]['drawdown_nav'] * 100,
                     label=LABELS[k], color=COLOURS[k], linewidth=2.0)
    axes[1].set_title('NAV Drawdown -- Adaptive Variants Only', fontsize=12, fontweight='bold')
    shade_crashes(axes[1])
    fmt_ax(axes[1], ylabel='Drawdown (%)')
    fig.suptitle('WO16 -- Crash Trigger Timing: Drawdown', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'drawdown_curve_wo16.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 3: Trigger Timing Analysis (4-panel) ----
    fig = plt.figure(figsize=(18, 13))
    gs  = GridSpec(2, 2, figure=fig, hspace=0.50, wspace=0.38)
    ax1 = fig.add_subplot(gs[0, :])   # wide top: TQQQ + MA lines + all FAR_CRASH_SELL events
    ax2 = fig.add_subplot(gs[1, 0])   # bar: dist200 at sell per variant
    ax3 = fig.add_subplot(gs[1, 1])   # metric bars: CAGR / MaxDD / Sharpe

    # Panel 1: Price + MA lines + FAR_CRASH_SELL scatter per variant
    ax1.semilogy(dates, data['close'].values, color='#212121', linewidth=0.8,
                 label='TQQQ', alpha=0.8, zorder=2)
    ax1.semilogy(dates, data['ma200'].values, color='#FF5722', linewidth=1.4,
                 linestyle='--', label='MA200', alpha=0.7)
    ax1.semilogy(dates, data['ma150'].values, color='#FF9800', linewidth=1.1,
                 linestyle='--', label='MA150', alpha=0.7)
    ax1.semilogy(dates, data['ma120'].values, color='#FFC107', linewidth=0.9,
                 linestyle='--', label='MA120', alpha=0.7)

    markers = {'adapt_A': ('v', 80), 'adapt_B': ('^', 80),
               'adapt_C': ('s', 70), 'adapt_D': ('D', 70)}
    for k in keys_adapt:
        if k not in results:
            continue
        tl  = results[k]['trade_log']
        pts = [(pd.Timestamp(e[0]), e[2]) for e in tl if e[1] == 'FAR_CRASH_SELL']
        if pts:
            xs, ys = zip(*pts)
            mk, sz = markers.get(k, ('o', 60))
            ax1.scatter(xs, ys, color=COLOURS[k], marker=mk, s=sz + 20,
                        zorder=6, label=f'{LABELS[k]} FAR sell', edgecolors='white', linewidths=0.5)

    ax1.set_title('FAR_CRASH_SELL Triggers on TQQQ Price (log scale)', fontsize=12, fontweight='bold')
    ax1.set_ylabel('Price ($)')
    ax1.legend(fontsize=8, ncol=4)
    ax1.grid(True, alpha=0.3)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
    ax1.xaxis.set_major_locator(mdates.YearLocator(2))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=30, ha='right')
    shade_crashes(ax1)

    # Panel 2: Distance200 at each FAR_CRASH_SELL event, grouped by variant
    bar_data = {}
    for k in keys_adapt:
        if k not in results:
            continue
        tl  = results[k]['trade_log']
        far = [(e[0], dist_arr[date_to_idx[e[0]]]) for e in tl
               if e[1] == 'FAR_CRASH_SELL' and e[0] in date_to_idx]
        bar_data[k] = [d * 100 for _, d in far]

    max_events = max((len(v) for v in bar_data.values()), default=1)
    x   = np.arange(max_events)
    w   = 0.20
    for i, k in enumerate(keys_adapt):
        if k not in bar_data or not bar_data[k]:
            continue
        vals = bar_data[k]
        xi   = np.arange(len(vals))
        ax2.bar(xi + (i - 1.5) * w, vals, w,
                color=COLOURS[k], label=LABELS[k][:18], alpha=0.85)
    ax2.axhline(0,  color='black',  linewidth=1.0, linestyle='-')
    ax2.axhline(30, color='#F44336', linewidth=1.0, linestyle='--', alpha=0.6, label='Far threshold (30%)')
    ax2.set_title('Distance200 (%) at Each FAR_CRASH_SELL Event', fontsize=11, fontweight='bold')
    ax2.set_xlabel('Event index')
    ax2.set_ylabel('Distance200 (%)')
    ax2.legend(fontsize=8)
    ax2.grid(True, alpha=0.3, axis='y')

    # Panel 3: Metric comparison for adapt variants
    var_labels = ['A\nMA120\n4d-15%', 'B\nMA150\n4d-12%', 'C\nMA120\n3d-12%', 'D\nMA150\n3d-10%']
    cagrs  = [results[k]['metrics']['cagr'] * 100         for k in keys_adapt if k in results]
    maxdds = [abs(results[k]['metrics']['max_drawdown']) * 100 for k in keys_adapt if k in results]
    sharpes= [results[k]['metrics']['sharpe']             for k in keys_adapt if k in results]
    x3  = np.arange(len(var_labels))
    w3  = 0.25
    b1  = ax3.bar(x3 - w3, cagrs,   w3, label='CAGR (%)',    color='#4CAF50', alpha=0.85)
    b2  = ax3.bar(x3,       maxdds,  w3, label='Max DD (abs%)', color='#F44336', alpha=0.85)
    b3  = ax3.bar(x3 + w3,  sharpes, w3, label='Sharpe',       color='#2196F3', alpha=0.85)
    ax3.set_xticks(x3)
    ax3.set_xticklabels(var_labels, fontsize=9)
    ax3.set_title('Metric Comparison -- Adaptive Variants', fontsize=11, fontweight='bold')
    ax3.legend(fontsize=9)
    ax3.grid(True, alpha=0.3, axis='y')
    for xi, (c, d, s) in enumerate(zip(cagrs, maxdds, sharpes)):
        ax3.text(xi - w3, c + 0.2, f'{c:.1f}', ha='center', va='bottom', fontsize=8)
        ax3.text(xi,      d + 0.2, f'{d:.1f}', ha='center', va='bottom', fontsize=8)
        ax3.text(xi + w3, s + 0.1, f'{s:.2f}', ha='center', va='bottom', fontsize=8)

    fig.suptitle('WO16 -- Trigger Timing Analysis', fontsize=14, fontweight='bold')
    fig.savefig(os.path.join(CHARTS_DIR, 'trigger_timing_wo16.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 4: Crash Period Comparison ----
    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    for col, (period_name, (start, end)) in enumerate(CRASH_PERIODS.items()):
        mask = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        sub_dates = dates[mask]
        for k in keys_all:
            if k not in results:
                continue
            lw = 2.0 if k in keys_adapt else 1.2
            ls = '-'  if k in keys_adapt else '--'
            eq_sl = results[k]['equity'][mask.values]
            dd_sl = results[k]['drawdown_nav'][mask.values]
            if len(eq_sl) == 0:
                continue
            axes[0, col].plot(sub_dates, eq_sl / eq_sl[0] * 100,
                              label=LABELS[k], color=COLOURS[k], lw=lw, linestyle=ls)
            axes[1, col].plot(sub_dates, dd_sl * 100,
                              label=LABELS[k], color=COLOURS[k], lw=lw, linestyle=ls)
        for row in range(2):
            ax = axes[row, col]
            ax.set_title(f'{period_name}' + ('\n(indexed)' if row == 0 else '\n(drawdown)'),
                         fontsize=10, fontweight='bold')
            ax.legend(fontsize=7)
            ax.grid(True, alpha=0.3)
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
            ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
            plt.setp(ax.xaxis.get_majorticklabels(), rotation=40, ha='right')
        axes[0, col].set_ylabel('Indexed (start=100)')
        axes[1, col].set_ylabel('DD (%)')
    fig.suptitle('WO16 -- Crash Period Comparison', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'crash_period_comparison_wo16.png'), dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Save metrics
# ---------------------------------------------------------------------------

def _save_metrics(results):
    os.makedirs(METRICS_DIR, exist_ok=True)
    summary = {res['name']: res['metrics'].copy() for res in results.values()}
    ts   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(METRICS_DIR, f'wo16_metrics_{ts}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)


if __name__ == '__main__':
    main()
