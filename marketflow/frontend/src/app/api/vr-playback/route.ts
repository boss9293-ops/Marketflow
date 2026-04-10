import { NextResponse } from 'next/server'
import { readCacheJson } from '@/lib/readCacheJson'
import {
  buildVRPlaybackTransportView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
  type VRPlaybackEventOverrides,
} from '../../../../../../vr/playback/vr_playback_loader'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('event_id')
    const playbackEventId = searchParams.get('playback_event_id')
    const simStart = searchParams.get('sim_start') ?? undefined
    const simCapital = searchParams.get('sim_capital')
    const simStockPct = searchParams.get('sim_stock_pct')

    const [standardArchive, survivalArchive] = await Promise.all([
      readCacheJson<RawStandardPlaybackArchive | null>('risk_v1_playback.json', null),
      readCacheJson<RawVRSurvivalPlaybackArchive | null>('vr_survival_playback.json', null),
    ])

    if (!standardArchive || !survivalArchive) {
      return NextResponse.json({ error: 'Playback data not found — run build scripts first' }, { status: 404 })
    }

    const eventOverrides: VRPlaybackEventOverrides | undefined =
      eventId && /^\d{4}-\d{2}$/.test(eventId)
        ? {
            event_id: eventId,
            simulation_start_date: simStart,
            initial_capital: Number(simCapital) || undefined,
            stock_allocation_pct: Number(simStockPct) || undefined,
          }
        : undefined

    const data = buildVRPlaybackTransportView({
      standardArchive,
      survivalArchive,
      rootDir: process.cwd(),
      eventOverrides,
      focusEventId: playbackEventId,
    })

    if (!data) {
      return NextResponse.json({ error: 'No playback data available' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Failed to build playback data — run build scripts first' },
      { status: 500 }
    )
  }
}
