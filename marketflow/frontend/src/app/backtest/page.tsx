import fs from 'fs/promises'
import path from 'path'
import Link from 'next/link'
import BacktestView, { type BacktestData } from '@/components/crash/backtests/BacktestView'

async function readOutputJson<T>(filename: string, fallback: T): Promise<T> {
  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', filename),
    path.resolve(process.cwd(), 'backend', 'output', filename),
    path.resolve(process.cwd(), '..', 'output', filename),
  ]
  for (const p of candidates) {
    try { return JSON.parse(await fs.readFile(p, 'utf-8')) as T } catch { /* next */ }
  }
  return fallback
}

export default async function BacktestPage() {
  const raw = await readOutputJson<BacktestData | null>('risk_alert.json', null)

  return (
    <div style={{ padding: '2.08rem 2.34rem 3.25rem', display: 'flex', flexDirection: 'column', gap: '1.62rem' }}>

      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: '2.47rem', fontWeight: 800, color: '#f3f4f6' }}>
          Risk Alert <span style={{ color: '#22c55e' }}>Backtest</span>
        </h1>
        <p style={{ color: '#9ca3af', marginTop: '0.45rem', fontSize: '1.07rem' }}>
          Standard Risk Alert System · 27년 백테스트 · QQQ vs 전략 비교
        </p>
      </div>

      {raw && raw.backtest && raw.backtest_curve ? (
        <BacktestView data={raw as BacktestData} />
      ) : (
        <div style={{
          background: '#111318', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12, padding: '2.6rem', textAlign: 'center', color: '#9ca3af',
        }}>
          <div style={{ fontSize: '1.17rem' }}>Backtest 데이터가 없습니다</div>
          <div style={{ fontSize: '0.94rem', marginTop: 6 }}>
            Run: <code style={{ color: '#fcd34d' }}>py backend/scripts/build_risk_alert.py</code>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 8, fontSize: '0.94rem' }}>
        <Link href="/crash" style={{ color: '#ef4444', textDecoration: 'none', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '4px 10px' }}>Crash Engine</Link>
        <Link href="/dashboard" style={{ color: '#9ca3af', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 10px' }}>Dashboard</Link>
      </div>
    </div>
  )
}
