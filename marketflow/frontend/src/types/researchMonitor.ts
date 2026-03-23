import type { ResearchResponse } from './research'

export type MonitorStatus = 'watching' | 'updated' | 'changed' | 'warning'

export interface ChangeSummary {
  risk_changed:         boolean
  risk_direction?:      'up' | 'down'
  summary_changed:      boolean
  evidence_changed:     boolean
  source_count_changed: boolean
  source_count_delta?:  number
  notable:              string[]
}

export interface MonitoredTopic {
  id:              string
  query:           string
  topic_label?:    string
  vr_context?:     { vr_state?: string; crash_trigger?: boolean; confidence?: string }
  status:          MonitorStatus
  latest:          ResearchResponse
  previous?:       ResearchResponse
  change_summary?: ChangeSummary
  last_checked:    string
  created_at:      string
}
