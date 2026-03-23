// =============================================================================
// lib/alertDispatcher.ts  (WO-SA27)
// Server-side: dedup + route alerts to Telegram (Phase 1) / Email (Phase 2)
// Dedup log: data/alert_dispatch_log.json (24h window)
// =============================================================================
import fs   from 'fs'
import path from 'path'
import type { Alert } from '@/types/alert'
import { sendTelegramAlert } from '@/lib/telegramService'
import { sendEmailAlert }    from '@/lib/emailService'

// ── Dedup log ─────────────────────────────────────────────────────────────────

const LOG_PATH       = path.join(process.cwd(), 'data', 'alert_dispatch_log.json')
const DEDUP_WINDOW   = 24 * 60 * 60 * 1000   // 24h in ms
const MAX_LOG_ENTRIES = 500

interface LogEntry {
  id:            string
  dispatched_at: string   // ISO timestamp
}

function loadLog(): LogEntry[] {
  try {
    if (!fs.existsSync(LOG_PATH)) return []
    const raw = fs.readFileSync(LOG_PATH, 'utf-8')
    return JSON.parse(raw) as LogEntry[]
  } catch {
    return []
  }
}

function saveLog(entries: LogEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2), 'utf-8')
  } catch (err) {
    console.error('[AlertDispatcher] log write failed:', err)
  }
}

function pruneLog(entries: LogEntry[]): LogEntry[] {
  const cutoff = Date.now() - DEDUP_WINDOW
  const pruned = entries.filter(e => new Date(e.dispatched_at).getTime() > cutoff)
  return pruned.slice(-MAX_LOG_ENTRIES)
}

// ── Dispatch decision ─────────────────────────────────────────────────────────

function shouldDispatch(alert: Alert, log: LogEntry[]): boolean {
  // Only HIGH severity OR RUNTIME/GATE transitions to dangerous states
  const isHighPriority =
    alert.severity === 'HIGH' ||
    (alert.type === 'RUNTIME' && (alert.title.includes('DEFENSIVE') || alert.title.includes('LOCKDOWN'))) ||
    (alert.type === 'GATE'    &&  alert.title.includes('BLOCKED'))

  if (!isHighPriority) return false

  // Dedup: same id already dispatched within 24h
  const alreadySent = log.some(e => e.id === alert.id)
  return !alreadySent
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate alerts and dispatch eligible ones.
 * Called server-side (dashboard/page.tsx or API route).
 * Fire-and-forget safe — errors are caught internally.
 */
export async function dispatchAlerts(alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) return

  let log = pruneLog(loadLog())
  const toSend = alerts.filter(a => shouldDispatch(a, log))

  if (toSend.length === 0) return

  for (const alert of toSend) {
    const [tgOk, emailOk] = await Promise.allSettled([
      sendTelegramAlert(alert),
      sendEmailAlert(alert),
    ]).then(results => results.map(r => r.status === 'fulfilled' && r.value))

    if (tgOk || emailOk) {
      log.push({ id: alert.id, dispatched_at: new Date().toISOString() })
      console.log('[AlertDispatcher] dispatched:', alert.id, '| tg=' + tgOk + ' email=' + emailOk)
    }
  }

  saveLog(log)
}

/**
 * Read the current dispatch log (for the test API route).
 */
export function getDispatchLog(): LogEntry[] {
  return pruneLog(loadLog())
}
