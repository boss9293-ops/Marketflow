"""
VR Strategy State Machine — minimal skeleton.
Based on: docs/VR_STRATEGY_STATE_MACHINE_V1.md
"""
from enum import Enum, auto


class State(Enum):
    NORMAL      = auto()   # S0: full VR logic active
    CRASH_ALERT = auto()   # S1: crash detected, Vmin disabled
    CRASH_HOLD  = auto()   # S2: confirmed crash, awaiting bottom
    BOTTOM_ZONE = auto()   # S3: capitulation zone, ladder buys enabled
    RECOVERY    = auto()   # S4: market stabilising
    REBUILD     = auto()   # S5: pool rebuilding, restoring normal logic


class StateMachine:
    """
    Minimal deterministic state machine.
    Call step() once per time index with current market indicators.
    """

    def __init__(
        self,
        crash_speed_thr: float = -0.10,
        crash_dd_thr:    float = -0.15,
        bottom_dd_thr:   float = -0.20,
        volume_mult:     float = 2.0,
        stabilize_days:  int   = 3,
        rebuild_days:    int   = 10,
        reserve_ratio:   float = 0.10,
    ) -> None:
        self.crash_speed_thr = crash_speed_thr
        self.crash_dd_thr    = crash_dd_thr
        self.bottom_dd_thr   = bottom_dd_thr
        self.volume_mult     = volume_mult
        self.stabilize_days  = stabilize_days
        self.rebuild_days    = rebuild_days
        self.reserve_ratio   = reserve_ratio

        self.state              = State.NORMAL
        self._ladder_executed   = False
        self._stabilize_counter = 0
        self._rebuild_counter   = 0

    # ------------------------------------------------------------------

    def step(
        self,
        speed4:    float,
        dd:        float,
        volume:    float,
        avgvol20:  float,
        ladder_executed_today: bool,
        pool_ratio: float,
    ) -> State:
        """Advance one time step. Returns the new state."""
        crash_flag  = (speed4 <= self.crash_speed_thr) and (dd <= self.crash_dd_thr)
        bottom_flag = (
            self.state in (State.CRASH_HOLD, State.BOTTOM_ZONE)
            and dd <= self.bottom_dd_thr
            and avgvol20 > 0
            and volume >= self.volume_mult * avgvol20
        )

        if ladder_executed_today:
            self._ladder_executed = True

        self._transition(crash_flag, bottom_flag, pool_ratio, speed4)
        return self.state

    def reset(self) -> None:
        self.state              = State.NORMAL
        self._ladder_executed   = False
        self._stabilize_counter = 0
        self._rebuild_counter   = 0

    # ------------------------------------------------------------------

    def _transition(
        self,
        crash_flag:  bool,
        bottom_flag: bool,
        pool_ratio:  float,
        speed4:      float,
    ) -> None:
        s = self.state

        if s == State.NORMAL:
            if crash_flag:
                self._on_crash_start()

        elif s == State.CRASH_ALERT:
            if crash_flag:
                self.state = State.CRASH_HOLD
            else:
                self.state            = State.NORMAL   # false alarm
                self._ladder_executed = False

        elif s == State.CRASH_HOLD:
            if bottom_flag:
                self.state = State.BOTTOM_ZONE

        elif s == State.BOTTOM_ZONE:
            if self._ladder_executed:
                if speed4 > 0:
                    self._stabilize_counter += 1
                else:
                    self._stabilize_counter  = 0
                if self._stabilize_counter >= self.stabilize_days:
                    self.state              = State.RECOVERY
                    self._stabilize_counter = 0

        elif s == State.RECOVERY:
            if crash_flag:
                self.state              = State.CRASH_HOLD
                self._ladder_executed   = False
                self._stabilize_counter = 0
            else:
                self.state            = State.REBUILD
                self._rebuild_counter = 0

        elif s == State.REBUILD:
            if crash_flag:
                self._on_crash_start()
            else:
                self._rebuild_counter += 1
                if self._rebuild_counter >= self.rebuild_days and pool_ratio >= self.reserve_ratio:
                    self.state            = State.NORMAL
                    self._rebuild_counter = 0

    def _on_crash_start(self) -> None:
        self.state              = State.CRASH_ALERT
        self._ladder_executed   = False
        self._stabilize_counter = 0
        self._rebuild_counter   = 0
