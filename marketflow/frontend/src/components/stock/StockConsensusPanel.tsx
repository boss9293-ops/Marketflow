'use client'

import { StockAnalysisResponse, calcUpsidePct, formatMultiple, formatPct, formatPrice } from '@/lib/stockAnalysis'

type Props = {
  analysis?: StockAnalysisResponse | null
  loading?: boolean
}

type MarkerTone = 'rose' | 'emerald' | 'cyan'

function formatSignedPct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
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
  const pad = spread > 0 ? Math.max(spread * 0.12, Math.abs(anchor) * 0.04 || 1) : Math.max(Math.abs(anchor) * 0.08 || 1, 1)
  return { start: min - pad, end: max + pad }
}

function positionForValue(value: number | null, range: { start: number; end: number }): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const span = range.end - range.start
  if (!Number.isFinite(span) || span <= 0) return 50
  return clamp(((value - range.start) / span) * 100, 0, 100)
}

function MetricCard({
  label,
  value,
  helper,
  accent = 'text-slate-100',
}: {
  label: string
  value: string
  helper?: string
  accent?: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner shadow-black/10">
      <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-black ${accent}`}>{value}</div>
      {helper && <div className="mt-2 text-[11px] leading-4 text-slate-500">{helper}</div>}
    </div>
  )
}

function CompareCard({
  label,
  value,
  current,
  tone,
}: {
  label: string
  value?: number | null
  current?: number | null
  tone: MarkerTone
}) {
  const delta = calcUpsidePct(current, value ?? null)
  const colorClass =
    tone === 'rose'
      ? 'border-rose-400/15 bg-rose-400/6 text-rose-100'
      : tone === 'emerald'
        ? 'border-emerald-400/15 bg-emerald-400/6 text-emerald-100'
        : 'border-cyan-400/15 bg-cyan-400/6 text-cyan-100'

  return (
    <div className={`rounded-2xl border p-4 ${colorClass}`}>
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-bold">{formatPrice(value)}</div>
      <div className="mt-2 text-xs leading-5 text-slate-300">{delta == null ? 'vs current --' : `vs current ${formatPct(delta)}`}</div>
    </div>
  )
}

type ConsensusLadderRow = {
  year?: number | null
  label?: string
  detail?: string
  kind?: string
  eps?: number | null
  analyst_count?: number | null
  growth_pct?: number | null
  raw_date?: string | null
  forward_pe?: number | null
}

function calcForwardPe(current: number | null, eps: number | null): number | null {
  if (current == null || eps == null) return null
  if (!Number.isFinite(current) || !Number.isFinite(eps) || current <= 0 || eps <= 0) return null
  return current / eps
}

function buildConsensusLadderRows(
  consensus: StockAnalysisResponse['consensus'] | undefined,
  current: number | null,
): ConsensusLadderRow[] {
  const source = (consensus?.forward_pe_ladder?.length ? consensus.forward_pe_ladder : consensus?.eps_ladder) ?? []
  if (!Array.isArray(source)) return []

  return source
    .filter((row): row is ConsensusLadderRow => Boolean(row && typeof row === 'object'))
    .map((row) => {
      const eps = row.eps ?? null
      const forwardPe = row.forward_pe ?? calcForwardPe(current, eps)
      return {
        ...row,
        eps,
        forward_pe: forwardPe,
      }
    })
    .filter((row) => row.year != null || row.label != null || row.eps != null || row.forward_pe != null)
}

function ConsensusLadderTable({
  rows,
  loading,
}: {
  rows: ConsensusLadderRow[]
  loading: boolean
}) {
  return (
    <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Annual EPS Ladder</div>
          <h3 className="mt-2 text-lg font-bold text-white">Consensus EPS and Forward P/E</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Using the street consensus EPS ladder against the current price, separate from the internal valuation model.
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
          {loading ? 'Loading annual estimates' : 'FMP annual estimates'}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                <th className="px-4 py-2 text-left">Fiscal Year</th>
                <th className="px-4 py-2 text-right">EPS Consensus</th>
                <th className="px-4 py-2 text-right">Growth vs Prior</th>
                <th className="px-4 py-2 text-right">Forward P/E</th>
                <th className="px-4 py-2 text-right">Analysts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const toneClass =
                  row.kind === 'actual'
                    ? 'border-amber-400/15 bg-amber-400/6'
                    : 'border-cyan-400/10 bg-slate-950/60'
                return (
                  <tr key={`${row.year ?? 'row'}-${index}`} className={`rounded-2xl border ${toneClass}`}>
                    <td className="rounded-l-2xl px-4 py-3 align-top">
                      <div className="text-sm font-semibold text-white">{row.label ?? row.year ?? '--'}</div>
                      <div className="mt-1 text-[11px] leading-4 text-slate-500">
                        {row.detail || (row.kind === 'estimate' ? 'using the consensus earnings estimate' : 'actual')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-top text-sm font-semibold text-white">{formatPrice(row.eps)}</td>
                    <td className="px-4 py-3 text-right align-top text-sm text-slate-200">
                      {row.growth_pct == null ? '--' : formatPct(row.growth_pct)}
                    </td>
                    <td className="px-4 py-3 text-right align-top text-sm font-semibold text-cyan-100">
                      {formatMultiple(row.forward_pe)}
                    </td>
                    <td className="rounded-r-2xl px-4 py-3 text-right align-top text-sm text-slate-200">
                      {row.analyst_count == null ? '--' : row.analyst_count}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-5 text-sm text-slate-500">
          Annual EPS ladder is not available in the current consensus snapshot.
        </div>
      )}
    </div>
  )
}

function buildStreetTone(currentUpside: number | null): {
  label: 'Buy' | 'Hold' | 'Sell'
  tone: 'emerald' | 'slate' | 'rose'
  detail: string
} {
  if (currentUpside == null) {
    return {
      label: 'Hold',
      tone: 'slate',
      detail: 'Consensus coverage is incomplete, so the tone leans neutral.',
    }
  }

  if (currentUpside >= 0.15) {
    return {
      label: 'Buy',
      tone: 'emerald',
      detail: `Consensus mean implies ${formatSignedPct(currentUpside)} upside vs current.`,
    }
  }

  if (currentUpside <= -0.1) {
    const absUpside = `${(Math.abs(currentUpside) * 100).toFixed(1)}%`
    return {
      label: 'Sell',
      tone: 'rose',
      detail: `Consensus mean sits ${absUpside} below current.`,
    }
  }

  const absUpside = `${(Math.abs(currentUpside) * 100).toFixed(1)}%`
  return {
    label: 'Hold',
    tone: 'slate',
    detail: `Consensus mean is ${absUpside} from current, keeping the tone balanced.`,
  }
}

const streetToneClasses = {
  emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  slate: 'border-slate-400/25 bg-slate-400/10 text-slate-100',
  rose: 'border-rose-400/25 bg-rose-400/10 text-rose-100',
} as const

const streetToneTextClasses = {
  emerald: 'text-emerald-200',
  slate: 'text-slate-300',
  rose: 'text-rose-200',
} as const

function ConsensusForecastChart({
  current,
  consensusLow,
  consensusMean,
  consensusHigh,
  internalBase,
}: {
  current: number | null
  consensusLow: number | null
  consensusMean: number | null
  consensusHigh: number | null
  internalBase: number | null
}) {
  const values = [current, consensusLow, consensusMean, consensusHigh, internalBase].filter(
    (value): value is number => Number.isFinite(value),
  )

  if (values.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(8,15,28,0.96))] text-sm text-slate-500">
        Consensus chart will appear once target data is available.
      </div>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = max - min
  const pad = spread > 0 ? Math.max(spread * 0.18, Math.abs(max) * 0.04 || 1) : Math.max(Math.abs(max) * 0.08 || 1, 1)
  const domainStart = min - pad
  const domainEnd = max + pad
  const domainSpan = domainEnd - domainStart || 1

  const width = 1000
  const height = 420
  const padLeft = 72
  const padRight = 132
  const padTop = 34
  const padBottom = 54
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const currentX = padLeft + plotWidth * 0.42
  const forecastX = padLeft + plotWidth * 0.92
  const yFor = (value: number | null): number | null => {
    if (value == null || !Number.isFinite(value)) return null
    return padTop + ((domainEnd - value) / domainSpan) * plotHeight
  }

  const currentY = yFor(current)
  const lowY = yFor(consensusLow)
  const meanY = yFor(consensusMean)
  const highY = yFor(consensusHigh)
  const internalBaseY = yFor(internalBase)

  const ticks = Array.from({ length: 5 }, (_, index) => domainEnd - (domainSpan * index) / 4)

  const fanPoints =
    currentY != null && lowY != null && highY != null
      ? `${currentX},${currentY} ${forecastX},${highY} ${forecastX},${lowY}`
      : ''

  return (
    <div className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(8,15,28,0.96))] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Analysts 12-Month Price Target</div>
        <div className="text-xs text-slate-500">Forecast cone vs internal base</div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="block h-[420px] w-full overflow-visible">
        <defs>
          <linearGradient id="consensusFan" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(34,197,94,0.06)" />
            <stop offset="100%" stopColor="rgba(14,165,233,0.12)" />
          </linearGradient>
          <linearGradient id="currentGlow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(34,211,238,0.9)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0.2)" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => {
          const y = yFor(tick)
          if (y == null) return null
          return (
            <g key={tick}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="rgba(148,163,184,0.16)" strokeDasharray="2 6" />
              <text x={padLeft - 14} y={y + 4} textAnchor="end" fontSize="12" fill="rgba(148,163,184,0.78)">
                {formatPrice(tick)}
              </text>
            </g>
          )
        })}

        <line x1={padLeft} x2={width - padRight} y1={padTop} y2={padTop} stroke="rgba(255,255,255,0.06)" />
        <line x1={padLeft} x2={padLeft} y1={padTop} y2={height - padBottom} stroke="rgba(255,255,255,0.08)" />
        <line x1={width - padRight} x2={width - padRight} y1={padTop} y2={height - padBottom} stroke="rgba(255,255,255,0.08)" />

        {internalBaseY != null && (
          <g>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={internalBaseY}
              y2={internalBaseY}
              stroke="rgba(245,158,11,0.65)"
              strokeDasharray="8 6"
              strokeWidth="1.6"
            />
            <rect x={padLeft + 8} y={internalBaseY - 24} rx="8" ry="8" width="150" height="22" fill="rgba(245,158,11,0.10)" stroke="rgba(245,158,11,0.18)" />
            <text x={padLeft + 18} y={internalBaseY - 8} fontSize="11" fill="rgba(253,230,138,0.95)" letterSpacing="0.12em">
              INTERNAL BASE
            </text>
            <text x={padLeft + 110} y={internalBaseY - 8} fontSize="11" fill="white">
              {formatPrice(internalBase)}
            </text>
          </g>
        )}

        {fanPoints && (
          <polygon points={fanPoints} fill="url(#consensusFan)" stroke="none" />
        )}

        {currentY != null && (
          <g>
            <line x1={padLeft} x2={currentX} y1={currentY} y2={currentY} stroke="rgba(34,211,238,0.9)" strokeWidth="2.2" />
            <circle cx={currentX} cy={currentY} r="6" fill="#06111d" stroke="rgba(34,211,238,0.95)" strokeWidth="3" />
            <circle cx={currentX} cy={currentY} r="13" fill="rgba(34,211,238,0.10)" />
            <text x={currentX - 4} y={currentY - 14} textAnchor="middle" fontSize="11" fill="rgba(165,243,252,0.98)" letterSpacing="0.16em">
              CURRENT
            </text>
            <text x={currentX - 4} y={currentY + 24} textAnchor="middle" fontSize="13" fill="white">
              {formatPrice(current)}
            </text>
          </g>
        )}

        {currentY != null && consensusHigh != null && highY != null && (
          <line x1={currentX} x2={forecastX} y1={currentY} y2={highY} stroke="rgba(45,212,191,0.95)" strokeWidth="2.5" />
        )}
        {currentY != null && consensusMean != null && meanY != null && (
          <line x1={currentX} x2={forecastX} y1={currentY} y2={meanY} stroke="rgba(34,197,94,0.95)" strokeWidth="2.5" />
        )}
        {currentY != null && consensusLow != null && lowY != null && (
          <line x1={currentX} x2={forecastX} y1={currentY} y2={lowY} stroke="rgba(248,113,113,0.95)" strokeWidth="2.5" />
        )}

        {highY != null && (
          <g>
            <circle cx={forecastX} cy={highY} r="5" fill="rgba(45,212,191,1)" />
            <text x={forecastX + 14} y={highY - 8} fontSize="11" fill="rgba(165,243,252,0.95)" letterSpacing="0.14em">
              HIGH
            </text>
            <text x={forecastX + 14} y={highY + 10} fontSize="13" fill="white">
              {formatPrice(consensusHigh)}
            </text>
          </g>
        )}
        {meanY != null && (
          <g>
            <circle cx={forecastX} cy={meanY} r="5" fill="rgba(34,197,94,1)" />
            <text x={forecastX + 14} y={meanY - 8} fontSize="11" fill="rgba(187,247,208,0.95)" letterSpacing="0.14em">
              AVERAGE
            </text>
            <text x={forecastX + 14} y={meanY + 10} fontSize="13" fill="white">
              {formatPrice(consensusMean)}
            </text>
          </g>
        )}
        {lowY != null && (
          <g>
            <circle cx={forecastX} cy={lowY} r="5" fill="rgba(248,113,113,1)" />
            <text x={forecastX + 14} y={lowY - 8} fontSize="11" fill="rgba(254,202,202,0.95)" letterSpacing="0.14em">
              LOW
            </text>
            <text x={forecastX + 14} y={lowY + 10} fontSize="13" fill="white">
              {formatPrice(consensusLow)}
            </text>
          </g>
        )}

        <text x={padLeft} y={height - 18} fontSize="11" fill="rgba(148,163,184,0.7)" letterSpacing="0.16em">
          CURRENT
        </text>
        <text x={forecastX - 20} y={height - 18} fontSize="11" fill="rgba(148,163,184,0.7)" letterSpacing="0.16em">
          12-MONTH FORECAST
        </text>
      </svg>
    </div>
  )
}

function buildCompareSentence({
  current,
  internalBear,
  internalBase,
  internalBull,
  consensusMean,
}: {
  current: number | null
  internalBear: number | null
  internalBase: number | null
  internalBull: number | null
  consensusMean: number | null
}): string {
  if (
    current == null ||
    internalBear == null ||
    internalBase == null ||
    internalBull == null ||
    consensusMean == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(internalBear) ||
    !Number.isFinite(internalBase) ||
    !Number.isFinite(internalBull) ||
    !Number.isFinite(consensusMean) ||
    current <= 0 ||
    internalBear <= 0 ||
    internalBase <= 0 ||
    internalBull <= 0 ||
    consensusMean <= 0
  ) {
    return 'Internal and Street consensus comparison will appear once both sets of targets are available.'
  }

  const consensusVsCurrent = formatSignedPct(calcUpsidePct(current, consensusMean))
  const consensusVsBase = formatSignedPct(calcUpsidePct(internalBase, consensusMean))

  let position = 'above the internal bull case'
  if (consensusMean < internalBull && consensusMean >= internalBase) {
    position = 'between the internal base and bull cases'
  } else if (consensusMean < internalBase && consensusMean >= internalBear) {
    position = 'between the internal bear and base cases'
  } else if (consensusMean < internalBear) {
    position = 'below the internal bear case'
  }

  return `Street mean is ${consensusVsCurrent} vs current and ${position}; it is ${consensusVsBase} relative to the internal base case.`
}

export default function StockConsensusPanel({ analysis, loading }: Props) {
  const consensus = analysis?.consensus
  const current = analysis?.current_price ?? null
  const consensusMean = consensus?.target_mean ?? null
  const consensusHigh = consensus?.target_high ?? null
  const consensusLow = consensus?.target_low ?? null
  const analystCount = consensus?.analyst_count ?? null
  const internalBear = analysis?.scenario?.bear ?? null
  const internalBase = analysis?.scenario?.base ?? null
  const internalBull = analysis?.scenario?.bull ?? null
  const ladderRows = buildConsensusLadderRows(consensus, current)
  const hasConsensus = Boolean(
    consensus &&
      (consensusMean != null ||
        consensusHigh != null ||
        consensusLow != null ||
        analystCount != null ||
        ladderRows.length > 0),
  )

  if (!loading && !hasConsensus) {
    return null
  }

  const loadingShell = Boolean(loading && !hasConsensus)
  const currentUpside = calcUpsidePct(current, consensusMean)
  const compareSentence = buildCompareSentence({
    current,
    internalBear,
    internalBase,
    internalBull,
    consensusMean,
  })
  const streetTone = buildStreetTone(currentUpside)
  const consensusNote =
    analysis?.narrative?.consensus_note ||
    'FMP consensus coverage is incomplete, so the comparison leans on the available snapshot.'
  const range = buildRange([consensusLow, consensusMean, consensusHigh, current])
  const lowPosition = positionForValue(consensusLow, range)
  const meanPosition = positionForValue(consensusMean, range)
  const highPosition = positionForValue(consensusHigh, range)
  const currentPosition = positionForValue(current, range)

  return (
    <section className="rounded-3xl border border-cyan-400/10 bg-slate-950/88 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/75">Street Consensus</div>
          <h2 className="mt-2 text-xl font-black text-white">FMP Analyst Snapshot</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Market consensus is kept separate from the internal valuation model.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] ${streetToneClasses[streetTone.tone]}`}>
            {loadingShell ? 'Loading' : streetTone.label}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-300">
            {loadingShell ? 'Loading' : analystCount != null ? `${analystCount} analysts` : 'Coverage only'}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-300">
            {loadingShell || currentUpside == null ? 'vs current --' : `${formatSignedPct(currentUpside)} vs current`}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Overall Consensus</div>
          <div className="mt-3 flex items-baseline gap-3">
            <div className="text-5xl font-black leading-none text-white">{loadingShell || analystCount == null ? '--' : analystCount}</div>
            <div className="pb-1 text-sm uppercase tracking-[0.18em] text-slate-400">Analysts</div>
          </div>
          <div className="mt-6 text-[11px] uppercase tracking-[0.24em] text-slate-500">Analysts 12-Month Price Target</div>
          <div className="mt-2 text-3xl font-black text-white">{loadingShell ? '--' : formatPrice(consensusMean)}</div>
          <div className="mt-2 text-lg font-semibold text-emerald-300">
            {loadingShell || currentUpside == null ? '--' : `${formatSignedPct(currentUpside)} Upside`}
          </div>
          <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3">
            <div className={`text-[11px] uppercase tracking-[0.24em] ${streetToneTextClasses[streetTone.tone]}`}>
              Street Tone
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{loadingShell ? 'Loading' : streetTone.label}</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {loadingShell ? 'Tone will appear once consensus loads.' : `${streetTone.detail} Ratings breakdown is not available.`}
            </p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Current</div>
              <div className="mt-1 text-sm font-semibold text-white">{loadingShell ? '--' : formatPrice(current)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Low</div>
              <div className="mt-1 text-sm font-semibold text-rose-100">{loadingShell ? '--' : formatPrice(consensusLow)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Mean</div>
              <div className="mt-1 text-sm font-semibold text-emerald-100">{loadingShell ? '--' : formatPrice(consensusMean)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">High</div>
              <div className="mt-1 text-sm font-semibold text-cyan-100">{loadingShell ? '--' : formatPrice(consensusHigh)}</div>
            </div>
          </div>
          <div className="mt-4 text-xs leading-5 text-slate-500">
            {loadingShell ? 'Loading consensus snapshot...' : consensusNote}
          </div>
        </div>

        <ConsensusForecastChart
          current={current}
          consensusLow={consensusLow}
          consensusMean={consensusMean}
          consensusHigh={consensusHigh}
          internalBase={internalBase}
        />
      </div>

      <ConsensusLadderTable rows={ladderRows} loading={loadingShell} />

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <CompareCard label="Internal Bear" value={internalBear} current={current} tone="rose" />
        <CompareCard label="Internal Base" value={internalBase} current={current} tone="emerald" />
        <CompareCard label="Internal Bull" value={internalBull} current={current} tone="cyan" />
        <CompareCard label="Street Mean" value={consensusMean} current={current} tone="emerald" />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Compare Strip</div>
        <p className="mt-2 text-sm leading-6 text-slate-200">
          {loadingShell ? 'Loading internal and Street consensus comparison...' : compareSentence}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {loadingShell ? 'Consensus note will appear once the snapshot loads.' : consensusNote}
        </p>
        </div>
    </section>
  )
}
