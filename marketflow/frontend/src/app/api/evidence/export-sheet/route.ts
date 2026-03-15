import { NextResponse } from 'next/server'

import { ET_TIMEZONE, type EvidenceSheetExportRequest } from '@/lib/terminal-mvp/types'
import { fetchEvidenceRows, queueEvidenceSheetExport } from '@/lib/terminal-mvp/qaEvidenceDb'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  let payload: EvidenceSheetExportRequest
  try {
    payload = (await req.json()) as EvidenceSheetExportRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload?.sessionId || !payload?.sheetName || !payload?.requestedBy || !payload?.requestedAtET) {
    return NextResponse.json({ error: 'Invalid export-sheet payload.' }, { status: 400 })
  }

  try {
    const rows = fetchEvidenceRows(payload.sessionId)
    if (!rows.length) {
      return NextResponse.json(
        { error: 'No evidence rows found for this session.' },
        { status: 404 },
      )
    }

    const exportJobId = queueEvidenceSheetExport({
      sessionId: payload.sessionId,
      sheetName: payload.sheetName,
      requestedBy: payload.requestedBy,
      requestedAtET: payload.requestedAtET,
      rowCount: rows.length,
    })

    return NextResponse.json({
      data: {
        exportJobId,
        status: 'queued' as const,
        queued: true as const,
        rowCount: rows.length,
      },
      meta: {
        timezone: ET_TIMEZONE,
        dateET: rows[0]?.dateET,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue evidence sheet export.' },
      { status: 500 },
    )
  }
}
