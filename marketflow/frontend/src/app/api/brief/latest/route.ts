// =============================================================================
// app/api/brief/latest/route.ts  (WO-SA29)
// GET /api/brief/latest  — returns latest stored brief
// =============================================================================
import { NextResponse } from 'next/server'
import { getLatestBrief } from '@/lib/briefStore'

export async function GET() {
  const brief = await getLatestBrief()
  if (!brief) {
    return NextResponse.json({ error: 'No brief generated yet' }, { status: 404 })
  }
  return NextResponse.json(brief)
}
