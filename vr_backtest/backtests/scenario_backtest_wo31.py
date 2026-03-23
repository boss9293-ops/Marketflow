"""
vr_backtest/backtests/scenario_backtest_wo31.py
=================================================
WO31 -- Early Entry Suppression

Fixed  : Trigger = DD5<=-10% AND DD10<=-18%
         Sell    = 100% at MA250 anchor
         Vmin    = -40/-50/-60% ATH  (20% x 3 = 60% back)
         Remaining ~40%: score >= 3 + cooldown + optional threshold

Modes  :
  A  MA200 baseline         (WO30 best -- all remaining via MA200)
  B  Score>=3 immediate     (buy 20% on score>=3; next score>=3 -> buy remaining)
  C  Score>=3 + CD5d        (buy 20% on score>=3; wait 5d; score>=3 -> buy remaining)
  D  Score>=3 + CD10d       (buy 20% on score>=3; wait 10d; score>=3 -> buy remaining)
  E  Score>=3 + CD5d + Thresh (buy 20% on score>=3; wait 5d;
                               price >= 5d_low*1.05 OR dd5 improving -> buy remaining)

Metrics: Sharpe / CAGR / MaxDD / False entry rate / Cash exhaustion rate
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
from vr_backtest.strategies.ma200_strategy       import run_ma200_strategy
from vr_backtest.strategies.adaptive_ma_strategy  import run_adaptive_ma

# ── Constants ───────────────────────────────────────────────────────────────────
INITIAL_CASH    = 10_000.0
MONTHLY_CONTRIB = 250.0
RETEST_TIMEOUT  = 60
SELL_PCT        = 1.00
VMIN_LADDER     = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]
BOTTOM_TRANCHE  = 0.20   # 20% of equity per bottom buy
SCORE_THRESHOLD = 3      # WO31 raises from 2 to 3
MODE_CD2        = {'B': 1, 'C': 5, 'D': 10, 'E': 5}   # min days before 2nd tranche

dirname  = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
ROOT_DIR = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
OUT_DIR  = os.path.join(ROOT_DIR, 'vr_backtest', 'results', 'charts')
OUT_FILE = 'C:/Temp/bt_wo31_out.txt'
os.makedirs(OUT_DIR, exist_ok=True)

CRASH_EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}

MODES = {
    'A': 'MA200 baseline',
    'B': 'Score>=3 immediate',
    'C': 'Score>=3 + CD5d',
    'D': 'Score>=3 + CD10d',
    'E': 'Score>=3 + CD5d + Thresh',
}
STRAT_COLORS = {
    'ma200': '#666666', 'adapt_b': '#FF5722',
    'A': '#1A237E', 'B': '#1976D2', 'C': '#43A047', 'D': '#FB8C00', 'E': '#E53935',
}
STRAT_LABELS = {
    'ma200': 'MA200', 'adapt_b': 'Adapt-B',
    **{k: f'{k}: {v}' for k, v in MODES.items()},
}


# ═══════════════════════════════════════════════════════════════════════════════
# DATA LOADING
# ═══════════════════════════════════════════════════════════════════════════════
def load_tqqq_volume() -> pd.DataFrame | None:
    dbp = os.path.join(ROOT_DIR, 'marketflow', 'data', 'marketflow.db')
    if not os.path.exists(dbp): return None
    try:
        conn = sqlite3.connect(dbp)
        df = pd.read_sql(
            "SELECT date, volume FROM ohlcv_daily WHERE symbol='TQQQ' ORDER BY date", conn)
        conn.close()
        if df.empty: return None
        df['date']   = pd.to_datetime(df['date'])
        df['volume'] = pd.to_numeric(df['volume'], errors='coerce')
        return df.dropna().sort_values('date').reset_index(drop=True)
    except Exception:
        return None


def prepare_data(raw: pd.DataFrame, vol_df) -> pd.DataFrame:
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

    # Pre-computed rolling 5d min for Mode E threshold check
    data['low5'] = pd.Series(prices).rolling(5, min_periods=1).min().values

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
# BOTTOM CONFIRMATION SIGNALS  (same as WO30)
# ═══════════════════════════════════════════════════════════════════════════════
def compute_signals(data: pd.DataFrame) -> dict:
    prices = data['close'].values
    dd5    = data['dd5'].values
    T      = len(prices)

    energy = np.zeros(T, dtype=bool)
    for t in range(1, T):
        energy[t] = (dd5[t] > dd5[t-1]) and (dd5[t-1] < -0.02)

    box = np.zeros(T, dtype=bool)
    for t in range(4, T):
        w = prices[t-4:t+1]
        box[t] = (w.max() - w.min()) / prices[t] < 0.08

    vol_shift = np.zeros(T, dtype=bool)
    vol_col   = data['volume'].values if 'volume' in data.columns else np.full(T, np.nan)
    has_vol   = (~np.isnan(vol_col)).sum() > 200
    if has_vol:
        vol_ma20 = pd.Series(vol_col).rolling(20, min_periods=5).mean().values
        low5_arr = pd.Series(prices).rolling(5, min_periods=2).min().values
        for t in range(20, T):
            if vol_ma20[t] > 0 and not np.isnan(vol_col[t]):
                vol_spike    = vol_col[t] > vol_ma20[t] * 1.5
                near_low     = prices[t] <= low5_arr[t] * 1.02
                vol_shift[t] = bool(vol_spike and near_low)

    reversal = np.zeros(T, dtype=bool)
    for t in range(5, T):
        reversal[t] = prices[t] > prices[t-5:t].max()

    score = (energy.astype(int) + box.astype(int) +
             vol_shift.astype(int) + reversal.astype(int))

    return {'energy': energy, 'box': box, 'volume': vol_shift,
            'reversal': reversal, 'score': score, 'has_vol': has_vol}


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
def run_wo31_strategy(data: pd.DataFrame, crash_sig: np.ndarray,
                      mode: str, signals: dict) -> dict:
    """
    100% sell + Vmin ladder (60%) + WO31 bottom confirmation for remaining ~40%.

    Bottom confirmation:
      1st tranche : score >= 3 -> buy BOTTOM_TRANCHE of equity
      2nd tranche : after cd2 days AND mode condition
        B/C/D : score >= 3
        E     : price >= 5d_low * 1.05  OR  dd5 improving
      MA200  : final mop-up + return to normal (all modes)
    """
    prices   = data['close'].values
    ma200    = data['ma200'].values
    dd_arr   = data['drawdown'].values
    dates    = data['date'].values
    anchor_v = data['ma250'].values
    dd5_arr  = data['dd5'].values
    low5_arr = data['low5'].values
    T        = len(prices)

    equity      = np.zeros(T)
    sell_log    = []
    reentry_log = []   # all buy events (vmin + bottom + ma200)
    episode_log = []   # per-episode summary
    entry_fires = []   # bottom1 fires for false-rate calculation

    shares = INITIAL_CASH / prices[0]
    cash   = 0.0
    state  = 'normal'

    armed_t = 0; armed_price = 0.0
    ladder_done    = [False, False, False]
    bottom_t1_done = False
    bottom_t2_done = False
    last_bottom_t  = -999
    crash_cooldown = 0

    def_sell_t     = None
    def_sell_price = None

    equity[0]  = shares * prices[0]
    prev_month = pd.Timestamp(dates[0]).month
    cd2 = MODE_CD2.get(mode, 1)

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
        if np.isnan(av) or av <= 0: av = None

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
                ladder_done    = [False, False, False]
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

            # 2) Bottom confirmation
            equity_now = cash + shares * price
            if mode != 'A' and cash > equity_now * 0.05:
                sc = int(signals['score'][t])

                if not bottom_t1_done:
                    # 1st tranche: score >= SCORE_THRESHOLD
                    if sc >= SCORE_THRESHOLD:
                        buy_val = min(equity_now * BOTTOM_TRANCHE, cash)
                        if buy_val > 10:
                            shares += buy_val / price; cash -= buy_val
                            bottom_t1_done = True; last_bottom_t = t
                            reentry_log.append({'t': t, 'date': date, 'price': price,
                                                'type': f'bottom1_{mode}',
                                                'sell_price': def_sell_price or price,
                                                'score': sc})
                            entry_fires.append({'t': t, 'price': price, 'score': sc})

                elif not bottom_t2_done and (t - last_bottom_t) >= cd2:
                    # 2nd tranche: mode-dependent condition
                    do_buy2 = False
                    if mode in ('B', 'C', 'D'):
                        do_buy2 = (sc >= SCORE_THRESHOLD)
                    elif mode == 'E':
                        cond_a  = price >= low5_arr[t] * 1.05      # 5% bounce from 5d low
                        cond_b  = bool(dd5_arr[t] > dd5_arr[t-1])  # dd5 momentum improving
                        do_buy2 = bool(cond_a or cond_b)

                    if do_buy2:
                        buy_val = cash
                        if buy_val > 10:
                            shares += buy_val / price; cash = 0.0
                            bottom_t2_done = True; last_bottom_t = t
                            reentry_log.append({'t': t, 'date': date, 'price': price,
                                                'type': f'bottom2_{mode}',
                                                'sell_price': def_sell_price or price,
                                                'score': sc})

            # 3) MA200 final mop-up + return to normal
            if price > ma200t and crash_cooldown <= 0:
                cash_remaining = cash
                if cash > 10:
                    reentry_log.append({'t': t, 'date': date, 'price': price,
                                        'type': 'ma200_mopup',
                                        'sell_price': def_sell_price or price,
                                        'cash_remaining': cash})
                    shares += cash / price; cash = 0.0
                if def_sell_t is not None:
                    episode_log.append({
                        'sell_t'         : def_sell_t,
                        'sell_price'     : def_sell_price,
                        'normal_t'       : t,
                        'normal_price'   : price,
                        'recovery_days'  : t - def_sell_t,
                        'bottom_t1_done' : bottom_t1_done,
                        'bottom_t2_done' : bottom_t2_done,
                        'cash_at_ma200'  : cash_remaining,
                    })
                state = 'normal'
                ladder_done    = [False, False, False]
                bottom_t1_done = False; bottom_t2_done = False
                def_sell_t = def_sell_price = None
                crash_cooldown = 10

        # ── NORMAL ─────────────────────────────────────────────────────────────
        elif state == 'normal':
            if crash_sig[t] and crash_cooldown <= 0:
                if av is None or price >= av * 0.995:
                    sell_sh = shares * SELL_PCT
                    cash   += sell_sh * price; shares -= sell_sh
                    sell_log.append({'t': t, 'date': date, 'price': price,
                                     'type': 'immediate', 'sig_price': price, 'days_wait': 0})
                    def_sell_t = t; def_sell_price = price
                    state = 'defensive'
                    ladder_done    = [False, False, False]
                    bottom_t1_done = False; bottom_t2_done = False
                    last_bottom_t  = -999
                else:
                    state = 'armed'; armed_t = t; armed_price = price

        if crash_cooldown > 0: crash_cooldown -= 1
        equity[t] = cash + shares * price

    ep_df = pd.DataFrame(episode_log) if episode_log else pd.DataFrame()
    re_df = pd.DataFrame(reentry_log) if reentry_log else pd.DataFrame()
    return {'equity': equity, 'episode_log': ep_df, 'reentry_log': re_df,
            'entry_fires': entry_fires, 'final': float(equity[-1])}


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
                'pct_bottom_used': np.nan, 'avg_reentry_ratio': np.nan,
                'avg_cash_at_ma200': np.nan}
    n          = len(ep_df)
    avg_rec    = ep_df['recovery_days'].mean()
    pct_bottom = ep_df['bottom_t1_done'].mean() * 100

    ep_df2 = ep_df.copy()
    ep_df2['rebound'] = ep_df2.apply(
        lambda r: r['normal_price'] / r['sell_price'] - 1 if r['sell_price'] > 0 else np.nan,
        axis=1)
    avg_rb = ep_df2['rebound'].mean()

    bottom_rows = re_df[re_df['type'].str.startswith('bottom')] if not re_df.empty else pd.DataFrame()
    avg_re_ratio = np.nan
    if not bottom_rows.empty and 'sell_price' in bottom_rows.columns:
        ratios = bottom_rows['price'] / bottom_rows['sell_price']
        avg_re_ratio = float(ratios.mean())

    avg_cash = float(ep_df['cash_at_ma200'].mean()) if 'cash_at_ma200' in ep_df.columns else np.nan

    return {'n': n, 'avg_recovery': avg_rec, 'avg_rebound': avg_rb,
            'pct_bottom_used': pct_bottom, 'avg_reentry_ratio': avg_re_ratio,
            'avg_cash_at_ma200': avg_cash}


def _false_entry_rate(entry_fires: list, prices: np.ndarray) -> dict:
    """% of bottom1 entries where price fell >5% within next 10 days."""
    if not entry_fires:
        return {'n': 0, 'false_n': 0, 'rate': np.nan}
    n = len(entry_fires)
    false_n = 0
    for ef in entry_fires:
        t, p = ef['t'], ef['price']
        future = prices[t+1 : min(t+11, len(prices))]
        if len(future) > 0 and float(future.min()) < p * 0.95:
            false_n += 1
    return {'n': n, 'false_n': false_n,
            'rate': false_n / n * 100 if n > 0 else np.nan}


def _cash_exhaustion(ep_df: pd.DataFrame) -> dict:
    """% of episodes where cash was fully depleted before MA200 mop-up."""
    if ep_df.empty or 'cash_at_ma200' not in ep_df.columns:
        return {'n': 0, 'exhausted': 0, 'rate': np.nan}
    n         = len(ep_df)
    exhausted = int((ep_df['cash_at_ma200'] < 1.0).sum())
    return {'n': n, 'exhausted': exhausted,
            'rate': exhausted / n * 100 if n > 0 else 0.0}


def _sig_counts(re_df: pd.DataFrame) -> dict:
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
    _chart_suppression(results, out_dir)


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
        ax.semilogy(dates, eq / eq[0],
                    label=f"{STRAT_LABELS.get(sn,sn)[:32]} "
                          f"({m['cagr']*100:.1f}%  S={m['sharpe']:.3f})",
                    color=STRAT_COLORS.get(sn, '#888'), lw=lw, ls=ls, alpha=0.9)
    ax.set_ylabel('Normalized Equity (log)')
    ax.legend(loc='upper left', fontsize=7.5)
    ax.set_title('WO31 - Early Entry Suppression: Equity Curves')
    ax.grid(True, alpha=0.2)

    ax2 = axes[1]
    for sn in order:
        if sn not in results: continue
        eq = results[sn]['equity']
        dd = (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100
        ax2.plot(dates, dd, color=STRAT_COLORS.get(sn, '#888'), lw=0.9, alpha=0.75)
    ax2.set_ylabel('Drawdown (%)')
    ax2.set_xlabel('Date')
    ax2.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'equity_wo31.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    equity_wo31.png')


def _chart_perf_bars(results, out_dir):
    order  = ['MA200', 'Adapt-B', 'A', 'B', 'C', 'D', 'E']
    keys   = ['ma200', 'adapt_b', 'A', 'B', 'C', 'D', 'E']
    valid  = [(lbl, k) for lbl, k in zip(order, keys) if k in results]
    lbls   = [v[0] for v in valid]
    ks     = [v[1] for v in valid]
    colors = [STRAT_COLORS.get(k, '#888') for k in ks]

    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    for ax, mk, title, fn, fmt in [
        (axes[0], 'sharpe', 'Sharpe',    lambda v: v,      '{:.3f}'),
        (axes[1], 'cagr',   'CAGR (%)',  lambda v: v*100,  '{:.1f}%'),
        (axes[2], 'max_dd', 'MaxDD (%)', lambda v: v*100,  '{:.1f}%'),
    ]:
        vals = [fn(results[k][mk]) for k in ks]
        bars = ax.bar(lbls, vals, color=colors, alpha=0.85, edgecolor='white')
        ax.set_title(title); ax.grid(True, axis='y', alpha=0.3)
        for bar, v in zip(bars, vals):
            yoff = abs(bar.get_height()) * 0.012
            ax.text(bar.get_x() + bar.get_width()/2,
                    bar.get_height() + (yoff if bar.get_height() >= 0 else -yoff*5),
                    fmt.format(v), ha='center', va='bottom', fontsize=7.5)
        ax.tick_params(axis='x', rotation=20, labelsize=8)
    fig.suptitle('WO31 - Performance Comparison', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'perf_bars_wo31.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    perf_bars_wo31.png')


def _chart_suppression(results, out_dir):
    """False entry rate + cash exhaustion rate comparison."""
    keys   = [k for k in 'BCDE' if k in results]
    x      = np.arange(len(keys))
    colors = [STRAT_COLORS.get(k, '#888') for k in keys]
    lbls   = [MODES[k][:18] for k in keys]

    false_rates  = [results[k]['false_stats']['rate'] or 0  for k in keys]
    cash_ex      = [results[k]['cash_stats']['rate']  or 0  for k in keys]
    bot_used     = [results[k]['rec_stats']['pct_bottom_used'] or 0 for k in keys]
    sharpes      = [results[k]['sharpe'] for k in keys]

    fig, axes = plt.subplots(2, 2, figsize=(14, 9))

    for ax, vals, title, ylabel in [
        (axes[0, 0], false_rates, 'False Entry Rate (%)\n(bottom1 -> >5% further drop in 10d)', '%'),
        (axes[0, 1], cash_ex,    'Cash Exhaustion Rate (%)\n(no cash left at MA200 mop-up)',    '%'),
        (axes[1, 0], bot_used,   'Bottom Confirm Used (%)\n(episodes with >=1 tranche fired)',  '%'),
        (axes[1, 1], sharpes,    'Sharpe Ratio', ''),
    ]:
        bars = ax.bar(x, vals, color=colors, alpha=0.85)
        ax.axhline(0, color='black', ls='-', lw=0.5)
        for bar, v in zip(bars, vals):
            yoff = abs(bar.get_height()) * 0.015 + 0.3
            ax.text(bar.get_x() + bar.get_width()/2,
                    bar.get_height() + yoff,
                    f'{v:.1f}', ha='center', va='bottom', fontsize=9)
        ax.set_xticks(x); ax.set_xticklabels(lbls, rotation=10, fontsize=8)
        ax.set_title(title); ax.set_ylabel(ylabel); ax.grid(True, axis='y', alpha=0.3)

    fig.suptitle('WO31 - Entry Suppression Analysis', fontsize=13)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'suppression_wo31.png'), dpi=110, bbox_inches='tight')
    plt.close()
    print('    suppression_wo31.png')


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
    h('  WO31 -- Early Entry Suppression')
    h('  Score>=3 + Cooldown + Threshold  (vs MA200 baseline)')
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
    signals = compute_signals(data)
    h(f'    에너지감쇠: {signals["energy"].sum()}일')
    h(f'    박스형성:   {signals["box"].sum()}일')
    h(f'    거래량급증: {signals["volume"].sum()}일' +
      (' (비활성)' if not signals["has_vol"] else ''))
    h(f'    역전신호:   {signals["reversal"].sum()}일')
    for sc in [2, 3, 4]:
        h(f'    Score>={sc}: {int((signals["score"]>=sc).sum())}일')

    # Signal stats in crisis periods
    prices_arr  = data['close'].values
    peak_arr    = data['rolling_peak'].values
    dd_ath_arr  = np.where(peak_arr > 0, prices_arr / peak_arr - 1, 0)
    in_crisis   = dd_ath_arr < -0.20
    sc_arr      = signals['score']
    crisis_days = int(in_crisis.sum())
    sc3_crisis  = int((sc_arr[in_crisis] >= 3).sum())
    h()
    h(f'  [크래시 구간(ATH -20%이하) 신호 분석]')
    h(f'    크래시 구간 일수: {crisis_days}일  |  score>=3 발생: {sc3_crisis}일  '
      f'({sc3_crisis/max(1,crisis_days)*100:.1f}%)')
    h(f'    score>=2 발생: {int((sc_arr[in_crisis]>=2).sum())}일  '
      f'({int((sc_arr[in_crisis]>=2).sum())/max(1,crisis_days)*100:.1f}%)')
    h()

    # [4] Crash signal
    h('[4] Trigger 신호 (DD5<=-10% AND DD10<=-18%)')
    crash_raw = build_crash_sig(data)
    crash_cd  = apply_cooldown(crash_raw)
    h(f'    Raw: {int(crash_raw.sum())}개  Post-CD: {int(crash_cd.sum())}개')
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
        r = run_wo31_strategy(data, crash_cd, mode_k, signals)
        r.update(_metrics(r['equity'], data['date'].values))
        r['rec_stats']   = _recovery_stats(r['episode_log'], r['reentry_log'])
        r['false_stats'] = _false_entry_rate(r['entry_fires'], prices_arr)
        r['cash_stats']  = _cash_exhaustion(r['episode_log'])
        r['sig_counts']  = _sig_counts(r['reentry_log'])
        results[mode_k] = r
    h()

    # [6] Performance table
    h('[6] 전체 성과 비교 (2011-2026)')
    h('-' * 84)
    h(f'  {"전략":<38}  {"최종자산":>12}  {"CAGR":>7}  {"MaxDD":>7}  {"Sharpe":>7}')
    h('-' * 84)
    for key, label in [('ma200', 'MA200'), ('adapt_b', 'Adapt-B')]:
        m = results[key]
        h(f'  {label:<38}  ${m["final"]:>11,.0f}  {m["cagr"]*100:>6.1f}%  '
          f'{m["max_dd"]*100:>6.1f}%  {m["sharpe"]:>7.3f}')
    h('  ' + '·' * 80)
    for k in 'ABCDE':
        m = results[k]; d = m['sharpe'] - results['adapt_b']['sharpe']
        label = f'{k}: {MODES[k][:32]}'
        h(f'  {label:<38}  ${m["final"]:>11,.0f}  {m["cagr"]*100:>6.1f}%  '
          f'{m["max_dd"]*100:>6.1f}%  {m["sharpe"]:>7.3f}  (vs Adapt-B {d:+.3f})')
    h('-' * 84)
    h()

    # [7] Entry Suppression Analysis
    h('[7] Entry Suppression Analysis')
    h(f'  {"Mode":<5}  {"N":>4}  {"AvgRec":>8}  {"BotUsed":>8}  '
      f'{"BotReentry":>11}  {"FalseRate":>15}  {"CashExhaust":>12}  V/B1/B2/M')
    h('  ' + '-' * 92)
    for k in 'ABCDE':
        rs = results[k]['rec_stats']
        fs = results[k]['false_stats']
        cs = results[k]['cash_stats']
        sc = results[k]['sig_counts']
        n      = rs['n']
        avg_r  = f'{rs["avg_recovery"]:.0f}d' \
                 if (rs["avg_recovery"] is not None and not np.isnan(rs["avg_recovery"])) else 'N/A'
        bot_u  = f'{rs["pct_bottom_used"]:.0f}%' \
                 if (rs["pct_bottom_used"] is not None and not np.isnan(rs["pct_bottom_used"])) else 'N/A'
        re_r   = f'{(rs["avg_reentry_ratio"]-1)*100:+.1f}%' \
                 if (rs["avg_reentry_ratio"] is not None and not np.isnan(rs["avg_reentry_ratio"])) else 'N/A'
        false_s = f'{fs["rate"]:.0f}%({fs["false_n"]}/{fs["n"]})' \
                  if (fs["rate"] is not None and not np.isnan(fs["rate"])) else 'N/A'
        cash_e  = f'{cs["rate"]:.0f}%({cs["exhausted"]}/{cs["n"]})' \
                  if (cs["rate"] is not None and not np.isnan(cs["rate"])) else 'N/A'
        h(f'  {k:<5}  {n:>4}  {avg_r:>8}  {bot_u:>8}  {re_r:>11}  '
          f'{false_s:>15}  {cash_e:>12}  '
          f'V={sc["vmin"]} B1={sc["bottom1"]} B2={sc["bottom2"]} M={sc["ma200"]}')
    h()

    # [8] Episode MaxDD
    h('[8] Crash 에피소드별 MaxDD')
    for ep_name, (ep_s, ep_e) in CRASH_EPISODES.items():
        h(f'\n  [{ep_name}]  {ep_s} ~ {ep_e}')
        h(f'  {"전략":<38}  {"MaxDD":>8}  {"EpRet":>8}')
        h('  ' + '-' * 58)
        for key, lbl in ([('ma200', 'MA200'), ('adapt_b', 'Adapt-B')] +
                         [(k, f'{k}: {MODES[k][:28]}') for k in 'ABCDE' if k in results]):
            ep_ret, ep_dd = _ep_return(results[key]['equity'], data['date'].values, ep_s, ep_e)
            if np.isnan(ep_dd): continue
            h(f'  {lbl:<38}  {ep_dd*100:>7.1f}%  {ep_ret*100:>7.1f}%')
    h()

    # [9] Conclusions
    h('[9] 핵심 연구 결론')
    h('=' * 72)

    valid_k = [k for k in 'ABCDE' if k in results]
    best_sh = max(valid_k, key=lambda k: results[k]['sharpe'])
    best_ca = max(valid_k, key=lambda k: results[k]['cagr'])

    h()
    h('[Q1] Sharpe 추이: A → B → C → D → E')
    for k in valid_k:
        m  = results[k]
        dA = m['sharpe'] - results['A']['sharpe']
        mark = '  <-- Sharpe 최우수' if k == best_sh else (
               '  <-- CAGR 최우수'  if k == best_ca and k != best_sh else '')
        h(f'  {k}: {MODES[k]:<32}  Sharpe {m["sharpe"]:.3f} ({dA:+.3f} vs A)  '
          f'CAGR {m["cagr"]*100:.1f}%  MaxDD {m["max_dd"]*100:.1f}%{mark}')

    h()
    h('[Q2] Cooldown 효과 — FalseRate 비교 (B vs C vs D vs E)')
    for k in valid_k:
        fs = results[k]['false_stats']
        if fs['n'] == 0:
            h(f'  {k}: {MODES[k]:<32}  FalseRate N/A (bottom 미발동)')
        else:
            h(f'  {k}: {MODES[k]:<32}  FalseRate {fs["rate"]:.0f}%  '
              f'({fs["false_n"]}/{fs["n"]}건)')

    h()
    h('[Q3] Cash Exhaustion vs Sharpe')
    for k in valid_k:
        cs = results[k]['cash_stats']
        m  = results[k]
        ce = f'{cs["rate"]:.0f}%({cs["exhausted"]}/{cs["n"]})' \
             if (cs["rate"] is not None and not np.isnan(cs["rate"])) else 'N/A'
        h(f'  {k}: {MODES[k]:<32}  CashExhaust {ce}  Sharpe {m["sharpe"]:.3f}')

    h()
    h('[Q4] WO30 vs WO31 Score threshold 비교]')
    h('  WO30 Mode E: score>=2 -> 20%, score>=3 -> remaining')
    h('  WO31 Mode B: score>=3 -> 20%, score>=3 -> remaining  (CD=1d)')
    h('  WO31 Mode E: score>=3 -> 20%, threshold -> remaining  (CD=5d)')
    if 'A' in results:
        mA = results['A']
        h(f'  WO30 A(baseline) Sharpe: 1.034  (ref)')
        for k in ['B', 'C', 'D', 'E']:
            if k in results:
                m = results[k]
                d = m['sharpe'] - 1.034
                h(f'  WO31 {k}: Sharpe {m["sharpe"]:.3f}  ({d:+.3f} vs WO30-A)')

    h()
    h('[WO31 최종 결론]')
    br = results[best_sh]
    d_adapt = br['sharpe'] - results['adapt_b']['sharpe']
    d_wo30a = br['sharpe'] - 1.034
    h(f'  최우수 Mode: {best_sh} - {MODES[best_sh]}')
    h(f'  CAGR {br["cagr"]*100:.1f}%  MaxDD {br["max_dd"]*100:.1f}%  Sharpe {br["sharpe"]:.3f}')
    h(f'  Adapt-B 대비 Sharpe: {d_adapt:+.3f}')
    h(f'  WO30-A 대비 Sharpe:  {d_wo30a:+.3f}')

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
