import BilLabel from '@/components/BilLabel'
import EmptyState from '@/components/EmptyState'
import EpisodeSummary from '@/components/EpisodeSummary'
import MarketHistoryStrip, { type MarketHistoryRow } from '@/components/MarketHistoryStrip'
import RiskNowPanel from '@/components/RiskNowPanel'
import RiskPanel from '@/components/RiskPanel'
import MacroBadgeStrip from '@/components/MacroBadgeStrip'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'

type HealthSnapshot = {
  generated_at?: string | null
  data_date?: string | null
  trend?: {
    qqq_close?: number | null
    dist_pct?: number | null
  } | null
  risk?: {
    var95_1d?: number | null
    cvar95_1d?: number | null
    rv20?: number | null
    vol_ratio?: number | null
  } | null
  breadth_greed?: {
    as_of_date?: string | null
    label?: string | null
    greed_proxy?: number | null
  } | null
}

type ActionSnapshot = {
  generated_at?: string | null
  data_date?: string | null
  exposure_guidance?: {
    action_label?: string | null
    exposure_band?: string | null
  } | null
}

type TapeItem = {
  symbol?: string | null
  last?: number | null
}

type MarketTapeCache = {
  generated_at?: string | null
  data_date?: string | null
  items?: TapeItem[] | null
}

type SnapshotsCache = {
  generated_at?: string | null
  count?: number | null
  snapshots?: MarketHistoryRow[] | null
}

const C = {
  bull: '#00C853',
  transition: '#FFB300',
  defensive: '#FF7043',
  neutral: '#5E6A75',
} as const

function isStale(sourceDate?: string | null, refDate?: string | null) {
  return Boolean(sourceDate && refDate && sourceDate < refDate)
}

function fmtNum(v: number | null | undefined, d = 2) {
  return typeof v === 'number' ? v.toFixed(d) : '—'
}

function fmtPct(v: number | null | undefined) {
  return typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—'
}

function phaseColor(phase?: string | null) {
  const v = (phase || '').toUpperCase()
  if (v === 'BULL' || v === 'RISK-ON') return C.bull
  if (v === 'BEAR' || v === 'DEFENSIVE') return C.defensive
  if (v === 'NEUTRAL' || v === 'TRANSITION') return C.transition
  return C.neutral
}

function riskColor(level?: string | null) {
  const v = (level || '').toUpperCase()
  if (v === 'LOW') return C.bull
  if (v === 'MEDIUM') return C.transition
  if (v === 'HIGH') return C.defensive
  return C.neutral
}

function inferRegime(health: HealthSnapshot | null, latestHistory: MarketHistoryRow | null) {
  const dist = health?.trend?.dist_pct
  if (typeof dist === 'number') {
    if (dist >= 3) return { ko: '위험 선호', en: 'RISK-ON', color: C.bull }
    if (dist <= -3) return { ko: '방어 우위', en: 'DEFENSIVE', color: C.defensive }
    return { ko: '전환 구간', en: 'TRANSITION', color: C.transition }
  }
  const phase = latestHistory?.market_phase
  if ((phase || '').toUpperCase() === 'BULL') return { ko: '상승 국면', en: 'BULL', color: C.bull }
  if ((phase || '').toUpperCase() === 'BEAR') return { ko: '하락 국면', en: 'BEAR', color: C.defensive }
  if ((phase || '').toUpperCase() === 'NEUTRAL') return { ko: '중립 국면', en: 'NEUTRAL', color: C.transition }
  return { ko: '확인 필요', en: 'Needs verification', color: C.neutral }
}

function tailRiskScore(gateScore: number | null, var95: number | null, volRatio: number | null): number | null {
  if (gateScore === null && var95 === null && volRatio === null) return null
  let score = 0
  if (gateScore !== null) score += (100 - gateScore) * 0.5
  if (var95 !== null) score += Math.min(40, Math.abs(var95) * 10)
  if (volRatio !== null) score += Math.min(10, Math.max(0, (volRatio - 0.8) * 20))
  return Math.min(100, Math.max(0, score))
}

function volatilityLabel(vix: number | null, rv20: number | null, volRatio: number | null) {
  const v = vix ?? null
  if (typeof v === 'number') {
    if (v >= 25) return { ko: '스트레스', en: 'STRESS', color: C.defensive }
    if (v >= 18) return { ko: '주의', en: 'CAUTION', color: C.transition }
    return { ko: '안정', en: 'STABLE', color: C.bull }
  }
  if (typeof volRatio === 'number') {
    if (volRatio >= 1.2) return { ko: '확대', en: 'EXPANSION', color: C.defensive }
    if (volRatio <= 0.85) return { ko: '압축', en: 'COMPRESSION', color: C.bull }
    return { ko: '중립', en: 'NEUTRAL', color: C.transition }
  }
  if (typeof rv20 === 'number') {
    return { ko: rv20 > 24 ? '고변동' : rv20 > 16 ? '중간 변동' : '저변동', en: rv20 > 24 ? 'HIGH VOL' : rv20 > 16 ? 'MID VOL' : 'LOW VOL', color: rv20 > 24 ? C.defensive : rv20 > 16 ? C.transition : C.bull }
  }
  return { ko: '확인 필요', en: 'Needs verification', color: C.neutral }
}

function pickVix(tape: MarketTapeCache | null) {
  const items = Array.isArray(tape?.items) ? tape!.items! : []
  const vix = items.find((x) => x?.symbol === 'VIX')
  return typeof vix?.last === 'number' ? vix.last : null
}

export default async function RiskPage() {
  const [health, action, tape, snapshots120, marketHistory, history5d] = await Promise.all([
    readCacheJsonOrNull<HealthSnapshot>('health_snapshot.json'),
    readCacheJsonOrNull<ActionSnapshot>('action_snapshot.json'),
    readCacheJsonOrNull<MarketTapeCache>('market_tape.json'),
    readCacheJsonOrNull<SnapshotsCache>('snapshots_120d.json'),
    readCacheJsonOrNull<SnapshotsCache>('market_history.json'),
    readCacheJsonOrNull<SnapshotsCache>('history_5d.json'),
  ])

  const historySource = marketHistory ?? history5d ?? snapshots120
  const historyRowsAll = Array.isArray(historySource?.snapshots) ? historySource!.snapshots! : []
  const timelineRows = historyRowsAll.slice(-10).reverse()
  const latestHistory = timelineRows[0] || historyRowsAll[historyRowsAll.length - 1] || null

  const regime = inferRegime(health, latestHistory)
  const gateScore = typeof latestHistory?.gate_score === 'number' ? latestHistory.gate_score : null
  const riskLevel = latestHistory?.risk_level ?? null
  const vix = pickVix(tape)
  const tailScore = tailRiskScore(gateScore, health?.risk?.var95_1d ?? null, health?.risk?.vol_ratio ?? null)
  const volLabel = volatilityLabel(vix, health?.risk?.rv20 ?? null, health?.risk?.vol_ratio ?? null)
  const sentimentStale = isStale(health?.breadth_greed?.as_of_date, health?.data_date)

  const needsVerification = [
    health?.trend?.qqq_close,
    health?.trend?.dist_pct,
    health?.risk?.var95_1d,
    health?.risk?.vol_ratio,
    gateScore,
    vix,
  ].every((v) => v === null || v === undefined)

  const nowMetrics = [
    { label: { ko: 'QQQ 종가', en: 'QQQ close' }, value: fmtNum(health?.trend?.qqq_close, 2) },
    { label: { ko: 'SMA200 거리', en: 'dist to SMA200' }, value: fmtPct(health?.trend?.dist_pct), color: typeof health?.trend?.dist_pct === 'number' ? (health.trend.dist_pct >= 0 ? C.bull : C.defensive) : undefined },
    { label: { ko: '테일 리스크', en: 'Tail risk score' }, value: tailScore != null ? tailScore.toFixed(0) : '—', color: tailScore != null ? (tailScore >= 80 ? C.defensive : tailScore >= 60 ? C.transition : C.bull) : undefined },
    { label: { ko: '게이트 점수', en: 'Gate score' }, value: gateScore != null ? gateScore.toFixed(0) : '—', color: gateScore != null ? (gateScore > 60 ? C.bull : gateScore > 40 ? C.transition : C.defensive) : undefined },
    { label: { ko: 'VIX', en: 'VIX' }, value: fmtNum(vix, 2), color: vix != null ? (vix >= 25 ? C.defensive : vix >= 18 ? C.transition : C.bull) : undefined },
    { label: { ko: '노출 밴드', en: 'Exposure band' }, value: action?.exposure_guidance?.exposure_band || '—' },
  ]

  const summaryKo =
    regime.en === 'RISK-ON' || regime.en === 'BULL'
      ? '리스크 허용 여건이 상대적으로 우호적이지만, 변동성 확대 신호 여부를 함께 확인해야 합니다.'
      : regime.en === 'DEFENSIVE' || regime.en === 'BEAR'
      ? '방어 우위 구간으로 해석되며, 포지션 크기와 손실 관리 규칙을 우선 점검해야 합니다.'
      : '전환/중립 구간 가능성이 있어 확인 신호가 누적될 때까지 리스크를 단계적으로 조절하는 접근이 유리합니다.'

  const summaryEn =
    regime.en === 'RISK-ON' || regime.en === 'BULL'
      ? 'Risk conditions are relatively supportive, but still confirm whether volatility is expanding.'
      : regime.en === 'DEFENSIVE' || regime.en === 'BEAR'
      ? 'Conditions look defensive; prioritize position sizing and loss-control rules.'
      : 'Likely a transition/neutral regime, so scale risk gradually as confirmations accumulate.'

  const cacheHealth = [
    { file: 'health_snapshot.json', ok: !!health, date: health?.data_date || null, stale: sentimentStale },
    { file: 'action_snapshot.json', ok: !!action, date: action?.data_date || null, stale: false },
    { file: 'market_tape.json', ok: !!tape, date: tape?.data_date || null, stale: false },
    { file: marketHistory ? 'market_history.json' : history5d ? 'history_5d.json' : snapshots120 ? 'snapshots_120d.json' : 'history cache', ok: !!historySource, date: null, stale: false },
  ]

  return (
    <div className="px-3 py-4 sm:px-4 sm:py-5 lg:px-6 lg:pb-12" style={{ display: 'flex', flexDirection: 'column', gap: '0.95rem' }}>
      <header
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          padding: '0.9rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.8rem',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="리스크" en="Risk" variant="title" />
          <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
            <BilLabel
              ko={`기준일 ${health?.data_date || action?.data_date || tape?.data_date || '—'} | 감성기준 ${health?.breadth_greed?.as_of_date || '—'}`}
              en={`data_date ${health?.data_date || action?.data_date || tape?.data_date || '—'} | sentiment as_of ${health?.breadth_greed?.as_of_date || '—'}`}
              variant="micro"
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <MacroBadgeStrip />
          <span style={{ borderRadius: 999, border: `1px solid ${regime.color}55`, background: `${regime.color}18`, color: regime.color, padding: '2px 8px' }}>
            <BilLabel ko={regime.ko} en={regime.en} variant="micro" />
          </span>
          <span style={{ borderRadius: 999, border: `1px solid ${tailScore != null && tailScore >= 70 ? C.defensive : C.transition}55`, background: `${tailScore != null && tailScore >= 70 ? C.defensive : C.transition}18`, color: tailScore != null && tailScore >= 70 ? C.defensive : C.transition, padding: '2px 8px' }}>
            <BilLabel ko={`테일 ${tailScore != null ? tailScore.toFixed(0) : '—'}`} en={`Tail ${tailScore != null ? tailScore.toFixed(0) : '—'}`} variant="micro" />
          </span>
          <span style={{ borderRadius: 999, border: `1px solid ${volLabel.color}55`, background: `${volLabel.color}18`, color: volLabel.color, padding: '2px 8px' }}>
            <BilLabel ko={volLabel.ko} en={volLabel.en} variant="micro" />
          </span>
          {sentimentStale && (
            <span style={{ borderRadius: 999, border: `1px solid ${C.transition}55`, background: `${C.transition}18`, color: C.transition, padding: '2px 8px' }}>
              <BilLabel ko="지연 데이터" en="Stale" variant="micro" />
            </span>
          )}
        </div>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="지금 상태" en="Now" variant="label" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-5 items-start" style={{ minWidth: 0 }}>
          <RiskNowPanel
            phase={{ ko: regime.ko, en: regime.en }}
            phaseColor={regime.color}
            summary={{ ko: summaryKo, en: summaryEn }}
            metrics={nowMetrics}
            needsVerification={needsVerification}
          />
          <div style={{ minWidth: 0 }}>
            <RiskPanel />
          </div>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="리스크 타임라인" en="Risk Timeline" variant="label" />
        </div>
        {timelineRows.length === 0 ? (
          <EmptyState
            title={{ ko: '타임라인 데이터 없음', en: 'Timeline unavailable' }}
            description={{ ko: '히스토리 캐시를 찾지 못했습니다. snapshots_120d.json 또는 history cache를 확인하세요.', en: 'No history cache found. Check snapshots_120d.json or another history cache.' }}
            icon="🕘"
          />
        ) : (
          <MarketHistoryStrip
            rows={timelineRows}
            title={{ ko: '최근 10일 리스크 이력', en: 'Risk History (10d)' }}
            emptyText="No risk history available"
          />
        )}
      </section>

      <EpisodeSummary rows={timelineRows} />

      <footer
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          padding: '0.8rem 0.9rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem',
        }}
      >
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="데이터 상태" en="Data Health" variant="label" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cacheHealth.map((c) => (
            <div key={c.file} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ color: 'var(--text-secondary)' }}>
                <BilLabel ko={c.file} en={c.file} variant="micro" showEn={false} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: c.ok ? C.bull : C.defensive, fontSize: '0.8rem' }}>{c.ok ? '✅' : '⚠️'}</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <BilLabel ko={c.ok ? '로드됨' : '누락'} en={c.ok ? 'Loaded' : 'Missing'} variant="micro" />
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.66rem' }}>{c.date || '—'}</span>
                {c.stale && (
                  <span style={{ color: C.transition }}>
                    <BilLabel ko="지연" en="Stale" variant="micro" />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          <BilLabel ko="캐시가 비어 있으면 요약 카드와 타임라인은 안전한 빈 상태로 표시됩니다." en="If caches are missing, summary cards and timeline render safe empty states instead of crashing." variant="micro" />
        </div>
      </footer>
    </div>
  )
}
