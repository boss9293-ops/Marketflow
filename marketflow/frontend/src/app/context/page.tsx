import Link from 'next/link'
import MacroBadgeStrip from '@/components/MacroBadgeStrip'
import MarketContextCard from '@/components/MarketContextCard'
import { readCacheJson } from '@/lib/readCacheJson'

type OverviewCache = {
  market_phase?: string | null
  gate_delta5d?: number | null
  gate_score?: number | null
}

type StateCache = {
  data_date?: string | null
  phase?: { label?: string | null } | null
}

type TapeItem = { symbol?: string | null; last?: number | null; chg_pct?: number | null }
type TapeCache = { items?: TapeItem[] | null }

type MacroLayerCache = {
  macro_pressure_score?: number | null
  lpi?: { state?: 'Loose' | 'Neutral' | 'Tight' | null } | null
  rpi?: { state?: 'Accommodative' | 'Neutral' | 'Restrictive' | null } | null
  vri?: { state?: 'Compressed' | 'Normal' | 'Expanding' | null } | null
  xapi?: { aligned?: boolean | null; defensive?: boolean | null } | null
}

type MarketHealthCache = {
  scores?: {
    breadth?: { score?: number | null; label_en?: string | null; label_ko?: string | null } | null
    trend?: { label_en?: string | null } | null
  } | null
}

type BriefingPara = { text?: string | null }
type BriefingCache = {
  headline?: { ko?: string | null; en?: string | null } | null
  paragraphs?: { ko?: BriefingPara[] | null } | null
}

type ContextNewsCache = {
  news_status?: string | null
  articles?: Array<{ title?: string | null; publisher?: string | null; published_at?: string | null; url?: string | null }> | null
  news_brief?: { headline?: string | null; summary_2sentences?: string | null } | null
  validation_status?: 'OK' | 'Watch' | null
  validation_snapshot_date?: string | null
  sensor_snapshot?: {
    snapshot_date?: string | null
    LPI?: { status?: string | null; value?: number | null } | null
    RPI?: { status?: string | null; value?: number | null } | null
    VRI?: { status?: string | null; value?: number | null } | null
    XCONF?: { status?: string | null; value?: number | null } | null
    GHEDGE?: { status?: string | null; value?: number | null } | null
    MPS?: { status?: string | null; value?: number | null } | null
  } | null
}

function toTwoSentences(text: string | null | undefined): string {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const parts = raw.split(/(?<=[.!?。])\s+/).filter(Boolean)
  if (parts.length <= 2) return raw
  return `${parts[0]} ${parts[1]}`
}

export default async function ContextPage() {
  const [overview, state, tape, macroLayer, marketHealth, briefing, contextNews] = await Promise.all([
    readCacheJson<OverviewCache>('overview.json', {}),
    readCacheJson<StateCache>('market_state.json', {}),
    readCacheJson<TapeCache>('market_tape.json', {}),
    readCacheJson<MacroLayerCache>('macro_layer.json', {}),
    readCacheJson<MarketHealthCache>('market_health.json', {}),
    readCacheJson<BriefingCache>('daily_briefing.json', {}),
    readCacheJson<ContextNewsCache>('context_news.json', {}),
  ])

  const vix = (tape.items || []).find((x) => x?.symbol === 'VIX')
  const vixChg = typeof vix?.chg_pct === 'number' ? vix.chg_pct : null
  const inferredLpi = macroLayer.lpi?.state ?? ((overview.gate_delta5d ?? 0) < -2 ? 'Tight' : (overview.gate_delta5d ?? 0) > 2 ? 'Loose' : 'Neutral')
  const inferredRpi = macroLayer.rpi?.state ?? ((vix?.last ?? 18) > 22 ? 'Restrictive' : (vix?.last ?? 18) < 16 ? 'Accommodative' : 'Neutral')
  const inferredVri = macroLayer.vri?.state ?? (vixChg != null && vixChg > 5 ? 'Expanding' : vixChg != null && vixChg < -3 ? 'Compressed' : 'Normal')
  const xconf =
    contextNews.sensor_snapshot?.XCONF?.status ||
    (macroLayer.xapi?.defensive ? 'Stress' : macroLayer.xapi?.aligned ? 'Align' : 'Mixed')
  const ghedge = contextNews.sensor_snapshot?.GHEDGE?.status || 'Mixed'
  const mps =
    (typeof contextNews.sensor_snapshot?.MPS?.value === 'number' ? contextNews.sensor_snapshot?.MPS?.value : null) ??
    (typeof macroLayer.macro_pressure_score === 'number' ? macroLayer.macro_pressure_score : null)
  const regime = (overview.market_phase || state.phase?.label || 'Normal').toUpperCase()
  const briefingParas = briefing.paragraphs?.ko || []
  const newsHeadline =
    contextNews.news_brief?.headline ||
    briefing.headline?.en ||
    briefing.headline?.ko ||
    'Macro headline unavailable for today.'
  const newsSummary =
    toTwoSentences(contextNews.news_brief?.summary_2sentences || '') ||
    toTwoSentences(briefingParas[0]?.text || briefingParas[1]?.text || '')

  return (
    <div className="bg-black min-h-screen text-white">
      <div className="max-w-[1200px] mx-auto px-8 py-10 space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="mb-2">
              <Link href="/dashboard" className="text-xs text-slate-400 hover:text-slate-300 transition-colors">
                ← Dashboard
              </Link>
            </div>
            <h1 className="text-5xl font-bold tracking-tight">
              <span className="mf-bil-ko">시장 컨텍스트</span>
              <span className="mf-bil-en">Market Context</span>
            </h1>
            <p className="text-slate-300 mt-2 text-base">
              <span className="mf-bil-ko">환경 + 구조 + 상태를 종합하는 해석 레이어 (읽기 전용)</span>
              <span className="mf-bil-en">Environment + Structure + State interpretation layer (read-only)</span>
            </p>
          </div>
          <MacroBadgeStrip />
        </div>

        <MarketContextCard
          macro={{
            lpiBand: contextNews.sensor_snapshot?.LPI?.status || (inferredLpi === 'Loose' ? 'Easy' : inferredLpi),
            rpiBand: contextNews.sensor_snapshot?.RPI?.status || (inferredRpi === 'Accommodative' ? 'Easing' : inferredRpi),
            vriBand: contextNews.sensor_snapshot?.VRI?.status || inferredVri,
            xconfLabel: xconf,
            ghedgeLabel: ghedge,
            mps,
            snapshotDate: contextNews.sensor_snapshot?.snapshot_date || contextNews.validation_snapshot_date || null,
          }}
          health={{
            breadthScore: marketHealth.scores?.breadth?.score ?? null,
            participationLabel: marketHealth.scores?.breadth?.label_en ?? marketHealth.scores?.breadth?.label_ko ?? null,
            trendStrengthBand: marketHealth.scores?.trend?.label_en ?? null,
          }}
          state={{
            regimeLabel: regime,
            crashPhase: regime === 'SHOCK',
            riskToken: null,
            shockFlag: regime === 'SHOCK',
            marketStale: (contextNews.news_status || 'SensorOnly') === 'Stale',
          }}
          validation={{
            status: contextNews.validation_status || 'Watch',
            snapshotDate: contextNews.validation_snapshot_date || contextNews.sensor_snapshot?.snapshot_date || null,
          }}
          news={{
            headline: newsHeadline,
            summary: newsSummary,
            status: contextNews.news_status || 'SensorOnly',
            sources: contextNews.articles || [],
          }}
        />
      </div>
    </div>
  )
}
