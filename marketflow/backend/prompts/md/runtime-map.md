# Prompt Runtime Map

이 문서는 prompt가 실제로 어디에서 LLM 입력으로 사용되는지 보여준다.

## 1) Registry-backed runtime

### Daily Briefing

- `backend/scripts/build_daily_briefing_v3.py`
  - `PromptManager.get_auto_prompt("briefing")`로 briefing prompt를 읽는다.
  - registry가 비어 있거나 읽기 실패 시 inline fallback prompt로 내려간다.
  - 생성 결과에 `prompt.source`, `prompt.version`, `prompt.key`가 저장된다.
- `frontend/src/components/briefing/DailyBriefingV3.tsx`
  - prompt version/source badge를 상단에 표시한다.

### Briefing cards and today context

- `backend/app.py` `/api/briefing-cards`
  - `macro_brief`, `risk_brief`, `market_structure_brief`의 prompt metadata를 읽는다.
  - 저장된 JSON 캐시와 함께 prompt version/source를 내려준다.
- `backend/app.py` `/api/today-context`
  - `today_context` prompt metadata를 읽고 headline 캐시를 내려준다.

## 2) Shared library runtime

- `backend/utils/prompt_loader.py`
  - `engine_knowledge`와 `engine_narrative` prompt를 로드한다.
- `backend/services/narrative_generator.py`
  - briefing, watchlist, portfolio용 structured JSON prompt를 만든다.
  - engine knowledge + narrative template을 합쳐 LLM에 전달한다.
- `backend/api/narrative.py`
  - `generate_briefing`, `generate_watchlist`, `generate_portfolio` 엔드포인트를 노출한다.
- `services/promptLoader.ts`
  - frontend/TypeScript 쪽에서 `prompts/engines/*`를 읽는다.
- `services/smartAnalyzer.ts`
  - `smart_market_analyzer.md`를 읽어 market type / strategy / confidence를 만든다.

## 3) Inline prompt surfaces in backend

- `backend/api/analyze_integrated.py`
  - integrated risk interpretation prompt를 inline `SYSTEM_PROMPT`와 `USER_TEMPLATE`로 정의한다.
- `backend/services/srs_ai.py`
  - SRS risk summary prompt를 inline으로 정의한다.
- `backend/services/langgraph_daily_brief.py`
  - daily briefing synthesis prompt를 inline으로 정의한다.
- `backend/scripts/build_ai_briefings.py`
  - stage 1 legacy prompt와 stage 2 LangGraph path를 함께 가진다.
- `backend/scripts/build_ai_briefing_v2.py`
  - `today_context`, `narrative`, validation artifacts를 생성하는 prompt pipeline이 들어 있다.
- `backend/news/context_narrative.py`
  - template narrative와 optional premium AI narrative prompt를 함께 운용한다.
- `backend/app.py`
  - navigator AI route가 `navigator_ai_gpt.md` / `navigator_ai_gemini.md`를 읽어 사용자 prompt를 만든다.

## 4) Inline prompt surfaces in frontend

- `frontend/src/lib/generateMarketNarration.ts`
  - market health narration prompt를 locale별로 inline 생성한다.
- `frontend/src/app/api/research/route.ts`
  - systematic research summary prompt를 inline으로 정의한다.
- `frontend/src/app/api/earnings/route.ts`
  - earnings insight prompt를 inline으로 정의한다.
- `frontend/src/app/api/admin/ai-repair/run/route.ts`
  - system reliability repair report prompt를 inline으로 정의한다.

## 5) Metadata-only consumers

이 파일들은 prompt 본문을 만들지는 않지만, prompt version/source를 화면에 보여준다.

- `frontend/src/components/dashboard/AIMarketBrief.tsx`
- `frontend/src/components/dashboard/TodayContextCard.tsx`
- `frontend/src/components/briefing/DailyBriefingV3.tsx`

## 6) Notes

- `terminal-mvp` 계열은 narrative를 렌더링하지만, 직접 LLM prompt를 읽는 구조는 아니다.
- `prompt`라는 단어가 있어도 실제 LLM 입력이 아니면 이 맵에서 제외한다.
