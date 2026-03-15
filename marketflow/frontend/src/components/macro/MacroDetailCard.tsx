'use client'

import InfoTip from '@/components/ui/InfoTip'
import { pickLang, useLangMode } from '@/lib/useLangMode'

type Props = {
  title: string
  subtitle?: string
  value: string
  statusLabel: string
  refText: string
  titleTip?: string
  subtitleTip?: string
  refTip?: string
  updated: string
  quality: string
  ageMinutes?: number | null
  stale?: boolean
  tooltip?: string
  compactGauge?: boolean
  extras?: Array<{ label: string; value: string; tone?: 'normal' | 'good' | 'warn' | 'danger' }>
  statusBadge?: { label: string; tone?: 'normal' | 'good' | 'warn' | 'danger' } | null
}

function toGaugeValue(value: string): number | null {
  const n = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}

function zoneLabel(v: number, mode: 'ko' | 'en') {
  if (v >= 85) return mode === 'ko' ? '고위험' : 'Risk'
  if (v >= 66) return mode === 'ko' ? '경계 강화' : 'Alert'
  if (v >= 33) return mode === 'ko' ? '주의 구간' : 'Caution'
  return mode === 'ko' ? '기준 범위' : 'Normal'
}

function Gauge({ value, tone, compact }: { value: number; tone: string; compact?: boolean }) {
  const r = compact ? 24 : 28
  const cx = compact ? 32 : 36
  const cy = compact ? 30 : 34
  const arc = Math.PI
  const len = r * arc
  const p = Math.max(0, Math.min(1, value / 100))
  const offset = len * (1 - p)
  const angle = Math.PI - p * Math.PI // left(180deg, safe) -> right(0deg, risk)
  const nx = cx + (r - 6) * Math.cos(angle)
  const ny = cy - (r - 6) * Math.sin(angle)
  const zoneTone =
    value >= 85 ? '#f87171' : value >= 66 ? '#fb923c' : value >= 33 ? '#facc15' : '#34d399'

  const polar = (ratio: number) => {
    const a = Math.PI - Math.max(0, Math.min(1, ratio)) * Math.PI
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) }
  }

  const arcSeg = (start: number, end: number) => {
    const s = polar(start)
    const e = polar(end)
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`
  }

  return (
    <svg width={compact ? 66 : 76} height={compact ? 46 : 52} viewBox={compact ? '0 0 66 46' : '0 0 76 52'} aria-hidden="true">
      {/* 4-zone reference arc: left(safe) -> right(risk) */}
      <path d={arcSeg(0.00, 0.325)} fill="none" stroke="#34d399" strokeWidth="4.5" strokeLinecap="butt" opacity="0.95" />
      <path d={arcSeg(0.335, 0.655)} fill="none" stroke="#facc15" strokeWidth="4.5" strokeLinecap="butt" opacity="0.95" />
      <path d={arcSeg(0.665, 0.845)} fill="none" stroke="#fb923c" strokeWidth="4.5" strokeLinecap="butt" opacity="0.95" />
      <path d={arcSeg(0.855, 1.00)} fill="none" stroke="#f87171" strokeWidth="4.5" strokeLinecap="butt" opacity="0.95" />
      {/* boundary ticks for clear separation */}
      {[0.33, 0.66, 0.85].map((b) => {
        const p1 = polar(b)
        const p2 = { x: cx + (r - 6) * Math.cos(Math.PI - b * Math.PI), y: cy - (r - 6) * Math.sin(Math.PI - b * Math.PI) }
        return <line key={b} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(15,23,42,0.9)" strokeWidth="1.5" />
      })}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.65)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${len} ${len}`}
        strokeDashoffset={offset}
      />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="rgba(255,255,255,0.92)" strokeWidth="1.8" />
      <circle cx={cx} cy={cy} r="3.2" fill="rgba(255,255,255,0.92)" />
      <circle cx={cx} cy={cy} r="1.6" fill={zoneTone || tone} />
    </svg>
  )
}

export function riskTone(state?: string) {
  const s = (state || 'Normal').toLowerCase()
  if (s === 'stress') return 'text-red-300 border-red-500/20 bg-red-500/10'
  if (s === 'watch') return 'text-amber-200 border-amber-500/20 bg-amber-500/10'
  if (s === 'normal') return 'text-emerald-200 border-emerald-500/20 bg-emerald-500/10'
  return ''
}

function statusCls(status: string) {
  const strict = riskTone(status)
  if (strict) return strict
  const s = (status || '').toLowerCase()
  if (s.includes('stress')) return 'text-red-300 border-red-500/20 bg-red-500/10'
  if (s.includes('risk') || s.includes('watch') || s.includes('tight') || s.includes('restrictive') || s.includes('expanding')) return 'text-amber-200 border-amber-500/20 bg-amber-500/10'
  if (s.includes('normal') || s.includes('easy') || s.includes('easing') || s.includes('compressed') || s.includes('align')) return 'text-emerald-200 border-emerald-500/20 bg-emerald-500/10'
  return 'border-white/10 text-slate-200 bg-white/5'
}

function qualityCls(q: string) {
  const v = (q || '').toUpperCase()
  if (v === 'REVISIONRISK') return 'border-red-400/30 text-red-300 bg-red-500/10'
  if (v === 'STALE') return 'border-amber-400/30 text-amber-300 bg-amber-400/10'
  if (v === 'PARTIAL') return 'border-sky-400/30 text-sky-300 bg-sky-500/10'
  if (v === 'OK') return 'border-emerald-400/30 text-emerald-300 bg-emerald-500/10'
  return 'border-white/10 text-slate-300 bg-white/5'
}

function toneCls(tone?: 'normal' | 'good' | 'warn' | 'danger') {
  if (tone === 'good') return 'border-emerald-400/30 text-emerald-300 bg-emerald-500/10'
  if (tone === 'warn') return 'border-amber-400/30 text-amber-300 bg-amber-400/10'
  if (tone === 'danger') return 'border-rose-400/30 text-rose-300 bg-rose-500/10'
  return 'border-white/10 text-slate-200 bg-white/5'
}

function levelFromGauge(v: number): 'normal' | 'caution' | 'alert' | 'risk' {
  if (v >= 85) return 'risk'
  if (v >= 66) return 'alert'
  if (v >= 33) return 'caution'
  return 'normal'
}

function levelBadgeClass(level: 'normal' | 'caution' | 'alert' | 'risk') {
  if (level === 'risk') return 'text-rose-200 border-rose-500/20 bg-rose-500/10'
  if (level === 'alert') return 'text-amber-200 border-amber-500/20 bg-amber-500/10'
  if (level === 'caution') return 'text-yellow-200 border-yellow-500/20 bg-yellow-500/10'
  return 'text-emerald-200 border-emerald-500/20 bg-emerald-500/10'
}

function koStatus(s: string) {
  const map: Record<string, string> = {
    Easy: '완충 여유',
    Neutral: '균형 구간',
    Tight: '압박 누적',
    Easing: '부담 완화',
    Stable: '중립 유지',
    Restrictive: '제약 강함',
    Compressed: '압축 구간',
    Normal: '기준 범위',
    Expanding: '팽창 구간',
    Stress: '고위험 경보',
    Risk: '위험 구간',
    Watch: '경계 강화',
    NA: '판별 불가',
  }
  return map[s] || s
}

function koQuality(s: string) {
  const map: Record<string, string> = {
    OK: '신뢰 양호',
    Partial: '신뢰 제한',
    Stale: '지연 데이터',
    STALE: '지연 데이터',
    PARTIAL: '신뢰 제한',
    RevisionRisk: '리비전 감지',
    NA: '데이터 부족',
  }
  return map[s] || s
}

export default function MacroDetailCard(props: Props) {
  const mode = useLangMode()
  const gaugeValue = toGaugeValue(props.value)
  const gaugeLevel = gaugeValue !== null ? levelFromGauge(gaugeValue) : null
  const partialQuality = props.quality === 'Partial'
  const partialQualityEff = (props.quality || '').toUpperCase() === 'PARTIAL'
  const tone = statusCls(props.statusLabel).includes('red')
    ? '#fca5a5'
    : statusCls(props.statusLabel).includes('amber') || statusCls(props.statusLabel).includes('orange')
      ? '#fcd34d'
      : '#6ee7b7'
  const asOfText = typeof props.ageMinutes === 'number' && Number.isFinite(props.ageMinutes)
    ? (props.ageMinutes < 60 ? `${Math.round(props.ageMinutes)}m` : `${Math.round(props.ageMinutes / 60)}h`)
    : '—'
  const zone = gaugeValue !== null ? zoneLabel(gaugeValue, mode) : (mode === 'ko' ? '기준 범위' : 'Normal')
  const zoneChips = mode === 'ko'
    ? ['기준 범위', '주의 구간', '위험 구간']
    : ['Normal', 'Caution', 'Risk']
  return (
    <div className={`bg-[#1a1a1a] rounded-2xl p-4 border ${partialQuality || partialQualityEff ? 'border-dashed border-sky-400/40' : 'border-[#2a2a2a]'}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xl md:text-2xl font-extrabold leading-tight tracking-tight text-slate-100 flex items-center gap-2">
            <span>{props.title}</span>
            {props.titleTip ? <InfoTip content={props.titleTip} /> : null}
          </div>
          {props.subtitle ? (
            <div className="mt-1 text-xs md:text-sm text-slate-400 leading-relaxed flex items-start gap-2">
              <span>{props.subtitle}</span>
              {props.subtitleTip ? <InfoTip content={props.subtitleTip} /> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] inline-flex items-center gap-1 ${props.stale ? 'text-amber-200' : 'text-slate-400'}`}>
            {props.stale ? <span title="Data is stale (delayed beyond threshold)">⚠</span> : null}
            AsOf: {asOfText}
          </span>
          {partialQuality || partialQualityEff ? (
            <span
              title={pickLang(mode, '부분 신뢰도 데이터', 'Partial-quality data')}
              className="px-1.5 py-0.5 rounded-full text-[10px] border border-sky-400/30 text-sky-200 bg-sky-500/10"
            >
              i
            </span>
          ) : null}
          {props.statusBadge ? (
            <span className={`px-2 py-0.5 rounded-full text-[10px] border ${toneCls(props.statusBadge.tone)}`}>
              {props.statusBadge.label}
            </span>
          ) : null}
          <span className={`px-2 py-0.5 rounded-full text-[10px] border ${gaugeLevel ? levelBadgeClass(gaugeLevel) : statusCls(props.statusLabel)}`}>
            {gaugeValue !== null
              ? zoneLabel(gaugeValue, mode)
              : mode === 'ko'
                ? koStatus(props.statusLabel)
                : props.statusLabel}
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="text-3xl md:text-4xl font-extrabold text-white leading-none">{props.value}</div>
        {gaugeValue !== null ? (
          <div className={`shrink-0 opacity-95 ${props.compactGauge ? 'mt-0.5' : '-mt-1'}`}>
            <Gauge value={gaugeValue} tone={tone} compact={props.compactGauge} />
          </div>
        ) : null}
      </div>
      <div className="mt-2 mb-2 rounded-lg border border-white/10 bg-black/15 px-2.5 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          {zoneChips.map((z) => {
            const active = z === zone
            return (
              <span
                key={z}
                className={`px-2 py-0.5 rounded-md text-[11px] border ${
                  active
                    ? 'border-cyan-400/40 text-cyan-200 bg-cyan-500/10'
                    : 'border-white/10 text-slate-400 bg-white/[0.02]'
                }`}
              >
                {z}
              </span>
            )
          })}
        </div>
      </div>
      {props.extras && props.extras.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {props.extras.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-slate-400">{item.label}</span>
              <span className={`px-1.5 py-0.5 rounded border ${toneCls(item.tone)}`}>{item.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 text-xs md:text-sm text-slate-300 leading-relaxed flex items-start gap-2" title={props.tooltip || ''}>
        <span>{props.refText}</span>
        {props.refTip ? <InfoTip content={props.refTip} /> : null}
      </div>
      <div className="mt-1 text-[11px] text-slate-500" title={props.tooltip || ''}>
        {pickLang(mode, '왜 중요한가', 'Why this matters')}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-400">{pickLang(mode, '업데이트', 'Updated')}: {props.updated || '—'}</div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] border ${qualityCls(props.quality)}`}>
          {mode === 'ko' ? koQuality(props.quality) : props.quality}
        </span>
      </div>
    </div>
  )
}
