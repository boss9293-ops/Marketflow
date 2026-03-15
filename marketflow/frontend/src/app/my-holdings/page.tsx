import fs from 'fs'
import path from 'path'
import HoldingsChart from '@/components/HoldingsChart'

export const dynamic = 'force-static'

export interface HoldingsPoint {
  date: string
  total: number | null
  in: number | null
  pl: number | null
  pl_pct: number | null
}

export interface TabStats {
  max_total: number | null
  min_total: number | null
  last5_pl_pct: number[]
  last5_pl_pct_changes: (number | null)[]
  data_points: number
}

export interface HoldingsTS {
  data_version?: string
  status?: string
  date?: string
  selected_tabs?: string[]
  series?: Record<string, HoldingsPoint[]>
  latest?: Record<string, HoldingsPoint>
  stats?: Record<string, TabStats>
  tabs?: Array<{
    name?: string
    type?: string
    positions?: Array<Record<string, any>>
    positions_columns?: string[]
    history?: HoldingsPoint[]
  }>
  goal?: {
    positions?: Array<Record<string, any>>
    positions_columns?: string[]
    history?: HoldingsPoint[]
  }
  sheet_id?: string | null
  generated_at?: string
  missing_inputs?: string[]
  rerun_hint?: string
}

function loadCache(): HoldingsTS | null {
  // Try backend/output/ relative to the project root (two levels up from frontend/)
  const candidates = [
    path.join(process.cwd(), '..', 'backend', 'output', 'my_holdings_ts.json'),
    path.join(process.cwd(), 'backend', 'output', 'my_holdings_ts.json'),
    path.join(process.cwd(), '..', '..', 'backend', 'output', 'my_holdings_ts.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8')
        return JSON.parse(raw) as HoldingsTS
      }
    } catch {
      // continue
    }
  }
  return null
}

export default function MyHoldingsPage() {
  const data = loadCache()

  if (!data) {
    return (
      <div style={{ padding: '2rem 1.75rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
          My <span style={{ color: '#00D9FF' }}>Holdings</span>
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
            캐시 파일 없음 — my_holdings_ts.json not found
          </div>
          <div style={{ color: '#d1d5db', fontSize: '0.85rem', marginBottom: 12 }}>
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
            {`# 1. List tabs (requires GOOGLE_SERVICE_ACCOUNT_JSON env)
python backend/scripts/list_sheet_tabs.py --sheet_url "<your-google-sheets-url>"

# 2. Import selected tabs
python backend/scripts/import_holdings_tabs.py --sheet_id <ID> --tabs "Goal,Tab1,Tab2"

# 3. Build cache
python backend/scripts/build_holdings_ts_cache.py

# Or all-in-one (holdings mode)
python backend/run_all.py --mode holdings --sheet_id <ID> --tabs "Goal,Tab1,Tab2"`}
          </pre>
        </div>
      </div>
    )
  }

  return <HoldingsChart data={data} />
}
