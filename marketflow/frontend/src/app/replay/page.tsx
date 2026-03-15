import path from 'path'
import fs from 'fs/promises'
import ReplayDashboard, { ReplayWindow } from '@/components/replay/ReplayDashboard'

// ── Data loading ───────────────────────────────────────────────────────────────

async function loadReplayFile(windowName: string): Promise<ReplayWindow | null> {
  // Try multiple relative paths from the Next.js project root (process.cwd())
  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', 'replay', `${windowName}.json`),
    path.resolve(process.cwd(), 'backend', 'output', 'replay', `${windowName}.json`),
  ]
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8')
      return JSON.parse(raw) as ReplayWindow
    } catch {
      // try next candidate
    }
  }
  return null
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ReplayPage() {
  const windowNames = [
    '2020_covid',
    '2022_tightening',
    '2023_bank_stress',
    '2025_current',
  ]

  const windows = (
    await Promise.all(windowNames.map(n => loadReplayFile(n)))
  ).filter((w): w is ReplayWindow => w !== null)

  if (windows.length === 0) {
    return (
      <div style={{
        background: '#0a0c10', minHeight: '100vh', padding: '2rem',
        color: '#6b7280', fontFamily: 'monospace', fontSize: '0.85rem',
      }}>
        <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 8 }}>No replay data found.</div>
        <div style={{ marginBottom: 4 }}>
          Run from <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }}>
            marketflow/backend/scripts/
          </code>:
        </div>
        <code style={{ display: 'block', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: 6, color: '#22c55e', marginBottom: 8 }}>
          py build_replay_v1.py
        </code>
        <div style={{ color: '#4b5563' }}>
          Expected output: backend/output/replay/*.json
        </div>
      </div>
    )
  }

  return <ReplayDashboard windows={windows} />
}
