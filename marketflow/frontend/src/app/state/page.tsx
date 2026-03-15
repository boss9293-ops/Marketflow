import Link from 'next/link'
import { readCacheJson } from '@/lib/readCacheJson'
import { TrendingUp, Activity, AlertTriangle } from 'lucide-react'

type RiskV1Current = {
  date?: string
  score?: number
  level?: number
  level_label?: string
  event_type?: string
  exposure_pct?: number
  shock_p?: number
  components?: {
    trend?: number
    vol?: number
    dd?: number
  }
}

type RiskV1HistoryPoint = {
  date: string
  score: number
  level: number
  vol_pct?: number | null
  dd_pct?: number | null
  event_type?: string
}

type RiskV1Context = {
  final_risk?: string
  final_exposure?: number
  brief?: string
  spy?: { state?: string; score?: number; vs_ma200?: number | null }
  dia?: { state?: string; score?: number }
  rotation?: { state?: string; rs_20d?: number | null }
}
type RiskV1 = {
  current?: RiskV1Current & { context?: RiskV1Context }
  history?: RiskV1HistoryPoint[]
}

const LEVEL_COLORS: Record<number, string> = {
  0: '#4CAF50',
  1: '#4CAF50',
  2: '#FFC107',
  3: '#FF9800',
  4: '#F44336',
}
const FINAL_RISK_COLORS: Record<string, string> = {
  NORMAL: '#22c55e', WATCH: '#f59e0b', WARNING: '#f97316', DEFENSIVE: '#ef4444', SHOCK: '#b91c1c',
}

function levelColor(level: number | null | undefined): string {
  return LEVEL_COLORS[level ?? 2] || '#FFC107'
}

function formatNum(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toFixed(digits)
}

function dedupeHistory(history: RiskV1HistoryPoint[]): RiskV1HistoryPoint[] {
  const map = new Map<string, RiskV1HistoryPoint>()
  for (const h of history) map.set(h.date, h)
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function buildStepPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  const d: string[] = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    d.push(`L ${curr.x} ${prev.y}`)
    d.push(`L ${curr.x} ${curr.y}`)
  }
  return d.join(' ')
}

export default async function StatePage() {
  const risk = await readCacheJson<RiskV1>('risk_v1.json', {})
  const current = risk.current || {}
  const history = dedupeHistory(risk.history || [])
  const last20 = history.slice(-20)

  const level = current.level ?? 2
  const levelLabel = current.level_label || 'Warning'
  const score = current.score ?? null
  const exposure = current.exposure_pct ?? 50
  const environment = current.event_type || 'Normal'
  const trendScore = current.components?.trend ?? null
  const volScore = current.components?.vol ?? null
  const ddScore = current.components?.dd ?? null

  const trendLabel = trendScore != null && trendScore >= 25 ? 'Positive' : trendScore != null && trendScore >= 15 ? 'Neutral' : 'Weak'
  const volLabel = volScore != null && volScore >= 14 ? 'High' : volScore != null && volScore >= 8 ? 'Elevated' : 'Calm'
  const ddLabel = ddScore != null && ddScore >= 8 ? 'Elevated' : 'Contained'

  // Integrated final risk (MSS + SPY + DIA + QQQ/SPY rotation)
  const ctx = current.context ?? null
  const finalRisk = ctx?.final_risk ?? null
  const finalExposure = ctx?.final_exposure ?? exposure
  const finalColor = finalRisk ? (FINAL_RISK_COLORS[finalRisk] ?? '#9ca3af') : levelColor(level)

  const briefLines = [
    `The risk engine currently signals Level ${level} (${levelLabel}) with a score of ${formatNum(score, 1)} / 100.`,
    `Trend structure is ${trendLabel}, while volatility appears ${volLabel}.`,
    `Drawdown contribution remains ${ddLabel}, suggesting a ${level >= 3 ? 'defensive' : 'moderate'} posture.`,
    `Recommended exposure is around ${Math.round(exposure)}% under the current regime.`,
  ]

  const chartWidth = 640
  const chartHeight = 200
  const padding = { top: 16, right: 24, bottom: 28, left: 36 }
  const innerW = chartWidth - padding.left - padding.right
  const innerH = chartHeight - padding.top - padding.bottom

  const points = last20.map((d, i) => {
    const x = padding.left + (innerW * i) / Math.max(1, last20.length - 1)
    const y = padding.top + innerH - (innerH * (d.level ?? 0)) / 4
    return { x, y, level: d.level, date: d.date }
  })

  const stepPath = buildStepPath(points)
  const lastPoint = points[points.length - 1]

  return (
    <div className="bg-[#0b0f14] min-h-screen text-white">
      <div className="max-w-[1400px] mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold">Market State</h1>
            <p className="text-slate-400 mt-2 text-sm">Risk summary powered by the Risk Engine (v1)</p>
          </div>
          <Link
            href="/risk-v1"
            className="px-4 py-2 rounded-lg text-sm bg-[#11161c] border border-[#1c2430] hover:border-[#4CAF50] transition-colors"
          >
            View Full Risk Engine →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-[#11161c] rounded-2xl p-6" style={{ border: `1px solid ${finalColor}44`, borderLeft: `4px solid ${finalColor}` }}>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Final Market Risk</div>
            <div className="text-3xl font-bold" style={{ color: finalColor }}>
              {finalRisk ?? `Level ${level}`}
            </div>
            <div className="text-sm text-slate-400 mt-2">
              Nasdaq MSS: Level {level} ({levelLabel}) · Score {formatNum(score, 1)}
            </div>
            {ctx && (
              <div className="flex flex-wrap gap-2 mt-3">
                {[
                  { label: 'SPY', value: ctx.spy?.state ?? '--' },
                  { label: 'DIA', value: ctx.dia?.state ?? '--' },
                  { label: 'Rotation', value: ctx.rotation?.state ?? '--' },
                ].map(d => (
                  <span key={d.label} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: '#9ca3af' }}>
                    {d.label}: <span className="text-gray-200 font-semibold">{d.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#11161c] border border-[#1c2430] rounded-2xl p-6">
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Recommended Exposure</div>
            <div className="text-3xl font-bold text-white">{Math.round(finalExposure)}%</div>
            {ctx && finalExposure !== exposure && (
              <div className="text-xs text-slate-500 mt-1">Nasdaq-only: {Math.round(exposure)}%</div>
            )}
            <div className="mt-4">
              <div className="h-2 bg-[#1c2430] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, finalExposure))}%`, background: finalColor }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500 mt-2">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          <div className="bg-[#11161c] border border-[#1c2430] rounded-2xl p-6">
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Market Context</div>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-slate-400" /> Environment: {environment}</div>
              <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-slate-400" /> Trend: {trendLabel}</div>
              <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" /> Volatility: {volLabel}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
          <div className="bg-[#11161c] border border-[#1c2430] rounded-2xl p-6">
            <div className="text-sm font-semibold mb-4">Risk Level (20 Days)</div>
            <svg width="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
              <rect x="0" y="0" width={chartWidth} height={chartHeight} fill="#0f1319" rx="12" />
              <rect x={padding.left} y={padding.top + innerH * 0.75} width={innerW} height={innerH * 0.25} fill="#1d3a28" opacity="0.55" />
              <rect x={padding.left} y={padding.top + innerH * 0.5} width={innerW} height={innerH * 0.25} fill="#3a3318" opacity="0.55" />
              <rect x={padding.left} y={padding.top + innerH * 0.25} width={innerW} height={innerH * 0.25} fill="#3b2415" opacity="0.55" />
              <rect x={padding.left} y={padding.top} width={innerW} height={innerH * 0.25} fill="#3b1518" opacity="0.55" />

              {[0, 1, 2, 3, 4].map((lvl) => {
                const y = padding.top + innerH - (innerH * lvl) / 4
                return (
                  <g key={lvl}>
                    <line x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} stroke="#1c2430" strokeDasharray="3 3" />
                    <text x={10} y={y + 4} fill="#94a3b8" fontSize="11">{lvl}</text>
                  </g>
                )
              })}

              {stepPath && (
                <path d={stepPath} fill="none" stroke={levelColor(level)} strokeWidth={2.5} />
              )}

              {lastPoint && (
                <g>
                  <circle cx={lastPoint.x} cy={lastPoint.y} r={5} fill={levelColor(level)} stroke="#0b0f14" strokeWidth={2} />
                  <text x={lastPoint.x + 8} y={lastPoint.y - 6} fill="#e2e8f0" fontSize="11">Today</text>
                </g>
              )}
            </svg>
          </div>

          <div className="bg-[#11161c] border border-[#1c2430] rounded-2xl p-6 flex flex-col">
            <div className="text-sm font-semibold mb-4">Risk Briefing</div>
            <div className="text-sm text-slate-300 leading-relaxed space-y-3">
              {briefLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <Link
              href="/risk-v1"
              className="mt-6 inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"
            >
              View Full Risk Engine →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}