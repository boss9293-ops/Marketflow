export type PriorityVRSupportStatus = 'ready' | 'partial' | 'pending_synthetic'

export type PriorityEventVRAnalysis = {
  pattern_type: string
  ma200_status: 'above' | 'tested' | 'breached' | 'sustained_below'
  leverage_stress: 'low' | 'medium' | 'high' | 'extreme'
  recovery_quality: 'weak' | 'mixed' | 'improving' | 'strong'
  tags: string[]
  lesson: string
  scenario_bias: string[]
  playbook_bias: string[]
}

export type PriorityEventVRTag = {
  event_id: string
  vr_support_status: PriorityVRSupportStatus
  vr_analysis: PriorityEventVRAnalysis
}

export type PriorityEventVRTagFile = {
  events: PriorityEventVRTag[]
}
