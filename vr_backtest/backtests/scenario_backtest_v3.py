"""
vr_backtest/backtests/scenario_backtest_v3.py
===============================================
WO13: VR v3 vs MA200 + Bottom Buy

6 strategies:
  BuyHold, MA200, MA200+BottomBuy, VR_v2_speedA_sell10,
  VR_v2_speedA_sell20, VR_v3_hybrid

Charts:
  equity_curve_v3.png
  drawdown_curve_v3.png
  signal_timeline_v3.png
  crash_period_comparison_v3.png

Usage
-----
python -m vr_backtest.backtests.scenario_backtest_v3
"""
from __future__ import annotations

import os
import sys
import json
import datetime
import functools

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
from vr_backtest.strategies.vr_strategy_v2      import run_vr_v2
from vr_backtest.strategies.vr_strategy_v3      import run_vr_v3


CRASH_PERIODS = {
    '2018 Volatility': ('2018-09-01', '2019-06-30'),
    '2020 COVID':      ('2020-02-01', '2020-12-31'),
    '2022 Tightening': ('2021-11-01', '2023-06-30'),
}

RESULTS_DIR = os.path.join(_ROOT, 'vr_backtest', 'results')
CHARTS_DIR  = os.path.join(RESULTS_DIR, 'charts')
METRICS_DIR = os.path.join(RESULTS_DIR, 'metrics')

# chart colours and labels
COLOURS = {
    'buy_hold':          '#9E9E9E',
    'ma200':             '#FF9800',
    'ma200_bottom_buy':  '#2196F3',
    'vr_v2_a10':         '#8BC34A',
    'vr_v2_a20':         '#4CAF50',
    'vr_v3':             '#E91E63',
}
LABELS = {
    'buy_hold':          'Buy & Hold',
    'ma200':             'MA200',
    'ma200_bottom_buy':  'MA200 + Bottom Buy',
    'vr_v2_a10':         'VR v2 SpeedA 10%',
    'vr_v2_a20':         'VR v2 SpeedA 20%',
    'vr_v3':             'VR v3 Hybrid',
}


def main():
    SEP = '=' * 70
    print(SEP)
    print('  VR Strategy v3 -- WO13 Backtest')
    print('  Period: 2011-01-01 to present')
    print(SEP)

    print('\n[1] Loading TQQQ data ...')
    data = load_tqqq(start='2011-01-01')
    print(f'    {len(data)} trading days  '
          f'({data["date"].iloc[0].date()} -> {data["date"].iloc[-1].date()})')

    print('\n[2] Running 6 strategies ...')
    results = {}
    runners = [
        ('buy_hold',         lambda d: run_buy_hold(d)),
        ('ma200',            lambda d: run_ma200_strategy(d)),
        ('ma200_bottom_buy', lambda d: run_ma200_bottom_buy(d)),
        ('vr_v2_a10',        lambda d: run_vr_v2(d, speed_sensor='A', initial_sell_pct=0.10)),
        ('vr_v2_a20',        lambda d: run_vr_v2(d, speed_sensor='A', initial_sell_pct=0.20)),
        ('vr_v3',            lambda d: run_vr_v3(d)),
    ]
    for key, runner in runners:
        print(f'    {key} ...')
        results[key] = runner(data)

    print('\n[3] Summary')
    _print_summary(results)

    print('\n[4] Trigger activity')
    _print_trigger_counts(results)

    print('\n[5] Crash Period Analysis')
    _print_crash_analysis(results, data)

    print('\n[6] Generating charts ...')
    try:
        _generate_charts(results, data)
        print(f'    Charts saved to: {CHARTS_DIR}')
    except Exception as e:
        import traceback
        print(f'    Chart error: {e}')
        traceback.print_exc()

    _save_metrics(results)
    print(f'\n[7] Metrics saved to: {METRICS_DIR}')
    print('\n' + SEP)


# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------

def _print_summary(results):
    SEP = '-' * 70
    hdr = (f'  {"Strategy":<22} {"Final $":>11}  {"CAGR":>7}  '
           f'{"Max DD":>7}  {"Sharpe":>7}  {"Recov(d)":>9}')
    print(SEP)
    print(hdr)
    print(SEP)
    for key in results:
        m    = results[key]['metrics']
        rec  = m['recovery_days']
        rstr = f'{rec:>9}' if rec >= 0 else '      n/a'
        name = LABELS.get(key, results[key].get('label', key))
        print(
            f'  {name:<22}'
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
    TRADE_TYPES = ['SPEED_SELL', 'TREND_SELL', 'CRASH_SELL',
                   'DD25_SELL', 'DD35_SELL',
                   'BOTTOM_BUY_40', 'BOTTOM_BUY_50', 'BOTTOM_BUY_60',
                   'REENTRY']
    SEP = '-' * 75
    print(f'  {"Strategy":<22}  {"SPEED":>5}  {"TREND":>5}  {"CRASH":>5}  '
          f'{"DD25":>5}  {"BB40":>5}  {"BB50":>5}  {"BB60":>5}  {"RE":>4}')
    print(SEP)
    for key, res in results.items():
        tl = res['trade_log']
        name = LABELS.get(key, res.get('label', key))
        print(
            f'  {name:<22}'
            f'  {_count_trades(tl, "SPEED_SELL"):>5}'
            f'  {_count_trades(tl, "TREND_SELL"):>5}'
            f'  {_count_trades(tl, "CRASH_SELL"):>5}'
            f'  {_count_trades(tl, "DD25_SELL"):>5}'
            f'  {_count_trades(tl, "BOTTOM_BUY_40"):>5}'
            f'  {_count_trades(tl, "BOTTOM_BUY_50"):>5}'
            f'  {_count_trades(tl, "BOTTOM_BUY_60"):>5}'
            f'  {_count_trades(tl, *[f"REENTRY_{i}" for i in range(1,6)]):>4}'
        )


# ---------------------------------------------------------------------------
# Crash period analysis
# ---------------------------------------------------------------------------

def _print_crash_analysis(results, data):
    SEP = '-' * 70
    for period_name, (start, end) in CRASH_PERIODS.items():
        mask  = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        idx_s = data.index[mask][0]
        idx_e = data.index[mask][-1]

        print(f'\n  {period_name}  ({start} -> {end})')
        print(f'  {"Strategy":<22} {"Period DD":>10}  {"Recovery(d)":>12}  {"End Equity":>12}')
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
                f'  {LABELS.get(key, res.get("label", key)):<22}'
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

    keys_order = ['buy_hold', 'ma200', 'ma200_bottom_buy', 'vr_v2_a10', 'vr_v2_a20', 'vr_v3']

    def shade_crashes(ax):
        for _, (s, e) in CRASH_PERIODS.items():
            ax.axvspan(pd.Timestamp(s), pd.Timestamp(e), alpha=0.07, color='red')

    def fmt_ax(ax):
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
        ax.xaxis.set_major_locator(mdates.YearLocator(2))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha='right')

    # ---- Chart 1: Equity Curves (2-panel: log + linear) ----
    fig, axes = plt.subplots(2, 1, figsize=(14, 11), sharex=True)
    for k in keys_order:
        if k not in results:
            continue
        r = results[k]
        axes[0].semilogy(dates, r['equity'], label=LABELS[k], color=COLOURS[k], linewidth=1.5)
        axes[1].plot(dates, r['equity'], label=LABELS[k], color=COLOURS[k], linewidth=1.5)
    axes[0].set_title('Equity Curves (log scale)', fontsize=13, fontweight='bold')
    axes[0].set_ylabel('Portfolio Value ($)')
    axes[0].legend(fontsize=10)
    shade_crashes(axes[0])
    fmt_ax(axes[0])
    axes[1].set_title('Equity Curves (linear)', fontsize=13, fontweight='bold')
    axes[1].set_ylabel('Portfolio Value ($)')
    axes[1].legend(fontsize=10)
    shade_crashes(axes[1])
    fmt_ax(axes[1])
    fig.suptitle('WO13 -- Strategy Comparison: Equity (2011-present)', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'equity_curve_v3.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 2: Drawdown Curves ----
    fig, ax = plt.subplots(figsize=(14, 6))
    for k in keys_order:
        if k not in results:
            continue
        r = results[k]
        ax.plot(dates, r['drawdown_nav'] * 100, label=LABELS[k], color=COLOURS[k], linewidth=1.3)
    ax.fill_between(dates, results['buy_hold']['drawdown_nav'] * 100, 0,
                    alpha=0.05, color=COLOURS['buy_hold'])
    ax.set_title('NAV Drawdown Comparison -- WO13', fontsize=13, fontweight='bold')
    ax.set_ylabel('Drawdown (%)')
    ax.legend(fontsize=10)
    shade_crashes(ax)
    fmt_ax(ax)
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'drawdown_curve_v3.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 3: Signal Timeline (3 panels) ----
    fig = plt.figure(figsize=(16, 12))
    gs  = GridSpec(3, 1, figure=fig, hspace=0.4)
    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    ax3 = fig.add_subplot(gs[2], sharex=ax1)

    # Top: TQQQ price + MA200 + MA200+BB signals
    ax1.plot(dates, data['close'].values, color='#333333', linewidth=0.9, label='TQQQ')
    ax1.plot(dates, data['ma200'].values, color='#FF9800', linewidth=1.4,
             linestyle='--', label='MA200')
    if 'ma200_bottom_buy' in results:
        tl = results['ma200_bottom_buy']['trade_log']
        for tag, colour, marker, label in [
            ('MA200_EXIT',   'red',     'v', 'MA200 Exit'),
            ('BOTTOM_BUY_40', '#2196F3', '^', 'Buy -40%'),
            ('BOTTOM_BUY_50', '#1565C0', '^', 'Buy -50%'),
            ('BOTTOM_BUY_60', '#0D47A1', '^', 'Buy -60%'),
            ('MA200_ENTRY',  '#4CAF50', '^', 'MA200 Re-entry'),
        ]:
            pts = [(pd.Timestamp(e[0]), e[2]) for e in tl if e[1] == tag]
            if pts:
                xs, ys = zip(*pts)
                ax1.scatter(xs, ys, color=colour, marker=marker, s=55, zorder=5, label=label)
    ax1.set_title('MA200 + Bottom Buy Signals', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Price ($)')
    ax1.legend(fontsize=8, ncol=3)
    ax1.grid(True, alpha=0.3)
    shade_crashes(ax1)

    # Middle: VR v3 signals
    ax2.plot(dates, data['close'].values, color='#333333', linewidth=0.9, label='TQQQ')
    ax2.plot(dates, data['ma200'].values, color='#FF9800', linewidth=1.4,
             linestyle='--', label='MA200')
    if 'vr_v3' in results:
        tl = results['vr_v3']['trade_log']
        for tag, colour, marker, sz, label in [
            ('SPEED_SELL',  'red',     'v', 70, 'Speed Sell'),
            ('TREND_SELL',  'darkred', 'v', 50, 'Trend Sell'),
            ('CRASH_SELL',  'purple',  'v', 50, 'Crash Sell'),
            ('REDEPLOY',    '#4CAF50', '^', 50, 'Redeploy'),
        ]:
            pts = [(pd.Timestamp(e[0]), e[2]) for e in tl if e[1] == tag]
            if pts:
                xs, ys = zip(*pts)
                ax2.scatter(xs, ys, color=colour, marker=marker, s=sz, zorder=5, label=label)
        reentry_pts = [(pd.Timestamp(e[0]), e[2]) for e in tl
                       if e[1].startswith('REENTRY_')]
        if reentry_pts:
            xs, ys = zip(*reentry_pts)
            ax2.scatter(xs, ys, color='#2196F3', marker='^', s=40, zorder=5, label='Re-entry')
    ax2.set_title('VR v3 Hybrid Signals', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Price ($)')
    ax2.legend(fontsize=8, ncol=3)
    ax2.grid(True, alpha=0.3)
    shade_crashes(ax2)

    # Bottom: 252-day rolling drawdown
    ax3.fill_between(dates, data['drawdown'].values * 100, 0, alpha=0.4, color='#E53935')
    ax3.axhline(-35, color='darkred', linestyle='--', linewidth=1.2, label='Crash (-35%)')
    ax3.axhline(-40, color='darkblue', linestyle=':', linewidth=1.0, label='BB ladder (-40%)')
    ax3.set_title('TQQQ 252-Day Rolling Drawdown', fontsize=11)
    ax3.set_ylabel('Drawdown (%)')
    ax3.legend(fontsize=9)
    ax3.grid(True, alpha=0.3)
    fmt_ax(ax3)
    shade_crashes(ax3)

    fig.suptitle('Signal Timeline -- WO13', fontsize=14, fontweight='bold')
    fig.savefig(os.path.join(CHARTS_DIR, 'signal_timeline_v3.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 4: Crash Period Comparison (3 columns x 2 rows) ----
    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    for col, (period_name, (start, end)) in enumerate(CRASH_PERIODS.items()):
        mask = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        sub_dates = dates[mask]

        # top row: indexed equity
        ax = axes[0, col]
        for k in keys_order:
            if k not in results:
                continue
            eq_slice = results[k]['equity'][mask.values]
            if len(eq_slice) == 0:
                continue
            norm = eq_slice / eq_slice[0] * 100
            ax.plot(sub_dates, norm, label=LABELS[k], color=COLOURS[k], linewidth=1.5)
        ax.set_title(f'{period_name}\n(equity indexed to 100)', fontsize=10, fontweight='bold')
        ax.set_ylabel('Indexed Equity')
        ax.legend(fontsize=7)
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=40, ha='right')

        # bottom row: drawdown
        ax2b = axes[1, col]
        for k in keys_order:
            if k not in results:
                continue
            dd_slice = results[k]['drawdown_nav'][mask.values]
            if len(dd_slice) == 0:
                continue
            ax2b.plot(sub_dates, dd_slice * 100, label=LABELS[k], color=COLOURS[k], linewidth=1.3)
        ax2b.set_title(f'{period_name}\n(NAV drawdown)', fontsize=10, fontweight='bold')
        ax2b.set_ylabel('Drawdown (%)')
        ax2b.legend(fontsize=7)
        ax2b.grid(True, alpha=0.3)
        ax2b.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        ax2b.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
        plt.setp(ax2b.xaxis.get_majorticklabels(), rotation=40, ha='right')

    fig.suptitle('Crash Period Analysis -- WO13', fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'crash_period_comparison_v3.png'), dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Save metrics
# ---------------------------------------------------------------------------

def _save_metrics(results):
    os.makedirs(METRICS_DIR, exist_ok=True)
    summary = {res['name']: res['metrics'].copy() for res in results.values()}
    ts   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(METRICS_DIR, f'wo13_metrics_{ts}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)


if __name__ == '__main__':
    main()
