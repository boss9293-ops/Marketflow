from __future__ import annotations

from typing import Any


def _fmt_pct(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):+.2f}%"
    return "--"


def _fmt_plain(value: Any, digits: int = 2) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):.{digits}f}"
    return "--"


def _fmt_signed_pct(value: Any, digits: int = 1) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):+.{digits}f}%"
    return ""


def _fmt_signed_bp(value: Any, digits: int = 0) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):+.{digits}f}bp"
    return ""


def _status_from_oil(value: Any, change_pct: Any) -> str:
    oil_value = float(value) if isinstance(value, (int, float)) else None
    oil_chg = float(change_pct) if isinstance(change_pct, (int, float)) else None
    if oil_chg is not None and oil_chg >= 2.0:
        return "supply_shock"
    if oil_value is not None and oil_value >= 100.0:
        return "inflationary_pressure"
    return "normal"


def _status_from_rates(value: Any, change_bp: Any) -> str:
    rate_value = float(value) if isinstance(value, (int, float)) else None
    rate_bp = float(change_bp) if isinstance(change_bp, (int, float)) else None
    if rate_bp is not None and rate_bp >= 5.0:
        return "tightening_signal"
    if rate_value is not None and rate_value >= 4.3:
        return "rate_pressure"
    return "normal"


def _oil_interpretation(value: Any, status: str, change_pct: Any, label: str) -> str:
    if isinstance(value, (int, float)):
        change_text = _fmt_signed_pct(change_pct, 1)
        price_text = f"{label} ${_fmt_plain(value, 2)}"
        if change_text:
            price_text = f"{price_text} ({change_text})"
        if status in {"supply_shock", "inflationary_pressure"}:
            return f"{price_text} — 인플레이션 상방 압력 확대"
        return f"{price_text} — 원자재 가격 안정 구간"
    return "WTI 데이터 미확인 — 원자재 변수 점검 필요"


def _rates_interpretation(value: Any, status: str, change_bp: Any, label: str) -> str:
    if isinstance(value, (int, float)):
        change_text = _fmt_signed_bp(change_bp, 0)
        rate_text = f"10년물 {_fmt_plain(value, 2)}%" if label == "US10Y" else f"{label} {_fmt_plain(value, 2)}%"
        if change_text:
            rate_text = f"{rate_text} ({change_text})"
        if status in {"tightening_signal", "rate_pressure"}:
            return f"{rate_text} — 할인율 상승 압력"
        return f"{rate_text} — 금리 안정 구간"
    return "10년물 데이터 미확인 — 금리 해석 보류"


def build_macro_factors(market_data: dict[str, Any]) -> dict[str, Any]:
    oil_value = market_data.get("oil")
    oil_change_pct = market_data.get("oil_change_pct")
    oil_label = str(market_data.get("oil_label") or "WTI").strip() or "WTI"
    rates_value = market_data.get("yield10y")
    rates_change_bp = market_data.get("yield10y_change_bp")
    rates_label = str(market_data.get("yield10y_label") or "US10Y").strip() or "US10Y"

    oil_status = _status_from_oil(oil_value, oil_change_pct)
    rates_status = _status_from_rates(rates_value, rates_change_bp)

    return {
        "oil": {
            "value": float(oil_value) if isinstance(oil_value, (int, float)) else None,
            "unit": "USD",
            "label": oil_label,
            "change_pct": float(oil_change_pct) if isinstance(oil_change_pct, (int, float)) else None,
            "change_bp": None,
            "status": oil_status,
            "interpretation": _oil_interpretation(oil_value, oil_status, oil_change_pct, oil_label),
        },
        "rates": {
            "value": float(rates_value) if isinstance(rates_value, (int, float)) else None,
            "unit": "%",
            "label": rates_label,
            "change_pct": None,
            "change_bp": float(rates_change_bp) if isinstance(rates_change_bp, (int, float)) else None,
            "status": rates_status,
            "interpretation": _rates_interpretation(rates_value, rates_status, rates_change_bp, rates_label),
        },
    }


def macro_factor_lines(macro_factors: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if not isinstance(macro_factors, dict):
        return lines
    for key in ["oil", "rates"]:
        factor = macro_factors.get(key)
        if not isinstance(factor, dict):
            continue
        interpretation = str(factor.get("interpretation") or "").strip()
        if interpretation:
            lines.append(interpretation)
    return lines


def inject_numeric_context(fact: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
    _ = fact
    sp500 = market_data.get("sp500")
    nasdaq = market_data.get("nasdaq")
    dow = market_data.get("dow")
    vix = market_data.get("vix")
    macro_factors = build_macro_factors(market_data)

    return {
        "indices": [
            f"S&P 500 {_fmt_pct(sp500)}",
            f"Nasdaq {_fmt_pct(nasdaq)}",
            f"Dow {_fmt_pct(dow)}",
            f"VIX {_fmt_pct(vix)}",
        ],
        "macro_factors": macro_factors,
    }
