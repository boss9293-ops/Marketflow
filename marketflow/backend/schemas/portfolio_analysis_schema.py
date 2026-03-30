"""
Portfolio analysis input schema.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

from services.valuation_rules import normalize_mode, normalize_ticker, safe_float


@dataclass
class PortfolioPositionInput:
    ticker: str
    shares: float
    label: Optional[str] = None


@dataclass
class PortfolioAnalysisInput:
    positions: List[PortfolioPositionInput]
    mode: str = "auto"
    portfolio_name: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "PortfolioAnalysisInput":
        if not isinstance(data, dict):
            raise TypeError("request body must be a JSON object")

        raw_positions: Any = data.get("positions")
        if raw_positions is None:
            raw_positions = data.get("holdings")
        if raw_positions is None:
            raw_positions = data.get("items")
        if not isinstance(raw_positions, list):
            raise KeyError("positions")

        positions: List[PortfolioPositionInput] = []
        for item in raw_positions:
            if not isinstance(item, dict):
                continue
            ticker = normalize_ticker(item.get("ticker") or item.get("symbol"))
            shares = safe_float(item.get("shares") or item.get("quantity") or item.get("qty"))
            if not ticker or shares is None or shares <= 0:
                continue
            label = str(item.get("label") or item.get("name") or "").strip() or None
            positions.append(PortfolioPositionInput(ticker=ticker, shares=float(shares), label=label))

        if not positions:
            raise KeyError("positions")

        mode = normalize_mode(data.get("mode"))
        portfolio_name = str(data.get("portfolio_name") or data.get("label") or "").strip() or None

        return cls(positions=positions, mode=mode, portfolio_name=portfolio_name)

