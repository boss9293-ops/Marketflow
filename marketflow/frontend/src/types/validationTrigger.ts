export type ValidationTriggerLevel = 'watch' | 'review' | 'elevated' | 'critical'
export type ValidationTarget       = 'vr' | 'strategy_lab' | 'crash_analysis' | 'playback'

export interface ValidationTrigger {
  id:               string
  level:            ValidationTriggerLevel
  title:            string
  summary:          string
  source_type?:     'monitor' | 'research' | 'priority'
  linked_topic_id?: string
  linked_vr_state?: string
  crash_trigger?:   boolean
  confidence?:      string
  risk_level?:      string
  reasons:          string[]
  checklist:        string[]
  primary_target:   ValidationTarget
  primary_href:     string
  secondary_href?:  string
  secondary_label?: string
  created_at?:      string
  score?:           number
}
