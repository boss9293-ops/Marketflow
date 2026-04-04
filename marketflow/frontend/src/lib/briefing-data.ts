import fs from 'fs/promises'
import path from 'path'

import type { TopBriefingSnapshot } from '@/components/briefing/TopBriefingSection'

export type LightThemeOutput = {
  theme_title?: string | null
  theme_subtitle?: string | null
  theme_tags?: string[] | null
}

export type MoversCategoryKey = 'gainers' | 'most_active' | 'unusual_volume'

export type MoversRecord = {
  category?: MoversCategoryKey | string | null
  rank?: number | null
  symbol?: string | null
  name?: string | null
  price?: number | null
  change_pct?: number | null
  volume?: number | null
  as_of?: string | null
  fetched_at?: string | null
  raw_symbol?: string | null
  exchange?: string | null
  source?: string | null
  validation_status?: string | null
  validation_issues?: string[] | null
  [key: string]: unknown
}

export type MoversSnapshot = {
  generated_at?: string | null
  as_of?: string | null
  snapshot_type?: string | null
  record_count?: number | null
  categories?: Partial<Record<MoversCategoryKey, MoversRecord[] | null>> & Record<string, MoversRecord[] | null | undefined>
  records?: MoversRecord[] | null
  summary?: Record<string, unknown> | null
}

export type StructuredBriefingOutput = {
  date?: string | null
  market_regime?: string | null
  cross_asset_signal?: string | null
  risk_quality?: string | null
  historical_context?: {
    short_term_status?: string | null
    historical_view?: string | null
    nasdaq_3d_cum_pct?: number | null
    nasdaq_5d_cum_pct?: number | null
    xlk_3d_cum_pct?: number | null
    nvda_3d_cum_pct?: number | null
    nasdaq_streak_up_days?: number | null
    xlk_streak_up_days?: number | null
    nvda_streak_up_days?: number | null
    [key: string]: unknown
  } | null
  headline?: string | null
  one_line_takeaway?: string | null
  summary_statement?: string | null
  today_context?: string | null
  interpretation?: string | null
  risk_note?: string | null
  briefing_sections?: {
    headline?: string | null
    summary?: string | null
    drivers?: string[] | null
    cross_asset_view?: string | null
    historical_view?: string | null
    risk_note?: string | null
    check_points?: string[] | null
    [key: string]: unknown
  } | null
  key_drivers?: string[] | null
  market_levels?: {
    sp500_level?: number | null
    nasdaq_level?: number | null
    us10y_level?: number | null
    oil_level?: number | null
    gold_level?: number | null
    vix_level?: number | null
    [key: string]: number | null | undefined
  } | null
  market_snapshot?: {
    sp500_pct?: number | null
    nasdaq_pct?: number | null
    xlk_pct?: number | null
    tech_proxy_pct?: number | null
    tech_proxy_symbol?: string | null
    nvda_pct?: number | null
    us10y?: number | null
    oil?: number | null
    sp500_level?: number | null
    nasdaq_level?: number | null
    us10y_level?: number | null
    oil_level?: number | null
    gold_level?: number | null
    vix_level?: number | null
    [key: string]: number | string | null | undefined
  } | null
  data_source_meta?: {
    snapshot_source?: string | null
    as_of?: string | null
    fetched_at?: string | null
    tech_proxy_symbol?: string | null
    historical_context_mode?: string | null
    [key: string]: unknown
  } | null
}

export type FusionBriefingOutput = {
  date?: string | null
  fusion_summary?: string | null
  fusion_drivers?: string[] | null
  fusion_interpretation?: string | null
  fusion_confidence?: number | null
  fusion_state?: {
    market_regime?: string | null
    cross_asset_signal?: string | null
    risk_quality?: string | null
    short_term_status?: string | null
    [key: string]: unknown
  } | null
  news_overlay?: {
    selected_themes?: unknown[] | null
    theme_tags?: string[] | null
    theme_valid_count?: number | null
    confidence_score?: number | null
    data_confident?: boolean | null
    quality_flags?: {
      data_confident?: boolean | null
      [key: string]: unknown
    } | null
    [key: string]: unknown
  } | null
  source_meta?: {
    structured_briefing_loaded?: boolean | null
    news_payload_loaded?: boolean | null
    market_source_meta?: Record<string, unknown> | null
    news_source_meta?: Record<string, unknown> | null
    mode?: string | null
    [key: string]: unknown
  } | null
}

export type BriefingSourceMeta = {
  structured_loaded: boolean
  fusion_loaded: boolean
  light_theme_loaded: boolean
  snapshot_source: string | null
  as_of: string | null
  fetched_at: string | null
  mode: string
  age_minutes: number | null
  stale: boolean
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths))
}

export function resolveBackendOutputDir(...segments: string[]): string {
  return path.resolve(process.cwd(), '..', 'backend', 'output', ...segments)
}

function readRecordString(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getOutputRoots(): string[] {
  return uniquePaths([
    resolveBackendOutputDir(),
    path.resolve(process.cwd(), 'backend', 'output'),
    path.resolve(process.cwd(), '..', 'output'),
    path.resolve(process.cwd(), 'output'),
  ])
}

function getCandidateDirectories(subdir: string): string[] {
  return uniquePaths(
    getOutputRoots().flatMap((root) => [
      path.join(root, subdir),
      root,
    ])
  )
}

async function readLatestJsonByPrefix<T>(directories: string[], prefix: string): Promise<T | null> {
  const matches: Array<{ filePath: string; mtimeMs: number }> = []

  for (const dir of directories) {
    try {
      const entries = await fs.readdir(dir)
      for (const entry of entries) {
        if (!entry.startsWith(prefix) || !entry.endsWith('.json')) continue
        const filePath = path.join(dir, entry)
        const stat = await fs.stat(filePath)
        matches.push({ filePath, mtimeMs: stat.mtimeMs })
      }
    } catch {
      // ignore missing directories
    }
  }

  if (matches.length === 0) return null

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs)

  try {
    const raw = await fs.readFile(matches[0].filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function loadLatestStructuredBriefing(): Promise<StructuredBriefingOutput | null> {
  return readLatestJsonByPrefix<StructuredBriefingOutput>(getCandidateDirectories('structured_briefing'), 'structured_briefing_')
}

export async function loadLatestFusionBriefing(): Promise<FusionBriefingOutput | null> {
  return readLatestJsonByPrefix<FusionBriefingOutput>(getCandidateDirectories('fusion'), 'fusion_briefing_')
}

export async function loadLatestLightTheme(): Promise<LightThemeOutput | null> {
  return readLatestJsonByPrefix<LightThemeOutput>(getCandidateDirectories('light_theme'), 'light_theme_')
}

export async function loadLatestMoversSnapshot(): Promise<MoversSnapshot | null> {
  return readLatestJsonByPrefix<MoversSnapshot>(getCandidateDirectories('cache'), 'movers_snapshot_')
}

export function humanizeIdentifier(value?: string | null): string {
  return (value ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatPrice(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  if (Math.abs(value) >= 10000) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  if (Math.abs(value) >= 100) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPercent(value?: number | null, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

export function formatVolume(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return Math.round(value).toLocaleString()
}

export function formatConfidence(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  const pct = value <= 1 ? value * 100 : value
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`
}

export function formatTimestampUtc(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

export function getSnapshotAgeMinutes(value?: string | null): number | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return (Date.now() - date.getTime()) / 60000
}

export function isSnapshotStale(value?: string | null, maxAgeMinutes = 60): boolean {
  const age = getSnapshotAgeMinutes(value)
  if (age === null) return true
  return age > maxAgeMinutes
}

function normalizeDateKey(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

export function buildBriefingSourceMeta(
  structuredBriefing: StructuredBriefingOutput | null,
  fusionBriefing: FusionBriefingOutput | null,
  lightTheme: LightThemeOutput | null,
  maxAgeMinutes = 60
): BriefingSourceMeta {
  const marketSourceMeta = fusionBriefing?.source_meta?.market_source_meta ?? null
  const newsSourceMeta = fusionBriefing?.source_meta?.news_source_meta ?? null
  const fetchedAt =
    structuredBriefing?.data_source_meta?.fetched_at ||
    readRecordString(marketSourceMeta, 'fetched_at') ||
    readRecordString(marketSourceMeta, 'generated_at') ||
    readRecordString(newsSourceMeta, 'fetched_at') ||
    null

  const asOf = structuredBriefing?.data_source_meta?.as_of || structuredBriefing?.date || fusionBriefing?.date || null

  const mode = fusionBriefing?.source_meta?.mode || (fusionBriefing ? 'market_plus_news' : 'market_only_fallback')
  const ageMinutes = getSnapshotAgeMinutes(fetchedAt)
  const stale = isSnapshotStale(fetchedAt, maxAgeMinutes)

  return {
    structured_loaded: Boolean(structuredBriefing),
    fusion_loaded: Boolean(fusionBriefing),
    light_theme_loaded: Boolean(lightTheme),
    snapshot_source: structuredBriefing?.data_source_meta?.snapshot_source || null,
    as_of: asOf,
    fetched_at: fetchedAt,
    mode,
    age_minutes: ageMinutes,
    stale,
  }
}

function deriveHeroSubtitle(
  structuredBriefing: StructuredBriefingOutput | null,
  fusionBriefing: FusionBriefingOutput | null,
  lightTheme: LightThemeOutput | null
): string | null {
  const lightSubtitle = lightTheme?.theme_subtitle?.trim()
  if (lightSubtitle) return lightSubtitle

  const regime = fusionBriefing?.fusion_state?.market_regime || structuredBriefing?.market_regime
  const signal = fusionBriefing?.fusion_state?.cross_asset_signal || structuredBriefing?.cross_asset_signal
  const shortTerm =
    fusionBriefing?.fusion_state?.short_term_status ||
    structuredBriefing?.historical_context?.short_term_status ||
    null
  const quality = fusionBriefing?.fusion_state?.risk_quality || structuredBriefing?.risk_quality || null

  const parts = [regime, signal, shortTerm, quality]
    .map((value) => humanizeIdentifier(value))
    .filter(Boolean)
    .slice(0, 3)

  return parts.length > 0 ? parts.join(' | ') : 'Market structure + news fusion summary'
}

function deriveHeroTitle(
  structuredBriefing: StructuredBriefingOutput | null,
  lightTheme: LightThemeOutput | null
): string {
  const lightTitle = lightTheme?.theme_title?.trim()
  if (lightTitle) return lightTitle

  const structuredTitle = structuredBriefing?.headline?.trim() || structuredBriefing?.briefing_sections?.headline?.trim()
  if (structuredTitle) return structuredTitle

  return structuredBriefing
    ? 'Daily Briefing'
    : 'No structured briefing data available'
}

function deriveHeroSummary(
  structuredBriefing: StructuredBriefingOutput | null,
  fusionBriefing: FusionBriefingOutput | null
): string {
  const fusionSummary = fusionBriefing?.fusion_summary?.trim()
  if (fusionSummary) return fusionSummary

  const structuredFallbacks = [
    structuredBriefing?.one_line_takeaway?.trim(),
    structuredBriefing?.summary_statement?.trim(),
    structuredBriefing?.briefing_sections?.summary?.trim(),
    structuredBriefing?.interpretation?.trim(),
  ]

  for (const candidate of structuredFallbacks) {
    if (candidate) return candidate
  }

  return structuredBriefing
    ? 'Latest structured briefing is available, but no fusion summary was produced.'
    : 'No structured briefing data available yet.'
}

export function buildTopBriefingSnapshot(
  structuredBriefing: StructuredBriefingOutput | null,
  fusionBriefing: FusionBriefingOutput | null,
  lightTheme: LightThemeOutput | null
): TopBriefingSnapshot {
  const title = deriveHeroTitle(structuredBriefing, lightTheme)
  const subtitle = deriveHeroSubtitle(structuredBriefing, fusionBriefing, lightTheme)
  const summary = deriveHeroSummary(structuredBriefing, fusionBriefing)

  const marketRegime = fusionBriefing?.fusion_state?.market_regime || structuredBriefing?.market_regime || null
  const crossAssetSignal = fusionBriefing?.fusion_state?.cross_asset_signal || structuredBriefing?.cross_asset_signal || null
  const shortTermStatus =
    fusionBriefing?.fusion_state?.short_term_status ||
    structuredBriefing?.historical_context?.short_term_status ||
    null
  const riskQuality = fusionBriefing?.fusion_state?.risk_quality || structuredBriefing?.risk_quality || null
  const fusionConfidence = fusionBriefing?.fusion_confidence ?? fusionBriefing?.news_overlay?.confidence_score ?? null

  return {
    theme_title: title,
    theme_subtitle: subtitle,
    fusion_summary: summary,
    state_badges: {
      market_regime: marketRegime || undefined,
      cross_asset_signal: crossAssetSignal || undefined,
      short_term_status: shortTermStatus || undefined,
      risk_quality: riskQuality || undefined,
      fusion_confidence: typeof fusionConfidence === 'number' ? fusionConfidence : undefined,
    },
  }
}

const MOVERS_CATEGORY_LABELS: Record<MoversCategoryKey, string> = {
  gainers: 'Top Gainers',
  most_active: 'Most Active',
  unusual_volume: 'Unusual Volume',
}

export function getMoverCategoryLabel(category: MoversCategoryKey): string {
  return MOVERS_CATEGORY_LABELS[category]
}

export function getTopMovers(
  movers: MoversSnapshot | null,
  category: MoversCategoryKey,
  limit = 5
): MoversRecord[] {
  const rows = Array.isArray(movers?.categories?.[category]) ? movers?.categories?.[category] ?? [] : []

  return rows
    .filter((row): row is MoversRecord => Boolean(row && typeof row.symbol === 'string' && row.symbol.trim()))
    .slice()
    .sort((a, b) => {
      const rankA = typeof a.rank === 'number' ? a.rank : Number.POSITIVE_INFINITY
      const rankB = typeof b.rank === 'number' ? b.rank : Number.POSITIVE_INFINITY
      if (rankA !== rankB) return rankA - rankB

      const changeA = typeof a.change_pct === 'number' ? Math.abs(a.change_pct) : -1
      const changeB = typeof b.change_pct === 'number' ? Math.abs(b.change_pct) : -1
      if (changeA !== changeB) return changeB - changeA

      const volumeA = typeof a.volume === 'number' ? a.volume : -1
      const volumeB = typeof b.volume === 'number' ? b.volume : -1
      return volumeB - volumeA
    })
    .slice(0, limit)
}
