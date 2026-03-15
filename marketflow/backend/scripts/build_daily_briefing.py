"""
Build daily_briefing.json — schema v3 (bilingual ko/en, tone-enforced, cache-only, no LLM).

Inputs:
  backend/output/cache/market_tape.json
  backend/output/cache/market_state.json
  backend/output/cache/health_snapshot.json
  backend/output/cache/action_snapshot.json

Output:
  backend/output/cache/daily_briefing.json

Schema v3:
  lang            — ["ko", "en"]
  headline        — {ko, en}
  paragraphs      — {ko: [...], en: [...]}
  bullets         — {ko: [...], en: [...]}
  stance          — {ko, en, ...shared fields}
  tone_check      — {ko: {...}, en: {...}}
  as_of_date / data_date (backward compat)
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


# ── English Tone Policy ───────────────────────────────────────────────────────

REWRITE_RULES_EN: List[Tuple[str, str]] = [
    (r"!", "."),
    (r"\bsoaring\b",        "advancing"),
    (r"\bplunging\b",       "declining"),
    (r"\bsurging\b",        "advancing"),
    (r"\bcrashing\b",       "declining sharply"),
    (r"\bskyrocketing\b",   "advancing"),
    (r"\bcollapsing\b",     "declining"),
    (r"\bOpportunistic\b",  "Measured"),
    (r"\bAggressively\s+add\b", "Selectively add"),
]

BANNED_PATTERNS_EN: List[Tuple[str, str]] = [
    (r"!", "exclamation_mark"),
    (r"\bwill\s+(?:likely\s+)?(?:rise|fall|drop|surge|decline|rally|soar|crash)\b", "prediction"),
    (r"\bset\s+to\b",           "prediction"),
    (r"\bgoing\s+to\b",         "prediction"),
    (r"\bexpected\s+to\b",      "prediction"),
    (r"\bpoised\s+to\b",        "prediction"),
    (r"\bguarantee[sd]?\b",     "certainty"),
    (r"\bcertain(?:ly)?\b",     "certainty"),
    (r"\bdefinitely\b",         "certainty"),
    (r"\b(?:buy|sell|go\s+long|go\s+short)\b", "trade_call"),
    # "short" only as standalone verb/adj — not "short-term", "shorter", etc.
    (r"\bshort(?!-term|-run|-dated|-lived|er\b|ly\b|s\b|ing\b|\s+end\b|\s+term\b)\b", "trade_call"),
    (r"\binvestors\s+should\b", "trade_call"),
    (r"\byou\s+should\b",       "trade_call"),
    (r"\bprice\s+target\b",     "trade_call"),
    (r"\bmassive\b",            "hype"),
    (r"\bexplosive\b",          "hype"),
    (r"\bstrong\s+upside\b",    "hype"),
    (r"\bbear\s+market\s+confirmed\b", "hype"),
    (r"\bbull\s+run\b",         "hype"),
    (r"[\U0001F300-\U0001FAFF]", "emoji"),
    (r"[\U00002600-\U000027BF]", "emoji"),
]


# ── Korean Tone Policy ────────────────────────────────────────────────────────

REWRITE_RULES_KO: List[Tuple[str, str]] = [
    (r"!", "."),
    (r"폭등",  "상승"),
    (r"급등",  "상승"),
    (r"폭락",  "하락"),
    (r"급락",  "하락"),
    (r"천정부지로\s*치솟", "상승세를 유지"),
    (r"대박",  "유의미한 수익"),
]

BANNED_PATTERNS_KO: List[Tuple[str, str]] = [
    (r"!",                          "exclamation_mark"),
    (r"폭등",                        "hype"),
    (r"급등",                        "hype"),
    (r"폭락",                        "hype"),
    (r"급락",                        "hype"),
    (r"천정부지",                     "hype"),
    (r"매수[해하]세요",               "trade_call"),
    (r"매도[해하]세요",               "trade_call"),
    (r"지금\s*[사팔]야",              "trade_call"),
    (r"목표\s*가격",                  "trade_call"),
    (r"반드시",                       "certainty"),
    (r"확실(?:히|합니다)",            "certainty"),
    (r"틀림없",                       "certainty"),
    (r"[\U0001F300-\U0001FAFF]",    "emoji"),
    (r"[\U00002600-\U000027BF]",    "emoji"),
]


class TonePolicy:
    """Deterministic tone enforcement. Pure regex, no LLM."""

    def __init__(
        self,
        rewrite_rules: List[Tuple[str, str]],
        banned_patterns: List[Tuple[str, str]],
    ) -> None:
        self._rewrites = [
            (re.compile(p, re.IGNORECASE), r) for p, r in rewrite_rules
        ]
        self._banned = [
            (re.compile(p, re.IGNORECASE), cat) for p, cat in banned_patterns
        ]

    def rewrite(self, text: str) -> Tuple[str, bool]:
        result = text
        for pattern, replacement in self._rewrites:
            result = pattern.sub(replacement, result)
        return result, result != text

    def validate(self, text: str) -> List[str]:
        violations: List[str] = []
        for pattern, category in self._banned:
            for m in pattern.findall(text):
                violations.append(f"{category}: '{m}'")
        return violations

    def enforce_all(self, texts: List[str]) -> Tuple[List[str], Dict[str, Any]]:
        cleaned: List[str] = []
        all_violations: List[str] = []
        any_rewritten = False
        for t in texts:
            text, was_rewritten = self.rewrite(t)
            violations = self.validate(text)
            cleaned.append(text)
            all_violations.extend(violations)
            if was_rewritten:
                any_rewritten = True
        return cleaned, {
            "tone_ok": len(all_violations) == 0,
            "violations": all_violations,
            "rewritten": any_rewritten,
        }


_POLICY_EN = TonePolicy(REWRITE_RULES_EN, BANNED_PATTERNS_EN)
_POLICY_KO = TonePolicy(REWRITE_RULES_KO, BANNED_PATTERNS_KO)


# ── Helpers ───────────────────────────────────────────────────────────────────

def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def cache_dir() -> str:
    return os.path.join(repo_root(), "backend", "output", "cache")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_json(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def fmt_pct(v: Optional[float], sign: bool = True) -> str:
    if v is None:
        return "--"
    try:
        return f"{v:+.2f}%" if sign else f"{v:.2f}%"
    except Exception:
        return "--"


def fmt_num(v: Optional[float], decimals: int = 2) -> str:
    if v is None:
        return "--"
    try:
        return f"{v:.{decimals}f}"
    except Exception:
        return "--"


def get_tape_item(items: List[Dict[str, Any]], symbol: str) -> Dict[str, Any]:
    for it in items:
        if str(it.get("symbol", "")).upper() == symbol:
            return it
    return {}


def _trend_is_above(ms: Dict[str, Any]) -> bool:
    t = ms.get("trend") or {}
    value = str(t.get("value") or "").upper()
    label = str(t.get("label") or "").upper()
    return "ABOVE" in value or "SMA200+" in label or "ABOVE" in label


# Direction helpers

def _dir_en(pct: Optional[float]) -> str:
    if pct is None:
        return "was flat"
    if pct > 1.0:
        return f"advanced {fmt_pct(pct)}"
    if pct > 0.2:
        return f"moved higher by {fmt_pct(pct)}"
    if pct < -1.0:
        return f"declined {fmt_pct(pct)}"
    if pct < -0.2:
        return f"moved lower by {fmt_pct(pct)}"
    return f"was largely unchanged ({fmt_pct(pct)})"


def _dir_ko(pct: Optional[float]) -> str:
    if pct is None:
        return "보합세를 유지하였습니다"
    if pct > 1.0:
        return f"{fmt_pct(pct)} 상승하였습니다"
    if pct > 0.2:
        return f"소폭 상승하였습니다({fmt_pct(pct)})"
    if pct < -1.0:
        return f"{fmt_pct(pct)} 하락하였습니다"
    if pct < -0.2:
        return f"소폭 하락하였습니다({fmt_pct(pct)})"
    return f"보합세를 유지하였습니다({fmt_pct(pct)})"


# ── Headline ──────────────────────────────────────────────────────────────────

def build_headlines(ms: Dict[str, Any], health: Dict[str, Any]) -> Tuple[str, str]:
    """Return (headline_en, headline_ko)."""
    risk_label = str(((ms.get("risk") or {}).get("label") or "")).upper()
    gate = ms.get("gate") or {}
    gate_delta5d = gate.get("delta5d")
    above = _trend_is_above(ms)

    if "HIGH" in risk_label:
        return (
            "Volatility elevated; risk regime warrants reduced exposure.",
            "변동성 상승 — 리스크 구간상 노출도 축소 검토가 필요합니다.",
        )
    if "LOW" in risk_label and above:
        if gate_delta5d is not None and gate_delta5d >= 3:
            return (
                "Risk contained; trend intact with improving breadth.",
                "리스크 안정, 추세 유지 — 시장 폭도 개선 중입니다.",
            )
        return (
            "Risk contained; primary trend structure remains supportive.",
            "리스크 안정, 1차 추세 구조가 지지적 환경을 유지합니다.",
        )
    if above:
        if gate_delta5d is not None and gate_delta5d <= -5:
            return (
                "Trend intact; breadth narrowing warrants monitoring.",
                "추세는 유지되지만, 시장 폭이 좁아져 관찰이 필요합니다.",
            )
        return (
            "Trend intact; risk conditions are mixed.",
            "추세는 유지되나, 리스크 여건은 혼조세입니다.",
        )
    trend_val = str(((ms.get("trend") or {}).get("value") or "")).upper()
    if "BELOW" in trend_val:
        return (
            "Price below long-term trend; structural caution is warranted.",
            "가격이 장기 추세선 아래 — 구조적 신중함이 요구됩니다.",
        )
    breadth = health.get("breadth_greed") or {}
    greed_label = str(breadth.get("label") or "").lower()
    if greed_label:
        ko_sentiment = {"fear": "공포", "greed": "탐욕", "neutral": "중립"}.get(greed_label, greed_label)
        return (
            f"Market in transition; sentiment reads {greed_label}.",
            f"시장 전환 구간 — 심리 지표는 {ko_sentiment} 수준을 나타냅니다.",
        )
    return (
        "Market in transition; signals are mixed.",
        "시장 전환 구간 — 신호가 혼조세를 보이고 있습니다.",
    )


# ── Paragraph builders — English ─────────────────────────────────────────────

def _para_price_action_en(tape: Dict[str, Any], ms: Dict[str, Any]) -> str:
    items = tape.get("items") or []
    qqq = get_tape_item(items, "QQQ")
    spy = get_tape_item(items, "SPY")
    iwm = get_tape_item(items, "IWM")
    dia = get_tape_item(items, "DIA")
    vix = get_tape_item(items, "VIX")

    qqq_pct = qqq.get("chg_pct") if qqq else None
    spy_pct = spy.get("chg_pct") if spy else None
    iwm_pct = iwm.get("chg_pct") if iwm else None
    vix_pct = vix.get("chg_pct") if vix else None

    if qqq_pct is None and spy_pct is None:
        return (
            "Index data is not available for this session. "
            "Price action analysis will resume when market tape refreshes."
        )

    index_parts: List[str] = []
    if qqq_pct is not None:
        index_parts.append(f"QQQ {_dir_en(qqq_pct)}")
    if spy_pct is not None:
        index_parts.append(f"SPY {_dir_en(spy_pct)}")
    if dia:
        dia_pct = dia.get("chg_pct")
        if dia_pct is not None:
            index_parts.append(f"DIA {_dir_en(dia_pct)}")

    sentence1 = ("; ".join(index_parts) if index_parts else "Indices were mixed") + " on the session."

    breadth_note = ""
    if iwm_pct is not None and qqq_pct is not None:
        gap = iwm_pct - qqq_pct
        if gap < -0.75:
            breadth_note = (
                " Small-cap underperformance relative to large-cap tech "
                "is consistent with a narrowing leadership structure."
            )
        elif gap > 0.75:
            breadth_note = (
                " Small-cap outperformance relative to large-cap suggests "
                "a degree of broadening in market participation."
            )

    vix_note = ""
    if vix_pct is not None:
        if vix_pct > 8:
            vix_note = (
                f" Implied volatility expanded materially (VIX {fmt_pct(vix_pct)}), "
                "indicating a repricing of near-term uncertainty."
            )
        elif vix_pct > 3:
            vix_note = (
                f" VIX moved {fmt_pct(vix_pct)}, reflecting modest upward pressure "
                "on near-term hedging demand."
            )
        elif vix_pct < -8:
            vix_note = (
                f" Implied volatility compressed (VIX {fmt_pct(vix_pct)}), "
                "consistent with reduced near-term hedging activity."
            )
        elif vix_pct < -3:
            vix_note = (
                f" VIX declined {fmt_pct(abs(vix_pct))}, consistent with "
                "easing in near-term volatility pricing."
            )
        else:
            vix_note = (
                f" VIX was relatively contained ({fmt_pct(vix_pct)}), "
                "suggesting no material shift in implied volatility."
            )

    return sentence1 + vix_note + breadth_note


def _para_risk_regime_en(ms: Dict[str, Any], health: Dict[str, Any]) -> str:
    risk = ms.get("risk") or {}
    risk_label = risk.get("label") or "--"
    vol_pct = risk.get("vol_pct")
    var95 = risk.get("var95")

    h_risk = health.get("risk") or {}
    cvar95 = h_risk.get("cvar95_1d")
    vol_ratio = h_risk.get("vol_ratio")

    if risk_label == "--" and vol_pct is None:
        return (
            "Risk regime data is not available for this session. "
            "Volatility classification will resume when the snapshot refreshes."
        )

    label_text = risk_label.upper()
    if label_text in ("LOW", "LOW-MED"):
        regime_desc = "contained within the lower range of its recent distribution"
    elif label_text in ("MED", "MEDIUM"):
        regime_desc = "within a moderate, historically mid-range band"
    elif label_text in ("HIGH", "HIGH-MED"):
        regime_desc = "elevated relative to recent baseline levels"
    else:
        regime_desc = "within current observed parameters"

    sentence1 = (
        f"The risk regime is classified as {risk_label}, "
        f"with portfolio volatility {regime_desc}."
    )
    vol_detail = f" Annualized portfolio volatility sits at {fmt_num(vol_pct, 1)}%." if vol_pct is not None else ""

    var_detail = ""
    if var95 is not None or cvar95 is not None:
        parts = []
        if var95 is not None:
            parts.append(f"VaR95 at {fmt_pct(var95, sign=False)}")
        if cvar95 is not None:
            parts.append(f"CVaR95 at {fmt_pct(cvar95, sign=False)}")
        var_detail = (
            f" One-day tail risk metrics show {' and '.join(parts)}, "
            "representing the estimated loss threshold at the 95th percentile "
            "of the return distribution."
        )

    ratio_detail = ""
    if vol_ratio is not None:
        if vol_ratio > 1.15:
            ratio_detail = (
                f" Volatility ratio at {fmt_num(vol_ratio)} indicates "
                "realized volatility is running above its recent average — "
                "a condition associated with volatility clustering."
            )
        elif vol_ratio < 0.85:
            ratio_detail = (
                f" Volatility ratio at {fmt_num(vol_ratio)} suggests "
                "realized volatility is below recent average levels, "
                "consistent with a calm but not necessarily stable regime."
            )
        else:
            ratio_detail = (
                f" Volatility ratio at {fmt_num(vol_ratio)} is near parity "
                "with recent averages, indicating no significant regime shift."
            )

    return sentence1 + vol_detail + var_detail + ratio_detail


def _para_trend_context_en(ms: Dict[str, Any], health: Dict[str, Any]) -> str:
    trend = ms.get("trend") or {}
    gate = ms.get("gate") or {}
    phase = ms.get("phase") or {}

    pct_from_sma200 = trend.get("pct_from_sma200")
    qqq_close = trend.get("qqq_close")
    qqq_sma200 = trend.get("qqq_sma200")
    gate_value = gate.get("value")
    gate_avg10d = gate.get("avg10d")
    gate_delta5d = gate.get("delta5d")
    phase_label = phase.get("label") or "--"

    if pct_from_sma200 is None:
        return (
            "Trend structure data is not available. "
            "Long-term trend analysis will resume when the snapshot refreshes."
        )

    if pct_from_sma200 > 0:
        trend_sentence = (
            f"The primary trend structure remains intact: QQQ holds "
            f"{fmt_pct(pct_from_sma200, sign=False)} above its 200-day moving average "
            f"({fmt_num(qqq_close)} vs SMA200 {fmt_num(qqq_sma200)}), "
            "which is the key long-term support reference."
        )
    else:
        trend_sentence = (
            f"QQQ has declined below its 200-day moving average by "
            f"{fmt_pct(abs(pct_from_sma200), sign=False)} "
            f"({fmt_num(qqq_close)} vs SMA200 {fmt_num(qqq_sma200)}). "
            "Trend structure is no longer constructive at the primary level."
        )

    gate_detail = _gate_detail_en(gate_value, gate_avg10d, gate_delta5d)
    phase_detail = f" Regime classification: {phase_label}." if phase_label not in ("--", "") else ""

    return trend_sentence + gate_detail + phase_detail


def _gate_detail_en(
    gate_value: Optional[float],
    gate_avg10d: Optional[float],
    gate_delta5d: Optional[float],
) -> str:
    if gate_value is None:
        return ""
    delta_declining = gate_delta5d is not None and gate_delta5d <= -5
    delta_improving = gate_delta5d is not None and gate_delta5d >= 5
    above_avg = gate_avg10d is not None and gate_value > gate_avg10d + 5
    below_avg = gate_avg10d is not None and gate_value < gate_avg10d - 5

    if delta_declining and above_avg:
        return (
            f" The breadth gate score stands at {fmt_num(gate_value, 1)}, "
            f"above its 10-day average of {fmt_num(gate_avg10d, 1)} "
            f"but declining {fmt_pct(gate_delta5d)} over the past five sessions — "
            "a sign of fading near-term participation within an otherwise intact breadth structure."
        )
    if delta_declining:
        return (
            f" The breadth gate score at {fmt_num(gate_value, 1)} "
            f"has declined {fmt_pct(gate_delta5d)} over the past five sessions, "
            "consistent with a narrowing of near-term participation."
        )
    if delta_improving and below_avg:
        return (
            f" The breadth gate score at {fmt_num(gate_value, 1)} "
            f"remains below its 10-day average of {fmt_num(gate_avg10d, 1)}, "
            f"though the 5-day change of {fmt_pct(gate_delta5d)} suggests "
            "participation is beginning to recover."
        )
    if delta_improving:
        return (
            f" The breadth gate score at {fmt_num(gate_value, 1)} "
            f"is improving, with a 5-day change of {fmt_pct(gate_delta5d)}."
        )
    if below_avg:
        return (
            f" The breadth gate score at {fmt_num(gate_value, 1)} "
            f"sits below its 10-day average of {fmt_num(gate_avg10d, 1)}, "
            "indicating that recent breadth has been below the near-term baseline."
        )
    if above_avg:
        return (
            f" The breadth gate score at {fmt_num(gate_value, 1)} "
            f"is above its 10-day average of {fmt_num(gate_avg10d, 1)}, "
            "consistent with broad participation relative to the recent baseline."
        )
    avg_str = fmt_num(gate_avg10d, 1) if gate_avg10d is not None else "--"
    return (
        f" The breadth gate score stands at {fmt_num(gate_value, 1)}, "
        f"near its 10-day average of {avg_str}."
    )


def _para_positioning_en(
    action: Dict[str, Any], ms: Dict[str, Any], health: Dict[str, Any]
) -> str:
    exposure = action.get("exposure_guidance") or {}
    action_label = str(exposure.get("action_label") or "Hold")
    exposure_band = exposure.get("exposure_band") or "--"
    reason = exposure.get("reason") or ""
    risk_label = str((ms.get("risk") or {}).get("label") or "--").upper()
    above = _trend_is_above(ms)

    if "HIGH" in risk_label:
        regime_char = (
            "An elevated risk classification alongside the current trend structure "
            "represents an environment where drawdown probability is above baseline."
        )
    elif "LOW" in risk_label and above:
        regime_char = (
            "A contained risk classification with price above long-term trend "
            "represents the more structurally comfortable of the four regime quadrants."
        )
    elif above:
        regime_char = (
            "Price holding above the long-term trend anchor provides a supportive "
            "structural backdrop, even as risk metrics reflect a moderate environment."
        )
    else:
        regime_char = (
            "The current combination of trend and risk signals represents "
            "a mixed structural environment, warranting measured position calibration."
        )

    band_detail = ""
    if exposure_band != "--":
        band_detail = (
            f" The model-derived exposure band for this regime is {exposure_band}, "
            "reflecting the historical risk/return distribution of comparable conditions — "
            "not a directional call."
        )

    if action_label.lower().startswith("reduce"):
        implication = (
            " In this configuration, the structural priority shifts toward "
            "preserving drawdown capacity rather than extending exposure."
        )
    elif action_label.lower().startswith("increase"):
        implication = (
            " In this configuration, the structural conditions are consistent "
            "with maintaining or selectively adding to existing positions, "
            "subject to individual risk parameters."
        )
    else:
        implication = (
            " Maintaining current exposure discipline without material adjustment "
            "is consistent with the risk/reward implied by the current regime."
        )

    reason_detail = (
        f" Supporting context: {reason}"
        if reason and reason not in ("Mixed trend/risk signals.",)
        else ""
    )
    return regime_char + band_detail + implication + reason_detail


# ── Paragraph builders — Korean ───────────────────────────────────────────────

def _para_price_action_ko(tape: Dict[str, Any], ms: Dict[str, Any]) -> str:
    items = tape.get("items") or []
    qqq = get_tape_item(items, "QQQ")
    spy = get_tape_item(items, "SPY")
    iwm = get_tape_item(items, "IWM")
    dia = get_tape_item(items, "DIA")
    vix = get_tape_item(items, "VIX")

    qqq_pct = qqq.get("chg_pct") if qqq else None
    spy_pct = spy.get("chg_pct") if spy else None
    iwm_pct = iwm.get("chg_pct") if iwm else None
    vix_pct = vix.get("chg_pct") if vix else None

    if qqq_pct is None and spy_pct is None:
        return "이 세션의 지수 데이터를 이용할 수 없습니다. 시장 테이프 데이터가 갱신되면 분석이 재개됩니다."

    parts: List[str] = []
    if qqq_pct is not None:
        parts.append(f"QQQ는 {_dir_ko(qqq_pct)}")
    if spy_pct is not None:
        parts.append(f"SPY는 {_dir_ko(spy_pct)}")
    if dia:
        dia_pct = dia.get("chg_pct")
        if dia_pct is not None:
            parts.append(f"DIA는 {_dir_ko(dia_pct)}")

    sentence1 = "전일 대비 " + ", ".join(parts) + "." if parts else "주요 지수는 혼조세였습니다."

    breadth_note = ""
    if iwm_pct is not None and qqq_pct is not None:
        gap = iwm_pct - qqq_pct
        if gap < -0.75:
            breadth_note = (
                " 소형주(IWM)의 대형 기술주(QQQ) 대비 약세는 "
                "리더십이 특정 섹터에 집중되고 있음을 시사합니다."
            )
        elif gap > 0.75:
            breadth_note = (
                " 소형주(IWM)의 대형 기술주(QQQ) 대비 강세는 "
                "시장 참여 폭이 다소 확대되고 있음을 나타냅니다."
            )

    vix_note = ""
    if vix_pct is not None:
        if vix_pct > 8:
            vix_note = (
                f" VIX가 {fmt_pct(vix_pct)} 확대되어 "
                "단기 불확실성에 대한 내재변동성 재가격화가 나타났습니다."
            )
        elif vix_pct > 3:
            vix_note = (
                f" VIX는 {fmt_pct(vix_pct)} 상승, "
                "단기 헤지 수요가 소폭 증가하였습니다."
            )
        elif vix_pct < -8:
            vix_note = (
                f" VIX가 {fmt_pct(vix_pct)} 압축되어 "
                "단기 헤지 수요가 감소하였습니다."
            )
        elif vix_pct < -3:
            vix_note = (
                f" VIX는 {fmt_pct(abs(vix_pct))} 하락, "
                "단기 변동성 프리미엄이 완화되었습니다."
            )
        else:
            vix_note = (
                f" VIX는 {fmt_pct(vix_pct)}로 비교적 안정적이었습니다."
            )

    return sentence1 + vix_note + breadth_note


def _para_risk_regime_ko(ms: Dict[str, Any], health: Dict[str, Any]) -> str:
    risk = ms.get("risk") or {}
    risk_label = risk.get("label") or "--"
    vol_pct = risk.get("vol_pct")
    var95 = risk.get("var95")

    h_risk = health.get("risk") or {}
    cvar95 = h_risk.get("cvar95_1d")
    vol_ratio = h_risk.get("vol_ratio")

    if risk_label == "--" and vol_pct is None:
        return "이 세션의 리스크 구간 데이터를 이용할 수 없습니다. 스냅샷이 갱신되면 변동성 분류가 재개됩니다."

    label_text = risk_label.upper()
    if label_text in ("LOW", "LOW-MED"):
        regime_desc = "최근 분포의 하단 범위에서 안정적으로 유지되고 있습니다"
    elif label_text in ("MED", "MEDIUM"):
        regime_desc = "역사적 중간 범위에 위치하고 있습니다"
    elif label_text in ("HIGH", "HIGH-MED"):
        regime_desc = "최근 기준 대비 높은 수준입니다"
    else:
        regime_desc = "현재 관측 범위 내에 있습니다"

    sentence1 = (
        f"리스크 구간은 현재 {risk_label}로 분류되며, "
        f"포트폴리오 변동성은 {regime_desc}."
    )
    vol_detail = (
        f" 연환산 포트폴리오 변동성은 {fmt_num(vol_pct, 1)}%입니다."
        if vol_pct is not None else ""
    )

    var_detail = ""
    if var95 is not None or cvar95 is not None:
        parts = []
        if var95 is not None:
            parts.append(f"VaR95 {fmt_pct(var95, sign=False)}")
        if cvar95 is not None:
            parts.append(f"CVaR95 {fmt_pct(cvar95, sign=False)}")
        var_detail = (
            f" 일일 꼬리 리스크 지표는 {', '.join(parts)}로, "
            "수익률 분포의 95퍼센타일에서의 예상 손실 한계치를 나타냅니다."
        )

    ratio_detail = ""
    if vol_ratio is not None:
        if vol_ratio > 1.15:
            ratio_detail = (
                f" 변동성 비율 {fmt_num(vol_ratio)}는 실현 변동성이 "
                "최근 평균을 상회하고 있음을 나타내며, 변동성 군집화와 관련된 상태입니다."
            )
        elif vol_ratio < 0.85:
            ratio_detail = (
                f" 변동성 비율 {fmt_num(vol_ratio)}는 실현 변동성이 "
                "최근 평균을 하회하고 있으나, 이것이 안정적인 구간을 의미하지는 않습니다."
            )
        else:
            ratio_detail = (
                f" 변동성 비율 {fmt_num(vol_ratio)}는 최근 평균과 유사한 수준으로, "
                "구간 전환의 신호는 관찰되지 않습니다."
            )

    return sentence1 + vol_detail + var_detail + ratio_detail


def _para_trend_context_ko(ms: Dict[str, Any], health: Dict[str, Any]) -> str:
    trend = ms.get("trend") or {}
    gate = ms.get("gate") or {}
    phase = ms.get("phase") or {}

    pct_from_sma200 = trend.get("pct_from_sma200")
    qqq_close = trend.get("qqq_close")
    qqq_sma200 = trend.get("qqq_sma200")
    gate_value = gate.get("value")
    gate_avg10d = gate.get("avg10d")
    gate_delta5d = gate.get("delta5d")
    phase_label = phase.get("label") or "--"

    if pct_from_sma200 is None:
        return "추세 구조 데이터를 이용할 수 없습니다. 스냅샷이 갱신되면 분석이 재개됩니다."

    if pct_from_sma200 > 0:
        trend_sentence = (
            f"1차 추세 구조는 유지되고 있습니다: "
            f"QQQ는 200일 이동평균 대비 {fmt_pct(pct_from_sma200, sign=False)} 상위에 위치합니다 "
            f"({fmt_num(qqq_close)} vs SMA200 {fmt_num(qqq_sma200)}). "
            "이 수준은 장기 추세 지지 기준선으로 기능합니다."
        )
    else:
        trend_sentence = (
            f"QQQ는 200일 이동평균 대비 {fmt_pct(abs(pct_from_sma200), sign=False)} 아래로 하락하였습니다 "
            f"({fmt_num(qqq_close)} vs SMA200 {fmt_num(qqq_sma200)}). "
            "1차 추세 구조는 더 이상 건설적이지 않습니다."
        )

    gate_detail = _gate_detail_ko(gate_value, gate_avg10d, gate_delta5d)
    phase_detail = f" 레짐 분류: {phase_label}." if phase_label not in ("--", "") else ""

    return trend_sentence + gate_detail + phase_detail


def _gate_detail_ko(
    gate_value: Optional[float],
    gate_avg10d: Optional[float],
    gate_delta5d: Optional[float],
) -> str:
    if gate_value is None:
        return ""
    delta_declining = gate_delta5d is not None and gate_delta5d <= -5
    delta_improving = gate_delta5d is not None and gate_delta5d >= 5
    above_avg = gate_avg10d is not None and gate_value > gate_avg10d + 5
    below_avg = gate_avg10d is not None and gate_value < gate_avg10d - 5

    if delta_declining and above_avg:
        return (
            f" 브레드스 게이트 점수는 {fmt_num(gate_value, 1)}로, "
            f"10일 평균({fmt_num(gate_avg10d, 1)})을 상회하지만 "
            f"최근 5일간 {fmt_pct(gate_delta5d)} 하락하였습니다 — "
            "전반적인 브레드스 구조는 유지되나 단기 참여 폭은 약화되고 있습니다."
        )
    if delta_declining:
        return (
            f" 브레드스 게이트 점수는 최근 5일간 {fmt_pct(gate_delta5d)} 하락하여 "
            f"현재 {fmt_num(gate_value, 1)}을 기록하고 있으며, "
            "단기 참여 폭의 축소와 일치합니다."
        )
    if delta_improving and below_avg:
        return (
            f" 브레드스 게이트 점수 {fmt_num(gate_value, 1)}는 "
            f"10일 평균({fmt_num(gate_avg10d, 1)})을 하회하지만, "
            f"5일 변화량 {fmt_pct(gate_delta5d)}는 참여 폭 회복의 초기 신호를 나타냅니다."
        )
    if delta_improving:
        return (
            f" 브레드스 게이트 점수 {fmt_num(gate_value, 1)}는 "
            f"최근 5일간 {fmt_pct(gate_delta5d)} 개선되었습니다."
        )
    if below_avg:
        return (
            f" 브레드스 게이트 점수 {fmt_num(gate_value, 1)}는 "
            f"10일 평균({fmt_num(gate_avg10d, 1)})을 하회하며, "
            "최근 브레드스가 단기 기준선에 미치지 못하고 있습니다."
        )
    if above_avg:
        return (
            f" 브레드스 게이트 점수 {fmt_num(gate_value, 1)}는 "
            f"10일 평균({fmt_num(gate_avg10d, 1)})을 상회하여, "
            "최근 기준 대비 넓은 시장 참여를 반영합니다."
        )
    avg_str = fmt_num(gate_avg10d, 1) if gate_avg10d is not None else "--"
    return (
        f" 브레드스 게이트 점수는 {fmt_num(gate_value, 1)}로, "
        f"10일 평균({avg_str})에 근접해 있습니다."
    )


def _para_positioning_ko(
    action: Dict[str, Any], ms: Dict[str, Any], health: Dict[str, Any]
) -> str:
    exposure = action.get("exposure_guidance") or {}
    action_label = str(exposure.get("action_label") or "Hold")
    exposure_band = exposure.get("exposure_band") or "--"
    reason = exposure.get("reason") or ""
    risk_label = str((ms.get("risk") or {}).get("label") or "--").upper()
    above = _trend_is_above(ms)

    if "HIGH" in risk_label:
        regime_char = (
            "현재 추세 구조 하에서 리스크 구간이 상향된 상태는 "
            "기준 대비 드로다운 발생 가능성이 높은 환경을 의미합니다."
        )
    elif "LOW" in risk_label and above:
        regime_char = (
            "리스크가 안정되고 가격이 장기 추세선 위에 위치한 구성은 "
            "4개의 구간 조합 중 가장 구조적으로 우호적인 상태입니다."
        )
    elif above:
        regime_char = (
            "가격이 장기 추세 기준선 위를 유지하는 것은 리스크 지표가 "
            "중간 수준을 반영하는 상황에서도 구조적 지지 환경을 제공합니다."
        )
    else:
        regime_char = (
            "현재 추세와 리스크 신호의 조합은 혼조세의 구조적 환경을 나타내며, "
            "신중한 포지션 조정이 요구됩니다."
        )

    band_detail = ""
    if exposure_band != "--":
        band_detail = (
            f" 이 레짐에 대한 모델 기반 노출도 범위는 {exposure_band}로, "
            "유사한 과거 조건의 리스크/수익 분포를 반영한 수치입니다(방향성 콜이 아님)."
        )

    if action_label.lower().startswith("reduce"):
        implication = (
            " 이 구성에서 구조적 우선순위는 노출도 확대보다 "
            "드로다운 여력 보존으로 이동합니다."
        )
    elif action_label.lower().startswith("increase"):
        implication = (
            " 이 구성에서 구조적 조건은 기존 포지션을 유지하거나 "
            "개별 리스크 파라미터에 따라 선택적으로 추가하는 방향과 일치합니다."
        )
    else:
        implication = (
            " 현재 레짐이 시사하는 리스크/보상 구조에서는 "
            "현 노출도 규율을 큰 조정 없이 유지하는 것이 적합합니다."
        )

    reason_detail = (
        f" 참고 맥락: {reason}"
        if reason and reason not in ("Mixed trend/risk signals.",)
        else ""
    )
    return regime_char + band_detail + implication + reason_detail


# ── Bullets ───────────────────────────────────────────────────────────────────

def _build_bullets_en(tape: Dict, ms: Dict, health: Dict) -> List[Dict[str, Any]]:
    items = tape.get("items") or []
    qqq = get_tape_item(items, "QQQ")
    spy = get_tape_item(items, "SPY")
    vix = get_tape_item(items, "VIX")
    qqq_pct = qqq.get("chg_pct") if qqq else None
    spy_pct = spy.get("chg_pct") if spy else None
    vix_pct = vix.get("chg_pct") if vix else None

    risk_label = (ms.get("risk") or {}).get("label") or "--"
    h_risk = health.get("risk") or {}
    cvar95 = h_risk.get("cvar95_1d")
    vol_ratio = h_risk.get("vol_ratio")
    b = health.get("breadth_greed") or {}
    greed = b.get("greed_proxy")
    greed_label = b.get("label") or "--"

    index_parts = []
    if qqq_pct is not None: index_parts.append(f"QQQ {fmt_pct(qqq_pct)}")
    if spy_pct is not None:  index_parts.append(f"SPY {fmt_pct(spy_pct)}")
    if vix_pct is not None:  index_parts.append(f"VIX {fmt_pct(vix_pct)}")

    return [
        {"label": "Index",   "text": ", ".join(index_parts) if index_parts else "Unavailable."},
        {"label": "Risk",    "text": f"Risk {risk_label}; CVaR95 {fmt_pct(cvar95)}; VolRatio {fmt_num(vol_ratio)}."},
        {"label": "Breadth", "text": f"Breadth {greed_label}; Greed {fmt_num(greed)}/100." if greed is not None else "Breadth data unavailable."},
    ]


def _build_bullets_ko(tape: Dict, ms: Dict, health: Dict) -> List[Dict[str, Any]]:
    items = tape.get("items") or []
    qqq = get_tape_item(items, "QQQ")
    spy = get_tape_item(items, "SPY")
    vix = get_tape_item(items, "VIX")
    qqq_pct = qqq.get("chg_pct") if qqq else None
    spy_pct = spy.get("chg_pct") if spy else None
    vix_pct = vix.get("chg_pct") if vix else None

    risk_label_map = {"LOW": "낮음", "LOW-MED": "낮음-중간", "MED": "중간", "MEDIUM": "중간", "HIGH": "높음", "HIGH-MED": "높음-중간"}
    risk_raw = str((ms.get("risk") or {}).get("label") or "--").upper()
    risk_ko = risk_label_map.get(risk_raw, risk_raw)
    h_risk = health.get("risk") or {}
    cvar95 = h_risk.get("cvar95_1d")
    vol_ratio = h_risk.get("vol_ratio")
    b = health.get("breadth_greed") or {}
    greed = b.get("greed_proxy")
    greed_label_raw = str(b.get("label") or "--").lower()
    greed_ko_map = {"fear": "공포", "greed": "탐욕", "neutral": "중립", "extreme fear": "극단적 공포", "extreme greed": "극단적 탐욕"}
    greed_ko = greed_ko_map.get(greed_label_raw, greed_label_raw)

    parts = []
    if qqq_pct is not None: parts.append(f"QQQ {fmt_pct(qqq_pct)}")
    if spy_pct is not None:  parts.append(f"SPY {fmt_pct(spy_pct)}")
    if vix_pct is not None:  parts.append(f"VIX {fmt_pct(vix_pct)}")

    return [
        {"label": "지수",   "text": ", ".join(parts) if parts else "데이터 없음."},
        {"label": "리스크", "text": f"리스크 {risk_ko}; CVaR95 {fmt_pct(cvar95)}; VolRatio {fmt_num(vol_ratio)}."},
        {"label": "브레드스", "text": f"브레드스 {greed_ko}; 탐욕 {fmt_num(greed)}/100." if greed is not None else "브레드스 데이터 없음."},
    ]


# ── Stance ────────────────────────────────────────────────────────────────────

def _build_stance(action: Dict, ms: Dict, health: Dict) -> Dict[str, Any]:
    exposure = action.get("exposure_guidance") or {}
    action_label = exposure.get("action_label") or "Hold"
    exposure_band = exposure.get("exposure_band") or "--"
    why = exposure.get("reason") or "Mixed trend/risk signals."

    en_label = "Balanced"
    if str(action_label).lower().startswith("reduce"):
        en_label = "Defensive"
    elif str(action_label).lower().startswith("increase"):
        en_label = "Measured"

    ko_label_map = {"Balanced": "균형", "Defensive": "방어적", "Measured": "신중한 조정"}
    ko_label = ko_label_map.get(en_label, en_label)

    if why == "Mixed trend/risk signals.":
        risk_label = (ms.get("risk") or {}).get("label") or ""
        trend = (health.get("trend") or {}).get("dist_pct")
        if risk_label:
            why = f"Risk {risk_label.lower()} with mixed trend."
        elif trend is not None:
            why = f"QQQ vs SMA200 distance {fmt_pct(trend)}."

    ko_action_map = {
        "Hold": "유지", "Increase": "선택적 추가", "Reduce": "축소",
        "Selectively add": "선택적 추가",
    }
    ko_action = ko_action_map.get(action_label, action_label)

    return {
        "label":        {"en": en_label,    "ko": ko_label},
        "action":       {"en": action_label, "ko": ko_action},
        "exposure_band": exposure_band,
        "why":          why,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    cache  = cache_dir()
    tape   = load_json(os.path.join(cache, "market_tape.json"))
    ms     = load_json(os.path.join(cache, "market_state.json"))
    health = load_json(os.path.join(cache, "health_snapshot.json"))
    action = load_json(os.path.join(cache, "action_snapshot.json"))

    as_of_date = (
        (ms.get("data_date") if ms else None)
        or (tape.get("data_date") if tape else None)
        or (health.get("data_date") if health else None)
        or (action.get("data_date") if action else None)
    )

    # ── Build raw text ───────────────────────────────────────────────────────
    headline_en, headline_ko = build_headlines(ms, health)

    p1_en = _para_price_action_en(tape, ms)
    p2_en = _para_risk_regime_en(ms, health)
    p3_en = _para_trend_context_en(ms, health)
    p4_en = _para_positioning_en(action, ms, health)

    p1_ko = _para_price_action_ko(tape, ms)
    p2_ko = _para_risk_regime_ko(ms, health)
    p3_ko = _para_trend_context_ko(ms, health)
    p4_ko = _para_positioning_ko(action, ms, health)

    stance_raw = _build_stance(action, ms, health)

    # ── Apply tone policies ──────────────────────────────────────────────────
    en_texts = [headline_en, p1_en, p2_en, p3_en, p4_en, stance_raw["why"]]
    ko_texts = [headline_ko, p1_ko, p2_ko, p3_ko, p4_ko]

    cleaned_en, tone_en = _POLICY_EN.enforce_all(en_texts)
    cleaned_ko, tone_ko = _POLICY_KO.enforce_all(ko_texts)

    headline_en_c, p1_en_c, p2_en_c, p3_en_c, p4_en_c, why_en_c = cleaned_en
    headline_ko_c, p1_ko_c, p2_ko_c, p3_ko_c, p4_ko_c              = cleaned_ko

    stance_final = dict(stance_raw)
    stance_final["why"] = why_en_c

    # ── Assemble payload ─────────────────────────────────────────────────────
    payload: Dict[str, Any] = {
        "generated_at": now_iso(),
        "as_of_date":   as_of_date,
        "data_date":    as_of_date,   # backward compat
        "lang":         ["ko", "en"],
        "headline": {
            "ko": headline_ko_c,
            "en": headline_en_c,
        },
        "paragraphs": {
            "ko": [
                {"id": "price_action", "title": "가격 흐름",    "text": p1_ko_c},
                {"id": "risk_regime",  "title": "리스크 구간",  "text": p2_ko_c},
                {"id": "trend_context","title": "추세·폭",      "text": p3_ko_c},
                {"id": "positioning",  "title": "포지셔닝 맥락","text": p4_ko_c},
            ],
            "en": [
                {"id": "price_action", "title": "Price Action",      "text": p1_en_c},
                {"id": "risk_regime",  "title": "Risk Regime",       "text": p2_en_c},
                {"id": "trend_context","title": "Trend & Breadth",   "text": p3_en_c},
                {"id": "positioning",  "title": "Positioning Context","text": p4_en_c},
            ],
        },
        "bullets": {
            "ko": _build_bullets_ko(tape, ms, health),
            "en": _build_bullets_en(tape, ms, health),
        },
        "stance": stance_final,
        "tone_check": {
            "ko": tone_ko,
            "en": tone_en,
        },
    }

    os.makedirs(cache, exist_ok=True)
    out_path = os.path.join(cache, "daily_briefing.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    ok_en = tone_en["tone_ok"]
    ok_ko = tone_ko["tone_ok"]
    status = "OK" if (ok_en and ok_ko) else "WARN"
    print(f"[{status}] {out_path}")
    if not ok_en:
        print(f"  EN violations ({len(tone_en['violations'])}):")
        for v in tone_en["violations"]:
            print(f"    - {v}")
    if not ok_ko:
        print(f"  KO violations ({len(tone_ko['violations'])}):")
        for v in tone_ko["violations"]:
            print(f"    - {v}")
    if ok_en and ok_ko:
        print("  tone_check: clean (ko + en)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
