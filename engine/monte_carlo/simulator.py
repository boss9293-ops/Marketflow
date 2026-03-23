
from __future__ import annotations
import numpy as np
from .state_machine import State, StateMachine
from .strategy_config import CrashConfig, BottomConfig, LadderConfig, PoolConfig
from .metrics import PathMetrics


def run_single_path(
    price_path:      np.ndarray,
    volume_path:     np.ndarray,
    drawdown_series: np.ndarray,
    speed4_series:   np.ndarray,
    avgvol20_series: np.ndarray,
    crash_cfg:  CrashConfig  | None = None,
    bottom_cfg: BottomConfig | None = None,
    ladder_cfg: LadderConfig | None = None,
    pool_cfg:   PoolConfig   | None = None,
    initial_nav:        float = 1.0,
    initial_pool_ratio: float = 0.10,
) -> PathMetrics:
    crash_cfg  = crash_cfg  or CrashConfig()
    bottom_cfg = bottom_cfg or BottomConfig()
    ladder_cfg = ladder_cfg or LadderConfig()
    pool_cfg   = pool_cfg   or PoolConfig()
    T = len(price_path)
    sm = StateMachine(
        crash_speed_thr = crash_cfg.speed4_threshold,
        crash_dd_thr    = crash_cfg.dd_threshold,
        bottom_dd_thr   = bottom_cfg.dd_threshold,
        volume_mult     = bottom_cfg.volume_multiplier,
        reserve_ratio   = pool_cfg.reserve_ratio,
    )
    pool_init       = initial_nav * initial_pool_ratio
    position_shares = (initial_nav - pool_init) / price_path[0]
    avg_cost        = price_path[0]
    cash_pool       = pool_init
    reserve_pool    = 0.0
    crash_onset_pool = 0.0
    pool_used_crash  = 0.0
    ladder_filled    = [False] * len(ladder_cfg.levels)
    nav_series   = np.zeros(T)
    state_series = np.zeros(T, dtype=int)
    peak_nav     = initial_nav
    max_dd_nav   = 0.0
    crash_events = 0
    steps_done   = 0
    pool_gone    = False

    for t in range(T):
        price = price_path[t]
        # 1. Update drawdown -- read pre-computed series
        dd  = float(drawdown_series[t]) if t >= 4  else 0.0
        s4  = float(speed4_series[t])   if t >= 4  else 0.0
        av  = float(avgvol20_series[t]) if t >= 20 else 1.0
        vol = float(volume_path[t])
        nav = position_shares * price + cash_pool + reserve_pool

        # 4. Execute ladder buys (BOTTOM_ZONE)
        ladder_today = False
        if sm.state == State.BOTTOM_ZONE:
            for i, level in enumerate(ladder_cfg.levels):
                if ladder_filled[i]:
                    continue
                if dd <= level:
                    max_d = crash_onset_pool * pool_cfg.crash_pool_cap - pool_used_crash
                    if max_d <= 0:
                        break
                    alloc = crash_onset_pool * pool_cfg.crash_pool_cap * ladder_cfg.weights[i]
                    spend = min(alloc, max_d, cash_pool)
                    if spend > 0:
                        sh = spend / price
                        avg_cost = (avg_cost * position_shares + spend) / (position_shares + sh)
                        position_shares += sh
                        cash_pool -= spend
                        pool_used_crash += spend
                        ladder_filled[i] = True
                        ladder_today = True
                        steps_done += 1

        # 5. Update pool via harvest (normal modes)
        elif sm.state in (State.NORMAL, State.RECOVERY, State.REBUILD):
            hv = position_shares * price * pool_cfg.harvest_rate
            hs = min(hv / price, position_shares)
            position_shares -= hs
            cash_pool += hs * price

        # 3. Update state machine
        prev = sm.state
        pool_r = (cash_pool + reserve_pool) / nav if nav > 0 else 0.0
        sm.step(speed4=s4, dd=dd, volume=vol, avgvol20=av,
                ladder_executed_today=ladder_today, pool_ratio=pool_r)

        # handle crash onset -- lock survival reserve
        if sm.state == State.CRASH_ALERT and prev != State.CRASH_ALERT:
            crash_events += 1
            tp = cash_pool + reserve_pool
            crash_onset_pool = tp
            locked = tp * (1.0 - pool_cfg.crash_pool_cap)
            reserve_pool = locked
            cash_pool    = tp - locked
            pool_used_crash = 0.0
            ladder_filled = [False] * len(ladder_cfg.levels)

        # 6. Record metrics
        nav = position_shares * price + cash_pool + reserve_pool
        if nav <= 0 or (cash_pool + reserve_pool) <= 0:
            pool_gone = True
        peak_nav = max(peak_nav, nav)
        dd_nav = (nav / peak_nav) - 1.0 if peak_nav > 0 else 0.0
        max_dd_nav = min(max_dd_nav, dd_nav)
        nav_series[t]   = nav / initial_nav
        state_series[t] = list(State).index(sm.state)
        if pool_gone:
            nav_series[t:]   = nav / initial_nav
            state_series[t:] = state_series[t]
            break

    tnav = float(nav_series[-1])
    return PathMetrics(
        survival_flag         = (not pool_gone) and (tnav > 0),
        pool_exhausted_flag   = pool_gone,
        max_drawdown          = max_dd_nav,
        recovery_days         = _calc_recovery_days(nav_series),
        crash_events          = crash_events,
        ladder_steps_executed = steps_done,
        terminal_nav          = tnav,
        nav_series            = nav_series,
        state_series          = state_series,
    )


def _calc_recovery_days(nav_series: np.ndarray) -> int:
    if len(nav_series) == 0:
        return -1
    running_peak = nav_series[0]
    peak_before  = nav_series[0]
    trough_idx   = 0
    worst_dd     = 0.0
    for i, v in enumerate(nav_series):
        if v > running_peak:
            running_peak = v
        dd = (v / running_peak) - 1.0 if running_peak > 0 else 0.0
        if dd < worst_dd:
            worst_dd    = dd
            trough_idx  = i
            peak_before = running_peak
    for i in range(trough_idx, len(nav_series)):
        if nav_series[i] >= peak_before:
            return i - trough_idx
    return -1


# ---------------------------------------------------------------------------
# Monte Carlo runner
# ---------------------------------------------------------------------------

def run_monte_carlo(
    paths,
    crash_cfg=None,
    bottom_cfg=None,
    ladder_cfg=None,
    pool_cfg=None,
    initial_nav: float = 1.0,
    initial_pool_ratio: float = 0.10,
) -> dict:
    import numpy as np

    if not paths:
        raise ValueError("paths is empty")

    results = [
        run_single_path(
            price_path         = p[0],
            volume_path        = p[1],
            drawdown_series    = p[2],
            speed4_series      = p[3],
            avgvol20_series    = p[4],
            crash_cfg          = crash_cfg,
            bottom_cfg         = bottom_cfg,
            ladder_cfg         = ladder_cfg,
            pool_cfg           = pool_cfg,
            initial_nav        = initial_nav,
            initial_pool_ratio = initial_pool_ratio,
        )
        for p in paths
    ]

    n = len(results)

    terminal_navs = np.array([r.terminal_nav         for r in results])
    max_dds       = np.array([r.max_drawdown          for r in results])
    rec_times     = np.array([r.recovery_days         for r in results])
    crash_counts  = np.array([r.crash_events          for r in results])
    ladder_counts = np.array([r.ladder_steps_executed for r in results])

    survival_probability        = sum(r.survival_flag       for r in results) / n
    pool_exhaustion_probability = sum(r.pool_exhausted_flag for r in results) / n
    bottom_capture_rate         = sum(r.ladder_steps_executed > 0 for r in results) / n

    rec_valid = rec_times[rec_times >= 0]
    reentry_success_rate = (
        float(np.mean(terminal_navs[ladder_counts > 0] >= 1.0))
        if bottom_capture_rate > 0 else float("nan")
    )

    return {
        "n_runs":                      n,
        "survival_probability":        survival_probability,
        "pool_exhaustion_probability": pool_exhaustion_probability,
        "bottom_capture_rate":         bottom_capture_rate,
        "reentry_success_rate":        reentry_success_rate,

        "terminal_nav_mean":   float(np.mean(terminal_navs)),
        "terminal_nav_median": float(np.median(terminal_navs)),
        "terminal_nav_p10":    float(np.percentile(terminal_navs, 10)),
        "terminal_nav_p25":    float(np.percentile(terminal_navs, 25)),
        "terminal_nav_p75":    float(np.percentile(terminal_navs, 75)),
        "terminal_nav_p90":    float(np.percentile(terminal_navs, 90)),

        "max_dd_mean":   float(np.mean(max_dds)),
        "max_dd_median": float(np.median(max_dds)),
        "max_dd_p10":    float(np.percentile(max_dds, 10)),
        "max_dd_p90":    float(np.percentile(max_dds, 90)),

        "recovery_time_median": (
            float(np.median(rec_valid)) if len(rec_valid) else float("nan")
        ),
        "recovery_time_p90": (
            float(np.percentile(rec_valid, 90)) if len(rec_valid) else float("nan")
        ),

        "avg_crash_events_per_run":   float(np.mean(crash_counts)),
        "avg_ladder_steps_per_run":   float(np.mean(ladder_counts)),

        "terminal_nav_distribution":  terminal_navs,
        "drawdown_distribution":      max_dds,
        "recovery_time_distribution": rec_times,

        "runs": results,
    }
