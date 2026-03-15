import Link from 'next/link'
import fs from 'fs/promises'
import path from 'path'
import BilLabel from '@/components/BilLabel'
import SignalsGrid from '@/components/SignalsGrid'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'
import { computeStructuralHealthScore, scoreToBucket, type RawInputs } from '@/lib/marketHealth'

type VcpSignalSummary = {
  timestamp?: string | null
  total_scanned?: number | null
  signals?: Array<{ stage?: string | null }> | null
}

type HealthSnapshot = {
  trend?: { dist_pct?: number | null } | null
  risk?: { vol_ratio?: number | null } | null
} | null

type TapeCache = { items?: Array<{ symbol?: string | null; last?: number | null; chg_pct?: number | null }> | null } | null
type HistoryCache = { snapshots?: Array<{ gate_score?: number | null; risk_trend?: string | null }> | null } | null

async function readVcpOutputSummary(): Promise<VcpSignalSummary | null> {
  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', 'vcp_signals.json'),
    path.resolve(process.cwd(), 'backend', 'output', 'vcp_signals.json'),
  ]
  for (const c of candidates) {
    try {
      return JSON.parse(await fs.readFile(c, 'utf-8')) as VcpSignalSummary
    } catch {
      // try next
    }
  }
  return null
}

export default async function OpportunitySignalsPage() {
  const [vcp, health, tape, snapshots120] = await Promise.all([
    readVcpOutputSummary(),
    readCacheJsonOrNull<HealthSnapshot>('health_snapshot.json'),
    readCacheJsonOrNull<TapeCache>('market_tape.json'),
    readCacheJsonOrNull<HistoryCache>('snapshots_120d.json'),
  ])
  const vixItem = (Array.isArray(tape?.items) ? tape!.items! : []).find((x) => x?.symbol === 'VIX')
  const latest = (Array.isArray(snapshots120?.snapshots) ? snapshots120!.snapshots! : []).slice(-1)[0]
  const gateScore = typeof latest?.gate_score === 'number' ? latest.gate_score : undefined
  const rawInputs: RawInputs = {
    price_vs_sma200: typeof health?.trend?.dist_pct === 'number' ? health.trend.dist_pct : undefined,
    vix_level: typeof vixItem?.last === 'number' ? vixItem.last : undefined,
    vix_change_5d: typeof vixItem?.chg_pct === 'number' ? vixItem.chg_pct * 5 : undefined,
    pct_above_sma200: gateScore,
    advance_decline: typeof gateScore === 'number' ? Number(((gateScore - 50) / 25).toFixed(2)) : undefined,
    financial_conditions: latest?.risk_trend === 'Deteriorating' ? 0.8 : latest?.risk_trend === 'Improving' ? -0.2 : undefined,
  }
  const shs = computeStructuralHealthScore(rawInputs, { lookbackSeries: {} })
  const shsBucket = scoreToBucket(shs.total_final)
  const totalFound = Array.isArray(vcp?.signals) ? vcp!.signals!.length : 0
  return (
    <div className="px-3 py-4 sm:px-4 sm:py-5 lg:px-6 lg:pb-12" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <header
        style={{
          background: '#070B10',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
          padding: '0.95rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ color: '#F8FAFC', fontSize: 'clamp(1.55rem,3vw,2rem)', fontWeight: 800, lineHeight: 1 }}>
            Opportunity Signals
          </div>
          <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
            <BilLabel ko="변동성 수축 패턴(VCP) 기회 신호 레이어" en="Volatility Contraction Pattern (VCP)" variant="micro" />
          </div>
          <div style={{ color: '#D7E2EF', marginTop: 6, fontSize: '0.95rem', fontWeight: 700 }}>
            <BilLabel ko="패턴 스캐너" en="Pattern Scanner" variant="micro" />
          </div>
          <div style={{ color: '#9FB0C6', marginTop: 4, fontSize: '0.86rem' }}>
            <BilLabel ko="신호는 기회 탐색용이며, 예측이 아닙니다." en="Signals are opportunities, not predictions." variant="micro" />
          </div>
          <div style={{ color: '#AEBFD4', marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem' }}>
              Scanned: <b style={{ color: '#F8FAFC' }}>{vcp?.total_scanned ?? '—'}</b> stocks
            </span>
            <span style={{ fontSize: '0.9rem' }}>
              Found: <b style={{ color: '#7DD3FC' }}>{totalFound}</b> patterns
            </span>
            <span style={{ fontSize: '0.9rem' }}>
              Updated: <b style={{ color: '#E5EEF9' }}>{vcp?.timestamp ? new Date(vcp.timestamp).toLocaleString() : '—'}</b>
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {Number.isFinite(shs.total_final) && (
            <span
              style={{
                borderRadius: 999,
                border: `1px solid ${shsBucket.color}55`,
                background: `${shsBucket.color}14`,
                color: shsBucket.color,
                padding: '0.35rem 0.65rem',
                fontWeight: 800,
                fontSize: '0.86rem',
              }}
              title="Market context only"
            >
              Market Context: {shsBucket.labelEn}
            </span>
          )}
          <Link href="/health" style={{ textDecoration: 'none', borderRadius: 10, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: '#D7E2EF', padding: '0.45rem 0.75rem', fontWeight: 700, fontSize: '0.9rem' }}>
            ← Market Health
          </Link>
        </div>
      </header>

      <section
        style={{
          background: '#070B10',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
          padding: '1rem',
        }}
      >
        <SignalsGrid />
      </section>
    </div>
  )
}
