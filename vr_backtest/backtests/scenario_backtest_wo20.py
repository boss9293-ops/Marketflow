"""
vr_backtest/backtests/scenario_backtest_wo20.py
================================================
WO20 -- Structural Bear Detector Optimization

SBS Variants tested:
  Baseline   : A=40d, no MA50, no lock           (WO19 tuned)
  SBS-A      : A=30d, no MA50, no lock           (faster detection)
  SBS-B      : A=40d, MA50<MA200, no lock        (reduce false positives)
  SBS-C      : A=40d, no MA50, lock=60d          (reduce churn)
  SBS-D      : A=30d, MA50<MA200, lock=60d       (combined best guess)

All compared against MA200 and Adapt-B.
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from vr_backtest.data.loader import load_tqqq
from vr_backtest.strategies.ma200_strategy      import run_ma200_strategy
from vr_backtest.strategies.adaptive_ma_strategy import run_adaptive_ma

# ── constants ─────────────────────────────────────────────────────────────────
EPISODES = {
    "2011 Debt Ceiling" : ("2011-07-01", "2012-03-31"),
    "2015 China Shock"  : ("2015-07-01", "2016-03-31"),
    "2018 Vol Spike"    : ("2018-01-15", "2018-05-31"),
    "2018 Q4 Selloff"   : ("2018-09-01", "2019-06-30"),
    "2020 COVID"        : ("2020-02-01", "2020-12-31"),
    "2022 Fed Bear"     : ("2021-11-01", "2023-06-30"),
    "2025 Correction"   : ("2024-12-01", "2026-03-13"),
}
POST_6M_DAYS = 126

# variants: (min_below_days, use_ma50, bear_lock_days)
VARIANT_CONFIGS = {
    'sbs_base' : (40, False,  0),
    'sbs_A'    : (30, False,  0),
    'sbs_B'    : (40, True,   0),
    'sbs_C'    : (40, False, 60),
    'sbs_D'    : (30, True,  60),
}

VARIANT_LABELS = {
    'ma200'    : 'MA200',
    'adapt_b'  : 'Adapt-B',
    'sbs_base' : 'SBS Baseline',
    'sbs_A'    : 'SBS-A (30d)',
    'sbs_B'    : 'SBS-B (MA50)',
    'sbs_C'    : 'SBS-C (Lock60)',
    'sbs_D'    : 'SBS-D (30+MA50+Lock)',
}

COLORS = {
    'ma200'    : '#4488ff',
    'adapt_b'  : '#ff8844',
    'sbs_base' : '#aa44ff',
    'sbs_A'    : '#ff4488',
    'sbs_B'    : '#44cc88',
    'sbs_C'    : '#cc8800',
    'sbs_D'    : '#00aacc',
}

SBS_EXIT_TAGS = ('NEAR_EXIT', 'MED_EXIT', 'FAR_CRASH_SELL', 'FAR_TREND_SELL',
                 'TM_SELL1', 'TM_SELL2')
EXIT_TAGS = {
    'ma200'    : ('MA200_EXIT',),
    'adapt_b'  : ('NEAR_EXIT', 'MED_EXIT', 'FAR_CRASH_SELL', 'FAR_TREND_SELL'),
}
for k in VARIANT_CONFIGS:
    EXIT_TAGS[k] = SBS_EXIT_TAGS

# Adapt-B Var B params
AM_FAR_MA   = 'ma150'
AM_SPD_COL  = 'speed4'
AM_SPD_THR  = -0.12
AM_FAR_SELL = 0.50
NEAR_THR = 0.15
MED_THR  = 0.30
LADDER   = [(-0.40, 0.20), (-0.50, 0.20), (-0.60, 0.20)]


# ── Data preparation ──────────────────────────────────────────────────────────
def _add_ma50(data: pd.DataFrame) -> pd.DataFrame:
    data = data.copy()
    data['ma50'] = data['close'].rolling(50, min_periods=1).mean()
    return data


# ── Structural Bear Detector ──────────────────────────────────────────────────
def compute_bear_flag(data: pd.DataFrame,
                      min_below_days: int  = 40,
                      use_ma50      : bool = False,
                      dd30_lo       : float = -0.50,
                      dd30_hi       : float = -0.05,
                      crash_thr     : float = -0.30,
                      crash_look    : int   = 30,
                      ) -> np.ndarray:
    """Parameterised StructuralBear detector (tuned thresholds from WO19)."""
    prices = data['close'].values
    ma200  = data['ma200'].values
    speed4 = data['speed4'].values
    T      = len(prices)

    # A: consecutive days below MA200
    below  = (prices < ma200).astype(int)
    consec = np.zeros(T, dtype=int)
    for t in range(1, T):
        consec[t] = consec[t-1] + 1 if below[t] else 0
    cond_A = consec >= min_below_days

    # B: MA200 20-day slope < 0
    slope = np.zeros(T)
    for t in range(20, T):
        slope[t] = (ma200[t] - ma200[t-20]) / ma200[t-20]
    cond_B = slope < 0.0

    # B2 (optional): MA50 < MA200
    if use_ma50:
        ma50   = data['ma50'].values
        cond_B = cond_B & (ma50 < ma200)

    # C: 30-day drawdown in [dd30_lo, dd30_hi]
    rhi    = pd.Series(prices).rolling(30, min_periods=1).max().values
    dd30   = (prices / rhi) - 1.0
    cond_C = (dd30 <= dd30_hi) & (dd30 >= dd30_lo)

    # D: no mega-crash in last crash_look days
    ce   = (speed4 <= crash_thr).astype(int)
    c60  = pd.Series(ce).rolling(crash_look, min_periods=1).max().values
    cond_D = (c60 == 0)

    return (cond_A & cond_B & cond_C & cond_D)


def apply_bear_lock(bear_raw: np.ndarray, lock_days: int) -> np.ndarray:
    """Extend any True period by minimum lock_days (reduces on/off churn)."""
    if lock_days == 0:
        return bear_raw.copy()
    eff = bear_raw.copy()
    lock_until = -1
    for t in range(len(bear_raw)):
        if bear_raw[t]:
            lock_until = max(lock_until, t + lock_days)
        if t <= lock_until:
            eff[t] = True
    return eff


# ── SBS Strategy (identical core to WO19) ────────────────────────────────────
def run_sbs_strategy(data        : pd.DataFrame,
                     bear_flag   : np.ndarray,
                     initial_cash: float = 10_000.0,
                     monthly_contrib: float = 250.0) -> dict:
    dates   = data['date'].values
    prices  = data['close'].values
    ma200_a = data['ma200'].values
    ma150_a = data['ma150'].values
    dist200 = data['distance200'].values
    dd_arr  = data['drawdown'].values
    speed4  = data['speed4'].values
    T       = len(dates)

    equity   = np.zeros(T)
    cash_arr = np.zeros(T)
    tlog     = []

    shares = initial_cash / prices[0]
    cash   = 0.0

    am_invested    = True
    am_max_dist    = dist200[0]
    am_far_partial = False
    am_ladder_done = [False, False, False]

    tm_sell1_done  = False
    tm_sell2_done  = False
    tm_buy1_done   = False

    tlog.append((dates[0], "BUY_INIT", prices[0], shares, 0.0))
    equity[0]   = shares * prices[0]
    cash_arr[0] = 0.0
    prev_month  = pd.Timestamp(dates[0]).month
    prev_bear   = bool(bear_flag[0])

    for t in range(1, T):
        price = prices[t]
        ma200 = ma200_a[t]
        ma150 = ma150_a[t]
        dist  = dist200[t]
        dd    = dd_arr[t]
        spd   = speed4[t]
        bear  = bool(bear_flag[t])

        curr_month = pd.Timestamp(dates[t]).month
        if curr_month != prev_month:
            cash += monthly_contrib
            prev_month = curr_month

        if bear and not prev_bear:
            tm_sell1_done = False
            tm_sell2_done = False
            tm_buy1_done  = False
            tlog.append((dates[t], "BEAR_START", price, 0.0, cash))
        elif not bear and prev_bear:
            am_invested    = shares > 0.01
            am_max_dist    = max(dist, 0.0)
            am_far_partial = False
            if am_invested:
                am_ladder_done = [False, False, False]
            tlog.append((dates[t], "BEAR_END", price, 0.0, cash))
        prev_bear = bear

        if not bear:
            if am_invested:
                if dist > am_max_dist:
                    am_max_dist = dist
                if cash > 0 and price > ma200:
                    new_sh = cash / price
                    shares += new_sh
                    cash    = 0.0
                    tlog.append((dates[t], "DCA", price, new_sh, 0.0))
                exit_triggered = False
                exit_tag       = ""
                sell_pct       = 1.0
                if am_max_dist <= NEAR_THR:
                    if price < ma200:
                        exit_triggered = True; exit_tag = "NEAR_EXIT"
                elif am_max_dist <= MED_THR:
                    if price < ma150:
                        exit_triggered = True; exit_tag = "MED_EXIT"
                else:
                    if not am_far_partial and price < ma150 and spd <= AM_SPD_THR:
                        exit_triggered = True; exit_tag = "FAR_CRASH_SELL"
                        sell_pct = AM_FAR_SELL; am_far_partial = True
                    elif price < ma150:
                        exit_triggered = True; exit_tag = "FAR_TREND_SELL"
                if exit_triggered:
                    sell_sh = shares * sell_pct
                    cash   += sell_sh * price
                    shares -= sell_sh
                    am_invested    = False
                    am_ladder_done = [False, False, False]
                    tlog.append((dates[t], exit_tag, price, sell_sh, cash))
            else:
                for i, (thr, pct) in enumerate(LADDER):
                    if not am_ladder_done[i] and dd <= thr:
                        pv = shares * price + cash
                        bv = min(pv * pct, cash)
                        if bv > 1.0:
                            ns = bv / price
                            shares += ns; cash -= bv
                            tlog.append((dates[t], f"BOTTOM_BUY_{int(abs(thr)*100)}",
                                         price, ns, cash))
                        am_ladder_done[i] = True
                if price > ma200:
                    if cash > 0:
                        ns = cash / price; shares += ns
                        tlog.append((dates[t], "MA200_ENTRY", price, ns, 0.0))
                        cash = 0.0
                    am_invested    = True
                    am_ladder_done = [False, False, False]
                    am_far_partial = False
                    am_max_dist    = dist
        else:
            has_sh = shares > 0.01
            if has_sh:
                if not tm_sell1_done and price < ma200:
                    ss = shares * 0.50
                    cash += ss * price; shares -= ss
                    tm_sell1_done = True
                    tlog.append((dates[t], "TM_SELL1", price, ss, cash))
                if tm_sell1_done and not tm_sell2_done and price < ma200 * 0.95:
                    ss = shares
                    cash += ss * price; shares = 0.0
                    tm_sell2_done = True
                    tlog.append((dates[t], "TM_SELL2", price, ss, cash))
            else:
                if not tm_buy1_done and price > ma200:
                    bv = cash * 0.50
                    if bv > 1.0:
                        ns = bv / price; shares += ns; cash -= bv
                        tm_buy1_done = True
                        tlog.append((dates[t], "TM_BUY1", price, ns, cash))
                if tm_buy1_done and price > ma200 * 1.05:
                    if cash > 1.0:
                        ns = cash / price; shares += ns; cash = 0.0
                        tlog.append((dates[t], "TM_BUY2", price, ns, 0.0))
                    tm_sell1_done = False
                    tm_sell2_done = False
                    tm_buy1_done  = False

        equity[t]    = shares * price + cash
        cash_arr[t]  = cash

    rp   = np.maximum.accumulate(equity)
    ddnv = (equity / rp) - 1.0
    return {
        "label"        : "",
        "equity"       : equity,
        "dates"        : dates,
        "drawdown_nav" : ddnv,
        "cash"         : cash_arr,
        "trade_log"    : tlog,
        "metrics"      : _compute_metrics(equity, ddnv, dates),
    }


def _compute_metrics(equity, dd_nav, dates):
    nr    = np.diff(equity) / equity[:-1]
    yrs   = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days / 365.25
    cagr  = (equity[-1] / equity[0]) ** (1 / yrs) - 1 if yrs > 0 else 0.0
    maxdd = float(dd_nav.min())
    sharpe = float(np.mean(nr)) / float(np.std(nr)) * np.sqrt(252) if np.std(nr) > 0 else 0.0
    ti = int(np.argmin(dd_nav))
    pk = float(equity[:ti + 1].max())
    ri = next((i for i in range(ti, len(equity)) if equity[i] >= pk), None)
    return {"final_equity": float(equity[-1]), "cagr": cagr,
            "max_drawdown": maxdd, "sharpe": sharpe,
            "recovery_days": (ri - ti) if ri is not None else -1}


# ── Episode analysis ──────────────────────────────────────────────────────────
def _compute_episode(res, ep_start, ep_end):
    dt  = pd.to_datetime(res['dates'])
    eq  = res['equity']
    ca  = res['cash']
    ts  = pd.Timestamp(ep_start)
    te  = pd.Timestamp(ep_end)
    mk  = (dt >= ts) & (dt <= te)
    if mk.sum() == 0: return None

    ee  = eq[mk]; ec = ca[mk]; ed = dt[mk]; gi = np.where(mk)[0]
    rp  = np.maximum.accumulate(ee)
    epdd= (ee / rp) - 1.0
    mdd = float(epdd.min())
    ti  = int(np.argmin(epdd))
    pk  = float(ee[:ti+1].max())
    ri  = next((i for i in range(ti, len(ee)) if ee[i] >= pk), None)
    epr = float(ee[-1] / ee[0]) - 1.0
    p6  = None
    if gi[-1] + POST_6M_DAYS < len(eq):
        p6 = float(eq[gi[-1] + POST_6M_DAYS] / eq[gi[-1]]) - 1.0
    cp  = float(ec[ti] / ee[ti]) * 100 if ee[ti] > 0 else 0.0

    # churn count: TM_SELL1 events in episode
    churn = sum(1 for ev in res['trade_log']
                if ts <= pd.Timestamp(ev[0]) <= te and ev[1] == "TM_SELL1")
    # bear activations in episode
    bears = sum(1 for ev in res['trade_log']
                if ts <= pd.Timestamp(ev[0]) <= te and ev[1] == "BEAR_START")

    return {"max_dd": mdd, "recovery_d": (ri-ti) if ri else -1,
            "ep_ret": epr, "post_6m": p6, "cash_pct": cp,
            "trough_date": ed[ti],
            "churn": churn, "bear_acts": bears}


def _find_first_signal(res, ep_start, ep_end, strat_key):
    tags = EXIT_TAGS.get(strat_key, ())
    ts   = pd.Timestamp(ep_start)
    te   = pd.Timestamp(ep_end)
    for ev in res['trade_log']:
        d = pd.Timestamp(ev[0])
        if ts <= d <= te and ev[1] in tags:
            return d
    return None


def _compute_all_episodes(results, data):
    dates_g  = pd.to_datetime(data['date'].values)
    prices_g = data['close'].values
    dd_g     = data['drawdown'].values
    idx_map  = {d: i for i, d in enumerate(dates_g)}
    out = {}
    for ep_name, (ep_s, ep_e) in EPISODES.items():
        out[ep_name] = {}
        ts = pd.Timestamp(ep_s); te = pd.Timestamp(ep_e)
        mk = (dates_g >= ts) & (dates_g <= te)
        ep_p = prices_g[mk]; ep_d = dates_g[mk]
        if len(ep_p) == 0: continue
        lpd = ep_d[int(np.argmax(ep_p))]  # local price peak date
        for k, res in results.items():
            m = _compute_episode(res, ep_s, ep_e)
            if m is None: continue
            sd = _find_first_signal(res, ep_s, ep_e, k)
            if sd is not None:
                m['signal_lag'] = (sd - lpd).days
                gi = idx_map.get(sd)
                m['dd_at_signal'] = float(dd_g[gi]) if gi else None
            else:
                m['signal_lag'] = None; m['dd_at_signal'] = None
            m['first_signal'] = sd
            out[ep_name][k] = m
    return out


def _compute_bear_stats(bear_flags: dict, data: pd.DataFrame) -> dict:
    """Per episode: first detection date, lag, bear_days, bear_pct for each variant."""
    dates_g = pd.to_datetime(data['date'].values)
    out = {}
    for ep_name, (ep_s, ep_e) in EPISODES.items():
        ts   = pd.Timestamp(ep_s); te = pd.Timestamp(ep_e)
        mask = (dates_g >= ts) & (dates_g <= te)
        ep_dt= dates_g[mask]
        out[ep_name] = {}
        for vk, bf in bear_flags.items():
            ep_b  = bf[mask]
            bdays = int(ep_b.sum())
            first = None
            for d, b in zip(ep_dt, ep_b):
                if b: first = d; break
            lag = (first - ts).days if first is not None else None
            out[ep_name][vk] = {
                "first": first, "lag": lag,
                "days": bdays,
                "pct": bdays / max(mask.sum(), 1) * 100,
            }
    return out


# ── Print utilities ───────────────────────────────────────────────────────────
def _print_overall(results):
    strats = list(results.keys())
    print("\n[4] 전체 성과 요약 (2011-2026)")
    print("-" * 76)
    print(f"  {'전략':<28} {'최종 자산':>12} {'CAGR':>7} {'Max DD':>8} "
          f"{'Sharpe':>8} {'회복(d)':>10}")
    print("-" * 76)
    for k in strats:
        m  = results[k]['metrics']
        rd = m['recovery_days']
        print(f"  {results[k]['label']:<28} ${m['final_equity']:>11,.0f} "
              f"{m['cagr']*100:>6.1f}% {m['max_drawdown']*100:>7.1f}% "
              f"{m['sharpe']:>8.2f} {(str(rd)+'d' if rd>=0 else 'n/a'):>10}")
    print("-" * 76)


def _print_episodes(ep_data, results):
    strats = list(results.keys())
    labels = {k: results[k]['label'] for k in strats}
    # Only print key metrics: Max DD and Episode Return (wide table)
    print("\n[5] 에피소드별 Max DD")
    hdr = f"  {'에피소드':<22}" + "".join(f"{labels[k][:12]:>14}" for k in strats)
    print(hdr)
    print("-" * (22 + 14 * len(strats) + 2))
    for ep_name in EPISODES:
        ep  = ep_data.get(ep_name, {})
        row = f"  {ep_name:<22}"
        for k in strats:
            m   = ep.get(k)
            val = f"{m['max_dd']*100:+.1f}%" if m else 'n/a'
            row += f"{val:>14}"
        print(row)

    print("\n[6] 에피소드별 Episode Return")
    print(hdr)
    print("-" * (22 + 14 * len(strats) + 2))
    for ep_name in EPISODES:
        ep  = ep_data.get(ep_name, {})
        row = f"  {ep_name:<22}"
        for k in strats:
            m   = ep.get(k)
            val = f"{m['ep_ret']*100:+.1f}%" if m else 'n/a'
            row += f"{val:>14}"
        print(row)

    print("\n[7] 에피소드별 Recovery Days")
    print(hdr)
    print("-" * (22 + 14 * len(strats) + 2))
    for ep_name in EPISODES:
        ep  = ep_data.get(ep_name, {})
        row = f"  {ep_name:<22}"
        for k in strats:
            m = ep.get(k)
            if m:
                rd = m['recovery_d']
                row += f"{(str(rd)+'d' if rd>=0 else 'n/a'):>14}"
            else:
                row += f"{'n/a':>14}"
        print(row)


def _print_detection(bear_stats):
    vks = list(VARIANT_CONFIGS.keys())
    print("\n[8] 구조적 약세장 감지 타이밍")
    print(f"\n  {'에피소드':<22}" + "".join(f"{'감지일('+k+')':>16}" for k in vks))
    print("-" * (22 + 16 * len(vks) + 2))
    for ep_name in EPISODES:
        row = f"  {ep_name:<22}"
        for vk in vks:
            d = bear_stats.get(ep_name, {}).get(vk, {})
            f = d.get('first')
            row += f"{(str(f.date()) if f else 'none'):>16}"
        print(row)

    print(f"\n  {'에피소드':<22}" + "".join(f"{'Lag(d)('+k+')':>16}" for k in vks))
    print("-" * (22 + 16 * len(vks) + 2))
    for ep_name in EPISODES:
        row = f"  {ep_name:<22}"
        for vk in vks:
            d   = bear_stats.get(ep_name, {}).get(vk, {})
            lag = d.get('lag')
            row += f"{(f'+{lag}d' if lag is not None else 'none'):>16}"
        print(row)

    print(f"\n  {'에피소드':<22}" + "".join(f"{'Days('+k+')':>16}" for k in vks))
    print("-" * (22 + 16 * len(vks) + 2))
    for ep_name in EPISODES:
        row = f"  {ep_name:<22}"
        for vk in vks:
            d  = bear_stats.get(ep_name, {}).get(vk, {})
            bd = d.get('days', 0)
            pc = d.get('pct', 0.0)
            row += f"{f'{bd}d({pc:.0f}%)':>16}"
        print(row)


def _print_churn(ep_data, results):
    sbs_keys = list(VARIANT_CONFIGS.keys())
    labels   = {k: results[k]['label'] for k in sbs_keys}
    print("\n[9] TM Sell 횟수 (Churn) per 에피소드")
    hdr = f"  {'에피소드':<22}" + "".join(f"{labels[k][:14]:>15}" for k in sbs_keys)
    print(hdr)
    print("-" * (22 + 15 * len(sbs_keys) + 2))
    for ep_name in EPISODES:
        ep  = ep_data.get(ep_name, {})
        row = f"  {ep_name:<22}"
        for k in sbs_keys:
            m = ep.get(k)
            row += f"{(str(m['churn']) if m else '0'):>15}"
        print(row)

    print(f"\n  {'에피소드':<22}" + "".join(f"{'BearActs('+k+')':>15}" for k in sbs_keys))
    print("-" * (22 + 15 * len(sbs_keys) + 2))
    for ep_name in EPISODES:
        ep  = ep_data.get(ep_name, {})
        row = f"  {ep_name:<22}"
        for k in sbs_keys:
            m = ep.get(k)
            row += f"{(str(m['bear_acts']) if m else '0'):>15}"
        print(row)


def _print_2022_focus(ep_data, results):
    """2022 Fed Bear 상세 비교."""
    strats = list(results.keys())
    ep = ep_data.get("2022 Fed Bear", {})
    print("\n[10] 2022 Fed Bear 상세 분석")
    print("-" * 72)
    for k in strats:
        m = ep.get(k)
        if not m: continue
        rd = m['recovery_d']
        print(f"  {results[k]['label']:<28}  "
              f"MaxDD={m['max_dd']*100:+.1f}%  "
              f"EpRet={m['ep_ret']*100:+.1f}%  "
              f"Recov={str(rd)+'d' if rd>=0 else 'n/a'}  "
              f"Cash={m['cash_pct']:.0f}%  "
              f"Churn={m['churn']}")
    print("-" * 72)


# ── Charts ────────────────────────────────────────────────────────────────────
def _generate_charts(results, data, bear_flags, ep_data, bear_stats, out_dir):
    dates_g  = pd.to_datetime(data['date'].values)
    prices_g = data['close'].values
    vks      = list(VARIANT_CONFIGS.keys())
    strats   = list(results.keys())

    # ── Chart 1: Bear flag timeline — all variants, 2022 window ──────────────
    ts22 = pd.Timestamp("2021-01-01")
    te22 = pd.Timestamp("2023-12-31")
    mk22 = (dates_g >= ts22) & (dates_g <= te22)
    dt22 = dates_g[mk22]

    fig, axes = plt.subplots(len(vks) + 1, 1, figsize=(16, 14), sharex=True)
    axes[0].semilogy(dt22, prices_g[mk22], color='black', lw=1.0)
    axes[0].plot(dt22, data['ma200'].values[mk22], color='blue', lw=0.8, ls='--', alpha=0.7)
    axes[0].set_ylabel("TQQQ"); axes[0].set_title(
        "WO20 — StructuralBear Variants: 2021-2023 상세 (파란점선=MA200)",
        fontsize=12, fontweight='bold')
    axes[0].grid(True, alpha=0.3)

    for i, vk in enumerate(vks):
        ax  = axes[i + 1]
        bf  = bear_flags[vk][mk22]
        ax.fill_between(dt22, bf.astype(float), 0,
                        color=COLORS[vk], alpha=0.7, label=VARIANT_LABELS[vk])
        ax.set_ylim(-0.1, 1.5); ax.set_ylabel("ON/OFF")
        ax.legend(fontsize=9, loc='upper right'); ax.grid(True, alpha=0.2)
    axes[-1].set_xlabel("Date")
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'bear_variants_2022_wo20.png'), dpi=150)
    plt.close(fig)
    print("    bear_variants_2022_wo20.png")

    # ── Chart 2: Full equity curve (SBS variants only) ────────────────────────
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(15, 10), sharex=True)
    plot_keys = ['ma200', 'adapt_b'] + vks
    for k in plot_keys:
        res = results[k]
        dt  = pd.to_datetime(res['dates'])
        ax1.plot(dt, res['equity'], color=COLORS[k], lw=1.3,
                 label=results[k]['label'], alpha=0.85)
        ax2.plot(dt, res['drawdown_nav']*100, color=COLORS[k], lw=0.9,
                 label=results[k]['label'], alpha=0.75)
    ax1.set_title("WO20 — 전체 자산 곡선 비교 (2011-2026)", fontsize=12, fontweight='bold')
    ax1.set_ylabel("자산($)"); ax1.legend(fontsize=8, ncol=2); ax1.grid(True, alpha=0.3)
    ax2.set_title("낙폭 (%)"); ax2.set_ylabel("낙폭(%)"); ax2.set_xlabel("날짜")
    ax2.legend(fontsize=8, ncol=2); ax2.grid(True, alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'equity_curve_wo20.png'), dpi=150)
    plt.close(fig)
    print("    equity_curve_wo20.png")

    # ── Chart 3: 2022 episode equity comparison ───────────────────────────────
    ts2  = pd.Timestamp("2021-11-01"); te2 = pd.Timestamp("2023-06-30")
    fig, ax = plt.subplots(figsize=(14, 7))
    for k in plot_keys:
        res  = results[k]
        dt   = pd.to_datetime(res['dates'])
        eq   = res['equity']
        mk   = (dt >= ts2) & (dt <= te2)
        if mk.sum() == 0: continue
        ax.plot(dt[mk], eq[mk] / eq[mk][0] * 100, color=COLORS[k],
                lw=1.8, label=results[k]['label'])
    ax.axhline(100, color='gray', lw=0.6, ls='--')
    # shade SBS bear periods for sbs_D (best candidate)
    bf_d = bear_flags['sbs_D']
    in_b = False; b_st = None
    for d, b in zip(dates_g[(dates_g>=ts2)&(dates_g<=te2)],
                    bf_d[(dates_g>=ts2)&(dates_g<=te2)]):
        if b and not in_b:  b_st = d; in_b = True
        elif not b and in_b:
            ax.axvspan(b_st, d, color='purple', alpha=0.08); in_b = False
    if in_b: ax.axvspan(b_st, te2, color='purple', alpha=0.08)
    ax.set_title("WO20 — 2022 Fed Bear 에피소드 비교 (시작=100, 보라=SBS-D bear)",
                 fontsize=12, fontweight='bold')
    ax.set_ylabel("인덱스 (시작=100)"); ax.set_xlabel("날짜")
    ax.legend(fontsize=9); ax.grid(True, alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, '2022_episode_wo20.png'), dpi=150)
    plt.close(fig)
    print("    2022_episode_wo20.png")

    # ── Chart 4: Max DD heatmap (all strats × episodes) ───────────────────────
    ep_names = list(EPISODES.keys())
    dd_mat   = np.zeros((len(strats), len(ep_names)))
    for j, ep_n in enumerate(ep_names):
        for i, k in enumerate(strats):
            v = ep_data.get(ep_n, {}).get(k, {}).get('max_dd', 0.0)
            dd_mat[i, j] = v * 100 if v else 0.0

    fig, ax = plt.subplots(figsize=(16, 5))
    im = ax.imshow(dd_mat, cmap='RdYlGn', aspect='auto', vmin=-65, vmax=0)
    ax.set_xticks(range(len(ep_names)))
    ax.set_xticklabels([e.replace(' ', '\n') for e in ep_names], fontsize=9)
    ax.set_yticks(range(len(strats)))
    ax.set_yticklabels([results[k]['label'][:16] for k in strats], fontsize=9)
    for j in range(len(ep_names)):
        for i in range(len(strats)):
            v = dd_mat[i, j]
            ax.text(j, i, f"{v:.1f}%", ha='center', va='center', fontsize=7,
                    fontweight='bold', color='white' if v < -40 else 'black')
    plt.colorbar(im, ax=ax, label='Max Drawdown (%)')
    ax.set_title("WO20 — Max DD 히트맵 (에피소드별)", fontsize=12, fontweight='bold')
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'dd_heatmap_wo20.png'), dpi=150)
    plt.close(fig)
    print("    dd_heatmap_wo20.png")

    # ── Chart 5: Bear detection coverage per episode ──────────────────────────
    x    = np.arange(len(list(EPISODES.keys())))
    bw   = 0.15
    fig, ax = plt.subplots(figsize=(16, 6))
    for i, vk in enumerate(vks):
        vals = [bear_stats.get(ep, {}).get(vk, {}).get('pct', 0.0)
                for ep in EPISODES]
        ax.bar(x + i * bw - bw * 2, vals, bw,
               label=VARIANT_LABELS[vk], color=COLORS[vk], alpha=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(list(EPISODES.keys()), rotation=20, ha='right')
    ax.set_ylabel("에피소드 내 Bear 비율 (%)")
    ax.set_title("WO20 — StructuralBear 감지 커버리지 (이상적: 2022만 높아야)",
                 fontsize=12, fontweight='bold')
    ax.legend(fontsize=9); ax.grid(True, axis='y', alpha=0.3)
    plt.tight_layout()
    fig.savefig(os.path.join(out_dir, 'bear_coverage_wo20.png'), dpi=150)
    plt.close(fig)
    print("    bear_coverage_wo20.png")


# ── Main ──────────────────────────────────────────────────────────────────────
def run_wo20():
    print("=" * 76)
    print("  WO20 -- Structural Bear Detector Optimization")
    print("  7 에피소드 × 7 전략 (MA200, Adapt-B, SBS Baseline, A, B, C, D)")
    print("=" * 76)

    dirname = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')
    root    = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_market_complete'
    out_dir = os.path.join(root, 'vr_backtest', 'results', 'charts')
    os.makedirs(out_dir, exist_ok=True)

    print("\n[1] TQQQ 데이터 로딩 ...")
    data = load_tqqq()
    data = _add_ma50(data)
    print(f"    {len(data)} trading days  "
          f"({data['date'].iloc[0]} -> {data['date'].iloc[-1]})")

    print("\n[2] 구조적 약세장 플래그 계산 (5 변형) ...")
    bear_flags = {}
    for vk, (min_b, use_ma50, lock_d) in VARIANT_CONFIGS.items():
        raw_bf = compute_bear_flag(data, min_below_days=min_b, use_ma50=use_ma50)
        bear_flags[vk] = apply_bear_lock(raw_bf, lock_d)
        total = int(bear_flags[vk].sum())
        print(f"    {VARIANT_LABELS[vk]:<28}: {total}d ({total/len(data)*100:.1f}%)")

    print("\n[3] 7개 전략 실행 (전체 기간) ...")
    results = {}

    r = run_ma200_strategy(data);  r['label'] = 'MA200';    results['ma200']    = r
    r = run_adaptive_ma(data, far_sell_pct=AM_FAR_SELL,
                        far_crash_ma_col=AM_FAR_MA,
                        far_crash_speed_col=AM_SPD_COL,
                        far_crash_speed_thr=AM_SPD_THR)
    r['label'] = 'Adapt-B'; results['adapt_b'] = r

    for vk in VARIANT_CONFIGS:
        r = run_sbs_strategy(data, bear_flags[vk])
        r['label'] = VARIANT_LABELS[vk]
        results[vk] = r
        print(f"    {VARIANT_LABELS[vk]} 완료")

    # ── outputs ───────────────────────────────────────────────────────────────
    _print_overall(results)

    ep_data    = _compute_all_episodes(results, data)
    bear_stats = _compute_bear_stats(bear_flags, data)

    _print_episodes(ep_data, results)
    _print_detection(bear_stats)
    _print_churn(ep_data, results)
    _print_2022_focus(ep_data, results)

    # ── 결론 ──────────────────────────────────────────────────────────────────
    print("\n" + "=" * 76)
    print("  [결론] WO20 최적 변형 선정 기준")
    print("=" * 76)
    for vk in VARIANT_CONFIGS:
        m22 = ep_data.get("2022 Fed Bear", {}).get(vk, {})
        m20 = ep_data.get("2020 COVID",    {}).get(vk, {})
        m18 = ep_data.get("2018 Q4 Selloff",{}).get(vk, {})
        m   = results[vk]['metrics']
        bd22= bear_stats.get("2022 Fed Bear",  {}).get(vk, {}).get('days', 0)
        bd18= bear_stats.get("2018 Q4 Selloff",{}).get(vk, {}).get('days', 0)
        print(f"\n  {VARIANT_LABELS[vk]}")
        print(f"    전체: CAGR={m['cagr']*100:.1f}% MaxDD={m['max_drawdown']*100:.1f}% "
              f"Sharpe={m['sharpe']:.3f}")
        if m22:
            print(f"    2022: MaxDD={m22['max_dd']*100:.1f}% EpRet={m22['ep_ret']*100:.1f}% "
                  f"Bear={bd22}d Churn={m22['churn']}")
        if m20:
            print(f"    2020: MaxDD={m20['max_dd']*100:.1f}% EpRet={m20['ep_ret']*100:.1f}%")
        if m18:
            print(f"    2018Q4: MaxDD={m18['max_dd']*100:.1f}% Bear(FP)={bd18}d "
                  f"Churn={m18['churn']}")
    print("=" * 76)

    print("\n[11] 차트 생성 ...")
    _generate_charts(results, data, bear_flags, ep_data, bear_stats, out_dir)
    print(f"    저장 위치: {out_dir}")

    print("\n[12] 완료")
    print("=" * 76)


if __name__ == '__main__':
    run_wo20()
