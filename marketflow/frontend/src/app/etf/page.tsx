import fs from 'fs'
import path from 'path'

export const dynamic = 'force-static'

// ─── Types ────────────────────────────────────────────────────────────────────
interface EtfItem {
  symbol: string
  name: string
  last_close: number | null
  ret_1d: number | null
  ret_5d: number | null
  ret_20d: number | null
  ret_200d: number | null
  vol_k: number | null
  vol_surge: number | null
  rsi14: number | null
  above_sma50: boolean | null
  above_sma200: boolean | null
}

interface EtfSection {
  items: EtfItem[]
  sort: string
}

interface EtfRoomData {
  date?: string | null
  generated_at?: string
  status?: string
  sections?: {
    hot?: EtfSection
    leverage?: EtfSection
    theme?: EtfSection
    dividend?: EtfSection
  }
  notes?: { coverage?: { ok?: number; missing?: string[] } }
  rerun_hint?: string
}

// ─── Cache loader ─────────────────────────────────────────────────────────────
function loadCache(): EtfRoomData | null {
  const candidates = [
    path.join(process.cwd(), '..', 'backend', 'output', 'etf_room.json'),
    path.join(process.cwd(), 'backend', 'output', 'etf_room.json'),
    path.join(process.cwd(), '..', '..', 'backend', 'output', 'etf_room.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfRoomData
    } catch { /* continue */ }
  }
  return null
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtVol(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}B`   // vol_k is already /1000
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}M`
  return `${v.toFixed(0)}K`
}

function fmtSurge(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-'
  return `${v.toFixed(2)}x`
}

function fmtRsi(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-'
  return v.toFixed(1)
}

// ─── Badge components ─────────────────────────────────────────────────────────
function PctBadge({ v, digits = 2 }: { v: number | null | undefined; digits?: number }) {
  if (v == null || isNaN(v)) return <span style={{ color: '#6b7280' }}>-</span>
  const up = v > 0.05
  const dn = v < -0.05
  const color = up ? '#22c55e' : dn ? '#ef4444' : '#9ca3af'
  return (
    <span style={{ color, fontWeight: up || dn ? 700 : 400 }}>
      {v >= 0 ? '+' : ''}{v.toFixed(digits)}%
    </span>
  )
}

function SurgeBadge({ v }: { v: number | null | undefined }) {
  if (v == null || isNaN(v)) return <span style={{ color: '#6b7280' }}>-</span>
  const hot = v >= 2.0
  const warn = v >= 1.5
  const bg = hot ? 'rgba(239,68,68,0.15)' : warn ? 'rgba(245,158,11,0.15)' : 'transparent'
  const color = hot ? '#fca5a5' : warn ? '#fcd34d' : '#9ca3af'
  return (
    <span
      style={{
        background: bg,
        color,
        borderRadius: 5,
        padding: hot || warn ? '1px 5px' : 0,
        fontSize: '0.76rem',
      }}
    >
      {fmtSurge(v)}
    </span>
  )
}

function SmaBadge({ above, label }: { above: boolean | null | undefined; label: string }) {
  if (above == null) return <span style={{ color: '#374151', fontSize: '0.68rem' }}>-</span>
  return (
    <span
      style={{
        background: above ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
        color: above ? '#86efac' : '#fca5a5',
        borderRadius: 4,
        padding: '1px 5px',
        fontSize: '0.68rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {above ? '▲' : '▼'}{label}
    </span>
  )
}

function RsiBadge({ v }: { v: number | null | undefined }) {
  if (v == null || isNaN(v)) return <span style={{ color: '#6b7280' }}>-</span>
  const over = v >= 70
  const under = v <= 30
  const color = over ? '#ef4444' : under ? '#60a5fa' : '#d1d5db'
  return <span style={{ color }}>{fmtRsi(v)}</span>
}

// ─── Section table ────────────────────────────────────────────────────────────
const SECTION_META: Record<string, { title: string; dot: string }> = {
  hot:      { title: 'Hot ETFs',       dot: '#22c55e' },
  leverage: { title: 'Leverage ETFs',  dot: '#ef4444' },
  theme:    { title: 'Theme ETFs',     dot: '#a78bfa' },
  dividend: { title: 'Dividend ETFs',  dot: '#fbbf24' },
}

function SectionTable({ sectionKey, section }: { sectionKey: string; section: EtfSection }) {
  const meta = SECTION_META[sectionKey] ?? { title: sectionKey, dot: '#6b7280', showRet20d: false }
  const items = section.items ?? []

  return (
    <div
      style={{
        background: 'linear-gradient(145deg, rgba(30,33,41,0.92), rgba(20,22,29,0.92))',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '0.9rem 1rem 0.6rem',
      }}
    >
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.dot, boxShadow: `0 0 8px ${meta.dot}88`, display: 'inline-block' }} />
        <span style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem' }}>{meta.title}</span>
        <span style={{ color: '#6b7280', fontSize: '0.73rem', marginLeft: 'auto' }}>
          {items.length} ETFs · sorted {section.sort}
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: '0.82rem', padding: '0.5rem 0' }}>No data</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Symbol', 'Name', 'Close', '1D', '5D', '20D', '200D', 'Vol(K)', 'Surge', 'RSI', 'SMA50', 'SMA200'].map((h) => (
                  <th key={h} style={{ padding: '0.4rem 0.5rem', color: '#6b7280', fontWeight: 500, textAlign: h === 'Symbol' || h === 'Name' ? 'left' : 'right', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
                  <td style={{ padding: '0.42rem 0.5rem', color: '#00D9FF', fontWeight: 700, whiteSpace: 'nowrap' }}>{row.symbol}</td>
                  <td style={{ padding: '0.42rem 0.5rem', color: '#94a3b8', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</td>
                  <td style={{ padding: '0.42rem 0.5rem', color: '#d1d5db', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtPrice(row.last_close)}</td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}><PctBadge v={row.ret_1d} /></td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}><PctBadge v={row.ret_5d} /></td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}><PctBadge v={row.ret_20d} /></td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}><PctBadge v={row.ret_200d} /></td>
                  <td style={{ padding: '0.42rem 0.5rem', color: '#9ca3af', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtVol(row.vol_k)}</td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}><SurgeBadge v={row.vol_surge} /></td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}><RsiBadge v={row.rsi14} /></td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'center' }}><SmaBadge above={row.above_sma50} label="50" /></td>
                  <td style={{ padding: '0.42rem 0.5rem', textAlign: 'center' }}><SmaBadge above={row.above_sma200} label="200" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function EtfRoomPage() {
  const data = loadCache()

  const SECTION_ORDER = ['hot', 'leverage', 'theme', 'dividend'] as const

  if (!data) {
    return (
      <div style={{ padding: '2rem 1.75rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
          ETF <span style={{ color: '#00D9FF' }}>Room</span>
        </h1>
        <div
          style={{
            marginTop: '1.5rem',
            background: 'rgba(234,179,8,0.08)',
            border: '1px solid rgba(234,179,8,0.3)',
            borderRadius: 12,
            padding: '1.25rem 1.5rem',
          }}
        >
          <div style={{ color: '#fbbf24', fontWeight: 700, marginBottom: 8 }}>
            캐시 파일 없음 — etf_room.json not found
          </div>
          <div style={{ color: '#d1d5db', fontSize: '0.85rem', marginBottom: 10 }}>
            아래 명령어로 데이터를 생성하세요:
          </div>
          <pre
            style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              color: '#86efac',
              fontSize: '0.78rem',
              overflowX: 'auto',
              margin: 0,
            }}
          >
            python backend/scripts/build_etf_room.py
          </pre>
        </div>
      </div>
    )
  }

  const coverage = data.notes?.coverage
  const missingSym = coverage?.missing ?? []

  return (
    <div style={{ padding: '1.5rem 1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
          ETF <span style={{ color: '#00D9FF' }}>Room</span>
        </h1>
        <div style={{ color: '#8b93a8', fontSize: '0.78rem', marginTop: 4 }}>
          As of: {data.date ?? '-'} &nbsp;|&nbsp; Generated: {data.generated_at ?? '-'} &nbsp;|&nbsp;
          Coverage: {coverage?.ok ?? '-'}/{(coverage?.ok ?? 0) + missingSym.length}
          {missingSym.length > 0 && (
            <span style={{ color: '#fbbf24', marginLeft: 8 }}>
              missing: {missingSym.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* Rerun hint if status is not ok */}
      {data.status && data.status !== 'ok' && data.rerun_hint && (
        <div
          style={{
            background: 'rgba(234,179,8,0.07)',
            border: '1px solid rgba(234,179,8,0.25)',
            borderRadius: 10,
            padding: '0.65rem 1rem',
          }}
        >
          <span style={{ color: '#fbbf24', fontSize: '0.77rem' }}>
            status: {data.status} &nbsp;—&nbsp;
          </span>
          <code style={{ color: '#86efac', fontSize: '0.77rem' }}>{data.rerun_hint}</code>
        </div>
      )}

      {/* 4 sections */}
      {SECTION_ORDER.map((key) => {
        const section = data.sections?.[key]
        if (!section) return null
        return <SectionTable key={key} sectionKey={key} section={section} />
      })}

      {/* Footer */}
      <div style={{ color: '#374151', fontSize: '0.72rem' }}>
        rerun: <code style={{ color: '#4b5563' }}>{data.rerun_hint ?? 'python backend/scripts/build_etf_room.py'}</code>
      </div>
    </div>
  )
}
