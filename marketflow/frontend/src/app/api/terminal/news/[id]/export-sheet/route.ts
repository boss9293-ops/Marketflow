import { NextResponse } from 'next/server'

import { ET_TIMEZONE, type SheetExportRequest } from '@/lib/terminal-mvp/types'
import { appendNewsExport, getNewsDetailById } from '@/lib/terminal-mvp/serverNewsStore'

type Params = { params: { id: string } }

export async function POST(req: Request, { params }: Params) {
  const { id } = params
  let payload: SheetExportRequest

  try {
    payload = (await req.json()) as SheetExportRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload?.sheetName || !payload?.requestedBy || !payload?.requestedAtET) {
    return NextResponse.json({ error: 'Invalid export payload.' }, { status: 400 })
  }

  const news = getNewsDetailById(id)
  if (!news) {
    return NextResponse.json(
      { error: 'News detail not found. Reload timeline before exporting.' },
      { status: 404 },
    )
  }

  const exportJobId = appendNewsExport(id, payload, news)
  return NextResponse.json({
    data: { exportJobId, queued: true as const },
    meta: { timezone: ET_TIMEZONE, dateET: news.dateET },
  })
}
