"""
vr_backtest/backtests/scenario_backtest_v2.py
===============================================
VR Speed-Trigger Validation -- Scenario Backtest v2.

Runs 6 strategies on TQQQ 2011-present:
  BuyHold, MA200, and 4 VR v2 speed-trigger variants.

Produces:
  equity_curve_v2.png
  drawdown_curve_v2.png
  price_speed_triggers.png
  crash_period_comparison_v2.png
  metrics JSON

Usage
-----
python -m vr_backtest.backtests.scenario_backtest_v2
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
from vr_backtest.strategies.vr_strategy_v2      import run_vr_v2

# ---------------------------------------------------------------------------
# Strategy registry
# ---------------------------------------------------------------------------

RESULTS_DIR = os.path.join(_ROOT, 'vr_backtest', 'results')
CHARTS_DIR  = os.path.join(RESULTS_DIR, 'charts')
METRICS_DIR = os.path.join(RESULTS_DIR, 'metrics')

CRASH_PERIODS = {
    '2018 Volatility': ('2018-09-01', '2019-06-30'),
    '2020 COVID':      ('2020-02-01', '2020-12-31'),
    '2022 Tightening': ('2021-11-01', '2023-06-30'),
}

# colour palette -- 6 strategies
COLOURS = {
    'BuyHold':             '#2196F3',
    'MA200':               '#FF9800',
    'VR_v2_speedA_sell10': '#4CAF50',
    'VR_v2_speedA_sell20': '#1B5E20',
    'VR_v2_speedB_sell10': '#E91E63',
    'VR_v2_speedB_sell20': '#880E4F',
}


def _build_strategy_configs(data):
    """Return ordered dict of {key: result_dict} for all 6 strategies."""
    configs = [
        ('BuyHold', functools.partial(run_buy_hold, data)),
        ('MA200',   functools.partial(run_ma200_strategy, data)),
        ('VR_v2_speedA_sell10', functools.partial(run_vr_v2, data, speed_sensor='A', initial_sell_pct=0.10)),
        ('VR_v2_speedA_sell20', functools.partial(run_vr_v2, data, speed_sensor='A', initial_sell_pct=0.20)),
        ('VR_v2_speedB_sell10', functools.partial(run_vr_v2, data, speed_sensor='B', initial_sell_pct=0.10)),
        ('VR_v2_speedB_sell20', functools.partial(run_vr_v2, data, speed_sensor='B', initial_sell_pct=0.20)),
    ]
    results = {}
    for key, runner in configs:
        res = runner()
        # ensure 'name' key always exists
        if 'name' not in res:
            res['name'] = key
        results[key] = res
    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    SEP = '=' * 70

    print(SEP)
    print('  VR Speed-Trigger Validation -- Scenario Backtest v2')
    print('  Period: 2011-01-01 to present')
    print(SEP)

    print('\n[1] Loading TQQQ data ...')
    data = load_tqqq(start='2011-01-01')
    print(f'    {len(data)} trading days  '
          f'({data["date"].iloc[0].date()} -> {data["date"].iloc[-1].date()})')

    print('\n[2] Running 6 strategies ...')
    results = {}
    for key, runner in [
        ('BuyHold', lambda: run_buy_hold(data)),
        ('MA200',   lambda: run_ma200_strategy(data)),
        ('VR_v2_speedA_sell10', lambda: run_vr_v2(data, 'A', 0.10)),
        ('VR_v2_speedA_sell20', lambda: run_vr_v2(data, 'A', 0.20)),
        ('VR_v2_speedB_sell10', lambda: run_vr_v2(data, 'B', 0.10)),
        ('VR_v2_speedB_sell20', lambda: run_vr_v2(data, 'B', 0.20)),
    ]:
        print(f'    {key} ...')
        res = runner()
        if 'name' not in res:
            res['name'] = key
        results[key] = res

    print('\n[3] Summary')
    _print_summary(results)

    _print_trigger_counts(results)

    print('\n[4] Crash Period Analysis')
    _print_crash_analysis(results, data)

    print('\n[5] Generating charts ...')
    try:
        _generate_charts(results, data)
        print(f'    Charts saved to: {CHARTS_DIR}')
    except Exception as e:
        import traceback
        print(f'    Chart error: {e}')
        traceback.print_exc()

    _save_metrics(results)
    print(f'\n[6] Metrics saved to: {METRICS_DIR}')
    print('\n' + SEP)


# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------

def _print_summary(results: dict):
    SEP = '-' * 70
    print(SEP)
    print(f'  {"Strategy":<26} {"Final $":>10}  {"CAGR":>7}  {"Max DD":>8}  {"Sharpe":>7}  {"Recov(d)":>9}')
    print(SEP)
    for key, res in results.items():
        m   = res['metrics']
        rec = m['recovery_days']
        r   = f'{rec:>9}' if rec >= 0 else '      n/a'
        print(
            f'  {res["name"]:<26}'
            f' ${m["final_equity"]:>10,.0f}'
            f'  {m["cagr"]:>7.1%}'
            f'  {m["max_drawdown"]:>8.1%}'
            f'  {m["sharpe"]:>7.2f}'
            f'  {r}'
        )
    print(SEP)


def _print_trigger_counts(results: dict):
    """Show how often each speed trigger fired per strategy."""
    print('\n  Speed trigger activity:')
    print(f'  {"Strategy":<26}  {"SPEED_SELL":>11}  {"DD25_SELL":>10}  {"DD35_SELL":>10}  {"REENTRY":>8}')
    print('  ' + '-' * 62)
    for key, res in results.items():
        log = res['trade_log']
        speed  = sum(1 for e in log if e[1] == 'SPEED_SELL')
        dd25   = sum(1 for e in log if e[1] == 'DD25_SELL')
        dd35   = sum(1 for e in log if e[1] == 'DD35_SELL')
        reent  = sum(1 for e in log if 'REENTRY' in str(e[1]))
        print(f'  {res["name"]:<26}  {speed:>11}  {dd25:>10}  {dd35:>10}  {reent:>8}')


# ---------------------------------------------------------------------------
# Crash period analysis
# ---------------------------------------------------------------------------

def _print_crash_analysis(results: dict, data: pd.DataFrame):
    SEP = '-' * 70
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
            eq        = res['equity'][idx_s : idx_e + 1]
            if len(eq) == 0:
                continue
            peak      = float(res['equity'][:idx_s + 1].max()) if idx_s > 0 else eq[0]
            period_dd = (eq.min() / peak) - 1.0 if peak > 0 else 0.0
            end_eq    = float(res['equity'][idx_e])

            trough_rel = int(np.argmin(eq))
            rec_days   = next(
                (i - trough_rel for i in range(trough_rel, len(eq)) if eq[i] >= peak),
                -1,
            )
            r = f'{rec_days:>11}' if rec_days >= 0 else '        n/a'
            print(
                f'  {res["name"]:<26}'
                f' {period_dd:>10.1%}'
                f'  {r}'
                f'  ${end_eq:>11,.0f}'
            )


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def _generate_charts(results: dict, data: pd.DataFrame):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates

    os.makedirs(CHARTS_DIR, exist_ok=True)
    dates = pd.to_datetime(data['date'].values)

    # strategy display order and styles
    strategies = list(results.items())
    line_styles = {
        'BuyHold':             ('-',  2.0, COLOURS['BuyHold']),
        'MA200':               ('-',  2.0, COLOURS['MA200']),
        'VR_v2_speedA_sell10': ('-',  1.5, COLOURS['VR_v2_speedA_sell10']),
        'VR_v2_speedA_sell20': ('--', 1.5, COLOURS['VR_v2_speedA_sell20']),
        'VR_v2_speedB_sell10': ('-',  1.5, COLOURS['VR_v2_speedB_sell10']),
        'VR_v2_speedB_sell20': ('--', 1.5, COLOURS['VR_v2_speedB_sell20']),
    }

    def _crash_shading(ax):
        for _, (s, e) in CRASH_PERIODS.items():
            ax.axvspan(pd.Timestamp(s), pd.Timestamp(e), alpha=0.07, color='gray')

    def _fmt_xaxis(ax, interval=2):
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
        ax.xaxis.set_major_locator(mdates.YearLocator(interval))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha='right')

    # ---- Chart 1: Equity Curves ----
    fig, axes = plt.subplots(2, 1, figsize=(15, 10),
                              gridspec_kw={'height_ratios': [3, 2]})

    ax1, ax2 = axes
    for key, res in strategies:
        ls, lw, col = line_styles.get(key, ('-', 1.5, '#888888'))
        ax1.plot(dates, res['equity'], label=res['name'], color=col,
                 linestyle=ls, linewidth=lw)
    _crash_shading(ax1)
    ax1.set_title('Equity Curves -- All 6 Strategies (2011-Present)',
                  fontsize=13, fontweight='bold')
    ax1.set_ylabel('Portfolio Value ($)')
    ax1.legend(fontsize=9, loc='upper left')
    ax1.grid(True, alpha=0.3)
    _fmt_xaxis(ax1)

    # lower panel: zoom on VR v2 + MA200 (exclude outlier B&H)
    for key, res in strategies:
        if key == 'BuyHold':
            continue
        ls, lw, col = line_styles.get(key, ('-', 1.5, '#888888'))
        ax2.plot(dates, res['equity'], label=res['name'], color=col,
                 linestyle=ls, linewidth=lw)
    _crash_shading(ax2)
    ax2.set_title('Equity Curves -- Excluding Buy & Hold (scaled view)',
                  fontsize=11)
    ax2.set_ylabel('Portfolio Value ($)')
    ax2.set_xlabel('Date')
    ax2.legend(fontsize=9, loc='upper left')
    ax2.grid(True, alpha=0.3)
    _fmt_xaxis(ax2)

    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'equity_curve_v2.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 2: Drawdown Curves ----
    fig, ax = plt.subplots(figsize=(15, 7))
    for key, res in strategies:
        ls, lw, col = line_styles.get(key, ('-', 1.5, '#888888'))
        ax.plot(dates, res['drawdown_nav'] * 100, label=res['name'],
                color=col, linestyle=ls, linewidth=lw)
    _crash_shading(ax)
    ax.set_title('NAV Drawdown Comparison -- All 6 Strategies',
                 fontsize=13, fontweight='bold')
    ax.set_ylabel('Drawdown (%)')
    ax.set_xlabel('Date')
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.3)
    _fmt_xaxis(ax)
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'drawdown_curve_v2.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 3: Price + Speed Triggers ----
    fig, axes = plt.subplots(3, 1, figsize=(15, 12), sharex=True)
    ax_price, ax_sp4, ax_sp3 = axes

    # Top: price + MA200 + trigger marks
    ax_price.plot(dates, data['close'].values, color='#212121', linewidth=1.0, label='TQQQ')
    ax_price.plot(dates, data['ma200'].values,  color='#E53935', linewidth=1.5,
                  linestyle='--', label='MA200')

    # Mark speed-A trigger fires (for first VR v2 speedA variant)
    vr_a = results.get('VR_v2_speedA_sell10')
    if vr_a:
        speed_fires_a = [e for e in vr_a['trade_log'] if e[1] == 'SPEED_SELL']
        if speed_fires_a:
            fd = [pd.Timestamp(e[0]) for e in speed_fires_a]
            fp = [e[2] for e in speed_fires_a]
            ax_price.scatter(fd, fp, color=COLOURS['VR_v2_speedA_sell10'],
                             marker='v', s=70, zorder=5, label='Speed-A trigger')

    vr_b = results.get('VR_v2_speedB_sell10')
    if vr_b:
        speed_fires_b = [e for e in vr_b['trade_log'] if e[1] == 'SPEED_SELL']
        if speed_fires_b:
            fd = [pd.Timestamp(e[0]) for e in speed_fires_b]
            fp = [e[2] for e in speed_fires_b]
            ax_price.scatter(fd, fp, color=COLOURS['VR_v2_speedB_sell10'],
                             marker='^', s=50, zorder=5, label='Speed-B trigger',
                             alpha=0.8)

    _crash_shading(ax_price)
    ax_price.set_title('TQQQ Price + Speed Trigger Events', fontsize=12, fontweight='bold')
    ax_price.set_ylabel('Price ($)')
    ax_price.legend(fontsize=9)
    ax_price.grid(True, alpha=0.3)

    # Middle: speed4 with -15% threshold
    ax_sp4.plot(dates, data['speed4'].values * 100, color='#1565C0', linewidth=0.8,
                label='4-day speed (%)')
    ax_sp4.axhline(-15, color='red', linewidth=1.5, linestyle='--', label='Threshold -15%')
    ax_sp4.fill_between(dates,
                        np.where(data['speed4'].values * 100 < -15,
                                 data['speed4'].values * 100, -15),
                        -15, color='red', alpha=0.25)
    _crash_shading(ax_sp4)
    ax_sp4.set_title('Speed Sensor A: 4-Day Return (threshold -15%)', fontsize=11)
    ax_sp4.set_ylabel('4-Day Return (%)')
    ax_sp4.legend(fontsize=9)
    ax_sp4.grid(True, alpha=0.3)

    # Bottom: speed3 with -12% threshold
    ax_sp3.plot(dates, data['speed3'].values * 100, color='#6A1B9A', linewidth=0.8,
                label='3-day speed (%)')
    ax_sp3.axhline(-12, color='red', linewidth=1.5, linestyle='--', label='Threshold -12%')
    ax_sp3.fill_between(dates,
                        np.where(data['speed3'].values * 100 < -12,
                                 data['speed3'].values * 100, -12),
                        -12, color='red', alpha=0.25)
    _crash_shading(ax_sp3)
    ax_sp3.set_title('Speed Sensor B: 3-Day Return (threshold -12%)', fontsize=11)
    ax_sp3.set_ylabel('3-Day Return (%)')
    ax_sp3.set_xlabel('Date')
    ax_sp3.legend(fontsize=9)
    ax_sp3.grid(True, alpha=0.3)
    _fmt_xaxis(ax_sp3)

    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'price_speed_triggers.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 4: Crash Period Comparison ----
    fig, axes = plt.subplots(1, 3, figsize=(20, 7))
    for col, (period_name, (start, end)) in enumerate(CRASH_PERIODS.items()):
        ax    = axes[col]
        mask  = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        sub_d = dates[mask]
        for key, res in strategies:
            ls, lw, c = line_styles.get(key, ('-', 1.5, '#888'))
            eq    = res['equity'][mask.values]
            norm  = eq / eq[0] * 100
            ax.plot(sub_d, norm, label=res['name'], color=c, linestyle=ls, linewidth=lw)

        ax.set_title(period_name, fontsize=11, fontweight='bold')
        ax.set_ylabel('Indexed Equity (start=100)')
        ax.legend(fontsize=7)
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=40, ha='right')

    fig.suptitle('Crash Period Comparison -- All 6 Strategies (Indexed to 100)',
                 fontsize=13, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'crash_period_comparison_v2.png'), dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Metrics JSON
# ---------------------------------------------------------------------------

def _save_metrics(results: dict):
    os.makedirs(METRICS_DIR, exist_ok=True)
    summary = {res['name']: res['metrics'] for res in results.values()}
    ts   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(METRICS_DIR, f'scenario_v2_metrics_{ts}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    main()
