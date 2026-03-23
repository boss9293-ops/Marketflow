import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildVRPlaybackView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
  type VRPlaybackEventOverrides,
} from '../../../../../../vr/playback/vr_playback_loader'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('event_id')
    const simStart = searchParams.get('sim_start') ?? undefined
    const simCapital = searchParams.get('sim_capital')
    const simStockPct = searchParams.get('sim_stock_pct')

    const base = join(process.cwd(), '..', 'backend', 'output')
    const standardArchive = JSON.parse(
      readFileSync(join(base, 'risk_v1_playback.json'), 'utf-8')
    ) as RawStandardPlaybackArchive
    const survivalArchive = JSON.parse(
      readFileSync(join(base, 'vr_survival_playback.json'), 'utf-8')
    ) as RawVRSurvivalPlaybackArchive
    const rootDir = join(process.cwd(), '..', '..')

    const eventOverrides: VRPlaybackEventOverrides | undefined =
      eventId && /^\d{4}-\d{2}$/.test(eventId)
        ? {
            event_id: eventId,
            simulation_start_date: simStart,
            initial_capital: Number(simCapital) || undefined,
            stock_allocation_pct: Number(simStockPct) || undefined,
          }
        : undefined

    const data = buildVRPlaybackView({
      standardArchive,
      survivalArchive,
      rootDir,
      eventOverrides,
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
