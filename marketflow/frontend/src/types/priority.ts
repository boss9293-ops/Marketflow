export type PriorityLevel  = 'critical' | 'high' | 'medium' | 'low'
export type PrioritySource = 'vr' | 'research' | 'monitor'

export interface UnifiedPriorityItem {
  id:           string
  source:       PrioritySource
  level:        PriorityLevel
  title:        string
  summary:      string
  action_label: string
  action_href:  string
  score:        number
  badge?:       string
  badge_color?: string
}
