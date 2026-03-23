"""
vr_backtest/strategies/vr_strategy_v2.py
==========================================
Strategy C v2: VR Speed-Trigger Crash Strategy.

Key differences from v1
------------------------
- Crash sensing via PRICE SPEED (velocity), not raw drawdown
- Progressive defense: small initial sell → additional sells at DD levels
- Sell sizes based on CURRENT INVESTED position, not total portfolio

Speed Sensors
-------------
  Sensor A : 4-day return <= -15%
  Sensor B : 3-day return <= -12%

Defense Sell Rule (on speed trigger)
--------------------------------------
  Variant 10% : sell 10% of current invested position
  Variant 20% : sell 20% of current invested position

Additional Crash Confirmation
------------------------------
  DD <= -25% : sell additional 20% of current invested
  DD <= -35% : sell additional 20% of current invested

Bottom Waiting Logic
--------------------
  After any defense sell:
    If price < MA200  ->  BOTTOM_WAIT (hold cash, no buying)
    If price recovers above sell_ref * 1.05  ->  redeploy and back to HOLD

Re-Entry Rule
--------------
  Price <= sell_ref_price   AND   bottom_zone confirmed
  5 equal tranches from crash_pool, min 5-day gap between entries
  consolidation = price range < 20% over 25 days

States
------
  HOLD        : normal; monitor speed trigger
  DEFENSIVE   : speed triggered; watching DD levels and MA200
  BOTTOM_WAIT : price < MA200; wait for consolidation
  REENTRY     : bottom zone confirmed; deploying tranches
  RECOVERY    : tranches deployed; rebuilding

Interface
---------
run_vr_v2(data, speed_sensor='A', initial_sell_pct=0.10, ...) -> dict
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


# ---- fixed parameters ----
SPEED_SENSORS = {
    'A': ('speed4', -0.15),   # 4-day return <= -15%
    'B': ('speed3', -0.12),   # 3-day return <= -12%
}

DD_SELL2_THRESHOLD    = -0.25   # sell additional 20% of current invested
DD_SELL3_THRESHOLD    = -0.35   # sell additional 20% of current invested
ADDITIONAL_SELL_PCT   = 0.20

CONSOLIDATION_WINDOW    = 25
CONSOLIDATION_MAX_RANGE = 0.20   # (max-min)/min over 25 days
MAX_REENTRY_ENTRIES     = 5
MIN_ENTRY_GAP_DAYS      = 5

RECOVERY_EXIT_DD        = -0.15  # return to HOLD once dd > this
REDEPLOY_RECOVERY_MULT  = 1.05   # redeploy when price > sell_ref * this


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_vr_v2(
    data:             pd.DataFrame,
    speed_sensor:     str   = 'A',      # 'A' or 'B'
    initial_sell_pct: float = 0.10,     # 0.10 or 0.20
    initial_cash:     float = 10_000.0,
    monthly_contrib:  float = 250.0,
) -> dict:
    """
    Run VR v2 Speed-Trigger strategy.

    Parameters
    ----------
    data             : DataFrame from loader.load_tqqq() (must have speed3/speed4)
    speed_sensor     : 'A' = 4-day/15%, 'B' = 3-day/12%
    initial_sell_pct : fraction of invested to sell on speed trigger
    initial_cash     : starting portfolio value
    monthly_contrib  : monthly DCA contribution

    Returns
    -------
    dict with equity, dates, drawdown_nav, cash, trade_log, metrics, name
    """
    speed_col, speed_thr = SPEED_SENSORS[speed_sensor]

    dates     = data['date'].values
    prices    = data['close'].values
    ma200     = data['ma200'].values
    drawdowns = data['drawdown'].values
    speeds    = data[speed_col].values
    T         = len(dates)

    equity    = np.zeros(T)
    cash_arr  = np.zeros(T)
    trade_log = []

    # portfolio
    shares     = initial_cash / prices[0]
    cash       = 0.0
    state      = _State.HOLD

    # defense episode variables
    sell_ref_price = 0.0
    crash_pool     = 0.0
    tranche_size   = 0.0
    entries_done   = 0
    last_entry_day = -999
    dd_25_done     = False
    dd_35_done     = False

    trade_log.append((dates[0], 'BUY_INIT', prices[0], shares, cash))
    equity[0]   = shares * prices[0]
    cash_arr[0] = cash
    prev_month  = pd.Timestamp(dates[0]).month

    for t in range(1, T):
        price = prices[t]
        dd    = drawdowns[t]
        ma    = ma200[t]
        speed = speeds[t]
        curr_month = pd.Timestamp(dates[t]).month

        # monthly contribution → always to cash
        if curr_month != prev_month:
            cash      += monthly_contrib
            prev_month = curr_month

        # ============================================================
        # HOLD  : monitor speed trigger
        # ============================================================
        if state == _State.HOLD:
            if speed <= speed_thr:
                # Initial sensing sell (% of current invested position)
                invested_value = shares * price
                sell_value     = invested_value * initial_sell_pct
                sell_shares    = sell_value / price
                shares        -= sell_shares
                cash          += sell_value
                sell_ref_price = price
                crash_pool     = sell_value
                dd_25_done     = False
                dd_35_done     = False
                state          = _State.DEFENSIVE
                trade_log.append((dates[t], 'SPEED_SELL', price, sell_shares, cash))

            # deploy DCA cash above MA200 in normal conditions
            elif cash > 0 and price > ma:
                new_shares = cash / price
                shares    += new_shares
                cash       = 0.0
                trade_log.append((dates[t], 'DCA', price, new_shares, 0.0))

        # ============================================================
        # DEFENSIVE : progressive DD sells → watch for MA200 cross
        # ============================================================
        elif state == _State.DEFENSIVE:
            # Additional sell at DD = -25%
            if not dd_25_done and dd <= DD_SELL2_THRESHOLD:
                invested_value = shares * price
                sell_value     = invested_value * ADDITIONAL_SELL_PCT
                sell_shares    = sell_value / price
                shares        -= sell_shares
                cash          += sell_value
                crash_pool    += sell_value
                dd_25_done     = True
                trade_log.append((dates[t], 'DD25_SELL', price, sell_shares, cash))

            # Additional sell at DD = -35%
            if not dd_35_done and dd <= DD_SELL3_THRESHOLD:
                invested_value = shares * price
                sell_value     = invested_value * ADDITIONAL_SELL_PCT
                sell_shares    = sell_value / price
                shares        -= sell_shares
                cash          += sell_value
                crash_pool    += sell_value
                dd_35_done     = True
                trade_log.append((dates[t], 'DD35_SELL', price, sell_shares, cash))

            # Transition: price < MA200 → wait for bottom
            if price < ma:
                state = _State.BOTTOM_WAIT

            # Transition: market recovered above sell_ref → redeploy and reset
            elif price >= sell_ref_price * REDEPLOY_RECOVERY_MULT:
                _redeploy(shares, cash, price, dates[t], trade_log)
                shares_gain  = cash / price
                shares      += shares_gain
                cash         = 0.0
                state        = _State.HOLD
                sell_ref_price = 0.0
                crash_pool    = 0.0

        # ============================================================
        # BOTTOM_WAIT : price < MA200; watch for bottom zone
        # ============================================================
        elif state == _State.BOTTOM_WAIT:
            in_zone  = _is_bottom_zone(prices, t, ma, CONSOLIDATION_WINDOW, CONSOLIDATION_MAX_RANGE)
            price_ok = price <= sell_ref_price

            if in_zone and price_ok:
                # Bottom zone confirmed → start re-entry
                tranche_size   = crash_pool / MAX_REENTRY_ENTRIES
                entries_done   = 0
                last_entry_day = -999
                state          = _State.REENTRY

            # Market recovered above MA200 without reaching bottom zone
            elif price > ma * 1.02:
                if cash > 0:
                    _redeploy(shares, cash, price, dates[t], trade_log)
                    shares += cash / price
                    cash    = 0.0
                state          = _State.HOLD
                sell_ref_price = 0.0
                crash_pool     = 0.0

        # ============================================================
        # REENTRY : deploy tranches
        # ============================================================
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
                    trade_log.append((dates[t], f'REENTRY_{entries_done}', price, new_shares, cash))

            if entries_done >= MAX_REENTRY_ENTRIES:
                state = _State.RECOVERY
            elif price > ma and price > sell_ref_price:
                # Lost bottom zone while price rose above sell ref
                state = _State.RECOVERY

        # ============================================================
        # RECOVERY : mop up remaining cash; wait to return to HOLD
        # ============================================================
        elif state == _State.RECOVERY:
            if cash > 1.0 and price > ma:
                new_shares = cash / price
                shares    += new_shares
                cash       = 0.0
                trade_log.append((dates[t], 'RECOVERY_DEPLOY', price, new_shares, 0.0))

            if dd > RECOVERY_EXIT_DD and cash == 0.0:
                state          = _State.HOLD
                sell_ref_price = 0.0
                crash_pool     = 0.0

        equity[t]   = shares * price + cash
        cash_arr[t] = cash

    rolling_peak = np.maximum.accumulate(equity)
    drawdown_nav = (equity / rolling_peak) - 1.0

    name = (f'VR_v2_speed{"A" if speed_col == "speed4" else "B"}'
            f'_sell{int(initial_sell_pct * 100)}')
    label = (f'VR v2 Speed{"A (4d/-15%)" if speed_col == "speed4" else "B (3d/-12%)"}'
             f' sell{int(initial_sell_pct * 100)}%')

    metrics = _compute_metrics(equity, drawdown_nav, cash_arr, dates)
    return {
        'name':         name,
        'label':        label,
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
    prices:    np.ndarray,
    t:         int,
    ma200:     float,
    window:    int,
    max_range: float,
) -> bool:
    if prices[t] >= ma200:
        return False
    start  = max(0, t - window + 1)
    slice_ = prices[start : t + 1]
    if len(slice_) < 5:
        return False
    rng = (slice_.max() - slice_.min()) / slice_.min()
    return rng < max_range


def _redeploy(shares, cash, price, date, trade_log):
    """Log a cash redeployment trade."""
    if cash > 1.0:
        new_shares = cash / price
        trade_log.append((date, 'REDEPLOY', price, new_shares, 0.0))


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
        'final_equity':     float(equity[-1]),
        'cagr':             cagr,
        'max_drawdown':     max_dd,
        'sharpe':           sharpe,
        'recovery_days':    recovery_days,
        'cash_utilisation': cash_util,
    }
