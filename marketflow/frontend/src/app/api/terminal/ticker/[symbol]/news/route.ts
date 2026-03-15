import { NextRequest, NextResponse } from 'next/server'

import { ET_TIMEZONE, type ETDateString } from '@/lib/terminal-mvp/types'
import { upsertNewsDetails } from '@/lib/terminal-mvp/serverNewsStore'
import { fetchTickerNewsFromYahoo } from '@/lib/terminal-mvp/serverTickerNews'

const resolveDateET = (input: string | null): ETDateString => {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

type Params = { params: { symbol: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const { symbol: rawSymbol } = params
  const symbol = rawSymbol.trim().toUpperCase()
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol.' }, { status: 400 })
  }

  const dateET = resolveDateET(req.nextUrl.searchParams.get('date'))

  try {
    const payload = await fetchTickerNewsFromYahoo(symbol, dateET)
    upsertNewsDetails(payload.details)

    return NextResponse.json({
      data: {
        symbol,
        news: payload.timeline,
      },
      meta: {
        timezone: ET_TIMEZONE,
        dateET,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch ticker news.',
      },
      { status: 502 },
    )
  }
}
