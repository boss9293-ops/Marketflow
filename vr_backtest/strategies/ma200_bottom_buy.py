"""
vr_backtest/strategies/ma200_bottom_buy.py
==========================================
MA200 + Bottom Buy strategy.

Rules
-----
  INVESTED (price > MA200):
    Fully invested; DCA monthly contribution

  DEFENSIVE (price < MA200):
    Sell ALL to cash on MA200 cross
    Bottom accumulation ladder (each fires once per episode):
      DD <= -40% : buy 20% of current portfolio value
      DD <= -50% : buy 20% of current portfolio value
      DD <= -60% : buy 20% of current portfolio value
    Monthly contributions stay as cash (available for ladder buys)
    Re-enter fully when price returns above MA200
"""
from __future__ import annotations

import numpy as np
import pandas as pd


LADDER = [
    (-0.40, 0.20),
    (-0.50, 0.20),
    (-0.60, 0.20),
]


def run_ma200_bottom_buy(
    data:            pd.DataFrame,
    initial_cash:    float = 10_000.0,
    monthly_contrib: float = 250.0,
) -> dict:
    dates     = data["date"].values
    prices    = data["close"].values
    ma200     = data["ma200"].values
    drawdowns = data["drawdown"].values
    T         = len(dates)

    equity    = np.zeros(T)
    cash_arr  = np.zeros(T)
    trade_log = []

    shares = initial_cash / prices[0]
    cash   = 0.0

    invested     = True
    ladder_done  = [False, False, False]

    trade_log.append((dates[0], "BUY_INIT", prices[0], shares, cash))
    equity[0]   = shares * prices[0]
    cash_arr[0] = cash
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price = prices[t]
        dd    = drawdowns[t]
        ma    = ma200[t]
        curr_month = pd.Timestamp(dates[t]).month

        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month
            if invested and cash > 0 and price > ma:
                new_shares = cash / price
                shares    += new_shares
                cash       = 0.0
                trade_log.append((dates[t], "DCA", price, new_shares, 0.0))

        if invested:
            # transition to defensive
            if price < ma:
                sell_value = shares * price
                cash      += sell_value
                trade_log.append((dates[t], "MA200_EXIT", price, shares, cash))
                shares       = 0.0
                invested     = False
                ladder_done  = [False, False, False]
        else:
            # bottom accumulation ladder
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

            # re-enter when price recovers above MA200
            if price > ma:
                if cash > 0:
                    new_shares = cash / price
                    shares    += new_shares
                    trade_log.append((dates[t], "MA200_ENTRY", price, new_shares, 0.0))
                    cash = 0.0
                invested    = True
                ladder_done = [False, False, False]

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    rolling_peak = np.maximum.accumulate(equity)
    drawdown_nav = (equity / rolling_peak) - 1.0
    metrics      = _compute_metrics(equity, drawdown_nav, cash_arr, dates)

    return {
        "name":         "MA200+BottomBuy",
        "label":        "MA200 + Bottom Buy",
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
