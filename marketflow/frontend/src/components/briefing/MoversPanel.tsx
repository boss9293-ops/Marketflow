import {
  formatPercent,
  formatPrice,
  formatTimestampUtc,
  formatVolume,
  getMoverCategoryLabel,
  getTopMovers,
  type MoversCategoryKey,
  type MoversSnapshot,
} from '@/lib/briefing-data'

type Props = {
  movers: MoversSnapshot | null
}

const CATEGORY_ORDER: MoversCategoryKey[] = ['gainers', 'most_active', 'unusual_volume']

function toneForChange(changePct?: number | null): string {
  if (typeof changePct !== 'number' || Number.isNaN(changePct)) return 'text-slate-400'
  if (changePct > 0) return 'text-emerald-300'
  if (changePct < 0) return 'text-rose-300'
  return 'text-slate-300'
}

function formatMoverChange(changePct?: number | null): string {
  if (typeof changePct !== 'number' || Number.isNaN(changePct)) return '--'
  const abs = Math.abs(changePct)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2
  return formatPercent(changePct, digits)
}

function formatMoverPrice(price?: number | null): string {
  if (typeof price !== 'number' || Number.isNaN(price)) return '--'
  if (Math.abs(price) < 1) {
    return price.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 4 })
  }
  return formatPrice(price)
}

function MoversColumn({
  category,
  rows,
}: {
  category: MoversCategoryKey
  rows: ReturnType<typeof getTopMovers>
}) {
  return (
    <div className="overflow-hidden rounded-[2px] border border-slate-800/70 bg-white/[0.015]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 px-3 py-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
            {getMoverCategoryLabel(category)}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            Latest 5 rows
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_72px_76px_86px] border-b border-slate-800/70 bg-white/[0.012] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        <div>Symbol</div>
        <div className="text-right">Change</div>
        <div className="text-right">Price</div>
        <div className="text-right">Volume</div>
      </div>

      <div>
        {rows.map((row, index) => {
          const change = formatMoverChange(row.change_pct)
          const price = formatMoverPrice(row.price)
          const volume = formatVolume(row.volume)
          const title = row.name || row.raw_symbol || row.symbol || ''

          return (
            <div
              key={`${category}-${row.symbol}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_72px_76px_86px] border-b border-slate-800/70 px-3 py-2 last:border-b-0"
              title={title}
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] font-semibold tracking-[0.05em] text-cyan-200">
                  {row.symbol}
                </div>
                {row.name && (
                  <div className="truncate text-[10px] text-slate-500">
                    {row.name}
                  </div>
                )}
              </div>
              <div className={`font-mono text-right text-[11px] font-semibold tabular-nums ${toneForChange(row.change_pct)}`}>
                {change}
              </div>
              <div className="font-mono text-right text-[11px] font-semibold tabular-nums text-slate-200">
                {price}
              </div>
              <div className="font-mono text-right text-[11px] font-semibold tabular-nums text-slate-400">
                {volume}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function MoversPanel({ movers }: Props) {
  const categories = CATEGORY_ORDER.map((category) => ({
    category,
    rows: getTopMovers(movers, category, 5),
  })).filter((entry) => entry.rows.length > 0)

  const asOf = formatTimestampUtc(movers?.generated_at || movers?.as_of) || movers?.as_of || '--'
  const metaBits = [
    typeof movers?.record_count === 'number' ? `${movers.record_count} records` : null,
    movers?.summary && typeof movers.summary === 'object' && 'valid' in movers.summary
      ? `${String((movers.summary as { valid?: unknown }).valid ?? '--')} valid`
      : null,
    asOf !== '--' ? asOf : null,
  ].filter(Boolean) as string[]

  if (categories.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-cyan-300">
            Market Movers
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          No movers data available.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-cyan-300">
              Market Movers
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Filtered market action from the latest snapshot
          </p>
        </div>
        {metaBits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {metaBits.map((bit) => (
              <span key={bit} className="rounded-[2px] border border-slate-800/80 px-2 py-0.5">
                {bit}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {categories.map(({ category, rows }) => (
          <MoversColumn key={category} category={category} rows={rows} />
        ))}
      </div>
    </div>
  )
}
