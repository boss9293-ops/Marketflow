# Macro Engine Runbook

## 1) 센서 정의
- `LPI`: 유동성 압력 (WALCL/M2/RRP/USD_BROAD).
- `RPI`: 금리 압력 (EFFR/DFII10/10Y-2Y).
- `VRI`: 변동성 압력 (VIX + Put/Call 보강).
- `CSI`: 신용 스프레드 압력 (HY OAS 레벨 + 30D 변화).
- `MPS`: `LPI/RPI/VRI/CSI` 합성 압력 점수.
- `SHOCK`: `VRI/CSI/RV20/DD_VEL` 기반 30일 충격 확률.

## 2) Phase 전환 조건
- 정책 파일: `config/macro_policy.json`.
- Gate 점수: `phase_weights`로 합성.
- 상태:
  - `Shock`: `shock_vri` 또는 `shock_combo_vri+shock_combo_csi` 조건.
  - `Contraction`: `gate >= contraction_gate`.
  - `Slowdown`: `gate >= slowdown_gate`.
  - `Expansion`: 나머지.
- 입력 중 `STALE` 존재 시 `Slowdown` 강제.

## 3) Defensive 정책
- `phase=Shock|Contraction` -> `ON`.
- `phase=Slowdown` -> `WATCH`.
- `phase=Expansion` -> `OFF`.
- `defensive_thresholds`로 `mps/csi` override:
  - `mps_on`, `mps_watch`
  - `csi_on`, `csi_watch`
- `sensor_state_thresholds`:
  - 센서 상태 분류(`Normal/Watch/Stress`) 임계값
- `percentile_band_thresholds`:
  - 퍼센타일 밴드 분류(`Normal/Watch/Risk`) 임계값

## 4) Shock 모델 설명
- `shock_weights`: `VRI/CSI/RV20/DD_VEL`.
- `shock_raw` 계산 후 `shock_prob_caps(min/max)` 적용.
- 상태 구간: `shock_state_thresholds`.
- `CSI` 결측 시 fallback: `CSI weight=0`, `SHOCK quality_effective=PARTIAL`.

## 5) Fallback / Abort 정책
- `PUT_CALL` 결측: `VIX-only fallback` (PARTIAL).
- `CSI(HY_OAS)` 결측: `CSI=0`, weight=0, quality=PARTIAL.
- `VIX` 결측: 스냅샷 중단(`abort`).
- `QQQ` 결측: 스냅샷 중단(`abort`).

## 6) 운영 실행 순서
1. `python collectors/collect_market.py`
2. `python collectors/collect_cboe.py`
3. `python collectors/collect_fred.py`
4. `python build_macro_snapshot.py`

## 7) 자동 실행
- 스크립트: `scripts/daily_job.ps1`
- Task 등록: `scripts/register_daily_task.ps1`
- 기본 실행 시각: 매일 `18:00`.
- 기본 모드: **알림 OFF** (운영 자동화만 먼저 적용).
- 알림은 나중에 활성화:
  - Task 재등록 시 `-EnableAlert -SlackWebhookUrl "<webhook>"` 전달
- 로그:
  - `logs/daily_job.log`
  - `logs/engine.log` (JSON line)

## 8) 장애 대응
1. `logs/daily_job.log` 확인.
2. `logs/engine.log`에서 마지막 `FAIL` 이벤트 확인.
3. `python scripts/check_db_health.py`로 결측 심볼 확인.
4. 수집기 재실행 후 스냅샷 재빌드.
5. 필요 시 Slack Webhook 알림 URL 확인 후 재등록.

## 9) 수동 재빌드
- 단발 실행: `python build_macro_snapshot.py`
- API 확인: `GET /api/macro/snapshots/latest`

## 10) 품질 게이트 테스트
- 실행: `python -m pytest -q tests/test_macro_engine.py`
- 최소 확인:
  - `VRI=90, CSI=90` 시 충격확률 `>40%`
  - `VRI=10, CSI=10` 시 충격확률 `<15%`
  - `Slowdown -> Defensive WATCH`
  - `Contraction -> Defensive ON`
  - `CSI missing -> SHOCK quality PARTIAL`
