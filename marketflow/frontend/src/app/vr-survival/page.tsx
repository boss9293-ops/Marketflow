import { readFileSync } from 'fs'
import { join } from 'path'
import type { CSSProperties } from 'react'
import VRSurvival, {
  type Tab,
  VRSurvivalData,
} from '@/components/crash/vr/VRSurvival'
import VRRiskTracksCard           from '@/components/vr/VRRiskTracksCard'

type RiskV1CurrentSnapshot = {
  score: number | null
  scoreName: string | null
  scoreZone: string | null
  level: number | null
  levelLabel: string | null
  eventType: string | null
  finalRisk: string | null
  finalExposure: number | null
  brief: string | null
  date: string | null
}

function readRiskV1Current(): RiskV1CurrentSnapshot {
  try {
    const base = join(process.cwd(), '..', 'backend', 'output')
    const raw = readFileSync(join(base, 'risk_v1.json'), 'utf-8')
    const data = JSON.parse(raw)
    const current = data?.current ?? {}
    const context = current?.context ?? {}
    return {
      score: current?.score ?? null,
      scoreName: current?.score_name ?? null,
      scoreZone: current?.score_zone ?? null,
      level: current?.level ?? null,
      levelLabel: current?.level_label ?? null,
      eventType: current?.event_type ?? null,
      finalRisk: context?.final_risk ?? null,
      finalExposure: context?.final_exposure ?? null,
      brief: context?.brief ?? null,
      date: current?.date ?? null,
    }
  } catch {
    return {
      score: null,
      scoreName: null,
      scoreZone: null,
      level: null,
      levelLabel: null,
      eventType: null,
      finalRisk: null,
      finalExposure: null,
      brief: null,
      date: null,
    }
  }
}

function readOutputJson<T>(filename: string): T | null {
  try {
    const base = join(process.cwd(), '..', 'backend', 'output')
    const raw = readFileSync(join(base, filename), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}


function toSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const NAV_ITEMS = [
  { href: '/risk-v1', label: 'Standard (QQQ)', accent: '#f59e0b', border: 'rgba(245,158,11,0.26)', bg: 'rgba(245,158,11,0.08)' },
  { href: '/backtest', label: 'Backtests', accent: '#38bdf8', border: 'rgba(56,189,248,0.26)', bg: 'rgba(56,189,248,0.08)' },
  { href: '/crash', label: 'Crash Hub', accent: '#fb7185', border: 'rgba(251,113,133,0.26)', bg: 'rgba(251,113,133,0.08)' },
  { href: '/dashboard', label: 'Dashboard', accent: '#22c55e', border: 'rgba(34,197,94,0.26)', bg: 'rgba(34,197,94,0.08)' },
] as const

const ROLE_SPLIT_COPY =
  'Standard는 위험을 감지하고, VR은 그 상황에서 어떤 대응 전략이 유효했는지를 보여줍니다.'

const NON_SIGNAL_COPY =
  '이 엔진은 실시간 매수·매도 신호를 제공하지 않습니다. 시장 대응 방법을 이해하기 위한 참고 도구입니다.'

export default async function VRSurvivalPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const raw = readOutputJson<VRSurvivalData>('vr_survival.json')
  const riskV1 = readRiskV1Current()
  const requestedTab = toSingleValue(searchParams?.tab)
  const requestedEvent = toSingleValue(searchParams?.event)
  const VALID_TABS: Tab[] = ['Overview', 'Backtest', 'Playback']
  const initialTab: Tab = (requestedTab && VALID_TABS.includes(requestedTab as Tab)) ? (requestedTab as Tab) : 'Overview'
  const initialPlaybackEventId =
    requestedEvent && /^\d{4}-\d{2}$/.test(requestedEvent) ? requestedEvent : undefined
  const simEventId = toSingleValue(searchParams?.sim_event)
  const simStart = toSingleValue(searchParams?.sim_start)
  const simCapital = toSingleValue(searchParams?.sim_capital)
  const simStockPct = toSingleValue(searchParams?.sim_stock_pct)
  const simParams =
    simEventId && /^\d{4}-\d{2}$/.test(simEventId)
      ? {
          event_id: simEventId,
          sim_start: simStart,
          sim_capital: simCapital,
          sim_stock_pct: simStockPct,
        }
      : undefined

  if (!raw) {
    return (
      <main style={{ padding: '2.6rem', color: '#94a3b8', fontFamily: 'monospace' }}>
        <h2 style={{ color: '#ef4444' }}>vr_survival.json not found</h2>
        <p>
          Run:{' '}
          <code style={{ background: '#111827', padding: '0.26rem 0.65rem', borderRadius: 6 }}>
            py C:/Temp/build_vr_survival.py
          </code>
        </p>
        <a href="/risk-v1" style={{ color: '#818cf8' }}>
          Risk System v1
        </a>
      </main>
    )
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top left, rgba(56,189,248,0.12), transparent 28%), radial-gradient(circle at top right, rgba(244,63,94,0.10), transparent 26%), linear-gradient(180deg, #090c13 0%, #0c0e13 48%, #090b10 100%)',
        color: '#e5e7eb',
        fontFamily: "var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)",
        padding: '1.35rem 1.5rem',
      }}
    >
      <div style={{ maxWidth: 1360, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              MARKETFLOW - SURVIVAL LAB
            </div>
            <h1 style={{ fontSize: '2.3rem', fontWeight: 900, color: '#f8fafc', margin: '0.35rem 0 0' }}>
              VR Survival Lab
            </h1>
            <div style={{ fontSize: '0.92rem', color: '#94a3b8', marginTop: 8, lineHeight: 1.6, maxWidth: 760 }}>
              Crash 대응 전략을 미리 경험하는 시뮬레이션 엔진
            </div>
            <div style={{ fontSize: '0.9rem', color: '#cbd5e1', marginTop: 10, lineHeight: 1.75, maxWidth: 860 }}>
              이 시스템은 VR(Value Rebalancing) 전략을 기반으로, 하락장에서의 대응 방식을 연구하는 시뮬레이션 엔진입니다. 평상시에는 VR 규칙에 따라 운용되며, Vmin 붕괴 이후와 같은 지속적인 하락 국면에서는 과거 시장 이벤트를 기반으로 다양한 시나리오를 분석하여, 투자자가 대응 전략을 이해하고 준비할 수 있도록 돕습니다.
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 8, lineHeight: 1.6, maxWidth: 860 }}>
              {NON_SIGNAL_COPY}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                style={{
                  ...navLinkStyle,
                  color: item.accent,
                  borderColor: item.border,
                  background: item.bg,
                  boxShadow: `0 0 0 1px ${item.border} inset`,
                }}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '0.66rem', color: '#7dd3fc', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 800 }}>
          STEP 1 OF 3 — MARKET CONDITION (STANDARD)
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)',
            gap: 12,
            alignItems: 'stretch',
          }}
        >
          <VRRiskTracksCard snapshot={riskV1} />

          <div
            style={{
              borderRadius: 14,
              border: '1px solid rgba(56,189,248,0.16)',
              background: 'linear-gradient(180deg, rgba(8,16,28,0.96), rgba(7,11,18,0.98))',
              padding: '1.05rem 1.1rem',
              display: 'grid',
              gap: 10,
              boxShadow: '0 0 0 1px rgba(56,189,248,0.08) inset',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800 }}>
              What VR Does
            </div>
            <div style={{ fontSize: '1.02rem', color: '#f8fafc', lineHeight: 1.7, fontWeight: 800 }}>
              VR은 시장을 예측하는 엔진이 아니라, 하락장에서 어떻게 살아남는지를 보여주는 엔진입니다.
            </div>
            <div style={{ fontSize: '0.92rem', color: '#cbd5e1', lineHeight: 1.7 }}>
              정답을 지시하지 않습니다. 대신 가능한 대응 방법과 그 결과를 비교해 보여줍니다.
            </div>
            <div style={{ fontSize: '0.86rem', color: '#94a3b8', lineHeight: 1.65 }}>
              {ROLE_SPLIT_COPY}
            </div>
          </div>
        </div>

        <FlowDivider
          step="STEP 2 OF 3"
          label="HISTORICAL EVIDENCE"
          desc="Playback과 Backtest가 유사한 과거 사례와 전략 결과를 보여줍니다."
        />

        <VRSurvival
          data={raw}
          initialTab={initialTab}
          initialPlaybackEventId={initialPlaybackEventId}
          simParams={simParams}
        />

        <div style={{ fontSize: '0.75rem', color: '#475569', textAlign: 'center', paddingTop: '0.4rem' }}>
          Generated: {raw.run_id} - VR Survival Lab
        </div>
      </div>
    </main>
  )
}

function FlowDivider({ step, label, desc }: { step: string; label: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0.35rem 0' }}>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.35), transparent)' }} />
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        minWidth: 0,
        padding: '0.28rem 0.75rem',
        borderRadius: 999,
        border: '1px solid rgba(56,189,248,0.18)',
        background: 'rgba(15,23,42,0.92)',
      }}>
        <div style={{ fontSize: '0.62rem', color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 800, whiteSpace: 'nowrap' }}>
          {step} — {label}
        </div>
        <div style={{ fontSize: '0.71rem', color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', maxWidth: 480 }}>
          {desc}
        </div>
      </div>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(251,113,133,0.35), transparent)' }} />
    </div>
  )
}

const navLinkStyle: CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  padding: '0.45rem 0.95rem',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.02)',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
}


