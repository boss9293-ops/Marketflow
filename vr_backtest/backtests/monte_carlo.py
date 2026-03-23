"""
vr_backtest/backtests/monte_carlo.py
======================================
Monte Carlo robustness testing for the VR Crash Strategy.

STATUS: HOLD -- not executed in this phase.

Monte Carlo testing will resume after scenario validation confirms
that the VR strategy structure is sound.

When to activate
----------------
After scenario_backtest.py confirms:
  - VR drawdown < Buy & Hold drawdown in all 3 crash periods
  - VR Sharpe ratio comparable to 200MA
  - VR recovery time <= Buy & Hold recovery time

How to activate
---------------
from engine.monte_carlo.runner import run_monte_carlo
result = run_monte_carlo(n_paths=1000, years=5)

See: engine/monte_carlo/runner.py
"""

raise NotImplementedError(
    "Monte Carlo is ON HOLD pending scenario validation.\n"
    "Run scenario_backtest.py first.\n"
    "See engine/monte_carlo/runner.py for the MC engine."
)
