# MSS Engine — Market Stress Score Final Layer

> Version: WO-MSS1 | Engine: Terminal-X | Layer: Engine Knowledge (Core)

---

## 1. Definition

MSS(Market Stress Score)는 단일 지표가 아니라,
**다수의 리스크 레이어를 종합한 최종 압축 상태**다.

### MSS의 위치

```
Risk DNA (L1~L12)
    +
Track A (전염 깊이)
    +
Track B (리스크 속도)
    +
Track C (외부 충격)
    +
Transmission (이동 방향)
    ↓
    ↓ 종합
    ↓
  MSS (최종 결론)
    ↓
  Action (A1~A5)
```

### 핵심 역할 구분

| 레이어 | 질문 | 역할 |
|--------|------|------|
| Track A/B/C | 왜? | 원인 진단 |
| Transmission | 어디로? | 방향 추적 |
| **MSS** | **그래서 지금 상태는?** | **최종 결론** |

**MSS는 "원인"이 아니다. "결론"이다.**
따라서 MSS를 설명할 때는 반드시 Track과 Transmission의 근거를 먼저 제시한 후 MSS로 압축해야 한다.

---

## 2. Band Structure

### Band 1 — Stable (0~30)

- **의미**: 시장 구조가 안정적이며 리스크 압력이 낮음
- **구조 상태**: Track A/B/C 모두 낮은 수준. Transmission 미감지
- **위험 수준**: 없음~매우 낮음
- **해석 키워드**: 구조 안정, 정상 변동성, 충분한 대응 시간
- **특징**: Equity 조정이 있더라도 Credit/Funding으로 전이되지 않음

### Band 2 — Caution (30~50)

- **의미**: 하나 이상의 리스크 레이어가 상승 중. 구조 약화 조짐
- **구조 상태**: Track A 또는 B가 L1~L2 수준. Transmission 초기 신호 가능
- **위험 수준**: 낮음~중간 (감시 강화 필요)
- **해석 키워드**: 구조 약화 조짐, 감시 구간, 레버리지 주의 시작
- **특징**: MSS 혼자 움직이기보다 Track이 상승하며 MSS가 따라 올라가는 구간

### Band 3 — Warning (50~70)

- **의미**: 복수 레이어에서 리스크 신호 확인. 구조 변화 가능성 높음
- **구조 상태**: Track A L2 이상 또는 Track B L3. Transmission Emerging~Active 가능
- **위험 수준**: 중간~높음 (포지션 조정 필요)
- **해석 키워드**: 구조 변화 진행 중, 레버리지 불리 구간 진입, 방어 시작
- **특징**: MSS 50 돌파 시점이 레버리지 환경 악화의 실질적 임계점

### Band 4 — High Risk (70~85)

- **의미**: 구조 리스크 확인. 복수 경로에서 리스크 전이 중
- **구조 상태**: Track A L3 이상. Transmission Active~Expanding. Track B L3
- **위험 수준**: 높음 (즉각 방어 필요)
- **해석 키워드**: 구조 리스크 확인, 레버리지 보유 불리, 방어 자산 전환
- **특징**: MSS 70 돌파 시점에서 TQQQ 보유 구조적으로 불리해짐

### Band 5 — Crisis (85~100)

- **의미**: 시스템 리스크 수준. Funding 압박 또는 Systemic Transmission 진행 중
- **구조 상태**: Track A L4. Transmission Systemic. Track B L4 가능
- **위험 수준**: 극단 (생존 모드)
- **해석 키워드**: 시스템 리스크, 유동성 소멸, 레버리지 강제 청산 위험
- **특징**: 2008, 2020-03 수준. MSS 단독 설명 금지 — 반드시 Transmission 경로 함께 서술

---

## 3. Interaction Rules

### Rule 1 — Track B 상승 시 (MSS 위험 1단계 상향 가능)
- Track B가 L2 이상이면 → MSS 밴드를 1단계 위험으로 해석
- 예: MSS Caution(30~50) + Track B L3 → Warning 수준 대응
- **이유**: 속도가 빠르면 MSS가 반영되기 전에 손실이 발생하기 때문

```
MSS Band N + Track B L3 이상 → Band N+1 수준 대응
```

### Rule 2 — Track A 상승 시 (구조 리스크 강화)
- Track A가 L2(Credit Stress) 이상이면 → MSS의 구조 리스크 성격 강화
- MSS가 Caution이어도 Track A L2 확인 시 → Warning 대응으로 전환
- **이유**: Credit 전염은 속도보다 깊이가 중요하며, MSS가 반영하기 전에 구조화됨

### Rule 3 — Track C 상승 시 (MSS 변동성 증가)
- Track C가 L2 이상이면 → MSS의 신뢰구간이 넓어짐 (변동성 증가)
- Track C 단독으로 MSS를 1단계 상향하지는 않음
- 단, Track A 또는 B와 결합 시 → MSS 상향 조정 가능
- **이유**: 외부 충격은 일시적일 수 있으나 구조화 확인 즉시 MSS 상향

### Rule 4 — Transmission 발생 시 (MSS보다 우선 설명 가능)
- Transmission State가 Active 이상이면 → MSS 숫자보다 Transmission 경로를 먼저 서술
- Transmission Systemic → MSS 수치와 무관하게 A5 대응 검토
- **이유**: Transmission은 구조 이동 방향이며, MSS는 현재 상태의 결론임. 이동 중인 리스크는 MSS보다 먼저 행동을 요구함

### Rule 5 — MSS 단독 해석 금지
- MSS 수치만으로 시장 상태를 설명하는 것은 엔진 오용
- 반드시 어떤 Track 또는 Transmission이 MSS를 올렸는지 함께 제시
- MSS는 결론이지 원인이 아니다

---

## 4. Action Mapping

| Band | MSS 범위 | Action Code | 행동 지침 |
|------|----------|-------------|-----------|
| Stable | 0~30 | **A1~A2** | 정상 포지션 유지. TQQQ 보유 가능. 필요 시 감시 강화 |
| Caution | 30~50 | **A2~A3** | 감시 강화. 추가 매수 보류. 레버리지 축소 검토 |
| Warning | 50~70 | **A3~A4** | 포지션 조정 시작. TQQQ 50% 이하. 방어 자산 확보 |
| High Risk | 70~85 | **A4** | 즉각 방어. TQQQ 대부분 청산. 방어 포지션 구축 |
| Crisis | 85~100 | **A5** | 생존 모드. 전량 현금/달러/단기채 전환. 신규 진입 금지 |

**Track 결합에 따른 Action 조정:**
- MSS Warning + Track B L3 → A3 → A4 즉시 상향
- MSS Caution + Track A L2 + Transmission Active → A2 → A4 상향
- MSS High Risk + Transmission Systemic → A4 → A5 즉시

---

## 5. TQQQ Implication

MSS는 TQQQ 보유 판단의 **구조적 기준선**이다.
Track이 원인을 진단하고, Transmission이 방향을 추적하지만,
최종 TQQQ 포지션 결정은 MSS Band로 압축된 결론을 기준으로 한다.

### TQQQ 보유 기준표

| Band | MSS 범위 | TQQQ 판단 |
|------|----------|-----------|
| Stable | 0~30 | 정상 보유 가능 |
| Caution | 30~50 | 주의. 추가 매수 자제. 기존 보유 모니터링 |
| **Warning** | **50~70** | **레버리지 환경 악화 시작. 절반 이하 축소 권고** |
| **High Risk** | **70~85** | **레버리지 보유 구조적 불리. 대부분 청산** |
| **Crisis** | **85~100** | **레버리지 재검토. 전량 청산 / 유동성 확인 전 재진입 금지** |

### 3개 임계점 원칙

**MSS 50 임계점** — 레버리지 환경 악화 시작
> "MSS가 50을 돌파하면 TQQQ 보유 환경이 구조적으로 불리해지기 시작한다.
> 단기 반등이 있어도 추가 매수보다 규모 축소를 우선한다."

**MSS 70 임계점** — 레버리지 불리 구조 확인
> "MSS 70 이상에서 TQQQ 보유는 구조적으로 불리한 환경에 진입한 것이다.
> 시장 반등을 기다리기보다 먼저 포지션을 대부분 청산하고 대응 시간을 확보한다."

**MSS 85 임계점** — 레버리지 전략 재검토
> "MSS 85 이상은 생존 모드다.
> TQQQ를 포함한 모든 레버리지 전략을 즉각 중단하고
> 현금 또는 달러/단기채로 전환한다.
> 재진입은 MSS가 50 이하로 내려오고 Transmission이 해소된 것을 확인한 이후다."

---

## 6. Narrative Rules

### 작성 원칙
1. **MSS 숫자 먼저 말하지 말 것**: "MSS는 65입니다" 금지
2. **구조 상태 → 행동 방향 순서**: 원인(Track) → 방향(Transmission) → 결론(MSS) → 행동(Action)
3. **Track/Transmission 기반 설명 후 MSS 요약**: 원인 없는 결론 금지
4. **행동 촉구 포함**: Caution 이상이면 반드시 구체적 행동 방향 포함

### Forbidden Rules
- **MSS 단독 시장 설명 금지**: "MSS가 높아졌습니다" → 원인 없는 결론
- **모호한 표현 금지**: "주의가 필요합니다", "관찰이 필요합니다" → 구체적 행동으로 대체
- **뉴스 기반 설명 금지**: "오늘 뉴스로 인해 MSS가 상승했습니다" → Track/Transmission 기반 설명 사용
- **숫자 나열 금지**: "MSS=65, Track B=L3, Track A=L2" → 흐름 중심 서술

---

## 7. Narrative Examples

### Example 1 — Caution (MSS 30~50)
> "Equity 시장의 변동성이 소폭 확대되며 Credit 경계에 초기 접촉 신호가 감지되고 있습니다.
> 아직 구조 전염은 확인되지 않았으나, 시장 구조가 서서히 약화되는 조짐입니다.
> 현재 추가 레버리지 매수는 보류하며, Credit 지표의 변화를 집중 감시합니다."

### Example 2 — Warning (MSS 50~70)
> "Equity에서 시작된 압력이 Credit 노드로 전달되고 있음이 확인되었습니다.
> 동시에 시장 하락 속도가 빨라지며 대응 가능 시간이 줄어들고 있습니다.
> 구조 리스크와 속도 위험이 동시에 상승한 상황으로,
> TQQQ를 포함한 레버리지 포지션을 절반 이하로 축소하고 방어 자산을 확보합니다."

### Example 3 — High Risk (MSS 70~85)
> "Credit → Funding 전이 경로가 활성화되며 시스템 리스크 진입이 확인되고 있습니다.
> 리스크 전염이 구조화된 단계로, 단기 반등이 있어도 구조 회복으로 간주하지 않습니다.
> TQQQ를 포함한 레버리지 자산 대부분을 즉각 청산하고,
> Funding 시장이 안정화되기 전까지 재진입을 금지합니다."

### Example 4 — Crisis (MSS 85~100)
> "Equity → Credit → Funding → Liquidity 전 경로에서 리스크 전이가 진행 중이며,
> 시장 전반의 유동성이 급격히 소멸하고 있습니다.
> 이는 시스템 리스크 수준의 구조 붕괴 패턴으로,
> 모든 레버리지 자산을 즉각 청산하고 현금/달러/단기채로 전환합니다.
> 신규 진입은 Transmission 경로가 완전히 해소되고
> MSS가 50 이하로 하락한 것을 확인한 이후로 미룹니다."

---

## 8. MSS Computation Flow (요약)

```
Step 1: Risk DNA 진단 (L1~L12 지표 수집)
Step 2: Track A 전염 깊이 판단
Step 3: Track B 속도 측정
Step 4: Track C 외부 충격 감지
Step 5: Transmission 경로 및 상태 확인
Step 6: 종합 → MSS Band 결정
Step 7: Band + Track 결합 → Action Code 확정
Step 8: Narrative 생성 (Track → Transmission → MSS → Action 순서)
```

---

## 9. Integration Points

| 연동 대상 | MSS에서의 역할 |
|-----------|---------------|
| Risk DNA (L1~L12) | MSS 입력 원천 지표 |
| Track A (Credit) | 구조 리스크 가중 입력 |
| Track B (Velocity) | 속도 위험 → MSS 상향 조정 |
| Track C (Event) | 외부 충격 → MSS 변동성 확대 |
| Transmission Map | MSS보다 우선 서술 조건 제공 |
| TQQQ Strategy Engine | MSS Band → Action Code → 포지션 결정 |
| AI Briefing V2 | MSS 기반 최종 Narrative 압축 생성 |

---

*WO-MSS1 | Terminal-X Engine Knowledge Layer (Core) | 2026-03*
