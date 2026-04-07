import { NextResponse } from 'next/server'
import { readCacheJson } from '@/lib/readCacheJson'

export async function GET() {
  const data = await readCacheJson<Record<string, unknown> | null>('vr_pattern_dashboard.json', null)
  if (!data) {
    return NextResponse.json(
      { error: 'vr_pattern_dashboard.json not found - run build_vr_pattern_dashboard.py' },
      { status: 404 }
    )
  }
  return NextResponse.json(data)
}
