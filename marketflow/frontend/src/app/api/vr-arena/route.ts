import { NextResponse } from 'next/server'
import { readCacheJson } from '@/lib/readCacheJson'
import { buildStrategyArena } from '../../../../../../vr/arena/compute_strategy_arena'
import type {
  RawStandardPlaybackArchive,
  RawVRSurvivalPlaybackArchive,
} from '../../../../../../vr/playback/vr_playback_loader'

export async function GET() {
  try {
    const [standardArchive, survivalArchive] = await Promise.all([
      readCacheJson<RawStandardPlaybackArchive | null>('risk_v1_playback.json', null),
      readCacheJson<RawVRSurvivalPlaybackArchive | null>('vr_survival_playback.json', null),
    ])

    if (!standardArchive || !survivalArchive) {
      return NextResponse.json({ error: 'Arena data not found — run build scripts first' }, { status: 404 })
    }

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
