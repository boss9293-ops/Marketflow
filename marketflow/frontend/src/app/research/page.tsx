import type { CSSProperties } from 'react'
import ResearchWorkspace         from '@/components/research/ResearchWorkspace'
import UnifiedPriorityStrip      from '@/components/priority/UnifiedPriorityStrip'
import DailyDigestPanel          from '@/components/digest/DailyDigestPanel'
import VrValidationTriggerPanel     from '@/components/validation/VrValidationTriggerPanel'
import ResearchScenarioMapPanel     from '@/components/scenario/ResearchScenarioMapPanel'
import Link from 'next/link'

const navStyle: CSSProperties = {
  fontSize: '0.85rem', color: '#94a3b8', textDecoration: 'none',
  padding: '0.45rem 0.95rem',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.02)',
}

function toSingle(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default function ResearchPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const q             = toSingle(searchParams?.q) ?? ''
  const vrState       = toSingle(searchParams?.vr_state)
  const crashTrigger  = toSingle(searchParams?.crash_trigger) === 'true'
  const confidenceRaw = toSingle(searchParams?.confidence)
  const confidence: 'low' | 'medium' | 'high' =
    confidenceRaw === 'low' || confidenceRaw === 'medium' || confidenceRaw === 'high'
      ? confidenceRaw : 'medium'
  const loadMonitorId = toSingle(searchParams?.load_monitor)

  const vrContext = vrState
    ? { vr_state: vrState, crash_trigger: crashTrigger, confidence }
    : undefined

  return (
    <main style={{
      minHeight: '100vh',
      background: '#0c0e13',
      color: '#e5e7eb',
      fontFamily: "var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)",
      padding: '1.35rem 1.5rem',
    }}>
      <div style={{ maxWidth: 1420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              MarketFlow &middot; Research
            </div>
            <h1 style={{ fontSize: '2.1rem', fontWeight: 900, color: '#f8fafc', margin: '0.35rem 0 0' }}>
              Research Workspace
            </h1>
            <div style={{ fontSize: '0.92rem', color: '#94a3b8', marginTop: 8, lineHeight: 1.6, maxWidth: 640 }}>
              AI-generated research with source attribution, VR engine context, and session history.
              {vrContext
                ? <> Linked from <strong style={{ color: '#818cf8' }}>VR Survival</strong> &mdash; query prefilled from current engine state.</>
                : loadMonitorId
                  ? <> Loading monitored topic from dashboard.</>
                  : <> Select a topic pack or ask a research question to get started.</>
              }
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/vr-survival" style={navStyle}>VR Survival</Link>
            <Link href="/risk-v1"     style={navStyle}>Risk System</Link>
            <Link href="/dashboard"   style={navStyle}>Dashboard</Link>
          </div>
        </div>

        <UnifiedPriorityStrip />
        <DailyDigestPanel />
        <VrValidationTriggerPanel />
        <ResearchScenarioMapPanel />

        <ResearchWorkspace
          initialQuery={q || undefined}
          vrContext={vrContext}
          loadMonitorId={loadMonitorId}
        />

        <div style={{ fontSize: '0.73rem', color: '#374151', textAlign: 'center', paddingTop: '0.3rem' }}>
          Research Workspace &middot; AI-generated &middot; not financial advice &middot; verify primary sources before acting
        </div>
      </div>
    </main>
  )
}

