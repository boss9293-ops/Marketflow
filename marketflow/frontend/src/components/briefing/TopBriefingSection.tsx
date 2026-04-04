export type TopBriefingStateBadges = {
  market_regime?: string | null
  cross_asset_signal?: string | null
  short_term_status?: string | null
  risk_quality?: string | null
  fusion_confidence?: number | null
}

export type TopBriefingSnapshot = {
  theme_title?: string | null
  theme_subtitle?: string | null
  fusion_summary?: string | null
  state_badges?: TopBriefingStateBadges | null
}

type Tone = 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate'

const TONE_STYLES: Record<Tone, string> = {
  emerald: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-100',
  amber: 'border-amber-400/20 bg-amber-400/5 text-amber-100',
  rose: 'border-rose-400/20 bg-rose-400/5 text-rose-100',
  cyan: 'border-cyan-400/20 bg-cyan-400/5 text-cyan-100',
  slate: 'border-slate-700/70 bg-slate-900/60 text-slate-300',
}

function humanize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function toneForBadge(key: keyof TopBriefingStateBadges, value?: string | null): Tone {
  const normalized = (value ?? '').toLowerCase().trim()
  if (!normalized) return 'slate'

  if (key === 'fusion_confidence') {
    const confidence = Number(value)
    if (Number.isNaN(confidence)) return 'slate'
    if (confidence >= 0.7) return 'emerald'
    if (confidence >= 0.5) return 'amber'
    return 'rose'
  }

  if (key === 'market_regime') {
    if (normalized.includes('risk_on')) return 'emerald'
    if (normalized.includes('risk_off')) return 'rose'
    return 'amber'
  }

  if (key === 'cross_asset_signal') {
    if (normalized.includes('clean')) return 'emerald'
    if (normalized.includes('fragile') || normalized.includes('headwind')) return 'amber'
    if (normalized.includes('risk_off')) return 'rose'
    return 'cyan'
  }

  if (key === 'short_term_status') {
    if (normalized.includes('accelerating_up') || normalized.includes('rebound_up')) return 'emerald'
    if (normalized.includes('accelerating_down')) return 'rose'
    if (normalized.includes('weakening') || normalized.includes('mixed')) return 'amber'
    return 'cyan'
  }

  return 'slate'
}

function badgeValue(value?: string | null): string {
  const trimmed = value?.trim()
  return trimmed ? humanize(trimmed) : ''
}

export default function TopBriefingSection({ data }: { data?: TopBriefingSnapshot | null }) {
  const title = data?.theme_title?.trim() || ''
  const subtitle = data?.theme_subtitle?.trim() || ''
  const summary = data?.fusion_summary?.trim() || ''
  const stateBadges = data?.state_badges ?? {}

  const badgeItems = [
    { key: 'market_regime' as const, value: stateBadges.market_regime },
    { key: 'cross_asset_signal' as const, value: stateBadges.cross_asset_signal },
    { key: 'short_term_status' as const, value: stateBadges.short_term_status },
    { key: 'risk_quality' as const, value: stateBadges.risk_quality },
    {
      key: 'fusion_confidence' as const,
      value:
        typeof stateBadges.fusion_confidence === 'number' && !Number.isNaN(stateBadges.fusion_confidence)
          ? stateBadges.fusion_confidence.toString()
          : undefined,
    },
  ].filter((item) => Boolean(item.value?.trim()))

  if (!title && !subtitle && !summary && badgeItems.length === 0) {
    return null
  }

  return (
    <section className="relative overflow-hidden rounded-[2px] border border-slate-800/75 bg-[#05070a]">
      <div className="relative p-3 md:p-4">
        <div className="h-px w-10 bg-cyan-400/20" />

        <div className="mt-2 max-w-3xl">
          <h2 className="text-balance text-xl font-semibold tracking-tight text-slate-50 md:text-2xl">
            {title || '--'}
          </h2>
          {subtitle && (
            <p className="mt-1 text-balance text-[11px] font-medium text-slate-400 md:text-xs">
              {subtitle}
            </p>
          )}
        </div>

        {summary && (
          <div className="mt-3 max-w-2xl border-l border-cyan-400/10 pl-3">
            <p className="text-pretty text-[13px] leading-5 text-slate-200/85">
              {summary}
            </p>
          </div>
        )}

        {badgeItems.length > 0 && (
          <div className="mt-2.5 border-t border-slate-800/70 pt-2">
            <div className="flex flex-wrap gap-0.5">
              {badgeItems.map(({ key, value }) => {
                const tone = toneForBadge(key, value)
                const label =
                  key === 'fusion_confidence' && value
                    ? `CONF ${(Number(value) <= 1 ? Number(value) * 100 : Number(value)).toFixed(0)}%`
                    : badgeValue(value)

                return (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${TONE_STYLES[tone]}`}
                  >
                    <span className={`h-1 w-1 rounded-full bg-current ${tone === 'slate' ? 'opacity-50' : 'opacity-80'}`} />
                    {label}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
