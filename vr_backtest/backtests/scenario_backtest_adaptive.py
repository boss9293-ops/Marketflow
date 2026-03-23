"""
vr_backtest/backtests/scenario_backtest_adaptive.py
====================================================
WO14: Adaptive MA Distance Strategy vs MA200+BottomBuy

4 strategies:
  BuyHold, MA200, MA200+BottomBuy, AdaptiveMA

Charts:
  equity_curve_adaptive.png
  drawdown_curve_adaptive.png
  signal_timeline_adaptive.png
  regime_classification.png

Usage
-----
python -m vr_backtest.backtests.scenario_backtest_adaptive
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

from vr_backtest.data.loader                    import load_tqqq
from vr_backtest.strategies.buy_hold            import run_buy_hold
from vr_backtest.strategies.ma200_strategy      import run_ma200_strategy
from vr_backtest.strategies.ma200_bottom_buy    import run_ma200_bottom_buy
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
    'buy_hold':          '#9E9E9E',
    'ma200':             '#FF9800',
    'ma200_bottom_buy':  '#2196F3',
    'adaptive':          '#E91E63',
}
LABELS = {
    'buy_hold':          'Buy & Hold',
    'ma200':             'MA200',
    'ma200_bottom_buy':  'MA200 + Bottom Buy',
    'adaptive':          'Adaptive MA Distance',
}


def main():
    SEP = '=' * 70
    print(SEP)
    print('  WO14 -- Adaptive MA Distance Strategy Backtest')
    print('  Period: 2011-01-01 to present')
    print(SEP)

    print('\n[1] Loading TQQQ data ...')
    data = load_tqqq(start='2011-01-01')
    print(f'    {len(data)} trading days  '
          f'({data["date"].iloc[0].date()} -> {data["date"].iloc[-1].date()})')
    print(f'    Columns: {list(data.columns)}')

    print('\n[2] Running 4 strategies ...')
    results = {}
    runners = [
        ('buy_hold',         lambda d: run_buy_hold(d)),
        ('ma200',            lambda d: run_ma200_strategy(d)),
        ('ma200_bottom_buy', lambda d: run_ma200_bottom_buy(d)),
        ('adaptive',         lambda d: run_adaptive_ma(d)),
    ]
    for key, runner in runners:
        print(f'    {key} ...')
        r = runner(data)
        if 'label' not in r:
            r['label'] = LABELS.get(key, key)
        results[key] = r

    print('\n[3] Summary')
    _print_summary(results)

    print('\n[4] Trigger activity')
    _print_trigger_counts(results)

    print('\n[5] Regime breakdown (Adaptive MA)')
    _print_regime_stats(data)

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
# Summary table
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

def _count_trades(trade_log, *types):
    return sum(1 for e in trade_log if e[1] in types)


def _print_trigger_counts(results):
    SEP = '-' * 72
    print(f'  {"Strategy":<24}  {"NEAR":>5}  {"MED":>5}  {"FAR-C":>6}  {"FAR-T":>6}  '
          f'{"MA200X":>6}  {"BB40":>5}  {"BB50":>5}  {"BB60":>5}  {"MA_RE":>6}')
    print(SEP)
    for key, res in results.items():
        tl = res['trade_log']
        print(
            f'  {res["label"]:<24}'
            f'  {_count_trades(tl, "NEAR_EXIT"):>5}'
            f'  {_count_trades(tl, "MED_EXIT"):>5}'
            f'  {_count_trades(tl, "FAR_CRASH_SELL"):>6}'
            f'  {_count_trades(tl, "FAR_TREND_SELL"):>6}'
            f'  {_count_trades(tl, "MA200_EXIT"):>6}'
            f'  {_count_trades(tl, "BOTTOM_BUY_40"):>5}'
            f'  {_count_trades(tl, "BOTTOM_BUY_50"):>5}'
            f'  {_count_trades(tl, "BOTTOM_BUY_60"):>5}'
            f'  {_count_trades(tl, "MA200_ENTRY"):>6}'
        )


# ---------------------------------------------------------------------------
# Regime statistics
# ---------------------------------------------------------------------------

def _print_regime_stats(data):
    dist = data['distance200'].values
    near   = float(np.mean(dist <= 0.15))
    medium = float(np.mean((dist > 0.15) & (dist <= 0.30)))
    far    = float(np.mean(dist > 0.30))
    below  = float(np.mean(dist < 0.0))
    print(f'  Distance200 regime distribution (2011-present):')
    print(f'    Below MA200  (dist < 0)    : {below:>6.1%}')
    print(f'    Near  (dist 0-15%)         : {near - below:>6.1%}')
    print(f'    Medium (dist 15-30%)       : {medium:>6.1%}')
    print(f'    Far / Bubble (dist > 30%)  : {far:>6.1%}')
    print(f'    Avg Distance200            : {float(np.mean(dist)):>+6.1%}')
    print(f'    Max Distance200            : {float(np.max(dist)):>+6.1%}')


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

    keys_order = ['buy_hold', 'ma200', 'ma200_bottom_buy', 'adaptive']

    def shade_crashes(ax):
        for _, (s, e) in CRASH_PERIODS.items():
            ax.axvspan(pd.Timestamp(s), pd.Timestamp(e), alpha=0.07, color='red')

    def fmt_ax(ax, ylabel=None, legend=True):
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
        ax.xaxis.set_major_locator(mdates.YearLocator(2))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha='right')
        if ylabel:
            ax.set_ylabel(ylabel)
        if legend:
            ax.legend(fontsize=10)

    # ---- Chart 1: Equity Curves (log + linear) ----
    fig, axes = plt.subplots(2, 1, figsize=(14, 11), sharex=True)
    for k in keys_order:
        if k not in results:
            continue
        r = results[k]
        axes[0].semilogy(dates, r['equity'], label=LABELS[k], color=COLOURS[k], linewidth=1.8)
        axes[1].plot(dates, r['equity'], label=LABELS[k], color=COLOURS[k], linewidth=1.8)
    axes[0].set_title('Equity Curves (log scale)', fontsize=12, fontweight='bold')
    axes[1].set_title('Equity Curves (linear)', fontsize=12, fontweight='bold')
    for ax in axes:
        shade_crashes(ax)
        fmt_ax(ax, ylabel='Portfolio Value ($)')
    fig.suptitle('WO14 -- Adaptive MA Distance vs Benchmarks', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'equity_curve_adaptive.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 2: Drawdown Curves ----
    fig, ax = plt.subplots(figsize=(14, 6))
    for k in keys_order:
        if k not in results:
            continue
        r = results[k]
        ax.plot(dates, r['drawdown_nav'] * 100, label=LABELS[k], color=COLOURS[k], linewidth=1.5)
    ax.set_title('NAV Drawdown Comparison -- WO14', fontsize=13, fontweight='bold')
    shade_crashes(ax)
    fmt_ax(ax, ylabel='Drawdown (%)')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'drawdown_curve_adaptive.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 3: Signal Timeline (3 panels) ----
    fig = plt.figure(figsize=(16, 13))
    gs  = GridSpec(3, 1, figure=fig, hspace=0.45, height_ratios=[2, 2, 1])
    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    ax3 = fig.add_subplot(gs[2], sharex=ax1)

    # Top: price + all 3 MAs + MA200+BB signals
    ax1.plot(dates, data['close'].values,   color='#212121', linewidth=0.9, label='TQQQ', zorder=3)
    ax1.plot(dates, data['ma200'].values,   color='#FF5722', linewidth=1.5, linestyle='--', label='MA200')
    ax1.plot(dates, data['ma150'].values,   color='#FF9800', linewidth=1.2, linestyle='--', label='MA150')
    ax1.plot(dates, data['ma120'].values,   color='#FFC107', linewidth=1.0, linestyle='--', label='MA120')
    if 'ma200_bottom_buy' in results:
        tl = results['ma200_bottom_buy']['trade_log']
        for tag, col, mkr, sz, lbl in [
            ('MA200_EXIT',    '#F44336', 'v', 60, 'BB Exit'),
            ('BOTTOM_BUY_40', '#1565C0', '^', 55, 'Buy -40%'),
            ('BOTTOM_BUY_50', '#0D47A1', '^', 55, 'Buy -50%'),
            ('BOTTOM_BUY_60', '#01579B', '^', 55, 'Buy -60%'),
            ('MA200_ENTRY',   '#4CAF50', '^', 50, 'BB Re-entry'),
        ]:
            pts = [(pd.Timestamp(e[0]), e[2]) for e in tl if e[1] == tag]
            if pts:
                xs, ys = zip(*pts)
                ax1.scatter(xs, ys, color=col, marker=mkr, s=sz, zorder=5, label=lbl)
    ax1.set_title('MA200 + Bottom Buy Signals', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Price ($)')
    ax1.legend(fontsize=8, ncol=4, loc='upper left')
    ax1.grid(True, alpha=0.3)
    shade_crashes(ax1)

    # Middle: Adaptive MA signals
    ax2.plot(dates, data['close'].values,   color='#212121', linewidth=0.9, label='TQQQ', zorder=3)
    ax2.plot(dates, data['ma200'].values,   color='#FF5722', linewidth=1.5, linestyle='--', label='MA200')
    ax2.plot(dates, data['ma150'].values,   color='#FF9800', linewidth=1.2, linestyle='--', label='MA150')
    ax2.plot(dates, data['ma120'].values,   color='#FFC107', linewidth=1.0, linestyle='--', label='MA120')
    if 'adaptive' in results:
        tl = results['adaptive']['trade_log']
        for tag, col, mkr, sz, lbl in [
            ('NEAR_EXIT',      '#F44336', 'v', 70, 'Near Exit (MA200)'),
            ('MED_EXIT',       '#E91E63', 'v', 60, 'Med Exit (MA150)'),
            ('FAR_CRASH_SELL', '#9C27B0', 'v', 60, 'Far Crash (MA120+spd)'),
            ('FAR_TREND_SELL', '#6A0DAD', 'v', 55, 'Far Trend (MA150 fallback)'),
            ('BOTTOM_BUY_40',  '#1565C0', '^', 55, 'Buy -40%'),
            ('BOTTOM_BUY_50',  '#0D47A1', '^', 55, 'Buy -50%'),
            ('BOTTOM_BUY_60',  '#01579B', '^', 55, 'Buy -60%'),
            ('MA200_ENTRY',    '#4CAF50', '^', 50, 'Re-entry'),
        ]:
            pts = [(pd.Timestamp(e[0]), e[2]) for e in tl if e[1] == tag]
            if pts:
                xs, ys = zip(*pts)
                ax2.scatter(xs, ys, color=col, marker=mkr, s=sz, zorder=5, label=lbl)
    ax2.set_title('Adaptive MA Distance Signals', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Price ($)')
    ax2.legend(fontsize=8, ncol=4, loc='upper left')
    ax2.grid(True, alpha=0.3)
    shade_crashes(ax2)

    # Bottom: drawdown comparison (MA200+BB vs Adaptive)
    ax3.plot(dates, results['ma200_bottom_buy']['drawdown_nav'] * 100,
             color=COLOURS['ma200_bottom_buy'], linewidth=1.3, label='MA200+BB')
    ax3.plot(dates, results['adaptive']['drawdown_nav'] * 100,
             color=COLOURS['adaptive'], linewidth=1.3, label='Adaptive MA')
    ax3.fill_between(dates, results['adaptive']['drawdown_nav'] * 100, 0,
                     alpha=0.08, color=COLOURS['adaptive'])
    ax3.set_title('NAV Drawdown: MA200+BB vs Adaptive', fontsize=11)
    ax3.set_ylabel('DD (%)')
    ax3.legend(fontsize=9)
    ax3.grid(True, alpha=0.3)
    fmt_ax(ax3, legend=False)
    shade_crashes(ax3)

    fig.suptitle('Signal Timeline -- WO14 Adaptive MA', fontsize=14, fontweight='bold')
    fig.savefig(os.path.join(CHARTS_DIR, 'signal_timeline_adaptive.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 4: Regime Classification ----
    dist = data['distance200'].values
    fig = plt.figure(figsize=(16, 12))
    gs  = GridSpec(3, 1, figure=fig, hspace=0.45, height_ratios=[2, 1.5, 1.5])

    ax_p = fig.add_subplot(gs[0])
    ax_d = fig.add_subplot(gs[1], sharex=ax_p)
    ax_r = fig.add_subplot(gs[2], sharex=ax_p)

    # Top: TQQQ price + 3 MAs with regime shading
    ax_p.plot(dates, data['close'].values, color='#212121', linewidth=1.0, label='TQQQ', zorder=3)
    ax_p.plot(dates, data['ma200'].values, color='#FF5722', linewidth=1.5, linestyle='--', label='MA200', alpha=0.8)
    ax_p.plot(dates, data['ma150'].values, color='#FF9800', linewidth=1.2, linestyle='--', label='MA150', alpha=0.8)
    ax_p.plot(dates, data['ma120'].values, color='#FFC107', linewidth=1.0, linestyle='--', label='MA120', alpha=0.8)

    # shade regime zones on price panel
    near_mask   = dist <= 0.15
    medium_mask = (dist > 0.15) & (dist <= 0.30)
    far_mask    = dist > 0.30
    below_mask  = dist < 0.0

    ax_p.fill_between(dates, 0, data['close'].values,
                      where=far_mask, alpha=0.08, color='red', label='Far (>30%)')
    ax_p.fill_between(dates, 0, data['close'].values,
                      where=medium_mask, alpha=0.06, color='orange', label='Medium (15-30%)')
    ax_p.fill_between(dates, 0, data['close'].values,
                      where=below_mask, alpha=0.10, color='blue', label='Below MA200')
    ax_p.set_title('TQQQ Price + MA Lines + Regime Zones', fontsize=11, fontweight='bold')
    ax_p.set_ylabel('Price ($)')
    ax_p.legend(fontsize=9, ncol=4)
    ax_p.grid(True, alpha=0.3)
    shade_crashes(ax_p)

    # Middle: Distance200 time series
    ax_d.plot(dates, dist * 100, color='#333333', linewidth=1.0, label='Distance200')
    ax_d.axhline(0,    color='#FF5722', linewidth=1.5, linestyle='--', label='MA200 (0%)')
    ax_d.axhline(15,   color='#FF9800', linewidth=1.2, linestyle='--', label='Near/Med (15%)')
    ax_d.axhline(30,   color='#F44336', linewidth=1.2, linestyle='--', label='Med/Far (30%)')
    ax_d.fill_between(dates, dist * 100, 0, where=dist > 0.30,
                      alpha=0.18, color='red',    label='Far zone')
    ax_d.fill_between(dates, dist * 100, 0, where=(dist > 0.15) & (dist <= 0.30),
                      alpha=0.15, color='orange', label='Medium zone')
    ax_d.fill_between(dates, dist * 100, 0, where=dist < 0,
                      alpha=0.18, color='blue',   label='Below MA200')
    ax_d.set_title('Distance from MA200 (%)', fontsize=11, fontweight='bold')
    ax_d.set_ylabel('Distance (%)')
    ax_d.legend(fontsize=8, ncol=3)
    ax_d.grid(True, alpha=0.3)
    shade_crashes(ax_d)
    fmt_ax(ax_d, legend=False)

    # Bottom: Adaptive MA vs MA200+BB drawdown comparison per crash
    ax_r.plot(dates, results['ma200_bottom_buy']['drawdown_nav'] * 100,
              color='#2196F3', linewidth=1.4, label='MA200+BottomBuy')
    ax_r.plot(dates, results['adaptive']['drawdown_nav'] * 100,
              color='#E91E63', linewidth=1.4, label='Adaptive MA')
    ax_r.axhline(-40, color='#333333', linewidth=0.8, linestyle=':', alpha=0.5)
    ax_r.set_title('NAV Drawdown Comparison', fontsize=11)
    ax_r.set_ylabel('DD (%)')
    ax_r.legend(fontsize=9)
    ax_r.grid(True, alpha=0.3)
    fmt_ax(ax_r, legend=False)
    shade_crashes(ax_r)

    fig.suptitle('Regime Classification -- WO14 Adaptive MA Distance', fontsize=14, fontweight='bold')
    fig.savefig(os.path.join(CHARTS_DIR, 'regime_classification.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 5 (bonus): Crash Period Comparison ----
    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    for col, (period_name, (start, end)) in enumerate(CRASH_PERIODS.items()):
        mask = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        sub_dates = dates[mask]
        # equity indexed
        ax = axes[0, col]
        for k in keys_order:
            if k not in results:
                continue
            eq_slice = results[k]['equity'][mask.values]
            if len(eq_slice) == 0:
                continue
            norm = eq_slice / eq_slice[0] * 100
            ax.plot(sub_dates, norm, label=LABELS[k], color=COLOURS[k], linewidth=1.5)
        ax.set_title(f'{period_name}\n(equity indexed)', fontsize=10, fontweight='bold')
        ax.set_ylabel('Indexed (start=100)')
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=40, ha='right')
        # drawdown
        ax2 = axes[1, col]
        for k in keys_order:
            if k not in results:
                continue
            dd_slice = results[k]['drawdown_nav'][mask.values]
            ax2.plot(sub_dates, dd_slice * 100, label=LABELS[k], color=COLOURS[k], linewidth=1.3)
        ax2.set_title(f'{period_name}\n(NAV drawdown)', fontsize=10, fontweight='bold')
        ax2.set_ylabel('DD (%)')
        ax2.legend(fontsize=8)
        ax2.grid(True, alpha=0.3)
        ax2.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        ax2.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
        plt.setp(ax2.xaxis.get_majorticklabels(), rotation=40, ha='right')
    fig.suptitle('Crash Period Analysis -- WO14', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'crash_period_comparison_adaptive.png'), dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Save metrics
# ---------------------------------------------------------------------------

def _save_metrics(results):
    os.makedirs(METRICS_DIR, exist_ok=True)
    summary = {res['name']: res['metrics'].copy() for res in results.values()}
    ts   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(METRICS_DIR, f'wo14_metrics_{ts}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)


if __name__ == '__main__':
    main()
