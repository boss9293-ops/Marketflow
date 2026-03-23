"""
vr_backtest/backtests/scenario_backtest_wo24.py
================================================
WO24 -- Crash Sell Location Study

DD5 <= -12% 신호 발생 시
Price vs MA200 위치 그룹별 성과 통계 분석

Groups (Dist200 = (Price - MA200) / MA200):
  G1: > +10%   G2: +5~+10%   G3: 0~+5%
  G4: 0~-5%   G5: -5~-10%   G6: < -10%

추가: MA200 slope (up / down) 교차 분석

전략 비교 (50% crash sell + Vmin ladder + MA200 re-entry):
  VR_full        : DD5 <= -12%
  VR_above       : DD5 <= -12% AND Price > MA200
  VR_slope_up    : DD5 <= -12% AND MA200 slope > 0
  VR_above_slope : DD5 <= -12% AND Price > MA200 AND slope > 0
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import warnings
warnings.filterwarnings('ignore')

from vr_backtest.data.loader import load_tqqq
from vr_backtest.strategies.ma200_strategy       import run_ma200_strategy
from vr_backtest.strategies.adaptive_ma_strategy  import run_adaptive_ma

# ── 위치 그룹 정의 ─────────────────────────────────────────────────────────────
GROUPS = [
    ('G1', '>+10%',   0.10,   1e9),
    ('G2', '+5~+10%', 0.05,  0.10),
    ('G3', '0~+5%',   0.00,  0.05),
    ('G4', '0~-5%',  -0.05,  0.00),
    ('G5', '-5~-10%',-0.10, -0.05),
    ('G6', '<-10%',  -1e9,  -0.10),
]

GROUP_COLORS = {
    'G1': '#0066cc', 'G2': '#3399ff', 'G3': '#66ccff',
    'G4': '#ffaa00', 'G5': '#ff6600', 'G6': '#cc0000',
}

EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2022 Fed Bear"     : ("2021-11-01", "2023-06-30"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}

INITIAL_CASH    = 10_000.0
MONTHLY_CONTRIB = 250.0
VMIN_LADDER     = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]

LABELS = {
    'ma200'          : 'MA200',
    'adapt_b'        : 'Adapt-B',
    'vr_full'        : 'VR_full (DD5≤-12%)',
    'vr_above'       : 'VR_above (DD5+위MA200)',
    'vr_slope'       : 'VR_slope_up (DD5+slope↑)',
    'vr_above_slope' : 'VR_above+slope↑',
}
COLORS = {
    'ma200'          : '#2255cc',
    'adapt_b'        : '#cc4400',
    'vr_full'        : '#9933ff',
    'vr_above'       : '#00aa44',
    'vr_slope'       : '#ff3344',
    'vr_above_slope' : '#ff8800',
}


# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL EXTRACTION & CLASSIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
def extract_signals(data: pd.DataFrame, dd5_thr: float = -0.12) -> pd.DataFrame:
    """
    DD5 <= threshold 신호 발생일마다:
    - Dist200, MA200 slope, 위치 그룹 분류
    - Forward returns: 5/10/20/60d
    - MaxDD in next 30d from signal price
    - Recovery days (가격이 신호 당일 가격으로 회복까지)
    - 에피소드 컨텍스트
    """
    dates   = pd.to_datetime(data['date'].values)
    prices  = data['close'].values
    ma200_a = data['ma200'].values
    T       = len(prices)

    # DD5 계산
    dd5 = np.zeros(T)
    for t in range(5, T): dd5[t] = prices[t] / prices[t-5] - 1.0

    # MA200 20일 slope
    slope20 = np.zeros(T)
    for t in range(20, T):
        slope20[t] = (ma200_a[t] - ma200_a[t-20]) / ma200_a[t-20]

    # 에피소드 태깅
    ep_tag = ['normal'] * T
    for ep_name, (ep_s, ep_e) in EPISODES.items():
        for t in range(T):
            if pd.Timestamp(ep_s) <= dates[t] <= pd.Timestamp(ep_e):
                ep_tag[t] = ep_name

    records = []
    for t in range(10, T - 60):
        if dd5[t] > dd5_thr:
            continue

        price   = prices[t]
        ma200   = ma200_a[t]
        dist200 = (price - ma200) / ma200
        slope   = slope20[t]

        # 위치 그룹
        grp_id, grp_label = 'G6', '<-10%'
        for gid, glabel, lo, hi in GROUPS:
            if lo < dist200 <= hi:
                grp_id, grp_label = gid, glabel
                break
        # G1 special case (dist200 > 0.10)
        if dist200 > 0.10:
            grp_id, grp_label = 'G1', '>+10%'

        # Forward returns
        fwd = {}
        for n in (5, 10, 20, 60):
            fwd[n] = prices[min(t + n, T-1)] / price - 1.0

        # MaxDD in next 30 days from signal price
        win30     = prices[t:min(t + 30, T)]
        max_dd30  = float(win30.min() / price - 1.0)

        # Recovery days (가격 >= signal price 첫 날까지)
        recov_d = None
        for k in range(t + 1, min(t + 120, T)):
            if prices[k] >= price:
                recov_d = k - t
                break

        # Sell favorable? (market lower 10d and 20d later)
        fav_10 = fwd[10] < 0
        fav_20 = fwd[20] < 0

        records.append({
            'date'       : dates[t],
            'price'      : price,
            'ma200'      : ma200,
            'dist200'    : dist200,
            'slope20'    : slope,
            'slope_sign' : 'up' if slope > 0 else 'down',
            'group'      : grp_id,
            'group_label': grp_label,
            'above_ma200': dist200 > 0,
            'fwd_5'      : fwd[5],
            'fwd_10'     : fwd[10],
            'fwd_20'     : fwd[20],
            'fwd_60'     : fwd[60],
            'max_dd30'   : max_dd30,
            'recov_d'    : recov_d,
            'fav_10'     : fav_10,
            'fav_20'     : fav_20,
            'episode'    : ep_tag[t],
        })

    return pd.DataFrame(records)


def group_stats(df: pd.DataFrame, by: str = 'group') -> pd.DataFrame:
    """그룹별 통계 집계"""
    rows = []
    for grp_val in df[by].unique():
        sub = df[df[by] == grp_val]
        n   = len(sub)
        rows.append({
            by              : grp_val,
            'count'         : n,
            'fav_10_pct'    : sub['fav_10'].mean() * 100,
            'fav_20_pct'    : sub['fav_20'].mean() * 100,
            'avg_fwd_10'    : sub['fwd_10'].mean() * 100,
            'avg_fwd_20'    : sub['fwd_20'].mean() * 100,
            'avg_fwd_60'    : sub['fwd_60'].mean() * 100,
            'avg_max_dd30'  : sub['max_dd30'].mean() * 100,
            'median_recov'  : sub['recov_d'].median(),
            'avg_dist200'   : sub['dist200'].mean() * 100,
        })
    if not rows:
        cols = [by, 'count', 'fav_10_pct', 'fav_20_pct', 'avg_fwd_10', 'avg_fwd_20',
                'avg_fwd_60', 'avg_max_dd30', 'median_recov', 'avg_dist200']
        return pd.DataFrame(columns=cols)
    return pd.DataFrame(rows)


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE (50% crash sell + Vmin ladder + MA200 re-entry)
# ═══════════════════════════════════════════════════════════════════════════════
def run_location_strategy(data         : pd.DataFrame,
                          trigger_sig  : np.ndarray,
                          name         : str,
                          initial_cash : float = INITIAL_CASH,
                          monthly_contrib: float = MONTHLY_CONTRIB) -> dict:
    """
    50% crash sell on trigger_sig.
    Re-entry: Vmin ladder (-40/-50/-60% ATH) + MA200 full.
    Normal mode: buy-and-hold with DCA.
    """
    dates   = data['date'].values
    prices  = data['close'].values
    ma200_a = data['ma200'].values
    dd_arr  = data['drawdown'].values
    T       = len(dates)

    equity   = np.zeros(T)
    cash_arr = np.zeros(T)
    tlog     = []

    shares       = initial_cash / prices[0]
    cash         = 0.0
    in_crash     = False
    crash_sold   = False
    ladder_done  = [False, False, False]

    tlog.append((dates[0], "BUY_INIT", prices[0], shares, 0.0))
    equity[0]   = shares * prices[0]
    cash_arr[0] = 0.0
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price  = prices[t]
        ma200  = ma200_a[t]
        dd_ath = dd_arr[t]
        trigger = bool(trigger_sig[t])

        curr_month = pd.Timestamp(dates[t]).month
        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        if not in_crash:
            if cash > 0.5:
                ns = cash / price; shares += ns; cash = 0.0
                tlog.append((dates[t], "DCA", price, ns, 0.0))

            if trigger and shares > 0.01:
                ss = shares * 0.50
                cash += ss * price; shares -= ss
                in_crash    = True
                crash_sold  = True
                ladder_done = [False, False, False]
                tlog.append((dates[t], "CRASH_SELL_50", price, ss, cash))
        else:
            # Vmin ladder re-entry
            for i, (thr, pct) in enumerate(VMIN_LADDER):
                if not ladder_done[i] and dd_ath <= thr and cash > 1.0:
                    pv = shares * price + cash
                    bv = min(pv * pct, cash)
                    if bv > 1.0:
                        ns = bv / price; shares += ns; cash -= bv
                        tlog.append((dates[t], f"VMIN_{int(abs(thr)*100)}",
                                     price, ns, cash))
                    ladder_done[i] = True

            if price > ma200 and cash > 0.5:
                ns = cash / price; shares += ns
                tlog.append((dates[t], "MA200_REENTRY", price, ns, 0.0))
                cash = 0.0
                in_crash    = False
                crash_sold  = False
                ladder_done = [False, False, False]

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    years   = T / 252
    cagr    = (equity[-1] / equity[0]) ** (1/years) - 1
    peak    = np.maximum.accumulate(equity)
    dd_s    = (equity - peak) / peak
    max_dd  = float(dd_s.min())
    rets    = np.diff(equity) / equity[:-1]
    sharpe  = rets.mean() / rets.std() * np.sqrt(252) if rets.std() > 0 else 0.0
    in_dd   = dd_s < -0.01
    recov_d = int(np.where(in_dd)[0][-1] - np.where(in_dd)[0][0]) if in_dd.any() else 0

    return {
        'equity' : equity, 'cash': cash_arr, 'tlog': tlog,
        'final'  : float(equity[-1]),
        'cagr'   : cagr, 'max_dd': max_dd, 'sharpe': sharpe, 'recov_d': recov_d,
    }


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
def make_charts(data, sig_df, results, out_dir):
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values

    _chart_scatter(sig_df, out_dir)
    _chart_group_stats(sig_df, out_dir)
    _chart_slope_2x2(sig_df, out_dir)
    _chart_equity(dates, results, out_dir)
    _chart_signal_dist(data, sig_df, dates, prices, out_dir)


def _chart_scatter(sig_df, out_dir):
    """Dist200 vs Forward 20d return — scatter"""
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    for ax, col, title in zip(
            axes,
            ['fwd_20', 'max_dd30'],
            ['Forward 20d Return (%)', 'MaxDD in Next 30d (%)']):
        for gid in ['G1','G2','G3','G4','G5','G6']:
            sub = sig_df[sig_df['group'] == gid]
            if len(sub) == 0: continue
            ax.scatter(sub['dist200'] * 100, sub[col] * 100,
                       color=GROUP_COLORS[gid], alpha=0.5, s=15, label=gid)

        ax.axvline(0, color='k', lw=1.0, ls='--', alpha=0.5)
        ax.axhline(0, color='k', lw=0.5)
        ax.set_xlabel("Dist200 (%)")
        ax.set_ylabel(title)
        ax.set_title(f"Signal Location vs {title}")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.2)

        # Trend line
        x = sig_df['dist200'].values * 100
        y = sig_df[col].values * 100
        valid = ~np.isnan(y)
        if valid.sum() > 5:
            z = np.polyfit(x[valid], y[valid], 1)
            xr = np.linspace(x.min(), x.max(), 100)
            ax.plot(xr, np.polyval(z, xr), 'k--', lw=1.2, alpha=0.6, label='trend')

    fig.suptitle("WO24 — Crash Signal Location vs Outcome", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "scatter_wo24.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    scatter_wo24.png")


def _chart_group_stats(sig_df, out_dir):
    """그룹별 통계 막대 그래프"""
    grp_order = ['G1','G2','G3','G4','G5','G6']
    colors    = [GROUP_COLORS[g] for g in grp_order]

    stats = group_stats(sig_df, 'group').set_index('group').reindex(grp_order)

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    # Panel 1: avg_fwd_20
    ax = axes[0, 0]
    vals = stats['avg_fwd_20'].values
    bars = ax.bar(grp_order, vals, color=colors, alpha=0.85)
    ax.axhline(0, color='k', lw=0.5)
    ax.set_title("Avg Forward 20d Return by Group")
    ax.set_ylabel("Return (%)")
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, v + 0.2 * np.sign(v),
                f'{v:.1f}%', ha='center', fontsize=8)

    # Panel 2: avg_max_dd30
    ax = axes[0, 1]
    vals = stats['avg_max_dd30'].values
    bars = ax.bar(grp_order, vals, color=colors, alpha=0.85)
    ax.set_title("Avg MaxDD (Next 30d) by Group")
    ax.set_ylabel("MaxDD (%)")
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, v - 0.5,
                f'{v:.1f}%', ha='center', fontsize=8, va='top')

    # Panel 3: favorable sell rate (fav_20)
    ax = axes[1, 0]
    vals = stats['fav_20_pct'].values
    bars = ax.bar(grp_order, vals, color=colors, alpha=0.85)
    ax.axhline(50, color='k', lw=0.8, ls='--', alpha=0.5, label='50% baseline')
    ax.set_title("Favorable Sell Rate — 20d (market lower after sell %)")
    ax.set_ylabel("% Favorable")
    ax.set_ylim(0, 100)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, v + 1,
                f'{v:.0f}%', ha='center', fontsize=9)

    # Panel 4: avg recovery days
    ax = axes[1, 1]
    vals = stats['median_recov'].values
    bars = ax.bar(grp_order, vals, color=colors, alpha=0.85)
    ax.set_title("Median Recovery Days (back to signal price)")
    ax.set_ylabel("Days")
    for bar, v in zip(bars, vals):
        if not np.isnan(v):
            ax.text(bar.get_x() + bar.get_width()/2, v + 0.5,
                    f'{v:.0f}d', ha='center', fontsize=8)

    for ax in axes.flat:
        ax.set_xlabel("Location Group")
        ax.grid(True, alpha=0.2, axis='y')

    fig.suptitle("WO24 — Signal Group Statistics (dd5 ≤ -12%)", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "group_stats_wo24.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    group_stats_wo24.png")


def _chart_slope_2x2(sig_df, out_dir):
    """MA200 위치 × slope 2×2 분석"""
    fig, axes = plt.subplots(2, 2, figsize=(12, 9))

    quadrants = [
        (True,  'up',   '위MA200 + slope↑', '#0066cc'),
        (True,  'down', '위MA200 + slope↓', '#3399ff'),
        (False, 'up',   '아래MA200 + slope↑', '#ff8800'),
        (False, 'down', '아래MA200 + slope↓', '#cc0000'),
    ]

    for ax, (above, sslope, title, color) in zip(axes.flat, quadrants):
        sub = sig_df[(sig_df['above_ma200'] == above) &
                     (sig_df['slope_sign'] == sslope)]
        n = len(sub)

        metrics = [
            ('fav_20_pct',    'Fav 20d %'),
            ('avg_fwd_20',    'Fwd 20d %'),
            ('avg_max_dd30',  'MaxDD 30d %'),
        ]
        _gs = group_stats(sub, 'group')
        if _gs.empty or 'group' not in _gs.columns:
            ax.set_title(f"{title}  (N={n}, no data)")
            ax.set_ylabel("Favorable Sell % (20d)")
            ax.grid(True, alpha=0.2)
            continue
        stats = _gs.set_index('group')

        grp_order = ['G1','G2','G3','G4','G5','G6']
        grp_order = [g for g in grp_order if g in stats.index]

        if len(grp_order) > 0:
            x = np.arange(len(grp_order))
            ax.bar(x, stats.loc[grp_order, 'fav_20_pct'].values,
                   color=color, alpha=0.8)
            ax.axhline(50, color='k', lw=0.8, ls='--', alpha=0.5)
            ax.set_xticks(x)
            ax.set_xticklabels(grp_order, fontsize=9)
            ax.set_ylim(0, 100)
        ax.set_title(f"{title}  (N={n})")
        ax.set_ylabel("Favorable Sell % (20d)")
        ax.grid(True, alpha=0.2)

    fig.suptitle("WO24 — MA200 Position × Slope: Favorable Sell Rate", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "slope_2x2_wo24.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    slope_2x2_wo24.png")


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)

    ax = axes[0]
    for k, res in results.items():
        ax.semilogy(dates, res['equity'], color=COLORS[k], lw=1.3, label=LABELS[k])
    ax.set_title("Equity Curves: VR Trigger Filter Comparison")
    ax.set_ylabel("Portfolio ($, log)")
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.2)

    ax = axes[1]
    for k, res in results.items():
        eq   = res['equity']
        peak = np.maximum.accumulate(eq)
        dd   = (eq - peak) / peak * 100
        ax.plot(dates, dd, color=COLORS[k], lw=1.1, label=LABELS[k])
    ax.axhline(0, color='k', lw=0.4)
    ax.set_title("Drawdown Comparison")
    ax.set_ylabel("DD (%)")
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.2)

    fig.suptitle("WO24 — Strategy Comparison by Trigger Filter", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "equity_wo24.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    equity_wo24.png")


def _chart_signal_dist(data, sig_df, dates, prices, out_dir):
    """신호 발생 위치 시계열 + Dist200 분포"""
    fig, axes = plt.subplots(3, 1, figsize=(14, 12), sharex=False)

    # Panel 1: TQQQ price + signal markers (colored by group)
    ax = axes[0]
    ax.semilogy(dates, prices, color='#333', lw=1.0, alpha=0.7)
    for gid in ['G1','G2','G3','G4','G5','G6']:
        sub = sig_df[sig_df['group'] == gid]
        if len(sub) == 0: continue
        ax.scatter(sub['date'], sub['price'], color=GROUP_COLORS[gid],
                   s=18, alpha=0.7, zorder=5, label=f"{gid}: {len(sub)}")
    ax.set_title("TQQQ Price + Signal Locations (colored by group)")
    ax.set_ylabel("Price (log)")
    ax.legend(fontsize=8, loc='upper left', ncol=3)
    ax.set_xlim(dates[0], dates[-1])

    # Panel 2: Dist200 at signal time (histogram by group)
    ax = axes[1]
    for gid in ['G1','G2','G3','G4','G5','G6']:
        sub = sig_df[sig_df['group'] == gid]
        if len(sub) == 0: continue
        ax.hist(sub['dist200'] * 100, bins=20, color=GROUP_COLORS[gid],
                alpha=0.6, label=f"{gid}({len(sub)})", density=False)
    ax.axvline(0, color='k', lw=1.5, ls='--')
    ax.set_xlabel("Dist200 (%)")
    ax.set_ylabel("Signal Count")
    ax.set_title("Distribution of Dist200 at Signal")
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.2)

    # Panel 3: Fwd 20d return by group (box plot)
    ax = axes[2]
    grp_order = ['G1','G2','G3','G4','G5','G6']
    grp_data  = [sig_df[sig_df['group'] == g]['fwd_20'].values * 100
                 for g in grp_order]
    bp = ax.boxplot(grp_data, labels=grp_order, patch_artist=True,
                    medianprops={'color': 'black', 'lw': 1.5})
    for patch, gid in zip(bp['boxes'], grp_order):
        patch.set_facecolor(GROUP_COLORS[gid])
        patch.set_alpha(0.7)
    ax.axhline(0, color='k', lw=0.8, ls='--')
    ax.set_xlabel("Location Group")
    ax.set_ylabel("Forward 20d Return (%)")
    ax.set_title("20d Return Distribution by Group")
    ax.grid(True, alpha=0.2, axis='y')

    fig.suptitle("WO24 — Signal Distribution & Location Analysis", fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "signal_dist_wo24.png"), dpi=110, bbox_inches='tight')
    plt.close()
    print("    signal_dist_wo24.png")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    dirname = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
    OUT_DIR = (f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
               r'\vr_backtest\results\charts')
    os.makedirs(OUT_DIR, exist_ok=True)

    print("=" * 72)
    print("  WO24 -- Crash Sell Location Study")
    print("  DD5 <= -12% 신호: MA200 대비 위치와 성과의 관계")
    print("=" * 72)

    # [1] 데이터
    print("\n[1] TQQQ 데이터 로드 ...")
    data   = load_tqqq()
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values
    T      = len(dates)
    print(f"    {T}개 거래일  ({dates[0].date()} → {dates[-1].date()})")

    # [2] 신호 추출 및 분류
    print("\n[2] DD5 <= -12% 신호 추출 및 분류 ...")
    sig_df = extract_signals(data, dd5_thr=-0.12)
    total  = len(sig_df)
    print(f"    전체 신호: {total}개")
    print()

    # 그룹별 카운트
    print("    그룹별 신호 수:")
    for gid, glabel, lo, hi in GROUPS:
        cnt  = (sig_df['group'] == gid).sum()
        pct  = cnt / total * 100 if total > 0 else 0
        abv  = sig_df[(sig_df['group'] == gid) & sig_df['above_ma200']].shape[0]
        print(f"      {gid} ({glabel:>10}): {cnt:>4}개 ({pct:>4.1f}%)")

    above = sig_df['above_ma200'].sum()
    below = (~sig_df['above_ma200']).sum()
    print(f"\n    MA200 위:  {above}개 ({above/total*100:.1f}%)")
    print(f"    MA200 아래: {below}개 ({below/total*100:.1f}%)")

    slope_up   = (sig_df['slope_sign'] == 'up').sum()
    slope_down = (sig_df['slope_sign'] == 'down').sum()
    print(f"    Slope 상승: {slope_up}개 ({slope_up/total*100:.1f}%)")
    print(f"    Slope 하락: {slope_down}개 ({slope_down/total*100:.1f}%)")

    # [3] 그룹별 통계
    print("\n[3] 그룹별 성과 통계")
    print()
    print(f"  {'그룹':<12} {'N':>5} {'Fav10':>7} {'Fav20':>7} "
          f"{'Fwd10':>8} {'Fwd20':>8} {'Fwd60':>8} "
          f"{'MaxDD30':>9} {'Recov':>7}")
    print("  " + "-" * 75)

    grp_stat = group_stats(sig_df, 'group')
    for gid, glabel, lo, hi in GROUPS:
        row = grp_stat[grp_stat['group'] == gid]
        if len(row) == 0: continue
        r = row.iloc[0]
        recov = f"{r['median_recov']:.0f}d" if not np.isnan(r['median_recov']) else "n/a"
        print(f"  {gid} ({glabel:>8})"
              f"  {r['count']:>4}"
              f"  {r['fav_10_pct']:>5.0f}%"
              f"  {r['fav_20_pct']:>5.0f}%"
              f"  {r['avg_fwd_10']:>6.1f}%"
              f"  {r['avg_fwd_20']:>6.1f}%"
              f"  {r['avg_fwd_60']:>6.1f}%"
              f"  {r['avg_max_dd30']:>7.1f}%"
              f"  {recov:>6}")

    # [4] MA200 위/아래 집계
    print("\n[4] MA200 위치별 요약")
    print()
    for above_flag, label in [(True, 'MA200 위'), (False, 'MA200 아래')]:
        sub  = sig_df[sig_df['above_ma200'] == above_flag]
        n    = len(sub)
        fav20 = sub['fav_20'].mean() * 100
        fwd20 = sub['fwd_20'].mean() * 100
        fwd60 = sub['fwd_60'].mean() * 100
        mdd30 = sub['max_dd30'].mean() * 100
        recov = sub['recov_d'].median()
        recov_str = f"{recov:.0f}d" if not np.isnan(recov) else "n/a"
        print(f"  {label}  (N={n}): Fav20={fav20:.0f}%  "
              f"Fwd20={fwd20:+.1f}%  Fwd60={fwd60:+.1f}%  "
              f"MaxDD30={mdd30:.1f}%  RecovMed={recov_str}")

    # [5] MA200 slope 교차 분석
    print("\n[5] MA200 위치 × Slope 교차 분석 (Fav20 / Fwd20 / MaxDD30)")
    print()
    print(f"  {'구분':<24} {'N':>5} {'Fav20':>7} {'Fwd20':>8} {'MaxDD30':>9}")
    print("  " + "-" * 58)
    for above_flag, slope_s, label in [
        (True,  'up',   'MA200위 + slope↑'),
        (True,  'down', 'MA200위 + slope↓'),
        (False, 'up',   'MA200아래 + slope↑'),
        (False, 'down', 'MA200아래 + slope↓'),
    ]:
        sub  = sig_df[(sig_df['above_ma200'] == above_flag) &
                      (sig_df['slope_sign'] == slope_s)]
        n    = len(sub)
        if n == 0: print(f"  {label:<24}    0    n/a"); continue
        fav20 = sub['fav_20'].mean() * 100
        fwd20 = sub['fwd_20'].mean() * 100
        mdd30 = sub['max_dd30'].mean() * 100
        print(f"  {label:<24} {n:>4}  {fav20:>5.0f}%  {fwd20:>6.1f}%  {mdd30:>7.1f}%")

    # [6] 에피소드별 신호 위치 분포
    print("\n[6] 에피소드별 신호 위치 분포")
    print()
    ep_list = list(EPISODES.keys()) + ['normal']
    print(f"  {'에피소드':<22} {'N':>4}  {'위MA200':>8}  {'Fav20':>7}  "
          f"{'Fwd20':>8}  {'AvgDist':>9}")
    print("  " + "-" * 65)
    for ep in ep_list:
        sub = sig_df[sig_df['episode'] == ep]
        n   = len(sub)
        if n == 0: continue
        above_pct = sub['above_ma200'].mean() * 100
        fav20     = sub['fav_20'].mean()  * 100
        fwd20     = sub['fwd_20'].mean()  * 100
        avg_dist  = sub['dist200'].mean() * 100
        ep_short  = ep[:20] if len(ep) > 20 else ep
        print(f"  {ep_short:<22} {n:>3}  {above_pct:>7.0f}%  {fav20:>5.0f}%  "
              f"{fwd20:>6.1f}%  {avg_dist:>8.1f}%")

    # [7] 전략 비교
    print("\n[7] 전략 비교 (Trigger Filter별)")

    # Build trigger signals
    dd5_raw = np.zeros(T)
    for t in range(5, T): dd5_raw[t] = prices[t] / prices[t-5] - 1.0

    ma200_a  = data['ma200'].values
    slope20a = np.zeros(T)
    for t in range(20, T):
        slope20a[t] = (ma200_a[t] - ma200_a[t-20]) / ma200_a[t-20]

    dist200a = np.where(ma200_a > 0, (prices - ma200_a) / ma200_a, 0)

    sig_full        = (dd5_raw <= -0.12)
    sig_above       = sig_full & (dist200a > 0)
    sig_slope_up    = sig_full & (slope20a > 0)
    sig_above_slope = sig_full & (dist200a > 0) & (slope20a > 0)

    for k, sig in [('vr_full', sig_full), ('vr_above', sig_above),
                   ('vr_slope', sig_slope_up), ('vr_above_slope', sig_above_slope)]:
        print(f"    {LABELS[k]}: {sig.sum()}개 신호")

    print()
    print("    전략 실행 중 ...")
    print("    MA200 ...")
    res_ma200 = _add_metrics(run_ma200_strategy(data), T)
    print("    Adapt-B ...")
    res_adapt = _add_metrics(run_adaptive_ma(data), T)

    results = {
        'ma200'  : res_ma200,
        'adapt_b': res_adapt,
    }
    for k, sig in [('vr_full', sig_full), ('vr_above', sig_above),
                   ('vr_slope', sig_slope_up), ('vr_above_slope', sig_above_slope)]:
        print(f"    {LABELS[k]} ...")
        results[k] = run_location_strategy(data, sig, k)

    print()
    print("\n[7] 전략 성과 비교")
    print("-" * 70)
    print(f"  {'전략':<28} {'최종':>12} {'CAGR':>7} {'MaxDD':>7} {'Sharpe':>7} {'신호수':>6}")
    print("-" * 70)
    sig_counts = {
        'ma200': '-', 'adapt_b': '-',
        'vr_full': str(sig_full.sum()),
        'vr_above': str(sig_above.sum()),
        'vr_slope': str(sig_slope_up.sum()),
        'vr_above_slope': str(sig_above_slope.sum()),
    }
    for k, res in results.items():
        lbl = LABELS.get(k, k)
        print(f"  {lbl:<28} ${res['final']:>11,.0f}"
              f"  {res['cagr']*100:>5.1f}%"
              f"  {res['max_dd']*100:>5.1f}%"
              f"  {res['sharpe']:>5.3f}"
              f"  {sig_counts[k]:>6}")
    print("-" * 70)

    # [8] 연구 질문 답변
    print("\n[8] 연구 질문 답변")
    print("-" * 72)

    # Calculate key stats for answers
    g_above = sig_df[sig_df['above_ma200']]
    g_below = sig_df[~sig_df['above_ma200']]
    fav20_above = g_above['fav_20'].mean() * 100 if len(g_above) > 0 else 0
    fav20_below = g_below['fav_20'].mean() * 100 if len(g_below) > 0 else 0
    fwd20_above = g_above['fwd_20'].mean() * 100 if len(g_above) > 0 else 0
    fwd20_below = g_below['fwd_20'].mean() * 100 if len(g_below) > 0 else 0

    # G1+G2 vs G4+G5+G6
    g_far_above = sig_df[sig_df['group'].isin(['G1', 'G2'])]
    g_deep_below = sig_df[sig_df['group'].isin(['G5', 'G6'])]
    fav20_far   = g_far_above['fav_20'].mean() * 100 if len(g_far_above) > 0 else 0
    fav20_deep  = g_deep_below['fav_20'].mean() * 100 if len(g_deep_below) > 0 else 0

    r_full  = results['vr_full']
    r_above = results['vr_above']
    r_slope = results['vr_slope']
    r_as    = results['vr_above_slope']

    print(f"""
  ■ Q1. Crash sell은 MA200 위에서 더 효과적인가?
    - MA200 위 신호 (N={len(g_above)}): Fav20 {fav20_above:.0f}%  Fwd20 {fwd20_above:+.1f}%
    - MA200 아래 신호 (N={len(g_below)}): Fav20 {fav20_below:.0f}%  Fwd20 {fwd20_below:+.1f}%
    - G1/G2 (>+5%, N={len(g_far_above)}): Fav20 {fav20_far:.0f}%
    - G5/G6 (<-5%, N={len(g_deep_below)}): Fav20 {fav20_deep:.0f}%
    → {'MA200 위 신호가 더 효과적 (Fav20 높음)' if fav20_above > fav20_below else 'MA200 위/아래 차이 미미'}

  ■ Q2. MA200 아래에서는 VR sell이 성과를 악화시키는가?
    - VR_full   Sharpe {r_full['sharpe']:.3f}   CAGR {r_full['cagr']*100:.1f}%
    - VR_above  Sharpe {r_above['sharpe']:.3f}   CAGR {r_above['cagr']*100:.1f}%
    - Adapt-B   Sharpe {res_adapt['sharpe']:.3f}   CAGR {res_adapt['cagr']*100:.1f}%
    → {'VR_above > VR_full → MA200 아래 신호 제거 시 개선' if r_above['sharpe'] > r_full['sharpe'] else 'MA200 필터 효과 미미'}

  ■ Q3. MA200 slope 필터가 필요한가?
    - VR_slope_up   Sharpe {r_slope['sharpe']:.3f}   CAGR {r_slope['cagr']*100:.1f}%
    - VR_above+slope Sharpe {r_as['sharpe']:.3f}   CAGR {r_as['cagr']*100:.1f}%
    → {'slope 필터 효과적' if r_as['sharpe'] > r_full['sharpe'] else 'slope 필터 추가 효과 미미'}

  ■ Q4. VR trigger를 DD5≤-12% AND Price>MA200으로 제한해야 하는가?
    - VR_full       : Sharpe {r_full['sharpe']:.3f}, MaxDD {r_full['max_dd']*100:.1f}%
    - VR_above      : Sharpe {r_above['sharpe']:.3f}, MaxDD {r_above['max_dd']*100:.1f}%
    - VR_above+slope: Sharpe {r_as['sharpe']:.3f}, MaxDD {r_as['max_dd']*100:.1f}%
    - Adapt-B       : Sharpe {res_adapt['sharpe']:.3f}, MaxDD {res_adapt['max_dd']*100:.1f}%
    → {'Price>MA200 필터 채택 권장' if r_above['sharpe'] > r_full['sharpe'] else 'Price>MA200 필터 성과 개선 미확인'}
""")

    # [9] 차트
    print("[9] 차트 생성 중 ...")
    make_charts(data, sig_df, results, OUT_DIR)
    print(f"    저장 위치: {OUT_DIR}")

    print("\n[10] 완료")
    print("=" * 72)


if __name__ == "__main__":
    main()
