# SSOT Market OS Contract (v1)

목적: MarketFlow를 "리스크 관리 OS"로 운영하기 위해, 중복 계산/중복 해석을 줄이고 각 페이지의 역할을 고정한다.

## 1) Core Rules

1. 뉴스 포털화 금지: 매크로/리스크/건강도는 설명형 콘텐츠가 아니라 판단 입력 변수다.
2. 예측 확정 표현 금지: "폭락" 대신 "압력/취약도/전환 구간"을 사용한다.
3. 각 상태는 소유자(owner)가 1곳만 가진다.
4. 다른 페이지는 같은 상태를 재계산하지 않고 배지/칩 형태로 소비한다.
5. 모든 점수/상태는 가능하면 `source`, `asof`, `stale`, `formula|bins`를 함께 제공한다.

## 2) Layer Role Split (Owner Only)

- `Macro Layer`
  - 역할: 선행 압력 센서 (유동성/금리/변동성/관계상태)
  - 포함: `LPI`, `RPI`, `VRI`, `MPS`, `X-Asset state`, `VIX regime context`, freshness/stale
  - 비포함: 최종 행동 결론, tail risk 확률 결론

- `Market Health`
  - 역할: 구조 진단 (추세/확산/변동성 구조)
  - 포함: 구조 점수와 상태, 진단 설명
  - 비포함: 매크로 선행센서 재계산, tail risk 엔진 재계산

- `Risk Engine`
  - 역할: 확률/분포 기반 취약도 (tail/ES/CVaR/가속)
  - 포함: tail risk, distribution metrics, shock sensitivity
  - 비포함: 매크로 선행압력 계산, 시장 구조 진단 점수 재정의

- `Market State`
  - 역할: 오늘의 결론(행동) 1개 + 핵심 근거 칩 3개
  - 포함: action synthesis, 표현 계층
  - 비포함: 근본 지표 계산 엔진 소유권

- `Portfolio`
  - 역할: 내 계좌 영향 + 조정 시뮬레이션
  - 포함: 계좌 노출/집중/시나리오 영향
  - 비포함: 전역 매크로/리스크 상태 재계산

- `VR (Crash Override)`
  - 역할: 별도 운용 방 (override)
  - 본 문서 범위 제외

## 3) SSOT Ownership Map (v1)

### 3.1 State Ownership

- `macro.indexes.LPI/RPI/VRI` → Owner: `Macro Layer`
  - Source: `backend/output/cache/macro_summary.json` (`/api/macro/summary`)
  - Consumers: `/macro`, `/overview`, sidebar macro summary, future badge strips

- `macro.mps` / `macro_pressure` → Owner: `Macro Layer`
  - Source: `macro_summary.json`, `macro_detail.json`
  - Consumers: `/macro`, `/overview`

- `vix_state` (compressed/normal/expanding context) → Owner: `Macro Layer` (`VRI`)
  - Rule: 다른 페이지는 VIX 숫자를 보여줄 수는 있으나 상태 판정은 Macro에서만 계산

- `risk_engine_score / tail vulnerability` → Owner: `Risk Engine`
  - Source: `backend/output/cache/risk_engine.json`
  - Consumers: `/overview`, `/risk`, action synthesis (read-only)

- `market_health_total / sub-scores` → Owner: `Market Health`
  - Source: `backend/output/cache/market_health.json`
  - Consumers: `/health`, `/overview` (summary chips)

- `action/exposure guidance` → Owner: `Action Snapshot / Market State synthesis`
  - Source: `backend/output/cache/action_snapshot.json`
  - Consumers: `/overview`, `/macro`, `/risk`, `/portfolio`

### 3.2 Display-Only Consumers (No Recompute)

- `/overview` (Market State page)
  - 역할: 최종 결론 + 근거칩
  - 금지: 매크로/리스크/헬스 점수 계산식 재정의

- `/health`
  - 역할: 구조 진단
  - 금지: Macro LPI/RPI/VRI 상태 판정 재계산

- `/risk`
  - 역할: tail risk/분포
  - 금지: Macro pressure score 판정 재계산

- `/portfolio`
  - 역할: 계좌 영향/시뮬레이션
  - 금지: 전역 state 엔진 재구현

## 4) Shared Badge Contract (Read-Only)

공통 배지는 아래 규칙을 따른다.

- 값은 owner endpoint/cache에서 읽는다.
- 배지는 상태명 + as-of/date만 표시한다.
- 배지는 "근거 보기" 링크를 제공하되, 계산식은 owner 페이지/탭에서만 상세 표시한다.

### 4.1 Macro Validation Badge

- Endpoint: `GET /api/macro/validation/status` (alias)
- Fields (minimum):
  - `status` (`OK` | `Watch`)
  - `snapshot_date`
  - `revision_detected`
- Tone rules:
  - `OK` = green
  - `Watch` = amber

## 5) Data Governance Minimum (Required Metadata)

각 owner 레이어는 최소한 다음 메타를 노출해야 한다.

- `source` (예: FRED/NYFed/CBOE/internal)
- `asof` 또는 `data_asof`
- `update_rule` (예: daily close, weekly forward-fill)
- `stale` (bool)
- `last_updated` (가능 시 series별)
- `revision_detected` (해당되는 경우, 예: FRED validation snapshots)

## 6) Explain Standard (Next Step Contract)

모든 점수/상태에 대해 아래 구조를 표준화한다. (구현 단계에서 JSON 필드로 반영)

```json
{
  "state": "Restrictive",
  "score": 74.2,
  "asof": "2026-02-25",
  "stale": false,
  "source": ["FRED:EFFR", "FRED:DFII10"],
  "formula": "0.6*pct(EFFR level) + 0.4*pct(EFFR 1M change)",
  "bins": [
    {"label":"Easing","max":33},
    {"label":"Stable","max":66},
    {"label":"Restrictive","max":100}
  ],
  "inputs": [
    {"name":"EFFR level","value":4.33,"pct":88.1},
    {"name":"EFFR 1M change bp","value":25,"pct":69.4}
  ]
}
```

## 7) Duplication Kill List (Immediate)

아래 항목은 페이지마다 다시 계산/해석하지 않는다.

- VIX 상태 분류 (`Compressed/Normal/Expanding`) → Macro owner only
- Macro pressure bucket / modifiers → Macro owner only
- Tail vulnerability color/token → Risk Engine owner only
- 오늘의 액션 결론 문장 → Market State owner only

## 8) Migration Checklist (Practical)

1. 각 페이지 상단에 `Badge Strip` 추가 (owner state read-only)
2. 페이지별 중복 문장 제거 (소유자가 아닌 결론 문장 삭제)
3. Explain 패널은 owner 페이지에서만 상세 표시
4. stale/revision 메타 표시 일관화

---

Status: v1 contract drafted (implementation follow-up required)

