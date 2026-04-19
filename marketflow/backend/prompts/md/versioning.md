# Prompt Versioning

이 문서는 registry-backed prompt를 어떻게 버전 관리하는지 정리한다.

## Source of truth

- `marketflow/prompts/_registry.json`
- `backend/services/prompt_manager.py`

`PromptManager.get_auto_prompt(page_name)`는 registry의 `auto.active`를 읽어 실제 prompt 파일을 찾는다.
`PromptManager.get_auto_prompt_meta(page_name)`는 `version`, `key`, `source`, `fallback_used`를 만든다.

## Current registry snapshot

| Page | Active version | Active file | Note |
| --- | --- | --- | --- |
| briefing | v2.0.0 | `auto/briefing/v2.0.0_market_briefing.md` | daily briefing generator + UI badge |
| macro_brief | v1.0.0 | `auto/macro_brief/v1.0.0_macro_brief.md` | briefing cards |
| risk_brief | v1.0.0 | `auto/risk_brief/v1.0.0_risk_brief.md` | briefing cards |
| market_structure_brief | v1.0.0 | `auto/market_structure_brief/v1.0.0_market_structure_brief.md` | briefing cards |
| today_context | v1.0.0 | `auto/today_context/v1.0.0_today_context.md` | today context card |
| macro | v1.0.0 | `auto/macro/v1.0.0_macro_summary.md` | registry-ready, no direct caller found |
| risk | v1.0.0 | `auto/risk/v1.0.0_risk_analysis.md` | registry-ready, no direct caller found |
| validation | v1.0.0 | `auto/validation/v1.0.0_validation_room.md` | registry-ready, no direct caller found |
| vr | v1.0.0 | `auto/vr/v1.0.0_vr_explainer.md` | registry-ready, no direct caller found |

## Update workflow

1. Add a new markdown file under `prompts/auto/<page>/`.
2. Update `_registry.json` so `auto.active` points at the new file.
3. Regenerate the relevant cache or artifact if the prompt drives a generated output.
4. Confirm the output JSON includes `prompt.version`, `prompt.source`, and `fallback_used`.
5. If the UI displays a prompt badge, verify that the badge matches the registry version.

## Practical rules

- Keep one active file per registry page.
- Use versioned filenames, for example `v2.0.0_market_briefing.md`.
- Put experimental or paused text in supporting files, not in `auto.active`.
- If a prompt is still useful but not yet wired, leave it in the inventory as `registry-ready` or `supporting`.

## Related consumers

- `backend/scripts/build_daily_briefing_v3.py`
- `backend/app.py`
- `frontend/src/components/briefing/DailyBriefingV3.tsx`

