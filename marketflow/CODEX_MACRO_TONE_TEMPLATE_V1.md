# CODEX_MACRO_TONE_TEMPLATE_V1

목표:
Macro Layer의 모든 문장은

- 예측 금지
- 단정 금지
- "압력 / 속도 / 확인 / 환경" 중심
- 한글 + 영어 병기

## 1) Macro Summary 문장 템플릿

### MPS 상태별 템플릿

#### Calm (0–39)

KR

거시 환경은 안정 구간입니다. 급격한 압력 신호는 제한적입니다.

EN

The macro environment remains stable. Systemic pressure signals are limited.

#### Mixed (40–69)

KR

거시 압력은 중립~혼합 구간입니다. 일부 지표에서 확인이 필요합니다.

EN

Macro conditions are mixed. Select indicators warrant monitoring.

#### Pressure (70–84)

KR

거시 압력이 누적되는 구간입니다. 포지션 속도 조절이 권장됩니다.

EN

Macro pressure is building. Positioning speed control is advised.

#### Extreme (85+)

KR

거시 압력이 극단 구간에 진입했습니다. 방어적 기울기가 요구됩니다.

EN

Macro pressure has entered an extreme zone. A defensive tilt is warranted.

## 2) Exposure Modifier 문장

### Upper cap 변경 시

KR

거시 압력에 따라 노출 상단이 조정되었습니다.

EN

Exposure ceiling adjusted due to macro pressure.

### LPI Tight + VRI Expanding 동시 발생

KR

유동성 압박과 변동성 확장이 동시에 나타났습니다. 레버리지 속도 관리가 필요합니다.

EN

Liquidity tightening and volatility expansion are occurring simultaneously. Leverage pacing should be moderated.

## 3) Layer별 설명 템플릿

### LPI (Liquidity)

#### Easy

KR: 유동성 환경은 완화적입니다. 완충 여력이 유지됩니다.  
EN: Liquidity conditions are accommodative. Cushion remains intact.

#### Neutral

KR: 유동성 압력은 중립 구간입니다. 방향성 확인이 필요합니다.  
EN: Liquidity pressure is neutral. Directional confirmation is needed.

#### Tight

KR: 유동성 압력이 상승 중입니다. 확장 전략은 신중 접근이 필요합니다.  
EN: Liquidity pressure is rising. Expansion strategies require caution.

### RPI (Rates)

#### Easing

KR: 금리 부담은 완화 구간입니다. 할인율 압력은 제한적입니다.  
EN: Rate pressure is easing. Discount stress remains contained.

#### Stable

KR: 금리 환경은 안정 구간입니다. 추가 확인이 필요합니다.  
EN: Rate environment is stable. Further confirmation required.

#### Restrictive

KR: 금리 부담이 높은 구간입니다. 성장주 민감도가 상승할 수 있습니다.  
EN: Rate pressure is elevated. Growth sensitivity may increase.

### VRI (Volatility)

#### Compressed

KR: 변동성은 낮은 구간입니다. 급격한 변동 신호는 제한적입니다.  
EN: Volatility is compressed. Sudden dislocation risk is limited.

#### Normal

KR: 변동성은 정상 범위입니다. 구조적 변화는 감지되지 않습니다.  
EN: Volatility is within normal range. No structural shift detected.

#### Expanding

KR: 변동성 확장이 감지됩니다. 포지션 단계 조절이 필요합니다.  
EN: Volatility expansion detected. Position staging should be adjusted.

## 4) Driver Table 문장 정책

각 드라이버 밑에 표시:

KR

5년 분포 기준 상위 {percentile}% 구간입니다. (참고 지표)

EN

Currently at the {percentile}th percentile of the 5Y distribution. (Context indicator)

## 5) 금지 표현 (Hard Block)

UI 또는 API에서 사용 금지 단어:

- crash
- will fall
- guaranteed
- inevitable
- certain
- massive collapse
- prediction
- target price

## 6) 신뢰도(Confidence) 문장

### Conf ≥ 80

KR

데이터 신뢰도 양호

EN

Data confidence: Normal

### 50–79

KR

일부 데이터 확인 필요

EN

Partial data confirmation

### < 50

KR

데이터 제한 구간

EN

Data limited

## 7) 대표님 앱의 차별화 문장 (상단 고정 가능)

KR

Macro Layer는 환경 압력을 측정합니다.  
Risk Engine은 충격을 감지합니다.  
VR은 위기 국면에서 별도로 작동합니다.

EN

Macro Layer measures environmental pressure.  
Risk Engine detects shock acceleration.  
VR operates independently during crisis regimes.

