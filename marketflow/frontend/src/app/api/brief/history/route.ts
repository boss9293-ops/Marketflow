// =============================================================================
// app/api/brief/history/route.ts  (WO-SA29)
// GET /api/brief/history  — returns brief history (headline list)
// =============================================================================
import { NextResponse } from 'next/server'
import { getBriefHistory } from '@/lib/briefStore'

export async function GET() {
  const history = await getBriefHistory()
  return NextResponse.json({ history })
}
