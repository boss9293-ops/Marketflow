from __future__ import annotations


def build_positioning(flow: list[str], reaction: list[str]) -> str:
    if "tech_focus" in flow and "tech_underperformance" in reaction:
        return "대형 기술주 중심 매수는 유지되지만 단기 차익실현이 나타나는 구간"

    if "macro_driven" in flow and "rate_pressure" in reaction:
        return "금리 방향성 불확실성으로 포지션이 축소되는 구간"

    if "narrow_leadership" in flow:
        return "시장 상승이 일부 종목에 집중된 비정상적 구조"

    return "포지션 중립 구간"
