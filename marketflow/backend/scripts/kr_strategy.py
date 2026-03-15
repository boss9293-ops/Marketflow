"""
KR strategy module.
Separates:
1) signal generation
2) performance calculation
"""
from __future__ import annotations

import os
from typing import Dict, List, Tuple

import yfinance as yf
from dotenv import load_dotenv


load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def safe_history(symbol: str, period: str = "1y"):
    try:
        return yf.Ticker(symbol).history(period=period)
    except Exception:
        return None


def safe_pct(curr: float, prev: float):
    if prev == 0:
        return 0.0
    return ((curr / prev) - 1) * 100


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return float(default)


def _safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return int(default)


def _market_from_symbol(symbol: str):
    return "KOSPI" if symbol.endswith(".KS") else "KOSDAQ"


def _score_to_rating(score: float):
    if score >= 82:
        return "BUY"
    if score >= 68:
        return "WATCH"
    return "HOLD"


def _build_fallback_provider_summary(provider: str, name: str, ticker: str, ret_1d: float, ret_5d: float, vcp_ratio: float):
    rating = "BUY" if ret_5d > 1.5 and ret_1d > -2 else ("WATCH" if ret_5d > -1 else "HOLD")
    confidence = max(45, min(92, int(60 + (ret_5d * 2.2) - abs(ret_1d))))
    provider_title = "GPT-4o-mini" if provider == "openai" else "Gemini 1.5 Flash"
    summary_en = (
        f"{provider_title}: {name}({ticker}) momentum {ret_5d:+.2f}% (5D), {ret_1d:+.2f}% (1D). "
        f"VCP ratio {vcp_ratio:.2f} with {rating.lower()} bias."
    )
    summary_ko = (
        f"{provider_title}: {name}({ticker}) 5일 수익률 {ret_5d:+.2f}%, 1일 수익률 {ret_1d:+.2f}%입니다. "
        f"VCP 비율 {vcp_ratio:.2f} 기준으로 {rating} 관점입니다."
    )
    return {
        "model": "gpt-4o-mini" if provider == "openai" else "gemini-1.5-flash",
        "rating": rating,
        "confidence": confidence,
        "summary": summary_ko,
        "summary_ko": summary_ko,
        "summary_en": summary_en,
        "source": "fallback",
    }


def _generate_openai_analysis(name: str, ticker: str, ret_1d: float, ret_5d: float, vcp_ratio: float):
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return _build_fallback_provider_summary("openai", name, ticker, ret_1d, ret_5d, vcp_ratio)

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        prompt = (
            f"KR stock quick signal.\n"
            f"Ticker: {ticker}, Name: {name}\n"
            f"Return 1D: {ret_1d:.2f}%, Return 5D: {ret_5d:.2f}%\n"
            f"VCP ratio: {vcp_ratio:.2f}\n"
            "Respond in exactly 4 lines:\n"
            "RATING: BUY/WATCH/HOLD\n"
            "CONFIDENCE: 0-100\n"
            "SUMMARY_KO: one Korean sentence under 30 words.\n"
            "SUMMARY_EN: one English sentence under 20 words."
        )
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a concise KR equity signal assistant."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=120,
        )
        text = (response.choices[0].message.content or "").strip()
        rating = "WATCH"
        confidence = 70
        summary_ko = ""
        summary_en = ""
        for raw in text.splitlines():
            line = raw.strip()
            if line.upper().startswith("RATING:"):
                v = line.split(":", 1)[1].strip().upper()
                if v in {"BUY", "WATCH", "HOLD"}:
                    rating = v
            elif line.upper().startswith("CONFIDENCE:"):
                n = "".join(ch for ch in line.split(":", 1)[1] if ch.isdigit())
                if n:
                    confidence = max(0, min(100, int(n)))
            elif line.upper().startswith("SUMMARY_KO:"):
                summary_ko = line.split(":", 1)[1].strip()
            elif line.upper().startswith("SUMMARY_EN:"):
                summary_en = line.split(":", 1)[1].strip()

        if not summary_ko:
            summary_ko = f"{name}({ticker}) 단기 흐름은 5일 {ret_5d:+.2f}%, 1일 {ret_1d:+.2f}%로 관찰됩니다."
        if not summary_en:
            summary_en = f"{name}({ticker}) short-term move is {ret_5d:+.2f}% (5D) and {ret_1d:+.2f}% (1D)."

        return {
            "model": "gpt-4o-mini",
            "rating": rating,
            "confidence": confidence,
            "summary": summary_ko,
            "summary_ko": summary_ko,
            "summary_en": summary_en,
            "source": "openai",
        }
    except Exception:
        return _build_fallback_provider_summary("openai", name, ticker, ret_1d, ret_5d, vcp_ratio)


def _generate_gemini_analysis(name: str, ticker: str, ret_1d: float, ret_5d: float, vcp_ratio: float):
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return _build_fallback_provider_summary("gemini", name, ticker, ret_1d, ret_5d, vcp_ratio)

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        prompt = (
            f"KR stock quick signal.\n"
            f"Ticker: {ticker}, Name: {name}\n"
            f"Return 1D: {ret_1d:.2f}%, Return 5D: {ret_5d:.2f}%\n"
            f"VCP ratio: {vcp_ratio:.2f}\n"
            "Respond in exactly 4 lines:\n"
            "RATING: BUY/WATCH/HOLD\n"
            "CONFIDENCE: 0-100\n"
            "SUMMARY_KO: one Korean sentence under 30 words.\n"
            "SUMMARY_EN: one English sentence under 20 words."
        )
        response = client.models.generate_content(
            model="gemini-1.5-flash",
            contents=prompt,
        )
        text = (response.text or "").strip()
        rating = "WATCH"
        confidence = 70
        summary_ko = ""
        summary_en = ""
        for raw in text.splitlines():
            line = raw.strip()
            if line.upper().startswith("RATING:"):
                v = line.split(":", 1)[1].strip().upper()
                if v in {"BUY", "WATCH", "HOLD"}:
                    rating = v
            elif line.upper().startswith("CONFIDENCE:"):
                n = "".join(ch for ch in line.split(":", 1)[1] if ch.isdigit())
                if n:
                    confidence = max(0, min(100, int(n)))
            elif line.upper().startswith("SUMMARY_KO:"):
                summary_ko = line.split(":", 1)[1].strip()
            elif line.upper().startswith("SUMMARY_EN:"):
                summary_en = line.split(":", 1)[1].strip()

        if not summary_ko:
            summary_ko = f"{name}({ticker})의 VCP 비율은 {vcp_ratio:.2f}, 최근 5일 {ret_5d:+.2f}% 흐름입니다."
        if not summary_en:
            summary_en = f"{name}({ticker}) VCP ratio is {vcp_ratio:.2f}, with {ret_5d:+.2f}% over 5 days."

        return {
            "model": "gemini-1.5-flash",
            "rating": rating,
            "confidence": confidence,
            "summary": summary_ko,
            "summary_ko": summary_ko,
            "summary_en": summary_en,
            "source": "gemini",
        }
    except Exception:
        return _build_fallback_provider_summary("gemini", name, ticker, ret_1d, ret_5d, vcp_ratio)


def generate_kr_signals_and_assets(
    sectors: List[Tuple[str, str, str]],
    today: str,
    generated_at: str,
):
    signals = []
    chart_payload = {}
    ai_summary_map = {}
    portfolio_date_values: Dict[str, List[float]] = {}

    for yahoo_symbol, ticker, name in sectors:
        hist = safe_history(yahoo_symbol, period="1y")
        if hist is None or hist.empty or len(hist) < 30:
            continue

        close = hist["Close"]
        high = hist["High"]
        low = hist["Low"]
        volume = hist["Volume"]

        current = _safe_float(close.iloc[-1])
        prev_1d = _safe_float(close.iloc[-2], current) if len(close) >= 2 else current
        prev_5d = _safe_float(close.iloc[-6], current) if len(close) >= 6 else current

        ret_1d = safe_pct(current, prev_1d)
        ret_5d = safe_pct(current, prev_5d)

        recent_vola = _safe_float((close.pct_change().tail(5).std() or 0) * 100)
        base_vola = _safe_float((close.pct_change().tail(20).std() or 0) * 100)
        if base_vola <= 0:
            vcp_ratio = 1.0
        else:
            vcp_ratio = max(0.15, min(1.2, recent_vola / base_vola))
        contraction_ratio = max(0.2, min(0.95, vcp_ratio))

        vol_5 = _safe_float(volume.tail(5).mean())
        vol_20 = _safe_float(volume.tail(20).mean())
        flow_score = 0.0 if vol_20 <= 0 else ((vol_5 - vol_20) / vol_20) * 100

        recent_high_20 = _safe_float(high.tail(20).max(), current)
        buy_point = round(recent_high_20 * 1.002, 0)

        score = max(0.0, min(100.0, 58 + (ret_5d * 5.6) + (ret_1d * 1.8) + (flow_score * 0.06) - (vcp_ratio * 8)))
        final_score = round(score, 1)

        openai_ai = _generate_openai_analysis(name, ticker, ret_1d, ret_5d, vcp_ratio)
        gemini_ai = _generate_gemini_analysis(name, ticker, ret_1d, ret_5d, vcp_ratio)

        signals.append({
            "ticker": ticker,
            "name": name,
            "market": _market_from_symbol(yahoo_symbol),
            "signal_date": today,
            "score": final_score,
            "contraction_ratio": round(contraction_ratio, 2),
            "vcp_ratio": round(vcp_ratio, 2),
            "volume": _safe_int(volume.iloc[-1]),
            "flow_score": round(flow_score, 0),
            "buy_point": buy_point,
            "entry_price": round(current, 0),
            "current_price": round(current, 0),
            "return_pct": round(ret_1d, 2),
            "final_score": final_score,
            "action_openai": openai_ai["rating"],
            "action_gemini": gemini_ai["rating"],
            "status": "OPEN",
        })

        ai_summary_map[ticker] = {
            "ticker": ticker,
            "name": name,
            "summary": f"{name} ({ticker}) VCP 비율 {vcp_ratio:.2f}, 5일 {ret_5d:+.2f}%, 1일 {ret_1d:+.2f}%.",
            "summary_ko": f"{name} ({ticker}) VCP 비율 {vcp_ratio:.2f}, 5일 {ret_5d:+.2f}%, 1일 {ret_1d:+.2f}%.",
            "summary_en": f"{name} ({ticker}) VCP ratio {vcp_ratio:.2f}, 5D {ret_5d:+.2f}%, 1D {ret_1d:+.2f}%.",
            "providers": {
                "openai": openai_ai,
                "gemini": gemini_ai,
            },
            "generated_at": generated_at,
        }

        candles = []
        tail = hist.tail(252)
        for idx, row in tail.iterrows():
            candles.append({
                "date": idx.strftime("%Y-%m-%d"),
                "open": round(_safe_float(row["Open"]), 2),
                "high": round(_safe_float(row["High"]), 2),
                "low": round(_safe_float(row["Low"]), 2),
                "close": round(_safe_float(row["Close"]), 2),
                "volume": _safe_int(row["Volume"]),
            })
        chart_payload[ticker] = candles

        close_tail = close.tail(60)
        if len(close_tail) > 1:
            base_price = _safe_float(close_tail.iloc[0])
            if base_price > 0:
                for idx, px in close_tail.items():
                    date_key = idx.strftime("%Y-%m-%d")
                    equity_point = (_safe_float(px) / base_price) * 100
                    portfolio_date_values.setdefault(date_key, []).append(equity_point)

    signals_sorted = sorted(signals, key=lambda x: x["final_score"], reverse=True)
    top20 = signals_sorted[:20]
    top10 = signals_sorted[:10]

    return {
        "signals_sorted": signals_sorted,
        "top20": top20,
        "top10": top10,
        "chart_payload": chart_payload,
        "ai_summary_map": ai_summary_map,
        "portfolio_date_values": portfolio_date_values,
    }


def calculate_kr_performance(
    top20: List[Dict],
    portfolio_date_values: Dict[str, List[float]],
    benchmark_curve: List[Dict],
    kosdaq_benchmark_curve: List[Dict],
    generated_at: str,
):
    if top20:
        winners = [s for s in top20 if (s.get("return_pct") or 0) > 0]
        losers = [s for s in top20 if (s.get("return_pct") or 0) <= 0]
        avg_return = sum((s.get("return_pct") or 0) for s in top20) / len(top20)
        win_rate = (len(winners) / len(top20)) * 100
    else:
        winners = []
        losers = []
        avg_return = 0.0
        win_rate = 0.0

    equity_curve = []
    if portfolio_date_values:
        for date_key in sorted(portfolio_date_values.keys()):
            values = portfolio_date_values[date_key]
            if values:
                equity_curve.append({
                    "date": date_key,
                    "equity": round(sum(values) / len(values), 2),
                })

    cumulative_return_pct = round((equity_curve[-1]["equity"] - 100), 2) if equity_curve else round(avg_return, 2)

    kr_performance = {
        "win_rate": round(win_rate, 1),
        "avg_return": round(avg_return, 2),
        "total_positions": len(top20),
        "generated_at": generated_at,
    }

    kr_cumulative_return = {
        "cumulative_return": cumulative_return_pct,
        "win_rate": round(win_rate, 1),
        "winners": len(winners),
        "losers": len(losers),
        "total_positions": len(top20),
        "positions": [{"ticker": s["ticker"], "return_pct": s.get("return_pct", 0)} for s in top20],
        "equity_curve": equity_curve,
        "benchmark_curve": benchmark_curve,
        "kosdaq_benchmark_curve": kosdaq_benchmark_curve,
        "generated_at": generated_at,
    }

    return kr_performance, kr_cumulative_return
