import Link from 'next/link'
import fs from 'fs/promises'
import path from 'path'
import Database from 'better-sqlite3'
import { readCacheJson } from '@/lib/readCacheJson'
import {
  adjustExposureBandUpper,
  formatMacroMetricRow,
  getLpiSafeCopy,
  resolveMacroPressure,
} from '@/lib/macroLayer'
import ValidationRoom from '@/components/macro/ValidationRoom'
import { type ConditionStudyCache } from '@/components/macro/ConditionStudyCard'
import ValidationBadge from '@/components/macro/ValidationBadge'
import { MACRO_GLOSSARY, getGlossaryTitle, type MacroGlossaryKey } from '@/lib/macro/glossary'
import LiveTimeline from '@/components/macro/LiveTimeline'

type TapeItem = { symbol: string; last?: number | null; chg_pct?: number | null }
type TapeCache = { items?: TapeItem[]; data_date?: string | null }
type OverviewCache = { gate_score?: number | null; gate_delta5d?: number | null; latest_date?: string | null }
type ActionCache = { exposure_guidance?: { exposure_band?: string | null } | null }
type MacroSummaryApi = {
  policy_version?: string
  asof_date?: string | null
  macro_pressure?: {
    score?: number | null
    state?: string | null
    confidence?: number | null
    bar?: { min?: number; max?: number }
  }
  mps?: {
    score?: number | null
    state?: string | null
    confidence?: number | null
    confidence_badge?: string | null
    last_updated?: string | null
    stale?: boolean
  }
  indexes?: Record<string, { score?: number | null; state?: string | null; confidence?: number | null; confidence_badge?: string | null; last_updated?: string | null; stale?: boolean }>
  exposure_modifier?: {
    upper_cap_delta_pct?: number | null
    reasons?: string[]
    rule_flags?: Record<string, boolean>
  }
  series_status?: Record<string, {
    last_value_date?: string | null
    last_updated_at?: string | null
    last_updated?: string | null
    stale?: boolean
    frequency?: string
    cadence?: string
  }>
}
type MacroDetailApi = {
  policy_version?: string
  asof_date?: string | null
  macro_pressure?: {
    score?: number | null
    state?: string | null
    confidence?: number | null
  }
  mps_confidence?: number | null
  confidence_debug?: {
    noisy_flag?: boolean
    penalties_applied?: Array<{ layer?: string; type?: string; value?: number }>
  }
  layers?: Record<string, {
    label?: string
    score?: number | null
    state?: string | null
    confidence?: number | null
    confidence_badge?: string | null
    last_updated?: string | null
    stale?: boolean
    drivers?: Array<{
      feature_id?: string
      series_id?: string
      raw_value?: number | null
      raw_unit?: string | null
      transformed_value?: number | null
      transformed_unit?: string | null
      direction?: number | null
      winsorized?: boolean
      percentile_5y?: number | null
      percentile?: number | null
      static_band_key?: string | null
      static_band_label?: string | null
      note?: string | null
      last_value_date?: string | null
      last_updated?: string | null
      stale?: boolean
    }>
  }>
}

type MacroLayerCache = {
  data_date?: string | null
  macro_pressure_score?: number | null
  lpi?: { value?: number | null; state?: 'Loose' | 'Neutral' | 'Tight' | null; last_updated?: string | null }
  vri?: { value?: number | null; state?: 'Compressed' | 'Normal' | 'Expanding' | null; last_updated?: string | null }
  rpi?: { value?: number | null; state?: 'Accommodative' | 'Neutral' | 'Restrictive' | null; last_updated?: string | null }
  xapi?: { aligned?: boolean | null; defensive?: boolean | null }
  walcl?: { value?: number | null; last_updated?: string | null }
  effr_1m_change_bp?: { value?: number | null; last_updated?: string | null }
  rrp?: { value?: number | null; last_updated?: string | null }
  metrics?: Record<string, any>
  signals?: Record<string, any>
}

type MarketHistoryRow = {
  date: string
  qqq_n: number | null
  tqqq_n: number | null
  vix: number | null
}

type MacroSnapshotFile = {
  snapshot_date?: string
  computed?: {
    MPS?: {
      value?: number | null
    }
  }
}

function pickNum(...vals: any[]): number | null {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}
function pickStr(...vals: any[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v
  return null
}
function pickObj<T extends object>(...vals: any[]): T | null {
  for (const v of vals) if (v && typeof v === 'object' && !Array.isArray(v)) return v as T
  return null
}
function clampNum(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function shiftIsoDate(date: string, days: number) {
  const base = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return date
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

function openReadonlyDb(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      return new Database(candidate, { readonly: true, fileMustExist: true })
    } catch {
      // Try next candidate path.
    }
  }
  return null
}

async function readLiveMpsSnapshots(): Promise<{ byDate: Map<string, number>; lastDate: string | null }> {
  const dirs = [
    path.resolve(process.cwd(), '..', 'backend', 'storage', 'macro_snapshots'),
    path.resolve(process.cwd(), 'backend', 'storage', 'macro_snapshots'),
  ]
  for (const dir of dirs) {
    try {
      const names = await fs.readdir(dir)
      const files = names.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
      const byDate = new Map<string, number>()
      for (const name of files) {
        try {
          const raw = await fs.readFile(path.join(dir, name), 'utf-8')
          const parsed = JSON.parse(raw) as MacroSnapshotFile
          const date = typeof parsed.snapshot_date === 'string' ? parsed.snapshot_date : name.replace(/\.json$/, '')
          const value = parsed.computed?.MPS?.value
          if (typeof value === 'number' && Number.isFinite(value)) {
            byDate.set(date, value)
          }
        } catch {
          // Skip malformed snapshot files.
        }
      }
      const lastDate = byDate.size ? Array.from(byDate.keys()).sort().at(-1) ?? null : null
      return { byDate, lastDate }
    } catch {
      // Try next candidate directory.
    }
  }
  return { byDate: new Map<string, number>(), lastDate: null }
}

function readLiveMarketSeries(): { rows: MarketHistoryRow[]; lastDate: string | null } {
  const marketDb = openReadonlyDb([
    path.resolve(process.cwd(), '..', 'data', 'marketflow.db'),
    path.resolve(process.cwd(), 'data', 'marketflow.db'),
  ])
  if (!marketDb) return { rows: [], lastDate: null }

  try {
    const latestQqq = marketDb
      .prepare("SELECT MAX(date) AS lastDate FROM ohlcv_daily WHERE symbol = 'QQQ'")
      .get() as { lastDate?: string | null }
    const lastDate = typeof latestQqq?.lastDate === 'string' ? latestQqq.lastDate : null
    if (!lastDate) return { rows: [], lastDate: null }

    const startDate = shiftIsoDate(lastDate, -400)
    const qqqRows = marketDb
      .prepare("SELECT date, close FROM ohlcv_daily WHERE symbol = ? AND date >= ? ORDER BY date")
      .all('QQQ', startDate) as Array<{ date: string; close: number }>
    const tqqqRows = marketDb
      .prepare("SELECT date, close FROM ohlcv_daily WHERE symbol = ? AND date >= ? ORDER BY date")
      .all('TQQQ', startDate) as Array<{ date: string; close: number }>
    const vixRows = marketDb
      .prepare("SELECT date, vix FROM market_daily WHERE date >= ? AND vix IS NOT NULL ORDER BY date")
      .all(startDate) as Array<{ date: string; vix: number }>

    const tqqqByDate = new Map(
      tqqqRows
        .filter((row) => typeof row?.date === 'string' && typeof row?.close === 'number')
        .map((row) => [row.date, row.close])
    )
    const vixByDate = new Map(
      vixRows
        .filter((row) => typeof row?.date === 'string' && typeof row?.vix === 'number')
        .map((row) => [row.date, row.vix])
    )

    return {
      lastDate,
      rows: qqqRows
        .filter((row) => typeof row?.date === 'string' && typeof row?.close === 'number')
        .map((row) => ({
          date: row.date,
          qqq_n: row.close,
          tqqq_n: tqqqByDate.get(row.date) ?? null,
          vix: vixByDate.get(row.date) ?? null,
        })),
    }
  } finally {
    marketDb.close()
  }
}

export default async function MacroPage({ searchParams }: { searchParams: { tab?: string } }) {
  const currentTab = (String(searchParams.tab || 'status') as 'status' | 'validation')
  const [overview, tape, action, macroLayer, macroSummary, macroDetail, conditionStudy, liveMpsSnapshots] = await Promise.all([
    readCacheJson<OverviewCache>('overview.json', {}),
    readCacheJson<TapeCache>('market_tape.json', { items: [] }),
    readCacheJson<ActionCache>('action_snapshot.json', {}),
    readCacheJson<MacroLayerCache>('macro_layer.json', {}),
    readCacheJson<MacroSummaryApi>('macro_summary.json', {}),
    readCacheJson<MacroDetailApi>('macro_detail.json', {}),
    readCacheJson<ConditionStudyCache | null>('condition_study_2018.json', null),
    readLiveMpsSnapshots(),
  ])

  const dataDate = macroSummary.asof_date || macroLayer.data_date || tape.data_date || overview.latest_date || '--'
  const gateScore = typeof overview.gate_score === 'number' ? overview.gate_score : null
  const vixItem = (tape.items || []).find((i) => i.symbol === 'VIX')
  const vixLast = typeof vixItem?.last === 'number' ? vixItem.last : null
  const vixChg = typeof vixItem?.chg_pct === 'number' ? vixItem.chg_pct : null
  const exposureBand = action.exposure_guidance?.exposure_band || null

  const lpiObj = pickObj<{ value?: number | null; state?: 'Loose' | 'Neutral' | 'Tight' | null; last_updated?: string | null }>(
    macroLayer.lpi,
    macroLayer.metrics?.lpi,
    macroLayer.signals?.lpi
  )
  const vriObj = pickObj<{ value?: number | null; state?: 'Compressed' | 'Normal' | 'Expanding' | null; last_updated?: string | null }>(
    macroLayer.vri,
    macroLayer.metrics?.vri,
    macroLayer.signals?.vri
  )
  const rpiObj = pickObj<{ value?: number | null; state?: 'Accommodative' | 'Neutral' | 'Restrictive' | null; last_updated?: string | null }>(
    macroLayer.rpi,
    macroLayer.metrics?.rpi,
    macroLayer.signals?.rpi
  )
  const walclObj = pickObj<{ value?: number | null; last_updated?: string | null }>(
    macroLayer.walcl,
    macroLayer.metrics?.walcl,
    macroLayer.metrics?.WALCL
  )
  const effrDeltaObj = pickObj<{ value?: number | null; last_updated?: string | null }>(
    macroLayer.effr_1m_change_bp,
    macroLayer.metrics?.effr_1m_change_bp,
    macroLayer.metrics?.effr_delta_1m_bp,
    macroLayer.metrics?.EFFR_1M_CHANGE_BP
  )
  const rrpObj = pickObj<{ value?: number | null; last_updated?: string | null }>(
    macroLayer.rrp,
    macroLayer.metrics?.rrp,
    macroLayer.metrics?.RRP
  )

  const inferredLpiState =
    lpiObj?.state ?? ((overview.gate_delta5d ?? 0) < -2 ? 'Tight' : (overview.gate_delta5d ?? 0) > 2 ? 'Loose' : 'Neutral')
  const inferredVriState =
    vriObj?.state ?? (vixChg != null && vixChg > 5 ? 'Expanding' : vixChg != null && vixChg < -3 ? 'Compressed' : 'Normal')
  const inferredRpiState =
    rpiObj?.state ?? ((vixLast ?? 18) > 22 ? 'Restrictive' : (vixLast ?? 18) < 16 ? 'Accommodative' : 'Neutral')
  const breadthWeak = gateScore != null ? gateScore < 40 : false

  const proxyMacroPressureScore =
    pickNum(macroLayer.macro_pressure_score, macroLayer.metrics?.macro_pressure_score, macroLayer.signals?.macro_pressure_score) ??
    Math.round(
      clampNum(
        (inferredLpiState === 'Tight' ? 28 : inferredLpiState === 'Neutral' ? 15 : 4) +
        (inferredVriState === 'Expanding' ? 28 : inferredVriState === 'Normal' ? 15 : 5) +
        (inferredRpiState === 'Restrictive' ? 22 : inferredRpiState === 'Neutral' ? 12 : 4) +
        (breadthWeak ? 22 : gateScore != null && gateScore < 60 ? 12 : 4),
        0,
        100
      )
    )

  const macroPressure = resolveMacroPressure({
    macroPressureScore: proxyMacroPressureScore,
    lpiState: inferredLpiState,
    vriState: inferredVriState,
    rpiState: inferredRpiState,
    breadthWeak,
  })
  const adjBand = adjustExposureBandUpper(exposureBand, macroPressure.exposureUpperModifierPct)
  const lpiSafe = getLpiSafeCopy(inferredLpiState)
  const apiMacroPressure = macroSummary.macro_pressure || {}
  const apiMps = macroSummary.mps || {}
  const apiMpsScore =
    typeof apiMacroPressure.score === 'number'
      ? apiMacroPressure.score
      : (typeof apiMps.score === 'number' ? apiMps.score : null)
  const shownMpsScore = apiMpsScore ?? macroPressure.score
  const shownMpsState = apiMacroPressure.state || apiMps.state || macroPressure.bucket
  const shownMpsConf =
    typeof apiMacroPressure.confidence === 'number'
      ? apiMacroPressure.confidence
      : (typeof apiMps.confidence === 'number' ? apiMps.confidence : null)
  const shownMpsConfBadge = apiMps.confidence_badge || (shownMpsConf == null ? null : shownMpsConf >= 80 ? 'Normal' : shownMpsConf >= 50 ? 'Data limited' : 'Partial')
  const apiExposureMod = macroSummary.exposure_modifier?.upper_cap_delta_pct
  const apiExposureReasons = Array.isArray(macroSummary.exposure_modifier?.reasons) ? macroSummary.exposure_modifier!.reasons! : []
  const shownExposureMod = typeof apiExposureMod === 'number' ? apiExposureMod : macroPressure.exposureUpperModifierPct

  const liveMarketSeries = readLiveMarketSeries()
  let lastKnownMps: number | null = null
  const liveSeriesRaw = liveMarketSeries.rows.map((row) => {
      const date = row.date
      const snapshotMps = liveMpsSnapshots.byDate.get(date)
      if (typeof snapshotMps === 'number') {
        lastKnownMps = snapshotMps
      }
      const resolvedMps =
        typeof snapshotMps === 'number'
          ? snapshotMps
          : liveMpsSnapshots.lastDate && date > liveMpsSnapshots.lastDate
            ? (shownMpsScore ?? lastKnownMps)
            : lastKnownMps
      return {
        date,
        mps: typeof resolvedMps === 'number' && Number.isFinite(resolvedMps) ? resolvedMps : null,
        vix: typeof row.vix === 'number' && Number.isFinite(row.vix) ? row.vix : null,
        qqq_n: typeof row.qqq_n === 'number' && Number.isFinite(row.qqq_n) ? row.qqq_n : null,
        tqqq_n: typeof row.tqqq_n === 'number' && Number.isFinite(row.tqqq_n) ? row.tqqq_n : null,
      }
    })

  const lastStoredVixDate =
    liveSeriesRaw
      .filter((row) => typeof row.vix === 'number')
      .at(-1)?.date ?? null
  const firstVixValue =
    liveSeriesRaw.find((row) => typeof row.vix === 'number')?.vix ??
    (typeof vixLast === 'number' ? vixLast : null)
  let lastVixValue = firstVixValue
  const liveSeries = liveSeriesRaw.map((row) => {
    const vix =
      typeof row.vix === 'number'
        ? row.vix
        : lastStoredVixDate && row.date > lastStoredVixDate
          ? (typeof vixLast === 'number' ? vixLast : lastVixValue)
          : lastVixValue
    if (typeof vix === 'number') lastVixValue = vix
    return { ...row, vix }
  })

  const liveLast = liveSeries[liveSeries.length - 1]
  const liveLastDate = liveLast?.date || dataDate

  const macroRows = [
    formatMacroMetricRow({
      key: 'VIX',
      value: vixLast,
      lastUpdated: pickStr(vriObj?.last_updated, tape.data_date, dataDate),
    }),
    formatMacroMetricRow({
      key: 'EFFR_1M_CHANGE_BP',
      value: effrDeltaObj?.value ?? null,
      lastUpdated: effrDeltaObj?.last_updated || null,
    }),
    formatMacroMetricRow({
      key: 'WALCL',
      value: walclObj?.value ?? null,
      lastUpdated: walclObj?.last_updated || null,
    }),
    formatMacroMetricRow({
      key: 'RRP',
      value: rrpObj?.value ?? null,
      lastUpdated: rrpObj?.last_updated || null,
    }),
  ]

  if (currentTab !== 'validation') {
    return (
      <div className="bg-black min-h-screen text-white">
        <div className="max-w-[1440px] mx-auto px-8 py-10">
          <div className="mb-6">
            <Link href="/dashboard" className="text-xs text-slate-300 hover:text-slate-100 transition-colors">
              Dashboard
            </Link>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-5xl font-bold tracking-tight">Macro Layer — Live Status</h1>
              <p className="text-slate-300 mt-2 text-base">
                Slow sensors for environment & pressure context (not a trigger engine)
              </p>
              <p className="text-slate-400 mt-1 text-sm">This view is for live monitoring, not forecasting.</p>
            </div>
            <div className="flex items-center gap-2.5 px-4 py-2 bg-[#1a1a1a] rounded-full border border-[#2a2a2a] self-start flex-wrap">
              <span className="px-2 py-0.5 rounded-full border border-white/10 text-slate-200 bg-white/5 text-xs">Slow Sensors</span>
              <span className="text-xs text-slate-300">Last updated: {dataDate}</span>
              <ValidationBadge />
            </div>
          </div>

          <div className="flex items-center gap-8 border-b border-[#2a2a2a] mb-8">
            <Link
              href="/macro?tab=status"
              className="pb-4 text-sm font-medium transition-all relative text-white"
            >
              Live Status
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-500" />
            </Link>
            <Link
              href="/macro?tab=validation"
              className="pb-4 text-sm font-medium transition-all relative text-slate-500 hover:text-slate-300"
            >
              Historical Playback
            </Link>
          </div>

          <LiveTimeline
            series={liveSeries}
            currentMps={shownMpsScore}
            currentVix={vixLast}
            dataDate={liveLastDate}
          />
        </div>
      </div>
    )
  }

  const currentTabView: string = String(currentTab)


  return (
    <div className="bg-black min-h-screen text-white">
      <div className="max-w-[1440px] mx-auto px-8 py-10">
        <div className="mb-6">
          <Link href="/dashboard" className="text-xs text-slate-300 hover:text-slate-100 transition-colors">
            Dashboard
          </Link>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-5xl font-bold tracking-tight">Historical Playback Timeline</h1>
            <p className="text-slate-300 mt-2 text-base">
              Event-study playback for historical macro regimes (2020/2022/2024/2025 + baseline)
            </p>
            <p className="text-slate-400 mt-1 text-sm">This page is for learning and review, not real-time narration.</p>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2 bg-[#1a1a1a] rounded-full border border-[#2a2a2a] self-start flex-wrap">
            <span className="px-2 py-0.5 rounded-full border border-white/10 text-slate-200 bg-white/5 text-xs">Slow Sensors</span>
            <span className="text-xs text-slate-300">Last updated: {dataDate}</span>
            <ValidationBadge />
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-8 border-b border-[#2a2a2a] mb-8">
          <Link
            href="/macro?tab=status"
            className={`pb-4 text-sm font-medium transition-all relative ${currentTabView === 'status' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Live Status
            {currentTabView === 'status' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-500" />}
          </Link>
          <Link
            href="/macro?tab=validation"
            className={`pb-4 text-sm font-medium transition-all relative ${currentTabView === 'validation' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Historical Playback
            {currentTabView === 'validation' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-500" />}
          </Link>
        </div>

        {currentTabView === 'validation' ? (
          <>
            <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-[#2a2a2a] mb-6">
              <div className="text-sm font-semibold text-slate-100">Playback Guide</div>
              <div className="text-xs text-slate-400 mt-1">
                Historical timelines map MPS vs VIX vs price response for each regime year.
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Narratives are fixed event studies (not live signals).
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                {([
                  'MPS',
                  'VIX',
                  'LPI',
                  'RPI',
                  'VRI',
                  'CSI',
                  'REALIZED_VOL',
                  'DD_VELOCITY',
                  'QQQ_TQQQ_YTD',
                ] as MacroGlossaryKey[]).map((key) => (
                  <span
                    key={key}
                    title={getGlossaryTitle(key)}
                    className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5"
                  >
                    {MACRO_GLOSSARY[key].label}
                  </span>
                ))}
              </div>
            </div>
            <ValidationRoom conditionStudy={conditionStudy} />
            <div className="mt-6 text-xs text-slate-400">
              Macro Layer interprets environmental pressure. Risk Engine manages execution triggers.
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1.25fr] gap-6 mb-8">
              <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-300">Macro Pressure Score</div>
                    <div className="text-5xl font-bold mt-1">{shownMpsScore ?? '--'}</div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <span className={`px-2.5 py-1 rounded-full text-xs border ${shownMpsState === 'Extreme' ? 'border-red-400/30 text-red-300 bg-red-500/10'
                      : shownMpsState === 'Pressure' || shownMpsState === 'High' ? 'border-amber-400/30 text-amber-300 bg-amber-400/10'
                        : shownMpsState === 'Mixed' || shownMpsState === 'Low' ? 'border-slate-400/30 text-slate-100 bg-white/5'
                          : 'border-emerald-400/30 text-emerald-300 bg-emerald-500/10'
                      }`}>
                      {shownMpsState}
                    </span>
                    {shownMpsConfBadge && (
                      <span className="px-2 py-1 rounded-full text-[10px] border border-white/10 text-slate-200 bg-white/5">
                        Conf {shownMpsConf ?? '--'} · {shownMpsConfBadge}
                      </span>
                    )}
                    {macroPressure.pressureFlags.liquidityVolExtreme && (
                      <span className="px-2 py-1 rounded-full text-[10px] border border-amber-400/30 text-amber-300 bg-amber-400/10">
                        LPI Tight + VRI Expanding
                      </span>
                    )}
                    {macroPressure.pressureFlags.restrictiveBreadthExtreme && (
                      <span className="px-2 py-1 rounded-full text-[10px] border border-red-400/30 text-red-300 bg-red-500/10">
                        RPI Restrictive + Breadth Weak
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-sm text-slate-300 leading-relaxed mb-4">
                  {macroPressure.tone === 'defensive_tilt'
                    ? 'Macro pressure is elevated. Keep a defensive tilt and reduce expansion speed until pressure badges clear.'
                    : macroPressure.tone === 'speed_control'
                      ? 'Macro pressure requires speed control. Prefer phased adds over aggressive expansion.'
                      : 'Macro conditions are not forcing a posture change. Use them as environment context while Risk Engine handles fast shocks.'}
                </div>

                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 mb-3">
                  <div className="text-xs uppercase tracking-wider text-slate-300 mb-1">Exposure Ceiling Modifier</div>
                  <div className="text-lg font-semibold">
                    {adjBand.adjusted ?? (exposureBand || '--')}
                    {adjBand.original && adjBand.adjusted && adjBand.original !== adjBand.adjusted ? (
                      <span className="text-xs text-slate-300 ml-2">from {adjBand.original}</span>
                    ) : null}
                    <span className="text-xs text-slate-300 ml-2">({shownExposureMod}%p upper)</span>
                  </div>
                  <div className="text-xs text-slate-300 mt-1">
                    Macro layer modifies exposure ceiling only. Global Risk Token remains separate.
                  </div>
                  {apiExposureReasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {apiExposureReasons.map((r, i) => (
                        <span key={`${r}-${i}`} className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-[10px] text-slate-200">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="text-slate-300 text-xs uppercase tracking-wider mb-1">LPI</div>
                    <div className="font-semibold">{lpiSafe.label}</div>
                    <div className="text-slate-300 text-xs mt-1" title={lpiSafe.tooltip}>{lpiSafe.text}</div>
                  </div>
                </div>
              </div>

              <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div>
                    <div className="text-lg font-semibold">Macro Detail</div>
                    <div className="text-xs text-slate-300 mt-1">Value + status + reference band + last updated</div>
                  </div>
                  <Link href="/state" className="text-xs text-sky-300 hover:text-sky-200">Back to State</Link>
                </div>
                <div className="space-y-2">
                  {(['LPI', 'RPI', 'VRI'] as const).map((k) => {
                    const layer = macroDetail.layers?.[k]
                    if (!layer) return null
                    return (
                      <div key={`layer-${k}`} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="font-semibold">{layer.label || k}</div>
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-100">
                              {layer.score != null ? `${Math.round(layer.score)}` : '--'} · {layer.state || '--'}
                            </span>
                            <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-200">
                              Conf {layer.confidence ?? '--'} · {layer.confidence_badge || '--'}
                            </span>
                            {layer.stale && <span className="px-2 py-0.5 rounded-full border border-red-400/25 text-red-300 bg-red-500/10">Stale</span>}
                          </div>
                        </div>
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-xs min-w-[760px]">
                            <thead>
                              <tr className="text-slate-300 border-b border-white/5">
                                <th className="text-left py-1.5 pr-2 font-semibold">Metric</th>
                                <th className="text-left py-1.5 pr-2 font-semibold">Raw</th>
                                <th className="text-left py-1.5 pr-2 font-semibold">Transformed</th>
                                <th className="text-left py-1.5 pr-2 font-semibold">5Y %ile</th>
                                <th className="text-left py-1.5 pr-2 font-semibold">Static Band</th>
                                <th className="text-left py-1.5 pr-2 font-semibold">Updated</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(layer.drivers || []).map((d, idx) => (
                                <tr key={`${k}-${d.feature_id || idx}`} className="border-b border-white/[0.03] last:border-b-0">
                                  <td className="py-1.5 pr-2 text-slate-100">
                                    <div>{d.feature_id || '--'}</div>
                                    {d.series_id ? <div className="text-[10px] text-slate-300 mt-0.5">{d.series_id}</div> : null}
                                  </td>
                                  <td className="py-1.5 pr-2 text-slate-200">
                                    {typeof d.raw_value === 'number' ? d.raw_value.toFixed(2) : '--'}
                                    {d.raw_unit ? <span className="text-[10px] text-slate-300 ml-1">{d.raw_unit}</span> : null}
                                  </td>
                                  <td className="py-1.5 pr-2 text-slate-200">
                                    {typeof d.transformed_value === 'number' ? d.transformed_value.toFixed(2) : '--'}
                                    {d.transformed_unit ? <span className="text-[10px] text-slate-300 ml-1">{d.transformed_unit}</span> : null}
                                  </td>
                                  <td className="py-1.5 pr-2 text-slate-200">
                                    {typeof d.percentile_5y === 'number'
                                      ? d.percentile_5y.toFixed(1)
                                      : (typeof d.percentile === 'number' ? d.percentile.toFixed(1) : '--')}
                                  </td>
                                  <td className="py-1.5 pr-2 text-slate-200">
                                    <div>{d.static_band_label || '--'}</div>
                                    {d.static_band_key ? <div className="text-[10px] text-slate-300 mt-0.5">{d.static_band_key}</div> : null}
                                  </td>
                                  <td className="py-1.5 pr-2 text-slate-300">
                                    {(d.last_value_date || d.last_updated || '--')}{d.stale ? ' · stale' : ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                  {macroRows.map((row) => (
                    <div key={row.key} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="font-medium">{row.label}</div>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className={`px-2 py-0.5 rounded-full border ${row.status === 'GOOD' ? 'border-emerald-400/30 text-emerald-300 bg-emerald-500/10'
                            : row.status === 'WATCH' ? 'border-amber-400/30 text-amber-300 bg-amber-400/10'
                              : row.status === 'RISK' ? 'border-red-400/30 text-red-300 bg-red-500/10'
                                : 'border-slate-400/20 text-slate-200 bg-white/5'
                            }`}>
                            {row.status}
                          </span>
                          <span className="px-2 py-0.5 rounded-full border border-white/10 text-slate-200 bg-white/5">[{row.cadenceTag}]</span>
                          {row.stale && <span className="px-2 py-0.5 rounded-full border border-red-400/25 text-red-300 bg-red-500/10">Stale</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap mt-1.5">
                        <div className="text-lg font-bold">{row.valueText}</div>
                        <div className="text-xs text-slate-300">{row.referenceText}</div>
                        {row.lastUpdated ? <div className="text-xs text-slate-300">Updated {row.lastUpdated}</div> : null}
                      </div>
                      <div className="text-xs text-slate-300 leading-relaxed mt-1">{row.whyText}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-[#2a2a2a]">
              <div className="text-sm text-slate-300 leading-relaxed">
                <span className="text-slate-100 font-semibold">Concept separation:</span> Macro Layer = slow sensors (environment / pressure),
                <span className="text-slate-100 font-semibold"> Risk Engine</span> = fast sensors (shock / acceleration),
                <span className="text-slate-100 font-semibold"> VR</span> = Crash Override (separate room).
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

