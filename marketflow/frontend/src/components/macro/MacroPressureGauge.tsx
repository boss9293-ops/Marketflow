'use client'

import { HalfGauge } from '@/components/macro/PressureBar'
import InfoTip from '@/components/ui/InfoTip'
import { MACRO_TERM_COPY } from '@/lib/macroCopy'

function levelText(v: number, mode: 'ko' | 'en') {
  if (mode === 'en') {
    if (v >= 80) return 'HIGH'
    if (v >= 66) return 'ELEVATED'
    if (v >= 33) return 'MODERATE'
    return 'LOW'
  }
  if (v >= 80) return '높음'
  if (v >= 66) return '상승'
  if (v >= 33) return '보통'
  return '낮음'
}

function bandText(v: number, mode: 'ko' | 'en') {
  if (mode === 'en') {
    if (v >= 85) return 'Risk'
    if (v >= 66) return 'Watch'
    if (v >= 33) return 'Neutral'
    return 'Stable'
  }
  if (v >= 85) return '위험'
  if (v >= 66) return '경계'
  if (v >= 33) return '중립'
  return '안정'
}

function bandClass(v: number) {
  if (v >= 85) return 'border-rose-500/30 text-rose-200 bg-rose-500/10'
  if (v >= 66) return 'border-amber-500/30 text-amber-200 bg-amber-500/10'
  if (v >= 33) return 'border-yellow-500/30 text-yellow-200 bg-yellow-500/10'
  return 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10'
}

export default function MacroPressureGauge({
  mode,
  mps,
  quality,
  updated,
  ageMinutes,
}: {
  mode: 'ko' | 'en'
  mps: number
  quality?: string
  updated?: string
  ageMinutes?: number | null
}) {
  const zone =
    mps >= 85 ? 'CRITICAL' : mps >= 66 ? 'HIGH' : mps >= 33 ? 'MID' : 'LOW'
  const zoneKo =
    zone === 'CRITICAL' ? '위험' : zone === 'HIGH' ? '주의' : zone === 'MID' ? '확인' : '안정'
  const zoneEn =
    zone === 'CRITICAL' ? 'Critical' : zone === 'HIGH' ? 'High' : zone === 'MID' ? 'Mid' : 'Low'

  const ageText =
    typeof ageMinutes === 'number'
      ? ageMinutes >= 60
        ? `${Math.round(ageMinutes / 60)}h`
        : `${Math.round(ageMinutes)}m`
      : '—'

  const langKey = mode === 'ko' ? 'KR' : 'EN'
  const mpsTip = MACRO_TERM_COPY.MPS[langKey].body

  return (
    <div className="rounded-2xl border border-white/10 bg-[#16181c] p-5 min-h-[240px]">
      <div className="text-xl md:text-2xl font-extrabold text-slate-100 tracking-tight flex items-center gap-2">
        <span>{mode === 'ko' ? '매크로 압박 레벨' : 'Macro Pressure Level'}</span>
        <InfoTip content={mpsTip} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-4">
        <div>
          <div className="text-4xl font-extrabold text-white">{levelText(mps, mode)}</div>
          <div className="mt-1 text-lg font-semibold text-slate-200">MPS {Math.round(mps)}/100</div>
          <div className="mt-2 text-xs text-slate-400 leading-relaxed">{mpsTip}</div>
          <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1">
            <span className="text-xs text-slate-400">{mode === 'ko' ? '지금 위치' : 'Current'}</span>
            <span className="text-sm font-semibold text-slate-100">{mode === 'ko' ? zoneKo : zoneEn} ({zone})</span>
          </div>
          <div className="mt-2 text-xs text-slate-400 leading-relaxed space-y-0.5">
            <div>{mode === 'ko' ? '신뢰도' : 'Trust'}: <span className="text-slate-200">{quality || 'NA'}</span></div>
            <div>{mode === 'ko' ? '업데이트' : 'Updated'}: <span className="text-slate-200">{updated || '—'}</span> · age <span className="text-slate-200">{ageText}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HalfGauge value={mps} size={120} />
          <span className={`px-2.5 py-1 rounded-full text-sm border ${bandClass(mps)}`}>{bandText(mps, mode)}</span>
        </div>
      </div>
    </div>
  )
}
