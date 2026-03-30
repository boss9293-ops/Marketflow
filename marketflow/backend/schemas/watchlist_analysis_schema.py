"""
Watchlist analysis input schema.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

from services.valuation_rules import dedupe_tickers, normalize_mode


@dataclass
class WatchlistAnalysisInput:
    tickers: List[str]
    mode: str = "auto"
    watchlist_name: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "WatchlistAnalysisInput":
        if not isinstance(data, dict):
            raise TypeError("request body must be a JSON object")

        raw_tickers: List[Any] = []
        if isinstance(data.get("tickers"), list):
            raw_tickers = list(data["tickers"])
        elif isinstance(data.get("symbols"), list):
            raw_tickers = list(data["symbols"])
        elif isinstance(data.get("items"), list):
            for item in data["items"]:
                if isinstance(item, dict):
                    raw_tickers.append(item.get("ticker") or item.get("symbol"))
                else:
                    raw_tickers.append(item)

        tickers = dedupe_tickers(raw_tickers)
        if not tickers:
            raise KeyError("tickers")

        mode = normalize_mode(data.get("mode"))
        watchlist_name = str(data.get("watchlist_name") or data.get("label") or "").strip() or None

        return cls(tickers=tickers, mode=mode, watchlist_name=watchlist_name)

