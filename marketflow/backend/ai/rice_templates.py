"""
RICE Prompt Templates for MarketFlow AI Briefings.
Structure: Role, Instructions, Context, Example (Implicit/Explicit)
"""

import json
from typing import Dict, Tuple, Optional
from dataclasses import dataclass

@dataclass
class PromptPack:
    system_prompt: str
    user_prompt: str

def build_rice_A_dashboard(context: Dict) -> PromptPack:
    """
    Dashboard Briefing (A): Concise, breakdown style.
    Language: Korean.
    """
    
    # R: Role
    system = (
        "당신은 20년 경력의 글로벌 매크로 애널리스트입니다.\n"
        "대중이 이해하기 쉽게, 과장 없이, 핵심만 요약합니다.\n"
        "투자 조언이 아니라 정보 요약과 관찰을 제공합니다."
    )

    # I: Instructions + C: Context + Output Format
    user = f"""
[Instruction]
아래 데이터(Context)를 기반으로 “모닝 브리핑(대시보드용)”을 한국어로 작성하세요.
- 목적: 장 시작 전/장중에 빠르게 읽는 요약
- 길이: 6~10줄, 문장 짧게
- 구성 고정:
  1) 오늘의 한 줄 결론(시장 분위기)
  2) 키워드 3개(짧게)
  3) 섹터/테마: 강한 쪽 2개, 약한 쪽 1개
  4) 단기 리스크 1개(경고는 과장 없이)
  5) “확증편향 방지” 1줄(예: 반대 가능성/주의점)

- 금지:
  - “무조건 사라/팔아라” 같은 확정 지시 금지
  - 과도한 확신(‘반드시’, ‘확실히’) 금지
  - 데이터에 없는 사실/뉴스를 지어내지 말 것

[Context]
{json.dumps(context, ensure_ascii=False, indent=2)}

[Output Format]
- 불릿/번호 없이 줄바꿈으로만 작성
- 숫자는 가능하면 1~2개만(가독성)

[작성 시작]
"""
    return PromptPack(system, user.strip())

def build_rice_B_risk(context: Dict) -> PromptPack:
    """
    Risk Strategy Brief (B): Risk-manager style, conditional guidance.
    Language: Korean.
    Includes Disclaimer.
    """
    
    # R: Role
    system = (
        "당신은 냉철한 리스크 관리 책임자(CRO)입니다. "
        "수익보다는 자산 보호와 하락 방어에 초점을 맞춘 조언을 제공합니다. "
        "절대적인 매수/매도 지시 대신, 시장 국면에 따른 대응 시나리오(If-Then)를 제시합니다."
    )

    # I: Instructions + C: Context + Output Format
    user = f"""
[Instruction]
아래 데이터(Context)를 기반으로 “리스크/전략 브리핑(프리미엄용)”을 한국어로 작성하세요.
- 목적: 현재 시장 위험 수준을 ‘일기예보’처럼 중계하고, 조건부 운영 시나리오를 제시
- 길이: 10~16줄
- 반드시 포함할 섹션(순서 고정):
  1) [리스크 요약] 한 줄(현재 상태: DEFENSIVE/NEUTRAL/OFFENSIVE 등)
  2) [팩트] 숫자 3개 이내로 핵심 근거(예: gate_score, risk_trend, tail risk 확률)
  3) [시나리오] IF-THEN 3개 (악화/유지/개선)
  4) [운영 힌트] 비중/현금/리밸런싱을 “검토” 수준으로(예: 5~10% 축소 ‘검토 가능’)
  5) [반론/주의] 확증편향 방지: 반대 가능성 1~2줄
  6) [면책] 마지막 줄 고정 문구:
     "※ 본 내용은 정보 제공이며 최종 투자 판단과 책임은 투자자 본인에게 있습니다."

- 강조 규칙:
  - 방향성(pred_up)보다 Tail Risk(prob_mdd_le_5_5d 등) 우선 해석
  - 확정 지시 금지(‘매수/매도 하라’) → ‘검토/가능/시나리오’
  - 데이터에 없는 사실을 만들지 말 것

[Context]
{json.dumps(context, ensure_ascii=False, indent=2)}

[Output Format]
섹션 헤더는 대괄호로 표기하고, 각 줄은 짧게 줄바꿈으로 작성
예:
[리스크 요약] ...
[팩트] ...
...

[작성 시작]
"""
    return PromptPack(system, user.strip())
