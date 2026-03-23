"""
vr_backtest/strategies/ma200_strategy.py
==========================================
Strategy B: 200-day Moving Average trend filter.

Rules
-----
- When close > MA200: fully invested in TQQQ
- When close < MA200: move to cash (sell position)
- Re-enter when close crosses back above MA200
- Monthly contribution: $250 (added to cash, then deployed when in-market)

Interface
---------
run_ma200_strategy(data, initial_cash=10_000, monthly_contrib=250) -> dict
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def run_ma200_strategy(
    data:           pd.DataFrame,
    initial_cash:   float = 10_000.0,
    monthly_contrib: float = 250.0,
) -> dict:
    """
    Run the 200-MA strategy on TQQQ daily data.

    Parameters
    ----------
    data            : DataFrame from loader.load_tqqq()
    initial_cash    : starting portfolio value
    monthly_contrib : monthly DCA contribution

    Returns
    -------
    Same dict structure as run_buy_hold()
    """
    dates   = data['date'].values
    prices  = data['close'].values
    ma200   = data['ma200'].values
    T       = len(dates)

    equity     = np.zeros(T)
    cash_arr   = np.zeros(T)
    trade_log  = []

    # state
    shares     = 0.0
    cash       = initial_cash
    in_market  = prices[0] > ma200[0]   # invest if above MA200 on day 0

    if in_market:
        shares  = cash / prices[0]
        cash    = 0.0
        trade_log.append((dates[0], 'BUY_INIT', prices[0], shares, cash))
    else:
        trade_log.append((dates[0], 'START_CASH', prices[0], 0.0, cash))

    equity[0]   = shares * prices[0] + cash
    cash_arr[0] = cash
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        curr_month = pd.Timestamp(dates[t]).month

        # monthly contribution → to cash
        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        above_ma = prices[t] > ma200[t]

        # --- transition: exit to cash ---
        if in_market and not above_ma:
            cash      += shares * prices[t]
            trade_log.append((dates[t], 'SELL', prices[t], shares, cash))
            shares    = 0.0
            in_market = False

        # --- transition: enter from cash ---
        elif not in_market and above_ma:
            shares    = cash / prices[t]
            cash      = 0.0
            trade_log.append((dates[t], 'BUY', prices[t], shares, cash))
            in_market = True

        # --- deploy monthly cash if already in market ---
        elif in_market and cash > 0:
            new_shares = cash / prices[t]
            shares    += new_shares
            cash       = 0.0
            trade_log.append((dates[t], 'DCA', prices[t], new_shares, cash))

        equity[t]   = shares * prices[t] + cash
        cash_arr[t] = cash

    rolling_peak = np.maximum.accumulate(equity)
    drawdown_nav = (equity / rolling_peak) - 1.0

    metrics = _compute_metrics(equity, drawdown_nav, cash_arr, dates)
    return {
        'name':         '200MA Strategy',
        'equity':       equity,
        'dates':        dates,
        'drawdown_nav': drawdown_nav,
        'cash':         cash_arr,
        'trade_log':    trade_log,
        'metrics':      metrics,
    }


def _compute_metrics(
    equity:    np.ndarray,
    dd_nav:    np.ndarray,
    cash_arr:  np.ndarray,
    dates:     np.ndarray,
) -> dict:
    nav_returns = np.diff(equity) / equity[:-1]
    years       = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days / 365.25
    cagr        = (equity[-1] / equity[0]) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd      = float(dd_nav.min())
    sharpe      = (
        float(np.mean(nav_returns)) / float(np.std(nav_returns)) * np.sqrt(252)
        if np.std(nav_returns) > 0 else 0.0
    )
    trough_idx  = int(np.argmin(dd_nav))
    peak_nav    = float(equity[:trough_idx + 1].max())
    rec_idx     = next(
        (i for i in range(trough_idx, len(equity)) if equity[i] >= peak_nav),
        None,
    )
    recovery_days = (rec_idx - trough_idx) if rec_idx is not None else -1
    cash_util     = float(np.mean(cash_arr > 0))

    return {
        'final_equity':    float(equity[-1]),
        'cagr':            cagr,
        'max_drawdown':    max_dd,
        'sharpe':          sharpe,
        'recovery_days':   recovery_days,
        'cash_utilisation': cash_util,
    }
