import type { FusionBriefingOutput, StructuredBriefingOutput } from '@/lib/briefing-data'
import {
  humanizeIdentifier,
} from '@/lib/briefing-data'

type Props = {
  structuredBriefing?: StructuredBriefingOutput | null
  fusionBriefing?: FusionBriefingOutput | null
}

function cleanText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstNonEmpty(values: Array<string | undefined | null>, fallback: string): string {
  for (const value of values) {
    const cleaned = cleanText(value)
    if (cleaned) return cleaned
  }
  return fallback
}

function sectionLabel(title: string, subtitle?: string) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-cyan-300">
          {title}
        </span>
      </div>
      {subtitle && <div className="mt-1 text-[11px] text-slate-500">{subtitle}</div>}
    </div>
  )
}

function buildDrivers(structuredBriefing?: StructuredBriefingOutput | null, fusionBriefing?: FusionBriefingOutput | null): string[] {
  const candidates = [
    ...(Array.isArray(fusionBriefing?.fusion_drivers) ? fusionBriefing.fusion_drivers : []),
    ...(Array.isArray(structuredBriefing?.key_drivers) ? structuredBriefing.key_drivers : []),
    ...(Array.isArray(structuredBriefing?.briefing_sections?.drivers) ? structuredBriefing.briefing_sections.drivers : []),
  ]

  const normalized = candidates
    .map((item) => cleanText(item))
    .filter(Boolean)

  return normalized.length > 0
    ? Array.from(new Set(normalized)).slice(0, 3)
    : [
        'No driver list is available yet.',
        'The page will continue to render using the latest structured briefing fallback.',
      ]
}

function buildStructureView(structuredBriefing?: StructuredBriefingOutput | null, fusionBriefing?: FusionBriefingOutput | null): string {
  return firstNonEmpty(
    [
      fusionBriefing?.fusion_interpretation,
      structuredBriefing?.interpretation,
      structuredBriefing?.briefing_sections?.cross_asset_view,
    ],
    'No structure view is available yet.'
  )
}

function buildHistoricalView(structuredBriefing?: StructuredBriefingOutput | null): string {
  return firstNonEmpty(
    [
      structuredBriefing?.historical_context?.historical_view,
      structuredBriefing?.briefing_sections?.historical_view,
    ],
    '최근 추세 맥락 데이터가 제한적입니다.'
  )
}

function buildRiskNote(structuredBriefing?: StructuredBriefingOutput | null, fusionBriefing?: FusionBriefingOutput | null): string {
  return firstNonEmpty(
    [
      structuredBriefing?.risk_note,
      structuredBriefing?.briefing_sections?.risk_note,
      fusionBriefing?.fusion_interpretation,
    ],
    'No risk note is available yet.'
  )
}

function buildCheckpoints(structuredBriefing?: StructuredBriefingOutput | null): string[] {
  const checkpoints = structuredBriefing?.briefing_sections?.check_points ?? []
  const normalized = checkpoints
    .map((item) => cleanText(item))
    .filter(Boolean)

  return normalized.length > 0
    ? normalized.slice(0, 3)
    : ['No checkpoints were provided in the latest structured briefing.']
}

export default function StructuredBriefingPanel({ structuredBriefing, fusionBriefing }: Props) {
  const drivers = buildDrivers(structuredBriefing, fusionBriefing)
  const structureView = buildStructureView(structuredBriefing, fusionBriefing)
  const historicalView = buildHistoricalView(structuredBriefing)
  const riskNote = buildRiskNote(structuredBriefing, fusionBriefing)
  const checkpoints = buildCheckpoints(structuredBriefing)
  const shortTermStatus = cleanText(
    fusionBriefing?.fusion_state?.short_term_status || structuredBriefing?.historical_context?.short_term_status
  )
  const marketRegime = cleanText(fusionBriefing?.fusion_state?.market_regime || structuredBriefing?.market_regime)
  const crossAssetSignal = cleanText(
    fusionBriefing?.fusion_state?.cross_asset_signal || structuredBriefing?.cross_asset_signal
  )
  const riskQuality = cleanText(fusionBriefing?.fusion_state?.risk_quality || structuredBriefing?.risk_quality)

  return (
    <section className="overflow-hidden rounded-[2px] border border-slate-800/75 bg-[#05070a]">
      <div className="border-b border-slate-800/75 px-4 py-3">
        {sectionLabel('Structured Briefing', 'Latest market structure and fusion overlay')}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {marketRegime && <span className="rounded-[2px] border border-slate-800/80 px-2 py-0.5">{humanizeIdentifier(marketRegime)}</span>}
          {crossAssetSignal && <span className="rounded-[2px] border border-slate-800/80 px-2 py-0.5">{humanizeIdentifier(crossAssetSignal)}</span>}
          {shortTermStatus && <span className="rounded-[2px] border border-slate-800/80 px-2 py-0.5">{humanizeIdentifier(shortTermStatus)}</span>}
          {riskQuality && <span className="rounded-[2px] border border-slate-800/80 px-2 py-0.5">{humanizeIdentifier(riskQuality)}</span>}
        </div>
      </div>

      <div className="divide-y divide-slate-800/70">
        <div className="px-4 py-4">
          {sectionLabel('Core Narrative', 'Primary drivers from the latest fusion layer')}
          <ol className="mt-3 space-y-2">
            {drivers.map((driver, index) => (
              <li
                key={`${index}-${driver}`}
                className="flex items-start gap-3 rounded-[2px] border border-slate-800/70 bg-white/[0.015] px-3 py-2"
              >
                <span className="mt-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-cyan-300">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm leading-6 text-slate-200/90">{driver}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-4 py-4">
          {sectionLabel('Structure View', 'Deterministic interpretation from the structured briefing')}
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200/90">
            {structureView}
          </p>
        </div>

        <div className="px-4 py-4">
          {sectionLabel('Historical Context', 'Recent trend context and short-term status')}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {shortTermStatus ? (
              <span className="rounded-[2px] border border-cyan-400/20 bg-cyan-400/5 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                {shortTermStatus}
              </span>
            ) : null}
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200/85">
            {historicalView}
          </p>
        </div>

        <div className="px-4 py-4">
          {sectionLabel('Risk Block', 'Risk note and near-term checkpoints')}
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200/90">
            {riskNote}
          </p>
          <ul className="mt-3 space-y-2">
            {checkpoints.map((checkpoint) => (
              <li
                key={checkpoint}
                className="flex items-start gap-3 rounded-[2px] border border-slate-800/70 bg-white/[0.015] px-3 py-2"
              >
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-300/90" />
                <span className="text-sm leading-6 text-slate-200/88">{checkpoint}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
