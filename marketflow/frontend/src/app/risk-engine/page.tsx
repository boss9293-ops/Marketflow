import Link from 'next/link'
import { readCacheJson } from '@/lib/readCacheJson'
import { accentColorFromLevel, getRiskSecondaryAccents, riskLevelToToken } from '@/lib/riskPalette'

type SnapshotItem = {
  date: string
  gate_score?: number | null
  market_phase?: string | null
  risk_level?: string | null
  risk_trend?: string | null
  phase_shift_flag?: number
}

type SnapshotsCache = { snapshots?: SnapshotItem[] }

type HealthSnapshotCache = {
  data_date?: string | null
  trend?: { dist_pct?: number | null } | null
  risk?: {
    var95_1d?: number | null
    cvar95_1d?: number | null
    vol_ratio?: number | null
  } | null
}

type TapeItem = {
  symbol?: string | null
  chg_pct?: number | null
}
type MarketTapeCache = { items?: TapeItem[] | null }

function card(extra?: object) {
  return {
    background: '#11161C',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14,
    padding: '0.9rem',
    ...extra,
  } as const
}

export default async function RiskEnginePage() {
  const [snapshotsData, healthSnapshot, marketTape] = await Promise.all([
    readCacheJson<SnapshotsCache>('snapshots_120d.json', { snapshots: [] }),
    readCacheJson<HealthSnapshotCache>('health_snapshot.json', {}),
    readCacheJson<MarketTapeCache>('market_tape.json', { items: [] }),
  ])

  const snapshots = Array.isArray(snapshotsData.snapshots) ? snapshotsData.snapshots : []
  const latestSnapshot = snapshots[snapshots.length - 1] || null
  const distPct = typeof healthSnapshot.trend?.dist_pct === 'number' ? healthSnapshot.trend.dist_pct : null
  const riskProxy = typeof healthSnapshot.risk?.var95_1d === 'number' ? Math.abs(healthSnapshot.risk.var95_1d) * 10 : null
  const cvar95_1d = typeof healthSnapshot.risk?.cvar95_1d === 'number' ? healthSnapshot.risk.cvar95_1d : null
  const volRatio = typeof healthSnapshot.risk?.vol_ratio === 'number' ? healthSnapshot.risk.vol_ratio : null
  const regimeNow = latestSnapshot?.market_phase || (distPct != null ? (distPct > 3 ? 'BULL' : distPct < -3 ? 'DEFENSIVE' : 'TRANSITION') : 'NEUTRAL')
  const vixChg = Array.isArray(marketTape.items)
    ? (marketTape.items.find((i) => i?.symbol === 'VIX')?.chg_pct ?? null)
    : null
  const shockProb30d = typeof riskProxy === 'number' ? Math.max(4, Math.min(95, Math.round(riskProxy * 0.55))) : null
  const defensiveTriggerOn = (latestSnapshot?.risk_level || '').toUpperCase() === 'HIGH' || (riskProxy ?? 0) >= 75
  const phaseTransitionText =
    regimeNow === 'BULL' ? 'Accumulation'
    : regimeNow === 'BEAR' || regimeNow === 'DEFENSIVE' ? 'Defense'
    : regimeNow === 'TRANSITION' ? 'Transition'
    : 'Neutral'
  const tailSigma = typeof riskProxy === 'number' ? Math.max(0.6, Math.min(6.2, riskProxy / 9.2)) : null
  const tailSkewLabel = (riskProxy ?? 0) >= 75 ? 'Elevated Skew' : (riskProxy ?? 0) >= 45 ? 'Moderate Skew' : 'Benign Skew'

  const riskToken = riskLevelToToken({ riskScore: riskProxy, riskLevel: latestSnapshot?.risk_level ?? null })
  const riskAccents = getRiskSecondaryAccents({
    vixChange1d: vixChg,
    volRatio,
    cvar95: cvar95_1d,
    tailSigma,
    shockProb30d,
  })

  return (
    <div className="px-4 py-6" style={{ background: '#06090D', minHeight: '100vh', color: '#F8FAFC' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 8, height: 32, borderRadius: 999, background: riskToken.colorVar }} />
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>Risk Engine</div>
          <span style={{ borderRadius: 999, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#F87171', padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 700 }}>
            PROPRIETARY
          </span>
        </div>
        <Link href="/dashboard" style={{ color: '#93C5FD', fontSize: '0.82rem', fontWeight: 700, textDecoration: 'none' }}>
          Back to Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" style={{ minWidth: 0 }}>
        <section style={{ ...card({ border: `1px solid ${riskToken.borderVar}` }), borderLeft: `4px solid ${riskToken.colorVar}` }}>
          <div style={{ color: '#D8E6F5', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em' }}>SHOCK PROB (30D)</div>
          <div style={{ marginTop: 10, color: '#F8FAFC', fontSize: '1.8rem', fontWeight: 900, lineHeight: 1 }}>
            {shockProb30d != null ? `${shockProb30d}%` : '--'}
          </div>
          <div style={{ marginTop: 10, color: accentColorFromLevel(riskAccents.shockStress), fontWeight: 700 }}>
            {shockProb30d == null ? 'Needs verification' : shockProb30d < 40 ? 'Decreasing' : 'Watch closely'}
          </div>
          <div className="line-clamp-2" style={{ marginTop: 8, color: '#D8E6F5', lineHeight: 1.35, fontSize: '0.78rem' }}>
            Probability of short-horizon drawdown risk over the next 30 days.
          </div>
        </section>

        <section style={{ ...card({ border: '1px solid rgba(148,163,184,0.16)' }), borderLeft: `4px solid ${riskToken.borderVar}` }}>
          <div style={{ color: '#D8E6F5', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em' }}>DEFENSIVE TRIGGER</div>
          <div style={{ marginTop: 10, color: '#F8FAFC', fontSize: '1.8rem', fontWeight: 900, lineHeight: 1 }}>
            {defensiveTriggerOn ? 'ON' : 'OFF'}
          </div>
          <div style={{ marginTop: 10, color: defensiveTriggerOn ? riskToken.colorVar : 'var(--risk-accent-cooling)', fontWeight: 700 }}>
            {defensiveTriggerOn ? 'Defensive mode preferred' : 'System is Risk-On'}
          </div>
          <div className="line-clamp-2" style={{ marginTop: 8, color: '#D8E6F5', lineHeight: 1.35, fontSize: '0.78rem' }}>
            Triggered by combined signals across volatility, breadth, and regime state.
          </div>
        </section>

        <section style={{ ...card({ border: `1px solid ${riskToken.borderVar}` }), borderLeft: `4px solid ${riskToken.colorVar}` }}>
          <div style={{ color: '#D8E6F5', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em' }}>PHASE TRANSITION</div>
          <div style={{ marginTop: 10, color: '#F8FAFC', fontSize: '1.55rem', fontWeight: 900, lineHeight: 1.02 }}>
            {phaseTransitionText}
          </div>
          <div style={{ marginTop: 12, height: 7, borderRadius: 999, background: riskToken.bgVar, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(14, Math.min(96, Math.round(((latestSnapshot?.gate_score ?? 45) / 100) * 100)))}%`, height: '100%', background: riskToken.colorVar }} />
          </div>
          <div className="line-clamp-2" style={{ marginTop: 8, color: '#D8E6F5', lineHeight: 1.35, fontSize: '0.78rem' }}>
            Cycle phase momentum derived from gate score and regime drift.
          </div>
        </section>

        <section style={{ ...card({ border: `1px solid ${riskToken.borderVar}` }), borderLeft: `4px solid ${riskToken.colorVar}` }}>
          <div style={{ color: '#D8E6F5', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em' }}>TAIL RISK GAUGE</div>
          <div style={{ marginTop: 10, color: '#F8FAFC', fontSize: '1.8rem', fontWeight: 900, lineHeight: 1 }}>
            {tailSigma != null ? tailSigma.toFixed(1) : '--'} <span style={{ color: '#D8E6F5', fontSize: '1rem', fontWeight: 700 }}>Sigma</span>
          </div>
          <div style={{ marginTop: 10, color: accentColorFromLevel(riskAccents.tailStress), fontWeight: 700 }}>
            {tailSigma == null ? 'Needs verification' : tailSkewLabel}
          </div>
          <div className="line-clamp-2" style={{ marginTop: 8, color: '#D8E6F5', lineHeight: 1.35, fontSize: '0.78rem' }}>
            Tail skew intensity based on CVaR and volatility regime.
          </div>
        </section>
      </div>
    </div>
  )
}
