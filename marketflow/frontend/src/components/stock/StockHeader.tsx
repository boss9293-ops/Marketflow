'use client'

import { StockAnalysisResponse, formatPrice, formatPct } from '@/lib/stockAnalysis'

type Props = {
  ticker: string
  analysis?: StockAnalysisResponse | null
  loading?: boolean
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} />
}

export default function StockHeader({ ticker, analysis, loading }: Props) {
  const name = analysis?.name || ticker
  const sector = analysis?.sector || 'Unknown sector'
  const exchange = analysis?.exchange || '--'
  const currentPrice = formatPrice(analysis?.current_price)
  const change = formatPct(analysis?.current_change_pct)
  const summary = analysis?.today_summary || 'Auto Mode is ready. Open a stock to generate the auto valuation narrative.'
  const mode = analysis?.analysis_mode || 'auto'
  const confidence = analysis?.confidence || 'low'
  const changePct = analysis?.current_change_pct
  const changeTone = typeof changePct === 'number'
    ? changePct >= 0
      ? 'text-emerald-300'
      : 'text-rose-300'
    : 'text-slate-300'

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.16),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.12),transparent_35%)]" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.28em] text-slate-400">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-cyan-200">Auto Mode</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{mode}</span>
            <span className={`rounded-full border px-3 py-1 ${confidence === 'high' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : confidence === 'medium' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-rose-400/30 bg-rose-400/10 text-rose-200'}`}>
              {confidence} confidence
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-4xl font-black tracking-tight text-white lg:text-5xl">{ticker}</div>
            <div className="text-lg font-semibold text-slate-200">
              {loading ? <SkeletonLine className="h-5 w-56" /> : name}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span>{loading ? <SkeletonLine className="h-4 w-28" /> : sector}</span>
              <span className="hidden h-1 w-1 rounded-full bg-slate-600 sm:inline-block" />
              <span>{loading ? <SkeletonLine className="h-4 w-24" /> : exchange}</span>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              {loading ? <SkeletonLine className="h-4 w-full" /> : summary}
            </p>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur md:grid-cols-2 lg:min-w-[300px]">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Current Price</div>
            <div className="mt-1 text-3xl font-black text-white">{loading ? <SkeletonLine className="h-9 w-28" /> : currentPrice}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Day Move</div>
            <div className={`mt-1 text-3xl font-black ${changeTone}`}>
              {loading ? <SkeletonLine className="h-9 w-24" /> : change}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
