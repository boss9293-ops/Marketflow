'use client'

import { useEffect, useState } from 'react'
import { StockAnalysisResponse, fetchStockAnalysis, normalizeTicker, AnalysisMode } from '@/lib/stockAnalysis'
import { pickLang, useUiLang } from '@/lib/useLangMode'

type Props = {
  symbol?: string
  fetchKey?: number
  mode?: AnalysisMode
}

// ?? Formatters ??????????????????????????????????????????????????????????????
function fmtMult(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--'
  return `${v.toFixed(1)}x`
}

function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '--'
  return `${(v * 100).toFixed(decimals)}%`
}

function fmtPctSign(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--'
  const pct = v * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function fmtLarge(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`
  return `${sign}$${abs.toLocaleString()}`
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '--'
  return `$${v.toFixed(decimals)}`
}

function fmtEmployees(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--'
  return Math.round(v).toLocaleString()
}

// ?? Row component ????????????????????????????????????????????????????????????
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

// ?? Section card ?????????????????????????????????????????????????????????????
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

// ?? Helper: upside color ?????????????????????????????????????????????????????
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

const STAT_TEXT = {
  fetchTag: { ko: '데이터 조회 중', en: 'FETCHING_DATA' },
  loadingTitle: { ko: '분석 중...', en: 'Analyzing...' },
  loadingDesc: { ko: '종목 데이터와 기술 지표를 불러오고 있습니다.', en: 'Loading ticker data and technical signals.' },
  connectionFailed: { ko: '연결 실패', en: 'CONNECTION_FAILED' },
  loadFailed: { ko: '통계 데이터를 불러오지 못했습니다', en: 'Unable to load statistics data.' },
  fallbackError: { ko: '불러오기에 실패했습니다.', en: 'Failed to load.' },
  marketCap: { ko: '시가총액', en: 'Market Cap' },
  enterpriseValue: { ko: '기업가치', en: 'Enterprise Value' },
  currentPrice: { ko: '현재가', en: 'Current Price' },
  sectionValuation: { ko: '밸류에이션', en: 'Valuation Ratios' },
  sectionProfitability: { ko: '수익성', en: 'Profitability' },
  sectionMargins: { ko: '마진', en: 'Margins' },
  sectionIncome: { ko: '손익계산서', en: 'Income Statement' },
  sectionBalance: { ko: '대차대조표', en: 'Balance Sheet' },
  sectionGrowth: { ko: '성장성', en: 'Growth' },
  sectionAnalyst: { ko: '애널리스트 전망', en: 'Analyst Forecast' },
  peRatio: { ko: 'PER (TTM)', en: 'P/E Ratio (TTM)' },
  psr: { ko: 'PSR (P/S)', en: 'PSR (P/S)' },
  pFcf: { ko: 'P/FCF (TTM)', en: 'P/FCF (TTM)' },
  pbRatio: { ko: 'PBR (TTM)', en: 'P/B Ratio (TTM)' },
  tPeg: { ko: 'tPEG', en: 'tPEG Ratio' },
  evEbitda: { ko: 'EV / EBITDA', en: 'EV / EBITDA' },
  evSales: { ko: 'EV / 매출', en: 'EV / Sales' },
  evFcf: { ko: 'EV / 잉여현금흐름', en: 'EV / Free Cash Flow' },
  roe: { ko: 'ROE', en: 'ROE' },
  roa: { ko: 'ROA', en: 'ROA' },
  roic: { ko: 'ROIC', en: 'ROIC' },
  assetTurnover: { ko: '총자산회전율', en: 'Asset Turnover' },
  revenuePerShare: { ko: '주당매출', en: 'Revenue / Share' },
  fcfPerShare: { ko: '주당 FCF', en: 'FCF / Share' },
  employees: { ko: '직원 수', en: 'Employees' },
  grossMargin: { ko: '매출총이익률', en: 'Gross Margin' },
  operatingMargin: { ko: '영업이익률', en: 'Operating Margin' },
  netMargin: { ko: '순이익률', en: 'Net Margin' },
  ebitdaMargin: { ko: 'EBITDA 마진', en: 'EBITDA Margin' },
  revenue: { ko: '매출', en: 'Revenue' },
  grossProfit: { ko: '매출총이익', en: 'Gross Profit' },
  operatingIncome: { ko: '영업이익', en: 'Operating Income' },
  netIncome: { ko: '순이익', en: 'Net Income' },
  ebitda: { ko: 'EBITDA', en: 'EBITDA' },
  epsReported: { ko: 'EPS (공시)', en: 'EPS (Reported)' },
  epsTtm: { ko: 'EPS (TTM)', en: 'EPS (TTM)' },
  cashEq: { ko: '현금 및 현금성자산', en: 'Cash & Equivalents' },
  totalDebt: { ko: '총부채', en: 'Total Debt' },
  netDebt: { ko: '순부채', en: 'Net Debt' },
  totalAssets: { ko: '총자산', en: 'Total Assets' },
  debtEquity: { ko: '부채비율', en: 'Debt / Equity' },
  currentRatio: { ko: '유동비율', en: 'Current Ratio' },
  revenueGrowth: { ko: '매출 성장률 (TTM)', en: 'Revenue Growth (TTM)' },
  epsFy1: { ko: 'EPS FY+1 (컨센서스)', en: 'EPS FY+1 (Consensus)' },
  epsFy2: { ko: 'EPS FY+2 (컨센서스)', en: 'EPS FY+2 (Consensus)' },
  forwardEps: { ko: '선행 EPS', en: 'Forward EPS' },
  priceTargetMean: { ko: '목표주가 (평균)', en: 'Price Target (Mean)' },
  priceTargetHigh: { ko: '목표주가 (상단)', en: 'Price Target (High)' },
  priceTargetLow: { ko: '목표주가 (하단)', en: 'Price Target (Low)' },
  upsideToMean: { ko: '평균 목표 대비 상승여력', en: 'Upside to Mean' },
  analystCoverage: { ko: '커버리지 애널리스트 수', en: 'Analyst Coverage' },
  analystsUnit: { ko: '명', en: 'analysts' },
  epsFy1Estimate: { ko: 'EPS FY+1 추정치', en: 'EPS FY+1 Estimate' },
} as const

// ?? Main component ???????????????????????????????????????????????????????????
export default function StatisticsPanel({ symbol = 'AAPL', fetchKey = 0, mode = 'auto' }: Props) {
  const uiLang = useUiLang()
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
        setError(err instanceof Error ? err.message : pickLang(uiLang, STAT_TEXT.fallbackError.ko, STAT_TEXT.fallbackError.en))
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false; controller.abort() }
  }, [symbol, fetchKey, mode])

  if (loading) {
    return (
      <div style={{ position: 'relative', background: '#080808', borderLeft: '3px solid #2a2a2a', overflow: 'hidden', borderRadius: 2, padding: '22px 20px 22px 22px', margin: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 200 }}>
        <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: 'var(--font-terminal), "Nanum Gothic Coding", "Noto Sans KR", monospace', color: '#fff', opacity: 0.035, top: 10, right: -15, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>SYS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
          <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.04)', color: '#444', fontSize: 9, fontFamily: 'var(--font-terminal), "Nanum Gothic Coding", "Noto Sans KR", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>
            {pickLang(uiLang, STAT_TEXT.fetchTag.ko, STAT_TEXT.fetchTag.en)}
          </span>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
            {pickLang(uiLang, STAT_TEXT.loadingTitle.ko, STAT_TEXT.loadingTitle.en)}
          </div>
          <div style={{ color: '#333', fontSize: 11, fontFamily: 'var(--font-terminal), "Nanum Gothic Coding", "Noto Sans KR", monospace', lineHeight: 1.7 }}>
            {pickLang(uiLang, STAT_TEXT.loadingDesc.ko, STAT_TEXT.loadingDesc.en)}
          </div>
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
        <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: 'var(--font-terminal), "Nanum Gothic Coding", "Noto Sans KR", monospace', color: '#FF5C33', opacity: 0.07, top: 10, right: -10, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>ERR</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
          <span style={{ display: 'inline-block', background: 'rgba(255,92,51,0.09)', color: '#FF5C33', fontSize: 9, fontFamily: 'var(--font-terminal), "Nanum Gothic Coding", "Noto Sans KR", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>
            {pickLang(uiLang, STAT_TEXT.connectionFailed.ko, STAT_TEXT.connectionFailed.en)}
          </span>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
            {pickLang(uiLang, STAT_TEXT.loadFailed.ko, STAT_TEXT.loadFailed.en)}
          </div>
          <div style={{ color: '#4a4a4a', fontSize: 11, fontFamily: 'var(--font-terminal), "Nanum Gothic Coding", "Noto Sans KR", monospace', lineHeight: 1.7 }}>{error}</div>
        </div>
      </div>
    )
  }
  if (!analysis) return null

  const s = analysis.stats || {}
  const v = analysis.valuation || {}
  const c = analysis.consensus || {}
  const cur = analysis.current_price
  const pe  = analysis.current_pe
  const pFcf = (
    cur != null &&
    Number.isFinite(cur) &&
    s.fcf_per_share != null &&
    Number.isFinite(s.fcf_per_share) &&
    s.fcf_per_share > 0
  ) ? (cur / s.fcf_per_share) : null
  const tPeg = s.peg_ratio

  // Market cap from valuation, enterprise value from stats
  const mktCap = v.market_cap
  const ev     = s.enterprise_value

  // Upside from consensus target
  const upsidePct = (cur && c.target_mean && cur > 0)
    ? (c.target_mean - cur) / cur
    : null
  const incomeTitleBase = pickLang(uiLang, STAT_TEXT.sectionIncome.ko, STAT_TEXT.sectionIncome.en)
  const incomeTitle = s.income_period
    ? `${incomeTitleBase} (${pickLang(uiLang, '회계연도', 'FY')}${s.income_period})`
    : incomeTitleBase

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '4px 0 16px' }}>

      {/* ?? Header: company info bar ??????????????????????????????? */}
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
            {[analysis.exchange, analysis.sector, analysis.industry].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {mktCap != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#64748b', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {pickLang(uiLang, STAT_TEXT.marketCap.ko, STAT_TEXT.marketCap.en)}
              </div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.90rem' }}>{fmtLarge(mktCap)}</div>
            </div>
          )}
          {ev != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#64748b', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {pickLang(uiLang, STAT_TEXT.enterpriseValue.ko, STAT_TEXT.enterpriseValue.en)}
              </div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.90rem' }}>{fmtLarge(ev)}</div>
            </div>
          )}
          {cur != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#64748b', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {pickLang(uiLang, STAT_TEXT.currentPrice.ko, STAT_TEXT.currentPrice.en)}
              </div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.90rem' }}>${cur.toFixed(2)}</div>
            </div>
          )}
        </div>
      </div>

      {/* ?? 2-column grid ?????????????????????????????????????????? */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>

        {/* ?? Valuation Ratios ???????????????????????????? */}
        <Section title={pickLang(uiLang, STAT_TEXT.sectionValuation.ko, STAT_TEXT.sectionValuation.en)}>
          <Row label={pickLang(uiLang, STAT_TEXT.peRatio.ko, STAT_TEXT.peRatio.en)} value={fmtMult(pe)} />
          <Row label={pickLang(uiLang, STAT_TEXT.psr.ko, STAT_TEXT.psr.en)} value={fmtMult(s.ps_ratio)} />
          <Row label={pickLang(uiLang, STAT_TEXT.pFcf.ko, STAT_TEXT.pFcf.en)} value={fmtMult(pFcf)} />
          <Row label={pickLang(uiLang, STAT_TEXT.pbRatio.ko, STAT_TEXT.pbRatio.en)} value={fmtMult(s.pb_ratio)} />
          <Row label={pickLang(uiLang, STAT_TEXT.tPeg.ko, STAT_TEXT.tPeg.en)} value={fmtMult(tPeg)} />
          <Row label={pickLang(uiLang, STAT_TEXT.evEbitda.ko, STAT_TEXT.evEbitda.en)} value={fmtMult(s.ev_ebitda)} />
          <Row label={pickLang(uiLang, STAT_TEXT.evSales.ko, STAT_TEXT.evSales.en)} value={fmtMult(s.ev_sales)} />
          <Row label={pickLang(uiLang, STAT_TEXT.evFcf.ko, STAT_TEXT.evFcf.en)} value={fmtMult(s.ev_fcf)} />
        </Section>

        {/* ?? Profitability ??????????????????????????????? */}
        <Section title={pickLang(uiLang, STAT_TEXT.sectionProfitability.ko, STAT_TEXT.sectionProfitability.en)}>
          <Row label={pickLang(uiLang, STAT_TEXT.roe.ko, STAT_TEXT.roe.en)} value={fmtPct(s.roe)} color={profitColor(s.roe)} />
          <Row label={pickLang(uiLang, STAT_TEXT.roa.ko, STAT_TEXT.roa.en)} value={fmtPct(s.roa)} color={profitColor(s.roa)} />
          <Row label={pickLang(uiLang, STAT_TEXT.roic.ko, STAT_TEXT.roic.en)} value={fmtPct(s.roic ?? s.roic_km)} color={profitColor(s.roic ?? s.roic_km)} />
          <Row label={pickLang(uiLang, STAT_TEXT.assetTurnover.ko, STAT_TEXT.assetTurnover.en)} value={s.asset_turnover != null ? s.asset_turnover.toFixed(2) : '--'} />
          <Row label={pickLang(uiLang, STAT_TEXT.revenuePerShare.ko, STAT_TEXT.revenuePerShare.en)} value={fmtNum(s.revenue_per_share)} />
          <Row label={pickLang(uiLang, STAT_TEXT.fcfPerShare.ko, STAT_TEXT.fcfPerShare.en)} value={fmtNum(s.fcf_per_share)} />
          {s.employees != null && (
            <Row label={pickLang(uiLang, STAT_TEXT.employees.ko, STAT_TEXT.employees.en)} value={fmtEmployees(s.employees)} />
          )}
        </Section>

        {/* ?? Margins ???????????????????????????????????? */}
        <Section title={pickLang(uiLang, STAT_TEXT.sectionMargins.ko, STAT_TEXT.sectionMargins.en)}>
          <Row label={pickLang(uiLang, STAT_TEXT.grossMargin.ko, STAT_TEXT.grossMargin.en)} value={fmtPct(v.gross_margin)} color={profitColor(v.gross_margin)} />
          <Row label={pickLang(uiLang, STAT_TEXT.operatingMargin.ko, STAT_TEXT.operatingMargin.en)} value={fmtPct(v.operating_margin)} color={profitColor(v.operating_margin)} />
          <Row label={pickLang(uiLang, STAT_TEXT.netMargin.ko, STAT_TEXT.netMargin.en)} value={fmtPct(v.net_margin)} color={profitColor(v.net_margin)} />
          <Row label={pickLang(uiLang, STAT_TEXT.ebitdaMargin.ko, STAT_TEXT.ebitdaMargin.en)} value={fmtPct(s.ebitda_margin)} color={profitColor(s.ebitda_margin)} />
        </Section>

        {/* ?? Income Statement ??????????????????????????? */}
        <Section title={incomeTitle}>
          <Row label={pickLang(uiLang, STAT_TEXT.revenue.ko, STAT_TEXT.revenue.en)} value={fmtLarge(s.revenue)} />
          <Row label={pickLang(uiLang, STAT_TEXT.grossProfit.ko, STAT_TEXT.grossProfit.en)} value={fmtLarge(s.gross_profit)} />
          <Row label={pickLang(uiLang, STAT_TEXT.operatingIncome.ko, STAT_TEXT.operatingIncome.en)} value={fmtLarge(s.operating_income)} />
          <Row label={pickLang(uiLang, STAT_TEXT.netIncome.ko, STAT_TEXT.netIncome.en)} value={fmtLarge(s.net_income)} />
          <Row label={pickLang(uiLang, STAT_TEXT.ebitda.ko, STAT_TEXT.ebitda.en)} value={fmtLarge(s.ebitda)} />
          <Row label={pickLang(uiLang, STAT_TEXT.epsReported.ko, STAT_TEXT.epsReported.en)} value={s.eps_reported != null ? `$${s.eps_reported.toFixed(2)}` : '--'} />
          <Row label={pickLang(uiLang, STAT_TEXT.epsTtm.ko, STAT_TEXT.epsTtm.en)} value={v.eps_ttm != null ? `$${v.eps_ttm.toFixed(2)}` : '--'} />
        </Section>

        {/* ?? Balance Sheet ??????????????????????????????? */}
        <Section title={pickLang(uiLang, STAT_TEXT.sectionBalance.ko, STAT_TEXT.sectionBalance.en)}>
          <Row label={pickLang(uiLang, STAT_TEXT.cashEq.ko, STAT_TEXT.cashEq.en)} value={fmtLarge(s.cash)} />
          <Row label={pickLang(uiLang, STAT_TEXT.totalDebt.ko, STAT_TEXT.totalDebt.en)} value={fmtLarge(s.total_debt)} />
          <Row label={pickLang(uiLang, STAT_TEXT.netDebt.ko, STAT_TEXT.netDebt.en)} value={fmtLarge(s.net_debt)}
            color={s.net_debt != null ? (s.net_debt < 0 ? '#4ade80' : '#fb923c') : undefined}
          />
          <Row label={pickLang(uiLang, STAT_TEXT.totalAssets.ko, STAT_TEXT.totalAssets.en)} value={fmtLarge(s.total_assets)} />
          <Row label={pickLang(uiLang, STAT_TEXT.debtEquity.ko, STAT_TEXT.debtEquity.en)} value={fmtMult(v.debt_to_equity)} />
          <Row label={pickLang(uiLang, STAT_TEXT.currentRatio.ko, STAT_TEXT.currentRatio.en)} value={v.current_ratio != null ? v.current_ratio.toFixed(2) : '--'} />
        </Section>

        {/* ?? Growth ????????????????????????????????????? */}
        <Section title={pickLang(uiLang, STAT_TEXT.sectionGrowth.ko, STAT_TEXT.sectionGrowth.en)}>
          <Row label={pickLang(uiLang, STAT_TEXT.revenueGrowth.ko, STAT_TEXT.revenueGrowth.en)} value={fmtPctSign(v.revenue_growth)} color={upsideColor(v.revenue_growth)} />
          <Row label={pickLang(uiLang, STAT_TEXT.epsFy1.ko, STAT_TEXT.epsFy1.en)} value={c.eps_estimate_fy1 != null ? `$${c.eps_estimate_fy1.toFixed(2)}` : '--'} />
          <Row label={pickLang(uiLang, STAT_TEXT.epsFy2.ko, STAT_TEXT.epsFy2.en)} value={c.eps_estimate_fy2 != null ? `$${c.eps_estimate_fy2.toFixed(2)}` : '--'} />
          <Row label={pickLang(uiLang, STAT_TEXT.forwardEps.ko, STAT_TEXT.forwardEps.en)} value={v.eps_forward != null ? `$${v.eps_forward.toFixed(2)}` : '--'} />
        </Section>

        {/* ?? Analyst Forecast (full-width) ??????????????????????????????? */}
      </div>

      <Section title={pickLang(uiLang, STAT_TEXT.sectionAnalyst.ko, STAT_TEXT.sectionAnalyst.en)}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <Row label={pickLang(uiLang, STAT_TEXT.priceTargetMean.ko, STAT_TEXT.priceTargetMean.en)} value={c.target_mean != null ? `$${c.target_mean.toFixed(2)}` : '--'}
            color={upsideColor(upsidePct)}
          />
          <Row label={pickLang(uiLang, STAT_TEXT.priceTargetHigh.ko, STAT_TEXT.priceTargetHigh.en)} value={c.target_high != null ? `$${c.target_high.toFixed(2)}` : '--'} />
          <Row label={pickLang(uiLang, STAT_TEXT.priceTargetLow.ko, STAT_TEXT.priceTargetLow.en)} value={c.target_low  != null ? `$${c.target_low.toFixed(2)}`  : '--'} />
          <Row label={pickLang(uiLang, STAT_TEXT.upsideToMean.ko, STAT_TEXT.upsideToMean.en)} value={fmtPctSign(upsidePct)} color={upsideColor(upsidePct)} />
          <Row label={pickLang(uiLang, STAT_TEXT.analystCoverage.ko, STAT_TEXT.analystCoverage.en)} value={c.target_analyst_count != null ? `${Math.round(c.target_analyst_count)} ${pickLang(uiLang, STAT_TEXT.analystsUnit.ko, STAT_TEXT.analystsUnit.en)}` : '--'} />
          <Row label={pickLang(uiLang, STAT_TEXT.epsFy1Estimate.ko, STAT_TEXT.epsFy1Estimate.en)} value={c.eps_estimate_fy1 != null ? `$${c.eps_estimate_fy1.toFixed(2)}` : '--'} />
        </div>
      </Section>

    </div>
  )
}

