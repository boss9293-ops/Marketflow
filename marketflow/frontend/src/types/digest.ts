import type { MonitorStatus } from './researchMonitor'

export interface DailyDigestTopic {
  id:           string
  title:        string
  status?:      MonitorStatus
  risk_level?:  string
  vr_state?:    string
  confidence?:  string
  short_reason?: string
  href?:        string
}

export interface DailyDigest {
  date:                string
  headline:            string
  summary:             string
  priority_count:      number
  changed_count:       number
  warning_count:       number
  top_topics:          DailyDigestTopic[]
  changed_topics:      DailyDigestTopic[]
  research_highlights: string[]
  vr_impact_summary:   string
  empty?:              boolean
}
