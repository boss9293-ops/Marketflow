// =============================================================================
// types/narrative.ts  (WO-SA28)
// =============================================================================

export interface NarrativeViewPayload {
  headline:     string
  summary:      string
  key_points:   string[]       // max 3
  posture_line: string
  watch_items:  string[]       // max 3
  analog_line?: string
  outlook_line?: string
  closing_line: string
  md_prompt:    MdPromptPayload
  has_data:     boolean
}

/** Compact export block for blog / Telegram long-form / YouTube script seed */
export interface MdPromptPayload {
  briefing_title: string
  regime:         string
  runtime:        string
  posture:        string
  reliability:    string
  top_drivers:    string[]
  key_changes:    string[]
  analog_context: string
  forward_bias:   string
  watch_items:    string[]
}
