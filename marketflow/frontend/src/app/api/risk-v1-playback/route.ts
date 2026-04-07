import { NextResponse } from 'next/server'
import { readCacheJson } from '@/lib/readCacheJson'

export async function GET() {
  const data = await readCacheJson<Record<string, unknown> | null>('risk_v1_playback.json', null)
  if (!data) {
    return NextResponse.json(
      { error: 'risk_v1_playback.json not found — run build_risk_v1.py' },
      { status: 404 }
    )
  }
  return NextResponse.json(data)
}
