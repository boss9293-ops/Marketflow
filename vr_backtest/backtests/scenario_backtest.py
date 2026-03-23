"""
vr_backtest/backtests/scenario_backtest.py
===========================================
Scenario backtest controller for the VR Leveraged ETF Survival Lab.

Loads TQQQ data (2011-present), runs three strategies, generates charts
and summary metrics.

Usage
-----
python -m vr_backtest.backtests.scenario_backtest
"""
from __future__ import annotations

import os
import sys
import json
import datetime

import numpy as np
import pandas as pd

# ---- project root on sys.path (for running as __main__) ----
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, '..', '..'))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from vr_backtest.data.loader          import load_tqqq
from vr_backtest.strategies.buy_hold  import run_buy_hold
from vr_backtest.strategies.ma200_strategy import run_ma200_strategy
from vr_backtest.strategies.vr_strategy    import run_vr_strategy


# ---------------------------------------------------------------------------
# Crash periods for sectional analysis
# ---------------------------------------------------------------------------

CRASH_PERIODS = {
    '2018 Volatility': ('2018-09-01', '2019-06-30'),
    '2020 COVID':      ('2020-02-01', '2020-12-31'),
    '2022 Tightening': ('2021-11-01', '2023-06-30'),
}

RESULTS_DIR = os.path.join(_ROOT, 'vr_backtest', 'results')
CHARTS_DIR  = os.path.join(RESULTS_DIR, 'charts')
METRICS_DIR = os.path.join(RESULTS_DIR, 'metrics')


# ---------------------------------------------------------------------------
# Main controller
# ---------------------------------------------------------------------------

def main():
    print('=' * 65)
    print('  VR Crash Strategy -- Scenario Backtest')
    print('  Period: 2011-01-01 to present')
    print('=' * 65)

    # ---- load data ----
    print('\n[1] Loading TQQQ data ...')
    data = load_tqqq(start='2011-01-01')
    print(f'    {len(data)} trading days  '
          f'({data["date"].iloc[0].date()} -> {data["date"].iloc[-1].date()})')

    # ---- run strategies ----
    print('\n[2] Running strategies ...')
    results = {}
    for name, runner in [
        ('buy_hold', run_buy_hold),
        ('ma200',    run_ma200_strategy),
        ('vr',       run_vr_strategy),
    ]:
        print(f'    {name} ...')
        results[name] = runner(data)

    # ---- print summary ----
    print('\n[3] Summary')
    _print_summary(results)

    # ---- crash period analysis ----
    print('\n[4] Crash Period Analysis')
    _print_crash_analysis(results, data)

    # ---- generate charts ----
    print('\n[5] Generating charts ...')
    try:
        _generate_charts(results, data)
        print(f'    Charts saved to: {CHARTS_DIR}')
    except Exception as e:
        print(f'    Chart generation failed: {e}')

    # ---- save metrics JSON ----
    _save_metrics(results)
    print(f'\n[6] Metrics saved to: {METRICS_DIR}')
    print('\n' + '=' * 65)


# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------

def _print_summary(results: dict):
    SEP  = '-' * 65
    COLS = ['Strategy', 'Final Equity', 'CAGR', 'Max DD', 'Sharpe', 'Recovery']
    hdr  = f'  {"Strategy":<18} {"Final $":>10}  {"CAGR":>8}  {"Max DD":>8}  {"Sharpe":>7}  {"Recov(d)":>9}'
    print(SEP)
    print(hdr)
    print(SEP)
    for key, res in results.items():
        m    = res['metrics']
        rec  = m['recovery_days']
        rstr = f'{rec:>9}' if rec >= 0 else '      n/a'
        print(
            f'  {res["name"]:<18}'
            f' ${m["final_equity"]:>10,.0f}'
            f'  {m["cagr"]:>8.1%}'
            f'  {m["max_drawdown"]:>8.1%}'
            f'  {m["sharpe"]:>7.2f}'
            f'  {rstr}'
        )
    print(SEP)


# ---------------------------------------------------------------------------
# Crash period analysis
# ---------------------------------------------------------------------------

def _print_crash_analysis(results: dict, data: pd.DataFrame):
    SEP = '-' * 65
    for period_name, (start, end) in CRASH_PERIODS.items():
        mask   = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        idx_s  = data.index[mask][0]
        idx_e  = data.index[mask][-1]

        print(f'\n  {period_name}  ({start} -> {end})')
        print(f'  {"Strategy":<18} {"Period DD":>10}  {"Recovery(d)":>12}  {"End Equity":>12}')
        print(SEP)

        for key, res in results.items():
            eq  = res['equity'][idx_s:idx_e + 1]
            if len(eq) == 0:
                continue
            peak       = float(res['equity'][:idx_s + 1].max()) if idx_s > 0 else eq[0]
            trough     = float(eq.min())
            period_dd  = (trough / peak) - 1.0 if peak > 0 else 0.0
            end_eq     = float(res['equity'][idx_e])

            # recovery: days after trough until equity back to pre-period peak
            trough_rel = int(np.argmin(eq))
            rec_days   = -1
            for i in range(trough_rel, len(eq)):
                if eq[i] >= peak:
                    rec_days = i - trough_rel
                    break

            rstr = f'{rec_days:>11}' if rec_days >= 0 else '        n/a'
            print(
                f'  {res["name"]:<18}'
                f' {period_dd:>10.1%}'
                f'  {rstr}'
                f'  ${end_eq:>11,.0f}'
            )


# ---------------------------------------------------------------------------
# Chart generation
# ---------------------------------------------------------------------------

def _generate_charts(results: dict, data: pd.DataFrame):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates

    os.makedirs(CHARTS_DIR, exist_ok=True)

    colours = {'buy_hold': '#2196F3', 'ma200': '#FF9800', 'vr': '#4CAF50'}
    labels  = {'buy_hold': 'Buy & Hold', 'ma200': '200MA Strategy', 'vr': 'VR Strategy'}

    # convert dates to pandas for matplotlib
    dates = pd.to_datetime(data['date'].values)

    # ---- Chart 1: Equity Curves ----
    fig, ax = plt.subplots(figsize=(14, 7))
    for key, res in results.items():
        ax.plot(dates, res['equity'], label=labels[key], color=colours[key], linewidth=1.5)
    ax.set_title('TQQQ Strategy Comparison — Equity Curves (2011–Present)', fontsize=14, fontweight='bold')
    ax.set_xlabel('Date')
    ax.set_ylabel('Portfolio Value ($)')
    ax.legend(fontsize=11)
    ax.grid(True, alpha=0.3)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
    ax.xaxis.set_major_locator(mdates.YearLocator(2))
    plt.xticks(rotation=30)

    # shade crash periods
    for period_name, (start, end) in CRASH_PERIODS.items():
        ax.axvspan(pd.Timestamp(start), pd.Timestamp(end),
                   alpha=0.08, color='red', label=None)

    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'equity_curve.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 2: Drawdown Curves ----
    fig, ax = plt.subplots(figsize=(14, 6))
    for key, res in results.items():
        ax.fill_between(dates, res['drawdown_nav'] * 100, 0,
                        alpha=0.35, color=colours[key], label=labels[key])
        ax.plot(dates, res['drawdown_nav'] * 100, color=colours[key], linewidth=1.0)
    ax.set_title('NAV Drawdown Comparison', fontsize=14, fontweight='bold')
    ax.set_xlabel('Date')
    ax.set_ylabel('Drawdown (%)')
    ax.legend(fontsize=11)
    ax.grid(True, alpha=0.3)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
    ax.xaxis.set_major_locator(mdates.YearLocator(2))
    plt.xticks(rotation=30)

    for period_name, (start, end) in CRASH_PERIODS.items():
        ax.axvspan(pd.Timestamp(start), pd.Timestamp(end),
                   alpha=0.08, color='gray', label=None)

    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'drawdown_chart.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 3: TQQQ Price + MA200 + Signals ----
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    ax1, ax2 = axes

    ax1.plot(dates, data['close'].values, color='#333333', linewidth=1.0, label='TQQQ Close')
    ax1.plot(dates, data['ma200'].values, color='#E53935', linewidth=1.5, linestyle='--', label='MA200')

    # VR strategy sell signals
    vr_log = results['vr']['trade_log']
    crash_dates  = [pd.Timestamp(e[0]) for e in vr_log if 'CRASH' in e[1]]
    reentry_dates = [pd.Timestamp(e[0]) for e in vr_log if 'REENTRY' in e[1]]

    if crash_dates:
        crash_prices = [float(data.loc[data['date'] == d, 'close'].values[0])
                        for d in crash_dates if d in data['date'].values]
        ax1.scatter(crash_dates[:len(crash_prices)], crash_prices,
                    color='red', marker='v', s=80, zorder=5, label='VR Sell (50%)')

    if reentry_dates:
        reentry_prices = []
        for d in reentry_dates:
            row = data[data['date'] == d]
            if not row.empty:
                reentry_prices.append((d, float(row['close'].values[0])))
        if reentry_prices:
            rd, rp = zip(*reentry_prices)
            ax1.scatter(rd, rp, color='#4CAF50', marker='^', s=60, zorder=5, label='VR Re-entry')

    ax1.set_title('TQQQ Price with MA200 and VR Strategy Signals', fontsize=13, fontweight='bold')
    ax1.set_ylabel('Price ($)')
    ax1.legend(fontsize=10)
    ax1.grid(True, alpha=0.3)

    # lower panel: 252-day drawdown
    ax2.fill_between(dates, data['drawdown'].values * 100, 0, alpha=0.4, color='#E53935')
    ax2.axhline(-35, color='darkred', linestyle='--', linewidth=1.2, label='Crash threshold (-35%)')
    ax2.set_title('TQQQ 252-Day Rolling Drawdown', fontsize=12)
    ax2.set_ylabel('Drawdown (%)')
    ax2.set_xlabel('Date')
    ax2.legend(fontsize=10)
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
    ax2.xaxis.set_major_locator(mdates.YearLocator(2))
    plt.xticks(rotation=30)

    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'price_signals.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 4: 3x3 crash period analysis ----
    fig, axes = plt.subplots(1, 3, figsize=(18, 6))
    for col, (period_name, (start, end)) in enumerate(CRASH_PERIODS.items()):
        ax = axes[col]
        mask = (data['date'] >= start) & (data['date'] <= end)
        if not mask.any():
            continue
        sub_dates = dates[mask]
        for key, res in results.items():
            eq_slice = res['equity'][mask.values]
            norm     = eq_slice / eq_slice[0] * 100   # index to 100
            ax.plot(sub_dates, norm, label=labels[key], color=colours[key], linewidth=1.5)
        ax.set_title(period_name, fontsize=11, fontweight='bold')
        ax.set_ylabel('Indexed Equity (start=100)')
        ax.legend(fontsize=9)
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=35, ha='right')

    fig.suptitle('Crash Period Performance (Indexed to 100)', fontsize=13, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'crash_analysis.png'), dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Save metrics JSON
# ---------------------------------------------------------------------------

def _save_metrics(results: dict):
    os.makedirs(METRICS_DIR, exist_ok=True)

    summary = {}
    for key, res in results.items():
        m = res['metrics'].copy()
        summary[res['name']] = m

    ts   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(METRICS_DIR, f'scenario_metrics_{ts}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    main()
