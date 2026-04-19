# Prompt Inventory

현재 앱에서 사용 중인 prompt 자산을 유형별로 나눈 목록이다.

## 1) Registry-backed prompts

`backend/services/prompt_manager.py`가 `prompts/_registry.json`을 읽어서 활성 prompt를 고른다.

| Key | Active file | Current consumer | Status |
| --- | --- | --- | --- |
| briefing | [auto/briefing/v2.0.0_market_briefing.md](../auto/briefing/v2.0.0_market_briefing.md) | `backend/scripts/build_daily_briefing_v3.py`, `frontend/src/components/briefing/DailyBriefingV3.tsx` | active |
| macro_brief | [auto/macro_brief/v1.0.0_macro_brief.md](../auto/macro_brief/v1.0.0_macro_brief.md) | `backend/app.py` `/api/briefing-cards` | active |
| risk_brief | [auto/risk_brief/v1.0.0_risk_brief.md](../auto/risk_brief/v1.0.0_risk_brief.md) | `backend/app.py` `/api/briefing-cards` | active |
| market_structure_brief | [auto/market_structure_brief/v1.0.0_market_structure_brief.md](../auto/market_structure_brief/v1.0.0_market_structure_brief.md) | `backend/app.py` `/api/briefing-cards` | active |
| today_context | [auto/today_context/v1.0.0_today_context.md](../auto/today_context/v1.0.0_today_context.md) | `backend/app.py` `/api/today-context` | active |
| macro | [auto/macro/v1.0.0_macro_summary.md](../auto/macro/v1.0.0_macro_summary.md) | direct runtime caller not found | registry-ready |
| risk | [auto/risk/v1.0.0_risk_analysis.md](../auto/risk/v1.0.0_risk_analysis.md) | direct runtime caller not found | registry-ready |
| validation | [auto/validation/v1.0.0_validation_room.md](../auto/validation/v1.0.0_validation_room.md) | direct runtime caller not found | registry-ready |
| vr | [auto/vr/v1.0.0_vr_explainer.md](../auto/vr/v1.0.0_vr_explainer.md) | direct runtime caller not found | registry-ready |

## 2) Shared prompt libraries

이 그룹은 `prompt_loader.py` / `promptLoader.ts` 같은 로더를 통해 읽는다.

| Family | Files | Loader | Consumer | Status |
| --- | --- | --- | --- | --- |
| engine_knowledge | `engine_knowledge/transmission/transmission_map.md`, `engine_knowledge/tracks/track_a_credit.md`, `engine_knowledge/tracks/track_b_velocity.md`, `engine_knowledge/tracks/track_c_event.md`, `engine_knowledge/core/mss_engine.md` | `backend/utils/prompt_loader.py:get_engine_knowledge` | `backend/services/narrative_generator.py` | active |
| engine_narrative | `engine_narrative/briefing_v1.md`, `engine_narrative/watchlist_v1.md`, `engine_narrative/portfolio_v1.md` | `backend/utils/prompt_loader.py:get_narrative_templates` | `backend/services/narrative_generator.py` | active |
| smart analyzer | [engines/smart_market_analyzer.md](../engines/smart_market_analyzer.md) | `services/promptLoader.ts:loadEnginePrompt` | `services/smartAnalyzer.ts` | active |
| navigator | [navigator_ai_gpt.md](../navigator_ai_gpt.md), [navigator_ai_gemini.md](../navigator_ai_gemini.md) | `backend/app.py:_load_prompt` | `backend/app.py` navigator route | active |

## 3) Supporting macro-family files

`auto/macro/`는 registry active file 1개와 보조 템플릿 3개로 운영된다.

| File | Role | Status |
| --- | --- | --- |
| [auto/macro/v1.0.0_macro_summary.md](../auto/macro/v1.0.0_macro_summary.md) | registry active prompt | active |
| [auto/macro/v1.0.0_macro_fred4.md](../auto/macro/v1.0.0_macro_fred4.md) | FRED4 source-selection prompt | supporting |
| [auto/macro/v1.0.0_macro_institutional.md](../auto/macro/v1.0.0_macro_institutional.md) | institutional macro tone prompt | supporting |
| [auto/macro/v1.0.0_macro_tone_template.md](../auto/macro/v1.0.0_macro_tone_template.md) | macro tone template | supporting |

## 4) Reference-only or inactive assets

이 파일들은 현재 코드에서 직접 로드되지 않거나, prompt registry의 active list에 들어 있지 않다.

| File | Note | Status |
| --- | --- | --- |
| [ai_analyzers/vr/overview.md](../ai_analyzers/vr/overview.md) | VR analyzer documentation | reference-only |
| [ai_analyzers/vr/changelog.md](../ai_analyzers/vr/changelog.md) | VR analyzer changelog | reference-only |
| [user_req/_pending/req_20260329_vix_meaning.md](../user_req/_pending/req_20260329_vix_meaning.md) | pending user request prompt | pending |

## 5) What to exclude

- `prompt`가 들어간 일반 문자열
- 생성된 narrative output
- UI label과 badge text
- prompt가 아닌 JSON field 이름
