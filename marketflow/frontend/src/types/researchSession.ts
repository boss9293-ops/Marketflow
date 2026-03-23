import type { ResearchResponse } from './research'

export interface SavedResearchSession {
  id:          string
  query:       string
  response:    ResearchResponse
  vr_context?: {
    vr_state?:      string
    crash_trigger?: boolean
    confidence?:    string
  }
  created_at:  string
  updated_at?: string
  topic?:      string
}

export interface TopicPack {
  id:          string
  title:       string
  description: string
  queries:     string[]
}
