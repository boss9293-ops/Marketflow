// =============================================================================
// lib/emailService.ts  (WO-SA27 Phase 2 — stub)
// Send alert notifications via email (SMTP / Resend)
// Not yet active — configure SMTP vars and uncomment implementation
// =============================================================================
import type { Alert } from '@/types/alert'

// Required env vars (Phase 2):
// ALERT_EMAIL_TO=you@example.com
// RESEND_API_KEY=re_...           (using Resend — https://resend.com)
// OR use nodemailer with SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS

function formatSubject(alert: Alert): string {
  return '[MarketFlow] ' + alert.title
}

function formatBody(alert: Alert): string {
  return [
    'MarketFlow Alert',
    '----------------',
    'Type:     ' + alert.type,
    'Severity: ' + alert.severity,
    'Title:    ' + alert.title,
    '',
    alert.message,
    '',
    'Timestamp: ' + alert.timestamp,
  ].join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendEmailAlert(alert: Alert): Promise<boolean> {
  const to     = process.env.ALERT_EMAIL_TO  ?? ''
  const apiKey = process.env.RESEND_API_KEY  ?? ''

  if (!to || !apiKey) {
    // Phase 2 not configured — silent skip
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        from:    'MarketFlow <alerts@yourdomain.com>',
        to:      [to],
        subject: formatSubject(alert),
        text:    formatBody(alert),
      }),
      signal: AbortSignal.timeout(10000),
    })
    return res.ok
  } catch (err) {
    console.error('[Email] send error:', err)
    return false
  }
}
