'use client'

import InfoTip from '@/components/ui/InfoTip'
import { MACRO_TERM_COPY } from '@/lib/macroCopy'

function chipClass(level: 'safe' | 'watch' | 'risk') {
  if (level === 'risk') return 'border-rose-500/30 text-rose-200 bg-rose-500/10'
  if (level === 'watch') return 'border-amber-500/30 text-amber-200 bg-amber-500/10'
  return 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10'
}

function levelFromValue(v: number) {
  if (v >= 80) return 'risk' as const
  if (v >= 55) return 'watch' as const
  return 'safe' as const
}

export default function EarlyWarningTab({
  mode,
  vri,
  csi,
  shockProb,
  phase,
  defensiveMode,
  qqqRealizedVol20d,
  qqqDdVelocity10d,
  qqqAgeMinutes,
  tqqqAgeMinutes,
  tqqqConnected,
  defensiveTrigger,
}: {
  mode: 'ko' | 'en'
  vri: number
  csi: number
  shockProb: number | null
  phase: string
  defensiveMode: string
  qqqRealizedVol20d?: number | null
  qqqDdVelocity10d?: number | null
  qqqAgeMinutes?: number | null
  tqqqAgeMinutes?: number | null
  tqqqConnected?: boolean
  defensiveTrigger?: any
}) {
  const langKey = mode === 'ko' ? 'KR' : 'EN'
  const shockProbTip =
    mode === 'ko'
      ? '향후 단기 구간의 변동성 위험을 추정하는 확률 지표입니다. 예측이 아니라 위험 구간 분류용입니다.'
      : 'A probabilistic estimate of near-term volatility risk. It is a risk classification signal, not a prediction.'
  const phaseTip =
    mode === 'ko'
      ? '시장 국면과 방어 모드 상태를 요약합니다. 방향 예측이 아니라 대응 강도 분류에 사용됩니다.'
      : 'Summarizes phase and defense state. Used for response intensity, not directional forecasting.'
  const fastShockTip =
    mode === 'ko'
      ? '최근 변동성(20D 실현)과 낙폭 속도(10D)를 결합한 단기 충격 지표입니다.'
      : 'A short-term shock gauge combining recent realized volatility (20D) and drawdown velocity (10D).'
  const vriLv = levelFromValue(vri)
  const csiLv = levelFromValue(csi)
  const shLv = levelFromValue(shockProb ?? 0)
  const phLv = phase === 'Shock' || phase === 'Contraction' || defensiveMode === 'ON' ? 'risk' : phase === 'Slowdown' || defensiveMode === 'WATCH' ? 'watch' : 'safe'
  const fastShockRaw = (typeof qqqRealizedVol20d === 'number' ? qqqRealizedVol20d * 2200 : 0) + (typeof qqqDdVelocity10d === 'number' ? Math.abs(qqqDdVelocity10d) * 1800 : 0)
  const fastShockScore = Math.max(0, Math.min(100, Math.round(fastShockRaw)))
  const fastLv = levelFromValue(fastShockScore)
  const qqqAgeLabel = typeof qqqAgeMinutes === 'number' ? `${Math.round(qqqAgeMinutes)}m` : '—'
  const tqqqAgeLabel = typeof tqqqAgeMinutes === 'number' ? `${Math.round(tqqqAgeMinutes)}m` : '—'

    const cards = [
    { key: 'VRI', title: mode === 'ko' ? '변동성 경보' : 'Volatility Alert', desc: `VRI ${Math.round(vri)}`, level: vriLv, tip: MACRO_TERM_COPY.VRI[langKey].body },
    { key: 'CSI', title: mode === 'ko' ? '신용 경보' : 'Credit Alert', desc: `CSI ${Math.round(csi)}`, level: csiLv, tip: MACRO_TERM_COPY.CSI[langKey].body },
    { key: 'SHOCK', title: mode === 'ko' ? '충격 경보' : 'Shock Alert', desc: `30D ${Math.round(shockProb ?? 0)}%`, level: shLv, tip: shockProbTip },
    { key: 'PHASE', title: mode === 'ko' ? '국면 경보' : 'Phase Alert', desc: `${phase} / ${defensiveMode}`, level: phLv as 'safe' | 'watch' | 'risk', tip: phaseTip },
    { key: 'QQQ', title: 'QQQ Fast-Shock', desc: mode === 'ko' ? `점수 ${fastShockScore} · age ${qqqAgeLabel}` : `Score ${fastShockScore} · age ${qqqAgeLabel}`, level: fastLv, tip: fastShockTip },
    { key: 'TQQQ', title: 'TQQQ Fast-Shock', desc: tqqqConnected ? (mode === 'ko' ? `연결됨 · age ${tqqqAgeLabel}` : `connected · age ${tqqqAgeLabel}`) : (mode === 'ko' ? '연결 대기(다음 단계)' : 'pending (next step)'), level: tqqqConnected ? 'watch' : 'safe', tip: fastShockTip },
  ]

  const triggerLevel = String(defensiveTrigger?.trigger_level || 'None')
  const triggerConditions = (defensiveTrigger?.conditions_all || {}) as Record<string, boolean>
  const triggerInputs = (defensiveTrigger?.inputs || {}) as Record<string, any>
  const triggerItems = [
    {
      key: 'yield_inverted',
      ko: '장단기 역전(2Y-10Y<0)',
      en: 'Yield inversion (2Y-10Y<0)',
    },
    {
      key: 'cs_expanding',
      ko: '신용스프레드 30D +60bp 초과',
      en: 'Credit spread 30D > +60bp',
    },
    {
      key: 'dxy_surge',
      ko: '달러 30D +3% 초과',
      en: 'DXY 30D > +3%',
    },
    {
      key: 'vri_expanding',
      ko: '변동성 확장(Expanding)',
      en: 'VRI Expanding',
    },
    {
      key: 'pc_fear',
      ko: 'Put/Call 5D > 1.2',
      en: 'Put/Call 5D > 1.2',
    },
  ]

  const triggerTone =
    triggerLevel === 'L2' ? 'risk' :
      triggerLevel === 'L1' ? 'watch' : 'safe'

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[#15171b] p-4">
        <div className="text-base font-semibold text-slate-100">{mode === 'ko' ? '조기 경보' : 'Early Warning'}</div>
        <div className="text-xs text-slate-400 mt-1">{mode === 'ko' ? 'Early Warning은 구조적 붕괴 이전의 환경 압력 변화를 관찰하는 도구입니다.' : 'Early Warning monitors environmental pressure shifts before structural breakdown.'}</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {cards.map((c) => (
            <div key={c.title} className="rounded-xl border border-white/10 bg-[#16181c] p-3">
              <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <span>{c.title}</span>
                {c.tip ? <InfoTip content={c.tip} /> : null}
              </div>
              <div className="mt-1 text-sm text-slate-300">{c.desc}</div>
              <div className="mt-2">
                <span className={`px-2 py-0.5 text-xs rounded-full border ${chipClass(c.level as 'risk' | 'safe' | 'watch')}`}>
                  {mode === 'ko'
                    ? c.level === 'risk'
                      ? '위험'
                      : c.level === 'watch'
                        ? '경계'
                        : '안정'
                    : c.level === 'risk'
                      ? 'Risk'
                      : c.level === 'watch'
                        ? 'Watch'
                        : 'Safe'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#15171b] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-base font-semibold text-slate-100">
            {mode === 'ko' ? '복합 방어 트리거' : 'Composite Defensive Trigger'}
          </div>
          <span className={`px-2 py-0.5 text-xs rounded-full border ${chipClass(triggerTone)}`}>
            {triggerLevel}
          </span>
        </div>

        <div className="mt-2 text-xs text-slate-400">
          {mode === 'ko'
            ? `입력: YC ${triggerInputs?.yield_curve_spread ?? '—'}, HY 30D ${triggerInputs?.hy_oas_30d_change_bp ?? '—'}bp, DXY 30D ${triggerInputs?.dxy_30d_change ?? '—'}%, PC5D ${triggerInputs?.put_call_5d_ma ?? '—'}`
            : `Inputs: YC ${triggerInputs?.yield_curve_spread ?? '—'}, HY 30D ${triggerInputs?.hy_oas_30d_change_bp ?? '—'}bp, DXY 30D ${triggerInputs?.dxy_30d_change ?? '—'}%, PC5D ${triggerInputs?.put_call_5d_ma ?? '—'}`
          }
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          {triggerItems.map((item) => {
            const on = Boolean(triggerConditions?.[item.key])
            return (
              <div key={item.key} className="rounded-lg border border-white/10 bg-[#16181c] px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">{mode === 'ko' ? item.ko : item.en}</span>
                <span className={`px-2 py-0.5 text-[11px] rounded-full border ${chipClass(on ? 'watch' : 'safe')}`}>
                  {on ? (mode === 'ko' ? '충족' : 'Met') : (mode === 'ko' ? '미충족' : 'Not met')}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
