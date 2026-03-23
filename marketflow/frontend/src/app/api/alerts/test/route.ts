// =============================================================================
// app/api/alerts/test/route.ts  (WO-SA27)
// Manual trigger: GET /api/alerts/test?dry=1  (dry run — log only)
//                 GET /api/alerts/test          (actually send)
// =============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { sendTelegramAlert }  from '@/lib/telegramService'
import { getDispatchLog }     from '@/lib/alertDispatcher'
import type { Alert }         from '@/types/alert'

const TEST_ALERT: Alert = {
  id:        'TEST_' + new Date().toISOString().slice(0, 10),
  type:      'RUNTIME',
  severity:  'HIGH',
  title:     'Test Alert — MarketFlow SA27',
  message:   'This is a test message to verify Telegram delivery is working correctly.',
  timestamp: new Date().toISOString().slice(0, 10),
}

export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get('dry') === '1'

  const log = getDispatchLog()

  if (dry) {
    return NextResponse.json({
      status:   'dry_run',
      log_size: log.length,
      recent:   log.slice(-5),
      env: {
        has_token:   !!process.env.TELEGRAM_BOT_TOKEN,
        has_chat_id: !!process.env.TELEGRAM_CHAT_ID,
      },
    })
  }

  const sent = await sendTelegramAlert(TEST_ALERT)

  return NextResponse.json({
    status:  sent ? 'sent' : 'failed',
    alert:   TEST_ALERT,
    log_size: log.length,
  })
}
