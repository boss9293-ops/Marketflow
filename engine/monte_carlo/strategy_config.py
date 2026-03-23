"""
Strategy configuration dataclasses.
Based on: docs/MONTE_CARLO_SIMULATION_CONTRACT.md
"""
from dataclasses import dataclass, field


@dataclass
class CrashConfig:
    """Thresholds for crash detection (NORMAL -> CRASH_ALERT transition)."""
    speed4_threshold: float = -0.10   # 4-day cumulative return must be <= this
    dd_threshold:     float = -0.15   # drawdown from peak must be <= this


@dataclass
class BottomConfig:
    """Thresholds for bottom zone detection (CRASH_HOLD -> BOTTOM_ZONE transition)."""
    dd_threshold:      float = -0.20   # drawdown must be <= this
    volume_multiplier: float =  2.0    # volume must be >= this x 20-day avg volume


@dataclass
class LadderConfig:
    """Price-based ladder buy structure deployed in BOTTOM_ZONE."""
    levels:  list[float] = field(
        default_factory=lambda: [-0.20, -0.25, -0.30, -0.35, -0.40]
    )
    weights: list[float] = field(
        default_factory=lambda: [0.20, 0.20, 0.20, 0.20, 0.20]
    )
    # weights sum to 1.0 and are applied against crash_pool_cap allocation


@dataclass
class PoolConfig:
    """Pool reserve and sizing rules."""
    crash_pool_cap: float = 0.50   # max fraction of pool deployable in one crash event
    reserve_ratio:  float = 0.10   # target pool/NAV ratio (gate for REBUILD -> NORMAL)
    harvest_rate:   float = 0.001  # fraction of position value harvested per day (normal modes)
