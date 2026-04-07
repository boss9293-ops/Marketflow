import { NextRequest, NextResponse } from 'next/server'



const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL         = 'claude-sonnet-4-6'
const OUTPUT_DIR    = join(process.cwd(), '..', 'backend', 'output')

type RouteErrorCode = 'bad_query' | 'no_api_key' | 'api_error' | 'timeout' | 'parse_error' | 'unknown'

function errorResponse(code: RouteErrorCode, message: string, status = 502): NextResponse {
  return NextResponse.json({ _route_error_code: code, _error: message }, { status })
}

async function readJson<T>(filename: string): Promise<T | null> {
  const { readCacheJson } = await import('@/lib/readCacheJson')
  return readCacheJson<T | null>(filename, null)
}

function safeStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}
function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v); return Number.isFinite(n) ? n : fallback
}

function buildEngineContext(): string {
  try {
    const r1 = readJson<Record<string, unknown>>('risk_v1.json')
    const vr = readJson<Record<string, unknown>>('vr_survival.json')
    const cur = (r1?.current as Record<string, unknown>) ?? {}
    const mr  = (r1?.market_regime as Record<string, unknown>) ?? {}
    const vc  = ((vr as Record<string, unknown>)?.current as Record<string, unknown>) ?? {}
    const parts: string[] = []
    const level   = safeStr(cur.level_label, 'Unknown')
    const score   = safeNum(cur.score, 100)
    const regime  = safeStr(mr.regime, 'Unknown')
    const vrState = safeStr(vc.state, 'NORMAL')
    if (level)   parts.push(`Risk Level: ${level} (MSS: ${score})`)
    if (regime)  parts.push(`Market Regime: ${regime}`)
    if (vrState) parts.push(`VR Engine State: ${vrState}`)
    return parts.length ? parts.join(' | ') : 'Engine context unavailable'
  } catch {
    return 'Engine context unavailable'
  }
}

const SYSTEM_PROMPT = `You are a financial research assistant for a systematic market risk analysis system.
Your role is to provide structured, evidence-based research summaries that help analysts understand
risk conditions — not to give trading recommendations.

Rules:
- Never provide buy/sell/hold instructions
- Focus on risk assessment, regime context, and factual analysis
- Be concise and institutional in tone
- Acknowledge uncertainty where it exists
- Sources you cite are conceptual/representative references — mark them as AI-identified
- For each source, assess its reliability objectively: central banks/regulators/BIS/IMF = high; major financial press/data vendors = high or medium; general media/blogs = medium or low

Always respond with valid JSON matching exactly this structure:
{
  "summary": "2-4 sentence overview",
  "key_takeaways": [{"text": "...", "sentiment": "bullish|bearish|neutral|caution"}, ...],
  "risk_level": "Low|Moderate|Elevated|High|Critical",
  "risk_rationale": "1-2 sentences explaining the risk level",
  "evidence": ["bullet 1", "bullet 2", ...],
  "contradictions": ["counter-point 1", ...],
  "engine_impact": {
    "vr_relevant": true/false,
    "direction": "increases_risk|decreases_risk|neutral",
    "relevant_track": "Track A|Track B|Track C|null",
    "summary": "1 sentence linking to VR engine context",
    "affects_risk_level": true/false
  },
  "sources": [
    {
      "id": "1",
      "title": "descriptive title of the source",
      "type": "article|report|data|filing|analysis|news",
      "source_name": "e.g. Federal Reserve, Bloomberg, BIS",
      "date": "YYYY-MM-DD or approximate year",
      "relevance": 0.0-1.0,
      "excerpt": "1-2 sentence summary of what this source contributes to the query",
      "category": "Central Bank|Government|Regulatory|Market Data|Academic|Financial News|Analysis|International|Credit Research|Reference",
      "reliability": "high|medium|low",
      "freshness": "current|recent|dated|historical",
      "relevance_reason": "one sentence: why this specific source matters for this specific query"
    }
  ]
}

Provide 4-7 diverse, high-quality sources. Prioritize authoritative and recent sources.
Freshness guide: current = this year (2026), recent = 2025, dated = 2023-2024, historical = 2022 or older.
Reliability guide: central banks, regulators, BIS, IMF, major data vendors = high; established financial press = high/medium; general or opinion sources = medium/low.`

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return errorResponse('no_api_key', 'ANTHROPIC_API_KEY is not configured.', 503)
  }

  let query: string
  try {
    const body = await req.json() as Record<string, unknown>
    query = typeof body.query === 'string' ? body.query.trim() : ''
  } catch {
    return errorResponse('bad_query', 'Invalid request body.', 400)
  }

  if (!query || query.length < 5) {
    return errorResponse('bad_query', 'Query must be at least 5 characters.', 400)
  }
  if (query.length > 600) {
    return errorResponse('bad_query', 'Query is too long (max 600 characters).', 400)
  }

  const engineCtx = buildEngineContext()
  const userMsg   = `Research query: ${query}\n\nCurrent engine context: ${engineCtx}`

  const t0 = Date.now()
  try {
    const res = await fetch(ANTHROPIC_API, {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 2600,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMsg }],
      }),
      signal: AbortSignal.timeout(55_000),
    })

    const latency = Date.now() - t0

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>
      const msg = typeof errBody.error === 'object' && errBody.error !== null
        ? (errBody.error as Record<string, unknown>).message as string ?? `API status ${res.status}`
        : `API status ${res.status}`
      return errorResponse('api_error', msg, 502)
    }

    const apiResp = await res.json() as {
      content: Array<{ type: string; text: string }>
      model?: string
    }
    const text = apiResp.content?.find(c => c.type === 'text')?.text ?? ''

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/)
    const jsonStr   = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : text

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonStr) as Record<string, unknown>
    } catch {
      return errorResponse('parse_error', 'AI response was not valid JSON.', 502)
    }

    return NextResponse.json({
      ...parsed,
      _meta: {
        provider:     'Anthropic',
        model:        apiResp.model ?? MODEL,
        latency_ms:   latency,
        timestamp:    new Date().toISOString(),
        query,
        sources_used: Array.isArray(parsed.sources) ? (parsed.sources as unknown[]).length : 0,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('TimeoutError') || msg.includes('AbortError') || msg.includes('timeout')) {
      return errorResponse('timeout', 'Research analysis timed out. Try a more specific query.', 504)
    }
    return errorResponse('unknown', 'Research service connection error.', 502)
  }
}
