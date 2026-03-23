import type {
  ResearchResponse,
  ResearchSource,
  ResearchTakeaway,
  EngineImpact,
  ResearchMeta,
  ResearchRiskLevel,
  ResearchSourceType,
  SourceReliability,
  SourceFreshness,
  TakeawaySentiment,
  EngineImpactDirection,
} from '@/types/research'
import { enrichSources } from './sourceUtils'

function safeStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function safeArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
function safeNum(v: unknown, fallback?: number): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const VALID_RISK_LEVELS:  ResearchRiskLevel[]    = ['Low', 'Moderate', 'Elevated', 'High', 'Critical']
const VALID_SOURCE_TYPES: ResearchSourceType[]   = ['article', 'report', 'data', 'filing', 'analysis', 'news']
const VALID_SENTIMENTS:   TakeawaySentiment[]    = ['bullish', 'bearish', 'neutral', 'caution']
const VALID_DIRECTIONS:   EngineImpactDirection[]= ['increases_risk', 'decreases_risk', 'neutral']
const VALID_RELIABILITY:  SourceReliability[]    = ['high', 'medium', 'low']
const VALID_FRESHNESS:    SourceFreshness[]      = ['current', 'recent', 'dated', 'historical']

function normSource(v: unknown): ResearchSource {
  const o   = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const rel = Number(o.relevance)
  return {
    id:               safeStr(o.id, String(Math.random())),
    title:            safeStr(o.title, 'Untitled source'),
    type:             VALID_SOURCE_TYPES.includes(o.type as ResearchSourceType)
                        ? (o.type as ResearchSourceType) : 'article',
    source_name:      safeStr(o.source_name, 'Unknown'),
    url:              typeof o.url === 'string' ? o.url : undefined,
    date:             typeof o.date === 'string' ? o.date : undefined,
    relevance:        Number.isFinite(rel) && rel >= 0 && rel <= 1 ? rel : 0.5,
    excerpt:          typeof o.excerpt === 'string' ? o.excerpt : undefined,
    tags:             safeArr<string>(o.tags).filter(t => typeof t === 'string'),
    // WO44 quality fields (prefer AI-provided, fallback to inference in enrichSources)
    category:         typeof o.category === 'string' && o.category ? o.category : undefined,
    reliability:      VALID_RELIABILITY.includes(o.reliability as SourceReliability)
                        ? (o.reliability as SourceReliability) : undefined,
    freshness:        VALID_FRESHNESS.includes(o.freshness as SourceFreshness)
                        ? (o.freshness as SourceFreshness) : undefined,
    relevance_reason: typeof o.relevance_reason === 'string' ? o.relevance_reason : undefined,
  }
}

function normTakeaway(v: unknown): ResearchTakeaway {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    text:      safeStr(o.text, ''),
    sentiment: VALID_SENTIMENTS.includes(o.sentiment as TakeawaySentiment)
                 ? (o.sentiment as TakeawaySentiment) : 'neutral',
  }
}

function normEngineImpact(v: unknown): EngineImpact {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    vr_relevant:        typeof o.vr_relevant === 'boolean' ? o.vr_relevant : false,
    direction:          VALID_DIRECTIONS.includes(o.direction as EngineImpactDirection)
                          ? (o.direction as EngineImpactDirection) : 'neutral',
    relevant_track:     typeof o.relevant_track === 'string' && o.relevant_track !== 'null'
                          ? o.relevant_track : undefined,
    summary:            safeStr(o.summary, 'No engine impact assessment available.'),
    affects_risk_level: typeof o.affects_risk_level === 'boolean' ? o.affects_risk_level : false,
  }
}

function normMeta(v: unknown): ResearchMeta | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return {
    provider:     safeStr(o.provider, 'Anthropic'),
    model:        safeStr(o.model, 'unknown'),
    latency_ms:   safeNum(o.latency_ms),
    timestamp:    safeStr(o.timestamp, new Date().toISOString()),
    query:        safeStr(o.query),
    sources_used: typeof o.sources_used === 'number' ? o.sources_used : undefined,
  }
}

export function normalizeResearchResponse(
  raw: Partial<ResearchResponse> | null | undefined,
): ResearchResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      summary: '', key_takeaways: [], risk_level: 'Moderate', risk_rationale: '',
      evidence: [], contradictions: [],
      engine_impact: { vr_relevant: false, direction: 'neutral', summary: '', affects_risk_level: false },
      sources: [],
    }
  }
  return {
    summary:        safeStr(raw.summary),
    key_takeaways:  safeArr<unknown>(raw.key_takeaways).map(normTakeaway).filter(t => t.text),
    risk_level:     VALID_RISK_LEVELS.includes(raw.risk_level as ResearchRiskLevel)
                      ? (raw.risk_level as ResearchRiskLevel) : 'Moderate',
    risk_rationale: safeStr(raw.risk_rationale),
    evidence:       safeArr<string>(raw.evidence).filter(s => typeof s === 'string'),
    contradictions: safeArr<string>(raw.contradictions).filter(s => typeof s === 'string'),
    engine_impact:  normEngineImpact(raw.engine_impact),
    // enrich + dedupe all sources in one pass
    sources:        enrichSources(safeArr<unknown>(raw.sources).map(normSource)),
    _meta:          normMeta(raw._meta),
    _error:         typeof raw._error === 'string' ? raw._error : undefined,
    _route_error_code: raw._route_error_code,
  }
}
