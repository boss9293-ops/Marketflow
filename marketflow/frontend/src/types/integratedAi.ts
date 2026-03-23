// Types for the integrated AI analysis response (WO33-WO40)

export type IntegratedScenario = {
  name: string
  prob: number          // 0.0 – 1.0
  description: string
}

export type RetrievedCase = {
  case_id: string
  similarity: number    // 0.0 – 1.0
  reasons: string[]
  title?: string
}

export type IntegratedAiMeta = {
  provider: string
  model: string
  latency_ms?: number
  date?: string
  retrieved_cases?: RetrievedCase[]
}

// Raw VR engine state injected by the Next.js route layer (not from Flask)
export type VrContext = {
  vr_state:     string                          // NORMAL | CAUTION | ARMED | EXIT_DONE | REENTRY
  crash_trigger: boolean
  confidence:   'low' | 'medium' | 'high'      // how confident the state classification is
}

export type IntegratedAiResponse = {
  market_summary: string
  regime_assessment: string
  vr_assessment: string
  combined_assessment: string
  allowed_actions: string[]
  cautions: string[]
  key_drivers: string[]
  similar_cases: string[]
  scenarios: IntegratedScenario[]
  recommendation: string
  evidence: string[]
  contradictions: string[]
  _meta?: IntegratedAiMeta
  _vr_context?: VrContext
  _error?: string
  _raw?: string
  // route-level categorized error (never shown raw to user)
  _route_error_code?: 'no_data' | 'bad_payload' | 'flask_unreachable' | 'flask_error' | 'timeout' | 'unknown'
}

// ── Trust status ──────────────────────────────────────────────────────────────

export type AiTrustStatus = 'idle' | 'loading' | 'live' | 'cached' | 'stale' | 'failed'

export type AiCacheEntry = {
  data: IntegratedAiResponse
  timestamp: number        // Date.now()
  status: 'live'
}

export const AI_CACHE_KEY = 'ai_integrated_v1'
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000   // 24h before considered stale

// ── normalizeIntegratedResponse ───────────────────────────────────────────────

function safeStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function safeArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function safeScenario(v: unknown): IntegratedScenario {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const prob = Number(o.prob)
    return {
      name:        safeStr(o.name, 'Unnamed scenario'),
      prob:        Number.isFinite(prob) && prob >= 0 && prob <= 1 ? prob : 0,
      description: safeStr(o.description),
    }
  }
  return { name: 'Unnamed scenario', prob: 0, description: '' }
}

function safeRetrievedCase(v: unknown): RetrievedCase {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const sim = Number(o.similarity)
    return {
      case_id:    safeStr(o.case_id, 'unknown'),
      similarity: Number.isFinite(sim) && sim >= 0 && sim <= 1 ? sim : 0,
      reasons:    safeArr<string>(o.reasons).filter(r => typeof r === 'string'),
      title:      typeof o.title === 'string' ? o.title : undefined,
    }
  }
  return { case_id: 'unknown', similarity: 0, reasons: [] }
}

function safeMeta(v: unknown): IntegratedAiMeta | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const latency = Number(o.latency_ms)
  return {
    provider:        safeStr(o.provider, 'unknown'),
    model:           safeStr(o.model, 'unknown'),
    latency_ms:      Number.isFinite(latency) ? latency : undefined,
    date:            typeof o.date === 'string' ? o.date : undefined,
    retrieved_cases: safeArr<unknown>(o.retrieved_cases).map(safeRetrievedCase),
  }
}

function safeVrContext(v: unknown): VrContext | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const vr_state     = typeof o.vr_state === 'string' ? o.vr_state : 'NORMAL'
  const crash_trigger = typeof o.crash_trigger === 'boolean' ? o.crash_trigger : false
  const rawConf = o.confidence
  const confidence: 'low' | 'medium' | 'high' =
    rawConf === 'low' || rawConf === 'medium' || rawConf === 'high' ? rawConf : 'medium'
  return { vr_state, crash_trigger, confidence }
}

export function normalizeIntegratedResponse(
  raw: Partial<IntegratedAiResponse> | null | undefined,
): IntegratedAiResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      market_summary: '', regime_assessment: '', vr_assessment: '', combined_assessment: '',
      allowed_actions: [], cautions: [], key_drivers: [], similar_cases: [],
      scenarios: [], recommendation: '', evidence: [], contradictions: [],
    }
  }
  return {
    market_summary:      safeStr(raw.market_summary),
    regime_assessment:   safeStr(raw.regime_assessment),
    vr_assessment:       safeStr(raw.vr_assessment),
    combined_assessment: safeStr(raw.combined_assessment),
    allowed_actions:     safeArr<string>(raw.allowed_actions).filter(s => typeof s === 'string'),
    cautions:            safeArr<string>(raw.cautions).filter(s => typeof s === 'string'),
    key_drivers:         safeArr<string>(raw.key_drivers).filter(s => typeof s === 'string'),
    similar_cases:       safeArr<string>(raw.similar_cases).filter(s => typeof s === 'string'),
    scenarios:           safeArr<unknown>(raw.scenarios).map(safeScenario),
    recommendation:      safeStr(raw.recommendation),
    evidence:            safeArr<string>(raw.evidence).filter(s => typeof s === 'string'),
    contradictions:      safeArr<string>(raw.contradictions).filter(s => typeof s === 'string'),
    _meta:               safeMeta(raw._meta),
    _vr_context:         safeVrContext(raw._vr_context),
    _error:              typeof raw._error === 'string' ? raw._error : undefined,
    _route_error_code:   raw._route_error_code,
  }
}

// ── Cache helpers (localStorage) ──────────────────────────────────────────────

export function loadCache(): AiCacheEntry | null {
  try {
    const raw = localStorage.getItem(AI_CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as AiCacheEntry
    if (!entry?.data || typeof entry.timestamp !== 'number') return null
    return entry
  } catch {
    return null
  }
}

export function saveCache(data: IntegratedAiResponse): void {
  try {
    const entry: AiCacheEntry = { data, timestamp: Date.now(), status: 'live' }
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function isCacheStale(entry: AiCacheEntry): boolean {
  return Date.now() - entry.timestamp > CACHE_MAX_AGE_MS
}

export function formatCacheAge(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60)    return `${secs}s ago`
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}
