import { NextResponse } from 'next/server'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

const FLASK_URL = resolveBackendBaseUrl()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || 'AAPL').trim().toUpperCase()

  try {
    const res = await fetch(
      `${FLASK_URL}/api/analyze/financials?symbol=${symbol}`,
      { signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return NextResponse.json({ error: text }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Flask unreachable' }, { status: 503 })
  }
}
