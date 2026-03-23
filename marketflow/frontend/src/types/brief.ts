// =============================================================================
// types/brief.ts  (WO-SA29)
// =============================================================================
import type { NarrativeViewPayload, MdPromptPayload } from './narrative'

export type SessionType = 'PREMARKET' | 'INTRADAY' | 'POSTMARKET' | 'DAILY_CLOSE'

export interface DailyBrief {
  id:             string          // e.g. "2026-03-22-PREMARKET"
  as_of:          string          // ISO timestamp when generated
  date:           string          // YYYY-MM-DD
  session_type:   SessionType
  narrative_view: NarrativeViewPayload
  md_prompt:      MdPromptPayload
}

export interface BriefHistoryEntry {
  id:           string
  as_of:        string
  date:         string
  session_type: SessionType
  headline:     string
}
