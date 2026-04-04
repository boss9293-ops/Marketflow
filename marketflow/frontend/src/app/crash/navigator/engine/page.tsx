// Leverage Taming - Risk Engine (Navigator)
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

import Database from 'better-sqlite3'
import Link from 'next/link'
import path from 'path'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'
import { computeNavigatorStates, type NavigatorInput } from '@/lib/crash/navigatorState'
import { NAVIGATOR_ACTIONS_V1 } from '@/lib/crash/navigatorActions'
import { NAVIGATOR_MESSAGES_V1 } from '@/lib/crash/navigatorMessages'
import NavigatorProfileSelect from '@/components/crash/NavigatorProfileSelect'
import LeverageModuleNav from '@/components/crash/LeverageModuleNav'
import TqqqCandleConsole from '@/components/crash/TqqqCandleConsole'
import NavigatorAIAnalysis from '@/components/crash/NavigatorAIAnalysis'
import NavigatorEvidencePanel from '@/components/crash/NavigatorEvidencePanel'
import { logActingEntries, fetchRecentLogs, type ActingLogEntry } from '@/lib/crash/navigatorLogDb'

const STATE_COLORS: Record<string, string> = {
  NORMAL: '#22c55e',
  ACCELERATION_WATCH: '#38bdf8',
  DEFENSE_MODE: '#f59e0b',
  PANIC_EXTENSION: '#ef4444',
  STABILIZATION: '#a78bfa',
  STRUCTURAL_MODE: '#fb7185',
}

const PROFILE_CONFIGS = {
  balanced: {
    label: 'Standard Manual v1.0 (Balanced)',
    description: 'Balanced: base alert cadence',
    thresholds: { watch_ret2: -0.09, watch_ret3: -0.13, def_ret2: -0.1, def_ret3: -0.16, panic_ret3: -0.19 },
  },
  conservative: {
    label: 'Conservative',
    description: 'Earlier alerts, more frequent',
    thresholds: { watch_ret2: -0.08, watch_ret3: -0.12, def_ret2: -0.1, def_ret3: -0.16, panic_ret3: -0.19 },
  },
  strict: {
    label: 'Strict',
    description: 'Fewer alerts, reacts strongly once confirmed',
    thresholds: { watch_ret2: -0.09, watch_ret3: -0.13, def_ret2: -0.1, def_ret3: -0.16, panic_ret3: -0.18 },
  },
} as const

type ProfileKey = keyof typeof PROFILE_CONFIGS

function formatPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return '?'
  const pct = value * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function formatPctAbs(value: number | null) {
  if (value === null || Number.isNaN(value)) return '?'
  const pct = Math.abs(value) * 100
  return `${pct.toFixed(1)}%`
}

type Snapshot = {
  date: string
  qqq_close?: number
  qqq_sma200?: number
}

type SnapshotCache = {
  snapshots?: Snapshot[]
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

function volatility(arr: number[]) {
  if (arr.length === 0) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const varSum = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length
  return Math.sqrt(varSum)
}

function readLiveNavigatorSnapshots(): Snapshot[] {
  const db = openReadonlyDb([
    path.resolve(process.cwd(), '..', 'data', 'marketflow.db'),
    path.resolve(process.cwd(), 'data', 'marketflow.db'),
  ])
  if (!db) return []

  try {
    const rows = db.prepare(`
      SELECT
        o.date,
        o.close AS qqq_close,
        i.sma200 AS qqq_sma200
      FROM ohlcv_daily o
      LEFT JOIN indicators_daily i
        ON i.symbol = o.symbol AND i.date = o.date
      WHERE o.symbol = 'QQQ'
        AND o.close IS NOT NULL
      ORDER BY o.date ASC
    `).all() as Array<{ date: string; qqq_close: number | null; qqq_sma200: number | null }>

    return rows.map((row) => ({
      date: row.date,
      qqq_close: typeof row.qqq_close === 'number' ? row.qqq_close : undefined,
      qqq_sma200: typeof row.qqq_sma200 === 'number' ? row.qqq_sma200 : undefined,
    }))
  } finally {
    db.close()
  }
}

async function loadNavigatorSnapshots() {
  const live = readLiveNavigatorSnapshots()
  if (live.length) {
    return { snapshots: live, source: 'db' as const }
  }

  const candidates = [
    'snapshots_full_5y.json',
    'snapshots_full_2y.json',
    'snapshots_120d.json',
  ]
  for (const name of candidates) {
    const cache = await readCacheJsonOrNull<SnapshotCache>(name)
    if (cache?.snapshots && cache.snapshots.length) {
      return { snapshots: cache.snapshots, source: 'cache' as const }
    }
  }
  return { snapshots: [] as Snapshot[], source: 'cache' as const }
}

function computeRet3History(snapshots: Snapshot[], years: number) {
  if (!snapshots.length) return []
  const sorted = snapshots
    .filter((s) => typeof s.qqq_close === 'number')
    .map((s) => ({ date: s.date, close: s.qqq_close as number }))
    .sort((a, b) => (a.date > b.date ? 1 : -1))
  if (!sorted.length) return []
  const latestDate = new Date(sorted[sorted.length - 1].date)
  const cutoff = new Date(latestDate)
  cutoff.setFullYear(cutoff.getFullYear() - years)
  const filtered = sorted.filter((s) => new Date(s.date) >= cutoff)
  if (filtered.length < 4) return []
  const closes = filtered.map((s) => s.close)
  const ret3d: number[] = []
  closes.forEach((value, idx) => {
    if (idx < 3) return
    const prev = closes[idx - 3]
    if (!Number.isFinite(prev) || prev === 0) return
    ret3d.push(value / prev - 1)
  })
  return ret3d
}

export default async function CrashNavigatorEnginePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const lang = typeof searchParams?.lang === 'string' && searchParams.lang.toLowerCase() === 'en' ? 'en' : 'ko'
  const t = (ko: string, en: string) => (lang === 'en' ? en : ko)
  const { snapshots, source: snapshotSource } = await loadNavigatorSnapshots()

  const rawProfile = typeof searchParams?.profile === 'string' ? searchParams.profile : 'balanced'
  const profileKey: ProfileKey = (rawProfile in PROFILE_CONFIGS ? rawProfile : 'balanced') as ProfileKey
  const parseNum = (value?: string | string[]) => {
    const v = Array.isArray(value) ? value[0] : value
    if (!v) return null
    const n = Number.parseFloat(v)
    return Number.isFinite(n) ? n : null
  }

  const adminPreview = searchParams?.admin === '1'
  const adminThresholds = {
    watch_ret2: parseNum(searchParams?.w2),
    watch_ret3: parseNum(searchParams?.w3),
    def_ret2: parseNum(searchParams?.d2),
    def_ret3: parseNum(searchParams?.d3),
    panic_ret3: parseNum(searchParams?.p3),
  }

  const activeThresholds =
    adminPreview &&
    adminThresholds.watch_ret2 !== null &&
    adminThresholds.watch_ret3 !== null &&
    adminThresholds.def_ret2 !== null &&
    adminThresholds.def_ret3 !== null &&
    adminThresholds.panic_ret3 !== null
      ? {
          watch_ret2: adminThresholds.watch_ret2,
          watch_ret3: adminThresholds.watch_ret3,
          def_ret2: adminThresholds.def_ret2,
          def_ret3: adminThresholds.def_ret3,
          panic_ret3: adminThresholds.panic_ret3,
        }
      : PROFILE_CONFIGS[profileKey].thresholds

  const activeLabel = adminPreview
    ? 'Admin Preview (temporary)'
    : PROFILE_CONFIGS[profileKey].label

  let historyRet3d = computeRet3History(snapshots, 5)
  if (historyRet3d.length < 252) {
    historyRet3d = computeRet3History(snapshots, 2)
  }
  if (historyRet3d.length < 252) {
    historyRet3d = []
  }

  const series = snapshots
    .map((s) => ({
      date: s.date,
      close: typeof s.qqq_close === 'number' ? s.qqq_close : null,
      sma200: typeof s.qqq_sma200 === 'number' ? s.qqq_sma200 : null,
    }))
    .filter((s) => s.close !== null) as { date: string; close: number; sma200: number | null }[]

  const closes = series.length
    ? series.map((s) => s.close)
    : [100, 98, 96, 95, 94, 93, 92, 91, 92, 93, 94]
  const dates = series.length
    ? series.map((s) => s.date)
    : ['-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']

  const rolling = (arr: number[], window: number, fn: (slice: number[]) => number) =>
    arr.map((_, i) => {
      const start = Math.max(0, i - window + 1)
      const slice = arr.slice(start, i + 1)
      return fn(slice)
    })

  const ma50 = rolling(closes, 50, (s) => s.reduce((a, b) => a + b, 0) / s.length)
  const ma200 = rolling(closes, 200, (s) => s.reduce((a, b) => a + b, 0) / s.length)
  const high60 = rolling(closes, 60, (s) => Math.max(...s))

  const ret1 = closes.map((v, i) => (i === 0 ? 0 : v / closes[i - 1] - 1))
  const ret2 = closes.map((v, i) => (i < 2 ? 0 : v / closes[i - 2] - 1))
  const ret3 = closes.map((v, i) => (i < 3 ? 0 : v / closes[i - 3] - 1))
  const dd60 = closes.map((v, i) => v / high60[i] - 1)

  const inputs: NavigatorInput[] = closes.map((v, i) => ({
    date: dates[i],
    close: v,
    ret_1d: ret1[i],
    ret_2d: ret2[i],
    ret_3d: ret3[i],
    ma50: ma50[i] ?? null,
    ma200: ma200[i] ?? null,
    dd_60d: dd60[i],
  }))

  const outputs = computeNavigatorStates(inputs, {
    ...activeThresholds,
    ret3d_history: historyRet3d,
  })
  const latest = outputs[outputs.length - 1]

  const recentStates = outputs.slice(-5).map((o) => o.state)
  const flipCount = recentStates.reduce((acc, cur, i, arr) => {
    if (i === 0) return acc
    return acc + (cur !== arr[i - 1] ? 1 : 0)
  }, 0)
  const flipRisk = flipCount >= 2

  const distanceTo = (threshold: number, value: number | null) => {
    if (value === null || Number.isNaN(value)) return null
    return Math.max(0, threshold - value)
  }
  const defenseDistance = (() => {
    const d2 = distanceTo(activeThresholds.def_ret2, latest.evidence.ret_2d)
    const d3 = distanceTo(activeThresholds.def_ret3, latest.evidence.ret_3d)
    if (d2 === null && d3 === null) return null
    if (d2 === null) return d3
    if (d3 === null) return d2
    return Math.min(d2, d3)
  })()
  const panicDistance = distanceTo(activeThresholds.panic_ret3, latest.evidence.ret_3d)

  const ret3TailLine =
    latest.meta.ret3d_tail_pct === null
      ? null
      : lang === 'en'
        ? `The 3-day cumulative move ${formatPct(latest.evidence.ret_3d)} is in the bottom ${latest.meta.ret3d_tail_pct.toFixed(1)}% of the recent history window.`
        : `理쒓렐 3???꾩쟻 ?섎씫 ${formatPct(latest.evidence.ret_3d)}??(2018~?꾩옱) 湲곗? 湲됰씫 ?곸쐞 ${latest.meta.ret3d_tail_pct.toFixed(1)}% 援ш컙?낅땲??`

  const defenseDistanceAt = (i: number) => {
    const d2 = distanceTo(activeThresholds.def_ret2, ret2[i])
    const d3 = distanceTo(activeThresholds.def_ret3, ret3[i])
    if (d2 === null && d3 === null) return null
    if (d2 === null) return d3
    if (d3 === null) return d2
    return Math.min(d2, d3)
  }
  const panicDistanceAt = (i: number) => distanceTo(activeThresholds.panic_ret3, ret3[i])

  const exhaustionScores = ret1.map((_, i) => {
    const ret3Now = ret3[i]
    const ret3Prev = i > 0 ? ret3[i - 1] : null
    const ret3Slowdown = ret3Prev !== null && ret3Now > ret3Prev
    const volNow = volatility(ret1.slice(Math.max(0, i - 4), i + 1))
    const volPrev = volatility(ret1.slice(Math.max(0, i - 9), Math.max(0, i - 4)))
    const volDecreasing = volPrev > 0 && volNow < volPrev
    const posDay = ret1[i] > 0
    return (ret3Slowdown ? 2 : 0) + (volDecreasing ? 2 : 0) + (posDay ? 1 : 0)
  })

  const actionCodeFor = (state: string, ret3Value: number, falseBounceGuard: boolean) => {
    if (state === 'DEFENSE_MODE') {
      return ret3Value <= -0.18 ? 'FULL_DEFENSE' : 'SELL70'
    }
    if (state === 'ACCELERATION_WATCH') return 'PAUSE'
    if (state === 'PANIC_EXTENSION') return 'PAUSE'
    if (state === 'STABILIZATION') return falseBounceGuard ? 'WATCH' : 'PROBE10'
    if (state === 'STRUCTURAL_MODE') return 'PAUSE'
    return 'WATCH'
  }

  const actionCodes = outputs.map((o, i) =>
    actionCodeFor(o.state, ret3[i] ?? 0, o.meta.false_bounce_guard)
  )

  const structuralActionCount = outputs
    .slice(-5)
    .filter((o) => o.state === 'STRUCTURAL_MODE').length
  const structuralPacingActive = latest.state === 'STRUCTURAL_MODE' && structuralActionCount >= 2

  const actions = NAVIGATOR_ACTIONS_V1[latest.state]
  const messages = NAVIGATOR_MESSAGES_V1[latest.state]
  const bannerColor = STATE_COLORS[latest.state] ?? '#94a3b8'
  const snapshotSourceLabel = snapshotSource === 'db' ? 'live DB (QQQ proxy)' : 'snapshot cache (QQQ proxy)'

  const contextPack = {
    date: dates[dates.length - 1] ?? '',
    asset: 'TQQQ',
    profile: activeLabel,
    timeframe: '1D',
    range: '1Y',
    mode: 'engine',
    state: latest.state,
    lang,
    ret_2d: latest.evidence.ret_2d,
    ret_3d: latest.evidence.ret_3d,
    dd_60d: latest.evidence.dd_60d,
    trigger_distance_defense: defenseDistance,
    trigger_distance_panic: panicDistance,
    tail_percentile: latest.meta.ret3d_tail_pct,
    stability_flip_count: flipCount,
    evidence_line: messages.evidence_line,
    action_line: messages.action_line,
    psychology_line: messages.psychology_line,
  }

  const aiFallback = {
    weather: lang === 'en'
      ? `Current mode is ${latest.state.replace(/_/g, ' ')}.`
      : `?꾩옱 紐⑤뱶??${latest.state.replace(/_/g, ' ')}?낅땲??`,
    evidence: messages.evidence_line,
    action: messages.action_line,
    psychology: messages.psychology_line,
  }

  const defenseStarts = outputs
    .map((o, i) => (o.state === 'DEFENSE_MODE' && outputs[i - 1]?.state !== 'DEFENSE_MODE' ? i : -1))
    .filter((i) => i >= 0)
  const lastDefenseIdx = defenseStarts.length ? defenseStarts[defenseStarts.length - 1] : null
  const replayWindow = lastDefenseIdx === null ? null : closes.slice(lastDefenseIdx, lastDefenseIdx + 31)
  const replayWorst =
    lastDefenseIdx === null || !replayWindow || replayWindow.length === 0
      ? null
      : Math.min(...replayWindow) / closes[lastDefenseIdx] - 1

  const logEntries: Omit<ActingLogEntry, 'log_key' | 'created_at'>[] = []
  outputs.forEach((o, i) => {
    const prevState = outputs[i - 1]?.state ?? 'NONE'
    const prevAction = actionCodes[i - 1] ?? 'NONE'
    const actionCode = actionCodes[i]
    if (o.state !== prevState || actionCode !== prevAction) {
      logEntries.push({
        date: dates[i] ?? '-',
        profile_name: activeLabel,
        state_from: prevState,
        state_to: o.state,
        ret_2d: ret2[i],
        ret_3d: ret3[i],
        dd_60d: dd60[i],
        below_ma200_days: o.meta.below_ma200_days,
        lower_high_streak: o.meta.lower_high_streak,
        exhaustion_score: exhaustionScores[i] ?? 0,
        trigger_dist_defense: defenseDistanceAt(i),
        trigger_dist_panic: panicDistanceAt(i),
        recommended_action_code: actionCode,
        note_short: o.meta.false_bounce_guard ? 'False bounce guard' : '',
      })
    }
  })

  logActingEntries(logEntries)
  const last10Log = fetchRecentLogs(10)

  return (
    <main style={{
      minHeight: '100vh',
      background: '#0a0f1a',
      color: '#e5e7eb',
      fontFamily: "var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)",
      padding: '2.6rem 1.95rem',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.6rem' }}>
        <div style={{
          background: '#111318',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: '1.6rem 1.9rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
        }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>?덈쾭由ъ????쇱깮留덉엯?덈떎.</div>
          <div style={{ fontSize: '0.95rem', color: '#cbd5f5' }}>?곕━??洹멸쾬??湲몃뱾?대뒗 踰뺤쓣 ?곌뎄?⑸땲??</div>
          <LeverageModuleNav activeKey="risk" />
        </div>

        <div style={{
          background: '#111318',
          border: `1px solid ${bannerColor}33`,
          borderLeft: `4px solid ${bannerColor}`,
          borderRadius: 14,
          padding: '1.6rem 1.9rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.8rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {t('?덈쾭由ъ? 湲몃뱾?닿린 - 由ъ뒪??愿由??붿쭊', 'Leverage Taming - Risk Engine')}
            </div>
            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <Link
                href={`/crash/navigator/guide?lang=${lang}`}
                style={{
                  background: '#0f1116',
                  color: '#e5e7eb',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  padding: '0.35rem 0.7rem',
                  fontSize: '0.78rem',
                  textDecoration: 'none',
                }}
              >
                {t('?ъ슜 媛?대뱶', 'Guide')}
              </Link>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Link
                  href={`/crash/navigator/engine?lang=ko`}
                  style={{
                    fontSize: '0.74rem',
                    color: lang === 'ko' ? '#e5e7eb' : '#9ca3af',
                    textDecoration: 'none',
                    padding: '0.25rem 0.5rem',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: lang === 'ko' ? 'rgba(148,163,184,0.2)' : 'transparent',
                  }}
                >
                  KR
                </Link>
                <Link
                  href={`/crash/navigator/engine?lang=en`}
                  style={{
                    fontSize: '0.74rem',
                    color: lang === 'en' ? '#e5e7eb' : '#9ca3af',
                    textDecoration: 'none',
                    padding: '0.25rem 0.5rem',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: lang === 'en' ? 'rgba(148,163,184,0.2)' : 'transparent',
                  }}
                >
                  EN
                </Link>
              </div>
              <NavigatorProfileSelect
                options={[
                  { key: 'balanced', label: PROFILE_CONFIGS.balanced.label, description: PROFILE_CONFIGS.balanced.description },
                  { key: 'conservative', label: PROFILE_CONFIGS.conservative.label, description: PROFILE_CONFIGS.conservative.description },
                  { key: 'strict', label: PROFILE_CONFIGS.strict.label, description: PROFILE_CONFIGS.strict.description },
                ]}
                activeKey={profileKey}
              />
            </div>
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 900, color: bannerColor, lineHeight: 1 }}>
            {t('CURRENT MODE', 'CURRENT MODE')}: {latest.state.replace(/_/g, ' ')}
          </div>
          <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>{activeLabel}</div>
          <div style={{ fontSize: '0.94rem', color: '#cbd5f5' }}>{messages.evidence_line}</div>
          <div style={{ fontSize: '0.8rem', color: '#7b8499' }}>
            {t(
              `Data source: ${snapshotSourceLabel}. Navigator logic is standalone (no VR score/pool).`,
              `Data source: ${snapshotSourceLabel}. Navigator logic is standalone (no VR score/pool).`
            )}
          </div>
        </div>

        <TqqqCandleConsole
          tailPercentile={latest.meta.ret3d_tail_pct}
          panicThreshold={activeThresholds.panic_ret3}
          lang={lang}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
          <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' }}>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 6 }}>
              {t('Trigger Distance Visualizer', 'Trigger Distance Visualizer')}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#e5e7eb' }}>
              {t('DEFENSE Trigger Distance', 'DEFENSE Trigger Distance')}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{formatPctAbs(defenseDistance)}</div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              ret_2d gap: {formatPct(latest.trigger_distance.defense_ret2)} 쨌 ret_3d gap: {formatPct(latest.trigger_distance.defense_ret3)}
            </div>
            <div style={{ marginTop: 8, fontSize: '0.9rem', color: '#e5e7eb' }}>
              {t('PANIC Trigger Distance', 'PANIC Trigger Distance')}
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{formatPctAbs(panicDistance)}</div>
            <div style={{ marginTop: 10, fontSize: '0.78rem', color: flipRisk ? '#fca5a5' : '#94a3b8' }}>
              {t('State Stability (5D flips):', 'State Stability (5D flips):')} {flipCount}{' '}
              {flipRisk ? t('쨌 High Volatility Flip Risk', '쨌 High Volatility Flip Risk') : ''}
            </div>
            {latest.meta.pending_deescalation && (
              <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#93c5fd' }}>
                {t('?곹깭 ?덉젙???뺤씤 以?', 'Stability check:')} {latest.meta.pending_days}/2
              </div>
            )}
            {latest.meta.false_bounce_guard && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#fda4af' }}>
                {t('False Bounce Guard: new low after probe ??WATCH revert', 'False Bounce Guard: new low after probe ??WATCH revert')}
              </div>
            )}
          </div>

          <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' }}>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 6 }}>Recommended Action</div>
            <ul style={{ margin: 0, paddingLeft: 16, color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.5 }}>
              {actions.DO_NOW.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {structuralPacingActive && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#fca5a5' }}>
                Pacing rule active: avoid frequent actions during long drawdowns.
              </div>
            )}
          </div>

          <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' }}>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 6 }}>Guardrails</div>
            <ul style={{ margin: 0, paddingLeft: 16, color: '#f8c8b8', fontSize: '0.9rem', lineHeight: 1.5 }}>
              {actions.DONT_DO.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <NavigatorEvidencePanel lang={lang} ret3TailLine={ret3TailLine} />
        </div>

        <NavigatorAIAnalysis contextPack={contextPack} fallback={aiFallback} currentState={latest.state} lang={lang} />

        <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.9rem 1.1rem' }}>
          <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 6 }}>Replay Snapshot (last 120D)</div>
          {lastDefenseIdx === null ? (
            <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>No DEFENSE trigger in this window.</div>
          ) : (
            <div style={{ fontSize: '0.9rem', color: '#e5e7eb' }}>
              DEFENSE on {dates[lastDefenseIdx]} ??worst DD next 30D: {formatPct(replayWorst)}
              <span style={{ color: '#94a3b8' }}> 쨌 If no sell: {formatPct(replayWorst)}</span>
            </div>
          )}
        </div>

        <details style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.9rem 1.1rem' }}>
          <summary style={{ fontSize: '0.78rem', color: '#9ca3af', cursor: 'pointer' }}>Activity Log (last 10)</summary>
          <div style={{ marginTop: 10, display: 'grid', gap: '0.35rem' }}>
            {last10Log.map((entry) => (
              <div key={entry.log_key} style={{ fontSize: '0.8rem', color: '#cbd5f5' }}>
                [{entry.date}] {entry.state_from} ??{entry.state_to} | {entry.recommended_action_code} | dist {formatPctAbs(entry.trigger_dist_defense)} / {formatPctAbs(entry.trigger_dist_panic)} {entry.note_short ? `쨌 ${entry.note_short}` : ''}
              </div>
            ))}
          </div>
        </details>

        {ret3TailLine && (
          <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>{ret3TailLine}</div>
        )}
        <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>{messages.evidence_line}</div>
        <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>{messages.action_line}</div>
        <div style={{ fontSize: '0.84rem', color: '#9ca3af' }}>{messages.psychology_line}</div>
        {flipRisk && (
          <div style={{ fontSize: '0.84rem', color: '#fca5a5' }}>
            吏湲덉? 留ㅼ슦 遺덉븞?뺥븳 援ш컙?낅땲?? 怨쇰룄???됰룞? ?먯젣?섏떗?쒖삤.
          </div>
        )}
      </div>
    </main>
  )
}

