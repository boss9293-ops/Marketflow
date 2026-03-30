'use client'

import { useEffect, useState } from 'react'
import { StockAnalysisResponse, fetchStockAnalysis, normalizeTicker, AnalysisMode } from '@/lib/stockAnalysis'

type Props = {
  symbol?: string
  fetchKey?: number
  mode?: AnalysisMode
}

// ── Formatters ──────────────────────────────────────────────────────────────
function fmtMult(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(1)}x`
}

function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(decimals)}%`
}

function fmtPctSign(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const pct = v * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function fmtLarge(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`
  return `${sign}$${abs.toLocaleString()}`
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `$${v.toFixed(decimals)}`
}

function fmtEmployees(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return Math.round(v).toLocaleString()
}

// ── Row component ────────────────────────────────────────────────────────────
function Row({ label, value, note, color }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-[7px] px-3 border-b border-slate-800/60 last:border-0">
      <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{label}</span>
      <div className="text-right">
        <span style={{ color: color || '#e2e8f0', fontSize: '0.82rem', fontWeight: 600 }}>{value}</span>
        {note && (
          <span style={{ color: '#64748b', fontSize: '0.70rem', marginLeft: 5 }}>{note}</span>
        )}
      </div>
    </div>
  )
}

// ── Section card ─────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'rgba(15,23,42,0.80)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          padding: '7px 12px 6px',
          background: 'rgba(30,41,59,0.60)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          color: '#cbd5e1',
          fontSize: '0.70rem',
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Helper: upside color ─────────────────────────────────────────────────────
function upsideColor(v: number | null | undefined): string {
  if (v == null) return '#e2e8f0'
  const pct = v * 100
  if (pct >= 10) return '#4ade80'
  if (pct >= 0)  return '#a3e635'
  if (pct >= -10) return '#fb923c'
  return '#f87171'
}

function profitColor(v: number | null | undefined): string {
  if (v == null) return '#e2e8f0'
  const pct = v * 100
  if (pct >= 15) return '#4ade80'
  if (pct >= 5)  return '#a3e635'
  if (pct >= 0)  return '#e2e8f0'
  return '#f87171'
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StatisticsPanel({ symbol = 'AAPL', fetchKey = 0, mode = 'auto' }: Props) {
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ticker = normalizeTicker(symbol) || 'AAPL'
    const controller = new AbortController()
    let alive = true
    setLoading(true)
    setError(null)

    fetchStockAnalysis(ticker, mode, controller.signal)
      .then(payload => { if (alive) setAnalysis(payload) })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false; controller.abort() }
  }, [symbol, fetchKey, mode])

  if (loading) {
    return (
      <div style={{ position: 'relative', background: '#080808', borderLeft: '3px solid #2a2a2a', overflow: 'hidden', borderRadius: 2, padding: '22px 20px 22px 22px', margin: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 200 }}>
        <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#fff', opacity: 0.035, top: 10, right: -15, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>SYS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
          <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.04)', color: '#444', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>FETCHING_DATA</span>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>분석 중...</div>
          <div style={{ color: '#333', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.7 }}>종목 데이터 및 기술적 지표를 불러오는 중_</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 16 }}>
          {[100, 75, 50].map((w, i) => (
            <div key={i} style={{ height: 2, width: `${w}%`, background: ['#1e1e1e','#181818','#141414'][i], borderRadius: 1 }} />
          ))}
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ position: 'relative', background: '#080808', borderLeft: '3px solid #FF5C33', overflow: 'hidden', borderRadius: 2, padding: '22px 20px 22px 22px', margin: '0.5rem', minHeight: 200 }}>
        <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#FF5C33', opacity: 0.07, top: 10, right: -10, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>ERR</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
          <span style={{ display: 'inline-block', background: 'rgba(255,92,51,0.09)', color: '#FF5C33', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>CONNECTION_FAILED</span>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>통계 데이터를 불러올 수 없습니다</div>
          <div style={{ color: '#4a4a4a', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.7 }}>{error}</div>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ margin: '1rem', background: '#1A1A1A', borderRadius: 12, border: '1px solid rgba(255,92,51,0.25)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ background: '#24100B', color: '#FF5C33', borderRadius: 100, padding: '3px 10px', fontSize: '0.62rem', fontWeight: 700, width: 'fit-content' }}>API ERROR</span>
        <div style={{ color: '#fff', fontSize: '0.875rem', fontWeight: 600 }}>통계 데이터를 불러올 수 없습니다</div>
        <div style={{ color: '#B8B9B6', fontSize: '0.75rem', lineHeight: 1.6 }}>{error}</div>
      </div>
    )
  }
  if (!analysis) return null

  const s = analysis.stats || {}
  const v = analysis.valuation || {}
  const c = analysis.consensus || {}
  const cur = analysis.current_price
  const pe  = analysis.current_pe

  // Market cap from valuation, enterprise value from stats
  const mktCap = v.market_cap
  const ev     = s.enterprise_value

  // Upside from consensus target
  const upsidePct = (cur && c.target_mean && cur > 0)
    ? (c.target_mean - cur) / cur
    : null

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '4px 0 16px' }}>

      {/* ── Header: company info bar ─────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
          padding: '10px 14px',
          background: 'rgba(15,23,42,0.80)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12,
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1.05rem' }}>
            {analysis.name || analysis.ticker}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: 2 }}>
            {[analysis.exchange, analysis.sector, analysis.industry].filter(Boolean).join('  ·  ')}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {mktCap != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#64748b', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Market Cap</div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.90rem' }}>{fmtLarge(mktCap)}</div>
            </div>
          )}
          {ev != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#64748b', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Enterprise Value</div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.90rem' }}>{fmtLarge(ev)}</div>
            </div>
          )}
          {cur != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#64748b', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Current Price</div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.90rem' }}>${cur.toFixed(2)}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2-column grid ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>

        {/* ── Valuation Ratios ──────────────────────────── */}
        <Section title="Valuation Ratios">
          <Row label="P/E Ratio (TTM)"   value={fmtMult(pe)} />
          <Row label="P/S Ratio (TTM)"   value={fmtMult(s.ps_ratio)} />
          <Row label="P/B Ratio (TTM)"   value={fmtMult(s.pb_ratio)} />
          <Row label="PEG Ratio"         value={fmtMult(s.peg_ratio)} />
          <Row label="EV / EBITDA"       value={fmtMult(s.ev_ebitda)} />
          <Row label="EV / Sales"        value={fmtMult(s.ev_sales)} />
          <Row label="EV / Free Cash Flow" value={fmtMult(s.ev_fcf)} />
        </Section>

        {/* ── Profitability ─────────────────────────────── */}
        <Section title="Profitability">
          <Row label="ROE"                value={fmtPct(s.roe)}   color={profitColor(s.roe)} />
          <Row label="ROA"                value={fmtPct(s.roa)}   color={profitColor(s.roa)} />
          <Row label="ROIC"               value={fmtPct(s.roic ?? s.roic_km)} color={profitColor(s.roic ?? s.roic_km)} />
          <Row label="Asset Turnover"     value={s.asset_turnover != null ? s.asset_turnover.toFixed(2) : '—'} />
          <Row label="Revenue / Share"    value={fmtNum(s.revenue_per_share)} />
          <Row label="FCF / Share"        value={fmtNum(s.fcf_per_share)} />
          {s.employees != null && (
            <Row label="Employees" value={fmtEmployees(s.employees)} />
          )}
        </Section>

        {/* ── Margins ──────────────────────────────────── */}
        <Section title="Margins">
          <Row label="Gross Margin"     value={fmtPct(v.gross_margin)}     color={profitColor(v.gross_margin)} />
          <Row label="Operating Margin" value={fmtPct(v.operating_margin)} color={profitColor(v.operating_margin)} />
          <Row label="Net Margin"       value={fmtPct(v.net_margin)}       color={profitColor(v.net_margin)} />
          <Row label="EBITDA Margin"    value={fmtPct(s.ebitda_margin)}    color={profitColor(s.ebitda_margin)} />
        </Section>

        {/* ── Income Statement ─────────────────────────── */}
        <Section title={`Income Statement${s.income_period ? ` (FY${s.income_period})` : ''}`}>
          <Row label="Revenue"          value={fmtLarge(s.revenue)} />
          <Row label="Gross Profit"     value={fmtLarge(s.gross_profit)} />
          <Row label="Operating Income" value={fmtLarge(s.operating_income)} />
          <Row label="Net Income"       value={fmtLarge(s.net_income)} />
          <Row label="EBITDA"           value={fmtLarge(s.ebitda)} />
          <Row label="EPS (Reported)"   value={s.eps_reported != null ? `$${s.eps_reported.toFixed(2)}` : '—'} />
          <Row label="EPS (TTM)"        value={v.eps_ttm != null ? `$${v.eps_ttm.toFixed(2)}` : '—'} />
        </Section>

        {/* ── Balance Sheet ─────────────────────────────── */}
        <Section title="Balance Sheet">
          <Row label="Cash & Equivalents" value={fmtLarge(s.cash)} />
          <Row label="Total Debt"         value={fmtLarge(s.total_debt)} />
          <Row label="Net Debt"           value={fmtLarge(s.net_debt)}
            color={s.net_debt != null ? (s.net_debt < 0 ? '#4ade80' : '#fb923c') : undefined}
          />
          <Row label="Total Assets"       value={fmtLarge(s.total_assets)} />
          <Row label="Debt / Equity"      value={fmtMult(v.debt_to_equity)} />
          <Row label="Current Ratio"      value={v.current_ratio != null ? v.current_ratio.toFixed(2) : '—'} />
        </Section>

        {/* ── Growth ───────────────────────────────────── */}
        <Section title="Growth">
          <Row label="Revenue Growth (TTM)"  value={fmtPctSign(v.revenue_growth)} color={upsideColor(v.revenue_growth)} />
          <Row label="EPS FY+1 (Consensus)"  value={c.eps_estimate_fy1 != null ? `$${c.eps_estimate_fy1.toFixed(2)}` : '—'} />
          <Row label="EPS FY+2 (Consensus)"  value={c.eps_estimate_fy2 != null ? `$${c.eps_estimate_fy2.toFixed(2)}` : '—'} />
          <Row label="Forward EPS"           value={v.eps_forward != null ? `$${v.eps_forward.toFixed(2)}` : '—'} />
        </Section>

        {/* ── Analyst Forecast (full-width) ─────────────────────────────── */}
      </div>

      <Section title="Analyst Forecast">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <Row label="Price Target (Mean)" value={c.target_mean != null ? `$${c.target_mean.toFixed(2)}` : '—'}
            color={upsideColor(upsidePct)}
          />
          <Row label="Price Target (High)" value={c.target_high != null ? `$${c.target_high.toFixed(2)}` : '—'} />
          <Row label="Price Target (Low)"  value={c.target_low  != null ? `$${c.target_low.toFixed(2)}`  : '—'} />
          <Row label="Upside to Mean"      value={fmtPctSign(upsidePct)} color={upsideColor(upsidePct)} />
          <Row label="Analyst Coverage"    value={c.target_analyst_count != null ? `${Math.round(c.target_analyst_count)} analysts` : '—'} />
          <Row label="EPS FY+1 Estimate"   value={c.eps_estimate_fy1 != null ? `$${c.eps_estimate_fy1.toFixed(2)}` : '—'} />
        </div>
      </Section>

    </div>
  )
}
