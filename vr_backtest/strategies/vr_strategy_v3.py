"""
vr_backtest/strategies/vr_strategy_v3.py
=========================================
Strategy v3: VR Hybrid -- Speed + Trend Break.

Addresses slow-bear weakness of v2 by adding MA200 cross as a
dedicated sell trigger, so grinding bear markets also trigger defense.

Triggers (each fires once per episode)
---------------------------------------
  Speed   : 4-day return <= -15%   -> sell 10% of current invested
  Trend   : price < MA200          -> sell additional 30% of current invested
  Crash   : DD <= -35%             -> sell additional 20% of current invested

Bottom Wait / Re-entry
-----------------------
  Same as v2: consolidation zone, 5-tranche re-entry, 5-day gap

States
------
  HOLD        : normal; watch speed trigger or MA200 cross
  DEFENSIVE   : episode active; watch trend and crash triggers
  BOTTOM_WAIT : price < MA200; wait for consolidation
  REENTRY     : deploying tranches
  RECOVERY    : tranches deployed; mop up cash
"""
from __future__ import annotations

from enum import Enum, auto

import numpy as np
import pandas as pd


class _State(Enum):
    HOLD        = auto()
    DEFENSIVE   = auto()
    BOTTOM_WAIT = auto()
    REENTRY     = auto()
    RECOVERY    = auto()


SPEED_COL      = "speed4"
SPEED_THR      = -0.15
SPEED_SELL_PCT = 0.10   # sell 10% on speed trigger
TREND_SELL_PCT = 0.30   # sell 30% on MA200 break
CRASH_SELL_PCT = 0.20   # sell 20% on DD <= -35%
CRASH_DD_THR   = -0.35

CONSOLIDATION_WINDOW    = 25
CONSOLIDATION_MAX_RANGE = 0.20
MAX_REENTRY_ENTRIES     = 5
MIN_ENTRY_GAP_DAYS      = 5
RECOVERY_EXIT_DD        = -0.15
REDEPLOY_RECOVERY_MULT  = 1.05


def run_vr_v3(
    data:            pd.DataFrame,
    initial_cash:    float = 10_000.0,
    monthly_contrib: float = 250.0,
) -> dict:
    dates     = data["date"].values
    prices    = data["close"].values
    ma200     = data["ma200"].values
    drawdowns = data["drawdown"].values
    speeds    = data[SPEED_COL].values
    T         = len(dates)

    equity    = np.zeros(T)
    cash_arr  = np.zeros(T)
    trade_log = []

    shares = initial_cash / prices[0]
    cash   = 0.0
    state  = _State.HOLD

    # episode variables
    sell_ref_price = 0.0
    crash_pool     = 0.0
    tranche_size   = 0.0
    entries_done   = 0
    last_entry_day = -999
    speed_done     = False
    trend_done     = False
    crash_done     = False

    trade_log.append((dates[0], "BUY_INIT", prices[0], shares, cash))
    equity[0]   = shares * prices[0]
    cash_arr[0] = cash
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price = prices[t]
        dd    = drawdowns[t]
        ma    = ma200[t]
        speed = speeds[t]
        curr_month = pd.Timestamp(dates[t]).month

        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        # ================================================================
        if state == _State.HOLD:
            # speed trigger
            if not speed_done and speed <= SPEED_THR:
                invested_value = shares * price
                sell_value     = invested_value * SPEED_SELL_PCT
                sell_shares    = sell_value / price
                shares        -= sell_shares
                cash          += sell_value
                sell_ref_price = price
                crash_pool     = sell_value
                speed_done     = True
                state          = _State.DEFENSIVE
                trade_log.append((dates[t], "SPEED_SELL", price, sell_shares, cash))

            # trend trigger (price < MA200) -- can fire same day as speed
            if not trend_done and price < ma:
                invested_value = shares * price
                sell_value     = invested_value * TREND_SELL_PCT
                sell_shares    = sell_value / price
                shares        -= sell_shares
                cash          += sell_value
                crash_pool    += sell_value
                if sell_ref_price == 0.0:
                    sell_ref_price = price
                trend_done = True
                state      = _State.DEFENSIVE
                trade_log.append((dates[t], "TREND_SELL", price, sell_shares, cash))

            # DCA in HOLD (above MA200 only, not triggered today)
            if state == _State.HOLD and cash > 0 and price > ma:
                new_shares = cash / price
                shares    += new_shares
                cash       = 0.0
                trade_log.append((dates[t], "DCA", price, new_shares, 0.0))

        # ================================================================
        elif state == _State.DEFENSIVE:
            # trend trigger fires in DEFENSIVE if not yet done and price < MA200
            if not trend_done and price < ma:
                invested_value = shares * price
                sell_value     = invested_value * TREND_SELL_PCT
                sell_shares    = sell_value / price
                shares        -= sell_shares
                cash          += sell_value
                crash_pool    += sell_value
                trend_done     = True
                trade_log.append((dates[t], "TREND_SELL", price, sell_shares, cash))

            # crash confirmation
            if not crash_done and dd <= CRASH_DD_THR:
                invested_value = shares * price
                sell_value     = invested_value * CRASH_SELL_PCT
                sell_shares    = sell_value / price
                shares        -= sell_shares
                cash          += sell_value
                crash_pool    += sell_value
                crash_done     = True
                trade_log.append((dates[t], "CRASH_SELL", price, sell_shares, cash))

            # recovery: price recovered above sell_ref * 1.05
            if price >= sell_ref_price * REDEPLOY_RECOVERY_MULT:
                if cash > 0:
                    new_shares = cash / price
                    shares    += new_shares
                    cash       = 0.0
                    trade_log.append((dates[t], "REDEPLOY", price, new_shares, 0.0))
                state = _State.HOLD
                sell_ref_price = 0.0; crash_pool = 0.0
                speed_done = False; trend_done = False; crash_done = False

            # transition to BOTTOM_WAIT once trend has fired and price is below MA200
            elif price < ma and trend_done:
                state = _State.BOTTOM_WAIT

        # ================================================================
        elif state == _State.BOTTOM_WAIT:
            in_zone  = _is_bottom_zone(prices, t, ma, CONSOLIDATION_WINDOW, CONSOLIDATION_MAX_RANGE)
            price_ok = price <= sell_ref_price

            if in_zone and price_ok:
                tranche_size   = crash_pool / MAX_REENTRY_ENTRIES
                entries_done   = 0
                last_entry_day = -999
                state          = _State.REENTRY

            elif price > ma * 1.02:
                if cash > 0:
                    new_shares = cash / price
                    shares    += new_shares
                    cash       = 0.0
                    trade_log.append((dates[t], "REDEPLOY", price, new_shares, 0.0))
                state = _State.HOLD
                sell_ref_price = 0.0; crash_pool = 0.0
                speed_done = False; trend_done = False; crash_done = False

        # ================================================================
        elif state == _State.REENTRY:
            in_zone  = _is_bottom_zone(prices, t, ma, CONSOLIDATION_WINDOW, CONSOLIDATION_MAX_RANGE)
            gap_ok   = (t - last_entry_day) >= MIN_ENTRY_GAP_DAYS
            price_ok = price <= sell_ref_price

            if in_zone and gap_ok and price_ok and entries_done < MAX_REENTRY_ENTRIES:
                buy_value = min(tranche_size, cash)
                if buy_value > 1.0:
                    new_shares    = buy_value / price
                    shares       += new_shares
                    cash         -= buy_value
                    entries_done += 1
                    last_entry_day = t
                    trade_log.append((dates[t], f"REENTRY_{entries_done}", price, new_shares, cash))

            if entries_done >= MAX_REENTRY_ENTRIES:
                state = _State.RECOVERY
            elif price > ma and price > sell_ref_price:
                state = _State.RECOVERY

        # ================================================================
        elif state == _State.RECOVERY:
            if cash > 1.0 and price > ma:
                new_shares = cash / price
                shares    += new_shares
                cash       = 0.0
                trade_log.append((dates[t], "RECOVERY_DEPLOY", price, new_shares, 0.0))

            if dd > RECOVERY_EXIT_DD and cash == 0.0:
                state = _State.HOLD
                sell_ref_price = 0.0; crash_pool = 0.0
                speed_done = False; trend_done = False; crash_done = False

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    rolling_peak = np.maximum.accumulate(equity)
    drawdown_nav = (equity / rolling_peak) - 1.0
    metrics      = _compute_metrics(equity, drawdown_nav, cash_arr, dates)

    return {
        "name":         "VR_v3_hybrid",
        "label":        "VR v3 Hybrid",
        "equity":       equity,
        "dates":        dates,
        "drawdown_nav": drawdown_nav,
        "cash":         cash_arr,
        "trade_log":    trade_log,
        "metrics":      metrics,
    }


def _is_bottom_zone(prices, t, ma200, window, max_range):
    if prices[t] >= ma200:
        return False
    start  = max(0, t - window + 1)
    slice_ = prices[start : t + 1]
    if len(slice_) < 5:
        return False
    rng = (slice_.max() - slice_.min()) / slice_.min()
    return rng < max_range


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
