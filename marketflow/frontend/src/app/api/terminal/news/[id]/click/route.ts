import { NextResponse } from 'next/server'

import { ET_TIMEZONE, type NewsClickLogRequest } from '@/lib/terminal-mvp/types'
import { appendNewsClick } from '@/lib/terminal-mvp/serverNewsStore'

type Params = { params: { id: string } }

export async function POST(req: Request, { params }: Params) {
  const { id } = params
  let payload: NewsClickLogRequest

  try {
    payload = (await req.json()) as NewsClickLogRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload?.actorId || payload.actorType !== 'user' || !payload.clickedAtET) {
    return NextResponse.json({ error: 'Invalid click log payload.' }, { status: 400 })
  }

  const logId = appendNewsClick(id, payload)
  return NextResponse.json({
    data: { logId, logged: true as const },
    meta: { timezone: ET_TIMEZONE },
  })
}
