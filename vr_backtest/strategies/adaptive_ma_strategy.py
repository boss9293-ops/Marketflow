"""
vr_backtest/strategies/adaptive_ma_strategy.py
===============================================
Strategy: Adaptive MA Distance

Regime is LOCKED at the PEAK of each invested period (max dist200 since
last entry), not re-evaluated at the crossing moment.  This prevents the
common degenerate case where price has already shrunk back to Near zone
by the time it crosses a slower MA.

Regime lock (based on max_dist since last MA200_ENTRY):
  Near   (max_dist <= 15%) : exit when price < MA200        (full sell)
  Medium (max_dist 15-30%) : exit when price < MA150        (full sell)
  Far    (max_dist >  30%) : exit when price < MA120
                             AND 4-day return <= -15%       (50% sell)
                             Fallback: price < MA150        (full sell)

Bottom buy ladder (same as MA200+BottomBuy):
  DD <= -40% : buy 20% of current portfolio
  DD <= -50% : buy 20% of current portfolio
  DD <= -60% : buy 20% of current portfolio

Rebuild full position when price > MA200.
Monthly contributions continue throughout.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# Regime thresholds (Distance200)
NEAR_THR = 0.15   # dist <= 15%  -> use MA200
MED_THR  = 0.30   # dist 15-30% -> use MA150
                   # dist > 30%  -> use MA120 + speed4

FAR_SELL_PCT = 0.50   # sell 50% in Far / bubble regime

SPEED_THR = -0.15   # 4-day return threshold for Far crash filter

LADDER = [
    (-0.40, 0.20),
    (-0.50, 0.20),
    (-0.60, 0.20),
]


def run_adaptive_ma(
    data:                  pd.DataFrame,
    initial_cash:          float = 10_000.0,
    monthly_contrib:       float = 250.0,
    far_sell_pct:          float = 0.50,    # fraction to sell on Far crash trigger
    far_crash_ma_col:      str   = 'ma120', # 'ma120' or 'ma150'
    far_crash_speed_col:   str   = 'speed4',# 'speed4' (4d) or 'speed3' (3d)
    far_crash_speed_thr:   float = -0.15,   # speed trigger threshold
) -> dict:
    dates           = data["date"].values
    prices          = data["close"].values
    ma200_arr       = data["ma200"].values
    ma150_arr       = data["ma150"].values
    ma120_arr       = data["ma120"].values
    drawdowns       = data["drawdown"].values
    dist200         = data["distance200"].values
    speeds          = data[far_crash_speed_col].values
    far_crash_ma    = data[far_crash_ma_col].values   # MA array for crash trigger
    T               = len(dates)

    equity    = np.zeros(T)
    cash_arr  = np.zeros(T)
    trade_log = []

    shares = initial_cash / prices[0]
    cash   = 0.0

    invested         = True
    ladder_done      = [False, False, False]
    max_dist         = dist200[0]
    far_partial_done = False

    trade_log.append((dates[0], "BUY_INIT", prices[0], shares, cash))
    equity[0]   = shares * prices[0]
    cash_arr[0] = cash
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price       = prices[t]
        dd          = drawdowns[t]
        ma200       = ma200_arr[t]
        ma150       = ma150_arr[t]
        ma120       = ma120_arr[t]
        fc_ma       = far_crash_ma[t]   # MA used for Far crash trigger
        dist        = dist200[t]
        speed       = speeds[t]
        curr_month  = pd.Timestamp(dates[t]).month

        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        if invested:
            # Update peak distance during this invested period
            if dist > max_dist:
                max_dist = dist

            # DCA: deploy cash when price > MA200
            if cash > 0 and price > ma200:
                new_shares = cash / price
                shares    += new_shares
                cash       = 0.0
                trade_log.append((dates[t], "DCA", price, new_shares, 0.0))

            # Regime-based exit: use LOCKED regime (max_dist since last entry)
            exit_triggered = False
            exit_tag       = ""
            sell_pct       = 1.0

            if max_dist <= NEAR_THR:
                # Near regime: full exit at MA200
                if price < ma200:
                    exit_triggered = True
                    exit_tag       = "NEAR_EXIT"

            elif max_dist <= MED_THR:
                # Medium regime: full exit at MA150
                if price < ma150:
                    exit_triggered = True
                    exit_tag       = "MED_EXIT"

            else:
                # Far / bubble regime:
                #   Primary  : 50% sell when price < MA120 AND speed crash
                #   Fallback : full sell when price < MA150 (slow bear defense)
                if not far_partial_done and price < fc_ma and speed <= far_crash_speed_thr:
                    exit_triggered   = True
                    exit_tag         = "FAR_CRASH_SELL"
                    sell_pct         = far_sell_pct
                    far_partial_done = True
                elif price < ma150:
                    exit_triggered = True
                    exit_tag       = "FAR_TREND_SELL"
                    sell_pct       = 1.0

            if exit_triggered:
                sell_shares = shares * sell_pct
                sell_value  = sell_shares * price
                shares     -= sell_shares
                cash       += sell_value
                invested    = False
                ladder_done = [False, False, False]
                trade_log.append((dates[t], exit_tag, price, sell_shares, cash))

        else:  # DEFENSIVE
            # Bottom accumulation ladder
            for i, (thr, pct) in enumerate(LADDER):
                if not ladder_done[i] and dd <= thr:
                    portfolio_val = shares * price + cash
                    buy_value     = min(portfolio_val * pct, cash)
                    if buy_value > 1.0:
                        new_shares  = buy_value / price
                        shares     += new_shares
                        cash       -= buy_value
                        trade_log.append(
                            (dates[t], f"BOTTOM_BUY_{int(abs(thr)*100)}", price, new_shares, cash)
                        )
                    ladder_done[i] = True

            # Re-entry: price returns above MA200
            if price > ma200:
                if cash > 0:
                    new_shares = cash / price
                    shares    += new_shares
                    trade_log.append((dates[t], "MA200_ENTRY", price, new_shares, 0.0))
                    cash = 0.0
                invested         = True
                ladder_done      = [False, False, False]
                far_partial_done = False
                max_dist         = dist   # reset regime lock on re-entry

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    rolling_peak = np.maximum.accumulate(equity)
    drawdown_nav = (equity / rolling_peak) - 1.0
    metrics      = _compute_metrics(equity, drawdown_nav, cash_arr, dates)

    pct_tag   = int(far_sell_pct * 100)
    ma_tag    = far_crash_ma_col.upper()           # MA120 / MA150
    spd_days  = far_crash_speed_col[-1]            # 4 or 3
    spd_thr   = int(abs(far_crash_speed_thr) * 100) # 15 / 12 / 10
    cfg_tag   = f"{ma_tag}_{spd_days}d{spd_thr}p_{pct_tag}pct"
    return {
        "name":         f"AdaptiveMA_{cfg_tag}",
        "label":        f"Adaptive {ma_tag}/{spd_days}d-{spd_thr}% sell{pct_tag}%",
        "equity":       equity,
        "dates":        dates,
        "drawdown_nav": drawdown_nav,
        "cash":         cash_arr,
        "trade_log":    trade_log,
        "metrics":      metrics,
    }


def _compute_metrics(equity, dd_nav, cash_arr, dates):
    nav_returns = np.diff(equity) / equity[:-1]
    years       = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days / 365.25
    cagr        = (equity[-1] / equity[0]) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd      = float(dd_nav.min())
    sharpe      = (
        float(np.mean(nav_returns)) / float(np.std(nav_returns)) * np.sqrt(252)
        if np.std(nav_returns) > 0 else 0.0
    )
    trough_idx    = int(np.argmin(dd_nav))
    peak_nav      = float(equity[:trough_idx + 1].max())
    rec_idx       = next(
        (i for i in range(trough_idx, len(equity)) if equity[i] >= peak_nav), None
    )
    recovery_days = (rec_idx - trough_idx) if rec_idx is not None else -1
    cash_util     = float(np.mean(cash_arr > 0))
    return {
        "final_equity":     float(equity[-1]),
        "cagr":             cagr,
        "max_drawdown":     max_dd,
        "sharpe":           sharpe,
        "recovery_days":    recovery_days,
        "cash_utilisation": cash_util,
    }
