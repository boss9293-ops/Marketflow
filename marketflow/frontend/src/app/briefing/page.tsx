import MarketTape from '@/components/MarketTape'
import { readCacheJson } from '@/lib/readCacheJson'
import DataPlaceholder from '@/components/DataPlaceholder'
import GeminiBriefingPanel from '@/components/briefing/GeminiBriefingPanel'

type StatePill = {
  value?: string | null
  label?: string | null
  color?: string | null
  detail?: string | null
}

type MarketState = {
  data_date?: string | null
  phase?: StatePill | null
  gate?: (StatePill & { avg10d?: number | null; delta5d?: number | null }) | null
  risk?: (StatePill & { vol_pct?: number | null; var95?: number | null }) | null
  trend?: (StatePill & { pct_from_sma200?: number | null; qqq_close?: number | null; data_date?: string | null }) | null
}

type HealthSnapshot = {
  breadth_greed?: { label?: string | null; greed_proxy?: number | null } | null
}

type BriefingBullet = {
  label?: string | null
  text?: string | null
  evidence?: string[]
}

type DailyBriefing = {
  data_date?: string | null
  headline?: string | null
  bullets?: BriefingBullet[]
  stance?: { label?: string | null; action?: string | null; exposure_band?: string | null; why?: string | null }
}

const MISSING_BRIEFING = {
  reason: 'daily briefing unavailable',
  cacheFile: 'cache/daily_briefing.json',
  script: 'python backend/scripts/build_daily_briefing.py',
}

const MISSING_STATE = {
  reason: 'market state unavailable',
  cacheFile: 'cache/market_state.json',
  script: 'python backend/scripts/build_market_state.py',
}

const MISSING_HEALTH = {
  reason: 'health snapshot unavailable',
  cacheFile: 'cache/health_snapshot.json',
  script: 'python backend/scripts/build_health_snapshot.py',
}

function pill(label: string, value?: React.ReactNode, color?: string | null, placeholder?: React.ReactNode) {
  const c = color || '#6b7280'
  return (
    <div key={label} style={{
      background: `${c}12`,
      border: `1px solid ${c}44`,
      borderRadius: 8,
      padding: '0.45rem 0.75rem',
      minWidth: 90,
    }}>
      <div style={{ color: '#6b7280', fontSize: '0.58rem', marginBottom: 2, fontWeight: 600, letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ color: c, fontWeight: 800, fontSize: '0.9rem', lineHeight: 1 }}>{value || placeholder || <DataPlaceholder {...MISSING_BRIEFING} />}</div>
    </div>
  )
}

function evidenceChip(text: string | undefined, idx: number) {
  return (
    <span key={`${text}-${idx}`} style={{
      fontSize: '0.62rem',
      color: '#9ca3af',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 999,
      padding: '2px 8px',
    }}>
      {text || <DataPlaceholder {...MISSING_BRIEFING} />}
    </span>
  )
}

function pickText(value: any): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const ko = value?.ko
    const en = value?.en
    if (typeof ko === 'string' || typeof ko === 'number') return String(ko)
    if (typeof en === 'string' || typeof en === 'number') return String(en)
  }
  return null
}

function pickBullets(value: any): BriefingBullet[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const ko = value?.ko
    const en = value?.en
    if (Array.isArray(ko)) return ko
    if (Array.isArray(en)) return en
  }
  return []
}

export default async function BriefingPage() {
  const [briefing, ms, health] = await Promise.all([
    readCacheJson<DailyBriefing>('daily_briefing.json', { bullets: [] }),
    readCacheJson<MarketState>('market_state.json', {}),
    readCacheJson<HealthSnapshot>('health_snapshot.json', {}),
  ])

  const bullets = pickBullets(briefing.bullets)
  const stance = briefing.stance || {}
  const greedLabel = pickText(health.breadth_greed?.label) || null
  const greedVal = typeof health.breadth_greed?.greed_proxy === 'number'
    ? `${health.breadth_greed?.greed_proxy?.toFixed(0)}`
    : null
  const asofDay = pickText(briefing.data_date) || ms.data_date || null

  return (
    <div style={{ padding: '1.6rem 1.8rem 2.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
          Daily <span style={{ color: '#00D9FF' }}>Briefing</span>
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.35rem', fontSize: '0.82rem' }}>
          Trust-first, cache-driven summary
        </p>
      </div>

      {/* Top banner: Market Tape + System State Bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <MarketTape />
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
          background: 'linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: '0.6rem 1rem',
        }}>
          <span style={{ fontSize: '0.68rem', color: '#4b5563', letterSpacing: '0.1em', marginRight: 4 }}>STATUS</span>
          {pill('PHASE', ms.phase?.label, ms.phase?.color)}
          {pill('GATE', ms.gate?.label, ms.gate?.color)}
          {pill('RISK', ms.risk?.label, ms.risk?.color)}
          {pill('TREND', ms.trend?.label, ms.trend?.color)}
          <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#374151' }}>
            {pickText(briefing.data_date) || ms.data_date || <DataPlaceholder {...MISSING_BRIEFING} />}
          </span>
        </div>
      </div>

      {/* Briefing card */}
      <section style={{
        background: 'linear-gradient(145deg, #17181c 0%, #141518 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: '1.1rem 1.25rem',
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '1rem',
      }}>
        <div>
          <div style={{ color: '#6b7280', fontSize: '0.68rem', letterSpacing: '0.1em' }}>TODAY</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#e5e7eb', marginTop: 6 }}>
            {pickText(briefing.headline) || <DataPlaceholder {...MISSING_BRIEFING} />}
          </div>
          <GeminiBriefingPanel asofDay={asofDay} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {bullets.length ? bullets.map((b, idx) => (
              <div key={`${b.label}-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: '0.72rem', color: '#93c5fd', fontWeight: 700, letterSpacing: '0.08em' }}>
                  {pickText(b.label) || <DataPlaceholder {...MISSING_BRIEFING} />}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#d1d5db' }}>{pickText(b.text) || <DataPlaceholder {...MISSING_BRIEFING} />}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(b.evidence || []).slice(0, 3).map(evidenceChip)}
                </div>
              </div>
            )) : (
              <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                <DataPlaceholder {...MISSING_BRIEFING} />
              </div>
            )}
          </div>
        </div>
        <div style={{
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          paddingLeft: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
        }}>
          <div style={{ color: '#6b7280', fontSize: '0.68rem', letterSpacing: '0.1em' }}>STANCE</div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#e5e7eb' }}>
            {pickText(stance.label) || <DataPlaceholder {...MISSING_BRIEFING} />}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
            Action: <span style={{ color: '#e5e7eb' }}>{pickText(stance.action) || <DataPlaceholder {...MISSING_BRIEFING} />}</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
            Exposure: <span style={{ color: '#e5e7eb' }}>{pickText(stance.exposure_band) || <DataPlaceholder {...MISSING_BRIEFING} />}</span>
          </div>
          <div style={{ marginTop: 'auto', fontSize: '0.72rem', color: '#9ca3af', lineHeight: 1.35 }}>
            {pickText(stance.why) || <DataPlaceholder {...MISSING_BRIEFING} />}
          </div>
        </div>
      </section>

      {/* Evidence chips row */}
      <section style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: '0.75rem 1rem',
      }}>
        {pill('PHASE', ms.phase?.label, ms.phase?.color, <DataPlaceholder {...MISSING_STATE} />)}
        {pill('GATE', ms.gate?.label, ms.gate?.color, <DataPlaceholder {...MISSING_STATE} />)}
        {pill('RISK', ms.risk?.label, ms.risk?.color, <DataPlaceholder {...MISSING_STATE} />)}
        {pill('TREND', ms.trend?.label, ms.trend?.color, <DataPlaceholder {...MISSING_STATE} />)}
        {pill('BREADTH', greedLabel, '#22c55e', <DataPlaceholder {...MISSING_HEALTH} />)}
        {pill('GREED', greedVal, '#f59e0b', <DataPlaceholder {...MISSING_HEALTH} />)}
      </section>
    </div>
  )
}
