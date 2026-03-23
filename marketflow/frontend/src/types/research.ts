// Types for the Research Desk (WO41-WO44)

export type ResearchSourceType = 'article' | 'report' | 'data' | 'filing' | 'analysis' | 'news'
export type SourceReliability  = 'high' | 'medium' | 'low'
export type SourceFreshness    = 'current' | 'recent' | 'dated' | 'historical'

export type ResearchSource = {
  id:               string
  title:            string
  type:             ResearchSourceType
  source_name:      string
  url?:             string
  date?:            string
  relevance:        number           // 0.0 – 1.0
  excerpt?:         string
  tags?:            string[]
  // WO44: enriched quality fields
  category?:        string           // e.g. 'Central Bank', 'Market Data'
  reliability?:     SourceReliability
  freshness?:       SourceFreshness
  relevance_reason?: string          // why this source is relevant
}

export type TakeawaySentiment = 'bullish' | 'bearish' | 'neutral' | 'caution'

export type ResearchTakeaway = {
  text:      string
  sentiment: TakeawaySentiment
}

export type ResearchRiskLevel = 'Low' | 'Moderate' | 'Elevated' | 'High' | 'Critical'

export type EngineImpactDirection = 'increases_risk' | 'decreases_risk' | 'neutral'

export type EngineImpact = {
  vr_relevant:        boolean
  direction:          EngineImpactDirection
  relevant_track?:    string
  summary:            string
  affects_risk_level: boolean
}

export type ResearchMeta = {
  provider:      string
  model:         string
  latency_ms?:   number
  timestamp:     string
  query:         string
  sources_used?: number
}

export type ResearchResponse = {
  summary:          string
  key_takeaways:    ResearchTakeaway[]
  risk_level:       ResearchRiskLevel
  risk_rationale:   string
  evidence:         string[]
  contradictions:   string[]
  engine_impact:    EngineImpact
  sources:          ResearchSource[]
  _meta?:           ResearchMeta
  _error?:          string
  _route_error_code?: 'bad_query' | 'no_api_key' | 'api_error' | 'timeout' | 'parse_error' | 'unknown'
}

export type ResearchStatus  = 'idle' | 'loading' | 'live' | 'failed'
export type ResearchSortKey = 'relevance' | 'date' | 'reliability'
