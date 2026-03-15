'use client'

import InfoTip from '@/components/ui/InfoTip'

function stateLabel(state: string, mode: 'ko' | 'en') {
  if (mode === 'en') {
    if (state === 'High') return 'High'
    if (state === 'Elevated') return 'Elevated'
    if (state === 'Moderate') return 'Moderate'
    return 'Low'
  }
  if (state === 'High') return '높음'
  if (state === 'Elevated') return '상승'
  if (state === 'Moderate') return '보통'
  return '낮음'
}

function stateClass(state: string) {
  if (state === 'High') return 'border-rose-500/35 text-rose-100 bg-rose-500/20'
  if (state === 'Elevated') return 'border-orange-500/35 text-orange-100 bg-orange-500/20'
  if (state === 'Moderate') return 'border-amber-500/35 text-amber-100 bg-amber-500/20'
  return 'border-emerald-500/35 text-emerald-100 bg-emerald-500/20'
}

export default function ShockSummaryCard({
  mode,
  probability,
  state,
  shockRaw = null,
  drivers = [],
  contributions = {},
  scores = {},
}: {
  mode: 'ko' | 'en'
  probability: number | null
  state: string
  shockRaw?: number | null
  drivers?: string[]
  contributions?: Record<string, number>
  scores?: Record<string, number>
}) {
  const derivedState =
    typeof probability === 'number'
      ? probability >= 50
        ? 'High'
        : probability >= 30
          ? 'Elevated'
          : probability >= 15
            ? 'Moderate'
            : 'Low'
      : state
  const label = stateLabel(derivedState, mode)
  const topDrivers = drivers.slice(0, 2)
  const steps = ['Low', 'Moderate', 'Elevated', 'High'] as const
  const stepIndex = derivedState === 'High' ? 3 : derivedState === 'Elevated' ? 2 : derivedState === 'Moderate' ? 1 : 0
  const topContrib = Object.entries(contributions)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const scoreRows = [
    ['VRI', scores.VRI, contributions.VRI],
    ['CSI', scores.CSI, contributions.CSI],
    ['REALIZED_VOL', scores.REALIZED_VOL, contributions.REALIZED_VOL],
  ] as Array<[string, number | undefined, number | undefined]>
  return (
    <div className="rounded-2xl border border-white/10 bg-[#16181c] p-5 min-h-[240px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-2xl md:text-3xl text-slate-100 font-extrabold tracking-tight leading-tight flex items-center gap-2">
          {mode === 'ko' ? `단기 충격 위험: ${label}` : `Short-term Shock Risk: ${label}`}
          <InfoTip
            content={
              mode === 'ko'
                ? '변동성/신용/속도 지표를 결합한 단기 충격 위험 밴드입니다. 예측이 아니라 위험 강도 분류입니다.'
                : 'A short-term shock risk band combining volatility, credit and speed signals. It is a classification, not a prediction.'
            }
          />
        </div>
        <span className={`px-2.5 py-1 rounded-full text-sm font-semibold border ${stateClass(derivedState)}`}>{label}</span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1 rounded-lg overflow-hidden border border-white/10">
        {steps.map((s, idx) => (
          <div
            key={s}
            className={`text-center py-1.5 text-xs ${
              idx <= stepIndex ? (idx < 2 ? 'bg-emerald-500/20 text-emerald-200' : idx === 2 ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-500/20 text-rose-200') : 'bg-white/5 text-slate-400'
            }`}
          >
            {mode === 'ko'
              ? s === 'Low'
                ? '낮음'
                : s === 'Moderate'
                  ? '보통'
                  : s === 'Elevated'
                    ? '상승'
                    : '높음'
              : s}
          </div>
        ))}
      </div>

      <div className="mt-3 text-base md:text-lg text-slate-200 leading-relaxed">
        {mode === 'ko'
          ? `30일 내 급락 위험은 현재 ${label === '낮음' ? '낮음' : label === '보통' ? '낮음~보통' : label === '상승' ? '보통~상승' : '상승~높음'} 구간입니다.`
          : `The 30-day drawdown risk is currently in the ${label === 'Low' ? 'low' : label === 'Moderate' ? 'low-to-moderate' : 'moderate-to-high'} zone.`}
      </div>
      <div className="mt-2 text-sm text-slate-400">{mode === 'ko' ? '보조 지표' : 'Aux metric'}: {probability != null ? `${Math.round(probability)}%` : '—'}</div>
      {typeof shockRaw === 'number' ? (
        <div className="mt-1 text-sm text-slate-400">
          {mode === 'ko' ? 'Raw score' : 'Raw score'}: {shockRaw.toFixed(1)}/100
        </div>
      ) : null}

      {topDrivers.length ? (
        <div className="mt-3 text-base text-slate-300">
          {mode === 'ko' ? '주요 압박 요인' : 'Top pressure drivers'}: <span className="text-slate-100">{topDrivers.join(', ')}</span>
        </div>
      ) : null}

      {scoreRows.some(([, s]) => typeof s === 'number') ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-slate-500">
            {mode === 'ko' ? '막대는 원점수(0~100), 오른쪽은 기여도(가중 점수)입니다.' : 'Bars show raw scores (0-100); right labels show weighted contribution.'}
          </div>
          {scoreRows.map(([k, s, c]) => (
            <div key={k}>
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>{k}</span>
                <span>
                  {typeof s === 'number' ? `${s.toFixed(1)}/100` : '—'}{' '}
                  <span className="text-slate-500">|</span>{' '}
                  <span className="text-cyan-300">{typeof c === 'number' ? `${c.toFixed(1)}` : '—'}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-400/80" style={{ width: `${Math.max(0, Math.min(100, typeof s === 'number' ? s : 0))}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : topContrib.length ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-slate-500">
            {mode === 'ko' ? '기여도(가중 점수): 센서 원값과 다를 수 있습니다.' : 'Contribution (weighted score): may differ from raw sensor values.'}
          </div>
          {topContrib.map(([k, v]) => (
            <div key={k}>
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>{k}</span>
                <span>{v.toFixed(1)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-400/80" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {state && state !== derivedState ? (
        <div className="mt-3 text-[11px] text-slate-500">
          {mode === 'ko'
            ? `모델 상태(${state})와 확률 구간(${derivedState})이 다를 수 있습니다.`
            : `Model state (${state}) may differ from probability band (${derivedState}).`}
        </div>
      ) : null}
    </div>
  )
}
