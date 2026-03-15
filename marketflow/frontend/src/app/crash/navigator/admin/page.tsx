import fs from 'fs'
import path from 'path'
import { notFound } from 'next/navigation'

type Row = {
  param_set_id: number
  watch_ret2: number
  watch_ret3: number
  def_ret2: number
  def_ret3: number
  panic_ret3: number
  saved_tail_risk: number
  false_defense_rate: number
  flips_per_100d: number
  composite_score: number
}

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/)
  const header = lines.shift()?.split(',') ?? []
  return lines.map((line) => {
    const cols = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((key, idx) => {
      row[key] = cols[idx] ?? ''
    })
    return row
  })
}

export default function NavigatorAdminParetoPage() {
  if (process.env.ENABLE_NAV_ADMIN !== 'true') {
    notFound()
  }

  const csvPath = path.join(process.cwd(), '..', 'backend', 'output', 'navigator_tradeoff_matrix.csv')
  if (!fs.existsSync(csvPath)) {
    return (
      <main style={{ padding: '2rem', color: '#e5e7eb', background: '#0c0e13', minHeight: '100vh' }}>
        <div>navigator_tradeoff_matrix.csv not found.</div>
      </main>
    )
  }

  const text = fs.readFileSync(csvPath, 'utf8')
  const rows = parseCsv(text).map((r) => ({
    param_set_id: Number(r.param_set_id),
    watch_ret2: Number(r.watch_ret2),
    watch_ret3: Number(r.watch_ret3),
    def_ret2: Number(r.def_ret2),
    def_ret3: Number(r.def_ret3),
    panic_ret3: Number(r.panic_ret3),
    saved_tail_risk: Number(r.saved_tail_risk),
    false_defense_rate: Number(r.false_defense_rate),
    flips_per_100d: Number(r.flips_per_100d),
    composite_score: Number(r.composite_score),
  })) as Row[]

  const top20 = [...rows].sort((a, b) => b.composite_score - a.composite_score).slice(0, 20)
  const minX = Math.min(...rows.map((r) => r.false_defense_rate))
  const maxX = Math.max(...rows.map((r) => r.false_defense_rate))
  const minY = Math.min(...rows.map((r) => r.saved_tail_risk))
  const maxY = Math.max(...rows.map((r) => r.saved_tail_risk))

  const normalize = (value: number, min: number, max: number) => {
    if (max - min === 0) return 0.5
    return (value - min) / (max - min)
  }

  const colorFromFlips = (value: number) => {
    const norm = Math.max(0, Math.min(1, value / 15))
    const hue = 200 - norm * 140
    return `hsl(${hue}, 70%, 55%)`
  }

  return (
    <main style={{ padding: '2rem', color: '#e5e7eb', background: '#0c0e13', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>Navigator Trade-off Pareto (Admin)</div>
        <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: 6 }}>
          x = false_defense_rate, y = saved_tail_risk, color = flips_per_100d
        </div>

        <div style={{ marginTop: 16, background: '#111318', borderRadius: 12, padding: '1rem' }}>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: 360 }}>
            {rows.map((r) => {
              const x = normalize(r.false_defense_rate, minX, maxX) * 100
              const y = 100 - normalize(r.saved_tail_risk, minY, maxY) * 100
              const isTop = top20.some((t) => t.param_set_id === r.param_set_id)
              return (
                <circle
                  key={r.param_set_id}
                  cx={x}
                  cy={y}
                  r={isTop ? 2.2 : 1.2}
                  fill={isTop ? '#facc15' : colorFromFlips(r.flips_per_100d)}
                  opacity={isTop ? 0.95 : 0.6}
                />
              )
            })}
          </svg>
        </div>

        <div style={{ marginTop: 18, display: 'grid', gap: '0.4rem' }}>
          {top20.map((r) => (
            <a
              key={r.param_set_id}
              href={`/crash/navigator?admin=1&w2=${r.watch_ret2}&w3=${r.watch_ret3}&d2=${r.def_ret2}&d3=${r.def_ret3}&p3=${r.panic_ret3}`}
              style={{ color: '#cbd5f5', textDecoration: 'none', fontSize: '0.85rem' }}
            >
              #{r.param_set_id} watch({r.watch_ret2}, {r.watch_ret3}) def({r.def_ret2}, {r.def_ret3}) panic({r.panic_ret3}) - score {r.composite_score.toFixed(3)}
            </a>
          ))}
        </div>
      </div>
    </main>
  )
}
