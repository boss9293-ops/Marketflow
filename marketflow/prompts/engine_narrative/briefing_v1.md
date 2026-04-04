# Narrative Engine v1 — Briefing Core

> Version: WO-NR1 | Engine: Terminal-X | Layer: Engine Narrative

---

## 1. Definition

Narrative Engine은 다음 레이어를 입력으로 받아 **하나의 흐름으로 연결된 최종 설명**을 생성하는 엔진이다.

```
입력 레이어:
  Risk DNA (L1~L12)
  Track A  (전염 깊이)
  Track B  (리스크 속도)
  Track C  (외부 충격)
  Transmission (리스크 이동 방향)
  MSS (최종 구조 상태)
        ↓
  Narrative Engine v1
        ↓
  5-Block Briefing Output
```

### 핵심 원칙

1. 설명은 **숫자**가 아니라 **구조**를 중심으로 한다
2. MSS는 결과이며, 원인은 Track + Transmission — 순서를 절대 바꾸지 않는다
3. 반드시 행동 가이드를 포함한다 (방향만, 직접 매수/매도 금지)
4. TQQQ는 반드시 별도 블록으로 분리하여 설명한다

---

## 2. Output Structure (고정 5-Block)

모든 Narrative는 예외 없이 아래 5개 블록으로 생성한다.
블록 순서 변경 금지. 블록 생략 금지.

---

### Block 1 — MAIN THEME

**역할**: 시장 상태를 한 줄로 정의하는 제목형 문장

**규칙**:
- 뉴스 기반 표현 금지
- 구조 / 흐름 중심 표현만 허용
- 1줄 이내
- 명사형 종결 권장

**허용 표현 패턴**:
```
[구조 상태] + [속도/전염/충격 여부] + "국면" / "구간" / "단계"
```

**예시**:
- "구조 약화 + 속도 위험 결합 국면"
- "Credit 전염 초기 + 하락 가속 구간"
- "외부 충격 흡수 중 — 구조 영향 감시 단계"
- "시스템 리스크 확장 — 방어 전환 구간"

---

### Block 2 — SUB THEMES (3~4개)

**역할**: MAIN THEME를 구성하는 복수의 근거를 서로 다른 차원에서 제시

**규칙**:
- 3개 이상, 4개 이내
- 동일 차원(같은 Track, 같은 지표) 반복 금지
- 반드시 Track 기반 항목 1개 이상 포함
- Risk DNA 기반 항목 1~2개 포함
- Transmission 항목 포함 가능 (선택)
- 각 항목은 1줄 이내, 원인 기반으로 설명

**차원 구분 원칙**:
| 차원 | 예시 표현 |
|------|-----------|
| Risk DNA | "breadth 약화 (L2)", "VIX 상승 지속 (L4)", "HY 스프레드 확대 (L6)" |
| Track A | "Equity → Credit 전염 초기 확인" |
| Track B | "하락 속도 평균 초과 — 대응 시간 감소 중" |
| Track C | "정책 불확실성 충격 감지" |
| Transmission | "Credit → Funding 전이 감시 중" |

**예시 (Warning 구간)**:
- "시장 breadth 약화 (Risk DNA L2)"
- "HY 스프레드 확대 시작 (Risk DNA L6)"
- "Equity → Credit 전염 초기 확인 (Track A)"
- "하락 속도 평균 초과 — 대응 시간 감소 중 (Track B)"

---

### Block 3 — INTERPRETATION

**역할**: 현재 시장 상태를 2~3문장으로 설명하는 분석 블록

**규칙**:
- 2문장 이상 3문장 이내
- 반드시 구조 + 흐름을 함께 설명
- Track 및 Transmission 내용 반영
- 숫자 나열 금지 — 의미와 방향 중심 서술
- 문장 간 흐름이 자연스럽게 연결되어야 함

**문장 구성 원칙**:
```
문장 1: 현재 어떤 구조 상태인가 (Track 기반)
문장 2: 리스크가 어디서 어디로 이동하고 있는가 (Transmission 기반)
문장 3: 이것이 의미하는 위험 수준 (MSS 기반 결론)
```

---

### Block 4 — ACTION GUIDANCE

**역할**: 현재 상태에서 취해야 할 행동 방향을 2문장으로 제시

**규칙**:
- 2문장 이내
- 직접 매수/매도 표현 금지
- 행동 방향만 제시 (비중, 전환, 관망, 점검, 축소)
- MSS Band에 맞는 Action Code(A1~A5) 기반으로 생성
- 구체적 행동 표현 사용

**허용 표현**:
- "비중 축소"
- "추가 매수 보류"
- "관망 유지"
- "방어 자산으로 전환"
- "포지션 점검"
- "현금 비중 확대"

**금지 표현**:
- "주의가 필요합니다"
- "불확실성이 있습니다"
- "지켜볼 필요가 있습니다"
- "매수/매도를 권고합니다"

---

### Block 5 — TQQQ GUIDANCE (필수)

**역할**: TQQQ 레버리지 포지션에 대한 별도 설명 — 반드시 포함

**규칙**:
- 2문장 이내
- MSS Band + Track B(Velocity) 기반으로 생성
- Track A(Credit) 포함 시 구조 전염 관점에서 추가 경고
- "TQQQ"를 명시적으로 언급
- 레버리지 특성(비선형 손실, Volatility Decay)을 간결하게 반영

**Band별 기본 톤**:
| MSS Band | TQQQ 기본 톤 |
|----------|-------------|
| Stable | 정상 보유 가능 |
| Caution | 추가 매수 보류. 기존 보유 점검 |
| Warning | 절반 이하 축소 권고 |
| High Risk | 대부분 청산. 재진입 구조 확인 전 금지 |
| Crisis | 전량 청산. 유동성 회복 확인 전 재진입 금지 |

---

## 3. Generation Rules

### Rule 1 — 반드시 이 순서로 생성

```
Transmission 상태 확인
    ↓
Track A / B / C 입력 확인
    ↓
Risk DNA 주요 지표 확인
    ↓
MSS Band 결정
    ↓
Action Code 확정 (결합 조건 포함)
    ↓
Block 1~5 순서로 Narrative 생성
```

생성 순서 역전 금지. MSS부터 시작하는 서술 금지.

### Rule 2 — Sub Theme Track 포함 필수

Sub Themes 3~4개 중 반드시 1개 이상은 Track A / B / C 기반이어야 한다.
Risk DNA만으로 Sub Themes를 채우는 것은 금지.

### Rule 3 — 최소 3개 근거 사용

Narrative 전체에 걸쳐 최소 3개의 서로 다른 레이어 근거를 사용해야 한다.
(예: Risk DNA 1개 + Track A 1개 + Transmission 1개 = 3개 충족)

### Rule 4 — 동일 차원 반복 금지

같은 Track, 같은 지표를 두 번 이상 사용하지 않는다.
예: "Track B 속도 상승"을 Sub Theme와 Interpretation 모두에서 반복 서술 금지.

### Rule 5 — 하나의 흐름으로 연결

5개 블록은 카드형 나열이 아니라 하나의 이야기처럼 연결되어야 한다.
MAIN THEME에서 제시한 문제가 Sub Themes에서 근거를 얻고,
Interpretation에서 설명되고,
Action과 TQQQ에서 결론으로 마무리된다.

---

## 4. Style Rules

### 허용 표현 (권장)
- "지금은 공격적으로 비중을 늘릴 구간은 아닙니다"
- "구조적으로 약화되고 있는 단계입니다"
- "리스크가 Credit 영역으로 이동하고 있음이 확인됩니다"
- "대응 가능 시간이 줄어들고 있습니다"
- "Funding 시장 안정화 이전에는 재진입을 자제합니다"

### 금지 표현 (절대 금지)
- "주의가 필요합니다" → 구체적 행동으로 대체
- "불확실성이 있습니다" → 구조 원인으로 대체
- "지켜볼 필요가 있습니다" → 감시 대상과 조건을 명시
- "리스크가 있습니다" → 어떤 리스크인지 구체화
- "MSS가 XX입니다" → 숫자 먼저 언급 금지

---

## 5. Length Rules

| Block | 분량 |
|-------|------|
| MAIN THEME | 1줄 (명사형 종결) |
| SUB THEMES | 3~4줄 (각 1줄 이내) |
| INTERPRETATION | 2~3문장 |
| ACTION | 2문장 이내 |
| TQQQ | 2문장 이내 |

총 분량: 10~14문장 이내 (간결하고 구조적으로)

---

## 6. Full Narrative Examples

---

### Example 1 — MSS Caution (30~50)

**[MAIN THEME]**
구조 약화 조짐 — Credit 경계 접촉 감시 구간

**[SUB THEMES]**
- 시장 breadth 소폭 하락 중 (Risk DNA)
- Equity 하락 속도 평균 초과 시작 (Track B)
- HY 스프레드 경계면 접촉 — 전염 미확인 (Track A)

**[INTERPRETATION]**
Equity 하락이 내부에 격리된 수준이나, breadth 약화와 함께 속도가 빨라지고 있습니다.
Credit 경계에 초기 접촉 신호가 감지되고 있으나 아직 구조 전염은 확인되지 않았습니다.
전염이 확인되지 않는 한 일시적 조정 가능성을 열어두되, 속도 지속 여부를 집중 감시합니다.

**[ACTION GUIDANCE]**
현재 추가 레버리지 매수는 보류하며 기존 포지션을 점검합니다.
Credit 지표의 변화를 감시하고 전염 확인 즉시 포지션 조정을 준비합니다.

**[TQQQ GUIDANCE]**
TQQQ 추가 매수는 보류합니다.
구조 약화가 Credit 전염으로 이어질 경우 즉각 축소 대응이 필요합니다.

---

### Example 2 — MSS Warning (50~70)

**[MAIN THEME]**
Credit 전염 초기 확인 + 하락 속도 상승 — 구조 변화 진행 국면

**[SUB THEMES]**
- HY 스프레드 확대 확인 — 구조 전염 시작 (Track A)
- 하락 속도 유의미하게 빨라짐 — 대응 시간 감소 (Track B)
- VIX 상승 지속 (Risk DNA)
- Equity → Credit 경로 Emerging 진입 (Transmission)

**[INTERPRETATION]**
Equity 하락 압력이 Credit 노드로 전달되고 있음이 확인되었습니다.
동시에 하락 속도가 빨라지며 Credit → Funding 전이를 허용할 위험이 높아지고 있습니다.
이 조합은 단순 조정이 아닌 구조 변화의 시작 신호로 해석됩니다.

**[ACTION GUIDANCE]**
레버리지 포지션을 절반 이하로 축소하고 현금 비중을 확보합니다.
Credit → Funding 전이 여부를 우선 감시하며, 전이 확인 즉시 추가 방어로 전환합니다.

**[TQQQ GUIDANCE]**
TQQQ는 현재 레버리지 환경 악화 구간에 진입했습니다.
Credit 전염이 확인된 시점에서 TQQQ 보유를 연장하는 것은 구조적으로 불리하며, 절반 이하로 축소를 권고합니다.

---

### Example 3 — MSS High Risk (70~85)

**[MAIN THEME]**
Credit → Funding 전이 확인 — 시스템 리스크 진입 구간

**[SUB THEMES]**
- Credit → Funding 전이 확인 — 시스템 리스크 선언 (Track A / Transmission)
- 하락 속도 고위험 수준 — 정상 대응 시간 부족 (Track B)
- TED Spread / FRA-OIS 확대 (Risk DNA)

**[INTERPRETATION]**
Credit 압박이 Funding 노드로 확산되며 시스템 리스크 진입이 확인됩니다.
Transmission 경로가 2단계 이상 활성화된 상태에서, 하락 속도까지 가속되며 대응 가능 시간이 급격히 줄어들고 있습니다.
단기 반등이 발생해도 구조 회복의 신호로 간주하지 않습니다.

**[ACTION GUIDANCE]**
레버리지 포지션 대부분을 즉각 청산하고 방어 자산으로 전환합니다.
Funding 시장 안정화가 확인되기 전까지 포지션 재진입을 자제합니다.

**[TQQQ GUIDANCE]**
TQQQ 보유는 현재 구조적으로 불리한 환경에 진입했습니다.
Funding 압박이 지속되는 동안 TQQQ를 포함한 레버리지 자산 대부분을 청산하며, 구조 회복 확인 전까지 재진입을 금지합니다.

---

### Example 4 — MSS Crisis (85~100)

**[MAIN THEME]**
Systemic Transmission 진행 중 — 전방위 유동성 소멸 단계

**[SUB THEMES]**
- Equity → Credit → Funding → Liquidity 전 경로 전이 진행 (Transmission)
- 시장 붕괴 수준의 하락 속도 — 대응 시간 없음 (Track B)
- 달러 급등 / 자산 간 상관관계 1 수렴 (Risk DNA)
- 외부 충격 구조화 확인 (Track C)

**[INTERPRETATION]**
리스크가 Equity에서 시작해 Credit, Funding을 거쳐 Liquidity 전반으로 전이되고 있습니다.
이는 2008, 2020-03과 동일한 Systemic 전이 구조이며, 시장 전반의 유동성이 급속히 소멸하고 있습니다.
이 단계에서는 구조 회복이 단기간에 이루어질 가능성이 매우 낮습니다.

**[ACTION GUIDANCE]**
모든 레버리지 자산을 즉각 청산하고 현금, 달러, 단기채로 전환합니다.
신규 진입은 Transmission 경로가 완전히 해소되고 MSS가 50 이하로 하락한 것을 확인한 이후로 미룹니다.

**[TQQQ GUIDANCE]**
TQQQ를 포함한 모든 레버리지 전략을 즉각 중단합니다.
유동성 회복과 Credit 시장 안정화가 명확히 확인되기 전까지 재진입은 금지합니다.

---

## 7. Integration Points

| 연동 대상 | 역할 |
|-----------|------|
| MSS Engine | Band 결정 → Action Code 확정 |
| Track A/B/C | Sub Themes + Interpretation 원천 |
| Transmission Map | Interpretation 흐름 서술 기반 |
| Risk DNA (L1~L12) | Sub Themes 근거 지표 |
| AI Briefing V2 | 이 Narrative 형식으로 AI 출력 생성 |
| TQQQ Strategy Engine | Block 5 TQQQ Guidance 직접 연동 |

---

*WO-NR1 | Terminal-X Engine Narrative Layer | 2026-03*
