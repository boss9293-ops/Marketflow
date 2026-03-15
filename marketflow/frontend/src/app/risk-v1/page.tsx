import { readFileSync } from 'fs'
import { join } from 'path'
import RiskSystemV1, { RiskV1Data } from '@/components/crash/standard/RiskSystemV1'
import RiskV1RefreshButton from '@/components/crash/standard/RiskV1RefreshButton'

function readOutputJson<T>(filename: string): T | null {
  try {
    const base = join(process.cwd(), '..', 'backend', 'output')
    const raw = readFileSync(join(base, filename), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function formatRunId(runId?: string): string {
  if (!runId || !/^\d{8}_\d{6}$/.test(runId)) return runId || '—'
  const y = runId.slice(0, 4)
  const m = runId.slice(4, 6)
  const d = runId.slice(6, 8)
  const hh = runId.slice(9, 11)
  const mm = runId.slice(11, 13)
  const ss = runId.slice(13, 15)
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

export default function RiskV1Page() {
  const raw = readOutputJson<RiskV1Data>('risk_v1.json')
  const dataAsOf = raw?.data_as_of || raw?.current?.date || '—'
  const generatedAt = formatRunId(raw?.run_id)

  if (!raw) {
    return (
      <main style={{ padding: '2.6rem', color: '#b7c6df', fontFamily: 'monospace' }}>
        <h2 style={{ color: '#ef4444' }}>risk_v1.json not found</h2>
        <p>
          Run:{' '}
          <code style={{ background: '#111', padding: '0.26rem 0.65rem', borderRadius: 4 }}>
            py marketflow/backend/scripts/build_risk_v1.py
          </code>
        </p>
        <a href="/crash" style={{ color: '#6366f1' }}>
          ← Crash Hub
        </a>
      </main>
    )
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#121212',
        color: '#e5e7eb',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#b7c6df', letterSpacing: '0.15em', textTransform: 'uppercase' }}>MarketFlow</div>
            <h1 style={{ fontSize: 40, fontWeight: 900, color: '#e5e7eb', margin: '2px 0 0' }}>
              Standard Risk System <span style={{ color: '#6366f1' }}>v1</span>
            </h1>
            <div style={{ fontSize: 14, color: '#b7c6df', marginTop: 6 }}>
              Probabilistic systemic stress monitor · decision support only
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#b7c6df', marginRight: 4 }}>Data as-of: {dataAsOf}</div>
            <div style={{ fontSize: 13, color: '#8fa3c8', marginRight: 4 }}>Generated: {generatedAt}</div>
            <RiskV1RefreshButton />
            <a href="/crash" style={linkBtnStyle}>← Crash Hub</a>
            <a href="/backtest" style={linkBtnStyle}>Backtest (SRAS)</a>
            <a href="/dashboard" style={linkBtnStyle}>Dashboard</a>
          </div>
        </div>

        <RiskSystemV1 data={raw} />

        <div style={{ fontSize: 12, color: '#4b5563', textAlign: 'center', paddingTop: 8 }}>Generated: {generatedAt} · MarketFlow Risk System v1</div>
      </div>
    </main>
  )
}

const linkBtnStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#b7c6df',
  textDecoration: 'none',
  padding: '8px 14px',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
}

