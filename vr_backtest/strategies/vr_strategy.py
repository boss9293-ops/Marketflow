"""
vr_backtest/strategies/vr_strategy.py
=======================================
Strategy C: VR Crash Strategy (deterministic historical backtest).

Rules (verbatim from Work Order)
---------------------------------
Crash detection:
    drawdown (252-day peak) <= -35%

Crash response:
    Sell 50% of position at crash-day close
    Hold remaining 50%
    Record sell_reference_price = close at sell day

Bottom waiting condition:
    price < MA200  =>  hold cash, no buying

Bottom zone definition:
    price < MA200
    AND 20-30 day consolidation range
    (defined here as: (max - min) / min over past 25 days < 20%)

Re-entry rule:
    price <= sell_reference_price
    AND bottom_zone confirmed

Re-entry method:
    Divide available crash_pool into 5 equal tranches
    Deploy 1 tranche per qualifying day (min 5-day gap between entries)
    Max 5 entries per crash episode

Monthly contribution: $250 added to cash every month

State machine:
    HOLD        : normal; monitor for crash
    CRASH       : crash triggered; sold 50%; watching for bottom
    REENTRY     : bottom confirmed; deploying tranches
    RECOVERY    : all tranches deployed; monitoring for new crash

Interface
---------
run_vr_strategy(data, initial_cash=10_000, monthly_contrib=250) -> dict
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from enum import Enum, auto


class _State(Enum):
    HOLD     = auto()
    CRASH    = auto()
    REENTRY  = auto()
    RECOVERY = auto()


# Strategy parameters (fixed — not tuned)
CRASH_DD_THRESHOLD      = -0.35    # 252-day drawdown to trigger crash response
CONSOLIDATION_WINDOW    = 25       # days for consolidation check
CONSOLIDATION_MAX_RANGE = 0.20     # (max-min)/min < 20% = consolidating
MAX_REENTRY_ENTRIES     = 5
MIN_ENTRY_GAP_DAYS      = 5        # min trading days between ladder entries


def run_vr_strategy(
    data:           pd.DataFrame,
    initial_cash:   float = 10_000.0,
    monthly_contrib: float = 250.0,
) -> dict:
    """
    Run the VR Crash Strategy on TQQQ daily data.

    Parameters
    ----------
    data            : DataFrame from loader.load_tqqq()
    initial_cash    : starting portfolio value
    monthly_contrib : monthly DCA contribution

    Returns
    -------
    Same dict structure as run_buy_hold()
    """
    dates     = data['date'].values
    prices    = data['close'].values
    ma200     = data['ma200'].values
    drawdowns = data['drawdown'].values
    T         = len(dates)

    equity    = np.zeros(T)
    cash_arr  = np.zeros(T)
    trade_log = []

    # portfolio state
    shares          = initial_cash / prices[0]
    cash            = 0.0
    state           = _State.HOLD

    # crash episode variables
    sell_ref_price  = 0.0
    crash_pool      = 0.0      # cash available for re-entry
    tranche_size    = 0.0
    entries_done    = 0
    last_entry_day  = -999

    trade_log.append((dates[0], 'BUY_INIT', prices[0], shares, cash))
    equity[0]   = shares * prices[0]
    cash_arr[0] = cash
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price         = prices[t]
        dd            = drawdowns[t]
        ma            = ma200[t]
        curr_month    = pd.Timestamp(dates[t]).month

        # monthly contribution → always goes to cash
        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        # ================================================================
        # State: HOLD
        # ================================================================
        if state == _State.HOLD:
            # Check crash trigger
            if dd <= CRASH_DD_THRESHOLD:
                # Sell 50% of position
                sell_shares    = shares * 0.50
                sell_value     = sell_shares * price
                shares        -= sell_shares
                cash          += sell_value
                sell_ref_price = price
                crash_pool     = sell_value
                tranche_size   = crash_pool / MAX_REENTRY_ENTRIES
                entries_done   = 0
                last_entry_day = -999
                state          = _State.CRASH
                trade_log.append((dates[t], 'CRASH_SELL_50PCT', price, sell_shares, cash))

        # ================================================================
        # State: CRASH — watching for bottom zone
        # ================================================================
        elif state == _State.CRASH:
            # Check bottom zone: price < MA200 AND 20-30d consolidation
            if _is_bottom_zone(prices, t, ma, CONSOLIDATION_WINDOW, CONSOLIDATION_MAX_RANGE):
                # Bottom zone confirmed; check re-entry condition
                if price <= sell_ref_price and entries_done < MAX_REENTRY_ENTRIES:
                    state = _State.REENTRY

            # Also check: if drawdown gets worse, sell another 50% of remaining
            # (not in original spec — keeping simple)

        # ================================================================
        # State: REENTRY — split buying
        # ================================================================
        elif state == _State.REENTRY:
            # Deploy one tranche if:
            #   - price <= sell_ref_price
            #   - in bottom zone
            #   - min gap elapsed
            #   - entries remaining
            in_zone  = _is_bottom_zone(prices, t, ma, CONSOLIDATION_WINDOW, CONSOLIDATION_MAX_RANGE)
            gap_ok   = (t - last_entry_day) >= MIN_ENTRY_GAP_DAYS
            price_ok = price <= sell_ref_price

            if in_zone and gap_ok and price_ok and entries_done < MAX_REENTRY_ENTRIES:
                # Buy one tranche
                buy_value  = min(tranche_size, cash)
                if buy_value > 0:
                    new_shares  = buy_value / price
                    shares     += new_shares
                    cash       -= buy_value
                    entries_done += 1
                    last_entry_day = t
                    trade_log.append((dates[t], f'REENTRY_{entries_done}', price, new_shares, cash))

            # If price rises back above sell_ref and all entries done, go to RECOVERY
            if entries_done >= MAX_REENTRY_ENTRIES:
                state = _State.RECOVERY
            elif not in_zone and price > ma:
                # Bottom zone lost, price above MA — resume monitoring
                state = _State.RECOVERY

        # ================================================================
        # State: RECOVERY — back to monitoring for next crash
        # ================================================================
        elif state == _State.RECOVERY:
            # If leftover crash_pool cash, deploy it when above MA200
            if cash > 0 and price > ma:
                new_shares = cash / price
                shares    += new_shares
                cash       = 0.0
                trade_log.append((dates[t], 'DEPLOY_REMAINING', price, new_shares, cash))

            # Transition back to HOLD when drawdown is less severe
            if dd > CRASH_DD_THRESHOLD * 0.5:   # drawdown recovered to half threshold
                state = _State.HOLD
                sell_ref_price = 0.0
                crash_pool     = 0.0
                tranche_size   = 0.0
                entries_done   = 0

        # --- Deploy monthly DCA cash when in HOLD/RECOVERY and above MA200 ---
        if state in (_State.HOLD, _State.RECOVERY) and cash > 0 and price > ma:
            new_shares = cash / price
            shares    += new_shares
            cash       = 0.0
            trade_log.append((dates[t], 'DCA', price, new_shares, 0.0))

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    rolling_peak = np.maximum.accumulate(equity)
    drawdown_nav = (equity / rolling_peak) - 1.0

    metrics = _compute_metrics(equity, drawdown_nav, cash_arr, dates)
    return {
        'name':         'VR Strategy',
        'equity':       equity,
        'dates':        dates,
        'drawdown_nav': drawdown_nav,
        'cash':         cash_arr,
        'trade_log':    trade_log,
        'metrics':      metrics,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_bottom_zone(
    prices:     np.ndarray,
    t:          int,
    ma200:      float,
    window:     int,
    max_range:  float,
) -> bool:
    """True if price < MA200 and 25-day price range is < max_range."""
    if prices[t] >= ma200:
        return False
    start = max(0, t - window + 1)
    slice_ = prices[start : t + 1]
    if len(slice_) < 5:
        return False
    rng = (slice_.max() - slice_.min()) / slice_.min()
    return rng < max_range


def _compute_metrics(
    equity:   np.ndarray,
    dd_nav:   np.ndarray,
    cash_arr: np.ndarray,
    dates:    np.ndarray,
) -> dict:
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
        'final_equity':    float(equity[-1]),
        'cagr':            cagr,
        'max_drawdown':    max_dd,
        'sharpe':          sharpe,
        'recovery_days':   recovery_days,
        'cash_utilisation': cash_util,
    }
