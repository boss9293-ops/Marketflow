"""
SRS (Standard Risk System) I/O schema.
Dataclass-based (no external dep) — mirrors Pydantic spec.
"""
from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class SRSInput:
    date:             str
    risk_level:       str        # Normal / Caution / Warning / High Risk / Crisis
    regime:           str        # e.g. Liquidity Stress / Credit Stress
    score:            float

    track_A:          str        # SRS track A state
    track_B:          str        # SRS track B state
    track_C:          str        # SRS track C state

    dominant_signal:  str        # strongest indicator signal

    indicators:       Dict[str, float]   # {"VIX": 26, "HY_OAS": 4.2, ...}
    key_flags:        List[str]          # ["Credit Stress Rising", ...]

    @classmethod
    def from_dict(cls, d: dict) -> "SRSInput":
        return cls(
            date=d["date"],
            risk_level=d["risk_level"],
            regime=d["regime"],
            score=float(d["score"]),
            track_A=d["track_A"],
            track_B=d["track_B"],
            track_C=d["track_C"],
            dominant_signal=d["dominant_signal"],
            indicators=dict(d.get("indicators", {})),
            key_flags=list(d.get("key_flags", [])),
        )


@dataclass
class SRSScenario:
    name: str
    prob: float      # 0.0 ~ 1.0
    description: str = ""


@dataclass
class SRSOutput:
    regime_summary:   str
    risk_assessment:  str
    key_drivers:      List[str]
    similar_cases:    List[str]
    scenarios:        List[SRSScenario]
    recommendation:   str
    evidence:         List[str]
    contradictions:   List[str]

    def to_dict(self) -> dict:
        return {
            "regime_summary":  self.regime_summary,
            "risk_assessment": self.risk_assessment,
            "key_drivers":     self.key_drivers,
            "similar_cases":   self.similar_cases,
            "scenarios":       [
                {"name": s.name, "prob": s.prob, "description": s.description}
                for s in self.scenarios
            ],
            "recommendation":  self.recommendation,
            "evidence":        self.evidence,
            "contradictions":  self.contradictions,
        }
