"""
vr_backtest/backtests/scenario_backtest_wo15.py
================================================
WO15: Far Regime Sell Fraction Study

Tests three Adaptive MA Distance variants:
  50%  (WO14 baseline)
  70%
  100% (full exit)

Plus baselines: BuyHold, MA200, MA200+BottomBuy

Charts:
  equity_curve_wo15.png
  drawdown_curve_wo15.png
  far_sell_analysis_wo15.png
  crash_period_comparison_wo15.png

Usage
-----
python -m vr_backtest.backtests.scenario_backtest_wo15
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

COLOURS = {
    'buy_hold':    '#9E9E9E',
    'ma200':       '#FF9800',
    'ma200_bb':    '#2196F3',
    'adapt_50':    '#8BC34A',
    'adapt_70':    '#E91E63',
    'adapt_100':   '#9C27B0',
}
LABELS = {
    'buy_hold':    'Buy & Hold',
    'ma200':       'MA200',
    'ma200_bb':    'MA200 + Bottom Buy',
    'adapt_50':    'Adaptive MA 50%',
    'adapt_70':    'Adaptive MA 70%',
    'adapt_100':   'Adaptive MA 100%',
}


def main():
    SEP = '=' * 72
    print(SEP)
    print('  WO15 -- Far Regime Sell Fraction Study')
    print('  Period: 2011-01-03 to 2026-03-13')
    print(SEP)

    print('\n[1] Loading TQQQ data ...')
    data = load_tqqq(start='2011-01-01')
    print(f'    {len(data)} trading days  '
          f'({data["date"].iloc[0].date()} -> {data["date"].iloc[-1].date()})')

    print('\n[2] Running 6 strategies ...')
    results = {}
    runners = [
        ('buy_hold',  lambda d: run_buy_hold(d)),
        ('ma200',     lambda d: run_ma200_strategy(d)),
        ('ma200_bb',  lambda d: run_ma200_bottom_buy(d)),
        ('adapt_50',  lambda d: run_adaptive_ma(d, far_sell_pct=0.50)),
        ('adapt_70',  lambda d: run_adaptive_ma(d, far_sell_pct=0.70)),
        ('adapt_100', lambda d: run_adaptive_ma(d, far_sell_pct=1.00)),
    ]
    for key, runner in runners:
        print(f'    {key} ...')
        r = runner(data)
        r['label'] = LABELS[key]
        results[key] = r

    print('\n[3] Summary')
    _print_summary(results)

    print('\n[4] Trigger activity')
    _print_trigger_counts(results)

    print('\n[5] Far Regime Analysis')
    _print_far_analysis(results, data)

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
    hdr = (f'  {"Strategy":<24} {"Final $":>11}  {"CAGR":>7}  '
           f'{"Max DD":>7}  {"Sharpe":>7}  {"Recov(d)":>9}')
    print(SEP)
    print(hdr)
    print(SEP)
    for key, res in results.items():
        m    = res['metrics']
        rec  = m['recovery_days']
        rstr = f'{rec:>9}' if rec >= 0 else '      n/a'
        print(
            f'  {res["label"]:<24}'
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
    print(f'  {"Strategy":<24}  {"NEAR":>5}  {"MED":>5}  {"FAR-C":>6}  '
          f'{"FAR-T":>6}  {"BB40":>5}  {"BB50":>5}  {"BB60":>5}  {"RE":>5}')
    print(SEP)
    for key, res in results.items():
        tl = res['trade_log']
        print(
            f'  {res["label"]:<24}'
            f'  {_count(tl, "NEAR_EXIT"):>5}'
            f'  {_count(tl, "MED_EXIT"):>5}'
            f'  {_count(tl, "FAR_CRASH_SELL"):>6}'
            f'  {_count(tl, "FAR_TREND_SELL"):>6}'
            f'  {_count(tl, "BOTTOM_BUY_40"):>5}'
            f'  {_count(tl, "BOTTOM_BUY_50"):>5}'
            f'  {_count(tl, "BOTTOM_BUY_60"):>5}'
            f'  {_count(tl, "MA200_ENTRY"):>5}'
        )


# ---------------------------------------------------------------------------
# Far regime analysis
# ---------------------------------------------------------------------------

def _print_far_analysis(results, data):
    dist  = data['distance200'].values
    dates = data['date'].values

    # Regime frequency
    far_days = float(np.mean(dist > 0.30))
    print(f'\n  Regime frequency:')
    print(f'    Far zone (dist > 30%) : {far_days:.1%} of trading days')
    print(f'    Max dist200           : {float(dist.max()):+.1%}')
    print(f'    Avg dist200           : {float(dist.mean()):+.1%}')

    # Build date → dist lookup
    date_to_idx = {d: i for i, d in enumerate(dates)}

    adapt_keys = ['adapt_50', 'adapt_70', 'adapt_100']
    print(f'\n  Per-variant Far crash metrics:')
    print(f'  {"Strategy":<24}  {"FAR-C":>5}  {"Avg dist at sell":>16}  {"Avg recov(d)":>13}')
    SEP = '-' * 65
    print(SEP)
    for key in adapt_keys:
        if key not in results:
            continue
        tl = results[key]['trade_log']

        # FAR_CRASH_SELL events with distance at sell date
        far_sells = [(e[0], e[2]) for e in tl if e[1] == 'FAR_CRASH_SELL']
        entries   = [e[0] for e in tl if e[1] == 'MA200_ENTRY']

        dists_at_sell = []
        recov_days    = []

        for sell_date, sell_price in far_sells:
            # distance at sell date
            idx = date_to_idx.get(sell_date)
            if idx is not None:
                dists_at_sell.append(dist[idx])

            # recovery: days until next MA200_ENTRY after this sell
            sell_ts = pd.Timestamp(sell_date)
            future_entries = [pd.Timestamp(e) for e in entries if pd.Timestamp(e) > sell_ts]
            if future_entries:
                next_entry = min(future_entries)
                # compute calendar days
                gap = (next_entry - sell_ts).days
                recov_days.append(gap)

        n_far   = len(far_sells)
        avg_d   = float(np.mean(dists_at_sell)) if dists_at_sell else float('nan')
        avg_r   = float(np.mean(recov_days))    if recov_days    else float('nan')
        avg_r_s = f'{avg_r:.0f}d' if not np.isnan(avg_r) else 'n/a'
        avg_d_s = f'{avg_d:+.1%}' if not np.isnan(avg_d) else 'n/a'

        print(
            f'  {results[key]["label"]:<24}'
            f'  {n_far:>5}'
            f'  {avg_d_s:>16}'
            f'  {avg_r_s:>13}'
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
        print(f'  {"Strategy":<24} {"Period DD":>10}  {"Recovery(d)":>12}  {"End Equity":>12}')
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
                f'  {res["label"]:<24}'
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
    dates = pd.to_datetime(data['date'].values)
    dist  = data['distance200'].values

    keys_all    = ['buy_hold', 'ma200', 'ma200_bb', 'adapt_50', 'adapt_70', 'adapt_100']
    keys_adapt  = ['adapt_50', 'adapt_70', 'adapt_100']

    def shade_crashes(ax):
        for _, (s, e) in CRASH_PERIODS.items():
            ax.axvspan(pd.Timestamp(s), pd.Timestamp(e), alpha=0.07, color='red')

    def fmt_ax(ax, ylabel=''):
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
        ax.xaxis.set_major_locator(mdates.YearLocator(2))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha='right')
        if ylabel:
            ax.set_ylabel(ylabel)

    # ---- Chart 1: Equity Curves (log + linear) ----
    fig, axes = plt.subplots(2, 1, figsize=(14, 11), sharex=True)
    for k in keys_all:
        if k not in results:
            continue
        lw = 2.0 if k in keys_adapt else 1.3
        ls = '-'  if k in keys_adapt else '--'
        axes[0].semilogy(dates, results[k]['equity'],
                         label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
        axes[1].plot(dates, results[k]['equity'],
                     label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
    for ax in axes:
        ax.legend(fontsize=10)
        shade_crashes(ax)
        fmt_ax(ax, ylabel='Portfolio Value ($)')
    axes[0].set_title('Equity Curves (log scale) -- WO15', fontsize=12, fontweight='bold')
    axes[1].set_title('Equity Curves (linear) -- WO15', fontsize=12, fontweight='bold')
    fig.suptitle('WO15 -- Far Regime Sell Fraction: Equity', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'equity_curve_wo15.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 2: Drawdown ----
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    # top: all 6 strategies
    for k in keys_all:
        if k not in results:
            continue
        lw = 1.8 if k in keys_adapt else 1.2
        ls = '-'  if k in keys_adapt else '--'
        axes[0].plot(dates, results[k]['drawdown_nav'] * 100,
                     label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
    axes[0].set_title('NAV Drawdown -- All Strategies', fontsize=12, fontweight='bold')
    axes[0].legend(fontsize=10)
    shade_crashes(axes[0])
    fmt_ax(axes[0], ylabel='Drawdown (%)')
    # bottom: just the 3 adaptive variants
    for k in keys_adapt:
        if k not in results:
            continue
        axes[1].plot(dates, results[k]['drawdown_nav'] * 100,
                     label=LABELS[k], color=COLOURS[k], linewidth=2.0)
    axes[1].fill_between(dates, results['adapt_100']['drawdown_nav'] * 100, 0,
                         alpha=0.06, color=COLOURS['adapt_100'])
    axes[1].set_title('NAV Drawdown -- Adaptive Variants Only', fontsize=12, fontweight='bold')
    axes[1].legend(fontsize=11)
    shade_crashes(axes[1])
    fmt_ax(axes[1], ylabel='Drawdown (%)')
    fig.suptitle('WO15 -- Far Regime Sell Fraction: Drawdown', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'drawdown_curve_wo15.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 3: Far Sell Analysis (4-panel) ----
    fig = plt.figure(figsize=(16, 12))
    gs  = GridSpec(2, 2, figure=fig, hspace=0.45, wspace=0.35)
    ax1 = fig.add_subplot(gs[0, 0])   # dist200 over time with Far regime shading
    ax2 = fig.add_subplot(gs[0, 1])   # scatter: dist at FAR_CRASH_SELL for each variant
    ax3 = fig.add_subplot(gs[1, 0])   # bar: metric comparison (CAGR/MaxDD/Sharpe)
    ax4 = fig.add_subplot(gs[1, 1])   # bar: crash-period drawdown comparison

    # Panel 1: Distance200 time series with Far zone shaded
    ax1.plot(dates, dist * 100, color='#333333', linewidth=0.9, label='Distance200')
    ax1.fill_between(dates, dist * 100, 0, where=dist > 0.30,
                     alpha=0.20, color='red', label='Far zone (>30%)')
    ax1.fill_between(dates, dist * 100, 0, where=(dist > 0.15) & (dist <= 0.30),
                     alpha=0.12, color='orange', label='Medium (15-30%)')
    ax1.fill_between(dates, dist * 100, 0, where=dist < 0,
                     alpha=0.15, color='blue', label='Below MA200')
    ax1.axhline(15, color='#FF9800', linewidth=1.2, linestyle='--', alpha=0.7)
    ax1.axhline(30, color='#F44336', linewidth=1.2, linestyle='--', alpha=0.7)
    ax1.set_title('Distance200 Over Time', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Distance (%)')
    ax1.legend(fontsize=8)
    ax1.grid(True, alpha=0.3)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
    ax1.xaxis.set_major_locator(mdates.YearLocator(3))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=30, ha='right')
    shade_crashes(ax1)

    # Panel 2: FAR_CRASH_SELL event prices for each variant
    adapt_colours = [COLOURS['adapt_50'], COLOURS['adapt_70'], COLOURS['adapt_100']]
    adapt_labels  = ['50%', '70%', '100%']
    ax2.plot(dates, data['close'].values, color='#212121', linewidth=0.8, label='TQQQ', alpha=0.7)
    ax2.plot(dates, data['ma120'].values, color='#FFC107', linewidth=1.0,
             linestyle='--', label='MA120', alpha=0.8)
    for key, col, lbl in zip(keys_adapt, adapt_colours, adapt_labels):
        if key not in results:
            continue
        tl = results[key]['trade_log']
        pts = [(pd.Timestamp(e[0]), e[2]) for e in tl if e[1] == 'FAR_CRASH_SELL']
        if pts:
            xs, ys = zip(*pts)
            ax2.scatter(xs, ys, color=col, s=70, marker='v', zorder=5, label=f'FAR sell {lbl}')
    ax2.set_title('FAR_CRASH_SELL Event Prices', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Price ($)')
    ax2.legend(fontsize=8)
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
    ax2.xaxis.set_major_locator(mdates.YearLocator(3))
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=30, ha='right')
    shade_crashes(ax2)

    # Panel 3: Metric comparison bar chart (CAGR / MaxDD / Sharpe for adaptive variants)
    bar_keys   = keys_adapt
    bar_labels = [LABELS[k] for k in bar_keys if k in results]
    cagrs      = [results[k]['metrics']['cagr'] * 100         for k in bar_keys if k in results]
    maxdds     = [abs(results[k]['metrics']['max_drawdown']) * 100 for k in bar_keys if k in results]
    sharpes    = [results[k]['metrics']['sharpe']             for k in bar_keys if k in results]
    x     = np.arange(len(bar_labels))
    width = 0.25
    ax3.bar(x - width, cagrs,   width, label='CAGR (%)',     color='#4CAF50', alpha=0.85)
    ax3.bar(x,         maxdds,  width, label='Max DD (abs%)', color='#F44336', alpha=0.85)
    ax3.bar(x + width, sharpes, width, label='Sharpe',        color='#2196F3', alpha=0.85)
    ax3.set_xticks(x)
    ax3.set_xticklabels(['50%', '70%', '100%'], fontsize=11)
    ax3.set_title('Metric Comparison -- Adaptive Variants', fontsize=11, fontweight='bold')
    ax3.legend(fontsize=9)
    ax3.grid(True, alpha=0.3, axis='y')
    for xi, (c, d, s) in enumerate(zip(cagrs, maxdds, sharpes)):
        ax3.text(xi - width, c + 0.3, f'{c:.1f}', ha='center', va='bottom', fontsize=8)
        ax3.text(xi,         d + 0.3, f'{d:.1f}', ha='center', va='bottom', fontsize=8)
        ax3.text(xi + width, s + 0.3, f'{s:.2f}', ha='center', va='bottom', fontsize=8)

    # Panel 4: Per-crash-period drawdown comparison (Adaptive variants + MA200+BB)
    crash_names = list(CRASH_PERIODS.keys())
    compare_keys = ['ma200_bb', 'adapt_50', 'adapt_70', 'adapt_100']
    compare_cols = [COLOURS[k] for k in compare_keys]
    compare_labs = [LABELS[k] for k in compare_keys]
    crash_dds = {k: [] for k in compare_keys}
    for period_name, (start, end) in CRASH_PERIODS.items():
        mask  = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            for k in compare_keys:
                crash_dds[k].append(0.0)
            continue
        idx_s = data.index[mask][0]
        idx_e = data.index[mask][-1]
        for k in compare_keys:
            if k not in results:
                crash_dds[k].append(0.0)
                continue
            eq        = results[k]['equity'][idx_s:idx_e + 1]
            peak      = float(results[k]['equity'][:idx_s + 1].max()) if idx_s > 0 else eq[0]
            period_dd = (float(eq.min()) / peak - 1.0) if peak > 0 else 0.0
            crash_dds[k].append(abs(period_dd) * 100)

    x2    = np.arange(len(crash_names))
    width2 = 0.20
    for i, (k, col, lbl) in enumerate(zip(compare_keys, compare_cols, compare_labs)):
        offset = (i - 1.5) * width2
        bars = ax4.bar(x2 + offset, crash_dds[k], width2, label=lbl, color=col, alpha=0.85)
    ax4.set_xticks(x2)
    ax4.set_xticklabels(['2018\nVolatility', '2020\nCOVID', '2022\nTightening'], fontsize=10)
    ax4.set_title('Crash Period Drawdown (abs%)', fontsize=11, fontweight='bold')
    ax4.set_ylabel('Max DD (%)')
    ax4.legend(fontsize=8)
    ax4.grid(True, alpha=0.3, axis='y')

    fig.suptitle('WO15 -- Far Regime Analysis', fontsize=14, fontweight='bold')
    fig.savefig(os.path.join(CHARTS_DIR, 'far_sell_analysis_wo15.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 4: Crash Period Comparison (6 strategies) ----
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
            eq_slice = results[k]['equity'][mask.values]
            if len(eq_slice) == 0:
                continue
            axes[0, col].plot(sub_dates, eq_slice / eq_slice[0] * 100,
                              label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
            axes[1, col].plot(sub_dates, results[k]['drawdown_nav'][mask.values] * 100,
                              label=LABELS[k], color=COLOURS[k], linewidth=lw, linestyle=ls)
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
    fig.suptitle('Crash Period Comparison -- WO15', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'crash_period_comparison_wo15.png'), dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Save metrics
# ---------------------------------------------------------------------------

def _save_metrics(results):
    os.makedirs(METRICS_DIR, exist_ok=True)
    summary = {res['name']: res['metrics'].copy() for res in results.values()}
    ts   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(METRICS_DIR, f'wo15_metrics_{ts}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)


if __name__ == '__main__':
    main()
