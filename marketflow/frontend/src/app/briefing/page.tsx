import { readCacheJson } from '@/lib/readCacheJson'
import TerminalBriefingView, {
  type DailyBriefing,
  type HealthSnapshot,
  type MarketState,
  type MarketTapeCache,
} from '@/components/briefing/TerminalBriefingView'
import AIBriefingV2, { type AiBriefingV2 } from '@/components/briefing/AIBriefingV2'

export default async function BriefingPage() {
  const [briefing, ms, health, tape, aiBriefing] = await Promise.all([
    readCacheJson<DailyBriefing>('daily_briefing.json', { bullets: [] }),
    readCacheJson<MarketState>('market_state.json', {}),
    readCacheJson<HealthSnapshot>('health_snapshot.json', {}),
    readCacheJson<MarketTapeCache>('market_tape.json', { items: [] }),
    readCacheJson<AiBriefingV2>('ai_briefing_v2.json', { sections: [] }),
  ])

  return (
    <>
      <AIBriefingV2 data={aiBriefing} />
      <TerminalBriefingView briefing={briefing} ms={ms} health={health} tape={tape} />
    </>
  )
}
