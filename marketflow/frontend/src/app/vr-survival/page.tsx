import { readFileSync } from 'fs'
import { join } from 'path'
import type { CSSProperties } from 'react'
import VRSurvival, {
  type ETFRoomData,
  type Tab,
  type VRDashboardPatternSummary,
  VRSurvivalData,
} from '@/components/crash/vr/VRSurvival'
import { detectPatternMatches } from '../../../../../engine/pattern_detector'
import { computeCurrentMarketAnalogs } from '../../../../../vr/analog/compute_market_analog'
import { buildStrategyArena, type StrategyArenaView } from '../../../../../vr/arena/compute_strategy_arena'
import { buildPostureMessage } from '../../../../../vr/dashboard/build_posture_message'
import { mapScenarioPlaybook } from '../../../../../vr/playbooks/playbook_mapper'
import {
  buildVRPlaybackView,
  type RawStandardPlaybackArchive,
  type RawVRSurvivalPlaybackArchive,
} from '../../../../../vr/playback/vr_playback_loader'
import { generateMarketState, toPatternDetectorInput } from '../../../../../vr/state/market_state_generator'
import type { MarketState } from '../../../../../vr/types/market_state'

function readOutputJson<T>(filename: string): T | null {
  try {
    const base = join(process.cwd(), '..', 'backend', 'output')
    const raw = readFileSync(join(base, filename), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function formatMA200Label(value: MarketState['ma200_relation']) {
  if (value === 'above') return 'Above MA200'
  if (value === 'test') return 'Testing MA200'
  if (value === 'breach') return 'Breached MA200'
  return 'Sustained Below MA200'
}

function formatStructureLabel(value: MarketState['price_structure']) {
  const map: Record<MarketState['price_structure'], string> = {
    trend_down: 'Trend Down',
    slow_bleed: 'Slow Bleed',
    vertical_drop: 'Vertical Drop',
    range_market: 'Range Market',
    sideways: 'Sideways Consolidation',
    countertrend_rally: 'Countertrend Rally',
    breakdown_retest: 'Breakdown Retest',
  }
  return map[value]
}

function formatVolatilityLabel(value: MarketState['volatility_regime']) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

async function buildCurrentPatternDashboard(rootDir: string): Promise<VRDashboardPatternSummary | null> {
  try {
    const marketState = await generateMarketState({ rootDir })
    const patternMatches = detectPatternMatches(toPatternDetectorInput(marketState), { rootDir, limit: 3 })
    const scenarioPlaybook = mapScenarioPlaybook(patternMatches, { rootDir, maxScenarios: 3 })
    const historicalAnalogs = computeCurrentMarketAnalogs({
      rootDir,
      marketState,
      topPattern: patternMatches.top_matches[0] ?? null,
      minScore: 40,
    })
    const suggestedPosture = Array.from(
      new Set(scenarioPlaybook.scenarios.flatMap((scenario) => scenario.posture_guidance))
    ).slice(0, 3)
    const postureMessage = buildPostureMessage({
      marketState,
      primaryPatternName: patternMatches.top_matches[0]?.pattern_name,
      scenarios: scenarioPlaybook.scenarios.slice(0, 3).map((scenario) => ({
        scenario_id: scenario.scenario_id,
        scenario_name: scenario.scenario_name,
        description: scenario.description,
        posture_guidance: scenario.posture_guidance,
      })),
      suggestedPosture,
    })

    return {
      snapshot: {
        as_of_date: marketState.as_of_date,
        market_pattern: patternMatches.top_matches[0]?.pattern_name ?? 'No pattern analog available yet',
        nasdaq_drawdown: formatPercent(marketState.nasdaq_drawdown),
        tqqq_drawdown: formatPercent(marketState.tqqq_drawdown),
        ma200_status: formatMA200Label(marketState.ma200_relation),
        market_structure: formatStructureLabel(marketState.price_structure),
        volatility_regime: formatVolatilityLabel(marketState.volatility_regime),
        recommended_posture: suggestedPosture,
      },
      posture_message: postureMessage,
      top_matches: patternMatches.top_matches.slice(0, 3),
      scenarios: scenarioPlaybook.scenarios.slice(0, 3).map((scenario) => ({
        scenario_id: scenario.scenario_id,
        scenario_name: scenario.scenario_name,
        description: scenario.description,
        posture_guidance: scenario.posture_guidance,
      })),
      historical_analogs: historicalAnalogs,
      suggested_posture: suggestedPosture,
    }
  } catch {
    return null
  }
}

function toSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function VRSurvivalPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const raw = readOutputJson<VRSurvivalData>('vr_survival.json')
  const heatmapData = readOutputJson<ETFRoomData>('etf_room.json')
  const standardPlayback = readOutputJson<RawStandardPlaybackArchive>('risk_v1_playback.json')
  const survivalPlayback = readOutputJson<RawVRSurvivalPlaybackArchive>('vr_survival_playback.json')
  const rootDir = join(process.cwd(), '..', '..')
  const requestedTab = toSingleValue(searchParams?.tab)
  const requestedEvent = toSingleValue(searchParams?.event)
  const initialTab: Tab = requestedTab === 'Playback' ? 'Playback' : 'Overview'
  const initialPlaybackEventId =
    requestedEvent && /^\d{4}-\d{2}$/.test(requestedEvent) ? requestedEvent : undefined
  const patternDashboard = await buildCurrentPatternDashboard(rootDir)
  const playbackData = buildVRPlaybackView({
    standardArchive: standardPlayback,
    survivalArchive: survivalPlayback,
    rootDir,
  })
  const strategyArena: StrategyArenaView | null = buildStrategyArena({
    standardArchive: standardPlayback,
    survivalArchive: survivalPlayback,
  })

  if (!raw) {
    return (
      <main style={{ padding: '2.6rem', color: '#94a3b8', fontFamily: 'monospace' }}>
        <h2 style={{ color: '#ef4444' }}>vr_survival.json not found</h2>
        <p>
          Run:{' '}
          <code style={{ background: '#111827', padding: '0.26rem 0.65rem', borderRadius: 6 }}>
            py C:/Temp/build_vr_survival.py
          </code>
        </p>
        <a href="/risk-v1" style={{ color: '#818cf8' }}>
          Risk System v1
        </a>
      </main>
    )
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0c0e13',
        color: '#e5e7eb',
        fontFamily: "'Inter','Segoe UI',sans-serif",
        padding: '1.35rem 1.5rem',
      }}
    >
      <div style={{ maxWidth: 1460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              MarketFlow - Leverage Exposure Control
            </div>
            <h1 style={{ fontSize: '2.3rem', fontWeight: 900, color: '#f8fafc', margin: '0.35rem 0 0' }}>
              VR Survival System v1
            </h1>
            <div style={{ fontSize: '0.92rem', color: '#94a3b8', marginTop: 8, lineHeight: 1.6, maxWidth: 760 }}>
              Step 1 skeleton for the VR Survival System. The page structure is separated from the Standard
              Risk System and reserved for leverage exposure control.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="/risk-v1" style={navLinkStyle}>
              Standard (QQQ)
            </a>
            <a href="/backtest" style={navLinkStyle}>
              Backtests
            </a>
            <a href="/crash" style={navLinkStyle}>
              Crash Hub
            </a>
            <a href="/dashboard" style={navLinkStyle}>
              Dashboard
            </a>
          </div>
        </div>

        <VRSurvival
          data={raw}
          heatmapData={heatmapData}
          patternDashboard={patternDashboard}
          playbackData={playbackData}
          strategyArena={strategyArena}
          initialTab={initialTab}
          initialPlaybackEventId={initialPlaybackEventId}
        />

        <div style={{ fontSize: '0.75rem', color: '#475569', textAlign: 'center', paddingTop: '0.4rem' }}>
          Generated: {raw.run_id} - VR Survival System v1
        </div>
      </div>
    </main>
  )
}

const navLinkStyle: CSSProperties = {
  fontSize: '0.85rem',
  color: '#94a3b8',
  textDecoration: 'none',
  padding: '0.45rem 0.95rem',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.02)',
}
