import { rollingPercentile, type Point } from '@/lib/macro/normalize'

export type LpiBand = 'Easy' | 'Neutral' | 'Tight'
export type RpiBand = 'Easing' | 'Stable' | 'Restrictive'
export type VriBand = 'Compressed' | 'Normal' | 'Expanding'

export type ComputeInput = {
  walcl8wChange: Point[]
  rrp20dChange: Point[]
  m2YoY: Point[]
  effrLevel: Point[]
  effr1mChangeBp: Point[]
  dfii10Level?: Point[]
  dgs10Level?: Point[]
  cpiYoY?: Point[]
  vixLevel: Point[]
  vix5dChange: Point[]
  volRatio?: Point[]
  lookbackDays?: number
}

export type ComputeOutput = {
  LPI: number | null
  RPI: number | null
  VRI: number | null
  MPS: number | null
  LPI_band: LpiBand | 'NA'
  RPI_band: RpiBand | 'NA'
  VRI_band: VriBand | 'NA'
  proxy_used_flag: boolean
}

function clamp100(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  return Math.max(0, Math.min(100, v))
}

function latestValue(series: Point[]): number | null {
  if (!Array.isArray(series) || series.length === 0) return null
  const last = series[series.length - 1]
  if (typeof last?.value === 'number' && Number.isFinite(last.value)) return last.value
  return null
}

function invertSeries(series: Point[]): Point[] {
  return series.map((p) => ({
    date: p.date,
    value: typeof p.value === 'number' && Number.isFinite(p.value) ? -p.value : null,
  }))
}

function absSeries(series: Point[]): Point[] {
  return series.map((p) => ({
    date: p.date,
    value: typeof p.value === 'number' && Number.isFinite(p.value) ? Math.abs(p.value) : null,
  }))
}

function combineRealRate(params: { dfii10Level?: Point[]; dgs10Level?: Point[]; cpiYoY?: Point[] }): { series: Point[]; proxy_used_flag: boolean } {
  const dfii = params.dfii10Level || []
  const hasDfii = dfii.some((p) => typeof p.value === 'number' && Number.isFinite(p.value))
  if (hasDfii) return { series: dfii, proxy_used_flag: false }

  const dgs = params.dgs10Level || []
  const cpi = params.cpiYoY || []
  const n = Math.min(dgs.length, cpi.length)
  const out: Point[] = []
  for (let i = 0; i < n; i += 1) {
    const dv = dgs[i]?.value
    const cv = cpi[i]?.value
    out.push({
      date: dgs[i]?.date || cpi[i]?.date || '',
      value: (typeof dv === 'number' && Number.isFinite(dv) && typeof cv === 'number' && Number.isFinite(cv)) ? dv - cv : null,
    })
  }
  return { series: out, proxy_used_flag: true }
}

function lpiBand(v: number | null): LpiBand | 'NA' {
  if (v == null) return 'NA'
  if (v < 33) return 'Easy'
  if (v <= 66) return 'Neutral'
  return 'Tight'
}

function rpiBand(v: number | null): RpiBand | 'NA' {
  if (v == null) return 'NA'
  if (v < 33) return 'Easing'
  if (v <= 66) return 'Stable'
  return 'Restrictive'
}

function vriBand(v: number | null): VriBand | 'NA' {
  if (v == null) return 'NA'
  if (v < 33) return 'Compressed'
  if (v <= 66) return 'Normal'
  return 'Expanding'
}

export function computeMacroCore(input: ComputeInput): ComputeOutput {
  const lb = input.lookbackDays ?? 756

  // LPI
  const pWalcl = rollingPercentile(invertSeries(input.walcl8wChange), lb)
  const pRrp = rollingPercentile(absSeries(input.rrp20dChange), lb) // shock logic
  const pM2 = rollingPercentile(invertSeries(input.m2YoY), lb)
  const LPI = clamp100(
    pWalcl == null || pRrp == null || pM2 == null
      ? null
      : 0.45 * pWalcl + 0.35 * pRrp + 0.20 * pM2
  )

  // RPI
  const rr = combineRealRate({ dfii10Level: input.dfii10Level, dgs10Level: input.dgs10Level, cpiYoY: input.cpiYoY })
  const r1 = rollingPercentile(input.effrLevel, lb)
  const r2 = rollingPercentile(input.effr1mChangeBp, lb)
  const r3 = rollingPercentile(rr.series, lb)
  const RPI = clamp100(
    r1 == null || r2 == null || r3 == null
      ? null
      : 0.30 * r1 + 0.20 * r2 + 0.50 * r3
  )

  // VRI
  const v1 = rollingPercentile(input.vixLevel, lb)
  const v2 = rollingPercentile(input.vix5dChange, lb)
  const v3 = input.volRatio ? rollingPercentile(input.volRatio, lb) : null
  const v3w = v3 == null ? 0 : v3
  const v3weight = v3 == null ? 0 : 0.15
  const VRI = clamp100(
    v1 == null || v2 == null
      ? null
      : (0.55 * v1) + (0.30 * v2) + (v3weight * v3w)
  )

  // MPS (XCONF excluded by design)
  const MPS = clamp100(
    LPI == null || RPI == null || VRI == null
      ? null
      : 0.40 * LPI + 0.35 * RPI + 0.25 * VRI
  )

  return {
    LPI,
    RPI,
    VRI,
    MPS,
    LPI_band: lpiBand(LPI),
    RPI_band: rpiBand(RPI),
    VRI_band: vriBand(VRI),
    proxy_used_flag: rr.proxy_used_flag,
  }
}

// Lightweight converter for backend snapshot blocks (already-computed values)
export function computeFromSnapshotBlocks(blocks: {
  LPI?: { value?: number | null; status?: string | null }
  RPI?: { value?: number | null; status?: string | null }
  VRI?: { value?: number | null; status?: string | null }
  MPS?: { value?: number | null }
  series?: Record<string, { proxy_used_flag?: boolean }>
}): ComputeOutput {
  const LPI = clamp100(typeof blocks.LPI?.value === 'number' ? blocks.LPI.value : null)
  const RPI = clamp100(typeof blocks.RPI?.value === 'number' ? blocks.RPI.value : null)
  const VRI = clamp100(typeof blocks.VRI?.value === 'number' ? blocks.VRI.value : null)
  const MPS = clamp100(typeof blocks.MPS?.value === 'number' ? blocks.MPS.value : null)
  const proxy = Boolean(blocks.series?.DFII10?.proxy_used_flag || blocks.series?.CPI?.proxy_used_flag)
  return {
    LPI,
    RPI,
    VRI,
    MPS,
    LPI_band: lpiBand(LPI),
    RPI_band: rpiBand(RPI),
    VRI_band: vriBand(VRI),
    proxy_used_flag: proxy,
  }
}
