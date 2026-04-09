import { NextResponse } from 'next/server'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

export const dynamic = 'force-dynamic'

const FLASK_URL = resolveBackendBaseUrl()

export async function GET(
  _request: Request,
  { params }: { params: { symbol: string } },
) {
  const symbol = params.symbol?.toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  try {
    const res = await fetch(`${FLASK_URL}/api/vr-ohlcv/${encodeURIComponent(symbol)}`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Flask error: ${res.status}` }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'fetch failed' }, { status: 502 })
  }
}
