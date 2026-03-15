# CODEX_MACRO_INSTITUTIONAL_V1

목표:
MarketFlow의 Macro Layer를 기관 수준의 데이터 거버넌스, 분포 기반 표준화, 정책 분리 구조로 설계하여
"환경 압력 엔진(Slow Sensor)"로 고정한다.

## 0. 철학 (고정 원칙)

- Macro Layer는 Trigger Engine이 아니다.
- Macro는 Risk Token(R0~R4)을 덮어쓰지 않는다.
- Macro는 Exposure 상단과 톤만 수정한다.
- 모든 점수는 분포 기반(percentile) 표준화로 계산한다.
- 모든 정책은 policy 파일로 분리한다 (코드에 하드코딩 금지).

## 1. 정책 설정 (Policy v1)

### 1.1 Lookback

- Rolling lookback: 5 Years
- Update frequency: Daily (WALCL weekly forward-fill)

### 1.2 Percentile Bands (3-State)

- 0–33 → Low Pressure
- 34–66 → Neutral
- 67–100 → High Pressure

### 1.3 Global Weight

Macro Pressure Score (MPS):

`MPS = 0.4 * LPI + 0.3 * RPI + 0.3 * VRI`

## 2. Data Governance

### 2.1 Primary Sources

- WALCL (FRED, weekly)
- RRPONTSYD (FRED, daily)
- EFFR (FRED, daily)
- VIXCLS (FRED) or CBOE VIX

Optional:

- Repo series (NYFed)
- BTC / Gold internal price feed

### 2.2 Stale Rules

- WALCL: stale if > 10 days
- Daily series: stale if > 2 trading days
- Crypto: stale if > 2 days

Stale must:

- Lower confidence score
- Show badge
- NOT break engine

## 3. Sub-Index Definitions

### 3.1 Liquidity Pressure Index (LPI)

Inputs:

- ΔWALCL (8-week change)
- ΔRRP (20-day change)

Transform:

- p1 = percentile( -ΔWALCL_8w )
- p2 = percentile( -ΔRRP_20d )

Composite:

`LPI = 0.6 * p1 + 0.4 * p2`

Interpretation:

- Measures liquidity cushion stress.
- Never presented as crash predictor.

State:

- <33 Easy
- 33–66 Neutral
- 66 Tight

### 3.2 Rates Pressure Index (RPI)

Inputs:

- EFFR level
- EFFR 1M change

Transform:

- p_level = percentile(EFFR)
- p_chg = percentile(ΔEFFR_1m)

Composite:

`RPI = 0.7 * p_level + 0.3 * p_chg`

State:

- <33 Easing
- 33–66 Stable
- 66 Restrictive

### 3.3 Volatility Regime Index (VRI)

Inputs:

- VIX level
- VIX 5D change

Transform:

- p_vix = percentile(VIX)
- p_acc = percentile(VIX_5d_change)

Composite:

`VRI = 0.6 * p_vix + 0.4 * p_acc`

State:

- <33 Compressed
- 33–66 Normal
- 66 Expanding

### 3.4 Cross Asset Posture (XAP)

MVP:

- No numeric score.

State only:

- Risk-On
- Mixed
- Defensive

Rules:

- Never claim prediction.
- Use alignment language only.

## 4. Macro Pressure Score (MPS)

`MPS = 0.4 * LPI + 0.3 * RPI + 0.3 * VRI`

States:

| Score | State |
|---|---|
| 0–39 | Calm |
| 40–69 | Mixed |
| 70–84 | Pressure |
| 85+ | Extreme |

## 5. Exposure Modifier Rules

Macro modifies upper bound only.

```python
if MPS >= 70:
    exposure_upper -= 10%

if MPS >= 85:
    exposure_upper -= 15%

if LPI > 66 AND VRI > 66:
    exposure_upper -= 10%  # additional
```

- Lower bound is never reduced.
- Global Risk Token remains independent.

## 6. UI Requirements

### 6.1 Macro Score Panel

Display:

- Numeric score
- State
- Visual progress bar
- Last updated
- Confidence (optional)

### 6.2 Reference Bands (Mandatory)

Each indicator must show:

Example:

- VIX 18.79
- 5Y Percentile: 58
- Static Band:
  - Normal 12–20
  - Watch 20–25
  - Risk 25+

Static + Percentile both displayed.

## 7. Validation Requirements

Must internally maintain:

- Crisis playback analysis (2020 / 2022 / etc.)
- False alarm ratio
- Average lead time before volatility spike
- Data revision log

## 8. Architecture Separation

- Macro Layer = Slow Sensors (Environment/Pressure)
- Risk Engine = Fast Sensors (Shock/Acceleration)
- VR = Crash Override (Separate Room)

UI must visually reinforce this separation.

## 9. Implementation Order

- Step 1: Policy file (`macro_v1.json`)
- Step 2: Percentile pipeline
- Step 3: LPI/RPI/VRI computation
- Step 4: MPS integration
- Step 5: Exposure modifier connection
- Step 6: Validation backtest module

## 10. Versioning

All macro policy parameters must be versioned:

- `macro_v1`
- `macro_v2` (future changes only via version bump)

No silent tuning allowed.

끝.

