import BilLabel from '@/components/BilLabel'
import EmptyState from '@/components/EmptyState'
import MarketHistoryStrip, { type MarketHistoryRow } from '@/components/MarketHistoryStrip'
import SignalCard from '@/components/SignalCard'
import SignalsAlertsPanel, { type SignalAlert } from '@/components/SignalsAlertsPanel'
import { isProEnabled } from '@/lib/plan'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'

type HealthSnapshot = {
  generated_at?: string | null
  data_date?: string | null
  trend?: {
    qqq_close?: number | null
    sma200?: number | null
    sma50?: number | null
    sma20?: number | null
    dist_pct?: number | null
  } | null
  risk?: {
    var95_1d?: number | null
    cvar95_1d?: number | null
    rv20?: number | null
    vol_ratio?: number | null
  } | null
  breadth_greed?: {
    greed_proxy?: number | null
    label?: string | null
    explain?: string | null
    as_of_date?: string | null
  } | null
}

type ActionSnapshot = {
  generated_at?: string | null
  data_date?: string | null
  exposure_guidance?: {
    action_label?: string | null
    exposure_band?: string | null
    reason?: string | null
  } | null
  portfolio?: {
    has_holdings?: boolean | null
    cash_pct?: number | null
  } | null
}

type MarketTapeCache = {
  generated_at?: string | null
  data_date?: string | null
  items?: Array<{
    symbol?: string | null
    name?: string | null
    last?: number | null
    chg_pct?: number | null
  }> | null
}

type AlertsCache = {
  generated_at?: string | null
  latest_alert_date?: string | null
  alerts?: SignalAlert[] | null
}

type SnapshotsCache = {
  snapshots?: MarketHistoryRow[] | null
}

const C = {
  bull: '#00C853',
  transition: '#FFB300',
  defensive: '#FF7043',
  neutral: '#5E6A75',
  accent: '#0A5AFF',
} as const

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

function fmtNum(v: number | null | undefined, d = 2) {
  return typeof v === 'number' ? v.toFixed(d) : '—'
}

function fmtPct(v: number | null | undefined) {
  return typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—'
}

function pickTape(tape: MarketTapeCache | null, symbol: string) {
  const items = Array.isArray(tape?.items) ? tape!.items! : []
  return items.find((i) => i?.symbol === symbol) || null
}

function inferRegime(health: HealthSnapshot | null) {
  const trend = health?.trend || {}
  const close = trend.qqq_close
  const sma200 = trend.sma200
  const sma50 = trend.sma50
  const dist = trend.dist_pct
  if (typeof close === 'number' && typeof sma200 === 'number') {
    if (close >= sma200 && (typeof sma50 !== 'number' || close >= sma50)) return { label: 'RISK-ON', color: C.bull }
    if (close < sma200) return { label: 'DEFENSIVE', color: C.defensive }
    return { label: 'TRANSITION', color: C.transition }
  }
  if (typeof dist === 'number') {
    if (dist >= 3) return { label: 'RISK-ON', color: C.bull }
    if (dist <= -3) return { label: 'DEFENSIVE', color: C.defensive }
    return { label: 'TRANSITION', color: C.transition }
  }
  return { label: 'UNKNOWN', color: C.neutral }
}

function inferRiskMode(health: HealthSnapshot | null) {
  const volRatio = health?.risk?.vol_ratio
  const var95 = health?.risk?.var95_1d
  if (typeof volRatio === 'number') {
    if (volRatio >= 1.2) return { label: 'HIGH', color: C.defensive, score: Math.min(99, Math.round(volRatio * 50)) }
    if (volRatio <= 0.85) return { label: 'LOW', color: C.bull, score: Math.round(volRatio * 50) }
    return { label: 'MEDIUM', color: C.transition, score: Math.round(volRatio * 50) }
  }
  if (typeof var95 === 'number') {
    const score = Math.min(99, Math.round(Math.abs(var95) * 20))
    return { label: var95 <= -2.5 ? 'HIGH' : var95 <= -1.5 ? 'MEDIUM' : 'LOW', color: var95 <= -2.5 ? C.defensive : var95 <= -1.5 ? C.transition : C.bull, score }
  }
  return { label: 'UNKNOWN', color: C.neutral, score: null }
}

function isStale(sourceDate?: string | null, refDate?: string | null) {
  return Boolean(sourceDate && refDate && sourceDate < refDate)
}

function LockedOverlayCard() {
  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <div
        aria-hidden="true"
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          padding: '0.85rem',
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '0.65rem',
          filter: 'blur(3px)',
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      >
        {[1, 2, 3].map((n) => (
          <div key={n} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 10, padding: '0.7rem' }}>
            <div style={{ width: '42%', height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 4, marginBottom: 8 }} />
            <div style={{ width: '90%', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, marginBottom: 6 }} />
            <div style={{ width: '68%', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
          </div>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(11,15,20,0.2), rgba(11,15,20,0.92) 58%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.55rem',
          padding: '1rem',
          textAlign: 'center',
        }}
      >
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="고급 시그널 잠금" en="Advanced Signals Locked" variant="label" />
        </div>
        <div style={{ color: 'var(--text-secondary)' }}>
          <BilLabel ko="무료 플랜에서는 기본 시그널만 제공합니다." en="Free plan includes baseline signals only." variant="micro" />
        </div>
        <button
          type="button"
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.05)',
            color: 'var(--text-primary)',
            borderRadius: 8,
            padding: '0.45rem 0.8rem',
            cursor: 'default',
            minHeight: 36,
          }}
        >
          <span style={{ color: 'inherit' }}>
            <BilLabel ko="업그레이드" en="Upgrade" variant="micro" />
          </span>
        </button>
      </div>
    </div>
  )
}

export default async function SignalsPage() {
  const [health, action, tape, alertsCache, snapshots] = await Promise.all([
    readCacheJsonOrNull<HealthSnapshot>('health_snapshot.json'),
    readCacheJsonOrNull<ActionSnapshot>('action_snapshot.json'),
    readCacheJsonOrNull<MarketTapeCache>('market_tape.json'),
    readCacheJsonOrNull<AlertsCache>('alerts_recent.json'),
    readCacheJsonOrNull<SnapshotsCache>('snapshots_120d.json'),
  ])

  const healthLoaded = Boolean(health)
  const actionLoaded = Boolean(action)
  const tapeLoaded = Boolean(tape)
  const alertsLoaded = Boolean(alertsCache)

  const alerts = Array.isArray(alertsCache?.alerts) ? alertsCache!.alerts! : []
  const historyRows = Array.isArray(snapshots?.snapshots) ? snapshots!.snapshots!.slice(-5).reverse() : []

  const regime = inferRegime(health)
  const riskMode = inferRiskMode(health)
  const greed = health?.breadth_greed?.greed_proxy ?? null
  const greedLabel = health?.breadth_greed?.label ?? null
  const greedStale = isStale(health?.breadth_greed?.as_of_date, health?.data_date)
  const vix = pickTape(tape, 'VIX')
  const qqq = pickTape(tape, 'QQQ')
  const spy = pickTape(tape, 'SPY')
  const dxy = pickTape(tape, 'DXY')
  const exposure = action?.exposure_guidance || null
  const latestAlert = alerts[0] || null
  const gateFromAlert = latestAlert?.payload_json?.trend?.gate_score ?? null
  const phaseFromAlert = latestAlert?.payload_json?.trend?.market_phase ?? null
  const riskFromAlert = latestAlert?.payload_json?.trend?.risk_level ?? null
  const qqqDist = health?.trend?.dist_pct ?? null
  const dataDate = health?.data_date || action?.data_date || tape?.data_date || null
  const pro = isProEnabled()

  const heroBadges = [
    { ko: '국면', en: 'Regime', value: regime.label, color: regime.color },
    { ko: '리스크 점수', en: 'Risk score', value: riskMode.score != null ? String(riskMode.score) : '—', color: riskMode.color },
  ]

  const primaryCards = [
    {
      title: { ko: '시장 국면', en: 'Regime' },
      status: { ko: regime.label === 'RISK-ON' ? '우호적' : regime.label === 'DEFENSIVE' ? '방어' : regime.label === 'TRANSITION' ? '전환' : '불명' , en: regime.label },
      statusColor: regime.color,
      values: [
        { label: { ko: 'QQQ 종가', en: 'QQQ close' }, value: fmtNum(health?.trend?.qqq_close, 2) },
        { label: { ko: 'SMA200 거리', en: 'dist to SMA200' }, value: fmtPct(qqqDist), color: typeof qqqDist === 'number' ? (qqqDist >= 0 ? C.bull : C.defensive) : undefined },
      ],
      note: { ko: '건강 스냅샷 기반 체제 해석', en: 'Derived from health snapshot trend fields' },
    },
    {
      title: { ko: '리스크 모드', en: 'Risk Mode' },
      status: { ko: riskMode.label === 'HIGH' ? '높음' : riskMode.label === 'MEDIUM' ? '중간' : riskMode.label === 'LOW' ? '낮음' : '불명', en: riskMode.label },
      statusColor: riskMode.color,
      values: [
        { label: { ko: 'Vol Ratio', en: 'Vol ratio' }, value: fmtNum(health?.risk?.vol_ratio, 2) },
        { label: { ko: 'VaR95(1d)', en: 'VaR95 1d' }, value: fmtPct(health?.risk?.var95_1d), color: riskColor(riskMode.label) },
      ],
      note: { ko: '변동성/손실 분포 기반 확률적 리스크', en: 'Probabilistic risk from volatility and drawdown proxies' },
    },
    {
      title: { ko: '노출 가이드', en: 'Exposure Guidance' },
      status: exposure?.action_label ? { ko: exposure.action_label === 'Increase' ? '확대' : exposure.action_label === 'Decrease' ? '축소' : '유지', en: exposure.action_label } : null,
      statusColor: C.accent,
      values: [
        { label: { ko: '권고 밴드', en: 'Band' }, value: exposure?.exposure_band || '—', color: '#93c5fd' },
        { label: { ko: '현금 비중', en: 'Cash %' }, value: typeof action?.portfolio?.cash_pct === 'number' ? `${action.portfolio.cash_pct.toFixed(1)}%` : '—' },
      ],
      note: { ko: exposure?.reason || '행동 스냅샷 데이터 없음', en: exposure?.reason || 'Action snapshot unavailable' },
    },
    {
      title: { ko: '공포/탐욕', en: 'Fear / Greed' },
      status: greedLabel ? { ko: greedLabel === 'Fear' ? '공포' : greedLabel === 'Greed' ? '탐욕' : '중립', en: greedLabel } : null,
      statusColor: greed == null ? C.neutral : greed > 65 ? C.bull : greed < 35 ? C.defensive : C.transition,
      values: [
        { label: { ko: '지표', en: 'Index' }, value: greed != null ? greed.toFixed(0) : '—', color: greed == null ? undefined : greed > 65 ? C.bull : greed < 35 ? C.defensive : C.transition },
        { label: { ko: '기준일', en: 'As-of' }, value: health?.breadth_greed?.as_of_date || '—' },
      ],
      note: greedStale
        ? { ko: '시장 데이터 대비 지연된 감성 값입니다.', en: 'Sentiment source is stale vs market data date.' }
        : { ko: '브레드스/변동성 기반 감성 프록시', en: 'Breadth/volatility-based sentiment proxy' },
    },
    {
      title: { ko: '변동성 구조', en: 'Volatility Structure' },
      status: vix?.last != null ? { ko: vix.last > 25 ? '스트레스' : vix.last > 18 ? '주의' : '안정', en: vix.last > 25 ? 'STRESS' : vix.last > 18 ? 'CAUTION' : 'STABLE' } : null,
      statusColor: vix?.last != null ? (vix.last > 25 ? C.defensive : vix.last > 18 ? C.transition : C.bull) : C.neutral,
      values: [
        { label: { ko: 'VIX', en: 'VIX' }, value: fmtNum(vix?.last, 2) },
        { label: { ko: 'RV20', en: 'RV20' }, value: typeof health?.risk?.rv20 === 'number' ? `${health.risk.rv20.toFixed(1)}%` : '—' },
      ],
      note: { ko: 'VIX + 실현변동성 조합 확인', en: 'Cross-check implied and realized volatility' },
    },
    {
      title: { ko: '게이트 / 이벤트', en: 'Gate / Event' },
      status: latestAlert ? { ko: latestAlert.regime_label === 'EVENT' ? '이벤트' : latestAlert.regime_label === 'STRUCTURAL' ? '구조' : '노이즈', en: (latestAlert.regime_label || 'NOISE').toUpperCase() } : null,
      statusColor: latestAlert ? ((latestAlert.severity_label || '').toUpperCase() === 'HIGH' ? C.defensive : C.transition) : C.neutral,
      values: [
        { label: { ko: '게이트', en: 'Gate score' }, value: typeof gateFromAlert === 'number' ? gateFromAlert.toFixed(0) : '—', color: gateFromAlert != null ? phaseColor(phaseFromAlert || regime.label) : undefined },
        { label: { ko: '위험 라벨', en: 'Risk label' }, value: riskFromAlert || '—', color: riskColor(riskFromAlert) },
      ],
      note: latestAlert
        ? { ko: latestAlert.payload_json?.rule || '최근 알림 규칙', en: latestAlert.payload_json?.rule || 'Latest alert rule context' }
        : { ko: '활성 알림 데이터 없음', en: 'No active alert context available' },
    },
  ]

  const actionCards = [
    {
      title: { ko: '노출', en: 'Exposure' },
      titleColor: '#93c5fd',
      ko: exposure?.exposure_band
        ? `권고 노출 밴드 ${exposure.exposure_band}를 기준으로 실제 비중과 차이를 점검하세요.`
        : '노출 가이드 데이터가 없어 기본 포지션 크기 규칙을 우선 적용하세요.',
      en: exposure?.exposure_band
        ? `Use the recommended exposure band ${exposure.exposure_band} to compare against actual positioning.`
        : 'Exposure guidance is unavailable; fall back to your baseline position sizing rules.',
    },
    {
      title: { ko: '리스크 모드', en: 'Risk Mode' },
      titleColor: riskMode.color,
      ko: riskMode.label === 'HIGH'
        ? '고변동 구간으로 간주하고 손절·헤지·현금 비중 기준을 사전에 고정하세요.'
        : riskMode.label === 'LOW'
        ? '저변동 구간이지만 과신보다는 분할 진입과 손익비 점검을 유지하세요.'
        : '중립/전환 구간으로 보고 확인 신호가 쌓일 때까지 리스크를 단계적으로 조절하세요.',
      en: riskMode.label === 'HIGH'
        ? 'Treat as high-volatility mode and pre-define stop, hedge, and cash rules before acting.'
        : riskMode.label === 'LOW'
        ? 'Lower volatility supports risk-taking, but keep staggered entries and risk/reward discipline.'
        : 'In a transition regime, adjust risk gradually as confirmation signals accumulate.',
    },
    {
      title: { ko: '관망/진입', en: 'Wait / Enter' },
      titleColor: regime.color,
      ko: regime.label === 'RISK-ON'
        ? '추세 우위 구간일 수 있으나, 개별 종목 진입은 거래량/레벨 확인 후 분할로 접근하세요.'
        : regime.label === 'DEFENSIVE'
        ? '관망 비중을 높이고 신규 진입은 신호 품질이 높은 경우만 제한적으로 검토하세요.'
        : '전환 구간 가능성이 있어 서두르기보다 신호 품질과 시장 폭 회복 여부를 확인하세요.',
      en: regime.label === 'RISK-ON'
        ? 'Trend conditions may support entries, but confirm volume/levels and scale in rather than chase.'
        : regime.label === 'DEFENSIVE'
        ? 'Bias toward waiting; consider new entries only when signal quality is clearly above average.'
        : 'Likely a transition regime; prioritize confirmation quality over speed of entry.',
    },
  ]

  const advancedCards = [
    {
      title: { ko: 'QQQ 단기 모멘텀', en: 'QQQ Short Momentum' },
      status: { ko: qqq?.chg_pct != null && qqq.chg_pct >= 0 ? '상승' : '하락', en: qqq?.chg_pct != null && qqq.chg_pct >= 0 ? 'UP' : 'DOWN' },
      statusColor: qqq?.chg_pct != null && qqq.chg_pct >= 0 ? C.bull : C.defensive,
      values: [
        { label: { ko: 'QQQ 변동률', en: 'QQQ chg%' }, value: fmtPct(qqq?.chg_pct) },
        { label: { ko: 'SPY 변동률', en: 'SPY chg%' }, value: fmtPct(spy?.chg_pct) },
      ],
      note: { ko: '지수 상대 강도로 단기 리더십 점검', en: 'Check short-term leadership via index relative strength' },
    },
    {
      title: { ko: '달러 압력', en: 'Dollar Pressure' },
      status: dxy?.chg_pct != null ? { ko: dxy.chg_pct > 0 ? '강달러' : '약달러', en: dxy.chg_pct > 0 ? 'DXY UP' : 'DXY DOWN' } : null,
      statusColor: dxy?.chg_pct != null ? (dxy.chg_pct > 0 ? C.transition : C.bull) : C.neutral,
      values: [
        { label: { ko: 'DXY', en: 'DXY' }, value: fmtNum(dxy?.last, 2) },
        { label: { ko: '변동률', en: 'chg%' }, value: fmtPct(dxy?.chg_pct) },
      ],
      note: { ko: '위험자산/달러 방향성 충돌 여부 체크', en: 'Monitor conflict or confirmation vs risk assets' },
    },
    {
      title: { ko: '알림 집중도', en: 'Alert Concentration' },
      status: latestAlert ? { ko: '활성', en: 'ACTIVE' } : null,
      statusColor: latestAlert ? C.defensive : C.neutral,
      values: [
        { label: { ko: '활성 알림 수', en: 'Active alerts' }, value: String(alerts.filter((a) => (a.status || 'active').toLowerCase() === 'active').length) },
        { label: { ko: '최근 날짜', en: 'Latest date' }, value: alertsCache?.latest_alert_date || '—' },
      ],
      note: { ko: '알림 군집은 변동성 확대 징후일 수 있음', en: 'Alert clustering can signal elevated uncertainty' },
    },
  ]

  const cacheRows = [
    { key: 'health_snapshot.json', loaded: healthLoaded, date: health?.data_date || null, stale: isStale(health?.breadth_greed?.as_of_date, health?.data_date) },
    { key: 'action_snapshot.json', loaded: actionLoaded, date: action?.data_date || null, stale: false },
    { key: 'market_tape.json', loaded: tapeLoaded, date: tape?.data_date || null, stale: false },
    { key: 'alerts_recent.json', loaded: alertsLoaded, date: alertsCache?.latest_alert_date || null, stale: false },
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
          <BilLabel ko="시그널 센터" en="Signals Center" variant="title" />
          <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
            <BilLabel
              ko={`기준일 ${dataDate || '—'} | 감성기준 ${health?.breadth_greed?.as_of_date || '—'}`}
              en={`data_date ${dataDate || '—'} | sentiment as_of ${health?.breadth_greed?.as_of_date || '—'}`}
              variant="micro"
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {heroBadges.map((b) => (
            <span
              key={b.en}
              style={{
                borderRadius: 999,
                border: `1px solid ${b.color}55`,
                background: `${b.color}18`,
                color: b.color,
                padding: '2px 8px',
              }}
            >
              <BilLabel ko={`${b.ko} ${b.value}`} en={`${b.en} ${b.value}`} variant="micro" />
            </span>
          ))}
          {greedStale && (
            <span style={{ borderRadius: 999, border: `1px solid ${C.transition}55`, background: `${C.transition}18`, color: C.transition, padding: '2px 8px' }}>
              <BilLabel ko="지연 데이터" en="Stale" variant="micro" />
            </span>
          )}
        </div>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="주요 시그널" en="Primary Signals" variant="label" />
        </div>
        {primaryCards.length === 0 ? (
          <EmptyState
            title={{ ko: '주요 시그널 없음', en: 'No primary signals' }}
            description={{ ko: '캐시 데이터를 읽을 수 없어 시그널 카드를 구성하지 못했습니다.', en: 'Signal cards could not be derived because cache data is unavailable.' }}
            icon="!"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" style={{ minWidth: 0 }}>
            {primaryCards.map((c) => (
              <SignalCard key={c.title.en} title={c.title} status={c.status} statusColor={c.statusColor} values={c.values} note={c.note} />
            ))}
          </div>
        )}
      </section>

      <section
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          padding: '0.85rem 0.9rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.7rem',
        }}
      >
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="대응 가이드" en="Actions / Guidance" variant="label" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {actionCards.map((a) => (
            <div key={a.title.en} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '0.75rem 0.8rem' }}>
              <div style={{ color: a.titleColor }}>
                <BilLabel ko={a.title.ko} en={a.title.en} variant="micro" />
              </div>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.79rem', lineHeight: 1.45, marginTop: 6 }}>
                {a.ko}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.67rem', lineHeight: 1.35, marginTop: 5 }}>
                {a.en}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          padding: '0.85rem 0.9rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.7rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ color: 'var(--text-primary)' }}>
            <BilLabel ko="고급 시그널" en="Advanced Signals" variant="label" />
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            <BilLabel ko={pro ? 'PRO 사용 가능' : 'FREE 미리보기'} en={pro ? 'PRO enabled' : 'FREE preview'} variant="micro" />
          </div>
        </div>
        {pro ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {advancedCards.map((c) => (
              <SignalCard key={c.title.en} title={c.title} status={c.status} statusColor={c.statusColor} values={c.values} note={c.note} />
            ))}
          </div>
        ) : (
          <LockedOverlayCard />
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="알림 / 관찰" en="Watch / Alerts" variant="label" />
        </div>
        {alerts.length === 0 ? (
          <EmptyState
            title={{ ko: '알림 데이터 없음', en: 'Alerts unavailable' }}
            description={{ ko: 'alerts_recent.json 이 없거나 비어 있습니다.', en: 'alerts_recent.json is missing or empty.' }}
            icon="⚠"
          />
        ) : (
          <SignalsAlertsPanel alerts={alerts} />
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="최근 시그널 이력" en="Recent Signal History" variant="label" />
        </div>
        {historyRows.length === 0 ? (
          <EmptyState
            title={{ ko: '이력 없음', en: 'No signal history' }}
            description={{ ko: 'snapshots_120d.json 데이터가 없어 이력을 표시할 수 없습니다.', en: 'snapshots_120d.json is unavailable, so history cannot be rendered.' }}
            icon="🕘"
          />
        ) : (
          <MarketHistoryStrip
            rows={historyRows}
            title={{ ko: '최근 시그널 이력 (5일)', en: 'Recent Signal History (5d)' }}
            emptyText="No snapshot history available"
          />
        )}
      </section>

      <footer
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          padding: '0.8rem 0.9rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <div style={{ color: 'var(--text-primary)' }}>
          <BilLabel ko="데이터 상태" en="Data Health" variant="label" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cacheRows.map((r) => (
            <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ color: 'var(--text-secondary)' }}>
                <BilLabel ko={r.key} en={r.key} variant="micro" showEn={false} />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${(r.loaded ? C.bull : C.defensive)}55`,
                    background: `${(r.loaded ? C.bull : C.defensive)}18`,
                    color: r.loaded ? C.bull : C.defensive,
                    padding: '1px 7px',
                  }}
                >
                  <BilLabel ko={r.loaded ? '로드됨' : '누락'} en={r.loaded ? 'Loaded' : 'Missing'} variant="micro" />
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.66rem' }}>{r.date || '—'}</span>
                {r.stale && (
                  <span style={{ color: C.transition }}>
                    <BilLabel ko="지연" en="Stale" variant="micro" />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </footer>
    </div>
  )
}
