import fs from 'fs/promises'
import path from 'path'
import RiskAlertSystem, { type RiskAlertData } from '@/components/crash/standard/RiskAlertSystem'

async function readOutputJson<T>(filename: string): Promise<T | null> {
  try {
    const base = path.join(process.cwd(), '..', 'backend', 'output')
    const raw  = await fs.readFile(path.join(base, filename), 'utf-8')
    return JSON.parse(raw) as T
  } catch { return null }
}

export default async function LegacySRASPage() {
  const riskAlertRaw = await readOutputJson<RiskAlertData>('risk_alert.json')

  return (
    <main style={{
      minHeight: '100vh', background: '#0c0e13', color: '#e5e7eb',
      fontFamily: "'Inter','Segoe UI',sans-serif", padding: '1.5rem',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: '0.58rem', color: '#374151', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Legacy — 9-Indicator System
            </div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#e5e7eb', margin: '0.2rem 0 0' }}>
              SRAS Crash Engine
            </h1>
            <div style={{ fontSize: '0.6rem', color: '#374151', marginTop: 3 }}>
              Original 9-indicator macro score · See{' '}
              <a href="/risk-v1" style={{ color: '#6366f1' }}>Standard Risk System</a> for the current version.
            </div>
          </div>
          <a href="/crash" style={{ fontSize: '0.65rem', color: '#6b7280', textDecoration: 'none', padding: '0.3rem 0.7rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
            ← Crash Hub
          </a>
        </div>

        {riskAlertRaw ? (
          <RiskAlertSystem data={riskAlertRaw} />
        ) : (
          <div style={{ color: '#6b7280', fontSize: '0.8rem', padding: '2rem' }}>
            risk_alert.json not found — run build_risk_alert.py
          </div>
        )}
      </div>
    </main>
  )
}
