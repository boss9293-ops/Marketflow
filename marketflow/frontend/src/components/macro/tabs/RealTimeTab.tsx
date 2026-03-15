'use client'

import { useState } from 'react'
import MacroClimateBanner from '@/components/macro/MacroClimateBanner'
import PressureTriptych from '@/components/macro/PressureTriptych'
import MacroPressureGauge from '@/components/macro/MacroPressureGauge'
import ShockSummaryCard from '@/components/macro/ShockSummaryCard'
import ActionGuidanceBox from '@/components/macro/ActionGuidanceBox'
import { realtimeExplainScript, realtimeTone, sensorStatusLabel } from '@/lib/macroRealtimeCopy'
import { MACRO_TERM_COPY, type MacroTermKey } from '@/lib/macroCopy'

export default function RealTimeTab({
  mode,
  lpi,
  rpi,
  vri,
  csi,
  mps,
  phase,
  defensiveMode,
  shockProb,
  shockState,
  shockRaw = null,
  drivers = [],
  shockContrib = {},
  shockScores = {},
  quality = '',
  xconf = 'NA',
  ghedge = 'NA',
  xconfGlobal = null,
  updatedAt = '',
  ageMinutes = null,
}: {
  mode: 'ko' | 'en'
  lpi: number
  rpi: number
  vri: number
  csi: number
  mps: number
  phase: string
  defensiveMode: string
  shockProb: number | null
  shockState: string
  shockRaw?: number | null
  drivers?: string[]
  shockContrib?: Record<string, number>
  shockScores?: Record<string, number>
  quality?: string
  xconf?: string
  ghedge?: string
  xconfGlobal?: any
  updatedAt?: string
  ageMinutes?: number | null
}) {
  const riskMix = (vri + csi) / 2
  const tone = realtimeTone(phase, defensiveMode, shockProb)
  const lpiText = sensorStatusLabel(lpi, 'lpi', mode)
  const rpiText = sensorStatusLabel(rpi, 'rpi', mode)
  const riskText = sensorStatusLabel(riskMix, 'risk', mode)
  const script = realtimeExplainScript(mode, lpiText, rpiText, riskText, drivers)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [glossaryKey, setGlossaryKey] = useState<MacroTermKey | null>(null)
  const glossaryLang = mode === 'ko' ? 'KR' : 'EN'
  const glossaryKeys = Object.keys(MACRO_TERM_COPY) as MacroTermKey[]

  const posture = (() => {
    if (defensiveMode === 'ON' || phase === 'Shock' || (shockProb ?? 0) >= 50) return 'defense'
    if (phase === 'Contraction' || (shockProb ?? 0) >= 35) return 'caution'
    if (defensiveMode === 'WATCH' || phase === 'Slowdown' || (shockProb ?? 0) >= 20) return 'confirm'
    return 'stable'
  })()
  const summaryLine =
    mode === 'ko'
      ? posture === 'defense'
        ? '오늘은 방어 구간입니다. 현금/헤지 비중을 우선 고려하세요.'
        : posture === 'caution'
          ? '오늘은 주의 구간입니다. 신규 진입은 느리게, 리스크 점검을 우선하세요.'
          : posture === 'confirm'
            ? '오늘은 확인 구간입니다. 무리한 확장보다 점검이 유리합니다.'
            : '오늘은 안정 구간입니다. 기본 계획을 유지해도 좋습니다.'
      : posture === 'defense'
        ? 'Today is a defense regime. Prioritize cash/hedge buffer.'
        : posture === 'caution'
          ? 'Today is a caution regime. Slow entries and prioritize risk checks.'
          : posture === 'confirm'
            ? 'Today is a confirmation regime. Review before expansion.'
            : 'Today is a stable regime. Staying with the base plan is reasonable.'

  const driverMeta: Record<string, { ko: string; en: string; srcKo: string; srcEn: string; value: number }> = {
    VRI: { ko: '변동성', en: 'Volatility', srcKo: 'VIX', srcEn: 'VIX', value: vri },
    CSI: { ko: '신용스프레드', en: 'Credit Spread', srcKo: 'HY OAS', srcEn: 'HY OAS', value: csi },
    RPI: { ko: '금리압박', en: 'Rate Pressure', srcKo: '2s10s', srcEn: '2s10s', value: rpi },
    LPI: { ko: '유동성', en: 'Liquidity', srcKo: 'M2/WALCL', srcEn: 'M2/WALCL', value: lpi },
  }
  const top3Text = (drivers.length ? drivers : ['VRI', 'CSI', 'RPI'])
    .slice(0, 3)
    .map((k) => {
      const m = driverMeta[k] || { ko: k, en: k, srcKo: k, srcEn: k, value: 50 }
      const arrow = m.value >= 50 ? '↑' : '↓'
      return mode === 'ko' ? `${m.ko}${arrow}(${m.srcKo})` : `${m.en}${arrow}(${m.srcEn})`
    })
    .join(', ')

  const xconfKo =
    xconf === 'Align'
      ? '유동성 흐름과 위험자산 반응이 비교적 같은 방향입니다.'
      : xconf === 'Stress'
        ? '유동성 신호와 위험자산이 동시에 약해져 확인 강도가 낮습니다.'
        : xconf === 'Mixed'
          ? '유동성과 위험자산 신호가 엇갈려 추가 확인이 필요합니다.'
          : 'BTC–M2 신호는 아직 연결 대기 상태입니다.'
  const xconfEn =
    xconf === 'Align'
      ? 'Liquidity trend and risk-asset response are broadly aligned.'
      : xconf === 'Stress'
        ? 'Liquidity and risk-asset signals are weakening together.'
        : xconf === 'Mixed'
          ? 'Liquidity and risk-asset signals are diverging.'
          : 'BTC–M2 signal is pending data connection.'

  const ghedgeKo =
    ghedge === 'HedgeDemand'
      ? '금과 실질금리 조합에서 방어 수요가 관찰됩니다.'
      : ghedge === 'Normal'
        ? '금과 실질금리 관계는 과거 패턴 범위에 가깝습니다.'
        : ghedge === 'Mixed'
          ? '금과 실질금리 해석은 혼합 구간입니다.'
          : 'Gold–RealRate 신호는 아직 연결 대기 상태입니다.'
  const ghedgeEn =
    ghedge === 'HedgeDemand'
      ? 'Gold and real-rate mix suggests defensive demand.'
      : ghedge === 'Normal'
        ? 'Gold-real rate relationship is within historical pattern.'
        : ghedge === 'Mixed'
          ? 'Gold-real rate interpretation is mixed.'
          : 'Gold–RealRate signal is pending data connection.'

  const xconfGlobalState = String(xconfGlobal?.state || 'NA')
  const xconfGlobalLag = xconfGlobal?.best_lag_weeks
  const xconfGlobalCorr = xconfGlobal?.corr_best
  const xconfGlobalKo =
    xconfGlobalState === 'Align'
      ? `BTC와 M2 흐름이 비교적 같은 방향입니다${xconfGlobalLag ? ` (약 ${xconfGlobalLag}주 지연)` : ''}.`
      : xconfGlobalState === 'Stress'
        ? 'BTC와 M2 흐름이 역방향으로 움직여 확인 강도가 낮습니다.'
        : xconfGlobalState === 'Mixed'
          ? 'BTC와 M2 흐름이 혼합 구간이라 단독 해석은 제한적입니다.'
          : 'BTC–M2 리드/래그 신호는 데이터가 더 필요합니다.'
  const xconfGlobalEn =
    xconfGlobalState === 'Align'
      ? `BTC and M2 are broadly aligned${xconfGlobalLag ? ` (around ${xconfGlobalLag}w lag)` : ''}.`
      : xconfGlobalState === 'Stress'
        ? 'BTC and M2 are diverging in opposite directions.'
        : xconfGlobalState === 'Mixed'
          ? 'BTC and M2 are in a mixed relationship regime.'
          : 'BTC–M2 lead/lag signal needs more data.'

  return (
    <div className="space-y-4">
      <MacroClimateBanner
        mode={mode}
        tone={tone}
        headline={summaryLine}
        reason1={mode === 'ko' ? `핵심 근거: ${top3Text}` : `Key drivers: ${top3Text}`}
        reason2={mode === 'ko' ? `시장 해석: ${script.line1}` : `Reading: ${script.line1}`}
        quality={quality || undefined}
      />

      <PressureTriptych mode={mode} lpi={lpi} rpi={rpi} risk={riskMix} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MacroPressureGauge mode={mode} mps={mps} quality={quality} updated={updatedAt} ageMinutes={ageMinutes} />
        <ShockSummaryCard
          mode={mode}
          probability={shockProb}
          state={shockState}
          shockRaw={shockRaw}
          drivers={drivers}
          contributions={shockContrib}
          scores={shockScores}
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#14171b] p-4">
        <div className="text-sm md:text-base font-semibold text-slate-100">
          {mode === 'ko' ? '압력 구조 해설' : 'Pressure Explanation'}
        </div>
        <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm text-slate-300">
          <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <div className="text-xs uppercase tracking-wider text-slate-400">{mode === 'ko' ? '거시 압력 구조' : 'Macro Pressure Structure'}</div>
            <ul className="mt-2 space-y-1">
              <li>{mode === 'ko' ? 'VRI(변동성 체계): 변동성 확장은 레버리지 민감도를 키웁니다.' : 'VRI (Volatility Regime Index): Expanding volatility raises leverage sensitivity.'}</li>
              <li>{mode === 'ko' ? 'CSI(신용 스프레드): 신용 스트레스는 주식 약세로 이어지는 경우가 많습니다.' : 'CSI (Credit Spread Index): Credit stress often leads equity weakness.'}</li>
              <li>{mode === 'ko' ? 'REALIZED_VOL: 실현변동성 상승은 속도 위험을 키웁니다.' : 'REALIZED_VOL: Rising realized volatility signals speed risk and fragility.'}</li>
            </ul>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <div className="text-xs uppercase tracking-wider text-slate-400">{mode === 'ko' ? '해석 프레임워크' : 'Interpretation Framework'}</div>
            <ul className="mt-2 space-y-1">
              <li>{mode === 'ko' ? 'VRI + CSI 상승 -> 방어적 속도 조절' : 'VRI + CSI rising -> Defensive speed control'}</li>
              <li>{mode === 'ko' ? 'VRI 상승만 -> 단기 불안정' : 'VRI rising alone -> Short-term instability'}</li>
              <li>{mode === 'ko' ? 'CSI 상승만 -> 구조적 취약성 위험' : 'CSI rising alone -> Structural fragility risk'}</li>
              <li>{mode === 'ko' ? 'LPI 낮음 + VRI 상승 -> 유동성-변동성 압축 위험' : 'Low LPI + Rising VRI -> Liquidity-volatility compression risk'}</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#14171b] p-4">
        <button
          type="button"
          onClick={() => {
            setGlossaryOpen((v) => {
              if (v) setGlossaryKey(null)
              return !v
            })
          }}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="text-sm md:text-base font-semibold text-slate-100">
            {mode === 'ko' ? '용어 사전 (Glossary)' : 'Mini Glossary'}
          </div>
          <div className="text-xs text-slate-400">{glossaryOpen ? (mode === 'ko' ? '접기' : 'Hide') : (mode === 'ko' ? '열기' : 'Show')}</div>
        </button>
        {glossaryOpen && (
          <div className="mt-3 divide-y divide-white/10">
            {glossaryKeys.map((key) => {
              const open = glossaryKey === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setGlossaryKey((prev) => (prev === key ? null : key))}
                  className="w-full text-left py-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-100">{MACRO_TERM_COPY[key][glossaryLang].title}</div>
                    <span className="text-[10px] text-slate-400">{open ? (mode === 'ko' ? '닫기' : 'Collapse') : (mode === 'ko' ? '설명' : 'Expand')}</span>
                  </div>
                  {open && (
                    <div className="mt-2 text-xs text-slate-300 leading-relaxed">
                      {MACRO_TERM_COPY[key][glossaryLang].body}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <ActionGuidanceBox mode={mode} phase={phase} defensiveMode={defensiveMode} confirmPoints={drivers.slice(0, 2)} />

      <div className="rounded-2xl border border-white/10 bg-[#16181c] p-4">
        <div className="text-sm md:text-base font-semibold text-slate-100">
          {mode === 'ko' ? '참고 신호 (엔진 비합산)' : 'Reference Signals (Not in Engine Score)'}
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <div className="text-slate-200 font-medium">BTC–M2: <span className="text-cyan-300">{xconf || 'NA'}</span></div>
            <div className="mt-1 text-slate-400 leading-relaxed">{mode === 'ko' ? xconfKo : xconfEn}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <div className="text-slate-200 font-medium">
              BTC–M2 (Lead/Lag): <span className="text-cyan-300">{xconfGlobalState}</span>
              {typeof xconfGlobalCorr === 'number' && <span className="text-slate-400"> · corr {xconfGlobalCorr.toFixed(2)}</span>}
            </div>
            <div className="mt-1 text-slate-400 leading-relaxed">{mode === 'ko' ? xconfGlobalKo : xconfGlobalEn}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <div className="text-slate-200 font-medium">Gold–RealRate: <span className="text-cyan-300">{ghedge || 'NA'}</span></div>
            <div className="mt-1 text-slate-400 leading-relaxed">{mode === 'ko' ? ghedgeKo : ghedgeEn}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
