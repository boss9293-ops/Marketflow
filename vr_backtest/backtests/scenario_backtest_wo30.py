"""
vr_backtest/backtests/scenario_backtest_wo30.py
=================================================
WO30 -- Bottom Confirmation Engine

Fixed  : Trigger = DD5<=-10% AND DD10<=-18%
         Sell    = 100% at MA250 anchor
         Vmin    = -40/-50/-60% ATH  (20% x 3 = 60% back)
         Remaining ~40%: optimize re-entry timing

Modes  :
  A  MA200 full buy          (WO29 baseline — wait for MA200 cross)
  B  Energy Decay only       (DD5 momentum improving)
  C  Box Formation only      (5d range compression)
  D  Reversal only           (close > 5d high)
  E  Combined Score          (Energy + Box + Volume + Reversal >= 2/3)

Rules  :
  A  → buy all remaining cash on MA200 cross
  B/C/D → 1st signal fire → buy 20%;  2nd fire (>=5d apart) → buy remaining
  E  → score>=2 → buy 20%;  score>=3 → buy remaining
  MA200 cross always does final mop-up + return to normal in all modes

BottomScore  = EnergyDecay + BoxFormation + VolumeShift + Reversal  (0-4)
"""
from __future__ import annotations

import sys, os, sqlite3
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import warnings
warnings.filterwarnings('ignore')

from vr_backtest.data.loader import load_tqqq
from vr_backtest.strategies.ma200_strategy      import run_ma200_strategy
from vr_backtest.strategies.adaptive_ma_strategy import run_adaptive_ma

# ── Constants ──────────────────────────────────────────────────────────────────
INITIAL_CASH    = 10_000.0
MONTHLY_CONTRIB = 250.0
RETEST_TIMEOUT  = 60
SELL_PCT        = 1.00                                  # 100% sell (WO29 F)
VMIN_LADDER     = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]   # 60%
BOTTOM_TRANCHE  = 0.20                                  # 20% of equity per bottom buy
SIGNAL_COOLDOWN = 5                                     # min days between bottom buys

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo30_out.txt'
os.makedirs(OUT_DIR, exist_ok=True)

ALL_EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2022 Fed Bear"     : ("2021-11-01", "2023-06-30"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}
CRASH_EPISODES = {k: v for k, v in ALL_EPISODES.items() if k != "2022 Fed Bear"}

MODES = {
    'A': 'MA200 full buy (baseline)',
    'B': 'Energy Decay only',
    'C': 'Box Formation only',
    'D': 'Reversal only',
    'E': 'Combined Score (>=2/>=3)',
}
STRAT_COLORS = {
    'ma200'  : '#666666', 'adapt_b': '#FF5722',
    'A'      : '#1A237E', 'B': '#1976D2',
    'C'      : '#43A047', 'D': '#FB8C00', 'E': '#E53935',
}
STRAT_LABELS = {
    'ma200': 'MA200', 'adapt_b': 'Adapt-B',
    **{k: f'{k}: {v}' for k, v in MODES.items()},
}


# ═══════════════════════════════════════════════════════════════════════════════
# DATA LOADING
# ═══════════════════════════════════════════════════════════════════════════════
def load_tqqq_volume() -> pd.DataFrame | None:
    """Load TQQQ daily volume from ohlcv_daily."""
    dbp = os.path.join(ROOT_DIR, 'marketflow', 'data', 'marketflow.db')
    if not os.path.exists(dbp):
        return None
    try:
        conn = sqlite3.connect(dbp)
        df = pd.read_sql(
            "SELECT date, volume FROM ohlcv_daily WHERE symbol='TQQQ' ORDER BY date",
            conn
        )
        conn.close()
        if df.empty:
            return None
        df['date']   = pd.to_datetime(df['date'])
        df['volume'] = pd.to_numeric(df['volume'], errors='coerce')
        return df.dropna().sort_values('date').reset_index(drop=True)
    except Exception:
        return None


def prepare_data(raw: pd.DataFrame, vol_df: pd.DataFrame | None) -> pd.DataFrame:
    data = raw.copy()
    data['date'] = pd.to_datetime(data['date'])

    s = pd.Series(data['close'].values)
    data['ma250'] = s.rolling(250, min_periods=1).mean().values

    prices = data['close'].values
    T = len(prices)
    dd5 = np.zeros(T); dd10 = np.zeros(T)
    for t in range(5,  T): dd5[t]  = prices[t] / prices[t-5]  - 1.0
    for t in range(10, T): dd10[t] = prices[t] / prices[t-10] - 1.0
    data['dd5']  = dd5
    data['dd10'] = dd10

    if vol_df is not None:
        data = data.merge(vol_df[['date', 'volume']], on='date', how='left')
        data['volume'] = data['volume'].ffill(limit=3)
    else:
        data['volume'] = np.nan
    return data


def build_crash_sig(data: pd.DataFrame) -> np.ndarray:
    return (data['dd5'].values <= -0.10) & (data['dd10'].values <= -0.18)


def apply_cooldown(sig: np.ndarray, cd: int = 20) -> np.ndarray:
    out = np.zeros(len(sig), dtype=bool)
    last = -(cd + 1)
    for i in range(len(sig)):
        if sig[i] and (i - last) > cd:
            out[i] = True; last = i
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# BOTTOM CONFIRMATION SIGNALS
# ═══════════════════════════════════════════════════════════════════════════════
def compute_signals(data: pd.DataFrame) -> dict[str, np.ndarray]:
    """
    1. Energy Decay  : DD5(t) > DD5(t-1)  and DD5(t-1) < -0.02
    2. Box Formation : 5d high-low range < 8% of close
    3. Volume Shift  : volume > 1.5x 20d avg  AND  close near 5d low
    4. Reversal      : close > max(close[t-5:t])
    score            : sum of signals (0-4)
    """
    prices = data['close'].values
    dd5    = data['dd5'].values
    T      = len(prices)

    # 1. Energy Decay
    energy = np.zeros(T, dtype=bool)
    for t in range(1, T):
        energy[t] = (dd5[t] > dd5[t-1]) and (dd5[t-1] < -0.02)

    # 2. Box Formation (5-day range compression)
    box = np.zeros(T, dtype=bool)
    for t in range(4, T):
        w   = prices[t-4:t+1]
        box[t] = (w.max() - w.min()) / prices[t] < 0.08

    # 3. Volume Shift
    vol_shift = np.zeros(T, dtype=bool)
    vol_col   = data['volume'].values if 'volume' in data.columns else np.full(T, np.nan)
    has_vol   = (~np.isnan(vol_col)).sum() > 200
    if has_vol:
        vol_ma20 = pd.Series(vol_col).rolling(20, min_periods=5).mean().values
        low5     = pd.Series(prices).rolling(5, min_periods=2).min().values
        for t in range(20, T):
            if vol_ma20[t] > 0 and not np.isnan(vol_col[t]):
                vol_spike  = vol_col[t] > vol_ma20[t] * 1.5
                near_low   = prices[t] <= low5[t] * 1.02   # within 2% of 5d low
                vol_shift[t] = bool(vol_spike and near_low)

    # 4. Reversal (close > 5-day high)
    reversal = np.zeros(T, dtype=bool)
    for t in range(5, T):
        reversal[t] = prices[t] > prices[t-5:t].max()

    score = (energy.astype(int) + box.astype(int) +
             vol_shift.astype(int) + reversal.astype(int))

    return {'energy': energy, 'box': box, 'volume': vol_shift,
            'reversal': reversal, 'score': score,
            'has_vol': has_vol}


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
def run_bottom_confirm_strategy(data: pd.DataFrame,
                                crash_sig: np.ndarray,
                                mode: str,
                                signals: dict) -> dict:
    """
    100% sell + Vmin ladder (60%) + bottom confirmation for remaining ~40%.
    mode A : MA200 full buy
    mode B/C/D : single signal → 20% on 1st fire, remaining on 2nd fire (>=5d)
    mode E : combined score >= 2 → 20%, >= 3 → remaining
    All modes: MA200 cross is final mop-up + return to normal.
    """
    prices   = data['close'].values
    ma200    = data['ma200'].values
    dd_arr   = data['drawdown'].values
    dates    = data['date'].values
    anchor_v = data['ma250'].values
    T        = len(prices)

    sig_map = {'B': signals['energy'], 'C': signals['box'], 'D': signals['reversal']}

    equity       = np.zeros(T)
    sell_log     = []
    reentry_log  = []   # all buy events in defensive (vmin + bottom + ma200)
    episode_log  = []   # per-episode summary

    shares = INITIAL_CASH / prices[0]
    cash   = 0.0
    state  = 'normal'

    armed_t = 0; armed_price = 0.0; armed_dist = 0.0
    ladder_done       = [False, False, False]
    bottom_t1_done    = False
    bottom_t2_done    = False
    last_bottom_t     = -999
    crash_cooldown    = 0

    def_sell_t     = None
    def_sell_price = None

    equity[0]  = shares * prices[0]
    prev_month = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price  = prices[t]
        ma200t = ma200[t] if (not np.isnan(ma200[t]) and ma200[t] > 0) else price
        dd_ath = dd_arr[t]
        date   = dates[t]

        curr_month = pd.Timestamp(date).month
        if curr_month != prev_month:
            cash      += MONTHLY_CONTRIB
            shares    += MONTHLY_CONTRIB / price
            prev_month = curr_month

        av = anchor_v[t]
        if np.isnan(av) or av <= 0:
            av = None

        # ── ARMED ──────────────────────────────────────────────────────────────
        if state == 'armed':
            days_armed = t - armed_t
            cur_av = av if av else price
            do_sell = False; stype = 'armed'
            if price >= cur_av * 0.995:
                do_sell = True
            elif days_armed >= RETEST_TIMEOUT:
                do_sell = True; stype = 'timeout'
            if do_sell:
                sell_sh = shares * SELL_PCT
                cash   += sell_sh * price; shares -= sell_sh
                sell_log.append({'t': t, 'date': date, 'price': price,
                                 'type': stype, 'sig_price': armed_price,
                                 'days_wait': days_armed})
                def_sell_t = t; def_sell_price = price
                state = 'defensive'
                ladder_done   = [False, False, False]
                bottom_t1_done = False; bottom_t2_done = False
                last_bottom_t  = -999

        # ── DEFENSIVE ──────────────────────────────────────────────────────────
        elif state == 'defensive':
            equity_now = cash + shares * price

            # 1) Vmin ladder
            for i, (vlevel, vbuy_pct) in enumerate(VMIN_LADDER):
                if not ladder_done[i] and dd_ath <= vlevel:
                    ladder_done[i] = True
                    buy_val = min(equity_now * vbuy_pct, cash)
                    if buy_val > 10:
                        shares += buy_val / price; cash -= buy_val
                        reentry_log.append({'t': t, 'date': date, 'price': price,
                                            'type': f'vmin{vlevel:.0%}',
                                            'sell_price': def_sell_price or price})

            # 2) Bottom confirmation (for remaining ~40%)
            equity_now = cash + shares * price
            if cash > equity_now * 0.05:   # still meaningful cash to deploy
                if mode == 'A':
                    pass   # MA200 handles everything

                elif mode in ('B', 'C', 'D'):
                    sig_arr = sig_map[mode]
                    if sig_arr[t]:
                        if not bottom_t1_done and (t - last_bottom_t) >= SIGNAL_COOLDOWN:
                            buy_val = min(equity_now * BOTTOM_TRANCHE, cash)
                            if buy_val > 10:
                                shares += buy_val / price; cash -= buy_val
                                bottom_t1_done = True; last_bottom_t = t
                                reentry_log.append({'t': t, 'date': date, 'price': price,
                                                    'type': f'bottom1_{mode}',
                                                    'sell_price': def_sell_price or price})
                        elif bottom_t1_done and not bottom_t2_done and (t - last_bottom_t) >= SIGNAL_COOLDOWN:
                            buy_val = cash
                            if buy_val > 10:
                                shares += buy_val / price; cash = 0.0
                                bottom_t2_done = True; last_bottom_t = t
                                reentry_log.append({'t': t, 'date': date, 'price': price,
                                                    'type': f'bottom2_{mode}',
                                                    'sell_price': def_sell_price or price})

                elif mode == 'E':
                    sc = int(signals['score'][t])
                    if sc >= 2 and not bottom_t1_done and (t - last_bottom_t) >= SIGNAL_COOLDOWN:
                        buy_val = min(equity_now * BOTTOM_TRANCHE, cash)
                        if buy_val > 10:
                            shares += buy_val / price; cash -= buy_val
                            bottom_t1_done = True; last_bottom_t = t
                            reentry_log.append({'t': t, 'date': date, 'price': price,
                                                'type': 'bottom1_E', 'score': sc,
                                                'sell_price': def_sell_price or price})
                    if sc >= 3 and not bottom_t2_done and (t - last_bottom_t) >= SIGNAL_COOLDOWN:
                        buy_val = cash
                        if buy_val > 10:
                            shares += buy_val / price; cash = 0.0
                            bottom_t2_done = True; last_bottom_t = t
                            reentry_log.append({'t': t, 'date': date, 'price': price,
                                                'type': 'bottom2_E', 'score': sc,
                                                'sell_price': def_sell_price or price})

            # 3) MA200 final mop-up + return to normal
            if price > ma200t and crash_cooldown <= 0:
                if cash > 10:
                    reentry_log.append({'t': t, 'date': date, 'price': price,
                                        'type': 'ma200_mopup',
                                        'sell_price': def_sell_price or price,
                                        'cash_remaining': cash})
                    shares += cash / price; cash = 0.0
                # Episode summary
                if def_sell_t is not None:
                    recovery_days = t - def_sell_t
                    episode_log.append({
                        'sell_t'      : def_sell_t,
                        'sell_price'  : def_sell_price,
                        'normal_t'    : t,
                        'normal_price': price,
                        'recovery_days': recovery_days,
                        'bottom_t1_done': bottom_t1_done,
                        'bottom_t2_done': bottom_t2_done,
                    })
                state = 'normal'
                ladder_done    = [False, False, False]
                bottom_t1_done = False; bottom_t2_done = False
                def_sell_t = def_sell_price = None
                crash_cooldown = 10

        # ── NORMAL ─────────────────────────────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0:
                dist200 = (price - ma200t) / ma200t if ma200t > 0 else 0
                if av is None or price >= av * 0.995:
                    sell_sh = shares * SELL_PCT
                    cash   += sell_sh * price; shares -= sell_sh
                    sell_log.append({'t': t, 'date': date, 'price': price,
                                     'type': 'immediate', 'sig_price': price,
                                     'days_wait': 0})
                    def_sell_t = t; def_sell_price = price
                    state = 'defensive'
                    ladder_done    = [False, False, False]
                    bottom_t1_done = False; bottom_t2_done = False
                    last_bottom_t  = -999
                else:
                    state = 'armed'; armed_t = t
                    armed_dist = dist200; armed_price = price

        if crash_cooldown > 0:
            crash_cooldown -= 1
        equity[t] = cash + shares * price

    ep_df  = pd.DataFrame(episode_log)  if episode_log  else pd.DataFrame()
    re_df  = pd.DataFrame(reentry_log)  if reentry_log  else pd.DataFrame()
    return {'equity': equity, 'episode_log': ep_df,
            'reentry_log': re_df, 'final': float(equity[-1])}


# ═══════════════════════════════════════════════════════════════════════════════
# METRICS
# ═══════════════════════════════════════════════════════════════════════════════
def _metrics(equity, dates):
    eq    = pd.Series(equity, index=pd.to_datetime(dates))
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr  = (eq.iloc[-1] / INITIAL_CASH) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd = float(((eq - eq.cummax()) / eq.cummax()).min())
    dr    = eq.pct_change().dropna()
    sharpe = float(dr.mean() / dr.std() * np.sqrt(252)) if dr.std() > 0 else 0.0
    return {'final': float(eq.iloc[-1]), 'cagr': cagr, 'max_dd': max_dd, 'sharpe': sharpe}


def _ep_return(equity, dates, ep_s, ep_e):
    dt  = pd.to_datetime(dates)
    idx = np.where((dt >= ep_s) & (dt <= ep_e))[0]
    if len(idx) < 2: return np.nan, np.nan
    eq   = equity[idx]
    roll = np.maximum.accumulate(eq)
    return eq[-1]/eq[0]-1, float(np.min((eq - roll) / roll))


def _recovery_stats(ep_df: pd.DataFrame, re_df: pd.DataFrame) -> dict:
    if ep_df.empty:
        return {'n': 0, 'avg_recovery': np.nan, 'avg_rebound': np.nan,
                'pct_bottom_used': np.nan, 'avg_reentry_ratio': np.nan}
    n            = len(ep_df)
    avg_rec      = ep_df['recovery_days'].mean()
    pct_bottom   = ep_df['bottom_t1_done'].mean() * 100

    # Rebound: normal_price / sell_price - 1 (+ = re-entered above sell, missed upside)
    ep_df2 = ep_df.copy()
    ep_df2['rebound'] = ep_df2.apply(
        lambda r: r['normal_price'] / r['sell_price'] - 1 if r['sell_price'] > 0 else np.nan,
        axis=1
    )
    avg_rb = ep_df2['rebound'].mean()

    # Bottom-confirm re-entry ratio: price at bottom buy / sell_price
    bottom_rows = re_df[re_df['type'].str.startswith('bottom')] if not re_df.empty else pd.DataFrame()
    if not bottom_rows.empty and 'sell_price' in bottom_rows.columns:
        ratios = bottom_rows['price'] / bottom_rows['sell_price']
        avg_re_ratio = ratios.mean()
    else:
        avg_re_ratio = np.nan

    return {'n': n, 'avg_recovery': avg_rec, 'avg_rebound': avg_rb,
            'pct_bottom_used': pct_bottom, 'avg_reentry_ratio': avg_re_ratio}


def _signal_stats_in_defensive(re_df: pd.DataFrame) -> dict:
    """Count how many bottom-confirm fires occurred vs vmin vs ma200."""
    if re_df.empty:
        return {'vmin': 0, 'bottom1': 0, 'bottom2': 0, 'ma200': 0}
    counts = re_df['type'].value_counts().to_dict()
    vmin   = sum(v for k, v in counts.items() if k.startswith('vmin'))
    b1     = sum(v for k, v in counts.items() if 'bottom1' in k)
    b2     = sum(v for k, v in counts.items() if 'bottom2' in k)
    ma200  = counts.get('ma200_mopup', 0)
    return {'vmin': vmin, 'bottom1': b1, 'bottom2': b2, 'ma200': ma200}


# ═══════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═══════════════════════════════════════════════════════════════════════════════
def make_charts(data, results, out_dir):
    dates = pd.to_datetime(data['date'].values)
    _chart_equity(dates, results, out_dir)
    _chart_perf_bars(results, out_dir)
    _chart_recovery_compare(results, out_dir)
    _chart_ep_heatmap(data, results, out_dir)
    _chart_reentry_timeline(data, results, out_dir)


def _chart_equity(dates, results, out_dir):
    fig, axes = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
    ax = axes[0]
    order = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D', 'E']
    for sn in order:
        if sn not in results: continue
        eq  = results[sn]['equity']
        lw  = 1.8 if sn in ('adapt_b', 'E') else 1.2
        ls  = '--' if sn in ('ma200', 'adapt_b') else '-'
        m   = results[sn]
        ax.semilogy(dates, eq/eq[0],
                    label=f"{STRAT_LABELS.get(sn,sn)[:30]} ({m['cagr']*100:.1f}%  S={m['sharpe']:.3f})",
                    color=STRAT_COLORS.get(sn,'#888'), lw=lw, ls=ls, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log)')
    ax.legend(loc='upper left', fontsize=7.5)
    ax.set_title('WO30 - Bottom Confirmation Engine: Equity Curves')
    ax.grid(True, alpha=0.2)

    ax2 = axes[1]
    for sn in order:
        if sn not in results: continue
        eq = results[sn]['equity']
        dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
        ax2.plot(dates, dd, color=STRAT_COLORS.get(sn,'#888'), lw=0.9, alpha=0.75)
    ax2.set_ylabel('Drawdown (%)')
    ax2.set_xlabel('Date')
    ax2.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'equity_wo30.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    equity_wo30.png')


def _chart_perf_bars(results, out_dir):
    order  = ['MA200', 'Adapt-B', 'A', 'B', 'C', 'D', 'E']
    keys   = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D', 'E']
    valid  = [(lbl, k) for lbl, k in zip(order, keys) if k in results]
    lbls   = [v[0] for v in valid]
    ks     = [v[1] for v in valid]
    colors = [STRAT_COLORS.get(k,'#888') for k in ks]
    x      = np.arange(len(ks))

    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    for ax, mk, title, fn, fmt in [
        (axes[0], 'sharpe', 'Sharpe',    lambda v: v,       '{:.3f}'),
        (axes[1], 'cagr',   'CAGR (%)',  lambda v: v*100,   '{:.1f}%'),
        (axes[2], 'max_dd', 'MaxDD (%)', lambda v: v*100,   '{:.1f}%'),
    ]:
        vals = [fn(results[k][mk]) for k in ks]
        bars = ax.bar(lbls, vals, color=colors, alpha=0.85, edgecolor='white')
        ax.set_title(title); ax.grid(True, axis='y', alpha=0.3)
        for bar, v in zip(bars, vals):
            yoff = abs(bar.get_height()) * 0.012
            ax.text(bar.get_x()+bar.get_width()/2,
                    bar.get_height() + (yoff if bar.get_height() >= 0 else -yoff*5),
                    fmt.format(v), ha='center', va='bottom', fontsize=7.5)
        ax.tick_params(axis='x', rotation=20, labelsize=8)
    fig.suptitle('WO30 - Performance by Bottom Confirmation Mode', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'perf_bars_wo30.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    perf_bars_wo30.png')


def _chart_recovery_compare(results, out_dir):
    keys   = [k for k in 'ABCDE' if k in results]
    x      = np.arange(len(keys))
    colors = [STRAT_COLORS.get(k,'#888') for k in keys]

    rec_days   = [results[k]['rec_stats']['avg_recovery'] or 0 for k in keys]
    rebound    = [(results[k]['rec_stats']['avg_rebound'] or 0)*100 for k in keys]
    pct_used   = [results[k]['rec_stats']['pct_bottom_used'] or 0 for k in keys]
    re_ratio   = [(results[k]['rec_stats']['avg_reentry_ratio'] - 1)*100
                  if not np.isnan(results[k]['rec_stats']['avg_reentry_ratio'] or np.nan) else 0
                  for k in keys]

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    for ax, vals, title, ylabel in [
        (axes[0,0], rec_days, 'Recovery Time (days to MA200 normal)', 'Days'),
        (axes[0,1], rebound,  'Avg Rebound at MA200 Re-entry\n(normal_price/sell_price-1)',
         '% vs sell price'),
        (axes[1,0], pct_used, 'Bottom Confirm Used (%)\n(% episodes where >=1 tranche fired)',
         '% episodes'),
        (axes[1,1], re_ratio, 'Bottom Confirm Re-entry Price\nvs Sell Price (%)',
         '% vs sell price'),
    ]:
        if not any(v for v in vals): continue
        bars = ax.bar(x, vals, color=colors, alpha=0.85)
        ax.axhline(0, color='black', ls='-', lw=0.5)
        for bar, v in zip(bars, vals):
            if v == 0 and ax is axes[1,1]: continue
            yoff = abs(bar.get_height()) * 0.015 + 0.3
            ax.text(bar.get_x()+bar.get_width()/2,
                    bar.get_height() + (yoff if bar.get_height() >= 0 else -yoff*3),
                    f'{v:.0f}' if abs(v) >= 10 else f'{v:.1f}',
                    ha='center', va='bottom', fontsize=9)
        ax.set_xticks(x); ax.set_xticklabels([MODES[k][:18] for k in keys], rotation=10, fontsize=8)
        ax.set_title(title); ax.set_ylabel(ylabel); ax.grid(True, axis='y', alpha=0.3)

    fig.suptitle('WO30 - Recovery & Re-entry Efficiency', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'recovery_wo30.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    recovery_wo30.png')


def _chart_ep_heatmap(data, results, out_dir):
    order = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D', 'E']
    order = [o for o in order if o in results]
    ep_names = list(CRASH_EPISODES.keys())
    dates    = data['date'].values
    mat = np.zeros((len(order), len(ep_names)))
    for i, sn in enumerate(order):
        eq = results[sn]['equity']
        for j, (en, (es, ee)) in enumerate(CRASH_EPISODES.items()):
            _, dd = _ep_return(eq, dates, es, ee)
            mat[i, j] = dd*100 if not np.isnan(dd) else 0
    fig, ax = plt.subplots(figsize=(13, 6))
    im = ax.imshow(mat, cmap='RdYlGn', aspect='auto', vmin=-80, vmax=0)
    ax.set_xticks(range(len(ep_names)))
    ax.set_xticklabels(ep_names, rotation=20, ha='right', fontsize=9)
    ax.set_yticks(range(len(order)))
    ax.set_yticklabels([STRAT_LABELS.get(n, n)[:28] for n in order], fontsize=8)
    for i in range(len(order)):
        for j in range(len(ep_names)):
            v = mat[i, j]
            ax.text(j, i, f'{v:.0f}%', ha='center', va='center',
                    fontsize=8, color='black' if v > -40 else 'white')
    plt.colorbar(im, ax=ax, label='MaxDD (%)')
    ax.set_title('WO30 - Episode MaxDD Heatmap')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'ep_heatmap_wo30.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    ep_heatmap_wo30.png')


def _chart_reentry_timeline(data, results, out_dir):
    """For each crash episode: show when each mode re-entered (bottom confirm vs MA200)."""
    dates  = pd.to_datetime(data['date'].values)
    prices = data['close'].values

    ep_list = list(CRASH_EPISODES.items())[:3]   # show first 3 episodes
    fig, axes = plt.subplots(1, len(ep_list), figsize=(15, 5))
    if len(ep_list) == 1: axes = [axes]

    for ax, (ep_name, (ep_s, ep_e)) in zip(axes, ep_list):
        mask = (dates >= ep_s) & (dates <= ep_e)
        t_ep = np.where(mask)[0]
        if len(t_ep) == 0: continue
        ep_dates = dates[t_ep]
        ep_prices = prices[t_ep]
        ax.plot(ep_dates, ep_prices / ep_prices[0], color='#90A4AE', lw=1.5, label='TQQQ', zorder=1)

        for mode_k in 'ABCDE':
            if mode_k not in results: continue
            re_df = results[mode_k].get('reentry_log', pd.DataFrame())
            if re_df.empty or 'date' not in re_df.columns: continue
            re_df['date'] = pd.to_datetime(re_df['date'])
            ep_re = re_df[(re_df['date'] >= ep_s) & (re_df['date'] <= ep_e)]
            bottom_re = ep_re[ep_re['type'].str.startswith('bottom')]
            ma200_re  = ep_re[ep_re['type'] == 'ma200_mopup']
            for _, row in bottom_re.iterrows():
                ax.axvline(row['date'], color=STRAT_COLORS.get(mode_k,'gray'),
                           lw=1.5, ls='--', alpha=0.7)
            for _, row in ma200_re.iterrows():
                ax.axvline(row['date'], color=STRAT_COLORS.get(mode_k,'gray'),
                           lw=1.0, ls=':', alpha=0.5)

        ax.set_title(f'{ep_name}', fontsize=9)
        ax.set_ylabel('Normalized Price')
        ax.grid(True, alpha=0.2)

    # legend
    from matplotlib.lines import Line2D
    handles = [Line2D([0],[0], color=STRAT_COLORS.get(k,'gray'), lw=1.5, ls='--',
                      label=f'{k} bottom confirm') for k in 'ABCDE' if k in results]
    handles.append(Line2D([0],[0], color='gray', lw=1.0, ls=':', label='MA200 mopup'))
    axes[-1].legend(handles=handles, fontsize=7, loc='upper right')

    fig.suptitle('WO30 - Re-entry Timeline per Episode (dashed=bottom confirm, dot=MA200)', fontsize=11)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'reentry_timeline_wo30.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    reentry_timeline_wo30.png')


# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL STATISTICS (how often do signals fire while in defensive state)
# ═══════════════════════════════════════════════════════════════════════════════
def compute_signal_stats_in_defensive(data, crash_sig_cd, signals):
    """Count signal fires specifically in defensive episodes (crash down periods)."""
    # Simple proxy: days when price is well below its 52w high (proxy for defensive)
    prices = data['close'].values
    peak   = data['rolling_peak'].values
    dd_ath = np.where(peak > 0, prices / peak - 1, 0)
    in_crisis = dd_ath < -0.20   # rough proxy for "during a crash"

    stats = {}
    for sig_name in ('energy', 'box', 'volume', 'reversal'):
        arr = signals[sig_name]
        total   = int(arr.sum())
        in_def  = int((arr & in_crisis).sum())
        stats[sig_name] = {'total': total, 'in_crash': in_def,
                           'rate_in_crash': in_def / max(1, in_crisis.sum()) * 100}
    return stats


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    lines = []
    def h(s=''):
        try:
            print(s)
        except UnicodeEncodeError:
            print(s.encode('cp949', errors='replace').decode('cp949'))
        lines.append(s)

    h('=' * 72)
    h('  WO30 -- Bottom Confirmation Engine')
    h('  Sell 100% + Vmin(60%) + Bottom Confirm for remaining ~40%')
    h('=' * 72); h()

    # [1] Data
    h('[1] TQQQ 데이터 로드 ...')
    raw    = load_tqqq()
    h('[2] Volume 데이터 로드 ...')
    vol_df = load_tqqq_volume()
    if vol_df is not None:
        h(f'    Volume 로드 성공: {len(vol_df)}행  '
          f'({vol_df.date.min().date()} ~ {vol_df.date.max().date()})')
    else:
        h('    Volume 없음 (Signal 3 비활성화)')

    data = prepare_data(raw, vol_df)
    T    = len(data)
    h(f'    {T}개 거래일  ({data["date"].iloc[0].date()} ~ {data["date"].iloc[-1].date()})')
    h()

    # [3] Signals
    h('[3] Bottom Confirmation 신호 계산 ...')
    signals  = compute_signals(data)
    has_vol  = signals['has_vol']
    sig_full = int(signals['score'].max())
    h(f'    에너지감쇠: {signals["energy"].sum()}일 중 신호')
    h(f'    박스형성:   {signals["box"].sum()}일 중 신호')
    h(f'    거래량급증: {signals["volume"].sum()}일 중 신호'
      + (' (비활성)' if not has_vol else ''))
    h(f'    역전신호:   {signals["reversal"].sum()}일 중 신호')
    h(f'    Score max:  {sig_full}  (score>=2: {(signals["score"]>=2).sum()}일  '
      f'score>=3: {(signals["score"]>=3).sum()}일)')
    h()

    # [4] Crash signal
    h('[4] Trigger 신호 (DD5<=-10% AND DD10<=-18%)')
    crash_raw = build_crash_sig(data)
    crash_cd  = apply_cooldown(crash_raw)
    raw_n = int(crash_raw.sum()); cd_n = int(crash_cd.sum())
    h(f'    Raw: {raw_n}개  Post-CD: {cd_n}개')

    # Signal in-crash stats
    sig_stats = compute_signal_stats_in_defensive(data, crash_cd, signals)
    h()
    h('  [신호 발생 통계 — 크래시 구간(ATH -20% 이하)]')
    h(f'  {"신호":<20}  {"전체":>6}  {"크래시구간":>10}  {"크래시비율":>10}')
    h('  ' + '-' * 52)
    for sname, label in [('energy','Energy Decay'), ('box','Box Formation'),
                          ('volume','Volume Shift'), ('reversal','Reversal')]:
        ss = sig_stats[sname]
        skip = ' (비활성)' if sname == 'volume' and not has_vol else ''
        h(f'  {label:<20}  {ss["total"]:>6}  {ss["in_crash"]:>10}  '
          f'{ss["rate_in_crash"]:>9.1f}%{skip}')
    h()

    # [5] Backtest
    h('[5] 전략 백테스트 실행 ...')
    results = {}

    h('    MA200 ...')
    r = run_ma200_strategy(data)
    r.update(_metrics(r['equity'], data['date'].values))
    results['ma200'] = r

    h('    Adapt-B ...')
    r = run_adaptive_ma(data)
    r.update(_metrics(r['equity'], data['date'].values))
    results['adapt_b'] = r

    for mode_k in 'ABCDE':
        h(f'    {mode_k}: {MODES[mode_k]} ...')
        r = run_bottom_confirm_strategy(data, crash_cd, mode_k, signals)
        r.update(_metrics(r['equity'], data['date'].values))
        r['rec_stats']  = _recovery_stats(r['episode_log'], r['reentry_log'])
        r['sig_counts'] = _signal_stats_in_defensive(r['reentry_log'])
        results[mode_k] = r
    h()

    # [6] Performance table
    h('[6] 전체 성과 비교 (2011-2026)')
    h('-' * 84)
    h(f'  {"전략":<38}  {"최종자산":>12}  {"CAGR":>7}  {"MaxDD":>7}  {"Sharpe":>7}')
    h('-' * 84)

    for key, label in [('ma200','MA200'), ('adapt_b','Adapt-B')]:
        m = results[key]
        h(f'  {label:<38}  ${m["final"]:>11,.0f}  {m["cagr"]*100:>6.1f}%  '
          f'{m["max_dd"]*100:>6.1f}%  {m["sharpe"]:>7.3f}')
    h('  ' + '·' * 80)
    for k in 'ABCDE':
        if k not in results: continue
        m = results[k]; d = m['sharpe'] - results['adapt_b']['sharpe']
        label = f'{k}: {MODES[k][:32]}'
        h(f'  {label:<38}  ${m["final"]:>11,.0f}  {m["cagr"]*100:>6.1f}%  '
          f'{m["max_dd"]*100:>6.1f}%  {m["sharpe"]:>7.3f}  (vs Adapt-B {d:+.3f})')
    h('-' * 84)
    h()

    # [7] Recovery & Re-entry Efficiency
    h('[7] Recovery Time & Re-entry Efficiency')
    h(f'  {"Mode":<5}  {"N":>4}  {"AvgRec":>8}  {"Rebound":>9}  '
      f'{"BotUsed":>8}  {"BotReentry":>11}  {"Events: Vmin/Bot1/Bot2/MA200"}')
    h('  ' + '-' * 80)
    for k in 'ABCDE':
        if k not in results: continue
        rs = results[k]['rec_stats']
        sc = results[k]['sig_counts']
        n        = rs['n']
        avg_r    = f'{rs["avg_recovery"]:.0f}d'  if not np.isnan(rs["avg_recovery"] or np.nan)  else 'N/A'
        rebound  = f'{(rs["avg_rebound"] or 0)*100:+.1f}%' if not np.isnan(rs["avg_rebound"] or np.nan) else 'N/A'
        bot_used = f'{rs["pct_bottom_used"]:.0f}%' if not np.isnan(rs["pct_bottom_used"] or np.nan) else 'N/A'
        re_ratio = f'{(rs["avg_reentry_ratio"] - 1)*100:+.1f}%' \
                   if not np.isnan(rs["avg_reentry_ratio"] or np.nan) else 'N/A'
        h(f'  {k:<5}  {n:>4}  {avg_r:>8}  {rebound:>9}  '
          f'{bot_used:>8}  {re_ratio:>11}  '
          f'V={sc["vmin"]} B1={sc["bottom1"]} B2={sc["bottom2"]} M={sc["ma200"]}')
    h()

    # [8] Episode MaxDD
    h('[8] Crash 에피소드별 MaxDD')
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'\n  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f'  {"전략":<38}  {"MaxDD":>8}  {"EpRet":>8}')
        h('  ' + '-' * 58)
        for key, lbl in [('ma200','MA200'), ('adapt_b','Adapt-B')] + \
                        [(k, f'{k}: {MODES[k][:28]}') for k in 'ABCDE' if k in results]:
            ep_ret, ep_dd = _ep_return(results[key]['equity'], data['date'].values, ep_s, ep_e)
            if np.isnan(ep_dd): continue
            h(f'  {lbl:<38}  {ep_dd*100:>7.1f}%  {ep_ret*100:>7.1f}%')
    h()

    # [9] Conclusions
    h('[9] 핵심 연구 결론')
    h('=' * 72)

    valid_k    = [k for k in 'ABCDE' if k in results]
    best_sh    = max(valid_k, key=lambda k: results[k]['sharpe'])
    best_ca    = max(valid_k, key=lambda k: results[k]['cagr'])

    h()
    h('[Q1] 최우수 Bottom Confirmation Mode?')
    for k in valid_k:
        m = results[k]; d = m['sharpe'] - results['adapt_b']['sharpe']
        mark = '  <-- Sharpe 최우수' if k == best_sh else (
               '  <-- CAGR 최우수'  if k == best_ca else '')
        h(f'  {k}: {MODES[k]:<38}  Sharpe {m["sharpe"]:.3f}'
          f'  CAGR {m["cagr"]*100:.1f}%  MaxDD {m["max_dd"]*100:.1f}%{mark}')

    h()
    h('[Q2] Bottom Confirm vs MA200 baseline (A) — Recovery 개선?')
    if 'A' in results:
        a_rec = results['A']['rec_stats']['avg_recovery']
        for k in valid_k:
            rs  = results[k]['rec_stats']
            rec = rs['avg_recovery']
            diff = (rec - a_rec) if (not np.isnan(rec) and not np.isnan(a_rec)) else np.nan
            diff_s = f'{diff:+.0f}d' if not np.isnan(diff) else 'N/A'
            bot_s  = f'{rs["pct_bottom_used"]:.0f}%' if not np.isnan(rs["pct_bottom_used"] or np.nan) else 'N/A'
            h(f'  {k}: AvgRecovery {rec:.0f}d  (vs A {diff_s})  BotUsed {bot_s}')

    h()
    h('[Q3] Re-entry Price: Bottom Confirm vs MA200 wait?')
    for k in valid_k:
        rs = results[k]['rec_stats']
        re_r_s = f'{(rs["avg_reentry_ratio"] - 1)*100:+.1f}%' \
                 if not np.isnan(rs["avg_reentry_ratio"] or np.nan) else 'N/A'
        rb_s   = f'{(rs["avg_rebound"] or 0)*100:+.1f}%' \
                 if not np.isnan(rs["avg_rebound"] or np.nan) else 'N/A'
        h(f'  {k}: BotReentry {re_r_s} vs sellPrice  |  '
          f'MA200reentry {rb_s} vs sellPrice')

    h()
    h('[WO30 최종 결론]')
    br = results[best_sh]; d = br['sharpe'] - results['adapt_b']['sharpe']
    h(f'  최우수 Mode: {best_sh} - {MODES[best_sh]}')
    h(f'  CAGR {br["cagr"]*100:.1f}%  MaxDD {br["max_dd"]*100:.1f}%  Sharpe {br["sharpe"]:.3f}')
    h(f'  Adapt-B 대비 Sharpe: {d:+.3f}')

    # [10] Charts
    h()
    h('[10] 차트 저장 중 ...')
    make_charts(data, results, OUT_DIR)
    h(f'    저장 위치: {OUT_DIR}')

    h()
    h('[11] 완료')
    h('=' * 72)

    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
