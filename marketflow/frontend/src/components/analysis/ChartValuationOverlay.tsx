'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  AnalysisMode,
  StockAnalysisResponse,
  calcUpsidePct,
  fetchStockAnalysis,
  formatPct,
  formatPrice,
  normalizeTicker,
  pickConfidenceTone,
} from '@/lib/stockAnalysis'

type Props = {
  symbol?: string
  fetchKey?: number
  mode?: AnalysisMode
  analysis?: StockAnalysisResponse | null
  loading?: boolean
  error?: string | null
  compact?: boolean
}

const stateToneClasses = {
  premium: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  fair: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  discount: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
} as const

const confidenceToneClasses = {
  high: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  medium: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  low: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
} as const

function toNumber(value: unknown): number | null {
  if (value == null) return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildRange(values: Array<number | null>): { start: number; end: number } {
  const finite = values.filter((value): value is number => Number.isFinite(value))
  if (finite.length === 0) return { start: 0, end: 1 }

  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const spread = max - min
  const anchor = finite[finite.length - 1] ?? max
  const pad = spread > 0 ? Math.max(spread * 0.14, Math.abs(anchor) * 0.04 || 1) : Math.max(Math.abs(anchor) * 0.08 || 1, 1)
  return { start: min - pad, end: max + pad }
}

function positionForValue(value: number | null, range: { start: number; end: number }): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const span = range.end - range.start
  if (!Number.isFinite(span) || span <= 0) return 50
  return clamp(((value - range.start) / span) * 100, 0, 100)
}

function formatDistance(current: number | null, target: number | null): string {
  const upside = calcUpsidePct(current, target)
  return upside == null ? '--' : formatPct(upside)
}

function buildInterpretation(
  current: number | null,
  base: number | null,
  stateLabel: 'premium' | 'fair' | 'discount',
  context: string,
): string {
  if (current == null || base == null || !Number.isFinite(current) || !Number.isFinite(base) || base <= 0) {
    return 'Base comparison is unavailable until scenario data is loaded.'
  }

  const delta = (current - base) / base
  const relation =
    Math.abs(delta) < 0.0005
      ? 'at Base'
      : `${Math.abs(delta * 100).toFixed(1)}% ${delta >= 0 ? 'above' : 'below'} Base`

  const regime = stateLabel === 'premium' ? 'premium' : stateLabel === 'discount' ? 'discount' : 'fair'
  if (relation === 'at Base') {
    return context ? `Current price is at Base in a ${regime} regime; ${context}.` : `Current price is at Base in a ${regime} regime.`
  }
  return context
    ? `Current price sits ${relation} in a ${regime} regime; ${context}.`
    : `Current price sits ${relation} in a ${regime} regime.`
}

export default function ChartValuationOverlay({
  symbol = 'AAPL',
  fetchKey = 0,
  mode = 'auto',
  analysis,
  loading,
  error,
  compact = false,
}: Props) {
  const controlled = analysis !== undefined || loading !== undefined || error !== undefined
  const [fetchedAnalysis, setFetchedAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [fetchedLoading, setFetchedLoading] = useState(true)
  const [fetchedError, setFetchedError] = useState<string | null>(null)

  useEffect(() => {
    if (controlled) return

    const ticker = normalizeTicker(symbol) || 'AAPL'
    const controller = new AbortController()
    let alive = true

    setFetchedLoading(true)
    setFetchedError(null)
    setFetchedAnalysis(null)

    fetchStockAnalysis(ticker, mode, controller.signal)
      .then((payload) => {
        if (alive) setFetchedAnalysis(payload)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!alive) return
        setFetchedError(err instanceof Error ? err.message : 'Failed to load valuation overlay')
      })
      .finally(() => {
        if (alive) setFetchedLoading(false)
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [controlled, symbol, fetchKey, mode])

  const activeAnalysis = analysis !== undefined ? analysis : fetchedAnalysis
  const activeLoading = loading !== undefined ? loading : fetchedLoading
  const activeError = error !== undefined ? error : fetchedError

  const current = toNumber(activeAnalysis?.current_price)
  const bear = toNumber(activeAnalysis?.scenario?.bear)
  const base = toNumber(activeAnalysis?.scenario?.base)
  const bull = toNumber(activeAnalysis?.scenario?.bull)
  const valuationState = activeAnalysis?.valuation_state
  const confidence = pickConfidenceTone(activeAnalysis?.confidence)
  const confidenceNote = activeAnalysis?.narrative?.confidence_note || 'Confidence reflects field coverage and valuation-data completeness.'
  const contextLabel = valuationState?.detail || 'trading near normalized range'
  const state = valuationState?.label === 'premium' || valuationState?.label === 'discount' || valuationState?.label === 'fair' ? valuationState.label : 'fair'
  const stateDisplay = state.charAt(0).toUpperCase() + state.slice(1)

  const range = useMemo(() => buildRange([bear, base, bull, current]), [bear, base, bull, current])
  const markerPositions = useMemo(
    () => [
      { key: 'bear', label: 'Bear', value: bear, tone: 'rose' as const },
      { key: 'base', label: 'Base', value: base, tone: 'emerald' as const },
      { key: 'bull', label: 'Bull', value: bull, tone: 'cyan' as const },
    ].map((marker) => ({
      ...marker,
      position: positionForValue(marker.value, range),
    })),
    [bear, base, bull, range],
  )

  const currentPosition = positionForValue(current, range)
  const missingScenarioCount = [bear, base, bull].filter((value) => value == null).length
  const hasScenarioData = missingScenarioCount < 3
  const interpretation = buildInterpretation(current, base, state, contextLabel)

  return (
    <section className={`rounded-3xl border border-white/10 bg-slate-950/88 shadow-[0_20px_60px_rgba(0,0,0,0.22)] ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/75">Valuation Overlay</div>
          <h3 className={`mt-2 font-black text-white ${compact ? 'text-lg' : 'text-xl'}`}>Bear / Base / Bull Range</h3>
          <p className={`mt-2 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'} text-slate-400`}>
            Current price is positioned against the 3Y scenario band.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${
              stateToneClasses[state]
            }`}
          >
            {activeLoading ? 'Loading' : stateDisplay}
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${
              confidenceToneClasses[confidence]
            }`}
          >
            {activeLoading ? 'Loading' : `${activeAnalysis?.confidence || 'low'} confidence`}
          </span>
        </div>
      </div>

      <div className={`mt-3 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'} text-slate-300`}>
        {activeLoading ? 'Loading valuation context from the engine...' : interpretation}
      </div>
      <div className={`mt-1 ${compact ? 'text-[11px] leading-4' : 'text-xs leading-5'} text-slate-500`}>
        {activeLoading ? 'Confidence note will appear once the response arrives.' : confidenceNote}
      </div>

      {activeError && (
        <div className={`mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/8 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'} text-rose-100`}>
          {activeError}
        </div>
      )}

      <div className={`mt-5 rounded-2xl border border-white/10 bg-white/5 ${compact ? 'px-3 py-4' : 'px-4 py-6'}`}>
        <div className={`relative ${compact ? 'h-24' : 'h-32'}`}>
          <div className="absolute left-0 right-0 top-14 h-2 rounded-full bg-white/8" />
          <div className="absolute left-0 right-0 top-14 h-px bg-white/10" />

          {markerPositions.map((marker) => {
            const left = marker.position == null ? null : clamp(marker.position, 4, 96)
            const lineClass =
              marker.tone === 'rose'
                ? 'bg-rose-300/85'
                : marker.tone === 'emerald'
                  ? 'bg-emerald-300/85'
                  : 'bg-cyan-300/85'
            const dotClass =
              marker.tone === 'rose'
                ? 'border-rose-200 bg-rose-300'
                : marker.tone === 'emerald'
                  ? 'border-emerald-200 bg-emerald-300'
                  : 'border-cyan-200 bg-cyan-300'
            const labelClass =
              marker.tone === 'rose'
                ? 'border-rose-400/15 bg-rose-400/10 text-rose-100'
                : marker.tone === 'emerald'
                  ? 'border-emerald-400/15 bg-emerald-400/10 text-emerald-100'
                  : 'border-cyan-400/15 bg-cyan-400/10 text-cyan-100'

            if (left == null) return null

            return (
              <div key={marker.key} className="absolute top-0 -translate-x-1/2" style={{ left: `${left}%` }}>
                <div className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.22em] ${labelClass}`}>
                  {marker.label}
                </div>
                <div className={`mx-auto mt-2 h-8 w-px ${lineClass}`} />
                <div className={`mx-auto -mt-px h-3 w-3 rounded-full border ${dotClass}`} />
              </div>
            )
          })}

          {currentPosition != null && (
            <div className="absolute top-[-2px] -translate-x-1/2" style={{ left: `${clamp(currentPosition, 4, 96)}%` }}>
              <div className="rounded-full border border-cyan-300/20 bg-cyan-400/15 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]">
                Current
              </div>
              <div className="mx-auto mt-2 h-10 w-px bg-cyan-300/90" />
              <div className="mx-auto -mt-px h-4 w-4 rounded-full border border-cyan-200 bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.35)]" />
            </div>
          )}
        </div>

        {!activeLoading && !hasScenarioData && (
          <div className="mt-4 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-400">
            Scenario data is not available yet from the current feed.
          </div>
        )}
      </div>

      <div className={`mt-4 grid ${compact ? 'gap-2 md:grid-cols-3' : 'gap-3 md:grid-cols-3'}`}>
        {[
          { label: 'Bear', value: bear, tone: 'rose' as const },
          { label: 'Base', value: base, tone: 'emerald' as const },
          { label: 'Bull', value: bull, tone: 'cyan' as const },
        ].map((item) => {
          const distance = formatDistance(current, item.value)
          const valueTone =
            item.tone === 'rose'
              ? 'text-rose-100'
              : item.tone === 'emerald'
                ? 'text-emerald-100'
                : 'text-cyan-100'
          const borderTone =
            item.tone === 'rose'
              ? 'border-rose-400/15 bg-rose-400/6'
              : item.tone === 'emerald'
                ? 'border-emerald-400/15 bg-emerald-400/6'
                : 'border-cyan-400/15 bg-cyan-400/6'

          return (
            <div key={item.label} className={`rounded-2xl border ${compact ? 'p-3' : 'p-4'} ${borderTone}`}>
              <div className={`uppercase tracking-[0.22em] text-slate-500 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{item.label}</div>
              <div className={`mt-2 font-bold ${valueTone} ${compact ? 'text-base' : 'text-lg'}`}>{activeLoading ? '--' : formatPrice(item.value)}</div>
              <div className={`mt-2 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'} text-slate-300`}>
                to {item.label} {activeLoading ? '--' : distance}
              </div>
            </div>
          )
        })}
      </div>

    </section>
  )
}
