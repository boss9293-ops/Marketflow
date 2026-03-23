// =============================================================================
// lib/briefScheduler.ts  (WO-SA29)
// Load analyzer state → build narrative → save brief
// No new analysis logic — reuses existing SA26/SA28 stack
// =============================================================================
import type { SessionType, DailyBrief } from '@/types/brief'
import { buildSmartAnalyzerView }          from '@/lib/buildSmartAnalyzerView'
import { formatAnalyzerReliabilityFromView } from '@/lib/formatAnalyzerReliability'
import { buildAlerts }                     from '@/lib/alertEngine'
import { buildDailySnapshot }              from '@/lib/buildDailySnapshot'
import { buildForwardOutlook }             from '@/lib/formatForwardOutlook'
import { buildTransitionView }             from '@/lib/formatTransitionView'
import { formatNarrativeView }             from '@/lib/formatNarrativeView'
import { readCacheJson }                   from '@/lib/readCacheJson'
import { saveBrief }                       from '@/lib/briefStore'

// ── Session detection (approximate ET = UTC-5) ────────────────────────────────

export function detectSessionType(now?: Date): SessionType {
  const d      = now ?? new Date()
  const etMins = ((d.getUTCHours() * 60 + d.getUTCMinutes()) - 300 + 1440) % 1440

  if (etMins < 9 * 60 + 30) return 'PREMARKET'    // before  9:30 AM ET
  if (etMins < 16 * 60)     return 'INTRADAY'      //  9:30 AM – 4:00 PM ET
  if (etMins < 20 * 60)     return 'POSTMARKET'    //  4:00 PM – 8:00 PM ET
  return 'DAILY_CLOSE'                              // after   8:00 PM ET
}

// ── Brief generation ──────────────────────────────────────────────────────────

type SaSampleFile = { scenarios: { output: Record<string, unknown> }[] }
type SnapshotsFile = { snapshots: unknown[] }

export async function generateBrief(
  sessionType?: SessionType,
  force = false,
): Promise<{ brief: DailyBrief; skipped: false } | { skipped: true }> {
  const now     = new Date()
  const today   = now.toISOString().slice(0, 10)
  const session = sessionType ?? detectSessionType(now)

  // Dedup check (skip if same date+session already exists, unless forced)
  if (!force) {
    const { getLatestBrief } = await import('@/lib/briefStore')
    const existing = await getLatestBrief()
    if (existing?.date === today && existing?.session_type === session) {
      return { skipped: true }
    }
  }

  // ── Load analyzer data (same file candidates as dashboard/page.tsx) ──
  const [saLive, saSamples, snapshotsData] = await Promise.all([
    readCacheJson<Record<string, unknown> | null>('smart_analyzer_latest.json', null),
    readCacheJson<SaSampleFile>('smart_analyzer_sample.json', { scenarios: [] }),
    readCacheJson<SnapshotsFile>('snapshots_120d.json', { snapshots: [] }),
  ])

  const saRawOutput: Record<string, unknown> | null =
    saLive && typeof saLive === 'object' && !('error' in saLive)
      ? saLive
      : (saSamples.scenarios[0]?.output ?? null)

  // ── Build view stack ──
  const saViewPayload      = buildSmartAnalyzerView(saRawOutput)
  const reliabilityPayload = formatAnalyzerReliabilityFromView(saViewPayload)
  const alertsPayload      = buildAlerts(saViewPayload, today)
  const dailyView          = buildDailySnapshot(saViewPayload, snapshotsData.snapshots as Parameters<typeof buildDailySnapshot>[1])
  const forward            = buildForwardOutlook(saViewPayload, reliabilityPayload)
  const transition         = buildTransitionView(saViewPayload, reliabilityPayload)

  const narrativeView = formatNarrativeView({
    sa:          saViewPayload,
    reliability: reliabilityPayload,
    alerts:      alertsPayload,
    dailyView,
    forward,
    transition,
  })

  // ── Assemble brief ──
  const brief: DailyBrief = {
    id:             today + '-' + session,
    as_of:          now.toISOString(),
    date:           today,
    session_type:   session,
    narrative_view: narrativeView,
    md_prompt:      narrativeView.md_prompt,
  }

  await saveBrief(brief)
  return { brief, skipped: false }
}
