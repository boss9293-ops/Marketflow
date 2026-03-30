'use client'

import { StockAnalysisResponse, pickConfidenceTone } from '@/lib/stockAnalysis'

type Props = {
  analysis?: StockAnalysisResponse | null
  loading?: boolean
  compact?: boolean
}

const toneClasses = {
  high: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  medium: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  low: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
} as const

export default function StockSummaryPanel({ analysis, loading, compact = false }: Props) {
  const tone = pickConfidenceTone(analysis?.confidence)
  const narrative = analysis?.narrative
  const valuationState = analysis?.valuation_state
  const headline =
    narrative?.headline || analysis?.summary || analysis?.today_summary || 'Auto summary will appear after the analysis response arrives.'
  const summary =
    narrative?.summary || analysis?.summary || analysis?.today_summary || 'Auto summary will appear after the analysis response arrives.'
  const bullCase = narrative?.bull_case || 'Bull case will appear after the analysis response arrives.'
  const bearCase = narrative?.bear_case || 'Bear case will appear after the analysis response arrives.'
  const riskNote = narrative?.risk_note || 'Risk note will appear after the analysis response arrives.'
  const confidenceNote = narrative?.confidence_note || 'Confidence reflects field coverage and valuation-data completeness.'
  const warnings = analysis?.warnings || []
  const valuationLabel = valuationState?.label || 'fair'
  const valuationDetail = valuationState?.detail || 'trading near normalized range'
  const coverageNote = warnings[0] || 'No major coverage gaps were flagged by the engine.'

  return (
    <section className={`rounded-3xl border border-white/10 bg-slate-950/85 shadow-[0_20px_60px_rgba(0,0,0,0.25)] ${compact ? 'p-4' : 'p-6'}`}>
      <div className={`mb-5 flex items-center justify-between gap-4 ${compact ? 'gap-3' : ''}`}>
        <div>
          <div className={`uppercase tracking-[0.28em] text-amber-300/80 ${compact ? 'text-[10px]' : 'text-xs'}`}>Summary</div>
          <h2 className={`mt-2 font-bold text-white ${compact ? 'text-lg' : 'text-xl'}`}>Auto Narrative</h2>
        </div>
        <div className="flex max-w-md flex-col items-end gap-2 text-right">
          <div className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.22em] ${toneClasses[tone]}`}>
            {analysis?.confidence || 'low'} confidence
          </div>
          <div className={`text-slate-500 ${compact ? 'text-[10px] leading-4' : 'text-xs leading-5'}`}>{confidenceNote}</div>
        </div>
      </div>

      <div className={`grid ${compact ? 'gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]' : 'gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]'}`}>
        <div className={`rounded-2xl border border-white/10 bg-white/5 ${compact ? 'p-4' : 'p-5'}`}>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Headline</div>
          <p className={`mt-2 font-semibold leading-8 text-white ${compact ? 'text-base' : 'text-lg'}`}>
            {loading ? 'Loading auto valuation response...' : headline}
          </p>
          <p className={`mt-4 ${compact ? 'text-xs leading-6' : 'text-sm leading-7'} text-slate-200`}>
            {loading ? 'Building the narrative from valuation history and scenario outputs.' : summary}
          </p>
        </div>

        <div className="grid gap-4">
          <div className={`rounded-2xl border border-white/10 bg-white/5 ${compact ? 'p-4' : 'p-5'}`}>
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Valuation State</div>
            <div className={`mt-2 font-black text-white ${compact ? 'text-xl' : 'text-2xl'}`}>{loading ? '--' : valuationLabel}</div>
            <div className={`mt-2 text-slate-300 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'}`}>{loading ? 'Loading state...' : valuationDetail}</div>
          </div>

          <div className={`rounded-2xl border border-white/10 bg-white/5 ${compact ? 'p-4' : 'p-5'}`}>
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Confidence Signal</div>
            <p className={`mt-2 text-slate-300 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'}`}>{loading ? 'Waiting for response...' : confidenceNote}</p>
          </div>

          <div className={`rounded-2xl border border-white/10 bg-white/5 ${compact ? 'p-4' : 'p-5'}`}>
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Data Coverage</div>
            <p className={`mt-2 text-slate-300 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'}`}>{loading ? 'Waiting for response...' : coverageNote}</p>
          </div>
        </div>
      </div>

      <div className={`mt-4 grid ${compact ? 'gap-2 md:grid-cols-3' : 'gap-3 md:grid-cols-3'}`}>
        <div className={`rounded-2xl border border-emerald-400/15 bg-emerald-400/6 ${compact ? 'p-3' : 'p-4'}`}>
          <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-200/70">Bull case</div>
          <p className={`mt-2 text-slate-200 ${compact ? 'text-xs leading-6' : 'text-sm leading-7'}`}>{loading ? 'Loading...' : bullCase}</p>
        </div>
        <div className={`rounded-2xl border border-rose-400/15 bg-rose-400/6 ${compact ? 'p-3' : 'p-4'}`}>
          <div className="text-[11px] uppercase tracking-[0.24em] text-rose-200/70">Bear case</div>
          <p className={`mt-2 text-slate-200 ${compact ? 'text-xs leading-6' : 'text-sm leading-7'}`}>{loading ? 'Loading...' : bearCase}</p>
        </div>
        <div className={`rounded-2xl border border-white/10 bg-white/5 ${compact ? 'p-3' : 'p-4'}`}>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Risk note</div>
          <p className={`mt-2 text-slate-200 ${compact ? 'text-xs leading-6' : 'text-sm leading-7'}`}>{loading ? 'Loading...' : riskNote}</p>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-[0.24em] text-slate-500">Coverage Notes</div>
          <div className="flex flex-wrap gap-2">
            {warnings.slice(0, 6).map((warning) => (
              <span key={warning} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                {warning}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
