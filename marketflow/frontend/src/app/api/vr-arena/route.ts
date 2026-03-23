import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildStrategyArena,
} from '../../../../../../vr/arena/compute_strategy_arena'
import type {
  RawStandardPlaybackArchive,
  RawVRSurvivalPlaybackArchive,
} from '../../../../../../vr/playback/vr_playback_loader'

export async function GET() {
  try {
    const base = join(process.cwd(), '..', 'backend', 'output')
    const standardArchive = JSON.parse(
      readFileSync(join(base, 'risk_v1_playback.json'), 'utf-8')
    ) as RawStandardPlaybackArchive
    const survivalArchive = JSON.parse(
      readFileSync(join(base, 'vr_survival_playback.json'), 'utf-8')
    ) as RawVRSurvivalPlaybackArchive

    const data = buildStrategyArena({ standardArchive, survivalArchive })

    if (!data) {
      return NextResponse.json({ error: 'No arena data available' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Failed to build arena data — run build scripts first' },
      { status: 500 }
    )
  }
}
