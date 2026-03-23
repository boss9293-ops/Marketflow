// =============================================================================
// app/api/brief/generate/route.ts  (WO-SA29)
// GET /api/brief/generate?session=PREMARKET|POSTMARKET|DAILY_CLOSE|INTRADAY
//     &force=1  to regenerate even if same date+session exists
//
// Used for: manual testing, cron triggers, CI pipelines
// =============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { generateBrief, detectSessionType } from '@/lib/briefScheduler'
import type { SessionType } from '@/types/brief'

const VALID_SESSIONS: SessionType[] = ['PREMARKET', 'INTRADAY', 'POSTMARKET', 'DAILY_CLOSE']

export async function GET(req: NextRequest) {
  const params     = req.nextUrl.searchParams
  const sessionRaw = params.get('session')?.toUpperCase() as SessionType | null
  const force      = params.get('force') === '1'

  const session: SessionType | undefined =
    sessionRaw && VALID_SESSIONS.includes(sessionRaw) ? sessionRaw : undefined

  try {
    const result = await generateBrief(session, force)

    if (result.skipped) {
      return NextResponse.json({
        status:  'skipped',
        reason:  'Brief for this date + session already exists. Pass ?force=1 to overwrite.',
        session: session ?? detectSessionType(),
      })
    }

    return NextResponse.json({
      status:  'generated',
      brief:   result.brief,
    })
  } catch (err) {
    console.error('[brief/generate]', err)
    return NextResponse.json(
      { status: 'error', message: String(err) },
      { status: 500 }
    )
  }
}
