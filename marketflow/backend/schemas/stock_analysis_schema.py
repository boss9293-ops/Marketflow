"""
Stock analysis input/output schema.
Dataclass-based to keep the backend lightweight and dependency free.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


def _normalize_ticker(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if ":" in raw:
        raw = raw.split(":")[-1]
    return raw


@dataclass
class StockAnalysisInput:
    ticker: str
    mode: str = "auto"

    @classmethod
    def from_dict(cls, data: dict) -> "StockAnalysisInput":
        if not isinstance(data, dict):
            raise TypeError("request body must be a JSON object")

        ticker = _normalize_ticker(data.get("ticker"))
        if not ticker:
            raise KeyError("ticker")

        mode = str(data.get("mode", "auto")).strip().lower() or "auto"
        if mode not in {"auto", "conservative", "aggressive"}:
            mode = "auto"

        return cls(ticker=ticker, mode=mode)


@dataclass
class StockScenarioCase:
    target_price: Optional[float]
    growth: Optional[float] = None
    multiple: Optional[float] = None
    eps: Optional[float] = None
    upside: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "target_price": self.target_price,
            "growth": self.growth,
            "multiple": self.multiple,
            "eps": self.eps,
            "upside": self.upside,
        }


@dataclass
class StockValuationState:
    label: str
    detail: str
    reference: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "detail": self.detail,
            "reference": self.reference,
        }


@dataclass
class StockNarrative:
    headline: str
    summary: str
    bull_case: str
    bear_case: str
    risk_note: str
    confidence_note: str
    consensus_note: str = ""

    def to_dict(self) -> dict:
        return {
            "headline": self.headline,
            "summary": self.summary,
            "bull_case": self.bull_case,
            "bear_case": self.bear_case,
            "risk_note": self.risk_note,
            "confidence_note": self.confidence_note,
            "consensus_note": self.consensus_note,
        }


@dataclass
class StockAnalysisOutput:
    ticker: str
    current_price: Optional[float]
    current_change_pct: Optional[float]
    name: str
    sector: str
    industry: str
    exchange: str
    current_pe: Optional[float]
    historical_pe: Dict[str, Optional[float]]
    sector_pe: Optional[float]
    growth: Dict[str, Any]
    multiple: Dict[str, Any]
    scenario: Dict[str, float]
    confidence: str
    today_summary: str
    summary: str
    price_history: List[Dict[str, Any]] = field(default_factory=list)
    valuation_state: Dict[str, Any] = field(default_factory=dict)
    narrative: Dict[str, Any] = field(default_factory=dict)
    consensus: Dict[str, Any] = field(default_factory=dict)
    analysis_mode: str = "auto"
    valuation: Dict[str, Any] = field(default_factory=dict)
    stats: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "current_price": self.current_price,
            "current_change_pct": self.current_change_pct,
            "name": self.name,
            "sector": self.sector,
            "industry": self.industry,
            "exchange": self.exchange,
            "current_pe": self.current_pe,
            "historical_pe": self.historical_pe,
            "sector_pe": self.sector_pe,
            "growth": self.growth,
            "multiple": self.multiple,
            "scenario": self.scenario,
            "confidence": self.confidence,
            "today_summary": self.today_summary,
            "summary": self.summary,
            "price_history": self.price_history,
            "valuation_state": self.valuation_state,
            "narrative": self.narrative,
            "consensus": self.consensus,
            "analysis_mode": self.analysis_mode,
            "valuation": self.valuation,
            "stats": self.stats,
            "warnings": self.warnings,
            "meta": self.meta,
        }
