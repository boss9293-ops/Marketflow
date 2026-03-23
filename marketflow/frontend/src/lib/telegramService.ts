// =============================================================================
// lib/telegramService.ts  (WO-SA27)
// Send alert notifications via Telegram Bot API
// Requires: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID in .env.local
// =============================================================================
import type { Alert } from '@/types/alert'

const TYPE_ICON: Record<string, string> = {
  RUNTIME: '\u26a1',   // ⚡
  GATE:    '\u274c',   // ❌
  RISK:    '\ud83d\udd3a', // 🔺
}

function formatMessage(alert: Alert): string {
  const icon = TYPE_ICON[alert.type] ?? '\u26a0\ufe0f'   // ⚠️
  const lines = [
    icon + ' <b>Market Alert \u2014 MarketFlow</b>',
    '',
    '<b>' + alert.title + '</b>',
    alert.message,
    '',
    '<i>' + alert.timestamp + '</i>',
  ]
  return lines.join('\n')
}

export async function sendTelegramAlert(alert: Alert): Promise<boolean> {
  const token  = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const chatId = process.env.TELEGRAM_CHAT_ID   ?? ''

  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping')
    return false
  }

  try {
    const res = await fetch(
      'https://api.telegram.org/bot' + token + '/sendMessage',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    chatId,
          text:       formatMessage(alert),
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[Telegram] HTTP ' + res.status + ': ' + body)
    }
    return res.ok
  } catch (err) {
    console.error('[Telegram] fetch error:', err)
    return false
  }
}
