# Transmission Map — Risk Flow Knowledge Layer

> Version: WO-TM1 | Engine: Terminal-X | Layer: Engine Knowledge

---

## 1. Definition

Transmission은 시장의 "현재 상태"가 아니라 **리스크가 어느 노드에서 출발해 어디로 이동하고 있는가**를 설명하는 구조 레이어다.

MSS(Market Structure Score)가 시장 건강도를 측정한다면,
Transmission은 **리스크 흐름의 방향과 속도**를 해석한다.

- Transmission이 활성화되면 → MSS보다 우선하여 설명 가능
- Transmission이 None이면 → MSS 중심으로 해석

---

## 2. Nodes

| Node | 설명 |
|------|------|
| **Equity** | 주식시장. 리스크의 최초 발화점 역할 |
| **Credit** | 신용시장 (HY Spread, IG Spread). 구조 리스크의 핵심 진단 노드 |
| **Funding / Banks** | 금융기관 자금조달 (TED Spread, FRA-OIS, SOFR). 시스템 압박의 실시간 측정점 |
| **Liquidity** | 시장 전반 유동성 (달러 강세, 금융 조건, 외화 흐름). 전방위 압박의 최종 도달점 |
| **Macro** | 실물경제 (경기 둔화, Fed, 금리, 고용). 외생 충격 입력 노드 |

---

## 3. Key Paths

### 경로 구조 원칙
- 경로가 길어질수록 위험 수준 상승
- Credit 노드 포함 시 → **구조 리스크** 판정
- Funding 노드 포함 시 → **시스템 리스크** 판정

### Path 1 — Equity → Credit
```
Equity ──→ Credit
```
- **의미**: 주가 하락 → 기업 신용 스프레드 확대
- **신호**: HY/IG 스프레드 확대, CDS 상승
- **판정**: 구조 리스크 초입

### Path 2 — Credit → Funding
```
Credit ──→ Funding / Banks
```
- **의미**: 신용 스프레드 확대 → 은행/기관 자금조달 압박
- **신호**: TED Spread 상승, FRA-OIS 확대, 단기 유동성 경색
- **판정**: 시스템 리스크 진입

### Path 3 — Funding → Liquidity
```
Funding / Banks ──→ Liquidity
```
- **의미**: 금융기관 자금조달 경색 → 시장 전반 유동성 소멸
- **신호**: 달러 급등, 자산 간 상관관계 1 수렴, 패닉 매도
- **판정**: 시스템 리스크 확장 / Systemic 임박

### Path 4 — Macro → Liquidity
```
Macro ──→ Liquidity
```
- **의미**: Fed 긴축 / 경기 충격 → 시장 유동성 조건 악화
- **신호**: 연준 금리 인상, QT 가속, 달러 강세 지속
- **판정**: 구조적 긴축 환경 → 레버리지 자산 전반 압박

### 복합 경로 (Full Cascade)
```
Equity → Credit → Funding → Liquidity
```
- 2008, 2020-03 수준의 Systemic 경로
- TQQQ 포함 전 레버리지 자산 전량 청산 검토

---

## 4. Transmission States

| State | 설명 | 활성 경로 수 |
|-------|------|-------------|
| **None** | 리스크 흐름 없음. 시장 정상 작동 | 0 |
| **Emerging** | 1개 경로 초입 신호 감지. 감시 개시 | 1 (초기) |
| **Active** | 1~2개 경로 확인. 구조 또는 시스템 리스크 중 하나 | 1~2 (확인) |
| **Expanding** | 2~3개 경로 동시 활성. 전이 속도 가속 | 2~3 |
| **Systemic** | Full Cascade 진행 중. 전방위 유동성 소멸 | 3~4 |

---

## 5. Interpretation Rules

### Rule 1 — 경로 길이 = 위험 수준
- 경로 1개: 주의 (모니터링)
- 경로 2개: 위험 (포지션 축소 검토)
- 경로 3개 이상: 시스템 리스크 (적극 방어)

### Rule 2 — Credit 포함 판정
- Credit 노드가 경로에 포함되면 → **구조 리스크** 선언
- 단순 Equity 하락과 다른 해석 적용

### Rule 3 — Funding 포함 판정
- Funding 노드가 경로에 포함되면 → **시스템 리스크** 선언
- 2008, 2020-03 유형의 위기 경로와 동일 구조

### Rule 4 — Macro 진입 판정
- Macro → Liquidity 경로 활성 시 → 단기 반등 후 추가 하락 구조
- 연준 정책 전환 없이는 Liquidity 회복 불가

### Rule 5 — Transmission vs MSS 우선순위
- Transmission State가 Active 이상이면 → MSS보다 우선 서술
- Transmission None 또는 Emerging이면 → MSS 기반 해석 유지

---

## 6. Action Mapping

| State | Action Code | 행동 지침 |
|-------|-------------|-----------|
| None | **A1** | 정상 포지션 유지. TQQQ 보유 가능 |
| Emerging | **A2** | 감시 강화. 추가 매수 보류. 포지션 10~20% 축소 검토 |
| Active | **A3** | 구조/시스템 리스크 확인. TQQQ 50% 이하 축소. 현금 확보 |
| Expanding | **A4** | 전이 가속 중. TQQQ 전량 청산 또는 최소화. 방어 자산 확보 |
| Systemic | **A5** | 전방위 유동성 소멸. 현금/달러/단기채 전환. 신규 진입 금지 |

---

## 7. TQQQ Implication

TQQQ는 QQQ 일간 수익률의 3배를 추종하는 레버리지 ETF다.
Transmission 경로가 활성화되면 TQQQ는 **일반 하락보다 비선형적으로 손실**이 확대된다.

| State | TQQQ 리스크 |
|-------|-------------|
| None | 정상 변동성. 보유 가능 |
| Emerging | 주의. 추가 매수 자제 |
| Active | 위험. 절반 이하로 축소 |
| Expanding | 고위험. 대부분 청산 권고 |
| Systemic | 극단 리스크. 전량 청산 / 재진입 대기 |

**핵심 원칙**: Credit 또는 Funding 노드가 경로에 포함되는 순간,
TQQQ 보유 판단은 MSS가 아닌 Transmission State를 기준으로 결정한다.

---

## 8. Narrative Rules

### 작성 원칙
1. **흐름 중심**: "~가 하락했다" 금지 → "~에서 ~로 이동하고 있다" 형식 사용
2. **방향 명시**: 반드시 "어디서 → 어디로" 구조 포함
3. **상태 설명 최소화**: 숫자/레벨 나열 금지, 흐름 묘사 우선
4. **Transmission 우선**: Active 이상이면 MSS 언급 전에 Transmission 서술

### Narrative 금지 패턴
- "MSS는 95입니다" (숫자 나열 금지)
- "현재 위험 레벨 3입니다" (상태 레이블 나열 금지)
- "시장이 하락했습니다" (방향 없는 상태 서술 금지)

---

## 9. Narrative Examples

### Example 1 — State: None
> "현재 리스크 이동 경로는 감지되지 않습니다.
> Equity 시장의 변동성은 Credit 노드로 전달되지 않고 있으며,
> 시장은 정상 구조 내에서 작동 중입니다."

### Example 2 — State: Active (Equity → Credit)
> "Equity에서 발생한 하락 압력이 Credit 노드로 이동하고 있습니다.
> HY 스프레드가 확대되며 구조 리스크 경로가 확인되고 있습니다.
> TQQQ 포지션 축소를 권고하며, Credit → Funding 경로 전이 여부를 집중 감시합니다."

### Example 3 — State: Expanding (Credit → Funding → Liquidity)
> "Credit 압박이 Funding 노드로 전이되었으며, 현재 Funding → Liquidity 경로가 활성화되고 있습니다.
> 시스템 리스크 확장 국면으로 판단됩니다.
> TQQQ를 포함한 레버리지 자산은 즉각 대부분 청산하고,
> 달러 또는 단기채 비중을 확대하는 방어 전환이 필요합니다."

### Example 4 — State: Systemic (Full Cascade)
> "Equity에서 시작된 충격이 Credit → Funding → Liquidity 전 경로를 통과하며
> 시스템 전반에 리스크가 전이되고 있습니다.
> 이는 2008, 2020-03 수준의 Systemic 경로와 동일한 구조입니다.
> 신규 진입을 금지하며, 현금 및 달러 자산으로의 완전 전환을 권고합니다."

---

## 10. Integration Points

| 연동 대상 | 역할 |
|-----------|------|
| MSS (Market Structure Score) | 시장 건강도 점수. Transmission None 시 주요 지표 |
| Risk Alert System | Transmission State → Alert Level 연동 가능 |
| AI Briefing V2 | Narrative 생성 시 Transmission 흐름 우선 서술 |
| TQQQ Strategy Engine | Action Code A1~A5 기반 포지션 결정 |

---

*WO-TM1 | Terminal-X Engine Knowledge Layer | 2026-03*
