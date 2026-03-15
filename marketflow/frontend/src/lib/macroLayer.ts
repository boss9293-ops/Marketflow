export type MacroPressureBucket = 'Calm' | 'Mixed' | 'Pressure' | 'Extreme'

export type MacroPressureInput = {
  macroPressureScore?: number | null
  lpiState?: 'Loose' | 'Neutral' | 'Tight' | null
  vriState?: 'Compressed' | 'Normal' | 'Expanding' | null
  rpiState?: 'Accommodative' | 'Neutral' | 'Restrictive' | null
  breadthWeak?: boolean | null
}

export type MacroPressureResult = {
  score: number
  bucket: MacroPressureBucket
  pressureFlags: {
    liquidityVolExtreme: boolean
    restrictiveBreadthExtreme: boolean
  }
  exposureUpperModifierPct: number
  tone: 'normal' | 'speed_control' | 'defensive_tilt'
  badges: string[]
}

export type MacroMetricStatus = 'GOOD' | 'WATCH' | 'RISK' | 'NA'
export type MacroSeriesCadence = 'daily' | 'weekly'

export type MacroDetailRow = {
  key: string
  label: string
  valueText: string
  status: MacroMetricStatus
  referenceText: string
  whyText: string
  cadence: MacroSeriesCadence
  cadenceTag: 'Daily' | 'Weekly'
  lastUpdated?: string | null
  stale: boolean
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function macroPressureBucket(score: number): MacroPressureBucket {
  if (score >= 85) return 'Extreme'
  if (score >= 70) return 'Pressure'
  if (score >= 40) return 'Mixed'
  return 'Calm'
}

export function resolveMacroPressure(input: MacroPressureInput): MacroPressureResult {
  const score = clamp(Math.round(typeof input.macroPressureScore === 'number' ? input.macroPressureScore : 50), 0, 100)
  const bucket = macroPressureBucket(score)
  const liquidityVolExtreme = input.lpiState === 'Tight' && input.vriState === 'Expanding'
  const restrictiveBreadthExtreme = input.rpiState === 'Restrictive' && !!input.breadthWeak

  let exposureUpperModifierPct = 0
  let tone: MacroPressureResult['tone'] = 'normal'

  if (bucket === 'Pressure') {
    exposureUpperModifierPct = -10
    tone = 'speed_control'
  } else if (bucket === 'Extreme') {
    exposureUpperModifierPct = -15
    tone = 'defensive_tilt'
  }

  if (liquidityVolExtreme) {
    exposureUpperModifierPct = Math.min(exposureUpperModifierPct, -10)
    if (tone === 'normal') tone = 'speed_control'
  }
  if (restrictiveBreadthExtreme) {
    exposureUpperModifierPct = Math.min(exposureUpperModifierPct, -15)
    tone = 'defensive_tilt'
  }

  const badges: string[] = [`Macro ${bucket}`]
  if (liquidityVolExtreme) badges.push('LPI Tight + VRI Expanding')
  if (restrictiveBreadthExtreme) badges.push('RPI Restrictive + Breadth Weak')

  return {
    score,
    bucket,
    pressureFlags: { liquidityVolExtreme, restrictiveBreadthExtreme },
    exposureUpperModifierPct,
    tone,
    badges,
  }
}

export function adjustExposureBandUpper(
  exposureBand: string | null | undefined,
  upperModifierPct: number
): { original: string | null; adjusted: string | null } {
  if (!exposureBand) return { original: null, adjusted: null }
  const m = String(exposureBand).match(/(\d{1,3})\s*[^\d]\s*(\d{1,3})/)
  if (!m) return { original: exposureBand, adjusted: exposureBand }
  const low = Number(m[1])
  const high = Number(m[2])
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { original: exposureBand, adjusted: exposureBand }
  const adjHigh = clamp(high + upperModifierPct, 0, 100)
  const adj = `${low}-${adjHigh}%`
  return { original: exposureBand, adjusted: adj }
}

export function classifySeriesStale(params: {
  series: string
  lastUpdated?: string | null
  now?: Date
}): { stale: boolean; cadenceTag: 'Daily' | 'Weekly'; cadence: MacroSeriesCadence } {
  const series = (params.series || '').toUpperCase()
  const cadence: MacroSeriesCadence = series === 'WALCL' ? 'weekly' : 'daily'
  const cadenceTag = cadence === 'weekly' ? 'Weekly' : 'Daily'
  const daysThreshold = series === 'WALCL' ? 10 : 2

  if (!params.lastUpdated) return { stale: false, cadenceTag, cadence }
  const dt = new Date(params.lastUpdated)
  const now = params.now || new Date()
  if (Number.isNaN(dt.getTime())) return { stale: false, cadenceTag, cadence }
  const days = (now.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24)
  return { stale: days > daysThreshold, cadenceTag, cadence }
}

function numText(value: number | null | undefined, digits = 2, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—'
}

export function formatMacroMetricRow(args: {
  key: 'VIX' | 'EFFR_1M_CHANGE_BP' | 'WALCL' | 'RRP'
  value?: number | null
  lastUpdated?: string | null
}): MacroDetailRow {
  const k = args.key
  const s = classifySeriesStale({ series: k, lastUpdated: args.lastUpdated })
  if (args.value == null || !Number.isFinite(args.value)) {
    return {
      key: k,
      label: k === 'EFFR_1M_CHANGE_BP' ? 'EFFR 1M change' : k,
      valueText: '—',
      status: 'NA',
      referenceText: k === 'VIX' ? 'Normal 12-20 / Watch 20-25 / Risk 25+' : 'Reference bands available when data arrives',
      whyText: 'Data unavailable; using partial indicators.',
      cadence: s.cadence,
      cadenceTag: s.cadenceTag,
      lastUpdated: args.lastUpdated || null,
      stale: s.stale,
    }
  }

  if (k === 'VIX') {
    const v = args.value
    const status: MacroMetricStatus = v < 20 ? 'GOOD' : v < 25 ? 'WATCH' : 'RISK'
    return {
      key: k,
      label: 'VIX',
      valueText: numText(v, 2),
      status,
      referenceText: 'Normal 12-20 / Watch 20-25 / Risk 25+',
      whyText: 'Volatility regime context signal; use as pressure indicator, not a predictor.',
      cadence: s.cadence,
      cadenceTag: s.cadenceTag,
      lastUpdated: args.lastUpdated || null,
      stale: s.stale,
    }
  }

  if (k === 'EFFR_1M_CHANGE_BP') {
    const v = args.value
    const abs = Math.abs(v)
    const status: MacroMetricStatus = abs < 20 ? 'GOOD' : abs <= 50 ? 'WATCH' : 'RISK'
    return {
      key: k,
      label: 'EFFR 1M change',
      valueText: numText(v, 0, 'bp'),
      status,
      referenceText: 'Normal <20bp / Watch 20-50bp / Risk >50bp',
      whyText: 'Rate shock proxy for funding conditions; context signal only.',
      cadence: s.cadence,
      cadenceTag: s.cadenceTag,
      lastUpdated: args.lastUpdated || null,
      stale: s.stale,
    }
  }

  if (k === 'WALCL') {
    return {
      key: k,
      label: 'WALCL',
      valueText: numText(args.value, 2),
      status: 'WATCH',
      referenceText: 'Weekly trend context (use trend, not single print)',
      whyText: 'Liquidity cushion/stress proxy; interpretation is regime-dependent.',
      cadence: s.cadence,
      cadenceTag: s.cadenceTag,
      lastUpdated: args.lastUpdated || null,
      stale: s.stale,
    }
  }

  return {
    key: k,
    label: 'RRP',
    valueText: numText(args.value, 2),
    status: 'WATCH',
    referenceText: 'Context threshold set by regime / trend of usage',
    whyText: 'Reserve drain/parking context signal; combine with rates and breadth.',
    cadence: s.cadence,
    cadenceTag: s.cadenceTag,
    lastUpdated: args.lastUpdated || null,
    stale: s.stale,
  }
}

export function getLpiSafeCopy(state: 'Loose' | 'Neutral' | 'Tight' | null | undefined) {
  if (state === 'Tight') {
    return {
      label: 'Tight',
      text: 'Liquidity cushion/stress proxy is tight; treat as a context signal, not a crash predictor.',
      tooltip: 'Interpretation is regime-dependent; use as pressure indicator only.',
    }
  }
  if (state === 'Loose') {
    return {
      label: 'Loose',
      text: 'Liquidity cushion/stress proxy is loose; pressure appears lighter in the current context.',
      tooltip: 'Interpretation is regime-dependent; use as pressure indicator only.',
    }
  }
  return {
    label: 'Neutral',
    text: 'Liquidity cushion/stress proxy is neutral; combine with volatility and breadth before changing pace.',
    tooltip: 'Interpretation is regime-dependent; use as pressure indicator only.',
  }
}

export function resolveCrossAssetMvpState(input?: { aligned?: boolean | null; defensive?: boolean | null } | null) {
  if (input?.defensive) return { state: 'Defensive' as const, copy: 'Signals skew defensive; treat risk assets conservatively.' }
  if (input?.aligned) return { state: 'Aligned' as const, copy: 'Signals are aligned; use as confirmation, not a trigger by itself.' }
  return { state: 'Mixed' as const, copy: 'Signals are not aligned; treat as confirmation zone.' }
}

