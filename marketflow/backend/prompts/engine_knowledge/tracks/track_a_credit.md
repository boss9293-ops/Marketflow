# Track A — Credit / Transmission Knowledge Layer

> Version: WO-TA1 | Engine: Terminal-X | Layer: Engine Knowledge

---

## 1. Definition

Track A는 시장 리스크가 **전염(Transmission)**되는지를 판단하는 레이어다.

MSS가 "시장이 얼마나 건강한가"를 측정하고,
Track B가 "얼마나 빠르게 변화하는가"를 측정한다면,
Track A는 **"리스크가 한 영역에서 다른 영역으로 구조적으로 확산되고 있는가"**를 판단한다.

### 핵심 명제
- 단순 주가 조정(Equity 내부 문제)과 구조적 전염(Credit/Funding 도달)은 본질적으로 다르다
- Credit 노드에 도달하면 → 더 이상 단순 조정이 아니다
- Funding 노드에 도달하면 → 금융 시스템 자체가 압박받는 상태다

### Track B와의 차이
| 구분 | Track A (Credit/Transmission) | Track B (Velocity) |
|------|-------------------------------|-------------------|
| 측정 대상 | 리스크 전염 범위 / 깊이 | 리스크 변화 속도 |
| 핵심 질문 | "어디까지 퍼졌는가?" | "얼마나 빠르게 퍼지는가?" |
| 위험 성격 | 구조적 (깊고 지속적) | 속도적 (빠르고 즉각적) |
| 단독 신뢰도 | 높음 (구조 확인 가능) | 낮음 (노이즈 가능) |
| 결합 효과 | Track B 결합 시 "빠른 전염" 최상위 위험 | Track A 결합 시 신호 신뢰도 강화 |

**원칙**: Track A는 MSS보다 우선 설명 가능하다. Credit 이상 전염 확인 시 즉시 구조 리스크로 격상한다.

---

## 2. Transmission Levels

### L0 — Isolated
- **의미**: 리스크가 Equity 내부에 격리되어 있음. 전염 없음
- **전염 범위**: Equity 내부
- **위험 수준**: 없음 (일반적 조정 범위)
- **해석 키워드**: 격리된 조정, 전염 미감지, 구조 정상
- **특징**: HY 스프레드 안정, TED Spread 정상, Funding 시장 이상 없음

### L1 — Early Transmission
- **의미**: Equity 압박이 Credit의 경계면에 접촉 시작. 전염 초기 신호
- **전염 범위**: Equity → Credit 경계
- **위험 수준**: 낮음 (감시 개시)
- **해석 키워드**: 전염 초기 신호, Credit 경계 접촉, 구조 변화 가능성
- **특징**: HY 스프레드 소폭 확대, IG 스프레드 안정, 아직 Funding 영향 없음

### L2 — Credit Stress
- **의미**: 리스크가 Credit 노드로 전염됨. 구조 리스크 확인
- **전염 범위**: Equity → Credit (확인)
- **위험 수준**: 중간~높음 (구조 리스크 격상)
- **해석 키워드**: 구조 리스크 확인, 신용 스프레드 확대, 단순 조정 종료 선언
- **특징**: HY 스프레드 급등, CDS 상승, 기업 신용 악화 확산

### L3 — Funding Stress
- **의미**: Credit 압박이 Funding/Banks 노드로 확산. 금융 시스템 압박 시작
- **전염 범위**: Equity → Credit → Funding (확인)
- **위험 수준**: 높음 (시스템 리스크 선언)
- **해석 키워드**: 시스템 리스크 진입, 자금조달 경색, 금융기관 압박
- **특징**: TED Spread 급등, FRA-OIS 확대, SOFR 스파이크, 은행 간 신뢰 하락

### L4 — Systemic Risk
- **의미**: Full Cascade 진행 중. Funding → Liquidity 도달, 전방위 유동성 소멸
- **전염 범위**: Equity → Credit → Funding → Liquidity (전 경로)
- **위험 수준**: 극단 (생존 모드)
- **해석 키워드**: 전방위 전염, 유동성 소멸, 패닉 연쇄, 강제 청산
- **특징**: 자산 간 상관관계 1 수렴, 달러 급등, 마진콜 연쇄, 2008/2020-03 구조

---

## 3. Interaction Rules

### Rule 1 — MSS와 결합 시 (구조적 위험 강화)
| MSS 상태 | Track A Level | 해석 |
|----------|--------------|------|
| Healthy (110+) | L1 | 일시 접촉. 모니터링 유지 |
| Neutral (100~110) | L2 | 구조 리스크 확인. 포지션 조정 시작 |
| Risk (92~100) | L2 | 위험 증폭. MSS 악화 + 전염 동시 확인 |
| High Risk (<92) | L3 | 즉각 방어. 시스템 리스크 + 구조 악화 |
| Crisis (<84) | L3~L4 | 생존 모드. 전량 방어 전환 |

**원칙**: Track A가 L2 이상이면 MSS가 Healthy여도 포지션 조정을 시작한다.

### Rule 2 — Track B와 결합 시 (빠른 전염 위험)
- Track A L2 + Track B L3 = **빠른 구조 전염** → 즉각 A4 발동
- Track A L3 + Track B L3 이상 = **최상위 위험** → 즉시 A5 발동 검토
- 전염이 깊고(Track A 높음) 속도도 빠른(Track B 높음) 조합은 2008, 2020-03 패턴

```
Track A L3 + Track B L3 = 대응 시간 없음 → A5 즉시
```

### Rule 3 — Track C와 결합 시 (외부 충격 기반 확산)
- Track C(외부 충격): 지정학, 정책 충격, 블랙스완 등 외생 변수
- 외부 충격(Track C)이 Equity에 가해지고 Track A 전염이 확인되면 → 충격이 구조화되는 신호
- Track C 단독은 일시적일 수 있으나, Track A L2 이상 동반 시 → 구조 리스크로 격상

### Rule 4 — Transmission이 시작되면 MSS 우선순위 역전
- Track A L1 이하 → MSS 기반 해석 유지
- Track A L2 이상 → **Transmission 우선 서술**, MSS는 보조 지표로 격하

---

## 4. Action Mapping

| Level | Action Code | 행동 지침 |
|-------|-------------|-----------|
| L0 Isolated | **A1** | 정상 포지션 유지. TQQQ 보유 가능 |
| L1 Early Transmission | **A2** | 감시 강화. Credit 지표 집중 모니터링. 추가 매수 보류 |
| L2 Credit Stress | **A3** | 구조 리스크 확인. TQQQ 50% 이하. 현금 확보 시작 |
| L3 Funding Stress | **A4** | 시스템 리스크 선언. TQQQ 대부분 청산. 방어 자산 확보 |
| L4 Systemic Risk | **A5** | 생존 모드. 전량 현금/달러/단기채 전환. 신규 진입 금지 |

**결합 조건에 따른 Action 상향 조정:**
- Track A L2 + MSS Risk + Track B L3 → A3 → A4/A5 즉시 상향
- Track A L3 단독이라도 → A4 최소, A5 검토

---

## 5. TQQQ Implication

Track A는 TQQQ 보유에 있어 **가장 구조적인 위험 신호**다.
Velocity(Track B)가 속도 위험이라면, Track A는 **깊이 위험**이다.
전염이 구조화되면 회복에 시간이 걸리며, 그 기간 동안 TQQQ 보유는 지속적 손실로 이어진다.

### TQQQ 리스크 매트릭스

| Level | TQQQ 리스크 | 권고 |
|-------|------------|------|
| L0 | 정상 | 보유 가능 |
| L1 | 주의 | 추가 매수 보류 |
| L2 | **구조 리스크** | 절반 이하 축소. Credit 지속 감시 |
| L3 | **시스템 리스크** | 대부분 청산. Funding 회복 전 재진입 금지 |
| L4 | **극단 위험** | 전량 청산 / 유동성 회복 확인 전 재진입 금지 |

### L2 이상 핵심 원칙
> "Credit이 전염 경로에 포함된 순간,
> TQQQ 보유는 시간이 지날수록 불리해진다.
> 속도가 느려도 구조 전염은 지속된다.
> L2 이상에서 TQQQ 보유 연장은 단기 반등 기대가 아닌
> 구조 회복을 확인한 후로 미뤄야 한다."

### Funding 포함(L3+) 핵심 원칙
> "Funding 노드가 압박받으면 시장 전반의 레버리지 해소가 강제 실행된다.
> TQQQ를 포함한 모든 레버리지 자산은 강제 청산 대상이 될 수 있다.
> 자발적 청산이 강제 청산보다 항상 낫다."

---

## 6. Narrative Rules

### 작성 원칙
1. **전염 흐름 중심 서술**: "하락했다" 금지 → "Equity에서 Credit으로 전염되고 있다" 형식
2. **방향 + 범위 명시**: "어디서 → 어디로, 어느 수준까지" 반드시 포함
3. **구조 변화 강조**: "단순 조정이 아니다"를 명확히 구분
4. **상태 레이블 금지**: "L2입니다" 금지. 흐름과 의미로 설명

### Narrative 금지 패턴
- "Credit Stress입니다" (레이블 나열 금지)
- "HY 스프레드가 X bp 확대되었습니다" (숫자 나열보다 의미 우선)
- "시장이 하락했습니다" (전염 개념 없는 서술)

---

## 7. Narrative Examples

### Example 1 — L0 Isolated
> "현재 Equity 시장의 하락 압력이 Credit 영역으로 전염되고 있지 않습니다.
> 이번 하락은 Equity 내부에 격리된 조정으로 판단됩니다.
> 구조적 위험 신호가 없으며, MSS 중심으로 해석을 유지합니다."

### Example 2 — L2 Credit Stress
> "Equity에서 발생한 하락 압력이 Credit 노드로 전염되고 있습니다.
> HY 스프레드 확대가 확인되며, 이는 단순 주가 조정이 아닌 구조 리스크의 시작을 의미합니다.
> TQQQ 포지션을 절반 이하로 축소하고, Funding 노드로의 추가 전염 여부를 집중 감시합니다."

### Example 3 — L3 Funding Stress
> "Credit에서 시작된 압박이 Funding 시스템으로 확산되고 있습니다.
> 금융기관 자금조달 시장이 경색 조짐을 보이며, 이는 시스템 리스크 진입을 의미합니다.
> TQQQ를 포함한 레버리지 포지션 대부분을 즉각 청산하고 방어 자산을 확보합니다.
> Funding 시장이 안정화되기 전까지 레버리지 재진입은 금지합니다."

### Example 4 — L4 Systemic + Track B L3 결합
> "Equity → Credit → Funding → Liquidity 전 경로에 걸쳐 리스크 전염이 진행 중입니다.
> 동시에 시장 변화 속도가 급격히 빨라지고 있어 대응 시간이 매우 부족합니다.
> 이는 구조 전염과 속도 위험이 동시에 발생하는 최상위 위험 조합입니다.
> 모든 레버리지 자산을 즉각 청산하고 현금/달러/단기채로 전환합니다.
> 유동성 회복이 명확히 확인되기 전까지 신규 진입을 금지합니다."

---

## 8. Integration Points

| 연동 대상 | 역할 |
|-----------|------|
| Transmission Map | Track A Level = Transmission State 직접 연동 |
| MSS | L2 이상 시 Track A가 MSS보다 우선 서술 |
| Track B (Velocity) | 전염 속도 결합 → 최상위 위험 판정 |
| Track C (External) | 외부 충격이 구조화되는지 여부 확인 |
| TQQQ Strategy Engine | Action Code A1~A5 직접 연동 |
| AI Briefing V2 | Narrative 생성 시 전염 흐름 중심 서술 적용 |

---

*WO-TA1 | Terminal-X Engine Knowledge Layer | 2026-03*
