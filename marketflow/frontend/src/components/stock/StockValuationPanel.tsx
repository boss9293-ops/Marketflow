'use client'

import { StockAnalysisResponse, formatMultiple, formatPct, formatPrice } from '@/lib/stockAnalysis'

type Props = {
  analysis?: StockAnalysisResponse | null
  loading?: boolean
  compact?: boolean
}

function MetricCard({
  label,
  value,
  accent = 'text-slate-100',
  helper,
  compact = false,
}: {
  label: string
  value: string
  accent?: string
  helper?: string
  compact?: boolean
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 shadow-inner shadow-black/10 ${compact ? 'p-3' : 'p-4'}`}>
      <div className={`uppercase tracking-[0.24em] text-slate-500 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{label}</div>
      <div className={`mt-2 font-black ${accent} ${compact ? 'text-lg' : 'text-2xl'}`}>{value}</div>
      {helper && <div className={`mt-2 ${compact ? 'text-[10px] leading-4' : 'text-[11px] leading-4'} text-slate-500`}>{helper}</div>}
    </div>
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export default function StockValuationPanel({ analysis, loading, compact = false }: Props) {
  const valuation = analysis?.valuation
  const valuationState = analysis?.valuation_state
  const currentPe = formatMultiple(analysis?.current_pe)
  const sectorPe = formatMultiple(analysis?.sector_pe)
  const pe3y = formatMultiple(analysis?.historical_pe?.pe_3y)
  const pe5y = formatMultiple(analysis?.historical_pe?.pe_5y)
  const epsTtm = formatPrice(valuation?.eps_ttm)
  const epsFwd = formatPrice(valuation?.eps_forward)
  const grossMargin = formatPct(valuation?.gross_margin)
  const operatingMargin = formatPct(valuation?.operating_margin)
  const netMargin = formatPct(valuation?.net_margin)
  const debtToEquityValue = valuation?.debt_to_equity
  const currentRatioValue = valuation?.current_ratio
  const debtToEquity = !isFiniteNumber(debtToEquityValue)
    ? '--'
    : `${debtToEquityValue.toFixed(2)}x`
  const currentRatio = !isFiniteNumber(currentRatioValue)
    ? '--'
    : `${currentRatioValue.toFixed(2)}x`
  const valuationLabel = valuationState?.label || 'fair'
  const valuationDetail = valuationState?.detail || 'trading near normalized range'
  const missingFeed = 'Unavailable from current feed'
  const missingCoverage = 'Not enough normalized data yet'
  const limitedCoverage = 'Coverage varies by feed'

  return (
    <section className={`rounded-3xl border border-white/10 bg-slate-950/85 shadow-[0_20px_60px_rgba(0,0,0,0.25)] ${compact ? 'p-4' : 'p-6'}`}>
      <div className={`mb-5 flex items-center justify-between ${compact ? 'gap-3' : ''}`}>
        <div>
          <div className={`uppercase tracking-[0.28em] text-cyan-300/80 ${compact ? 'text-[10px]' : 'text-xs'}`}>Valuation Engine</div>
          <h2 className={`mt-2 font-bold text-white ${compact ? 'text-lg' : 'text-xl'}`}>Auto Multiple + EPS</h2>
        </div>
        <div className={`rounded-2xl border border-white/10 bg-white/5 text-right ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
          <div className={`uppercase tracking-[0.24em] text-slate-500 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>Valuation State</div>
          <div className={`mt-1 font-bold text-white ${compact ? 'text-sm' : 'text-base'}`}>{loading ? '--' : valuationLabel}</div>
          <div className={`mt-1 max-w-[220px] ${compact ? 'text-[10px] leading-4' : 'text-[11px] leading-4'} text-slate-400`}>{loading ? 'Loading state' : valuationDetail}</div>
        </div>
      </div>

      <div className={`grid ${compact ? 'gap-2.5 md:grid-cols-2 xl:grid-cols-4' : 'gap-3 md:grid-cols-2 xl:grid-cols-4'}`}>
        <MetricCard compact={compact} label="Current PE" value={loading ? '--' : currentPe} accent="text-cyan-200" helper={!loading && currentPe === '--' ? missingFeed : undefined} />
        <MetricCard compact={compact} label="Sector PE" value={loading ? '--' : sectorPe} accent="text-emerald-200" helper={!loading && sectorPe === '--' ? 'Sector sample not available' : undefined} />
        <MetricCard compact={compact} label="Historical PE 3Y" value={loading ? '--' : pe3y} accent="text-amber-200" helper={!loading && pe3y === '--' ? missingCoverage : undefined} />
        <MetricCard compact={compact} label="Historical PE 5Y" value={loading ? '--' : pe5y} accent="text-fuchsia-200" helper={!loading && pe5y === '--' ? missingCoverage : undefined} />
      </div>

      <div className={`mt-4 grid ${compact ? 'gap-2.5 md:grid-cols-2 xl:grid-cols-4' : 'gap-3 md:grid-cols-2 xl:grid-cols-4'}`}>
        <MetricCard compact={compact} label="EPS TTM" value={loading ? '--' : epsTtm} helper={!loading && epsTtm === '--' ? missingFeed : undefined} />
        <MetricCard compact={compact} label="EPS Forward" value={loading ? '--' : epsFwd} helper={!loading && epsFwd === '--' ? missingFeed : undefined} />
        <MetricCard compact={compact} label="Gross Margin" value={loading ? '--' : grossMargin} helper={!loading && grossMargin === '--' ? missingCoverage : undefined} />
        <MetricCard compact={compact} label="Operating Margin" value={loading ? '--' : operatingMargin} helper={!loading && operatingMargin === '--' ? missingCoverage : undefined} />
      </div>

      <div className={`mt-4 grid ${compact ? 'gap-2.5 md:grid-cols-2 xl:grid-cols-4' : 'gap-3 md:grid-cols-2 xl:grid-cols-4'}`}>
        <MetricCard compact={compact} label="Net Margin" value={loading ? '--' : netMargin} helper={!loading && netMargin === '--' ? missingCoverage : undefined} />
        <MetricCard compact={compact} label="Debt / Equity" value={loading ? '--' : debtToEquity} helper={!loading && debtToEquity === '--' ? limitedCoverage : undefined} />
        <MetricCard compact={compact} label="Current Ratio" value={loading ? '--' : currentRatio} helper={!loading && currentRatio === '--' ? limitedCoverage : undefined} />
        <MetricCard
          compact={compact}
          label="Multiple Source"
          value={loading ? '--' : (valuation?.historical_multiple_source || 'price-history')}
          helper={!loading && !valuation?.historical_multiple_source ? missingCoverage : undefined}
        />
      </div>
    </section>
  )
}
