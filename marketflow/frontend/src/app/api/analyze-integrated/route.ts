import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

const FLASK_URL = process.env.FLASK_API_URL ?? 'http://localhost:5001'
const OUTPUT_DIR = join(process.cwd(), '..', 'backend', 'output')

function readJson<T>(filename: string): T | null {
  try {
    return JSON.parse(readFileSync(join(OUTPUT_DIR, filename), 'utf-8')) as T
  } catch {
    return null
  }
}

// ── Field extractors ──────────────────────────────────────────────────────────

function safeStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── VR state confidence ───────────────────────────────────────────────────────
// Measures how far the current state is from a threshold boundary.
// Terminal states (ARMED, EXIT_DONE) = high. Transition states (REENTRY) = medium.
// Score-based states: distance from nearest level threshold (84/92/100/110).

function computeVrConfidence(
  vrState: string,
  score: number,
  crashTrigger: boolean,
): 'low' | 'medium' | 'high' {
  if (crashTrigger || vrState === 'ARMED') return 'high'
  if (vrState === 'EXIT_DONE')             return 'high'
  if (vrState === 'REENTRY')               return 'medium'

  // Level thresholds: 84 | 92 | 100 | 110
  const thresholds = [84, 92, 100, 110]
  const minDist = Math.min(...thresholds.map(t => Math.abs(score - t)))
  if (minDist >= 7) return 'high'
  if (minDist >= 3) return 'medium'
  return 'low'
}

function buildPayload(r1: Record<string, unknown>, vr: Record<string, unknown>): Record<string, unknown> | null {
  const cur = (r1.current as Record<string, unknown>) ?? {}
  const ta  = (r1.track_a as Record<string, unknown>) ?? {}
  const tb  = (r1.track_b as Record<string, unknown>) ?? {}
  const tc  = (r1.track_c as Record<string, unknown>) ?? {}
  const ms  = (r1.master_signal as Record<string, unknown>) ?? {}
  const mr  = (r1.market_regime as Record<string, unknown>) ?? {}
  const vc  = (vr.current as Record<string, unknown>) ?? {}

  const date       = safeStr(cur.date, new Date().toISOString().slice(0, 10))
  const price      = safeNum(cur.price)
  const ma200      = safeNum(cur.ma200)
  const ma250      = ma200 > 0 ? Math.round(ma200 * 1.025 * 100) / 100 : 0
  const ddPct      = safeNum(cur.dd_pct) / 100

  const score      = safeNum(cur.score, 100)

  const levelLabel = safeStr(cur.level_label, 'Caution')
  const riskLevel  = levelLabel === 'Normal'    ? 'Normal'
                   : levelLabel === 'Caution'   ? 'Caution'
                   : levelLabel === 'Warning'   ? 'Warning'
                   : levelLabel === 'High Risk' ? 'High Risk'
                   : levelLabel === 'Crisis'    ? 'Crisis'
                   : 'Caution'

  const regime          = safeStr(mr.regime, 'Unknown')
  const dominant_signal = safeStr(ms.action, 'HOLD')

  const track_A = safeStr(ta.signal || ta.state, 'Credit/Liquidity — Normal').slice(0, 120)
  const track_B = safeStr(
    tb.velocity_signal
      ? `MSS ${safeNum(tb.mss_current, score)} | ${tb.velocity_signal}`
      : `MSS ${safeNum(tb.mss_current, score)}`,
    `MSS ${score}`,
  ).slice(0, 120)
  const track_C = safeStr(tc.signal || tc.state, 'No exogenous shock').slice(0, 120)

  const vrState       = safeStr(vc.state, 'NORMAL')
  const crash_trigger = vrState === 'ARMED' || vrState === 'EXIT_DONE'

  if (!price || !ma200) return null

  const indicators: Record<string, number> = {}
  if (Number.isFinite(safeNum(cur.vol_pct))) indicators['vol_pct'] = Math.round(safeNum(cur.vol_pct) * 100) / 100
  if (Number.isFinite(score))                indicators['mss_score'] = score
  const taEarly = (r1.track_a_early as Record<string, unknown>) ?? {}
  if (typeof taEarly.score === 'number')     indicators['track_a_early_score'] = taEarly.score

  const key_flags: string[] = []
  if (ms.track_a_active)       key_flags.push('Track A credit stress active')
  if (ms.track_a_early_active) key_flags.push('Track A early-warning active')
  if (ms.track_c_active)       key_flags.push('Track C exogenous shock active')
  if (ms.mss_velocity_alert)   key_flags.push('MSS velocity alert')
  if (vrState !== 'NORMAL')    key_flags.push(`VR state: ${vrState}`)

  return {
    date,
    risk_level:      riskLevel,
    regime,
    score,
    track_A,
    track_B,
    track_C,
    dominant_signal,
    indicators,
    key_flags,
    vr_state:        vrState,
    crash_trigger,
    price,
    ma200,
    ma250,
    dd5:             ddPct,
    dd10:            ddPct * 1.6,
    vmin_level:      null,
    bottom_score:    null,
    early_reversal_active: false,
  }
}

// ── Flask call with retry ─────────────────────────────────────────────────────

type RouteErrorCode = 'no_data' | 'bad_payload' | 'flask_unreachable' | 'flask_error' | 'timeout' | 'unknown'

function errorResponse(code: RouteErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ _route_error_code: code, _error: message }, { status })
}

async function callFlask(payload: Record<string, unknown>): Promise<NextResponse> {
  const MAX_ATTEMPTS = 2
  let lastCode: RouteErrorCode = 'unknown'
  let lastMsg  = 'Unknown error'

  const vrState       = typeof payload.vr_state === 'string'      ? payload.vr_state      : 'NORMAL'
  const crashTrigger  = typeof payload.crash_trigger === 'boolean' ? payload.crash_trigger : false
  const score         = typeof payload.score === 'number'          ? payload.score         : 100
  const vrContext     = {
    vr_state:      vrState,
    crash_trigger: crashTrigger,
    confidence:    computeVrConfidence(vrState, score, crashTrigger),
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${FLASK_URL}/api/analyze/integrated`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(45_000),
      })

      if (res.ok) {
        const data = await res.json() as Record<string, unknown>
        return NextResponse.json({ ...data, _vr_context: vrContext })
      }

      lastCode = 'flask_error'
      lastMsg  = `AI service returned status ${res.status}`
      if (res.status < 500) break

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('TimeoutError') || msg.includes('AbortError') || msg.includes('timeout')) {
        lastCode = 'timeout'
        lastMsg  = 'AI service did not respond in time'
      } else if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
        lastCode = 'flask_unreachable'
        lastMsg  = 'AI service is not reachable'
      } else {
        lastCode = 'unknown'
        lastMsg  = 'AI service connection error'
      }
    }
  }

  return errorResponse(lastCode, lastMsg, 502)
}

export async function POST(): Promise<NextResponse> {
  const r1 = readJson<Record<string, unknown>>('risk_v1.json')
  const vr = readJson<Record<string, unknown>>('vr_survival.json')

  if (!r1 || !vr) {
    return errorResponse('no_data', 'Backend output files not found. Run backend scripts first.', 503)
  }

  const payload = buildPayload(r1, vr)
  if (!payload) {
    return errorResponse('bad_payload', 'Could not build request payload (missing price/ma200 data).', 422)
  }

  return callFlask(payload)
}
