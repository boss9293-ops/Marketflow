'use client'

import { calcUpsidePct, formatCurrency, formatPct, StockAnalysisResponse } from '@/lib/stockAnalysis'

type Props = {
  analysis?: StockAnalysisResponse | null
  loading?: boolean
  compact?: boolean
}

function ScenarioRow({
  label,
  target,
  current,
  accent,
  compact = false,
}: {
  label: string
  target?: number | null
  current?: number | null
  accent: string
  compact?: boolean
}) {
  const upside = calcUpsidePct(current, target)
  return (
    <div className={`rounded-2xl border ${accent} bg-white/5 shadow-inner shadow-black/10 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className={`uppercase tracking-[0.24em] text-slate-500 ${compact ? 'text-[10px]' : 'text-xs'}`}>{label}</div>
          <div className={`mt-2 font-black text-white ${compact ? 'text-xl' : 'text-2xl'}`}>{formatCurrency(target, 0)}</div>
        </div>
        <div className="text-right">
          <div className={`uppercase tracking-[0.22em] text-slate-500 ${compact ? 'text-[10px]' : 'text-xs'}`}>Upside</div>
          <div className={`mt-2 font-black ${compact ? 'text-xl' : 'text-2xl'} ${upside == null ? 'text-slate-300' : upside >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {formatPct(upside)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StockScenarioPanel({ analysis, loading, compact = false }: Props) {
  const current = analysis?.current_price
  const scenario = analysis?.scenario

  return (
    <section className={`rounded-3xl border border-white/10 bg-slate-950/85 shadow-[0_20px_60px_rgba(0,0,0,0.25)] ${compact ? 'p-4' : 'p-6'}`}>
      <div className={`mb-5 flex items-center justify-between ${compact ? 'gap-3' : ''}`}>
        <div>
          <div className={`uppercase tracking-[0.28em] text-violet-300/80 ${compact ? 'text-[10px]' : 'text-xs'}`}>3Y Scenario</div>
          <h2 className={`mt-2 font-bold text-white ${compact ? 'text-lg' : 'text-xl'}`}>Bear / Base / Bull</h2>
        </div>
        <div className={`rounded-full border border-white/10 bg-white/5 uppercase tracking-[0.22em] text-slate-400 ${compact ? 'px-2.5 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}`}>
          auto
        </div>
      </div>

      <div className={`grid ${compact ? 'gap-2.5 lg:grid-cols-3' : 'gap-3 lg:grid-cols-3'}`}>
        <ScenarioRow
          compact={compact}
          label="Bear"
          target={loading ? undefined : scenario?.bear}
          current={current}
          accent="border-rose-400/20"
        />
        <ScenarioRow
          compact={compact}
          label="Base"
          target={loading ? undefined : scenario?.base}
          current={current}
          accent="border-emerald-400/25"
        />
        <ScenarioRow
          compact={compact}
          label="Bull"
          target={loading ? undefined : scenario?.bull}
          current={current}
          accent="border-cyan-400/20"
        />
      </div>

      <div className={`mt-4 rounded-2xl border border-white/10 bg-white/5 ${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className={`uppercase tracking-[0.24em] text-slate-500 ${compact ? 'text-[10px]' : 'text-xs'}`}>Base Case Upside</div>
            <div className={`mt-2 font-black text-white ${compact ? 'text-xl' : 'text-2xl'}`}>
              {formatPct(calcUpsidePct(current, scenario?.base))}
            </div>
          </div>
          <div className={`text-right text-slate-400 ${compact ? 'text-xs' : 'text-sm'}`}>
            <div>Mode: {analysis?.analysis_mode || 'auto'}</div>
            <div>Confidence: {analysis?.confidence || 'low'}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
