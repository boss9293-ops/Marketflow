import { cookies } from 'next/headers'
import Link from 'next/link'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'
import { generateMarketNarration, type NarrationOutput } from '@/lib/generateMarketNarration'
import MacroBadgeStrip from '@/components/MacroBadgeStrip'
import { CONTENT_LANG_COOKIE, UI_LANG_COOKIE, normalizeUiLang } from '@/lib/uiLang'

// ── Types ────────────────────────────────────────────────────────────────────

type SubScore = {
  score: number
  max: number
  label_ko: string
  label_en: string
  confidence: number
}

type MarketHealth = {
  generated_at?: string
  data_date?: string
  total: number
  label_ko: string
  label_en: string
  color: string
  scores: {
    trend: SubScore
    volatility: SubScore
    breadth: SubScore
    liquidity: SubScore
  }
  narrative: { ko: string; en: string }
  positioning: {
    equity_tilt: string
    risk_posture: string
    exposure_band: string
    rebalance_bias: string
  }
}

// ── SVG ScoreRing ────────────────────────────────────────────────────────────

function ScoreRing({
  score, max = 100, color, size = 'lg',
}: {
  score: number | null; max?: number; color: string; size?: 'lg' | 'sm'
}) {
  const isLg = size === 'lg'
  const dim = isLg ? 120 : 72
  const r = isLg ? 50 : 28
  const sw = isLg ? 9 : 6
  const cx = dim / 2
  const CIRC = 2 * Math.PI * r
  const pct = score != null ? Math.max(0, Math.min(1, score / max)) : 0
  const fill = pct * CIRC

  return (
    <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="flex-shrink-0">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#2a2a2a" strokeWidth={sw} />
      {fill > 0 && (
        <circle
          cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${fill} ${CIRC}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      )}
      <text
        x={cx} y={isLg ? cx - 6 : cx} textAnchor="middle" fill="white"
        fontSize={isLg ? 26 : 15} fontWeight="bold" dominantBaseline="middle">
        {score ?? '--'}
      </text>
      {isLg && (
        <text x={cx} y={cx + 18} textAnchor="middle" fill="#6b7280" fontSize={10}>
          / {max}
        </text>
      )}
    </svg>
  )
}

function ConfBadge({ pct }: { pct: number }) {
  const color = pct >= 85 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#6b7280'
  return (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded"
      style={{ color, background: `${color}18` }}>
      {pct}%
    </span>
  )
}

// ── Metadata ─────────────────────────────────────────────────────────────────

const SCORE_EN: Record<string, string> = {
  trend:      'Trend Alignment',
  volatility: 'Volatility Stability',
  breadth:    'Market Breadth',
  liquidity:  'Liquidity State',
}

const SCORE_KO: Record<string, string> = {
  trend:      '추세 정렬도',
  volatility: '변동성 안정성',
  breadth:    '시장 확산 강도',
  liquidity:  '유동성 상태',
}

const NARRATION_KEY: Record<string, keyof NarrationOutput> = {
  trend:      'trendNarration',
  volatility: 'volatilityNarration',
  breadth:    'breadthNarration',
  liquidity:  'liquidityNarration',
}

const formatTimestamp = (value?: string | null) => {
  if (!value) return '--'
  return value.length > 16 ? value.slice(0, 16).replace('T', ' ') : value.replace('T', ' ')
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function HealthPage() {
  const uiLang = normalizeUiLang(cookies().get(UI_LANG_COOKIE)?.value)
  const rawContentLang = cookies().get(CONTENT_LANG_COOKIE)?.value
  const contentLang = rawContentLang === 'ko' || rawContentLang === 'en' ? rawContentLang : uiLang
  const mh = await readCacheJsonOrNull<MarketHealth>('market_health.json')
  const hasScoreShape =
    !!mh &&
    typeof mh.total === 'number' &&
    !!mh.scores &&
    typeof mh.scores.trend?.score === 'number' &&
    typeof mh.scores.volatility?.score === 'number' &&
    typeof mh.scores.breadth?.score === 'number' &&
    typeof mh.scores.liquidity?.score === 'number'
  const hasPositioningShape =
    !!mh &&
    !!mh.positioning &&
    typeof mh.positioning.equity_tilt === 'string' &&
    typeof mh.positioning.risk_posture === 'string' &&
    typeof mh.positioning.exposure_band === 'string' &&
    typeof mh.positioning.rebalance_bias === 'string'

  // Generate narration (async; falls back gracefully if API unavailable)
  let narration: NarrationOutput | null = null
  if (hasScoreShape && mh) {
    try {
      narration = await generateMarketNarration({
        totalScore:  mh.total,
        trend:       { score: mh.scores.trend.score,      label: mh.scores.trend.label_en,      conf: mh.scores.trend.confidence },
        volatility:  { score: mh.scores.volatility.score, label: mh.scores.volatility.label_en, conf: mh.scores.volatility.confidence },
        breadth:     { score: mh.scores.breadth.score,    label: mh.scores.breadth.label_en,    conf: mh.scores.breadth.confidence },
        liquidity:   { score: mh.scores.liquidity.score,  label: mh.scores.liquidity.label_en,  conf: mh.scores.liquidity.confidence },
      }, { outputLang: contentLang })
    } catch {
      narration = null
    }
  }

  const scoreColor = mh
    ? mh.total >= 75 ? '#22c55e'
      : mh.total >= 55 ? '#84cc16'
      : mh.total >= 40 ? '#f59e0b'
      : '#ef4444'
    : '#6b7280'

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <nav className="flex items-center gap-2 mb-2 text-xs font-mono text-capital-gray-400">
              <span>MarketFlow</span>
              <span>/</span>
              <span className="text-white">Market Health</span>
            </nav>
            <h1 className="text-2xl font-bold text-white">
              시장 구조 건강도
              <span className="ml-2 text-base font-normal text-capital-gray-400">Market Structural Health</span>
            </h1>
            {mh?.data_date && (
              <p className="text-xs text-capital-gray-400 mt-1">
                Data: {mh.data_date}
                {mh.generated_at && (
                  <> &nbsp;&middot;&nbsp; Generated: {mh.generated_at.slice(0, 16).replace('T', ' ')}</>
                )}
              </p>
            )}
            <p className="text-xs text-capital-gray-400 mt-1">
              Last updated: {formatTimestamp(mh?.generated_at ?? mh?.data_date ?? null)}
            </p>
          </div>
          <div className="flex gap-3 items-start flex-wrap justify-end">
            <MacroBadgeStrip />
            <Link href="/state"
              className="px-3 py-1.5 text-xs font-medium rounded border border-capital-gray-700 text-capital-gray-400 hover:border-capital-lime hover:text-capital-lime transition-colors">
              Overview
            </Link>
            <Link href="/briefing"
              className="px-3 py-1.5 text-xs font-medium rounded border border-capital-gray-700 text-capital-gray-400 hover:border-capital-lime hover:text-capital-lime transition-colors">
              Daily Briefing
            </Link>
          </div>
        </div>

        {hasScoreShape && hasPositioningShape && mh && narration ? (
          <>
            {/* ── Total Score Hero Card ── */}
            <div className="bg-capital-gray-800 border border-capital-gray-700 rounded-2xl p-6 hover:border-capital-lime transition-colors duration-300 animate-slide-up">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                <ScoreRing score={mh.total} max={100} color={scoreColor} size="lg" />
                <div className="flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-3 mb-2">
                    <span className="text-xs font-mono text-capital-gray-400 uppercase tracking-wider">
                      {narration.hero}
                    </span>
                  </div>
                  <div className="flex items-center justify-center sm:justify-start gap-3 mb-3">
                    <span className="text-3xl font-bold" style={{ color: scoreColor }}>
                      {mh.label_ko}
                    </span>
                    <span className="px-2 py-0.5 rounded text-sm font-medium bg-capital-gray-700 text-capital-gray-400">
                      {mh.label_en} · {mh.total}/100
                    </span>
                  </div>
                  <p className="text-sm text-white leading-relaxed">{narration.totalNarration}</p>
                </div>
              </div>
            </div>

            {/* ── 4 Sub-score Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(['trend', 'volatility', 'breadth', 'liquidity'] as const).map((key, i) => {
                const s = mh.scores[key]
                const pct = s.score / s.max
                const c = pct >= 0.8 ? '#22c55e' : pct >= 0.6 ? '#84cc16' : pct >= 0.4 ? '#f59e0b' : '#ef4444'
                const narText = narration[NARRATION_KEY[key]]
                return (
                  <div key={key}
                    className="bg-capital-gray-800 border border-capital-gray-700 rounded-xl p-4 hover:border-capital-lime transition-colors duration-300 animate-slide-up flex flex-col"
                    style={{ animationDelay: `${(i + 1) * 80}ms` }}>
                    {/* Label */}
                    <p className="text-xs text-capital-gray-400 uppercase tracking-wider mb-3">
                      {SCORE_EN[key]} <span className="normal-case text-capital-gray-400">/ {SCORE_KO[key]}</span>
                    </p>
                    {/* Ring + state */}
                    <div className="flex items-center gap-3 mb-3">
                      <ScoreRing score={s.score} max={s.max} color={c} size="sm" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold" style={{ color: c }}>{s.label_en}</div>
                        <div className="text-xs text-capital-gray-400">{s.label_ko}</div>
                      </div>
                    </div>
                    {/* Confidence + progress */}
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-capital-gray-400">Confidence</span>
                      <ConfBadge pct={s.confidence} />
                    </div>
                    <div className="h-1 bg-capital-gray-700 rounded-full overflow-hidden mb-4">
                      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: c }} />
                    </div>
                    {/* Narration at bottom */}
                    <p className="text-xs text-capital-gray-300 leading-relaxed mt-auto">
                      {narText}
                    </p>
                  </div>
                )
              })}
            </div>

            {/* ── Positioning Guide ── */}
            <div className="bg-capital-gray-800 border border-capital-gray-700 rounded-2xl p-6 animate-slide-up" style={{ animationDelay: '400ms' }}>
              <p className="text-xs uppercase tracking-wider text-capital-gray-400 mb-4">
                포지셔닝 가이드 · Positioning Guide
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                {[
                  { label: 'Equity Tilt',    labelKo: '주식 비중',    value: mh.positioning.equity_tilt },
                  { label: 'Risk Posture',   labelKo: '리스크 자세',  value: mh.positioning.risk_posture },
                  { label: 'Exposure Band',  labelKo: '노이즌 범위', value: mh.positioning.exposure_band },
                  { label: 'Rebalance Bias', labelKo: '리밸런싱',    value: mh.positioning.rebalance_bias },
                ].map(({ label, labelKo, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-xs text-capital-gray-400 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-xs text-capital-gray-400 mb-2">{labelKo}</p>
                    <p className="text-lg font-bold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Closing Advice Blockquote ── */}
            <blockquote className="border-l-4 border-capital-lime bg-capital-gray-800 rounded-r-2xl px-6 py-5 animate-slide-up" style={{ animationDelay: '500ms' }}>
              <p className="text-sm text-white leading-relaxed">{narration.closingAdvice}</p>
              <footer className="mt-2 text-xs text-capital-gray-400">
                MarketFlow AI · Market Health Advisory
              </footer>
            </blockquote>
          </>
        ) : (
          <div className="bg-capital-gray-800 border border-capital-gray-700 rounded-2xl p-12 text-center">
            <p className="text-capital-gray-400 text-sm mb-2">
              시장 건강도 캐시가 없거나 형식이 맞지 않습니다.
            </p>
            <p className="text-capital-gray-400 text-xs">
              캐시 재생성 후 새로고침하세요. (시장 건강도 스키마 확인 필요)
            </p>
            <p className="text-capital-gray-400 text-xs mt-2">
              Run{' '}
              <code className="text-capital-lime font-mono bg-capital-gray-700 px-1.5 py-0.5 rounded">
                build_market_health.py
              </code>{' '}
              to generate <code className="font-mono text-capital-gray-400">market_health.json</code>.
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
