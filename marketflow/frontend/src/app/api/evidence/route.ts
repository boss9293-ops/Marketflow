import { NextRequest, NextResponse } from 'next/server'

import { ET_TIMEZONE } from '@/lib/terminal-mvp/types'
import { fetchEvidenceRows } from '@/lib/terminal-mvp/qaEvidenceDb'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim()
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  try {
    const rows = fetchEvidenceRows(sessionId)
    return NextResponse.json({
      data: {
        sessionId,
        rows,
      },
      meta: {
        timezone: ET_TIMEZONE,
        dateET: rows[0]?.dateET,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load evidence rows.' },
      { status: 500 },
    )
  }
}
