"""
vr_backtest/strategies/buy_hold.py
====================================
Strategy A: Buy & Hold with monthly DCA contributions.

Rules
-----
- Day 0: invest all initial capital in TQQQ
- Every month: add $250 to position (buy at close)
- Never sell

Interface
---------
run_buy_hold(data, initial_cash=10_000, monthly_contrib=250) -> dict
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def run_buy_hold(
    data:           pd.DataFrame,
    initial_cash:   float = 10_000.0,
    monthly_contrib: float = 250.0,
) -> dict:
    """
    Run the Buy & Hold strategy on TQQQ daily data.

    Parameters
    ----------
    data            : DataFrame from loader.load_tqqq()
    initial_cash    : starting portfolio value in dollars
    monthly_contrib : monthly DCA contribution in dollars

    Returns
    -------
    dict with keys:
        equity      : np.ndarray of daily portfolio value
        dates       : np.ndarray of dates
        drawdown_nav: np.ndarray of NAV drawdown (always <= 0)
        cash        : np.ndarray of cash balance
        trade_log   : list of (date, action, price, shares, cash_after)
        metrics     : dict of scalar summary statistics
    """
    dates   = data['date'].values
    prices  = data['close'].values
    T       = len(dates)

    equity      = np.zeros(T)
    cash_arr    = np.zeros(T)
    trade_log   = []

    # --- Day 0: buy everything ---
    shares = initial_cash / prices[0]
    cash   = 0.0
    equity[0] = shares * prices[0]
    cash_arr[0] = cash
    trade_log.append((dates[0], 'BUY_INIT', prices[0], shares, cash))

    prev_month = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        curr_month = pd.Timestamp(dates[t]).month

        # monthly contribution: buy more shares
        if curr_month != prev_month:
            new_shares = monthly_contrib / prices[t]
            shares    += new_shares
            trade_log.append((dates[t], 'DCA', prices[t], new_shares, 0.0))
            prev_month = curr_month

        equity[t]   = shares * prices[t]
        cash_arr[t] = cash

    # NAV drawdown
    rolling_peak = np.maximum.accumulate(equity)
    drawdown_nav = (equity / rolling_peak) - 1.0

    metrics = _compute_metrics(equity, drawdown_nav, data['daily_return'].values, dates)
    return {
        'name':        'Buy & Hold',
        'equity':      equity,
        'dates':       dates,
        'drawdown_nav': drawdown_nav,
        'cash':        cash_arr,
        'trade_log':   trade_log,
        'metrics':     metrics,
    }


def _compute_metrics(
    equity:       np.ndarray,
    drawdown_nav: np.ndarray,
    daily_returns: np.ndarray,
    dates:        np.ndarray,
) -> dict:
    nav_returns = np.diff(equity) / equity[:-1]

    years      = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days / 365.25
    cagr       = (equity[-1] / equity[0]) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd     = float(drawdown_nav.min())
    sharpe     = (
        float(np.mean(nav_returns)) / float(np.std(nav_returns)) * np.sqrt(252)
        if np.std(nav_returns) > 0 else 0.0
    )

    # recovery time from max drawdown
    trough_idx = int(np.argmin(drawdown_nav))
    peak_nav   = float(equity[:trough_idx + 1].max())
    rec_idx    = next(
        (i for i in range(trough_idx, len(equity)) if equity[i] >= peak_nav),
        None,
    )
    recovery_days = (rec_idx - trough_idx) if rec_idx is not None else -1

    return {
        'final_equity':    float(equity[-1]),
        'cagr':            cagr,
        'max_drawdown':    max_dd,
        'sharpe':          sharpe,
        'recovery_days':   recovery_days,
        'cash_utilisation': 0.0,   # always 0 for B&H
    }
