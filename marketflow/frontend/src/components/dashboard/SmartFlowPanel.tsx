'use client'

import { useMemo, useState } from 'react'
import SmartMoneyView, { SmartMoneyCache, SmartMoneyItem } from '@/components/SmartMoneyView'
import BilLabel from '@/components/BilLabel'

type Props = {
  data: SmartMoneyCache
  prevLeadersCount?: number | null
}

const SCORE_LEADER = 80

function pct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '--'
  return `${v.toFixed(0)}%`
}

function sectorGroup(sector?: string | null) {
  const text = (sector || '').toLowerCase()
  const defensive = ['utilities', 'utility', 'staples', 'consumer staples', 'health', 'pharma', 'biotech']
  const cyc = ['discretionary', 'industrial', 'financial', 'semiconductor', 'tech', 'technology', 'information', 'communication', 'internet', 'software', 'hardware', 'bank', 'insurance', 'broker', 'capital', 'retail', 'transport', 'energy', 'materials']
  if (defensive.some((k) => text.includes(k))) return 'defensive'
  if (cyc.some((k) => text.includes(k))) return 'cyclical'
  return 'neutral'
}

function sectorTilt(rows: SmartMoneyItem[]) {
  let def = 0
  let cyc = 0
  for (const r of rows) {
    const g = sectorGroup(r.sector)
    if (g === 'defensive') def += 1
    if (g === 'cyclical') cyc += 1
  }
  if (def === cyc) return 'Neutral'
  return def > cyc ? 'Defensive' : 'Offensive'
}

function regimeFitFrom(regime: string) {
  if (regime === 'Expansion') return 'High'
  if (regime === 'Neutral') return 'Medium'
  if (regime === 'Contraction') return 'Low'
  return 'Very Low'
}

function volRiskFrom(shockProb: number | null, tailSigma: number | null) {
  if ((shockProb != null && shockProb > 0.2) || (tailSigma != null && tailSigma >= 2.5)) return 'High'
  if (tailSigma != null && tailSigma >= 2.0) return 'Medium'
  return 'Low'
}

function computeConcentration(rows: SmartMoneyItem[]) {
  if (!rows.length) return { label: 'Low', topSector: '-' }
  const counts = new Map<string, number>()
  for (const item of rows) {
    const key = item.sector || 'Unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let topSector = 'Unknown'
  let maxCount = 0
  counts.forEach((v, k) => {
    if (v > maxCount) {
      maxCount = v
      topSector = k
    }
  })
  const share = maxCount / Math.max(1, rows.length)
  const label = share >= 0.45 ? 'High' : share >= 0.3 ? 'Medium' : 'Low'
  return { label, topSector }
}

function interpretFlow({
  leadersCount,
  concentration,
  delta,
}: {
  leadersCount: number
  concentration: string
  delta: number | null
}) {
  if (leadersCount === 0) {
    return 'Flow 약함 → 구조 모멘텀 제한 / Flow weak → limited structural momentum.'
  }
  if (concentration === 'High' && (delta ?? 0) >= 4) {
    return 'Flow 집중 상승 → 테마 과열 가능성 / Concentration rising → potential theme overheating.'
  }
  if (leadersCount >= 25 && concentration !== 'High') {
    return 'Flow 확산 중이며 섹터 분산 양호 / Flow breadth expanding with diversified sectors.'
  }
  if (delta != null && delta <= -4) {
    return 'Flow 축소 → 구조 약화 / Flow contracting → structural weakening.'
  }
  if (delta != null && delta >= 4) {
    return 'Flow 확대 → 수급 확산 / Flow expanding → demand broadening.'
  }
  return 'Flow 혼조 → 선택적 확인 구간 / Mixed flow → selective confirmation zone.'
}

export default function SmartFlowPanel({ data, prevLeadersCount = null }: Props) {
  const [open, setOpen] = useState(false)

  const rows = useMemo(() => [...(data.top || []), ...(data.watch || [])], [data])
  const leaders = useMemo(() => rows.filter((r) => (r.score ?? 0) >= SCORE_LEADER), [rows])
  const flow = data.smart_flow
  const leadersCount = flow?.leaders80_count ?? leaders.length
  const rsLeaderCount = rows.filter((r) => (r.tags || []).includes('RS_LEADER')).length
  const rsLeaderRatio = flow?.rs_leader_ratio ?? (rows.length ? (rsLeaderCount / rows.length) * 100 : null)

  const leadersSorted = useMemo(
    () => [...leaders].sort((a, b) => Number((b as any).sm_final ?? b.score ?? 0) - Number((a as any).sm_final ?? a.score ?? 0)),
    [leaders],
  )
  const topLeaders = leadersSorted.slice(0, 20)
  const concentration = flow?.concentration_level
    ? { label: flow.concentration_level, topSector: topLeaders[0]?.sector || '-' }
    : computeConcentration(topLeaders)
  const tilt = sectorTilt(topLeaders)

  const delta = flow?.leaders80_delta_1d ?? (typeof prevLeadersCount === 'number' ? leadersCount - prevLeadersCount : null)
  const deltaLabel = delta == null ? '--' : `${delta >= 0 ? '+' : ''}${delta}`
  const acceleration = flow?.acceleration_state ?? (delta == null ? 'Flat' : delta >= 4 ? 'Expanding' : delta <= -4 ? 'Contracting' : 'Flat')
  const interpretation = interpretFlow({ leadersCount, concentration: concentration.label, delta })

  const regimeFit = regimeFitFrom(flow?.regime || 'Neutral')
  const volRisk = volRiskFrom(flow?.shock_prob_30d ?? null, flow?.tail_sigma ?? null)
  const regimeFitValue: string = String(regimeFit)
  const volRiskValue: string = String(volRisk)
  const environmentFit =
    regimeFitValue == 'Low' || regimeFitValue == 'Very Low' || volRiskValue == 'High'
      ? 'Low'
      : regimeFitValue == 'High' && volRiskValue != 'High'
      ? 'High'
      : 'Medium'

  return (
    <section
      style={{
        marginTop: 14,
        background: '#0B0F14',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: '0.8rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ color: '#F8FAFC' }}>
          <BilLabel ko="스마트 플로우" en="Smart Flow" variant="label" />
        </div>
        <div style={{ color: '#94A3B8', fontSize: '0.76rem' }}>Regime-Adjusted</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2" style={{ marginTop: 10 }}>
        <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.55rem 0.6rem', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ color: '#94A3B8', fontSize: '0.66rem', fontWeight: 700 }}>Flow Breadth</div>
          <div style={{ marginTop: 4, color: '#E2E8F0', fontSize: '0.88rem', fontWeight: 700 }}>Leaders (≥80): {leadersCount}</div>
          <div style={{ marginTop: 2, color: '#9CA3AF', fontSize: '0.74rem' }}>Δ Leaders: {deltaLabel}</div>
        </div>

        <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.55rem 0.6rem', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ color: '#94A3B8', fontSize: '0.66rem', fontWeight: 700 }}>Flow Concentration</div>
          <div style={{ marginTop: 4, color: '#E2E8F0', fontSize: '0.88rem', fontWeight: 700 }}>Sector Tilt: {tilt}</div>
          <div style={{ marginTop: 2, color: '#9CA3AF', fontSize: '0.74rem' }}>Concentration: {concentration.label}</div>
        </div>

        <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.55rem 0.6rem', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ color: '#94A3B8', fontSize: '0.66rem', fontWeight: 700 }}>Flow Alignment</div>
          <div style={{ marginTop: 4, color: '#E2E8F0', fontSize: '0.88rem', fontWeight: 700 }}>Environment Fit: {environmentFit}</div>
          <div style={{ marginTop: 2, color: '#9CA3AF', fontSize: '0.74rem' }}>Vol Risk: {volRisk} · Regime Fit: {regimeFit}</div>
        </div>
      </div>

      <div style={{ marginTop: 8, color: '#C7D2FE', fontSize: '0.78rem' }}>
        {interpretation}
      </div>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            border: '1px solid rgba(255,255,255,0.16)',
            background: 'rgba(255,255,255,0.04)',
            color: '#E2E8F0',
            borderRadius: 8,
            padding: '0.35rem 0.6rem',
            fontSize: '0.76rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          View Flow Detail
        </button>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '3.5vh 3vw',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1200px, 92vw)',
              maxHeight: '92vh',
              overflow: 'auto',
              background: '#0B0F14',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 14,
              boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.9rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ color: '#F8FAFC', fontWeight: 800 }}>Smart Flow Evidence</div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.04)',
                  color: '#E2E8F0',
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
            <SmartMoneyView data={data} mode="drilldown" />
          </div>
        </div>
      )}
    </section>
  )
}
