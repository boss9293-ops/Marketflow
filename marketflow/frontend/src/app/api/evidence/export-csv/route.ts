import { NextRequest, NextResponse } from 'next/server'

import { fetchEvidenceRows } from '@/lib/terminal-mvp/qaEvidenceDb'

export const runtime = 'nodejs'

const CSV_COLUMNS = [
  'row_id',
  'session_id',
  'symbol',
  'title',
  'source',
  'source_type',
  'published_at_et',
  'summary',
  'relevance_score',
  'url',
  'tags',
  'created_at',
] as const

const escapeCsv = (value: unknown): string => {
  const raw = value == null ? '' : String(value)
  const escaped = raw.replace(/"/g, '""')
  return `"${escaped}"`
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim()
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  try {
    const rows = fetchEvidenceRows(sessionId)
    const header = CSV_COLUMNS.join(',')
    const bodyLines = rows.map((row) =>
      [
        row.id,
        row.sessionId,
        row.symbol,
        row.title,
        row.source,
        row.sourceType,
        row.publishedAtET,
        row.summary,
        row.aiRelevancy.toFixed(6),
        row.url ?? '',
        '',
        row.createdAtET,
      ]
        .map((cell) => escapeCsv(cell))
        .join(','),
    )

    const csv = [header, ...bodyLines].join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="evidence-${sessionId}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export CSV.' },
      { status: 500 },
    )
  }
}
