from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SeriesDef:
    symbol: str
    source: str
    unit: str
    freq: str
    notes: str = ""


SERIES_REGISTRY: dict[str, SeriesDef] = {
    "QQQ": SeriesDef("QQQ", "YAHOO", "usd", "15m/D", "close"),
    "TQQQ": SeriesDef("TQQQ", "YAHOO", "usd", "15m/D", "close"),
    "SPY": SeriesDef("SPY", "YAHOO", "usd", "15m/D", "close"),
    "VIX": SeriesDef("VIX", "YAHOO/CBOE", "index", "15m/D", "close"),
    "HY_OAS": SeriesDef("HY_OAS", "FRED", "bp", "D", "BAMLH0A0HYM2"),
    "IG_OAS": SeriesDef("IG_OAS", "FRED", "bp", "D", "BAMLC0A0CM"),
    "FSI": SeriesDef("FSI", "FRED", "index", "W", "STLFSI4"),
    "PUT_CALL": SeriesDef("PUT_CALL", "CBOE", "ratio", "D", "total P/C"),
    "WALCL": SeriesDef("WALCL", "FRED", "usd", "W", "Fed balance sheet"),
    "M2": SeriesDef("M2", "FRED", "usd", "W/M", "M2SL"),
    "DXY": SeriesDef("DXY", "YAHOO/FRED", "index", "D", "Dollar index"),
    "EFFR": SeriesDef("EFFR", "FRED", "%", "D", "Effective Fed Funds Rate"),
    "US2Y": SeriesDef("US2Y", "FRED", "%", "D", "2Y yield (DGS2)"),
    "US10Y": SeriesDef("US10Y", "FRED", "%", "D", "10Y yield (DGS10)"),
    "DFII10": SeriesDef("DFII10", "FRED", "%", "D", "10Y TIPS real yield"),
    "CPI": SeriesDef("CPI", "FRED", "index", "M", "CPIAUCSL"),
    "RRP": SeriesDef("RRP", "FRED", "usd", "D", "RRPONTSYD"),
    "BTC": SeriesDef("BTC", "YAHOO", "usd", "D", "BTC-USD close"),
    "GLD": SeriesDef("GLD", "YAHOO", "usd", "D", "GLD close"),
    "HYG": SeriesDef("HYG", "YAHOO", "usd", "D", "credit proxy"),
    "LQD": SeriesDef("LQD", "YAHOO", "usd", "D", "credit proxy"),
}
