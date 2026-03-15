import { NextResponse } from 'next/server'

import { ET_TIMEZONE } from '@/lib/terminal-mvp/types'
import { getNewsDetailById } from '@/lib/terminal-mvp/serverNewsStore'

type Params = { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  const { id } = params
  const news = getNewsDetailById(id)
  if (!news) {
    return NextResponse.json(
      { error: 'News detail not found. Reload the timeline and try again.' },
      { status: 404 },
    )
  }

  return NextResponse.json({
    data: { news },
    meta: {
      timezone: ET_TIMEZONE,
      dateET: news.dateET,
    },
  })
}
