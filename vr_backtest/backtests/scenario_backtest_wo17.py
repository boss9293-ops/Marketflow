"""
vr_backtest/backtests/scenario_backtest_wo17.py
================================================
WO17: Strategy Performance by Crisis Episode

Strategies:
  MA200
  MA200 + Bottom Buy
  Adaptive MA Variant B  (MA150 / 4d / -12% / sell50%)

Episodes (7):
  2011 Debt Ceiling
  2015 China Shock
  2018 Vol Spike
  2018 Q4 Selloff
  2020 COVID
  2022 Fed Bear
  2025 Correction

Per episode metrics:
  Max DD (within episode)
  Recovery days (trough -> pre-episode peak)
  Episode return  (equity[start] -> equity[end])
  Post-event 6m return (equity[end] -> equity[end+126])
  First exit signal date + days-from-peak lag

Charts:
  episode_equity_wo17.png
  episode_heatmap_wo17.png
  recovery_timing_wo17.png
  post_event_return_wo17.png

Usage
-----
python -m vr_backtest.backtests.scenario_backtest_wo17
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
from vr_backtest.strategies.ma200_strategy       import run_ma200_strategy
from vr_backtest.strategies.ma200_bottom_buy     import run_ma200_bottom_buy
from vr_backtest.strategies.adaptive_ma_strategy import run_adaptive_ma


# ---------------------------------------------------------------------------
# Episode definitions
# ---------------------------------------------------------------------------

EPISODES = {
    '2011 Debt Ceiling':  ('2011-07-01', '2012-03-31'),
    '2015 China Shock':   ('2015-07-01', '2016-03-31'),
    '2018 Vol Spike':     ('2018-01-15', '2018-05-31'),
    '2018 Q4 Selloff':    ('2018-09-01', '2019-06-30'),
    '2020 COVID':         ('2020-02-01', '2020-12-31'),
    '2022 Fed Bear':      ('2021-11-01', '2023-06-30'),
    '2025 Correction':    ('2024-12-01', '2026-03-13'),
}

# Sell-signal event tags to identify for each strategy
EXIT_TAGS = {
    'ma200':    ('MA200_EXIT',),
    'ma200_bb': ('MA200_EXIT',),
    'adapt_b':  ('NEAR_EXIT', 'MED_EXIT', 'FAR_CRASH_SELL', 'FAR_TREND_SELL'),
}

RESULTS_DIR = os.path.join(_ROOT, 'vr_backtest', 'results')
CHARTS_DIR  = os.path.join(RESULTS_DIR, 'charts')
METRICS_DIR = os.path.join(RESULTS_DIR, 'metrics')

COLOURS = {
    'ma200':    '#FF9800',
    'ma200_bb': '#2196F3',
    'adapt_b':  '#E91E63',
}
LABELS = {
    'ma200':    'MA200',
    'ma200_bb': 'MA200 + Bottom Buy',
    'adapt_b':  'Adaptive Var B',
}
SHORT = {
    'ma200':    'MA200',
    'ma200_bb': 'MA200+BB',
    'adapt_b':  'Adapt-B',
}


def main():
    SEP = '=' * 72
    print(SEP)
    print('  WO17 -- Strategy Performance by Crisis Episode')
    print('  7 episodes  x  3 strategies')
    print(SEP)

    print('\n[1] Loading TQQQ data ...')
    data = load_tqqq(start='2011-01-01')
    print(f'    {len(data)} trading days  '
          f'({data["date"].iloc[0].date()} -> {data["date"].iloc[-1].date()})')

    print('\n[2] Running 3 strategies (full history) ...')
    strategies = {}
    strategies['ma200']    = run_ma200_strategy(data)
    strategies['ma200_bb'] = run_ma200_bottom_buy(data)
    strategies['adapt_b']  = run_adaptive_ma(
        data,
        far_sell_pct        = 0.50,
        far_crash_ma_col    = 'ma150',
        far_crash_speed_col = 'speed4',
        far_crash_speed_thr = -0.12,
    )
    for k, res in strategies.items():
        res['label'] = LABELS[k]

    print('\n[3] Episode analysis')
    ep_stats = _compute_all_episodes(strategies, data)
    _print_episode_table(ep_stats)

    print('\n[4] Signal timing detail')
    _print_signal_timing(ep_stats)

    print('\n[5] Generating charts ...')
    try:
        _generate_charts(strategies, data, ep_stats)
        print(f'    Charts saved to: {CHARTS_DIR}')
    except Exception as e:
        import traceback
        print(f'    Chart error: {e}')
        traceback.print_exc()

    _save_results(ep_stats)
    print(f'\n[6] Results saved to: {METRICS_DIR}')
    print('\n' + SEP)


# ---------------------------------------------------------------------------
# Episode stats computation
# ---------------------------------------------------------------------------

def _compute_all_episodes(strategies, data):
    """
    Returns: dict[episode_name][strategy_key] -> dict of metrics
    """
    dates_arr = data['date'].values
    prices    = data['close'].values
    T         = len(dates_arr)
    date_pd   = pd.to_datetime(dates_arr)

    ep_stats = {}

    for ep_name, (ep_start, ep_end) in EPISODES.items():
        ep_stats[ep_name] = {}

        ep_s_ts = pd.Timestamp(ep_start)
        ep_e_ts = pd.Timestamp(ep_end)

        # Episode index range
        mask    = (date_pd >= ep_s_ts) & (date_pd <= ep_e_ts)
        if not mask.any():
            continue
        idx_s   = int(np.where(mask)[0][0])
        idx_e   = int(np.where(mask)[0][-1])

        # Local peak: max price in 30 days before episode + episode itself
        look_back = max(0, idx_s - 30)
        peak_idx  = look_back + int(np.argmax(prices[look_back : idx_e + 1]))
        peak_date = date_pd[peak_idx]
        peak_price= float(prices[peak_idx])

        for s_key, res in strategies.items():
            equity_full = res['equity']
            tl          = res['trade_log']

            # ---- in-episode equity slice ----
            eq_ep   = equity_full[idx_s : idx_e + 1]
            pre_peak = float(equity_full[:idx_s + 1].max()) if idx_s > 0 else eq_ep[0]

            # Max DD within episode
            trough_val = float(eq_ep.min())
            max_dd     = (trough_val / pre_peak - 1.0) if pre_peak > 0 else 0.0

            # Trough position
            trough_rel = int(np.argmin(eq_ep))
            trough_abs = idx_s + trough_rel
            trough_date= date_pd[trough_abs]

            # Recovery days: from trough back to pre-episode peak
            rec_days = -1
            for i in range(trough_abs, T):
                if equity_full[i] >= pre_peak:
                    rec_days = i - trough_abs
                    break

            # Episode return: equity[end] / equity[start] - 1
            ep_return = (equity_full[idx_e] / equity_full[idx_s] - 1.0
                         if equity_full[idx_s] > 0 else 0.0)

            # Post-event 6m return (126 trading days after episode end)
            idx_6m  = min(idx_e + 126, T - 1)
            post_6m = (equity_full[idx_6m] / equity_full[idx_e] - 1.0
                       if equity_full[idx_e] > 0 else float('nan'))
            has_6m  = (idx_e + 126) <= (T - 1)

            # Cash at trough (fraction of portfolio)
            cash_arr = res.get('cash', np.zeros(T))
            cash_at_trough = float(cash_arr[trough_abs])
            eq_at_trough   = float(equity_full[trough_abs])
            cash_pct_trough= (cash_at_trough / eq_at_trough
                              if eq_at_trough > 0 else 0.0)

            # Signal timing: first exit event within episode
            exit_tags  = EXIT_TAGS.get(s_key, ())
            first_signal_date  = None
            first_signal_price = None
            for event in tl:
                evt_date = pd.Timestamp(event[0])
                if ep_s_ts <= evt_date <= ep_e_ts and event[1] in exit_tags:
                    first_signal_date  = evt_date
                    first_signal_price = float(event[2])
                    break

            # Signal lag: days from local peak to first signal
            if first_signal_date is not None:
                signal_lag_days = (first_signal_date - peak_date).days
                # drawdown at signal time (vs local peak price)
                dd_at_signal = (first_signal_price / peak_price - 1.0
                                if peak_price > 0 else 0.0)
            else:
                signal_lag_days = None
                dd_at_signal    = None

            ep_stats[ep_name][s_key] = {
                'max_dd':             max_dd,
                'recovery_days':      rec_days,
                'ep_return':          ep_return,
                'post_6m_return':     post_6m if has_6m else float('nan'),
                'has_6m':             has_6m,
                'trough_date':        trough_date,
                'trough_rel':         trough_rel,
                'pre_peak_eq':        pre_peak,
                'cash_pct_at_trough': cash_pct_trough,
                'first_signal_date':  first_signal_date,
                'first_signal_price': first_signal_price,
                'signal_lag_days':    signal_lag_days,
                'dd_at_signal':       dd_at_signal,
                'peak_date':          peak_date,
                'peak_price':         peak_price,
                'ep_start_idx':       idx_s,
                'ep_end_idx':         idx_e,
            }

    return ep_stats


# ---------------------------------------------------------------------------
# Print tables
# ---------------------------------------------------------------------------

def _print_episode_table(ep_stats):
    SEP  = '-' * 80
    COLS = ['ma200', 'ma200_bb', 'adapt_b']

    for ep_name, ep_data in ep_stats.items():
        if not ep_data:
            continue
        ep_start, ep_end = EPISODES[ep_name]
        print(f'\n  [{ep_name}]  {ep_start} -> {ep_end}')
        print(f'  {"Metric":<22}  {SHORT["ma200"]:>12}  {SHORT["ma200_bb"]:>12}  {SHORT["adapt_b"]:>12}')
        print(SEP)

        def _row(label, fmt_fn):
            vals = []
            for k in COLS:
                d = ep_data.get(k, {})
                vals.append(fmt_fn(d) if d else 'n/a')
            print(f'  {label:<22}  {vals[0]:>12}  {vals[1]:>12}  {vals[2]:>12}')

        _row('Max DD',        lambda d: f'{d["max_dd"]:+.1%}')
        _row('Trough date',   lambda d: str(d['trough_date'].date()))
        _row('Recovery(d)',   lambda d: f'{d["recovery_days"]}d' if d['recovery_days'] >= 0 else 'not yet')
        _row('Episode return',lambda d: f'{d["ep_return"]:+.1%}')
        _row('Post-6m return',lambda d: f'{d["post_6m_return"]:+.1%}' if d['has_6m'] else 'n/a')
        _row('Cash at trough',lambda d: f'{d["cash_pct_at_trough"]:.1%}')


def _print_signal_timing(ep_stats):
    SEP  = '-' * 80
    COLS = ['ma200', 'ma200_bb', 'adapt_b']
    print(f'\n  {"Episode":<22}  {"Strategy":<16}  {"First signal":<13}  '
          f'{"Lag(d)":>7}  {"DD@signal":>10}')
    print(SEP)
    for ep_name, ep_data in ep_stats.items():
        if not ep_data:
            continue
        first = True
        for k in COLS:
            d = ep_data.get(k, {})
            if not d:
                continue
            sig   = str(d['first_signal_date'].date()) if d['first_signal_date'] else 'none'
            lag   = f'{d["signal_lag_days"]}d'         if d['signal_lag_days'] is not None else '---'
            dd_s  = f'{d["dd_at_signal"]:+.1%}'        if d['dd_at_signal'] is not None else '---'
            ep_col = ep_name if first else ''
            print(f'  {ep_col:<22}  {SHORT[k]:<16}  {sig:<13}  {lag:>7}  {dd_s:>10}')
            first = False
        print()


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def _generate_charts(strategies, data, ep_stats):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    from matplotlib.gridspec import GridSpec
    import matplotlib.colors as mcolors

    os.makedirs(CHARTS_DIR, exist_ok=True)
    dates_pd  = pd.to_datetime(data['date'].values)
    T         = len(dates_pd)
    COLS      = ['ma200', 'ma200_bb', 'adapt_b']
    ep_names  = list(ep_stats.keys())
    n_ep      = len(ep_names)

    # ---- Chart 1: Episode equity indexed to 100 (2-row × 4-col grid) ----
    nrows, ncols = 2, 4
    fig, axes = plt.subplots(nrows, ncols, figsize=(22, 11))
    axes_flat = axes.flatten()

    for i, ep_name in enumerate(ep_names):
        ax  = axes_flat[i]
        ep_d = ep_stats[ep_name]
        if not ep_d:
            ax.set_visible(False)
            continue
        ref_k = COLS[0]
        if ref_k not in ep_d:
            ax.set_visible(False)
            continue

        idx_s  = ep_d[ref_k]['ep_start_idx']
        idx_e  = ep_d[ref_k]['ep_end_idx']
        sub_dates = dates_pd[idx_s : idx_e + 1]

        for k in COLS:
            eq = strategies[k]['equity'][idx_s : idx_e + 1]
            if len(eq) == 0:
                continue
            ax.plot(sub_dates, eq / eq[0] * 100,
                    label=SHORT[k], color=COLOURS[k], linewidth=1.8)

        # mark trough for adapt_b
        if 'adapt_b' in ep_d:
            tr = ep_d['adapt_b']['trough_rel']
            if 0 <= tr < len(sub_dates):
                eq_ab = strategies['adapt_b']['equity'][idx_s : idx_e + 1]
                ax.scatter([sub_dates[tr]], [eq_ab[tr] / eq_ab[0] * 100],
                           color=COLOURS['adapt_b'], marker='v', s=60, zorder=5)

        ax.set_title(ep_name, fontsize=9, fontweight='bold')
        ax.axhline(100, color='#888', linewidth=0.7, linestyle='--', alpha=0.5)
        ax.legend(fontsize=7)
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%y-%m'))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=40, ha='right')

    # hide unused panel
    for j in range(n_ep, nrows * ncols):
        axes_flat[j].set_visible(False)

    fig.suptitle('WO17 -- Episode Equity (indexed to 100 at start)',
                 fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'episode_equity_wo17.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 2: Heatmap -- Max DD per strategy × episode ----
    fig, axes = plt.subplots(1, 3, figsize=(18, 6))
    metrics   = ['max_dd', 'recovery_days', 'ep_return']
    m_labels  = ['Max DD (%)', 'Recovery (days)', 'Episode Return (%)']
    m_fmts    = [lambda v: v * 100, lambda v: v, lambda v: v * 100]
    cmaps_    = ['RdYlGn_r', 'RdYlGn_r', 'RdYlGn']

    for ax, metric, mlbl, mfmt, cmap in zip(axes, metrics, m_labels, m_fmts, cmaps_):
        matrix = []
        col_labels = [SHORT[k] for k in COLS]
        row_labels = [n[:18] for n in ep_names]
        for ep_name in ep_names:
            row = []
            for k in COLS:
                d = ep_stats[ep_name].get(k, {})
                if d and metric in d:
                    v = d[metric]
                    row.append(mfmt(v) if v is not None and not (isinstance(v, float) and np.isnan(v)) else np.nan)
                else:
                    row.append(np.nan)
            matrix.append(row)
        arr = np.array(matrix, dtype=float)

        im = ax.imshow(arr, cmap=cmap, aspect='auto')
        ax.set_xticks(range(len(col_labels)))
        ax.set_xticklabels(col_labels, fontsize=10, fontweight='bold')
        ax.set_yticks(range(len(row_labels)))
        ax.set_yticklabels(row_labels, fontsize=8)
        ax.set_title(mlbl, fontsize=11, fontweight='bold')
        plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
        for ri in range(len(row_labels)):
            for ci in range(len(col_labels)):
                v = arr[ri, ci]
                if not np.isnan(v):
                    if metric == 'recovery_days':
                        txt = f'{int(v)}d' if v >= 0 else 'n/a'
                    else:
                        txt = f'{v:.1f}%'
                    ax.text(ci, ri, txt, ha='center', va='center',
                            fontsize=8, color='white',
                            fontweight='bold')

    fig.suptitle('WO17 -- Episode Heatmap (3 strategies × 7 episodes)',
                 fontsize=14, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(CHARTS_DIR, 'episode_heatmap_wo17.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 3: Recovery days + Signal lag (grouped bars) ----
    fig = plt.figure(figsize=(18, 10))
    gs  = GridSpec(2, 1, figure=fig, hspace=0.55)
    ax_rec = fig.add_subplot(gs[0])
    ax_sig = fig.add_subplot(gs[1])

    x     = np.arange(n_ep)
    w     = 0.26
    short_ep = [n[:16] for n in ep_names]

    # Recovery days
    for i, k in enumerate(COLS):
        vals = []
        for ep_name in ep_names:
            d = ep_stats[ep_name].get(k, {})
            v = d.get('recovery_days', -1) if d else -1
            vals.append(v if v >= 0 else np.nan)
        ax_rec.bar(x + (i - 1) * w, vals, w, label=SHORT[k],
                   color=COLOURS[k], alpha=0.85)

    ax_rec.set_xticks(x)
    ax_rec.set_xticklabels(short_ep, fontsize=8)
    ax_rec.set_title('Recovery Days by Episode (trough to pre-episode peak)',
                     fontsize=11, fontweight='bold')
    ax_rec.set_ylabel('Days')
    ax_rec.legend(fontsize=10)
    ax_rec.grid(True, alpha=0.3, axis='y')
    ax_rec.axhline(0, color='black', linewidth=0.8)

    # Signal lag (days from local price peak to first exit signal)
    for i, k in enumerate(COLS):
        vals = []
        for ep_name in ep_names:
            d   = ep_stats[ep_name].get(k, {})
            lag = d.get('signal_lag_days') if d else None
            vals.append(lag if lag is not None else np.nan)
        ax_sig.bar(x + (i - 1) * w, vals, w, label=SHORT[k],
                   color=COLOURS[k], alpha=0.85)

    ax_sig.set_xticks(x)
    ax_sig.set_xticklabels(short_ep, fontsize=8)
    ax_sig.set_title('Signal Lag: Days from Price Peak to First Exit Signal',
                     fontsize=11, fontweight='bold')
    ax_sig.set_ylabel('Days')
    ax_sig.legend(fontsize=10)
    ax_sig.grid(True, alpha=0.3, axis='y')
    ax_sig.axhline(0, color='black', linewidth=0.8, linestyle='--')
    ax_sig.text(0.01, 0.02, 'Negative = signal BEFORE peak (rare)',
                transform=ax_sig.transAxes, fontsize=8, color='gray')

    fig.suptitle('WO17 -- Recovery Time & Signal Timing by Episode',
                 fontsize=14, fontweight='bold')
    fig.savefig(os.path.join(CHARTS_DIR, 'recovery_timing_wo17.png'), dpi=150)
    plt.close(fig)

    # ---- Chart 4: Post-event 6m return + Cash at trough ----
    fig = plt.figure(figsize=(18, 10))
    gs  = GridSpec(2, 1, figure=fig, hspace=0.55)
    ax_post  = fig.add_subplot(gs[0])
    ax_cash  = fig.add_subplot(gs[1])

    # Post-6m return
    for i, k in enumerate(COLS):
        vals = []
        for ep_name in ep_names:
            d = ep_stats[ep_name].get(k, {})
            v = d.get('post_6m_return', float('nan')) if d else float('nan')
            vals.append(v * 100 if not np.isnan(v) else np.nan)
        bars = ax_post.bar(x + (i - 1) * w, vals, w, label=SHORT[k],
                           color=COLOURS[k], alpha=0.85)

    ax_post.set_xticks(x)
    ax_post.set_xticklabels(short_ep, fontsize=8)
    ax_post.set_title('Post-Event 6-Month Return (126 trading days after episode end)',
                      fontsize=11, fontweight='bold')
    ax_post.set_ylabel('Return (%)')
    ax_post.legend(fontsize=10)
    ax_post.grid(True, alpha=0.3, axis='y')
    ax_post.axhline(0, color='black', linewidth=0.8, linestyle='--')

    # Cash at trough (%)
    for i, k in enumerate(COLS):
        vals = []
        for ep_name in ep_names:
            d = ep_stats[ep_name].get(k, {})
            v = d.get('cash_pct_at_trough', 0.0) if d else 0.0
            vals.append(v * 100)
        ax_cash.bar(x + (i - 1) * w, vals, w, label=SHORT[k],
                    color=COLOURS[k], alpha=0.85)

    ax_cash.set_xticks(x)
    ax_cash.set_xticklabels(short_ep, fontsize=8)
    ax_cash.set_title('Cash Held at Portfolio Trough (% of total equity)',
                      fontsize=11, fontweight='bold')
    ax_cash.set_ylabel('Cash %')
    ax_cash.legend(fontsize=10)
    ax_cash.grid(True, alpha=0.3, axis='y')

    fig.suptitle('WO17 -- Post-Event Return & Defensive Cash',
                 fontsize=14, fontweight='bold')
    fig.savefig(os.path.join(CHARTS_DIR, 'post_event_return_wo17.png'), dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Save results JSON
# ---------------------------------------------------------------------------

def _save_results(ep_stats):
    os.makedirs(METRICS_DIR, exist_ok=True)
    out = {}
    for ep_name, ep_data in ep_stats.items():
        out[ep_name] = {}
        for k, d in ep_data.items():
            row = {}
            for field, val in d.items():
                if isinstance(val, pd.Timestamp):
                    row[field] = str(val.date())
                elif isinstance(val, (np.integer, np.floating)):
                    row[field] = float(val)
                elif val is None or (isinstance(val, float) and np.isnan(val)):
                    row[field] = None
                else:
                    row[field] = val
            out[ep_name][k] = row
    ts   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(METRICS_DIR, f'wo17_episode_stats_{ts}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)


if __name__ == '__main__':
    main()
