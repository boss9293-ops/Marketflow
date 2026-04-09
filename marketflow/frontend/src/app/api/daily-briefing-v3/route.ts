import { NextRequest, NextResponse } from 'next/server'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

export const dynamic = 'force-dynamic'

export async function GET() {
  const data = await readCacheJsonOrNull<Record<string, unknown>>('daily_briefing_v3.json')
  if (!data) {
    return NextResponse.json(
      {
        error: 'daily_briefing_v3.json not found',
        rerun_hint: 'python backend/scripts/build_daily_briefing_v3.py',
      },
      { status: 404 }
    )
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { force = false, lang = 'ko' } = body as { force?: boolean; lang?: string }

  const backendUrl = resolveBackendBaseUrl()

  try {
    const res = await fetch(`${backendUrl}/api/briefing/v3/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force, lang }),
      signal: AbortSignal.timeout(320_000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502 }
    )
  }
}
