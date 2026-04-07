import { NextResponse } from 'next/server'
import { readCacheJson } from '@/lib/readCacheJson'

export async function GET() {
  // 1. Try live output
  const live = await readCacheJson<Record<string, unknown> | null>('smart_analyzer_latest.json', null)
  if (live && !('error' in live)) {
    return NextResponse.json({ ...live, _source: 'live' })
  }

  // 2. Fallback to sample
  const sample = await readCacheJson<{ scenarios?: Array<{ output: unknown }> } | null>('smart_analyzer_sample.json', null)
  if (sample?.scenarios?.length) {
    return NextResponse.json({ ...sample.scenarios[0].output, _source: 'sample' })
  }

  return NextResponse.json({ error: 'No smart analyzer data available' }, { status: 404 })
}
